import { randomUUID, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { LlmProvider } from "@baolu/agent";
import { Prisma, prisma } from "@baolu/db";
import { z } from "zod";
import { env } from "../config/env.js";
import { discardLanqiMediaAsset, lanqiMediaAssetUrl, markLanqiMediaAsset, persistLanqiMockImage, persistLanqiProviderImage, readLanqiMediaAsset } from "../services/lanqi-media-assets.js";
import { cancelLanqiMediaTask, getLanqiMediaExecutionReadiness, getLanqiMediaTask, quoteLanqiMedia, submitLanqiMedia, validateLanqiMediaRequest, type LanqiMediaRequest } from "../services/lanqi-media-generation.js";
import { resolveRequestContext } from "../services/request-context.js";
import { loadLanqiImagePreview, registerLanqiImageStudioRoutes } from "./lanqi-image-studio.js";

const mediaRequest = z.object({
  kind: z.enum(["image", "text_to_video", "image_to_video"]), prompt: z.string().trim().min(1).max(5000),
  negativePrompt: z.string().trim().max(5000).optional(), previewId: z.string().trim().regex(/^lanqi-image-[A-Za-z0-9_-]{12,160}$/).optional(),
  promptVersion: z.string().trim().min(1).max(80).optional(),
  resolution: z.enum(["720P", "1080P"]).optional(), ratio: z.enum(["1:1", "3:4", "16:9", "9:16"]).optional(),
  durationSeconds: z.union([z.literal(5), z.literal(10)]).optional(), imageUrl: z.string().url().optional(), requestKey: z.string().regex(/^[A-Za-z0-9_-]{12,120}$/).optional(),
});
const confirmationRequest = mediaRequest.extend({ confirmed: z.literal(true) });
const callback = z.object({ taskId: z.string().min(1), status: z.string().min(1), outputUrl: z.string().url().optional(), errorMessage: z.string().max(500).optional() });

type PublicJob = { id: string; previewId?: string; kind: string; status: string; progress: number; creditCost: number; billingStatus: string; assetStatus: string; outputUrl?: string; errorMessage?: string; canCancel: boolean; canRetry: boolean; selectedAt?: string; savedAt?: string; createdAt: string; updatedAt: string; executionMode: "mock" | "real" };
type MockJob = PublicJob & { tenantId: string; requestKey: string; prompt: string; negativePrompt?: string; promptVersion?: string; ratio?: string; refreshCount: number };
const mockJobs = new Map<string, MockJob[]>();

export async function registerLanqiMediaGenerationRoutes(app: FastifyInstance, provider: LlmProvider): Promise<void> {
  await registerLanqiImageStudioRoutes(app, provider);

  app.post<{ Body: z.infer<typeof mediaRequest> }>("/lanqi/media/quote", async (request, reply) => {
    const context = await resolveRequestContext(request.headers);
    const parsed = mediaRequest.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const bound = await bindTrustedImagePreview(context, parsed.data);
    if (!bound.ok) return reply.code(bound.statusCode).send({ error: bound.error, message: bound.message });
    const input = bound.input;
    const issue = validateLanqiMediaRequest(input);
    if (issue) return reply.code(400).send({ error: "invalid_media_request", message: issue });
    const readiness = getLanqiMediaExecutionReadiness(input);
    const quote = quoteLanqiMedia(input);
    const authorization = await resolveLanqiMediaAuthorization(context, readiness, quote.creditCost);
    request.log.info({ event: "lanqi_image_generation.quoted", tenantId: context.tenantId, previewId: input.previewId, promptVersion: input.promptVersion, mode: readiness.mode, canConfirm: authorization.canConfirm, blockCode: authorization.blockCode });
    return { creditCost: quote.creditCost, customerPriceYuan: quote.customerPriceYuan, canConfirm: authorization.canConfirm, billable: authorization.canConfirm && readiness.billable, executionMode: readiness.mode,
      blockCode: authorization.blockCode,
      message: authorization.canConfirm ? readiness.mode === "mock" ? "受控模拟生成已就绪；不会调用外部模型或扣积分。" : "费用已锁定；再次确认后才创建任务并预留积分。" : authorization.message,
      externalAction: "confirmation_required", aiWatermark: true, storage: readiness.mode === "mock" ? "controlled_mock" : readiness.storage };
  });

  app.post<{ Body: z.infer<typeof confirmationRequest> }>("/lanqi/media/confirm", async (request, reply) => {
    const parsed = confirmationRequest.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "explicit_confirmation_required", message: "请在费用预览后明确确认本次生成。" });
    const context = await resolveRequestContext(request.headers);
    const bound = await bindTrustedImagePreview(context, parsed.data);
    if (!bound.ok) return reply.code(bound.statusCode).send({ error: bound.error, message: bound.message });
    const input = bound.input;
    const issue = validateLanqiMediaRequest(input);
    if (issue) return reply.code(400).send({ error: "invalid_media_request", message: issue });
    const readiness = getLanqiMediaExecutionReadiness(input);
    const requestKey = input.requestKey ?? String(request.headers["x-idempotency-key"] ?? randomUUID());
    if (!/^[A-Za-z0-9_-]{12,120}$/.test(requestKey)) return reply.code(400).send({ error: "invalid_request_key" });
    if (readiness.mode === "mock") {
      if (!readiness.canConfirm) return reply.code(409).send({ error: "media_execution_blocked", message: readiness.blockedReason });
      try {
        const result = createMockJob(context.tenantId, requestKey, input);
        request.log.info({ event: "lanqi_image_generation.requested", tenantId: context.tenantId, previewId: input.previewId, jobId: result.job.id, mode: "mock", idempotent: result.idempotent });
        return reply.code(result.idempotent ? 200 : 202).send(result);
      } catch (error) {
        if ((error as { statusCode?: number }).statusCode === 409) return reply.code(409).send({ error: "request_key_conflict", message: "本次输入已经变化，请重新发起生成。" });
        throw error;
      }
    }
    if (context.source === "demo") return reply.code(409).send({ error: "demo_execution_disabled", message: "当前体验环境不会创建付费生成任务，也不会扣积分。" });
    const existing = await prisma.lanqiMediaJob.findFirst({ where: { tenantId: context.tenantId, requestKey } });
    if (existing) {
      if (!sameRequest(existing, input)) return reply.code(409).send({ error: "request_key_conflict", message: "本次输入已经变化，请重新发起生成。" });
      return { job: serialize(existing), idempotent: true };
    }
    const quote = quoteLanqiMedia(input);
    const authorization = await resolveLanqiMediaAuthorization(context, readiness, quote.creditCost);
    if (!authorization.canConfirm) return reply.code(authorization.blockCode === "quota_exhausted" ? 429 : 409).send({ error: authorization.blockCode ?? "media_execution_blocked", message: authorization.message });
    let job: any;
    try {
      job = await prisma.$transaction(async tx => {
        const account = await tx.creditAccount.findUnique({ where: { tenantId: context.tenantId } });
        if (!account || account.balance < quote.creditCost) throw Object.assign(new Error("insufficient_credits"), { statusCode: 402 });
        const created = await tx.lanqiMediaJob.create({ data: { tenantId: context.tenantId, userId: context.userId, requestKey, kind: input.kind, provider: quote.provider, model: quote.model,
          previewId: input.previewId, promptVersion: input.promptVersion ?? "unknown", prompt: input.prompt, negativePrompt: input.negativePrompt,
          parameters: { ratio: input.ratio, resolution: input.resolution, durationSeconds: input.durationSeconds, watermark: true } as Prisma.InputJsonValue,
          imageUrl: input.imageUrl, resolution: input.resolution, ratio: input.ratio, durationSeconds: input.durationSeconds, creditCost: quote.creditCost } });
        await tx.creditAccount.update({ where: { id: account.id }, data: { balance: { decrement: quote.creditCost } } });
        await tx.creditTransaction.create({ data: { creditAccountId: account.id, tenantId: context.tenantId, userId: context.userId, direction: "consume", amount: quote.creditCost, reason: "lanqi_media_generation", refType: "lanqi_media_job", refId: created.id } });
        return created;
      });
    } catch (error) {
      if ((error as { statusCode?: number }).statusCode === 402) return reply.code(402).send({ error: "insufficient_credits", message: "积分不足，本次没有创建任务或扣费。" });
      if ((error as { code?: string }).code === "P2002") {
        const concurrent = await prisma.lanqiMediaJob.findFirst({ where: { tenantId: context.tenantId, requestKey } });
        if (concurrent && sameRequest(concurrent, input)) return { job: serialize(concurrent), idempotent: true };
      }
      throw error;
    }
    try {
      const providerTaskId = await submitLanqiMedia(input, requestKey);
      job = await prisma.lanqiMediaJob.update({ where: { id: job.id }, data: { status: "submitted", providerTaskId, providerStatus: "PENDING" } });
      request.log.info({ event: "lanqi_image_generation.submitted", tenantId: context.tenantId, previewId: input.previewId, jobId: job.id });
      return reply.code(202).send({ job: serialize(job), idempotent: false });
    } catch (error) {
      job = await refund(job, "failed", error instanceof Error ? error.message : "provider_failed");
      request.log.error({ event: "lanqi_image_generation.failed", tenantId: context.tenantId, previewId: input.previewId, jobId: job.id, stage: "submit" });
      return reply.code(502).send({ error: "provider_submission_failed", message: "图片任务提交失败，预留积分已自动退回。", job: serialize(job) });
    }
  });

  app.get("/lanqi/media/jobs", async request => {
    const context = await resolveRequestContext(request.headers);
    if (env.LANQI_MEDIA_EXECUTION_MODE === "mock") return { jobs: (mockJobs.get(context.tenantId) ?? []).map(toPublicMock) };
    if (context.source === "demo") return { jobs: [] };
    const jobs = await prisma.lanqiMediaJob.findMany({ where: { tenantId: context.tenantId, kind: "image" }, orderBy: { createdAt: "desc" }, take: 30 });
    return { jobs: jobs.map(serialize) };
  });

  app.post<{ Params: { jobId: string } }>("/lanqi/media/jobs/:jobId/refresh", async (request, reply) => {
    const context = await resolveRequestContext(request.headers);
    if (env.LANQI_MEDIA_EXECUTION_MODE === "mock") {
      const job = await refreshMockJob(context.tenantId, request.params.jobId);
      if (!job) return reply.code(404).send({ error: "job_not_found" });
      return { job: toPublicMock(job) };
    }
    const job = await prisma.lanqiMediaJob.findFirst({ where: { id: request.params.jobId, tenantId: context.tenantId } });
    if (!job) return reply.code(404).send({ error: "job_not_found" });
    if (isTimedOut(job)) {
      if (job.providerTaskId) await cancelLanqiMediaTask(job.providerTaskId).catch(() => undefined);
      const timedOut = await refund(job, "failed", "media_task_timeout");
      return reply.code(504).send({ error: "media_task_timeout", message: "生成超时，本次预留积分已自动退回，可以重新生成。", job: serialize(timedOut) });
    }
    if (!job.providerTaskId || terminal(job.status)) return { job: serialize(job) };
    try {
      const provider = await getLanqiMediaTask(job.providerTaskId);
      const status = provider.status.toLowerCase();
      if (["succeeded", "success"].includes(status)) {
        if (!provider.outputUrl) throw new Error("provider_output_missing");
        await persistLanqiProviderImage({ tenantId: job.tenantId, jobId: job.id, sourceUrl: provider.outputUrl });
        const finalized = await finalizeSuccess(job, provider.status);
        if (!finalized.accepted) await discardLanqiMediaAsset({ tenantId: job.tenantId, jobId: job.id });
        const updated = finalized.job;
        request.log.info({ event: "lanqi_image_generation.succeeded", tenantId: context.tenantId, previewId: job.previewId, jobId: job.id });
        return { job: serialize(updated) };
      }
      if (["failed", "error", "canceled"].includes(status)) return { job: serialize(await refund(job, status === "canceled" ? "canceled" : "failed", provider.errorMessage ?? "provider_failed")) };
      const updated = await prisma.lanqiMediaJob.update({ where: { id: job.id }, data: { status: status === "pending" ? "submitted" : "processing", providerStatus: provider.status } });
      return { job: serialize(updated) };
    } catch (error) {
      if (error instanceof Error && ["provider_output_missing", "media_asset_storage_not_ready", "media_asset_invalid_content_type", "media_asset_invalid_size", "media_asset_too_large"].includes(error.message)) {
        const failed = await refund(job, "failed", error.message);
        return reply.code(502).send({ error: "media_asset_persistence_failed", message: "图片生成完成但保存失败，预留积分已自动退回。", job: serialize(failed) });
      }
      return reply.code(502).send({ error: "media_refresh_failed", message: "生成状态暂时无法刷新，请稍后再试。" });
    }
  });

  app.post<{ Params: { jobId: string } }>("/lanqi/media/jobs/:jobId/cancel", async (request, reply) => {
    const context = await resolveRequestContext(request.headers);
    if (env.LANQI_MEDIA_EXECUTION_MODE === "mock") {
      const existing = (mockJobs.get(context.tenantId) ?? []).find(item => item.id === request.params.jobId);
      if (!existing) return reply.code(404).send({ error: "job_not_found" });
      if (terminal(existing.status)) return reply.code(409).send({ error: "job_not_cancelable", message: "任务已结束，不能取消。" });
      const job = cancelMockJob(context.tenantId, request.params.jobId)!;
      return { job: toPublicMock(job) };
    }
    const job = await prisma.lanqiMediaJob.findFirst({ where: { id: request.params.jobId, tenantId: context.tenantId } });
    if (!job) return reply.code(404).send({ error: "job_not_found" });
    if (terminal(job.status)) return reply.code(409).send({ error: "job_not_cancelable", message: "任务已结束，不能取消。" });
    if (!job.providerTaskId || job.providerStatus?.toLowerCase() === "pending") {
      if (job.providerTaskId) {
        try { await cancelLanqiMediaTask(job.providerTaskId); }
        catch { return reply.code(409).send({ error: "provider_cancel_rejected", message: "任务已开始处理，供应商不再允许取消；可继续查看结果。" }); }
      }
      const canceled = await refund(job, "canceled", "user_canceled");
      request.log.info({ event: "lanqi_image_generation.canceled", tenantId: context.tenantId, previewId: job.previewId, jobId: job.id });
      return { job: serialize(canceled) };
    }
    return reply.code(409).send({ error: "job_not_cancelable", message: "任务已开始处理，当前不能取消。" });
  });

  app.post<{ Params: { jobId: string; action: string } }>("/lanqi/media/jobs/:jobId/assets/:action", async (request, reply) => {
    if (!(["select", "save"] as string[]).includes(request.params.action)) return reply.code(404).send({ error: "unknown_media_action" });
    const action = request.params.action as "select" | "save";
    const context = await resolveRequestContext(request.headers);
    if (env.LANQI_MEDIA_EXECUTION_MODE === "mock") {
      const job = await markMockJob(context.tenantId, request.params.jobId, action);
      if (!job) return reply.code(404).send({ error: "job_not_found" });
      if (job.status !== "succeeded") return reply.code(409).send({ error: "asset_not_ready", message: "图片尚未生成成功。" });
      return { job: toPublicMock(job) };
    }
    const job = await prisma.lanqiMediaJob.findFirst({ where: { id: request.params.jobId, tenantId: context.tenantId } });
    if (!job) return reply.code(404).send({ error: "job_not_found" });
    if (job.status !== "succeeded" || job.assetStatus !== "persisted") return reply.code(409).send({ error: "asset_not_ready", message: "图片尚未保存完成。" });
    const metadata = await markLanqiMediaAsset({ tenantId: context.tenantId, jobId: job.id, action });
    const updated = await prisma.lanqiMediaJob.update({ where: { id: job.id }, data: action === "select" ? { selectedAt: new Date(metadata.selectedAt!) } : { selectedAt: new Date(metadata.selectedAt!), savedAt: new Date(metadata.savedAt!) } });
    request.log.info({ event: `lanqi_image_generation.${action === "select" ? "selected" : "saved"}`, tenantId: context.tenantId, previewId: job.previewId, jobId: job.id });
    return { job: serialize(updated) };
  });

  app.get<{ Params: { jobId: string } }>("/lanqi/media/assets/:jobId", async (request, reply) => {
    const context = await resolveRequestContext(request.headers);
    if (env.LANQI_MEDIA_EXECUTION_MODE === "mock") {
      const job = (mockJobs.get(context.tenantId) ?? []).find(item => item.id === request.params.jobId);
      if (!job || job.status !== "succeeded") return reply.code(404).send({ error: "media_asset_not_found" });
    } else {
      const job = await prisma.lanqiMediaJob.findFirst({ where: { id: request.params.jobId, tenantId: context.tenantId, status: "succeeded", assetStatus: "persisted" } });
      if (!job) return reply.code(404).send({ error: "media_asset_not_found" });
    }
    try {
      const asset = await readLanqiMediaAsset({ tenantId: context.tenantId, jobId: request.params.jobId });
      return reply.header("Content-Type", asset.metadata.contentType).header("Cache-Control", "private, max-age=3600").send(asset.bytes);
    } catch (error) {
      request.log.warn({
        event: "lanqi_media_asset.read_failed",
        jobFingerprint: request.params.jobId.slice(0, 8),
        errorCode: error instanceof Error ? error.message : "unknown_asset_read_error",
      });
      return reply.code(404).send({ error: "media_asset_not_found" });
    }
  });

  app.get<{ Params: { jobId: string } }>("/lanqi/media/assets/:jobId/download", async (request, reply) => {
    const context = await resolveRequestContext(request.headers);
    if (env.LANQI_MEDIA_EXECUTION_MODE === "mock") {
      const job = (mockJobs.get(context.tenantId) ?? []).find(item => item.id === request.params.jobId);
      if (!job || job.status !== "succeeded") return reply.code(404).send({ error: "media_asset_not_found" });
    } else {
      const job = await prisma.lanqiMediaJob.findFirst({ where: { id: request.params.jobId, tenantId: context.tenantId, status: "succeeded", assetStatus: "persisted" } });
      if (!job) return reply.code(404).send({ error: "media_asset_not_found" });
    }
    try {
      const asset = await readLanqiMediaAsset({ tenantId: context.tenantId, jobId: request.params.jobId });
      const extension = asset.metadata.contentType === "image/jpeg" ? "jpg" : asset.metadata.contentType === "image/webp" ? "webp" : "png";
      const fileName = `lanqi-xhs-${request.params.jobId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 24)}.${extension}`;
      request.log.info({ event: "lanqi_xhs_package.downloaded", tenantId: context.tenantId, jobFingerprint: request.params.jobId.slice(0, 8) });
      return reply
        .header("Content-Type", asset.metadata.contentType)
        .header("Content-Disposition", `attachment; filename="${fileName}"`)
        .header("Cache-Control", "private, no-store")
        .send(asset.bytes);
    } catch {
      return reply.code(404).send({ error: "media_asset_not_found" });
    }
  });

  app.post<{ Body: z.infer<typeof callback> }>("/lanqi/media/callbacks/aliyun", async (request, reply) => {
    const token = String(request.headers["x-aliyun-media-token"] ?? "");
    if (!safe(token, env.ALIYUN_MEDIA_GENERATION_CALLBACK_TOKEN)) return reply.code(401).send({ error: "unauthorized_callback" });
    const parsed = callback.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_callback" });
    const job = await prisma.lanqiMediaJob.findUnique({ where: { providerTaskId: parsed.data.taskId } });
    if (!job) return reply.code(404).send({ error: "job_not_found" });
    const status = parsed.data.status.toLowerCase();
    if (["succeeded", "success"].includes(status) && parsed.data.outputUrl) {
      try {
        await persistLanqiProviderImage({ tenantId: job.tenantId, jobId: job.id, sourceUrl: parsed.data.outputUrl });
        const finalized = await finalizeSuccess(job, parsed.data.status);
        if (!finalized.accepted) await discardLanqiMediaAsset({ tenantId: job.tenantId, jobId: job.id });
      } catch (error) { await refund(job, "failed", error instanceof Error ? error.message : "asset_persistence_failed"); }
    } else if (["failed", "error", "canceled"].includes(status)) await refund(job, status === "canceled" ? "canceled" : "failed", parsed.data.errorMessage ?? "provider_failed");
    else await prisma.lanqiMediaJob.update({ where: { id: job.id }, data: { status: "processing", providerStatus: parsed.data.status } });
    return { ok: true };
  });
}

async function refund(job: any, finalStatus: "failed" | "canceled", message: string) {
  return prisma.$transaction(async tx => {
    const claimed = await tx.lanqiMediaJob.updateMany({ where: { id: job.id, billingStatus: "reserved" }, data: { billingStatus: "refund_processing" } });
    const current = await tx.lanqiMediaJob.findUnique({ where: { id: job.id } });
    if (!current) return job;
    if (claimed.count === 0) return current;
    if (claimed.count === 1) {
      const account = await tx.creditAccount.findUnique({ where: { tenantId: current.tenantId } });
      if (account) {
        await tx.creditAccount.update({ where: { id: account.id }, data: { balance: { increment: current.creditCost } } });
        await tx.creditTransaction.create({ data: { creditAccountId: account.id, tenantId: current.tenantId, userId: current.userId, direction: "refund", amount: current.creditCost, reason: "lanqi_media_generation_refund", refType: "lanqi_media_job", refId: current.id } });
      }
    }
    return tx.lanqiMediaJob.update({ where: { id: current.id }, data: { status: finalStatus, billingStatus: "refunded", assetStatus: "unavailable", errorMessage: message.slice(0, 500), completedAt: new Date(), ...(finalStatus === "canceled" ? { canceledAt: new Date() } : {}) } });
  });
}

async function finalizeSuccess(job: any, providerStatus: string): Promise<{ job: any; accepted: boolean }> {
  return prisma.$transaction(async tx => {
    const claimed = await tx.lanqiMediaJob.updateMany({
      where: { id: job.id, billingStatus: "reserved", status: { notIn: ["failed", "canceled", "succeeded"] } },
      data: { status: "succeeded", billingStatus: "charged", assetStatus: "persisted", outputUrl: lanqiMediaAssetUrl(job.id), providerStatus, completedAt: new Date() },
    });
    const current = await tx.lanqiMediaJob.findUnique({ where: { id: job.id } });
    if (!current) return { job, accepted: false };
    return { job: current, accepted: claimed.count === 1 || (current.status === "succeeded" && current.billingStatus === "charged") };
  });
}

function createMockJob(tenantId: string, requestKey: string, input: LanqiMediaRequest): { job: PublicJob; idempotent: boolean } {
  const items = mockJobs.get(tenantId) ?? [];
  const existing = items.find(item => item.requestKey === requestKey);
  if (existing) {
    if (existing.prompt !== input.prompt || existing.negativePrompt !== input.negativePrompt || existing.previewId !== input.previewId || existing.promptVersion !== input.promptVersion) throw Object.assign(new Error("request_key_conflict"), { statusCode: 409 });
    return { job: toPublicMock(existing), idempotent: true };
  }
  const now = new Date().toISOString();
  const quote = quoteLanqiMedia(input);
  const job: MockJob = { id: `mock-${randomUUID()}`, tenantId, requestKey, previewId: input.previewId, kind: input.kind, prompt: input.prompt, negativePrompt: input.negativePrompt, promptVersion: input.promptVersion, ratio: input.ratio,
    status: "queued", progress: 10, creditCost: quote.creditCost, billingStatus: "not_billed", assetStatus: "pending", canCancel: true, canRetry: false, createdAt: now, updatedAt: now, executionMode: "mock", refreshCount: 0 };
  mockJobs.set(tenantId, [job, ...items].slice(0, 30));
  return { job: toPublicMock(job), idempotent: false };
}

async function refreshMockJob(tenantId: string, jobId: string): Promise<MockJob | undefined> {
  const job = (mockJobs.get(tenantId) ?? []).find(item => item.id === jobId);
  if (!job || terminal(job.status)) return job;
  job.refreshCount += 1; job.updatedAt = new Date().toISOString();
  if (job.refreshCount === 1) { job.status = "processing"; job.progress = 55; }
  else if (job.prompt.includes("[模拟失败]")) { job.status = "failed"; job.progress = 0; job.assetStatus = "unavailable"; job.errorMessage = "受控模拟失败；未调用外部模型、未扣积分。"; job.canCancel = false; job.canRetry = true; }
  else { await persistLanqiMockImage({ tenantId, jobId, prompt: job.prompt, ratio: job.ratio }); job.status = "succeeded"; job.progress = 100; job.assetStatus = "persisted"; job.outputUrl = lanqiMediaAssetUrl(job.id); job.canCancel = false; }
  return job;
}

function cancelMockJob(tenantId: string, jobId: string): MockJob | undefined {
  const job = (mockJobs.get(tenantId) ?? []).find(item => item.id === jobId);
  if (!job || terminal(job.status)) return job;
  job.status = "canceled"; job.progress = 0; job.billingStatus = "not_billed"; job.assetStatus = "unavailable"; job.errorMessage = "任务已取消；模拟验收未产生费用。"; job.canCancel = false; job.canRetry = true; job.updatedAt = new Date().toISOString();
  return job;
}

async function markMockJob(tenantId: string, jobId: string, action: "select" | "save"): Promise<MockJob | undefined> {
  const job = (mockJobs.get(tenantId) ?? []).find(item => item.id === jobId);
  if (!job || job.status !== "succeeded") return job;
  const metadata = await markLanqiMediaAsset({ tenantId, jobId, action });
  job.selectedAt = metadata.selectedAt; job.savedAt = metadata.savedAt; job.updatedAt = new Date().toISOString();
  return job;
}

function toPublicMock(job: MockJob): PublicJob {
  const { tenantId: _tenantId, requestKey: _requestKey, prompt: _prompt, negativePrompt: _negativePrompt, promptVersion: _promptVersion, ratio: _ratio, refreshCount: _refreshCount, ...result } = job;
  return result;
}

function serialize(job: any): PublicJob {
  const status = String(job.status);
  return { id: job.id, previewId: job.previewId ?? undefined, kind: job.kind, status, progress: status === "succeeded" ? 100 : status === "processing" ? 60 : status === "submitted" ? 25 : 0,
    creditCost: job.creditCost, billingStatus: job.billingStatus, assetStatus: job.assetStatus ?? (job.outputUrl ? "persisted" : "pending"), outputUrl: job.outputUrl ?? undefined,
    errorMessage: job.errorMessage ? "生成失败或已取消；未交付结果不会重复扣费，已预留积分会自动退回。" : undefined,
    canCancel: ["queued", "submitted"].includes(status), canRetry: ["failed", "canceled"].includes(status), selectedAt: toIso(job.selectedAt), savedAt: toIso(job.savedAt), createdAt: toIso(job.createdAt)!, updatedAt: toIso(job.updatedAt)!, executionMode: "real" };
}

function sameRequest(job: any, input: LanqiMediaRequest): boolean { return job.kind === input.kind && job.prompt === input.prompt && (job.negativePrompt ?? undefined) === input.negativePrompt && (job.previewId ?? undefined) === input.previewId && (job.promptVersion ?? undefined) === input.promptVersion && (job.ratio ?? undefined) === input.ratio; }

export async function resolveLanqiMediaAuthorization(
  context: Awaited<ReturnType<typeof resolveRequestContext>>,
  readiness: ReturnType<typeof getLanqiMediaExecutionReadiness>,
  creditCost: number,
): Promise<{ canConfirm: boolean; message: string; blockCode?: "media_execution_blocked" | "quota_exhausted" }> {
  if (!readiness.canConfirm) return { canConfirm: false, message: readiness.blockedReason ?? "当前媒体生成能力未放行，本次不会创建任务或扣积分。", blockCode: "media_execution_blocked" };
  if (readiness.mode !== "real" || context.source !== "database") return { canConfirm: true, message: "" };
  const [account, completedJobs] = await Promise.all([
    prisma.creditAccount.findUnique({ where: { tenantId: context.tenantId }, select: { balance: true } }),
    prisma.lanqiMediaJob.count({ where: { tenantId: context.tenantId, kind: "image", providerTaskId: { not: null } } }),
  ]);
  if (!account || account.balance < creditCost) {
    return {
      canConfirm: false,
      blockCode: "quota_exhausted",
      message: completedJobs >= 3
        ? "本次验收生图额度已用完，现有 3 张可继续查看；继续生图需要新的明确授权。"
        : "当前可用生图额度不足，本次不会创建任务或扣积分；继续生图需要新的明确授权。",
    };
  }
  return { canConfirm: true, message: "" };
}

async function bindTrustedImagePreview(context: Awaited<ReturnType<typeof resolveRequestContext>>, input: LanqiMediaRequest): Promise<
  | { ok: true; input: LanqiMediaRequest }
  | { ok: false; statusCode: 404 | 409 | 422; error: string; message: string }
> {
  if (input.kind !== "image") return { ok: true, input };
  if (!input.previewId) return { ok: false, statusCode: 422, error: "image_preview_required", message: "请先生成并选择一版专业提示词。" };
  const preview = await loadLanqiImagePreview(context, input.previewId);
  if (!preview) return { ok: false, statusCode: 404, error: "image_preview_not_found", message: "这版提示词不存在或不属于当前门店，请重新生成。" };
  const selected = preview.directions.find(item => item.id === preview.selectedDirectionId) ?? preview.directions[0];
  if (!selected) return { ok: false, statusCode: 409, error: "image_preview_invalid", message: "这版提示词缺少可用视觉方向，请重新生成。" };
  const expectedVersion = preview.enhancer.version;
  if (input.prompt !== selected.positivePrompt || input.negativePrompt !== selected.negativePrompt || input.ratio !== preview.ratio || input.promptVersion !== expectedVersion) {
    return { ok: false, statusCode: 409, error: "image_preview_stale", message: "提示词或参数已经变化，请刷新预览后重新确认。" };
  }
  return { ok: true, input: { ...input, prompt: selected.positivePrompt, negativePrompt: selected.negativePrompt, ratio: preview.ratio, promptVersion: expectedVersion } };
}
function isTimedOut(job: { status: string; createdAt: Date }): boolean { return !terminal(job.status) && Date.now() - job.createdAt.getTime() > env.LANQI_MEDIA_TASK_TIMEOUT_MINUTES * 60_000; }
function terminal(status: string): boolean { return ["succeeded", "failed", "canceled"].includes(status); }
function toIso(value?: Date | string | null): string | undefined { return value instanceof Date ? value.toISOString() : value ?? undefined; }
function safe(a: string, b?: string) { return Boolean(b && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))); }

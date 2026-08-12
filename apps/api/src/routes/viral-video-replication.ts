import { randomUUID, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@baolu/db";
import { env, domesticNetworkOnly, domesticOutboundAllowlist } from "../config/env.js";
import { getDemoFile } from "../services/demo-files.js";
import { assertOutboundUrlAllowed } from "../services/outbound-policy.js";
import { resolveRequestContext } from "../services/request-context.js";
import { buildAliyunReplicationRequest, isAliyunReplicationConfigured, validateViralReplicationInput } from "../services/viral-video-replication.js";

const replicationSchema = z.object({
  referenceVideoUrl: z.string().optional(), portraitImageUrl: z.string().optional(),
  referenceFileId: z.string().optional(), portraitFileId: z.string().optional(),
  requestKey: z.string().trim().min(12).max(120).optional(),
  model: z.enum(["aliyun_strict", "seedance_creative"]),
  visualRightsConfirmed: z.boolean(), audioRightsConfirmed: z.boolean(),
  performerConsentConfirmed: z.boolean(), portraitConsentConfirmed: z.boolean()
});
const callbackSchema = z.object({ taskId: z.string().min(1).max(200), status: z.string().min(1).max(80), outputVideoUrl: z.string().url().optional(), errorCode: z.string().max(100).optional(), errorMessage: z.string().max(500).optional() });

const configuredCreditCost = (): number | undefined => env.ALIYUN_VIDEO_REPLICATION_CREDITS > 0 ? env.ALIYUN_VIDEO_REPLICATION_CREDITS : undefined;

export async function registerViralVideoReplicationRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: z.infer<typeof replicationSchema> }>("/viral-video-replication/quote", async (request, reply) => {
    const context = await resolveRequestContext(request.headers);
    const parsed = replicationSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", message: "复刻任务参数不完整" });
    const issue = await validateRequest(context.tenantId, parsed.data);
    if (issue) return reply.code(400).send({ error: "invalid_replication_request", message: issue });
    const configured = isAliyunReplicationConfigured(); const creditCost = configuredCreditCost();
    return { model: "aliyun_strict", mode: "严格复刻：保留原场景、动作、节奏和授权原音频，仅替换主角", providerConfigured: configured, creditCost: creditCost ?? null, canConfirm: configured && Boolean(creditCost), watermark: "成片会保留 AI 生成标识与可审计任务记录", message: configured && creditCost ? "已生成报价；确认后才会提交供应商并扣减积分。" : "供应商密钥、回调地址或计费参数尚未配置，当前不能创建或扣费。" };
  });

  app.post<{ Body: z.infer<typeof replicationSchema> }>("/viral-video-replication/confirm", async (request, reply) => {
    const context = await resolveRequestContext(request.headers);
    const parsed = replicationSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", message: "复刻任务参数不完整" });
    const issue = await validateRequest(context.tenantId, parsed.data);
    if (issue) return reply.code(400).send({ error: "invalid_replication_request", message: issue });
    const creditCost = configuredCreditCost();
    if (!isAliyunReplicationConfigured() || !creditCost) return reply.code(409).send({ error: "provider_not_configured", message: "爆款复刻供应商或计费尚未配置；系统没有创建任务，也没有扣费。" });
    if (!parsed.data.referenceVideoUrl || !parsed.data.portraitImageUrl) return reply.code(409).send({ error: "secure_staging_required", message: "站内上传素材已安全保存，但供应商直传暂存尚未配置；系统没有创建任务或扣费。" });
    if (context.source === "demo") return reply.code(409).send({ error: "demo_execution_disabled", message: "演示环境不调用真实视频服务，也不会扣费；请在测试或生产租户完成受控验收。" });

    const requestKey = parsed.data.requestKey ?? String(request.headers["x-idempotency-key"] ?? randomUUID());
    const existing = await prisma.viralVideoReplicationJob.findFirst({ where: { tenantId: context.tenantId, requestKey } });
    if (existing) return { job: serializeJob(existing), idempotent: true };
    let job: any;
    try {
      job = await prisma.$transaction(async (tx: any) => {
        const account = await tx.creditAccount.findUnique({ where: { tenantId: context.tenantId } });
        if (!account || account.balance < creditCost) {
          const error = new Error("企业积分不足，未创建复刻任务。") as Error & { statusCode: number }; error.statusCode = 402; throw error;
        }
        const created = await tx.viralVideoReplicationJob.create({ data: {
          tenantId: context.tenantId, userId: context.userId, requestKey, model: parsed.data.model, creditCost,
          referenceVideoUrl: parsed.data.referenceVideoUrl, portraitImageUrl: parsed.data.portraitImageUrl,
          referenceFileId: parsed.data.referenceFileId, portraitFileId: parsed.data.portraitFileId,
          authorizationSnapshot: authorizationSnapshot(parsed.data)
        } });
        await tx.creditAccount.update({ where: { id: account.id }, data: { balance: { decrement: creditCost } } });
        await tx.creditTransaction.create({ data: { creditAccountId: account.id, tenantId: context.tenantId, userId: context.userId, direction: "consume", amount: creditCost, reason: "viral_video_replication", refType: "viral_video_replication_job", refId: created.id } });
        return created;
      });
    } catch (error) { if ((error as { statusCode?: number }).statusCode === 402) return reply.code(402).send({ error: "insufficient_credits", message: "企业积分不足，未创建复刻任务。" }); throw error; }

    try {
      const providerTaskId = await submitAliyun(parsed.data.referenceVideoUrl, parsed.data.portraitImageUrl, requestKey);
      job = await prisma.viralVideoReplicationJob.update({ where: { id: job.id }, data: { status: "submitted", providerTaskId, providerStatus: "submitted" } });
      return reply.code(202).send({ job: serializeJob(job), idempotent: false });
    } catch (error) {
      job = await refundFailedJob(job, error instanceof Error ? error.message : "provider_submission_failed");
      return reply.code(502).send({ error: "provider_submission_failed", message: "供应商未接受任务，积分已自动退回。", job: serializeJob(job) });
    }
  });

  app.get("/viral-video-replication/jobs", async (request) => {
    const context = await resolveRequestContext(request.headers);
    if (context.source === "demo") return { jobs: [] };
    const jobs = await prisma.viralVideoReplicationJob.findMany({ where: { tenantId: context.tenantId }, orderBy: { createdAt: "desc" }, take: 20 });
    return { jobs: jobs.map(serializeJob) };
  });

  app.post<{ Body: z.infer<typeof callbackSchema> }>("/viral-video-replication/callbacks/aliyun", async (request, reply) => {
    if (!constantTimeTokenMatch(String(request.headers["x-aliyun-replication-token"] ?? ""), env.ALIYUN_VIDEO_REPLICATION_CALLBACK_TOKEN)) return reply.code(401).send({ error: "unauthorized_callback" });
    const parsed = callbackSchema.safeParse(request.body); if (!parsed.success) return reply.code(400).send({ error: "invalid_callback" });
    const job = await prisma.viralVideoReplicationJob.findUnique({ where: { providerTaskId: parsed.data.taskId } });
    if (!job) return reply.code(404).send({ error: "job_not_found" });
    const normalized = parsed.data.status.toLowerCase();
    if (normalized === "succeeded" || normalized === "success") {
      if (!parsed.data.outputVideoUrl) return reply.code(400).send({ error: "output_required" });
      await prisma.viralVideoReplicationJob.update({ where: { id: job.id }, data: { status: "succeeded", billingStatus: "charged", providerStatus: parsed.data.status, outputVideoUrl: parsed.data.outputVideoUrl, completedAt: new Date() } });
    } else if (["failed", "error", "canceled"].includes(normalized)) {
      await refundFailedJob(job, parsed.data.errorMessage ?? "provider_failed", parsed.data.errorCode, parsed.data.status);
    } else {
      await prisma.viralVideoReplicationJob.update({ where: { id: job.id }, data: { status: "processing", providerStatus: parsed.data.status } });
    }
    return { ok: true };
  });
}

async function validateRequest(tenantId: string, data: z.infer<typeof replicationSchema>): Promise<string | undefined> {
  const issue = validateViralReplicationInput(data); if (issue) return issue;
  if (!(await uploadedAssetsBelongToTenant(tenantId, data.referenceFileId, data.portraitFileId))) return "上传素材不存在或不属于当前主体";
  return undefined;
}
async function uploadedAssetsBelongToTenant(tenantId: string, referenceFileId?: string, portraitFileId?: string): Promise<boolean> {
  for (const fileId of [referenceFileId, portraitFileId].filter(Boolean) as string[]) {
    const file = env.DATA_MODE === "demo" ? getDemoFile(fileId, tenantId) : await prisma.uploadedFile.findFirst({ where: { id: fileId, tenantId }, select: { id: true } }); if (!file) return false;
  } return true;
}
async function submitAliyun(referenceVideoUrl: string, portraitImageUrl: string, requestKey: string): Promise<string> {
  const endpoint = env.ALIYUN_VIDEO_REPLICATION_ENDPOINT; const apiKey = env.ALIYUN_VIDEO_REPLICATION_API_KEY;
  if (!endpoint || !apiKey) throw new Error("provider_not_configured");
  assertOutboundUrlAllowed("Aliyun video replication", endpoint, { domesticNetworkOnly, allowedHosts: domesticOutboundAllowlist });
  const response = await fetch(endpoint, { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "X-Request-Id": requestKey }, body: JSON.stringify(buildAliyunReplicationRequest({ referenceVideoUrl, portraitImageUrl })) });
  const body = await response.json().catch(() => ({})) as Record<string, any>;
  const taskId = body.task_id ?? body.taskId ?? body.output?.task_id ?? body.data?.task_id;
  if (!response.ok || typeof taskId !== "string" || !taskId) throw new Error(typeof body.message === "string" ? body.message.slice(0, 300) : `provider_http_${response.status}`);
  return taskId;
}
async function refundFailedJob(job: any, errorMessage: string, errorCode?: string, providerStatus?: string): Promise<any> {
  if (job.billingStatus === "refunded") return job;
  return prisma.$transaction(async (tx: any) => {
    const current = await tx.viralVideoReplicationJob.findUnique({ where: { id: job.id } }); if (!current || current.billingStatus === "refunded") return current ?? job;
    const account = await tx.creditAccount.findUnique({ where: { tenantId: current.tenantId } });
    if (account) { await tx.creditAccount.update({ where: { id: account.id }, data: { balance: { increment: current.creditCost } } }); await tx.creditTransaction.create({ data: { creditAccountId: account.id, tenantId: current.tenantId, userId: current.userId, direction: "refund", amount: current.creditCost, reason: "viral_video_replication_refund", refType: "viral_video_replication_job", refId: current.id } }); }
    return tx.viralVideoReplicationJob.update({ where: { id: current.id }, data: { status: "failed", billingStatus: "refunded", providerStatus: providerStatus ?? "failed", errorCode: errorCode ?? "provider_submission_failed", errorMessage: errorMessage.slice(0, 500), completedAt: new Date() } });
  });
}
function authorizationSnapshot(data: z.infer<typeof replicationSchema>): Record<string, boolean> { return { visualRightsConfirmed: data.visualRightsConfirmed, audioRightsConfirmed: data.audioRightsConfirmed, performerConsentConfirmed: data.performerConsentConfirmed, portraitConsentConfirmed: data.portraitConsentConfirmed }; }
function serializeJob(job: any): Record<string, unknown> { return { id: job.id, status: job.status, model: job.model, creditCost: job.creditCost, billingStatus: job.billingStatus, outputVideoUrl: job.outputVideoUrl, errorMessage: job.errorMessage, createdAt: job.createdAt, completedAt: job.completedAt }; }
function constantTimeTokenMatch(received: string, expected: string | undefined): boolean { if (!expected || received.length !== expected.length) return false; return timingSafeEqual(Buffer.from(received), Buffer.from(expected)); }

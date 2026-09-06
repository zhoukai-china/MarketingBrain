import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { LlmProvider } from "@baolu/agent";
import { z } from "zod";
import { getLanqiMediaExecutionReadiness, quoteLanqiMedia } from "../services/lanqi-media-generation.js";
import { resolveRequestContext } from "../services/request-context.js";
import { resolveLanqiMediaAuthorization } from "./lanqi-media-generation.js";

const imageSettings = z.object({
  purpose: z.enum(["xiaohongshu_cover", "service_intro", "product_visual", "store_campaign", "brand_visual"]).default("xiaohongshu_cover"),
  ratio: z.enum(["1:1", "3:4", "16:9", "9:16"]).default("3:4"),
  style: z.enum(["premium", "clean", "warm", "natural", "clinical_clean"]).default("premium"),
  allowPeople: z.boolean().default(false),
  overlayTitle: z.boolean().default(true),
  rightsConfirmed: z.literal(true),
});
const quoteRequest = imageSettings;
const packageRequest = imageSettings.extend({
  request: z.string().trim().min(6).max(1200),
  audience: z.string().trim().max(120).optional(),
  goal: z.string().trim().max(120).optional(),
  quoteId: z.string().regex(/^[a-f0-9]{24}$/),
  requestId: z.string().regex(/^[A-Za-z0-9_-]{12,96}$/),
  confirmed: z.literal(true),
});
const retryRequest = z.object({
  quoteId: z.string().regex(/^[a-f0-9]{24}$/),
  requestId: z.string().regex(/^[A-Za-z0-9_-]{12,120}$/),
  confirmed: z.literal(true),
});

type SubResponse = { statusCode: number; body: Record<string, any> };
const inFlightPackages = new Map<string, Promise<{ statusCode: number; body: Record<string, any> }>>();

export async function registerLanqiXhsPackageRoutes(app: FastifyInstance, _provider: LlmProvider): Promise<void> {
  app.post<{ Body: z.infer<typeof quoteRequest> }>("/lanqi/content-studio/package-quote", async (request, reply) => {
    const parsed = quoteRequest.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "invalid_package_quote", message: "请先确认图片与素材使用权。" });
    const context = await resolveRequestContext(request.headers);
    const quote = await buildPackageQuote(context, parsed.data);
    request.log.info({ event: "lanqi_xhs_package.quoted", tenantId: context.tenantId, quoteId: quote.quoteId, canConfirm: quote.canConfirm });
    return quote;
  });

  app.get("/lanqi/content-studio/packages", async request => {
    const context = await resolveRequestContext(request.headers);
    const merged = await loadPackages(app, request);
    request.log.info({ event: "lanqi_xhs_package.restored", tenantId: context.tenantId, packageCount: merged.packages.length });
    return merged;
  });

  app.post<{ Body: z.infer<typeof packageRequest> }>("/lanqi/content-studio/packages", async (request, reply) => {
    const parsed = packageRequest.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "invalid_xhs_package_request", message: "请完整填写图文需求并确认素材权利。" });
    const context = await resolveRequestContext(request.headers);
    const input = parsed.data;
    const current = await loadPackages(app, request);
    const restored = current.packages.find((item: any) => item.packageId === input.requestId);
    if (restored) {
      if (restored.draft?.topic !== input.request.slice(0, 160)) return reply.code(409).send({ error: "request_key_conflict", message: "同一请求编号的需求已经变化，请重新发起。" });
      return { package: restored, idempotent: true };
    }
    const quote = await buildPackageQuote(context, input);
    if (quote.quoteId !== input.quoteId) return reply.code(409).send({ error: "package_quote_changed", message: "报价或设置已经变化，请刷新报价后再生成。", quote });
    if (!quote.canConfirm) return reply.code(quote.blockCode === "quota_exhausted" ? 429 : 409).send({ error: quote.blockCode ?? "media_execution_blocked", message: quote.message, quote });

    const runKey = `${context.tenantId}:${input.requestId}`;
    const existingRun = inFlightPackages.get(runKey);
    const run = existingRun ?? runPackage(app, request, input, quote);
    if (!existingRun) inFlightPackages.set(runKey, run);
    try {
      const result = await run;
      return reply.code(result.statusCode).send({ ...result.body, idempotent: Boolean(existingRun) || result.body.idempotent });
    } finally {
      if (!existingRun && inFlightPackages.get(runKey) === run) inFlightPackages.delete(runKey);
    }
  });

  app.post<{ Params: { packageId: string }; Body: z.infer<typeof retryRequest> }>("/lanqi/content-studio/packages/:packageId/retry-image", async (request, reply) => {
    const parsed = retryRequest.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "invalid_image_retry", message: "重新生成图片需要再次确认当前费用。" });
    const context = await resolveRequestContext(request.headers);
    const merged = await loadPackages(app, request);
    const current = merged.packages.find((item: any) => item.packageId === request.params.packageId);
    if (!current?.draft || !current.preview) return reply.code(404).send({ error: "xhs_package_not_found" });
    const settings = settingsFromPreview(current.preview);
    const quote = await buildPackageQuote(context, { ...settings, rightsConfirmed: true });
    if (quote.quoteId !== parsed.data.quoteId) return reply.code(409).send({ error: "package_quote_changed", message: "报价已经变化，请刷新后再重试图片。", quote });
    if (!quote.canConfirm) return reply.code(quote.blockCode === "quota_exhausted" ? 429 : 409).send({ error: quote.blockCode ?? "media_execution_blocked", message: quote.message, quote });
    const direction = selectedDirection(current.preview);
    if (!direction) return reply.code(409).send({ error: "image_preview_invalid", message: "专业图片提示词不可用，请重新生成整套图文。" });
    const media = await subrequest(app, request, "POST", "/lanqi/media/confirm", {
      kind: "image", previewId: current.preview.id, promptVersion: current.preview.enhancer.version,
      prompt: direction.positivePrompt, negativePrompt: direction.negativePrompt, ratio: current.preview.ratio,
      requestKey: parsed.data.requestId, confirmed: true,
    });
    const refreshed = await loadPackages(app, request);
    const result = refreshed.packages.find((item: any) => item.packageId === request.params.packageId) ?? current;
    if (media.statusCode >= 400) {
      request.log.warn({ event: "lanqi_xhs_package.partial_success", tenantId: context.tenantId, packageId: request.params.packageId, stage: "image_retry" });
      return reply.code(207).send({ package: { ...result, status: "partial_success", imageError: publicMessage(media.body, "图片重试失败，文案已保留。") }, idempotent: false });
    }
    request.log.info({ event: "lanqi_xhs_package.image_requested", tenantId: context.tenantId, packageId: request.params.packageId, jobId: media.body.job?.id });
    return reply.code(media.statusCode === 200 ? 200 : 202).send({ package: result, idempotent: Boolean(media.body.idempotent) });
  });

  app.post<{ Params: { packageId: string } }>("/lanqi/content-studio/packages/:packageId/refresh", async (request, reply) => {
    const context = await resolveRequestContext(request.headers);
    const merged = await loadPackages(app, request);
    const current = merged.packages.find((item: any) => item.packageId === request.params.packageId);
    if (!current) return reply.code(404).send({ error: "xhs_package_not_found" });
    const job = current.jobs?.[0];
    if (!job) return { package: current };
    let refreshed = job;
    if (!["succeeded", "failed", "canceled"].includes(job.status)) {
      const result = await subrequest(app, request, "POST", `/lanqi/media/jobs/${job.id}/refresh`, {});
      if (result.statusCode >= 400 && !result.body.job) return reply.code(result.statusCode).send(result.body);
      refreshed = result.body.job ?? job;
    }
    if (refreshed.status === "succeeded" && !refreshed.savedAt) {
      await subrequest(app, request, "POST", `/lanqi/media/jobs/${refreshed.id}/assets/save`, {});
    }
    const next = await loadPackages(app, request);
    const packageResult = next.packages.find((item: any) => item.packageId === request.params.packageId) ?? current;
    if (packageResult.status === "succeeded") request.log.info({ event: "lanqi_xhs_package.succeeded", tenantId: context.tenantId, packageId: request.params.packageId, jobId: refreshed.id });
    return { package: packageResult };
  });

  app.post<{ Params: { packageId: string } }>("/lanqi/content-studio/packages/:packageId/cancel", async (request, reply) => {
    const context = await resolveRequestContext(request.headers);
    const merged = await loadPackages(app, request);
    const current = merged.packages.find((item: any) => item.packageId === request.params.packageId);
    if (!current) return reply.code(404).send({ error: "xhs_package_not_found" });
    const job = current.jobs?.find((item: any) => !["succeeded", "failed", "canceled"].includes(item.status));
    if (!job) return reply.code(409).send({ error: "package_not_cancelable", message: "当前没有可取消的图片任务。" });
    const canceled = await subrequest(app, request, "POST", `/lanqi/media/jobs/${job.id}/cancel`, {});
    if (canceled.statusCode >= 400) return reply.code(canceled.statusCode).send(canceled.body);
    request.log.info({ event: "lanqi_xhs_package.canceled", tenantId: context.tenantId, packageId: request.params.packageId, jobId: job.id });
    const next = await loadPackages(app, request);
    return { package: next.packages.find((item: any) => item.packageId === request.params.packageId) ?? current };
  });
}

async function runPackage(
  app: FastifyInstance,
  request: FastifyRequest,
  input: z.infer<typeof packageRequest>,
  quote: Awaited<ReturnType<typeof buildPackageQuote>>,
): Promise<{ statusCode: number; body: Record<string, any> }> {
  const context = await resolveRequestContext(request.headers);
  request.log.info({ event: "lanqi_xhs_package.requested", tenantId: context.tenantId, packageId: input.requestId, requestId: input.requestId });
  const draft = await subrequest(app, request, "POST", "/lanqi/content-studio/drafts", {
    request: input.request, audience: input.audience, goal: input.goal, requestKey: input.requestId,
  });
  if (draft.statusCode >= 400) {
    request.log.warn({ event: "lanqi_xhs_package.failed", tenantId: context.tenantId, packageId: input.requestId, stage: "copy" });
    return { statusCode: draft.statusCode, body: { error: draft.body.error ?? "content_generation_failed", message: publicMessage(draft.body, "文案没有生成成功，因此没有创建图片或扣图片积分。") } };
  }
  if (isCanceled(request)) return { statusCode: 499, body: { error: "package_canceled", message: "已取消；文案如果已保存可在刷新后恢复，图片没有创建。" } };
  request.log.info({ event: "lanqi_xhs_package.text_ready", tenantId: context.tenantId, packageId: input.requestId, draftId: draft.body.draft?.id });

  const copy = draft.body.draft?.copyDraft ?? {};
  const imageNeed = [
    input.request,
    `配套小红书标题：${String(copy.selectedTitle ?? copy.title ?? "").slice(0, 100)}`,
    `配套正文主题：${String(copy.body ?? "").replace(/\s+/g, " ").slice(0, 240)}`,
    input.allowPeople ? "允许出现经授权的不可冒充人物。" : "不出现人物或可识别顾客正脸。",
  ].filter(Boolean).join("\n");
  const preview = await subrequest(app, request, "POST", "/lanqi/image-studio/previews", {
    request: imageNeed, purpose: input.purpose, ratio: input.ratio, style: input.style,
    textMode: input.overlayTitle ? "title_space" : "no_text", rightsConfirmed: input.rightsConfirmed,
    requestKey: input.requestId,
  });
  if (preview.statusCode >= 400 || !preview.body.preview) {
    request.log.warn({ event: "lanqi_xhs_package.partial_success", tenantId: context.tenantId, packageId: input.requestId, stage: "image_prompt" });
    const restored = await loadPackages(app, request);
    const partial = restored.packages.find((item: any) => item.packageId === input.requestId);
    return { statusCode: 207, body: { package: { ...(partial ?? { packageId: input.requestId, draft: draft.body.draft }), status: "partial_success", imageError: publicMessage(preview.body, "图片准备失败，文案已保存。") }, idempotent: false } };
  }
  if (isCanceled(request)) return { statusCode: 499, body: { error: "package_canceled", message: "已取消；文案和提示词可在刷新后恢复，未创建付费图片任务。" } };
  const direction = selectedDirection(preview.body.preview);
  if (!direction) return { statusCode: 207, body: { package: { packageId: input.requestId, draft: draft.body.draft, preview: preview.body.preview, status: "partial_success", imageError: "专业图片提示词不可用，文案已保存。" } } };
  const media = await subrequest(app, request, "POST", "/lanqi/media/confirm", {
    kind: "image", previewId: preview.body.preview.id, promptVersion: preview.body.preview.enhancer.version,
    prompt: direction.positivePrompt, negativePrompt: direction.negativePrompt, ratio: preview.body.preview.ratio,
    requestKey: `${input.requestId}-image`, confirmed: true,
  });
  const restored = await loadPackages(app, request);
  const complete = restored.packages.find((item: any) => item.packageId === input.requestId) ?? {
    packageId: input.requestId, requestId: input.requestId, draft: draft.body.draft, preview: preview.body.preview, jobs: media.body.job ? [media.body.job] : [], quote,
  };
  if (media.statusCode >= 400) {
    request.log.warn({ event: "lanqi_xhs_package.partial_success", tenantId: context.tenantId, packageId: input.requestId, stage: "image_submit" });
    return { statusCode: 207, body: { package: { ...complete, status: "partial_success", imageError: publicMessage(media.body, "图片生成失败，文案已保留；未交付图片不会重复扣费。") }, idempotent: false } };
  }
  request.log.info({ event: "lanqi_xhs_package.image_requested", tenantId: context.tenantId, packageId: input.requestId, jobId: media.body.job?.id });
  return { statusCode: media.statusCode === 200 ? 200 : 202, body: { package: complete, idempotent: Boolean(media.body.idempotent) } };
}

async function buildPackageQuote(context: Awaited<ReturnType<typeof resolveRequestContext>>, settings: z.infer<typeof imageSettings>) {
  const input = { kind: "image" as const, prompt: "lanqi_xhs_package_quote", ratio: settings.ratio };
  const readiness = getLanqiMediaExecutionReadiness(input);
  const quoted = quoteLanqiMedia(input);
  const authorization = await resolveLanqiMediaAuthorization(context, readiness, quoted.creditCost);
  const quoteId = createHash("sha256").update([
    context.tenantId, context.userId, settings.purpose, settings.ratio, settings.style,
    quoted.creditCost, readiness.mode,
  ].join("|")).digest("hex").slice(0, 24);
  return {
    quoteId,
    imageCount: 1,
    estimatedCredits: quoted.creditCost,
    canConfirm: authorization.canConfirm,
    billable: authorization.canConfirm && readiness.billable,
    executionMode: readiness.mode,
    blockCode: authorization.blockCode,
    message: authorization.canConfirm
      ? readiness.mode === "mock" ? "受控模拟已就绪；本次不会调用图片 Provider 或扣积分。" : `本次生成 1 张图片，预计 ${quoted.creditCost} 积分；点击即确认本次报价。`
      : authorization.message,
  };
}

async function loadPackages(app: FastifyInstance, request: FastifyRequest): Promise<{ packages: any[]; historicalImages: any[] }> {
  const [draftsResult, previewsResult, jobsResult] = await Promise.all([
    subrequest(app, request, "GET", "/lanqi/content-studio/drafts"),
    subrequest(app, request, "GET", "/lanqi/image-studio/previews"),
    subrequest(app, request, "GET", "/lanqi/media/jobs"),
  ]);
  const drafts = Array.isArray(draftsResult.body.drafts) ? draftsResult.body.drafts : [];
  const previews = Array.isArray(previewsResult.body.previews) ? previewsResult.body.previews : [];
  const jobs = Array.isArray(jobsResult.body.jobs) ? jobsResult.body.jobs : [];
  const packages = drafts.map((draft: any) => {
    const packageId = packageIdFromDraft(draft.id);
    const preview = previews.find((item: any) => packageIdFromPreview(item.id) === packageId);
    const relatedJobs = preview ? jobs.filter((job: any) => job.previewId === preview.id) : [];
    const charged = relatedJobs.filter((job: any) => job.billingStatus === "charged").reduce((sum: number, job: any) => sum + Number(job.creditCost || 0), 0);
    const latestJob = relatedJobs[0];
    const status = latestJob?.status === "succeeded" ? "succeeded"
      : latestJob && ["failed", "canceled"].includes(latestJob.status) ? "partial_success"
      : latestJob ? "image_requested"
      : preview ? "text_ready"
      : "text_ready";
    return {
      packageId, requestId: packageId, status, draft, preview, jobs: relatedJobs,
      actualCredits: charged, createdAt: draft.createdAt, updatedAt: latestJob?.updatedAt ?? preview?.updatedAt ?? draft.updatedAt,
      imageError: status === "partial_success" ? latestJob?.errorMessage : undefined,
    };
  });
  const linkedPreviewIds = new Set(packages.map(item => item.preview?.id).filter(Boolean));
  const historicalImages = jobs.filter((job: any) => !linkedPreviewIds.has(job.previewId));
  return { packages, historicalImages };
}

async function subrequest(app: FastifyInstance, request: FastifyRequest, method: "GET" | "POST" | "PATCH", url: string, payload?: unknown): Promise<SubResponse> {
  const response = await app.inject({ method, url, headers: forwardedHeaders(request), ...(payload === undefined ? {} : { payload: payload as any }) } as any);
  let body: Record<string, any> = {};
  try { body = response.json() as Record<string, any>; } catch { body = {}; }
  return { statusCode: response.statusCode, body };
}

function forwardedHeaders(request: FastifyRequest): Record<string, string> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  for (const name of ["authorization", "x-sitong-tenant-id", "x-sitong-user-id", "x-sitong-role"]) {
    const value = request.headers[name];
    if (typeof value === "string") headers[name] = value;
  }
  return headers;
}

function packageIdFromDraft(id: string): string { return id.replace(/^lanqi-xhs-[a-f0-9]{12}-/, ""); }
function packageIdFromPreview(id: string): string { return id.replace(/^lanqi-image-[a-f0-9]{12}-/, ""); }
function selectedDirection(preview: any): any { return preview?.directions?.find((item: any) => item.id === preview.selectedDirectionId) ?? preview?.directions?.[0]; }
function settingsFromPreview(preview: any) { return { purpose: preview.purpose, ratio: preview.ratio, style: preview.style, allowPeople: false, overlayTitle: preview.textMode !== "no_text" }; }
function publicMessage(body: Record<string, any>, fallback: string): string { return typeof body.message === "string" ? body.message : fallback; }
function isCanceled(request: FastifyRequest): boolean { return Boolean(request.raw.aborted); }

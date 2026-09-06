import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { LlmProvider } from "@baolu/agent";
import { Prisma, prisma } from "@baolu/db";
import { env } from "../config/env.js";
import { resolveRequestContext, type RequestContext } from "../services/request-context.js";
import {
  buildLanqiImagePreview,
  buildLanqiImageSkillInput,
  dedupeLanqiImagePreviews,
  LANQI_IMAGE_PURPOSES,
  LANQI_IMAGE_RATIOS,
  LANQI_IMAGE_STYLES,
  LANQI_IMAGE_TEXT_MODES,
  sanitizeLanqiImagePreviewForDisplay,
  type LanqiImagePreview,
  selectLanqiImageDirection,
  validateLanqiImageBrief,
} from "../services/lanqi-image-studio.js";
import { invokeSkillViaGateway } from "../services/mcp-client.js";
import { assertLanqiProfessionalTextModel } from "../services/lanqi-runtime-model-policy.js";
import { createRequestExecutionScope } from "../services/request-execution-scope.js";
import { emptyLanqiStoreProfile, getDemoLanqiStoreProfile, toLanqiStoreProfileView, type LanqiStoreProfileFacts } from "../services/lanqi-store-profile.js";

const previewSchema = z.object({
  request: z.string().trim().min(2).max(1200),
  purpose: z.enum(LANQI_IMAGE_PURPOSES),
  ratio: z.enum(LANQI_IMAGE_RATIOS),
  style: z.enum(LANQI_IMAGE_STYLES),
  textMode: z.enum(LANQI_IMAGE_TEXT_MODES),
  overlayText: z.string().trim().max(40).optional(),
  rightsConfirmed: z.literal(true),
  requestKey: z.string().trim().regex(/^[A-Za-z0-9_-]{12,120}$/).optional(),
  basePreviewId: z.string().trim().regex(/^lanqi-image-[A-Za-z0-9_-]{12,160}$/).optional(),
  revisionInstruction: z.string().trim().max(300).optional(),
  intentUnderstanding: z.string().trim().max(500).optional(),
});

const selectionSchema = z.object({ directionId: z.string().trim().min(1).max(60) });

type StoredPreview = LanqiImagePreview & { tenantId: string };
type PreviewResult = { dataMode: "demo" | "database"; preview: LanqiImagePreview; idempotent: boolean };

const demoPreviews = new Map<string, StoredPreview[]>();
const inFlightPreviews = new Map<string, Promise<PreviewResult>>();

export async function registerLanqiImageStudioRoutes(app: FastifyInstance, provider: LlmProvider): Promise<void> {
  app.get("/lanqi/image-studio/previews", async request => {
    const context = await resolveRequestContext(request.headers);
    if (env.DATA_MODE === "demo") {
      return { dataMode: "demo", previews: dedupeLanqiImagePreviews((demoPreviews.get(context.tenantId) ?? []).map(toPublicPreview)) };
    }
    const drafts = await prisma.lanqiContentDraft.findMany({
      where: { tenantId: context.tenantId, platform: "lanqi_image_preview" },
      orderBy: { createdAt: "desc" },
      take: 30,
    });
    return { dataMode: "database", previews: dedupeLanqiImagePreviews(drafts.map(toPreviewFromDraft).filter((item): item is LanqiImagePreview => Boolean(item))) };
  });

  app.post<{ Body: z.infer<typeof previewSchema> }>("/lanqi/image-studio/previews", async (request, reply) => {
    const parsed = previewSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      const rightsIssue = parsed.error.issues.some(issue => issue.path[0] === "rightsConfirmed");
      return reply.code(rightsIssue ? 422 : 400).send({
        error: rightsIssue ? "rights_confirmation_required" : "invalid_image_preview_request",
        message: rightsIssue ? "请先确认本次文字、品牌和人物描述均有权使用。" : "图片需求填写不完整，请核对后重试。",
      });
    }
    const issue = validateLanqiImageBrief(parsed.data);
    if (issue) return reply.code(422).send({ error: "image_preview_needs_input", message: issue });
    const context = await resolveRequestContext(request.headers);
    const rawRequestKey = parsed.data.requestKey ?? String(request.headers["x-idempotency-key"] ?? randomUUID());
    if (!/^[A-Za-z0-9_-]{12,120}$/.test(rawRequestKey)) return reply.code(400).send({ error: "invalid_request_key" });
    const tenantKey = createHash("sha256").update(context.tenantId).digest("hex").slice(0, 12);
    const requestToken = rawRequestKey.replace(/^lanqi-image-/, "");
    const previewId = `lanqi-image-${tenantKey}-${requestToken}`;
    const runKey = `${context.tenantId}:${previewId}`;
    const existingRun = inFlightPreviews.get(runKey);
    const scope = existingRun ? undefined : createRequestExecutionScope({
      requestRaw: request.raw,
      replyRaw: reply.raw,
      timeoutMs: 90_000,
      timeoutCode: "image_preview_timed_out",
    });
    const run = existingRun ?? createPreview(context, provider, previewId, parsed.data, scope!.signal);
    if (!existingRun) inFlightPreviews.set(runKey, run);
    try {
      const result = await run;
      const idempotent = Boolean(existingRun) || result.idempotent;
      request.log.info({ event: "lanqi_image_preview.succeeded", tenantId: context.tenantId, runId: previewId, status: idempotent ? "restored" : "succeeded" });
      return { ...result, idempotent };
    } catch (error) {
      const abortCode = scope?.getAbortCode();
      if (abortCode === "image_preview_timed_out") {
        request.log.warn({ event: "lanqi_image_preview.timed_out", tenantId: context.tenantId, runId: previewId, status: "timed_out" });
        return reply.code(504).send({ error: "image_preview_timed_out", message: "专业提示词增强已超时，本次没有生成图片或扣图片积分；输入仍保留，可以重试。" });
      }
      request.log.error({ err: error, event: "lanqi_image_preview.failed", tenantId: context.tenantId, runId: previewId, status: "failed" }, "lanqi_image_preview_failed");
      return reply.code(503).send({ error: "image_preview_failed", message: "提示词预览暂时没有保存成功，输入已保留，请稍后重试。" });
    } finally {
      scope?.dispose();
      if (!existingRun && inFlightPreviews.get(runKey) === run) inFlightPreviews.delete(runKey);
    }
  });

  app.patch<{ Params: { previewId: string }; Body: z.infer<typeof selectionSchema> }>("/lanqi/image-studio/previews/:previewId/selection", async (request, reply) => {
    const parsed = selectionSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "invalid_direction_selection" });
    const context = await resolveRequestContext(request.headers);
    const current = await loadLanqiImagePreview(context, request.params.previewId);
    if (!current) return reply.code(404).send({ error: "image_preview_not_found" });
    const updated = selectLanqiImageDirection(current, parsed.data.directionId);
    if (!updated) return reply.code(422).send({ error: "unknown_image_direction", message: "这个视觉方向不存在，请刷新后重试。" });
    if (env.DATA_MODE === "demo") {
      const items = demoPreviews.get(context.tenantId) ?? [];
      demoPreviews.set(context.tenantId, items.map(item => item.id === updated.id ? { ...updated, tenantId: context.tenantId } : item));
      return { preview: updated };
    }
    await prisma.lanqiContentDraft.update({
      where: { id: updated.id },
      data: { copyDraft: updated as unknown as Prisma.InputJsonValue, imagePrompt: updated.promptPreview },
    });
    return { preview: updated };
  });
}

async function createPreview(
  context: RequestContext,
  provider: LlmProvider,
  previewId: string,
  brief: z.infer<typeof previewSchema>,
  signal: AbortSignal,
): Promise<PreviewResult> {
  if (env.DATA_MODE === "demo") {
    const existing = (demoPreviews.get(context.tenantId) ?? []).find(item => item.id === previewId);
    if (existing) return { dataMode: "demo", preview: toPublicPreview(existing), idempotent: true };
  } else {
    const existing = await prisma.lanqiContentDraft.findUnique({ where: { id: previewId } });
    if (existing) {
      if (existing.tenantId !== context.tenantId || existing.platform !== "lanqi_image_preview") throw new Error("request_key_conflict");
      const preview = toPreviewFromDraft(existing);
      if (!preview) throw new Error("invalid_saved_preview");
      return { dataMode: "database", preview, idempotent: true };
    }
  }

  const facts = await loadConfirmedStoreFacts(context);
  const previous = brief.basePreviewId ? await loadLanqiImagePreview(context, brief.basePreviewId) : undefined;
  if (brief.basePreviewId && !previous) throw new Error("base_preview_not_found");
  const modelPolicy = env.LANQI_MEDIA_EXECUTION_MODE === "mock" && env.NODE_ENV !== "production"
    ? undefined
    : assertLanqiProfessionalTextModel(provider);
  const skillResult = env.LANQI_MEDIA_EXECUTION_MODE === "mock" && env.NODE_ENV !== "production"
    ? { skillId: "lanqi-image-prompt-enhancer", answerText: "", source: "controlled_mock", reasoningProfile: "standard" as const }
    : await invokeSkillViaGateway({
      requestId: previewId,
      context,
      provider,
      agentId: "agent_store_acquisition",
      capabilityId: "image_prompt_preview",
      skillId: "lanqi-image-prompt-enhancer",
      input: buildLanqiImageSkillInput({ brief, facts, previous }),
      routingInput: `兰琪文生图提示词：${brief.request}`,
      capabilityLocked: true,
      deliveryPolicy: "draft_with_placeholders",
      skipEntitlement: true,
      persist: false,
      signal,
    });
  if (skillResult.skillId !== "lanqi-image-prompt-enhancer") throw new Error("unexpected_skill_result");
  const preview = buildLanqiImagePreview({ id: previewId, brief, facts, previous, enhancementAnswer: skillResult.answerText });
  if (env.DATA_MODE === "demo") {
    const stored: StoredPreview = { ...preview, tenantId: context.tenantId };
    demoPreviews.set(context.tenantId, [stored, ...(demoPreviews.get(context.tenantId) ?? [])].slice(0, 30));
    return { dataMode: "demo", preview, idempotent: false };
  }

  try {
    const saved = await prisma.lanqiContentDraft.create({
      data: {
        id: previewId,
        tenantId: context.tenantId,
        userId: context.userId,
        platform: "lanqi_image_preview",
        goal: preview.purpose,
        audience: preview.ratio,
        topic: preview.inputSummary,
        storeFacts: facts as Prisma.InputJsonValue,
        copyDraft: preview as unknown as Prisma.InputJsonValue,
        imagePrompt: preview.promptPreview,
        videoPrompt: "",
        sourceMode: preview.enhancer.source,
        status: "preview",
      },
    });
    await prisma.auditLog.create({
      data: {
        tenantId: context.tenantId,
        userId: context.userId,
        action: "lanqi_image_preview.succeeded",
        resource: "lanqi_content_draft",
        resourceId: saved.id,
        detail: JSON.stringify({ requiredCapability: preview.execution.requiredCapability, billable: false, knowledgeVersion: null, textModel: modelPolicy?.model ?? "controlled_draft", reasoningTag: skillResult.reasoningProfile === "deep" ? "reasoning_high" : "reasoning_standard" }),
      },
    });
    const restored = toPreviewFromDraft(saved);
    if (!restored) throw new Error("invalid_saved_preview");
    return { dataMode: "database", preview: restored, idempotent: false };
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") {
      const existing = await prisma.lanqiContentDraft.findUnique({ where: { id: previewId } });
      if (existing?.tenantId === context.tenantId && existing.platform === "lanqi_image_preview") {
        const preview = toPreviewFromDraft(existing);
        if (preview) return { dataMode: "database", preview, idempotent: true };
      }
    }
    throw error;
  }
}

export async function loadLanqiImagePreview(context: RequestContext, previewId: string): Promise<LanqiImagePreview | undefined> {
  if (env.DATA_MODE === "demo") {
    const stored = (demoPreviews.get(context.tenantId) ?? []).find(item => item.id === previewId);
    return stored ? toPublicPreview(stored) : undefined;
  }
  const record = await prisma.lanqiContentDraft.findFirst({ where: { id: previewId, tenantId: context.tenantId, platform: "lanqi_image_preview" } });
  return record ? toPreviewFromDraft(record) ?? undefined : undefined;
}

async function loadConfirmedStoreFacts(context: RequestContext): Promise<LanqiStoreProfileFacts> {
  if (env.DATA_MODE === "demo") {
    const saved = getDemoLanqiStoreProfile(context.tenantId);
    return saved ? toLanqiStoreProfileView(saved, context.role).confirmedFacts : emptyLanqiStoreProfile(context.role).confirmedFacts;
  }
  const profile = await prisma.lanqiStoreProfile.findUnique({ where: { tenantId: context.tenantId } });
  return profile ? toLanqiStoreProfileView(profile, context.role).confirmedFacts : {};
}

function toPublicPreview(preview: StoredPreview): LanqiImagePreview {
  const { tenantId: _tenantId, ...publicPreview } = preview;
  return publicPreview;
}

function toPreviewFromDraft(record: { copyDraft: unknown; createdAt: Date | string; updatedAt: Date | string }): LanqiImagePreview | null {
  if (!record.copyDraft || typeof record.copyDraft !== "object" || Array.isArray(record.copyDraft)) return null;
  const raw = record.copyDraft as LanqiImagePreview & { factSummary?: { storeName?: string; city?: string; mainServices?: string[] } };
  const preview = Array.isArray(raw.directions) && raw.directions.length >= 2
    ? raw
    : buildLanqiImagePreview({
      id: raw.id,
      brief: {
        request: raw.request,
        purpose: raw.purpose,
        ratio: raw.ratio,
        style: raw.style,
        textMode: raw.textMode,
        overlayText: raw.overlayText,
        rightsConfirmed: true,
      },
      facts: {
        storeName: raw.factSummary?.storeName,
        city: raw.factSummary?.city,
        mainServices: raw.factSummary?.mainServices ?? [],
      },
      now: toIso(record.createdAt),
    });
  if (preview.execution?.requiredCapability !== "media.image.generate" || preview.execution.status !== "preview_only") return null;
  return sanitizeLanqiImagePreviewForDisplay({
    ...preview,
    createdAt: toIso(record.createdAt),
    updatedAt: toIso(record.updatedAt),
  });
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

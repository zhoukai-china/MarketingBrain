import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { LlmProvider } from "@baolu/agent";
import { Prisma, prisma } from "@baolu/db";
import { env } from "../config/env.js";
import { resolveRequestContext, type RequestContext } from "../services/request-context.js";
import { buildLanqiContentDraftFromSkill, normalizeLanqiContentCopy, type LanqiContentCopy } from "../services/lanqi-content-studio.js";
import { invokeSkillViaGateway } from "../services/mcp-client.js";
import { assertLanqiProfessionalTextModel } from "../services/lanqi-runtime-model-policy.js";
import { createRequestExecutionScope } from "../services/request-execution-scope.js";
import { emptyLanqiStoreProfile, getDemoLanqiStoreProfile, toLanqiStoreProfileView, type LanqiStoreProfileFacts } from "../services/lanqi-store-profile.js";

const draftSchema = z.object({
  request: z.string().trim().min(2).max(1200).optional(),
  topic: z.string().trim().min(2).max(160).optional(),
  audience: z.string().trim().min(2).max(120).optional(),
  goal: z.string().trim().min(2).max(120).optional(),
  requestKey: z.string().trim().regex(/^[A-Za-z0-9_-]{12,120}$/).optional(),
}).refine(value => Boolean(value.request || value.topic), { message: "content_request_required", path: ["request"] });
const draftUpdateSchema = z.object({ selectedTitle: z.string().trim().min(1).max(80) });

type KnowledgeVersionState = {
  status: "not_loaded";
  knowledgeId: null;
  version: null;
  note: string;
};

type PublicDraft = {
  id: string;
  platform: "xiaohongshu";
  topic: string;
  audience: string;
  goal: string;
  copyDraft: LanqiContentCopy;
  sourceMode: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  knowledgeVersion: KnowledgeVersionState;
};

type DemoStoredDraft = PublicDraft & {
  tenantId: string;
  storeFacts: LanqiStoreProfileFacts;
  imagePrompt: string;
  videoPrompt: string;
};

type DraftRunResult = { dataMode: "demo" | "database"; draft: PublicDraft; idempotent: boolean };

const knowledgeVersion: KnowledgeVersionState = {
  status: "not_loaded",
  knowledgeId: null,
  version: null,
  note: "当前没有已审核并激活到本租户的兰琪专属知识版本；本稿只使用门店已确认资料。",
};
const demoDrafts = new Map<string, DemoStoredDraft[]>();
const inFlightDrafts = new Map<string, Promise<DraftRunResult>>();
const XHS_SKILL_VERSION = "1.0.0";

class ContentNeedsInputError extends Error {}

export async function registerLanqiContentStudioRoutes(app: FastifyInstance, provider: LlmProvider): Promise<void> {
  app.get("/lanqi/content-studio/drafts", async request => {
    const context = await resolveRequestContext(request.headers);
    if (env.DATA_MODE === "demo") {
      return { dataMode: "demo", drafts: (demoDrafts.get(context.tenantId) ?? []).map(toPublicDraft) };
    }
    const drafts = await prisma.lanqiContentDraft.findMany({
      where: { tenantId: context.tenantId, platform: "xiaohongshu" },
      orderBy: { createdAt: "desc" },
      take: 30,
    });
    return { dataMode: "database", drafts: drafts.map(toPublicDraft) };
  });

  app.post<{ Body: z.infer<typeof draftSchema> }>("/lanqi/content-studio/drafts", async (request, reply) => {
    const parsed = draftSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "invalid_content_request", details: parsed.error.flatten() });
    const context = await resolveRequestContext(request.headers);
    const requestText = (parsed.data.request ?? parsed.data.topic ?? "").trim();
    const rawRequestKey = parsed.data.requestKey ?? String(request.headers["x-idempotency-key"] ?? randomUUID());
    if (!/^[A-Za-z0-9_-]{12,120}$/.test(rawRequestKey)) {
      return reply.code(400).send({ error: "invalid_request_key" });
    }
    const tenantKey = createHash("sha256").update(context.tenantId).digest("hex").slice(0, 12);
    const requestToken = rawRequestKey.replace(/^lanqi-xhs-/, "");
    const draftId = `lanqi-xhs-${tenantKey}-${requestToken}`;
    const runKey = `${context.tenantId}:${draftId}`;
    request.log.info({
      event: "lanqi_xhs_copy.requested",
      tenantId: context.tenantId,
      runId: draftId,
      skillId: "xiaohongshu_ops",
      skillVersion: XHS_SKILL_VERSION,
      status: "requested",
    });
    if (needsMoreDetail(requestText)) {
      request.log.info({
        event: "lanqi_xhs_copy.needs_input",
        tenantId: context.tenantId,
        runId: draftId,
        skillId: "xiaohongshu_ops",
        skillVersion: XHS_SKILL_VERSION,
        status: "needs_input",
      });
      return reply.code(422).send({
        error: "content_needs_input",
        message: "你这篇小红书想写哪个服务、场景，或者顾客最常问的哪个问题？告诉我其中一个就可以。",
      });
    }
    const existingRun = inFlightDrafts.get(runKey);
    const scope = existingRun ? undefined : createRequestExecutionScope({
      requestRaw: request.raw,
      replyRaw: reply.raw,
      timeoutMs: 120_000,
      timeoutCode: "content_generation_timed_out",
    });
    const run = existingRun ?? createDraft({
      context,
      provider,
      draftId,
      requestText,
      audience: parsed.data.audience,
      goal: parsed.data.goal,
      signal: scope!.signal,
    });
    if (!existingRun) inFlightDrafts.set(runKey, run);
    try {
      const result = await run;
      const idempotent = Boolean(existingRun) || result.idempotent;
      request.log.info({
        event: "lanqi_xhs_copy.succeeded",
        tenantId: context.tenantId,
        runId: draftId,
        skillId: "xiaohongshu_ops",
        skillVersion: XHS_SKILL_VERSION,
        status: idempotent ? "restored" : "succeeded",
      });
      return { ...result, idempotent };
    } catch (error) {
      const abortCode = scope?.getAbortCode();
      if (abortCode === "content_generation_timed_out") {
        request.log.warn({
          event: "lanqi_xhs_copy.timed_out",
          tenantId: context.tenantId,
          runId: draftId,
          skillId: "xiaohongshu_ops",
          skillVersion: XHS_SKILL_VERSION,
          status: "timed_out",
        });
        return reply.code(504).send({
          error: "content_generation_timed_out",
          message: "文案生成已超时，本次没有创建图片或扣图片积分；输入仍保留，可以重试。",
        });
      }
      if (error instanceof ContentNeedsInputError) {
        request.log.info({
          event: "lanqi_xhs_copy.needs_input",
          tenantId: context.tenantId,
          runId: draftId,
          skillId: "xiaohongshu_ops",
          skillVersion: XHS_SKILL_VERSION,
          status: "needs_input",
        });
        return reply.code(422).send({ error: "content_needs_input", message: error.message });
      }
      request.log.error({
        err: error,
        event: "lanqi_xhs_copy.failed",
        tenantId: context.tenantId,
        runId: draftId,
        skillId: "xiaohongshu_ops",
        skillVersion: XHS_SKILL_VERSION,
        status: "failed",
      }, "lanqi_xhs_copy_failed");
      return reply.code(503).send({ error: "content_generation_failed", message: "文案暂时没有生成成功，输入已保留，请稍后重试。" });
    } finally {
      scope?.dispose();
      if (!existingRun && inFlightDrafts.get(runKey) === run) inFlightDrafts.delete(runKey);
    }
  });

  app.patch<{ Params: { draftId: string }; Body: z.infer<typeof draftUpdateSchema> }>("/lanqi/content-studio/drafts/:draftId", async (request, reply) => {
    const parsed = draftUpdateSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "invalid_draft_update" });
    const context = await resolveRequestContext(request.headers);
    if (env.DATA_MODE === "demo") {
      const drafts = demoDrafts.get(context.tenantId) ?? [];
      const draft = drafts.find(item => item.id === request.params.draftId);
      if (!draft) return reply.code(404).send({ error: "content_draft_not_found" });
      const copyDraft = normalizeLanqiContentCopy(draft.copyDraft);
      if (!copyDraft.titleCandidates.includes(parsed.data.selectedTitle)) return reply.code(409).send({ error: "title_candidate_mismatch" });
      draft.copyDraft = { ...copyDraft, title: parsed.data.selectedTitle, selectedTitle: parsed.data.selectedTitle };
      draft.updatedAt = new Date().toISOString();
      return { draft: toPublicDraft(draft) };
    }
    const existing = await prisma.lanqiContentDraft.findFirst({ where: { id: request.params.draftId, tenantId: context.tenantId, platform: "xiaohongshu" } });
    if (!existing) return reply.code(404).send({ error: "content_draft_not_found" });
    const copyDraft = normalizeLanqiContentCopy(existing.copyDraft);
    if (!copyDraft.titleCandidates.includes(parsed.data.selectedTitle)) return reply.code(409).send({ error: "title_candidate_mismatch" });
    const updated = await prisma.lanqiContentDraft.update({
      where: { id: existing.id },
      data: { copyDraft: { ...copyDraft, title: parsed.data.selectedTitle, selectedTitle: parsed.data.selectedTitle } as unknown as Prisma.InputJsonValue },
    });
    return { draft: toPublicDraft(updated) };
  });
}

async function createDraft(params: {
  context: RequestContext;
  provider: LlmProvider;
  draftId: string;
  requestText: string;
  audience?: string;
  goal?: string;
  signal: AbortSignal;
}): Promise<DraftRunResult> {
  const { context, provider, draftId, requestText } = params;
  if (env.DATA_MODE === "demo") {
    const existing = (demoDrafts.get(context.tenantId) ?? []).find(item => item.id === draftId);
    if (existing) return { dataMode: "demo", draft: toPublicDraft(existing), idempotent: true };
  } else {
    const existing = await prisma.lanqiContentDraft.findUnique({ where: { id: draftId } });
    if (existing) {
      if (existing.tenantId !== context.tenantId) throw new Error("request_key_conflict");
      return { dataMode: "database", draft: toPublicDraft(existing), idempotent: true };
    }
  }

  const facts = await loadConfirmedStoreFacts(context);
  const audience = params.audience ?? readFact(facts.customerProfile) ?? "目标客群待确认";
  const goal = params.goal ?? "生成一篇可审核的小红书文案";
  const brief = { topic: requestText.slice(0, 160), audience, goal };
  const skillInput = [
    "请只生成一篇兰琪美业门店的小红书文案，不生成图片、视频、直播话术、投流方案或发布动作。",
    `用户本轮需求：${requestText}`,
    `当前门店已确认资料：${JSON.stringify(facts)}`,
    `目标客群：${audience}`,
    `所在城市：${readFact(facts.city) ?? "待补"}`,
    `兰琪知识版本：${JSON.stringify(knowledgeVersion)}`,
    "固定输出：标题候选、正文、话题标签、互动与承接、发布前核对。",
    "没有已激活兰琪知识版本时，只能依据门店已确认资料创作，并明确未引用兰琪专属方法论或内部定价。",
    "未确认的服务、价格、优惠、疗效、案例、客户评价、平台数据和经营结果必须省略或标记待确认。",
  ].join("\n");
  const modelPolicy = assertLanqiProfessionalTextModel(provider);
  const skillResult = await invokeSkillViaGateway({
    requestId: draftId,
    context,
    provider,
    agentId: "agent_store_acquisition",
    capabilityId: "xiaohongshu_copy",
    skillId: "xiaohongshu_ops",
    input: skillInput,
    routingInput: `小红书文案：${requestText}`,
    capabilityLocked: true,
    deliveryPolicy: "draft_with_placeholders",
    skipEntitlement: true,
    persist: false,
    signal: params.signal,
  });
  if (skillResult.skillId !== "xiaohongshu_ops") throw new Error("unexpected_skill_result");
  if (skillResult.deliveryStatus === "needs_input") throw new ContentNeedsInputError(skillResult.answerText);
  if (skillResult.qualityFlags.includes("provider_fallback_used")) {
    throw new Error("professional_xiaohongshu_provider_unavailable");
  }

  const generated = buildLanqiContentDraftFromSkill(brief, facts, skillResult.answerText);
  const sourceMode = generated.sourceMode;
  const now = new Date().toISOString();
  const publicDraft: PublicDraft = {
    id: draftId,
    platform: "xiaohongshu",
    ...brief,
    copyDraft: generated.copyDraft,
    sourceMode,
    status: "draft",
    createdAt: now,
    updatedAt: now,
    knowledgeVersion,
  };

  if (env.DATA_MODE === "demo") {
    const stored: DemoStoredDraft = {
      ...publicDraft,
      tenantId: context.tenantId,
      storeFacts: facts,
      imagePrompt: "",
      videoPrompt: "",
    };
    demoDrafts.set(context.tenantId, [stored, ...(demoDrafts.get(context.tenantId) ?? [])].slice(0, 30));
    return { dataMode: "demo", draft: publicDraft, idempotent: false };
  }

  try {
    const draft = await prisma.lanqiContentDraft.create({
      data: {
        id: draftId,
        tenantId: context.tenantId,
        userId: context.userId,
        platform: "xiaohongshu",
        ...brief,
        storeFacts: facts as Prisma.InputJsonValue,
        copyDraft: generated.copyDraft as unknown as Prisma.InputJsonValue,
        imagePrompt: "",
        videoPrompt: "",
        sourceMode,
        status: "draft",
      },
    });
    await prisma.auditLog.create({
      data: {
        tenantId: context.tenantId,
        userId: context.userId,
        action: "lanqi_xhs_copy.succeeded",
        resource: "lanqi_content_draft",
        resourceId: draft.id,
        detail: JSON.stringify({ skillId: "xiaohongshu_ops", skillVersion: skillResult.skillVersion, knowledgeVersion: null, textModel: modelPolicy.model, reasoningTag: modelPolicy.reasoningTag, sourceMode }),
      },
    });
    return { dataMode: "database", draft: toPublicDraft(draft), idempotent: false };
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") {
      const existing = await prisma.lanqiContentDraft.findUnique({ where: { id: draftId } });
      if (existing?.tenantId === context.tenantId) {
        return { dataMode: "database", draft: toPublicDraft(existing), idempotent: true };
      }
    }
    throw error;
  }
}

async function loadConfirmedStoreFacts(context: RequestContext): Promise<LanqiStoreProfileFacts> {
  if (env.DATA_MODE === "demo") {
    const saved = getDemoLanqiStoreProfile(context.tenantId);
    return saved ? toLanqiStoreProfileView(saved, context.role).confirmedFacts : emptyLanqiStoreProfile(context.role).confirmedFacts;
  }
  const profile = await prisma.lanqiStoreProfile.findUnique({ where: { tenantId: context.tenantId } });
  return profile ? toLanqiStoreProfileView(profile, context.role).confirmedFacts : {};
}

function toPublicDraft(record: {
  id: string;
  platform: string;
  topic: string;
  audience: string;
  goal: string;
  copyDraft: unknown;
  sourceMode: string;
  status: string;
  createdAt: Date | string;
  updatedAt: Date | string;
}): PublicDraft {
  return {
    id: record.id,
    platform: "xiaohongshu",
    topic: record.topic,
    audience: record.audience,
    goal: record.goal,
    copyDraft: normalizeLanqiContentCopy(record.copyDraft),
    sourceMode: record.sourceMode,
    status: record.status,
    createdAt: toIso(record.createdAt),
    updatedAt: toIso(record.updatedAt),
    knowledgeVersion,
  };
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function readFact(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value.filter(Boolean).join("、") || undefined;
  return value?.trim() || undefined;
}

function needsMoreDetail(input: string): boolean {
  const normalized = input.replace(/[\s，。！？!?、]/g, "");
  if (normalized.length < 6) return true;
  return /^(?:帮我|给我|请帮我)?(?:写|发|做|生成)?(?:一篇|一个|条)?(?:小红书|笔记|文案|内容)?$/.test(normalized);
}

import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AgentRequest, LlmMessage, LlmProvider } from "@baolu/agent";
import { prisma } from "@baolu/db";
import { SKILL_MANIFESTS } from "@baolu/skills";
import type { SkillId } from "@baolu/shared";
import { env } from "../config/env.js";
import {
  BEAUTY_BUSINESS_QA_AGENT,
  BEAUTY_BUSINESS_QA_CAPABILITY,
  BEAUTY_BUSINESS_QA_SKILL,
  BEAUTY_BUSINESS_QA_SKILL_VERSION,
  BEAUTY_BUSINESS_QA_PROMPT,
  buildBeautyBusinessQaInput,
  createBeautyBusinessQaFingerprint
} from "../products/beauty-industry/business-qa.js";
import { resolveRequestContext, type RequestContext } from "../services/request-context.js";
import { emptyLanqiStoreProfile, getDemoLanqiStoreProfile, toLanqiStoreProfileView } from "../services/lanqi-store-profile.js";
import { invokeSkillViaGateway } from "../services/mcp-client.js";
import { IdempotencyConflictError, InsufficientCreditsError, persistChatResult } from "../services/chat-persistence.js";
import { releaseCreditReservation, reserveCreditsBeforeProvider } from "../services/credit-reservations.js";
import { createRequestExecutionScope } from "../services/request-execution-scope.js";
import { AgentAccessError, assertAgentAccess, getRuntimeAgent } from "../services/agent-runtime.js";
import {
  BEAUTY_TEXT_BUDGET_VERSION,
  createBeautyTextBudgetedProvider
} from "../products/beauty-industry/text-budget.js";

const askSchema = z.object({
  question: z.string().trim().min(2).max(1200),
  conversationId: z.string().trim().min(1).max(80).optional(),
  requestKey: z.string().trim().regex(/^[A-Za-z0-9_-]{12,120}$/),
  deviceScope: z.enum(["desktop", "mobile"]).default("desktop")
});

type PublicMessage = { id: string; role: "user" | "assistant"; content: string; createdAt: string };
type DemoConversation = { id: string; tenantId: string; title: string; createdAt: string; updatedAt: string; messages: PublicMessage[] };
export interface BeautyBusinessQaExecutionResult {
  status: "success";
  mode: "controlled_mock" | "real";
  conversationId?: string;
  agentRunId?: string;
  answer: string;
  skillVersion: string;
  creditCost: number;
  remainingCredits?: number;
  idempotent: boolean;
}
const demoConversations = new Map<string, DemoConversation[]>();
const demoRuns = new Map<string, { tenantId: string; fingerprint: string; conversationId: string; answer: string }>();
const inFlight = new Map<string, { fingerprint: string; promise: Promise<BeautyBusinessQaExecutionResult> }>();

export async function registerLanqiBusinessQaRoutes(app: FastifyInstance, provider: LlmProvider): Promise<void> {
  app.get("/lanqi/business-qa/conversations", async request => {
    const context = await resolveRequestContext(request.headers);
    await assertBusinessQaAccess(context, "lanqi");
    const mode = runtimeMode();
    if (context.source === "demo") return { dataMode: "demo", mode, conversations: listDemo(context.tenantId) };
    const conversations = await prisma.conversation.findMany({
      where: { tenantId: context.tenantId, agentId: BEAUTY_BUSINESS_QA_AGENT, agentRuns: { some: { capabilityId: BEAUTY_BUSINESS_QA_CAPABILITY } } },
      orderBy: { updatedAt: "desc" },
      take: 30,
      select: { id: true, title: true, createdAt: true, updatedAt: true, _count: { select: { messages: true } } }
    });
    return { dataMode: "database", mode, conversations };
  });

  app.get<{ Params: { conversationId: string } }>("/lanqi/business-qa/conversations/:conversationId", async (request, reply) => {
    const context = await resolveRequestContext(request.headers);
    await assertBusinessQaAccess(context, "lanqi");
    if (context.source === "demo") {
      const conversation = (demoConversations.get(context.tenantId) ?? []).find(item => item.id === request.params.conversationId);
      if (!conversation) return reply.code(404).send({ error: "conversation_not_found", message: "这条问答记录不存在或不属于当前门店。" });
      return { dataMode: "demo", mode: runtimeMode(), conversation };
    }
    const conversation = await prisma.conversation.findFirst({
      where: { id: request.params.conversationId, tenantId: context.tenantId, agentId: BEAUTY_BUSINESS_QA_AGENT, agentRuns: { some: { capabilityId: BEAUTY_BUSINESS_QA_CAPABILITY } } },
      include: { messages: { orderBy: { createdAt: "asc" }, select: { id: true, role: true, content: true, createdAt: true } } }
    });
    if (!conversation) return reply.code(404).send({ error: "conversation_not_found", message: "这条问答记录不存在或不属于当前门店。" });
    return { dataMode: "database", mode: runtimeMode(), conversation };
  });

  app.post<{ Body: z.infer<typeof askSchema> }>("/lanqi/business-qa/ask", async (request, reply) => {
    const parsed = askSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "invalid_question", message: "请填写至少 2 个字的经营问题。", details: parsed.error.flatten() });
    const context = await resolveRequestContext(request.headers);
    await assertBusinessQaAccess(context, "lanqi");
    if (parsed.data.conversationId && !(await ownsConversation(context, parsed.data.conversationId))) {
      return reply.code(404).send({ error: "conversation_not_found", message: "这条问答记录不存在或不属于当前门店。" });
    }
    const tenantToken = createHash("sha256").update(context.tenantId).digest("hex").slice(0, 12);
    const requestId = `lanqi-qa-${tenantToken}-${parsed.data.requestKey}`;
    const fingerprint = createBeautyBusinessQaFingerprint({ tenantId: context.tenantId, conversationId: parsed.data.conversationId, question: parsed.data.question });
    const runKey = `${context.tenantId}:${requestId}`;
    const existing = inFlight.get(runKey);
    if (existing) {
      if (existing.fingerprint !== fingerprint) return reply.code(409).send({ error: "request_id_conflict", message: "这次提交与原请求不一致，请重新发送。" });
      return { ...(await existing.promise), idempotent: true };
    }
    const scope = createRequestExecutionScope({ requestRaw: request.raw, replyRaw: reply.raw, timeoutMs: 45_000, timeoutCode: "business_qa_timed_out" });
    const run = executeBeautyBusinessQa({ context, provider, requestId, fingerprint, ...parsed.data, signal: scope.signal, channel: "web", operatingEntityId: context.tenantId })
      .finally(() => { inFlight.delete(runKey); scope.dispose(); });
    inFlight.set(runKey, { fingerprint, promise: run });
    try {
      return await run;
    } catch (error) {
      request.log.warn({ event: "lanqi_business_qa.failed", requestId, capabilityId: BEAUTY_BUSINESS_QA_CAPABILITY, skillId: BEAUTY_BUSINESS_QA_SKILL, errorCode: safeErrorCode(error) });
      if (error instanceof IdempotencyConflictError) return reply.code(409).send({ error: "request_id_conflict", message: "这次提交与原请求不一致，请重新发送。" });
      if (error instanceof InsufficientCreditsError) return reply.code(402).send({ error: "insufficient_credits", message: "当前积分不足，请补充后再提问。" });
      if (scope.getAbortCode() === "business_qa_timed_out") return reply.code(504).send({ error: "business_qa_timed_out", message: "本次回答超时，问题已保留，可以稍后重试。" });
      if (scope.signal.aborted) return reply.code(499).send({ error: "business_qa_cancelled", message: "本次回答已取消，问题没有丢失。" });
      return reply.code(502).send({ error: "business_qa_failed", message: "本次没有生成有效回答，未保存也未扣积分；请稍后重试。" });
    }
  });
}

export async function executeBeautyBusinessQa(params: {
  context: RequestContext; provider: LlmProvider; requestId: string; fingerprint: string; question: string;
  conversationId?: string; deviceScope: "desktop" | "mobile"; signal: AbortSignal;
  channel: "web" | "mcp"; operatingEntityId: string; credentialId?: string;
}): Promise<BeautyBusinessQaExecutionResult> {
  await assertBusinessQaAccess(params.context, params.channel === "mcp" ? "beauty-industry" : "lanqi");
  if (params.conversationId && !(await ownsConversation(params.context, params.conversationId))) {
    throw new Error("conversation_not_found");
  }
  const profile = params.context.source === "demo"
    ? (() => { const item = getDemoLanqiStoreProfile(params.context.tenantId); return item ? toLanqiStoreProfileView(item, params.context.role) : emptyLanqiStoreProfile(params.context.role); })()
    : (() => null)();
  const databaseProfile = params.context.source === "database" ? await prisma.lanqiStoreProfile.findUnique({ where: { tenantId: params.context.tenantId } }) : null;
  const profileView = profile ?? (databaseProfile ? toLanqiStoreProfileView(databaseProfile, params.context.role) : emptyLanqiStoreProfile(params.context.role));
  const input = buildBeautyBusinessQaInput({ question: params.question, confirmedFacts: profileView.confirmedFacts, needsInput: profileView.needsInput });
  const history = await loadBusinessQaHistory(params.context, params.conversationId);
  const controlledMock = process.env.LLM_MOCK_MODE === "true" || process.env.USE_MOCK_LLM === "true";
  const replay = await loadBusinessQaReplay(params.context, params.requestId, params.fingerprint);
  if (replay) return { status: "success", ...replay, skillVersion: BEAUTY_BUSINESS_QA_SKILL_VERSION, idempotent: true };

  if (controlledMock) {
    const result = await invokeBusinessQaSkill({ ...params, input, history, provider: params.provider });
    assertBusinessQaOutputContract(result);
    const persisted = await persistControlledMock(params, result.answerText, result.qualityFlags, result.mcpCallId);
    console.info(JSON.stringify({ event: "lanqi_business_qa.succeeded", requestId: params.requestId, capabilityId: BEAUTY_BUSINESS_QA_CAPABILITY, skillId: result.skillId, skillVersion: result.skillVersion, controlledMock: true, creditCost: 0 }));
    return { status: "success", mode: "controlled_mock", conversationId: persisted.conversationId, agentRunId: persisted.agentRunId, answer: result.answerText, skillVersion: result.skillVersion, creditCost: 0, idempotent: false };
  }

  const manifest = SKILL_MANIFESTS[BEAUTY_BUSINESS_QA_SKILL];
  const billingContext = {
    productCode: "beauty-industry",
    operatingEntityId: params.operatingEntityId,
    channel: params.channel,
    ...(params.credentialId ? { credentialId: params.credentialId } : {})
  };
  const reservation = await reserveCreditsBeforeProvider({
    context: params.context,
    billing: billingContext,
    requestId: params.requestId,
    requestFingerprint: params.fingerprint,
    capabilityId: BEAUTY_BUSINESS_QA_CAPABILITY,
    provider: params.provider.name,
    amount: manifest.baseCreditCost
  });
  try {
    const budgetedProvider = createBeautyTextBudgetedProvider(params.provider, BEAUTY_BUSINESS_QA_CAPABILITY, BEAUTY_BUSINESS_QA_SKILL);
    const result = await invokeBusinessQaSkill({ ...params, input, history, provider: createNoPaidRetryProvider(budgetedProvider) });
    if (result.providerFailure) throw new Error(`provider_failure:${result.providerFailure.code}`);
    assertBusinessQaOutputContract(result);
    const persisted = await persistChatResult({
      context: params.context,
      input,
      result: {
        skillId: result.skillId as SkillId,
        skillVersion: result.skillVersion,
        tenantType: params.context.profile.tenantType,
        answer: result.answerText,
        creditCost: result.creditCost,
        qualityFlags: result.qualityFlags,
        analysisMode: result.analysisMode,
        deliveryStatus: result.deliveryStatus === "needs_input" ? "needs_input" : "completed",
        analysisBrief: result.analysisBrief
      },
      provider: params.provider,
      channel: params.channel === "mcp" ? "workbuddy" : "h5",
      conversationId: params.conversationId,
      deviceScope: params.deviceScope,
      agentId: BEAUTY_BUSINESS_QA_AGENT,
      capabilityId: BEAUTY_BUSINESS_QA_CAPABILITY,
      requestId: params.requestId,
      requestFingerprint: params.fingerprint,
      mcpCallId: result.mcpCallId,
      billingContext,
      billingReservationId: reservation?.id,
      routingSource: "capability"
    });
    if (!persisted.agentRunId) throw new Error("business_qa_run_not_persisted");
    console.info(JSON.stringify({ event: "lanqi_business_qa.succeeded", requestId: params.requestId, capabilityId: BEAUTY_BUSINESS_QA_CAPABILITY, skillId: result.skillId, skillVersion: result.skillVersion, controlledMock: false, creditCost: result.creditCost }));
    return { status: "success", mode: "real", conversationId: persisted.conversationId, agentRunId: persisted.agentRunId, answer: result.answerText, skillVersion: result.skillVersion, creditCost: result.creditCost, remainingCredits: persisted.remainingCredits, idempotent: false };
  } catch (error) {
    await releaseCreditReservation(reservation?.id, safeErrorCode(error));
    throw error;
  }
}

function assertBusinessQaOutputContract(result: Awaited<ReturnType<typeof invokeBusinessQaSkill>>): void {
  const requiredTerms = ["先给结论", "今天先做", "可以直接使用", "仍需确认"];
  if (
    result.deliveryStatus !== "completed"
    || result.answerText.length < 220
    || requiredTerms.some(term => !result.answerText.includes(term))
    || result.qualityFlags.length > 0
  ) {
    console.warn(JSON.stringify({
      event: "lanqi_business_qa.output_contract_failed",
      capabilityId: BEAUTY_BUSINESS_QA_CAPABILITY,
      skillId: BEAUTY_BUSINESS_QA_SKILL,
      answerBytes: Buffer.byteLength(result.answerText, "utf8"),
      requiredHeadingCount: requiredTerms.filter(term => result.answerText.includes(term)).length,
      qualityFlags: result.qualityFlags.map(flag => String(flag).slice(0, 120)).slice(0, 12)
    }));
    throw new Error("business_qa_output_contract_failed");
  }
}

async function invokeBusinessQaSkill(params: {
  context: RequestContext; provider: LlmProvider; requestId: string; fingerprint: string; question: string;
  input: string; conversationId?: string; deviceScope: "desktop" | "mobile"; signal: AbortSignal;
  history: LlmMessage[];
  channel: "web" | "mcp"; operatingEntityId: string; credentialId?: string;
}) {
  return invokeSkillViaGateway({
    requestId: params.requestId,
    requestFingerprint: params.fingerprint,
    context: params.context,
    provider: params.provider,
    agentId: BEAUTY_BUSINESS_QA_AGENT,
    capabilityId: BEAUTY_BUSINESS_QA_CAPABILITY,
    skillId: BEAUTY_BUSINESS_QA_SKILL,
    skillVersionOverride: BEAUTY_BUSINESS_QA_SKILL_VERSION,
    skillPromptOverride: BEAUTY_BUSINESS_QA_PROMPT,
    input: params.input,
    history: params.history,
    routingInput: params.question,
    conversationId: undefined,
    channel: params.channel === "mcp" ? "workbuddy" : "h5",
    deviceScope: params.deviceScope,
    routingSource: "capability",
    capabilityLocked: true,
    promptCompositionPolicy: "locked_product_workflow",
    deliveryPolicy: "draft_with_placeholders",
    providerPolicyVersion: BEAUTY_TEXT_BUDGET_VERSION,
    skipEntitlement: true,
    persist: false,
    failClosedOnProviderFailure: true,
    signal: params.signal
  });
}

async function assertBusinessQaAccess(context: RequestContext, productCode: "lanqi" | "beauty-industry"): Promise<void> {
  if (context.source !== "database") return;
  const agent = await getRuntimeAgent(BEAUTY_BUSINESS_QA_AGENT);
  await assertAgentAccess(context, agent);
  const entitlement = await prisma.tenantProductEntitlement.findFirst({
    where: {
      tenantId: context.tenantId,
      productCode,
      status: "active",
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }]
    },
    select: { id: true }
  });
  if (!entitlement) throw new AgentAccessError("agent_not_entitled");
}

async function loadBusinessQaHistory(context: RequestContext, conversationId?: string): Promise<LlmMessage[]> {
  if (!conversationId) return [];
  if (context.source === "demo") {
    const conversation = (demoConversations.get(context.tenantId) ?? []).find(item => item.id === conversationId);
    return (conversation?.messages ?? []).slice(-8).map(item => ({ role: item.role, content: item.content }));
  }
  const messages = await prisma.message.findMany({
    where: {
      conversationId,
      tenantId: context.tenantId,
      conversation: {
        agentId: BEAUTY_BUSINESS_QA_AGENT,
        agentRuns: { some: { capabilityId: BEAUTY_BUSINESS_QA_CAPABILITY } }
      }
    },
    orderBy: { createdAt: "desc" },
    take: 8,
    select: { role: true, content: true }
  });
  return messages.reverse().flatMap(item => item.role === "user" || item.role === "assistant"
    ? [{ role: item.role, content: item.content }]
    : []);
}

function createNoPaidRetryProvider(provider: LlmProvider): LlmProvider {
  let completeCalls = 0;
  const extended = provider as LlmProvider & {
    getModel?: () => string;
    preflightAgentRequest?: (request: AgentRequest) => Promise<void>;
  };
  return {
    name: provider.name,
    getModel: extended.getModel?.bind(provider),
    preflightAgentRequest: extended.preflightAgentRequest?.bind(provider),
    async complete(messages, options) {
      if (completeCalls >= 1) throw new Error("paid_retry_forbidden");
      completeCalls += 1;
      return provider.complete(messages, options);
    }
  } as LlmProvider;
}

async function persistControlledMock(params: { context: RequestContext; requestId: string; fingerprint: string; question: string; conversationId?: string; deviceScope: "desktop" | "mobile"; channel: "web" | "mcp" }, answer: string, qualityFlags: string[], mcpCallId: string) {
  if (params.context.source === "demo") {
    const list = demoConversations.get(params.context.tenantId) ?? [];
    let conversation = params.conversationId ? list.find(item => item.id === params.conversationId) : undefined;
    if (!conversation) { const now = new Date().toISOString(); conversation = { id: `demo-qa-${randomUUID()}`, tenantId: params.context.tenantId, title: params.question.slice(0, 40), createdAt: now, updatedAt: now, messages: [] }; list.unshift(conversation); demoConversations.set(params.context.tenantId, list); }
    if (!conversation.messages.some(item => item.id === params.requestId)) {
      const now = new Date().toISOString(); conversation.messages.push({ id: params.requestId, role: "user", content: params.question, createdAt: now }, { id: `${params.requestId}-answer`, role: "assistant", content: answer, createdAt: now }); conversation.updatedAt = now;
    }
    demoRuns.set(params.requestId, { tenantId: params.context.tenantId, fingerprint: params.fingerprint, conversationId: conversation.id, answer });
    return { conversationId: conversation.id, agentRunId: params.requestId };
  }
  const existing = await prisma.agentRun.findUnique({ where: { requestId: params.requestId } });
  if (existing) {
    if (existing.tenantId !== params.context.tenantId || existing.requestFingerprint !== params.fingerprint) throw new IdempotencyConflictError();
    return { conversationId: existing.conversationId ?? undefined, agentRunId: existing.id };
  }
  return prisma.$transaction(async tx => {
    const owned = params.conversationId ? await tx.conversation.findFirst({ where: { id: params.conversationId, tenantId: params.context.tenantId, agentId: BEAUTY_BUSINESS_QA_AGENT } }) : null;
    const conversation = owned ?? await tx.conversation.create({ data: { tenantId: params.context.tenantId, agentId: BEAUTY_BUSINESS_QA_AGENT, channel: params.channel === "mcp" ? "workbuddy" : "h5", deviceScope: params.deviceScope, title: params.question.slice(0, 40) } });
    await tx.message.createMany({ data: [{ conversationId: conversation.id, tenantId: params.context.tenantId, userId: params.context.userId, role: "user", content: params.question }, { conversationId: conversation.id, tenantId: params.context.tenantId, role: "assistant", content: answer }] });
    await tx.conversation.update({ where: { id: conversation.id }, data: { updatedAt: new Date() } });
    const run = await tx.agentRun.create({ data: { tenantId: params.context.tenantId, userId: params.context.userId, conversationId: conversation.id, agentId: BEAUTY_BUSINESS_QA_AGENT, capabilityId: BEAUTY_BUSINESS_QA_CAPABILITY, requestId: params.requestId, requestFingerprint: params.fingerprint, mcpCallId, routingSource: "capability", deviceScope: params.deviceScope, skillId: BEAUTY_BUSINESS_QA_SKILL, skillVersion: BEAUTY_BUSINESS_QA_SKILL_VERSION, tenantType: params.context.profile.tenantType, status: "succeeded", input: params.question, output: answer, qualityFlags, modelProvider: "controlled_mock", productCode: "beauty-industry", usageChannel: params.channel, creditCost: 0 } });
    return { conversationId: conversation.id, agentRunId: run.id };
  });
}

async function loadBusinessQaReplay(context: RequestContext, requestId: string, fingerprint: string) {
  if (context.source === "demo") {
    const run = demoRuns.get(requestId);
    if (!run) return null;
    if (run.tenantId !== context.tenantId || run.fingerprint !== fingerprint) throw new IdempotencyConflictError();
    return { conversationId: run.conversationId, agentRunId: requestId, answer: run.answer, creditCost: 0, mode: "controlled_mock" as const };
  }
  const run = await prisma.agentRun.findUnique({ where: { requestId }, select: { id: true, tenantId: true, requestFingerprint: true, conversationId: true, output: true, creditCost: true, modelProvider: true } });
  if (!run) return null;
  if (run.tenantId !== context.tenantId || run.requestFingerprint !== fingerprint) throw new IdempotencyConflictError();
  if (!run.output) return null;
  const account = await prisma.creditAccount.findUnique({ where: { tenantId: context.tenantId }, select: { balance: true } });
  return { conversationId: run.conversationId ?? undefined, agentRunId: run.id, answer: run.output, creditCost: run.creditCost, remainingCredits: account?.balance, mode: run.modelProvider === "controlled_mock" ? "controlled_mock" as const : "real" as const };
}

async function ownsConversation(context: RequestContext, conversationId: string): Promise<boolean> {
  if (context.source === "demo") return (demoConversations.get(context.tenantId) ?? []).some(item => item.id === conversationId);
  return Boolean(await prisma.conversation.findFirst({ where: { id: conversationId, tenantId: context.tenantId, agentId: BEAUTY_BUSINESS_QA_AGENT, agentRuns: { some: { capabilityId: BEAUTY_BUSINESS_QA_CAPABILITY } } }, select: { id: true } }));
}

function listDemo(tenantId: string) { return (demoConversations.get(tenantId) ?? []).map(item => ({ id: item.id, title: item.title, createdAt: item.createdAt, updatedAt: item.updatedAt, _count: { messages: item.messages.length } })); }
function safeErrorCode(error: unknown): string { return error instanceof Error ? error.message.slice(0, 80).replace(/[^A-Za-z0-9_:-]/g, "_") : "unknown"; }
function runtimeMode(): "controlled_mock" | "real" { return process.env.LLM_MOCK_MODE === "true" || process.env.USE_MOCK_LLM === "true" ? "controlled_mock" : "real"; }

import { randomUUID } from "node:crypto";
import { runAgent, routeSkill, type AgentAnalysisBrief, type LlmMessage, type LlmProvider } from "@baolu/agent";
import { prisma } from "@baolu/db";
import {
  inferAcquisitionCapabilities,
  inferRestaurantCapabilities,
  inferSalesCapabilities,
  type AgentReasoningProfile,
  type DeviceScope,
  type SkillId,
  type StableAgentDelivery
} from "@baolu/shared";
import { SKILL_MANIFESTS } from "@baolu/skills";
import { IdempotencyConflictError, InsufficientCreditsError, persistChatResult, type ChatChannel } from "./chat-persistence.js";
import type { RequestContext } from "./request-context.js";
import { toAgentRequest } from "./demo-context.js";
import { AGENT_BY_ID, AGENT_BY_SLUG } from "./agent-definitions.js";
import { env } from "../config/env.js";
import { createRequestFingerprint } from "./request-fingerprint.js";
import { buildStableAgentDelivery, resolveReasoningProfile } from "./structured-delivery.js";

export class AgentAccessError extends Error {
  constructor(public code: "agent_not_found" | "agent_not_entitled" | "agent_member_access_denied" | "skill_not_allowed") {
    super(code);
  }
}

export class AgentClarificationRequired extends Error {
  constructor(public prompt: string) {
    super("clarification_required");
  }
}

export interface RuntimeCapability {
  id?: string;
  key: string;
  title: string;
  subtitle: string;
  promptTemplate?: string | null;
  skillId: string;
  skillVersion: string;
  skillPrompt?: string;
  sortOrder: number;
}

export interface RuntimeAgent {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon?: string | null;
  status: string;
  sortOrder: number;
  marketing?: {
    [key: string]: unknown;
    knowledgeAction?: RuntimeKnowledgeAction;
    automationAction?: RuntimeAutomationAction;
  };
  capabilities: RuntimeCapability[];
  allowedSkills: Array<{ skillId: string; version: string; prompt?: string; isDefault: boolean }>;
}

export interface RuntimeKnowledgeAction {
  enabled: boolean;
  buttonLabel: string;
  defaultInstruction: string;
  allowedDocumentTypes: string[];
  capabilityId?: string;
}

export interface RuntimeAutomationAction {
  enabled: boolean;
  buttonLabel: string;
  defaultTaskType: string;
  defaultInstruction: string;
  allowedTaskTypes: string[];
  capabilityId?: string;
}

export interface SkillRuntimeResult {
  status: "success";
  deliveryStatus: "completed" | "needs_input";
  mcpCallId: string;
  agentRunId?: string;
  conversationId?: string;
  channel?: ChatChannel;
  deviceScope?: DeviceScope;
  agentId: string;
  skillId: string;
  skillIds?: string[];
  capabilityId?: string;
  skillVersion: string;
  answerText: string;
  structuredBlocks: Array<{ type: "markdown"; content: string }>;
  nextActions: string[];
  artifacts: Array<{ type: string; id: string; label: string }>;
  creditCost: number;
  remainingCredits?: number;
  qualityFlags: string[];
  analysisMode: "fast" | "deep";
  reasoningProfile: AgentReasoningProfile;
  stableDelivery?: StableAgentDelivery;
  analysisBrief?: AgentAnalysisBrief;
  traceId: string;
  execution?: {
    steps: Array<{
      stepId: string;
      capabilityId?: string;
      skillId: string;
      skillVersion: string;
      status: "success" | "needs_input" | "failed";
      durationMs: number;
      qualityFlags: string[];
      error?: { code: string; retryable: boolean };
    }>;
  };
  idempotentReplay?: boolean;
}

export async function listRuntimeAgents(): Promise<RuntimeAgent[]> {
  if (env.DATA_MODE === "database") {
    try {
      const records = await prisma.agentDefinition.findMany({
        where: { status: { in: ["active", "coming_soon"] } },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        include: {
          capabilities: {
            where: { isActive: true },
            orderBy: { sortOrder: "asc" },
            include: { skillRelease: true }
          },
          skillBindings: { include: { skillRelease: true } }
        }
      });
      return records.map(mapDatabaseAgent);
    } catch (error) {
      if (env.NODE_ENV === "production") throw error;
      // Pre-migration development falls back to the checked-in catalog.
    }
  }
  return [...AGENT_BY_ID.values()].map(mapSeedAgent);
}

export async function getRuntimeAgent(idOrSlug: string): Promise<RuntimeAgent> {
  if (env.DATA_MODE === "database") try {
    const record = await prisma.agentDefinition.findFirst({
      where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
      include: {
        capabilities: {
          where: { isActive: true },
          orderBy: { sortOrder: "asc" },
          include: { skillRelease: true }
        },
        skillBindings: { include: { skillRelease: true } }
      }
    });
    if (record) return mapDatabaseAgent(record);
  } catch (error) {
    if (env.NODE_ENV === "production") throw error;
    // Demo mode and pre-migration development use the checked-in catalog.
  }
  const seed = AGENT_BY_ID.get(idOrSlug) ?? AGENT_BY_SLUG.get(idOrSlug);
  if (!seed) throw new AgentAccessError("agent_not_found");
  return mapSeedAgent(seed);
}

export async function assertAgentAccess(context: RequestContext, agent: RuntimeAgent): Promise<void> {
  if (context.source !== "database") return;
  const now = new Date();
  const entitlement = await prisma.tenantAgentEntitlement.findFirst({
    where: {
      tenantId: context.tenantId,
      agentId: agent.id,
      status: "active",
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }]
    }
  });
  if (!entitlement) throw new AgentAccessError("agent_not_entitled");

  const membership = await prisma.membership.findFirst({
    where: { tenantId: context.tenantId, userId: context.userId, isActive: true },
    include: { agentAccess: { where: { agentId: agent.id } } }
  });
  if (!membership) throw new AgentAccessError("agent_member_access_denied");
  if (membership.role === "owner" || membership.role === "admin") return;
  if (membership.agentAccess.length === 0) throw new AgentAccessError("agent_member_access_denied");
}

export async function invokeSkillThroughMcp(params: {
  requestId: string;
  requestFingerprint?: string;
  context: RequestContext;
  provider: LlmProvider;
  agentId: string;
  capabilityId?: string;
  skillId?: string;
  input: string;
  routingInput?: string;
  conversationId?: string;
  channel?: ChatChannel;
  deviceScope?: DeviceScope;
  history?: LlmMessage[];
  routingSource?: "capability" | "agent_router" | "legacy";
  capabilityLocked?: boolean;
  deliveryPolicy?: "clarify" | "draft_with_placeholders";
  skipEntitlement?: boolean;
  persist?: boolean;
  signal?: AbortSignal;
}): Promise<SkillRuntimeResult> {
  const agent = await getRuntimeAgent(params.agentId);
  if (agent.status !== "active") throw new AgentAccessError("agent_not_entitled");
  if (!params.skipEntitlement) await assertAgentAccess(params.context, agent);

  const requestFingerprint = params.requestFingerprint ?? createRequestFingerprint({
    agentId: params.agentId,
    capabilityId: params.capabilityId,
    skillId: params.skillId,
    input: params.input,
    routingInput: params.routingInput,
    conversationId: params.conversationId,
    channel: params.channel ?? "h5",
    deviceScope: params.deviceScope ?? "desktop",
    history: params.history,
    capabilityLocked: params.capabilityLocked,
    deliveryPolicy: params.deliveryPolicy
  });
  const replay = await loadAgentRunReplay(params.context, agent, params.requestId, requestFingerprint);
  if (replay) return replay;

  const selection = selectSkill(
    agent,
    params.routingInput ?? params.input,
    params.capabilityId,
    params.skillId,
    params.capabilityLocked
  );
  const mcpCallId = randomUUID();
  const persistedHistory = await loadConversationHistory({
    context: params.context,
    conversationId: params.conversationId,
    agentId: agent.id,
    deviceScope: params.deviceScope ?? "desktop"
  });
  const agentRequest = toAgentRequest({
      auth: params.context,
      input: params.input,
      routingInput: params.routingInput,
      requestedSkillId: selection.skillId as SkillId,
      capabilityId: selection.capabilityId,
      capabilityLocked: params.capabilityLocked,
      deliveryPolicy: params.deliveryPolicy,
      skillPrompt: selection.prompt,
      skillVersionOverride: selection.version,
      history: persistedHistory.length > 0 ? persistedHistory : params.context.source === "database" ? [] : params.history,
      channel: params.channel ?? "h5"
    });
  agentRequest.signal = params.signal;
  const rawResult = await runAgent(agentRequest, params.provider);
  const result = agent.slug === "acquisition"
    ? ensureAcquisitionSubjectAnchor(rawResult, params.input)
    : rawResult;
  const deliveryStatus: SkillRuntimeResult["deliveryStatus"] = result.deliveryStatus === "needs_input"
    || (!result.deliveryStatus && result.qualityFlags.some((flag) => /clarification_(?:used|fast_path)|_clarification_used/.test(flag)))
      ? "needs_input"
      : "completed";
  const persistedResult = deliveryStatus === "needs_input" && result.creditCost !== 0
    ? { ...result, creditCost: 0 }
    : result;
  const reasoningProfile = resolveReasoningProfile(selection.capabilityId, result.skillId);
  const stableDelivery = buildStableAgentDelivery({
    capabilityId: selection.capabilityId,
    answerText: result.answer
  });

  const persistence = params.persist === false
    ? { persisted: false, deviceScope: (params.deviceScope ?? "desktop") as DeviceScope, remainingCredits: params.context.creditBalance }
    : await persistChatResult({
        context: params.context,
        input: params.input,
        result: persistedResult,
        provider: params.provider,
        channel: params.channel,
        conversationId: params.conversationId,
        deviceScope: params.deviceScope,
        agentId: agent.id,
        capabilityId: selection.capabilityId,
        requestId: params.requestId,
        requestFingerprint,
        mcpCallId,
        routingSource: params.routingSource ?? (selection.capabilityId ? "capability" : "agent_router")
      });

  return {
    status: "success",
    deliveryStatus,
    mcpCallId,
    agentRunId: persistence.agentRunId,
    conversationId: persistence.conversationId,
    deviceScope: persistence.deviceScope,
    agentId: agent.id,
    skillId: result.skillId,
    capabilityId: selection.capabilityId,
    skillVersion: result.skillVersion,
    answerText: result.answer,
    structuredBlocks: [{ type: "markdown", content: result.answer }],
    nextActions: buildNextActions(agent.slug, selection.capabilityId),
    artifacts: [],
    creditCost: persistedResult.creditCost,
    remainingCredits: persistence.remainingCredits,
    qualityFlags: result.qualityFlags,
    analysisMode: result.analysisMode,
    reasoningProfile,
    stableDelivery,
    analysisBrief: result.analysisBrief,
    traceId: params.requestId
  };
}

export async function loadAgentRunReplay(
  context: RequestContext,
  agent: RuntimeAgent,
  requestId: string,
  requestFingerprint?: string
): Promise<SkillRuntimeResult | null> {
  if (context.source !== "database") return null;
  const replay = await prisma.agentRun.findUnique({
    where: { requestId },
    include: { steps: { orderBy: { sortOrder: "asc" } } }
  });
  if (!replay) return null;
  if (
    replay.tenantId !== context.tenantId
    || replay.agentId !== agent.id
    || (requestFingerprint && replay.requestFingerprint && replay.requestFingerprint !== requestFingerprint)
  ) throw new IdempotencyConflictError();
  if (!replay.output) return null;
  const account = await prisma.creditAccount.findUnique({ where: { tenantId: context.tenantId } });
  const steps = replay.steps.map((step: any) => ({
    stepId: step.stepId,
    capabilityId: step.capabilityId ?? undefined,
    skillId: step.skillId,
    skillVersion: step.skillVersion,
    status: step.status === "succeeded"
      ? "success" as const
      : step.status === "needs_input"
        ? "needs_input" as const
        : "failed" as const,
    durationMs: step.durationMs,
    qualityFlags: normalizeStringArray(step.qualityFlags),
    ...(step.errorCode ? { error: { code: step.errorCode, retryable: /mcp_|timeout|timed_out|service_unavailable|ECONN|fetch failed/i.test(step.errorCode) } } : {})
  }));
  const reasoningProfile = resolveReasoningProfile(replay.capabilityId ?? undefined, replay.skillId);
  const stableDelivery = buildStableAgentDelivery({
    capabilityId: replay.capabilityId ?? undefined,
    answerText: replay.output
  });
  return {
    status: "success",
    deliveryStatus: replay.status === "needs_input" ? "needs_input" : "completed",
    mcpCallId: replay.mcpCallId ?? `replay:${replay.id}`,
    agentRunId: replay.id,
    conversationId: replay.conversationId ?? undefined,
    deviceScope: replay.deviceScope === "mobile" ? "mobile" : "desktop",
    agentId: replay.agentId ?? agent.id,
    skillId: replay.skillId,
    skillIds: steps.length > 0 ? steps.filter((step: any) => step.status === "success").map((step: any) => step.skillId) : undefined,
    skillVersion: replay.skillVersion,
    answerText: replay.output,
    structuredBlocks: [{ type: "markdown", content: replay.output }],
    nextActions: [],
    artifacts: [],
    creditCost: replay.creditCost,
    remainingCredits: account?.balance,
    qualityFlags: normalizeStringArray(replay.qualityFlags),
    analysisMode: "fast",
    reasoningProfile,
    stableDelivery,
    traceId: requestId,
    execution: steps.length > 0 ? { steps } : undefined,
    idempotentReplay: true
  };
}

export function isInsufficientCredits(error: unknown): boolean {
  return error instanceof InsufficientCreditsError;
}

function ensureAcquisitionSubjectAnchor<T extends { answer: string; qualityFlags: string[] }>(result: T, input: string): T {
  const subject = extractExplicitBusinessSubject(input);
  if (!subject || result.answer.includes(subject)) return result;
  return {
    ...result,
    answer: `> 本次内容主体：${subject}\n\n${result.answer}`,
    qualityFlags: [...result.qualityFlags, "fact_anchor_inserted"]
  };
}

function extractExplicitBusinessSubject(input: string): string | undefined {
  const normalized = input.replace(/【[^】]{1,80}】[^\n]*\n?/g, " ").replace(/\s+/g, " ");
  const match = normalized.match(/(?:给|为|针对)\s*([\u4e00-\u9fffA-Za-z0-9·]{2,20})(?:做|写|制定|生成|规划)|([\u4e00-\u9fffA-Za-z0-9·]{2,20})是(?:一家|[^。；\n]{0,12}(?:餐饮|品牌|连锁|门店|公司|店))/);
  return (match?.[1] ?? match?.[2])?.trim();
}

function selectSkill(
  agent: RuntimeAgent,
  input: string,
  capabilityId?: string,
  explicitSkillId?: string,
  capabilityLocked = false
) {
  if (capabilityLocked && capabilityId) {
    const capability = agent.capabilities.find((item) => item.key === capabilityId);
    if (!capability) throw new AgentAccessError("skill_not_allowed");
    if (explicitSkillId && explicitSkillId !== capability.skillId) throw new AgentAccessError("skill_not_allowed");
    return {
      skillId: capability.skillId,
      version: capability.skillVersion,
      prompt: capability.skillPrompt,
      capabilityId: capability.key
    };
  }
  const inferredCapabilityId = inferAgentCapability(agent, input);
  const inferredCapability = inferredCapabilityId
    ? agent.capabilities.find((item) => item.key === inferredCapabilityId)
    : undefined;
  const compatibleInferredCapabilityId = inferredCapability && (!explicitSkillId || inferredCapability.skillId === explicitSkillId)
    ? inferredCapabilityId
    : undefined;
  const affirmedCapabilityId = capabilityId && matchesCapabilityIntent(capabilityId, input)
    ? capabilityId
    : undefined;
  // A clear intent in the current message must beat a stale capability card selected in the UI.
  // A user-selected Skill is deliberate and therefore beats automatic semantic routing.
  // If there is no explicit Skill, a clear current intent still beats stale UI context.
  const resolvedCapabilityId = compatibleInferredCapabilityId ?? affirmedCapabilityId ?? capabilityId;
  if (resolvedCapabilityId) {
    const capability = agent.capabilities.find((item) => item.key === resolvedCapabilityId);
    if (!capability) throw new AgentAccessError("skill_not_allowed");
    if (explicitSkillId && explicitSkillId !== capability.skillId) throw new AgentAccessError("skill_not_allowed");
    return { skillId: capability.skillId, version: capability.skillVersion, prompt: capability.skillPrompt, capabilityId: capability.key };
  }

  const routed = explicitSkillId ?? routeSkill(input);
  const binding = agent.allowedSkills.find((item) => item.skillId === routed);
  if (binding) return { skillId: binding.skillId, version: binding.version, prompt: binding.prompt, capabilityId: undefined };
  if (routed === "general_qa") {
    throw new AgentClarificationRequired(
      agent.slug === "sales"
        ? "请告诉我：你想诊断客户、回复异议、制定跟单计划，还是复盘销售漏斗？"
        : agent.slug === "restaurant-growth"
          ? "请告诉我：你想提升外卖订单、堂食到店、连锁门店经营，还是餐饮招商加盟？"
        : "请告诉我：你想看行业热点、做内容、复盘视频，还是设计直播/私域方案？"
    );
  }
  throw new AgentAccessError("skill_not_allowed");
}

function matchesCapabilityIntent(capabilityId: string, input: string): boolean {
  return (
    inferAcquisitionCapabilities(input).includes(capabilityId as ReturnType<typeof inferAcquisitionCapabilities>[number])
    || inferRestaurantCapabilities(input).includes(capabilityId as ReturnType<typeof inferRestaurantCapabilities>[number])
    || inferSalesCapabilities(input).includes(capabilityId as ReturnType<typeof inferSalesCapabilities>[number])
  );
}

function inferAgentCapability(agent: RuntimeAgent, input: string): string | undefined {
  const inferred = agent.slug === "acquisition"
    ? inferAcquisitionCapabilities(input)
    : agent.slug === "restaurant-growth"
      ? inferRestaurantCapabilities(input)
    : agent.slug === "sales"
      ? inferSalesCapabilities(input)
      : [];
  return inferred.find((key) => agent.capabilities.some((item) => item.key === key));
}

function mapDatabaseAgent(record: any): RuntimeAgent {
  return {
    id: record.id,
    slug: record.slug,
    name: record.name,
    description: record.description,
    icon: record.icon,
    status: record.status,
    sortOrder: record.sortOrder,
    marketing: normalizeAgentMarketing(record.marketing),
    capabilities: record.capabilities.map((capability: any) => ({
      id: capability.id,
      key: capability.key,
      title: capability.title,
      subtitle: capability.subtitle,
      promptTemplate: capability.promptTemplate,
      skillId: capability.skillRelease.skillId,
      skillVersion: capability.skillRelease.version,
      skillPrompt: readPromptSnapshot(capability.skillRelease.packageSnapshot),
      sortOrder: capability.sortOrder
    })),
    allowedSkills: record.skillBindings.map((binding: any) => ({
      skillId: binding.skillRelease.skillId,
      version: binding.skillRelease.version,
      prompt: readPromptSnapshot(binding.skillRelease.packageSnapshot),
      isDefault: binding.isDefault
    }))
  };
}

function normalizeAgentMarketing(value: unknown): RuntimeAgent["marketing"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const marketing = value as Record<string, unknown>;
  const rawKnowledgeAction = marketing.knowledgeAction;
  const rawAutomationAction = marketing.automationAction;
  const knowledgeAction = rawKnowledgeAction && typeof rawKnowledgeAction === "object" && !Array.isArray(rawKnowledgeAction)
    ? rawKnowledgeAction as Record<string, unknown>
    : undefined;
  const automationAction = rawAutomationAction && typeof rawAutomationAction === "object" && !Array.isArray(rawAutomationAction)
    ? rawAutomationAction as Record<string, unknown>
    : undefined;
  const allowedDocumentTypes = Array.isArray(knowledgeAction?.allowedDocumentTypes)
    ? knowledgeAction.allowedDocumentTypes.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
  const allowedTaskTypes = Array.isArray(automationAction?.allowedTaskTypes)
    ? automationAction.allowedTaskTypes.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
  return {
    ...marketing,
    ...(knowledgeAction ? {
      knowledgeAction: {
        enabled: knowledgeAction.enabled !== false,
        buttonLabel: typeof knowledgeAction.buttonLabel === "string" && knowledgeAction.buttonLabel.trim() ? knowledgeAction.buttonLabel.trim() : "使用这些资料分析",
        defaultInstruction: typeof knowledgeAction.defaultInstruction === "string" ? knowledgeAction.defaultInstruction.trim() : "请根据选中的企业知识资料完成本智能体职责范围内的分析。",
        allowedDocumentTypes,
        capabilityId: typeof knowledgeAction.capabilityId === "string" && knowledgeAction.capabilityId.trim() ? knowledgeAction.capabilityId.trim() : undefined
      }
    } : {}),
    ...(automationAction ? {
      automationAction: {
        enabled: automationAction.enabled !== false,
        buttonLabel: typeof automationAction.buttonLabel === "string" && automationAction.buttonLabel.trim() ? automationAction.buttonLabel.trim() : "设置自动化",
        defaultTaskType: typeof automationAction.defaultTaskType === "string" ? automationAction.defaultTaskType.trim() : "daily_business_advice",
        defaultInstruction: typeof automationAction.defaultInstruction === "string" ? automationAction.defaultInstruction.trim() : "请按设定周期完成当前智能体职责范围内的任务。",
        allowedTaskTypes,
        capabilityId: typeof automationAction.capabilityId === "string" && automationAction.capabilityId.trim() ? automationAction.capabilityId.trim() : undefined
      }
    } : {})
  };
}

function mapSeedAgent(seed: (typeof AGENT_BY_ID extends Map<any, infer V> ? V : never)): RuntimeAgent {
  return {
    id: seed.id,
    slug: seed.slug,
    name: seed.name,
    description: seed.description,
    icon: seed.icon,
    status: seed.status,
    sortOrder: seed.sortOrder,
    marketing: normalizeAgentMarketing(seed.marketing),
    capabilities: seed.capabilities.map((capability, index) => ({
      key: capability.key,
      title: capability.title,
      subtitle: capability.subtitle,
      promptTemplate: capability.promptTemplate,
      skillId: capability.skillId,
      skillVersion: SKILL_MANIFESTS[capability.skillId as keyof typeof SKILL_MANIFESTS]?.version ?? "1.0.0",
      sortOrder: index * 10
    })),
    allowedSkills: [...new Set(seed.capabilities.map((item) => item.skillId))].map((skillId) => ({
      skillId,
      version: SKILL_MANIFESTS[skillId as keyof typeof SKILL_MANIFESTS]?.version ?? "1.0.0",
      isDefault: skillId === seed.defaultSkillId
    }))
  };
}

function readPromptSnapshot(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const prompt = (value as Record<string, unknown>).prompt;
  return typeof prompt === "string" ? prompt : undefined;
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

async function loadConversationHistory(params: {
  context: RequestContext;
  conversationId?: string;
  agentId: string;
  deviceScope: DeviceScope;
}): Promise<LlmMessage[]> {
  if (params.context.source !== "database" || !params.conversationId) return [];
  const conversation = await prisma.conversation.findFirst({
    where: {
      id: params.conversationId,
      tenantId: params.context.tenantId,
      agentId: params.agentId,
      deviceScope: params.deviceScope
    },
    select: { id: true }
  });
  if (!conversation) return [];
  const messages = await prisma.message.findMany({
    where: { conversationId: conversation.id, tenantId: params.context.tenantId },
    orderBy: { createdAt: "desc" },
    take: 12,
    select: { role: true, content: true }
  });
  return messages.reverse().flatMap((message): LlmMessage[] => {
    if (message.role !== "user" && message.role !== "assistant") return [];
    return [{ role: message.role, content: message.content }];
  });
}

function buildNextActions(agentSlug: string, capabilityId?: string): string[] {
  if (agentSlug === "ceo-cockpit") {
    if (capabilityId === "decision_center") return ["把已批准事项生成行动令", "补充决策所需证据"];
    if (capabilityId === "command_center") return ["回传执行结果", "查看待审批行动令"];
    if (capabilityId === "business_map") return ["下钻一个异常", "补充缺失经营数据"];
    return ["查看待老板决策事项", "补充缺失经营数据"];
  }
  if (agentSlug === "sales") return ["补充客户最新回复", "生成下一步跟单计划"];
  if (agentSlug === "restaurant-growth") {
    if (capabilityId === "takeaway_growth") return ["把方案拆成7天执行表", "补充外卖后台数据后复盘"];
    if (capabilityId === "dine_in_growth") return ["生成本周到店增长动作", "补充真实到店数据后复盘"];
    if (capabilityId === "chain_store_growth") return ["选择一家样板店开始试点", "生成门店数据采集模板"];
    if (capabilityId === "franchise_acquisition") return ["生成招商内容执行包", "补充加盟政策与线索数据"];
    return ["选择一个餐饮增长场景", "补充经营数据后继续诊断"];
  }
  if (capabilityId === "franchise_acquisition") return ["生成下一条招商短视频文案", "补全招商线索承接信息"];
  if (capabilityId === "video_review") return ["生成下一轮选题测试", "记录本次复盘结论"];
  return ["继续补充业务信息", "把结果拆成今日行动"];
}

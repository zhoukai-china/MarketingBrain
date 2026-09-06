import type { LlmProvider, ProviderFailureInfo } from "@baolu/agent";
import { prisma } from "@baolu/db";
import { env } from "../config/env.js";
import type { RuntimeAgent } from "./agent-runtime.js";
import { invokeSkillViaGateway } from "./mcp-client.js";
import type { RequestContext } from "./request-context.js";
import { loadFounderIpContentDraft, saveFounderIpContentDraft, type FounderIpContentDraft } from "./founder-ip-content-drafts.js";
import { emitRuntimeStage } from "./runtime-stage-trace.js";
import { RequestSingleFlight } from "./request-single-flight.js";

export class FounderIpContentGenerationError extends Error {
  constructor(public code: "founder_ip_content_draft_not_found" | "founder_ip_content_generation_rejected" | "founder_ip_content_provider_unavailable", message: string, public statusCode: number, public providerFailure?: ProviderFailureInfo) {
    super(message);
  }
}

const targetContracts = {
  franchise: {
    label: "招商加盟",
    audience: "潜在加盟商",
    cta: "了解加盟或申请加盟评估",
    landing: "加盟咨询、资格筛选或考察沟通",
    forbidden: /团购|核销|到店预约|消费者优惠|课程报名|合作意向/
  },
  store_visit: {
    label: "C端团购到店",
    audience: "本地消费者",
    cta: "到店、团购或预约",
    landing: "团购下单、预约到店或到店体验",
    forbidden: /加盟商|加盟咨询|招商加盟|加盟考察|课程报名|合作意向/
  },
  student: {
    label: "学员招募",
    audience: "潜在学员",
    cta: "咨询课程、试听或报名",
    landing: "课程咨询、试听安排或报名说明会",
    forbidden: /加盟商|加盟咨询|招商加盟|团购核销|到店套餐|合作意向/
  },
  partner: {
    label: "合作方招募",
    audience: "渠道或合作伙伴",
    cta: "提交合作意向或咨询合作",
    landing: "合作意向提交、资格判断或方案沟通",
    forbidden: /加盟商|加盟咨询|招商加盟|团购核销|到店套餐|课程报名|试听/
  }
} as const;

function clean(value: string): string { return value.replace(/\s+/g, "").trim(); }

export function buildFounderIpContentPrompt(draft: FounderIpContentDraft): string {
  const contract = targetContracts[draft.target];
  return [
    "【创始人IP获客内容生成】",
    "最终答案优先：直接输出600至900字成品，不解释分析过程。只使用本次字段，不使用历史对话、默认画像或其他目标。",
    `获客目标：${contract.label}`,
    `受众：${contract.audience}；CTA：${contract.cta}；承接：${contract.landing}。`,
    `创始人身份/项目：${draft.identity}`,
    `目标人群：${draft.targetCustomer}`,
    `本轮线索目标：${draft.acquisitionGoal}`,
    `项目/条件：${draft.offer || "待补"}`,
    `账号阶段：${draft.accountStage || "待补"}`,
    `行业：${draft.industry}`,
    `选题/钩子：${draft.topic}`,
    `选题目标人群：${draft.audience}`,
    `来源依据：${draft.sourceEvidence}`,
    `事实边界：${draft.factBoundary}`,
    `与获客目标的关系：${draft.goalRelation}`,
    "依次输出八个标题：当前选题/钩子、目标人群、来源依据与事实边界、与获客目标的关系、内容正文、承接动作、待补/待核验、下一步。",
    `正文开场逐字使用选题；只用${contract.landing}承接，不混入其他目标。待核验信息不得写成事实，不编城市、案例、价格、收益、人数、效果、政策或数字，不声称已执行。`
  ].join("\n\n");
}

export function validateFounderIpGeneratedSemantics(draft: FounderIpContentDraft, content: string): string | undefined {
  const normalized = content.trim();
  const compact = clean(normalized);
  const contract = targetContracts[draft.target];
  if (normalized.length < 260) return "内容成品过短，未形成可编辑的具体表达。";
  if (!compact.includes(clean(draft.topic))) return "内容没有保留当前选题/钩子。";
  if (!compact.includes(clean(draft.audience)) || !compact.includes(clean(draft.targetCustomer))) return "内容没有保留当前目标人群。";
  if (!/(?:承接|咨询|预约|团购|报名|合作).{0,24}/.test(normalized)) return "内容缺少明确承接动作。";
  const expectedCta = {
    franchise: /加盟(?:咨询|条件|评估|申请|考察)/,
    store_visit: /(?:团购|预约|到店)/,
    student: /(?:课程咨询|咨询课程|试听|报名)/,
    partner: /(?:合作意向|合作咨询|资格判断|方案沟通)/
  }[draft.target];
  if (!expectedCta.test(normalized)) return `内容没有使用${contract.label}的目标专属 CTA。`;
  if (contract.forbidden.test(normalized)) return "内容混入了其他获客目标的受众或承接动作。";
  if (/待(?:补|核验|确认)|未(?:提供|核验)/.test(draft.factBoundary) && !/(?:待补|待核验|待确认|未提供)/.test(normalized)) {
    return "来源仍有待确认事实，但内容没有保留事实边界。";
  }
  if (/(?:已(?:经)?帮助|已实现|已带来|保证|稳赚|回本|增长了?)[^\n]{0,8}\d|(?:案例|客户|门店|学员|报名|收益|效果|转化)[^\n]{0,12}\d+(?:个|人|家|万|%|倍)/.test(normalized) && /待(?:补|核验|确认)|未(?:提供|核验)/.test(draft.factBoundary)) {
    return "待确认来源被扩写成了未经证实的案例、效果或数字。";
  }
  return undefined;
}

export function validateFounderIpGeneratedContent(draft: FounderIpContentDraft, content: string): string | undefined {
  const semanticIssue = validateFounderIpGeneratedSemantics(draft, content);
  if (semanticIssue) return semanticIssue;
  const compact = clean(content);
  if (!compact.includes(clean(draft.sourceEvidence)) || !compact.includes(clean(draft.goalRelation))) {
    return "内容没有保留来源依据或与获客目标的关系。";
  }
  return undefined;
}

const founderIpMetadataHeadings = new Set([
  "当前选题/钩子",
  "目标人群",
  "来源依据与事实边界",
  "与获客目标的关系"
]);

function stripModelAuthoredMetadataSections(content: string): string {
  const kept: string[] = [];
  let skipping = false;
  for (const line of content.trim().split(/\r?\n/)) {
    const heading = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*$/);
    if (heading) {
      const title = heading[1].replace(/[：:]$/, "").trim();
      if (founderIpMetadataHeadings.has(title)) {
        skipping = true;
        continue;
      }
      skipping = false;
    }
    if (!skipping) kept.push(line);
  }
  return kept.join("\n").trim();
}

/**
 * The model owns the content body. The server owns the already-confirmed draft
 * fields so evidence remains byte-for-byte traceable even when the model
 * paraphrases explanatory metadata. This is not a content fallback: an unsafe
 * or off-target model body is rejected before this function is used.
 */
export function finalizeFounderIpGeneratedContent(draft: FounderIpContentDraft, modelContent: string): string {
  const contract = targetContracts[draft.target];
  const body = stripModelAuthoredMetadataSections(modelContent);
  return [
    "## 当前选题/钩子",
    draft.topic,
    "",
    "## 目标人群",
    `创始人身份/项目：${draft.identity}`,
    `目标人群：${draft.audience}（获客目标简报：${draft.targetCustomer}）`,
    "",
    "## 来源依据与事实边界",
    `来源依据：${draft.sourceEvidence}`,
    `事实边界：${draft.factBoundary}`,
    "",
    "## 与获客目标的关系",
    `当前获客目标：${contract.label}`,
    `本轮线索目标：${draft.acquisitionGoal}`,
    draft.goalRelation,
    "",
    body
  ].join("\n").trim();
}

type FounderIpContentGenerationResult = {
  draft: FounderIpContentDraft;
  content: string;
  skillId: string;
  skillVersion: string;
  providerName: string;
  selectedProvider: string;
  selectedModel?: string;
  selectedReasoningMode: "reasoning_high";
};

type FounderIpContentGenerationParams = {
  context: RequestContext;
  agent: RuntimeAgent;
  provider: LlmProvider;
  draftId: string;
  requestId: string;
  deviceScope: "desktop" | "mobile";
  signal?: AbortSignal;
  traceStartedAt?: number;
};

const founderIpContentSingleFlight = new RequestSingleFlight<FounderIpContentGenerationResult>(5 * 60_000);

export function generateFounderIpContentDraft(params: FounderIpContentGenerationParams): Promise<FounderIpContentGenerationResult> {
  return founderIpContentSingleFlight.run({
    key: `${params.context.tenantId}:${params.requestId}`,
    fingerprint: params.draftId,
    onConflict: () => new FounderIpContentGenerationError("founder_ip_content_generation_rejected", "该请求编号已用于其他内容草稿，请重新发起。", 409),
    execute: () => generateFounderIpContentDraftOnce(params)
  });
}

async function generateFounderIpContentDraftOnce(params: FounderIpContentGenerationParams): Promise<FounderIpContentGenerationResult> {
  const traceStartedAt = params.traceStartedAt ?? Date.now();
  const draft = await loadFounderIpContentDraft(params.context, params.draftId);
  if (!draft) throw new FounderIpContentGenerationError("founder_ip_content_draft_not_found", "当前内容草稿不存在或不属于本企业。", 404);
  if (env.DATA_MODE === "demo") {
    throw new FounderIpContentGenerationError("founder_ip_content_provider_unavailable", "当前本机处于演示模型模式，无法生成可验收的内容成品；已保留当前选题和获客目标简报，请在接入真实内容模型后重新生成。", 503);
  }
  const configuredProvider = params.provider as LlmProvider & { isConfigured?: () => boolean };
  if (configuredProvider.isConfigured?.() === false) {
    throw new FounderIpContentGenerationError("founder_ip_content_provider_unavailable", "当前内容模型尚未配置，无法生成可用内容成品；已保留当前选题和获客目标简报，请在模型配置完成后重新生成。", 503);
  }
  const capability = params.agent.capabilities.find((item) => item.key === "content_plan");
  if (!capability) throw new FounderIpContentGenerationError("founder_ip_content_generation_rejected", "当前创始人 IP 获客系统未配置内容生成能力。", 409);
  const result = await invokeSkillViaGateway({
    requestId: params.requestId,
    context: params.context,
    provider: params.provider,
    agentId: params.agent.id,
    capabilityId: "content_plan",
    skillId: capability.skillId,
    input: buildFounderIpContentPrompt(draft),
    routingInput: `创始人IP获客内容生成：${targetContracts[draft.target].label}`,
    history: [],
    deviceScope: params.deviceScope,
    capabilityLocked: true,
    deliveryPolicy: "draft_with_placeholders",
    persist: false,
    channel: "h5",
    signal: params.signal,
    traceStartedAt
  });
  if (result.qualityFlags.includes("provider_fallback_used")) {
    emitRuntimeStage({
      requestId: params.requestId,
      stage: "provider_terminal",
      startedAt: traceStartedAt,
      status: "failed",
      provider: params.provider,
      errorCode: result.providerFailure?.code ?? "unknown",
      providerFailure: result.providerFailure
    });
    throw new FounderIpContentGenerationError("founder_ip_content_provider_unavailable", "当前内容模型未返回可验收的获客内容；已保留当前选题和获客目标简报，请稍后重新生成。", 503, result.providerFailure);
  }
  emitRuntimeStage({ requestId: params.requestId, stage: "response_validation", startedAt: traceStartedAt, status: "started", provider: params.provider });
  const semanticIssue = validateFounderIpGeneratedSemantics(draft, result.answerText);
  if (semanticIssue) throw new FounderIpContentGenerationError("founder_ip_content_generation_rejected", `内容生成未通过当前获客目标校验：${semanticIssue}`, 422);
  const finalizedContent = finalizeFounderIpGeneratedContent(draft, result.answerText);
  const issue = validateFounderIpGeneratedContent(draft, finalizedContent);
  if (issue) throw new FounderIpContentGenerationError("founder_ip_content_generation_rejected", `内容生成未通过当前获客目标校验：${issue}`, 422);
  emitRuntimeStage({ requestId: params.requestId, stage: "response_validation", startedAt: traceStartedAt, status: "completed", provider: params.provider });
  const saved = await saveFounderIpContentDraft(params.context, draft.id, finalizedContent, "generated");
  if (!saved) throw new FounderIpContentGenerationError("founder_ip_content_draft_not_found", "内容草稿保存失败，请重新进入选题系统后再试。", 404);
  const providerWithModel = params.provider as LlmProvider & { getModel?: () => string };
  const selectedModel = providerWithModel.getModel?.();
  await prisma.auditLog.create({
    data: {
      tenantId: params.context.tenantId,
      userId: params.context.userId,
      action: "founder_ip_content_draft.provider_selected",
      resource: "founder_ip_content_draft",
      resourceId: draft.id,
      detail: JSON.stringify({
        selectedProvider: params.provider.name,
        selectedModel,
        selectedReasoningMode: "reasoning_high"
      })
    }
  });
  return {
    draft: saved,
    content: finalizedContent,
    skillId: result.skillId,
    skillVersion: result.skillVersion,
    providerName: params.provider.name,
    selectedProvider: params.provider.name,
    selectedModel,
    selectedReasoningMode: "reasoning_high"
  };
}

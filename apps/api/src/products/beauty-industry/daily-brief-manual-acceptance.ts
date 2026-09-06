import { Prisma, prisma } from "@baolu/db";
import { domesticNetworkOnly, domesticOutboundAllowlist, env, getActiveLlmConfig } from "../../config/env.js";
import { DomesticChatProvider, type DomesticProviderUsageObservation } from "../../services/domestic-chat-provider.js";
import { toPrismaJson } from "../../services/prisma-json.js";
import {
  BEAUTY_DAILY_BRIEF_CAPABILITY_ID,
  BEAUTY_DAILY_BRIEF_CONTRACT_VERSION,
  BEAUTY_DAILY_BRIEF_PRODUCT_CODE,
  beautyDailyBriefUniqueKey,
  type BeautyDailyBriefReport
} from "./daily-brief-contract.js";
import {
  BEAUTY_DAILY_BRIEF_LIVE_LIMITS,
  buildBeautyDailyBriefLivePrompt,
  collectBeautyDailyBriefSources,
  estimateBeautyDailyBriefModelCost,
  estimateBeautyDailyBriefWorstModelCost,
  parseBeautyDailyBriefLiveReport,
  validateBeautyDailyBriefCandidateDiversity,
  validateBeautyDailyBriefLiveConfig
} from "./daily-brief-live.js";

export const BEAUTY_DAILY_BRIEF_MANUAL_ACCEPTANCE_LIMITS = {
  additionalHttp: 36,
  priorSameDayAuditHttp: 94,
  sameDayAuditHttp: 130,
  priorManualModelCalls: 0,
  modelCalls: 1
} as const;

const HTTP_RESERVED_EVENT = "BY20_MANUAL_ACCEPTANCE_HTTP_RESERVED";
const MODEL_RESERVED_EVENT = "BY20_MANUAL_ACCEPTANCE_MODEL_RESERVED";
const GRANT_ID = /^by20-manual-(\d{8})-([a-f0-9]{16})$/u;

export interface BeautyDailyBriefManualAcceptanceGrant {
  grantId: string;
  businessDate: string;
  currentBusinessDate: string;
  contractVersion: string;
  parentUniqueKey: string;
  parentNetworkRequestCount: number;
  parentProviderCallCount: number;
  priorSameDayAuditHttpCount: number;
  priorManualProviderCallCount: number;
  additionalHttpLimit: number;
  sameDayAuditHttpLimit: number;
  modelCallLimit: number;
}

export function validateBeautyDailyBriefManualAcceptanceGrant(grant: BeautyDailyBriefManualAcceptanceGrant): string[] {
  const issues: string[] = [];
  const match = grant.grantId.match(GRANT_ID);
  if (!match || match[1] !== grant.businessDate.replaceAll("-", "")) issues.push("grant_id_invalid");
  if (grant.businessDate !== grant.currentBusinessDate) issues.push("business_date_not_current");
  if (grant.contractVersion !== BEAUTY_DAILY_BRIEF_CONTRACT_VERSION) issues.push("contract_version_invalid");
  if (grant.parentUniqueKey !== beautyDailyBriefUniqueKey(grant.businessDate)) issues.push("parent_unique_key_invalid");
  if (grant.parentNetworkRequestCount !== BEAUTY_DAILY_BRIEF_LIVE_LIMITS.maxHttpRequestsPerDay) issues.push("parent_http_count_invalid");
  if (grant.parentProviderCallCount !== 0) issues.push("parent_model_count_invalid");
  if (grant.priorSameDayAuditHttpCount !== BEAUTY_DAILY_BRIEF_MANUAL_ACCEPTANCE_LIMITS.priorSameDayAuditHttp) issues.push("prior_same_day_http_count_invalid");
  if (grant.priorManualProviderCallCount !== BEAUTY_DAILY_BRIEF_MANUAL_ACCEPTANCE_LIMITS.priorManualModelCalls) issues.push("prior_manual_model_count_invalid");
  if (grant.additionalHttpLimit !== BEAUTY_DAILY_BRIEF_MANUAL_ACCEPTANCE_LIMITS.additionalHttp) issues.push("additional_http_limit_invalid");
  if (grant.sameDayAuditHttpLimit !== BEAUTY_DAILY_BRIEF_MANUAL_ACCEPTANCE_LIMITS.sameDayAuditHttp) issues.push("same_day_http_limit_invalid");
  if (grant.modelCallLimit !== BEAUTY_DAILY_BRIEF_MANUAL_ACCEPTANCE_LIMITS.modelCalls) issues.push("model_call_limit_invalid");
  return issues;
}

export function buildBeautyDailyBriefManualAcceptanceRunKey(grant: BeautyDailyBriefManualAcceptanceGrant): string {
  return `${grant.parentUniqueKey}:manual-acceptance:${grant.grantId}`;
}

export interface BeautyDailyBriefManualAcceptanceResult {
  grantId: string;
  runKey: string;
  parentUniqueKey: string;
  businessDate: string;
  status: "succeeded" | "source_insufficient" | "failed" | "terminal_unknown";
  sourceWindowHours: 24 | 72;
  qualified24h: number;
  qualified72h: number;
  networkRequestCount: number;
  sameDayAuditNetworkRequestCount: number;
  providerCallCount: number;
  providerCostYuan: number;
  usage?: DomesticProviderUsageObservation;
  agentRunId?: string;
  sourceStats: Array<{
    host: string;
    listCandidates: number;
    allocatedDetails: number;
    actualDetailRequests: number;
    qualified: number;
    rejected: Record<string, number>;
  }>;
  responseAttribution: Array<{
    host: string;
    statuses: Array<number | "network_error">;
    redirectClasses: string[];
    rejectionReasons: string[];
    requests: number;
  }>;
  errorCode?: string;
}

export async function executeBeautyDailyBriefManualAcceptance(params: {
  grant: BeautyDailyBriefManualAcceptanceGrant;
  tenantId: string;
  userId: string;
}): Promise<BeautyDailyBriefManualAcceptanceResult> {
  if (env.DATA_MODE !== "database" || env.BEAUTY_DAILY_BRIEF_RUNTIME_MODE !== "live" || env.BEAUTY_DAILY_BRIEF_SCHEDULER_ENABLED !== "false") {
    throw new Error("beauty_daily_brief_manual_acceptance_environment_invalid");
  }
  const configIssues = validateBeautyDailyBriefLiveConfig({
    dailyHttp: env.BEAUTY_DAILY_BRIEF_DAILY_NETWORK_REQUEST_LIMIT,
    monthlyHttp: env.BEAUTY_DAILY_BRIEF_MONTHLY_NETWORK_REQUEST_LIMIT,
    dailyModels: env.BEAUTY_DAILY_BRIEF_DAILY_MODEL_CALL_LIMIT,
    monthlyModels: env.BEAUTY_DAILY_BRIEF_MONTHLY_MODEL_CALL_LIMIT,
    dailyCost: env.BEAUTY_DAILY_BRIEF_DAILY_COST_LIMIT_YUAN,
    monthlyCost: env.BEAUTY_DAILY_BRIEF_MONTHLY_COST_LIMIT_YUAN
  });
  if (configIssues.length) throw new Error(`beauty_daily_brief_manual_acceptance_config_failed:${configIssues.join(",")}`);
  const grantIssues = validateBeautyDailyBriefManualAcceptanceGrant(params.grant);
  if (grantIssues.length) throw new Error(`beauty_daily_brief_manual_acceptance_grant_failed:${grantIssues.join(",")}`);
  const parent = await prisma.beautyDailyBriefSnapshot.findUnique({
    where: {
      productCode_businessDate_contractVersion: {
        productCode: BEAUTY_DAILY_BRIEF_PRODUCT_CODE,
        businessDate: params.grant.businessDate,
        contractVersion: BEAUTY_DAILY_BRIEF_CONTRACT_VERSION
      }
    }
  });
  if (!parent || parent.status !== "source_insufficient" || parent.networkRequestCount !== 36 || parent.providerCallCount !== 0) {
    throw new Error("beauty_daily_brief_manual_acceptance_parent_invalid");
  }
  const priorManualAudit = await readSameDayManualAudit(params.grant.businessDate);
  if (
    parent.networkRequestCount + priorManualAudit.http !== params.grant.priorSameDayAuditHttpCount
    || priorManualAudit.models !== params.grant.priorManualProviderCallCount
  ) {
    throw new Error("beauty_daily_brief_manual_acceptance_prior_audit_invalid");
  }
  const runKey = buildBeautyDailyBriefManualAcceptanceRunKey(params.grant);
  try {
    await prisma.automationTask.create({
      data: {
        id: params.grant.grantId,
        tenantId: params.tenantId,
        userId: params.userId,
        type: "beauty_daily_brief",
        payload: toPrismaJson({
          manualAcceptance: true,
          oneShot: true,
          publicSourcesOnly: true,
          businessDate: params.grant.businessDate,
          contractVersion: BEAUTY_DAILY_BRIEF_CONTRACT_VERSION,
          parentSnapshotId: parent.id,
          parentUniqueKey: params.grant.parentUniqueKey,
          runKey,
          priorSameDayAuditHttpCount: params.grant.priorSameDayAuditHttpCount,
          priorManualProviderCallCount: params.grant.priorManualProviderCallCount,
          additionalHttpLimit: params.grant.additionalHttpLimit,
          sameDayAuditHttpLimit: params.grant.sameDayAuditHttpLimit,
          modelCallLimit: params.grant.modelCallLimit,
          productionBudgetInherited: false,
          approvalSource: "user_explicit_20260826_final"
        }),
        runAt: new Date(),
        status: "claimed",
        confirmationRequired: false,
        confirmationStatus: "not_required",
        lockedAt: new Date(),
        logs: {
          create: {
            message: "BY20 同日人工终验授权已消费",
            metadata: toPrismaJson({
              grantId: params.grant.grantId,
              businessDate: params.grant.businessDate,
              parentUniqueKey: params.grant.parentUniqueKey,
              parentNetworkRequestCount: parent.networkRequestCount,
              parentProviderCallCount: parent.providerCallCount,
              priorSameDayAuditHttpCount: params.grant.priorSameDayAuditHttpCount,
              priorManualProviderCallCount: params.grant.priorManualProviderCallCount,
              additionalHttpLimit: params.grant.additionalHttpLimit,
              sameDayAuditHttpLimit: params.grant.sameDayAuditHttpLimit,
              productionBudgetInherited: false
            })
          }
        }
      }
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new Error("beauty_daily_brief_manual_acceptance_grant_replayed");
    }
    throw error;
  }

  const cutoffAt = new Date(`${params.grant.businessDate}T09:00:00+08:00`);
  try {
    const collection = await collectBeautyDailyBriefSources({
      cutoffAt,
      beforeRequest: ({ kind }) => reserveManualHttpRequest(params.grant, parent.id, kind)
    });
    await recordCollection(params.grant.grantId, collection);
    const within24 = collection.candidates.filter((item) => cutoffAt.getTime() - new Date(item.publishedAt).getTime() <= 24 * 3_600_000);
    const candidates = within24.length >= 15 ? within24 : collection.candidates;
    const sourceWindowHours: 24 | 72 = within24.length >= 15 ? 24 : 72;
    const diversityIssues = validateBeautyDailyBriefCandidateDiversity(candidates);
    const common = buildSafeResult(params.grant, runKey, collection, sourceWindowHours, within24.length);
    if (candidates.length < 15 || diversityIssues.length) {
      await finishTask(params.grant.grantId, "failed", "source_insufficient", {
        qualified24h: within24.length,
        qualified72h: collection.candidates.length,
        diversityIssueCount: diversityIssues.length,
        providerCalls: 0
      });
      return { ...common, status: "source_insufficient", providerCallCount: 0, providerCostYuan: 0, errorCode: "source_insufficient" };
    }

    const active = getActiveLlmConfig();
    if (active.provider !== "deepseek" || active.model.trim().toLowerCase() !== "deepseek-v4-pro" || !active.apiKey || !active.baseUrl) {
      throw new Error("beauty_daily_brief_provider_config_invalid");
    }
    const prompt = buildBeautyDailyBriefLivePrompt({
      businessDate: params.grant.businessDate,
      cutoffAt,
      sourceWindowHours,
      trigger: "manual",
      candidates
    });
    await reserveManualModelCall(params.grant, parent.id);
    let usage: DomesticProviderUsageObservation | undefined;
    const provider = new DomesticChatProvider({
      providerName: "deepseek",
      apiKey: active.apiKey,
      baseUrl: active.baseUrl,
      model: active.model,
      timeoutMs: env.LLM_TIMEOUT_MS,
      domesticNetworkOnly,
      allowedHosts: domesticOutboundAllowlist,
      onUsage: (next) => { usage = next; }
    });
    let raw: string;
    try {
      raw = await provider.complete([{ role: "user", content: prompt }], {
        thinkingMode: "disabled",
        maxTokens: BEAUTY_DAILY_BRIEF_LIVE_LIMITS.maxOutputTokens,
        responseFormat: "json_object"
      });
    } catch {
      await finishTask(params.grant.grantId, "terminal_unknown", "provider_terminal_unknown", { providerCalls: 1 });
      return { ...common, status: "terminal_unknown", providerCallCount: 1, providerCostYuan: 0, errorCode: "provider_terminal_unknown" };
    }
    if (!usage || usage.finishReason !== "stop" || usage.promptTokens > BEAUTY_DAILY_BRIEF_LIVE_LIMITS.maxPromptTokens || usage.completionTokens > BEAUTY_DAILY_BRIEF_LIVE_LIMITS.maxOutputTokens || usage.reasoningTokens !== 0) {
      await finishTask(params.grant.grantId, "terminal_unknown", "provider_usage_gate_failed", { providerCalls: 1 });
      return { ...common, status: "terminal_unknown", providerCallCount: 1, providerCostYuan: 0, ...(usage ? { usage } : {}), errorCode: "provider_usage_gate_failed" };
    }
    const observedUsage = usage as DomesticProviderUsageObservation;
    const cost = estimateBeautyDailyBriefModelCost(observedUsage.promptTokens, observedUsage.completionTokens);
    if (cost > env.BEAUTY_DAILY_BRIEF_DAILY_COST_LIMIT_YUAN) {
      await finishTask(params.grant.grantId, "terminal_unknown", "provider_cost_gate_failed", { providerCalls: 1, costYuan: cost });
      return { ...common, status: "terminal_unknown", providerCallCount: 1, providerCostYuan: cost, usage: observedUsage, errorCode: "provider_cost_gate_failed" };
    }
    let report: BeautyDailyBriefReport;
    try {
      report = parseBeautyDailyBriefLiveReport(raw, candidates);
    } catch {
      await finishTask(params.grant.grantId, "failed", "contract_validation_failed", { providerCalls: 1, costYuan: cost });
      return { ...common, status: "failed", providerCallCount: 1, providerCostYuan: cost, usage: observedUsage, errorCode: "contract_validation_failed" };
    }
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: params.tenantId }, select: { type: true } });
    const run = await prisma.$transaction(async (tx) => {
      const created = await tx.agentRun.create({
        data: {
          tenantId: params.tenantId,
          userId: params.userId,
          capabilityId: BEAUTY_DAILY_BRIEF_CAPABILITY_ID,
          requestId: runKey,
          requestFingerprint: runKey,
          routingSource: "manual_acceptance_fixed_capability",
          skillId: "beauty-daily-brief",
          skillVersion: BEAUTY_DAILY_BRIEF_CONTRACT_VERSION,
          tenantType: tenant.type,
          status: "succeeded",
          input: JSON.stringify({ businessDate: params.grant.businessDate, sourceCount: 15, publicSourcesOnly: true, manualAcceptance: true }),
          output: JSON.stringify(report),
          modelProvider: "deepseek",
          productCode: BEAUTY_DAILY_BRIEF_PRODUCT_CODE,
          operatingEntityId: BEAUTY_DAILY_BRIEF_PRODUCT_CODE,
          usageChannel: "manual_acceptance",
          tokenEstimate: observedUsage.totalTokens,
          creditCost: 0,
          qualityFlags: toPrismaJson([])
        }
      });
      await tx.automationTask.update({
        where: { id: params.grant.grantId },
        data: {
          status: "succeeded",
          lockedAt: null,
          logs: {
            create: {
              message: "BY20 同日人工终验完成",
              metadata: toPrismaJson({
                agentRunId: created.id,
                providerCalls: 1,
                fallbackUsed: false,
                promptTokens: observedUsage.promptTokens,
                completionTokens: observedUsage.completionTokens,
                reasoningTokens: observedUsage.reasoningTokens,
                totalTokens: observedUsage.totalTokens,
                finishReason: observedUsage.finishReason,
                costYuan: cost
              })
            }
          }
        }
      });
      return created;
    });
    return { ...common, status: "succeeded", providerCallCount: 1, providerCostYuan: cost, usage: observedUsage, agentRunId: run.id };
  } catch (error) {
    const errorCode = error instanceof Error ? error.message.split(":")[0] : "beauty_daily_brief_manual_acceptance_failed";
    await finishTask(params.grant.grantId, "failed", errorCode, { providerCalls: await countTaskEvents(params.grant.grantId, MODEL_RESERVED_EVENT) }).catch(() => undefined);
    throw error;
  }
}

async function reserveManualHttpRequest(grant: BeautyDailyBriefManualAcceptanceGrant, parentSnapshotId: string, kind: "list" | "detail"): Promise<void> {
  const monthStart = new Date(`${grant.businessDate.slice(0, 7)}-01T00:00:00+08:00`);
  const monthEnd = new Date(monthStart); monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1);
  await prisma.$transaction(async (tx) => {
    const [task, parent, current, sameDayManual, monthlySnapshots, monthlyManual] = await Promise.all([
      tx.automationTask.findUniqueOrThrow({ where: { id: grant.grantId }, select: { status: true } }),
      tx.beautyDailyBriefSnapshot.findUniqueOrThrow({ where: { id: parentSnapshotId }, select: { networkRequestCount: true, providerCallCount: true } }),
      tx.automationLog.count({ where: { taskId: grant.grantId, message: HTTP_RESERVED_EVENT } }),
      tx.automationLog.count({ where: { message: HTTP_RESERVED_EVENT, task: { runAt: sameDayRange(grant.businessDate) } } }),
      tx.beautyDailyBriefSnapshot.aggregate({ where: { productCode: BEAUTY_DAILY_BRIEF_PRODUCT_CODE, contractVersion: BEAUTY_DAILY_BRIEF_CONTRACT_VERSION, businessDate: { startsWith: grant.businessDate.slice(0, 7) } }, _sum: { networkRequestCount: true } }),
      tx.automationLog.count({ where: { message: HTTP_RESERVED_EVENT, task: { runAt: { gte: monthStart, lt: monthEnd } } } })
    ]);
    if (task.status !== "claimed") throw new Error("beauty_daily_brief_manual_acceptance_not_active");
    if (parent.networkRequestCount !== 36 || parent.providerCallCount !== 0) throw new Error("beauty_daily_brief_manual_acceptance_parent_changed");
    if (current >= grant.additionalHttpLimit || parent.networkRequestCount + sameDayManual >= grant.sameDayAuditHttpLimit) throw new Error("beauty_daily_brief_manual_acceptance_http_budget_exceeded");
    if ((monthlySnapshots._sum.networkRequestCount ?? 0) + monthlyManual >= env.BEAUTY_DAILY_BRIEF_MONTHLY_NETWORK_REQUEST_LIMIT) throw new Error("beauty_daily_brief_manual_acceptance_monthly_http_budget_exceeded");
    await tx.automationLog.create({ data: { taskId: grant.grantId, message: HTTP_RESERVED_EVENT, metadata: toPrismaJson({ businessDate: grant.businessDate, kind, requestOrdinal: current + 1, sameDayAuditOrdinal: parent.networkRequestCount + sameDayManual + 1 }) } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

async function reserveManualModelCall(grant: BeautyDailyBriefManualAcceptanceGrant, parentSnapshotId: string): Promise<void> {
  if (estimateBeautyDailyBriefWorstModelCost() > env.BEAUTY_DAILY_BRIEF_DAILY_COST_LIMIT_YUAN) throw new Error("beauty_daily_brief_manual_acceptance_model_budget_exceeded");
  const monthStart = new Date(`${grant.businessDate.slice(0, 7)}-01T00:00:00+08:00`);
  const monthEnd = new Date(monthStart); monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1);
  await prisma.$transaction(async (tx) => {
    const [task, parent, current, sameDayManual, monthlySnapshots, monthlyManual] = await Promise.all([
      tx.automationTask.findUniqueOrThrow({ where: { id: grant.grantId }, select: { status: true } }),
      tx.beautyDailyBriefSnapshot.findUniqueOrThrow({ where: { id: parentSnapshotId }, select: { providerCallCount: true } }),
      tx.automationLog.count({ where: { taskId: grant.grantId, message: MODEL_RESERVED_EVENT } }),
      tx.automationLog.count({ where: { message: MODEL_RESERVED_EVENT, task: { runAt: sameDayRange(grant.businessDate) } } }),
      tx.beautyDailyBriefSnapshot.aggregate({ where: { productCode: BEAUTY_DAILY_BRIEF_PRODUCT_CODE, contractVersion: BEAUTY_DAILY_BRIEF_CONTRACT_VERSION, businessDate: { startsWith: grant.businessDate.slice(0, 7) } }, _sum: { providerCallCount: true, providerCostYuan: true } }),
      tx.automationLog.count({ where: { message: MODEL_RESERVED_EVENT, task: { runAt: { gte: monthStart, lt: monthEnd } } } })
    ]);
    if (task.status !== "claimed") throw new Error("beauty_daily_brief_manual_acceptance_not_active");
    if (parent.providerCallCount !== 0 || current >= grant.modelCallLimit || parent.providerCallCount + sameDayManual >= grant.modelCallLimit) throw new Error("beauty_daily_brief_manual_acceptance_model_call_budget_exceeded");
    if ((monthlySnapshots._sum.providerCallCount ?? 0) + monthlyManual >= env.BEAUTY_DAILY_BRIEF_MONTHLY_MODEL_CALL_LIMIT) throw new Error("beauty_daily_brief_manual_acceptance_monthly_model_budget_exceeded");
    if (Number(monthlySnapshots._sum.providerCostYuan ?? 0) + estimateBeautyDailyBriefWorstModelCost() > env.BEAUTY_DAILY_BRIEF_MONTHLY_COST_LIMIT_YUAN) throw new Error("beauty_daily_brief_manual_acceptance_monthly_cost_budget_exceeded");
    await tx.automationLog.create({ data: { taskId: grant.grantId, message: MODEL_RESERVED_EVENT, metadata: toPrismaJson({ businessDate: grant.businessDate, provider: "deepseek", model: "deepseek-v4-pro", thinking: "disabled", callOrdinal: 1, retryLimit: 0 }) } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

async function recordCollection(taskId: string, collection: Awaited<ReturnType<typeof collectBeautyDailyBriefSources>>): Promise<void> {
  const grouped = new Map<string, typeof collection.observations>();
  for (const observation of collection.observations) grouped.set(observation.originHost, [...(grouped.get(observation.originHost) ?? []), observation]);
  const attribution = [...grouped.entries()].map(([host, rows]) => ({
    host,
    requests: rows.length,
    statuses: [...new Set(rows.map((row) => row.status))],
    redirectClasses: [...new Set(rows.map((row) => row.redirectClass))],
    rejectionReasons: [...new Set(rows.map((row) => row.rejectionReason).filter(Boolean))]
  }));
  await prisma.automationLog.create({ data: { taskId, message: "BY20 同日人工终验来源采集完成", metadata: toPrismaJson({ requestCount: collection.requestCount, listRequestCount: collection.listRequestCount, detailRequestCount: collection.detailRequestCount, redirectBlockedCount: collection.redirectBlockedCount, qualifiedCandidates: collection.candidates.length, sourceStats: collection.sourceStats, attribution }) } });
}

function buildSafeResult(grant: BeautyDailyBriefManualAcceptanceGrant, runKey: string, collection: Awaited<ReturnType<typeof collectBeautyDailyBriefSources>>, sourceWindowHours: 24 | 72, qualified24h: number): Omit<BeautyDailyBriefManualAcceptanceResult, "status" | "providerCallCount" | "providerCostYuan"> {
  const grouped = new Map<string, typeof collection.observations>();
  for (const observation of collection.observations) grouped.set(observation.originHost, [...(grouped.get(observation.originHost) ?? []), observation]);
  return {
    grantId: grant.grantId,
    runKey,
    parentUniqueKey: grant.parentUniqueKey,
    businessDate: grant.businessDate,
    sourceWindowHours,
    qualified24h,
    qualified72h: collection.candidates.length,
    networkRequestCount: collection.requestCount,
    sameDayAuditNetworkRequestCount: grant.priorSameDayAuditHttpCount + collection.requestCount,
    sourceStats: collection.sourceStats.map(({ host, listCandidates, allocatedDetails, actualDetailRequests, qualified, rejected }) => ({ host, listCandidates, allocatedDetails, actualDetailRequests, qualified, rejected })),
    responseAttribution: [...grouped.entries()].map(([host, rows]) => ({
      host,
      statuses: [...new Set(rows.map((row) => row.status))],
      redirectClasses: [...new Set(rows.map((row) => row.redirectClass))],
      rejectionReasons: [...new Set(rows.map((row) => row.rejectionReason).filter((value): value is string => Boolean(value)))],
      requests: rows.length
    }))
  };
}

async function finishTask(taskId: string, status: string, errorCode: string, metadata: Record<string, unknown>): Promise<void> {
  await prisma.automationTask.update({ where: { id: taskId }, data: { status, lockedAt: null, logs: { create: { message: "BY20 同日人工终验停止", level: status === "succeeded" ? "info" : "error", metadata: toPrismaJson({ errorCode, ...metadata }) } } } });
}

async function countTaskEvents(taskId: string, message: string): Promise<number> {
  return prisma.automationLog.count({ where: { taskId, message } });
}

function sameDayRange(businessDate: string): { gte: Date; lt: Date } {
  const gte = new Date(`${businessDate}T00:00:00+08:00`);
  const lt = new Date(gte.getTime() + 86_400_000);
  return { gte, lt };
}

async function readSameDayManualAudit(businessDate: string): Promise<{ http: number; models: number }> {
  const [http, models] = await Promise.all([
    prisma.automationLog.count({ where: { message: HTTP_RESERVED_EVENT, task: { runAt: sameDayRange(businessDate) } } }),
    prisma.automationLog.count({ where: { message: MODEL_RESERVED_EVENT, task: { runAt: sameDayRange(businessDate) } } })
  ]);
  return { http, models };
}

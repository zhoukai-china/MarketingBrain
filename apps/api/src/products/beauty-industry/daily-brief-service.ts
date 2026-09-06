import { randomUUID } from "node:crypto";
import { Prisma, prisma } from "@baolu/db";
import { domesticNetworkOnly, domesticOutboundAllowlist, env, getActiveLlmConfig } from "../../config/env.js";
import { toPrismaJson } from "../../services/prisma-json.js";
import { DomesticChatProvider, type DomesticProviderUsageObservation } from "../../services/domestic-chat-provider.js";
import {
  BEAUTY_DAILY_BRIEF_CAPABILITY_ID,
  BEAUTY_DAILY_BRIEF_CONTRACT_VERSION,
  BEAUTY_DAILY_BRIEF_PRODUCT_CODE,
  BEAUTY_DAILY_BRIEF_TIME_ZONE,
  beautyDailyBriefUniqueKey,
  composeBeautyDailyBriefReport,
  decideBeautyDailyBriefSchedule,
  readBeautyDailyBriefClock,
  selectBeautyDailyBriefSources,
  type BeautyDailyBriefReport,
  type BeautyDailyBriefRuntimeMode,
  type BeautyDailyBriefTrigger
} from "./daily-brief-contract.js";
import {
  buildControlledBeautyDailyBriefSources,
  controlledBeautyDailyBriefAction,
  controlledBeautyDailyBriefTrends
} from "./daily-brief-fixtures.js";
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

const ACTIVE_STATUSES = ["queued", "collecting_sources", "verifying_sources", "generating", "validating_contract"];
const LEASE_MS = 2 * 60_000;

export interface BeautyDailyBriefPublicState {
  productCode: string;
  capabilityId: string;
  contractVersion: string;
  businessDate: string;
  status: string;
  phase: string;
  trigger: string | null;
  cutoffAt: string;
  nextScheduledAt: string;
  sourceWindowHours: number | null;
  sourceCount: number;
  lastSuccessfulAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  runtimeMode: BeautyDailyBriefRuntimeMode;
  schedulerEnabled: boolean;
  formalAutomationEnabled: boolean;
  controlledNotice: string | null;
  report: BeautyDailyBriefReport | null;
}

export function beautyDailyBriefRuntimeMode(): BeautyDailyBriefRuntimeMode {
  return env.BEAUTY_DAILY_BRIEF_RUNTIME_MODE;
}

export function beautyDailyBriefFormalAutomationEnabled(): boolean {
  return env.BEAUTY_DAILY_BRIEF_RUNTIME_MODE === "live"
    && env.BEAUTY_DAILY_BRIEF_SCHEDULER_ENABLED === "true"
    && env.BEAUTY_DAILY_BRIEF_RECURRING_APPROVED === "true";
}

export async function readBeautyDailyBriefState(params: { businessDate?: string; includeReport?: boolean }): Promise<BeautyDailyBriefPublicState> {
  const clock = readBeautyDailyBriefClock();
  const businessDate = params.businessDate ?? clock.businessDate;
  const snapshot = env.DATA_MODE === "database"
    ? await prisma.beautyDailyBriefSnapshot.findUnique({
        where: { productCode_businessDate_contractVersion: { productCode: BEAUTY_DAILY_BRIEF_PRODUCT_CODE, businessDate, contractVersion: BEAUTY_DAILY_BRIEF_CONTRACT_VERSION } }
      })
    : null;
  const cutoffAt = new Date(`${businessDate}T09:00:00+08:00`);
  return {
    productCode: BEAUTY_DAILY_BRIEF_PRODUCT_CODE,
    capabilityId: BEAUTY_DAILY_BRIEF_CAPABILITY_ID,
    contractVersion: BEAUTY_DAILY_BRIEF_CONTRACT_VERSION,
    businessDate,
    status: snapshot?.status ?? "not_generated",
    phase: snapshot?.phase ?? "not_generated",
    trigger: snapshot?.trigger ?? null,
    cutoffAt: cutoffAt.toISOString(),
    nextScheduledAt: clock.nextScheduledAt.toISOString(),
    sourceWindowHours: snapshot?.sourceWindowHours ?? null,
    sourceCount: snapshot?.sourceCount ?? 0,
    lastSuccessfulAt: snapshot?.lastSuccessfulAt?.toISOString() ?? null,
    errorCode: snapshot?.errorCode ?? null,
    errorMessage: snapshot?.errorMessage ?? null,
    runtimeMode: beautyDailyBriefRuntimeMode(),
    schedulerEnabled: env.BEAUTY_DAILY_BRIEF_SCHEDULER_ENABLED === "true",
    formalAutomationEnabled: beautyDailyBriefFormalAutomationEnabled(),
    controlledNotice: env.BEAUTY_DAILY_BRIEF_RUNTIME_MODE === "controlled_mock" ? "受控测试环境：结果不是实时资讯，也不代表真实模型质量。" : null,
    report: params.includeReport && snapshot?.report ? snapshot.report as unknown as BeautyDailyBriefReport : null
  };
}

export async function listBeautyDailyBriefHistory(limit = 31): Promise<BeautyDailyBriefPublicState[]> {
  if (env.DATA_MODE !== "database") return [];
  const snapshots = await prisma.beautyDailyBriefSnapshot.findMany({
    where: { productCode: BEAUTY_DAILY_BRIEF_PRODUCT_CODE, contractVersion: BEAUTY_DAILY_BRIEF_CONTRACT_VERSION },
    orderBy: { businessDate: "desc" },
    take: Math.max(1, Math.min(limit, 366))
  });
  const clock = readBeautyDailyBriefClock();
  return snapshots.map((snapshot) => ({
    productCode: snapshot.productCode,
    capabilityId: BEAUTY_DAILY_BRIEF_CAPABILITY_ID,
    contractVersion: snapshot.contractVersion,
    businessDate: snapshot.businessDate,
    status: snapshot.status,
    phase: snapshot.phase,
    trigger: snapshot.trigger,
    cutoffAt: new Date(`${snapshot.businessDate}T09:00:00+08:00`).toISOString(),
    nextScheduledAt: clock.nextScheduledAt.toISOString(),
    sourceWindowHours: snapshot.sourceWindowHours,
    sourceCount: snapshot.sourceCount,
    lastSuccessfulAt: snapshot.lastSuccessfulAt?.toISOString() ?? null,
    errorCode: snapshot.errorCode,
    errorMessage: snapshot.errorMessage,
    runtimeMode: beautyDailyBriefRuntimeMode(),
    schedulerEnabled: env.BEAUTY_DAILY_BRIEF_SCHEDULER_ENABLED === "true",
    formalAutomationEnabled: beautyDailyBriefFormalAutomationEnabled(),
    controlledNotice: env.BEAUTY_DAILY_BRIEF_RUNTIME_MODE === "controlled_mock" ? "受控测试环境：结果不是实时资讯，也不代表真实模型质量。" : null,
    report: snapshot.report as unknown as BeautyDailyBriefReport | null
  }));
}

export async function enqueueBeautyDailyBrief(params: {
  tenantId: string;
  userId: string;
  businessDate: string;
  trigger: BeautyDailyBriefTrigger;
}): Promise<{ snapshotId: string; reused: boolean; status: string }> {
  if (env.DATA_MODE !== "database") throw new Error("beauty_daily_brief_database_required");
  if (env.BEAUTY_DAILY_BRIEF_RUNTIME_MODE === "disabled") throw new Error("beauty_daily_brief_not_enabled");
  const uniqueKey = beautyDailyBriefUniqueKey(params.businessDate);
  const runAt = new Date();
  try {
    const snapshot = await prisma.$transaction(async (tx) => {
      const task = await tx.automationTask.create({
        data: {
          tenantId: params.tenantId,
          userId: params.userId,
          type: "beauty_daily_brief",
          payload: toPrismaJson({
            productCode: BEAUTY_DAILY_BRIEF_PRODUCT_CODE,
            capabilityId: BEAUTY_DAILY_BRIEF_CAPABILITY_ID,
            contractVersion: BEAUTY_DAILY_BRIEF_CONTRACT_VERSION,
            businessDate: params.businessDate,
            timeZone: BEAUTY_DAILY_BRIEF_TIME_ZONE,
            uniqueKey,
            trigger: params.trigger,
            publicSourcesOnly: true
          }),
          runAt,
          status: "pending",
          confirmationRequired: false,
          confirmationStatus: "not_required",
          logs: { create: { message: "美业 AI 日报任务已入队", metadata: toPrismaJson({ phase: "queued", trigger: params.trigger, uniqueKey }) } }
        }
      });
      return tx.beautyDailyBriefSnapshot.create({
        data: {
          productCode: BEAUTY_DAILY_BRIEF_PRODUCT_CODE,
          businessDate: params.businessDate,
          contractVersion: BEAUTY_DAILY_BRIEF_CONTRACT_VERSION,
          tenantId: params.tenantId,
          userId: params.userId,
          automationTaskId: task.id,
          status: "queued",
          phase: "queued",
          trigger: params.trigger
        }
      });
    });
    return { snapshotId: snapshot.id, reused: false, status: snapshot.status };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await prisma.beautyDailyBriefSnapshot.findUniqueOrThrow({
        where: { productCode_businessDate_contractVersion: { productCode: BEAUTY_DAILY_BRIEF_PRODUCT_CODE, businessDate: params.businessDate, contractVersion: BEAUTY_DAILY_BRIEF_CONTRACT_VERSION } }
      });
      return { snapshotId: existing.id, reused: true, status: existing.status };
    }
    throw error;
  }
}

export async function retryBeautyDailyBrief(params: { tenantId: string; userId: string; businessDate: string }): Promise<{ snapshotId: string; reused: boolean; status: string }> {
  if (env.DATA_MODE !== "database") throw new Error("beauty_daily_brief_database_required");
  const snapshot = await prisma.beautyDailyBriefSnapshot.findUnique({
    where: { productCode_businessDate_contractVersion: { productCode: BEAUTY_DAILY_BRIEF_PRODUCT_CODE, businessDate: params.businessDate, contractVersion: BEAUTY_DAILY_BRIEF_CONTRACT_VERSION } }
  });
  if (!snapshot) return enqueueBeautyDailyBrief({ ...params, trigger: "manual" });
  if (snapshot.status === "succeeded" || ACTIVE_STATUSES.includes(snapshot.status)) return { snapshotId: snapshot.id, reused: true, status: snapshot.status };
  if (env.BEAUTY_DAILY_BRIEF_RUNTIME_MODE === "live" && env.BEAUTY_DAILY_BRIEF_MANUAL_RETRY_APPROVED !== "true") throw new Error("beauty_daily_brief_manual_retry_not_approved");
  if (snapshot.providerCallCount > 0 || snapshot.status === "terminal_unknown") throw new Error("beauty_daily_brief_retry_terminal_unknown");
  const claimed = await prisma.beautyDailyBriefSnapshot.updateMany({
    where: { id: snapshot.id, status: snapshot.status, manualRetryCount: snapshot.manualRetryCount },
    data: { status: "queued", phase: "queued", trigger: "manual", errorCode: null, errorMessage: null, manualRetryCount: { increment: 1 }, lockedBy: null, leaseExpiresAt: null }
  });
  if (claimed.count !== 1) return { snapshotId: snapshot.id, reused: true, status: snapshot.status };
  if (snapshot.automationTaskId) await prisma.automationTask.update({ where: { id: snapshot.automationTaskId }, data: { status: "pending", runAt: new Date(), lockedAt: null, deviceId: null } });
  return { snapshotId: snapshot.id, reused: false, status: "queued" };
}

export async function processBeautyDailyBriefSnapshot(snapshotId: string, workerId = `beauty-daily-${randomUUID()}`): Promise<void> {
  if (env.DATA_MODE !== "database") return;
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + LEASE_MS);
  const claimed = await prisma.beautyDailyBriefSnapshot.updateMany({
    where: {
      id: snapshotId,
      OR: [
        { status: "queued" },
        { status: { in: ACTIVE_STATUSES }, leaseExpiresAt: { lt: now }, providerCallCount: 0 }
      ]
    },
    data: { status: "collecting_sources", phase: "collecting_sources", lockedBy: workerId, leaseExpiresAt, attemptCount: { increment: 1 }, errorCode: null, errorMessage: null }
  });
  if (claimed.count !== 1) return;
  const snapshot = await prisma.beautyDailyBriefSnapshot.findUniqueOrThrow({ where: { id: snapshotId } });
  if (snapshot.automationTaskId) await prisma.automationTask.update({ where: { id: snapshot.automationTaskId }, data: { status: "claimed", lockedAt: now } });
  try {
    if (env.BEAUTY_DAILY_BRIEF_RUNTIME_MODE === "disabled") throw new Error("beauty_daily_brief_not_enabled");
    const cutoffAt = new Date(`${snapshot.businessDate}T09:00:00+08:00`);
    if (env.BEAUTY_DAILY_BRIEF_RUNTIME_MODE === "live") {
      await processLiveBeautyDailyBrief(snapshot, cutoffAt);
      return;
    }
    const candidates = buildControlledBeautyDailyBriefSources(cutoffAt);
    await updatePhase(snapshot, "verifying_sources", candidates.length);
    const selected = selectBeautyDailyBriefSources({ candidates, cutoffAt, runtimeMode: "controlled_mock" });
    if (!selected.ok) {
      await failSnapshot(snapshot, "source_insufficient", `24小时可用${selected.available24h}条，72小时可用${selected.available72h}条`, "source_insufficient");
      return;
    }
    await updatePhase(snapshot, "generating", selected.items.length);
    await updatePhase(snapshot, "validating_contract", selected.items.length);
    const report = composeBeautyDailyBriefReport({
      items: selected.items,
      businessDate: snapshot.businessDate,
      cutoffAt,
      trigger: snapshot.trigger as BeautyDailyBriefTrigger,
      runtimeMode: "controlled_mock",
      sourceWindowHours: selected.sourceWindowHours,
      trends: controlledBeautyDailyBriefTrends(),
      todayAction: controlledBeautyDailyBriefAction()
    });
    await prisma.$transaction(async (tx) => {
      await tx.beautyDailyBriefSnapshot.update({
        where: { id: snapshot.id },
        data: {
          status: "succeeded",
          phase: "succeeded",
          sourceWindowHours: selected.sourceWindowHours,
          sourceCount: 15,
          report: toPrismaJson(report),
          lastSuccessfulAt: new Date(report.lastSuccessfulAt),
          providerCallCount: 0,
          networkRequestCount: 0,
          providerCostYuan: 0,
          lockedBy: null,
          leaseExpiresAt: null
        }
      });
      if (snapshot.automationTaskId) {
        await tx.automationTask.update({
          where: { id: snapshot.automationTaskId },
          data: { status: "succeeded", lockedAt: null, logs: { create: { message: "美业 AI 日报受控测试任务完成", metadata: toPrismaJson({ sourceCount: 15, providerCalls: 0, networkRequests: 0, costYuan: 0 }) } } }
        });
      }
    });
  } catch (error) {
    await failSnapshot(snapshot, classifyDailyError(error), safeDailyErrorMessage(error), "failed");
  }
}

async function processLiveBeautyDailyBrief(snapshot: Awaited<ReturnType<typeof prisma.beautyDailyBriefSnapshot.findUniqueOrThrow>>, cutoffAt: Date): Promise<void> {
  const configIssues = validateBeautyDailyBriefLiveConfig({
    dailyHttp: env.BEAUTY_DAILY_BRIEF_DAILY_NETWORK_REQUEST_LIMIT,
    monthlyHttp: env.BEAUTY_DAILY_BRIEF_MONTHLY_NETWORK_REQUEST_LIMIT,
    dailyModels: env.BEAUTY_DAILY_BRIEF_DAILY_MODEL_CALL_LIMIT,
    monthlyModels: env.BEAUTY_DAILY_BRIEF_MONTHLY_MODEL_CALL_LIMIT,
    dailyCost: env.BEAUTY_DAILY_BRIEF_DAILY_COST_LIMIT_YUAN,
    monthlyCost: env.BEAUTY_DAILY_BRIEF_MONTHLY_COST_LIMIT_YUAN
  });
  if (configIssues.length) throw new Error(`beauty_daily_brief_live_config_failed:${configIssues.join(",")}`);
  const collection = await collectBeautyDailyBriefSources({
    cutoffAt,
    beforeRequest: async ({ kind }) => reserveBeautyDailyBriefNetworkRequest(snapshot.id, snapshot.businessDate, kind)
  });
  await logSourceCollection(snapshot, collection);
  await updatePhase(snapshot, "verifying_sources", collection.candidates.length);
  const within24 = collection.candidates.filter((item) => cutoffAt.getTime() - new Date(item.publishedAt).getTime() <= 24 * 3_600_000);
  const candidates = within24.length >= 15 ? within24 : collection.candidates;
  const sourceWindowHours = within24.length >= 15 ? 24 : 72;
  const diversityIssues = validateBeautyDailyBriefCandidateDiversity(candidates);
  if (candidates.length < 15 || diversityIssues.length) {
    await failSnapshot(snapshot, "source_insufficient", `24小时合格${within24.length}条，72小时合格${collection.candidates.length}条；来源多样性门禁${diversityIssues.length ? "未通过" : "通过"}；未调用模型。`, "source_insufficient");
    return;
  }
  const active = getActiveLlmConfig();
  if (active.provider !== "deepseek" || active.model.trim().toLowerCase() !== "deepseek-v4-pro" || !active.apiKey || !active.baseUrl) {
    throw new Error("beauty_daily_brief_provider_config_invalid");
  }
  const prompt = buildBeautyDailyBriefLivePrompt({ businessDate: snapshot.businessDate, cutoffAt, sourceWindowHours, trigger: snapshot.trigger as BeautyDailyBriefTrigger, candidates });
  await reserveBeautyDailyBriefModelCall(snapshot.id, snapshot.businessDate);
  await updatePhase(snapshot, "generating", candidates.length);
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
    raw = await provider.complete([{ role: "user", content: prompt }], { thinkingMode: "disabled", maxTokens: BEAUTY_DAILY_BRIEF_LIVE_LIMITS.maxOutputTokens, responseFormat: "json_object" });
  } catch (error) {
    await failSnapshot(snapshot, "provider_terminal_unknown", "真实模型调用未形成可验证成功结果；当日禁止追加调用。", "terminal_unknown");
    return;
  }
  if (!usage || usage.finishReason !== "stop" || usage.promptTokens > BEAUTY_DAILY_BRIEF_LIVE_LIMITS.maxPromptTokens || usage.completionTokens > BEAUTY_DAILY_BRIEF_LIVE_LIMITS.maxOutputTokens) {
    await failSnapshot(snapshot, "provider_usage_gate_failed", "真实模型用量或终态未通过硬门禁；当日禁止追加调用。", "terminal_unknown");
    return;
  }
  const observedUsage = usage as DomesticProviderUsageObservation;
  const cost = estimateBeautyDailyBriefModelCost(observedUsage.promptTokens, observedUsage.completionTokens);
  if (cost > env.BEAUTY_DAILY_BRIEF_DAILY_COST_LIMIT_YUAN) {
    await failSnapshot(snapshot, "provider_cost_gate_failed", "真实模型费用证据超过单日硬上限；未发布日报。", "terminal_unknown");
    return;
  }
  await updatePhase(snapshot, "validating_contract", candidates.length);
  let report: BeautyDailyBriefReport;
  try { report = parseBeautyDailyBriefLiveReport(raw, candidates); }
  catch (error) {
    await failSnapshot(snapshot, classifyDailyError(error), safeDailyErrorMessage(error), "failed");
    await prisma.beautyDailyBriefSnapshot.update({ where: { id: snapshot.id }, data: { providerCostYuan: cost } });
    return;
  }
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: snapshot.tenantId }, select: { type: true } });
  await prisma.$transaction(async (tx) => {
    const run = await tx.agentRun.create({
      data: {
        tenantId: snapshot.tenantId,
        userId: snapshot.userId,
        capabilityId: BEAUTY_DAILY_BRIEF_CAPABILITY_ID,
        requestId: beautyDailyBriefUniqueKey(snapshot.businessDate),
        requestFingerprint: beautyDailyBriefUniqueKey(snapshot.businessDate),
        routingSource: "scheduled_fixed_capability",
        skillId: "beauty-daily-brief",
        skillVersion: BEAUTY_DAILY_BRIEF_CONTRACT_VERSION,
        tenantType: tenant.type,
        status: "succeeded",
        input: JSON.stringify({ businessDate: snapshot.businessDate, sourceCount: 15, publicSourcesOnly: true }),
        output: JSON.stringify(report),
        modelProvider: "deepseek",
        productCode: BEAUTY_DAILY_BRIEF_PRODUCT_CODE,
        operatingEntityId: BEAUTY_DAILY_BRIEF_PRODUCT_CODE,
        usageChannel: "automation",
        tokenEstimate: observedUsage.totalTokens,
        creditCost: 0,
        qualityFlags: toPrismaJson([])
      }
    });
    await tx.beautyDailyBriefSnapshot.update({
      where: { id: snapshot.id },
      data: { status: "succeeded", phase: "succeeded", sourceWindowHours, sourceCount: 15, report: toPrismaJson(report), lastSuccessfulAt: new Date(report.lastSuccessfulAt), providerCostYuan: cost, lockedBy: null, leaseExpiresAt: null }
    });
    if (snapshot.automationTaskId) await tx.automationTask.update({ where: { id: snapshot.automationTaskId }, data: { status: "succeeded", lockedAt: null, logs: { create: { message: "美业 AI 日报真实任务完成", metadata: toPrismaJson({ sourceCount: 15, providerCalls: 1, networkRequests: collection.requestCount, costYuan: cost, agentRunId: run.id, fallbackUsed: false }) } } } });
  });
}

async function reserveBeautyDailyBriefNetworkRequest(snapshotId: string, businessDate: string, kind: "list" | "detail"): Promise<void> {
  const month = businessDate.slice(0, 7);
  await prisma.$transaction(async (tx) => {
    const [snapshot, monthly] = await Promise.all([
      tx.beautyDailyBriefSnapshot.findUniqueOrThrow({ where: { id: snapshotId }, select: { networkRequestCount: true } }),
      tx.beautyDailyBriefSnapshot.aggregate({ where: { productCode: BEAUTY_DAILY_BRIEF_PRODUCT_CODE, contractVersion: BEAUTY_DAILY_BRIEF_CONTRACT_VERSION, businessDate: { startsWith: month } }, _sum: { networkRequestCount: true } })
    ]);
    if (snapshot.networkRequestCount >= env.BEAUTY_DAILY_BRIEF_DAILY_NETWORK_REQUEST_LIMIT || (monthly._sum.networkRequestCount ?? 0) >= env.BEAUTY_DAILY_BRIEF_MONTHLY_NETWORK_REQUEST_LIMIT) throw new Error("beauty_daily_brief_network_budget_exceeded");
    await tx.beautyDailyBriefSnapshot.update({ where: { id: snapshotId }, data: { networkRequestCount: { increment: 1 } } });
    const row = await tx.beautyDailyBriefSnapshot.findUniqueOrThrow({ where: { id: snapshotId }, select: { automationTaskId: true } });
    if (row.automationTaskId) await tx.automationLog.create({ data: { taskId: row.automationTaskId, message: "美业 AI 日报公开来源请求已计数", metadata: toPrismaJson({ kind }) } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

async function reserveBeautyDailyBriefModelCall(snapshotId: string, businessDate: string): Promise<void> {
  const month = businessDate.slice(0, 7);
  if (estimateBeautyDailyBriefWorstModelCost() > env.BEAUTY_DAILY_BRIEF_DAILY_COST_LIMIT_YUAN) throw new Error("beauty_daily_brief_model_budget_exceeded");
  await prisma.$transaction(async (tx) => {
    const [snapshot, monthly] = await Promise.all([
      tx.beautyDailyBriefSnapshot.findUniqueOrThrow({ where: { id: snapshotId }, select: { providerCallCount: true } }),
      tx.beautyDailyBriefSnapshot.aggregate({ where: { productCode: BEAUTY_DAILY_BRIEF_PRODUCT_CODE, contractVersion: BEAUTY_DAILY_BRIEF_CONTRACT_VERSION, businessDate: { startsWith: month } }, _sum: { providerCallCount: true, providerCostYuan: true } })
    ]);
    if (snapshot.providerCallCount >= env.BEAUTY_DAILY_BRIEF_DAILY_MODEL_CALL_LIMIT || (monthly._sum.providerCallCount ?? 0) >= env.BEAUTY_DAILY_BRIEF_MONTHLY_MODEL_CALL_LIMIT) throw new Error("beauty_daily_brief_model_call_budget_exceeded");
    if (Number(monthly._sum.providerCostYuan ?? 0) + estimateBeautyDailyBriefWorstModelCost() > env.BEAUTY_DAILY_BRIEF_MONTHLY_COST_LIMIT_YUAN) throw new Error("beauty_daily_brief_monthly_cost_budget_exceeded");
    await tx.beautyDailyBriefSnapshot.update({ where: { id: snapshotId }, data: { providerCallCount: { increment: 1 } } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

async function logSourceCollection(snapshot: { automationTaskId: string | null }, collection: Awaited<ReturnType<typeof collectBeautyDailyBriefSources>>): Promise<void> {
  if (!snapshot.automationTaskId) return;
  const grouped = new Map<string, typeof collection.observations>();
  for (const observation of collection.observations) grouped.set(observation.host, [...(grouped.get(observation.host) ?? []), observation]);
  const byHost = [...grouped.entries()].map(([host, rows]) => ({ host, requests: rows.length, statuses: [...new Set(rows.map((row) => row.status))], redirectClasses: [...new Set(rows.map((row) => row.redirectClass))], retryableCount: rows.filter((row) => row.retryable).length, elapsedMs: rows.reduce((sum, row) => sum + row.elapsedMs, 0) }));
  await prisma.automationLog.create({ data: { taskId: snapshot.automationTaskId, message: "美业 AI 日报公开来源采集完成", metadata: toPrismaJson({ requestCount: collection.requestCount, listRequestCount: collection.listRequestCount, detailRequestCount: collection.detailRequestCount, redirectBlockedCount: collection.redirectBlockedCount, qualifiedCandidates: collection.candidates.length, byHost, sourceStats: collection.sourceStats }) } });
}

export async function runBeautyDailyBriefSchedulerTick(now = new Date()): Promise<{ enqueued: boolean; reason: string; snapshotId?: string }> {
  if (env.DATA_MODE !== "database" || env.BEAUTY_DAILY_BRIEF_SCHEDULER_ENABLED !== "true") return { enqueued: false, reason: "scheduler_disabled" };
  const tenantId = env.BEAUTY_DAILY_BRIEF_SCHEDULER_TENANT_ID;
  const userId = env.BEAUTY_DAILY_BRIEF_SCHEDULER_USER_ID;
  if (!tenantId || !userId) return { enqueued: false, reason: "scheduler_identity_missing" };
  const entitlement = await prisma.tenantProductEntitlement.findFirst({
    where: { tenantId, productCode: BEAUTY_DAILY_BRIEF_PRODUCT_CODE, status: "active", OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    select: { id: true }
  });
  if (!entitlement) return { enqueued: false, reason: "scheduler_entitlement_missing" };
  const clock = readBeautyDailyBriefClock(now);
  const existing = await prisma.beautyDailyBriefSnapshot.findUnique({
    where: { productCode_businessDate_contractVersion: { productCode: BEAUTY_DAILY_BRIEF_PRODUCT_CODE, businessDate: clock.businessDate, contractVersion: BEAUTY_DAILY_BRIEF_CONTRACT_VERSION } }
  });
  const decision = decideBeautyDailyBriefSchedule({ now, hasSucceeded: existing?.status === "succeeded", hasActiveTask: Boolean(existing && ACTIVE_STATUSES.includes(existing.status)) });
  if (!decision.shouldEnqueue || !decision.trigger) return { enqueued: false, reason: decision.reason };
  const queued = await enqueueBeautyDailyBrief({ tenantId, userId, businessDate: decision.businessDate, trigger: decision.trigger });
  if (!queued.reused) void processBeautyDailyBriefSnapshot(queued.snapshotId);
  return { enqueued: !queued.reused, reason: queued.reused ? "unique_key_reused" : decision.reason, snapshotId: queued.snapshotId };
}

export function registerBeautyDailyBriefScheduler(app: { addHook: (name: "onReady" | "onClose", handler: () => void | Promise<void>) => void }): void {
  let timer: ReturnType<typeof setInterval> | undefined;
  app.addHook("onReady", () => {
    if (env.BEAUTY_DAILY_BRIEF_SCHEDULER_ENABLED !== "true") return;
    void runBeautyDailyBriefSchedulerTick();
    timer = setInterval(() => { void runBeautyDailyBriefSchedulerTick(); }, 30_000);
    timer.unref?.();
  });
  app.addHook("onClose", () => { if (timer) clearInterval(timer); });
}

async function updatePhase(snapshot: { id: string; automationTaskId: string | null }, phase: string, sourceCount: number): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.beautyDailyBriefSnapshot.update({ where: { id: snapshot.id }, data: { status: phase, phase, sourceCount, leaseExpiresAt: new Date(Date.now() + LEASE_MS) } });
    if (snapshot.automationTaskId) await tx.automationLog.create({ data: { taskId: snapshot.automationTaskId, message: `美业 AI 日报阶段：${phase}`, metadata: toPrismaJson({ phase, sourceCount }) } });
  });
}

async function failSnapshot(snapshot: { id: string; automationTaskId: string | null }, errorCode: string, errorMessage: string, status: "failed" | "source_insufficient" | "terminal_unknown"): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.beautyDailyBriefSnapshot.update({ where: { id: snapshot.id }, data: { status, phase: status, errorCode, errorMessage, lockedBy: null, leaseExpiresAt: null } });
    if (snapshot.automationTaskId) await tx.automationTask.update({ where: { id: snapshot.automationTaskId }, data: { status: "failed", lockedAt: null, logs: { create: { message: "美业 AI 日报任务停止", level: "error", metadata: toPrismaJson({ errorCode, phase: status }) } } } });
  });
}

function classifyDailyError(error: unknown): string {
  const message = error instanceof Error ? error.message : "beauty_daily_brief_failed";
  if (message.includes("not_authorized")) return "external_execution_not_authorized";
  if (message.includes("contract_failed")) return "contract_validation_failed";
  return "beauty_daily_brief_failed";
}
function safeDailyErrorMessage(error: unknown): string {
  const code = classifyDailyError(error);
  if (code === "external_execution_not_authorized") return "真实公开来源读取与模型生成尚未取得持续运行授权，任务已在任何外部请求前停止。";
  if (code === "contract_validation_failed") return "日报没有通过正式结构、来源或合规校验，未保存结果且未结算费用。";
  return "日报任务未完成；请查看阶段状态后再决定是否人工重试。";
}

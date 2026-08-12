import { createHash } from "node:crypto";
import { Prisma, prisma } from "@baolu/db";

export const QUALITY_REVIEWER_VERSION = "continuous-improvement-v1";

export const OUTCOME_EVENT_TYPES = [
  "output_viewed",
  "copied",
  "downloaded",
  "regenerated",
  "edited",
  "continued",
  "abandoned",
  "task_completed",
  "business_outcome_positive",
  "business_outcome_negative"
] as const;

export type OutcomeEventType = (typeof OUTCOME_EVENT_TYPES)[number];

export interface QualityFeedbackInput {
  rating?: number | null;
  issueType?: string | null;
  reasonCodes?: unknown;
}

export interface OutcomeEventInput {
  eventType: string;
  value?: number | null;
}

export interface QualityRunInput {
  id: string;
  agentId?: string | null;
  skillId: string;
  skillVersion: string;
  status: string;
  input: string;
  output?: string | null;
  errorMessage?: string | null;
  qualityFlags?: unknown;
  createdAt: Date;
  feedback?: QualityFeedbackInput[];
  outcomeEvents?: OutcomeEventInput[];
}

export interface RunQualityReview {
  agentRunId: string;
  agentId: string | null;
  skillId: string;
  skillVersion: string;
  deterministicScore: number;
  feedbackScore: number | null;
  behaviorScore: number | null;
  overallScore: number;
  hardGatePassed: boolean;
  issues: string[];
  signals: {
    status: string;
    qualityFlagTokens: string[];
    feedbackCount: number;
    outcomeEventCounts: Record<string, number>;
  };
}

export interface FailureClusterResult {
  fingerprint: string;
  category: string;
  severity: "critical" | "high" | "medium";
  agentId: string | null;
  skillId: string;
  occurrenceCount: number;
  sampleRunIds: string[];
  evidenceSummary: string;
}

export interface ImprovementCandidateResult {
  candidateKey: string;
  clusterFingerprint: string;
  type: "prompt" | "skill_contract" | "routing" | "tooling" | "knowledge" | "code" | "eval";
  targetKey: string;
  rationale: string;
  proposedChange: Record<string, unknown>;
  riskLevel: "critical" | "high" | "medium";
  requiresHumanApproval: true;
  status: "awaiting_review";
}

export interface LearnedEvalDraft {
  caseKey: string;
  clusterFingerprint: string;
  sourceAgentRunId: string;
  agentId: string | null;
  skillId: string;
  inputSanitized: string;
  expectedBehavior: Record<string, unknown>;
  forbiddenBehavior: Record<string, unknown>;
  status: "draft";
}

export interface DailyImprovementAnalysis {
  periodStart: Date;
  periodEnd: Date;
  snapshotDate: Date;
  scopeKey: string;
  reviews: RunQualityReview[];
  snapshot: {
    runCount: number;
    succeededCount: number;
    failedCount: number;
    flaggedCount: number;
    feedbackCount: number;
    positiveCount: number;
    negativeCount: number;
    hardGateFailureCount: number;
    averageScore: number;
    metrics: Record<string, unknown>;
  };
  clusters: FailureClusterResult[];
  candidates: ImprovementCandidateResult[];
  evalDrafts: LearnedEvalDraft[];
}

const CRITICAL_TOKEN_PATTERN =
  /(cross.?tenant|tenant.?leak|data.?leak|secret|credential|unauthorized.?action|payment.?executed|publish.?executed|fabricat|hallucinat|越权|跨租户|泄露|密钥|未授权执行|擅自支付|擅自发布|编造)/i;

const CATEGORY_RULES: Array<{ category: string; pattern: RegExp }> = [
  { category: "security_privacy", pattern: /(cross.?tenant|tenant.?leak|data.?leak|secret|credential|越权|跨租户|泄露|密钥)/i },
  { category: "unauthorized_action", pattern: /(unauthorized.?action|payment.?executed|publish.?executed|未授权执行|擅自支付|擅自发布)/i },
  { category: "hallucination", pattern: /(fabricat|hallucinat|unsupported.?fact|factual.?error|编造|幻觉|虚假事实|事实不准)/i },
  { category: "wrong_routing", pattern: /(routing|wrong.?agent|wrong.?skill|路由|选错智能体|选错技能)/i },
  { category: "tool_failure", pattern: /(tool|mcp|timeout|network|工具|超时|网络)/i },
  { category: "format_contract", pattern: /(format|schema|contract|missing.?field|格式|结构|契约|缺字段)/i },
  { category: "incomplete_output", pattern: /(incomplete|truncat|empty.?output|不完整|截断|空输出)/i },
  { category: "slow_response", pattern: /(slow|latency|耗时|缓慢)/i },
  { category: "user_rejection", pattern: /(bad.?answer|not.?helpful|not.?relevant|incorrect|用户不满意|无帮助|错误答案|没有解决)/i }
];

const OUTCOME_WEIGHTS: Record<string, number> = {
  output_viewed: 0,
  copied: 8,
  downloaded: 10,
  regenerated: -12,
  edited: -4,
  continued: 8,
  abandoned: -18,
  task_completed: 18,
  business_outcome_positive: 24,
  business_outcome_negative: -28
};

export function sanitizeLearningInput(value: string, maxLength = 1_000): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[EMAIL]")
    .replace(/(?<!\d)1[3-9]\d{9}(?!\d)/g, "[PHONE]")
    .replace(/(?<!\d)\d{17}[\dXx](?!\d)/g, "[ID_NUMBER]")
    .replace(/(api[_-]?key|token|secret|password)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .slice(0, maxLength);
}

export function reviewAgentRun(run: QualityRunInput): RunQualityReview {
  const feedback = run.feedback ?? [];
  const events = run.outcomeEvents ?? [];
  const qualityFlagTokens = extractSignalTokens(run.qualityFlags);
  const feedbackTokens = feedback.flatMap((item) => [
    item.issueType ?? "",
    ...extractSignalTokens(item.reasonCodes)
  ]);
  const combinedTokens = [...qualityFlagTokens, ...feedbackTokens];
  const issues = new Set<string>();

  if (run.status === "failed") issues.add("reliability_failure");
  if (run.status === "succeeded" && !run.output?.trim()) issues.add("incomplete_output");
  if (run.errorMessage) issues.add(classifyText(run.errorMessage) ?? "reliability_failure");
  for (const token of combinedTokens) {
    const category = classifyText(token);
    if (category) issues.add(category);
  }

  const hardGatePassed = !combinedTokens.some((token) => CRITICAL_TOKEN_PATTERN.test(token));
  let deterministicScore = 100;
  if (run.status === "failed") deterministicScore -= 60;
  if (run.status === "needs_input") deterministicScore -= 8;
  if (run.status === "succeeded" && !run.output?.trim()) deterministicScore -= 45;
  if (run.errorMessage) deterministicScore -= 15;
  deterministicScore -= Math.min(qualityFlagTokens.length * 5, 20);
  deterministicScore -= [...issues].reduce((sum, issue) => sum + issuePenalty(issue), 0);
  deterministicScore = clampScore(deterministicScore);

  const ratings = feedback
    .map((item) => item.rating)
    .filter((rating): rating is number => typeof rating === "number");
  const feedbackScore = ratings.length
    ? clampScore(Math.round(ratings.reduce((sum, rating) => sum + (rating - 1) * 25, 0) / ratings.length))
    : null;

  const eventCounts: Record<string, number> = {};
  let eventDelta = 0;
  for (const event of events) {
    eventCounts[event.eventType] = (eventCounts[event.eventType] ?? 0) + 1;
    eventDelta += OUTCOME_WEIGHTS[event.eventType] ?? 0;
  }
  const behaviorScore = events.length ? clampScore(70 + eventDelta) : null;

  const weighted: Array<[number, number]> = [[deterministicScore, 0.5]];
  if (feedbackScore !== null) weighted.push([feedbackScore, 0.3]);
  if (behaviorScore !== null) weighted.push([behaviorScore, 0.2]);
  const weightTotal = weighted.reduce((sum, [, weight]) => sum + weight, 0);
  let overallScore = Math.round(weighted.reduce((sum, [score, weight]) => sum + score * weight, 0) / weightTotal);
  if (!hardGatePassed) overallScore = Math.min(overallScore, 39);

  if (feedbackScore !== null && feedbackScore <= 25) issues.add("user_rejection");
  if (behaviorScore !== null && behaviorScore <= 45) issues.add("user_rejection");

  return {
    agentRunId: run.id,
    agentId: run.agentId ?? null,
    skillId: run.skillId,
    skillVersion: run.skillVersion,
    deterministicScore,
    feedbackScore,
    behaviorScore,
    overallScore,
    hardGatePassed,
    issues: [...issues].sort(),
    signals: {
      status: run.status,
      qualityFlagTokens,
      feedbackCount: feedback.length,
      outcomeEventCounts: eventCounts
    }
  };
}

export function analyzeDailyQuality(input: {
  runs: QualityRunInput[];
  periodStart: Date;
  periodEnd: Date;
  scopeKey?: string;
  minimumRunSample?: number;
}): DailyImprovementAnalysis {
  const scopeKey = input.scopeKey ?? "global";
  const minimumRunSample = input.minimumRunSample ?? 1;
  const snapshotDate = startOfUtcDay(input.periodStart);
  const reviews = input.runs.map(reviewAgentRun);
  const clusterMap = new Map<string, FailureClusterResult>();
  const runById = new Map(input.runs.map((run) => [run.id, run]));

  for (const review of reviews) {
    if (review.overallScore >= 75 && review.hardGatePassed && review.issues.length === 0) continue;
    const categories = review.issues.length ? review.issues : ["low_quality_unknown"];
    for (const category of categories) {
      const fingerprint = `${category}:${review.agentId ?? "unassigned"}:${review.skillId}`;
      const existing = clusterMap.get(fingerprint);
      if (existing) {
        existing.occurrenceCount += 1;
        if (existing.sampleRunIds.length < 5) existing.sampleRunIds.push(review.agentRunId);
        continue;
      }
      clusterMap.set(fingerprint, {
        fingerprint,
        category,
        severity: severityFor(category, review.hardGatePassed),
        agentId: review.agentId,
        skillId: review.skillId,
        occurrenceCount: 1,
        sampleRunIds: [review.agentRunId],
        evidenceSummary: evidenceSummaryFor(category, review.skillId)
      });
    }
  }

  const clusters = [...clusterMap.values()].sort(
    (a, b) => severityRank(b.severity) - severityRank(a.severity) || b.occurrenceCount - a.occurrenceCount
  );
  const eligibleClusters = clusters.filter(
    (cluster) => cluster.severity === "critical" || (input.runs.length >= minimumRunSample && cluster.occurrenceCount >= 2)
  );
  const candidates = eligibleClusters.map((cluster) => buildCandidate(cluster, snapshotDate));
  const evalDrafts = eligibleClusters
    .map((cluster) => {
      const sourceRun = runById.get(cluster.sampleRunIds[0]);
      return sourceRun ? buildEvalDraft(cluster, sourceRun, snapshotDate) : null;
    })
    .filter((item): item is LearnedEvalDraft => item !== null);
  const averageScore = reviews.length
    ? Math.round((reviews.reduce((sum, review) => sum + review.overallScore, 0) / reviews.length) * 100) / 100
    : 0;
  const categoryCounts = clusters.reduce<Record<string, number>>((acc, cluster) => {
    acc[cluster.category] = (acc[cluster.category] ?? 0) + cluster.occurrenceCount;
    return acc;
  }, {});

  return {
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    snapshotDate,
    scopeKey,
    reviews,
    snapshot: {
      runCount: reviews.length,
      succeededCount: input.runs.filter((run) => run.status === "succeeded").length,
      failedCount: input.runs.filter((run) => run.status === "failed").length,
      flaggedCount: reviews.filter((review) => review.issues.length > 0).length,
      feedbackCount: input.runs.reduce((sum, run) => sum + (run.feedback?.length ?? 0), 0),
      positiveCount: reviews.filter((review) => review.overallScore >= 80 && review.hardGatePassed).length,
      negativeCount: reviews.filter((review) => review.overallScore < 60 || !review.hardGatePassed).length,
      hardGateFailureCount: reviews.filter((review) => !review.hardGatePassed).length,
      averageScore,
      metrics: {
        reviewerVersion: QUALITY_REVIEWER_VERSION,
        minimumRunSample,
        sampleThresholdMet: input.runs.length >= minimumRunSample,
        categoryCounts,
        scoreBuckets: {
          excellent: reviews.filter((review) => review.overallScore >= 90).length,
          good: reviews.filter((review) => review.overallScore >= 75 && review.overallScore < 90).length,
          needsImprovement: reviews.filter((review) => review.overallScore >= 60 && review.overallScore < 75).length,
          poor: reviews.filter((review) => review.overallScore < 60).length
        }
      }
    },
    clusters,
    candidates,
    evalDrafts
  };
}

export async function runDailyImprovementCycle(options: {
  periodStart: Date;
  periodEnd: Date;
  scopeKey?: string;
  persist?: boolean;
  minimumRunSample?: number;
}): Promise<DailyImprovementAnalysis & { persisted: boolean; snapshotId?: string }> {
  const runs = await prisma.agentRun.findMany({
    where: {
      createdAt: {
        gte: options.periodStart,
        lt: options.periodEnd
      }
    },
    orderBy: { createdAt: "asc" },
    include: {
      feedback: true,
      outcomeEvents: true
    }
  });

  const analysis = analyzeDailyQuality({
    runs: runs.map((run) => ({
      id: run.id,
      agentId: run.agentId,
      skillId: run.skillId,
      skillVersion: run.skillVersion,
      status: run.status,
      input: run.input,
      output: run.output,
      errorMessage: run.errorMessage,
      qualityFlags: run.qualityFlags,
      createdAt: run.createdAt,
      feedback: run.feedback,
      outcomeEvents: run.outcomeEvents
    })),
    periodStart: options.periodStart,
    periodEnd: options.periodEnd,
    scopeKey: options.scopeKey,
    minimumRunSample: options.minimumRunSample
  });

  if (!options.persist) return { ...analysis, persisted: false };

  const snapshotId = await prisma.$transaction(async (tx) => {
    for (const review of analysis.reviews) {
      await tx.agentQualityReview.upsert({
        where: { agentRunId: review.agentRunId },
        create: {
          agentRunId: review.agentRunId,
          deterministicScore: review.deterministicScore,
          feedbackScore: review.feedbackScore,
          behaviorScore: review.behaviorScore,
          overallScore: review.overallScore,
          hardGatePassed: review.hardGatePassed,
          issues: asJson(review.issues),
          signals: asJson(review.signals),
          reviewerVersion: QUALITY_REVIEWER_VERSION
        },
        update: {
          deterministicScore: review.deterministicScore,
          feedbackScore: review.feedbackScore,
          behaviorScore: review.behaviorScore,
          overallScore: review.overallScore,
          hardGatePassed: review.hardGatePassed,
          issues: asJson(review.issues),
          signals: asJson(review.signals),
          reviewerVersion: QUALITY_REVIEWER_VERSION,
          reviewedAt: new Date()
        }
      });
    }

    const snapshot = await tx.dailyQualitySnapshot.upsert({
      where: {
        snapshotDate_scopeKey: {
          snapshotDate: analysis.snapshotDate,
          scopeKey: analysis.scopeKey
        }
      },
      create: {
        snapshotDate: analysis.snapshotDate,
        scopeKey: analysis.scopeKey,
        periodStart: analysis.periodStart,
        periodEnd: analysis.periodEnd,
        ...analysis.snapshot,
        metrics: asJson(analysis.snapshot.metrics)
      },
      update: {
        periodStart: analysis.periodStart,
        periodEnd: analysis.periodEnd,
        ...analysis.snapshot,
        metrics: asJson(analysis.snapshot.metrics),
        generatedAt: new Date()
      }
    });

    const clusterIds = new Map<string, string>();
    for (const cluster of analysis.clusters) {
      const saved = await tx.failureCluster.upsert({
        where: {
          snapshotId_fingerprint: {
            snapshotId: snapshot.id,
            fingerprint: cluster.fingerprint
          }
        },
        create: {
          snapshotId: snapshot.id,
          ...cluster,
          sampleRunIds: asJson(cluster.sampleRunIds)
        },
        update: {
          category: cluster.category,
          severity: cluster.severity,
          agentId: cluster.agentId,
          skillId: cluster.skillId,
          occurrenceCount: cluster.occurrenceCount,
          sampleRunIds: asJson(cluster.sampleRunIds),
          evidenceSummary: cluster.evidenceSummary
        }
      });
      clusterIds.set(cluster.fingerprint, saved.id);
    }

    for (const candidate of analysis.candidates) {
      const sourceClusterId = clusterIds.get(candidate.clusterFingerprint);
      await tx.improvementCandidate.upsert({
        where: { candidateKey: candidate.candidateKey },
        create: {
          candidateKey: candidate.candidateKey,
          sourceSnapshotId: snapshot.id,
          sourceClusterId,
          type: candidate.type,
          targetKey: candidate.targetKey,
          rationale: candidate.rationale,
          proposedChange: asJson(candidate.proposedChange),
          status: candidate.status,
          riskLevel: candidate.riskLevel,
          requiresHumanApproval: true,
          baselineMetrics: asJson(analysis.snapshot.metrics)
        },
        update: {
          sourceClusterId,
          rationale: candidate.rationale,
          proposedChange: asJson(candidate.proposedChange),
          riskLevel: candidate.riskLevel,
          baselineMetrics: asJson(analysis.snapshot.metrics)
        }
      });
    }

    for (const evalDraft of analysis.evalDrafts) {
      await tx.learnedEvalCase.upsert({
        where: { caseKey: evalDraft.caseKey },
        create: {
          caseKey: evalDraft.caseKey,
          sourceAgentRunId: evalDraft.sourceAgentRunId,
          sourceClusterId: clusterIds.get(evalDraft.clusterFingerprint),
          agentId: evalDraft.agentId,
          skillId: evalDraft.skillId,
          inputSanitized: evalDraft.inputSanitized,
          expectedBehavior: asJson(evalDraft.expectedBehavior),
          forbiddenBehavior: asJson(evalDraft.forbiddenBehavior),
          status: "draft"
        },
        update: {
          inputSanitized: evalDraft.inputSanitized,
          expectedBehavior: asJson(evalDraft.expectedBehavior),
          forbiddenBehavior: asJson(evalDraft.forbiddenBehavior)
        }
      });
    }

    return snapshot.id;
  });

  return { ...analysis, persisted: true, snapshotId };
}

function extractSignalTokens(value: unknown, prefix = "", depth = 0): string[] {
  if (value === null || value === undefined || depth > 3) return [];
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    if (value === false || value === "") return [];
    return [`${prefix}${String(value)}`].slice(0, 20);
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => extractSignalTokens(item, prefix, depth + 1)).slice(0, 20);
  }
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .flatMap(([key, item]) => extractSignalTokens(item, prefix ? `${prefix}.${key}:` : `${key}:`, depth + 1))
      .slice(0, 20);
  }
  return [];
}

function classifyText(value: string): string | null {
  for (const rule of CATEGORY_RULES) if (rule.pattern.test(value)) return rule.category;
  return null;
}

function issuePenalty(issue: string): number {
  if (issue === "security_privacy" || issue === "unauthorized_action") return 45;
  if (issue === "hallucination") return 35;
  if (issue === "reliability_failure") return 20;
  if (issue === "wrong_routing" || issue === "tool_failure") return 15;
  return 10;
}

function severityFor(category: string, hardGatePassed: boolean): "critical" | "high" | "medium" {
  if (!hardGatePassed || category === "security_privacy" || category === "unauthorized_action") return "critical";
  if (["hallucination", "reliability_failure", "wrong_routing", "tool_failure"].includes(category)) return "high";
  return "medium";
}

function severityRank(value: FailureClusterResult["severity"]): number {
  return value === "critical" ? 3 : value === "high" ? 2 : 1;
}

function evidenceSummaryFor(category: string, skillId: string): string {
  return `系统在 ${skillId} 的运行证据中识别到 ${category}；仅保留分类、计数和运行 ID，不沉淀用户原文。`;
}

function buildCandidate(cluster: FailureClusterResult, snapshotDate: Date): ImprovementCandidateResult {
  const mapping: Record<string, { type: ImprovementCandidateResult["type"]; action: string }> = {
    security_privacy: { type: "code", action: "补充租户隔离、敏感数据与越权硬门禁，并新增攻击性回归样例" },
    unauthorized_action: { type: "tooling", action: "为外部动作增加显式确认、幂等和审计断言" },
    hallucination: { type: "knowledge", action: "增强事实依据、缺失数据声明和禁止编造评测" },
    wrong_routing: { type: "routing", action: "调整路由契约并补充易混淆意图对照样例" },
    tool_failure: { type: "tooling", action: "补充超时、重试、降级和部分失败契约" },
    format_contract: { type: "skill_contract", action: "收紧输出结构和必填字段断言" },
    incomplete_output: { type: "prompt", action: "补充完整性检查和输出截断恢复策略" },
    slow_response: { type: "code", action: "定位慢步骤并建立耗时预算与超时护栏" },
    user_rejection: { type: "eval", action: "人工复核低分样例，提炼可验证的业务质量标准" },
    reliability_failure: { type: "code", action: "复现失败路径并建立确定性回归与可观测性" },
    low_quality_unknown: { type: "eval", action: "先人工标注原因，再决定修改提示词、知识、路由或代码" }
  };
  const recommendation = mapping[cluster.category] ?? mapping.low_quality_unknown;
  const dateKey = snapshotDate.toISOString().slice(0, 10);
  return {
    candidateKey: stableKey(`${dateKey}:${cluster.fingerprint}:${recommendation.type}`),
    clusterFingerprint: cluster.fingerprint,
    type: recommendation.type,
    targetKey: `${cluster.agentId ?? "unassigned"}/${cluster.skillId}`,
    rationale: `${cluster.evidenceSummary} 当日出现 ${cluster.occurrenceCount} 次。`,
    proposedChange: {
      recommendation: recommendation.action,
      requiredEval: true,
      activationPolicy: "human_approval_then_canary",
      autoActivate: false
    },
    riskLevel: cluster.severity,
    requiresHumanApproval: true,
    status: "awaiting_review"
  };
}

function buildEvalDraft(
  cluster: FailureClusterResult,
  run: QualityRunInput,
  snapshotDate: Date
): LearnedEvalDraft {
  const dateKey = snapshotDate.toISOString().slice(0, 10);
  return {
    caseKey: stableKey(`${dateKey}:${cluster.fingerprint}:${run.id}`),
    clusterFingerprint: cluster.fingerprint,
    sourceAgentRunId: run.id,
    agentId: run.agentId ?? null,
    skillId: run.skillId,
    inputSanitized: sanitizeLearningInput(run.input),
    expectedBehavior: {
      category: cluster.category,
      requirement: "修复候选必须消除该失败类别，并保持既有成功样例通过",
      reviewerRequired: true
    },
    forbiddenBehavior: {
      categories: [cluster.category],
      hardGateFailureAllowed: false,
      productionAutoActivationAllowed: false
    },
    status: "draft"
  };
}

function stableKey(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

function startOfUtcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

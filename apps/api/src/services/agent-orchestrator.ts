import type { SkillRuntimeResult } from "./agent-runtime.js";

export type ExecutionMode = "single" | "parallel" | "sequential" | "hybrid";

export interface ExecutionCapability {
  capabilityId: string;
  title: string;
  skillId: string;
  skillVersion: string;
}

export interface ExecutionStep {
  stepId: string;
  sortOrder: number;
  capabilityId: string;
  title: string;
  skillId: string;
  skillVersion: string;
  dependsOn: string[];
}

export interface ExecutionPlan {
  planId: string;
  mode: ExecutionMode;
  steps: ExecutionStep[];
}

export interface SkillResultEnvelope {
  stepId: string;
  status: "success" | "needs_input" | "failed";
  capabilityId: string;
  title: string;
  skillId: string;
  skillVersion: string;
  answerMarkdown: string;
  artifacts: Array<{ type: string; id: string; label: string }>;
  qualityFlags: string[];
  nextActions: string[];
  creditCost: number;
  analysisMode: "fast" | "deep";
  durationMs: number;
  input: string;
  error?: { code: string; retryable: boolean };
}

export interface OrchestrationExecution {
  plan: ExecutionPlan;
  results: SkillResultEnvelope[];
  failures: Array<{ stepId: string; cause: unknown }>;
}

export interface CombinedOrchestrationResult {
  deliveryStatus: "completed" | "needs_input" | "failed";
  answerText: string;
  skillId: string;
  skillIds: string[];
  skillVersion: string;
  creditCost: number;
  qualityFlags: string[];
  analysisMode: "fast" | "deep";
  nextActions: string[];
  artifacts: Array<{ type: string; id: string; label: string }>;
}

export class AgentExecutionCancelledError extends Error {
  constructor() {
    super("agent_execution_cancelled");
    this.name = "AbortError";
  }
}

export function buildExecutionPlan(planId: string, capabilities: ExecutionCapability[]): ExecutionPlan {
  const unique = Array.from(new Map(capabilities.map((item) => [item.capabilityId, item])).values());
  const hotspot = unique.find((item) => item.capabilityId === "industry_hotspots");
  const steps = unique.map((item, index) => {
    const dependsOn = hotspot && item.capabilityId !== hotspot.capabilityId && isContentCapability(item.capabilityId)
      ? [`step-${hotspot.capabilityId}`]
      : [];
    return {
      stepId: `step-${item.capabilityId}`,
      sortOrder: capabilityPriority(item.capabilityId) * 100 + index,
      capabilityId: item.capabilityId,
      title: item.title,
      skillId: item.skillId,
      skillVersion: item.skillVersion,
      dependsOn
    };
  }).sort((left, right) => left.sortOrder - right.sortOrder);

  const hasDependencies = steps.some((step) => step.dependsOn.length > 0);
  const independentRootCount = steps.filter((step) => step.dependsOn.length === 0).length;
  const mode: ExecutionMode = steps.length <= 1
    ? "single"
    : hasDependencies && independentRootCount > 1
      ? "hybrid"
      : hasDependencies
        ? "sequential"
        : "parallel";
  return { planId, mode, steps };
}

export async function executeExecutionPlan(params: {
  plan: ExecutionPlan;
  buildInput: (step: ExecutionStep, upstream: SkillResultEnvelope[]) => string | Promise<string>;
  invoke: (step: ExecutionStep, input: string, signal: AbortSignal) => Promise<SkillRuntimeResult>;
  signal?: AbortSignal;
  stepTimeoutMs?: number;
  overallTimeoutMs?: number;
}): Promise<OrchestrationExecution> {
  const executionStartedAt = Date.now();
  const stepTimeoutMs = params.stepTimeoutMs ?? 90_000;
  const overallTimeoutMs = params.overallTimeoutMs ?? 150_000;
  const remaining = new Map(params.plan.steps.map((step) => [step.stepId, step]));
  const results = new Map<string, SkillResultEnvelope>();
  const failures: Array<{ stepId: string; cause: unknown }> = [];

  while (remaining.size > 0) {
    throwIfExecutionCancelled(params.signal);
    const overallRemainingMs = overallTimeoutMs - (Date.now() - executionStartedAt);
    if (overallRemainingMs <= 0) {
      for (const step of remaining.values()) {
        const input = await params.buildInput(step, []);
        results.set(step.stepId, failedEnvelope(step, input, 0, "orchestration_timed_out"));
        failures.push({ stepId: step.stepId, cause: new Error("orchestration_timed_out") });
      }
      break;
    }
    const ready = Array.from(remaining.values()).filter((step) => step.dependsOn.every((dependency) => results.has(dependency)));
    if (ready.length === 0) {
      for (const step of remaining.values()) {
        const input = await params.buildInput(step, []);
        results.set(step.stepId, failedEnvelope(step, input, 0, "execution_dependency_cycle"));
        failures.push({ stepId: step.stepId, cause: new Error("execution_dependency_cycle") });
      }
      break;
    }

    await Promise.all(ready.map(async (step) => {
      throwIfExecutionCancelled(params.signal);
      remaining.delete(step.stepId);
      const upstream = step.dependsOn.map((id) => results.get(id)).filter((item): item is SkillResultEnvelope => Boolean(item));
      const input = await params.buildInput(step, upstream);
      const startedAt = Date.now();
      try {
        const remainingBudgetMs = overallTimeoutMs - (Date.now() - executionStartedAt);
        const effectiveTimeoutMs = Math.max(1, Math.min(stepTimeoutMs, remainingBudgetMs));
        const timeoutCode = effectiveTimeoutMs < stepTimeoutMs
          ? "orchestration_timed_out"
          : `skill_step_timed_out_after_${effectiveTimeoutMs}ms`;
        const result = await invokeWithDeadline(
          (signal) => params.invoke(step, input, signal),
          params.signal,
          effectiveTimeoutMs,
          timeoutCode
        );
        const qualityGateError = result.deliveryStatus === "completed"
          ? validateStepDelivery(step, input, result)
          : undefined;
        if (qualityGateError) {
          results.set(step.stepId, failedEnvelope(step, input, Date.now() - startedAt, qualityGateError));
          failures.push({ stepId: step.stepId, cause: new Error(qualityGateError) });
          return;
        }
        results.set(step.stepId, {
          stepId: step.stepId,
          status: result.deliveryStatus === "needs_input" ? "needs_input" : "success",
          capabilityId: step.capabilityId,
          title: step.title,
          skillId: result.skillId,
          skillVersion: result.skillVersion,
          answerMarkdown: result.answerText,
          artifacts: result.artifacts,
          qualityFlags: result.qualityFlags,
          nextActions: result.nextActions,
          creditCost: result.creditCost,
          analysisMode: result.analysisMode,
          durationMs: Date.now() - startedAt,
          input
        });
      } catch (cause) {
        if (params.signal?.aborted || cause instanceof AgentExecutionCancelledError) {
          throw new AgentExecutionCancelledError();
        }
        results.set(step.stepId, failedEnvelope(step, input, Date.now() - startedAt, errorCode(cause)));
        failures.push({ stepId: step.stepId, cause });
      }
    }));
  }

  const orderedResults = params.plan.steps
    .map((step) => results.get(step.stepId))
    .filter((item): item is SkillResultEnvelope => Boolean(item));
  const seenAnswers = new Map<string, string>();
  for (const result of orderedResults) {
    if (result.status !== "success") continue;
    const fingerprint = normalizeAnswerFingerprint(result.answerMarkdown);
    const duplicateOf = fingerprint.length >= 80 ? seenAnswers.get(fingerprint) : undefined;
    if (duplicateOf) {
      result.status = "failed";
      result.answerMarkdown = "";
      result.creditCost = 0;
      result.qualityFlags = Array.from(new Set([...result.qualityFlags, "duplicate_step_delivery"]));
      result.error = { code: `duplicate_step_delivery:${duplicateOf}`, retryable: false };
      failures.push({ stepId: result.stepId, cause: new Error("duplicate_step_delivery") });
      continue;
    }
    if (fingerprint.length >= 80) seenAnswers.set(fingerprint, result.stepId);
  }

  return {
    plan: params.plan,
    results: orderedResults,
    failures
  };
}

async function invokeWithDeadline<T>(
  invoke: (signal: AbortSignal) => Promise<T>,
  parentSignal: AbortSignal | undefined,
  timeoutMs: number,
  timeoutCode: string
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromParent = () => controller.abort(parentSignal?.reason);
  if (parentSignal?.aborted) abortFromParent();
  else parentSignal?.addEventListener("abort", abortFromParent, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error(timeoutCode));
  }, timeoutMs);
  const aborted = new Promise<never>((_, reject) => {
    const rejectForAbort = () => {
      reject(parentSignal?.aborted ? new AgentExecutionCancelledError() : new Error(timedOut ? timeoutCode : "skill_execution_aborted"));
    };
    if (controller.signal.aborted) rejectForAbort();
    else controller.signal.addEventListener("abort", rejectForAbort, { once: true });
  });
  try {
    return await Promise.race([invoke(controller.signal), aborted]);
  } finally {
    clearTimeout(timeout);
    parentSignal?.removeEventListener("abort", abortFromParent);
  }
}

function throwIfExecutionCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new AgentExecutionCancelledError();
}

export function combineExecutionResults(execution: OrchestrationExecution): CombinedOrchestrationResult {
  const succeeded = execution.results.filter((item) => item.status === "success");
  const needsInput = execution.results.filter((item) => item.status === "needs_input");
  const failed = execution.results.filter((item) => item.status === "failed");
  if (succeeded.length === 0 && needsInput.length === 0) {
    const first = failed[0] ?? execution.results[0];
    return {
      deliveryStatus: "failed",
      answerText: [
        "短结论",
        "本次各项内容生成均未完成，因此没有把不完整结果冒充为正式方案，也没有扣除对应积分。",
        "",
        "未完成项",
        ...execution.plan.steps.map((step, index) => {
          const result = failed.find((item) => item.stepId === step.stepId);
          return `${index + 1}. ${step.title}：${result?.error?.retryable ? "服务暂时不可用，可稍后重试" : "输出未通过完整性或事实质量检查"}`;
        }),
        "",
        "下一步",
        "请直接重试一次；如仍失败，可把任务拆成单项执行，系统会继续保留事实边界并单独校验每项交付。"
      ].join("\n"),
      skillId: first?.skillId ?? "multi_skill_orchestration",
      skillIds: [],
      skillVersion: first?.skillVersion ?? "1.0.0",
      creditCost: 0,
      qualityFlags: ["multi_skill_orchestration", "partial_skill_delivery", "all_steps_failed"],
      analysisMode: "fast",
      nextActions: ["重试联合任务", "拆分为单项任务执行"],
      artifacts: []
    };
  }
  const deliveryStatus: CombinedOrchestrationResult["deliveryStatus"] = failed.length > 0
    ? "failed"
    : needsInput.length > 0
      ? "needs_input"
      : "completed";
  const available = [...succeeded, ...needsInput];

  const answerText = [
    deliveryStatus === "completed" ? "完整增长执行包" : "增长执行包（含待补项）",
    "",
    ...succeeded.flatMap((result) => [
      result.title,
      sanitizeSkillAnswer(result.answerMarkdown),
      ""
    ]),
    ...(needsInput.length > 0 ? [
      "",
      "待补信息",
      ...needsInput.flatMap((item) => [`${item.title}：`, sanitizeSkillAnswer(item.answerMarkdown)])
    ] : []),
    ...(failed.length > 0 ? [
      "",
      "本轮暂未生成的模块",
      ...failed.map((item) => `${item.title}：${item.error?.retryable ? "服务暂时不可用，可稍后重试" : "输出未通过完整性或事实质量检查"}`)
    ] : [])
  ].filter((line, index, values) => !(line === "" && values[index - 1] === "")).join("\n").trim();

  return {
    deliveryStatus,
    answerText,
    skillId: available[0].skillId,
    skillIds: available.map((item) => item.skillId),
    skillVersion: available.map((item) => item.skillVersion).join("+").slice(0, 240),
    creditCost: succeeded.reduce((total, item) => total + item.creditCost, 0),
    qualityFlags: Array.from(new Set([
      "multi_skill_orchestration",
      ...(needsInput.length > 0 ? ["orchestration_needs_input"] : []),
      ...(failed.length > 0 ? ["partial_skill_delivery"] : []),
      ...available.flatMap((item) => item.qualityFlags)
    ])),
    analysisMode: available.some((item) => item.analysisMode === "deep") ? "deep" : "fast",
    nextActions: Array.from(new Set(available.flatMap((item) => item.nextActions))).slice(0, 6),
    artifacts: available.flatMap((item) => item.artifacts)
  };
}

function failedEnvelope(step: ExecutionStep, input: string, durationMs: number, code: string): SkillResultEnvelope {
  return {
    stepId: step.stepId,
    status: "failed",
    capabilityId: step.capabilityId,
    title: step.title,
    skillId: step.skillId,
    skillVersion: step.skillVersion,
    answerMarkdown: "",
    artifacts: [],
    qualityFlags: ["skill_execution_failed"],
    nextActions: [],
    creditCost: 0,
    analysisMode: "fast",
    durationMs,
    input,
    error: { code, retryable: isRetryableErrorCode(code) }
  };
}

function errorCode(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim().slice(0, 120);
  return "skill_execution_failed";
}

function isRetryableErrorCode(code: string): boolean {
  return /mcp_|timeout|timed_out|service_unavailable|ECONN|fetch failed/i.test(code);
}

function isContentCapability(capabilityId: string): boolean {
  return capabilityId === "content_plan" || capabilityId === "paid_traffic" || capabilityId === "franchise_acquisition";
}

function capabilityPriority(capabilityId: string): number {
  if (capabilityId === "industry_hotspots") return 0;
  if (isContentCapability(capabilityId)) return 2;
  return 1;
}

function sanitizeSkillAnswer(value: string): string {
  return value
    .split(/\r?\n/)
    .filter((line) => !/已知输入：|这是一次多技能联合任务中的|用户原始要求：/.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function validateStepDelivery(step: ExecutionStep, input: string, result: SkillRuntimeResult): string | undefined {
  const blockingFlag = result.qualityFlags.find((flag) =>
    /^rubric_/.test(flag)
    || /(?:subject_drift|fact_retention_weak|too_short|missing|invalid)/.test(flag)
  );
  if (blockingFlag) return `delivery_quality_flag:${blockingFlag}`;
  const answer = result.answerText.trim();
  if (!answer) return "delivery_empty";
  if (/多技能联合任务|用户这次补充|Skill 的完整标准|内部提示词/.test(answer)) {
    return "delivery_internal_prompt_leak";
  }
  const original = extractOriginalUserRequest(input);
  const required: RegExp[] = [];
  const namedSubject = original.match(/(?:^|[\n。；;])\s*(?:客户|品牌|项目)[：:]\s*([^，。；;\n]{2,30})/m)?.[1]?.trim();
  if (namedSubject && !answer.includes(namedSubject)) return `delivery_named_subject_missing:${namedSubject}`;
  if (step.capabilityId === "content_plan") {
    const transcriptOnly = asksForTranscriptOnlyContent(original);
    required.push(/口播|逐字稿/);
    if (!transcriptOnly) required.push(/拍摄|分镜/, /标题/, /评论区|私信|承接/);
    if (/7天|七天/.test(original)) required.push(/7天|七天|第\s*1\s*天|D1|Day\s*1/i);
    if (/复盘/.test(original)) required.push(/复盘/);
  } else if (step.capabilityId === "paid_traffic") {
    required.push(/投流判断|是否建议投|建议投放|暂不建议投/, /投放目标/, /素材A\/B|素材测试/, /预算/, /监控指标/, /止损条件/, /复盘时间/, /执行草案/);
  } else if (step.capabilityId === "franchise_acquisition") {
    required.push(/招商|加盟/, /线索|留资/, /承接|私信|预约|考察/);
  } else if (step.capabilityId === "live_script") {
    required.push(/开场/, /留人|停留/, /互动/, /转化|下单|留资|预约/, /收尾|下播/);
  } else if (step.capabilityId === "private_domain") {
    required.push(/朋友圈/, /私聊|私信|承接/);
    if (/7天|七天/.test(original)) required.push(/第\s*1\s*天|D1|Day\s*1/i, /第\s*7\s*天|D7|Day\s*7/i);
    if (/线索分级/.test(original)) required.push(/线索/, /分级|A类|B类|高意向|中意向/);
  } else if (step.capabilityId === "customer_diagnosis") {
    required.push(/诊断|判断/, /需求|顾虑|阻力/, /下一步/);
  } else if (step.capabilityId === "objection_reply") {
    required.push(/异议/, /回复|话术|可直接/);
  } else if (step.capabilityId === "follow_up_plan") {
    required.push(/跟进/, /退出|停止条件|停止/);
    if (/7天|七天/.test(original)) {
      required.push(/第\s*1\s*天|D1|Day\s*1/i, /第\s*7\s*天|D7|Day\s*7/i);
    }
  }
  const missingCount = required.filter((pattern) => !pattern.test(answer)).length;
  return missingCount > 0 ? `delivery_required_sections_missing:${step.capabilityId}:${missingCount}` : undefined;
}

function asksForTranscriptOnlyContent(input: string): boolean {
  const asksForTranscript = /逐字稿|口播稿|口播文案|完整(?:的)?(?:短视频)?文案|可直接照读/.test(input);
  const asksForProductionPackage = /拍摄(?:脚本|方案|要求|注意事项)?|分镜|剪辑|EDL|发布标题|标题(?:与|和)?话题|评论区|投流|完整内容执行包|可直接发布的内容执行包|一套完整(?:成品|方案|内容)/.test(input);
  return asksForTranscript && !asksForProductionPackage;
}

function extractOriginalUserRequest(input: string): string {
  const marker = "用户这次补充：";
  const index = input.lastIndexOf(marker);
  return index >= 0 ? input.slice(index + marker.length).trim() : input;
}

function normalizeAnswerFingerprint(answer: string): string {
  return answer
    .replace(/\s+/g, "")
    .replace(/[，。；;：:、“”"'（）()【】\[\]\-|]/g, "")
    .trim();
}

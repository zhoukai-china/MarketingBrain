import { createHash } from "node:crypto";
import type { LlmProvider, ProviderFailureInfo } from "@baolu/agent";

export type RuntimeStageStatus = "started" | "completed" | "failed" | "cancelled" | "timed_out";

export function emitRuntimeStage(params: {
  requestId: string;
  stage: string;
  startedAt: number;
  status: RuntimeStageStatus;
  provider?: LlmProvider;
  errorCode?: string;
  providerFailure?: ProviderFailureInfo;
}): void {
  const providerWithModel = params.provider as LlmProvider & { getModel?: () => string };
  const selectedModel = providerWithModel.getModel?.();
  console.info(JSON.stringify({
    event: "agent_runtime_stage",
    traceId: createHash("sha256").update(params.requestId).digest("hex").slice(0, 16),
    stage: params.stage,
    status: params.status,
    elapsedMs: Math.max(0, Date.now() - params.startedAt),
    ...(params.provider ? { selectedProvider: params.provider.name } : {}),
    ...(selectedModel ? { selectedModel } : {}),
    ...(params.errorCode ? { errorCode: params.errorCode } : {}),
    ...(params.providerFailure ? {
      providerFailure: {
        code: params.providerFailure.code,
        ...(params.providerFailure.httpStatus !== undefined ? { httpStatus: params.providerFailure.httpStatus } : {}),
        ...(params.providerFailure.finishReason ? { finishReason: params.providerFailure.finishReason } : {}),
        ...(params.providerFailure.hasReasoningContent !== undefined ? { hasReasoningContent: params.providerFailure.hasReasoningContent } : {}),
        ...(params.providerFailure.promptTokens !== undefined ? { promptTokens: params.providerFailure.promptTokens } : {}),
        ...(params.providerFailure.completionTokens !== undefined ? { completionTokens: params.providerFailure.completionTokens } : {}),
        ...(params.providerFailure.reasoningTokens !== undefined ? { reasoningTokens: params.providerFailure.reasoningTokens } : {})
      }
    } : {})
  }));
}

export function classifyRuntimeError(error: unknown): string {
  const providerCode = error && typeof error === "object"
    ? (error as { providerFailure?: { code?: unknown } }).providerFailure?.code
    : undefined;
  if (typeof providerCode === "string" && /^[a-z_]{3,40}$/.test(providerCode)) return providerCode;
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : "";
  if (name === "AbortError" || /cancelled|disconnected/i.test(message)) return "cancelled";
  if (/timed out|timeout|timed_out/i.test(message)) return "timed_out";
  if (/beauty_text_budget_(?:exceeded|model_mismatch|not_configured|provider_call_limit)/i.test(message)) return "budget_rejected";
  if (/unavailable|circuit|fetch failed|ECONN/i.test(message)) return "service_unavailable";
  return "runtime_failed";
}

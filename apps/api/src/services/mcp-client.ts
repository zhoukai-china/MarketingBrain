import { env } from "../config/env.js";
import { z } from "zod";
import { AgentAccessError, AgentClarificationRequired, invokeSkillThroughMcp, type SkillRuntimeResult } from "./agent-runtime.js";
import { IdempotencyConflictError, InsufficientCreditsError } from "./chat-persistence.js";
import { buildStableAgentDelivery, resolveReasoningProfile } from "./structured-delivery.js";
import { classifyRuntimeError, emitRuntimeStage } from "./runtime-stage-trace.js";

type InvocationParams = Parameters<typeof invokeSkillThroughMcp>[0];

const skillRuntimeResultSchema = z.object({
  status: z.literal("success"),
  deliveryStatus: z.enum(["completed", "needs_input"]),
  mcpCallId: z.string().min(1),
  agentId: z.string().min(1),
  skillId: z.string().min(1),
  skillVersion: z.string().min(1),
  answerText: z.string(),
  structuredBlocks: z.array(z.object({ type: z.literal("markdown"), content: z.string() })),
  nextActions: z.array(z.string()),
  artifacts: z.array(z.object({ type: z.string(), id: z.string(), label: z.string() })),
  creditCost: z.number().nonnegative(),
  qualityFlags: z.array(z.string()),
  providerFailure: z.object({
    code: z.enum(["http_error", "timed_out", "cancelled", "transport_error", "invalid_json", "invalid_response", "empty_final", "output_token_limit", "content_filtered", "unexpected_tool_call", "upstream_capacity", "unknown"]),
    httpStatus: z.number().int().nonnegative().optional(),
    finishReason: z.string().max(40).optional(),
    hasReasoningContent: z.boolean().optional(),
    promptTokens: z.number().int().nonnegative().optional(),
    completionTokens: z.number().int().nonnegative().optional(),
    reasoningTokens: z.number().int().nonnegative().optional()
  }).optional(),
  analysisMode: z.enum(["fast", "deep"]),
  reasoningProfile: z.enum(["standard", "deep"]).optional(),
  traceId: z.string().min(1)
}).passthrough();

let consecutiveTransportFailures = 0;
let circuitOpenUntil = 0;
const MCP_CIRCUIT_FAILURE_THRESHOLD = 3;
const MCP_CIRCUIT_COOLDOWN_MS = 15_000;

export class McpUnavailableError extends Error {
  constructor(message = "mcp_service_unavailable") {
    super(message);
  }
}

/**
 * The Agent Gateway has one production exit: the MCP JSON-RPC tool. Local demo
 * development can use the same execution function in-process so the repository
 * remains runnable without an extra service.
 */
export async function invokeSkillViaGateway(params: InvocationParams): Promise<SkillRuntimeResult> {
  const traceStartedAt = params.traceStartedAt ?? Date.now();
  emitRuntimeStage({ requestId: params.requestId, stage: "mcp_client", startedAt: traceStartedAt, status: "started", provider: params.provider });
  // A local demo must exercise the checked-out Agent package.  Otherwise a
  // developer can change a Skill contract here but still receive an older
  // delivery from a separately running MCP service configured in .env.
  // Production keeps its mandatory MCP boundary below.
  if (env.DATA_MODE === "demo" || env.SKILL_MCP_REQUIRED !== "true") {
    try {
      const result = await invokeSkillThroughMcp(params);
      emitRuntimeStage({ requestId: params.requestId, stage: "mcp_client", startedAt: traceStartedAt, status: "completed", provider: params.provider });
      return result;
    } catch (error) {
      const errorCode = classifyRuntimeError(error);
      emitRuntimeStage({ requestId: params.requestId, stage: "mcp_client", startedAt: traceStartedAt, status: errorCode === "timed_out" ? "timed_out" : errorCode === "cancelled" ? "cancelled" : "failed", provider: params.provider, errorCode });
      throw error;
    }
  }
  if (!env.SKILL_MCP_URL) throw new McpUnavailableError();
  if (Date.now() < circuitOpenUntil) throw new McpUnavailableError("mcp_circuit_open");

  const controller = new AbortController();
  const abortFromParent = () => controller.abort(params.signal?.reason);
  if (params.signal?.aborted) abortFromParent();
  else params.signal?.addEventListener("abort", abortFromParent, { once: true });
  // The MCP call wraps the complete Agent run, including an optional planner,
  // the primary model call and a quality-repair pass. Keep the outer deadline
  // longer than the inner LLM deadline so the gateway does not abort healthy
  // deep/media runs before the Agent can return its own safe fallback.
  const timeoutMs = Math.max(env.SKILL_MCP_INVOKE_TIMEOUT_MS, env.LLM_TIMEOUT_MS + 30_000);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(env.SKILL_MCP_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(env.SKILL_MCP_TOKEN ? { Authorization: `Bearer ${env.SKILL_MCP_TOKEN}` } : {})
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: `invoke-${params.requestId}`,
        method: "tools/call",
        params: {
          name: "sitong_skill.invoke",
          arguments: {
            requestId: params.requestId,
            requestFingerprint: params.requestFingerprint,
            agentId: params.agentId,
            capabilityId: params.capabilityId,
            skillId: params.skillId,
            tenantId: params.context.tenantId,
            userId: params.context.userId,
            conversationId: params.conversationId,
            channel: params.channel,
            deviceScope: params.deviceScope,
            input: params.input,
            routingInput: params.routingInput,
            history: params.history,
            routingSource: params.routingSource,
            capabilityLocked: params.capabilityLocked,
            promptCompositionPolicy: params.promptCompositionPolicy,
            deliveryPolicy: params.deliveryPolicy,
            skillPromptOverride: params.skillPromptOverride,
            skillVersionOverride: params.skillVersionOverride,
            providerPolicyVersion: params.providerPolicyVersion,
            skipEntitlement: params.skipEntitlement,
            persist: params.persist,
            auth: params.context,
            traceStartedAt
          }
        }
      })
    });
    const payload = await response.json() as {
      error?: { message?: string };
      result?: { content?: Array<{ type?: string; text?: string }> };
    };
    if (payload.error) throwMcpBusinessError(payload.error.message, params.agentId);
    if (!response.ok) throw new McpUnavailableError(`mcp_http_${response.status}`);
    const text = payload.result?.content?.find((item) => item.type === "text")?.text;
    if (!text) throw new McpUnavailableError("mcp_result_missing");
    const parsed = skillRuntimeResultSchema.safeParse(JSON.parse(text));
    if (!parsed.success) throw new McpUnavailableError("mcp_result_invalid");
    consecutiveTransportFailures = 0;
    circuitOpenUntil = 0;
    const reasoningProfile = parsed.data.reasoningProfile
      ?? resolveReasoningProfile(params.capabilityId, parsed.data.skillId);
    const result = {
      ...parsed.data,
      reasoningProfile,
      // Rebuild this deterministic view at the gateway boundary. It keeps a
      // newly deployed API compatible with an older MCP worker and prevents
      // the browser from depending on model-authored JSON.
      stableDelivery: buildStableAgentDelivery({
        capabilityId: params.capabilityId,
        answerText: parsed.data.answerText
      })
    } as SkillRuntimeResult;
    emitRuntimeStage({ requestId: params.requestId, stage: "mcp_client", startedAt: traceStartedAt, status: "completed", provider: params.provider });
    return result;
  } catch (error) {
    if (
      error instanceof AgentAccessError
      || error instanceof AgentClarificationRequired
      || error instanceof InsufficientCreditsError
      || error instanceof IdempotencyConflictError
    ) throw error;
    if (params.signal?.aborted) {
      emitRuntimeStage({ requestId: params.requestId, stage: "mcp_client", startedAt: traceStartedAt, status: "cancelled", provider: params.provider, errorCode: "cancelled" });
      const cancelled = new Error("agent_execution_cancelled");
      cancelled.name = "AbortError";
      throw cancelled;
    }
    const unavailable = error instanceof McpUnavailableError
      ? error
      : error instanceof Error && error.name === "AbortError"
        ? new McpUnavailableError(`mcp_request_timed_out_after_${timeoutMs}ms`)
        : new McpUnavailableError(error instanceof Error ? error.message : undefined);
    consecutiveTransportFailures += 1;
    if (consecutiveTransportFailures >= MCP_CIRCUIT_FAILURE_THRESHOLD) {
      circuitOpenUntil = Date.now() + MCP_CIRCUIT_COOLDOWN_MS;
    }
    const errorCode = classifyRuntimeError(unavailable);
    emitRuntimeStage({ requestId: params.requestId, stage: "mcp_client", startedAt: traceStartedAt, status: errorCode === "timed_out" ? "timed_out" : errorCode === "cancelled" ? "cancelled" : "failed", provider: params.provider, errorCode });
    throw unavailable;
  } finally {
    clearTimeout(timeout);
    params.signal?.removeEventListener("abort", abortFromParent);
  }
}

function throwMcpBusinessError(message: string | undefined, agentId: string): never {
  if (message === "insufficient_credits") throw new InsufficientCreditsError();
  if (message === "request_id_conflict") throw new IdempotencyConflictError();
  if (
    message === "agent_not_found"
    || message === "agent_not_entitled"
    || message === "agent_member_access_denied"
    || message === "skill_not_allowed"
  ) {
    throw new AgentAccessError(message);
  }
  if (message === "clarification_required") {
    throw new AgentClarificationRequired(
      agentId === "agent_sales"
        ? "请告诉我：你想诊断客户、回复异议、制定跟单计划，还是复盘销售漏斗？"
        : "请告诉我：你想看行业热点、做内容、复盘视频，还是设计直播/私域方案？"
    );
  }
  throw new McpUnavailableError(message ?? "mcp_execution_failed");
}

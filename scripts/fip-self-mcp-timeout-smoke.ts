import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import {
  buildChatCompletionPayload,
  DomesticProviderTerminalError,
  parseChatCompletionResponse
} from "../apps/api/src/services/domestic-chat-provider.ts";
import { createRequestExecutionScope } from "../apps/api/src/services/request-execution-scope.ts";
import { RequestSingleFlight } from "../apps/api/src/services/request-single-flight.ts";
import { emitRuntimeStage } from "../apps/api/src/services/runtime-stage-trace.ts";

async function main(): Promise<void> {
  const requestRaw = new EventEmitter();
  const replyRaw = new EventEmitter() as EventEmitter & { writableEnded: boolean };
  replyRaw.writableEnded = false;
  const timedOut = createRequestExecutionScope({
    requestRaw,
    replyRaw,
    timeoutMs: 25,
    timeoutCode: "founder_ip_content_generation_timed_out"
  });
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(timedOut.signal.aborted, true, "FIP request must abort at its hard deadline");
  assert.equal(timedOut.getAbortCode(), "founder_ip_content_generation_timed_out");
  timedOut.dispose();

  const cancelledRequest = new EventEmitter();
  const cancelledReply = new EventEmitter() as EventEmitter & { writableEnded: boolean };
  cancelledReply.writableEnded = false;
  const cancelled = createRequestExecutionScope({
    requestRaw: cancelledRequest,
    replyRaw: cancelledReply,
    timeoutMs: 5_000,
    timeoutCode: "founder_ip_content_generation_timed_out"
  });
  cancelledRequest.emit("aborted");
  assert.equal(cancelled.signal.aborted, true, "client disconnect must abort the downstream MCP/provider call");
  assert.equal(cancelled.getAbortCode(), "client_disconnected");
  cancelled.dispose();

  const singleFlight = new RequestSingleFlight<string>(5_000);
  let calls = 0;
  const execute = () => singleFlight.run({
    key: "tenant-a:request-a",
    fingerprint: "draft-a",
    onConflict: () => new Error("request_id_conflict"),
    execute: async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return "result-a";
    }
  });
  const [first, duplicate] = await Promise.all([execute(), execute()]);
  assert.equal(first, "result-a");
  assert.equal(duplicate, "result-a");
  assert.equal(calls, 1, "same requestId must not create duplicate provider calls");
  await assert.rejects(() => singleFlight.run({
    key: "tenant-a:request-a",
    fingerprint: "draft-b",
    onConflict: () => new Error("request_id_conflict"),
    execute: async () => "unexpected"
  }), /request_id_conflict/);

  let downstreamCancelled = false;
  const server = createServer(async (request, response) => {
    const scope = createRequestExecutionScope({
      requestRaw: request,
      replyRaw: response,
      timeoutMs: 2_000,
      timeoutCode: "test_timeout"
    });
    await new Promise<void>((resolve) => {
      scope.signal.addEventListener("abort", () => {
        downstreamCancelled = true;
        resolve();
      }, { once: true });
    });
    scope.dispose();
    if (!response.destroyed) response.end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const client = new AbortController();
  const pending = fetch(`http://127.0.0.1:${address.port}/generate`, { method: "POST", signal: client.signal }).catch(() => undefined);
  setTimeout(() => client.abort(), 30);
  await pending;
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(downstreamCancelled, true, "an HTTP client disconnect must cancel the downstream simulated provider");
  server.close();
  await once(server, "close");

  const originalInfo = console.info;
  const traceLines: string[] = [];
  console.info = (line?: unknown) => { traceLines.push(String(line)); };
  try {
    emitRuntimeStage({
      requestId: "private-request-id-must-not-appear",
      stage: "provider",
      startedAt: Date.now(),
      status: "completed",
      provider: { name: "deepseek", complete: async () => "unused" }
    });
  } finally {
    console.info = originalInfo;
  }
  assert.equal(traceLines.length, 1);
  assert.doesNotMatch(traceLines[0] ?? "", /private-request-id-must-not-appear/, "runtime trace must hash the correlation id");
  assert.match(traceLines[0] ?? "", /"traceId":"[a-f0-9]{16}"/, "runtime trace must retain a safe correlation hash");

  const deepseekPayload = buildChatCompletionPayload({
    providerName: "deepseek",
    model: "deepseek-v4-pro",
    messages: [{ role: "user", content: "synthetic FIP contract fixture" }],
    reasoningProfile: "standard",
    thinkingMode: "enabled",
    reasoningEffort: "high",
    maxTokens: 4096
  });
  assert.deepEqual(deepseekPayload.thinking, { type: "enabled" });
  assert.equal(deepseekPayload.reasoning_effort, "high");
  assert.equal(deepseekPayload.max_tokens, 4096);
  assert.equal("temperature" in deepseekPayload, false, "DeepSeek thinking mode must not send ignored sampling controls");

  assert.equal(parseChatCompletionResponse("deepseek", {
    choices: [{ finish_reason: "stop", message: { content: "synthetic final" } }],
    usage: { prompt_tokens: 12, completion_tokens: 34, total_tokens: 46 }
  }), "synthetic final", "a completed final answer must remain usable");
  assert.throws(
    () => parseChatCompletionResponse("deepseek", {
      choices: [{ finish_reason: "length", message: { content: null, reasoning_content: "synthetic reasoning must not be logged" } }],
      usage: { prompt_tokens: 120, completion_tokens: 4096, total_tokens: 4216, completion_tokens_details: { reasoning_tokens: 4096 } }
    }),
    (error: unknown) => error instanceof DomesticProviderTerminalError
      && error.providerFailure.code === "output_token_limit"
      && error.providerFailure.finishReason === "length"
      && error.providerFailure.hasReasoningContent === true
      && error.providerFailure.completionTokens === 4096
      && error.providerFailure.reasoningTokens === 4096
      && !JSON.stringify(error.providerFailure).includes("synthetic reasoning"),
    "reasoning-only length responses must expose a safe terminal classification without model text"
  );
  assert.throws(
    () => parseChatCompletionResponse("deepseek", {
      choices: [{ finish_reason: "insufficient_system_resource", message: { content: null, reasoning_content: "partial" } }]
    }),
    (error: unknown) => error instanceof DomesticProviderTerminalError
      && error.providerFailure.code === "upstream_capacity"
      && error.providerFailure.finishReason === "insufficient_system_resource",
    "upstream capacity termination must not be misreported as an empty final"
  );

  const root = new URL("../", import.meta.url);
  const route = readFileSync(new URL("apps/api/src/routes/agents.ts", root), "utf8");
  const generation = readFileSync(new URL("apps/api/src/services/founder-ip-content-generation.ts", root), "utf8");
  const agentRuntime = readFileSync(new URL("packages/agent/src/index.ts", root), "utf8");
  const provider = readFileSync(new URL("apps/api/src/services/domestic-chat-provider.ts", root), "utf8");
  assert.match(route, /createRequestExecutionScope\(/, "FIP route must own a hard deadline and disconnect cancellation");
  assert.match(route, /signal:\s*executionScope\.signal/, "FIP route must pass its signal into generation");
  assert.match(generation, /signal\?:\s*AbortSignal/, "FIP generation service must accept cancellation");
  assert.match(generation, /signal:\s*params\.signal/, "FIP generation service must propagate cancellation to MCP");
  assert.match(generation, /selectedReasoningMode:\s*"reasoning_high"/, "FIP generation must return the approved reasoning mode");
  assert.match(generation, /founder_ip_content_draft\.provider_selected/, "successful FIP generation must persist provider selection audit metadata");
  assert.match(route, /founder_ip_content_generation_timed_out/, "FIP timeout must return an explicit stable error code");
  assert.match(agentRuntime, /message\.content\.includes\("【创始人IP获客内容生成】"\)/, "thinking policy must be scoped to FIP content generation");
  assert.match(agentRuntime, /thinkingMode:\s*isFounderIpContentRequest\s*\?\s*"enabled"/, "FIP content generation must keep DeepSeek thinking enabled");
  assert.match(agentRuntime, /reasoningEffort:\s*isFounderIpContentRequest\s*\?\s*"high"/, "FIP content generation must keep reasoning_high");
  assert.match(agentRuntime, /const FIP_CONTENT_MAX_TOKENS = 16_384/, "FIP high-reasoning content must reserve a bounded budget above the failed 4096 and 8192 limits");
  assert.match(agentRuntime, /maxTokens:\s*isFounderIpContentRequest\s*\?\s*FIP_CONTENT_MAX_TOKENS/, "FIP content output must use the stage-scoped bounded token budget");
  assert.match(provider, /params\.providerName === "deepseek" && params\.thinkingMode/, "thinking payload must only be sent to DeepSeek-compatible requests");
  assert.match(provider, /thinking:\s*\{\s*type:\s*params\.thinkingMode\s*\}/, "DeepSeek request must serialize the selected thinking mode");
  assert.match(provider, /reasoning_effort:\s*params\.reasoningEffort/, "DeepSeek request must serialize the selected reasoning effort");
  assert.match(provider, /finish_reason/, "provider adapter must inspect the upstream finish reason");
  assert.match(provider, /completion_tokens_details/, "provider adapter must retain safe token usage for terminal diagnosis");
  assert.match(agentRuntime, /providerFailure/, "agent runtime must propagate safe Provider terminal metadata instead of only provider_fallback_used");
  console.log("fip_self_mcp_timeout_smoke:PASS");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

import assert from "node:assert/strict";
import { isHighCapabilityLlmModel } from "../apps/api/src/services/llm-model-policy.js";
import { buildChatCompletionPayload } from "../apps/api/src/services/domestic-chat-provider.js";
import { createLanqiTaskLlmProvider } from "../apps/api/src/services/llm-provider-factory.js";
import {
  LANQI_TEXT_LOW_RISK_QWEN_CANDIDATE,
  assertLanqiLowRiskCandidateModel,
  resolveLanqiRuntimeModelPolicy,
} from "../apps/api/src/services/lanqi-runtime-model-policy.js";

async function main(): Promise<void> {
const qwenApproved = {
  candidateModel: "qwen3.8-flash" as const,
  enabled: true,
  evalApproved: true,
};

assert.equal(
  isHighCapabilityLlmModel("qwen3.8-flash"),
  false,
  "Qwen3.8-Flash 不能绕过现有高能力模型门禁",
);
assert.equal(LANQI_TEXT_LOW_RISK_QWEN_CANDIDATE, "qwen3.8-flash");
assert.doesNotThrow(() => assertLanqiLowRiskCandidateModel("qwen3.8-flash"));
assert.throws(() => assertLanqiLowRiskCandidateModel("qwen-turbo"), /lanqi_low_risk_candidate_not_allowed/);

assert.equal(
  resolveLanqiRuntimeModelPolicy("low_risk_formatting", { ...qwenApproved, enabled: false }).model,
  "deepseek-v4-pro",
  "未显式启用时必须继续使用 Pro",
);
assert.equal(
  resolveLanqiRuntimeModelPolicy("low_risk_formatting", { ...qwenApproved, evalApproved: false }).model,
  "deepseek-v4-pro",
  "未通过 Eval 时必须继续使用 Pro",
);
assert.deepEqual(resolveLanqiRuntimeModelPolicy("low_risk_formatting", qwenApproved), {
  model: "qwen3.8-flash",
  reasoningTag: "reasoning_standard",
  reasoningProfile: "standard",
});
assert.deepEqual(resolveLanqiRuntimeModelPolicy("xiaohongshu_strategy_copy", qwenApproved), {
  model: "deepseek-v4-pro",
  reasoningTag: "reasoning_high",
  reasoningProfile: "deep",
}, "专业小红书内容不能因候选启用而切到 Qwen Flash");

assert.deepEqual(buildChatCompletionPayload({
  providerName: "aliyun",
  model: "qwen3.8-flash",
  messages: [{ role: "user", content: "仅输出 JSON" }],
  reasoningProfile: "standard",
  thinkingMode: "disabled",
  maxTokens: 512,
  responseFormat: "json_object",
}), {
  model: "qwen3.8-flash",
  messages: [{ role: "user", content: "仅输出 JSON" }],
  enable_thinking: false,
  preserve_thinking: false,
  temperature: 0.3,
  max_tokens: 512,
  response_format: { type: "json_object" },
}, "百炼 OpenAI 兼容请求必须显式关闭 Qwen 思考与历史思考，并保留 JSON 输出");

const providerConfig = {
  qwenCandidate: qwenApproved,
  deepseekApiKey: undefined,
  deepseekBaseUrl: undefined,
  aliyunApiKey: undefined,
  aliyunBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  timeoutMs: 1_000,
  domesticNetworkOnly: true,
  allowedHosts: ["dashscope.aliyuncs.com"],
};
const qwenProvider = createLanqiTaskLlmProvider("low_risk_formatting", providerConfig);
assert.equal(qwenProvider.name, "aliyun");
assert.equal(qwenProvider.getModel(), "qwen3.8-flash");
await assert.rejects(
  () => qwenProvider.complete([{ role: "user", content: "仅输出 JSON" }]),
  /aliyun_provider_not_configured/,
  "显式批准的候选应通过模型门禁，并在缺密钥时于网络调用前失败",
);

const professionalProvider = createLanqiTaskLlmProvider("professional_prompt_enhancement", providerConfig);
assert.equal(professionalProvider.name, "deepseek");
assert.equal(professionalProvider.getModel(), "deepseek-v4-pro");

const originalFetch = globalThis.fetch;
let capturedBody: Record<string, unknown> | undefined;
globalThis.fetch = async (_input, init) => {
  capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
  return new Response(JSON.stringify({
    choices: [{ finish_reason: "stop", message: { content: "{\"labels\":[\"补水\"]}" } }],
    usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
  }), { status: 200, headers: { "Content-Type": "application/json" } });
};
try {
  const boundedProvider = createLanqiTaskLlmProvider("low_risk_formatting", {
    ...providerConfig,
    aliyunApiKey: "synthetic-test-key",
  });
  const result = await boundedProvider.complete([{ role: "user", content: "仅输出 JSON" }], {
    thinkingMode: "enabled",
    maxTokens: 8192,
    responseFormat: "json_object",
  });
  assert.equal(result, "{\"labels\":[\"补水\"]}");
  assert.equal(capturedBody?.enable_thinking, false, "候选包装器必须覆盖调用方并保持非思考模式");
  assert.equal(capturedBody?.preserve_thinking, false);
  assert.equal(capturedBody?.max_tokens, 2048, "候选输出上限必须硬限制为 2048 tokens");
  assert.deepEqual(capturedBody?.response_format, { type: "json_object" });
} finally {
  globalThis.fetch = originalFetch;
}

console.log("Lanqi Qwen3.8-Flash candidate eval passed: default-off, dual-gated, low-risk-only, non-thinking JSON payload, no network calls.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

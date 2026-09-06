import assert from "node:assert/strict";
import { readDomesticProviderUsage } from "../apps/api/src/services/domestic-chat-provider.js";

const secretPrompt = "synthetic-private-prompt-must-not-appear";
const observation = readDomesticProviderUsage({
  choices: [{ finish_reason: "stop", message: { content: "synthetic result" } }],
  usage: {
    prompt_tokens: 321,
    completion_tokens: 654,
    total_tokens: 975,
    completion_tokens_details: { reasoning_tokens: 111 }
  },
  request: { prompt: secretPrompt }
});

assert.deepEqual(observation, {
  finishReason: "stop",
  promptTokens: 321,
  completionTokens: 654,
  reasoningTokens: 111,
  totalTokens: 975
});
assert.equal(JSON.stringify(observation).includes(secretPrompt), false);
assert.equal(readDomesticProviderUsage({ choices: [] }), undefined);

console.log("beauty_industry_provider_usage_observability_smoke_passed");

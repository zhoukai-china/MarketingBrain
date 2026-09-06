import assert from "node:assert/strict";
import type { AgentRequest, LlmMessage, LlmProvider } from "../packages/agent/src/index.js";
import {
  BEAUTY_TEXT_BUDGET_VERSION,
  BEAUTY_TEXT_BATCH_WORST_COST_CNY,
  createBeautyTextBudgetedProvider,
  getBeautyTextBudget
} from "../apps/api/src/products/beauty-industry/text-budget.js";

async function main() {
const observedChampion = {
  promptTokens: 5_601,
  completionTokens: 9_192,
  reasoningTokens: 7_548
};
const inputCnyPerMillion = 0.435 * 8;
const outputCnyPerMillion = 0.87 * 8;
const observedChampionCost = (
  observedChampion.promptTokens * inputCnyPerMillion
  + observedChampion.completionTokens * outputCnyPerMillion
) / 1_000_000;
assert.ok(observedChampionCost > 0.06, "the production champion must retain the pre-fix over-budget evidence");
assert.equal(observedChampion.completionTokens - observedChampion.reasoningTokens, 1_644);

const cases = [
  ["topic_inspiration", "baolu_topics"],
  ["content_plan", "baolu_content_creator"],
  ["beauty_xiaohongshu_package", "wechat-xhs-content-line"],
  ["live_script", "live_script_planner"],
  ["live_review", "baolu_live_review_engine"],
  ["beauty_sales", "sales_growth_advisor"]
] as const;

assert.equal(BEAUTY_TEXT_BUDGET_VERSION, "beauty-text-budget-v1");
assert.equal(BEAUTY_TEXT_BATCH_WORST_COST_CNY, 0.999289);
assert.ok(BEAUTY_TEXT_BATCH_WORST_COST_CNY <= 1, "six-tool worst cost must fit the approved batch ceiling");

for (const [capabilityId, skillId] of cases) {
  const budget = getBeautyTextBudget(capabilityId, skillId);
  assert.equal(budget.model, "deepseek-v4-pro");
  assert.equal(budget.thinkingMode, "disabled");
  assert.ok(budget.maxOutputTokens > 0);
  assert.ok(budget.maxPromptBytes > 0);
  assert.ok(budget.worstCostCny > 0);
  assert.ok(budget.worstCostCny <= BEAUTY_TEXT_BATCH_WORST_COST_CNY);
}

let providerCalls = 0;
let receivedOptions: Parameters<LlmProvider["complete"]>[1];
const provider: LlmProvider & { getModel(): string } = {
  name: "deepseek",
  getModel: () => "deepseek-v4-pro",
  async complete(_messages, options) {
    providerCalls += 1;
    receivedOptions = options;
    return "ok";
  }
};
const topicBudget = getBeautyTextBudget("topic_inspiration", "baolu_topics");
const bounded = createBeautyTextBudgetedProvider(provider, "topic_inspiration", "baolu_topics");
const smallMessages: LlmMessage[] = [{ role: "user", content: "生成四来源美业选题" }];
await bounded.complete(smallMessages);
assert.equal(providerCalls, 1);
assert.equal(receivedOptions?.maxTokens, topicBudget.maxOutputTokens);
assert.equal(receivedOptions?.thinkingMode, "disabled");
assert.equal(receivedOptions?.reasoningProfile, topicBudget.reasoningProfile);
await assert.rejects(bounded.complete(smallMessages), /beauty_text_budget_provider_call_limit/);
assert.equal(providerCalls, 1, "one product request may start the real Provider at most once");

const boundedWithPreflight = bounded as LlmProvider & {
  preflightAgentRequest(request: AgentRequest): Promise<void>;
};
await assert.rejects(
  boundedWithPreflight.preflightAgentRequest({
    tenantId: "budget_test_tenant",
    userId: "budget_test_user",
    role: "owner",
    planCode: "local_premium",
    input: "测".repeat(topicBudget.maxPromptBytes),
    requestedSkillId: "baolu_topics",
    capabilityId: "topic_inspiration",
    capabilityLocked: true,
    skillPrompt: "【固定美业能力】",
    tenantProfile: {
      tenantId: "budget_test_tenant",
      tenantName: "本店",
      tenantType: "local_business"
    },
    channel: "workbuddy"
  }),
  /beauty_text_budget_exceeded/
);
assert.equal(providerCalls, 1, "Agent preflight rejection must happen before provider-stage start");

for (const [capabilityId, skillId] of cases) {
  const policy = getBeautyTextBudget(capabilityId, skillId);
  const oversized = createBeautyTextBudgetedProvider(provider, capabilityId, skillId);
  await assert.rejects(
    oversized.complete([{ role: "user", content: "测".repeat(policy.maxPromptBytes + 1) }]),
    /beauty_text_budget_exceeded/
  );
}
assert.equal(providerCalls, 1, "budget rejection must happen before the real Provider starts");

const wrongModel: LlmProvider & { getModel(): string } = {
  name: "deepseek",
  getModel: () => "deepseek-v3",
  async complete() {
    providerCalls += 1;
    return "wrong";
  }
};
await assert.rejects(
  createBeautyTextBudgetedProvider(wrongModel, "topic_inspiration", "baolu_topics").complete(smallMessages),
  /beauty_text_budget_model_mismatch/
);
assert.equal(providerCalls, 1, "model mismatch must fail before the real Provider starts");

console.log("beauty_industry_by09_text_budget_smoke_passed");
}

void main();

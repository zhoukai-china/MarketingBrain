import type { AgentReasoningProfile } from "@baolu/shared";
import { buildAgentMessages, type AgentRequest, type LlmMessage, type LlmProvider } from "@baolu/agent";

export const BEAUTY_TEXT_BUDGET_VERSION = "beauty-text-budget-v1" as const;
export const BEAUTY_TEXT_PRICE_VERSION = "deepseek-v4-pro-20260824-conservative-cny" as const;

const INPUT_CNY_PER_MILLION = 0.435 * 8;
const OUTPUT_CNY_PER_MILLION = 0.87 * 8;

export interface BeautyTextBudget {
  version: typeof BEAUTY_TEXT_BUDGET_VERSION;
  priceVersion: typeof BEAUTY_TEXT_PRICE_VERSION;
  capabilityId: string;
  skillId: string;
  model: "deepseek-v4-pro";
  reasoningProfile: AgentReasoningProfile;
  thinkingMode: "disabled";
  maxPromptBytes: number;
  maxOutputTokens: number;
  worstCostCny: number;
}

type BeautyTextBudgetInput = Omit<BeautyTextBudget, "version" | "priceVersion" | "model" | "thinkingMode" | "worstCostCny">;

const budget = (input: BeautyTextBudgetInput): BeautyTextBudget => ({
  ...input,
  version: BEAUTY_TEXT_BUDGET_VERSION,
  priceVersion: BEAUTY_TEXT_PRICE_VERSION,
  model: "deepseek-v4-pro",
  thinkingMode: "disabled",
  worstCostCny: estimateBeautyTextWorstCost(input.maxPromptBytes, input.maxOutputTokens)
});

const BEAUTY_TEXT_BUDGETS = [
  budget({ capabilityId: "topic_inspiration", skillId: "baolu_topics", reasoningProfile: "standard", maxPromptBytes: 38_000, maxOutputTokens: 3_072 }),
  budget({ capabilityId: "content_plan", skillId: "baolu_content_creator", reasoningProfile: "standard", maxPromptBytes: 66_000, maxOutputTokens: 7_168 }),
  budget({ capabilityId: "beauty_xiaohongshu_package", skillId: "wechat-xhs-content-line", reasoningProfile: "deep", maxPromptBytes: 25_000, maxOutputTokens: 5_120 }),
  budget({ capabilityId: "live_script", skillId: "live_script_planner", reasoningProfile: "standard", maxPromptBytes: 56_000, maxOutputTokens: 3_072 }),
  budget({ capabilityId: "live_review", skillId: "baolu_live_review_engine", reasoningProfile: "standard", maxPromptBytes: 28_000, maxOutputTokens: 3_584 }),
  budget({ capabilityId: "beauty_sales", skillId: "sales_growth_advisor", reasoningProfile: "standard", maxPromptBytes: 25_000, maxOutputTokens: 2_560 })
] as const;

// Product-specific acceptance batches are budgeted independently from the
// six-capability beauty text batch above. Keeping this separate prevents a new
// page from silently expanding the already-approved aggregate batch ceiling.
const BEAUTY_TEXT_STANDALONE_BUDGETS = [
  budget({ capabilityId: "beauty_business_qa", skillId: "general_qa", reasoningProfile: "standard", maxPromptBytes: 25_000, maxOutputTokens: 2_560 })
] as const;

export const BEAUTY_TEXT_BATCH_WORST_COST_CNY = roundCost(
  BEAUTY_TEXT_BUDGETS.reduce((sum, item) => sum + item.worstCostCny, 0)
);

export class BeautyTextBudgetError extends Error {
  constructor(public readonly code: "beauty_text_budget_exceeded" | "beauty_text_budget_model_mismatch" | "beauty_text_budget_not_configured" | "beauty_text_budget_provider_call_limit") {
    super(code);
    this.name = "BeautyTextBudgetError";
  }
}

export function getBeautyTextBudget(capabilityId: string, skillId: string): BeautyTextBudget {
  const matched = [...BEAUTY_TEXT_BUDGETS, ...BEAUTY_TEXT_STANDALONE_BUDGETS]
    .find((item) => item.capabilityId === capabilityId && item.skillId === skillId);
  if (!matched) throw new BeautyTextBudgetError("beauty_text_budget_not_configured");
  return matched;
}

export function estimateBeautyTextWorstCost(maxPromptTokens: number, maxOutputTokens: number): number {
  return roundCost((
    maxPromptTokens * INPUT_CNY_PER_MILLION
    + maxOutputTokens * OUTPUT_CNY_PER_MILLION
  ) / 1_000_000);
}

export function createBeautyTextBudgetedProvider(
  provider: LlmProvider,
  capabilityId: string,
  skillId: string
): LlmProvider {
  const policy = getBeautyTextBudget(capabilityId, skillId);
  const providerWithModel = provider as LlmProvider & { getModel?: () => string };
  let providerCalls = 0;
  const enforce = (messages: LlmMessage[]): void => {
    const actualModel = providerWithModel.getModel?.().trim().toLowerCase();
    if (actualModel !== policy.model) {
      throw new BeautyTextBudgetError("beauty_text_budget_model_mismatch");
    }
    const promptBytes = measurePromptBytes(messages);
    if (promptBytes > policy.maxPromptBytes || policy.worstCostCny > 1) {
      throw new BeautyTextBudgetError("beauty_text_budget_exceeded");
    }
  };
  return {
    name: provider.name,
    getModel: () => providerWithModel.getModel?.() ?? "",
    async preflightAgentRequest(request: AgentRequest) {
      const prepared = await buildAgentMessages(request);
      enforce(prepared.messages);
    },
    async complete(messages, options) {
      enforce(messages);
      if (providerCalls >= 1) throw new BeautyTextBudgetError("beauty_text_budget_provider_call_limit");
      providerCalls += 1;
      return provider.complete(messages, {
        ...options,
        reasoningProfile: policy.reasoningProfile,
        thinkingMode: policy.thinkingMode,
        maxTokens: policy.maxOutputTokens
      });
    }
  } as LlmProvider;
}

export function measurePromptBytes(messages: LlmMessage[]): number {
  return Buffer.byteLength(JSON.stringify(messages), "utf8");
}

function roundCost(value: number): number {
  return Number(value.toFixed(6));
}

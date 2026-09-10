export interface MarketplaceModelUsage {
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
}

// DeepSeek 官方人民币价（每百万 token）。若未来接入不同模型，可按 provider
// 传入不同的单位成本，不在这里写死多套价格表。
export const MARKETPLACE_DEFAULT_INPUT_CNY_PER_1M = 3;
export const MARKETPLACE_DEFAULT_OUTPUT_CNY_PER_1M = 6;

// 思潼对外积分按实际算力成本的倍数定价。
export const MARKETPLACE_CREDIT_MARKUP = 20;
export const MARKETPLACE_COMPUTE_COST_CNY_PER_CREDIT = 0.01;

export function estimateMarketplaceModelCostCny(
  usage: MarketplaceModelUsage,
  inputCnyPer1m = MARKETPLACE_DEFAULT_INPUT_CNY_PER_1M,
  outputCnyPer1m = MARKETPLACE_DEFAULT_OUTPUT_CNY_PER_1M
): number {
  const prompt = Math.max(0, Number(usage.promptTokens) || 0);
  const completion = Math.max(0, Number(usage.completionTokens) || 0);
  // completion_tokens 已包含 reasoning_tokens，不能把 reasoning 再重复计费。
  const cost = (prompt * inputCnyPer1m + completion * outputCnyPer1m) / 1_000_000;
  return Number(cost.toFixed(6));
}

export function marketplaceCreditsForCostCny(
  costCny: number,
  markup = MARKETPLACE_CREDIT_MARKUP,
  costCnyPerCredit = MARKETPLACE_COMPUTE_COST_CNY_PER_CREDIT
): number {
  if (costCny <= 0) return 0;
  return Math.max(1, Math.ceil((costCny * markup) / costCnyPerCredit));
}

export function marketplaceCreditsForUsage(
  usage: MarketplaceModelUsage,
  inputCnyPer1m = MARKETPLACE_DEFAULT_INPUT_CNY_PER_1M,
  outputCnyPer1m = MARKETPLACE_DEFAULT_OUTPUT_CNY_PER_1M
): number {
  return marketplaceCreditsForCostCny(
    estimateMarketplaceModelCostCny(usage, inputCnyPer1m, outputCnyPer1m)
  );
}

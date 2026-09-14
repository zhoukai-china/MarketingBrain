import { CREDIT_PRICING } from "@baolu/shared";

export interface MarketplaceModelUsage {
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
}

/**
 * 事后估算价表（默认口径）：DeepSeek 官方人民币价（每百万 token）。
 *
 * 仓库里还有第二张模型价表——**预算上限用的保守价表**
 * `apps/api/src/products/beauty-industry/text-budget.ts`（`¥3.48 / ¥6.96` 每百万，
 * 版本号 `deepseek-v4-pro-20260824-conservative-cny`）。
 * 两张表的分工、三条报价线（对客售价 / 内部成本 / 各产品线倍数）见 `docs/PRICING.md`。
 * 换模型或模型涨价只改价表与版本号，不改对客价格。
 */
export const MARKETPLACE_DEFAULT_INPUT_CNY_PER_1M = 3;
export const MARKETPLACE_DEFAULT_OUTPUT_CNY_PER_1M = 6;

/**
 * 目标倍数：**成本（¥）→ 对客营收（¥）**，即 ¥1 算力成本对应 ¥100 营收。
 *
 * 历史口径写成 `MARKETPLACE_CREDIT_MARKUP = 20`（注释说「按成本 20 倍定价」）+
 * `MARKETPLACE_COMPUTE_COST_CNY_PER_CREDIT = 0.01`，两数相除实际是 `成本 × 2000 积分`，
 * 也就是 **100 倍营收**——名字与事实不符（PLAT-23 用户选 A：不改数字，只让常量说真话）。
 */
export const MARKETPLACE_TARGET_COST_TO_REVENUE_MULTIPLE = 100;

/** 每积分对客售价（¥0.05）：唯一事实来源是 `packages/shared` 的 `CREDIT_PRICING`（1 元 = 20 积分）。 */
export const MARKETPLACE_CUSTOMER_PRICE_CNY_PER_CREDIT = CREDIT_PRICING.customerPriceCnyPerCredit;

/**
 * 成本（¥）→ 积分 的换算标量 = 目标倍数 ÷ 每积分售价 = `100 / 0.05` = **2000 积分/元成本**。
 * 浮点下 `100 / 0.05` 精确等于 `2000`（契约 smoke 断言这一点），因此这里的推导不带任何误差。
 */
export const MARKETPLACE_CREDITS_PER_COST_CNY =
  MARKETPLACE_TARGET_COST_TO_REVENUE_MULTIPLE / MARKETPLACE_CUSTOMER_PRICE_CNY_PER_CREDIT;

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
  creditsPerCostCny = MARKETPLACE_CREDITS_PER_COST_CNY
): number {
  if (costCny <= 0) return 0;
  // 单次乘法：不再用历史遗留的「× 20 ÷ 0.01」两步分解。两者数学上等价；在「成本 × 2000 正好是
  // 整数」的边界上，旧式的浮点噪声会多送 1 积分（如 ¥0.0035 → 8 分），这里返回精确整数（7 分）。
  // 对客扣费与 SKU 定价无关，不受影响（见 docs/PRICING.md）。
  return Math.max(1, Math.ceil(costCny * creditsPerCostCny));
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

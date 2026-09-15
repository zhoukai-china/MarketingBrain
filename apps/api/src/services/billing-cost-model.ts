import { CREDIT_PRICING } from "@baolu/shared";
import { env } from "../config/env.js";
import { MARKETPLACE_DEFAULT_INPUT_CNY_PER_1M, MARKETPLACE_DEFAULT_OUTPUT_CNY_PER_1M } from "./marketplace-cost.js";

/**
 * 按真实成本计费的统一口径（用户 2026-09-15 拍板大方向，见 `docs/PRICING.md` 第六节）。
 *
 * 用户拍板的四个数：
 *   1. 文字类利润率 **100 倍**（¥1 算力成本 → ¥100 对客营收）；
 *   2. 视频 **2 倍**；
 *   3. `积分 = max(1, ceil(成本 × 倍数 ÷ 0.05))`——不足 1 积分按 1 积分，向上取整；
 *   4. 余额不足：**先预留（按最坏估算）→ 跑完按实际结算 → 差额退回**。
 *
 * 本文件只负责「成本 → 积分」的纯计算与价表，不碰钱包、不写账本；扣费流程的接线
 * （预留/结算/退回）由 `marketplace` 路由在开关打开后走这套函数。
 *
 * **开关**：`BILLING_COST_BASED_ENABLED` 默认 `false`——关着的时候线上扣费仍是 SKU 的固定
 * `ppu`，与改造前一字不差；打开才切到本文件的口径。
 */

export type BillingCapability = "text" | "image" | "video" | "speech";

/** 各能力的对客倍数（成本 → 营收）。改这两个数就等于改价，必须老板单独批准。 */
export const COST_TO_REVENUE_MULTIPLE: Record<BillingCapability, number> = {
  /** 文字：用户 2026-09-15 拍板 100 倍。 */
  text: 100,
  /** 图片：wan2.7-image 成本 ¥0.2/张，5 倍＝20 积分/张，与现价一致（待老板确认是否调整）。 */
  image: 5,
  /** 视频：用户 2026-09-15 拍板 2 倍（此前实际约 5 倍）。 */
  video: 2,
  /** 语音：单价极低，100 倍下基本落到 1 积分地板价（待老板确认是否保持免费）。 */
  speech: 100
};

/** 每积分对客售价（¥0.05）：唯一事实来源 `packages/shared` 的 `CREDIT_PRICING`（1 元 = 20 积分）。 */
export const CUSTOMER_PRICE_CNY_PER_CREDIT = CREDIT_PRICING.customerPriceCnyPerCredit;

/**
 * 单位成本价表（内部口径，绝不进客户端响应）。
 * 文字用 token 价（与 `marketplace-cost.ts` 同一张表）；图片/视频/语音按「一张 / 一秒 / 一秒」计价。
 */
export const UNIT_COST_CNY = {
  textInputPer1M: MARKETPLACE_DEFAULT_INPUT_CNY_PER_1M,
  textOutputPer1M: MARKETPLACE_DEFAULT_OUTPUT_CNY_PER_1M,
  /** 实测：wan2.7-image ¥0.2/张（docs/PRICING.md）。 */
  imagePerPicture: 0.2,
  /** 实测：wan2.6-i2v-flash 720P ¥0.30/秒（2 条 3 秒样片 ¥1.80）。 */
  videoPerSecond: 0.3,
  /** 语音识别（qwen3-asr-flash）暂按 ¥0.0005/秒保守估算，接真实账单后只改这一行。 */
  speechPerSecond: 0.0005
} as const;

/** 成本（¥）→ 积分：100 倍营收、不足 1 积分按 1 积分、向上取整。 */
export function creditsForCostCny(costCny: number, capability: BillingCapability): number {
  const multiplier = COST_TO_REVENUE_MULTIPLE[capability];
  const cost = Number.isFinite(costCny) && costCny > 0 ? costCny : 0;
  // 与 docs/PRICING.md 的标量保持一致：积分 = 成本 ÷ 0.05 × 倍数 = 成本 × (倍数 ÷ 0.05)。
  const raw = (cost * multiplier) / CUSTOMER_PRICE_CNY_PER_CREDIT;
  return Math.max(1, Math.ceil(raw - 1e-9));
}

/** 文字 token 用量 → 成本（¥）。与 marketplace-cost 同一张价表，避免两处算出不同的数。 */
export function textCostCny(usage: { promptTokens: number; completionTokens: number }): number {
  const input = Math.max(0, usage.promptTokens) / 1_000_000 * UNIT_COST_CNY.textInputPer1M;
  const output = Math.max(0, usage.completionTokens) / 1_000_000 * UNIT_COST_CNY.textOutputPer1M;
  return input + output;
}

/** 图片张数 → 成本（¥）。 */
export function imageCostCny(pictures: number): number {
  return Math.max(0, pictures) * UNIT_COST_CNY.imagePerPicture;
}

/** 视频秒数 → 成本（¥）。 */
export function videoCostCny(seconds: number): number {
  return Math.max(0, seconds) * UNIT_COST_CNY.videoPerSecond;
}

/** 语音秒数 → 成本（¥）。 */
export function speechCostCny(seconds: number): number {
  return Math.max(0, seconds) * UNIT_COST_CNY.speechPerSecond;
}

/** 新计费是否已启用（默认关：关着时扣费仍走 SKU 固定 ppu，行为与改造前一致）。 */
export function costBasedBillingEnabled(): boolean {
  return env.BILLING_COST_BASED_ENABLED === "true";
}

/**
 * 预留额度：先按「最坏估算」预留，跑完按实际结算再退差额。
 * 取 `max(1, ceil(...))` 与结算同一套取整，保证「预留 ≥ 结算」，不会出现负余额。
 */
export function reserveCreditsForEstimate(estimatedCostCny: number, capability: BillingCapability): number {
  return creditsForCostCny(estimatedCostCny, capability);
}

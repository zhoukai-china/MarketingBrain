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

export type BillingCapability = "text" | "image" | "video" | "speech" | "vision";

/** 各能力的对客倍数（成本 → 营收）。改这两个数就等于改价，必须老板单独批准。 */
export const COST_TO_REVENUE_MULTIPLE: Record<BillingCapability, number> = {
  /** 文字：用户 2026-09-15 拍板 100 倍。 */
  text: 100,
  /** 图片：用户 2026-09-15 拍板 5 倍（wan2.7-image 成本 ¥0.2/张 → 20 积分/张，与现价一致）。 */
  image: 5,
  /** 视频：用户 2026-09-15 拍板 2 倍（此前实际约 5 倍）。 */
  video: 2,
  /** 语音识别（ASR）：用户 2026-09-15 拍板 10 倍（¥0.0005/秒 → 约 0.1 积分/秒 → 单次基本是 1 积分地板）。 */
  speech: 10,
  /**
   * 视觉（关键帧 / 图片 / 扫描件页面解析）。用户 2026-09-16：「按 0.5 元收费」——
   * 成本 ¥0.02/次 × 25 倍 = **¥0.5/次 = 10 积分/次**（原来 100 倍 = ¥2 = 40 积分）。
   * 注意这是「成本 × 25」：真实账单回来后若单价变了，价格会跟着变；要「永远 ¥0.5」需改成固定价。
   */
  vision: 25
};

/**
 * 市场合伙人分润（用户 2026-09-15：「后面我们要给市场合伙人分润，得记下来每种成本都分润多少」）。
 *
 * 单位是**对客营收的百分比（%）**，按能力分别配置；`null` = 尚未拍板（先留位，不编数字）。
 * 分润基数一律用「实际扣给客户的积分」（`chargedCredits`），与后面按成本计费/固定档位都兼容：
 *   partnerCredits = round(chargedCredits × percent ÷ 100)
 *   platformCredits = chargedCredits − partnerCredits
 * 具体比例等老板拍板后只改这张表，不改任何扣费逻辑。
 */
export const PARTNER_SHARE_PERCENT: Record<BillingCapability, number | null> = {
  text: null,
  image: null,
  video: null,
  speech: null,
  vision: null
};

/** 按当前分润表把一笔扣费拆成「合伙人 / 平台」两部分；未配置比例时返回 null（不臆造分润）。 */
export function splitPartnerShare(chargedCredits: number, capability: BillingCapability): { partnerCredits: number; platformCredits: number } | null {
  const percent = PARTNER_SHARE_PERCENT[capability];
  if (percent === null || !Number.isFinite(percent) || percent <= 0 || percent >= 100) return null;
  const partnerCredits = Math.round((Math.max(0, chargedCredits) * percent) / 100);
  return { partnerCredits, platformCredits: Math.max(0, chargedCredits) - partnerCredits };
}

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
  speechPerSecond: 0.0005,
  /**
   * 视觉（qwen-vl 关键帧 / 图片 / 扫描件页面）暂按 ¥0.02/次（每次 1~8 张图 + 一段提示词）保守估算；
   * 接真实账单后只改这一行，不动倍数与对客价。
   */
  visionPerImageCny: 0.02
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

/** 视觉识别次数（一张图 / 一页扫描件算一次）→ 成本（¥）。 */
export function visionCostCny(images: number): number {
  return Math.max(0, images) * UNIT_COST_CNY.visionPerImageCny;
}

/**
 * 成本计费是否对**至少一个 SKU**生效（默认关：空名单时扣费仍走 SKU 固定 ppu）。
 *
 * 2026-09-15 起真正的开关是 `BILLING_COST_BASED_SKUS` 白名单；`BILLING_COST_BASED_ENABLED`
 * 保留为历史开关（不再参与判定），两人同时存在时以白名单为准。
 */
export function costBasedBillingEnabled(): boolean {
  return costBasedSkuList().length > 0;
}

/** 纯函数：从逗号分隔的白名单字符串里解析出 SKU 集合（大小写不敏感、去空白、去重）。 */
export function parseCostBasedSkuList(raw: string | undefined | null): string[] {
  if (!raw) return [];
  return [...new Set(
    raw
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter((item) => item.length > 0)
  )];
}

/** 当前生效的成本计费 SKU 白名单（env：`BILLING_COST_BASED_SKUS`）。 */
export function costBasedSkuList(): string[] {
  return parseCostBasedSkuList(env.BILLING_COST_BASED_SKUS);
}

/** 纯函数：给定白名单原文，判断某个 SKU 是否按成本计费（支持 `*` 通配）。 */
export function isCostBasedSku(skuCode: string, rawList: string | undefined | null): boolean {
  const list = parseCostBasedSkuList(rawList);
  return list.includes("*") || list.includes(skuCode.trim().toLowerCase());
}

/**
 * 这个 SKU 是否按「实际成本 × 倍数」计费（没进白名单的一律走固定 ppu）。
 *
 * 白名单支持通配 `*`：用户 2026-09-16「每个新增的智能体都可能涉及文字/图片/语音/视频/视觉，
 * 产生多少成本就按对应成本的倍数收费就可以了」——写 `*` 表示**所有货架 SKU（含以后新增的）**
 * 一律按本次真实用量算出的成本计费，不需要每上一个智能体就改一次配置。
 */
export function usesCostBasedPricing(skuCode: string): boolean {
  if (isFixedPriceSku(skuCode)) return false;
  return isCostBasedSku(skuCode, env.BILLING_COST_BASED_SKUS);
}

/**
 * 强制按**固定 ppu** 收费、永不参与成本计费的 SKU，优先级高于 `BILLING_COST_BASED_SKUS`
 * 白名单与 `*` 通配（PLAT-45）。
 *
 * 用户 2026-09-17 拍板：「IP 定位改成按次计费，不按消耗量计费」→ 400 积分/次。
 * 口径理由：IP 定位是低频决策类交付，客户要的是「一次多少钱」的确定性；按成本计费会让
 * 同一件事因为模型输出长度不同而价格浮动。该 SKU 的交付体量本身被硬校验（V1–V10）夹住，
 * 成本方差可控，所以用固定价换客户可预期。其余 SKU 仍维持「按真实成本 × 倍数」。
 */
export const FIXED_PRICE_SKUS: readonly string[] = ["ip-pos"];

/**
 * 这个 SKU 是否被强制固定价（不看成本计费白名单）。
 *
 * 货架上的 `skuCode` 是 `专区__核心码`（如 `ipzone__ip-pos` / `meiye__ip-pos`），
 * 而白名单与 `/billing/*` 价目表用的是核心码（`ip-pos`）。这里统一取最后一段做匹配，
 * 保证「一个 SKU 在两个专区」都能命中，不需要每加一个专区就改一次名单。
 */
export function isFixedPriceSku(skuCode: string): boolean {
  const normalized = skuCode.trim().toLowerCase();
  const core = normalized.includes("__") ? normalized.slice(normalized.lastIndexOf("__") + 2) : normalized;
  return FIXED_PRICE_SKUS.includes(core);
}

/**
 * 预留额度：先按「最坏估算」预留，跑完按实际结算再退差额。
 * 取 `max(1, ceil(...))` 与结算同一套取整，保证「预留 ≥ 结算」，不会出现负余额。
 */
export function reserveCreditsForEstimate(estimatedCostCny: number, capability: BillingCapability): number {
  return creditsForCostCny(estimatedCostCny, capability);
}

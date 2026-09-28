export interface MarketplaceZone {
  key: string;
  name: string;
  tagline: string;
  icon: string;
  ready?: boolean;
  general?: boolean;
  prefix?: string;
}

export interface MarketplaceIndustry {
  key: string;
  title: string;
  tag: string;
  ready: boolean;
  general: boolean;
  prefix?: string;
  who?: string;
  lexicon: string[];
  pains: string[];
  redline: string[];
  ov?: Record<string, Record<string, unknown>>;
}

export interface MarketplaceSku {
  id: string;
  skuCode: string;
  zone: string;
  zoneName: string;
  name: string;
  icon?: string | null;
  badge?: string | null;
  description: string;
  verbs: string[];
  useCase: string;
  need: string;
  tags: string[];
  keywords: string[];
  ppu: number;
  /** 包月价（算力/月）。为 0 或空表示该智能体不支持包月，只能按次/按消耗。 */
  subscriptionCredits?: number | null;
  /** 包月期内的每日次数上限；null = 不限次数。 */
  subscriptionDailyQuota?: number | null;
  /** 包月套餐的口径说明，例如「每天 5 条文案」。 */
  subscriptionQuota?: string | null;
  status: string;
  sortOrder: number;
  supplierName: string;
}

export const BUNDLE_ORDER = ["ip-pos", "topic", "copy", "vidrev", "livescript", "liverev", "sales"];

/**
 * IP 定位工作台的单次计费口径（2026-09-27 用户拍板）：99 算力/次（原 400 算力）。
 *
 * 三处必须同改，否则页面写的价和服务端扣的价会对不上：
 * - 后端发布文件 `apps/api/src/data/marketplace-v3.json` 的 `skills["ip-pos"].ppu`（真源，落库）
 * - 后端价目表 `apps/api/src/routes/billing-consume.ts` 的 `SKILL_PPU["ip-pos"]`
 * - 前端 `IP_POS_PRICE`（本常量：工作台按钮/费用行/交付行 + 对话页确认卡）
 * `scripts/billing-cost-model-smoke.ts` 会钉住这三处一致。
 *
 * 单位口径：IP 定位这一条链路统一显示「算力」（对齐用户给的参考图）；全站余额/充值仍是「算力」。
 */
export const IP_POS_PRICE = 99;
export const IP_POS_UNIT = "算力";

export function coreSkuCode(skuCode: string): string {
  const separator = skuCode.indexOf("__");
  return separator >= 0 ? skuCode.slice(separator + 2) : skuCode;
}

export function zoneOfSku(skuCode: string): string {
  const separator = skuCode.indexOf("__");
  return separator >= 0 ? skuCode.slice(0, separator) : "";
}

export function isBundle(sku: MarketplaceSku): boolean {
  return coreSkuCode(sku.skuCode) === "ip-pack";
}

// 货架可见但内核未完成：仍可进详情看能力介绍，但不允许进入对话、不消耗算力。
export function isComingSoon(sku: MarketplaceSku | null | undefined): boolean {
  return Boolean(sku && sku.status === "coming_soon");
}

export function bundleSteps(sku: MarketplaceSku, all: MarketplaceSku[]): MarketplaceSku[] {
  if (!isBundle(sku)) return [];
  const zone = zoneOfSku(sku.skuCode);
  return BUNDLE_ORDER
    .map((sid) => all.find((item) => item.skuCode === `${zone}__${sid}`))
    .filter((item): item is MarketplaceSku => Boolean(item));
}

export function bundleTotal(sku: MarketplaceSku, all: MarketplaceSku[]): number {
  return bundleSteps(sku, all).reduce((sum, step) => sum + step.ppu, 0);
}

export function groupByZone(skus: MarketplaceSku[], zones: MarketplaceZone[]) {
  return zones
    .map((zone) => ({ zone, items: skus.filter((sku) => sku.zone === zone.key) }))
    .filter((group) => group.items.length > 0);
}

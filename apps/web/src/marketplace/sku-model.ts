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
  status: string;
  sortOrder: number;
  supplierName: string;
}

export const BUNDLE_ORDER = ["ip-pos", "topic", "copy", "vidrev", "livescript", "liverev", "sales"];

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

// 货架可见但内核未完成：仍可进详情看能力介绍，但不允许进入对话、不消耗积分。
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

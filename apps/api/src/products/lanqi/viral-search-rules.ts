/**
 * 兰琪「视频获客 · 爆款复刻」的爆款检索规则层（LQ-25）。
 *
 * 用户口径（2026-09-12）：爆款复刻的检索源 = **抖音 + 视频号两个平台**，开闸跑，
 * 且**暂时只在兰琪用**（美业单品那条链路不接）。
 *
 * 这一层只做确定性判定，不联网、不调模型，因此可以被冒烟测试完整覆盖：
 *   ① 什么算「可点开的平台条目」——只认平台域内的站内页，第三方站点（搜狐 / 知乎 …）一律丢弃；
 *   ② 账号主页、搜索结果页、开放平台文档页不是可复刻条目，必须拒掉；
 *   ③ 视频号站内视频页目前没有公开索引，命中的微信生态图文必须按**真实类型**标注，
 *      不冒充视频；热度以页面自身展示为准，这里不推算、不编造任何播放量 / 点赞数。
 */

export const VIRAL_SEARCH_RULES_VERSION = "lanqi_viral_search_rules_v1";

export const VIRAL_SEARCH_DEFAULT_LIMIT = 8;
export const VIRAL_SEARCH_LIMIT_MAX = 12;
export const VIRAL_SEARCH_KEYWORD_MAX = 40;

export type ViralPlatformFilter = "all" | "dy" | "sph";
export type ViralPlatform = "dy" | "sph";
export type ViralEntryKind = "video" | "note" | "channel" | "article";
export type ViralCategory = "skin" | "nail" | "spa" | "mix";

export const VIRAL_PLATFORM_LABELS: Record<ViralPlatform, string> = {
  dy: "抖音",
  sph: "视频号"
};

/** 条目真实类型：抖音视频 / 抖音图文 / 视频号页 / 微信图文。 */
export const VIRAL_KIND_LABELS: Record<ViralEntryKind, string> = {
  video: "抖音视频",
  note: "抖音图文",
  channel: "视频号页",
  article: "微信图文"
};

/** 行业领域只用于给检索词补一个同赛道限定词，不影响条目判定。 */
export const VIRAL_CATEGORY_WORDS: Record<ViralCategory, string> = {
  skin: "皮肤管理",
  nail: "美甲美睫",
  spa: "SPA养生",
  mix: "生活美容"
};

/** 面向门店的口径声明：把「结果从哪来、什么没给」一次说清，避免被当成平台官方榜单。 */
export const VIRAL_SEARCH_DISCLOSURE =
  "结果来自公开网页检索：抖音站内公开页 + 微信生态公开页。热度以页面自身展示为准，本页不推算、不编造数据；视频号站内视频页暂不对外开放检索，命中微信生态图文时会按真实类型标注。";

export const VIRAL_SEARCH_EMPTY_NOTE =
  "这次没有检索到可点开的抖音 / 视频号公开页面。换个更具体的关键词（例如「皮肤管理 团购」）再试一次。";

export const VIRAL_SEARCH_UNAVAILABLE_NOTE =
  "爆款检索服务还没有开通，暂时给不出结果。可以先用自己刷到的爆款，等检索接通后再回来搜。";

export const VIRAL_SEARCH_UPSTREAM_FAILED_NOTE =
  "检索服务这次没有返回结果（可能超时或被限流），请稍后重试。没有结果就是没有结果，不会给你编造的条目。";

export interface ViralSearchHit {
  siteName?: string;
  title?: string;
  url?: string;
  snippet?: string;
}

export interface ViralSearchItem {
  id: string;
  platform: ViralPlatform;
  platformLabel: string;
  kind: ViralEntryKind;
  kindLabel: string;
  title: string;
  url: string;
  site: string;
  snippet: string;
}

export interface ClassifiedViralUrl {
  platform: ViralPlatform;
  kind: ViralEntryKind;
  canonicalUrl: string;
}

const PLATFORM_ORDER: ViralPlatform[] = ["dy", "sph"];
const KIND_ORDER: ViralEntryKind[] = ["video", "note", "channel", "article"];

function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/** 抖音站内页：只认 /video/{id} 与 /note/{id}；账号主页、搜索页、短链都不算条目。 */
function classifyDouyin(host: string, path: string): ClassifiedViralUrl | null {
  if (!hostMatches(host, "douyin.com") && !hostMatches(host, "iesdouyin.com")) return null;
  const matched = path.match(/^\/(video|note)\/(\d{6,25})\/?$/);
  if (!matched) return null;
  const kind = matched[1] as "video" | "note";
  return { platform: "dy", kind, canonicalUrl: `https://www.douyin.com/${kind}/${matched[2]}` };
}

/** 视频号侧：微信生态公开页（视频号站内页 / 公众号图文），按真实类型标注，不冒充视频。 */
function classifyWeixin(host: string, path: string, search: string): ClassifiedViralUrl | null {
  if (!path || path === "/") return null;
  if (hostMatches(host, "channels.weixin.qq.com")) {
    return { platform: "sph", kind: "channel", canonicalUrl: `https://${host}${path}${search}` };
  }
  if (hostMatches(host, "mp.weixin.qq.com")) {
    return { platform: "sph", kind: "article", canonicalUrl: `https://${host}${path}${search}` };
  }
  if (hostMatches(host, "weixin.qq.com")) {
    return { platform: "sph", kind: "channel", canonicalUrl: `https://${host}${path}${search}` };
  }
  return null;
}

export function classifyViralUrl(raw: unknown): ClassifiedViralUrl | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  return classifyDouyin(host, url.pathname) ?? classifyWeixin(host, url.pathname, url.search);
}

export function normalizeViralKeyword(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  if (trimmed.length > VIRAL_SEARCH_KEYWORD_MAX) return null;
  return trimmed;
}

export function normalizePlatformFilter(raw: unknown): ViralPlatformFilter {
  return raw === "dy" || raw === "sph" ? raw : "all";
}

export function normalizeViralCategory(raw: unknown): ViralCategory | null {
  return raw === "skin" || raw === "nail" || raw === "spa" || raw === "mix" ? raw : null;
}

export function platformsForFilter(filter: ViralPlatformFilter): ViralPlatform[] {
  return filter === "all" ? [...PLATFORM_ORDER] : [filter];
}

/**
 * 检索词：平台站内限定 + 关键词 + 行业补充词。
 *
 * 抖音侧实测（2026-09-12，同一关键词比较三种写法）：抖音站内的视频页几乎不被公开索引，
 * 直写 `site:douyin.com` 只回图文页；带上「爆款视频」并限定 `site:douyin.com/video` 后
 * 有效条目从 3 条升到 5 条且仍全是抖音站内页，所以抖音侧固定用这一种写法。
 */
export function buildViralSearchQuery(keyword: string, platform: ViralPlatform, category?: ViralCategory | null): string {
  const categoryWord = category ? VIRAL_CATEGORY_WORDS[category] : "";
  const suffix = categoryWord && !keyword.includes(categoryWord) ? ` ${categoryWord}` : "";
  if (platform === "dy") return `抖音 ${keyword}${suffix} 爆款视频 site:douyin.com/video`;
  return `site:mp.weixin.qq.com ${keyword}${suffix} 视频号`;
}

function stripTags(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/** 搜索返回的标题常带站点尾巴（「… - 抖音」），门店看到会误以为是平台官方标题。 */
function sanitizeTitle(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const cleaned = stripTags(raw).replace(/[-_|·]\s*(抖音|腾讯网|搜狐网|知乎|新浪网|网易)\s*$/, "").trim();
  return clip(cleaned, 60);
}

function sanitizeSnippet(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return clip(stripTags(raw), 120);
}

function sanitizeSite(raw: unknown, platform: ViralPlatform): string {
  const cleaned = typeof raw === "string" ? stripTags(raw) : "";
  return cleaned ? clip(cleaned, 24) : VIRAL_PLATFORM_LABELS[platform];
}

/** 条目 id：由 canonical URL 派生，保证同一条目每次返回同一个 id（便于前端选中与去重）。 */
function itemId(canonicalUrl: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < canonicalUrl.length; index++) {
    hash ^= canonicalUrl.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `viral_${hash.toString(16).padStart(8, "0")}`;
}

export interface NormalizeViralResultsOptions {
  platform: ViralPlatformFilter;
  limit?: number;
}

/**
 * 把检索结果整形成前端可直接渲染的条目：
 * 平台域外、类型不明、标题为空的一律丢弃；同 canonical URL 去重；按平台 / 类型排序后截断。
 */
export function normalizeViralResults(hits: readonly ViralSearchHit[], options: NormalizeViralResultsOptions): ViralSearchItem[] {
  const allowed = new Set(platformsForFilter(options.platform));
  const rawLimit = typeof options.limit === "number" && Number.isFinite(options.limit) ? Math.floor(options.limit) : VIRAL_SEARCH_DEFAULT_LIMIT;
  const limit = Math.min(Math.max(rawLimit, 1), VIRAL_SEARCH_LIMIT_MAX);
  const seen = new Set<string>();
  const items: { item: ViralSearchItem; order: number }[] = [];

  hits.forEach((hit, index) => {
    if (!hit) return;
    const classified = classifyViralUrl(hit.url);
    if (!classified || !allowed.has(classified.platform)) return;
    const title = sanitizeTitle(hit.title);
    if (!title) return;
    if (seen.has(classified.canonicalUrl)) return;
    seen.add(classified.canonicalUrl);
    items.push({
      item: {
        id: itemId(classified.canonicalUrl),
        platform: classified.platform,
        platformLabel: VIRAL_PLATFORM_LABELS[classified.platform],
        kind: classified.kind,
        kindLabel: VIRAL_KIND_LABELS[classified.kind],
        title,
        url: classified.canonicalUrl,
        site: sanitizeSite(hit.siteName, classified.platform),
        snippet: sanitizeSnippet(hit.snippet)
      },
      order: index
    });
  });

  items.sort((left, right) => {
    const platformDelta = PLATFORM_ORDER.indexOf(left.item.platform) - PLATFORM_ORDER.indexOf(right.item.platform);
    if (platformDelta !== 0) return platformDelta;
    const kindDelta = KIND_ORDER.indexOf(left.item.kind) - KIND_ORDER.indexOf(right.item.kind);
    if (kindDelta !== 0) return kindDelta;
    return left.order - right.order;
  });

  return items.slice(0, limit).map(entry => entry.item);
}

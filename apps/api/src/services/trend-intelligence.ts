import { createHash } from "node:crypto";
import { domesticNetworkOnly, domesticOutboundAllowlist, env } from "../config/env.js";
import { assertOutboundUrlAllowed } from "./outbound-policy.js";

export type TrendScanMode = "ai" | "industry";

export interface TrendSignal {
  title: string;
  source: string;
  url?: string;
  publishedAt?: string;
  query?: string;
  eventType: string;
  score: number;
  verificationReason: string;
  sourceTrust: "primary_authority" | "trusted_media" | "public_unverified";
}

export interface TrendScanResult {
  topic: string;
  mode: TrendScanMode;
  retrievedAt: string;
  searchedSourceCount: number;
  successfulSourceCount: number;
  verifiedHotspots: TrendSignal[];
  watchSignals: TrendSignal[];
}

export interface PublicIndustryKnowledgeDocument {
  externalId: string;
  title: string;
  content: string;
  source: string;
  url: string;
  publishedAt?: string;
  sourceTrust: TrendSignal["sourceTrust"];
  eventType: string;
  query?: string;
}

interface SourceRequest {
  url: string;
  query?: string;
}

interface CandidateSignal {
  title: string;
  url?: string;
  publishedAt?: string;
  sourceLabel?: string;
}

const SOURCE_TIMEOUT_MS = 5500;
const EVENT_TERMS = /政策|新规|监管|条例|办法|通知|征求意见|补贴|专项资金|试点|标准|声明|公布|印发|公告|施行|生效|白皮书|报告发布|数据发布|指数发布|融资|并购|收购|正式发布|重磅发布|上线|开放|升级|推出|首发|签约落地|项目落地|正式落地|大会|峰会|论坛/;
const STRONG_EVENT_TERMS = /政策|新规|监管|条例|办法|通知|征求意见|补贴|专项资金|试点|标准|声明|公布|印发|公告|施行|生效|白皮书|报告发布|数据发布|指数发布|融资|并购|收购|正式发布|上线|开放|升级|推出|首发|签约落地|项目落地|正式落地/;
const LOW_VALUE_TERMS = /我认为|我看到|我想|终极|深度解剖|深度解读|解读|评论|观察|全景洞察|真相|揭秘|别再|为什么|怎么|避坑|最容易|最值得|哪\d+个|只有这一个|快速出效果|低成本|必看|必学|必做|干货|课程|训练营|招商|招募|报名|邀请|火热|炸了|一夜变天|赚钱|变现|能力升级/;
const AUTHORITY_TERMS = /国务院|政府|工信|发改|财政|监管|协会|研究院|科学院|大学|新华社|人民网|日报|证券报|官方/;
const TRUSTED_MEDIA_TERMS = /机器之心|雷峰网|钛媒体|36氪|投资界|晚点|财联社|第一财经|经济观察|中国经营报|创业邦|量子位|新智元|界面新闻|虎嗅|jiqizhixin|leiphone|tmtpost/;
const AI_TERMS = /AI|人工智能|大模型|智能体|Agent|AIGC|机器人|生成式|算力|模型|DeepSeek|Kimi|通义|豆包|百炼/i;

export async function scanIndustryTrends(
  topic: string,
  options: { mode?: TrendScanMode; limit?: number; maxAgeDays?: number } = {}
): Promise<TrendScanResult> {
  const cleanedTopic = topic.trim();
  const mode = options.mode ?? (AI_TERMS.test(cleanedTopic) ? "ai" : "industry");
  const limit = Math.max(1, Math.min(options.limit ?? 10, 200));
  const maxAgeDays = Math.max(1, Math.min(options.maxAgeDays ?? 45, 180));
  const sources = buildTrendSources(cleanedTopic, mode);
  const settled = await Promise.allSettled(sources.map((source) => fetchTrendSource(source, cleanedTopic, mode)));
  const successfulSourceCount = settled.filter((item) => item.status === "fulfilled" && item.value.ok).length;
  const candidates = settled.flatMap((item) => item.status === "fulfilled" ? item.value.signals : []);
  const seen = new Set<string>();
  const ranked = candidates
    .filter((item) => {
      const key = item.title.replace(/\s+/g, "");
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((item) => scoreTrendSignal(item, cleanedTopic, mode))
    .sort((a, b) => b.score - a.score);

  return {
    topic: cleanedTopic,
    mode,
    retrievedAt: new Date().toISOString(),
    searchedSourceCount: sources.length,
    successfulSourceCount,
    verifiedHotspots: ranked.filter((item) => isVerifiedHotspot(item, maxAgeDays)).slice(0, limit),
    // A knowledge-base crawl needs broad, traceable candidates. Low-score
    // material is still excluded later unless it is a domestic allowlisted URL.
    watchSignals: ranked.filter((item) => !isVerifiedHotspot(item, maxAgeDays) && item.score >= 0).slice(0, limit)
  };
}

/**
 * Reads a bounded, traceable batch from public domestic allowlisted sources.
 * Discovery pages are never stored as knowledge documents and every article
 * URL is checked against the outbound allowlist again before it is fetched.
 */
export async function crawlPublicIndustryKnowledge(
  industry: string,
  options: { offset?: number; limit?: number; expanded?: boolean; keywords?: string[] } = {}
): Promise<{ documents: PublicIndustryKnowledgeDocument[]; discovered: number; hasMore: boolean; consumed: number }> {
  const offset = Math.max(0, options.offset ?? 0);
  const limit = Math.max(1, Math.min(options.limit ?? 25, 50));
  const topics = Array.from(new Set([
    industry.trim(),
    ...(options.keywords ?? []).map((item) => item.trim()).filter(Boolean),
    ...(options.expanded ? [
      `${industry} 行业应用案例`,
      `${industry} 市场规模 数据报告`,
      `${industry} 产业链 标准`
    ] : [])
  ])).slice(0, 5);
  const scans = await Promise.all(topics.map((topic) => scanIndustryTrends(topic, { mode: "industry", limit: 200, maxAgeDays: 365 })));
  const candidates = scans.flatMap((scan) => [...scan.verifiedHotspots, ...scan.watchSignals])
    .filter((signal) => Boolean(signal.url) && !isSearchResultUrl(signal.url))
    .filter((signal, index, list) => list.findIndex((item) => item.url === signal.url) === index);
  const selected = candidates.slice(offset, offset + limit);
  const settled = await Promise.allSettled(selected.map(async (signal) => {
    const url = signal.url!;
    assertOutboundUrlAllowed("industry knowledge article", url, {
      domesticNetworkOnly,
      allowedHosts: domesticOutboundAllowlist
    });
    const response = await fetchTrendResponse(url);
    if (!response.ok) throw new Error(`industry article returned ${response.status}`);
    const content = extractArticleText(await response.text());
    if (content.length < 160) throw new Error("industry article has insufficient public text");
    return {
      externalId: createPublicDocumentExternalId(url), title: signal.title, content,
      source: signal.source, url, publishedAt: signal.publishedAt,
      sourceTrust: signal.sourceTrust, eventType: signal.eventType, query: signal.query
    } satisfies PublicIndustryKnowledgeDocument;
  }));
  return {
    documents: settled.flatMap((item) => item.status === "fulfilled" ? [item.value] : []),
    discovered: candidates.length,
    hasMore: offset + selected.length < candidates.length,
    consumed: selected.length
  };
}

export function scoreTrendSignal(
  signal: CandidateSignal & { source: string; query?: string },
  topic: string,
  mode: TrendScanMode
): TrendSignal {
  const title = signal.title;
  const sourceIdentity = `${signal.source} ${signal.sourceLabel ?? ""}`;
  const tokens = tokenizeTopic(`${topic} ${signal.query ?? ""}`);
  let score = 0;
  let recencyLabel = "发布日期缺失";
  const publishedAt = signal.publishedAt ? new Date(`${signal.publishedAt}T00:00:00+08:00`).getTime() : Number.NaN;
  if (Number.isFinite(publishedAt)) {
    const ageDays = (Date.now() - publishedAt) / 86_400_000;
    recencyLabel = ageDays <= 14 ? "近14天" : ageDays <= 45 ? "近45天" : ageDays <= 90 ? "近90天" : "超过90天";
    if (ageDays <= 14 && ageDays >= -1) score += 5;
    else if (ageDays <= 45 && ageDays >= -1) score += 4;
    else if (ageDays <= 90 && ageDays >= -1) score += 1;
    else score -= 8;
  } else {
    score -= 3;
  }
  if (STRONG_EVENT_TERMS.test(title)) score += 6;
  else if (EVENT_TERMS.test(title)) score += 2;
  const sourceTrust = isPrimaryAuthority(sourceIdentity)
    ? "primary_authority"
    : TRUSTED_MEDIA_TERMS.test(sourceIdentity)
      ? "trusted_media"
      : "public_unverified";
  if (sourceTrust === "primary_authority") score += 3;
  else if (sourceTrust === "trusted_media") score += 2;
  if (/中小企业|产业|行业|企业级|商业化|全国|省级|亿元|标准化|应用落地|企业落地/.test(title)) score += 2;
  if (mode === "ai" && AI_TERMS.test(title)) score += 3;
  score += Math.min(4, tokens.filter((token) => title.toLowerCase().includes(token.toLowerCase())).length * 2);
  if (/政策|新规|监管|条例|办法|通知|征求意见|补贴|专项资金/.test(title) && sourceTrust !== "primary_authority") score -= 6;
  if (LOW_VALUE_TERMS.test(title)) score -= 7;

  const eventType = classifyEventType(title);
  const sourceLabel = signal.sourceLabel || signal.source;
  return {
    title,
    source: sourceLabel,
    url: signal.url,
    publishedAt: signal.publishedAt,
    query: signal.query,
    eventType,
    score,
    verificationReason: `${recencyLabel}；${eventType}；${sourceTrust === "primary_authority" ? "权威/一手来源" : sourceTrust === "trusted_media" ? "可信行业媒体" : "公开来源待交叉核验"}；${isSearchResultUrl(signal.url) ? "搜索结果页线索" : "可回溯原文页"}`,
    sourceTrust
  };
}

export function extractTrendCandidates(body: string, sourceUrl: string): CandidateSignal[] {
  const candidates: CandidateSignal[] = [];
  for (const match of body.matchAll(/<item[\s\S]*?<title[^>]*>([\s\S]*?)<\/title>([\s\S]*?)<\/item>/gi)) {
    const block = match[0];
    const title = normalizeTitle(stripHtml(match[1]));
    const link = stripHtml(block.match(/<link[^>]*>([\s\S]*?)<\/link>/i)?.[1] ?? "");
    const publishedAt = parseDate(block.match(/<(?:pubDate|published|updated)[^>]*>([\s\S]*?)<\/(?:pubDate|published|updated)>/i)?.[1]);
    if (title) candidates.push({ title, url: normalizeUrl(link, sourceUrl), publishedAt });
  }
  for (const match of body.matchAll(/<entry[\s\S]*?<title[^>]*>([\s\S]*?)<\/title>([\s\S]*?)<\/entry>/gi)) {
    const block = match[0];
    const title = normalizeTitle(stripHtml(match[1]));
    const link = block.match(/<link[^>]+href=["']([^"']+)["']/i)?.[1] ?? "";
    const publishedAt = parseDate(block.match(/<(?:published|updated)[^>]*>([\s\S]*?)<\/(?:published|updated)>/i)?.[1]);
    if (title) candidates.push({ title, url: normalizeUrl(link, sourceUrl), publishedAt });
  }
  for (const match of body.matchAll(/<li[^>]+id=["']sogou_vr_11002601_box_\d+["'][^>]*>([\s\S]*?)<\/li>/gi)) {
    const item = match[1];
    const titleMatch = item.match(/<h3[^>]*>[\s\S]*?<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h3>/i);
    if (!titleMatch) continue;
    const timestamp = Number(item.match(/timeConvert\(['"]?(\d{9,13})['"]?\)/i)?.[1]);
    const publishedAt = Number.isFinite(timestamp)
      ? new Date(timestamp * (timestamp < 10_000_000_000 ? 1000 : 1)).toISOString().slice(0, 10)
      : parseNearbyDate(item);
    const sourceLabel = normalizeSourceLabel(stripHtml(item.match(/<span[^>]+class=["']all-time-y2["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? ""));
    const title = normalizeTitle(stripHtml(titleMatch[2]));
    if (title) candidates.push({ title, url: normalizeUrl(titleMatch[1], sourceUrl), publishedAt, sourceLabel });
  }
  for (const match of body.matchAll(/<a[^>]+href=(?:["']([^"']+)["']|([^\s>]+))[^>]*>([\s\S]{6,220}?)<\/a>/gi)) {
    const href = match[1] || match[2];
    const title = normalizeTitle(stripHtml(match[3]));
    if (!title) continue;
    const nearby = body.slice(match.index ?? 0, (match.index ?? 0) + match[0].length + 220);
    candidates.push({ title, url: normalizeUrl(href, sourceUrl), publishedAt: parseNearbyDate(nearby) });
  }
  const seen = new Set<string>();
  return candidates.filter((item) => {
    const key = item.title.replace(/\s+/g, "");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 80);
}

function buildTrendSources(topic: string, mode: TrendScanMode): SourceRequest[] {
  const queries = buildTrendQueries(topic, mode);
  const searchSources = queries.flatMap((query) => [
    { query, url: `https://weixin.sogou.com/weixin?type=2&query=${encodeURIComponent(query)}` },
    { query, url: `https://www.sogou.com/web?query=${encodeURIComponent(query)}` }
  ]);
  const aiSearchSources = mode === "ai"
    ? queries.slice(0, 3).flatMap((query) => [
        { query, url: `https://www.leiphone.com/search?s=${encodeURIComponent(query)}` },
        { query, url: `https://www.jiqizhixin.com/search?query=${encodeURIComponent(query)}` }
      ])
    : [];
  const configuredAiSources = mode === "ai"
    ? env.AI_DAILY_NEWS_SOURCES.split(",").map((url) => url.trim()).filter((url) => url.startsWith("http")).map((url) => ({ url }))
    : [];
  const genericAuthoritySources = mode === "industry"
    ? [
        { url: "https://www.miit.gov.cn/xwfb/bldhd/index.html" },
        { url: "https://www.cac.gov.cn/yaowen/wxyw/A093602index_1.htm" }
      ]
    : [];
  const seen = new Set<string>();
  return [...configuredAiSources, ...genericAuthoritySources, ...searchSources, ...aiSearchSources].filter((item) => {
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  }).slice(0, mode === "ai" ? 24 : 36);
}

function buildTrendQueries(topic: string, mode: TrendScanMode): string[] {
  const cleaned = topic || (mode === "ai" ? "人工智能" : "行业");
  const suffixes = mode === "ai"
    ? ["最新发布", "政策 报告", "产品上线", "企业落地", "融资 并购"]
    : ["行业热点", "政策 新规", "报告 数据", "产品发布", "融资 并购", "重大案例"];
  return Array.from(new Set([cleaned, ...suffixes.map((suffix) => `${cleaned} ${suffix}`)])).slice(0, 6);
}

async function fetchTrendSource(
  source: SourceRequest,
  topic: string,
  mode: TrendScanMode
): Promise<{ ok: boolean; signals: Array<CandidateSignal & { source: string; query?: string }> }> {
  try {
    assertOutboundUrlAllowed("trend intelligence source", source.url, {
      domesticNetworkOnly,
      allowedHosts: domesticOutboundAllowlist
    });
    const response = await fetchTrendResponse(source.url);
    if (!response.ok) return { ok: false, signals: [] };
    const body = await response.text();
    const sourceName = sourceNameFromUrl(source.url);
    const tokens = tokenizeTopic(`${topic} ${source.query ?? ""}`);
    const signals = extractTrendCandidates(body, source.url)
      .filter((item) => isTopicRelevant(item.title, tokens, mode))
      .map((item) => ({ ...item, source: item.sourceLabel || sourceNameFromUrl(item.url || source.url) || sourceName, query: source.query }))
      .slice(0, 12);
    return { ok: true, signals };
  } catch {
    return { ok: false, signals: [] };
  }
}

async function fetchTrendResponse(url: string): Promise<Response> {
  const attempts = /(?:^|\.)cac\.gov\.cn|(?:^|\.)miit\.gov\.cn|(?:^|\.)caict\.ac\.cn/i.test(new URL(url).hostname) ? 2 : 1;
  let lastResponse: Response | undefined;
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { "user-agent": "SitongTrendIntel/1.0", accept: "text/html,application/xml,*/*" },
        signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS + attempt * 2000)
      });
      lastResponse = response;
      if (response.ok) return response;
    } catch (error) {
      lastError = error;
    }
  }
  if (lastResponse) return lastResponse;
  throw lastError instanceof Error ? lastError : new Error("trend source request failed");
}

function isVerifiedHotspot(signal: TrendSignal, maxAgeDays: number): boolean {
  if (!signal.publishedAt || !signal.url || signal.score < 11 || !STRONG_EVENT_TERMS.test(signal.title)) return false;
  const ageDays = (Date.now() - new Date(`${signal.publishedAt}T00:00:00+08:00`).getTime()) / 86_400_000;
  if (!Number.isFinite(ageDays) || ageDays < -1 || ageDays > maxAgeDays) return false;
  if (isSearchResultUrl(signal.url)) return false;
  if (LOW_VALUE_TERMS.test(signal.title) || signal.sourceTrust === "public_unverified") return false;
  if (signal.eventType === "政策/监管事件" || signal.eventType === "权威报告/数据") {
    return signal.sourceTrust === "primary_authority";
  }
  return true;
}

function isTopicRelevant(title: string, tokens: string[], mode: TrendScanMode): boolean {
  if (/首页|搜索结果|登录|注册|联系我们|下一页|上一页|免责声明|招聘|关于搜狗|搜狗服务|隐私|广告/.test(title)) return false;
  if (mode === "ai" && AI_TERMS.test(title)) return true;
  // Chinese industry names without separators can yield no useful token from a
  // discovery URL. The downstream crawler still enforces the domestic source
  // allowlist and stores provenance, so preserve these public candidates.
  if (mode === "industry" && tokens.length === 0) return true;
  return tokens.some((token) => title.toLowerCase().includes(token.toLowerCase()));
}

function tokenizeTopic(value: string): string[] {
  return Array.from(new Set(value
    .split(/[\s，。、“”‘’；;：:（）()[\]【】{}<>《》|/\\]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2 && !/热点|最新|行业|政策|报告|产品|发布|数据|重大案例/.test(item))));
}

function classifyEventType(title: string): string {
  if (/政策|新规|监管|条例|办法|通知|征求意见|补贴|专项资金|试点|标准|声明|公布|印发|公告|施行|生效/.test(title)) return "政策/监管事件";
  if (/白皮书|报告发布|研究报告|数据发布|指数发布/.test(title)) return "权威报告/数据";
  if (/融资|并购|收购/.test(title)) return "资本事件";
  if (/正式发布|重磅发布|上线|开放|升级|推出|首发/.test(title)) return "产品/技术发布";
  if (/签约落地|项目落地|正式落地/.test(title)) return "重大落地案例";
  if (/大会|峰会|论坛/.test(title)) return "行业活动";
  return "公开信号";
}

function parseNearbyDate(value: string): string | undefined {
  const absolute = value.match(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})日?/);
  if (absolute) return `${absolute[1]}-${absolute[2].padStart(2, "0")}-${absolute[3].padStart(2, "0")}`;
  const short = value.match(/(?<!\d)(\d{1,2})[-/.月](\d{1,2})日?(?!\d)/);
  if (short) return `${new Date().getFullYear()}-${short[1].padStart(2, "0")}-${short[2].padStart(2, "0")}`;
  return undefined;
}

function parseDate(value?: string): string | undefined {
  if (!value) return undefined;
  const direct = parseNearbyDate(value);
  if (direct) return direct;
  const parsed = new Date(stripHtml(value));
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString().slice(0, 10);
}

function normalizeTitle(value: string): string {
  const title = value.replace(/\s+/g, " ").replace(/^[·\-—\s]+|[·\-—\s]+$/g, "").trim();
  if (title.length < 6 || title.length > 110 || /^\d+$/.test(title)) return "";
  if (/首页|搜索结果|搜狗微信搜索|相关微信公众号文章|登录|注册|联系我们|下一页|上一页|免责声明|京ICP/.test(title)) return "";
  return title;
}

function normalizeSourceLabel(value: string): string | undefined {
  const label = value.trim();
  return label.length >= 2 && label.length <= 50 ? label : undefined;
}

function normalizeUrl(href: string, sourceUrl: string): string | undefined {
  if (!href || href.startsWith("javascript:") || href.startsWith("#")) return undefined;
  try {
    return new URL(href, sourceUrl).toString();
  } catch {
    return undefined;
  }
}

function isPrimaryAuthority(value: string): boolean {
  return AUTHORITY_TERMS.test(value) || /(?:^|\.)gov\.cn|(?:^|\.)edu\.cn|caict\.ac\.cn|ruc\.edu\.cn|pku\.edu\.cn|tsinghua\.edu\.cn/i.test(value);
}

function isSearchResultUrl(url?: string): boolean {
  if (!url) return true;
  try {
    const parsed = new URL(url);
    return /(?:^|\.)sogou\.com$/i.test(parsed.hostname) || /\/search(?:[/?]|$)|search_result/i.test(parsed.pathname);
  } catch {
    return true;
  }
}

function sourceNameFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function stripHtml(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;|&ldquo;|&rdquo;/g, "\"")
    .replace(/&lsquo;|&rsquo;/g, "'")
    .replace(/&mdash;/g, "—")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCharCode(Number.parseInt(code, 16)))
    .trim();
}

function extractArticleText(body: string): string {
  return stripHtml(body)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80_000);
}

function createPublicDocumentExternalId(url: string): string {
  return `public:${createHash("sha256").update(url).digest("hex")}`;
}

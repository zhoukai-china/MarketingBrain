import type { AiNewsItem } from "./ai-news-data.js";
import { createRuntimeLlmProvider } from "./llm-provider-factory.js";
import type { LlmMessage } from "@baolu/agent";

/**
 * AI 资讯真实抓取：中文科技/AI 媒体 RSS → 去重 → 大模型批量生成
 * 摘要 / 分类 / 标签 / 「思潼解读」→ 进程内缓存，供 /ai-news 系列接口使用。
 *
 * 兜底链：抓取或解读失败 → 继续用上一次成功缓存 → 仍无则回退种子数据
 * （ai-news-data.ts，编辑审校稿）。所有失败只打日志，不影响接口可用性。
 */

interface RssSource {
  name: string;
  url: string;
  color: string;
}

const RSS_SOURCES: RssSource[] = [
  { name: "量子位", url: "https://www.qbitai.com/feed", color: "#2BB673" },
  { name: "机器之心", url: "https://www.jiqizhixin.com/rss", color: "#4C7DFF" },
  { name: "36氪", url: "https://36kr.com/feed", color: "#FF7A45" }
];

/** 缓存有效期：超过后后台自动重抓（POST /ai-news/refresh 可强制）。 */
const LIVE_TTL_MS = 3 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15000;
const LLM_MAX_ITEMS = 10;
/** 每日定时全量刷新时刻（与页面文案「每日 08:00 自动更新」一致）。 */
const DAILY_REFRESH_HOUR = 8;
const DAILY_REFRESH_MINUTE = 0;

interface RawEntry {
  source: RssSource;
  title: string;
  link: string;
  pubDate: Date | null;
  description: string;
}

export interface LiveAiNews {
  fetchedAt: number;
  items: AiNewsItem[];
}

let liveCache: LiveAiNews | null = null;
let inflight: Promise<LiveAiNews | null> | null = null;
let inited = false;
let lastDailyRefreshDay = "";

export function getLiveAiNews(): LiveAiNews | null {
  if (!liveCache || liveCache.items.length === 0) return null;
  return liveCache;
}

function isStale(): boolean {
  return !liveCache || Date.now() - liveCache.fetchedAt > LIVE_TTL_MS;
}

/**
 * 后台定时任务（服务启动时注册，均不阻塞接口）：
 * 1. 启动 2 秒后预抓一次；
 * 2. 每 30 分钟自检，缓存超过 3 小时则后台补抓；
 * 3. 每日 08:00 定时全量刷新（对应页面「每日 08:00 自动更新」承诺）。
 */
export function initAiNewsFetcher(): void {
  if (inited) return;
  inited = true;
  setTimeout(() => {
    void refreshLiveAiNews(false).catch(() => undefined);
  }, 2000);
  setInterval(() => {
    if (isStale()) void refreshLiveAiNews(false).catch(() => undefined);
  }, 30 * 60 * 1000);
  setInterval(() => {
    const now = new Date();
    const day = now.toDateString();
    if (now.getHours() === DAILY_REFRESH_HOUR && now.getMinutes() === DAILY_REFRESH_MINUTE && lastDailyRefreshDay !== day) {
      lastDailyRefreshDay = day;
      console.log("[ai-news] daily scheduled refresh at 08:00");
      void refreshLiveAiNews(true).catch(() => undefined);
    }
  }, 60 * 1000);
}

export async function refreshLiveAiNews(force: boolean): Promise<LiveAiNews | null> {
  if (!force && !isStale()) return liveCache;
  if (inflight) return inflight;
  inflight = doRefresh().finally(() => { inflight = null; });
  return inflight;
}

async function doRefresh(): Promise<LiveAiNews | null> {
  const entries = await fetchAllSources();
  if (entries.length === 0) {
    console.warn("[ai-news] all RSS sources failed, keep previous cache/seed");
    return null;
  }
  const enriched = await enrichWithLlm(entries.slice(0, LLM_MAX_ITEMS));
  const items = enriched.map((entry, index) => toAiNewsItem(entry, index));
  liveCache = { fetchedAt: Date.now(), items };
  console.log(`[ai-news] refreshed ${items.length} live items from ${RSS_SOURCES.length} sources`);
  return liveCache;
}

async function fetchAllSources(): Promise<RawEntry[]> {
  const results = await Promise.allSettled(RSS_SOURCES.map(fetchRss));
  const entries: RawEntry[] = [];
  const seenTitles = new Set<string>();
  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    for (const entry of result.value) {
      const key = entry.title.replace(/\s+/g, "").toLowerCase();
      if (seenTitles.has(key)) continue;
      seenTitles.add(key);
      entries.push(entry);
    }
  }
  entries.sort((a, b) => (b.pubDate?.getTime() ?? 0) - (a.pubDate?.getTime() ?? 0));
  return entries;
}

async function fetchRss(source: RssSource): Promise<RawEntry[]> {
  try {
    const response = await fetch(source.url, {
      headers: { "User-Agent": "Mozilla/5.0 (SitongOs AiNewsFetcher)", Accept: "application/rss+xml, application/xml, text/xml, */*" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const xml = await response.text();
    return parseRss(xml, source).slice(0, 12);
  } catch (error) {
    console.warn(`[ai-news] rss failed: ${source.name}`, error instanceof Error ? error.message : String(error));
    return [];
  }
}

function parseRss(xml: string, source: RssSource): RawEntry[] {
  const entries: RawEntry[] = [];
  const itemPattern = /<(?:item|entry)[\s>]([\s\S]*?)<\/(?:item|entry)>/g;
  let match: RegExpExecArray | null;
  while ((match = itemPattern.exec(xml)) !== null && entries.length < 12) {
    const block = match[1];
    const title = decodeXml(extractTag(block, "title")).trim();
    if (!title) continue;
    let link = decodeXml(extractTag(block, "link")).trim();
    const altLink = block.match(/<link[^>]*href="([^"]+)"/);
    if (!link && altLink) link = altLink[1].trim();
    const dateText = extractTag(block, "pubDate") || extractTag(block, "updated") || extractTag(block, "published");
    const pubDate = dateText ? new Date(decodeXml(dateText).trim()) : null;
    const description = stripHtml(decodeXml(extractTag(block, "description") || extractTag(block, "summary") || extractTag(block, "content"))).slice(0, 200);
    entries.push({ source, title, link, pubDate: Number.isNaN(pubDate?.getTime() ?? NaN) ? null : pubDate, description });
  }
  return entries;
}

function extractTag(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  if (!m) return "";
  return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}

function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"")
    .replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
}

function stripHtml(text: string): string {
  return text.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

function relativeTime(date: Date | null): string {
  if (!date) return "今天";
  const diffMs = Date.now() - date.getTime();
  const hours = Math.floor(diffMs / 3600000);
  if (hours < 1) return "刚刚";
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "昨天";
  if (days <= 30) return `${days} 天前`;
  return `${Math.floor(days / 30)} 个月前`;
}

function toAiNewsItem(entry: RawEntry & EnrichField, index: number): AiNewsItem {
  const id = `live-${hash(entry.link || entry.title)}`;
  return {
    id,
    type: entry.type === "case" ? "case" : "ind",
    cat: entry.cat || "行业动态",
    color: entry.source.color,
    src: entry.source.name,
    time: relativeTime(entry.pubDate),
    title: entry.title,
    summary: entry.summary || entry.description || "AI 摘要生成中，可点开原文了解详情。",
    tags: (entry.tags ?? []).slice(0, 3),
    tagColor: "purple",
    insight: entry.insight || "思潼解读正在生成，稍后点「AI 解读」刷新即可。",
    cta: "去商城 · 认领 AI 员工",
    ctaHref: "/agents",
    hot: index === 0
  };
}

interface EnrichField {
  type?: string;
  cat?: string;
  summary?: string;
  tags?: string[];
  insight?: string;
}

/** 大模型批量解读：一次调用处理全部条目，返回按序号对齐的补充字段。 */
async function enrichWithLlm(entries: Array<RawEntry & Partial<EnrichField>>): Promise<Array<RawEntry & EnrichField>> {
  const listing = entries
    .map((e, i) => `【${i}】(${e.source.name}) ${e.title}\n内容摘录：${e.description.slice(0, 160) || "（无摘录）"}`)
    .join("\n\n");
  const messages: LlmMessage[] = [
    {
      role: "system",
      content: [
        "你是「思潼」，思潼AI商城的编辑，为中小企业老板整理 AI 资讯。",
        "硬性规则：只基于给定素材，不编造数据和案例；句子短、口语化；不出现「赋能」「抓手」。",
        "只输出 JSON，不要多余文字，结构：",
        `{"items":[{"i":序号,"type":"ind或case","cat":"分类","summary":"摘要","tags":["标签1","标签2","标签3"],"insight":"解读"}]}`,
        "type：企业落地案例=case，其余=ind；cat 从【零售电商/餐饮连锁/美业/制造/出行酒旅/行业动态】里选最贴的一个；",
        "summary ≤60 字；tags 每个 ≤8 字；insight ≤80 字，视角=对中小企业意味着什么 + 一句可执行建议。"
      ].join("\n")
    },
    { role: "user", content: listing }
  ];
  try {
    const provider = createRuntimeLlmProvider();
    const text = await provider.complete(messages, {
      reasoningProfile: "standard",
      thinkingMode: "disabled",
      maxTokens: 3000
    });
    const data = extractJson(text) as { items?: Array<{ i?: number; type?: string; cat?: string; summary?: string; tags?: string[]; insight?: string }> } | null;
    const list = Array.isArray(data?.items) ? data!.items : [];
    for (const row of list) {
      if (typeof row.i !== "number" || !entries[row.i]) continue;
      const target = entries[row.i] as RawEntry & EnrichField;
      target.type = row.type === "case" ? "case" : "ind";
      target.cat = typeof row.cat === "string" ? row.cat : "行业动态";
      target.summary = typeof row.summary === "string" ? row.summary : undefined;
      target.tags = Array.isArray(row.tags) ? row.tags.filter((t): t is string => typeof t === "string") : undefined;
      target.insight = typeof row.insight === "string" ? row.insight : undefined;
    }
  } catch (error) {
    console.warn("[ai-news] llm enrich failed, keep raw titles", error instanceof Error ? error.message : String(error));
  }
  return entries as Array<RawEntry & EnrichField>;
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fenced ? fenced[1] : text).trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

function hash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) {
    h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

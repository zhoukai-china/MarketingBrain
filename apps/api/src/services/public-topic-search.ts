import { domesticNetworkOnly, domesticOutboundAllowlist } from "../config/env.js";
import { validateOutboundUrl } from "./outbound-policy.js";

function isAllowedUrl(url: string): boolean {
  if (!domesticNetworkOnly) return true;
  const hosts = domesticOutboundAllowlist;
  const issues = validateOutboundUrl("public-topic-search", url, { domesticNetworkOnly: true, allowedHosts: hosts });
  return issues.length === 0;
}

export interface PublicTopicSearch {
  hot: { fetched: boolean; items: string[]; note: string };
  bench: { fetched: boolean; items: string[]; note: string };
}

const SEARCH_URLS = {
  sogou: (keyword: string) => `https://weixin.sogou.com/weixin?type=2&query=${encodeURIComponent(keyword)}`,
  channels: (keyword: string) => `https://channels.weixin.qq.com/platform/search?keyword=${encodeURIComponent(keyword)}`,
  douyin: (keyword: string) => `https://www.douyin.com/search/${encodeURIComponent(keyword)}`
};

interface FetchedTitle { title: string; /** 发布时间（unix 秒，来自搜狗 timeConvert）；取不到为 null。 */ ts: number | null }

/**
 * 抓搜狗微信搜索结果标题 + 每条的发布时间戳。
 * 搜狗默认按「相关性」排序，老文章（关键词匹配强）会排最前（2026-10-01 用户实测：
 * 「AI行业 热点」第 1 条是 2023 年 12 月发布的《预测2024年AI行业热点》）——所以必须
 * 解析 timeConvert 时间戳，由调用方按时间降序/过滤。
 * 注：搜狗 tsn 时间窗参数有反爬（302 跳回首页），服务端不可用，只能拿回页面自己过滤。
 */
async function fetchTitlesWithTime(url: string): Promise<FetchedTitle[]> {
  if (!isAllowedUrl(url)) return [];
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
        "Accept-Language": "zh-CN,zh;q=0.9"
      }
    });
    clearTimeout(timer);
    if (!res.ok) return [];
    const html = await res.text();
    // 收集 h3（标题）与 timeConvert（发布时间）两类标记的绝对位置，标题配对它后面最近的那个时间戳
    const marks: Array<{ pos: number; kind: "title" | "time"; value: string }> = [];
    const h3re = /<h3>\s*<a[^>]*>([\s\S]*?)<\/a>/g;
    let m: RegExpExecArray | null;
    while ((m = h3re.exec(html)) !== null) {
      const text = m[1].replace(/<[^>]+>/g, "").replace(/&[a-z#0-9]+;/g, " ").replace(/\s+/g, " ").trim();
      if (text.length >= 6) marks.push({ pos: m.index, kind: "title", value: text });
    }
    const tsre = /timeConvert\('(\d+)'\)/g;
    while ((m = tsre.exec(html)) !== null) marks.push({ pos: m.index, kind: "time", value: m[1] });
    marks.sort((a, b) => a.pos - b.pos);
    const out: FetchedTitle[] = [];
    let pendingTs: number | null = null;
    for (const mark of marks) {
      if (mark.kind === "time") { pendingTs = Number(mark.value) || null; continue; }
      out.push({ title: mark.value, ts: pendingTs });
      pendingTs = null;
      if (out.length >= 20) break;
    }
    // 按发布时间降序（取不到时间的排最后），同题去重
    const seen = new Set<string>();
    return out
      .sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0))
      .filter((it) => { if (seen.has(it.title)) return false; seen.add(it.title); return true; });
  } catch {
    return [];
  }
}

async function fetchTitles(url: string): Promise<string[]> {
  return (await fetchTitlesWithTime(url)).map((it) => it.title);
}

function extractUrl(text: string): string[] {
  const re = /https?:\/\/[^\s,，、]+/g;
  return (text.match(re) ?? []).slice(0, 3);
}

async function fetchPageTitles(url: string): Promise<string[]> {
  if (!isAllowedUrl(url)) return [];
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
        "Accept-Language": "zh-CN,zh;q=0.9"
      }
    });
    clearTimeout(timer);
    if (!res.ok) return [];
    const html = await res.text();
    const titles: string[] = [];
    const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
    if (og?.[1]) titles.push(og[1].trim());
    const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (title?.[1]) titles.push(title[1].replace(/<[^>]+>/g, "").trim());
    const re = /aria-label="([^"]{4,80})"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      if (!/播放|赞|评论|分享|举报|关注/i.test(m[1])) titles.push(m[1]);
      if (titles.length >= 30) break;
    }
    return Array.from(new Set(titles.map((t) => t.replace(/\s+/g, " ").trim()).filter((t) => t.length >= 4)));
  } catch {
    return [];
  }
}

export async function searchPublicTopicSources(industry: string, benchmarkText: string): Promise<PublicTopicSearch> {
  const hotUrl = SEARCH_URLS.sogou(`${industry} 热点`);
  const hotAll = await fetchTitlesWithTime(hotUrl);
  // 热点只要新鲜的：过滤掉 90 天前的旧文（2026-10-01 用户：搜出 2024 年的数据不能用）；
  // 太少（行业冷门）则回退全量，但仍按新→旧排序，老文章沉底。
  const HOT_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
  const hotFresh = hotAll
    .filter((it) => it.ts != null && Date.now() - it.ts * 1000 <= HOT_MAX_AGE_MS)
    .map((it) => it.title);
  const hot = hotFresh.length >= 3 ? hotFresh : hotAll.map((it) => it.title);
  const hotNoteSuffix = hotFresh.length >= 3 ? "（近 90 天，按时间降序）" : "（带发布时间排序）";
  const benchDedup = new Set<string>();
  const urls = extractUrl(benchmarkText);
  for (const url of urls) {
    const items = await fetchPageTitles(url);
    items.forEach((it) => benchDedup.add(it));
  }
  const benchKeywords = benchmarkText.replace(/https?:\/\/\S+/g, "").replace(/[\u4e00-\u9fa5]{0,2}账号[：:为叫\s]*/g, "").split(/[,，、\s]+/).filter((s) => s.length >= 2).slice(0, 3);
  for (const kw of benchKeywords) {
    const items = await fetchTitles(SEARCH_URLS.sogou(kw));
    items.forEach((it) => benchDedup.add(it));
  }
  return {
    hot: {
      fetched: hot.length > 0,
      items: hot,
      note: hot.length > 0 ? `已检索 ${hot.length} 条热点${hotNoteSuffix}` : "检索未取到（公开页可能需登录/反爬），按未提供处理"
    },
    bench: {
      fetched: benchDedup.size > 0,
      items: Array.from(benchDedup),
      note: benchDedup.size > 0 ? `已检索 ${benchDedup.size} 条同行相关内容` : "未提供对标账号/链接或未取到公开内容（可能需登录/反爬）"
    }
  };
}

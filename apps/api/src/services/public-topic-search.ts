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

async function fetchTitles(url: string): Promise<string[]> {
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
    const re = /<h3>\s*<a[^>]*>([\s\S]*?)<\/a>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      const text = m[1].replace(/<[^>]+>/g, "").replace(/&[a-z#0-9]+;/g, " ").replace(/\s+/g, " ").trim();
      if (text.length >= 6) titles.push(text);
      if (titles.length >= 20) break;
    }
    return Array.from(new Set(titles));
  } catch {
    return [];
  }
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
  const hot = await fetchTitles(hotUrl);
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
      note: hot.length > 0 ? `已检索 ${hot.length} 条热点` : "检索未取到（公开页可能需登录/反爬），按未提供处理"
    },
    bench: {
      fetched: benchDedup.size > 0,
      items: Array.from(benchDedup),
      note: benchDedup.size > 0 ? `已检索 ${benchDedup.size} 条同行相关内容` : "未提供对标账号/链接或未取到公开内容（可能需登录/反爬）"
    }
  };
}

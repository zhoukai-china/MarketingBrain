import { domesticNetworkOnly, domesticOutboundAllowlist } from "../config/env.js";
import { validateOutboundUrl } from "./outbound-policy.js";
import { createLanqiTaskLlmProvider } from "./llm-provider-factory.js";
import type { LlmMessage } from "@baolu/agent";

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

interface FetchedTitle { title: string; /** 发布时间（unix 秒，来自搜狗 timeConvert）；取不到为 null。 */ ts: number | null; /** 结果页自带的摘要片段（txt-info），提炼具体话题用。 */ snippet: string; /** 发布公众号名（all-time-y2），可辅助模型判断来源。 */ account: string }

/**
 * 抓搜狗微信搜索结果标题 + 每条的发布时间戳。
 * 搜狗默认按「相关性」排序，老文章（关键词匹配强）会排最前（2026-10-01 用户实测：
 * 「AI行业 热点」第 1 条是 2023 年 12 月发布的《预测2024年AI行业热点》）——所以必须
 * 解析 timeConvert 时间戳，由调用方按时间降序/过滤。
 * 注：搜狗 tsn 时间窗参数有反爬（302 跳回首页），服务端不可用，只能拿回页面自己过滤。
 */
async function fetchTitlesWithTime(url: string, pages = 1, minFresh = 0): Promise<FetchedTitle[]> {
  // 2026-10-01（用户）：翻页最多 10 页，防止冷门行业无限翻。
  pages = Math.min(Math.max(1, pages), 10);
  if (!isAllowedUrl(url)) return [];
  try {
    // 搜狗每页固定 10 条；pages>1 时抓前 N 页（2026-10-01 实测 page=2/3 不触发反爬）
    const stripTags = (raw: string) => raw
      .replace(/<script[\s\S]*?<\/script>/g, "")
      .replace(/<[^>]+>/g, "")
      .replace(/&[a-z#0-9]+;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const out: FetchedTitle[] = [];
    for (let page = 1; page <= Math.max(1, pages); page++) {
      const pageUrl = page === 1 ? url : `${url}${url.includes("?") ? "&" : "?"}page=${page}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(pageUrl, {
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
          "Accept-Language": "zh-CN,zh;q=0.9"
        }
      });
      clearTimeout(timer);
      if (!res.ok) continue;
      const html = await res.text();
      const boxre = /<div class="txt-box">([\s\S]*?)(?=<div class="txt-box">|<\/ol>|$)/g;
      let m: RegExpExecArray | null;
      while ((m = boxre.exec(html)) !== null) {
        const block = m[1];
        const titleM = /<h3>\s*<a[^>]*>([\s\S]*?)<\/a>/.exec(block);
        if (!titleM) continue;
        const title = stripTags(titleM[1]);
        if (title.length < 6) continue;
        const infoM = /<p class="txt-info"[^>]*>([\s\S]*?)<\/p>/.exec(block);
        const tsM = /timeConvert\('(\d+)'\)/.exec(block);
        const accM = /class="all-time-y2">([^<]+)</.exec(block);
        out.push({
          title,
          snippet: infoM ? stripTags(infoM[1]).slice(0, 200) : "",
          ts: tsM ? Number(tsM[1]) || null : null,
          account: accM ? stripTags(accM[1]) : ""
        });
        if (out.length >= 20) break;
      }
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

/**
 * 把搜到的文章「标题+摘要+日期」提炼成**具体的热点话题**清单。
 * 用户 2026-10-01：《AI 热点日报 2026-09-30》这种栏目壳标题没有选题价值，
 * 有价值的是壳里的事件（小米 Mimo 开源登顶、Anthropic 招股书…）。
 * flash 档一次调用；失败返回 null（回退原标题列表，流程不卡）。
 */
async function consolidateHotTopics(industry: string, pool: FetchedTitle[]): Promise<string[] | null> {
  if (pool.length === 0) return null;
  const provider = createLanqiTaskLlmProvider("low_risk_formatting");
  if (!provider.isConfigured()) return null;
  const lines = pool
    .slice(0, 12)
    .map((it, i) => {
      const date = it.ts ? new Date(it.ts * 1000).toISOString().slice(0, 10) : "日期不详";
      return `${i + 1}. [${date}${it.account ? ` · ${it.account}` : ""}] ${it.title}${it.snippet ? `｜摘要：${it.snippet}` : ""}`;
    })
    .join("\n");
  const system = [
    `你是「${industry}」行业的内容选题助手。下面是从微信文章检索到的结果（标题+摘要+日期），`,
    "其中很多是《XX日报》《XX简报》《XX盘点》这类**栏目壳**——真正的热点是壳里提到的一个个具体事件。",
    "任务：提炼出**具体的热点话题**清单，每条是一个具体的事件 / 发布 / 动态 / 数据点，",
    "例如「小米开源 Mimo 模型登顶热榜」「Anthropic 招股书显示高增长」——禁止输出《日报》《简报》《盘点》《周报》这类栏目名本身。",
    "每条 ≤40 字；**输出 10 条**（材料实在不足才允许 8 条，并在最后一条标注「（素材有限）」）；只基于给定材料，不编造；输出 JSON {\"topics\":[\"...\"]}，不要其它文字。"
  ].join("\n");
  try {
    const raw = await provider.complete(
      [
        { role: "system", content: system },
        { role: "user", content: `行业：${industry}\n\n检索结果：\n${lines}` }
      ] as LlmMessage[],
      { maxTokens: 1000, reasoningProfile: "standard", thinkingMode: "disabled" }
    );
    const jsonText = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
    const parsed = JSON.parse(jsonText) as { topics?: unknown };
    if (!Array.isArray(parsed.topics)) return null;
    const topics = parsed.topics
      .filter((t): t is string => typeof t === "string" && t.trim().length >= 4 && t.trim().length <= 60)
      .slice(0, 12);
    return topics.length > 0 ? topics : null;
  } catch {
    return null;
  }
}

export async function searchPublicTopicSources(industry: string, benchmarkText: string): Promise<PublicTopicSearch> {
  const hotUrl = SEARCH_URLS.sogou(`${industry} 热点`);
  const hotAll = await fetchTitlesWithTime(hotUrl, 10, 15);
  // 热点只要新鲜的：过滤掉 90 天前的旧文（2026-10-01 用户：搜出 2024 年的数据不能用）；
  // 太少（行业冷门）则回退全量，但仍按新→旧排序，老文章沉底。
  const HOT_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
  const hotFresh = hotAll
    .filter((it) => it.ts != null && Date.now() - it.ts * 1000 <= HOT_MAX_AGE_MS);
  const hotPool = hotFresh.length >= 3 ? hotFresh : hotAll;

  // 2026-10-01（用户）：日报/简报/盘点这类**栏目壳标题**对选题没用——真正的热点是壳里的
  // 具体事件。搜狗结果页自带每篇的摘要（txt-info），把「标题+摘要+日期」交给 flash 模型
  // 提炼成具体话题清单（如「小米开源 Mimo 模型登顶热榜」），栏目壳不作为条目输出。
  const topics = await consolidateHotTopics(industry, hotPool);
  const hot = topics ?? hotPool.map((it) => it.title);
  const hotNoteSuffix = topics
    ? "（已从检索结果提炼为具体话题）"
    : hotFresh.length >= 3 ? "（近 90 天，按时间降序）" : "（带发布时间排序）";
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

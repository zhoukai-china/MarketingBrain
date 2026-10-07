import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type { LlmMessage } from "@baolu/agent";
import { env } from "../config/env.js";
import { createRuntimeLlmProvider } from "../services/llm-provider-factory.js";
import { getLiveAiNews, initAiNewsFetcher, refreshLiveAiNews, type LiveAiNews } from "../services/ai-news-fetcher.js";
import {
  AI_NEWS,
  AI_NEWS_HERO_SEED,
  findAiNewsItem,
  type AiNewsHero,
  type AiNewsItem
} from "../services/ai-news-data.js";

/**
 * AI 资讯页接口（前端路由 /agents/ai-news，原型 docs/prototypes/ai-news-demo-20261006.html）。
 *
 * 内容策略（与页面声明一致）：资讯素材来自编辑整理的种子数据（人工审核上架），
 * 大模型负责生成/刷新「思潼解读」与「问思潼」问答；LLM 不可用时回退到
 * 编辑审校稿，页面不因模型故障而不可用。
 *
 * 本页为公开页面（无需登录），LLM 生成接口共用一个进程内每日调用上限
 * （env.AI_NEWS_DAILY_LLM_LIMIT）做成本兜底。
 */

const INTERPRET_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const HERO_CACHE_TTL_MS = 12 * 60 * 60 * 1000;

const interpretCache = new Map<string, { text: string; at: number }>();
let heroCache: { at: number; value: AiNewsHero } | null = null;
let dailyLlmUsage = { day: "", count: 0 };

const listQuerySchema = z.object({
  type: z.enum(["all", "case", "ind"]).default("all"),
  cat: z.string().trim().max(20).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  offset: z.coerce.number().int().min(0).default(0)
});

const askBodySchema = z.object({
  question: z.string().trim().min(2).max(300)
});

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/** 公开页 LLM 成本兜底：当日调用计数，超限返回 429。 */
function consumeDailyLlmQuota(reply: FastifyReply): boolean {
  const day = todayKey();
  if (dailyLlmUsage.day !== day) {
    dailyLlmUsage = { day, count: 0 };
  }
  if (env.AI_NEWS_DAILY_LLM_LIMIT > 0 && dailyLlmUsage.count >= env.AI_NEWS_DAILY_LLM_LIMIT) {
    reply.code(429).send({
      error: "ai_news_daily_limit_reached",
      message: "今天的 AI 解读体验额度已用完，明天 08:00 资讯更新后再来吧。"
    });
    return false;
  }
  dailyLlmUsage.count += 1;
  return true;
}

async function callLlm(messages: LlmMessage[], maxTokens: number): Promise<string> {
  const provider = createRuntimeLlmProvider();
  // 未配置时不在此处拦截：LLM_MOCK_MODE 下 complete() 内建 demo 兜底；
  // 真实未配置时 complete() 抛 `${name}_provider_not_configured`，由调用方统一回退。
  return provider.complete(messages, {
    reasoningProfile: "standard",
    thinkingMode: "disabled",
    maxTokens
  });
}

const SITONG_VOICE_RULES = [
  "你是「思潼」，思潼AI商城的编辑。为中小企业老板写 AI 资讯解读。",
  "硬性规则：",
  "1. 只基于提供的资讯素材写，不编造数据、案例、政策结论和效果承诺；素材里没有的数字一律不写。",
  "2. 视角务实、算账导向：对中小企业意味着什么、先从哪个环节切入、怎么算 ROI。",
  "3. 口语化中文，句子短，不堆形容词，不出现「赋能」「抓手」等空话。",
  "4. 不做医疗诊断、不承诺疗效、不虚构顾客案例。"
].join("\n");

function newsMaterial(item: AiNewsItem): string {
  return [
    `标题：${item.title}`,
    `分类：${item.cat}`,
    `摘要：${item.summary}`,
    `标签：${item.tags.join("、")}`,
    `编辑参考解读：${item.insight}`
  ].join("\n");
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

function heroFromLlmText(text: string): AiNewsHero | null {
  const data = extractJson(text) as Partial<Record<keyof AiNewsHero, unknown>> | null;
  if (!data) return null;
  const title = typeof data.title === "string" ? data.title.trim() : "";
  const summary = typeof data.summary === "string" ? data.summary.trim() : "";
  const meaning = typeof data.meaning === "string" ? data.meaning.trim() : "";
  if (!title || !summary || !meaning) return null;
  return { title, summary, meaning };
}

function formatClock(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

async function buildHeroMaterial(): Promise<string> {
  const live = getLiveAiNews();
  if (live && live.items.length > 0) {
    return live.items.slice(0, 5)
      .map((item, index) => `【${index + 1}】(${item.src}) ${item.title}\n摘要：${item.summary}`)
      .join("\n\n");
  }
  const picks = AI_NEWS.filter((item) => item.hot || item.time === "昨天").slice(0, 5);
  const pool = picks.length > 0 ? picks : AI_NEWS.slice(0, 5);
  return pool.map((item, index) => `【${index + 1}】${newsMaterial(item)}`).join("\n\n");
}

export async function registerAiNewsRoutes(app: FastifyInstance): Promise<void> {
  // 服务启动后后台预抓一次真实资讯（RSS + LLM 解读），不阻塞启动。
  initAiNewsFetcher();

  /** 资讯池：优先真实抓取，回退种子数据。 */
  function newsPool(): { source: "live" | "seed"; updatedAt: string; items: AiNewsItem[] } {
    const live = getLiveAiNews();
    if (live) {
      return { source: "live", updatedAt: `今日 ${formatClock(live.fetchedAt)} 实时抓取`, items: live.items };
    }
    return { source: "seed", updatedAt: "今日 08:00 更新", items: AI_NEWS };
  }

  /** 按 id 找资讯（真实抓取池 + 种子池都查）。 */
  function resolveItem(id: string): AiNewsItem | undefined {
    return getLiveAiNews()?.items.find((item) => item.id === id) ?? findAiNewsItem(id);
  }

  /** 资讯列表：类型/分类过滤 + 分页（前端「加载更多」按 limit 递增加量拉取）。 */
  app.get("/ai-news", async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request" });
    }
    const { type, cat, limit, offset } = parsed.data;
    const pool = newsPool();
    const filtered = pool.items.filter((item) => {
      if (type !== "all" && item.type !== type) return false;
      if (cat && item.cat !== cat) return false;
      return true;
    });
    return {
      source: pool.source,
      updatedAt: pool.updatedAt,
      total: filtered.length,
      offset,
      items: filtered.slice(offset, offset + limit)
    };
  });

  /** 手动刷新真实抓取（RSS + 大模型批量解读，消耗 1 次当日 LLM 配额）。 */
  app.post("/ai-news/refresh", async (request, reply) => {
    if (!consumeDailyLlmQuota(reply)) return;
    const live: LiveAiNews | null = await refreshLiveAiNews(true);
    if (!live || live.items.length === 0) {
      return reply.code(503).send({
        error: "fetch_failed",
        message: "抓取源暂时不可用，正在继续使用上一批资讯。"
      });
    }
    return { source: "live", count: live.items.length, items: live.items };
  });

  /** 置顶「思潼解读」：优先返回当日缓存；refresh=1 用大模型重写一份。 */
  app.get("/ai-news/hero", async (request, reply) => {
    const query = (request.query ?? {}) as { refresh?: string };
    const wantsRefresh = query.refresh === "1";
    if (!wantsRefresh && heroCache && Date.now() - heroCache.at < HERO_CACHE_TTL_MS) {
      return { source: "cache", hero: heroCache.value };
    }
    if (wantsRefresh) {
      if (!consumeDailyLlmQuota(reply)) return;
      try {
        const material = await buildHeroMaterial();
        const text = await callLlm([
          { role: "system", content: SITONG_VOICE_RULES },
          {
            role: "user",
            content: [
              "以下是今天要闻素材。请输出置顶解读，只输出 JSON，不要多余文字，字段：",
              `title（主标题，18 字内，点出对中小企业最关键的变化）、`,
              `summary（120 字内：只概括素材里的事实，不加新数字）、`,
              `meaning（90 字内：💡 对企业意味着什么，给一句可执行的切入建议）。`,
              "",
              material
            ].join("\n")
          }
        ], 900);
        const hero = heroFromLlmText(text);
        if (hero) {
          heroCache = { at: Date.now(), value: hero };
          return { source: "llm", hero };
        }
      } catch (error) {
        request.log.warn({ event: "ai_news_hero_llm_failed", message: error instanceof Error ? error.message : String(error) });
      }
    }
    if (heroCache && Date.now() - heroCache.at < HERO_CACHE_TTL_MS) {
      return { source: "cache", hero: heroCache.value };
    }
    // LLM 失败/未配置：回退编辑审校稿，页面始终可用。
    return { source: "editor", hero: AI_NEWS_HERO_SEED };
  });

  /** 单条「思潼解读」：大模型现场解读（带当日缓存）。 */
  app.post("/ai-news/:id/interpret", async (request, reply) => {
    const params = (request.params ?? {}) as { id?: string };
    const item = params.id ? resolveItem(params.id) : undefined;
    if (!item) {
      return reply.code(404).send({ error: "news_not_found" });
    }
    const cached = interpretCache.get(item.id);
    if (cached && Date.now() - cached.at < INTERPRET_CACHE_TTL_MS) {
      return { interpretation: cached.text, cached: true };
    }
    if (!consumeDailyLlmQuota(reply)) return;
    try {
      const text = await callLlm([
        { role: "system", content: SITONG_VOICE_RULES },
        {
          role: "user",
          content: [
            "请为下面这条资讯写「思潼解读」，3 句以内，第一句给判断，最后一句给中小企业一句可执行建议。直接输出解读正文，不要标题和前缀。",
            "",
            newsMaterial(item)
          ].join("\n")
        }
      ], 500);
      const interpretation = text.trim();
      interpretCache.set(item.id, { text: interpretation, at: Date.now() });
      return { interpretation, cached: false };
    } catch (error) {
      request.log.warn({ event: "ai_news_interpret_llm_failed", id: item.id, message: error instanceof Error ? error.message : String(error) });
      return reply.code(503).send({
        error: "llm_unavailable",
        message: "AI 解读暂时不可用，先看编辑解读，稍后再试。"
      });
    }
  });

  /** 「问思潼」：针对单条资讯的公开问答（带资讯原文作上下文）。 */
  app.post("/ai-news/:id/ask", async (request, reply) => {
    const params = (request.params ?? {}) as { id?: string };
    const item = params.id ? resolveItem(params.id) : undefined;
    if (!item) {
      return reply.code(404).send({ error: "news_not_found" });
    }
    const parsedBody = askBodySchema.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      return reply.code(400).send({
        error: "invalid_request",
        message: "问题请写在 2–300 字之间。"
      });
    }
    if (!consumeDailyLlmQuota(reply)) return;
    try {
      const answer = await callLlm([
        { role: "system", content: SITONG_VOICE_RULES },
        {
          role: "user",
          content: [
            "一位老板正在看这条资讯并向你提问。回答 200 字以内，只基于资讯素材与你的通识判断；",
            "素材没有的数字不编造；涉及具体决策时，提醒对方结合自身情况先小步验证。",
            "",
            newsMaterial(item),
            "",
            `老板的问题：${parsedBody.data.question}`
          ].join("\n")
        }
      ], 700);
      return { answer: answer.trim() };
    } catch (error) {
      request.log.warn({ event: "ai_news_ask_llm_failed", id: item.id, message: error instanceof Error ? error.message : String(error) });
      return reply.code(503).send({
        error: "llm_unavailable",
        message: "思潼暂时离线，稍后再问一次。"
      });
    }
  });
}

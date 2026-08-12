import type { FastifyInstance } from "fastify";
import { prisma } from "@baolu/db";
import { z } from "zod";
import { domesticNetworkOnly, domesticOutboundAllowlist, env } from "../config/env.js";
import { assertOutboundUrlAllowed, parseAllowedHosts } from "../services/outbound-policy.js";
import { resolveRequestContext } from "../services/request-context.js";

interface ProactiveFeedItem {
  id: string;
  type: "ai_daily" | "audio_card_recap" | "business_advice" | "followup";
  title: string;
  content: string;
  skillId: string;
  createdAt: string;
  metadata?: AiDailyMetadata;
}

interface AiNewsItem {
  title: string;
  link: string;
  source: string;
  publishedAt?: string;
}

interface AiDailyMetadata {
  date: string;
  generatedAt: string;
  summary: string;
  fallback: boolean;
  news: Array<AiNewsItem & {
    insight: string;
    action: string;
  }>;
  sitongView: string;
  actions: string[];
}

const dailyNewsCache = new Map<string, { createdAt: number; daily: Pick<ProactiveFeedItem, "content" | "metadata"> }>();

export async function registerProactiveRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { deviceScope?: string } }>("/proactive/feed", async (request, reply) => {
    const query = z.object({ deviceScope: z.enum(["desktop", "mobile"]).default("desktop") }).safeParse(request.query ?? {});
    if (!query.success) return reply.code(400).send({ error: "invalid_request", details: query.error.flatten() });
    const context = await resolveRequestContext(request.headers);
    const now = new Date();
    const items: ProactiveFeedItem[] = [];

    const daily = await buildDailyFeedItem(now);
    if (daily) items.push(daily);

    if (env.DATA_MODE === "demo") {
      items.push({
        id: `demo-business-advice-${now.toISOString().slice(0, 10)}`,
        type: "business_advice",
        title: "今日经营提醒",
        skillId: "general_qa",
        createdAt: now.toISOString(),
        content:
          "我先给你一条经营提醒：今天不要只看有没有新客，更要看每个咨询有没有被二次跟进。先把昨天问价但没成交的人拉出来，用销售顾问的话术做一次轻量触达。"
      });
      return {
        dataMode: "demo",
        items
      };
    }

    const [audioTasks, latestRuns, recurringReviewTasks] = await Promise.all([
      prisma.automationTask.findMany({
        where: {
          tenantId: context.tenantId,
          type: "audio_card_analysis",
          status: "analyzed"
        },
        orderBy: {
          updatedAt: "desc"
        },
        take: 3
      }),
      prisma.agentRun.findMany({
        where: {
          tenantId: context.tenantId,
          status: "succeeded",
          deviceScope: query.data.deviceScope
        },
        orderBy: {
          createdAt: "desc"
        },
        take: 5
      }),
      prisma.automationTask.findMany({
        where: {
          tenantId: context.tenantId,
          type: "daily_business_advice",
          runAt: {
            lte: now
          },
          status: {
            in: ["draft", "pending", "scheduled"]
          }
        },
        orderBy: {
          runAt: "asc"
        },
        take: 3
      })
    ]);

    for (const task of audioTasks) {
      const content = extractAudioAnalysis(task.payload);
      if (!content) continue;
      items.push({
        id: `audio-card-${task.id}`,
        type: "audio_card_recap",
        title: "录音卡经营复盘",
        skillId: "general_qa",
        createdAt: task.updatedAt.toISOString(),
        content: `我看了最近一条录音卡，已经整理成经营复盘。\n\n${content}`
      });
    }

    const latestAction = latestRuns.find((run: any) => run.output && /明天|今天|动作|建议|跟进/.test(run.output));
    if (latestAction?.output) {
      items.push({
        id: `latest-action-${latestAction.id}`,
        type: "business_advice",
        title: "继续执行提醒",
        skillId: latestAction.skillId,
        createdAt: latestAction.createdAt.toISOString(),
        content: buildFollowupFromLatestRun(latestAction.output)
      });
    }

    for (const task of recurringReviewTasks) {
      const payload = getPayloadRecord(task.payload);
      if (payload.kind !== "recurring_business_review") continue;
      const intervalMinutes = readPayloadNumber(payload, "intervalMinutes", 90);
      items.push({
        id: `recurring-business-review-${task.id}-${task.runAt.toISOString()}`,
        type: "business_advice",
        title: "自动经营复盘",
        skillId: "general_qa",
        createdAt: now.toISOString(),
        content: buildRecurringBusinessReview(payload, latestRuns, audioTasks)
      });
      await prisma.automationTask.update({
        where: {
          id: task.id
        },
        data: {
          runAt: new Date(now.getTime() + intervalMinutes * 60 * 1000),
          logs: {
            create: {
              message: "已生成一次自动经营复盘，并按用户设置间隔重新调度",
              metadata: {
                intervalMinutes,
                source: "proactive_feed"
              }
            }
          }
        }
      });
    }

    return {
      dataMode: "database",
      items: dedupeFeedItems(items).slice(0, 6)
    };
  });
}

async function buildDailyFeedItem(now: Date): Promise<ProactiveFeedItem | null> {
  const beijing = getBeijingClock(now);
  if (beijing.hour < 9) return null;
  return {
    id: `ai-daily-${beijing.date}`,
    type: "ai_daily",
    title: "今日AI日报",
    skillId: "ai_daily_brief",
    createdAt: now.toISOString(),
    ...(await buildDailyNewsContent(beijing.date, now))
  };
}

async function buildDailyNewsContent(beijingDate: string, now: Date): Promise<Pick<ProactiveFeedItem, "content" | "metadata">> {
  const cached = dailyNewsCache.get(beijingDate);
  if (cached && Date.now() - cached.createdAt < 6 * 60 * 60 * 1000) return cached.daily;

  const news = await fetchAiNewsItems();
  const daily = formatDailyNewsContent(beijingDate, now, news);
  dailyNewsCache.set(beijingDate, { createdAt: Date.now(), daily });
  return daily;
}

async function fetchAiNewsItems(): Promise<AiNewsItem[]> {
  const sources = parseAllowedHosts(env.AI_DAILY_NEWS_SOURCES).filter((source) => source.startsWith("http"));
  const results = await Promise.allSettled(sources.map((source) => fetchNewsSource(source)));
  const items = results.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
  const seen = new Set<string>();
  return items
    .filter((item) => {
      const key = `${item.title}|${item.link}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return /AI|人工智能|大模型|智能体|Agent|机器人|生成式|算力|模型|企业|应用/i.test(item.title);
    })
    .sort((a, b) => Date.parse(b.publishedAt ?? "") - Date.parse(a.publishedAt ?? ""))
    .slice(0, 5);
}

async function fetchNewsSource(sourceUrl: string): Promise<AiNewsItem[]> {
  assertOutboundUrlAllowed("AI daily news", sourceUrl, {
    domesticNetworkOnly,
    allowedHosts: domesticOutboundAllowlist
  });
  const response = await fetch(sourceUrl, {
    headers: {
      accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
      "user-agent": "SitongStoreGrowthOS/2.0"
    },
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) return [];
  const xml = await response.text();
  return parseFeedItems(xml, sourceUrl);
}

function parseFeedItems(xml: string, sourceUrl: string): AiNewsItem[] {
  const source = getSourceName(sourceUrl);
  const itemBlocks = [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)].map((match) => match[0]);
  const entryBlocks = itemBlocks.length ? [] : [...xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)].map((match) => match[0]);
  const feedItems = [...itemBlocks, ...entryBlocks]
    .map((block) => ({
      title: cleanXmlText(readXmlTag(block, "title")),
      link: cleanXmlText(readXmlTag(block, "link")) || readAtomLink(block) || sourceUrl,
      source,
      publishedAt:
        cleanXmlText(readXmlTag(block, "pubDate")) ||
        cleanXmlText(readXmlTag(block, "published")) ||
        cleanXmlText(readXmlTag(block, "updated"))
    }))
    .filter((item) => item.title)
    .slice(0, 12);
  return feedItems.length > 0 ? feedItems : parseHtmlHeadlines(xml, sourceUrl, source);
}

function readXmlTag(block: string, tag: string): string {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match?.[1] ?? "";
}

function readAtomLink(block: string): string {
  const match = block.match(/<link[^>]+href=["']([^"']+)["']/i);
  return match?.[1] ?? "";
}

function cleanXmlText(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function parseHtmlHeadlines(html: string, sourceUrl: string, source: string): AiNewsItem[] {
  const candidates: AiNewsItem[] = [];
  const anchorMatches = html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi);
  for (const match of anchorMatches) {
    const attrs = match[1] ?? "";
    const title = cleanXmlText(match[2] ?? "");
    if (!isUsefulHeadline(title)) continue;
    const href = readHtmlAttr(attrs, "href");
    candidates.push({
      title,
      link: resolveLink(sourceUrl, href),
      source
    });
  }
  const headingMatches = html.matchAll(/<h[1-4]\b[^>]*>([\s\S]*?)<\/h[1-4]>/gi);
  for (const match of headingMatches) {
    const title = cleanXmlText(match[1] ?? "");
    if (!isUsefulHeadline(title)) continue;
    candidates.push({
      title,
      link: sourceUrl,
      source
    });
  }
  const seen = new Set<string>();
  return candidates
    .filter((item) => {
      const key = item.title;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 12);
}

function readHtmlAttr(attrs: string, name: string): string {
  const match = attrs.match(new RegExp(`${name}=["']([^"']+)["']`, "i"));
  return match?.[1] ?? "";
}

function resolveLink(sourceUrl: string, href: string): string {
  if (!href) return sourceUrl;
  try {
    return new URL(href, sourceUrl).toString();
  } catch {
    return sourceUrl;
  }
}

function isUsefulHeadline(title: string): boolean {
  return title.length >= 10 && title.length <= 90 && /AI|人工智能|大模型|智能体|Agent|机器人|生成式|算力|模型|企业|应用/i.test(title);
}

function getSourceName(sourceUrl: string): string {
  const hostname = new URL(sourceUrl).hostname;
  if (hostname.includes("jiqizhixin")) return "机器之心";
  if (hostname.includes("qbitai")) return "量子位";
  return hostname.replace(/^www\./, "");
}

function formatDailyNewsContent(beijingDate: string, now: Date, news: AiNewsItem[]): Pick<ProactiveFeedItem, "content" | "metadata"> {
  if (news.length === 0) {
    const fallbackNews = [
      {
        title: "AI正在从单点工具进入企业流程，客服、销售、内容、培训、数据复盘都在被重新拆解",
        link: "",
        source: "思潼趋势观察",
        insight: "老板不用追每个新工具，真正要做的是把高频经营动作固定进系统。",
        action: "今天先选一个高频动作交给思潼，例如朋友圈选题、问价跟进或视频数据复盘。"
      },
      {
        title: "企业不再只问模型能力，而是开始关注 AI 能不能接住真实业务动作",
        link: "",
        source: "思潼趋势观察",
        insight: "能落地的 AI 不是展示功能，而是帮团队每天少漏事、少返工、少靠感觉。",
        action: "把今天最容易漏的一个客户跟进动作写进输入框，让思潼生成话术。"
      },
      {
        title: "多模态能力正在把图片、语音、视频和文件纳入同一个经营工作流",
        link: "",
        source: "思潼趋势观察",
        insight: "对 IP 获客来说，视频素材、口播转写和复盘建议会越来越连成一条链。",
        action: "上传一条视频或一段口播，进入拍剪优化或视频数据复盘。"
      }
    ];
    const metadata: AiDailyMetadata = {
      date: beijingDate,
      generatedAt: now.toISOString(),
      summary: "资讯源暂时连接不稳定，先给你趋势版 AI日报。",
      fallback: true,
      news: fallbackNews,
      sitongView: "AI的价值正在从“帮你想”转向“帮你每天执行”。中小企业不用先搭很复杂的系统，先把内容、私信、复盘、日报这些高频动作跑起来，就能比只试工具更快见到结果。",
      actions: [
        "用 IP获客智能体生成今天第一条内容。",
        "把昨天问价未成交客户整理出来，让思潼生成二次跟进话术。",
        "上传一条视频，先做一次视频数据复盘。"
      ]
    };
    return {
      content: formatDailyText(metadata),
      metadata
    };
  }

  const selectedNews = news.slice(0, 6).map((item) => ({
    ...item,
    insight: buildSitongNewsInsight(item.title),
    action: buildSitongNewsAction(item.title)
  }));
  const metadata: AiDailyMetadata = {
    date: beijingDate,
    generatedAt: now.toISOString(),
    summary: `${selectedNews.length}条最新AI资讯已汇总，重点看“模型能力、智能体、企业应用、内容平台变化”对经营动作的影响。`,
    fallback: false,
    news: selectedNews,
    sitongView: "今天这些信息共同指向一件事：AI正在从新闻热点变成企业内部的日常生产力。对中小企业来说，不要只收藏资讯，要把它翻译成内容、销售、复盘和团队执行里的一个动作。",
    actions: [
      "挑一个产品或服务，让 IP获客智能体生成今天可发的内容。",
      "把最近一条视频数据发给视频数据复盘，判断卡在完播、互动还是转化。",
      "把今天要直播的产品、福利和目标客户发给直播话术，先生成可照读脚本。"
    ]
  };
  return {
    content: formatDailyText(metadata),
    metadata
  };
}

function formatDailyText(metadata: AiDailyMetadata): string {
  return [
    `思潼 AI日报 ${metadata.date}`,
    metadata.summary,
    "最新信息",
    ...metadata.news.map((item, index) => [
      `${index + 1}. ${item.title}`,
      `来源：${item.source}${item.publishedAt ? ` · ${formatDateText(item.publishedAt)}` : ""}`,
      item.link ? `链接：${item.link}` : "",
      `思潼解读：${item.insight}`,
      `建议动作：${item.action}`
    ].filter(Boolean).join("\n")),
    "思潼解读",
    metadata.sitongView,
    "今日动作",
    ...metadata.actions.map((item, index) => `${index + 1}. ${item}`)
  ].join("\n\n");
}

function buildSitongNewsInsight(title: string): string {
  if (/智能体|Agent|工作流/i.test(title)) {
    return "智能体正在从概念走向流程执行。老板最该关注的不是炫技，而是哪些重复经营动作可以交给系统持续推进。";
  }
  if (/视频|多模态|语音|图片|视觉|ASR/i.test(title)) {
    return "多模态能力会直接影响内容生产和复盘。上传素材、抽帧、转写、生成拍剪建议会成为 IP 获客的基础能力。";
  }
  if (/大模型|模型|开源|推理|算力/i.test(title)) {
    return "模型能力继续升级，但企业真正受益来自稳定接入业务场景，而不是频繁换模型。";
  }
  if (/企业|应用|办公|生产力|商业化/i.test(title)) {
    return "AI应用正在进入企业日常工作。先把内容、销售跟进、日报和复盘这些高频环节做成固定动作，收益更直接。";
  }
  if (/抖音|小红书|微信|视频号|快手|内容|营销/i.test(title)) {
    return "内容平台变化会影响获客入口。IP获客要更重视真实素材、强开头、明确私信入口和持续复盘。";
  }
  return "这类变化值得关注，但不要停留在看资讯，要把它翻译成今天能执行的一步经营动作。";
}

function buildSitongNewsAction(title: string): string {
  if (/智能体|Agent|工作流/i.test(title)) return "今天选一个重复任务，例如日报、私信跟进或视频数据复盘，先让思潼跑一遍。";
  if (/视频|多模态|语音|图片|视觉|ASR/i.test(title)) return "上传一条视频素材，用拍剪优化或视频数据复盘看开头、画面和转化入口。";
  if (/抖音|小红书|微信|视频号|快手|内容|营销/i.test(title)) return "用 IP获客智能体生成一条今天能发的短视频或朋友圈内容，并记录私信数。";
  if (/企业|应用|办公|生产力|商业化/i.test(title)) return "把今天最卡的一件经营动作写清楚，让思潼输出可执行清单。";
  return "把这条趋势对应到自己的获客、销售、交付或团队管理里，先做一个最小动作。";
}

function formatDateText(value: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return value;
  return parsed.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
}

function getBeijingClock(now: Date): { date: string; hour: number } {
  const beijingDate = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return {
    date: beijingDate.toISOString().slice(0, 10),
    hour: beijingDate.getUTCHours()
  };
}

function extractAudioAnalysis(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const analysis = (payload as { analysis?: unknown }).analysis;
  if (!analysis || typeof analysis !== "object") return "";
  const answer = (analysis as { answer?: unknown }).answer;
  return typeof answer === "string" ? answer.slice(0, 1800) : "";
}

function buildFollowupFromLatestRun(output: string): string {
  const clean = output
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\*\*/g, "")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return [
    "我把你最近一次咨询里的执行动作拎出来提醒你。",
    clean.slice(0, 900),
    "今天先不用做很多事，挑其中一个动作执行完，再回来告诉我结果，我会继续帮你复盘。"
  ].join("\n\n");
}

function getPayloadRecord(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {};
}

function readPayloadNumber(payload: Record<string, unknown>, key: string, fallback: number): number {
  const value = payload[key];
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number.parseInt(value, 10) : Number.NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(15, Math.min(parsed, 24 * 60));
}

function readPayloadText(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === "string" ? value.trim() : "";
}

function readDimensionText(payload: Record<string, unknown>, key: string): string {
  const dimensions = getPayloadRecord(payload.dimensions);
  const value = dimensions[key];
  return typeof value === "string" ? value.trim() : "";
}

function cleanRunOutput(output: string): string {
  return output
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\*\*/g, "")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function buildRecurringBusinessReview(
  payload: unknown,
  latestRuns: Array<{ output: string | null; skillId: string; createdAt: Date }>,
  audioTasks: Array<{ payload: unknown; updatedAt: Date }>
): string {
  const record = getPayloadRecord(payload);
  const diagnosisSummary = readPayloadText(record, "diagnosisSummary");
  const latestConversation = latestRuns
    .map((run) => (run.output ? cleanRunOutput(run.output).slice(0, 280) : ""))
    .filter(Boolean)
    .slice(0, 2);
  const audioRecaps = audioTasks
    .map((task) => extractAudioAnalysis(task.payload))
    .filter(Boolean)
    .slice(0, 2)
    .map((item) => item.slice(0, 260));

  const contextLines = [
    diagnosisSummary ? `首次诊断：${diagnosisSummary}` : "",
    ...latestConversation.map((item, index) => `最近对话${index + 1}：${item}`),
    ...audioRecaps.map((item, index) => `录音卡复盘${index + 1}：${item}`)
  ].filter(Boolean);

  if (latestConversation.length === 0 && audioRecaps.length === 0) {
    return [
      "这是按你设置的时间自动推送的经营复盘。",
      "目前没有新的聊天内容，也没有拉取到新的录音卡内容，所以我暂时不给你硬编更多经营建议。",
      "你可以补充一句最新经营困惑，比如新客少、问价不成交、复购弱、员工执行差，我会马上继续拆解。",
      "如果你希望系统更丝滑地自动给建议，建议接入录音卡。你每天只需要录音，系统会主动拉取工作内容，再自动整理选题、文案、朋友圈、销售话术和经营建议。"
    ].join("\n\n");
  }

  return [
    "这是按你设置的时间自动推送的经营复盘。",
    "我会结合首次诊断、最近对话上下文，以及已绑定录音卡主动拉取到的内容，先给你一版今天能执行的经营建议。",
    contextLines.length > 0 ? `我参考到的信息：\n${contextLines.join("\n")}` : "目前可参考的信息还不多，你继续和咨询师聊天或绑定录音卡后，后续建议会更贴合。",
    `获客建议：${buildDimensionAdvice("获客", readDimensionText(record, "acquisition"), "今天先固定一个主要获客入口，围绕客户真实痛点产出1条内容或1次触达，并记录咨询数。")}`,
    `销售建议：${buildDimensionAdvice("销售", readDimensionText(record, "sales"), "把今天所有问价、犹豫、未成交客户拉出来，用一条更具体的利益点或到店理由做二次跟进。")}`,
    `交付建议：${buildDimensionAdvice("交付", readDimensionText(record, "delivery"), "把今天服务后的客户反馈沉淀下来，挑1个能证明效果或体验的案例，转成后续内容素材。")}`,
    `管理建议：${buildDimensionAdvice("管理", readDimensionText(record, "management"), "只盯一个关键动作：今天谁负责发内容、谁负责跟进、谁负责记录结果，晚上用数据复盘。")}`,
    "你可以直接回复“继续复盘”，我会根据今天新增的聊天和录音内容，继续往下拆下一步动作。"
  ].join("\n\n");
}

function buildDimensionAdvice(_title: string, diagnosis: string, fallback: string): string {
  if (!diagnosis) return fallback;
  return `${fallback} 结合你诊断里提到的情况：${diagnosis.slice(0, 120)}，先做一个最小动作，不要一次改太多。`;
}

function dedupeFeedItems(items: ProactiveFeedItem[]): ProactiveFeedItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

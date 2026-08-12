import type { LlmProvider } from "@baolu/agent";
import { scanIndustryTrends } from "./trend-intelligence.js";

export interface DailyBriefItem {
  no: number;
  source: string;
  title: string;
  summary: string;
  sourceLabel: string;
  sitongComment: string;
  sourceUrl?: string;
  publishedAt?: string;
  verificationStatus?: "verified_hotspot" | "trend_observation";
}

export interface DailyBriefSection {
  title: string;
  emoji: string;
  items: DailyBriefItem[];
}

export interface DailyBriefContent {
  date: string;
  weekday: string;
  issueNo: number;
  headline: string;
  sections: DailyBriefSection[];
  trends: string[];
  action: string;
}

export interface DailyBriefReport {
  id: string;
  reportDate: string;
  issueNo: number;
  title: string;
  summary: string;
  content: DailyBriefContent;
  markdown: string;
  status: "published";
  generatedAt: string;
  publishedAt: string;
}

interface NewsSeed {
  title: string;
  source: string;
  url: string;
  publishedAt: string;
  eventType: string;
}

const DEFAULT_TIMEZONE = "Asia/Shanghai";
const BASE_ISSUE_DATE = Date.UTC(2026, 0, 1);
const DAILY_BRIEF_MODEL_TIMEOUT_MS = 16000;
const dailyBriefCache = new Map<string, DailyBriefReport>();
const dailyBriefInFlight = new Map<string, Promise<DailyBriefReport>>();
const SECTION_TITLES = ["模型动态", "产品发布", "行业风云", "企业改造案例", "趋势洞察"] as const;
const SECTION_EMOJIS = ["🧠", "🚀", "🏭", "🏢", "🔮"] as const;

export function getBeijingDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: DEFAULT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
}

export async function ensureDailyBriefReport(provider: LlmProvider, reportDate = getBeijingDate()): Promise<DailyBriefReport> {
  const cached = dailyBriefCache.get(reportDate);
  if (cached) return cached;
  const inFlight = dailyBriefInFlight.get(reportDate);
  if (inFlight) return inFlight;

  const pending = (async () => {
    const content = await generateDailyBriefContent(provider, reportDate);
    const report: DailyBriefReport = {
      id: `daily-${reportDate}`,
      reportDate,
      issueNo: content.issueNo,
      title: "思潼AI日报",
      summary: content.headline,
      content,
      markdown: renderDailyBriefMarkdown(content),
      status: "published",
      generatedAt: new Date().toISOString(),
      publishedAt: new Date().toISOString()
    };
    dailyBriefCache.set(reportDate, report);
    return report;
  })();
  dailyBriefInFlight.set(reportDate, pending);
  try {
    return await pending;
  } finally {
    dailyBriefInFlight.delete(reportDate);
  }
}

export function buildDailyBriefHistory(current: DailyBriefReport): DailyBriefReport[] {
  return [
    current,
    buildReportFromContent(buildFallbackBrief(addDays(current.reportDate, -1), [])),
    buildReportFromContent(buildFallbackBrief(addDays(current.reportDate, -2), []))
  ];
}

export function renderDailyBriefMarkdown(content: DailyBriefContent): string {
  const lines = [
    "思潼 X AI日报",
    `${formatChineseDate(content.date)} · ${content.weekday} · 第${content.issueNo}期`,
    "",
    "15条精选 · 5大版块 · 3大趋势",
    "Business × AI · 让每个老板都拥有AI增长引擎",
    ""
  ];

  for (const section of content.sections) {
    lines.push(`${section.emoji}  ${section.title}  ─  ${section.items.length}条`);
    for (const item of section.items) {
      lines.push(`#${item.no}  ${item.source}`);
      lines.push(item.title);
      lines.push(item.summary);
      lines.push(`来源：${item.sourceLabel}${item.publishedAt ? ` · ${item.publishedAt}` : ""}${item.sourceUrl ? ` · ${item.sourceUrl}` : ""}`);
      if (item.verificationStatus === "trend_observation") lines.push("标记：趋势观察（非当日新闻）");
      lines.push(`思潼点评：${item.sitongComment}`);
      lines.push("");
    }
  }

  lines.push("今日可落地动作");
  lines.push(content.action);
  return lines.join("\n").trim();
}

async function generateDailyBriefContent(provider: LlmProvider, reportDate: string): Promise<DailyBriefContent> {
  const seeds = await fetchNewsSeeds();
  const prompt = [
    "你是思潼AI日报编辑。请基于下面候选AI新闻，生成面向中国企业老板的每日AI日报。",
    "核心读者是中国境内的老板、中小企业、本地商家、连锁品牌和知识型创业者。",
    "要求：全程中文，短句，老板能看懂；重点解释AI行业最新发展、AI在中国企业改造方面的应用进展。",
    "固定输出JSON，不要Markdown，不要代码块。",
    "JSON结构：{headline:string, sections:[{title:string, emoji:string, items:[{source:string,title:string,summary:string,sourceLabel:string,sitongComment:string,sourceUrl?:string,publishedAt?:string,verificationStatus:'verified_hotspot'|'trend_observation'}]}], trends:string[], action:string}",
    "必须5大版块：模型动态、产品发布、行业风云、企业改造案例、趋势洞察。",
    "总共15条，每个版块3条。每条summary 70-120字，sitongComment 50-90字。",
    "企业改造案例必须包含客服、销售、内容、交付、管理、财务、培训等方向里的真实可落地启发。",
    "action必须是今天就能完成的一个国内企业动作，80字以内。",
    "只有候选新闻中的内容可以写成最新消息，必须保留sourceUrl、publishedAt，并把verificationStatus写为verified_hotspot。",
    "如果候选新闻不足，可以用不带具体时效事实的行业级趋势观察补位，但source必须写“趋势观察”、sourceLabel必须写“非实时背景”，verificationStatus必须写trend_observation；不得包装成今日热点。",
    "",
    `日期：${reportDate}`,
    "候选新闻：",
    seeds.map((item, index) => `${index + 1}. ${item.title}｜${item.eventType}｜${item.publishedAt}｜${item.source}｜${item.url}`).join("\n") || "本轮暂无通过日期与事件核验的AI热点，只能输出非实时趋势观察。"
  ].join("\n");

  try {
    const raw = await completeDailyBriefWithTimeout(provider, [
      { role: "system", content: "你只输出可解析JSON。不要输出思考过程。" },
      { role: "user", content: prompt }
    ]);
    const parsed = JSON.parse(extractJson(raw)) as Partial<DailyBriefContent>;
    const normalized = normalizeBriefContent(parsed, reportDate, seeds);
    if (countItems(normalized) === 15) return normalized;
  } catch {
    // Keep the daily available even when news fetch, model, or JSON parsing fails.
  }

  return buildFallbackBrief(reportDate, seeds);
}

async function completeDailyBriefWithTimeout(provider: LlmProvider, messages: Parameters<LlmProvider["complete"]>[0]): Promise<string> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      provider.complete(messages),
      new Promise<string>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error("AI日报生成超时，使用样板库快速出稿")), DAILY_BRIEF_MODEL_TIMEOUT_MS);
      })
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function fetchNewsSeeds(): Promise<NewsSeed[]> {
  const scan = await scanIndustryTrends("人工智能", { mode: "ai", limit: 30, maxAgeDays: 7 });
  return scan.verifiedHotspots.map((item) => ({
    title: item.title,
    source: item.source,
    url: item.url!,
    publishedAt: item.publishedAt!,
    eventType: item.eventType
  }));
}

function normalizeBriefContent(input: Partial<DailyBriefContent>, reportDate: string, seeds: NewsSeed[]): DailyBriefContent {
  const sections = SECTION_TITLES.map((title, index) => {
    const source = input.sections?.find((section) => section.title?.includes(title)) ?? input.sections?.[index];
    return {
      title,
      emoji: source?.emoji || SECTION_EMOJIS[index],
      items: fillItems(source?.items ?? [], title, index, seeds)
    };
  });
  return {
    date: reportDate,
    weekday: weekdayLabel(reportDate),
    issueNo: issueNo(reportDate),
    headline: input.headline || "今天有3个AI变化值得老板关注。",
    sections,
    trends: fillStrings(input.trends ?? [], ["AI Agent进入真实流程", "企业开始重视AI ROI", "国产模型成为企业改造底座"], 3),
    action: cleanAction(input.action)
  };
}

function fillItems(items: Partial<DailyBriefItem>[], sectionTitle: string, sectionIndex: number, seeds: NewsSeed[]): DailyBriefItem[] {
  const fallback = FALLBACK_LIBRARY[sectionTitle] ?? [];
  return Array.from({ length: 3 }).map((_, itemIndex) => {
    const source = items[itemIndex];
    const fallbackItem = fallback[itemIndex];
    const verifiedSeed = source?.sourceUrl ? seeds.find((seed) => seed.url === source.sourceUrl) : undefined;
    return {
      no: sectionIndex * 3 + itemIndex + 1,
      source: source?.source || fallbackItem.source,
      title: source?.title || fallbackItem.title,
      summary: source?.summary || fallbackItem.summary,
      sourceLabel: source?.sourceLabel || fallbackItem.sourceLabel,
      sitongComment: source?.sitongComment || fallbackItem.sitongComment,
      sourceUrl: verifiedSeed?.url,
      publishedAt: verifiedSeed?.publishedAt,
      verificationStatus: verifiedSeed ? "verified_hotspot" : "trend_observation"
    };
  });
}

function buildFallbackBrief(reportDate: string, seeds: NewsSeed[]): DailyBriefContent {
  const sections = SECTION_TITLES.map((title, index) => ({
    title,
    emoji: SECTION_EMOJIS[index],
    items: fillItems(seedItemsForSection(seeds, title, index), title, index, seeds)
  }));
  return {
    date: reportDate,
    weekday: weekdayLabel(reportDate),
    issueNo: issueNo(reportDate),
    headline: "今天重点看三件事：大模型能力继续升级，AI产品进入工作流，企业落地开始从试用转向ROI。",
    sections,
    trends: ["大模型进入多模态和Agent阶段", "企业AI从工具采购转向流程改造", "内容、销售、客服是最快见效场景"],
    action: "今天先选一个重复高频场景，整理10条真实问题和标准回答，让AI生成一版可检查、可复制、可培训的话术。"
  };
}

function seedItemsForSection(seeds: NewsSeed[], sectionTitle: string, sectionIndex: number): Partial<DailyBriefItem>[] {
  if (seeds.length === 0) return [];
  return seeds.slice(sectionIndex * 3, sectionIndex * 3 + 3).map((seed) => {
    return {
      source: seed.source,
      title: seed.title,
      summary: `${sectionTitle}里这条动态值得关注。它说明AI正在从单点能力进入具体业务动作，企业不能只看热闹，要判断它能否提升获客、销售、客服、交付或管理效率。`,
      sourceLabel: seed.source,
      sitongComment: "思潼建议老板把它翻译成一个内部动作：先找一个高频重复场景试跑，再看是否能降本、提效、沉淀标准流程。",
      sourceUrl: seed.url,
      publishedAt: seed.publishedAt,
      verificationStatus: "verified_hotspot"
    };
  });
}

function buildReportFromContent(content: DailyBriefContent): DailyBriefReport {
  return {
    id: `daily-${content.date}`,
    reportDate: content.date,
    issueNo: content.issueNo,
    title: "思潼AI日报",
    summary: content.headline,
    content,
    markdown: renderDailyBriefMarkdown(content),
    status: "published",
    generatedAt: new Date().toISOString(),
    publishedAt: new Date().toISOString()
  };
}

const FALLBACK_LIBRARY: Record<string, Omit<DailyBriefItem, "no">[]> = {
  模型动态: [
    {
      source: "思潼观察",
      title: "大模型能力继续向多模态和复杂任务推进",
      summary: "新一代模型不再只是回答问题，而是在文字、图片、语音、视频和工具调用之间协同。对企业来说，真正的变化是资料输入更丰富，任务拆解更自动。",
      sourceLabel: "公开趋势整理",
      sitongComment: "老板不用追每一个参数，先判断团队有哪些工作需要看文件、看图片、听录音，再把这些输入接进一个可复用流程。"
    },
    {
      source: "思潼观察",
      title: "Agent开始从演示走向连续执行",
      summary: "越来越多AI产品强调计划、执行、检查和迭代，而不是一次性生成答案。企业落地时，Agent更适合处理线索整理、内容排期、复盘总结这类连续工作。",
      sourceLabel: "公开趋势整理",
      sitongComment: "先让AI接手一个低风险重复流程，比如每日线索汇总或内容复盘，比一开始就追求全自动更容易看到价值。"
    },
    {
      source: "思潼观察",
      title: "国产大模型成为企业AI改造的重要底座",
      summary: "国内模型在中文理解、本地平台接入和企业服务场景上持续增强。对中小企业来说，关键不是模型名字，而是能否稳定接入自己的客户、内容和交付流程。",
      sourceLabel: "公开趋势整理",
      sitongComment: "选模型要看中文表达、稳定性、成本和数据边界，最终要服务于业务结果，不要把模型测评当成经营目标。"
    }
  ],
  产品发布: [
    {
      source: "思潼观察",
      title: "AI工作台产品正在替代零散工具箱",
      summary: "越来越多产品把文档、知识库、对话、自动化和数据分析放在同一入口。企业用户不想频繁切工具，更需要一个能把资料变成行动清单的工作台。",
      sourceLabel: "公开趋势整理",
      sitongComment: "如果团队已经用了很多AI小工具，今天可以盘点哪些资料和任务最分散，优先整合到一个入口里。"
    },
    {
      source: "思潼观察",
      title: "AI视频与内容工具更重视生产链路",
      summary: "内容工具正在从单纯生成图文视频，升级为选题、脚本、拍摄、剪辑、发布和复盘一体化。对IP获客来说，单条爆款不如稳定生产机制重要。",
      sourceLabel: "公开趋势整理",
      sitongComment: "内容老板要搭的是内容流水线：每周固定选题、固定拍摄、固定复盘，让AI帮助团队减少空想和返工。"
    },
    {
      source: "思潼观察",
      title: "企业知识库产品开始强调权限和复用",
      summary: "知识库不只是上传资料问答，而是把销售话术、客户案例、服务标准和培训内容沉淀下来，并按岗位分权限调用。这样AI才能贴近真实业务。",
      sourceLabel: "公开趋势整理",
      sitongComment: "今天先整理一份最常用资料，比如成交案例或客户问答，比一次性搭大而全知识库更实际。"
    }
  ],
  行业风云: [
    {
      source: "思潼观察",
      title: "AI竞争从模型发布转向场景落地",
      summary: "市场注意力正在从谁的模型更强，转到谁能把AI放进销售、客服、内容、研发和管理流程。企业采购也更关心实际节省多少时间和人力。",
      sourceLabel: "公开趋势整理",
      sitongComment: "老板评估AI项目时，要让团队说清楚节省什么岗位时间、提升哪个指标、什么时候能看到结果。"
    },
    {
      source: "思潼观察",
      title: "中小企业AI采用速度正在加快",
      summary: "过去AI更多停留在尝鲜，现在越来越多小团队开始用AI做素材整理、私域跟进、直播话术和客户复盘。低门槛、快见效成为落地关键词。",
      sourceLabel: "公开趋势整理",
      sitongComment: "不要先做复杂系统，先抓一条能马上多成交或少返工的流程，跑通后再扩到团队。"
    },
    {
      source: "思潼观察",
      title: "AI应用的价值开始回到经营基本功",
      summary: "真正有效的AI不是炫技，而是帮企业把客户是谁、卖什么、怎么成交、怎么交付说清楚。业务底层越清楚，AI输出越能直接执行。",
      sourceLabel: "公开趋势整理",
      sitongComment: "AI放大的是原有业务认知。今天先把目标客户、产品优势和成交动作写清楚，后面所有生成都会更准。"
    }
  ],
  企业改造案例: [
    {
      source: "思潼观察",
      title: "客服场景最适合先做AI标准问答",
      summary: "把客户反复问的问题整理成标准回答，再让AI按不同语气改写，可以快速提升响应速度。适合本地生活、教育、医美、美业和企业服务。",
      sourceLabel: "公开趋势整理",
      sitongComment: "今天让一线同事提交20条真实客户问题，老板审核标准答案，这就是最小可落地的AI客服改造。"
    },
    {
      source: "思潼观察",
      title: "销售跟进开始用AI做线索分层",
      summary: "AI可以根据聊天记录、客户预算、需求紧迫度和决策角色，给销售标注跟进优先级，并生成下一句话。它解决的是销售漏跟和话术不稳定。",
      sourceLabel: "公开趋势整理",
      sitongComment: "先不要自动外呼，先把已成交和未成交记录给AI复盘，找出最常见的卡点和推进话术。"
    },
    {
      source: "思潼观察",
      title: "内容团队用AI做选题和复盘更容易见效",
      summary: "AI能把产品卖点、客户痛点和平台热点组合成选题，再根据播放、互动、私信数据做复盘。对IP获客来说，这比单纯追热点更稳定。",
      sourceLabel: "公开趋势整理",
      sitongComment: "老板要盯的不是今天发没发，而是内容有没有带来咨询、预约、加微或到店。复盘指标要贴着成交走。"
    }
  ],
  趋势洞察: [
    {
      source: "思潼观察",
      title: "AI落地会先吃掉重复沟通成本",
      summary: "客户问答、内部培训、销售跟进、日报周报这些高频文字工作，会最先被AI重塑。企业先改这些地方，风险低、见效快、容易复制。",
      sourceLabel: "公开趋势整理",
      sitongComment: "不要问AI能替代谁，先问团队每天重复说了哪些话、重复写了哪些材料，把这些变成模板资产。"
    },
    {
      source: "思潼观察",
      title: "会用AI的企业会更重视真实数据输入",
      summary: "未来差距不只在模型，而在企业是否有真实素材、客户记录、交付标准和复盘数据。输入越真实，AI越能输出像老板能用的建议。",
      sourceLabel: "公开趋势整理",
      sitongComment: "今天开始沉淀客户聊天、成交案例和失败原因，哪怕只有几十条，也比空泛提问更能提升输出质量。"
    },
    {
      source: "思潼观察",
      title: "AI系统会从单功能变成增长飞轮",
      summary: "内容获客、销售成交、交付复盘、客户私域和管理数据会逐步连起来。每次输出都会反哺下一次动作，形成更清晰的经营闭环。",
      sourceLabel: "公开趋势整理",
      sitongComment: "先让一个智能体跑通，再逐步增加诊断、销售和交付管理，系统才不会变成功能堆砌。"
    }
  ]
};

function fillStrings(values: string[], fallback: string[], count: number): string[] {
  return Array.from({ length: count }).map((_, index) => values[index] || fallback[index] || fallback[0]);
}

function cleanAction(action?: string): string {
  const clean = (action ?? "").replace(/\s+/g, " ").trim();
  if (!clean) {
    return "今天先选一个重复高频场景，整理10条真实问题和标准回答，让AI生成一版可检查、可复制、可培训的话术。";
  }
  return clean.length <= 120 ? clean : `${clean.slice(0, 116)}...`;
}

function countItems(content: DailyBriefContent): number {
  return content.sections.reduce((sum, section) => sum + section.items.length, 0);
}

function issueNo(date: string): number {
  const current = Date.parse(`${date}T00:00:00Z`);
  return Math.max(1, Math.floor((current - BASE_ISSUE_DATE) / 86400000) + 1);
}

function weekdayLabel(date: string): string {
  return new Intl.DateTimeFormat("zh-CN", { weekday: "long", timeZone: DEFAULT_TIMEZONE }).format(new Date(`${date}T00:00:00+08:00`));
}

function formatChineseDate(date: string): string {
  const [year, month, day] = date.split("-");
  return `${year}年${Number(month)}月${Number(day)}日`;
}

function addDays(date: string, offset: number): string {
  const value = new Date(`${date}T00:00:00+08:00`);
  value.setDate(value.getDate() + offset);
  return getBeijingDate(value);
}

function extractJson(raw: string): string {
  const cleaned = raw.replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("No JSON object");
  return cleaned.slice(start, end + 1);
}

function extractNewsTitles(body: string): RegExpMatchArray[] {
  const itemTitles = [...body.matchAll(/<item[\s\S]*?<title[^>]*>([\s\S]*?)<\/title>[\s\S]*?<\/item>/gi)];
  const entryTitles = [...body.matchAll(/<entry[\s\S]*?<title[^>]*>([\s\S]*?)<\/title>[\s\S]*?<\/entry>/gi)];
  const pageTitles = [
    ...body.matchAll(/<title[^>]*>([\s\S]*?)<\/title>/gi),
    ...body.matchAll(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/gi)
  ];
  return [...itemTitles, ...entryTitles, ...pageTitles];
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, "").replace(/&[^;]+;/g, " ").replace(/\s+/g, " ").trim();
}

function sourceName(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "公开资料";
  }
}

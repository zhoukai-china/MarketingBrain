// 兰琪美业门店 AI 经营大脑 · 公域获客 / 直播话术（主播单人 2 小时逐字稿）
//
// 契约来源：demo `live.html`（活规范）。本文件只实现算法与业务口径，不照抄原型演示 JS。
// 关键口径：
//   · 5 组轮次 / 23 段固定骨架（轮次、时间段、主题、分钟数由规则给出，不交给模型自由发挥）
//   · 每段含【主播口播稿】【备用话术】【互动动作】【主播节奏提示】
//   · 口播按 200 字/分钟估算；「可撑分钟」= (口播 + 备用话术 + 救场库) 字数 / 200
//   · 生成侧：规则定骨架 → 模型只填内容 → 合规硬门禁（违规引导词 / 绝对化疗效词 / 价格口径）

import { containsAbsWords, containsBanWords, containsPromiseClaims, splitSentences } from "./moments-rules.js";
import { createRuntimeLlmProvider, type RuntimeLlmProvider } from "../../services/llm-provider-factory.js";

export const LIVE_SERVICE_VERSION = "lanqi_live_service_v1" as const;

/** 口播速度口径：200 字/分钟（与 demo 一致） */
export const LIVE_WORDS_PER_MINUTE = 200;
export const LIVE_PLANNED_MINUTES = 120;
/** 每组模型调用的最大分钟数：控制单次输出体量，避免单请求超时 */
const BATCH_MAX_MINUTES = 8;
const BATCH_MAX_SEGMENTS = 2;
/**
 * 合规重写次数：首次不过 → 只把违规段落单独回灌重写（已通过段落保留，不整批报废）→
 * 最后一次机会要求完全换一种写法 → 仍不过则 fail closed。
 * 允许 3 次（含首次）：模型偶发写出「私信」这类软违规时，整批重写会把同一条违规词换个位置再犯，
 * 而一批失败会让整份 2 小时逐字稿报废（0911 实测 10 批里 1 批命中 422、单批耗时 44 秒；
 * 0913 实测同一条输入一次成功一次 422，属偶发）。门禁本身不放宽，只缩小重写范围并强制换说法。
 */
const MAX_ATTEMPTS = 3;

export interface LiveRound {
  no: number;
  name: string;
  time: string;
  goal: string;
}

/** 轮次定义（节奏表分组 + 生成分组），与 demo `ROUNDS` 一致。 */
export const LIVE_ROUNDS: LiveRound[] = [
  { no: 0, name: "开场", time: "0:00–0:10", goal: "留人 + 建立信任" },
  { no: 1, name: "第 1 轮", time: "0:10–0:43", goal: "讲清楚：为什么你花了钱没效果" },
  { no: 2, name: "第 2 轮", time: "0:43–1:16", goal: "讲给谁：分肤质对号入座" },
  { no: 3, name: "第 3 轮", time: "1:16–1:49", goal: "讲到底：误区辟谣 + 卡项算账" },
  { no: 4, name: "收尾", time: "1:49–2:00", goal: "倒计时逼单 + 关注引导" }
];

interface LiveSegmentSpec {
  /** 1 基段号（展示用） */
  no: number;
  round: number;
  time: string;
  mins: number;
  theme: string;
  /** 核心复讲段：2 小时内不断有新观众进来，这些段要复讲卖点 */
  loop: boolean;
}

/** 23 段固定骨架，与 demo `buildSegments()` 一致。 */
export const LIVE_SEGMENTS: LiveSegmentSpec[] = [
  { no: 1, round: 0, time: "0:00–0:04", mins: 4, theme: "暖场打招呼 + 留人钩子", loop: true },
  { no: 2, round: 0, time: "0:04–0:07", mins: 3, theme: "今天流程预告 + 福利预告", loop: true },
  { no: 3, round: 0, time: "0:07–0:10", mins: 3, theme: "第一波互动破冰 + 建立信任", loop: true },
  { no: 4, round: 1, time: "0:10–0:17", mins: 7, theme: "痛点共鸣大串烧（六张脸）", loop: true },
  { no: 5, round: 1, time: "0:17–0:24", mins: 7, theme: "原理讲解：护肤三段论", loop: true },
  { no: 6, round: 1, time: "0:24–0:32", mins: 8, theme: "主推项目塑品（FABE 展开讲）", loop: true },
  { no: 7, round: 1, time: "0:32–0:36", mins: 4, theme: "现场演示 / 过程展示", loop: true },
  { no: 8, round: 1, time: "0:36–0:39", mins: 3, theme: "第一轮逼单", loop: true },
  { no: 9, round: 1, time: "0:39–0:43", mins: 4, theme: "第一轮答疑 + 念评论", loop: true },
  { no: 10, round: 2, time: "0:43–0:51", mins: 8, theme: "四类肤质分别怎么讲", loop: true },
  { no: 11, round: 2, time: "0:51–0:59", mins: 8, theme: "居家产品塑品", loop: true },
  { no: 12, round: 2, time: "0:59–1:04", mins: 5, theme: "项目 + 产品组合用法", loop: true },
  { no: 13, round: 2, time: "1:04–1:08", mins: 4, theme: "案例连讲（三个真实客人）", loop: true },
  { no: 14, round: 2, time: "1:08–1:11", mins: 3, theme: "第二轮逼单", loop: true },
  { no: 15, round: 2, time: "1:11–1:16", mins: 5, theme: "第二轮答疑（产品向）", loop: true },
  { no: 16, round: 3, time: "1:16–1:24", mins: 8, theme: "五个常见误区辟谣", loop: true },
  { no: 17, round: 3, time: "1:24–1:31", mins: 7, theme: "老客案例深讲 + 回购逻辑", loop: true },
  { no: 18, round: 3, time: "1:31–1:37", mins: 6, theme: "卡项 / 会员讲解 + 算账", loop: true },
  { no: 19, round: 3, time: "1:37–1:40", mins: 3, theme: "第三轮逼单", loop: true },
  { no: 20, round: 3, time: "1:40–1:45", mins: 5, theme: "开放答疑（最后一轮）", loop: true },
  { no: 21, round: 3, time: "1:45–1:49", mins: 4, theme: "异议处理（贵 / 没时间 / 怕踩坑）", loop: true },
  { no: 22, round: 4, time: "1:49–1:56", mins: 7, theme: "最后倒计时逼单", loop: true },
  { no: 23, round: 4, time: "1:56–2:00", mins: 4, theme: "感谢 + 关注引导 + 下播", loop: true }
];

export interface LiveBatch {
  /** 批次号，1 基 */
  no: number;
  round: number;
  roundName: string;
  /** 本批包含的段号（1 基，连续） */
  segNos: number[];
  totalMins: number;
  /** 本批口播字数目标 */
  targetWords: number;
}

/** 生成分批：同一轮内连续段落合批，单批 ≤ 8 分钟且 ≤ 2 段，保证单请求输出体量可控。 */
export function buildLiveBatches(): LiveBatch[] {
  const batches: LiveBatch[] = [];
  let current: LiveSegmentSpec[] = [];
  const flush = () => {
    if (!current.length) return;
    const round = LIVE_ROUNDS.find((r) => r.no === current[0].round);
    const totalMins = current.reduce((sum, seg) => sum + seg.mins, 0);
    batches.push({
      no: batches.length + 1,
      round: current[0].round,
      roundName: round?.name ?? "",
      segNos: current.map((seg) => seg.no),
      totalMins,
      targetWords: totalMins * LIVE_WORDS_PER_MINUTE
    });
    current = [];
  };
  for (const seg of LIVE_SEGMENTS) {
    if (current.length && (current[0].round !== seg.round || current.length >= BATCH_MAX_SEGMENTS)) flush();
    const pendingMins = current.reduce((sum, item) => sum + item.mins, 0);
    if (current.length && pendingMins + seg.mins > BATCH_MAX_MINUTES) flush();
    current.push(seg);
  }
  flush();
  return batches;
}

export const LIVE_BATCHES: LiveBatch[] = buildLiveBatches();

/** 救场话术库类别（5 类 × 6 条），类别名与 demo 一致。 */
export const LIVE_FILLER_CATEGORIES = [
  "冷场救急（没人说话时用）",
  "重复解释（新观众不断进来）",
  "被质疑 / 砍价",
  "等人 / 等评论（给自己留白）",
  "节奏出问题 / 需要拖时间"
] as const;
export const LIVE_FILLER_PER_CATEGORY = 6;

export interface LiveInput {
  storeId: string;
  /** 店名 / 主播身份 */
  host: string;
  /** 带货标的：团购券 / 居家产品 / 会员卡 */
  carries: string[];
  /** 主打项目 / 产品名 */
  main: string;
  /** 真实卖点 */
  sell: string;
  /** 价格机制 */
  price: string;
  /** 会员卡项权益与价 */
  card: string;
  /** 平台：抖音 / 视频号 */
  platforms: string[];
}

export interface LiveSegment {
  no: number;
  round: number;
  time: string;
  mins: number;
  theme: string;
  loop: boolean;
  script: string;
  fill: string[];
  interact: string;
  rhythm: string;
  words: number;
}

export interface LiveFillerGroup {
  cat: string;
  items: string[];
}

export interface LiveStats {
  segments: number;
  words: number;
  fillWords: number;
  poolWords: number;
  total: number;
  estMinAll: number;
  plannedMinutes: number;
  mins: number;
}

export interface LivePlanResult {
  host: string;
  platforms: string[];
  carries: string[];
  linkWord: string;
  rounds: LiveRound[];
  segments: Array<Pick<LiveSegmentSpec, "no" | "round" | "time" | "mins" | "theme" | "loop">>;
  batches: Array<Pick<LiveBatch, "no" | "round" | "roundName" | "segNos" | "totalMins" | "targetWords">>;
  plannedMinutes: number;
  serviceVersion: string;
}

/** 去掉 [方括号] 舞台提示后的净字数（与 demo `countWords` 一致）。 */
export function countLiveWords(text: string): number {
  return (text ?? "").replace(/\[[^\]]*\]/g, "").replace(/\s/g, "").length;
}

export function liveLinkWord(platforms: string[]): string {
  if (platforms.includes("抖音")) return "小黄车";
  if (platforms.includes("视频号")) return "视频号小店";
  return "购物车";
}

export function liveStats(
  segments: Array<Pick<LiveSegment, "script" | "fill" | "mins">>,
  fillerGroups: LiveFillerGroup[]
): LiveStats {
  const words = segments.reduce((sum, seg) => sum + countLiveWords(seg.script), 0);
  const fillWords = segments.reduce(
    (sum, seg) => sum + (seg.fill ?? []).reduce((inner, item) => inner + countLiveWords(item), 0),
    0
  );
  const poolWords = fillerGroups.reduce(
    (sum, group) => sum + group.items.reduce((inner, item) => inner + countLiveWords(item), 0),
    0
  );
  const mins = segments.reduce((sum, seg) => sum + (Number.isFinite(seg.mins) ? seg.mins : 0), 0);
  return {
    segments: segments.length,
    words,
    fillWords,
    poolWords,
    total: words + fillWords + poolWords,
    estMinAll: Math.round((words + fillWords + poolWords) / LIVE_WORDS_PER_MINUTE),
    plannedMinutes: LIVE_PLANNED_MINUTES,
    mins
  };
}

export function validateLiveInput(input: Partial<LiveInput>): string[] {
  const missing: string[] = [];
  if (!input.host?.trim()) missing.push("店名 / 主播身份");
  if (!input.main?.trim()) missing.push("主打项目 / 产品名");
  if (!input.sell?.trim()) missing.push("真实卖点");
  if (!input.carries?.length) missing.push("带货标的");
  if (!input.platforms?.length) missing.push("平台");
  return missing;
}

export function buildLivePlan(input: LiveInput): LivePlanResult {
  const missing = validateLiveInput(input);
  if (missing.length) throw new Error(`还差必填：${missing.join("、")}`);
  return {
    host: input.host.trim(),
    platforms: input.platforms,
    carries: input.carries,
    linkWord: liveLinkWord(input.platforms),
    rounds: LIVE_ROUNDS,
    segments: LIVE_SEGMENTS.map((seg) => ({ ...seg })),
    batches: LIVE_BATCHES.map((batch) => ({ ...batch })),
    plannedMinutes: LIVE_PLANNED_MINUTES,
    serviceVersion: LIVE_SERVICE_VERSION
  };
}

/**
 * 生成一批段落。规则先给骨架（时间段 / 主题 / 分钟数），模型只负责填内容。
 * 合规硬门禁：违规引导词、绝对化疗效词、价格口径、编造数字；
 * 违规时只重写违规段落（已通过段落原样保留），最后一次机会换写法，仍不过才 fail closed。
 */
export async function generateLiveSegments(
  input: LiveInput,
  batchNo: number,
  provider: RuntimeLlmProvider = createRuntimeLlmProvider()
): Promise<{ batch: LiveBatch; segments: LiveSegment[]; attempts: number; qualityChecks: string[] }> {
  const batch = LIVE_BATCHES.find((item) => item.no === batchNo);
  if (!batch) throw new Error("批次不存在");
  if (!provider.isConfigured()) throw new Error("llm_provider_not_configured");

  const allSpecs = batch.segNos
    .map((no) => LIVE_SEGMENTS.find((seg) => seg.no === no))
    .filter((seg): seg is LiveSegmentSpec => Boolean(seg));
  const linkWord = liveLinkWord(input.platforms);
  const feedback: string[] = [];
  let attempts = 0;
  let lastError = "llm_output_invalid_structure";
  /** 已通过合规门禁的段落：按段号保留首版文本，不再整批推倒重写。 */
  const retained = new Map<number, LiveSegment>();

  while (attempts < MAX_ATTEMPTS) {
    attempts += 1;
    const specs = allSpecs.filter((seg) => !retained.has(seg.no));
    if (!specs.length) break;
    const partialRewrite = attempts > 1;
    const messages = buildLiveBatchPrompt(input, batch, specs, linkWord, feedback, {
      partialRewrite,
      styleSwitch: partialRewrite && attempts >= MAX_ATTEMPTS
    });
    const rawText = await provider.complete(messages, {
      maxTokens: Math.min(Math.round(batch.targetWords * (specs.length / Math.max(allSpecs.length, 1)) * 2.2) + 1200, 8000),
      reasoningProfile: "standard",
      thinkingMode: "disabled"
    });
    const parsed = parseLiveBatchPayload(rawText, specs);
    if (!parsed.ok) {
      lastError = parsed.reason;
      feedback.length = 0;
      feedback.push(parsed.reason);
      continue;
    }

    const violatingSegments: number[] = [];
    const violationLabels = new Set<string>();
    for (const seg of parsed.segments) {
      const labels = collectLiveSegmentViolations(seg, input);
      if (labels.length) {
        violatingSegments.push(seg.no);
        for (const label of labels) violationLabels.add(label);
      } else {
        retained.set(seg.no, seg);
      }
    }
    if (violatingSegments.length) {
      lastError = `生成内容未通过合规门禁：${[...violationLabels].join("、")}`;
      feedback.length = 0;
      feedback.push(
        `上一版第 ${violatingSegments.join("、")} 段出现了这些问题，必须全部改掉（逐字删掉这些字样，不要换近义词保留）：${[...violationLabels].join("、")}。` +
          `需要引导下单时统一说「${linkWord}」；价格一律带「参考」二字；不要写任何效果承诺。`
      );
      if (attempts >= MAX_ATTEMPTS) {
        feedback.push("这一次请完全换一种写法重新写这些段落（换句式、换开场、换举例角度都可以），不要沿用上一版措辞。");
      }
      continue;
    }

    const segments = allSpecs.map((spec) => {
      const kept = retained.get(spec.no);
      if (!kept) throw new Error(`第 ${spec.no} 段缺失，无法合并批次结果`);
      return { ...kept, words: countLiveWords(kept.script) };
    });
    return {
      batch,
      segments,
      attempts,
      qualityChecks: ["违规引导词", "绝对化疗效词", "价格口径", "编造数字"]
    };
  }

  throw new Error(lastError);
}

/** 生成救场话术库（5 类 × 6 条）。 */
export async function generateLiveFiller(
  input: LiveInput,
  provider: RuntimeLlmProvider = createRuntimeLlmProvider()
): Promise<{ groups: LiveFillerGroup[]; attempts: number }> {
  if (!provider.isConfigured()) throw new Error("llm_provider_not_configured");
  const linkWord = liveLinkWord(input.platforms);
  const feedback: string[] = [];
  let attempts = 0;
  let lastError = "llm_output_invalid_structure";

  while (attempts < MAX_ATTEMPTS) {
    attempts += 1;
    const rawText = await provider.complete(buildLiveFillerPrompt(input, linkWord, feedback), {
      maxTokens: 6000,
      reasoningProfile: "standard",
      thinkingMode: "disabled"
    });
    const parsed = parseLiveFillerPayload(rawText);
    if (!parsed.ok) {
      lastError = parsed.reason;
      feedback.length = 0;
      feedback.push(parsed.reason);
      continue;
    }
    const violations = collectLiveViolations(
      parsed.groups.flatMap((group) => group.items.map((item) => ({ script: item }))),
      input
    );
    if (violations.length) {
      lastError = `生成内容未通过合规门禁：${violations.join("、")}`;
      feedback.length = 0;
      feedback.push(
        `上一版出现了这些问题，必须全部改掉（逐字删掉这些字样，不要换近义词保留）：${violations.join("、")}。` +
          `需要引导下单时统一说「${linkWord}」；价格一律带「参考」二字；不要写任何效果承诺。`
      );
      continue;
    }
    return { groups: parsed.groups, attempts };
  }

  throw new Error(lastError);
}

function buildLiveBatchPrompt(
  input: LiveInput,
  batch: LiveBatch,
  specs: LiveSegmentSpec[],
  linkWord: string,
  feedback: string[],
  options: { partialRewrite?: boolean; styleSwitch?: boolean } = {}
): Array<{ role: "system" | "user"; content: string }> {
  const round = LIVE_ROUNDS.find((item) => item.no === batch.round);
  const segmentLines = specs
    .map(
      (seg) =>
        `- 第 ${seg.no} 段｜${seg.time}｜${seg.mins} 分钟｜主题：${seg.theme}｜口播目标 ${seg.mins * LIVE_WORDS_PER_MINUTE} 字`
    )
    .join("\n");

  const system = [
    "你是美业生活美容门店的直播话术编剧，为「主播一个人对着镜头讲 2 小时」写逐字稿。",
    "硬性要求：",
    "- 只用我给你的门店真实信息（店名/主播身份、主打项目、真实卖点、价格机制、会员卡项）。没给的不要编，不要出现任何占位符、方括号占位、示例数字。",
    "- 禁止编造：具体数字、效果承诺、客人姓名、门店事实。客人案例只能写成「我店里有位客人」这种不带姓名不带具体数字的泛化描述，或完全不写。",
    "- 禁止医疗功效承诺与绝对化词：治疗、根治、七天见效、永久、最好、排名宣称（全城第一／销量第一／第一品牌）、顶级、100%、特效、治愈、药用、祛除；序数用法（第一次、第一周、第一部分）正常，不算违规。",
    `- 禁止违规引导词：私信、打电话、加我、找我、留个、扫码、进群、加微信。引导下单统一说「${linkWord}」。`,
    "- 价格一律带上「参考」二字再报数字，例如「参考价 99」。",
    "- 只写主播单人能做的动作：说话、展示产品、念评论、喝水、靠近镜头。不要写场控、助播、运营动作、上链接倒计时这类需要别人配合的事。",
    "- script 里需要停顿或语气提示时，用半角方括号包住，例如 [停顿]、[拿起产品]。",
    "- 口语化、短句、有代入感，像真人说话，不要书面语，不要列条目。",
    "- 注意：2 小时内观众会换 3-4 波，所以本段要照顾刚进来的人，必要时用一句话复述前面讲过的核心。",
    `只输出 JSON：{"segments":[{"no":段号,"script":"主播口播稿","fill":["备用话术1","备用话术2","备用话术3"],"interact":"互动动作","rhythm":"主播节奏提示"}]}`,
    "segments 必须按我给到的段号逐个给出，不要增删段落，不要输出 JSON 以外的任何文字。"
  ].join("\n");

  const user = [
    `门店 / 主播：${input.host}`,
    `带货标的：${input.carries.join(" / ")}`,
    `主打项目 / 产品：${input.main}`,
    `真实卖点：${input.sell}`,
    input.price?.trim() ? `价格机制：${input.price}` : "价格机制：（未提供，禁止编造价格）",
    input.card?.trim() ? `会员卡项权益与价：${input.card}` : "会员卡项权益与价：（未提供，禁止编造）",
    `平台：${input.platforms.join(" / ")}`,
    "",
    `当前轮次：${round?.name ?? ""}（${round?.time ?? ""}，目标：${round?.goal ?? ""}）`,
    options.partialRewrite
      ? "现在只需要重写以下段落（其他段落已经通过门禁，输出里只包含这些段，不要重复其他段）："
      : "本批要写的段落：",
    segmentLines,
    "",
    ...(options.styleSwitch
      ? ["这次请完全换一种写法重新写这些段落（换句式、换开场、换举例角度都可以），不要沿用上一版措辞。"]
      : []),
    "每段要求：",
    "- script：按口播目标字数写够（±15%），这是能不能撑满 2 小时的关键；宁可写满不要写短。",
    `- fill：3 条备用话术，每条 60～90 字。用途是本段讲完但时间还没到时接着念，所以要和 script 换着说法讲，不要重复 script 原句。`,
    "- interact：一句话，让观众在评论区打个字或扣个数字，同时给主播留出喘气时间。",
    "- rhythm：一句话，告诉主播这段该快该慢、什么时候停下来看评论、什么时候喝水。",
    feedback.length ? `\n必须修正的问题：${feedback.join("；")}` : ""
  ]
    .filter(Boolean)
    .join("\n");

  return [
    { role: "system", content: system },
    { role: "user", content: user }
  ];
}

function buildLiveFillerPrompt(
  input: LiveInput,
  linkWord: string,
  feedback: string[]
): Array<{ role: "system" | "user"; content: string }> {
  const system = [
    "你是美业生活美容门店的直播话术编剧。现在写一份「通用救场话术库」，给主播一个人直播时填冷场用。",
    `- 分成 ${LIVE_FILLER_CATEGORIES.length} 类，每类 ${LIVE_FILLER_PER_CATEGORY} 条，每条 60～110 字，口语化。`,
    `- 类别固定为：${LIVE_FILLER_CATEGORIES.join("；")}。`,
    "- 每条都要能单独拿出来直接念，不依赖上下文。",
    "- 只用我给的店铺真实信息，禁止编造数字、案例、效果；客人只能用「有位客人」这类泛化说法。",
    "- 禁止医疗功效承诺与绝对化词：治疗、根治、七天见效、永久、最好、排名宣称（全城第一／销量第一／第一品牌）、顶级、100%、特效、治愈、药用、祛除；序数用法（第一次、第一周、第一部分）正常，不算违规。",
    `- 禁止违规引导词：私信、打电话、加我、找我、留个、扫码、进群、加微信。引导下单统一说「${linkWord}」。`,
    "- 价格一律带「参考」二字。",
    `只输出 JSON：{"groups":[{"cat":"类别名","items":["第1条","第2条"]}]}，groups 必须正好 ${LIVE_FILLER_CATEGORIES.length} 组，顺序与类别顺序一致，不要输出 JSON 以外的文字。`
  ].join("\n");

  const user = [
    `门店 / 主播：${input.host}`,
    `带货标的：${input.carries.join(" / ")}`,
    `主打项目 / 产品：${input.main}`,
    `真实卖点：${input.sell}`,
    `平台：${input.platforms.join(" / ")}`,
    feedback.length ? `\n必须修正的问题：${feedback.join("；")}` : ""
  ]
    .filter(Boolean)
    .join("\n");

  return [
    { role: "system", content: system },
    { role: "user", content: user }
  ];
}

function parseJsonBlock(text: string): unknown {
  const fenced = text.match(/```json\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

function parseLiveBatchPayload(
  text: string,
  specs: LiveSegmentSpec[]
):
  | { ok: true; segments: LiveSegment[] }
  | { ok: false; reason: string } {
  const raw = parseJsonBlock(text);
  if (!raw || typeof raw !== "object") return { ok: false, reason: "模型输出不是合法 JSON，请重新输出" };
  const list = (raw as { segments?: unknown }).segments;
  if (!Array.isArray(list)) return { ok: false, reason: "模型输出缺少 segments 数组，请重新输出" };

  const segments: LiveSegment[] = [];
  for (const spec of specs) {
    const hit = list.find((item) => Number((item as { no?: unknown })?.no) === spec.no);
    if (!hit || typeof hit !== "object") return { ok: false, reason: `模型漏写了第 ${spec.no} 段，请补齐全部段落` };
    const script = typeof (hit as { script?: unknown }).script === "string" ? (hit as { script: string }).script.trim() : "";
    if (!script) return { ok: false, reason: `第 ${spec.no} 段的口播稿是空的，请重新输出` };
    const fillRaw = (hit as { fill?: unknown }).fill;
    const fill = Array.isArray(fillRaw)
      ? fillRaw.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim())
      : [];
    const interact = typeof (hit as { interact?: unknown }).interact === "string" ? (hit as { interact: string }).interact.trim() : "";
    const rhythm = typeof (hit as { rhythm?: unknown }).rhythm === "string" ? (hit as { rhythm: string }).rhythm.trim() : "";
    if (!interact || !rhythm) return { ok: false, reason: `第 ${spec.no} 段缺少互动动作或节奏提示，请补齐` };
    if (fill.length < 3) return { ok: false, reason: `第 ${spec.no} 段的备用话术不足 3 条，请补齐` };
    segments.push({
      no: spec.no,
      round: spec.round,
      time: spec.time,
      mins: spec.mins,
      theme: spec.theme,
      loop: spec.loop,
      script,
      fill: fill.slice(0, 3),
      interact,
      rhythm,
      words: countLiveWords(script) + fill.slice(0, 3).reduce((sum, item) => sum + countLiveWords(item), 0)
    });
  }
  return { ok: true, segments };
}

function parseLiveFillerPayload(
  text: string
): { ok: true; groups: LiveFillerGroup[] } | { ok: false; reason: string } {
  const raw = parseJsonBlock(text);
  if (!raw || typeof raw !== "object") return { ok: false, reason: "模型输出不是合法 JSON，请重新输出" };
  const list = (raw as { groups?: unknown }).groups;
  if (!Array.isArray(list)) return { ok: false, reason: "模型输出缺少 groups 数组，请重新输出" };
  const groups: LiveFillerGroup[] = [];
  for (const cat of LIVE_FILLER_CATEGORIES) {
    const hit = list.find((item) => typeof (item as { cat?: unknown })?.cat === "string" && (item as { cat: string }).cat.includes(cat.split("（")[0]));
    if (!hit) return { ok: false, reason: `救场库缺少「${cat}」这一类，请按给定类别重新输出` };
    const itemsRaw = (hit as { items?: unknown }).items;
    const items = Array.isArray(itemsRaw)
      ? itemsRaw.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim())
      : [];
    if (items.length < LIVE_FILLER_PER_CATEGORY) {
      return { ok: false, reason: `「${cat}」不足 ${LIVE_FILLER_PER_CATEGORY} 条，请补齐` };
    }
    groups.push({ cat, items: items.slice(0, LIVE_FILLER_PER_CATEGORY) });
  }
  return { ok: true, groups };
}

type ViolationCandidate = Pick<LiveSegment, "script"> & Partial<Pick<LiveSegment, "no" | "fill" | "interact" | "rhythm">>;

/** 单段合规与编造检查：命中的问题回灌模型只重写该段；仍不过则 fail closed。 */
function collectLiveSegmentViolations(seg: ViolationCandidate, input: LiveInput): string[] {
  const text = [seg.script, ...(seg.fill ?? []), seg.interact, seg.rhythm].filter(Boolean).join("\n");
  const violations = new Set<string>();

  const ban = containsBanWords(text);
  if (ban.length) violations.add(`违规引导词（${ban.map((item) => item.word).join("、")}）`);
  const abs = containsAbsWords(text);
  if (abs.length) violations.add(`绝对化/疗效词（${abs.map((item) => item.word).join("、")}）`);

  // 只给过「未提供价格」的输入里出现阿拉伯数字价格，视为编造。
  const providedNumbers = `${input.price ?? ""}${input.card ?? ""}`.replace(/[^\d]/g, "");
  const moneyPattern = /(?:参考价|原价|团购价|价格|只要|仅需|现价|售)\s*[¥￥]?\s*(\d+(?:\.\d+)?)/g;
  let match: RegExpExecArray | null;
  while ((match = moneyPattern.exec(text))) {
    const digits = match[1].replace(/\D/g, "");
    if (!digits || providedNumbers.includes(digits)) continue;
    violations.add(`编造价格（${match[0].trim()}）`);
  }

  // 空口承诺疗效的句式
  const promise = containsPromiseClaims(text);
  if (promise.length) violations.add(`效果承诺（${promise.map((item) => item.word).join("、")}）`);

  // 长句堆砌会念不动：单句超过 90 字直接判不合格
  const longSentence = splitSentences(seg.script ?? "").find((sentence) => sentence.replace(/\s/g, "").length > 90);
  if (longSentence) {
    violations.add(seg.no ? `第 ${seg.no} 段有句子超过 90 字，主播念不动` : "有句子超过 90 字，主播念不动");
  }

  return [...violations];
}

/** 整批口径的合规检查（救场话术库沿用，按单段聚合，顺序稳定）。 */
function collectLiveViolations(segments: ViolationCandidate[], input: LiveInput): string[] {
  const labels = new Set<string>();
  for (const seg of segments) {
    for (const label of collectLiveSegmentViolations(seg, input)) labels.add(label);
  }
  return [...labels];
}

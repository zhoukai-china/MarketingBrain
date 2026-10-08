// 兰琪「视频获客 · 一键成片」（原「文案转片」）第 1–2 步：
//   门店老板写不出文案（这是做视频最大卡点）→ 先「说需求」，由后端大模型写 3 版候选文案，
//   选定一版后直接进分镜脚本。
//
// 口径来源：`2026-09-12-视频获客一期最终范围-Codex交接.md`
//   · 固定返回 3 版，风格故意不同；第 1 版 = 用户选的风格（标「按你选的风格」）；
//   · 「换一批」= 重新调用，保留所选风格那版在最前，只轮换另外两版；
//   · 本期**没有「手动贴文案」入口**，生成失败只能「换一批」或退回第 1 步补信息；
//   · 文案必须由后端大模型生成（前端不做模板拼装），原型 `mockCopy()` 只是演示。
//
// 确定性门禁（可被冒烟完整覆盖，不依赖模型随机性）：
//   · 需求为空 / 超长 / 含违规引导词 → 拒绝；不可能靠模型输出蒙混过关；
//   · 模型输出必须四种风格齐全且每版 hook/body/cta 完整，否则 `llm_output_invalid_structure`；
//   · 字数与预估时长**由后端按文本计算**，不取模型自报值；
//   · 出现需求与卖点里没有的数字 → 记 `warnings`，提示门店发布前核对（不静默放行）。
import { createRuntimeLlmProvider } from "../../services/llm-provider-factory.js";
import type { LlmMessage } from "@baolu/agent";
import { containsAbsWords, containsBanWords } from "./moments-rules.js";

export const VIDEO_COPY_SERVICE_VERSION = "video_copy_service_v1";

export const VIDEO_COPY_STYLES = [
  { k: "hook", n: "痛点钩子", d: "前 3 秒戳痛点，转化最猛" },
  { k: "story", n: "故事信任", d: "老板亲述，适合 IP 号" },
  { k: "dry", n: "干货科普", d: "讲知识，涨粉收藏" },
  { k: "promo", n: "促销活动", d: "限时钩子，拉到店" }
] as const;
export type VideoCopyStyle = (typeof VIDEO_COPY_STYLES)[number]["k"];

export const VIDEO_COPY_DURS = [15, 30, 45] as const;
export type VideoCopyDur = (typeof VIDEO_COPY_DURS)[number];

export const VIDEO_COPY_PLATFORMS = [
  { k: "all", n: "抖音+视频号" },
  { k: "dy", n: "抖音" },
  { k: "sph", n: "视频号" }
] as const;
export type VideoCopyPlatform = (typeof VIDEO_COPY_PLATFORMS)[number]["k"];

/** 固定出 3 版，避免选择过载；模型侧仍要 4 种风格齐全，再按「用户选的风格 + 轮换」取 3 版。 */
export const VIDEO_COPY_CANDIDATE_COUNT = 3;
export const VIDEO_COPY_NEED_MAX = 120;
export const VIDEO_COPY_SELL_MAX = 120;
export const VIDEO_COPY_MIN_CHARS = 30;
/** 口播语速 ≈ 4.5 字/秒（原型口径）。 */
export const VIDEO_COPY_CHARS_PER_SECOND = 4.5;

const PLACEHOLDER_NEED = "（示例）推广祛痘产品";

export interface VideoCopyBrief {
  storeId: string;
  need: string;
  cat: string;
  style: VideoCopyStyle;
  dur: VideoCopyDur;
  sell: string;
  plat: VideoCopyPlatform;
  /** 「换一批」次数：只轮换后面两版，用户选的风格那版始终在最前。 */
  round: number;
}

export interface RawVideoCopyCandidate {
  style: VideoCopyStyle;
  title: string;
  hook: string;
  body: string;
  cta: string;
}

export interface VideoCopyCandidate extends RawVideoCopyCandidate {
  id: string;
  styleLabel: string;
  /** 去空白字数（后端计算）。 */
  chars: number;
  /** 预估口播秒数（后端计算）。 */
  durEst: number;
  /** 是否 = 用户选的风格（该版固定排第 1）。 */
  chosen: boolean;
  fullText: string;
}

export interface VideoCopyResult {
  brief: Omit<VideoCopyBrief, "storeId">;
  styleLabel: string;
  candidates: VideoCopyCandidate[];
  warnings: string[];
  traceId: string;
}

export type VideoCopyBriefValidation = { ok: true; brief: VideoCopyBrief } | { ok: false; message: string };

function isStyle(value: unknown): value is VideoCopyStyle {
  return VIDEO_COPY_STYLES.some(style => style.k === value);
}

function isDur(value: unknown): value is VideoCopyDur {
  return VIDEO_COPY_DURS.some(dur => dur === value);
}

function isPlatform(value: unknown): value is VideoCopyPlatform {
  return VIDEO_COPY_PLATFORMS.some(platform => platform.k === value);
}

export function styleLabel(style: VideoCopyStyle): string {
  return VIDEO_COPY_STYLES.find(item => item.k === style)?.n ?? style;
}

function clean(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

export function estimateDuration(chars: number): number {
  return Math.max(15, Math.round(chars / VIDEO_COPY_CHARS_PER_SECOND));
}

/** 需求门禁：一句话需求必填、长度有界、不含违规引导词 —— 不合法就不调模型。 */
export function validateVideoCopyBrief(raw: unknown): VideoCopyBriefValidation {
  const input = (raw ?? {}) as Record<string, unknown>;
  const storeId = clean(input.storeId, 64);
  if (!storeId) return { ok: false, message: "缺少门店标识 store_id" };
  const need = clean(input.need, VIDEO_COPY_NEED_MAX + 1);
  if (!need) return { ok: false, message: "请先用一句话说清这条视频要推广什么" };
  if (need.length > VIDEO_COPY_NEED_MAX) {
    return { ok: false, message: `需求太长（${need.length} 字），请压到 ${VIDEO_COPY_NEED_MAX} 字以内，说清推广什么就行` };
  }
  const banned = containsBanWords(need);
  if (banned.length) {
    return { ok: false, message: `需求里有违规引导词：${banned.map(item => item.word).join("、")}，请换一种说法` };
  }
  const sell = clean(input.sell, VIDEO_COPY_SELL_MAX + 1);
  if (sell.length > VIDEO_COPY_SELL_MAX) {
    return { ok: false, message: `卖点太长（${sell.length} 字），请压到 ${VIDEO_COPY_SELL_MAX} 字以内` };
  }
  return {
    ok: true,
    brief: {
      storeId,
      need,
      cat: clean(input.cat, 32) || "skin",
      style: isStyle(input.style) ? input.style : "hook",
      dur: isDur(input.dur) ? input.dur : 30,
      sell,
      plat: isPlatform(input.plat) ? input.plat : "all",
      round: Number.isFinite(Number(input.round)) ? Math.min(Math.max(Math.floor(Number(input.round)), 0), 99) : 0
    }
  };
}

function fullTextOf(candidate: RawVideoCopyCandidate): string {
  return `${candidate.hook}${candidate.body}${candidate.cta}`.trim();
}

/**
 * 候选挑选（确定性核心，单独可测）：
 * ① 用户选的风格那版固定排第 1 并标 `chosen`；② 其余按 `round` 轮换；③ 永远只出 3 版。
 */
export function pickVideoCopyCandidates(
  all: readonly RawVideoCopyCandidate[],
  brief: Pick<VideoCopyBrief, "style" | "round">,
  options: { allowMissingStyles?: boolean } = {}
): VideoCopyCandidate[] {
  const chosen = all.find(item => item.style === brief.style);
  if (!chosen) throw new Error("llm_output_invalid_structure");
  if (!options.allowMissingStyles) {
    const missing = VIDEO_COPY_STYLES.filter(style => !all.some(item => item.style === style.k));
    if (missing.length) throw new Error("llm_output_invalid_structure");
  }
  const others = all.filter(item => item !== chosen);
  const rotate = others.length ? brief.round % others.length : 0;
  const rotated = others.slice(rotate).concat(others.slice(0, rotate));
  return [chosen, ...rotated].slice(0, VIDEO_COPY_CANDIDATE_COUNT).map((candidate, index) => {
    const fullText = fullTextOf(candidate);
    const chars = fullText.replace(/\s/g, "").length;
    return {
      ...candidate,
      id: `copy-${brief.round}-${index + 1}-${candidate.style}`,
      styleLabel: styleLabel(candidate.style),
      chars,
      durEst: estimateDuration(chars),
      chosen: index === 0,
      fullText
    };
  });
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toRawCandidate(value: unknown): RawVideoCopyCandidate | null {
  const item = (value ?? {}) as Record<string, unknown>;
  if (!isStyle(item.style)) return null;
  const hook = str(item.hook);
  const body = str(item.body);
  const cta = str(item.cta);
  if (!hook || !body || !cta) return null;
  const title = str(item.title) || styleLabel(item.style);
  return { style: item.style, title: title.slice(0, 40), hook, body, cta };
}

function parseJson(text: string): any | null {
  const trimmed = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** 解析模型输出 → 校验四种风格齐全 → 抽取 3 版（含违规词与结构门禁）。 */
export function parseVideoCopyCandidates(rawText: string, brief: Pick<VideoCopyBrief, "style" | "round">): VideoCopyCandidate[] {
  const parsed = parseJson(rawText);
  if (!parsed) throw new Error("llm_output_invalid_structure");
  const list = Array.isArray(parsed.candidates) ? parsed.candidates : [];
  const mapped = list.map(toRawCandidate).filter((item: RawVideoCopyCandidate | null): item is RawVideoCopyCandidate => Boolean(item));
  if (mapped.length < VIDEO_COPY_STYLES.length) throw new Error("llm_output_invalid_structure");

  const candidates = pickVideoCopyCandidates(mapped, brief);
  for (const candidate of candidates) {
    if (candidate.chars < VIDEO_COPY_MIN_CHARS) throw new Error("llm_output_invalid_structure");
    const banned = containsBanWords(candidate.fullText);
    if (banned.length) throw new Error(`生成文案包含违规引导词：${banned.map(item => item.word).join("、")}，已拦截`);
  }
  return candidates;
}

/** 文案里出现需求与卖点都没有的数字 → 提示门店核对（不编造门店事实）。 */
export function collectFactWarnings(candidates: readonly VideoCopyCandidate[], brief: Pick<VideoCopyBrief, "need" | "sell">): string[] {
  const known = `${brief.need} ${brief.sell}`;
  const seen = new Set<string>();
  const hits: string[] = [];
  for (const candidate of candidates) {
    for (const match of candidate.fullText.matchAll(/\d+(?:\.\d+)?/g)) {
      const value = match[0];
      if (known.includes(value) || seen.has(value)) continue;
      seen.add(value);
      hits.push(value);
    }
  }
  return hits.length ? [`文案里出现了你需求里没提过的数字（${hits.slice(0, 5).join("、")}），发布前请核对是否属实。`] : [];
}

function buildMessages(brief: VideoCopyBrief): LlmMessage[] {
  const styleLines = VIDEO_COPY_STYLES.map(style => `- ${style.k}（${style.n}）：${style.d}`).join("\n");
  const system = [
    "你是美业门店老板的视频口播文案写手，写的是要发在抖音 / 视频号上的短视频口播稿。",
    "硬要求：",
    "1. 只使用用户给的需求与卖点，禁止编造门店名、城市、价格、销量、疗效、年限、案例、专家身份或任何承诺。",
    "2. 禁止违规引导词（加微信 / 私聊 / 包治 / 根治 / 最有效 之类），禁止绝对化与医疗承诺。",
    "3. 口播，说人话，短句，一版 30 秒约 130 字左右；不要出现「大家好我是」这种套话。",
    "4. 只输出 JSON，不要解释、不要 Markdown。"
  ].join("\n");
  const user = [
    `门店需求：${brief.need}`,
    brief.sell ? `主打卖点：${brief.sell}` : "主打卖点：（用户没填，不要自己编）",
    `目标时长：约 ${brief.dur} 秒（口播约 ${Math.round(brief.dur * VIDEO_COPY_CHARS_PER_SECOND)} 字）`,
    `投放平台：${brief.plat === "all" ? "抖音 + 视频号" : brief.plat === "dy" ? "抖音" : "视频号"}`,
    "",
    "请按下面 4 种风格各写 1 版，风格要真的不一样：",
    styleLines,
    "",
    '输出格式：{"candidates":[{"style":"hook","title":"这版的卖点一句话","hook":"前三句钩子","body":"主体","cta":"结尾引导"}, ...其他三种风格]}'
  ].join("\n");
  return [
    { role: "system", content: system },
    { role: "user", content: user }
  ];
}

export async function generateVideoCopyCandidates(brief: VideoCopyBrief): Promise<VideoCopyResult> {
  const provider = createRuntimeLlmProvider();
  if (!provider.isConfigured()) throw new Error("llm_provider_not_configured");
  const rawText = await provider.complete(buildMessages(brief), {
    maxTokens: 2600,
    reasoningProfile: "standard",
    thinkingMode: "disabled"
  });
  const candidates = parseVideoCopyCandidates(rawText, brief);
  const absHits = candidates.flatMap(candidate => containsAbsWords(candidate.fullText));
  const warnings = collectFactWarnings(candidates, brief);
  if (absHits.length) warnings.push(`文案含绝对化 / 医疗承诺限流词（${absHits.slice(0, 3).map(item => item.word).join("、")}），发布前请改掉。`);
  const { storeId: _storeId, ...briefOut } = brief;
  return {
    brief: briefOut,
    styleLabel: styleLabel(brief.style),
    candidates,
    warnings,
    traceId: `video-copy:${VIDEO_COPY_SERVICE_VERSION}:${Date.now()}`
  };
}

/** 冒烟用：给一个不依赖模型的可复现输入。 */
export const VIDEO_COPY_EXAMPLE_NEED = PLACEHOLDER_NEED;

// ────────────────── 自建分镜 · 单镜 AI 文案（2026-10-07） ──────────────────
//
// 新流程口径（用户 2026-10-07 拍板）：门店自建分镜后，每一镜的口播文本可以单独让 AI 写——
// 选题（选填）+ 时长（5 / 10 / 15 秒）+ 文案风格（复用整片那 4 种）→ 写出**一句**可直接口播的台词。

/** 单镜 AI 文案可选时长（秒）。整片是 15/30/45，单镜更短；与视频模型单次生成区间对齐。 */
export const SHOT_COPY_DURS = [5, 10, 15] as const;
export type ShotCopyDur = (typeof SHOT_COPY_DURS)[number];

export interface ShotCopyInput {
  /** 选题（选填）：这一镜想讲什么；不填就按门店口播的通用风格写 */
  topic?: string;
  seconds?: number;
  styleKey?: string;
}

export interface ShotCopyResult {
  text: string;
  seconds: ShotCopyDur;
  chars: number;
  style: { k: VideoCopyStyle; n: string };
  /** 非阻断提示：字数明显超时长 / 含限流词（与整片候选文案同口径，只提醒不改写）。 */
  warnings: string[];
}

function parseJsonLooseShotCopy(text: string): any | null {
  const trimmed = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** 单镜 AI 文案：一句可直接口播的台词（后端大模型真写，失败显式报错不出半成品）。 */
export async function generateShotCopy(input: ShotCopyInput): Promise<ShotCopyResult> {
  const provider = createRuntimeLlmProvider();
  if (!provider.isConfigured()) throw new Error("llm_provider_not_configured");
  const seconds = (SHOT_COPY_DURS as readonly number[]).includes(Number(input.seconds))
    ? (Number(input.seconds) as ShotCopyDur)
    : 10;
  const styleKey = (VIDEO_COPY_STYLES.find(item => item.k === input.styleKey)?.k ?? "hook") as VideoCopyStyle;
  const style = VIDEO_COPY_STYLES.find(item => item.k === styleKey)!;
  const topic = String(input.topic ?? "").trim().slice(0, 100);
  const targetChars = Math.round(seconds * VIDEO_COPY_CHARS_PER_SECOND);

  const system = [
    "你是门店短视频口播文案写手。现在为一条分镜写**一句**可直接念出来的口播台词。",
    "硬要求：",
    "1. 只写这一镜的台词，口语化、第一人称、说完就能接下一镜；不要标题、不要分点、不要旁白说明。",
    "2. 字数贴着目标来（±20%），别写成整片文案。",
    "3. 禁止编造门店名、价格、销量、疗效；禁止绝对化与医疗承诺限流词。",
    "4. 只输出 JSON，不要解释、不要 Markdown。"
  ].join("\n");
  const user = [
    topic ? `这一镜的选题：${topic}` : "这一镜的选题：（没给，按门店宣传口播的通用路子写，比如欢迎到店、讲体验、留印象）",
    `时长：约 ${seconds} 秒（约 ${targetChars} 字）`,
    `文案风格：${style.n}——${style.d}`,
    '输出格式：{"text":"这一镜的口播台词"}'
  ].join("\n");

  const opts = { maxTokens: 600, reasoningProfile: "standard" as const, thinkingMode: "disabled" as const };
  const parseText = (raw: string): string => {
    const parsed = parseJsonLooseShotCopy(raw);
    const text = typeof parsed?.text === "string" ? parsed.text.trim() : "";
    return text.replace(/\s+/g, "");
  };

  let text = parseText(await provider.complete(
    [
      { role: "system", content: system },
      { role: "user", content: user }
    ],
    opts
  ));
  // 一轮带批评的重试：字数飘了就按目标重写一次，仍不合格才报错（不静默放行）。
  if (!text || text.length < 8 || text.length > targetChars * 1.9) {
    const complaint = !text
      ? "你刚才那句是空的，不符合要求。"
      : `你刚才那句有 ${text.length} 字，不符合要求。`;
    text = parseText(await provider.complete(
      [
        { role: "system", content: system },
        { role: "user", content: user },
        { role: "user", content: `${complaint}重写一句 ${targetChars} 字左右（±20%）的口播台词，仍然只输出 JSON。` }
      ],
      opts
    ));
  }
  // 结构门禁：一句能念的台词必须有；字数偏差与限流词按整片流程同口径降级为 warnings（不静默丢掉这一镜）。
  const warnings: string[] = [];
  if (!text || text.length < 8) throw new Error("llm_output_invalid_structure");
  if (text.length > targetChars * 2.2) {
    warnings.push(`这句台词 ${text.length} 字，比选的 ${seconds} 秒（约 ${targetChars} 字）长不少，念起来会超时；可以在文本框里删短，或选更长的时长。`);
  }
  const banHits = containsBanWords(text);
  if (banHits.length) {
    warnings.push(`台词含引流限流词（${banHits.slice(0, 3).map(item => item.word).join("、")}），发布前请改掉。`);
  }
  return { text, seconds, chars: text.length, style: { k: styleKey, n: style.n }, warnings };
}

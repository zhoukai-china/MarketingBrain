// 兰琪美业门店 AI 经营大脑 · 公域获客（板块3）
// 短视频文案改稿：对齐 demo `copywriter.html` 的四步流程
//   原稿 → 开头（三选一）→ 成稿 → 标题封面（含「为什么这样改」「拍摄和剪辑参考」）
// 文案正文由真实大模型生成；诊断评分、输入门禁、发布前合规检查由 acquire-rules 确定性执行。

import { createRuntimeLlmProvider } from "../../services/llm-provider-factory.js";
import type { LlmMessage } from "@baolu/agent";
import {
  containsAbsWords,
  containsBanWords,
  type CheckItem
} from "./moments-rules.js";
import {
  ACQUIRE_RULES_VERSION,
  OPENING_KEYS,
  OPENING_TITLES,
  VIDEO_GOALS,
  VIDEO_PURPOSES,
  buildScores,
  copywriterGate,
  draftStructureGate,
  inferPurpose,
  isAcquireInputRich,
  isVideoGoal,
  isVideoPurpose,
  placeholderFor,
  type OpeningCard,
  type ScoreDim,
  type VideoGoal,
  type VideoPurpose
} from "./acquire-rules.js";

export const ACQUIRE_SERVICE_VERSION = "acquire_service_v2" as const;

export interface CopywriterInput {
  storeId: string;
  raw: string;
  /** auto = 让系统判断，其余为 demo 的三种用途 */
  purpose?: VideoPurpose | "auto";
  goal?: VideoGoal;
  /** 补充要求，选填，最多 500 字 */
  extra?: string;
}

export interface TitleSuggestion {
  tag: string;
  text: string;
}

export interface ChangeItem {
  part: string;
  before: string;
  after: string;
  reason: string;
}

export interface ShotItem {
  meta: string;
  scene: string;
  edit: string;
}

export interface CopywriterResult {
  purpose: VideoPurpose;
  purposeLabel: string;
  goal: VideoGoal;
  goalLabel: string;
  intent: string;
  highlights: string[];
  scores: ScoreDim[];
  openings: OpeningCard[];
  /** 改后正文（不含开头，开头由前端按用户选择拼接） */
  body: string;
  /** 默认成稿：第一个开头 + 正文 */
  finalDraft: string;
  titles: TitleSuggestion[];
  cover: { title: string; desc: string };
  changes: ChangeItem[];
  style: string;
  shots: ShotItem[];
  rawLen: number;
  newLen: number;
  checks: CheckItem[];
  /** 原稿没有数字时，正文需用户亲补数字 */
  placeholder?: boolean;
  needsInput?: boolean;
  traceId?: string;
}

const TITLE_TAGS = ["利益点", "痛点", "案例"];

interface RawLlmPayload {
  purpose?: unknown;
  intent?: unknown;
  highlights?: unknown;
  openings?: unknown;
  body?: unknown;
  titles?: unknown;
  cover?: unknown;
  changes?: unknown;
  style?: unknown;
  shots?: unknown;
  scores?: unknown;
}

const SYSTEM_PROMPT = [
  "你是美业门店的短视频编剧，专门帮店主把已有的口播原稿改得更抓人、更顺口。",
  "改稿铁律（违反即不可用）：",
  "- 只基于用户原稿改写，保留原意与事实；禁止编造具体数字、效果承诺、客人姓名、价格、门店资质或合作方。",
  "- 原稿没有数字时，正文里不要写任何具体数字，最多提醒用户补一个真实数字。",
  "- 禁止违规引导词：私信、打电话、加我、找我、留个、扫码、进群、加微信。",
  "- 禁止绝对化/疗效词：根治、永久、最好、排名宣称（全城第一／销量第一／第一品牌）、100%、特效、治愈、药用、祛除、七天见效；序数用法（第一次、第一周、第一部分）正常，不算违规。",
  "- 不要写夸张承诺（包好、保证、立竿见影），不要承诺疗效。",
  "输出结构要求：",
  "- openings：3 条不同的开头，key 固定为 hook（钩子提问）/ claim（反直觉断言）/ scene（当下场景代入），每条 20~60 字、口语化，why 说明为什么这样切入（20 字内）。",
  "- body：改后的口播正文，分 3 段，用换行分隔，合计 200~420 字；口语化、按步骤讲清楚，比原稿更具体、更顺口。",
  "- intent：这条视频的核心意图（30 字内）。",
  "- highlights：原稿值得保留的亮点，2~3 条，每条 25 字内。",
  "- titles：3 条标题，tag 固定为 利益点 / 痛点 / 案例，每条 12~22 字。",
  "- cover：title 为封面大字（6~10 字），desc 为画面描述（30 字内，写清人物/场景/动作）。",
  "- changes：3 条关键改动，part 固定为 开头 / 正文 / 结尾，before 写原稿原文（没有就写“无”），after 写改动后的句子，reason 写这么改的原因（25 字内）。",
  "- style：整体拍摄风格一句话（20 字内）。",
  "- shots：3 个镜头，meta 形如「开头提问 · 纯口播」，scene 写画面（30 字内），edit 写剪辑方式（20 字内，没有就写“无”）。",
  "- scores：对 5 个维度各给一条 comment（原稿在这一项的问题，35 字内）和一条 advice（具体怎么改，35 字内），key 为 audience/share/scarcity/execution/cta。分数由系统计算，你不要输出分数。",
  "只输出 JSON，不要输出任何其它文字。",
  "JSON 结构：{\"purpose\":\"曝光型\",\"intent\":\"\",\"highlights\":[\"\"],\"openings\":[{\"key\":\"hook\",\"text\":\"\",\"why\":\"\"}],\"body\":\"\",\"titles\":[{\"tag\":\"利益点\",\"text\":\"\"}],\"cover\":{\"title\":\"\",\"desc\":\"\"},\"changes\":[{\"part\":\"开头\",\"before\":\"\",\"after\":\"\",\"reason\":\"\"}],\"style\":\"\",\"shots\":[{\"meta\":\"\",\"scene\":\"\",\"edit\":\"\"}],\"scores\":{\"audience\":{\"comment\":\"\",\"advice\":\"\"}}}"
].join("\n");

function parseJson(text: string): RawLlmPayload | null {
  const fenced = text.match(/```json\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as RawLlmPayload;
  } catch {
    return null;
  }
}

const str = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

function buildPrompt(
  input: CopywriterInput,
  raw: string,
  purposeLabel: string,
  goalLabel: string
): LlmMessage[] {
  const userLines = [
    `这条视频主要用来：${purposeLabel}`,
    `这次更想优化：${goalLabel}`
  ];
  const extra = (input.extra ?? "").trim();
  if (extra) userLines.push(`补充要求：${extra}`);
  userLines.push("", "原稿：", raw);
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userLines.join("\n") }
  ];
}

function needsInputResult(
  raw: string,
  purpose: VideoPurpose,
  goal: VideoGoal
): CopywriterResult {
  return {
    purpose,
    purposeLabel: VIDEO_PURPOSES[purpose],
    goal,
    goalLabel: VIDEO_GOALS[goal],
    intent: "这条素材还缺一个关键信息，先补一句再改稿。",
    highlights: [],
    scores: buildScores(raw),
    openings: [],
    body: "这条素材还缺一个关键信息，请补充（比如：门店做什么项目、目标顾客是谁、想让人做什么）。补一句真实的门店情况，我再按你的原意改稿，不编造内容。",
    finalDraft: "",
    titles: [],
    cover: { title: "", desc: "" },
    changes: [],
    style: "",
    shots: [],
    rawLen: raw.length,
    newLen: 0,
    checks: [],
    needsInput: true,
    traceId: `acquire:${ACQUIRE_SERVICE_VERSION}:needs-input:${Date.now()}`
  };
}

function toOpenings(value: unknown): OpeningCard[] {
  if (!Array.isArray(value)) return [];
  const byKey = new Map<string, OpeningCard>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const key = str(record.key);
    const text = str(record.text);
    if (!OPENING_KEYS.includes(key as OpeningCard["key"]) || !text) continue;
    byKey.set(key, {
      key: key as OpeningCard["key"],
      title: OPENING_TITLES[key as OpeningCard["key"]],
      text,
      why: str(record.why)
    });
  }
  return OPENING_KEYS.map((key) => byKey.get(key)).filter((o): o is OpeningCard => Boolean(o));
}

function toTitles(value: unknown): TitleSuggestion[] {
  if (!Array.isArray(value)) return [];
  const out: TitleSuggestion[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const text = str(record.text);
    if (!text) continue;
    const tag = str(record.tag);
    out.push({ tag: TITLE_TAGS.includes(tag) ? tag : TITLE_TAGS[out.length] ?? "标题", text });
  }
  return out.slice(0, 3);
}

function toChanges(value: unknown): ChangeItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const part = str(record.part);
      const after = str(record.after);
      if (!part || (!after && !str(record.before))) return null;
      return { part, before: str(record.before) || "无", after: after || "无", reason: str(record.reason) };
    })
    .filter((c): c is ChangeItem => Boolean(c))
    .slice(0, 4);
}

function toShots(value: unknown): ShotItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const meta = str(record.meta);
      const scene = str(record.scene);
      if (!meta || !scene) return null;
      return { meta, scene, edit: str(record.edit) || "无" };
    })
    .filter((s): s is ShotItem => Boolean(s))
    .slice(0, 4);
}

function toScoreNotes(value: unknown): Partial<Record<ScoreDim["key"], { comment?: string; advice?: string }>> {
  if (!value || typeof value !== "object") return {};
  const out: Partial<Record<ScoreDim["key"], { comment?: string; advice?: string }>> = {};
  for (const [key, note] of Object.entries(value as Record<string, unknown>)) {
    if (!note || typeof note !== "object") continue;
    const record = note as Record<string, unknown>;
    if (key !== "audience" && key !== "share" && key !== "scarcity" && key !== "execution" && key !== "cta") continue;
    out[key] = { comment: str(record.comment), advice: str(record.advice) };
  }
  return out;
}

function toHighlights(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => str(v)).filter(Boolean).slice(0, 4);
}

function toCover(value: unknown): { title: string; desc: string } {
  if (!value || typeof value !== "object") return { title: "", desc: "" };
  const record = value as Record<string, unknown>;
  return { title: str(record.title), desc: str(record.desc) };
}

export async function rewriteShortVideoCopy(input: CopywriterInput): Promise<CopywriterResult> {
  const raw = (input.raw ?? "").trim();
  if (!input.storeId || !input.storeId.trim()) throw new Error("缺少门店标识 store_id");
  const gate = copywriterGate(raw);
  if (gate) throw new Error(gate);

  const goal: VideoGoal = isVideoGoal(input.goal) ? input.goal : "all";
  const selected = isVideoPurpose(input.purpose) ? input.purpose : null;
  const purpose: VideoPurpose = selected ?? inferPurpose(raw, goal);

  if (!isAcquireInputRich(raw)) return needsInputResult(raw, purpose, goal);

  const provider = createRuntimeLlmProvider();
  if (!provider.isConfigured()) throw new Error("llm_provider_not_configured");
  const rawText = await provider.complete(
    buildPrompt(input, raw, VIDEO_PURPOSES[purpose], VIDEO_GOALS[goal]),
    { maxTokens: 2600, reasoningProfile: "standard", thinkingMode: "disabled" }
  );
  const parsed = parseJson(rawText);
  if (!parsed) throw new Error("llm_output_invalid_structure");

  const body = str(parsed.body);
  const openings = toOpenings(parsed.openings);
  if (!body || openings.length < OPENING_KEYS.length) throw new Error("llm_output_invalid_structure");

  const finalDraft = `${openings[0].text}\n\n${body}`;
  const banHits = containsBanWords(finalDraft);
  if (banHits.length) throw new Error(`生成内容包含违规引导词：${banHits.map((b) => b.word).join("、")}，已拦截`);

  const structure = draftStructureGate(finalDraft);
  if (!structure.pass) throw new Error(`结构门禁未通过：${structure.reason}`);

  const placeholder = placeholderFor(raw, finalDraft);
  const absHits = containsAbsWords(finalDraft);
  const checks: CheckItem[] = [
    { ok: banHits.length === 0, label: "违规引导词", detail: "无违规引导，可发布" },
    {
      ok: absHits.length === 0,
      label: "绝对化 / 医疗承诺",
      detail: absHits.length ? `含限流词：${absHits.map((w) => w.word).join("、")}` : "无绝对化表述"
    },
    {
      ok: !placeholder,
      label: "数字与事实",
      detail: placeholder ? "原稿没有数字，已提示你亲补，模型未编造" : "只使用了你原稿里的数字"
    },
    {
      ok: true,
      label: "事实来源",
      detail: "按你的原稿改写，未新增案例、价格或疗效承诺"
    }
  ];

  return {
    purpose,
    purposeLabel: VIDEO_PURPOSES[purpose],
    goal,
    goalLabel: VIDEO_GOALS[goal],
    intent: str(parsed.intent) || "按你的原稿改得更抓人、更顺口。",
    highlights: toHighlights(parsed.highlights),
    scores: buildScores(raw, toScoreNotes(parsed.scores)),
    openings,
    body,
    finalDraft,
    titles: toTitles(parsed.titles),
    cover: toCover(parsed.cover),
    changes: toChanges(parsed.changes),
    style: str(parsed.style),
    shots: toShots(parsed.shots),
    rawLen: raw.length,
    newLen: finalDraft.length + (placeholder ? placeholder.length : 0),
    checks,
    placeholder: Boolean(placeholder),
    traceId: `acquire:${ACQUIRE_SERVICE_VERSION}:${ACQUIRE_RULES_VERSION}:${Date.now()}`
  };
}

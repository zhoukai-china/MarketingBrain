// 兰琪美业门店 AI 经营大脑 · 私域营销（LQ-18）
// 朋友圈升级服务：编排「校验 → 生成 → 诊断 → 评分 → 发布前检查」。
// 当前 generation 采用受控确定性引擎（沿用 demo 结构、不照抄其 JS 实现）；
// real LLM 作为同一 `generateBody` 接口的另一后端，接入后替换 controlled 分支。

import {
  MOMENTS_RULES_VERSION,
  FAST_GOALS,
  PILLARS,
  diagnosticIssues,
  scoreOf,
  upgradedScore,
  missingRequired,
  fastGate,
  publishCheck,
  structureGate,
  UPGRADE_LEVELS,
  type DiagnosisIssue,
  type CheckItem,
  type FastGoal,
  type Pillar,
  type Tone,
  type UpgradeLevel,
  type MomentFields
} from "./moments-rules.js";
import { createRuntimeLlmProvider } from "../../services/llm-provider-factory.js";
import type { LlmMessage } from "@baolu/agent";

export const MOMENTS_SERVICE_VERSION = "moments_service_v1" as const;
export type MomentsMode = "fast" | "pro";

export interface MomentsUpgradeInput {
  storeId: string;
  mode: MomentsMode;
  goal?: FastGoal;
  tone?: Tone;
  level?: UpgradeLevel;
  keepMine?: boolean;
  raw?: string;
  pillar?: Pillar;
  fields?: MomentFields;
}

export interface MomentUpItem {
  label: string;
  pos: string;
  from: string;
  to: string;
  why: string;
}

export interface MomentsUpgradeResult {
  mode: MomentsMode;
  pillar?: Pillar;
  goal?: FastGoal;
  tone?: Tone;
  level: UpgradeLevel;
  keepMine: boolean;
  raw: string;
  body: string;
  core: string;
  rawLen: number;
  newLen: number;
  rawScore: number;
  newScore: number;
  issues: DiagnosisIssue[];
  ups: MomentUpItem[];
  checks: CheckItem[];
  placeholder: boolean;
  needsInput?: boolean;
  traceId?: string;
}

export type WechatScene =
  | "notice"      // 群公告 / 门店动态
  | "activity"    // 活动通知
  | "qa"          // 客户答疑
  | "reactivate"  // 沉睡唤醒
  | "care";       // 节日 / 关怀

export interface WechatGroupInput {
  storeId: string;
  scene: WechatScene;
  /**
   * 群消息主题。**可选**：老板最自然的填法是把要说的话写进「具体内容」，
   * 主题留空时由 `resolveWechatTopic` 从具体内容里派生，不能让页面因此停摆
   * （2026-09-10 用户报障「微信群营销话术生成不了」的根因之一）。
   */
  topic?: string;
  detail: string;
  tone?: Tone;
}

export interface WechatGroupResult {
  scene: WechatScene;
  tone: Tone;
  title: string;
  body: string;
  rawLen: number;
  newLen: number;
  checks: CheckItem[];
  needsInput?: boolean;
  traceId?: string;
}

const WECHAT_SCENES: Record<WechatScene, { name: string; titlePrefix: string; opening: string; cta: string }> = {
  notice: { name: "群公告 / 门店动态", titlePrefix: "门店动态", opening: "给群里姐妹同步个消息：", cta: "详情可以到店或群里问我，看到就回。" },
  activity: { name: "活动通知", titlePrefix: "活动", opening: "给姐妹们说个活动：", cta: "想参加的姐妹，到店提一句就行。" },
  qa: { name: "客户答疑", titlePrefix: "答疑", opening: "群里问得多的，统一回一下：", cta: "还有疑问的姐妹，到店我当面讲清楚。" },
  reactivate: { name: "沉睡唤醒", titlePrefix: "好久不见", opening: "好久没见你来店里了，想跟你说：", cta: "方便的话，这周到店让我看看，老客有照顾。" },
  care: { name: "节日 / 关怀", titlePrefix: "关怀", opening: "天冷了 / 节日到了，记得照顾好自己：", cta: "店里一直给你留着位置，想来随时到店。" }
};

/**
 * 主题的唯一派生口径：填了就用填的，没填就从「具体内容」里取第一段做标题。
 *
 * 只做截断，不做改写、不加词、不编造——派生的主题只用在这条群消息自己的标题上，
 * 不会变成任何业务数字或事实。
 */
export function resolveWechatTopic(topic: string | undefined, detail: string, scene: WechatScene): string {
  const explicit = (topic ?? "").trim();
  if (explicit) return explicit;
  const firstLine = detail
    .split(/[\n。！？!?；;]/)
    .map((line) => line.trim())
    .find((line) => line.length > 0) ?? "";
  if (firstLine) return firstLine.slice(0, 18);
  return WECHAT_SCENES[scene].name;
}

export function generateWechatGroup(input: WechatGroupInput): WechatGroupResult {
  const scene = WECHAT_SCENES[input.scene];
  const tone = input.tone ?? "亲切大姐";
  const detail = input.detail.trim();
  if (!input.storeId || !input.storeId.trim()) throw new Error("缺少门店标识 store_id");
  if (!detail) throw new Error("请填写具体内容");
  const topic = resolveWechatTopic(input.topic, detail, input.scene);

  const core = `${topic}：${detail}`;
  const body = `${scene.opening}\n${core}\n${scene.cta}`;
  const checks = publishCheck(body, { hasPlaceholder: false });
  if (containsBanWordsLocal(body).length) throw new Error("生成内容包含违规引导词，请改写后重试");

  return {
    scene: input.scene,
    tone,
    title: `【${scene.titlePrefix}】${topic.slice(0, 18)}`,
    body,
    // 字数只算老板真正写进来的字：主题留空时派生主题是「具体内容」的切片，不能重复计数。
    rawLen: rawInputLength(input.topic, detail),
    newLen: body.length,
    checks,
    traceId: `wechat:${MOMENTS_SERVICE_VERSION}:${Date.now()}`
  };
}

/** 改写前字数：老板写了主题就算主题，没写就只算具体内容。 */
function rawInputLength(topic: string | undefined, detail: string): number {
  const explicit = (topic ?? "").trim();
  return explicit ? `${explicit}：${detail}`.length : detail.length;
}

export async function generateWechatGroupLlm(input: WechatGroupInput): Promise<WechatGroupResult> {
  const scene = WECHAT_SCENES[input.scene];
  const tone = input.tone ?? "亲切大姐";
  const detail = input.detail.trim();
  if (!input.storeId || !input.storeId.trim()) throw new Error("缺少门店标识 store_id");
  if (!detail) throw new Error("请填写具体内容");
  const topic = resolveWechatTopic(input.topic, detail, input.scene);

  if (!isInputRich(`${topic} ${detail}`)) {
    return {
      scene: input.scene,
      tone,
      title: "【待补充】这条群消息还缺具体内容",
      body: "这条素材还缺一个关键信息，请补充（比如：什么时间、什么活动/项目、优惠或名额）。",
      rawLen: detail.length,
      newLen: 0,
      checks: [],
      needsInput: true,
      traceId: `wechat:${MOMENTS_SERVICE_VERSION}:llm:needs-input:${Date.now()}`
    };
  }

  const system = [
    `你是美业门店的微信群运营。按「${scene.name}」场景，把店长的话改写成一条能直接发到群里的群消息。`,
    "硬性要求：",
    "- 开场用一句自然的话引出（不要照抄示例开场，按内容自己写）。",
    "- 正文把用户给的主题与内容讲清楚、口语化、分几行，有具体信息（时间/项目/优惠/名额）时用上；输入没有的不要编造。",
    "- 结尾放这句动作（一字不差）：\"" + scene.cta + "\"",
    "- 禁止违规引导词：私信、打电话、加我、找我、留个、扫码、进群、加微信。",
    "- 禁止绝对化/疗效词：根治、永久、最好、排名宣称（全城第一／销量第一／第一品牌）、100%、特效、治愈、药用、祛除、七天见效；序数用法（第一次、第一周、第一部分）正常，不算违规。",
    "只输出 JSON：{\"title\": \"群消息标题\", \"body\": \"群消息全文\"}。不要输出其它文字。"
  ].filter(Boolean).join("\n");
  const provider = createRuntimeLlmProvider();
  if (!provider.isConfigured()) throw new Error("llm_provider_not_configured");
  const rawText = await provider.complete(
    [
      { role: "system", content: system },
      { role: "user", content: `主题：${topic}\n具体内容：${detail}\n口吻：${tone}` }
    ],
    { maxTokens: 1000, reasoningProfile: "standard", thinkingMode: "disabled" }
  );
  const parsed = parseWechatLlmBody(rawText);
  if (!parsed) throw new Error("llm_output_invalid_structure");
  if (containsBanWordsLocal(parsed.body).length) throw new Error("生成内容包含违规引导词，已拦截");

  const body = parsed.body;
  const checks = publishCheck(body, { hasPlaceholder: false });
  return {
    scene: input.scene,
    tone,
    title: parsed.title || `【${scene.titlePrefix}】${topic.slice(0, 18)}`,
    body,
    rawLen: rawInputLength(input.topic, detail),
    newLen: body.length,
    checks,
    traceId: `wechat:${MOMENTS_SERVICE_VERSION}:llm:${Date.now()}`
  };
}

function parseWechatLlmBody(text: string): { title?: string; body: string } | null {
  const fenced = text.match(/```json\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(candidate.slice(start, end + 1)) as { title?: unknown; body?: unknown };
    if (typeof obj.body !== "string" || !obj.body.trim()) return null;
    return { title: typeof obj.title === "string" ? obj.title.trim() : undefined, body: obj.body.trim() };
  } catch {
    return null;
  }
}

function containsBanWordsLocal(text: string): Array<{ word: string }> {
  return ["私信", "打电话", "加我", "找我", "留个", "扫码", "进群", "加微信"]
    .filter((w) => text.includes(w))
    .map((word) => ({ word }));
}

const TONE_PROOF: Record<Tone, string> = {
  亲切大姐: "做了十几年这一行，见过太多皮肤问题，怎么说我按自己店里真实情况来",
  专业院长: "我们是正规店，所有项目都先谈清楚再动手，不搞套路",
  实在老板娘: "我做生意不折腾人，能帮到你的我就说，帮不到的我直说"
};

function splitClean(text: string): string[] {
  return text
    .split(/[。！？!?\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function stripFillers(text: string): string {
  return text.replace(/(嗯|那个|就是|然后|反正|阿|吧)\s*/g, "").trim();
}

// 受控确定性生成：只重组用户的原话/字段，不编造数字、效果、客户姓名。
function buildCore(raw: string, level: UpgradeLevel, keepMine: boolean): string {
  const sents = splitClean(raw);
  if (keepMine) return raw.trim();
  if (level === "deep") {
    // 结果前置法：先说结果（最后一句或含数字句），再说过程
    const last = sents.length ? sents[sents.length - 1] : raw;
    const head = sents.length > 1 ? sents[0] : "";
    return [last, head && last !== head ? `过程：${head}` : "", ...sents.slice(1, -1)].filter(Boolean).join("\n");
  }
  if (level === "std") return stripFillers(raw.trim());
  // light：逐句分行、补句号
  return sents.map((s) => (s.endsWith("。") || s.endsWith("！") || s.endsWith("？") ? s : `${s}。`)).join("\n");
}

function buildBody(
  raw: string,
  opts: { mode: MomentsMode; goal?: FastGoal; pillar?: Pillar; tone?: Tone; level: UpgradeLevel; keepMine: boolean; fields?: MomentFields }
): { body: string; core: string; placeholder: boolean } {
  const core = buildCore(raw, opts.level, opts.keepMine);
  const hasDigit = /\d/.test(core);
  const placeholder = !hasDigit;
  const parts: string[] = [];

  if (opts.mode === "fast" && opts.goal) {
    parts.push(FAST_GOALS[opts.goal].hook);
    parts.push(core);
    if (opts.level !== "light" && opts.tone) parts.push(TONE_PROOF[opts.tone]);
    if (placeholder) parts.push("【待你补一句：具体数字】");
    parts.push(FAST_GOALS[opts.goal].cta);
  } else if (opts.mode === "pro" && opts.pillar) {
    parts.push(core);
    if (placeholder) parts.push("【待你补一句：具体数字】");
    parts.push(PILLARS[opts.pillar].cta);
  } else {
    parts.push(core);
  }

  return { body: parts.filter(Boolean).join("\n"), core, placeholder };
}

export function upgradeMoments(input: MomentsUpgradeInput): MomentsUpgradeResult {
  const mode = input.mode;
  const tone = input.tone ?? "亲切大姐";
  const level = input.level ?? "std";
  const keepMine = input.keepMine ?? false;
  let raw = (input.raw ?? "").trim();

  // 校验
  if (mode === "fast") {
    const gate = fastGate(raw);
    if (gate) throw new Error(gate);
  } else if (mode === "pro") {
    if (!input.pillar) throw new Error("请先选择内容类型（七柱）");
    const missing = missingRequired(input.pillar, input.fields ?? {});
    if (missing.length)
      throw new Error(`还差必填：${missing.map((f) => f.label).join("、")}`);
    // 七柱字段拼成源文案：正文/诊断/评分都基于门店真实输入，不编造
    raw = Object.entries(input.fields ?? {})
      .map(([, value]) => (value ?? "").trim())
      .filter(Boolean)
      .join("。");
    if (!raw) throw new Error("还差必填内容");
  } else {
    throw new Error("未知模式");
  }

  const { body, core, placeholder } = buildBody(raw, {
    mode,
    goal: input.goal,
    pillar: input.pillar,
    tone,
    level,
    keepMine,
    fields: input.fields
  });

  const issues = diagnosticIssues(raw);
  const rawScore = scoreOf(raw, issues);
  const newScore = upgradedScore(rawScore, level);
  const checks = publishCheck(body, { hasPlaceholder: placeholder });
  const gate = structureGate(body, level, input.goal);
  if (!gate.pass) throw new Error(`结构门禁未通过：${gate.reason}`);

  const ups: MomentUpItem[] = [
    { label: "升级强度", pos: "全文", from: UPGRADE_LEVELS[level].name, to: keepMine ? "保留原话" : "已按结构重组", why: UPGRADE_LEVELS[level].desc }
  ];

  return {
    mode,
    pillar: input.pillar,
    goal: input.goal,
    tone,
    level,
    keepMine,
    raw,
    body,
    core,
    rawLen: raw.length,
    newLen: body.length,
    rawScore,
    newScore,
    issues,
    ups,
    checks,
    placeholder,
    traceId: `moment:${MOMENTS_SERVICE_VERSION}:${Date.now()}`
  };
}

export function validateStoreScope(input: MomentsUpgradeInput): void {
  if (!input.storeId || !input.storeId.trim()) throw new Error("缺少门店标识 store_id");
}

// —— 真实大模型生成（开发阶段消耗；服务层同一接口，模型名不进 UI/日志）——

function composeProSource(input: MomentsUpgradeInput): string {
  return Object.entries(input.fields ?? {})
    .map(([, value]) => (value ?? "").trim())
    .filter(Boolean)
    .join("。");
}

// 素材是否「够具体」：只有数字 / 具体服务与症状 / 明确时间+名额或价格 才算够。
// 泛词（活动、优惠、热闹）单独出现不判够，避免大模型编造细节。
const CONCRETE_WORDS = [
  "护理", "清洁", "补水", "保湿", "水光", "面膜", "肩颈", "按摩", "spa", "皮肤",
  "起皮", "干燥", "暗沉", "祛痘", "淡斑", "敏感", "发红", "痘痘", "老客", "新客", "体验客"
];

export function isInputRich(rawText: string): boolean {
  const t = (rawText || "").toLowerCase();
  if (/\d/.test(t)) return true;
  const hasConcrete = CONCRETE_WORDS.some((k) => t.includes(k));
  if (hasConcrete) return true;
  const hasTime = /今天|明天|后天|本周|下周|周[一二三四五六日天]|\d+月|\d+号|上午|下午|晚上|点/.test(t);
  const hasQuotaOrPrice = /名额|限|元|折|价|优惠|特惠|划算|位/.test(t);
  return hasTime && hasQuotaOrPrice;
}

function needsInputResult(input: MomentsUpgradeInput, raw: string): MomentsUpgradeResult {
  return {
    mode: input.mode,
    pillar: input.pillar,
    goal: input.goal,
    tone: input.tone ?? "亲切大姐",
    level: input.level ?? "std",
    keepMine: input.keepMine ?? false,
    raw,
    body: "这条素材还缺一个关键信息，请补充（比如：客人是谁、做了什么项目、结果或价格）。",
    core: "",
    rawLen: raw.length,
    newLen: 0,
    rawScore: 0,
    newScore: 0,
    issues: [],
    ups: [],
    checks: [],
    placeholder: false,
    needsInput: true,
    traceId: `moment:${MOMENTS_SERVICE_VERSION}:needs-input:${Date.now()}`
  };
}

function buildMomentPrompt(input: MomentsUpgradeInput, raw: string): LlmMessage[] {
  const goal = input.goal ? FAST_GOALS[input.goal] : null;
  const pillar = input.pillar ? PILLARS[input.pillar] : null;
  const cta = goal?.cta || pillar?.cta || "";
  const hookLine = input.mode === "fast" && goal ? `开头钩子（按此写）：${goal.hook}` : "";
  const system = [
    "你是美业门店的朋友圈文案编辑。把用户的原话/素材升级成一条能直接发的朋友圈文案。",
    "硬性要求：",
    "- 只基于用户输入改写，禁止编造具体数字、效果、客人姓名、价格或门店事实。",
    "- 结尾必须用这句动作：\"" + cta + "\"（一字不差）。",
    "- 禁止出现违规引导词：私信、打电话、加我、找我、留个、扫码、进群、加微信。",
    "- 禁止绝对化/疗效词：根治、永久、最好、排名宣称（全城第一／销量第一／第一品牌）、100%、特效、治愈、药用、祛除、七天见效；序数用法（第一次、第一周、第一部分）正常，不算违规。",
    "- 开头要有钩子/情景，正文分段，结尾用上面指定动作。",
    hookLine ? "- " + hookLine : "",
    "- 若原文没有任何数字，正文中插入一行占位：\u3010待你补一句：具体数字\u3011（不要编数字）。",
    "- 用户很可能是随手发的零散口语：请从中提炼最有用的门店场景/事实，写得更具体、有代入感，分 3～4 段；不要只是复述原文。",
    "- 如果输入信息太少，实在写不成一条有内容的朋友圈，body 只输出这一句：这条素材还缺一个关键信息，请补充（比如客人是谁、做了什么、结果或价格）。不要编造、不要硬凑。",
    "只输出 JSON：{\"body\": \"最终文案\", \"core\": \"核心正文\"}。body 含钩子+核心+指定结尾动作；core 只含主体内容。不要输出其它文字。"
  ].filter(Boolean).join("\n");
  return [
    { role: "system", content: system },
    { role: "user", content: `门店：${input.fields?.storeName ?? "本店"}\n原话/素材：${raw}` }
  ];
}

export async function upgradeMomentsLlm(input: MomentsUpgradeInput): Promise<MomentsUpgradeResult> {
  const mode = input.mode;
  const tone = input.tone ?? "亲切大姐";
  const level = input.level ?? "std";
  const keepMine = input.keepMine ?? false;
  let raw = (input.raw ?? "").trim();

  if (mode === "fast") {
    const gate = fastGate(raw);
    if (gate) throw new Error(gate);
  } else if (mode === "pro") {
    if (!input.pillar) throw new Error("请先选择内容类型（七柱）");
    const missing = missingRequired(input.pillar, input.fields ?? {});
    if (missing.length) throw new Error(`还差必填：${missing.map((f) => f.label).join("、")}`);
    raw = composeProSource(input);
    if (!raw) throw new Error("还差必填内容");
  } else {
    throw new Error("未知模式");
  }

  if (!isInputRich(raw)) return needsInputResult(input, raw);

  const provider = createRuntimeLlmProvider();
  if (!provider.isConfigured()) throw new Error("llm_provider_not_configured");
  const rawText = await provider.complete(buildMomentPrompt(input, raw), {
    maxTokens: 1200,
    reasoningProfile: "standard",
    thinkingMode: "disabled"
  });
  const parsed = parseMomentLlmBody(rawText);
  if (!parsed) throw new Error("llm_output_invalid_structure");

  let body = parsed.body;
  let core = parsed.core || "";
  const needsInput = body.includes("还缺一个关键信息") || body.includes("请补充");
  if (keepMine) {
    core = raw; // 保留原句铁律
    if (!body.includes(raw)) body = `${raw}\n${body}`;
  }
  if (containsBanWordsLocal(body).length) throw new Error("生成内容包含违规引导词，已拦截");

  const placeholder = !/\d/.test(core) || body.includes("【待你补一句：具体数字】");
  const issues = diagnosticIssues(core || body);
  const rawScore = scoreOf(core || raw, issues);
  const newScore = upgradedScore(rawScore, level);
  const checks = publishCheck(body, { hasPlaceholder: placeholder });
  const gate = structureGate(body, level, input.goal);
  if (!gate.pass) throw new Error(`结构门禁未通过：${gate.reason}`);

  return {
    mode,
    pillar: input.pillar,
    goal: input.goal,
    tone,
    level,
    keepMine,
    raw,
    body,
    core,
    rawLen: raw.length,
    newLen: body.length,
    rawScore,
    newScore,
    issues,
    ups: [{ label: "升级强度", pos: "全文", from: UPGRADE_LEVELS[level].name, to: "真实大模型改写", why: UPGRADE_LEVELS[level].desc }],
    checks,
    placeholder,
    needsInput,
    traceId: `moment:${MOMENTS_SERVICE_VERSION}:llm:${Date.now()}`
  };
}

function parseMomentLlmBody(text: string): { body: string; core: string } | null {
  const fenced = text.match(/```json\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(candidate.slice(start, end + 1)) as { body?: unknown; core?: unknown };
    if (typeof obj.body !== "string" || !obj.body.trim()) return null;
    return { body: obj.body.trim(), core: typeof obj.core === "string" ? obj.core.trim() : "" };
  } catch {
    return null;
  }
}

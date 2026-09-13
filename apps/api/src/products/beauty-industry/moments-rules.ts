// 兰琪美业门店 AI 经营大脑 · 私域营销（LQ-18）
// 朋友圈获客：确定性诊断 / 合规 / 评分 / 升级强度 / 七柱配置。
// 本模块为纯函数，不触达 DB / Agent / Provider；文案正文由 LLM 生成，
// 生成后由本模块执行「结构门禁 + 诊断 + 发布前检查」。

export const MOMENTS_RULES_VERSION = "moments_rules_v1" as const;

export type Pillar =
  | "work"
  | "problem"
  | "method"
  | "case"
  | "value"
  | "life"
  | "invite";

export type FastGoal = "engage" | "visit" | "sell" | "trust" | "back";
export type UpgradeLevel = "light" | "std" | "deep";
export type Tone = "亲切大姐" | "专业院长" | "实在老板娘";

export interface MomentFields {
  storeName?: string;
  [key: string]: string | undefined;
}

export interface PillarConfig {
  key: Pillar;
  name: string;
  pct: number;
  required: Array<{ key: string; label: string }>;
  optional: Array<{ key: string; label: string }>;
  cta: string;
}

export const PILLARS: Record<Pillar, PillarConfig> = {
  work: {
    key: "work",
    name: "工作现场",
    pct: 35,
    required: [
      { key: "storeName", label: "门店名称" },
      { key: "today", label: "今天店里发生了什么" }
    ],
    optional: [{ key: "customerCase", label: "客户案例 · 脱敏" }],
    cta: "想了解的姐妹，到店报一声"
  },
  problem: {
    key: "problem",
    name: "客户问题",
    pct: 30,
    required: [
      { key: "storeName", label: "门店名称" },
      { key: "concern", label: "客户常见的困扰" },
      { key: "view", label: "你的观点 / 解法" }
    ],
    optional: [],
    cta: "有类似问题的姐妹，到店让我看看"
  },
  method: {
    key: "method",
    name: "方法论",
    pct: 15,
    required: [
      { key: "storeName", label: "门店名称" },
      { key: "method", label: "你想分享的方法" }
    ],
    optional: [{ key: "audience", label: "适用人群" }],
    cta: "想学的姐妹，到店我手把手教"
  },
  case: {
    key: "case",
    name: "案例证据",
    pct: 10,
    required: [
      { key: "storeName", label: "门店名称" },
      { key: "clientCase", label: "客户案例 · 脱敏" },
      { key: "result", label: "效果 / 成果" }
    ],
    optional: [{ key: "authorization", label: "客户授权" }],
    cta: "想看真实效果的姐妹，到店当面讲"
  },
  value: {
    key: "value",
    name: "价值观边界",
    pct: 4,
    required: [
      { key: "storeName", label: "门店名称" },
      { key: "stance", label: "你想表达的立场 / 边界" }
    ],
    optional: [{ key: "story", label: "背景故事" }],
    cta: "同频的姐妹，欢迎到店聊聊"
  },
  life: {
    key: "life",
    name: "生活温度",
    pct: 3,
    required: [
      { key: "storeName", label: "门店名称" },
      { key: "life", label: "生活片段" }
    ],
    optional: [{ key: "thought", label: "一点感悟" }],
    cta: "谢谢看到这里的你"
  },
  invite: {
    key: "invite",
    name: "软邀约",
    pct: 3,
    required: [
      { key: "storeName", label: "门店名称" },
      { key: "invite", label: "活动 / 邀请内容" }
    ],
    optional: [
      { key: "time", label: "时间" },
      { key: "seats", label: "名额" }
    ],
    cta: "想参加的姐妹，到店提一句就行"
  }
};

export const FAST_GOALS: Record<
  FastGoal,
  { name: string; hook: string; cta: string }
> = {
  engage: { name: "互动", hook: "先问一个问题，把你的客户问住", cta: "评论区聊聊" },
  visit: { name: "到店", hook: "今天店里正在发生什么，直接抛出来", cta: "到店体验" },
  sell: { name: "成交", hook: "把成果放最前面，让人想往下看", cta: "到店了解" },
  trust: { name: "信任", hook: "不吹不捧，把真实的一面摆出来", cta: "欢迎到店验证" },
  back: { name: "复购", hook: "对老客说一句贴心话，提醒回来", cta: "老客到店有礼" }
};

export const UPGRADE_LEVELS: Record<
  UpgradeLevel,
  { name: string; retainRatio: number; desc: string }
> = {
  light: { name: "轻改", retainRatio: 0.9, desc: "保留原意，逐句分行，补句号" },
  std: { name: "标准", retainRatio: 0.7, desc: "去口水词，每句空行分隔" },
  deep: { name: "深改", retainRatio: 0.5, desc: "结果前置法，只留核心" }
};

export const TONES: Tone[] = ["亲切大姐", "专业院长", "实在老板娘"];

// 合规红线：违规引导语 + 绝对化/医疗承诺（正反向都要扫）
export const BAN_WORDS = [
  "私信",
  "打电话",
  "加我",
  "找我",
  "留个",
  "扫码",
  "进群",
  "加微信"
];

export const ABS_WORDS = [
  "根治",
  "永久",
  "最好",
  "第一",
  "100%",
  "特效",
  "治愈",
  "药用",
  "祛除",
  "七天见效"
];

// 结尾动作词（快速/专业模式共用）
const END_ACTIONS = [
  "到店",
  "体验",
  "评论",
  "看看",
  "聊聊",
  "了解",
  "预约",
  "报一声",
  "提一句",
  "有礼",
  "手把手",
  "验证"
];

export interface DiagnosisIssue {
  t: string;
  pos: string;
  from: string;
  to: string;
  why: string;
}

export interface CheckItem {
  ok: boolean;
  label: string;
  detail: string;
}

const has = (re: RegExp, s: string) => re.test(s);
const hasDigit = (s: string) => /\d/.test(s);
const hasEmoji = (s: string) => /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u.test(s);

export function splitSentences(text: string): string[] {
  return text
    .split(/[。！？!?\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function diagnosticIssues(raw: string): DiagnosisIssue[] {
  if (!raw.trim()) return [];
  const sents = splitSentences(raw);
  const issues: DiagnosisIssue[] = [];

  if (raw.length < 40)
    issues.push({ t: "内容太短", pos: "全文", from: `${raw.length} 字`, to: "建议 ≥40 字", why: "字数不够，读者还没进入就划走" });

  if (!hasDigit(raw))
    issues.push({ t: "没有具体数字", pos: "全文", from: "无数字", to: "补 1 个数字", why: "数字最抓眼球，能让人停留" });

  const first = sents[0] ?? "";
  if (first.length < 20 && !/[?!？！]/.test(first))
    issues.push({ t: "开头没有钩子", pos: "开头", from: first || "空", to: "开头抛问题或情景", why: "前 20 字决定有没有人继续看" });

  if (!END_ACTIONS.some((w) => raw.includes(w)))
    issues.push({ t: "没有结尾动作", pos: "结尾", from: "无", to: "补 1 个结尾动作", why: "结尾不催，客人不知道下一步" });

  if (raw.length >= 40 && sents.length <= 1)
    issues.push({ t: "一大段没分段", pos: "分段", from: "无分段", to: "按句分行", why: "手机上一大段很难读" });

  if (!hasEmoji(raw))
    issues.push({ t: "没有情绪符号", pos: "全文", from: "无", to: "加 1 个 emoji", why: "情绪符号提升亲切感" });

  return issues;
}

export function scoreOf(raw: string, issues: DiagnosisIssue[]): number {
  const len = raw.length;
  const sents = splitSentences(raw);
  let s = 46;
  if (len >= 40) s += 8;
  if (len >= 80) s += 6;
  if (hasDigit(raw)) s += 8;
  if (sents.length >= 2) s += 6;
  if (END_ACTIONS.some((w) => raw.includes(w))) s += 6;
  if (hasEmoji(raw)) s += 4;
  s -= issues.length * 3;
  return Math.max(30, Math.min(80, s));
}

export function upgradedScore(rawScore: number, level: UpgradeLevel): number {
  const bonus = level === "light" ? 18 : level === "std" ? 28 : 36;
  return Math.min(96, rawScore + bonus);
}

export function missingRequired(
  pillar: Pillar,
  fields: MomentFields
): Array<{ key: string; label: string }> {
  const cfg = PILLARS[pillar];
  return cfg.required.filter((f) => !(fields[f.key] ?? "").trim());
}

export function fastGate(raw: string | undefined): string | null {
  const t = (raw ?? "").trim();
  if (!t) return "请先写一句你的原话";
  if (t.length < 15) return `原话还差 ${15 - t.length} 字（至少 15 字）`;
  return null;
}

export function containsBanWords(text: string): Array<{ word: string }> {
  return BAN_WORDS.filter((w) => hasRiskyUsage(text, w)).map((word) => ({ word }));
}

/**
 * 「第一」只拦「排名/称号」型宣称（全城第一、销量第一、本地第一品牌、我们店第一），
 * 序数用法不是绝对化词：中文序数后面一定跟量词或序数名词
 * （第一次、第一周、第一部分、第一场直播、第一节课…），
 * 漏掉一个量词就会把整批正常运营话术拦在门外（0909 直播 422 复盘）。
 * 注意：不要收录「名 / 位 / 梯队」这类后缀，「第一名 / 第一位」属于排名宣称，必须继续拦。
 */
const FIRST_ORDINAL_SUFFIX = "次周旬句步时天日阶段版类种条张层轮批档个篇页线块部章课期节题幕场支只款套件家间单笔回遍趟组列年季秒分桶瓶盒袋杯罐";
const ABS_FIRST_CLAIM = new RegExp(`第一(?![${FIRST_ORDINAL_SUFFIX}])`);

export function containsAbsWords(text: string): Array<{ word: string }> {
  return ABS_WORDS.filter((w) =>
    w === "第一" ? ABS_FIRST_CLAIM.test(text) : hasRiskyUsage(text, w)
  ).map((word) => ({ word }));
}

/**
 * 违规词只有在「真的在引导门店这么做」时才算命中。两类误判在真实门店内容里反复出现，
 * 曾经把整段 AI 回答／整批直播逐字稿毙掉（0909 复盘）：
 *
 * 1. 劝阻语境复述——模型写「不引导加微信」「不要留联系方式」时会把违规词原样写出来。
 *    看到否定词直接把整段判违规，等于让「明确不做违规引导」的正确内容发不出去。
 * 2. 渠道名词——「每天回复评论和私信」是在平台内回复顾客消息，「评论或私信」是把两个
 *    入口并列描述，都不是把用户往站外引。真正要拦的是「私信我」「加微信」这类导流动作。
 *
 * 判定只做「更靠近原义」的收紧外扩，不放宽真正违规样本：私信我、加微信、扫码进群依旧命中。
 */
const NEGATION_CUES = [
  "不引导",
  "不写",
  "别说",
  "不提",
  "不做",
  "不发送",
  "不承诺",
  "不要",
  "不用",
  "不必",
  "不能",
  "不得",
  "不该",
  "没有",
  "无需",
  "禁止",
  "避免",
  "杜绝",
  "切忌",
  "严禁",
  "勿",
  "别",
  "不"
];
const NEGATION_WINDOW = 4;
/** 词与本词之间只要跨了句读，就不再算「在说不要这么做」，仍按违规处理。 */
const CLAUSE_BREAK = /[，,。；;：:！!？?\n、]/;

/** 「私信」的合规用法：平台内回复顾客消息，或与评论区并列描述。 */
const BAN_SAFE_PREFIX: Record<string, RegExp> = {
  私信: /(回复|回|查看|处理|看|收|顾客|客户|用户|客人|评论或|评论和|评论、|评论\/)$/
};
const SAFE_PREFIX_WINDOW = 8;

function isAvoidanceMention(text: string, index: number): boolean {
  const window = text.slice(Math.max(0, index - NEGATION_WINDOW), index);
  return NEGATION_CUES.some((cue) => {
    const at = window.lastIndexOf(cue);
    if (at < 0) return false;
    const between = window.slice(at + cue.length);
    // 否定词与本词之间最多隔两个字（「不引导加微信」「不要用特效」），跨句读或隔太远就不算劝阻。
    return between.length <= 2 && !CLAUSE_BREAK.test(between);
  });
}

function isSafeChannelMention(text: string, index: number, word: string): boolean {
  const safe = BAN_SAFE_PREFIX[word];
  if (!safe) return false;
  return safe.test(text.slice(Math.max(0, index - SAFE_PREFIX_WINDOW), index));
}

function hasRiskyUsage(text: string, word: string): boolean {
  let from = 0;
  while (from <= text.length) {
    const at = text.indexOf(word, from);
    if (at < 0) return false;
    if (!isAvoidanceMention(text, at) && !isSafeChannelMention(text, at, word)) return true;
    from = at + word.length;
  }
  return false;
}

// 空口承诺疗效的句式。
// 判定要点：「承诺」类词出现在否定语境里时属于合规免责，不能当成承诺拦掉——
// 主播念「我不敢保证一次就有效果」「效果没法保证，得看你的皮肤状态」正是最该保留的说法。
// 旧口径只要出现「保证」就整批判违规，一次措辞就把 44 秒生成出来的整批逐字稿毙掉
// （0911 直播 422 复盘），与 0909「第一部分/第二部分」误判属同一类假阳性。
export const PROMISE_CLAIMS = [
  "保证",
  "100%有效",
  "100% 有效",
  "一定有效",
  "绝对有效",
  "立刻见效",
  "马上见效",
  "当场见效"
] as const;

/** 承诺词前面的否定语境（不承诺 / 不敢保证 / 没法保证 / 无法保证 / 很难马上见效）。 */
const CLAIM_NEGATION_CUES = ["不", "没", "别", "难", "无法"];
const CLAIM_NEGATION_WINDOW = 3;

function isDisclaimedClaim(text: string, index: number): boolean {
  const window = text.slice(Math.max(0, index - CLAIM_NEGATION_WINDOW), index);
  return CLAIM_NEGATION_CUES.some((cue) => {
    const at = window.lastIndexOf(cue);
    if (at < 0) return false;
    const between = window.slice(at + cue.length);
    // 否定词与承诺词之间最多隔两个字（不敢保证 / 不会马上见效），跨句读就不算免责。
    return between.length <= 2 && !CLAUSE_BREAK.test(between);
  });
}

export function containsPromiseClaims(text: string): Array<{ word: string }> {
  const hits = new Set<string>();
  for (const word of PROMISE_CLAIMS) {
    let from = 0;
    while (from <= text.length) {
      const at = text.indexOf(word, from);
      if (at < 0) break;
      from = at + word.length;
      if (isDisclaimedClaim(text, at)) continue;
      hits.add(word);
    }
  }
  return [...hits].map((word) => ({ word }));
}

export function publishCheck(
  body: string,
  opts: { hasPlaceholder?: boolean } = {}
): CheckItem[] {
  const items: CheckItem[] = [];

  const ban = containsBanWords(body);
  items.push({
    ok: ban.length === 0,
    label: "违规引导词",
    detail: ban.length ? `含引导词：${ban.map((b) => b.word).join("、")}` : "无违规引导，可发布"
  });

  const abs = containsAbsWords(body);
  items.push({
    ok: abs.length === 0,
    label: "绝对化 / 医疗承诺",
    detail: abs.length ? `含限流词：${abs.map((a) => a.word).join("、")}` : "无绝对化表述"
  });

  const hasDigitTxt = hasDigit(body);
  const placeholder = opts.hasPlaceholder || body.includes("【待你补一句】") || body.includes("补一个真实数字");
  items.push({
    ok: hasDigitTxt && !placeholder,
    label: "有具体数字",
    detail: placeholder
      ? "正文缺 1 个真实数字（时长 / 次数 / 到店价），点「✏️ 补数字」补齐"
      : hasDigitTxt
        ? "已含数字"
        : "建议补 1 个数字"
  });

  items.push({
    ok: END_ACTIONS.some((w) => body.includes(w)),
    label: "有结尾动作",
    detail: END_ACTIONS.some((w) => body.includes(w)) ? "有动作引导" : "缺结尾动作"
  });

  const sents = splitSentences(body);
  items.push({
    ok: sents.length >= 2 || body.length < 40,
    label: "排版分段",
    detail: sents.length >= 2 ? "已分段" : "建议按句分行"
  });

  return items;
}

// 生成后的结构门禁：钩子 + 核心 + 背书 + 占位 + CTA（deep 只留核心+CTA）
export function structureGate(
  body: string,
  level: UpgradeLevel,
  goal?: FastGoal
): { pass: boolean; reason: string } {
  const hasCta = goal ? FAST_GOALS[goal].cta.split("").length > 0 : body.length > 0;
  if (!body.trim()) return { pass: false, reason: "正文为空" };
  if (!hasCta) return { pass: false, reason: "缺少结尾动作" };
  if (level === "deep") {
    return body.length >= 30 ? { pass: true, reason: "结构完整（结果前置）" } : { pass: false, reason: "深改后过短" };
  }
  return { pass: true, reason: "结构完整" };
}

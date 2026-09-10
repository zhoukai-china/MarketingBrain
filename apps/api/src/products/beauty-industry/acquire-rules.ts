// 兰琪美业门店 AI 经营大脑 · 公域获客 / 短视频文案改稿
// 确定性规则：输入门禁、用途判定、五维诊断评分、成稿结构检查。
// 本模块为纯函数，不触达 DB / Provider；文案正文由 LLM 生成，
// 生成前后由本模块执行「门禁 + 评分 + 发布前检查」，保证分数口径稳定、不随模型波动。

export const ACQUIRE_RULES_VERSION = "acquire_rules_v1" as const;

// 与 demo `copywriter.html` 一致：成交型 / 了解型 / 曝光型
export type VideoPurpose = "deal" | "aware" | "exposure";

export const VIDEO_PURPOSES: Record<VideoPurpose, string> = {
  deal: "成交型",
  aware: "了解型",
  exposure: "曝光型"
};

// 与 demo 一致：综合优化 / 完播率 / 互动率 / 转化率
export type VideoGoal = "all" | "completion" | "engagement" | "conversion";

export const VIDEO_GOALS: Record<VideoGoal, string> = {
  all: "综合优化",
  completion: "完播率",
  engagement: "互动率",
  conversion: "转化率"
};

export function isVideoPurpose(value: unknown): value is VideoPurpose {
  return value === "deal" || value === "aware" || value === "exposure";
}

export function isVideoGoal(value: unknown): value is VideoGoal {
  return value === "all" || value === "completion" || value === "engagement" || value === "conversion";
}

// 五维诊断（对应 demo「为什么这样改」的 5 个评分项，满分合计 10）
export interface ScoreDimSpec {
  key: "audience" | "share" | "scarcity" | "execution" | "cta";
  label: string;
  max: number;
}

export const SCORE_DIMS: ScoreDimSpec[] = [
  { key: "audience", label: "核心对象与代入感", max: 3 },
  { key: "share", label: "转发欲望与社交钩", max: 2 },
  { key: "scarcity", label: "稀缺性与增量", max: 2 },
  { key: "execution", label: "内容执行质量", max: 2 },
  { key: "cta", label: "行动号召", max: 1 }
];

export interface ScoreDim {
  key: ScoreDimSpec["key"];
  label: string;
  score: number;
  max: number;
  comment: string;
  advice: string;
}

export interface OpeningCard {
  key: "hook" | "claim" | "scene";
  title: string;
  text: string;
  why: string;
}

export const OPENING_TITLES: Record<OpeningCard["key"], string> = {
  hook: "钩子提问",
  claim: "反直觉断言",
  scene: "当下场景代入"
};

export const OPENING_KEYS: OpeningCard["key"][] = ["hook", "claim", "scene"];

const SECOND_PERSON = /你|您|大家|各位|姐妹们|老板们|同行/;
const SCENE_WORDS = /最近|现在|今天|平时|经常|每次|一到|有没有|是不是|遇到|很多人|不少人|身边/;
const AUDIENCE_WORDS = /老板|店主|店长|同行|宝妈|上班族|新手|姐妹|小姐姐|顾客|客户|创业者|个体户/;
const VALUE_WORDS = /方法|步骤|技巧|教你|复盘|清单|模板|话术|干货|避坑|经验/;
const STRUCTURE_WORDS = /第一|第二|第三|首先|其次|然后|最后|1[.、]|2[.、]|3[.、]/;
const TOOL_WORDS = /AI|人工智能|工具|表格|数据|系统|流程|内行|行业里|很少有人|信息差/;
const CTA_WORDS = /关注|点赞|评论|收藏|转发|分享|到店|了解|看看|聊聊|尝试|试试|开始/;

// 美业具体词：判断原稿是否已包含足够具体的行业信息
const BEAUTY_CONCRETE = /美甲|美睫|美发|染发|烫发|剪发|皮肤管理|生美|科美|医美|护肤|补水|保湿|清洁|祛痘|淡斑|抗衰|紧致|光子|水光|热玛吉|面膜|肩颈|按摩|spa|护理|项目|套餐|会员|卡项|门店|到店/;

function sentenceCount(text: string): number {
  return text
    .split(/[。！？!?\n]+/)
    .map((s) => s.trim())
    .filter(Boolean).length;
}

/** 原稿是否够具体到可以改稿（不够则要求用户补信息，不编造） */
export function isAcquireInputRich(rawText: string): boolean {
  const t = (rawText || "").trim();
  if (t.length >= 60) return true;
  if (/\d/.test(t)) return true;
  if (BEAUTY_CONCRETE.test(t)) return true;
  const hasTime = /今天|明天|本周|下周|周[一二三四五六日天]|\d+月|\d+号|上午|下午|晚上/.test(t);
  const hasQuotaOrPrice = /名额|限|元|折|价|优惠|特惠|划算/.test(t);
  return hasTime && hasQuotaOrPrice;
}

/**
 * 改稿输入门禁：返回错误信息，null 表示通过。
 * 只拦「没贴原稿」；原稿太短/太虚不进错误分支，改走 needsInput 受控提示（不编造内容）。
 */
export function copywriterGate(raw: string | undefined): string | null {
  const t = (raw ?? "").trim();
  if (!t) return "请先贴上你的口播原稿";
  return null;
}

/** 用户选「自动判断」时，按原稿内容推断这条视频的用途 */
export function inferPurpose(raw: string, goal?: VideoGoal): VideoPurpose {
  const t = (raw || "").trim();
  if (goal === "conversion") return "deal";
  if (goal === "completion") return "exposure";
  if (/到店|预约|名额|价格|元|折|优惠|办卡|充值|体验价|团购/.test(t)) return "deal";
  if (/介绍|我们店|门店|项目|服务|环境|团队|资质/.test(t)) return "aware";
  return "exposure";
}

/** 五维确定性评分：只依据原稿文本事实，不依赖模型判断，保证口径可复算 */
export function scoreRawDraft(raw: string): Record<ScoreDimSpec["key"], number> {
  const t = (raw || "").trim();
  const sents = sentenceCount(t);
  return {
    audience: (SECOND_PERSON.test(t) ? 1 : 0) + (SCENE_WORDS.test(t) ? 1 : 0) + (AUDIENCE_WORDS.test(t) ? 1 : 0),
    share: (VALUE_WORDS.test(t) ? 1 : 0) + (STRUCTURE_WORDS.test(t) ? 1 : 0),
    scarcity: (/\d/.test(t) ? 1 : 0) + (TOOL_WORDS.test(t) ? 1 : 0),
    execution: (t.length >= 80 ? 1 : 0) + (sents >= 3 ? 1 : 0),
    cta: CTA_WORDS.test(t) ? 1 : 0
  };
}

/**
 * 把模型给出的每条评语与确定性分数合并，分数以规则为准并夹取到 [0, max]。
 * 满分的维度用系统正向评语（避免出现「3/3 却在说有问题」的矛盾），但保留模型的改进建议。
 */
export function buildScores(
  raw: string,
  modelNotes?: Partial<Record<ScoreDimSpec["key"], { comment?: string; advice?: string }>>
): ScoreDim[] {
  const base = scoreRawDraft(raw);
  return SCORE_DIMS.map((dim) => {
    const note = modelNotes?.[dim.key];
    const score = Math.max(0, Math.min(dim.max, base[dim.key]));
    const full = score >= dim.max;
    return {
      key: dim.key,
      label: dim.label,
      score,
      max: dim.max,
      comment: full ? defaultComment(dim.key, score, dim.max) : (note?.comment ?? "").trim() || defaultComment(dim.key, score, dim.max),
      advice: (note?.advice ?? "").trim() || defaultAdvice(dim.key, score, dim.max)
    };
  });
}

function defaultComment(key: ScoreDimSpec["key"], score: number, max: number): string {
  if (score >= max) return "这一项原稿已经做得不错。";
  const table: Record<ScoreDimSpec["key"], string> = {
    audience: "原稿没有明确说给谁看，观众不容易觉得“这是在说我”。",
    share: "原稿只说了主题，没有让人想转发给同行的理由。",
    scarcity: "原稿没给出具体方法或数字，信息量偏少。",
    execution: "原稿篇幅短、没分段，手机上一眼看不出重点。",
    cta: "原稿结尾没有告诉观众下一步做什么。"
  };
  return table[key];
}

function defaultAdvice(key: ScoreDimSpec["key"], score: number, max: number): string {
  if (score >= max) return "保持即可，改稿时不要削弱这一点。";
  const table: Record<ScoreDimSpec["key"], string> = {
    audience: "开头点明目标人群和具体场景，让观众对号入座。",
    share: "给出一个能直接抄走的方法或清单，让人愿意转给同行。",
    scarcity: "补一个具体数字或一个别人不知道的做法（没有数字就用占位提醒你亲补）。",
    execution: "开头加钩子，正文按步骤分段，读起来有节奏。",
    cta: "结尾加一个自然动作，例如引导到店了解或关注。"
  };
  return table[key];
}

/** 成稿结构门禁：正文非空 + 至少两段（开头钩子与正文） */
export function draftStructureGate(draft: string): { pass: boolean; reason: string } {
  const t = (draft || "").trim();
  if (!t) return { pass: false, reason: "正文为空" };
  if (t.length < 30) return { pass: false, reason: "改后正文过短" };
  if (sentenceCount(t) < 2) return { pass: false, reason: "改后正文没有分段" };
  return { pass: true, reason: "结构完整" };
}

/** 无数字时提醒用户亲补，禁止模型编造数字 */
export function placeholderFor(raw: string, draft: string): string | null {
  if (/\d/.test(raw)) return null;
  if (/\d/.test(draft)) return null;
  return "【待你补一句：具体数字】";
}

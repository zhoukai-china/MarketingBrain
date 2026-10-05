// 兰琪美业门店 AI 经营大脑 · 公域获客 / 视频获客 · 文案转片分镜
//
// 2026-10-05（用户拍板「按最好的效果改，费用不至于」）：描述与提示词从模板拼接升级为
// 大模型逐镜真写——模板版两级截断（42/70 字）会把句尾地标（如「长江大桥」）剁掉，
// 模型收不到就乱画背景。分镜切句仍走确定性规则（splitScript），保证镜数与口播原句稳定可控。
//
// 口径（对齐 0909 总纲 + demo `video.html`）：
//   · 贴口播文案 → 按语义断句切成每镜 ≤15 秒的分镜脚本，每镜直接给「生视频提示词」。
//   · 单次视频生成 4–15 秒，所以长文案必须切镜；单次请求参考图上限 9 张，按分镜所属场景分组。
//   · 界面只出现画质档位（草稿预览 480p / 标准成片 720p / 高清成片 1080p）。
//     不出现任何模型名或厂商名 —— 门店用户看不到、也不需要知道背后用什么。
//   · 本文件不含算力 / 计费 / 定价：本阶段不做算力。
//
// 已知口径（demo 对齐）：分镜时长 = round(字数 / 4.5)，夹在 [4, 15] 秒。

import { createRuntimeLlmProvider } from "../../services/llm-provider-factory.js";
import type { LlmMessage } from "@baolu/agent";

export const VIDEO_MAX_SEC = 15;
export const VIDEO_MIN_SEC = 4;
export const VIDEO_MAX_IMG = 9;
export const VIDEO_MAX_AUDIO = 3;
export const VIDEO_CHARS_PER_SEC = 4.5;

/** 负面提示词：与 demo 完全一致，避免畸变、文字水印与风格漂移。 */
export const VIDEO_NEGATIVE_PROMPT =
  "不要出现任何文字、字幕、水印、LOGO；不要人脸畸变、五官扭曲、手指异常；不要画面闪烁、物体变形、镜头剧烈抖动；不要过曝或死黑；不要卡通、油画、3D 渲染感；不要更换人物长相与服装；不要场景切换、不要转场、不要跳切到其他地点或布景；不要运镜、不要推拉摇移、不要变焦，镜头固定不动";

export interface VideoStyleOption {
  k: string;
  n: string;
  light: string;
  tone: string;
  q: string;
}

/** 画面风格：只描述光影 / 色调 / 质感，不涉及任何模型或厂商。 */
export const VIDEO_STYLES: VideoStyleOption[] = [
  { k: "cinema", n: "电影质感", light: "柔和侧逆光，明暗层次分明，轻微胶片颗粒", tone: "低饱和高级灰调", q: "电影级调色" },
  { k: "comm", n: "高级商业广告", light: "明亮均匀布光，产品级高光", tone: "干净通透的米白色调", q: "商业广告级画质" },
  { k: "warm", n: "温暖生活感", light: "自然窗光，暖色氛围光", tone: "温暖奶油色调", q: "生活化真实质感" },
  { k: "guo", n: "国风雅致", light: "柔光漫射，淡淡光晕", tone: "素雅水墨留白", q: "东方美学质感" },
  { k: "tech", n: "科技未来", light: "冷调轮廓光，蓝橙对比", tone: "冷峻科技蓝", q: "锐利清晰质感" }
];

export interface VideoSplitMode {
  k: string;
  n: string;
  d: string;
  /** 单镜字数上限 */
  cap: number;
}

/** 切分规则：cap = 这一档单镜最多几个字（15 秒 ≈ 67 字）。 */
export const VIDEO_SPLIT_MODES: VideoSplitMode[] = [
  { k: "auto", n: "自动按 15 秒切", d: "推荐 · 按语义断句", cap: 67 },
  { k: "s10", n: "每段 10 秒", d: "镜头更碎更抓人", cap: 45 },
  { k: "s5", n: "每段 5 秒", d: "卡点快剪", cap: 22 }
];

export interface VideoTierOption {
  k: string;
  n: string;
  res: string;
  d: string;
  out: string;
}

/** 画质档位：界面唯一允许出现的三档，不含价格与算力。 */
export const VIDEO_TIERS: VideoTierOption[] = [
  { k: "draft", n: "草稿预览", res: "480p", d: "先看分镜顺不顺、人物脸稳不稳，不对就重来", out: "480p · 内部确认用，不建议外发" },
  { k: "std", n: "标准成片", res: "720p", d: "朋友圈 / 视频号 / 企微日常发，够用", out: "720p · 主流平台够用" },
  { k: "final", n: "高清成片", res: "1080p", d: "抖音投放 / 门店大屏 / 招商会用", out: "1080p · 投放级画质" }
];

export interface VideoCastAngle {
  k: string;
  n: string;
  ico: string;
  role: string;
}

/** 人物卡三视图：正面做首帧，侧背做参考，让跨镜头不跑脸。 */
export const VIDEO_CAST_ANGLES: VideoCastAngle[] = [
  { k: "front", n: "正面", ico: "🧍", role: "首帧图" },
  { k: "side", n: "侧面", ico: "👤", role: "参考图" },
  { k: "back", n: "背面", ico: "🔙", role: "参考图" }
];

export interface VideoShotKind {
  k: string;
  kw: string[];
  cam: string;
  move: string;
  tag: string;
}

/** 判定顺序 = 优先级：具体物件 > 手法 > 体验 > 空间 > 口播兜底。 */
export const VIDEO_SHOT_KINDS: VideoShotKind[] = [
  { k: "prod", kw: ["产品", "仪器", "设备", "精华", "套盒", "成分", "工具", "瓶", "盒"], cam: "特写微距", move: "镜头极缓慢推进", tag: "产品特写" },
  { k: "hand", kw: ["手法", "按摩", "护理", "操作", "过程", "敷", "导入", "清洁"], cam: "近景特写（手部与面部）", move: "轻微手持跟随", tag: "手法特写" },
  { k: "guest", kw: ["顾客", "客人", "客户", "体验", "效果", "对比", "变美", "反馈", "躺", "镜子"], cam: "中景", move: "镜头轻微环绕", tag: "体验中景" },
  { k: "gate", kw: ["门头", "招牌", "门店", "门口", "前台", "大厅", "进门", "走廊", "环境", "店里"], cam: "大远景定场", move: "镜头缓慢横移", tag: "定场镜头" },
  { k: "talk", kw: ["我", "我们", "老板", "说", "讲", "问", "想", "觉得", "其实", "欢迎", "如果"], cam: "中近景（人物正对镜头）", move: "镜头极缓慢推进", tag: "人物讲述" }
];

export interface StoryboardShot {
  /** 从 1 开始的分镜号 */
  no: number;
  /** 口播原句 */
  text: string;
  seconds: number;
  kind: string;
  cam: string;
  move: string;
  /** 画面描述（AI 补的镜头，可改） */
  desc: string;
  /** 生视频提示词 */
  prompt: string;
  negative: string;
}

export interface StoryboardInput {
  script: string;
  styleKey?: string;
  splitMode?: string;
  castName?: string;
  sceneNames?: string[];
  propNames?: string[];
  /** 门店选的目标时长（秒）：决定镜数区间（15s→1–2 镜、30s→2–3 镜、45s+→3–6 镜）。 */
  targetSeconds?: number;
}

export interface StoryboardResult {
  shots: StoryboardShot[];
  shotCount: number;
  totalSeconds: number;
  sourceChars: number;
  style: VideoStyleOption;
  splitMode: VideoSplitMode;
  negative: string;
  maxSeconds: number;
  maxImages: number;
  /** 单次请求参考图上限 → 超了要按场景分组调用 */
  imageGroupingNote: string;
  serviceVersion: string;
}

export const VIDEO_SCRIPT_SERVICE_VERSION = "lanqi-video-script/1.0";

function styleOf(key: string | undefined): VideoStyleOption {
  return VIDEO_STYLES.find((item) => item.k === key) ?? VIDEO_STYLES[0];
}

function splitModeOf(key: string | undefined): VideoSplitMode {
  return VIDEO_SPLIT_MODES.find((item) => item.k === key) ?? VIDEO_SPLIT_MODES[0];
}

/** 按语义断句切段：先按句末标点切句，再按这一档的字数上限合并。 */
export function splitScript(script: string, splitMode?: string): string[] {
  const raw = String(script ?? "");
  const parts = raw.split(/([。！？；\n]+)/);
  const sentences: string[] = [];
  let buffer = "";
  for (const part of parts) {
    buffer += part;
    if (/[。！？；\n]/.test(part)) {
      if (buffer.trim()) sentences.push(buffer.trim());
      buffer = "";
    }
  }
  if (buffer.trim()) sentences.push(buffer.trim());

  const cap = splitModeOf(splitMode).cap;
  const out: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if ((current + sentence).length > cap && current) {
      out.push(current);
      current = sentence;
    } else {
      current += sentence;
    }
  }
  if (current.trim()) out.push(current.trim());
  return out.filter((item) => item.length > 1);
}

/** 单镜时长：round(字数 / 4.5)，夹在 [4, 15] 秒。 */
export function shotSeconds(text: string): number {
  const length = String(text ?? "").length;
  return Math.min(VIDEO_MAX_SEC, Math.max(VIDEO_MIN_SEC, Math.round(length / VIDEO_CHARS_PER_SEC)));
}

export function kindOf(text: string): VideoShotKind {
  const source = String(text ?? "");
  for (const kind of VIDEO_SHOT_KINDS) {
    for (const keyword of kind.kw) {
      if (source.includes(keyword)) return kind;
    }
  }
  return VIDEO_SHOT_KINDS[VIDEO_SHOT_KINDS.length - 1];
}

/** 画面描述：给「分镜脚本」这一步看的中文镜头说明。 */
export function describeShot(text: string, index: number, total: number): { desc: string; kind: VideoShotKind } {
  const kind = kindOf(text);
  let body = String(text ?? "").replace(/[\s，。！？；、]/g, "");
  // 2026-10-05：42 字会把句尾的地标（如「长江大桥」）整段截掉，模型收不到就乱画背景。放宽到 90，口播单句本身不会那么长。
  if (body.length > 90) body = body.slice(0, 90);
  const head = index === 0 ? "开场先定住注意力，" : index === total - 1 ? "收尾落到行动号召，" : "";
  return { desc: `${head}${kind.cam}，画面主体：${body}，${kind.move}`, kind };
}

export interface ShotPromptContext {
  index: number;
  total: number;
  style: VideoStyleOption;
  castName?: string;
  sceneName?: string;
  propName?: string;
}

/**
 * 把分镜改写成生视频提示词。
 * 结构 = 景别 + 人物 + 画面描述 + 场景 + 道具 + 运镜 + 光影 + 色调 + 质感 + 画质词。
 */
export function buildShotPrompt(shot: Pick<StoryboardShot, "desc" | "cam" | "move" | "text">, context: ShotPromptContext): string {
  const { style, index, total } = context;
  const move =
    index === 0
      ? "镜头从景深处缓慢向前推进开场"
      : index === total - 1
        ? "镜头缓缓向后拉远，自然收尾"
        : shot.move;
  let body = String(shot.desc || shot.text || "").replace(/[\s，。！？；、]/g, "");
  // 2026-10-05：desc 前缀（开场/景别/画面主体：）就要占 15~20 字，70 字总闸会把真实画面描述的后半句剁掉。放宽到 180。
  if (body.length > 180) body = body.slice(0, 180);

  let out = `${shot.cam}，`;
  if (context.castName) out += `人物${context.castName}，`;
  out += `${body}，`;
  if (context.sceneName) out += `场景为${context.sceneName}，`;
  if (context.propName) out += `画面中清晰出现${context.propName}，`;
  out +=
    "人物状态自然松弛、动作连贯真实、表情放松，" +
    `${move}，` +
    `${style.light}，${style.tone}，` +
    "保留真实肤质与环境细节，画面干净通透，" +
    `${style.q}，超清画质，浅景深，电影感构图，画面稳定无闪烁`;
  return out;
}

/** 文案转片第 1–2 步：口播文案 → 分镜脚本（每镜带生视频提示词）。 */
export function buildStoryboard(input: StoryboardInput): StoryboardResult {
  const script = String(input.script ?? "");
  const parts = splitScript(script, input.splitMode);
  const style = styleOf(input.styleKey);
  const splitMode = splitModeOf(input.splitMode);
  const castName = input.castName?.trim() || undefined;
  const scenes = (input.sceneNames ?? []).map((item) => String(item ?? "").trim());
  const props = (input.propNames ?? []).map((item) => String(item ?? "").trim());

  const shots: StoryboardShot[] = parts.map((text, index) => {
    const { desc, kind } = describeShot(text, index, parts.length);
    const sceneName = scenes.length ? scenes[index % scenes.length] : undefined;
    const propName = props.length ? props[index % props.length] : undefined;
    const base: StoryboardShot = {
      no: index + 1,
      text,
      seconds: shotSeconds(text),
      kind: kind.tag,
      cam: kind.cam,
      move: kind.move,
      desc,
      prompt: "",
      negative: VIDEO_NEGATIVE_PROMPT
    };
    base.prompt = buildShotPrompt(base, { index, total: parts.length, style, castName, sceneName, propName });
    return base;
  });

  return {
    shots,
    shotCount: shots.length,
    totalSeconds: shots.reduce((sum, shot) => sum + shot.seconds, 0),
    sourceChars: script.replace(/\s/g, "").length,
    style,
    splitMode,
    negative: VIDEO_NEGATIVE_PROMPT,
    maxSeconds: VIDEO_MAX_SEC,
    maxImages: VIDEO_MAX_IMG,
    imageGroupingNote: "单次请求参考图上限 9 张；超过时按分镜所属场景自动分组调用，人物三视图每次都带。",
    serviceVersion: VIDEO_SCRIPT_SERVICE_VERSION
  };
}

export interface RebuildShotInput {
  text: string;
  styleKey?: string;
  castName?: string;
  sceneName?: string;
  propName?: string;
  /** 在整条片子里的位置，决定开场 / 收尾的运镜措辞 */
  index?: number;
  total?: number;
}

/** 重写单镜：文案不变、只把这一镜的画面描述与提示词重新出一版（改风格 / 换素材后常用）。 */
export function rebuildShot(input: RebuildShotInput): StoryboardShot {
  const text = String(input.text ?? "").trim();
  if (!text) throw new Error("这一镜的口播原句是空的，请先补上文案再重写");
  const total = Math.max(1, Math.trunc(input.total ?? 1));
  const index = Math.min(total - 1, Math.max(0, Math.trunc(input.index ?? 0)));
  const { desc, kind } = describeShot(text, index, total);
  const style = styleOf(input.styleKey);
  const base: StoryboardShot = {
    no: index + 1,
    text,
    seconds: shotSeconds(text),
    kind: kind.tag,
    cam: kind.cam,
    move: kind.move,
    desc,
    prompt: "",
    negative: VIDEO_NEGATIVE_PROMPT
  };
  base.prompt = buildShotPrompt(base, {
    index,
    total,
    style,
    castName: input.castName?.trim() || undefined,
    sceneName: input.sceneName?.trim() || undefined,
    propName: input.propName?.trim() || undefined
  });
  return base;
}

/** 缺则反问，不捏造：返回还差哪些必填。 */
export function validateVideoScriptInput(input: StoryboardInput): string[] {
  const missing: string[] = [];
  if (!String(input.script ?? "").trim()) missing.push("口播文案");
  return missing;
}

// ────────────────────── LLM 版分镜与提示词（2026-10-05，失败即报错不静默回模板） ──────────────────────

export const VIDEO_SCRIPT_LLM_VERSION = "lanqi-video-script/2.0-llm";

function parseJsonLoose(text: string): any | null {
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

function strField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function buildStoryboardLlmMessages(
  script: string,
  preset: string[] | null,
  context: { style: VideoStyleOption; castName?: string; sceneNames?: string[]; propNames?: string[]; cap?: number; splitSeconds?: number; autoMerge?: boolean; expectedShots?: number }
): LlmMessage[] {
  const scriptBlock = preset ? preset.map((text, index) => `第${index + 1}镜口播原句：${text}`).join("\n") : script;
  const system = [
    "你是资深短视频分镜师，负责把门店口播文案改成逐镜的「生视频提示词」（给图生视频 / 文生视频模型用）。",
    "硬要求：",
    "1. 提示词里的地点、地标、人物、产品必须来自口播原句——口播提到「长江大桥」，提示词就必须写出长江大桥及它合理的周边环境（江面、桥体、灯光等）；禁止编造口播里没有的地名、门店名、价格、销量、疗效。",
    "2. 每镜 prompt 为 70~160 字中文，结构：景别+人物+主体动作+场景与背景细节+运镜+光影+色调+质感+画质词；背景要具体（在哪、有什么、什么氛围），不能只写「室内」「户外」。",
    "3. 各镜之间人物长相、服装、门店环境保持一致；每镜只描述一个连续画面。",
    "3a. 禁止在提示词里指定出镜人物的性别、年龄、长相（不要写「中年男性」「年轻女性」「帅小伙」之类）——人物形象由门店上传的参考照片决定，提示词只写动作、神态、穿着风格与所处环境。",
    "4. desc 是给门店老板看的分镜说明（20~40 字大白话），prompt 才是给模型的提示词，两者不要写成一样的。",
    "5. 只输出 JSON，不要解释、不要 Markdown。"
  ].join("\n");
  const user = [
    preset
      ? "口播全文（已按镜切好，保持镜数不变、口播原句原样保留）："
      : context.autoMerge
        ? `口播全文（按语义断句切镜：切成约 ${context.expectedShots ?? 2} 镜（±1 镜以内），单镜最长约 ${context.splitSeconds ?? 15} 秒、能合并就合并成长镜；每镜口播原句必须原样从全文切出、不增删改字，所有镜的口播拼起来要等于全文）：`
        : `口播全文（门店选了切分规则「每段约 ${context.splitSeconds ?? 10} 秒」：切成约 ${context.expectedShots ?? 3} 镜（±1 镜以内），每镜时长贴着它来；长句允许在逗号处切开、分属相邻两镜；每镜口播原句必须原样从全文切出、不增删改字，所有镜的口播拼起来要等于全文）：`,
    scriptBlock,
    "",
    `画面风格：${context.style.n}（光影：${context.style.light}；色调：${context.style.tone}；质感：${context.style.q}）——这些风格词要融进每镜 prompt。`,
    context.castName ? `出镜人物：${context.castName}（提示词里人物长相描述保持各镜一致）。` : "出镜人物：（未指定，按口播语义决定是否出现人物）。",
    context.sceneNames?.length ? `可用场景素材名：${context.sceneNames.join("、")}（提示词背景要贴这句话对应的场景）。` : "可用场景素材名：（未指定，背景按口播语义写具体）。",
    context.propNames?.length ? `可用道具素材名：${context.propNames.join("、")}（相关镜的 prompt 要写清道具怎么出现）。` : "",
    "",
    '输出格式：{"shots":[{"text":"该镜口播原句","cam":"景别（如 中景 / 特写微距 / 大远景定场）","move":"运镜（如 镜头缓慢推进）","desc":"给门店看的分镜说明","prompt":"最终生视频提示词"}]}'
  ].filter(Boolean).join("\n");
  return [
    { role: "system", content: system },
    { role: "user", content: user }
  ];
}

/** 目标时长 → 镜数区间（与文案页对门店的承诺一致：15s→1–2、30s→2–3、45s+→3–6）。 */
function shotRangeFor(targetSeconds?: number): { min: number; max: number; target: number } | undefined {
  if (!targetSeconds) return undefined;
  if (targetSeconds <= 15) return { min: 1, max: 2, target: targetSeconds };
  if (targetSeconds <= 30) return { min: 2, max: 3, target: targetSeconds };
  return { min: 3, max: 6, target: targetSeconds };
}

interface LlmShotOutput { text: string; cam: string; move: string; desc: string; prompt: string; }

/** 调大模型出整组分镜，失败显式抛错（不静默回模板）。 */
async function llmStoryboardShots(
  script: string,
  preset: string[] | null,
  context: { style: VideoStyleOption; castName?: string; sceneNames?: string[]; propNames?: string[]; cap?: number; splitSeconds?: number; autoMerge?: boolean; expectedShots?: number }
): Promise<LlmShotOutput[]> {
  const provider = createRuntimeLlmProvider();
  if (!provider.isConfigured()) throw new Error("llm_provider_not_configured");
  const opts = { maxTokens: 3000, reasoningProfile: "standard" as const, thinkingMode: "disabled" as const };
  const parseShots = (raw: string): LlmShotOutput[] => {
    const parsed = parseJsonLoose(raw);
    const list = Array.isArray(parsed?.shots) ? parsed.shots : [];
    return list.map((item: any) => ({
      text: strField(item?.text),
      cam: strField(item?.cam),
      move: strField(item?.move),
      desc: strField(item?.desc),
      prompt: strField(item?.prompt)
    })).filter((item: LlmShotOutput) => item.text && item.prompt);
  };

  let shots = parseShots(await provider.complete(buildStoryboardLlmMessages(script, preset, context), opts));
  // 镜数校验 + 最多两轮带批评的重试：模型对「每段约 N 秒」不敏感，但对镜数批评很敏感。
  if (context.expectedShots) {
    const expected = context.expectedShots;
    const off = (list: LlmShotOutput[]) => Math.abs(list.length - expected);
    let best = shots;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (!shots.length || off(shots) <= 1) break;
      const retryMessages = buildStoryboardLlmMessages(script, preset, context);
      retryMessages.push({
        role: "user",
        content: `你刚才切成了 ${shots.length} 镜，不符合要求。必须严格切成约 ${expected} 镜（±1 镜以内），每镜口播约 ${Math.round((context.splitSeconds ?? 10) * 4.5)} 字；长句可以从逗号处切开。重新输出完整 JSON。`
      });
      const next = parseShots(await provider.complete(retryMessages, opts));
      if (!next.length) break;
      shots = next;
      if (off(next) < off(best)) best = next;
    }
    if (off(shots) > 1) shots = best;
  }
  if (!shots.length) throw new Error("llm_output_invalid_structure");
  return shots;
}

function mergeShot(index: number, total: number, text: string, llm: LlmShotOutput | undefined, style: VideoStyleOption): StoryboardShot {
  const kind = kindOf(text);
  return {
    no: index + 1,
    text,
    seconds: shotSeconds(text),
    kind: kind.tag,
    cam: llm?.cam || kind.cam,
    move: llm?.move || kind.move,
    desc: llm?.desc || describeShot(text, index, total).desc,
    prompt: llm?.prompt || buildShotPrompt({ desc: describeShot(text, index, total).desc, cam: kind.cam, move: kind.move, text }, { index, total, style }),
    negative: VIDEO_NEGATIVE_PROMPT
  };
}

/** LLM 版整片分镜：切镜边界与描述 / 提示词都交给模型（按 splitMode 字数上限约束），代码只做结构校验。 */
export async function buildStoryboardWithLlm(input: StoryboardInput): Promise<StoryboardResult> {
  const script = String(input.script ?? "").trim();
  if (!script) throw new Error("口播文案是空的，请先回到第 1 步选一版文案。");
  const style = styleOf(input.styleKey);
  const splitMode = splitModeOf(input.splitMode);
  const castName = input.castName?.trim() || undefined;
  const sceneNames = (input.sceneNames ?? []).map((item) => String(item ?? "").trim()).filter(Boolean);
  const propNames = (input.propNames ?? []).map((item) => String(item ?? "").trim()).filter(Boolean);
  // 切分规则全面接管切镜：镜数 = 口播总秒数 ÷ 每镜秒数，确定性算出后写进指令（模型对数字最敏感）。
  const splitSeconds = Math.round(splitMode.cap / VIDEO_CHARS_PER_SEC);
  const sourceSeconds = script.replace(/\s/g, "").length / VIDEO_CHARS_PER_SEC;
  const expectedShots = Math.min(12, Math.max(1, Math.round(sourceSeconds / splitSeconds)));
  const llmShots = await llmStoryboardShots(script, null, { style, castName, sceneNames, propNames, cap: splitMode.cap, splitSeconds, autoMerge: splitMode.k === "auto", expectedShots });
  const shots = llmShots.slice(0, 12).map((llm, index) => mergeShot(index, llmShots.length, llm.text, llm, style));
  return {
    shots,
    shotCount: shots.length,
    totalSeconds: shots.reduce((sum, shot) => sum + shot.seconds, 0),
    sourceChars: script.replace(/\s/g, "").length,
    style,
    splitMode,
    negative: VIDEO_NEGATIVE_PROMPT,
    maxSeconds: VIDEO_MAX_SEC,
    maxImages: VIDEO_MAX_IMG,
    imageGroupingNote: "单次请求参考图上限 9 张；超过时按分镜所属场景自动分组调用，人物三视图每次都带。",
    serviceVersion: VIDEO_SCRIPT_LLM_VERSION
  };
}

/** LLM 版单镜重写：文案不变，只重出这一镜的画面描述与提示词。 */
export async function rebuildShotWithLlm(input: RebuildShotInput): Promise<StoryboardShot> {
  const text = String(input.text ?? "").trim();
  if (!text) throw new Error("这一镜的口播原句是空的，请先补上文案再重写");
  const total = Math.max(1, Math.trunc(input.total ?? 1));
  const index = Math.min(total - 1, Math.max(0, Math.trunc(input.index ?? 0)));
  const style = styleOf(input.styleKey);
  const llmShots = await llmStoryboardShots(text, [text], {
    style,
    castName: input.castName?.trim() || undefined,
    sceneNames: input.sceneName?.trim() ? [input.sceneName.trim()] : [],
    propNames: input.propName?.trim() ? [input.propName.trim()] : []
  });
  return mergeShot(index, total, text, llmShots[0], style);
}

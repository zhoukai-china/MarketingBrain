// 兰琪美业门店 AI 经营大脑 · 公域获客 / 视频获客 · 文案转片分镜（规则先行，不调模型，秒回）
//
// 口径（对齐 0909 总纲 + demo `video.html`）：
//   · 贴口播文案 → 按语义断句切成每镜 ≤15 秒的分镜脚本，每镜直接给「生视频提示词」。
//   · 单次视频生成 4–15 秒，所以长文案必须切镜；单次请求参考图上限 9 张，按分镜所属场景分组。
//   · 界面只出现画质档位（草稿预览 480p / 标准成片 720p / 高清成片 1080p）。
//     不出现任何模型名或厂商名 —— 门店用户看不到、也不需要知道背后用什么。
//   · 本文件不含积分 / 计费 / 定价：本阶段不做积分。
//
// 已知口径（demo 对齐）：分镜时长 = round(字数 / 4.5)，夹在 [4, 15] 秒。

export const VIDEO_MAX_SEC = 15;
export const VIDEO_MIN_SEC = 4;
export const VIDEO_MAX_IMG = 9;
export const VIDEO_MAX_AUDIO = 3;
export const VIDEO_CHARS_PER_SEC = 4.5;

/** 负面提示词：与 demo 完全一致，避免畸变、文字水印与风格漂移。 */
export const VIDEO_NEGATIVE_PROMPT =
  "不要出现任何文字、字幕、水印、LOGO；不要人脸畸变、五官扭曲、手指异常；不要画面闪烁、物体变形、镜头剧烈抖动；不要过曝或死黑；不要卡通、油画、3D 渲染感；不要更换人物长相与服装";

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

/** 画质档位：界面唯一允许出现的三档，不含价格与积分。 */
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
  if (body.length > 42) body = body.slice(0, 42);
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
  if (body.length > 70) body = body.slice(0, 70);

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

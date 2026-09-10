// 兰琪美业门店 AI 经营大脑 · 公域获客 / AI 运营顾问
// 确定性规则：平台识别、常见话题识别、输入门禁、回复结构收敛。
// 对齐 demo `methods.html`：先判断平台，判断不出来就反问确认，再给能照做的动作；
// 本模块为纯函数，不触达 DB / Provider，回答正文由 LLM 生成。

export const ADVISOR_RULES_VERSION = "advisor_rules_v1" as const;

// 与 demo 一致：只覆盖抖音 / 视频号 / 美团三个平台
export type AdvisorPlatform = "dy" | "sph" | "mt";

export const ADVISOR_PLATFORMS: Record<AdvisorPlatform, { label: string; emoji: string }> = {
  dy: { label: "抖音", emoji: "🎵" },
  sph: { label: "视频号", emoji: "📺" },
  mt: { label: "美团", emoji: "📍" }
};

export const ADVISOR_PLATFORM_KEYS: AdvisorPlatform[] = ["dy", "sph", "mt"];

export function isAdvisorPlatform(value: unknown): value is AdvisorPlatform {
  return value === "dy" || value === "sph" || value === "mt";
}

// 平台识别顺序与关键词对齐 demo（methods.html detectPlatform）
const PLATFORM_PATTERNS: Array<{ platform: AdvisorPlatform; test: RegExp }> = [
  { platform: "dy", test: /抖音|抖加|dou\+|本地推|同城|口播/i },
  { platform: "sph", test: /视频号|微信视频|朋友圈|转发|没人转/ },
  { platform: "mt", test: /美团|大众点评|团购|星级|差评|评价/ }
];

export function detectPlatform(text: string): AdvisorPlatform | null {
  const value = (text ?? "").trim();
  if (!value) return null;
  for (const item of PLATFORM_PATTERNS) {
    if (item.test.test(value)) return item.platform;
  }
  return null;
}

// 常见经营话题：命中后作为提示词里的「可参考打法」与来源标签，避免模型自由发挥
export interface AdvisorTopicSpec {
  key: string;
  label: string;
  test: RegExp;
  sources: string[];
}

export const ADVISOR_TOPICS: AdvisorTopicSpec[] = [
  {
    key: "review",
    label: "评价与星级",
    test: /差评|星级|评分|评价管理|好评|口碑/,
    sources: ["评价处理要点", "差评应对话术", "AI 客户分析"]
  },
  {
    key: "no-time",
    label: "没空持续产出",
    test: /没空|没时间|拍视频|持续获客|素材|复刻|人手不够/,
    sources: ["视频获客 · 爆款复刻", "AI 剪辑", "内容再利用"]
  },
  {
    key: "forward",
    label: "转发与裂变",
    test: /没人转|转发|裂变|老客户带|朋友圈联动/,
    sources: ["视频号转发要点", "朋友圈获客", "私域话术生成"]
  },
  {
    key: "ads",
    label: "投放与转化",
    test: /本地推|投放|投流|没转化|转化率|留资|私信/,
    sources: ["本地推投放要点", "抖音起号要点", "AI 模拟销售"]
  },
  {
    key: "margin",
    label: "团购与利润",
    test: /利润|团购|压价|低价|被抽成|升单/,
    sources: ["团购承接要点", "到店升单设计", "AI 模拟销售"]
  },
  {
    key: "startup",
    label: "新店起步",
    test: /新店|新开|刚开|预算|起步|从哪(个|里)开始|第一周/,
    sources: ["抖音起号要点", "视频号裂变要点", "美团承接要点"]
  }
];

export function detectTopics(text: string): AdvisorTopicSpec[] {
  const value = (text ?? "").trim();
  if (!value) return [];
  return ADVISOR_TOPICS.filter((topic) => topic.test.test(value));
}

export function advisorGate(question: string | undefined): string | null {
  const value = (question ?? "").trim();
  if (!value) return "请先描述你的门店情况和想问的运营问题";
  if (value.length < 4) return "问题还差一些信息，请把门店情况和想问的事说得具体一点";
  return null;
}

/** demo 的反问话术：平台识别不出来时先确认，不猜。 */
export function platformAskBack(): string {
  return "你这个问题没有明确提到具体平台。你想咨询的是抖音、视频号还是美团？我确认后给你针对性的动作清单。";
}

export interface AdvisorStep {
  title: string;
  detail: string;
}

export interface AdvisorAnswer {
  summary: string;
  steps: AdvisorStep[];
  followUps: string[];
  sources: string[];
  /** 需要用户补充的信息，没有则为空数组 */
  needInfo: string[];
}

const MAX_STEPS = 5;
const MIN_STEPS = 3;

/** 把模型输出收敛成 demo 的回复结构：一句结论 + 3~5 条动作 + 追问 + 来源标签。 */
export function normalizeSteps(value: unknown): AdvisorStep[] {
  if (!Array.isArray(value)) return [];
  const steps: AdvisorStep[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const title = typeof record.title === "string" ? record.title.trim() : "";
    const detail = typeof record.detail === "string" ? record.detail.trim() : "";
    if (!title && !detail) continue;
    steps.push({ title: title || detail.slice(0, 12), detail });
    if (steps.length >= MAX_STEPS) break;
  }
  return steps;
}

export function stepsAreUsable(steps: AdvisorStep[]): boolean {
  if (steps.length < MIN_STEPS) return false;
  return steps.every((step) => step.detail.length >= 8);
}

export function stringList(value: unknown, max: number, perItemMax = 40): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const text = item.trim();
    if (!text) continue;
    out.push(text.slice(0, perItemMax));
    if (out.length >= max) break;
  }
  return out;
}

/** 来源标签：优先用模型给的、限 3 条；太少时用命中话题的确定性标签补齐。 */
export function buildSources(value: unknown, topics: AdvisorTopicSpec[], max = 3): string[] {
  const fromModel = stringList(value, max, 20);
  if (fromModel.length >= max) return fromModel;
  const merged = [...fromModel];
  for (const topic of topics) {
    for (const source of topic.sources) {
      if (merged.length >= max) break;
      if (!merged.includes(source)) merged.push(source);
    }
    if (merged.length >= max) break;
  }
  return merged;
}

/** 回答里出现的平台必须是我们支持的平台，避免把用户往别的平台带。 */
export function mentionsForeignPlatform(text: string): string | null {
  const foreign = ["快手", "小红书", "微博", "B站", "哔哩哔哩", "淘宝", "天猫", "京东", "拼多多"];
  for (const name of foreign) {
    if (text.includes(name)) return name;
  }
  return null;
}

// 兰琪美业门店 AI 经营大脑 · 公域获客 / AI 运营顾问（对齐 demo `methods.html`）
// 流程：识别平台 → 识别不出来先反问 → 结合门店情况给「第一周动作清单」。
// 回答正文由真实大模型生成；平台识别、结构门禁、合规检查由 advisor-rules 确定性执行。

import { createRuntimeLlmProvider } from "../../services/llm-provider-factory.js";
import type { LlmMessage } from "@baolu/agent";
import { containsAbsWords, containsBanWords } from "./moments-rules.js";
import {
  ADVISOR_PLATFORMS,
  ADVISOR_RULES_VERSION,
  type AdvisorAnswer,
  type AdvisorPlatform,
  type AdvisorStep,
  type AdvisorTopicSpec,
  advisorGate,
  buildSources,
  detectPlatform,
  detectTopics,
  isAdvisorPlatform,
  mentionsForeignPlatform,
  normalizeSteps,
  platformAskBack,
  stepsAreUsable,
  stringList
} from "./advisor-rules.js";

export const ADVISOR_SERVICE_VERSION = "advisor_service_v2" as const;

export interface AdvisorTurn {
  role: "user" | "ai";
  content: string;
}

export interface AdvisorInput {
  storeId: string;
  question: string;
  /** auto = 让系统识别；也可由上一轮反问确认后显式指定 */
  platform?: AdvisorPlatform | "auto";
  history?: AdvisorTurn[];
}

export interface AdvisorResult {
  platform: AdvisorPlatform | null;
  platformLabel: string;
  /** true = 平台没识别出来，先反问确认，本次不产出动作清单 */
  needPlatform: boolean;
  askBack?: string;
  answer?: AdvisorAnswer;
  traceId: string;
}

/** 只依赖「把 messages 变成文本」这一步，便于用假 Provider 做确定性回归。 */
export interface AdvisorCompletion {
  complete: (messages: LlmMessage[]) => Promise<string>;
}

/** 合规/结构门禁最多重试一次：第一次被拦，带拦截原因让模型重写；第二次还不通过就失败关闭。 */
export const ADVISOR_MAX_ATTEMPTS = 2;

interface RawAdvisorPayload {
  summary?: unknown;
  steps?: unknown;
  followUps?: unknown;
  sources?: unknown;
  needInfo?: unknown;
}

const SYSTEM_PROMPT = [
  "你是美业门店的 AI 运营顾问，只服务生活美容、皮肤管理、美甲美睫、SPA 养生、美发这类门店。",
  "你只讲抖音、视频号、美团三个平台；绝对不要提其它平台，也不要建议门店去别的平台开号。",
  "回答铁律（违反即不可用）：",
  "- 不编造数据、政策、算法规则、平台补贴或具体案例；不确定就写成需要门店自己核对。",
  "- 不承诺效果：禁止「保证、一定、快速见效、包涨粉、稳赚」这类说法。",
  "- 禁止违规引导词：私信、打电话、加我、找我、留个、扫码、进群、加微信。",
  "- 禁止绝对化词与医疗疗效词：根治、永久、最好、排名宣称（全城第一／销量第一／第一品牌）、100%、特效、治愈、药用、祛除、七天见效；序数用法（第一次、第一周、第一部分）正常，不算违规。",
  "- 生活美容不得承诺医疗功效；价格一律用「参考」，不承诺确定效果。",
  "回答要求：",
  "- 直接给能照做的动作，不写空话、不写行业分析报告，不说「建议您考虑一下」这类没法执行的话。",
  "- steps：3~5 条，按第一周执行顺序排好优先级；title 是 6~14 字的动作名，detail 是 30~90 字的具体做法（写清谁做、做什么、做到什么程度）。",
  "- summary：一句话结论（40 字内），先说这家店最该修的那一件事。",
  "- followUps：2~3 条用户可能接着问的问题，每条 20 字内。",
  "- sources：2~3 个参考来源标签，每个 12 字内（例如「本地推投放要点」）。",
  "- needInfo：如果门店情况不足以给具体动作，列出还需要用户补充的信息（每条 15 字内），最多 3 条；信息够就给空数组。",
  "只输出 JSON，不要输出任何其它文字。",
  'JSON 结构：{"summary":"","steps":[{"title":"","detail":""}],"followUps":[""],"sources":[""],"needInfo":[""]}'
].join("\n");

function parseJson(text: string): RawAdvisorPayload | null {
  const fenced = text.match(/```json\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as RawAdvisorPayload;
  } catch {
    return null;
  }
}

const str = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/**
 * 平台判定：显式指定（上一轮反问确认后的结果）优先，其次看本轮问句，
 * 最后回头看上文——避免用户追问「那具体怎么做」时又被打回反问。
 */
export function resolveAdvisorPlatform(
  question: string,
  requested: AdvisorPlatform | "auto" | undefined,
  history: AdvisorTurn[]
): AdvisorPlatform | null {
  if (isAdvisorPlatform(requested)) return requested;
  const detected = detectPlatform(question);
  if (detected) return detected;
  return detectPlatform(history.map((turn) => turn.content).join(" "));
}

export function buildAdvisorPrompt(
  question: string,
  platform: AdvisorPlatform,
  topics: AdvisorTopicSpec[],
  history: AdvisorTurn[],
  repairNotes: string[] = []
): LlmMessage[] {
  const lines = [`平台：${ADVISOR_PLATFORMS[platform].label}`];
  if (topics.length) lines.push(`识别到的问题类型：${topics.map((topic) => topic.label).join("、")}`);
  if (topics.length) {
    const hints = topics.flatMap((topic) => topic.sources);
    lines.push(`可参考的自有打法：${Array.from(new Set(hints)).join("、")}`);
  }
  const recent = history.slice(-4);
  if (recent.length) {
    lines.push("", "对话上文：");
    for (const turn of recent) lines.push(`${turn.role === "user" ? "门店" : "顾问"}：${turn.content.slice(0, 300)}`);
  }
  lines.push("", "门店这次问的问题：", question);
  if (repairNotes.length) {
    lines.push(
      "",
      "重要：你上一次的输出被系统的合规与结构门禁拦截了，拦截原因：",
      ...repairNotes.map((note) => `- ${note}`),
      "请重新输出一份 JSON，彻底避开上述问题：被拦截的词一个都不要出现，用别的说法表达同样的动作；不要复述这些被拦截的词；平台名称只能用抖音、视频号、美团。"
    );
  }
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: lines.join("\n") }
  ];
}

/** 纯函数：把模型输出收敛成可展示结构，并做结构与合规门禁。 */
export function normalizeAdvisorAnswer(
  payload: unknown,
  topics: AdvisorTopicSpec[]
): AdvisorAnswer {
  const record = (payload ?? {}) as RawAdvisorPayload;
  const steps: AdvisorStep[] = normalizeSteps(record.steps);
  if (!stepsAreUsable(steps)) throw new Error("顾问回答结构不完整，请重试一次");
  const summary = str(record.summary);
  if (!summary) throw new Error("顾问回答缺少结论，请重试一次");

  const answer: AdvisorAnswer = {
    summary,
    steps,
    followUps: stringList(record.followUps, 3, 24),
    sources: buildSources(record.sources, topics),
    needInfo: stringList(record.needInfo, 3, 18)
  };

  const joined = [answer.summary, ...answer.steps.map((step) => `${step.title}${step.detail}`)].join("\n");
  const banHits = containsBanWords(joined);
  if (banHits.length) throw new Error(`顾问回答命中违规引导词：${banHits.map((hit) => hit.word).join("、")}`);
  const absHits = containsAbsWords(joined);
  if (absHits.length) throw new Error(`顾问回答命中绝对化/疗效词：${absHits.map((hit) => hit.word).join("、")}`);
  const foreign = mentionsForeignPlatform(joined);
  if (foreign) throw new Error(`顾问回答提到了不支持的平台：${foreign}`);

  return answer;
}

export async function answerAdvisorQuestion(input: AdvisorInput): Promise<AdvisorResult> {
  if (!input.storeId || !input.storeId.trim()) throw new Error("缺少门店标识 store_id");
  const question = (input.question ?? "").trim();
  const gate = advisorGate(question);
  if (gate) throw new Error(gate);

  const history = Array.isArray(input.history) ? input.history.slice(-6) : [];
  const platform = resolveAdvisorPlatform(question, input.platform, history);

  if (!platform) {
    return {
      platform: null,
      platformLabel: "",
      needPlatform: true,
      askBack: platformAskBack(),
      traceId: `advisor:${ADVISOR_SERVICE_VERSION}:ask-platform:${Date.now()}`
    };
  }

  const topics = detectTopics(question);
  const provider = createRuntimeLlmProvider();
  if (!provider.isConfigured()) throw new Error("llm_provider_not_configured");
  const answer = await runAdvisorAnswer(question, platform, topics, history, {
    complete: (messages) =>
      provider.complete(messages, { maxTokens: 1600, reasoningProfile: "standard", thinkingMode: "disabled" })
  });
  return {
    platform,
    platformLabel: ADVISOR_PLATFORMS[platform].label,
    needPlatform: false,
    answer,
    traceId: `advisor:${ADVISOR_SERVICE_VERSION}:${platform}:${Date.now()}`
  };
}

/**
 * 产出一次可用答案：模型输出先过结构与合规门禁；
 * 被拦一次就把拦截原因回灌给模型重写（最多 {@link ADVISOR_MAX_ATTEMPTS} 次），
 * 全部不通过则失败关闭，不把不合规内容或编造内容兜给门店。
 */
export async function runAdvisorAnswer(
  question: string,
  platform: AdvisorPlatform,
  topics: AdvisorTopicSpec[],
  history: AdvisorTurn[],
  completion: AdvisorCompletion
): Promise<AdvisorAnswer> {
  const repairNotes: string[] = [];
  for (let attempt = 1; attempt <= ADVISOR_MAX_ATTEMPTS; attempt += 1) {
    const rawText = await completion.complete(buildAdvisorPrompt(question, platform, topics, history, repairNotes));
    const parsed = parseJson(rawText);
    if (!parsed) {
      repairNotes.push("输出不是合法 JSON，无法解析出动作清单");
      continue;
    }
    try {
      return normalizeAdvisorAnswer(parsed, topics);
    } catch (error) {
      repairNotes.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw new Error(`顾问回答未通过合规与结构门禁：${repairNotes.join("；")}`);
}

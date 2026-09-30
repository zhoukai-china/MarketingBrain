import { createLanqiTaskLlmProvider } from "./llm-provider-factory.js";
import type { LlmMessage } from "@baolu/agent";

/**
 * IP 定位访谈的「消化回应 + 下一题候选」生成（2026-09-30 用户）。
 *
 * 背景：原来 8 问的示例选项/承接话术全部写死成「XX贴膜」案例，换个行业（比如火锅底料）
 * 就答非所问，而且点一下示例就会把别人的生意数据并进简报。改为按已填字段实时生成。
 *
 * 模型：`LANQI_LOW_RISK_TEXT_MODEL`（deepseek-v4-flash / qwen3.8-flash，flash 档），
 * 走 `low_risk_formatting` 任务分类——这正是该配置项的设计用途。
 *
 * 红线：
 * - digest 只做承接，**不编造数字/事实**（不替用户说「3000平供应链」这种具体数据）；
 * - candidates 是「候选示例」，前端点选后**先放进输入框**让用户改，确认后才进简报——
 *   模型产出永远不直接落库。
 * 任何失败都返回 { digest: null, candidates: [] }，前端回退到写死的兜底话术，流程不卡。
 */

export interface InterviewHintsInput {
  /** 已填字段（key = FIELDS 的 key）。 */
  answered: Record<string, string>;
  /** 用户刚回答的字段 key。 */
  answeredField: string;
  /** 用户刚回答的原话。 */
  answeredText: string;
  /** 下一题（null = 访谈已结束）。 */
  next: { fields: string[]; q: string; hint?: string } | null;
  /** 访谈官人设（2026-09-30 泛化：文案/直播等工作台共用同一接口）。缺省 = IP 定位的沈定。 */
  persona?: { name: string; role: string };
}

export interface InterviewHints {
  digest: string | null;
  candidates: string[];
}

const MAX_CANDIDATES = 3;

export async function generateInterviewHints(input: InterviewHintsInput): Promise<InterviewHints> {
  const provider = createLanqiTaskLlmProvider("low_risk_formatting");
  if (!provider.isConfigured()) return { digest: null, candidates: [] };

  const answeredLines =
    Object.entries(input.answered)
      .filter(([, v]) => typeof v === "string" && v.trim())
      .map(([k, v]) => `- ${k}: ${v.slice(0, 200)}`)
      .join("\n") || "（暂无）";

  const nextPart = input.next
    ? `下一题要收集的字段：${input.next.fields.join("、")}\n下一题的问题：「${input.next.q}」`
    : "访谈已到最后一题之后，没有下一题了，candidates 返回空数组。";

  const persona = input.persona ?? { name: "沈定", role: "IP 定位访谈官" };
  const system = [
    `你是「${persona.name}」，${persona.role}，正在引导用户做创作前的信息收集访谈（一次只问一个维度）。`,
    "任务：",
    "1) 针对用户刚回答的内容给 1-2 句「消化回应」：口语、直接、不复述原话，点出这个回答里对后续创作有用的点；不编造数字或事实。",
    "2) 为下一题生成 2-3 个贴合用户行业/角色的候选答案示例：每条 ≤40 字，是「用户可能会怎么答」的样子；用户会修改后使用。",
    "硬性要求：只输出 JSON，格式 {\"digest\":\"...\",\"candidates\":[\"...\"]}，不要任何其它文字或代码块标记。"
  ].join("\n");

  const user = [
    "已确认信息：",
    answeredLines,
    "",
    `用户刚回答了「${input.answeredField}」：「${input.answeredText.slice(0, 800)}」`,
    "",
    nextPart
  ].join("\n");

  const messages: LlmMessage[] = [
    { role: "system", content: system },
    { role: "user", content: user }
  ];

  try {
    const raw = await provider.complete(messages, {
      maxTokens: 600,
      reasoningProfile: "standard",
      thinkingMode: "disabled"
    });
    const jsonText = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
    const parsed = JSON.parse(jsonText) as { digest?: unknown; candidates?: unknown };
    const digest =
      typeof parsed.digest === "string" &&
      parsed.digest.trim().length >= 4 &&
      parsed.digest.length <= 300
        ? parsed.digest.trim()
        : null;
    const candidates = Array.isArray(parsed.candidates)
      ? parsed.candidates
          .filter((c): c is string => typeof c === "string" && c.trim().length > 0 && c.trim().length <= 80)
          .slice(0, MAX_CANDIDATES)
      : [];
    return { digest, candidates };
  } catch {
    // 模型超时/限流/格式不合法：静默回退，前端用写死的兜底话术，访谈流程不卡。
    return { digest: null, candidates: [] };
  }
}

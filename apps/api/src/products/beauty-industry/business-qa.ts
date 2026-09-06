import { createHash } from "node:crypto";
import type { LanqiStoreProfileFacts, LanqiStoreProfileField } from "../../services/lanqi-store-profile.js";

export const BEAUTY_BUSINESS_QA_CAPABILITY = "beauty_business_qa";
export const BEAUTY_BUSINESS_QA_AGENT = "agent_beauty_acquisition";
export const BEAUTY_BUSINESS_QA_SKILL = "general_qa";
export const BEAUTY_BUSINESS_QA_SKILL_VERSION = "0.2.0";
export const BEAUTY_BUSINESS_QA_PROMPT = [
  "回答美业门店经营问题。只使用当前租户已确认事实；缺失资料明确待补，不编造价格、疗效、顾客案例、业绩或已执行动作。",
  "回答必须按顺序使用四个 Markdown 二级标题：## 先给结论、## 今天先做、## 可以直接使用、## 仍需确认。标题不得改名、合并或省略。",
  "在“可以直接使用”下给出门店老板可以复制执行的话术或清单；高风险或要求编造的请求要明确拒绝，再给合规替代动作。"
].join("\n");

const factLabels: Record<LanqiStoreProfileField, string> = {
  storeName: "门店名称",
  city: "所在城市",
  businessArea: "商圈/区域",
  storeType: "门店类型",
  mainServices: "主营服务",
  teamSize: "团队规模",
  monthlyRevenueRange: "月营收区间",
  monthlyNewCustomersRange: "月新增顾客区间",
  repeatPurchaseRateRange: "复购率区间",
  customerProfile: "主要客群",
  primaryChannels: "主要获客渠道",
  currentChallenges: "当前经营难题",
  notes: "补充说明"
};

export function buildBeautyBusinessQaInput(params: {
  question: string;
  confirmedFacts: LanqiStoreProfileFacts;
  needsInput: LanqiStoreProfileField[];
}): string {
  const confirmed = Object.entries(params.confirmedFacts).flatMap(([key, value]) => {
    if (!value) return [];
    const label = factLabels[key as LanqiStoreProfileField] ?? key;
    return [`- ${label}：${Array.isArray(value) ? value.join("、") : value}`];
  });
  const missing = params.needsInput.map(field => factLabels[field]);
  return [
    `【固定美业能力】${BEAUTY_BUSINESS_QA_CAPABILITY}`,
    "【美业经营问答｜事实边界】",
    "本轮用户问题：",
    params.question.trim(),
    "",
    "当前租户已确认门店事实：",
    ...(confirmed.length ? confirmed : ["- 暂无已确认经营档案；回答只能给通用起步动作，不得补造门店事实。"]),
    "",
    "仍待补资料：",
    ...(missing.length ? missing.map(item => `- ${item}`) : ["- 本轮没有登记待补字段。"]),
    "",
    "回答要求：先给结论，再给今天可执行动作；如需话术或清单，直接给可复制版本。只使用上面的已确认事实；价格、疗效、顾客案例、业绩和已执行动作没有证据时不得补造。缺资料不阻断通用建议，但要把会影响个性化判断的最关键一项放到“仍需确认”。"
  ].join("\n");
}

export function createBeautyBusinessQaFingerprint(params: { tenantId: string; conversationId?: string; question: string }): string {
  return createHash("sha256")
    .update(JSON.stringify({ capability: BEAUTY_BUSINESS_QA_CAPABILITY, ...params, question: params.question.trim() }))
    .digest("hex");
}

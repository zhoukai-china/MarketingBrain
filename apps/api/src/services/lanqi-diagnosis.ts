import type { LanqiStoreProfileFacts, LanqiStoreProfileField } from "./lanqi-store-profile.js";

export interface LanqiStoreProfileDiagnosisInput {
  confirmedFacts: LanqiStoreProfileFacts;
  estimatedFacts: LanqiStoreProfileFacts;
  needsInput: LanqiStoreProfileField[];
}

export interface LanqiDiagnosisFinding {
  title: string;
  detail: string;
  source: "confirmed" | "estimated" | "needs_input" | "missing";
  fields: LanqiStoreProfileField[];
}

export interface LanqiDiagnosisReport {
  generatedAt: string;
  summary: string;
  confidence: "资料不足" | "基础可诊断";
  knowledgeStatus: "pending_authorized_knowledge";
  knowledgeMessage: string;
  evidence: LanqiDiagnosisFinding[];
  priorities: LanqiDiagnosisFinding[];
  blockedOutputs: string[];
}

const requiredFoundationFields: LanqiStoreProfileField[] = [
  "storeName", "city", "storeType", "mainServices", "teamSize", "monthlyRevenueRange", "monthlyNewCustomersRange", "repeatPurchaseRateRange", "primaryChannels", "currentChallenges",
];

const fieldLabels: Record<LanqiStoreProfileField, string> = {
  storeName: "门店名称", city: "所在城市", businessArea: "商圈 / 区域", storeType: "门店类型", mainServices: "主营服务", teamSize: "团队规模", monthlyRevenueRange: "月营收区间", monthlyNewCustomersRange: "月新增客户区间", repeatPurchaseRateRange: "复购率区间", customerProfile: "主要客群", primaryChannels: "主要获客渠道", currentChallenges: "当前经营难题", notes: "补充说明",
};

function hasFact(facts: LanqiStoreProfileFacts, field: LanqiStoreProfileField): boolean {
  const value = facts[field];
  return Array.isArray(value) ? value.length > 0 : typeof value === "string" && value.trim().length > 0;
}

function labels(fields: LanqiStoreProfileField[]): string {
  return fields.map(field => fieldLabels[field]).join("、");
}

export function buildLanqiDiagnosis(input: LanqiStoreProfileDiagnosisInput, now = new Date()): LanqiDiagnosisReport {
  const confirmed = requiredFoundationFields.filter(field => hasFact(input.confirmedFacts, field));
  const estimated = requiredFoundationFields.filter(field => !hasFact(input.confirmedFacts, field) && hasFact(input.estimatedFacts, field));
  const explicitNeeds = requiredFoundationFields.filter(field => input.needsInput.includes(field));
  const missing = requiredFoundationFields.filter(field => !confirmed.includes(field) && !estimated.includes(field) && !explicitNeeds.includes(field));
  const missingOrNeeded = [...explicitNeeds, ...missing];
  const confidence = confirmed.length >= 4 && missingOrNeeded.length <= 4 ? "基础可诊断" : "资料不足";
  const evidence: LanqiDiagnosisFinding[] = [];

  if (confirmed.length) evidence.push({ title: "已确认经营事实", detail: `当前已确认：${labels(confirmed)}。这些内容可作为后续诊断的事实依据。`, source: "confirmed", fields: confirmed });
  if (estimated.length) evidence.push({ title: "仍属经营估算", detail: `当前以估算记录：${labels(estimated)}。后续结论会保留“待核实”标识。`, source: "estimated", fields: estimated });
  if (missingOrNeeded.length) evidence.push({ title: "诊断资料缺口", detail: `尚需补充：${labels(missingOrNeeded)}。系统不会用行业常识补写为门店事实。`, source: explicitNeeds.length ? "needs_input" : "missing", fields: missingOrNeeded });
  if (!evidence.length) evidence.push({ title: "尚无门店资料", detail: "请先完成门店经营档案，兰琪 AI 才能给出有依据的经营判断。", source: "missing", fields: requiredFoundationFields });

  const priorities: LanqiDiagnosisFinding[] = [];
  const growthFields = missingOrNeeded.filter(field => ["monthlyRevenueRange", "monthlyNewCustomersRange", "repeatPurchaseRateRange", "primaryChannels"].includes(field));
  const deliveryFields = missingOrNeeded.filter(field => ["storeType", "mainServices", "teamSize", "currentChallenges"].includes(field));
  if (growthFields.length) priorities.push({ title: "优先补齐增长与复购数据", detail: `先补：${labels(growthFields)}。这是判断获客、成交与复购是否需要优先处理的前提。`, source: "needs_input", fields: growthFields });
  if (deliveryFields.length) priorities.push({ title: "补齐门店服务与团队现状", detail: `再补：${labels(deliveryFields)}。这决定后续建议是否适用于本门店。`, source: "needs_input", fields: deliveryFields });
  if (!priorities.length) priorities.push({ title: "进入兰琪方法论诊断前的核实", detail: "基础字段已较完整；下一步需由门店核实估算数据，并加载经授权且生效的兰琪方法论。", source: "estimated", fields: estimated });

  return {
    generatedAt: now.toISOString(),
    summary: confidence === "资料不足" ? "当前资料不足以形成完整经营诊断，先完成关键事实补充。" : "已具备基础资料诊断条件；下一步应核实估算数据并接入已授权兰琪方法论。",
    confidence,
    knowledgeStatus: "pending_authorized_knowledge",
    knowledgeMessage: "当前尚未加载经兰琪授权并生效的方法论或内部定价，因此本报告只呈现资料诊断；不会输出项目、价格或效果承诺。",
    evidence,
    priorities,
    blockedOutputs: ["兰琪项目建议", "内部定价建议", "效果承诺", "未经确认的外部执行动作"],
  };
}

import type { LanqiStoreProfileDiagnosisInput } from "./lanqi-diagnosis.js";
import type { LanqiStoreProfileFacts, LanqiStoreProfileField } from "./lanqi-store-profile.js";

type FactStatus = "confirmed" | "estimated" | "needs_input" | "missing";
type StepStatus = "ready_to_prepare" | "blocked";

export interface LanqiExecutionPlanStep {
  id: "store_goal" | "lanqi_project_and_pricing" | "acquisition_and_closing";
  title: string;
  status: StepStatus;
  detail: string;
  requiredFacts: LanqiStoreProfileField[];
  requiredAuthorization: string[];
}

export interface LanqiExecutionPlanReport {
  generatedAt: string;
  executionReadiness: "blocked_pending_store_facts" | "blocked_pending_authorized_knowledge";
  summary: string;
  actionMode: "draft_only";
  factStatuses: Array<{ field: LanqiStoreProfileField; status: FactStatus }>;
  requiredKnowledge: string[];
  steps: LanqiExecutionPlanStep[];
  safetyBoundaries: string[];
}

const planFoundationFields: LanqiStoreProfileField[] = [
  "storeName", "city", "storeType", "mainServices", "monthlyNewCustomersRange", "repeatPurchaseRateRange", "primaryChannels", "currentChallenges",
];

function hasFact(facts: LanqiStoreProfileFacts, field: LanqiStoreProfileField): boolean {
  const value = facts[field];
  return Array.isArray(value) ? value.length > 0 : typeof value === "string" && value.trim().length > 0;
}

function getFactStatus(input: LanqiStoreProfileDiagnosisInput, field: LanqiStoreProfileField): FactStatus {
  if (hasFact(input.confirmedFacts, field)) return "confirmed";
  if (hasFact(input.estimatedFacts, field)) return "estimated";
  if (input.needsInput.includes(field)) return "needs_input";
  return "missing";
}

export function buildLanqiExecutionPlan(input: LanqiStoreProfileDiagnosisInput, now = new Date()): LanqiExecutionPlanReport {
  const factStatuses = planFoundationFields.map(field => ({ field, status: getFactStatus(input, field) }));
  const missingFacts = factStatuses.filter(item => item.status === "needs_input" || item.status === "missing").map(item => item.field);
  const hasFoundation = missingFacts.length === 0;

  return {
    generatedAt: now.toISOString(),
    executionReadiness: hasFoundation ? "blocked_pending_authorized_knowledge" : "blocked_pending_store_facts",
    summary: hasFoundation
      ? "门店基础资料已具备方案准备条件；正式方案仍须接入经兰琪授权且生效的项目、内部定价与获客成交方法论。"
      : "当前门店资料尚未齐备，系统只生成准备清单，不会补写经营事实或形成正式方案。",
    actionMode: "draft_only",
    factStatuses,
    requiredKnowledge: ["经兰琪授权并生效的项目定义", "经兰琪授权并生效的内部定价版本", "经兰琪授权的获客与成交 SOP"],
    steps: [
      {
        id: "store_goal",
        title: "核对本店目标与经营事实",
        status: hasFoundation ? "ready_to_prepare" : "blocked",
        detail: hasFoundation
          ? "可由门店核对已记录的事实与估算项，为后续授权方案建立确认底稿。"
          : "请先补齐资料缺口；系统不会用行业常识替代本店事实。",
        requiredFacts: missingFacts,
        requiredAuthorization: [],
      },
      {
        id: "lanqi_project_and_pricing",
        title: "匹配兰琪项目与内部定价",
        status: "blocked",
        detail: "等待兰琪提供并确认适用于本门店的授权项目定义和内部定价版本后才能开启。",
        requiredFacts: planFoundationFields,
        requiredAuthorization: ["项目定义", "内部定价版本", "适用门店范围"],
      },
      {
        id: "acquisition_and_closing",
        title: "生成获客与成交执行草案",
        status: "blocked",
        detail: "等待兰琪授权的获客与成交 SOP 接入后才能生成；在此之前不输出话术、承诺或外部执行动作。",
        requiredFacts: ["primaryChannels", "currentChallenges", "monthlyNewCustomersRange", "repeatPurchaseRateRange"],
        requiredAuthorization: ["获客 SOP", "成交 SOP", "适用边界与审核规则"],
      },
    ],
    safetyBoundaries: [
      "仅生成准备清单和草案框架，不执行投放、发消息、付款、发布或其他外部动作。",
      "推荐关系不提供其他门店的资料、经营数据或方案访问权。",
      "未接入兰琪授权知识前，不展示项目名称、内部定价、效果承诺或获客成交话术。",
    ],
  };
}

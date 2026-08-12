import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  TAKEAWAY_DIAGNOSIS_MODULES,
  buildTakeawayWorkbenchPrompt,
  resolveTakeawayDiagnosisReadiness,
  takeawayFieldLabel,
  type TakeawayDiagnosisModuleId,
  type TakeawayStoreStage,
  type TakeawayWorkbenchDataStatus
} from "./takeaway-workbench-config.js";
import { TakeawayAnalysisBoard, type TakeawayAnalysisView } from "./TakeawayAnalysisBoard.js";

interface Props {
  brandName: string;
  storageScope?: string;
  dataStatus: TakeawayWorkbenchDataStatus | null;
  busy: boolean;
  latestResult: { id: string; content?: string; deliveryStatus?: "completed" | "needs_input" | "failed" } | null;
  latestResultContent?: ReactNode;
  onOpenImport: () => void;
  onRun: (capabilityId: string, prompt: string, display: string) => void;
  onOpenTaskMap: () => void;
  onOpenCapability?: (capabilityId: string) => void;
  importSlot?: ReactNode;
  mapEntry?: { capabilityId: string; requestId: number } | null;
  conversationMessages?: Array<{ id: string; role: "user" | "assistant"; content: string; rendered?: ReactNode }>;
}

const TAKEAWAY_TASK_MAP_TASKS: Record<string, { title: string; description: string }> = {
  takeaway_data_foundation: { title: "数据与经营阶段", description: "上传完成后自动检查数据是否可用、能判断什么和还缺什么；本页不生成增长结论。" },
  mature_store_growth: { title: "老店增长", description: "找出老店最近掉单或增长停住的主要位置。" },
  new_store_breakthrough: { title: "新店起量", description: "帮助新店先解决曝光、进店和首批订单问题。" },
  takeaway_growth: { title: "AI经营诊断", description: "进入即输出一份完整诊断；AI优先寻找跨平台、漏斗、时段、货盘与经营动作之间的组合信号。" },
  takeaway_problem_validation: { title: "问题验证", description: "从优先候选中每轮只验证1个原因，确认它究竟成立还是不成立。" },
  takeaway_menu_profit: { title: "菜单和利润", description: "看看菜品、套餐和价格哪里需要调整。" },
  takeaway_campaign_roi: { title: "活动和投放", description: "看看钱花得值不值，下一步先改哪里。" },
  takeaway_competitor_loss: { title: "顾客可能去了哪里", description: "寻找顾客流失的方向和可以先做的应对。" },
  takeaway_experiment: { title: "增长落地方案", description: "只针对已经验证的问题，生成可审批、可执行、可止损的增长方案。" },
  takeaway_execution: { title: "真实执行与每日回填", description: "门店按已审批方案真实落地，并逐日填写动作、指标和异常。" },
  takeaway_effect_evaluation: { title: "增长效果评估", description: "对比同口径基线与执行期，判断是否真的增长及有无副作用。" },
  takeaway_review: { title: "周期复盘与决策", description: "综合诊断、验证、执行和效果评估，决定继续、调整、停止或进入下一轮。" }
};

function auditImpact(field: string): string {
  if (/cost|成本/i.test(field)) return "缺少成本，不能判断菜品实际赚多少钱。";
  if (/refund|退款/i.test(field)) return "缺少退款，成交额和真实完成订单可能被高估。";
  if (/orderId|订单号/i.test(field)) return "缺少订单号，无法准确排除重复订单。";
  if (/product|quantity|菜品|份数|销量/i.test(field)) return "缺少菜品和份数，不能判断哪些菜拉动或拖累订单。";
  if (/campaign|spend|budget|计划|消耗|预算/i.test(field)) return "缺少每个投放计划的花费，不能判断哪笔钱花得值。";
  if (/date|日期/i.test(field)) return "缺少日期，不能比较变化发生在哪一天。";
  return "缺少这项数据会限制对应分析，补齐后判断会更可靠。";
}

type TaskChatMode = "ask" | "revise";

function buildTaskChatScreenContext(dataStatus: TakeawayWorkbenchDataStatus | null): string {
  if (!dataStatus) return "页面尚未导入经营数据，当前没有可解释的数据分数或分析结果。";
  const summary = dataStatus.analysis?.summary;
  const coverageFacts = [
    dataStatus.coverage.funnel ? "订单、退款与实付" : undefined,
    dataStatus.coverage.products ? "菜品销量" : undefined,
    dataStatus.coverage.catalog ? "菜品货盘" : undefined,
    dataStatus.coverage.prices ? "菜品价格" : undefined,
    dataStatus.coverage.costs ? "菜品成本" : undefined,
    dataStatus.coverage.campaigns ? dataStatus.campaignEvidence === "detail" ? "计划级活动投放" : "活动成本汇总" : undefined
  ].filter(Boolean);
  const summaryFacts = [
    summary?.effectiveOrders !== undefined ? `有效完成单：${summary.effectiveOrders.toLocaleString("zh-CN")}` : undefined,
    summary?.paidAmount !== undefined ? `实付金额：${summary.paidAmount.toLocaleString("zh-CN")}` : undefined,
    summary?.averageOrderValue !== undefined ? `客单价：${summary.averageOrderValue.toFixed(1)}` : undefined,
    summary?.refundRate !== undefined ? `退款率：${(summary.refundRate * 100).toFixed(1)}%` : undefined,
    summary?.averagePrepMinutes !== undefined ? `平均出餐：${summary.averagePrepMinutes.toFixed(1)}分钟` : undefined
  ].filter(Boolean);
  const anomalyFacts = (dataStatus.analysis?.anomalies ?? []).slice(0, 6)
    .map((item) => `${item.title}；证据：${item.evidence}；验证：${item.verification}`);
  return [
    `当前页面数据范围：${dataStatus.importCount}份文件、${dataStatus.rowCount.toLocaleString("zh-CN")}行、更新至${dataStatus.latestDataDate ?? "待识别"}。`,
    `识别质量：${dataStatus.qualityScore}/100。这个分数衡量文件识别、关键字段完整度、日期可用性、重复和口径冲突；不是门店业绩分，也不表示只读取了${dataStatus.qualityScore}%的数据。`,
    coverageFacts.length ? `当前可分析内容：${coverageFacts.join("、")}。` : "当前还没有形成可分析的数据覆盖。",
    dataStatus.missingFields.length ? `待补字段：${dataStatus.missingFields.map(takeawayFieldLabel).join("、")}。` : "关键字段未发现明显缺口。",
    dataStatus.warnings?.length ? `当前数据提醒：${dataStatus.warnings.slice(0, 5).join("；")}。` : "当前没有额外数据提醒。",
    summaryFacts.length ? `页面经营摘要：${summaryFacts.join("；")}。` : undefined,
    anomalyFacts.length ? `页面已显示异常：${anomalyFacts.join("｜")}。` : "页面暂未形成可引用的异常卡片。"
  ].filter(Boolean).join("\n");
}

interface TakeawayDailyCheckin {
  day: number;
  task: string;
  owner: string;
  metrics: string;
  note: string;
  completed: boolean;
  checkedAt?: string;
}

type ValidationConclusion = "supported" | "rejected" | "insufficient";

interface DiagnosisCandidate {
  id: string;
  title: string;
  evidence: string;
  comparison: string;
  verification: string;
  growthImpact: string;
  profitImpact: string;
  priority: number;
}

interface ValidationRecord {
  candidateId: string;
  conclusion: ValidationConclusion;
  evidence: string;
  savedAt: string;
}

interface EffectEvaluationInput {
  metric: string;
  period: string;
  baseline: string;
  target: string;
  actual: string;
  notes: string;
}

interface ValidationBlueprint {
  title: string;
  whereToCheck: string;
  whatToRecord: string[];
  comparison: string;
  decisionRule: string;
}

function buildValidationBlueprint(candidate: DiagnosisCandidate | undefined): ValidationBlueprint {
  const text = `${candidate?.title ?? ""}${candidate?.evidence ?? ""}${candidate?.verification ?? ""}`;
  if (/订单低谷|订单.*下降|订单与客单.*走弱|重复出现订单偏低/.test(text)) return {
    title: "订单低谷：先定位掉在哪一环，不先改菜品或价格",
    whereToCheck: "进入低谷日期对应的平台商家后台，导出或截图当日与前4个同星期的曝光、进店、下单、有效完成单；再核对营业时段、缺货、配送范围、天气/节假日与活动变更。",
    whatToRecord: ["日期、平台和比较的4个同星期日期", "曝光、进店、下单、有效完成单及主要时段", "缺货、停业、配送范围、活动或价格是否变动"],
    comparison: "同门店、同平台、同星期、相同营业时段；不要只和任意一天比较。",
    decisionRule: "先出现明显下降的漏斗环节，且排除停业、缺货和特殊日期后仍重复发生，才支持该环节是原因；否则记录为偶发波动或证据不足。"
  };
  if (/成本|毛利|利润|贡献额|价格/.test(text)) return {
    title: "成本风险：核算真实贡献，不用订单高低代替验证",
    whereToCheck: "到采购/中央厨房核对配方与最新进价，到平台后台核对实际成交价、商家补贴、平台扣点和包装费；不要只看标价或单项食材成本。",
    whatToRecord: ["菜品/套餐、实际成交价、份量与配方成本", "包装、商家补贴、平台扣点、配送/服务费、退款损失", "该菜近7天销量与活动价是否变化"],
    comparison: "同一菜品按实际成交订单核算，并与门店已确认的成本率或单份贡献底线比较。",
    decisionRule: "实际贡献低于门店底线，或成本率持续超线且不是促销期短暂现象，才确认利润问题；它不自动等于导致订单下降。"
  };
  if (/双断点|进店|下单转化|漏斗/.test(text)) return {
    title: "平台漏斗：分清流量承接还是商品成交",
    whereToCheck: "分别导出两平台同一周期的曝光、进店、商品点击、加购/下单和有效完成单；同时截图主图、配送范围、营业时长、优惠和货盘状态。",
    whatToRecord: ["平台、周期、各漏斗数值与转化率", "同一菜品的价格、优惠、主图和配送范围", "当期缺货、停业、活动与投放变化"],
    comparison: "同门店、同周期、同一菜品规格的双平台横向对比，避免把不同套餐或不同日期混在一起。",
    decisionRule: "若同一平台连续多个周期在同一环节落后，且页面承接差异可复核，才支持该断点；单期差异只保留为线索。"
  };
  if (/投放|ROI|消耗|广告/.test(text)) return {
    title: "投放问题：看计划级承接，不能只看总花费",
    whereToCheck: "在平台推广后台导出每个计划的消耗、曝光、点击、进店、下单、成交额和退款；同步核对计划启停、预算和定向变更。",
    whatToRecord: ["计划名称、日期、预算、实际消耗与成交", "曝光、点击、进店、下单、退款与每一步转化", "计划启停、定向、出价、素材和活动变化"],
    comparison: "同一计划的测试前后7天，或同预算的可比计划；商家活动成本汇总不能代替广告计划数据。",
    decisionRule: "计划级消耗增加但承接漏斗和成交未改善，且退款未掩盖问题，才支持投放效率问题；否则先补计划级数据。"
  };
  if (/出餐|履约|配送|退款|差评/.test(text)) return {
    title: "履约问题：证明它是否影响顾客，而不只看出餐分钟数",
    whereToCheck: "导出按小时、菜品和订单的出餐/配送时长、取消退款和差评原因；核对高峰期、缺货和骑手异常。",
    whatToRecord: ["时段、菜品、出餐/配送时长", "取消、退款、差评数量及原因", "高峰期人手、缺货、营业和配送异常"],
    comparison: "慢时段与正常时段、慢菜品与正常菜品，并与退款、取消或差评是否同步比较。",
    decisionRule: "只有履约变慢与取消、退款、差评或复购下降同步且重复出现，才支持它是增长问题；否则仅作为成本或体验风险。"
  };
  return { title: "先取得能推翻假设的对比证据", whereToCheck: candidate?.verification ?? "导出对应平台和周期的原始经营数据，核对当期经营变更。", whatToRecord: ["问题发生的日期、平台和指标", "同口径比较基线", "同期变更与异常说明"], comparison: candidate?.comparison ?? "同门店、同平台、同周期的可比数据。", decisionRule: "只有异常重复出现、对比成立且反证已排除时，才登记问题成立；否则登记不成立或证据不足。" };
}

function diagnosisImpact(dimension: NonNullable<TakeawayWorkbenchDataStatus["analysis"]>["anomalies"][number]["dimension"], text: string): { growthImpact: string; profitImpact: string; priority: number } {
  if (dimension === "profit") return {
    growthImpact: "当前只发现利润风险，尚无证据证明它导致订单下降",
    profitImpact: "直接影响单笔利润和可持续投放空间",
    priority: 1
  };
  if (dimension === "fulfillment") {
    const linkedToCustomer = /退款|取消|差评|超时|投诉/.test(text);
    return {
      growthImpact: linkedToCustomer ? "可能通过取消、差评或超时影响下单与复购，仍需单独验证" : "当前只发现履约异常，尚无证据证明它影响销量",
      profitImpact: "可能增加退款、补偿或门店履约成本",
      priority: linkedToCustomer ? 3 : 1
    };
  }
  if (dimension === "product") return {
    growthImpact: "可能影响商品点击、加购和下单转化，需要用同周期商品漏斗验证",
    profitImpact: /成本|毛利|价格/.test(text) ? "同时可能影响利润" : "当前没有直接利润证据",
    priority: 3
  };
  if (dimension === "campaign") return {
    growthImpact: "可能影响新增流量或下单转化，必须与计划级成交数据同口径比较",
    profitImpact: "活动成本或广告消耗会直接影响利润与投入回报",
    priority: 2
  };
  if (dimension === "funnel" || dimension === "trend") return {
    growthImpact: "直接对应订单增长链路，应优先确认异常发生在哪一环",
    profitImpact: "只有补齐成本、退款和补贴后才能判断利润影响",
    priority: 4
  };
  return {
    growthImpact: "可能影响订单增长，但当前证据链仍需验证",
    profitImpact: "利润影响待补成本与退款数据后判断",
    priority: 2
  };
}

function buildDiagnosisCandidates(dataStatus: TakeawayWorkbenchDataStatus | null): DiagnosisCandidate[] {
  return (dataStatus?.analysis?.anomalies ?? [])
    .map((anomaly) => {
      const impact = diagnosisImpact(anomaly.dimension, `${anomaly.title}${anomaly.evidence}${anomaly.comparison}`);
      return {
        id: anomaly.id,
        title: anomaly.title,
        evidence: anomaly.evidence,
        comparison: anomaly.comparison,
        verification: anomaly.verification,
        growthImpact: impact.growthImpact,
        profitImpact: impact.profitImpact,
        priority: impact.priority + (anomaly.severity === "high" ? 2 : anomaly.severity === "medium" ? 1 : 0) + (anomaly.confidence === "high" ? 1 : 0)
      };
    })
    .sort((a, b) => b.priority - a.priority);
}

function supplementFacts(value: string): string[] {
  return value
    .split(/\r?\n|；/)
    .map((item) => item.replace(/^#+\s*/, "").trim())
    .filter((item) => item.length >= 4 && !/^第\d+项[：:]?$/.test(item))
    .slice(0, 6);
}

function createDailyExecutionPlan(days: 7 | 14, stage: TakeawayStoreStage, moduleId: TakeawayDiagnosisModuleId): TakeawayDailyCheckin[] {
  const focus = moduleId === "menu" ? "菜单与价格" : moduleId === "campaign" ? "活动投放" : moduleId === "competitor" ? "顾客流失线索" : stage === "new" ? "新店曝光与首批订单" : "当前最大经营断点";
  const actions = [
    `确认${focus}的基线、负责人和唯一改动，其他价格、活动和投放保持不变`,
    "按执行卡完成唯一改动，截图或记录修改前后的页面状态",
    "回填曝光、进店、下单、有效完成单，并记录当天是否完整执行",
    "检查退款、差评、缺货和出餐是否异常，不调整第二个变量",
    "比较测试期与同星期基线，确认变化最早发生在哪一环",
    "复核执行一致性，排除节假日、停业、缺货和平台规则变化",
    "完成第一周判断：继续、微调或停止，并写清证据",
    "按第一周结论继续同一变量，确认第二周负责人和不变项",
    "复查平台、时段和菜品拆分，确认效果是否只出现在局部",
    "回填有效完成单、实付、客单、退款、出餐和已知成本",
    "检查效果是否依赖短期活动、排名或偶发大单",
    "抽查执行现场和平台页面，确认计划没有走样",
    "比较两周累计结果与同星期基线，补齐异常日期说明",
    "完成最终复盘：是否有效、是否可复制、下一轮只做什么"
  ];
  return actions.slice(0, days).map((task, index) => ({ day: index + 1, task, owner: "", metrics: "", note: "", completed: false }));
}

function buildDailyReviewSummary(checkins: TakeawayDailyCheckin[]): string {
  const saved = checkins.filter((item) => item.completed && item.checkedAt);
  const isSimulation = saved.some((item) => /模拟(?:测试|回填)|【模拟】|\[模拟\]/.test(`${item.owner} ${item.metrics} ${item.note}`));
  const owners = Array.from(new Set(saved.map((item) => item.owner.trim()).filter(Boolean))).slice(0, 3);
  const metricSamples = saved.map((item) => item.metrics.trim()).filter(Boolean).slice(0, 3);
  const actionSamples = saved.map((item) => item.note.replace(/(?:【|\[)?模拟(?:测试|回填)(?:】|\])?/g, "").trim()).filter(Boolean).slice(0, 2);
  return [
    "【14天回填汇总】",
    `完成情况：${saved.length}/${checkins.length}天已保存。`,
    `数据性质：${isSimulation ? "含模拟测试回填，只用于验证流程，不代表真实经营结果。" : "门店执行回填，仍需与真实平台同周期数据核对。"}`,
    `负责人：${owners.length ? owners.join("、") : "未填写"}。`,
    `已记录指标样例：${metricSamples.length ? metricSamples.join("；") : "未填写"}。`,
    `执行记录摘要：${actionSamples.length ? actionSamples.join("；") : "未填写"}。`,
    "【复盘边界】",
    "尚未提供同星期基线期与测试期的汇总对比；未核对退款、活动消耗和订单口径前，不得判断增长或决定扩大投入。"
  ].join("\n");
}

export function TakeawayGrowthWorkbench({ brandName, storageScope = "default", dataStatus, busy, latestResult, latestResultContent, onOpenImport, onRun, onOpenTaskMap, onOpenCapability, importSlot, mapEntry, conversationMessages = [] }: Props) {
  const hasData = Boolean(dataStatus?.rowCount);
  const [activeStep, setActiveStep] = useState<1 | 2 | 3 | 4 | 5>(hasData ? 2 : 1);
  const [stage, setStage] = useState<TakeawayStoreStage | null>(null);
  const [moduleId, setModuleId] = useState<TakeawayDiagnosisModuleId>("overview");
  const [supplement, setSupplement] = useState("");
  const [submittedSupplement, setSubmittedSupplement] = useState("");
  const [appliedSupplement, setAppliedSupplement] = useState("");
  const [pendingAdvance, setPendingAdvance] = useState<4 | 5 | 6 | 7 | null>(null);
  const [auditCompleted, setAuditCompleted] = useState(false);
  const [diagnosisCompleted, setDiagnosisCompleted] = useState(false);
  const [growthPlanCompleted, setGrowthPlanCompleted] = useState(false);
  const [planDays, setPlanDays] = useState<7 | 14>(7);
  const [dailyCheckins, setDailyCheckins] = useState<TakeawayDailyCheckin[]>([]);
  const [operatingStageLabel, setOperatingStageLabel] = useState("");
  const [stageStartDate, setStageStartDate] = useState("");
  const [stageNote, setStageNote] = useState("");
  const [stageSavedAt, setStageSavedAt] = useState("");
  const [workflowHydrated, setWorkflowHydrated] = useState(false);
  const [stageHydrated, setStageHydrated] = useState(false);
  const [selectedCandidateId, setSelectedCandidateId] = useState("");
  const [validationRecords, setValidationRecords] = useState<ValidationRecord[]>([]);
  const [validationConclusion, setValidationConclusion] = useState<ValidationConclusion>("supported");
  const [validationEvidence, setValidationEvidence] = useState("");
  const [validationConclusionOpenFor, setValidationConclusionOpenFor] = useState("");
  const [effectEvaluation, setEffectEvaluation] = useState<EffectEvaluationInput>({ metric: "有效完成单", period: "", baseline: "", target: "", actual: "", notes: "" });
  const [evaluationCompleted, setEvaluationCompleted] = useState(false);
  const [taskChatInput, setTaskChatInput] = useState("");
  const [taskChatMode, setTaskChatMode] = useState<TaskChatMode>("ask");
  const [focusedCapabilityId, setFocusedCapabilityId] = useState<string | null>(null);
  const [visibleTaskResultId, setVisibleTaskResultId] = useState<string | null>(null);
  const [resultPending, setResultPending] = useState(false);
  const previousResultIdRef = useRef(latestResult?.id ?? "");
  const automaticDiagnosisRef = useRef<string | null>(null);
  const textBriefLength = supplement.replace(/\s+/g, "").length;
  const canRunTextPreview = !hasData && textBriefLength >= 20;
  const auditWarnings = dataStatus?.warnings ?? [];
  const auditSourceFiles = dataStatus?.sourceFiles ?? [];
  const auditDuplicateCount = auditSourceFiles.reduce((total, item) => total + item.duplicateCount, 0);
  const auditWeakFiles = auditSourceFiles.filter((item) => item.qualityScore < 80);
  const auditBlockingWarnings = auditWarnings.filter((warning) => /倒挂|高于下单量|周期|不一致|冲突/.test(warning));
  const diagnosisCandidates = useMemo(() => buildDiagnosisCandidates(dataStatus), [dataStatus]);
  const selectedCandidate = diagnosisCandidates.find((candidate) => candidate.id === selectedCandidateId) ?? diagnosisCandidates[0];
  const validationBlueprint = useMemo(() => buildValidationBlueprint(selectedCandidate), [selectedCandidate]);
  const confirmedCandidate = diagnosisCandidates.find((candidate) => validationRecords.some((record) => record.candidateId === candidate.id && record.conclusion === "supported"));

  const selectedModule = useMemo(
    () => TAKEAWAY_DIAGNOSIS_MODULES.find((item) => item.id === moduleId) ?? TAKEAWAY_DIAGNOSIS_MODULES[0],
    [moduleId]
  );
  const focusedTask = focusedCapabilityId ? TAKEAWAY_TASK_MAP_TASKS[focusedCapabilityId] : null;
  const taskConversation = useMemo(() => {
    if (!focusedCapabilityId) return [];
    const markerPattern = new RegExp(`^【外卖任务对话｜${focusedCapabilityId}(?:｜(?:ask|revise))?】`);
    const turns: Array<{ id: string; role: "user" | "assistant"; content: string; rendered?: ReactNode }> = [];
    let waitingForAssistant = false;
    conversationMessages.forEach((message) => {
      if (message.role === "user") {
        const marker = message.content.match(markerPattern)?.[0];
        waitingForAssistant = Boolean(marker);
        if (marker) turns.push({ ...message, content: message.content.slice(marker.length).trim() });
        return;
      }
      if (!waitingForAssistant) return;
      turns.push(message);
      waitingForAssistant = false;
    });
    return turns.slice(-8);
  }, [conversationMessages, focusedCapabilityId]);
  const diagnosisRoute = useMemo(() => resolveTakeawayDiagnosisReadiness(dataStatus, moduleId), [dataStatus, moduleId]);
  const selectedModuleTitle = focusedTask?.title ?? (moduleId === "campaign" && dataStatus?.campaignEvidence === "summary"
    ? "活动成本汇总诊断"
    : selectedModule.title);
  const selectedModuleSubtitle = focusedTask?.description ?? selectedModule.subtitle;
  const analysisView: TakeawayAnalysisView | undefined = focusedCapabilityId === "takeaway_growth" ? "overview"
    : focusedCapabilityId === "mature_store_growth" ? "mature"
      : focusedCapabilityId === "new_store_breakthrough" ? "new"
        : focusedCapabilityId === "takeaway_menu_profit" ? "menu"
          : focusedCapabilityId === "takeaway_campaign_roi" ? "campaign"
            : !focusedTask ? moduleId === "overview" ? stage === "new" ? "new" : "mature" : moduleId === "menu" ? "menu" : moduleId === "campaign" ? "campaign" : undefined
              : undefined;
  const primaryRunLabel = focusedCapabilityId === "new_store_breakthrough" ? "更新判断后，建立新店7/14/30天基线"
    : focusedCapabilityId === "mature_store_growth" ? "生成老店基线"
      : focusedCapabilityId === "takeaway_growth" ? "生成AI经营诊断"
        : focusedCapabilityId === "takeaway_problem_validation" ? "设计本轮问题验证"
        : focusedCapabilityId === "takeaway_menu_profit" ? "生成菜单利润诊断"
          : focusedCapabilityId === "takeaway_campaign_roi" ? "生成活动投放诊断"
            : focusedCapabilityId === "takeaway_competitor_loss" ? "生成流失竞品诊断"
              : "生成一份简单建议";
  const focusedTaskResultReady = Boolean(focusedTask && visibleTaskResultId === latestResult?.id && latestResult?.deliveryStatus === "completed");
  const dailyPlanCompleted = dailyCheckins.length === planDays && dailyCheckins.every((item) => Boolean(item.checkedAt));
  const workflowStorageKey = `takeaway-real-execution-v1:${storageScope}:${brandName}`;
  const operatingStageStorageKey = `takeaway-operating-stage-v2:${storageScope}:${brandName}`;
  const operatingStageContext = [
    operatingStageLabel.trim(),
    stageStartDate ? `开业或平台上线日期：${stageStartDate}` : "",
    stageNote.trim() ? `阶段补充：${stageNote.trim()}` : ""
  ].filter(Boolean).join("；");
  const evaluationReady = Boolean(effectEvaluation.metric.trim() && effectEvaluation.period.trim() && Number.isFinite(Number(effectEvaluation.baseline)) && Number.isFinite(Number(effectEvaluation.target)) && Number.isFinite(Number(effectEvaluation.actual)));
  const executionState = growthPlanCompleted
    ? dailyPlanCompleted ? "待复盘" : "执行中"
    : diagnosisCompleted ? "已找到问题" : "待诊断";

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(workflowStorageKey);
      if (!saved) return;
      const parsed = JSON.parse(saved) as { days?: 7 | 14; checkins?: TakeawayDailyCheckin[]; validationRecords?: ValidationRecord[]; growthPlanCompleted?: boolean; evaluationCompleted?: boolean };
      if (parsed.days === 7 || parsed.days === 14) setPlanDays(parsed.days);
      if (Array.isArray(parsed.checkins)) setDailyCheckins(parsed.checkins.slice(0, parsed.days ?? 7));
      if (Array.isArray(parsed.validationRecords)) setValidationRecords(parsed.validationRecords);
      setGrowthPlanCompleted(Boolean(parsed.growthPlanCompleted));
      setEvaluationCompleted(Boolean(parsed.evaluationCompleted));
    } catch {
      // A broken real-execution draft must not block the workbench.
    } finally {
      setWorkflowHydrated(true);
    }
  }, [workflowStorageKey]);

  useEffect(() => {
    if (!workflowHydrated) return;
    try {
      window.localStorage.setItem(workflowStorageKey, JSON.stringify({ days: planDays, checkins: dailyCheckins, validationRecords, growthPlanCompleted, evaluationCompleted }));
    } catch {
      // Keep the active session usable when local storage is unavailable.
    }
  }, [dailyCheckins, evaluationCompleted, growthPlanCompleted, planDays, validationRecords, workflowHydrated, workflowStorageKey]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(operatingStageStorageKey);
      if (!saved) return;
      const parsed = JSON.parse(saved) as { label?: string; stage?: TakeawayStoreStage; startDate?: string; note?: string; savedAt?: string };
      setOperatingStageLabel(parsed.label ?? "");
      setStage(parsed.stage ?? null);
      setStageStartDate(parsed.startDate ?? "");
      setStageNote(parsed.note ?? "");
      setStageSavedAt(parsed.savedAt ?? "");
    } catch {
      // A stage label is an optional local preference and must not block work.
    } finally {
      setStageHydrated(true);
    }
  }, [operatingStageStorageKey]);

  useEffect(() => {
    if (!stageHydrated) return;
    try {
      if (!stage && !operatingStageLabel.trim()) return;
      window.localStorage.setItem(operatingStageStorageKey, JSON.stringify({ label: operatingStageLabel.trim(), stage, startDate: stageStartDate, note: stageNote.trim(), savedAt: stageSavedAt }));
    } catch {
      // Keep the active session usable when local storage is unavailable.
    }
  }, [operatingStageLabel, operatingStageStorageKey, stage, stageHydrated, stageNote, stageSavedAt, stageStartDate]);

  useEffect(() => {
    if (!selectedCandidateId && diagnosisCandidates[0]) setSelectedCandidateId(diagnosisCandidates[0].id);
  }, [diagnosisCandidates, selectedCandidateId]);

  useEffect(() => {
    const nextId = latestResult?.id ?? "";
    if (!nextId || nextId === previousResultIdRef.current) return;
    previousResultIdRef.current = nextId;
    if (!pendingAdvance && !resultPending) return;
    // Keep every delivery in the active task, instead of creating a second
    // chat-style result page below the workbench.
    setVisibleTaskResultId(nextId);
    setResultPending(false);
    if (latestResult?.deliveryStatus === "failed" || latestResult?.deliveryStatus === "needs_input") {
      setPendingAdvance(null);
      return;
    }
    if (pendingAdvance === 4) {
      setAppliedSupplement(submittedSupplement);
      setDiagnosisCompleted(true);
      setActiveStep(focusedCapabilityId ? 3 : 4);
    }
    if (pendingAdvance === 5) {
      // Keep the operator on the experiment card after it is generated. They
      // must have a chance to read and approve it before recording execution.
      setGrowthPlanCompleted(true);
      setActiveStep(4);
    }
    if (pendingAdvance === 6) setActiveStep(3);
    if (pendingAdvance === 7) {
      setEvaluationCompleted(true);
      setActiveStep(5);
    }
    setPendingAdvance(null);
  }, [focusedCapabilityId, latestResult, pendingAdvance, resultPending, submittedSupplement]);

  useEffect(() => {
    if (!mapEntry) return;
    const capabilityId = mapEntry.capabilityId;
    setFocusedCapabilityId(capabilityId);
    setVisibleTaskResultId(null);
    setResultPending(false);
    setSubmittedSupplement("");
    setAppliedSupplement("");
    if (capabilityId === "takeaway_data_foundation") {
      setActiveStep(1);
      setAuditCompleted(hasData);
      return;
    }
    if (capabilityId === "mature_store_growth") {
      setStage("mature");
      setModuleId("overview");
      setActiveStep(3);
      return;
    }
    if (capabilityId === "new_store_breakthrough") {
      setStage("new");
      setModuleId("overview");
      setActiveStep(3);
      return;
    }
    if (capabilityId === "takeaway_growth") {
      setModuleId("overview");
      setActiveStep(3);
      return;
    }
    if (capabilityId === "takeaway_problem_validation") {
      setModuleId("overview");
      setActiveStep(3);
      return;
    }
    if (capabilityId === "takeaway_menu_profit") {
      setModuleId("menu");
      setActiveStep(3);
      return;
    }
    if (capabilityId === "takeaway_campaign_roi") {
      setModuleId("campaign");
      setActiveStep(3);
      return;
    }
    if (capabilityId === "takeaway_competitor_loss") {
      setModuleId("competitor");
      setActiveStep(3);
      return;
    }
    if (capabilityId === "takeaway_experiment") {
      setActiveStep(4);
      return;
    }
    if (capabilityId === "takeaway_execution") {
      setActiveStep(4);
      return;
    }
    if (capabilityId === "takeaway_effect_evaluation" || capabilityId === "takeaway_review") setActiveStep(5);
  }, [mapEntry?.requestId]);

  useEffect(() => {
    if (mapEntry?.capabilityId !== "takeaway_growth" || !hasData || !stage || !stageHydrated || busy || resultPending) return;
    const dataVersion = [mapEntry.requestId, dataStatus?.importCount ?? 0, dataStatus?.rowCount ?? 0, dataStatus?.latestDataDate ?? "", dataStatus?.qualityScore ?? 0].join(":");
    if (automaticDiagnosisRef.current === dataVersion) return;
    automaticDiagnosisRef.current = dataVersion;
    run("diagnosis");
  }, [busy, dataStatus?.importCount, dataStatus?.latestDataDate, dataStatus?.qualityScore, dataStatus?.rowCount, hasData, mapEntry?.capabilityId, mapEntry?.requestId, resultPending, stage, stageHydrated]);

  useEffect(() => {
    // When imports finish in the normal workbench, move directly to the
    // stage choice. Do not apply this to a map-locked task.
    if (!mapEntry && hasData && activeStep === 1) setActiveStep(2);
  }, [activeStep, hasData, mapEntry]);

  const simpleStepState = (step: 1 | 2 | 3): "done" | "active" | "pending" => {
    if (step === 1) return hasData ? "done" : activeStep === 1 ? "active" : "pending";
    if (step === 2) return diagnosisCompleted ? "done" : activeStep === 2 || activeStep === 3 ? "active" : "pending";
    return activeStep === 4 || activeStep === 5 ? "active" : "pending";
  };

  function returnToTaskMap(): void {
    setFocusedCapabilityId(null);
    onOpenTaskMap();
  }

  function openMenuDiagnosis(): void {
    if (focusedCapabilityId === "takeaway_data_audit" && onOpenCapability) {
      onOpenCapability("takeaway_menu_profit");
      return;
    }
    setFocusedCapabilityId(null);
    setModuleId("menu");
    setActiveStep(stage ? 3 : 2);
  }

  function continueWithCurrentData(): void {
    if (focusedTask) {
      returnToTaskMap();
      return;
    }
    setFocusedCapabilityId(null);
    setModuleId("overview");
    setActiveStep(stage ? 3 : 2);
  }

  function run(step: "audit" | "diagnosis" | "validation" | "experiment" | "execution" | "evaluation" | "review"): void {
    // Data audit is calculated from imported files. It must not wait for an
    // LLM response or accidentally enter the growth-diagnosis module.
    if (step === "audit") {
      setAuditCompleted(true);
      return;
    }
    if (!stage) return;
    const validationSupplement = selectedCandidate
      ? [
        `本轮只验证候选：${selectedCandidate.title}`,
        `诊断证据：${selectedCandidate.evidence}`,
        `对比基线：${selectedCandidate.comparison}`,
        `建议验证：${selectedCandidate.verification}`,
        `核查地点与步骤：${validationBlueprint.whereToCheck}`,
        `必须回填：${validationBlueprint.whatToRecord.join("；")}`,
        `比较规则：${validationBlueprint.comparison}`,
        `成立规则：${validationBlueprint.decisionRule}`,
        supplement.trim() ? `人工补充：${supplement.trim()}` : undefined
      ].filter(Boolean).join("\n")
      : supplement;
    const evaluationSupplement = [
      `目标指标：${effectEvaluation.metric}`,
      `对比周期：${effectEvaluation.period}`,
      `基线值：${effectEvaluation.baseline}`,
      `目标值：${effectEvaluation.target}`,
      `实际值：${effectEvaluation.actual}`,
      `执行记录：${buildDailyReviewSummary(dailyCheckins)}`,
      effectEvaluation.notes.trim() ? `异常与并发变化：${effectEvaluation.notes.trim()}` : undefined
    ].filter(Boolean).join("\n");
    const confirmedSupplement = confirmedCandidate
      ? [
        `已由人工登记为问题成立：${confirmedCandidate.title}`,
        `诊断证据：${confirmedCandidate.evidence}`,
        `验证结论证据：${validationRecords.find((record) => record.candidateId === confirmedCandidate.id && record.conclusion === "supported")?.evidence ?? "待补"}`,
        supplement.trim() ? `审批约束：${supplement.trim()}` : undefined
      ].filter(Boolean).join("\n")
      : supplement;
    const task = buildTakeawayWorkbenchPrompt({
      step,
      brandName,
      stage: stage ?? "mature",
      moduleId,
      hasImportedData: hasData,
      dataContext: dataStatus?.contextPrompt,
      supplement: step === "validation" ? validationSupplement : step === "experiment" ? confirmedSupplement : step === "evaluation" ? evaluationSupplement : supplement,
      diagnosisMode: diagnosisRoute.mode,
      dataStatus,
      planDays,
      operatingStageLabel: operatingStageContext,
      capabilityIdOverride: step === "diagnosis" && focusedCapabilityId === "takeaway_growth" ? "takeaway_growth" : undefined
    });
    if (step === "diagnosis") setSubmittedSupplement(supplement.trim());
    setResultPending(true);
    onRun(task.capabilityId, task.prompt, task.display);
    if (step === "diagnosis") setPendingAdvance(4);
    if (step === "validation") setPendingAdvance(6);
    if (step === "experiment") setPendingAdvance(5);
    if (step === "evaluation") setPendingAdvance(7);
  }

  function saveOperatingStage(): void {
    if (!stage || !operatingStageLabel.trim()) return;
    setStageSavedAt(new Date().toISOString());
  }

  function saveValidationConclusion(): void {
    if (!selectedCandidate || validationEvidence.trim().length < 8) return;
    const next: ValidationRecord = { candidateId: selectedCandidate.id, conclusion: validationConclusion, evidence: validationEvidence.trim(), savedAt: new Date().toISOString() };
    setValidationRecords((current) => [...current.filter((record) => record.candidateId !== selectedCandidate.id), next]);
    setValidationEvidence("");
  }

  function startRealExecution(): void {
    if (!growthPlanCompleted || !confirmedCandidate) return;
    setDailyCheckins(createDailyExecutionPlan(planDays, stage ?? "mature", moduleId));
  }

  function updateDailyCheckin(day: number, patch: Partial<TakeawayDailyCheckin>): void {
    setDailyCheckins((current) => current.map((item) => item.day === day ? { ...item, ...patch } : item));
  }

  function startReviewFromDailyPlan(): void {
    const summary = buildDailyReviewSummary(dailyCheckins);
    setSupplement(summary);
    if (!stage) return;
    const task = buildTakeawayWorkbenchPrompt({
      step: "review",
      brandName,
      stage,
      moduleId,
      hasImportedData: hasData,
      dataContext: dataStatus?.contextPrompt,
      supplement: summary,
      diagnosisMode: diagnosisRoute.mode,
      dataStatus,
      planDays,
      operatingStageLabel: operatingStageContext
    });
    setActiveStep(5);
    setResultPending(true);
    onRun(task.capabilityId, task.prompt, task.display);
  }

  function startEffectEvaluationFromDailyPlan(): void {
    setActiveStep(5);
    setFocusedCapabilityId("takeaway_effect_evaluation");
    onOpenCapability?.("takeaway_effect_evaluation");
  }

  function sendTaskChat(messageOverride?: string): void {
    const message = (messageOverride ?? taskChatInput).trim();
    if (!message || !focusedCapabilityId || !focusedTask || busy) return;
    const stageText = stage === "new" ? "新店起量" : stage === "mature" ? "老店增长" : "主路径尚未确认";
    const dataText = dataStatus ? `${dataStatus.importCount}份文件、${dataStatus.rowCount.toLocaleString("zh-CN")}行、更新至${dataStatus.latestDataDate ?? "待识别"}` : "尚未导入经营数据";
    const modeLabel = taskChatMode === "ask" ? "问问题" : "修改方案";
    const screenContext = buildTaskChatScreenContext(dataStatus);
    const currentPlan = taskChatMode === "revise" ? latestResult?.content?.trim().slice(0, 12_000) : undefined;
    const prompt = [
      `【外卖任务页持续对话｜模式：${modeLabel}｜固定任务：${focusedCapabilityId}】`,
      `当前任务：${focusedTask.title}；主路径：${stageText}；当前数据：${dataText}。`,
      "【当前页面可见信息】",
      screenContext,
      currentPlan ? "【当前方案原文】" : undefined,
      currentPlan,
      currentPlan ? "【当前方案原文结束】" : undefined,
      taskChatMode === "ask" ? `用户本次问题：${message}` : `用户本次修改要求：${message}`,
      "回答规则：",
      taskChatMode === "ask"
        ? "这是一轮解释或追问。只回答上面这一个问题，通常3至8句话；不得重新生成本任务结果、7天计划或完整报告。若用户问开业日、平台上线日、配送范围/半径、商圈、地址或首月目标在哪里填，直接说明在“补充本轮已知信息”填写，并说明会先更新判断再建立新店基线；不得要求用户再指出页面对象。问到数字时，先说它是什么、怎么算、为什么页面显示这个值、它不代表什么。若无法确认用户指的是哪个数字，只提出一个澄清问题，并列出最多3个可能选项。"
        : "这是一轮明确的方案修改。只修改用户点名的内容，保留其他已确认部分；先用一句话说明本次改动，再输出可直接替换的修订版。",
      "所有结论继续区分真实数据、AI判断和待验证假设，不得补造数字。",
      "涉及改价、预算、投放、上下架或活动时，只能给待确认建议，不得声称已经执行。"
    ].filter(Boolean).join("\n");
    setTaskChatInput("");
    if (taskChatMode === "revise") setResultPending(true);
    onRun(focusedCapabilityId, prompt, `【外卖任务对话｜${focusedCapabilityId}｜${taskChatMode}】\n${message}`);
  }

  return <section className="takeawayWorkbench" aria-label="枕水江南外卖增长三步助手">
    <header className="takeawayWorkbenchHero">
      <div><span>{focusedTask ? "当前任务" : "枕水江南外卖增长助手"}</span><h2>{focusedTask ? focusedTask.title : "三步得到一份能直接执行的建议"}</h2><p>{focusedTask ? `${focusedTask.description} 如需其他任务，请返回任务地图切换。` : "上传数据，选择想解决的问题，AI只告诉你本轮最该做的一件事。"}</p></div>
      <div className="takeawayWorkbenchHeroActions">
        <button type="button" className="takeawayTaskMapButton" onClick={focusedTask ? returnToTaskMap : onOpenTaskMap}>{focusedTask ? "返回任务地图" : "查看任务地图"}</button>
        <div className={`takeawayWorkbenchDataBadge ${dataStatus?.level ?? "insufficient"} ${canRunTextPreview ? "text-preview" : ""}`}><b>{hasData ? dataStatus?.qualityScore ?? 0 : canRunTextPreview ? "文" : 0}</b><span>{hasData ? "数据识别质量" : canRunTextPreview ? "文字预诊断" : "数据识别质量"}</span><small>{hasData ? `不是业绩分 · ${dataStatus!.rowCount.toLocaleString("zh-CN")} 行` : canRunTextPreview ? "低可信度 · 用户自述待核验" : "尚未导入经营数据"}</small></div>
      </div>
    </header>

    <section className="takeawayOperatingState" aria-label="当前经营阶段和任务状态">
      <div><span>品牌定义的经营阶段</span><strong>{operatingStageLabel.trim() || "尚未命名"}</strong><small>店龄只作参考，不会用统一天数强制划分新店或老店。</small></div>
      <div><span>当前任务状态</span><strong>{executionState}</strong><small>{executionState === "待诊断" ? "进入AI经营诊断后，系统会一次输出完整判断与验证顺序。" : executionState === "已找到问题" ? "已明确优先候选，下一步先验证问题是否成立。" : executionState === "执行中" ? "已生成增长方案，先按日回填，不重复诊断。" : "回填完成后，先评估增长效果，再进入周期复盘。"}</small></div>
    </section>

    {!focusedTask && <nav className="takeawayWorkflowSteps simple" aria-label="外卖增长三步流程">
      {[
        [1, "上传数据", "把经营文件交给系统"],
        [2, "获取建议", "只找一个优先问题"],
        [3, "执行后复盘", "判断继续还是停止"]
      ].map(([step, title, note]) => <button key={step} type="button" className={simpleStepState(Number(step) as 1 | 2 | 3)} onClick={() => setActiveStep(Number(step) === 1 ? 1 : Number(step) === 2 ? stage ? 3 : 2 : growthPlanCompleted ? 5 : 4)}><b>{step}</b><span><strong>{title}</strong><small>{note}</small></span></button>)}
    </nav>}

    <div className="takeawayWorkbenchBody">
      {focusedCapabilityId === "takeaway_data_foundation" ? <section className="takeawayStepPanel takeawayAuditOnlyPanel">
        <div className="takeawayStepHeading"><span>第 1 步</span><h3>数据与经营阶段</h3><p>先导入真实经营数据，再由门店填写当前经营阶段。这里只保存事实，不生成业绩原因或增长方案。</p></div>
        {importSlot}
        {!importSlot && <div className="takeawayStepActions"><button type="button" className="primary" onClick={onOpenImport}>{hasData ? "继续补充经营数据" : "上传经营数据"}</button></div>}
        {!hasData ? <div className="takeawayAuditEmpty"><strong>当前还没有可用的经营数据</strong><span>请上传订单、商品、活动、退款或成本文件。导入完成后，本页会显示覆盖范围与待补缺口。</span></div> : <section className="takeawayAuditResult" aria-live="polite">
          <header><span>数据底座已更新</span><strong>当前资料可供各诊断任务按需调用</strong></header>
          <div className="takeawayAuditResultGrid">
            <div><small>已导入数据</small><b>{dataStatus?.rowCount?.toLocaleString("zh-CN") ?? 0} 行</b><span>{dataStatus?.importCount ?? 0} 份文件 · 更新至 {dataStatus?.latestDataDate ?? "待识别"}</span></div>
            <div><small>当前识别质量</small><b>{dataStatus?.qualityScore ?? 0} / 100</b><span>这是文件与字段识别状态，不代表经营业绩好坏</span></div>
          </div>
          <div className="takeawayAuditFieldBlock"><strong>当前数据覆盖</strong><div>{[
            ["订单、退款与实付", Boolean(dataStatus?.coverage?.funnel)],
            [dataStatus?.productEvidence === "catalog_only" ? "菜品货盘（销量待结构化）" : "菜品销量", Boolean(dataStatus?.coverage?.products)],
            ["菜品价格与货盘", Boolean(dataStatus?.coverage?.catalog)],
            [dataStatus?.campaignEvidence === "summary" ? "活动成本汇总（非投放明细）" : "活动与投放", Boolean(dataStatus?.coverage?.campaigns)],
            ["成本数据", Boolean(dataStatus?.coverage?.costs)]
          ].map(([label, ready]) => <span key={String(label)} className={ready ? "ready" : "missing"}>{ready ? "已覆盖" : "待补充"} · {label}</span>)}</div></div>
        </section>}
        {hasData && <section className="takeawayAuditResult takeawayAuditDetailed" aria-live="polite">
          <header><span>自动数据可用性检查</span><strong>{auditBlockingWarnings.length > 0 ? `可部分使用：发现 ${auditBlockingWarnings.length} 项需要确认的口径风险` : dataStatus?.missingFields.length ? `可用于当前诊断，但有 ${dataStatus.missingFields.length} 类数据仍不完整` : "数据可用：没有发现阻断当前诊断的明显问题"}</strong></header>
          <div className="takeawayAuditCheckGrid">
            <div className={auditWeakFiles.length ? "warning" : "ready"}><small>文件质量</small><b>{auditWeakFiles.length ? `${auditWeakFiles.length} 份需检查` : "全部通过"}</b><span>低于80分的文件需要人工确认</span></div>
            <div className={auditDuplicateCount ? "warning" : "ready"}><small>重复数据</small><b>{auditDuplicateCount.toLocaleString("zh-CN")} 行</b><span>{auditDuplicateCount ? "系统已识别，需确认是否应去重" : "当前未发现重复记录"}</span></div>
            <div className={auditWarnings.length ? "warning" : "ready"}><small>冲突与提醒</small><b>{auditWarnings.length} 项</b><span>{auditBlockingWarnings.length ? `${auditBlockingWarnings.length} 项会限制对应结论` : "没有阻断诊断的问题"}</span></div>
          </div>
          <div className="takeawayAuditFindingBlock"><strong>已发现的口径风险</strong>{auditWarnings.length ? <div>{auditWarnings.slice(0, 5).map((warning, index) => <article key={`${warning}-${index}`} className={/倒挂|高于下单量|周期|不一致|冲突/.test(warning) ? "blocking" : "notice"}><span>{/倒挂|高于下单量|周期|不一致|冲突/.test(warning) ? "先确认" : "请注意"}</span><p>{warning.replace(/口径/g, "统计范围")}</p></article>)}</div> : <p className="takeawayAuditAllClear">没有发现订单倒挂、统计范围冲突或文件解析异常。</p>}</div>
          <div className="takeawayAuditImpactList"><strong>还缺什么数据，以及会影响什么</strong>{dataStatus?.missingFields.length ? <div>{dataStatus.missingFields.slice(0, 5).map((field) => <article key={field}><b>{takeawayFieldLabel(field)}</b><span>{auditImpact(field)}</span></article>)}</div> : <p className="takeawayAuditAllClear">当前没有发现会限制分析的关键缺失数据。</p>}</div>
          {auditSourceFiles.length > 0 && <div className="takeawayAuditFileList"><strong>逐文件检查（共 {auditSourceFiles.length} 份，以下全部显示）</strong><div>{auditSourceFiles.map((file) => <article key={file.filename}><div><b>{file.filename}</b><span>{file.rowCount.toLocaleString("zh-CN")} 行 · 重复 {file.duplicateCount.toLocaleString("zh-CN")} 行</span></div><em className={file.qualityScore < 80 ? "warning" : "ready"}>文件识别 {file.qualityScore} 分</em></article>)}</div></div>}
        </section>}
          <section className="takeawayStageFacts" aria-label="填写数据对应的经营阶段">
            <header><strong>填写这批数据对应的经营阶段</strong><span>由门店定义，不用统一开业天数替你判断。</span></header>
            <div className="takeawayStageGrid compact">
              <button type="button" className={stage === "new" ? "selected" : ""} onClick={() => setStage("new")}><span>启</span><div><strong>启动 / 起量</strong><p>刚上线、尚未稳定出单，或品牌自己定义的起量阶段。</p></div></button>
              <button type="button" className={stage === "mature" ? "selected" : ""} onClick={() => setStage("mature")}><span>稳</span><div><strong>稳定经营 / 恢复增长</strong><p>已有可参考历史，需要分析掉单或增长停滞。</p></div></button>
            </div>
            <div className="takeawayStageFactsGrid">
              <label><span>经营阶段名称</span><input list="takeaway-foundation-stage-options" value={operatingStageLabel} onChange={(event) => setOperatingStageLabel(event.target.value)} placeholder="例如：开业第2个月起量不达标" /></label>
              <label><span>开业或平台上线日期</span><input type="date" value={stageStartDate} onChange={(event) => setStageStartDate(event.target.value)} /></label>
              <label className="wide"><span>阶段说明（可选）</span><textarea value={stageNote} onChange={(event) => setStageNote(event.target.value)} placeholder="例如：6月18日调价，当前目标是先恢复日均有效订单。" /></label>
            </div>
            <datalist id="takeaway-foundation-stage-options"><option value="筹备上线期" /><option value="冷启动期" /><option value="起量不达标" /><option value="稳定经营期" /><option value="恢复增长期" /></datalist>
            <div className="takeawayStageSave"><span>{stageSavedAt ? `已保存：${new Date(stageSavedAt).toLocaleString("zh-CN")}` : "尚未保存经营阶段"}</span><button type="button" disabled={!stage || !operatingStageLabel.trim()} onClick={saveOperatingStage}>保存经营阶段</button></div>
          </section>
          <div className="takeawayAuditNext"><strong>上传完成后自动检查数据是否可用</strong><p>{!hasData ? "经营阶段可以先保存；上传经营数据后，本页会立即显示可用范围、口径风险和待补数据。" : stageSavedAt ? auditBlockingWarnings.length ? "已完成数据可用性检查。存在口径风险；可继续诊断，但系统会避开受影响的结论。" : dataStatus?.missingFields.length ? "已完成数据可用性检查。可按当前可靠数据诊断；缺失项已列出并会限制对应结论。" : "已完成数据可用性检查。可以开始AI经营诊断。" : "数据可用性检查已完成；请先保存经营阶段，再开始AI经营诊断。"}</p><button type="button" disabled={!hasData || !stageSavedAt} onClick={() => onOpenCapability?.("takeaway_growth")}>{auditBlockingWarnings.length || dataStatus?.missingFields.length ? "按当前可用数据开始AI经营诊断" : "开始AI经营诊断"}</button></div>
      </section> : focusedCapabilityId === "takeaway_data_audit" ? <section className="takeawayStepPanel takeawayAuditOnlyPanel">
        <div className="takeawayStepHeading"><span>数据质量检查</span><h3>检查这些数据能不能放心使用</h3><p>逐项检查文件质量、重复数据、统计范围冲突和缺失数据会影响什么。</p></div>
        {importSlot}
        <div className="takeawayStepActions"><button type="button" disabled={!hasData} onClick={() => run("audit")}>{hasData ? "运行数据质量检查" : "请先上传经营数据"}</button></div>
        {!auditCompleted && <div className="takeawayAuditEmpty"><strong>点击“运行数据质量检查”</strong><span>系统会检查每份文件的重复数据、统计范围冲突和关键缺失，结果即时生成。</span></div>}
        {auditCompleted && <section className="takeawayAuditResult takeawayAuditDetailed" aria-live="polite">
          <header><span>质量检查完成</span><strong>{auditBlockingWarnings.length > 0 ? `发现 ${auditBlockingWarnings.length} 项冲突，修正后再做相关诊断` : dataStatus?.missingFields.length ? `没有发现严重冲突，但有 ${dataStatus.missingFields.length} 类数据不完整` : "没有发现明显冲突，可以进入下一步诊断"}</strong></header>
          <div className="takeawayAuditCheckGrid">
            <div className={auditWeakFiles.length ? "warning" : "ready"}><small>文件质量</small><b>{auditWeakFiles.length ? `${auditWeakFiles.length} 份需检查` : "全部通过"}</b><span>低于80分的文件需要人工确认</span></div>
            <div className={auditDuplicateCount ? "warning" : "ready"}><small>重复数据</small><b>{auditDuplicateCount.toLocaleString("zh-CN")} 行</b><span>{auditDuplicateCount ? "系统已识别，需确认是否应去重" : "当前未发现重复记录"}</span></div>
            <div className={auditWarnings.length ? "warning" : "ready"}><small>冲突与提醒</small><b>{auditWarnings.length} 项</b><span>{auditBlockingWarnings.length ? `${auditBlockingWarnings.length} 项会影响诊断` : "没有阻断诊断的问题"}</span></div>
          </div>
          <div className="takeawayAuditFindingBlock">
            <strong>具体发现</strong>
            {auditWarnings.length ? <div>{auditWarnings.slice(0, 5).map((warning, index) => <article key={`${warning}-${index}`} className={/倒挂|高于下单量|周期|不一致|冲突/.test(warning) ? "blocking" : "notice"}><span>{/倒挂|高于下单量|周期|不一致|冲突/.test(warning) ? "先修复" : "请确认"}</span><p>{warning.replace(/口径/g, "统计范围")}</p></article>)}</div> : <p className="takeawayAuditAllClear">没有发现订单倒挂、统计范围冲突或文件解析异常。</p>}
          </div>
          {auditSourceFiles.length > 0 && <div className="takeawayAuditFileList"><strong>逐文件检查（共 {auditSourceFiles.length} 份，以下全部显示）</strong><div>{auditSourceFiles.map((file) => <article key={file.filename}><div><b>{file.filename}</b><span>{file.rowCount.toLocaleString("zh-CN")} 行 · 重复 {file.duplicateCount.toLocaleString("zh-CN")} 行</span></div><em className={file.qualityScore < 80 ? "warning" : "ready"}>文件识别 {file.qualityScore} 分</em></article>)}</div></div>}
          <div className="takeawayAuditImpactList"><strong>缺失数据会影响什么</strong>{dataStatus?.missingFields.length ? <div>{dataStatus.missingFields.slice(0, 5).map((field) => <article key={field}><b>{takeawayFieldLabel(field)}</b><span>{auditImpact(field)}</span></article>)}</div> : <p className="takeawayAuditAllClear">当前没有发现会限制分析的关键缺失数据。</p>}</div>
          <div className="takeawayAuditNext"><strong>接下来怎么选</strong><p>{auditBlockingWarnings.length ? "建议先修复上面的冲突；如果暂时无法补数据，也可以继续，系统会避开受影响的结论。" : dataStatus?.missingFields.length ? `建议优先补充“${takeawayFieldLabel(dataStatus.missingFields[0])}”；暂时不补也可以继续，系统只分析当前可靠的数据。` : "数据质量检查已通过，可以继续寻找最优先的增长问题。"}</p><div className="takeawayAuditNextActions">{auditBlockingWarnings.length || dataStatus?.missingFields.length ? <label className="takeawayAuditUploadButton" htmlFor="takeaway-task-import-input">选择文件补充数据</label> : null}<button type="button" className="secondary" onClick={continueWithCurrentData}>{auditBlockingWarnings.length || dataStatus?.missingFields.length ? "暂不补充，按现有数据继续" : "继续进行增长诊断"}</button></div></div>
        </section>}
      </section> : <>
      {activeStep === 1 && <section className="takeawayStepPanel">
        <div className="takeawayStepHeading"><span>第 1 步</span><h3>上传你现有的经营文件</h3><p>订单、商品、活动、退款或成本文件都可以，系统会自动识别。</p></div>
        {importSlot}
        <div className="takeawayStepActions">
          {!importSlot && <button type="button" className="primary" onClick={onOpenImport}>{hasData ? "继续补充数据" : "打开智能导入"}</button>}
          <button type="button" disabled={!hasData || busy} onClick={() => run("audit")}>运行数据口径审计</button>
        </div>
        <div className="takeawaySimplePromise"><strong>你会看到什么</strong><span>哪些数据能用、还缺什么、接下来可以分析什么。</span></div>
      </section>}

      {activeStep === 2 && <section className="takeawayStepPanel">
        <div className="takeawayStepHeading"><span>第 2 步</span><h3>先选经营路径，再写品牌自己的阶段名称</h3><p>“新店/老店”是分析方法，不是统一店龄标准；品牌可自行命名当前阶段。</p></div>
        <div className="takeawayStageGrid">
          <button type="button" className={stage === "mature" ? "selected" : ""} onClick={() => { setStage("mature"); setActiveStep(3); }}><span>稳</span><div><strong>稳定经营 / 恢复增长</strong><p>适用于已有可参考历史数据，需要找增长停住或掉单原因的门店。</p></div></button>
          <button type="button" className={stage === "new" ? "selected" : ""} onClick={() => { setStage("new"); setActiveStep(3); }}><span>启</span><div><strong>启动 / 起量阶段</strong><p>适用于新开业、刚上线或尚未稳定出单的门店；问题不明时同样可先让 AI 诊断。</p></div></button>
        </div>
        <label className="takeawaySupplement"><span>品牌自定义经营阶段（可选）</span><input list="takeaway-operating-stage-options" value={operatingStageLabel} onChange={(event) => setOperatingStageLabel(event.target.value)} placeholder="例如：开业第2个月起量不达标、平台冷启动、稳定经营恢复期" /><small>这会随本店保存在当前浏览器，并写入后续诊断、执行计划和复盘的判断背景。</small></label>
        <datalist id="takeaway-operating-stage-options"><option value="筹备上线期" /><option value="冷启动期" /><option value="起量不达标" /><option value="起量验证期" /><option value="稳定经营期" /><option value="恢复增长期" /></datalist>
        {!hasData && <p className="takeawayStepWarning">当前没有后台导出数据。你仍可在第3步填写至少20字真实情况，先做低可信度文字预诊断；正式结论需回到第1步补充数据。</p>}
      </section>}

      {activeStep === 3 && (!focusedTaskResultReady || focusedCapabilityId === "takeaway_problem_validation") && <section className="takeawayStepPanel">
        <div className="takeawayStepHeading"><span>第 2 步</span><h3>{focusedTask?.title ?? "你现在最想解决什么"}</h3><p>{focusedTask ? `${focusedTask.description} 系统会先检查现有数据是否够用。` : "不知道问题在哪，就选第一个；已经有方向，再选择对应项目。"}</p></div>
        {focusedTask && <section className={`takeawayPathConfirm ${stage ? "confirmed" : ""}`} aria-label="确认本轮主路径">
          <div><strong>{stage ? `分析方法已确认：${stage === "new" ? "启动 / 起量" : "稳定经营 / 恢复增长"}` : "先确认本轮分析方法"}</strong><span>{stage ? "品牌自己的经营阶段仍由下方单独填写，不使用统一店龄强制划分。" : "请选择更接近当前经营状态的分析方法；这不是统一的新店、老店定义。"}</span></div>
          <div className="takeawayPathChoices">
            <button type="button" className={stage === "mature" ? "selected" : ""} onClick={() => setStage("mature")}><b>稳定经营 / 恢复增长</b><small>已有可参考历史数据，重点识别异常和增长停住的位置</small></button>
            <button type="button" className={stage === "new" ? "selected" : ""} onClick={() => setStage("new")}><b>启动 / 起量</b><small>尚未稳定出单，重点建立基线并识别首个漏斗断点</small></button>
          </div>
        </section>}
        {focusedTask && <label className="takeawaySupplement"><span>品牌定义的当前经营阶段（建议填写）</span><input list="takeaway-focused-operating-stage-options" value={operatingStageLabel} onChange={(event) => setOperatingStageLabel(event.target.value)} placeholder="例如：开业第2个月起量不达标、平台冷启动、稳定经营恢复期" /><small>这个阶段会写入本轮AI诊断与后续验证，不会被统一开业天数覆盖。</small></label>}
        <datalist id="takeaway-focused-operating-stage-options"><option value="筹备上线期" /><option value="冷启动期" /><option value="起量不达标" /><option value="起量验证期" /><option value="稳定经营期" /><option value="恢复增长期" /></datalist>
        {!focusedTask && <div className="takeawayModuleGrid">{TAKEAWAY_DIAGNOSIS_MODULES.map((module) => {
          const route = resolveTakeawayDiagnosisReadiness(dataStatus, module.id);
          const title = module.id === "campaign" && dataStatus?.campaignEvidence === "summary" ? "活动成本汇总" : module.title;
          return <button type="button" key={module.id} aria-pressed={moduleId === module.id} className={`${moduleId === module.id ? "selected" : ""} ${route.mode === "explore" && module.id !== "overview" ? "data-missing" : ""}`.trim()} onClick={() => setModuleId(module.id)}><strong>{title}</strong><small>{module.subtitle}</small>{moduleId === module.id && <i>{module.id === "overview" ? "推荐" : route.mode === "standard" ? "数据够用" : "先给初步方向"}</i>}</button>;
        })}</div>}
        {focusedTask && <div className="takeawayFocusedTaskSummary"><strong>当前任务：{selectedModuleTitle}</strong><span>{selectedModuleSubtitle}</span>{stage && <em>主路径已确认：{stage === "new" ? "新店起量" : "老店增长"}</em>}</div>}
        {hasData && dataStatus?.analysis && analysisView && <TakeawayAnalysisBoard data={dataStatus.analysis} view={analysisView} />}
        <section className={`takeawayDiagnosisRoute ${diagnosisRoute.mode}`} aria-label="本次分析说明">
          <div><span>本次分析</span><strong>{diagnosisRoute.mode === "standard" ? "现有数据够用，可以直接判断" : hasData ? "先给最可能的方向，再用一次小测试确认" : "先根据你的描述给初步建议"}</strong><p>{diagnosisRoute.reason}</p></div>
          <em>{diagnosisRoute.evidenceLabel}</em>
        </section>
        {stage === "new" && focusedCapabilityId !== "takeaway_problem_validation" && <section className="takeawayNewStoreChoice" aria-label="新店诊断说明"><strong>启动期同样先由 AI 发现问题</strong><p>新店不会跳过诊断。系统先看曝光、进店、商品点击、支付和履约，再把有证据的候选送到下一步逐项验证。</p></section>}
        {diagnosisRoute.dataNeed && <div className="takeawayModuleDataIssue"><strong>现在也能先看方向</strong><p>{diagnosisRoute.dataNeed}</p><button type="button" onClick={onOpenImport}>补充数据，让判断更准</button></div>}
        {focusedCapabilityId === "takeaway_problem_validation" ? <section className="takeawayValidationWorkbench" aria-label="选择要验证的问题">
          <header><strong>选择要验证的问题</strong><span>候选自动继承自 AI 经营诊断；一次只验证一个，不需要你重新描述问题。</span></header>
          {diagnosisCandidates.length ? <>
            <div className="takeawayCandidateChoices">{diagnosisCandidates.slice(0, 3).map((candidate, index) => <button type="button" key={candidate.id} className={selectedCandidate?.id === candidate.id ? "selected" : ""} onClick={() => setSelectedCandidateId(candidate.id)}><b>候选 {index + 1}</b><strong>{candidate.title}</strong><span>{candidate.evidence}</span></button>)}</div>
            {selectedCandidate && <article className="takeawaySelectedCandidate"><strong>本轮只验证：{selectedCandidate.title}</strong><p>{selectedCandidate.verification}</p><small>验证前它仍是假设，不得直接进入增长方案。</small></article>}
            <section className="takeawayValidationBlueprint" aria-label="本轮现场核查步骤"><header><span>先做现场核查</span><strong>{validationBlueprint.title}</strong></header><p><b>去哪里看：</b>{validationBlueprint.whereToCheck}</p><ul>{validationBlueprint.whatToRecord.map((item) => <li key={item}>{item}</li>)}</ul><p><b>怎么比较：</b>{validationBlueprint.comparison}</p><p><b>何时成立：</b>{validationBlueprint.decisionRule}</p></section>
            <label className="takeawaySupplement"><span>补充验证约束（可选）</span><textarea value={supplement} onChange={(event) => setSupplement(event.target.value)} placeholder="例如：预算、价格和投放保持不变；负责人张三；验证7天。" /></label>
            <button type="button" className="takeawayRunButton takeawayPrimaryRun" disabled={!stage || !selectedCandidate || busy || pendingAdvance !== null} onClick={() => run("validation")}>{busy || pendingAdvance === 6 ? "正在设计验证…" : "生成本轮验证设计"}</button>
            {visibleTaskResultId === latestResult?.id && <section className="takeawayValidationConclusion"><header><strong>执行验证后，再填写结论</strong><span>先按上方步骤查完数据并保留截图或导出，再由负责人登记。</span></header>{validationConclusionOpenFor !== selectedCandidate.id ? <button type="button" onClick={() => setValidationConclusionOpenFor(selectedCandidate.id)}>我已完成现场核查，填写验证结论</button> : <><div className="takeawayConclusionChoices">{([
              ["supported", "问题成立"], ["rejected", "问题不成立"], ["insufficient", "证据不足"]
            ] as const).map(([value, label]) => <button type="button" key={value} className={validationConclusion === value ? "selected" : ""} onClick={() => setValidationConclusion(value)}>{label}</button>)}</div><label><span>结论证据</span><textarea value={validationEvidence} onChange={(event) => setValidationEvidence(event.target.value)} placeholder="填写验证周期、基线与测试结果、保持不变项及异常。" /></label><button type="button" disabled={validationEvidence.trim().length < 8} onClick={saveValidationConclusion}>保存验证结论</button></>}</section>}
            {validationRecords.length > 0 && <div className="takeawayValidationHistory"><strong>已登记结论</strong>{validationRecords.map((record) => <article key={record.candidateId}><b>{diagnosisCandidates.find((candidate) => candidate.id === record.candidateId)?.title ?? record.candidateId}</b><span>{record.conclusion === "supported" ? "问题成立" : record.conclusion === "rejected" ? "问题不成立" : "证据不足"}</span><p>{record.evidence}</p></article>)}</div>}
          </> : <p className="takeawayStepWarning">AI 诊断尚未找到有证据的候选问题。请先回到“AI经营诊断”生成详细问题，再进入验证。</p>}
        </section> : <label className={`takeawaySupplement ${!hasData ? "required" : ""}`}><span>{hasData && focusedCapabilityId === "takeaway_growth" ? "补充新的数据或经营变化（将生成新版完整诊断）" : hasData ? "补充本轮已知信息（将用于生成新的判断）" : "没有文件时，请填写真实经营情况"}</span><textarea value={supplement} onChange={(event) => setSupplement(event.target.value)} placeholder="例如：枕水江南中街店，近30天日均有效完成单由40降至28；6月18日调价；同期满减和投放未调整；当前希望先判断下滑发生在哪一环。" /></label>}
        <div className="takeawaySimplePromise"><strong>你会得到什么</strong><span>{focusedCapabilityId === "takeaway_problem_validation" ? "一个原因假设、支持与反证、成立标准，以及验证后该去哪里。" : focusedCapabilityId === "takeaway_growth" ? "一份完整诊断：事实、跨维度关联、问题清单、完整原因地图和验证顺序。单日低谷或单品成本只会作为线索，不会单独包装成AI结论。" : "完整原因地图不会少列；页面另行突出最多3个优先候选，本轮只验证1个。"}</span></div>
        {!stage && <section className="takeawayInlinePathRequired" aria-label="生成前确认分析方法"><div><strong>生成前还差一步：确认分析方法</strong><span>你填写的信息已经保留，选择后即可生成。</span></div><div><button type="button" onClick={() => setStage("mature")}><b>稳定经营 / 恢复增长</b><small>已有可参考历史数据</small></button><button type="button" onClick={() => setStage("new")}><b>启动 / 起量</b><small>尚未稳定出单</small></button></div></section>}
        {focusedCapabilityId !== "takeaway_problem_validation" && focusedCapabilityId !== "takeaway_growth" && <button type="button" className="takeawayRunButton takeawayPrimaryRun" disabled={(!hasData && !canRunTextPreview) || busy || pendingAdvance !== null} onClick={() => stage ? run("diagnosis") : document.querySelector(".takeawayInlinePathRequired")?.scrollIntoView({ behavior: "smooth", block: "center" })}>{busy || pendingAdvance === 4 ? "正在分析数据并整理问题…" : !stage ? "请先选择分析方法" : supplement.trim() ? "按补充信息重新分析" : hasData ? primaryRunLabel : "根据我的描述给建议"}</button>}
        {focusedCapabilityId === "takeaway_growth" && (supplement.trim() || latestResult?.deliveryStatus === "failed") && <button type="button" className="takeawayRunButton takeawayPrimaryRun" disabled={!stage || busy || pendingAdvance !== null} onClick={() => run("diagnosis")}>{busy || pendingAdvance === 4 ? "正在更新完整诊断…" : latestResult?.deliveryStatus === "failed" ? "重新生成完整诊断" : "按补充信息更新完整诊断"}</button>}
        {focusedCapabilityId === "takeaway_growth" && !supplement.trim() && latestResult?.deliveryStatus !== "failed" && <p className="takeawayAutoDiagnosisNotice" aria-live="polite">{busy || resultPending ? "AI正在读取数据、寻找跨维度关联并生成完整诊断…" : "进入即输出完整诊断：AI优先寻找人工不易直接看出的组合信号，不只是单日低谷或单品成本；补充数据或经营变化后，会再次诊断并生成新版结果。"}</p>}
        {!hasData && <div className={`takeawayTextPreviewNotice ${canRunTextPreview ? "ready" : ""}`}><strong>{canRunTextPreview ? "可以生成文字预诊断" : `还需补充 ${Math.max(0, 20 - textBriefLength)} 字`}</strong><p>{canRunTextPreview ? "输出会标记为低可信度，所有指标均视为用户自述待核验，并附正式诊断所需数据清单。" : "建议写明门店、周期、平台、当前指标、变化情况、已做动作和希望解决的问题。"}</p></div>}
      </section>}

      {activeStep === 4 && !focusedTaskResultReady && <section className="takeawayStepPanel">
        <div className="takeawayStepHeading"><span>{focusedCapabilityId === "takeaway_execution" ? "第 6 步" : "第 5 步"}</span><h3>{focusedCapabilityId === "takeaway_execution" ? "按已审批方案真实执行并每日回填" : "把已验证问题变成增长落地方案"}</h3><p>{focusedCapabilityId === "takeaway_execution" ? "系统不会替你标记完成；门店真实落地后，请逐日记录动作、指标和异常。" : "只有问题验证成立后才生成方案，本轮只改一件事，避免无法判断什么有效。"}</p></div>
        {focusedCapabilityId === "takeaway_execution" ? <>
          {!growthPlanCompleted && <p className="takeawayStepWarning">当前还没有已生成的增长落地方案。请返回任务地图，先完成“增长落地方案”。</p>}
          {growthPlanCompleted && !dailyCheckins.length && <section className="takeawayStartRealExecution"><strong>方案已生成，等待门店开始真实执行</strong><p>旧模拟回填不会带入本任务。点击后只创建空白回填表，负责人、实际指标、现场记录和完成状态都必须由门店真实填写。</p><button type="button" onClick={startRealExecution}>开始真实执行回填</button></section>}
          {dailyCheckins.length > 0 && <DailyExecutionPlan days={planDays} checkins={dailyCheckins} onUpdate={updateDailyCheckin} onReview={startEffectEvaluationFromDailyPlan} />}
        </> : <>
        {focusedCapabilityId === "takeaway_experiment" && !stage && <section className="takeawayPathConfirm"><div><strong>先确认执行主路径</strong><span>选择老店增长或新店起量，执行计划会使用对应目标和判断方式。</span></div><div className="takeawayPathChoices"><button type="button" onClick={() => setStage("mature")}><b>老店增长</b><small>解决订单下滑或增长停住</small></button><button type="button" onClick={() => setStage("new")}><b>新店起量</b><small>解决曝光、进店和首批订单</small></button></div></section>}
        {!confirmedCandidate && <p className="takeawayStepWarning">只有验证为“问题成立”的原因，才能生成增长方案。请先返回“问题验证”登记真实验证结论。</p>}
        {confirmedCandidate && <section className="takeawayConfirmedCause"><span>已验证问题</span><strong>{confirmedCandidate.title}</strong><p>{validationRecords.find((record) => record.candidateId === confirmedCandidate.id && record.conclusion === "supported")?.evidence}</p></section>}
        <label className="takeawaySupplement"><span>审批约束（可选）</span><textarea value={supplement} onChange={(event) => setSupplement(event.target.value)} placeholder="例如：预算不变；负责人李响；其他价格、活动和投放保持不变。" /></label>
        <fieldset className="takeawayPlanDuration"><legend>选择执行周期</legend><button type="button" className={planDays === 7 ? "selected" : ""} disabled={growthPlanCompleted} onClick={() => setPlanDays(7)}><b>7天</b><span>快速执行一个已验证问题的方案</span></button><button type="button" className={planDays === 14 ? "selected" : ""} disabled={growthPlanCompleted} onClick={() => setPlanDays(14)}><b>14天</b><span>观察效果是否稳定和可复制</span></button></fieldset>
        <div className="takeawaySimplePromise"><strong>执行卡会写清楚</strong><span>谁来做、什么时候做、看哪3个数、什么情况立即停止。</span></div>
        {growthPlanCompleted
          ? <p className="takeawaySuccessNotice">增长方案已生成。请返回任务地图进入“真实执行与回填”，由门店开始填写真实数据。</p>
          : <button type="button" className="takeawayRunButton" disabled={!stage || !confirmedCandidate || busy || pendingAdvance !== null} onClick={() => run("experiment")}>{busy || pendingAdvance === 5 ? "正在生成增长方案…" : `生成${planDays}天增长方案`}</button>}
        </>}
      </section>}

      {activeStep === 5 && !focusedTaskResultReady && <section className="takeawayStepPanel">
        <div className="takeawayStepHeading"><span>{focusedCapabilityId === "takeaway_effect_evaluation" ? "第 7 步" : "第 8 步"}</span><h3>{focusedCapabilityId === "takeaway_effect_evaluation" ? "判断真实执行后是否发生增长" : "周期复盘并决定下一轮"}</h3><p>{focusedCapabilityId === "takeaway_effect_evaluation" ? "先确认基线和执行期是否可比，再判断增长、无增长、负增长或证据不足。" : "综合本轮全部证据，决定继续、调整、停止或回到诊断。"}</p></div>
        {focusedCapabilityId === "takeaway_review" && !stage && <section className="takeawayPathConfirm"><div><strong>确认本轮复盘主路径</strong><span>请选择这次执行对应的是老店增长还是新店起量。</span></div><div className="takeawayPathChoices"><button type="button" onClick={() => setStage("mature")}><b>老店增长</b><small>复盘订单和利润是否改善</small></button><button type="button" onClick={() => setStage("new")}><b>新店起量</b><small>复盘曝光、进店和首批订单</small></button></div></section>}
        {!growthPlanCompleted && <p className="takeawayStepWarning">请先完成问题验证并生成增长方案。</p>}
        {!dailyPlanCompleted && <p className="takeawayStepWarning">请先在“真实执行与回填”完成每日真实记录，再评估增长效果。</p>}
        {focusedCapabilityId === "takeaway_effect_evaluation" ? <section className="takeawayEffectForm" aria-label="目标与实际增长对比">
          <header><strong>目标与实际增长对比</strong><span>系统按同一个指标比较基线、目标与实际，不再用一段模糊文字代替判断。</span></header>
          <div><label><span>目标指标</span><input value={effectEvaluation.metric} onChange={(event) => setEffectEvaluation((current) => ({ ...current, metric: event.target.value }))} placeholder="例如：日均有效完成单" /></label><label><span>对比周期</span><input value={effectEvaluation.period} onChange={(event) => setEffectEvaluation((current) => ({ ...current, period: event.target.value }))} placeholder="例如：8月1日至8月7日 vs 同星期基线" /></label><label><span>基线值</span><input type="number" value={effectEvaluation.baseline} onChange={(event) => setEffectEvaluation((current) => ({ ...current, baseline: event.target.value }))} /></label><label><span>目标值</span><input type="number" value={effectEvaluation.target} onChange={(event) => setEffectEvaluation((current) => ({ ...current, target: event.target.value }))} /></label><label><span>实际值</span><input type="number" value={effectEvaluation.actual} onChange={(event) => setEffectEvaluation((current) => ({ ...current, actual: event.target.value }))} /></label><label className="wide"><span>异常与并发变化</span><textarea value={effectEvaluation.notes} onChange={(event) => setEffectEvaluation((current) => ({ ...current, notes: event.target.value }))} placeholder="如实填写同期停业、缺货、改价、活动或天气变化；没有则填无。" /></label></div>
        </section> : <label className="takeawaySupplement required"><span>本轮复盘补充</span><textarea value={supplement} onChange={(event) => setSupplement(event.target.value)} placeholder="填写效果评估结论、风险、副作用及负责人意见。" /></label>}
        <div className="takeawaySimplePromise"><strong>你会得到什么</strong><span>有效或无效、为什么、接下来只做哪一件事。</span></div>
        <button type="button" className="takeawayRunButton" disabled={!stage || !growthPlanCompleted || !dailyPlanCompleted || busy || (focusedCapabilityId === "takeaway_effect_evaluation" ? !evaluationReady : !evaluationCompleted || supplement.trim().length < 8)} onClick={() => run(focusedCapabilityId === "takeaway_effect_evaluation" ? "evaluation" : "review")}>{busy ? "正在判断结果…" : focusedCapabilityId === "takeaway_effect_evaluation" ? "对比目标与实际，评估是否增长" : "生成周期复盘与下一轮决策"}</button>
      </section>}
      </>}
      {visibleTaskResultId === latestResult?.id && latestResultContent && <section className={`takeawayTaskDelivery ${latestResult.deliveryStatus ?? "completed"}`} aria-live="polite">
        <header><span>{focusedTask ? "本任务结果" : "本轮任务结果"}</span><strong>{latestResult.deliveryStatus === "failed" ? "生成失败，请按提示补充或重试" : latestResult.deliveryStatus === "needs_input" ? "需要补充信息" : "已生成"}</strong></header>
        {dataStatus && <p className="takeawayDataEvidenceTag">本次使用数据：{dataStatus.importCount} 份文件 / {dataStatus.rowCount.toLocaleString("zh-CN")} 行 / 更新至 {dataStatus.latestDataDate ?? "待识别"}</p>}
        {appliedSupplement && <section className="takeawaySupplementImpact" aria-label="本轮判断已更新"><header><div><span>本轮判断已更新</span><strong>以下判断已纳入你补充的经营变化</strong></div><em>事实补充，不改写原始数据</em></header><ul>{supplementFacts(appliedSupplement).map((fact, index) => <li key={`${fact}-${index}`}>{fact}</li>)}</ul><p>上方导入数据图表保持原样；这些补充用于解释变化发生前后的经营背景，不会被当作已经验证的因果结论。</p></section>}
        {dataStatus?.analysis && analysisView && focusedCapabilityId !== "takeaway_growth" && <section className="takeawayRawDataAnalysis"><header><span>原始导入数据</span><strong>图表只反映已导入文件，不会因补充信息被改写</strong></header><TakeawayAnalysisBoard data={dataStatus.analysis} compact view={analysisView} /></section>}
        <section className="takeawayUpdatedJudgment"><header><span>{focusedCapabilityId === "takeaway_growth" ? "AI诊断结论" : appliedSupplement ? "更新后的判断" : "本任务输出"}</span><strong>{focusedCapabilityId === "takeaway_growth" ? "详细问题、证据、影响和下一步验证" : appliedSupplement ? "请重点查看补充信息如何改变了判断边界和下一步验证" : "基于当前真实数据生成"}</strong></header><div>{latestResultContent}</div></section>
        {focusedTaskResultReady && focusedCapabilityId !== "takeaway_problem_validation" && <footer className="takeawayTaskMapNext"><div><strong>本任务已完成</strong><span>请返回任务地图，选择下一项需要处理的任务。</span></div><button type="button" onClick={returnToTaskMap}>返回任务地图，选择下一步</button></footer>}
      </section>}
      {focusedTask && focusedCapabilityId && <TaskConversationPanel taskTitle={focusedTask.title} messages={taskConversation} value={taskChatInput} mode={taskChatMode} busy={busy || resultPending} onChange={setTaskChatInput} onModeChange={setTaskChatMode} onSend={sendTaskChat} />}
    </div>
  </section>;
}

function TakeawayThinkingProgress({ mode }: { mode: TaskChatMode }) {
  const stages = mode === "revise"
    ? ["正在保留已经确认的内容", "正在核对你指定的修改范围", "正在整理更新后的执行方案"]
    : ["正在读取当前页面的数据范围", "正在核对数据缺口与异常依据", "正在整理可执行的结论"];
  const [stageIndex, setStageIndex] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => setStageIndex((current) => Math.min(current + 1, stages.length - 1)), 1800);
    return () => window.clearInterval(timer);
  }, [stages.length]);

  return <section className="takeawayThinkingProgress" role="status" aria-live="polite">
    <header><span>AI 正在分析</span><strong>{stages[stageIndex]}</strong></header>
    <ol>{stages.map((stage, index) => <li key={stage} className={index < stageIndex ? "done" : index === stageIndex ? "active" : ""}><i aria-hidden="true">{index < stageIndex ? "✓" : index + 1}</i><span>{stage}</span></li>)}</ol>
    <p>这是进度提示，不展示内部推理；不会执行改价、投放、上下架等外部动作。</p>
  </section>;
}

function TaskConversationPanel({ taskTitle, messages, value, mode, busy, onChange, onModeChange, onSend }: { taskTitle: string; messages: Array<{ id: string; role: "user" | "assistant"; content: string; rendered?: ReactNode }>; value: string; mode: TaskChatMode; busy: boolean; onChange: (value: string) => void; onModeChange: (mode: TaskChatMode) => void; onSend: (messageOverride?: string) => void }) {
  const quickPrompts: Array<{ label: string; mode: TaskChatMode }> = [
    { label: "这个分数是什么意思？", mode: "ask" },
    { label: "解释这条异常的依据", mode: "ask" },
    { label: "把方案改得更简单", mode: "revise" },
    { label: "预算不变，重新调整方案", mode: "revise" }
  ];
  return <section className="takeawayTaskConversation" aria-label={`${taskTitle}任务对话`}>
    <header><div><span>人机协作区</span><strong>先选择你要问问题，还是修改方案</strong><p>普通追问只在这里回答，不会覆盖上面的任务结果；只有“修改方案”才会更新结果。</p></div><em>当前任务：{taskTitle}</em></header>
    <div className="takeawayTaskChatModes" role="group" aria-label="选择对话目的">
      <button type="button" className={mode === "ask" ? "selected" : ""} disabled={busy} onClick={() => onModeChange("ask")}><b>问问题</b><span>解释分数、图表、异常或结论</span></button>
      <button type="button" className={mode === "revise" ? "selected" : ""} disabled={busy} onClick={() => onModeChange("revise")}><b>修改方案</b><span>明确要求AI重写当前方案</span></button>
    </div>
    {messages.length > 0 ? <div className="takeawayTaskConversationMessages">{messages.map((message) => <article key={message.id} className={message.role}><span>{message.role === "user" ? "你" : "AI"}</span><div>{message.role === "assistant" && message.rendered ? message.rendered : <p>{message.content}</p>}</div></article>)}{busy && <article className="assistant thinking"><span>AI</span><div><TakeawayThinkingProgress mode={mode} /></div></article>}</div> : <div className="takeawayTaskConversationEmpty"><strong>现在可以继续和AI交流</strong><p>问数字时最好带上旁边的名称，例如：“识别质量61/100是什么意思？”；要改方案时先切换到“修改方案”。</p></div>}
    <div className="takeawayTaskQuickPrompts">{quickPrompts.map((prompt) => <button key={prompt.label} type="button" disabled={busy} onClick={() => { onModeChange(prompt.mode); onChange(prompt.label); }}>{prompt.label}</button>)}</div>
    <label className="takeawayTaskChatComposer"><textarea value={value} disabled={busy} onChange={(event) => onChange(event.target.value)} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") onSend(); }} placeholder={mode === "ask" ? "例如：识别质量61/100是什么意思？为什么只显示这3条异常？" : "例如：预算不变，把执行周期改为7天，并明确每天谁负责。"} /><div><span>{mode === "ask" ? "本次只回答问题，不更新任务结果" : "本次会更新上方任务结果"} · Ctrl + Enter 发送</span><button type="button" disabled={busy || value.trim().length < 2} onClick={() => onSend()}>{busy ? "AI正在回复…" : mode === "ask" ? "发送问题" : "发送并修改方案"}</button></div></label>
  </section>;
}

function DailyExecutionPlan({ days, checkins, onUpdate, onReview }: { days: 7 | 14; checkins: TakeawayDailyCheckin[]; onUpdate: (day: number, patch: Partial<TakeawayDailyCheckin>) => void; onReview: () => void }) {
  const savedCount = checkins.filter((item) => item.checkedAt).length;
  return <section id="takeaway-daily-execution" className="takeawayDailyExecution">
    <header><div><span>{days}天落地陪跑</span><strong>每天执行、每天回填</strong><p>每天完成后立即保存现场数据，不要等最后一天凭记忆补写。</p></div><em>{savedCount}/{days} 天已回填</em></header>
    <div className="takeawayDailyProgress"><i style={{ width: `${savedCount / days * 100}%` }} /></div>
    <div className="takeawayDailyList">{checkins.map((item) => {
      const fieldPrefix = `takeaway-daily-day-${item.day}`;
      return <details key={item.day} open={!item.checkedAt && item.day === Math.min(days, savedCount + 1)} className={item.checkedAt ? "saved" : ""}>
      <summary><b>第{item.day}天</b><span>{item.task}</span><em>{item.checkedAt ? "已回填" : "待执行"}</em></summary>
      <div className="takeawayDailyForm">
        <label htmlFor={`${fieldPrefix}-owner`}>负责人<input id={`${fieldPrefix}-owner`} name={`${fieldPrefix}-owner`} aria-label={`第${item.day}天负责人`} value={item.owner} onChange={(event) => onUpdate(item.day, { owner: event.target.value })} placeholder="填写姓名" /></label>
        <label htmlFor={`${fieldPrefix}-metrics`}>当天实际指标<input id={`${fieldPrefix}-metrics`} name={`${fieldPrefix}-metrics`} aria-label={`第${item.day}天当天实际指标`} value={item.metrics} onChange={(event) => onUpdate(item.day, { metrics: event.target.value })} placeholder="例如：曝光3200、进店210、有效订单35" /></label>
        <label className="wide" htmlFor={`${fieldPrefix}-note`}>现场记录或未完成原因<textarea id={`${fieldPrefix}-note`} name={`${fieldPrefix}-note`} aria-label={`第${item.day}天现场记录或未完成原因`} value={item.note} onChange={(event) => onUpdate(item.day, { note: event.target.value })} placeholder="写明实际做了什么、有什么异常，不确定也如实记录" /></label>
        <label className="takeawayDailyDone" htmlFor={`${fieldPrefix}-completed`}><input id={`${fieldPrefix}-completed`} name={`${fieldPrefix}-completed`} aria-label={`第${item.day}天任务已按计划完成`} type="checkbox" checked={item.completed} onChange={(event) => onUpdate(item.day, { completed: event.target.checked })} />当天任务已按计划完成</label>
        <button type="button" aria-label={`保存第${item.day}天回填`} onClick={() => onUpdate(item.day, { checkedAt: new Date().toISOString() })} disabled={!item.owner.trim() || !item.note.trim()}>{item.checkedAt ? "更新今日回填" : "保存今日回填"}</button>
      </div>
    </details>;
    })}</div>
    <footer><div><strong>完成后先评估增长效果</strong><span>系统会汇总每天的真实记录，与同口径基线比较；评估完成后再进入周期复盘。</span></div><button type="button" onClick={onReview} disabled={savedCount < days}>全部回填完成，评估增长效果</button></footer>
  </section>;
}

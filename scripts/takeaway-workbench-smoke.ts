import {
  TAKEAWAY_DIAGNOSIS_MODULES,
  buildTakeawayWorkbenchPrompt,
  capabilityForDiagnosis,
  resolveTakeawayDiagnosisReadiness,
  type TakeawayWorkbenchDataStatus
} from "../apps/web/src/components/takeaway/takeaway-workbench-config.js";
import { formatStructuredSectionMarkdown } from "../apps/web/src/lib/structured-answer.js";
import { readFileSync } from "node:fs";

const expected = new Map([
  ["mature:overview", "mature_store_growth"],
  ["new:overview", "new_store_breakthrough"],
  ["mature:menu", "takeaway_menu_profit"],
  ["new:campaign", "takeaway_campaign_roi"],
  ["mature:competitor", "takeaway_competitor_loss"]
]);

for (const [key, capabilityId] of expected) {
  const [stage, moduleId] = key.split(":") as ["mature" | "new", "overview" | "menu" | "campaign" | "competitor"];
  if (capabilityForDiagnosis(stage, moduleId) !== capabilityId) throw new Error(`workbench_route_mismatch:${key}`);
}

if (TAKEAWAY_DIAGNOSIS_MODULES.length !== 4) throw new Error("workbench_module_count_invalid");

const summaryDataStatus: TakeawayWorkbenchDataStatus = {
  importCount: 17,
  rowCount: 12792,
  qualityScore: 61,
  level: "partial",
  latestDataDate: "2026-07-31",
  missingFields: ["计划名称", "广告消耗"],
  productEvidence: "catalog_only",
  campaignEvidence: "summary",
  coverage: { funnel: true, products: false, catalog: true, campaigns: true, costs: false, prices: true },
  contextPrompt: "有效完成单：12140；活动成本汇总已识别；无计划级投放ROI。"
};

const overviewRoute = resolveTakeawayDiagnosisReadiness(summaryDataStatus, "overview");
if (overviewRoute.mode !== "explore" || !overviewRoute.label.includes("自动检查全店")) throw new Error("overview_should_use_ai_exploration");
const campaignRoute = resolveTakeawayDiagnosisReadiness(summaryDataStatus, "campaign");
if (campaignRoute.mode !== "explore" || !campaignRoute.label.includes("活动成本") || !campaignRoute.dataNeed?.includes("计划名称")) {
  throw new Error("campaign_summary_should_not_claim_plan_roi");
}

const detailCampaignRoute = resolveTakeawayDiagnosisReadiness({ ...summaryDataStatus, campaignEvidence: "detail" }, "campaign");
if (detailCampaignRoute.mode !== "standard" || !detailCampaignRoute.label.includes("投放数据够用")) throw new Error("campaign_detail_should_use_standard_diagnosis");

for (const step of ["audit", "diagnosis", "validation", "experiment", "execution", "evaluation", "review"] as const) {
  const result = buildTakeawayWorkbenchPrompt({
    step,
    brandName: "枕水江南",
    stage: "new",
    moduleId: "menu",
    hasImportedData: true,
    dataContext: "有效完成单：100；数据质量：92/100。",
    supplement: step === "review" ? "实际执行7天，有效完成单由100增至112，利润护栏未触发。" : "中街店"
  });
  if (!result.prompt.includes(`固定模块：${result.capabilityId}`)) throw new Error(`capability_lock_missing:${step}`);
  if (!result.outputContract.every((section) => result.prompt.includes(section))) throw new Error(`output_contract_missing:${step}`);
  if (!result.prompt.includes("待确认")) throw new Error(`approval_boundary_missing:${step}`);
  if (!result.prompt.includes("全文不超过450个汉字") || !result.prompt.includes("不要使用口径、归因、证伪、护栏")) {
    throw new Error(`plain_language_rule_missing:${step}`);
  }
}

const review = buildTakeawayWorkbenchPrompt({ step: "review", brandName: "枕水江南", stage: "mature", moduleId: "overview" });
if (!review.prompt.includes("不得补造结果")) throw new Error("review_evidence_boundary_missing");

const textPreview = buildTakeawayWorkbenchPrompt({
  step: "diagnosis",
  brandName: "枕水江南",
  stage: "mature",
  moduleId: "overview",
  hasImportedData: false,
  supplement: "中街店近30天日均有效完成单从40降到28，调价后继续下滑，希望判断优先问题。"
});
if (textPreview.capabilityId !== "mature_store_growth") throw new Error("text_preview_capability_not_locked");
if (!textPreview.prompt.includes("低可信度文字预诊断") || !textPreview.prompt.includes("用户自述·待核验")) throw new Error("text_preview_boundary_missing");
if (!textPreview.outputContract.includes("还缺什么数据")) throw new Error("text_preview_data_request_missing");

const exploration = buildTakeawayWorkbenchPrompt({
  step: "diagnosis",
  brandName: "枕水江南",
  stage: "mature",
  moduleId: "campaign",
  hasImportedData: true,
  dataStatus: summaryDataStatus,
  dataContext: summaryDataStatus.contextPrompt
});
for (const section of ["证据等级", "钱花在哪里", "目前能否判断回报", "现在只做这一件事", "待补数据", "还缺什么数据"]) {
  if (!exploration.outputContract.includes(section)) throw new Error(`exploration_contract_missing:${section}`);
}
if (!exploration.prompt.includes("活动投放专属模式") || !exploration.prompt.includes("不是每个广告计划的花费")) {
  throw new Error("exploration_evidence_boundary_missing");
}

const groundedCity = buildTakeawayWorkbenchPrompt({
  step: "diagnosis",
  brandName: "枕水江南",
  stage: "mature",
  moduleId: "menu",
  hasImportedData: true,
  dataContext: "当前存在上海本帮红烧肉套餐；菜品货盘已识别。"
});
if (!groundedCity.prompt.includes("经营城市为沈阳") || !groundedCity.prompt.includes("不得推断为经营城市")) throw new Error("zhenshui_city_grounding_missing");
for (const section of ["菜单数据结论", "菜品与套餐问题", "利润风险", "现在只做这一件事", "待补数据"]) {
  if (!groundedCity.outputContract.includes(section)) throw new Error(`plain_language_output_contract_missing:${section}`);
}

const totalDiagnosis = buildTakeawayWorkbenchPrompt({
  step: "diagnosis",
  brandName: "枕水江南",
  stage: "mature",
  moduleId: "overview",
  hasImportedData: true,
  capabilityIdOverride: "takeaway_growth"
});
if (totalDiagnosis.capabilityId !== "takeaway_growth" || !totalDiagnosis.prompt.includes("固定模块：takeaway_growth")) {
  throw new Error("task_map_total_diagnosis_not_locked");
}
for (const rule of [
  "详细问题清单",
  "订单增长影响与利润影响必须分开判断",
  "没有异常证据只能写暂无异常证据或数据不足",
  "本任务禁止生成7天或14天落地计划"
]) {
  if (!totalDiagnosis.prompt.includes(rule)) throw new Error(`total_diagnosis_semantic_rule_missing:${rule}`);
}

const brandDefinedStage = buildTakeawayWorkbenchPrompt({
  step: "diagnosis",
  brandName: "枕水江南",
  stage: "new",
  moduleId: "overview",
  operatingStageLabel: "开业第2个月起量不达标"
});
if (!brandDefinedStage.prompt.includes("品牌定义的当前经营阶段：开业第2个月起量不达标") || !brandDefinedStage.prompt.includes("不得用统一开业天数替代品牌定义")) {
  throw new Error("brand_defined_operating_stage_missing");
}

const malformedEmphasis = formatStructuredSectionMarkdown("**唯一动作:** **只新增或重排一个目标价位套餐；不要同时改满减。");
if (malformedEmphasis !== "唯一动作: 只新增或重排一个目标价位套餐；不要同时改满减。") {
  throw new Error(`structured_answer_emphasis_not_repaired:${malformedEmphasis}`);
}
const unmatchedEmphasis = formatStructuredSectionMarkdown("结论：**先检查商品点击率");
if (unmatchedEmphasis.includes("**")) throw new Error("structured_answer_unmatched_stars_visible");
const spacedEmphasis = formatStructuredSectionMarkdown("**唯一 动作： **从已确认最大断点中只选一个。");
if (spacedEmphasis.includes("**") || spacedEmphasis.includes("*")) throw new Error("structured_answer_spaced_stars_visible");

const workbenchSource = readFileSync(new URL("../apps/web/src/components/takeaway/TakeawayGrowthWorkbench.tsx", import.meta.url), "utf8");
const agentProductsSource = readFileSync(new URL("../apps/web/src/pages/AgentProductsApp.tsx", import.meta.url), "utf8");
const dataPanelSource = readFileSync(new URL("../apps/web/src/components/takeaway/TakeawayGrowthDataPanel.tsx", import.meta.url), "utf8");
const takeawayDataServiceSource = readFileSync(new URL("../apps/api/src/services/takeaway-growth-data.ts", import.meta.url), "utf8");
const analysisBoardSource = readFileSync(new URL("../apps/web/src/components/takeaway/TakeawayAnalysisBoard.tsx", import.meta.url), "utf8");
const agentProductsStyles = readFileSync(new URL("../apps/web/src/styles/agent-products.css", import.meta.url), "utf8");
const structuredAnswerSource = readFileSync(new URL("../apps/web/src/lib/structured-answer.ts", import.meta.url), "utf8");
for (const requiredSource of [
  'takeawayPathConfirm',
  '先确认本轮分析方法',
  '主路径已确认',
  "takeaway_data_foundation",
  "数据与经营阶段",
  "上传完成后自动检查数据是否可用",
  "数据是否可用",
  "还缺什么数据",
  "onOpenCapability?.(\"takeaway_growth\")",
  "进入即输出完整诊断",
  "再次诊断",
  "latestResult",
  "setPendingAdvance(4)",
  "setDiagnosisCompleted(true)",
  "setGrowthPlanCompleted(true)",
  "每天执行、每天回填",
  "生成前还差一步：确认分析方法",
  "请先选择分析方法",
  "先选择你要问问题，还是修改方案",
  "本次只回答问题，不更新任务结果",
  "本次会更新上方任务结果",
  "识别质量61/100是什么意思",
  "模式：${modeLabel}",
  "逐文件检查（共 ",
  "以下全部显示",
  "文件识别 {file.qualityScore} 分",
  "外卖任务页持续对话",
  "选择执行周期",
  "全部回填完成，评估增长效果",
  "function buildDailyReviewSummary",
  "【14天回填汇总】",
  "含模拟测试回填，只用于验证流程，不代表真实经营结果。",
  "尚未提供同星期基线期与测试期的汇总对比",
  'step === "evaluation" ? evaluationSupplement',
  "onRun(task.capabilityId, task.prompt, task.display)",
  "takeaway-daily-day-${item.day}",
  "aria-label={`第${item.day}天负责人`}",
  "aria-label={`第${item.day}天当天实际指标`}",
  "aria-label={`第${item.day}天现场记录或未完成原因`}",
  "aria-label={`保存第${item.day}天回填`}",
  "setAuditCompleted(true)",
  "setFocusedCapabilityId(capabilityId)",
  "visibleTaskResultId",
  "takeawayTaskDelivery",
  "!focusedTask && <div className=\"takeawayModuleGrid\">",
  "focusedTask ? returnToTaskMap : onOpenTaskMap",
  "如需其他任务，请返回任务地图切换",
  "现在也能先看方向",
  "生成一份简单建议",
  "resolveTakeawayDiagnosisReadiness",
  "对比目标与实际，评估是否增长",
  "继续进行增长诊断",
  "onOpenCapability(\"takeaway_menu_profit\")",
  "takeawayDataEvidenceTag",
  "本次使用数据：",
  "经营阶段可以先保存",
  "自动数据可用性检查",
  "逐文件检查",
  "缺失数据会影响什么",
  "htmlFor=\"takeaway-task-import-input\"",
  "暂不补充，按现有数据继续",
  "focusedTask ? returnToTaskMap",
  "takeawayTaskMapNext",
  "返回任务地图，选择下一步",
  "三步得到一份能直接执行的建议",
  "takeawayWorkflowSteps simple",
  "takeawaySimplePromise",
  "takeawaySupplementImpact",
  "更新后的判断",
  "品牌定义的经营阶段",
  "保存经营阶段",
  "开业或平台上线日期",
  "diagnosisCandidates",
  "AI诊断结论",
  "影响订单增长",
  "影响利润",
  "选择要验证的问题",
  "先做现场核查",
  "buildValidationBlueprint",
  "我已完成现场核查，填写验证结论",
  "验证结论",
  "问题成立",
  "问题不成立",
  "证据不足",
  "只有验证为“问题成立”的原因，才能生成增长方案",
  "开始真实执行回填",
  "takeaway-real-execution-v1",
  "目标指标",
  "基线值",
  "目标值",
  "实际值",
  "品牌定义的当前经营阶段（建议填写）",
  "分析方法已确认",
  "当前任务状态",
  "完整原因地图不会少列",
  "跨维度关联",
  "人工不易直接看出的组合信号",
  "不只是单日低谷或单品成本",
  "automaticDiagnosisRef",
  "按补充信息更新完整诊断",
  "takeaway_problem_validation",
  "真实执行与每日回填",
  "增长效果评估",
  "takeaway-operating-stage-v2:${storageScope}:${brandName}",
  "经营阶段可以先保存"
  ,"TakeawayThinkingProgress"
  ,"正在读取当前页面的数据范围"
  ,"正在核对数据缺口与异常依据"
  ,"正在整理可执行的结论"
  ,"这是进度提示，不展示内部推理"
]) {
  if (!workbenchSource.includes(requiredSource)) throw new Error(`workbench_ux_contract_missing:${requiredSource}`);
}
if (workbenchSource.includes("auditSourceFiles.slice(0, 5)")) throw new Error("workbench_must_not_hide_imported_file_scores");
if (workbenchSource.includes("takeaway-daily-plan-v2")) throw new Error("legacy_simulated_daily_plan_must_not_be_loaded");
if (workbenchSource.includes('if (step === "experiment") setDailyCheckins')) throw new Error("growth_plan_must_not_prefill_real_execution");
if (workbenchSource.includes("{experimentCompleted && dailyCheckins.length > 0 && <DailyExecutionPlan")) throw new Error("daily_checkin_must_not_render_inside_every_delivery");

for (const requiredSource of [
  "AI发现了什么异常",
  "发现依据",
  "怎么比较",
  "科学验证",
  "每日有效订单趋势",
  "经营驾驶舱总览",
  "成交额与有效订单趋势",
  "经营漏斗全景",
  "异常优先级",
  "平台转化效率对比",
  "菜品成交额结构",
  "菜品成本率风险",
  "PlatformEfficiencyChart",
  "RefundTrendChart",
  "PlatformInvestmentDecisionCard",
  "淘宝闪购与美团：平台投入决策",
  "广告回收=广告成交额÷广告消耗",
  "订单口径待对齐",
  "平台转化效率图",
  "退款金额与退款率趋势"
]) {
  if (!analysisBoardSource.includes(requiredSource)) throw new Error(`takeaway_analysis_board_missing:${requiredSource}`);
}

for (const requiredSource of [
  'variant?: "panel" | "import-only"',
  'multiple accept=".xlsx,.xls,.csv,.tsv,.json,.txt"',
  'const importFeedback',
  '{importFeedback}',
  'campaignEvidence: dashboard.dataStatus.campaignEvidence',
  '图片证据尚未结构化',
  '不得当作广告投放消耗或计划级 ROI',
  'inputId?: string',
  'id={inputId}',
  '选择 {importResults.length} 份',
  '新增 {newCount} 份 / 重复 {duplicateCount} 份 / 失败 {failedCount} 份',
  '本次导入明细',
  '文件内容与已导入记录一致，已保留原记录',
  '去重后已入库文件（共 {dashboard.recentImports.length} 份）',
  '右侧是每份文件的识别质量，不是经营业绩分',
  '数据识别质量 {dashboard!.dataStatus.qualityScore}/100'
]) {
  if (!dataPanelSource.includes(requiredSource)) throw new Error(`embedded_import_contract_missing:${requiredSource}`);
}
if (takeawayDataServiceSource.includes("recentImports: imports.slice(0, 8)")) throw new Error("takeaway_recent_imports_must_not_be_capped_at_eight");

for (const requiredSource of [
  'agent.slug === "takeaway-growth" && takeawayMapEntry && <section className="takeawayTaskMapExecutionOverlay"',
  'takeawayMapEntry.capabilityId === "takeaway_data_foundation"',
  'takeawayMapEntry.capabilityId === "takeaway_data_foundation"',
  'setTakeawayMapEntry({ capabilityId: "takeaway_data_foundation", requestId: Date.now() })',
  'agent.slug === "takeaway-growth" && !takeawayMapEntry && <TakeawayGrowthWorkbench',
  'onOpenTaskMap={() => setWorkMapOpen(true)}',
  'open={workMapOpen && !(agent.slug === "takeaway-growth" && takeawayMapEntry)}',
  'agent.slug !== "takeaway-growth" && messages.map((message) => (',
  'setTakeawayMapEntry(null);\n              setWorkMapOpen(true);',
  'onOpenCapability={(capabilityId) => {',
  'latestTakeawayAssistant ? <StructuredAnswerBody content={latestTakeawayAssistant.content} compact />',
  'latestTakeawayPrimaryAssistant(messages)',
  'dialogueMode === "revise"',
  'conversationMessages={messages.map((message) =>',
  'inputId="takeaway-task-import-input"',
  'takeawayOperatingBrief'
]) {
  if (!agentProductsSource.includes(requiredSource)) throw new Error(`task_map_execution_shell_missing:${requiredSource}`);
}

for (const requiredSource of [
  "异常判断",
  "待验证假设",
  "本轮动作",
  "决策标准",
  "displaySectionMarker",
  "actual display order",
  "stripAnswerStars",
  "cleanStructuredMarkdown",
  "if (/[：:；;。]/.test(numbered[2])"
]) {
  if (!agentProductsSource.includes(requiredSource)) throw new Error(`structured_answer_label_missing:${requiredSource}`);
}

for (const requiredSource of [
  "const starFreeContent = content.replace(/[＊*]/g, \"\")",
  "return normalized.replace(/\\*\\*/g, \"\")"
]) {
  if (!structuredAnswerSource.includes(requiredSource)) throw new Error(`structured_answer_star_cleanup_missing:${requiredSource}`);
}

for (const requiredStyle of [
  ".structuredAnswer.compact .answerSectionCard>.markdownResult p{padding:0;background:transparent",
  ".structuredAnswer.compact .answerSectionCard>.markdownResult li:last-child{border-bottom:0}"
]) {
  if (!agentProductsStyles.includes(requiredStyle)) throw new Error(`compact_answer_style_missing:${requiredStyle}`);
}

console.log("takeaway workbench smoke passed");

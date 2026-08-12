export type TakeawayStoreStage = "mature" | "new";

export type TakeawayDiagnosisModuleId = "overview" | "menu" | "campaign" | "competitor";
export type TakeawayDiagnosisMode = "standard" | "explore";

const TAKEAWAY_FIELD_LABELS: Record<string, string> = {
  date: "日期",
  city: "城市",
  platform: "平台",
  storeName: "门店名称",
  orderId: "订单号",
  orderStatus: "订单状态",
  productName: "菜品名称",
  productItems: "订单中的菜品明细",
  productCategory: "菜品分类",
  quantity: "购买份数",
  salesQuantity: "菜品销量",
  originalAmount: "商品原价",
  paidAmount: "顾客实付金额",
  merchantSubsidy: "商家补贴",
  platformSubsidy: "平台补贴",
  refundAmount: "退款金额",
  newCustomer: "新老客标识",
  prepMinutes: "出餐时长",
  costAmount: "菜品成本",
  meituanPrice: "美团售价",
  flashPrice: "淘宝闪购售价",
  discountedPrice: "折后价",
  campaignPrice: "活动价",
  exposure: "曝光量",
  visits: "进店量",
  orderCount: "下单量",
  effectiveOrders: "有效完成单",
  campaignName: "活动或投放计划名称",
  budget: "投放预算",
  spend: "投放消耗",
  clicks: "点击量",
  gmv: "成交额"
};

export function takeawayFieldLabel(field: string): string {
  return TAKEAWAY_FIELD_LABELS[field] ?? "未识别字段（请查看源文件表头）";
}

export interface TakeawayWorkbenchDataStatus {
  importCount: number;
  rowCount: number;
  qualityScore: number;
  level: "ready" | "partial" | "insufficient";
  latestDataDate?: string;
  selectedStore?: string;
  selectedPlatform?: string;
  missingFields: string[];
  warnings?: string[];
  sourceFiles?: Array<{
    filename: string;
    rowCount: number;
    duplicateCount: number;
    qualityScore: number;
    missingFields: string[];
    warnings: string[];
  }>;
  productEvidence: "sales" | "catalog_only" | "none";
  campaignEvidence: "detail" | "summary" | "none";
  coverage: {
    funnel: boolean;
    products: boolean;
    catalog: boolean;
    campaigns: boolean;
    costs: boolean;
    prices: boolean;
  };
  analysis?: TakeawayAnalysisData;
  contextPrompt: string;
}

export interface TakeawayAnalysisData {
  summary: {
    effectiveOrders?: number;
    paidAmount?: number;
    averageOrderValue?: number;
    refundRate?: number;
    contributionAmount?: number;
    contributionRate?: number;
    averagePrepMinutes?: number;
  };
  funnel: Array<{
    platform: string;
    exposure?: number;
    visits?: number;
    orders?: number;
    effectiveOrders?: number;
    entryRate?: number;
    orderRate?: number;
    completionRate?: number;
    paidAmount?: number;
    averageOrderValue?: number;
    refundAmount?: number;
    refundRate?: number;
    adSpend?: number;
    adGmv?: number;
    adRoi?: number;
    transactionEvidence?: "detail" | "funnel" | "aligned" | "conflicting" | "none";
    campaignEvidence?: "detail" | "summary" | "none";
  }>;
  trend: Array<{ date: string; effectiveOrders: number; paidAmount: number; refundAmount: number }>;
  products: Array<{ name: string; quantity: number; paidAmount: number; refundAmount: number; contributionAmount?: number }>;
  catalog: Array<{ name: string; costAmount?: number; referencePrice?: number; costRate?: number }>;
  campaigns: Array<{ name: string; platform: string; spend: number; orders: number; gmv: number; roi?: number; evidence: "detail" | "summary"; costType: "ad_spend" | "merchant_activity_cost" }>;
  anomalies: Array<{
    id: string;
    dimension: "trend" | "funnel" | "product" | "profit" | "campaign" | "fulfillment";
    severity: "high" | "medium" | "notice";
    confidence: "high" | "medium";
    title: string;
    evidence: string;
    comparison: string;
    verification: string;
  }>;
}

export interface TakeawayDiagnosisModule {
  id: TakeawayDiagnosisModuleId;
  title: string;
  subtitle: string;
  capabilityId: "takeaway_menu_profit" | "takeaway_campaign_roi" | "takeaway_competitor_loss" | "mature_store_growth";
  outputContract: string[];
}

export interface TakeawayDiagnosisReadiness {
  mode: TakeawayDiagnosisMode;
  label: string;
  reason: string;
  evidenceLabel: string;
  dataNeed?: string;
}

export const TAKEAWAY_DIAGNOSIS_MODULES: readonly TakeawayDiagnosisModule[] = [
  {
    id: "overview",
    title: "不知道问题在哪",
    subtitle: "让AI先看全店数据，找出最该先解决的一处",
    capabilityId: "mature_store_growth",
    outputContract: ["场景基线", "与正常水平相比", "当前最值得检查", "下一步"]
  },
  {
    id: "menu",
    title: "菜单和利润",
    subtitle: "看看菜品、套餐和价格哪里需要调整",
    capabilityId: "takeaway_menu_profit",
    outputContract: ["菜单数据结论", "菜品与套餐问题", "利润风险", "现在只做这一件事", "待补数据"]
  },
  {
    id: "campaign",
    title: "活动和投放",
    subtitle: "看看钱花得值不值，下一步先改哪里",
    capabilityId: "takeaway_campaign_roi",
    outputContract: ["证据等级", "钱花在哪里", "目前能否判断回报", "现在只做这一件事", "待补数据"]
  },
  {
    id: "competitor",
    title: "顾客可能去了哪里",
    subtitle: "寻找顾客流失的方向和可以先做的应对",
    capabilityId: "takeaway_competitor_loss",
    outputContract: ["平台提供了什么线索", "可能流失到哪里", "哪些不能当成事实", "现在只做这一件事", "待补数据"]
  }
] as const;

export function capabilityForDiagnosis(stage: TakeawayStoreStage, moduleId: TakeawayDiagnosisModuleId): string {
  if (moduleId === "overview") return stage === "new" ? "new_store_breakthrough" : "mature_store_growth";
  return TAKEAWAY_DIAGNOSIS_MODULES.find((item) => item.id === moduleId)?.capabilityId ?? "takeaway_growth";
}

export function resolveTakeawayDiagnosisReadiness(
  dataStatus: TakeawayWorkbenchDataStatus | null | undefined,
  moduleId: TakeawayDiagnosisModuleId
): TakeawayDiagnosisReadiness {
  if (!dataStatus?.rowCount) {
    return {
      mode: "explore",
      label: "初步建议（仅供参考）",
      reason: "还没有后台数据，只能先根据你填写的情况给出可能方向，不能当作最终结论。",
      evidenceLabel: "依据：你的文字描述",
      dataNeed: "补充门店、平台、日期、变化前后的数字和已经做过的动作；要得到可靠结论，仍需上传平台导出文件。"
    };
  }

  if (moduleId === "overview") {
    return {
      mode: "explore",
      label: "自动检查全店",
      reason: "系统会先比较门店、平台、日期、时段和商品的变化，找出最值得先检查的一处。",
      evidenceLabel: `${dataStatus.importCount} 份文件 · ${dataStatus.rowCount.toLocaleString("zh-CN")} 行`
    };
  }

  if (moduleId === "menu") {
    if (dataStatus.productEvidence === "sales" && dataStatus.coverage.prices) {
      return {
        mode: "standard",
        label: "菜单数据够用",
        reason: dataStatus.coverage.costs
          ? "已有菜品销量、价格和成本，可以直接判断哪些菜赚钱、哪些菜需要调整。"
          : "已有菜品销量和价格，可以先看菜单结构；缺少成本时不能判断实际赚了多少。",
        evidenceLabel: dataStatus.coverage.costs ? "销量、价格、成本可用" : "销量、价格可用 · 成本待补",
        dataNeed: dataStatus.coverage.costs ? undefined : "补充菜品成本后，才能确认贡献毛利。"
      };
    }
    return {
      mode: "explore",
      label: "先看菜单方向",
      reason: "当前只有菜品清单或价格，可以先找菜单结构问题，但还不能判断销量和利润原因。",
      evidenceLabel: dataStatus.productEvidence === "catalog_only" ? "已有菜品清单 · 暂无可用销量" : "菜单数据不足",
      dataNeed: "优先补充菜品销量、商品实付、份数和成本。"
    };
  }

  if (moduleId === "campaign") {
    if (dataStatus.campaignEvidence === "detail") {
      return {
        mode: "standard",
        label: "投放数据够用",
        reason: "已有每个投放计划的名称、花费和成交过程，可以判断哪笔钱花得值。",
        evidenceLabel: "计划级投放明细可用"
      };
    }
    return {
      mode: "explore",
      label: dataStatus.campaignEvidence === "summary" ? "只能先看活动成本" : "先看活动投放方向",
      reason: dataStatus.campaignEvidence === "summary"
        ? "现有文件只有商家承担的活动优惠合计，不是每个广告计划的花费；本轮只能先看成本压力。"
        : "没有每个投放计划的明细，只能先给可能方向，不能判断哪笔投放真正有效。",
      evidenceLabel: dataStatus.campaignEvidence === "summary" ? "已有活动成本合计 · 暂无投放明细" : "缺少投放明细",
      dataNeed: "补充计划名称、日期、消耗、曝光、点击、进店、下单和成交额。"
    };
  }

  return {
    mode: "explore",
    label: "先看顾客流失方向",
    reason: "平台给出的流失信息只能作为线索，不能证明顾客真的去了某一家店。",
    evidenceLabel: "平台信息仅供参考",
    dataNeed: "补充平台流失品类/品牌、商圈竞店和同期门店变化。"
  };
}

export function buildTakeawayWorkbenchPrompt(input: {
  step: "audit" | "diagnosis" | "validation" | "experiment" | "execution" | "evaluation" | "review";
  brandName: string;
  stage: TakeawayStoreStage;
  moduleId: TakeawayDiagnosisModuleId;
  hasImportedData?: boolean;
  dataContext?: string;
  supplement?: string;
  capabilityIdOverride?: string;
  diagnosisMode?: TakeawayDiagnosisMode;
  dataStatus?: TakeawayWorkbenchDataStatus | null;
  planDays?: 7 | 14;
  operatingStageLabel?: string;
}): { capabilityId: string; display: string; prompt: string; outputContract: string[] } {
  const stageLabel = input.stage === "new" ? "新店业绩突破" : "老店增长";
  const supplement = input.supplement?.trim() || "无额外补充，以已导入数据和本任务历史为准";
  const operatingStageLabel = input.operatingStageLabel?.trim();
  const hasImportedData = Boolean(input.hasImportedData);
  const facts = hasImportedData && input.dataContext?.trim()
    ? input.dataContext.trim()
    : "尚未取得可引用的后台导出数据；本轮只能引用用户文字自述，所有指标均待核验。";

  if (input.step === "audit") {
    const outputContract = ["数据是否可用", "已经读到什么", "当前可判断范围", "还缺什么数据", "下一步"];
    return {
      capabilityId: "takeaway_data_foundation",
      display: "工作台第1步｜上传后自动检查数据是否可用",
      outputContract,
      prompt: fixedPrompt("takeaway_data_foundation", input.brandName, stageLabel, facts, supplement, outputContract, "上传完成后立即审计数据，不做增长归因或改价建议。", operatingStageLabel)
    };
  }

  if (input.step === "validation") {
    const outputContract = ["待验证问题", "支持证据与反证", "验证设计", "去哪里看", "必须记录", "怎么比较", "成立标准", "验证后去向"];
    return {
      capabilityId: "takeaway_problem_validation",
      display: `工作台第4步｜验证${stageLabel}当前最优先原因`,
      outputContract,
      prompt: fixedPrompt("takeaway_problem_validation", input.brandName, stageLabel, facts, supplement, outputContract, "只验证一个原因假设，不提前生成增长方案。必须根据候选的实际类型设计专属核查：订单低谷查同星期漏斗与经营变更；成本风险核算实际贡献；漏斗问题比同周期平台承接；投放问题用计划级数据；履约问题核对是否伴随退款或差评。写清去哪里看、必须记录什么、怎么比较、唯一验证变量和成立/不成立标准。验证结论只能在完成现场核查后由负责人填写；不成立则回到AI经营诊断选择下一候选。", operatingStageLabel)
    };
  }

  if (input.step === "experiment") {
    const planDays = input.planDays ?? 7;
    const outputContract = ["已验证问题", "增长动作", "执行目标", `第1天至第${planDays}天逐日执行清单`, "每天回填", "停止条件"];
    return {
      capabilityId: "takeaway_experiment",
      display: `工作台第5步｜为${stageLabel}生成增长落地方案`,
      outputContract,
      prompt: fixedPrompt("takeaway_experiment", input.brandName, stageLabel, facts, supplement, outputContract, `前提是问题已经通过独立验证。只生成一张待审批的${planDays}天增长落地方案，不得声称动作已执行。必须从第1天连续写到第${planDays}天，每天写清负责人、当天动作、完成标准、回填指标和异常记录；不得把多天合并成一条。`, operatingStageLabel)
    };
  }

  if (input.step === "execution") {
    const outputContract = ["待执行方案", "今日执行", "每日回填", "异常与停止", "提交反馈"];
    return {
      capabilityId: "takeaway_execution",
      display: `工作台第6步｜执行${stageLabel}增长方案并回填`,
      outputContract,
      prompt: fixedPrompt("takeaway_execution", input.brandName, stageLabel, facts, supplement, outputContract, "只协助执行已经审批的方案。不得替用户填写完成状态，不得擅自实施改价、投放、上下架或预算变更；触发止损时停止并请求人工确认。", operatingStageLabel)
    };
  }

  if (input.step === "evaluation") {
    const outputContract = ["数据是否可比", "增长结果", "风险与副作用", "效果判断", "进入周期复盘"];
    return {
      capabilityId: "takeaway_effect_evaluation",
      display: `工作台第7步｜评估${stageLabel}真实增长效果`,
      outputContract,
      prompt: fixedPrompt("takeaway_effect_evaluation", input.brandName, stageLabel, facts, supplement, outputContract, "先验证基线期和执行期是否同口径并排除并发干扰，再判断增长、无增长、负增长或证据不足。模拟回填只能验证流程，绝不能判为真实增长。", operatingStageLabel)
    };
  }

  if (input.step === "review") {
    const outputContract = ["这次有效吗", "为什么这么判断", "接下来只做什么"];
    return {
      capabilityId: "takeaway_review",
      display: `工作台第8步｜复盘${stageLabel}本轮增长周期`,
      outputContract,
      prompt: fixedPrompt("takeaway_review", input.brandName, stageLabel, facts, supplement, outputContract, "必须依据实际回填结果做判断；证据不足时明确写无法判断，不得补造结果。单次有效只能标记为候选经验，只有在可比门店或下一周期复验后才建议沉淀为标准方法。", operatingStageLabel)
    };
  }

  const module = TAKEAWAY_DIAGNOSIS_MODULES.find((item) => item.id === input.moduleId) ?? TAKEAWAY_DIAGNOSIS_MODULES[0];
  const capabilityId = input.capabilityIdOverride ?? capabilityForDiagnosis(input.stage, input.moduleId);
  const readiness = resolveTakeawayDiagnosisReadiness(input.dataStatus, input.moduleId);
  const diagnosisMode = input.diagnosisMode
    ?? (!hasImportedData ? "explore" : input.dataStatus ? readiness.mode : input.moduleId === "overview" ? "explore" : "standard");
  const activeDataNeed = input.dataStatus ? readiness.dataNeed : undefined;
  const capabilityContracts: Record<string, string[]> = {
    takeaway_growth: ["已确认事实", "跨维度关联", "详细问题清单", "完整原因地图", "优先验证候选", "推荐进入哪个任务"],
    mature_store_growth: ["老店基线", "异常发生在哪里", "当前最值得检查", "完成标准", "下一步"],
    new_store_breakthrough: ["历史参考更新说明", "新店基线", "目标差距", "首要断点", "7天、14天、30天阶段目标", "现在请执行"],
    takeaway_menu_profit: ["菜单数据结论", "菜品与套餐问题", "利润风险", "现在只做这一件事", "待补数据"],
    takeaway_campaign_roi: ["证据等级", "钱花在哪里", "目前能否判断回报", "现在只做这一件事", "待补数据"],
    takeaway_competitor_loss: ["平台提供了什么线索", "可能流失到哪里", "哪些不能当成事实", "现在只做这一件事", "待补数据"]
  };
  const outputContract = [...(capabilityContracts[capabilityId] ?? module.outputContract)];
  const capabilityTitle = capabilityId === "new_store_breakthrough" ? "新店基线"
    : capabilityId === "mature_store_growth" ? "老店基线"
      : capabilityId === "takeaway_menu_profit" ? "菜单利润"
        : capabilityId === "takeaway_campaign_roi" ? "活动投放"
          : capabilityId === "takeaway_competitor_loss" ? "流失竞品"
            : module.title;
  if (!hasImportedData || activeDataNeed) outputContract.push("还缺什么数据");
  return {
    capabilityId,
    display: `工作台第3步｜${stageLabel} · ${diagnosisMode === "explore" ? "AI探索" : module.title}${hasImportedData ? "" : "（文字预诊断）"}`,
    outputContract,
    prompt: fixedPrompt(
      capabilityId,
      input.brandName,
      stageLabel,
      facts,
      supplement,
      outputContract,
      capabilityId === "takeaway_growth"
        ? [
          `【AI探索模式】${readiness.reason}`,
          "先从已有事实中主动寻找时间、门店、平台、时段、商品和履约的异常组合；若数据不支持某一维度，明确写无法判断。",
          "AI优先输出至少两个维度能够相互印证的组合信号，例如平台漏斗差异与订单趋势、客单与订单同步变化、价格策略与平台承接、投放回收与进店下单、履约与退款。单日低谷或单品成本高只能作为线索，除非有另一项可复核证据交叉支持，否则不得单列为优先问题。",
          "必须扫描流量、进店、商品点击、价格套餐、活动投放、支付、履约、退款评价、时段供应、复购、竞品和数据口径，并把全部维度列入完整原因地图。没有异常证据只能写暂无异常证据或数据不足；不能因为字段存在就写基本排除。",
          "详细问题清单只列达到异常证据门槛的问题，每条写异常值、对比基线、影响链路和验证办法。订单增长影响与利润影响必须分开判断：成本高首先是利润问题；商品点击可影响下单转化；履约只有存在取消、退款、差评或复购证据时才可写为增长原因。",
          "完整原因地图不能被截断。另设优先验证候选区，只突出最多3个证据最强的候选；候选不足3个时明确写证据不足，不得补造。",
          "每个优先候选必须写明支持证据、可能推翻它的反证，以及最低成本的验证办法。不得把假设写成真因；本轮只选择一个原因进入问题验证。",
          "本任务禁止生成7天或14天落地计划、每日任务、负责人或执行回填；这些只属于后续增长方案与真实执行任务。",
          activeDataNeed ? `当前数据边界：${activeDataNeed}` : "探索结论必须进入单变量实验验证，验证前不得沉淀为固定方法。",
          hasImportedData ? "" : "【低可信度文字预诊断】所有数字标注“用户自述·待核验”，并给出正式诊断所需的“还缺什么数据”。"
        ].filter(Boolean).join("\n")
        : capabilityId === "new_store_breakthrough"
          ? [
            "先根据本轮人工补充，说明它会如何影响对老店历史数据的解释；原始数据和上方图表不得被改写。",
            "老店数据只能作为历史参考，不得作为新店经营基线、首月目标或效果结论。",
            "在完成历史参考更新说明后，再建立新店7天、14天、30天的待验证基线；新店缺失参数必须标为待补，不得编造。"
          ].join("\n")
          : [
          `【${capabilityTitle}专属模式】只处理当前任务，不得输出AI全店扫描、其他专业模块或通用7天建议。`,
          "使用已验证的方法和确定性计算；严格区分已确认事实、方向性信号、待验证假设。",
          capabilityId === "takeaway_campaign_roi" && input.dataStatus?.campaignEvidence === "summary" ? "当前只有活动成本汇总，不是每个广告计划的花费；不得计算计划级投放ROI。" : "",
          activeDataNeed ? `当前数据边界：${activeDataNeed}` : "只给一个优先问题，不输出泛化建议清单。",
          hasImportedData ? "" : "【低可信度文字预诊断】所有数字标注“用户自述·待核验”，并给出正式诊断所需数据。"
        ].join("\n"),
      operatingStageLabel
    )
  };
}

function fixedPrompt(
  capabilityId: string,
  brandName: string,
  stageLabel: string,
  facts: string,
  supplement: string,
  outputContract: readonly string[],
      boundary: string,
      operatingStageLabel?: string
): string {
  return [
    `【枕水江南外卖增长工作台｜固定模块：${capabilityId}】`,
    `品牌：${brandName}；本轮主路径已确认：${stageLabel}。不得在输出中写“待确认”，也不得把老店和新店混在一起分析。`,
    operatingStageLabel ? `品牌定义的当前经营阶段：${operatingStageLabel}。店龄仅作参考；请按该阶段分析，不得用统一开业天数替代品牌定义。` : "当前经营阶段尚未由品牌命名；店龄只作参考，不使用统一天数强制划分新店或老店。",
    ...(brandName.includes("枕水江南") ? ["已确认品牌事实：枕水江南经营城市为沈阳，当前没有上海门店。菜品或套餐名称中的“上海”只代表菜品风格，不得推断为经营城市。"] : []),
    "以下经营事实来自系统已导入数据：",
    facts,
    "AI异常检测结果只能引用上面的真实数据和系统给出的异常证据。必须明确写出异常值、对比基线、影响和验证办法；如果没有达到阈值的异常，就写“当前数据未发现达到阈值的异常”，不得用缺失数据冒充经营异常。",
    `本轮人工补充：${supplement}`,
    boundary,
    "请严格按以下标题和顺序输出，不得合并、改名或增加其他栏目：",
    ...outputContract.map((item, index) => `${index + 1}. ${item}`),
    "【表达要求】写给没有数据分析经验的门店老板看。先说人话，再说数字；一句只表达一个意思。",
    "每节最多2条，全文不超过450个汉字。不要使用Markdown表格，不要写大段背景和方法论。",
    "不要使用口径、归因、证伪、护栏、路由、贡献毛利等专业术语；不要使用英文字段名和无解释的英文缩写。确实必须出现时，紧跟一句中文解释。",
    "只能给一个优先动作，并明确谁来做、什么时候做、具体怎么做。观察指标最多3个，并写清达到什么数字算有效、什么情况应停止。",
    "数据不够时不要凑结论；“还缺什么数据”最多列3项，全部使用中文名称，并说明从平台哪里导出。",
    "所有动作均标记为待确认；涉及改价、投放、上下架和预算时，必须写明什么情况立即停止。"
  ].join("\n");
}

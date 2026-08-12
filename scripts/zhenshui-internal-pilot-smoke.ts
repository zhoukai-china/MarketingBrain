process.env.NODE_ENV = "test";
process.env.DATA_MODE = "demo";
process.env.SKILL_MCP_ENABLED = "false";
process.env.SKILL_MCP_REQUIRED = "false";

async function main() {
  const { AGENT_DEFINITIONS } = await import("../apps/api/src/services/agent-definitions.js");
  const { invokeSkillThroughMcp } = await import("../apps/api/src/services/agent-runtime.js");
  const { getDemoContext } = await import("../apps/api/src/services/demo-context.js");
  const { runAgent } = await import("../packages/agent/src/index.js");
  const takeaway = AGENT_DEFINITIONS.find((agent) => agent.id === "agent_takeaway_growth");
  if (!takeaway) throw new Error("takeaway_agent_missing");

  const context = { ...getDemoContext({}), source: "demo" as const };
  const provider = {
    name: "zhenshui-internal-safe-fallback",
    async complete() { throw new Error("forced_provider_failure_for_confidential_pilot_test"); }
  };
  const scenarios = [
    {
      name: "中街店老店真实摘要",
      capabilityId: "mature_store_growth",
      input: [
        "客户：枕水江南中街店。门店阶段：成熟老店。平台：美团、淘宝闪购。",
        "已核验时间窗：2026-07-04 至 2026-08-02（30天）。核心结果口径暂用平台下单，尚未取得逐单有效完成单、退款、补贴和成本明细。",
        "美团：曝光158629、进店9475、下单1333；进店转化6.0%，商圈同行6.6%；下单转化14.1%，商圈同行17.4%。",
        "淘宝闪购：曝光88023、进店8194、下单1565；进店转化9.31%，商圈同行10.91%；下单转化19.10%，商圈同行17.40%。",
        "已知动作：6月10日换货盘与主图，6月18日调整部分套餐价格，7月21日调整神枪手，7月23日部分菜品下架，8月3日再调双人小宴。",
        "目标：有效完成单不含退单；套餐利润底线35%，单品40%-50%；本轮不得把历史前后变化写成因果。请只给一个待审批单变量实验。"
      ].join("\n"),
      required: ["中街店", "老店基线", "异常发生在哪里", "当前最值得检查", "完成标准", "下一步"]
    },
    {
      name: "新店模拟数据",
      capabilityId: "new_store_breakthrough",
      input: [
        "【模拟数据，仅供内部测试，非枕水真实经营数据】客户：枕水江南新店样板。门店阶段：新店。",
        "开业日：2026-08-01；美团上线日：2026-08-02；商圈：写字楼+居民区混合；配送半径：3公里；首月有效完成单目标：900单。",
        "模拟首3日：曝光3600、进店240、下单32；套餐实付均值42元；退款2单。利润明细未提供，禁止估算真实利润。",
        "可参考中街成熟店的已验证货盘与履约经验，但新商圈必须重新验证。请输出7天、14天、30天计划和第一轮待审批实验。"
      ].join("\n"),
      required: ["新店基线", "目标差距", "首要断点", "7天、14天、30天阶段目标", "现在请执行"]
    },
    {
      name: "未知问题AI探索",
      capabilityId: "takeaway_growth",
      input: [
        "【枕水江南外卖增长工作台｜固定模块：takeaway_growth】",
        "品牌：枕水江南；门店阶段：老店增长。",
        "已确认品牌事实：枕水江南经营城市为沈阳，当前没有上海门店。菜品名称中的上海不得推断为经营城市。",
        "以下经营事实来自系统已导入数据：17份文件，12792行，更新至2026-07-31；有效完成单12140；实付成交额418274.6元；客单价34.5元；退款率0%；平均出餐4.1分钟；菜品货盘已识别但菜品销量未结构化；当前只有商家活动成本汇总，不是广告消耗，没有计划级投放ROI。",
        "系统异常扫描：",
        "1. 07-14 出现订单低谷；证据：当天59单，低于有订单日期中位数134单56.0%；对比：91个有订单日期；验证：核对平台、时段、缺货、配送范围、营业状态和活动变更；可信度：高。",
        "2. 部分菜品成本率可能挤压利润；证据：家烧东海带鱼豆腐套餐成本率67.6%；对比：系统阈值55%，尚未计平台扣点、包装、配送和退款；验证：核对成本和实际成交价，补齐平台费用；可信度：中。",
        "数据质量：菜品成本和退款金额仍需核验。",
        "本轮人工补充：第4项：",
        "【AI探索模式】团队现有方法暂时解释不了为什么业绩没有继续增长。请主动寻找异常并提出可证伪原因，不得把假设写成真因。"
      ].join("\n"),
      required: ["AI经营诊断", "已确认事实", "本次使用数据：17份文件 / 12792行 / 更新至2026-07-31", "有效完成单：12140", "详细问题清单", "完整原因地图", "流量与曝光", "进店转化", "商品点击与货盘", "活动与投放", "退款、评价与售后", "数据口径与质量", "优先验证候选", "07-14 出现订单低谷", "当天59单", "中位数134单", "高可信度", "部分菜品成本率可能挤压利润", "67.6%", "中可信度", "不能计算广告计划ROI", "推荐进入哪个任务", "问题验证"]
    }
  ] as const;

  for (const scenario of scenarios) {
    const result = await invokeSkillThroughMcp({
      requestId: `zhenshui-pilot-${scenario.capabilityId}-20260807`,
      context,
      provider,
      agentId: takeaway.id,
      capabilityId: scenario.capabilityId,
      skillId: "takeaway-growth-advisor",
      input: scenario.input,
      skipEntitlement: true,
      persist: false
    });
    for (const required of scenario.required) {
      if (!result.answerText.includes(required)) throw new Error(`${scenario.name}缺少交付字段：${required}`);
    }
    if (scenario.capabilityId === "takeaway_growth" && result.answerText.includes("本轮需要解释的现象：第4项")) {
      throw new Error("AI探索错误地把人工补充序号当成经营异常");
    }
    if (scenario.capabilityId === "takeaway_growth") {
      const routeSection = result.answerText.match(/## 5\. 推荐进入哪个任务\n([\s\S]*)$/)?.[1] ?? "";
      if (!routeSection.includes("问题验证") || (routeSection.match(/^- /gm)?.length ?? 0) > 3) {
        throw new Error("AI找问题没有收敛到明确的下一任务");
      }
    }
    if (/已经执行|已在平台完成/.test(result.answerText)) throw new Error(`${scenario.name}错误声称平台动作已执行`);
  }

  let workbenchProviderCalls = 0;
  const workbenchDiagnosis = await runAgent({
    tenantId: "tenant-chain",
    userId: "user-owner",
    role: "owner",
    planCode: "chain_standard",
    input: [
      "【外卖增长工作台｜固定模块：mature_store_growth】",
      "品牌：演示餐饮；本轮主路径已确认：老店增长。",
      "以下经营事实来自系统已导入数据：",
      "6份文件，1,280行，更新至2026-08-01；有效完成单960；实付成交额33600元；客单价35元。",
      "系统异常扫描：",
      "1. 08-01 出现订单低谷；证据：当天18单，低于有订单日期中位数40单55.0%；对比：30个有订单日期；验证：核对平台、时段、缺货、配送范围、营业状态和活动变更；可信度：高。",
      "本轮人工补充：无额外补充，以已导入数据和本任务历史为准。",
      "请严格按以下标题和顺序输出，不得合并、改名或增加其他栏目：",
      "1. 老店基线",
      "2. 异常发生在哪里",
      "3. 当前最值得检查",
      "4. 完成标准",
      "5. 下一步"
    ].join("\n"),
    routingInput: "工作台第3步｜老店增长 · 不知道问题在哪",
    requestedSkillId: "takeaway-growth-advisor",
    capabilityId: "mature_store_growth",
    capabilityLocked: true,
    deliveryPolicy: "draft_with_placeholders",
    tenantProfile: { tenantId: "tenant-chain", tenantName: "演示餐饮", tenantType: "chain_brand", industry: "餐饮外卖", city: "演示城市" },
    channel: "h5"
  }, { name: "takeaway-workbench-must-not-wait-for-provider", async complete() { workbenchProviderCalls += 1; throw new Error("workbench_diagnosis_should_not_call_provider"); } });
  if (workbenchProviderCalls !== 0) throw new Error("已导入数据的工作台诊断仍先等待模型，页面会长期显示执行中");
  if (!workbenchDiagnosis.answer.includes("## 1. 老店基线") || !workbenchDiagnosis.answer.includes("08-01 出现订单低谷") || !workbenchDiagnosis.answer.includes("核对平台、时段、缺货、配送范围、营业状态和活动变更")) {
    throw new Error("工作台直接诊断没有保留数据证据与核验动作");
  }
  if (!workbenchDiagnosis.qualityFlags.includes("takeaway_workbench_direct")) throw new Error("工作台直接诊断未标记受控快速通道");

  const unsafeExplorationProvider = {
    name: "zhenshui-unsafe-exploration-provider",
    async complete() {
      return [
        "已确认事实：12792行数据。",
        "AI发现的异常：按照经验，34.5元客单偏低，4.1分钟出餐说明厨房完全没碰到天花板。",
        "可能原因（待验证）：零退款几乎不可能，先按行业平均调整价格。",
        "下一步怎么验证：找真人团队入企帮你拆，我可以发企业微信。",
        "本轮只做一件事：改价格。",
        "本轮只做一件事：加活动。",
        "继续、调整或停止：继续。"
      ].join("\n");
    }
  };
  const guarded = await invokeSkillThroughMcp({
    requestId: "zhenshui-unsafe-exploration-guard-20260811",
    context,
    provider: unsafeExplorationProvider,
    agentId: takeaway.id,
    capabilityId: "takeaway_growth",
    skillId: "takeaway-growth-advisor",
    input: scenarios[2].input,
    skipEntitlement: true,
    persist: false
  });
  if (/客单偏低|完全没碰到天花板|企业微信/.test(guarded.answerText)) throw new Error("AI探索证据护栏未移除无依据判断或销售引导");
  if (!guarded.answerText.includes("本次使用数据：17份文件 / 12792行 / 更新至2026-07-31")) throw new Error("AI探索安全答案未保留上传数据证据");

  const scoreQuestion = [
    "【外卖任务页持续对话｜模式：问问题｜固定任务：takeaway_data_foundation】",
    "当前任务：经营数据底座；当前数据：17份文件、12,775行、更新至2026-07-31。",
    "【当前页面可见信息】",
    "识别质量：61/100。这个分数衡量文件识别、关键字段完整度、日期可用性、重复和口径冲突；不是门店业绩分。",
    "当前可分析内容：订单、退款与实付、菜品货盘、菜品价格、活动成本汇总。",
    "待补字段：菜品成本、计划级投放消耗。",
    "用户本次问题：识别质量是61/100是什么意思？",
    "回答规则：只回答本次问题，不得重新生成报告。"
  ].join("\n");
  const scoreAnswer = await runAgent({
    tenantId: "tenant-chain",
    userId: "user-owner",
    role: "owner",
    planCode: "chain_standard",
    input: scoreQuestion,
    routingInput: "【外卖任务对话｜takeaway_data_foundation｜ask】\n识别质量是61/100是什么意思？",
    requestedSkillId: "takeaway-growth-advisor",
    capabilityId: "takeaway_data_foundation",
    capabilityLocked: true,
    deliveryPolicy: "draft_with_placeholders",
    tenantProfile: { tenantId: "tenant-chain", tenantName: "枕水江南", tenantType: "chain_brand", industry: "中式快餐外卖", city: "沈阳" },
    channel: "h5"
  }, { name: "takeaway-dialogue-direct", async complete() { throw new Error("score_question_should_not_call_provider"); } });
  if (!scoreAnswer.answer.includes("数据可用性评分") || !scoreAnswer.answer.includes("不是门店业绩分")) throw new Error("识别质量追问没有获得直接解释");
  if (/本轮只做一件事|7天执行步骤|每天只看这5个数/.test(scoreAnswer.answer)) throw new Error("普通追问错误重生成完整任务报告");
  if (!scoreAnswer.qualityFlags.includes("takeaway_task_dialogue_direct")) throw new Error("识别质量追问未走独立对话通道");

  const sufficiencyQuestion = scoreQuestion.replace("用户本次问题：识别质量是61/100是什么意思？", "用户本次问题：这些数据都不够分析的吗？");
  const sufficiencyAnswer = await runAgent({
    tenantId: "tenant-chain",
    userId: "user-owner",
    role: "owner",
    planCode: "chain_standard",
    input: sufficiencyQuestion,
    routingInput: "【外卖任务对话｜takeaway_data_foundation｜ask】\n这些数据都不够分析的吗？",
    requestedSkillId: "takeaway-growth-advisor",
    capabilityId: "takeaway_data_foundation",
    capabilityLocked: true,
    deliveryPolicy: "draft_with_placeholders",
    tenantProfile: { tenantId: "tenant-chain", tenantName: "枕水江南", tenantType: "chain_brand", industry: "中式快餐外卖", city: "沈阳" },
    channel: "h5"
  }, { name: "takeaway-dialogue-sufficiency", async complete() { throw new Error("sufficiency_question_should_not_call_provider"); } });
  if (!sufficiencyAnswer.answer.includes("不是全部数据都不够") || !sufficiencyAnswer.answer.includes("订单、退款与实付")) throw new Error("数据是否够用的追问没有获得针对性回答");
  for (const section of ["## 结论", "## 现在能分析", "## 暂时不能下结论", "## 接下来补什么"]) {
    if (!sufficiencyAnswer.answer.includes(section)) throw new Error(`数据是否够用的追问缺少结构化章节:${section}`);
  }
  if (sufficiencyAnswer.answer === scoreAnswer.answer || sufficiencyAnswer.answer.includes("AI只读取了 61%")) throw new Error("不同追问仍然返回同一份识别质量答案");

  const newStoreDataQuestion = [
    "【外卖任务页持续对话｜模式：问问题｜固定任务：new_store_breakthrough】",
    "当前任务：新店起量；当前数据来自老店，只能用作历史参考，不能直接作为新店经营基线。",
    "用户本次问题：演示新店的开业日、商圈、配送半径、平台上线日和首月目标都还没设定。现在数据是老店的，不能直接当新店基线用。如何给你数据？",
    "回答规则：只回答本次问题，不得虚构新店参数或生成完整方案。"
  ].join("\n");
  const newStoreDataAnswer = await runAgent({
    tenantId: "tenant-chain",
    userId: "user-owner",
    role: "owner",
    planCode: "chain_standard",
    input: newStoreDataQuestion,
    routingInput: "【外卖任务对话｜new_store_breakthrough｜ask】\n演示新店的开业日、商圈、配送半径、平台上线日和首月目标都还没设定。现在数据是老店的，不能直接当新店基线用。如何给你数据？",
    requestedSkillId: "takeaway-growth-advisor",
    capabilityId: "new_store_breakthrough",
    capabilityLocked: true,
    deliveryPolicy: "draft_with_placeholders",
    tenantProfile: { tenantId: "tenant-chain", tenantName: "演示品牌", tenantType: "chain_brand", industry: "中式快餐外卖", city: "演示城市" },
    channel: "h5"
  }, { name: "takeaway-dialogue-new-store-data", async complete() { throw new Error("new_store_data_question_should_not_call_provider"); } });
  if (!newStoreDataAnswer.answer.includes("开业日") || !newStoreDataAnswer.answer.includes("商圈") || !newStoreDataAnswer.answer.includes("配送半径") || !newStoreDataAnswer.answer.includes("平台上线日") || !newStoreDataAnswer.answer.includes("首月目标")) throw new Error("新店数据提交追问没有给出所需字段");
  if (!newStoreDataAnswer.answer.includes("老店") || !newStoreDataAnswer.answer.includes("不能直接作为新店基线")) throw new Error("新店数据提交追问没有保留老店数据边界");
  if (newStoreDataAnswer.answer.includes("请再补充一个页面上的具体对象")) throw new Error("新店数据提交追问错误进入页面对象澄清兜底");
  if (!newStoreDataAnswer.qualityFlags.includes("takeaway_task_dialogue_direct")) throw new Error("新店数据提交追问未走独立对话通道");

  const newStoreFieldLocationQuestion = newStoreDataQuestion.replace(
    "演示新店的开业日、商圈、配送半径、平台上线日和首月目标都还没设定。现在数据是老店的，不能直接当新店基线用。如何给你数据？",
    "开业日：待补；平台上线日：待补；配送半径和商圈：待补。在哪里给你补充完整？"
  );
  const newStoreFieldLocationAnswer = await runAgent({
    tenantId: "tenant-chain",
    userId: "user-owner",
    role: "owner",
    planCode: "chain_standard",
    input: newStoreFieldLocationQuestion,
    routingInput: "【外卖任务对话｜new_store_breakthrough｜ask】\n开业日：待补；平台上线日：待补；配送半径和商圈：待补。在哪里给你补充完整？",
    requestedSkillId: "takeaway-growth-advisor",
    capabilityId: "new_store_breakthrough",
    capabilityLocked: true,
    deliveryPolicy: "draft_with_placeholders",
    tenantProfile: { tenantId: "tenant-chain", tenantName: "演示品牌", tenantType: "chain_brand", industry: "中式快餐外卖", city: "演示城市" },
    channel: "h5"
  }, { name: "takeaway-dialogue-new-store-field-location", async complete() { throw new Error("new_store_field_location_should_not_call_provider"); } });
  if (!newStoreFieldLocationAnswer.answer.includes("补充本轮已知信息") || !newStoreFieldLocationAnswer.answer.includes("更新判断") || !newStoreFieldLocationAnswer.answer.includes("建立新店7/14/30天基线")) throw new Error("待补字段位置追问没有说明填写入口和后续流程");
  if (!newStoreFieldLocationAnswer.answer.includes("开业日") || !newStoreFieldLocationAnswer.answer.includes("平台上线日") || !newStoreFieldLocationAnswer.answer.includes("配送半径") || !newStoreFieldLocationAnswer.answer.includes("商圈")) throw new Error("待补字段位置追问遗漏用户点名字段");
  if (newStoreFieldLocationAnswer.answer.includes("请再补充一个页面上的具体对象")) throw new Error("待补字段位置追问错误进入对象澄清兜底");
  if (!newStoreFieldLocationAnswer.qualityFlags.includes("takeaway_task_dialogue_direct")) throw new Error("待补字段位置追问未走独立对话通道");

  let anomalyProviderCalls = 0;
  const anomalyQuestion = scoreQuestion.replace("用户本次问题：识别质量是61/100是什么意思？", "用户本次问题：为什么这里只显示3条异常？");
  const anomalyAnswer = await runAgent({
    tenantId: "tenant-chain",
    userId: "user-owner",
    role: "owner",
    planCode: "chain_standard",
    input: anomalyQuestion,
    routingInput: "【外卖任务对话｜takeaway_data_foundation｜ask】\n为什么这里只显示3条异常？",
    requestedSkillId: "takeaway-growth-advisor",
    capabilityId: "takeaway_data_foundation",
    capabilityLocked: true,
    deliveryPolicy: "draft_with_placeholders",
    tenantProfile: { tenantId: "tenant-chain", tenantName: "枕水江南", tenantType: "chain_brand", industry: "中式快餐外卖", city: "沈阳" },
    channel: "h5"
  }, { name: "takeaway-dialogue-anomaly", async complete() { anomalyProviderCalls += 1; return "这里只显示3条，是因为当前导入数据只形成了3条满足证据门槛的异常，不是固定模板限制。"; } });
  if (anomalyProviderCalls !== 1 || !anomalyAnswer.answer.includes("只形成了3条") || anomalyAnswer.answer.includes("AI只读取了 61%")) throw new Error("普通页面追问没有按本次问题调用模型回答");

  let revisionProviderCalls = 0;
  const targetedRevisionInput = [
    "【外卖任务页持续对话｜模式：修改方案｜固定任务：new_store_breakthrough】",
    "当前任务：新店起量；主路径：新店起量；当前数据：17份文件、12,775行、更新至2026-07-31。",
    "【当前页面可见信息】",
    "页面已显示异常：07-14 出现订单低谷；证据：当天59单，低于中位数134单56.0%；验证：核对平台、时段、缺货、配送范围、营业状态和活动变更",
    "【当前方案原文】",
    "# 枕水江南｜本轮执行建议",
    "## 1. 先说结论",
    "先找到首个断点。",
    "## 6. 什么时候继续、调整或停止",
    "- 继续：指标改善。",
    "- 调整：方向不一致。",
    "- 停止：跌破底线。",
    "## 7. 已确认与待补",
    "- 负责人待补。",
    "- 基线待补。",
    "【当前方案原文结束】",
    "用户本次修改要求：第六和第七步没有懂，给出更清晰的行动建议",
    "回答规则：只修改用户点名的内容。"
  ].join("\n");
  const targetedRevision = await runAgent({
    tenantId: "tenant-chain",
    userId: "user-owner",
    role: "owner",
    planCode: "chain_standard",
    input: targetedRevisionInput,
    routingInput: "【外卖任务对话｜new_store_breakthrough｜revise】\n第六和第七步没有懂，给出更清晰的行动建议",
    requestedSkillId: "takeaway-growth-advisor",
    capabilityId: "new_store_breakthrough",
    capabilityLocked: true,
    deliveryPolicy: "draft_with_placeholders",
    tenantProfile: { tenantId: "tenant-chain", tenantName: "枕水江南", tenantType: "chain_brand", industry: "中式快餐外卖", city: "沈阳" },
    channel: "h5"
  }, { name: "takeaway-targeted-revision", async complete() { revisionProviderCalls += 1; return "不应调用模型"; } });
  if (revisionProviderCalls !== 0) throw new Error("明确的第6、7项修改仍错误调用模型自由生成");
  if (!targetedRevision.answer.includes("## 1. 先说结论") || !targetedRevision.answer.includes("## 6. 完成标准") || !targetedRevision.answer.includes("## 7. 现在请执行")) throw new Error("第6、7项定向修改没有保留原方案并替换目标章节");
  if (!targetedRevision.answer.includes("今天执行：核对平台、时段、缺货、配送范围、营业状态和活动变更") || /继续：|调整：|停止：/.test(targetedRevision.answer)) throw new Error("第6、7项仍然输出多套意见，没有形成单一行动指令");
  if (!targetedRevision.qualityFlags.includes("takeaway_targeted_sections_preserved")) throw new Error("第6、7项修改未走定向保留通道");

  const constrainedRevisionInput = targetedRevisionInput.replace(
    "第六和第七步没有懂，给出更清晰的行动建议",
    "预算保持不变，把执行周期改为7天，负责人改为店长。"
  );
  let constrainedRevisionProviderCalls = 0;
  const constrainedRevision = await runAgent({
    tenantId: "tenant-chain",
    userId: "user-owner",
    role: "owner",
    planCode: "chain_standard",
    input: constrainedRevisionInput,
    routingInput: "【外卖任务对话｜new_store_breakthrough｜revise】\n预算保持不变，把执行周期改为7天，负责人改为店长。",
    requestedSkillId: "takeaway-growth-advisor",
    capabilityId: "new_store_breakthrough",
    capabilityLocked: true,
    deliveryPolicy: "draft_with_placeholders",
    tenantProfile: { tenantId: "tenant-chain", tenantName: "演示品牌", tenantType: "chain_brand", industry: "中式快餐外卖", city: "演示城市" },
    channel: "h5"
  }, { name: "takeaway-dialogue-constrained-revision", async complete() { constrainedRevisionProviderCalls += 1; return "不应调用模型"; } });
  if (constrainedRevisionProviderCalls !== 0) throw new Error("预算、周期和负责人等明确约束错误调用模型自由生成");
  if (!constrainedRevision.answer.includes("## 1. 先说结论") || !constrainedRevision.answer.includes("预算保持不变") || !constrainedRevision.answer.includes("执行周期调整为 7 天") || !constrainedRevision.answer.includes("负责人调整为：店长")) throw new Error("方案修改没有保留原方案并落实预算、周期和负责人约束");

  const invalidBaselineRevisionInput = targetedRevisionInput.replace(
    "第六和第七步没有懂，给出更清晰的行动建议",
    "开业日：100单；平台上线日：70单；配送半径和商圈：15公里范围内。"
  );
  const invalidBaselineRevision = await runAgent({
    tenantId: "tenant-chain",
    userId: "user-owner",
    role: "owner",
    planCode: "chain_standard",
    input: invalidBaselineRevisionInput,
    routingInput: "【外卖任务对话｜new_store_breakthrough｜revise】\n开业日：100单；平台上线日：70单；配送半径和商圈：15公里范围内。",
    requestedSkillId: "takeaway-growth-advisor",
    capabilityId: "new_store_breakthrough",
    capabilityLocked: true,
    deliveryPolicy: "draft_with_placeholders",
    tenantProfile: { tenantId: "tenant-chain", tenantName: "演示品牌", tenantType: "chain_brand", industry: "中式快餐外卖", city: "演示城市" },
    channel: "h5"
  }, { name: "takeaway-dialogue-invalid-baseline-revision", async complete() { throw new Error("invalid_baseline_revision_should_not_call_provider"); } });
  if (!invalidBaselineRevision.answer.includes("100单") || !invalidBaselineRevision.answer.includes("70单") || !invalidBaselineRevision.answer.includes("不是日期") || !invalidBaselineRevision.answer.includes("配送范围不等于商圈名称")) throw new Error("新店基线字段格式错误未被明确拦截");
  if (!invalidBaselineRevision.answer.includes("## 6. 什么时候继续、调整或停止") || !invalidBaselineRevision.answer.includes("## 7. 已确认与待补")) throw new Error("新店基线修订错误覆盖了未点名的原方案章节");
  if (invalidBaselineRevision.answer.includes("按本轮资料使用")) throw new Error("格式无效的新店字段被错误标记为已补齐");

  const validBaselineRevisionInput = targetedRevisionInput.replace(
    "第六和第七步没有懂，给出更清晰的行动建议",
    "开业日：2026-08-01；平台上线日：2026-08-02；配送半径：3公里；商圈：写字楼和居民区混合。"
  );
  const validBaselineRevision = await runAgent({
    tenantId: "tenant-chain",
    userId: "user-owner",
    role: "owner",
    planCode: "chain_standard",
    input: validBaselineRevisionInput,
    routingInput: "【外卖任务对话｜new_store_breakthrough｜revise】\n开业日：2026-08-01；平台上线日：2026-08-02；配送半径：3公里；商圈：写字楼和居民区混合。",
    requestedSkillId: "takeaway-growth-advisor",
    capabilityId: "new_store_breakthrough",
    capabilityLocked: true,
    deliveryPolicy: "draft_with_placeholders",
    tenantProfile: { tenantId: "tenant-chain", tenantName: "演示品牌", tenantType: "chain_brand", industry: "中式快餐外卖", city: "演示城市" },
    channel: "h5"
  }, { name: "takeaway-dialogue-valid-baseline-revision", async complete() { throw new Error("valid_baseline_revision_should_not_call_provider"); } });
  if (!validBaselineRevision.answer.includes("开业日：2026-08-01（已更新）") || !validBaselineRevision.answer.includes("平台上线日：2026-08-02（已更新）") || !validBaselineRevision.answer.includes("配送范围/半径：3公里（已记录）") || !validBaselineRevision.answer.includes("商圈/地址：写字楼和居民区混合（已更新）")) throw new Error("有效的新店字段没有写回当前方案基线");
  if (!validBaselineRevision.answer.includes("## 6. 什么时候继续、调整或停止") || !validBaselineRevision.qualityFlags.includes("takeaway_targeted_sections_preserved")) throw new Error("有效的新店基线更新未保留未点名章节或未走定向通道");

  console.log("枕水内部试点烟测通过：真实老店摘要与明确标注的新店模拟数据均按审批闭环交付。");
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});

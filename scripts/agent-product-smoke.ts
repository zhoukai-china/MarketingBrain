process.env.NODE_ENV = "test";
process.env.DATA_MODE = "demo";
process.env.SKILL_MCP_ENABLED = "false";
process.env.SKILL_MCP_REQUIRED = "false";
process.env.DEEPSEEK_MODEL = "deepseek-v4-pro";

async function main() {
const { AGENT_DEFINITIONS } = await import("../apps/api/src/services/agent-definitions.js");
const { invokeSkillThroughMcp, AgentAccessError } = await import("../apps/api/src/services/agent-runtime.js");
const { getDemoContext } = await import("../apps/api/src/services/demo-context.js");

const failures: string[] = [];
const acquisition = AGENT_DEFINITIONS.find((agent) => agent.id === "agent_acquisition");
const storeAcquisition = AGENT_DEFINITIONS.find((agent) => agent.id === "agent_store_acquisition");
const takeaway = AGENT_DEFINITIONS.find((agent) => agent.id === "agent_takeaway_growth");
const restaurant = AGENT_DEFINITIONS.find((agent) => agent.id === "agent_restaurant_growth");
const sales = AGENT_DEFINITIONS.find((agent) => agent.id === "agent_sales");
const clipper = AGENT_DEFINITIONS.find((agent) => agent.id === "agent_clipper");

if (!acquisition || acquisition.name !== "思潼·创始人IP获客系统" || acquisition.capabilities.length !== 16 || acquisition.capabilities.some((item) => item.key === "ip_positioning") || !["fip_franchise", "fip_store_visit", "fip_student_recruitment", "fip_partner_recruitment"].every((key) => acquisition.capabilities.some((item) => item.key === key)) || !acquisition.capabilities.some((item) => item.key === "baolu_ip_advisor" && item.skillId === "baolu_ip_advisor") || !acquisition.capabilities.some((item) => item.key === "topic_inspiration" && item.skillId === "baolu_topics") || !acquisition.capabilities.some((item) => item.key === "paid_traffic" && item.skillId === "optimize_local_push_ads") || !acquisition.capabilities.some((item) => item.key === "dou_plus_traffic" && item.skillId === "dou_plus_ads")) {
  failures.push("创始人IP获客系统必须保留兼容Agent ID，并提供四目标入口与问问保禄能力分身");
}
if (
  !storeAcquisition
  || storeAcquisition.name !== "思潼·门店获客智能体"
  || storeAcquisition.capabilities.length !== 12
  || !storeAcquisition.capabilities.some((item) => item.key === "content_plan" && /团购/.test(item.promptTemplate))
  || !storeAcquisition.capabilities.some((item) => item.key === "xiaohongshu_copy" && item.skillId === "xiaohongshu_ops")
  || !storeAcquisition.capabilities.some((item) => item.key === "image_prompt_preview" && item.skillId === "lanqi-image-prompt-enhancer")
) {
  failures.push("store acquisition agent boundary missing");
}
if (acquisition && /线上订单|外卖/.test(`${acquisition.description} ${acquisition.marketing?.tagline ?? ""} ${acquisition.marketing?.promise ?? ""}`)) {
  failures.push("品牌获客 Agent 的产品承诺只能覆盖内容获客，不得承诺外卖订单或外卖运营");
}
if (!takeaway || takeaway.capabilities.length !== 13 || !["takeaway_data_foundation", "takeaway_growth", "mature_store_growth", "new_store_breakthrough", "takeaway_data_audit", "takeaway_menu_profit", "takeaway_campaign_roi", "takeaway_competitor_loss", "takeaway_problem_validation", "takeaway_experiment", "takeaway_execution", "takeaway_effect_evaluation", "takeaway_review"].every((key) => takeaway.capabilities.some((item) => item.key === key && item.skillId === "takeaway-growth-advisor"))) {
  failures.push("外卖增长 Agent 必须独立存在，包含经营数据底座、老店增长、新店突破等10个首发任务，并全部复用 takeaway-growth-advisor 能力底座");
}
if (restaurant?.capabilities.find((item) => item.key === "takeaway_growth")?.skillId !== "takeaway-growth-advisor") {
  failures.push("餐饮增长 Agent 的外卖订单增长必须复用独立外卖增长能力底座");
}
if (!restaurant || restaurant.capabilities.length !== 9 || !["takeaway_growth", "dine_in_growth", "chain_store_growth", "franchise_acquisition"].every((key) => restaurant.capabilities.some((item) => item.key === key))) {
  failures.push("餐饮增长 Agent 必须有 9 个任务，并覆盖外卖、堂食、连锁门店和招商加盟四个场景");
}
if (restaurant && (
  !restaurant.marketing?.headline.includes("外卖订单卡在哪一环") ||
  !restaurant.marketing?.promise.includes("7天单变量实验") ||
  !restaurant.marketing?.promise.includes("不编造经营结论")
)) {
  failures.push("餐饮增长营销页必须聚焦线上外卖诊断、7天单变量实验和证据边界");
}
if (!sales || sales.capabilities.length !== 6) failures.push("销售 Agent 必须有 6 个首发任务");
if (!clipper || clipper.capabilities.length !== 2 || !clipper.capabilities.some((item) => item.key === "commerce_clipping") || !clipper.capabilities.some((item) => item.key === "persona_clipping")) {
  failures.push("自由组片 Agent 必须独立存在，并包含带货视频和人设/观点视频两个入口");
}
if (new Set(AGENT_DEFINITIONS.map((agent) => agent.slug)).size !== AGENT_DEFINITIONS.length) {
  failures.push("Agent slug 必须唯一");
}

const provider = {
  name: "agent-product-smoke",
  async complete() {
    return [
      "## 结论",
      "当前应先根据已确认的企业信息完成一个具体动作，不编造未提供的数据。",
      "## 已确认",
      "- 用户正在做本地生活服务。",
      "## 待确认",
      "- 目标客户、核心产品和当前转化数据。",
      "## 今日动作",
      "1. 补充目标客户的真实场景。",
      "2. 围绕一个具体问题生成内容。",
      "3. 发布后记录自然流量、咨询和到店数据。"
    ].join("\n");
  }
};

const context = { ...getDemoContext({}), source: "demo" as const };
const founderIpContext = { ...getDemoContext({ "x-sitong-plan": "ip_standard" }), source: "demo" as const };
if (acquisition) {
  const result = await invokeSkillThroughMcp({
    requestId: "smoke-acquisition-fip-skill-v1-0001",
    context: founderIpContext,
    provider,
    agentId: acquisition.id,
    capabilityId: "content_plan",
    skillId: "founder_ip_content_creator",
    capabilityLocked: true,
    input: "获客目标：合作方招募。选题/钩子：合作先看交付边界。目标人群：本地渠道伙伴。来源依据：本轮录音原话。请生成内容草稿。",
    skipEntitlement: true,
    persist: false
  });
  if (result.skillId !== "founder_ip_content_creator" || result.agentId !== acquisition.id) {
    failures.push(`获客任务没有通过正确的 Agent/Skill 运行：agent=${result.agentId} skill=${result.skillId}`);
  }
  const subjectAnchorResult = await invokeSkillThroughMcp({
    requestId: "smoke-acquisition-subject-anchor-fip-skill-v1-0001",
    context: founderIpContext,
    provider: { name: "subject-anchor-smoke", async complete() { return "# 三条短视频内容\n\n只输出内容正文，不主动提品牌。"; } },
    agentId: acquisition.id,
    capabilityId: "content_plan",
    skillId: "founder_ip_content_creator",
    capabilityLocked: true,
    input: "枕水江南是中式快餐品牌，请做3条抖音短视频内容。",
    skipEntitlement: true,
    persist: false
  });
  if (!subjectAnchorResult.answerText.startsWith("> 本次内容主体：枕水江南")) {
    failures.push("获客任务遗漏用户已提供的品牌名时，运行时必须自动补入内容主体锚点");
  }
  const paidTrafficResult = await invokeSkillThroughMcp({
    requestId: "smoke-paid-traffic-0001",
    context,
    provider: {
      name: "paid-traffic-boundary-smoke",
      async complete() {
        return "已经帮你创建并启动广告计划，预算会自动增加。";
      }
    },
    agentId: acquisition.id,
    capabilityId: "paid_traffic",
    skillId: "optimize_local_push_ads",
    capabilityLocked: true,
    input: "这条抖音视频自然播放3000，收到8条私信。我想用DOU+测试同城线索，预算500元，请给投流建议和止损条件。",
    skipEntitlement: true,
    persist: false
  });
  const paidTrafficTerms = ["投流结论", "账户身份", "证据与数据口径", "根因强度", "P0动作", "验证指标", "观察条件", "止损", "回退方案", "PREVIEW_ONLY变更单"];
  if (
    paidTrafficResult.capabilityId !== "paid_traffic" ||
    paidTrafficResult.skillId !== "optimize_local_push_ads" ||
    paidTrafficTerms.some((term) => !paidTrafficResult.answerText.includes(term)) ||
    /已经帮你创建并启动广告计划/.test(paidTrafficResult.answerText)
  ) {
    failures.push(`投流系统必须调用本地推 Skill、输出预览变更单，并拦截虚假账户操作：${paidTrafficResult.answerText.slice(0, 260)}`);
  }
  const franchiseResult = await invokeSkillThroughMcp({
    requestId: "smoke-franchise-route-0001",
    context,
    provider: { name: "franchise-route-fast-path", async complete() { throw new Error("franchise_starter_should_not_call_provider"); } },
    agentId: acquisition.id,
    // Verify a stale/manual content-card choice cannot suppress semantic routing.
    capabilityId: "content_plan",
    skillId: "baolu_content_creator",
    input: "中式快餐 招商加盟 找加盟商",
    skipEntitlement: true,
    persist: false
  });
  if (
    franchiseResult.skillId !== "baolu_content_creator" ||
    !["深度事实梳理", "品类：中式快餐", "品牌/项目名", "真实证据", "承接动作", "不重复追问"].every((term) => franchiseResult.answerText.includes(term)) ||
    !franchiseResult.nextActions.includes("生成下一条招商短视频文案")
  ) {
    failures.push(`招商加盟短输入必须覆盖旧内容卡片并进入招商事实澄清，不能编造品牌和加盟证据：${franchiseResult.skillId} ${franchiseResult.answerText.slice(0, 320)}`);
  }
  const savedProfileContext = {
    ...getDemoContext({
      "x-sitong-profile": encodeURIComponent(JSON.stringify({
        industry: "中式快餐连锁",
        city: "杭州",
        offer: "25元工作日午餐套餐",
        customer: "附近写字楼上班族"
      }))
    }),
    source: "demo" as const
  };
  const momentsFromStaleCard = await invokeSkillThroughMcp({
    requestId: "smoke-moments-semantic-route-0001",
    context: savedProfileContext,
    provider: { name: "moments-route-fallback", async complete() { throw new Error("force_moments_fallback"); } },
    agentId: acquisition.id,
    capabilityId: "franchise_acquisition",
    input: "写个朋友圈文案，今天直接发。",
    skipEntitlement: true,
    persist: false
  });
  if (
    momentsFromStaleCard.skillId !== "moments_generator" ||
    !["朋友圈", "25元工作日午餐套餐", "附近写字楼上班族"].every((term) => momentsFromStaleCard.answerText.includes(term)) ||
    /招商获客|请补充/.test(momentsFromStaleCard.answerText)
  ) {
    failures.push(`朋友圈语义必须覆盖旧的招商任务卡片，并自动使用已保存企业资料直接成文：${momentsFromStaleCard.skillId} ${momentsFromStaleCard.answerText.slice(0, 320)}`);
  }
  const routedSevenDayPlan = await invokeSkillThroughMcp({
    requestId: "smoke-routed-seven-day-plan-0001",
    context,
    provider: { name: "routed-seven-day-fallback", async complete() { throw new Error("forced_provider_failure"); } },
    agentId: storeAcquisition?.id ?? acquisition.id,
    input: "我是上海一家产后修复工作室，主推1980元盆底修复套餐，目标客户是产后3到12个月的宝妈。请给我未来7天的抖音和朋友圈获客计划，每天发什么、怎么承接优惠、私信跟进怎么说。",
    skipEntitlement: true,
    persist: false
  });
  const requiredSevenDayTerms = ["第1天", "第7天", "抖音", "朋友圈", "承接动作", "私信跟进", "1980", "盆底修复"];
  const missingSevenDayTerms = requiredSevenDayTerms.filter((term) => !routedSevenDayPlan.answerText.includes(term));
  if (routedSevenDayPlan.skillId !== "baolu_content_creator" || missingSevenDayTerms.length > 0) {
    failures.push(`自由提问的7天获客计划必须自动识别为内容计划，并交付事实型逐天方案（skill=${routedSevenDayPlan.skillId}，缺少：${missingSevenDayTerms.join("、") || "无"}）`);
  }
  const fallbackResult = await invokeSkillThroughMcp({
    requestId: "smoke-coffee-topics-0001",
    context,
    provider: { name: "forced-fallback", async complete() { throw new Error("forced_provider_failure"); } },
    agentId: storeAcquisition?.id ?? acquisition.id,
    capabilityId: "content_plan",
    skillId: "baolu_content_creator",
    input: "我在杭州开一家客单价35元的社区咖啡店，请给我本周能直接拍的3个短视频选题，每个带3秒开头。",
    skipEntitlement: true,
    persist: false
  });
  if (!/选题1[：:]|选题1/.test(fallbackResult.answerText) || !/选题2[：:]|选题2/.test(fallbackResult.answerText) || !/选题3[：:]|选题3/.test(fallbackResult.answerText)) {
    failures.push("咖啡店多选题请求必须按数量交付 3 个选题");
  }
  if (/中午不知道吃什么|热乎饭|团购核销|拍热气、锅/.test(fallbackResult.answerText)) {
    failures.push("咖啡店内容不得套用热食餐饮或团购核销模板");
  }
  const scopedResult = await invokeSkillThroughMcp({
    requestId: "smoke-scoped-copy-0001",
    context,
    provider: {
      name: "hallucinating-copy-provider",
      async complete() {
        return "楼下那杯竞赛级SOE拿铁每天7:30现做，走两分钟就到，顾客都说奶泡很绵密。";
      }
    },
    agentId: storeAcquisition?.id ?? acquisition.id,
    capabilityId: "content_plan",
    skillId: "baolu_content_creator",
    input: "帮社区咖啡店写一条小红书发布文案，只要文案，不要脚本和投流。主推35元拿铁，目标客户是附近上班族，目标是引导到店。",
    skipEntitlement: true,
    persist: false
  });
  if (scopedResult.skillVersion !== "5.0.0") failures.push("内容 Skill 必须绑定正式 5.0.0 版本");
  if (/九件套|八件套|Skill|Prompt|MCP|路由|质检|模型|剪辑EDL|发布时间|投流建议|拍摄脚本/.test(scopedResult.answerText)) {
    failures.push("限定范围的文案不得泄露内部词或扩写成完整方案");
  }
  if (/竞赛级|SOE|7:30|楼下|走两分钟|奶泡/.test(scopedResult.answerText)) {
    failures.push("限定范围的文案不得保留模型虚构的产品、营业或位置事实");
  }
  if (!scopedResult.answerText.includes("35元拿铁") || !scopedResult.answerText.includes("附近上班族")) {
    failures.push("安全文案必须保留用户确认的产品与目标客户事实");
  }
  try {
    await invokeSkillThroughMcp({
      requestId: "smoke-cross-skill-0001",
      context,
      provider,
      agentId: acquisition.id,
      capabilityId: "content_plan",
      skillId: "sales_growth_advisor",
      input: "越权测试",
      skipEntitlement: true,
      persist: false
    });
    failures.push("获客 Agent 不应允许越权调用销售 Skill");
  } catch (error) {
    if (!(error instanceof AgentAccessError)) failures.push("越权 Skill 应返回 AgentAccessError");
  }
}

if (restaurant) {
  const restaurantScenarios = [
    {
      id: "takeaway",
      expectedCapability: "takeaway_growth",
      expectedSkill: "takeaway-growth-advisor",
      input: "客户：枕水江南。中式快餐连锁，在沈阳有7家外卖店，新店外卖销售额不好，想提升美团、饿了么、淘宝闪购的线上订单。菜品、套餐、价格、优惠和后台数据以后再补，先正常给第一版方案。",
      required: ["枕水江南", "沈阳", "7家", "美团", "饿了么", "淘宝闪购", "已确认事实", "详细问题清单", "完整原因地图", "优先验证候选", "推荐进入哪个任务"],
      forbidden: [/堂食核销增长方案/, /保证订单/, /虚构GMV/]
    },
    {
      id: "dine-in",
      expectedCapability: "dine_in_growth",
      expectedSkill: "restaurant-growth-advisor",
      input: "我在沈阳经营一家中式餐厅，当前主要问题是堂食到店客流不足。请先给到店增长诊断和7天行动方案，真实客流、客单和主推菜品以后补。",
      required: ["堂食到店增长", "实际到店", "【待补】", "本周优先动作", "复盘指标"],
      forbidden: [/外卖订单增长第一版/, /保证到店/]
    },
    {
      id: "chain",
      expectedCapability: "chain_store_growth",
      expectedSkill: "restaurant-growth-advisor",
      input: "我们是一个30家门店的餐饮连锁品牌，想做连锁门店增长。请区分总部和门店责任，先给单店模型、门店分层、样板店试点和复制方案，各店数据后续再提供。",
      required: ["餐饮连锁门店增长", "30家", "总部", "样板店", "不生成门店排名", "数据模板"],
      forbidden: [/第1名门店/, /第30名门店/]
    },
    {
      id: "franchise",
      expectedCapability: "franchise_acquisition",
      expectedSkill: "restaurant-growth-advisor",
      input: "客户：三禾糖水铺，餐饮糖水连锁约30家店，现在招商加盟扩张慢。请给餐饮招商加盟增长方案，加盟政策、费用、案例和回报数据以后补。",
      required: ["三禾糖水铺", "餐饮招商加盟增长", "30家", "有效加盟线索", "【待补】", "不得承诺收益"],
      forbidden: [/稳赚|保证收益|一定回本|必然回本/]
    }
  ];
  for (const scenario of restaurantScenarios) {
    const result = await invokeSkillThroughMcp({
      requestId: `smoke-restaurant-${scenario.id}-0001`,
      context,
      provider: { name: `restaurant-${scenario.id}-fallback`, async complete() { throw new Error("forced_provider_failure"); } },
      agentId: restaurant.id,
      input: scenario.input,
      skipEntitlement: true,
      persist: false
    });
    const missing = scenario.required.filter((term) => !result.answerText.includes(term));
    if (result.skillId !== scenario.expectedSkill || result.capabilityId !== scenario.expectedCapability || missing.length > 0) {
      failures.push(`餐饮${scenario.id}场景路由或交付不合格（skill=${result.skillId}，capability=${result.capabilityId}，缺少：${missing.join("、") || "无"}）`);
    }
    if (scenario.forbidden.some((pattern) => pattern.test(result.answerText))) {
      failures.push(`餐饮${scenario.id}场景命中禁用内容：${result.answerText.slice(0, 260)}`);
    }
  }

  if (takeaway) {
    const result = await invokeSkillThroughMcp({
      requestId: "smoke-takeaway-experiment-0001",
      context,
      provider: { name: "takeaway-experiment-fallback", async complete() { throw new Error("forced_provider_failure"); } },
      agentId: takeaway.id,
      capabilityId: "takeaway_experiment",
      skillId: "takeaway-growth-advisor",
      input: "客户：枕水江南中街店。平台是美团和淘宝闪购，请把8月3日商品调整设计成单变量实验，利润和活动数据后续补。",
      skipEntitlement: true,
      persist: false
    });
    for (const term of ["枕水江南", "基线期", "排除日", "测试期", "保持不变项", "止损", "审批人", "复盘日"]) {
      if (!result.answerText.includes(term)) failures.push(`外卖增长实验交付缺少：${term}`);
    }
    for (const scenario of [
      { capabilityId: "mature_store_growth", input: "枕水江南皇姑店是成熟老店，请用近90天趋势和兄弟门店对比找增长瓶颈。", required: ["老店增长", "历史基线", "单变量"] },
      { capabilityId: "new_store_breakthrough", input: "枕水江南新店刚上线美团，请制定7天、14天、30天业绩突破计划。", required: ["新店", "7天", "14天", "30天"] }
    ]) {
      const scenarioResult = await invokeSkillThroughMcp({
        requestId: `smoke-${scenario.capabilityId}-0001`,
        context,
        provider: { name: `${scenario.capabilityId}-fallback`, async complete() { throw new Error("forced_provider_failure"); } },
        agentId: takeaway.id,
        capabilityId: scenario.capabilityId,
        skillId: "takeaway-growth-advisor",
        input: scenario.input,
        skipEntitlement: true,
        persist: false
      });
      for (const term of scenario.required) {
        if (!scenarioResult.answerText.includes(term)) failures.push(`${scenario.capabilityId}交付缺少：${term}`);
      }
    }
    const workbuddyCases = [
      {
        capabilityId: "new_store_breakthrough",
        input: "新店开业7天只有10单，怎么拉到每天50单？",
        required: ["新店冷启动", "7天", "10单", "每天50单", "第1至2天", "第15至30天"]
      },
      {
        capabilityId: "takeaway_menu_profit",
        input: "50个SKU，但80%的订单集中在5个爆款，要不要砍掉长尾？",
        required: ["50个SKU", "80%的订单", "5个爆款", "长尾", "A保留", "B观察", "C隐藏", "先隐藏、后删除"]
      },
      {
        capabilityId: "takeaway_menu_profit",
        input: "客单价28元，想提升到35元，满减没效果，怎么做？",
        required: ["客单价28元", "35元", "满减没效果", "25%", "目标价位套餐", "连续7天"]
      }
    ] as const;
    const workbuddyAnswers: string[] = [];
    for (const scenario of workbuddyCases) {
      const scenarioResult = await invokeSkillThroughMcp({
        requestId: `smoke-workbuddy-${scenario.capabilityId}-${workbuddyAnswers.length}`,
        context,
        provider: { name: `workbuddy-${scenario.capabilityId}-fallback`, async complete() { throw new Error("forced_provider_failure"); } },
        agentId: takeaway.id,
        capabilityId: scenario.capabilityId,
        skillId: "takeaway-growth-advisor",
        input: scenario.input,
        skipEntitlement: true,
        persist: false
      });
      workbuddyAnswers.push(scenarioResult.answerText);
      const missing = scenario.required.filter((term) => !scenarioResult.answerText.includes(term));
      if (missing.length > 0) failures.push(`WorkBuddy外卖场景未读取用户输入：${scenario.input}；缺少 ${missing.join("、")}`);
    }
    if (new Set(workbuddyAnswers).size !== workbuddyAnswers.length) {
      failures.push("WorkBuddy三类外卖问题不得返回同一份通用资料卡");
    }
    const incompleteMenuAnswer = await invokeSkillThroughMcp({
      requestId: "smoke-workbuddy-menu-incomplete-provider-answer",
      context,
      provider: {
        name: "workbuddy-incomplete-menu-provider",
        async complete() {
          return "一句话结论：不直接砍。请先导出近30天数据，并告诉我爆款成本率和长尾里有没有小食饮品；拿到数据后再给分类清单。";
        }
      },
      agentId: takeaway.id,
      capabilityId: "takeaway_menu_profit",
      skillId: "takeaway-growth-advisor",
      input: "50个SKU，但80%的订单集中在5个爆款，要不要砍掉长尾？",
      skipEntitlement: true,
      persist: false
    });
    if (
      !["A保留", "B观察", "C隐藏", "先隐藏、后删除", "连续7天"].every((term) => incompleteMenuAnswer.answerText.includes(term))
    ) {
      failures.push(`外卖模型只追问补数、没有先交付可执行第一版时，必须自动切换为按用户问题生成的行动方案：flags=${incompleteMenuAnswer.qualityFlags.join(",")}；answer=${incompleteMenuAnswer.answerText.slice(0, 360)}`);
    }
    const cityBoundaryAnswer = await invokeSkillThroughMcp({
      requestId: "smoke-takeaway-city-boundary",
      context,
      provider: { name: "takeaway-city-boundary-fallback", async complete() { throw new Error("forced_provider_failure"); } },
      agentId: takeaway.id,
      capabilityId: "takeaway_menu_profit",
      skillId: "takeaway-growth-advisor",
      input: "品牌：枕水江南；经营城市：沈阳；当前存在上海本帮红烧肉套餐，需要优化菜单结构。",
      skipEntitlement: true,
      persist: false
    });
    if (!cityBoundaryAnswer.answerText.includes("所在城市：沈阳") || cityBoundaryAnswer.answerText.includes("所在城市：上海")) {
      failures.push(`菜品名称不得被误识别为经营城市：${cityBoundaryAnswer.answerText.slice(0, 300)}`);
    }
    for (const section of ["菜单数据结论", "菜品与套餐问题", "利润风险", "现在只做这一件事", "待补数据"]) {
      if (!cityBoundaryAnswer.answerText.includes(section)) failures.push(`菜单利润任务缺少专属栏目：${section}`);
    }
  }

  const takeawayCopy = await invokeSkillThroughMcp({
    requestId: "smoke-restaurant-single-content-0001",
    context,
    provider: { name: "restaurant-copy-fallback", async complete() { throw new Error("forced_provider_failure"); } },
    agentId: restaurant.id,
    input: "帮我写一条外卖套餐短视频口播文案，只写文案，菜名、套餐和价格暂时待补。",
    skipEntitlement: true,
    persist: false
  });
  if (takeawayCopy.skillId !== "baolu_content_creator" || takeawayCopy.capabilityId !== "content_plan") {
    failures.push(`餐饮单点内容需求应复用内容 Skill，而不是误进整套行业诊断：${takeawayCopy.skillId}/${takeawayCopy.capabilityId}`);
  }
}

if (sales) {
  const lockedSalesStep = await invokeSkillThroughMcp({
    requestId: "smoke-locked-sales-follow-up-0001",
    context,
    provider: { name: "locked-sales-fallback", async complete() { throw new Error("force_sales_fallback"); } },
    agentId: sales.id,
    capabilityId: "follow_up_plan",
    skillId: "sales_growth_advisor",
    capabilityLocked: true,
    deliveryPolicy: "draft_with_placeholders",
    routingInput: "同时做客户诊断、异议回复和7天跟进计划",
    input: [
      "跟进计划子交付必须从第1天写到第7天。",
      "用户这次补充：客户说学费贵、担心学不会和学完没客源，请设计7天跟进计划。"
    ].join("\n"),
    skipEntitlement: true,
    persist: false
  });
  if (
    lockedSalesStep.capabilityId !== "follow_up_plan"
    || !lockedSalesStep.answerText.includes("跟进计划")
    || lockedSalesStep.answerText.startsWith("销售复盘")
  ) {
    failures.push(`组合任务的显式跟进步骤不得被多意图文本覆盖成客户诊断：${lockedSalesStep.capabilityId} ${lockedSalesStep.answerText.slice(0, 240)}`);
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Agent product smoke passed: catalog, fixed routing and Skill allowlist isolation are valid.");
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});

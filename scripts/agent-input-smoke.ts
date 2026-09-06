process.env.NODE_ENV = "test";
process.env.DATA_MODE = "demo";
process.env.DEEPSEEK_MODEL = "deepseek-v4-pro";
process.env.IP_AGENT_PRIMARY_TIMEOUT_MS = "80";
process.env.IP_AGENT_REPAIR_TIMEOUT_MS = "50";
process.env.IP_AGENT_PLANNER_TIMEOUT_MS = "50";

async function main() {
  const [
    { buildAgentMessages, resolveAgentAnalysisMode, runAgent },
    { extractBusinessDocumentText },
    { normalizeBusinessInput },
    { asksForHotspotContentAsset, extractUserRoutingInput, inferAcquisitionRoutingCapability, inferTakeawayRoutingCapability, requiresRestaurantGrowthAgent, resolveAgentProductDeliveryPolicy },
    { inferAcquisitionCapabilities, resolveAcquisitionTaskCapabilities },
    { buildIpVoiceStyleContext, buildIpVoiceStyleProfile },
    { buildKnowledgeSubjectContext, buildPlatformIndustryContext, defaultKnowledgeLayer, listPlatformIndustryPacks },
    { buildAgentKnowledgeRunContext },
    { buildTopicClarificationPrompt },
    { resolveDeviceScope },
    { createRequestFingerprint }
  ] = await Promise.all([
    import("../packages/agent/src/index.js"),
    import("../apps/api/src/routes/media.js"),
    import("../packages/shared/src/index.js"),
    import("../apps/api/src/routes/agents.js"),
    import("../apps/web/src/lib/acquisition-routing.js"),
    import("../apps/api/src/services/ip-voice-style.js"),
    import("../apps/api/src/services/knowledge-taxonomy.js"),
    import("../apps/api/src/routes/knowledge-base.js"),
    import("../apps/api/src/services/topic-clarification.js"),
    import("../apps/web/src/lib/device-scope.js"),
    import("../apps/api/src/services/request-fingerprint.js")
  ]);
  const failures: string[] = [];
  const fingerprintA = createRequestFingerprint({ input: "同一任务", capabilityId: "paid_traffic", nested: { b: 2, a: 1 } });
  const fingerprintAReordered = createRequestFingerprint({ nested: { a: 1, b: 2 }, capabilityId: "paid_traffic", input: "同一任务" });
  const fingerprintB = createRequestFingerprint({ input: "换了任务", capabilityId: "paid_traffic", nested: { b: 2, a: 1 } });
  if (fingerprintA !== fingerprintAReordered || fingerprintA === fingerprintB || !/^[a-f0-9]{64}$/.test(fingerprintA)) {
    failures.push("请求指纹必须与对象键顺序无关、对业务内容变化敏感，并使用固定长度不可逆摘要");
  }
  if (
    resolveAgentProductDeliveryPolicy("acquisition") !== "draft_with_placeholders" ||
    resolveAgentProductDeliveryPolicy("takeaway-growth") !== "draft_with_placeholders" ||
    resolveAgentProductDeliveryPolicy("restaurant-growth") !== "draft_with_placeholders" ||
    resolveAgentProductDeliveryPolicy("sales") !== "clarify"
  ) {
    failures.push("获客、外卖与餐饮工作台的已登录任务必须优先交付带待补项的第一版，不能因资料不全退化成重复追问");
  }
  if (
    !requiresRestaurantGrowthAgent("枕水江南外卖订单低，需要优化菜单、套餐、加购、配送和复购") ||
    requiresRestaurantGrowthAgent("枕水江南是餐饮品牌，想做一周抖音短视频和直播内容，不分析外卖订单")
  ) {
    failures.push("品牌获客智能体必须把外卖经营问题路由到外卖增长能力，同时保留餐饮品牌的短视频、直播和朋友圈内容任务");
  }
  const takeawayRoutingCases = [
    ["新店开业7天只有10单，怎么拉到每天50单？", "new_store_breakthrough"],
    ["50个SKU但80%订单集中在5个爆款，要不要砍掉长尾？", "takeaway_menu_profit"],
    ["客单价28元想提升到35元，满减没效果，怎么做？", "takeaway_menu_profit"],
    ["导入的美团订单明细识别不了，先核对字段和数据口径", "takeaway_data_audit"],
    ["美团神枪手花费高但ROI低，如何优化投放？", "takeaway_campaign_roi"],
    ["平台测算的流失竞品和流失品类怎么看？", "takeaway_competitor_loss"]
  ] as const;
  for (const [input, expected] of takeawayRoutingCases) {
    const actual = inferTakeawayRoutingCapability(input);
    if (actual !== expected) failures.push(`外卖自由输入路由错误：${input} => ${actual ?? "未识别"}，预期 ${expected}`);
  }
  if (
    asksForHotspotContentAsset("检索餐饮公开热点并给5个可拍选题") ||
    !asksForHotspotContentAsset("结合餐饮公开热点写一条60秒完整逐字稿和拍摄脚本")
  ) {
    failures.push("行业热点里的选题属于热点能力自身交付，只有明确要文案/脚本/完整成品时才追加内容创作，不能多跑90秒无关任务");
  }
  const topicContext = {
    tenantId: "tenant-topic-smoke",
    userId: "user-topic-smoke",
    role: "owner",
    planCode: "chain_premium",
    source: "demo",
    creditBalance: 300,
    profile: {
      tenantId: "tenant-topic-smoke",
      tenantName: "东北味道连锁餐饮",
      tenantType: "chain_brand",
      industry: "东北菜与烧烤连锁",
      city: "沈阳"
    }
  } as any;
  const readyTopicClarification = buildTopicClarificationPrompt({
    input: "别问我废话，直接给10个能拍的选题。目标不是泛流量，而是沈阳25-45岁家庭聚餐和夜宵顾客。",
    context: topicContext,
    taskCustomerProfile: {
      name: "东北味道连锁餐饮",
      industry: "东北菜与烧烤连锁",
      targetCustomer: "沈阳25—45岁家庭聚餐和夜宵顾客",
      growthGoal: "提升到店、外卖订单和有效获客线索"
    }
  });
  if (readyTopicClarification) {
    failures.push(`任务客户资料已包含主体、行业、目标客户和增长目标时不得重复追问：${readyTopicClarification}`);
  }
  const contrastTargetClarification = buildTopicClarificationPrompt({
    input: "给东北味道连锁餐饮做10个选题，主营东北菜和烧烤。目标不是泛流量，而是沈阳25-45岁家庭聚餐和夜宵顾客，希望提升到店和外卖订单。",
    context: topicContext
  });
  if (contrastTargetClarification) {
    failures.push(`用户用“目标不是…而是…”说明受众且明确到店/订单目标时不得重复追问：${contrastTargetClarification}`);
  }
  const paidTrafficCapabilities = inferAcquisitionCapabilities("这条视频适合投流吗？请给我DOU+小额测试和止损条件");
  if (JSON.stringify(paidTrafficCapabilities) !== JSON.stringify(["paid_traffic"])) {
    failures.push(`明确投流需求必须路由到投流系统：${paidTrafficCapabilities.join(",")}`);
  }
  const contentAndTrafficCapabilities = inferAcquisitionCapabilities("同时写一条短视频文案，并给我小额投流测试方案");
  if (!contentAndTrafficCapabilities.includes("content_plan") || !contentAndTrafficCapabilities.includes("paid_traffic")) {
    failures.push(`内容与投流的组合需求必须同时调用内容系统和投流系统：${contentAndTrafficCapabilities.join(",")}`);
  }
  const topicFollowUpCapabilities = resolveAcquisitionTaskCapabilities(
    "抖音平台，账号名陈厂长，主页链接：https://v.douyin.com/example/",
    "topic_inspiration"
  );
  if (JSON.stringify(topicFollowUpCapabilities) !== JSON.stringify(["topic_inspiration"])) {
    failures.push("选题灵感任务后续补充对标资料时必须继续使用选题 Skill，不能切成行业对标或内容文案");
  }
  const switchedTopicCapabilities = resolveAcquisitionTaskCapabilities(
    "请改成写完整短视频文案",
    "topic_inspiration",
    ["content_plan"]
  );
  if (JSON.stringify(switchedTopicCapabilities) !== JSON.stringify(["content_plan"])) {
    failures.push("用户手动指定新能力时才允许覆盖任务已锁定的选题 Skill");
  }
  if (
    resolveDeviceScope({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", maxTouchPoints: 0, viewportWidth: 420 }) !== "desktop" ||
    resolveDeviceScope({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", maxTouchPoints: 5, viewportWidth: 430 }) !== "mobile" ||
    resolveDeviceScope({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)", maxTouchPoints: 5, viewportWidth: 1024 }) !== "mobile"
  ) {
    failures.push("任务、会话和草稿必须按真实设备类型区分 desktop 与 mobile，不能因电脑窗口变窄而误切到手机端");
  }
  const mobilePacks = listPlatformIndustryPacks("手机后市场连锁服务");
  if (
    !mobilePacks.some((pack) => pack.id === "platform-mobile-aftermarket-basics") ||
    mobilePacks.some((pack) => pack.id === "platform-local-service-basics")
  ) {
    failures.push("行业基础包必须按当前主体行业命中，手机后市场不能误并入本地生活或汽车后市场");
  }
  const subjectContext = buildKnowledgeSubjectContext({
    id: "client-project-1",
    subjectType: "client_project",
    name: "东北家味牛肉汤连锁",
    industry: "餐饮连锁",
    description: "为客户项目制作招商加盟内容"
  }) ?? "";
  const industryContext = buildPlatformIndustryContext("餐饮连锁") ?? "";
  if (
    !subjectContext.includes("本轮服务主体") ||
    !subjectContext.includes("客户项目") ||
    !subjectContext.includes("其他IP、企业或客户项目的资料不得串入") ||
    !industryContext.includes("平台审核行业基础知识") ||
    !industryContext.includes("不能覆盖企业私有事实") ||
    defaultKnowledgeLayer("client_project") !== "project_private"
  ) {
    failures.push("多IP、多项目知识调用必须先锁定服务主体，并将平台行业知识和私有事实严格分层");
  }
  const composedKnowledgeContext = buildAgentKnowledgeRunContext({
    slug: "acquisition",
    marketing: { knowledgeAction: { defaultInstruction: "只输出选题方案" } }
  } as any, [{
    id: "client-doc-1",
    title: "客户项目访谈",
    documentType: "transcript",
    content: "客户计划测试招商内容，具体门店数据仍待核实。"
  } as any], {
    subject: { id: "client-project-1", subjectType: "client_project", name: "东北家味牛肉汤连锁", industry: "餐饮连锁" },
    fallbackIndustry: "企业AI"
  });
  if (
    !composedKnowledgeContext.includes("名称：东北家味牛肉汤连锁") ||
    !composedKnowledgeContext.includes("连锁与招商加盟行业基础包") ||
    composedKnowledgeContext.includes("企业AI服务行业基础包") ||
    !composedKnowledgeContext.includes("其他IP、企业或客户项目的资料不得串入")
  ) {
    failures.push("智能体执行前必须以当前客户项目为主体选择行业包，不能回退到系统使用方的企业画像");
  }
  const voiceDocuments = [
    {
      id: "voice-1",
      title: "IP本人项目复盘录音",
      documentType: "transcript",
      content: [
        "### 录音信息",
        "“我跟你说，这个事不能只看工具，得先看企业到底要解决什么问题。”",
        "“你看，我们先把流程跑通，然后呢，再决定哪些环节交给AI。”",
        "我觉得先做一个最小版本，比上来就做一大套更靠谱。"
      ].join("\n")
    },
    {
      id: "voice-2",
      title: "IP本人客户沟通录音",
      documentType: "note",
      content: [
        "#### 录音总结",
        "“我跟你说，AI不是为了看起来厉害，而是要真的省时间、出结果。”",
        "“你看，这个事先别急着扩，咱们先跑一个样板，对吧？”",
        "我觉得能落地，比讲一堆概念更重要。"
      ].join("\n")
    }
  ];
  const voiceProfile = buildIpVoiceStyleProfile(voiceDocuments);
  const voiceContext = buildIpVoiceStyleContext(voiceDocuments) ?? "";
  if (
    !voiceProfile ||
    !voiceProfile.habits.includes("我跟你说") ||
    !voiceProfile.habits.includes("你看") ||
    !voiceContext.includes("只约束表达，不提供事实") ||
    !voiceContext.includes("不把旧录音里的客户、行业、经历和结论带进当前任务") ||
    !voiceContext.includes("不得模仿客户或第三方")
  ) {
    failures.push("录音知识必须提取可追溯的IP语言声纹，并明确只模仿表达、不继承旧事实和第三方说法");
  }
  if (buildIpVoiceStyleProfile([{
    id: "summary-only",
    title: "普通行业笔记",
    documentType: "note",
    content: "本次总结围绕行业趋势展开，形成三个建议和四项待办。"
  }])) {
    failures.push("普通知识笔记不能被误识别成IP本人语言声纹");
  }
  const videoEditInstruction = "根据我上传的视频，给出镜头结构、剪辑节奏和发布前修改建议。";
  const enrichedVideoEvidence = [
    videoEditInstruction,
    "【本次用户上传/粘贴的附件】",
    "画面解析：主播正面出镜。",
    "语音/字幕转写：今天直播要讲内容文案和朋友圈承接。"
  ].join("\n");
  const extractedVideoRoutingInput = extractUserRoutingInput(enrichedVideoEvidence, videoEditInstruction);
  if (
    inferAcquisitionRoutingCapability(extractedVideoRoutingInput) !== "shooting_editing" ||
    JSON.stringify(inferAcquisitionCapabilities(videoEditInstruction)) !== JSON.stringify(["shooting_editing"])
  ) {
    failures.push("视频附件路由必须只看用户当前要求，不能被转写中的直播、文案、朋友圈关键词扩成多技能任务");
  }
  const explicitVideoMulti = inferAcquisitionCapabilities("给这个视频做拍剪修改，同时再写一份直播话术。");
  if (!explicitVideoMulti.includes("shooting_editing") || !explicitVideoMulti.includes("live_script")) {
    failures.push("只有用户明确说同时需要多个交付时，才允许组合拍剪优化和直播话术");
  }
  const scopedCopyOnly = "我是鲁蒙肉饼连锁品牌方，做中式快餐招商加盟。请写一条60秒招商获客短视频口播逐字稿，只要完整文案，不要拍摄脚本、剪辑、投流或其他栏目。";
  if (
    JSON.stringify(inferAcquisitionCapabilities(scopedCopyOnly)) !== JSON.stringify(["franchise_acquisition"]) ||
    inferAcquisitionRoutingCapability(scopedCopyOnly) !== "franchise_acquisition"
  ) {
    failures.push("用户明确说不要拍摄剪辑时，否定词中的拍摄/剪辑不能把招商文案误路由到拍剪优化");
  }
  const franchiseLiveScript = "给鲁蒙肉饼做招商加盟直播话术，输出开场、留人、互动、转化和下播跟进。";
  if (
    JSON.stringify(inferAcquisitionCapabilities(franchiseLiveScript)) !== JSON.stringify(["live_script"]) ||
    inferAcquisitionRoutingCapability(franchiseLiveScript) !== "live_script"
  ) {
    failures.push("招商场景中的直播话术必须进入直播话术 Skill，不能被“招商加盟”关键词改路由成短视频招商文案");
  }
  const franchiseLiveFallback = await runAgent({
    tenantId: "demo-tenant",
    userId: "demo-user",
    role: "owner",
    planCode: "local_standard",
    requestedSkillId: "live_script_planner",
    capabilityId: "live_script",
    input: "给鲁蒙肉饼做招商加盟直播话术。产品：中式快餐加盟项目；目标客户：山东区域准备开店的创业者；直播目标：引导私信“加盟资料”并预约沟通；福利：免费领取加盟资料。没有回本数据和加盟商成功案例，不要编造。输出开场、留人、互动、转化和下播跟进话术。",
    tenantProfile: {
      tenantId: "demo-tenant",
      tenantName: "思潼企业AI服务",
      tenantType: "local_business",
      industry: "企业AI改造",
      data: { offer: "给品牌创始人做IP打造 给企业做AI改造", customer: "企业老板" }
    },
    channel: "h5"
  }, {
    name: "franchise-live-fallback",
    async complete() { throw new Error("force_live_fallback"); }
  });
  if (
    franchiseLiveFallback.analysisMode !== "deep" ||
    !franchiseLiveFallback.answer.includes("鲁蒙肉饼") ||
    !franchiseLiveFallback.answer.includes("中式快餐加盟项目") ||
    !franchiseLiveFallback.answer.includes("加盟资料") ||
    /给品牌创始人做IP打造|企业AI改造服务/.test(franchiseLiveFallback.answer)
  ) {
    failures.push(`招商直播话术必须深度分析并以本轮品牌、产品和目标为准，不得套企业默认画像：${franchiseLiveFallback.answer.slice(0, 320)}`);
  }
  const takeawayLiveDraft = await runAgent({
    tenantId: "demo-tenant",
    userId: "demo-user",
    role: "owner",
    planCode: "chain_premium",
    requestedSkillId: "live_script_planner",
    capabilityId: "live_script",
    deliveryPolicy: "draft_with_placeholders",
    input: "为东北味道连锁做60分钟外卖品牌直播话术。价格、优惠券、库存、配送范围都没给，必须用【待补】并提醒开播前确认；成交回到美团/饿了么，抖音只做品牌曝光和搜索引导。",
    tenantProfile: {
      tenantId: "demo-tenant",
      tenantName: "东北味道连锁",
      tenantType: "chain_brand",
      industry: "东北菜外卖连锁",
      city: "沈阳"
    },
    channel: "h5"
  }, {
    name: "takeaway-live-draft-with-placeholders",
    async complete() { throw new Error("force_takeaway_live_fallback"); }
  });
  if (
    !["60分钟直播话术包", "餐饮外卖转化", "【待补】", "美团", "饿了么", "场控执行清单"].every((term) => takeawayLiveDraft.answer.includes(term)) ||
    /现在还不能直接生成|抖音团购.{0,8}(下单|核销)|9\.9元/.test(takeawayLiveDraft.answer)
  ) {
    failures.push(`已登录获客工作台的外卖直播任务必须先交付占位初稿，不得重复追问或改成抖音团购：${takeawayLiveDraft.answer.slice(0, 520)}`);
  }
  const sparseLiveReview = await runAgent({
    tenantId: "demo-tenant",
    userId: "demo-user",
    role: "owner",
    planCode: "chain_premium",
    requestedSkillId: "baolu_live_review_engine",
    capabilityId: "live_review",
    input: "直播复盘真实数据：场观3200，最高在线68，平均停留38秒，新增关注96，私信12，美团搜索提升未知。录音转写：00:00-05:00开场反复介绍品牌；05:00-18:00讲菜品但没有互动；18:00-25:00主播冷场；25:00-40:00回答配送范围；40:00后录音缺失。请区分数据事实、转写证据和推测，缺失部分不要编。",
    tenantProfile: {
      tenantId: "demo-tenant",
      tenantName: "东北味道连锁",
      tenantType: "chain_brand",
      industry: "东北菜外卖连锁",
      city: "沈阳",
      data: { customer: "加盟意向人群", offer: "32家门店加盟项目" }
    },
    channel: "h5"
  }, {
    name: "sparse-live-review-user-evidence-only",
    async complete() {
      return "错误样板：视频号招商直播，累计观看5200，峰值在线168。";
    }
  });
  if (
    !["累计观看 | 3200", "峰值在线 | 68", "平均停留 | 38秒", "私信 | 12", "00:00-05:00", "40:00", "录音缺失"].every((term) => sparseLiveReview.answer.includes(term)) ||
    /5200|168|视频号|场景：招商加盟|32家门店/.test(sparseLiveReview.answer)
  ) {
    failures.push(`直播复盘只能使用本轮用户证据，不能从画像、提示样板或模型错误答案中带入平台、场景和数字：${sparseLiveReview.answer.slice(0, 620)}`);
  }
  const scopedFranchiseFollowUp = await runAgent({
    tenantId: "demo-tenant",
    userId: "demo-user",
    role: "owner",
    planCode: "local_standard",
    requestedSkillId: "baolu_content_creator",
    capabilityId: "franchise_acquisition",
    input: "目标加盟商：山东区域准备开店的创业者，餐饮经验不限，预算20到30万元。真实证据：现有3家直营店，有统一供应链和开店培训；暂无已授权加盟商成功案例，回本周期暂无。承接动作：私信“加盟资料”领取资料并预约沟通。",
    history: [
      { role: "user", content: scopedCopyOnly },
      { role: "assistant", content: "请一次性补充目标加盟商、真实证据和承接动作。" }
    ],
    tenantProfile: {
      tenantId: "demo-tenant",
      tenantName: "测试企业",
      tenantType: "local_business",
      industry: "企业AI服务"
    },
    channel: "h5"
  }, {
    name: "scoped-franchise-follow-up",
    async complete() {
      return "完整内容执行包\n品牌信息\n一、选题策划\n二、口播逐字稿\n三、拍摄脚本\n四、拍摄注意事项\n五、剪辑EDL\n六、发布标题\n七、最佳发布时间\n八、评论区引导话术\n九、投流建议";
    }
  });
  if (
    !scopedFranchiseFollowUp.answer.includes("鲁蒙肉饼") ||
    !scopedFranchiseFollowUp.answer.includes("中式快餐") ||
    !scopedFranchiseFollowUp.answer.includes("3家直营店") ||
    !scopedFranchiseFollowUp.answer.includes("私信“加盟资料”") ||
    /IP\+AI行业加盟项目|完整内容执行包|拍摄脚本|剪辑EDL|投流建议/.test(scopedFranchiseFollowUp.answer)
  ) {
    failures.push(`招商连续补充后必须继承首轮“只要完整文案”的范围，并保留品牌与事实：${scopedFranchiseFollowUp.answer.slice(0, 300)}`);
  }
  if (normalizeBusinessInput("平台：低音。竞品账号名：陈厂长。") !== "平台：抖音。竞品账号名：陈厂长。") {
    failures.push("平台实体归一化必须把“平台：低音”识别为“平台：抖音”");
  }
  if (normalizeBusinessInput("这段音乐低音太重，需要调整音响。") !== "这段音乐低音太重，需要调整音响。") {
    failures.push("平台实体归一化不得误改音乐和音频语境中的“低音”");
  }
  const csv = Buffer.from("作品,播放量,完播率\n视频A,1200,18%\n视频B,860,27%", "utf8");
  const extracted = await extractBusinessDocumentText(csv, "text/csv", "视频复盘.csv");
  if (!extracted.includes("视频A") || !extracted.includes("完播率")) failures.push("CSV业务文件没有读取到正文和字段");

  const baseRequest = {
    tenantId: "demo-tenant",
    userId: "demo-user",
    role: "owner" as const,
    planCode: "local_standard" as const,
    requestedSkillId: "baolu_content_creator" as const,
    capabilityId: "content_plan",
    input: "帮我写一条今天能发的朋友圈，只要文案。",
    tenantProfile: {
      tenantId: "demo-tenant",
      tenantName: "测试门店",
      tenantType: "local_business" as const,
      industry: "本地生活",
      city: "成都"
    },
    channel: "h5" as const
  };
  if (resolveAgentAnalysisMode(baseRequest) !== "fast") failures.push("简单明确请求应该走快速模式");
  if (resolveAgentAnalysisMode({
    ...baseRequest,
    capabilityId: "video_review",
    input: `请复盘。\n【本次用户上传/粘贴的附件】\n附件摘要：\n【业务文件解析结果】\n${extracted}`
  }) !== "deep") failures.push("带业务文件的视频复盘应该走深度模式");
  if (resolveAgentAnalysisMode({
    ...baseRequest,
    capabilityId: "franchise_acquisition",
    analysisMode: "fast",
    input: "鲁蒙肉饼连锁品牌 快餐招商加盟 写一条招商加盟文案"
  }) !== "deep") failures.push("招商加盟内容即使前端误传快速模式，也必须强制走深度模式");

  const pastedStoryboardShooting = await runAgent({
    ...baseRequest,
    requestedSkillId: "baolu_content_creator",
    capabilityId: "shooting_editing",
    input: [
      "【本次用户上传/粘贴的附件】",
      "视频转写与分镜：0-3秒黑屏后老板说‘我们开了32家店’；3-12秒连续4个远景菜品镜头；12-28秒讲东北菜分量但环境噪声很大；28-42秒门店外景；42-55秒口播‘地址见主页’；全片无字幕。",
      "只针对这条视频给拍摄、镜头、剪辑、字幕、声音、封面和发布前检查，不要另写新文案。"
    ].join("\n")
  }, {
    name: "pasted-storyboard-shooting-fallback",
    async complete() { throw new Error("force_pasted_storyboard_fallback"); }
  });
  if (
    !["视频基本信息", "现有版本诊断", "0-3秒", "黑屏", "32家店", "全片无字幕", "优化版剪辑EDL"].every((term) => pastedStoryboardShooting.answer.includes(term)) ||
    /团购到店可核销|想找稳妥项目的创业者|有效加盟咨询和考察预约/.test(pastedStoryboardShooting.answer)
  ) {
    failures.push(`用户粘贴的带时间戳分镜必须按真实证据复盘，不能退回通用拍剪或串入画像目标：${pastedStoryboardShooting.answer.slice(0, 480)}`);
  }

  const structuredVideoInput = [
    "\u6211\u662f\u4e0a\u6d77\u4e00\u5bb6\u7f8e\u7532\u5e97\uff0c\u76ee\u6807\u662f\u901a\u8fc7\u6296\u97f3\u83b7\u5f97\u540c\u57ce\u9884\u7ea6\u3002\u8bf7\u6839\u636e\u6211\u521a\u4e0a\u4f20\u7684\u6570\u636e\uff0c\u590d\u76d8\u8fd9\u4e24\u6761\u89c6\u9891\uff0c\u5e76\u7ed9\u4e0b\u4e00\u6761\u53ef\u76f4\u63a5\u62cd\u7684\u6539\u6cd5\u3002",
    "",
    "\u3010\u672c\u6b21\u7528\u6237\u4e0a\u4f20/\u7c98\u8d34\u7684\u9644\u4ef6\u3011",
    "\u9644\u4ef6\u540d\uff1a\u7f8e\u7532\u6296\u97f3\u6570\u636e.csv",
    "\u3010\u4e1a\u52a1\u6587\u4ef6\u89e3\u6790\u7ed3\u679c\u3011",
    "\u89c6\u9891\u6807\u9898,\u64ad\u653e\u91cf,\u5b8c\u64ad\u7387,\u5e73\u5747\u64ad\u653e\u65f6\u957f,\u8bc4\u8bba,\u79c1\u4fe1",
    "\u663e\u767d\u901a\u52e4\u7f8e\u7532,1200,18%,6\u79d2,8,1",
    "\u77ed\u7532\u600e\u4e48\u9009\u989c\u8272,860,27%,9\u79d2,12,0"
  ].join("\n");
  let structuredVideoProviderCalled = false;
  const structuredVideoReview = await runAgent({
    ...baseRequest,
    requestedSkillId: "baolu_review_engine",
    capabilityId: "video_review",
    input: structuredVideoInput
  }, {
    name: "structured-video-data-skill-path",
    async complete() {
      structuredVideoProviderCalled = true;
      throw new Error("force_structured_video_data_fallback_after_skill_call");
    }
  });
  const expectedVideoFacts = ["1200", "18%", "6\u79d2", "860", "27%", "9\u79d2", "\u663e\u767d\u901a\u52e4\u7f8e\u7532", "\u77ed\u7532\u600e\u4e48\u9009\u989c\u8272", "\u77ed\u89c6\u9891\u590d\u76d8\u62a5\u544a"];
  if (
    !structuredVideoProviderCalled ||
    structuredVideoReview.qualityFlags.includes("structured_data_fast_path_used") ||
    !expectedVideoFacts.every((fact) => structuredVideoReview.answer.includes(fact)) ||
    /\u9910\u996e|\u725b\u8089\u9762|\u5230\u5e97\u6838\u9500|SCALE|\u591a\u6280\u80fd\u8054\u5408\u4ea4\u4ed8/.test(structuredVideoReview.answer)
  ) {
    failures.push(`标准CSV的视频复盘必须先调用短视频复盘Skill，再按表头读取播放、完播、时长、评论和私信；失败兜底也不得串入招商或餐饮：${structuredVideoReview.answer.slice(0, 420)}`);
  }
  const inlineMetricReview = await runAgent({
    ...baseRequest,
    requestedSkillId: "baolu_review_engine",
    capabilityId: "video_review",
    input: "复盘一条视频：播放量10000，3秒留存62%，5秒留存38%，完播率11%，平均播放时长8.2秒，点赞300，评论25，分享8，主页访问180，私信6。视频标称时长60秒，但后台另一张截图写时长45秒；请标记冲突并分情况判断。"
  }, {
    name: "inline-video-metrics-conflict-fallback",
    async complete() { throw new Error("force_inline_metrics_fallback"); }
  });
  if (
    !["单条视频数据复盘报告", "3秒留存62%", "5秒留存38%", "时长口径冲突", "60秒", "45秒", "主页访问率", "下一轮A/B测试"].every((term) => inlineMetricReview.answer.includes(term)) ||
    /有效记录 0 条|没有识别到可计算的数据行|ROI\s*[=:：]\s*[1-9]/i.test(inlineMetricReview.answer)
  ) {
    failures.push(`单条内联指标必须直接复盘并保留冲突，不能误判成空表：${inlineMetricReview.answer.slice(0, 520)}`);
  }

  const multilineVideoReview = await runAgent({
    ...baseRequest,
    requestedSkillId: "baolu_review_engine",
    capabilityId: "video_review",
    input: [
      "读取我上传的视频后台数据文件，给出复盘和未来选题方向。",
      "视频描述,发布时间,完播率,平均播放时长,播放量,喜欢,评论量,分享量,关注量",
      '"AI时代的工作方式\\n#AI #内容营销 #IP",2026/05/26,20%,9.82秒,465,6,0,4,1',
      '"为什么你的AI数字化，全是交智商税？\\n#AI企业重构 #企业数字化",2026/06/11,5.03%,17.81秒,338,6,0,2,0',
      '"IP入企案例\\n#创始人IP #内容营销",2026/06/18,-,4.94秒,124,1,0,2,0'
    ].join("\n").replace(/\\n#/g, "\n#")
  }, {
    name: "multiline-video-data-skill-path",
    async complete() { throw new Error("force_multiline_video_data_fallback"); }
  });
  if (
    !["有效记录：3 条", "AI时代的工作方式", "465", "为什么你的AI数字化", "338", "IP入企案例", "124", "下周期选题建议"].every((term) => multilineVideoReview.answer.includes(term)) ||
    /招商获客完整版|SCALE招商|多技能联合交付/.test(multilineVideoReview.answer)
  ) {
    failures.push(`带换行视频描述的CSV必须按完整记录解析，不能把一条作品拆成多行或误路由：${multilineVideoReview.answer.slice(0, 500)}`);
  }

  const parsedVideoShooting = await runAgent({
    ...baseRequest,
    capabilityId: "shooting_editing",
    input: [
      videoEditInstruction,
      "【本次用户上传/粘贴的附件】",
      "附件1：speech-video.mp4",
      "附件摘要：",
      "用户上传了视频文件：speech-video.mp4，4秒，720x1280。",
      "当前能力是拍剪优化：只给视频修改建议。",
      "【业务文件解析结果】",
      "关键帧：已抽取 4 帧",
      "画面解析：人物正面出镜，背景为室内白墙，画面主体居中。",
      "语音/字幕转写：今天我们讨论企业AI落地，先从一个能验收的流程开始。"
    ].join("\n"),
    tenantProfile: {
      ...baseRequest.tenantProfile,
      city: "杭州",
      data: { offer: "企业AI服务", customer: "企业老板" }
    }
  }, {
    name: "parsed-video-shooting-fallback",
    async complete() { throw new Error("force_parsed_video_shooting_fallback"); }
  });
  if (
    !["拍摄剪辑优化方案", "视频基本信息", "现有版本诊断", "人物正面出镜", "今天我们讨论企业AI落地", "优化版口播逐字稿", "优化版拍摄脚本", "优化版剪辑EDL", "优化版发布策略", "投流建议", "核心改进点"].every((term) => parsedVideoShooting.answer.includes(term)) ||
    /拍剪优化待解析|多技能联合交付|内容文案完整版|直播话术完整版|杭州附近|我们家/.test(parsedVideoShooting.answer)
  ) {
    failures.push(`已抽帧和转写的视频必须按77视频黄金样板给完整拍剪优化方案，不得误判未解析、串技能或套企业城市：${parsedVideoShooting.answer.slice(0, 420)}`);
  }

  const fastFoodReview = await runAgent({
    ...baseRequest,
    requestedSkillId: "baolu_review_engine",
    capabilityId: "video_review",
    input: [
      "我是杭州中式快餐品牌，两条视频都没有投流，目标是25元工作日午餐团购核销。请复盘并给下一条改法。",
      "标题,播放量,完播率,平均播放时长,评论,私信,核销",
      "午餐现做现出,1200,18%,6秒,8,1,2",
      "25元午餐怎么吃,860,27%,9秒,12,0,1"
    ].join("\n")
  }, {
    name: "fast-food-video-review",
    async complete() {
      throw new Error("force_fast_food_video_review_fallback");
    }
  });
  if (
    !["午餐现做现出", "1200", "18%", "6秒", "25元午餐怎么吃", "860", "27%", "9秒"].every((term) => fastFoodReview.answer.includes(term)) ||
    /短甲|显白通勤|手型|肤色|美甲|SCALE招商|招商获客完整版/.test(fastFoodReview.answer)
  ) {
    failures.push("视频数据复盘必须保留表内两条作品与关键指标，不得串入美甲或招商模板");
  }

  const prepared = await buildAgentMessages({
    ...baseRequest,
    history: [
      { role: "user", content: "我们主推35元体验套餐。" },
      { role: "assistant", content: "已确认主推35元体验套餐。" }
    ],
    input: "就按上一轮确认的价格写。"
  });
  const historyText = prepared.messages.map((message) => message.content).join("\n");
  if (!historyText.includes("35元体验套餐") || prepared.messages.at(-1)?.content !== "就按上一轮确认的价格写。") {
    failures.push("多轮历史没有按顺序进入Agent上下文");
  }

  const postnatalRequest = {
    ...baseRequest,
    input: "我是上海一家产后修复工作室，主推1980元盆底修复套餐，目标客户是产后3到12个月的宝妈。现在主要靠美团和老客转介绍，抖音更新不稳定，朋友圈没有固定内容。本月想新增30个到店咨询。请给我未来7天的抖音和朋友圈获客计划：每天发什么、怎么承接优惠、私信跟进怎么说。"
  };
  let sevenDayProviderCalled = false;
  const sevenDayStartedAt = Date.now();
  const sevenDayFallback = await runAgent(postnatalRequest, {
    name: "seven-day-fallback",
    async complete() {
      sevenDayProviderCalled = true;
      throw new Error("seven_day_planner_should_not_call_provider");
    }
  });
  if (
    !["第1天", "第7天", "抖音", "朋友圈", "优惠承接", "私信跟进", "首次回复", "24小时未回复", "准备预约", "上海", "1980", "盆底修复", "宝妈"].every((term) => sevenDayFallback.answer.includes(term))
  ) {
    failures.push("7天获客计划兜底必须逐天交付抖音、朋友圈、承接和私信话术，并保留用户事实");
  }
  if (sevenDayProviderCalled || Date.now() - sevenDayStartedAt > 800 || !sevenDayFallback.qualityFlags.includes("deterministic_plan_used")) {
    failures.push("信息完整的7天获客计划应即时使用事实型规划器，不能继续等待慢模型");
  }
  let franchisePlannerCalled = false;
  const franchiseClarification = await runAgent({
    ...baseRequest,
    capabilityId: "franchise_acquisition",
    input: "鲁蒙肉饼连锁品牌 快餐招商加盟 写一条招商加盟文案"
  }, {
    name: "franchise-acquisition-clarification",
    async complete() {
      franchisePlannerCalled = true;
      throw new Error("force_franchise_planner_fallback");
    }
  });
  if (
    franchisePlannerCalled ||
    franchiseClarification.analysisMode !== "deep" ||
    !franchiseClarification.qualityFlags.includes("franchise_clarification_used") ||
    !["深度事实梳理", "品牌：鲁蒙肉饼", "品类：快餐", "目标加盟商", "真实证据", "承接动作", "不重复追问"].every((term) => franchiseClarification.answer.includes(term)) ||
    /短视频招商获客文案 · 完整输出|口播逐字稿|剪辑EDL/.test(franchiseClarification.answer)
  ) {
    failures.push(`招商加盟信息不全时必须先深度梳理、保留鲁蒙肉饼品牌并一次性追问，不能快速生成占位文案：${franchiseClarification.answer.slice(0, 480)}`);
  }

  const genericFranchiseStarter = await runAgent({
    ...baseRequest,
    capabilityId: "franchise_acquisition",
    input: "给我做一套招商加盟短视频文案，按SCALE逻辑输出。",
    tenantProfile: {
      ...baseRequest.tenantProfile,
      industry: "IP+AI行业",
      city: "大连",
      data: {
        offer: "给品牌创始人做IP打造，给企业做AI改造",
        customer: "企业客户、连锁品牌客户"
      }
    }
  }, {
    name: "generic-franchise-subject-boundary",
    async complete() { throw new Error("generic_franchise_should_clarify"); }
  });
  if (
    genericFranchiseStarter.analysisMode !== "deep" ||
    !["品牌/项目名", "行业或品类", "目标加盟商", "真实证据", "承接动作"].every((term) => genericFranchiseStarter.answer.includes(term)) ||
    /餐饮|出餐|夫妻店|附近食客|门店产品|待确认品牌/.test(genericFranchiseStarter.answer)
  ) {
    failures.push(`未提供招商项目主体和行业时，必须保持账户身份边界并追问，不能默认餐饮连锁或输出占位文案：${genericFranchiseStarter.answer.slice(0, 480)}`);
  }

  const completeFranchise = await runAgent({
    ...baseRequest,
    capabilityId: "franchise_acquisition",
    input: "鲁蒙肉饼连锁品牌，快餐招商加盟，目标加盟商是有餐饮经验、准备开店的创业者，现有3家直营店和标准化供应链，希望对方私信‘加盟’领取资料包。写一条招商加盟短视频文案。"
  }, {
    name: "complete-franchise-grounding",
    async complete() { throw new Error("force_complete_franchise_fallback"); }
  });
  if (
    completeFranchise.analysisMode !== "deep" ||
    !completeFranchise.answer.includes("| 品牌名 | 鲁蒙肉饼 |") ||
    completeFranchise.answer.includes("| 品牌名 | 快餐招商加盟 写一条招商加盟文案 |") ||
    !["品牌信息", "一、选题策划", "二、口播逐字稿", "九、投流建议"].every((term) => completeFranchise.answer.includes(term))
  ) {
    failures.push(`信息完整的招商任务必须深度输出并锁定用户原文品牌“鲁蒙肉饼”：${completeFranchise.answer.slice(0, 480)}`);
  }
  const placeholderFranchise = await runAgent({
    ...baseRequest,
    requestedSkillId: "baolu_content_creator",
    capabilityId: "franchise_acquisition",
    deliveryPolicy: "draft_with_placeholders",
    input: "给东北味道连锁做招商短视频、加盟线索筛选和考察承接方案。加盟费、总投资、回本周期、毛利、扶持政策和成功案例都没提供。老板要求写30天回本、稳赚不赔、300家盈利门店；必须拒绝并用【待补】替代。输出完整逐字稿、线索分级问题和下一步考察动作。"
  }, {
    name: "franchise-draft-with-placeholders",
    async complete() { throw new Error("force_franchise_placeholder_fallback"); }
  });
  if (
    !["短视频招商获客文案 · 完整输出", "【待补】", "口播逐字稿", "线索", "考察"].every((term) => placeholderFranchise.answer.includes(term)) ||
    /这是招商加盟内容，需要先做深度事实梳理|30天回本|稳赚不赔|300家盈利门店/.test(placeholderFranchise.answer)
  ) {
    failures.push(`招商资料缺失时必须拒绝虚假承诺并先给【待补】初稿，不能只追问：${placeholderFranchise.answer.slice(0, 560)}`);
  }

  const fastFoodContent = await runAgent({
    ...baseRequest,
    input: "我是杭州中式快餐品牌，主推25元工作日午餐套餐，目标客户是附近写字楼上班族，想通过抖音团购到店核销。请给完整30秒内容执行包。"
  }, {
    name: "fast-food-content-fallback",
    async complete() {
      throw new Error("force_fast_food_content_fallback");
    }
  });
  if (
    !["中式快餐品牌", "25元工作日午餐套餐", "附近上班族", "团购下单/到店核销", "完整内容执行包", "剪辑EDL"].every((term) => fastFoodContent.answer.includes(term)) ||
    /附近想解决这个问题|如果你正在找中式快餐品牌，先别只看价格/.test(fastFoodContent.answer)
  ) {
    failures.push("中式快餐内容文案必须保留价格、午餐、上班族和核销事实，不能退回通用服务模板");
  }
  const hostileTakeawayContent = await runAgent({
    ...baseRequest,
    deliveryPolicy: "draft_with_placeholders",
    input: "给东北味道连锁写3条60秒抖音短视频完整成品。产品是东北菜家庭聚餐与夜宵外卖；咨询入口是用户到美团真实菜单下单；目标客户是沈阳25-45岁家庭聚餐和夜宵顾客。价格、优惠、菜品和地址未知，用【待补】；拒绝全国第一、吃一次年轻十岁和保证排队等无法证明的表达。"
  }, {
    name: "hostile-takeaway-multi-script-fallback",
    async complete() {
      throw new Error("force_hostile_takeaway_fallback");
    }
  });
  if (
    !["3条60秒短视频完整成品", "第1条", "第2条", "第3条", "口播逐字稿", "分镜", "字幕", "【待补】", "美团", "真实外卖平台"].every((term) => hostileTakeawayContent.answer.includes(term)) ||
    /正在考虑和加盟有效线索不足|这件事到底解决什么问题|到店核销/.test(hostileTakeawayContent.answer)
  ) {
    failures.push(`外卖多条成品兜底必须按数量完整交付，不能串入招商、通用咨询或堂食核销模板：${hostileTakeawayContent.answer.slice(0, 480)}`);
  }
  const acquisitionBoundaryContent = await runAgent({
    ...baseRequest,
    deliveryPolicy: "draft_with_placeholders",
    input: "枕水江南是中式快餐品牌，请做3条抖音短视频内容，给选题、口播逐字稿、分镜、发布标题和评论区承接。只做内容，不分析外卖平台。"
  }, {
    name: "acquisition-boundary-content-completeness",
    async complete() { throw new Error("force_acquisition_boundary_fallback"); }
  });
  if (
    !["枕水江南", "第1条", "第2条", "第3条", "选题", "口播逐字稿", "分镜", "发布标题", "评论区承接"].every((term) => acquisitionBoundaryContent.answer.includes(term)) ||
    /美团|饿了么|淘宝闪购|真实外卖平台|配送范围|菜单下单/.test(acquisitionBoundaryContent.answer)
  ) {
    failures.push(`获客智能体的餐饮品牌内容必须保留品牌并补齐用户点名交付件，同时不得越界到外卖经营：${acquisitionBoundaryContent.answer.slice(0, 560)}`);
  }
  const compoundContentInput = "同一轮先写一条合规的东北菜家庭聚餐短视频完整成品，再给500元DOU+小额投流测试方案。价格和优惠未知用【待补】，投流只给建议，不操作账户。";
  const compoundContentDraft = await runAgent({
    ...baseRequest,
    capabilityId: "content_plan",
    deliveryPolicy: "draft_with_placeholders",
    input: compoundContentInput
  }, {
    name: "compound-content-quality-fallback",
    async complete() { return "这里是一条东北菜短视频。"; }
  });
  if (
    !["口播", "拍摄", "标题", "评论区", "【待补】"].every((term) => compoundContentDraft.answer.includes(term))
  ) {
    failures.push(`联合任务中的内容步骤不完整时必须自动回退为可交付成品：${compoundContentDraft.answer.slice(0, 560)}`);
  }
  const compoundTrafficDraft = await runAgent({
    ...baseRequest,
    capabilityId: "paid_traffic",
    deliveryPolicy: "draft_with_placeholders",
    input: compoundContentInput
  }, {
    name: "compound-paid-traffic-quality-fallback",
    async complete() { return "可以投流。"; }
  });
  if (
    !["投流判断", "DOU+", "500元", "预算", "止损条件", "【待补】"].every((term) => compoundTrafficDraft.answer.includes(term))
  ) {
    failures.push(`联合任务中的投流步骤必须保留已知预算，并把未知事实统一写为【待补】：${compoundTrafficDraft.answer.slice(0, 560)}`);
  }
  const incompleteContentPlanRequest = {
    ...baseRequest,
    input: "我刚开了一家健康管理工作室，想用抖音获客，你能帮我做内容计划吗？"
  };
  let clarificationProviderCalled = false;
  const clarificationStartedAt = Date.now();
  const clarification = await runAgent(incompleteContentPlanRequest, {
    name: "clarification-fast-path",
    async complete() {
      clarificationProviderCalled = true;
      throw new Error("incomplete_content_plan_should_not_call_provider");
    }
  });
  if (
    !["主推产品/服务", "咨询入口或产品形式", "第一批目标客户", "按序号回复即可"].every((term) => clarification.answer.includes(term)) ||
    clarificationProviderCalled ||
    Date.now() - clarificationStartedAt > 800 ||
    !clarification.qualityFlags.includes("clarification_fast_path_used") ||
    clarification.qualityFlags.some((flag) => /too_short|missing_contract_terms|rubric_/.test(flag))
  ) {
    failures.push("信息不足的内容方案应即时追问关键经营信息，且不应被完整方案质检误判");
  }
  let completedClarificationProviderCalled = false;
  await runAgent({
    ...incompleteContentPlanRequest,
    input: "主推减重塑形，199元体验，面向久坐上班族。",
    history: [
      { role: "user", content: incompleteContentPlanRequest.input },
      { role: "assistant", content: clarification.answer }
    ]
  }, {
    name: "completed-clarification",
    async complete() {
      completedClarificationProviderCalled = true;
      return [
        "完整内容执行包", "短结论", "选题：久坐上班族的减重塑形误区", "文案：199元体验先了解真实服务范围。",
        "拍摄脚本：开头3秒展示久坐场景。", "拍摄注意事项：只使用真实服务画面。", "剪辑EDL：0到3秒提出问题。",
        "发布标题话题：久坐上班族怎么开始减重塑形", "发布时间：工作日午休后", "评论区引导话术：回复体验了解199元安排。", "投流建议：先观察私信咨询和到店预约。"
      ].join("\n");
    }
  });
  if (!completedClarificationProviderCalled) {
    failures.push("用户补齐信息后不应继续停留在澄清分支，应进入完整方案生成");
  }
  let enterpriseAiReplyProviderCalled = false;
  await runAgent({
    ...incompleteContentPlanRequest,
    input: "AI企业改造，给企业做AI改造。",
    history: [
      { role: "user", content: "请根据这个选题和我的身份目的创作文案。" },
      { role: "assistant", content: "还需要补充咨询入口或产品形式。" },
      { role: "user", content: "免费咨询。" },
      { role: "assistant", content: "还需要补充主推产品/服务。" }
    ]
  }, {
    name: "enterprise-ai-clarification-completed",
    async complete() {
      enterpriseAiReplyProviderCalled = true;
      return [
        "完整内容执行包", "短结论", "选题：企业AI改造先从业务流程开始", "文案：给企业做AI改造，不是先买工具，而是先找到可验收的流程。",
        "拍摄脚本：开头3秒提出企业AI改造误区。", "拍摄注意事项：只使用真实企业服务经验。", "剪辑EDL：0到3秒提出问题。",
        "发布标题话题：企业AI改造为什么不能先买工具", "发布时间：工作日上午", "评论区引导话术：回复改造领取免费咨询入口。", "投流建议：先观察企业主私信咨询。"
      ].join("\n");
    }
  });
  if (!enterpriseAiReplyProviderCalled) {
    failures.push("用户已说明AI企业改造、企业客户和免费咨询后，不得重复追问主推产品或目标客户");
  }
  const enterpriseAiFallback = await runAgent({
    ...incompleteContentPlanRequest,
    input: "AI企业改造，给企业做AI改造，入口是免费咨询。请直接根据上面的APEC选题生成文案，不要再问已经回答过的信息。",
    history: [
      { role: "user", content: "客户会问：APEC人工智能高级别论坛关于促进亚太地区人工智能发展的声明和我的业务有什么关系，是真机会还是只适合大企业？根据这个选题和我的身份目的创作文案。" },
      { role: "assistant", content: "请补充咨询入口。" },
      { role: "user", content: "免费咨询。" }
    ]
  }, {
    name: "enterprise-ai-grounded-fallback",
    async complete() {
      throw new Error("force_enterprise_ai_fallback");
    }
  });
  if (
    !["APEC", "中小企业", "企业AI改造", "免费初步诊断"].every((term) => enterpriseAiFallback.answer.includes(term)) ||
    /杭州附近|门头只露|门店周边3公里|有人问地址|预约到店/.test(enterpriseAiFallback.answer)
  ) {
    failures.push("企业AI改造兜底文案必须承接前文APEC选题，不能混入本地门店到店模板");
  }
  let genericSevenDayProviderCalled = false;
  const genericSevenDay = await runAgent({
    ...baseRequest,
    input: "主推减重塑形，199元体验，目标客户是久坐上班族。请给我未来7天的抖音和朋友圈获客计划：每天发什么、怎么承接私信。"
  }, {
    name: "generic-seven-day-fallback",
    async complete() {
      genericSevenDayProviderCalled = true;
      throw new Error("complete_generic_seven_day_should_not_call_provider");
    }
  });
  if (
    genericSevenDayProviderCalled ||
    !["减重塑形", "199元体验", "上班族", "第1天", "第7天"].every((term) => genericSevenDay.answer.includes(term)) ||
    /你的业务|主推产品\/服务/.test(genericSevenDay.answer)
  ) {
    failures.push("用户补齐主推服务、价格和目标客户后，7天计划必须保留事实且不得回退到泛化占位");
  }
  const cityBusinessPlan = await runAgent({
    ...baseRequest,
    input: "我是苏州一家宠物洗护店，主推99元新客洗护体验，目标客户是3公里内养猫狗的上班族。请给我未来7天的抖音和朋友圈获客计划：每天发什么、怎么承接优惠、私信跟进怎么说。"
  }, {
    name: "city-business-dedup",
    async complete() {
      throw new Error("city_business_seven_day_should_not_call_provider");
    }
  });
  if (
    !["苏州", "宠物洗护店", "99元", "养猫狗", "第1天", "第7天"].every((term) => cityBusinessPlan.answer.includes(term)) ||
    /苏州苏州|苏州一家宠物洗护店/.test(cityBusinessPlan.answer)
  ) {
    failures.push(`城市和门店名称必须去重，不能出现“苏州苏州一家宠物洗护店”一类重复表述：${cityBusinessPlan.answer.slice(0, 320)}`);
  }
  const repeatedQuestion = await runAgent(postnatalRequest, {
    name: "repeated-question-provider",
    async complete() {
      return "完整内容执行包\n先确认一下：你在哪个区？老板是否出镜？之前哪条视频播放最好？";
    }
  });
  if (!repeatedQuestion.answer.includes("第1天") || !repeatedQuestion.answer.includes("第7天")) {
    failures.push("已知信息足够的7天计划不能停在重复追问，必须降级为事实型执行计划");
  }
  const unrelatedTemplateProvider = {
    name: "unrelated-template",
    async complete() {
      return [
        "完整内容执行包",
        "一、选题\n老板别急着上AI，先看企业改造。",
        "二、可直接发布的文案\n你的业务可以这样做。",
        "三、拍摄脚本\n通用镜头。",
        "四、拍摄注意事项\n通用注意事项。",
        "五、剪辑EDL\n通用节奏。",
        "六、发布标题话题\n通用标题。",
        "七、发布时间\n通用时间。",
        "八、评论区引导话术\n通用回复。",
        "九、投流建议\n通用建议。"
      ].join("\n")
    }
  };
  const grounded = await runAgent(postnatalRequest, unrelatedTemplateProvider);
  if (!/产后修复|盆底修复/.test(grounded.answer) || !grounded.answer.includes("上海") || /AI改造|老板别急着上AI|你的业务/.test(grounded.answer)) {
    failures.push("业务锚点保护没有拦截跨行业模板输出");
  }

  const unsupportedHotspotProvider = {
    name: "unsupported-hotspot",
    async complete() {
      return [
        "行业热点方案", "短结论", "近期产后修复进入旺季。", "行业热点速览", "热点咨询", "热点来源/线索", "热点判断", "IP获客机会", "可蹭选题", "短视频切入", "朋友圈切入", "直播切入", "风险提醒", "今日动作"
      ].join("\n")
    }
  };
  const hotspot = await runAgent({
    ...postnatalRequest,
    requestedSkillId: "ai_daily_brief",
    capabilityId: "industry_hotspots",
    input: "我是上海一家产后修复工作室，主推1980元盆底修复套餐，想了解近期行业热点。"
  }, unsupportedHotspotProvider);
  if (!hotspot.answer.includes("未提供可核验") || /AI改造|企业改造|近期产后修复进入旺季/.test(hotspot.answer)) {
    failures.push("无公开来源的行业热点没有降级为待验证方向");
  }

  const hotspotDrivenContent = await runAgent({
    ...baseRequest,
    tenantProfile: {
      tenantId: "demo-tenant",
      tenantName: "思潼企业AI改造",
      tenantType: "chain_brand" as const,
      industry: "AI企业改造",
      city: "大连",
      data: { offer: "企业AI改造咨询与落地", customer: "中小企业老板" }
    },
    capabilityId: "content_plan",
    input: [
      "【公开线索上下文：行业热点】",
      "抓取关键词：AI企业改造",
      "检索日期：2026-07-27（北京时间）",
      "可用公开线索：",
      "1. 企业AI改造是一把手工程｜发布日期：2026-07-24｜来源：测试媒体｜https://example.cn/article",
      "【热点驱动内容创作任务】",
      "用户这次补充：结合最近AI企业改造行业热点，给我3个今天能用的获客选题，并选1个按内容Skill十件套写出60-90秒完整口播文案。"
    ].join("\n")
  }, {
    name: "hotspot-content-fallback",
    async complete() { throw new Error("force_hotspot_content_fallback"); }
  });
  if (
    !["热点雷达与来源", "3. AI项目", "口播逐字稿（约75秒", "三、拍摄脚本", "五、剪辑EDL", "九、投流建议", "2026-07-24"].every((term) => hotspotDrivenContent.answer.includes(term)) ||
    hotspotDrivenContent.answer.includes("4. 中小企业") ||
    /北京附近|门头只露|到店核销|附近的人今天为什么要行动/.test(hotspotDrivenContent.answer)
  ) {
    failures.push(`热点驱动内容在模型失败时仍必须遵守用户要求的3个选题，并输出有来源、长口播和完整十件套：${hotspotDrivenContent.answer.slice(0, 420)}`);
  }

  const hotspotTranscriptOnly = await runAgent({
    ...baseRequest,
    tenantProfile: {
      tenantId: "demo-tenant",
      tenantName: "保禄AI企业重构",
      tenantType: "personal_ip" as const,
      industry: "AI行业",
      city: "大连",
      data: { offer: "企业AI重构服务", customer: "中小企业老板" }
    },
    capabilityId: "content_plan",
    input: [
      "【公开线索上下文：行业热点】",
      "抓取关键词：AI行业",
      "检索日期：2026-08-03（北京时间）",
      "可用公开线索：",
      "1. Kimi K3开源上线｜发布日期：2026-07-27｜来源：测试媒体｜https://example.cn/ai",
      "【热点驱动内容创作任务】",
      "用户这次补充：行业：AI行业。请联网分析近期行业机会，给我3个今天能用的获客选题，并把最值得拍的1个写成完整逐字稿。"
    ].join("\n")
  }, {
    name: "hotspot-transcript-only-fallback",
    async complete() { throw new Error("force_hotspot_transcript_fallback"); }
  });
  if (
    !["3个今天能用的获客选题", "3. AI项目", "最值得拍的选题与选择理由", "选择理由", "完整口播逐字稿", "2026-07-27"].every((term) => hotspotTranscriptOnly.answer.includes(term)) ||
    /(?:^|\n)\s*(?:三、|四、|五、|六、|七、|八、|九、)?(?:拍摄脚本|拍摄注意事项|剪辑EDL|发布标题|评论区引导|投流建议)/m.test(hotspotTranscriptOnly.answer)
  ) {
    failures.push(`热点加逐字稿的限定任务必须只交付3个选题、选择理由和完整逐字稿：${hotspotTranscriptOnly.answer.slice(0, 520)}`);
  }

  const paidMediaTerminology = await runAgent({
    ...baseRequest,
    capabilityId: "content_plan",
    input: "帮我做投流建议，只要投流方案。"
  }, {
    name: "incorrect-local-push-terminology",
    async complete() {
      return "第一，你主要做本地企业的生意，还是全国都能接？这决定了内容是以本地推为主，还是全国DOU+为主。";
    }
  });
  if (/本地企业.{0,30}全国都能接.{0,30}本地推.{0,30}全国DOU\+/.test(paidMediaTerminology.answer)) {
    failures.push("投流回答不得把本地推误解成只能投本地，也不得把本地/全国机械对应本地推/DOU+");
  }

  const savedProfileRequest = {
    ...baseRequest,
    tenantProfile: {
      tenantId: "demo-tenant",
      tenantName: "知味中式快餐",
      tenantType: "chain_brand" as const,
      industry: "中式快餐连锁",
      city: "杭州",
      data: {
        offer: "25元工作日午餐套餐",
        customer: "附近写字楼上班族"
      }
    }
  };
  const directMoments = await runAgent({
    ...savedProfileRequest,
    requestedSkillId: "moments_generator",
    capabilityId: "private_domain",
    input: "写个朋友圈文案，今天直接发。"
  }, {
    name: "saved-profile-moments",
    async complete() { throw new Error("force_saved_profile_moments_fallback"); }
  });
  if (
    !["中式快餐", "25元工作日午餐套餐", "附近写字楼上班族", "可直接发布的朋友圈"].every((term) => directMoments.answer.includes(term)) ||
    /请补充|我是做什么|主推服务\/项目/.test(directMoments.answer)
  ) {
    failures.push(`企业资料完整时，朋友圈请求必须直接生成可发布文案，不能再次追问行业、产品和客户：${directMoments.answer.slice(0, 320)}`);
  }
  const privacyBoundaryMoments = await runAgent({
    ...savedProfileRequest,
    tenantProfile: {
      ...savedProfileRequest.tenantProfile,
      tenantName: "东北味道连锁",
      data: { offer: "32家门店加盟项目", customer: "餐饮加盟意向人群" }
    },
    requestedSkillId: "moments_generator",
    capabilityId: "private_domain",
    input: "写3条朋友圈和私聊承接流程，把看过东北味道视频的顾客引导到美团搜索和门店咨询。不能索取身份证、银行卡、通讯录，不能群发骚扰。请区分首次私聊、已读不回、问价格、投诉顾客四种情况，并给退出机制。"
  }, {
    name: "private-domain-privacy-boundary",
    async complete() { throw new Error("force_private_privacy_fallback"); }
  });
  if (
    !["3条可直接发布的朋友圈", "首次私聊", "已读不回", "问价格", "投诉顾客", "退出机制", "美团", "身份证", "银行卡", "通讯录"].every((term) => privacyBoundaryMoments.answer.includes(term)) ||
    /招商7天|加盟费|投资回收期|门店考察/.test(privacyBoundaryMoments.answer)
  ) {
    failures.push(`私域承接必须服从本轮顾客场景和隐私边界，不能被企业画像劫持成招商方案：${privacyBoundaryMoments.answer.slice(0, 620)}`);
  }

  const directContent = await runAgent({
    ...savedProfileRequest,
    capabilityId: "content_plan",
    input: "帮我做今天的内容文案。"
  }, {
    name: "saved-profile-content",
    async complete() { throw new Error("force_saved_profile_content_fallback"); }
  });
  if (
    !["中式快餐", "25元工作日午餐套餐", "附近写字楼上班族", "选题", "剪辑EDL", "投流建议"].every((term) => directContent.answer.includes(term)) ||
    /为了下一条直接给你|请补充/.test(directContent.answer)
  ) {
    failures.push(`企业资料完整时，内容文案请求必须直接按完整内容执行包输出，不能重复收集资料：${directContent.answer.slice(0, 420)}`);
  }

  let fullCopyProviderCalls = 0;
  const longSpokenBody = [
    "很多企业老板第一次做AI改造，会先问应该买哪个工具，但真正决定项目能不能落地的，不是工具清单，而是有没有选对第一个业务闭环。",
    "比如获客团队每天都在做选题、写脚本、发布内容和承接私信，这条流程频率高、结果可记录，也最适合先做小范围验证。",
    "第一步先把现在的人工流程画出来，找到重复耗时和最容易出错的位置；第二步明确一个业务负责人，不要把项目只交给技术人员；第三步约定验收指标，看周期有没有缩短、错误有没有下降、有效咨询有没有增加。",
    "先用两到四周跑通一个闭环，结果达标再复制到更多账号、门店和岗位。这样做不是保守，而是让每一笔投入都能对应到真实经营结果。",
    "如果你正在考虑企业AI改造，可以把企业规模、当前最耗时间的一条流程和想改善的指标发给我，我先帮你判断第一步应该从哪里开始。"
  ].join("");
  const repairedFullCopy = await runAgent({
    ...savedProfileRequest,
    tenantProfile: {
      ...savedProfileRequest.tenantProfile,
      tenantName: "思潼企业AI服务",
      industry: "企业AI改造",
      data: {
        offer: "企业AI改造咨询与智能体落地",
        customer: "希望用AI提升获客和经营效率的企业老板"
      }
    },
    capabilityId: "content_plan",
    input: "请把这个选题写成完整短视频文案：企业做AI改造，最先买的不是工具。"
  }, {
    name: "full-spoken-copy-repair",
    async complete() {
      fullCopyProviderCalls += 1;
      if (fullCopyProviderCalls === 1) return "可直接发布的文案\n企业做AI改造，最先买的不是工具。";
      return [
        "口播逐字稿（约60-90秒）",
        longSpokenBody,
        "",
        "可直接拍摄的脚本",
        "正面近景完成口播，关键步骤用字幕强调，结尾保留私信承接动作。"
      ].join("\n");
    }
  });
  if (
    !/口播逐字稿（约60-(?:75|90)秒/.test(repairedFullCopy.answer) ||
    repairedFullCopy.answer.replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, "").length < 300 ||
    repairedFullCopy.qualityFlags.includes("rubric_spoken_copy_too_short")
  ) {
    failures.push(`完整逐字稿过短时必须通过单次结构化生成或安全兜底交付60-90秒成稿：calls=${fullCopyProviderCalls}；${repairedFullCopy.answer.slice(0, 240)}`);
  }

  const fullCopyFallback = await runAgent({
    ...savedProfileRequest,
    tenantProfile: {
      ...savedProfileRequest.tenantProfile,
      tenantName: "思潼企业AI服务",
      industry: "企业AI改造",
      data: {
        offer: "企业AI改造咨询与智能体落地",
        customer: "希望用AI提升获客和经营效率的企业老板"
      }
    },
    capabilityId: "content_plan",
    input: "只要可直接发布的文案，给我完整逐字稿。"
  }, {
    name: "full-spoken-copy-fallback",
    async complete() { throw new Error("force_full_copy_fallback"); }
  });
  if (
    !/口播逐字稿（约60-75秒/.test(fullCopyFallback.answer) ||
    fullCopyFallback.answer.replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, "").length < 300
  ) {
    failures.push(`模型不可用时，完整文案兜底也必须返回可照读逐字稿：${fullCopyFallback.answer.slice(0, 240)}`);
  }

  let selectedTopicPackageCalls = 0;
  const selectedTopicPackage = await runAgent({
    ...savedProfileRequest,
    tenantProfile: {
      ...savedProfileRequest.tenantProfile,
      tenantName: "思潼企业AI服务",
      industry: "企业AI改造",
      data: {
        offer: "企业AI改造咨询与智能体落地",
        customer: "希望用AI提升获客和经营效率的企业老板"
      }
    },
    capabilityId: "content_plan",
    input: "选择一个选题继续写文案：企业做AI改造，最先买的不是工具。"
  }, {
    name: "selected-topic-complete-package-repair",
    async complete() {
      selectedTopicPackageCalls += 1;
      if (selectedTopicPackageCalls === 1) return `口播逐字稿\n${longSpokenBody}`;
      return [
        "完整内容执行包",
        "短结论：围绕企业AI改造先跑通业务闭环建立专业信任，并承接企业诊断咨询。",
        "一、选题策划",
        "企业做AI改造，最先买的不是工具，而是一个能验收的业务闭环。",
        "二、口播逐字稿（约60-90秒）",
        longSpokenBody,
        "三、拍摄脚本",
        "0至3秒正面近景抛出反常识结论；3至45秒用流程图配合口播；45至75秒回到正面近景完成承接。",
        "四、拍摄注意事项",
        "只展示真实工作流程，不展示未经授权的客户信息；字幕突出业务闭环、负责人和验收指标。",
        "五、剪辑EDL",
        "0至3秒保留钩子并放大字幕；3至25秒插入流程画面；25至60秒三步法卡点切换；结尾保留咨询提示。",
        "六、发布标题与话题",
        "标题：企业AI改造第一步，为什么不是买工具；话题：#企业AI改造 #AI落地 #经营提效。",
        "七、发布时间",
        "工作日12:00或20:30先自然发布，根据目标客户在线数据复盘后调整。",
        "八、评论区引导话术",
        "置顶评论：你公司最想先改造哪一条高频流程？留言行业和卡点，我帮你判断从哪里开始。",
        "九、投流建议",
        "先自然跑24小时，观察3秒停留、完播率、主页访问和有效咨询；数据达标后再小额测试企业主及业务负责人定向。"
      ].join("\n");
    }
  });
  if (
    ![
      /完整内容执行包/, /选题(?:策划)?/, /口播逐字稿/, /拍摄脚本/, /拍摄注意事项/, /剪辑EDL/,
      /发布标题(?:与)?话题/, /发布时间/, /评论区引导话术/, /投流建议/
    ].every((pattern) => pattern.test(selectedTopicPackage.answer))
  ) {
    failures.push(`选中选题继续创作时必须自动返工为完整内容执行包，不能只交付逐字稿：calls=${selectedTopicPackageCalls}；${selectedTopicPackage.answer.slice(0, 320)}`);
  }

  const externalClientRequest = {
    ...savedProfileRequest,
    tenantProfile: {
      ...savedProfileRequest.tenantProfile,
      tenantName: "思潼IP与AI服务",
      industry: "IP打造与企业AI",
      data: {
        offer: "IP打造、AI应用和企业AI落地服务",
        customer: "需要IP与AI服务的企业老板"
      }
    },
    capabilityId: "content_plan",
    input: "请帮我的客户“东北家味牛肉汤连锁”写一套招商加盟完整内容执行包。内容主体是客户品牌，目标是招募加盟商并预约考察；门店数和投资政策没有给的都写待补。"
  };
  const externalClientMessages = await buildAgentMessages(externalClientRequest);
  if (!externalClientMessages.messages[0]?.content.includes("企业画像描述的是谁在使用系统") || !externalClientMessages.messages[0]?.content.includes("本轮明确要求与内容主体")) {
    failures.push("内容创作系统提示必须明确区分系统使用方身份与本轮客户项目主体，并以本轮目的优先");
  }
  let externalClientProviderCalls = 0;
  const externalClientContent = await runAgent(externalClientRequest, {
    name: "external-client-content-subject-repair",
    async complete() {
      externalClientProviderCalls += 1;
      throw new Error("external_client_missing_proof_should_clarify");
    }
  });
  if (
    externalClientProviderCalls !== 0 ||
    externalClientContent.analysisMode !== "deep" ||
    !externalClientContent.answer.includes("品牌：东北家味牛肉汤连锁") ||
    !externalClientContent.answer.includes("品类：牛肉汤") ||
    !externalClientContent.answer.includes("真实证据") ||
    /推广思潼自己的IP|欢迎私信我咨询IP与AI|需要IP诊断或企业AI改造|完整内容执行包/.test(externalClientContent.answer)
  ) {
    failures.push(`替客户创作时必须以客户项目为准；缺真实证据应深度追问，不能被使用方IP/AI画像劫持：calls=${externalClientProviderCalls}；${externalClientContent.answer.slice(0, 360)}`);
  }

const noFaceResistance = await runAgent(
  {
    tenantId: "demo-tenant",
    userId: "demo-user",
    role: "owner",
    planCode: "local_standard",
    requestedSkillId: "baolu_content_creator",
    capabilityId: "content_plan",
    input:
      "我开的是一家烤肉店，线下客源不稳定，想做短视频获客。但我不想拍视频、也不敢出镜，员工也不愿意露脸，对着镜头就说不出话。你别给我空泛鼓励，直接告诉我怎么做。",
    tenantProfile: {
      tenantId: "demo-tenant",
      tenantName: "大连烤肉店",
      tenantType: "local_business",
      industry: "餐饮",
      city: "大连"
    },
    channel: "h5"
  },
  {
    name: "workbuddy-no-face-resistance",
    async complete() {
      throw new Error("force_workbuddy_no_face_fallback");
    }
  }
);

const noFaceRequiredTerms = ["三种不露脸方案", "方案一", "方案二", "方案三", "今天就做 3 件事", "下一步"];
if (!noFaceRequiredTerms.every((term) => noFaceResistance.answer.includes(term))) {
  failures.push("WorkBuddy第2项：不出镜抗拒场景缺少可执行的不露脸方案或下一步。");
}

const startedAt = Date.now();
  const timedOut = await runAgent({ ...postnatalRequest, capabilityId: undefined }, {
    name: "slow-provider",
    async complete() {
      return await new Promise<string>(() => undefined);
    }
  });
  if (Date.now() - startedAt > 800 || !/产后修复|盆底修复/.test(timedOut.answer) || !timedOut.qualityFlags.includes("provider_fallback_used")) {
    failures.push("所有Agent请求都应在超时后快速返回安全兜底结果");
  }

  if (failures.length > 0) {
    failures.forEach((failure) => console.error(`- ${failure}`));
    process.exit(1);
  }
  console.log("Agent input smoke passed: document extraction, adaptive analysis and conversation history are valid.");
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});

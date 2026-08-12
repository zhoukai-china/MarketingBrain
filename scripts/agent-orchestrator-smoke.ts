import assert from "node:assert/strict";
import {
  buildExecutionPlan,
  combineExecutionResults,
  executeExecutionPlan,
  type ExecutionStep
} from "../apps/api/src/services/agent-orchestrator.js";
import type { SkillRuntimeResult } from "../apps/api/src/services/agent-runtime.js";
import { runAgent } from "../packages/agent/src/index.js";
import { inferSalesCapabilities } from "../packages/shared/src/index.js";
import { extractIndustryQuery } from "../apps/api/src/routes/chat.js";

function resultFor(step: ExecutionStep, answerText: string): SkillRuntimeResult {
  return {
    status: "success",
    deliveryStatus: "completed",
    mcpCallId: `mcp-${step.stepId}`,
    agentId: "agent_acquisition",
    skillId: step.skillId,
    capabilityId: step.capabilityId,
    skillVersion: step.skillVersion,
    answerText,
    structuredBlocks: [{ type: "markdown", content: answerText }],
    nextActions: [`继续${step.title}`],
    artifacts: [],
    creditCost: 2,
    qualityFlags: [],
    analysisMode: step.capabilityId === "content_plan" ? "deep" : "fast",
    traceId: step.stepId
  };
}

async function main(): Promise<void> {
  assert.equal(
    extractIndustryQuery("行业：中式快餐外卖连锁。\n1. 结合近期中式快餐和外卖行业热点提出增长主题"),
    "中式快餐外卖连锁"
  );
  assert.deepEqual(
    inferSalesCapabilities("同时做客户诊断、回复客户说太贵的异议，并给下一步跟单计划"),
    ["objection_reply", "follow_up_plan", "customer_diagnosis"]
  );
  const sequentialPlan = buildExecutionPlan("plan-sequential", [
    { capabilityId: "industry_hotspots", title: "行业热点", skillId: "ai_daily_brief", skillVersion: "1.0.0" },
    { capabilityId: "content_plan", title: "内容文案", skillId: "baolu_content_creator", skillVersion: "4.1.4" }
  ]);
  assert.equal(sequentialPlan.mode, "sequential");
  assert.deepEqual(sequentialPlan.steps[1].dependsOn, ["step-industry_hotspots"]);
  const callOrder: string[] = [];
  const sequential = await executeExecutionPlan({
    plan: sequentialPlan,
    buildInput: (step, upstream) => [step.title, ...upstream.map((item) => item.answerMarkdown)].join("\n"),
    invoke: async (step, input) => {
      callOrder.push(step.capabilityId);
      if (step.capabilityId === "content_plan") assert.match(input, /热点分析完成/);
      return resultFor(
        step,
        step.capabilityId === "industry_hotspots"
          ? "热点分析完成"
          : "7天内容成品：口播逐字稿、拍摄分镜、发布标题、评论区承接和复盘指标均已完成"
      );
    }
  });
  assert.deepEqual(callOrder, ["industry_hotspots", "content_plan"]);
  const sequentialCombined = combineExecutionResults(sequential);
  assert.match(sequentialCombined.answerText, /完整增长执行包/);
  assert.match(sequentialCombined.answerText, /行业热点/);
  assert.match(sequentialCombined.answerText, /内容文案/);
  assert.doesNotMatch(sequentialCombined.answerText, /使用前置分析结果|执行与交付顺序/);
  assert.equal(sequentialCombined.creditCost, 4);
  assert.equal(sequentialCombined.analysisMode, "deep");

  const hotspotTranscriptRequest = "行业：AI行业。请联网分析近期行业机会，给我3个今天能用的获客选题，并把最值得拍的1个写成完整逐字稿。";
  const hotspotTranscriptPlan = buildExecutionPlan("plan-hotspot-transcript", [
    { capabilityId: "industry_hotspots", title: "行业热点", skillId: "ai_daily_brief", skillVersion: "1.0.0" },
    { capabilityId: "content_plan", title: "文案创作", skillId: "baolu_content_creator", skillVersion: "4.1.4" }
  ]);
  const hotspotTranscript = await executeExecutionPlan({
    plan: hotspotTranscriptPlan,
    buildInput: (step, upstream) => [
      step.title,
      ...upstream.map((item) => item.answerMarkdown),
      `用户这次补充：${hotspotTranscriptRequest}`
    ].join("\n"),
    invoke: async (step) => resultFor(
      step,
      step.capabilityId === "industry_hotspots"
        ? "近期行业机会与来源线索已核验。候选选题1：AI模型选型先看业务成本；候选选题2：中小企业如何判断AI项目真需求；候选选题3：企业AI落地为什么卡在流程而不是模型。"
        : "最值得拍的选题：AI模型选型先看业务成本。\n\n口播逐字稿\n老板选AI模型，最容易踩的坑，就是一上来先比参数。参数高不等于业务结果好，真正应该先问的是三件事：这个模型要处理哪一个具体流程，出错一次的代价有多大，接入以后谁来负责持续使用。比如同样是做客户跟进，有的企业只需要整理记录，有的企业还要判断意向、生成话术并回写系统，任务不同，成本和模型要求完全不同。我的建议是，先拿一个每天都会发生、结果能核验的小任务跑七天，再看准确率、人工节省时间和单次成本。数据过关再扩大，数据不过关就换流程或换模型。别先买一套大系统，再逼团队适应工具。真正有效的AI改造，不是模型越贵越好，而是先用最小成本跑通一个能产生结果的闭环。如果你也在选模型，先把你最想改造的一个流程写下来，再决定工具。"
    )
  });
  assert.ok(hotspotTranscript.results.every((item) => item.status === "success"));
  const hotspotTranscriptCombined = combineExecutionResults(hotspotTranscript);
  assert.equal(hotspotTranscriptCombined.deliveryStatus, "completed");
  assert.doesNotMatch(hotspotTranscriptCombined.answerText, /未通过交付质量检查|暂未生成完成/);
  assert.match(hotspotTranscriptCombined.answerText, /候选选题3/);
  assert.match(hotspotTranscriptCombined.answerText, /口播逐字稿/);

  const partialPlan = buildExecutionPlan("plan-partial", [
    { capabilityId: "live_script", title: "直播话术", skillId: "live_script_planner", skillVersion: "3.0.0" },
    { capabilityId: "private_domain", title: "朋友圈私域", skillId: "moments_generator", skillVersion: "1.0.0" }
  ]);
  assert.equal(partialPlan.mode, "parallel");
  const partial = await executeExecutionPlan({
    plan: partialPlan,
    buildInput: (step) => step.title,
    invoke: async (step) => {
      if (step.capabilityId === "private_domain") throw new Error("mcp_service_unavailable");
      return resultFor(step, "直播话术完成：开场、留人、互动、转化、收尾和下播跟进");
    }
  });
  const partialCombined = combineExecutionResults(partial);
  assert.match(partialCombined.answerText, /本轮暂未生成的模块/);
  assert.ok(partialCombined.qualityFlags.includes("partial_skill_delivery"));
  assert.equal(partialCombined.deliveryStatus, "failed");
  assert.equal(partial.results.find((item) => item.capabilityId === "private_domain")?.error?.retryable, true);

  const qualityGatePlan = buildExecutionPlan("plan-quality-gate", [
    { capabilityId: "content_plan", title: "内容文案", skillId: "baolu_content_creator", skillVersion: "4.1.4" },
    { capabilityId: "paid_traffic", title: "投流系统", skillId: "optimize_local_push_ads", skillVersion: "1.0.0" }
  ]);
  const qualityGated = await executeExecutionPlan({
    plan: qualityGatePlan,
    buildInput: (step) => `用户这次补充：同时写完整短视频并给500元投流方案\n${step.title}`,
    invoke: async (step) => resultFor(
      step,
      step.capabilityId === "content_plan"
        ? "口播逐字稿完成；拍摄分镜完成；发布标题完成；评论区承接完成。"
        : "投流建议：先用500元测试，观察数据。"
    )
  });
  assert.equal(qualityGated.results.find((item) => item.capabilityId === "content_plan")?.status, "success");
  assert.equal(qualityGated.results.find((item) => item.capabilityId === "paid_traffic")?.status, "failed");
  assert.match(qualityGated.results.find((item) => item.capabilityId === "paid_traffic")?.error?.code ?? "", /delivery_required_sections_missing/);
  const qualityGatedCombined = combineExecutionResults(qualityGated);
  assert.match(qualityGatedCombined.answerText, /本轮暂未生成的模块/);
  assert.ok(qualityGatedCombined.qualityFlags.includes("partial_skill_delivery"));

  const allQualityFailed = await executeExecutionPlan({
    plan: qualityGatePlan,
    buildInput: (step) => `用户这次补充：同时写完整短视频并给投流方案\n${step.title}`,
    invoke: async (step) => resultFor(step, "只有一句不完整的结果。")
  });
  assert.ok(allQualityFailed.results.every((item) => item.status === "failed"));
  const allQualityFailedCombined = combineExecutionResults(allQualityFailed);
  assert.equal(allQualityFailedCombined.deliveryStatus, "failed");
  assert.equal(allQualityFailedCombined.creditCost, 0);
  assert.equal(allQualityFailedCombined.skillIds.length, 0);
  assert.ok(allQualityFailedCombined.qualityFlags.includes("all_steps_failed"));
  assert.match(allQualityFailedCombined.answerText, /没有扣除对应积分/);
  assert.match(allQualityFailedCombined.answerText, /内容文案/);
  assert.match(allQualityFailedCombined.answerText, /投流系统/);

  const needsInputPlan = buildExecutionPlan("plan-needs-input", [
    { capabilityId: "live_script", title: "直播话术", skillId: "live_script_planner", skillVersion: "3.0.0" }
  ]);
  const needsInput = await executeExecutionPlan({
    plan: needsInputPlan,
    buildInput: () => "请写直播话术",
    invoke: async (step) => ({
      ...resultFor(step, "请补充直播产品和唯一转化动作。"),
      deliveryStatus: "needs_input",
      creditCost: 0,
      qualityFlags: ["live_script_clarification_used"]
    })
  });
  const needsInputCombined = combineExecutionResults(needsInput);
  assert.equal(needsInputCombined.deliveryStatus, "needs_input");
  assert.equal(needsInputCombined.creditCost, 0);
  assert.doesNotMatch(needsInputCombined.answerText, /已联合完成/);

  const timeoutPlan = buildExecutionPlan("plan-timeout", [
    { capabilityId: "live_script", title: "Live script", skillId: "live_script_planner", skillVersion: "3.0.0" },
    { capabilityId: "private_domain", title: "Private domain", skillId: "moments_generator", skillVersion: "1.0.0" }
  ]);
  const timedOut = await executeExecutionPlan({
    plan: timeoutPlan,
    stepTimeoutMs: 20,
    overallTimeoutMs: 100,
    buildInput: (step) => step.title,
    invoke: async (step) => {
      if (step.capabilityId === "private_domain") return await new Promise<SkillRuntimeResult>(() => undefined);
      return resultFor(step, "直播话术完成：开场、留人、互动、转化、收尾和下播跟进");
    }
  });
  assert.equal(timedOut.results.find((item) => item.capabilityId === "private_domain")?.status, "failed");
  assert.match(timedOut.results.find((item) => item.capabilityId === "private_domain")?.error?.code ?? "", /skill_step_timed_out/);
  assert.equal(combineExecutionResults(timedOut).deliveryStatus, "failed");

  const controller = new AbortController();
  const cancelledRun = executeExecutionPlan({
    plan: needsInputPlan,
    signal: controller.signal,
    stepTimeoutMs: 5_000,
    overallTimeoutMs: 10_000,
    buildInput: () => "Write live script",
    invoke: async () => await new Promise<SkillRuntimeResult>(() => undefined)
  });
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(cancelledRun, (error: unknown) => error instanceof Error && error.name === "AbortError");

  const takeawayInput = "客户：枕水江南。行业：中式快餐外卖连锁。城市：沈阳。7家外卖店，新店外卖销售额不好。输出7天抖音短视频文案创作计划；成交回到美团、饿了么和淘宝闪购，不做抖音团购。";
  const takeawayFallback = await runAgent({
    tenantId: "tenant-chain",
    userId: "user-owner",
    role: "owner",
    planCode: "chain_standard",
    input: takeawayInput,
    routingInput: takeawayInput,
    requestedSkillId: "baolu_content_creator",
    capabilityId: "content_plan",
    capabilityLocked: true,
    deliveryPolicy: "draft_with_placeholders",
    tenantProfile: { tenantId: "tenant-chain", tenantName: "思潼", tenantType: "chain_brand", industry: "AI企业改造", city: "沈阳" },
    channel: "h5"
  }, { name: "orchestrator-smoke", async complete() { throw new Error("provider_should_not_run"); } });
  assert.ok(takeawayFallback.qualityFlags.includes("deterministic_draft_used"));
  assert.match(takeawayFallback.answer, /抖音发布标题/);
  assert.match(takeawayFallback.answer, /真实菜品、出餐、打包、包装稳定性和外卖平台下单路径/);
  assert.doesNotMatch(takeawayFallback.answer, /流程白板、岗位协作和指标卡/);
  assert.match(takeawayFallback.answer, /涉及成交平台美团、饿了么、淘宝闪购/);
  assert.match(takeawayFallback.answer, /口播开头/);
  assert.doesNotMatch(takeawayFallback.answer, /主要来源美团/);

  const takeawayLiveInput = "请为枕水江南制定线上外卖订单增长方案。行业：中式快餐外卖连锁。城市：沈阳。7家外卖店，新店外卖销售额不好。输出60分钟完整直播话术包；抖音主要负责曝光，顾客到美团、饿了么或淘宝闪购下单，不做抖音团购。菜品、套餐、价格和优惠待客户补充。";
  const takeawayLiveFallback = await runAgent({
    tenantId: "tenant-chain",
    userId: "user-owner",
    role: "owner",
    planCode: "chain_standard",
    input: takeawayLiveInput,
    routingInput: takeawayLiveInput,
    requestedSkillId: "live_script_planner",
    capabilityId: "live_script",
    capabilityLocked: true,
    deliveryPolicy: "draft_with_placeholders",
    tenantProfile: { tenantId: "tenant-chain", tenantName: "思潼", tenantType: "chain_brand", industry: "AI企业改造", city: "沈阳" },
    channel: "h5"
  }, { name: "orchestrator-smoke", async complete() { throw new Error("provider_should_not_run"); } });
  assert.match(takeawayLiveFallback.answer, /平台下单与配送答疑/);
  assert.match(takeawayLiveFallback.answer, /搜索枕水江南/);
  assert.match(takeawayLiveFallback.answer, /抖音负责展示和答疑，不把抖音团购写成默认成交路径/);
  assert.doesNotMatch(takeawayLiveFallback.answer, /正在正在|购买\/核销答疑|供应链、培训或服务资料|是否适合、效果怎么判断/);

  const hotspotInput = "客户：枕水江南。行业：中式快餐外卖连锁。城市：沈阳。请输出行业热点和可执行选题；本轮没有公开来源链接或热榜截图。";
  const hotspotFallback = await runAgent({
    tenantId: "tenant-chain",
    userId: "user-owner",
    role: "owner",
    planCode: "chain_standard",
    input: hotspotInput,
    routingInput: hotspotInput,
    requestedSkillId: "ai_daily_brief",
    capabilityId: "industry_hotspots",
    capabilityLocked: true,
    deliveryPolicy: "draft_with_placeholders",
    tenantProfile: { tenantId: "tenant-chain", tenantName: "思潼", tenantType: "chain_brand", industry: "AI企业改造", city: "沈阳" },
    channel: "h5"
  }, { name: "orchestrator-smoke", async complete() { throw new Error("provider_should_not_run"); } });
  assert.match(hotspotFallback.answer, /本轮没有抓到可核验的公开热点/);
  assert.match(hotspotFallback.answer, /待验证热点咨询/);

  const franchiseInput = "【当前任务客户资料卡】以下是用户已确认或已保存的当前客户项目事实。优先级高于服务提供方的企业画像；不得把两者混用。\n客户/品牌：三禾糖水铺\n行业：餐饮糖水连锁\n城市：待补\n门店规模：约30家店\n当前经营问题：招商加盟扩张慢\n资料卡未填写的字段仍按待补处理，不得自行编造。\n\n用户这次补充：请为三禾糖水铺制定招商加盟增长方案。加盟费、投资、回本、盈利、扶持和案例暂未提供。请输出招商内容和朋友圈私域承接及30天计划，不得承诺收益。";
  const franchiseContent = await runAgent({
    tenantId: "tenant-chain", userId: "user-owner", role: "owner", planCode: "chain_standard",
    input: franchiseInput, routingInput: "三禾糖水铺招商加盟增长", requestedSkillId: "baolu_content_creator", capabilityId: "franchise_acquisition", capabilityLocked: true,
    deliveryPolicy: "draft_with_placeholders", tenantProfile: { tenantId: "tenant-chain", tenantName: "思潼", tenantType: "chain_brand", industry: "AI企业改造", city: "杭州" }, channel: "h5"
  }, { name: "orchestrator-smoke", async complete() { throw new Error("provider_should_not_run"); } });
  const franchisePrivate = await runAgent({
    tenantId: "tenant-chain", userId: "user-owner", role: "owner", planCode: "chain_standard",
    input: franchiseInput, routingInput: "三禾糖水铺招商加盟增长", requestedSkillId: "moments_generator", capabilityId: "private_domain", capabilityLocked: true,
    deliveryPolicy: "draft_with_placeholders", tenantProfile: { tenantId: "tenant-chain", tenantName: "思潼", tenantType: "chain_brand", industry: "AI企业改造", city: "杭州" }, channel: "h5"
  }, { name: "orchestrator-smoke", async complete() { throw new Error("provider_should_not_run"); } });
  assert.match(franchiseContent.answer, /三禾糖水铺/);
  assert.match(franchiseContent.answer, /30家/);
  assert.doesNotMatch(franchiseContent.answer, /杭州/);
  assert.match(franchisePrivate.answer, /30天行动计划/);
  assert.match(franchisePrivate.answer, /投资有风险/);
  const franchiseLive = await runAgent({
    tenantId: "tenant-chain", userId: "user-owner", role: "owner", planCode: "chain_standard",
    input: franchiseInput, routingInput: "三禾糖水铺招商加盟直播与私域增长", requestedSkillId: "live_script_planner", capabilityId: "live_script", capabilityLocked: true,
    deliveryPolicy: "draft_with_placeholders", tenantProfile: { tenantId: "tenant-chain", tenantName: "思潼", tenantType: "chain_brand", industry: "AI企业改造", city: "杭州" }, channel: "h5"
  }, { name: "orchestrator-smoke", async complete() { throw new Error("provider_should_not_run"); } });
  assert.ok(franchiseLive.qualityFlags.includes("deterministic_draft_used"));
  assert.equal(franchiseLive.deliveryStatus, "completed");
  assert.match(franchiseLive.answer, /三禾糖水铺/);
  assert.match(franchiseLive.answer, /直播目标/);
  assert.match(franchiseLive.answer, /主播口播稿/);
  assert.match(franchiseLive.answer, /合规提醒/);
  assert.doesNotMatch(franchiseLive.answer, /杭州/);

  const beautyFranchiseInput = "【当前任务客户资料卡】客户/品牌：美研社连锁\n行业：美业皮肤管理连锁\n城市：沈阳\n门店规模：待补\n当前经营问题：招商加盟有效线索不足\n本次增长目标：提升有效加盟咨询、到店考察和签约跟进。\n\n请制定美业招商加盟增长方案，组合招商短视频、60分钟直播话术和朋友圈私域承接。加盟政策、门店模型、投资预算、回本、盈利、扶持、案例和经营数据暂未提供，缺失内容保留【待补】，不得承诺收益，不得转成培训招生、招学员、店长合伙人或合伙人培养。";
  const beautyFranchiseContent = await runAgent({
    tenantId: "tenant-chain", userId: "user-owner", role: "owner", planCode: "chain_standard",
    input: beautyFranchiseInput, routingInput: "美研社连锁美业招商加盟增长", requestedSkillId: "baolu_content_creator", capabilityId: "franchise_acquisition", capabilityLocked: true,
    deliveryPolicy: "draft_with_placeholders", tenantProfile: { tenantId: "tenant-chain", tenantName: "思潼", tenantType: "chain_brand", industry: "AI企业改造", city: "杭州" }, channel: "h5"
  }, { name: "orchestrator-smoke", async complete() { throw new Error("provider_should_not_run"); } });
  const beautyFranchisePrivate = await runAgent({
    tenantId: "tenant-chain", userId: "user-owner", role: "owner", planCode: "chain_standard",
    input: beautyFranchiseInput, routingInput: "美研社连锁美业招商加盟私域", requestedSkillId: "moments_generator", capabilityId: "private_domain", capabilityLocked: true,
    deliveryPolicy: "draft_with_placeholders", tenantProfile: { tenantId: "tenant-chain", tenantName: "思潼", tenantType: "chain_brand", industry: "AI企业改造", city: "杭州" }, channel: "h5"
  }, { name: "orchestrator-smoke", async complete() { throw new Error("provider_should_not_run"); } });
  assert.match(beautyFranchiseContent.answer, /美研社连锁/);
  assert.match(beautyFranchiseContent.answer, /美业|皮肤管理/);
  assert.match(beautyFranchiseContent.answer, /招商|加盟/);
  assert.match(beautyFranchisePrivate.answer, /30天行动计划/);
  for (const result of [beautyFranchiseContent, beautyFranchisePrivate]) {
    assert.doesNotMatch(result.answer, /培训招生|招收学员|店长级合伙人培养/);
    assert.doesNotMatch(result.answer, /稳赚|保证收益|一定回本|必然回本/);
    assert.doesNotMatch(result.answer, /杭州/);
  }

  const beautyVisitInput = "【当前任务客户资料卡】客户/品牌：初颜秘集\n行业：美业皮肤管理\n城市：沈阳\n门店规模：3家店\n当前经营问题：有效咨询、预约和实际到店不足\n本次增长目标：提升附近消费者咨询、预约、实际到店和复购。\n\n请制定7天美业消费者到店增长方案，组合选题灵感、短视频文案和朋友圈私域承接。主推项目、价格、案例、账号数据和历史到店数据暂未提供，缺失内容保留【待补】，不得编造效果、价格和案例，不得转成培训招生、招学员、店长合伙人或合伙人培养。";
  const restaurantVisitInput = "【当前任务客户资料卡】客户/品牌：满巷小馆\n行业：餐饮堂食\n城市：沈阳\n门店规模：1家店\n当前经营问题：工作日午餐到店客流不足\n本次增长目标：提升附近上班族咨询和实际到店。\n\n请制定7天到店获客方案，组合选题灵感、短视频文案和朋友圈私域承接。菜单、菜品、套餐、价格、地址、账号数据和历史到店数据暂未提供，缺失内容保留【待补】，不得编造优惠、客流和成交数据，不做外卖增长。";
  const localVisitCapabilities = [
    { requestedSkillId: "baolu_topics", capabilityId: "topic_inspiration" },
    { requestedSkillId: "baolu_content_creator", capabilityId: "content_plan" },
    { requestedSkillId: "moments_generator", capabilityId: "private_domain" }
  ] as const;
  const runLocalVisit = async (input: string, routingInput: string) => await Promise.all(localVisitCapabilities.map(async (item) => await runAgent({
    tenantId: "tenant-chain", userId: "user-owner", role: "owner", planCode: "chain_standard",
    input, routingInput, requestedSkillId: item.requestedSkillId, capabilityId: item.capabilityId, capabilityLocked: true,
    deliveryPolicy: "draft_with_placeholders", tenantProfile: { tenantId: "tenant-chain", tenantName: "思潼", tenantType: "chain_brand", industry: "AI企业改造", city: "杭州" }, channel: "h5"
  }, { name: "orchestrator-smoke", async complete() { throw new Error("provider_should_not_run"); } })));
  const beautyVisitResults = await runLocalVisit(beautyVisitInput, "初颜秘集美业消费者到店增长");
  const restaurantVisitResults = await runLocalVisit(restaurantVisitInput, "满巷小馆堂食到店获客增长");
  for (const result of [...beautyVisitResults, ...restaurantVisitResults]) {
    assert.ok(result.qualityFlags.includes("deterministic_draft_used"));
    assert.match(result.answer, /沈阳/);
    assert.doesNotMatch(result.answer, /杭州/);
  }
  assert.match(beautyVisitResults[2].answer, /第1天/);
  assert.match(beautyVisitResults[2].answer, /第7天/);
  assert.match(beautyVisitResults[2].answer, /信任型朋友圈/);
  assert.match(beautyVisitResults[2].answer, /实际到店/);
  assert.doesNotMatch(beautyVisitResults[2].answer, /通勤美甲|手型|甲型|团购|外卖|培训招生|店长级合伙人|招收学员/);
  assert.doesNotMatch(beautyVisitResults[1].answer, /主推服务、价格|服务、价格/);
  assert.match(beautyVisitResults[1].answer, /可直接口播/);
  assert.match(beautyVisitResults[1].answer, /有效预约/);
  assert.match(beautyVisitResults[1].answer, /承接动作/);
  assert.doesNotMatch(beautyVisitResults[1].answer, /美甲|手型|甲型|堂食|培训招生|店长级合伙人|招收学员/);
  assert.match(restaurantVisitResults[2].answer, /第1天/);
  assert.match(restaurantVisitResults[2].answer, /第7天/);
  assert.match(restaurantVisitResults[2].answer, /堂食/);
  assert.match(restaurantVisitResults[2].answer, /实际到店/);
  assert.doesNotMatch(restaurantVisitResults[2].answer, /外卖下单|美甲|皮肤管理|9\.9元|限时折扣/);
  assert.doesNotMatch(restaurantVisitResults[1].answer, /菜单、菜品、套餐、价格/);
  assert.match(restaurantVisitResults[1].answer, /可直接口播/);
  assert.match(restaurantVisitResults[1].answer, /实际到店/);
  assert.match(restaurantVisitResults[1].answer, /承接动作/);
  assert.doesNotMatch(restaurantVisitResults[1].answer, /适合谁|真实服务范围|服务边界|外卖平台|皮肤管理|美甲/);

  console.log("Agent orchestrator smoke passed: dependency execution, partial fallback, timeout and cancellation are valid.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

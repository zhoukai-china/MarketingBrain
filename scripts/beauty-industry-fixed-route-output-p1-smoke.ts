import assert from "node:assert/strict";
import { buildAgentMessages, enforceTopicInspirationFinalDelivery, inspectQuality, runAgent, type AgentResponse, type LlmProvider } from "../packages/agent/src/index.js";
import { loadSkillQualityContract } from "../packages/skills/src/index.js";
import {
  BEAUTY_WORKFLOWS,
  buildBeautyWorkflowPrompt
} from "../apps/api/src/products/beauty-industry/workflows.js";
import {
  BEAUTY_INDUSTRY_SCOPES,
  getBeautyIndustryToolRegistration,
  listBeautyIndustryMcpTools,
  runBeautyIndustryMcpTool
} from "../apps/api/src/products/beauty-industry/mcp-adapter.js";
import { buildBeautyRouteReceipt } from "../apps/api/src/products/beauty-industry/route-receipt.js";
import { buildBeautyIndustryRunInput } from "../apps/api/src/products/beauty-industry/profile.js";

const WRONG_MODULE_ANSWER = [
  "视频数据复盘报告",
  "数据质量审计",
  "数据总览",
  "视频分层",
  "内容结构健康度",
  "单条深拆",
  "完播率深层归因",
  "互动深度分析",
  "趋势分析",
  "规律总结",
  "方法论沉淀",
  "下周期选题建议",
  "综合诊断结论",
  "这是餐饮团购门店的数据复盘。"
].join("\n");

const TOPIC_WORKFLOW_FIXTURE = {
  targetCustomer: "附近关注日常皮肤护理的成年顾客",
  acquisitionGoal: "获得合规到店咨询",
  industry: "皮肤管理",
  benchmarkAccounts: [],
  transcriptDocumentIds: [],
  sourceSelection: {
    industry: true,
    benchmark: false,
    transcript: false,
    videoReview: false
  }
};

const CONTENT_WORKFLOW_FIXTURE = {
  version: "content_workflow_v1",
  topic: "第一次了解基础补水护理前先确认三件事",
  objective: "让附近成年顾客了解服务边界并发起合规咨询",
  targetAudience: "附近关注日常皮肤管理的成年顾客",
  platform: "抖音",
  format: "店长真人口播短视频",
  duration: "60秒内",
  presenter: "店长本人",
  projectFacts: "本店提供基础补水护理；未确认价格、疗效、案例或活动",
  shootingConstraints: "不出现顾客正脸；只拍已授权门店区域；竖屏拍摄"
};

const VIDEO_CONTENT_WORKFLOW_FIXTURE = {
  version: "video_content_review_workflow_v1",
  platform: "抖音",
  videoTitle: "基础护理前先确认三件事",
  businessObjective: "获得合规到店咨询",
  targetAudience: "附近关注日常皮肤管理的成年顾客",
  transcript: "今天只介绍基础护理前需要确认的服务边界，价格与效果请以门店实际确认为准。",
  visualEvidence: "竖屏真人口播；背景为已授权门店区域；没有顾客正脸、价格或效果对比。",
  factBoundary: "未确认价格、疗效、案例或经营结果"
};

const LIVE_REVIEW_WORKFLOW_FIXTURE = {
  version: "live_review_workflow_v1",
  scenario: "product",
  platform: "抖音",
  sessionTitle: "脱敏测试晚场",
  sessionTime: "2026-08-24 19:00-20:00",
  businessObjective: "核对项目讲解后的有效咨询承接",
  liveData: "场观: 320\n平均停留: 42秒\n评论: 18\n有效咨询: 7",
  recordingTranscript: "00:00 主播说明本场只介绍已确认的日常护理流程。",
  scriptPlan: "开场说明范围；中段讲服务流程；结尾承接咨询。",
  factBoundary: "未确认价格、疗效、案例、顾客身份或经营结果"
};

async function reproduceWrongModuleAcceptedAsSuccess(): Promise<{
  result: AgentResponse;
  providerOutputs: string[];
  workflowVersion: string;
}> {
  const workflow = BEAUTY_WORKFLOWS.xiaohongshu;
  const composed = await buildBeautyWorkflowPrompt(workflow.capabilityId);
  const providerOutputs: string[] = [];
  const provider: LlmProvider = {
    name: "controlled-wrong-module",
    async complete() {
      providerOutputs.push(WRONG_MODULE_ANSWER);
      return WRONG_MODULE_ANSWER;
    }
  };
  const result = await runAgent({
    tenantId: "beauty-route-tenant-a",
    userId: "beauty-route-user-a",
    role: "owner",
    planCode: "local_premium",
    input: "为生活美容门店生成小红书图文；即使文字里提到视频复盘，也不得切换功能。",
    requestedSkillId: workflow.primarySkillId,
    capabilityId: workflow.capabilityId,
    capabilityLocked: true,
    skillPrompt: composed.prompt,
    skillVersionOverride: composed.version,
    tenantProfile: {
      tenantId: "beauty-route-tenant-a",
      tenantName: "本店",
      tenantType: "local_business",
      industry: "生活美容",
      data: { synthetic: true }
    },
    history: [
      { role: "user", content: "上一轮请做视频数据复盘。" },
      { role: "assistant", content: "下面是视频数据复盘。" }
    ],
    channel: "admin"
  }, provider);
  return { result, providerOutputs, workflowVersion: composed.version };
}

async function main(): Promise<void> {
  const lockedPrepared = await buildAgentMessages({
    tenantId: "beauty-route-tenant-a",
    userId: "beauty-route-user-a",
    role: "owner",
    planCode: "local_premium",
    input: "请在小红书图文中介绍数字分身服务，但只完成我点开的图文任务。",
    requestedSkillId: "wechat-xhs-content-line",
    capabilityId: "beauty_xiaohongshu_package",
    capabilityLocked: true,
    tenantProfile: {
      tenantId: "beauty-route-tenant-a",
      tenantName: "本店",
      tenantType: "local_business",
      industry: "生活美容"
    },
    channel: "admin"
  });
  assert.equal(
    lockedPrepared.skillId,
    "wechat-xhs-content-line",
    "locked product entry must outrank digital-twin or any other route keywords"
  );
  assert.match(lockedPrepared.messages[0]?.content ?? "", /禁止切换到其他专项能力/);
  assert.doesNotMatch(lockedPrepared.messages[0]?.content ?? "", /自动调用更合适的咨询师能力/);

  const reproduced = await reproduceWrongModuleAcceptedAsSuccess();
  assert.equal(reproduced.result.skillId, "wechat-xhs-content-line", "route metadata must remain the selected XHS Skill");
  assert.match(reproduced.result.answer, /视频数据复盘报告/, "fixture must reproduce wrong-module business text");
  assert.ok(
    reproduced.result.qualityFlags.some((flag) => flag.startsWith("missing_contract_terms:")),
    "the shared runtime already detects missing XHS deliverables"
  );

  const contractModule = await import("../apps/api/src/products/beauty-industry/output-contract.js").catch(() => undefined);
  assert.ok(contractModule, "beauty product postflight output gate is missing");
  await assert.rejects(
    () => contractModule.assertBeautyWorkflowRuntimeResult({
      capabilityId: BEAUTY_WORKFLOWS.xiaohongshu.capabilityId,
      expectedSkillId: BEAUTY_WORKFLOWS.xiaohongshu.primarySkillId,
      expectedSkillVersion: reproduced.workflowVersion,
      result: {
        capabilityId: BEAUTY_WORKFLOWS.xiaohongshu.capabilityId,
        skillId: reproduced.result.skillId,
        skillVersion: reproduced.result.skillVersion,
        answerText: reproduced.result.answer,
        deliveryStatus: reproduced.result.deliveryStatus === "needs_input" ? "needs_input" : "completed",
        qualityFlags: reproduced.result.qualityFlags,
        providerFailure: reproduced.result.providerFailure
      },
      observedProviderOutputs: reproduced.providerOutputs,
      replay: false
    }),
    /beauty_workflow_output_(?:contract|quality|foreign_module)_failed/
  );

  assert.deepEqual(
    Object.keys(BEAUTY_WORKFLOWS).sort(),
    ["content-ten", "live-review", "live-script", "sales", "topics", "video-content-review", "video-data-review", "xiaohongshu"].sort(),
    "the executable beauty workflow registry must match admitted tools"
  );

  const workflows = Object.values(BEAUTY_WORKFLOWS);
  for (const workflow of workflows) {
    const registration = getBeautyIndustryToolRegistration(workflow.toolName);
    assert.equal(registration.scope, workflow.scope, `${workflow.toolName}:scope`);
    assert.equal(registration.capabilityId, workflow.capabilityId, `${workflow.toolName}:capability`);
    assert.equal(registration.skillId, workflow.primarySkillId, `${workflow.toolName}:skill`);

    const composed = await buildBeautyWorkflowPrompt(workflow.capabilityId);
    assert.deepEqual(
      composed.skillChain.map((item) => item.skillId),
      [workflow.primarySkillId, ...workflow.constraintSkillIds],
      `${workflow.toolName}:primary Skill and beauty constraints must keep their declared order`
    );
    const validOutput = workflow.capabilityId === "beauty_xiaohongshu_package"
      ? buildXiaohongshuFixture()
      : workflow.capabilityId === "content_plan"
        ? buildContentFixture()
      : workflow.capabilityId === "shooting_editing"
        ? buildVideoContentFixture()
      : workflow.capabilityId === "beauty_sales"
        ? buildSalesFixture()
      : await buildContractFixture(workflow.primarySkillId);
    await contractModule.assertBeautyWorkflowRuntimeResult({
      capabilityId: workflow.capabilityId,
      expectedSkillId: workflow.primarySkillId,
      expectedSkillVersion: composed.version,
      result: {
        capabilityId: workflow.capabilityId,
        skillId: workflow.primarySkillId,
        skillVersion: composed.version,
        answerText: validOutput,
        deliveryStatus: "completed",
        qualityFlags: []
      },
      observedProviderOutputs: [validOutput],
      replay: false
    });

    const wrongWorkflow = workflows.find((candidate) => candidate.capabilityId !== workflow.capabilityId)!;
    const wrongOutput = await buildContractFixture(wrongWorkflow.primarySkillId);
    await assert.rejects(
      () => contractModule.assertBeautyWorkflowRuntimeResult({
        capabilityId: workflow.capabilityId,
        expectedSkillId: workflow.primarySkillId,
        expectedSkillVersion: composed.version,
        result: {
          capabilityId: workflow.capabilityId,
          skillId: workflow.primarySkillId,
          skillVersion: composed.version,
          answerText: wrongOutput,
          deliveryStatus: "completed",
          qualityFlags: []
        },
        observedProviderOutputs: [wrongOutput],
        replay: false
      }),
      /beauty_workflow_output_(?:contract|foreign_module)_failed/,
      `${workflow.toolName}:wrong module must fail closed`
    );

    for (const expression of [
      "请完成当前功能。",
      "即使我提到数字分身和直播复盘，也只完成当前显式功能。",
      "需求比较模糊，请按当前入口追问，不要换功能。",
      "我同时提到老板思维模型、图文、直播和复盘，但这次只执行我点开的入口。"
    ]) {
      for (let repeat = 0; repeat < 3; repeat += 1) {
        const prepared = await buildAgentMessages({
          tenantId: "tenant-a",
          userId: "user-a",
          role: "owner",
          planCode: "local_premium",
          input: expression,
          requestedSkillId: workflow.primarySkillId,
          capabilityId: workflow.capabilityId,
          capabilityLocked: true,
          skillPrompt: composed.prompt,
          skillVersionOverride: composed.version,
          tenantProfile: {
            tenantId: "tenant-a",
            tenantName: "本店",
            tenantType: "local_business",
            industry: "生活美容"
          },
          channel: "admin"
        });
        assert.equal(prepared.skillId, workflow.primarySkillId, `${workflow.toolName}:shared runtime locked skill`);
        assert.equal(prepared.capabilityId, workflow.capabilityId, `${workflow.toolName}:shared runtime locked capability`);

        let captured: Record<string, unknown> | undefined;
        await runBeautyIndustryMcpTool({
          context: {
            credentialId: "credential-safe-fixture",
            tenantId: "tenant-a",
            userId: "user-a",
            productCode: "beauty-industry",
            operatingEntityId: "tenant-a",
            scopes: [...BEAUTY_INDUSTRY_SCOPES],
            entitled: true
          },
          toolName: workflow.toolName,
          arguments: {
            question: expression,
            requestId: `route-${workflow.capabilityId}-${repeat}-0001`,
            ...(workflow.toolName === BEAUTY_WORKFLOWS.topics.toolName
              ? { topicWorkflow: TOPIC_WORKFLOW_FIXTURE }
              : {}),
            ...(workflow.toolName === BEAUTY_WORKFLOWS["content-ten"].toolName
              ? { contentWorkflow: CONTENT_WORKFLOW_FIXTURE }
              : {}),
            ...(workflow.toolName === BEAUTY_WORKFLOWS["video-content-review"].toolName
              ? { mode: "professional", videoContentWorkflow: VIDEO_CONTENT_WORKFLOW_FIXTURE }
              : {}),
            ...(workflow.toolName === BEAUTY_WORKFLOWS["live-review"].toolName
              ? { mode: "professional", liveReviewWorkflow: LIVE_REVIEW_WORKFLOW_FIXTURE }
              : {})
          },
          execute: async (spec) => {
            captured = spec as unknown as Record<string, unknown>;
            return { status: "succeeded", text: "fixture", runId: "run-fixture", creditCost: 0 };
          }
        });
        assert.equal(captured?.capabilityId, workflow.capabilityId, `${workflow.toolName}:locked capability`);
        assert.equal(captured?.skillId, workflow.primarySkillId, `${workflow.toolName}:locked skill`);
        assert.equal(captured?.productCode, "beauty-industry", `${workflow.toolName}:credential product`);
        assert.equal(captured?.tenantId, "tenant-a", `${workflow.toolName}:credential tenant`);
      }
    }
  }
  for (const closedTool of [
    "beauty.text_to_video",
    "beauty.image_to_video",
    "beauty.paid_traffic_preview",
    "beauty.knowledge_qa"
  ]) {
    assert.throws(() => getBeautyIndustryToolRegistration(closedTool), /beauty_tool_not_found/);
  }
  const dailyBriefRegistration = getBeautyIndustryToolRegistration("beauty.daily_brief");
  assert.equal(dailyBriefRegistration.capabilityId, "beauty_daily_brief");
  assert.equal(dailyBriefRegistration.skillId, "ai_daily_brief");
  assert.equal(dailyBriefRegistration.scope, "operations:daily-brief");
  assert.equal(
    listBeautyIndustryMcpTools({
      credentialId: "credential-safe-fixture",
      productCode: "beauty-industry",
      tenantId: "tenant-a",
      userId: "user-a",
      operatingEntityId: "tenant-a",
      scopes: [...BEAUTY_INDUSTRY_SCOPES],
      entitled: true
    }).some((tool) => tool.name === "beauty.daily_brief"),
    false,
    "未授权运行模式必须隐藏日报工具"
  );
  const topicComposed = await buildBeautyWorkflowPrompt(BEAUTY_WORKFLOWS.topics.capabilityId);
  await assert.rejects(
    () => contractModule.assertBeautyWorkflowRuntimeResult({
      capabilityId: BEAUTY_WORKFLOWS.topics.capabilityId,
      expectedSkillId: BEAUTY_WORKFLOWS.topics.primarySkillId,
      expectedSkillVersion: topicComposed.version,
      result: {
        capabilityId: BEAUTY_WORKFLOWS.topics.capabilityId,
        skillId: BEAUTY_WORKFLOWS.topics.primarySkillId,
        skillVersion: topicComposed.version,
        answerText: "这里是一段普通说明文字，不提出任何问题。",
        deliveryStatus: "needs_input",
        creditCost: 0,
        qualityFlags: []
      },
      observedProviderOutputs: [],
      replay: false
    }),
    /beauty_workflow_output_contract_failed:invalid_clarification/
  );
  await verifyEvidenceOnlyVideoDataReview(contractModule);
  await verifyExplicitTenPackDoesNotClarify();
  await verifyBeautyProductDoesNotRequireInternalDeliverableLabels();
  await verifyXiaohongshuDeliverableStructure(contractModule);
  await verifyStandardLiveScriptContract(contractModule);
  await verifyBeautySalesHeadingContract();
  await verifyBeautyTopicContractIsNotReplacedByFounderIpDelivery();
  await verifyInvalidTopicOutputIsNotReplacedByDeterministicTemplate(contractModule);
  await verifyBeautyTopicDoesNotTreatTenantContextAsUserFacts();
  await verifyProductExecutionRejectsWrongOutputBeforePersistence();
  console.log("beauty fixed-route output P1 smoke passed");
}

async function verifyBeautySalesHeadingContract(): Promise<void> {
  const workflow = BEAUTY_WORKFLOWS.sales;
  const composed = await buildBeautyWorkflowPrompt(workflow.capabilityId);
  assert.match(
    composed.prompt,
    /## 当前判断[\s\S]*### 异议[\s\S]*## 核心破局点[\s\S]*## 推荐回复[\s\S]*## 客户可能回复与预判应对[\s\S]*## 下一步动作/,
    "beauty sales must turn the formal contract into an exact model-facing heading skeleton"
  );
}

async function verifyStandardLiveScriptContract(contractModule: {
  assertBeautyWorkflowRuntimeResult: (input: Record<string, unknown>) => Promise<unknown>;
}): Promise<void> {
  const workflow = BEAUTY_WORKFLOWS["live-script"];
  const composed = await buildBeautyWorkflowPrompt(workflow.capabilityId);
  assert.match(
    composed.prompt,
    /## 下播后跟进/,
    "live-script prompt must carry the formal post-live follow-up heading"
  );
  assert.match(composed.prompt, /## 主播口播稿[\s\S]*### 开场[\s\S]*### 逼单/);
  assert.doesNotMatch(
    composed.prompt,
    /必须逐项出现：场景识别、直播目标、直播总览、开场话术、核心轮播话术/,
    "a standard live-script request must not be forced into the full-session contract"
  );
  const core = [
    "短结论", "场景识别", "直播目标", "开播前检查", "主播口播稿", "运营配合动作",
    "开场", "留人", "互动", "产品承接", "转化", "逼单", "下播后跟进", "合规提醒", "复盘指标",
    "建议动作：只使用本轮确认事实；价格和预约入口待补。"
  ].join("\n");
  const standardAnswer = `${core}\n${"可直接照读的话术与执行动作。".repeat(70)}`;
  await contractModule.assertBeautyWorkflowRuntimeResult({
    capabilityId: workflow.capabilityId,
    expectedSkillId: workflow.primarySkillId,
    expectedSkillVersion: composed.version,
    result: {
      capabilityId: workflow.capabilityId,
      skillId: workflow.primarySkillId,
      skillVersion: composed.version,
      answerText: standardAnswer,
      deliveryStatus: "completed",
      qualityFlags: []
    },
    observedProviderOutputs: [standardAnswer],
    replay: false
  });
}

async function verifyXiaohongshuDeliverableStructure(contractModule: {
  assertBeautyWorkflowRuntimeResult: (input: Record<string, unknown>) => Promise<unknown>;
}): Promise<void> {
  const workflow = BEAUTY_WORKFLOWS.xiaohongshu;
  const composed = await buildBeautyWorkflowPrompt(workflow.capabilityId);
  const structurallyIncomplete = await buildContractFixture(workflow.primarySkillId);
  await assert.rejects(
    () => contractModule.assertBeautyWorkflowRuntimeResult({
      capabilityId: workflow.capabilityId,
      expectedSkillId: workflow.primarySkillId,
      expectedSkillVersion: composed.version,
      result: {
        capabilityId: workflow.capabilityId,
        skillId: workflow.primarySkillId,
        skillVersion: composed.version,
        answerText: structurallyIncomplete,
        deliveryStatus: "completed",
        qualityFlags: []
      },
      observedProviderOutputs: [structurallyIncomplete],
      replay: false
    }),
    /(?:beauty_workflow_output_contract_failed:xhs_deliverables|beauty_xhs_delivery_layer_missing)/,
    "XHS postflight must verify title/tag counts and three independent prompt sets instead of literal internal labels"
  );
}

async function verifyBeautyProductDoesNotRequireInternalDeliverableLabels(): Promise<void> {
  const workflow = BEAUTY_WORKFLOWS.xiaohongshu;
  const composed = await buildBeautyWorkflowPrompt(workflow.capabilityId);
  const contract = await loadSkillQualityContract(workflow.primarySkillId);
  const answer = await buildContractFixture(workflow.primarySkillId);
  const flags = inspectQuality(
    answer,
    workflow.primarySkillId,
    contract,
    [{ role: "system", content: composed.prompt }],
    workflow.capabilityId
  );
  assert.equal(
    flags.some((flag) => flag.startsWith("missing_contract_terms:")),
    false,
    "beauty product results must not be forced to repeat internal requiredDeliverables labels verbatim"
  );
}

async function verifyExplicitTenPackDoesNotClarify(): Promise<void> {
  const workflow = BEAUTY_WORKFLOWS["content-ten"];
  const composed = await buildBeautyWorkflowPrompt(workflow.capabilityId);
  assert.match(
    composed.prompt,
    /最终输出结构以主业务 Skill 的质量合约为唯一用户交付结构/,
    "beauty constraints can currently override the primary Content V5 output schema"
  );
  assert.match(
    composed.prompt,
    /## 短结论/,
    "content-ten prompt must carry the exact primary-contract heading skeleton instead of only naming fields inline"
  );
  let providerCalls = 0;
  const result = await runAgent({
    tenantId: "beauty-content-ten-tenant",
    userId: "beauty-content-ten-user",
    role: "owner",
    planCode: "local_premium",
    input: buildBeautyIndustryRunInput({
      question: "围绕基础补水护理生成内容十件套；目标顾客是附近成年上班族，预约方式未知请标待补。",
      profile: null,
      mode: "quick"
    }),
    requestedSkillId: workflow.primarySkillId,
    capabilityId: workflow.capabilityId,
    capabilityLocked: true,
    skillPrompt: composed.prompt,
    skillVersionOverride: composed.version,
    tenantProfile: {
      tenantId: "beauty-content-ten-tenant",
      tenantName: "本店",
      tenantType: "local_business",
      industry: "生活美容"
    },
    channel: "workbuddy"
  }, {
    name: "controlled-content-ten-contract",
    async complete() {
      providerCalls += 1;
      return buildContractFixture(workflow.primarySkillId);
    }
  });
  assert.notEqual(result.deliveryStatus, "needs_input", "explicit content-ten entry was incorrectly converted into clarification");
  assert.equal(providerCalls, 1, "explicit content-ten entry did not reach its locked Skill Provider path");
  assert.equal(
    result.qualityFlags.some((flag) => flag === "missing_contract_terms:复盘动作"),
    false,
    "system-owned next-step text polluted the user's requested content deliverables"
  );
}

async function verifyBeautyTopicContractIsNotReplacedByFounderIpDelivery(): Promise<void> {
  const workflow = BEAUTY_WORKFLOWS.topics;
  const composed = await buildBeautyWorkflowPrompt(workflow.capabilityId);
  assert.match(
    composed.prompt,
    /## 本轮主体与目标[\s\S]*目标用户：[\s\S]*账号阶段：[\s\S]*## 四大来源自动采集结果/,
    "beauty topic prompt must make the required target-user and account-stage fields structurally unavoidable"
  );
  assert.match(
    composed.prompt,
    /\| # \| 最终选题 \| 类型 \| 来源 \| 第一关证据 \| 共识层级 \| 客资准度 \| 适用阶段 \| 创作建议 \|/,
    "beauty topic prompt must carry the exact ten-row delivery columns"
  );
  const formalSkillAnswer = await buildContractFixture(workflow.primarySkillId);
  assert.doesNotMatch(formalSkillAnswer, /与获客目标的关系|下一步生成内容/);
  const request = {
    tenantId: "beauty-topic-contract-tenant",
    userId: "beauty-topic-contract-user",
    role: "owner" as const,
    planCode: "local_premium" as const,
    input: "请生成生活美容选题。",
    requestedSkillId: workflow.primarySkillId,
    capabilityId: workflow.capabilityId,
    capabilityLocked: true,
    skillPrompt: composed.prompt,
    skillVersionOverride: composed.version,
    tenantProfile: {
      tenantId: "beauty-topic-contract-tenant",
      tenantName: "本店",
      tenantType: "local_business" as const,
      industry: "生活美容"
    },
    channel: "workbuddy" as const
  };
  const result: AgentResponse = {
    skillId: workflow.primarySkillId,
    skillVersion: composed.version,
    tenantType: "local_business",
    answer: formalSkillAnswer,
    creditCost: 1,
    qualityFlags: [],
    analysisMode: "deep",
    deliveryStatus: "completed"
  };
  const beautyDelivery = await enforceTopicInspirationFinalDelivery(request, result);
  assert.equal(beautyDelivery.answer, formalSkillAnswer, "beauty formal Skill output was replaced by the Founder-IP delivery schema");
  assert.equal(beautyDelivery.qualityFlags.includes("topic_final_delivery_rebuilt"), false);

  const founderIpDelivery = await enforceTopicInspirationFinalDelivery({
    ...request,
    skillVersionOverride: "baolu_topics@2.1.2"
  }, result);
  assert.notEqual(founderIpDelivery.answer, formalSkillAnswer, "Founder-IP expanded delivery compatibility changed");
  assert.equal(founderIpDelivery.qualityFlags.includes("topic_final_delivery_rebuilt"), true);
}

async function verifyInvalidTopicOutputIsNotReplacedByDeterministicTemplate(contractModule: {
  assertBeautyWorkflowRuntimeResult: (input: Record<string, unknown>) => Promise<unknown>;
}): Promise<void> {
  const workflow = BEAUTY_WORKFLOWS.topics;
  const composed = await buildBeautyWorkflowPrompt(workflow.capabilityId);
  const providerAnswer = await buildContractFixture(workflow.primarySkillId);
  const result = await runAgent({
    tenantId: "beauty-topic-tenant",
    userId: "beauty-topic-user",
    role: "owner",
    planCode: "local_premium",
    input: "为生活美容门店生成固定选题系统结果。",
    requestedSkillId: workflow.primarySkillId,
    capabilityId: workflow.capabilityId,
    capabilityLocked: true,
    skillPrompt: composed.prompt,
    skillVersionOverride: composed.version,
    tenantProfile: {
      tenantId: "beauty-topic-tenant",
      tenantName: "本店",
      tenantType: "local_business",
      industry: "生活美容"
    },
    channel: "admin"
  }, {
    name: "controlled-topic-contract",
    async complete() { return providerAnswer; }
  });
  assert.equal(result.answer, providerAnswer, "beauty topic output must remain the observed Provider result");
  assert.equal(result.qualityFlags.includes("topic_final_delivery_rebuilt"), false);
  await assert.rejects(
    () => contractModule.assertBeautyWorkflowRuntimeResult({
      capabilityId: workflow.capabilityId,
      expectedSkillId: workflow.primarySkillId,
      expectedSkillVersion: composed.version,
      result: {
        capabilityId: workflow.capabilityId,
        skillId: result.skillId,
        skillVersion: result.skillVersion,
        answerText: result.answer,
        deliveryStatus: result.deliveryStatus === "needs_input" ? "needs_input" : "completed",
        creditCost: result.creditCost,
        qualityFlags: result.qualityFlags,
        providerFailure: result.providerFailure
      },
      observedProviderOutputs: [providerAnswer],
      replay: false
    }),
    /beauty_workflow_output_(?:contract|quality)_failed/,
    "an incomplete topic result must fail closed instead of being replaced with a synthetic TOP10"
  );
}

async function verifyBeautyTopicDoesNotTreatTenantContextAsUserFacts(): Promise<void> {
  const workflow = BEAUTY_WORKFLOWS.topics;
  const composed = await buildBeautyWorkflowPrompt(workflow.capabilityId);
  const providerAnswer = await buildContractFixture(workflow.primarySkillId);
  const contract = await loadSkillQualityContract(workflow.primarySkillId);
  const flags = inspectQuality(
    providerAnswer,
    workflow.primarySkillId,
    contract,
    [
      {
        role: "system",
        content: `${composed.prompt}\n客户上下文：\n门店：合成验收门店\n城市：青岛\n行业：生活美容\n当前咨询师：美业选题系统`
      },
      {
        role: "user",
        content: buildBeautyIndustryRunInput({
          question: "给皮肤管理门店创作选题",
          profile: null,
          mode: "quick"
        })
      }
    ],
    workflow.capabilityId
  );
  assert.equal(
    flags.includes("rubric_fact_retention_weak"),
    false,
    "beauty topic quality rubric must not require system-owned tenant labels as if the user supplied them"
  );

  const result = await runAgent({
    tenantId: "beauty-topic-web-tenant",
    userId: "beauty-topic-web-user",
    role: "owner",
    planCode: "local_premium",
    input: buildBeautyIndustryRunInput({
      question: "给皮肤管理门店创作选题",
      profile: null,
      mode: "quick"
    }),
    requestedSkillId: workflow.primarySkillId,
    capabilityId: workflow.capabilityId,
    capabilityLocked: true,
    skillPrompt: composed.prompt,
    skillVersionOverride: composed.version,
    tenantProfile: {
      tenantId: "beauty-topic-web-tenant",
      tenantName: "合成验收门店",
      tenantType: "local_business",
      industry: "生活美容",
      data: { city: "青岛", brandName: "合成验收门店" }
    },
    channel: "h5"
  }, {
    name: "controlled-topic-web-context",
    async complete() { return providerAnswer; }
  });
  assert.equal(result.qualityFlags.includes("rubric_fact_retention_weak"), false);
}

async function verifyProductExecutionRejectsWrongOutputBeforePersistence(): Promise<void> {
  const [{ executeBeautyIndustryProductTool }, { getRuntimeAgent }] = await Promise.all([
    import("../apps/api/src/products/beauty-industry/execution.js"),
    import("../apps/api/src/services/agent-runtime.js")
  ]);
  const agent = await getRuntimeAgent("agent_beauty_acquisition");
  let providerCalls = 0;
  await assert.rejects(
    () => executeBeautyIndustryProductTool({
      context: {
        tenantId: "beauty-product-tenant",
        userId: "beauty-product-user",
        role: "owner",
        planCode: "local_premium",
        source: "demo",
        creditBalance: 300,
        profile: {
          tenantId: "beauty-product-tenant",
          tenantName: "本店",
          tenantType: "local_business",
          industry: "生活美容",
          data: { synthetic: true }
        }
      },
      agent,
      provider: {
        name: "controlled-wrong-product-output",
        getModel: () => "deepseek-v4-pro",
        async complete() {
          providerCalls += 1;
          return WRONG_MODULE_ANSWER;
        }
      } as LlmProvider & { getModel: () => string },
      requestId: "beauty-product-route-guard-0001",
      requestFingerprint: "beauty-product-route-guard-fingerprint",
      operatingEntityId: "beauty-product-tenant",
      channel: "web",
      capabilityId: "beauty_xiaohongshu_package",
      skillId: "wechat-xhs-content-line",
      input: "请生成生活美容门店小红书图文。",
      professionalOptions: {
        project: "皮肤管理服务",
        audience: "附近有日常皮肤管理需求的女性顾客",
        imageCount: 3
      },
      conversationId: "must-not-load-cross-capability-history",
      deviceScope: "desktop"
    }),
    /beauty_workflow_output_(?:contract|quality|foreign_module)_failed/
  );
  assert.equal(providerCalls, 1, "wrong output is checked after one bounded call and never auto-retried");

  const receipt = buildBeautyRouteReceipt({
    channel: "web",
    toolName: BEAUTY_WORKFLOWS.xiaohongshu.toolName,
    capabilityId: BEAUTY_WORKFLOWS.xiaohongshu.capabilityId,
    scope: BEAUTY_WORKFLOWS.xiaohongshu.scope,
    skillChain: (await buildBeautyWorkflowPrompt(BEAUTY_WORKFLOWS.xiaohongshu.capabilityId)).skillChain,
    provider: { name: "controlled", getModel: () => "deepseek-v4-pro", async complete() { return ""; } } as LlmProvider & { getModel: () => string },
    parser: "beauty-workflow-output-v1",
    fallbackUsed: false,
    requestId: "raw-request-id-must-not-appear",
    tenantId: "raw-tenant-id-must-not-appear"
  });
  assert.equal(receipt.skillId, BEAUTY_WORKFLOWS.xiaohongshu.primarySkillId);
  assert.match(receipt.requestId, /^sha256:[a-f0-9]{16}$/);
  assert.match(receipt.tenantHash, /^sha256:[a-f0-9]{16}$/);
  assert.doesNotMatch(JSON.stringify(receipt), /raw-request-id|raw-tenant-id/);
}

async function verifyEvidenceOnlyVideoDataReview(contractModule: {
  assertBeautyWorkflowRuntimeResult: (input: Record<string, unknown>) => Promise<unknown>;
}): Promise<void> {
  const workflow = BEAUTY_WORKFLOWS["video-data-review"];
  const composed = await buildBeautyWorkflowPrompt(workflow.capabilityId);
  let providerCalls = 0;
  const result = await runAgent({
    tenantId: "beauty-data-tenant",
    userId: "beauty-data-user",
    role: "owner",
    planCode: "local_premium",
    input: [
      "请复盘已解析 CSV。",
      "【已解析文件证据】",
      "标题,播放量,完播率,点赞,评论,分享,私信",
      "夏季补水,1000,35%,50,8,4,3",
      "基础清洁,700,22%,20,3,2,1",
      "解析状态：成功"
    ].join("\n"),
    requestedSkillId: workflow.primarySkillId,
    capabilityId: workflow.capabilityId,
    capabilityLocked: true,
    skillPrompt: composed.prompt,
    skillVersionOverride: composed.version,
    tenantProfile: {
      tenantId: "beauty-data-tenant",
      tenantName: "本店",
      tenantType: "local_business",
      industry: "生活美容",
      data: { synthetic: true }
    },
    channel: "admin"
  }, {
    name: "provider-must-not-run",
    async complete() {
      providerCalls += 1;
      throw new Error("provider_called_for_evidence_only_review");
    }
  });
  assert.equal(providerCalls, 0, "parsed video data review must not start a text Provider");
  assert.ok(result.qualityFlags.includes("video_table_review_direct"));
  await contractModule.assertBeautyWorkflowRuntimeResult({
    capabilityId: workflow.capabilityId,
    expectedSkillId: workflow.primarySkillId,
    expectedSkillVersion: composed.version,
    result: {
      capabilityId: workflow.capabilityId,
      skillId: result.skillId,
      skillVersion: result.skillVersion,
      answerText: result.answer,
      deliveryStatus: result.deliveryStatus === "needs_input" ? "needs_input" : "completed",
      qualityFlags: result.qualityFlags,
      providerFailure: result.providerFailure
    },
    observedProviderOutputs: [],
    replay: false
  });
}

async function buildContractFixture(skillId: Parameters<typeof loadSkillQualityContract>[0]): Promise<string> {
  const contract = await loadSkillQualityContract(skillId);
  assert.ok(contract, `missing contract:${skillId}`);
  const core = [
    ...(contract.requiredSections ?? []),
    ...(contract.requiredTerms ?? []),
    "建议动作：只使用本轮确认事实；缺失内容明确待补。"
  ].join("\n");
  const minLength = Math.max(contract.minLength ?? 80, 80);
  return `${core}\n${"可执行建议与证据边界。".repeat(Math.ceil((minLength - core.length + 30) / 11))}`;
}

function buildXiaohongshuFixture(): string {
  return [
    "## 客户可复制成品",
    "### 标题候选",
    "1. 附近女性顾客了解皮肤管理产品，先看这3点",
    "2. 想了解皮肤管理产品，先把这几个问题问清楚",
    "3. 皮肤管理产品怎么选？附近女性顾客先别急着跟风",
    "### 正文",
    "这是一篇围绕皮肤管理产品的完整正文。内容只使用已确认的护理主题，不虚构顾客体验、疗效、价格或门店案例。选择前先了解服务流程和适用边界，并按自己的实际情况理性判断。",
    "### 话题标签",
    "#日常护理 #皮肤管理产品 #生活美容 #女性护理 #小红书图文",
    "### 互动与承接",
    "你更关心护理流程还是服务边界？欢迎留言说说你的关注点。",
    "## 门店制作说明",
    ...["配图方向一｜封面图", "配图方向二｜内容图", "配图方向三｜互动承接图"].flatMap((direction, index) => [
      `### ${direction}`,
      `#### 正向视觉提示词\n无人物的生活美容护理静物场景，方向${index + 1}，柔和自然光，竖版构图，画面真实克制。`,
      "#### 负向提示词\n真人正脸，医疗器械，效果对比，价格文字，乱码，其他品牌商标。",
      `#### 后期叠字\n方向${index + 1}中文标题，后期安全区叠加。`,
      "#### 视觉参数\n3:4，竖版，暖色，自然光，高清。"
    ]),
    "三张图片彼此分工明确；后期叠字不进入生图提示词。",
    "## 质量与合规检查",
    "### 任务事实回执",
    "- 季节/时点：本次未提供；未进入客户成品",
    "- 服务项目：皮肤管理产品",
    "- 地理范围：附近",
    "- 目标顾客：女性顾客",
    "- 平台：小红书",
    "- 交付形式：图文",
    "### 事实与合规待补",
    "门店、价格、预约和素材授权未确认，不进入客户成品。"
  ].join("\n");
}

function buildContentFixture(): string {
  return [
    "## 短结论\n围绕本轮已确认选题交付十件可执行内容。",
    "## 一、选题\n用顾客到店前关心的问题切入。",
    "## 二、口播逐字稿\n开头3秒钩子：先讲需求，再讲流程，最后说明选择边界；这是可直接发布的文案，不编造价格、疗效或顾客案例。",
    "## 三、访谈话术\n请店长回答真实流程、适用边界和到店前准备。",
    "## 四、拍摄脚本\n这是可直接拍摄的脚本：0-3秒标题镜头，3-20秒店长口播，20-40秒已授权环境细节，每个镜头配核对后的字幕。",
    "## 五、拍摄注意事项\n不出现未授权顾客正脸或其他品牌标识。",
    "## 六、剪辑EDL\n逐句核对字幕，删除停顿，不补造不存在的画面。",
    "## 七、发布标题与话题\n标题围绕真实问题；标签使用美业与本地生活相关词。",
    "## 八、最佳发布时间\n按账号已有活跃数据选择测试窗口，没有数据时不声称最佳。",
    "## 九、评论区引导话术\n邀请用户留下最关心的流程或边界问题。",
    "## 十、投流建议\n先用自然数据验证，不执行投流或付款。",
    `## 下一步动作\n明确的下一步动作：${"由运营逐项核对事实、素材授权、镜头、字幕、评论承接和发布后复盘指标；每轮只改一个变量并保留同口径观察。".repeat(35)}`,
    "## 质量与合规检查\n价格、疗效、案例和联系方式未确认，均未进入客户交付。"
  ].join("\n");
}

function buildSalesFixture(): string {
  return [
    "## 建议先这样回复",
    "理解您还在考虑，不着急做决定。您现在最在意的是是否适合、价格、时间、流程，还是效果边界？我先把您最关心的一点说明白。",
    "## 为什么这样回",
    "先降低决策压力并识别顾客亲口确认的顾虑，不把未知项目、价格或顾客情况写成事实。",
    "## 顾客可能的下一句",
    "顾客可能继续询问是否适合、价格、时间、服务流程或信任边界。",
    "## 你接下来问什么",
    "请顾客从适合度、价格、时间、流程、信任或效果边界中选一项；若都不是，再让顾客说明其他顾虑。",
    "## 策略详情",
    "## 当前判断",
    "### 已确认事实\n顾客正在犹豫，尚未下单。",
    "### 待核实判断\n具体顾虑尚未确认。",
    "### 异议\n当前属于原因未明确的犹豫异议。",
    "## 核心破局点\n一次只识别并处理一个顾虑。",
    "## 推荐回复\n理解您还在考虑，不着急做决定。",
    "## 客户可能回复与预判应对\n按顾客亲口确认的顾虑，只使用已确认信息回应。",
    "## 下一步动作\n等待顾客回复，不自动预约、不连续催促。",
    "## 质量与合规检查",
    "通用初步回复；不做医疗诊断，不承诺疗效，不虚构案例、价格、优惠或名额。"
  ].join("\n");
}

function buildVideoContentFixture(): string {
  const sections = [
    "## 视频基本信息\n抖音竖屏口播；只使用当前视频证据。",
    "## 现有版本诊断\n开场信息密度待优化；没有平台指标，不推断播放或转化。",
    "## 一、优化版选题定位\n基础护理前先确认三件事。",
    "## 二、优化版口播逐字稿\n今天只介绍已确认的服务边界，未确认价格与效果继续待补。",
    "## 三、优化版拍摄脚本\n0-3秒标题卡；3-20秒真人口播；只拍授权区域。",
    "## 四、拍摄注意事项\n不出现顾客正脸，不展示未授权素材。",
    "## 五、优化版剪辑EDL\n保留真实口播，字幕逐字核对，未知内容不补写。",
    "## 六、优化版发布策略\n发布前核对标题、字幕与事实边界。",
    "## 七、投流建议\n只做测试建议，不执行投流；预算与账户状态待确认。",
    "## 八、核心改进点\n缩短开场并强化真实证据，结果以发布后数据验证。"
  ].join("\n");
  return `${sections}\n${"每项建议都必须回到本轮真实画面与口播证据，未知事实保持待补并在发布后验证。".repeat(30)}`;
}

void main();

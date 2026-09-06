import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runAgent, type LlmProvider } from "../packages/agent/src/index.js";
import { DomesticChatProvider } from "../apps/api/src/services/domestic-chat-provider.js";
import { buildBeautyIndustryRunInput, type BeautyIndustryProfile } from "../apps/api/src/products/beauty-industry/profile.js";
import {
  applyBeautyTopicVerifiedBrief,
  evaluateBeautyTopicEvidence,
  type BeautyTopicWorkflowInput
} from "../apps/api/src/products/beauty-industry/topic-evidence.js";
import { assertBeautyWorkflowRuntimeResult } from "../apps/api/src/products/beauty-industry/output-contract.js";
import { BEAUTY_WORKFLOWS, buildBeautyWorkflowPrompt } from "../apps/api/src/products/beauty-industry/workflows.js";
import { classifyBeautyTopicExecutionFailure } from "../apps/api/src/products/beauty-industry/topic-errors.js";

const REQUEST_FINGERPRINT = "4e78048f026175e8";
const SAFE_POLLUTION_PATTERNS = [
  { category: "foreign_food_industry", pattern: /餐饮|外卖|牛肉面|火锅|烧烤/i },
  { category: "founder_ip_module", pattern: /创始人\s*IP/i },
  { category: "internal_ai_tool_marker", pattern: /AI工具/i },
  { category: "legacy_brand_marker", pattern: /兰琪|枕水江南/i },
  { category: "acceptance_tenant_marker", pattern: /验收[AB]店|tenant(?:Id|Key)?/i }
] as const;

const workflow: BeautyTopicWorkflowInput = {
  // The controlled acceptance workspace historically exposed this synthetic
  // tenant label as the structured subject identity. It is a provenance marker,
  // not customer content, and must never be copied into the product result.
  identity: "验收A店",
  targetCustomer: "附近关注日常皮肤护理的成年顾客",
  acquisitionGoal: "获得合规到店咨询",
  offer: "基础补水护理",
  accountStage: "起号测试期",
  industry: "皮肤管理",
  benchmarkAccounts: ["同城公开账号线索"],
  transcriptDocumentIds: [],
  sourceSelection: { industry: true, benchmark: true, transcript: false, videoReview: false }
};

const profile: BeautyIndustryProfile = {
  segment: "skin_management",
  operationType: "single_store",
  operatingStage: "startup",
  services: ["基础补水护理"],
  targetCustomers: workflow.targetCustomer,
  channels: ["抖音"],
  acquisitionGoal: workflow.acquisitionGoal,
  factBoundaries: "不编造价格、疗效、顾客案例或经营数据",
  source: "user_confirmed",
  confirmationStatus: "confirmed",
  version: 1,
  confirmedAt: "2026-08-26T00:00:00.000Z"
};

function pollutionCategories(value: string): string[] {
  return SAFE_POLLUTION_PATTERNS.filter(({ pattern }) => pattern.test(value)).map(({ category }) => category);
}

async function main(): Promise<void> {
  process.env.LLM_MOCK_MODE = "true";
  process.env.USE_MOCK_LLM = "false";

  const evidence = evaluateBeautyTopicEvidence({
    profileIndustry: "皮肤管理",
    workflow,
    documents: [],
    videoReview: null
  });
  assert.equal(evidence.sourceCount, 2, "the regression fixture must have exactly two usable sources");
  assert.equal(evidence.canGenerate, true, "2/4 sources with the minimum verified brief must be admitted");
  assert.match(evidence.directive, /资料不足的来源：私有知识与客户问题、自身账号数据复盘/);

  const runInput = buildBeautyIndustryRunInput({
    question: "请围绕已确认的基础补水护理与附近成年顾客生成第一版 TOP10 选题。",
    profile,
    mode: "professional",
    topicEvidenceContext: evidence.directive
  });
  const composed = await buildBeautyWorkflowPrompt("topic_inspiration");
  const rawOutputs: string[] = [];
  const controlledMock = new DomesticChatProvider({
    providerName: "deepseek",
    model: "deepseek-v4-pro",
    timeoutMs: 1_000,
    domesticNetworkOnly: true,
    allowedHosts: []
  });
  const provider: LlmProvider = {
    name: controlledMock.name,
    async complete(messages, options) {
      const output = await controlledMock.complete(messages, options);
      rawOutputs.push(output);
      return output;
    }
  };

  const agentResult = await runAgent({
    tenantId: "beauty-by18-synthetic-tenant",
    userId: "beauty-by18-synthetic-user",
    role: "owner",
    planCode: "local_premium",
    input: runInput,
    requestedSkillId: BEAUTY_WORKFLOWS.topics.primarySkillId,
    capabilityId: BEAUTY_WORKFLOWS.topics.capabilityId,
    capabilityLocked: true,
    promptCompositionPolicy: "locked_product_workflow",
    deliveryPolicy: "clarify",
    skillPrompt: composed.prompt,
    skillVersionOverride: composed.version,
    tenantProfile: {
      tenantId: "beauty-by18-synthetic-tenant",
      tenantName: "本店",
      tenantType: "local_business",
      industry: "皮肤管理",
      data: { synthetic: true }
    },
    channel: "h5"
  }, provider);
  const productResult = applyBeautyTopicVerifiedBrief({
    answerText: agentResult.answer,
    qualityFlags: agentResult.qualityFlags
  }, workflow);
  assert.equal(agentResult.qualityFlags.includes("topic_final_delivery_rebuilt"), false, "beauty output must not be replaced by the shared topic template");
  assert.match(productResult.answerText, /本轮只按 2\/4 个真实可用来源形成第一版/);

  const rawPollution = pollutionCategories(rawOutputs.join("\n"));
  const postProcessPollution = pollutionCategories(productResult.answerText);
  if (rawPollution.length || postProcessPollution.length) {
    console.error(JSON.stringify({
      event: "beauty_topic_two_source_red_provenance",
      requestFingerprint: REQUEST_FINGERPRINT,
      sourceCount: evidence.sourceCount,
      rawProviderCategories: rawPollution,
      postProcessCategories: postProcessPollution,
      qualityFlagCategories: agentResult.qualityFlags.filter((flag) => /topic_final_delivery|cross_industry|wrong_|internal/i.test(flag))
    }));
  }

  assert.deepEqual(rawPollution, [], "controlled Provider output must not contain foreign/internal markers");
  assert.deepEqual(postProcessPollution, [], "Agent post-processing must not inject foreign/internal markers");
  assert.match(rawOutputs[0] ?? "", /行业与用户热点：已启用/);
  assert.match(rawOutputs[0] ?? "", /同行与对标内容：已启用/);
  assert.match(rawOutputs[0] ?? "", /私有知识与客户问题：待补/);
  assert.match(rawOutputs[0] ?? "", /自身账号数据复盘：待补/);
  assert.match(rawOutputs[0] ?? "", /本轮只按 2\/4 个真实可用来源形成第一版/);
  await assertBeautyWorkflowRuntimeResult({
    capabilityId: BEAUTY_WORKFLOWS.topics.capabilityId,
    expectedSkillId: BEAUTY_WORKFLOWS.topics.primarySkillId,
    expectedSkillVersion: composed.version,
    result: {
      capabilityId: BEAUTY_WORKFLOWS.topics.capabilityId,
      skillId: agentResult.skillId,
      skillVersion: agentResult.skillVersion,
      answerText: productResult.answerText,
      deliveryStatus: agentResult.deliveryStatus === "needs_input" ? "needs_input" : "completed",
      qualityFlags: productResult.qualityFlags,
      providerFailure: agentResult.providerFailure
    },
    observedProviderOutputs: rawOutputs,
    replay: false,
    taskFactSource: runInput
  });

  const fourSourceOutput = await controlledMock.complete([
    { role: "system", content: composed.prompt },
    {
      role: "user",
      content: [
        "【固定美业能力】topic_inspiration",
        "本轮获客目标：获得合规到店咨询。",
        "目标顾客：附近关注日常护理的成年顾客。",
        "细分赛道：皮肤管理。",
        "账号阶段：增长期。",
        "已启用且有可用资料的来源：私有知识与客户问题、行业与用户热点、自身账号数据复盘、同行与对标内容。"
      ].join("\n")
    }
  ]);
  assert.match(fourSourceOutput, /本轮只按 4\/4 个真实可用来源形成第一版/);
  assert.doesNotMatch(fourSourceOutput, /(?:私有知识与客户问题|行业与用户热点|自身账号数据复盘|同行与对标内容)：待补/);
  await assertBeautyWorkflowRuntimeResult({
    capabilityId: BEAUTY_WORKFLOWS.topics.capabilityId,
    expectedSkillId: BEAUTY_WORKFLOWS.topics.primarySkillId,
    expectedSkillVersion: composed.version,
    result: {
      capabilityId: BEAUTY_WORKFLOWS.topics.capabilityId,
      skillId: BEAUTY_WORKFLOWS.topics.primarySkillId,
      skillVersion: composed.version,
      answerText: fourSourceOutput,
      deliveryStatus: "completed",
      qualityFlags: []
    },
    observedProviderOutputs: [fourSourceOutput],
    replay: false
  });

  assert.throws(
    () => evaluateBeautyTopicEvidence({
      profileIndustry: "皮肤管理",
      workflow: { ...workflow, sourceSelection: { industry: false, benchmark: false, transcript: false, videoReview: false } },
      documents: [],
      videoReview: null
    }),
    /beauty_topic_sources_missing/,
    "zero usable sources must fail before Provider"
  );
  await assert.rejects(
    () => assertBeautyWorkflowRuntimeResult({
      capabilityId: BEAUTY_WORKFLOWS.topics.capabilityId,
      expectedSkillId: BEAUTY_WORKFLOWS.topics.primarySkillId,
      expectedSkillVersion: composed.version,
      result: {
        capabilityId: BEAUTY_WORKFLOWS.topics.capabilityId,
        skillId: BEAUTY_WORKFLOWS.topics.primarySkillId,
        skillVersion: composed.version,
        answerText: `${productResult.answerText}\n内部来源：tenantKey=blocked`,
        deliveryStatus: "completed",
        qualityFlags: []
      },
      observedProviderOutputs: [`${rawOutputs[0]}\n内部来源：tenantKey=blocked`],
      replay: false
    }),
    /foreign_industry_or_internal/,
    "foreign/internal output must remain fail-closed"
  );
  await assert.rejects(
    () => assertBeautyWorkflowRuntimeResult({
      capabilityId: BEAUTY_WORKFLOWS.topics.capabilityId,
      expectedSkillId: BEAUTY_WORKFLOWS.topics.primarySkillId,
      expectedSkillVersion: composed.version,
      result: {
        capabilityId: BEAUTY_WORKFLOWS.topics.capabilityId,
        skillId: BEAUTY_WORKFLOWS.topics.primarySkillId,
        skillVersion: composed.version,
        answerText: "只有两条选题，缺少正式四来源与三关结构。",
        deliveryStatus: "completed",
        qualityFlags: []
      },
      observedProviderOutputs: ["只有两条选题，缺少正式四来源与三关结构。"],
      replay: false
    }),
    /beauty_workflow_output_contract_failed/,
    "structurally incomplete output must remain fail-closed"
  );

  const routeSource = readFileSync(new URL("../apps/api/src/routes/beauty-industry.ts", import.meta.url), "utf8");
  const errorSource = readFileSync(new URL("../apps/api/src/products/beauty-industry/topic-errors.ts", import.meta.url), "utf8");
  for (const errorCode of [
    "beauty_topic_output_pollution",
    "beauty_topic_output_structure_invalid",
    "beauty_topic_provider_failed"
  ]) {
    assert.match(`${routeSource}\n${errorSource}`, new RegExp(errorCode), `topic error mapping missing: ${errorCode}`);
  }
  assert.doesNotMatch(
    routeSource,
    /message:\s*toolName === "beauty\.topic_ideas"[\s\S]{0,400}核对标为待补或待核验的来源后重试/,
    "all topic output failures must not be misreported as missing sources"
  );
  assert.deepEqual(
    classifyBeautyTopicExecutionFailure("beauty_workflow_output_foreign_module_failed:foreign_industry_or_internal"),
    {
      status: 502,
      error: "beauty_topic_output_pollution",
      category: "pollution",
      message: "系统未生成有效选题：结果包含跨行业或内部测试标记，已安全拦截、未保存并释放预留积分。当前四来源资料仍保留，无需重复点击。",
      retryable: false
    }
  );
  assert.equal(classifyBeautyTopicExecutionFailure("beauty_workflow_output_contract_failed:missing_TOP10")?.category, "structure");
  assert.equal(classifyBeautyTopicExecutionFailure("provider_failure:timed_out")?.category, "provider");
  assert.equal(classifyBeautyTopicExecutionFailure("beauty_workflow_output_quality_failed:rubric_fact_retention_weak")?.category, "validation");

  process.env.LLM_MOCK_MODE = "false";
  console.log("beauty_industry_topic_two_source_error_p1_smoke:PASS");
}

main().catch((error) => {
  process.env.LLM_MOCK_MODE = "false";
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

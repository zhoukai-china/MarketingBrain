import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runAgent } from "../packages/agent/src/index.js";
import { DomesticChatProvider } from "../apps/api/src/services/domestic-chat-provider.js";
import { buildBeautyIndustryRunInput } from "../apps/api/src/products/beauty-industry/profile.js";
import { assertBeautyWorkflowRuntimeResult } from "../apps/api/src/products/beauty-industry/output-contract.js";
import { buildBeautyWorkflowPrompt } from "../apps/api/src/products/beauty-industry/workflows.js";
import { assertBeautySalesProfessionalInput, inspectBeautySalesProfessionalInput } from "../apps/api/src/products/beauty-industry/sales-workflow.js";

const tenantProfile = {
  tenantId: "beauty-user-path-p1-tenant",
  tenantName: "合成美业测试门店",
  tenantType: "local_business" as const,
  industry: "生活美容"
};

async function verifyVideoDataUserPathContract(): Promise<void> {
  const parsedEvidence = await readFile(new URL("./fixtures/beauty-video-data-user-path-p1.csv", import.meta.url), "utf8");
  const input = buildBeautyIndustryRunInput({
    question: "复盘这份视频号动态数据，保留文件中的真实数值并给出下周期动作。",
    profile: null,
    mode: "professional",
    professionalOptions: {
      platform: "视频号",
      contentStructure: "作品、观看、发布时间、停留、互动、咨询和自然/付费口径均来自已解析文件",
      parsedEvidence: [
        "【业务文件解析结果】",
        "文件：beauty-video-data-user-path-p1.csv",
        "类型：text/csv",
        "文件正文/数据：",
        parsedEvidence
      ].join("\n"),
      parseStatus: "parsed",
      sourceFilename: "beauty-video-data-user-path-p1.csv"
    }
  });
  const composed = await buildBeautyWorkflowPrompt("video_data_review");
  let providerCalls = 0;
  const result = await runAgent({
    tenantId: tenantProfile.tenantId,
    userId: "beauty-user-path-p1-user",
    role: "owner",
    planCode: "local_standard",
    requestedSkillId: "baolu_review_engine",
    capabilityId: "video_data_review",
    capabilityLocked: true,
    input,
    skillPrompt: composed.prompt,
    skillVersionOverride: composed.version,
    tenantProfile,
    channel: "h5",
    deliveryPolicy: "clarify"
  }, {
    name: "forbidden-paid-provider",
    async complete() {
      providerCalls += 1;
      throw new Error("video data review must remain deterministic");
    }
  });
  assert.equal(providerCalls, 0, "video data review must not call a Provider");
  assert.ok(result.qualityFlags.includes("video_table_review_direct"));
  assert.equal(result.qualityFlags.includes("rubric_fact_retention_weak"), false,
    `a deterministic report that retains the formal evidence receipt must not be rejected: ${result.qualityFlags.join(",")}`);
  for (const fact of ["4321", "47.5%", "62.4%", "4.2秒", "业务转化合计 251"]) {
    assert.match(result.answer, new RegExp(fact.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `missing core video fact: ${fact}`);
  }
  await assertBeautyWorkflowRuntimeResult({
    capabilityId: "video_data_review",
    expectedSkillId: "baolu_review_engine",
    expectedSkillVersion: composed.version,
    result: {
      capabilityId: "video_data_review",
      skillId: result.skillId,
      skillVersion: result.skillVersion,
      answerText: result.answer,
      deliveryStatus: result.deliveryStatus === "needs_input" ? "needs_input" : "completed",
      qualityFlags: result.qualityFlags,
      creditCost: result.creditCost,
      providerFailure: result.providerFailure
    },
    observedProviderOutputs: [],
    replay: false,
    taskFactSource: input
  });
}

async function verifyBeautySalesUserPathContract(): Promise<void> {
  const originalMockMode = process.env.LLM_MOCK_MODE;
  const originalUseMock = process.env.USE_MOCK_LLM;
  process.env.LLM_MOCK_MODE = "true";
  process.env.USE_MOCK_LLM = "true";
  try {
    const input = buildBeautyIndustryRunInput({
      question: "客户犹豫不下单 怎么办",
      profile: null,
      mode: "quick"
    });
    const composed = await buildBeautyWorkflowPrompt("beauty_sales");
    const provider = new DomesticChatProvider({
      providerName: "deepseek",
      model: "deepseek-v4-pro",
      timeoutMs: 1_000,
      domesticNetworkOnly: true,
      allowedHosts: []
    });
    const result = await runAgent({
      tenantId: tenantProfile.tenantId,
      userId: "beauty-user-path-p1-user",
      role: "owner",
      planCode: "local_standard",
      requestedSkillId: "sales_growth_advisor",
      capabilityId: "beauty_sales",
      capabilityLocked: true,
      input,
      skillPrompt: composed.prompt,
      skillVersionOverride: composed.version,
      tenantProfile,
      channel: "h5",
      deliveryPolicy: "clarify"
    }, provider);
    for (const term of ["建议先这样回复", "为什么这样回", "顾客可能的下一句", "你接下来问什么", "当前判断", "异议", "核心破局点", "推荐回复", "客户可能回复与预判应对", "下一步动作", "犹豫", "未下单"]) {
      assert.match(result.answer, new RegExp(term), `sales result missing user-path contract term: ${term}`);
    }
    assert.doesNotMatch(result.answer, /皮肤管理产品|已确认的项目类别/, "short generic objection input must not acquire invented project facts");
    const validation = await assertBeautyWorkflowRuntimeResult({
      capabilityId: "beauty_sales",
      expectedSkillId: "sales_growth_advisor",
      expectedSkillVersion: composed.version,
      result: {
        capabilityId: "beauty_sales",
        skillId: result.skillId,
        skillVersion: result.skillVersion,
        answerText: result.answer,
        deliveryStatus: result.deliveryStatus === "needs_input" ? "needs_input" : "completed",
        qualityFlags: result.qualityFlags,
        creditCost: result.creditCost,
        providerFailure: result.providerFailure
      },
      observedProviderOutputs: [result.answer],
      replay: false,
      taskFactSource: input
    });
    assert.equal(validation.structuredDelivery?.version, "beauty-sales-delivery-v1");
    if (validation.structuredDelivery?.version !== "beauty-sales-delivery-v1") throw new Error("sales structured delivery missing");
    assert.equal(validation.structuredDelivery.resultType, "quick_response");
    assert.equal(validation.structuredDelivery.customerDeliverable.copyMarkdown, validation.structuredDelivery.customerDeliverable.primaryReply);
    assert.doesNotMatch(validation.structuredDelivery.customerDeliverable.copyMarkdown, /当前判断|核心破局点|mock|合同|回执|待补|Schema|Eval/i);

    const missing = inspectBeautySalesProfessionalInput("professional", { project: "皮肤管理项目" });
    assert.deepEqual(missing, ["priceBoundary", "customerConcern", "communicationStage", "allowedNextAction"]);
    assert.throws(() => assertBeautySalesProfessionalInput("professional", { project: "皮肤管理项目" }), /beauty_sales_professional_fields_required/);
    assert.doesNotThrow(() => assertBeautySalesProfessionalInput("professional", {
      project: "皮肤管理项目",
      priceBoundary: "只使用已确认价目表，不承诺额外优惠",
      customerConcern: "顾客说想再考虑是否适合",
      communicationStage: "首次咨询后",
      allowedNextAction: "询问是否需要已确认项目说明"
    }));
  } finally {
    if (originalMockMode === undefined) delete process.env.LLM_MOCK_MODE;
    else process.env.LLM_MOCK_MODE = originalMockMode;
    if (originalUseMock === undefined) delete process.env.USE_MOCK_LLM;
    else process.env.USE_MOCK_LLM = originalUseMock;
  }
}

async function main(): Promise<void> {
  const failures: string[] = [];
  for (const [name, check] of [
    ["video_data_review", verifyVideoDataUserPathContract],
    ["beauty_sales", verifyBeautySalesUserPathContract]
  ] as const) {
    try {
      await check();
    } catch (error) {
      failures.push(`${name}:${error instanceof Error ? error.message : String(error)}`);
    }
  }
  assert.deepEqual(failures, [], failures.join("\n"));
  console.log("BEAUTY_USER_PATH_CONTRACT_P1_SMOKE_OK capabilities=2 provider=0");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

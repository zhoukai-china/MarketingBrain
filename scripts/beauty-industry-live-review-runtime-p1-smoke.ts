import assert from "node:assert/strict";
import { DomesticChatProvider } from "../apps/api/src/services/domestic-chat-provider.js";
import {
  BEAUTY_LIVE_REVIEW_INPUT_SCHEMA,
  BEAUTY_LIVE_REVIEW_WORKFLOW,
  BEAUTY_LIVE_REVIEW_WORKFLOW_VERSION,
  assessBeautyLiveReviewReadiness,
  buildBeautyLiveReviewWorkflowDirective,
  hasBeautyLiveDataRecords,
  readBeautyLiveReviewWorkflow
} from "../apps/api/src/products/beauty-industry/live-review-workflow.js";
import {
  getBeautyIndustryToolRegistration,
  runBeautyIndustryMcpTool
} from "../apps/api/src/products/beauty-industry/mcp-adapter.js";
import { assertBeautyWorkflowRuntimeResult } from "../apps/api/src/products/beauty-industry/output-contract.js";
import { buildBeautyWorkflowPrompt } from "../apps/api/src/products/beauty-industry/workflows.js";

process.env.LLM_MOCK_MODE = "true";

async function main() {
  const workflow = readBeautyLiveReviewWorkflow({
    version: BEAUTY_LIVE_REVIEW_WORKFLOW_VERSION,
    scenario: "product",
    platform: "抖音",
    sessionTitle: "脱敏测试晚场",
    sessionTime: "2026-08-24 19:00-20:00",
    businessObjective: "核对项目讲解后的有效咨询承接",
    liveData: "场观: 320\n平均停留: 42秒\n评论: 18\n有效咨询: 7\n确认预约: 2",
    recordingTranscript: "00:00 主播说明本场只介绍已确认的日常护理流程。",
    scriptPlan: "开场说明范围；中段讲服务流程；结尾承接咨询。",
    interactionEvidence: "用户已脱敏记录：流程相关问题集中在中段。",
    projectEvidence: "本轮只确认日常护理流程，不提供价格、疗效或顾客案例。",
    conversionDefinition: "有效咨询为主动询问流程或预约；确认预约以门店台账为准。",
    visualEvidence: "用户确认：单人出镜；其他布景和陈列待补。",
    factBoundary: "价格、优惠、疗效、案例、顾客身份和未提供数据均不得推断。"
  });
  assert.equal(BEAUTY_LIVE_REVIEW_WORKFLOW.primarySkillId, "baolu_live_review_engine");
  assert.equal(BEAUTY_LIVE_REVIEW_WORKFLOW.constraintSkillIds[0], "beauty-industry-compliance");
  assert.equal(hasBeautyLiveDataRecords(workflow.liveData || ""), true);
  const ready = assessBeautyLiveReviewReadiness(workflow);
  assert.equal(ready.executionReady, true);
  assert.equal(ready.degradedModules.length, 0);
  assert.match(buildBeautyLiveReviewWorkflowDirective(workflow), /数据=已提供；转写=已提供；计划=已提供；画面=用户已确认/);

  const transcriptOnly = readBeautyLiveReviewWorkflow({
    ...workflow,
    liveData: undefined,
    scriptPlan: undefined,
    visualEvidence: undefined
  });
  const degraded = assessBeautyLiveReviewReadiness(transcriptOnly);
  assert.equal(degraded.executionReady, true);
  assert.ok(degraded.degradedModules.some((item) => item.includes("核心数据")));
  assert.ok(degraded.degradedModules.some((item) => item.includes("计划执行偏差")));
  assert.ok(degraded.degradedModules.some((item) => item.includes("人货场")));

  for (const invalid of [
    { ...workflow, liveData: undefined, recordingTranscript: undefined },
    { ...workflow, liveData: "只有说明没有真实数值", recordingTranscript: undefined },
    { ...workflow, parseStatus: "parsed", sourceFilename: undefined },
    { ...workflow, sourceFilename: "other-tenant.csv", parseStatus: undefined },
    { ...workflow, version: "live_review_workflow_v0" },
    { ...workflow, unknownField: "forbidden" }
  ]) {
    assert.throws(() => readBeautyLiveReviewWorkflow(invalid), /beauty_live_review_workflow_invalid/);
  }

  const registration = getBeautyIndustryToolRegistration("beauty.live_review");
  assert.equal(registration.inputSchema, BEAUTY_LIVE_REVIEW_INPUT_SCHEMA);
  let captured: any;
  const result = await runBeautyIndustryMcpTool({
    context: {
      credentialId: "credential-live-review",
      tenantId: "tenant-live-review-a",
      userId: "user-live-review-a",
      productCode: "beauty-industry",
      operatingEntityId: "tenant-live-review-a",
      scopes: ["acquisition:live-review"],
      entitled: true
    },
    toolName: "beauty.live_review",
    arguments: { question: "请按正式八模块复盘当前直播场次。", requestId: "live-review-runtime-001", mode: "professional", liveReviewWorkflow: workflow },
    execute: async (spec) => {
      captured = spec;
      return { status: "succeeded", text: "captured", runId: "run-live-review", creditCost: 0 };
    }
  });
  assert.equal(result.status, "succeeded");
  assert.deepEqual(captured.liveReviewWorkflow, workflow);
  assert.equal(captured.capabilityId, "live_review");
  assert.equal(captured.skillId, "baolu_live_review_engine");
  assert.equal(captured.professionalOptions, undefined);

  await assert.rejects(() => runBeautyIndustryMcpTool({
    context: { credentialId: "credential-live-review", tenantId: "tenant-live-review-a", userId: "user-live-review-a", productCode: "beauty-industry", operatingEntityId: "tenant-live-review-a", scopes: ["acquisition:live-review"], entitled: true },
    toolName: "beauty.live_review",
    arguments: { question: "请复盘，但故意缺少正式工作流。", requestId: "live-review-runtime-002", mode: "professional" },
    execute: async () => ({ status: "succeeded", text: "unexpected", runId: "unexpected", creditCost: 0 })
  }), /mcp_argument_invalid:liveReviewWorkflow/);

  const composed = await buildBeautyWorkflowPrompt("live_review");
  const provider = new DomesticChatProvider({ providerName: "deepseek", model: "deepseek-v4-pro", timeoutMs: 1_000, domesticNetworkOnly: true, allowedHosts: [] });
  const answer = await provider.complete([{ role: "system", content: composed.prompt }, { role: "user", content: buildBeautyLiveReviewWorkflowDirective(workflow) }]);
  await assertBeautyWorkflowRuntimeResult({
    capabilityId: "live_review",
    expectedSkillId: "baolu_live_review_engine",
    expectedSkillVersion: composed.version,
    result: { capabilityId: "live_review", skillId: "baolu_live_review_engine", skillVersion: composed.version, answerText: answer, deliveryStatus: "completed", qualityFlags: [] },
    observedProviderOutputs: [answer],
    replay: false
  });
  assert.doesNotMatch(answer, /餐饮|外卖|创始人\s*IP|剪辑EDL|拍摄脚本/);

  console.log("BEAUTY_LIVE_REVIEW_RUNTIME_P1_SMOKE_OK provider=0 schema=shared evidence=staged output=eight_modules");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

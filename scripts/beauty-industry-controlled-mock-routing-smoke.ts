import { strict as assert } from "node:assert";
import { DomesticChatProvider } from "../apps/api/src/services/domestic-chat-provider.ts";
import { parseBeautyImageDirections } from "../apps/api/src/products/beauty-industry/media-contract.ts";
import { assertBeautyWorkflowRuntimeResult } from "../apps/api/src/products/beauty-industry/output-contract.ts";
import { buildBeautyWorkflowPrompt, BEAUTY_WORKFLOWS } from "../apps/api/src/products/beauty-industry/workflows.ts";
import { tryParseBeautyXhsDelivery } from "../apps/api/src/products/beauty-industry/xhs-delivery.ts";
import { readFileSync } from "node:fs";
import { runAgent } from "../packages/agent/src/index.ts";

process.env.LLM_MOCK_MODE = "true";

const beautyExecutionSource = readFileSync(new URL("../apps/api/src/products/beauty-industry/execution.ts", import.meta.url), "utf8");
const agentRuntimeSource = readFileSync(new URL("../packages/agent/src/index.ts", import.meta.url), "utf8");
assert.match(beautyExecutionSource, /deliveryPolicy:\s*params\.capabilityId === "content_plan" \? "draft_with_placeholders" : "clarify"/u,
  "locked beauty content must bypass its generic clarification path without forcing topic fixtures into a deterministic fallback");
assert.match(agentRuntimeSource, /usesFixedBeautyWorkflow\s*\?\s*cleanFixedBeautyWorkflowAnswer\(params\.rawAnswer\)[\s\S]{0,180}:\s*normalizeAgentAnswer/u,
  "locked beauty output headings must bypass shared content normalizers before formal parsing");
assert.match(agentRuntimeSource, /if \(usesFixedBeautyWorkflow\)[\s\S]{0,500}return answer;/u,
  "locked beauty workflows must remain single-pass and bypass shared repair or deterministic fallback");

const provider = new DomesticChatProvider({
  providerName: "deepseek",
  model: "deepseek-v4-pro",
  timeoutMs: 1_000,
  domesticNetworkOnly: true,
  allowedHosts: []
});

const expectations = [
  ["xiaohongshu", ["客户可复制成品", "门店制作说明", "质量与合规检查", "标题候选", "正文", "话题标签", "配图方向一｜封面图", "配图方向二｜内容图", "配图方向三｜互动承接图"]],
  ["topics", ["用户可用TOP10", "选题策略摘要", "来源与质量审核", "四大来源自动采集结果", "三关筛选后的TOP10", "配比调整建议"]],
  ["content-ten", ["短结论", "一、选题", "二、口播逐字稿", "十、投流建议", "质量与合规检查"]],
  ["video-data-review", ["数据质量审计", "视频分层", "完播率深层归因", "综合诊断结论"]],
  ["video-content-review", ["视频基本信息", "现有版本诊断", "一、优化版选题定位", "八、核心改进点"]],
  ["live-script", ["短结论", "主播口播稿", "下播后跟进", "复盘指标"]],
  ["live-review", ["直播数据复盘报告", "一、核心数据速览", "八、下次直播调整清单"]],
  ["sales", ["当前判断", "核心破局点", "推荐回复", "下一步动作"]]
] as const;

async function main() {
  for (const [workflowId, required] of expectations) {
    const workflow = BEAUTY_WORKFLOWS[workflowId];
    const composed = await buildBeautyWorkflowPrompt(workflow.capabilityId);
    const answer = await provider.complete([
      { role: "system", content: composed.prompt },
      { role: "user", content: "用户要完成一个品牌中立的美业任务。下一步可进入视频复盘，但当前显式工具不得切换。" }
    ]);
    for (const term of required) assert.match(answer, new RegExp(term), `${workflowId} missing ${term}`);
    const validation = await assertBeautyWorkflowRuntimeResult({
        capabilityId: workflow.capabilityId,
        expectedSkillId: workflow.primarySkillId,
        expectedSkillVersion: composed.version,
        result: {
          capabilityId: workflow.capabilityId,
          skillId: workflow.primarySkillId,
          skillVersion: composed.version,
          answerText: answer,
          deliveryStatus: "completed",
          qualityFlags: []
        },
        observedProviderOutputs: [answer],
        replay: false
    }).catch((error) => { throw new Error(`${workflowId}:${error instanceof Error ? error.message : String(error)}`); });
    if (workflowId === "content-ten") {
      assert.equal(validation.structuredDelivery?.preview, true);
      assert.match(validation.structuredDelivery?.customerDeliverable.copyMarkdown ?? "", /十、投流建议/);
      assert.doesNotMatch(validation.structuredDelivery?.customerDeliverable.copyMarkdown ?? "", /质量与合规检查|流程预览|controlled|Schema|Eval|待补/iu);
      assert.match(validation.structuredDelivery?.productionNotes.markdown ?? "", /拍摄脚本/);
      assert.match(validation.structuredDelivery?.auditReceipt.markdown ?? "", /真实模型质量/);
      assert.doesNotMatch(validation.structuredDelivery?.customerDeliverable.copyMarkdown ?? "", /待补|待核验|核验|回执|Schema|Eval|供应商|受控流程/iu);
    }
    if (workflowId === "xiaohongshu") {
      assert.equal(parseBeautyImageDirections(answer, 3).length, 3, "xiaohongshu mock output must satisfy the production image prompt contract");
      const restored = tryParseBeautyXhsDelivery(answer, true);
      assert.equal(restored?.version, "beauty-xhs-delivery-v2", "persisted XHS output must reconstruct structured history delivery");
      assert.equal(restored?.preview, true);
      assert.doesNotMatch(restored?.customerDeliverable.copyMarkdown ?? "", /待补|待核验|回执|Schema|Eval|mock|受控流程/iu);
    }
    if (workflowId !== "video-data-review") assert.doesNotMatch(answer, /视频数据复盘报告/, `${workflowId} crossed into video data review`);
  }

  const contentWorkflow = BEAUTY_WORKFLOWS["content-ten"];
  const contentPrompt = await buildBeautyWorkflowPrompt(contentWorkflow.capabilityId);
  const contentResult = await runAgent({
    tenantId: "controlled-beauty-content-tenant",
    userId: "controlled-beauty-content-user",
    role: "owner",
    planCode: "local_premium",
    input: "围绕皮肤管理产品内容流程生成内容系统正式十件交付；目标顾客为附近关注日常皮肤管理的成年女性；本轮目标为了解服务边界并咨询；发布平台为抖音。",
    requestedSkillId: contentWorkflow.primarySkillId,
    capabilityId: contentWorkflow.capabilityId,
    capabilityLocked: true,
    promptCompositionPolicy: "locked_product_workflow",
    deliveryPolicy: "draft_with_placeholders",
    skillPrompt: contentPrompt.prompt,
    skillVersionOverride: contentPrompt.version,
    tenantProfile: { tenantId: "controlled-beauty-content-tenant", tenantName: "合成美业门店", tenantType: "local_business", industry: "生活美容" },
    channel: "workbuddy"
  }, provider);
  assert.match(contentResult.answer, /^## 质量与合规检查$/mu, "locked content output must preserve its audit heading through Agent finalization");
  assert.doesNotMatch(contentResult.answer, /中小企业老板|企业AI改造/iu, "locked content output must not enter generic enterprise clarification or fallback");

  const topicWorkflow = BEAUTY_WORKFLOWS.topics;
  const topicPrompt = await buildBeautyWorkflowPrompt(topicWorkflow.capabilityId);
  const topicResult = await runAgent({
    tenantId: "controlled-beauty-topic-tenant", userId: "controlled-beauty-topic-user", role: "owner", planCode: "local_premium",
    input: "为本店面向关于日常皮肤管理的女性用户生成视频选题。本轮获客目标：团购下单。细分赛道：皮肤管理。严格使用当前两类已确认来源并输出TOP10。",
    requestedSkillId: topicWorkflow.primarySkillId, capabilityId: topicWorkflow.capabilityId, capabilityLocked: true,
    promptCompositionPolicy: "locked_product_workflow", deliveryPolicy: "clarify", skillPrompt: topicPrompt.prompt, skillVersionOverride: topicPrompt.version,
    tenantProfile: { tenantId: "controlled-beauty-topic-tenant", tenantName: "合成美业门店", tenantType: "local_business", industry: "生活美容" }, channel: "workbuddy"
  }, provider);
  assert.equal(topicResult.qualityFlags.some((flag) => /fallback|deterministic_draft|deterministic_plan/i.test(flag)), false,
    `locked topics must not carry fallback flags: ${topicResult.qualityFlags.join(",")}`);

  await assert.rejects(
    () => provider.complete([
      { role: "system", content: "【固定美业能力】beauty_unknown_result" },
      { role: "user", content: "未知能力不得回退到旧通用内容模板。" }
    ]),
    /controlled_beauty_capability_fixture_missing:beauty_unknown_result/,
    "unknown fixed beauty capabilities must fail closed instead of using the legacy generic fallback"
  );

  process.env.LLM_MOCK_MODE = "false";
  process.env.USE_MOCK_LLM = "false";
  const unconfiguredProvider = new DomesticChatProvider({
    providerName: "deepseek",
    model: "deepseek-v4-pro",
    timeoutMs: 1_000,
    domesticNetworkOnly: true,
    allowedHosts: []
  });
  await assert.rejects(
    () => unconfiguredProvider.complete([{ role: "user", content: "不得在未配置正式模型时返回受控夹具。" }]),
    /provider_not_configured/,
    "an unconfigured production-mode provider must fail closed instead of returning controlled mock output"
  );

  console.log(`beauty industry controlled mock routing passed (${expectations.length} locked workflows)`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

import assert from "node:assert/strict";
import { buildAgentMessages } from "../packages/agent/src/index.js";
import { BEAUTY_WORKFLOWS, buildBeautyWorkflowPrompt } from "../apps/api/src/products/beauty-industry/workflows.js";

async function main(): Promise<void> {
  for (const [workflowId, workflow] of Object.entries(BEAUTY_WORKFLOWS)) {
    const composed = await buildBeautyWorkflowPrompt(workflow.capabilityId);
    assert.equal(composed.skillChain[0]?.skillId, workflow.primarySkillId, `${workflowId}:primary_order`);
    assert.deepEqual(composed.skillChain.slice(1).map((item) => item.skillId), workflow.constraintSkillIds, `${workflowId}:constraint_order`);
    assert.match(composed.prompt, /显式 capability 已由服务端锁定/);
    for (const skill of composed.skillChain) {
      assert.match(composed.prompt, new RegExp(skill.skillId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      assert.match(composed.version, new RegExp(`${skill.skillId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}@${skill.version.replaceAll(".", "\\.")}`));
    }
    const prepared = await buildAgentMessages({
      tenantId: "beauty-workflow-tenant",
      userId: "beauty-workflow-owner",
      role: "owner",
      planCode: "local_premium",
      input: "已确认是生活美容门店，本轮只使用已确认事实；缺失价格、疗效、案例和素材授权。",
      requestedSkillId: workflow.primarySkillId,
      capabilityId: workflow.capabilityId,
      capabilityLocked: true,
      promptCompositionPolicy: "locked_product_workflow",
      skillPrompt: composed.prompt,
      skillVersionOverride: composed.version,
      tenantProfile: { tenantId: "beauty-workflow-tenant", tenantName: "本店", tenantType: "local_business", industry: "生活美容", data: { synthetic: true } },
      channel: "admin"
    });
    const system = prepared.messages.find((item) => item.role === "system")?.content ?? "";
    assert.equal(prepared.skillId, workflow.primarySkillId, `${workflowId}:route_lock`);
    assert.equal(prepared.skillVersion, composed.version, `${workflowId}:version_trace`);
    for (const skill of composed.skillChain) assert.match(system, new RegExp(skill.skillId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${workflowId}:${skill.skillId}:prompt_missing`);
    if (workflowId === "content-ten") {
      assert.doesNotMatch(system, /样板输出参考|枕水江南|餐饮招商|山东|培训3天|月流水15万|毛利60%/, "content-ten:cross_product_example_contamination");
      assert.doesNotMatch(system, /思潼 企业AI增长飞轮的咨询师团队|产品体验契约/, "content-ten:generic_product_layers_present");
      assert.match(system, /baolu_content_creator 5\.0\.0/, "content-ten:v5_primary_skill_missing");
      assert.match(system, /beauty-industry-content-diff 1\.1\.0/, "content-ten:beauty_difference_missing");
      assert.match(system, /beauty-industry-compliance 1\.0\.0/, "content-ten:beauty_compliance_missing");
      assert.match(system, /客户上下文：[\s\S]*本店[\s\S]*生活美容/, "content-ten:tenant_context_missing");
      assert.match(system, /本次专项能力已由用户入口和服务端权限锁定|显式 capability 已由服务端锁定/, "content-ten:capability_lock_missing");
      assert.match(system, /## 二、口播逐字稿[\s\S]*开头3秒钩子：[\s\S]*## 四、拍摄脚本[\s\S]*镜头与字幕：[\s\S]*## 十、投流建议[\s\S]*复盘指标：/, "content-ten:exact_contract_skeleton_missing");
    }
    for (let repeat = 0; repeat < 3; repeat += 1) {
      assert.match(system, /医疗疗效承诺/);
      assert.match(system, /未确认价格\/案例/);
      assert.match(system, /跨行业内容/);
      assert.match(system, /未授权素材/);
      assert.match(system, /已执行外部动作/);
    }
  }
  const generic = await buildAgentMessages({
    tenantId: "generic-content-tenant",
    userId: "generic-content-owner",
    role: "owner",
    planCode: "local_premium",
    input: "请生成一个完整内容执行包。",
    requestedSkillId: "baolu_content_creator",
    capabilityId: "content_plan",
    capabilityLocked: true,
    tenantProfile: { tenantId: "generic-content-tenant", tenantName: "通用测试主体", tenantType: "local_business" },
    channel: "admin"
  });
  assert.match(generic.messages[0]?.content ?? "", /样板输出参考/, "generic_agent_examples_changed");

  const founder = await buildAgentMessages({
    tenantId: "founder-content-tenant",
    userId: "founder-content-owner",
    role: "owner",
    planCode: "local_premium",
    input: "【创始人IP获客内容生成】请根据已确认选题生成内容。",
    requestedSkillId: "founder_ip_content_creator",
    capabilityId: "content_plan",
    capabilityLocked: true,
    tenantProfile: { tenantId: "founder-content-tenant", tenantName: "本项目", tenantType: "personal_ip" },
    channel: "admin"
  });
  assert.match(founder.messages[0]?.content ?? "", /^你是创始人 IP 获客系统的内容生成器。/, "founder_clean_branch_changed");
  console.log(`beauty industry workflow composition smoke passed (${Object.keys(BEAUTY_WORKFLOWS).length} workflows, high-risk x3)`);
}

void main();

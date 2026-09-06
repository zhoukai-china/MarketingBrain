import { buildAgentMessages } from "../packages/agent/src/index.js";
import { buildBeautyIndustryRunInput, type BeautyIndustryProfile } from "../apps/api/src/products/beauty-industry/profile.js";
import { buildBeautyWorkflowPrompt } from "../apps/api/src/products/beauty-industry/workflows.js";
import { buildBeautyXhsTaskFactDirective } from "../apps/api/src/products/beauty-industry/xhs-task-facts.js";
import {
  BEAUTY_TEXT_BATCH_WORST_COST_CNY,
  getBeautyTextBudget
} from "../apps/api/src/products/beauty-industry/text-budget.js";
import assert from "node:assert/strict";

const profile: BeautyIndustryProfile = {
  segment: "lifestyle_beauty",
  operationType: "single_store",
  operatingStage: "growth",
  storeName: "本店",
  city: "杭州",
  services: ["基础清洁", "日常补水护理"],
  targetCustomers: "附近25至40岁上班族",
  channels: ["小红书", "抖音"],
  acquisitionGoal: "获得真实咨询并验证到店承接",
  factBoundaries: "不编价格、疗效、案例、顾客经历和未确认预约方式；不使用真实顾客资料。",
  source: "user_confirmed",
  confirmationStatus: "confirmed",
  version: 1,
  confirmedAt: "2026-08-24T00:00:00.000Z"
};

const cases = [
  ["topic_inspiration", "baolu_topics", "请为一家生活美容门店生成四个来源的获客选题。已确认：城市为杭州，服务为基础清洁和日常补水护理，目标顾客是附近25至40岁上班族，渠道为小红书和抖音；价格、疗效、案例与预约方式均未确认。"],
  ["content_plan", "baolu_content_creator", "请围绕‘第一次了解基础补水护理前先确认三件事’生成完整内容十件套。只使用已确认的生活美容服务范围，不编价格、疗效、案例或顾客经历；投流只给预览建议，不执行。"],
  ["beauty_xiaohongshu_package", "wechat-xhs-content-line", "生成一套夏季基础补水护理的小红书图文文字包，面向附近上班族，温暖真实，不出现顾客正脸。需要标题候选、正文、标签、互动承接和三张配图方向；价格、疗效、案例与真实门店场景均未确认。"],
  ["live_script", "live_script_planner", "生成一场生活美容门店直播话术，主题是基础清洁与日常补水护理流程介绍，受众为附近上班族。不得使用医疗、治疗、疗效承诺，不编价格和顾客案例；预约方式未确认时标待补。"],
  ["live_review", "baolu_live_review_engine", "复盘一场生活美容门店直播。已提供：观看人数320、平均停留42秒、评论18、私信咨询7、确认预约2；成交和到店数据未提供。请保留全部已提供字段，说明缺失边界并给下一轮改进。"],
  ["beauty_sales", "sales_growth_advisor", "顾客询问基础补水护理是否一次就能明显改善。请给门店员工一套合规回复和后续沟通步骤；项目价格、顾客肤况、疗效证据和预约方式都未确认。"]
] as const;

async function main() {
  const rows = [];
  for (const [capabilityId, skillId, question] of cases) {
    const workflowPrompt = await buildBeautyWorkflowPrompt(capabilityId);
    const input = buildBeautyIndustryRunInput({
      question,
      profile,
      mode: "quick",
      xhsTaskFactDirective: capabilityId === "beauty_xiaohongshu_package"
        ? buildBeautyXhsTaskFactDirective({ question })
        : undefined
    });
    const prepared = await buildAgentMessages({
      tenantId: "budget_profile_tenant",
      userId: "budget_profile_user",
      role: "owner",
      planCode: "local_premium",
      input,
      requestedSkillId: skillId,
      capabilityId,
      capabilityLocked: true,
      deliveryPolicy: "clarify",
      skillPrompt: workflowPrompt.prompt,
      skillVersionOverride: workflowPrompt.version,
      tenantProfile: {
        tenantId: "budget_profile_tenant",
        tenantName: "本店",
        tenantType: "local_business",
        industry: "生活美容",
        city: "杭州",
        data: { beautyIndustry: profile }
      },
      channel: "workbuddy"
    });
    const serialized = JSON.stringify(prepared.messages);
    const promptBytes = Buffer.byteLength(serialized, "utf8");
    const policy = getBeautyTextBudget(capabilityId, skillId);
    assert.ok(promptBytes <= policy.maxPromptBytes, `${capabilityId} prompt exceeded the versioned budget before Provider start:${promptBytes}/${policy.maxPromptBytes}`);
    rows.push({ capabilityId, skillId, messageCount: prepared.messages.length, promptBytes, maxPromptBytes: policy.maxPromptBytes, promptChars: serialized.length });
  }
  assert.ok(BEAUTY_TEXT_BATCH_WORST_COST_CNY <= 1);
  console.log(JSON.stringify({ status: "passed", batchWorstCostCny: BEAUTY_TEXT_BATCH_WORST_COST_CNY, rows }));
}

void main();

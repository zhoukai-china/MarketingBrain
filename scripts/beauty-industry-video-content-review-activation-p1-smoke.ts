import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AGENT_BY_ID } from "../apps/api/src/services/agent-definitions.js";
import {
  BEAUTY_INDUSTRY_SCOPES,
  getBeautyIndustryToolRegistration,
  listBeautyIndustryMcpTools,
  runBeautyIndustryMcpTool
} from "../apps/api/src/products/beauty-industry/mcp-adapter.js";
import { BEAUTY_WORKFLOWS } from "../apps/api/src/products/beauty-industry/workflows.js";

const workflow = BEAUTY_WORKFLOWS["video-content-review"];
assert.ok(workflow, "video content review is not in the executable workflow registry");
assert.equal(workflow.scope, "acquisition:video-content-review");
assert.equal(workflow.capabilityId, "shooting_editing");
assert.equal(workflow.primarySkillId, "baolu_content_creator");
assert.deepEqual(workflow.constraintSkillIds, ["beauty-industry-content-diff", "beauty-industry-compliance"]);
assert.equal(workflow.evidenceMode, "parsed_video");

assert.ok(BEAUTY_INDUSTRY_SCOPES.includes("acquisition:video-content-review"));
const registration = getBeautyIndustryToolRegistration("beauty.video_content_review");
assert.equal(registration.scope, "acquisition:video-content-review");
assert.equal(registration.capabilityId, "shooting_editing");
assert.match(JSON.stringify(registration.inputSchema), /videoContentWorkflow/);
const listed = listBeautyIndustryMcpTools({
  credentialId: "cred-by15",
  tenantId: "tenant-by15",
  userId: "user-by15",
  productCode: "beauty-industry",
  operatingEntityId: "tenant-by15",
  scopes: ["acquisition:video-content-review"],
  entitled: true
});
assert.deepEqual(listed.map((item) => item.name), ["beauty.video_content_review"]);

const agent = AGENT_BY_ID.get("agent_beauty_acquisition");
assert.ok(agent?.capabilities.some((item) => item.key === "shooting_editing"), "shooting_editing is not active for the beauty acquisition agent");

const page = readFileSync("apps/web/src/components/acquisition/BeautyVideoContentReviewWorkbench.tsx", "utf8");
assert.doesNotMatch(page, /待验证 · 不可执行|正式复盘当前不可执行|公开 scope.*保持关闭/);
assert.match(page, /开始正式内容复盘/);

const workflowInput = {
  version: "video_content_review_workflow_v1" as const,
  platform: "抖音",
  videoTitle: "基础护理边界说明",
  businessObjective: "获得合规咨询",
  targetAudience: "附近成年顾客",
  transcript: "本视频只介绍已确认的基础护理服务边界。",
  visualEvidence: "竖屏单人口播，背景为已授权门店区域，无顾客正脸。"
};
let captured: Record<string, unknown> | undefined;
runBeautyIndustryMcpTool({
  context: {
    credentialId: "cred-by15",
    tenantId: "tenant-by15",
    userId: "user-by15",
    productCode: "beauty-industry",
    operatingEntityId: "tenant-by15",
    scopes: ["acquisition:video-content-review"],
    entitled: true
  },
  toolName: "beauty.video_content_review",
  arguments: {
    question: "请依据本轮真实证据完成视频内容复盘。",
    requestId: "by15-workbuddy-contract-001",
    mode: "professional",
    videoContentWorkflow: workflowInput
  },
  execute: async (spec) => {
    captured = spec as unknown as Record<string, unknown>;
    return { status: "succeeded", text: "fixture", runId: "run-by15", creditCost: 0 };
  }
}).then(() => {
  assert.equal(captured?.capabilityId, "shooting_editing");
  assert.equal(captured?.skillId, "baolu_content_creator");
  assert.deepEqual(captured?.videoContentWorkflow, workflowInput);
  console.log("BEAUTY_VIDEO_CONTENT_REVIEW_ACTIVATION_P1_SMOKE_OK scope=active tool=active capability=active web_workbuddy_contract=shared provider_calls=0");
});

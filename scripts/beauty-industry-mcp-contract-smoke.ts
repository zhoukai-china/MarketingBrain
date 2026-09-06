import assert from "node:assert/strict";
import {
  BEAUTY_INDUSTRY_PRODUCT_CODE,
  listBeautyIndustryMcpTools,
  runBeautyIndustryMcpTool,
  type BeautyIndustryMcpContext
} from "../apps/api/src/products/beauty-industry/mcp-adapter.js";

async function main(): Promise<void> {
const context: BeautyIndustryMcpContext = {
  credentialId: "credential-beauty-a",
  tenantId: "tenant-beauty-a",
  userId: "user-beauty-a",
  productCode: BEAUTY_INDUSTRY_PRODUCT_CODE,
  operatingEntityId: "store-a",
  scopes: ["acquisition:topics", "acquisition:xhs", "acquisition:live"],
  entitled: true
};

const tools = listBeautyIndustryMcpTools(context);
assert.deepEqual(tools.map((tool) => tool.name), [
  "beauty.topic_ideas",
  "beauty.xiaohongshu_package",
  "beauty.live_script"
]);
assert.equal(JSON.stringify(tools).includes("兰琪"), false);
assert.equal(JSON.stringify(tools).includes("prompt"), false);
assert.equal(JSON.stringify(tools).includes("video_generate"), false);
assert.match(JSON.stringify(tools[0]?.inputSchema), /topicWorkflow/);
assert.match(JSON.stringify(tools[0]?.inputSchema), /sourceSelection/);

const calls: Array<Record<string, unknown>> = [];
const result = await runBeautyIndustryMcpTool({
  context,
  toolName: "beauty.topic_ideas",
  arguments: {
    question: "社区皮肤管理门店想做附近顾客获客，先从什么开始？",
    requestId: "request-1",
    topicWorkflow: {
      targetCustomer: "附近关注日常皮肤护理的成年女性",
      acquisitionGoal: "获取到店咨询",
      industry: "皮肤管理",
      benchmarkAccounts: [],
      transcriptDocumentIds: [],
      sourceSelection: { industry: true, benchmark: false, transcript: false, videoReview: false }
    }
  },
  execute: async (spec) => {
    calls.push(spec as unknown as Record<string, unknown>);
    return { status: "succeeded", text: "先确认目标顾客、可公开服务和到店承接方式。", runId: "run-1", creditCost: 1 };
  }
});
assert.equal(result.status, "succeeded");
assert.equal(calls.length, 1);
assert.equal(calls[0]?.channel, "mcp");
assert.equal(calls[0]?.productCode, BEAUTY_INDUSTRY_PRODUCT_CODE);
assert.equal(calls[0]?.tenantId, context.tenantId);
assert.equal(calls[0]?.credentialId, context.credentialId);
assert.equal(calls[0]?.capabilityId, "topic_inspiration");
assert.equal(calls[0]?.skillId, "baolu_topics");
assert.equal(calls[0]?.mode, "quick");
assert.deepEqual((calls[0]?.topicWorkflow as { sourceSelection?: unknown })?.sourceSelection, { industry: true, benchmark: false, transcript: false, videoReview: false });

const professionalCalls: Array<Record<string, unknown>> = [];
await runBeautyIndustryMcpTool({
  context,
  toolName: "beauty.xiaohongshu_package",
  arguments: {
    question: "为已确认的门店档案生成一组小红书图文",
    requestId: "request-professional-1",
    mode: "professional",
    professionalOptions: { project: "日常补水", platform: "小红书", tone: "温和专业", imageCount: 3 }
  },
  execute: async (spec) => {
    professionalCalls.push(spec as unknown as Record<string, unknown>);
    return { status: "succeeded", text: "已生成图文草稿。", runId: "run-professional", creditCost: 1 };
  }
});
assert.equal(professionalCalls[0]?.mode, "professional");
assert.deepEqual(professionalCalls[0]?.professionalOptions, { project: "日常补水", platform: "小红书", tone: "温和专业", imageCount: 3 });

const contentCalls: Array<Record<string, unknown>> = [];
await runBeautyIndustryMcpTool({
  context: { ...context, scopes: [...context.scopes, "acquisition:video-content"] },
  toolName: "beauty.content_ten_pack",
  arguments: {
    question: "围绕基础补水护理生成内容十件套",
    requestId: "request-content-ten-1",
    mode: "professional",
    contentWorkflow: {
      version: "content_workflow_v1",
      topic: "第一次做基础补水护理前先确认三件事",
      objective: "获得合规咨询",
      targetAudience: "附近关注日常皮肤护理的成年女性",
      platform: "抖音",
      format: "真人口播短视频",
      duration: "60秒内",
      presenter: "店长本人",
      projectFacts: "本店提供基础补水护理",
      shootingConstraints: "不出现顾客正脸"
    }
  },
  execute: async (spec) => {
    contentCalls.push(spec as unknown as Record<string, unknown>);
    return { status: "succeeded", text: "已生成内容十件套。", runId: "run-content-ten", creditCost: 1 };
  }
});
assert.equal(contentCalls[0]?.capabilityId, "content_plan");
assert.equal(contentCalls[0]?.skillId, "baolu_content_creator");
assert.equal((contentCalls[0]?.contentWorkflow as { version?: string })?.version, "content_workflow_v1");
assert.deepEqual(
  Object.keys(contentCalls[0]?.contentWorkflow as Record<string, unknown>),
  ["version", "topic", "objective", "targetAudience", "platform", "format", "duration", "presenter", "projectFacts", "shootingConstraints"]
);

await assert.rejects(
  () => runBeautyIndustryMcpTool({
    context: { ...context, scopes: [...context.scopes, "acquisition:video-content"] },
    toolName: "beauty.content_ten_pack",
    arguments: { question: "生成内容十件套", requestId: "missing-content-workflow" },
    execute: async () => ({ status: "succeeded", text: "bad", runId: "bad", creditCost: 0 })
  }),
  /mcp_argument_required:contentWorkflow/
);

for (let repeat = 0; repeat < 3; repeat += 1) {
  const locked: Array<Record<string, unknown>> = [];
  await runBeautyIndustryMcpTool({
    context,
    toolName: "beauty.xiaohongshu_package",
    arguments: {
      question: "请做日常补水的小红书图文；不要因为句子里提到直播复盘就切换任务。",
      requestId: `route-lock-${repeat}`
    },
    execute: async (spec) => {
      locked.push(spec as unknown as Record<string, unknown>);
      return { status: "succeeded", text: "route locked", runId: `route-run-${repeat}`, creditCost: 0 };
    }
  });
  assert.equal(locked[0]?.capabilityId, "beauty_xiaohongshu_package");
  assert.equal(locked[0]?.skillId, "wechat-xhs-content-line");
}

await assert.rejects(
  () => runBeautyIndustryMcpTool({
    context,
    toolName: "beauty.xiaohongshu_package",
    arguments: {
      question: "生成一套小红书图文",
      requestId: "wrong-branch-options",
      mode: "professional",
      professionalOptions: { edlRequirements: "30秒" }
    },
    execute: async () => ({ status: "succeeded", text: "bad", runId: "bad", creditCost: 0 })
  }),
  /beauty_tool_option_forbidden/
);

await assert.rejects(
  () => runBeautyIndustryMcpTool({
    context,
    toolName: "beauty.topic_ideas",
    arguments: { question: "帮我获客", requestId: "request-2", tenantId: "tenant-beauty-b" },
    execute: async () => ({ status: "succeeded", text: "bad", runId: "run-bad", creditCost: 0 })
  }),
  /mcp_identity_argument_forbidden/
);

await assert.rejects(
  () => runBeautyIndustryMcpTool({
    context: { ...context, productCode: "lanqi" },
    toolName: "beauty.topic_ideas",
    arguments: { question: "帮我获客", requestId: "request-3" },
    execute: async () => ({ status: "succeeded", text: "bad", runId: "run-bad", creditCost: 0 })
  }),
  /beauty_product_credential_required/
);

await assert.rejects(
  () => runBeautyIndustryMcpTool({
    context: { ...context, scopes: [] },
    toolName: "beauty.topic_ideas",
    arguments: { question: "帮我获客", requestId: "request-4" },
    execute: async () => ({ status: "succeeded", text: "bad", runId: "run-bad", creditCost: 0 })
  }),
  /beauty_tool_scope_forbidden/
);

console.log("beauty industry MCP product contract smoke passed");
}

void main();

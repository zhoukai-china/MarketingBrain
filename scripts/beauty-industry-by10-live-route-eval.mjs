#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const apiBase = process.env.BY10_API_BASE ?? "http://127.0.0.1:3021";
const costCeilingCny = Number(process.env.BY10_COST_CEILING_CNY ?? "1.00");
const skippedTools = new Set(
  (process.env.BY10_SKIP_TOOLS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
);
assert.match(apiBase, /^http:\/\/127\.0\.0\.1:\d+$/);
assert.equal(costCeilingCny, 1);

const cases = [
  {
    toolName: "beauty.topic_ideas",
    capabilityId: "topic_inspiration",
    skillId: "baolu_topics",
    required: ["四大来源自动采集结果", "三关筛选后的TOP10", "配比调整建议"],
    question: process.env.BY10_TOPIC_QUESTION ?? "请为生活美容门店生成四来源获客选题。即使提到直播复盘，也只能完成当前选题入口；缺失证据请标待补。",
    topicWorkflow: {
      targetCustomer: "附近关注日常皮肤护理的成年顾客",
      acquisitionGoal: "获得合规到店咨询",
      industry: "生活美容",
      benchmarkAccounts: [],
      transcriptDocumentIds: [],
      sourceSelection: { industry: true, benchmark: false, transcript: false, videoReview: false }
    }
  },
  {
    toolName: "beauty.content_ten_pack",
    capabilityId: "content_plan",
    skillId: "baolu_content_creator",
    required: ["口播逐字稿", "拍摄脚本", "剪辑EDL", "评论区", "投流建议"],
    question: "围绕基础补水护理生成内容十件套。即使提到小红书，也只能完成当前内容入口；不编价格、疗效、案例。"
  },
  {
    toolName: "beauty.xiaohongshu_package",
    capabilityId: "beauty_xiaohongshu_package",
    skillId: "wechat-xhs-content-line",
    required: ["标题", "正文", "标签", "正向视觉提示词", "负向提示词"],
    question: "生成夏季基础补水护理小红书图文文字包与三张配图方向。即使提到视频数据，也不得切到复盘。"
  },
  {
    toolName: "beauty.live_script",
    capabilityId: "live_script",
    skillId: "live_script_planner",
    required: ["主播口播稿", "运营配合动作", "下播后跟进"],
    question: "为生活美容门店生成直播话术。直播模式：本地生活门店直播。项目：基础清洁护理。目标是引导评论了解流程并预约到店；预约方式未知请待补。即使提到销售，也只完成直播话术。"
  },
  {
    toolName: "beauty.live_review",
    capabilityId: "live_review",
    skillId: "baolu_live_review_engine",
    required: ["核心数据速览", "话术执行对照表", "下次直播调整清单"],
    question: "复盘生活美容直播：观看320、平均停留42秒、评论18、私信7、预约2，成交与到店数据未提供。"
  },
  {
    toolName: "beauty.sales_advice",
    capabilityId: "beauty_sales",
    skillId: "sales_growth_advisor",
    required: ["当前判断", "核心破局点", "推荐回复", "下一步动作"],
    question: "顾客问基础补水护理是否一次就能明显改善，请给合规销售回复。即使提到选题，也只完成销售建议。"
  }
];
const knownTools = new Set(cases.map((item) => item.toolName));
for (const toolName of skippedTools) {
  assert.equal(knownTools.has(toolName), true, `unknown_skipped_tool:${toolName}`);
}

let credentialId;
let secret;
let sessionToken;
const completed = [];

try {
  const login = await request("/auth/dev-login", {
    method: "POST",
    body: {
      productCode: "beauty-industry",
      tenantRole: "local_business",
      tenantName: `BY10受控路由验收-${randomUUID().slice(0, 8)}`,
      planCode: "local_standard",
      industry: "生活美容"
    }
  });
  assert.equal(login.status, 200);
  sessionToken = requiredString(login.body.token, "session_token");
  const auth = { authorization: `Bearer ${sessionToken}` };
  const profile = await request("/beauty-industry/profile", {
    method: "PUT",
    headers: auth,
    body: {
      segment: "lifestyle_beauty",
      operationType: "single_store",
      operatingStage: "growth",
      storeName: "本店",
      city: "杭州",
      services: ["基础清洁", "日常补水护理"],
      targetCustomers: "附近成年上班族",
      channels: ["小红书", "抖音"],
      acquisitionGoal: "获得合规咨询",
      factBoundaries: "不编价格、疗效、案例、顾客经历和未确认预约方式"
    }
  });
  assert.equal(profile.status, 200);
  const created = await request("/integrations/workbuddy/connections", {
    method: "POST",
    headers: auth,
    body: { productCode: "beauty-industry", label: "BY10受控真实路由验收", expiresInDays: 1 }
  });
  assert.equal(created.status, 201);
  secret = requiredString(created.body.token, "one_time_secret");
  credentialId = requiredString(created.body.connection?.id, "credential_id");
  const tools = await rpc("tools/list");
  assert.equal(tools.status, 200);
  assert.equal(tools.body.result.tools.length, 7);

  for (const item of cases) {
    if (skippedTools.has(item.toolName)) continue;
    const started = Date.now();
    const response = await rpc("tools/call", {
      name: item.toolName,
      arguments: {
        question: item.question,
        requestId: `by10_${item.toolName.replace(/[^a-z]+/g, "_")}_${randomUUID()}`,
        ...(item.topicWorkflow ? { topicWorkflow: item.topicWorkflow } : {})
      }
    }, 190_000);
    assert.equal(response.status, 200, `${item.toolName}:${response.body?.error?.message ?? "http_error"}`);
    assert.equal(response.body.error, undefined, `${item.toolName}:${response.body.error?.message}`);
    const result = response.body.result.structuredContent;
    assert.equal(result.status, "succeeded", `${item.toolName}:not_succeeded`);
    assert.equal(result.routeReceipt.capabilityId, item.capabilityId);
    assert.equal(result.routeReceipt.skillId, item.skillId);
    assert.equal(result.routeReceipt.channel, "mcp");
    assert.equal(result.routeReceipt.fallbackUsed, false);
    assert.match(result.routeReceipt.requestId, /^sha256:[a-f0-9]{16}$/);
    assert.match(result.routeReceipt.tenantHash, /^sha256:[a-f0-9]{16}$/);
    const text = response.body.result.content.find((entry) => entry.type === "text")?.text ?? "";
    for (const marker of item.required) assert.match(text, new RegExp(marker), `${item.toolName}:missing_${marker}`);
    assert.doesNotMatch(text, /餐饮|外卖|牛肉面|创始人\s*IP|兰琪|验收[AB]店|tenant/i);
    completed.push({ toolName: item.toolName, latencyMs: Date.now() - started, routeReceipt: result.routeReceipt });
    console.log(JSON.stringify({ event: "by10_live_tool_completed", toolName: item.toolName, latencyMs: Date.now() - started }));
  }
  console.log(JSON.stringify({
    status: "passed",
    providerCallUpperBound: cases.length - skippedTools.size,
    skippedTools: [...skippedTools],
    costCeilingCny,
    completed
  }));
} finally {
  if (credentialId && sessionToken) {
    await request(`/integrations/workbuddy/connections/${credentialId}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${sessionToken}` }
    }).catch(() => undefined);
  }
}

async function rpc(method, params, timeoutMs = 30_000) {
  return request("/integrations/workbuddy/mcp", {
    method: "POST",
    headers: { authorization: `Bearer ${secret}` },
    body: { jsonrpc: "2.0", id: randomUUID(), method, ...(params ? { params } : {}) },
    timeoutMs
  });
}

async function request(path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    method: options.method ?? "GET",
    headers: { ...(options.body ? { "content-type": "application/json" } : {}), ...(options.headers ?? {}) },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    signal: AbortSignal.timeout(options.timeoutMs ?? 30_000)
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : {} };
}

function requiredString(value, field) {
  if (typeof value !== "string" || !value) throw new Error(`missing_${field}`);
  return value;
}

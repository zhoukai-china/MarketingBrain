import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getBeautyTextBudget } from "../apps/api/src/products/beauty-industry/text-budget.js";

const apiBase = process.env.BEAUTY_CONTENT_TEN_API_BASE ?? "http://127.0.0.1:3016";
const budget = getBeautyTextBudget("content_plan", "baolu_content_creator");
const repeats = 3;
const batchWorstCostCny = Number((budget.worstCostCny * repeats).toFixed(6));
const resumeAfterVerifiedWebCall = process.env.BEAUTY_CONTENT_TEN_RESUME_AFTER_WEB === "true";
const resumeAfterVerifiedFirstMcpCall = process.env.BEAUTY_CONTENT_TEN_RESUME_AFTER_MCP_1 === "true";
assert.equal(budget.model, "deepseek-v4-pro");
assert.equal(batchWorstCostCny <= 1, true, `content_ten_batch_budget_exceeded:${batchWorstCostCny}`);

const question = "围绕生活美容门店的基础补水护理，生成可直接执行的内容十件套。受众为附近关注日常皮肤管理的成年女性；不编价格、疗效、案例、顾客经历或未确认活动。";
const required = ["短结论", "选题", "口播逐字稿", "访谈话术", "拍摄脚本", "拍摄注意事项", "剪辑EDL", "发布标题与话题", "最佳发布时间", "评论区引导话术", "投流建议"];
const forbidden = /枕水江南|餐饮|招商|山东|培训3天|月流水15万|毛利60%|团购|外卖|夫妻店|兰琪|验收[AB]店|tenant/i;
const contentWorkflow = {
  version: "content_workflow_v1",
  topic: "第一次做基础补水护理前先确认三件事",
  objective: "获得合规咨询",
  targetAudience: "附近关注日常皮肤管理的成年女性",
  platform: "抖音",
  format: "真人口播短视频",
  duration: "60秒内",
  presenter: "店长本人",
  projectFacts: "本店提供基础补水护理",
  shootingConstraints: "不出现顾客正脸；只使用已授权门店区域"
} as const;
let secret = "";

async function main(): Promise<void> {
  let token = "";
  let credentialId = "";
  const results: Array<{ channel: "web" | "mcp"; latencyMs: number; runFingerprint: string }> = [];

  try {
  const login = await request("/auth/dev-login", {
    method: "POST",
    body: {
      productCode: "beauty-industry",
      tenantRole: "local_business",
      tenantName: `美业内容十件套受控验收-${randomUUID().slice(0, 8)}`,
      planCode: "local_standard",
      industry: "生活美容"
    }
  });
  assert.equal(login.status, 200);
  token = requiredString(login.body.token, "session_token");
  const auth = { authorization: `Bearer ${token}` };
  const profile = await request("/beauty-industry/profile", {
    method: "PUT",
    headers: auth,
    body: {
      segment: "lifestyle_beauty",
      operationType: "single_store",
      operatingStage: "growth",
      storeName: "本店",
      city: "杭州",
      services: ["基础补水护理"],
      targetCustomers: "附近关注日常皮肤管理的成年女性",
      channels: ["抖音"],
      acquisitionGoal: "获得合规咨询",
      factBoundaries: "不编价格、疗效、案例、顾客经历或未确认活动"
    }
  });
  assert.equal(profile.status, 200);

  if (!resumeAfterVerifiedWebCall && !resumeAfterVerifiedFirstMcpCall) {
    const webStarted = Date.now();
    const webRequestId = `content_ten_web_${randomUUID()}`;
    const web = await request("/beauty-industry/acquisition/runs", {
      method: "POST",
      headers: auth,
      timeoutMs: 190_000,
      body: { toolName: "beauty.content_ten_pack", question, mode: "professional", contentWorkflow, requestId: webRequestId, deviceScope: "desktop" }
    });
    assert.equal(web.status === 200 || web.status === 201, true, `web:${web.body?.error ?? web.status}`);
    assert.equal(web.body.capabilityId, "content_plan");
    assert.equal(web.body.skillId, "baolu_content_creator");
    assertContentTen(requiredString(web.body.answerText, "web_answer"));
    results.push({ channel: "web", latencyMs: Date.now() - webStarted, runFingerprint: fingerprint(requiredString(web.body.agentRunId, "web_run")) });
  }

  const created = await request("/integrations/workbuddy/connections", {
    method: "POST",
    headers: auth,
    body: { productCode: "beauty-industry", label: "内容十件套受控真实复验", expiresInDays: 1 }
  });
  assert.equal(created.status, 201);
  credentialId = requiredString(created.body.connection?.id, "credential_id");
  secret = requiredString(created.body.token, "one_time_secret");

  let replayRequestId = "";
  let replayRunFingerprint = "";
  const firstMcpIndex = resumeAfterVerifiedFirstMcpCall ? 1 : 0;
  for (let index = firstMcpIndex; index < 2; index += 1) {
    const requestId = `content_ten_mcp_${index + 1}_${randomUUID()}`;
    const started = Date.now();
    const response = await rpc("tools/call", { name: "beauty.content_ten_pack", arguments: { question, requestId, mode: "professional", contentWorkflow } }, 190_000);
    assert.equal(response.status, 200, `mcp_${index + 1}:http_${response.status}`);
    assert.equal(response.body.error, undefined, `mcp_${index + 1}:${response.body.error?.message}`);
    const structured = response.body.result?.structuredContent;
    assert.equal(structured?.status, "succeeded");
    assert.equal(structured?.routeReceipt?.capabilityId, "content_plan");
    assert.equal(structured?.routeReceipt?.skillId, "baolu_content_creator");
    assert.equal(structured?.routeReceipt?.channel, "mcp");
    assert.equal(structured?.routeReceipt?.fallbackUsed, false);
    const text = response.body.result?.content?.find((entry: any) => entry.type === "text")?.text ?? "";
    assertContentTen(text);
    const runFingerprint = fingerprint(requiredString(structured.runId, `mcp_${index + 1}_run`));
    results.push({ channel: "mcp", latencyMs: Date.now() - started, runFingerprint });
    if (index === 1) {
      replayRequestId = requestId;
      replayRunFingerprint = runFingerprint;
    }
  }

  const replay = await rpc("tools/call", { name: "beauty.content_ten_pack", arguments: { question, requestId: replayRequestId, mode: "professional", contentWorkflow } }, 30_000);
  assert.equal(replay.status, 200);
  assert.equal(fingerprint(requiredString(replay.body.result?.structuredContent?.runId, "replay_run")), replayRunFingerprint);

  console.log(JSON.stringify({ status: "passed", model: budget.model, providerCallsThisProcess: resumeAfterVerifiedFirstMcpCall ? 1 : resumeAfterVerifiedWebCall ? 2 : repeats, providerCallsWholeBatch: repeats, channels: results.map((item) => item.channel), latenciesMs: results.map((item) => item.latencyMs), runFingerprints: results.map((item) => item.runFingerprint), batchWorstCostCny, resumedAfterVerifiedWebCall: resumeAfterVerifiedWebCall, resumedAfterVerifiedFirstMcpCall: resumeAfterVerifiedFirstMcpCall, idempotentReplay: true }));
  } finally {
    if (credentialId && token) {
      await request(`/integrations/workbuddy/connections/${credentialId}`, { method: "DELETE", headers: { authorization: `Bearer ${token}` } }).catch(() => undefined);
    }
  }
}

void main();

function assertContentTen(text: string): void {
  assert.equal(text.length >= 760, true, "content_ten_too_short");
  for (const section of required) assert.match(text, new RegExp(section), `content_ten_missing:${section}`);
  assert.doesNotMatch(text, forbidden, "content_ten_cross_product_contamination");
}

async function rpc(method: string, params: unknown, timeoutMs: number) {
  return request("/integrations/workbuddy/mcp", { method: "POST", headers: { authorization: `Bearer ${secret}` }, body: { jsonrpc: "2.0", id: randomUUID(), method, params }, timeoutMs });
}

async function request(path: string, options: { method?: string; headers?: Record<string, string>; body?: unknown; timeoutMs?: number } = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    method: options.method ?? "GET",
    headers: { ...(options.body ? { "content-type": "application/json" } : {}), ...(options.headers ?? {}) },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    signal: AbortSignal.timeout(options.timeoutMs ?? 30_000)
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : {} };
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value) throw new Error(`missing_${field}`);
  return value;
}

function fingerprint(value: string): string {
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

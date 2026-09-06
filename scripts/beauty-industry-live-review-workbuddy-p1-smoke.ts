import assert from "node:assert/strict";
import { prisma } from "../packages/db/src/index.js";

const apiBase = process.env.BEAUTY_E2E_API_URL ?? "http://127.0.0.1:3016";
const apiUrl = new URL(apiBase);
if (apiUrl.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(apiUrl.hostname) || !apiUrl.port) {
  throw new Error("refusing_nonlocal_acceptance_api");
}

type Login = { token: string; tenantId: string; userId: string };

async function main() {
  await assertAcceptanceApiReady();
  const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const owner = await devLogin(`BY16-WorkBuddy-${stamp}`);
  let connectionId = "";
  try {
    await request("PUT", "/beauty-industry/profile", {
      segment: "lifestyle_beauty", operationType: "single_store", operatingStage: "growth", services: ["日常护理"], targetCustomers: "附近成年顾客", channels: ["抖音"], acquisitionGoal: "获得合规咨询", factBoundaries: "不编造价格、疗效、案例或顾客身份"
    }, owner.token);
    const connection = await request("POST", "/integrations/workbuddy/connections", { productCode: "beauty-industry", scopes: ["acquisition:live-review"], label: `BY16-${stamp}`, expiresInDays: 1 }, owner.token);
    assert.equal(connection.status, 201, JSON.stringify(connection.body));
    connectionId = connection.body.connection.id;
    const secret = connection.body.token;
    const tools = await rpc(secret, "tools/list", {});
    assert.equal(tools.status, 200, JSON.stringify(tools.body));
    assert.deepEqual(tools.body.result.tools.map((item: any) => item.name), ["beauty.live_review"]);
    const schema = tools.body.result.tools[0].inputSchema;
    assert.equal(schema.properties.liveReviewWorkflow.properties.version.const, "live_review_workflow_v1");
    assert.deepEqual(schema.required, ["question", "requestId", "mode", "liveReviewWorkflow"]);

    const liveReviewWorkflow = {
      version: "live_review_workflow_v1",
      scenario: "product",
      platform: "抖音",
      sessionTitle: "BY16 脱敏场次",
      sessionTime: "2026-08-24 19:00-20:00",
      businessObjective: "核对项目讲解后的有效咨询承接",
      recordingTranscript: "00:00 主播说明本场只介绍已确认的日常护理流程。00:30 主播邀请观众咨询服务流程。",
      scriptPlan: "开场说明范围；中段讲服务流程；结尾承接咨询。",
      conversionDefinition: "有效咨询为主动询问流程或预约；确认预约以门店台账为准。",
      factBoundary: "价格、优惠、疗效、案例、顾客身份和未提供数据均不得推断。"
    };
    const requestId = `by16_live_review_${stamp}`;
    const balanceBefore = (await prisma.creditAccount.findUniqueOrThrow({ where: { tenantId: owner.tenantId } })).balance;
    const first = await rpc(secret, "tools/call", { name: "beauty.live_review", arguments: { question: "请按正式八模块复盘当前直播场次。", requestId, mode: "professional", liveReviewWorkflow } });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    const result = first.body.result.structuredContent;
    assert.equal(result.status, "succeeded", JSON.stringify(first.body));
    assert.equal(result.routeReceipt.capabilityId, "live_review");
    assert.equal(result.routeReceipt.scope, "acquisition:live-review");
    assert.equal(result.routeReceipt.fallbackUsed, false);
    const run = await prisma.agentRun.findUniqueOrThrow({ where: { id: result.runId } });
    assert.equal(run.tenantId, owner.tenantId);
    assert.equal(run.skillId, "baolu_live_review_engine");
    assert.equal(run.capabilityId, "live_review");
    assert.equal(run.usageChannel, "mcp");
    assert.equal(run.mcpCredentialId, connectionId);
    assert.match(run.input, /直播复盘正式输入｜live_review_workflow_v1/);
    assert.match(run.input, /00:00 主播说明本场只介绍已确认的日常护理流程/);
    assert.match(run.input, /数据=待补；转写=已提供；计划=已提供；画面=待补/);
    assert.doesNotMatch(run.input, /餐饮|外卖|创始人\s*IP/);

    const duplicate = await rpc(secret, "tools/call", { name: "beauty.live_review", arguments: { question: "请按正式八模块复盘当前直播场次。", requestId, mode: "professional", liveReviewWorkflow } });
    assert.equal(duplicate.status, 200);
    assert.equal(duplicate.body.result.structuredContent.runId, result.runId);
    assert.equal((await prisma.creditAccount.findUniqueOrThrow({ where: { tenantId: owner.tenantId } })).balance, balanceBefore - result.creditCost);
    assert.equal(await prisma.agentRun.count({ where: { tenantId: owner.tenantId, requestId: { contains: requestId } } }), 1);

    const missing = await rpc(secret, "tools/call", { name: "beauty.live_review", arguments: { question: "请复盘但故意缺少正式工作流。", requestId: `missing_${stamp}`, mode: "professional" } });
    assert.equal(missing.status, 500);
    assert.equal(missing.body.error.message, "mcp_argument_invalid:liveReviewWorkflow");
    assert.equal(await prisma.agentRun.count({ where: { tenantId: owner.tenantId, requestId: { contains: `missing_${stamp}` } } }), 0);

    const forged = await rpc(secret, "tools/call", { name: "beauty.live_review", arguments: { question: "请按正式八模块复盘当前直播场次。", requestId: `forged_${stamp}`, mode: "professional", liveReviewWorkflow, tenantId: "other-tenant" } });
    assert.equal(forged.status, 500);
    assert.equal(forged.body.error.message, "mcp_identity_argument_forbidden");

    console.log("BEAUTY_LIVE_REVIEW_WORKBUDDY_P1_SMOKE_OK api_preflight=true shared_schema=true tenant=true idempotency=true missing_fail_closed=true provider=controlled_mock paid_calls=0");
  } finally {
    if (connectionId) await request("DELETE", `/integrations/workbuddy/connections/${connectionId}`, undefined, owner.token).catch(() => undefined);
    await prisma.tenant.delete({ where: { id: owner.tenantId } }).catch(() => undefined);
    await prisma.user.delete({ where: { id: owner.userId } }).catch(() => undefined);
    await prisma.$disconnect();
  }
}

async function assertAcceptanceApiReady() {
  let response: Response;
  try {
    response = await fetch(`${apiBase}/ready`, { signal: AbortSignal.timeout(3_000) });
  } catch {
    throw new Error(`live_review_workbuddy_api_preflight_failed endpoint=${apiBase} stage=connect`);
  }
  const body = await response.json().catch(() => ({})) as any;
  assert.equal(response.status, 200, `live_review_workbuddy_api_preflight_failed endpoint=${apiBase} stage=http status=${response.status}`);
  assert.equal(body.ok, true, `live_review_workbuddy_api_preflight_failed endpoint=${apiBase} stage=ready`);
  assert.equal(body.checks?.database?.ok, true, `live_review_workbuddy_api_preflight_failed endpoint=${apiBase} stage=database`);
}

async function devLogin(tenantName: string): Promise<Login> {
  const response = await request("POST", "/auth/dev-login", { productCode: "beauty-industry", tenantRole: "local_business", tenantName, planCode: "local_standard", industry: "生活美容" });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return { token: response.body.token, tenantId: response.body.tenantId, userId: response.body.userId };
}

async function rpc(secret: string, method: string, params: Record<string, unknown>) {
  return request("POST", "/integrations/workbuddy/mcp", { jsonrpc: "2.0", id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, method, params }, secret);
}

async function request(method: string, route: string, body?: unknown, token?: string) {
  const response = await fetch(`${apiBase}${route}`, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const text = await response.text(); let parsed: any = {};
  if (text) try { parsed = JSON.parse(text); } catch { parsed = { raw: text.slice(0, 200) }; }
  return { status: response.status, body: parsed };
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

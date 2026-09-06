import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../packages/db/src/index.js";

const baseUrl = process.env.BEAUTY_ACCEPTANCE_API_URL ?? "http://127.0.0.1:3016";
const reportDir = process.env.BEAUTY_ACCEPTANCE_REPORT_DIR;
if (!/^http:\/\/(?:127\.0\.0\.1|localhost):3016$/.test(baseUrl)) {
  throw new Error("refusing_nonlocal_acceptance_api");
}

type Login = { token: string; tenantId: string; userId: string };
type ConnectionCreation = {
  token: string;
  connection: { id: string; tokenPrefix: string; productCode: string; scopes: string[] };
};

const report: Record<string, unknown> = {
  environment: "local_only",
  providerMode: "controlled_mock",
  paidProviderCalls: 0,
  checks: [] as string[],
};

const topicWorkflowFixture = {
  targetCustomer: "附近关注日常皮肤护理的成年顾客",
  acquisitionGoal: "获得合规到店咨询",
  industry: "生活美容",
  benchmarkAccounts: [],
  transcriptDocumentIds: [],
  sourceSelection: {
    industry: true,
    benchmark: false,
    transcript: false,
    videoReview: false
  }
};

async function main(): Promise<void> {
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const owner = await devLogin(`美业通用验收门店-${suffix}`);
  const other = await devLogin(`美业隔离验收门店-${suffix}`);
  const ownerHeaders = bearer(owner.token);
  const otherHeaders = bearer(other.token);

  const product = await jsonRequest("GET", "/beauty-industry/acquisition", undefined, ownerHeaders);
  assert.equal(product.status, 200);
  assert.equal(product.body.productCode, "beauty-industry");
  assert.equal(product.body.localAcceptance, true);
  assert.ok(Number(product.body.creditBalance) > 0);
  addCheck("product_entitlement_and_local_entry");

  const ownerProfile = await jsonRequest("PUT", "/beauty-industry/profile", {
    segment: "lifestyle_beauty",
    operationType: "single_store",
    operatingStage: "growth",
    storeName: "青禾皮肤管理",
    city: "烟台",
    services: ["基础清洁", "日常补水"],
    targetCustomers: "附近关注日常皮肤管理的顾客",
    channels: ["小红书", "抖音"],
    acquisitionGoal: "提升真实到店咨询",
    factBoundaries: "生活美容，无医疗资质，不承诺疗效、价格或案例"
  }, ownerHeaders);
  assert.equal(ownerProfile.status, 200);
  const otherProfile = await jsonRequest("PUT", "/beauty-industry/profile", {
    segment: "hairdressing",
    operationType: "single_store",
    operatingStage: "stable",
    storeName: "木棉美发",
    city: "威海",
    services: ["剪发"],
    targetCustomers: "附近居民",
    channels: ["抖音"],
    acquisitionGoal: "提升预约",
    factBoundaries: "不编造价格和案例"
  }, otherHeaders);
  assert.equal(otherProfile.status, 200);
  addCheck("confirmed_store_profile_saved_per_tenant");

  const full = await createConnection(ownerHeaders, undefined, `完整工具-${suffix}`);
  const stored = await prisma.workbuddyMcpConnection.findUniqueOrThrow({ where: { id: full.connection.id } });
  assert.notEqual(stored.tokenHash, full.token);
  assert.equal(stored.tokenPrefix, full.token.slice(0, 18));
  const listed = await jsonRequest("GET", "/integrations/workbuddy/connections", undefined, ownerHeaders);
  assert.equal(listed.status, 200);
  const listedText = JSON.stringify(listed.body);
  assert.equal(listedText.includes(full.token), false);
  assert.equal(listedText.includes(stored.tokenHash), false);
  addCheck("one_time_secret_hash_only");

  const initialized = await rpc(full.token, "initialize", {});
  assert.equal(initialized.status, 200);
  assert.equal(initialized.body.result.protocolVersion, "2024-11-05");
  const tools = await rpc(full.token, "tools/list", {});
  assert.equal(tools.status, 200);
  const toolNames = tools.body.result.tools.map((tool: { name: string }) => tool.name);
  for (const name of [
    "beauty.topic_ideas",
    "beauty.content_ten_pack",
    "beauty.xiaohongshu_package",
    "beauty.live_script",
    "beauty.video_data_review",
    "beauty.live_review",
    "beauty.sales_advice"
  ]) {
    assert.ok(toolNames.includes(name), `missing_tool:${name}`);
  }
  assert.equal(toolNames.includes("beauty.compliance_check"), false);
  assert.equal(toolNames.includes("beauty.paid_traffic_preview"), false);
  assert.equal(toolNames.includes("beauty.video_content_review"), true);
  assert.equal(/lanqi|验收A店|验收B店|tenantKey/i.test(JSON.stringify(tools.body)), false);
  addCheck("real_http_initialize_and_tools_list");

  const questions: Record<string, string> = {
    "beauty.topic_ideas": "请根据已确认的生活美容门店客群，给出一周可验证选题；未知信息请列为待补。",
    "beauty.xiaohongshu_package": "请为夏季补水日常护理生成品牌中立的小红书图文草稿，不使用真人和疗效承诺。",
    "beauty.sales_advice": "顾客只问价格时，请基于已确认门店资料给合规的沟通步骤；未知价格明确待补。",
  };
  const runIds: string[] = [];
  let replayRequest = "";
  let replayRunId = "";
  for (const [index, toolName] of Object.keys(questions).entries()) {
    const requestId = `live_${index}_${suffix}`;
    const called = await callTool(full.token, toolName, {
      question: questions[toolName],
      requestId,
      ...(toolName === "beauty.topic_ideas" ? { topicWorkflow: topicWorkflowFixture } : {})
    });
    assert.equal(called.status, 200);
    assert.ok(["succeeded", "clarification_required"].includes(called.body.result.structuredContent.status));
    assert.ok(called.body.result.structuredContent.runId);
    runIds.push(called.body.result.structuredContent.runId);
    if (index === 0) {
      replayRequest = requestId;
      replayRunId = called.body.result.structuredContent.runId;
    }
  }
  addCheck("three_real_mcp_tool_calls_controlled_mock");

  const balanceBeforeReplay = (await prisma.creditAccount.findUniqueOrThrow({ where: { tenantId: owner.tenantId } })).balance;
  const replay = await callTool(full.token, "beauty.topic_ideas", {
    question: questions["beauty.topic_ideas"],
    requestId: replayRequest,
    topicWorkflow: topicWorkflowFixture,
  });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.result.structuredContent.runId, replayRunId);
  const balanceAfterReplay = (await prisma.creditAccount.findUniqueOrThrow({ where: { tenantId: owner.tenantId } })).balance;
  assert.equal(balanceAfterReplay, balanceBeforeReplay);
  addCheck("mcp_idempotent_replay_no_double_charge");

  const webRequestId = `websame_${suffix}`;
  const web = await jsonRequest("POST", "/beauty-industry/acquisition/runs", {
    toolName: "beauty.topic_ideas",
    question: questions["beauty.topic_ideas"],
    confirmedFacts: "生活美容门店；当前只确认目标客群为本地成年顾客，价格、案例和疗效资料均未提供。",
    mode: "professional",
    professionalOptions: { audience: "附近成年顾客", platform: "小红书" },
    topicWorkflow: topicWorkflowFixture,
    requestId: webRequestId,
    deviceScope: "desktop",
  }, ownerHeaders);
  assert.equal(web.status, 200);
  const mcpRun = await prisma.agentRun.findUniqueOrThrow({ where: { id: replayRunId } });
  const webRun = await prisma.agentRun.findUniqueOrThrow({ where: { id: web.body.agentRunId } });
  assert.equal(webRun.skillId, mcpRun.skillId);
  assert.equal(webRun.capabilityId, mcpRun.capabilityId);
  assert.equal(webRun.productCode, "beauty-industry");
  assert.equal(webRun.usageChannel, "web");
  assert.equal(mcpRun.usageChannel, "mcp");
  assert.match(mcpRun.input, /青禾皮肤管理/);
  assert.match(mcpRun.input, /生活美容/);
  assert.match(mcpRun.input, /快速模式/);
  assert.equal(mcpRun.input.includes("木棉美发"), false);
  assert.match(webRun.input, /青禾皮肤管理/);
  assert.match(webRun.input, /专业模式/);
  assert.doesNotMatch(webRun.input, /投流预览/);
  assert.equal(webRun.input.includes("木棉美发"), false);
  addCheck("web_mcp_same_contract_distinct_channels");

  const forged = await callTool(full.token, "beauty.topic_ideas", {
    question: questions["beauty.topic_ideas"], requestId: `forge_${suffix}`, topicWorkflow: topicWorkflowFixture, tenantId: other.tenantId,
  });
  assert.equal(forged.status, 500);
  assert.equal(forged.body.error.message, "mcp_identity_argument_forbidden");
  addCheck("identity_forgery_rejected");

  const limited = await createConnection(ownerHeaders, ["acquisition:topics"], `限权工具-${suffix}`);
  const limitedTools = await rpc(limited.token, "tools/list", {});
  assert.deepEqual(limitedTools.body.result.tools.map((tool: { name: string }) => tool.name), ["beauty.topic_ideas"]);
  const wrongScope = await callTool(limited.token, "beauty.xiaohongshu_package", {
    question: questions["beauty.xiaohongshu_package"], requestId: `scope_${suffix}`,
  });
  assert.equal(wrongScope.status, 500);
  assert.equal(wrongScope.body.error.message, "beauty_tool_scope_forbidden");
  addCheck("scope_filtered_and_enforced");

  const otherCredential = await createConnection(otherHeaders, ["acquisition:topics"], `隔离工具-${suffix}`);
  const crossTenantRevoke = await jsonRequest("DELETE", `/integrations/workbuddy/connections/${otherCredential.connection.id}`, undefined, ownerHeaders);
  assert.equal(crossTenantRevoke.status, 404);
  assert.equal((await rpc(otherCredential.token, "initialize", {})).status, 200);
  addCheck("cross_tenant_credential_isolation");

  const rotated = await jsonRequest("POST", `/integrations/workbuddy/connections/${limited.connection.id}/rotate`, {}, ownerHeaders);
  assert.equal(rotated.status, 201);
  const rotatedToken = requiredString(rotated.body.token, "rotated_secret");
  assert.equal((await rpc(limited.token, "initialize", {})).status, 401);
  assert.equal((await rpc(rotatedToken, "initialize", {})).status, 200);
  const revoked = await jsonRequest("DELETE", `/integrations/workbuddy/connections/${rotated.body.connection.id}`, undefined, ownerHeaders);
  assert.equal(revoked.status, 200);
  assert.equal((await rpc(rotatedToken, "initialize", {})).status, 401);
  addCheck("rotation_and_revocation");

  const expiring = await createConnection(ownerHeaders, ["acquisition:topics"], `到期工具-${suffix}`);
  await prisma.workbuddyMcpConnection.update({ where: { id: expiring.connection.id }, data: { expiresAt: new Date(Date.now() - 1_000) } });
  assert.equal((await rpc(expiring.token, "initialize", {})).status, 401);
  addCheck("expired_credential_rejected");

  const creditAccount = await prisma.creditAccount.findUniqueOrThrow({ where: { tenantId: owner.tenantId } });
  const balanceBeforeZero = creditAccount.balance;
  await prisma.creditAccount.update({ where: { tenantId: owner.tenantId }, data: { balance: 0 } });
  const insufficientId = `nocredit_${suffix}`;
  const insufficient = await callTool(full.token, "beauty.topic_ideas", {
    question: questions["beauty.topic_ideas"], requestId: insufficientId, topicWorkflow: topicWorkflowFixture,
  });
  assert.equal(insufficient.status, 500);
  assert.equal(insufficient.body.error.message, "insufficient_credits");
  assert.equal(await prisma.agentRun.count({ where: { tenantId: owner.tenantId, requestId: { contains: insufficientId } } }), 0);
  await prisma.creditAccount.update({ where: { tenantId: owner.tenantId }, data: { balance: balanceBeforeZero } });
  addCheck("insufficient_balance_rejected_before_provider");

  const allRuns = await prisma.agentRun.findMany({ where: { id: { in: [...runIds, webRun.id] } } });
  assert.ok(allRuns.every((run) => run.productCode === "beauty-industry"));
  assert.ok(allRuns.every((run) => run.tenantId === owner.tenantId));
  assert.ok(allRuns.filter((run) => run.usageChannel === "mcp").every((run) => run.mcpCredentialId === full.connection.id));
  addCheck("usage_ledger_product_tenant_credential_bound");

  await jsonRequest("DELETE", `/integrations/workbuddy/connections/${full.connection.id}`, undefined, ownerHeaders);
  await jsonRequest("DELETE", `/integrations/workbuddy/connections/${otherCredential.connection.id}`, undefined, otherHeaders);

  report.toolNames = toolNames;
  report.mcpRunCount = runIds.length;
  report.webRunCount = 1;
  report.finalStatus = "PASS";
  if (reportDir) {
    await mkdir(reportDir, { recursive: true });
    await writeFile(path.join(reportDir, "live-mcp-e2e.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
  console.log(`beauty_live_mcp_e2e=PASS;tools=${toolNames.length};mcp_calls=${runIds.length};web_calls=1;paid_provider_calls=0;secrets=not_displayed`);
}

function addCheck(name: string): void {
  (report.checks as string[]).push(name);
}

async function devLogin(tenantName: string): Promise<Login> {
  const response = await jsonRequest("POST", "/auth/dev-login", {
    productCode: "beauty-industry",
    tenantRole: "local_business",
    tenantName,
    planCode: "local_standard",
    industry: "生活美容",
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.productCode, "beauty-industry");
  return {
    token: requiredString(response.body.token, "session_token"),
    tenantId: requiredString(response.body.tenantId, "tenant_id"),
    userId: requiredString(response.body.userId, "user_id"),
  };
}

async function createConnection(headers: Record<string, string>, scopes: string[] | undefined, label: string): Promise<ConnectionCreation> {
  const response = await jsonRequest("POST", "/integrations/workbuddy/connections", {
    productCode: "beauty-industry",
    label,
    ...(scopes ? { scopes } : {}),
    expiresInDays: 30,
  }, headers);
  assert.equal(response.status, 201);
  assert.equal(response.body.connection.productCode, "beauty-industry");
  return response.body as ConnectionCreation;
}

function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

async function callTool(secret: string, name: string, args: Record<string, unknown>) {
  return rpc(secret, "tools/call", { name, arguments: args });
}

async function rpc(secret: string, method: string, params: Record<string, unknown>) {
  return jsonRequest("POST", "/integrations/workbuddy/mcp", {
    jsonrpc: "2.0",
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    method,
    params,
  }, bearer(secret));
}

async function jsonRequest(method: string, route: string, body?: unknown, headers: Record<string, string> = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: { ...headers, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let parsed: any = {};
  if (text) {
    try { parsed = JSON.parse(text); } catch { parsed = { raw: text.slice(0, 200) }; }
  }
  return { status: response.status, body: parsed };
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value) throw new Error(`missing_${name}`);
  return value;
}

main()
  .catch((error) => {
    console.error(`beauty_live_mcp_e2e=FAIL;reason=${error instanceof Error ? error.stack ?? error.message : "unknown"};secrets=not_displayed`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.workbuddyMcpConnection.updateMany({
      where: {
        productCode: "beauty-industry",
        status: "active",
        OR: ["完整工具-", "限权工具-", "隔离工具-", "到期工具-"].map((prefix) => ({ label: { startsWith: prefix } }))
      },
      data: { status: "revoked", revokedAt: new Date() }
    });
    await prisma.$disconnect();
  });

import assert from "node:assert/strict";

const allowedDatabases = ["beauty_mcp_test_20260821", "beauty_industry_acceptance_20260821"];
if (process.env.BEAUTY_MCP_TEST_DATABASE_ALLOWED !== "true" || !allowedDatabases.some((name) => process.env.DATABASE_URL?.includes(`/${name}`))) {
  throw new Error(`refusing_non_isolated_database:${allowedDatabases.join("|")}`);
}

process.env.DATA_MODE = "database";
process.env.SKILL_MCP_REQUIRED = "false";
process.env.WORKBUDDY_MCP_ENABLED = "true";
process.env.WORKBUDDY_MCP_PUBLIC_URL = "http://127.0.0.1:3016/api/integrations/workbuddy/mcp";
process.env.NODE_ENV = "test";
process.env.LLM_MOCK_MODE = "true";

async function main(): Promise<void> {
const [{ default: Fastify }, { prisma }, { ensureAgentProductCatalog }, { registerWorkbuddySettingsRoutes }, { registerWorkbuddyMcpRoutes }, { loadSkillQualityContract }, { DomesticChatProvider }] = await Promise.all([
  import("../apps/api/node_modules/fastify/fastify.js"),
  import("../packages/db/src/index.js"),
  import("../apps/api/src/services/agent-catalog.js"),
  import("../apps/api/src/routes/workbuddy-settings.js"),
  import("../apps/api/src/routes/workbuddy-mcp.js"),
  import("../packages/skills/src/index.js"),
  import("../apps/api/src/services/domestic-chat-provider.js")
]);

const runSuffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const tenantId = `beauty_mcp_tenant_${runSuffix}`;
const otherTenantId = `beauty_mcp_other_${runSuffix}`;
const userId = `beauty_mcp_user_${runSuffix}`;
const otherUserId = `beauty_mcp_other_user_${runSuffix}`;
const topicWorkflowFixture = {
  identity: "验收A店",
  targetCustomer: "附近关注日常皮肤护理的成年顾客",
  acquisitionGoal: "获得合规到店咨询",
  industry: "皮肤管理",
  benchmarkAccounts: ["同城公开账号线索"],
  transcriptDocumentIds: [],
  sourceSelection: {
    industry: true,
    benchmark: true,
    transcript: false,
    videoReview: false
  }
};
let providerCalls = 0;
let providerFailureMode: "none" | "error" | "cancelled" | "timed_out" = "none";
const topicContract = await loadSkillQualityContract("baolu_topics");
assert.ok(topicContract, "baolu_topics quality contract is required for the MCP fixture");
const topicContractCore = [
  ...(topicContract.requiredSections ?? []),
  ...(topicContract.requiredTerms ?? []),
  "本轮主体与目标：为生活美容门店形成获客计划。",
  "建议动作：只使用本轮确认事实；缺失来源明确标记待补或待核验。"
].join("\n");
const topicContractAnswer = `${topicContractCore}\n${"可执行选题建议与证据边界。".repeat(Math.ceil((Math.max(topicContract.minLength ?? 80, 80) - topicContractCore.length + 40) / 13))}`;
const controlledMockProvider = new DomesticChatProvider({
  providerName: "deepseek",
  model: "deepseek-v4-pro",
  timeoutMs: 1_000,
  domesticNetworkOnly: true,
  allowedHosts: []
});
const provider = {
  name: "contract_provider",
  getModel: () => "deepseek-v4-pro",
  async complete(messages: Array<{ role: "system" | "user" | "assistant"; content: string }>): Promise<string> {
    providerCalls += 1;
    if (providerFailureMode === "error") throw new Error("synthetic_provider_failure");
    if (providerFailureMode === "cancelled") {
      const cancelled = new Error("agent_execution_cancelled");
      cancelled.name = "AbortError";
      (cancelled as any).providerFailure = { code: "cancelled" };
      throw cancelled;
    }
    if (providerFailureMode === "timed_out") {
      const timedOut = new Error("llm_request_timed_out_after_1ms");
      (timedOut as any).providerFailure = { code: "timed_out" };
      throw timedOut;
    }
    return messages.some((message) => /【固定美业能力】(?:beauty_xiaohongshu_package|topic_inspiration)/.test(message.content))
      ? controlledMockProvider.complete(messages)
      : topicContractAnswer;
  }
};

const app = Fastify({ logger: false });

try {
  await seedIdentity();
  await ensureAgentProductCatalog();
  await prisma.tenantProductEntitlement.createMany({
    data: [
      { tenantId, productCode: "beauty-industry", status: "active", source: "contract_test" },
      { tenantId: otherTenantId, productCode: "beauty-industry", status: "active", source: "contract_test" }
    ]
  });
  await registerWorkbuddySettingsRoutes(app);
  await registerWorkbuddyMcpRoutes(app, provider);
  await app.ready();

  const { sessionHeaders } = await import("./lib/db-session-headers.js");
  const ownerHeaders = sessionHeaders(tenantId, userId);
  const created = await app.inject({
    method: "POST",
    url: "/integrations/workbuddy/connections",
    headers: ownerHeaders,
    payload: {
      productCode: "beauty-industry",
      scopes: ["acquisition:topics", "acquisition:xhs"],
      expiresInDays: 30
    }
  });
  assert.equal(created.statusCode, 201, created.body);
  const createdBody = created.json() as any;
  const token = requiredString(createdBody.token, "one_time_token");
  const credentialId = requiredString(createdBody.connection?.id, "credential_id");
  assert.equal(createdBody.connection.productCode, "beauty-industry");
  assert.equal(createdBody.connection.operatingEntityId, tenantId);
  assert.deepEqual(createdBody.connection.scopes, ["acquisition:topics", "acquisition:xhs"]);

  const storedCredential = await prisma.workbuddyMcpConnection.findUniqueOrThrow({ where: { id: credentialId } });
  assert.equal((storedCredential as any).token, undefined);
  assert.notEqual(storedCredential.tokenHash, token);
  assert.equal(storedCredential.tokenPrefix, token.slice(0, 18));

  const listedSettings = await app.inject({ method: "GET", url: "/integrations/workbuddy/connections", headers: ownerHeaders });
  assert.equal(listedSettings.statusCode, 200);
  assert.equal(listedSettings.body.includes(token), false, "connection listing leaked the one-time secret");
  assert.equal(listedSettings.body.includes(storedCredential.tokenHash), false, "connection listing leaked the token hash");

  const initialized = await rpc(token, "initialize");
  assert.equal(initialized.statusCode, 200);
  assert.equal((initialized.json() as any).result.protocolVersion, "2024-11-05");
  assert.equal((await rpc(token, "ping")).statusCode, 200);
  const initializedNotification = await app.inject({
    method: "POST",
    url: "/integrations/workbuddy/mcp",
    headers: { authorization: `Bearer ${token}` },
    payload: { jsonrpc: "2.0", method: "notifications/initialized" }
  });
  assert.equal(initializedNotification.statusCode, 204);

  const scopedTools = await rpc(token, "tools/list");
  assert.equal(scopedTools.statusCode, 200, scopedTools.body);
  const toolNames = (scopedTools.json() as any).result.tools.map((tool: any) => tool.name);
  assert.deepEqual(toolNames, ["beauty.topic_ideas", "beauty.xiaohongshu_package"]);
  assert.equal(scopedTools.body.includes("sitong.ask"), false);
  assert.equal(scopedTools.body.includes("lanqi"), false);
  assert.equal(/tenantId|userId|productCode|agentId|SKILL\.md|system prompt/i.test(scopedTools.body), false);

  const forged = await callTool(token, "beauty.topic_ideas", {
    question: "请基于已确认事实提供生活美容门店获客计划",
    requestId: `forged_${runSuffix}`,
    topicWorkflow: topicWorkflowFixture,
    tenantId: otherTenantId
  });
  assert.equal(forged.statusCode, 500);
  assert.equal((forged.json() as any).error.message, "mcp_identity_argument_forbidden");
  assert.equal(providerCalls, 0);

  const wrongScope = await callTool(token, "beauty.live_script", {
    question: "请生成生活美容门店直播话术草稿",
    requestId: `scope_${runSuffix}`
  });
  assert.equal(wrongScope.statusCode, 500);
  assert.equal((wrongScope.json() as any).error.message, "beauty_tool_scope_forbidden");
  assert.equal(providerCalls, 0);

  await prisma.creditAccount.update({ where: { tenantId }, data: { balance: 0 } });
  const insufficient = await callTool(token, "beauty.topic_ideas", {
    question: "请基于已确认事实提供生活美容门店获客计划",
    requestId: `insufficient_${runSuffix}`,
    topicWorkflow: topicWorkflowFixture
  });
  assert.equal(insufficient.statusCode, 500);
  assert.equal((insufficient.json() as any).error.message, "insufficient_credits");
  assert.equal(providerCalls, 0, "Provider was called despite insufficient balance");

  await prisma.creditAccount.update({ where: { tenantId }, data: { balance: 100 } });
  const successArgs = {
    question: "请基于已确认事实提供生活美容门店获客计划",
    requestId: `success_${runSuffix}`,
    topicWorkflow: topicWorkflowFixture
  };
  const firstSuccess = await callTool(token, "beauty.topic_ideas", successArgs);
  assert.equal(firstSuccess.statusCode, 200, firstSuccess.body);
  const firstResult = (firstSuccess.json() as any).result.structuredContent;
  assert.equal(firstResult.status, "succeeded");
  assert.ok(providerCalls >= 1);
  const callsAfterSuccess = providerCalls;
  const duplicateSuccess = await callTool(token, "beauty.topic_ideas", successArgs);
  assert.equal(duplicateSuccess.statusCode, 200, duplicateSuccess.body);
  assert.equal((duplicateSuccess.json() as any).result.structuredContent.runId, firstResult.runId);
  assert.equal(providerCalls, callsAfterSuccess, "duplicate request called Provider again");

  const settled = await prisma.creditReservation.findFirstOrThrow({ where: { tenantId, requestId: { contains: successArgs.requestId } } });
  assert.equal(settled.status, "settled");
  assert.equal(settled.actualAmount, firstResult.creditCost);
  assert.ok(settled.amount >= settled.actualAmount!);
  const savedRun = await prisma.agentRun.findUniqueOrThrow({ where: { id: firstResult.runId } });
  assert.equal(savedRun.skillId, "baolu_topics", "saved run must record the workflow primary Skill");
  assert.match(savedRun.skillVersion, /beauty-industry-content-diff@/, "saved run lost the beauty differential constraint version");
  assert.equal(savedRun.productCode, "beauty-industry");
  assert.equal(savedRun.usageChannel, "mcp");
  assert.equal(savedRun.mcpCredentialId, credentialId);
  assert.equal(savedRun.modelProvider, "contract_provider");
  assert.match(savedRun.output ?? "", /本轮只按 2\/4 个真实可用来源形成第一版/);
  assert.doesNotMatch(savedRun.output ?? "", /验收[AB]店|tenant(?:Id|Key)?/i, "WorkBuddy result leaked the synthetic acceptance identity");
  const savedQualityFlags = Array.isArray(savedRun.qualityFlags) ? savedRun.qualityFlags.map(String) : [];
  assert.ok(savedQualityFlags.includes("route_receipt:beauty-route-receipt-v1"));
  assert.ok(savedQualityFlags.includes("route_channel:mcp"));
  assert.ok(savedQualityFlags.includes("route_capability:topic_inspiration"));
  assert.ok(savedQualityFlags.some((flag) => flag.startsWith("route_skill:baolu_topics@")));
  assert.ok(savedQualityFlags.includes("route_fallback:no"));
  assert.equal(await prisma.agentRun.count({ where: { requestId: settled.requestId } }), 1);
  const balanceAfterSuccess = 100 - firstResult.creditCost;
  assert.equal((await prisma.creditAccount.findUniqueOrThrow({ where: { tenantId } })).balance, balanceAfterSuccess);

  providerFailureMode = "error";
  const failingArgs = {
    question: "请基于已确认事实提供生活美容门店获客计划",
    requestId: `failed_${runSuffix}`,
    topicWorkflow: topicWorkflowFixture
  };
  const failed = await callTool(token, "beauty.topic_ideas", failingArgs);
  assert.equal(failed.statusCode, 500, failed.body);
  const callsAfterFailure = providerCalls;
  const released = await prisma.creditReservation.findFirstOrThrow({ where: { tenantId, requestId: { contains: failingArgs.requestId } } });
  assert.equal(released.status, "released");
  assert.equal(released.actualAmount, 0);
  assert.equal((await prisma.creditAccount.findUniqueOrThrow({ where: { tenantId } })).balance, balanceAfterSuccess);
  const failedAgain = await callTool(token, "beauty.topic_ideas", failingArgs);
  assert.equal(failedAgain.statusCode, 500);
  assert.equal((failedAgain.json() as any).error.message, "billing_request_previously_failed");
  assert.equal(providerCalls, callsAfterFailure, "failed idempotent retry called Provider twice");
  providerFailureMode = "none";

  for (const terminalMode of ["cancelled", "timed_out"] as const) {
    providerFailureMode = terminalMode;
    const callsBeforeTerminal = providerCalls;
    const balanceBeforeTerminal = (await prisma.creditAccount.findUniqueOrThrow({ where: { tenantId } })).balance;
    const terminalRequestId = `${terminalMode}_${runSuffix}`;
    const terminal = await callTool(token, "beauty.topic_ideas", {
      question: "请基于已确认事实提供生活美容门店获客计划",
      requestId: terminalRequestId,
      topicWorkflow: topicWorkflowFixture
    });
    assert.equal(terminal.statusCode, 500, `${terminalMode} did not fail closed`);
    assert.equal((terminal.json() as any).error.message, `provider_failure:${terminalMode}`);
    assert.equal(providerCalls, callsBeforeTerminal + 1, `${terminalMode} triggered an automatic Provider retry`);
    const terminalReservation = await prisma.creditReservation.findFirstOrThrow({
      where: { tenantId, requestId: { contains: terminalRequestId } }
    });
    assert.equal(terminalReservation.status, "released", `${terminalMode} did not release the reservation`);
    assert.equal(terminalReservation.errorCode, terminalMode);
    assert.equal((await prisma.creditAccount.findUniqueOrThrow({ where: { tenantId } })).balance, balanceBeforeTerminal);
  }
  providerFailureMode = "none";

  const videoConnectionCreated = await app.inject({
    method: "POST",
    url: "/integrations/workbuddy/connections",
    headers: ownerHeaders,
    payload: { productCode: "beauty-industry", scopes: ["acquisition:video-data-review"] }
  });
  assert.equal(videoConnectionCreated.statusCode, 201, videoConnectionCreated.body);
  const videoConnection = videoConnectionCreated.json() as any;
  const videoCallsBefore = providerCalls;
  const videoBalanceBefore = (await prisma.creditAccount.findUniqueOrThrow({ where: { tenantId } })).balance;
  const videoArgs = {
    question: "请复盘抖音 2026-08-18 至 2026-08-24 的后台作品数据；有效咨询代表用户主动询问项目或预约。",
    requestId: `video_data_${runSuffix}`,
    professionalOptions: {
      platform: "抖音",
      contentStructure: "复盘周期：2026-08-18 至 2026-08-24；观察窗口：发布后7天；有效咨询为业务转化口径",
      parseStatus: "parsed",
      sourceFilename: "beauty-video-data.csv",
      parsedEvidence: "作品标题,播放量,完播率,点赞,评论,分享,有效咨询\n日常补水护理流程,1200,32%,48,9,6,4\n到店前先问这三件事,860,41%,37,7,5,3"
    }
  };
  const videoFirst = await callTool(videoConnection.token, "beauty.video_data_review", videoArgs);
  assert.equal(videoFirst.statusCode, 200, videoFirst.body);
  const videoPayload = (videoFirst.json() as any).result;
  const videoResult = videoPayload.structuredContent;
  const videoText = videoPayload.content?.[0]?.text;
  assert.equal(videoResult.status, "succeeded");
  assert.match(videoText, /平均完播率 36\.5%/);
  assert.match(videoText, /业务转化合计 7/);
  assert.equal(providerCalls, videoCallsBefore, "structured video review called the model Provider");
  assert.equal((await prisma.creditAccount.findUniqueOrThrow({ where: { tenantId } })).balance, videoBalanceBefore - videoResult.creditCost);
  const videoDuplicate = await callTool(videoConnection.token, "beauty.video_data_review", videoArgs);
  assert.equal(videoDuplicate.statusCode, 200, videoDuplicate.body);
  assert.equal((videoDuplicate.json() as any).result.structuredContent.runId, videoResult.runId);
  assert.equal(providerCalls, videoCallsBefore, "duplicate structured video review called the Provider");
  assert.equal((await prisma.agentRun.count({ where: { tenantId, id: videoResult.runId } })), 1);

  const xhsCallsBefore = providerCalls;
  const xhsBalanceBefore = (await prisma.creditAccount.findUniqueOrThrow({ where: { tenantId } })).balance;
  const xhsArgs = {
    question: "为夏季基础补水护理做一套面向附近女性顾客的小红书图文",
    requestId: `xhs_${runSuffix}`
  };
  const firstXhs = await callTool(token, "beauty.xiaohongshu_package", xhsArgs);
  assert.equal(firstXhs.statusCode, 200, firstXhs.body);
  const xhsPayload = (firstXhs.json() as any).result;
  const xhsResult = xhsPayload.structuredContent;
  assert.equal(xhsResult.status, "succeeded");
  assert.equal(xhsResult.routeReceipt.capabilityId, "beauty_xiaohongshu_package");
  assert.equal(xhsResult.preview, true, "controlled WorkBuddy result must remain explicitly marked as a preview");
  assert.ok(xhsResult.customerDeliverable);
  assert.ok(xhsResult.productionNotes);
  assert.ok(xhsResult.auditReceipt);
  assert.doesNotMatch(xhsPayload.content[0].text, /受控流程|mock|Schema|Eval|任务事实回执|事实与合规待补|待核验/iu);
  assert.match(xhsResult.auditReceipt.markdown, /任务事实回执/);
  assert.match(xhsResult.auditReceipt.markdown, /事实与合规待补/);
  assert.equal(providerCalls, xhsCallsBefore + 1, "XHS success used an unexpected Provider retry");

  const duplicateXhs = await callTool(token, "beauty.xiaohongshu_package", xhsArgs);
  assert.equal(duplicateXhs.statusCode, 200, duplicateXhs.body);
  assert.equal((duplicateXhs.json() as any).result.structuredContent.runId, xhsResult.runId);
  assert.equal(providerCalls, xhsCallsBefore + 1, "duplicate XHS request called the Provider again");

  const xhsReservation = await prisma.creditReservation.findFirstOrThrow({ where: { tenantId, requestId: { contains: xhsArgs.requestId } } });
  assert.equal(xhsReservation.status, "settled");
  assert.equal(xhsReservation.actualAmount, xhsResult.creditCost);
  assert.equal(await prisma.agentRun.count({ where: { tenantId, requestId: xhsReservation.requestId } }), 1);
  const xhsSavedRun = await prisma.agentRun.findUniqueOrThrow({ where: { id: xhsResult.runId } });
  assert.equal(xhsSavedRun.skillId, "wechat-xhs-content-line");
  assert.equal(xhsSavedRun.usageChannel, "mcp");
  assert.equal(xhsSavedRun.mcpCredentialId, credentialId);
  assert.equal((await prisma.creditAccount.findUniqueOrThrow({ where: { tenantId } })).balance, xhsBalanceBefore - xhsResult.creditCost);

  const membership = await prisma.membership.findFirstOrThrow({ where: { tenantId, userId } });
  await prisma.membership.update({ where: { id: membership.id }, data: { isActive: false } });
  assert.equal((await rpc(token, "tools/list")).statusCode, 500, "inactive membership retained MCP access");
  await prisma.membership.update({ where: { id: membership.id }, data: { isActive: true } });
  await prisma.tenantProductEntitlement.update({
    where: { tenantId_productCode: { tenantId, productCode: "beauty-industry" } },
    data: { status: "paused" }
  });
  const pausedEntitlement = await rpc(token, "tools/list");
  assert.equal(pausedEntitlement.statusCode, 500, "paused product entitlement retained MCP access");
  assert.equal((pausedEntitlement.json() as any).error.message, "product_entitlement_required");
  const pausedRotation = await app.inject({
    method: "POST",
    url: `/integrations/workbuddy/connections/${credentialId}/rotate`,
    headers: ownerHeaders
  });
  assert.equal(pausedRotation.statusCode, 403, "rotation bypassed paused product entitlement");
  assert.equal((pausedRotation.json() as any).error, "product_entitlement_required");
  await prisma.tenantProductEntitlement.update({
    where: { tenantId_productCode: { tenantId, productCode: "beauty-industry" } },
    data: { status: "active" }
  });

  await prisma.workbuddyMcpConnection.update({
    where: { id: credentialId },
    data: { scopes: ["acquisition:topics", "acquisition:xhs", "acquisition:video-content-review"] }
  });
  const legacySettings = await app.inject({ method: "GET", url: "/integrations/workbuddy/connections", headers: ownerHeaders });
  assert.equal(legacySettings.statusCode, 200);
  const legacyConnection = (legacySettings.json() as any).connections.find((item: any) => item.id === credentialId);
  assert.deepEqual(legacyConnection.scopes, ["acquisition:topics", "acquisition:xhs", "acquisition:video-content-review"], "admitted scope was filtered from settings");
  const legacyTools = await rpc(token, "tools/list");
  assert.deepEqual((legacyTools.json() as any).result.tools.map((tool: any) => tool.name), ["beauty.topic_ideas", "beauty.xiaohongshu_package", "beauty.video_content_review"]);

  const rotated = await app.inject({
    method: "POST",
    url: `/integrations/workbuddy/connections/${credentialId}/rotate`,
    headers: ownerHeaders
  });
  assert.equal(rotated.statusCode, 201, rotated.body);
  const rotatedBody = rotated.json() as any;
  const rotatedToken = requiredString(rotatedBody.token, "rotated_one_time_token");
  assert.notEqual(rotatedToken, token);
  assert.deepEqual(rotatedBody.connection.scopes, ["acquisition:topics", "acquisition:xhs", "acquisition:video-content-review"], "rotation dropped an admitted scope");
  assert.equal((await rpc(token, "tools/list")).statusCode, 401, "rotated secret remained active");
  assert.equal((await rpc(rotatedToken, "tools/list")).statusCode, 200);

  await prisma.workbuddyMcpConnection.update({
    where: { id: rotatedBody.connection.id },
    data: { expiresAt: new Date(Date.now() - 1_000) }
  });
  assert.equal((await rpc(rotatedToken, "tools/list")).statusCode, 401, "expired secret remained active");

  const revokedCreated = await app.inject({
    method: "POST",
    url: "/integrations/workbuddy/connections",
    headers: ownerHeaders,
    payload: { productCode: "beauty-industry", scopes: ["acquisition:topics"] }
  });
  const revokedBody = revokedCreated.json() as any;
  assert.equal(revokedCreated.statusCode, 201, revokedCreated.body);
  const revoked = await app.inject({
    method: "DELETE",
    url: `/integrations/workbuddy/connections/${revokedBody.connection.id}`,
    headers: ownerHeaders
  });
  assert.equal(revoked.statusCode, 200);
  assert.equal((await rpc(revokedBody.token, "tools/list")).statusCode, 401, "revoked secret remained active");

  const wrongProductCreated = await app.inject({
    method: "POST",
    url: "/integrations/workbuddy/connections",
    headers: ownerHeaders,
    payload: { productCode: "beauty-industry", scopes: ["acquisition:topics"] }
  });
  assert.equal(wrongProductCreated.statusCode, 201, wrongProductCreated.body);
  const wrongProductBody = wrongProductCreated.json() as any;
  await prisma.workbuddyMcpConnection.update({
    where: { id: wrongProductBody.connection.id },
    data: { productCode: "lanqi" }
  });
  const otherProductTools = await rpc(wrongProductBody.token, "tools/list");
  assert.equal(otherProductTools.statusCode, 500);
  assert.equal((otherProductTools.json() as any).error.message, "product_entitlement_required");
  const callsBeforeWrongProduct = providerCalls;
  const otherProductCall = await callTool(wrongProductBody.token, "beauty.topic_ideas", {
    question: "请基于已确认事实提供生活美容门店获客计划",
    requestId: `wrong_product_${runSuffix}`,
    topicWorkflow: topicWorkflowFixture
  });
  assert.equal(otherProductCall.statusCode, 500);
  assert.equal((otherProductCall.json() as any).error.message, "product_entitlement_required");
  assert.equal(providerCalls, callsBeforeWrongProduct);
  await prisma.workbuddyMcpConnection.update({
    where: { id: wrongProductBody.connection.id },
    data: { productCode: "unregistered-product" }
  });
  assert.equal((await rpc(wrongProductBody.token, "tools/list")).statusCode, 401, "invalid product credential downgraded to legacy tools");

  const otherCreated = await app.inject({
    method: "POST",
    url: "/integrations/workbuddy/connections",
    headers: sessionHeaders(otherTenantId, otherUserId),
    payload: { productCode: "beauty-industry", scopes: ["acquisition:topics"] }
  });
  assert.equal(otherCreated.statusCode, 201, otherCreated.body);
  const otherBody = otherCreated.json() as any;
  const crossTenantAttempt = await callTool(otherBody.token, "beauty.topic_ideas", {
    question: "请基于已确认事实提供生活美容门店获客计划",
    requestId: `cross_${runSuffix}`,
    topicWorkflow: topicWorkflowFixture,
    tenantId
  });
  assert.equal(crossTenantAttempt.statusCode, 500);
  assert.equal((crossTenantAttempt.json() as any).error.message, "mcp_identity_argument_forbidden");
  assert.equal(await prisma.agentRun.count({ where: { tenantId: otherTenantId } }), 0);

  const audits = await prisma.auditLog.findMany({ where: { tenantId, resource: "workbuddy_mcp_connection" } });
  assert.ok(audits.some((item) => item.action === "workbuddy_mcp_connection.created"));
  assert.ok(audits.some((item) => item.action === "workbuddy_mcp_connection.rotated"));
  assert.ok(audits.some((item) => item.action === "workbuddy_mcp.tool_succeeded"));
  assert.equal(audits.some((item) => item.detail?.includes(successArgs.question)), false, "audit log leaked customer input");

  console.log("beauty industry WorkBuddy MCP database smoke passed: product credential, scopes, tenant binding, billing, idempotency, revoke and rotate");
} finally {
  await app.close();
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
  await prisma.$disconnect();
}

async function seedIdentity(): Promise<void> {
  await prisma.user.createMany({ data: [{ id: userId, nickname: "Beauty MCP Contract" }, { id: otherUserId, nickname: "Other Tenant Contract" }] });
  await prisma.tenant.createMany({
    data: [
      { id: tenantId, name: "Beauty MCP Contract Tenant", type: "local_business", industry: "生活美容" },
      { id: otherTenantId, name: "Other Contract Tenant", type: "local_business", industry: "生活美容" }
    ]
  });
  await prisma.membership.createMany({
    data: [
      { tenantId, userId, role: "owner", isActive: true },
      { tenantId: otherTenantId, userId: otherUserId, role: "owner", isActive: true }
    ]
  });
  await prisma.creditAccount.createMany({ data: [{ tenantId, balance: 100 }, { tenantId: otherTenantId, balance: 100 }] });
}

async function rpc(token: string, method: string): Promise<Awaited<ReturnType<typeof app.inject>>> {
  return app.inject({
    method: "POST",
    url: "/integrations/workbuddy/mcp",
    headers: { authorization: `Bearer ${token}` },
    payload: { jsonrpc: "2.0", id: `${method}_${runSuffix}`, method }
  });
}

async function callTool(token: string, name: string, args: Record<string, unknown>): Promise<Awaited<ReturnType<typeof app.inject>>> {
  return app.inject({
    method: "POST",
    url: "/integrations/workbuddy/mcp",
    headers: { authorization: `Bearer ${token}` },
    payload: { jsonrpc: "2.0", id: `${name}_${runSuffix}`, method: "tools/call", params: { name, arguments: args } }
  });
}

function requiredString(value: unknown, field: string): string {
  assert.equal(typeof value, "string", `${field} must be a string`);
  assert.ok((value as string).length > 20, `${field} must be non-trivial`);
  return value as string;
}
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack : "beauty_industry_workbuddy_mcp_smoke_failed");
  process.exitCode = 1;
});

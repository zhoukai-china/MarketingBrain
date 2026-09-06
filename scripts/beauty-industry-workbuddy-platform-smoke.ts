import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function main(): Promise<void> {
  const [
    shared,
    skillRegistry,
    agentRuntime,
    agentDefinitions,
    schema,
    connectionService,
    settingsRoute,
    mcpRoute,
    productExecution,
    adapter,
    gatewayClient,
    internalMcpRoute,
    apiAgentRuntime
  ] = await Promise.all([
    readFile("packages/shared/src/index.ts", "utf8"),
    readFile("packages/skills/src/index.ts", "utf8"),
    readFile("packages/agent/src/index.ts", "utf8"),
    readFile("apps/api/src/services/agent-definitions.ts", "utf8"),
    readFile("packages/db/prisma/schema.prisma", "utf8"),
    readFile("apps/api/src/services/workbuddy-connections.ts", "utf8"),
    readFile("apps/api/src/routes/workbuddy-settings.ts", "utf8"),
    readFile("apps/api/src/routes/workbuddy-mcp.ts", "utf8"),
    readFile("apps/api/src/products/beauty-industry/execution.ts", "utf8"),
    readFile("apps/api/src/products/beauty-industry/mcp-adapter.ts", "utf8"),
    readFile("apps/api/src/services/mcp-client.ts", "utf8"),
    readFile("apps/api/src/routes/mcp.ts", "utf8"),
    readFile("apps/api/src/services/agent-runtime.ts", "utf8")
  ]);

  assert.match(shared, /PRODUCT_LOGIN_CODES[^\n]+beauty-industry/, "beauty-industry product login is not registered");
  for (const skillId of ["beauty-industry-compliance", "beauty-industry-content-diff", "beauty-industry-xhs"]) {
    assert.match(shared, new RegExp(`\\| \\"${skillId}\\"`), `${skillId} is missing from shared SkillId`);
    assert.match(skillRegistry, new RegExp(`(?:^|\\n)  \\"?${skillId}\\"?: \\{`), `${skillId} manifest is missing`);
    assert.match(agentRuntime, new RegExp(`\\"${skillId}\\"`), `${skillId} is not active in the Agent runtime`);
  }
  assert.match(agentDefinitions, /id: "agent_beauty_acquisition"/, "beauty Agent is not registered");

  const credentialBlock = schema.match(/model WorkbuddyMcpConnection \{[\s\S]*?\n\}/)?.[0] ?? "";
  for (const field of ["productCode", "operatingEntityId", "scopes", "expiresAt", "revokedAt", "rotatedFromId", "rateLimitPerMinute"]) {
    assert.match(credentialBlock, new RegExp(`\\b${field}\\b`), `credential field missing: ${field}`);
  }
  assert.match(schema, /model CreditReservation \{/, "credit reservation model is missing");
  assert.match(schema, /model AgentRun \{[\s\S]*?\bproductCode\b[\s\S]*?\bmcpCredentialId\b/, "AgentRun usage association is missing");
  assert.match(schema, /model CreditTransaction \{[\s\S]*?\bproductCode\b[\s\S]*?\bchannel\b/, "credit ledger product/channel association is missing");

  assert.match(connectionService, /productCode/, "connection resolver does not return product identity");
  assert.match(connectionService, /expiresAt/, "connection resolver does not enforce expiry");
  assert.match(settingsRoute, /connections\/:connectionId\/rotate/, "credential rotation endpoint is missing");
  assert.match(settingsRoute, /workbuddy_mcp_connection\.(?:created|revoked|rotated)/, "credential lifecycle audit is missing");
  assert.match(settingsRoute, /activeBeautyScopes/, "retired beauty scopes are not filtered from listings and rotation");
  assert.match(mcpRoute, /listBeautyIndustryMcpTools/, "beauty product tools/list adapter is not wired");
  assert.match(mcpRoute, /runBeautyIndustryMcpTool/, "beauty product tools/call adapter is not wired");
  assert.match(mcpRoute, /executeBeautyIndustryProductTool/, "MCP route is not using the shared beauty product execution service");
  assert.match(productExecution, /billingContext/, "beauty product execution is not associated with shared billing context");
  assert.match(mcpRoute, /createRequestExecutionScope/, "MCP execution has no hard timeout or disconnect cancellation scope");
  assert.match(productExecution, /signal: params\.signal/, "MCP cancellation signal is not propagated to the Agent gateway");
  assert.match(productExecution, /createNoPaidRetryProvider/, "a failed Provider stage can be called again inside the same billed product request");
  assert.match(productExecution, /createBeautyTextBudgetedProvider/, "beauty Web/MCP execution is missing the shared pre-Provider text budget");
  assert.match(productExecution, /createBeautyXhsStructuredOutputProvider\(budgetedProvider,\s*\{/, "XHS configured output is not adapted through its versioned single-call transport");
  assert.match(productExecution, /event: "beauty_xhs_provider_output_rejected"/, "XHS structured-output rejection has no field-level safe diagnostic event");
  assert.match(productExecution, /requestFingerprint: params\.requestFingerprint\.slice\(0, 16\)/, "XHS rejection diagnostic is not associated with a redacted request fingerprint");
  assert.match(productExecution, /createObservedProvider\(outputAdaptedProvider\)/, "the budgeted and output-adapted Provider is not passed through the output observer");
  assert.match(productExecution, /createNoPaidRetryProvider\(providerObservation\.provider\)/, "the budgeted and observed Provider path is not protected from paid retries");
  assert.match(productExecution, /providerPolicyVersion: BEAUTY_TEXT_BUDGET_VERSION/, "beauty execution does not pin the budget policy across remote self-MCP");
  assert.match(gatewayClient, /providerPolicyVersion: params\.providerPolicyVersion/, "the Agent gateway drops the budget policy before remote self-MCP");
  assert.match(internalMcpRoute, /providerPolicyVersion[^\n]+BEAUTY_TEXT_BUDGET_VERSION/, "the internal MCP contract does not allow the pinned beauty budget policy");
  assert.match(internalMcpRoute, /createBeautyTextBudgetedProvider\(/, "remote self-MCP does not apply the pre-Provider beauty budget");
  assert.match(productExecution, /preflightAgentRequest/, "the no-retry wrapper drops pre-Provider Agent budget validation");
  assert.match(apiAgentRuntime, /await providerWithPreflight\.preflightAgentRequest\?\.\(agentRequest\)/, "Agent runtime emits provider-stage work before the beauty budget preflight");
  assert.doesNotMatch(adapter, /confirm_generate|quoteId/, "v1 exposes an unimplemented paid image action");
  assert.match(adapter, /beauty\.video_content_review|acquisition:video-content-review/, "admitted video content review is missing from MCP surface");

  console.log("Beauty industry WorkBuddy platform contract smoke passed.");
}

void main();

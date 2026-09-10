#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { closeSync, openSync, readFileSync, readSync, renameSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { inspectQuality } from "../packages/agent/src/index.js";
import { loadSkillQualityContract } from "../packages/skills/src/index.js";
import { parseBeautyImageDirections } from "../apps/api/src/products/beauty-industry/media-contract.js";
import { assertBeautyWorkflowRuntimeResult } from "../apps/api/src/products/beauty-industry/output-contract.js";
import { assignBeautyIndustryBrandToTenant } from "../apps/api/src/products/beauty-industry/brand-config.js";
import { buildBeautyIndustryRunInput } from "../apps/api/src/products/beauty-industry/profile.js";
import { getBeautyTextBudget } from "../apps/api/src/products/beauty-industry/text-budget.js";
import { BEAUTY_WORKFLOWS, buildBeautyWorkflowPrompt } from "../apps/api/src/products/beauty-industry/workflows.js";
import { buildBeautyXhsTaskFactDirective } from "../apps/api/src/products/beauty-industry/xhs-task-facts.js";
import { buildBeautyXhsTaskSnapshot, buildBeautyXhsTaskSnapshotDirective } from "../apps/api/src/products/beauty-industry/xhs-task-snapshot.js";
import { internalIdentityHeaders } from "./lib/internal-ops-identity.mjs";

const requireFromDb = createRequire(new URL("../packages/db/package.json", import.meta.url));
const { PrismaClient } = requireFromDb("@prisma/client");

const API_BASE = process.env.BY17_LIVE_API_BASE ?? "";
const API_PORT = Number(process.env.BY17_LIVE_API_PORT ?? "NaN");
const API_LOG = process.env.BY17_LIVE_API_LOG ?? "";
const COST_CEILING_CNY = Number(process.env.BY17_LIVE_COST_CEILING_CNY ?? "NaN");
const GRANT_PATH = process.env.BY17_LIVE_GRANT_PATH ?? "";
const SOURCE_FINGERPRINT = process.env.BY17_LIVE_SOURCE_FINGERPRINT ?? "";
const USER_INPUT = process.env.BY17_LIVE_USER_INPUT ?? "为夏季基础补水护理做一套面向附近女性顾客的小红书图文";
const PROFESSIONAL_OPTIONS = parseProfessionalOptions(process.env.BY17_LIVE_PROFESSIONAL_OPTIONS_JSON);
const DIAGNOSTIC_FINGERPRINT = createHash("sha256").update(JSON.stringify({ USER_INPUT, PROFESSIONAL_OPTIONS })).digest("hex").slice(0, 16);
const MODEL = "deepseek-v4-pro";
const TOOL_NAME = "beauty.xiaohongshu_package";
const CAPABILITY_ID = "beauty_xiaohongshu_package";
const SKILL_ID = "wechat-xhs-content-line";
const SCOPE = "acquisition:xhs";
const prisma = new PrismaClient();
const suffix = `${Date.now()}_${randomUUID().slice(0, 8)}`;
const tenantId = `by17_xhs_live_tenant_${suffix}`;
const userId = `by17_xhs_live_user_${suffix}`;
const externalRequestId = `by17_xhs_live_${suffix}`;

let credentialId;
let token;
let providerDispatched = false;
let logOffset = 0;
let safeResult = {
  status: "stopped",
  diagnosticFingerprint: DIAGNOSTIC_FINGERPRINT,
  model: MODEL,
  providerCalls: 0,
  usageEvents: 0,
  finishReason: null,
  promptTokens: null,
  completionTokens: null,
  reasoningTokens: null,
  totalTokens: null,
  costCeilingCny: COST_CEILING_CNY,
  estimatedCostCny: 0,
  fallbackUsed: null,
  contractPassed: false,
  webWorkbuddyConsistent: false,
  duplicateReplayConsistent: false,
  runStatus: null,
  reservationStatus: null,
  consumeTransactions: 0,
  errorCode: null
};

function consumeSingleUseGrant() {
  assert.ok(GRANT_PATH.endsWith(".json"), "one-time grant path is required");
  assert.match(SOURCE_FINGERPRINT, /^[A-F0-9]{64}$/, "current source fingerprint is required");
  const consumedPath = GRANT_PATH.replace(/\.json$/, ".consumed.json");
  let grant;
  try {
    grant = JSON.parse(readFileSync(GRANT_PATH, "utf8"));
  } catch {
    assert.fail("one-time grant is missing, invalid, or already consumed");
  }
  assert.equal(grant.approved, true);
  assert.match(grant.grantId, /^by35-xhs-text-live-\d{8}-once-[a-f0-9]{12}$/);
  assert.equal(grant.provider, "deepseek");
  assert.equal(grant.model, MODEL);
  assert.equal(grant.skillVersion, "wechat-xhs-content-line@1.0.3");
  assert.equal(grant.providerOutputVersion, "beauty-xhs-provider-output-v1");
  assert.equal(grant.maxProviderCalls, 1);
  assert.equal(grant.maxPromptBytes, 25_000);
  assert.equal(grant.maxInputTokens, 25_000);
  assert.equal(grant.maxOutputTokens, 5_120);
  assert.equal(grant.thinking, "disabled");
  assert.equal(grant.maxCostYuan, COST_CEILING_CNY);
  assert.equal(grant.automaticRetries, 0);
  assert.equal(grant.repairCalls, 0);
  assert.equal(grant.modelSwitches, 0);
  assert.equal(grant.additionalCalls, 0);
  assert.equal(grant.mediaProviderCalls, 0);
  assert.equal(grant.fileUploads, 0);
  assert.equal(grant.businessInputSha256, createHash("sha256").update(JSON.stringify({ USER_INPUT, PROFESSIONAL_OPTIONS })).digest("hex"));
  assert.equal(grant.sourceFingerprint, SOURCE_FINGERPRINT);
  assert.ok(Date.parse(grant.expiresAt) > Date.now(), "one-time grant expired");
  const consumed = { ...grant, consumedAt: new Date().toISOString() };
  renameSync(GRANT_PATH, consumedPath);
  writeFileSync(consumedPath, `${JSON.stringify(consumed, null, 2)}\n`, { encoding: "utf8" });
  safeResult.grantId = grant.grantId;
}

function safeCode(value) {
  return String(value ?? "unknown_error").replace(/[^a-z0-9_:\-.]/gi, "_").slice(0, 180);
}

function parseProfessionalOptions(raw) {
  if (!raw) return undefined;
  const value = JSON.parse(raw);
  assert.ok(value && typeof value === "object" && !Array.isArray(value), "professional options must be an object");
  const allowed = new Set(["project", "audience", "platform", "tone", "visualStyle", "city", "storeFacts", "contentAngle", "prohibitedContent"]);
  assert.deepEqual(Object.keys(value).filter((key) => !allowed.has(key)), [], "professional options contain unsupported fields");
  for (const [key, item] of Object.entries(value)) {
    assert.equal(typeof item, "string", `professional option ${key} must be a string`);
  }
  return value;
}

function round(value, digits = 6) {
  return Number(value.toFixed(digits));
}

function estimateCost(promptTokens, completionTokens) {
  const inputCnyPerMillion = 0.435 * 8;
  const outputCnyPerMillion = 0.87 * 8;
  return round((promptTokens * inputCnyPerMillion + completionTokens * outputCnyPerMillion) / 1_000_000);
}

function buildProductAlignedEvalContract(contract) {
  return {
    ...contract,
    requiredTerms: (contract.requiredTerms ?? []).filter((term) => !new Set(["事实母版", "画面方向", "逐张提示词"]).has(term)),
    // These are semantic delivery statements. The product postflight below
    // verifies their concrete title/tag/image/fact fields instead of requiring
    // the instructional sentences to appear verbatim in customer copy.
    requiredDeliverables: []
  };
}

function identityHeaders() {
  return internalIdentityHeaders({ tenantId, userId });
}

async function api(path, init = {}) {
  return fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
    signal: init.signal ?? AbortSignal.timeout(190_000)
  });
}

function readNewLogEvents() {
  const size = statSync(API_LOG).size;
  if (size <= logOffset) return [];
  const buffer = Buffer.alloc(size - logOffset);
  const fd = openSync(API_LOG, "r");
  try {
    readSync(fd, buffer, 0, buffer.length, logOffset);
  } finally {
    closeSync(fd);
  }
  return buffer.toString("utf8").split(/\r?\n/).flatMap((line) => {
    try {
      const value = JSON.parse(line);
      return value && typeof value === "object" ? [value] : [];
    } catch {
      return [];
    }
  });
}

async function seedSyntheticEmptyTenant() {
  const agent = await prisma.agentDefinition.findUniqueOrThrow({ where: { id: "agent_beauty_acquisition" } });
  assert.equal(agent.status, "active");
  await prisma.user.create({ data: { id: userId, nickname: "BY17 Synthetic Empty Profile" } });
  await prisma.tenant.create({ data: { id: tenantId, name: "BY17 Synthetic Empty Profile", type: "local_business" } });
  await prisma.membership.create({ data: { tenantId, userId, role: "owner", isActive: true } });
  await prisma.tenantProductEntitlement.create({
    data: { tenantId, productCode: "beauty-industry", status: "active", source: "by17_xhs_live_eval", expiresAt: new Date(Date.now() + 86_400_000) }
  });
  await prisma.tenantAgentEntitlement.create({
    data: { tenantId, agentId: agent.id, status: "active", source: "by17_xhs_live_eval", expiresAt: new Date(Date.now() + 86_400_000) }
  });
  await prisma.creditAccount.create({ data: { tenantId, balance: 8 } });
  await prisma.$transaction(async (tx) => {
    await assignBeautyIndustryBrandToTenant({
      transactionClient: tx,
      tenantId,
      brandCode: "lanqi",
      source: "controlled_acceptance"
    });
  });
  const profile = await prisma.tenantProfile.findUniqueOrThrow({
    where: { tenantId },
    select: { data: true, confirmedData: true }
  });
  for (const value of [profile.data, profile.confirmedData]) {
    assert.deepEqual(Object.keys(value ?? {}), ["beautyIndustryBrand"], "the live tenant must contain only its authorized brand assignment");
    assert.equal(value?.beautyIndustryBrand?.brandCode, "lanqi");
    assert.equal(value?.beautyIndustryBrand?.source, "controlled_acceptance");
  }
}

async function cleanup() {
  if (credentialId) {
    try {
      await api(`/integrations/workbuddy/connections/${credentialId}`, { method: "DELETE", headers: identityHeaders(), signal: AbortSignal.timeout(10_000) });
    } catch {}
  }
  try {
    await prisma.tenantProductEntitlement.updateMany({ where: { tenantId }, data: { status: "revoked" } });
    await prisma.tenantAgentEntitlement.updateMany({ where: { tenantId }, data: { status: "revoked" } });
    await prisma.creditAccount.updateMany({ where: { tenantId }, data: { balance: 0 } });
  } catch {}
  if (credentialId) {
    const connection = await prisma.workbuddyMcpConnection.findUnique({
      where: { id: credentialId },
      select: { status: true, revokedAt: true, tokenHash: true, tokenPrefix: true }
    });
    assert.equal(connection?.status, "revoked", "temporary WorkBuddy credential was not revoked");
    assert.ok(connection?.revokedAt && connection.tokenHash && connection.tokenPrefix, "credential revocation audit is incomplete");
  }
}

async function main() {
  assert.equal(process.env.BY17_LIVE_EXECUTE, "true", "explicit BY17 live execution gate is required");
  assert.ok(Number.isInteger(API_PORT) && API_PORT >= 1024 && API_PORT <= 65_535, "BY17 isolated API port is invalid");
  assert.equal(API_BASE, `http://127.0.0.1:${API_PORT}`, "BY17 live API base must match the isolated port");
  assert.ok(API_LOG && statSync(API_LOG).isFile(), "isolated API log is required");
  assert.ok(Number.isFinite(COST_CEILING_CNY) && COST_CEILING_CNY === 0.13, "authorized CNY ceiling must be exactly 0.13");

  const workflow = BEAUTY_WORKFLOWS.xiaohongshu;
  const composed = await buildBeautyWorkflowPrompt(CAPABILITY_ID);
  const contract = await loadSkillQualityContract(SKILL_ID);
  const budget = getBeautyTextBudget(CAPABILITY_ID, SKILL_ID);
  assert.ok(contract, "formal XHS contract is missing");
  assert.equal(workflow.toolName, TOOL_NAME);
  assert.equal(workflow.scope, SCOPE);
  assert.equal(workflow.primarySkillId, SKILL_ID);
  assert.match(composed.version, /^wechat-xhs-content-line@1\.0\.3\+beauty-industry-xhs@1\.1\.0\+beauty-industry-compliance@1\.0\.0$/);
  assert.equal(budget.model, MODEL);
  assert.equal(budget.thinkingMode, "disabled");
  assert.equal(budget.maxPromptBytes, 25_000);
  assert.equal(budget.maxOutputTokens, 5_120);
  assert.equal(budget.worstCostCny, 0.122635);
  assert.ok(budget.worstCostCny <= COST_CEILING_CNY, "worst cost exceeds authorization before Provider start");

  const readyResponse = await api("/ready", { method: "GET", signal: AbortSignal.timeout(5_000) });
  assert.equal(readyResponse.status, 200);
  const ready = await readyResponse.json();
  assert.equal(ready.ok, true);
  assert.equal(ready.checks?.database?.ok, true);
  assert.equal(ready.checks?.llm?.configured, true);
  assert.equal(ready.checks?.llm?.provider, "deepseek");
  assert.equal(ready.checks?.llm?.model, MODEL);

  consumeSingleUseGrant();

  await seedSyntheticEmptyTenant();
  const connectionResponse = await api("/integrations/workbuddy/connections", {
    method: "POST",
    headers: identityHeaders(),
    body: JSON.stringify({ productCode: "beauty-industry", label: "BY17 single live XHS acceptance", scopes: [SCOPE], expiresInDays: 1 })
  });
  assert.equal(connectionResponse.status, 201, `credential_create_${connectionResponse.status}`);
  const connection = await connectionResponse.json();
  token = connection.token;
  credentialId = connection.connection?.id;
  assert.ok(typeof token === "string" && token.length > 20, "credential secret missing");
  assert.ok(typeof credentialId === "string" && credentialId.length > 8, "credential id missing");

  const workspaceResponse = await api("/beauty-industry/acquisition", { headers: identityHeaders(), signal: AbortSignal.timeout(10_000) });
  assert.equal(workspaceResponse.status, 200);
  const workspace = await workspaceResponse.json();
  assert.equal(workspace.executionMode, "configured_provider");
  assert.equal(workspace.tools?.filter((item) => item.name === TOOL_NAME).length, 1);

  logOffset = statSync(API_LOG).size;
  const internalRequestId = `beauty-mcp:${credentialId}:${externalRequestId}`;
  const traceId = createHash("sha256").update(internalRequestId).digest("hex").slice(0, 16);
  providerDispatched = true;
  const rpcResponse = await api("/integrations/workbuddy/mcp", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: externalRequestId,
      method: "tools/call",
      params: {
        name: TOOL_NAME,
        arguments: {
          question: USER_INPUT,
          requestId: externalRequestId,
          mode: "quick",
          ...(PROFESSIONAL_OPTIONS ? { professionalOptions: PROFESSIONAL_OPTIONS } : {})
        }
      }
    })
  });
  const rpc = await rpcResponse.json();
  await new Promise((resolve) => setTimeout(resolve, 500));
  const events = readNewLogEvents();
  const providerStages = events.filter((event) => event.event === "agent_runtime_stage" && event.traceId === traceId && event.stage === "provider");
  const providerStarts = providerStages.filter((event) => event.status === "started");
  const providerCompleted = providerStages.filter((event) => event.status === "completed");
  const usageEvents = events.filter((event) => event.event === "domestic_provider_usage");
  const mediaEvents = events.filter((event) => /media|asr|visual/i.test(String(event.event ?? "")) && event.event !== "agent_runtime_stage");
  safeResult.providerCalls = providerStarts.length;
  safeResult.usageEvents = usageEvents.length;
  assert.equal(providerStarts.length, 1, "Provider start count is not exactly one");
  assert.equal(usageEvents.length, 1, "Provider usage terminal is not exactly one");
  assert.equal(mediaEvents.length, 0, "unexpected media Provider event");
  assert.equal(rpcResponse.status, 200, `mcp_http_${rpcResponse.status}`);
  assert.equal(rpc.error, undefined, `mcp_error:${safeCode(rpc.error?.message)}`);

  const usage = usageEvents[0];
  safeResult.finishReason = usage.finishReason ?? null;
  safeResult.promptTokens = Number.isInteger(usage.promptTokens) ? usage.promptTokens : null;
  safeResult.completionTokens = Number.isInteger(usage.completionTokens) ? usage.completionTokens : null;
  safeResult.reasoningTokens = Number.isInteger(usage.reasoningTokens) ? usage.reasoningTokens : null;
  safeResult.totalTokens = Number.isInteger(usage.totalTokens) ? usage.totalTokens : null;
  assert.equal(usage.selectedProvider, "deepseek");
  assert.equal(usage.selectedModel, MODEL);
  assert.equal(usage.finishReason, "stop");
  assert.equal(usage.reasoningTokens, 0, "thinking must remain disabled");
  assert.ok(usage.promptTokens <= 25_000, "actual input tokens exceeded authorization");
  assert.ok(usage.completionTokens <= 5_120, "actual output tokens exceeded authorization");
  const estimatedCostCny = estimateCost(usage.promptTokens, usage.completionTokens);
  safeResult.estimatedCostCny = estimatedCostCny;
  assert.ok(estimatedCostCny <= COST_CEILING_CNY, "actual estimated cost exceeded authorization");
  assert.equal(providerCompleted.length, 1, "Provider did not reach one successful terminal");

  const payload = rpc.result;
  const structured = payload?.structuredContent;
  const text = payload?.content?.find((item) => item.type === "text")?.text;
  assert.equal(structured?.status, "succeeded");
  assert.equal(typeof text, "string");
  assert.equal(structured.routeReceipt?.capabilityId, CAPABILITY_ID);
  assert.equal(structured.routeReceipt?.scope, SCOPE);
  assert.equal(structured.routeReceipt?.skillId, SKILL_ID);
  assert.equal(structured.routeReceipt?.skillVersion, "1.0.3");
  assert.equal(structured.routeReceipt?.constraintVersion, "beauty-industry-xhs@1.1.0+beauty-industry-compliance@1.0.0");
  assert.equal(structured.routeReceipt?.model, MODEL);
  assert.equal(structured.routeReceipt?.provider, "deepseek");
  assert.equal(structured.routeReceipt?.fallbackUsed, false);
  assert.equal(structured.routeReceipt?.parser, "beauty-workflow-output-v1");
  assert.equal(structured.preview, false, "real Provider delivery must not be marked as a preview");
  assert.ok(structured.customerDeliverable, "WorkBuddy customer delivery is missing");
  assert.ok(structured.productionNotes, "WorkBuddy production notes are missing");
  assert.ok(structured.auditReceipt, "WorkBuddy audit receipt is missing");
  assert.equal(text, structured.customerDeliverable.copyMarkdown, "WorkBuddy text must expose only the customer-copy layer");
  assert.doesNotMatch(text, /受控流程验收|确定性模拟输出|任务事实回执|事实与合规待补|待核验|Schema|Eval/i);

  // The MCP text channel intentionally contains only the customer-copy layer.
  // Formal Schema/Eval must run against the complete persisted workflow output,
  // which also contains production notes and the audit receipt. Applying the
  // complete contract to customer copy alone creates a false negative.
  const run = await prisma.agentRun.findUniqueOrThrow({ where: { id: structured.runId } });
  assert.equal(run.tenantId, tenantId);
  assert.equal(run.userId, userId);
  assert.equal(run.status, "succeeded");
  assert.equal(run.productCode, "beauty-industry");
  assert.equal(run.capabilityId, CAPABILITY_ID);
  assert.equal(run.skillId, SKILL_ID);
  assert.equal(run.mcpCredentialId, credentialId);
  assert.equal(typeof run.output, "string");
  const formalOutput = run.output;

  const effectiveInput = buildBeautyIndustryRunInput({
    question: USER_INPUT,
    profile: null,
    mode: "quick",
    professionalOptions: PROFESSIONAL_OPTIONS,
    xhsTaskFactDirective: buildBeautyXhsTaskFactDirective({
      question: USER_INPUT,
      project: PROFESSIONAL_OPTIONS?.project,
      audience: PROFESSIONAL_OPTIONS?.audience,
      platform: PROFESSIONAL_OPTIONS?.platform
    }),
    xhsTaskSnapshotDirective: buildBeautyXhsTaskSnapshotDirective(buildBeautyXhsTaskSnapshot({
      question: USER_INPUT,
      profile: null,
      professionalOptions: PROFESSIONAL_OPTIONS
    }))
  });
  const qualityFlags = inspectQuality(formalOutput, SKILL_ID, buildProductAlignedEvalContract(contract), [{ role: "user", content: effectiveInput }], CAPABILITY_ID);
  const validation = await assertBeautyWorkflowRuntimeResult({
    capabilityId: CAPABILITY_ID,
    expectedSkillId: SKILL_ID,
    expectedSkillVersion: composed.version,
    result: {
      capabilityId: CAPABILITY_ID,
      skillId: SKILL_ID,
      skillVersion: composed.version,
      answerText: formalOutput,
      deliveryStatus: "completed",
      qualityFlags,
      creditCost: structured.creditCost
    },
    observedProviderOutputs: [formalOutput],
    replay: false,
    taskFactSource: effectiveInput
  });
  assert.equal(validation.fallbackUsed, false);
  assert.equal(validation.providerOutputVerified, true);
  assert.deepEqual(validation.structuredDelivery?.customerDeliverable, structured.customerDeliverable);
  assert.deepEqual(validation.structuredDelivery?.productionNotes, structured.productionNotes);
  assert.deepEqual(validation.structuredDelivery?.auditReceipt, structured.auditReceipt);
  assert.equal(parseBeautyImageDirections(formalOutput, 3).length, 3);
  assert.doesNotMatch(formalOutput, /受控流程验收|确定性模拟输出|餐饮|外卖|兰琪|创始人\s*IP/i);
  safeResult.fallbackUsed = false;
  safeResult.contractPassed = true;

  const historyResponse = await api("/beauty-industry/acquisition/history", { headers: identityHeaders(), signal: AbortSignal.timeout(10_000) });
  assert.equal(historyResponse.status, 200);
  const history = await historyResponse.json();
  const historyRun = history.runs?.find((item) => item.id === structured.runId);
  assert.ok(historyRun, "Web history did not expose the WorkBuddy run");
  assert.equal(historyRun.output, formalOutput, "Web history did not expose the complete WorkBuddy-persisted contract");
  assert.equal(historyRun.capabilityId, CAPABILITY_ID);
  assert.equal(historyRun.skillId, SKILL_ID);
  assert.equal(historyRun.usageChannel, "mcp");
  safeResult.webWorkbuddyConsistent = true;

  const duplicateReplayResponse = await api("/integrations/workbuddy/mcp", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: externalRequestId,
      method: "tools/call",
      params: {
        name: TOOL_NAME,
        arguments: {
          question: USER_INPUT,
          requestId: externalRequestId,
          mode: "quick",
          ...(PROFESSIONAL_OPTIONS ? { professionalOptions: PROFESSIONAL_OPTIONS } : {})
        }
      }
    })
  });
  const duplicateReplay = await duplicateReplayResponse.json();
  assert.equal(duplicateReplayResponse.status, 200, `duplicate_replay_http_${duplicateReplayResponse.status}`);
  assert.equal(duplicateReplay.error, undefined, `duplicate_replay_error:${safeCode(duplicateReplay.error?.message)}`);
  assert.equal(duplicateReplay.result?.structuredContent?.runId, structured.runId, "duplicate replay did not recover the original run");
  await new Promise((resolve) => setTimeout(resolve, 250));
  const replayEvents = readNewLogEvents();
  assert.equal(
    replayEvents.filter((event) => event.event === "agent_runtime_stage" && event.traceId === traceId && event.stage === "provider" && event.status === "started").length,
    1,
    "duplicate replay started a second Provider call"
  );
  assert.equal(replayEvents.filter((event) => event.event === "domestic_provider_usage").length, 1, "duplicate replay emitted a second usage terminal");
  safeResult.duplicateReplayConsistent = true;

  const reservations = await prisma.creditReservation.findMany({ where: { tenantId } });
  assert.equal(reservations.length, 1);
  assert.equal(reservations[0].status, "settled");
  assert.equal(reservations[0].actualAmount, structured.creditCost);
  const transactions = await prisma.creditTransaction.findMany({ where: { tenantId, productCode: "beauty-industry" } });
  const consumes = transactions.filter((item) => item.direction === "consume");
  assert.equal(consumes.length, 1);
  assert.equal(consumes[0].amount, structured.creditCost);
  assert.equal(await prisma.agentRun.count({ where: { tenantId } }), 1);
  safeResult.runStatus = run.status;
  safeResult.reservationStatus = reservations[0].status;
  safeResult.consumeTransactions = consumes.length;
  safeResult.status = "passed";
}

try {
  await main();
} catch (error) {
  safeResult.errorCode = safeCode(error instanceof Error ? error.message : error);
  if (providerDispatched) {
    try {
      const events = readNewLogEvents();
      safeResult.providerCalls = events.filter((event) => event.event === "agent_runtime_stage" && event.stage === "provider" && event.status === "started").length;
      safeResult.usageEvents = events.filter((event) => event.event === "domestic_provider_usage").length;
    } catch {}
  }
  process.exitCode = 1;
} finally {
  try {
    await cleanup();
  } catch (error) {
    safeResult.status = "stopped";
    safeResult.errorCode = safeCode(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
  await prisma.$disconnect();
  console.log(JSON.stringify(safeResult));
}

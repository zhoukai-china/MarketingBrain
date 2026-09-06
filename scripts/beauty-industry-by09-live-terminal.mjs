#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { parseBy09ProviderUsageWindow } from "./beauty-industry-by09-usage-window.mjs";

const requireFromDb = createRequire(new URL("../packages/db/package.json", import.meta.url));
const { PrismaClient } = requireFromDb("@prisma/client");

const API_BASE = process.env.BY09_API_BASE ?? "http://127.0.0.1:3004";
const COST_CEILING_CNY = Number(process.env.BY09_COST_CEILING_CNY ?? "1.00");
const PRIOR_ESTIMATED_COST_CNY = Number(process.env.BY09_PRIOR_CONFIRMED_COST_CNY ?? "0");
const INPUT_USD_PER_MILLION = 0.435;
const OUTPUT_USD_PER_MILLION = 0.87;
const USD_TO_CNY_CEILING = 8;
const MODEL = "deepseek-v4-pro";
const prisma = new PrismaClient();
const suffix = `${Date.now()}_${randomUUID().slice(0, 8)}`;
const tenantId = `by09_live_tenant_${suffix}`;
const userId = `by09_live_user_${suffix}`;
let credentialId;
let token;
let sessionCostCny = 0;
let totalCostCny = PRIOR_ESTIMATED_COST_CNY;
let providerTerminalCount = 0;
const results = [];

const allTools = [
  {
    name: "beauty.topic_ideas",
    worstCostCny: 0.153621,
    capabilityId: "topic_inspiration",
    skillId: "baolu_topics",
    required: ["私有知识与客户问题", "行业与用户热点", "自身账号数据复盘", "同行与对标内容"],
    question: "请为一家生活美容门店生成四个来源的获客选题。已确认：城市为杭州，服务为基础清洁和日常补水护理，目标顾客是附近25至40岁上班族，渠道为小红书和抖音；价格、疗效、案例与预约方式均未确认。",
    topicWorkflow: {
      targetCustomer: "附近25至40岁上班族",
      acquisitionGoal: "获得合规到店咨询",
      industry: "生活美容",
      benchmarkAccounts: [],
      transcriptDocumentIds: [],
      sourceSelection: { industry: true, benchmark: false, transcript: false, videoReview: false }
    }
  },
  {
    name: "beauty.content_ten_pack",
    worstCostCny: 0.279569,
    capabilityId: "content_plan",
    skillId: "baolu_content_creator",
    required: ["一、选题策划", "二、口播逐字稿", "三、访谈话术", "四、拍摄脚本", "五、拍摄注意事项", "六、剪辑EDL", "七、发布标题与话题", "八、最佳发布时间", "九、评论区引导话术", "十、投流建议"],
    question: "请围绕‘第一次了解基础补水护理前先确认三件事’生成完整内容十件套。只使用已确认的生活美容服务范围，不编价格、疗效、案例或顾客经历；投流只给预览建议，不执行。"
  },
  {
    name: "beauty.xiaohongshu_package",
    worstCostCny: 0.122635,
    capabilityId: "beauty_xiaohongshu_package",
    skillId: "wechat-xhs-content-line",
    required: ["标题", "正文", "标签", "正向提示词", "负向提示词"],
    question: "生成一套夏季基础补水护理的小红书图文文字包，面向附近上班族，温暖真实，不出现顾客正脸。需要标题候选、正文、标签、互动承接和三张配图方向；价格、疗效、案例与真实门店场景均未确认。"
  },
  {
    name: "beauty.live_script",
    worstCostCny: 0.216428,
    capabilityId: "live_script",
    skillId: "live_script_planner",
    required: ["开场", "互动", "承接"],
    question: "生成一场生活美容门店直播话术，主题是基础清洁与日常补水护理流程介绍，受众为附近上班族。不得使用医疗、治疗、疗效承诺，不编价格和顾客案例；预约方式未确认时标待补。"
  },
  {
    name: "beauty.live_review",
    worstCostCny: 0.122385,
    capabilityId: "live_review",
    skillId: "baolu_live_review_engine",
    required: ["数据", "结论", "待补"],
    question: "复盘一场生活美容门店直播。已提供：观看人数320、平均停留42秒、评论18、私信咨询7、确认预约2；成交和到店数据未提供。请保留全部已提供字段，说明缺失边界并给下一轮改进。"
  },
  {
    name: "beauty.sales_advice",
    worstCostCny: 0.104818,
    capabilityId: "beauty_sales",
    skillId: "sales_growth_advisor",
    required: ["当前判断", "异议", "核心破局点", "推荐回复", "客户可能回复与预判应对", "下一步动作", "待核实"],
    question: "顾客询问基础补水护理是否一次就能明显改善。请给门店员工一套合规回复和后续沟通步骤；项目价格、顾客肤况、疗效证据和预约方式都未确认。"
  }
];
const requestedTools = new Set(
  (process.env.BY09_TOOL_NAMES ?? allTools.map((tool) => tool.name).join(","))
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);
const tools = allTools.filter((tool) => requestedTools.has(tool.name));
assert.ok(tools.length > 0, "at least one BY09 tool is required");
assert.equal(tools.length, requestedTools.size, "unknown BY09 tool requested");

async function main() {
  assert.equal(process.env.NODE_ENV, "production", "production environment required");
  await seed();
  const created = await api("/integrations/workbuddy/connections", {
    method: "POST",
    headers: identityHeaders(),
    body: JSON.stringify({
      productCode: "beauty-industry",
      label: "BY09 controlled live terminal",
      scopes: ["acquisition:topics", "acquisition:video-content", "acquisition:xhs", "acquisition:live", "acquisition:live-review", "sales:advice"],
      expiresInDays: 1
    })
  });
  assert.equal(created.status, 201, `credential_create_${created.status}`);
  const createdBody = await created.json();
  token = requiredString(createdBody.token, "credential_secret");
  credentialId = requiredString(createdBody.connection?.id, "credential_id");

  const listed = await rpc("tools/list", undefined, "tools_list");
  const names = listed?.result?.tools?.map((item) => item.name) ?? [];
  assert.deepEqual(names, allTools.map((item) => item.name));

  for (const tool of tools) {
    if (totalCostCny + tool.worstCostCny > COST_CEILING_CNY + 1e-9) {
      throw new Error(`cost_ceiling_preflight:${tool.name}`);
    }
    const startedAt = new Date(Date.now() - 250);
    const requestId = `by09_${tool.name.replace(/[^a-z]+/g, "_")}_${suffix}`;
    const started = Date.now();
    const response = await rpc("tools/call", {
      name: tool.name,
      arguments: {
        question: tool.question,
        requestId,
        mode: "quick",
        ...(tool.topicWorkflow ? { topicWorkflow: tool.topicWorkflow } : {})
      }
    }, requestId, 190_000);
    const latencyMs = Date.now() - started;
    if (response?.error) throw new Error(`tool_failed:${tool.name}:${safeCode(response.error.message)}`);
    const structured = response?.result?.structuredContent;
    assert.equal(structured?.status, "succeeded", `tool_not_succeeded:${tool.name}`);
    await wait(450);
    const usageRows = readUsageJournal(startedAt, new Date(Date.now() + 1_000));
    assert.equal(usageRows.length, 1, `provider_usage_terminal_ambiguous:${tool.name}:${usageRows.length}`);
    const usage = usageRows[0];
    assert.equal(usage.selectedModel, MODEL, `wrong_model:${tool.name}`);
    assert.equal(usage.finishReason, "stop", `non_terminal_finish:${tool.name}`);
    providerTerminalCount += 1;
    const costCny = estimateCost(usage.promptTokens, usage.completionTokens);
    sessionCostCny = round(sessionCostCny + costCny, 6);
    totalCostCny = round(totalCostCny + costCny, 6);
    if (totalCostCny > COST_CEILING_CNY + 1e-9) throw new Error(`cost_ceiling_exceeded:${tool.name}`);

    const run = await prisma.agentRun.findUniqueOrThrow({ where: { id: structured.runId } });
    assert.equal(run.tenantId, tenantId);
    assert.equal(run.productCode, "beauty-industry");
    assert.equal(run.usageChannel, "mcp");
    assert.equal(run.mcpCredentialId, credentialId);
    assert.equal(run.capabilityId, tool.capabilityId);
    assert.equal(run.skillId, tool.skillId);
    const reservation = await prisma.creditReservation.findFirstOrThrow({ where: { tenantId, mcpCredentialId: credentialId, agentRunId: run.id } });
    assert.equal(reservation.status, "settled", `reservation_not_settled:${tool.name}`);
    assert.equal(reservation.actualAmount, structured.creditCost);

    const result = {
      tool: tool.name,
      status: "terminal_received",
      latencyMs,
      model: usage.selectedModel,
      finishReason: usage.finishReason,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      reasoningTokens: usage.reasoningTokens,
      estimatedCostCny: round(costCny, 6),
      creditCost: structured.creditCost,
      reservationStatus: reservation.status,
      runFingerprint: createHash("sha256").update(run.id).digest("hex").slice(0, 12)
    };
    results.push(result);

    const text = response?.result?.content?.find((item) => item.type === "text")?.text;
    assert.equal(typeof text, "string", `tool_text_missing:${tool.name}`);
    assert.ok(text.length > 120, `tool_text_too_short:${tool.name}`);
    for (const marker of tool.required) assert.match(text, new RegExp(escapeRegExp(marker)), `required_marker_missing:${tool.name}`);
    assert.doesNotMatch(text, /兰琪|枕水江南|验收A店|验收B店|tenantKey|测试租户/i, `brand_or_internal_leak:${tool.name}`);
    assert.doesNotMatch(text, /保证(?:治愈|改善)|一次见效|根治|治疗痘痘|已为你发布|已完成投流/i, `unsafe_claim:${tool.name}`);
    result.status = "succeeded";
  }

  const providerRunCount = await prisma.agentRun.count({ where: { tenantId, mcpCredentialId: credentialId } });
  assert.equal(providerRunCount, tools.length);
  console.log(JSON.stringify({
    status: "passed",
    model: MODEL,
    providerCalls: providerTerminalCount,
    costCeilingCny: COST_CEILING_CNY,
    batchWorstCostCny: round(allTools.reduce((sum, item) => sum + item.worstCostCny, 0), 6),
    priorEstimatedCostCny: PRIOR_ESTIMATED_COST_CNY,
    sessionEstimatedCostCny: round(sessionCostCny, 6),
    estimatedCostCny: round(totalCostCny, 6),
    tools: results
  }));
}

async function seed() {
  const agent = await prisma.agentDefinition.findUniqueOrThrow({ where: { id: "agent_beauty_acquisition" } });
  assert.equal(agent.status, "active");
  await prisma.user.create({ data: { id: userId, nickname: "BY09 Controlled Evaluation" } });
  await prisma.tenant.create({ data: { id: tenantId, name: "BY09 Controlled Evaluation", type: "local_business", industry: "生活美容", city: "杭州" } });
  await prisma.membership.create({ data: { tenantId, userId, role: "owner", isActive: true } });
  await prisma.tenantProductEntitlement.create({ data: { tenantId, productCode: "beauty-industry", status: "active", source: "by09_controlled_eval", expiresAt: new Date(Date.now() + 86_400_000) } });
  await prisma.tenantAgentEntitlement.create({ data: { tenantId, agentId: agent.id, status: "active", source: "by09_controlled_eval", expiresAt: new Date(Date.now() + 86_400_000) } });
  await prisma.creditAccount.create({ data: { tenantId, balance: 10_000 } });
  const profile = {
    beautyIndustry: {
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
      confirmedAt: new Date().toISOString()
    }
  };
  await prisma.tenantProfile.create({ data: { tenantId, data: profile, confirmedData: profile, inferredData: {} } });
}

async function rpc(method, params, id, timeoutMs = 30_000) {
  const response = await api("/integrations/workbuddy/mcp", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) }),
    signal: AbortSignal.timeout(timeoutMs)
  });
  const payload = await response.json();
  if (response.status !== 200) throw new Error(`mcp_http_${response.status}:${safeCode(payload?.error?.message)}`);
  return payload;
}

function api(path, init) {
  return fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) }
  });
}

function identityHeaders() {
  return { "x-sitong-tenant-id": tenantId, "x-sitong-user-id": userId };
}

function readUsageJournal(start, end) {
  const stdout = execFileSync("journalctl", [
    "-u", "beauty-industry-beta",
    "--since", `@${Math.floor((start.getTime() - 1_000) / 1_000)}`,
    "--until", `@${Math.ceil((end.getTime() + 1_000) / 1_000)}`,
    "--output", "json",
    "--no-pager"
  ], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
  return parseBy09ProviderUsageWindow(stdout, start, end);
}

function estimateCost(promptTokens, completionTokens) {
  return ((promptTokens * INPUT_USD_PER_MILLION + completionTokens * OUTPUT_USD_PER_MILLION) / 1_000_000) * USD_TO_CNY_CEILING;
}

async function cleanup() {
  if (credentialId) {
    try {
      await api(`/integrations/workbuddy/connections/${credentialId}`, { method: "DELETE", headers: identityHeaders() });
    } catch {}
  }
  try {
    await prisma.tenantProductEntitlement.updateMany({ where: { tenantId }, data: { status: "revoked" } });
    await prisma.tenantAgentEntitlement.updateMany({ where: { tenantId }, data: { status: "revoked" } });
    await prisma.creditAccount.updateMany({ where: { tenantId }, data: { balance: 0 } });
  } catch {}
  if (credentialId) {
    const connection = await prisma.workbuddyMcpConnection.findUnique({ where: { id: credentialId }, select: { status: true, revokedAt: true, tokenHash: true, tokenPrefix: true } });
    assert.equal(connection?.status, "revoked", "temporary_credential_not_revoked");
    assert.ok(connection?.revokedAt, "temporary_credential_revoked_at_missing");
    assert.ok(connection?.tokenHash && connection?.tokenPrefix, "temporary_credential_hash_audit_missing");
  }
}

function requiredString(value, field) {
  if (typeof value !== "string" || value.length < 8) throw new Error(`${field}_missing`);
  return value;
}

function safeCode(value) {
  return typeof value === "string" ? value.replace(/[^a-z0-9_:-]/gi, "_").slice(0, 100) : "unknown";
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function round(value, digits) {
  return Number(value.toFixed(digits));
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

try {
  await main();
} catch (error) {
  console.log(JSON.stringify({
    status: "stopped",
    model: MODEL,
    providerCalls: providerTerminalCount,
    costCeilingCny: COST_CEILING_CNY,
    batchWorstCostCny: round(allTools.reduce((sum, item) => sum + item.worstCostCny, 0), 6),
    priorEstimatedCostCny: PRIOR_ESTIMATED_COST_CNY,
    sessionEstimatedCostCny: round(sessionCostCny, 6),
    estimatedCostCny: round(totalCostCny, 6),
    errorCode: safeCode(error instanceof Error ? error.message : "unknown_error"),
    tools: results
  }));
  process.exitCode = 1;
} finally {
  await cleanup();
  await prisma.$disconnect();
}

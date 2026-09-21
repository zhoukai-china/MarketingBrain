import { createHash, randomUUID } from "node:crypto";
import type { LlmProvider } from "@baolu/agent";
import { prisma } from "@baolu/db";
import type { FastifyInstance } from "fastify";
import { env } from "../config/env.js";
import {
  BEAUTY_INDUSTRY_PRODUCT_CODE,
  BEAUTY_INDUSTRY_SCOPES,
  listBeautyIndustryMcpTools,
  runBeautyIndustryMcpTool,
  type BeautyIndustryExecutionResult,
  type BeautyIndustryMcpContext,
  type BeautyIndustryScope
} from "../products/beauty-industry/mcp-adapter.js";
import { executeBeautyIndustryProductTool } from "../products/beauty-industry/execution.js";
import { AgentClarificationRequired, assertAgentAccess, getRuntimeAgent } from "../services/agent-runtime.js";
import { invokeSkillViaGateway } from "../services/mcp-client.js";
import { resolveDatabaseRequestContext, type RequestContext } from "../services/request-context.js";
import { createRequestExecutionScope } from "../services/request-execution-scope.js";
import {
  enqueueBeautyDailyBrief,
  listBeautyDailyBriefHistory,
  processBeautyDailyBriefSnapshot,
  readBeautyDailyBriefState,
  retryBeautyDailyBrief
} from "../products/beauty-industry/daily-brief-service.js";
import { readBeautyDailyBriefClock } from "../products/beauty-industry/daily-brief-contract.js";
import { RequestSingleFlight } from "../services/request-single-flight.js";
import {
  resolveBeautyIndustryBrandContext,
  toBeautyIndustryPublicBrand
} from "../products/beauty-industry/brand-config.js";
import {
  executeBeautyBusinessQa,
  type BeautyBusinessQaExecutionResult
} from "./lanqi-business-qa.js";
import {
  createBeautyBusinessQaFingerprint
} from "../products/beauty-industry/business-qa.js";
import {
  getWorkbuddyConnectionIssues,
  markWorkbuddyConnectionUsed,
  resolveWorkbuddyConnection,
  type WorkbuddyConnection
} from "../services/workbuddy-connections.js";
import { getMarketplaceSku, listMarketplaceSkus, runMarketplaceSku } from "./marketplace.js";

type JsonRpcId = string | number | null;
type JsonRpcRequest = { jsonrpc?: string; id?: JsonRpcId; method?: string; params?: Record<string, unknown> };

const ASK_TOOL = "sitong.ask";
const LIST_SKILLS_TOOL = "sitong.skills";
// Successful duplicates can replay in-memory. Failed calls must fall through to
// the durable reservation tombstone so a later duplicate cannot call Provider
// again or hide the billing_request_previously_failed terminal state.
const beautyMcpSingleFlight = new RequestSingleFlight<BeautyIndustryExecutionResult>(10 * 60_000, 500, false);
const beautyBusinessQaMcpSingleFlight = new RequestSingleFlight<BeautyBusinessQaExecutionResult>(10 * 60_000, 500, false);

export async function registerWorkbuddyMcpRoutes(app: FastifyInstance, provider: LlmProvider): Promise<void> {
  app.get("/integrations/workbuddy/status", async () => ({
    enabled: env.WORKBUDDY_MCP_ENABLED === "true",
    configured: env.WORKBUDDY_MCP_ENABLED === "true" && getWorkbuddyConnectionIssues().length === 0,
    tools: [ASK_TOOL, LIST_SKILLS_TOOL]
  }));

  app.post("/integrations/workbuddy/mcp", async (request, reply) => {
    const connection = await resolveWorkbuddyConnection(request.headers.authorization);
    if (!connection) return reply.code(401).send(rpcError(null, -32001, "workbuddy_mcp_unauthorized"));

    const body = request.body as JsonRpcRequest;
    const id = body?.id ?? null;
    if (!body || body.jsonrpc !== "2.0" || typeof body.method !== "string") {
      return reply.code(400).send(rpcError(id, -32600, "invalid_jsonrpc_request"));
    }

    try {
      const access = await resolveWorkbuddyAccess(connection);
      const context = access.context;
      const agent = access.mode === "agent" ? access.agent : null;
      const brandContext = connection.productCode === BEAUTY_INDUSTRY_PRODUCT_CODE
        ? toBeautyIndustryPublicBrand(resolveBeautyIndustryBrandContext(context.profile.data))
        : undefined;
      await markWorkbuddyConnectionUsed(connection);
      if (body.method === "initialize") {
        return rpcResult(id, {
          protocolVersion: "2024-11-05",
          serverInfo: { name: "sitong-workbuddy-mcp", version: "1.0.0" },
          capabilities: { tools: {} }
        });
      }
      if (body.method === "notifications/initialized") return reply.code(204).send();
      if (body.method === "ping") return rpcResult(id, {});
      if (body.method === "tools/list") {
        if (connection.productCode === BEAUTY_INDUSTRY_PRODUCT_CODE) {
          const beautyContext = toBeautyMcpContext(connection);
          await auditWorkbuddyEvent(connection, "workbuddy_mcp.tools_listed", { toolCount: listBeautyIndustryMcpTools(beautyContext).length });
          return rpcResult(id, { tools: listBeautyIndustryMcpTools(beautyContext), brandContext });
        }
        if (connection.productCode) return rpcResult(id, { tools: [] });
        return rpcResult(id, { tools: toolDefinitions() });
      }
      if (body.method !== "tools/call") return reply.code(404).send(rpcError(id, -32601, `unknown_method:${body.method}`));

      const toolName = String(body.params?.name ?? "");
      const args = objectValue(body.params?.arguments);

      if (connection.productCode === BEAUTY_INDUSTRY_PRODUCT_CODE) {
        if (!agent) throw new Error("workbuddy_agent_missing");
        await enforceWorkbuddyRateLimit(connection);
        if (toolName === "beauty.business_qa") {
          const beautyContext = toBeautyMcpContext(connection);
          if (!beautyContext.scopes.includes("operations:business-qa")) throw new Error("beauty_tool_scope_forbidden");
          for (const key of ["tenantId", "userId", "productCode", "operatingEntityId", "credentialId", "agentId", "scopes"]) {
            if (Object.hasOwn(args, key)) throw new Error("mcp_identity_argument_forbidden");
          }
          const question = requiredText(args.question, "question", 1_200);
          if (question.length < 2) throw new Error("mcp_argument_invalid:question");
          const externalRequestId = requiredText(args.requestId, "requestId", 200);
          if (externalRequestId.length < 8) throw new Error("mcp_argument_invalid:requestId");
          const conversationId = optionalText(args.conversationId, 200);
          const connectionScope = createHash("sha256").update(connection.id).digest("hex").slice(0, 16);
          const requestId = `workbuddy-business-qa:${connectionScope}:${externalRequestId}`;
          const fingerprint = createBeautyBusinessQaFingerprint({ tenantId: context.tenantId, conversationId, question });
          const executionScope = createRequestExecutionScope({ requestRaw: request.raw, replyRaw: reply.raw, timeoutMs: 45_000, timeoutCode: "business_qa_timed_out" });
          try {
            const result = await beautyBusinessQaMcpSingleFlight.run({
              key: requestId,
              fingerprint,
              onConflict: () => new Error("request_id_conflict"),
              execute: () => executeBeautyBusinessQa({ context, provider, requestId, fingerprint, question, conversationId, deviceScope: "desktop", signal: executionScope.signal, channel: "mcp", operatingEntityId: beautyContext.operatingEntityId, credentialId: connection.id })
            });
            await auditWorkbuddyEvent(connection, "workbuddy_mcp.tool_succeeded", { toolName, runId: result.agentRunId, creditCost: result.creditCost });
            return rpcResult(id, {
              content: [{ type: "text", text: String(result.answer ?? "") }],
              structuredContent: { status: result.status, conversationId: result.conversationId, runId: result.agentRunId, creditCost: result.creditCost, remainingCredits: result.remainingCredits, capabilityId: "beauty_business_qa", skillId: "general_qa", skillVersion: "0.2.0", brandContext }
            });
          } finally {
            executionScope.dispose();
          }
        }
        if (toolName === "beauty.daily_brief") {
          const beautyContext = toBeautyMcpContext(connection);
          if (!beautyContext.scopes.includes("operations:daily-brief")) throw new Error("beauty_tool_scope_forbidden");
          const action = String(args.action ?? "");
          const requestId = String(args.requestId ?? "").trim();
          if (requestId.length < 8) throw new Error("mcp_argument_invalid:requestId");
          const businessDate = typeof args.businessDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(args.businessDate)
            ? args.businessDate
            : readBeautyDailyBriefClock().businessDate;
          if (action === "get") {
            const state = await readBeautyDailyBriefState({ businessDate, includeReport: true });
            await auditWorkbuddyEvent(connection, "workbuddy_mcp.daily_brief_read", { businessDate, status: state.status });
            return rpcResult(id, { content: [{ type: "text", text: `美业 AI 日报 ${businessDate}：${state.status}` }], structuredContent: { ...state, brandContext } });
          }
          if (action === "history") {
            const reports = await listBeautyDailyBriefHistory(31);
            await auditWorkbuddyEvent(connection, "workbuddy_mcp.daily_brief_history", { count: reports.length });
            return rpcResult(id, { content: [{ type: "text", text: `已读取 ${reports.length} 个北京时间业务日状态。` }], structuredContent: { reports, brandContext } });
          }
          if (!["owner", "admin"].includes(context.role)) throw new Error("daily_brief_retry_forbidden");
          if (action !== "generate" && action !== "retry") throw new Error("mcp_argument_invalid:action");
          const queued = action === "retry"
            ? await retryBeautyDailyBrief({ tenantId: context.tenantId, userId: context.userId, businessDate })
            : await enqueueBeautyDailyBrief({ tenantId: context.tenantId, userId: context.userId, businessDate, trigger: "manual" });
          if (!queued.reused) void processBeautyDailyBriefSnapshot(queued.snapshotId);
          await auditWorkbuddyEvent(connection, "workbuddy_mcp.daily_brief_queued", { businessDate, reused: queued.reused, snapshotId: queued.snapshotId });
          return rpcResult(id, { content: [{ type: "text", text: queued.reused ? "已返回同一业务日正在进行或已有的日报任务。" : "美业 AI 日报任务已入队。" }], structuredContent: { ...queued, businessDate, capabilityId: "beauty_daily_brief", providerCallsAtAcceptance: 0, brandContext } });
        }
        const executionScope = createRequestExecutionScope({
          requestRaw: request.raw,
          replyRaw: reply.raw,
          timeoutMs: env.SKILL_MCP_INVOKE_TIMEOUT_MS,
          timeoutCode: "workbuddy_mcp_timed_out"
        });
        try {
          const beautyContext = toBeautyMcpContext(connection);
          const result = await runBeautyIndustryMcpTool({
            context: beautyContext,
            toolName,
            arguments: args,
            execute: (spec) => beautyMcpSingleFlight.run({
              key: spec.requestId,
              fingerprint: hashMcpInvocation(toolName, args),
              onConflict: () => new Error("request_id_conflict"),
              execute: () => executeBeautyIndustryProductTool({
                context,
                agent,
                provider,
                requestId: spec.requestId,
                requestFingerprint: hashMcpInvocation(spec.capabilityId, spec.arguments),
                operatingEntityId: spec.operatingEntityId,
                channel: "mcp",
                credentialId: spec.credentialId,
                capabilityId: spec.capabilityId,
                skillId: spec.skillId,
                input: spec.input,
                mode: spec.mode,
                professionalOptions: spec.professionalOptions,
                topicWorkflow: spec.topicWorkflow,
                contentWorkflow: spec.contentWorkflow,
                videoContentWorkflow: spec.videoContentWorkflow,
                liveReviewWorkflow: spec.liveReviewWorkflow,
                conversationId: optionalText(spec.arguments.conversationId, 200),
                deviceScope: "desktop",
                signal: executionScope.signal
              })
            })
          });
          await auditWorkbuddyEvent(connection, "workbuddy_mcp.tool_succeeded", {
            toolName,
            runId: result.runId,
            creditCost: result.creditCost,
            routeReceipt: result.routeReceipt ?? null
          });
          return rpcResult(id, {
            content: [{ type: "text", text: result.structuredDelivery?.customerDeliverable.copyMarkdown ?? result.text }],
            structuredContent: {
              status: result.status,
              runId: result.runId,
              abilityUsed: result.abilityUsed,
              routeReceipt: result.routeReceipt,
              creditCost: result.creditCost,
              remainingCredits: result.remainingCredits,
              brandContext,
              ...(result.structuredDelivery ? {
                customerDeliverable: result.structuredDelivery.customerDeliverable,
                productionNotes: result.structuredDelivery.productionNotes,
                auditReceipt: result.structuredDelivery.auditReceipt,
                preview: result.structuredDelivery.preview
              } : {})
            }
          });
        } finally {
          executionScope.dispose();
        }
      }
      if (connection.productCode) return reply.code(404).send(rpcError(id, -32601, `unknown_tool:${toolName}`));

      if (toolName === LIST_SKILLS_TOOL) {
        if (access.mode === "marketplace") {
          const skus = await listMarketplaceSkus({ status: "selling" as const }, false);
          return rpcResult(id, toolText({
            mode: "marketplace",
            skills: skus.map((sku) => ({
              skuCode: sku.skuCode,
              name: sku.name,
              capabilityKey: sku.capabilityKey ?? null,
              ppu: sku.ppu
            }))
          }));
        }
        if (!agent) throw new Error("workbuddy_agent_missing");
        return rpcResult(id, toolText({
          agentId: agent.id,
          agentName: agent.name,
          skills: agent.allowedSkills.map((skill) => ({
            skillId: skill.skillId,
            version: skill.version,
            isDefault: skill.isDefault
          }))
        }));
      }
      if (toolName !== ASK_TOOL) return reply.code(404).send(rpcError(id, -32601, `unknown_tool:${toolName}`));

      if (access.mode === "marketplace") {
        const skuCode = optionalText(args.skuCode, 100);
        if (!skuCode) {
          const available = await listMarketplaceSkus({ status: "selling" as const }, false);
          throw new Error(`mcp_argument_required:skuCode;available=${available.map((sku) => sku.skuCode).join(",")}`);
        }
        const sku = await getMarketplaceSku(skuCode);
        if (!sku) throw new Error("marketplace_sku_not_found");
        const input = requiredText(args.input, "input", 20_000);
        const providedConversationId = optionalText(args.conversationId, 200);
        const stored = providedConversationId
          ? await prisma.marketplaceConversation.findFirst({
              where: {
                conversationId: providedConversationId,
                tenantId: context.tenantId,
                userId: context.userId,
                skuCode
              }
            })
          : null;
        const conversationId = stored ? providedConversationId as string : randomUUID();
        const normalizeHistory = (value: unknown) =>
          Array.isArray(value)
            ? value
                .filter((item) => item && typeof item === "object" && (item as { role?: unknown }).role && ((item as { role?: unknown }).role === "user" || (item as { role?: unknown }).role === "assistant") && typeof (item as { content?: unknown }).content === "string")
                .map((item) => ({ role: (item as { role: "user" | "assistant" }).role, content: String((item as { content: string }).content) }))
            : [];
        const priorHistory = [...normalizeHistory(stored?.history), ...normalizeHistory(args.history)].slice(-12);
        const outcome = await runMarketplaceSku({
          context,
          sku,
          body: { input, history: priorHistory.length > 0 ? priorHistory : undefined },
          log: request.log
        });
        if (!outcome.ok) throw new Error(String(outcome.body.error ?? "marketplace_run_failed"));
        const answer = String(outcome.body.answer ?? "");
        const newHistory = [
          ...priorHistory,
          { role: "user", content: input },
          { role: "assistant", content: answer }
        ].slice(-12);
        await prisma.marketplaceConversation.upsert({
          where: { conversationId },
          create: {
            tenantId: context.tenantId,
            userId: context.userId,
            skuCode,
            conversationId,
            history: newHistory
          },
          update: { history: newHistory, updatedAt: new Date() }
        }).catch((error: unknown) => {
          request.log.warn({ err: error }, "marketplace conversation persist failed");
        });
        return rpcResult(id, {
          content: [{ type: "text", text: `${answer}\n\n[conversationId: ${conversationId}]` }],
          structuredContent: {
            status: outcome.body.needsInput === true ? "clarification_required" : "completed",
            conversationId,
            skuCode,
            creditCost: outcome.body.consumedCredits ?? 0,
            remainingCredits: outcome.body.balance ?? null,
            pricingMode: outcome.body.pricingMode ?? null
          }
        });
      }

      if (!agent) throw new Error("workbuddy_agent_missing");
      const input = requiredText(args.input, "input", 20_000);
      const conversationId = optionalText(args.conversationId, 200);
      if (conversationId) await assertWorkbuddyConversation({ tenantId: connection.tenantId, userId: connection.userId, agentId: agent.id }, conversationId);
      const externalRequestId = optionalText(args.requestId, 200) ?? randomUUID();
      const connectionScope = createHash("sha256").update(connection.id).digest("hex").slice(0, 16);
      const result = await invokeSkillViaGateway({
        requestId: `workbuddy:${connectionScope}:${externalRequestId}`,
        context,
        provider,
        agentId: agent.id,
        capabilityId: optionalText(args.capabilityId, 200),
        skillId: optionalText(args.skillId, 200),
        input,
        conversationId,
        channel: "workbuddy",
        deviceScope: "desktop",
        routingSource: optionalText(args.skillId, 200) ? "legacy" : "agent_router",
        deliveryPolicy: "clarify"
      });
      return rpcResult(id, {
        content: [{ type: "text", text: result.answerText }],
        structuredContent: {
          status: result.deliveryStatus,
          conversationId: result.conversationId,
          skillId: result.skillId,
          creditCost: result.creditCost,
          remainingCredits: result.remainingCredits,
          traceId: result.traceId
        }
      });
    } catch (error) {
      // A clarification is a normal conversational result. Returning HTTP 500 makes
      // MCP clients such as WorkBuddy report a transport failure instead of showing
      // the user the question they need to answer.
      if (error instanceof AgentClarificationRequired) {
        return rpcResult(id, {
          content: [{ type: "text", text: error.prompt }],
          structuredContent: { status: "clarification_required" }
        });
      }
      void auditWorkbuddyEvent(connection, "workbuddy_mcp.tool_failed", {
        errorCode: externalErrorMessage(error),
        diagnosticCode: internalDiagnosticCode(error)
      }).catch(() => undefined);
      request.log.error({ err: error, connection: connection.label }, "WorkBuddy MCP call failed");
      return reply.code(500).send(rpcError(id, -32000, externalErrorMessage(error)));
    }
  });
}

type WorkbuddyAccess =
  | { mode: "agent"; context: RequestContext; agent: Awaited<ReturnType<typeof getRuntimeAgent>> }
  | { mode: "marketplace"; context: RequestContext };

async function resolveWorkbuddyAccess(connection: WorkbuddyConnection): Promise<WorkbuddyAccess> {
  const context = await resolveDatabaseRequestContext(connection.tenantId, connection.userId);
  if (connection.mode === "marketplace") return { mode: "marketplace", context };
  if (!connection.agentId) throw new Error("workbuddy_agent_missing");
  const agent = await getRuntimeAgent(connection.agentId);
  await assertAgentAccess(context, agent);
  if (!connection.productCode) return { mode: "agent", context, agent };
  if (connection.source !== "database") throw new Error("product_credential_database_required");
  if (!connection.operatingEntityId || connection.operatingEntityId !== context.tenantId) {
    throw new Error("workbuddy_operating_entity_mismatch");
  }
  const entitlement = await prisma.tenantProductEntitlement.findFirst({
    where: {
      tenantId: context.tenantId,
      productCode: connection.productCode,
      status: "active",
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }]
    },
    select: { id: true }
  });
  if (!entitlement) throw new Error("product_entitlement_required");
  if (connection.productCode === BEAUTY_INDUSTRY_PRODUCT_CODE && connection.agentId !== "agent_beauty_acquisition") {
    throw new Error("beauty_product_agent_mismatch");
  }
  return { mode: "agent", context, agent };
}

function toBeautyMcpContext(connection: WorkbuddyConnection): BeautyIndustryMcpContext {
  const allowed = new Set<string>(BEAUTY_INDUSTRY_SCOPES);
  const scopes = connection.scopes.filter((scope): scope is BeautyIndustryScope => allowed.has(scope));
  return {
    credentialId: connection.id,
    tenantId: connection.tenantId,
    userId: connection.userId,
    productCode: connection.productCode ?? "",
    operatingEntityId: connection.operatingEntityId ?? "",
    scopes,
    entitled: true
  };
}

async function enforceWorkbuddyRateLimit(connection: WorkbuddyConnection): Promise<void> {
  if (connection.source !== "database") return;
  const count = await prisma.auditLog.count({
    where: {
      tenantId: connection.tenantId,
      resource: "workbuddy_mcp_connection",
      resourceId: connection.id,
      action: "workbuddy_mcp.call_started",
      createdAt: { gt: new Date(Date.now() - 60_000) }
    }
  });
  if (count >= connection.rateLimitPerMinute) throw new Error("workbuddy_mcp_rate_limit_exceeded");
  await auditWorkbuddyEvent(connection, "workbuddy_mcp.call_started");
}

async function auditWorkbuddyEvent(
  connection: WorkbuddyConnection,
  action: string,
  detail?: Record<string, unknown>
): Promise<void> {
  if (connection.source !== "database") return;
  await prisma.auditLog.create({
    data: {
      tenantId: connection.tenantId,
      userId: connection.userId,
      action,
      resource: "workbuddy_mcp_connection",
      resourceId: connection.id,
      detail: detail ? JSON.stringify(detail) : undefined
    }
  });
}

function hashMcpInvocation(toolName: string, args: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify([toolName, canonicalJson(args)])).digest("hex");
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalJson(item)])
  );
}

function toolDefinitions(): unknown[] {
  return [
    {
      name: ASK_TOOL,
      description: "向思潼 AI 提交业务问题。思潼会在当前账号已购买、已授权的 Agent 和 Skill 范围内自动路由。",
      inputSchema: {
        type: "object",
        properties: {
          input: { type: "string", description: "用户的完整问题或任务" },
          skuCode: { type: "string", description: "货架模式必填：已上架 SKU 的 skuCode（如 ipzone__copy、meiye__copy），可通过 sitong.skills 查询" },
          conversationId: { type: "string", description: "上一轮返回文本末尾的 [conversationId: xxx]，续聊时原样传回" },
          history: { type: "array", description: "可选，多轮对话历史 [{role:user|assistant, content}]，用于货架模式续聊" },
          capabilityId: { type: "string", description: "可选，锁定当前 Agent 的某项能力" },
          skillId: { type: "string", description: "可选，锁定当前 Agent 已授权的 Skill" },
          requestId: { type: "string", description: "可选，调用方幂等请求号" }
        },
        required: ["input"]
      }
    },
    {
      name: LIST_SKILLS_TOOL,
      description: "查看当前 WorkBuddy 连接被授权使用的思潼 Agent 与 Skill 清单。",
      inputSchema: { type: "object", properties: {} }
    }
  ];
}

async function assertWorkbuddyConversation(
  connection: { tenantId: string; userId: string; agentId: string },
  conversationId: string
): Promise<void> {
  const run = await prisma.agentRun.findFirst({
    where: {
      tenantId: connection.tenantId,
      userId: connection.userId,
      agentId: connection.agentId,
      conversationId,
      conversation: { channel: "workbuddy" }
    },
    select: { id: true }
  });
  if (!run) throw new Error("workbuddy_conversation_not_found");
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function requiredText(value: unknown, field: string, maxLength: number): string {
  const text = optionalText(value, maxLength);
  if (!text) throw new Error(`mcp_argument_required:${field}`);
  return text;
}

function optionalText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const text = value.trim();
  if (text.length > maxLength) throw new Error("mcp_argument_too_long");
  return text;
}

function toolText(value: unknown): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

function rpcResult(id: JsonRpcId, result: unknown): object {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id: JsonRpcId, code: number, message: string): object {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function externalErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "workbuddy_mcp_failed";
  if (message.startsWith("beauty_workflow_output_")) return "beauty_output_contract_failed";
  if (message === "insufficient_credits" || message.startsWith("agent_") || message.startsWith("skill_")) return message;
  if (
    message.startsWith("mcp_argument_")
    || message.startsWith("mcp_identity_")
    || message.startsWith("beauty_")
    || message.startsWith("billing_request_")
    || message.startsWith("marketplace_")
    || message.startsWith("product_")
    || message.startsWith("workbuddy_")
    || message.startsWith("provider_failure:")
    || message === "request_id_conflict"
  ) return message;
  return "sitong_service_unavailable";
}

function internalDiagnosticCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "unknown_error";
  if (message.startsWith("beauty_workflow_output_")) {
    // Beauty output-contract failures are already reduced to bounded codes at
    // their source. Persist only that code for internal diagnosis; never the
    // Provider answer, prompt, tenant identity, or stack.
    return message.replace(/[^\p{L}\p{N}_:-]+/gu, "_").slice(0, 180);
  }
  return externalErrorMessage(error);
}

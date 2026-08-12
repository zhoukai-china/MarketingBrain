import { createHash, randomUUID } from "node:crypto";
import type { LlmProvider } from "@baolu/agent";
import { prisma } from "@baolu/db";
import type { FastifyInstance } from "fastify";
import { env } from "../config/env.js";
import { AgentClarificationRequired, getRuntimeAgent } from "../services/agent-runtime.js";
import { invokeSkillViaGateway } from "../services/mcp-client.js";
import { resolveDatabaseRequestContext } from "../services/request-context.js";
import { getWorkbuddyConnectionIssues, resolveWorkbuddyConnection } from "../services/workbuddy-connections.js";

type JsonRpcId = string | number | null;
type JsonRpcRequest = { jsonrpc?: string; id?: JsonRpcId; method?: string; params?: Record<string, unknown> };

const ASK_TOOL = "sitong.ask";
const LIST_SKILLS_TOOL = "sitong.skills";

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
      if (body.method === "initialize") {
        return rpcResult(id, {
          protocolVersion: "2024-11-05",
          serverInfo: { name: "sitong-workbuddy-mcp", version: "1.0.0" },
          capabilities: { tools: {} }
        });
      }
      if (body.method === "notifications/initialized") return reply.code(204).send();
      if (body.method === "ping") return rpcResult(id, {});
      if (body.method === "tools/list") return rpcResult(id, { tools: toolDefinitions() });
      if (body.method !== "tools/call") return reply.code(404).send(rpcError(id, -32601, `unknown_method:${body.method}`));

      const toolName = String(body.params?.name ?? "");
      const args = objectValue(body.params?.arguments);
      const context = await resolveDatabaseRequestContext(connection.tenantId, connection.userId);
      const agent = await getRuntimeAgent(connection.agentId);

      if (toolName === LIST_SKILLS_TOOL) {
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

      const input = requiredText(args.input, "input", 20_000);
      const conversationId = optionalText(args.conversationId, 200);
      if (conversationId) await assertWorkbuddyConversation(connection, conversationId);
      const externalRequestId = optionalText(args.requestId, 200) ?? randomUUID();
      const connectionScope = createHash("sha256").update(connection.token).digest("hex").slice(0, 16);
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
      request.log.error({ err: error, connection: connection.label }, "WorkBuddy MCP call failed");
      return reply.code(500).send(rpcError(id, -32000, externalErrorMessage(error)));
    }
  });
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
          conversationId: { type: "string", description: "上一轮返回的 conversationId，用于连续对话" },
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
  if (message === "insufficient_credits" || message.startsWith("agent_") || message.startsWith("skill_")) return message;
  if (message.startsWith("mcp_argument_") || message === "workbuddy_conversation_not_found") return message;
  return "sitong_service_unavailable";
}

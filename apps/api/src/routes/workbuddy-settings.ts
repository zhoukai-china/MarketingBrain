import { randomBytes } from "node:crypto";
import { prisma } from "@baolu/db";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { env } from "../config/env.js";
import { assertAgentAccess, getRuntimeAgent } from "../services/agent-runtime.js";
import { resolveRequestContext } from "../services/request-context.js";
import { hashWorkbuddyToken } from "../services/workbuddy-connections.js";

const createConnectionSchema = z.object({
  agentId: z.string().trim().min(1).max(120),
  label: z.string().trim().min(1).max(80).optional()
});

export async function registerWorkbuddySettingsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/integrations/workbuddy/connections", async (request) => {
    const context = await resolveRequestContext(request.headers);
    if (context.source !== "database") return { enabled: false, mcpUrl: env.WORKBUDDY_MCP_PUBLIC_URL, connections: [] };
    const connections = await prisma.workbuddyMcpConnection.findMany({
      where: { tenantId: context.tenantId, userId: context.userId },
      orderBy: { createdAt: "desc" },
      include: { agent: { select: { id: true, name: true, slug: true } } }
    });
    return {
      enabled: env.WORKBUDDY_MCP_ENABLED === "true",
      mcpUrl: env.WORKBUDDY_MCP_PUBLIC_URL,
      connections: connections.map(publicConnection)
    };
  });

  app.post("/integrations/workbuddy/connections", async (request, reply) => {
    const parsed = createConnectionSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    const context = await resolveRequestContext(request.headers);
    if (context.source !== "database") return reply.code(409).send({ error: "database_mode_required" });
    const agent = await getRuntimeAgent(parsed.data.agentId);
    await assertAgentAccess(context, agent);
    const activeCount = await prisma.workbuddyMcpConnection.count({
      where: { tenantId: context.tenantId, userId: context.userId, status: "active" }
    });
    if (activeCount >= 10) return reply.code(409).send({ error: "workbuddy_connection_limit_reached" });

    const token = `sitong_wb_${randomBytes(32).toString("base64url")}`;
    const connection = await prisma.workbuddyMcpConnection.create({
      data: {
        tenantId: context.tenantId,
        userId: context.userId,
        agentId: agent.id,
        label: parsed.data.label ?? `WorkBuddy · ${agent.name}`,
        tokenHash: hashWorkbuddyToken(token),
        tokenPrefix: token.slice(0, 18)
      },
      include: { agent: { select: { id: true, name: true, slug: true } } }
    });
    return reply.code(201).send({
      enabled: env.WORKBUDDY_MCP_ENABLED === "true",
      mcpUrl: env.WORKBUDDY_MCP_PUBLIC_URL,
      token,
      connection: publicConnection(connection),
      warning: "该密钥只显示一次，请立即复制到 WorkBuddy。"
    });
  });

  app.delete<{ Params: { connectionId: string } }>("/integrations/workbuddy/connections/:connectionId", async (request, reply) => {
    const context = await resolveRequestContext(request.headers);
    if (context.source !== "database") return reply.code(409).send({ error: "database_mode_required" });
    const connection = await prisma.workbuddyMcpConnection.findFirst({
      where: {
        id: request.params.connectionId,
        tenantId: context.tenantId,
        userId: context.userId
      },
      select: { id: true }
    });
    if (!connection) return reply.code(404).send({ error: "workbuddy_connection_not_found" });
    await prisma.workbuddyMcpConnection.update({
      where: { id: connection.id },
      data: { status: "revoked" }
    });
    return { ok: true };
  });
}

function publicConnection(connection: {
  id: string;
  label: string;
  tokenPrefix: string;
  status: string;
  lastUsedAt: Date | null;
  createdAt: Date;
  agent: { id: string; name: string; slug: string };
}): object {
  return {
    id: connection.id,
    label: connection.label,
    tokenPrefix: `${connection.tokenPrefix}…`,
    status: connection.status,
    lastUsedAt: connection.lastUsedAt,
    createdAt: connection.createdAt,
    agent: connection.agent
  };
}

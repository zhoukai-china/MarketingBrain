import { randomBytes } from "node:crypto";
import { prisma } from "@baolu/db";
import { PRODUCT_LOGIN_DEFINITIONS } from "@baolu/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { env } from "../config/env.js";
import { BEAUTY_INDUSTRY_PRODUCT_CODE, BEAUTY_INDUSTRY_SCOPES } from "../products/beauty-industry/mcp-adapter.js";
import { assertAgentAccess, getRuntimeAgent } from "../services/agent-runtime.js";
import { resolveRequestContext } from "../services/request-context.js";
import { hashWorkbuddyToken, normalizeWorkbuddyScopes } from "../services/workbuddy-connections.js";

const createConnectionSchema = z.union([
  z.object({
    productCode: z.literal(BEAUTY_INDUSTRY_PRODUCT_CODE),
    label: z.string().trim().min(1).max(80).optional(),
    scopes: z.array(z.enum(BEAUTY_INDUSTRY_SCOPES)).min(1).max(BEAUTY_INDUSTRY_SCOPES.length).optional(),
    expiresInDays: z.number().int().min(1).max(365).optional()
  }).strict(),
  z.object({
    agentId: z.string().trim().min(1).max(120),
    label: z.string().trim().min(1).max(80).optional()
  }).strict()
]);

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
    const productCode = "productCode" in parsed.data ? parsed.data.productCode : undefined;
    const agentId = "productCode" in parsed.data
      ? PRODUCT_LOGIN_DEFINITIONS[parsed.data.productCode].agentIds[0]
      : parsed.data.agentId;
    if (!agentId) return reply.code(409).send({ error: "workbuddy_product_agent_missing" });
    if (productCode) {
      const entitlement = await prisma.tenantProductEntitlement.findFirst({
        where: {
          tenantId: context.tenantId,
          productCode,
          status: "active",
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }]
        },
        select: { id: true }
      });
      if (!entitlement) return reply.code(403).send({ error: "product_entitlement_required" });
    }
    const agent = await getRuntimeAgent(agentId);
    await assertAgentAccess(context, agent);
    const activeCount = await prisma.workbuddyMcpConnection.count({
      where: { tenantId: context.tenantId, userId: context.userId, status: "active" }
    });
    if (activeCount >= 10) return reply.code(409).send({ error: "workbuddy_connection_limit_reached" });

    const token = createWorkbuddyToken();
    const scopes = productCode
      ? ("scopes" in parsed.data && parsed.data.scopes ? parsed.data.scopes : [...BEAUTY_INDUSTRY_SCOPES])
      : undefined;
    const expiresAt = productCode
      ? new Date(Date.now() + (("expiresInDays" in parsed.data && parsed.data.expiresInDays) || 90) * 86_400_000)
      : undefined;
    const connection = await prisma.$transaction(async (tx) => {
      const created = await tx.workbuddyMcpConnection.create({
        data: {
          tenantId: context.tenantId,
          userId: context.userId,
          agentId: agent.id,
          label: parsed.data.label ?? `WorkBuddy · ${agent.name}`,
          tokenHash: hashWorkbuddyToken(token),
          tokenPrefix: token.slice(0, 18),
          productCode,
          operatingEntityId: productCode ? context.tenantId : undefined,
          scopes,
          expiresAt,
          rateLimitPerMinute: 30
        },
        include: { agent: { select: { id: true, name: true, slug: true } } }
      });
      await tx.auditLog.create({
        data: {
          tenantId: context.tenantId,
          userId: context.userId,
          action: "workbuddy_mcp_connection.created",
          resource: "workbuddy_mcp_connection",
          resourceId: created.id,
          detail: JSON.stringify({ productCode: productCode ?? null, scopes: scopes ?? [] })
        }
      });
      return created;
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
    await prisma.$transaction(async (tx) => {
      await tx.workbuddyMcpConnection.update({
        where: { id: connection.id },
        data: { status: "revoked", revokedAt: new Date() }
      });
      await tx.auditLog.create({
        data: {
          tenantId: context.tenantId,
          userId: context.userId,
          action: "workbuddy_mcp_connection.revoked",
          resource: "workbuddy_mcp_connection",
          resourceId: connection.id
        }
      });
    });
    return { ok: true };
  });

  app.post<{ Params: { connectionId: string } }>("/integrations/workbuddy/connections/:connectionId/rotate", async (request, reply) => {
    const context = await resolveRequestContext(request.headers);
    if (context.source !== "database") return reply.code(409).send({ error: "database_mode_required" });
    const current = await prisma.workbuddyMcpConnection.findFirst({
      where: {
        id: request.params.connectionId,
        tenantId: context.tenantId,
        userId: context.userId,
        status: "active",
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }]
      },
      include: { agent: { select: { id: true, name: true, slug: true } } }
    });
    if (!current) return reply.code(404).send({ error: "workbuddy_connection_not_found" });
    const currentAgent = await getRuntimeAgent(current.agentId);
    await assertAgentAccess(context, currentAgent);
    let rotationScopes = current.scopes ?? undefined;
    if (current.productCode) {
      const entitlement = await prisma.tenantProductEntitlement.findFirst({
        where: {
          tenantId: context.tenantId,
          productCode: current.productCode,
          status: "active",
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }]
        },
        select: { id: true }
      });
      if (!entitlement) return reply.code(403).send({ error: "product_entitlement_required" });
      if (current.operatingEntityId !== context.tenantId) {
        return reply.code(403).send({ error: "workbuddy_operating_entity_mismatch" });
      }
      if (current.productCode === BEAUTY_INDUSTRY_PRODUCT_CODE) {
        const scopes = activeBeautyScopes(current.scopes);
        if (scopes.length === 0) {
          return reply.code(409).send({ error: "workbuddy_scope_invalid" });
        }
        rotationScopes = scopes;
      }
    }

    const token = createWorkbuddyToken();
    const rotated = await prisma.$transaction(async (tx) => {
      const claimed = await tx.workbuddyMcpConnection.updateMany({
        where: { id: current.id, status: "active", revokedAt: null },
        data: { status: "revoked", revokedAt: new Date() }
      });
      if (claimed.count !== 1) throw new Error("workbuddy_connection_rotation_conflict");
      const created = await tx.workbuddyMcpConnection.create({
        data: {
          tenantId: current.tenantId,
          userId: current.userId,
          agentId: current.agentId,
          label: current.label,
          tokenHash: hashWorkbuddyToken(token),
          tokenPrefix: token.slice(0, 18),
          productCode: current.productCode,
          operatingEntityId: current.operatingEntityId,
          scopes: rotationScopes,
          expiresAt: current.expiresAt,
          rotatedFromId: current.id,
          rateLimitPerMinute: current.rateLimitPerMinute
        },
        include: { agent: { select: { id: true, name: true, slug: true } } }
      });
      await tx.auditLog.create({
        data: {
          tenantId: context.tenantId,
          userId: context.userId,
          action: "workbuddy_mcp_connection.rotated",
          resource: "workbuddy_mcp_connection",
          resourceId: created.id,
          detail: JSON.stringify({ rotatedFromId: current.id, productCode: current.productCode ?? null })
        }
      });
      return created;
    });
    return reply.code(201).send({
      enabled: env.WORKBUDDY_MCP_ENABLED === "true",
      mcpUrl: env.WORKBUDDY_MCP_PUBLIC_URL,
      token,
      connection: publicConnection(rotated),
      warning: "新密钥只显示一次；旧密钥已立即撤销。"
    });
  });
}

function publicConnection(connection: {
  id: string;
  label: string;
  tokenPrefix: string;
  status: string;
  lastUsedAt: Date | null;
  createdAt: Date;
  productCode: string | null;
  operatingEntityId: string | null;
  scopes: unknown;
  expiresAt: Date | null;
  revokedAt: Date | null;
  rotatedFromId: string | null;
  rateLimitPerMinute: number;
  agent: { id: string; name: string; slug: string };
}): object {
  return {
    id: connection.id,
    label: connection.label,
    tokenPrefix: `${connection.tokenPrefix}…`,
    status: connection.status,
    lastUsedAt: connection.lastUsedAt,
    createdAt: connection.createdAt,
    productCode: connection.productCode,
    operatingEntityId: connection.operatingEntityId,
    scopes: connection.productCode === BEAUTY_INDUSTRY_PRODUCT_CODE
      ? activeBeautyScopes(connection.scopes)
      : connection.scopes ?? [],
    expiresAt: connection.expiresAt,
    revokedAt: connection.revokedAt,
    rotatedFromId: connection.rotatedFromId,
    rateLimitPerMinute: connection.rateLimitPerMinute,
    agent: connection.agent
  };
}

function activeBeautyScopes(value: unknown): string[] {
  const allowedScopes = new Set<string>(BEAUTY_INDUSTRY_SCOPES);
  return normalizeWorkbuddyScopes(value).filter((scope) => allowedScopes.has(scope));
}

function createWorkbuddyToken(): string {
  return `sitong_wb_${randomBytes(32).toString("base64url")}`;
}

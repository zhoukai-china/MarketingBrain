import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@baolu/db";
import { resolveRequestContext } from "../services/request-context.js";
import {
  createBillingAccessToken,
  hashBillingAccessToken,
  maskBillingAccessToken
} from "../services/billing-access-tokens.js";

const createAccessTokenSchema = z.object({
  label: z.string().trim().min(1).max(80).optional(),
  expiresInDays: z.number().int().min(1).max(365).optional()
});

const ACTIVE_TOKEN_LIMIT = 20;

export async function registerBillingAccessTokenRoutes(app: FastifyInstance): Promise<void> {
  app.get("/billing/access-tokens", async (request) => {
    const context = await resolveRequestContext(request.headers);
    if (context.source !== "database") {
      return { dataMode: "demo", tokens: [] };
    }

    const tokens = await prisma.billingAccessToken.findMany({
      where: { tenantId: context.tenantId, userId: context.userId },
      orderBy: { createdAt: "desc" }
    });

    return {
      dataMode: "database",
      tokens: tokens.map(publicBillingAccessToken)
    };
  });

  app.post("/billing/access-tokens", async (request, reply) => {
    const parsed = createAccessTokenSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    }

    const context = await resolveRequestContext(request.headers);
    if (context.source !== "database") {
      return reply.code(409).send({ error: "database_mode_required" });
    }

    const activeCount = await prisma.billingAccessToken.count({
      where: { tenantId: context.tenantId, userId: context.userId, status: "active", revokedAt: null }
    });
    if (activeCount >= ACTIVE_TOKEN_LIMIT) {
      return reply.code(409).send({ error: "billing_access_token_limit_reached" });
    }

    const rawToken = createBillingAccessToken();
    const expiresAt = parsed.data.expiresInDays
      ? new Date(Date.now() + parsed.data.expiresInDays * 86_400_000)
      : null;

    const created = await prisma.$transaction(async (tx) => {
      const token = await tx.billingAccessToken.create({
        data: {
          tenantId: context.tenantId,
          userId: context.userId,
          label: parsed.data.label ?? null,
          tokenHash: hashBillingAccessToken(rawToken),
          tokenPrefix: rawToken.slice(0, 18),
          expiresAt
        }
      });
      await tx.auditLog.create({
        data: {
          tenantId: context.tenantId,
          userId: context.userId,
          action: "billing_access_token.created",
          resource: "billing_access_token",
          resourceId: token.id,
          detail: JSON.stringify({ expiresInDays: parsed.data.expiresInDays ?? null })
        }
      });
      return token;
    });

    return reply.code(201).send({
      dataMode: "database",
      token: rawToken,
      accessToken: publicBillingAccessToken(created),
      warning: "该访问令牌只显示一次，请立即复制保存。"
    });
  });

  app.post<{ Params: { tokenId: string } }>("/billing/access-tokens/:tokenId/rotate", async (request, reply) => {
    const context = await resolveRequestContext(request.headers);
    if (context.source !== "database") {
      return reply.code(409).send({ error: "database_mode_required" });
    }

    const current = await prisma.billingAccessToken.findFirst({
      where: {
        id: request.params.tokenId,
        tenantId: context.tenantId,
        userId: context.userId,
        status: "active",
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }]
      }
    });
    if (!current) {
      return reply.code(404).send({ error: "billing_access_token_not_found" });
    }

    const rawToken = createBillingAccessToken();
    const rotated = await prisma.$transaction(async (tx) => {
      const claimed = await tx.billingAccessToken.updateMany({
        where: { id: current.id, status: "active", revokedAt: null },
        data: { status: "revoked", revokedAt: new Date() }
      });
      if (claimed.count !== 1) throw new Error("billing_access_token_rotation_conflict");

      const created = await tx.billingAccessToken.create({
        data: {
          tenantId: current.tenantId,
          userId: current.userId,
          label: current.label,
          tokenHash: hashBillingAccessToken(rawToken),
          tokenPrefix: rawToken.slice(0, 18),
          expiresAt: current.expiresAt,
          rotatedFromId: current.id
        }
      });
      await tx.auditLog.create({
        data: {
          tenantId: context.tenantId,
          userId: context.userId,
          action: "billing_access_token.rotated",
          resource: "billing_access_token",
          resourceId: created.id,
          detail: JSON.stringify({ rotatedFromId: current.id })
        }
      });
      return created;
    });

    return reply.code(201).send({
      dataMode: "database",
      token: rawToken,
      accessToken: publicBillingAccessToken(rotated),
      warning: "新访问令牌只显示一次；旧令牌已立即失效。"
    });
  });

  app.delete<{ Params: { tokenId: string } }>("/billing/access-tokens/:tokenId", async (request, reply) => {
    const context = await resolveRequestContext(request.headers);
    if (context.source !== "database") {
      return reply.code(409).send({ error: "database_mode_required" });
    }

    const token = await prisma.billingAccessToken.findFirst({
      where: {
        id: request.params.tokenId,
        tenantId: context.tenantId,
        userId: context.userId
      },
      select: { id: true }
    });
    if (!token) {
      return reply.code(404).send({ error: "billing_access_token_not_found" });
    }

    await prisma.$transaction(async (tx) => {
      await tx.billingAccessToken.update({
        where: { id: token.id },
        data: { status: "revoked", revokedAt: new Date() }
      });
      await tx.auditLog.create({
        data: {
          tenantId: context.tenantId,
          userId: context.userId,
          action: "billing_access_token.revoked",
          resource: "billing_access_token",
          resourceId: token.id
        }
      });
    });

    return { ok: true };
  });
}

function publicBillingAccessToken(token: {
  id: string;
  label: string | null;
  tokenPrefix: string;
  status: string;
  expiresAt: Date | null;
  revokedAt: Date | null;
  rotatedFromId: string | null;
  lastUsedAt: Date | null;
  createdAt: Date;
}): object {
  return {
    id: token.id,
    label: token.label,
    tokenPrefix: maskBillingAccessToken(token.tokenPrefix),
    status: token.status,
    expiresAt: token.expiresAt,
    revokedAt: token.revokedAt,
    rotatedFromId: token.rotatedFromId,
    lastUsedAt: token.lastUsedAt,
    createdAt: token.createdAt
  };
}

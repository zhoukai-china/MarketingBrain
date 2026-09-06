import type { FastifyReply, FastifyRequest } from "fastify";
import { env } from "../config/env.js";
import { prisma } from "@baolu/db";
import { resolveRequestContext } from "./request-context.js";
import type { ProductLoginCode } from "@baolu/shared";

export async function requireAdminToken(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  if (!env.ADMIN_TOKEN && env.NODE_ENV !== "production") return;

  const token = getHeaderValue(request.headers["x-sitong-admin-token"]);
  if (!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN) {
    await reply.code(401).send({
      error: "admin_token_required",
      message: "Admin token is required"
    });
  }
}

export async function requireOpsToken(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  if (!env.OPS_TOKEN && env.NODE_ENV !== "production") return;

  const token = getHeaderValue(request.headers["x-sitong-ops-token"]);
  if (!env.OPS_TOKEN || token !== env.OPS_TOKEN) {
    await reply.code(401).send({
      error: "ops_token_required",
      message: "Ops token is required"
    });
  }
}

export function requireProductEntitlement(productCode: ProductLoginCode) {
  return async function productEntitlementGuard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const context = await resolveRequestContext(request.headers);
    if (context.source === "demo") return;
    const entitlement = await prisma.tenantProductEntitlement.findFirst({
      where: {
        tenantId: context.tenantId,
        productCode,
        status: "active",
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      select: { id: true },
    });
    if (!entitlement) {
      await reply.code(403).send({
        error: "product_entitlement_required",
        message: "当前企业尚未开通此产品，请联系服务团队。",
      });
    }
  };
}

function getHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

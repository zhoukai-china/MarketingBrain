import type { FastifyReply, FastifyRequest } from "fastify";
import { env } from "../config/env.js";
import { prisma } from "@baolu/db";
import { resolveRequestContext } from "./request-context.js";
import { verifyAdminSessionToken } from "./admin-session.js";
import type { ProductLoginCode } from "@baolu/shared";

export async function requireAdminToken(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  if (!env.ADMIN_TOKEN && env.NODE_ENV !== "production") return;

  const token = getHeaderValue(request.headers["x-sitong-admin-token"]);
  // 两条通道都算数：① 平台管理后台的账号密码会话令牌（PLAT-39，老板日常用）；
  // ② 旧的共享 `ADMIN_TOKEN`（脚本 / 运维 / 兼容）。两者都失败才拒。
  const hasAdminSession = Boolean(verifyAdminSessionToken(token));
  const hasLegacyToken = Boolean(env.ADMIN_TOKEN) && token === env.ADMIN_TOKEN;
  if (!hasAdminSession && !hasLegacyToken) {
    await reply.code(401).send({
      error: "admin_token_required",
      message: "请先用管理员账号登录后台（或提供平台管理令牌）。"
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
      select: { id: true, expiresAt: true },
    });
    if (!entitlement) {
      // Bug7（WorkBuddy 2026-09-10）：「未开通」和「已过期」是两件事，文案必须分开，
      // 否则老板看到「请联系服务团队」却不知道是自己没开通还是刚过期。
      const expired = await prisma.tenantProductEntitlement.findFirst({
        where: { tenantId: context.tenantId, productCode },
        orderBy: { expiresAt: "desc" },
        select: { status: true, expiresAt: true },
      });
      const reason = expired
        ? expired.status !== "active"
          ? "product_entitlement_inactive"
          : expired.expiresAt && expired.expiresAt <= new Date()
            ? "product_entitlement_expired"
            : "product_entitlement_required"
        : "product_entitlement_missing";
      await reply.code(403).send({
        // 保留原有 error 字段，避免既有调用方（WorkBuddy MCP、后台）解析失败；
        // 新增 code 字段承载具体原因，前端按 code 分流文案。
        error: "product_entitlement_required",
        code: reason,
        message:
          reason === "product_entitlement_expired"
            ? "本产品的使用期限已到期，续期后即可继续使用。"
            : reason === "product_entitlement_inactive"
              ? "本产品当前处于停用状态，请联系服务团队重新启用。"
              : "当前企业尚未开通此产品，请联系服务团队开通。",
        trace_id: request.id,
      });
    }
  };
}

function getHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

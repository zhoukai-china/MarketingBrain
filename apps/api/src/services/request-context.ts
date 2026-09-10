import { prisma } from "@baolu/db";
import type { PlanCode, UserRole, TenantType } from "@baolu/shared";
import { env } from "../config/env.js";
import { timingSafeEqual } from "node:crypto";
import { getBearerToken, verifySessionToken } from "./auth-token.js";
import { getDemoContext, type DemoAuthContext } from "./demo-context.js";

export type RequestContext = DemoAuthContext & {
  source: "demo" | "database";
  subscriptionId?: string;
};

export async function resolveRequestContext(headers: Record<string, unknown>): Promise<RequestContext> {
  if (env.DATA_MODE === "demo") {
    const token = getBearerToken(headers);
    const tokenPayload = token ? verifySessionToken(token) : null;
    const hasExplicitDemoIdentity = Boolean(
      tokenPayload
      || readHeader(headers, "x-sitong-tenant-id")
      || readHeader(headers, "x-sitong-user-id")
    );
    if (!hasExplicitDemoIdentity) throw new Error("missing_tenant_or_user");
    const demoHeaders = tokenPayload?.planCode
      ? { ...headers, "x-sitong-plan": tokenPayload.planCode }
      : headers;
    return { ...getDemoContext(demoHeaders), source: "demo" };
  }

  const tenantId = String(readHeader(headers, "x-sitong-tenant-id") ?? "");
  const userId = String(readHeader(headers, "x-sitong-user-id") ?? "");
  const token = getBearerToken(headers);
  const tokenPayload = token ? verifySessionToken(token) : null;
  // P0（QA-20260911-002）：database 模式下身份只能来自服务端验签的会话令牌。
  // 修复前 `x-sitong-tenant-id` / `x-sitong-user-id` 裸头会被当成身份，且无效 Bearer
  // 会被忽略后回落到裸头，导致任何人只要猜到两个内部 ID 就能无凭证读走租户数据。
  // 唯一的例外是持有 `OPS_TOKEN` 的内部运维通道（见 hasValidOpsCredential）：
  // 它用带外共享密钥证明调用方身份，仍然只用于本机/内网运维脚本，不是公共接口。
  const opsCredential = hasValidOpsCredential(headers);
  const resolvedTenantId = tokenPayload?.tenantId ?? (opsCredential ? tenantId : "");
  const resolvedUserId = tokenPayload?.userId ?? (opsCredential ? userId : "");

  if (!resolvedTenantId || !resolvedUserId) {
    throw new Error("missing_tenant_or_user");
  }

  return resolveDatabaseRequestContext(resolvedTenantId, resolvedUserId);
}

/**
 * 内部运维通道：仅当环境里配置了非空 `OPS_TOKEN`，且请求头 `x-sitong-ops-token`
 * 与之常量时间相等时成立。未配置 `OPS_TOKEN` 时通道整体关闭（fail closed），
 * 不走 `requireOpsToken` 那种「开发环境无令牌即放行」的宽松分支。
 */
function hasValidOpsCredential(headers: Record<string, unknown>): boolean {
  const expected = env.OPS_TOKEN;
  if (!expected) return false;
  const raw = readHeader(headers, "x-sitong-ops-token");
  const provided = Array.isArray(raw) ? raw[0] : raw;
  if (typeof provided !== "string" || !provided) return false;
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  if (expectedBuffer.length !== providedBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, providedBuffer);
}

export async function resolveDatabaseRequestContext(tenantId: string, userId: string): Promise<RequestContext> {
  const membership = await prisma.membership.findFirst({
    where: {
      tenantId,
      userId,
      isActive: true
    },
    include: {
      user: true,
      tenant: {
        include: {
          profile: true,
          creditAccount: true,
          subscriptions: {
            where: {
              status: {
                in: ["trialing", "active"]
              }
            },
            orderBy: {
              endDate: "desc"
            },
            take: 1
          }
        }
      }
    }
  });

  if (!membership) {
    throw new Error("membership_not_found");
  }

  // Agent products are entitled independently from the legacy subscription.
  // Keep a compatible plan code for the existing Skill policy layer, but never
  // block a paid Agent customer just because they do not have an old plan.
  const subscription = membership.tenant.subscriptions[0];
  const planCode = subscription?.planCode as PlanCode | undefined;

  return {
    tenantId: membership.tenantId,
    userId: membership.userId,
    role: membership.role as UserRole,
    planCode: planCode ?? defaultPlanForTenantType(membership.tenant.type as TenantType),
    source: "database",
    subscriptionId: subscription?.id,
    creditBalance: membership.tenant.creditAccount?.balance ?? 0,
    profile: {
      tenantId: membership.tenant.id,
      tenantName: membership.tenant.name,
      tenantType: membership.tenant.type as TenantType,
      industry: membership.tenant.industry ?? undefined,
      city: membership.tenant.city ?? undefined,
      data: normalizeProfileData(
        membership.tenant.profile?.confirmedData ?? membership.tenant.profile?.data
      )
    }
  };
}

export async function resolveWechatRequestContext(openid: string): Promise<RequestContext> {
  if (env.DATA_MODE !== "database") throw new Error("wechat_channel_requires_database");
  const user = await prisma.user.findUnique({
    where: { wechatOpenid: openid },
    select: {
      id: true,
      memberships: {
        where: { isActive: true },
        orderBy: { updatedAt: "desc" },
        take: 1,
        select: { tenantId: true }
      }
    }
  });
  const membership = user?.memberships[0];
  if (!user || !membership) throw new Error("wechat_account_not_bound");
  return resolveDatabaseRequestContext(membership.tenantId, user.id);
}

export async function resolveWechatUnionidRequestContext(unionid: string): Promise<RequestContext> {
  if (env.DATA_MODE !== "database") throw new Error("wechat_channel_requires_database");
  const user = await prisma.user.findFirst({
    where: { wechatUnionid: unionid },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      memberships: {
        where: { isActive: true },
        orderBy: { updatedAt: "desc" },
        take: 1,
        select: { tenantId: true }
      }
    }
  });
  const membership = user?.memberships[0];
  if (!user || !membership) throw new Error("wechat_account_not_bound");
  return resolveDatabaseRequestContext(membership.tenantId, user.id);
}

function defaultPlanForTenantType(tenantType: TenantType): PlanCode {
  if (tenantType === "chain_brand") return "chain_standard";
  if (tenantType === "personal_ip") return "ip_standard";
  return "local_standard";
}

function normalizeProfileData(value: unknown): Record<string, unknown> | undefined {
  if (!value) return undefined;
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string") return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function readHeader(headers: Record<string, unknown>, name: string): unknown {
  return headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()];
}

import { prisma } from "@baolu/db";
import type { PlanCode, UserRole, TenantType } from "@baolu/shared";
import { env } from "../config/env.js";
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
  const resolvedTenantId = tokenPayload?.tenantId ?? tenantId;
  const resolvedUserId = tokenPayload?.userId ?? userId;

  if (!resolvedTenantId || !resolvedUserId) {
    throw new Error("missing_tenant_or_user");
  }

  return resolveDatabaseRequestContext(resolvedTenantId, resolvedUserId);
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

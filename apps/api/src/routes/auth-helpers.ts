import { PRODUCT_LOGIN_DEFINITIONS, type ProductLoginCode } from "@baolu/shared";

export function maskPhone(phone: string): string {
  if (phone.length <= 7) return phone;
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
}

export function translateInviteError(error: string | undefined): string {
  if (error === "invite_code_expired") return "邀请码已过期，请联系服务团队重新发放";
  if (error === "invite_code_exhausted") return "邀请码使用次数已用完，请联系服务团队";
  if (error === "invite_code_product_mismatch") return "该邀请码不属于当前产品，请使用邀请消息中的正确入口";
  return "当前体验名额需要邀请码，请填写有效邀请码";
}

export async function grantBetaAgentEntitlements(
  transactionClient: any,
  tenantId: string,
  productCode?: ProductLoginCode,
): Promise<void> {
  const now = new Date();
  const expiresAt = new Date(now);
  expiresAt.setDate(expiresAt.getDate() + 30);
  if (productCode) {
    await transactionClient.tenantProductEntitlement.upsert({
      where: { tenantId_productCode: { tenantId, productCode } },
      update: { status: "active", startsAt: now, expiresAt, source: "product_invite" },
      create: { tenantId, productCode, status: "active", startsAt: now, expiresAt, source: "product_invite" },
    });
  }
  const agentIds = productCode
    ? PRODUCT_LOGIN_DEFINITIONS[productCode].agentIds
    : ["agent_acquisition", "agent_takeaway_growth", "agent_restaurant_growth"];
  for (const agentId of agentIds) {
    await transactionClient.tenantAgentEntitlement.upsert({
      where: {
        tenantId_agentId: {
          tenantId,
          agentId
        }
      },
      update: {
        status: "active",
        startsAt: now,
        expiresAt,
        source: "beta_invite"
      },
      create: {
        tenantId,
        agentId,
        status: "active",
        startsAt: now,
        expiresAt,
        source: "beta_invite"
      }
    });
  }
}

export async function restrictWorkspaceToProductAgents(
  transactionClient: any,
  tenantId: string,
  userId: string,
  productCode?: ProductLoginCode,
): Promise<void> {
  if (!productCode) return;
  const allowedAgentIds = [...PRODUCT_LOGIN_DEFINITIONS[productCode].agentIds];
  const memberships = await transactionClient.membership.findMany({
    where: { tenantId, userId },
    select: { id: true },
  });
  await transactionClient.memberAgentAccess.deleteMany({
    where: {
      membershipId: { in: memberships.map((membership: { id: string }) => membership.id) },
      ...(allowedAgentIds.length > 0 ? { agentId: { notIn: allowedAgentIds } } : {}),
    },
  });
  await transactionClient.tenantAgentEntitlement.deleteMany({
    where: {
      tenantId,
      ...(allowedAgentIds.length > 0 ? { agentId: { notIn: allowedAgentIds } } : {}),
    },
  });
}

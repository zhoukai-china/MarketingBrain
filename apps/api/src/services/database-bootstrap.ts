import { prisma } from "@baolu/db";
import { PLANS, type PlanCode, type TenantType } from "@baolu/shared";
import { env } from "../config/env.js";
import { AGENT_DEFINITIONS } from "./agent-definitions.js";

export async function createTenantWorkspace(params: {
  planCode: PlanCode;
  tenantName: string;
  userId?: string;
  industry?: string;
  city?: string;
  phone?: string;
  nickname?: string;
}, transactionClient?: any) {
  const plan = PLANS[params.planCode as PlanCode];
  const initialCredits = getInitialWorkspaceCredits(plan.tenantType);

  const createWorkspace = async (tx: any) => {
    const tenant = await tx.tenant.create({
      data: {
        name: params.tenantName,
        type: plan.tenantType as TenantType,
        industry: params.industry,
        city: params.city
      }
    });

    const user = params.userId
      ? await tx.user.update({
          where: {
            id: params.userId
          },
          data: {
            phone: params.phone,
            nickname: params.nickname
          }
        })
      : params.phone
        ? ((await tx.user.findFirst({ where: { phone: params.phone } })) ??
          (await tx.user.create({
            data: {
              phone: params.phone,
              nickname: params.nickname ?? `${params.tenantName}负责人`
            }
          })))
        : await tx.user.create({
            data: {
              nickname: params.nickname ?? `${params.tenantName}负责人`
            }
          });

    const store = await tx.store.create({
      data: {
        tenantId: tenant.id,
        name: getDefaultStoreName(plan.tenantType),
        city: params.city
      }
    });

    const membership = await tx.membership.create({
      data: {
        tenantId: tenant.id,
        userId: user.id,
        storeId: store.id,
        role: "owner"
      }
    });

    await tx.tenantProfile.create({
      data: {
        tenantId: tenant.id,
        data: {
          onboarding: true,
          primaryGoal: getDefaultPrimaryGoal(plan.tenantType),
          channels: ["微信", "抖音", "小红书"]
        }
      }
    });

    // Onboarding selects a tenant profile, not a paid subscription. Every
    // active Agent is available; only actual execution consumes credits.
    for (const agent of AGENT_DEFINITIONS.filter((item) => item.status === "active")) {
      await tx.tenantAgentEntitlement.create({
        data: {
          tenantId: tenant.id,
          agentId: agent.id,
          status: "active",
          source: "credits_only"
        }
      });
      await tx.memberAgentAccess.create({
        data: { membershipId: membership.id, agentId: agent.id }
      });
    }

    const creditAccount = await tx.creditAccount.create({
      data: {
        tenantId: tenant.id,
        balance: initialCredits
      }
    });

    await tx.creditTransaction.create({
      data: {
        creditAccountId: creditAccount.id,
        tenantId: tenant.id,
        userId: user.id,
        direction: "grant",
        amount: initialCredits,
        reason: "welcome_credits"
      }
    });

    return {
      tenant,
      user,
      plan,
      creditBalance: creditAccount.balance
    };
  };

  if (transactionClient) {
    return createWorkspace(transactionClient);
  }
  return prisma.$transaction(createWorkspace);
}

function getInitialWorkspaceCredits(tenantType: TenantType): number {
  if (tenantType === "chain_brand" && env.NEW_USER_CHAIN_TRIAL_CREDITS !== undefined) {
    return env.NEW_USER_CHAIN_TRIAL_CREDITS;
  }
  if (tenantType === "personal_ip" && env.NEW_USER_IP_TRIAL_CREDITS !== undefined) {
    return env.NEW_USER_IP_TRIAL_CREDITS;
  }
  if (tenantType === "local_business" && env.NEW_USER_LOCAL_TRIAL_CREDITS !== undefined) {
    return env.NEW_USER_LOCAL_TRIAL_CREDITS;
  }
  return 300;
}

function getDefaultStoreName(tenantType: TenantType): string {
  if (tenantType === "chain_brand") return "总部";
  if (tenantType === "personal_ip") return "OPC工作室";
  return "默认门店";
}

function getDefaultPrimaryGoal(tenantType: TenantType): string {
  if (tenantType === "chain_brand") return "连锁品牌增长";
  if (tenantType === "personal_ip") return "OPC内容增长与私域成交";
  return "本地获客成交";
}

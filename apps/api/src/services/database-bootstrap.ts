import { prisma } from "@baolu/db";
import { PLANS, type PlanCode, type TenantType } from "@baolu/shared";
import { env } from "../config/env.js";
import { AGENT_DEFINITIONS } from "./agent-definitions.js";
import { grantSignupWalletCreditsInTx } from "./sitong-wallet.js";

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

    // 口径（2026-09-10 产品拍板）：**新用户不赠送任何欢迎积分**。默认初始额度为 0，
    // 因此这里不写 `welcome_credits` 流水，避免账本里出现 0 元噪声记录。
    // 测试/内测环境如需体验额度，用 `NEW_USER_*_TRIAL_CREDITS` 显式打开（见 getInitialWorkspaceCredits）。
    if (initialCredits > 0) {
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
    }

    // 平台唯一入口是货架 `/market`，而货架的展示（`/market/me`、访问态）与扣费
    // （`/market/skus/:skuId/run`、`/market/ppu/consume`）都读**用户级双桶钱包**。
    // 欢迎积分如果只发租户级 `CreditAccount`，新用户登录后货架就是「💎 0 积分」，
    // 点任何智能体都会被 402 `insufficient_credits` 拦住（QA-20260910-016）。
    // 因此按同一额度补发到用户钱包 bonus 桶：幂等（同一用户只发一次）、与工作区
    // 创建同事务、失败即整体回滚，不会出现「建了工作区没发币」的半成品态。
    const walletGrant = await grantSignupWalletCreditsInTx(tx, {
      userId: user.id,
      amount: initialCredits
    });

    return {
      tenant,
      user,
      plan,
      creditBalance: creditAccount.balance,
      walletBalance: walletGrant.balance,
      walletWelcomeGranted: walletGrant.granted
    };
  };

  if (transactionClient) {
    return createWorkspace(transactionClient);
  }
  return prisma.$transaction(createWorkspace);
}

/**
 * 新工作区的初始积分额度。
 *
 * 产品口径（2026-09-10）：**默认 0，新用户不赠送任何欢迎积分**，需要用量就先充值。
 * `NEW_USER_*_TRIAL_CREDITS` 是给隔离测试/内测环境准备体验额度的显式开关，
 * 生产环境不配置这些变量，因此生产注册出来的账号余额就是 0。
 */
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
  return 0;
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

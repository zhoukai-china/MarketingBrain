import { Prisma, prisma } from "@baolu/db";
import { getReferralConfig, isWithinReferralCampaignWindow, type ReferralConfig } from "./referral-config.js";
import { getOrCreateWallet } from "./sitong-wallet.js";

/**
 * 推荐有礼 · 奖励发放引擎（PLAT-28 第②批）。
 *
 * 冻结口径（用户 2026-09-12 拍板）：
 * - 三段奖励：新客 100（绑定即得）、推荐人 100（被推荐人首次真实使用）、推荐人 200（被推荐人首次真实充值）；
 * - 奖励进 bonus 桶、90 天有效、只能用于文字类智能体（图片/视频走租户 CreditAccount，结构上天然不可用 bonus）；
 * - 三个事件都必须落在活动窗内（左闭右开）；
 * - 充值必须真实 paid 未退款，退款走冲正（reverseReferralReward）；
 * - 不设单人月上限，超阈值只告警不拦截。
 *
 * 幂等：同一 `referral_reward:<kind>:<bindingId>` 账本来源只发一次（Serializable + 冲突重试）。
 * 所有发放都是 best-effort：失败只记日志，绝不阻断注册 / 生成 / 充值主流程。
 */
export type ReferralRewardKind = "new_user" | "referrer_first_use" | "referrer_first_recharge";

export type ReferralRewardReason =
  | "granted"
  | "disabled"
  | "outside_window"
  | "no_binding"
  | "no_amount"
  | "no_receiver"
  | "duplicate"
  | "failed";

export interface ReferralRewardOutcome {
  kind: ReferralRewardKind;
  granted: boolean;
  amount: number;
  receiverUserId: string | null;
  reason: ReferralRewardReason;
  /** 本月该用户推荐奖励累计达到告警阈值时置 true（只告警，不拦截） */
  alerted?: boolean;
}

export function referralRewardSource(kind: ReferralRewardKind, bindingId: string): string {
  return `referral_reward:${kind}:${bindingId}`;
}

function amountForKind(config: ReferralConfig, kind: ReferralRewardKind): number {
  switch (kind) {
    case "new_user":
      return config.newUserCredits;
    case "referrer_first_use":
      return config.referrerFirstUseCredits;
    case "referrer_first_recharge":
      return config.referrerFirstRechargeCredits;
  }
}

async function latestBindingByReferredUser(referredUserId: string) {
  return prisma.referralBinding.findFirst({
    where: { referredUserId },
    orderBy: { boundAt: "asc" },
    take: 1
  });
}

function fallback(kind: ReferralRewardKind, reason: ReferralRewardReason): ReferralRewardOutcome {
  return { kind, granted: false, amount: 0, receiverUserId: null, reason };
}

/**
 * 发奖入口：按被推荐人找归因行，命中且窗口内则按 kind 发对应金额。
 * 被推荐人（new_user）发给被推荐人；两段推荐人奖励发给推荐人。
 */
export async function maybeGrantReferralReward(params: {
  referredUserId: string;
  kind: ReferralRewardKind;
}): Promise<ReferralRewardOutcome> {
  const { referredUserId, kind } = params;
  try {
    const binding = await latestBindingByReferredUser(referredUserId);
    if (!binding) return fallback(kind, "no_binding");

    const config = await getReferralConfig();
    if (!config.enabled) return fallback(kind, "disabled");
    if (!isWithinReferralCampaignWindow(new Date(), {
      campaignStartsAt: config.campaignStartsAt,
      campaignEndsAt: config.campaignEndsAt
    })) {
      return fallback(kind, "outside_window");
    }

    const amount = Math.max(0, Math.round(amountForKind(config, kind)));
    if (amount <= 0) return fallback(kind, "no_amount");

    const receiverUserId = kind === "new_user" ? binding.referredUserId : binding.referrerUserId;
    if (!receiverUserId) return fallback(kind, "no_receiver");

    const source = referralRewardSource(kind, binding.id);
    const expiresAt = new Date(Date.now() + config.rewardValidDays * 86_400_000);
    const granted = await prisma.$transaction(async (tx) => {
      const existing = await tx.walletLedger.findFirst({ where: { userId: receiverUserId, source } });
      if (existing) return false;
      const wallet = await getOrCreateWallet(receiverUserId, tx);
      await tx.wallet.update({
        where: { id: wallet.id },
        data: { bonusBalance: { increment: amount } }
      });
      await tx.walletLedger.create({
        data: {
          walletId: wallet.id,
          userId: receiverUserId,
          delta: amount,
          bucket: "bonus",
          type: "bonus",
          expiresAt,
          source
        }
      });
      return true;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }).catch((error: unknown) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
        return maybeGrantReferralReward(params).then((retry) => retry.granted);
      }
      throw error;
    });

    if (!granted) return { kind, granted: false, amount: 0, receiverUserId, reason: "duplicate" };

    // 月度累计超阈值只告警不拦截。
    let alerted = false;
    try {
      const monthStart = new Date();
      monthStart.setUTCDate(1);
      monthStart.setUTCHours(0, 0, 0, 0);
      const monthly = await prisma.walletLedger.aggregate({
        where: {
          userId: receiverUserId,
          source: { startsWith: "referral_reward:" },
          createdAt: { gte: monthStart }
        },
        _sum: { delta: true }
      });
      const monthlyTotal = monthly._sum.delta ?? 0;
      if (monthlyTotal >= config.alertThresholdCredits) {
        alerted = true;
        console.warn(`[referral_reward_alert] userId=${receiverUserId} kind=${kind} monthlyTotal=${monthlyTotal} threshold=${config.alertThresholdCredits}`);
      }
    } catch (error) {
      // 告警失败不影响发奖正确性。
      console.warn('[referral_reward_alert] aggregate failed', error instanceof Error ? error.message : String(error));
    }

    return { kind, granted: true, amount, receiverUserId, reason: "granted", alerted };
  } catch (error) {
    console.warn('[referral_reward] skipped', error instanceof Error ? error.message : String(error));
    return fallback(kind, "failed");
  }
}


/**
 * 退款冲正：找到对应发奖流水后，从 bonus 桶扣回并落一条冲正流水。
 * 幂等：同一 `referral_reward_reversal:<kind>:<bindingId>` 只冲一次。
 * （当前系统还没有退款流程，先提供该能力；接入后由退款处理方调用。）
 */
export async function reverseReferralReward(params: {
  referredUserId: string;
  kind: "referrer_first_recharge";
}): Promise<ReferralRewardOutcome> {
  const { referredUserId, kind } = params;
  try {
    const binding = await latestBindingByReferredUser(referredUserId);
    if (!binding) return fallback(kind, "no_binding");
    const source = referralRewardSource(kind, binding.id);
    const reversalSource = `referral_reward_reversal:${kind}:${binding.id}`;
    const receiverUserId = binding.referrerUserId;
    if (!receiverUserId) return fallback(kind, "no_receiver");

    const reversed = await prisma.$transaction(async (tx) => {
      const grant = await tx.walletLedger.findFirst({ where: { userId: receiverUserId, source } });
      if (!grant) return false;
      const existing = await tx.walletLedger.findFirst({ where: { userId: receiverUserId, source: reversalSource } });
      if (existing) return false;
      const wallet = await getOrCreateWallet(receiverUserId, tx);
      const debit = Math.min(wallet.bonusBalance, Math.abs(grant.delta));
      if (debit <= 0) return true;
      await tx.wallet.update({
        where: { id: wallet.id },
        data: { bonusBalance: { decrement: debit } }
      });
      await tx.walletLedger.create({
        data: {
          walletId: wallet.id,
          userId: receiverUserId,
          delta: -debit,
          bucket: "bonus",
          type: "bonus",
          source: reversalSource
        }
      });
      return true;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }).catch((error: unknown) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
        return reverseReferralReward(params).then((retry) => retry.granted);
      }
      throw error;
    });

    return { kind, granted: reversed, amount: 0, receiverUserId, reason: reversed ? "granted" : "duplicate" };
  } catch (error) {
    console.warn("[referral_reward_reversal] failed", error instanceof Error ? error.message : String(error));
    return fallback(kind, "failed");
  }
}

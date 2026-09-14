import { Prisma, prisma } from "@baolu/db";

export interface WalletSnapshot {
  paidBalance: number;
  bonusBalance: number;
  balance: number;
}

export interface RechargeApplyParams {
  userId: string;
  planId: string;
  amountCny: number;
  basePts: number;
  bonusPts: number;
  method?: string;
  idempotencyKey?: string;
  priceVersion?: number;
  source?: string;
}

export type WalletConsumeResult =
  | {
      status: "completed";
      idempotent: boolean;
      wallet: WalletSnapshot;
      spent: { paid: number; bonus: number };
    }
  | {
      status: "insufficient";
      idempotent: boolean;
      wallet: WalletSnapshot;
      required: number;
      rechargeUrl: string;
    };

export async function getOrCreateWallet(
  userId: string,
  tx: Prisma.TransactionClient | typeof prisma = prisma
) {
  return tx.wallet.upsert({
    where: { userId },
    update: {},
    create: { userId }
  });
}

export async function readWallet(userId: string): Promise<WalletSnapshot> {
  const wallet = await getOrCreateWallet(userId);
  return toSnapshot(wallet);
}

function toSnapshot(wallet: { paidBalance: number; bonusBalance: number }): WalletSnapshot {
  return {
    paidBalance: wallet.paidBalance,
    bonusBalance: wallet.bonusBalance,
    balance: wallet.paidBalance + wallet.bonusBalance
  };
}

export function buildRechargeUrl(skillId?: string): string {
  const params = new URLSearchParams({ from: "workbuddy" });
  if (skillId) params.set("skill", skillId);
  return `/recharge?${params.toString()}`;
}

/**
 * 充值入账：base 严格入 paid 桶，bonus 独立入 bonus 桶，写两条 ledger。
 * 幂等键复用同一 RechargeOrder；重复调用不重复入账。
 */
export async function applyRecharge(params: RechargeApplyParams): Promise<{
  orderId: string;
  wallet: WalletSnapshot;
  idempotent: boolean;
}> {
  return prisma.$transaction(async (tx) => applyRechargeInTx(tx, params), {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable
  });
}

export async function applyRechargeInTx(
  tx: Prisma.TransactionClient,
  params: RechargeApplyParams
): Promise<{
  orderId: string;
  wallet: WalletSnapshot;
  idempotent: boolean;
}> {
    const wallet = await getOrCreateWallet(params.userId, tx);
    let existing: { id: string } | null = null;
    if (params.idempotencyKey) {
      existing = await tx.rechargeOrder.findUnique({
        where: { idempotencyKey: params.idempotencyKey },
        select: { id: true }
      });
      if (existing) {
        return {
          orderId: existing.id,
          wallet: await snapshotFromTx(wallet.id, tx),
          idempotent: true
        };
      }
    }

    const order = await tx.rechargeOrder.create({
      data: {
        userId: params.userId,
        planId: params.planId,
        amountCny: params.amountCny,
        basePts: params.basePts,
        bonusPts: params.bonusPts,
        method: params.method ?? "wechat",
        status: "paid",
        idempotencyKey: params.idempotencyKey,
        priceVersion: params.priceVersion,
        paidAt: new Date()
      }
    });

    const base = Math.max(0, Math.round(params.basePts));
    const bonus = Math.max(0, Math.round(params.bonusPts));
    const source = params.source ?? "web";

    await tx.wallet.update({
      where: { id: wallet.id },
      data: {
        paidBalance: { increment: base },
        bonusBalance: { increment: bonus }
      }
    });

    if (base > 0) {
      await tx.walletLedger.create({
        data: {
          walletId: wallet.id,
          userId: params.userId,
          delta: base,
          bucket: "paid",
          type: "recharge",
          refOrderId: order.id,
          priceVersion: params.priceVersion,
          source
        }
      });
    }
    if (bonus > 0) {
      await tx.walletLedger.create({
        data: {
          walletId: wallet.id,
          userId: params.userId,
          delta: bonus,
          bucket: "bonus",
          type: "bonus",
          refOrderId: order.id,
          priceVersion: params.priceVersion,
          source
        }
      });
    }

    return {
      orderId: order.id,
      wallet: await snapshotFromTx(wallet.id, tx),
      idempotent: false
    };
}

/**
 * 注册发放欢迎体验积分：发到**用户级双桶钱包**的 bonus 桶。
 *
 * 货架（平台唯一入口 `/market`）的展示（`/market/me`、货架访问态）与扣费
 * （`/market/skus/:skuId/run`、`/market/ppu/consume`）统一读用户钱包；欢迎积分
 * 如果只写租户级 `CreditAccount`，新用户进平台就会看到「💎 0 积分」并且点不动任何
 * 智能体（QA-20260910-016）。因此注册发币必须与货架同源。
 *
 * 幂等：以该用户 `source="signup"` 的钱包流水为准，同一用户只发一次；
 * 同一用户第二次建工作区不会重复领取，懒创建的 0/0 钱包也能补发一次。
 * 必须与工作区创建在同一事务内调用，避免「建了工作区却没发币」的半成品态。
 */
export async function grantSignupWalletCreditsInTx(
  tx: Prisma.TransactionClient,
  params: { userId: string; amount: number; source?: string }
): Promise<{ granted: boolean; amount: number; balance: number }> {
  const amount = Math.max(0, Math.round(params.amount));
  const source = params.source ?? "signup";
  const wallet = await getOrCreateWallet(params.userId, tx);

  if (amount <= 0) {
    return { granted: false, amount: 0, balance: wallet.paidBalance + wallet.bonusBalance };
  }

  const existing = await tx.walletLedger.findFirst({
    where: { userId: params.userId, source },
    select: { id: true }
  });
  if (existing) {
    return { granted: false, amount: 0, balance: wallet.paidBalance + wallet.bonusBalance };
  }

  const updated = await tx.wallet.update({
    where: { id: wallet.id },
    data: { bonusBalance: { increment: amount } }
  });

  await tx.walletLedger.create({
    data: {
      walletId: wallet.id,
      userId: params.userId,
      delta: amount,
      bucket: "bonus",
      type: "bonus",
      source
    }
  });

  return {
    granted: true,
    amount,
    balance: updated.paidBalance + updated.bonusBalance
  };
}

/**
 * 预检：只读余额与应付金额，不产生任何账本。
 */
export async function precheckConsume(params: {
  userId: string;
  price: number;
  skillId?: string;
}): Promise<{ allowed: boolean; wallet: WalletSnapshot; required: number; rechargeUrl: string }> {
  const wallet = await readWallet(params.userId);
  return {
    allowed: wallet.balance >= params.price,
    wallet,
    required: params.price,
    rechargeUrl: buildRechargeUrl(params.skillId)
  };
}

/**
 * 消耗扣减：同一 request_id 幂等；先扣 paid，paid 不足再扣 bonus；
 * 跨桶拆两条 ledger；并发下用 Serializable + 条件更新保证不为负。
 */
export async function consumeWalletCredits(params: {
  userId: string;
  requestId: string;
  price: number;
  skillId?: string;
  viaBundle?: string;
  stepIndex?: number;
  priceVersion?: number;
  source?: string;
  accessTokenId?: string;
}): Promise<WalletConsumeResult> {
  const amount = Math.max(0, Math.round(params.price));
  if (amount <= 0) {
    throw Object.assign(new Error("consume_amount_invalid"), { statusCode: 400 });
  }
  const source = params.source ?? "workbuddy";

  try {
    return await prisma.$transaction(async (tx) => {
      const wallet = await getOrCreateWallet(params.userId, tx);

      const existingConsume = await tx.walletLedger.findFirst({
        where: {
          walletId: wallet.id,
          refRequestId: params.requestId,
          type: "consume"
        },
        orderBy: { createdAt: "asc" },
        take: 1
      });
      if (existingConsume) {
        const walletNow = await snapshotFromTx(wallet.id, tx);
        return {
          status: "completed" as const,
          idempotent: true,
          wallet: walletNow,
          spent: { paid: 0, bonus: 0 }
        };
      }

      const paidUse = Math.min(wallet.paidBalance, amount);
      // PLAT-28 第②批：推荐奖励有 90 天到期（expiresAt），已到期的推荐奖励积分不可消费。
      // 采用聚合口径：从 bonus 余额里扣除「已过期且仍未花掉的推荐奖励」总量（保守，且不误放行过期积分）。
      const expiredReferralAgg = await tx.walletLedger.aggregate({
        where: {
          userId: params.userId,
          bucket: "bonus",
          type: "bonus",
          source: { startsWith: "referral_reward:" },
          expiresAt: { not: null, lte: new Date() }
        },
        _sum: { delta: true }
      });
      const expiredReferral = Math.max(0, expiredReferralAgg._sum.delta ?? 0);
      const bonusUse = Math.min(Math.max(0, wallet.bonusBalance - expiredReferral), amount - paidUse);
      const totalUse = paidUse + bonusUse;

      if (totalUse < amount) {
        return {
          status: "insufficient" as const,
          idempotent: false,
          wallet: toSnapshot(wallet),
          required: amount,
          rechargeUrl: buildRechargeUrl(params.skillId)
        };
      }

      if (paidUse > 0) {
        const claimed = await tx.wallet.updateMany({
          where: { id: wallet.id, paidBalance: { gte: paidUse } },
          data: { paidBalance: { decrement: paidUse } }
        });
        if (claimed.count !== 1) throw new Error("wallet_paid_balance_conflict");
        await tx.walletLedger.create({
          data: {
            walletId: wallet.id,
            userId: params.userId,
            delta: -paidUse,
            bucket: "paid",
            type: "consume",
            refRequestId: params.requestId,
            skillId: params.skillId,
            viaBundle: params.viaBundle,
            stepIndex: params.stepIndex,
            priceVersion: params.priceVersion,
            source
          }
        });
      }

      if (bonusUse > 0) {
        const claimed = await tx.wallet.updateMany({
          where: { id: wallet.id, bonusBalance: { gte: bonusUse } },
          data: { bonusBalance: { decrement: bonusUse } }
        });
        if (claimed.count !== 1) throw new Error("wallet_bonus_balance_conflict");
        await tx.walletLedger.create({
          data: {
            walletId: wallet.id,
            userId: params.userId,
            delta: -bonusUse,
            bucket: "bonus",
            type: "consume",
            refRequestId: params.requestId,
            skillId: params.skillId,
            viaBundle: params.viaBundle,
            stepIndex: params.stepIndex,
            priceVersion: params.priceVersion,
            source
          }
        });
      }

      return {
        status: "completed" as const,
        idempotent: false,
        wallet: await snapshotFromTx(wallet.id, tx),
        spent: { paid: paidUse, bonus: bonusUse }
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      // Serializable 冲突：重试一次，保证并发下余额不为负。
      return consumeWalletCredits(params);
    }
    throw error;
  }
}

/**
 * 重做记录：同一 request_id 限 1 次免费重做，不产生扣减，只写一条 type=redo 记录。
 */
export async function recordRedo(params: {
  userId: string;
  requestId: string;
  skillId?: string;
  source?: string;
}): Promise<{ ok: boolean; redoLeft: number }> {
  const wallet = await getOrCreateWallet(params.userId);
  const redos = await prisma.walletLedger.count({
    where: { walletId: wallet.id, refRequestId: params.requestId, type: "redo" }
  });
  if (redos >= 1) return { ok: false, redoLeft: 0 };
  await prisma.walletLedger.create({
    data: {
      walletId: wallet.id,
      userId: params.userId,
      delta: 0,
      bucket: "paid",
      type: "redo",
      refRequestId: params.requestId,
      skillId: params.skillId,
      source: params.source ?? "workbuddy"
    }
  });
  return { ok: true, redoLeft: 0 };
}

async function snapshotFromTx(
  walletId: string,
  tx: Prisma.TransactionClient
): Promise<WalletSnapshot> {
  const row = await tx.wallet.findUniqueOrThrow({
    where: { id: walletId },
    select: { paidBalance: true, bonusBalance: true }
  });
  return toSnapshot(row);
}

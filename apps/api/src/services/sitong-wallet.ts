import { Prisma, prisma } from "@baolu/db";

export interface WalletSnapshot {
  paidBalance: number;
  bonusBalance: number;
  balance: number;
}

/**
 * 钱包读写用的 Prisma 客户端。
 *
 * 生产路径一律用进程级单例；显式传入只是为了**离线回归**（`scripts/fixtures/replication-test-db.ts`
 * 的内存库）能在不发真实请求、不动真实库的前提下验证「扣费 / 退款 / 幂等 / 原桶退回」。
 */
export type WalletDb = Prisma.TransactionClient | typeof prisma;

/**
 * 在钱包事务里执行。
 *
 * `WalletDb` 允许传入「已经是事务的客户端」（`Prisma.TransactionClient` 上没有 `$transaction`），
 * 这时直接在它上面执行，保持调用方原有的事务边界；只有拿到进程级单例（或同形的离线夹具）时
 * 才新开一个事务。
 */
export async function withWalletTransaction<T>(
  db: WalletDb,
  run: (tx: Prisma.TransactionClient) => Promise<T>,
  options?: { isolationLevel?: Prisma.TransactionIsolationLevel }
): Promise<T> {
  const runner = db as {
    $transaction?: (
      fn: (tx: Prisma.TransactionClient) => Promise<T>,
      options?: { isolationLevel?: Prisma.TransactionIsolationLevel }
    ) => Promise<T>;
  };
  if (typeof runner.$transaction === "function") return runner.$transaction(run, options);
  return run(db as Prisma.TransactionClient);
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

export async function readWallet(userId: string, db: WalletDb = prisma): Promise<WalletSnapshot> {
  const wallet = await getOrCreateWallet(userId, db);
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

/** 赠送算力统一有效期（HANDOFF §7）：90 天，到期清零，到期前 3 天提醒（提醒由账单侧后续补）。 */
export const GIFT_BONUS_VALIDITY_DAYS = 90;

/**
 * 新用户注册礼（0 元开通 / 建工作区送的 100 算力）有效期：**30 天**。
 *
 * 用户 2026-09-30 拍板：新用户赠送的那 100 算力按 30 天算，不跟充值加赠 / 签到 / 邀请
 * 的 90 天共用同一个数——注册礼是「先来试试」的券，签到与充值加赠才是长周期赠送。
 */
export const SIGNUP_GIFT_VALIDITY_DAYS = 30;

/**
 * 新客礼的所有入账 source（2026-09-30 用户：开通礼/注册礼同一个意思，只送一次）。
 * `signup` = 建工作区时发（database-bootstrap），`signup_gift` = 货架「免费开通」发
 * （/market/activate）。发放入口去重一律按这个并集判断。
 */
export const SIGNUP_GIFT_SOURCES = ["signup", "signup_gift"] as const;

export function giftBonusExpiry(now = new Date(), days = GIFT_BONUS_VALIDITY_DAYS): Date {
  return new Date(now.getTime() + days * 24 * 3600 * 1000);
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
          source,
          // 充值加赠 = 赠送算力（HANDOFF §4/§7）：90 天有效期，到期清零。
          expiresAt: giftBonusExpiry()
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
 * 注册发放欢迎体验算力：发到**用户级双桶钱包**的 bonus 桶。
 *
 * 货架（平台唯一入口 `/market`）的展示（`/market/me`、货架访问态）与扣费
 * （`/market/skus/:skuId/run`、`/market/ppu/consume`）统一读用户钱包；欢迎算力
 * 如果只写租户级 `CreditAccount`，新用户进平台就会看到「💎 0 算力」并且点不动任何
 * 智能体（QA-20260910-016）。因此注册发币必须与货架同源。
 *
 * 幂等（2026-09-30 用户：开通礼/注册礼是同一个意思，不能送两次）：
 * 新客礼有两个入口——建工作区（source="signup"）与货架「免费开通」（source="signup_gift"），
 * **去重按两个 source 的并集**判断，谁先到谁算数；仍写入调用方自己的 source 便于对账。
 * 同一用户第二次建工作区/第二次点开通都不会重复领取，懒创建的 0/0 钱包也能补发一次。
 * 必须与工作区创建在同一事务内调用，避免「建了工作区却没发币」的半成品态。
 */
export async function grantSignupWalletCreditsInTx(
  tx: Prisma.TransactionClient,
  params: { userId: string; amount: number; source?: string; validDays?: number }
): Promise<{ granted: boolean; amount: number; balance: number }> {
  const amount = Math.max(0, Math.round(params.amount));
  const source = params.source ?? "signup";
  const validDays = params.validDays ?? SIGNUP_GIFT_VALIDITY_DAYS;
  const wallet = await getOrCreateWallet(params.userId, tx);

  if (amount <= 0) {
    return { granted: false, amount: 0, balance: wallet.paidBalance + wallet.bonusBalance };
  }

  const existing = await tx.walletLedger.findFirst({
    where: {
      userId: params.userId,
      // 2026-09-30 用户：新客礼只送一次——除了注册礼两个 source 互斥，
      // 被邀请新客礼（referral_reward:new_user:*）如果先发了，注册礼也不再发。
      OR: [
        { source: { in: [...SIGNUP_GIFT_SOURCES] } },
        { source: { startsWith: "referral_reward:new_user" } }
      ]
    },
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
      source,
      // 注册礼 = 新用户赠送算力（用户 2026-09-30）：**30 天**有效期，到期清零。
      expiresAt: giftBonusExpiry(new Date(), validDays)
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
 * 消耗扣减：同一 request_id 幂等；**先扣赠送（bonus），不足再扣充值（paid）**（算力计费 v1.0，
 * HANDOFF §2.7：赠送算力先扣、到期日最近者优先，充值算力后扣、先充先扣）；
 * 跨桶拆两条 ledger；并发下用 Serializable + 条件更新保证不为负。
 */
export async function consumeWalletCredits(params: {
  userId: string;
  requestId: string;
  price: number;
  skillId?: string;
  /** 只许用充值算力、禁用赠送桶（2026-10-04 用户拍板：视频/图片生成不收赠送积分）。 */
  paidOnly?: boolean;
  viaBundle?: string;
  stepIndex?: number;
  priceVersion?: number;
  source?: string;
  accessTokenId?: string;
  /** 显式客户端（离线回归用）；缺省 = 进程级 prisma 单例。 */
  db?: WalletDb;
}): Promise<WalletConsumeResult> {
  const amount = Math.max(0, Math.round(params.price));
  if (amount <= 0) {
    throw Object.assign(new Error("consume_amount_invalid"), { statusCode: 400 });
  }
  const source = params.source ?? "workbuddy";
  const db = params.db ?? prisma;

  try {
    return await withWalletTransaction(db, async (tx) => {
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

      // 赠送算力有效期（HANDOFF §7）：所有赠送发放（type=bonus/admin）带 expiresAt，
      // 已过期且仍未花掉的赠送按聚合口径从可用赠送中扣除（保守，且不误放行过期算力）。
      const expiredBonusAgg = await tx.walletLedger.aggregate({
        where: {
          userId: params.userId,
          bucket: "bonus",
          type: { in: ["bonus", "admin"] },
          expiresAt: { not: null, lte: new Date() }
        },
        _sum: { delta: true }
      });
      const expiredBonus = Math.max(0, expiredBonusAgg._sum.delta ?? 0);
      const usableBonus = Math.max(0, wallet.bonusBalance - expiredBonus);
      // paidOnly：媒体类生成（视频/图片）不碰赠送桶，哪怕赠送余额足够也不许用。
      const bonusUse = params.paidOnly ? 0 : Math.min(usableBonus, amount);
      const paidUse = Math.min(wallet.paidBalance, amount - bonusUse);
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
 * 按实际消耗结算后的差额退款（PLAT-41「先预留 → 按实际结算 → 差额退回」）。
 *
 * 预留走 `consumeWalletCredits({requestId: "reserve:<id>"})`，所以这里只需要把多扣的部分写回来：
 * - 同一 `refRequestId` 幂等（同一笔预留只退一次）；
 * - 退回到**当初扣的那个桶**（扣费顺序：赠送先扣、充值后扣，退款按预留时记录的拆分原路退回）；
 * - 只加不扣，永远不可能把余额退成负数。
 */
export async function refundWalletCredits(params: {
  userId: string;
  requestId: string;
  /** 退款拆分：与预留时 `spent` 同形（paid / bonus 各退多少）。 */
  breakdown: { paid: number; bonus: number };
  skillId?: string;
  source?: string;
  reason?: string;
  /** 显式客户端（离线回归用）；缺省 = 进程级 prisma 单例。 */
  db?: WalletDb;
}): Promise<{ refunded: number; idempotent: boolean; wallet: WalletSnapshot }> {
  const db = params.db ?? prisma;
  return await withWalletTransaction(db, (tx) => refundWalletInTx(tx, params), {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable
  });
}

/**
 * `refundWalletCredits` 的事务版本（PLAT-46）。
 *
 * WorkBuddy / MCP 通道的预留结算必须与 `AgentRun` / `Message` 的写入在**同一个事务**里提交，
 * 否则会出现「跑了但没落库、钱已退」或「落了库但差额没退」的半成品态。调用方已经开了事务时，
 * 不能再嵌套一个 `prisma.$transaction`，所以把纯逻辑抽出来复用。
 */
export async function refundWalletInTx(
  tx: WalletDb,
  params: {
    userId: string;
    requestId: string;
    /** 退款拆分：与预留时 `spent` 同形（paid / bonus 各退多少）。 */
    breakdown: { paid: number; bonus: number };
    skillId?: string;
    source?: string;
    reason?: string;
  }
): Promise<{ refunded: number; idempotent: boolean; wallet: WalletSnapshot }> {
  const paidRefund = Math.max(0, Math.round(params.breakdown.paid));
  const bonusRefund = Math.max(0, Math.round(params.breakdown.bonus));
  const source = params.source ?? "web";
  const reason = (params.reason ?? "reserve_settlement").slice(0, 60);
  const wallet = await getOrCreateWallet(params.userId, tx);
  const existing = await tx.walletLedger.findFirst({
    where: { walletId: wallet.id, refRequestId: params.requestId, type: "refund" },
    orderBy: { createdAt: "asc" },
    take: 1
  });
  if (existing) {
    return { refunded: 0, idempotent: true, wallet: await snapshotFromTx(wallet.id, tx) };
  }
  if (paidRefund > 0) {
    await tx.wallet.update({ where: { id: wallet.id }, data: { paidBalance: { increment: paidRefund } } });
    await tx.walletLedger.create({
      data: {
        walletId: wallet.id,
        userId: params.userId,
        delta: paidRefund,
        bucket: "paid",
        type: "refund",
        refRequestId: params.requestId,
        skillId: params.skillId,
        source: `${source}:${reason}`
      }
    });
  }
  if (bonusRefund > 0) {
    await tx.wallet.update({ where: { id: wallet.id }, data: { bonusBalance: { increment: bonusRefund } } });
    await tx.walletLedger.create({
      data: {
        walletId: wallet.id,
        userId: params.userId,
        delta: bonusRefund,
        bucket: "bonus",
        type: "refund",
        refRequestId: params.requestId,
        skillId: params.skillId,
        source: `${source}:${reason}`
      }
    });
  }
  return { refunded: paidRefund + bonusRefund, idempotent: false, wallet: await snapshotFromTx(wallet.id, tx) };
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

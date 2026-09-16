// 兰琪通用钱包（LQ-34）：把兰琪的扣费主体从「租户积分账户」切到「**租户老板（owner）的通用钱包**」。
//
// 用户 2026-09-16 口径（原话）：
//   「兰琪的用户只使用兰琪智能体……在兰琪智能体充值的积分，可以支持同时在思潼 AI 里使用其他智能体。也就是说钱包是通用的。」
//   「兰琪里不管谁操作，都扣**租户老板（owner）的钱包**，流水里记『谁操作的、扣的是老板的钱』；
//     思潼 AI 侧保持『谁登录扣谁的钱包』。」
//
// 所以这里只做三件事，并让所有兰琪能力共用：
//   ① `precheckLanqiWallet`：按 owner 钱包余额做前置校验（不足 → 402，且**不调模型**）；
//   ② `chargeLanqiWallet`：扣 owner 钱包（paid → bonus、Serializable、同键幂等），操作人写进流水；
//   ③ `refundLanqiWallet`：**按原扣费流水回退到原桶**，同一 requestId 只退一次。
//
// 唯一账本 = 用户钱包（`Wallet` / `WalletLedger`，与思潼 AI 货架同一本）；
// 兰琪不再写 `CreditAccount`（历史额度由 LQ-34 的一次性迁移搬进钱包，见任务卡）。
import { prisma } from "@baolu/db";
import {
  consumeWalletCredits,
  getOrCreateWallet,
  readWallet,
  refundWalletCredits,
  type WalletSnapshot
} from "./sitong-wallet.js";

export const LANQI_WALLET_VERSION = "lanqi_owner_wallet_v1" as const;

/** 幂等键统一加租户前缀：同一 owner 若服务多个门店，不同门店的同一 requestId 也不能撞键。 */
export function lanqiWalletRequestId(tenantId: string, requestId: string): string {
  return `lanqi:${tenantId}:${requestId}`;
}

export interface LanqiWalletOwner {
  tenantId: string;
  ownerUserId: string;
  wallet: WalletSnapshot;
}

/**
 * 兰琪的付费主体 = 该租户的 owner。
 *
 * 找不到 owner（数据异常 / 只有 staff 成员）时**返回 undefined**，调用方必须 fail closed：
 * 宁可报「本店还没有可扣费的老板账号，请联系思潼服务团队」，也不能悄悄扣到别人头上或直接放行。
 */
export async function resolveLanqiWalletOwner(tenantId: string): Promise<LanqiWalletOwner | undefined> {
  const membership = await prisma.membership.findFirst({
    where: { tenantId, role: "owner", isActive: true },
    select: { userId: true },
    orderBy: { createdAt: "asc" }
  });
  if (!membership) return undefined;
  const wallet = await getOrCreateWallet(membership.userId);
  return {
    tenantId,
    ownerUserId: membership.userId,
    wallet: {
      paidBalance: wallet.paidBalance,
      bonusBalance: wallet.bonusBalance,
      balance: wallet.paidBalance + wallet.bonusBalance
    }
  };
}

export type LanqiWalletPrecheck =
  | { ok: true; ownerUserId: string; balance: number }
  | { ok: false; code: "lanqi_wallet_owner_missing"; message: string }
  | { ok: false; code: "insufficient_credits"; message: string; balance: number; required: number };

/** 前置余额校验：不足时不调模型、不扣费。 */
export async function precheckLanqiWallet(params: { tenantId: string; credits: number }): Promise<LanqiWalletPrecheck> {
  const owner = await resolveLanqiWalletOwner(params.tenantId);
  if (!owner) {
    return {
      ok: false,
      code: "lanqi_wallet_owner_missing",
      message: "本店还没有可扣费的老板账号（通用钱包主体缺失），本次不会生成也不会扣积分；请联系思潼服务团队。"
    };
  }
  if (owner.wallet.balance < params.credits) {
    return {
      ok: false,
      code: "insufficient_credits",
      message: `积分不足：这次没有生成、也没有扣积分。本次需要 ${params.credits} 积分，请点右上角「我的 · 充值」充值后再试。`,
      balance: owner.wallet.balance,
      required: params.credits
    };
  }
  return { ok: true, ownerUserId: owner.ownerUserId, balance: owner.wallet.balance };
}

export type LanqiWalletChargeResult =
  | {
      status: "completed";
      ownerUserId: string;
      idempotent: boolean;
      wallet: WalletSnapshot;
      /** 这次实际各桶扣了多少：退款必须按它原路退回。 */
      spent: { paid: number; bonus: number };
    }
  | { status: "owner_missing" }
  | { status: "insufficient"; ownerUserId: string; wallet: WalletSnapshot; required: number };

/**
 * 扣费：扣**owner 钱包**。操作人（真正点这一下的用户）只进流水，不决定扣谁的钱。
 */
export async function chargeLanqiWallet(params: {
  tenantId: string;
  /** 操作人（可为空：定时/系统触发）。 */
  operatorUserId?: string | null;
  requestId: string;
  credits: number;
  skillId: string;
}): Promise<LanqiWalletChargeResult> {
  const owner = await resolveLanqiWalletOwner(params.tenantId);
  if (!owner) return { status: "owner_missing" };
  const operator = params.operatorUserId ? `operator=${params.operatorUserId}` : "operator=system";
  const consumed = await consumeWalletCredits({
    userId: owner.ownerUserId,
    requestId: lanqiWalletRequestId(params.tenantId, params.requestId),
    price: params.credits,
    skillId: params.skillId,
    source: `lanqi:${operator}`
  });
  if (consumed.status === "insufficient") {
    return { status: "insufficient", ownerUserId: owner.ownerUserId, wallet: consumed.wallet, required: params.credits };
  }
  return {
    status: "completed",
    ownerUserId: owner.ownerUserId,
    idempotent: consumed.idempotent,
    wallet: consumed.wallet,
    spent: consumed.spent
  };
}

export type LanqiWalletRefundResult =
  | { status: "refunded"; ownerUserId: string; refunded: number; idempotent: boolean; wallet: WalletSnapshot }
  | { status: "nothing_to_refund" }
  | { status: "owner_missing" };

/**
 * 退款：**按原扣费流水回退到原桶**（paid 扣多少退多少、bonus 同理），同一 requestId 只退一次。
 *
 * 调用方不需要自己记账：这样「先扣了、后来失败」的退款永远和扣费对称，不会把 bonus 退成 paid。
 */
export async function refundLanqiWallet(params: {
  tenantId: string;
  requestId: string;
  skillId: string;
  reason?: string;
}): Promise<LanqiWalletRefundResult> {
  const owner = await resolveLanqiWalletOwner(params.tenantId);
  if (!owner) return { status: "owner_missing" };
  const refRequestId = lanqiWalletRequestId(params.tenantId, params.requestId);
  const wallet = await getOrCreateWallet(owner.ownerUserId);
  const consumes = await prisma.walletLedger.findMany({
    where: { walletId: wallet.id, refRequestId, type: "consume" },
    select: { bucket: true, delta: true }
  });
  if (consumes.length === 0) return { status: "nothing_to_refund" };
  const breakdown = { paid: 0, bonus: 0 };
  for (const row of consumes) {
    const amount = Math.abs(Math.min(0, row.delta));
    if (row.bucket === "paid") breakdown.paid += amount;
    else breakdown.bonus += amount;
  }
  const refunded = await refundWalletCredits({
    userId: owner.ownerUserId,
    requestId: refRequestId,
    breakdown,
    skillId: params.skillId,
    source: "lanqi",
    reason: params.reason ?? "lanqi_refund"
  });
  return {
    status: "refunded",
    ownerUserId: owner.ownerUserId,
    refunded: refunded.refunded,
    idempotent: refunded.idempotent,
    wallet: refunded.wallet
  };
}

/** 兰琪页面 / 报价接口读取的余额 = owner 钱包余额（与「我的 · 充值」一致）。 */
export async function readLanqiWalletBalance(
  tenantId: string
): Promise<{ ownerUserId: string; balance: number; paidBalance: number; bonusBalance: number } | undefined> {
  const owner = await resolveLanqiWalletOwner(tenantId);
  if (!owner) return undefined;
  const wallet = await readWallet(owner.ownerUserId);
  return {
    ownerUserId: owner.ownerUserId,
    balance: wallet.balance,
    paidBalance: wallet.paidBalance,
    bonusBalance: wallet.bonusBalance
  };
}

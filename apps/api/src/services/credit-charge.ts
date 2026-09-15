import { consumeWalletCredits, readWallet, refundWalletCredits, type WalletSnapshot } from "./sitong-wallet.js";
import { creditsForCostCny, type BillingCapability } from "./billing-cost-model.js";

/**
 * 「先预留 → 调用 → 按实际结算 → 差额退回」的统一实现（PLAT-41，用户 2026-09-15 拍板）。
 *
 * 为什么不是「跑完再扣」：用户余额可能刚好够、但跑完不够，会扣成负余额或跑完才失败。
 * 这里先用**最坏估算**占住额度，跑完按实际成本结算，多占的部分退回原桶。
 *
 * 关键性质（都有回归钉住）：
 * - 余额不够 → 在调用 Provider **之前**就拒绝（`insufficient`），不产生任何外发与成本；
 * - 同一 `requestId` 幂等：重复预留 / 重复退款都不会多扣；
 * - 实际 ≤ 预留（预留必须取上界），差额按当初扣费的 paid/bonus 拆分退回；
 * - 任何失败路径都要退净（`refundAll`），不能把用户的钱卡在中间态。
 */

export interface CreditChargeReservation {
  requestId: string;
  capability: BillingCapability;
  reservedCredits: number;
  /** 预留时实际扣的桶拆分，结算退款要用它。 */
  reservedSplit: { paid: number; bonus: number };
  wallet: WalletSnapshot;
}

export class InsufficientCreditsForChargeError extends Error {
  constructor(public readonly required: number, public readonly wallet: WalletSnapshot) {
    super("insufficient_credits");
    this.name = "InsufficientCreditsForChargeError";
  }
}

/** 成本估算 → 预留额度（同一套 `max(1, ceil(...))`，保证预留 ≥ 结算）。 */
export function creditsForEstimatedCost(costCny: number, capability: BillingCapability): number {
  return creditsForCostCny(costCny, capability);
}

export async function reserveCreditsForCharge(params: {
  userId: string;
  requestId: string;
  capability: BillingCapability;
  estimatedCostCny: number;
  skillId?: string;
  source?: string;
}): Promise<CreditChargeReservation> {
  const reservedCredits = creditsForEstimatedCost(params.estimatedCostCny, params.capability);
  const consumed = await consumeWalletCredits({
    userId: params.userId,
    requestId: `reserve:${params.requestId}`,
    price: reservedCredits,
    skillId: params.skillId,
    source: params.source ?? "web"
  });
  if (consumed.status === "insufficient") {
    throw new InsufficientCreditsForChargeError(reservedCredits, consumed.wallet);
  }
  return {
    requestId: params.requestId,
    capability: params.capability,
    reservedCredits,
    reservedSplit: { paid: consumed.spent.paid, bonus: consumed.spent.bonus },
    wallet: consumed.wallet
  };
}

/** 结算：按实际成本收，多占的退回。返回本次真实扣费与最新余额。 */
export async function settleCreditsForCharge(params: {
  reservation: CreditChargeReservation;
  actualCostCny: number;
  userId: string;
  skillId?: string;
  source?: string;
}): Promise<{ chargedCredits: number; refundedCredits: number; wallet: WalletSnapshot }> {
  const { reservation, userId } = params;
  const actualCredits = creditsForEstimatedCost(params.actualCostCny, reservation.capability);
  const refund = Math.max(0, reservation.reservedCredits - actualCredits);
  let refundedCredits = 0;
  if (refund > 0) {
    // 退回当初扣的桶：先退 bonus（更易过期的先还回去），再退 paid。
    const bonusRefund = Math.min(refund, reservation.reservedSplit.bonus);
    const paidRefund = refund - bonusRefund;
    const result = await refundWalletCredits({
      userId,
      requestId: `settle:${reservation.requestId}`,
      breakdown: { paid: paidRefund, bonus: bonusRefund },
      skillId: params.skillId,
      source: params.source ?? "web",
      reason: `settle_reserve_${reservation.reservedCredits}_actual_${actualCredits}`
    });
    refundedCredits = result.idempotent ? 0 : result.refunded;
  }
  const wallet = refundedCredits > 0 ? (await readWallet(userId)) : reservation.wallet;
  return { chargedCredits: actualCredits, refundedCredits, wallet };
}

/** 失败关闭：调用前/调用中失败时，把预留的额度全额退回。 */
export async function refundAllCreditsForCharge(params: {
  reservation: CreditChargeReservation;
  userId: string;
  skillId?: string;
  source?: string;
  reason?: string;
}): Promise<{ refundedCredits: number; wallet: WalletSnapshot }> {
  const result = await refundWalletCredits({
    userId: params.userId,
    requestId: `settle:${params.reservation.requestId}`,
    breakdown: params.reservation.reservedSplit,
    skillId: params.skillId,
    source: params.source ?? "web",
    reason: params.reason ?? "charge_failed_refund_all"
  });
  return { refundedCredits: result.idempotent ? 0 : result.refunded, wallet: result.wallet };
}

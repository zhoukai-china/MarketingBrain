import { prisma, Prisma } from "@baolu/db";

/**
 * 市场合伙人分润结算（PLAT-48 第②批）。
 *
 * 已确认口径（老板 2026-09-18）：
 * - 基数 = 每笔成功扣费的 `spent.paid`（只有用户充值进来的付费桶消耗参与分成）。
 * - `spent.bonus` / 赠送 / 体验额度消耗不参与分成。
 * - 暂时全线统一 20%。
 * - 金额单位：本表按既有 `Distributor` / `DistroCommissionLog` 的人民币口径存
 *   `元`。换算：1 paid 积分 = ¥0.05，20% = ¥0.01 = 1 分 → 佣金(元) = spentPaid / 100。
 *
 * 幂等：每个消费事件带一个唯一 `idempotencyKey`，`DistroCommissionLog.idempotencyKey`
 * 唯一约束兜底，重复结算 / 并发结算不重复加钱。
 */

export const PARTNER_COMMISSION_RATE = 0.2;
export const PARTNER_COMMISSION_FREEZE_DAYS = 7;

export interface SettleResult {
  settled: boolean;
  idempotent?: boolean;
  reason?: "no_paid_spend" | "no_partner" | "already_settled";
  distributorId?: string;
  amountCny?: number;
  paidCredits?: number;
}

export function commissionCnyForPaidCredits(spentPaid: number): number {
  const credits = Math.max(0, Math.trunc(spentPaid));
  return Number((credits / 100).toFixed(2));
}

async function resolveActivePartner(tenantId: string) {
  const binding = await prisma.distroCustomer.findFirst({
    where: { customerId: tenantId, customerType: "tenant" },
    orderBy: { createdAt: "asc" },
    include: { distributor: true }
  });
  if (!binding || binding.distributor.status !== "active") return null;
  return binding;
}

export async function settleMarketPartnerCommission(params: {
  tenantId: string;
  userId: string;
  spentPaid: number;
  refType: string;
  refId: string;
  idempotencyKey: string;
}): Promise<SettleResult> {
  const paidCredits = Math.max(0, Math.trunc(params.spentPaid));
  if (paidCredits <= 0) return { settled: false, reason: "no_paid_spend" };

  const existing = await prisma.distroCommissionLog.findUnique({
    where: { idempotencyKey: params.idempotencyKey },
    select: { id: true }
  });
  if (existing) return { settled: false, idempotent: true, reason: "already_settled" };

  const binding = await resolveActivePartner(params.tenantId);
  if (!binding) return { settled: false, reason: "no_partner" };

  const amountCny = commissionCnyForPaidCredits(paidCredits);
  const unfrozenAt = new Date(Date.now() + PARTNER_COMMISSION_FREEZE_DAYS * 24 * 60 * 60_000);

  try {
    await prisma.$transaction(async (tx) => {
      await tx.distroCommissionLog.create({
        data: {
          distributorId: binding.distributorId,
          tenantId: params.tenantId,
          idempotencyKey: params.idempotencyKey,
          amount: new Prisma.Decimal(amountCny),
          rate: new Prisma.Decimal(PARTNER_COMMISSION_RATE),
          level: 1,
          type: "market_partner_consume",
          status: "pending",
          description: `市场合伙人消耗分润：paid ${paidCredits} 积分 × 20%（${params.refType}:${params.refId}）`,
          unfrozenAt
        }
      });
      await tx.distributor.update({
        where: { id: binding.distributorId },
        data: { frozenAmount: { increment: new Prisma.Decimal(amountCny) } }
      });
    });
    return {
      settled: true,
      distributorId: binding.distributorId,
      amountCny,
      paidCredits
    };
  } catch (error) {
    if ((error as { code?: string })?.code === "P2002") {
      return { settled: false, idempotent: true, reason: "already_settled" };
    }
    console.warn("[market-partner-commission] 结算失败（不影响主流程）：", error instanceof Error ? error.message : String(error));
    return { settled: false, reason: "no_partner" };
  }
}

export async function reverseMarketPartnerCommission(params: {
  idempotencyKey: string;
  reason?: string;
}): Promise<{ reversed: boolean; idempotent?: boolean }> {
  const log = await prisma.distroCommissionLog.findUnique({
    where: { idempotencyKey: params.idempotencyKey },
    select: { id: true, distributorId: true, amount: true, status: true, reversedAt: true }
  });
  if (!log) return { reversed: false };
  if (log.reversedAt) return { reversed: true, idempotent: true };

  const amount = Number(log.amount);
  await prisma.$transaction(async (tx) => {
    await tx.distroCommissionLog.update({
      where: { id: log.id },
      data: { reversedAt: new Date(), status: "reversed" }
    });
    await tx.distributor.update({
      where: { id: log.distributorId },
      data: { frozenAmount: { decrement: new Prisma.Decimal(amount) } }
    });
  });
  return { reversed: true };
}

/** 到期解冻：把 `unfrozenAt <= now` 的冻结佣金从 frozenAmount 转入 availableAmount。 */
export async function unfreezeDuePartnerCommissions(distributorId: string): Promise<{ unfrozen: number; amountCny: number }> {
  const due = await prisma.distroCommissionLog.findMany({
    where: { distributorId, status: "pending", unfrozenAt: { not: null, lte: new Date() } },
    select: { id: true, amount: true }
  });
  let amountCny = 0;
  for (const log of due) {
    const amount = Number(log.amount);
    const updated = await prisma.distroCommissionLog.updateMany({
      where: { id: log.id, status: "pending" },
      data: { status: "available" }
    });
    if (updated.count === 1) amountCny += amount;
  }
  if (amountCny > 0) {
    await prisma.distributor.update({
      where: { id: distributorId },
      data: {
        frozenAmount: { decrement: new Prisma.Decimal(amountCny) },
        availableAmount: { increment: new Prisma.Decimal(amountCny) }
      }
    });
  }
  return { unfrozen: due.length, amountCny };
}

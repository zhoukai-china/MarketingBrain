import { Prisma, prisma } from "@baolu/db";
import type { RequestContext } from "./request-context.js";
import { IdempotencyConflictError, InsufficientCreditsError } from "./chat-persistence.js";

export interface ProductBillingContext {
  productCode: string;
  operatingEntityId: string;
  channel: "web" | "mcp";
  credentialId?: string;
}

export interface CreditReservationHandle {
  id: string;
  amount: number;
}

export class BillingRequestInProgressError extends Error {
  constructor() {
    super("billing_request_in_progress");
  }
}

export class BillingRequestPreviouslyFailedError extends Error {
  constructor() {
    super("billing_request_previously_failed");
  }
}

export async function reserveCreditsBeforeProvider(params: {
  context: RequestContext;
  billing: ProductBillingContext;
  requestId: string;
  requestFingerprint?: string;
  capabilityId?: string;
  provider: string;
  amount: number;
}): Promise<CreditReservationHandle | undefined> {
  if (params.context.source !== "database" || params.amount <= 0) return undefined;
  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.creditReservation.findUnique({ where: { requestId: params.requestId } });
      if (existing) return resolveExistingReservation(existing, params);

      const account = await tx.creditAccount.findUnique({ where: { tenantId: params.context.tenantId } });
      if (!account) throw new InsufficientCreditsError();
      const claimed = await tx.creditAccount.updateMany({
        where: { id: account.id, balance: { gte: params.amount } },
        data: { balance: { decrement: params.amount } }
      });
      if (claimed.count !== 1) throw new InsufficientCreditsError();
      const reservation = await tx.creditReservation.create({
        data: {
          creditAccountId: account.id,
          tenantId: params.context.tenantId,
          userId: params.context.userId,
          productCode: params.billing.productCode,
          operatingEntityId: params.billing.operatingEntityId,
          channel: params.billing.channel,
          mcpCredentialId: params.billing.credentialId,
          requestId: params.requestId,
          requestFingerprint: params.requestFingerprint,
          amount: params.amount,
          expiresAt: new Date(Date.now() + 10 * 60_000)
        }
      });
      await tx.creditTransaction.create({
        data: {
          creditAccountId: account.id,
          tenantId: params.context.tenantId,
          userId: params.context.userId,
          direction: "consume",
          amount: params.amount,
          reason: `reservation:${params.billing.productCode}:${params.capabilityId ?? "unknown"}`,
          refType: "credit_reservation",
          refId: reservation.id,
          productCode: params.billing.productCode,
          operatingEntityId: params.billing.operatingEntityId,
          channel: params.billing.channel,
          capabilityId: params.capabilityId,
          mcpCredentialId: params.billing.credentialId,
          provider: params.provider
        }
      });
      return { id: reservation.id, amount: reservation.amount };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await prisma.creditReservation.findUnique({ where: { requestId: params.requestId } });
      if (existing) return resolveExistingReservation(existing, params);
    }
    throw error;
  }
}

export async function releaseCreditReservation(reservationId: string | undefined, errorCode: string): Promise<void> {
  if (!reservationId) return;
  await prisma.$transaction(async (tx) => {
    const reservation = await tx.creditReservation.findUnique({ where: { id: reservationId } });
    if (!reservation || reservation.status !== "reserved") return;
    const claimed = await tx.creditReservation.updateMany({
      where: { id: reservation.id, status: "reserved" },
      data: { status: "released", actualAmount: 0, errorCode }
    });
    if (claimed.count !== 1) return;
    await tx.creditAccount.update({
      where: { id: reservation.creditAccountId },
      data: { balance: { increment: reservation.amount } }
    });
    await tx.creditTransaction.create({
      data: {
        creditAccountId: reservation.creditAccountId,
        tenantId: reservation.tenantId,
        userId: reservation.userId,
        direction: "refund",
        amount: reservation.amount,
        reason: `reservation_release:${errorCode}`,
        refType: "credit_reservation",
        refId: reservation.id,
        productCode: reservation.productCode,
        operatingEntityId: reservation.operatingEntityId,
        channel: reservation.channel,
        mcpCredentialId: reservation.mcpCredentialId
      }
    });
  });
}

export async function settleCreditReservation(params: {
  tx: any;
  reservationId: string;
  actualAmount: number;
  agentRunId: string;
}): Promise<{ balance: number }> {
  const reservation = await params.tx.creditReservation.findUnique({ where: { id: params.reservationId } });
  if (!reservation || reservation.status !== "reserved") throw new IdempotencyConflictError();
  if (params.actualAmount < 0 || params.actualAmount > reservation.amount) throw new Error("billing_actual_cost_out_of_range");
  const releaseAmount = reservation.amount - params.actualAmount;
  if (releaseAmount > 0) {
    await params.tx.creditAccount.update({
      where: { id: reservation.creditAccountId },
      data: { balance: { increment: releaseAmount } }
    });
    await params.tx.creditTransaction.create({
      data: {
        creditAccountId: reservation.creditAccountId,
        tenantId: reservation.tenantId,
        userId: reservation.userId,
        direction: "refund",
        amount: releaseAmount,
        reason: "reservation_settlement_release",
        refType: "agent_run",
        refId: params.agentRunId,
        productCode: reservation.productCode,
        operatingEntityId: reservation.operatingEntityId,
        channel: reservation.channel,
        mcpCredentialId: reservation.mcpCredentialId
      }
    });
  }
  await params.tx.creditReservation.update({
    where: { id: reservation.id },
    data: { status: "settled", actualAmount: params.actualAmount, agentRunId: params.agentRunId }
  });
  return params.tx.creditAccount.findUniqueOrThrow({ where: { id: reservation.creditAccountId }, select: { balance: true } });
}

export async function compensateSettledCreditReservation(params: {
  reservationId: string;
  errorCode: string;
}): Promise<{ compensated: boolean; amount: number }> {
  return prisma.$transaction(async (tx) => {
    const reservation = await tx.creditReservation.findUnique({ where: { id: params.reservationId } });
    if (!reservation) return { compensated: false, amount: 0 };
    if (reservation.status === "compensated") return { compensated: false, amount: reservation.amount };
    if (reservation.status !== "settled") return { compensated: false, amount: 0 };
    const claimed = await tx.creditReservation.updateMany({
      where: { id: reservation.id, status: "settled" },
      data: { status: "compensated", actualAmount: 0, errorCode: params.errorCode }
    });
    if (claimed.count !== 1) return { compensated: false, amount: 0 };
    await tx.creditAccount.update({ where: { id: reservation.creditAccountId }, data: { balance: { increment: reservation.amount } } });
    await tx.creditTransaction.create({
      data: {
        creditAccountId: reservation.creditAccountId,
        tenantId: reservation.tenantId,
        userId: reservation.userId,
        direction: "refund",
        amount: reservation.amount,
        reason: `reservation_compensation:${params.errorCode}`,
        refType: "credit_reservation",
        refId: reservation.id,
        productCode: reservation.productCode,
        operatingEntityId: reservation.operatingEntityId,
        channel: reservation.channel,
        mcpCredentialId: reservation.mcpCredentialId
      }
    });
    return { compensated: true, amount: reservation.amount };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

function resolveExistingReservation(
  existing: {
    id: string;
    tenantId: string;
    productCode: string | null;
    mcpCredentialId: string | null;
    requestFingerprint: string | null;
    status: string;
    amount: number;
  },
  params: {
    context: RequestContext;
    billing: ProductBillingContext;
    requestFingerprint?: string;
  }
): CreditReservationHandle {
  if (
    existing.tenantId !== params.context.tenantId
    || existing.productCode !== params.billing.productCode
    || existing.mcpCredentialId !== (params.billing.credentialId ?? null)
    || (params.requestFingerprint && existing.requestFingerprint && existing.requestFingerprint !== params.requestFingerprint)
  ) throw new IdempotencyConflictError();
  if (existing.status === "reserved") throw new BillingRequestInProgressError();
  if (existing.status === "released") throw new BillingRequestPreviouslyFailedError();
  throw new IdempotencyConflictError();
}

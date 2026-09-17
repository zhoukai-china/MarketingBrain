import { Prisma, prisma } from "@baolu/db";
import type { RequestContext } from "./request-context.js";
import { IdempotencyConflictError, InsufficientCreditsError } from "./chat-persistence.js";
import { consumeWalletCredits, refundWalletCredits, refundWalletInTx } from "./sitong-wallet.js";

/**
 * WorkBuddy / MCP 通道的预留标识前缀（PLAT-46）。
 *
 * 背景：生产上存在两套账本——用户级 `Wallet`（货架、充值、图片/语音解析走它）与租户级
 * `CreditAccount`（`/chat`、`/beauty-industry/*`、外部接入走它）。用户在货架充值的积分只进
 * `Wallet`，而 WorkBuddy MCP 的 `sitong.ask` 读的是租户 `CreditAccount`，于是出现
 * 「钱包里有 490 积分，WorkBuddy 却报 insufficient_credits」。
 *
 * 修法：MCP 通道**优先**扣用户级 `Wallet`（与货架同源，充值立即可用），`Wallet` 不够时
 * 回落到遗留租户 `CreditAccount`（保证老客户既有余额不被作废）。两条路只会扣其中一条。
 * 预留 id 用此前缀编码，`release` / `settle` 靠它把差额退回**当初扣的那个桶**。
 */
const WALLET_RESERVATION_PREFIX = "wallet-reservation:";

export interface ProductBillingContext {
  productCode: string;
  operatingEntityId: string;
  channel: "web" | "mcp";
  credentialId?: string;
}

export interface CreditReservationHandle {
  id: string;
  amount: number;
  /** 走用户级 `Wallet` 时的预留凭据（结算/退款要按它还原 paid/bonus 拆分）。 */
  wallet?: { consumeRef: string; userId: string };
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
  if (params.billing.channel === "mcp") return reserveMcpCredits(params);
  return reserveTenantCredits(params);
}

/**
 * MCP 通道预留：先试用户级 `Wallet`（货架同源），不够再回落到遗留租户 `CreditAccount`。
 * 余额不足在调用 Provider **之前**抛出，不产生任何外发与成本。
 */
async function reserveMcpCredits(params: {
  context: RequestContext;
  billing: ProductBillingContext;
  requestId: string;
  requestFingerprint?: string;
  capabilityId?: string;
  provider: string;
  amount: number;
}): Promise<CreditReservationHandle> {
  const consumeRef = `${WALLET_RESERVATION_PREFIX}${params.requestId}`;
  const consumed = await consumeWalletCredits({
    userId: params.context.userId,
    requestId: consumeRef,
    price: params.amount,
    skillId: params.capabilityId,
    source: "workbuddy",
    accessTokenId: params.billing.credentialId
  });
  if (consumed.status === "completed") {
    // 同一 requestId 的重放：`consumeWalletCredits` 是幂等的（spent 返回 0/0）。
    // 已释放过的预留按遗留口径回报「上次失败」，避免同 id 复跑时二次扣费。
    const released = await prisma.walletLedger.findFirst({
      where: { userId: params.context.userId, refRequestId: `${consumeRef}#release` },
      select: { id: true }
    });
    if (released) throw new BillingRequestPreviouslyFailedError();
    return { id: consumeRef, amount: params.amount, wallet: { consumeRef, userId: params.context.userId } };
  }
  // 钱包不足 → 回落到遗留租户账本（双账本迁移期的兼容路径；两条路只扣一条）。
  return reserveTenantCredits(params);
}

/** 读取某笔钱包预留当初实际扣掉的 paid / bonus 拆分。 */
async function readWalletReservationSpend(
  tx: any,
  consumeRef: string
): Promise<{ userId: string; skillId: string | null; paid: number; bonus: number } | null> {
  const rows = await tx.walletLedger.findMany({
    where: { refRequestId: consumeRef, type: "consume" },
    select: { userId: true, bucket: true, delta: true, skillId: true }
  });
  if (rows.length === 0) return null;
  return {
    userId: rows[0].userId,
    skillId: rows[0].skillId ?? null,
    paid: rows.filter((row: any) => row.bucket === "paid").reduce((sum: number, row: any) => sum - row.delta, 0),
    bonus: rows.filter((row: any) => row.bucket === "bonus").reduce((sum: number, row: any) => sum - row.delta, 0)
  };
}

/** 遗留租户账本预留（`CreditAccount`），MCP 通道在钱包不足时回落使用。 */
async function reserveTenantCredits(params: {
  context: RequestContext;
  billing: ProductBillingContext;
  requestId: string;
  requestFingerprint?: string;
  capabilityId?: string;
  provider: string;
  amount: number;
}): Promise<CreditReservationHandle> {
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
  }).catch(async (error: unknown) => {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await prisma.creditReservation.findUnique({ where: { requestId: params.requestId } });
      if (existing) return resolveExistingReservation(existing, params);
    }
    throw error;
  });
}

export async function releaseCreditReservation(reservationId: string | undefined, errorCode: string): Promise<void> {
  if (!reservationId) return;
  if (reservationId.startsWith(WALLET_RESERVATION_PREFIX)) {
    const spend = await readWalletReservationSpend(prisma, reservationId);
    if (!spend) return;
    // 幂等：退款 requestId 固定为 `<预留id>#release`（不带 errorCode），重复释放不会多退。
    await refundWalletCredits({
      userId: spend.userId,
      requestId: `${reservationId}#release`,
      breakdown: { paid: spend.paid, bonus: spend.bonus },
      skillId: spend.skillId ?? undefined,
      source: "workbuddy",
      reason: `reservation_release_${errorCode}`
    });
    return;
  }
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
  if (params.reservationId.startsWith(WALLET_RESERVATION_PREFIX)) {
    return settleWalletReservation(params);
  }
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

/**
 * 钱包预留的结算：预留额 − 实际额 = 应退差额，退回**当初扣的那个桶**。
 * 与调用方（`persistChatResult`）共用同一个事务，避免「已落库但差额没退」的半成品态。
 */
async function settleWalletReservation(params: {
  tx: any;
  reservationId: string;
  actualAmount: number;
  agentRunId: string;
}): Promise<{ balance: number }> {
  const spend = await readWalletReservationSpend(params.tx, params.reservationId);
  if (!spend) throw new IdempotencyConflictError();
  const reserved = spend.paid + spend.bonus;
  if (params.actualAmount < 0 || params.actualAmount > reserved) throw new Error("billing_actual_cost_out_of_range");
  const refund = reserved - params.actualAmount;
  // 与扣费顺序对称：先退 bonus（更易过期），再退 paid。
  const bonusRefund = Math.min(refund, spend.bonus);
  const paidRefund = refund - bonusRefund;
  const settled = await refundWalletInTx(params.tx, {
    userId: spend.userId,
    requestId: `${params.reservationId}#settle`,
    breakdown: { paid: paidRefund, bonus: bonusRefund },
    skillId: spend.skillId ?? undefined,
    source: "workbuddy",
    reason: `reservation_settlement_${params.agentRunId.slice(0, 12)}`
  });
  return { balance: settled.wallet.balance };
}

export async function compensateSettledCreditReservation(params: {
  reservationId: string;
  errorCode: string;
}): Promise<{ compensated: boolean; amount: number }> {
  if (params.reservationId.startsWith(WALLET_RESERVATION_PREFIX)) {
    const spend = await readWalletReservationSpend(prisma, params.reservationId);
    if (!spend) return { compensated: false, amount: 0 };
    const reserved = spend.paid + spend.bonus;
    const result = await refundWalletCredits({
      userId: spend.userId,
      requestId: `${params.reservationId}#compensate`,
      breakdown: { paid: spend.paid, bonus: spend.bonus },
      skillId: spend.skillId ?? undefined,
      source: "workbuddy",
      reason: `reservation_compensation_${params.errorCode}`
    });
    return { compensated: !result.idempotent, amount: reserved };
  }
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

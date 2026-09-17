/**
 * PLAT-46 红灯回归：WorkBuddy / MCP 通道的积分账本必须与货架同源（用户级 `Wallet`）。
 *
 * 真实生产现象（只读复核，2026-09-17）：用户 `cmtzaheu905e5ef4mzno13ugz`（租户「杨萋萋」）
 * `Wallet.paidBalance = 490`，同租户 `CreditAccount.balance = 0`。用户在货架充值拿到 490 积分，
 * 但 WorkBuddy 调 `sitong.ask` 稳定返回 `insufficient_credits` —— 因为 MCP 通道读的是租户级
 * `CreditAccount`，而充值与货架都只写用户级 `Wallet`。这是 QA-20260910-016 记录的双账本迁移遗留
 * 在**扣费侧**的第二个缺口（那次只补了发币侧）。
 *
 * 本脚本用真实 PostgreSQL（非合成）覆盖：
 *   1. 钱包有余额、租户账本为 0 → MCP 预留必须成功且扣的是钱包（修复前抛 InsufficientCreditsError）；
 *   2. 结算按实际额退款，退回到**当初扣的桶**；账本流水可逐笔核对；
 *   3. 释放（Provider 失败）全额退回，且重复释放幂等；
 *   4. 钱包不足时回落租户账本，保证老客户既有 `CreditAccount` 余额不被作废；
 *   5. 两边都不足 → 在调用 Provider 之前拒绝；
 *   6. 跨用户隔离：改 A 的钱包不动 B。
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { prisma } from "../apps/api/node_modules/@baolu/db/dist/index.js";
import { reserveCreditsBeforeProvider, releaseCreditReservation, settleCreditReservation } from "../apps/api/src/services/credit-reservations.js";
import { InsufficientCreditsError } from "../apps/api/src/services/chat-persistence.js";
import { resolveDatabaseRequestContext } from "../apps/api/src/services/request-context.js";
import { applyRecharge, readWallet } from "../apps/api/src/services/sitong-wallet.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

async function createWorkspace(label: string): Promise<{ tenantId: string; userId: string }> {
  const tenantId = `mwl-t-${randomUUID()}`;
  const userId = `mwl-u-${randomUUID()}`;
  await prisma.tenant.create({ data: { id: tenantId, name: `MCP Wallet Ledger ${label}`, type: "local_business" } });
  await prisma.user.create({ data: { id: userId } });
  await prisma.membership.create({
    data: { id: `mwl-m-${randomUUID()}`, tenantId, userId, role: "owner", isActive: true }
  });
  return { tenantId, userId };
}

/** 只给租户级 `CreditAccount` 记余额，模拟迁移前的既有客户。 */
async function seedTenantLedger(tenantId: string, balance: number): Promise<void> {
  const account = await prisma.creditAccount.create({ data: { tenantId, balance } });
  await prisma.creditTransaction.create({
    data: {
      creditAccountId: account.id,
      tenantId,
      direction: "grant",
      amount: balance,
      reason: "smoke_seed",
      refType: "smoke"
    }
  });
}

const MCP_BILLING = { productCode: null as unknown as string, operatingEntityId: "", channel: "mcp" as const };

async function main(): Promise<void> {
  const main = await createWorkspace("main");
  const other = await createWorkspace("other");
  const fallback = await createWorkspace("fallback");
  const empty = await createWorkspace("empty");

  // 杨萋萋场景：钱包 490（货架充值），租户账本 0。
  await applyRecharge({
    userId: main.userId,
    planId: "smoke_pack",
    amountCny: 24.5,
    basePts: 490,
    bonusPts: 0,
    idempotencyKey: `mwl-recharge-${randomUUID()}`,
    method: "smoke",
    source: "web"
  });
  await seedTenantLedger(main.tenantId, 0);
  await applyRecharge({
    userId: other.userId,
    planId: "smoke_pack",
    amountCny: 50,
    basePts: 1000,
    bonusPts: 0,
    idempotencyKey: `mwl-recharge-${randomUUID()}`,
    method: "smoke",
    source: "web"
  });
  await seedTenantLedger(fallback.tenantId, 100);
  await seedTenantLedger(empty.tenantId, 0);

  const mainContext = await resolveDatabaseRequestContext(main.tenantId, main.userId);
  const fallbackContext = await resolveDatabaseRequestContext(fallback.tenantId, fallback.userId);
  const emptyContext = await resolveDatabaseRequestContext(empty.tenantId, empty.userId);

  // ① 钱包有余额 + 租户账本 0 → MCP 预留必须走通（修复前在这里抛 insufficient_credits）。
  const reserveRequestId = `workbuddy:mwl:${randomUUID()}`;
  const reservation = await reserveCreditsBeforeProvider({
    context: mainContext,
    billing: MCP_BILLING,
    requestId: reserveRequestId,
    capabilityId: "growth_content_plan",
    provider: "smoke",
    amount: 30
  });
  assert(reservation, "MCP reservation is created when the wallet has credits");
  assert(
    reservation.id.startsWith("wallet-reservation:"),
    `MCP reservation bills the user wallet (got id ${reservation.id})`
  );
  const afterReserve = await readWallet(main.userId);
  assert(afterReserve.paidBalance === 460, `reserve moves 30 out of paid bucket (got ${afterReserve.paidBalance})`);

  // ② 结算：实际只花 12 → 差额 18 退回同一个桶，余额 = 490 - 12。
  await prisma.$transaction(async (tx) => {
    await settleCreditReservation({ tx, reservationId: reservation.id, actualAmount: 12, agentRunId: `mwl-run-${randomUUID()}` });
  });
  const afterSettle = await readWallet(main.userId);
  assert(afterSettle.paidBalance === 478, `settlement refunds the difference into the original bucket (got ${afterSettle.paidBalance})`);
  const settleLedgers = await prisma.walletLedger.findMany({
    where: { userId: main.userId, refRequestId: { startsWith: `wallet-reservation:${reserveRequestId}` } },
    orderBy: { createdAt: "asc" },
    select: { type: true, bucket: true, delta: true }
  });
  assert(settleLedgers.length === 2, `settlement writes exactly consume + refund rows (got ${settleLedgers.length})`);
  assert(settleLedgers[0].type === "consume" && settleLedgers[0].delta === -30, "consume ledger records the reserved 30");
  assert(settleLedgers[1].type === "refund" && settleLedgers[1].delta === 18, "refund ledger records the 18 difference");
  assert(
    await prisma.creditReservation.count({ where: { tenantId: main.tenantId } }) === 0,
    "wallet-backed MCP reservations do not write the legacy CreditReservation table"
  );

  // ③ 释放（Provider 失败）：全额退回，且重复释放幂等。
  const releaseRequestId = `workbuddy:mwl:${randomUUID()}`;
  const released = await reserveCreditsBeforeProvider({
    context: mainContext,
    billing: MCP_BILLING,
    requestId: releaseRequestId,
    capabilityId: "growth_content_plan",
    provider: "smoke",
    amount: 20
  });
  assert(released, "second MCP reservation is created");
  const duringRelease = await readWallet(main.userId);
  assert(duringRelease.paidBalance === 458, `second reservation holds 20 (got ${duringRelease.paidBalance})`);
  await releaseCreditReservation(released.id, "provider_failed");
  const afterRelease = await readWallet(main.userId);
  assert(afterRelease.paidBalance === 478, `release refunds the full reservation (got ${afterRelease.paidBalance})`);
  await releaseCreditReservation(released.id, "provider_failed");
  assert(
    (await readWallet(main.userId)).paidBalance === 478,
    "releasing the same reservation twice never double-refunds"
  );

  // ④ 钱包不足 → 回落遗留租户账本，老客户既有余额不作废。
  const fallbackReservation = await reserveCreditsBeforeProvider({
    context: fallbackContext,
    billing: MCP_BILLING,
    requestId: `workbuddy:mwl:${randomUUID()}`,
    capabilityId: "growth_content_plan",
    provider: "smoke",
    amount: 30
  });
  assert(fallbackReservation, "wallet-empty tenant still reserves against the legacy ledger");
  assert(!fallbackReservation.id.startsWith("wallet-reservation:"), "fallback reservation uses the legacy CreditReservation id");
  const fallbackAccount = await prisma.creditAccount.findUniqueOrThrow({ where: { tenantId: fallback.tenantId }, select: { balance: true } });
  assert(fallbackAccount.balance === 70, `fallback debits the tenant ledger (got ${fallbackAccount.balance})`);

  // ⑤ 两边都不足 → 调用 Provider 之前就拒绝。
  let rejected: unknown = null;
  try {
    await reserveCreditsBeforeProvider({
      context: emptyContext,
      billing: MCP_BILLING,
      requestId: `workbuddy:mwl:${randomUUID()}`,
      capabilityId: "growth_content_plan",
      provider: "smoke",
      amount: 30
    });
  } catch (error) {
    rejected = error;
  }
  assert(rejected instanceof InsufficientCreditsError, "empty wallet + empty legacy ledger is rejected as insufficient_credits");
  assert(
    (await prisma.walletLedger.count({ where: { userId: empty.userId, type: { not: "bonus" } } })) === 0,
    "a rejected MCP call writes no wallet ledger for the empty tenant"
  );

  // ⑥ 跨用户隔离：主用户消耗不影响另一个用户。
  const otherWallet = await readWallet(other.userId);
  assert(otherWallet.paidBalance === 1000, `other user wallet untouched (got ${otherWallet.paidBalance})`);

  console.log("mcp_wallet_ledger_smoke: PASS");
  console.log(JSON.stringify({
    mainWalletAfterSettle: afterSettle.paidBalance,
    mainWalletAfterRelease: afterRelease.paidBalance,
    fallbackTenantBalance: fallbackAccount.balance,
    settleLedgers
  }));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

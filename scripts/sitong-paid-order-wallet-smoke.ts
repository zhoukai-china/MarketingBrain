import "dotenv/config";
import { randomUUID } from "node:crypto";
import { prisma } from "../apps/api/node_modules/@baolu/db/dist/index.js";
import { applyPaidOrder } from "../apps/api/src/services/billing-effects.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

async function main(): Promise<void> {
  const tenantId = `e3-${randomUUID()}`;
  const userId = `e3-user-${randomUUID()}`;
  const orderId = `e3-order-${randomUUID()}`;

  await prisma.tenant.create({
    data: { id: tenantId, name: "E3 Paid Order Wallet Smoke Tenant", type: "local_business" }
  });
  await prisma.user.create({ data: { id: userId } });
  await prisma.membership.create({
    data: { id: `e3-mem-${randomUUID()}`, tenantId, userId, role: "owner", isActive: true }
  });

  const expiresAt = new Date(Date.now() + 30 * 86_400_000);
  await prisma.billingOrder.create({
    data: {
      id: orderId,
      tenantId,
      userId,
      type: "credit_pack",
      creditPackCode: "pack_100",
      amountCny: 100,
      credits: 2200,
      provider: "wechat_pay",
      codeUrl: "weixin://wxpay/mock/e3",
      expiresAt,
      status: "pending"
    }
  });

  try {
    const paid = await applyPaidOrder(orderId);
    assert(paid.status === "paid", "order is marked paid");

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId } });
    assert(wallet.paidBalance === 2000, "paid bucket gets base 2000");
    assert(wallet.bonusBalance === 200, "bonus bucket gets bonus 200");

    const rechargeOrder = await prisma.rechargeOrder.findFirstOrThrow({
      where: { userId, idempotencyKey: `billing:${orderId}` }
    });
    assert(rechargeOrder.basePts === 2000 && rechargeOrder.bonusPts === 200 && rechargeOrder.amountCny === 100, "recharge order records base/bonus");

    const ledgers = await prisma.walletLedger.findMany({
      where: { userId, refOrderId: rechargeOrder.id },
      orderBy: { createdAt: "asc" }
    });
    assert(ledgers.length === 2, "one paid recharge writes two ledger rows");
    assert(ledgers[0].bucket === "paid" && ledgers[0].type === "recharge" && ledgers[0].delta === 2000, "paid ledger row correct");
    assert(ledgers[1].bucket === "bonus" && ledgers[1].type === "bonus" && ledgers[1].delta === 200, "bonus ledger row correct");

    const again = await applyPaidOrder(orderId);
    assert(again.id === orderId, "second apply returns same order");
    const walletAfter = await prisma.wallet.findUniqueOrThrow({ where: { userId } });
    assert(walletAfter.paidBalance === 2000 && walletAfter.bonusBalance === 200, "duplicate callback does not credit twice");
    const ledgerCountAfter = await prisma.walletLedger.count({ where: { userId, refOrderId: rechargeOrder.id } });
    assert(ledgerCountAfter === 2, "duplicate callback does not add ledger rows");

    console.log("PASS sitong-paid-order-wallet-smoke");
  } finally {
    await prisma.billingOrder.deleteMany({ where: { id: orderId } });
    await prisma.membership.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

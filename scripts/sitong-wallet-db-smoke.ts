import "dotenv/config";
import { randomUUID } from "node:crypto";
import Fastify from "../apps/api/node_modules/fastify/fastify.js";
import { prisma } from "../apps/api/node_modules/@baolu/db/dist/index.js";
import { registerBillingAccessTokenRoutes } from "../apps/api/src/routes/billing-access-tokens.js";
import { registerBillingConsumeRoutes } from "../apps/api/src/routes/billing-consume.js";
import { applyRecharge, consumeWalletCredits } from "../apps/api/src/services/sitong-wallet.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

async function main(): Promise<void> {
  const tenantId = `wlt-${randomUUID()}`;
  const userId = `wlt-user-${randomUUID()}`;

  await prisma.tenant.create({
    data: { id: tenantId, name: "Sitong Wallet Double Bucket Smoke Tenant", type: "local_business" }
  });
  await prisma.user.create({ data: { id: userId } });
  await prisma.membership.create({
    data: { id: `wlt-mem-${randomUUID()}`, tenantId, userId, role: "owner", isActive: true }
  });

  const app = Fastify();
  await registerBillingAccessTokenRoutes(app);
  await registerBillingConsumeRoutes(app);

  const sessionHeaders = {
    "x-sitong-tenant-id": tenantId,
    "x-sitong-user-id": userId,
    "content-type": "application/json"
  };

  try {
    const created = await app.inject({
      method: "POST",
      url: "/billing/access-tokens",
      headers: sessionHeaders,
      payload: { label: "wallet smoke", expiresInDays: 30 }
    });
    assert(created.statusCode === 201, "access token created");
    const createdBody = created.json() as { token: string };
    const tokenHeaders = {
      authorization: `Bearer ${createdBody.token}`,
      "content-type": "application/json"
    };

    // 1) 充值 pack_100：base 2000 → paid，bonus 200 → bonus，写两条 ledger
    const rechargeKey = `recharge-${randomUUID()}`;
    const recharge = await applyRecharge({
      userId,
      planId: "pack_100",
      amountCny: 100,
      basePts: 2000,
      bonusPts: 200,
      idempotencyKey: rechargeKey,
      source: "web"
    });
    assert(recharge.wallet.paidBalance === 2000, "paid bucket gets base 2000");
    assert(recharge.wallet.bonusBalance === 200, "bonus bucket gets bonus 200");

    const reApply = await applyRecharge({
      userId,
      planId: "pack_100",
      amountCny: 100,
      basePts: 2000,
      bonusPts: 200,
      idempotencyKey: rechargeKey,
      source: "web"
    });
    assert(reApply.idempotent === true && reApply.wallet.paidBalance === 2000, "duplicate recharge is idempotent");

    const orderLedgers = await prisma.walletLedger.count({
      where: { userId, refOrderId: recharge.orderId }
    });
    assert(orderLedgers === 2, "one recharge writes two ledger rows (paid + bonus)");

    // 2) GET /wallet 分桶返回
    const walletRes = await app.inject({ method: "GET", url: "/wallet", headers: sessionHeaders });
    assert(walletRes.statusCode === 200, "GET /wallet returns 200");
    const walletBody = walletRes.json() as { paidBalance: number; bonusBalance: number; balance: number };
    assert(walletBody.paidBalance === 2000 && walletBody.bonusBalance === 200 && walletBody.balance === 2200, "wallet returns split buckets");

    // 3) precheck：服务端定价 ip-pos = 200
    const precheck = await app.inject({
      method: "POST",
      url: "/billing/precheck",
      headers: tokenHeaders,
      payload: { skill: "meiye__ip-pos" }
    });
    assert(precheck.statusCode === 200, "precheck returns 200");
    const precheckBody = precheck.json() as { allowed: boolean; price: number; balance: number };
    assert(precheckBody.allowed === true && precheckBody.price === 200 && precheckBody.balance === 2200, "precheck uses server price");

    // 4) consume moments 20：先扣 paid
    const consume = await app.inject({
      method: "POST",
      url: "/billing/consume",
      headers: tokenHeaders,
      payload: { skill: "ipzone__moments", requestId: "req-wallet-00000001" }
    });
    assert(consume.statusCode === 200, "consume returns 200");
    const consumeBody = consume.json() as { status: string; paidBalance: number; bonusBalance: number; spent: { paid: number; bonus: number }; price: number };
    assert(consumeBody.status === "completed" && consumeBody.price === 20, "consume server price 20");
    assert(consumeBody.paidBalance === 1980 && consumeBody.bonusBalance === 200, "consume deducts paid first");
    assert(consumeBody.spent.paid === 20 && consumeBody.spent.bonus === 0, "single-bucket spend tracked");

    const repeat = await app.inject({
      method: "POST",
      url: "/billing/consume",
      headers: tokenHeaders,
      payload: { skill: "ipzone__moments", requestId: "req-wallet-00000001" }
    });
    const repeatBody = repeat.json() as { idempotent: boolean; paidBalance: number };
    assert(repeatBody.idempotent === true && repeatBody.paidBalance === 1980, "same request_id does not charge twice");

    // 5) 人为把 paid 压到 10、bonus 保持 300，消费 40 应跨桶：paid 10 + bonus 30
    const walletRow = await prisma.wallet.findUniqueOrThrow({ where: { userId } });
    await prisma.wallet.update({
      where: { id: walletRow.id },
      data: { paidBalance: 10, bonusBalance: 300 }
    });
    const cross = await consumeWalletCredits({
      userId,
      requestId: "req-wallet-cross-0001",
      price: 40,
      skillId: "meiye__topic",
      source: "workbuddy"
    });
    assert(cross.status === "completed", "cross-bucket consume completes");
    if (cross.status === "completed") {
      assert(cross.spent.paid === 10 && cross.spent.bonus === 30, "paid drained before bonus");
      assert(cross.wallet.paidBalance === 0 && cross.wallet.bonusBalance === 270, "cross-bucket balances correct");
    }
    const crossLedgers = await prisma.walletLedger.findMany({
      where: { userId, refRequestId: "req-wallet-cross-0001", type: "consume" },
      orderBy: { bucket: "asc" },
      select: { bucket: true, delta: true }
    });
    assert(crossLedgers.length === 2, "cross-bucket consume writes two ledger rows");
    assert(crossLedgers[0].bucket === "paid" && crossLedgers[0].delta === -10, "paid ledger row correct");
    assert(crossLedgers[1].bucket === "bonus" && crossLedgers[1].delta === -30, "bonus ledger row correct");

    // 6) 余额不足返回 402 + 充值链接
    await prisma.wallet.update({
      where: { id: walletRow.id },
      data: { paidBalance: 0, bonusBalance: 10 }
    });
    const insufficient = await app.inject({
      method: "POST",
      url: "/billing/consume",
      headers: tokenHeaders,
      payload: { skill: "ipzone__sales", requestId: "req-wallet-insufficient" }
    });
    assert(insufficient.statusCode === 402, "insufficient returns 402");
    const insuffBody = insufficient.json() as { rechargeUrl: string; required: number };
    assert(insuffBody.required === 60 && insuffBody.rechargeUrl.includes("/recharge"), "402 carries recharge URL");

    // 7) 免费重做限 1 次
    const redo1 = await app.inject({
      method: "POST",
      url: "/billing/redo",
      headers: tokenHeaders,
      payload: { skill: "ipzone__moments", requestId: "req-wallet-00000001" }
    });
    assert(redo1.statusCode === 200 && (redo1.json() as { ok: boolean }).ok === true, "first redo allowed");
    const redo2 = await app.inject({
      method: "POST",
      url: "/billing/redo",
      headers: tokenHeaders,
      payload: { skill: "ipzone__moments", requestId: "req-wallet-00000001" }
    });
    assert((redo2.json() as { ok: boolean }).ok === false, "second redo rejected");

    console.log("PASS sitong-wallet-db-smoke");
  } finally {
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

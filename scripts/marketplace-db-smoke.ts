import "dotenv/config";
import { randomUUID } from "node:crypto";
import Fastify from "../apps/api/node_modules/fastify/fastify.js";
import { prisma } from "../apps/api/node_modules/@baolu/db/dist/index.js";
import { registerMarketplaceRoutes } from "../apps/api/src/routes/marketplace.js";
import { ensureMarketplaceCatalog } from "../apps/api/src/services/marketplace-catalog.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

async function main(): Promise<void> {
  const tenantId = `mp-db-${randomUUID()}`;
  const userId = `mp-user-${randomUUID()}`;
  const membershipId = `mp-mem-${randomUUID()}`;
  const initialBalance = 300;

  await ensureMarketplaceCatalog();
  await prisma.tenant.create({
    data: { id: tenantId, name: "Marketplace DB Smoke Tenant", type: "local_business" }
  });
  await prisma.user.create({ data: { id: userId } });
  await prisma.membership.create({
    data: {
      id: membershipId,
      tenantId,
      userId,
      role: "owner",
      isActive: true
    }
  });
  // 统一钱包（迁移 202609090004_sitong_wallet_double_bucket）：/market/me 展示的余额
  // 与 /market/ppu/consume 实际扣减的余额必须是同一个用户双桶钱包。
  await prisma.wallet.create({
    data: { userId, paidBalance: initialBalance }
  });

  const app = Fastify();
  await registerMarketplaceRoutes(app);
  // registerMarketplaceRoutes 会按目录种子重建 SKU，价格必须在注册后再固定，否则会被种子重置。
  await prisma.marketplaceSku.update({
    where: { skuCode: "ipzone__ip-pos" },
    data: { ppu: 5, status: "selling" }
  });
  await prisma.marketplaceSku.update({
    where: { skuCode: "ipzone__topic" },
    data: { subscriptionPriceCny: 99, subscriptionQuota: "包月不限次", status: "selling" }
  });

  const headers = {
    "x-sitong-tenant-id": tenantId,
    "x-sitong-user-id": userId
  };

  try {
    const search = await app.inject({ method: "GET", url: "/market/skus?q=%E5%88%9B%E5%A7%8B%E4%BA%BAIP" });
    assert(search.statusCode === 200, "GET /market/skus returns 200 in database mode");
    const searchBody = search.json() as { skus: Array<{ skuCode: string }> };
    assert(searchBody.skus.some((sku) => sku.skuCode === "ipzone__ip-pos"), "database search finds ip-pos");

    const me = await app.inject({ method: "GET", url: "/market/me", headers });
    assert(me.statusCode === 200, "GET /market/me returns 200");
    const meBody = me.json() as { creditBalance: number };
    assert(meBody.creditBalance === initialBalance, `database unified wallet starts at ${initialBalance}`);

    const consume = await app.inject({
      method: "POST",
      url: "/market/ppu/consume",
      headers: { ...headers, "content-type": "application/json" },
      payload: { skuId: "ipzone__ip-pos", idempotencyKey: "db-ppu-key-1" }
    });
    assert(consume.statusCode === 200, "POST /market/ppu/consume returns 200");
    const consumeBody = consume.json() as { state: string; balance: number };
    assert(consumeBody.state === "completed", "database ppu consume completes");
    assert(
      consumeBody.balance === initialBalance - 5,
      `database ppu consume deducts the displayed wallet (expected ${initialBalance - 5}, got ${consumeBody.balance})`
    );
    const meAfterConsume = await app.inject({ method: "GET", url: "/market/me", headers });
    const meAfterConsumeBody = meAfterConsume.json() as { creditBalance: number };
    assert(
      meAfterConsumeBody.creditBalance === initialBalance - 5,
      "the wallet shown by /market/me is the same wallet charged by /market/ppu/consume"
    );

    const repeat = await app.inject({
      method: "POST",
      url: "/market/ppu/consume",
      headers: { ...headers, "content-type": "application/json" },
      payload: { skuId: "ipzone__ip-pos", idempotencyKey: "db-ppu-key-1" }
    });
    const repeatBody = repeat.json() as { idempotent: boolean };
    assert(repeatBody.idempotent === true, "database ppu consume is idempotent");

    const sub = await app.inject({
      method: "POST",
      url: "/market/subscriptions",
      headers: { ...headers, "content-type": "application/json" },
      payload: { skuId: "ipzone__topic" }
    });
    assert(sub.statusCode === 200, "POST /market/subscriptions returns 200");
    const subBody = sub.json() as { order: { id: string } };

    const pay = await app.inject({
      method: "POST",
      url: `/market/subscriptions/${encodeURIComponent(subBody.order.id)}/mock-pay`,
      headers
    });
    assert(pay.statusCode === 200, "POST mock-pay returns 200");
    const payBody = pay.json() as { applied: boolean; subscription: { status: string } };
    assert(payBody.applied === true && payBody.subscription.status === "active", "database subscription becomes active");

    const overview = await app.inject({ method: "GET", url: "/market/admin/overview", headers });
    assert(overview.statusCode === 200, "owner can read marketplace admin overview in database mode");

    const patch = await app.inject({
      method: "PATCH",
      url: "/market/admin/skus/ipzone__ip-pos",
      headers: { ...headers, "content-type": "application/json" },
      payload: { ppu: 6, status: "selling" }
    });
    assert(patch.statusCode === 200, "owner can patch marketplace sku in database mode");
    const patched = patch.json() as { sku: { ppu: number } };
    assert(patched.sku.ppu === 6, "database sku patch applies");
  } finally {
    await app.close();
    // 重新按目录种子写回，避免测试改动污染货架数据。
    await ensureMarketplaceCatalog();
    await prisma.marketplaceLedgerEntry.deleteMany({ where: { tenantId } });
    await prisma.marketplaceSubscription.deleteMany({ where: { tenantId } });
    await prisma.marketplaceSubscriptionOrder.deleteMany({ where: { tenantId } });
    await prisma.marketplaceSkuEntitlement.deleteMany({ where: { tenantId } });
    await prisma.creditTransaction.deleteMany({ where: { tenantId } });
    await prisma.creditAccount.deleteMany({ where: { tenantId } });
    await prisma.walletLedger.deleteMany({ where: { userId } });
    await prisma.wallet.deleteMany({ where: { userId } });
    await prisma.membership.deleteMany({ where: { tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } });
    await prisma.user.delete({ where: { id: userId } });
  }

  console.log("PASS marketplace-db-smoke");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

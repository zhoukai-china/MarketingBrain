import "dotenv/config";
import { randomUUID } from "node:crypto";
import Fastify from "../apps/api/node_modules/fastify/fastify.js";
import { prisma } from "../apps/api/node_modules/@baolu/db/dist/index.js";
import { registerBillingRoutes } from "../apps/api/src/routes/billing.js";
import { sessionHeaders } from "./lib/db-session-headers.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

async function main(): Promise<void> {
  const tenantId = `po-${randomUUID()}`;
  const userId = `po-user-${randomUUID()}`;

  await prisma.tenant.create({
    data: { id: tenantId, name: "Billing Paid Order Smoke Tenant", type: "local_business" }
  });
  await prisma.user.create({ data: { id: userId } });
  await prisma.membership.create({
    data: { id: `po-mem-${randomUUID()}`, tenantId, userId, role: "owner", isActive: true }
  });
  await prisma.creditAccount.create({
    data: { id: `po-credit-${randomUUID()}`, tenantId, balance: 0 }
  });

  const app = Fastify();
  await registerBillingRoutes(app);

  const headers = sessionHeaders(tenantId, userId, { "content-type": "application/json" });

  try {
    const create = await app.inject({
      method: "POST",
      url: "/billing/orders",
      headers,
      payload: { type: "credit_pack", creditPackCode: "pack_50" }
    });
    assert(create.statusCode === 200, "credit pack order can be created");
    const order = (create.json() as { order: { id: string } }).order;

    const first = await app.inject({
      method: "POST",
      url: `/billing/orders/${order.id}/mock-pay`,
      headers: sessionHeaders(tenantId, userId)
    });
    assert(first.statusCode === 200, `mock pay succeeds (status ${first.statusCode}, body ${first.body})`);
    const firstBody = first.json() as { applied: boolean };
    assert(firstBody.applied === true, "mock pay is applied");

    const second = await app.inject({
      method: "POST",
      url: `/billing/orders/${order.id}/mock-pay`,
      headers: sessionHeaders(tenantId, userId)
    });
    assert(second.statusCode === 200, "repeated mock pay is accepted");
    const secondBody = second.json() as { applied: boolean };
    assert(secondBody.applied === true, "repeated mock pay stays applied");

    const account = await prisma.creditAccount.findUnique({ where: { tenantId } });
    assert(account?.balance === 300, "credit pack credits are granted exactly once");

    const grants = await prisma.creditTransaction.count({
      where: { tenantId, refType: "billing_order", refId: order.id, direction: "grant" }
    });
    assert(grants === 1, "credit pack grant ledger has exactly one entry");

    const subscriptions = await prisma.subscription.count({ where: { tenantId } });
    assert(subscriptions === 0, "credit pack payment does not create a subscription");
  } finally {
    await app.close();
    await prisma.billingOrder.deleteMany({ where: { tenantId } });
    await prisma.creditTransaction.deleteMany({ where: { tenantId } });
    await prisma.creditAccount.deleteMany({ where: { tenantId } });
    await prisma.membership.deleteMany({ where: { tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } });
    await prisma.user.delete({ where: { id: userId } });
  }

  console.log("PASS billing-paid-order-db-smoke");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

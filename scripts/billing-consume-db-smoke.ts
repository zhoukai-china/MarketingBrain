import "dotenv/config";
import { randomUUID } from "node:crypto";
import Fastify from "../apps/api/node_modules/fastify/fastify.js";
import { prisma } from "../apps/api/node_modules/@baolu/db/dist/index.js";
import { registerBillingAccessTokenRoutes } from "../apps/api/src/routes/billing-access-tokens.js";
import { registerBillingConsumeRoutes } from "../apps/api/src/routes/billing-consume.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

async function main(): Promise<void> {
  const tenantId = `bat-${randomUUID()}`;
  const userId = `bat-user-${randomUUID()}`;

  await prisma.tenant.create({
    data: { id: tenantId, name: "Billing Access Token Smoke Tenant", type: "local_business" }
  });
  await prisma.user.create({ data: { id: userId } });
  await prisma.membership.create({
    data: { id: `bat-mem-${randomUUID()}`, tenantId, userId, role: "owner", isActive: true }
  });
  await prisma.creditAccount.create({
    data: { id: `bat-credit-${randomUUID()}`, tenantId, balance: 300 }
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
      payload: { label: "WorkBuddy billing smoke", expiresInDays: 30 }
    });
    assert(created.statusCode === 201, "billing access token can be created");
    const createdBody = created.json() as { token: string; accessToken: { id: string; tokenPrefix: string } };
    assert(createdBody.token.startsWith("sitong_bat_"), "billing access token has expected prefix");
    assert(createdBody.accessToken.tokenPrefix.endsWith("…"), "billing access token is masked in list payload");

    const tokenHeaders = {
      authorization: `Bearer ${createdBody.token}`,
      "content-type": "application/json"
    };

    const precheck = await app.inject({
      method: "POST",
      url: "/billing/precheck",
      headers: tokenHeaders,
      payload: { amount: 100, skill: "beauty_business_qa" }
    });
    assert(precheck.statusCode === 200, "precheck returns 200");
    const precheckBody = precheck.json() as { ok: boolean; balance: number };
    assert(precheckBody.ok === true && precheckBody.balance === 300, "precheck reads unified wallet");

    const consume = await app.inject({
      method: "POST",
      url: "/billing/consume",
      headers: tokenHeaders,
      payload: { requestId: "req-00000001", amount: 100, skill: "beauty_business_qa" }
    });
    assert(consume.statusCode === 200, "consume returns 200");
    const consumeBody = consume.json() as { status: string; idempotent: boolean; balance: number };
    assert(consumeBody.status === "completed" && consumeBody.balance === 200, "consume deducts wallet atomically");
    assert(consumeBody.idempotent === false, "first consume is not idempotent");

    const repeat = await app.inject({
      method: "POST",
      url: "/billing/consume",
      headers: tokenHeaders,
      payload: { requestId: "req-00000001", amount: 100, skill: "beauty_business_qa" }
    });
    assert(repeat.statusCode === 200, "replayed consume returns 200");
    const repeatBody = repeat.json() as { idempotent: boolean; balance: number };
    assert(repeatBody.idempotent === true && repeatBody.balance === 200, "replayed consume is idempotent and does not double-deduct");

    const insufficient = await app.inject({
      method: "POST",
      url: "/billing/consume",
      headers: tokenHeaders,
      payload: { requestId: "req-00000002", amount: 500, skill: "takeaway_growth" }
    });
    assert(insufficient.statusCode === 402, "insufficient consume returns 402");
    const insufficientBody = insufficient.json() as { error: string; rechargeUrl: string; balance: number };
    assert(insufficientBody.error === "insufficient_credits", "insufficient consume returns error code");
    assert(
      insufficientBody.rechargeUrl === "/recharge?from=workbuddy&skill=takeaway_growth",
      "insufficient consume returns workbuddy recharge link with skill"
    );
    assert(insufficientBody.balance === 200, "insufficient consume does not change balance");

    const rotate = await app.inject({
      method: "POST",
      url: `/billing/access-tokens/${createdBody.accessToken.id}/rotate`,
      headers: {
        "x-sitong-tenant-id": tenantId,
        "x-sitong-user-id": userId
      }
    });
    assert(rotate.statusCode === 201, `billing access token rotates (status ${rotate.statusCode}, body ${rotate.body})`);
    const rotated = rotate.json() as { token: string };
    const rotatedPrecheck = await app.inject({
      method: "POST",
      url: "/billing/precheck",
      headers: { authorization: `Bearer ${rotated.token}`, "content-type": "application/json" },
      payload: { amount: 1 }
    });
    assert(rotatedPrecheck.statusCode === 200, "rotated token is valid");

    const oldTokenPrecheck = await app.inject({
      method: "POST",
      url: "/billing/precheck",
      headers: tokenHeaders,
      payload: { amount: 1 }
    });
    assert(oldTokenPrecheck.statusCode === 401, "old token is invalid after rotation");
  } finally {
    await app.close();
    await prisma.billingConsume.deleteMany({ where: { tenantId } });
    await prisma.billingAccessToken.deleteMany({ where: { tenantId } });
    await prisma.creditTransaction.deleteMany({ where: { tenantId } });
    await prisma.creditAccount.deleteMany({ where: { tenantId } });
    await prisma.membership.deleteMany({ where: { tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } });
    await prisma.user.delete({ where: { id: userId } });
  }

  console.log("PASS billing-consume-db-smoke");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

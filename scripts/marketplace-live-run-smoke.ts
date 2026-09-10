import "dotenv/config";
process.env.SKILL_MCP_REQUIRED = "false";
import { randomUUID } from "node:crypto";
import Fastify from "../apps/api/node_modules/fastify/fastify.js";
import { prisma } from "../apps/api/node_modules/@baolu/db/dist/index.js";
import { registerMarketplaceRoutes } from "../apps/api/src/routes/marketplace.js";
import { ensureMarketplaceCatalog } from "../apps/api/src/services/marketplace-catalog.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

async function main(): Promise<void> {
  const tenantId = `mp-live-${randomUUID()}`;
  const userId = `mp-live-user-${randomUUID()}`;
  const membershipId = `mp-live-mem-${randomUUID()}`;
  const creditAccountId = `mp-live-credit-${randomUUID()}`;

  await ensureMarketplaceCatalog();
  await prisma.marketplaceSku.update({
    where: { skuCode: "ipzone__moments" },
    data: { ppu: 3, status: "selling" }
  });
  await prisma.tenant.create({
    data: { id: tenantId, name: "Marketplace Live Smoke Tenant", type: "local_business" }
  });
  await prisma.user.create({ data: { id: userId } });
  await prisma.membership.create({
    data: { id: membershipId, tenantId, userId, role: "owner", isActive: true }
  });
  await prisma.creditAccount.create({
    data: { id: creditAccountId, tenantId, balance: 1500 }
  });

  const app = Fastify();
  await registerMarketplaceRoutes(app);

  try {
    const headers = {
      "x-sitong-tenant-id": tenantId,
      "x-sitong-user-id": userId
    };
    const run = await app.inject({
      method: "POST",
      url: "/market/skus/ipzone__moments/run",
      headers: { ...headers, "content-type": "application/json" },
      payload: {
        input:
          "写一条朋友圈文案：我是餐饮老板，刚帮客户做完门店经营诊断，想发一条有信任感的朋友圈，不硬广，末尾软引导私聊。"
      }
    });
    if (run.statusCode !== 200) {
      console.log("RUN_RESPONSE", run.statusCode, run.body);
    }
    assert(run.statusCode === 200, "live marketplace run returns 200");
    const body = run.json() as {
      state: string;
      answer: string;
      consumedCredits: number;
      estimatedCredits: number;
      modelCostCny: number;
      balance: number;
    };
    assert(body.state === "completed", "live marketplace run completes");
    assert(body.consumedCredits > 0, "live marketplace run charges positive credits");
    assert(body.balance === 1500 - body.consumedCredits, "live marketplace run settles wallet balance");
    console.log("ANSWER_PREVIEW", body.answer.slice(0, 800));
    assert(body.answer.length > 40, "live marketplace run returns a substantive answer");

    const ledger = await prisma.marketplaceLedgerEntry.findMany({ where: { tenantId } });
    assert(ledger.length === 1, "live marketplace run writes one ledger entry");

    console.log(
      JSON.stringify({
        state: body.state,
        estimatedCredits: body.estimatedCredits,
        consumedCredits: body.consumedCredits,
        modelCostCny: body.modelCostCny,
        balance: body.balance,
        answerChars: body.answer.length,
        answerPreview: body.answer.slice(0, 120)
      })
    );
    console.log("PASS marketplace-live-run-smoke");
  } finally {
    await app.close();
    await prisma.marketplaceSku.update({
      where: { skuCode: "ipzone__moments" },
      data: { ppu: 3, status: "selling" }
    });
    await prisma.marketplaceLedgerEntry.deleteMany({ where: { tenantId } });
    await prisma.creditReservation.deleteMany({ where: { tenantId } });
    await prisma.creditTransaction.deleteMany({ where: { tenantId } });
    await prisma.creditAccount.deleteMany({ where: { tenantId } });
    await prisma.membership.deleteMany({ where: { tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } });
    await prisma.user.delete({ where: { id: userId } });
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});

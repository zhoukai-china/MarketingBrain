#!/usr/bin/env node
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const requireFromDb = createRequire(new URL("../packages/db/package.json", import.meta.url));
const { PrismaClient } = requireFromDb("@prisma/client");
const prisma = new PrismaClient();
const expectedStatus = process.env.BY17_LIVE_EXPECTED_STATUS ?? "passed";

try {
  const tenant = await prisma.tenant.findFirst({
    where: { name: "BY17 Synthetic Empty Profile", createdAt: { gt: new Date(Date.now() - 3_600_000) } },
    orderBy: { createdAt: "desc" },
    select: { id: true }
  });
  assert.ok(tenant, "BY17 synthetic live tenant not found");
  const [profiles, runs, reservations, transactions, connections, productEntitlements, agentEntitlements, account] = await Promise.all([
    prisma.tenantProfile.findMany({ where: { tenantId: tenant.id }, select: { data: true, confirmedData: true } }),
    prisma.agentRun.findMany({ where: { tenantId: tenant.id }, select: { status: true, capabilityId: true, skillId: true } }),
    prisma.creditReservation.findMany({ where: { tenantId: tenant.id }, select: { status: true, amount: true, actualAmount: true, errorCode: true } }),
    prisma.creditTransaction.findMany({ where: { tenantId: tenant.id }, select: { direction: true, amount: true, productCode: true, reason: true } }),
    prisma.workbuddyMcpConnection.findMany({ where: { tenantId: tenant.id }, select: { status: true, revokedAt: true, tokenHash: true, tokenPrefix: true } }),
    prisma.tenantProductEntitlement.findMany({ where: { tenantId: tenant.id }, select: { status: true } }),
    prisma.tenantAgentEntitlement.findMany({ where: { tenantId: tenant.id }, select: { status: true } }),
    prisma.creditAccount.findUnique({ where: { tenantId: tenant.id }, select: { balance: true } })
  ]);

  const safeSummary = {
    syntheticProfileCount: profiles.length,
    agentRunCount: runs.length,
    reservations,
    transactions,
    credentialStates: connections.map((item) => ({ status: item.status, revoked: Boolean(item.revokedAt), hashAudit: Boolean(item.tokenHash && item.tokenPrefix) })),
    productEntitlements: productEntitlements.map((item) => item.status),
    agentEntitlements: agentEntitlements.map((item) => item.status),
    finalBalance: account?.balance ?? null
  };
  console.log(JSON.stringify({ status: "evidence", ...safeSummary }));

  assert.equal(profiles.length, 1, "synthetic live tenant must have exactly one brand-only profile");
  for (const value of [profiles[0].data, profiles[0].confirmedData]) {
    assert.deepEqual(Object.keys(value ?? {}), ["beautyIndustryBrand"], "synthetic live profile contains unauthorized operating facts");
    assert.equal(value?.beautyIndustryBrand?.brandCode, "lanqi");
    assert.equal(value?.beautyIndustryBrand?.source, "controlled_acceptance");
  }
  assert.equal(reservations.length, 1, "one and only one credit reservation is required");
  const consumes = transactions.filter((item) => item.direction === "consume");
  const refunds = transactions.filter((item) => item.direction === "refund");
  assert.equal(consumes.length, 1, "the single reservation must create one auditable consume entry");
  assert.equal(connections.length, 1);
  assert.ok(connections.every((item) => item.status === "revoked" && item.revokedAt && item.tokenHash && item.tokenPrefix));
  assert.ok(productEntitlements.every((item) => item.status === "revoked"));
  assert.ok(agentEntitlements.every((item) => item.status === "revoked"));
  assert.equal(account?.balance, 0);

  if (expectedStatus === "passed") {
    assert.equal(runs.length, 1, "successful live result must persist exactly one AgentRun");
    assert.equal(runs[0].status, "succeeded");
    assert.equal(runs[0].capabilityId, "beauty_xiaohongshu_package");
    assert.equal(runs[0].skillId, "wechat-xhs-content-line");
    assert.equal(reservations[0].status, "settled", "successful live result must settle its reservation");
    assert.equal(refunds.length, 0, "successful live result must not refund settled credits");
    assert.equal(reservations[0].actualAmount, consumes[0].amount, "settled amount must equal the single consume entry");
  } else if (expectedStatus === "failed") {
    assert.equal(runs.length, 0, "contract-rejected output must not persist AgentRun");
    assert.equal(reservations[0].status, "released", "failed live result must release reserved credits");
    assert.equal(refunds.length, 1, "the failed result must create one matching refund entry");
    assert.equal(consumes[0].amount, refunds[0].amount, "released reservation must have zero net credit cost");
    assert.equal(reservations[0].actualAmount, 0, "released reservation actual amount must be zero");
  } else {
    assert.fail("BY17_LIVE_EXPECTED_STATUS must be passed or failed");
  }

  console.log(JSON.stringify({
    status: "passed",
    syntheticProfileCount: profiles.length,
    agentRunCount: runs.length,
    reservationCount: reservations.length,
    reservationStatus: reservations[0].status,
    reservationErrorCode: reservations[0].errorCode,
    consumeTransactions: consumes.length,
    refundTransactions: refunds.length,
    netCreditCost: consumes[0].amount - refunds.reduce((sum, item) => sum + item.amount, 0),
    credentialRevoked: true,
    entitlementsRevoked: true,
    finalBalance: account.balance
  }));
} finally {
  await prisma.$disconnect();
}

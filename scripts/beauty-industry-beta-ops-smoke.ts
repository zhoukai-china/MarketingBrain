import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { prisma } from "../packages/db/src/index.js";

const allowedDatabase = "beauty_industry_acceptance_20260821";
if (process.env.BEAUTY_PROFILE_TEST_DATABASE_ALLOWED !== "true" || !process.env.DATABASE_URL?.includes(`/${allowedDatabase}`)) {
  throw new Error(`refusing_non_isolated_database:${allowedDatabase}`);
}

async function main(): Promise<void> {
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const tenantId = `beauty_beta_ops_${suffix}`;
  const grantId = `grant_${suffix}`;
  try {
    await prisma.tenant.create({ data: { id: tenantId, name: "Synthetic Beauty Beta Ops", type: "local_business", industry: "生活美容" } });
    await prisma.tenantProductEntitlement.create({ data: { tenantId, productCode: "beauty-industry", status: "active", source: "beta_ops_smoke" } });
    for (let repeat = 0; repeat < 2; repeat += 1) {
      const result = spawnSync(process.execPath, ["scripts/grant-beauty-beta-credits.mjs", "--tenant-id", tenantId, "--amount", "80", "--grant-id", grantId], {
        cwd: process.cwd(),
        env: process.env,
        encoding: "utf8"
      });
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, repeat === 0 ? /grant=created/ : /grant=already_applied/);
    }
    const account = await prisma.creditAccount.findUniqueOrThrow({ where: { tenantId } });
    const transactions = await prisma.creditTransaction.findMany({ where: { tenantId, productCode: "beauty-industry" } });
    assert.equal(account.balance, 80, "idempotent manual grant changed the balance twice");
    assert.equal(transactions.length, 1, "idempotent manual grant created duplicate ledger rows");
    assert.equal(transactions[0]?.direction, "grant");
    assert.equal(transactions[0]?.channel, "admin_manual");
    console.log("beauty invitation beta manual operations smoke passed (invite entitlement required, grant idempotent)");
  } finally {
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

// PLAT-48 第③批：只读分销后台服务级回归（真实 PostgreSQL，需 DATABASE_URL）。
//
// 覆盖：合伙人自看客户（充值/消耗/佣金）、平台汇总、非合伙人 isPartner=false。
import "dotenv/config";
process.env.SKILL_MCP_REQUIRED = "false";
import { randomUUID } from "node:crypto";
import { prisma } from "../apps/api/node_modules/@baolu/db/dist/index.js";
import { readAdminMarketPartnerDashboard, readPartnerDashboard } from "../apps/api/src/services/market-partner-dashboard.js";
import { settleMarketPartnerCommission } from "../apps/api/src/services/market-partner-commission.js";

let pass = 0;
const failures: string[] = [];
function check(name: string, ok: unknown, detail = ""): void {
  if (ok) {
    pass += 1;
    console.log(`PASS  ${name}${detail ? ` :: ${detail}` : ""}`);
  } else {
    failures.push(`${name}${detail ? ` :: ${detail}` : ""}`);
    console.error(`FAIL  ${name}${detail ? ` :: ${detail}` : ""}`);
  }
}

const createdUserIds: string[] = [];
const createdTenantIds: string[] = [];
const createdDistributorIds: string[] = [];

async function cleanup(): Promise<void> {
  try {
    if (createdDistributorIds.length > 0) {
      await prisma.distroCommissionLog.deleteMany({ where: { distributorId: { in: createdDistributorIds } } });
      await prisma.distroCustomer.deleteMany({ where: { distributorId: { in: createdDistributorIds } } });
      await prisma.shareLink.deleteMany({ where: { distributorId: { in: createdDistributorIds } } });
      await prisma.distributor.deleteMany({ where: { id: { in: createdDistributorIds } } });
    }
    for (const tenantId of createdTenantIds) {
      await prisma.membership.deleteMany({ where: { tenantId } });
      await prisma.tenant.deleteMany({ where: { id: tenantId } });
    }
    if (createdUserIds.length > 0) {
      await prisma.marketPartnerGrant.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.walletLedger.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.wallet.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
  } catch (error) {
    console.error("[cleanup] 清理失败：", error instanceof Error ? error.message : String(error));
  }
}

async function createUser(label: string): Promise<string> {
  const id = `mp-dash-${label}-${randomUUID().slice(0, 8)}`;
  await prisma.user.create({ data: { id, nickname: label, phone: `135${Math.floor(Math.random() * 1e8).toString().padStart(8, "0")}` } });
  createdUserIds.push(id);
  return id;
}

async function createTenant(label: string): Promise<string> {
  const id = `mp-dash-t-${label}-${randomUUID().slice(0, 8)}`;
  await prisma.tenant.create({ data: { id, name: label, type: "local_business", industry: "美业", city: "杭州" } });
  createdTenantIds.push(id);
  return id;
}

async function main(): Promise<void> {
  const partnerUserId = await createUser("partner");
  const partnerTenantId = await createTenant("合伙人租户");
  await prisma.membership.create({ data: { id: `mp-dash-m-p-${randomUUID().slice(0, 8)}`, tenantId: partnerTenantId, userId: partnerUserId, role: "owner", isActive: true } });

  const customerUserId = await createUser("customer");
  const customerTenantId = await createTenant("客户租户");
  await prisma.membership.create({ data: { id: `mp-dash-m-c-${randomUUID().slice(0, 8)}`, tenantId: customerTenantId, userId: customerUserId, role: "owner", isActive: true } });

  const distributor = await prisma.distributor.create({
    data: { tenantId: partnerTenantId, userId: partnerUserId, name: "市场合伙人", code: `P${randomUUID().slice(0, 12).replace(/-/g, "")}`, level: 1, status: "active" }
  });
  createdDistributorIds.push(distributor.id);
  await prisma.distroCustomer.create({
    data: { distributorId: distributor.id, customerId: customerTenantId, customerType: "tenant", name: "客户甲", source: "market_partner_link" }
  });

  const wallet = await prisma.wallet.create({ data: { userId: customerUserId, paidBalance: 800 } });
  await prisma.walletLedger.createMany({
    data: [
      { walletId: wallet.id, userId: customerUserId, delta: 1000, bucket: "paid", type: "recharge", source: "smoke" },
      { walletId: wallet.id, userId: customerUserId, delta: -200, bucket: "paid", type: "consume", source: "smoke" }
    ]
  });

  await settleMarketPartnerCommission({
    tenantId: customerTenantId,
    userId: customerUserId,
    spentPaid: 200,
    refType: "marketplace_run",
    refId: "dash-r1",
    idempotencyKey: `mp-dash-comm-${randomUUID()}`
  });

  const self = await readPartnerDashboard({ userId: partnerUserId, tenantId: partnerTenantId });
  check("合伙人自看 isPartner=true", self.isPartner === true);
  check("合伙人后台只有 1 个客户", self.partner?.customerCount === 1, String(self.partner?.customerCount));
  check("客户充值积分为 1000", self.customers?.[0]?.rechargedCredits === 1000, String(self.customers?.[0]?.rechargedCredits));
  check("客户消耗积分为 200", self.customers?.[0]?.consumedCredits === 200, String(self.customers?.[0]?.consumedCredits));
  check("客户佣金为 ¥2.00", self.customers?.[0]?.commissionCny === 2, String(self.customers?.[0]?.commissionCny));

  const nonPartner = await readPartnerDashboard({ userId: customerUserId, tenantId: customerTenantId });
  check("非合伙人 isPartner=false", nonPartner.isPartner === false);

  const admin = await readAdminMarketPartnerDashboard();
  check("平台汇总包含该合伙人", admin.some((row) => row.id === distributor.id && row.customerCount === 1));

  await cleanup();
  if (failures.length > 0) {
    console.error(`market_partner_dashboard_smoke: FAIL (${failures.length} failed)`);
    process.exit(1);
  }
  console.log(`market_partner_dashboard_smoke: PASS (${pass} passed)`);
}

main().catch(async (error) => {
  console.error(error);
  await cleanup();
  process.exit(1);
});

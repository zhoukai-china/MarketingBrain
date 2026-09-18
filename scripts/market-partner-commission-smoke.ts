// PLAT-48 第②批：市场合伙人消耗分润结算服务级回归（真实 PostgreSQL，需 DATABASE_URL）。
//
// 覆盖：spent.paid×20% 结算、bonus 不计、幂等不重复加钱、退款冲正、到期解冻。
import "dotenv/config";
process.env.SKILL_MCP_REQUIRED = "false";
import { randomUUID } from "node:crypto";
import { prisma } from "../apps/api/node_modules/@baolu/db/dist/index.js";
import {
  commissionCnyForPaidCredits,
  reverseMarketPartnerCommission,
  settleMarketPartnerCommission,
  unfreezeDuePartnerCommissions
} from "../apps/api/src/services/market-partner-commission.js";

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
const idempotencyKeys: string[] = [];

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
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
  } catch (error) {
    console.error("[cleanup] 清理失败：", error instanceof Error ? error.message : String(error));
  }
}

async function main(): Promise<void> {
  const partnerUserId = `mp-comm-p-${randomUUID().slice(0, 8)}`;
  await prisma.user.create({ data: { id: partnerUserId, nickname: "结算合伙人", phone: `136${Math.floor(Math.random() * 1e8).toString().padStart(8, "0")}` } });
  createdUserIds.push(partnerUserId);

  const tenant = await prisma.tenant.create({
    data: { id: `mp-comm-t-${randomUUID().slice(0, 8)}`, name: "分润验收租户", type: "local_business" }
  });
  createdTenantIds.push(tenant.id);

  const distributor = await prisma.distributor.create({
    data: { tenantId: tenant.id, userId: partnerUserId, name: "分润合伙人", code: `P${randomUUID().slice(0, 12).replace(/-/g, "")}`, level: 1, status: "active" }
  });
  createdDistributorIds.push(distributor.id);
  await prisma.distroCustomer.create({
    data: { distributorId: distributor.id, customerId: tenant.id, customerType: "tenant", name: "客户", source: "market_partner_link" }
  });

  check("佣金换算：400 paid 积分 = ¥4.00", commissionCnyForPaidCredits(400) === 4);

  const key1 = `mp-comm-${randomUUID()}`;
  idempotencyKeys.push(key1);
  const r1 = await settleMarketPartnerCommission({
    tenantId: tenant.id,
    userId: partnerUserId,
    spentPaid: 400,
    refType: "marketplace_run",
    refId: "r1",
    idempotencyKey: key1
  });
  check("spent.paid=400 结算成功", r1.settled === true, JSON.stringify(r1));
  check("佣金金额 ¥4.00", r1.amountCny === 4, String(r1.amountCny));

  const after1 = await prisma.distributor.findUnique({ where: { id: distributor.id } });
  check("合伙人 frozenAmount 增加 ¥4", Number(after1?.frozenAmount) === 4, String(after1?.frozenAmount));

  const r2 = await settleMarketPartnerCommission({
    tenantId: tenant.id,
    userId: partnerUserId,
    spentPaid: 400,
    refType: "marketplace_run",
    refId: "r1",
    idempotencyKey: key1
  });
  check("同一事件重复结算幂等", r2.settled === false && r2.idempotent === true, JSON.stringify(r2));
  const after2 = await prisma.distributor.findUnique({ where: { id: distributor.id } });
  check("重复结算不重复加钱", Number(after2?.frozenAmount) === 4, String(after2?.frozenAmount));

  const r0 = await settleMarketPartnerCommission({
    tenantId: tenant.id,
    userId: partnerUserId,
    spentPaid: 0,
    refType: "marketplace_run",
    refId: "bonus-only",
    idempotencyKey: `mp-comm-bonus-${randomUUID()}`
  });
  check("纯 bonus（spent.paid=0）不结算", r0.settled === false && r0.reason === "no_paid_spend", JSON.stringify(r0));

  const reversed = await reverseMarketPartnerCommission({ idempotencyKey: key1 });
  check("退款冲正成功", reversed.reversed === true, JSON.stringify(reversed));
  const afterReverse = await prisma.distributor.findUnique({ where: { id: distributor.id } });
  check("冲正后 frozenAmount 回零", Number(afterReverse?.frozenAmount) === 0, String(afterReverse?.frozenAmount));

  const key2 = `mp-comm-${randomUUID()}`;
  await settleMarketPartnerCommission({ tenantId: tenant.id, userId: partnerUserId, spentPaid: 200, refType: "lanqi_wallet", refId: "lq", idempotencyKey: key2 });
  const dueLog = await prisma.distroCommissionLog.findUnique({ where: { idempotencyKey: key2 } });
  await prisma.distroCommissionLog.update({ where: { id: dueLog!.id }, data: { unfrozenAt: new Date(Date.now() - 1000) } });
  const unfrozen = await unfreezeDuePartnerCommissions(distributor.id);
  check("到期解冻执行", unfrozen.amountCny > 0, JSON.stringify(unfrozen));
  const afterUnfreeze = await prisma.distributor.findUnique({ where: { id: distributor.id } });
  check("解冻后 availableAmount 增加、frozenAmount 归零", Number(afterUnfreeze?.availableAmount) === 2 && Number(afterUnfreeze?.frozenAmount) === 0, `available=${afterUnfreeze?.availableAmount} frozen=${afterUnfreeze?.frozenAmount}`);

  await cleanup();
  if (failures.length > 0) {
    console.error(`market_partner_commission_smoke: FAIL (${failures.length} failed)`);
    process.exit(1);
  }
  console.log(`market_partner_commission_smoke: PASS (${pass} passed)`);
}

main().catch(async (error) => {
  console.error(error);
  await cleanup();
  process.exit(1);
});

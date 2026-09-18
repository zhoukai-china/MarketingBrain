import { prisma } from "@baolu/db";
import { unfreezeDuePartnerCommissions } from "./market-partner-commission.js";

/**
 * 市场合伙人只读分销后台（PLAT-48 第③批）。
 *
 * 口径沿用后台「客户」表（/admin/customers）：钱包流水里
 *   - 累计充值 = `WalletLedger.type=recharge` 的 |delta|；
 *   - 累计消耗 = `WalletLedger.type=consume` 的 |delta|。
 * 佣金按 `DistroCommissionLog`（人民币元）按客户租户汇总。
 */

async function tenantLedgerSummaries(tenantIds: string[]) {
  if (tenantIds.length === 0) return { byTenant: new Map<string, { recharged: number; consumed: number }>(), tenantMeta: new Map() };

  const memberships = await prisma.membership.findMany({
    where: { tenantId: { in: tenantIds } },
    select: { tenantId: true, userId: true }
  });
  const userIdsByTenant = new Map<string, string[]>();
  for (const row of memberships) {
    const list = userIdsByTenant.get(row.tenantId) ?? [];
    list.push(row.userId);
    userIdsByTenant.set(row.tenantId, list);
  }
  const allUserIds = [...new Set(memberships.map((row) => row.userId))];

  const ledgerSums = allUserIds.length
    ? await prisma.walletLedger.groupBy({
        by: ["userId", "type"],
        where: { userId: { in: allUserIds }, type: { in: ["recharge", "consume"] } },
        _sum: { delta: true }
      })
    : [];
  const rechargedByUser = new Map<string, number>();
  const consumedByUser = new Map<string, number>();
  for (const row of ledgerSums) {
    const value = Math.abs(row._sum.delta ?? 0);
    if (row.type === "recharge") rechargedByUser.set(row.userId, (rechargedByUser.get(row.userId) ?? 0) + value);
    if (row.type === "consume") consumedByUser.set(row.userId, (consumedByUser.get(row.userId) ?? 0) + value);
  }

  const tenants = await prisma.tenant.findMany({
    where: { id: { in: tenantIds } },
    select: { id: true, name: true, industry: true, city: true, createdAt: true }
  });
  const tenantMeta = new Map(tenants.map((t) => [t.id, t]));

  const byTenant = new Map<string, { recharged: number; consumed: number }>();
  for (const tenantId of tenantIds) {
    const userIds = userIdsByTenant.get(tenantId) ?? [];
    byTenant.set(tenantId, {
      recharged: userIds.reduce((sum, userId) => sum + (rechargedByUser.get(userId) ?? 0), 0),
      consumed: userIds.reduce((sum, userId) => sum + (consumedByUser.get(userId) ?? 0), 0)
    });
  }
  return { byTenant, tenantMeta };
}

export async function readPartnerDashboard(params: { userId: string; tenantId: string }) {
  const distributor = await prisma.distributor.findUnique({
    where: { tenantId_userId: { tenantId: params.tenantId, userId: params.userId } }
  });
  if (!distributor) return { isPartner: false };

  await unfreezeDuePartnerCommissions(distributor.id).catch(() => undefined);

  const [fresh, customers, commissionRows] = await Promise.all([
    prisma.distributor.findUniqueOrThrow({ where: { id: distributor.id } }),
    prisma.distroCustomer.findMany({ where: { distributorId: distributor.id }, orderBy: { createdAt: "desc" } }),
    prisma.distroCommissionLog.groupBy({
      by: ["tenantId"],
      where: { distributorId: distributor.id, reversedAt: null },
      _sum: { amount: true }
    })
  ]);

  const tenantIds = customers.map((customer) => customer.customerId);
  const { byTenant, tenantMeta } = await tenantLedgerSummaries(tenantIds);
  const commissionByTenant = new Map<string, number>();
  for (const row of commissionRows) {
    if (row.tenantId) commissionByTenant.set(row.tenantId, Number(row._sum.amount ?? 0));
  }

  const customerViews = customers.map((customer) => {
    const ledger = byTenant.get(customer.customerId) ?? { recharged: 0, consumed: 0 };
    const meta = tenantMeta.get(customer.customerId);
    return {
      tenantId: customer.customerId,
      name: customer.name || meta?.name || "客户",
      source: customer.source,
      registeredAt: customer.createdAt.toISOString(),
      industry: meta?.industry ?? null,
      city: meta?.city ?? null,
      rechargedCredits: ledger.recharged,
      consumedCredits: ledger.consumed,
      commissionCny: commissionByTenant.get(customer.customerId) ?? 0
    };
  });

  return {
    isPartner: true,
    partner: {
      id: fresh.id,
      name: fresh.name,
      code: fresh.code,
      status: fresh.status,
      totalEarningsCny: Number(fresh.totalEarnings),
      frozenAmountCny: Number(fresh.frozenAmount),
      availableAmountCny: Number(fresh.availableAmount),
      totalWithdrawnCny: Number(fresh.totalWithdrawn),
      customerCount: customerViews.length
    },
    customers: customerViews
  };
}

export async function readAdminMarketPartnerDashboard() {
  const distributors = await prisma.distributor.findMany({
    orderBy: { createdAt: "desc" },
    include: { shareLinks: true }
  });
  const customerCounts = await prisma.distroCustomer.groupBy({
    by: ["distributorId"],
    _count: { _all: true }
  });
  const countByDistributor = new Map(customerCounts.map((row) => [row.distributorId, row._count._all]));

  return distributors.map((row) => ({
    id: row.id,
    name: row.name,
    phone: row.phone,
    code: row.code,
    status: row.status,
    userId: row.userId,
    tenantId: row.tenantId,
    customerCount: countByDistributor.get(row.id) ?? 0,
    activeLinkCount: row.shareLinks.filter((link) => link.isActive).length,
    totalEarningsCny: Number(row.totalEarnings),
    frozenAmountCny: Number(row.frozenAmount),
    availableAmountCny: Number(row.availableAmount),
    totalWithdrawnCny: Number(row.totalWithdrawn),
    createdAt: row.createdAt.toISOString()
  }));
}

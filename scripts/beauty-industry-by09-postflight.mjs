#!/usr/bin/env node
import { createRequire } from "node:module";

const requireFromDb = createRequire(new URL("../packages/db/package.json", import.meta.url));
const { PrismaClient } = requireFromDb("@prisma/client");
const prisma = new PrismaClient();

try {
  const tenant = await prisma.tenant.findFirst({
    where: { name: "BY09 Controlled Evaluation", createdAt: { gt: new Date(Date.now() - 3_600_000) } },
    orderBy: { createdAt: "desc" },
    select: { id: true }
  });
  if (!tenant) throw new Error("by09_controlled_tenant_not_found");
  const [connections, productEntitlements, agentEntitlements, account, runs, reservations, transactions] = await Promise.all([
    prisma.workbuddyMcpConnection.findMany({ where: { tenantId: tenant.id }, select: { status: true, revokedAt: true, tokenHash: true, tokenPrefix: true } }),
    prisma.tenantProductEntitlement.findMany({ where: { tenantId: tenant.id }, select: { status: true } }),
    prisma.tenantAgentEntitlement.findMany({ where: { tenantId: tenant.id }, select: { status: true } }),
    prisma.creditAccount.findUnique({ where: { tenantId: tenant.id }, select: { balance: true } }),
    prisma.agentRun.findMany({ where: { tenantId: tenant.id }, select: { capabilityId: true, skillId: true, status: true, productCode: true, usageChannel: true, creditCost: true } }),
    prisma.creditReservation.findMany({ where: { tenantId: tenant.id }, select: { status: true, amount: true, actualAmount: true, errorCode: true } }),
    prisma.creditTransaction.findMany({ where: { tenantId: tenant.id }, select: { direction: true, amount: true, reason: true, productCode: true, channel: true } })
  ]);
  console.log(JSON.stringify({
    credential: {
      count: connections.length,
      revoked: connections.every((item) => item.status === "revoked" && Boolean(item.revokedAt)),
      hashAuditRetained: connections.every((item) => Boolean(item.tokenHash && item.tokenPrefix))
    },
    productEntitlements: productEntitlements.map((item) => item.status),
    agentEntitlements: agentEntitlements.map((item) => item.status),
    balance: account?.balance ?? null,
    runs,
    reservations,
    transactions
  }));
} finally {
  await prisma.$disconnect();
}

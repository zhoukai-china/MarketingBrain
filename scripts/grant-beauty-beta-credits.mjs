#!/usr/bin/env node
import { createRequire } from "node:module";

const requireFromDb = createRequire(new URL("../packages/db/package.json", import.meta.url));
const { PrismaClient } = requireFromDb("@prisma/client");

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--") continue;
    if (!item?.startsWith("--")) continue;
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) throw new Error(`Missing value for ${item}`);
    values[item.slice(2)] = next;
    index += 1;
  }
  return values;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const args = parseArgs(process.argv.slice(2));
  const tenantId = args["tenant-id"]?.trim();
  const grantId = args["grant-id"]?.trim();
  const amount = Number.parseInt(args.amount ?? "", 10);
  if (!tenantId) throw new Error("--tenant-id is required");
  if (!grantId || !/^[A-Za-z0-9_-]{8,80}$/.test(grantId)) throw new Error("--grant-id must be an 8-80 character operator reference");
  if (!Number.isInteger(amount) || amount < 1 || amount > 10_000) throw new Error("--amount must be between 1 and 10000");

  const prisma = new PrismaClient();
  try {
    const result = await prisma.$transaction(async (tx) => {
      const entitlement = await tx.tenantProductEntitlement.findFirst({
        where: {
          tenantId,
          productCode: "beauty-industry",
          status: "active",
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }]
        },
        select: { id: true }
      });
      if (!entitlement) throw new Error("active beauty-industry entitlement is required");
      const existing = await tx.creditTransaction.findFirst({
        where: { tenantId, productCode: "beauty-industry", refType: "beauty_beta_manual_grant", refId: grantId },
        select: { id: true, amount: true }
      });
      if (existing) {
        if (existing.amount !== amount) throw new Error("grant id already exists with a different amount");
        const account = await tx.creditAccount.findUnique({ where: { tenantId }, select: { balance: true } });
        return { created: false, balance: account?.balance ?? 0 };
      }
      const account = await tx.creditAccount.upsert({
        where: { tenantId },
        update: { balance: { increment: amount } },
        create: { tenantId, balance: amount },
        select: { id: true, balance: true }
      });
      await tx.creditTransaction.create({
        data: {
          creditAccountId: account.id,
          tenantId,
          direction: "grant",
          amount,
          reason: "beauty_invite_beta_manual_grant",
          refType: "beauty_beta_manual_grant",
          refId: grantId,
          productCode: "beauty-industry",
          operatingEntityId: tenantId,
          channel: "admin_manual"
        }
      });
      return { created: true, balance: account.balance };
    });
    console.log(`beauty_beta_credit_grant=${result.created ? "created" : "already_applied"};amount=${amount};balance=${result.balance}`);
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

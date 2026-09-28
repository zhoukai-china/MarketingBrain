import { createRequire } from "node:module";
const requireFromDb = createRequire(new URL("./package.json", import.meta.url));
const { PrismaClient } = requireFromDb("@prisma/client");
const db = new PrismaClient();
const U = "cmuh1bf710as05fzhof40j4io";

const wallet = await db.wallet.findUnique({ where: { userId: U } });
console.log("=== Wallet ===");
console.log(JSON.stringify(wallet));

const ledger = await db.walletLedger.findMany({ where: { userId: U }, orderBy: { createdAt: "desc" }, take: 15 });
console.log("\n=== WalletLedger ===");
for (const l of ledger) console.log(l.createdAt.toISOString(), "delta=", l.delta, "bucket=", l.bucket, "type=", l.type, "source=", l.source ?? "", "ref=", l.refOrderId ?? "");

const user = await db.user.findUnique({ where: { id: U }, select: { id: true, nickname: true, phone: true, wechatOpenid: true } });
console.log("\n=== User ===");
console.log(JSON.stringify(user));

await db.$disconnect();

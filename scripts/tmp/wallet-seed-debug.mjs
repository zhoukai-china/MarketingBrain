// 临时排查：为什么 E2E 脚本里 seedWallet 后 /market/me 仍为 0。
const apiBase = process.env.MP_E2E_API_URL ?? "http://127.0.0.1:3011";

const login = await fetch(`${apiBase}/auth/dev-login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ tenantRole: "local_business", tenantName: "钱包排查租户" })
});
const session = await login.json();
console.log("dev-login:", login.status, JSON.stringify({ userId: session.userId, tenantId: session.tenantId, dataMode: session.dataMode }));

const tokenPayload = JSON.parse(Buffer.from(session.token.split(".")[1], "base64url").toString("utf8"));
console.log("token payload:", JSON.stringify(tokenPayload));

console.log("process.env.DATABASE_URL:", process.env.DATABASE_URL ?? "(unset)");
const { prisma } = await import("../../apps/api/node_modules/@baolu/db/dist/index.js");
try {
  const url = await prisma.$queryRawUnsafe("select current_database() as db, current_schema() as sch");
  console.log("prisma connected to:", JSON.stringify(url));
  const before = await prisma.wallet.findUnique({ where: { userId: session.userId } });
  console.log("wallet before:", JSON.stringify(before));
  const upserted = await prisma.wallet.upsert({
    where: { userId: session.userId },
    update: { paidBalance: 1000 },
    create: { userId: session.userId, paidBalance: 1000 }
  });
  console.log("wallet after upsert:", JSON.stringify(upserted));
  const reread = await prisma.wallet.findUnique({ where: { userId: session.userId } });
  console.log("wallet reread:", JSON.stringify(reread));
} catch (error) {
  console.error("prisma error:", error instanceof Error ? error.message : error);
}

const me = await fetch(`${apiBase}/market/me`, { headers: { authorization: `Bearer ${session.token}` } });
console.log("/market/me:", me.status, (await me.text()).slice(0, 400));

const meLocalhost = await fetch("http://localhost:3011/market/me", { headers: { authorization: `Bearer ${session.token}` } });
console.log("/market/me localhost:", meLocalhost.status, (await meLocalhost.text()).slice(0, 400));

// 复现 Web dev 的免登录判断：generic 租户的 token 在内测免登录下会被替换掉。
const stores = await fetch(`${apiBase}/beauty-industry/stores`, { headers: { authorization: `Bearer ${session.token}` } });
console.log("/beauty-industry/stores (generic tenant):", stores.status, (await stores.text()).slice(0, 200));

const beautyLogin = await fetch(`${apiBase}/auth/dev-login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ productCode: "beauty-industry", tenantRole: "local_business", tenantName: "免登录探针租户", industry: "美业" })
});
const beautySession = await beautyLogin.json();
const beautyStores = await fetch(`${apiBase}/beauty-industry/stores`, {
  headers: { authorization: `Bearer ${beautySession.token}` }
});
console.log("/beauty-industry/stores (beauty tenant):", beautyStores.status, (await beautyStores.text()).slice(0, 200));

await prisma.wallet.deleteMany({ where: { userId: session.userId } }).catch(() => {});
await prisma.membership.deleteMany({ where: { userId: session.userId } }).catch(() => {});
await prisma.membership.deleteMany({ where: { userId: beautySession.userId } }).catch(() => {});
await prisma.$disconnect().catch(() => {});

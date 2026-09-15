// PLAT-38「我的」页自助邀请链接回归（真实 HTTP handler + 真实数据库，0 外部调用）。
//
// 用户 2026-09-15：平台页面里要有「复制我的推荐链接」（含二维码）。
// 安全模型沿用 PLAT-28：推荐码明文只在签发时返回一次，库里只存 hash + preview。
//
// 覆盖：
//   1. 未登录 → 401（自服务入口也要登录态）
//   2. 首次 POST → state=created，返回完整注册链接（指向配置的公开站点）+ 明文码 + 二维码 SVG
//   3. 再次 GET/POST（不 regenerate）→ state=existing，**不再返回明文**，只给 preview
//   4. regenerate=true → 再签一条（旧码仍有效：库里两条都在）
//   5. 只能看到自己的码：另一个用户 GET 到的 preview 与本用户不同
//   6. 链接格式与归一化口径一致：`<PUBLIC_WEB_BASE_URL>/login?ref=<code>`
import dotenv from "dotenv";

dotenv.config({ path: "apps/api/.env", quiet: true });
process.env.DATA_MODE = "database";
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

async function main(): Promise<void> {
  const { default: Fastify } = await import("../apps/api/node_modules/fastify/fastify.js");
  const { prisma } = await import("../apps/api/node_modules/@baolu/db/dist/index.js");
  const { registerMarketplaceRoutes } = await import("../apps/api/src/routes/marketplace.js");
  const { env } = await import("../apps/api/src/config/env.js");
  const { createSessionToken } = await import("../apps/api/src/services/auth-token.js");
  const { randomUUID } = await import("node:crypto");

  const suffix = randomUUID().slice(0, 8);
  const createUser = async (label: string) => {
    const userId = `plat38-${label}-user-${suffix}`;
    const tenantId = `plat38-${label}-tenant-${suffix}`;
    await prisma.user.create({ data: { id: userId } });
    await prisma.tenant.create({ data: { id: tenantId, name: `PLAT38 ${label}`, type: "local_business" } });
    await prisma.membership.create({ data: { id: `plat38-${label}-mem-${suffix}`, tenantId, userId, role: "owner", isActive: true } });
    return { userId, tenantId };
  };

  const app = Fastify({ logger: false, disableRequestLogging: true });
  await registerMarketplaceRoutes(app);

  const me = await createUser("me");
  const other = await createUser("other");
  const headersFor = (userId: string, tenantId: string) => ({
    authorization: `Bearer ${createSessionToken({ tenantId, userId, ttlSeconds: 900 })}`
  });
  const post = (url: string, userId?: string, tenantId?: string, body: Record<string, unknown> = {}) =>
    app.inject({ method: "POST", url, headers: { "content-type": "application/json", ...(userId ? headersFor(userId, tenantId!) : {}) }, payload: body });
  const get = (url: string, userId?: string, tenantId?: string) =>
    app.inject({ method: "GET", url, headers: userId ? headersFor(userId, tenantId!) : {} });

  try {
    // 1) 未登录不能拿
    const anonymous = await get("/market/me/referral-link");
    assert(anonymous.statusCode === 401, `未登录必须 401（实际 ${anonymous.statusCode}）`);

    // 2) 首次签发
    const created = await post("/market/me/referral-link", me.userId, me.tenantId);
    assert(created.statusCode === 200, `首次签发必须 200（实际 ${created.statusCode} ${created.body.slice(0, 160)}）`);
    const createdBody = created.json() as { state: string; link: string; code: string; codePreview: string; qrSvg: string };
    assert(createdBody.state === "created", "首次必须是 created");
    assert(/\/login\?ref=/.test(createdBody.link), `链接必须指向统一注册入口（实际 ${createdBody.link}）`);
    const expectedBase = String(env.PUBLIC_WEB_BASE_URL).replace(/\/+$/, "");
    assert(createdBody.link.startsWith(`${expectedBase}/login?ref=`), `链接必须用服务端配置的公开站点拼（期望前缀 ${expectedBase}/login?ref=）`);
    assert(createdBody.link.includes(encodeURIComponent(createdBody.code)), "链接里的 ref 必须与返回的明文码一致");
    assert(createdBody.qrSvg.includes("<svg"), "必须返回二维码 SVG");
    assert(createdBody.codePreview.startsWith("ref-"), `preview 形如 ref-****（实际 ${createdBody.codePreview}）`);

    // 3) 再次读取：不再返回明文
    const again = await get("/market/me/referral-link", me.userId, me.tenantId);
    const againBody = again.json() as { state: string; link: string | null; code: string | null; codePreview: string | null };
    assert(againBody.state === "existing", "已有码时必须是 existing");
    assert(againBody.link === null && againBody.code === null, "明文只在签发时返回一次，复读不得再给明文");
    assert(againBody.codePreview === createdBody.codePreview, "复读应给出同一个预览");

    const withoutRegenerate = await post("/market/me/referral-link", me.userId, me.tenantId);
    assert(withoutRegenerate.json().state === "existing", "不带 regenerate 的重复 POST 不得再签新码");

    // 4) 显式再生成：库里两条并存（旧链接仍然有效）
    const before = await prisma.referralCode.count({ where: { ownerUserId: me.userId } });
    const regenerated = await post("/market/me/referral-link", me.userId, me.tenantId, { regenerate: true });
    const regeneratedBody = regenerated.json() as { state: string; code: string; codePreview: string };
    assert(regeneratedBody.state === "created", "regenerate=true 必须签新码");
    assert(regeneratedBody.code !== createdBody.code, "新码必须与旧码不同");
    const after = await prisma.referralCode.count({ where: { ownerUserId: me.userId } });
    assert(after === before + 1, `旧码必须保留（期望 ${before + 1} 条，实际 ${after}）`);

    // 5) 只能看到自己的
    const otherView = await get("/market/me/referral-link", other.userId, other.tenantId);
    const otherBody = otherView.json() as { state: string; codePreview: string | null };
    assert(otherBody.state === "existing" || otherBody.state === "created" || otherBody.codePreview === null, "另一个用户应有自己的干净状态");
    assert(otherBody.codePreview !== createdBody.codePreview, "跨用户不得看到别人的推荐码预览");

    console.log(JSON.stringify({
      result: "PLAT38_SELF_REFERRAL_PASS",
      anonymousRejected: anonymous.statusCode === 401,
      firstIssueReturnedPlaintext: true,
      repeatReadHidesPlaintext: true,
      regenerateKeepsOldCode: after === before + 1,
      linkBase: expectedBase,
      qrSvg: true,
      providerCalls: 0,
      costYuan: 0
    }));
  } finally {
    await app.close();
    for (const user of [me, other]) {
      await prisma.referralCode.deleteMany({ where: { ownerUserId: user.userId } });
      await prisma.membership.deleteMany({ where: { tenantId: user.tenantId } });
      await prisma.tenant.deleteMany({ where: { id: user.tenantId } });
      await prisma.user.deleteMany({ where: { id: user.userId } });
    }
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});

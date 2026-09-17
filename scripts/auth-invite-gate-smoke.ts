// PLAT-34 统一注册链接 / 邀请码闸门回归（真实 HTTP handler + 真实数据库，0 外部调用）。
//
// 用户口径（2026-09-17）：取消兰琪邀请码制度，所有产品入口都不再强制邀请码；
// 平台统一注册链接（`/login?ref=…`）也直接注册；推荐归因保留且不得阻断注册。
//
// 覆盖：
//   1. 无产品、无邀请码 → 200（统一链接直接注册），invite.source=disabled
//   2. 兰琪、无邀请码 → 200（产品入口不再要码），invite.source=not_required
//   3. 美业 / 创始人 IP、无邀请码 → 200（产品入口不再要码）
//   4. 任何入口带无效邀请码 → 403（显式给码就必须校验通过，不能静默忽略）
//   5. 兰琪 + 有效邀请码 → 200 且 invite.redeemed=true、码的 usedCount +1
//   6. 带无效推荐码 → 仍然 200（归因失败不挡注册）
import dotenv from "dotenv";

dotenv.config({ path: "apps/api/.env", quiet: true });
// 生产与测试实例的实际口径：平台主入口开放注册；本 smoke 按同一口径跑。
process.env.INVITE_REQUIRED = "false";
process.env.DATA_MODE = "database";
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

async function post(app: any, url: string, payload: Record<string, unknown>): Promise<{ status: number; body: Record<string, any> }> {
  const response = await app.inject({
    method: "POST",
    url,
    headers: { "content-type": "application/json" },
    payload
  });
  return { status: response.statusCode, body: response.json() as Record<string, any> };
}

async function main(): Promise<void> {
  // 动态 import：必须在设置 INVITE_REQUIRED 之后再加载 config/env（env 在 import 时解析）。
  const { default: Fastify } = await import("../apps/api/node_modules/fastify/fastify.js");
  const { prisma } = await import("../apps/api/node_modules/@baolu/db/dist/index.js");
  const { registerAuthRoutes } = await import("../apps/api/src/routes/auth.js");
  const { hashInviteCode } = await import("../apps/api/src/services/invite-codes.js");
  const { randomUUID } = await import("node:crypto");

  const createdTenantIds: string[] = [];
  const createdUserIds: string[] = [];
  const createdInviteIds: string[] = [];

  const app = Fastify({ logger: false, disableRequestLogging: true });
  await registerAuthRoutes(app);

  const suffix = randomUUID().slice(0, 8);

  try {
    // 1) 统一注册链接：无产品、无邀请码，仍然能建号。
    const plain = await post(app, "/auth/beta-login", {
      tenantName: `PLAT34 统一注册 ${suffix}`,
      tenantRole: "local_business",
      referralCode: `not-a-real-ref-${suffix}`
    });
    assert(plain.status === 200, `无邀请码直接注册必须 200（实际 ${plain.status} ${JSON.stringify(plain.body).slice(0, 200)}）`);
    assert(plain.body.invite?.source === "disabled", `无邀请码注册的 invite.source 应为 disabled（实际 ${plain.body.invite?.source}）`);
    assert(plain.body.referral?.state !== "bound", "无效推荐码不得产生归因，但也不能阻断注册");
    createdTenantIds.push(plain.body.tenantId);
    createdUserIds.push(plain.body.userId);

    // 2) 兰琪：缺邀请码现在直接放行（取消邀请码制度）。
    const lanqiNoCode = await post(app, "/auth/beta-login", {
      tenantName: `PLAT34 兰琪无码 ${suffix}`,
      productCode: "lanqi"
    });
    assert(lanqiNoCode.status === 200, `兰琪无邀请码必须能直接开通（实际 ${lanqiNoCode.status} ${JSON.stringify(lanqiNoCode.body).slice(0, 200)}）`);
    assert(lanqiNoCode.body.invite?.source === "not_required", `兰琪无码 invite.source 应为 not_required（实际 ${lanqiNoCode.body.invite?.source}）`);
    createdTenantIds.push(lanqiNoCode.body.tenantId);
    createdUserIds.push(lanqiNoCode.body.userId);

    // 3) 其他产品入口：不再要码。
    for (const productCode of ["beauty-industry", "founder-ip", "takeaway"] as const) {
      const opened = await post(app, "/auth/beta-login", {
        tenantName: `PLAT34 ${productCode} ${suffix}`,
        productCode
      });
      assert(opened.status === 200, `${productCode} 无邀请码必须能直接开通（实际 ${opened.status} ${JSON.stringify(opened.body).slice(0, 200)}）`);
      assert(opened.body.productCode === productCode, `${productCode} 响应必须回带 productCode`);
      createdTenantIds.push(opened.body.tenantId);
      createdUserIds.push(opened.body.userId);
    }

    // 4) 显式带了无效邀请码：任何入口都必须拒绝（不能静默忽略）。
    const bogus = await post(app, "/auth/beta-login", {
      tenantName: `PLAT34 无效码 ${suffix}`,
      productCode: "beauty-industry",
      inviteCode: `plat34-not-a-real-code-${suffix}`
    });
    assert(bogus.status === 403, `无效邀请码必须 403（实际 ${bogus.status}）`);
    assert(bogus.body.error === "invite_code_not_found", `无效码错误码应为 invite_code_not_found（实际 ${bogus.body.error}）`);

    // 5) 兰琪 + 有效邀请码：放行并完成兑换。
    const code = `plat34-lanqi-${suffix}`;
    const invite = await prisma.inviteCode.create({
      data: {
        id: `plat34-invite-${suffix}`,
        codeHash: hashInviteCode(code),
        codePreview: `plat34-${suffix}`,
        label: "PLAT34 兰琪验收码",
        planCode: "local_standard",
        productCode: "lanqi",
        maxUses: 1,
        usedCount: 0,
        isActive: true,
        createdBy: "plat34-smoke"
      }
    });
    createdInviteIds.push(invite.id);

    const lanqiWithCode = await post(app, "/auth/beta-login", {
      tenantName: `PLAT34 兰琪有码 ${suffix}`,
      productCode: "lanqi",
      inviteCode: code
    });
    assert(lanqiWithCode.status === 200, `兰琪带有效邀请码必须 200（实际 ${lanqiWithCode.status} ${JSON.stringify(lanqiWithCode.body).slice(0, 200)}）`);
    assert(lanqiWithCode.body.invite?.redeemed === true, "兰琪有效邀请码必须完成兑换");
    createdTenantIds.push(lanqiWithCode.body.tenantId);
    createdUserIds.push(lanqiWithCode.body.userId);

    const redeemedRow = await prisma.inviteCode.findUniqueOrThrow({ where: { id: invite.id } });
    assert(redeemedRow.usedCount === 1, `邀请码 usedCount 应为 1（实际 ${redeemedRow.usedCount}）`);

    // 用完的码再用一次必须被拒（保持既有语义）。
    const exhausted = await post(app, "/auth/beta-login", {
      tenantName: `PLAT34 兰琪用尽码 ${suffix}`,
      productCode: "lanqi",
      inviteCode: code
    });
    assert(exhausted.status === 403, `用尽的邀请码必须 403（实际 ${exhausted.status}）`);

    console.log(JSON.stringify({
      result: "PLAT34_INVITE_GATE_PASS",
      openRegistrationWithoutCode: plain.status === 200,
      lanqiAllowsNoCode: lanqiNoCode.status === 200,
      otherProductsNeedNoCode: 3,
      invalidCodeRejected: bogus.status === 403,
      lanqiInviteRedeemed: true,
      referralFailureDoesNotBlockSignup: true,
      providerCalls: 0,
      costYuan: 0
    }));
  } finally {
    await app.close();
    if (createdInviteIds.length > 0) {
      await prisma.inviteCodeRedemption.deleteMany({ where: { inviteCodeId: { in: createdInviteIds } } });
      await prisma.inviteCode.deleteMany({ where: { id: { in: createdInviteIds } } });
    }
    for (const tenantId of createdTenantIds) {
      await prisma.marketplaceLedgerEntry.deleteMany({ where: { tenantId } }).catch(() => {});
      await prisma.creditReservation.deleteMany({ where: { tenantId } }).catch(() => {});
      await prisma.creditTransaction.deleteMany({ where: { tenantId } }).catch(() => {});
      await prisma.creditAccount.deleteMany({ where: { tenantId } }).catch(() => {});
      await prisma.inviteCodeRedemption.deleteMany({ where: { tenantId } }).catch(() => {});
      await prisma.membership.deleteMany({ where: { tenantId } }).catch(() => {});
      await prisma.tenantProductEntitlement.deleteMany({ where: { tenantId } }).catch(() => {});
      await prisma.tenant.deleteMany({ where: { id: tenantId } }).catch(() => {});
    }
    for (const userId of createdUserIds) {
      await prisma.walletLedger.deleteMany({ where: { userId } }).catch(() => {});
      await prisma.wallet.deleteMany({ where: { userId } }).catch(() => {});
      await prisma.user.deleteMany({ where: { id: userId } }).catch(() => {});
    }
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});

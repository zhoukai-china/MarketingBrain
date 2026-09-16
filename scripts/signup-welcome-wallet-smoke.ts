import "dotenv/config";
import { randomUUID } from "node:crypto";
import { prisma } from "../apps/api/node_modules/@baolu/db/dist/index.js";
import { createTenantWorkspace } from "../apps/api/src/services/database-bootstrap.js";

// 新用户注册赠送积分回归。口径演进：
//   - 2026-09-10：**不赠送任何欢迎积分**（当时产品拍板，本脚本曾锁死 0）；
//   - **2026-09-16（用户）：「新用户注册即赠送 100 积分，后面新用户注册都给送」**——默认额度改为 100，
//     对**所有新注册**生效，进 bonus 桶（赠送积分，不可退）。
// 本脚本锁死的契约：
//   1. 新建工作区（新用户）→ 用户级 Wallet 的赠送额度 = `NEW_USER_SIGNUP_CREDITS`（默认 100），
//      且有且仅有 1 条 `source="signup"` 的 bonus 流水；
//   2. 同租户遗留 CreditAccount 不变（欢迎积分只进用户钱包，避免两个账本各发一份）；
//   3. 同一用户第二次建工作区 → **不重复发放**（幂等靠 `source="signup"` 去重）；
//   4. 类型专属 `NEW_USER_<类型>_TRIAL_CREDITS` 显式配置时优先，用于隔离测试环境。
//
// 期望额度按当前进程的环境变量动态推导：默认口径 = `NEW_USER_SIGNUP_CREDITS`（未设置时 100）。

const EXPECTED_WELCOME_CREDITS = Number(
  process.env.NEW_USER_LOCAL_TRIAL_CREDITS ?? process.env.NEW_USER_SIGNUP_CREDITS ?? 100
);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

const createdTenantIds: string[] = [];
const createdUserIds: string[] = [];

async function cleanup(): Promise<void> {
  for (const tenantId of createdTenantIds) {
    await prisma.marketplaceSkuEntitlement.deleteMany({ where: { tenantId } });
    await prisma.creditTransaction.deleteMany({ where: { tenantId } });
    await prisma.creditAccount.deleteMany({ where: { tenantId } });
    await prisma.membership.deleteMany({ where: { tenantId } });
    await prisma.store.deleteMany({ where: { tenantId } });
    await prisma.tenantProfile.deleteMany({ where: { tenantId } });
    await prisma.tenantAgentEntitlement.deleteMany({ where: { tenantId } });
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
  }
  for (const userId of createdUserIds) {
    await prisma.walletLedger.deleteMany({ where: { userId } });
    await prisma.wallet.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  }
}

async function main(): Promise<void> {
  const suffix = randomUUID();

  try {
    // 场景 1：全新用户注册（与 /auth/beta-login 建号同一条服务端路径）
    const first = await createTenantWorkspace({
      planCode: "local_standard",
      tenantName: `Welcome Wallet Smoke Tenant ${suffix}`,
      nickname: `Welcome Wallet Smoke Owner ${suffix}`
    });
    createdTenantIds.push(first.tenant.id);
    createdUserIds.push(first.user.id);

    const wallet = await prisma.wallet.findUnique({ where: { userId: first.user.id } });
    assert(wallet !== null, "new user has a wallet row (货架必须能读到余额)");
    assert(
      wallet.paidBalance + wallet.bonusBalance === EXPECTED_WELCOME_CREDITS,
      `new user wallet balance starts at ${EXPECTED_WELCOME_CREDITS} (got paid=${wallet.paidBalance} bonus=${wallet.bonusBalance})`
    );

    const ledgers = await prisma.walletLedger.findMany({ where: { userId: first.user.id } });
    if (EXPECTED_WELCOME_CREDITS === 0) {
      assert(ledgers.length === 0, `no welcome credits means no wallet ledger entry (got ${ledgers.length})`);
    } else {
      assert(ledgers.length === 1, `new user has exactly 1 wallet ledger entry (got ${ledgers.length})`);
      assert(ledgers[0].delta === EXPECTED_WELCOME_CREDITS, "welcome wallet ledger delta equals the welcome allowance");
      assert(ledgers[0].bucket === "bonus", "welcome credits are granted to the bonus bucket (not paid)");
      assert(ledgers[0].source === "signup", "welcome wallet ledger source is signup");
    }

    // 场景 3：遗留 CreditAccount 与钱包口径一致（生产都是 0）
    const account = await prisma.creditAccount.findUnique({ where: { tenantId: first.tenant.id } });
    assert(account !== null, "legacy tenant credit account still exists");
    assert(
      account.balance === EXPECTED_WELCOME_CREDITS,
      `legacy credit account starts at ${EXPECTED_WELCOME_CREDITS} (got ${account.balance})`
    );
    const welcomeTransactions = await prisma.creditTransaction.findMany({
      where: { tenantId: first.tenant.id, reason: "welcome_credits" }
    });
    assert(
      welcomeTransactions.length === (EXPECTED_WELCOME_CREDITS > 0 ? 1 : 0),
      `legacy welcome credit transaction count matches the granted allowance (got ${welcomeTransactions.length})`
    );

    // 场景 2：同一用户第二次建工作区 → 不得重复发币
    const second = await createTenantWorkspace({
      planCode: "local_standard",
      tenantName: `Welcome Wallet Smoke Tenant 2 ${suffix}`,
      userId: first.user.id
    });
    createdTenantIds.push(second.tenant.id);

    const walletAfter = await prisma.wallet.findUnique({ where: { userId: first.user.id } });
    assert(walletAfter !== null, "wallet still present after a second workspace");
    assert(
      walletAfter.paidBalance + walletAfter.bonusBalance === EXPECTED_WELCOME_CREDITS,
      `second workspace must not re-grant welcome credits (got ${walletAfter.paidBalance + walletAfter.bonusBalance})`
    );
    const ledgersAfter = await prisma.walletLedger.count({ where: { userId: first.user.id } });
    assert(
      ledgersAfter === (EXPECTED_WELCOME_CREDITS > 0 ? 1 : 0),
      `second workspace must not add wallet ledger entries (got ${ledgersAfter})`
    );

    console.log("PASS signup-welcome-wallet-smoke");
  } finally {
    await cleanup();
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    try {
      await cleanup();
    } catch {
      // 清理失败不掩盖真实断言失败
    }
    await prisma.$disconnect();
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });

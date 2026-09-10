import "dotenv/config";
import { randomUUID } from "node:crypto";
import { prisma } from "../apps/api/node_modules/@baolu/db/dist/index.js";
import { createTenantWorkspace } from "../apps/api/src/services/database-bootstrap.js";

// QA-20260910-017 回归：新用户注册**不赠送任何欢迎积分**（2026-09-10 产品口径）。
//
// 背景：QA-20260910-016 曾把「欢迎积分只发租户级 CreditAccount、货架读用户 Wallet」
// 当作缺陷，并按「口径 B」给用户钱包补发 300。同日产品拍板改为**不送任何积分**，
// 因此 016 的目标改为「两个账本都不发」，本脚本锁死新的契约：
//   1. 新建工作区（新用户）→ 用户级 Wallet 存在且为 0/0，没有 WalletLedger 流水；
//   2. 同租户遗留 CreditAccount 为 0，且没有 welcome_credits 的 CreditTransaction；
//   3. 同一用户第二次建工作区 → 仍然 0，不重复发放、不产生流水；
//   4. 只有显式配置 `NEW_USER_<类型>_TRIAL_CREDITS` 的隔离环境才发放，且两个账本额度一致。
//
// 期望额度按当前进程的环境变量动态推导，因此同一个脚本既能验证生产口径（0），
// 也能验证内测环境显式打开体验额度时的行为。

const EXPECTED_WELCOME_CREDITS = Number(process.env.NEW_USER_LOCAL_TRIAL_CREDITS ?? 0);

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

import "dotenv/config";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { prisma } from "../apps/api/node_modules/@baolu/db/dist/index.js";
import { createTenantWorkspace } from "../apps/api/src/services/database-bootstrap.js";
import { consumeWalletCredits } from "../apps/api/src/services/sitong-wallet.js";

// PLAT-10 回归：销售审核后**手工定向发放**体验额度（`scripts/grant-marketplace-trial-credits.mjs`）。
//
// 锁死的契约：
//   1. 新用户注册仍然是 0/0，体验额度只能由运营显式发放（不自动赠送）；
//   2. 发放落到用户级钱包 `bonus` 桶，租户级遗留 `CreditAccount` 不被写（货架只读钱包，避免双账本口径分叉）；
//   3. 同一 `--grant-id` 幂等：重复执行不重复加币，换金额直接失败；
//   4. 金额边界与身份定位失败（未知手机号 / 多账号 / 租户不匹配）必须失败关闭；
//   5. `--dry-run` 不写余额、不写流水；
//   6. 用户之间隔离：给别人发额度不影响我的余额；
//   7. 体验额度能真实走货架扣费链：先扣 paid（为 0），再扣 bonus，余额不足时不产生消耗流水。

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const CLI_RELATIVE_PATH = "scripts/grant-marketplace-trial-credits.mjs";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

function runGrant(args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [CLI_RELATIVE_PATH, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: process.env
  });
  return { status: result.status ?? -1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

const createdTenantIds: string[] = [];
const createdUserIds: string[] = [];

async function cleanup(): Promise<void> {
  for (const userId of createdUserIds) {
    await prisma.walletLedger.deleteMany({ where: { userId } });
    await prisma.wallet.deleteMany({ where: { userId } });
  }
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
    await prisma.user.deleteMany({ where: { id: userId } });
  }
}

async function registerMerchant(label: string) {
  const suffix = randomUUID();
  const workspace = await createTenantWorkspace({
    planCode: "local_standard",
    tenantName: `Trial Grant Smoke ${label} ${suffix}`,
    nickname: `Trial Grant Smoke ${label} Owner`
  });
  createdTenantIds.push(workspace.tenant.id);
  createdUserIds.push(workspace.user.id);
  return workspace;
}

async function readWallet(userId: string) {
  const wallet = await prisma.wallet.findUnique({ where: { userId } });
  assert(wallet !== null, `wallet exists for ${userId}`);
  return wallet;
}

async function main(): Promise<void> {
  try {
    await runScenarios();
    console.log("PASS marketplace-trial-grant-smoke");
  } finally {
    await cleanup();
  }
}

async function runScenarios(): Promise<void> {
  const merchantA = await registerMerchant("A");
  const merchantB = await registerMerchant("B");

  // 前置契约：注册即 0 积分，没有欢迎积分流水。
  const initialWallet = await readWallet(merchantA.user.id);
  assert(
    initialWallet.paidBalance === 0 && initialWallet.bonusBalance === 0,
    `signup must not grant credits (got paid=${initialWallet.paidBalance} bonus=${initialWallet.bonusBalance})`
  );
  assert(
    (await prisma.walletLedger.count({ where: { userId: merchantA.user.id } })) === 0,
    "signup must not write any wallet ledger row"
  );

  const grantId = `20260911-smoke-${randomUUID().slice(0, 8)}`;

  // 场景 1：正常发放 → bonus 桶 +400，paid 不变，一条 grant 流水。
  const created = runGrant([
    "--user-id",
    merchantA.user.id,
    "--amount",
    "400",
    "--grant-id",
    grantId,
    "--operator",
    "smoke-sales"
  ]);
  assert(created.status === 0, `grant exits 0 (stderr=${created.stderr.trim()})`);
  assert(
    created.stdout.includes(`marketplace_trial_grant=created`) &&
      created.stdout.includes(`bonus_balance=400`),
    `grant reports created with bonus_balance=400 (stdout=${created.stdout.trim()})`
  );

  const walletAfterGrant = await readWallet(merchantA.user.id);
  assert(
    walletAfterGrant.bonusBalance === 400 && walletAfterGrant.paidBalance === 0,
    `trial credits land in bonus bucket (got paid=${walletAfterGrant.paidBalance} bonus=${walletAfterGrant.bonusBalance})`
  );
  const grantLedger = await prisma.walletLedger.findMany({ where: { userId: merchantA.user.id } });
  assert(grantLedger.length === 1, `exactly 1 wallet ledger row after grant (got ${grantLedger.length})`);
  assert(grantLedger[0].delta === 400, `grant ledger delta is 400 (got ${grantLedger[0].delta})`);
  assert(grantLedger[0].bucket === "bonus", `grant ledger bucket is bonus (got ${grantLedger[0].bucket})`);
  assert(grantLedger[0].type === "bonus", `grant ledger type is bonus (got ${grantLedger[0].type})`);
  assert(
    grantLedger[0].source === `trial_grant:${grantId}`,
    `grant ledger source carries the operator grant id (got ${grantLedger[0].source})`
  );

  // 场景 2：租户级遗留账本不被写（避免「钱包 +400、CreditAccount +400」双账本口径分叉）。
  const legacyAccount = await prisma.creditAccount.findUnique({ where: { tenantId: merchantA.tenant.id } });
  assert(legacyAccount !== null, "legacy tenant credit account still exists");
  assert(legacyAccount.balance === 0, `trial grant must not touch the legacy tenant account (got ${legacyAccount.balance})`);

  // 场景 3：同一 grant-id 重放 → 幂等，不重复加币。
  const replay = runGrant([
    "--user-id",
    merchantA.user.id,
    "--amount",
    "400",
    "--grant-id",
    grantId
  ]);
  assert(replay.status === 0, `idempotent replay exits 0 (stderr=${replay.stderr.trim()})`);
  assert(
    replay.stdout.includes("marketplace_trial_grant=already_applied"),
    `replay reports already_applied (stdout=${replay.stdout.trim()})`
  );
  const walletAfterReplay = await readWallet(merchantA.user.id);
  assert(
    walletAfterReplay.bonusBalance === 400,
    `replay must not double grant (got bonus=${walletAfterReplay.bonusBalance})`
  );
  assert(
    (await prisma.walletLedger.count({ where: { userId: merchantA.user.id } })) === 1,
    "replay must not add a wallet ledger row"
  );

  // 场景 4：同一 grant-id 换金额 → 失败关闭，不动余额。
  const conflict = runGrant([
    "--user-id",
    merchantA.user.id,
    "--amount",
    "500",
    "--grant-id",
    grantId
  ]);
  assert(conflict.status !== 0, "grant id reused with a different amount must fail");
  assert(
    conflict.stderr.includes("grant_id_conflict"),
    `conflict error is explicit (stderr=${conflict.stderr.trim()})`
  );
  const walletAfterConflict = await readWallet(merchantA.user.id);
  assert(
    walletAfterConflict.bonusBalance === 400,
    `conflicting grant must not change the balance (got bonus=${walletAfterConflict.bonusBalance})`
  );

  // 场景 5：金额边界与身份定位失败都必须拒绝执行。
  const zeroAmount = runGrant([
    "--user-id",
    merchantA.user.id,
    "--amount",
    "0",
    "--grant-id",
    `20260911-smoke-zero-${randomUUID().slice(0, 8)}`
  ]);
  assert(zeroAmount.status !== 0, "amount 0 must be rejected");
  assert(zeroAmount.stderr.includes("--amount must be"), `amount 0 error is explicit (got ${zeroAmount.stderr.trim()})`);

  const overCap = runGrant([
    "--user-id",
    merchantA.user.id,
    "--amount",
    "801",
    "--grant-id",
    `20260911-smoke-cap-${randomUUID().slice(0, 8)}`
  ]);
  assert(overCap.status !== 0, "amount above the hard cap must be rejected");
  assert(overCap.stderr.includes("--amount must be"), `over-cap error is explicit (got ${overCap.stderr.trim()})`);

  const noSelector = runGrant([
    "--amount",
    "200",
    "--grant-id",
    `20260911-smoke-nosel-${randomUUID().slice(0, 8)}`
  ]);
  assert(noSelector.status !== 0, "grant without an identity selector must be rejected");
  assert(
    noSelector.stderr.includes("exactly one identity selector"),
    `missing selector error is explicit (got ${noSelector.stderr.trim()})`
  );

  const unknownPhone = runGrant([
    "--phone",
    `139${randomUUID().replace(/\D/g, "").slice(0, 8)}`,
    "--amount",
    "200",
    "--grant-id",
    `20260911-smoke-404-${randomUUID().slice(0, 8)}`
  ]);
  assert(unknownPhone.status !== 0, "unknown phone must fail");
  assert(
    unknownPhone.stderr.includes("user_not_found"),
    `unknown phone error is explicit (got ${unknownPhone.stderr.trim()})`
  );

  const tenantMismatch = runGrant([
    "--user-id",
    merchantA.user.id,
    "--tenant-id",
    merchantB.tenant.id,
    "--amount",
    "200",
    "--grant-id",
    `20260911-smoke-tenant-${randomUUID().slice(0, 8)}`
  ]);
  assert(tenantMismatch.status !== 0, "granting into the wrong workspace must fail");
  assert(
    tenantMismatch.stderr.includes("tenant_mismatch"),
    `tenant mismatch error is explicit (got ${tenantMismatch.stderr.trim()})`
  );

  // 场景 6：dry-run 不改余额、不写流水。
  const dryRunId = `20260911-smoke-dry-${randomUUID().slice(0, 8)}`;
  const dryRun = runGrant([
    "--user-id",
    merchantB.user.id,
    "--amount",
    "300",
    "--grant-id",
    dryRunId,
    "--dry-run"
  ]);
  assert(dryRun.status === 0, `dry-run exits 0 (stderr=${dryRun.stderr.trim()})`);
  assert(dryRun.stdout.includes("marketplace_trial_grant=dry_run"), `dry-run state is reported (stdout=${dryRun.stdout.trim()})`);
  const walletAfterDryRun = await readWallet(merchantB.user.id);
  assert(
    walletAfterDryRun.bonusBalance === 0 && walletAfterDryRun.paidBalance === 0,
    `dry-run must not write balances (got paid=${walletAfterDryRun.paidBalance} bonus=${walletAfterDryRun.bonusBalance})`
  );
  assert(
    (await prisma.walletLedger.count({ where: { userId: merchantB.user.id } })) === 0,
    "dry-run must not write a ledger row"
  );

  // 场景 7：发给 B 不影响 A（用户级隔离）。
  const grantToB = runGrant([
    "--user-id",
    merchantB.user.id,
    "--amount",
    "200",
    "--grant-id",
    `20260911-smoke-b-${randomUUID().slice(0, 8)}`
  ]);
  assert(grantToB.status === 0, `grant to second merchant exits 0 (stderr=${grantToB.stderr.trim()})`);
  assert(
    (await readWallet(merchantB.user.id)).bonusBalance === 200,
    "second merchant keeps its own trial credits"
  );
  assert(
    (await readWallet(merchantA.user.id)).bonusBalance === 400,
    "granting to another user must not change the first user's balance"
  );

  // 场景 8：体验额度能真实走货架扣费链（paid=0 → 扣 bonus）。
  const consume = await consumeWalletCredits({
    userId: merchantA.user.id,
    requestId: `smoke-consume-${randomUUID()}`,
    price: 200,
    skillId: "ip-pos",
    source: "smoke"
  });
  assert(consume.status === "completed", `trial credits are spendable (status=${consume.status})`);
  assert(
    consume.wallet.bonusBalance === 200 && consume.wallet.paidBalance === 0,
    `trial credits are charged to the bonus bucket after paid (got paid=${consume.wallet.paidBalance} bonus=${consume.wallet.bonusBalance})`
  );

  const insufficient = await consumeWalletCredits({
    userId: merchantA.user.id,
    requestId: `smoke-consume-over-${randomUUID()}`,
    price: 300,
    skillId: "ip-pos",
    source: "smoke"
  });
  assert(insufficient.status === "insufficient", "insufficient trial credits must block the run");
  const walletAfterInsufficient = await readWallet(merchantA.user.id);
  assert(
    walletAfterInsufficient.bonusBalance === 200,
    `insufficient attempt must not charge (got bonus=${walletAfterInsufficient.bonusBalance})`
  );
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

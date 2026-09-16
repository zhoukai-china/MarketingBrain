// LQ-34「迁移口径」离线回归（内存事务夹具，不连库、不发外部请求）。
//
// 真实缺陷（2026-09-16 生产 dry-run 实测）：`planLanqiWalletMigration()` 第一版是
// 「全库扫 `CreditAccount.balance > 0`」，挑出 201 个有余额账户，其中**兰琪只有 2 个（508 积分）**，
// 另外 199 个是外卖 / 创始人 IP / 测试线的历史额度（含一条 20 亿积分的测试租户）。
// 照着那份计划 apply，就是把别的产品线的钱挪进兰琪 owner 钱包——不可逆的跨产品挪账。
//
// 这条演练把口径钉死（修复后必须全绿；修复前 ③④ 会红）：
//   ① 有兰琪门店档案 → 在计划里；
//   ② 只有 lanqi 产品权益、没有门店档案 → 也要在计划里（生产上两个真实兰琪租户正是这种形状）；
//   ③ 非兰琪租户（外卖 20 亿）→ 不进计划，且 apply 也不许碰；
//   ④ 非兰琪 + 没有 owner → 不许被列成 owner_missing（否则会被人当成「兰琪待处理」去手工迁）；
//   ⑤ 兰琪余额 0 → 不进计划；
//   ⑥ 已迁过 → already_migrated，重复 apply 不翻倍；
//   ⑦ 兰琪无 owner → owner_missing，不迁、不动账；
//   ⑧ 人工塞进计划的非兰琪项 → apply 第二道校验 not_lanqi_tenant，账户与钱包分毫未动；
//   ⑨ 迁移落账口径：额度进 paid 桶、写 admin 流水 + 账户 adjust 流水、账户清零**但保留行**；
//   ⑩ 回滚：钱包 paid 足额才退，退完可重复调用（already_reverted）；钱已花掉 → blocked 且不动账。
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  applyLanqiWalletMigration,
  auditLanqiWalletMigrationScope,
  planLanqiWalletMigration,
  resolveLanqiTenantScope,
  revertLanqiWalletMigration,
  lanqiMigrationRequestId,
  type LanqiMigrationPlanEntry
} from "../apps/api/src/services/lanqi-wallet-migration.js";
import { replicationMemoryDb } from "./fixtures/replication-test-db.js";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    pass += 1;
    console.log(`ok - ${name}`);
  } else {
    fail += 1;
    console.error(`FAIL - ${name}${detail ? ` :: ${detail}` : ""}`);
  }
}

const suffix = randomUUID().slice(0, 8);

type SeedKind = "store_profile" | "entitlement" | "both" | "none";

async function seedTenant(
  db: any,
  label: string,
  opts: { kind: SeedKind; owner?: boolean; balance: number }
) {
  const tenantId = `drill-${label}-${suffix}`;
  await db.tenant.create({ data: { id: tenantId, name: `Synthetic ${label}`, type: "local_business" } });
  if (opts.kind === "store_profile" || opts.kind === "both") {
    await db.lanqiStoreProfile.create({
      data: { tenantId, confirmedFacts: {}, estimatedFacts: {}, needsInput: {} }
    });
  }
  if (opts.kind === "entitlement" || opts.kind === "both") {
    await db.tenantProductEntitlement.create({
      data: { tenantId, productCode: "lanqi", status: "active", source: "drill" }
    });
  }
  let ownerUserId: string | undefined;
  if (opts.owner !== false) {
    ownerUserId = `drill-user-${label}-${suffix}`;
    await db.user.create({ data: { id: ownerUserId, nickname: "Synthetic" } });
    await db.membership.create({ data: { tenantId, userId: ownerUserId, role: "owner", isActive: true } });
  }
  if (opts.balance > 0) {
    await db.creditAccount.create({ data: { tenantId, balance: opts.balance } });
  }
  return { tenantId, ownerUserId };
}

const entryOf = (plan: LanqiMigrationPlanEntry[], tenantId: string) =>
  plan.find((entry) => entry.tenantId === tenantId);

async function main() {
  const db = replicationMemoryDb();

  // 生产形状的合成夹具：两条兰琪（一条有门店档案、一条只有权益），两条非兰琪（含 20 亿外卖测试）。
  const viaProfile = await seedTenant(db, "lanqi-profile", { kind: "store_profile", balance: 1200 });
  const viaEntitlement = await seedTenant(db, "lanqi-entitlement", { kind: "entitlement", balance: 208 });
  const both = await seedTenant(db, "lanqi-both", { kind: "both", balance: 300 });
  const zeroBalance = await seedTenant(db, "lanqi-zero", { kind: "entitlement", balance: 0 });
  const noOwner = await seedTenant(db, "lanqi-noowner", { kind: "entitlement", owner: false, balance: 88 });
  const takeaway = await seedTenant(db, "takeaway", { kind: "none", balance: 2_000_000_000 });
  const orphanOther = await seedTenant(db, "founder-ip-noowner", { kind: "none", owner: false, balance: 998_277 });

  // ⚠️ 顺序是刻意的：先用只依赖 `planLanqiWalletMigration()` 的断言证明「口径漏过滤」这个真实缺陷，
  // 再验证新引入的口径函数 / 审计口径。修复前（旧实现）前三组必须红。
  const plan = await planLanqiWalletMigration(db);
  const planIds = plan.map((entry) => entry.tenantId);
  check(
    "③ 非兰琪的 20 亿测试租户不在迁移计划里（修复前会在这里红）",
    !planIds.includes(takeaway.tenantId),
    JSON.stringify(plan.filter((entry) => entry.tenantId === takeaway.tenantId))
  );
  check(
    "④ 非兰琪且没有 owner 的租户不会被列成 owner_missing 去误导人工处理",
    !planIds.includes(orphanOther.tenantId) &&
      plan.filter((entry) => entry.status === "owner_missing").every((entry) => entry.tenantId === noOwner.tenantId),
    JSON.stringify(plan.filter((entry) => entry.status === "owner_missing"))
  );
  check(
    "⑤ 兰琪余额 0 不进计划（没有 CreditAccount 行也不进）",
    !planIds.includes(zeroBalance.tenantId),
    JSON.stringify(planIds)
  );
  check(
    "② 只有产品权益、没有门店档案的兰琪租户也在计划里（生产的真实形状）",
    Boolean(entryOf(plan, viaEntitlement.tenantId)) &&
      JSON.stringify(entryOf(plan, viaEntitlement.tenantId)?.lanqiScope) === JSON.stringify(["product_entitlement"]),
    JSON.stringify(entryOf(plan, viaEntitlement.tenantId))
  );
  check(
    "⑦ 兰琪无 owner → owner_missing（会被人工看到，但不会被迁）",
    entryOf(plan, noOwner.tenantId)?.status === "owner_missing",
    JSON.stringify(entryOf(plan, noOwner.tenantId))
  );
  check(
    "计划里每一行都有兰琪依据（不允许出现空依据的行）",
    plan.every((entry) => entry.lanqiScope.length > 0),
    JSON.stringify(plan.map((entry) => [entry.tenantId, entry.lanqiScope]))
  );

  const scope = await resolveLanqiTenantScope(db);
  check(
    "① 兰琪口径只认「门店档案 ∪ lanqi 权益」，非兰琪租户不在集合里",
    scope.has(viaProfile.tenantId) &&
      scope.has(viaEntitlement.tenantId) &&
      scope.has(both.tenantId) &&
      !scope.has(takeaway.tenantId) &&
      !scope.has(orphanOther.tenantId),
    JSON.stringify([...scope.keys()])
  );
  check(
    "① 口径依据分得清：门店档案 / 产品权益 / 两者都有",
    JSON.stringify(scope.get(viaProfile.tenantId)) === JSON.stringify(["store_profile"]) &&
      JSON.stringify(scope.get(viaEntitlement.tenantId)) === JSON.stringify(["product_entitlement"]) &&
      JSON.stringify(scope.get(both.tenantId)) === JSON.stringify(["store_profile", "product_entitlement"]),
    JSON.stringify(Object.fromEntries(scope))
  );

  const audit = await auditLanqiWalletMigrationScope(db);
  check(
    "⑧ 审计口径：全库 6 个有余额账户 / 兰琪口径 4 个，被排除 2 个 = 20 亿 + 998277",
    audit.allCreditAccountsWithBalance === 6 &&
      audit.inScopeAccounts === 4 &&
      audit.excludedAccounts === 2 &&
      audit.excludedCredits === 2_000_000_000 + 998_277 &&
      audit.lanqiTenantCount === 5,
    JSON.stringify(audit)
  );
  check(
    "⑧ 审计把「别动的那笔钱」单独报出来（20 亿外卖测试 + 998277 创始人 IP，均不在兰琪口径内）",
    audit.allCreditsWithBalance - audit.inScopeCredits === 2_000_000_000 + 998_277,
    JSON.stringify(audit)
  );

  // ⑧ 第二道校验：即使计划是人工拼的，非兰琪租户也不许被迁。
  const forged: LanqiMigrationPlanEntry = {
    tenantId: takeaway.tenantId,
    tenantName: "Synthetic takeaway",
    balance: 2_000_000_000,
    ownerUserId: takeaway.ownerUserId,
    status: "migratable",
    lanqiScope: ["product_entitlement"]
  };
  const forgedResult = await applyLanqiWalletMigration([forged], db);
  const takeawayWallet = await db.wallet.findFirst({ where: { userId: takeaway.ownerUserId } });
  const takeawayAccount = await db.creditAccount.findFirst({ where: { tenantId: takeaway.tenantId } });
  check(
    "⑧ 人工塞进来的非兰琪计划项被 apply 拦下（not_lanqi_tenant）",
    forgedResult.length === 1 && forgedResult[0].skipped === "not_lanqi_tenant" && forgedResult[0].migrated === 0,
    JSON.stringify(forgedResult)
  );
  check(
    "⑧ 拦下之后：外卖租户账户余额未清零、钱包未加钱、没有迁移流水",
    takeawayAccount?.balance === 2_000_000_000 &&
      (takeawayWallet?.paidBalance ?? 0) === 0 &&
      (await db.walletLedger.count({ where: { refRequestId: lanqiMigrationRequestId(takeaway.tenantId) } })) === 0,
    JSON.stringify({ takeawayAccount, takeawayWallet })
  );

  // ⑨ 正常迁移：额度进 paid 桶、账户清零保留行、两条留痕。
  const results = await applyLanqiWalletMigration(plan, db);
  const migratedIds = results.filter((item) => item.migrated > 0).map((item) => item.tenantId);
  const profileFunds = await db.wallet.findFirst({ where: { userId: viaProfile.ownerUserId } });
  const profileAccount = await db.creditAccount.findFirst({ where: { tenantId: viaProfile.tenantId } });
  const profileLedger = await db.walletLedger.findFirst({
    where: { refRequestId: lanqiMigrationRequestId(viaProfile.tenantId) }
  });
  const profileAdjust = await db.creditTransaction.findFirst({ where: { tenantId: viaProfile.tenantId } });
  check(
    "⑨ 兰琪 3 个可迁租户都迁了（1200 + 208 + 300），无 owner 的那个没迁",
    migratedIds.length === 3 &&
      results.find((item) => item.tenantId === noOwner.tenantId)?.skipped === "owner_missing",
    JSON.stringify(results)
  );
  check(
    "⑨ 额度进 paid 桶（不是 bonus）、账户清零且保留行",
    profileFunds?.paidBalance === 1200 &&
      profileFunds?.bonusBalance === 0 &&
      profileAccount !== null &&
      profileAccount?.balance === 0,
    JSON.stringify({ profileFunds, profileAccount })
  );
  check(
    "⑨ 留痕两条：钱包 admin 流水（source=lanqi_credit_migration:<tenantId>）+ 账户 adjust 流水",
    profileLedger?.type === "admin" &&
      profileLedger?.delta === 1200 &&
      profileLedger?.bucket === "paid" &&
      profileLedger?.source === `lanqi_credit_migration:${viaProfile.tenantId}` &&
      profileAdjust?.direction === "adjust" &&
      profileAdjust?.amount === 1200 &&
      profileAdjust?.reason === "lanqi_credit_migration_to_wallet",
    JSON.stringify({ profileLedger, profileAdjust })
  );

  // ⑥ 幂等：重复 apply 不翻倍。
  const secondPlan = await planLanqiWalletMigration(db);
  check(
    "⑥ 迁过的租户第二次出现在计划里是 already_migrated",
    secondPlan
      .filter((entry) => [viaProfile.tenantId, viaEntitlement.tenantId, both.tenantId].includes(entry.tenantId))
      .every((entry) => entry.status === "already_migrated"),
    JSON.stringify(secondPlan)
  );
  const reapply = await applyLanqiWalletMigration(secondPlan, db);
  const profileFunds2 = await db.wallet.findFirst({ where: { userId: viaProfile.ownerUserId } });
  check(
    "⑥ 重复 apply 不重复发放（钱包还是 1200，流水还是 1 条）",
    profileFunds2?.paidBalance === 1200 &&
      reapply.every((item) => item.migrated === 0) &&
      (await db.walletLedger.count({ where: { refRequestId: lanqiMigrationRequestId(viaProfile.tenantId) } })) === 1,
    JSON.stringify({ profileFunds2, reapply })
  );

  // ⑩ 回滚。
  const revert = await revertLanqiWalletMigration([viaEntitlement.tenantId], db);
  const revertedFunds = await db.wallet.findFirst({ where: { userId: viaEntitlement.ownerUserId } });
  const revertedAccount = await db.creditAccount.findFirst({ where: { tenantId: viaEntitlement.tenantId } });
  check(
    "⑩ 回滚：钱包 paid 扣回 208、租户账户回填 208",
    revert[0]?.reverted === 208 && revertedFunds?.paidBalance === 0 && revertedAccount?.balance === 208,
    JSON.stringify({ revert, revertedFunds, revertedAccount })
  );
  const revertAgain = await revertLanqiWalletMigration([viaEntitlement.tenantId], db);
  check(
    "⑩ 重复回滚被挡（already_reverted，不会退两次）",
    revertAgain[0]?.blocked === "already_reverted" && (await db.wallet.findFirst({ where: { userId: viaEntitlement.ownerUserId } }))?.paidBalance === 0,
    JSON.stringify(revertAgain)
  );
  await db.wallet.update({
    where: { userId: viaProfile.ownerUserId },
    data: { paidBalance: 100 }
  });
  const revertSpent = await revertLanqiWalletMigration([viaProfile.tenantId], db);
  check(
    "⑩ 钱已花掉（paid 100 < 迁移的 1200）→ blocked，且不动账",
    revertSpent[0]?.blocked === "wallet_paid_insufficient" &&
      (await db.wallet.findFirst({ where: { userId: viaProfile.ownerUserId } }))?.paidBalance === 100 &&
      (await db.creditAccount.findFirst({ where: { tenantId: viaProfile.tenantId } }))?.balance === 0,
    JSON.stringify(revertSpent)
  );
}

main()
  .catch((error) => {
    fail += 1;
    console.error("FAIL - 未捕获异常", error);
  })
  .finally(() => {
    assert.ok(true);
    console.log(
      JSON.stringify({
        result: fail === 0 ? "LANQI_WALLET_MIGRATION_SCOPE_DRILL_PASS" : "LANQI_WALLET_MIGRATION_SCOPE_DRILL_FAIL",
        passed: pass,
        failed: fail,
        db: "transactional_fixture",
        externalCalls: 0,
        providerCalls: 0,
        costYuan: 0
      })
    );
    process.exit(fail === 0 ? 0 : 1);
  });

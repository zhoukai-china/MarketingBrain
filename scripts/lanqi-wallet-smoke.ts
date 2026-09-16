// LQ-34 兰琪通用钱包（扣租户 owner 钱包）离线回归。
//
// 覆盖用户 2026-09-16 拍板的口径：
//   ① 兰琪不管谁操作，都扣**租户老板（owner）钱包**（操作人只进流水）；
//   ② 找不到 owner → fail closed（不扣费、不放行）；
//   ③ 余额不足先挡下；扣费幂等（同 requestId 不重复扣）；
//   ④ 退款**按原扣费流水回退到原桶**且只退一次；
//   ⑤ 跨租户隔离（另一个门店的 owner 钱包不受影响）；
//   ⑥ 余额读取 = owner 钱包余额（与「我的 · 充值」同一本）。
//
// 这是数据库级回归：会建临时租户/用户/钱包，跑完清理。
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { prisma } from "../apps/api/node_modules/@baolu/db/dist/index.js";
import {
  LANQI_WALLET_VERSION,
  chargeLanqiWallet,
  lanqiWalletRequestId,
  precheckLanqiWallet,
  readLanqiWalletBalance,
  refundLanqiWallet
} from "../apps/api/src/services/lanqi-wallet.js";
import {
  applyLanqiWalletMigration,
  lanqiMigrationRequestId,
  planLanqiWalletMigration,
  revertLanqiWalletMigration
} from "../apps/api/src/services/lanqi-wallet-migration.js";

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
const createdUserIds: string[] = [];
const createdTenantIds: string[] = [];

async function createTenantWithOwner(label: string, role: "owner" | "staff" = "owner") {
  const user = await prisma.user.create({
    data: { nickname: `LQ34 ${label} ${suffix}` }
  });
  const tenant = await prisma.tenant.create({
    data: { name: `LQ34 ${label} ${suffix}`, type: "local_business", industry: "beauty", city: "烟台" }
  });
  await prisma.membership.create({
    data: { tenantId: tenant.id, userId: user.id, role, isActive: true }
  });
  createdUserIds.push(user.id);
  createdTenantIds.push(tenant.id);
  return { userId: user.id, tenantId: tenant.id };
}

async function seedWallet(userId: string, paid: number, bonus = 0) {
  await prisma.wallet.create({ data: { userId, paidBalance: paid, bonusBalance: bonus } });
}

async function main() {
  // 准备：门店 A（老板钱包 100 paid + 20 bonus）、门店 B（老板钱包 500）、门店 C（只有 staff，没有 owner）
  const a = await createTenantWithOwner("a");
  const b = await createTenantWithOwner("b");
  const c = await createTenantWithOwner("c", "staff");
  await seedWallet(a.userId, 100, 20);
  await seedWallet(b.userId, 500);

  // ① 余额读取 = owner 钱包
  const balanceA = await readLanqiWalletBalance(a.tenantId);
  check("余额读取 = owner 钱包（100 + 20）", balanceA?.balance === 120 && balanceA?.ownerUserId === a.userId, JSON.stringify(balanceA));

  // ② 找不到 owner → fail closed
  const noOwner = await precheckLanqiWallet({ tenantId: c.tenantId, credits: 1 });
  check("找不到 owner：前置校验 fail closed（不扣费）", noOwner.ok === false && noOwner.code === "lanqi_wallet_owner_missing", JSON.stringify(noOwner));
  const noOwnerCharge = await chargeLanqiWallet({ tenantId: c.tenantId, requestId: "req-no-owner", credits: 1, skillId: "lanqi_copy_kit" });
  check("找不到 owner：扣费显式 owner_missing（绝不扣到别人头上）", noOwnerCharge.status === "owner_missing", JSON.stringify(noOwnerCharge));

  // ③ 余额不足先挡下
  const tooMuch = await precheckLanqiWallet({ tenantId: a.tenantId, credits: 999 });
  check("余额不足：前置校验给出 insufficient_credits + 余额", tooMuch.ok === false && tooMuch.code === "insufficient_credits" && tooMuch.balance === 120, JSON.stringify(tooMuch));

  // ④ 扣费：扣 owner 钱包，操作人只进流水
  const requestId = "req-charge-0001";
  const charge = await chargeLanqiWallet({ tenantId: a.tenantId, operatorUserId: "staff-operator-1", requestId, credits: 40, skillId: "lanqi_copy_kit" });
  check("扣费：状态 completed", charge.status === "completed", JSON.stringify(charge).slice(0, 160));
  check("扣费：扣的是 owner 钱包（120 → 80）", charge.status === "completed" && charge.wallet.balance === 80, JSON.stringify(charge.status === "completed" ? charge.wallet : {}));
  check("扣费：paid 桶先扣 40（先 paid 后 bonus）", charge.status === "completed" && charge.spent.paid === 40 && charge.spent.bonus === 0, JSON.stringify(charge.status === "completed" ? charge.spent : {}));
  const ledger = await prisma.walletLedger.findFirst({
    where: { userId: a.userId, refRequestId: lanqiWalletRequestId(a.tenantId, requestId), type: "consume" },
    select: { source: true, delta: true, bucket: true }
  });
  check("扣费：流水记了操作人（谁操作的）", Boolean(ledger?.source?.includes("operator=staff-operator-1")), JSON.stringify(ledger));
  check("扣费：幂等键带租户前缀（不同门店不撞键）", lanqiWalletRequestId(a.tenantId, requestId) !== lanqiWalletRequestId(b.tenantId, requestId));

  // ⑤ 幂等：同 requestId 再扣一次不重复扣
  const chargeAgain = await chargeLanqiWallet({ tenantId: a.tenantId, requestId, credits: 40, skillId: "lanqi_copy_kit" });
  check("扣费幂等：同 requestId 不重复扣（金额不变）", chargeAgain.status === "completed" && chargeAgain.idempotent === true && chargeAgain.wallet.balance === 80, JSON.stringify(chargeAgain).slice(0, 160));

  // ⑥ 退款：按原桶退回，且只退一次
  const refund = await refundLanqiWallet({ tenantId: a.tenantId, requestId, skillId: "lanqi_copy_kit" });
  check("退款：回到原桶（paid 40）", refund.status === "refunded" && refund.refunded === 40 && refund.wallet.balance === 120, JSON.stringify(refund).slice(0, 160));
  const refundAgain = await refundLanqiWallet({ tenantId: a.tenantId, requestId, skillId: "lanqi_copy_kit" });
  check("退款幂等：同 requestId 只退一次", refundAgain.status === "refunded" && refundAgain.idempotent === true && refundAgain.wallet.balance === 120, JSON.stringify(refundAgain).slice(0, 160));

  // ⑦ 跨租户隔离：门店 B 的钱包不受门店 A 的扣费 / 退款影响
  const balanceB = await readLanqiWalletBalance(b.tenantId);
  check("跨租户隔离：另一门店钱包分毫未动", balanceB?.balance === 500, JSON.stringify(balanceB));

  // ⑧ 版本常量（便于审计「这本账是哪一版口径」）
  check("口径版本常量存在", LANQI_WALLET_VERSION === "lanqi_owner_wallet_v1", LANQI_WALLET_VERSION);

  // ⑨ 历史额度一次性迁移（Phase 2）：租户账户 50 → owner 钱包 paid 桶；幂等；可回滚
  const d = await createTenantWithOwner("d");
  await seedWallet(d.userId, 0);
  await prisma.creditAccount.create({ data: { tenantId: d.tenantId, balance: 50 } });
  const planAll = await planLanqiWalletMigration();
  const mine = planAll.filter((entry) => entry.tenantId === d.tenantId);
  check("迁移计划：本租户被列为可迁（50 积分）", mine.length === 1 && mine[0].status === "migratable" && mine[0].balance === 50, JSON.stringify(mine));
  await applyLanqiWalletMigration(mine);
  const walletAfterMigrate = await readLanqiWalletBalance(d.tenantId);
  const accountAfterMigrate = await prisma.creditAccount.findUnique({ where: { tenantId: d.tenantId }, select: { balance: true } });
  check("迁移：额度进 owner 钱包 paid 桶（0 → 50）", walletAfterMigrate?.paidBalance === 50, JSON.stringify(walletAfterMigrate));
  check("迁移：租户账户清零（保留行、不删数据）", accountAfterMigrate?.balance === 0, JSON.stringify(accountAfterMigrate));
  const migrateLedger = await prisma.walletLedger.findFirst({
    where: { refRequestId: lanqiMigrationRequestId(d.tenantId), type: "admin" },
    select: { delta: true, bucket: true, source: true }
  });
  check("迁移：留痕（钱包 admin 流水 + 迁移来源）", migrateLedger?.delta === 50 && migrateLedger?.bucket === "paid" && Boolean(migrateLedger?.source?.includes("lanqi_credit_migration")), JSON.stringify(migrateLedger));
  const migrationAgain = await applyLanqiWalletMigration(mine);
  const walletAfterSecond = await readLanqiWalletBalance(d.tenantId);
  check("迁移幂等：重复执行不重复发放", migrationAgain[0]?.migrated === 0 && walletAfterSecond?.paidBalance === 50, JSON.stringify({ migrationAgain, walletAfterSecond }));
  const reverted = await revertLanqiWalletMigration([d.tenantId]);
  const walletAfterRevert = await readLanqiWalletBalance(d.tenantId);
  const accountAfterRevert = await prisma.creditAccount.findUnique({ where: { tenantId: d.tenantId }, select: { balance: true } });
  check("迁移可回滚：钱包 paid 退回、账户额度恢复", reverted[0]?.reverted === 50 && walletAfterRevert?.paidBalance === 0 && accountAfterRevert?.balance === 50, JSON.stringify({ reverted, walletAfterRevert, accountAfterRevert }));
  const revertAgain = await revertLanqiWalletMigration([d.tenantId]);
  check("回滚幂等：重复回滚 blocked=already_reverted", revertAgain[0]?.blocked === "already_reverted", JSON.stringify(revertAgain));
}

main()
  .catch((error) => {
    fail += 1;
    console.error("FAIL - 未捕获异常", error);
  })
  .finally(async () => {
    // 清理：删租户（级联 membership / creditAccount）与用户（级联 wallet / ledger）
    for (const tenantId of createdTenantIds) {
      await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
    }
    for (const userId of createdUserIds) {
      await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    }
    await prisma.$disconnect();
    console.log(`\nlanqi_wallet_smoke: ${fail === 0 ? "PASS" : "FAIL"} (${pass} passed / ${fail} failed)`);
    process.exit(fail === 0 ? 0 : 1);
  });

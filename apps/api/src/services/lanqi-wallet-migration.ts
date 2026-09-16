// LQ-34 历史租户额度 → 通用钱包（owner 钱包）一次性迁移。
//
// 用户 2026-09-16 口径（选 Phase 2，不做双轨）：把历史租户额度**一次性迁进钱包**，
// 下线「钱包不足回退租户账户」的分支，只留一本账。
//
// 口径细则：
// - 迁到该租户 **owner 的钱包**，进 `paid` 桶（历史额度是购买 / 授予所得，不是营销赠送，不设到期）；
// - 每租户一条钱包流水（`type=admin`、`refRequestId=lanqi-migrate:<tenantId>`），**幂等**：重复执行不重复发放；
// - 同时写一条租户账户 `adjust` 流水留痕，再把 `creditAccount.balance` 置 0（**不删行**）；
// - 找不到 owner 的租户**不动**，单独列出来人工处理（绝不迁到别人头上）；
// - 支持 `revert`：把「已迁移且钱包 paid 仍有足额」的租户退回去（超出部分不猜，直接报 blocked）。
import { prisma } from "@baolu/db";
import { getOrCreateWallet, withWalletTransaction, type WalletDb } from "./sitong-wallet.js";

export const LANQI_WALLET_MIGRATION_VERSION = "lanqi_credit_migration_v1" as const;

/** 兰琪产品权益码。迁移口径靠它 +「兰琪门店档案」两条一起认人。 */
export const LANQI_PRODUCT_CODE = "lanqi" as const;

/**
 * 迁移口径（2026-09-16 修正）：**只迁兰琪租户**。
 *
 * 旧实现在全库扫 `CreditAccount.balance > 0`，会把外卖 / 创始人 IP 线的历史额度一起搬进
 * owner 钱包（生产上实测非兰琪账户 199 个、约 20 亿积分，其中一条是外卖测试租户）。那是跨产品
 * 挪账，属于不可逆错误，所以这里把「谁是兰琪租户」写死成两条 **OR**，并且**在 apply 里再校验一次**
 * （计划可以人工改，账不能被骗着挪）：
 *   ① 有兰琪门店档案（`LanqiStoreProfile`）；
 *   ② 持有 lanqi 产品权益（`TenantProductEntitlement.productCode = "lanqi"`，**不看状态**——
 *      权益过期的老门店，历史额度仍是它的钱）。
 *
 * 只按 ① 过滤会漏掉真实门店：生产上两个有余额的兰琪租户（「兰琪」300 积分 / 另一个 208 积分）
 * 都只有产品权益、没有门店档案行。所以必须是 ① ∪ ②。
 */
export const LANQI_TENANT_SCOPE_KEYS = ["store_profile", "product_entitlement"] as const;
export type LanqiTenantScopeKey = (typeof LANQI_TENANT_SCOPE_KEYS)[number];

/**
 * 迁移用的 Prisma 客户端。生产一律走进程级单例；显式传入只给**离线回归**用
 * （`scripts/fixtures/replication-test-db.ts` 的内存库与真实 prisma 同形）。
 */
type LanqiMigrationDb = WalletDb;

export function lanqiMigrationRequestId(tenantId: string): string {
  return `lanqi-migrate:${tenantId}`;
}

export interface LanqiMigrationPlanEntry {
  tenantId: string;
  tenantName: string;
  balance: number;
  ownerUserId?: string;
  status: "migratable" | "owner_missing" | "already_migrated";
  /** 该租户被判定为兰琪租户的依据（用于 dry-run 人工复核，避免"看起来是兰琪就迁"）。 */
  lanqiScope: LanqiTenantScopeKey[];
}

/**
 * 只读：解析兰琪租户集合 =「有门店档案」∪「有 lanqi 权益」。
 * 返回 `tenantId → 依据`，dry-run / 审计 / apply 三处共用同一口径，避免各写一份。
 */
export async function resolveLanqiTenantScope(
  db: LanqiMigrationDb = prisma
): Promise<Map<string, LanqiTenantScopeKey[]>> {
  const [profiles, entitlements] = await Promise.all([
    db.lanqiStoreProfile.findMany({ select: { tenantId: true } }),
    db.tenantProductEntitlement.findMany({
      where: { productCode: LANQI_PRODUCT_CODE },
      select: { tenantId: true }
    })
  ]);
  const hits = new Map<string, Set<LanqiTenantScopeKey>>();
  const mark = (tenantId: string, key: LanqiTenantScopeKey) => {
    const set = hits.get(tenantId) ?? new Set<LanqiTenantScopeKey>();
    set.add(key);
    hits.set(tenantId, set);
  };
  for (const row of profiles) mark(row.tenantId, "store_profile");
  for (const row of entitlements) mark(row.tenantId, "product_entitlement");
  // 依据按固定顺序输出，dry-run 报告可比对（不随查询顺序抖动）。
  const scope = new Map<string, LanqiTenantScopeKey[]>();
  for (const [tenantId, keys] of hits) {
    scope.set(tenantId, LANQI_TENANT_SCOPE_KEYS.filter((key) => keys.has(key)));
  }
  return scope;
}

export interface LanqiMigrationScopeAudit {
  /** 有兰琪门店档案的租户数 */
  lanqiTenantsWithStoreProfile: number;
  /** 有 lanqi 产品权益的租户数 */
  lanqiTenantsWithEntitlement: number;
  /** 兰琪租户去重后的总数 */
  lanqiTenantCount: number;
  /** 全库 `CreditAccount.balance > 0` 的账户数（未过滤，用来证明「过滤确实排掉了别的产品线」） */
  allCreditAccountsWithBalance: number;
  allCreditsWithBalance: number;
  /** 过滤后真正进入迁移范围的账户数与积分数 */
  inScopeAccounts: number;
  inScopeCredits: number;
  /** 被口径排除掉的账户数（非兰琪产品线的历史额度，**不动**） */
  excludedAccounts: number;
  excludedCredits: number;
}

/**
 * 只读审计：证明「兰琪口径」到底排掉了谁。dry-run 报告必须带上它，
 * 否则没法一眼看出过滤是不是把别的产品线的钱也算了进来。
 */
export async function auditLanqiWalletMigrationScope(
  db: LanqiMigrationDb = prisma
): Promise<LanqiMigrationScopeAudit> {
  const scope = await resolveLanqiTenantScope(db);
  const accounts = await db.creditAccount.findMany({
    where: { balance: { gt: 0 } },
    select: { tenantId: true, balance: true }
  });
  const inScope = accounts.filter((account) => scope.has(account.tenantId));
  const sum = (rows: { balance: number }[]) => rows.reduce((total, row) => total + row.balance, 0);
  const profileIds = new Set<string>();
  const entitlementIds = new Set<string>();
  for (const [tenantId, keys] of scope) {
    for (const key of keys) (key === "store_profile" ? profileIds : entitlementIds).add(tenantId);
  }
  return {
    lanqiTenantsWithStoreProfile: profileIds.size,
    lanqiTenantsWithEntitlement: entitlementIds.size,
    lanqiTenantCount: scope.size,
    allCreditAccountsWithBalance: accounts.length,
    allCreditsWithBalance: sum(accounts),
    inScopeAccounts: inScope.length,
    inScopeCredits: sum(inScope),
    excludedAccounts: accounts.length - inScope.length,
    excludedCredits: sum(accounts) - sum(inScope)
  };
}

/**
 * 只读：列出「谁会迁、迁多少、谁迁不了」，供 dry-run 与人工复核。
 *
 * ⚠️ 只返回**兰琪租户**的账户；非兰琪产品线（外卖 / 创始人 IP / 测试租户）的余额
 * 既不在计划里，也不会被 apply 碰到（apply 还有第二道校验）。
 */
export async function planLanqiWalletMigration(db: LanqiMigrationDb = prisma): Promise<LanqiMigrationPlanEntry[]> {
  const scope = await resolveLanqiTenantScope(db);
  if (scope.size === 0) return [];
  const accounts = await db.creditAccount.findMany({
    where: { balance: { gt: 0 } },
    select: { tenantId: true, balance: true },
    orderBy: { balance: "desc" }
  });
  const scoped = accounts.filter((account) => scope.has(account.tenantId));
  if (scoped.length === 0) return [];
  const tenants = await db.tenant.findMany({
    where: { id: { in: scoped.map((account) => account.tenantId) } },
    select: { id: true, name: true }
  });
  const tenantNames = new Map(tenants.map((tenant) => [tenant.id, tenant.name]));
  const plan: LanqiMigrationPlanEntry[] = [];
  for (const account of scoped) {
    const owner = await db.membership.findFirst({
      where: { tenantId: account.tenantId, role: "owner", isActive: true },
      select: { userId: true },
      orderBy: { createdAt: "asc" }
    });
    const migrated = await db.walletLedger.findFirst({
      where: { refRequestId: lanqiMigrationRequestId(account.tenantId), type: "admin" },
      select: { id: true }
    });
    plan.push({
      tenantId: account.tenantId,
      tenantName: tenantNames.get(account.tenantId) ?? "",
      balance: account.balance,
      ownerUserId: owner?.userId,
      status: migrated ? "already_migrated" : owner ? "migratable" : "owner_missing",
      lanqiScope: scope.get(account.tenantId) ?? []
    });
  }
  return plan;
}

export interface LanqiMigrationResult {
  tenantId: string;
  ownerUserId: string;
  migrated: number;
  skipped?: "already_migrated" | "owner_missing" | "balance_zero" | "not_lanqi_tenant";
}

/**
 * 执行迁移。**幂等**：同租户已迁过（存在迁移流水）或余额已为 0 都跳过。
 * 每个租户一个事务：加钱包 + 写钱包流水 + 写账户 adjust 流水 + 账户清零。
 *
 * 第二道口径校验：即使 plan 是人工拼的，**非兰琪租户一律 `not_lanqi_tenant` 跳过**，
 * 绝不把别的产品线的历史额度挪进兰琪 owner 钱包。
 */
export async function applyLanqiWalletMigration(
  plan?: LanqiMigrationPlanEntry[],
  db: LanqiMigrationDb = prisma
): Promise<LanqiMigrationResult[]> {
  const entries = plan ?? (await planLanqiWalletMigration(db));
  const results: LanqiMigrationResult[] = [];
  for (const entry of entries) {
    if (entry.status === "already_migrated") {
      results.push({ tenantId: entry.tenantId, ownerUserId: entry.ownerUserId ?? "", migrated: 0, skipped: "already_migrated" });
      continue;
    }
    if (entry.status === "owner_missing" || !entry.ownerUserId) {
      results.push({ tenantId: entry.tenantId, ownerUserId: "", migrated: 0, skipped: "owner_missing" });
      continue;
    }
    const ownerUserId = entry.ownerUserId;
    const outcome = await withWalletTransaction(db, async (tx) => {
      const account = await tx.creditAccount.findUnique({ where: { tenantId: entry.tenantId }, select: { id: true, balance: true } });
      if (!account || account.balance <= 0) return { migrated: 0, skipped: "balance_zero" as const };
      const inScope = await isLanqiTenant(tx, entry.tenantId);
      if (!inScope) return { migrated: 0, skipped: "not_lanqi_tenant" as const };
      const existed = await tx.walletLedger.findFirst({
        where: { refRequestId: lanqiMigrationRequestId(entry.tenantId), type: "admin" },
        select: { id: true }
      });
      if (existed) return { migrated: 0, skipped: "already_migrated" as const };
      const wallet = await getOrCreateWallet(ownerUserId, tx);
      const amount = account.balance;
      await tx.wallet.update({ where: { id: wallet.id }, data: { paidBalance: { increment: amount } } });
      await tx.walletLedger.create({
        data: {
          walletId: wallet.id,
          userId: ownerUserId,
          delta: amount,
          bucket: "paid",
          type: "admin",
          refRequestId: lanqiMigrationRequestId(entry.tenantId),
          skillId: "lanqi_credit_migration",
          source: `lanqi_credit_migration:${entry.tenantId}`
        }
      });
      await tx.creditTransaction.create({
        data: {
          creditAccountId: account.id,
          tenantId: entry.tenantId,
          userId: ownerUserId,
          direction: "adjust",
          amount,
          reason: "lanqi_credit_migration_to_wallet",
          refType: "wallet_migration",
          refId: LANQI_WALLET_MIGRATION_VERSION,
          productCode: "lanqi",
          channel: "migration"
        }
      });
      await tx.creditAccount.update({ where: { id: account.id }, data: { balance: 0 } });
      return { migrated: amount, skipped: undefined };
    });
    results.push({ tenantId: entry.tenantId, ownerUserId, migrated: outcome.migrated, skipped: outcome.skipped });
  }
  return results;
}

export interface LanqiMigrationRevertResult {
  tenantId: string;
  ownerUserId: string;
  reverted: number;
  blocked?: "wallet_paid_insufficient" | "already_reverted";
}

/** 事务内的兰琪归属校验：门店档案或 lanqi 权益，二者有一即算。 */
async function isLanqiTenant(db: LanqiMigrationDb, tenantId: string): Promise<boolean> {
  const [profile, entitlement] = await Promise.all([
    db.lanqiStoreProfile.findUnique({ where: { tenantId }, select: { id: true } }),
    db.tenantProductEntitlement.findFirst({
      where: { tenantId, productCode: LANQI_PRODUCT_CODE },
      select: { id: true }
    })
  ]);
  return Boolean(profile) || Boolean(entitlement);
}

/**
 * 回滚：把迁移进钱包的额度退回购租户账户。
 * 只在钱包 `paid` 余额**仍有足额**时执行（钱已被花掉的租户不猜、直接报 `wallet_paid_insufficient` 让人处理）。
 */
export async function revertLanqiWalletMigration(
  tenantIds: string[],
  db: LanqiMigrationDb = prisma
): Promise<LanqiMigrationRevertResult[]> {
  const results: LanqiMigrationRevertResult[] = [];
  for (const tenantId of tenantIds) {
    const outcome = await withWalletTransaction(db, async (tx) => {
      const ledger = await tx.walletLedger.findFirst({
        where: { refRequestId: lanqiMigrationRequestId(tenantId), type: "admin" },
        select: { id: true, userId: true, delta: true }
      });
      if (!ledger) return { ownerUserId: "", reverted: 0, blocked: "already_reverted" as const };
      const reverted = await tx.walletLedger.findFirst({
        where: { refRequestId: `${lanqiMigrationRequestId(tenantId)}:revert` },
        select: { id: true }
      });
      if (reverted) return { ownerUserId: ledger.userId, reverted: 0, blocked: "already_reverted" as const };
      const wallet = await getOrCreateWallet(ledger.userId, tx);
      if (wallet.paidBalance < ledger.delta) {
        return { ownerUserId: ledger.userId, reverted: 0, blocked: "wallet_paid_insufficient" as const };
      }
      await tx.wallet.update({ where: { id: wallet.id }, data: { paidBalance: { decrement: ledger.delta } } });
      await tx.walletLedger.create({
        data: {
          walletId: wallet.id,
          userId: ledger.userId,
          delta: -ledger.delta,
          bucket: "paid",
          type: "admin",
          refRequestId: `${lanqiMigrationRequestId(tenantId)}:revert`,
          skillId: "lanqi_credit_migration_revert",
          source: `lanqi_credit_migration_revert:${tenantId}`
        }
      });
      const account = await tx.creditAccount.findUnique({ where: { tenantId }, select: { id: true } });
      if (account) {
        await tx.creditAccount.update({ where: { id: account.id }, data: { balance: { increment: ledger.delta } } });
        await tx.creditTransaction.create({
          data: {
            creditAccountId: account.id,
            tenantId,
            userId: ledger.userId,
            direction: "adjust",
            amount: ledger.delta,
            reason: "lanqi_credit_migration_revert",
            refType: "wallet_migration",
            refId: LANQI_WALLET_MIGRATION_VERSION,
            productCode: "lanqi",
            channel: "migration"
          }
        });
      }
      return { ownerUserId: ledger.userId, reverted: ledger.delta, blocked: undefined };
    });
    results.push({ tenantId, ...outcome });
  }
  return results;
}

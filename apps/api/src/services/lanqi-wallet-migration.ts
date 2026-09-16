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
import { getOrCreateWallet } from "./sitong-wallet.js";

export const LANQI_WALLET_MIGRATION_VERSION = "lanqi_credit_migration_v1" as const;

export function lanqiMigrationRequestId(tenantId: string): string {
  return `lanqi-migrate:${tenantId}`;
}

export interface LanqiMigrationPlanEntry {
  tenantId: string;
  tenantName: string;
  balance: number;
  ownerUserId?: string;
  status: "migratable" | "owner_missing" | "already_migrated";
}

/** 只读：列出「谁会迁、迁多少、谁迁不了」，供 dry-run 与人工复核。 */
export async function planLanqiWalletMigration(): Promise<LanqiMigrationPlanEntry[]> {
  const accounts = await prisma.creditAccount.findMany({
    where: { balance: { gt: 0 } },
    select: { tenantId: true, balance: true, tenant: { select: { name: true } } },
    orderBy: { balance: "desc" }
  });
  const plan: LanqiMigrationPlanEntry[] = [];
  for (const account of accounts) {
    const owner = await prisma.membership.findFirst({
      where: { tenantId: account.tenantId, role: "owner", isActive: true },
      select: { userId: true },
      orderBy: { createdAt: "asc" }
    });
    const migrated = await prisma.walletLedger.findFirst({
      where: { refRequestId: lanqiMigrationRequestId(account.tenantId), type: "admin" },
      select: { id: true }
    });
    plan.push({
      tenantId: account.tenantId,
      tenantName: account.tenant.name,
      balance: account.balance,
      ownerUserId: owner?.userId,
      status: migrated ? "already_migrated" : owner ? "migratable" : "owner_missing"
    });
  }
  return plan;
}

export interface LanqiMigrationResult {
  tenantId: string;
  ownerUserId: string;
  migrated: number;
  skipped?: "already_migrated" | "owner_missing" | "balance_zero";
}

/**
 * 执行迁移。**幂等**：同租户已迁过（存在迁移流水）或余额已为 0 都跳过。
 * 每个租户一个事务：加钱包 + 写钱包流水 + 写账户 adjust 流水 + 账户清零。
 */
export async function applyLanqiWalletMigration(plan?: LanqiMigrationPlanEntry[]): Promise<LanqiMigrationResult[]> {
  const entries = plan ?? (await planLanqiWalletMigration());
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
    const outcome = await prisma.$transaction(async (tx) => {
      const account = await tx.creditAccount.findUnique({ where: { tenantId: entry.tenantId }, select: { id: true, balance: true } });
      if (!account || account.balance <= 0) return { migrated: 0, skipped: "balance_zero" as const };
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

/**
 * 回滚：把迁移进钱包的额度退回购租户账户。
 * 只在钱包 `paid` 余额**仍有足额**时执行（钱已被花掉的租户不猜、直接报 `wallet_paid_insufficient` 让人处理）。
 */
export async function revertLanqiWalletMigration(tenantIds: string[]): Promise<LanqiMigrationRevertResult[]> {
  const results: LanqiMigrationRevertResult[] = [];
  for (const tenantId of tenantIds) {
    const outcome = await prisma.$transaction(async (tx) => {
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

// LQ-34 历史租户额度 → 通用钱包（owner 钱包）迁移 CLI。
//
// 用法（**默认 dry-run，只打印计划、不写库**）：
//   node apps/api/node_modules/tsx/dist/cli.mjs scripts/lanqi-wallet-migrate.ts
//   node apps/api/node_modules/tsx/dist/cli.mjs scripts/lanqi-wallet-migrate.ts --apply --backup <目录>
//   node apps/api/node_modules/tsx/dist/cli.mjs scripts/lanqi-wallet-migrate.ts --revert <tenantId,tenantId...>
//
// 迁移前**必须**先 dry-run 复核：`owner_missing` 的租户不会被动（列出人工处理）。
import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  applyLanqiWalletMigration,
  auditLanqiWalletMigrationScope,
  planLanqiWalletMigration,
  revertLanqiWalletMigration
} from "../apps/api/src/services/lanqi-wallet-migration.js";

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const revertArg = argValue("--revert");
  const backupDir = argValue("--backup") ?? path.join(tmpdir(), "lanqi-wallet-migration");

  if (revertArg) {
    const tenantIds = revertArg.split(",").map((item) => item.trim()).filter(Boolean);
    const results = await revertLanqiWalletMigration(tenantIds);
    console.log(JSON.stringify({ mode: "revert", results }, null, 2));
    return;
  }

  const plan = await planLanqiWalletMigration();
  const migratable = plan.filter((entry) => entry.status === "migratable");
  const ownerMissing = plan.filter((entry) => entry.status === "owner_missing");
  const already = plan.filter((entry) => entry.status === "already_migrated");
  // 口径审计：证明「过滤确实排掉了别的产品线的钱」。LQ-34 修复前这一块是全库扫，
  // 生产上会把 199 个非兰琪账户（约 20 亿积分）一起搬走，所以 dry-run 必须带上它。
  const scopeAudit = await auditLanqiWalletMigrationScope();
  console.log(
    JSON.stringify(
      {
        mode: apply ? "apply" : "dry-run",
        scopeAudit,
        migratableCount: migratable.length,
        migratableCredits: migratable.reduce((sum, entry) => sum + entry.balance, 0),
        ownerMissing,
        alreadyMigratedCount: already.length,
        plan
      },
      null,
      2
    )
  );
  if (!apply) {
    console.log("\n[dry-run] 未写库。复核无误后加 --apply 执行。");
    return;
  }

  await mkdir(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `lanqi-credit-migration-${Date.now()}.csv`);
  const csv = [
    "tenantId,tenantName,balance,ownerUserId",
    ...migratable.map((entry) => `${entry.tenantId},"${entry.tenantName.replace(/"/g, "'")}",${entry.balance},${entry.ownerUserId ?? ""}`)
  ].join("\n");
  await writeFile(backupPath, csv, "utf8");

  const results = await applyLanqiWalletMigration(plan);
  console.log(
    JSON.stringify(
      {
        mode: "apply",
        backupPath,
        migratedCount: results.filter((item) => item.migrated > 0).length,
        migratedCredits: results.reduce((sum, item) => sum + item.migrated, 0),
        results
      },
      null,
      2
    )
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

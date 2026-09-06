import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationPath = path.join(root, "packages/db/prisma/migrations/202607010003_distribution_rbac/migration.sql");
const schemaPath = path.join(root, "packages/db/prisma/schema.prisma");
const generatorPaths = [
  path.join(root, "packages/db/_extract_migration.cjs"),
  path.join(root, "packages/db/_build_migration.cjs"),
];

const migration = fs.readFileSync(migrationPath, "utf8");
const schema = fs.readFileSync(schemaPath, "utf8");
const generators = generatorPaths.map((file) => fs.readFileSync(file, "utf8")).join("\n");
const requiredMigrationTokens = [
  'CREATE TABLE "UserRoleAssignment"',
  'CONSTRAINT "UserRoleAssignment_pkey"',
  'ALTER TABLE "UserRoleAssignment" ADD CONSTRAINT "UserRoleAssignment_userId_fkey"',
  'ALTER TABLE "UserRoleAssignment" ADD CONSTRAINT "UserRoleAssignment_roleId_fkey"',
];
const failures = [
  ...requiredMigrationTokens.filter((token) => !migration.includes(token)).map((token) => `missing:${token}`),
  ...(migration.includes('CREATE TABLE "UserRole"') ? ["legacy_join_table_created"] : []),
  ...(/model UserRole[\s\S]*?@@map\("UserRoleAssignment"\)/.test(schema) ? [] : ["schema_map_missing"]),
  ...(/enum MembershipRole[\s\S]*?@@map\("UserRole"\)/.test(schema) ? [] : ["membership_enum_map_changed"]),
  ...generatorPaths.filter((file) => !fs.readFileSync(file, "utf8").includes('"UserRoleAssignment"')).map((file) => `generator_not_synced:${path.basename(file)}`),
];

if (failures.length > 0) {
  console.error(`user_role_assignment_migration_smoke:FAIL ${failures.join(",")}`);
  process.exit(1);
}

if (process.env.MIGRATION_TEST_DATABASE_URL) {
  const target = new URL(process.env.MIGRATION_TEST_DATABASE_URL);
  if (target.hostname !== "127.0.0.1" || target.port !== "55432") {
    throw new Error("migration_test_database_target_rejected");
  }
  const options = {
    cwd: root,
    env: { ...process.env, DATABASE_URL: process.env.MIGRATION_TEST_DATABASE_URL },
    stdio: "inherit",
  };
  if (process.platform === "win32") {
    execFileSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "pnpm.cmd --filter @baolu/db prisma:deploy"], options);
  } else {
    execFileSync("pnpm", ["--filter", "@baolu/db", "prisma:deploy"], options);
  }
  console.log("user_role_assignment_migration_smoke:PASS static_and_clean_database");
} else {
  console.log("user_role_assignment_migration_smoke:PASS static_only (MIGRATION_TEST_DATABASE_URL not set)");
}

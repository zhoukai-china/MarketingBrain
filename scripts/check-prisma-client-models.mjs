#!/usr/bin/env node
/**
 * 守护检查：运行时 Prisma Client 必须包含 packages/db/prisma/schema.prisma 中
 * 定义的全部 model。
 *
 * 背景（QA-20260911-001）：2026-09-11 生产 lanqi 驾驶舱/目标页/朋友圈历史全部
 * 500（`Cannot read properties of undefined (reading 'findUnique')`）。根因是
 * scripts/tmp/deploy-release.sh 在 $STAGE 里跑 `prisma generate`，但第 7 步
 * overlay 只拷 apps/packages/docs/mcp-skills/scripts，node_modules 被显式排除，
 * 生成结果从未进入运行目录 $APP。结果是 schema 与数据库都已有
 * LanqiStoreGoal / LanqiMomentDraft / LanqiMomentUpgrade / LanqiMomentAsset，
 * 但运行中的客户端停在旧版本，四个模型全部缺失。
 *
 * 用法：
 *   node scripts/check-prisma-client-models.mjs            # 校验仓库根目录
 *   node scripts/check-prisma-client-models.mjs <appRoot>  # 校验指定部署目录
 *
 * 退出码：0 = 全部模型存在；1 = 存在缺失（含明确清单）；2 = 环境不可判定。
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(process.argv[2] ?? path.join(here, ".."));
const schemaPath = path.join(appRoot, "packages", "db", "prisma", "schema.prisma");

if (!existsSync(schemaPath)) {
  console.error(`[prisma-client-model-check] 找不到 schema：${schemaPath}`);
  process.exit(2);
}

const schema = readFileSync(schemaPath, "utf8");
const models = [...schema.matchAll(/^\s*model\s+([A-Za-z0-9_]+)\s*\{/gm)].map(m => m[1]);
if (models.length === 0) {
  console.error(`[prisma-client-model-check] schema 中未解析到任何 model：${schemaPath}`);
  process.exit(2);
}

function resolveClientDts() {
  // 显式指定优先级最高，且不做「取最新」覆盖（用于红灯/历史副本取证）
  if (process.env.PRISMA_CLIENT_DIR) {
    const explicit = path.join(process.env.PRISMA_CLIENT_DIR, "index.d.ts");
    if (existsSync(explicit)) return explicit;
    return null;
  }
  const candidates = [];
  // 1) 从实际依赖 @prisma/client 的包解析（packages/db 一定有，根包不一定有）
  for (const base of [path.join(appRoot, "packages", "db"), appRoot]) {
    try {
      const require = createRequire(path.join(base, "package.json"));
      const entry = require.resolve("@prisma/client");
      // entry = <...>/node_modules/@prisma/client/default.js
      // 生成物在 @prisma 的兄弟目录：<...>/node_modules/.prisma/client
      candidates.push(path.join(path.dirname(entry), "..", "..", ".prisma", "client", "index.d.ts"));
    } catch {
      /* 继续回退 */
    }
  }
  // 2) pnpm 布局：node_modules/.pnpm/@prisma+client@<ver>_prisma@<ver>/node_modules/.prisma/client
  const pnpmDir = path.join(appRoot, "node_modules", ".pnpm");
  if (existsSync(pnpmDir)) {
    for (const entryName of readdirSync(pnpmDir)) {
      if (!entryName.startsWith("@prisma+client@")) continue;
      candidates.push(
        path.join(pnpmDir, entryName, "node_modules", ".prisma", "client", "index.d.ts")
      );
    }
  }
  // 3) 扁平布局
  candidates.push(path.join(appRoot, "node_modules", ".prisma", "client", "index.d.ts"));
  const found = candidates.filter(candidate => existsSync(candidate));
  if (found.length === 0) return null;
  // 选最新生成的，避免多版本命中旧副本
  return found.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
}

const clientDts = resolveClientDts();
if (!clientDts) {
  console.error(
    `[prisma-client-model-check] 找不到生成的 Prisma 客户端（${appRoot}）。` +
      ` 先在 packages/db 运行 prisma generate。`
  );
  process.exit(2);
}

const client = readFileSync(clientDts, "utf8");
const missing = models.filter(model => !client.includes(model));

console.log(
  `[prisma-client-model-check] app=${appRoot}\n` +
    `[prisma-client-model-check] schema=${schemaPath} (${models.length} models)\n` +
    `[prisma-client-model-check] client=${clientDts}`
);

const schemaMtime = statSync(schemaPath).mtimeMs;
const clientMtime = statSync(clientDts).mtimeMs;
if (clientMtime < schemaMtime) {
  console.warn(
    `[prisma-client-model-check] 警告：客户端 (${
      new Date(clientMtime).toISOString()
    }) 早于 schema (${new Date(schemaMtime).toISOString()})，可能未重新生成。`
  );
}

if (missing.length > 0) {
  console.error(
    `[prisma-client-model-check] FAIL 运行时客户端缺少 ${missing.length} 个模型：\n` +
      missing.map(model => `  - ${model}`).join("\n") +
      `\n[prisma-client-model-check] 修复：cd packages/db && pnpm run prisma:generate，然后重启服务。`
  );
  process.exit(1);
}

console.log(`[prisma-client-model-check] PASS 全部 ${models.length} 个模型均存在。`);

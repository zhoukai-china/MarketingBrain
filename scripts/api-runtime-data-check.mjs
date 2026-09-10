// 回归探针：@baolu/api 的运行时数据必须与源码保持一致。
// 背景（QA-20260910-004）：marketplace-catalog.ts 用 readFileSync(new URL("../data/marketplace-v3.json", import.meta.url))
// 读取货架数据，而 tsc 不会复制 JSON；缺少构建期复制时，部署出来的实例会一直吃 dist 里残留的旧货架数据
// （表现为专区/内核状态改了但线上不变）。这个探针在 dist 已存在时比对哈希，防止同类问题再次上线。
// 用法：node scripts/api-runtime-data-check.mjs
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = path.join(repoRoot, "apps", "api", "src", "data");
const distDir = path.join(repoRoot, "apps", "api", "dist", "apps", "api", "src", "data");

const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

if (!existsSync(sourceDir)) {
  process.stderr.write(`api_runtime_data_check:FAIL source data dir missing: ${sourceDir}\n`);
  process.exit(1);
}

const sourceFiles = readdirSync(sourceDir).filter((name) => statSync(path.join(sourceDir, name)).isFile());

if (!existsSync(distDir)) {
  process.stdout.write("api_runtime_data_check:SKIP dist not built (run `pnpm --filter @baolu/api build` before releasing)\n");
  process.exit(0);
}

const problems = [];
for (const name of sourceFiles) {
  const compiled = path.join(distDir, name);
  if (!existsSync(compiled)) {
    problems.push(`missing_in_dist ${name}`);
    continue;
  }
  if (sha256(path.join(sourceDir, name)) !== sha256(compiled)) {
    problems.push(`stale_in_dist ${name} (rebuild @baolu/api before releasing)`);
  }
}

if (problems.length > 0) {
  process.stderr.write(`api_runtime_data_check:FAIL ${problems.join("; ")}\n`);
  process.exit(1);
}

process.stdout.write(`api_runtime_data_check:PASS files=${sourceFiles.sort().join(",")}\n`);

// API 运行时通过 readFileSync(new URL("../data/marketplace-v3.json", import.meta.url)) 读取货架数据，
// 而 tsc 不会把 JSON 复制到 outDir。缺这一步时，dist 里会残留上一次构建的旧货架数据，
// 表现为「源码改了但线上专区/内核状态没变」。构建后必须把 src/data 复制到编译产物对应目录。
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = path.join(packageRoot, "src", "data");
const compiledService = path.join(packageRoot, "dist", "apps", "api", "src", "services", "marketplace-catalog.js");
const targetDir = path.join(packageRoot, "dist", "apps", "api", "src", "data");

if (!existsSync(sourceDir)) {
  throw new Error(`api_runtime_data_source_missing: ${sourceDir}`);
}
if (!existsSync(compiledService)) {
  throw new Error(`api_build_output_missing: ${compiledService} (run tsc before copying runtime data)`);
}

// 逐个文件复制：Windows 上 fs.cpSync 的递归实现在含非 ASCII 路径的工作区会崩溃（0xC0000409）。
mkdirSync(targetDir, { recursive: true });
const copied = [];
for (const entry of readdirSync(sourceDir)) {
  const from = path.join(sourceDir, entry);
  if (!statSync(from).isFile()) continue;
  copyFileSync(from, path.join(targetDir, entry));
  copied.push(entry);
}
if (copied.length === 0) {
  throw new Error(`api_runtime_data_empty: ${sourceDir}`);
}
process.stdout.write(
  `api_runtime_data_copied -> ${path.relative(packageRoot, targetDir).replace(/\\/g, "/")} (${copied.sort().join(", ")})\n`
);

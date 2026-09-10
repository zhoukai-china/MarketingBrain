import { readFileSync } from "node:fs";

const scanFiles = [
  "apps/web/src/pages/MarketplaceApp.tsx",
  "apps/web/src/styles/marketplace.css",
  "apps/api/src/routes/marketplace.ts",
  "apps/api/src/services/marketplace-catalog.ts"
];

// 只扫用户可见文案中出现的高危词/真实客户词。代码内部标识（skill/profile 等）
// 不作为命中，避免把变量名和类型名误判为 UI 文案。
const forbiddenUiPatterns = [
  { pattern: /人民币/, label: "人民币" },
  { pattern: /AI反问/, label: "AI反问" },
  { pattern: /贴膜小子|兰琪|枕水江南|李沐珊/, label: "真实客户名" },
  { pattern: /保禄·|我是.*保禄/, label: "非思潼品牌口径" }
];

const issues: string[] = [];
for (const file of scanFiles) {
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((line, index) => {
    const value = line.trim();
    // 跳过注释、import、类型/变量声明，避免内部代码被当成 UI 文案。
    if (value.startsWith("//") || value.startsWith("/*") || value.startsWith("*")) return;
    if (value.startsWith("import ") || value.startsWith("export interface ")) return;
    for (const rule of forbiddenUiPatterns) {
      if (rule.pattern.test(line)) {
        issues.push(`${file}:${index + 1} hit=${rule.label}`);
      }
    }
  });
}

if (issues.length > 0) {
  console.error(issues.join("\n"));
  process.exit(1);
}
console.log("PASS marketplace-copy-scan");

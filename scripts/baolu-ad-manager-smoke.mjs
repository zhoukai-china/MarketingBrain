import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const fallbackPath = path.join(root, "packages", "skills", "skills", "baolu_ad_manager", "prompt.md");
const mcpPath = path.join(root, "mcp-skills", "skills", "baolu_ad_manager", "SKILL.md");
const contractPath = path.join(root, "packages", "skills", "skills", "baolu_ad_manager", "contract.json");
const samplePath = path.join(root, "packages", "skills", "skills", "baolu_ad_manager", "examples", "sample-grade.md");
const requiredTerms = [
  "optimize_local_push_ads",
  "dou_plus_ads",
  "PREVIEW_ONLY",
  "requires_confirmation",
  "不得充值",
  "不得付款",
  "不得自动投放",
  "client_id",
  "account_id"
];
const failures = [];
for (const filePath of [fallbackPath, mcpPath, contractPath, samplePath]) {
  if (!existsSync(filePath)) failures.push(`missing required baolu_ad_manager asset: ${path.relative(root, filePath)}`);
}
if (failures.length === 0) {
  for (const filePath of [fallbackPath, mcpPath]) {
    const text = readFileSync(filePath, "utf8");
    for (const term of requiredTerms) {
      if (!text.includes(term)) failures.push(`${path.relative(root, filePath)} missing boundary term: ${term}`);
    }
  }
}
if (failures.length > 0) {
  console.error("baolu_ad_manager smoke failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log("baolu_ad_manager smoke passed.");

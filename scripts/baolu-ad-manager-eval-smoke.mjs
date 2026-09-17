import { readFileSync } from "node:fs";
import path from "node:path";

const cases = JSON.parse(readFileSync(path.join(process.cwd(), "packages", "agent", "evals", "baolu-ad-manager-cases.json"), "utf8"));
const expected = new Set([
  "local_push_route", "dou_plus_route", "franchise_lead_preview", "ambiguous_requirement",
  "cross_channel_budget_preview", "missing_data", "tool_error", "overreach", "tenant_isolation"
]);
const failures = [];
if (!Array.isArray(cases) || cases.length !== expected.size) failures.push("expected exactly nine baolu_ad_manager cases");
const seen = new Set();
for (const item of cases) {
  if (!expected.has(item?.scenario)) failures.push(`unexpected or missing scenario: ${item?.scenario}`);
  seen.add(item?.scenario);
  if (!Array.isArray(item?.mustInclude) || !Array.isArray(item?.mustNotInclude) || item.mustInclude.length === 0 || item.mustNotInclude.length === 0) {
    failures.push(`${item?.id}: mustInclude and mustNotInclude are required`);
  }
  if (item?.riskLevel === "high" && item.repetitions < 3) failures.push(`${item?.id}: high risk must repeat at least three times`);
}
for (const scenario of expected) if (!seen.has(scenario)) failures.push(`missing scenario: ${scenario}`);
if (failures.length > 0) {
  console.error("baolu_ad_manager eval smoke failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log("baolu_ad_manager eval smoke passed: 9 scenarios, 6 high-risk cases repeated 3 times.");

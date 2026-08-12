import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const evalPath = path.resolve("packages", "agent", "evals", "sample-grade-cases.json");
const skillRoot = path.resolve("packages", "skills", "skills");
const issues = [];
const warnings = [];

const cases = readCases(evalPath);
const ids = new Set();

for (const item of cases) {
  const prefix = `${item.id || "<missing id>"}`;
  if (!item.id || typeof item.id !== "string") issues.push(`${prefix}: id is required`);
  if (ids.has(item.id)) issues.push(`${prefix}: duplicate id`);
  ids.add(item.id);

  if (!item.skillId || typeof item.skillId !== "string") issues.push(`${prefix}: skillId is required`);
  if (!item.input || typeof item.input !== "string" || item.input.length < 10) {
    issues.push(`${prefix}: input must be a useful string`);
  }
  if (!Array.isArray(item.mustInclude) || item.mustInclude.length === 0) {
    issues.push(`${prefix}: mustInclude must be a non-empty array`);
  }

  if (item.skillId) {
    const skillDir = path.join(skillRoot, item.skillId);
    const contractPath = path.join(skillDir, "contract.json");
    const examplesDir = path.join(skillDir, "examples");
    if (!existsSync(contractPath)) issues.push(`${prefix}: missing contract.json for ${item.skillId}`);
    if (!existsSync(examplesDir)) issues.push(`${prefix}: missing examples directory for ${item.skillId}`);

    if (existsSync(contractPath) && Array.isArray(item.mustInclude)) {
      const contract = JSON.parse(readFileSync(contractPath, "utf8"));
      const contractText = [
        ...(contract.requiredSections ?? []),
        ...(contract.requiredTerms ?? []),
        ...(contract.requiredDeliverables ?? [])
      ].join("\n");
      const missingFromContract = item.mustInclude.filter((term) => !contractText.includes(term));
      if (missingFromContract.length > 0) {
        warnings.push(`${prefix}: eval terms not declared in contract: ${missingFromContract.join(", ")}`);
      }
    }
  }
}

const result = {
  ok: issues.length === 0,
  caseCount: cases.length,
  issues,
  warnings
};

console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);

function readCases(filePath) {
  if (!existsSync(filePath)) {
    console.log(JSON.stringify({ ok: false, issues: [`Eval file not found: ${filePath}`] }, null, 2));
    process.exit(1);
  }
  const parsed = JSON.parse(readFileSync(filePath, "utf8"));
  if (!Array.isArray(parsed)) {
    console.log(JSON.stringify({ ok: false, issues: [`Eval file must be an array: ${filePath}`] }, null, 2));
    process.exit(1);
  }
  return parsed;
}

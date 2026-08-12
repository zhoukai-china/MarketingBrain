import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve("packages", "skills", "skills");
const issues = [];
const warnings = [];

if (!existsSync(root)) {
  issues.push(`Skill root not found: ${root}`);
} else {
  for (const skillName of readdirSync(root).sort()) {
    const skillDir = path.join(root, skillName);
    const contractPath = path.join(skillDir, "contract.json");
    const examplesDir = path.join(skillDir, "examples");
    if (!existsSync(contractPath)) continue;

    const contract = readJson(contractPath);
    if (!contract) continue;

    requireArray(contractPath, contract, "requiredSections");
    requireArray(contractPath, contract, "requiredDeliverables");
    if (typeof contract.minLength !== "number" || contract.minLength < 160) {
      issues.push(`${contractPath}: minLength must be a number >= 160`);
    }
    if (typeof contract.scoreThreshold !== "number" || contract.scoreThreshold < 80) {
      issues.push(`${contractPath}: scoreThreshold must be a number >= 80`);
    }
    if (contract.qualityBar !== "sample_grade") {
      warnings.push(`${contractPath}: qualityBar should usually be sample_grade for production skills`);
    }

    if (!existsSync(examplesDir)) {
      issues.push(`${skillName}: contract exists but examples directory is missing`);
      continue;
    }
    const examples = readdirSync(examplesDir).filter((file) => file.endsWith(".md")).sort();
    if (examples.length === 0) {
      issues.push(`${skillName}: contract exists but no markdown examples were found`);
      continue;
    }
    for (const file of examples) {
      const examplePath = path.join(examplesDir, file);
      const text = readFileSync(examplePath, "utf8");
      if (isWorkBuddyTemplateExample(text)) {
        if (text.length < 300) {
          warnings.push(`${examplePath}: sample is short; consider adding a fuller output`);
        }
        continue;
      }
      if (!text.includes("用户输入：")) {
        issues.push(`${examplePath}: missing 用户输入： section`);
      }
      if (!text.includes("样板输出：")) {
        issues.push(`${examplePath}: missing 样板输出： section`);
      }
      if (text.length < 300) {
        warnings.push(`${examplePath}: sample is short; consider adding a fuller output`);
      }
    }
  }
}

const result = {
  ok: issues.length === 0,
  issues,
  warnings
};

console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);

function readJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    issues.push(`${filePath}: invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function requireArray(filePath, contract, key) {
  if (!Array.isArray(contract[key]) || contract[key].length === 0) {
    issues.push(`${filePath}: ${key} must be a non-empty array`);
  }
}

function isWorkBuddyTemplateExample(text) {
  return text.includes("WorkBuddy") && (
    /标准(访谈过程|方案输出)样板/.test(text) ||
    /样板库/.test(text) ||
    (/输入样例/.test(text) && /样板输出骨架|样板输出/.test(text))
  );
}

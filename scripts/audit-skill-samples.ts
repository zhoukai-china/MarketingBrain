import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspectQuality, type LlmMessage } from "@baolu/agent";
import { SKILL_MANIFESTS, type SkillQualityContract } from "@baolu/skills";
import type { SkillId } from "@baolu/shared";

interface AuditRow {
  skillId: SkillId;
  hasContract: boolean;
  hasSample: boolean;
  samplePassed: boolean;
  flags: string[];
  samplePath?: string;
}

const __filename = fileURLToPath(import.meta.url);
const workspaceRoot = path.resolve(path.dirname(__filename), "..");
const root = path.join(workspaceRoot, "packages", "skills", "skills");
const rows: AuditRow[] = [];

for (const skillId of Object.keys(SKILL_MANIFESTS).sort() as SkillId[]) {
  const skillDir = path.join(root, skillId);
  const contractPath = path.join(skillDir, "contract.json");
  const samplePath = path.join(skillDir, "examples", "sample-grade.md");
  const hasContract = existsSync(contractPath);
  const hasSample = existsSync(samplePath);
  const flags: string[] = [];

  if (!hasContract) flags.push("missing_contract");
  if (!hasSample) flags.push("missing_sample_grade");

  if (hasContract && hasSample) {
    const contract = JSON.parse(readFileSync(contractPath, "utf8")) as SkillQualityContract;
    const sample = readFileSync(samplePath, "utf8");
    const input = between(sample, "用户输入：", "样板输出：");
    const answer = after(sample, "样板输出：");
    if (!input) flags.push("sample_missing_user_input");
    if (!answer) flags.push("sample_missing_output");

    if (input && answer) {
      const messages: LlmMessage[] = [{ role: "user", content: input }];
      flags.push(...inspectQuality(answer, skillId, contract, messages));
    }
  }

  const blockingFlags = [...new Set(flags)].filter((flag) => flag !== "markdown_leak");
  rows.push({
    skillId,
    hasContract,
    hasSample,
    samplePassed: blockingFlags.length === 0,
    flags: blockingFlags,
    samplePath: hasSample ? samplePath : undefined
  });
}

const result = {
  ok: rows.every((row) => row.samplePassed),
  registeredSkillCount: rows.length,
  passedSampleCount: rows.filter((row) => row.samplePassed).length,
  failedSampleCount: rows.filter((row) => !row.samplePassed).length,
  rows
};

console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);

function between(text: string, start: string, end: string): string {
  const startIndex = text.indexOf(start);
  if (startIndex < 0) return "";
  const contentStart = startIndex + start.length;
  const endIndex = text.indexOf(end, contentStart);
  return text.slice(contentStart, endIndex < 0 ? undefined : endIndex).trim();
}

function after(text: string, marker: string): string {
  const index = text.indexOf(marker);
  return index < 0 ? "" : text.slice(index + marker.length).trim();
}

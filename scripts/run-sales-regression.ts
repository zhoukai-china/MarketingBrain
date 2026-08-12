import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runAgent, type LlmProvider } from "@baolu/agent";
import type { PlanCode, TenantType } from "@baolu/shared";

interface SalesCase {
  id: string;
  skillId: "sales_growth_advisor";
  capabilityId: string;
  tenantType: TenantType;
  tenantName?: string;
  industry?: string;
  input: string;
  mustInclude: string[];
}

const provider: LlmProvider = {
  name: "forced-fallback-regression",
  async complete() {
    throw new Error("forced provider failure for deterministic sales regression");
  }
};

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});

async function main(): Promise<void> {
  const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const casesPath = path.join(workspaceRoot, "packages", "agent", "evals", "sales-v3-cases.json");
  const outputDir = path.join(workspaceRoot, "reports", "skill-audit", "2026-07-29", "sales-v3", "deterministic");
  const cases = JSON.parse(await readFile(casesPath, "utf8")) as SalesCase[];
  await mkdir(outputDir, { recursive: true });

  const results = [];
  for (const item of cases) {
    const result = await runAgent({
    tenantId: `sales-regression-${item.id}`,
    userId: "sales-regression-user",
    role: "owner",
    planCode: planFor(item.tenantType),
    input: item.input,
    requestedSkillId: item.skillId,
    capabilityId: item.capabilityId,
    tenantProfile: {
      tenantId: `sales-regression-${item.id}`,
      tenantName: item.tenantName ?? "销售测试企业",
      tenantType: item.tenantType,
      industry: item.industry ?? "企业服务"
    },
    channel: "admin"
    }, provider);
    const missingTerms = item.mustInclude.filter((term) => !result.answer.includes(term));
    const unsafeTerms = ["不用预约", "过期自动退", "随时退", "保证赚钱", "稳赚", "零风险", "3个月回本", "今天最后几小时"]
      .filter((term) => result.answer.includes(term) && !item.input.includes(term));
    const blockingFlags = result.qualityFlags.filter((flag) => flag !== "provider_fallback_used" && flag !== "markdown_leak");
    const passed = missingTerms.length === 0 && unsafeTerms.length === 0 && blockingFlags.length === 0 && result.analysisMode === "deep";
    await writeFile(path.join(outputDir, `${item.id}.md`), [
    `# ${item.id}`,
    "",
    `passed: ${passed}`,
    `analysisMode: ${result.analysisMode}`,
    `missingTerms: ${missingTerms.join(", ") || "none"}`,
    `unsafeTerms: ${unsafeTerms.join(", ") || "none"}`,
    `qualityFlags: ${result.qualityFlags.join(", ") || "none"}`,
    "",
    "## Input",
    item.input,
    "",
    "## Answer",
    result.answer
    ].join("\n"), "utf8");
    results.push({ id: item.id, passed, analysisMode: result.analysisMode, missingTerms, unsafeTerms, qualityFlags: result.qualityFlags, answerLength: result.answer.length });
  }

  const summary = {
    ok: results.every((item) => item.passed),
    total: results.length,
    passed: results.filter((item) => item.passed).length,
    failed: results.filter((item) => !item.passed).length,
    outputDir,
    results
  };
  await writeFile(path.join(outputDir, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) process.exit(1);
}

function planFor(tenantType: TenantType): PlanCode {
  if (tenantType === "chain_brand") return "chain_premium";
  if (tenantType === "personal_ip") return "ip_premium";
  return "local_premium";
}

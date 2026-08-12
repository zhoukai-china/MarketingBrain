import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runAgent } from "@baolu/agent";
import type { PlanCode, SkillId, TenantType } from "@baolu/shared";
import type { RuntimeLlmProvider } from "../apps/api/src/services/llm-provider-factory.js";

interface EvalCase {
  id: string;
  skillId: SkillId;
  tenantType: TenantType;
  input: string;
  mustInclude: string[];
  capabilityId?: string;
  tenantName?: string;
  industry?: string;
  city?: string;
  tenantData?: Record<string, unknown>;
}

interface EvalResult {
  id: string;
  skillId: SkillId;
  passed: boolean;
  missingTerms: string[];
  qualityFlags: string[];
  answerLength: number;
  answerPreview: string;
  outputPath?: string;
  error?: string;
}

const args = parseArgs(process.argv.slice(2));
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, "..");
loadEnvFile(path.join(workspaceRoot, ".env"), args.has("--prefer-env-file"));
const execute = args.has("--execute");
const caseFilter = args.get("--case");
const limit = parsePositiveInt(args.get("--limit"));
const outputDir =
  args.get("--output-dir") ??
  path.join(workspaceRoot, "reports", "agent-evals", new Date().toISOString().replace(/[:.]/g, "-"));

let provider: RuntimeLlmProvider;

void main().catch((error: unknown) => {
  console.log(
    JSON.stringify(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      },
      null,
      2
    )
  );
  process.exit(1);
});

async function main(): Promise<void> {
  const [{ getActiveLlmConfig, validateRuntimeConfig }, { createRuntimeLlmProvider }] = await Promise.all([
    import("../apps/api/src/config/env.js"),
    import("../apps/api/src/services/llm-provider-factory.js")
  ]);
  const configuredCasesPath = args.get("--cases-file");
  const casesPath = configuredCasesPath
    ? path.resolve(workspaceRoot, configuredCasesPath)
    : path.join(workspaceRoot, "packages", "agent", "evals", "sample-grade-cases.json");
  const cases = await readEvalCases(casesPath);
  const selectedCases = cases
    .filter((item) => !caseFilter || item.id === caseFilter || item.skillId === caseFilter)
    .slice(0, limit ?? cases.length);

  if (selectedCases.length === 0) {
    console.log(JSON.stringify({ ok: false, error: "no_eval_cases_selected", caseFilter, limit }, null, 2));
    process.exit(1);
  }

  const activeLlm = getActiveLlmConfig();
  const configIssues = validateRuntimeConfig();
  const blockingIssues = configIssues.filter((issue) => !issue.includes("NODE_ENV=production"));

  if (!execute) {
    const dryRunOk = configIssues.length === 0;
    console.log(
      JSON.stringify(
        {
          ok: dryRunOk,
          mode: "dry-run",
          message: "Dry run only. Add --execute to call the configured China-hosted top-tier model.",
          provider: activeLlm.provider,
          providerLabel: activeLlm.providerLabel,
          model: activeLlm.model,
          caseCount: selectedCases.length,
          outputDir,
          configIssues
        },
        null,
        2
      )
    );
    process.exit(dryRunOk ? 0 : 1);
  }

  if (blockingIssues.length > 0) {
    console.log(
      JSON.stringify(
        {
          ok: false,
          mode: "execute",
          provider: activeLlm.provider,
          model: activeLlm.model,
          issues: blockingIssues
        },
        null,
        2
      )
    );
    process.exit(1);
  }

  provider = createRuntimeLlmProvider();
  if (!provider.isConfigured()) {
    console.log(
      JSON.stringify(
        {
          ok: false,
          error: "llm_not_configured",
          provider: provider.name,
          model: provider.getModel()
        },
        null,
        2
      )
    );
    process.exit(1);
  }

  await mkdir(outputDir, { recursive: true });

  const results: EvalResult[] = [];
  for (const item of selectedCases) {
    const result = await runSingleEval(item).catch((error: unknown): EvalResult => ({
      id: item.id,
      skillId: item.skillId,
      passed: false,
      missingTerms: item.mustInclude,
      qualityFlags: ["eval_exception"],
      answerLength: 0,
      answerPreview: "",
      error: error instanceof Error ? error.message : String(error)
    }));
    results.push(result);
    console.log(
      JSON.stringify({
        id: result.id,
        skillId: result.skillId,
        passed: result.passed,
        missingTerms: result.missingTerms,
        qualityFlags: result.qualityFlags,
        answerLength: result.answerLength,
        outputPath: result.outputPath,
        error: result.error
      })
    );
  }

  const summary = {
    ok: results.every((result) => result.passed),
    mode: "execute",
    provider: provider.name,
    model: provider.getModel(),
    caseCount: results.length,
    passed: results.filter((result) => result.passed).length,
    failed: results.filter((result) => !result.passed).length,
    outputDir,
    results
  };

  await writeFile(path.join(outputDir, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
  console.log(JSON.stringify(summary, null, 2));
  process.exit(summary.ok ? 0 : 1);
}

async function runSingleEval(item: EvalCase): Promise<EvalResult> {
  const result = await runAgent(
    {
      tenantId: `eval-${item.tenantType}`,
      userId: "eval-user",
      role: "owner",
      planCode: planCodeForTenantType(item.tenantType),
      input: item.input,
      requestedSkillId: item.skillId,
      capabilityId: item.capabilityId,
      tenantProfile: {
        tenantId: `eval-${item.tenantType}`,
        tenantName: item.tenantName ?? "思潼评测样板客户",
        tenantType: item.tenantType,
        industry: item.industry ?? "餐饮",
        city: item.city ?? (item.input.includes("广州") ? "广州" : "本地城市"),
        data: {
          evalCaseId: item.id,
          source: args.get("--cases-file") ?? "sample-grade-cases",
          ...(item.tenantData ?? {})
        }
      },
      channel: "admin"
    },
    provider
  );

  const missingTerms = item.mustInclude.filter((term) => !result.answer.includes(term));
  const blockingFlags = result.qualityFlags.filter((flag) => flag !== "markdown_leak");
  const passed = missingTerms.length === 0 && blockingFlags.length === 0;
  const outputPath = path.join(outputDir, `${item.id}.md`);
  await writeFile(
    outputPath,
    [
      `# ${item.id}`,
      "",
      `skillId: ${item.skillId}`,
      `passed: ${passed}`,
      `missingTerms: ${missingTerms.join(", ") || "none"}`,
      `qualityFlags: ${result.qualityFlags.join(", ") || "none"}`,
      "",
      "## Input",
      item.input,
      "",
      "## Answer",
      result.answer
    ].join("\n"),
    "utf8"
  );

  return {
    id: item.id,
    skillId: item.skillId,
    passed,
    missingTerms,
    qualityFlags: result.qualityFlags,
    answerLength: result.answer.length,
    answerPreview: result.answer.slice(0, 240),
    outputPath
  };
}

async function readEvalCases(filePath: string): Promise<EvalCase[]> {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as EvalCase[];
}

function planCodeForTenantType(tenantType: TenantType): PlanCode {
  if (tenantType === "chain_brand") return "chain_premium";
  if (tenantType === "personal_ip") return "ip_premium";
  return "local_premium";
}

function parseArgs(values: string[]): Map<string, string> {
  const parsed = new Map<string, string>();
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) continue;
    const next = values[index + 1];
    if (next && !next.startsWith("--")) {
      parsed.set(value, next);
      index += 1;
    } else {
      parsed.set(value, "true");
    }
  }
  return parsed;
}

function parsePositiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function loadEnvFile(filePath: string, override: boolean): void {
  if (!existsSync(filePath)) return;
  const text = readFileSync(filePath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex < 0) continue;
    const key = trimmed.slice(0, equalsIndex).trim();
    if (!key || (!override && process.env[key] !== undefined)) continue;
    process.env[key] = stripEnvQuotes(trimmed.slice(equalsIndex + 1).trim());
  }
}

function stripEnvQuotes(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

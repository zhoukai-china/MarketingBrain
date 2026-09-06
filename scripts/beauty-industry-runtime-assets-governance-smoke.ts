import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { getBeautyIndustryToolRegistration } from "../apps/api/src/products/beauty-industry/mcp-adapter.ts";
import { BEAUTY_WORKFLOWS } from "../apps/api/src/products/beauty-industry/workflows.ts";
import { SKILL_MANIFESTS } from "../packages/skills/src/index.ts";

const root = path.resolve(import.meta.dirname, "..");
const reportPath = path.join(root, "docs", "agents", "beauty-industry", "governance", "runtime-assets.json");
const sourceExtensions = new Set([".ts", ".tsx", ".mjs", ".cjs", ".js", ".json", ".ps1", ".sh", ".yml", ".yaml"]);

function relative(value: string) {
  return path.relative(root, value).replaceAll("\\", "/");
}

function filesIn(target: string): string[] {
  if (!existsSync(target)) return [];
  if (statSync(target).isFile()) return [target];
  return readdirSync(target, { withFileTypes: true })
    .filter((entry) => !["node_modules", ".git", ".pnpm-store"].includes(entry.name))
    .flatMap((entry) => filesIn(path.join(target, entry.name)))
    .sort((left, right) => relative(left).localeCompare(relative(right)));
}

function sha256(target: string): string | null {
  const files = filesIn(target);
  if (!files.length) return null;
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(relative(file));
    hash.update("\0");
    hash.update(readFileSync(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function parseMcpVersion(markdown: string): string | null {
  const frontmatter = /^---\s*([\s\S]*?)\s*---/u.exec(markdown)?.[1] ?? "";
  return /(?:^|\n)\s*version:\s*["']?([^"'\n]+)["']?/u.exec(frontmatter)?.[1]?.trim()
    ?? /(?:^|\n)\s*metadata:\s*\n(?:\s+[^\n]*\n)*?\s+version:\s*["']?([^"'\n]+)["']?/u.exec(frontmatter)?.[1]?.trim()
    ?? null;
}

function scanForbiddenRuntimeReferences() {
  const roots = ["apps/api/src", "apps/web/src", "packages/agent/src", "packages/skills/src", "infra"];
  const forbidden = /mcp-skills[\\/](?:candidates|intake|quarantine)|\.codex[\\/]skills/iu;
  return roots.flatMap((item) => filesIn(path.join(root, item)))
    .filter((file) => sourceExtensions.has(path.extname(file)))
    .filter((file) => forbidden.test(readFileSync(file, "utf8")))
    .map(relative);
}

function scanGeneratedCandidateReferences() {
  return ["apps/api/dist", "apps/web/dist", "packages/skills/dist"]
    .flatMap((item) => filesIn(path.join(root, item)))
    .filter((file) => [".js", ".mjs", ".cjs", ".json", ".html"].includes(path.extname(file)))
    .filter((file) => /mcp-skills[\\/](?:candidates|intake|quarantine)|\.codex[\\/]skills/iu.test(readFileSync(file, "utf8")))
    .map(relative);
}

function buildInventory() {
  const seenTools = new Set<string>();
  const seenCapabilities = new Set<string>();
  const seenScopes = new Set<string>();
  const skillIds = new Set<string>();
  const activeChains = Object.entries(BEAUTY_WORKFLOWS).map(([workflowId, workflow]) => {
    assert(!seenTools.has(workflow.toolName), `duplicate beauty tool: ${workflow.toolName}`);
    assert(!seenCapabilities.has(workflow.capabilityId), `duplicate beauty capability: ${workflow.capabilityId}`);
    assert(!seenScopes.has(workflow.scope), `duplicate beauty scope: ${workflow.scope}`);
    seenTools.add(workflow.toolName);
    seenCapabilities.add(workflow.capabilityId);
    seenScopes.add(workflow.scope);
    const registration = getBeautyIndustryToolRegistration(workflow.toolName);
    assert.equal(registration.capabilityId, workflow.capabilityId, `MCP capability drift: ${workflow.toolName}`);
    assert.equal(registration.scope, workflow.scope, `MCP scope drift: ${workflow.toolName}`);
    assert.equal(registration.skillId, workflow.primarySkillId, `MCP skill drift: ${workflow.toolName}`);
    const chain = [workflow.primarySkillId, ...workflow.constraintSkillIds].map((skillId) => {
      skillIds.add(skillId);
      const manifest = SKILL_MANIFESTS[skillId];
      assert(manifest, `missing package manifest: ${skillId}`);
      const packageRoot = path.join(root, "packages", "skills", "skills", skillId);
      const mcpRoot = path.join(root, "mcp-skills", "skills", skillId);
      const promptPath = path.join(packageRoot, "prompt.md");
      const contractPath = path.join(packageRoot, "contract.json");
      const examplePath = path.join(packageRoot, "examples", "sample-grade.md");
      const mcpPath = path.join(mcpRoot, "SKILL.md");
      for (const required of [promptPath, contractPath, examplePath, mcpPath]) {
        assert(existsSync(required), `missing canonical beauty skill asset: ${relative(required)}`);
      }
      const contract = JSON.parse(readFileSync(contractPath, "utf8")) as { skillId?: string; version?: string };
      if (contract.skillId !== undefined) assert.equal(contract.skillId, skillId, `contract skill id drift: ${skillId}`);
      assert.equal(contract.version, manifest.version, `contract version drift: ${skillId}`);
      const mcpVersion = parseMcpVersion(readFileSync(mcpPath, "utf8"));
      if (mcpVersion) assert.equal(mcpVersion, manifest.version, `MCP version drift: ${skillId}`);
      return {
        skillId,
        version: manifest.version,
        role: skillId === workflow.primarySkillId ? "primary" : "constraint"
      };
    });
    const renderer = workflow.capabilityId === "topic_inspiration"
      ? "apps/web/src/components/acquisition/TopicSystemWorkbench.tsx"
      : workflow.capabilityId === "content_plan"
        ? "apps/web/src/components/acquisition/BeautyContentTenWorkbench.tsx"
        : "apps/web/src/pages/BeautyIndustryAcquisitionPage.tsx";
    assert(existsSync(path.join(root, renderer)), `beauty renderer missing: ${renderer}`);
    return {
      workflowId,
      toolName: workflow.toolName,
      capabilityId: workflow.capabilityId,
      scope: workflow.scope,
      evidenceMode: workflow.evidenceMode,
      workflowSource: "apps/api/src/products/beauty-industry/workflows.ts",
      outputContract: "apps/api/src/products/beauty-industry/output-contract.ts",
      renderer,
      skillChain: chain
    };
  });
  assert.equal(activeChains.length, 8, "beauty runtime must expose exactly eight active result workflows");

  const providerSource = readFileSync(path.join(root, "apps", "api", "src", "services", "domestic-chat-provider.ts"), "utf8");
  const failClosedAt = providerSource.indexOf("controlled_beauty_capability_fixture_missing");
  const genericFallbackAt = providerSource.indexOf("完整报告（内容九件套）");
  assert(failClosedAt >= 0, "unknown fixed beauty capability fail-closed guard missing");
  assert(genericFallbackAt > failClosedAt, "generic fallback must remain unreachable from fixed beauty capabilities");
  const envSource = readFileSync(path.join(root, "apps", "api", "src", "config", "env.ts"), "utf8");
  assert.match(envSource, /ORIGINAL_SKILL_ROOT:\s*z\.string\(\)\.default\("mcp-skills\/skills"\)/u, "formal Skill MCP root default drift");

  const runtimeCandidateReferences = scanForbiddenRuntimeReferences();
  const generatedCandidateReferences = scanGeneratedCandidateReferences();
  assert.deepEqual(runtimeCandidateReferences, [], "runtime references WorkBuddy candidate/intake/quarantine or personal Codex skills");
  assert.deepEqual(generatedCandidateReferences, [], "generated package references WorkBuddy candidate/intake/quarantine or personal Codex skills");

  const skillAssets = [...skillIds].sort().map((skillId) => ({
    skillId,
    classification: "ACTIVE_CANONICAL",
    packageRoot: `packages/skills/skills/${skillId}`,
    packageHash: sha256(path.join(root, "packages", "skills", "skills", skillId)),
    mcpRoot: `mcp-skills/skills/${skillId}`,
    mcpHash: sha256(path.join(root, "mcp-skills", "skills", skillId))
  }));

  return {
    schemaVersion: 1,
    auditedBusinessDate: "2026-08-26",
    product: "beauty-industry",
    activeChainCount: activeChains.length,
    activeChains,
    assets: [
      ...skillAssets,
      {
        asset: "beauty controlled output adapter",
        classification: "ACTIVE_CANONICAL",
        path: "apps/api/src/services/domestic-chat-provider.ts",
        hash: sha256(path.join(root, "apps", "api", "src", "services", "domestic-chat-provider.ts")),
        legacyGenericFallback: "LEGACY_REFERENCED_NON_BEAUTY_ONLY",
        beautyIsolationGuard: "controlled_beauty_capability_fixture_missing"
      },
      {
        asset: "historical AgentRun replay",
        classification: "HISTORICAL_PINNED",
        paths: ["apps/api/src/services/agent-runtime.ts", "packages/db/prisma/schema.prisma"],
        hash: sha256(path.join(root, "apps", "api", "src", "services", "agent-runtime.ts")),
        behavior: "read recorded skillId, skillVersion and output; do not recompute through current fallback"
      },
      {
        asset: "legacy content-ten URL",
        classification: "HISTORICAL_PINNED",
        path: "apps/web/src/pages/BeautyIndustryAcquisitionPage.tsx",
        behavior: "route alias only; canonical tool and current workflow remain beauty.content_ten_pack/content_plan"
      },
      {
        asset: "beauty AI daily brief",
        classification: "HISTORICAL_PINNED",
        path: "apps/api/src/products/beauty-industry/daily-brief-contract.ts",
        version: "1.0.0",
        state: "PAUSED; runtime, scheduler, navigation and WorkBuddy tool remain fail-closed"
      },
      {
        asset: "WorkBuddy candidate roots",
        classification: "WORKBUDDY_CANDIDATE",
        paths: ["mcp-skills/candidates", "mcp-skills/intake", "mcp-skills/quarantine"],
        runtimeReferences: runtimeCandidateReferences
      },
      {
        asset: "generated build copies",
        classification: "GENERATED_COPY",
        paths: ["apps/api/dist", "apps/web/dist", "packages/skills/dist"],
        candidateReferences: generatedCandidateReferences,
        sourceOfTruth: false
      }
    ],
    directoryRoles: {
      "packages/skills/skills": "versioned executable prompt, quality contract and sample-grade assets loaded by @baolu/skills",
      "mcp-skills/skills": "Codex-owned formal Skill source served by Skill MCP and agent catalog",
      "mcp-skills/candidates|intake|quarantine": "WorkBuddy-origin candidate or intake assets; never runtime-loadable"
    },
    deployment: {
      originalSkillRootDefault: "mcp-skills/skills",
      runtimeCandidateReferences,
      generatedCandidateReferences,
      sourceRootsOnly: true
    },
    physicalDeletion: {
      approved: false,
      safeCandidates: [],
      note: "No asset is physically deleted. A future request must name exact targets with zero-reference, history, rollback, backup and post-delete test evidence."
    }
  };
}

const actual = buildInventory();
if (process.argv.includes("--print")) {
  process.stdout.write(`${JSON.stringify(actual, null, 2)}\n`);
} else {
  assert(existsSync(reportPath), "beauty_runtime_asset_manifest_missing");
  const expected = JSON.parse(readFileSync(reportPath, "utf8"));
  assert.deepEqual(actual, expected, "beauty_runtime_asset_manifest_drift");
  console.log(JSON.stringify({
    ok: true,
    activeChains: actual.activeChainCount,
    canonicalSkills: actual.assets.filter((item) => item.classification === "ACTIVE_CANONICAL").length,
    runtimeCandidateReferences: actual.deployment.runtimeCandidateReferences.length,
    generatedCandidateReferences: actual.deployment.generatedCandidateReferences.length,
    physicalDeletionApproved: actual.physicalDeletion.approved
  }, null, 2));
}

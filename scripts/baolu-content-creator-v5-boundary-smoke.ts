import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const candidateRoot = process.argv[2] ? path.resolve(process.argv[2]) : root;
const mcpPath = path.join(candidateRoot, "mcp-skills", "skills", "baolu_content_creator", "SKILL.md");
const fallbackPath = path.join(candidateRoot, "packages", "skills", "skills", "baolu_content_creator", "prompt.md");
const startMarker = "## 输出格式（内容十件套 · V5）";
const endMarker = "## 核心文件";

function extractV5(text: string, label: string) {
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker, Math.max(0, start));
  if (start < 0 || end <= start) throw new Error(`${label}: v5_boundary_missing`);
  const section = text.slice(start, end);
  for (const required of ["一、选题策划", "十、投流建议", "PREVIEW_ONLY"]) {
    if (!section.includes(required)) throw new Error(`${label}: v5_required_content_missing:${required}`);
  }
  if (section.includes("## 可选补充资料")) {
    throw new Error(`${label}: optional_reference_leaked_into_v5_contract`);
  }
}

async function main() {
  extractV5(readFileSync(mcpPath, "utf8"), "mcp_original");
  extractV5(readFileSync(fallbackPath, "utf8"), "fallback_prompt");
  if (candidateRoot === root) {
    const { buildBeautyWorkflowPrompt } = await import("../apps/api/src/products/beauty-industry/workflows.js");
    const assembled = await buildBeautyWorkflowPrompt("content_plan");
    if (!assembled.prompt.includes("一、选题策划") || assembled.prompt.includes("## 可选补充资料")) {
      throw new Error("production_content_plan_assembly_contract_invalid");
    }
  }
  console.log(`BAOLU_CONTENT_CREATOR_V5_BOUNDARY_SMOKE_OK;root=${candidateRoot === root ? "runtime" : "candidate"}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

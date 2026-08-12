import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

const root = process.cwd();

const requiredPaths = [
  "apps/api/src/server.ts",
  "apps/web/src/pages/App.tsx",
  "packages/agent/src/index.ts",
  "packages/db/prisma/schema.prisma",
  "packages/shared/src/index.ts",
  "packages/skills/src/index.ts",
  "mcp-skills/skills/baolu_content_creator/SKILL.md",
  "docs/ARCHITECTURE.md",
  "docs/SKU.md"
];

const requiredSkills = [
  "general_qa",
  "ip_positioning",
  "baolu_topics",
  "baolu_content_creator",
  "moments_generator",
  "sales_script_advisor",
  "xiaohongshu_ops",
  "live_script_planner",
  "baolu_ad_manager",
  "baolu_review_engine",
  "baolu_live_review_engine",
  "sales_growth_advisor",
  "delivery_standardization",
  "baolu_shangxueyuan",
  "baolu_finance_advisor",
  "hr_director_consultant",
  "admin_consultant",
  "ai_daily_brief"
];

const missing = requiredPaths.filter((item) => !existsSync(path.join(root, item)));

for (const skill of requiredSkills) {
  const promptPath = path.join(root, "packages", "skills", "skills", skill, "prompt.md");
  if (!existsSync(promptPath)) missing.push(promptPath);
}

if (missing.length > 0) {
  console.error("Missing required files:");
  for (const item of missing) console.error(`- ${item}`);
  process.exit(1);
}

const skillDirs = readdirSync(path.join(root, "packages", "skills", "skills"), {
  withFileTypes: true
})
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

console.log(`Structure OK. ${skillDirs.length} skill directories found.`);

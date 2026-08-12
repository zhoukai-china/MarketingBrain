import { rm } from "node:fs/promises";
import path from "node:path";

const workspaceRoot = process.cwd();
const distDirs = [
  "apps/api/dist",
  "apps/web/dist",
  "packages/agent/dist",
  "packages/dashboard/dist",
  "packages/db/dist",
  "packages/shared/dist",
  "packages/skills/dist"
];

for (const relativeDir of distDirs) {
  const target = path.resolve(workspaceRoot, relativeDir);
  if (!target.startsWith(workspaceRoot)) {
    throw new Error(`Refusing to remove path outside workspace: ${target}`);
  }
  await rm(target, { recursive: true, force: true });
}

console.log(JSON.stringify({ ok: true, removed: distDirs }, null, 2));

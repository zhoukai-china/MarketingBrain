import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const routePath = new URL("../apps/api/src/routes/agents.ts", import.meta.url);
const servicePath = new URL("../apps/api/src/services/founder-ip-goal-briefs.ts", import.meta.url);
const workbenchPath = new URL("../apps/web/src/components/acquisition/TopicSystemWorkbench.tsx", import.meta.url);
const schemaPath = new URL("../packages/db/prisma/schema.prisma", import.meta.url);
const migrationPath = new URL("../packages/db/prisma/migrations/202608130007_fip_goal_briefs/migration.sql", import.meta.url);

assert(existsSync(servicePath), "FIP Brief must have a dedicated server-side persistence service");
assert(existsSync(migrationPath), "FIP Brief must have the allocated 202608130007 migration");

const route = readFileSync(routePath, "utf8");
const service = readFileSync(servicePath, "utf8");
const workbench = readFileSync(workbenchPath, "utf8");
const schema = readFileSync(schemaPath, "utf8");
const migration = readFileSync(migrationPath, "utf8");

assert.match(route, /\/agents\/:slug\/founder-ip-goal-briefs/);
assert.match(route, /saveFounderIpGoalBrief|loadFounderIpGoalBrief/);
assert.match(service, /tenantId.*subjectId.*target|subjectId.*target/s);
assert.match(service, /knowledgeSubject\.findFirst\([\s\S]*tenantId/);
assert.match(service, /tenantId_subjectId_target/);
assert.match(schema, /model FounderIpGoalBrief/);
assert.match(schema, /@@unique\(\[tenantId, subjectId, target\]\)/);
assert.match(migration, /CREATE TABLE "FounderIpGoalBrief"/);
assert.match(migration, /"tenantId", "subjectId", "target"/);
assert.match(workbench, /founder-ip-goal-briefs/);
assert.match(workbench, /保存获客目标简报/);
assert.match(workbench, /保存失败/);
assert.match(workbench, /\$\{isFounderMode \? `_\$\{activeTarget\}` : ""\}/);

console.log("founder_ip_goal_briefs_smoke:PASS");

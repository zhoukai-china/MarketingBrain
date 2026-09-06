import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const beautyPage = readFileSync(new URL("../apps/web/src/pages/BeautyIndustryAcquisitionPage.tsx", import.meta.url), "utf8");
const beautyRoutes = readFileSync(new URL("../apps/api/src/routes/beauty-industry.ts", import.meta.url), "utf8");
const beautyWorkflows = readFileSync(new URL("../apps/api/src/products/beauty-industry/workflows.ts", import.meta.url), "utf8");
const beautyExecution = readFileSync(new URL("../apps/api/src/products/beauty-industry/execution.ts", import.meta.url), "utf8");
const beautyMcp = readFileSync(new URL("../apps/api/src/products/beauty-industry/mcp-adapter.ts", import.meta.url), "utf8");
const founderWorkbench = readFileSync(new URL("../apps/web/src/components/acquisition/TopicSystemWorkbench.tsx", import.meta.url), "utf8");
const topicWorkbenchCss = readFileSync(new URL("../apps/web/src/styles/topic-system-workbench.css", import.meta.url), "utf8");
const topicContract = JSON.parse(readFileSync(new URL("../packages/skills/skills/baolu_topics/contract.json", import.meta.url), "utf8"));

const failures = [];
function expect(name, condition) {
  if (!condition) failures.push(name);
}

const topicTaskStart = beautyPage.indexOf('{ name: "beauty.topic_ideas"');
const topicTaskEnd = beautyPage.indexOf('{ name: "beauty.content_ten_pack"', topicTaskStart);
const topicTask = beautyPage.slice(topicTaskStart, topicTaskEnd);
const runSchemaStart = beautyRoutes.indexOf("const runSchema");
const runSchemaEnd = beautyRoutes.indexOf("const profileSchema", runSchemaStart);
const beautyRunSchema = beautyRoutes.slice(runSchemaStart, runSchemaEnd);
const topicSchemaStart = beautyRoutes.indexOf("const topicWorkflowSchema");
const topicSchemaEnd = beautyRoutes.indexOf("const runSchema", topicSchemaStart);
const beautyTopicSchema = beautyRoutes.slice(topicSchemaStart, topicSchemaEnd);
const mcpTopicStart = beautyMcp.indexOf("name: BEAUTY_WORKFLOWS.topics.toolName");
const mcpTopicEnd = beautyMcp.indexOf("name: BEAUTY_WORKFLOWS[\"content-ten\"].toolName", mcpTopicStart);
const mcpTopicRegistration = beautyMcp.slice(mcpTopicStart, mcpTopicEnd);
const beautyTopicWorkflow = beautyWorkflows.match(/topics:\s*\{[^\n]+\}/)?.[0] ?? "";

expect("formal baolu_topics contract must stay at v2.1.2", topicContract.version === "2.1.2");
expect("formal topic result must keep four-source collection", topicContract.requiredDeliverables?.includes("四大来源自动采集结果"));
expect("formal topic result must keep TOP10", topicContract.requiredDeliverables?.includes("三关筛选后的10个可测试选题"));
expect("FIP reference workbench must expose explicit four-source selection", /sourceSelection:\s*\{ industry: boolean; benchmark: boolean; transcript: boolean; videoReview: boolean \}/.test(founderWorkbench));
expect("FIP reference workbench must expose a target brief", /本轮\{scopeLabel\}获客目标简报/.test(founderWorkbench));
expect("FIP reference workbench must expose a content-system handoff", /用此选题进入内容系统/.test(founderWorkbench));
expect("topic result selector must not widen the 390px page", /\.topicContentEntry\{[^}]*min-width:0[^}]*\}/.test(topicWorkbenchCss) && /\.topicContentEntry select\{[^}]*min-width:0[^}]*width:100%[^}]*\}/.test(topicWorkbenchCss));

// P1 red line: Beauty currently mounts the generic composer instead of a topic-specific workbench.
expect("Beauty topic entry must mount a dedicated/reused topic workbench", /TopicSystemWorkbench|BeautyTopicSystemWorkbench/.test(beautyPage));
expect("Beauty topic entry must not flatten all sources into contentStructure", !/contentStructure/.test(topicTask));
expect("Beauty topic workbench must expose acquisitionGoal", /acquisitionGoal/.test(beautyPage) && /TopicSystemWorkbench|BeautyTopicSystemWorkbench/.test(beautyPage));
expect("Beauty topic workbench must expose sourceSelection", /sourceSelection/.test(beautyPage));
expect("Beauty topic workbench must expose benchmarkAccounts", /benchmarkAccounts/.test(beautyPage));
expect("Beauty topic workbench must expose transcriptDocumentIds", /transcriptDocumentIds/.test(beautyPage));
expect("Beauty topic workbench must expose videoReview", /videoReview(?:Id)?/.test(beautyPage));

// Web and MCP must carry the same structured topic contract before Provider execution.
for (const field of ["acquisitionGoal", "targetCustomer", "accountStage", "industry", "benchmarkAccounts", "transcriptDocumentIds", "videoReviewId", "sourceSelection"]) {
  expect(`Beauty Web run schema must accept structured topic field: ${field}`, beautyTopicSchema.includes(field) && beautyRunSchema.includes("topicWorkflow"));
  expect(`Beauty MCP topic tool must accept structured topic field: ${field}`, mcpTopicRegistration.includes(field) || beautyMcp.includes(`\"${field}\"`));
}
expect("Beauty topic workflow must not declare evidenceMode none", !/evidenceMode:\s*"none"/.test(beautyTopicWorkflow));
expect("Beauty execution must assess selected topic sources before Provider", /topic.*evidence|evidence.*topic/i.test(beautyExecution));

if (failures.length > 0) {
  console.error("beauty_industry_topic_workbench_p1_smoke:FAIL");
  failures.forEach((failure, index) => console.error(`${index + 1}. ${failure}`));
  process.exit(1);
}

assert.ok(true);
console.log("beauty_industry_topic_workbench_p1_smoke:PASS");

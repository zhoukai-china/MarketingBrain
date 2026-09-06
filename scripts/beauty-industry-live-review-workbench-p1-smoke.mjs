import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(path, "utf8");

const [page, component, workflow, routes, adapter, execution, outputContract, browserE2e, workbuddyE2e] = await Promise.all([
  read("apps/web/src/pages/BeautyIndustryAcquisitionPage.tsx"),
  read("apps/web/src/components/acquisition/BeautyLiveReviewWorkbench.tsx"),
  read("apps/api/src/products/beauty-industry/live-review-workflow.ts"),
  read("apps/api/src/routes/beauty-industry.ts"),
  read("apps/api/src/products/beauty-industry/mcp-adapter.ts"),
  read("apps/api/src/products/beauty-industry/execution.ts"),
  read("apps/api/src/products/beauty-industry/output-contract.ts"),
  read("scripts/verify-beauty-live-review-browser-e2e.mjs"),
  read("scripts/beauty-industry-live-review-workbuddy-p1-smoke.ts")
]);

assert.match(page, /\/agents\/beauty-industry\/acquisition\/live\/review/, "stable live review route is missing");
assert.match(page, /BeautyLiveReviewWorkbench/, "dedicated live review workbench is not wired");
assert.match(component, /live_review_workflow_v1/, "versioned Web\/WorkBuddy workflow is missing");
assert.match(component, /数据\/转写\/计划/, "formal staged product journey is not visible");
assert.doesNotMatch(component, /通用文本框|文字咨询/);

for (const field of ["scenario", "platform", "sessionTitle", "sessionTime", "businessObjective", "liveData", "recordingTranscript", "scriptPlan", "interactionEvidence", "projectEvidence", "conversionDefinition", "visualEvidence", "factBoundary", "sourceFilename", "parseStatus"]) {
  assert.match(workflow, new RegExp(`\\b${field}\\b`), `shared workflow field missing: ${field}`);
}
for (const term of ["baolu_live_review_engine", "beauty-industry-compliance", "live_review", "beauty.live_review", "acquisition:live-review"]) {
  assert.match(workflow + adapter, new RegExp(term.replace(/[.-]/g, "\\$&")), `fixed mapping missing: ${term}`);
}
for (const heading of ["一、核心数据速览", "二、流量诊断", "三、转化归因", "四、互动诊断", "五、话术执行对照表", "六、人货场诊断", "七、方法论沉淀", "八、下次直播调整清单"]) {
  assert.match(workflow + outputContract, new RegExp(heading), `formal output heading missing: ${heading}`);
}

assert.match(workflow, /providerCalls:\s*0/, "preflight must prove zero provider calls");
assert.match(workflow, /creditCost:\s*0/, "preflight must prove zero credit cost");
assert.match(routes, /liveReviewWorkflow/, "Web route does not accept the formal workflow");
assert.match(adapter, /BEAUTY_LIVE_REVIEW_INPUT_SCHEMA/, "WorkBuddy does not expose the shared workflow schema");
assert.match(execution, /beauty_live_review_workflow_required/, "runtime does not require the formal workflow");
assert.match(execution, /buildBeautyLiveReviewWorkflowDirective/, "formal fields do not reach the locked backend prompt");
assert.match(browserE2e, /BEAUTY_E2E_API_URL\s*\?\?\s*"http:\/\/127\.0\.0\.1:3016"/, "live review browser E2E must default to the controlled acceptance API");
assert.doesNotMatch(browserE2e, /BEAUTY_E2E_API_URL\s*\?\?\s*"http:\/\/127\.0\.0\.1:3017"/, "retired isolated API must not be the default browser target");
assert.match(browserE2e, /assertAcceptanceApiReady/, "browser E2E must fail closed before tenant creation when its API target is unavailable");
assert.match(browserE2e, /body\.checks\?\.database\?\.ok/, "browser E2E must verify database readiness before the user path");
assert.match(workbuddyE2e, /BEAUTY_E2E_API_URL\s*\?\?\s*"http:\/\/127\.0\.0\.1:3016"/, "live review WorkBuddy smoke must default to the controlled acceptance API");
assert.doesNotMatch(workbuddyE2e, /BEAUTY_E2E_API_URL\s*\?\?\s*"http:\/\/127\.0\.0\.1:3017"/, "retired isolated API must not be the default WorkBuddy target");
assert.match(workbuddyE2e, /live_review_workbuddy_api_preflight_failed/, "WorkBuddy smoke must fail closed before tenant creation when its API target is unavailable");

console.log("beauty industry live review workbench P1 smoke passed (provider=0 credits=0)");

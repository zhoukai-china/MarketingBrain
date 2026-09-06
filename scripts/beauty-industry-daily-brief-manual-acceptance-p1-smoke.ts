import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  BEAUTY_DAILY_BRIEF_MANUAL_ACCEPTANCE_LIMITS,
  buildBeautyDailyBriefManualAcceptanceRunKey,
  validateBeautyDailyBriefManualAcceptanceGrant
} from "../apps/api/src/products/beauty-industry/daily-brief-manual-acceptance.js";

const businessDate = "2026-08-26";
const contractVersion = "1.0.0";
const parentUniqueKey = `beauty-industry:${businessDate}:${contractVersion}`;
const grantId = "by20-manual-20260826-0123456789abcdef";
const valid = {
  grantId,
  businessDate,
  currentBusinessDate: businessDate,
  contractVersion,
  parentUniqueKey,
  parentNetworkRequestCount: 36,
  parentProviderCallCount: 0,
  priorSameDayAuditHttpCount: 94,
  priorManualProviderCallCount: 0,
  additionalHttpLimit: 36,
  sameDayAuditHttpLimit: 130,
  modelCallLimit: 1
};

assert.deepEqual(validateBeautyDailyBriefManualAcceptanceGrant(valid), []);
assert.equal(
  buildBeautyDailyBriefManualAcceptanceRunKey(valid),
  `${parentUniqueKey}:manual-acceptance:${grantId}`
);
assert.deepEqual(BEAUTY_DAILY_BRIEF_MANUAL_ACCEPTANCE_LIMITS, {
  additionalHttp: 36,
  priorSameDayAuditHttp: 94,
  sameDayAuditHttp: 130,
  priorManualModelCalls: 0,
  modelCalls: 1
});

for (const [field, value, expected] of [
  ["currentBusinessDate", "2026-08-27", "business_date_not_current"],
  ["contractVersion", "1.0.1", "contract_version_invalid"],
  ["parentUniqueKey", "beauty-industry:2026-08-27:1.0.0", "parent_unique_key_invalid"],
  ["parentNetworkRequestCount", 0, "parent_http_count_invalid"],
  ["parentProviderCallCount", 1, "parent_model_count_invalid"],
  ["priorSameDayAuditHttpCount", 36, "prior_same_day_http_count_invalid"],
  ["priorManualProviderCallCount", 1, "prior_manual_model_count_invalid"],
  ["additionalHttpLimit", 72, "additional_http_limit_invalid"],
  ["sameDayAuditHttpLimit", 72, "same_day_http_limit_invalid"],
  ["modelCallLimit", 2, "model_call_limit_invalid"]
] as const) {
  const issues = validateBeautyDailyBriefManualAcceptanceGrant({ ...valid, [field]: value });
  assert.ok(issues.includes(expected), `${field} should fail closed with ${expected}`);
}

assert.ok(validateBeautyDailyBriefManualAcceptanceGrant({ ...valid, grantId: "replayable" }).includes("grant_id_invalid"));

const routeFiles = [
  "apps/api/src/routes/beauty-industry.ts",
  "apps/api/src/routes/workbuddy-mcp.ts",
  "apps/web/src/lib/api.ts"
].map((path) => readFileSync(resolve(path), "utf8")).join("\n");
assert.doesNotMatch(routeFiles, /manualAcceptanceGrant|manual-acceptance|sameDayAuditHttpLimit/u, "manual grant must not become a Web or WorkBuddy escape hatch");

const manualSource = readFileSync(resolve("apps/api/src/products/beauty-industry/daily-brief-manual-acceptance.ts"), "utf8");
assert.doesNotMatch(manualSource, /mcp-skills[\\/](?:candidates|intake|quarantine)|\.codex[\\/]skills/iu);

console.log("beauty_industry_daily_brief_manual_acceptance_p1_smoke: PASS");

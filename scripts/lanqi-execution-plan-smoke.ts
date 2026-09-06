import assert from "node:assert/strict";
import { buildLanqiExecutionPlan } from "../apps/api/src/services/lanqi-execution-plan.js";

const empty = buildLanqiExecutionPlan({ confirmedFacts: {}, estimatedFacts: {}, needsInput: [] }, new Date("2026-08-13T00:00:00.000Z"));
assert.equal(empty.executionReadiness, "blocked_pending_store_facts");
assert.equal(empty.actionMode, "draft_only");
assert.ok(empty.steps.every(step => step.status === "blocked"));
assert.equal("projectName" in empty, false);
assert.equal("internalPrice" in empty, false);

const foundationReady = buildLanqiExecutionPlan({
  confirmedFacts: {
    storeName: "脱敏门店", city: "烟台", storeType: "美容门店", mainServices: ["护理"],
    monthlyNewCustomersRange: "待核实", repeatPurchaseRateRange: "待核实", primaryChannels: ["到店"], currentChallenges: ["复购待提升"],
  },
  estimatedFacts: {},
  needsInput: [],
}, new Date("2026-08-13T00:00:00.000Z"));
assert.equal(foundationReady.executionReadiness, "blocked_pending_authorized_knowledge");
assert.equal(foundationReady.steps[0]?.status, "ready_to_prepare");
assert.equal(foundationReady.steps[1]?.status, "blocked");
assert.equal(foundationReady.steps[2]?.status, "blocked");
assert.ok(foundationReady.safetyBoundaries.some(item => item.includes("推荐关系")));

console.log("lanqi execution-plan smoke: PASS");

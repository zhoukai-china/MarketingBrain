import assert from "node:assert/strict";
import { buildLanqiDiagnosis } from "../apps/api/src/services/lanqi-diagnosis.js";

const noData = buildLanqiDiagnosis({ confirmedFacts: {}, estimatedFacts: {}, needsInput: [] }, new Date("2026-08-13T00:00:00.000Z"));
assert.equal(noData.confidence, "资料不足");
assert.equal(noData.knowledgeStatus, "pending_authorized_knowledge");
assert.ok(noData.evidence[0].detail.includes("不会"));
assert.ok(noData.blockedOutputs.includes("内部定价建议"));

const baseData = buildLanqiDiagnosis({
  confirmedFacts: { storeName: "示例门店", city: "烟台", storeType: "皮肤管理店", mainServices: ["皮肤管理"], teamSize: "3 人" },
  estimatedFacts: { monthlyRevenueRange: "10-20 万", monthlyNewCustomersRange: "50-80 人", repeatPurchaseRateRange: "30%-40%", primaryChannels: ["老客转介绍"] },
  needsInput: ["currentChallenges"],
}, new Date("2026-08-13T00:00:00.000Z"));
assert.equal(baseData.confidence, "基础可诊断");
assert.ok(baseData.evidence.some(item => item.source === "confirmed"));
assert.ok(baseData.evidence.some(item => item.source === "estimated"));
assert.ok(baseData.evidence.some(item => item.fields.includes("currentChallenges")));

console.log("Lanqi diagnosis evidence and insufficient-data smoke passed.");

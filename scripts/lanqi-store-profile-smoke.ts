import assert from "node:assert/strict";
import {
  canEditLanqiStoreProfile,
  emptyLanqiStoreProfile,
  validateLanqiStoreProfilePayload,
} from "../apps/api/src/services/lanqi-store-profile.js";

const valid = {
  confirmedFacts: { storeName: "示例门店", city: "烟台", mainServices: ["皮肤管理"] },
  estimatedFacts: { teamSize: "3-5 人", monthlyRevenueRange: "10-20 万" },
  needsInput: ["repeatPurchaseRateRange"] as const,
};

assert.deepEqual(validateLanqiStoreProfilePayload(valid), []);
assert.deepEqual(validateLanqiStoreProfilePayload({
  ...valid,
  estimatedFacts: { ...valid.estimatedFacts, city: "待核实" },
}), ["fact_source_conflict:city"]);
assert.deepEqual(validateLanqiStoreProfilePayload({
  ...valid,
  needsInput: ["city"],
}), ["needs_input_conflict:city"]);
assert.deepEqual(validateLanqiStoreProfilePayload({
  confirmedFacts: { storeName: "门店" },
  estimatedFacts: {},
  needsInput: [],
}), []);
assert.equal(canEditLanqiStoreProfile("owner"), true);
assert.equal(canEditLanqiStoreProfile("admin"), true);
assert.equal(canEditLanqiStoreProfile("operator"), false);
assert.equal(emptyLanqiStoreProfile("staff").canEdit, false);

console.log("Lanqi store-profile source and permission smoke passed.");

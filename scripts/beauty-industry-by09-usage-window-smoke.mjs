import assert from "node:assert/strict";
import { parseBy09ProviderUsageWindow } from "./beauty-industry-by09-usage-window.mjs";

const startedAt = new Date("2026-08-24T12:00:01.250Z");
const endedAt = new Date("2026-08-24T12:00:02.500Z");
const fixture = [
  {
    __REALTIME_TIMESTAMP: String(Date.parse("2026-08-24T12:00:01.100Z") * 1_000),
    MESSAGE: JSON.stringify({ event: "domestic_provider_usage", requestFingerprint: "previous" })
  },
  {
    __REALTIME_TIMESTAMP: String(Date.parse("2026-08-24T12:00:01.800Z") * 1_000),
    MESSAGE: JSON.stringify({ event: "domestic_provider_usage", requestFingerprint: "current" })
  }
].map((item) => JSON.stringify(item)).join("\n");

const matched = parseBy09ProviderUsageWindow(fixture, startedAt, endedAt);
assert.equal(matched.length, 1, "a previous request in the same rounded second must not enter the current usage window");
assert.equal(matched[0].requestFingerprint, "current");
console.log("beauty_industry_by09_usage_window_smoke_passed");

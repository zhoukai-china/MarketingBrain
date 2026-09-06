import assert from "node:assert/strict";

assert.equal(process.env.FIP_LIVE_PROVIDER_CONFIRMED, "1", "single-request Eval stays disabled until the gateway fix is handed back");
process.env.FIP_LIVE_TARGET ||= "franchise";
process.env.FIP_LIVE_REPEATS = "1";

void import("./verify-founder-ip-content-live-provider.ts").catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

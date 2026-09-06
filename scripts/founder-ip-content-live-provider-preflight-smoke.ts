import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const live = readFileSync(new URL("./verify-founder-ip-content-live-provider.ts", import.meta.url), "utf8");
const single = readFileSync(new URL("./verify-founder-ip-content-live-provider-single.ts", import.meta.url), "utf8");
const browser = readFileSync(new URL("./verify-founder-ip-content-browser-e2e.ps1", import.meta.url), "utf8");
const playwrightBrowser = readFileSync(new URL("./verify-founder-ip-content-browser-playwright-e2e.mjs", import.meta.url), "utf8");

assert.match(live, /FIP_LIVE_PROVIDER_CONFIRMED/, "real Provider Eval must stay disabled until the gateway handback");
assert.match(live, /\/ready/, "real Provider Eval must preflight runtime readiness before creating test data");
assert.match(live, /dataMode[\s\S]*database/, "real Provider Eval must require database mode");
assert.match(live, /deepseek-v4-pro/, "real Provider Eval must require the current Pro model id");
assert.match(live, /AbortSignal\.timeout/, "every real Provider request must have a bounded timeout");
assert.match(live, /FIP_LIVE_TARGET/, "the 4x3 harness must support a one-target repro");
assert.match(live, /FIP_LIVE_REPEATS/, "the harness must support one request and three-run stability modes");
assert.match(live, /latencyMs[\s\S]*success[\s\S]*fallback/, "real runs must emit non-sensitive provider/model stage audit evidence");
assert.match(live, /preserve source evidence/, "final API output must be checked against source evidence");
assert.match(live, /preserve the goal relation/, "final API output must be checked against the acquisition goal");
assert.match(live, /must remain tenant-isolated/, "real runs must enforce cross-tenant 404");
assert.match(live, /one identical fixed template/, "three-run stability must reject an identical fixed-template result");
assert.match(single, /FIP_LIVE_REPEATS = "1"/, "single-request repro must force exactly one model request");
assert.doesNotMatch(browser, /Invoke-FipJson\s+"POST"\s+"[^\"]*\/generate"/, "browser E2E must not send a new model request after the live-provider batch has passed");
assert.match(browser, /model_requests=0/, "browser E2E must report its zero-model-request boundary");
assert.match(browser, /failure-intercepted/, "browser E2E must use a controlled local failure instead of a Provider request");
assert.match(browser, /cancel-intercepted/, "browser E2E must use a controlled cancellable request instead of a Provider request");
assert.match(browser, /bsk session stop/, "browser E2E must clean up its controlled browser session");
assert.doesNotMatch(playwrightBrowser, /\/generate["'`]/, "Playwright fallback must not send a model request");
assert.match(playwrightBrowser, /modelRequests,\s*0/, "Playwright fallback must report and enforce zero model requests");
assert.match(playwrightBrowser, /browser\.close\(\)/, "Playwright fallback must always close the system browser");

console.log("founder_ip_content_live_provider_preflight_smoke:PASS");

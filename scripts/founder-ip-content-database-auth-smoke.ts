import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const runtimeVerification = readFileSync(new URL("./verify-founder-ip-content-generation.ts", import.meta.url), "utf8");
const liveVerification = readFileSync(new URL("./verify-founder-ip-content-live-provider.ts", import.meta.url), "utf8");

for (const source of [runtimeVerification, liveVerification]) {
  assert.match(source, /\/auth\/dev-login/, "database FIP verification must create a scoped test workspace");
  assert.match(source, /authorization:\s*`Bearer \$\{(?:payload|response\.payload)\.token\}`/, "database FIP verification must use the returned scoped token");
  assert.doesNotMatch(source, /x-sitong-tenant-id|x-sitong-user-id/, "database FIP verification must not impersonate a membership with demo headers");
}

assert.match(liveVerification, /method = body === undefined \? "GET" : "POST"/, "live verification must support the actual goal-brief HTTP method");
assert.match(liveVerification, /founder-ip-goal-briefs[\s\S]*?\}, "PUT"\)/, "live verification must save each goal brief with PUT before generation");

console.log("founder_ip_content_database_auth_smoke:PASS");

import assert from "node:assert/strict";
import { classifyGetNoteFailure } from "../apps/api/src/services/getnote-connector.js";

assert.equal(classifyGetNoteFailure("getnote_http_401"), "authorization");
assert.equal(classifyGetNoteFailure("getnote_http_403"), "authorization");
assert.equal(classifyGetNoteFailure("getnote_api_10001"), "authorization");
assert.equal(classifyGetNoteFailure("getnote_http_429"), "rate_limit");
assert.equal(classifyGetNoteFailure("getnote_api_10202"), "rate_limit");
assert.equal(classifyGetNoteFailure("getnote_http_502"), "temporary");
assert.equal(classifyGetNoteFailure("fetch failed"), "temporary");
assert.equal(classifyGetNoteFailure("unexpected_payload"), "unknown");

console.log(JSON.stringify({
  passed: true,
  assertion: "Only explicit authorization failures invalidate saved GetNote credentials"
}, null, 2));

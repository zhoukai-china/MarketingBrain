import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const servicePath = process.argv[2] || process.env.BEAUTY_BETA_SERVICE_FILE;
assert.ok(servicePath, "usage: node scripts/beauty-industry-beta-self-mcp-config-smoke.mjs <service-file>");

const service = await readFile(servicePath, "utf8");

assert.match(service, /\bPORT=3004\b/, "beauty beta must keep its isolated API port");
assert.match(
  service,
  /\bORIGINAL_SKILL_ROOT=\/opt\/beauty-industry-beta\/mcp-skills\/skills\b/,
  "beauty beta must load original Skills from its own release"
);
assert.match(
  service,
  /\bSKILL_MCP_URL=http:\/\/127\.0\.0\.1:3004\/mcp\b/,
  "beauty beta must resolve required Skill packages through its own MCP endpoint"
);
assert.doesNotMatch(
  service,
  /\bSKILL_MCP_URL=http:\/\/127\.0\.0\.1:(?!3004\b)\d+\/mcp\b/,
  "beauty beta must not inherit another product deployment's self-MCP endpoint"
);

console.log("beauty_industry_beta_self_mcp_config_smoke:PASS");

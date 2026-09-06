import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(path, "utf8");

const [adapter, workflows, route, page, workbuddyPage, authRoute, billingRoute, inviteScript, creditScript, runtimeConfig, prelaunch, webApi, webMain] = await Promise.all([
  read("apps/api/src/products/beauty-industry/mcp-adapter.ts"),
  read("apps/api/src/products/beauty-industry/workflows.ts"),
  read("apps/api/src/routes/beauty-industry.ts"),
  read("apps/web/src/pages/BeautyIndustryAcquisitionPage.tsx"),
  read("apps/web/src/pages/BeautyIndustryWorkBuddyPage.tsx"),
  read("apps/api/src/routes/auth.ts"),
  read("apps/api/src/routes/billing.ts"),
  read("scripts/create-beta-invite.mjs"),
  read("scripts/grant-beauty-beta-credits.mjs"),
  read("apps/api/src/config/env.ts"),
  read("scripts/prelaunch-check.mjs"),
  read("apps/web/src/lib/api.ts"),
  read("apps/web/src/main.tsx")
]);

const publicTools = [
  "beauty.topic_ideas",
  "beauty.content_ten_pack",
  "beauty.xiaohongshu_package",
  "beauty.live_script",
  "beauty.video_data_review",
  "beauty.live_review",
  "beauty.sales_advice"
];

for (const tool of publicTools) {
  assert.match(adapter + workflows, new RegExp(`[\"']${tool.replaceAll(".", "\\.")}[\"']`), `${tool} must remain registered`);
  assert.match(route, new RegExp(`[\"']${tool.replaceAll(".", "\\.")}[\"']`), `${tool} must remain accepted by web API`);
  assert.match(page, new RegExp(`[\"']${tool.replaceAll(".", "\\.")}[\"']`), `${tool} must remain visible in web product`);
}

assert.match(adapter, /acquisition:video-content-review/, "admitted video content review scope is missing");
assert.match(adapter, /BEAUTY_WORKFLOWS\["video-content-review"\]\.toolName/, "admitted video content review tool is missing");
assert.match(route, /["']beauty\.video_content_review["']/, "admitted video content review is not accepted by web API");
assert.match(page, /\/agents\/beauty-industry\/acquisition\/video\/content-review/, "video content review must keep one stable page");
assert.doesNotMatch(page, /pendingValidation:\s*true/, "admitted page still looks pending");
assert.match(page, /runSelectedTask\(["']beauty\.video_content_review["']/, "admitted page cannot create a product run");

assert.match(workflows, /"video-content-review"[\s\S]*capabilityId: "shooting_editing"/, "admitted video content review is missing from the beauty product registry");
assert.match(page, /文生视频（数字人方向 · 规划中）/);
assert.match(page, /图生视频（数字人方向 · 规划中）/);
assert.doesNotMatch(adapter, /text_to_video|image_to_video|投流|dou_plus|local_push/i, "planned or retired capabilities leaked into MCP");

assert.match(page, /邀请制内测/, "web product must identify the release as invite-only beta");
assert.match(workbuddyPage, /邀请制内测/, "WorkBuddy connection page must identify the release as invite-only beta");
assert.doesNotMatch(page, /充值|立即支付|购买积分/, "beauty beta page must not expose self-service payment");
assert.doesNotMatch(workbuddyPage, /充值|立即支付|购买积分/, "WorkBuddy beta page must not expose self-service payment");

assert.match(authRoute, /env\.NODE_ENV === "production"[\s\S]{0,500}dev login is disabled in production/, "production dev login must remain disabled");
assert.match(billingRoute, /mock-pay[\s\S]{0,900}env\.NODE_ENV === "production"/, "production mock pay must remain disabled");
assert.match(runtimeConfig, /production[\s\S]{0,300}LLM_MOCK_MODE[\s\S]{0,300}USE_MOCK_LLM/, "runtime config must reject mock text providers in production");
assert.match(prelaunch, /LLM_MOCK_MODE[\s\S]{0,300}USE_MOCK_LLM/, "prelaunch must reject mock text providers");
assert.match(inviteScript, /beauty-industry/, "manual invite script must accept the beauty product");
assert.match(creditScript, /beauty-industry/, "manual controlled-credit script must be product scoped");
assert.match(creditScript, /tenantProductEntitlement/, "manual credits must require an active beauty entitlement");
assert.match(creditScript, /item === ["']--["']/, "manual credit CLI must tolerate the pnpm argument separator");
assert.match(webApi, /export function getAppRoutePath/, "subpath deployments need one shared route-path normalizer");
assert.match(webMain, /getAppRoutePath\(window\.location\.pathname\)/, "the web router must strip the configured Vite base path");
assert.doesNotMatch(webMain, /rawPath\.startsWith\("\/os-v2"\)/, "the web router must not hard-code the legacy /os-v2 deployment path");

console.log("beauty industry invite beta scope smoke passed");

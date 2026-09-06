import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  assertNoBeautyIndustryBrandOverride,
  createBeautyIndustryBrandRegistry,
  getBeautyIndustryBrandConfig,
  resolveBeautyIndustryBrandContext,
  toBeautyIndustryPublicBrand
} from "../apps/api/src/products/beauty-industry/brand-config.js";

const read = (path: string) => readFileSync(path, "utf8");

const defaultBrand = resolveBeautyIndustryBrandContext(undefined);
assert.equal(defaultBrand.config.brandCode, "default");
assert.equal(defaultBrand.config.displayName, "美业智能体");
assert.equal(defaultBrand.knowledge.status, "not_configured");

const lanqi = resolveBeautyIndustryBrandContext({ beautyIndustryBrand: { brandCode: "lanqi" } });
assert.equal(lanqi.config.brandCode, "lanqi");
assert.equal(lanqi.config.displayName, "兰琪");
assert.equal(lanqi.config.theme.tokenName, "lanqi-orange");
assert.equal(lanqi.config.logo.kind, "text");
assert.equal(lanqi.config.logo.text, "兰琪");
assert.equal(lanqi.config.domain.mode, "shared_current_entry");
assert.equal(lanqi.knowledge.status, "awaiting_authorized_sources");
assert.equal(lanqi.knowledge.authorized, false);
assert.equal(lanqi.knowledge.content, undefined);
assert.equal(lanqi.config.knowledgePackRef, null);

const unknown = resolveBeautyIndustryBrandContext({ beautyIndustryBrand: { brandCode: "unknown-brand" } });
assert.equal(unknown.config.brandCode, "default", "unknown persisted brand must fail closed to the neutral core");
const coreWithoutLanqi = resolveBeautyIndustryBrandContext(
  { beautyIndustryBrand: { brandCode: "lanqi" } },
  createBeautyIndustryBrandRegistry([])
);
assert.equal(coreWithoutLanqi.config.brandCode, "default", "beauty core must remain runnable when the Lanqi package is unregistered");

assert.throws(() => assertNoBeautyIndustryBrandOverride({ brandCode: "lanqi" }), /beauty_brand_override_forbidden/);
assert.throws(() => assertNoBeautyIndustryBrandOverride({ brand: "lanqi" }), /beauty_brand_override_forbidden/);
assert.doesNotThrow(() => assertNoBeautyIndustryBrandOverride({ question: "皮肤管理内容" }));

const publicLanqi = toBeautyIndustryPublicBrand(lanqi);
assert.equal(publicLanqi.brandCode, "lanqi");
assert.equal("knowledgePackRef" in publicLanqi, false, "internal knowledge reference must not be exposed to web or WorkBuddy");
assert.equal("content" in publicLanqi.knowledge, false);

const lanqiConfig = getBeautyIndustryBrandConfig("lanqi");
for (const color of [lanqiConfig.theme.primary, lanqiConfig.theme.primaryDark, lanqiConfig.theme.primaryLight]) {
  assert.match(color, /^#[0-9A-F]{6}$/);
}

const beautyRoute = read("apps/api/src/routes/beauty-industry.ts");
const workbuddyRoute = read("apps/api/src/routes/workbuddy-mcp.ts");
const shell = read("apps/web/src/components/beauty-industry/BeautyIndustryShell.tsx");
const page = read("apps/web/src/pages/BeautyIndustryAcquisitionPage.tsx");
const auth = read("apps/api/src/routes/auth.ts");
const inviteScript = read("scripts/create-beta-invite.mjs");
const schema = read("packages/db/prisma/schema.prisma");

assert.match(beautyRoute, /resolveBeautyIndustryBrandContext/);
assert.match(beautyRoute, /toBeautyIndustryPublicBrand/);
assert.match(beautyRoute, /assertNoBeautyIndustryBrandOverride/);
assert.match(workbuddyRoute, /brandContext/);
assert.match(workbuddyRoute, /resolveBeautyIndustryBrandContext/);
assert.match(shell, /brand\.displayName/);
assert.match(shell, /--beauty-green/);
assert.match(page, /brand=\{overview\?\.brand\}/);
assert.match(auth, /assignBeautyIndustryBrandToTenant/);
assert.match(inviteScript, /brand-code/);
assert.match(schema, /brandCode\s+String\?/);

for (const source of [beautyRoute, workbuddyRoute, shell, page]) {
  assert.doesNotMatch(source, /meiye-store-ai|WorkBuddy\/sitong-outsourcing|16\s*年|35\s*项|两万|9800|不破皮体验卡/);
}

process.stdout.write("beauty_industry_brand_package_p1_smoke=PASS;default=neutral;lanqi=lanqi-orange;knowledge=fail_closed;client_override=blocked;workbuddy=shared_context;provider_calls=0\n");

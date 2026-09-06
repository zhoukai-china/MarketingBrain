import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  assessBeautyXhsTaskReadiness,
  buildBeautyXhsTaskSnapshot
} from "../apps/api/src/products/beauty-industry/xhs-task-snapshot.js";
import { executeBeautyIndustryProductTool } from "../apps/api/src/products/beauty-industry/execution.js";
import { getRuntimeAgent } from "../apps/api/src/services/agent-runtime.js";
import type { LlmProvider } from "../packages/agent/src/index.js";

const emptyProfile = null;
const completeProfile = {
  version: 3,
  segment: "lifestyle_beauty" as const,
  customSegment: "",
  operationType: "single_store" as const,
  operatingStage: "growth" as const,
  storeName: "合成测试门店",
  city: "",
  services: ["皮肤管理产品"],
  targetCustomers: "附近成年女性顾客",
  channels: ["小红书"],
  acquisitionGoal: "到店咨询",
  factBoundaries: "",
  confirmedAt: "2026-08-31T00:00:00.000Z"
};

const missing = assessBeautyXhsTaskReadiness(buildBeautyXhsTaskSnapshot({
  question: "写一篇小红书图文",
  profile: emptyProfile,
  professionalOptions: { imageCount: 3 }
}));
assert.deepEqual(missing.missingFields, ["project", "audience"]);
assert.equal(missing.ready, false);

const profileDefaults = buildBeautyXhsTaskSnapshot({
  question: "为本次获客写一篇小红书图文",
  profile: completeProfile,
  professionalOptions: { imageCount: 3 }
});
assert.equal(assessBeautyXhsTaskReadiness(profileDefaults).ready, true);
assert.equal(profileDefaults.project, "皮肤管理产品");
assert.equal(profileDefaults.audience, "附近成年女性顾客");

const perTaskOverrides = buildBeautyXhsTaskSnapshot({
  question: "为本次获客写一篇小红书图文",
  profile: completeProfile,
  professionalOptions: { project: "问题肌修复", audience: "烟台25-45岁女性", imageCount: 3 }
});
assert.equal(assessBeautyXhsTaskReadiness(perTaskOverrides).ready, true);
assert.equal(perTaskOverrides.project, "问题肌修复");
assert.equal(perTaskOverrides.audience, "烟台25-45岁女性");

async function verifyRuntimePreflight(): Promise<void> {
  const runtimeAgent = await getRuntimeAgent("agent_beauty_acquisition");
  let providerCalls = 0;
  await assert.rejects(
    () => executeBeautyIndustryProductTool({
    context: {
      tenantId: "beauty-xhs-preflight-tenant",
      userId: "beauty-xhs-preflight-user",
      role: "owner",
      planCode: "local_premium",
      source: "demo",
      creditBalance: 500,
      profile: {
        tenantId: "beauty-xhs-preflight-tenant",
        tenantName: "合成预检租户",
        tenantType: "local_business",
        industry: "生活美容",
        data: { synthetic: true }
      }
    },
    agent: runtimeAgent,
    provider: {
      name: "must-not-run-before-xhs-preflight",
      getModel: () => "deepseek-v4-pro",
      async complete() {
        providerCalls += 1;
        throw new Error("provider_must_not_run");
      }
    } as LlmProvider & { getModel: () => string },
    requestId: "beauty-xhs-preflight-runtime-0001",
    requestFingerprint: "beauty-xhs-preflight-runtime-fingerprint",
    operatingEntityId: "beauty-xhs-preflight-tenant",
    channel: "web",
    capabilityId: "beauty_xiaohongshu_package",
    skillId: "wechat-xhs-content-line",
    input: "写一篇小红书图文",
    professionalOptions: { imageCount: 3 },
    deviceScope: "desktop"
    }),
    /beauty_xhs_fields_required:project,audience/
  );
  assert.equal(providerCalls, 0, "missing required XHS fields must fail before provider execution");
}

const route = readFileSync("apps/api/src/routes/beauty-industry.ts", "utf8");
const execution = readFileSync("apps/api/src/products/beauty-industry/execution.ts", "utf8");
const workbench = readFileSync("apps/web/src/components/acquisition/BeautyXhsWorkbench.tsx", "utf8");
const page = readFileSync("apps/web/src/pages/BeautyIndustryAcquisitionPage.tsx", "utf8");

assert.match(route, /beauty_xhs_information_required/);
assert.match(route, /category:\s*"preflight"/);
assert.match(execution, /assertBeautyXhsTaskReady/);
assert.ok(execution.indexOf("assertBeautyXhsTaskReady(xhsTaskSnapshot)") < execution.indexOf("reservation = await reserveCreditsBeforeProvider"));
assert.ok(execution.indexOf("assertBeautyXhsTaskReady(xhsTaskSnapshot)") < execution.indexOf("await invokeSkillViaGateway"));
assert.match(workbench, /本次主题与目的（必填）/);
assert.match(workbench, /目标顾客（必填）/);
assert.match(workbench, /本次项目（必填）/);
assert.match(workbench, /补齐后才会调用模型和预留积分/);
assert.match(page, /assessXhsWebReadiness/);
assert.match(page, /missingRequiredFields=\{assessXhsWebReadiness/);

verifyRuntimePreflight()
  .then(() => console.log("BEAUTY_XHS_INPUT_PREFLIGHT_P1_SMOKE_OK required=theme,project,audience profile_defaults=true provider_before=0 credits_before=0"))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });

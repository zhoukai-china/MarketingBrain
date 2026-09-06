import assert from "node:assert/strict";
import {
  buildBeautyIndustryRunInput,
  deleteBeautyIndustryProfileFromTenantData,
  mergeBeautyIndustryProfileIntoTenantData,
  normalizeBeautyIndustryProfile
} from "../apps/api/src/products/beauty-industry/profile.js";

const confirmed = normalizeBeautyIndustryProfile({
  segment: "skin_management",
  operationType: "single_store",
  operatingStage: "growth",
  storeName: "青禾皮肤管理",
  city: "烟台",
  services: ["基础清洁", "日常补水"],
  targetCustomers: "附近关注日常皮肤管理的顾客",
  channels: ["小红书", "抖音"],
  acquisitionGoal: "先提升真实到店咨询",
  factBoundaries: "无医疗资质，不承诺疗效、价格或案例",
  source: "user_confirmed",
  confirmationStatus: "confirmed",
  version: 2,
  confirmedAt: "2026-08-22T01:00:00.000Z"
});

assert.equal(confirmed.segment, "skin_management");
assert.equal(confirmed.confirmationStatus, "confirmed");
assert.deepEqual(confirmed.services, ["基础清洁", "日常补水"]);

assert.throws(
  () => normalizeBeautyIndustryProfile({ ...confirmed, segment: "medical_beauty", factBoundaries: "" }),
  /medical_beauty_boundary_required/
);
assert.throws(
  () => normalizeBeautyIndustryProfile({ ...confirmed, segment: "餐饮" }),
  /beauty_segment_invalid/
);
assert.throws(
  () => normalizeBeautyIndustryProfile({ ...confirmed, segment: "other", customSegment: "" }),
  /beauty_segment_custom_required/
);
const customSegment = normalizeBeautyIndustryProfile({ ...confirmed, segment: "other", customSegment: "采耳" });
assert.equal(customSegment.customSegment, "采耳");

const tenantA = mergeBeautyIndustryProfileIntoTenantData({ branding: { name: "保留" } }, confirmed);
assert.deepEqual(tenantA.branding, { name: "保留" });
assert.equal((tenantA.beautyIndustry as Record<string, unknown>).storeName, "青禾皮肤管理");
const tenantB = mergeBeautyIndustryProfileIntoTenantData({}, { ...confirmed, storeName: "另一家店" });
assert.notDeepEqual(tenantA.beautyIndustry, tenantB.beautyIndustry);

const quick = buildBeautyIndustryRunInput({
  question: "给我一套本周获客选题",
  profile: confirmed,
  mode: "quick"
});
assert.match(quick, /快速模式/);
assert.match(quick, /^用户这次说：给我一套本周获客选题/);
assert.ok(quick.indexOf("用户这次说：") < quick.indexOf("【当前经营主体已确认门店档案】"));
assert.match(quick, /青禾皮肤管理/);
assert.match(quick, /皮肤管理/);
assert.match(quick, /基础清洁/);
assert.doesNotMatch(quick, /医疗美容/);

const professional = buildBeautyIndustryRunInput({
  question: "做一组小红书内容",
  profile: confirmed,
  mode: "professional",
  professionalOptions: {
    audience: "附近上班族",
    project: "日常补水",
    platform: "小红书",
    tone: "温和专业",
    visualStyle: "干净自然",
    budgetPreview: "仅预览，不执行",
    contentStructure: "问题切入—日常建议—到店承接",
    shootingRequirements: "无顾客正脸",
    edlRequirements: "30秒竖屏",
    imageCount: 3
  }
});
assert.match(professional, /专业模式/);
assert.match(professional, /附近上班族/);
assert.match(professional, /3/);
assert.doesNotMatch(professional, /投流|trafficPreview/);

const deleted = deleteBeautyIndustryProfileFromTenantData(tenantA);
assert.equal("beautyIndustry" in deleted, false);
assert.deepEqual(deleted.branding, { name: "保留" });

console.log("beauty industry profile and shared memory smoke passed");

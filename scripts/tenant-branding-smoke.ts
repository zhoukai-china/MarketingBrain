import assert from "node:assert/strict";
import {
  detectBrandImageType,
  resolveTenantBranding
} from "../apps/api/src/routes/tenant.js";
import {
  isTenantBrandedAgent,
  tenantAgentDisplayName
} from "../packages/shared/src/index.js";

const defaults = resolveTenantBranding({});
assert.deepEqual(defaults, {
  brandName: "思潼",
  systemName: "思潼AI增长飞轮",
  primaryColor: "#1f6a57",
  loginHeadline: "进入思潼AI增长飞轮",
  loginDescription: "进入企业专属的智能体工作台，用知识、数据与专业能力持续推动业务增长。",
  exportFooter: "由思潼AI增长飞轮生成",
  isCustomized: false
});

const migratedLegacyDefault = resolveTenantBranding({
  branding: {
    brandName: "枕水江南",
    systemName: "枕水江南外卖增长智能体",
    primaryColor: "#1f6a57",
    loginHeadline: "让 AI 成为枕水江南外卖增长的工作台",
    loginDescription: "导入美团和淘宝闪购经营数据，定位增长瓶颈，生成待审批、可复盘的行动方案。",
    exportFooter: "由枕水江南外卖增长智能体生成 · 供总部审批与门店执行",
    isCustomized: true
  }
});
assert.deepEqual(migratedLegacyDefault, defaults);

const tenantA = resolveTenantBranding({
  branding: {
    brandName: "甲方品牌",
    systemName: "甲方品牌获客系统",
    logoUrl: "/tenant-brand-assets/tenant-a/11111111-1111-1111-1111-111111111111.png",
    primaryColor: "#B4235A",
    loginHeadline: "甲方品牌智能工作台",
    loginDescription: "企业成员登录后即可开始工作。",
    exportFooter: "由甲方品牌智能工作台生成",
    isCustomized: true
  }
});
assert.equal(tenantA.brandName, "甲方品牌");
assert.equal(tenantA.systemName, "甲方品牌获客系统");
assert.equal(tenantA.primaryColor, "#B4235A");
assert.equal(tenantA.loginHeadline, "甲方品牌智能工作台");
assert.equal(tenantA.loginDescription, "企业成员登录后即可开始工作。");
assert.equal(tenantA.exportFooter, "由甲方品牌智能工作台生成");
assert.equal(tenantA.isCustomized, true);
assert.match(tenantA.logoUrl ?? "", /tenant-a/);
assert.equal(isTenantBrandedAgent("takeaway-growth", tenantA), true);
assert.equal(isTenantBrandedAgent("sales", tenantA), true);
assert.equal(tenantAgentDisplayName("takeaway-growth", "外卖增长", { ...tenantA, brandName: "枕水江南" }), "枕水江南外卖增长智能体");
assert.equal(tenantAgentDisplayName("acquisition", "品牌获客", tenantA), "品牌获客");

const tenantB = resolveTenantBranding({
  branding: {
    brandName: "乙方品牌",
    systemName: "乙方工作台",
    logoUrl: "https://malicious.example/logo.svg",
    primaryColor: "red",
    isCustomized: true
  }
});
assert.equal(tenantB.brandName, "乙方品牌");
assert.equal(tenantB.primaryColor, "#1f6a57");
assert.equal(tenantB.logoUrl, undefined);
assert.notEqual(tenantA.brandName, tenantB.brandName);
assert.equal(tenantAgentDisplayName("takeaway-growth", "思潼·外卖增长智能体", defaults), "思潼·外卖增长智能体");

assert.deepEqual(detectBrandImageType(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), { extension: "png" });
assert.deepEqual(detectBrandImageType(Buffer.from([0xff, 0xd8, 0xff, 0x00])), { extension: "jpg" });
assert.deepEqual(detectBrandImageType(Buffer.from("RIFF1234WEBP", "ascii")), { extension: "webp" });
assert.equal(detectBrandImageType(Buffer.from("<svg><script /></svg>")), undefined);

console.log("tenant branding smoke: ok");

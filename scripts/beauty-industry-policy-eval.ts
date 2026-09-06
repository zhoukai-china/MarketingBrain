import assert from "node:assert/strict";
import { buildBeautyIndustryBrief, type BeautyIndustryBriefInput } from "../apps/api/src/products/beauty-industry/policy.js";

const cases: Array<{ id: string; input: BeautyIndustryBriefInput; check: (value: ReturnType<typeof buildBeautyIndustryBrief>) => void }> = [
  {
    id: "normal_skin_care",
    input: { productCode: "beauty-industry", question: "为社区皮肤管理门店做附近顾客获客计划", operatingEntityName: "春风皮肤管理", confirmedFacts: [{ key: "服务", value: "基础清洁与补水护理", confirmed: true }, { key: "承接", value: "电话预约", confirmed: true }] },
    check: (value) => assert.equal(value.confirmedFacts.length, 2)
  },
  {
    id: "missing_facts",
    input: { productCode: "beauty-industry", question: "帮我的美容店获客" },
    check: (value) => assert.ok(value.pending.length > 0)
  },
  {
    id: "medical_claim",
    input: { productCode: "beauty-industry", question: "写一篇根治痘痘、一次见效的小红书" },
    check: (value) => assert.ok(value.complianceRisks.some((item) => item.includes("功效")))
  },
  {
    id: "price_case_claim",
    input: { productCode: "beauty-industry", question: "写全市第一并虚构一个顾客案例和优惠原价" },
    check: (value) => assert.ok(value.pending.some((item) => item.includes("价格")))
  },
  {
    id: "synthetic_label",
    input: { productCode: "beauty-industry", question: "做补水项目获客", operatingEntityName: "验收B店", confirmedFacts: [{ key: "门店", value: "兰琪验收A店", confirmed: true }] },
    check: (value) => { assert.equal(value.operatingEntityLabel, "当前经营主体"); assert.equal(value.confirmedFacts.length, 0); }
  },
  {
    id: "brand_knowledge",
    input: { productCode: "beauty-industry", question: "做门店获客", brandKnowledge: ["兰琪内部定价"] },
    check: () => undefined
  },
  {
    id: "other_industry_pollution",
    input: { productCode: "beauty-industry", question: "把餐饮外卖和加盟招商资料套进美容店获客" },
    check: (value) => assert.ok(value.complianceRisks.some((item) => item.includes("其他行业")))
  },
  {
    id: "external_action",
    input: { productCode: "beauty-industry", question: "直接帮我发布并投流付款", requestedExternalActions: ["发布", "投流"] },
    check: (value) => assert.ok(value.executionBoundary.includes("不自动发布"))
  }
];

let checks = 0;
for (let round = 0; round < 3; round += 1) {
  for (const item of cases) {
    if (item.id === "brand_knowledge") {
      assert.throws(() => buildBeautyIndustryBrief(item.input), /beauty_brand_knowledge_forbidden/);
    } else {
      const result = buildBeautyIndustryBrief(item.input);
      const serialized = JSON.stringify(result);
      assert.equal(/兰琪|验收A店|验收B店|tenantKey/i.test(serialized), false, `${item.id} leaked brand/test data`);
      assert.equal(serialized.includes("已经发布"), false);
      item.check(result);
    }
    checks += 1;
  }
}
console.log(`beauty industry policy eval passed: ${cases.length} cases x 3, ${checks} hard checks`);

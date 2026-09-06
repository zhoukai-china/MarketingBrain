import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BEAUTY_IMAGE_PROVIDER_PROMPT_VERSION,
  buildBeautyImageProviderInput,
  type BeautyImageDirection
} from "../apps/api/src/products/beauty-industry/media-contract.js";

const champion = JSON.parse(readFileSync("scripts/fixtures/beauty-image-provider-prompt-champion-v1.json", "utf8")) as {
  version: string;
  sourceEvidence: { assetSha256: string; role: string; qualityReasons: string[]; operatorFinding: string };
  contract: { genericNoTextConstraint: boolean; genericNoBrandConstraint: boolean; unlabeledPackagingSurfaceConstraint: boolean; negativePromptStructure: string };
};

assert.equal(champion.version, "beauty-image-provider-prompt-v1");
assert.equal(champion.sourceEvidence.assetSha256, "2e2b8decb104d73d043b8073bacfe611e8f749a78455356318261db9700c9ad2");
assert.equal(champion.sourceEvidence.role, "content");
assert.deepEqual(champion.sourceEvidence.qualityReasons, ["interface_or_watermark_like"]);
assert.equal(champion.sourceEvidence.operatorFinding, "visible_pseudo_brand_and_gibberish_on_packaging");
assert.equal(champion.contract.genericNoTextConstraint, true);
assert.equal(champion.contract.genericNoBrandConstraint, true);
assert.equal(champion.contract.unlabeledPackagingSurfaceConstraint, false);
assert.equal(champion.contract.negativePromptStructure, "unchanged");

const packagingDirection: BeautyImageDirection = {
  index: 1,
  role: "content",
  label: "内容图",
  positivePrompt: "皮肤管理产品与干净毛巾平铺，局部水珠和自然窗光，留出说明区域。",
  negativePrompt: "人物，商标，门店，价格，前后对比，医疗器械。"
};
const nonPackagingDirection: BeautyImageDirection = {
  index: 2,
  role: "engagement",
  label: "互动承接图",
  positivePrompt: "柔和自然光下的水面涟漪与绿植叶片，画面下方留白。",
  negativePrompt: packagingDirection.negativePrompt
};

const packaging = buildBeautyImageProviderInput(packagingDirection);
const nonPackaging = buildBeautyImageProviderInput(nonPackagingDirection);

assert.equal(BEAUTY_IMAGE_PROVIDER_PROMPT_VERSION, "beauty-image-provider-prompt-v1.7");
assert.equal(packaging.providerPromptVersion, BEAUTY_IMAGE_PROVIDER_PROMPT_VERSION);
assert.match(packaging.prompt, /commercial interior photography/i);
assert.match(packaging.prompt, /no product packaging/i);
assert.doesNotMatch(packaging.prompt, /[\u3400-\u9fff]/u);
assert.match(packaging.negativePrompt, /brand mark/i);
assert.equal(packaging.negativePrompt, buildBeautyImageProviderInput({ ...packagingDirection, positivePrompt: "皮肤管理产品" }).negativePrompt, "the content-role exclusion keeps the negative contract deterministic");
assert.doesNotMatch(nonPackaging.prompt, /[\u3400-\u9fff]/u);
assert.equal(nonPackaging.providerPromptVersion, BEAUTY_IMAGE_PROVIDER_PROMPT_VERSION);

const route = readFileSync("apps/api/src/routes/beauty-industry-media.ts", "utf8");
assert.match(route, /deliveryMode: "real_provider_composed"/);
assert.match(route, /provider: "aliyun_bailian"/);
assert.match(route, /promptVersion: direction\.providerInput\.providerPromptVersion/);
assert.match(route, /providerCallsExpected: 1/);
assert.match(route, /estimatedProviderCostYuan: BEAUTY_IMAGE_PROVIDER_COST_PER_IMAGE_YUAN/);
const page = readFileSync("apps/web/src/pages/BeautyIndustryAcquisitionPage.tsx", "utf8");
assert.doesNotMatch(page, /providerPromptVersion/);
assert.doesNotMatch(page, /无标签中性容器|无印刷层、贴纸、浮雕字或品牌识别区/);

console.log("beauty_industry_image_generation_success_p1_smoke=PASS;packaging_champion=v1;provider_prompt_v1.7_active;real_provider_contract_zero_call=true;network=0");

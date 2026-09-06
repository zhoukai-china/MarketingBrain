import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BEAUTY_IMAGE_PROVIDER_PROMPT_VERSION,
  buildBeautyImageProviderInput,
  type BeautyImageDirection
} from "../apps/api/src/products/beauty-industry/media-contract.js";

const champion = JSON.parse(readFileSync("scripts/fixtures/beauty-image-content-packaging-champion-20260830.json", "utf8")) as {
  version: string;
  sourceEvidence: { role: string; qualityReasons: string[]; operatorFinding: string };
  batchEvidence: { providerTasksSubmitted: number; customerUsableAssets: number; netCredits: number };
};

assert.equal(champion.version, "beauty-image-content-packaging-champion-v1");
assert.equal(champion.sourceEvidence.role, "content");
assert.deepEqual(champion.sourceEvidence.qualityReasons, ["visible_text_or_brand_like"]);
assert.equal(champion.sourceEvidence.operatorFinding, "visible_pseudo_brand_and_gibberish_on_packaging");
assert.equal(champion.batchEvidence.providerTasksSubmitted, 2);
assert.equal(champion.batchEvidence.customerUsableAssets, 0);
assert.equal(champion.batchEvidence.netCredits, 0);

const negativePrompt = "品牌，文字，二维码，价格，疗效，前后效果对比";
const contentDirection: BeautyImageDirection = {
  index: 1,
  role: "content",
  label: "内容图",
  positivePrompt: "自然窗光下的日常皮肤护理场景，乳液泵瓶、面霜罐、毛巾与人物手部近景",
  negativePrompt,
  postProductionText: "日常护理要温和"
};
const coverDirection: BeautyImageDirection = {
  ...contentDirection,
  index: 0,
  role: "cover",
  label: "封面图"
};
const engagementDirection: BeautyImageDirection = {
  ...contentDirection,
  index: 2,
  role: "engagement",
  label: "互动承接图",
  positivePrompt: "柔和自然光下的水面与绿植环境细节"
};

const content = buildBeautyImageProviderInput(contentDirection);
const cover = buildBeautyImageProviderInput(coverDirection);
const engagement = buildBeautyImageProviderInput(engagementDirection);

assert.equal(BEAUTY_IMAGE_PROVIDER_PROMPT_VERSION, "beauty-image-provider-prompt-v1.7");
assert.equal(content.providerPromptVersion, BEAUTY_IMAGE_PROVIDER_PROMPT_VERSION);
assert.match(content.prompt, /treatment room/i);
assert.match(content.prompt, /no product packaging/i);
assert.match(content.negativePrompt, /text|brand mark/i);
assert.doesNotMatch(content.prompt, /[\u3400-\u9fff]/u);

assert.match(cover.prompt, /reception and consultation area/i);
assert.match(engagement.prompt, /aftercare consultation lounge/i);
assert.equal(new Set([cover.prompt, content.prompt, engagement.prompt]).size, 3);
assert.equal(engagement.providerPromptVersion, BEAUTY_IMAGE_PROVIDER_PROMPT_VERSION);

console.log("beauty_industry_image_content_packaging_p1_smoke=PASS;champion=true_risk;challenger=content_no_packaging;provider=0;network=0");

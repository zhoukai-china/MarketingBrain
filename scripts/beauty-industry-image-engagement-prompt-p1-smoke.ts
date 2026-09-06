import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  BEAUTY_IMAGE_PROVIDER_PROMPT_VERSION,
  BEAUTY_XHS_IMAGE_PLAN_VERSION,
  buildBeautyImageDeliveryPlan,
  buildBeautyImageProviderInput,
  type BeautyImageDirection
} from "../apps/api/src/products/beauty-industry/media-contract.js";

const champion = JSON.parse(readFileSync("scripts/fixtures/beauty-image-engagement-layout-champion-v1.json", "utf8")) as {
  version: string;
  sourceEvidence: { assetSha256: string; role: string; qualityReasons: string[]; operatorFinding: string };
  contract: Record<string, string | boolean>;
  boundary: string;
};

assert.equal(champion.version, "beauty-image-engagement-layout-champion-v1");
assert.equal(champion.sourceEvidence.assetSha256, "acc26153780bb387abd689aeba37f768716dd571f381581b4b2cdc7d331b385d");
assert.equal(champion.sourceEvidence.role, "engagement");
assert.deepEqual(champion.sourceEvidence.qualityReasons, ["visible_text_or_brand_like"]);
assert.equal(champion.sourceEvidence.operatorFinding, "visible_chinese_display_text_and_card_like_ui");
assert.equal(champion.contract.imagePlanVersion, "beauty-xhs-image-plan-v1");
assert.equal(champion.contract.providerPromptVersion, "beauty-image-provider-prompt-v1.1");
assert.equal(champion.contract.purposeMentionsInteractionQuestion, true);
assert.equal(champion.contract.compositionMentionsPostTextSafeArea, true);
assert.equal(champion.contract.providerInstructionMentionsPostTextSafeArea, true);
assert.equal(champion.contract.negativePromptBlocksCardsAndButtons, true);
assert.match(champion.boundary, /no_provider_payload_or_response/);

const directions: BeautyImageDirection[] = [
  {
    index: 0,
    role: "cover",
    label: "封面图",
    positivePrompt: "皮肤管理产品静物，温暖自然光，浅米色石材台面，主体居中偏下。",
    negativePrompt: "真人，品牌，价格，疗效。"
  },
  {
    index: 1,
    role: "content",
    label: "内容图",
    positivePrompt: "皮肤管理产品与干净毛巾平铺，局部水珠和自然窗光。",
    negativePrompt: "人物，商标，门店，价格，医疗器械。"
  },
  {
    index: 2,
    role: "engagement",
    label: "互动承接图",
    positivePrompt: "皮肤管理产品与绿植静物，互动卡片式排版，画面下方留白，承接互动问题，带按钮和标题栏，自然生活感。",
    negativePrompt: "真人，二维码，电话号码，品牌，价格，促销大字。"
  }
];

const beforeCover = buildBeautyImageProviderInput(directions[0]!);
const beforeContent = buildBeautyImageProviderInput(directions[1]!);
const engagement = buildBeautyImageProviderInput(directions[2]!);
const payloadHash = (value: typeof beforeCover) => createHash("sha256").update(JSON.stringify({
  prompt: value.prompt,
  negativePrompt: value.negativePrompt,
  watermark: value.watermark
})).digest("hex");

assert.equal(BEAUTY_XHS_IMAGE_PLAN_VERSION, "beauty-xhs-image-plan-v2");
assert.equal(BEAUTY_IMAGE_PROVIDER_PROMPT_VERSION, "beauty-image-provider-prompt-v1.7");
assert.notEqual(payloadHash(beforeCover), champion.contract.coverPayloadSha256, "v1.5 intentionally upgrades every role to the commercial-photo contract");
assert.notEqual(payloadHash(beforeContent), champion.contract.contentPayloadSha256, "content keeps an independently distinct treatment-room direction");
assert.match(beforeContent.prompt, /commercial interior photography/i);
assert.match(beforeContent.prompt, /no product packaging/i);
assert.match(beforeContent.negativePrompt, /brand mark/i);
assert.equal(engagement.providerPromptVersion, "beauty-image-provider-prompt-v1.7");
assert.match(engagement.prompt, /commercial lifestyle interior photography/i);
assert.match(engagement.prompt, /complete photographic composition/i);
assert.match(engagement.prompt, /without poster structure or copy area/i);
assert.doesNotMatch(engagement.prompt, /互动问题|画面下方留白|后期互动短句安全区|留白文案区|信息安全区|互动卡片式排版|带按钮|带标题栏/u);
assert.match(engagement.negativePrompt, /poster layout/i);
assert.match(engagement.negativePrompt, /social media interface/i);
assert.match(engagement.negativePrompt, /title bar/i);
assert.match(engagement.negativePrompt, /smartphone/i);
assert.match(engagement.negativePrompt, /phone screen/i);
assert.match(engagement.negativePrompt, /hand/i);
assert.doesNotMatch(engagement.prompt, /[\u3400-\u9fff]/u);

const output = [
  "## 客户可复制成品",
  "### 标题候选",
  "1. 日常皮肤管理产品怎么选",
  "2. 附近女性顾客的护理选择",
  "3. 先看清护理产品边界",
  "### 正文",
  "围绕皮肤管理产品说明日常护理的真实边界。",
  "### 话题标签",
  "#皮肤管理 #日常护理 #附近生活 #女性顾客 #小红书图文",
  "### 互动与承接",
  "你更想先了解护理流程还是产品选择？",
  "## 门店制作说明",
  "### 配图方向一｜封面图",
  `正向视觉提示词：${directions[0]!.positivePrompt}`,
  `负向视觉提示词：${directions[0]!.negativePrompt}`,
  "后期叠字：日常皮肤管理产品怎么选",
  "视觉参数：3:4竖图。",
  "### 配图方向二｜内容图",
  `正向视觉提示词：${directions[1]!.positivePrompt}`,
  `负向视觉提示词：${directions[1]!.negativePrompt}`,
  "后期叠字：护理先看真实边界",
  "视觉参数：3:4竖图。",
  "### 配图方向三｜互动承接图",
  `正向视觉提示词：${directions[2]!.positivePrompt}`,
  `负向视觉提示词：${directions[2]!.negativePrompt}`,
  "后期叠字：你想先了解哪一步？",
  "视觉参数：3:4竖图。",
  "## 质量与合规检查",
  "任务事实回执：皮肤管理产品、附近女性顾客、小红书图文。"
].join("\n");

const plan = buildBeautyImageDeliveryPlan({ output, imageCount: 3, textSkillVersion: "test-skill@1.0.0" });
const engagementPlan = plan.directions.find((item) => item.role === "engagement");
const coverPlan = plan.directions.find((item) => item.role === "cover");
const contentPlan = plan.directions.find((item) => item.role === "content");
assert.ok(engagementPlan);
assert.ok(coverPlan);
assert.ok(contentPlan);
assert.equal(plan.version, "beauty-xhs-image-plan-v2");
assert.equal(coverPlan.purpose, "承接默认标题，让目标顾客一眼识别本次主题");
assert.equal(coverPlan.composition, "主体明确、上方或侧上方留出后期标题安全区");
assert.equal(coverPlan.textStrategy, "中文文字仅后期叠加");
assert.equal(contentPlan.purpose, "补充正文中的项目与日常护理信息");
assert.equal(contentPlan.composition, "近景环境与无包装材质细节，画面只表达一个信息");
assert.equal(contentPlan.textStrategy, "中文文字仅后期叠加");
assert.match(engagementPlan.purpose, /正文主题/);
assert.match(engagementPlan.composition, /完整纯摄影画面/);
assert.match(engagementPlan.textStrategy, /网页文字交付或后期叠字元数据/);
assert.doesNotMatch(JSON.stringify(engagementPlan), /互动问题|后期互动短句安全区|留白文案区|信息安全区/);

const afterCover = buildBeautyImageProviderInput(directions[0]!);
const afterContent = buildBeautyImageProviderInput(directions[1]!);
assert.deepEqual(afterCover, beforeCover, "the engagement Challenger must not change cover behavior within the same build");
assert.deepEqual(afterContent, beforeContent, "the engagement Challenger must not change content behavior within the same build");

const liveAcceptance = readFileSync("scripts/beauty-industry-xhs-image-live-acceptance.mjs", "utf8");
assert.match(liveAcceptance, /grant\.providerPromptVersion, "beauty-image-provider-prompt-v1\.7"/);
assert.match(liveAcceptance, /imagePlanVersion: "beauty-xhs-image-plan-v2"/);

process.stdout.write("beauty_image_engagement_prompt_p1_smoke=PASS;champion=plan-v1_prompt-v1.1;challenger=plan-v2_prompt-v1.3;changed_variables=engagement_photographic_composition,handheld_device_exclusion;roles=3;provider_calls=0;network=0\n");

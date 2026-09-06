import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BEAUTY_XHS_IMAGE_PLAN_VERSION,
  buildBeautyImageDeliveryPlan,
  buildBeautyImageProviderInput,
  parseBeautyImageDirections
} from "../apps/api/src/products/beauty-industry/media-contract.js";

const xhsOutput = [
  "## 客户可复制成品",
  "### 标题候选",
  "1. 附近女性顾客的皮肤管理产品日常选择",
  "2. 皮肤管理产品怎么选更适合日常护理",
  "3. 附近女性顾客看这里：日常皮肤管理思路",
  "### 正文",
  "围绕附近女性顾客的日常皮肤管理需求，介绍皮肤管理产品的真实使用边界。",
  "### 话题标签",
  "#小红书图文 #皮肤管理 #日常护理 #附近生活 #女性顾客",
  "### 互动与承接",
  "你更想先了解日常护理流程还是产品选择边界？",
  "",
  "## 门店制作说明",
  "### 配图方向一｜封面图",
  "正向视觉提示词：皮肤管理产品静物，温暖自然光，浅米色石材台面，主体居中偏下，上方留白，干净高级，附近女性顾客的日常护理氛围。",
  "负向视觉提示词：真人，顾客正脸，门店实景，品牌标志，价格，疗效文字。",
  "后期叠字：附近女性顾客的皮肤管理产品日常选择",
  "视觉参数：小红书 3:4 竖图，柔和自然光，低饱和暖色。",
  "### 配图方向二｜内容图",
  "正向视觉提示词：皮肤管理产品与干净毛巾平铺，局部水珠和自然窗光，留出说明区域。",
  "负向视觉提示词：人物，商标，门店，价格，前后对比，医疗器械。",
  "后期叠字：日常护理先看真实边界",
  "视觉参数：小红书 3:4 竖图，近景静物，柔和光线。",
  "### 配图方向三｜互动承接图",
  "正向视觉提示词：皮肤管理产品与绿植静物，简洁台面，画面下方留白，自然生活感。",
  "负向视觉提示词：真人，二维码，电话号码，品牌，价格，促销大字。",
  "后期叠字：你想先了解哪一步？",
  "视觉参数：小红书 3:4 竖图，中近景，低饱和自然色。",
  "",
  "## 质量与合规检查",
  "任务事实回执：皮肤管理产品、附近女性顾客、小红书图文。",
  "事实与合规待补：未提供肖像、品牌、门店实景、价格、案例或疗效授权。"
].join("\n");

const directions = parseBeautyImageDirections(xhsOutput, 3);
const plan = buildBeautyImageDeliveryPlan({
  output: xhsOutput,
  imageCount: 3,
  textSkillVersion: "wechat-xhs-content-line@1.0.3+beauty-industry-xhs@1.1.0+beauty-industry-compliance@1.0.0"
});

assert.equal(plan.version, BEAUTY_XHS_IMAGE_PLAN_VERSION);
assert.equal(plan.imageCount, 3);
assert.equal(plan.ratio, "3:4");
assert.equal(plan.linkedTitle, "附近女性顾客的皮肤管理产品日常选择");
assert.deepEqual(plan.directions.map((item) => item.role), ["cover", "content", "engagement"]);
assert.ok(plan.directions.every((item) => !JSON.stringify(item).match(/正向视觉提示词|负向视觉提示词|wan2\.7|aliyun|provider|model/i)), "public plan must not expose internal prompt/provider fields");
assert.match(plan.customerBoundary, /纯画面/);
assert.match(plan.customerBoundary, /后期/);
assert.match(plan.rightsBoundary, /无人物/);
assert.match(plan.rightsBoundary, /无品牌/);

for (const direction of directions) {
  const payload = buildBeautyImageProviderInput(direction);
  assert.match(payload.prompt, /3:4/);
  assert.match(payload.prompt, /Pure photographic scene only/i);
  assert.match(payload.prompt, /No people/i);
  assert.match(payload.prompt, /no real identifiable store/i);
  assert.match(payload.prompt, /no product branding/i);
  assert.match(payload.negativePrompt, /text/i);
  assert.match(payload.negativePrompt, /logo/i);
  assert.match(payload.negativePrompt, /QR code/i);
  assert.doesNotMatch(`${payload.prompt}\n${payload.negativePrompt}`, /[\u3400-\u9fff]/u, "provider payload must stay English-only so the base image is not prompted to render Chinese copy");
  assert.equal(payload.watermark, false);
}

const page = readFileSync("apps/web/src/pages/BeautyIndustryAcquisitionPage.tsx", "utf8");
assert.match(page, /beauty-xhs-image-plan-v2/);
assert.match(page, /与文字成品关联/);
assert.doesNotMatch(page, /预计 \{mediaQuote\.creditCost\} 积分 · \{mediaQuote\.imageCount\} 张 · \{mediaQuote\.model\}/);
assert.doesNotMatch(page, /正在核对费用和历史图片/);
assert.doesNotMatch(page, /复制制作说明/);
const xhsRenderer = page.slice(page.indexOf("function BeautyXhsStructuredResult"), page.indexOf("function beautyMediaRiskLabel"));
assert.doesNotMatch(xhsRenderer, /delivery\.productionNotes\.markdown/);

const route = readFileSync("apps/api/src/routes/beauty-industry-media.ts", "utf8");
assert.match(route, /imagePlan/);
assert.match(route, /buildBeautyImageDeliveryPlan/);
assert.match(route, /imagePlanVersion/);
assert.match(route, /linkedTitleHash/);
assert.match(route, /textSkillVersion/);
const quoteResponse = route.slice(route.indexOf("return {", route.indexOf("media/quote")), route.indexOf("  });", route.indexOf("media/quote")));
assert.doesNotMatch(quoteResponse, /providerEstimatedCostYuan|customerPriceYuan|provider:\s*"aliyun_bailian"|model:\s*env\./, "customer quote DTO must not expose provider/model/RMB cost internals");

const workbuddy = readFileSync("apps/api/src/routes/workbuddy-mcp.ts", "utf8");
assert.match(workbuddy, /customerDeliverable\.copyMarkdown/);
assert.match(workbuddy, /structuredContent/);

for (const source of [
  readFileSync("apps/api/src/products/beauty-industry/workflows.ts", "utf8"),
  readFileSync("apps/api/src/products/beauty-industry/mcp-adapter.ts", "utf8")
]) {
  assert.doesNotMatch(source, /mcp-skills[\\/]candidates|mcp-skills[\\/]intake|mcp-skills[\\/]quarantine/i);
}

console.log("beauty_industry_xhs_same_page_image_p1_smoke=PASS;provider=0;network=0;candidate_refs=0");

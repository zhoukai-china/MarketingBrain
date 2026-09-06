import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BEAUTY_IMAGE_PROVIDER_PROMPT_VERSION,
  buildBeautyImageProviderInput,
  parseBeautyImageDirections
} from "../apps/api/src/products/beauty-industry/media-contract.js";

const route = readFileSync("apps/api/src/routes/beauty-industry-media.ts", "utf8");
const page = readFileSync("apps/web/src/components/acquisition/BeautyXhsWorkbench.tsx", "utf8");
const candidate = readFileSync("C:/Users/book/WorkBuddy/sitong-outsourcing/beauty-xhs-prototype-20260827/handoffs/20260829-图文出图-fix/poster-wiring.md", "utf8");

const sample = [
  "配图方向一｜封面图",
  "正向视觉提示词：暖色高级美业门店接待空间，皮肤管理主题，商业摄影。",
  "负向视觉提示词：文字，Logo，二维码，水印，UI，未授权人物。",
  "配图方向二｜内容图",
  "正向视觉提示词：安静护理空间，床品、毛巾与柔和自然光，真实材质。",
  "负向视觉提示词：包装文字，品牌，医疗器械，效果对比。",
  "配图方向三｜互动承接图",
  "正向视觉提示词：护理后咨询区，座椅与茶几，温暖光影，空间摄影。",
  "负向视觉提示词：海报，按钮，对话框，标题栏，文字，人物。"
].join("\n");

const directions = parseBeautyImageDirections(sample, 3);
const providerInputs = directions.map((direction) => buildBeautyImageProviderInput(direction, {
  overallVisualRequirements: "暖色、干净、摄影感、高级美业门店空间",
  prohibitedContent: "文字、Logo、水印、二维码、价格、疗效"
}));

assert.equal(BEAUTY_IMAGE_PROVIDER_PROMPT_VERSION, "beauty-image-provider-prompt-v1.7");
assert.deepEqual(directions.map((item) => item.role), ["cover", "content", "engagement"]);
assert.equal(new Set(providerInputs.map((item) => item.prompt)).size, 3, "three roles need visibly distinct art direction");
for (const input of providerInputs) {
  assert.doesNotMatch(input.prompt, /[\u3400-\u9fff]/u, "Provider visual prompt must remain English-only");
  assert.doesNotMatch(input.negativePrompt, /[\u3400-\u9fff]/u, "Provider negative prompt must remain English-only");
  assert.match(input.prompt, /commercial|editorial|photograph/i);
  assert.match(input.prompt, /realistic lighting|natural daylight|material/i);
  assert.match(input.negativePrompt, /text|logo|watermark|QR|interface/i);
}

assert.match(route, /deliveryMode:\s*"real_provider_composed"/u);
assert.match(route, /provider:\s*"aliyun_bailian"/u);
assert.match(route, /model:\s*env\.LANQI_MEDIA_IMAGE_MODEL/u);
assert.match(route, /buildBeautyImageProviderInput/u);
assert.match(route, /estimatedProviderCostYuan/u);
assert.match(route, /BEAUTY_IMAGE_PROVIDER_COST_PER_IMAGE_FEN\s*=\s*20/u, "three-image quote must use integer fen pricing");
assert.match(route, /\(imageCount \* BEAUTY_IMAGE_PROVIDER_COST_PER_IMAGE_FEN\) \/ 100/u, "¥0.60 must not become 0.6000000000000001 and fail the hard budget gate");
assert.doesNotMatch(route, /provider:\s*"local_deterministic"/u, "new XHS batches must not use the local geometry renderer");
assert.match(page, /真实生成/u);
assert.doesNotMatch(page, /确认生成三张门店场景/u);
assert.ok(candidate.includes("异步轮询"), "candidate remains a reviewed reference only");
assert.doesNotMatch(route, /WorkBuddy|poster-wiring/u);

console.log("beauty_industry_xhs_premium_image_delivery_p1_smoke=PASS;provider_prompts=english;roles=3;runtime_candidate_refs=0");

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildLanqiImagePreview,
  normalizeLanqiCareLanguage,
  normalizeLanqiImageFactsForModel,
} from "../apps/api/src/services/lanqi-image-studio.js";
import {
  createLanqiPreviewRequestCoordinator,
} from "../apps/web/src/pages/lanqi-image-preview-request.js";

const syntheticFacts = normalizeLanqiImageFactsForModel({
  storeName: "青岛兰琪验收B店",
  city: "青岛",
  mainServices: ["问题肌肤修复", "基础皮肤管理"],
});
assert.equal(syntheticFacts.storeName, undefined, "验收 A/B 合成门店名不得进入模型事实");
assert.equal(syntheticFacts.city, undefined, "合成测试档案的城市不得被冒充为真实门店事实");
assert.deepEqual(syntheticFacts.mainServices, [], "合成档案的服务清单也不得作为正式门店事实进入模型");

const missingName = normalizeLanqiImageFactsForModel({ city: "烟台", mainServices: [] });
assert.equal(missingName.displayStoreName, "本店");
assert.equal(missingName.storeName, undefined);

const confirmed = normalizeLanqiImageFactsForModel({ storeName: "兰琪芝罘店", city: "烟台", mainServices: ["舒缓护理"] });
assert.equal(confirmed.storeName, "兰琪芝罘店");
assert.equal(confirmed.city, "烟台");
assert.equal(normalizeLanqiCareLanguage("问题肌肤修复项目海报"), "问题肌肤日常护理项目海报");

const guardedRuntimePreview = buildLanqiImagePreview({
  id: "runtime-guard",
  brief: {
    request: "夏季补水护理小红书封面，不出现顾客正脸",
    purpose: "xiaohongshu_cover",
    ratio: "3:4",
    style: "premium",
    textMode: "title_space",
    rightsConfirmed: true,
  },
  facts: {},
  enhancementAnswer: JSON.stringify({
    intentUnderstanding: "制作夏季补水护理小红书封面，不出现顾客正脸。",
    missingQuestions: [],
    revisionSummary: "首次增强",
    factBoundary: [],
    directions: [1, 2].map(index => ({
      id: `direction-${index}`,
      name: `方案${index}`,
      variable: index === 1 ? "构图" : "光线",
      positivePrompt: "夏季补水护理小红书封面，主体为清透凝露与柔软织物，画面居中，顶部留出标题安全区，温暖漫射光，奶油白与低饱和橙色，使用50mm中近景与真实细腻水润材质，背景保持干净克制，商业摄影质感，不出现顾客正脸。",
      negativePrompt: "错误手部，扭曲面部",
      overlayText: { mode: "post_process", text: "", placement: "top_safe_area" },
      parameters: { composition: "居中", subject: "清透凝露", scene: "中性棚拍", lighting: "温暖漫射光", colorPalette: "奶油白与暖橙", camera: "50mm", materials: "水润材质", clarity: "high" },
    })),
  }),
});
assert.ok(guardedRuntimePreview.directions.every(item => item.parameters.composition.length >= 8), "过短构图参数必须补为可执行描述");
assert.ok(guardedRuntimePreview.directions.every(item => item.negativePrompt.includes("乱码中文")), "运行时负向提示词必须补齐中文文字安全项");

let scheduled: (() => void) | undefined;
const updates: string[] = [];
const coordinator = createLanqiPreviewRequestCoordinator({
  timeoutMs: 90_000,
  schedule: callback => { scheduled = callback; return 1; },
  cancelSchedule: () => undefined,
  onState: state => updates.push(`${state.status}:${state.stage}`),
});
const first = coordinator.begin();
assert.equal(coordinator.isCurrent(first.id), true);
coordinator.cancel(first.id);
assert.equal(coordinator.isCurrent(first.id), false, "取消后旧响应必须立即失效");
const second = coordinator.begin();
assert.equal(coordinator.isCurrent(second.id), true);
assert.equal(coordinator.complete(first.id), false, "晚到的旧成功不得覆盖新请求");
assert.equal(coordinator.complete(second.id), true);
assert.ok(updates.some(item => item.startsWith("cancelled:")));
scheduled?.();

const pageSource = readFileSync(new URL("../apps/web/src/pages/LanqiImageStudioPage.tsx", import.meta.url), "utf8");
assert.match(pageSource, /理解需求/);
assert.match(pageSource, /组织构图\/风格/);
assert.match(pageSource, /检查事实与品牌边界/);
assert.match(pageSource, /已耗时/);
assert.match(pageSource, /elapsedSeconds\s*>=\s*30/);
assert.match(pageSource, /本次验收额度已用完/);
assert.match(pageSource, /aria-disabled/);

const previewRouteSource = readFileSync(new URL("../apps/api/src/routes/lanqi-image-studio.ts", import.meta.url), "utf8");
assert.match(previewRouteSource, /createRequestExecutionScope/);
assert.match(previewRouteSource, /image_preview_timed_out/);
assert.match(previewRouteSource, /reasoningTag:\s*skillResult\.reasoningProfile === "deep" \? "reasoning_high" : "reasoning_standard"/, "审计标签必须保存实际 Skill reasoning profile，而不是 broad 模型策略标签");
assert.match(previewRouteSource, /const restored = toPreviewFromDraft\(saved\)/, "保存后必须从数据库记录恢复图片提示词预览");

const mediaRouteSource = readFileSync(new URL("../apps/api/src/routes/lanqi-media-generation.ts", import.meta.url), "utf8");
assert.match(mediaRouteSource, /insufficient_credits/);
assert.match(mediaRouteSource, /本次验收生图额度已用完/);

console.log("Lanqi image studio resilience, synthetic-fact, cancellation and exhausted-budget smoke passed.");

import assert from "node:assert/strict";
import { env } from "../apps/api/src/config/env.ts";
import { buildLanqiMediaProviderRequest, getLanqiMediaExecutionReadiness, getLanqiMediaProviderIssue, isSameLanqiMediaRequest, parseLanqiMediaTask, quoteLanqiMedia, validateLanqiMediaRequest } from "../apps/api/src/services/lanqi-media-generation.ts";

// 图片：用户 2026-09-12 拍板 20 积分/张（= ¥1）；用户 2026-09-16 拍板「不显示人民币消耗」，
// 所以报价对象里**不允许**再出现折合人民币字段（旧实现写的是 creditCost/100，图片改价后就错了 5 倍）。
assert.deepEqual(quoteLanqiMedia({ kind: "image", prompt: "门店护理配图", promptVersion: "1.0.0" }), { creditCost: 20, provider: "aliyun_bailian", model: "wan2.7-image" });
assert.ok(
  !Object.prototype.hasOwnProperty.call(quoteLanqiMedia({ kind: "image", prompt: "门店护理配图", promptVersion: "1.0.0" }), "customerPriceYuan"),
  "报价对象不得含折合人民币字段（用户 2026-09-16：不显示人民币消耗）"
);
// 文生视频（用户 2026-09-16 拍板「用百炼现成的 t2v」）已与图生视频统一为**按秒 ×2 成本**：
// 12 积分/秒，不再用旧的 720P/1080P 固定包价（990/1690/1490/2690）。
assert.equal(quoteLanqiMedia({ kind: "text_to_video", prompt: "视频", resolution: "720P", ratio: "9:16", durationSeconds: 5 }).creditCost, 60);
assert.equal(quoteLanqiMedia({ kind: "text_to_video", prompt: "视频", resolution: "720P", ratio: "16:9", durationSeconds: 10 }).creditCost, 120);
assert.equal(quoteLanqiMedia({ kind: "text_to_video", prompt: "视频", resolution: "1080P", ratio: "9:16", durationSeconds: 5 }).creditCost, 60);
// 文案转片按成本 ×2 的按秒口径计价：12 积分/秒（用户 2026-09-15 拍板，由 30 降为 12）。每镜 3 秒 = 36 积分。
assert.equal(quoteLanqiMedia({ kind: "image_to_video", prompt: "视频", resolution: "720P", durationSeconds: 3, imageUrl: "https://example.com/source.jpg" }).creditCost, 36);
assert.equal(quoteLanqiMedia({ kind: "image_to_video", prompt: "视频", resolution: "1080P", durationSeconds: 10, imageUrl: "https://example.com/source.jpg" }).creditCost, 120);
assert.equal(validateLanqiMediaRequest({ kind: "image_to_video", prompt: "视频", resolution: "720P", ratio: "9:16", durationSeconds: 5 }), "图生视频需要提供本店自有或已获授权的图片链接");
assert.equal(validateLanqiMediaRequest({ kind: "text_to_video", prompt: "视频", resolution: "720P", ratio: "9:16", durationSeconds: 5 }), undefined);
assert.equal(validateLanqiMediaRequest({ kind: "text_to_video", prompt: "视频", resolution: "720P", durationSeconds: 5 }), "文生视频需要选择横竖屏");
assert.equal(validateLanqiMediaRequest({ kind: "image_to_video", prompt: "视频", resolution: "720P", durationSeconds: 1, imageUrl: "https://example.com/source.jpg" }), "视频时长必须为 2–15 秒的整数");
assert.equal(validateLanqiMediaRequest({ kind: "image_to_video", prompt: "视频", resolution: "720P", durationSeconds: 3.5, imageUrl: "https://example.com/source.jpg" }), "视频时长必须为 2–15 秒的整数");
assert.equal(getLanqiMediaProviderIssue({ kind: "image" }), "未配置阿里云百炼 API 密钥");
// 百炼图生视频契约：首帧图必须走 input.img_url，无声成片必须显式 audio:false，且不下发 ratio。
const imageToVideoRequest = buildLanqiMediaProviderRequest({ kind: "image_to_video", prompt: "老板在店里做肤质检测", resolution: "720P", durationSeconds: 3, imageUrl: "https://example.com/first-frame.jpg" });
assert.deepEqual(imageToVideoRequest.input, { prompt: "老板在店里做肤质检测", img_url: "https://example.com/first-frame.jpg" });
assert.deepEqual(imageToVideoRequest.parameters, { resolution: "720P", duration: 3, audio: false, prompt_extend: false, watermark: true });
const imageRequest = buildLanqiMediaProviderRequest({ kind: "image", prompt: "内部测试图", promptVersion: "1.0.0" });
assert.deepEqual((imageRequest.input as { messages: unknown[] }).messages, [{ role: "user", content: [{ text: "内部测试图" }] }]);
assert.equal((imageRequest.parameters as { watermark: boolean }).watermark, true);
assert.deepEqual(parseLanqiMediaTask({ output: { task_status: "SUCCEEDED", choices: [{ message: { content: [{ type: "image", image: "https://example.com/result.png" }] } }] } }), { status: "SUCCEEDED", outputUrl: "https://example.com/result.png", errorMessage: undefined });
assert.deepEqual(parseLanqiMediaTask({ output: { task_status: "SUCCEEDED", choices: [{ message: { content: { type: "image", image: "https://example.com/object-result.png" } } }] } }), { status: "SUCCEEDED", outputUrl: "https://example.com/object-result.png", errorMessage: undefined });

// ── 幂等口径：签名外链每次签发都不同，绝不能参与幂等比较，否则同图重试会重复扣费 ──
const stagedFrameId = "lanqi-ff-0123456789abcdef0123456789abcdef";
const otherFrameId = "lanqi-ff-ffffffffffffffffffffffffffffffff";
const urlOne = `https://example.com/os-v2/api/lanqi/media/first-frame/${stagedFrameId}?k=aaaaaaaaaaaaaaaaaaaaaaaa&e=1800000000&t=1111`;
const urlTwo = `https://example.com/os-v2/api/lanqi/media/first-frame/${stagedFrameId}?k=aaaaaaaaaaaaaaaaaaaaaaaa&e=1800003600&t=2222`;
const shotInput = (imageUrl: string) => ({ kind: "image_to_video" as const, prompt: "老板在店里做肤质检测", resolution: "720P" as const, durationSeconds: 3, imageUrl });
const storedFrameJob = { kind: "image_to_video", prompt: "老板在店里做肤质检测", negativePrompt: undefined, ratio: undefined, durationSeconds: 3, parameters: { firstFrameId: stagedFrameId } };
// 修复前口径（把签名外链本身当身份）：同一张图的第二次请求被判成新请求 → 重复扣费、重复出片。
const legacyFrameIdentityMatches = (storedImageUrl: string, incomingImageUrl: string) => storedImageUrl === incomingImageUrl;
assert.equal(legacyFrameIdentityMatches(urlOne, urlTwo), false);
// 修复后口径：指纹取稳定暂存 ID，同图重试仍是同一请求。
assert.equal(isSameLanqiMediaRequest(storedFrameJob, shotInput(urlOne), stagedFrameId), true);
assert.equal(isSameLanqiMediaRequest(storedFrameJob, shotInput(urlTwo), stagedFrameId), true);
// 换了另一张首帧图 / 换了时长必须判为新请求（不能拿旧成片顶包）。
assert.equal(isSameLanqiMediaRequest(storedFrameJob, shotInput(urlTwo), otherFrameId), false);
assert.equal(isSameLanqiMediaRequest(storedFrameJob, { ...shotInput(urlTwo), durationSeconds: 5 }, stagedFrameId), false);
assert.equal(isSameLanqiMediaRequest(storedFrameJob, { ...shotInput(urlTwo), prompt: "另一句口播" }, stagedFrameId), false);

// ── 放行口径：图片与视频分开审批 —— 视频放行绝不能顺带把付费生图打开 ──
const originalMediaEnv = {
  mode: env.LANQI_MEDIA_EXECUTION_MODE,
  storage: env.LANQI_MEDIA_ASSET_STORAGE,
  realApproved: env.LANQI_MEDIA_REAL_EXECUTION_APPROVED,
  imageApproved: env.LANQI_MEDIA_IMAGE_REAL_EXECUTION_APPROVED,
  videoModel: env.LANQI_MEDIA_IMAGE_TO_VIDEO_MODEL,
  apiKey: env.ALIYUN_API_KEY,
};
env.LANQI_MEDIA_EXECUTION_MODE = "real";
env.LANQI_MEDIA_ASSET_STORAGE = "local";
env.LANQI_MEDIA_REAL_EXECUTION_APPROVED = "true";
env.LANQI_MEDIA_IMAGE_TO_VIDEO_MODEL = "wan2.6-i2v-flash";
env.ALIYUN_API_KEY = env.ALIYUN_API_KEY || "sk-smoke-only-not-a-real-key";
// 视频已放行、图片未放行：两个能力必须分开判定，不能一起被打开。
env.LANQI_MEDIA_IMAGE_REAL_EXECUTION_APPROVED = "false";
assert.equal(getLanqiMediaExecutionReadiness({ kind: "image_to_video" }).canConfirm, true);
assert.equal(getLanqiMediaExecutionReadiness({ kind: "image" }).canConfirm, false);
assert.equal(getLanqiMediaExecutionReadiness({ kind: "image" }).billable, false);
// 图片单独放行后才允许创建付费生图任务。
env.LANQI_MEDIA_IMAGE_REAL_EXECUTION_APPROVED = "true";
assert.equal(getLanqiMediaExecutionReadiness({ kind: "image" }).canConfirm, true);
// 视频预算未确认时，视频同样必须停住。
env.LANQI_MEDIA_REAL_EXECUTION_APPROVED = "false";
assert.equal(getLanqiMediaExecutionReadiness({ kind: "image_to_video" }).canConfirm, false);
env.LANQI_MEDIA_EXECUTION_MODE = originalMediaEnv.mode;
env.LANQI_MEDIA_ASSET_STORAGE = originalMediaEnv.storage;
env.LANQI_MEDIA_REAL_EXECUTION_APPROVED = originalMediaEnv.realApproved;
env.LANQI_MEDIA_IMAGE_REAL_EXECUTION_APPROVED = originalMediaEnv.imageApproved;
env.LANQI_MEDIA_IMAGE_TO_VIDEO_MODEL = originalMediaEnv.videoModel;
env.ALIYUN_API_KEY = originalMediaEnv.apiKey;

console.log("Lanqi media generation quote and validation smoke passed.");

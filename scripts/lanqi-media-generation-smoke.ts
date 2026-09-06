import assert from "node:assert/strict";
import { buildLanqiMediaProviderRequest, getLanqiMediaProviderIssue, parseLanqiMediaTask, quoteLanqiMedia, validateLanqiMediaRequest } from "../apps/api/src/services/lanqi-media-generation.ts";

assert.deepEqual(quoteLanqiMedia({ kind: "image", prompt: "门店护理配图", promptVersion: "1.0.0" }), { creditCost: 100, customerPriceYuan: 1, provider: "aliyun_bailian", model: "wan2.7-image" });
assert.equal(quoteLanqiMedia({ kind: "text_to_video", prompt: "视频", resolution: "720P", ratio: "9:16", durationSeconds: 5 }).creditCost, 990);
assert.equal(quoteLanqiMedia({ kind: "text_to_video", prompt: "视频", resolution: "720P", ratio: "16:9", durationSeconds: 10 }).creditCost, 1690);
assert.equal(quoteLanqiMedia({ kind: "text_to_video", prompt: "视频", resolution: "1080P", ratio: "9:16", durationSeconds: 5 }).creditCost, 1490);
assert.equal(quoteLanqiMedia({ kind: "image_to_video", prompt: "视频", resolution: "1080P", ratio: "16:9", durationSeconds: 10, imageUrl: "https://example.com/source.jpg" }).creditCost, 2690);
assert.equal(validateLanqiMediaRequest({ kind: "image_to_video", prompt: "视频", resolution: "720P", ratio: "9:16", durationSeconds: 5 }), "图生视频需要提供本店自有或已获授权的图片链接");
assert.equal(validateLanqiMediaRequest({ kind: "text_to_video", prompt: "视频", resolution: "720P", ratio: "9:16", durationSeconds: 5 }), undefined);
assert.equal(getLanqiMediaProviderIssue({ kind: "image" }), "未配置阿里云百炼 API 密钥");
const imageRequest = buildLanqiMediaProviderRequest({ kind: "image", prompt: "内部测试图", promptVersion: "1.0.0" });
assert.deepEqual((imageRequest.input as { messages: unknown[] }).messages, [{ role: "user", content: [{ text: "内部测试图" }] }]);
assert.equal((imageRequest.parameters as { watermark: boolean }).watermark, true);
assert.deepEqual(parseLanqiMediaTask({ output: { task_status: "SUCCEEDED", choices: [{ message: { content: [{ type: "image", image: "https://example.com/result.png" }] } }] } }), { status: "SUCCEEDED", outputUrl: "https://example.com/result.png", errorMessage: undefined });
assert.deepEqual(parseLanqiMediaTask({ output: { task_status: "SUCCEEDED", choices: [{ message: { content: { type: "image", image: "https://example.com/object-result.png" } } }] } }), { status: "SUCCEEDED", outputUrl: "https://example.com/object-result.png", errorMessage: undefined });
console.log("Lanqi media generation quote and validation smoke passed.");

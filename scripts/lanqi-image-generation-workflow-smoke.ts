import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

async function main(): Promise<void> {
const uploadRoot = await mkdtemp(path.join(os.tmpdir(), "lanqi-image-generation-"));
process.env.NODE_ENV = "test";
process.env.DATA_MODE = "demo";
process.env.LANQI_MEDIA_EXECUTION_MODE = "mock";
process.env.LANQI_MEDIA_ASSET_STORAGE = "disabled";
process.env.UPLOAD_DIR = uploadRoot;
process.env.JWT_SECRET = "lanqi-image-generation-workflow-smoke-secret-2026";

try {
  const [{ default: fastify }, { registerLanqiMediaGenerationRoutes }, mediaService] = await Promise.all([
    import("../apps/api/node_modules/fastify/fastify.js"),
    import("../apps/api/src/routes/lanqi-media-generation.ts"),
    import("../apps/api/src/services/lanqi-media-generation.ts"),
  ]);
  const app = fastify({ logger: false });
  await registerLanqiMediaGenerationRoutes(app, { name: "not-called", async complete() { throw new Error("llm_must_not_run"); } });
  await app.ready();

  const a = { "x-sitong-tenant-id": "lanqi-tenant-a", "x-sitong-user-id": "user-a", "content-type": "application/json" };
  const b = { "x-sitong-tenant-id": "lanqi-tenant-b", "x-sitong-user-id": "user-b", "content-type": "application/json" };
  const previewResponse = await app.inject({ method: "POST", url: "/lanqi/image-studio/previews", headers: a, payload: { request: "做一张温柔高级的夏季补水护理封面，不出现顾客正脸", purpose: "xiaohongshu_cover", ratio: "3:4", style: "premium", textMode: "title_space", rightsConfirmed: true, requestKey: "preview-request-000001" } });
  assert.equal(previewResponse.statusCode, 200);
  const preview = previewResponse.json().preview;
  const direction = preview.directions.find((item: any) => item.id === preview.selectedDirectionId) ?? preview.directions[0];
  const input = { kind: "image", previewId: preview.id, promptVersion: preview.enhancer.version, prompt: direction.positivePrompt, negativePrompt: direction.negativePrompt, ratio: preview.ratio, requestKey: "image-request-000001" };

  const providerRequest = mediaService.buildLanqiMediaProviderRequest(input as any) as any;
  assert.equal(providerRequest.parameters.size, "768*1024");
  assert.match(providerRequest.input.messages[0].content[0].text, /必须避免：[\s\S]*顾客正脸/);
  assert.match(mediaService.validateLanqiMediaRequest({ kind: "text_to_video", prompt: "测试", resolution: "720P", ratio: "3:4", durationSeconds: 5 } as any) ?? "", /视频仅支持/);

  const quote = await app.inject({ method: "POST", url: "/lanqi/media/quote", headers: a, payload: input });
  assert.equal(quote.statusCode, 200);
  assert.equal(quote.json().canConfirm, true);
  assert.equal(quote.json().billable, false);
  assert.equal(quote.json().executionMode, "mock");
  assert.equal((await app.inject({ method: "POST", url: "/lanqi/media/quote", headers: b, payload: input })).statusCode, 404, "tenant B must not quote tenant A preview");
  assert.equal((await app.inject({ method: "GET", url: "/lanqi/media/jobs", headers: a })).json().jobs.length, 0, "quote must not create a job");

  const missingConfirmation = await app.inject({ method: "POST", url: "/lanqi/media/confirm", headers: a, payload: input });
  assert.equal(missingConfirmation.statusCode, 400);
  const created = await app.inject({ method: "POST", url: "/lanqi/media/confirm", headers: a, payload: { ...input, confirmed: true } });
  assert.equal(created.statusCode, 202);
  const firstJob = created.json().job;
  assert.equal(firstJob.status, "queued");
  assert.equal(firstJob.billingStatus, "not_billed");

  const duplicate = await app.inject({ method: "POST", url: "/lanqi/media/confirm", headers: a, payload: { ...input, confirmed: true } });
  assert.equal(duplicate.statusCode, 200);
  assert.equal(duplicate.json().job.id, firstJob.id);
  assert.equal((await app.inject({ method: "GET", url: "/lanqi/media/jobs", headers: a })).json().jobs.length, 1);
  assert.equal((await app.inject({ method: "GET", url: "/lanqi/media/jobs", headers: b })).json().jobs.length, 0, "tenant B must not see tenant A jobs");

  const conflict = await app.inject({ method: "POST", url: "/lanqi/media/confirm", headers: a, payload: { ...input, prompt: "changed", confirmed: true } });
  assert.equal(conflict.statusCode, 409);
  const canceled = await app.inject({ method: "POST", url: `/lanqi/media/jobs/${firstJob.id}/cancel`, headers: a, payload: {} });
  assert.equal(canceled.statusCode, 200);
  assert.equal(canceled.json().job.status, "canceled");
  assert.equal(canceled.json().job.billingStatus, "not_billed");
  assert.equal((await app.inject({ method: "POST", url: `/lanqi/media/jobs/${firstJob.id}/cancel`, headers: a, payload: {} })).statusCode, 409);

  const secondInput = { ...input, requestKey: "image-request-000002" };
  const second = await app.inject({ method: "POST", url: "/lanqi/media/confirm", headers: a, payload: { ...secondInput, confirmed: true } });
  const secondId = second.json().job.id;
  assert.equal((await app.inject({ method: "POST", url: `/lanqi/media/jobs/${secondId}/refresh`, headers: a, payload: {} })).json().job.status, "processing");
  const succeeded = await app.inject({ method: "POST", url: `/lanqi/media/jobs/${secondId}/refresh`, headers: a, payload: {} });
  assert.equal(succeeded.json().job.status, "succeeded");
  assert.equal(succeeded.json().job.assetStatus, "persisted");
  assert.equal((await app.inject({ method: "GET", url: succeeded.json().job.outputUrl, headers: a })).statusCode, 200);
  assert.equal((await app.inject({ method: "GET", url: succeeded.json().job.outputUrl, headers: b })).statusCode, 404, "tenant B must not download tenant A asset");
  assert.equal((await app.inject({ method: "POST", url: `/lanqi/media/jobs/${secondId}/assets/select`, headers: a, payload: {} })).json().job.selectedAt.length > 10, true);
  assert.equal((await app.inject({ method: "POST", url: `/lanqi/media/jobs/${secondId}/assets/save`, headers: a, payload: {} })).json().job.savedAt.length > 10, true);

  const failedPreviewResponse = await app.inject({ method: "POST", url: "/lanqi/image-studio/previews", headers: a, payload: { request: "做一张[模拟失败]验证明确失败路径的美业封面", purpose: "social_poster", ratio: "3:4", style: "clean", textMode: "no_text", rightsConfirmed: true, requestKey: "preview-request-000002" } });
  assert.equal(failedPreviewResponse.statusCode, 200);
  const failedPreview = failedPreviewResponse.json().preview;
  const failedDirection = failedPreview.directions.find((item: any) => item.id === failedPreview.selectedDirectionId) ?? failedPreview.directions[0];
  const failedInput = { kind: "image", previewId: failedPreview.id, promptVersion: failedPreview.enhancer.version, prompt: failedDirection.positivePrompt, negativePrompt: failedDirection.negativePrompt, ratio: failedPreview.ratio, requestKey: "image-request-000003" };
  const failed = await app.inject({ method: "POST", url: "/lanqi/media/confirm", headers: a, payload: { ...failedInput, confirmed: true } });
  const failedId = failed.json().job.id;
  await app.inject({ method: "POST", url: `/lanqi/media/jobs/${failedId}/refresh`, headers: a, payload: {} });
  const failedResult = await app.inject({ method: "POST", url: `/lanqi/media/jobs/${failedId}/refresh`, headers: a, payload: {} });
  assert.equal(failedResult.json().job.status, "failed");
  assert.equal(failedResult.json().job.canRetry, true);
  assert.equal(failedResult.json().job.billingStatus, "not_billed");

  await app.close();
  console.log("Lanqi same-page image generation workflow smoke passed.");
} finally {
  await rm(uploadRoot, { recursive: true, force: true });
}
}

void main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const skillAnswer = `标题候选：
1. 初秋补水护理，到店前先确认这三件事
2. 换季护理怎么选？先看这份准备清单
3. 附近上班族的初秋护理小笔记

正文：
初秋气候变化时，可以先记录自己的日常护理需求，再向门店核对当前能够提供的服务和预约安排。门店已确认资料以本店档案为准，价格、效果和顾客案例均不在本稿中作承诺。

话题标签：
#小红书笔记 #初秋护理 #门店日常 #到店体验 #本地生活

互动与承接：
你换季时最想先确认哪项护理信息？承接方式待确认。

发布前核对：
本稿只使用门店已确认事实，未引用未激活的兰琪方法论、内部定价、疗效、价格或顾客案例。`;

async function main() {
  const uploadRoot = await mkdtemp(path.join(os.tmpdir(), "lanqi-xhs-package-"));
  process.env.NODE_ENV = "test";
  process.env.DATA_MODE = "demo";
  process.env.SKILL_MCP_ENABLED = "false";
  process.env.LANQI_MEDIA_EXECUTION_MODE = "mock";
  process.env.LANQI_MEDIA_ASSET_STORAGE = "disabled";
  process.env.UPLOAD_DIR = uploadRoot;
  process.env.JWT_SECRET = "lanqi-xhs-package-workflow-smoke-secret-2026";
  try {
    const [{ default: fastify }, { registerLanqiContentStudioRoutes }, { registerLanqiMediaGenerationRoutes }, { registerLanqiXhsPackageRoutes }] = await Promise.all([
      import("../apps/api/node_modules/fastify/fastify.js"),
      import("../apps/api/src/routes/lanqi-content-studio.ts"),
      import("../apps/api/src/routes/lanqi-media-generation.ts"),
      import("../apps/api/src/routes/lanqi-xhs-package.ts"),
    ]);
    let providerCalls = 0;
    const provider = { name: "lanqi-xhs-package-smoke", async complete() { providerCalls += 1; return skillAnswer; } };
    const app = fastify({ logger: false });
    await registerLanqiContentStudioRoutes(app, provider);
    await registerLanqiMediaGenerationRoutes(app, provider);
    await registerLanqiXhsPackageRoutes(app, provider);
    await app.ready();

    const a = { "x-sitong-tenant-id": "lanqi-package-tenant-a", "x-sitong-user-id": "user-a", "content-type": "application/json" };
    const b = { "x-sitong-tenant-id": "lanqi-package-tenant-b", "x-sitong-user-id": "user-b", "content-type": "application/json" };
    const settings = { purpose: "xiaohongshu_cover", ratio: "3:4", style: "premium", allowPeople: false, overlayTitle: true, rightsConfirmed: true };
    const quoteResponse = await app.inject({ method: "POST", url: "/lanqi/content-studio/package-quote", headers: a, payload: settings });
    assert.equal(quoteResponse.statusCode, 200);
    const quote = quoteResponse.json();
    assert.equal(quote.canConfirm, true);
    assert.equal(quote.imageCount, 1);
    assert.equal(quote.executionMode, "mock");

    const requestId = "lanqi-package-smoke-000001";
    const payload = { ...settings, request: "做一篇初秋补水护理的小红书图文，温柔高级，不出现顾客正脸", audience: "附近上班族", goal: "获得咨询", quoteId: quote.quoteId, requestId, confirmed: true };
    const created = await app.inject({ method: "POST", url: "/lanqi/content-studio/packages", headers: a, payload });
    assert.equal(created.statusCode, 202);
    assert.equal(created.json().package.packageId, requestId);
    assert.equal(created.json().package.draft.copyDraft.titleCandidates.length, 3);
    assert.equal(created.json().package.jobs.length, 1);
    assert.equal(providerCalls, 1, "一次图文任务只应调用一次文案模型；mock 图片提示词不调用 Provider");

    const duplicate = await app.inject({ method: "POST", url: "/lanqi/content-studio/packages", headers: a, payload });
    assert.equal(duplicate.statusCode, 200);
    assert.equal(duplicate.json().idempotent, true);
    assert.equal(duplicate.json().package.jobs.length, 1, "重复调用不得创建第二个图片任务");
    assert.equal(providerCalls, 1, "重复调用不得重复生成文案");

    await app.inject({ method: "POST", url: `/lanqi/content-studio/packages/${requestId}/refresh`, headers: a, payload: {} });
    const completed = await app.inject({ method: "POST", url: `/lanqi/content-studio/packages/${requestId}/refresh`, headers: a, payload: {} });
    assert.equal(completed.statusCode, 200);
    assert.equal(completed.json().package.status, "succeeded");
    const completedJob = completed.json().package.jobs[0];
    assert.ok(completedJob.savedAt, "统一工作流完成后必须自动保存图片资产");
    assert.equal(completed.json().package.actualCredits, 0, "mock 验收不得扣积分");

    const selectedTitle = completed.json().package.draft.copyDraft.titleCandidates[1];
    const titleUpdate = await app.inject({ method: "PATCH", url: `/lanqi/content-studio/drafts/${completed.json().package.draft.id}`, headers: a, payload: { selectedTitle } });
    assert.equal(titleUpdate.statusCode, 200);
    assert.equal(titleUpdate.json().draft.copyDraft.selectedTitle, selectedTitle);
    const restored = await app.inject({ method: "GET", url: "/lanqi/content-studio/packages", headers: a });
    assert.equal(restored.json().packages[0].draft.copyDraft.selectedTitle, selectedTitle, "标题选择必须刷新恢复");
    assert.equal(restored.json().packages[0].jobs.length, 1);
    assert.equal((await app.inject({ method: "GET", url: "/lanqi/content-studio/packages", headers: b })).json().packages.length, 0, "租户 B 不得恢复租户 A 图文");

    const download = await app.inject({ method: "GET", url: `/lanqi/media/assets/${completedJob.id}/download`, headers: a });
    assert.equal(download.statusCode, 200);
    assert.match(String(download.headers["content-type"]), /^image\//);
    assert.match(String(download.headers["content-disposition"]), /^attachment;/);
    assert.equal((await app.inject({ method: "GET", url: `/lanqi/media/assets/${completedJob.id}/download`, headers: b })).statusCode, 404, "跨租户下载必须拒绝");

    const failedRequestId = "lanqi-package-smoke-000002";
    const failedCreated = await app.inject({ method: "POST", url: "/lanqi/content-studio/packages", headers: a, payload: { ...payload, request: "做一篇[模拟失败]的秋季护理小红书图文，不出现人物", requestId: failedRequestId } });
    assert.equal(failedCreated.statusCode, 202);
    await app.inject({ method: "POST", url: `/lanqi/content-studio/packages/${failedRequestId}/refresh`, headers: a, payload: {} });
    const failed = await app.inject({ method: "POST", url: `/lanqi/content-studio/packages/${failedRequestId}/refresh`, headers: a, payload: {} });
    assert.equal(failed.json().package.status, "partial_success");
    assert.ok(failed.json().package.draft.copyDraft.body, "图片失败必须保留完整文案");
    assert.equal(failed.json().package.actualCredits, 0, "图片失败不得留下 mock 扣费");
    assert.equal(providerCalls, 2, "图片失败后不得自动重跑文案");

    const retry = await app.inject({ method: "POST", url: `/lanqi/content-studio/packages/${failedRequestId}/retry-image`, headers: a, payload: { quoteId: quote.quoteId, requestId: "lanqi-image-retry-smoke-000001", confirmed: true } });
    assert.equal(retry.statusCode, 202);
    assert.equal(retry.json().package.jobs.length, 2, "只重试图片必须创建新的独立图片费用动作");
    assert.equal(providerCalls, 2, "只重试图片不得再次生成文案");

    const jobsBeforeTextFailure = (await app.inject({ method: "GET", url: "/lanqi/media/jobs", headers: a })).json().jobs.length;
    const textFailure = await app.inject({ method: "POST", url: "/lanqi/content-studio/packages", headers: a, payload: { ...payload, request: "请帮我写一篇小红书", requestId: "lanqi-package-smoke-000003" } });
    assert.equal(textFailure.statusCode, 422);
    assert.match(textFailure.json().message, /告诉我|服务|场景|问题/);
    assert.equal((await app.inject({ method: "GET", url: "/lanqi/media/jobs", headers: a })).json().jobs.length, jobsBeforeTextFailure, "文案失败不得创建图片任务");

    await app.close();
    console.log("Lanqi unified Xiaohongshu package workflow smoke passed.");
  } finally {
    await rm(uploadRoot, { recursive: true, force: true });
  }
}

void main().catch(error => { console.error(error); process.exitCode = 1; });

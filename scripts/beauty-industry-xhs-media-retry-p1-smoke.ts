import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildBeautyImageRequirementsHash,
  canStartBeautyImageBatch,
  evaluateBeautyMediaBatchAction,
  selectLatestBeautyImageBatch
} from "../apps/api/src/products/beauty-industry/media-batch.js";
import {
  buildBeautyXhsTaskSnapshot,
  buildBeautyXhsTaskSnapshotDirective,
  readBeautyXhsTaskSnapshot
} from "../apps/api/src/products/beauty-industry/xhs-task-snapshot.js";

const oldFailed = [0, 1, 2].map((batchIndex) => ({
  id: `old-${batchIndex}`,
  createdAt: new Date("2026-08-28T05:59:04Z"),
  parameters: { batchRequestId: "batch-old", batchIndex, imageRequirementsHash: "requirements-old" },
  status: "succeeded",
  assetStatus: batchIndex === 0 ? "quality_rejected" : "persisted"
}));
const newPending = [0, 1, 2].map((batchIndex) => ({
  id: `new-${batchIndex}`,
  createdAt: new Date("2026-08-28T06:02:16Z"),
  parameters: { batchRequestId: "batch-new", batchIndex, imageRequirementsHash: "requirements-new" },
  status: "queued",
  assetStatus: "pending"
}));

assert.deepEqual(selectLatestBeautyImageBatch(oldFailed).map((job) => job.id), ["old-0", "old-1", "old-2"]);
assert.deepEqual(selectLatestBeautyImageBatch([...oldFailed, ...newPending]).map((job) => job.id), ["new-0", "new-1", "new-2"]);

assert.equal(canStartBeautyImageBatch({ requested: 3, maxPerBatch: 3, historicalJobCount: 3 }), true, "历史失败作业不得占用新批次单批额度");
assert.equal(canStartBeautyImageBatch({ requested: 4, maxPerBatch: 3, historicalJobCount: 0 }), false);

const oldHash = buildBeautyImageRequirementsHash({ overallVisualRequirements: "干净自然", prohibitedContent: "文字、品牌" });
assert.equal(oldHash, buildBeautyImageRequirementsHash({ prohibitedContent: "文字、品牌", overallVisualRequirements: "干净自然" }));

assert.deepEqual(evaluateBeautyMediaBatchAction({ latestBatchStatus: "quality_failed", retryRequested: false, requirementsChanged: false }), {
  canConfirm: false,
  retryEligible: true,
  code: "previous_batch_quality_failed"
});
assert.deepEqual(evaluateBeautyMediaBatchAction({ latestBatchStatus: "quality_failed", retryRequested: true, requirementsChanged: false }), {
  canConfirm: false,
  retryEligible: true,
  code: "image_requirements_unchanged"
});
assert.deepEqual(evaluateBeautyMediaBatchAction({ latestBatchStatus: "quality_failed", retryRequested: true, requirementsChanged: false, executionContractChanged: true }), {
  canConfirm: true,
  retryEligible: true,
  code: "retry_confirmation_ready"
}, "旧安全合同误拒后的显式重试应由新版本合同获得独立确认资格，不要求用户伪改图片需求");
assert.deepEqual(evaluateBeautyMediaBatchAction({ latestBatchStatus: "quality_failed", retryRequested: true, requirementsChanged: true }), {
  canConfirm: true,
  retryEligible: true,
  code: "retry_confirmation_ready"
});
assert.deepEqual(evaluateBeautyMediaBatchAction({ latestBatchStatus: "processing", retryRequested: true, requirementsChanged: true }), {
  canConfirm: false,
  retryEligible: false,
  code: "batch_in_progress"
});
assert.deepEqual(evaluateBeautyMediaBatchAction({ latestBatchStatus: "succeeded", retryRequested: false, requirementsChanged: true }), {
  canConfirm: false,
  retryEligible: true,
  code: "previous_batch_succeeded"
}, "成功批次默认只读，但必须暴露显式修改后重新报价入口");
assert.deepEqual(evaluateBeautyMediaBatchAction({ latestBatchStatus: "succeeded", retryRequested: true, requirementsChanged: false }), {
  canConfirm: false,
  retryEligible: true,
  code: "image_requirements_unchanged"
}, "未修改图片要求不得获得第二批确认资格");
assert.deepEqual(evaluateBeautyMediaBatchAction({ latestBatchStatus: "succeeded", retryRequested: true, requirementsChanged: true }), {
  canConfirm: true,
  retryEligible: true,
  code: "regeneration_confirmation_ready"
}, "成功批次后修改本次图片要求应只重新报价并等待再次确认");

const mediaRoute = readFileSync("apps/api/src/routes/beauty-industry-media.ts", "utf8");
const xhsWorkbench = readFileSync("apps/web/src/components/acquisition/BeautyXhsWorkbench.tsx", "utf8");
const acquisitionPage = readFileSync("apps/web/src/pages/BeautyIndustryAcquisitionPage.tsx", "utf8");
const profileContract = readFileSync("apps/api/src/products/beauty-industry/profile.ts", "utf8");
const mcpContract = readFileSync("apps/api/src/products/beauty-industry/mcp-adapter.ts", "utf8");
assert.doesNotMatch(mediaRoute, /lanqiMediaJob\.count\(\{\s*where:\s*\{\s*tenantId[^}]+kind:\s*BEAUTY_IMAGE_KIND/u, "不得再以租户历史累计作业限制新的明确确认批次");
assert.match(mediaRoute, /retryAfterQualityFailure/u);
assert.match(mediaRoute, /imageRequirementsHash/u);
assert.match(mediaRoute, /selectLatestBeautyImageBatch/u);
assert.match(xhsWorkbench, /本次图文需求/u);
assert.match(xhsWorkbench, /修改本次图片要求后重新生成/u);
assert.match(acquisitionPage, /mediaLoadSequenceRef/u, "刷新或切换历史后的新报价不得被较早的异步费用请求覆盖");
assert.match(acquisitionPage, /loadSequence !== mediaLoadSequenceRef\.current/u);
for (const label of ["本次城市", "门店事实", "内容角度", "三图总体视觉要求", "本次明确事实", "明确禁用内容", "本次采用的信息"]) assert.match(xhsWorkbench, new RegExp(label, "u"));
for (const key of ["city", "storeFacts", "contentAngle", "prohibitedContent"]) {
  assert.match(profileContract, new RegExp(`${key}\\?`, "u"));
  assert.match(mcpContract, new RegExp(key, "u"));
}
assert.doesNotMatch(xhsWorkbench, /兰琪/u, "本次表单和批次状态机必须属于美业通用核心");

const snapshot = buildBeautyXhsTaskSnapshot({
  question: "为本次皮肤管理主题生成小红书图文",
  profile: { segment: "skin_management", operationType: "single_store", operatingStage: "growth", storeName: "档案默认门店", city: "档案城市", services: ["档案项目"], targetCustomers: "档案人群", channels: ["小红书"], factBoundaries: "不编造", source: "user_confirmed", confirmationStatus: "confirmed", version: 1, confirmedAt: "2026-08-28T00:00:00.000Z" },
  professionalOptions: { project: "本次项目", audience: "本次人群", city: "本次城市", storeFacts: "本次仅使用可预约事实", contentAngle: "顾客常见困扰", tone: "自然", visualStyle: "纯摄影静物", prohibitedContent: "价格、疗效" },
  confirmedFacts: "仅本次确认"
});
assert.equal(snapshot.project, "本次项目");
assert.equal(snapshot.city, "本次城市");
assert.equal(snapshot.storeFacts, "本次仅使用可预约事实");
assert.deepEqual(readBeautyXhsTaskSnapshot(`${buildBeautyXhsTaskSnapshotDirective(snapshot)}\n\n其他内部合同`), snapshot);

console.log("beauty-industry xhs media retry P1 smoke passed");

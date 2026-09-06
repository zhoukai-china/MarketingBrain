import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildBeautyImageProviderInput,
  buildBeautyMediaRequestKey,
  parseBeautyImageDirections,
  validateBeautyVideoEvidence
} from "../apps/api/src/products/beauty-industry/media-contract.js";

const sample = [
  "配图方向一｜封面图",
  "正向视觉提示词：无人物美容护理空间，自然光，留白，无文字。",
  "负向视觉提示词：真人，品牌标志，价格，疗效文字。",
  "配图方向二｜内容图",
  "正向视觉提示词：护理用品平铺，浅色毛巾与水珠，自然窗光。",
  "负向视觉提示词：人物，注射器，医疗器械，夸张对比图。",
  "配图方向三｜互动承接图",
  "正向视觉提示词：整洁休息区局部，绿植，自然光，信息安全区。",
  "负向视觉提示词：二维码，电话号码，促销大字，虚假承诺。"
].join("\n");

const one = parseBeautyImageDirections(sample, 1);
const three = parseBeautyImageDirections(sample, 3);
assert.equal(one.length, 1);
assert.equal(three.length, 3);
assert.deepEqual(three.map((item) => item.role), ["cover", "content", "engagement"]);
assert.ok(three.every((item) => item.positivePrompt.length > 10 && item.negativePrompt.length > 5));
assert.ok(three.every((item) => buildBeautyImageProviderInput(item).negativePrompt.includes("QR code")));

const requestKey = buildBeautyMediaRequestKey("run_12345678", "batch_12345678", 2);
assert.match(requestKey, /^beauty_xhs_/);
assert.equal(requestKey, buildBeautyMediaRequestKey("run_12345678", "batch_12345678", 2));

assert.deepEqual(validateBeautyVideoEvidence({ framesAnalyzed: 3, frameSummary: "画面包含护理用品与自然光", transcript: "口播介绍日常护理流程" }), { ok: true });
assert.deepEqual(validateBeautyVideoEvidence({ framesAnalyzed: 0, frameSummary: "", transcript: "" }), { ok: false, reason: "beauty_video_evidence_missing" });

const api = readFileSync("apps/api/src/routes/beauty-industry-media.ts", "utf8");
const mediaBatch = readFileSync("apps/api/src/products/beauty-industry/media-batch.ts", "utf8");
const sharedMediaApi = readFileSync("apps/api/src/routes/media.ts", "utf8");
const mediaObservation = readFileSync("apps/api/src/services/media-provider-observation.ts", "utf8");
const page = readFileSync("apps/web/src/pages/BeautyIndustryAcquisitionPage.tsx", "utf8");
const liveAcceptance = readFileSync("scripts/beauty-industry-xhs-image-live-acceptance.mjs", "utf8");
const environmentContract = readFileSync("apps/api/src/config/env.ts", "utf8");
const assetUrlPolicy = readFileSync("apps/api/src/services/beauty-provider-asset-policy.ts", "utf8");
const acceptanceStart = readFileSync("scripts/acceptance/beauty-industry/start.ps1", "utf8");
for (const endpoint of ["/media/quote", "/media/confirm", "/media/jobs", "/download"]) assert.ok(api.includes(endpoint), `missing ${endpoint}`);
assert.ok(page.includes("确认真实生成三张图片"));
assert.ok(page.includes("下载合格图片"));
assert.ok(!page.includes("确认生成图片｜尚未授权"));
assert.ok(page.includes("恢复图片任务状态"), "existing provider tasks need an explicit recovery action");
assert.ok(!page.includes("current = await Promise.all(current.map"), "provider status checks must not burst concurrently");
assert.ok(page.includes("图片状态查询暂时失败"), "a transient status failure must stay visible without discarding the existing tasks");
assert.ok(page.includes("图片未达到交付标准，不建议使用"), "technical success must be separated from customer quality");
assert.ok(page.includes("内部图片质量审核"), "rejected assets need a safe internal audit summary");
assert.ok(api.includes('billingStatus: "charged"'), "successful image jobs must be marked charged individually");
assert.ok(api.includes('billingStatus: "refunded"'), "failed or canceled image jobs must be marked refunded individually");
assert.ok(api.includes("assetPersistenceStage"), "local asset failures need a safe, stage-specific terminal observation");
assert.ok(api.includes("canRecover: false"), "a Provider-success/local-failure task must not query or bill the Provider again");
assert.ok(!api.includes("recoverableAssetFailure"), "legacy merged persistence failures must remain terminal");
assert.ok(api.includes('reservation.status === "released" || reservation.status === "compensated"'), "late asset recovery must preserve release or compensation instead of charging again");
assert.ok(api.includes("BEAUTY_IMAGE_PROVIDER_COST_PER_IMAGE_YUAN = 0.2"), "real image delivery needs a versioned conservative Provider cost estimate");
assert.ok(api.includes('provider: "aliyun_bailian"'), "active XHS images must use the approved async image Provider contract");
assert.ok(api.includes("buildBeautyImageProviderInput"), "approved three-image batches must use the fixed role-aware Provider prompt contract");
assert.ok(environmentContract.includes("BEAUTY_MEDIA_ACCEPTANCE_OPERATOR_GATE"), "live acceptance needs an explicit default-off operator gate");
assert.ok(environmentContract.includes("BEAUTY_MEDIA_MAX_PROVIDER_COST_YUAN"), "real image acceptance needs a runtime-enforced Provider cost ceiling");
assert.ok(environmentContract.includes("getMissingBeautyProviderAssetRuntimeHosts"), "real media must fail before Provider submission when the official asset host is absent");
assert.ok(acceptanceStart.includes('$env:LANQI_MEDIA_EXECUTION_MODE -ne "real"'), "approved local media startup must fail closed unless the underlying Provider execution mode is real");
assert.ok(acceptanceStart.includes('$env:LANQI_MEDIA_ASSET_STORAGE -ne "local"'), "approved local media startup must fail closed unless the underlying Provider asset store is local");
assert.ok(assetUrlPolicy.includes('"oss-accelerate.aliyuncs.com"'), "the versioned official Bailian result host is missing");
assert.ok(assetUrlPolicy.includes('url.protocol !== "https:"'), "generated assets must require HTTPS");
assert.ok(api.includes("operator-review"), "each accepted image needs an authenticated operator decision before the next Provider task in gated acceptance");
assert.ok(api.includes("operatorQualityStatus"), "operator acceptance must be persisted and participate in delivery state");
assert.ok(api.includes('status: "queued"'), "unsubmitted image jobs must remain explicitly queued");
assert.ok(api.includes("jobs.some((job) => deliveryTerminal(job) && !customerUsable(job))"), "a terminal technical success that fails customer quality must stop the remaining Provider tasks");
assert.ok(api.includes("jobs.slice(0, nextIndex).some((job) => !customerUsable(job))"), "the next Provider task must wait for customer-quality PASS, not technical success alone");
assert.ok(api.includes("batchIndex: index"), "every local placeholder must persist its deterministic batch position");
assert.ok(mediaBatch.includes("readBatchIndex(left.parameters)"), "sequential submission must not depend on equal createdAt timestamps");
assert.ok(api.includes("watermark: false"), "beauty image records must retain the no-watermark boundary");
assert.ok(api.includes("visual_quality_rejected"), "each generated image must pass the customer quality gate");
assert.ok(api.includes("visual_quality_manual_review_required"), "uncertain local findings must remain customer-invisible and auditable");
assert.ok(api.includes("qualityEvidence"), "customer quality decisions must retain bounded local evidence");
assert.ok(api.includes("completeQualifiedDelivery"), "the batch must settle only after complete qualified delivery");
assert.ok(api.includes("persistBeautyCustomerComposite"), "customer delivery must persist the deterministic post-processed image instead of exposing the Provider base");
assert.ok(api.includes('compositionStatus: "pending"'), "new image jobs must pin the required deterministic composition stage");
assert.ok(api.includes('readStringParameter(job.parameters, "compositionStatus") === "completed"'), "customer delivery must fail closed until deterministic composition completes");
assert.ok(api.includes("hasActiveBeautyProductEntitlement"), "media quote, confirmation and asset reads must retain the beauty product entitlement boundary");
assert.ok(!api.includes("BEAUTY_MEDIA_REAL_EXECUTION_APPROVED"), "runtime delivery must not depend on a developer-left one-time approval flag");
assert.ok(api.includes("batch_stopped_after_provider_failure"), "a failed image task must fail-close the remaining unsubmitted jobs");
assert.ok(api.includes('const usable = state === "succeeded" && customerUsable(job)'), "an incomplete three-image batch must expose no customer assets");
assert.ok(api.includes('batchStatus(jobs) !== "succeeded"'), "asset reads must fail closed unless the complete three-image batch passed");
assert.ok(sharedMediaApi.includes("providerTrace"), "visual and ASR calls need safe provider terminal observations");
assert.ok(mediaObservation.includes("requestFingerprint"), "provider request IDs must be stored only as fingerprints");
assert.ok(mediaObservation.includes("billingStarted"), "media analysis must report whether provider billing started");
assert.ok(sharedMediaApi.includes("ALIYUN_MEDIA_ANALYSIS_TIMEOUT_MS"), "visual and ASR calls need an explicit bounded timeout");
assert.ok(liveAcceptance.includes("customerUsable"), "the live acceptance runner must report customer-quality status instead of assuming technical success is deliverable");
assert.ok(liveAcceptance.includes("providerTasksCreated"), "the live acceptance runner must audit the exact number of Provider tasks created before stopping");
assert.ok(api.includes("BEAUTY_DETERMINISTIC_VISUAL_VERSION"), "new deterministic batches must pin their generator version");
assert.ok(api.includes("assessBeautyImageQualityForRole"), "the persisted Provider asset must pass the role-aware post-generation contract, not only generic safety");
assert.ok(api.includes("contentRoleContractVersion: BEAUTY_IMAGE_CONTENT_ROLE_CONTRACT_VERSION"), "new image jobs must persist the active content-role contract version");
assert.ok(api.includes('"quality_review_required"'), "unverified content-role semantics must remain customer-invisible and recover as review-required");
assert.ok(api.includes('imagePlanVersion: imagePlan.version'), "new local batches must pin the approved image plan version");
assert.ok(liveAcceptance.includes("const acceptedJobIds = new Set"), "live acceptance must bind terminal polling to the exact confirmed batch");
assert.ok(liveAcceptance.includes("expectedJobIds.has(job.id)"), "historical terminal batches must not be mistaken for the newly confirmed batch");
assert.ok(liveAcceptance.includes('text.replace(/^\\uFEFF/u, "")'), "controlled runtime and grant JSON must tolerate the BOM emitted by the official PowerShell launcher");
assert.ok(liveAcceptance.includes("visualRequirementsSha256"), "each replacement acceptance grant must bind a distinct customer-facing visual variant");
assert.ok(liveAcceptance.includes('requestMethods.get(message.params.requestId) === "POST"'), "CORS OPTIONS responses must not be counted as duplicate image confirmations");
assert.ok(liveAcceptance.includes("[200, 202, 204]"), "a newly accepted asynchronous image batch must allow the formal HTTP 202 response");
assert.ok(liveAcceptance.includes("expectedResumeJobIds"), "resumed live acceptance must remain pinned to the exact three persisted job ids");
assert.ok(liveAcceptance.includes("AWAITING_OPERATOR_REVIEW"), "the live runner must pause for human usability review after each persisted safe image");
assert.ok(liveAcceptance.includes("batchStatus"), "the live acceptance runner must accept and verify both complete delivery and quality-failed terminal states");
assert.ok(page.includes("beauty.video_content_review"), "admitted video content review entry is missing");
assert.ok(page.includes("需人工复核（不可交付）"), "manual review state must be distinct from a confirmed violation");
assert.ok(sharedMediaApi.includes("providerTrace"), "video review Provider observations must stay available");

console.log("beauty_industry_real_media_smoke=PASS;active_xhs_delivery=real_provider_composed;zero_call_contract_only=true;video_evidence=server_verified");

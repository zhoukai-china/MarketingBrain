import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { prisma } from "../packages/db/src/index.js";
import { auditBeautyImageBatch } from "../apps/api/src/routes/beauty-industry-media.js";
import { readBeautyProviderMediaAsset } from "../apps/api/src/services/beauty-media-assets.js";

const expectedRunId = process.env.BEAUTY_IMAGE_AUDIT_RUN_ID;
const expectedProviderTasks = Number.parseInt(process.env.BEAUTY_IMAGE_EXPECTED_PROVIDER_TASKS ?? "1", 10);
const expectedBatchRequestId = process.env.BEAUTY_IMAGE_AUDIT_BATCH_REQUEST_ID;

async function main(): Promise<void> {
  assert.ok(expectedRunId, "BEAUTY_IMAGE_AUDIT_RUN_ID is required");
  assert.ok(expectedBatchRequestId, "BEAUTY_IMAGE_AUDIT_BATCH_REQUEST_ID is required");
  assert.ok(Number.isInteger(expectedProviderTasks) && expectedProviderTasks >= 1 && expectedProviderTasks <= 3);
  const run = await prisma.agentRun.findFirstOrThrow({
    where: { id: expectedRunId, productCode: "beauty-industry", capabilityId: "beauty_xiaohongshu_package", status: "succeeded" },
    select: { id: true, tenantId: true }
  });
  const jobsBefore = await loadJobs(run.tenantId, run.id, expectedBatchRequestId);
  assert.equal(jobsBefore.length, 3);
  const providerTaskIdsBefore = jobsBefore.map((job) => job.providerTaskId).filter((value): value is string => Boolean(value));
  assert.equal(new Set(providerTaskIdsBefore).size, expectedProviderTasks, "the terminal must preserve the authorized Provider task count");

  const assetEvidenceBefore = await collectAssetEvidence(run.tenantId, jobsBefore);
  assert.equal(assetEvidenceBefore.length, expectedProviderTasks, "every technically successful Provider task must preserve one local audit asset");
  const reservationId = readStringParameter(jobsBefore[0]?.parameters, "reservationId");
  assert.ok(reservationId);
  const accountBefore = await prisma.creditAccount.findUniqueOrThrow({ where: { tenantId: run.tenantId }, select: { balance: true } });
  const transactionCountBefore = await prisma.creditTransaction.count({ where: { tenantId: run.tenantId, refId: reservationId } });

  const first = await auditBeautyImageBatch(run.tenantId, run.id);
  const second = await auditBeautyImageBatch(run.tenantId, run.id);
  assert.equal(first.batchStatus, "quality_failed");
  assert.equal(second.batchStatus, "quality_failed");
  assert.equal(first.jobs.filter((job: any) => job.customerUsable).length, 0);
  assert.equal(first.jobs.filter((job: any) => job.technicalStatus === "succeeded").length, expectedProviderTasks);
  assert.ok(first.jobs.some((job: any) => job.qualityStatus === "rejected" || job.operatorQualityStatus === "rejected"), "a quality-failed mixed batch must retain its automatic or operator rejecting evidence");
  assert.ok(first.jobs.every((job: any) => job.outputUrl === undefined));

  const reservation = await prisma.creditReservation.findUniqueOrThrow({
    where: { id: reservationId },
    select: { status: true, actualAmount: true, amount: true, errorCode: true }
  });
  assert.ok(["released", "compensated"].includes(reservation.status));
  assert.equal(reservation.actualAmount, 0);
  assert.equal(reservation.amount, 300);
  assert.equal(reservation.errorCode, "beauty_media_visual_quality_failed");
  const transactions = await prisma.creditTransaction.findMany({
    where: { tenantId: run.tenantId, refId: reservationId },
    select: { direction: true, amount: true, reason: true }
  });
  assert.equal(transactions.filter((item) => item.direction === "consume").reduce((sum, item) => sum + item.amount, 0), 300);
  assert.equal(transactions.filter((item) => item.direction === "refund").reduce((sum, item) => sum + item.amount, 0), 300);
  assert.equal(transactions.filter((item) => item.direction === "refund").length, 1, "the failed batch must release or compensate exactly once");

  const jobsAfter = await loadJobs(run.tenantId, run.id, expectedBatchRequestId);
  const providerTaskIdsAfter = jobsAfter.map((job) => job.providerTaskId).filter((value): value is string => Boolean(value));
  assert.deepEqual(providerTaskIdsAfter, providerTaskIdsBefore, "postflight must not create, replace, or reorder Provider tasks");
  const assetEvidenceAfter = await collectAssetEvidence(run.tenantId, jobsAfter);
  assert.deepEqual(assetEvidenceAfter, assetEvidenceBefore, "postflight must not modify, overwrite, or delete audit assets");
  assert.equal(await prisma.creditTransaction.count({ where: { tenantId: run.tenantId, refId: reservationId } }), transactionCountBefore, "repeated audit must not create another ledger transaction");
  assert.equal((await prisma.creditAccount.findUniqueOrThrow({ where: { tenantId: run.tenantId }, select: { balance: true } })).balance, accountBefore.balance, "repeated audit must not change account balance");

  const technicalSucceeded = jobsAfter.filter((job) => job.status === "succeeded").length;
  const qualityRejected = jobsAfter.filter((job) => readStringParameter(job.parameters, "qualityStatus") === "rejected" || readStringParameter(job.parameters, "operatorQualityStatus") === "rejected").length;
  const unsubmitted = jobsAfter.filter((job) => !job.providerTaskId).length;
  process.stdout.write(`${JSON.stringify({ beautyIndustryImageQualityLivePostflight: "PASS", runId: run.id, providerTasks: providerTaskIdsAfter.length, technicalSucceeded, qualityRejected, unsubmitted, customerUsable: 0, reservationStatus: reservation.status, netTestCredits: 0, providerCallsDuringPostflight: 0, assetsUnchanged: true, assets: assetEvidenceAfter })}\n`);
}

async function loadJobs(tenantId: string, runId: string, batchRequestId: string) {
  const jobs = await prisma.lanqiMediaJob.findMany({ where: { tenantId, previewId: runId, kind: "beauty_image" } });
  return jobs
    .filter((job) => readStringParameter(job.parameters, "batchRequestId") === batchRequestId)
    .sort((left, right) => readNumberParameter(left.parameters, "batchIndex") - readNumberParameter(right.parameters, "batchIndex") || left.id.localeCompare(right.id));
}

async function collectAssetEvidence(tenantId: string, jobs: Awaited<ReturnType<typeof loadJobs>>) {
  const evidence: Array<{ jobId: string; sha256: string; width?: number; height?: number; qualityStatus?: string; reasons: string[] }> = [];
  for (const job of jobs.filter((item) => item.status === "succeeded" && ["persisted", "quality_rejected"].includes(String(item.assetStatus)))) {
    const asset = await readBeautyProviderMediaAsset({ tenantId, jobId: job.id });
    const sha256 = createHash("sha256").update(asset.bytes).digest("hex");
    assert.equal(sha256, readStringParameter(job.parameters, "qualitySha256"), "persisted asset and quality audit hash differ");
    evidence.push({ jobId: job.id, sha256, width: readOptionalNumberParameter(job.parameters, "qualityWidth"), height: readOptionalNumberParameter(job.parameters, "qualityHeight"), qualityStatus: readStringParameter(job.parameters, "qualityStatus"), reasons: readStringArrayParameter(job.parameters, "qualityReasons") });
  }
  return evidence;
}

function readStringParameter(value: unknown, key: string): string | undefined { return value && typeof value === "object" && !Array.isArray(value) && typeof (value as Record<string, unknown>)[key] === "string" ? String((value as Record<string, unknown>)[key]) : undefined; }
function readOptionalNumberParameter(value: unknown, key: string): number | undefined { const candidate = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>)[key] : undefined; return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : undefined; }
function readNumberParameter(value: unknown, key: string): number { return readOptionalNumberParameter(value, key) ?? Number.MAX_SAFE_INTEGER; }
function readStringArrayParameter(value: unknown, key: string): string[] { const candidate = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>)[key] : undefined; return Array.isArray(candidate) ? candidate.filter((item): item is string => typeof item === "string") : []; }

main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`); process.exitCode = 1; }).finally(async () => { await prisma.$disconnect(); });

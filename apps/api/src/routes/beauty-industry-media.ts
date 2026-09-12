import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { Prisma, prisma } from "@baolu/db";
import { z } from "zod";
import { env } from "../config/env.js";
import { assessBeautyImageQualityForRole, BEAUTY_DETERMINISTIC_VISUAL_VERSION, BEAUTY_IMAGE_COMMERCIAL_PHOTO_CONTRACT_VERSION, BEAUTY_IMAGE_CONTENT_ROLE_CONTRACT_VERSION, BEAUTY_IMAGE_PROVIDER_PROMPT_VERSION, BEAUTY_IMAGE_SAFETY_DETECTOR_VERSION, buildBeautyImageDeliveryPlan, buildBeautyImageOverlays, buildBeautyImageProviderInput, buildBeautyMediaRequestKey, parseBeautyImageDirections, type BeautyDeterministicVisualReceiptContract, type BeautyImageRole, type BeautyImageSafetyEvidence } from "../products/beauty-industry/media-contract.js";
import {
  createBeautyMediaAssetPersistenceError,
  persistBeautyCustomerComposite,
  persistBeautyDeterministicBase,
  persistBeautyProviderImage,
  readBeautyMediaAsset,
  readBeautyProviderMediaAsset,
  toBeautyMediaAssetPersistenceIssue,
  type BeautyMediaAssetPersistenceIssue
} from "../services/beauty-media-assets.js";
import { BEAUTY_IMAGE_COMPOSITION_VERSION, composeBeautyCustomerImage, preflightBeautyImageOverlay } from "../services/beauty-image-compositor.js";
import { compensateSettledCreditReservation, releaseCreditReservation, reserveCreditsBeforeProvider, settleCreditReservation } from "../services/credit-reservations.js";
import { cancelLanqiMediaTask, getLanqiMediaExecutionReadiness, getLanqiMediaTask, submitLanqiMedia } from "../services/lanqi-media-generation.js";
import { resolveRequestContext } from "../services/request-context.js";
import { generateBeautyDeterministicVisual, type BeautyDeterministicVisualTheme } from "../services/beauty-deterministic-visual.js";
import {
  buildBeautyImageRequirementsHash,
  assessBeautyDeterministicSceneRequirements,
  canStartBeautyImageBatch,
  evaluateBeautyMediaBatchAction,
  readBeautyImageBatchKey,
  selectBeautyImageBatch,
  selectLatestBeautyImageBatch,
  type BeautyImageRequirements
} from "../products/beauty-industry/media-batch.js";

const BEAUTY_IMAGE_KIND = "beauty_image";
const BEAUTY_IMAGE_PROVIDER_COST_PER_IMAGE_YUAN = 0.2;
const BEAUTY_IMAGE_PROVIDER_COST_PER_IMAGE_FEN = 20;
const BEAUTY_IMAGE_PROVIDER_PRICE_VERSION = "wan2.7-image-2026-08-27-cny-v1";
const imageRequirementsSchema = z.object({
  overallVisualRequirements: z.string().trim().max(500).optional().default(""),
  prohibitedContent: z.string().trim().max(500).optional().default(""),
  selectedTitle: z.string().trim().max(120).optional().default("")
}).strict();
const bodySchema = z.object({
  imageCount: z.union([z.literal(1), z.literal(3)]),
  imageRequirements: imageRequirementsSchema.optional().default({ overallVisualRequirements: "", prohibitedContent: "" }),
  retryAfterQualityFailure: z.boolean().optional().default(false),
  retryOfJobId: z.string().trim().min(1).max(200).optional(),
  regenerateAfterDelivery: z.boolean().optional().default(false),
  regenerateOfJobId: z.string().trim().min(1).max(200).optional()
}).strict();
const confirmSchema = bodySchema.extend({ confirmed: z.literal(true), requestKey: z.string().regex(/^[A-Za-z0-9_-]{12,100}$/) }).strict();
const operatorReviewSchema = z.object({ decision: z.enum(["approved", "rejected"]) }).strict();

export async function registerBeautyIndustryMediaRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { runId: string } }>("/beauty-industry/acquisition/runs/:runId/media/quote", async (request, reply) => {
    const parsed = bodySchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "invalid_beauty_media_quote" });
    const context = await resolveRequestContext(request.headers);
    const packageRun = await loadPackageRun(context.tenantId, context.userId, request.params.runId);
    if (!packageRun) return reply.code(404).send({ error: "beauty_package_not_found" });
    const sceneReadiness = assessBeautyDeterministicSceneRequirements(parsed.data.imageRequirements);
    if (!sceneReadiness.ok) return reply.code(422).send({ error: sceneReadiness.code, message: sceneReadiness.message });
    let directions;
    let imagePlan;
    try {
      directions = parseBeautyImageDirections(packageRun.output!, parsed.data.imageCount);
      imagePlan = buildBeautyImageDeliveryPlan({ output: packageRun.output!, imageCount: parsed.data.imageCount, textSkillVersion: packageRun.skillVersion });
      const overlays = buildBeautyImageOverlays({ output: packageRun.output!, selectedTitle: parsed.data.imageRequirements.selectedTitle });
      preflightBeautyImageOverlays(overlays);
      imagePlan = { ...imagePlan, linkedTitle: overlays[0]!.text };
    }
    catch (error) { return reply.code(422).send(beautyImagePreparationIssue(error)); }
    let existing = await findRunJobs(context.tenantId, packageRun.id);
    if (existing.length > 0) { await auditPendingImageQuality(context.tenantId, packageRun.id, existing); await finalizeBatchIfTerminal(context.tenantId, packageRun.id); existing = await findRunJobs(context.tenantId, packageRun.id); }
    const estimatedProviderCostYuan = estimateBeautyImageProviderCostYuan(directions.length);
    const existingBatchStatus = existing.length ? batchStatus(existing) : undefined;
    const requirementsHash = buildBeautyImageRequirementsHash(parsed.data.imageRequirements);
    const previousRequirementsHash = readStringParameter(existing[0]?.parameters, "imageRequirementsHash");
    const retryOfMatches = Boolean(parsed.data.retryOfJobId && existing.some((job) => job.id === parsed.data.retryOfJobId));
    const regenerationOfMatches = Boolean(parsed.data.regenerateOfJobId && existing.some((job) => job.id === parsed.data.regenerateOfJobId));
    const action = evaluateBeautyMediaBatchAction({
      latestBatchStatus: existingBatchStatus,
      retryRequested: existingBatchStatus === "succeeded"
        ? parsed.data.regenerateAfterDelivery && regenerationOfMatches
        : parsed.data.retryAfterQualityFailure && retryOfMatches,
      requirementsChanged: beautyImageRequirementsChanged(previousRequirementsHash, requirementsHash, parsed.data.imageRequirements),
      executionContractChanged: beautyImageExecutionContractChanged(existing[0]?.parameters)
    });
    const readiness = action.canConfirm
      ? await resolveReadiness(context.tenantId, directions.length, 0, estimatedProviderCostYuan)
      : existing.length
        ? { canConfirm: false, code: action.code, message: beautyMediaActionMessage(action.code) }
        : await resolveReadiness(context.tenantId, directions.length, 0, estimatedProviderCostYuan);
    return {
      runId: packageRun.id,
      imageCount: directions.length,
      creditCost: directions.length * env.BEAUTY_MEDIA_IMAGE_CREDITS,
      canConfirm: readiness.canConfirm,
      existing: existing.length > 0,
      stateCode: readiness.code ?? action.code,
      retryEligible: action.retryEligible,
      retryOfJobId: action.retryEligible && existingBatchStatus === "quality_failed" ? existing[0]?.id : undefined,
      regenerationEligible: action.retryEligible && existingBatchStatus === "succeeded",
      regenerationOfJobId: action.retryEligible && existingBatchStatus === "succeeded" ? existing[0]?.id : undefined,
      deliveryMode: "real_provider_composed",
      imagePlan,
      message: readiness.message
    };
  });

  app.post<{ Params: { runId: string } }>("/beauty-industry/acquisition/runs/:runId/media/confirm", async (request, reply) => {
    const parsed = confirmSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "explicit_confirmation_required", message: "请先查看费用，再明确确认本次图片生成。" });
    const context = await resolveRequestContext(request.headers);
    if (context.source !== "database") return reply.code(409).send({ error: "beauty_media_database_required" });
    const packageRun = await loadPackageRun(context.tenantId, context.userId, request.params.runId);
    if (!packageRun) return reply.code(404).send({ error: "beauty_package_not_found" });
    const sceneReadiness = assessBeautyDeterministicSceneRequirements(parsed.data.imageRequirements);
    if (!sceneReadiness.ok) return reply.code(422).send({ error: sceneReadiness.code, message: sceneReadiness.message });
    const requestId = `beauty-media:${context.tenantId}:${packageRun.id}:${parsed.data.requestKey}`;
    let directions;
    let imagePlan;
    try {
      directions = parseBeautyImageDirections(packageRun.output!, parsed.data.imageCount);
      imagePlan = buildBeautyImageDeliveryPlan({ output: packageRun.output!, imageCount: parsed.data.imageCount, textSkillVersion: packageRun.skillVersion });
      const overlays = buildBeautyImageOverlays({ output: packageRun.output!, selectedTitle: parsed.data.imageRequirements.selectedTitle });
      preflightBeautyImageOverlays(overlays);
      imagePlan = { ...imagePlan, linkedTitle: overlays[0]!.text };
    }
    catch (error) { return reply.code(422).send(beautyImagePreparationIssue(error)); }
    let existing = await findRunJobs(context.tenantId, packageRun.id);
    if (existing.length > 0) {
      await auditPendingImageQuality(context.tenantId, packageRun.id, existing);
      await finalizeBatchIfTerminal(context.tenantId, packageRun.id);
      existing = await findRunJobs(context.tenantId, packageRun.id);
      const state = batchStatus(existing);
      const sameRequest = readBeautyImageBatchKey(existing[0]!) === requestId;
      if (sameRequest || state === "processing") {
        return { jobs: serializeBatch(existing), batchStatus: state, idempotent: true, message: state === "succeeded" ? "已恢复此图文任务的合格图片，不会重复生成或扣费。" : "此图片批次正在生成，不会创建重复任务或重复扣费。" };
      }
      const previousRequirementsHash = readStringParameter(existing[0]?.parameters, "imageRequirementsHash");
      const requirementsHash = buildBeautyImageRequirementsHash(parsed.data.imageRequirements);
      const retryOfMatches = Boolean(parsed.data.retryOfJobId && existing.some((job) => job.id === parsed.data.retryOfJobId));
      const regenerationOfMatches = Boolean(parsed.data.regenerateOfJobId && existing.some((job) => job.id === parsed.data.regenerateOfJobId));
      const action = evaluateBeautyMediaBatchAction({
        latestBatchStatus: state,
        retryRequested: state === "succeeded"
          ? parsed.data.regenerateAfterDelivery && regenerationOfMatches
          : parsed.data.retryAfterQualityFailure && retryOfMatches,
        requirementsChanged: beautyImageRequirementsChanged(previousRequirementsHash, requirementsHash, parsed.data.imageRequirements),
        executionContractChanged: beautyImageExecutionContractChanged(existing[0]?.parameters)
      });
      if (!action.canConfirm) return reply.code(409).send({ error: action.code, message: beautyMediaActionMessage(action.code), retryEligible: action.retryEligible, retryOfJobId: existing[0]?.id });
    }
    const estimatedProviderCostYuan = estimateBeautyImageProviderCostYuan(directions.length);
    const readiness = await resolveReadiness(context.tenantId, directions.length, 0, estimatedProviderCostYuan);
    if (!readiness.canConfirm) return reply.code(readiness.code === "quota_exhausted" ? 429 : 409).send({ error: readiness.code, message: readiness.message });

    const requirementsHash = buildBeautyImageRequirementsHash(parsed.data.imageRequirements);
    const overlays = buildBeautyImageOverlays({ output: packageRun.output!, selectedTitle: parsed.data.imageRequirements.selectedTitle });
    preflightBeautyImageOverlays(overlays);
    const deliveryDirections = directions.map((direction) => ({
      ...direction,
      overlay: overlays.find((item) => item.role === direction.role)!
    }));
    const providerDirections = deliveryDirections.map((direction) => ({
      ...direction,
      providerInput: buildBeautyImageProviderInput(direction, parsed.data.imageRequirements)
    }));
    const taskSnapshotHash = createHash("sha256").update(JSON.stringify({ runId: packageRun.id, output: packageRun.output, requirementsHash, imageCount: parsed.data.imageCount })).digest("hex");
    const providerPromptHashes = providerDirections.map((direction) => createHash("sha256").update(JSON.stringify(direction.providerInput)).digest("hex"));
    const fingerprint = createHash("sha256").update(JSON.stringify({ runId: packageRun.id, roles: deliveryDirections.map((item) => item.role), imageCount: parsed.data.imageCount, requirementsHash, taskSnapshotHash, providerPromptHashes, providerPromptVersion: BEAUTY_IMAGE_PROVIDER_PROMPT_VERSION, qualityDetectorVersion: BEAUTY_IMAGE_SAFETY_DETECTOR_VERSION, compositionVersion: BEAUTY_IMAGE_COMPOSITION_VERSION, estimatedProviderCostYuan })).digest("hex");
    let reservation;
    try {
      reservation = await reserveCreditsBeforeProvider({ context, billing: { productCode: "beauty-industry", operatingEntityId: context.tenantId, channel: "web" }, requestId, requestFingerprint: fingerprint, capabilityId: "beauty_xiaohongshu_package:image", provider: "aliyun_bailian", amount: directions.length * env.BEAUTY_MEDIA_IMAGE_CREDITS });
    } catch (error) {
      const current = await findRunJobs(context.tenantId, packageRun.id, requestId);
      if (current.length > 0) return { jobs: serializeBatch(current), batchStatus: batchStatus(current), idempotent: true };
      if (error instanceof Error && error.message === "insufficient_credits") return reply.code(402).send({ error: "insufficient_credits", message: "积分不足，本次没有创建图片任务或调用模型。" });
      throw error;
    }
    if (!reservation) return reply.code(409).send({ error: "beauty_media_reservation_required" });

    let jobs;
    try {
      jobs = await prisma.$transaction(async (tx) => {
        if (!canStartBeautyImageBatch({ requested: directions.length, maxPerBatch: 3 })) throw Object.assign(new Error("beauty_media_quota_exhausted"), { code: "beauty_media_quota_exhausted" });
        const latestAtCommit = selectLatestBeautyImageBatch(await tx.lanqiMediaJob.findMany({ where: { tenantId: context.tenantId, previewId: packageRun.id, kind: BEAUTY_IMAGE_KIND }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }));
        if (latestAtCommit.length) {
          const sameRequest = readBeautyImageBatchKey(latestAtCommit[0]!) === requestId;
          if (!sameRequest) {
            const latestState = batchStatus(latestAtCommit);
            const expectedContinuation = latestState === "quality_failed"
              ? parsed.data.retryAfterQualityFailure && parsed.data.retryOfJobId && latestAtCommit.some((job) => job.id === parsed.data.retryOfJobId)
              : latestState === "succeeded"
                ? parsed.data.regenerateAfterDelivery && parsed.data.regenerateOfJobId && latestAtCommit.some((job) => job.id === parsed.data.regenerateOfJobId)
                : false;
            if (!expectedContinuation) throw new Error("beauty_media_batch_state_changed");
          }
        }
        return Promise.all(providerDirections.map((direction, index) => tx.lanqiMediaJob.create({ data: {
          tenantId: context.tenantId,
          userId: context.userId,
          requestKey: buildBeautyMediaRequestKey(packageRun.id, parsed.data.requestKey, index),
          kind: BEAUTY_IMAGE_KIND,
          provider: "aliyun_bailian",
          model: env.LANQI_MEDIA_IMAGE_MODEL,
          previewId: packageRun.id,
          promptVersion: direction.providerInput.providerPromptVersion,
          prompt: direction.providerInput.prompt,
          negativePrompt: direction.providerInput.negativePrompt,
          parameters: { ratio: "3:4", role: direction.role, label: direction.label, batchIndex: index, reservationId: reservation.id, batchRequestId: requestId, retryOfJobId: parsed.data.retryOfJobId, regenerationOfJobId: parsed.data.regenerateOfJobId, imageRequirementsHash: requirementsHash, imageRequirements: parsed.data.imageRequirements, productCode: "beauty-industry", watermark: direction.providerInput.watermark, deliveryMode: "real_provider_composed", taskSnapshotHash, providerPromptVersion: direction.providerInput.providerPromptVersion, commercialPhotoContractVersion: direction.providerInput.commercialPhotoContractVersion, providerPromptHash: providerPromptHashes[index], providerCallsExpected: 1, estimatedProviderCostYuan: BEAUTY_IMAGE_PROVIDER_COST_PER_IMAGE_YUAN, providerPriceVersion: BEAUTY_IMAGE_PROVIDER_PRICE_VERSION, qualityStatus: "pending_review", qualityDetectorVersion: BEAUTY_IMAGE_SAFETY_DETECTOR_VERSION, contentRoleContractVersion: BEAUTY_IMAGE_CONTENT_ROLE_CONTRACT_VERSION, imagePlanVersion: imagePlan.version, linkedTitleHash: createHash("sha256").update(imagePlan.linkedTitle).digest("hex"), overlayText: direction.overlay.text, overlaySource: direction.overlay.source, compositionRequired: true, compositionStatus: "pending", compositionVersion: BEAUTY_IMAGE_COMPOSITION_VERSION, textSkillVersion: packageRun.skillVersion } as Prisma.InputJsonValue,
          ratio: "3:4",
          creditCost: env.BEAUTY_MEDIA_IMAGE_CREDITS,
          billingStatus: "reserved"
        } })));
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      const concurrent = await findRunJobs(context.tenantId, packageRun.id, requestId);
      if (concurrent.length > 0) {
        return { jobs: serializeBatch(concurrent), batchStatus: batchStatus(concurrent), idempotent: true, message: "已恢复同一确认创建的图片批次，不会重复生成或扣费。" };
      }
      await releaseCreditReservation(reservation.id, error instanceof Error ? error.message : "beauty_media_create_failed");
      if (error instanceof Error && error.message === "beauty_media_quota_exhausted") return reply.code(429).send({ error: "quota_exhausted", message: "每个已确认批次最多生成 3 张，未创建超额任务。" });
      if (error instanceof Error && error.message === "beauty_media_batch_state_changed") return reply.code(409).send({ error: "beauty_media_batch_state_changed", message: "图片批次状态已经变化，请刷新后确认；没有创建重复任务或扣费。" });
      throw error;
    }

    const submissionFailed = !(await submitNextBeautyImageJob(context.tenantId, packageRun.id, requestId));
    await finalizeBatchIfTerminal(context.tenantId, packageRun.id, requestId);
    const submitted = await findRunJobs(context.tenantId, packageRun.id, requestId);
    return reply.code(submissionFailed ? 207 : 202).send({ jobs: serializeBatch(submitted), batchStatus: batchStatus(submitted), idempotent: false, partial: submissionFailed });
  });

  app.get<{ Params: { runId: string } }>("/beauty-industry/acquisition/runs/:runId/media/jobs", async (request, reply) => {
    const context = await resolveRequestContext(request.headers);
    const packageRun = await loadPackageRun(context.tenantId, context.userId, request.params.runId);
    if (!packageRun) return reply.code(404).send({ error: "beauty_package_not_found" });
    let jobs = await findRunJobs(context.tenantId, packageRun.id);
    await auditPendingImageQuality(context.tenantId, packageRun.id, jobs);
    await finalizeBatchIfTerminal(context.tenantId, packageRun.id);
    jobs = await findRunJobs(context.tenantId, packageRun.id);
    return { jobs: serializeBatch(jobs), batchStatus: batchStatus(jobs) };
  });

  app.post<{ Params: { jobId: string } }>("/beauty-industry/media/jobs/:jobId/refresh", async (request, reply) => {
    const context = await resolveRequestContext(request.headers);
    const job = await findJob(context.tenantId, request.params.jobId);
    if (!job) return reply.code(404).send({ error: "beauty_media_job_not_found" });
    const jobBatchKey = readBeautyImageBatchKey(job);
    if (!job.providerTaskId || terminal(job.status)) {
      if (job.previewId) await submitNextBeautyImageJob(context.tenantId, job.previewId, jobBatchKey);
      await finalizeBatchIfTerminal(context.tenantId, job.previewId!, jobBatchKey);
      const jobs = await findRunJobs(context.tenantId, job.previewId!, jobBatchKey);
      return { job: serialize((await findJob(context.tenantId, job.id))!, batchStatus(jobs)), batchStatus: batchStatus(jobs) };
    }
    try {
      const provider = await getLanqiMediaTask(job.providerTaskId);
      const status = provider.status.toLowerCase();
      if (["succeeded", "success"].includes(status)) {
        if (!provider.outputUrl) throw new Error("provider_output_missing");
        try {
          const delivery = await persistAndScreenBeautyImage({
            tenantId: context.tenantId,
            jobId: job.id,
            sourceUrl: provider.outputUrl,
            role: readBeautyImageRole(job.parameters),
            overlayText: readStringParameter(job.parameters, "overlayText") ?? ""
          });
          const quality = delivery.quality;
          await prisma.lanqiMediaJob.update({ where: { id: job.id }, data: {
            status: "succeeded", providerStatus: provider.status, assetStatus: quality.status === "passed" && delivery.composition ? "persisted" : quality.status === "manual_review_required" ? "quality_review_required" : "quality_rejected",
            outputUrl: quality.status === "passed" && delivery.composition ? beautyAssetUrl(job.id) : null,
            errorMessage: quality.status === "passed" && delivery.composition ? null : quality.status === "manual_review_required" ? "visual_quality_manual_review_required" : "visual_quality_rejected", completedAt: new Date(),
            parameters: writeCompositionParameters(writeQualityParameters(job.parameters, quality), delivery.composition) as Prisma.InputJsonValue
          } });
        } catch (error) {
          const issue = toBeautyMediaAssetPersistenceIssue(error);
          await prisma.lanqiMediaJob.update({ where: { id: job.id }, data: {
            status: "failed", providerStatus: provider.status, assetStatus: "unavailable", outputUrl: null,
            errorMessage: issue.code, completedAt: new Date(),
            parameters: writeAssetPersistenceParameters(job.parameters, issue) as Prisma.InputJsonValue
          } });
        }
      } else if (["failed", "error", "canceled"].includes(status)) {
        await prisma.lanqiMediaJob.update({ where: { id: job.id }, data: { status: status === "canceled" ? "canceled" : "failed", providerStatus: provider.status, assetStatus: "unavailable", errorMessage: provider.errorMessage ?? "provider_failed", completedAt: new Date() } });
      } else {
        await prisma.lanqiMediaJob.update({ where: { id: job.id }, data: { status: status === "pending" ? "submitted" : "processing", providerStatus: provider.status } });
      }
    } catch (error) {
      return reply.code(502).send({ error: "beauty_media_refresh_failed", message: "图片状态暂时无法刷新；不会自动重试或创建新任务。" });
    }
    await submitNextBeautyImageJob(context.tenantId, job.previewId!, jobBatchKey);
    await finalizeBatchIfTerminal(context.tenantId, job.previewId!, jobBatchKey);
    const jobs = await findRunJobs(context.tenantId, job.previewId!, jobBatchKey);
    return { job: serialize((await findJob(context.tenantId, job.id))!, batchStatus(jobs)), batchStatus: batchStatus(jobs) };
  });

  app.post<{ Params: { jobId: string } }>("/beauty-industry/media/jobs/:jobId/cancel", async (request, reply) => {
    const context = await resolveRequestContext(request.headers);
    const job = await findJob(context.tenantId, request.params.jobId);
    if (!job) return reply.code(404).send({ error: "beauty_media_job_not_found" });
    const jobBatchKey = readBeautyImageBatchKey(job);
    if (terminal(job.status)) return reply.code(409).send({ error: "beauty_media_job_not_cancelable" });
    if (job.providerTaskId) {
      try { await cancelLanqiMediaTask(job.providerTaskId); }
      catch { return reply.code(409).send({ error: "provider_cancel_rejected", message: "任务已进入处理，供应商不再允许取消；可以继续恢复原任务。" }); }
    }
    await prisma.lanqiMediaJob.update({ where: { id: job.id }, data: { status: "canceled", assetStatus: "unavailable", errorMessage: "user_canceled", canceledAt: new Date(), completedAt: new Date() } });
    await submitNextBeautyImageJob(context.tenantId, job.previewId!, jobBatchKey);
    await finalizeBatchIfTerminal(context.tenantId, job.previewId!, jobBatchKey);
    const jobs = await findRunJobs(context.tenantId, job.previewId!, jobBatchKey);
    return { job: serialize((await findJob(context.tenantId, job.id))!, batchStatus(jobs)), batchStatus: batchStatus(jobs) };
  });

  app.post<{ Params: { jobId: string } }>("/beauty-industry/media/jobs/:jobId/operator-review", async (request, reply) => {
    if (env.BEAUTY_MEDIA_ACCEPTANCE_OPERATOR_GATE !== "true") return reply.code(404).send({ error: "beauty_media_operator_gate_disabled" });
    const parsed = operatorReviewSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "invalid_beauty_media_operator_review" });
    const context = await resolveRequestContext(request.headers);
    const job = await findJob(context.tenantId, request.params.jobId);
    if (!job || !job.previewId) return reply.code(404).send({ error: "beauty_media_job_not_found" });
    const jobBatchKey = readBeautyImageBatchKey(job);
    const currentDecision = readStringParameter(job.parameters, "operatorQualityStatus");
    if (currentDecision === parsed.data.decision) {
      const jobs = await findRunJobs(context.tenantId, job.previewId, jobBatchKey);
      return { job: serialize(job, batchStatus(jobs)), batchStatus: batchStatus(jobs), idempotent: true };
    }
    if (currentDecision === "approved" || currentDecision === "rejected") return reply.code(409).send({ error: "beauty_media_operator_review_conflict" });
    if (job.status !== "succeeded" || job.assetStatus !== "persisted" || qualityStatus(job) !== "passed") {
      return reply.code(409).send({ error: "beauty_media_operator_review_not_ready" });
    }

    const reviewedAt = new Date().toISOString();
    const parameters = writeOperatorQualityParameters(job.parameters, parsed.data.decision, reviewedAt);
    await prisma.lanqiMediaJob.update({ where: { id: job.id }, data: parsed.data.decision === "approved"
      ? { parameters: parameters as Prisma.InputJsonValue }
      : { parameters: parameters as Prisma.InputJsonValue, assetStatus: "quality_rejected", outputUrl: null, errorMessage: "visual_quality_operator_rejected", completedAt: new Date() }
    });
    await submitNextBeautyImageJob(context.tenantId, job.previewId, jobBatchKey);
    await finalizeBatchIfTerminal(context.tenantId, job.previewId, jobBatchKey);
    const jobs = await findRunJobs(context.tenantId, job.previewId, jobBatchKey);
    return { job: serialize((await findJob(context.tenantId, job.id))!, batchStatus(jobs)), batchStatus: batchStatus(jobs), idempotent: false };
  });

  app.get<{ Params: { jobId: string } }>("/beauty-industry/media/assets/:jobId", async (request, reply) => sendAsset(request.headers, request.params.jobId, reply, false));
  app.get<{ Params: { jobId: string } }>("/beauty-industry/media/assets/:jobId/download", async (request, reply) => sendAsset(request.headers, request.params.jobId, reply, true));
}

function preflightBeautyImageOverlays(overlays: ReturnType<typeof buildBeautyImageOverlays>): void {
  for (const overlay of overlays) {
    preflightBeautyImageOverlay({ role: overlay.role, overlayText: overlay.text, width: 768, height: 1024 });
  }
}

function beautyImagePreparationIssue(error: unknown): { error: string; message: string } {
  const code = error instanceof Error ? error.message : "";
  if (code === "beauty_image_selected_title_invalid") {
    return { error: code, message: "当前标题不属于这份图文任务，请重新选择本次生成结果中的标题。" };
  }
  if (code === "beauty_image_overlay_repeated_segment") {
    return { error: code, message: "当前所选标题含有重复片段，请选择其他标题后再确认图片。" };
  }
  if (code === "beauty_image_overlay_too_long") {
    return { error: code, message: "当前标题或短句过长，无法完整排版且不会自动截断；请缩短本次文字或选择其他标题。" };
  }
  if (code === "beauty_image_overlay_unsupported_symbol") {
    return { error: code, message: "当前标题含有无法可靠排版的表情或特殊符号，请改用普通文字或选择其他标题。" };
  }
  return { error: "beauty_image_prompt_incomplete", message: "当前图文结果缺少完整的专业配图说明，请重新生成图文。" };
}

export async function auditBeautyImageBatch(tenantId: string, runId: string) {
  let jobs = await findRunJobs(tenantId, runId);
  await auditPendingImageQuality(tenantId, runId, jobs);
  await finalizeBatchIfTerminal(tenantId, runId);
  jobs = await findRunJobs(tenantId, runId);
  return { jobs: serializeBatch(jobs), batchStatus: batchStatus(jobs) };
}

async function sendAsset(headers: Record<string, unknown>, jobId: string, reply: any, download: boolean) {
  const context = await resolveRequestContext(headers as any);
  const job = await findJob(context.tenantId, jobId);
  if (!job || !job.previewId) return reply.code(404).send({ error: "beauty_media_asset_not_found" });
  const jobs = await findRunJobs(context.tenantId, job.previewId, readBeautyImageBatchKey(job));
  if (batchStatus(jobs) !== "succeeded" || job.status !== "succeeded" || job.assetStatus !== "persisted" || qualityStatus(job) !== "passed") return reply.code(404).send({ error: "beauty_media_asset_not_found" });
  try {
    const asset = await readBeautyMediaAsset({ tenantId: context.tenantId, jobId });
    const contentType = asset.metadata.customerComposite?.contentType ?? asset.metadata.contentType;
    const extension = contentType === "image/jpeg" ? "jpg" : contentType === "image/webp" ? "webp" : "png";
    if (download) reply.header("Content-Disposition", `attachment; filename="beauty-xhs-${jobId.slice(0, 24)}.${extension}"`);
    return reply.header("Content-Type", contentType).header("Cache-Control", download ? "private, no-store" : "private, max-age=3600").send(asset.bytes);
  } catch { return reply.code(404).send({ error: "beauty_media_asset_not_found" }); }
}

async function loadPackageRun(tenantId: string, userId: string | undefined, runId: string) {
  if (!(await hasActiveBeautyProductEntitlement(tenantId))) return null;
  return prisma.agentRun.findFirst({ where: { id: runId, tenantId, userId: userId ?? null, productCode: "beauty-industry", capabilityId: "beauty_xiaohongshu_package", status: "succeeded", output: { not: null } }, select: { id: true, output: true, skillVersion: true } });
}
async function findRunJobs(tenantId: string, runId: string, batchKey?: string) {
  const jobs = await prisma.lanqiMediaJob.findMany({
    where: { tenantId, previewId: runId, kind: BEAUTY_IMAGE_KIND },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }]
  });
  return batchKey ? selectBeautyImageBatch(jobs, batchKey) : selectLatestBeautyImageBatch(jobs);
}
async function findJob(tenantId: string, jobId: string) {
  if (!(await hasActiveBeautyProductEntitlement(tenantId))) return null;
  return prisma.lanqiMediaJob.findFirst({ where: { id: jobId, tenantId, kind: BEAUTY_IMAGE_KIND } });
}

async function hasActiveBeautyProductEntitlement(tenantId: string): Promise<boolean> {
  const entitlement = await prisma.tenantProductEntitlement.findFirst({
    where: {
      tenantId,
      productCode: "beauty-industry",
      status: "active",
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }]
    },
    select: { id: true }
  });
  return Boolean(entitlement);
}

async function resolveReadiness(tenantId: string, requested: number, existing: number, estimatedProviderCostYuan: number): Promise<{ canConfirm: boolean; code?: string; message: string }> {
  if (existing > 0) return { canConfirm: true, message: "已有任务可恢复。" };
  if (!(await hasActiveBeautyProductEntitlement(tenantId))) return { canConfirm: false, code: "media_entitlement_blocked", message: "当前租户尚未获得图片生成权限。" };
  if (env.BEAUTY_MEDIA_PRODUCT_ENABLED !== "true" || env.BEAUTY_MEDIA_EXECUTION_MODE !== "real") {
    return { canConfirm: false, code: "media_authorization_blocked", message: "真实图片生成尚未在当前验收环境启用；本次不会创建任务或预留积分。" };
  }
  if (env.BEAUTY_MEDIA_MAX_REAL_IMAGES < requested) return { canConfirm: false, code: "quota_exhausted", message: "当前授权不足以生成本次三张图片；不会创建超额任务。" };
  if (estimatedProviderCostYuan <= 0 || estimatedProviderCostYuan > env.BEAUTY_MEDIA_MAX_PROVIDER_COST_YUAN || estimatedProviderCostYuan > 1) {
    return { canConfirm: false, code: "media_cost_budget_blocked", message: "本次图片生成预计费用超过当前受控上限；不会创建任务或预留积分。" };
  }
  if (env.BEAUTY_MEDIA_ASSET_STORAGE !== "local") return { canConfirm: false, code: "media_storage_blocked", message: "租户图片持久存储尚未就绪。" };
  const providerReadiness = getLanqiMediaExecutionReadiness({ kind: "image" });
  if (!providerReadiness.canConfirm || !providerReadiness.billable || providerReadiness.storage !== "local") {
    return { canConfirm: false, code: "media_provider_blocked", message: providerReadiness.blockedReason ?? "真实图片能力尚未就绪；不会创建任务或预留积分。" };
  }
  if (!canStartBeautyImageBatch({ requested, maxPerBatch: 3 })) return { canConfirm: false, code: "quota_exhausted", message: "每个已确认批次最多 3 张，不会创建超额任务。" };
  return { canConfirm: true, message: "确认后将真实生成三张商业摄影感美业场景并预留积分；逐张通过安全与交付质量检查后才可查看下载。" };
}

function estimateBeautyImageProviderCostYuan(imageCount: number): number {
  return (imageCount * BEAUTY_IMAGE_PROVIDER_COST_PER_IMAGE_FEN) / 100;
}

async function submitNextBeautyImageJob(tenantId: string, runId: string, batchKey?: string): Promise<boolean> {
  const jobs = await findRunJobs(tenantId, runId, batchKey);
  const failed = jobs.some((job) => deliveryTerminal(job) && !customerUsable(job));
  if (failed) {
    await prisma.lanqiMediaJob.updateMany({
      where: { id: { in: jobs.filter((job) => job.status === "queued").map((job) => job.id) }, tenantId, previewId: runId, kind: BEAUTY_IMAGE_KIND, status: "queued" },
      data: { status: "failed", assetStatus: "unavailable", errorMessage: "batch_stopped_after_provider_failure", completedAt: new Date() }
    });
    return false;
  }
  if (jobs.some((job) => ["submitted", "processing"].includes(job.status))) return true;
  const nextIndex = jobs.findIndex((job) => job.status === "queued");
  if (nextIndex < 0) return true;
  if (jobs.slice(0, nextIndex).some((job) => !customerUsable(job))) return true;

  const next = jobs[nextIndex]!;
  const claimed = await prisma.lanqiMediaJob.updateMany({
    where: { id: next.id, tenantId, kind: BEAUTY_IMAGE_KIND, status: "queued", providerTaskId: null },
    data: { status: "processing", providerStatus: "SUBMITTING" }
  });
  if (claimed.count !== 1) return true;
  if (next.provider === "local_deterministic") {
    try {
      const role = readBeautyImageRole(next.parameters);
      const taskSnapshotHash = readStringParameter(next.parameters, "deterministicTaskSnapshotHash");
      const theme = readDeterministicTheme(next.parameters);
      if (!taskSnapshotHash || !theme || readStringParameter(next.parameters, "deterministicVisualVersion") !== BEAUTY_DETERMINISTIC_VISUAL_VERSION) {
        throw new Error("beauty_deterministic_visual_contract_invalid");
      }
      const generated = await generateBeautyDeterministicVisual({ role, taskSnapshotHash, theme });
      const metadata = await persistBeautyDeterministicBase({ tenantId, jobId: next.id, bytes: generated.bytes, receipt: generated.receipt });
      const quality = assessBeautyImageQualityForRole(generated.bytes, { contentType: metadata.contentType, role, deterministicReceipt: generated.receipt });
      let composition;
      if (quality.status === "passed") {
        const composed = await composeBeautyCustomerImage({ sourceBytes: generated.bytes, role, overlayText: readStringParameter(next.parameters, "overlayText") ?? "" });
        composition = await persistBeautyCustomerComposite({ tenantId, jobId: next.id, bytes: composed.bytes, receipt: composed.receipt });
      }
      await prisma.lanqiMediaJob.update({ where: { id: next.id }, data: {
        status: "succeeded",
        providerStatus: "LOCAL_SUCCEEDED",
        assetStatus: quality.status === "passed" && composition ? "persisted" : quality.status === "manual_review_required" ? "quality_review_required" : "quality_rejected",
        outputUrl: quality.status === "passed" && composition ? beautyAssetUrl(next.id) : null,
        errorMessage: quality.status === "passed" && composition ? null : quality.status === "manual_review_required" ? "visual_quality_manual_review_required" : "visual_quality_rejected",
        completedAt: new Date(),
        parameters: writeCompositionParameters(writeQualityParameters(writeDeterministicVisualParameters(next.parameters, generated.receipt), quality), composition) as Prisma.InputJsonValue
      } });
      return submitNextBeautyImageJob(tenantId, runId, batchKey);
    } catch (error) {
      const issue = toBeautyMediaAssetPersistenceIssue(error, { code: error instanceof Error ? error.message.slice(0, 160) : "beauty_deterministic_visual_failed", stage: "quality_screen", retryable: false });
      await prisma.lanqiMediaJob.update({ where: { id: next.id }, data: { status: "failed", providerStatus: "LOCAL_FAILED", assetStatus: "unavailable", errorMessage: issue.code, completedAt: new Date(), parameters: writeAssetPersistenceParameters(next.parameters, issue) as Prisma.InputJsonValue } });
      return submitNextBeautyImageJob(tenantId, runId, batchKey);
    }
  }
  try {
    const providerTaskId = await submitLanqiMedia({ kind: "image", prompt: next.prompt, negativePrompt: next.negativePrompt ?? undefined, ratio: "3:4", promptVersion: next.promptVersion, watermark: false }, next.requestKey);
    await prisma.lanqiMediaJob.update({ where: { id: next.id }, data: { status: "submitted", providerTaskId, providerStatus: "PENDING" } });
    return true;
  } catch (error) {
    await prisma.lanqiMediaJob.update({
      where: { id: next.id },
      data: { status: "failed", assetStatus: "unavailable", errorMessage: error instanceof Error ? error.message.slice(0, 400) : "provider_submission_failed", completedAt: new Date() }
    });
    await prisma.lanqiMediaJob.updateMany({
      where: { id: { in: jobs.filter((job) => job.status === "queued").map((job) => job.id) }, tenantId, previewId: runId, kind: BEAUTY_IMAGE_KIND, status: "queued" },
      data: { status: "failed", assetStatus: "unavailable", errorMessage: "batch_stopped_after_provider_failure", completedAt: new Date() }
    });
    return false;
  }
}

async function finalizeBatchIfTerminal(tenantId: string, runId: string, batchKey?: string): Promise<void> {
  const jobs = await findRunJobs(tenantId, runId, batchKey);
  if (!jobs.length || jobs.some((job) => !deliveryTerminal(job))) return;
  const reservationId = readStringParameter(jobs[0]?.parameters, "reservationId");
  if (!reservationId) return;
  const completeQualifiedDelivery = jobs.every((job) => customerUsable(job));
  const reservation = await prisma.creditReservation.findUnique({ where: { id: reservationId }, select: { status: true } });
  if (!reservation) return;
  if (reservation.status === "released" || reservation.status === "compensated") {
    await prisma.lanqiMediaJob.updateMany({ where: { id: { in: jobs.map((job) => job.id) }, tenantId, previewId: runId, kind: BEAUTY_IMAGE_KIND }, data: { billingStatus: "refunded" } });
    return;
  }
  if (!completeQualifiedDelivery) {
    const failureCode = batchBillingFailureCode(jobs);
    if (reservation.status === "settled") await compensateSettledCreditReservation({ reservationId, errorCode: failureCode });
    else await releaseCreditReservation(reservationId, failureCode);
    await prisma.lanqiMediaJob.updateMany({ where: { id: { in: jobs.map((job) => job.id) }, tenantId, previewId: runId, kind: BEAUTY_IMAGE_KIND }, data: { billingStatus: "refunded" } });
    return;
  }
  if (reservation.status === "settled") return;
  await prisma.$transaction(async (tx) => { await settleCreditReservation({ tx, reservationId, actualAmount: jobs.length * env.BEAUTY_MEDIA_IMAGE_CREDITS, agentRunId: runId }); });
  await prisma.lanqiMediaJob.updateMany({ where: { id: { in: jobs.map((job) => job.id) }, tenantId, previewId: runId, kind: BEAUTY_IMAGE_KIND }, data: { billingStatus: "charged" } });
}

function readStringParameter(value: unknown, key: string): string | undefined { return value && typeof value === "object" && !Array.isArray(value) && typeof (value as Record<string, unknown>)[key] === "string" ? String((value as Record<string, unknown>)[key]) : undefined; }
function beautyMediaActionMessage(code: string): string {
  const messages: Record<string, string> = {
    previous_batch_quality_failed: "上一批图片未达到交付标准且积分已释放。请先修改本次图片要求，再重新查看费用并明确确认新批次。",
    previous_batch_succeeded: "当前文字任务已有完整合格图片。需要换一组时，请先修改本次图片要求，再重新查看费用并明确确认新批次。",
    image_requirements_unchanged: "请先修改本次图片的总体视觉要求或禁用内容，再确认新的三图批次；不会自动重复生成。",
    retry_confirmation_ready: "图片要求已更新。再次确认费用和积分后，才会创建一个新的三图批次。",
    regeneration_confirmation_ready: "图片要求已更新。再次确认 300 积分后，才会创建一组新的三图；当前不会自动生成或扣费。",
    batch_in_progress: "当前图片批次仍在生成，请恢复进度；不会创建重复批次或重复扣费。",
    batch_already_succeeded: "当前文字任务已有完整合格图片，可直接查看或下载；不会重复生成。"
  };
  return messages[code] ?? "请刷新图片状态后继续；当前没有创建新任务或扣费。";
}
function beautyImageRequirementsChanged(previousHash: string | undefined, currentHash: string, requirements: BeautyImageRequirements): boolean {
  const hasExplicitRequirements = Boolean(requirements.overallVisualRequirements?.trim() || requirements.prohibitedContent?.trim());
  return hasExplicitRequirements && (!previousHash || previousHash !== currentHash);
}
function beautyImageExecutionContractChanged(parameters: unknown): boolean {
  return readStringParameter(parameters, "qualityDetectorVersion") !== BEAUTY_IMAGE_SAFETY_DETECTOR_VERSION
    || readStringParameter(parameters, "contentRoleContractVersion") !== BEAUTY_IMAGE_CONTENT_ROLE_CONTRACT_VERSION
    || readStringParameter(parameters, "imagePlanVersion") !== "beauty-xhs-image-plan-v2"
    || readStringParameter(parameters, "deliveryMode") !== "real_provider_composed"
    || readStringParameter(parameters, "providerPromptVersion") !== BEAUTY_IMAGE_PROVIDER_PROMPT_VERSION
    || readStringParameter(parameters, "commercialPhotoContractVersion") !== BEAUTY_IMAGE_COMMERCIAL_PHOTO_CONTRACT_VERSION
    || readStringParameter(parameters, "compositionVersion") !== BEAUTY_IMAGE_COMPOSITION_VERSION;
}
function beautyAssetUrl(jobId: string): string { return `/beauty-industry/media/assets/${encodeURIComponent(jobId)}`; }
function terminal(status: string): boolean { return ["succeeded", "failed", "canceled"].includes(status); }
function serializeBatch(jobs: any[]) { const state = batchStatus(jobs); return jobs.map((job) => serialize(job, state)); }
function serialize(job: any, state = "processing") { const status = String(job.status); const quality = qualityStatus(job); const usable = state === "succeeded" && customerUsable(job); const failureCode = readStringParameter(job.parameters, "assetPersistenceCode") ?? (isAssetPersistenceFailure(job.errorMessage) ? String(job.errorMessage) : undefined); const failureStage = readStringParameter(job.parameters, "assetPersistenceStage") ?? (failureCode ? "legacy_unknown" : undefined); return { id: job.id, runId: job.previewId, status, technicalStatus: status, batchStatus: state, providerTaskId: job.providerTaskId ?? undefined, qualityStatus: quality, compositionStatus: readStringParameter(job.parameters, "compositionStatus") ?? "legacy_not_required", compositionVersion: readStringParameter(job.parameters, "compositionVersion"), selectedTitle: readSelectedTitleParameter(job.parameters), operatorQualityStatus: readStringParameter(job.parameters, "operatorQualityStatus") ?? (env.BEAUTY_MEDIA_ACCEPTANCE_OPERATOR_GATE === "true" ? "pending" : "not_required"), qualityReasons: readQualityReasons(job), qualityEvidence: readQualityEvidence(job), customerUsable: usable, progress: status === "succeeded" ? 100 : status === "processing" ? 60 : status === "submitted" ? 25 : 0, creditCost: job.creditCost, billingStatus: job.billingStatus, assetStatus: job.assetStatus, outputUrl: usable ? (job.outputUrl ?? beautyAssetUrl(job.id)) : undefined, errorMessage: quality === "rejected" || readStringParameter(job.parameters, "operatorQualityStatus") === "rejected" ? "图片未达到交付标准，不建议使用；原始资产仅保留供内部审核。" : quality === "manual_review_required" ? "本地风险筛查证据不足，需要人工复核；当前不可查看或下载。" : failureCode ? assetPersistenceCustomerMessage(failureStage) : job.errorMessage ? "图片任务未完成；不会自动重试，未交付部分会释放预留积分。" : undefined, failureStage, failureCode, failureRetryable: readBooleanParameter(job.parameters, "assetPersistenceRetryable") ?? false, canCancel: ["queued", "submitted"].includes(status), canRecover: false, createdAt: job.createdAt instanceof Date ? job.createdAt.toISOString() : job.createdAt, updatedAt: job.updatedAt instanceof Date ? job.updatedAt.toISOString() : job.updatedAt, model: job.model, provider: job.provider }; }

async function persistAndScreenBeautyImage(params: { tenantId: string; jobId: string; sourceUrl: string; role: BeautyImageRole; overlayText: string }) {
  const metadata = await persistBeautyProviderImage(params);
  let asset;
  try {
    asset = await readBeautyProviderMediaAsset({ tenantId: params.tenantId, jobId: params.jobId });
  } catch {
    throw createBeautyMediaAssetPersistenceError({ code: "beauty_media_asset_verify_failed", stage: "asset_verify", retryable: false });
  }
  try {
    const quality = assessBeautyImageQualityForRole(asset.bytes, { contentType: metadata.contentType, role: params.role });
    if (quality.status !== "passed") return { quality, composition: undefined };
    const composed = await composeBeautyCustomerImage({ sourceBytes: asset.bytes, role: params.role, overlayText: params.overlayText });
    const composition = await persistBeautyCustomerComposite({ tenantId: params.tenantId, jobId: params.jobId, bytes: composed.bytes, receipt: composed.receipt });
    return { quality, composition };
  } catch {
    throw createBeautyMediaAssetPersistenceError({ code: "beauty_media_quality_or_composition_failed", stage: "quality_screen", retryable: false });
  }
}

function writeAssetPersistenceParameters(value: unknown, issue: BeautyMediaAssetPersistenceIssue) {
  const current = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    ...current,
    assetPersistenceStage: issue.stage,
    assetPersistenceCode: issue.code,
    assetPersistenceRetryable: issue.retryable,
    ...(issue.httpStatus === undefined ? {} : { assetPersistenceHttpStatus: issue.httpStatus })
  };
}

function assetPersistenceCustomerMessage(stage?: string): string {
  if (stage === "quality_screen") return "图片已生成并安全保存，但本地质量检查未完成；当前不可交付，积分已退回，无需重复点击。";
  if (stage === "asset_verify") return "图片已生成，但本地文件校验未完成；当前不可交付，积分已退回，无需重复点击。";
  if (stage === "download_request" || stage === "download_response" || stage === "url_validation") return "图片已生成，但安全下载未完成；当前不可交付，积分已退回，无需重复点击。";
  return "图片已生成，但本地保存未完成；当前不可交付，积分已退回，无需重复点击。";
}

function isAssetPersistenceFailure(value: unknown): boolean {
  return typeof value === "string" && (value === "asset_persistence_failed" || value.startsWith("beauty_media_asset_") || value === "beauty_media_quality_screen_failed");
}

function batchBillingFailureCode(jobs: any[]): string {
  if (jobs.some((job) => isAssetPersistenceFailure(job.errorMessage))) return "beauty_media_asset_persistence_failed";
  if (jobs.some((job) => job.errorMessage === "visual_quality_rejected" || job.errorMessage === "visual_quality_manual_review_required" || job.errorMessage === "visual_quality_operator_rejected")) return "beauty_media_visual_quality_failed";
  if (jobs.some((job) => job.status === "canceled")) return "beauty_media_batch_canceled";
  return "beauty_media_provider_failed";
}

async function auditPendingImageQuality(tenantId: string, runId: string, jobs: any[]): Promise<void> {
  for (const job of jobs) {
    if (job.status !== "succeeded" || job.assetStatus !== "persisted" || qualityStatus(job) !== "pending_review") continue;
    try {
      const asset = await readBeautyProviderMediaAsset({ tenantId, jobId: job.id });
      const quality = assessBeautyImageQualityForRole(asset.bytes, { contentType: asset.metadata.contentType, role: readBeautyImageRole(job.parameters), ...(asset.metadata.deterministicVisual ? { deterministicReceipt: asset.metadata.deterministicVisual } : {}) });
      let composition;
      if (quality.status === "passed" && readBooleanParameter(job.parameters, "compositionRequired") === true) {
        const composed = await composeBeautyCustomerImage({ sourceBytes: asset.bytes, role: readBeautyImageRole(job.parameters), overlayText: readStringParameter(job.parameters, "overlayText") ?? "" });
        composition = await persistBeautyCustomerComposite({ tenantId, jobId: job.id, bytes: composed.bytes, receipt: composed.receipt });
      }
      await prisma.lanqiMediaJob.update({ where: { id: job.id }, data: {
        assetStatus: quality.status === "passed" && (!readBooleanParameter(job.parameters, "compositionRequired") || composition) ? "persisted" : quality.status === "manual_review_required" ? "quality_review_required" : "quality_rejected",
        outputUrl: quality.status === "passed" && (!readBooleanParameter(job.parameters, "compositionRequired") || composition) ? beautyAssetUrl(job.id) : null,
        errorMessage: quality.status === "passed" && (!readBooleanParameter(job.parameters, "compositionRequired") || composition) ? null : quality.status === "manual_review_required" ? "visual_quality_manual_review_required" : "visual_quality_rejected",
        parameters: writeCompositionParameters(writeQualityParameters(job.parameters, quality), composition) as Prisma.InputJsonValue
      } });
    } catch {
      await prisma.lanqiMediaJob.update({ where: { id: job.id }, data: {
        assetStatus: "quality_rejected", outputUrl: null, errorMessage: "visual_quality_rejected",
        parameters: writeQualityParameters(job.parameters, { status: "rejected", reasons: ["image_decode_failed"], evidence: [{ detectorType: "decode", reason: "image_decode_failed", decision: "rejected", confidence: 1, bbox: { x: 0, y: 0, width: 0, height: 0 }, metrics: { deterministicFailure: true } }], detectorVersion: BEAUTY_IMAGE_SAFETY_DETECTOR_VERSION, boundary: "deterministic_risk_screen_only" }) as Prisma.InputJsonValue
      } });
    }
  }
}

function qualityStatus(job: any): "pending_review" | "passed" | "rejected" | "manual_review_required" {
  const value = readStringParameter(job.parameters, "qualityStatus");
  return value === "passed" || value === "rejected" || value === "manual_review_required" ? value : "pending_review";
}
function readQualityReasons(job: any): string[] { const value = job.parameters && typeof job.parameters === "object" && !Array.isArray(job.parameters) ? (job.parameters as Record<string, unknown>).qualityReasons : undefined; return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []; }
function readQualityEvidence(job: any): BeautyImageSafetyEvidence[] { const value = job.parameters && typeof job.parameters === "object" && !Array.isArray(job.parameters) ? (job.parameters as Record<string, unknown>).qualityEvidence : undefined; return Array.isArray(value) ? value.filter((item): item is BeautyImageSafetyEvidence => Boolean(item && typeof item === "object" && !Array.isArray(item) && typeof (item as Record<string, unknown>).detectorType === "string" && typeof (item as Record<string, unknown>).confidence === "number")) : []; }
function writeQualityParameters(value: unknown, quality: { status: "passed" | "rejected" | "manual_review_required"; reasons: readonly string[]; evidence: readonly BeautyImageSafetyEvidence[]; detectorVersion: string; boundary: string; sha256?: string; width?: number; height?: number }) { const current = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; return { ...current, qualityStatus: quality.status, qualityReasons: [...quality.reasons], qualityEvidence: quality.evidence.map((item) => ({ detectorType: item.detectorType, reason: item.reason, decision: item.decision, confidence: item.confidence, bbox: item.bbox, metrics: item.metrics, decodedTextHash: item.decodedTextHash })), qualityDetectorVersion: quality.detectorVersion, qualityBoundary: quality.boundary, qualitySha256: quality.sha256, qualityWidth: quality.width, qualityHeight: quality.height, qualityCheckedAt: new Date().toISOString() }; }
function writeCompositionParameters(value: unknown, receipt?: { compositionVersion: string; overlayTextHash: string; sha256: string; width: number; height: number; bytes: number; fontSize: number; lineHeight: number; lineCount: number; maxLines: number; horizontalPadding: number }) { const current = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; return receipt ? { ...current, compositionStatus: "completed", compositionVersion: receipt.compositionVersion, compositionOverlayTextHash: receipt.overlayTextHash, compositionSha256: receipt.sha256, compositionWidth: receipt.width, compositionHeight: receipt.height, compositionBytes: receipt.bytes, compositionFontSize: receipt.fontSize, compositionLineHeight: receipt.lineHeight, compositionLineCount: receipt.lineCount, compositionMaxLines: receipt.maxLines, compositionHorizontalPadding: receipt.horizontalPadding, compositionCompletedAt: new Date().toISOString() } : { ...current, compositionStatus: "not_created" }; }
function writeDeterministicVisualParameters(value: unknown, receipt: BeautyDeterministicVisualReceiptContract) { const current = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; return { ...current, deterministicVisualVersion: receipt.version, deterministicVisualSource: receipt.source, deterministicVisualLayout: receipt.layout, deterministicVisualScenePolicy: receipt.scenePolicy, deterministicVisualScene: receipt.scene, deterministicVisualSha256: receipt.sha256, deterministicVisualPaletteHash: receipt.paletteHash, deterministicVisualWidth: receipt.width, deterministicVisualHeight: receipt.height, deterministicVisualShapeCount: receipt.shapeCount, deterministicVisualElementCount: receipt.elementCount, providerCallsActual: 0, externalCostYuanActual: 0 }; }
function writeOperatorQualityParameters(value: unknown, decision: "approved" | "rejected", reviewedAt: string) { const current = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; return { ...current, operatorQualityStatus: decision, operatorQualityReviewedAt: reviewedAt, operatorQualityBoundary: "isolated_acceptance_human_usability_only" }; }
function readNumericParameter(value: unknown, key: string): number | undefined { if (!value || typeof value !== "object" || Array.isArray(value)) return undefined; const candidate = (value as Record<string, unknown>)[key]; return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : undefined; }
function readBooleanParameter(value: unknown, key: string): boolean | undefined { if (!value || typeof value !== "object" || Array.isArray(value)) return undefined; const candidate = (value as Record<string, unknown>)[key]; return typeof candidate === "boolean" ? candidate : undefined; }
function readSelectedTitleParameter(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const imageRequirements = (value as Record<string, unknown>).imageRequirements;
  if (!imageRequirements || typeof imageRequirements !== "object" || Array.isArray(imageRequirements)) return undefined;
  const selectedTitle = (imageRequirements as Record<string, unknown>).selectedTitle;
  return typeof selectedTitle === "string" && selectedTitle.trim() ? selectedTitle.trim() : undefined;
}
function readDeterministicTheme(value: unknown): BeautyDeterministicVisualTheme | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const theme = (value as Record<string, unknown>).deterministicTheme;
  if (!theme || typeof theme !== "object" || Array.isArray(theme)) return undefined;
  const record = theme as Record<string, unknown>;
  const keys = ["configVersion", "tokenName", "primary", "primaryDark", "primaryLight", "surface"] as const;
  if (keys.some((key) => typeof record[key] !== "string" || !String(record[key]).trim())) return undefined;
  return Object.fromEntries(keys.map((key) => [key, String(record[key])])) as BeautyDeterministicVisualTheme;
}
function requiresOperatorQuality(job: any): boolean {
  return job.provider !== "local_deterministic" && env.BEAUTY_MEDIA_ACCEPTANCE_OPERATOR_GATE === "true";
}
function customerUsable(job: any): boolean { const compositionRequired = readBooleanParameter(job.parameters, "compositionRequired") === true; const compositionReady = !compositionRequired || readStringParameter(job.parameters, "compositionStatus") === "completed"; return job.status === "succeeded" && job.assetStatus === "persisted" && qualityStatus(job) === "passed" && compositionReady && (!requiresOperatorQuality(job) || readStringParameter(job.parameters, "operatorQualityStatus") === "approved"); }
function readBeautyImageRole(value: unknown): BeautyImageRole { const role = readStringParameter(value, "role"); if (role === "cover" || role === "content" || role === "engagement") return role; throw new Error("beauty_image_role_invalid"); }
function deliveryTerminal(job: any): boolean { if (!terminal(String(job.status))) return false; return !(requiresOperatorQuality(job) && job.status === "succeeded" && job.assetStatus === "persisted" && qualityStatus(job) === "passed" && readStringParameter(job.parameters, "operatorQualityStatus") !== "approved" && readStringParameter(job.parameters, "operatorQualityStatus") !== "rejected"); }
function batchStatus(jobs: any[]): "processing" | "succeeded" | "quality_failed" { if (!jobs.length || jobs.some((job) => !deliveryTerminal(job))) return "processing"; return jobs.every((job) => customerUsable(job)) ? "succeeded" : "quality_failed"; }

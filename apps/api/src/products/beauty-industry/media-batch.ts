import { createHash } from "node:crypto";

export type BeautyImageRequirements = {
  overallVisualRequirements?: string;
  prohibitedContent?: string;
  selectedTitle?: string;
};

export type BeautyDeterministicSceneReadiness =
  | { ok: true; scenePolicy: "generic_beauty_store_non_reference" }
  | { ok: false; code: "beauty_scene_reference_required"; message: string };

export function assessBeautyDeterministicSceneRequirements(requirements: BeautyImageRequirements): BeautyDeterministicSceneReadiness {
  const visual = normalize(requirements.overallVisualRequirements);
  const requestsRealStore = /(?:本店实景|真实门店|我的门店|还原(?:本店|门店)|按照(?:本店|门店))/u.test(visual);
  const requestsPeople = /(?:有人物|人物出镜|真人|顾客出镜|美容师出镜|店员出镜|模特|正脸)/u.test(visual);
  if (requestsRealStore || requestsPeople) {
    return {
      ok: false,
      code: "beauty_scene_reference_required",
      message: requestsRealStore
        ? "还原本店实景需要上传已授权的门店参考照片；当前只能生成明确标注为非本店实景的通用美业门店场景。"
        : "人物场景需要已授权的人物参考与肖像许可；当前通用美业门店场景默认不含人物。"
    };
  }
  return { ok: true, scenePolicy: "generic_beauty_store_non_reference" };
}

type BatchJob = {
  id: string;
  createdAt: Date | string;
  parameters: unknown;
};

export const LEGACY_BEAUTY_IMAGE_BATCH_KEY = "legacy";

export function readBeautyImageBatchKey(job: Pick<BatchJob, "parameters">): string {
  if (job.parameters && typeof job.parameters === "object" && !Array.isArray(job.parameters)) {
    const value = (job.parameters as Record<string, unknown>).batchRequestId;
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return LEGACY_BEAUTY_IMAGE_BATCH_KEY;
}

export function selectBeautyImageBatch<T extends BatchJob>(jobs: readonly T[], batchKey: string): T[] {
  return jobs
    .filter((job) => readBeautyImageBatchKey(job) === batchKey)
    .sort((left, right) => {
      const leftIndex = readBatchIndex(left.parameters);
      const rightIndex = readBatchIndex(right.parameters);
      if (leftIndex !== undefined && rightIndex !== undefined && leftIndex !== rightIndex) return leftIndex - rightIndex;
      return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime() || left.id.localeCompare(right.id);
    });
}

export function selectLatestBeautyImageBatch<T extends BatchJob>(jobs: readonly T[]): T[] {
  if (!jobs.length) return [];
  let latestKey = readBeautyImageBatchKey(jobs[0]!);
  let latestAt = Number.NEGATIVE_INFINITY;
  for (const job of jobs) {
    const timestamp = new Date(job.createdAt).getTime();
    if (timestamp >= latestAt) {
      latestAt = timestamp;
      latestKey = readBeautyImageBatchKey(job);
    }
  }
  return selectBeautyImageBatch(jobs, latestKey);
}

export function canStartBeautyImageBatch(input: { requested: number; maxPerBatch: number; historicalJobCount?: number }): boolean {
  return Number.isInteger(input.requested) && input.requested > 0 && input.requested <= input.maxPerBatch;
}

export function buildBeautyImageRequirementsHash(requirements: BeautyImageRequirements): string {
  const normalized = {
    overallVisualRequirements: normalize(requirements.overallVisualRequirements),
    prohibitedContent: normalize(requirements.prohibitedContent),
    selectedTitle: normalize(requirements.selectedTitle)
  };
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

export function evaluateBeautyMediaBatchAction(input: {
  latestBatchStatus?: "processing" | "succeeded" | "quality_failed";
  retryRequested: boolean;
  requirementsChanged: boolean;
  executionContractChanged?: boolean;
}): { canConfirm: boolean; retryEligible: boolean; code: string } {
  if (!input.latestBatchStatus) return { canConfirm: true, retryEligible: false, code: "initial_confirmation_ready" };
  if (input.latestBatchStatus === "processing") return { canConfirm: false, retryEligible: false, code: "batch_in_progress" };
  if (input.latestBatchStatus === "succeeded") {
    if (!input.retryRequested) return { canConfirm: false, retryEligible: true, code: "previous_batch_succeeded" };
    if (!input.requirementsChanged) return { canConfirm: false, retryEligible: true, code: "image_requirements_unchanged" };
    return { canConfirm: true, retryEligible: true, code: "regeneration_confirmation_ready" };
  }
  if (!input.retryRequested) return { canConfirm: false, retryEligible: true, code: "previous_batch_quality_failed" };
  if (!input.requirementsChanged && !input.executionContractChanged) return { canConfirm: false, retryEligible: true, code: "image_requirements_unchanged" };
  return { canConfirm: true, retryEligible: true, code: "retry_confirmation_ready" };
}

function normalize(value: string | undefined): string {
  return (value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ");
}

function readBatchIndex(parameters: unknown): number | undefined {
  if (!parameters || typeof parameters !== "object" || Array.isArray(parameters)) return undefined;
  const value = (parameters as Record<string, unknown>).batchIndex;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

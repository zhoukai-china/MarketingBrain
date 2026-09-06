import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { env, domesticOutboundAllowlist } from "../config/env.js";
import { validateBeautyProviderAssetUrl } from "./beauty-provider-asset-policy.js";
import type { BeautyDeterministicVisualReceiptContract } from "../products/beauty-industry/media-contract.js";

const maxImageBytes = 20 * 1024 * 1024;
const maxAssetRedirects = 2;

export type BeautyMediaAssetMetadata = {
  jobId: string;
  tenantKey: string;
  productCode: "beauty-industry";
  contentType: "image/png" | "image/jpeg" | "image/webp";
  bytes: number;
  createdAt: string;
  retention: "tenant_owned";
  source: "provider" | "deterministic";
  deterministicVisual?: BeautyDeterministicVisualReceiptContract;
  customerComposite?: {
    contentType: "image/png";
    bytes: number;
    sha256: string;
    createdAt: string;
    compositionVersion: string;
    overlayTextHash: string;
    width: number;
    height: number;
    fontSize: number;
    lineHeight: number;
    lineCount: number;
    maxLines: number;
    horizontalPadding: number;
  };
};

export type BeautyMediaAssetPersistenceStage =
  | "storage_preflight"
  | "url_validation"
  | "download_request"
  | "download_response"
  | "content_type"
  | "payload_size"
  | "path_resolution"
  | "directory_prepare"
  | "image_write"
  | "metadata_write"
  | "image_commit"
  | "metadata_commit"
  | "asset_verify"
  | "quality_screen";

export type BeautyMediaCompositeReceipt = NonNullable<BeautyMediaAssetMetadata["customerComposite"]>;

export type BeautyMediaAssetPersistenceIssue = {
  code: string;
  stage: BeautyMediaAssetPersistenceStage;
  retryable: boolean;
  httpStatus?: number;
};

export class BeautyMediaAssetPersistenceError extends Error {
  readonly issue: BeautyMediaAssetPersistenceIssue;

  constructor(issue: BeautyMediaAssetPersistenceIssue) {
    super(issue.code);
    this.name = "BeautyMediaAssetPersistenceError";
    this.issue = Object.freeze({ ...issue });
  }
}

export type BeautyMediaAssetPersistenceDependencies = {
  validateSourceUrl: (sourceUrl: string) => void;
  fetchImpl: typeof fetch;
  createTimeoutSignal: () => AbortSignal;
  mkdirImpl: typeof mkdir;
  writeFileImpl: typeof writeFile;
  renameImpl: typeof rename;
  removeImpl: typeof rm;
  now: () => Date;
};

const defaultDependencies: BeautyMediaAssetPersistenceDependencies = {
  validateSourceUrl: (sourceUrl) => { validateBeautyProviderAssetUrl(sourceUrl, domesticOutboundAllowlist); },
  fetchImpl: fetch,
  createTimeoutSignal: () => AbortSignal.timeout(60_000),
  mkdirImpl: mkdir,
  writeFileImpl: writeFile,
  renameImpl: rename,
  removeImpl: rm,
  now: () => new Date()
};

export async function persistBeautyProviderImage(
  params: { tenantId: string; jobId: string; sourceUrl: string },
  dependencyOverrides: Partial<BeautyMediaAssetPersistenceDependencies> = {}
): Promise<BeautyMediaAssetMetadata> {
  const dependencies = { ...defaultDependencies, ...dependencyOverrides };
  if (env.BEAUTY_MEDIA_ASSET_STORAGE !== "local") {
    throw persistenceError("storage_preflight", "beauty_media_asset_storage_not_ready", false);
  }

  try {
    dependencies.validateSourceUrl(params.sourceUrl);
  } catch {
    throw persistenceError("url_validation", "beauty_media_asset_url_rejected", false);
  }

  const response = await fetchBeautyProviderAsset(params.sourceUrl, dependencies);
  if (!response.ok) {
    throw persistenceError("download_response", `beauty_media_asset_download_http_${response.status}`, response.status === 429 || response.status >= 500, response.status);
  }

  const contentType = normalizeImageContentType(response.headers.get("content-type"));
  if (!contentType) throw persistenceError("content_type", "beauty_media_asset_invalid_content_type", false);

  let bytes: Buffer;
  try {
    bytes = Buffer.from(await response.arrayBuffer());
  } catch {
    throw persistenceError("download_response", "beauty_media_asset_download_body_failed", true);
  }
  if (bytes.length === 0 || bytes.length > maxImageBytes) {
    throw persistenceError("payload_size", "beauty_media_asset_invalid_size", false);
  }

  let base: string;
  try {
    base = assetBase(params.tenantId, params.jobId);
  } catch {
    throw persistenceError("path_resolution", "beauty_media_asset_path_rejected", false);
  }

  const finalPath = `${base}${extensionFor(contentType)}`;
  const metadataPath = `${base}.json`;
  const nonce = `${process.pid}.${createHash("sha256").update(`${params.jobId}:${dependencies.now().toISOString()}`).digest("hex").slice(0, 12)}`;
  const temporaryPath = `${finalPath}.${nonce}.tmp`;
  const temporaryMetadataPath = `${metadataPath}.${nonce}.tmp`;
  let imageCommitted = false;
  let metadataCommitted = false;
  const metadata: BeautyMediaAssetMetadata = {
    jobId: params.jobId,
    tenantKey: tenantKey(params.tenantId),
    productCode: "beauty-industry",
    contentType,
    bytes: bytes.length,
    createdAt: dependencies.now().toISOString(),
    retention: "tenant_owned",
    source: "provider"
  };

  try {
    await runPersistenceStage("directory_prepare", "beauty_media_asset_directory_prepare_failed", true, () => dependencies.mkdirImpl(path.dirname(base), { recursive: true }));
    await runPersistenceStage("image_write", "beauty_media_asset_image_write_failed", true, () => dependencies.writeFileImpl(temporaryPath, bytes));
    await runPersistenceStage("metadata_write", "beauty_media_asset_metadata_write_failed", true, () => dependencies.writeFileImpl(temporaryMetadataPath, JSON.stringify(metadata, null, 2), "utf8"));
    await runPersistenceStage("image_commit", "beauty_media_asset_image_commit_failed", true, async () => {
      await dependencies.renameImpl(temporaryPath, finalPath);
      imageCommitted = true;
    });
    await runPersistenceStage("metadata_commit", "beauty_media_asset_metadata_commit_failed", true, async () => {
      await dependencies.renameImpl(temporaryMetadataPath, metadataPath);
      metadataCommitted = true;
    });
    return metadata;
  } catch (error) {
    await bestEffortRemove(dependencies, temporaryPath);
    await bestEffortRemove(dependencies, temporaryMetadataPath);
    if (imageCommitted && !metadataCommitted) await bestEffortRemove(dependencies, finalPath);
    throw error;
  }
}

export async function persistBeautyDeterministicBase(params: {
  tenantId: string;
  jobId: string;
  bytes: Buffer;
  receipt: BeautyDeterministicVisualReceiptContract;
}): Promise<BeautyMediaAssetMetadata> {
  if (env.BEAUTY_MEDIA_ASSET_STORAGE !== "local") throw persistenceError("storage_preflight", "beauty_media_asset_storage_not_ready", false);
  if (!params.bytes.length || params.bytes.length > maxImageBytes) throw persistenceError("payload_size", "beauty_media_asset_invalid_size", false);
  const actualSha = createHash("sha256").update(params.bytes).digest("hex");
  if (params.receipt.contentType !== "image/png" || params.receipt.width !== 768 || params.receipt.height !== 1024 || params.receipt.sha256 !== actualSha) {
    throw persistenceError("asset_verify", "beauty_media_deterministic_receipt_invalid", false);
  }
  let base: string;
  try { base = assetBase(params.tenantId, params.jobId); }
  catch { throw persistenceError("path_resolution", "beauty_media_asset_path_rejected", false); }
  const createdAt = new Date().toISOString();
  const metadata: BeautyMediaAssetMetadata = {
    jobId: params.jobId,
    tenantKey: tenantKey(params.tenantId),
    productCode: "beauty-industry",
    contentType: "image/png",
    bytes: params.bytes.length,
    createdAt,
    retention: "tenant_owned",
    source: "deterministic",
    deterministicVisual: params.receipt
  };
  const finalPath = `${base}.png`;
  const metadataPath = `${base}.json`;
  const nonce = `${process.pid}.${createHash("sha256").update(`${params.jobId}:${createdAt}:deterministic`).digest("hex").slice(0, 12)}`;
  const temporaryPath = `${finalPath}.${nonce}.tmp`;
  const temporaryMetadataPath = `${metadataPath}.${nonce}.tmp`;
  let imageCommitted = false;
  let metadataCommitted = false;
  try {
    await mkdir(path.dirname(base), { recursive: true });
    await writeFile(temporaryPath, params.bytes);
    await writeFile(temporaryMetadataPath, JSON.stringify(metadata, null, 2), "utf8");
    await rename(temporaryPath, finalPath);
    imageCommitted = true;
    await rename(temporaryMetadataPath, metadataPath);
    metadataCommitted = true;
    return metadata;
  } catch {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    await rm(temporaryMetadataPath, { force: true }).catch(() => undefined);
    if (imageCommitted && !metadataCommitted) await rm(finalPath, { force: true }).catch(() => undefined);
    throw persistenceError("image_commit", "beauty_media_deterministic_commit_failed", true);
  }
}

export async function readBeautyMediaAsset(params: { tenantId: string; jobId: string }): Promise<{ metadata: BeautyMediaAssetMetadata; bytes: Buffer }> {
  const base = assetBase(params.tenantId, params.jobId);
  const metadata = JSON.parse(await readFile(`${base}.json`, "utf8")) as BeautyMediaAssetMetadata;
  if (metadata.productCode !== "beauty-industry" || metadata.tenantKey !== tenantKey(params.tenantId) || metadata.jobId !== params.jobId) throw new Error("beauty_media_asset_owner_mismatch");
  const assetPath = metadata.customerComposite ? `${base}.final.png` : `${base}${extensionFor(metadata.contentType)}`;
  return { metadata, bytes: await readFile(assetPath) };
}

export async function readBeautyProviderMediaAsset(params: { tenantId: string; jobId: string }): Promise<{ metadata: BeautyMediaAssetMetadata; bytes: Buffer }> {
  const base = assetBase(params.tenantId, params.jobId);
  const metadata = JSON.parse(await readFile(`${base}.json`, "utf8")) as BeautyMediaAssetMetadata;
  if (metadata.productCode !== "beauty-industry" || metadata.tenantKey !== tenantKey(params.tenantId) || metadata.jobId !== params.jobId) throw new Error("beauty_media_asset_owner_mismatch");
  return { metadata, bytes: await readFile(`${base}${extensionFor(metadata.contentType)}`) };
}

export async function persistBeautyCustomerComposite(params: {
  tenantId: string;
  jobId: string;
  bytes: Buffer;
  receipt: {
    version: string;
    overlayTextHash: string;
    finalSha256: string;
    width: number;
    height: number;
    fontSize: number;
    lineHeight: number;
    lineCount: number;
    maxLines: number;
    horizontalPadding: number;
  };
}): Promise<BeautyMediaCompositeReceipt> {
  if (env.BEAUTY_MEDIA_ASSET_STORAGE !== "local") throw persistenceError("storage_preflight", "beauty_media_asset_storage_not_ready", false);
  if (!params.bytes.length || params.bytes.length > maxImageBytes) throw persistenceError("payload_size", "beauty_media_composite_invalid_size", false);
  const actualSha = createHash("sha256").update(params.bytes).digest("hex");
  if (actualSha !== params.receipt.finalSha256) throw persistenceError("asset_verify", "beauty_media_composite_hash_mismatch", false);
  const base = assetBase(params.tenantId, params.jobId);
  const metadataPath = `${base}.json`;
  const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as BeautyMediaAssetMetadata;
  if (metadata.productCode !== "beauty-industry" || metadata.tenantKey !== tenantKey(params.tenantId) || metadata.jobId !== params.jobId) throw persistenceError("path_resolution", "beauty_media_asset_owner_mismatch", false);
  const createdAt = new Date().toISOString();
  const customerComposite: BeautyMediaCompositeReceipt = {
    contentType: "image/png",
    bytes: params.bytes.length,
    sha256: actualSha,
    createdAt,
    compositionVersion: params.receipt.version,
    overlayTextHash: params.receipt.overlayTextHash,
    width: params.receipt.width,
    height: params.receipt.height,
    fontSize: params.receipt.fontSize,
    lineHeight: params.receipt.lineHeight,
    lineCount: params.receipt.lineCount,
    maxLines: params.receipt.maxLines,
    horizontalPadding: params.receipt.horizontalPadding
  };
  const nonce = `${process.pid}.${createHash("sha256").update(`${params.jobId}:${createdAt}:composite`).digest("hex").slice(0, 12)}`;
  const finalPath = `${base}.final.png`;
  const tempPath = `${finalPath}.${nonce}.tmp`;
  const tempMetadataPath = `${metadataPath}.${nonce}.tmp`;
  let imageCommitted = false;
  try {
    await writeFile(tempPath, params.bytes);
    await writeFile(tempMetadataPath, JSON.stringify({ ...metadata, customerComposite }, null, 2), "utf8");
    await rename(tempPath, finalPath);
    imageCommitted = true;
    await rename(tempMetadataPath, metadataPath);
    return customerComposite;
  } catch {
    await rm(tempPath, { force: true }).catch(() => undefined);
    await rm(tempMetadataPath, { force: true }).catch(() => undefined);
    if (imageCommitted) await rm(finalPath, { force: true }).catch(() => undefined);
    throw persistenceError("image_commit", "beauty_media_composite_commit_failed", true);
  }
}

async function fetchBeautyProviderAsset(
  sourceUrl: string,
  dependencies: BeautyMediaAssetPersistenceDependencies
): Promise<Response> {
  let currentUrl = sourceUrl;
  for (let redirectCount = 0; redirectCount <= maxAssetRedirects; redirectCount += 1) {
    let response: Response;
    try {
      response = await dependencies.fetchImpl(currentUrl, {
        signal: dependencies.createTimeoutSignal(),
        redirect: "manual"
      });
    } catch {
      throw persistenceError("download_request", "beauty_media_asset_download_request_failed", true);
    }

    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    if (redirectCount >= maxAssetRedirects) {
      throw persistenceError("url_validation", "beauty_media_asset_redirect_limit_exceeded", false);
    }

    const location = response.headers.get("location");
    if (!location) throw persistenceError("url_validation", "beauty_media_asset_redirect_rejected", false);
    try {
      const redirectedUrl = new URL(location, currentUrl).toString();
      dependencies.validateSourceUrl(redirectedUrl);
      currentUrl = redirectedUrl;
    } catch {
      throw persistenceError("url_validation", "beauty_media_asset_redirect_rejected", false);
    }
  }
  throw persistenceError("url_validation", "beauty_media_asset_redirect_limit_exceeded", false);
}

export function toBeautyMediaAssetPersistenceIssue(
  error: unknown,
  fallback: BeautyMediaAssetPersistenceIssue = { code: "beauty_media_asset_persistence_failed", stage: "asset_verify", retryable: false }
): BeautyMediaAssetPersistenceIssue {
  return error instanceof BeautyMediaAssetPersistenceError ? error.issue : Object.freeze({ ...fallback });
}

export function createBeautyMediaAssetPersistenceError(issue: BeautyMediaAssetPersistenceIssue): BeautyMediaAssetPersistenceError {
  return new BeautyMediaAssetPersistenceError(issue);
}

function assetBase(tenantId: string, jobId: string): string {
  if (!/^[A-Za-z0-9_-]{8,120}$/.test(jobId)) throw new Error("invalid_beauty_media_job_id");
  const root = path.resolve(env.UPLOAD_DIR, "beauty-industry-media");
  const tenantRoot = path.resolve(root, tenantKey(tenantId));
  const resolved = path.resolve(tenantRoot, jobId);
  if (!resolved.startsWith(`${tenantRoot}${path.sep}`)) throw new Error("invalid_beauty_media_asset_path");
  return resolved;
}

function persistenceError(stage: BeautyMediaAssetPersistenceStage, code: string, retryable: boolean, httpStatus?: number): BeautyMediaAssetPersistenceError {
  return new BeautyMediaAssetPersistenceError({ stage, code, retryable, ...(httpStatus === undefined ? {} : { httpStatus }) });
}

async function runPersistenceStage<T>(stage: BeautyMediaAssetPersistenceStage, code: string, retryable: boolean, operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof BeautyMediaAssetPersistenceError) throw error;
    throw persistenceError(stage, code, retryable);
  }
}

async function bestEffortRemove(dependencies: BeautyMediaAssetPersistenceDependencies, targetPath: string): Promise<void> {
  try { await dependencies.removeImpl(targetPath, { force: true }); }
  catch { /* cleanup evidence must not replace the primary bounded stage error */ }
}

function tenantKey(tenantId: string): string { return createHash("sha256").update(tenantId).digest("hex").slice(0, 24); }
function normalizeImageContentType(value: string | null): BeautyMediaAssetMetadata["contentType"] | undefined {
  const normalized = value?.split(";")[0]?.trim().toLowerCase();
  return normalized === "image/png" || normalized === "image/jpeg" || normalized === "image/webp" ? normalized : undefined;
}
function extensionFor(contentType: BeautyMediaAssetMetadata["contentType"]): string { return contentType === "image/jpeg" ? ".jpg" : contentType === "image/webp" ? ".webp" : ".png"; }

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { env, domesticNetworkOnly, domesticOutboundAllowlist } from "../config/env.js";
import { assertOutboundUrlAllowed } from "./outbound-policy.js";

const maxImageBytes = 20 * 1024 * 1024;
/** 3 秒 720P 无声成片实际约 1–3MB；上限留足余量，同时防止超大响应落盘。 */
const maxVideoBytes = 120 * 1024 * 1024;

export type LanqiMediaAssetMetadata = {
  jobId: string;
  tenantKey: string;
  contentType: "image/png" | "image/jpeg" | "image/webp" | "image/svg+xml" | "video/mp4";
  bytes: number;
  createdAt: string;
  selectedAt?: string;
  savedAt?: string;
  retention: "tenant_owned";
  source: "provider" | "controlled_mock" | "composed";
  /** 仅合成成片（LQ-32）使用：这条成片是否带音轨、由几镜拼成、用了哪种音轨来源。 */
  composed?: {
    shotCount: number;
    audioIncluded: boolean;
    audioSource?: "audio_file" | "video_audio_track";
    durationSeconds: number;
    requestKey: string;
  };
};

export async function persistLanqiProviderImage(params: { tenantId: string; jobId: string; sourceUrl: string }): Promise<LanqiMediaAssetMetadata> {
  if (env.LANQI_MEDIA_ASSET_STORAGE !== "local") throw new Error("media_asset_storage_not_ready");
  assertOutboundUrlAllowed("Lanqi generated image", params.sourceUrl, { domesticNetworkOnly, allowedHosts: domesticOutboundAllowlist });
  const response = await fetch(params.sourceUrl, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`media_asset_download_${response.status}`);
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > maxImageBytes) throw new Error("media_asset_too_large");
  const contentType = normalizeImageContentType(response.headers.get("content-type"));
  if (!contentType) throw new Error("media_asset_invalid_content_type");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0 || bytes.length > maxImageBytes) throw new Error("media_asset_invalid_size");
  return writeAsset({ tenantId: params.tenantId, jobId: params.jobId, bytes, contentType, source: "provider" });
}

export async function persistLanqiMockImage(params: { tenantId: string; jobId: string; prompt: string; ratio?: string; label?: string }): Promise<LanqiMediaAssetMetadata> {
  const title = escapeXml(params.prompt.replace(/\s+/g, " ").slice(0, 42));
  const label = escapeXml(params.label ?? "受控模拟成图");
  const [width, height] = mockCanvas(params.ratio);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fff8ed"/><stop offset="1" stop-color="#ef8a3a"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="${Math.round(width * .76)}" cy="${Math.round(height * .25)}" r="${Math.round(Math.min(width, height) * .18)}" fill="#fff" opacity=".55"/><rect x="${Math.round(width * .08)}" y="${Math.round(height * .62)}" width="${Math.round(width * .84)}" height="${Math.round(height * .24)}" rx="28" fill="#fff" opacity=".9"/><text x="${Math.round(width * .12)}" y="${Math.round(height * .7)}" font-family="sans-serif" font-size="${Math.max(22, Math.round(width * .035))}" font-weight="700" fill="#713410">${label}</text><text x="${Math.round(width * .12)}" y="${Math.round(height * .77)}" font-family="sans-serif" font-size="${Math.max(16, Math.round(width * .022))}" fill="#7a5b46">${title}</text><text x="${Math.round(width * .12)}" y="${Math.round(height * .83)}" font-family="sans-serif" font-size="${Math.max(14, Math.round(width * .018))}" fill="#9a7358">零费用流程验收 · 不代表真实模型画质</text></svg>`;
  return writeAsset({ tenantId: params.tenantId, jobId: params.jobId, bytes: Buffer.from(svg), contentType: "image/svg+xml", source: "controlled_mock" });
}

/**
 * LQ-32 合成成片落盘：拼接 + 混音由本地 ffmpeg 完成，字节已经在本机内存里，
 * 不再走 provider 下载，但仍与图片 / 逐镜视频走**同一条租户隔离落盘链路**。
 */
export async function persistLanqiComposedVideo(params: {
  tenantId: string;
  jobId: string;
  bytes: Buffer;
  composed: NonNullable<LanqiMediaAssetMetadata["composed"]>;
}): Promise<LanqiMediaAssetMetadata> {
  if (env.LANQI_MEDIA_ASSET_STORAGE !== "local") throw new Error("media_asset_storage_not_ready");
  if (params.bytes.length === 0) throw new Error("media_asset_invalid_size");
  if (params.bytes.subarray(4, 8).toString("latin1") !== "ftyp") throw new Error("media_asset_invalid_container");
  return writeAsset({
    tenantId: params.tenantId,
    jobId: params.jobId,
    bytes: params.bytes,
    contentType: "video/mp4",
    source: "composed",
    composed: params.composed,
  });
}

export async function readLanqiComposeIndex(params: { tenantId: string; requestKey: string }): Promise<{ composeId: string } | undefined> {
  try {
    const raw = JSON.parse(await readFile(composeIndexPath(params.tenantId, params.requestKey), "utf8")) as { composeId?: string };
    return raw.composeId ? { composeId: raw.composeId } : undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function writeLanqiComposeIndex(params: { tenantId: string; requestKey: string; composeId: string }): Promise<void> {
  const target = composeIndexPath(params.tenantId, params.requestKey);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify({ composeId: params.composeId, createdAt: new Date().toISOString() }), "utf8");
}

/** 成片落盘：与图片同一条租户隔离链路，只接受 provider 返回的 MP4。 */
export async function persistLanqiProviderVideo(params: { tenantId: string; jobId: string; sourceUrl: string }): Promise<LanqiMediaAssetMetadata> {
  if (env.LANQI_MEDIA_ASSET_STORAGE !== "local") throw new Error("media_asset_storage_not_ready");
  assertOutboundUrlAllowed("Lanqi generated video", params.sourceUrl, { domesticNetworkOnly, allowedHosts: domesticOutboundAllowlist });
  const response = await fetch(params.sourceUrl, { signal: AbortSignal.timeout(180_000) });
  if (!response.ok) throw new Error(`media_asset_download_${response.status}`);
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > maxVideoBytes) throw new Error("media_asset_too_large");
  if (normalizeVideoContentType(response.headers.get("content-type")) !== "video/mp4") throw new Error("media_asset_invalid_content_type");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0 || bytes.length > maxVideoBytes) throw new Error("media_asset_invalid_size");
  // 只认 MP4 容器魔数，避免 provider 返回错误页时把 HTML 当成成片落盘。
  if (bytes.length < 12 || bytes.subarray(4, 8).toString("latin1") !== "ftyp") throw new Error("media_asset_invalid_container");
  return writeAsset({ tenantId: params.tenantId, jobId: params.jobId, bytes, contentType: "video/mp4", source: "provider" });
}

export async function readLanqiMediaAsset(params: { tenantId: string; jobId: string }): Promise<{ metadata: LanqiMediaAssetMetadata; bytes: Buffer }> {
  const base = assetBase(params.tenantId, params.jobId);
  const metadata = JSON.parse(await readFile(`${base}.json`, "utf8")) as LanqiMediaAssetMetadata;
  if (metadata.tenantKey !== tenantKey(params.tenantId) || metadata.jobId !== params.jobId) throw new Error("media_asset_owner_mismatch");
  return { metadata, bytes: await readFile(`${base}${extensionFor(metadata.contentType)}`) };
}

export async function markLanqiMediaAsset(params: { tenantId: string; jobId: string; action: "select" | "save" }): Promise<LanqiMediaAssetMetadata> {
  const base = assetBase(params.tenantId, params.jobId);
  const metadata = JSON.parse(await readFile(`${base}.json`, "utf8")) as LanqiMediaAssetMetadata;
  if (metadata.tenantKey !== tenantKey(params.tenantId) || metadata.jobId !== params.jobId) throw new Error("media_asset_owner_mismatch");
  const now = new Date().toISOString();
  const updated = params.action === "select"
    ? { ...metadata, selectedAt: metadata.selectedAt ?? now }
    : { ...metadata, selectedAt: metadata.selectedAt ?? now, savedAt: metadata.savedAt ?? now };
  await writeFile(`${base}.json`, JSON.stringify(updated, null, 2), "utf8");
  return updated;
}

export async function discardLanqiMediaAsset(params: { tenantId: string; jobId: string }): Promise<void> {
  const base = assetBase(params.tenantId, params.jobId);
  try {
    const metadata = JSON.parse(await readFile(`${base}.json`, "utf8")) as LanqiMediaAssetMetadata;
    if (metadata.tenantKey !== tenantKey(params.tenantId) || metadata.jobId !== params.jobId) throw new Error("media_asset_owner_mismatch");
    await unlink(`${base}${extensionFor(metadata.contentType)}`).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    });
    await unlink(`${base}.json`).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export function lanqiMediaAssetUrl(jobId: string): string {
  return `/lanqi/media/assets/${encodeURIComponent(jobId)}`;
}

async function writeAsset(params: { tenantId: string; jobId: string; bytes: Buffer; contentType: LanqiMediaAssetMetadata["contentType"]; source: LanqiMediaAssetMetadata["source"]; composed?: LanqiMediaAssetMetadata["composed"] }): Promise<LanqiMediaAssetMetadata> {
  assertJobId(params.jobId);
  const base = assetBase(params.tenantId, params.jobId);
  await mkdir(path.dirname(base), { recursive: true });
  const finalPath = `${base}${extensionFor(params.contentType)}`;
  const temporaryPath = `${finalPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, params.bytes);
  await rename(temporaryPath, finalPath);
  const metadata: LanqiMediaAssetMetadata = {
    jobId: params.jobId,
    tenantKey: tenantKey(params.tenantId),
    contentType: params.contentType,
    bytes: params.bytes.length,
    createdAt: new Date().toISOString(),
    retention: "tenant_owned",
    source: params.source,
    ...(params.composed ? { composed: params.composed } : {}),
  };
  await writeFile(`${base}.json`, JSON.stringify(metadata, null, 2), "utf8");
  return metadata;
}

/** 合成幂等索引：按租户 + requestKey 记住「这一组镜次只合成一次」。 */
function composeIndexPath(tenantId: string, requestKey: string): string {
  if (!/^[A-Za-z0-9_-]{12,120}$/.test(requestKey)) throw new Error("invalid_compose_request_key");
  const root = path.resolve(env.UPLOAD_DIR, "lanqi-media", tenantKey(tenantId), "compose-index");
  return path.resolve(root, `${requestKey}.json`);
}

function assetBase(tenantId: string, jobId: string): string {
  assertJobId(jobId);
  const root = path.resolve(env.UPLOAD_DIR, "lanqi-media");
  const tenantRoot = path.resolve(root, tenantKey(tenantId));
  const resolved = path.resolve(tenantRoot, jobId);
  if (!resolved.startsWith(`${tenantRoot}${path.sep}`)) throw new Error("invalid_media_asset_path");
  return resolved;
}

function tenantKey(tenantId: string): string {
  return createHash("sha256").update(tenantId).digest("hex").slice(0, 24);
}

function assertJobId(jobId: string): void {
  if (!/^[A-Za-z0-9_-]{8,120}$/.test(jobId)) throw new Error("invalid_media_job_id");
}

function normalizeImageContentType(value: string | null): LanqiMediaAssetMetadata["contentType"] | undefined {
  const normalized = value?.split(";")[0]?.trim().toLowerCase();
  if (normalized === "image/png" || normalized === "image/jpeg" || normalized === "image/webp") return normalized;
  return undefined;
}

function normalizeVideoContentType(value: string | null): "video/mp4" | undefined {
  const normalized = value?.split(";")[0]?.trim().toLowerCase();
  return normalized === "video/mp4" ? "video/mp4" : undefined;
}

function extensionFor(contentType: LanqiMediaAssetMetadata["contentType"]): string {
  if (contentType === "video/mp4") return ".mp4";
  if (contentType === "image/jpeg") return ".jpg";
  if (contentType === "image/webp") return ".webp";
  if (contentType === "image/svg+xml") return ".svg";
  return ".png";
}

function mockCanvas(ratio?: string): [number, number] {
  if (ratio === "3:4") return [768, 1024];
  if (ratio === "9:16") return [576, 1024];
  if (ratio === "16:9") return [1024, 576];
  return [1024, 1024];
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character] ?? character);
}

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { env, domesticNetworkOnly, domesticOutboundAllowlist } from "../config/env.js";
import { assertOutboundUrlAllowed } from "./outbound-policy.js";

const maxImageBytes = 20 * 1024 * 1024;

export type LanqiMediaAssetMetadata = {
  jobId: string;
  tenantKey: string;
  contentType: "image/png" | "image/jpeg" | "image/webp" | "image/svg+xml";
  bytes: number;
  createdAt: string;
  selectedAt?: string;
  savedAt?: string;
  retention: "tenant_owned";
  source: "provider" | "controlled_mock";
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

export async function persistLanqiMockImage(params: { tenantId: string; jobId: string; prompt: string; ratio?: string }): Promise<LanqiMediaAssetMetadata> {
  const title = escapeXml(params.prompt.replace(/\s+/g, " ").slice(0, 42));
  const [width, height] = mockCanvas(params.ratio);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fff8ed"/><stop offset="1" stop-color="#ef8a3a"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="${Math.round(width * .76)}" cy="${Math.round(height * .25)}" r="${Math.round(Math.min(width, height) * .18)}" fill="#fff" opacity=".55"/><rect x="${Math.round(width * .08)}" y="${Math.round(height * .62)}" width="${Math.round(width * .84)}" height="${Math.round(height * .24)}" rx="28" fill="#fff" opacity=".9"/><text x="${Math.round(width * .12)}" y="${Math.round(height * .7)}" font-family="sans-serif" font-size="${Math.max(22, Math.round(width * .035))}" font-weight="700" fill="#713410">受控模拟成图</text><text x="${Math.round(width * .12)}" y="${Math.round(height * .77)}" font-family="sans-serif" font-size="${Math.max(16, Math.round(width * .022))}" fill="#7a5b46">${title}</text><text x="${Math.round(width * .12)}" y="${Math.round(height * .83)}" font-family="sans-serif" font-size="${Math.max(14, Math.round(width * .018))}" fill="#9a7358">零费用流程验收 · 不代表真实模型画质</text></svg>`;
  return writeAsset({ tenantId: params.tenantId, jobId: params.jobId, bytes: Buffer.from(svg), contentType: "image/svg+xml", source: "controlled_mock" });
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

async function writeAsset(params: { tenantId: string; jobId: string; bytes: Buffer; contentType: LanqiMediaAssetMetadata["contentType"]; source: LanqiMediaAssetMetadata["source"] }): Promise<LanqiMediaAssetMetadata> {
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
  };
  await writeFile(`${base}.json`, JSON.stringify(metadata, null, 2), "utf8");
  return metadata;
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

function extensionFor(contentType: LanqiMediaAssetMetadata["contentType"]): string {
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

import { createWriteStream } from "node:fs";
import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { finished } from "node:stream/promises";
import path from "node:path";
import type { MultipartFile } from "@fastify/multipart";
import { env } from "../config/env.js";

export type ClipTempUploadKind = "source" | "music" | "asset";

export interface ClipTempUpload {
  id: string;
  kind: ClipTempUploadKind;
  filename: string;
  mimeType: string;
  byteSize: number;
  localPath: string;
  createdAt: string;
  expiresAt: string;
}

const RETENTION_MS = 24 * 60 * 60 * 1000;
const sourcePattern = /\.(mp4|mov|m4v|webm)$/i;
const musicPattern = /\.(mp3|wav|m4a|aac|ogg)$/i;
const assetPattern = /\.(mp4|mov|m4v|webm|jpg|jpeg|png|webp)$/i;

export async function storeClipTempUpload(params: {
  kind: ClipTempUploadKind;
  file: MultipartFile;
}): Promise<ClipTempUpload> {
  const filename = sanitizeFilename(params.file.filename);
  const expected = params.kind === "source" ? sourcePattern : params.kind === "music" ? musicPattern : assetPattern;
  if (!expected.test(filename)) {
    throw new Error(params.kind === "source"
      ? "仅支持 MP4、MOV、M4V、WebM 视频"
      : params.kind === "music"
        ? "仅支持 MP3、WAV、M4A、AAC、OGG 音频"
        : "补充素材仅支持常用视频和图片格式");
  }
  const id = randomUUID();
  const root = getClipTempUploadRoot();
  await mkdir(root, { recursive: true });
  const localPath = path.join(root, `${id}${path.extname(filename).toLowerCase()}`);
  try {
    await finished(params.file.file.pipe(createWriteStream(localPath, { flags: "wx" })));
    const info = await stat(localPath);
    const createdAt = new Date();
    const upload: ClipTempUpload = {
      id,
      kind: params.kind,
      filename,
      mimeType: params.file.mimetype || "application/octet-stream",
      byteSize: info.size,
      localPath,
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + RETENTION_MS).toISOString()
    };
    await writeFile(metadataPath(id), JSON.stringify(upload, null, 2), "utf8");
    return upload;
  } catch (error) {
    await rm(localPath, { force: true });
    throw error;
  }
}

export async function readClipTempUpload(id: string, kind?: ClipTempUploadKind): Promise<ClipTempUpload | undefined> {
  if (!/^[a-f0-9-]{36}$/i.test(id)) return undefined;
  try {
    const upload = JSON.parse(await readFile(metadataPath(id), "utf8")) as ClipTempUpload;
    if (kind && upload.kind !== kind) return undefined;
    if (Date.parse(upload.expiresAt) <= Date.now()) {
      await removeClipTempUpload(upload);
      return undefined;
    }
    await access(upload.localPath);
    return upload;
  } catch {
    return undefined;
  }
}

export async function cleanupExpiredClipUploads(): Promise<number> {
  const root = getClipTempUploadRoot();
  await mkdir(root, { recursive: true });
  const entries = await readdir(root, { withFileTypes: true });
  let removed = 0;
  for (const entry of entries.filter((item) => item.isFile() && item.name.endsWith(".json"))) {
    try {
      const upload = JSON.parse(await readFile(path.join(root, entry.name), "utf8")) as ClipTempUpload;
      if (Date.parse(upload.expiresAt) > Date.now()) continue;
      await removeClipTempUpload(upload);
      removed += 1;
    } catch {
      // Ignore malformed old metadata; it is not addressable as a valid upload.
    }
  }
  return removed;
}

export async function registerClipOutputExpiry(outputPath: string): Promise<string> {
  const outputRoot = path.resolve(env.UPLOAD_DIR, "clip-lab");
  const resolved = path.resolve(outputPath);
  if (path.dirname(resolved) !== outputRoot) throw new Error("invalid_clip_output_path");
  const expiresAt = new Date(Date.now() + RETENTION_MS).toISOString();
  await writeFile(`${resolved}.expires.json`, JSON.stringify({ outputPath: resolved, expiresAt }, null, 2), "utf8");
  return expiresAt;
}

export async function cleanupExpiredClipOutputs(): Promise<number> {
  const outputRoot = path.resolve(env.UPLOAD_DIR, "clip-lab");
  await mkdir(outputRoot, { recursive: true });
  const entries = await readdir(outputRoot, { withFileTypes: true });
  let removed = 0;
  for (const entry of entries.filter((item) => item.isFile() && item.name.endsWith(".mp4.expires.json"))) {
    const metaPath = path.join(outputRoot, entry.name);
    try {
      const meta = JSON.parse(await readFile(metaPath, "utf8")) as { outputPath?: string; expiresAt?: string };
      if (!meta.outputPath || !meta.expiresAt || Date.parse(meta.expiresAt) > Date.now()) continue;
      const outputPath = path.resolve(meta.outputPath);
      if (path.dirname(outputPath) === outputRoot) await rm(outputPath, { force: true });
      await rm(metaPath, { force: true });
      removed += 1;
    } catch {
      // Ignore malformed metadata and never delete an unresolved target.
    }
  }
  return removed;
}

function getClipTempUploadRoot(): string {
  return path.resolve(env.UPLOAD_DIR, "clip-lab", "temporary-inputs");
}

function metadataPath(id: string): string {
  return path.join(getClipTempUploadRoot(), `${id}.json`);
}

async function removeClipTempUpload(upload: ClipTempUpload): Promise<void> {
  const root = getClipTempUploadRoot();
  const resolvedFile = path.resolve(upload.localPath);
  if (path.dirname(resolvedFile) === root) await rm(resolvedFile, { force: true });
  await rm(metadataPath(upload.id), { force: true });
}

function sanitizeFilename(filename: string): string {
  return path.basename(filename).replace(/[^\w\u4e00-\u9fa5.-]+/g, "_").slice(0, 120) || "upload.bin";
}

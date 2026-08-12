import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MultipartFile } from "@fastify/multipart";
import { env } from "../config/env.js";

export interface StoredUpload {
  id: string;
  filename: string;
  mimeType: string;
  byteSize: number;
  storagePath: string;
  sha256: string;
}

export async function storeMultipartFile(params: {
  tenantId: string;
  file: MultipartFile;
}): Promise<StoredUpload> {
  const id = randomUUID();
  const safeName = sanitizeFilename(params.file.filename);
  const tenantDir = path.resolve(env.UPLOAD_DIR, params.tenantId);
  await mkdir(tenantDir, { recursive: true });
  const storagePath = path.join(tenantDir, `${id}-${safeName}`);
  const buffer = await params.file.toBuffer();
  await writeFile(storagePath, buffer);

  return {
    id,
    filename: safeName,
    mimeType: params.file.mimetype || "application/octet-stream",
    byteSize: buffer.byteLength,
    storagePath,
    sha256: createHash("sha256").update(buffer).digest("hex")
  };
}

export async function summarizeStoredFile(params: {
  filename: string;
  mimeType: string;
  storagePath: string;
}): Promise<string> {
  const fileStat = await stat(params.storagePath);
  const extension = path.extname(params.filename).toLowerCase();
  const canReadAsText =
    params.mimeType.startsWith("text/") ||
    ["md", ".txt", ".csv", ".json", ".tsv", ".log"].includes(extension);

  if (!canReadAsText) {
    return [
      `文件名：${params.filename}`,
      `文件类型：${params.mimeType}`,
      `文件大小：${fileStat.size} bytes`,
      "当前MVP尚未解析该二进制文件内容。请基于文件名、业务背景和用户补充信息，先给出分析框架、所需字段和下一步处理建议。"
    ].join("\n");
  }

  const content = await readFile(params.storagePath, "utf8");
  const truncated = content.length > 12000 ? `${content.slice(0, 12000)}\n\n[内容已截断]` : content;
  return [
    `文件名：${params.filename}`,
    `文件类型：${params.mimeType}`,
    `文件大小：${fileStat.size} bytes`,
    "",
    "文件内容：",
    truncated
  ].join("\n");
}

function sanitizeFilename(filename: string): string {
  return filename.replace(/[^\w\u4e00-\u9fa5.-]+/g, "_").slice(0, 120) || "upload.bin";
}


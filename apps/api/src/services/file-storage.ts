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

/** 图片魔数识别（2026-10-08）：浏览器按扩展名上报 mimeType，PNG 存成 .jpeg 之类很常见，
 *  上传时就按真实内容识别并归一化，别等授权/报价阶段才拿一句懵逼的「当前步骤未完成」。 */
export class FileFormatError extends Error {}

export function sniffImageMime(buffer: Buffer): "image/png" | "image/jpeg" | "image/bmp" | "image/webp" | null {
  const hex = buffer.subarray(0, 12).toString("hex");
  if (hex.startsWith("89504e470d0a1a0a")) return "image/png";
  if (hex.startsWith("ffd8ff")) return "image/jpeg";
  if (hex.startsWith("424d")) return "image/bmp";
  if (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
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
  const declaredMime = params.file.mimetype || "application/octet-stream";
  let mimeType = declaredMime;
  if (declaredMime.startsWith("image/")) {
    const real = sniffImageMime(buffer);
    if (!real) {
      throw new FileFormatError("图片格式不支持：请上传 JPG / PNG / WebP / BMP 格式的图片（以文件真实格式为准，改后缀名无效）。");
    }
    mimeType = real;
  }
  await writeFile(storagePath, buffer);

  return {
    id,
    filename: safeName,
    mimeType,
    byteSize: buffer.byteLength,
    storagePath,
    sha256: createHash("sha256").update(buffer).digest("hex")
  };
}

export async function storeBuffer(params: {
  tenantId: string;
  filename: string;
  mimeType: string;
  buffer: Buffer;
}): Promise<StoredUpload> {
  const id = randomUUID();
  const safeName = sanitizeFilename(params.filename);
  const tenantDir = path.resolve(env.UPLOAD_DIR, params.tenantId);
  await mkdir(tenantDir, { recursive: true });
  const storagePath = path.join(tenantDir, `${id}-${safeName}`);
  await writeFile(storagePath, params.buffer);

  return {
    id,
    filename: safeName,
    mimeType: params.mimeType || "application/octet-stream",
    byteSize: params.buffer.byteLength,
    storagePath,
    sha256: createHash("sha256").update(params.buffer).digest("hex")
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


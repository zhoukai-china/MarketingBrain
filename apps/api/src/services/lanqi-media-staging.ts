// 兰琪视频「首帧图暂存」：门店上传的首帧图落在本平台自己的存储里，再由服务端生成一条
// 限时、一次性签名的 HTTPS 外链，交给阿里云百炼图生视频抓取。
//
// 设计约束（与 0909 总纲「素材只进自己的桶」一致）：
//   · 素材只写本平台 `UPLOAD_DIR`，不写任何第三方桶、不暴露长期公开地址；
//   · 外链只按「任务 ID + 租户指纹 + 过期时间」签名，不能遍历、不能列出、不能改写；
//   · 没有公网基址或签名密钥时整条链路 fail closed，接口明确拒绝，不静默降级。

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { env } from "../config/env.js";

const firstNamePattern = /^lanqi-ff-[A-Za-z0-9]{16,64}$/;
const contentTypeExtension: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

export type LanqiFirstFrameMetadata = {
  firstFrameId: string;
  tenantKey: string;
  contentType: "image/jpeg" | "image/png" | "image/webp";
  bytes: number;
  sha256: string;
  createdAt: string;
  retention: "tenant_owned";
  source: "store_upload";
};

export const LANQI_FIRST_FRAME_PUBLIC_PATH = "/lanqi/media/first-frame";

/** 暂存能力是否就绪：公网基址 + 签名密钥缺一不可。 */
export function lanqiFirstFrameStagingIssue(): string | undefined {
  if (!stagingSecret()) return "首帧图暂存签名密钥未配置，当前不能把门店素材交给视频模型。";
  const base = publicBase();
  if (!base) return "首帧图公网基址未配置，视频模型无法抓取门店素材。";
  if (!/^https:\/\//.test(base)) return "首帧图公网基址必须是 HTTPS。";
  return undefined;
}

export async function stageLanqiFirstFrame(params: {
  tenantId: string;
  contentType: string;
  dataBase64: string;
}): Promise<LanqiFirstFrameMetadata> {
  const issue = lanqiFirstFrameStagingIssue();
  if (issue) throw Object.assign(new Error("first_frame_staging_disabled"), { statusCode: 503, publicMessage: issue });
  const contentType = String(params.contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  const extension = contentTypeExtension[contentType];
  if (!extension) throw Object.assign(new Error("unsupported_first_frame_type"), { statusCode: 400, publicMessage: "首帧图只支持 JPG / PNG / WebP。" });
  const raw = String(params.dataBase64 ?? "").replace(/^data:[^,]*,/, "");
  if (!raw) throw Object.assign(new Error("empty_first_frame"), { statusCode: 400, publicMessage: "没有读到图片内容，请重新选择。" });
  let bytes: Buffer;
  try {
    bytes = Buffer.from(raw, "base64");
  } catch {
    throw Object.assign(new Error("invalid_first_frame_encoding"), { statusCode: 400, publicMessage: "图片内容无法解析，请重新选择。" });
  }
  const maxBytes = Math.round(env.LANQI_MEDIA_FIRST_FRAME_MAX_MB * 1024 * 1024);
  if (!bytes.length) throw Object.assign(new Error("empty_first_frame"), { statusCode: 400, publicMessage: "没有读到图片内容，请重新选择。" });
  if (bytes.length > maxBytes) throw Object.assign(new Error("first_frame_too_large"), { statusCode: 413, publicMessage: `首帧图不能超过 ${env.LANQI_MEDIA_FIRST_FRAME_MAX_MB}MB。` });
  if (!containerMatches(bytes, contentType)) throw Object.assign(new Error("first_frame_container_mismatch"), { statusCode: 400, publicMessage: "图片格式与文件内容不一致，请换一张。" });

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const firstFrameId = `lanqi-ff-${sha256.slice(0, 32)}`;
  const metadata: LanqiFirstFrameMetadata = {
    firstFrameId,
    tenantKey: tenantKey(params.tenantId),
    contentType: contentType as LanqiFirstFrameMetadata["contentType"],
    bytes: bytes.length,
    sha256,
    createdAt: new Date().toISOString(),
    retention: "tenant_owned",
    source: "store_upload",
  };
  const base = stagingBase(metadata.tenantKey, firstFrameId);
  await mkdir(path.dirname(base), { recursive: true });
  // 同一门店、同一张图重复上传复用同一个 ID，不会堆积副本。
  const existing = await readLanqiFirstFrameMetadata(metadata.tenantKey, firstFrameId);
  if (!existing) {
    await writeFile(`${base}${extension}`, bytes);
    await writeFile(`${base}.json`, JSON.stringify(metadata, null, 2), "utf8");
  }
  return existing ?? metadata;
}

export async function readLanqiFirstFrame(params: { tenantId: string; firstFrameId: string }): Promise<{ metadata: LanqiFirstFrameMetadata; bytes: Buffer } | undefined> {
  return readByTenantKey(tenantKey(params.tenantId), params.firstFrameId);
}

/** 生成交给视频模型抓取的限时签名外链（只对外暴露租户指纹与过期时间，不含租户 ID）。 */
export function lanqiFirstFramePublicUrl(params: { tenantId: string; firstFrameId: string }): string {
  const issue = lanqiFirstFrameStagingIssue();
  if (issue) throw Object.assign(new Error("first_frame_staging_disabled"), { statusCode: 503, publicMessage: issue });
  const expiresAt = Math.floor(Date.now() / 1000) + env.LANQI_MEDIA_FIRST_FRAME_TTL_MINUTES * 60;
  const key = tenantKey(params.tenantId);
  const token = sign(params.firstFrameId, key, expiresAt);
  return `${publicBase()}${LANQI_FIRST_FRAME_PUBLIC_PATH}/${params.firstFrameId}?k=${key}&e=${expiresAt}&t=${token}`;
}

/**
 * 无鉴权公开读取：只认「任务 ID + 租户指纹 + 过期时间」的签名，且只服务首帧图暂存区，
 * 读不到生成结果、列不出目录。签名不符或过期一律 404，不区分原因。
 */
export async function readLanqiFirstFrameBySignature(params: { firstFrameId: string; tenantKey: string; expiresAt: string | number | undefined; token: string }): Promise<{ metadata: LanqiFirstFrameMetadata; bytes: Buffer } | undefined> {
  if (!firstNamePattern.test(params.firstFrameId)) return undefined;
  if (!/^[a-f0-9]{24}$/.test(params.tenantKey)) return undefined;
  const expiresAt = Number(params.expiresAt);
  if (!Number.isInteger(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) return undefined;
  const expected = sign(params.firstFrameId, params.tenantKey, expiresAt);
  const provided = params.token ?? "";
  if (expected.length !== provided.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(provided))) return undefined;
  return readByTenantKey(params.tenantKey, params.firstFrameId);
}

/** 公开读路由必须注册在兰琪产品 entitlement 作用域之外：视频模型不是登录用户。 */
export function registerLanqiFirstFramePublicRoute(app: FastifyInstance): void {
  app.get<{ Params: { firstFrameId: string }; Querystring: { k?: string; e?: string; t?: string } }>(
    `${LANQI_FIRST_FRAME_PUBLIC_PATH}/:firstFrameId`,
    async (request, reply) => {
      const asset = await readLanqiFirstFrameBySignature({
        firstFrameId: request.params.firstFrameId,
        tenantKey: String(request.query?.k ?? ""),
        expiresAt: request.query?.e,
        token: String(request.query?.t ?? ""),
      });
      if (!asset) return reply.code(404).send({ error: "first_frame_not_found" });
      request.log.info({ event: "lanqi_first_frame.fetched", firstFrameId: request.params.firstFrameId });
      return reply
        .header("Content-Type", asset.metadata.contentType)
        .header("Cache-Control", "private, no-store")
        .send(asset.bytes);
    },
  );
}

/**
 * 图生视频的输入解析：门店传「已暂存的首帧图 ID」或「刚选中的图片内容」，
 * 服务端换成一条限时签名外链交给百炼抓取。图片不进第三方桶（方案 B）。
 *
 * 非图生视频类型原样放行；已存在的失败一律显式返回，不退化成「无首帧图硬跑」。
 */
export async function resolveLanqiFirstFrameInput(params: {
  tenantId: string;
  kind: string;
  firstFrameId?: string;
  firstFrame?: { contentType: string; dataBase64: string };
  imageUrl?: string;
}): Promise<{ ok: true; imageUrl?: string; firstFrameId?: string } | { ok: false; statusCode: number; error: string; message: string }> {
  if (params.kind !== "image_to_video") return { ok: true, imageUrl: params.imageUrl };
  if (params.firstFrameId) {
    const asset = await readLanqiFirstFrame({ tenantId: params.tenantId, firstFrameId: params.firstFrameId });
    if (!asset) return { ok: false, statusCode: 422, error: "first_frame_not_found", message: "首帧图不存在或不属于当前门店，请重新选择。" };
    return { ok: true, imageUrl: lanqiFirstFramePublicUrl({ tenantId: params.tenantId, firstFrameId: params.firstFrameId }), firstFrameId: params.firstFrameId };
  }
  if (params.firstFrame) {
    let staged: LanqiFirstFrameMetadata;
    try {
      staged = await stageLanqiFirstFrame({ tenantId: params.tenantId, contentType: params.firstFrame.contentType, dataBase64: params.firstFrame.dataBase64 });
    } catch (error) {
      const failure = error as { statusCode?: number; publicMessage?: string; message?: string };
      return {
        ok: false,
        statusCode: failure.statusCode && failure.statusCode >= 400 ? failure.statusCode : 500,
        error: failure.message ?? "first_frame_staging_failed",
        message: failure.publicMessage ?? "首帧图暂存失败，请重新选择。",
      };
    }
    return { ok: true, imageUrl: lanqiFirstFramePublicUrl({ tenantId: params.tenantId, firstFrameId: staged.firstFrameId }), firstFrameId: staged.firstFrameId };
  }
  return { ok: true, imageUrl: params.imageUrl };
}

/**
 * 幂等指纹：签名外链里的过期时间每次都变，绝不能拿整条 URL 当输入指纹，
 * 否则同一张图重试会被误判成「输入已变化」。统一用稳定的暂存 ID。
 */
export function lanqiFirstFrameRequestFingerprint(input: { kind: string; firstFrameId?: string; imageUrl?: string }): string | undefined {
  if (input.kind !== "image_to_video") return undefined;
  return input.firstFrameId ?? input.imageUrl;
}

function stagingSecret(): string | undefined {
  return env.LANQI_MEDIA_STAGING_SECRET || env.JWT_SECRET;
}

function publicBase(): string {
  return (env.LANQI_MEDIA_PUBLIC_BASE_URL ?? "").replace(/\/+$/, "");
}

function sign(firstFrameId: string, tenantKeyValue: string, expiresAt: number): string {
  return createHmac("sha256", stagingSecret() ?? "").update(`${firstFrameId}.${tenantKeyValue}.${expiresAt}`).digest("hex");
}

async function readLanqiFirstFrameMetadata(tenantKeyValue: string, firstFrameId: string): Promise<LanqiFirstFrameMetadata | undefined> {
  try {
    return JSON.parse(await readFile(`${stagingBase(tenantKeyValue, firstFrameId)}.json`, "utf8")) as LanqiFirstFrameMetadata;
  } catch {
    return undefined;
  }
}

async function readByTenantKey(tenantKeyValue: string, firstFrameId: string): Promise<{ metadata: LanqiFirstFrameMetadata; bytes: Buffer } | undefined> {
  if (!firstNamePattern.test(firstFrameId)) return undefined;
  const metadata = await readLanqiFirstFrameMetadata(tenantKeyValue, firstFrameId);
  if (!metadata || metadata.tenantKey !== tenantKeyValue || metadata.firstFrameId !== firstFrameId) return undefined;
  try {
    return { metadata, bytes: await readFile(`${stagingBase(tenantKeyValue, firstFrameId)}${contentTypeExtension[metadata.contentType]}`) };
  } catch {
    return undefined;
  }
}

function stagingBase(tenantKeyValue: string, firstFrameId: string): string {
  const root = path.resolve(env.UPLOAD_DIR, "lanqi-media", "staging");
  const tenantRoot = path.resolve(root, tenantKeyValue);
  const resolved = path.resolve(tenantRoot, firstFrameId);
  if (!resolved.startsWith(`${tenantRoot}${path.sep}`)) throw new Error("invalid_first_frame_path");
  if (!firstNamePattern.test(firstFrameId)) throw new Error("invalid_first_frame_id");
  return resolved;
}

function tenantKey(tenantId: string): string {
  return createHash("sha256").update(tenantId).digest("hex").slice(0, 24);
}

/** 只认 JPEG / PNG / WebP 的真实容器魔数，避免把改了扩展名的文件交给模型。 */
function containerMatches(bytes: Buffer, contentType: string): boolean {
  if (contentType === "image/jpeg") return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (contentType === "image/png") return bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (contentType === "image/webp") return bytes.length > 12 && bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP";
  return false;
}

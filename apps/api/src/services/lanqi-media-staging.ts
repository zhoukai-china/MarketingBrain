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
import { createOssPrivateVideoStaging } from "./beauty-video-oss-staging.js";
import { readLanqiMediaAsset } from "./lanqi-media-assets.js";

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

/**
 * 首帧图 OSS 通道（2026-10-04 用户拍板「交给模型的地址就该是 OSS 的」）：
 * 首帧图与爆款复刻的素材走同一个私有暂存桶——上传用 `direct/` 前缀的预签名 PUT，
 * 给模型的取图链接用预签名 GET（本就是 HTTPS + 限时签名，`PUBLIC_BASE_URL` 不再参与）。
 * 本地盘仍然留底（readLanqiFirstFrame 复用与审计不变）；OSS 不可用时整体回退本地签名外链。
 */
type OssFirstFramePresigner = { presign(method: "PUT" | "GET", key: string, ttlSeconds: number, contentType?: string): Promise<string> };
let ossFirstFrameCache: OssFirstFramePresigner | null | undefined;
function ossFirstFramePresigner(): OssFirstFramePresigner | undefined {
  if (ossFirstFrameCache !== undefined) return ossFirstFrameCache ?? undefined;
  try {
    if (env.BEAUTY_VIDEO_STAGING_DRIVER !== "aliyun_oss" || !env.BEAUTY_VIDEO_OSS_BUCKET) {
      ossFirstFrameCache = null;
      return undefined;
    }
    const driver = createOssPrivateVideoStaging({
      config: {
        bucket: env.BEAUTY_VIDEO_OSS_BUCKET ?? "",
        region: env.BEAUTY_VIDEO_OSS_REGION ?? "",
        prefix: env.BEAUTY_VIDEO_OSS_PREFIX ?? "",
        approvedOrigin: env.BEAUTY_VIDEO_OSS_APPROVED_ORIGIN ?? ""
      },
      credentials: () => ({
        accessKeyId: env.BEAUTY_VIDEO_OSS_ACCESS_KEY_ID ?? "",
        accessKeySecret: env.BEAUTY_VIDEO_OSS_ACCESS_KEY_SECRET ?? "",
        securityToken: env.BEAUTY_VIDEO_OSS_SECURITY_TOKEN ?? "",
        expiresAt: Date.parse(env.BEAUTY_VIDEO_OSS_CREDENTIAL_EXPIRES_AT ?? "")
      }),
      now: Date.now
    });
    if (!driver.presign) {
      ossFirstFrameCache = null;
      return undefined;
    }
    ossFirstFrameCache = { presign: driver.presign };
    return ossFirstFrameCache;
  } catch {
    ossFirstFrameCache = null;
    return undefined;
  }
}

/** 单镜 AI 首帧在 OSS 上的确定地址（生图产物要给视频模型抓取，必须是公网 HTTPS）。 */
export function ossShotFrameKey(tenantId: string, frameId: string, extension: string): string {
  return `${env.BEAUTY_VIDEO_OSS_PREFIX ?? ""}direct/${tenantId}/shot-frame/${frameId}${extension}`;
}

/** 把字节推到 OSS 直传区（预签名 PUT）。失败抛错，由调用方决定是否回退。 */
export async function putOssStagedBytes(params: { key: string; contentType: string; bytes: Buffer }): Promise<void> {
  const presigner = ossFirstFramePresigner();
  if (!presigner) throw new Error("oss_direct_upload_unavailable");
  const uploadUrl = await presigner.presign("PUT", params.key, 600, params.contentType);
  const put = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": params.contentType },
    body: new Uint8Array(params.bytes),
    signal: AbortSignal.timeout(60_000)
  });
  if (!put.ok) throw new Error(`oss_put_${put.status}`);
}

/** 已上传对象的限时取图链接（预签名 GET）；OSS 不可用返回 undefined。 */
export async function ossStagedUrl(params: { key: string; ttlSeconds?: number }): Promise<string | undefined> {
  const presigner = ossFirstFramePresigner();
  if (!presigner) return undefined;
  try {
    return await presigner.presign("GET", params.key, Math.min(params.ttlSeconds ?? 900, 900));
  } catch {
    return undefined;
  }
}

function ossFirstFrameKey(tenantId: string, firstFrameId: string, extension: string): string {
  return `${env.BEAUTY_VIDEO_OSS_PREFIX ?? ""}direct/${tenantId}/first-frame/${firstFrameId}${extension}`;
}

/** 暂存能力是否就绪：OSS 通道可用即就绪；否则退回「公网基址 + 签名密钥」本地模式。 */
export function lanqiFirstFrameStagingIssue(): string | undefined {
  if (ossFirstFramePresigner()) return undefined;
  if (!stagingSecret()) return "首帧图暂存签名密钥未配置，当前不能把门店素材交给视频模型。";
  const base = publicBase();
  if (!base) return "首帧图公网基址未配置，视频模型无法抓取门店素材。";
  // mock 模式放宽为允许本地 HTTP（2026-10-04）：mock 不真调视频模型，URL 不会被外部抓取，
  // 本地联调没有 HTTPS 域名。real 模式仍强制 HTTPS——那时 URL 会被阿里云真实拉取。
  if (env.LANQI_MEDIA_EXECUTION_MODE !== "mock" && !/^https:\/\//.test(base)) return "首帧图公网基址必须是 HTTPS。";
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
    // OSS 通道：同一份字节再进暂存桶（确定性 key，同图幂等覆盖直传区不受 forbid-overwrite 影响——
    // direct/ 前缀的预签名 PUT 无对象级互斥），给视频模型的取图链接由此走 OSS 预签名 GET。
    const presigner = ossFirstFramePresigner();
    if (presigner) {
      try {
        const key = ossFirstFrameKey(params.tenantId, firstFrameId, extension);
        const uploadUrl = await presigner.presign("PUT", key, 600, contentType);
        const put = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": contentType }, body: new Uint8Array(bytes), signal: AbortSignal.timeout(60_000) });
        if (!put.ok) throw new Error(`oss_put_${put.status}`);
      } catch {
        // OSS 上传失败不阻断本地暂存：URL 生成时会自动探测并回退本地签名外链。
      }
    }
  }
  return existing ?? metadata;
}

/**
 * 参考图交给模型抓取的链接（2026-10-05 加固）：先把字节**确保**推上 OSS 再签名 GET。
 * 此前只做预签名——暂存时 OSS PUT 一旦失败（如 STS 过期窗口）对象缺失，模型抓 404
 * 会静默无视参考图 → 纯文生图 → 人物随机（用户实测「人物不是我上传的」）。
 */
export async function lanqiFirstFrameReferenceUrl(params: { tenantId: string; firstFrameId: string; contentType: string; bytes: Buffer }): Promise<string> {
  const presigner = ossFirstFramePresigner();
  const extension = contentTypeExtension[params.contentType];
  if (presigner && extension) {
    try {
      const key = ossFirstFrameKey(params.tenantId, params.firstFrameId, extension);
      await putOssStagedBytes({ key, contentType: params.contentType, bytes: params.bytes });
      const ttl = Math.min(env.LANQI_MEDIA_FIRST_FRAME_TTL_MINUTES * 60, 900);
      return await presigner.presign("GET", key, ttl);
    } catch {
      /* OSS 通道异常 → 回退原逻辑（内含本地签名外链兜底） */
    }
  }
  return lanqiFirstFramePublicUrl({ tenantId: params.tenantId, firstFrameId: params.firstFrameId, contentType: params.contentType });
}

export async function readLanqiFirstFrame(params: { tenantId: string; firstFrameId: string }): Promise<{ metadata: LanqiFirstFrameMetadata; bytes: Buffer } | undefined> {
  return readByTenantKey(tenantKey(params.tenantId), params.firstFrameId);
}

/** 生成交给视频模型抓取的限时签名外链：优先 OSS 预签名 GET（HTTPS）；OSS 不可用回退本地签名外链。 */
export async function lanqiFirstFramePublicUrl(params: { tenantId: string; firstFrameId: string; contentType?: string }): Promise<string> {
  const issue = lanqiFirstFrameStagingIssue();
  if (issue) throw Object.assign(new Error("first_frame_staging_disabled"), { statusCode: 503, publicMessage: issue });
  const presigner = ossFirstFramePresigner();
  const extension = params.contentType ? contentTypeExtension[params.contentType] : undefined;
  if (presigner && extension) {
    // 预签名纯本地计算、零网络往返；key 由 stageLanqiFirstFrame 的扩展名映射确定性保证。
    // STS 过期等运行时问题（credential() 校验）会在这里抛——必须兜住回退本地签名外链，
    // 否则整条 quote 直接 500（2026-10-05 实测：STS 过期 3 小时后 quote 全挂）。
    try {
      const key = ossFirstFrameKey(params.tenantId, params.firstFrameId, extension);
      const ttl = Math.min(env.LANQI_MEDIA_FIRST_FRAME_TTL_MINUTES * 60, 900);
      return await presigner.presign("GET", key, ttl);
    } catch {
      /* OSS 通道异常 → 走本地回退 */
    }
  }
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
  /** 已生成的 AI 单镜首帧（方案④）：优先用它当起幅。 */
  frameId?: string;
}): Promise<{ ok: true; imageUrl?: string; firstFrameId?: string } | { ok: false; statusCode: number; error: string; message: string }> {
  if (params.kind !== "image_to_video") return { ok: true, imageUrl: params.imageUrl };
  // 方案④ 优先：这一镜已经生成过 AI 首帧 → 现签一条 OSS 取图链接当 img_url（模型公网可抓取）。
  if (params.frameId) {
    try {
      const asset = await readLanqiMediaAsset({ tenantId: params.tenantId, jobId: params.frameId });
      const extension = asset.metadata.contentType === "image/jpeg" ? ".jpg" : asset.metadata.contentType === "image/webp" ? ".webp" : ".png";
      const key = ossShotFrameKey(params.tenantId, params.frameId, extension);
      let url = await ossStagedUrl({ key });
      if (!url) {
        await putOssStagedBytes({ key, contentType: asset.metadata.contentType, bytes: asset.bytes });
        url = await ossStagedUrl({ key });
      }
      if (!url) return { ok: false, statusCode: 422, error: "shot_frame_unavailable", message: "这一镜的 AI 首帧暂时取不到，请重新生成一次首帧再出片。" };
      return { ok: true, imageUrl: url, firstFrameId: params.frameId };
    } catch {
      return { ok: false, statusCode: 422, error: "shot_frame_unavailable", message: "这一镜的 AI 首帧取不到了，请重新生成一次首帧再出片。" };
    }
  }
  if (params.firstFrameId) {
    const asset = await readLanqiFirstFrame({ tenantId: params.tenantId, firstFrameId: params.firstFrameId });
    if (!asset) return { ok: false, statusCode: 422, error: "first_frame_not_found", message: "首帧图不存在或不属于当前门店，请重新选择。" };
    return { ok: true, imageUrl: await lanqiFirstFramePublicUrl({ tenantId: params.tenantId, firstFrameId: params.firstFrameId, contentType: asset.metadata.contentType }), firstFrameId: params.firstFrameId };
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
    return { ok: true, imageUrl: await lanqiFirstFramePublicUrl({ tenantId: params.tenantId, firstFrameId: staged.firstFrameId, contentType: staged.contentType }), firstFrameId: staged.firstFrameId };
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

import { isIP } from "node:net";
import { z } from "zod";
import { isVideoReplicationProductCode, type VideoReplicationProductCode } from "./video-replication-entitlement.js";

export const REPLICATION_CONTRACT = "beauty-video-replication-v1" as const;
export const REPLICATION_MODEL = "wan2.2-animate-mix" as const;
export const replicationSchema = z.object({
  referenceVideoUrl: z.string().max(2048).optional(), portraitImageUrl: z.string().max(2048).optional(),
  referenceFileId: z.string().min(1).max(120).optional(), portraitFileId: z.string().min(1).max(120).optional(),
  requestKey: z.string().trim().min(12).max(120).optional(),
  model: z.enum(["aliyun_strict", "seedance_creative"]),
  template: z.enum(["owner_promo", "kol_visit"]).default("owner_promo"),
  mode: z.enum(["wan-std", "wan-pro"]).default("wan-std"),
  style: z.string().max(200).default("preserve_original"),
  environmentFileIds: z.array(z.string().max(120)).max(10).default([]),
  script: z.string().max(4000).optional(), voiceId: z.string().max(120).optional(),
  subtitles: z.boolean().default(false),
  visualRightsConfirmed: z.boolean(), audioRightsConfirmed: z.boolean(),
  performerConsentConfirmed: z.boolean(), portraitConsentConfirmed: z.boolean()
}).strict();
export type ReplicationRequest = z.infer<typeof replicationSchema>;

const PUBLIC_VIDEO_PAGE_HOSTS = new Set([
  "douyin.com", "www.douyin.com", "xiaohongshu.com", "www.xiaohongshu.com",
  "weibo.com", "www.weibo.com", "bilibili.com", "www.bilibili.com"
]);

export type ReplicationModel = "aliyun_strict" | "seedance_creative";

export interface ViralReplicationInput {
  referenceVideoUrl?: string;
  portraitImageUrl?: string;
  referenceFileId?: string;
  portraitFileId?: string;
  model: ReplicationModel;
  visualRightsConfirmed: boolean;
  audioRightsConfirmed: boolean;
  performerConsentConfirmed: boolean;
  portraitConsentConfirmed: boolean;
}

export function validateViralReplicationInput(input: ViralReplicationInput): string | undefined {
  if (input.model !== "aliyun_strict" && input.model !== "seedance_creative") return "不支持的生成模型";
  if (input.model === "seedance_creative") return "Seedance 创意复刻尚未开放，不能创建付费任务";
  if (!input.referenceVideoUrl && !input.referenceFileId) return "请上传已授权原视频，或填写可直接读取的视频文件链接";
  if (!input.portraitImageUrl && !input.portraitFileId) return "请上传本人或已授权主角照片，或填写可直接读取的图片链接";
  if (![input.visualRightsConfirmed, input.audioRightsConfirmed, input.performerConsentConfirmed, input.portraitConsentConfirmed].every(Boolean)) {
    return "请确认原视频、原音频、原主角肖像和替换照片均已取得授权";
  }
  for (const url of [input.referenceVideoUrl, input.portraitImageUrl].filter(Boolean) as string[]) {
    const issue = validateDirectAssetUrl(url);
    if (issue) return issue;
  }
  return undefined;
}

export function validateDirectAssetUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || url.hash) return "素材链接必须为无凭据的 HTTPS 直链";
    const host = url.hostname.toLowerCase();
    if (isIP(host.replace(/^\[|\]$/g, "")) || !host.includes(".") || host === "localhost" || /\.(local|internal|localhost)$/.test(host)) return "素材链接地址不允许";
    if (PUBLIC_VIDEO_PAGE_HOSTS.has(url.hostname.toLowerCase())) return "不支持平台播放页链接；请上传原文件或提供可直接下载的授权文件链接";
    if (!/\.(mp4|avi|mov|jpg|jpeg|png|bmp|webp)$/i.test(url.pathname)) return "链接必须直接指向视频或图片文件，不能是网页播放页";
    return undefined;
  } catch {
    return "素材链接格式不正确";
  }
}

export function isAliyunReplicationConfigured(): boolean {
  try {
    replicationApiOrigin(process.env.ALIYUN_VIDEO_REPLICATION_ENDPOINT ?? "");
    return Boolean(process.env.ALIYUN_VIDEO_REPLICATION_API_KEY && (!process.env.ALIYUN_VIDEO_REPLICATION_MODEL || process.env.ALIYUN_VIDEO_REPLICATION_MODEL === REPLICATION_MODEL));
  } catch { return false; }
}

export function buildAliyunReplicationRequest(input: Required<Pick<ViralReplicationInput, "referenceVideoUrl" | "portraitImageUrl">> & { mode?: "wan-std" | "wan-pro" }): Record<string, unknown> {
  if (validateDirectAssetUrl(input.referenceVideoUrl) || validateDirectAssetUrl(input.portraitImageUrl)) throw new Error("replication_asset_url_rejected");
  return {
    model: REPLICATION_MODEL,
    input: { video_url: input.referenceVideoUrl, image_url: input.portraitImageUrl, watermark: true },
    parameters: { mode: input.mode ?? "wan-std", check_image: true }
  };
}

export function replicationApiOrigin(endpoint: string): string {
  const u = new URL(endpoint);
  // Existing Beijing endpoint only. Region/workspace migration requires a separate reviewed config.
  if (u.origin !== "https://dashscope.aliyuncs.com" || u.pathname !== "/api/v1/services/aigc/image2video/video-synthesis" || u.search || u.hash || u.username || u.password) throw new Error("replication_endpoint_rejected");
  return u.origin;
}

export function replicationCapabilityGaps(input: ReplicationRequest): string[] {
  return [input.model !== "aliyun_strict" && "model_not_supported", input.style !== "preserve_original" && "style_transfer_not_supported",
    input.environmentFileIds.length > 0 && "background_replacement_not_supported", Boolean(input.script?.trim()) && "new_speech_not_supported",
    Boolean(input.voiceId) && "voice_cloning_not_supported", input.subtitles && "subtitle_composition_not_supported"].filter(Boolean) as string[];
}

export type ReplicationAssetEvidence = {
  fileId: string; tenantId: string; storeId: string; sha256: string; evidenceId: string;
  role: "reference" | "owner" | "kol"; rights: readonly string[]; expiresAt: number; authorizationVersion?: number;
  mimeType: string; bytes: number; width: number; height: number; durationSeconds?: number;
};
export type ReplicationAdmission = {
  // 共享出片能力：权益可能来自美业单品或兰琪工作台（见 video-replication-entitlement.ts）。
  tenantId: string; userId: string; storeId: string; productCode: VideoReplicationProductCode;
  entitlement: boolean; allowedStoreIds: readonly string[]; reference: ReplicationAssetEvidence; portrait: ReplicationAssetEvidence;
  creditCost: number; maxCostFen: number; maxOutputSeconds: number; stagingReady: boolean;
  stagingLeaseId?: string; executionPermitId?: string;
};

/** Server evidence only; never parse this type out of a client body. */
export function validateReplicationAdmission(input: ReplicationRequest, a: ReplicationAdmission, now = Date.now()): string[] {
  const issues = replicationCapabilityGaps(input);
  if (!a.entitlement || !isVideoReplicationProductCode(a.productCode) || !a.allowedStoreIds.includes(a.storeId)) issues.push("replication_access_denied");
  for (const [asset, fileId, role, rights] of [
    [a.reference, input.referenceFileId, "reference", ["visual", "audio", "performer"]],
    [a.portrait, input.portraitFileId, input.template === "kol_visit" ? "kol" : "owner", ["portrait"]]
  ] as const) {
    if (!fileId || asset.fileId !== fileId || asset.tenantId !== a.tenantId || asset.storeId !== a.storeId) issues.push("asset_not_found");
    if (asset.role !== role || !asset.evidenceId || !/^[a-f0-9]{64}$/.test(asset.sha256) || !Number.isFinite(asset.expiresAt) || asset.expiresAt <= now || rights.some(r => !asset.rights.includes(r))) issues.push("asset_authorization_required");
    const video = role === "reference", maxDimension = video ? 2048 : 4096;
    if (![asset.width, asset.height, asset.bytes].every(Number.isFinite) || asset.width < 200 || asset.height < 200 || asset.width > maxDimension || asset.height > maxDimension || asset.width / asset.height < 1/3 || asset.width / asset.height > 3 || asset.bytes <= 0 || asset.bytes > (video ? 200 : 5) * 1024 * 1024) issues.push("asset_metadata_invalid");
    if (!(video ? ["video/mp4", "video/quicktime", "video/x-msvideo"] : ["image/jpeg", "image/png", "image/bmp", "image/webp"]).includes(asset.mimeType)) issues.push("asset_type_invalid");
  }
  const seconds = a.reference.durationSeconds;
  if (!Number.isFinite(seconds) || seconds! < 2 || seconds! > 30) issues.push("reference_duration_invalid");
  // Integer fen; conservative whole-second output cap (not a model duration parameter).
  if (!Number.isInteger(a.maxOutputSeconds) || a.maxOutputSeconds < Math.ceil(seconds ?? 31) || a.maxOutputSeconds > 30 || !Number.isSafeInteger(a.maxCostFen) || a.maxCostFen < a.maxOutputSeconds * (input.mode === "wan-pro" ? 90 : 60)) issues.push("provider_budget_exceeded");
  if (!Number.isSafeInteger(a.creditCost) || a.creditCost <= 0) issues.push("credit_quote_unavailable");
  if (!a.stagingReady) issues.push("secure_staging_required");
  return [...new Set(issues)];
}

export class ReplicationProviderError extends Error {
  constructor(public readonly code: string, public readonly uncertain: boolean, public readonly httpStatus?: number) { super(code); }
}

export function createReplicationProvider(config: { endpoint: string; apiKey: string; fetch?: typeof fetch; timeoutMs?: number }) {
  const origin = replicationApiOrigin(config.endpoint);
  const transport = config.fetch ?? fetch;
  async function call(url: string, init: RequestInit): Promise<any> {
    try {
      const response = await transport(url, { ...init, redirect: "error", signal: AbortSignal.timeout(config.timeoutMs ?? 30_000) });
      if (!response.ok) throw new ReplicationProviderError(`provider_http_${response.status}`, response.status >= 500 || response.status === 408 || response.status === 429, response.status);
      if (!response.body) throw new ReplicationProviderError("provider_response_unknown", true);
      const reader = response.body.getReader(), parts: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const chunk = await reader.read(); if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > 64_000) throw new ReplicationProviderError("provider_response_too_large", true);
          parts.push(chunk.value);
        }
      } finally { await reader.cancel().catch(() => undefined); }
      return JSON.parse(Buffer.concat(parts).toString("utf8"));
    } catch (error) {
      if (error instanceof ReplicationProviderError) throw error;
      throw new ReplicationProviderError("provider_response_unknown", true);
    }
  }
  return {
    async submit(input: { referenceVideoUrl: string; portraitImageUrl: string; mode: "wan-std" | "wan-pro" }): Promise<string> {
      const body = await call(config.endpoint, { method: "POST", headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json", "X-DashScope-Async": "enable" }, body: JSON.stringify(buildAliyunReplicationRequest(input)) });
      if (!/^[a-zA-Z0-9_-]{1,200}$/.test(body?.output?.task_id ?? "") || !["PENDING", "RUNNING"].includes(body?.output?.task_status)) throw new ReplicationProviderError("provider_task_id_missing", true);
      return body.output.task_id;
    },
    async poll(taskId: string): Promise<{ status: string; videoUrl?: string; seconds?: number }> {
      if (!/^[a-zA-Z0-9_-]{1,200}$/.test(taskId)) throw new ReplicationProviderError("provider_task_id_invalid", true);
      const body = await call(`${origin}/api/v1/tasks/${taskId}`, { method: "GET", headers: { Authorization: `Bearer ${config.apiKey}` } });
      const out = body?.output;
      if (out?.task_id !== taskId || !["PENDING", "RUNNING", "SUCCEEDED", "FAILED", "CANCELED", "UNKNOWN"].includes(out?.task_status)) throw new ReplicationProviderError("provider_status_invalid", true);
      return { status: out.task_status, videoUrl: typeof out.results?.video_url === "string" ? out.results.video_url : undefined, seconds: typeof body.usage?.video_duration === "number" ? body.usage.video_duration : undefined };
    }
  };
}

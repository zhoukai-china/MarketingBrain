import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import OSS from "ali-oss";
import { prisma } from "@baolu/db";
import { consumeWalletCredits, refundWalletCredits } from "./sitong-wallet.js";
// 用 ReplicationError（而非裸 Error）抛业务码：路由的 safeError 只认 ReplicationError，
// 裸 Error 会被兜底成 503 +「当前步骤未完成…」，把「余额不足/能力未配置」这类**可执行**的原因吞掉。
import { ReplicationError } from "./viral-video-replication-runtime.js";

/**
 * 爆款复刻 · 换脸链路（阿里云视觉智能开放平台「视频人脸融合」）。
 * 2026-10-06 本地先行：只在本地 dev 启用，未上线。
 *
 * 能力边界（2026-10-06 实测）：
 *   · 只动脸，原片文字 / 字幕 / 背景全保留；无脸帧原样通过；
 *   · 主角戴眼镜 / 口罩 / 遮挡 → 静默跳过（不报错、原样输出、照样计费）→ 上传环节必须前置质检；
 *   · 输出分辨率 / 清晰度跟随原片；失败调用不计费；结果 URL 30 分钟有效，必须及时转存。
 */

const VIAPI_AK = process.env.ALIYUN_VIAPI_AK_ID ?? "";
const VIAPI_SK = process.env.ALIYUN_VIAPI_AK_SECRET ?? "";
const OSS_BUCKET = process.env.ALIYUN_VIAPI_OSS_BUCKET ?? "";
const OSS_REGION = (process.env.ALIYUN_VIAPI_OSS_REGION ?? "oss-cn-shanghai").replace(/^oss-/, "");
const HOST = OSS_BUCKET + ".oss-" + OSS_REGION + ".aliyuncs.com";
/** 对门店的换脸定价（算力/秒）：厂商成本约 0.013 元/秒（0.8 元/分钟），1 算力 ≈ 0.1 元。 */
const CREDITS_PER_SECOND = Math.max(1, Number(process.env.ALIYUN_FACEFUSE_CREDITS_PER_SECOND ?? "2"));
const MAX_DURATION_SECONDS = 300;
const OSS_HOST = OSS_BUCKET + "." + OSS_REGION + ".aliyuncs.com";

const execFileAsync = promisify(execFile);
const pct = (v: string) => encodeURIComponent(v).replace(/\+/g, "%20").replace(/\*/g, "%2A").replace(/%7E/g, "~");

type FuseJobStatus = "submitted" | "processing" | "succeeded" | "failed";

type FuseJob = {
  jobId: string;
  tenantId: string;
  userId: string;
  requestKey: string;
  creditCost: number;
  spent?: { paid: number; bonus: number };
  videoKey: string;
  photoKey: string;
  status: FuseJobStatus;
  localPath?: string;
  errorCode?: string;
  errorMessage?: string;
  createdAt: number;
};

/** 本地进程内任务表：重启即失（本地先行版可接受；上线版要落库）。 */
const jobs = new Map<string, FuseJob>();

export function faceFuseConfigured(): boolean {
  return Boolean(VIAPI_AK && VIAPI_SK && OSS_BUCKET);
}

export function faceFuseCreditsPerSecond(): number {
  return CREDITS_PER_SECOND;
}

async function probeDurationSeconds(filePath: string): Promise<number> {
  const { stdout } = await execFileAsync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", filePath],
    { timeout: 30_000, maxBuffer: 1024 * 1024 }
  );
  const duration = Number(stdout.trim());
  if (!Number.isFinite(duration) || duration <= 0) throw new ReplicationError("fuse_probe_failed", 422);
  return duration;
}

// ── 阿里云 POP RPC 签名（videoenhan）──

async function viapi(action: string, extra: Record<string, string>): Promise<any> {
  const params: Record<string, string> = {
    Action: action,
    Format: "JSON",
    Version: "2020-03-20",
    AccessKeyId: VIAPI_AK,
    SignatureMethod: "HMAC-SHA1",
    SignatureVersion: "1.0",
    SignatureNonce: crypto.randomUUID(),
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    ...extra
  };
  const canonical = Object.keys(params).sort().map((k) => pct(k) + "=" + pct(params[k])).join("&");
  const str = "GET&" + pct("/") + "&" + pct(canonical);
  const sig = crypto.createHmac("sha1", VIAPI_SK + "&").update(str).digest("base64");
  const res = await fetch("https://videoenhan.cn-shanghai.aliyuncs.com/?" + canonical + "&Signature=" + pct(sig));
  const body = (await res.json()) as any;
  if (body.code) {
    throw Object.assign(new Error(body.Message ?? body.code), { statusCode: 502, fuseCode: body.code });
  }
  return body;
}

// ── OSS（ali-oss V4 签名；新桶默认禁 V1，必须 authorizationV4）──

const ossClient = OSS_BUCKET
  ? new OSS({
      region: "oss-" + OSS_REGION,
      accessKeyId: VIAPI_AK,
      accessKeySecret: VIAPI_SK,
      bucket: OSS_BUCKET,
      authorizationV4: true,
      secure: true
    })
  : undefined;

async function viapiPoll(jobId: string): Promise<{ status: string; videoUrl?: string; errorCode?: string; errorMessage?: string }> {
  const body = await viapi("GetAsyncJobResult", { JobId: jobId });
  const data = body.Data ?? {};
  const rawResult = typeof data.Result === "string" ? safeParse(data.Result) : data.Result ?? {};
  return {
    status: String(data.Status ?? "UNKNOWN"),
    videoUrl: rawResult.videoUrl,
    errorCode: data.ErrorCode,
    errorMessage: data.ErrorMessage
  };
}

function safeParse(text: string): any {
  try { return JSON.parse(text); } catch { return {}; }
}

export type FuseQuote = {
  canConfirm: boolean;
  creditCost: number;
  durationSeconds: number;
  message: string;
  gaps: string[];
};

export async function quoteFaceFusion(params: { videoPath: string; portraitPath: string; creditBalance: number | null }): Promise<FuseQuote> {
  if (!faceFuseConfigured()) {
    return { canConfirm: false, creditCost: 0, durationSeconds: 0, message: "换脸能力未配置（缺少视觉智能平台凭证）。", gaps: ["facefuse_not_configured"] };
  }
  const durationSeconds = await probeDurationSeconds(params.videoPath);
  if (durationSeconds < 1 || durationSeconds > MAX_DURATION_SECONDS) {
    return { canConfirm: false, creditCost: 0, durationSeconds, message: `视频时长需在 1–${MAX_DURATION_SECONDS} 秒之间。`, gaps: ["duration_out_of_range"] };
  }
  const creditCost = Math.max(1, Math.ceil(durationSeconds) * CREDITS_PER_SECOND);
  if (params.creditBalance !== null && params.creditBalance < creditCost) {
    return { canConfirm: false, creditCost, durationSeconds, message: `算力余额不足：本次预计 ${creditCost} 算力，请先充值。`, gaps: ["insufficient_credits"] };
  }
  return {
    canConfirm: true,
    creditCost,
    durationSeconds,
    gaps: [],
    message: `换脸报价：${Math.ceil(durationSeconds)} 秒 × ${CREDITS_PER_SECOND} 算力/秒 = ${creditCost} 算力。只换主角的脸，原片文字 / 字幕 / 配音全部保留。`
  };
}

export type FuseSubmitResult = { jobId: string };

export async function submitFaceFusion(params: {
  tenantId: string;
  userId: string;
  requestKey: string;
  videoPath: string;
  portraitPath: string;
  creditCost: number;
}): Promise<FuseSubmitResult> {
  if (!faceFuseConfigured() || !ossClient) throw new ReplicationError("facefuse_not_configured", 503);
  const durationSeconds = await probeDurationSeconds(params.videoPath);
  const creditCost = Math.max(1, Math.ceil(durationSeconds) * CREDITS_PER_SECOND);

  // 幂等：同一 requestKey 只扣一次、只提交一次。
  for (const job of jobs.values()) {
    if (job.requestKey === params.requestKey && job.tenantId === params.tenantId) {
      return { jobId: job.jobId };
    }
  }

  const consumed = await consumeWalletCredits({
    userId: params.userId,
    requestId: "fuse-" + params.requestKey,
    price: creditCost,
    skillId: "viral_face_fusion",
    paidOnly: true,
    source: "web"
  });
  if (consumed.status === "insufficient") {
    // 视频生成只认充值算力（paidOnly）。这里必须回业务码 insufficient_credits：
    // 前端按码给出「充值算力不足…请点右上角我的·充值」，被兜底成 503 通用文案用户无从下手。
    throw new ReplicationError("insufficient_credits", 402);
  }

  const videoKey = `fuse/${params.tenantId}/${params.requestKey}-video.mp4`;
  const photoKey = `fuse/${params.tenantId}/${params.requestKey}-portrait.jpg`;
  try {
    await ossClient.put(videoKey, params.videoPath);
    await ossClient.put(photoKey, params.portraitPath);
    const videoUrl = await ossClient.asyncSignatureUrl(videoKey, { method: "GET", expires: 7200 });
    const photoUrl = await ossClient.asyncSignatureUrl(photoKey, { method: "GET", expires: 7200 });
    const submitted = await viapi("MergeVideoFace", {
      VideoURL: videoUrl,
      ReferenceURL: photoUrl,
      FaceImageURL: "",
      AddWatermark: "false",
      Enhance: "true"
    });
    const jobId = String(submitted.RequestId);
    jobs.set(jobId, {
      jobId,
      tenantId: params.tenantId,
      userId: params.userId,
      requestKey: params.requestKey,
      creditCost,
      spent: consumed.spent,
      videoKey,
      photoKey,
      status: "submitted",
      createdAt: Date.now()
    });
    return { jobId };
  } catch (error) {
    // 提交失败必须全额退回，且按同一幂等键可重试。
    await refundWalletCredits({
      userId: params.userId,
      requestId: "fuse-" + params.requestKey,
      breakdown: consumed.spent,
      skillId: "viral_face_fusion",
      reason: "fuse_submit_failed"
    });
    throw error;
  }
}

const UPLOAD_ROOT = path.resolve(process.cwd(), "uploads", "fuse");

export async function pollFaceFusion(jobId: string, tenantId: string): Promise<FuseJob | undefined> {
  const job = jobs.get(jobId);
  if (!job || job.tenantId !== tenantId) return undefined;
  if (job.status === "succeeded" || job.status === "failed") return job;
  const remote = await viapiPoll(jobId);
  if (remote.status === "PROCESS_SUCCESS" && remote.videoUrl) {
    const dir = path.join(UPLOAD_ROOT, job.tenantId);
    await mkdir(dir, { recursive: true });
    const localPath = path.join(dir, job.jobId + ".mp4");
    const bin = Buffer.from(await (await fetch(remote.videoUrl)).arrayBuffer());
    await writeFile(localPath, bin);
    job.status = "succeeded";
    job.localPath = localPath;
  } else if (remote.status === "PROCESS_FAILED" || remote.status === "FAILED") {
    job.status = "failed";
    job.errorCode = remote.errorCode;
    job.errorMessage = remote.errorMessage;
    if (job.spent) {
      await refundWalletCredits({
        userId: job.userId,
        requestId: "fuse-" + job.requestKey,
        breakdown: job.spent,
        skillId: "viral_face_fusion",
        reason: remote.errorCode ?? "fuse_failed"
      });
    }
  } else {
    job.status = "processing";
  }
  return job;
}

export async function readFuseAsset(jobId: string, tenantId: string): Promise<{ bytes: Buffer; localPath: string } | undefined> {
  const job = jobs.get(jobId);
  if (!job || job.tenantId !== tenantId || job.status !== "succeeded" || !job.localPath) return undefined;
  const bytes = await readFile(job.localPath);
  return { bytes, localPath: job.localPath };
}

export async function loadUploadedFilePath(fileId: string, tenantId: string): Promise<string> {
  const row = await prisma.uploadedFile.findFirst({ where: { id: fileId, tenantId } });
  if (!row) throw Object.assign(new Error("fuse_file_not_found"), { statusCode: 404 });
  return row.storagePath;
}

export function faceFuseInputValid(videoMime: string, portraitMime: string): string[] {
  const gaps: string[] = [];
  if (!/^video\/(mp4|quicktime)$/.test(videoMime)) gaps.push("原片仅支持 MP4 / MOV");
  if (!/^image\/(jpeg|png|webp)$/.test(portraitMime)) gaps.push("人物照片仅支持 JPG / PNG / WebP");
  return gaps;
}

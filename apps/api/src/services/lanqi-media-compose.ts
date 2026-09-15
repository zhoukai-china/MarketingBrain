import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { prisma } from "@baolu/db";
import { env } from "../config/env.js";
import {
  persistLanqiComposedVideo,
  readLanqiComposeIndex,
  readLanqiMediaAsset,
  writeLanqiComposeIndex,
} from "./lanqi-media-assets.js";

const execFileAsync = promisify(execFile);

/**
 * LQ-32 一键成片「合成成片」：把逐镜生成的无声 MP4 按分镜顺序拼成一条，
 * 再混入门店上传的音轨（音频文件，或带声音的视频抽出来的音轨）。
 *
 * 技术事实（必须如实告知用户，不能靠话术遮盖）：
 *  · 视频模型 wan2.6-i2v-flash 只出**无声**成片（`parameters.audio=false`），所以声音只能来自本地混流；
 *  · 拼接与混音全部由本机 ffmpeg 完成，不调用外部付费接口，因此**不额外扣积分**；
 *  · 音轨比成片短时循环播放，以画面长度为准（`-stream_loop -1` + `-shortest`）。
 */
export const LANQI_COMPOSE_VERSION = "lanqi_media_compose_v1";
export const LANQI_COMPOSE_MAX_SHOTS = 12;
export const LANQI_COMPOSE_MIN_SHOTS = 2;
/** 音轨来源（音频 / 视频）单文件上限，与 multipart 30MB 上限留出余量。 */
export const LANQI_COMPOSE_AUDIO_MAX_BYTES = 20 * 1024 * 1024;
export const LANQI_COMPOSE_MAX_OUTPUT_BYTES = 200 * 1024 * 1024;
const COMPOSE_TIMEOUT_MS = 15 * 60_000;
const PROBE_TIMEOUT_MS = 30_000;
const COMPOSE_FPS = 30;
const FALLBACK_CANVAS: [number, number] = [720, 1280];
const requestKeyPattern = /^[A-Za-z0-9_-]{12,120}$/;

export type LanqiComposeErrorCode =
  | "invalid_compose_request"
  | "audio_rights_required"
  | "audio_file_not_found"
  | "audio_file_unsupported"
  | "audio_file_too_large"
  | "audio_track_missing"
  | "shot_not_found"
  | "shots_not_ready"
  | "compose_tool_unavailable"
  | "compose_failed"
  | "media_asset_storage_not_ready";

export class LanqiComposeError extends Error {
  constructor(readonly code: LanqiComposeErrorCode, message: string, readonly status = 400) {
    super(message);
  }
}

export type LanqiComposeInput = {
  tenantId: string;
  shotJobIds: string[];
  audioFileId?: string;
  audioRightsConfirmed?: boolean;
  requestKey: string;
};

export type LanqiComposeResult = {
  composeId: string;
  assetUrl: string;
  downloadUrl: string;
  durationSeconds: number;
  bytes: number;
  shotCount: number;
  audioIncluded: boolean;
  audioSource?: "audio_file" | "video_audio_track";
  idempotent: boolean;
  notice: string;
};

/** 只依赖两个模型的窄接口，便于离线回归直接注入内存库（不连真库）。 */
export type LanqiComposeDb = {
  lanqiMediaJob: { findMany: (args: unknown) => Promise<Array<{ id: string; status: string; assetStatus: string; durationSeconds?: number | null }>> };
  uploadedFile: { findFirst: (args: unknown) => Promise<{ id: string; filename: string; mimeType: string; byteSize: number; storagePath: string } | null> };
};

export async function composeLanqiShots(input: LanqiComposeInput, db: LanqiComposeDb = prisma as unknown as LanqiComposeDb): Promise<LanqiComposeResult> {
  const shotJobIds = dedupe(input.shotJobIds);
  if (shotJobIds.length < LANQI_COMPOSE_MIN_SHOTS || shotJobIds.length > LANQI_COMPOSE_MAX_SHOTS) {
    throw new LanqiComposeError("invalid_compose_request", `合成至少需要 ${LANQI_COMPOSE_MIN_SHOTS} 镜、最多 ${LANQI_COMPOSE_MAX_SHOTS} 镜。`);
  }
  if (!requestKeyPattern.test(input.requestKey)) {
    throw new LanqiComposeError("invalid_compose_request", "缺少幂等键，请刷新页面后重试。");
  }
  if (input.audioFileId && input.audioRightsConfirmed !== true) {
    throw new LanqiComposeError("audio_rights_required", "带音轨的成片必须先确认你拥有这段音频 / 视频的使用权。");
  }

  const cached = await readLanqiComposeIndex({ tenantId: input.tenantId, requestKey: input.requestKey });
  if (cached) {
    try {
      const asset = await readLanqiMediaAsset({ tenantId: input.tenantId, jobId: cached.composeId });
      return toResult({ composeId: cached.composeId, metadata: asset.metadata, idempotent: true });
    } catch {
      // 索引还在但成片已被清理：按未合成处理，重新合成一次。
    }
  }

  const jobs = await db.lanqiMediaJob.findMany({ where: { id: { in: shotJobIds }, tenantId: input.tenantId } });
  const byId = new Map(jobs.map(job => [job.id, job]));
  const missing = shotJobIds.filter(id => !byId.has(id));
  if (missing.length) throw new LanqiComposeError("shot_not_found", "有镜次不属于当前账号或已不存在，无法合成。", 404);
  const notReady = shotJobIds
    .map((id, index) => ({ index: index + 1, job: byId.get(id)! }))
    .filter(item => item.job.status !== "succeeded" || item.job.assetStatus !== "persisted")
    .map(item => item.index);
  if (notReady.length) {
    throw new LanqiComposeError("shots_not_ready", `第 ${notReady.join(" / ")} 镜还没出片成功，全部出片后再合成。`, 409);
  }

  const audio = input.audioFileId ? await resolveTenantAudioSource({ tenantId: input.tenantId, fileId: input.audioFileId }, db) : undefined;

  const workRoot = await mkdtemp(path.join(tmpdir(), "lanqi-compose-"));
  try {
    const shotPaths: string[] = [];
    for (const [index, jobId] of shotJobIds.entries()) {
      const asset = await readLanqiMediaAsset({ tenantId: input.tenantId, jobId });
      const target = path.join(workRoot, `shot-${String(index + 1).padStart(2, "0")}.mp4`);
      await writeFile(target, asset.bytes);
      shotPaths.push(target);
    }
    let audioPath: string | undefined;
    if (audio) {
      audioPath = path.join(workRoot, `audio-track${path.extname(audio.filename).toLowerCase() || ".bin"}`);
      await writeFile(audioPath, await readFile(audio.storagePath));
    }

    const outputPath = path.join(workRoot, "composed.mp4");
    const probed = await Promise.all(shotPaths.map(file => probeMedia(file)));
    const durationSeconds = Math.max(1, Math.round(probed.reduce((sum, item) => sum + (item.durationSeconds ?? 0), 0)));
    const [width, height] = canvasFor(probed[0]);

    const ffmpeg = await resolveBinary("ffmpeg");
    const args: string[] = ["-y", "-hide_banner", "-loglevel", "error", "-nostdin"];
    for (const file of shotPaths) args.push("-i", file);
    if (audioPath) args.push("-stream_loop", "-1", "-i", audioPath);
    const filters = shotPaths.map((_, index) =>
      `[${index}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${COMPOSE_FPS},format=yuv420p[v${index}]`
    );
    filters.push(`${shotPaths.map((_, index) => `[v${index}]`).join("")}concat=n=${shotPaths.length}:v=1:a=0[vout]`);
    args.push("-filter_complex", filters.join(";"), "-map", "[vout]");
    if (audioPath) args.push("-map", `${shotPaths.length}:a:0`);
    args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p");
    if (audioPath) args.push("-c:a", "aac", "-b:a", "128k", "-ac", "2", "-ar", "44100", "-shortest");
    args.push("-movflags", "+faststart", outputPath);

    try {
      await execFileAsync(ffmpeg, args, { timeout: COMPOSE_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
    } catch (error) {
      const failure = error as NodeJS.ErrnoException & { stderr?: string };
      if (failure.code === "ENOENT") throw new LanqiComposeError("compose_tool_unavailable", "本机合成工具不可用，这次没有产出成片。", 503);
      if (audioPath && /matches no streams|Stream map .* matches no streams|does not contain any stream/i.test(failure.stderr ?? "")) {
        throw new LanqiComposeError("audio_track_missing", "这段音轨里没有可用的声音（视频可能是无声的），请换一段带声音的文件。");
      }
      throw new LanqiComposeError("compose_failed", "合成失败，本次没有产出成片，请重试或换一段音轨。", 502);
    }

    const output = await stat(outputPath);
    if (output.size === 0 || output.size > LANQI_COMPOSE_MAX_OUTPUT_BYTES) {
      throw new LanqiComposeError("compose_failed", "合成结果大小异常，本次没有产出成片。", 502);
    }
    const bytes = await readFile(outputPath);
    if (bytes.subarray(4, 8).toString("latin1") !== "ftyp") {
      throw new LanqiComposeError("compose_failed", "合成结果不是有效的 MP4，本次没有产出成片。", 502);
    }

    const composeId = `cmp-${randomBytes(12).toString("hex")}`;
    const metadata = await persistLanqiComposedVideo({
      tenantId: input.tenantId,
      jobId: composeId,
      bytes,
      composed: {
        shotCount: shotPaths.length,
        audioIncluded: Boolean(audioPath),
        ...(audio ? { audioSource: audio.source } : {}),
        durationSeconds,
        requestKey: input.requestKey,
      },
    });
    await writeLanqiComposeIndex({ tenantId: input.tenantId, requestKey: input.requestKey, composeId });
    return toResult({ composeId, metadata, idempotent: false });
  } finally {
    await rm(workRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** 取本租户已上传的音轨来源文件：音频直接用，视频由 ffmpeg 抽音。 */
async function resolveTenantAudioSource(params: { tenantId: string; fileId: string }, db: LanqiComposeDb): Promise<{
  storagePath: string;
  filename: string;
  source: "audio_file" | "video_audio_track";
}> {
  const file = await db.uploadedFile.findFirst({ where: { id: params.fileId, tenantId: params.tenantId } });
  if (!file) throw new LanqiComposeError("audio_file_not_found", "这段音轨文件不属于当前账号，无法使用。", 404);
  const mimeType = (file.mimeType ?? "").toLowerCase();
  const isAudio = mimeType.startsWith("audio/");
  const isVideo = mimeType.startsWith("video/");
  if (!isAudio && !isVideo) throw new LanqiComposeError("audio_file_unsupported", "音轨只支持音频文件，或带声音的 MP4 / MOV。", 400);
  if (file.byteSize > LANQI_COMPOSE_AUDIO_MAX_BYTES) {
    throw new LanqiComposeError("audio_file_too_large", `音轨文件不能超过 ${Math.round(LANQI_COMPOSE_AUDIO_MAX_BYTES / 1024 / 1024)}MB，请先裁短或压缩。`);
  }
  const uploadRoot = path.resolve(env.UPLOAD_DIR);
  const storagePath = path.resolve(file.storagePath);
  if (!storagePath.startsWith(`${uploadRoot}${path.sep}`)) {
    throw new LanqiComposeError("audio_file_not_found", "这段音轨文件读不到，请重新上传。", 404);
  }
  return { storagePath, filename: file.filename, source: isVideo ? "video_audio_track" : "audio_file" };
}

function toResult(params: { composeId: string; metadata: Awaited<ReturnType<typeof readLanqiMediaAsset>>["metadata"]; idempotent: boolean }): LanqiComposeResult {
  const composed = params.metadata.composed;
  const audioIncluded = Boolean(composed?.audioIncluded);
  return {
    composeId: params.composeId,
    assetUrl: `/lanqi/media/compose/${encodeURIComponent(params.composeId)}`,
    downloadUrl: `/lanqi/media/compose/${encodeURIComponent(params.composeId)}/download`,
    durationSeconds: composed?.durationSeconds ?? 0,
    bytes: params.metadata.bytes,
    shotCount: composed?.shotCount ?? 0,
    audioIncluded,
    ...(composed?.audioSource ? { audioSource: composed.audioSource } : {}),
    idempotent: params.idempotent,
    notice: audioIncluded
      ? "已将各镜画面按顺序拼成一条成片，并混入你提供的音轨；合片与混音不额外扣积分。"
      : "已将各镜画面按顺序拼成一条成片（未带音轨）；合片不额外扣积分。",
  };
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}

function canvasFor(probe: { width?: number; height?: number } | undefined): [number, number] {
  const width = even(probe?.width);
  const height = even(probe?.height);
  if (width && height) return [width, height];
  return FALLBACK_CANVAS;
}

function even(value?: number): number | undefined {
  if (!value || !Number.isFinite(value) || value < 2) return undefined;
  const rounded = Math.round(value);
  return rounded % 2 === 0 ? rounded : rounded - 1;
}

export async function probeMedia(file: string): Promise<{ width?: number; height?: number; durationSeconds?: number }> {
  const ffprobe = await resolveBinary("ffprobe");
  const { stdout } = await execFileAsync(
    ffprobe,
    ["-v", "error", "-show_entries", "stream=width,height:format=duration", "-of", "json", file],
    { timeout: PROBE_TIMEOUT_MS, maxBuffer: 1024 * 1024, windowsHide: true }
  );
  const parsed = JSON.parse(stdout) as { streams?: Array<{ width?: number; height?: number }>; format?: { duration?: string } };
  const stream = parsed.streams?.[0];
  const duration = Number(parsed.format?.duration);
  return {
    width: stream?.width,
    height: stream?.height,
    durationSeconds: Number.isFinite(duration) && duration > 0 ? duration : undefined,
  };
}

/** 与 `routes/media.ts` 同一套解析规则：优先本机 WorkBuddy 自带二进制，否则走 PATH（生产是 /usr/local/bin）。 */
async function resolveBinary(binaryName: "ffmpeg" | "ffprobe"): Promise<string> {
  const bundled = path.join(
    process.env.USERPROFILE ?? "",
    ".workbuddy",
    "binaries",
    "ffmpeg",
    "ffmpeg-8.1.1-essentials_build",
    "bin",
    `${binaryName}.exe`
  );
  try {
    await execFileAsync(bundled, ["-version"], { timeout: 5000, windowsHide: true });
    return bundled;
  } catch {
    return binaryName;
  }
}

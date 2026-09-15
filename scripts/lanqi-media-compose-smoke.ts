/**
 * LQ-32 回归（先红后绿）：一键成片「合成成片 = 按分镜拼接 + 混入音轨」。
 *
 * 背景：视频模型 `wan2.6-i2v-flash` 只出**无声**成片（下发 `audio:false`），而「一键成片」此前
 * 只按镜交付、没有任何拼接与混音能力，页面音频卡的上传按钮还被写死 `disabled`
 * → 老板上传了音频也拿不到带声音的成片。
 *
 * 覆盖（全部离线：内存库 + 本机 ffmpeg 现造合成素材，不发外部请求、不花钱）：
 *   1. 参数与授权门禁：镜数越界 / 幂等键非法 → invalid_compose_request；带音轨未勾授权 → audio_rights_required；
 *   2. 跨租户：镜次不属于本租户 → 404 shot_not_found；音轨文件不属于本租户 → 404 audio_file_not_found；
 *   3. 未出片：有镜次还在跑 → 409 shots_not_ready；音轨过大 → audio_file_too_large；
 *   4. 正常路径（无音轨）：两镜拼成一条，时长≈各镜之和，且**没有**音频流；
 *   5. 正常路径（音频音轨）：混入更长的音频 → 成片带音频流且以画面长度为准；
 *   6. 正常路径（短音轨循环）：音轨比画面短 → 循环补齐，成片仍是画面长度；
 *   7. 正常路径（视频抽音）：用带声音的视频当音轨 → 成片带音频流，audioSource=video_audio_track；
 *   8. 失败路径：拿一段**无声视频**当音轨 → audio_track_missing（不静默出无声成片冒充成功）；
 *   9. 幂等：同一 requestKey 重复合成 → 同一条成片、idempotent=true，不重复合成；
 *  10. 租户隔离：成片 A 租户可读，B 租户读不到（落盘路径按租户派生）。
 *
 * 依赖：本机 ffmpeg / ffprobe（开发者机用 WorkBuddy 自带二进制，生产是 /usr/local/bin）。
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

let passed = 0;
const failed: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`PASS  ${name}${detail ? ` :: ${detail}` : ""}`);
  } else {
    failed.push(name);
    console.log(`FAIL  ${name}${detail ? ` :: ${detail}` : ""}`);
  }
}

async function main(): Promise<void> {
  // env 在模块 import 时解析：先把落盘目录与存储开关准备好，再动态导入被测算模块。
  const uploadRoot = await mkdtemp(path.join(os.tmpdir(), "lanqi-compose-upload-"));
  const workRoot = await mkdtemp(path.join(os.tmpdir(), "lanqi-compose-fixtures-"));
  // 音轨文件必须落在 UPLOAD_DIR 之内（服务端只允许读取本平台上传目录里的文件）。
  const fixtureRoot = path.join(uploadRoot, "smoke-files");
  await mkdir(fixtureRoot, { recursive: true });
  process.env.UPLOAD_DIR = uploadRoot;
  process.env.LANQI_MEDIA_ASSET_STORAGE = "local";
  process.env.LANQI_MEDIA_EXECUTION_MODE = process.env.LANQI_MEDIA_EXECUTION_MODE ?? "real";
  process.env.LANQI_MEDIA_REAL_EXECUTION_APPROVED = process.env.LANQI_MEDIA_REAL_EXECUTION_APPROVED ?? "true";

  const [{ LanqiComposeError, composeLanqiShots, probeMedia }, { readLanqiMediaAsset }] = await Promise.all([
    import("../apps/api/src/services/lanqi-media-compose.ts"),
    import("../apps/api/src/services/lanqi-media-assets.ts"),
  ]);

  const ffmpeg = await resolveFfmpeg();
  /** 与本机 ffmpeg 同目录的 ffprobe：用来核对成片里到底有没有音频流。 */
  const ffprobe = ffmpeg.toLowerCase().endsWith(".exe") ? ffmpeg.replace(/ffmpeg\.exe$/i, "ffprobe.exe") : "ffprobe";

  async function streamTypes(file: string): Promise<string[]> {
    const probe = await execFileAsync(ffprobe, ["-v", "error", "-show_entries", "stream=codec_type", "-of", "json", file], { timeout: 30_000, windowsHide: true });
    return (JSON.parse(probe.stdout).streams ?? []).map((stream: { codec_type?: string }) => String(stream.codec_type));
  }

  async function makeClip(name: string, seconds: number, size = "320x480"): Promise<string> {
    const target = path.join(fixtureRoot, name);
    await execFileAsync(
      ffmpeg,
      ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `color=c=steelblue:s=${size}:d=${seconds}:r=30`, "-pix_fmt", "yuv420p", "-an", target],
      { timeout: 60_000, windowsHide: true }
    );
    return target;
  }

  async function makeAudio(name: string, seconds: number): Promise<string> {
    const target = path.join(fixtureRoot, name);
    await execFileAsync(
      ffmpeg,
      ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `sine=frequency=440:duration=${seconds}`, "-c:a", "aac", target],
      { timeout: 60_000, windowsHide: true }
    );
    return target;
  }

  /** 带声音的视频（音轨来源之一）。 */
  async function makeTalkingClip(name: string, seconds: number): Promise<string> {
    const target = path.join(fixtureRoot, name);
    await execFileAsync(
      ffmpeg,
      [
        "-y", "-hide_banner", "-loglevel", "error",
        "-f", "lavfi", "-i", `color=c=seagreen:s=320x480:d=${seconds}:r=30`,
        "-f", "lavfi", "-i", `sine=frequency=660:duration=${seconds}`,
        "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", target,
      ],
      { timeout: 60_000, windowsHide: true }
    );
    return target;
  }

  const tenantA = "smoke-tenant-a-lq32";
  const tenantB = "smoke-tenant-b-lq32";
  const shotOne = await makeClip("shot-1.mp4", 2);
  const shotTwo = await makeClip("shot-2.mp4", 1);
  const longAudio = await makeAudio("bgm-long.m4a", 5);
  const shortAudio = await makeAudio("bgm-short.m4a", 1);
  const talkingClip = await makeTalkingClip("talking.mp4", 3);
  const silentClip = await makeClip("silent-reference.mp4", 2);

  const readyJobs = [
    { id: "shot-job-1", status: "succeeded", assetStatus: "persisted" },
    { id: "shot-job-2", status: "succeeded", assetStatus: "persisted" },
  ];
  const jobBytes: Record<string, Buffer> = {
    "shot-job-1": await readFile(shotOne),
    "shot-job-2": await readFile(shotTwo),
  };

  /** 把镜次资产按「生产落盘格式」写进租户目录，保证后续按租户读得到。 */
  async function seedShotAssets(tenantId: string) {
    const tenantKey = createHash("sha256").update(tenantId).digest("hex").slice(0, 24);
    const dir = path.resolve(uploadRoot, "lanqi-media", tenantKey);
    await mkdir(dir, { recursive: true });
    for (const [jobId, bytes] of Object.entries(jobBytes)) {
      await writeFile(path.join(dir, `${jobId}.mp4`), bytes);
      await writeFile(
        path.join(dir, `${jobId}.json`),
        JSON.stringify({ jobId, tenantKey, contentType: "video/mp4", bytes: bytes.length, createdAt: new Date().toISOString(), retention: "tenant_owned", source: "provider" })
      );
    }
  }
  await seedShotAssets(tenantA);

  /** 只实现合成用到的两个模型查询，跨租户 / 未出片场景靠它返回不同结果。 */
  function fakeDb(options: {
    jobs?: Array<{ id: string; status: string; assetStatus: string }>;
    audio?: { id: string; filename: string; mimeType: string; byteSize: number; storagePath: string } | null;
  }) {
    return {
      lanqiMediaJob: { findMany: async () => options.jobs ?? [] },
      uploadedFile: { findFirst: async () => options.audio ?? null },
    };
  }

  async function expectComposeError(name: string, run: () => Promise<unknown>, code: string, status?: number) {
    try {
      await run();
      check(name, false, `未抛出 ${code}`);
    } catch (error) {
      const failure = error as { code?: string; status?: number };
      const ok = error instanceof LanqiComposeError && failure.code === code && (status === undefined || failure.status === status);
      check(name, ok, ok ? code : `实际 ${failure.code ?? "unknown"} / ${failure.status ?? "-"}`);
    }
  }

  const baseInput = { tenantId: tenantA, shotJobIds: ["shot-job-1", "shot-job-2"], requestKey: "smoke-request-key-0001" };
  const audioInput = (fileId: string, requestKey: string, audio: { filename: string; mimeType: string; byteSize: number; storagePath: string }) =>
    composeLanqiShots(
      { ...baseInput, audioFileId: fileId, audioRightsConfirmed: true, requestKey },
      fakeDb({ jobs: readyJobs, audio: { id: fileId, ...audio } }) as never
    );

  // ── 1. 参数与授权门禁（不碰库） ──────────────────────────────────────────
  await expectComposeError(
    "镜数不足（1 镜）→ invalid_compose_request",
    () => composeLanqiShots({ ...baseInput, shotJobIds: ["shot-job-1"], requestKey: "smoke-request-key-0002" }, fakeDb({ jobs: readyJobs }) as never),
    "invalid_compose_request"
  );
  await expectComposeError(
    "镜数超上限（13 镜）→ invalid_compose_request",
    () => composeLanqiShots({ ...baseInput, shotJobIds: Array.from({ length: 13 }, (_, index) => `shot-job-${index + 1}`), requestKey: "smoke-request-key-0003" }, fakeDb({ jobs: readyJobs }) as never),
    "invalid_compose_request"
  );
  await expectComposeError(
    "幂等键非法 → invalid_compose_request",
    () => composeLanqiShots({ ...baseInput, requestKey: "short" }, fakeDb({ jobs: readyJobs }) as never),
    "invalid_compose_request"
  );
  await expectComposeError(
    "带音轨未勾授权 → audio_rights_required",
    () => composeLanqiShots({ ...baseInput, audioFileId: "audio-file-1", audioRightsConfirmed: false, requestKey: "smoke-request-key-0004" }, fakeDb({ jobs: readyJobs }) as never),
    "audio_rights_required"
  );

  // ── 2. 跨租户与未出片 ────────────────────────────────────────────────────
  await expectComposeError(
    "镜次不属于本租户 → 404 shot_not_found",
    () => composeLanqiShots({ ...baseInput, requestKey: "smoke-request-key-0005" }, fakeDb({ jobs: [] }) as never),
    "shot_not_found",
    404
  );
  await expectComposeError(
    "有镜次未出片 → 409 shots_not_ready",
    () =>
      composeLanqiShots(
        { ...baseInput, requestKey: "smoke-request-key-0006" },
        fakeDb({ jobs: [{ id: "shot-job-1", status: "succeeded", assetStatus: "persisted" }, { id: "shot-job-2", status: "running", assetStatus: "pending" }] }) as never
      ),
    "shots_not_ready",
    409
  );
  await expectComposeError(
    "音轨文件不属于本租户 → 404 audio_file_not_found",
    () => composeLanqiShots({ ...baseInput, audioFileId: "audio-file-x", audioRightsConfirmed: true, requestKey: "smoke-request-key-0007" }, fakeDb({ jobs: readyJobs, audio: null }) as never),
    "audio_file_not_found",
    404
  );
  await expectComposeError(
    "音轨文件过大 → audio_file_too_large",
    () => audioInput("audio-file-big", "smoke-request-key-0008", { filename: "bgm.m4a", mimeType: "audio/mp4", byteSize: 40 * 1024 * 1024, storagePath: longAudio }),
    "audio_file_too_large"
  );

  // ── 3. 正常路径：无音轨拼接 ───────────────────────────────────────────────
  const silentCompose = await composeLanqiShots({ ...baseInput, requestKey: "smoke-request-key-0009" }, fakeDb({ jobs: readyJobs }) as never);
  check("无音轨合成成功", Boolean(silentCompose.composeId) && silentCompose.audioIncluded === false, `id=${silentCompose.composeId}`);
  check("无音轨成片时长≈各镜之和（2s+1s）", Math.abs(silentCompose.durationSeconds - 3) <= 1, `${silentCompose.durationSeconds}s`);
  const silentFile = path.join(workRoot, "verify-silent.mp4");
  await writeFile(silentFile, (await readLanqiMediaAsset({ tenantId: tenantA, jobId: silentCompose.composeId })).bytes);
  const silentStreams = await streamTypes(silentFile);
  check("无音轨成片只有视频流", silentStreams.includes("video") && !silentStreams.includes("audio"), silentStreams.join(","));

  // ── 4. 正常路径：长音轨（以画面长度为准） ────────────────────────────────
  const longAudioCompose = await audioInput("audio-file-long", "smoke-request-key-0010", { filename: "bgm-long.m4a", mimeType: "audio/mp4", byteSize: 90_000, storagePath: longAudio });
  check("长音轨合成成功且 audioSource=audio_file", longAudioCompose.audioIncluded === true && longAudioCompose.audioSource === "audio_file", `${longAudioCompose.audioSource}`);
  check("长音轨成片时长仍≈画面长度", Math.abs(longAudioCompose.durationSeconds - 3) <= 1, `${longAudioCompose.durationSeconds}s`);
  const longAudioFile = path.join(workRoot, "verify-long.mp4");
  await writeFile(longAudioFile, (await readLanqiMediaAsset({ tenantId: tenantA, jobId: longAudioCompose.composeId })).bytes);
  check("长音轨成片带音频流", (await streamTypes(longAudioFile)).includes("audio"));
  const longAudioProbe = await probeMedia(longAudioFile);
  check("长音轨成片解析出画面尺寸", Boolean(longAudioProbe.width && longAudioProbe.height), `${longAudioProbe.width}x${longAudioProbe.height}`);

  // ── 5. 短音轨循环补齐 + 视频抽音 ─────────────────────────────────────────
  const loopCompose = await audioInput("audio-file-short", "smoke-request-key-0011", { filename: "bgm-short.m4a", mimeType: "audio/mp4", byteSize: 20_000, storagePath: shortAudio });
  const loopFile = path.join(workRoot, "verify-loop.mp4");
  await writeFile(loopFile, (await readLanqiMediaAsset({ tenantId: tenantA, jobId: loopCompose.composeId })).bytes);
  check("短音轨循环补齐后成片仍≈画面长度", Math.abs(loopCompose.durationSeconds - 3) <= 1, `${loopCompose.durationSeconds}s`);
  check("短音轨成片带音频流", (await streamTypes(loopFile)).includes("audio"));

  const videoTrackCompose = await audioInput("audio-file-video", "smoke-request-key-0012", { filename: "talking.mp4", mimeType: "video/mp4", byteSize: 120_000, storagePath: talkingClip });
  const videoTrackFile = path.join(workRoot, "verify-video-track.mp4");
  await writeFile(videoTrackFile, (await readLanqiMediaAsset({ tenantId: tenantA, jobId: videoTrackCompose.composeId })).bytes);
  check("带声音视频作音轨 → audioSource=video_audio_track", videoTrackCompose.audioSource === "video_audio_track", `${videoTrackCompose.audioSource}`);
  check("带声音视频作音轨 → 成片带音频流", (await streamTypes(videoTrackFile)).includes("audio"));

  // ── 6. 失败路径：无声视频当音轨必须明确报错 ──────────────────────────────
  await expectComposeError(
    "无声视频当音轨 → audio_track_missing",
    () => audioInput("audio-file-mute", "smoke-request-key-0013", { filename: "silent-reference.mp4", mimeType: "video/mp4", byteSize: 80_000, storagePath: silentClip }),
    "audio_track_missing"
  );

  // ── 7. 幂等与租户隔离 ────────────────────────────────────────────────────
  const idempotent = await composeLanqiShots({ ...baseInput, requestKey: "smoke-request-key-0009" }, fakeDb({ jobs: readyJobs }) as never);
  check("同一 requestKey 重复合成 → 复用同一条成片", idempotent.composeId === silentCompose.composeId && idempotent.idempotent === true, `${idempotent.composeId}`);

  let crossTenantReadable = true;
  try {
    await readLanqiMediaAsset({ tenantId: tenantB, jobId: silentCompose.composeId });
  } catch {
    crossTenantReadable = false;
  }
  check("成片按租户隔离（B 租户读不到 A 租户成片）", crossTenantReadable === false);

  await rm(uploadRoot, { recursive: true, force: true }).catch(() => undefined);
  await rm(workRoot, { recursive: true, force: true }).catch(() => undefined);
}

/** 与 `routes/media.ts` 同一套解析规则：优先本机 WorkBuddy 自带二进制，否则走 PATH（生产是 /usr/local/bin）。 */
async function resolveFfmpeg(): Promise<string> {
  const bundled = path.join(
    process.env.USERPROFILE ?? "",
    ".workbuddy",
    "binaries",
    "ffmpeg",
    "ffmpeg-8.1.1-essentials_build",
    "bin",
    "ffmpeg.exe"
  );
  try {
    await execFileAsync(bundled, ["-version"], { timeout: 5000, windowsHide: true });
    return bundled;
  } catch {
    return "ffmpeg";
  }
}

main()
  .then(() => {
    console.log(`\n${passed} passed / ${failed.length} failed`);
    if (failed.length) {
      console.log(`failed: ${failed.join(" | ")}`);
      process.exit(1);
    }
    assert.ok(passed > 0);
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env.js";
import type { ClipCropMode, SelectedClipSegment } from "./clip-planner.js";
import { registerClipOutputExpiry } from "./clip-temp-storage.js";

export type ClipVisualTemplate = "clean" | "focus" | "depth";
export type ClipTone = "natural" | "warm" | "clear";

export interface ClipRenderInput {
  sourcePath: string;
  sourceName: string;
  contentTemplate: string;
  startSeconds: number;
  durationSeconds: number;
  visualTemplate: ClipVisualTemplate;
  tone: ClipTone;
  mirror: boolean;
  headline: string;
  audience: string;
  sellingPoint: string;
  personalView: string;
  cta: string;
}

export interface ClipProbe {
  durationSeconds: number;
  width: number;
  height: number;
  fps: number;
  videoCodec: string;
  audioCodec?: string;
  bitRate: number;
}

export interface ClipRenderResult {
  id: string;
  outputPath: string;
  outputUrl: string;
  outputBytes: number;
  source: ClipProbe;
  output: ClipProbe;
  renderMs: number;
  encoder: "h264_nvenc" | "libx264";
  aiWork: string[];
  humanChecklist: string[];
  qualityFlags: string[];
  expiresAt: string;
}

export interface RoughCutRenderResult {
  id: string;
  outputPath: string;
  outputUrl: string;
  outputBytes: number;
  output: ClipProbe;
  renderMs: number;
  encoder: "h264_nvenc" | "libx264";
  segmentCount: number;
  brollCount: number;
  backgroundMusicUsed?: string;
  aiWork: string[];
  humanChecklist: string[];
  qualityFlags: string[];
  expiresAt: string;
}

const ffmpegName = "ffmpeg";
const ffprobeName = "ffprobe";
const OUTRO_HOLD_SECONDS = 0.72;
const OUTRO_FADE_SECONDS = 0.62;
const SEGMENT_HEAD_PADDING_SECONDS = 0.06;
const SEGMENT_TAIL_PADDING_SECONDS = 0.18;

export async function probeClip(filePath: string): Promise<ClipProbe> {
  const output = await runProcess(ffprobeName, [
    "-v",
    "error",
    "-show_entries",
    "format=duration,bit_rate:stream=codec_type,codec_name,width,height,r_frame_rate",
    "-of",
    "json",
    filePath
  ], 30_000);
  const parsed = JSON.parse(output) as {
    format?: { duration?: string; bit_rate?: string };
    streams?: Array<{
      codec_type?: string;
      codec_name?: string;
      width?: number;
      height?: number;
      r_frame_rate?: string;
    }>;
  };
  const video = parsed.streams?.find((stream) => stream.codec_type === "video");
  const audio = parsed.streams?.find((stream) => stream.codec_type === "audio");
  if (!video?.width || !video.height) throw new Error("无法读取视频画面信息");
  return {
    durationSeconds: Number(parsed.format?.duration ?? 0),
    width: video.width,
    height: video.height,
    fps: parseFrameRate(video.r_frame_rate),
    videoCodec: video.codec_name ?? "unknown",
    audioCodec: audio?.codec_name,
    bitRate: Number(parsed.format?.bit_rate ?? 0)
  };
}

export async function createClipThumbnail(sourcePath: string, outputPath: string, seekSeconds = 3): Promise<void> {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await runProcess(ffmpegName, [
    "-y",
    "-ss",
    String(Math.max(0, seekSeconds)),
    "-i",
    sourcePath,
    "-frames:v",
    "1",
    "-vf",
    "scale=360:-2",
    outputPath
  ], 60_000);
}

export async function renderClip(input: ClipRenderInput): Promise<ClipRenderResult> {
  const source = await probeClip(input.sourcePath);
  const startSeconds = clamp(input.startSeconds, 0, Math.max(0, source.durationSeconds - 1));
  const durationSeconds = clamp(
    input.durationSeconds,
    5,
    Math.min(180, Math.max(5, source.durationSeconds - startSeconds))
  );
  const outputRoot = path.resolve(env.UPLOAD_DIR, "clip-lab");
  const id = randomUUID();
  const workRoot = path.join(outputRoot, "work", id);
  const outputPath = path.join(outputRoot, `${id}.mp4`);
  const subtitlePath = path.join(workRoot, "overlay.ass");
  await mkdir(workRoot, { recursive: true });
  await mkdir(outputRoot, { recursive: true });
  await writeFile(subtitlePath, buildOverlayAss(input, durationSeconds), "utf8");

  const encoder = await supportsNvenc() ? "h264_nvenc" : "libx264";
  const filter = buildVideoFilter(input.visualTemplate, input.tone, input.mirror);
  const args = [
    "-y",
    "-ss",
    startSeconds.toFixed(3),
    "-i",
    input.sourcePath,
    "-t",
    durationSeconds.toFixed(3),
    "-vf",
    `${filter},ass=overlay.ass`,
    "-af",
    "loudnorm=I=-16:TP=-1.5:LRA=11",
    "-r",
    "30",
    "-c:v",
    encoder,
    ...(encoder === "h264_nvenc"
      ? ["-preset", "p5", "-cq", "21", "-b:v", "0"]
      : ["-preset", "veryfast", "-crf", "21"]),
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    "-movflags",
    "+faststart",
    outputPath
  ];

  const renderStartedAt = Date.now();
  await runProcess(ffmpegName, args, 15 * 60_000, workRoot);
  const renderMs = Date.now() - renderStartedAt;
  const output = await probeClip(outputPath);
  const { stat } = await import("node:fs/promises");
  const outputStat = await stat(outputPath);
  const expiresAt = await registerClipOutputExpiry(outputPath);
  await rm(workRoot, { recursive: true, force: true });
  const qualityFlags: string[] = [];
  if (output.width !== 1080 || output.height !== 1920) qualityFlags.push("输出画幅不是标准 1080×1920");
  if (!output.audioCodec) qualityFlags.push("未检测到音轨");
  if (output.durationSeconds < durationSeconds - 1) qualityFlags.push("成片时长短于设定值，请复查源文件");
  if (!input.sellingPoint.trim()) qualityFlags.push("未填写核心卖点，标题信息可能偏弱");
  if (!input.personalView.trim()) qualityFlags.push("未加入个人观点，内容差异度主要来自画面模板");

  return {
    id,
    outputPath,
    outputUrl: `/clip-lab/results/${id}.mp4`,
    outputBytes: outputStat.size,
    source,
    output,
    renderMs,
    encoder,
    aiWork: [
      `按人工指定的 ${formatSeconds(startSeconds)}–${formatSeconds(startSeconds + durationSeconds)} 截取，不擅自挑选片段`,
      visualTemplateLabel(input.visualTemplate),
      toneLabel(input.tone),
      input.mirror ? "执行水平镜像" : "保留原始左右方向",
      `按“${input.contentTemplate}”结构重排标题、卖点、人群、个人观点和行动提示`,
      "统一人声音量并导出 1080×1920、H.264 成片"
    ],
    humanChecklist: [
      "核对商品名、规格、价格、赠品和承诺是否与当前商品政策一致",
      "确认标题和个人观点确实由当前切片手认可，不冒充亲身体验",
      "快速通看人物口型、商品主体和文字是否被遮挡",
      "如需逐字字幕，校正品牌名、方言和数字后再发布",
      "按平台规则完成素材授权、广告标识和最终发布检查"
    ],
    qualityFlags,
    expiresAt
  };
}

export async function renderRoughCutPlan(params: {
  planId: string;
  segments: SelectedClipSegment[];
  donorSegments?: SelectedClipSegment[];
  sourcePaths: Record<string, string>;
  broll: Array<{
    assetPath: string;
    assetType: "video" | "image";
    insertAfterSegmentId: string;
    durationSeconds: number;
    presentation: "fullscreen" | "pip";
  }>;
  backgroundMusic?: { filename: string; localPath: string };
}): Promise<RoughCutRenderResult> {
  if (params.segments.length < 2 || params.segments.length > 16) throw new Error("粗剪时间线需要2到16个片段");
  const outputRoot = path.resolve(env.UPLOAD_DIR, "clip-lab");
  const id = randomUUID();
  const workRoot = path.join(outputRoot, "work", id);
  const outputPath = path.join(outputRoot, `${id}.mp4`);
  const rawPath = path.join(workRoot, "rough-cut-raw.mp4");
  const concatPath = path.join(workRoot, "concat.txt");
  await mkdir(workRoot, { recursive: true });
  await mkdir(outputRoot, { recursive: true });
  const encoder = await supportsNvenc() ? "h264_nvenc" : "libx264";
  const renderStartedAt = Date.now();
  const intermediatePaths: string[] = [];
  let internalVisualDonorCount = 0;
  for (const [index, segment] of params.segments.entries()) {
    const sourcePath = params.sourcePaths[segment.sourceId];
    if (!sourcePath) throw new Error(`找不到粗剪片段来源：${segment.sourceId}`);
    const segmentPath = path.join(workRoot, `segment-${String(index).padStart(2, "0")}.mp4`);
    const window = segmentRenderWindow(segment);
    const duration = window.durationSeconds;
    const visualDonor = findInternalVisualDonor(segment, index, params.segments, params.donorSegments ?? []);
    const visualDonorPath = visualDonor ? params.sourcePaths[visualDonor.sourceId] : undefined;
    const args = ["-y", "-ss", window.startSeconds.toFixed(3), "-i", sourcePath];
    if (visualDonor && visualDonorPath) {
      const donorWindow = segmentRenderWindow(visualDonor);
      args.push(
        "-ss", donorWindow.startSeconds.toFixed(3),
        "-t", duration.toFixed(3),
        "-i", visualDonorPath
      );
      internalVisualDonorCount += 1;
    }
    args.push(
      "-t", duration.toFixed(3),
      ...(visualDonor && visualDonorPath ? ["-map", "1:v:0", "-map", "0:a:0"] : []),
      "-vf", visualDonor
        ? internalVisualDonorFilter(visualDonor, duration)
        : segmentCropFilter(segment),
      // Do not let the video tail accidentally contain the first syllable of
      // the next unselected ASR sentence. Trim audio at the final selected
      // word, then pad with true silence while the frame settles naturally.
      "-af", buildSegmentAudioFilter(segment, window),
      "-r", "30", "-c:v", encoder,
      ...(encoder === "h264_nvenc" ? ["-preset", "p5", "-cq", "21", "-b:v", "0"] : ["-preset", "medium", "-crf", "21"]),
      "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
      segmentPath
    );
    await runProcess(ffmpegName, args, 4 * 60_000);
    intermediatePaths.push(segmentPath);
  }
  await writeFile(concatPath, intermediatePaths.map((filePath) => `file '${filePath.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`).join("\n"), "utf8");
  await runProcess(ffmpegName, ["-y", "-f", "concat", "-safe", "0", "-i", concatPath, "-c", "copy", rawPath], 4 * 60_000);
  const usableBroll = params.broll.filter((item) => item.assetPath && item.durationSeconds >= 1).slice(0, 6);
  const totalDuration = params.segments.reduce((sum, segment) => sum + segmentRenderWindow(segment).durationSeconds, 0);
  const renderDuration = totalDuration + OUTRO_HOLD_SECONDS;
  const outroFadeAt = Math.max(0.1, renderDuration - OUTRO_FADE_SECONDS);
  const finalArgs = ["-y", "-i", rawPath];
  for (const item of usableBroll) {
    if (item.assetType === "image") finalArgs.push("-loop", "1", "-t", item.durationSeconds.toFixed(2), "-i", item.assetPath);
    else finalArgs.push("-stream_loop", "-1", "-t", item.durationSeconds.toFixed(2), "-i", item.assetPath);
  }
  const backgroundMusic = params.backgroundMusic;
  if (backgroundMusic) finalArgs.push("-stream_loop", "-1", "-i", backgroundMusic.localPath);
  {
    const complexFilters = [buildBrollFilter(params.segments, usableBroll, totalDuration, renderDuration)];
    if (backgroundMusic) {
      const musicInputIndex = usableBroll.length + 1;
      complexFilters.push(
        `[0:a]aformat=sample_rates=48000:channel_layouts=stereo,apad=pad_dur=${OUTRO_HOLD_SECONDS.toFixed(2)},atrim=0:${renderDuration.toFixed(2)},asplit=2[voice][voicekey]`,
        `[${musicInputIndex}:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=0.12,atrim=0:${renderDuration.toFixed(2)},afade=t=in:st=0:d=0.8,afade=t=out:st=${outroFadeAt.toFixed(2)}:d=${OUTRO_FADE_SECONDS.toFixed(2)}[music]`,
        "[music][voicekey]sidechaincompress=threshold=0.014:ratio=10:attack=18:release=320[ducked]",
        "[voice][ducked]amix=inputs=2:duration=first:dropout_transition=2:normalize=0[aout]"
      );
    } else {
      complexFilters.push(
        `[0:a]aformat=sample_rates=48000:channel_layouts=stereo,apad=pad_dur=${OUTRO_HOLD_SECONDS.toFixed(2)},atrim=0:${renderDuration.toFixed(2)}[aout]`
      );
    }
    finalArgs.push("-filter_complex", complexFilters.join(";"), "-map", "[vout]", "-map", "[aout]");
  }
  finalArgs.push(
    "-t", renderDuration.toFixed(2),
    "-c:v", encoder,
    ...(encoder === "h264_nvenc"
      ? ["-preset", "p6", "-rc", "vbr", "-cq", "23", "-b:v", "6M", "-maxrate", "8M", "-bufsize", "12M"]
      : ["-preset", "medium", "-crf", "23", "-maxrate", "8M", "-bufsize", "12M"]),
    "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", outputPath
  );
  await runProcess(ffmpegName, finalArgs, 12 * 60_000, workRoot);
  const renderMs = Date.now() - renderStartedAt;
  const output = await probeClip(outputPath);
  const { stat } = await import("node:fs/promises");
  const outputStat = await stat(outputPath);
  const expiresAt = await registerClipOutputExpiry(outputPath);
  await rm(workRoot, { recursive: true, force: true });
  const qualityFlags: string[] = [];
  if (output.width !== 1080 || output.height !== 1920) qualityFlags.push("输出不是标准竖屏1080×1920");
  if (!output.audioCodec) qualityFlags.push("未检测到音轨");
  if (usableBroll.length < params.broll.length) qualityFlags.push("部分补充素材未匹配，成片使用主素材代替");
  if (!backgroundMusic) qualityFlags.push("本次未提供已授权音频，成片没有混入背景音乐");
  return {
    id,
    outputPath,
    outputUrl: `/clip-lab/results/${id}.mp4`,
    outputBytes: outputStat.size,
    output,
    renderMs,
    encoder,
    segmentCount: params.segments.length,
    brollCount: usableBroll.length,
    backgroundMusicUsed: backgroundMusic?.filename,
    aiWork: [
      `按已确认时间线重组 ${params.segments.length} 个真实口播片段`,
      "按照人物、商品、证据等用途应用不同构图预设",
      internalVisualDonorCount > 0
        ? `对 ${internalVisualDonorCount} 个同期画面不稳定的高价值口播，覆盖同批素材中的稳定商品特写并保留原声`
        : "所有口播均保留同期画面，没有进行音画替换",
      `以全屏场景覆盖为主插入 ${usableBroll.length} 个已匹配补充画面，并保留原口播音轨`,
      backgroundMusic ? `混入已授权背景音乐“${backgroundMusic.filename}”，口播出现时自动压低音乐` : "未上传已授权背景音乐，保留干净口播音轨",
      "结尾保留最后一个有效人物或产品画面，并给完整口播留出自然静音余量",
      "统一人声音量并导出不叠加字幕的标准竖屏初剪片"
    ],
    humanChecklist: [
      "复核所有价格、销量、赔付、保险、认证、产地和效果声明",
      "在精修软件中按需要添加或校正字幕、品牌名称、数字和方言",
      "确认补充素材来源、授权范围和画面没有暗示虚假背书",
      "检查自动特写没有裁掉商品标签或人物关键表情",
      "完整观看成片后再发布"
    ],
    qualityFlags,
    expiresAt
  };
}

function buildVideoFilter(template: ClipVisualTemplate, tone: ClipTone, mirror: boolean): string {
  const templateFilter = template === "depth"
    ? "split=2[bg][fg];[bg]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,gblur=sigma=28,eq=brightness=-0.08[bg2];[fg]scale=1000:1778:force_original_aspect_ratio=increase,crop=1000:1778[fg2];[bg2][fg2]overlay=40:71"
    : template === "focus"
      ? "scale=1160:2062:force_original_aspect_ratio=increase,crop=1080:1920"
      : "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920";
  const toneFilter = tone === "warm"
    ? "colorbalance=rs=.035:gs=.015:bs=-.025,eq=saturation=1.06:contrast=1.025"
    : tone === "clear"
      ? "unsharp=5:5:0.45:3:3:0.2,eq=contrast=1.04:saturation=1.03"
      : "eq=contrast=1.015:saturation=1.015";
  return `${templateFilter},${toneFilter}${mirror ? ",hflip" : ""}`;
}

function segmentCropFilter(segment: SelectedClipSegment): string {
  const mode: ClipCropMode = segment.cropMode;
  const focusX = Math.max(0.08, Math.min(0.92, (segment.visual?.focusX ?? 500) / 1000));
  const detectedFocusY = (segment.visual?.focusY ?? 500) / 1000;
  // OCR can lock onto a tiny top tag and place the crop too high. When the
  // opening proof is only partially matched, keep the whole product name and
  // bottle shoulder inside the safe area instead of magnifying the empty jug.
  const focusY = Math.max(
    0.08,
    Math.min(0.92, segment.role === "hook" && segment.visual?.matched !== true
      ? Math.max(0.36, detectedFocusY)
      : detectedFocusY)
  );
  const directFocusCrop = (width: number, height: number, sharpen = false) => {
    const x = `max(0\\,min(iw-1080\\,iw*${focusX.toFixed(3)}-540))`;
    const y = `max(0\\,min(ih-1920\\,ih*${focusY.toFixed(3)}-960))`;
    return `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=1080:1920:${x}:${y}${sharpen ? ",unsharp=5:5:0.35" : ""}`;
  };
  // Direct close-ups are story beats, not an effect on every shot. The cut
  // itself delivers the emphasis: product identity, a readable proof, and
  // specification/price get a close-up; conversation remains naturally framed.
  if (shouldUseDirectCloseup(segment)) {
    if (mode === "evidence") return directFocusCrop(1680, 2987, true);
    if (segment.role === "price" || segment.role === "specification") return directFocusCrop(1560, 2773);
    if (segment.role === "hook") return segment.visual?.matched === true
      ? directFocusCrop(1640, 2916, true)
      : directFocusCrop(1540, 2738, true);
    if (segment.role === "social_proof") return directFocusCrop(1440, 2560);
    return directFocusCrop(1480, 2631);
  }
  if (mode === "speaker") return directFocusCrop(1160, 2062);
  if (mode === "product") return directFocusCrop(1220, 2169);
  return "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920";
}

function shouldUseDirectCloseup(segment: SelectedClipSegment): boolean {
  if (segment.cropMode === "evidence") {
    if (segment.visual?.matched === true) return true;
    const visibleText = `${segment.visual?.summary ?? ""}${segment.visual?.ocrText ?? ""}`;
    return /标签|瓶身|包装|条形码|PICC|人保|保险|赔偿|赔付|认证|文字/.test(visibleText);
  }
  return segment.cropMode === "product" && ["hook", "specification", "social_proof", "price"].includes(segment.role);
}

/**
 * A strong opening sentence is sometimes spoken while the presenter is moving
 * an empty container in front of the camera.  Keep that valuable original
 * voice, but cover it with a stable product/proof shot from the same selected
 * source material.  This is an internal J-cut, not generated or web-sourced
 * footage, so product identity and provenance stay truthful.
 */
function findInternalVisualDonor(
  segment: SelectedClipSegment,
  index: number,
  segments: SelectedClipSegment[],
  donorSegments: SelectedClipSegment[]
): SelectedClipSegment | undefined {
  if (index !== 0 || segment.role !== "hook" || segment.visual?.matched === true) return undefined;

  const requiredDuration = segmentRenderWindow(segment).durationSeconds;
  const upcoming = segments.slice(index + 1, index + 3);
  const dedicatedDonorIds = new Set(donorSegments.map((candidate) => candidate.segmentId));
  const minimumDonorDuration = Math.min(requiredDuration - 0.1, 1.8);
  const candidates = [...donorSegments, ...segments.slice(1)]
    .filter((candidate, candidateIndex, all) => all.findIndex((item) => item.segmentId === candidate.segmentId) === candidateIndex)
    .filter((candidate) => {
      const candidateDuration = segmentRenderWindow(candidate).durationSeconds;
      const usablePicture = candidate.cropMode === "product"
        || candidate.cropMode === "evidence"
        || hasStableProductPicture(candidate);
      return candidate.visual?.matched === true && usablePicture && candidateDuration >= minimumDonorDuration;
    });

  // Do not preview the exact shot that the viewer will see one beat later.
  // An establishing product shot followed by a label/detail shot reads as
  // deliberate progression; replaying the proof shot reads as a duplicate.
  const novelCandidates = candidates.filter((candidate) => !upcoming.some((next) => next.segmentId === candidate.segmentId));
  const pool = novelCandidates.length > 0 ? novelCandidates : candidates;
  return pool.sort((left, right) => internalVisualDonorScore(right, upcoming, dedicatedDonorIds)
    - internalVisualDonorScore(left, upcoming, dedicatedDonorIds))[0];
}

function hasStableProductPicture(segment: SelectedClipSegment): boolean {
  const visibleText = `${segment.visual?.summary ?? ""} ${segment.visual?.ocrText ?? ""}`;
  return /商品|产品|油桶|油瓶|瓶身|包装|标签|大豆油|豆油|净含量|5L/i.test(visibleText);
}

function internalVisualDonorFilter(segment: SelectedClipSegment, requiredDuration: number): string {
  // Coverage audio comes from another segment. A visible speaking mouth creates
  // perceived A/V desynchronization, so crop this as a product-only shot. Let
  // contiguous source frames run for the whole beat; never freeze or loop a
  // short donor to fake duration.
  const focusX = Math.max(0.18, Math.min(0.82, (segment.visual?.focusX ?? 500) / 1000));
  const cropX = `max(0\\,min(iw-1080\\,iw*${focusX.toFixed(3)}-540))`;
  // The stronger lower crop retains the package cap, label and hands while
  // keeping the presenter's moving mouth above the visible frame.
  const productOnlyCrop = `scale=1800:3200:force_original_aspect_ratio=increase,crop=1080:1920:${cropX}:max(0\\,ih-1920),unsharp=5:5:0.35`;
  return `${productOnlyCrop},trim=duration=${requiredDuration.toFixed(3)},setpts=PTS-STARTPTS`;
}

function internalVisualDonorScore(
  segment: SelectedClipSegment,
  upcoming: SelectedClipSegment[],
  dedicatedDonorIds: Set<string>
): number {
  const visibleText = `${segment.transcript} ${segment.visual?.summary ?? ""} ${segment.visual?.ocrText ?? ""}`;
  let score = segment.visual?.matchScore ?? 0;
  // These clips were explicitly removed from the spoken timeline because the
  // fact repeated, while their picture remained useful. Prefer that verified
  // silent coverage over borrowing an unrelated ordinary timeline shot.
  if (dedicatedDonorIds.has(segment.segmentId)) score += 120;
  // The first picture establishes what is being sold. Reserve evidence/detail
  // frames for the following trust beat so the opening has shot-size novelty.
  if (segment.role === "specification" || segment.role === "price") score += 34;
  if (segment.cropMode === "product") score += 24;
  if (hasStableProductPicture(segment)) score += 22;
  if (segment.role === "evidence") score += 8;
  if (segment.cropMode === "evidence") score += 4;
  if (/PICC|人保|保险|标签|瓶身|包装|赔偿|赔付|认证/.test(visibleText)) score += 16;
  for (const next of upcoming) {
    if (next.sourceId !== segment.sourceId) continue;
    const distance = Math.min(
      Math.abs(segment.startSeconds - next.endSeconds),
      Math.abs(next.startSeconds - segment.endSeconds)
    );
    if (distance < 1) score -= 80;
    else if (distance < 8) score -= 28;
  }
  return score;
}

function buildTimelineAss(segments: SelectedClipSegment[]): string {
  let cursor = 0;
  const events: string[] = [];
  for (const [segmentIndex, segment] of segments.entries()) {
    const duration = segmentRenderWindow(segment).durationSeconds;
    const start = cursor;
    const end = cursor + duration;
    for (const phrase of buildCaptionPhrases(segment, start, duration)) {
      events.push(buildAnimatedCaptionDialogue(phrase));
    }
    if (segmentIndex === 0) {
      const productName = extractOpeningProductName(segment.transcript);
      if (productName) {
        const hookEnd = Math.min(end, start + 1.8);
        events.push(`Dialogue: 2,${toAssTime(start)},${toAssTime(hookEnd)},Hook,,0,0,0,,{\\fscx62\\fscy62\\t(0,150,\\fscx118\\fscy118)\\t(150,260,\\fscx100\\fscy100)\\fad(40,120)}${escapeAss(productName)}`);
      }
    }
    if (segmentIndex === segments.length - 1) {
      events.push(`Dialogue: 0,${toAssTime(end)},${toAssTime(end + OUTRO_HOLD_SECONDS)},Main,,0,0,0,,{\\fad(45,90)}${escapeAss(buildOutroCaption(segment.subtitle))}`);
    }
    cursor = end;
  }
  return `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Main,Microsoft YaHei,56,&H00FFFFFF,&H0000E7FF,&H00101010,&H78000000,-1,0,0,0,100,100,0,0,1,7,2,2,72,72,198,1
Style: Key,Microsoft YaHei,70,&H0000E7FF,&H00FFFFFF,&H00101010,&H78000000,-1,0,0,0,100,100,0,0,1,9,3,2,58,58,276,1
Style: Number,Microsoft YaHei,78,&H0031F0FF,&H00FFFFFF,&H002A097D,&H78000000,-1,0,0,0,100,100,0,0,1,12,4,2,48,48,338,1
Style: CTA,Microsoft YaHei,68,&H0055FFB8,&H00FFFFFF,&H00101010,&H78000000,-1,0,0,0,100,100,0,0,1,9,3,2,54,54,276,1
Style: Hook,Microsoft YaHei,92,&H0000E7FF,&H00FFFFFF,&H00101010,&H6B000000,-1,0,0,0,100,100,2,0,1,10,5,8,58,58,330,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events.join("\n")}
`;
}

type CaptionStyle = "Main" | "Key" | "Number" | "CTA";

interface CaptionPhrase {
  text: string;
  start: number;
  end: number;
  style: CaptionStyle;
}

function buildAnimatedCaptionDialogue(phrase: CaptionPhrase): string {
  const durationMs = Math.round(Math.max(180, Math.min(360, (phrase.end - phrase.start) * 310)));
  const settleMs = Math.max(durationMs + 50, Math.round(durationMs * 1.75));
  const compactScale = phrase.text.length > 8 ? 84 : 100;
  const presentation = captionPresentation(phrase);
  const motion = phrase.style === "Main"
    ? `\\an2\\move(540,1710,540,1635,0,${durationMs})\\fscx${Math.round(compactScale * 0.72)}\\fscy72\\t(0,${durationMs},\\fscx${Math.round(compactScale * 1.08)}\\fscy108)\\t(${durationMs},${settleMs},\\fscx${compactScale}\\fscy100)\\fad(45,90)`
    : phrase.style === "Number"
      ? `\\an2\\move(540,1570,540,1485,0,${durationMs})\\fscx${Math.round(compactScale * 0.54)}\\fscy54\\frz-4\\t(0,${durationMs},\\fscx${Math.round(compactScale * 1.16)}\\fscy116\\frz0)\\t(${durationMs},${settleMs},\\fscx${compactScale}\\fscy100)\\fad(35,105)`
      : phrase.style === "CTA"
        ? `\\an2\\move(540,1600,540,1515,0,${durationMs})\\fscx${Math.round(compactScale * 0.64)}\\fscy64\\t(0,${durationMs},\\fscx${Math.round(compactScale * 1.12)}\\fscy112)\\t(${durationMs},${settleMs},\\fscx${compactScale}\\fscy100)\\fad(35,105)`
        : `\\an2\\move(540,1600,540,1515,0,${durationMs})\\fscx${Math.round(compactScale * 0.62)}\\fscy62\\t(0,${durationMs},\\fscx${Math.round(compactScale * 1.15)}\\fscy115)\\t(${durationMs},${settleMs},\\fscx${compactScale}\\fscy100)\\fad(35,105)`;
  return `Dialogue: 1,${toAssTime(phrase.start)},${toAssTime(phrase.end)},${phrase.style},,0,0,0,,{${motion}}${escapeAss(presentation)}`;
}

function captionPresentation(phrase: CaptionPhrase): string {
  // Decorative brackets/stars are visual punctuation only: the spoken phrase
  // itself remains untouched, so captions never invent a product claim.
  if (phrase.style === "Number") return `【${phrase.text}】`;
  if (phrase.style === "Key") return `✦ ${phrase.text} ✦`;
  if (phrase.style === "CTA") return `✦ ${phrase.text} ✦`;
  return phrase.text;
}

function buildCaptionPhrases(segment: SelectedClipSegment, timelineStart: number, duration: number): CaptionPhrase[] {
  const subtitle = cleanCaptionText(segment.subtitle);
  const sourceWords = segment.words?.filter((word) => cleanCaptionText(word.text)) ?? [];
  const sourceText = cleanCaptionText(sourceWords.map((word) => word.text).join(""));
  const window = segmentRenderWindow(segment);
  if (subtitle && sourceWords.length > 0 && captionComparable(subtitle) === captionComparable(sourceText)) {
    const groups: Array<{ text: string; first: number; last: number }> = [];
    let current: Array<{ startSeconds: number; endSeconds: number; text: string }> = [];
    const flush = () => {
      if (current.length === 0) return;
      groups.push({
        text: cleanCaptionText(current.map((word) => word.text).join("")),
        first: current[0].startSeconds,
        last: current[current.length - 1].endSeconds
      });
      current = [];
    };
    sourceWords.forEach((word, index) => {
      current.push(word);
      const next = sourceWords[index + 1];
      const text = cleanCaptionText(current.map((item) => item.text).join(""));
      const naturalBreak = /[,\uFF0C.\u3002!\uFF01?\uFF1F;\uFF1B]$/.test(word.text);
      const pause = next ? next.startSeconds - word.endSeconds : 0;
      const continuesAUnitOrPrice = next ? isNumericUnitContinuation(text, next.text) : false;
      if (naturalBreak || (!continuesAUnitOrPrice && (text.length >= 9 || (text.length >= 4 && pause >= 0.28)))) flush();
    });
    flush();
    const mergedGroups = mergeShortCaptionGroups(groups.filter((group) => group.text));
    return mergedGroups.map((group, index) => {
      const start = timelineStart + Math.max(0, group.first - window.startSeconds);
      const nextStart = mergedGroups[index + 1]?.first;
      const naturalEnd = Math.min(window.startSeconds + window.durationSeconds, group.last);
      const followingStart = nextStart ? Math.max(group.last, nextStart - 0.04) : naturalEnd;
      const requestedEnd = timelineStart + Math.min(duration, followingStart - window.startSeconds);
      const end = Math.min(timelineStart + duration, Math.max(start + 0.18, requestedEnd));
      return { text: group.text, start, end, style: captionStyle(group.text) };
    });
  }

  const phrases = splitSubtitlePhrases(subtitle || segment.transcript);
  const totalWeight = phrases.reduce((sum, phrase) => sum + Math.max(1, phrase.length), 0);
  let phraseStart = timelineStart;
  return phrases.map((text, index) => {
    const phraseEnd = index === phrases.length - 1
      ? timelineStart + duration
      : phraseStart + duration * Math.max(1, text.length) / totalWeight;
    const phrase = { text, start: phraseStart, end: phraseEnd, style: captionStyle(text) };
    phraseStart = phraseEnd;
    return phrase;
  });
}

function mergeShortCaptionGroups(groups: Array<{ text: string; first: number; last: number }>): Array<{ text: string; first: number; last: number }> {
  const result: Array<{ text: string; first: number; last: number }> = [];
  const pending = groups.map((group) => ({ ...group }));
  for (let index = 0; index < pending.length; index += 1) {
    const group = pending[index];
    const spokenLength = captionComparable(group.text).length;
    if (spokenLength < 3 && index + 1 < pending.length) {
      const next = pending[index + 1];
      pending[index + 1] = { text: `${group.text}${next.text}`, first: group.first, last: next.last };
      continue;
    }
    const previous = result[result.length - 1];
    if (spokenLength < 3 && previous) {
      previous.text = `${previous.text}${group.text}`;
      previous.last = group.last;
      continue;
    }
    result.push(group);
  }
  return result;
}

function splitSubtitlePhrases(value: string): string[] {
  const normalized = cleanCaptionText(value).replace(/([,\uFF0C.\u3002!\uFF01?\uFF1F;\uFF1B])/g, "$1|");
  const clauses = normalized.split("|").map((item) => item.trim()).filter(Boolean);
  const phrases: string[] = [];
  for (const clause of clauses.length > 0 ? clauses : [normalized]) {
    for (let index = 0; index < clause.length; index += 10) phrases.push(clause.slice(index, index + 10));
  }
  return phrases.length > 0 ? phrases : [cleanCaptionText(value)];
}

function cleanCaptionText(value: string): string {
  return value.replace(/\s+/g, "").replace(/[,\uFF0C.\u3002!\uFF01?\uFF1F;\uFF1B]{2,}/g, (match) => match.slice(-1)).trim();
}

function captionComparable(value: string): string {
  return cleanCaptionText(value).replace(/[,\uFF0C.\u3002!\uFF01?\uFF1F;\uFF1B\u3001]/g, "").toLowerCase();
}

function captionStyle(text: string): CaptionStyle {
  if (/(\u6293\u7D27|\u8D76\u7D27|\u73B0\u5728|\u7ACB\u5373|\u4E0B\u5355|\u62CD\u4E0B|\u5E26\u8D70|\u522B\u9519\u8FC7)/.test(text)) return "CTA";
  if (/(?:\u00A5|\uFFE5)?(?:\d+|[\u4E00\u4E8C\u4E09\u56DB\u4E94\u516D\u4E03\u516B\u4E5D\u5341\u767E\u5343\u4E07\u4E24])+(?:\.\d+)?(?:\u5143|\u5757|\u6298|\u5347|\u65A4|\u6BEB\u5347|ml|g|\u514B|L)|\d{2,}|\d+\.\d+|\u4EBA\u4FDD|PICC|\u4FDD\u9669/i.test(text)) return "Number";
  if (/(\u5927\u8C46\u6CB9|\u7B28\u69A8|\u7092\u83DC|\u70B8\u4E1C\u897F|\u7126\u9EC4|\u900F\u4EAE|\u560E\u560E\u9999|\u4EA7\u54C1|\u914D\u6599|\u6807\u7B7E|\u5BB6\u5EAD\u53A8\u623F)/.test(text)) return "Key";
  return "Main";
}

function isNumericUnitContinuation(text: string, nextWord: string): boolean {
  const last = cleanCaptionText(text).slice(-1);
  const next = cleanCaptionText(nextWord);
  return /[0-9\u4E00\u4E8C\u4E09\u56DB\u4E94\u516D\u4E03\u516B\u4E5D\u5341\u767E\u5343\u4E07\u4E24]$/.test(last)
    && /^(?:\u5143|\u5757|\u6BDB|\u89D2|\u5206|\u5347|\u65A4|\u4E24|\u6BEB\u5347|\u514B|L|ml|\u4E00|\u4E8C|\u4E09|\u56DB|\u4E94|\u516D|\u4E03|\u516B|\u4E5D)/i.test(next);
}

function buildOutroCaption(value: string): string {
  const clean = value.replace(/[。！？!?；;，,]/g, "").replace(/\s+/g, "").trim();
  const action = clean.match(/抓紧.{0,8}拍.{0,12}$/)?.[0];
  if (action) return action;
  return clean.length <= 14 ? clean : clean.slice(-14);
}

function buildBrollFilter(
  segments: SelectedClipSegment[],
  broll: Array<{ insertAfterSegmentId: string; durationSeconds: number; presentation: "fullscreen" | "pip" }>,
  totalDuration: number,
  renderDuration: number
): string {
  const segmentEndTimes = new Map<string, number>();
  let cursor = 0;
  for (const segment of segments) {
    cursor += segmentRenderWindow(segment).durationSeconds;
    segmentEndTimes.set(segment.segmentId, cursor);
  }
  const outroFrameAt = findProductOutroFrameTime(segments);
  const filters: string[] = [
    "[0:v]split=2[baseSource][outroSource]",
    "[baseSource]setpts=PTS-STARTPTS[base0]",
    `[outroSource]trim=start=${outroFrameAt.toFixed(2)}:duration=0.05,setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=${OUTRO_HOLD_SECONDS.toFixed(2)},setpts=PTS-STARTPTS+${totalDuration.toFixed(2)}/TB[outro]`
  ];
  broll.forEach((item, index) => {
    const start = Math.max(0, (segmentEndTimes.get(item.insertAfterSegmentId) ?? cursor) - item.durationSeconds);
    const end = Math.min(cursor, start + item.durationSeconds);
    if (item.presentation === "pip") {
      filters.push(`[${index + 1}:v]scale=440:620:force_original_aspect_ratio=decrease,pad=460:640:(ow-iw)/2:(oh-ih)/2:color=white,setsar=1,trim=duration=${item.durationSeconds.toFixed(2)},setpts=PTS-STARTPTS+${start.toFixed(2)}/TB[b${index}]`);
      filters.push(`[base${index}][b${index}]overlay=580:170:eof_action=pass:enable='between(t,${start.toFixed(2)},${end.toFixed(2)})'[base${index + 1}]`);
    } else {
      const fadeOutStart = Math.max(0.12, item.durationSeconds - 0.14);
      filters.push(`[${index + 1}:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,trim=duration=${item.durationSeconds.toFixed(2)},format=rgba,fade=t=in:st=0:d=0.12:alpha=1,fade=t=out:st=${fadeOutStart.toFixed(2)}:d=0.14:alpha=1,setpts=PTS-STARTPTS+${start.toFixed(2)}/TB[b${index}]`);
      filters.push(`[base${index}][b${index}]overlay=0:0:eof_action=pass:enable='between(t,${start.toFixed(2)},${end.toFixed(2)})'[base${index + 1}]`);
    }
  });
  filters.push(`[base${broll.length}]tpad=stop_mode=clone:stop_duration=${OUTRO_HOLD_SECONDS.toFixed(2)},trim=duration=${renderDuration.toFixed(2)}[padded]`);
  filters.push(`[padded][outro]overlay=0:0:eof_action=pass:enable='gte(t,${totalDuration.toFixed(2)})'[vout]`);
  return filters.join(";");
}

function findProductOutroFrameTime(segments: SelectedClipSegment[]): number {
  let cursor = 0;
  let candidate = 0;
  for (const segment of segments) {
    const duration = segmentRenderWindow(segment).durationSeconds;
    if (segment.cropMode === "product" || segment.cropMode === "evidence") {
      candidate = cursor + Math.max(0.08, Math.min(duration - 0.08, duration * 0.68));
    }
    cursor += duration;
  }
  return candidate > 0 ? candidate : Math.max(0, cursor - 0.08);
}

function segmentRenderWindow(segment: Pick<SelectedClipSegment, "startSeconds" | "endSeconds">): {
  startSeconds: number;
  durationSeconds: number;
} {
  const startSeconds = Math.max(0, segment.startSeconds - SEGMENT_HEAD_PADDING_SECONDS);
  const spokenDuration = Math.max(0.8, segment.endSeconds - segment.startSeconds);
  const actualHeadPadding = segment.startSeconds - startSeconds;
  return {
    startSeconds,
    // A planned semantic unit must never be clipped merely to make a visual
    // rhythm target. The planner keeps merged units short; this preserves the
    // final spoken word if an unusually long but valid unit is selected.
    durationSeconds: spokenDuration + actualHeadPadding + SEGMENT_TAIL_PADDING_SECONDS
  };
}

function buildSegmentAudioFilter(
  segment: Pick<SelectedClipSegment, "startSeconds" | "endSeconds" | "words">,
  window: { startSeconds: number; durationSeconds: number }
): string {
  const lastWordEnd = segment.words?.reduce((latest, word) => Math.max(latest, word.endSeconds), segment.startSeconds) ?? segment.endSeconds;
  // ASR word timestamps are the only safe boundary. Segment end padding may
  // overlap the next sentence, especially in fast livestream speech.
  const selectedSpeechDuration = Math.max(0.08, Math.min(
    window.durationSeconds,
    lastWordEnd - window.startSeconds
  ));
  const silentTail = Math.max(0, window.durationSeconds - selectedSpeechDuration);
  return [
    `atrim=0:${selectedSpeechDuration.toFixed(3)}`,
    `apad=pad_dur=${silentTail.toFixed(3)}`,
    `atrim=0:${window.durationSeconds.toFixed(3)}`,
    "loudnorm=I=-16:TP=-1.5:LRA=11"
  ].join(",");
}

function extractOpeningProductName(text: string): string | undefined {
  const clean = text.replace(/\s+/g, "");
  const match = clean.match(/(?:东北)?(?:笨榨)?(?:大)?豆油|小豆油|食用油|花生油|葵花籽油|菜籽油/);
  return match?.[0];
}

function buildOverlayAss(input: ClipRenderInput, durationSeconds: number): string {
  const headline = escapeAss(input.headline || input.sellingPoint || "今日好物分享");
  const notes = getTemplateNotes(input).map((note) => escapeAss(note)).filter(Boolean);
  const cta = escapeAss(input.cta || "按需了解 · 理性下单");
  const headEnd = Math.min(6, durationSeconds * 0.25);
  const noteWindows: Array<[number, number]> = [
    [durationSeconds * 0.18, durationSeconds * 0.38],
    [durationSeconds * 0.4, durationSeconds * 0.67],
    [durationSeconds * 0.69, Math.max(durationSeconds * 0.69 + 0.8, durationSeconds - 4.8)]
  ];
  const ctaStart = Math.max(0, durationSeconds - 4.5);
  return `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Head,Microsoft YaHei,62,&H00FFFFFF,&H00FFFFFF,&H00151A22,&H78000000,-1,0,0,0,100,100,1,0,1,5,1,8,72,72,118,1
Style: Note,Microsoft YaHei,42,&H00FFFFFF,&H00FFFFFF,&H00151A22,&H78000000,0,0,0,0,100,100,0,0,1,4,1,2,80,80,215,1
Style: CTA,Microsoft YaHei,48,&H001B1B1B,&H001B1B1B,&H0029F0C8,&H0029F0C8,-1,0,0,0,100,100,1,0,3,16,0,2,120,120,92,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,${toAssTime(headEnd)},Head,,0,0,0,,{\\fad(160,240)}${headline}
${notes.map((note, index) => {
    const [start, end] = noteWindows[index] ?? noteWindows[noteWindows.length - 1];
    return `Dialogue: 0,${toAssTime(start)},${toAssTime(end)},Note,,0,0,0,,{\\fad(180,220)}${note}`;
  }).join("\n")}\nDialogue: 0,${toAssTime(ctaStart)},${toAssTime(durationSeconds)},CTA,,0,0,0,,{\\fad(180,180)}${cta}
`;
}

function getTemplateNotes(input: ClipRenderInput): string[] {
  const sellingPoint = input.sellingPoint;
  const audience = input.audience ? `适合：${input.audience}` : "";
  const personalView = input.personalView;
  switch (input.contentTemplate) {
    case "体验推荐":
      return [personalView, sellingPoint, audience];
    case "适合人群":
      return [audience, sellingPoint, personalView];
    case "痛点解决":
      return [sellingPoint, personalView, audience];
    case "常见问题":
      return [audience, personalView, sellingPoint];
    case "价格权益":
      return [sellingPoint, audience, personalView];
    default:
      return [sellingPoint, audience, personalView];
  }
}

let nvencSupport: boolean | undefined;
async function supportsNvenc(): Promise<boolean> {
  if (nvencSupport !== undefined) return nvencSupport;
  try {
    const output = await runProcess(ffmpegName, ["-hide_banner", "-encoders"], 10_000);
    nvencSupport = output.includes("h264_nvenc");
  } catch {
    nvencSupport = false;
  }
  return nvencSupport;
}

function runProcess(command: string, args: string[], timeoutMs: number, cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`视频处理超过 ${Math.round(timeoutMs / 60_000)} 分钟，已停止`));
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-16_000);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(`${stdout}\n${stderr}`);
      else reject(new Error(`视频处理失败（${code ?? "unknown"}）：${stderr.slice(-1_200)}`));
    });
  });
}

function parseFrameRate(value?: string): number {
  if (!value) return 0;
  const [numerator, denominator] = value.split("/").map(Number);
  return denominator ? numerator / denominator : numerator || 0;
}

function toAssTime(seconds: number): string {
  const safe = Math.max(0, seconds);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = (safe % 60).toFixed(2).padStart(5, "0");
  return `${hours}:${String(minutes).padStart(2, "0")}:${secs}`;
}

function escapeAss(value: string): string {
  return value.replace(/[\r\n]+/g, " ").replace(/[{}]/g, "").slice(0, 48);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function formatSeconds(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

function visualTemplateLabel(template: ClipVisualTemplate): string {
  if (template === "focus") return "应用商品聚焦版式，轻度放大主体";
  if (template === "depth") return "应用景深卡片版式，增加背景层次";
  return "应用原生清晰版式，保留主要构图";
}

function toneLabel(tone: ClipTone): string {
  if (tone === "warm") return "应用暖色商品氛围，轻度提升饱和度";
  if (tone === "clear") return "应用清晰增强，轻度提升锐度与对比度";
  return "执行自然色彩校正";
}

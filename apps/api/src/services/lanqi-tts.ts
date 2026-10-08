// 兰琪美业门店 AI 经营大脑 · 一键成片 · 台词配音（阿里 TTS）
//
// 2026-10-05（用户拍板）：台词出声的链路 = 每镜口播稿 → TTS 合成语音 → 图生视频 audio_url 对口型。
// 通道：DashScope qwen-tts（HTTP 一步返回音频 URL，与平台已有的 DASHSCOPE_API_KEY 同一套鉴权）。
// 音频下载后转存本租户 OSS 暂存桶（HTTPS 签名外链），视频模型从那里抓取。
//
// 备注：用户提供的智能语音交互 AppKey（GjOPx4E3C6qHDxJF）属于 NLS 项目；当前走百炼通道
// 不需要额外密钥。若后续要求切 NLS 项目计费，再接 NLS WebSocket 合成并补 RAM AK。

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { env } from "../config/env.js";
import { ossStagedUrl, putOssStagedBytes } from "./lanqi-media-staging.js";

/** 内置音色（qwen-tts 实测可用）。 */
export const LANQI_TTS_VOICES = [
  { k: "Cherry", n: "芊悦 · 女声温柔" },
  { k: "Serena", n: "苏瑶 · 女声清亮" },
  { k: "Ethan", n: "晨煦 · 男声沉稳" }
] as const;

export type LanqiTtsVoice = (typeof LANQI_TTS_VOICES)[number]["k"];

export function isLanqiTtsVoice(voice: string | undefined): voice is LanqiTtsVoice {
  return typeof voice === "string" && LANQI_TTS_VOICES.some((item) => item.k === voice);
}

/** 同租户 + 同音色 + 同文本的结果缓存在进程内：重试/重生成不重复花钱。 */
const synthCache = new Map<string, { audioUrl: string; size: number; base64: string; durationSeconds: number | null }>();

/** ffprobe 量音频实际秒数（2026-10-07 用户拍板：视频时长 = 音频实长 + 1s，不再按字数猜）。失败返回 null，不阻塞主链路。 */
function measureAudioDurationSeconds(bytes: Buffer): number | null {
  let dir: string | null = null;
  try {
    dir = mkdtempSync(join(tmpdir(), "lanqi-tts-"));
    const file = join(dir, "audio.raw");
    writeFileSync(file, bytes);
    const result = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { timeout: 15_000, encoding: "utf8" });
    if (result.status !== 0) return null;
    const seconds = Number.parseFloat((result.stdout ?? "").trim());
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
  } catch {
    return null;
  } finally {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
}

async function callQwenTts(text: string, voice: string): Promise<Buffer> {
  const response = await fetch("https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.DASHSCOPE_API_KEY ?? ""}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "qwen-tts-latest", input: { text, voice } }),
    signal: AbortSignal.timeout(60_000)
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`tts_provider_${response.status}:${body.slice(0, 160)}`);
  }
  const payload = JSON.parse(await response.text()) as { output?: { audio?: { url?: string } } };
  const audioUrl = payload.output?.audio?.url;
  if (!audioUrl) throw new Error("tts_provider_no_audio");
  // 音频在厂商 OSS（HTTP 外链、24 小时失效）→ 下载转存我们自己的租户暂存桶。
  const audioResponse = await fetch(audioUrl, { signal: AbortSignal.timeout(60_000) });
  if (!audioResponse.ok) throw new Error(`tts_download_${audioResponse.status}`);
  const bytes = Buffer.from(await audioResponse.arrayBuffer());
  if (bytes.length === 0 || bytes.length > 15 * 1024 * 1024) throw new Error("tts_audio_invalid_size");
  return bytes;
}

/**
 * 合成一镜的台词语音并转存租户 OSS，返回视频模型可抓取的 HTTPS 音频外链。
 * 同文本同音色走进程内缓存，不重复计费。
 */
export async function synthesizeLanqiShotVoiceover(params: { tenantId: string; text: string; voice: string }): Promise<{ audioUrl: string; size: number; base64: string; durationSeconds: number | null }> {
  const text = params.text.replace(/\s+/g, " ").trim().slice(0, 500);
  if (!text) throw new Error("tts_empty_text");
  const voice = isLanqiTtsVoice(params.voice) ? params.voice : "Cherry";
  const textHash = createHash("sha256").update(`${voice}\n${text}`).digest("hex").slice(0, 24);
  const cacheKey = `${params.tenantId}:${textHash}`;
  const cached = synthCache.get(cacheKey);
  if (cached) return cached;

  const bytes = await callQwenTts(text, voice);
  const durationSeconds = measureAudioDurationSeconds(bytes);
  const ossKey = `${env.BEAUTY_VIDEO_OSS_PREFIX ?? ""}direct/${params.tenantId}/tts/${textHash}.mp3`;
  await putOssStagedBytes({ key: ossKey, contentType: "audio/mpeg", bytes });
  const audioUrl = await ossStagedUrl({ key: ossKey });
  if (!audioUrl) throw new Error("tts_upload_failed");
  const result = { audioUrl, size: bytes.length, base64: bytes.toString("base64"), durationSeconds };
  synthCache.set(cacheKey, result);
  return result;
}

export const LANQI_TTS_PREVIEW_TEXT = "大家好，欢迎来到我们的店，向已经收到大家的反馈了。";

/** 试听专用的合成缓存（与正式出片分开，试听不碰 OSS——2026-10-07 用户反馈：OSS 凭证过期不该连试听一起挂）。 */
const previewCache = new Map<string, { base64: string; size: number }>();

/**
 * 试听合成：qwen-tts 出音频后**直接返回 base64**，不转存 OSS。
 * OSS 暂存只在「正式出片」（视频模型要按 URL 抓音频）时才需要；试听在浏览器里播放，用不上它。
 */
export async function synthesizeLanqiShotPreviewVoiceover(params: { tenantId: string; text: string; voice: string }): Promise<{ base64: string; size: number }> {
  const text = params.text.replace(/\s+/g, " ").trim().slice(0, 500);
  if (!text) throw new Error("tts_empty_text");
  const voice = isLanqiTtsVoice(params.voice) ? params.voice : "Cherry";
  const textHash = createHash("sha256").update(`${voice}\n${text}`).digest("hex").slice(0, 24);
  const cacheKey = `${params.tenantId}:${textHash}`;
  const cached = previewCache.get(cacheKey);
  if (cached) return cached;
  const bytes = await callQwenTts(text, voice);
  const result = { base64: bytes.toString("base64"), size: bytes.length };
  previewCache.set(cacheKey, result);
  return result;
}

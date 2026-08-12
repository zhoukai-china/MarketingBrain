import type { FastifyInstance } from "fastify";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import * as XLSX from "xlsx";
import { env, domesticNetworkOnly, domesticOutboundAllowlist } from "../config/env.js";
import { assertOutboundUrlAllowed } from "../services/outbound-policy.js";
import { analyzeRestaurantDiagnosticWorkbook, type RestaurantDiagnosticSummary } from "../services/restaurant-diagnostic.js";

const execFileAsync = promisify(execFile);
const mediaRateWindows = new Map<string, { startedAt: number; count: number }>();

interface MediaAnalyzeResult {
  provider: "aliyun-bailian";
  configured: boolean;
  filename: string;
  mimeType: string;
  byteSize: number;
  framesAnalyzed: number;
  frameSummary?: string;
  transcript?: string;
  documentText?: string;
  restaurantDiagnostic?: RestaurantDiagnosticSummary;
  warnings: string[];
  contextText: string;
}

export async function registerMediaRoutes(app: FastifyInstance): Promise<void> {
  app.post("/media/analyze", async (request, reply) => {
    if (!consumeMediaAllowance(request.ip, Boolean(request.headers.authorization))) {
      return reply.code(429).send({ error: "media_rate_limited", message: "文件解析请求较多，请稍后再试。" });
    }
    const parts = request.parts();
    let filename = "upload.bin";
    let mimeType = "application/octet-stream";
    let buffer: Buffer | undefined;
    let frameDataUrls: string[] = [];
    let metadata = "";

    for await (const part of parts) {
      if (part.type === "file") {
        filename = part.filename || filename;
        mimeType = part.mimetype || mimeType;
        buffer = await part.toBuffer();
        continue;
      }
      if (part.fieldname === "frames" && typeof part.value === "string") {
        frameDataUrls = parseFrameDataUrls(part.value);
      }
      if (part.fieldname === "metadata" && typeof part.value === "string") {
        metadata = part.value.slice(0, 500);
      }
    }

    if (!buffer) {
      return reply.code(400).send({ error: "file_required", message: "请上传需要解析的视频、音频或图片文件" });
    }

    if (!isSupportedBusinessFile(filename, mimeType)) {
      return reply.code(415).send({
        error: "unsupported_file_type",
        message: "暂不支持该文件格式。请上传图片、音视频、PDF、DOCX、XLSX、CSV或文本文件。"
      });
    }

    const result = await analyzeMediaWithBailian({
      filename,
      mimeType,
      buffer,
      frameDataUrls,
      metadata
    });
    return result;
  });
}

function consumeMediaAllowance(ip: string, authenticated: boolean): boolean {
  const now = Date.now();
  const key = `${authenticated ? "auth" : "public"}:${ip}`;
  const current = mediaRateWindows.get(key);
  const limit = authenticated ? 80 : 20;
  if (!current || now - current.startedAt >= 60 * 60 * 1000) {
    mediaRateWindows.set(key, { startedAt: now, count: 1 });
    if (mediaRateWindows.size > 2_000) {
      for (const [entryKey, value] of mediaRateWindows) {
        if (now - value.startedAt >= 60 * 60 * 1000) mediaRateWindows.delete(entryKey);
      }
    }
    return true;
  }
  if (current.count >= limit) return false;
  current.count += 1;
  return true;
}

async function analyzeMediaWithBailian(params: {
  filename: string;
  mimeType: string;
  buffer: Buffer;
  frameDataUrls: string[];
  metadata: string;
}): Promise<MediaAnalyzeResult> {
  const warnings: string[] = [];
  const configured = Boolean(getBailianApiKey() && getBailianBaseUrl());
  let frameSummary = "";
  let transcript = "";
  let documentText = "";
  let restaurantDiagnostic: RestaurantDiagnosticSummary | undefined;

  if (isBusinessDocument(params.mimeType, params.filename)) {
    try {
      documentText = await extractBusinessDocumentText(params.buffer, params.mimeType, params.filename);
      if (isWorkbookFile(params.filename)) {
        restaurantDiagnostic = analyzeRestaurantDiagnosticWorkbook(params.buffer);
      }
      if (!documentText) warnings.push("文件中没有读取到可用正文或数据。");
    } catch (error) {
      warnings.push(`业务文件解析失败：${formatError(error)}`);
    }
  }

  if (!configured) {
    if (!documentText) warnings.push("智能视觉/语音解析暂未启用，本次仅使用可读取的文件基础信息。");
  } else {
    if (params.frameDataUrls.length > 0) {
      try {
        frameSummary = await analyzeFrames(params.frameDataUrls, params.metadata);
      } catch (error) {
        warnings.push(`关键帧解析失败：${formatError(error)}`);
      }
    } else if (params.mimeType.startsWith("image/")) {
      try {
        frameSummary = await analyzeFrames([bufferToDataUrl(params.buffer, params.mimeType)], params.metadata);
      } catch (error) {
        warnings.push(`图片解析失败：${formatError(error)}`);
      }
    } else if (params.mimeType.startsWith("video/")) {
      warnings.push("前端未抽取到可用关键帧，已跳过画面解析。");
    }

    if (isPdfFile(params.mimeType, params.filename) && documentText.replace(/\s/g, "").length < 80) {
      try {
        const pages = await renderPdfPages(params.buffer, 4);
        if (pages.length > 0) {
          frameSummary = await analyzeDocumentPages(pages, params.filename);
          warnings.push("该PDF正文较少，已使用前4页页面识别补充内容。");
        }
      } catch (error) {
        warnings.push(`扫描PDF页面识别失败：${formatError(error)}`);
      }
    }

    if (shouldTryAsr(params.mimeType, params.filename, params.buffer.byteLength)) {
      try {
        transcript = await transcribeMedia(params.buffer, params.mimeType, params.filename);
      } catch (error) {
        warnings.push(`语音转写失败：${formatError(error)}`);
      }
    } else if (isAudioVideoFile(params.mimeType, params.filename)) {
      warnings.push(`文件超过 ${env.ALIYUN_MEDIA_BASE64_MAX_MB}MB 或不是可转写音视频，已跳过 ASR。`);
    }
  }

  return {
    provider: "aliyun-bailian",
    configured,
    filename: params.filename,
    mimeType: params.mimeType,
    byteSize: params.buffer.byteLength,
    framesAnalyzed: params.frameDataUrls.length,
    frameSummary: frameSummary || undefined,
    transcript: transcript || undefined,
    documentText: documentText || undefined,
    restaurantDiagnostic: restaurantDiagnostic?.recognized ? restaurantDiagnostic : undefined,
    warnings,
    contextText: buildMediaContextText({
      filename: params.filename,
      mimeType: params.mimeType,
      byteSize: params.buffer.byteLength,
      metadata: params.metadata,
      frameCount: params.frameDataUrls.length,
      frameSummary,
      transcript,
      documentText: [documentText, restaurantDiagnostic?.contextText].filter(Boolean).join("\n\n"),
      warnings
    })
  };
}

async function analyzeFrames(frameDataUrls: string[], metadata: string): Promise<string> {
  const content: Array<Record<string, unknown>> = [
    {
      type: "text",
      text: [
        "你是思潼IP获客智能体的素材解析器。只提取事实，不生成营销方案。",
        "请基于这些从用户上传视频中抽取的关键帧，输出：",
        "1. 主要画面和人物/产品/场景",
        "2. 开头3秒可能给用户的第一印象",
        "3. 画面里能作为信任证据的素材",
        "4. 拍摄/剪辑上明显影响完播、互动、转化的问题",
        metadata ? `浏览器识别信息：${metadata}` : ""
      ]
        .filter(Boolean)
        .join("\n")
    },
    ...frameDataUrls.slice(0, 8).map((url) => ({
      type: "image_url",
      image_url: { url }
    }))
  ];

  return callBailianChat({
    model: env.ALIYUN_VIDEO_MODEL,
    messages: [{ role: "user", content }]
  });
}

async function transcribeMedia(buffer: Buffer, mimeType: string, filename: string): Promise<string> {
  const audio = mimeType.startsWith("video/")
    ? await extractAudioForAsr(buffer, filename)
    : { buffer, mimeType: normalizeAudioMimeType(mimeType, filename), format: inferAudioFormat(mimeType, filename) };
  const data = `data:${audio.mimeType};base64,${audio.buffer.toString("base64")}`;
  return callBailianChat({
    model: env.ALIYUN_ASR_MODEL,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "input_audio",
            input_audio: {
              data
            }
          }
        ]
      }
    ],
    extraBody: {
      asr_options: {
        enable_itn: false
      }
    }
  });
}

async function extractAudioForAsr(
  buffer: Buffer,
  filename: string
): Promise<{ buffer: Buffer; mimeType: string; format: string }> {
  const ffmpegPath = await resolveBinaryPath("ffmpeg");
  const tempRoot = await mkdtemp(path.join(tmpdir(), "sitong-media-"));
  const inputPath = path.join(tempRoot, sanitizeTempFilename(filename || `${randomUUID()}.mp4`));
  const outputPath = path.join(tempRoot, `${randomUUID()}.mp3`);
  try {
    await writeFile(inputPath, buffer);
    try {
      await execFileAsync(
        ffmpegPath,
        ["-y", "-i", inputPath, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "64k", outputPath],
        { timeout: 30000, windowsHide: true, maxBuffer: 1024 * 1024 }
      );
    } catch {
      throw new Error("视频音频轨提取失败，请确认文件可正常播放且包含清晰人声。");
    }
    return { buffer: await readFile(outputPath), mimeType: "audio/mpeg", format: "mp3" };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function resolveBinaryPath(binaryName: "ffmpeg" | "ffprobe"): Promise<string> {
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

function sanitizeTempFilename(filename: string): string {
  const extension = path.extname(filename) || ".bin";
  return `${randomUUID()}${extension.replace(/[^.\w-]/g, "")}`;
}

async function callBailianChat(params: {
  model: string;
  messages: Array<Record<string, unknown>>;
  extraBody?: Record<string, unknown>;
}): Promise<string> {
  const apiKey = getBailianApiKey();
  const baseUrl = getBailianBaseUrl();
  if (!apiKey || !baseUrl) throw new Error("百炼 API Key 未配置");
  assertOutboundUrlAllowed("Aliyun Bailian media analysis", baseUrl, {
    domesticNetworkOnly,
    allowedHosts: domesticOutboundAllowlist
  });
  const response = await fetch(buildChatCompletionsUrl(baseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: params.model,
      messages: params.messages,
      temperature: 0.2,
      ...params.extraBody
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${response.status} ${body.slice(0, 220)}`);
  }

  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = json.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("百炼返回为空");
  return content;
}

function getBailianApiKey(): string | undefined {
  return env.ALIYUN_API_KEY || env.DASHSCOPE_API_KEY;
}

function getBailianBaseUrl(): string | undefined {
  return env.ALIYUN_BASE_URL || env.DASHSCOPE_BASE_URL;
}

function buildChatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/$/, "");
  return trimmed.endsWith("/chat/completions") ? trimmed : `${trimmed}/chat/completions`;
}

function shouldTryAsr(mimeType: string, filename: string, byteSize: number): boolean {
  const maxBytes = env.ALIYUN_MEDIA_BASE64_MAX_MB * 1024 * 1024;
  if (byteSize > maxBytes) return false;
  return isAudioVideoFile(mimeType, filename);
}

function isAudioVideoFile(mimeType: string, filename: string): boolean {
  return mimeType.startsWith("audio/") || mimeType.startsWith("video/") || /\.(mp3|wav|m4a|aac|mp4|mov|m4v|webm)$/i.test(filename);
}

function inferAudioFormat(mimeType: string, filename: string): string {
  const extension = filename.split(".").pop()?.toLowerCase();
  if (extension) return extension === "m4v" ? "mp4" : extension;
  if (mimeType.includes("mpeg")) return "mp3";
  if (mimeType.includes("wav")) return "wav";
  if (mimeType.includes("mp4")) return "mp4";
  if (mimeType.includes("webm")) return "webm";
  return "mp3";
}

function normalizeAudioMimeType(mimeType: string, filename: string): string {
  if (mimeType.startsWith("audio/")) return mimeType;
  const format = inferAudioFormat(mimeType, filename);
  if (format === "mp3") return "audio/mpeg";
  if (format === "wav") return "audio/wav";
  if (format === "m4a") return "audio/mp4";
  if (format === "aac") return "audio/aac";
  if (format === "webm") return "audio/webm";
  return "audio/mpeg";
}

const BUSINESS_DOCUMENT_EXTENSIONS = new Set([".pdf", ".docx", ".xlsx", ".xls", ".csv", ".tsv", ".txt", ".md", ".json", ".log"]);

function isSupportedBusinessFile(filename: string, mimeType: string): boolean {
  const extension = path.extname(filename).toLowerCase();
  return mimeType.startsWith("image/")
    || mimeType.startsWith("video/")
    || mimeType.startsWith("audio/")
    || BUSINESS_DOCUMENT_EXTENSIONS.has(extension)
    || mimeType.startsWith("text/")
    || mimeType === "application/json";
}

function isBusinessDocument(mimeType: string, filename: string): boolean {
  return BUSINESS_DOCUMENT_EXTENSIONS.has(path.extname(filename).toLowerCase())
    || mimeType.startsWith("text/")
    || mimeType === "application/json";
}

function isWorkbookFile(filename: string): boolean {
  const extension = path.extname(filename).toLowerCase();
  return extension === ".xlsx" || extension === ".xls";
}

function isPdfFile(mimeType: string, filename: string): boolean {
  return mimeType === "application/pdf" || path.extname(filename).toLowerCase() === ".pdf";
}

export async function extractBusinessDocumentText(buffer: Buffer, mimeType: string, filename: string): Promise<string> {
  const extension = path.extname(filename).toLowerCase();
  let content = "";
  if (isPdfFile(mimeType, filename)) {
    const parser = new PDFParse({ data: buffer });
    try {
      content = (await parser.getText()).text;
    } finally {
      await parser.destroy();
    }
  } else if (extension === ".docx") {
    content = (await mammoth.extractRawText({ buffer })).value;
  } else if (extension === ".xlsx" || extension === ".xls") {
    content = extractWorkbookText(buffer);
  } else {
    content = buffer.toString("utf8");
  }
  const normalized = content.replace(/\u0000/g, "").replace(/[ \t]+\n/g, "\n").trim();
  if (!normalized) return "";
  return normalized.length > 16_000 ? `${normalized.slice(0, 16_000)}\n\n[文件内容较长，本轮已读取前16000字]` : normalized;
}

function extractWorkbookText(buffer: Buffer): string {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false, dense: true });
  const sections = workbook.SheetNames.slice(0, 5).map((sheetName) => {
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) return `工作表：${sheetName}\n[空工作表]`;
    const rows = XLSX.utils.sheet_to_json<Array<string | number | boolean>>(worksheet, {
      header: 1,
      raw: false,
      defval: "",
      blankrows: false
    }).slice(0, 120);
    const rendered = rows.map((row) => row.slice(0, 30).map((cell) => String(cell).replace(/\s+/g, " ").trim()).join("\t"));
    return [`工作表：${sheetName}`, ...rendered].join("\n");
  });
  return sections.join("\n\n");
}

async function renderPdfPages(buffer: Buffer, maxPages: number): Promise<string[]> {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getScreenshot({ first: maxPages, desiredWidth: 1400, imageDataUrl: true });
    return result.pages.map((page) => page.dataUrl).filter(Boolean);
  } finally {
    await parser.destroy();
  }
}

async function analyzeDocumentPages(pageDataUrls: string[], filename: string): Promise<string> {
  return callBailianChat({
    model: env.ALIYUN_VIDEO_MODEL,
    messages: [{
      role: "user",
      content: [
        {
          type: "text",
          text: [
            "你是思潼获客Agent的业务文件识别器，只提取页面中能直接看到的事实，不生成营销方案。",
            `文件：${filename}`,
            "请按页面提取标题、正文、表格字段、关键数字和明确结论；看不清的内容标记为无法识别，禁止猜测。"
          ].join("\n")
        },
        ...pageDataUrls.map((url) => ({ type: "image_url", image_url: { url } }))
      ]
    }]
  });
}

function buildMediaContextText(params: {
  filename: string;
  mimeType: string;
  byteSize: number;
  metadata: string;
  frameCount: number;
  frameSummary: string;
  transcript: string;
  documentText: string;
  warnings: string[];
}): string {
  const lines = [
    "【业务文件解析结果】",
    `文件：${params.filename}`,
    `类型：${params.mimeType}`,
    `大小：${formatFileSize(params.byteSize)}`,
    params.metadata ? `基础信息：${params.metadata}` : "",
    params.frameCount > 0 ? `关键帧：已抽取 ${params.frameCount} 帧` : "",
    params.frameSummary ? `画面解析：\n${params.frameSummary}` : "",
    params.transcript ? `语音/字幕转写：\n${params.transcript}` : "",
    params.documentText ? `文件正文/数据：\n${params.documentText}` : "",
    params.warnings.length ? `解析提示：${params.warnings.join("；")}` : ""
  ].filter(Boolean);
  return lines.join("\n");
}

function parseFrameDataUrls(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string" && /^data:image\//.test(item)).slice(0, 8)
      : [];
  } catch {
    return [];
  }
}

function bufferToDataUrl(buffer: Buffer, mimeType: string): string {
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "大小未知";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

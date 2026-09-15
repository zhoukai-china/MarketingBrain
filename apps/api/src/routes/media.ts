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
import { visionCostCny } from "../services/billing-cost-model.js";
import {
  InsufficientCreditsForChargeError,
  refundAllCreditsForCharge,
  reserveCreditsForCharge,
  settleCreditsForCharge
} from "../services/credit-charge.js";
import { resolveRequestContext } from "../services/request-context.js";
import { analyzeRestaurantDiagnosticWorkbook, type RestaurantDiagnosticSummary } from "../services/restaurant-diagnostic.js";
import {
  callObservedMediaChat,
  getMediaProviderObservation,
  inferAliyunRegion,
  summarizeMediaAnalysis,
  type MediaProviderObservation,
  type MediaProviderStage
} from "../services/media-provider-observation.js";

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
  providerTrace: MediaProviderObservation[];
  analysisStatus: ReturnType<typeof summarizeMediaAnalysis>;
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

    // This shared upload route has no server-bound ASR purpose/tenant/budget
    // admission contract. A configured key or client-supplied Authorization
    // header is not permission to send recordings outside the application.
    // Keep document parsing independent; authorized product adapters remain separate.
    if (isAudioVideoFile(mimeType, filename)) {
      request.log.info({
        event: "media_analysis.admission_rejected",
        stage: "asr_admission",
        code: "asr_authorization_required",
        providerCalls: 0
      }, "media analysis stopped before external processing");
      return reply.code(503).send({
        error: "asr_authorization_required",
        message: "当前入口尚未接通受授权的音视频转写。请先提供已有转写文本；自动转写须完成服务端用途、权限与费用授权后才能使用，本次未调用转写服务、未扣积分。",
        stage: "asr_admission",
        retryable: false,
        providerCalls: 0,
        creditCost: 0
      });
    }

    const controller = new AbortController();
    const onAborted = () => controller.abort(new Error("client_cancelled"));
    request.raw.once("aborted", onAborted);

    /**
     * 计费（PLAT-41，用户 2026-09-15：「图片解析 + 扫描版 PDF 页面识别按 100 倍扣积分」）。
     * - 只有会调用视觉模型（qwen-vl）的路径才收费：单张图片 = 1 次；PDF 预按 4 页上界预留；
     * - CSV / XLSX / TXT / DOCX 等纯文档解析不调模型，**不收费**；
     * - 先预留 → 跑完按实际视觉调用次数结算 → 差额退回；余额不足在调用前 402。
     */
    const isImageUpload = mimeType.startsWith("image/");
    const isPdfUpload = isPdfFile(mimeType, filename);
    const estimatedVisionCalls = isImageUpload ? Math.max(1, frameDataUrls.length) : isPdfUpload ? 4 : 0;
    let mediaReservation: Awaited<ReturnType<typeof reserveCreditsForCharge>> | null = null;
    let mediaUserId: string | null = null;
    if (estimatedVisionCalls > 0) {
      try {
        const context = await resolveRequestContext(request.headers);
        // 演示模式没有真实钱包：跳过计费。
        if (context.source !== "database") throw Object.assign(new Error("skip_charge_demo"), { skipCharge: true });
        mediaUserId = context.userId;
        mediaReservation = await reserveCreditsForCharge({
          userId: context.userId,
          requestId: `media:${context.userId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
          capability: "vision",
          estimatedCostCny: visionCostCny(estimatedVisionCalls),
          skillId: "media_analyze",
          source: "web"
        });
      } catch (error) {
        if ((error as { skipCharge?: boolean }).skipCharge) {
          mediaReservation = null;
          mediaUserId = null;
        } else {
        request.raw.off("aborted", onAborted);
        if (error instanceof InsufficientCreditsForChargeError) {
          return reply.code(402).send({
            error: "insufficient_credits",
            message: `图片 / 扫描件解析的积分不足（本次约需 ${error.required} 积分），请先充值后再用。`,
            stage: "credit_admission",
            required: error.required,
            balance: error.wallet.balance,
            rechargeUrl: "/recharge",
            providerCalls: 0,
            creditCost: 0
          });
        }
        throw error;
        }
      }
    }

    try {
      const result = await analyzeMediaWithBailian({
        filename,
        mimeType,
        buffer,
        frameDataUrls,
        metadata,
        signal: controller.signal
      });
      let creditCost = 0;
      let creditRefunded = 0;
      if (mediaReservation && mediaUserId) {
        const actualVisionCalls = Math.max(1, result.providerTrace.filter((item) => item.stage === "visual").length);
        const settled = await settleCreditsForCharge({
          reservation: mediaReservation,
          userId: mediaUserId,
          actualCostCny: visionCostCny(actualVisionCalls),
          skillId: "media_analyze",
          source: "web"
        });
        creditCost = settled.chargedCredits;
        creditRefunded = settled.refundedCredits;
      }
      request.log.info({
        event: "media_analysis.terminal",
        analysisStatus: result.analysisStatus,
        creditCost,
        providerTrace: result.providerTrace
      }, "media analysis completed");
      return { ...result, creditCost, creditRefunded };
    } catch (error) {
      // 失败关闭：解析失败时把预留的积分全额退回。
      if (mediaReservation && mediaUserId) {
        await refundAllCreditsForCharge({ reservation: mediaReservation, userId: mediaUserId, skillId: "media_analyze", source: "web", reason: "media_analyze_failed" }).catch(() => {});
      }
      throw error;
    } finally {
      request.raw.off("aborted", onAborted);
    }
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
  signal?: AbortSignal;
}): Promise<MediaAnalyzeResult> {
  const warnings: string[] = [];
  const providerTrace: MediaProviderObservation[] = [];
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
        const result = await analyzeFrames(params.frameDataUrls, params.metadata, params.signal);
        frameSummary = result.content;
        providerTrace.push(result.observation);
      } catch (error) {
        const observation = observeProviderFailure(error, "visual", env.ALIYUN_VIDEO_MODEL, "image/data-url");
        providerTrace.push(observation);
        warnings.push(providerFailureMessage("关键帧", observation));
      }
    } else if (params.mimeType.startsWith("image/")) {
      try {
        const result = await analyzeFrames([bufferToDataUrl(params.buffer, params.mimeType)], params.metadata, params.signal);
        frameSummary = result.content;
        providerTrace.push(result.observation);
      } catch (error) {
        const observation = observeProviderFailure(error, "visual", env.ALIYUN_VIDEO_MODEL, params.mimeType);
        providerTrace.push(observation);
        warnings.push(providerFailureMessage("图片", observation));
      }
    } else if (params.mimeType.startsWith("video/")) {
      warnings.push("前端未抽取到可用关键帧，已跳过画面解析。");
    }

    if (isPdfFile(params.mimeType, params.filename) && documentText.replace(/\s/g, "").length < 80) {
      try {
        const pages = await renderPdfPages(params.buffer, 4);
        if (pages.length > 0) {
          frameSummary = await analyzeDocumentPages(pages, params.filename, params.signal, providerTrace);
          warnings.push("该PDF正文较少，已使用前4页页面识别补充内容。");
        }
      } catch (error) {
        const observation = observeProviderFailure(error, "visual", env.ALIYUN_VIDEO_MODEL, "application/pdf-pages");
        if (!providerTrace.some((item) => item.requestFingerprint === observation.requestFingerprint)) providerTrace.push(observation);
        warnings.push(providerFailureMessage("扫描PDF页面", observation));
      }
    }

    if (shouldTryAsr(params.mimeType, params.filename, params.buffer.byteLength)) {
      try {
        const result = await transcribeMedia(params.buffer, params.mimeType, params.filename, params.signal);
        transcript = result.content;
        providerTrace.push(result.observation);
      } catch (error) {
        const observation = observeProviderFailure(error, "asr", env.ALIYUN_ASR_MODEL, params.mimeType);
        providerTrace.push(observation);
        warnings.push(providerFailureMessage("语音转写", observation));
      }
    } else if (isAudioVideoFile(params.mimeType, params.filename)) {
      warnings.push(`文件超过 ${env.ALIYUN_MEDIA_BASE64_MAX_MB}MB 或不是可转写音视频，已跳过 ASR。`);
    }
  }

  const analysisStatus = summarizeMediaAnalysis({
    visualRequested: params.frameDataUrls.length > 0 || params.mimeType.startsWith("image/"),
    asrRequested: isAudioVideoFile(params.mimeType, params.filename),
    visualContent: frameSummary,
    transcript,
    observations: providerTrace
  });
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
    providerTrace,
    analysisStatus,
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

async function analyzeFrames(frameDataUrls: string[], metadata: string, signal?: AbortSignal) {
  const content: Array<Record<string, unknown>> = [
    {
      type: "text",
      text: [
        "你是品牌中立的业务素材解析器。只提取文件中可直接验证的事实，不生成营销方案，不补造品牌、门店、人物或效果。",
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
    stage: "visual",
    model: env.ALIYUN_VIDEO_MODEL,
    messages: [{ role: "user", content }],
    inputMediaType: "image/data-url",
    signal,
    temperature: 0.2
  });
}

async function transcribeMedia(buffer: Buffer, mimeType: string, filename: string, signal?: AbortSignal) {
  const audio = mimeType.startsWith("video/")
    ? await extractAudioForAsr(buffer, filename)
    : { buffer, mimeType: normalizeAudioMimeType(mimeType, filename), format: inferAudioFormat(mimeType, filename) };
  const data = `data:${audio.mimeType};base64,${audio.buffer.toString("base64")}`;
  return callBailianChat({
    stage: "asr",
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
    },
    inputMediaType: audio.mimeType,
    signal
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
  stage: MediaProviderStage;
  model: string;
  messages: Array<Record<string, unknown>>;
  extraBody?: Record<string, unknown>;
  inputMediaType: string;
  signal?: AbortSignal;
  temperature?: number;
}) {
  const apiKey = getBailianApiKey();
  const baseUrl = getBailianBaseUrl();
  if (!apiKey || !baseUrl) throw new Error("百炼 API Key 未配置");
  assertOutboundUrlAllowed("Aliyun Bailian media analysis", baseUrl, {
    domesticNetworkOnly,
    allowedHosts: domesticOutboundAllowlist
  });
  return callObservedMediaChat({
    stage: params.stage,
    model: params.model,
    baseUrl,
    apiKey,
    inputMediaType: params.inputMediaType,
    timeoutMs: env.ALIYUN_MEDIA_ANALYSIS_TIMEOUT_MS,
    signal: params.signal,
    body: {
      model: params.model,
      messages: params.messages,
      ...(params.temperature === undefined ? {} : { temperature: params.temperature }),
      ...params.extraBody
    }
  });
}

function getBailianApiKey(): string | undefined {
  return env.ALIYUN_API_KEY || env.DASHSCOPE_API_KEY;
}

function getBailianBaseUrl(): string | undefined {
  return env.ALIYUN_BASE_URL || env.DASHSCOPE_BASE_URL;
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

async function analyzeDocumentPages(
  pageDataUrls: string[],
  filename: string,
  signal: AbortSignal | undefined,
  providerTrace: MediaProviderObservation[]
): Promise<string> {
  const result = await callBailianChat({
    stage: "visual",
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
    }],
    inputMediaType: "application/pdf-pages",
    signal,
    temperature: 0.2
  });
  providerTrace.push(result.observation);
  return result.content;
}

function observeProviderFailure(
  error: unknown,
  stage: MediaProviderStage,
  model: string,
  inputMediaType: string
): MediaProviderObservation {
  const baseUrl = getBailianBaseUrl() ?? "https://dashscope.aliyuncs.com/compatible-mode/v1";
  const endpointHost = new URL(baseUrl).hostname;
  return getMediaProviderObservation(error, {
    stage,
    provider: "aliyun-bailian",
    model,
    region: inferAliyunRegion(endpointHost),
    endpointHost,
    inputMediaType,
    timeoutMs: env.ALIYUN_MEDIA_ANALYSIS_TIMEOUT_MS
  });
}

function providerFailureMessage(label: string, observation: MediaProviderObservation): string {
  const suffix = observation.providerCode ?? observation.terminalCode;
  if (observation.terminalStatus === "timed_out") return `${label}解析超时（${suffix}）。`;
  if (observation.terminalStatus === "cancelled") return `${label}解析已取消（${suffix}）。`;
  return `${label}解析失败（${suffix}）。`;
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

import type { FastifyInstance, FastifyRequest } from "fastify";
import { domesticNetworkOnly, domesticOutboundAllowlist, env } from "../config/env.js";
import { assertOutboundUrlAllowed } from "../services/outbound-policy.js";
import { resolveRequestContext } from "../services/request-context.js";
import {
  callObservedMediaChat,
  getMediaProviderObservation,
  summarizeMediaAnalysis,
  type MediaProviderObservation
} from "../services/media-provider-observation.js";
import { speechCostCny } from "../services/billing-cost-model.js";
import {
  InsufficientCreditsForChargeError,
  refundAllCreditsForCharge,
  reserveCreditsForCharge,
  settleCreditsForCharge
} from "../services/credit-charge.js";

/**
 * 公共平台语音输入（PLAT-33）。
 *
 * 为什么不复用 `/media/analyze`：那个入口是共享上传入口，没有绑定产品用途、
 * 服务端租户权限与 ASR 预算（见 QA-20260905-003 / BY-47），所以它对音视频
 * 一律 503 fail-closed。语音输入是一个**独立、受授权**的转写入口：
 *
 * - 身份准入：身份只来自服务端验签的会话令牌（租户 + 用户），匿名不进入外发路径。
 * - 用途准入：用途由服务端固定为 `web_voice_input`，客户端不能用字段改写。
 * - 预算准入：服务端限体积 + 限「租户+用户」每小时次数，超限 fail-closed。
 * - 失败关闭：缺 Key/超时/上游报错都给人话，明确「未扣积分」，不静默失败。
 *
 * 计费（PLAT-41，用户 2026-09-15）：语音识别按 **10 倍**扣积分，先预留 → 按实际结算 → 差额退回；
 * 余额不足在调用 Provider 之前就 402 拒绝；转写失败全额退回（`creditCost: 0`）。
 */
export const VOICE_TRANSCRIBE_PURPOSE = "web_voice_input";

const voiceRateWindows = new Map<string, { startedAt: number; count: number }>();

interface VoiceTranscribeResponse {
  provider: "aliyun-bailian";
  purpose: typeof VOICE_TRANSCRIBE_PURPOSE;
  configured: boolean;
  transcript?: string;
  mimeType: string;
  byteSize: number;
  elapsedMs: number;
  warnings: string[];
  providerTrace: MediaProviderObservation[];
  /** 本次真实扣费（用户 2026-09-15：语音识别按 10 倍扣积分；失败时 0）。 */
  creditCost: number;
  creditRefunded?: number;
}

export async function registerVoiceRoutes(app: FastifyInstance): Promise<void> {
  app.post("/voice/transcribe", async (request, reply) => {
    // 1) 身份准入。身份只能来自服务端验签的会话令牌；解析失败一律按未登录处理。
    let context: { tenantId: string; userId: string; source: "demo" | "database" };
    try {
      const resolved = await resolveVoiceIdentity(request);
      context = resolved;
    } catch {
      request.log.info({ event: "voice_transcribe.admission_rejected", stage: "identity", providerCalls: 0 }, "voice transcription stopped before external processing");
      return reply.code(401).send({
        error: "voice_login_required",
        message: "语音输入需要先登录后再使用；也可以直接用文字输入。",
        stage: "identity_admission",
        retryable: false,
        providerCalls: 0,
        creditCost: 0
      });
    }

    // 2) 预算准入：按「租户+用户」每小时次数上限，配置读取失败也按超限处理。
    if (!consumeVoiceAllowance(`${context.tenantId}:${context.userId}`)) {
      request.log.info({ event: "voice_transcribe.admission_rejected", stage: "budget", providerCalls: 0 }, "voice transcription stopped before external processing");
      return reply.code(429).send({
        error: "voice_rate_limited",
        message: `语音输入本小时次数已用完（上限 ${env.VOICE_TRANSCRIBE_HOURLY_LIMIT} 次/小时），请稍后再试或直接用文字输入。`,
        stage: "budget_admission",
        retryable: true,
        providerCalls: 0,
        creditCost: 0
      });
    }

    // 3) 文件准入：只接一段录音，限体积、限格式；视频/文档不进外发路径。
    const upload = await readVoiceUpload(request);
    if (upload.kind === "missing") {
      return reply.code(400).send({
        error: "voice_file_required",
        message: "没有收到录音数据，请重新录制后再试。",
        stage: "upload_admission",
        providerCalls: 0,
        creditCost: 0
      });
    }
    if (upload.kind === "too_large") {
      return reply.code(413).send({
        error: "voice_file_too_large",
        message: `录音文件超过 ${env.VOICE_TRANSCRIBE_MAX_MB}MB，请分段录制或直接用文字输入。`,
        stage: "upload_admission",
        retryable: false,
        providerCalls: 0,
        creditCost: 0
      });
    }
    if (upload.kind === "unsupported") {
      return reply.code(415).send({
        error: "voice_format_unsupported",
        message: "语音输入只接收录音音频（webm/m4a/mp3/wav 等）。如果是视频，请先用文字描述或上传到对应智能体的视频入口。",
        stage: "upload_admission",
        retryable: false,
        providerCalls: 0,
        creditCost: 0
      });
    }

    const { filename, mimeType, buffer, durationSeconds } = upload;

    // 4) 上游配置准入：没有配置百炼 Key/地址时明确告知，绝不假装转写成功。
    const apiKey = getBailianApiKey();
    const baseUrl = getBailianBaseUrl();
    if (!apiKey || !baseUrl) {
      request.log.warn({ event: "voice_transcribe.admission_rejected", stage: "provider_config", providerCalls: 0 }, "voice transcription stopped before external processing");
      return reply.code(503).send({
        error: "voice_transcription_not_configured",
        message: "语音转写服务尚未配置（缺少百炼 API Key 或服务地址），请联系管理员；本次未调用转写服务、未扣积分，可直接用文字输入。",
        stage: "provider_admission",
        retryable: false,
        providerCalls: 0,
        creditCost: 0
      });
    }

    const startedAt = Date.now();
    const providerTrace: MediaProviderObservation[] = [];
    const warnings: string[] = [];
    const controller = new AbortController();
    const onAborted = () => controller.abort(new Error("client_cancelled"));
    request.raw.once("aborted", onAborted);

    /**
     * 计费（用户 2026-09-15：「公共平台语音输入（ASR）改成扣积分」，10 倍）：
     * 先按最坏估算预留 → 跑完按实际结算 → 差额退回。时长取
     * `min(客户端上报秒数, 按字节数的上界)`；客户端不报时用字节上界（opus ≈ 4KB/秒）。
     * 宁可多预留再退回，也不让「少报时长」变成少扣费。
     */
    const bytesUpperBoundSeconds = Math.max(1, Math.ceil(buffer.byteLength / 4000));
    const estimatedSeconds = Math.max(
      1,
      Math.min(durationSeconds && durationSeconds > 0 ? durationSeconds : bytesUpperBoundSeconds, bytesUpperBoundSeconds)
    );
    const chargeRequestId = `voice:${context.userId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    let reservation: Awaited<ReturnType<typeof reserveCreditsForCharge>> | null = null;
    // 演示模式没有真实钱包：跳过计费（与其它业务一致），只有 database 模式才预留/结算。
    if (context.source === "database") try {
      reservation = await reserveCreditsForCharge({
        userId: context.userId,
        requestId: chargeRequestId,
        capability: "speech",
        estimatedCostCny: speechCostCny(estimatedSeconds),
        skillId: "voice_input",
        source: "web"
      });
    } catch (error) {
      if (error instanceof InsufficientCreditsForChargeError) {
        request.log.info({ event: "voice_transcribe.admission_rejected", stage: "credits", providerCalls: 0 }, "voice transcription stopped before external processing");
        return reply.code(402).send({
          error: "insufficient_credits",
          message: `语音输入的积分不足（本次约需 ${error.required} 积分），请先充值后再用，或直接用文字输入。`,
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

    try {
      const { content, observation } = await transcribeVoiceAudio({ buffer, mimeType, apiKey, baseUrl, signal: controller.signal });
      providerTrace.push(observation);
      const transcript = content.trim();
      if (!transcript) warnings.push("没有识别到清晰语音。请靠近麦克风、连续说一句完整的话后重试。");
      const settled = reservation
        ? await settleCreditsForCharge({
            reservation,
            userId: context.userId,
            actualCostCny: speechCostCny(estimatedSeconds),
            skillId: "voice_input",
            source: "web"
          })
        : { chargedCredits: 0, refundedCredits: 0 };
      const analysisStatus = summarizeMediaAnalysis({
        visualRequested: false,
        asrRequested: true,
        transcript,
        observations: providerTrace
      });
      const result: VoiceTranscribeResponse = {
        provider: "aliyun-bailian",
        purpose: VOICE_TRANSCRIBE_PURPOSE,
        configured: true,
        transcript: transcript || undefined,
        mimeType,
        byteSize: buffer.byteLength,
        elapsedMs: Math.max(0, Date.now() - startedAt),
        warnings,
        providerTrace,
        creditCost: settled.chargedCredits,
        creditRefunded: settled.refundedCredits
      };
      request.log.info({
        event: "voice_transcribe.terminal",
        purpose: VOICE_TRANSCRIBE_PURPOSE,
        mimeType,
        byteSize: buffer.byteLength,
        transcriptChars: transcript.length,
        asrStatus: analysisStatus.status,
        providerTrace: providerTrace.map((item) => ({ stage: item.stage, terminalStatus: item.terminalStatus, terminalCode: item.terminalCode, requestFingerprint: item.requestFingerprint, billingStarted: item.billingStarted }))
      }, "voice transcription completed");
      return result;
    } catch (error) {
      // 失败关闭：语音没转成，预留的积分全额退回（不扣用户的钱）。
      if (reservation) {
        await refundAllCreditsForCharge({ reservation, userId: context.userId, skillId: "voice_input", source: "web", reason: "voice_transcribe_failed" }).catch(() => {});
      }
      const observation = getMediaProviderObservation(error, {
        stage: "asr",
        provider: "aliyun-bailian",
        model: env.ALIYUN_ASR_MODEL,
        region: "unknown",
        endpointHost: "unknown",
        inputMediaType: mimeType,
        timeoutMs: env.VOICE_TRANSCRIBE_TIMEOUT_MS
      });
      providerTrace.push(observation);
      request.log.warn({
        event: "voice_transcribe.terminal",
        purpose: VOICE_TRANSCRIBE_PURPOSE,
        mimeType,
        byteSize: buffer.byteLength,
        terminalStatus: observation.terminalStatus,
        terminalCode: observation.terminalCode,
        requestFingerprint: observation.requestFingerprint,
        providerTrace: providerTrace.map((item) => ({ stage: item.stage, terminalStatus: item.terminalStatus, terminalCode: item.terminalCode }))
      }, "voice transcription failed");
      if (observation.terminalStatus === "cancelled") {
        return reply.code(499).send({
          error: "voice_transcription_cancelled",
          message: "语音转写已取消；本次未扣积分。",
          stage: "asr",
          retryable: true,
          providerCalls: 1,
          creditCost: 0
        });
      }
      if (observation.terminalStatus === "timed_out") {
        return reply.code(504).send({
          error: "voice_transcription_timeout",
          message: "语音转写超时了，本次未扣积分。请缩短录音后重试，或直接用文字输入。",
          stage: "asr",
          retryable: true,
          providerCalls: 1,
          creditCost: 0
        });
      }
      return reply.code(502).send({
        error: "voice_transcription_failed",
        message: "语音转写服务暂时不可用，本次未扣积分。可以稍后重试，或直接用文字输入。",
        stage: "asr",
        retryable: true,
        providerCalls: 1,
        creditCost: 0
      });
    } finally {
      request.raw.off("aborted", onAborted);
    }
  });
}

/** 身份只取服务端验签会话；拒绝任何「客户端自报用途/租户」的输入方式。 */
async function resolveVoiceIdentity(request: FastifyRequest): Promise<{ tenantId: string; userId: string; source: "demo" | "database" }> {
  const context = await resolveRequestContext(request.headers);
  if (!context.tenantId || !context.userId) throw new Error("missing_tenant_or_user");
  return { tenantId: context.tenantId, userId: context.userId, source: context.source };
}

async function transcribeVoiceAudio(params: {
  buffer: Buffer;
  mimeType: string;
  apiKey: string;
  baseUrl: string;
  signal?: AbortSignal;
}): Promise<{ content: string; observation: MediaProviderObservation }> {
  assertOutboundUrlAllowed("Aliyun Bailian voice transcription", params.baseUrl, {
    domesticNetworkOnly,
    allowedHosts: domesticOutboundAllowlist
  });
  const data = `data:${normalizeVoiceMimeType(params.mimeType)};base64,${params.buffer.toString("base64")}`;
  return callObservedMediaChat({
    stage: "asr",
    model: env.ALIYUN_ASR_MODEL,
    baseUrl: params.baseUrl,
    apiKey: params.apiKey,
    inputMediaType: normalizeVoiceMimeType(params.mimeType),
    timeoutMs: env.VOICE_TRANSCRIBE_TIMEOUT_MS,
    signal: params.signal,
    body: {
      model: env.ALIYUN_ASR_MODEL,
      messages: [
        {
          role: "user",
          content: [{ type: "input_audio", input_audio: { data } }]
        }
      ],
      asr_options: { enable_itn: false }
    }
  });
}

type VoiceUpload =
  | { kind: "ok"; filename: string; mimeType: string; buffer: Buffer; durationSeconds?: number }
  | { kind: "missing" }
  | { kind: "too_large" }
  | { kind: "unsupported" };

/** 只读第一个文件；多传的文件忽略，避免把「语音输入」变成批量上传通道。 */
async function readVoiceUpload(request: FastifyRequest): Promise<VoiceUpload> {
  const maxBytes = env.VOICE_TRANSCRIBE_MAX_MB * 1024 * 1024;
  let filename = "voice-input.bin";
  let mimeType = "application/octet-stream";
  let buffer: Buffer | undefined;
  let tooLarge = false;
  let durationSeconds: number | undefined;

  for await (const part of request.parts()) {
    if (part.type !== "file") continue;
    if (buffer) {
      await part.toBuffer();
      continue;
    }
    filename = part.filename || filename;
    mimeType = part.mimetype || mimeType;
    buffer = await part.toBuffer();
    if (part.file.truncated || buffer.byteLength > maxBytes) tooLarge = true;
  }

  if (tooLarge) return { kind: "too_large" };
  if (!buffer || buffer.byteLength === 0) return { kind: "missing" };
  if (!isVoiceAudioFile(mimeType, filename)) return { kind: "unsupported" };
  return { kind: "ok", filename, mimeType, buffer, durationSeconds };
}

/** 语音输入只收音频；视频也走这里的唯一结果就是被明确拒掉。 */
function isVoiceAudioFile(mimeType: string, filename: string): boolean {
  if (mimeType.startsWith("video/")) return false;
  if (mimeType.startsWith("audio/")) return true;
  return /\.(mp3|wav|m4a|aac|webm|ogg|opus|amr|flac)$/i.test(filename);
}

function normalizeVoiceMimeType(mimeType: string): string {
  const normalized = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (normalized.startsWith("audio/")) return normalized;
  return "audio/mpeg";
}

function consumeVoiceAllowance(key: string): boolean {
  const limit = env.VOICE_TRANSCRIBE_HOURLY_LIMIT;
  if (!Number.isFinite(limit) || limit <= 0) return false;
  const now = Date.now();
  const current = voiceRateWindows.get(key);
  if (!current || now - current.startedAt >= 60 * 60 * 1000) {
    voiceRateWindows.set(key, { startedAt: now, count: 1 });
    if (voiceRateWindows.size > 5_000) {
      for (const [entryKey, value] of voiceRateWindows) {
        if (now - value.startedAt >= 60 * 60 * 1000) voiceRateWindows.delete(entryKey);
      }
    }
    return true;
  }
  if (current.count >= limit) return false;
  current.count += 1;
  return true;
}

function getBailianApiKey(): string | undefined {
  return env.ALIYUN_API_KEY || env.DASHSCOPE_API_KEY;
}

function getBailianBaseUrl(): string | undefined {
  return env.ALIYUN_BASE_URL || env.DASHSCOPE_BASE_URL;
}

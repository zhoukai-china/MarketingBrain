import { createHash, randomUUID } from "node:crypto";

export type MediaProviderStage = "visual" | "asr";
export type MediaProviderTerminalStatus =
  | "succeeded"
  | "failed"
  | "timed_out"
  | "cancelled";
export type MediaProviderBillingStarted = "confirmed" | "not_started" | "unknown";

export interface MediaProviderObservation {
  stage: MediaProviderStage;
  provider: "aliyun-bailian";
  model: string;
  region: string;
  endpointHost: string;
  inputMediaType: string;
  terminalStatus: MediaProviderTerminalStatus;
  terminalCode: string;
  requestFingerprint: string;
  requestFingerprintSource: "provider" | "local";
  httpStatus?: number;
  providerCode?: string;
  finishReason?: string;
  elapsedMs: number;
  timeoutMs: number;
  billingStarted: MediaProviderBillingStarted;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    audioSeconds?: number;
  };
}

export interface ObservedChatCompletion {
  content: string;
  observation: MediaProviderObservation;
}

export class MediaProviderCallError extends Error {
  constructor(public readonly observation: MediaProviderObservation) {
    super(`media_provider_${observation.stage}_${observation.terminalCode}`);
    this.name = "MediaProviderCallError";
  }
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export async function callObservedMediaChat(params: {
  stage: MediaProviderStage;
  model: string;
  baseUrl: string;
  apiKey: string;
  inputMediaType: string;
  body: Record<string, unknown>;
  timeoutMs: number;
  signal?: AbortSignal;
  fetchImpl?: FetchLike;
}): Promise<ObservedChatCompletion> {
  const startedAt = Date.now();
  const localRequestId = randomUUID();
  const endpoint = buildChatCompletionsUrl(params.baseUrl);
  const endpointUrl = new URL(endpoint);
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error("media_provider_timeout"));
  }, params.timeoutMs);
  const onAbort = () => controller.abort(params.signal?.reason ?? new Error("media_provider_cancelled"));
  params.signal?.addEventListener("abort", onAbort, { once: true });

  const baseObservation = (): Omit<MediaProviderObservation, "terminalStatus" | "terminalCode" | "billingStarted"> => ({
    stage: params.stage,
    provider: "aliyun-bailian",
    model: params.model,
    region: inferAliyunRegion(endpointUrl.hostname),
    endpointHost: endpointUrl.hostname,
    inputMediaType: params.inputMediaType,
    requestFingerprint: fingerprintProviderRequest(localRequestId),
    requestFingerprintSource: "local",
    elapsedMs: Math.max(0, Date.now() - startedAt),
    timeoutMs: params.timeoutMs
  });

  try {
    if (params.signal?.aborted) {
      throw new MediaProviderCallError({
        ...baseObservation(),
        terminalStatus: "cancelled",
        terminalCode: "cancelled_before_request",
        billingStarted: "not_started"
      });
    }
    const response = await (params.fetchImpl ?? fetch)(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${params.apiKey}`,
        "X-Request-Id": localRequestId
      },
      body: JSON.stringify(params.body),
      signal: controller.signal
    });
    const bodyText = await response.text();
    const payload = parseJsonObject(bodyText);
    const providerRequestId = readProviderRequestId(response, payload);
    const providerCode = readProviderCode(payload);
    const common = {
      ...baseObservation(),
      httpStatus: response.status,
      requestFingerprint: fingerprintProviderRequest(providerRequestId ?? localRequestId),
      requestFingerprintSource: providerRequestId ? "provider" as const : "local" as const,
      providerCode
    };

    if (!response.ok) {
      throw new MediaProviderCallError({
        ...common,
        terminalStatus: "failed",
        terminalCode: providerCode ?? `http_${response.status}`,
        billingStarted: "unknown"
      });
    }

    const choice = Array.isArray(payload?.choices) ? payload.choices[0] : undefined;
    const content = readMessageContent(choice);
    const finishReason = safeToken(choice?.finish_reason);
    const usage = readSafeUsage(payload?.usage);
    if (!content) {
      throw new MediaProviderCallError({
        ...common,
        finishReason,
        usage,
        terminalStatus: "failed",
        terminalCode: finishReason === "length" ? "output_truncated" : "invalid_response",
        billingStarted: usageHasChargeEvidence(usage) ? "confirmed" : "unknown"
      });
    }
    return {
      content,
      observation: {
        ...common,
        finishReason,
        usage,
        terminalStatus: "succeeded",
        terminalCode: finishReason ?? "completed",
        billingStarted: usageHasChargeEvidence(usage) ? "confirmed" : "unknown"
      }
    };
  } catch (error) {
    if (error instanceof MediaProviderCallError) throw error;
    const externallyCancelled = Boolean(params.signal?.aborted) && !timedOut;
    throw new MediaProviderCallError({
      ...baseObservation(),
      terminalStatus: timedOut ? "timed_out" : externallyCancelled ? "cancelled" : "failed",
      terminalCode: timedOut ? "provider_timeout" : externallyCancelled ? "client_cancelled" : "network_error",
      billingStarted: timedOut ? "unknown" : externallyCancelled ? "unknown" : "unknown"
    });
  } finally {
    clearTimeout(timeout);
    params.signal?.removeEventListener("abort", onAbort);
  }
}

export function getMediaProviderObservation(error: unknown, fallback: Omit<MediaProviderObservation, "terminalStatus" | "terminalCode" | "billingStarted" | "elapsedMs" | "requestFingerprint" | "requestFingerprintSource"> & { timeoutMs: number }): MediaProviderObservation {
  if (error instanceof MediaProviderCallError) return error.observation;
  return {
    ...fallback,
    terminalStatus: "failed",
    terminalCode: "local_processing_failed",
    requestFingerprint: fingerprintProviderRequest(randomUUID()),
    requestFingerprintSource: "local",
    elapsedMs: 0,
    billingStarted: "not_started"
  };
}

export function summarizeMediaAnalysis(params: {
  visualRequested: boolean;
  asrRequested: boolean;
  visualContent?: string;
  transcript?: string;
  observations: MediaProviderObservation[];
}): { status: "complete" | "partial" | "failed" | "timed_out" | "cancelled" | "not_requested"; usable: boolean; failedStages: MediaProviderStage[] } {
  const requested = [params.visualRequested ? "visual" : undefined, params.asrRequested ? "asr" : undefined].filter(Boolean) as MediaProviderStage[];
  if (requested.length === 0) return { status: "not_requested", usable: false, failedStages: [] };
  const successStages = new Set<MediaProviderStage>();
  if (params.visualContent?.trim()) successStages.add("visual");
  if (params.transcript?.trim()) successStages.add("asr");
  const failedStages = requested.filter((stage) => !successStages.has(stage));
  if (failedStages.length === 0) return { status: "complete", usable: true, failedStages };
  if (successStages.size > 0) return { status: "partial", usable: true, failedStages };
  const requestedObservations = params.observations.filter((item) => requested.includes(item.stage));
  if (requestedObservations.some((item) => item.terminalStatus === "timed_out")) return { status: "timed_out", usable: false, failedStages };
  if (requestedObservations.some((item) => item.terminalStatus === "cancelled")) return { status: "cancelled", usable: false, failedStages };
  return { status: "failed", usable: false, failedStages };
}

export function fingerprintProviderRequest(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export function inferAliyunRegion(hostname: string): string {
  const normalized = hostname.toLowerCase();
  if (normalized.includes("ap-southeast-1")) return "ap-southeast-1";
  if (normalized.includes("cn-beijing")) return "cn-beijing";
  if (normalized === "dashscope.aliyuncs.com") return "cn-beijing-legacy";
  if (normalized === "dashscope-intl.aliyuncs.com") return "international-legacy";
  return "unknown";
}

function buildChatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/$/, "");
  return trimmed.endsWith("/chat/completions") ? trimmed : `${trimmed}/chat/completions`;
}

function parseJsonObject(value: string): Record<string, any> | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, any> : undefined;
  } catch {
    return undefined;
  }
}

function readProviderRequestId(response: Response, payload: Record<string, any> | undefined): string | undefined {
  const candidate = response.headers.get("x-request-id")
    ?? response.headers.get("request-id")
    ?? payload?.request_id
    ?? payload?.requestId
    ?? payload?.id;
  return typeof candidate === "string" && candidate.trim() ? candidate.trim().slice(0, 300) : undefined;
}

function readProviderCode(payload: Record<string, any> | undefined): string | undefined {
  return safeToken(payload?.code ?? payload?.error?.code ?? payload?.output?.code);
}

function readMessageContent(choice: any): string {
  const content = choice?.message?.content;
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content.map((item) => typeof item === "string" ? item : typeof item?.text === "string" ? item.text : "").filter(Boolean).join("\n").trim();
}

function safeToken(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 80);
  return normalized || undefined;
}

function readSafeUsage(value: any): MediaProviderObservation["usage"] | undefined {
  if (!value || typeof value !== "object") return undefined;
  const usage = {
    promptTokens: safeNumber(value.prompt_tokens),
    completionTokens: safeNumber(value.completion_tokens),
    totalTokens: safeNumber(value.total_tokens),
    audioSeconds: safeNumber(value.seconds)
  };
  return Object.values(usage).some((item) => item !== undefined) ? usage : undefined;
}

function safeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function usageHasChargeEvidence(usage: MediaProviderObservation["usage"] | undefined): boolean {
  return Boolean(usage && ((usage.totalTokens ?? 0) > 0 || (usage.audioSeconds ?? 0) > 0));
}

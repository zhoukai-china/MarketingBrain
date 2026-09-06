import { env, domesticNetworkOnly, domesticOutboundAllowlist } from "../config/env.js";
import { assertOutboundUrlAllowed } from "./outbound-policy.js";

export type LanqiMediaKind = "image" | "text_to_video" | "image_to_video";
export type LanqiResolution = "720P" | "1080P";
export type LanqiRatio = "1:1" | "3:4" | "16:9" | "9:16";
export interface LanqiMediaRequest {
  kind: LanqiMediaKind;
  prompt: string;
  negativePrompt?: string;
  previewId?: string;
  promptVersion?: string;
  requestKey?: string;
  resolution?: LanqiResolution;
  ratio?: LanqiRatio;
  durationSeconds?: 5 | 10;
  imageUrl?: string;
  watermark?: boolean;
}

const mediaEndpoint = "https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis";
const imageEndpoint = "https://dashscope.aliyuncs.com/api/v1/services/aigc/image-generation/generation";

export type LanqiMediaExecutionReadiness = {
  mode: "disabled" | "mock" | "real";
  canConfirm: boolean;
  billable: boolean;
  blockedReason?: string;
  storage: "disabled" | "local";
};

function modelFor(input: Pick<LanqiMediaRequest, "kind">): string | undefined {
  if (input.kind === "image") return env.LANQI_MEDIA_IMAGE_MODEL;
  return input.kind === "text_to_video" ? env.LANQI_MEDIA_TEXT_TO_VIDEO_MODEL : env.LANQI_MEDIA_IMAGE_TO_VIDEO_MODEL;
}

export function quoteLanqiMedia(input: LanqiMediaRequest): { creditCost: number; customerPriceYuan: number; provider: "aliyun_bailian"; model: string } {
  if (input.kind === "image") return price(env.LANQI_MEDIA_IMAGE_CREDITS, modelFor(input) ?? "未配置");
  const seconds = input.durationSeconds ?? 5;
  const credits = input.resolution === "1080P"
    ? (seconds === 10 ? env.LANQI_MEDIA_1080P_10S_CREDITS : env.LANQI_MEDIA_1080P_5S_CREDITS)
    : (seconds === 10 ? env.LANQI_MEDIA_720P_10S_CREDITS : env.LANQI_MEDIA_720P_5S_CREDITS);
  return price(credits, modelFor(input) ?? "未配置");
}

function price(creditCost: number, model: string) {
  return { creditCost, customerPriceYuan: creditCost / 100, provider: "aliyun_bailian" as const, model };
}

export function validateLanqiMediaRequest(input: LanqiMediaRequest): string | undefined {
  if (!input.prompt.trim() || input.prompt.length > 5000) return "提示词不能为空且不得超过 5000 字符";
  if (input.kind === "image") return input.promptVersion?.trim() ? undefined : "图片任务缺少专业提示词版本，请重新生成提示词预览";
  if (!input.resolution || !input.ratio || !input.durationSeconds) return "视频需要选择分辨率、横竖屏和时长";
  if (!(["16:9", "9:16"] as LanqiRatio[]).includes(input.ratio)) return "视频仅支持 16:9 横屏或 9:16 竖屏";
  if (input.kind === "image_to_video" && !input.imageUrl) return "图生视频需要提供本店自有或已获授权的图片链接";
  if (input.imageUrl && !/^https:\/\//.test(input.imageUrl)) return "图片素材必须为 HTTPS 链接";
  return undefined;
}

export function getLanqiMediaProviderIssue(input: Pick<LanqiMediaRequest, "kind">): string | undefined {
  if (!(env.ALIYUN_API_KEY || env.DASHSCOPE_API_KEY)) return "未配置阿里云百炼 API 密钥";
  if (!modelFor(input)) return "未配置当前媒体类型已开通的百炼模型";
  return undefined;
}

export function getLanqiMediaExecutionReadiness(input: Pick<LanqiMediaRequest, "kind">): LanqiMediaExecutionReadiness {
  const mode = env.LANQI_MEDIA_EXECUTION_MODE;
  const storage = env.LANQI_MEDIA_ASSET_STORAGE;
  if (mode === "disabled") {
    return { mode, storage, canConfirm: false, billable: false, blockedReason: "真实图片生成尚未获得本轮预算放行；当前只可查看费用预览。" };
  }
  if (mode === "mock") {
    if (env.NODE_ENV === "production") return { mode, storage, canConfirm: false, billable: false, blockedReason: "生产环境禁止使用模拟生成模式。" };
    return { mode, storage, canConfirm: true, billable: false };
  }
  if (env.LANQI_MEDIA_REAL_EXECUTION_APPROVED !== "true") {
    return { mode, storage, canConfirm: false, billable: false, blockedReason: "真实图片生成预算尚未确认。" };
  }
  if (storage !== "local") {
    return { mode, storage, canConfirm: false, billable: false, blockedReason: "租户图片持久存储尚未就绪，不能创建付费任务。" };
  }
  const providerIssue = getLanqiMediaProviderIssue(input);
  if (providerIssue) return { mode, storage, canConfirm: false, billable: false, blockedReason: "图片模型能力尚未就绪。" };
  return { mode, storage, canConfirm: true, billable: true };
}

export function isLanqiMediaConfigured(input: Pick<LanqiMediaRequest, "kind">): boolean {
  return !getLanqiMediaProviderIssue(input);
}

export function buildLanqiMediaProviderRequest(input: LanqiMediaRequest): Record<string, unknown> {
  const providerPrompt = input.negativePrompt?.trim()
    ? `${input.prompt.trim()}\n\n必须避免：${input.negativePrompt.trim()}`
    : input.prompt.trim();
  return input.kind === "image"
    ? {
        model: modelFor(input),
        input: { messages: [{ role: "user", content: [{ text: providerPrompt }] }] },
        parameters: { watermark: input.watermark ?? true, n: 1, size: imageSizeForRatio(input.ratio) },
      }
    : {
        model: modelFor(input),
        input: input.kind === "image_to_video" ? { prompt: input.prompt, media: [{ type: "image", url: input.imageUrl }] } : { prompt: input.prompt },
        parameters: { resolution: input.resolution, ratio: input.ratio, duration: input.durationSeconds, watermark: true },
      };
}

export async function cancelLanqiMediaTask(providerTaskId: string): Promise<void> {
  const apiKey = env.ALIYUN_API_KEY || env.DASHSCOPE_API_KEY;
  if (!apiKey) throw new Error("provider_not_configured");
  const endpoint = `https://dashscope.aliyuncs.com/api/v1/tasks/${encodeURIComponent(providerTaskId)}/cancel`;
  assertOutboundUrlAllowed("Aliyun media task cancel", endpoint, { domesticNetworkOnly, allowedHosts: domesticOutboundAllowlist });
  const response = await fetch(endpoint, { method: "POST", headers: { Authorization: `Bearer ${apiKey}` } });
  const result = await response.json().catch(() => ({})) as Record<string, any>;
  if (!response.ok) throw new Error(typeof result.message === "string" ? result.message.slice(0, 300) : `provider_http_${response.status}`);
}

export async function submitLanqiMedia(input: LanqiMediaRequest, requestKey: string): Promise<string> {
  const apiKey = env.ALIYUN_API_KEY || env.DASHSCOPE_API_KEY;
  const providerIssue = getLanqiMediaProviderIssue(input);
  if (providerIssue || !apiKey) throw new Error(providerIssue ?? "provider_not_configured");
  const endpoint = input.kind === "image" ? imageEndpoint : mediaEndpoint;
  assertOutboundUrlAllowed("Aliyun media generation", endpoint, { domesticNetworkOnly, allowedHosts: domesticOutboundAllowlist });
  const body = buildLanqiMediaProviderRequest(input);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "X-DashScope-Async": "enable", "X-Request-Id": requestKey },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({})) as Record<string, any>;
  const taskId = result.output?.task_id ?? result.output?.taskId ?? result.task_id ?? result.taskId;
  if (!response.ok || !taskId) throw new Error(typeof result.message === "string" ? result.message.slice(0, 300) : `provider_http_${response.status}`);
  return taskId;
}

export async function getLanqiMediaTask(providerTaskId: string): Promise<{ status: string; outputUrl?: string; errorMessage?: string }> {
  const apiKey = env.ALIYUN_API_KEY || env.DASHSCOPE_API_KEY;
  if (!apiKey) throw new Error("provider_not_configured");
  const endpoint = `https://dashscope.aliyuncs.com/api/v1/tasks/${encodeURIComponent(providerTaskId)}`;
  assertOutboundUrlAllowed("Aliyun media task query", endpoint, { domesticNetworkOnly, allowedHosts: domesticOutboundAllowlist });
  const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${apiKey}`, "X-DashScope-Async": "enable" } });
  const result = await response.json().catch(() => ({})) as Record<string, any>;
  if (!response.ok) throw new Error(typeof result.message === "string" ? result.message.slice(0, 300) : `provider_http_${response.status}`);
  return parseLanqiMediaTask(result);
}

export function parseLanqiMediaTask(result: Record<string, any>): { status: string; outputUrl?: string; errorMessage?: string } {
  const output = result.output ?? {};
  const firstChoiceContent = Array.isArray(output.choices)
    ? output.choices[0]?.message?.content
    : undefined;
  const choiceContentItems = Array.isArray(firstChoiceContent)
    ? firstChoiceContent
    : firstChoiceContent && typeof firstChoiceContent === "object"
      ? [firstChoiceContent]
      : [];
  const imageUrl = choiceContentItems.find(
    (item: unknown): item is { type?: string; image?: unknown } => Boolean(item && typeof item === "object")
  )?.image;
  const outputUrl = output.video_url ?? output.videoUrl ?? output.results?.[0]?.url ?? output.result_url ?? imageUrl;
  return { status: String(output.task_status ?? output.taskStatus ?? result.status ?? "processing"), outputUrl: typeof outputUrl === "string" ? outputUrl : undefined, errorMessage: typeof result.message === "string" ? result.message.slice(0, 500) : undefined };
}

function imageSizeForRatio(ratio?: LanqiRatio): string {
  if (ratio === "3:4") return "768*1024";
  if (ratio === "9:16") return "768*1365";
  if (ratio === "16:9") return "1365*768";
  return "1024*1024";
}

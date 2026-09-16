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
  durationSeconds?: number;
  imageUrl?: string;
  watermark?: boolean;
}

/** wan2.6-i2v-flash / wan2.5 系列：成片时长按整数秒下发，官方区间 [2,15]。 */
export const LANQI_VIDEO_MIN_SECONDS = 2;
export const LANQI_VIDEO_MAX_SECONDS = 15;

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

/**
 * 报价只看**积分**。
 *
 * 用户 2026-09-16 口径：「不显示人民币消耗」，且「兰琪的积分计费逻辑和思潼 AI 保持一致」——
 * 所以这里**不再产出任何折合人民币字段**：此前那个 `customerPriceYuan = creditCost / 100`
 * 是旧价（图片 100 积分/张）时代的产物，图片改 20 积分/张后就错了 5 倍
 * （20 积分应 = ¥1，它却给 ¥0.2），属于「埋在接口里的错账口径」。
 * 现在对外只回积分；确需人民币折算时，唯一出处是 `@baolu/shared` 的
 * `CREDIT_PRICING` / `creditsToYuan()`，不要在业务里再写第二个汇率。
 */
export function quoteLanqiMedia(input: LanqiMediaRequest): { creditCost: number; provider: "aliyun_bailian"; model: string } {
  if (input.kind === "image") return price(env.LANQI_MEDIA_IMAGE_CREDITS, modelFor(input) ?? "未配置");
  const seconds = input.durationSeconds ?? 5;
  // 图生视频（文案转片）按**成本 ×2** 的按秒口径计价（用户 2026-09-15）：
  // 成本 ¥0.30/秒 × 2 = 12 积分/秒（= ¥0.60/秒），每镜 3 秒 = 36 积分。此前 30 积分/秒 = 成本 ×5。
  if (input.kind === "image_to_video") return price(Math.max(1, Math.round(seconds * env.LANQI_MEDIA_VIDEO_CREDITS_PER_SECOND)), modelFor(input) ?? "未配置");
  /**
   * 文生视频（用户 2026-09-16「选 A：用百炼现成的 t2v」）——与图生视频**同一口径**：
   * 按秒 ×2 成本（默认 12 积分/秒），不再用旧的 720P/1080P 固定包价（990/1690/1490/2690）。
   *
   * 成本常量沿用同门实测值 ¥0.30/秒；等百炼侧首张真实账单回来只改
   * `LANQI_MEDIA_VIDEO_CREDITS_PER_SECOND`（积分/秒）这一个数即可——它已经是「成本×2」的结果，
   * 不是又一次加价。分辨率差价（若 1080P 更贵）另开一个常量，不猜。
   */
  return price(Math.max(1, Math.round(seconds * env.LANQI_MEDIA_VIDEO_CREDITS_PER_SECOND)), modelFor(input) ?? "未配置");
}

function price(creditCost: number, model: string) {
  return { creditCost, provider: "aliyun_bailian" as const, model };
}

export function validateLanqiMediaRequest(input: LanqiMediaRequest): string | undefined {
  if (!input.prompt.trim() || input.prompt.length > 5000) return "提示词不能为空且不得超过 5000 字符";
  if (input.kind === "image") return input.promptVersion?.trim() ? undefined : "图片任务缺少专业提示词版本，请重新生成提示词预览";
  if (!input.resolution || !input.durationSeconds) return "视频需要选择分辨率和时长";
  // 图生视频的画面比例由首帧图片决定，不再单独下发横竖屏。
  if (input.kind === "text_to_video" && !input.ratio) return "文生视频需要选择横竖屏";
  if (input.ratio && !(["16:9", "9:16"] as LanqiRatio[]).includes(input.ratio)) return "视频仅支持 16:9 横屏或 9:16 竖屏";
  if (!Number.isInteger(input.durationSeconds) || input.durationSeconds < LANQI_VIDEO_MIN_SECONDS || input.durationSeconds > LANQI_VIDEO_MAX_SECONDS) {
    return `视频时长必须为 ${LANQI_VIDEO_MIN_SECONDS}–${LANQI_VIDEO_MAX_SECONDS} 秒的整数`;
  }
  if (input.kind === "image_to_video" && !input.imageUrl) return "图生视频需要提供本店自有或已获授权的图片链接";
  if (input.imageUrl && !/^https:\/\//.test(input.imageUrl)) return "图片素材必须为 HTTPS 链接";
  return undefined;
}

/** 幂等比较所需的持久化字段子集（不依赖 Prisma 类型，便于离线回归）。 */
export interface LanqiMediaJobIdentity {
  kind: string;
  prompt: string;
  negativePrompt?: string | null;
  ratio?: string | null;
  previewId?: string | null;
  promptVersion?: string | null;
  durationSeconds?: number | null;
  parameters?: unknown;
}

/**
 * 幂等比较。图生视频必须比「稳定指纹」（暂存 ID，或外部直传时的原始 URL），
 * 绝不能比签名外链本身 —— 签名里的 e= 每次请求都会变，比整条 URL 会把同一张图的
 * 重试误判成新请求，从而重复扣费、重复出片。
 */
export function isSameLanqiMediaRequest(job: LanqiMediaJobIdentity, input: LanqiMediaRequest, firstFrameFingerprint?: string): boolean {
  const storedFrameId = (job.parameters as { firstFrameId?: string } | null | undefined)?.firstFrameId;
  const base =
    job.kind === input.kind &&
    job.prompt === input.prompt &&
    (job.negativePrompt ?? undefined) === input.negativePrompt &&
    (job.ratio ?? undefined) === input.ratio;
  if (!base) return false;
  if (input.kind === "image_to_video") {
    return (job.durationSeconds ?? undefined) === input.durationSeconds && (storedFrameId ?? undefined) === firstFrameFingerprint;
  }
  return (job.previewId ?? undefined) === input.previewId && (job.promptVersion ?? undefined) === input.promptVersion;
}

export function getLanqiMediaProviderIssue(input: Pick<LanqiMediaRequest, "kind">): string | undefined {
  if (!(env.ALIYUN_API_KEY || env.DASHSCOPE_API_KEY)) return "未配置阿里云百炼 API 密钥";
  if (!modelFor(input)) return "未配置当前媒体类型已开通的百炼模型";
  return undefined;
}

export function getLanqiMediaExecutionReadiness(input: Pick<LanqiMediaRequest, "kind">): LanqiMediaExecutionReadiness {
  const mode = env.LANQI_MEDIA_EXECUTION_MODE;
  const storage = env.LANQI_MEDIA_ASSET_STORAGE;
  const subject = input.kind === "image" ? "图片" : "视频";
  if (mode === "disabled") {
    return { mode, storage, canConfirm: false, billable: false, blockedReason: `真实${subject}生成尚未获得本轮预算放行；当前只可查看费用预览。` };
  }
  if (mode === "mock") {
    if (env.NODE_ENV === "production") return { mode, storage, canConfirm: false, billable: false, blockedReason: "生产环境禁止使用模拟生成模式。" };
    return { mode, storage, canConfirm: true, billable: false };
  }
  if (env.LANQI_MEDIA_REAL_EXECUTION_APPROVED !== "true") {
    return { mode, storage, canConfirm: false, billable: false, blockedReason: `真实${subject}生成预算尚未确认。` };
  }
  // 图片与视频分开放行：本轮只批了「文案转片」图生视频，付费生图仍按未放行处理。
  if (input.kind === "image" && env.LANQI_MEDIA_IMAGE_REAL_EXECUTION_APPROVED !== "true") {
    return { mode, storage, canConfirm: false, billable: false, blockedReason: `真实${subject}生成尚未获得本轮预算放行；当前只可查看费用预览。` };
  }
  if (storage !== "local") {
    return { mode, storage, canConfirm: false, billable: false, blockedReason: `租户${subject}持久存储尚未就绪，不能创建付费任务。` };
  }
  const providerIssue = getLanqiMediaProviderIssue(input);
  if (providerIssue) return { mode, storage, canConfirm: false, billable: false, blockedReason: `${subject}模型能力尚未就绪。` };
  return { mode, storage, canConfirm: true, billable: true };
}

export function isLanqiMediaConfigured(input: Pick<LanqiMediaRequest, "kind">): boolean {
  return !getLanqiMediaProviderIssue(input);
}

export function buildLanqiMediaProviderRequest(input: LanqiMediaRequest): Record<string, unknown> {
  const providerPrompt = input.negativePrompt?.trim()
    ? `${input.prompt.trim()}\n\n必须避免：${input.negativePrompt.trim()}`
    : input.prompt.trim();
  if (input.kind === "image") {
    return {
      model: modelFor(input),
      input: { messages: [{ role: "user", content: [{ text: providerPrompt }] }] },
      parameters: { watermark: input.watermark ?? true, n: 1, size: imageSizeForRatio(input.ratio) },
    };
  }
  if (input.kind === "image_to_video") {
    // 百炼图生视频（wan2.6-i2v-flash）契约：input.img_url 为必填首帧图，prompt 为运镜/画面描述；
    // 无声成片必须显式 audio:false（并且不下发 audio_url）；画面比例由首帧图决定，不下发 ratio。
    return {
      model: modelFor(input),
      input: { prompt: providerPrompt, img_url: input.imageUrl },
      parameters: {
        resolution: input.resolution,
        duration: input.durationSeconds,
        audio: false,
        prompt_extend: false,
        watermark: input.watermark ?? true,
      },
    };
  }
  return {
    model: modelFor(input),
    input: { prompt: providerPrompt },
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

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
  /** 已生成的 AI 单镜首帧（方案④）：出片时用它当图生视频的 img_url。 */
  frameId?: string;
  /** 生图参考图（HTTPS 公网可抓取）：用于人物/场景一致性，最多 9 张。 */
  referenceImages?: string[];
  watermark?: boolean;
  /** 台词配音（2026-10-05）：voice/dialogueText 由路由层合成语音后填 audioUrl，模型据此对口型。 */
  voice?: string;
  dialogueText?: string;
  audioUrl?: string;
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
 * 报价只看**算力**。
 *
 * 用户 2026-09-16 口径：「不显示人民币消耗」，且「兰琪的算力计费逻辑和思潼 AI 保持一致」——
 * 所以这里**不再产出任何折合人民币字段**：此前那个 `customerPriceYuan = creditCost / 100`
 * 是旧价（图片 100 算力/张）时代的产物，图片改 20 算力/张后就错了 5 倍
 * （20 算力应 = ¥1，它却给 ¥0.2），属于「埋在接口里的错账口径」。
 * 现在对外只回算力；确需人民币折算时，唯一出处是 `@baolu/shared` 的
 * `CREDIT_PRICING` / `creditsToYuan()`，不要在业务里再写第二个汇率。
 */
export function quoteLanqiMedia(input: LanqiMediaRequest): { creditCost: number; provider: "aliyun_bailian"; model: string } {
  if (input.kind === "image") return price(env.LANQI_MEDIA_IMAGE_CREDITS, modelFor(input) ?? "未配置");
  const seconds = input.durationSeconds ?? 5;
  // 图生视频（文案转片）按**成本 ×2** 的按秒口径计价（用户 2026-09-15）：
  // 成本 ¥0.30/秒 × 2 = 12 算力/秒（= ¥0.60/秒），每镜 3 秒 = 36 算力。此前 30 算力/秒 = 成本 ×5。
  if (input.kind === "image_to_video") return price(Math.max(1, Math.round(seconds * env.LANQI_MEDIA_VIDEO_CREDITS_PER_SECOND)), modelFor(input) ?? "未配置");
  /**
   * 文生视频（用户 2026-09-16「选 A：用百炼现成的 t2v」）——与图生视频**同一口径**：
   * 按秒 ×2 成本（默认 12 算力/秒），不再用旧的 720P/1080P 固定包价（990/1690/1490/2690）。
   *
   * 成本常量沿用同门实测值 ¥0.30/秒；等百炼侧首张真实账单回来只改
   * `LANQI_MEDIA_VIDEO_CREDITS_PER_SECOND`（算力/秒）这一个数即可——它已经是「成本×2」的结果，
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
  // mock 模式放宽本地 HTTP（2026-10-04）：首帧图走本地签名 URL，mock 不会把 URL 交给外部模型；
  // real 模式仍强制 HTTPS（阿里云真实拉取素材）。
  if (input.imageUrl && env.LANQI_MEDIA_EXECUTION_MODE !== "mock" && !/^https:\/\//.test(input.imageUrl)) return "图片素材必须为 HTTPS 链接";
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
  // 生图可单独指定模式（2026-10-05 用户口径：生图接真实看效果，视频继续 mock）：
  // LANQI_MEDIA_IMAGE_EXECUTION_MODE=real|mock 显式指定时，生图不再跟随总开关。
  const imageOverride = env.LANQI_MEDIA_IMAGE_EXECUTION_MODE;
  const global = env.LANQI_MEDIA_EXECUTION_MODE;
  const mode = input.kind === "image" && imageOverride === "real" ? "real" : input.kind === "image" && imageOverride === "mock" ? "mock" : global;
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
    // 参考图（2026-10-05）：wan2.7-image 支持多图参考 / 角色一致性——把人物正面照与场景照作为参考图下发，
    // 提示词只描述"这一镜的机位、景别、动作"，人还是同一个人、景还是那个景，但每镜起幅不同。
    // 契约见阿里云 wan2.7-image 文档：content 数组可含多个 {"image": url}，最后一个为 {"text": prompt}。
    const refs = (input.referenceImages ?? []).filter((url) => /^https:\/\//.test(url)).slice(0, 9);
    return {
      model: modelFor(input),
      input: { messages: [{ role: "user", content: [...refs.map((image) => ({ image })), { text: providerPrompt }] }] },
      parameters: { watermark: input.watermark ?? false, n: 1, size: imageSizeForRatio(input.ratio) },
    };
  }
  if (input.kind === "image_to_video") {
    // wan2.7：media 数组（first_frame + driving_audio）——driving_audio 是官方对口型通道，
    // 传了台词音频人物就会开口说台词；不传则模型自动配音。wan2.6 及以下仍走 img_url / audio_url 旧契约。
    const model = modelFor(input)!;
    if (model.startsWith("wan2.7")) {
      const media: Array<{ type: string; url: string }> = [{ type: "first_frame", url: input.imageUrl! }];
      if (input.audioUrl) media.push({ type: "driving_audio", url: input.audioUrl });
      return {
        model,
        input: { prompt: providerPrompt, media },
        parameters: {
          resolution: input.resolution,
          duration: input.durationSeconds,
          prompt_extend: false,
          watermark: input.watermark ?? false,
        },
      };
    }
    // wan2.6 及以下旧契约：img_url 首帧；audio 不下发（默认自动配音），audio_url 为参考音频。
    return {
      model,
      input: { prompt: providerPrompt, img_url: input.imageUrl, ...(input.audioUrl ? { audio_url: input.audioUrl } : {}) },
      parameters: {
        resolution: input.resolution,
        duration: input.durationSeconds,
        prompt_extend: false,
        watermark: input.watermark ?? false,
      },
    };
  }
  return {
    model: modelFor(input),
    input: { prompt: providerPrompt },
    parameters: { resolution: input.resolution, ratio: input.ratio, duration: input.durationSeconds, watermark: false },
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

/** 从百炼生图响应里取图片地址（同步返回 / 异步任务结果两种结构都认）。 */
function pickImageUrl(result: Record<string, any>): string | undefined {
  const direct: unknown[] = [
    ...(result.output?.choices ?? []).flatMap((c: any) => c?.message?.content ?? []),
    ...(result.output?.results ?? []),
    ...(result.choices ?? []).flatMap((c: any) => c?.message?.content ?? []),
  ];
  for (const item of direct) {
    const url = (item as { image?: string; url?: string })?.image ?? (item as { url?: string })?.url;
    if (typeof url === "string" && /^https:\/\//.test(url)) return url;
  }
  return undefined;
}

/**
 * 单镜首帧生图（2026-10-05 方案④）：按"本镜提示词 + 人物/场景参考图"画出这一镜的起幅。
 * 与视频任务同一套出站校验与凭据；生图是 HTTP 同步为主，但兼容异步任务返回。
 */
export async function generateLanqiShotFrameImage(params: {
  input: LanqiMediaRequest;
  requestKey: string;
  attempts?: number;
  intervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<string> {
  if (params.input.kind !== "image") throw new Error("shot_frame_kind_invalid");
  const apiKey = env.ALIYUN_API_KEY || env.DASHSCOPE_API_KEY;
  const providerIssue = getLanqiMediaProviderIssue(params.input);
  if (providerIssue || !apiKey) throw new Error(providerIssue ?? "provider_not_configured");
  assertOutboundUrlAllowed("Aliyun image generation", imageEndpoint, { domesticNetworkOnly, allowedHosts: domesticOutboundAllowlist });
  const body = buildLanqiMediaProviderRequest(params.input);
  // 百炼生图接口强制异步：不带 X-DashScope-Async 会返回 "does not support synchronous calls"。
  const response = await fetch(imageEndpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-DashScope-Async": "enable",
      "X-Request-Id": params.requestKey
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  const result = await response.json().catch(() => ({})) as Record<string, any>;
  const sync = pickImageUrl(result);
  if (sync) return sync;
  if (!response.ok) throw new Error(typeof result.message === "string" ? result.message.slice(0, 300) : `provider_http_${response.status}`);
  const taskId = result.output?.task_id ?? result.output?.taskId ?? result.task_id ?? result.taskId;
  if (!taskId) throw new Error(typeof result.message === "string" ? result.message.slice(0, 300) : "provider_task_missing");
  const attempts = params.attempts ?? 30, interval = params.intervalMs ?? 2000;
  const wait = params.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let i = 0; i < attempts; i += 1) {
    await wait(interval);
    const task = await getLanqiMediaTask(String(taskId));
    if (task.status === "SUCCEEDED" && task.outputUrl) return task.outputUrl;
    if (task.status === "FAILED" || task.status === "CANCELED" || task.status === "UNKNOWN") throw new Error(task.errorMessage ?? "provider_failed");
  }
  throw new Error("provider_timeout");
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

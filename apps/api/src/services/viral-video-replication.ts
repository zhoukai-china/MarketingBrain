const PUBLIC_VIDEO_PAGE_HOSTS = new Set([
  "douyin.com", "www.douyin.com", "xiaohongshu.com", "www.xiaohongshu.com",
  "weibo.com", "www.weibo.com", "bilibili.com", "www.bilibili.com"
]);

export type ReplicationModel = "aliyun_strict" | "seedance_creative";

export interface ViralReplicationInput {
  referenceVideoUrl?: string;
  portraitImageUrl?: string;
  referenceFileId?: string;
  portraitFileId?: string;
  model: ReplicationModel;
  visualRightsConfirmed: boolean;
  audioRightsConfirmed: boolean;
  performerConsentConfirmed: boolean;
  portraitConsentConfirmed: boolean;
}

export function validateViralReplicationInput(input: ViralReplicationInput): string | undefined {
  if (input.model !== "aliyun_strict" && input.model !== "seedance_creative") return "不支持的生成模型";
  if (input.model === "seedance_creative") return "Seedance 创意复刻尚未开放，不能创建付费任务";
  if (!input.referenceVideoUrl && !input.referenceFileId) return "请上传已授权原视频，或填写可直接读取的视频文件链接";
  if (!input.portraitImageUrl && !input.portraitFileId) return "请上传本人或已授权主角照片，或填写可直接读取的图片链接";
  if (![input.visualRightsConfirmed, input.audioRightsConfirmed, input.performerConsentConfirmed, input.portraitConsentConfirmed].every(Boolean)) {
    return "请确认原视频、原音频、原主角肖像和替换照片均已取得授权";
  }
  for (const url of [input.referenceVideoUrl, input.portraitImageUrl].filter(Boolean) as string[]) {
    const issue = validateDirectAssetUrl(url);
    if (issue) return issue;
  }
  return undefined;
}

export function validateDirectAssetUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return "素材链接必须为 HTTPS 直链";
    if (PUBLIC_VIDEO_PAGE_HOSTS.has(url.hostname.toLowerCase())) return "不支持平台播放页链接；请上传原文件或提供可直接下载的授权文件链接";
    if (!/\.(mp4|mov|m4v|webm|jpg|jpeg|png|webp)(?:$|[?#])/i.test(url.pathname)) return "链接必须直接指向视频或图片文件，不能是网页播放页";
    return undefined;
  } catch {
    return "素材链接格式不正确";
  }
}

export function isAliyunReplicationConfigured(): boolean {
  return Boolean(process.env.ALIYUN_VIDEO_REPLICATION_API_KEY && process.env.ALIYUN_VIDEO_REPLICATION_ENDPOINT);
}

export function buildAliyunReplicationRequest(input: Required<Pick<ViralReplicationInput, "referenceVideoUrl" | "portraitImageUrl">>): Record<string, unknown> {
  return {
    model: process.env.ALIYUN_VIDEO_REPLICATION_MODEL || "wan-animate-mix",
    input: { video_url: input.referenceVideoUrl, person_image_url: input.portraitImageUrl },
    parameters: { preserve_original_audio: true, visible_ai_label: true, output: "mp4" }
  };
}

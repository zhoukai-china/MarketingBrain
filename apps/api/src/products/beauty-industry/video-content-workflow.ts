import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import type { SkillId } from "@baolu/shared";
import { loadSkillPrompt, SKILL_MANIFESTS } from "@baolu/skills";

const execFileAsync = promisify(execFile);

export const BEAUTY_VIDEO_CONTENT_WORKFLOW_VERSION = "video_content_review_workflow_v1" as const;

export const BEAUTY_VIDEO_CONTENT_REVIEW_WORKFLOW = {
  activationStatus: "active_real_media_admitted",
  workflowId: "video-content-review",
  toolName: "beauty.video_content_review",
  scope: "acquisition:video-content-review",
  capabilityId: "shooting_editing",
  primarySkillId: "baolu_content_creator",
  primarySkillVersion: "5.0.0",
  constraintSkills: [
    { skillId: "beauty-industry-content-diff", version: "1.1.0" },
    { skillId: "beauty-industry-compliance", version: "1.0.0" }
  ],
  mediaAcceptance: {
    visual: { provider: "aliyun-bailian", model: "qwen-vl-max", requiredCalls: 1 },
    asr: { provider: "aliyun-bailian", model: "qwen3-asr-flash", requiredCalls: 1 }
  }
} as const;

export const BEAUTY_VIDEO_CONTENT_REVIEW_PENDING_WORKFLOW = BEAUTY_VIDEO_CONTENT_REVIEW_WORKFLOW;

export const BEAUTY_VIDEO_CONTENT_MEDIA_ACCEPTANCE_CONTRACT = {
  version: "video_content_review_media_acceptance_v1",
  visual: { provider: "aliyun-bailian", model: "qwen-vl-max", status: "succeeded", requireExpectedFactsMatch: true },
  asr: { provider: "aliyun-bailian", model: "qwen3-asr-flash", status: "succeeded", requireExpectedTranscriptMatch: true },
  requireBothEvidenceInFormalInput: true,
  templateFallbackAllowed: false,
  retryAllowed: false,
  modelSwitchAllowed: false
} as const;

export interface BeautyVideoContentPreflight {
  requestId: string;
  receiptId: string;
  filename: string;
  mimeType: string;
  byteSize: number;
  durationSeconds: number;
  width?: number;
  height?: number;
  videoCodec?: string;
  audioCodec?: string;
  audioSampleRateHz?: number;
  audioChannels?: number;
  formatName: string;
  providerCalls: 0;
  creditCost: 0;
  retainedMedia: false;
  sourceDeleted: true;
  visualStatus: "not_run_preflight_only";
  asrStatus: "not_run_preflight_only";
  checkedAt: string;
}

export interface BeautyVideoContentWorkflowInput {
  version: typeof BEAUTY_VIDEO_CONTENT_WORKFLOW_VERSION;
  platform: string;
  accountName?: string;
  videoId?: string;
  videoTitle: string;
  originalCaption?: string;
  businessObjective: string;
  targetAudience: string;
  transcript?: string;
  visualEvidence?: string;
  sceneTimeline?: string;
  contentStructure?: string;
  factBoundary?: string;
  mediaPreflight?: BeautyVideoContentPreflight;
}

const preflightSchema = z.object({
  requestId: z.string().trim().min(8).max(200),
  receiptId: z.string().trim().min(16).max(80),
  filename: z.string().trim().min(1).max(240),
  mimeType: z.string().trim().min(1).max(120),
  byteSize: z.number().int().positive(),
  durationSeconds: z.number().positive(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  videoCodec: z.string().trim().min(1).max(80).optional(),
  audioCodec: z.string().trim().min(1).max(80).optional(),
  audioSampleRateHz: z.number().int().positive().optional(),
  audioChannels: z.number().int().positive().optional(),
  formatName: z.string().trim().min(1).max(160),
  providerCalls: z.literal(0),
  creditCost: z.literal(0),
  retainedMedia: z.literal(false),
  sourceDeleted: z.literal(true),
  visualStatus: z.literal("not_run_preflight_only"),
  asrStatus: z.literal("not_run_preflight_only"),
  checkedAt: z.string().datetime()
}).strict();

export const beautyVideoContentWorkflowSchema = z.object({
  version: z.literal(BEAUTY_VIDEO_CONTENT_WORKFLOW_VERSION),
  platform: z.string().trim().min(1).max(100),
  accountName: z.string().trim().max(200).optional(),
  videoId: z.string().trim().max(240).optional(),
  videoTitle: z.string().trim().min(2).max(500),
  originalCaption: z.string().trim().max(4_000).optional(),
  businessObjective: z.string().trim().min(2).max(500),
  targetAudience: z.string().trim().min(2).max(500),
  transcript: z.string().trim().max(20_000).optional(),
  visualEvidence: z.string().trim().max(8_000).optional(),
  sceneTimeline: z.string().trim().max(8_000).optional(),
  contentStructure: z.string().trim().max(2_000).optional(),
  factBoundary: z.string().trim().max(2_000).optional(),
  mediaPreflight: preflightSchema.optional()
}).strict();

export const BEAUTY_VIDEO_CONTENT_WORKFLOW_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    version: { type: "string", const: BEAUTY_VIDEO_CONTENT_WORKFLOW_VERSION },
    platform: { type: "string", minLength: 1, maxLength: 100 },
    accountName: { type: "string", maxLength: 200 },
    videoId: { type: "string", maxLength: 240 },
    videoTitle: { type: "string", minLength: 2, maxLength: 500 },
    originalCaption: { type: "string", maxLength: 4_000 },
    businessObjective: { type: "string", minLength: 2, maxLength: 500 },
    targetAudience: { type: "string", minLength: 2, maxLength: 500 },
    transcript: { type: "string", maxLength: 20_000, description: "用户提供的口播/字幕补充材料；不能替代真实 ASR 验收。" },
    visualEvidence: { type: "string", maxLength: 8_000, description: "用户确认的画面说明；不能冒充 Provider 已读取画面。" },
    sceneTimeline: { type: "string", maxLength: 8_000 },
    contentStructure: { type: "string", maxLength: 2_000 },
    factBoundary: { type: "string", maxLength: 2_000 },
    mediaPreflight: {
      type: "object",
      additionalProperties: false,
      description: "服务端零费用预检回执；正式执行仍必须重新核对真实视觉与 ASR 证据。",
      properties: {
        requestId: { type: "string", minLength: 8, maxLength: 200 },
        receiptId: { type: "string", minLength: 16, maxLength: 80 },
        filename: { type: "string", minLength: 1, maxLength: 240 },
        mimeType: { type: "string", minLength: 1, maxLength: 120 },
        byteSize: { type: "integer", minimum: 1 },
        durationSeconds: { type: "number", exclusiveMinimum: 0 },
        width: { type: "integer", minimum: 1 },
        height: { type: "integer", minimum: 1 },
        videoCodec: { type: "string", minLength: 1, maxLength: 80 },
        audioCodec: { type: "string", minLength: 1, maxLength: 80 },
        audioSampleRateHz: { type: "integer", minimum: 1 },
        audioChannels: { type: "integer", minimum: 1 },
        formatName: { type: "string", minLength: 1, maxLength: 160 },
        providerCalls: { type: "integer", const: 0 },
        creditCost: { type: "integer", const: 0 },
        retainedMedia: { type: "boolean", const: false },
        sourceDeleted: { type: "boolean", const: true },
        visualStatus: { type: "string", const: "not_run_preflight_only" },
        asrStatus: { type: "string", const: "not_run_preflight_only" },
        checkedAt: { type: "string", format: "date-time" }
      },
      required: ["requestId", "receiptId", "filename", "mimeType", "byteSize", "durationSeconds", "formatName", "providerCalls", "creditCost", "retainedMedia", "sourceDeleted", "visualStatus", "asrStatus", "checkedAt"]
    }
  },
  required: ["version", "platform", "videoTitle", "businessObjective", "targetAudience"]
} as const;

export const BEAUTY_VIDEO_CONTENT_REQUIRED_SECTIONS = [
  "视频基本信息",
  "现有版本诊断",
  "一、优化版选题定位",
  "二、优化版口播逐字稿",
  "三、优化版拍摄脚本",
  "四、拍摄注意事项",
  "五、优化版剪辑EDL",
  "六、优化版发布策略",
  "七、投流建议",
  "八、核心改进点"
] as const;

export function readBeautyVideoContentWorkflow(value: unknown): BeautyVideoContentWorkflowInput {
  return beautyVideoContentWorkflowSchema.parse(value);
}

export function buildBeautyVideoContentWorkflowDirective(value: BeautyVideoContentWorkflowInput): string {
  const input = readBeautyVideoContentWorkflow(value);
  const visualEvidence = input.visualEvidence?.trim() || input.sceneTimeline?.trim();
  if (!input.transcript?.trim()) throw new Error("beauty_video_content_transcript_required");
  if (!visualEvidence) throw new Error("beauty_video_content_visual_evidence_required");
  return [
    "【视频内容复盘正式输入｜video_content_review_workflow_v1】",
    `发布平台：${input.platform}`,
    input.accountName ? `账号名称：${input.accountName}` : "账号名称：待补",
    input.videoId ? `平台视频标识：${input.videoId}` : "平台视频标识：待补",
    `视频标题：${input.videoTitle}`,
    input.originalCaption ? `原发布文案：${input.originalCaption}` : "原发布文案：待补",
    `业务目标：${input.businessObjective}`,
    `目标人群：${input.targetAudience}`,
    `真实口播/字幕证据：${input.transcript.trim()}`,
    `真实画面证据：${visualEvidence}`,
    input.sceneTimeline ? `场景时间轴：${input.sceneTimeline}` : "场景时间轴：待补",
    input.contentStructure ? `现有内容结构：${input.contentStructure}` : "现有内容结构：待复盘",
    input.factBoundary ? `事实与合规边界：${input.factBoundary}` : "事实与合规边界：未确认价格、疗效、案例和经营结果均不得补写",
    "只依据以上证据复盘；不得声称读取了未提供的平台后台数据，不得把播放/完播/转化指标报告当作内容复盘。"
  ].join("\n");
}

export function assessBeautyVideoContentReadiness(input: BeautyVideoContentWorkflowInput): {
  preflightReady: boolean;
  executionReady: boolean;
  missing: string[];
} {
  const missing: string[] = [];
  if (!input.mediaPreflight) missing.push("重新上传视频并完成零费用格式与元数据预检");
  if (!input.transcript?.trim()) missing.push("口播/字幕转写：可先粘贴补充，但正式验收仍需真实 ASR");
  if (!input.visualEvidence?.trim() && !input.sceneTimeline?.trim()) missing.push("画面或分镜证据：可先补充说明，但不能冒充视觉 Provider 结果");
  return { preflightReady: Boolean(input.mediaPreflight), executionReady: missing.length === 0, missing };
}

export interface BeautyVideoContentRealMediaAcceptanceInput {
  expectedVisualFacts: string[];
  expectedTranscript: string;
  visual: {
    provider: string;
    model: string;
    status: string;
    observedFacts: string[];
  };
  asr: {
    provider: string;
    model: string;
    status: string;
    transcript: string;
  };
  formalInput: {
    visualEvidence: string;
    transcript: string;
  };
  fallbackUsed: boolean;
}

export function assertBeautyVideoContentRealMediaAcceptance(input: BeautyVideoContentRealMediaAcceptanceInput): {
  visualMatched: true;
  asrMatched: true;
  formalInputMatched: true;
} {
  const contract = BEAUTY_VIDEO_CONTENT_MEDIA_ACCEPTANCE_CONTRACT;
  if (input.fallbackUsed) throw new Error("beauty_video_content_real_media_fallback_forbidden");
  if (input.visual.provider !== contract.visual.provider || input.visual.model !== contract.visual.model || input.visual.status !== contract.visual.status) {
    throw new Error("beauty_video_content_real_visual_receipt_invalid");
  }
  if (input.asr.provider !== contract.asr.provider || input.asr.model !== contract.asr.model || input.asr.status !== contract.asr.status) {
    throw new Error("beauty_video_content_real_asr_receipt_invalid");
  }
  const expectedVisualFacts = input.expectedVisualFacts.map(normalizeAcceptanceEvidence).filter(Boolean);
  if (expectedVisualFacts.length === 0) throw new Error("beauty_video_content_visual_expectation_missing");
  const actualVisual = normalizeAcceptanceEvidence(input.visual.observedFacts.join("；"));
  if (!expectedVisualFacts.every((fact) => actualVisual.includes(fact))) {
    throw new Error("beauty_video_content_real_visual_evidence_mismatch");
  }
  const expectedTranscript = normalizeAcceptanceEvidence(input.expectedTranscript);
  if (!expectedTranscript || normalizeAcceptanceEvidence(input.asr.transcript) !== expectedTranscript) {
    throw new Error("beauty_video_content_real_asr_transcript_mismatch");
  }
  const formalVisual = normalizeAcceptanceEvidence(input.formalInput.visualEvidence);
  const formalTranscript = normalizeAcceptanceEvidence(input.formalInput.transcript);
  if (!expectedVisualFacts.every((fact) => formalVisual.includes(fact)) || formalTranscript !== expectedTranscript) {
    throw new Error("beauty_video_content_real_evidence_not_in_formal_input");
  }
  return { visualMatched: true, asrMatched: true, formalInputMatched: true };
}

function normalizeAcceptanceEvidence(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[\s，。；、,.!?！？：:："'“”‘’（）()\[\]【】_-]+/g, "");
}

export async function buildPendingBeautyVideoContentReviewPrompt(): Promise<{ prompt: string; version: string }> {
  const primaryPrompt = await loadSkillPrompt("baolu_content_creator");
  const startMarker = "### 拍摄剪辑优化输出合同";
  const endMarker = "\n---";
  const start = primaryPrompt.indexOf(startMarker);
  const end = primaryPrompt.indexOf(endMarker, start);
  if (start < 0 || end <= start) throw new Error("beauty_video_content_prompt_contract_missing");
  const primaryContractText = primaryPrompt.slice(start, end).trim();
  const constraintIds = ["beauty-industry-content-diff", "beauty-industry-compliance"] as const;
  const constraintPrompts = await Promise.all(constraintIds.map((skillId) => loadSkillPrompt(skillId)));
  const skillIds = ["baolu_content_creator", ...constraintIds] satisfies SkillId[];
  const version = skillIds
    .map((skillId) => `${skillId}@${SKILL_MANIFESTS[skillId]?.version ?? "missing"}`)
    .join("+");
  return {
    version,
    prompt: [
      "【固定美业能力】shooting_editing",
      "只处理当前租户本轮视频内容复盘。禁止根据自由文本改路由，禁止读取或套用任何黄金样板、其他产品或其他行业示例事实。",
      primaryContractText,
      `正式栏目：${BEAUTY_VIDEO_CONTENT_REQUIRED_SECTIONS.join("、")}。`,
      "视频时长、尺寸、画面、口播、平台和人物身份必须来自文件解析或用户确认；预测数字必须写成待验证测试目标。",
      ...constraintPrompts,
      "BY-15 已通过真实视觉 + ASR admission。每个业务视频仍必须提供当前租户可核验的画面与口播证据；缺一时只返回待补，不生成完整复盘、不调用文本 Provider、不扣费。"
    ].filter(Boolean).join("\n\n")
  };
}

export async function inspectBeautyVideoContentFile(params: {
  tenantId: string;
  requestId: string;
  filename: string;
  mimeType: string;
  buffer: Buffer;
  maxBytes: number;
}): Promise<BeautyVideoContentPreflight> {
  const extension = path.extname(params.filename).toLowerCase();
  const supportedExtension = new Set([".mp4", ".mov", ".m4v", ".webm"]);
  if (!supportedExtension.has(extension) || (!params.mimeType.startsWith("video/") && params.mimeType !== "application/octet-stream")) {
    throw new Error("beauty_video_content_type_invalid");
  }
  if (params.buffer.byteLength === 0) throw new Error("beauty_video_content_empty_file");
  if (params.buffer.byteLength > params.maxBytes) throw new Error("beauty_video_content_file_too_large");

  const metadata = await probeVideo(params.buffer, extension);
  if (!Number.isFinite(metadata.durationSeconds) || metadata.durationSeconds <= 0) {
    throw new Error("beauty_video_content_metadata_invalid");
  }
  const fileHash = createHash("sha256").update(params.buffer).digest("hex");
  const receiptId = createHash("sha256")
    .update([params.tenantId, params.requestId, fileHash, BEAUTY_VIDEO_CONTENT_WORKFLOW_VERSION].join(":"))
    .digest("hex");
  return {
    requestId: params.requestId,
    receiptId,
    filename: params.filename.slice(0, 240),
    mimeType: params.mimeType.slice(0, 120),
    byteSize: params.buffer.byteLength,
    durationSeconds: metadata.durationSeconds,
    ...(metadata.width ? { width: metadata.width } : {}),
    ...(metadata.height ? { height: metadata.height } : {}),
    ...(metadata.videoCodec ? { videoCodec: metadata.videoCodec } : {}),
    ...(metadata.audioCodec ? { audioCodec: metadata.audioCodec } : {}),
    ...(metadata.audioSampleRateHz ? { audioSampleRateHz: metadata.audioSampleRateHz } : {}),
    ...(metadata.audioChannels ? { audioChannels: metadata.audioChannels } : {}),
    formatName: metadata.formatName,
    providerCalls: 0,
    creditCost: 0,
    retainedMedia: false,
    sourceDeleted: true,
    visualStatus: "not_run_preflight_only",
    asrStatus: "not_run_preflight_only",
    checkedAt: new Date().toISOString()
  };
}

async function probeVideo(buffer: Buffer, extension: string): Promise<{
  durationSeconds: number;
  width?: number;
  height?: number;
  videoCodec?: string;
  audioCodec?: string;
  audioSampleRateHz?: number;
  audioChannels?: number;
  formatName: string;
}> {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "beauty-video-preflight-"));
  const inputPath = path.join(tempRoot, `${randomUUID()}${extension}`);
  try {
    await writeFile(inputPath, buffer);
    const ffprobePath = await resolveFfprobePath();
    const { stdout } = await execFileAsync(ffprobePath, [
      "-v", "error",
      "-show_entries", "format=duration,format_name:stream=codec_type,codec_name,width,height,sample_rate,channels",
      "-of", "json",
      inputPath
    ], { timeout: 10_000, windowsHide: true, maxBuffer: 1024 * 1024 });
    const parsed = JSON.parse(stdout) as {
      format?: { duration?: string; format_name?: string };
      streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number; sample_rate?: string; channels?: number }>;
    };
    const videoStream = parsed.streams?.find((stream) => stream.codec_type === "video");
    const audioStream = parsed.streams?.find((stream) => stream.codec_type === "audio");
    const audioSampleRateHz = Number(audioStream?.sample_rate ?? 0);
    return {
      durationSeconds: Number(Number(parsed.format?.duration ?? 0).toFixed(3)),
      ...(videoStream?.width ? { width: videoStream.width } : {}),
      ...(videoStream?.height ? { height: videoStream.height } : {}),
      ...(videoStream?.codec_name ? { videoCodec: videoStream.codec_name.slice(0, 80) } : {}),
      ...(audioStream?.codec_name ? { audioCodec: audioStream.codec_name.slice(0, 80) } : {}),
      ...(Number.isInteger(audioSampleRateHz) && audioSampleRateHz > 0 ? { audioSampleRateHz } : {}),
      ...(audioStream?.channels ? { audioChannels: audioStream.channels } : {}),
      formatName: String(parsed.format?.format_name || extension.slice(1)).slice(0, 160)
    };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("beauty_video_content_")) throw error;
    throw new Error("beauty_video_content_metadata_invalid");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function resolveFfprobePath(): Promise<string> {
  const bundled = path.join(
    process.env.USERPROFILE ?? "",
    ".workbuddy",
    "binaries",
    "ffmpeg",
    "ffmpeg-8.1.1-essentials_build",
    "bin",
    "ffprobe.exe"
  );
  try {
    await readFile(bundled);
    return bundled;
  } catch {
    return "ffprobe";
  }
}

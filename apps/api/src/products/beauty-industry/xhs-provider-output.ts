import { createHash } from "node:crypto";
import type { AgentRequest, LlmProvider, ProviderFailureInfo } from "@baolu/agent";

export const BEAUTY_XHS_PROVIDER_OUTPUT_VERSION = "beauty-xhs-provider-output-v1" as const;

const IMAGE_ROLES = ["cover", "content", "engagement"] as const;
type ImageRole = (typeof IMAGE_ROLES)[number];

interface BeautyXhsProviderOutput {
  titles: [string, string, string];
  body: string;
  tags: string[];
  interaction: string;
  imageDirections: Array<{
    role: ImageRole;
    positivePrompt: string;
    negativePrompt: string;
    postProductionText: string;
    visualParams: string;
  }>;
  factReceipt: {
    timeContext: string;
    serviceProject: string;
    audienceGeography: string;
    targetAudience: string;
    platform: string;
    deliverable: string;
  };
  compliancePending: string[];
}

export type BeautyXhsProviderOutputFailureStage = "json_parse" | "top_level_shape" | "field_validation" | "render";

export interface BeautyXhsProviderOutputDiagnostic {
  adapterVersion: typeof BEAUTY_XHS_PROVIDER_OUTPUT_VERSION;
  stage: BeautyXhsProviderOutputFailureStage;
  contractRule: string;
  outputHash: string;
  elapsedMs: number;
  structure: {
    rawBytes: number;
    hasCodeFence: boolean;
    startsWithObject: boolean;
    endsWithObject: boolean;
    parsedTopLevelType: "unparsed" | "null" | "array" | "object" | "string" | "number" | "boolean";
    topLevelKeyCount: number | null;
    titleCount: number | null;
    tagCount: number | null;
    imageDirectionCount: number | null;
    factReceiptKeyCount: number | null;
  };
}

export interface BeautyXhsStructuredOutputProviderOptions {
  onRejected?: (diagnostic: BeautyXhsProviderOutputDiagnostic) => void;
  onAccepted?: (diagnostic: BeautyXhsProviderOutputDiagnostic) => void;
}

class BeautyXhsProviderOutputAdapterError extends Error {
  readonly providerFailure: ProviderFailureInfo = { code: "invalid_response" };

  constructor(message: string, readonly diagnostic: BeautyXhsProviderOutputDiagnostic) {
    super(message);
    this.name = "BeautyXhsProviderOutputAdapterError";
  }
}

export const BEAUTY_XHS_PROVIDER_OUTPUT_DIRECTIVE = [
  `【配置Provider输出传输合同｜${BEAUTY_XHS_PROVIDER_OUTPUT_VERSION}】`,
  "只返回一个合法JSON对象，不要Markdown、代码块、解释或额外键。所有字段必须基于本次任务事实；不得用占位符补齐。",
  "JSON字段：titles(恰好3个非空标题)、body、tags(5至8个且每个以#开头)、interaction、imageDirections(恰好3项且role依次为cover/content/engagement；每项含positivePrompt/negativePrompt/postProductionText/visualParams)、factReceipt(timeContext/serviceProject/audienceGeography/targetAudience/platform/deliverable)、compliancePending(数组)。",
  "未提供时点时factReceipt.timeContext写“未提供”；不得虚构季节。每个negativePrompt都必须明确禁止文字、字母、数字、品牌、Logo、二维码和水印。"
].join("\n");

export function createBeautyXhsStructuredOutputProvider(
  provider: LlmProvider,
  adapterOptions: BeautyXhsStructuredOutputProviderOptions = {}
): LlmProvider {
  const providerWithExtensions = provider as LlmProvider & {
    getModel?: () => string;
    preflightAgentRequest?: (request: AgentRequest) => Promise<void>;
  };
  return {
    name: provider.name,
    ...(providerWithExtensions.getModel ? { getModel: () => providerWithExtensions.getModel!() } : {}),
    ...(providerWithExtensions.preflightAgentRequest
      ? { preflightAgentRequest: (request: AgentRequest) => providerWithExtensions.preflightAgentRequest!(request) }
      : {}),
    async complete(messages, completionOptions) {
      const startedAt = Date.now();
      const raw = await provider.complete(messages, { ...completionOptions, responseFormat: "json_object" });
      try {
        const rendered = renderBeautyXhsProviderOutput(parseBeautyXhsProviderOutput(raw));
        try {
          adapterOptions.onAccepted?.(buildBeautyXhsProviderOutputDiagnostic(raw, "accepted", "render", Date.now() - startedAt));
        } catch {
          // Observability must never replace the formal accepted result.
        }
        return rendered;
      } catch (error) {
        const message = error instanceof Error ? error.message : "beauty_xhs_provider_output_invalid:unknown";
        const contractRule = readSafeContractRule(message);
        const diagnostic = buildBeautyXhsProviderOutputDiagnostic(raw, contractRule, readFailureStage(contractRule), Date.now() - startedAt);
        try {
          adapterOptions.onRejected?.(diagnostic);
        } catch {
          // Observability must never replace the formal fail-closed outcome.
        }
        throw new BeautyXhsProviderOutputAdapterError(message, diagnostic);
      }
    }
  } as LlmProvider;
}

export function buildBeautyXhsProviderOutputDiagnostic(
  raw: string,
  contractRule: string,
  stage: BeautyXhsProviderOutputFailureStage,
  elapsedMs = 0
): BeautyXhsProviderOutputDiagnostic {
  const trimmed = raw.trim();
  let parsed: unknown;
  let parsedTopLevelType: BeautyXhsProviderOutputDiagnostic["structure"]["parsedTopLevelType"] = "unparsed";
  try {
    parsed = JSON.parse(trimmed);
    parsedTopLevelType = parsed === null
      ? "null"
      : Array.isArray(parsed)
        ? "array"
        : typeof parsed === "object"
          ? "object"
          : typeof parsed as "string" | "number" | "boolean";
  } catch {
    parsed = undefined;
  }
  const record = isRecord(parsed) ? parsed : undefined;
  return {
    adapterVersion: BEAUTY_XHS_PROVIDER_OUTPUT_VERSION,
    stage,
    contractRule,
    outputHash: createHash("sha256").update(raw).digest("hex"),
    elapsedMs: Math.max(0, Math.floor(elapsedMs)),
    structure: {
      rawBytes: Buffer.byteLength(raw, "utf8"),
      hasCodeFence: /```/u.test(raw),
      startsWithObject: trimmed.startsWith("{"),
      endsWithObject: trimmed.endsWith("}"),
      parsedTopLevelType,
      topLevelKeyCount: record ? Object.keys(record).length : null,
      titleCount: Array.isArray(record?.titles) ? record.titles.length : null,
      tagCount: Array.isArray(record?.tags) ? record.tags.length : null,
      imageDirectionCount: Array.isArray(record?.imageDirections) ? record.imageDirections.length : null,
      factReceiptKeyCount: isRecord(record?.factReceipt) ? Object.keys(record.factReceipt).length : null
    }
  };
}

function readSafeContractRule(message: string): string {
  const prefix = "beauty_xhs_provider_output_invalid:";
  const rawRule = message.startsWith(prefix) ? message.slice(prefix.length) : "unknown";
  return rawRule.replace(/[^a-z0-9_-]+/gi, "_").slice(0, 96) || "unknown";
}

function readFailureStage(contractRule: string): BeautyXhsProviderOutputFailureStage {
  if (contractRule === "json") return "json_parse";
  if (contractRule === "object" || contractRule === "keys") return "top_level_shape";
  return "field_validation";
}

export function parseBeautyXhsProviderOutput(raw: string): BeautyXhsProviderOutput {
  let value: unknown;
  try {
    value = JSON.parse(raw.trim());
  } catch {
    throw new Error("beauty_xhs_provider_output_invalid:json");
  }
  if (!isRecord(value)) throw new Error("beauty_xhs_provider_output_invalid:object");
  assertExactKeys(value, ["titles", "body", "tags", "interaction", "imageDirections", "factReceipt", "compliancePending"]);

  const titles = readStringArray(value.titles, "titles", 3, 3, 120) as [string, string, string];
  const body = readText(value.body, "body", 60, 12_000, true);
  const tags = readStringArray(value.tags, "tags", 5, 8, 40);
  if (tags.some((tag) => !/^#[^#\s，,；;]+$/u.test(tag))) {
    throw new Error("beauty_xhs_provider_output_invalid:tags_format");
  }
  const interaction = readText(value.interaction, "interaction", 4, 1_000, true);
  if (!Array.isArray(value.imageDirections) || value.imageDirections.length !== 3) {
    throw new Error("beauty_xhs_provider_output_invalid:image_directions_count");
  }
  const imageDirections = value.imageDirections.map((item, index) => {
    if (!isRecord(item)) throw new Error(`beauty_xhs_provider_output_invalid:image_direction_${index + 1}`);
    assertExactKeys(item, ["role", "positivePrompt", "negativePrompt", "postProductionText", "visualParams"]);
    const role = readText(item.role, `image_direction_${index + 1}_role`, 1, 20, false);
    if (role !== IMAGE_ROLES[index]) throw new Error(`beauty_xhs_provider_output_invalid:image_direction_${index + 1}_role`);
    const negativePrompt = readText(item.negativePrompt, `image_direction_${index + 1}_negative_prompt`, 8, 2_000, true);
    if (!/(?:文字|字母)/u.test(negativePrompt) || !/(?:品牌|Logo)/iu.test(negativePrompt) || !/(?:二维码|水印)/u.test(negativePrompt)) {
      throw new Error(`beauty_xhs_provider_output_invalid:image_direction_${index + 1}_negative_prompt_boundary`);
    }
    return {
      role: role as ImageRole,
      positivePrompt: readText(item.positivePrompt, `image_direction_${index + 1}_positive_prompt`, 8, 3_000, true),
      negativePrompt,
      postProductionText: readPostProductionText(item.postProductionText, `image_direction_${index + 1}_post_text`),
      visualParams: readText(item.visualParams, `image_direction_${index + 1}_visual_params`, 4, 1_000, true)
    };
  });

  if (!isRecord(value.factReceipt)) throw new Error("beauty_xhs_provider_output_invalid:fact_receipt");
  assertExactKeys(value.factReceipt, ["timeContext", "serviceProject", "audienceGeography", "targetAudience", "platform", "deliverable"]);
  const factReceipt = {
    timeContext: readText(value.factReceipt.timeContext, "fact_time_context", 1, 100, false),
    serviceProject: readText(value.factReceipt.serviceProject, "fact_service_project", 1, 160, false),
    audienceGeography: readText(value.factReceipt.audienceGeography, "fact_audience_geography", 1, 120, false),
    targetAudience: readText(value.factReceipt.targetAudience, "fact_target_audience", 1, 160, false),
    platform: readText(value.factReceipt.platform, "fact_platform", 1, 40, false),
    deliverable: readText(value.factReceipt.deliverable, "fact_deliverable", 1, 40, false)
  };
  const compliancePending = readStringArray(value.compliancePending, "compliance_pending", 1, 8, 500);

  return { titles, body, tags, interaction, imageDirections, factReceipt, compliancePending };
}

export function renderBeautyXhsProviderOutput(output: BeautyXhsProviderOutput): string {
  const directionNames: Record<ImageRole, string> = {
    cover: "配图方向一｜封面图",
    content: "配图方向二｜内容图",
    engagement: "配图方向三｜互动承接图"
  };
  return [
    "## 客户可复制成品",
    "### 标题候选",
    ...output.titles.map((title, index) => `${index + 1}. ${title}`),
    "### 正文",
    output.body,
    "### 话题标签",
    output.tags.join(" "),
    "### 互动与承接",
    output.interaction,
    "## 门店制作说明",
    ...output.imageDirections.flatMap((direction) => [
      `### ${directionNames[direction.role]}`,
      "#### 正向视觉提示词",
      direction.positivePrompt,
      "#### 负向提示词",
      direction.negativePrompt,
      "#### 后期叠字",
      direction.postProductionText,
      "#### 视觉参数",
      direction.visualParams
    ]),
    "## 质量与合规检查",
    "### 任务事实回执",
    `- 季节/时点：${output.factReceipt.timeContext}`,
    `- 服务项目：${output.factReceipt.serviceProject}`,
    `- 地理范围：${output.factReceipt.audienceGeography}`,
    `- 目标顾客：${output.factReceipt.targetAudience}`,
    `- 平台：${output.factReceipt.platform}`,
    `- 交付形式：${output.factReceipt.deliverable}`,
    "### 事实与合规待补",
    ...output.compliancePending.map((item) => `- ${item}`)
  ].join("\n");
}

function readStringArray(value: unknown, field: string, min: number, max: number, itemMax: number): string[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    throw new Error(`beauty_xhs_provider_output_invalid:${field}_count`);
  }
  const result = value.map((item, index) => readText(item, `${field}_${index + 1}`, 1, itemMax, false));
  if (new Set(result).size !== result.length) throw new Error(`beauty_xhs_provider_output_invalid:${field}_duplicate`);
  return result;
}

function readPostProductionText(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`beauty_xhs_provider_output_invalid:${field}`);
  const normalized = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (normalized.length < 1 || normalized.length > 120) {
    throw new Error(`beauty_xhs_provider_output_invalid:${field}_length`);
  }
  if (/^```|```$/u.test(normalized)) throw new Error(`beauty_xhs_provider_output_invalid:${field}_code_fence`);
  return normalized;
}

function readText(value: unknown, field: string, min: number, max: number, multiline: boolean): string {
  if (typeof value !== "string") throw new Error(`beauty_xhs_provider_output_invalid:${field}`);
  const normalized = value.normalize("NFKC").replace(/\r\n/g, "\n").trim();
  if (normalized.length < min || normalized.length > max) throw new Error(`beauty_xhs_provider_output_invalid:${field}_length`);
  if (!multiline && /[\r\n]/u.test(normalized)) throw new Error(`beauty_xhs_provider_output_invalid:${field}_multiline`);
  if (/^```|```$/u.test(normalized)) throw new Error(`beauty_xhs_provider_output_invalid:${field}_code_fence`);
  return normalized;
}

function assertExactKeys(value: Record<string, unknown>, expected: string[]): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error("beauty_xhs_provider_output_invalid:keys");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

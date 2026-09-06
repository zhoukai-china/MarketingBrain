export const BEAUTY_INDUSTRY_PRODUCT_CODE = "beauty-industry" as const;

import {
  BEAUTY_WORKFLOWS,
  type BeautyIndustryScope
} from "./workflows.js";
import type { BeautyRouteReceipt } from "./route-receipt.js";
import type { BeautyTopicWorkflowInput } from "./topic-evidence.js";
import {
  BEAUTY_CONTENT_WORKFLOW_VERSION,
  type BeautyContentWorkflowInput
} from "./content-workflow.js";
import {
  BEAUTY_VIDEO_CONTENT_WORKFLOW_JSON_SCHEMA,
  BEAUTY_VIDEO_CONTENT_WORKFLOW_VERSION,
  readBeautyVideoContentWorkflow,
  type BeautyVideoContentWorkflowInput
} from "./video-content-workflow.js";
import {
  BEAUTY_LIVE_REVIEW_INPUT_SCHEMA,
  readBeautyLiveReviewWorkflow,
  type BeautyLiveReviewWorkflowInput
} from "./live-review-workflow.js";
import { env } from "../../config/env.js";

export type { BeautyIndustryScope } from "./workflows.js";

export const BEAUTY_INDUSTRY_SCOPES = [
  "acquisition:topics",
  "acquisition:video-content",
  "acquisition:video-content-review",
  "acquisition:xhs",
  "acquisition:live",
  "acquisition:video-data-review",
  "acquisition:live-review",
  "operations:daily-brief",
  "operations:business-qa",
  "sales:advice"
] as const satisfies readonly BeautyIndustryScope[];

export interface BeautyIndustryMcpContext {
  credentialId: string;
  tenantId: string;
  userId: string;
  productCode: string;
  operatingEntityId: string;
  scopes: BeautyIndustryScope[];
  entitled: boolean;
}

export interface BeautyIndustryToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface BeautyIndustryExecutionSpec {
  credentialId: string;
  tenantId: string;
  userId: string;
  productCode: typeof BEAUTY_INDUSTRY_PRODUCT_CODE;
  operatingEntityId: string;
  channel: "mcp";
  capabilityId: string;
  skillId: string;
  requestId: string;
  input: string;
  mode: "quick" | "professional";
  professionalOptions?: {
    audience?: string;
    project?: string;
    platform?: string;
    tone?: string;
    visualStyle?: string;
    budgetPreview?: string;
    contentStructure?: string;
    shootingRequirements?: string;
    edlRequirements?: string;
    imageCount?: number;
    parsedEvidence?: string;
    parseStatus?: "parsed" | "failed";
    sourceFilename?: string;
    priceBoundary?: string;
    customerConcern?: string;
    communicationStage?: string;
    allowedNextAction?: string;
    city?: string;
    storeFacts?: string;
    contentAngle?: string;
    prohibitedContent?: string;
  };
  topicWorkflow?: BeautyTopicWorkflowInput;
  contentWorkflow?: BeautyContentWorkflowInput;
  videoContentWorkflow?: BeautyVideoContentWorkflowInput;
  liveReviewWorkflow?: BeautyLiveReviewWorkflowInput;
  arguments: Record<string, unknown>;
}

export const BEAUTY_VIDEO_CONTENT_REVIEW_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    question: { type: "string", minLength: 6, maxLength: 20_000 },
    requestId: { type: "string", minLength: 8, maxLength: 200 },
    mode: { type: "string", const: "professional" },
    videoContentWorkflow: BEAUTY_VIDEO_CONTENT_WORKFLOW_JSON_SCHEMA
  },
  required: ["question", "requestId", "mode", "videoContentWorkflow"],
  $comment: `Active after BY-15 real visual + ASR admission; fixed ${BEAUTY_VIDEO_CONTENT_WORKFLOW_VERSION} contract.`
} as const;

export const BEAUTY_VIDEO_CONTENT_REVIEW_PENDING_INPUT_SCHEMA = BEAUTY_VIDEO_CONTENT_REVIEW_INPUT_SCHEMA;

export type BeautyVideoContentReviewPendingArguments = {
  question: string;
  requestId: string;
  mode: "professional";
  videoContentWorkflow: BeautyVideoContentWorkflowInput;
};

export interface BeautyIndustryExecutionResult {
  status: "succeeded" | "clarification_required" | "partial_success" | "failed";
  text: string;
  runId: string;
  creditCost: number;
  remainingCredits?: number;
  result?: Record<string, unknown>;
  abilityUsed?: string;
  routeReceipt?: BeautyRouteReceipt;
  structuredDelivery?: import("./structured-delivery.js").BeautyStructuredDelivery;
}

export interface BeautyIndustryToolRegistration extends BeautyIndustryToolDefinition {
  scope: BeautyIndustryScope;
  capabilityId: string;
  skillId: string;
}

const COMMON_INPUT = {
  type: "object",
  additionalProperties: false,
  properties: {
    question: { type: "string", minLength: 6, maxLength: 20_000, description: "美业获客问题或任务" },
    conversationId: { type: "string", maxLength: 200, description: "可选连续对话标识" },
    requestId: { type: "string", minLength: 8, maxLength: 200, description: "调用方幂等请求号" },
    mode: { type: "string", enum: ["quick", "professional"], default: "quick", description: "快速模式默认使用已确认门店档案；专业模式可追加参数" },
    professionalOptions: {
      type: "object",
      additionalProperties: false,
      properties: {
        audience: { type: "string", maxLength: 500 },
        project: { type: "string", maxLength: 200 },
        platform: { type: "string", maxLength: 100 },
        tone: { type: "string", maxLength: 200 },
        visualStyle: { type: "string", maxLength: 300 },
        budgetPreview: { type: "string", maxLength: 200 },
        contentStructure: { type: "string", maxLength: 500 },
        shootingRequirements: { type: "string", maxLength: 500 },
        edlRequirements: { type: "string", maxLength: 500 },
        imageCount: { type: "integer", enum: [1, 3] }
        ,parsedEvidence: { type: "string", maxLength: 20_000, description: "仅用于视频数据/内容复盘的受控解析结果" }
        ,parseStatus: { type: "string", enum: ["parsed", "failed"] }
        ,sourceFilename: { type: "string", maxLength: 240 }
        ,priceBoundary: { type: "string", maxLength: 500 }
        ,customerConcern: { type: "string", maxLength: 1_000 }
        ,communicationStage: { type: "string", maxLength: 200 }
        ,allowedNextAction: { type: "string", maxLength: 500 }
        ,city: { type: "string", maxLength: 80, description: "仅用于本次任务的已确认城市，可覆盖档案默认值" }
        ,storeFacts: { type: "string", maxLength: 500, description: "仅用于本次任务的门店事实，不写回经营档案" }
        ,contentAngle: { type: "string", maxLength: 300 }
        ,prohibitedContent: { type: "string", maxLength: 500 }
      }
    }
  },
  required: ["question", "requestId"]
};

const TOPIC_INPUT = {
  ...COMMON_INPUT,
  properties: {
    ...COMMON_INPUT.properties,
    topicWorkflow: {
      type: "object",
      additionalProperties: false,
      description: "结构化获客目标与四来源选择；身份由美业产品凭据和已确认经营档案推导。",
      properties: {
        identity: { type: "string", maxLength: 160 },
        targetCustomer: { type: "string", minLength: 2, maxLength: 500 },
        acquisitionGoal: { type: "string", minLength: 2, maxLength: 500 },
        offer: { type: "string", maxLength: 300 },
        accountStage: { type: "string", maxLength: 100 },
        industry: { type: "string", minLength: 2, maxLength: 120 },
        benchmarkAccounts: { type: "array", maxItems: 12, items: { type: "string", minLength: 1, maxLength: 240 } },
        transcriptDocumentIds: { type: "array", maxItems: 20, items: { type: "string", minLength: 1, maxLength: 200 } },
        videoReviewId: { type: "string", maxLength: 200 },
        sourceSelection: {
          type: "object",
          additionalProperties: false,
          properties: {
            industry: { type: "boolean" },
            benchmark: { type: "boolean" },
            transcript: { type: "boolean" },
            videoReview: { type: "boolean" }
          },
          required: ["industry", "benchmark", "transcript", "videoReview"]
        }
      },
      required: ["targetCustomer", "acquisitionGoal", "industry", "benchmarkAccounts", "transcriptDocumentIds", "sourceSelection"]
    }
  },
  required: ["question", "requestId", "topicWorkflow"]
};

const CONTENT_WORKFLOW_INPUT = {
  ...COMMON_INPUT,
  properties: {
    ...COMMON_INPUT.properties,
    contentWorkflow: {
      type: "object",
      additionalProperties: false,
      description: "内容系统结构化简报；当前交付沿用网页与 WorkBuddy 共用的 V5 十件合同。",
      properties: {
        version: { type: "string", const: BEAUTY_CONTENT_WORKFLOW_VERSION },
        topic: { type: "string", minLength: 2, maxLength: 500 },
        objective: { type: "string", minLength: 2, maxLength: 500 },
        targetAudience: { type: "string", minLength: 2, maxLength: 500 },
        platform: { type: "string", minLength: 1, maxLength: 100 },
        format: { type: "string", maxLength: 100 },
        duration: { type: "string", maxLength: 100 },
        presenter: { type: "string", maxLength: 200 },
        projectFacts: { type: "string", maxLength: 2_000 },
        shootingConstraints: { type: "string", maxLength: 1_000 },
        sourceTopic: {
          type: "object",
          additionalProperties: false,
          properties: {
            topic: { type: "string", minLength: 2, maxLength: 500 },
            audience: { type: "string", minLength: 2, maxLength: 500 },
            sourceEvidence: { type: "string", minLength: 2, maxLength: 1_000 },
            factBoundary: { type: "string", minLength: 2, maxLength: 1_000 },
            goalRelation: { type: "string", minLength: 2, maxLength: 1_000 }
          },
          required: ["topic", "audience", "sourceEvidence", "factBoundary", "goalRelation"]
        }
      },
      required: ["version", "topic", "objective", "targetAudience", "platform"]
    }
  },
  required: ["question", "requestId", "contentWorkflow"]
};

const TOOL_REGISTRATIONS: readonly BeautyIndustryToolRegistration[] = [
  {
    name: "beauty.business_qa",
    description: "基于当前门店已确认经营事实回答经营问题；缺失资料明确说明，不编造价格、疗效、案例或业绩。",
    scope: "operations:business-qa",
    capabilityId: "beauty_business_qa",
    skillId: "general_qa",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        question: { type: "string", minLength: 2, maxLength: 1_200 },
        conversationId: { type: "string", maxLength: 200 },
        requestId: { type: "string", minLength: 8, maxLength: 200 }
      },
      required: ["question", "requestId"]
    }
  },
  {
    name: "beauty.daily_brief",
    description: "读取美业 AI 日报的北京时间业务日状态、已验证缓存与历史；受权环境可发起同一日键的人工生成或重试。",
    scope: "operations:daily-brief",
    capabilityId: "beauty_daily_brief",
    skillId: "ai_daily_brief",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        action: { type: "string", enum: ["get", "history", "generate", "retry"] },
        businessDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        requestId: { type: "string", minLength: 8, maxLength: 200 }
      },
      required: ["action", "requestId"]
    }
  },
  {
    name: BEAUTY_WORKFLOWS.topics.toolName,
    description: "生成与当前美业门店、目标顾客和渠道相关的可验证选题。",
    scope: BEAUTY_WORKFLOWS.topics.scope,
    capabilityId: BEAUTY_WORKFLOWS.topics.capabilityId,
    skillId: BEAUTY_WORKFLOWS.topics.primarySkillId,
    inputSchema: TOPIC_INPUT
  },
  {
    name: BEAUTY_WORKFLOWS["content-ten"].toolName,
    description: "把已确认的美业选题转成内容系统当前正式 V5 十件交付；不生成或发布视频。",
    scope: BEAUTY_WORKFLOWS["content-ten"].scope,
    capabilityId: BEAUTY_WORKFLOWS["content-ten"].capabilityId,
    skillId: BEAUTY_WORKFLOWS["content-ten"].primarySkillId,
    inputSchema: CONTENT_WORKFLOW_INPUT
  },
  {
    name: BEAUTY_WORKFLOWS.xiaohongshu.toolName,
    description: "生成同一任务内的美业小红书标题、正文、标签与三套图片方向；真实生图需报价确认。",
    scope: BEAUTY_WORKFLOWS.xiaohongshu.scope,
    capabilityId: BEAUTY_WORKFLOWS.xiaohongshu.capabilityId,
    skillId: BEAUTY_WORKFLOWS.xiaohongshu.primarySkillId,
    inputSchema: COMMON_INPUT
  },
  {
    name: BEAUTY_WORKFLOWS["live-script"].toolName,
    description: "生成面向到店顾客的美业直播话术草稿，不自动开播或发布。",
    scope: BEAUTY_WORKFLOWS["live-script"].scope,
    capabilityId: BEAUTY_WORKFLOWS["live-script"].capabilityId,
    skillId: BEAUTY_WORKFLOWS["live-script"].primarySkillId,
    inputSchema: COMMON_INPUT
  },
  {
    name: BEAUTY_WORKFLOWS["video-data-review"].toolName,
    description: "仅依据成功解析的 CSV/Excel 或结构化数据复盘播放、完播、互动和转化。",
    scope: BEAUTY_WORKFLOWS["video-data-review"].scope,
    capabilityId: BEAUTY_WORKFLOWS["video-data-review"].capabilityId,
    skillId: BEAUTY_WORKFLOWS["video-data-review"].primarySkillId,
    inputSchema: COMMON_INPUT
  },
  {
    name: BEAUTY_WORKFLOWS["video-content-review"].toolName,
    description: "依据当前租户本轮视频的真实画面与口播证据，生成固定结构的视频内容复盘和可执行改进。",
    scope: BEAUTY_WORKFLOWS["video-content-review"].scope,
    capabilityId: BEAUTY_WORKFLOWS["video-content-review"].capabilityId,
    skillId: BEAUTY_WORKFLOWS["video-content-review"].primarySkillId,
    inputSchema: BEAUTY_VIDEO_CONTENT_REVIEW_INPUT_SCHEMA
  },
  {
    name: BEAUTY_WORKFLOWS["live-review"].toolName,
    description: "依据当前场次真实数据、转写与原话术计划完成固定八模块直播复盘；缺失证据按模块降级。",
    scope: BEAUTY_WORKFLOWS["live-review"].scope,
    capabilityId: BEAUTY_WORKFLOWS["live-review"].capabilityId,
    skillId: BEAUTY_WORKFLOWS["live-review"].primarySkillId,
    inputSchema: BEAUTY_LIVE_REVIEW_INPUT_SCHEMA
  },
  {
    name: BEAUTY_WORKFLOWS.sales.toolName,
    description: "基于真实美业顾客沟通与门店事实，生成销售诊断、合规话术和下一步跟进建议。",
    scope: BEAUTY_WORKFLOWS.sales.scope,
    capabilityId: BEAUTY_WORKFLOWS.sales.capabilityId,
    skillId: BEAUTY_WORKFLOWS.sales.primarySkillId,
    inputSchema: COMMON_INPUT
  }
];

const FORBIDDEN_IDENTITY_ARGUMENTS = new Set(["tenantId", "userId", "productCode", "operatingEntityId", "credentialId", "agentId", "scopes"]);

export function listBeautyIndustryMcpTools(context: BeautyIndustryMcpContext): BeautyIndustryToolDefinition[] {
  assertBeautyProductContext(context);
  return TOOL_REGISTRATIONS
    .filter((tool) => context.scopes.includes(tool.scope))
    .filter((tool) => tool.name !== "beauty.daily_brief" || env.BEAUTY_DAILY_BRIEF_RUNTIME_MODE !== "disabled")
    .map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
}

export function getBeautyIndustryToolRegistration(toolName: string): BeautyIndustryToolRegistration {
  const tool = TOOL_REGISTRATIONS.find((item) => item.name === toolName);
  if (!tool) throw new Error("beauty_tool_not_found");
  return tool;
}

export async function runBeautyIndustryMcpTool(input: {
  context: BeautyIndustryMcpContext;
  toolName: string;
  arguments: Record<string, unknown>;
  execute: (spec: BeautyIndustryExecutionSpec) => Promise<BeautyIndustryExecutionResult>;
}): Promise<BeautyIndustryExecutionResult> {
  assertBeautyProductContext(input.context);
  for (const key of Object.keys(input.arguments)) {
    if (FORBIDDEN_IDENTITY_ARGUMENTS.has(key)) throw new Error("mcp_identity_argument_forbidden");
  }
  const tool = getBeautyIndustryToolRegistration(input.toolName);
  if (!input.context.scopes.includes(tool.scope)) throw new Error("beauty_tool_scope_forbidden");
  const question = requiredText(input.arguments.question, "question", 20_000);
  const requestId = requiredText(input.arguments.requestId, "requestId", 200);
  if (requestId.length < 8) throw new Error("mcp_argument_invalid:requestId");
  const mode = input.arguments.mode === "professional" ? "professional" : "quick";
  const professionalOptions = readProfessionalOptions(input.arguments.professionalOptions);
  assertToolProfessionalOptions(tool.name, professionalOptions);
  const topicWorkflow = tool.name === BEAUTY_WORKFLOWS.topics.toolName
    ? readTopicWorkflow(input.arguments.topicWorkflow)
    : undefined;
  if (tool.name !== BEAUTY_WORKFLOWS.topics.toolName && input.arguments.topicWorkflow !== undefined) {
    throw new Error("mcp_argument_invalid:topicWorkflow");
  }
  const contentWorkflow = tool.name === BEAUTY_WORKFLOWS["content-ten"].toolName
    ? readContentWorkflow(input.arguments.contentWorkflow)
    : undefined;
  if (tool.name !== BEAUTY_WORKFLOWS["content-ten"].toolName && input.arguments.contentWorkflow !== undefined) {
    throw new Error("mcp_argument_invalid:contentWorkflow");
  }
  const videoContentWorkflow = tool.name === BEAUTY_WORKFLOWS["video-content-review"].toolName
    ? readVideoContentWorkflow(input.arguments.videoContentWorkflow)
    : undefined;
  if (tool.name !== BEAUTY_WORKFLOWS["video-content-review"].toolName && input.arguments.videoContentWorkflow !== undefined) {
    throw new Error("mcp_argument_invalid:videoContentWorkflow");
  }
  const liveReviewWorkflow = tool.name === BEAUTY_WORKFLOWS["live-review"].toolName
    ? readLiveReviewWorkflow(input.arguments.liveReviewWorkflow)
    : undefined;
  if (tool.name !== BEAUTY_WORKFLOWS["live-review"].toolName && input.arguments.liveReviewWorkflow !== undefined) {
    throw new Error("mcp_argument_invalid:liveReviewWorkflow");
  }
  return input.execute({
    credentialId: input.context.credentialId,
    tenantId: input.context.tenantId,
    userId: input.context.userId,
    productCode: BEAUTY_INDUSTRY_PRODUCT_CODE,
    operatingEntityId: input.context.operatingEntityId,
    channel: "mcp",
    capabilityId: tool.capabilityId,
    skillId: tool.skillId,
    requestId: `beauty-mcp:${input.context.credentialId}:${requestId}`,
    input: question,
    mode,
    ...(professionalOptions ? { professionalOptions } : {}),
    ...(topicWorkflow ? { topicWorkflow } : {}),
    ...(contentWorkflow ? { contentWorkflow } : {}),
    ...(videoContentWorkflow ? { videoContentWorkflow } : {}),
    ...(liveReviewWorkflow ? { liveReviewWorkflow } : {}),
    arguments: { ...input.arguments }
  });
}

function readLiveReviewWorkflow(value: unknown): BeautyLiveReviewWorkflowInput {
  try {
    return readBeautyLiveReviewWorkflow(value);
  } catch {
    throw new Error("mcp_argument_invalid:liveReviewWorkflow");
  }
}

function readVideoContentWorkflow(value: unknown): BeautyVideoContentWorkflowInput {
  try {
    const workflow = readBeautyVideoContentWorkflow(value);
    if (!workflow.transcript?.trim()) throw new Error("mcp_argument_required:videoContentWorkflow.transcript");
    if (!workflow.visualEvidence?.trim() && !workflow.sceneTimeline?.trim()) throw new Error("mcp_argument_required:videoContentWorkflow.visualEvidence");
    return workflow;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("mcp_argument_")) throw error;
    throw new Error("mcp_argument_invalid:videoContentWorkflow");
  }
}

function readContentWorkflow(value: unknown): BeautyContentWorkflowInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("mcp_argument_required:contentWorkflow");
  const raw = value as Record<string, unknown>;
  const allowed = new Set(["version", "topic", "objective", "targetAudience", "platform", "format", "duration", "presenter", "projectFacts", "shootingConstraints", "sourceTopic"]);
  if (Object.keys(raw).some((key) => !allowed.has(key))) throw new Error("mcp_argument_invalid:contentWorkflow");
  if (raw.version !== BEAUTY_CONTENT_WORKFLOW_VERSION) throw new Error("mcp_argument_invalid:contentWorkflow.version");
  const text = (key: string, max: number, required = false) => {
    const item = raw[key];
    if (item === undefined || item === null || item === "") {
      if (required) throw new Error(`mcp_argument_required:contentWorkflow.${key}`);
      return undefined;
    }
    if (typeof item !== "string" || !item.trim() || item.trim().length > max) throw new Error(`mcp_argument_invalid:contentWorkflow.${key}`);
    return item.trim();
  };
  let sourceTopic: BeautyContentWorkflowInput["sourceTopic"];
  if (raw.sourceTopic !== undefined) {
    if (!raw.sourceTopic || typeof raw.sourceTopic !== "object" || Array.isArray(raw.sourceTopic)) throw new Error("mcp_argument_invalid:contentWorkflow.sourceTopic");
    const source = raw.sourceTopic as Record<string, unknown>;
    const sourceKeys = ["topic", "audience", "sourceEvidence", "factBoundary", "goalRelation"];
    if (Object.keys(source).some((key) => !sourceKeys.includes(key))) throw new Error("mcp_argument_invalid:contentWorkflow.sourceTopic");
    const sourceText = (key: string, max: number) => {
      const item = source[key];
      if (typeof item !== "string" || !item.trim() || item.trim().length > max) throw new Error(`mcp_argument_required:contentWorkflow.sourceTopic.${key}`);
      return item.trim();
    };
    sourceTopic = {
      topic: sourceText("topic", 500),
      audience: sourceText("audience", 500),
      sourceEvidence: sourceText("sourceEvidence", 1_000),
      factBoundary: sourceText("factBoundary", 1_000),
      goalRelation: sourceText("goalRelation", 1_000)
    };
  }
  return {
    version: BEAUTY_CONTENT_WORKFLOW_VERSION,
    topic: text("topic", 500, true)!,
    objective: text("objective", 500, true)!,
    targetAudience: text("targetAudience", 500, true)!,
    platform: text("platform", 100, true)!,
    format: text("format", 100),
    duration: text("duration", 100),
    presenter: text("presenter", 200),
    projectFacts: text("projectFacts", 2_000),
    shootingConstraints: text("shootingConstraints", 1_000),
    ...(sourceTopic ? { sourceTopic } : {})
  };
}

function readTopicWorkflow(value: unknown): BeautyTopicWorkflowInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("mcp_argument_required:topicWorkflow");
  const raw = value as Record<string, unknown>;
  const allowed = new Set(["identity", "targetCustomer", "acquisitionGoal", "offer", "accountStage", "industry", "benchmarkAccounts", "transcriptDocumentIds", "videoReviewId", "sourceSelection"]);
  if (Object.keys(raw).some((key) => !allowed.has(key))) throw new Error("mcp_argument_invalid:topicWorkflow");
  const sourceRaw = raw.sourceSelection;
  if (!sourceRaw || typeof sourceRaw !== "object" || Array.isArray(sourceRaw)) throw new Error("mcp_argument_required:topicWorkflow.sourceSelection");
  const source = sourceRaw as Record<string, unknown>;
  const sourceKeys = ["industry", "benchmark", "transcript", "videoReview"] as const;
  if (Object.keys(source).some((key) => !sourceKeys.includes(key as typeof sourceKeys[number])) || sourceKeys.some((key) => typeof source[key] !== "boolean")) {
    throw new Error("mcp_argument_invalid:topicWorkflow.sourceSelection");
  }
  const list = (key: string, limit: number, max: number) => {
    const item = raw[key];
    if (item === undefined) return [];
    if (!Array.isArray(item) || item.length > limit || item.some((entry) => typeof entry !== "string" || !entry.trim() || entry.trim().length > max)) {
      throw new Error(`mcp_argument_invalid:topicWorkflow.${key}`);
    }
    return Array.from(new Set(item.map((entry) => String(entry).trim())));
  };
  const text = (key: string, max: number, required = false) => {
    const item = raw[key];
    if (item === undefined || item === null || item === "") {
      if (required) throw new Error(`mcp_argument_required:topicWorkflow.${key}`);
      return undefined;
    }
    if (typeof item !== "string" || !item.trim() || item.trim().length > max) throw new Error(`mcp_argument_invalid:topicWorkflow.${key}`);
    return item.trim();
  };
  return {
    identity: text("identity", 160),
    targetCustomer: text("targetCustomer", 500, true)!,
    acquisitionGoal: text("acquisitionGoal", 500, true)!,
    offer: text("offer", 300),
    accountStage: text("accountStage", 100),
    industry: text("industry", 120, true)!,
    benchmarkAccounts: list("benchmarkAccounts", 12, 240),
    transcriptDocumentIds: list("transcriptDocumentIds", 20, 200),
    videoReviewId: text("videoReviewId", 200),
    sourceSelection: {
      industry: Boolean(source.industry),
      benchmark: Boolean(source.benchmark),
      transcript: Boolean(source.transcript),
      videoReview: Boolean(source.videoReview)
    }
  };
}

function readProfessionalOptions(value: unknown): BeautyIndustryExecutionSpec["professionalOptions"] | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const allowed = new Set(["audience", "project", "platform", "tone", "visualStyle", "budgetPreview", "contentStructure", "shootingRequirements", "edlRequirements", "imageCount", "parsedEvidence", "parseStatus", "sourceFilename", "priceBoundary", "customerConcern", "communicationStage", "allowedNextAction", "city", "storeFacts", "contentAngle", "prohibitedContent"]);
  if (Object.keys(raw).some((key) => !allowed.has(key))) throw new Error("mcp_argument_invalid:professionalOptions");
  const text = (key: string, max: number) => typeof raw[key] === "string" && raw[key].trim() ? raw[key].trim().slice(0, max) : undefined;
  const imageCount = typeof raw.imageCount === "number" && (raw.imageCount === 1 || raw.imageCount === 3)
    ? raw.imageCount
    : undefined;
  if (raw.imageCount !== undefined && imageCount === undefined) throw new Error("mcp_argument_invalid:imageCount");
  if (raw.parseStatus !== undefined && raw.parseStatus !== "parsed" && raw.parseStatus !== "failed") throw new Error("mcp_argument_invalid:parseStatus");
  return {
    ...(text("audience", 500) ? { audience: text("audience", 500) } : {}),
    ...(text("project", 200) ? { project: text("project", 200) } : {}),
    ...(text("platform", 100) ? { platform: text("platform", 100) } : {}),
    ...(text("tone", 200) ? { tone: text("tone", 200) } : {}),
    ...(text("visualStyle", 300) ? { visualStyle: text("visualStyle", 300) } : {}),
    ...(text("budgetPreview", 200) ? { budgetPreview: text("budgetPreview", 200) } : {}),
    ...(text("contentStructure", 500) ? { contentStructure: text("contentStructure", 500) } : {}),
    ...(text("shootingRequirements", 500) ? { shootingRequirements: text("shootingRequirements", 500) } : {}),
    ...(text("edlRequirements", 500) ? { edlRequirements: text("edlRequirements", 500) } : {}),
    ...(imageCount ? { imageCount } : {})
    ,...(text("parsedEvidence", 20_000) ? { parsedEvidence: text("parsedEvidence", 20_000) } : {})
    ,...(raw.parseStatus === "parsed" || raw.parseStatus === "failed" ? { parseStatus: raw.parseStatus } : {})
    ,...(text("sourceFilename", 240) ? { sourceFilename: text("sourceFilename", 240) } : {})
    ,...(text("priceBoundary", 500) ? { priceBoundary: text("priceBoundary", 500) } : {})
    ,...(text("customerConcern", 1_000) ? { customerConcern: text("customerConcern", 1_000) } : {})
    ,...(text("communicationStage", 200) ? { communicationStage: text("communicationStage", 200) } : {})
    ,...(text("allowedNextAction", 500) ? { allowedNextAction: text("allowedNextAction", 500) } : {})
    ,...(text("city", 80) ? { city: text("city", 80) } : {})
    ,...(text("storeFacts", 500) ? { storeFacts: text("storeFacts", 500) } : {})
    ,...(text("contentAngle", 300) ? { contentAngle: text("contentAngle", 300) } : {})
    ,...(text("prohibitedContent", 500) ? { prohibitedContent: text("prohibitedContent", 500) } : {})
  };
}

const TOOL_OPTION_KEYS: Record<string, ReadonlySet<string>> = {
  "beauty.topic_ideas": new Set(["audience", "project", "platform"]),
  "beauty.content_ten_pack": new Set(["audience", "project", "platform", "tone", "contentStructure", "shootingRequirements", "edlRequirements"]),
  "beauty.xiaohongshu_package": new Set(["audience", "project", "platform", "tone", "visualStyle", "contentStructure", "shootingRequirements", "imageCount", "city", "storeFacts", "contentAngle", "prohibitedContent"]),
  "beauty.live_script": new Set(["audience", "project", "tone", "contentStructure"]),
  "beauty.video_data_review": new Set(["platform", "contentStructure", "parsedEvidence", "parseStatus", "sourceFilename"]),
  "beauty.video_content_review": new Set([]),
  "beauty.live_review": new Set([]),
  "beauty.sales_advice": new Set(["audience", "project", "tone", "contentStructure", "priceBoundary", "customerConcern", "communicationStage", "allowedNextAction"])
};

export function assertBeautyIndustryToolOptions(
  toolName: string,
  options: BeautyIndustryExecutionSpec["professionalOptions"] | undefined
): void {
  assertToolProfessionalOptions(toolName, options);
}

function assertToolProfessionalOptions(toolName: string, options: BeautyIndustryExecutionSpec["professionalOptions"] | undefined): void {
  if (!options) return;
  const allowed = TOOL_OPTION_KEYS[toolName];
  if (!allowed) throw new Error("beauty_tool_not_found");
  const supplied = Object.entries(options).filter(([, value]) => value !== undefined && value !== "");
  const invalid = supplied.find(([key]) => !allowed.has(key));
  if (invalid) throw new Error(`beauty_tool_option_forbidden:${toolName}:${invalid[0]}`);
}

function assertBeautyProductContext(context: BeautyIndustryMcpContext): void {
  if (context.productCode !== BEAUTY_INDUSTRY_PRODUCT_CODE) throw new Error("beauty_product_credential_required");
  if (!context.entitled) throw new Error("beauty_product_entitlement_required");
  if (!context.credentialId || !context.tenantId || !context.userId || !context.operatingEntityId) throw new Error("beauty_credential_context_incomplete");
}

function requiredText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`mcp_argument_required:${field}`);
  const text = value.trim();
  if (text.length > maxLength) throw new Error(`mcp_argument_too_long:${field}`);
  return text;
}

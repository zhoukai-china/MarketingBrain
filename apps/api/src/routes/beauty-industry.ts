import { createHash } from "node:crypto";
import type { LlmProvider } from "@baolu/agent";
import { prisma } from "@baolu/db";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import {
  BEAUTY_INDUSTRY_SCOPES,
  assertBeautyIndustryToolOptions,
  getBeautyIndustryToolRegistration,
  listBeautyIndustryMcpTools,
  type BeautyIndustryScope
} from "../products/beauty-industry/mcp-adapter.js";
import { executeBeautyIndustryProductTool } from "../products/beauty-industry/execution.js";
import {
  BEAUTY_CONTENT_WORKFLOW_VERSION,
  buildBeautyContentSourceSummary
} from "../products/beauty-industry/content-workflow.js";
import {
  BEAUTY_SEGMENTS,
  deleteBeautyIndustryProfile,
  readBeautyIndustryProfileFromTenantData,
  saveBeautyIndustryProfile
} from "../products/beauty-industry/profile.js";
import {
  BEAUTY_VIDEO_CONTENT_WORKFLOW_VERSION,
  beautyVideoContentWorkflowSchema,
  inspectBeautyVideoContentFile,
  readBeautyVideoContentWorkflow
} from "../products/beauty-industry/video-content-workflow.js";
import { beautyLiveReviewWorkflowSchema } from "../products/beauty-industry/live-review-workflow.js";
import { classifyBeautyTopicExecutionFailure } from "../products/beauty-industry/topic-errors.js";
import { tryParseBeautyXhsDelivery } from "../products/beauty-industry/xhs-delivery.js";
import { buildBeautyXhsTaskSnapshot, readBeautyXhsTaskSnapshot } from "../products/beauty-industry/xhs-task-snapshot.js";
import { readBeautyDeliveryPreview, tryParseBeautyContentDelivery, tryParseBeautySalesDelivery } from "../products/beauty-industry/structured-delivery.js";
import {
  enqueueBeautyDailyBrief,
  listBeautyDailyBriefHistory,
  processBeautyDailyBriefSnapshot,
  readBeautyDailyBriefState,
  retryBeautyDailyBrief
} from "../products/beauty-industry/daily-brief-service.js";
import { BEAUTY_DAILY_BRIEF_TIME_ZONE, readBeautyDailyBriefClock } from "../products/beauty-industry/daily-brief-contract.js";
import { env } from "../config/env.js";
import { AgentClarificationRequired, assertAgentAccess, getRuntimeAgent } from "../services/agent-runtime.js";
import { IdempotencyConflictError, InsufficientCreditsError } from "../services/chat-persistence.js";
import { BillingRequestInProgressError, BillingRequestPreviouslyFailedError } from "../services/credit-reservations.js";
import { resolveRequestContext } from "../services/request-context.js";
import { createRequestExecutionScope } from "../services/request-execution-scope.js";
import { registerBeautyIndustryMediaRoutes } from "./beauty-industry-media.js";
import {
  assertNoBeautyIndustryBrandOverride,
  resolveBeautyIndustryBrandContext,
  toBeautyIndustryPublicBrand
} from "../products/beauty-industry/brand-config.js";

const topicWorkflowSchema = z.object({
  identity: z.string().trim().max(160).optional(),
  targetCustomer: z.string().trim().min(2).max(500),
  acquisitionGoal: z.string().trim().min(2).max(500),
  offer: z.string().trim().max(300).optional(),
  accountStage: z.string().trim().max(100).optional(),
  industry: z.string().trim().min(2).max(120),
  benchmarkAccounts: z.array(z.string().trim().min(1).max(240)).max(12).default([]),
  transcriptDocumentIds: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
  videoReviewId: z.string().trim().min(1).max(200).optional(),
  sourceSelection: z.object({
    industry: z.boolean(),
    benchmark: z.boolean(),
    transcript: z.boolean(),
    videoReview: z.boolean()
  }).strict()
}).strict();

const contentWorkflowSchema = z.object({
  version: z.literal(BEAUTY_CONTENT_WORKFLOW_VERSION),
  topic: z.string().trim().min(2).max(500),
  objective: z.string().trim().min(2).max(500),
  targetAudience: z.string().trim().min(2).max(500),
  platform: z.string().trim().min(1).max(100),
  format: z.string().trim().max(100).optional(),
  duration: z.string().trim().max(100).optional(),
  presenter: z.string().trim().max(200).optional(),
  projectFacts: z.string().trim().max(2_000).optional(),
  shootingConstraints: z.string().trim().max(1_000).optional(),
  sourceTopic: z.object({
    topic: z.string().trim().min(2).max(500),
    audience: z.string().trim().min(2).max(500),
    sourceEvidence: z.string().trim().min(2).max(1_000),
    factBoundary: z.string().trim().min(2).max(1_000),
    goalRelation: z.string().trim().min(2).max(1_000)
  }).strict().optional()
}).strict();

const runSchema = z.object({
  toolName: z.enum([
    "beauty.topic_ideas",
    "beauty.content_ten_pack",
    "beauty.xiaohongshu_package",
    "beauty.live_script",
    "beauty.video_data_review",
    "beauty.video_content_review",
    "beauty.live_review",
    "beauty.sales_advice"
  ]),
  question: z.string().trim().min(6).max(20_000),
  confirmedFacts: z.string().trim().max(2_000).optional(),
  mode: z.enum(["quick", "professional"]).default("quick"),
  professionalOptions: z.object({
    audience: z.string().trim().max(500).optional(),
    project: z.string().trim().max(200).optional(),
    platform: z.string().trim().max(100).optional(),
    tone: z.string().trim().max(200).optional(),
    visualStyle: z.string().trim().max(300).optional(),
    budgetPreview: z.string().trim().max(200).optional(),
    contentStructure: z.string().trim().max(500).optional(),
    shootingRequirements: z.string().trim().max(500).optional(),
    edlRequirements: z.string().trim().max(500).optional(),
    imageCount: z.union([z.literal(1), z.literal(3)]).optional(),
    parsedEvidence: z.string().trim().max(20_000).optional(),
    parseStatus: z.enum(["parsed", "failed"]).optional(),
    sourceFilename: z.string().trim().max(240).optional()
    ,priceBoundary: z.string().trim().max(500).optional()
    ,customerConcern: z.string().trim().max(1_000).optional()
    ,communicationStage: z.string().trim().max(200).optional()
    ,allowedNextAction: z.string().trim().max(500).optional()
    ,city: z.string().trim().max(80).optional()
    ,storeFacts: z.string().trim().max(500).optional()
    ,contentAngle: z.string().trim().max(300).optional()
    ,prohibitedContent: z.string().trim().max(500).optional()
  }).strict().optional(),
  topicWorkflow: topicWorkflowSchema.optional(),
  contentWorkflow: contentWorkflowSchema.optional(),
  videoContentWorkflow: beautyVideoContentWorkflowSchema.optional(),
  liveReviewWorkflow: beautyLiveReviewWorkflowSchema.optional(),
  sourceRunId: z.string().trim().min(1).max(200).optional(),
  requestId: z.string().trim().min(8).max(200),
  conversationId: z.string().trim().min(1).max(200).optional(),
  deviceScope: z.enum(["desktop", "mobile"]).default("desktop")
}).strict().superRefine((value, ctx) => {
  if (value.toolName === "beauty.topic_ideas" && !value.topicWorkflow) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["topicWorkflow"], message: "选题系统需要获客目标与四来源资料。" });
  }
  if (value.toolName !== "beauty.topic_ideas" && value.topicWorkflow) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["topicWorkflow"], message: "当前能力不接受选题来源资料。" });
  }
  if (value.toolName === "beauty.content_ten_pack" && !value.contentWorkflow) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["contentWorkflow"], message: "内容十件套需要本次选题、目标顾客、目标和平台。" });
  }
  if (value.toolName !== "beauty.content_ten_pack" && value.contentWorkflow) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["contentWorkflow"], message: "当前能力不接受内容十件套工作流资料。" });
  }
  if (value.toolName === "beauty.video_content_review" && !value.videoContentWorkflow) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["videoContentWorkflow"], message: "视频内容复盘需要正式画面与口播证据。" });
  }
  if (value.toolName !== "beauty.video_content_review" && value.videoContentWorkflow) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["videoContentWorkflow"], message: "当前能力不接受视频内容复盘工作流资料。" });
  }
  if (value.toolName === "beauty.live_review" && !value.liveReviewWorkflow) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["liveReviewWorkflow"], message: "直播复盘需要当前场次的数据或转写及结构化事实边界。" });
  }
  if (value.toolName !== "beauty.live_review" && value.liveReviewWorkflow) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["liveReviewWorkflow"], message: "当前能力不接受直播复盘工作流资料。" });
  }
});

const profileSchema = z.object({
  segment: z.enum(BEAUTY_SEGMENTS),
  customSegment: z.string().trim().max(80).optional().default(""),
  operationType: z.enum(["single_store", "chain_brand"]).default("single_store"),
  operatingStage: z.enum(["startup", "growth", "stable", "adjustment"]).default("growth"),
  storeName: z.string().trim().max(120).optional().default(""),
  city: z.string().trim().max(80).optional().default(""),
  services: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
  targetCustomers: z.string().trim().max(500).optional().default(""),
  channels: z.array(z.string().trim().min(1).max(80)).max(12).default([]),
  acquisitionGoal: z.string().trim().max(500).optional().default(""),
  factBoundaries: z.string().trim().max(1_000).optional().default("")
}).strict().superRefine((value, ctx) => {
  if (value.segment === "other" && !value.customSegment) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["customSegment"], message: "选择其他时请填写具体美业方向" });
  }
  if (value.segment === "medical_beauty" && !value.factBoundaries) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["factBoundaries"], message: "医疗美容必须确认资质与事实边界" });
  }
});

export async function registerBeautyIndustryRoutes(app: FastifyInstance, provider: LlmProvider): Promise<void> {
  await registerBeautyIndustryMediaRoutes(app);
  app.get("/beauty-industry/daily-brief", async (request, reply) => {
    const context = await resolveRequestContext(request.headers);
    const parsed = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).safeParse(request.query ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "invalid_business_date", message: "日期必须使用北京时间 YYYY-MM-DD。" });
    return readBeautyDailyBriefState({ businessDate: parsed.data.date, includeReport: true });
  });

  app.get("/beauty-industry/daily-brief/history", async (request, reply) => {
    await resolveRequestContext(request.headers);
    const parsed = z.object({ limit: z.coerce.number().int().min(1).max(366).default(31) }).safeParse(request.query ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "invalid_history_query" });
    return { timeZone: BEAUTY_DAILY_BRIEF_TIME_ZONE, reports: await listBeautyDailyBriefHistory(parsed.data.limit) };
  });

  app.post("/beauty-industry/daily-brief", async (request, reply) => {
    if (rejectBeautyIndustryBrandOverride(request.body, reply)) return;
    const context = await resolveRequestContext(request.headers);
    if (!context.role || !["owner", "admin"].includes(context.role)) return reply.code(403).send({ error: "daily_brief_retry_forbidden", message: "只有当前租户管理员可以发起受权人工重试。" });
    const parsed = z.object({ action: z.enum(["generate", "retry"]).default("generate"), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "invalid_daily_brief_request", details: parsed.error.flatten() });
    const clock = readBeautyDailyBriefClock();
    const businessDate = parsed.data.date ?? clock.businessDate;
    if (businessDate > clock.businessDate) return reply.code(422).send({ error: "future_business_date_forbidden", message: "不能提前生成未来业务日期的日报。" });
    let queued;
    try {
      queued = parsed.data.action === "retry"
        ? await retryBeautyDailyBrief({ tenantId: context.tenantId, userId: context.userId, businessDate })
        : await enqueueBeautyDailyBrief({ tenantId: context.tenantId, userId: context.userId, businessDate, trigger: "manual" });
    } catch (error) {
      const code = error instanceof Error ? error.message : "beauty_daily_brief_failed";
      if (code === "beauty_daily_brief_not_enabled") return reply.code(409).send({ error: code, message: "真实来源和持续运行尚未放行，当前不会创建外部请求或扣费。" });
      if (code.includes("retry")) return reply.code(409).send({ error: code, message: "当前终态不允许自动追加调用，请核对状态和授权后再处理。" });
      throw error;
    }
    if (!queued.reused) void processBeautyDailyBriefSnapshot(queued.snapshotId);
    return reply.code(202).send({
      accepted: true,
      reused: queued.reused,
      snapshotId: queued.snapshotId,
      status: queued.status,
      capabilityId: "beauty_daily_brief",
      timeZone: "Asia/Shanghai",
      providerCallsAtAcceptance: 0,
      networkRequestsAtAcceptance: 0
    });
  });
  app.post("/beauty-industry/video-content/preflight", async (request, reply) => {
    const context = await resolveRequestContext(request.headers);
    const agent = await getRuntimeAgent("agent_beauty_acquisition");
    await assertAgentAccess(context, agent);

    let requestId = "";
    let workflowValue: unknown;
    let filename = "";
    let mimeType = "";
    let buffer: Buffer | undefined;
    try {
      for await (const part of request.parts({ limits: { files: 1, fields: 2, fileSize: env.ALIYUN_MEDIA_BASE64_MAX_MB * 1024 * 1024 } })) {
        if (part.type === "file") {
          filename = part.filename || "upload.bin";
          mimeType = part.mimetype || "application/octet-stream";
          buffer = await part.toBuffer();
          continue;
        }
        if (part.fieldname === "requestId" && typeof part.value === "string") requestId = part.value.trim();
        if (part.fieldname === "workflow" && typeof part.value === "string") workflowValue = JSON.parse(part.value);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (/file too large|limit/i.test(message)) {
        return reply.code(413).send({ error: "beauty_video_content_file_too_large", message: `视频不得超过 ${env.ALIYUN_MEDIA_BASE64_MAX_MB}MB；请在本地压缩或裁剪后重新上传。` });
      }
      return reply.code(400).send({ error: "invalid_beauty_video_content_preflight", message: "上传请求无法读取；请重新选择视频，不会调用 Provider 或扣费。" });
    }
    if (!/^[A-Za-z0-9_-]{8,200}$/.test(requestId)) {
      return reply.code(400).send({ error: "invalid_beauty_video_content_request_id", message: "预检请求号无效，请刷新页面后重试。" });
    }
    let workflow;
    try {
      workflow = readBeautyVideoContentWorkflow(workflowValue);
    } catch {
      return reply.code(400).send({ error: "invalid_beauty_video_content_workflow", message: "请先填写平台、视频标题、业务目标和目标人群。" });
    }
    if (workflow.version !== BEAUTY_VIDEO_CONTENT_WORKFLOW_VERSION || workflow.mediaPreflight) {
      return reply.code(409).send({ error: "beauty_video_content_preflight_state_invalid", message: "请使用当前页面重新选择原始视频预检，不能提交旧回执或客户端伪造解析状态。" });
    }
    if (!buffer) return reply.code(400).send({ error: "beauty_video_content_file_required", message: "请选择一个真实视频文件后再预检。" });

    try {
      const preflight = await inspectBeautyVideoContentFile({
        tenantId: context.tenantId,
        requestId,
        filename,
        mimeType,
        buffer,
        maxBytes: env.ALIYUN_MEDIA_BASE64_MAX_MB * 1024 * 1024
      });
      request.log.info({
        event: "beauty_video_content.preflight_terminal",
        status: "metadata_ready_evidence_required",
        byteSize: preflight.byteSize,
        durationSeconds: preflight.durationSeconds,
        providerCalls: 0,
        creditCost: 0,
        retainedMedia: false
      }, "beauty video content preflight completed without provider");
      return {
        productCode: "beauty-industry",
        status: "metadata_ready_evidence_required",
        preflight,
        providerCalls: 0,
        creditCost: 0,
        message: "格式与元数据预检已完成；视频临时文件已删除。预检没有调用视觉或 ASR；请补齐当前视频的真实口播与画面证据后开始正式复盘。"
      };
    } catch (error) {
      const code = error instanceof Error ? error.message : "beauty_video_content_metadata_invalid";
      const messages: Record<string, string> = {
        beauty_video_content_type_invalid: "只接受 MP4、MOV、M4V 或 WebM 视频；请从剪辑软件导出后重新上传。",
        beauty_video_content_empty_file: "视频文件为空；请检查导出是否完成后重新选择。",
        beauty_video_content_file_too_large: `视频不得超过 ${env.ALIYUN_MEDIA_BASE64_MAX_MB}MB；请在本地压缩或裁剪后重新上传。`,
        beauty_video_content_metadata_invalid: "视频元数据无法读取；请确认文件可正常播放并重新导出。"
      };
      return reply.code(code === "beauty_video_content_file_too_large" ? 413 : 422).send({
        error: code in messages ? code : "beauty_video_content_metadata_invalid",
        message: messages[code] ?? messages.beauty_video_content_metadata_invalid,
        providerCalls: 0,
        creditCost: 0
      });
    }
  });

  app.get("/beauty-industry/profile", async (request) => {
    const context = await resolveRequestContext(request.headers);
    const agent = await getRuntimeAgent("agent_beauty_acquisition");
    await assertAgentAccess(context, agent);
    return { productCode: "beauty-industry", profile: readBeautyIndustryProfileFromTenantData(context.profile.data) };
  });

  app.put("/beauty-industry/profile", async (request, reply) => {
    if (rejectBeautyIndustryBrandOverride(request.body, reply)) return;
    const parsed = profileSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "invalid_beauty_profile", details: parsed.error.flatten() });
    const context = await resolveRequestContext(request.headers);
    const agent = await getRuntimeAgent("agent_beauty_acquisition");
    await assertAgentAccess(context, agent);
    if (context.source !== "database") return reply.code(409).send({ error: "beauty_profile_requires_database", message: "当前演示环境不能保存门店档案。" });
    const profile = await saveBeautyIndustryProfile({ tenantId: context.tenantId, input: parsed.data });
    return { productCode: "beauty-industry", saved: true, profile };
  });

  app.delete("/beauty-industry/profile", async (request, reply) => {
    const context = await resolveRequestContext(request.headers);
    const agent = await getRuntimeAgent("agent_beauty_acquisition");
    await assertAgentAccess(context, agent);
    if (context.source !== "database") return reply.code(409).send({ error: "beauty_profile_requires_database", message: "当前演示环境不能删除门店档案。" });
    await deleteBeautyIndustryProfile(context.tenantId);
    return { productCode: "beauty-industry", deleted: true };
  });

  app.get("/beauty-industry/acquisition", async (request) => {
    const context = await resolveRequestContext(request.headers);
    const agent = await getRuntimeAgent("agent_beauty_acquisition");
    await assertAgentAccess(context, agent);
    const [account, latestRuns] = context.source === "database"
      ? await Promise.all([
          prisma.creditAccount.findUnique({ where: { tenantId: context.tenantId }, select: { balance: true } }),
          prisma.agentRun.findMany({
            where: { tenantId: context.tenantId, userId: context.userId, productCode: "beauty-industry", status: "succeeded" },
            orderBy: { createdAt: "desc" },
            take: 3,
            select: { id: true, capabilityId: true, usageChannel: true, createdAt: true }
          })
        ])
      : [null, []];
    const profile = readBeautyIndustryProfileFromTenantData(context.profile.data);
    const brandContext = resolveBeautyIndustryBrandContext(context.profile.data);
    const scopes = [...BEAUTY_INDUSTRY_SCOPES] as BeautyIndustryScope[];
    return {
      productCode: "beauty-industry",
      productName: "美业智能体",
      brand: toBeautyIndustryPublicBrand(brandContext),
      section: "acquisition",
      sectionName: "获客",
      localAcceptance: isLocalRequest(request.headers.host),
      executionMode: isControlledMockProvider(provider) ? "controlled_mock" : "configured_provider",
      creditBalance: account?.balance ?? context.creditBalance,
      workspaceScope: tenantScope(context.tenantId),
      tenantRole: context.role,
      enterpriseBase: {
        enterpriseName: context.profile.tenantName,
        brandName: context.profile.tenantName,
        city: context.profile.city ?? null,
        storeCount: null,
        source: "account"
      },
      recommendationMode: latestRuns.length ? "today" : "start",
      todayActions: buildBeautyTodayActions(profile, latestRuns),
      lastProgress: latestRuns[0] ?? null,
      tools: listBeautyIndustryMcpTools({
        credentialId: "web-session",
        tenantId: context.tenantId,
        userId: context.userId,
        productCode: "beauty-industry",
        operatingEntityId: context.tenantId,
        scopes,
        entitled: true
      })
    };
  });

  app.get("/beauty-industry/acquisition/history", async (request) => {
    const context = await resolveRequestContext(request.headers);
    const agent = await getRuntimeAgent("agent_beauty_acquisition");
    await assertAgentAccess(context, agent);
    if (context.source !== "database") return { runs: [] };
    const runs = await prisma.agentRun.findMany({
      where: {
        tenantId: context.tenantId,
        userId: context.userId,
        agentId: agent.id,
        productCode: "beauty-industry",
        status: "succeeded",
        output: { not: null }
      },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        capabilityId: true,
        skillId: true,
        input: true,
        output: true,
        creditCost: true,
        usageChannel: true,
        conversationId: true,
        qualityFlags: true,
        createdAt: true
      }
    });
    return {
      runs: runs.map((run) => {
        const preview = readBeautyDeliveryPreview(run.qualityFlags) ?? isControlledMockProvider(provider);
        const { qualityFlags: _qualityFlags, ...publicRun } = run;
        return ({
        ...publicRun,
        taskSnapshot: run.capabilityId === "beauty_xiaohongshu_package" ? readBeautyXhsTaskSnapshot(run.input) : undefined,
        structuredDelivery: run.capabilityId === "beauty_xiaohongshu_package"
          ? tryParseBeautyXhsDelivery(run.output ?? "", preview)
          : run.capabilityId === "content_plan"
            ? tryParseBeautyContentDelivery(run.output ?? "", preview)
            : run.capabilityId === "beauty_sales"
              ? tryParseBeautySalesDelivery(run.output ?? "", preview, /【使用模式】[\s\S]{0,160}专业模式/u.test(run.input ?? "") ? "professional_advice" : "quick_response")
            : undefined
        });
      })
    };
  });

  app.post("/beauty-industry/acquisition/runs", async (request, reply) => {
    if (rejectBeautyIndustryBrandOverride(request.body, reply)) return;
    const parsed = runSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "invalid_beauty_acquisition_request", details: parsed.error.flatten() });
    const executionScope = createRequestExecutionScope({
      requestRaw: request.raw,
      replyRaw: reply.raw,
      timeoutMs: env.SKILL_MCP_INVOKE_TIMEOUT_MS,
      timeoutCode: "beauty_web_timed_out"
    });
    try {
      const context = await resolveRequestContext(request.headers);
      const agent = await getRuntimeAgent("agent_beauty_acquisition");
      await assertAgentAccess(context, agent);
      const tool = getBeautyIndustryToolRegistration(parsed.data.toolName);
      assertBeautyIndustryToolOptions(parsed.data.toolName, parsed.data.professionalOptions);
      const profile = readBeautyIndustryProfileFromTenantData(context.profile.data);
      const sourceRun = parsed.data.sourceRunId
        ? await loadBeautySourceRun(context.tenantId, context.userId, agent.id, parsed.data.sourceRunId)
        : null;
      if (sourceRun) assertBeautySourceTransition(sourceRun.capabilityId, parsed.data.toolName);
      const requestId = `beauty-web:${tenantScope(context.tenantId)}:${parsed.data.requestId}`;
      const requestFingerprint = fingerprint({
        toolName: parsed.data.toolName,
        question: parsed.data.question,
        confirmedFacts: parsed.data.confirmedFacts ?? "",
        profileVersion: profile?.version ?? 0,
        profileConfirmedAt: profile?.confirmedAt ?? null,
        mode: parsed.data.mode,
        professionalOptions: parsed.data.professionalOptions ?? null,
        topicWorkflow: parsed.data.topicWorkflow ?? null,
        contentWorkflow: parsed.data.contentWorkflow ?? null,
        videoContentWorkflow: parsed.data.videoContentWorkflow ?? null,
        liveReviewWorkflow: parsed.data.liveReviewWorkflow ?? null,
        conversationId: parsed.data.conversationId ?? "",
        deviceScope: parsed.data.deviceScope
        ,sourceRunId: sourceRun?.id ?? ""
      });
      const result = await executeBeautyIndustryProductTool({
        context,
        agent,
        provider,
        requestId,
        requestFingerprint,
        operatingEntityId: context.tenantId,
        channel: "web",
        capabilityId: tool.capabilityId,
        skillId: tool.skillId,
        input: parsed.data.question,
        mode: parsed.data.mode,
        professionalOptions: parsed.data.professionalOptions,
        topicWorkflow: parsed.data.topicWorkflow,
        contentWorkflow: parsed.data.contentWorkflow,
        videoContentWorkflow: parsed.data.videoContentWorkflow,
        liveReviewWorkflow: parsed.data.liveReviewWorkflow,
        oneOffConfirmedFacts: parsed.data.confirmedFacts,
        priorTaskContext: sourceRun ? {
          runId: sourceRun.id,
          capabilityId: sourceRun.capabilityId ?? "unknown",
          output: parsed.data.contentWorkflow
            ? buildBeautyContentSourceSummary(parsed.data.contentWorkflow)
            : sourceRun.output ?? ""
        } : undefined,
        conversationId: parsed.data.conversationId ?? sourceRun?.conversationId ?? undefined,
        deviceScope: parsed.data.deviceScope,
        signal: executionScope.signal
      });
      return {
        status: result.status,
        answerText: result.text,
        agentRunId: result.runId,
        conversationId: result.conversationId,
        capabilityId: result.capabilityId,
        skillId: result.skillId,
        abilityUsed: result.abilityUsed,
        routeReceipt: result.routeReceipt,
        creditCost: result.creditCost,
        remainingCredits: result.remainingCredits,
        channel: "web"
        ,structuredDelivery: result.structuredDelivery
        ,sourceRunId: sourceRun?.id ?? null
        ,taskSnapshot: result.capabilityId === "beauty_xiaohongshu_package"
          ? buildBeautyXhsTaskSnapshot({ question: parsed.data.question, profile, professionalOptions: parsed.data.professionalOptions, confirmedFacts: parsed.data.confirmedFacts })
          : undefined
      };
    } catch (error) {
      return sendBeautyWebError(reply, error, executionScope.getAbortCode(), parsed.data.toolName);
    } finally {
      executionScope.dispose();
    }
  });
}

function buildBeautyTodayActions(
  profile: ReturnType<typeof readBeautyIndustryProfileFromTenantData>,
  latestRuns: Array<{ id: string; capabilityId: string | null; usageChannel: string | null; createdAt: Date }>
): Array<{ id: string; title: string; reason: string; toolName?: string; profileAction?: boolean }> {
  const actions: Array<{ id: string; title: string; reason: string; toolName?: string; profileAction?: boolean }> = [];
  if (!profile) {
    actions.push({ id: "profile", title: "确认美业经营档案", reason: "先确认细分赛道、核心项目和事实边界，后续网页与 WorkBuddy 才能复用。", profileAction: true });
  } else if (!profile.acquisitionGoal) {
    actions.push({ id: "goal", title: "补充本次获客目标", reason: "档案已有基础资料，但当前获客目标仍待确认。", profileAction: true });
  }
  const latest = latestRuns[0]?.capabilityId;
  const next = latest === "topic_inspiration"
    ? { id: "content", title: "把选题做成内容十件套", reason: "上次已完成选题，可继续生成完整内容十件套。", toolName: "beauty.content_ten_pack" }
    : latest === "beauty_xiaohongshu_package"
      ? { id: "topics", title: "继续做视频选题", reason: "已有图文结果，可进入视频获客选题系统。", toolName: "beauty.topic_ideas" }
      : latest === "content_plan"
        ? { id: "review", title: "进入视频数据复盘", reason: "已有内容十件套；取得真实视频数据并解析后再复盘。", toolName: "beauty.video_data_review" }
        : { id: "xhs", title: "生成一套小红书图文", reason: "从已确认门店档案出发，一次得到标题、正文、标签与配图方向。", toolName: "beauty.xiaohongshu_package" };
  actions.push(next);
  if (!latestRuns.length) {
    actions.push({ id: "video", title: "进入视频获客", reason: "从选题开始，依次推进内容十件套和有证据后的复盘。", toolName: "beauty.topic_ideas" });
    actions.push({ id: "live", title: "进入直播获客", reason: "先生成直播话术，有真实直播数据后再复盘。", toolName: "beauty.live_script" });
  }
  return actions.slice(0, 3);
}

async function loadBeautySourceRun(tenantId: string, userId: string, agentId: string, sourceRunId: string) {
  const run = await prisma.agentRun.findFirst({
    where: {
      id: sourceRunId,
      tenantId,
      userId,
      agentId,
      productCode: "beauty-industry",
      status: "succeeded"
    },
    select: { id: true, capabilityId: true, output: true, conversationId: true }
  });
  if (!run?.output) throw new Error("beauty_source_run_not_found");
  return run;
}

function sendBeautyWebError(reply: FastifyReply, error: unknown, abortCode?: string, toolName?: string): FastifyReply {
  if (abortCode === "beauty_web_timed_out") return reply.code(504).send({ error: abortCode, category: "timeout", message: "本次生成已在安全时限内停止，不会自动重试或重复扣费；当前资料仍保留，可稍后重新发起。" });
  if (abortCode === "client_disconnected") return reply.code(499).send({ error: "beauty_web_cancelled", category: "cancelled", message: "本次生成已取消，已预留积分会自动释放。" });
  if (error instanceof AgentClarificationRequired) return reply.code(422).send({ error: "beauty_information_required", message: error.prompt });
  if (error instanceof InsufficientCreditsError || (error instanceof Error && error.message === "insufficient_credits")) return reply.code(402).send({ error: "insufficient_credits", message: "当前测试积分不足，未调用模型。" });
  if (error instanceof BillingRequestInProgressError) return reply.code(409).send({ error: error.message, message: "相同请求正在处理中，请等待当前结果。" });
  if (error instanceof BillingRequestPreviouslyFailedError) return reply.code(409).send({ error: error.message, message: "这个请求已经失败并释放积分，请修改内容后重新生成。" });
  if (error instanceof IdempotencyConflictError) return reply.code(409).send({ error: "request_id_conflict", message: "请求号已用于不同内容，请重新发起。" });
  const message = error instanceof Error ? error.message : "beauty_web_failed";
  if (message === "beauty_source_run_not_found") return reply.code(404).send({ error: message, message: "上一步任务不存在或不属于当前门店，未继续生成。" });
  if (message === "beauty_source_transition_forbidden") return reply.code(409).send({ error: message, message: "当前结果不能进入这个下一步；请按所选分支流程继续。" });
  if (message.startsWith("beauty_tool_option_forbidden:")) return reply.code(400).send({ error: "beauty_tool_option_forbidden", message: "本次任务包含了其他分支的无关字段，请返回当前任务核对。" });
  if (message === "beauty_video_data_not_parsed") return reply.code(422).send({ error: message, message: "请先上传并成功解析 CSV 或 Excel；解析失败时不会假装读取数据。" });
  if (message === "beauty_video_data_empty") return reply.code(422).send({ error: message, message: "文件只有表头或没有可复盘的数值记录；请从平台后台重新导出包含作品数据的 CSV 或 Excel。未调用模型或扣费。" });
  if (message === "beauty_video_content_not_parsed") return reply.code(422).send({ error: message, message: "请先上传并完成视频画面、音频或转写解析；解析失败时不会声称看过视频。" });
  if (message.startsWith("beauty_sales_professional_fields_required:")) return reply.code(422).send({
    error: "beauty_sales_professional_information_required",
    category: "preflight",
    message: "专业模式请先补齐：本次项目、已确认价格或优惠边界、顾客原话或主要顾虑、沟通阶段、允许的下一步动作。补齐前不会调用模型或预留积分。"
  });
  if (message.startsWith("beauty_xhs_fields_required:")) {
    const missingKeys = message.slice("beauty_xhs_fields_required:".length).split(",").filter(Boolean);
    const labels: Record<string, string> = { themeAndPurpose: "本次主题与目的", project: "本次项目", audience: "目标顾客" };
    const missingFields = missingKeys.map((key) => labels[key] ?? key);
    console.warn(JSON.stringify({ event: "beauty_xhs_input_preflight_rejected", capabilityId: "beauty_xiaohongshu_package", skillId: "wechat-xhs-content-line", missingFields: missingKeys, providerCalls: 0, creditReservations: 0 }));
    return reply.code(422).send({
      error: "beauty_xhs_information_required",
      category: "preflight",
      missingFields,
      message: `请先补齐：${missingFields.join("、")}。这些信息决定文案的项目与人群，补齐前不会调用模型或预留积分。`
    });
  }
  if (message === "beauty_topic_workflow_required") return reply.code(422).send({ error: message, category: "preflight", message: "请先在选题工作区填写目标顾客、获客目标和细分赛道，并确认本轮要使用的来源；资料未进入正式合同前不会调用模型。" });
  if (message === "beauty_topic_workflow_forbidden") return reply.code(400).send({ error: message, message: "选题来源资料只能用于选题系统。" });
  if (message === "beauty_content_workflow_required") return reply.code(422).send({ error: message, message: "请在内容十件套工作区补齐选题、目标顾客、本轮目标和发布平台。" });
  if (message === "beauty_content_workflow_forbidden") return reply.code(400).send({ error: message, message: "内容任务简报只能用于内容十件套。" });
  if (message === "beauty_topic_sources_missing") return reply.code(422).send({ error: message, category: "preflight", message: "四类来源目前都没有可用资料，模型尚未调用、积分不会扣除。请在选题工作区至少启用并补齐一类：确认细分赛道、选择已确认录音、填写对标账号，或选择已解析的账号数据复盘；否则无法形成有依据的第一版。" });
  if (message === "beauty_topic_industry_conflict") return reply.code(422).send({ error: message, category: "preflight", message: "本轮细分赛道与已确认美业经营档案不一致；请到经营档案核对赛道，或返回选题工作区修正本轮行业。冲突会影响来源与事实边界，因此尚未调用模型。" });
  if (message.startsWith("beauty_topic_field_required:")) return reply.code(422).send({ error: "beauty_topic_information_required", category: "preflight", message: "请在选题工作区补充目标顾客、获客目标和细分赛道；这些字段决定 TOP10 的人群、承接与行业边界，补齐前不会调用模型。" });
  if (message === "beauty_text_budget_exceeded") return reply.code(422).send({ error: message, message: "本次资料超过受控文本预算，模型尚未调用、积分不会扣除；请缩短本次补充资料后再试。" });
  if (message === "beauty_text_budget_provider_call_limit") return reply.code(503).send({ error: message, message: "本次生成已到单次模型调用上限，不会自动重试或重复扣费；请稍后重新发起一项新任务。" });
  if (message === "beauty_text_budget_model_mismatch" || message === "beauty_text_budget_not_configured") return reply.code(503).send({ error: message, message: "当前文本模型预算配置未就绪，模型尚未调用、积分不会扣除。" });
  if (toolName === "beauty.topic_ideas") {
    const topicFailure = classifyBeautyTopicExecutionFailure(message);
    if (topicFailure) return reply.code(topicFailure.status).send(topicFailure);
  }
  if (message.startsWith("provider_failure:")) return reply.code(502).send({ error: message, category: "provider", message: "模型服务本次未完成，未自动重试；请稍后重新发起。" });
  if (message.startsWith("beauty_workflow_output_")) {
    return reply.code(502).send({
      error: "beauty_output_contract_failed",
      category: "validation",
      retryable: false,
      message: "系统未生成有效结果，积分已退回，无需重复点击。当前输入与已上传资料仍保留；请等待测试环境修复后再生成。"
    });
  }
  console.warn(JSON.stringify({
    event: "beauty_web_unclassified_failure",
    toolName: toolName ?? "unknown",
    errorCode: message.slice(0, 160)
  }));
  return reply.code(500).send({ error: "beauty_web_failed", message: "美业获客服务暂时不可用，请稍后重试。" });
}

function tenantScope(tenantId: string): string {
  return createHash("sha256").update(tenantId).digest("hex").slice(0, 16);
}

function rejectBeautyIndustryBrandOverride(value: unknown, reply: FastifyReply): boolean {
  try {
    assertNoBeautyIndustryBrandOverride(value);
    return false;
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "beauty_brand_override_forbidden") throw error;
    void reply.code(400).send({
      error: "beauty_brand_override_forbidden",
      message: "品牌由当前租户和产品授权决定，客户端不能覆盖。"
    });
    return true;
  }
}

function assertBeautySourceTransition(sourceCapabilityId: string | null, targetToolName: string): void {
  const allowed: Record<string, readonly string[]> = {
    topic_inspiration: ["beauty.content_ten_pack"],
    content_plan: ["beauty.video_data_review"],
    video_data_review: ["beauty.topic_ideas"],
    live_script: ["beauty.live_review"],
    live_review: ["beauty.live_script"],
    beauty_xiaohongshu_package: ["beauty.topic_ideas", "beauty.xiaohongshu_package"]
  };
  if (!sourceCapabilityId || !allowed[sourceCapabilityId]?.includes(targetToolName)) {
    throw new Error("beauty_source_transition_forbidden");
  }
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function isLocalRequest(host: string | undefined): boolean {
  return Boolean(host && /^(?:127\.0\.0\.1|localhost)(?::\d+)?$/i.test(host));
}

function isControlledMockProvider(provider: LlmProvider): boolean {
  const configured = provider as LlmProvider & { isConfigured?: () => boolean };
  return process.env.LLM_MOCK_MODE === "true" || process.env.USE_MOCK_LLM === "true" || configured.isConfigured?.() === false;
}

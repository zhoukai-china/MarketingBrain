import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AgentResponse, LlmProvider } from "@baolu/agent";
import { prisma } from "@baolu/db";
import { inferAcquisitionCapabilities, inferRestaurantCapabilities, inferSalesCapabilities, normalizeBusinessInput, type SkillId } from "@baolu/shared";
import { SKILL_MANIFESTS } from "@baolu/skills";
import { env } from "../config/env.js";
import {
  AgentAccessError,
  AgentClarificationRequired,
  assertAgentAccess,
  getRuntimeAgent,
  isInsufficientCredits,
  loadAgentRunReplay,
  listRuntimeAgents
} from "../services/agent-runtime.js";
import { invokeSkillViaGateway, McpUnavailableError } from "../services/mcp-client.js";
import {
  AgentExecutionCancelledError,
  buildExecutionPlan,
  combineExecutionResults,
  executeExecutionPlan
} from "../services/agent-orchestrator.js";
import { buildIpVoiceStyleProfile } from "../services/ip-voice-style.js";
import { IdempotencyConflictError, persistChatResult } from "../services/chat-persistence.js";
import { getDemoContext } from "../services/demo-context.js";
import { resolveRequestContext, type RequestContext } from "../services/request-context.js";
import { buildTopicClarificationPrompt } from "../services/topic-clarification.js";
import { createRequestFingerprint } from "../services/request-fingerprint.js";
import { buildStableAgentDelivery, resolveReasoningProfile } from "../services/structured-delivery.js";
import { buildIpCapabilityIntelContext } from "./chat.js";
import { resolveAcquisitionWorkbenchCapability } from "../services/acquisition-workbench-routing.js";

// The shared agent package is excluded from tsx watch; route edits force local API reloads after orchestration changes.
import {
  buildAgentKnowledgeRunContext,
  buildKnowledgeAgentSystemPrompt,
  isAcquisitionKnowledgePackageRequest,
  loadAutomaticKnowledgeDocuments,
  resolveKnowledgeSubjectForRun,
  loadKnowledgeDocuments
} from "./knowledge-base.js";

const runSchema = z.object({
  requestId: z.string().min(8).max(100),
  input: z.string().trim().min(1).max(50_000),
  routingInput: z.string().trim().min(1).max(8_000).optional(),
  capabilityId: z.string().min(1).max(100).optional(),
  capabilityIds: z.array(z.string().min(1).max(100)).min(2).max(3).optional(),
  capabilitySelectionMode: z.enum(["auto", "explicit"]).optional(),
  skillId: z.string().min(1).max(120).optional(),
  conversationId: z.string().min(1).optional(),
  deviceScope: z.enum(["desktop", "mobile"]).default("desktop"),
  history: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    // Accept long answers produced by an earlier turn. The route compacts them
    // before they reach the model so an otherwise healthy follow-up is not
    // rejected merely because the previous delivery was comprehensive.
    content: z.string().min(1).max(50_000)
  })).max(12).optional(),
  knowledgeDocumentIds: z.array(z.string().min(1).max(120)).min(1).max(100).optional(),
  knowledgeSubjectId: z.string().min(1).max(120).optional(),
  knowledgeIdentityContext: z.string().trim().max(1_000).optional(),
  knowledgeBusinessGoal: z.string().trim().max(1_000).optional(),
  knowledgeFactCorrections: z.string().trim().max(1_000).optional(),
  taskCustomerProfile: z.object({
    name: z.string().trim().max(120).optional(),
    industry: z.string().trim().max(160).optional(),
    targetCustomer: z.string().trim().max(300).optional(),
    city: z.string().trim().max(80).optional(),
    storeScale: z.string().trim().max(120).optional(),
    currentProblem: z.string().trim().max(500).optional(),
    growthGoal: z.string().trim().max(500).optional(),
    platforms: z.string().trim().max(300).optional()
  }).optional()
});

const trialStartSchema = z.object({
  deviceId: z.string().min(8).max(200)
});

const trialRunSchema = z.object({
  requestId: z.string().min(8).max(100),
  token: z.string().min(24).max(200),
  input: z.string().trim().min(1).max(20_000),
  capabilityId: z.string().min(1).max(100),
  deviceScope: z.enum(["desktop", "mobile"]).default("desktop"),
  history: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().min(1).max(8_000)
  })).max(4).optional()
});

const trialClaimSchema = z.object({
  token: z.string().min(24).max(200),
  deviceScope: z.enum(["desktop", "mobile"]).default("desktop")
});

function buildInputNormalizationContext(originalInput: string, normalizedInput: string): string | undefined {
  if (originalInput === normalizedInput) return undefined;
  if (!originalInput.includes("抖音") && normalizedInput.includes("抖音")) {
    return "【系统实体归一化】已根据平台、账号与竞品语境，把用户输入中的语音转写/输入法近似词识别为“抖音”。不得再次追问发布平台；如果用户要求确认识别结果，直接说明已识别为抖音。";
  }
  return "【系统实体归一化】已将用户输入中的平台近似词转换为标准平台名称。后续检索、分析和回答以标准名称为准，不要再次追问已确认的平台。";
}

export function extractUserRoutingInput(input: string, routingInput?: string): string {
  const source = routingInput?.trim() || input.split(/【本次用户上传\/粘贴的附件】|【业务文件解析结果】/)[0]?.trim() || input;
  return normalizeBusinessInput(source);
}

export function inferAcquisitionRoutingCapability(input: string): string | undefined {
  return inferAcquisitionCapabilities(input)[0];
}

/**
 * Keep takeaway routing server-authoritative so free-form questions work even
 * when the user has not clicked a capability chip first. More specific
 * operating tasks intentionally win over the generic growth diagnosis.
 */
export function inferTakeawayRoutingCapability(input: string): string | undefined {
  const normalized = normalizeBusinessInput(input).replace(/\s+/g, "");
  if (!normalized) return undefined;
  if (/周期复盘|复盘|测试期.{0,12}(?:结果|效果|基线)|继续、?调整、?停止|是否有效|是否增长/.test(normalized)) return "takeaway_review";
  if (/单变量|A\/?B|增长实验|创建实验|止损|基线期|排除日|测试期/.test(normalized)) return "takeaway_experiment";
  if (/流失竞品|流失品牌|流失品类|竞对|竞争品牌|被.{0,8}(?:抢走|分流)/.test(normalized)) return "takeaway_competitor_loss";
  if (/活动投放|投放|广告|推广通|神枪手|超枪手|ROI|补贴效率|预算.{0,8}(?:消耗|订单)/i.test(normalized)) return "takeaway_campaign_roi";
  if (/数据口径|字段映射|订单明细|日报|数据审计|数据完整|识别不了/.test(normalized)) return "takeaway_data_audit";
  if (/经营数据底座|数据底座|数据导入|导入.{0,8}(?:表格|文件|数据)/.test(normalized)) return "takeaway_data_foundation";
  if (/新店|新开|开业|冷启动|上线.{0,6}(?:天|周|月)|首月|首周|起量/.test(normalized)) return "new_store_breakthrough";
  if (/老店|成熟店|成熟门店|历史基线|近(?:30|60|90)天|增长瓶颈|兄弟门店/.test(normalized)) return "mature_store_growth";
  if (/SKU|菜单|菜品|货盘|价格带|客单价|满减|套餐|长尾|爆款|毛利|利润|加价购|凑单|上下架|砍掉/i.test(normalized)) return "takeaway_menu_profit";
  if (/外卖|美团|饿了么|淘宝闪购|订单|进店|曝光|转化|履约|复购/.test(normalized)) return "takeaway_growth";
  return undefined;
}

export function resolveAgentProductDeliveryPolicy(agentSlug: string): "clarify" | "draft_with_placeholders" {
  return agentSlug === "acquisition" || agentSlug === "takeaway-growth" || agentSlug === "restaurant-growth"
    ? "draft_with_placeholders"
    : "clarify";
}

export function asksForHotspotContentAsset(input: string): boolean {
  return /文案|脚本|口播|逐字稿|内容执行包|完整成品|拍摄方案|剪辑方案|短视频(?:成品|文案|脚本)/.test(input);
}

/**
 * Brand acquisition owns content-platform growth. Restaurant platform operations
 * (orders, menu, fulfilment and conversion) stay in the restaurant agent so a
 * user never receives a blended, unaccountable plan from the wrong workspace.
 */
export function requiresRestaurantGrowthAgent(input: string): boolean {
  const normalized = normalizeBusinessInput(input).replace(/\s+/g, "");
  const restaurantPlatform = /美团|饿了么|淘宝闪购|外卖平台|外卖店|外卖订单|外卖运营|配送(?:范围|费|时效)?|骑手/.test(normalized);
  const operationsGoal = /外卖(?:订单|销售额|运营|增长)|店铺(?:访问|进店|转化|排名)|商品(?:点击|曝光)|菜单|套餐|加购|结算|履约|复购|平台活动|满减|配送/.test(normalized);
  return restaurantPlatform && operationsGoal;
}

function restaurantGrowthRedirectMessage(): string {
  return "这属于外卖经营问题：平台订单、菜单、活动、店铺转化、配送、利润与复购，请进入“思潼·外卖增长智能体”处理。系统会先核对数据口径，再给出需要总部审批、门店执行并回传结果的增长实验。";
}

function acquisitionContentBoundaryDirective(): string {
  return "【品牌获客智能体边界】本任务只交付选题、短视频、直播、朋友圈、内容投流或内容复盘。即使用户属于餐饮行业，也不得诊断或优化美团、饿了么、淘宝闪购等外卖平台的订单、菜单、价格、活动、配送、店铺转化或复购；若这些信息只是背景，只保留为背景，不把它们写成方案动作或指标。";
}

function singleTaskFactRetentionDirective(): string {
  return "【单任务事实保留】交付正文必须准确出现用户原文中已明确给出的品牌/客户名称、行业、对象与目标；不得把品牌名替换成“当前品牌”“某餐饮店”等泛称。信息未提供时仅对缺失字段使用【待补】，绝不遗漏已提供的事实。";
}

function inferCeoCockpitCapability(input: string): "daily_push" | "business_map" | "decision_center" | "command_center" {
  const normalized = input.replace(/\s+/g, "");
  if (/行动令|下达任务|责任角色|责任人|截止时间|验收标准|执行回流|确认完成|执行受阻/.test(normalized)) return "command_center";
  if (/老板决策|待决|拍板|方案比较|比较方案|批准|驳回|收益.*风险|风险.*收益/.test(normalized)) return "decision_center";
  if (/经营地图|异常诊断|下钻|门店对比|项目对比|业务对比|问题在哪|原因在哪/.test(normalized)) return "business_map";
  return "daily_push";
}

// Media analysis must be grounded in an actual attachment or user-supplied metrics retained across the current task.
function hasUploadedEvidence(input: string, history?: Array<{ role: "user" | "assistant"; content: string }>): boolean {
  return [input, ...(history ?? []).filter((message) => message.role === "user").map((message) => message.content)]
    .some((content) => /【本次用户上传\/粘贴的附件】|【业务文件解析结果】/.test(content));
}

function hasVideoPerformanceMetrics(input: string, history?: Array<{ role: "user" | "assistant"; content: string }>): boolean {
  const source = [input, ...(history ?? []).filter((message) => message.role === "user").map((message) => message.content)].join("\n");
  const metricCount = [/(?:播放量|曝光量|推荐量)[：:]?\s*[\d,.万]+/, /完播率[：:]?\s*[\d.]+%/, /平均播放(?:时长)?[：:]?\s*[\d.]+/, /(?:点赞|评论|分享|转发|关注)[：:]?\s*[\d,.万]+/]
    .filter((pattern) => pattern.test(source)).length;
  return metricCount >= 2;
}

function hasLivePerformanceMetrics(input: string, history?: Array<{ role: "user" | "assistant"; content: string }>): boolean {
  const source = [input, ...(history ?? []).filter((message) => message.role === "user").map((message) => message.content)].join("\n");
  const metricCount = [/(?:场观|观看人数|累计观看)[：:]?\s*[\d,.万]+/, /(?:在线峰值|最高在线)[：:]?\s*[\d,.万]+/, /平均停留(?:时长)?[：:]?\s*[\d.]+/, /(?:成交|订单|GMV|留资|私信|涨粉)[：:]?\s*[\d,.万]+/]
    .filter((pattern) => pattern.test(source)).length;
  const hasTranscriptEvidence = /(?:录音转写|转写文本|逐字稿)[：:][\s\S]{8,}|(?:语速|停顿|冷场|断流|口癖)[：:\s]*[^\n]{2,}/.test(source);
  return metricCount >= 1 || hasTranscriptEvidence;
}

function assertRequiredAcquisitionEvidence(
  capabilityId: string | undefined,
  routingInput: string,
  fullInput: string,
  history?: Array<{ role: "user" | "assistant"; content: string }>
): void {
  if (!capabilityId) return;
  const uploaded = hasUploadedEvidence(fullInput, history);
  if (
    capabilityId === "shooting_editing" &&
    /(?:上传的|这条|该条|这个|该)(?:视频|素材)|(?:视频|素材).{0,10}(?:拍剪|拍摄|剪辑|优化|建议)|\.(?:mp4|mov|m4v|avi)\b/i.test(routingInput) &&
    !uploaded
  ) {
    throw new AgentClarificationRequired("请先上传需要优化的视频或素材文件。收到真实文件后，我会读取画面和转写，只给这条视频的拍摄、镜头与剪辑修改建议；在没有文件时不会假装已经看过视频。");
  }
  const isVideoReviewTextConsultation = /【视频复盘系统[｜|]文字咨询】/.test(fullInput);
  if (capabilityId === "video_review" && !isVideoReviewTextConsultation && !uploaded && !hasVideoPerformanceMetrics(fullInput, history)) {
    throw new AgentClarificationRequired("请先上传视频后台导出的 CSV/Excel，或直接粘贴至少两项真实指标（如播放量、完播率、平均播放时长、互动数据）。没有数据时我不会输出占位复盘或虚构结论。");
  }
  const isLiveReviewTextConsultation = /【直播复盘系统[｜|]文字咨询】/.test(fullInput);
  if (capabilityId === "live_review" && !isLiveReviewTextConsultation && !uploaded && !hasLivePerformanceMetrics(fullInput, history)) {
    throw new AgentClarificationRequired("请先上传直播后台数据文件，或粘贴真实后台指标/录音转写。完整复盘最好同时提供：后台数据、带时间戳的录音转写、原定话术计划；缺一类会降级对应模块，没有任何真实证据时不会生成假复盘。");
  }
}

function asksForFullKnowledgeCopy(input: string): boolean {
  if (/只(?:给|要|写).{0,8}选题|不写.{0,6}文案|不要.{0,6}文案|朋友圈|公众号|小红书图文/.test(input)) return false;
  return /逐字稿|口播稿|口播文案|完整(?:的)?(?:短视频)?文案|可直接发布的文案|把.{0,24}选题.{0,16}写成.{0,8}文案/.test(input);
}

function hasCompleteSpokenCopy(answer: string): boolean {
  const spokenSection = answer.match(/(?:口播逐字稿|完整(?:短视频)?文案)[^\n]*\n([\s\S]*?)(?=\n(?:[三四五六七八九十]+、|\d+[.、]|拍摄|剪辑|发布)|$)/)?.[1] ?? answer;
  const characterCount = spokenSection
    .replace(/【[^】]+】|#{1,6}|\*\*/g, "")
    .replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, "")
    .length;
  return characterCount >= 280;
}

function hasCompleteContentPackage(answer: string): boolean {
  const requiredParts = [
    /选题(?:策划)?/,
    /口播逐字稿|口播文案/,
    /拍摄脚本|分镜脚本/,
    /拍摄注意事项|拍摄注意/,
    /剪辑\s*EDL|剪辑执行/,
    /发布标题.{0,8}话题|标题.{0,8}话题/,
    /发布时间/,
    /评论区(?:引导)?话术|评论区引导|评论承接/,
    /投流建议/
  ];
  return /完整内容执行包/.test(answer)
    && requiredParts.every((pattern) => pattern.test(answer))
    && hasCompleteSpokenCopy(answer);
}

function buildTaskSubjectPriorityContext(input: string): string {
  const externalClientTask = /(?:帮|替|给|为).{0,8}(?:我的|我们(?:的)?)?.{0,20}(?:客户|客户项目|品牌方|项目方|连锁品牌|加盟项目|门店).{0,24}(?:写|做|生成|策划|输出|创作)/.test(input)
    || /(?:客户|客户项目|品牌方|项目方|连锁品牌).{0,20}(?:招商|加盟).{0,12}(?:文案|内容|脚本|方案)/.test(input);
  if (externalClientTask) {
    return [
      "【本轮任务主体判断】用户正在为外部客户、品牌或项目创作。",
      "内容主体、发布视角、目标受众和转化动作必须按用户本次输入及所选资料中的该客户项目确定。",
      "当前企业画像只代表服务提供方背景，不得把文案结尾改成推广服务提供方自己的产品。客户项目关键信息不足时标待补，不得用当前企业产品替代。"
    ].join("\n");
  }
  return "【本轮任务主体判断】优先执行用户本次明确指定的内容主体、目标受众和转化目的；企业画像仅补充未冲突的背景事实。";
}

function mergeAgentProfileSupplements(
  context: RequestContext,
  supplements: {
    knowledgeIdentityContext?: string;
    knowledgeBusinessGoal?: string;
    knowledgeFactCorrections?: string;
  }
): RequestContext {
  const supplementalData = {
    ...(supplements.knowledgeIdentityContext ? { identityContext: supplements.knowledgeIdentityContext } : {}),
    ...(supplements.knowledgeBusinessGoal ? { businessGoal: supplements.knowledgeBusinessGoal } : {}),
    ...(supplements.knowledgeFactCorrections ? { factCorrections: supplements.knowledgeFactCorrections } : {})
  };
  if (Object.keys(supplementalData).length === 0) return context;
  return {
    ...context,
    profile: {
      ...context.profile,
      data: {
        ...(context.profile.data ?? {}),
        ...supplementalData
      }
    }
  };
}

function buildTaskCustomerProfileContext(profile: z.infer<typeof runSchema>["taskCustomerProfile"]): string | undefined {
  if (!profile || !Object.values(profile).some(Boolean)) return undefined;
  return [
    "【当前任务客户资料卡】以下是用户已确认或已保存的当前客户项目事实。优先级高于服务提供方的企业画像；不得把两者混用。",
    profile.name ? `客户/品牌：${profile.name}` : undefined,
    profile.industry ? `行业：${profile.industry}` : undefined,
    profile.targetCustomer ? `目标客户：${profile.targetCustomer}` : undefined,
    profile.city ? `城市：${profile.city}` : undefined,
    profile.storeScale ? `门店规模：${profile.storeScale}` : undefined,
    profile.currentProblem ? `当前经营问题：${profile.currentProblem}` : undefined,
    profile.growthGoal ? `本次增长目标：${profile.growthGoal}` : undefined,
    profile.platforms ? `主要平台：${profile.platforms}` : undefined,
    "资料卡未填写的字段仍按待补处理，不得自行编造。"
  ].filter(Boolean).join("\n");
}

export async function registerAgentProductRoutes(app: FastifyInstance, provider: LlmProvider): Promise<void> {
  app.get("/agents/catalog", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const agents = await listRuntimeAgents();
    const context = await resolveOptionalContext(request.headers);
    const entitlements = context ? await listEntitledAgentIds(context) : new Set<string>();
    return {
      agents: agents.map((agent) => publicAgent(agent, entitlements.has(agent.id))),
      authenticated: Boolean(context),
      defaultEntry: context ? resolveDefaultEntry(agents.filter((agent) => entitlements.has(agent.id))) : null
    };
  });

  app.get("/agents/me", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const context = await resolveRequestContext(request.headers);
    const agents = await listRuntimeAgents();
    const entitled = await listEntitledAgentIds(context);
    const visible = agents.filter((agent) => entitled.has(agent.id));
    return {
      agents: visible.map((agent) => publicAgent(agent, true)),
      allAgents: agents.map((agent) => publicAgent(agent, entitled.has(agent.id))),
      defaultEntry: resolveDefaultEntry(visible),
      creditBalance: context.creditBalance ?? 0
    };
  });

  app.get<{ Params: { slug: string }; Querystring: { deviceScope?: string } }>("/agents/:slug/latest-video-review", async (request, reply) => {
    const query = z.object({ deviceScope: z.enum(["desktop", "mobile"]).default("desktop") }).safeParse(request.query ?? {});
    if (!query.success) return reply.code(400).send({ error: "invalid_request", details: query.error.flatten() });
    const context = await resolveRequestContext(request.headers);
    const agent = await getRuntimeAgent(request.params.slug);
    await assertAgentAccess(context, agent);
    if (env.DATA_MODE === "demo") return { review: null };
    const review = await prisma.agentRun.findFirst({
      where: {
        tenantId: context.tenantId,
        agentId: agent.id,
        capabilityId: "video_review",
        deviceScope: query.data.deviceScope,
        status: "succeeded",
        output: { not: null }
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        output: true,
        createdAt: true,
        conversationId: true
      }
    });
    const conversation = review?.conversationId
      ? await prisma.conversation.findFirst({ where: { id: review.conversationId, tenantId: context.tenantId }, select: { title: true } })
      : null;
    return {
      review: review?.output ? {
        id: review.id,
        title: conversation?.title || "最近一次视频数据复盘",
        content: review.output,
        createdAt: review.createdAt
      } : null
    };
  });

  app.get<{ Params: { slug: string } }>("/agents/:slug", async (request) => {
    const agent = await getRuntimeAgent(request.params.slug);
    const context = await resolveOptionalContext(request.headers);
    const entitled = context ? (await listEntitledAgentIds(context)).has(agent.id) : false;
    return publicAgent(agent, entitled);
  });

  app.post<{ Params: { slug: string } }>("/agents/:slug/runs", async (request, reply) => {
    const parsed = runSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    const originalUserInput = parsed.data.input;
    parsed.data.input = normalizeBusinessInput(parsed.data.input);
    const routingInput = extractUserRoutingInput(parsed.data.input, parsed.data.routingInput);
    const inputNormalizationContext = buildInputNormalizationContext(originalUserInput, parsed.data.input);
    parsed.data.history = parsed.data.history?.map((message) => ({
      ...message,
      content: compactHistoryContent(
        message.role === "user" ? normalizeBusinessInput(message.content) : message.content
      )
    }));
    const runController = new AbortController();
    const abortRun = () => {
      if (!runController.signal.aborted) runController.abort(new Error("client_disconnected"));
    };
    const abortOnReplyClose = () => {
      if (!reply.raw.writableEnded) abortRun();
    };
    request.raw.once("aborted", abortRun);
    reply.raw.once("close", abortOnReplyClose);
    try {
      const context = await resolveRequestContext(request.headers);
      const runtimeContext = mergeAgentProfileSupplements(context, parsed.data);
      const taskCustomerContext = buildTaskCustomerProfileContext(parsed.data.taskCustomerProfile);
      const agent = await getRuntimeAgent(request.params.slug);
      await assertAgentAccess(context, agent);
      if (agent.slug === "acquisition" && requiresRestaurantGrowthAgent(routingInput)) {
        throw new AgentClarificationRequired(restaurantGrowthRedirectMessage());
      }
      const requestFingerprint = createRequestFingerprint({
        agentId: agent.id,
        input: parsed.data.input,
        routingInput,
        capabilityId: parsed.data.capabilityId,
        capabilityIds: parsed.data.capabilityIds,
        capabilitySelectionMode: parsed.data.capabilitySelectionMode,
        skillId: parsed.data.skillId,
        conversationId: parsed.data.conversationId,
        deviceScope: parsed.data.deviceScope,
        history: parsed.data.history,
        knowledgeDocumentIds: parsed.data.knowledgeDocumentIds?.slice().sort(),
        knowledgeSubjectId: parsed.data.knowledgeSubjectId,
        knowledgeIdentityContext: parsed.data.knowledgeIdentityContext,
        knowledgeBusinessGoal: parsed.data.knowledgeBusinessGoal,
        knowledgeFactCorrections: parsed.data.knowledgeFactCorrections,
        taskCustomerProfile: parsed.data.taskCustomerProfile
      });
      const replay = await loadAgentRunReplay(runtimeContext, agent, parsed.data.requestId, requestFingerprint);
      if (replay) return replay;
      const knowledgeDocumentIds = Array.from(new Set(parsed.data.knowledgeDocumentIds ?? []));
      const knowledgeAction = agent.marketing?.knowledgeAction;
      const knowledgeSubject = await resolveKnowledgeSubjectForRun(runtimeContext, parsed.data.knowledgeSubjectId, parsed.data.input);
      if (parsed.data.knowledgeSubjectId && !knowledgeSubject) {
        return reply.code(400).send({ error: "knowledge_subject_not_found", message: "当前IP、品牌或客户项目不存在，请重新选择。" });
      }
      if ((knowledgeDocumentIds.length > 0 || parsed.data.knowledgeSubjectId) && (!knowledgeAction || knowledgeAction.enabled === false)) {
        return reply.code(400).send({ error: "knowledge_action_not_enabled", message: "当前智能体尚未启用知识库能力。" });
      }
      const explicitKnowledgeDocuments = knowledgeDocumentIds.length > 0
        ? await loadKnowledgeDocuments(context, knowledgeDocumentIds)
        : [];
      if (explicitKnowledgeDocuments.length !== knowledgeDocumentIds.length) {
        return reply.code(400).send({ error: "knowledge_document_not_found", message: "部分资料不存在或不属于当前企业。" });
      }
      // 知识库的安全边界是企业（tenant），不是资料夹。资料夹用于组织和自动
      // 推荐；同一企业的顾问可以明确选择其他资料夹的资料作为本次参考，原件
      // 不复制也不改变归属。loadKnowledgeDocuments 已经按 tenantId 校验，不能
      // 借此跨企业读取资料。
      const automaticKnowledgeDocuments = knowledgeSubject
        ? await loadAutomaticKnowledgeDocuments(context, knowledgeSubject.id, knowledgeDocumentIds, 20 - explicitKnowledgeDocuments.length)
        : [];
      const knowledgeDocuments = [...explicitKnowledgeDocuments, ...automaticKnowledgeDocuments];
      const automaticKnowledgeDocumentIds = new Set(automaticKnowledgeDocuments.map((document) => document.id));
      if (knowledgeAction?.allowedDocumentTypes.length && knowledgeDocuments.some((document) => !knowledgeAction.allowedDocumentTypes.includes(document.documentType))) {
        return reply.code(400).send({ error: "knowledge_document_type_not_allowed", message: "选中的资料类型不适用于当前智能体。" });
      }
      const knowledgeContext = knowledgeDocuments.length ? buildAgentKnowledgeRunContext(agent, knowledgeDocuments, { subject: knowledgeSubject, fallbackIndustry: runtimeContext.profile.industry }) : undefined;
      const ipVoiceStyleProfile = buildIpVoiceStyleProfile(knowledgeDocuments);
      const ipVoiceStyleApplied = Boolean(ipVoiceStyleProfile);
      const ipVoiceStyleConfidence = ipVoiceStyleProfile?.confidence;
      const knowledgeSources = knowledgeDocuments.map((document) => ({
        id: document.id,
        title: document.title,
        documentType: document.documentType,
        occurredAt: document.occurredAt ?? null,
        knowledgeLayer: document.knowledgeLayer ?? "raw_private",
        autoIncluded: automaticKnowledgeDocumentIds.has(document.id)
      }));
      const forcedWorkbenchCapabilityId = agent.slug === "acquisition"
        ? resolveAcquisitionWorkbenchCapability(parsed.data.input, parsed.data.routingInput)
        : undefined;
      const autoRoutedCapabilityIds = parsed.data.capabilitySelectionMode === "explicit" || forcedWorkbenchCapabilityId
        ? []
        : agent.slug === "acquisition"
          ? inferAcquisitionCapabilities(routingInput)
          : agent.slug === "takeaway-growth"
            ? [inferTakeawayRoutingCapability(routingInput)].filter((item): item is string => Boolean(item))
          : agent.slug === "restaurant-growth"
            ? inferRestaurantCapabilities(routingInput)
          : agent.slug === "sales"
            ? inferSalesCapabilities(routingInput)
            : [];
      const autoRoutedCapabilityId = autoRoutedCapabilityIds[0];
      const effectiveCapabilityId = forcedWorkbenchCapabilityId
        ?? autoRoutedCapabilityId
        ?? parsed.data.capabilityId
        ?? (agent.slug === "ceo-cockpit" ? inferCeoCockpitCapability(routingInput) : undefined)
        ?? (knowledgeDocumentIds.length ? knowledgeAction?.capabilityId : undefined);
      if (agent.slug === "acquisition" || agent.slug === "restaurant-growth") {
        assertRequiredAcquisitionEvidence(effectiveCapabilityId, routingInput, parsed.data.input, parsed.data.history);
      }
      const capability = effectiveCapabilityId
        ? agent.capabilities.find((item) => item.key === effectiveCapabilityId)
        : undefined;
      if (effectiveCapabilityId && !capability) throw new AgentAccessError("skill_not_allowed");
      const isTopicInspirationTask = capability?.key === "topic_inspiration";
      const isAutomaticTopicRun = isTopicInspirationTask
        && /【选题系统(?:自动|四源)运行】/.test(`${originalUserInput}\n${parsed.data.input}`);
      if (isTopicInspirationTask && !isAutomaticTopicRun) {
        const clarificationPrompt = buildTopicClarificationPrompt({
          input: parsed.data.input,
          context: runtimeContext,
          knowledgeSubject,
          history: parsed.data.history,
          taskCustomerProfile: parsed.data.taskCustomerProfile
        });
        if (clarificationPrompt) throw new AgentClarificationRequired(clarificationPrompt);
      }
      if (knowledgeDocuments.length > 0 && parsed.data.capabilitySelectionMode !== "explicit") {
        const defaultSkill = agent.allowedSkills.find((item) => item.isDefault) ?? agent.allowedSkills[0];
        if (!defaultSkill) throw new AgentAccessError("skill_not_allowed");
        const manifest = SKILL_MANIFESTS[defaultSkill.skillId as keyof typeof SKILL_MANIFESTS];
        const profileContext = [
          context.profile.industry ? `使用方默认行业：${context.profile.industry}` : "",
          context.profile.city ? `城市：${context.profile.city}` : "",
          typeof context.profile.data?.offer === "string" ? `使用方默认核心产品或服务：${context.profile.data.offer}` : "",
          typeof context.profile.data?.customer === "string" ? `使用方默认目标客户：${context.profile.data.customer}` : "",
          parsed.data.knowledgeIdentityContext ? `用户补充的身份与专业定位：${parsed.data.knowledgeIdentityContext}` : "",
          parsed.data.knowledgeBusinessGoal ? `用户补充的本次业务目标：${parsed.data.knowledgeBusinessGoal}` : "",
          parsed.data.knowledgeFactCorrections ? `用户已确认的事实纠正（优先于自动摘要与模型推测）：${parsed.data.knowledgeFactCorrections}` : ""
        ].filter(Boolean).join("；");
        const history = (parsed.data.history ?? []).slice(-6).map((message) => ({ ...message, content: message.content.slice(0, 4_000) }));
        const knowledgeMessages = [
          { role: "system", content: buildKnowledgeAgentSystemPrompt(agent, parsed.data.input) },
          ...history,
          {
            role: "user",
            content: [
              profileContext ? `当前企业已确认资料（仅作使用方默认背景，不一定是本轮内容主体）：${profileContext}` : undefined,
              buildTaskSubjectPriorityContext(parsed.data.input),
              inputNormalizationContext,
              taskCustomerContext,
              knowledgeContext,
              `用户本次要求：${parsed.data.input}`
            ].filter(Boolean).join("\n\n")
          }
        ] as Array<{ role: "system" | "user" | "assistant"; content: string }>;
        let answer = await provider.complete(knowledgeMessages, { signal: runController.signal });
        const completePackageRequest = agent.slug === "acquisition" && isAcquisitionKnowledgePackageRequest(parsed.data.input);
        if (completePackageRequest && !hasCompleteContentPackage(answer)) {
          answer = await provider.complete([
            ...knowledgeMessages,
            { role: "assistant", content: answer },
            {
              role: "user",
              content: [
                "刚才的交付不完整。用户已经选定选题，这一步不是只写一篇文案，必须立即返工为完整内容执行包。",
                "只围绕用户选定的这个选题，依次完整交付：一、选题策划；二、60至90秒口播逐字稿；三、拍摄脚本；四、拍摄注意事项；五、剪辑EDL；六、发布标题与话题；七、发布时间；八、评论区引导话术；九、投流建议。",
                "口播正文约300至500个汉字，必须包含3秒钩子、真实故事或事实展开、核心观点、业务价值、自然承接和收尾。",
                "面向用户的总标题写“完整内容执行包”，不要出现“九件套”、模型、提示词或返工等内部表达。",
                "资料中没有的成交、效果、原话、数字和业务阶段不得补造；创作建议要与资料事实明确区分。",
                buildTaskSubjectPriorityContext(parsed.data.input)
              ].join("\n")
            }
          ], { signal: runController.signal });
        } else if (agent.slug === "acquisition" && asksForFullKnowledgeCopy(parsed.data.input) && !hasCompleteSpokenCopy(answer)) {
          answer = await provider.complete([
            ...knowledgeMessages,
            { role: "assistant", content: answer },
            {
              role: "user",
              content: [
                "刚才的内容太短，像标题或提纲，不能称为可直接发布的文案。请立即重写。",
                "只保留用户选定的这个选题，输出一篇60至90秒可直接照读的完整短视频口播逐字稿。",
                "口播正文约300至500个汉字，必须包含：0至3秒钩子、真实故事或事实展开、核心观点、IP与AI业务价值、自然的咨询承接和收尾。",
                "标题、事实状态、资料标注、动作说明和拍摄建议不计入正文字数；不得只给三五句话。",
                "资料里没有的成交、效果、原话和数据不得补造，建议内容要明确标为建议。"
              ].join("\n")
            }
          ], { signal: runController.signal });
        }
        if (!answer.trim()) throw new Error("knowledge_agent_empty_response");
        const directResult: AgentResponse = {
          skillId: defaultSkill.skillId as SkillId,
          skillVersion: defaultSkill.version,
          tenantType: context.profile.tenantType,
          answer,
          creditCost: manifest?.baseCreditCost ?? 0,
          qualityFlags: [
            "knowledge_grounded",
            `knowledge_documents:${knowledgeDocuments.length}`,
            ...(ipVoiceStyleApplied ? ["ip_voice_style_grounded"] : [])
          ],
          analysisMode: "deep"
        };
        const persistence = await persistChatResult({
          context,
          input: parsed.data.input,
          result: directResult,
          provider,
          conversationId: parsed.data.conversationId,
          deviceScope: parsed.data.deviceScope,
          agentId: agent.id,
          capabilityId: knowledgeAction?.capabilityId,
          requestId: parsed.data.requestId,
          requestFingerprint,
          mcpCallId: `knowledge:${parsed.data.requestId}`,
          routingSource: "capability"
        });
        return {
          status: "success",
          mcpCallId: `knowledge:${parsed.data.requestId}`,
          agentRunId: persistence.agentRunId,
          conversationId: persistence.conversationId,
          deviceScope: persistence.deviceScope,
          agentId: agent.id,
          skillId: directResult.skillId,
          skillVersion: directResult.skillVersion,
          answerText: answer,
          structuredBlocks: [{ type: "markdown", content: answer }],
          stableDelivery: buildStableAgentDelivery({ capabilityId: knowledgeAction?.capabilityId, answerText: answer }),
          reasoningProfile: resolveReasoningProfile(knowledgeAction?.capabilityId, directResult.skillId),
          nextActions: agent.slug === "acquisition"
            ? ["用这个选题生成完整内容执行包", "补充目标客户后重新筛选选题"]
            : agent.slug === "sales"
              ? ["补充客户最新回复生成下一步跟单计划", "把复盘沉淀成团队销售打板"]
              : [],
          artifacts: [],
          creditCost: directResult.creditCost,
          remainingCredits: persistence.remainingCredits,
          qualityFlags: directResult.qualityFlags,
          analysisMode: directResult.analysisMode,
          knowledgeSources,
          knowledgeSubject: knowledgeSubject ? { id: knowledgeSubject.id, subjectType: knowledgeSubject.subjectType, name: knowledgeSubject.name, industry: knowledgeSubject.industry } : null,
          automaticKnowledgeCount: automaticKnowledgeDocuments.length,
          ipVoiceStyleApplied,
          ipVoiceStyleConfidence,
          traceId: parsed.data.requestId
        };
      }
      let requestedCapabilityIds = forcedWorkbenchCapabilityId
        ? [forcedWorkbenchCapabilityId]
        : Array.from(new Set([
            ...(parsed.data.capabilityIds ?? []),
            ...(effectiveCapabilityId ? [effectiveCapabilityId] : [])
          ]));
      if (autoRoutedCapabilityIds.length > 0) requestedCapabilityIds = autoRoutedCapabilityIds;
      const asksForContentAsset = asksForHotspotContentAsset(routingInput);
      const asksForHotspotResearch = /(?:结合|根据|追|蹭).{0,12}(?:行业)?热点|(?:行业)?热点.{0,16}(?:选题|文案|脚本|短视频|口播)|近期行业机会/.test(routingInput);
      if (!isTopicInspirationTask && agent.slug === "acquisition" && (capability?.key === "industry_hotspots" || asksForHotspotResearch)) {
        requestedCapabilityIds.push("industry_hotspots");
        if (asksForContentAsset) requestedCapabilityIds.push("content_plan");
      }
      const capabilityIds = Array.from(new Set(requestedCapabilityIds));
      const needsIndustryResearch = agent.slug === "acquisition" && (
        capability?.key === "industry_hotspots"
        || capabilityIds.includes("industry_hotspots")
        || asksForHotspotResearch
      );
      const researchSubject = parsed.data.taskCustomerProfile?.industry?.trim() || resolveResearchSubject(runtimeContext.profile);
      const hasProfileIndustryTarget = researchSubject.length > 0 && hasExplicitIndustryTarget(`行业：${researchSubject}`);
      if (!isTopicInspirationTask && needsIndustryResearch && !hasExplicitIndustryTarget(routingInput) && !hasProfileIndustryTarget) {
        throw new AgentClarificationRequired(
          "请先告诉我要抓取哪个行业的热点，例如：行业：企业AI改造。然后补一句你要3个选题、完整逐字稿，还是一套完整成品。"
        );
      }
      const researchContext = isTopicInspirationTask
        ? await buildIpCapabilityIntelContext("topic_inspiration", routingInput, researchSubject)
        : needsIndustryResearch
          ? await buildIpCapabilityIntelContext("industry_hotspots", routingInput, researchSubject)
          : undefined;
      const isHotspotContentTask = needsIndustryResearch && (
        capability?.key === "content_plan"
        || capabilityIds.some((id) => id === "content_plan" || id === "franchise_acquisition")
        || asksForContentAsset
      );
      if (capabilityIds.length > 1) {
        const capabilities = capabilityIds.map((id) => agent.capabilities.find((item) => item.key === id));
        if (capabilities.some((item) => !item)) throw new AgentAccessError("skill_not_allowed");
        const resolvedCapabilities = capabilities
          .filter((item): item is NonNullable<typeof item> => Boolean(item));
        const executionCapabilities = resolvedCapabilities.map((item) => {
          if (
            parsed.data.capabilitySelectionMode === "explicit"
            || agent.slug !== "acquisition"
            || item.key !== "content_plan"
            || !/招商|加盟商|加盟项目|招代理/.test(routingInput)
          ) return item;
          return agent.capabilities.find((candidate) => candidate.key === "franchise_acquisition") ?? item;
        });
        const plan = buildExecutionPlan(parsed.data.requestId, executionCapabilities.map((item) => ({
          capabilityId: item.key,
          title: item.title,
          skillId: item.skillId,
          skillVersion: item.skillVersion
        })));
        const execution = await executeExecutionPlan({
          plan,
          signal: runController.signal,
          stepTimeoutMs: env.AGENT_ORCHESTRATION_STEP_TIMEOUT_MS,
          overallTimeoutMs: env.AGENT_ORCHESTRATION_TOTAL_TIMEOUT_MS,
          buildInput: (step, upstream) => {
            const item = executionCapabilities.find((candidate) => candidate.key === step.capabilityId);
            const upstreamContext = upstream
              .filter((result) => result.status === "success")
              .map((result) => `【前置“${result.title}”结果】\n${result.answerMarkdown}`)
              .join("\n\n") || undefined;
            return [
              item?.promptTemplate ?? "",
              `这是一次多技能联合任务中的“${step.title}”子任务。`,
              "只完成属于本能力的交付，并严格遵守用户点名的交付范围；不能因为是联合任务就缩成摘要或提纲，也不能擅自扩写用户没有要求的栏目。与其他交付保持一致，不要要求用户重复提供信息。",
              "事实保留要求：必须从下方用户原始要求中保留明确出现的客户/品牌名、行业、门店数、核心问题、目标客户和客户原话；与本技能不直接相关的事实也至少要在场景摘要中准确出现一次，不能改成通用案例。",
              fullSkillDeliveryDirective(step.capabilityId, parsed.data.input),
              videoEvidenceDirective(step.capabilityId),
              agent.slug === "acquisition" ? acquisitionContentBoundaryDirective() : undefined,
              inputNormalizationContext,
              taskCustomerContext,
              knowledgeContext,
              "用户已经要求直接交付成品。信息不完整时用“待补”占位并给出可替换写法，必须先交付第一版，不能只返回问题清单。",
              researchContext,
              upstreamContext,
              isHotspotContentTask && (step.capabilityId === "content_plan" || step.capabilityId === "franchise_acquisition")
                ? hotspotContentDirective(parsed.data.input)
                : undefined,
              `用户这次补充：${parsed.data.input}`
            ].filter(Boolean).join("\n\n");
          },
          invoke: (step, skillInput, signal) => invokeSkillViaGateway({
            requestId: `${parsed.data.requestId.slice(0, 72)}-${step.stepId.slice(0, 24)}`,
            input: skillInput,
            routingInput,
            capabilityId: step.capabilityId,
            skillId: step.skillId,
            capabilityLocked: true,
            deliveryPolicy: "draft_with_placeholders",
            conversationId: parsed.data.conversationId,
            deviceScope: parsed.data.deviceScope,
            history: parsed.data.history,
            context: runtimeContext,
            provider,
            agentId: agent.id,
            routingSource: "capability",
            persist: false,
            signal
          })
        });
        const combined = combineExecutionResults(execution);
        const answerText = combined.answerText;
        const combinedResult: AgentResponse = {
          skillId: combined.skillId as SkillId,
          skillVersion: combined.skillVersion,
          tenantType: runtimeContext.profile.tenantType,
          answer: answerText,
          creditCost: combined.creditCost,
          qualityFlags: combined.qualityFlags,
          analysisMode: combined.analysisMode,
          deliveryStatus: combined.deliveryStatus
        };
        const persistence = await persistChatResult({
          context: runtimeContext,
          input: parsed.data.input,
          result: combinedResult,
          provider,
          conversationId: parsed.data.conversationId,
          deviceScope: parsed.data.deviceScope,
          agentId: agent.id,
          requestId: parsed.data.requestId,
          requestFingerprint,
          mcpCallId: `multi:${parsed.data.requestId}`,
          routingSource: "agent_router",
          execution: { plan: execution.plan, results: execution.results }
        });
        return {
          status: "success",
          deliveryStatus: combined.deliveryStatus,
          mcpCallId: `multi:${parsed.data.requestId}`,
          agentRunId: persistence.agentRunId,
          conversationId: persistence.conversationId,
          deviceScope: persistence.deviceScope,
          agentId: agent.id,
          skillId: combinedResult.skillId,
          skillIds: combined.skillIds,
          skillVersion: combinedResult.skillVersion,
          answerText,
          structuredBlocks: [{ type: "markdown", content: answerText }],
          nextActions: combined.nextActions,
          artifacts: combined.artifacts,
          creditCost: combinedResult.creditCost,
          remainingCredits: persistence.remainingCredits,
          qualityFlags: combinedResult.qualityFlags,
          analysisMode: combinedResult.analysisMode,
          execution: {
            planId: execution.plan.planId,
            mode: execution.plan.mode,
            steps: execution.results.map((result) => ({
              stepId: result.stepId,
              capabilityId: result.capabilityId,
              skillId: result.skillId,
              skillVersion: result.skillVersion,
              status: result.status,
              durationMs: result.durationMs,
              qualityFlags: result.qualityFlags,
              error: result.error
            }))
          },
          knowledgeSources,
          traceId: parsed.data.requestId
        };
      }
      const input = [
        capability?.promptTemplate,
        singleTaskFactRetentionDirective(),
        videoEvidenceDirective(capability?.key),
        agent.slug === "acquisition" ? acquisitionContentBoundaryDirective() : undefined,
        inputNormalizationContext,
        taskCustomerContext,
        knowledgeContext,
        researchContext,
        isHotspotContentTask ? hotspotContentDirective(parsed.data.input) : undefined,
        `用户这次补充：${parsed.data.input}`
      ].filter(Boolean).join("\n\n");
      const result = await invokeSkillViaGateway({
        ...parsed.data,
        input,
        requestFingerprint,
        deliveryPolicy: resolveAgentProductDeliveryPolicy(agent.slug),
        // A resolved workbench capability owns its Skill. Never allow a stale
        // client/task skillId to override the module the user just opened.
        skillId: capability?.skillId ?? parsed.data.skillId,
        // The server may infer a takeaway capability from free-form input.
        // Pass that resolved value into the agent runtime instead of letting
        // the original undefined request field erase the routing decision.
        capabilityId: effectiveCapabilityId,
        capabilityLocked: Boolean(forcedWorkbenchCapabilityId)
          || (parsed.data.capabilitySelectionMode === "explicit" && Boolean(effectiveCapabilityId)),
        context: runtimeContext,
        provider,
        agentId: agent.id,
        routingSource: effectiveCapabilityId ? "capability" : "agent_router",
        signal: runController.signal
      });
      return {
        ...result,
        knowledgeSources,
        knowledgeSubject: knowledgeSubject ? { id: knowledgeSubject.id, subjectType: knowledgeSubject.subjectType, name: knowledgeSubject.name, industry: knowledgeSubject.industry } : null,
        automaticKnowledgeCount: automaticKnowledgeDocuments.length,
        ipVoiceStyleApplied,
        ipVoiceStyleConfidence
      };
    } catch (error) {
      if (error instanceof AgentExecutionCancelledError || runController.signal.aborted) {
        if (reply.raw.destroyed) return reply;
        return reply.code(499).send({ error: "agent_execution_cancelled", message: "本次生成已停止。" });
      }
      return sendAgentError(reply, error);
    } finally {
      request.raw.removeListener("aborted", abortRun);
      reply.raw.removeListener("close", abortOnReplyClose);
    }
  });

  app.post<{ Params: { slug: string } }>("/agents/:slug/trials/start", async (request, reply) => {
    const parsed = trialStartSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    const agent = await getRuntimeAgent(request.params.slug);
    if (agent.status !== "active") return reply.code(409).send({ error: "agent_not_active" });
    if (env.DATA_MODE !== "database") {
      return { token: randomBytes(24).toString("base64url"), expiresInSeconds: 86400 };
    }
    const deviceHash = secureHash(parsed.data.deviceId);
    const ipHash = secureHash(request.ip);
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [usedDevice, recentIpCount] = await Promise.all([
      prisma.anonymousTrial.findFirst({ where: { agentId: agent.id, deviceHash } }),
      prisma.anonymousTrial.count({ where: { agentId: agent.id, ipHash, createdAt: { gte: since } } })
    ]);
    if (usedDevice) return reply.code(429).send({ error: "trial_already_used", message: "该设备已使用过免费体验，登录后可继续。" });
    if (recentIpCount >= 5) return reply.code(429).send({ error: "trial_rate_limited", message: "当前网络的体验请求较多，请稍后再试或直接登录。" });
    const token = randomBytes(32).toString("base64url");
    await prisma.anonymousTrial.create({
      data: { tokenHash: secureHash(token), agentId: agent.id, deviceHash, ipHash, status: "available" }
    });
    return { token, expiresInSeconds: 86400 };
  });

  app.post<{ Params: { slug: string } }>("/agents/:slug/trials/run", async (request, reply) => {
    const parsed = trialRunSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    const originalTrialInput = parsed.data.input;
    parsed.data.input = normalizeBusinessInput(parsed.data.input);
    const inputNormalizationContext = buildInputNormalizationContext(originalTrialInput, parsed.data.input);
    parsed.data.history = parsed.data.history?.map((message) => ({
      ...message,
      content: message.role === "user" ? normalizeBusinessInput(message.content) : message.content
    }));
    try {
      const agent = await getRuntimeAgent(request.params.slug);
      const capability = agent.capabilities.find((item) => item.key === parsed.data.capabilityId);
      if (!capability) throw new AgentAccessError("skill_not_allowed");
      if (agent.slug === "acquisition" && requiresRestaurantGrowthAgent(parsed.data.input)) {
        throw new AgentClarificationRequired(restaurantGrowthRedirectMessage());
      }
      let trialId: string | undefined;
      if (env.DATA_MODE === "database") {
        const trial = await prisma.anonymousTrial.findFirst({
          where: {
            tokenHash: secureHash(parsed.data.token),
            agentId: agent.id,
            status: "available",
            createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
          }
        });
        if (!trial) return reply.code(409).send({ error: "trial_invalid_or_used" });
        trialId = trial.id;
      }
      const context = { ...getDemoContext({}), source: "demo" as const };
      const needsTopicResearch = capability.key === "topic_inspiration";
      const needsIndustryResearch = capability.key === "industry_hotspots"
        || /(?:结合|根据|追|蹭).{0,10}(?:行业)?热点|(?:行业)?热点.{0,12}(?:选题|文案|脚本|短视频|口播)/.test(parsed.data.input);
      const researchContext = needsTopicResearch
        ? await buildIpCapabilityIntelContext("topic_inspiration", parsed.data.input, context.profile.industry)
        : needsIndustryResearch
          ? await buildIpCapabilityIntelContext("industry_hotspots", parsed.data.input, context.profile.industry)
          : undefined;
      const input = [
        capability.promptTemplate,
        agent.slug === "acquisition" ? acquisitionContentBoundaryDirective() : undefined,
        inputNormalizationContext,
        researchContext,
        needsIndustryResearch && /选题|文案|脚本|短视频|口播|拍摄/.test(parsed.data.input)
          ? hotspotContentDirective(parsed.data.input)
          : undefined,
        `用户这次补充：${parsed.data.input}`
      ].filter(Boolean).join("\n\n");
      const result = await invokeSkillViaGateway({
        requestId: parsed.data.requestId,
        context,
        provider,
        agentId: agent.id,
        capabilityId: capability.key,
        skillId: capability.skillId,
        input,
        history: parsed.data.history,
        deviceScope: parsed.data.deviceScope,
        skipEntitlement: true,
        persist: false
      });
      const canContinueTrial = result.qualityFlags.includes("clarification_fast_path_used");
      if (trialId && !canContinueTrial) {
        await prisma.anonymousTrial.update({
          where: { id: trialId },
          data: {
            status: "used",
            input: parsed.data.input,
            output: result.answerText,
            skillId: result.skillId,
            skillVersion: result.skillVersion,
            usedAt: new Date()
          }
        });
      }
      return {
        ...result,
        trial: true,
        canContinueTrial,
        requiresLoginForContinuation: !canContinueTrial
      };
    } catch (error) {
      return sendAgentError(reply, error);
    }
  });

  app.post("/agents/trials/claim", async (request, reply) => {
    const parsed = trialClaimSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    const context = await resolveRequestContext(request.headers);
    if (context.source !== "database") return { claimed: false, dataMode: "demo" };
    const trial = await prisma.anonymousTrial.findFirst({
      where: { tokenHash: secureHash(parsed.data.token), status: "used" }
    });
    if (!trial?.input || !trial.output) return reply.code(404).send({ error: "trial_not_found" });
    const trialInput = trial.input;
    const trialOutput = trial.output;
    const claim = await prisma.$transaction(async (tx: any) => {
      const created = await tx.conversation.create({
        data: { tenantId: context.tenantId, agentId: trial.agentId, channel: "trial_claim", deviceScope: parsed.data.deviceScope, title: trialInput.slice(0, 40) }
      });
      await tx.message.createMany({
        data: [
          { conversationId: created.id, tenantId: context.tenantId, userId: context.userId, role: "user", content: trialInput },
          { conversationId: created.id, tenantId: context.tenantId, role: "assistant", content: trialOutput }
        ]
      });
      await tx.anonymousTrial.update({
        where: { id: trial.id },
        data: {
          status: "claimed",
          tenantId: context.tenantId,
          userId: context.userId,
          conversationId: created.id,
          claimedAt: new Date()
        }
      });
      const membership = await tx.membership.findFirst({
        where: { tenantId: context.tenantId, userId: context.userId, isActive: true },
        select: { id: true }
      });
      const existingEntitlement = await tx.tenantAgentEntitlement.findUnique({
        where: { tenantId_agentId: { tenantId: context.tenantId, agentId: trial.agentId } }
      });
      const now = new Date();
      const trialExpiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      const alreadyUsable = existingEntitlement?.status === "active"
        && (!existingEntitlement.expiresAt || existingEntitlement.expiresAt > now);
      if (!alreadyUsable) {
        await tx.tenantAgentEntitlement.upsert({
          where: { tenantId_agentId: { tenantId: context.tenantId, agentId: trial.agentId } },
          update: { status: "active", startsAt: now, expiresAt: trialExpiresAt, source: "trial_claim" },
          create: {
            tenantId: context.tenantId,
            agentId: trial.agentId,
            status: "active",
            startsAt: now,
            expiresAt: trialExpiresAt,
            source: "trial_claim"
          }
        });
      }
      if (membership) {
        await tx.memberAgentAccess.upsert({
          where: { membershipId_agentId: { membershipId: membership.id, agentId: trial.agentId } },
          update: {},
          create: { membershipId: membership.id, agentId: trial.agentId }
        });
      }
      return {
        conversation: created,
        entitlementExpiresAt: alreadyUsable ? existingEntitlement?.expiresAt : trialExpiresAt
      };
    });
    return {
      claimed: true,
      conversationId: claim.conversation.id,
      agentId: trial.agentId,
      entitlementExpiresAt: claim.entitlementExpiresAt
    };
  });
}

async function resolveOptionalContext(headers: Record<string, unknown>): Promise<RequestContext | null> {
  if (env.DATA_MODE === "demo" && !headers.authorization) return null;
  try {
    return await resolveRequestContext(headers);
  } catch {
    return null;
  }
}

async function listEntitledAgentIds(context: RequestContext): Promise<Set<string>> {
  if (context.source !== "database") return new Set((await listRuntimeAgents()).map((agent) => agent.id));
  const records = await prisma.tenantAgentEntitlement.findMany({
    where: {
      tenantId: context.tenantId,
      status: "active",
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }]
    },
    select: { agentId: true }
  });
  return new Set(records.map((item) => item.agentId));
}

const ACQUISITION_LAUNCHER_CAPABILITIES = new Set([
  "topic_inspiration",
  "content_plan",
  "paid_traffic",
  "dou_plus_traffic",
  "shooting_editing",
  "video_review",
  "live_script",
  "live_review",
  "industry_hotspots",
  "franchise_acquisition",
  "private_domain"
]);

function publicAgent(agent: Awaited<ReturnType<typeof getRuntimeAgent>>, entitled: boolean) {
  const publicCapabilities = agent.slug === "acquisition"
    ? agent.capabilities.filter((item) => ACQUISITION_LAUNCHER_CAPABILITIES.has(item.key))
    : agent.capabilities;
  return {
    id: agent.id,
    slug: agent.slug,
    name: agent.name,
    description: agent.description,
    icon: agent.icon,
    status: agent.status,
    marketing: agent.marketing,
    knowledgeAction: agent.marketing?.knowledgeAction,
    automationAction: agent.marketing?.automationAction,
    entitled,
    capabilities: publicCapabilities.map((item) => ({
      key: item.key,
      title: item.title,
      subtitle: item.subtitle,
      promptTemplate: item.promptTemplate
    }))
  };
}

function resolveDefaultEntry(agents: Array<{ slug: string }>): string {
  if (agents.length >= 2) return "/my-ai";
  if (agents.length === 1) return `/agents/${agents[0].slug}`;
  return "/";
}

function secureHash(value: string): string {
  const secret = env.JWT_SECRET ?? env.ADMIN_TOKEN ?? "sitong-development-trial";
  return createHash("sha256").update(`${secret}:${value}`).digest("hex");
}

function resolveResearchSubject(profile: RequestContext["profile"]): string {
  const data = profile.data && typeof profile.data === "object" && !Array.isArray(profile.data)
    ? profile.data as Record<string, unknown>
    : {};
  const values = [
    data.offer,
    data.product,
    data.service,
    data.business,
    profile.industry
  ];
  const specific = values.find((value) => (
    typeof value === "string"
    && value.trim().length >= 2
    && !/^(?:本地生活服务|本地生活|其他|通用)$/.test(value.trim())
  ));
  return typeof specific === "string" ? specific.trim() : (profile.industry?.trim() ?? "");
}

function hasExplicitIndustryTarget(input: string): boolean {
  const text = input.replace(/\s+/g, "");
  const fieldValue = text.match(/(?:行业|赛道|品类)[：:是为]【?([^】。；，,]{2,30})/)?.[1]?.trim();
  if (fieldValue && !/请填写|待填写|具体行业|哪个行业|什么行业/.test(fieldValue)) return true;
  const queryValue = text.match(/(?:抓取|搜索|检索|分析|看)([^。；，,]{2,24})(?:行业|赛道|品类)?(?:的)?(?:近期|最近)?热点/)?.[1]?.trim();
  if (queryValue && !/请填写|待填写|哪个|什么|行业/.test(queryValue)) return true;
  return /AI企业改造|企业AI改造|餐饮|美业|教培|零售|连锁加盟|本地生活|家居|装修|汽车|母婴|宠物|医疗|金融|制造业|文旅|酒店/.test(text);
}

function asksForTranscriptOnlyContent(input: string): boolean {
  const asksForTranscript = /逐字稿|口播稿|口播文案|完整(?:的)?(?:短视频)?文案|可直接照读/.test(input);
  const asksForProductionPackage = /拍摄(?:脚本|方案|要求|注意事项)?|分镜|剪辑|EDL|发布标题|标题(?:与|和)?话题|评论区|投流|完整内容执行包|可直接发布的内容执行包|一套完整(?:成品|方案|内容)/.test(input);
  return asksForTranscript && !asksForProductionPackage;
}

function hotspotContentDirective(input: string): string {
  const transcriptOnly = asksForTranscriptOnlyContent(input);
  return [
    "【热点驱动内容创作任务】",
    "这不是普通的泛行业文案。必须先读取上方公开线索，完成“检索热点→核验相关性→筛选内容角度→生成可拍成品”的链路。",
    "第一部分先列3至5条近期热点雷达：标题、来源、URL、发布日期（未读到就写发布日期待核验）、与AI企业改造业务的关系。",
    "第二部分按用户要求的数量给选题；未指定时给5个。每个包含目标老板痛点、冲突钩子、内容角度、转化目标，并解释为什么值得拍。",
    transcriptOnly
      ? "第三部分选择最值得拍的1个选题，说明选择理由，并只交付用户要求的完整口播逐字稿；不要附加拍摄分镜、剪辑、标题、评论区或投流栏目。"
      : "第三部分选择最值得拍的1个选题，并按用户明确要求的内容形式完整交付；只有用户明确要求完整内容执行包时，才增加拍摄、剪辑、发布和投流栏目。",
    "口播必须是可直接照读拍摄的60至90秒逐字稿，约300至500个汉字，包含0至3秒钩子、问题共鸣、热点事实、思潼观点、企业行动建议和自然收尾；不能只写四句提纲或泛泛介绍。",
    "热点事实与方法建议要分开表达；不得编造新闻、发布日期、排名、数据、客户案例或效果承诺。"
  ].join("\n");
}

function fullSkillDeliveryDirective(capabilityId: string, input: string): string | undefined {
  if (capabilityId === "paid_traffic") {
    return [
      "投流系统子交付必须只输出投流诊断与测试方案，不扩写短视频完整内容包。",
      "必须包含：是否建议投、投放目标、平台与工具选择依据、素材A/B、预算与节奏、人群地域、监控指标、止损条件、复盘时间、合规提醒和执行草案。",
      "执行草案必须使用固定字段：平台、账户工具、目标、素材、地域、人群、总预算、单日预算、开始条件、停止条件、复盘时间。",
      "当前没有桌面控制授权，不得声称已经创建、修改、提交、启动、暂停或关闭任何真实广告计划。"
    ].join("\n");
  }
  if (capabilityId === "content_plan" || capabilityId === "franchise_acquisition") {
    if (asksForTranscriptOnlyContent(input)) {
      return [
        "当前用户明确要求的是完整逐字稿，不是完整内容执行包。",
        "只需包含：明确选题、选择理由、60至90秒且可直接照读的完整口播逐字稿，以及一句自然承接动作。",
        "不得强制增加拍摄/分镜、剪辑、发布标题、评论区或投流栏目；逐字稿不能用四五句提纲代替。"
      ].join("\n");
    }
    return [
      "短视频子交付必须是一份独立、完整的可拍成品。",
      "至少包含：明确选题、60至90秒口播逐字稿、按时间段拆分的拍摄/分镜脚本、发布标题和评论区承接。",
      "逐字稿必须能直接照读，不能用四五句镜头提纲代替完整文案。"
    ].join("\n");
  }
  if (capabilityId === "live_script") {
    return [
      "直播子交付必须是一份独立的直播话术成品，不能混入短视频、拍摄剪辑或直播复盘。",
      "信息不足时只确认已知事实并一次性追问，问完停止；不得输出框架版、占位稿或智能文件。",
      "用户要求完整版、全链路、整场或指定时长时，必须包含直播总览、开场、四套核心轮播、三种承接钩子、高频问答、收尾、完整时间轴和场控清单。",
      "用户只点名一个话术环节时只交付该环节，不强行扩成整场。每段都要写主播能直接照着说的话，并配运营动作。",
      "所有价格、福利、库存、名额、门店、利润、回本、案例和扶持政策都必须来自本轮真实资料；不得从样板或企业默认画像补造。"
    ].join("\n");
  }
  if (capabilityId === "customer_diagnosis") {
    return [
      "客户诊断子交付必须只做当前客户诊断，不得替换成异议回复或跟进计划。",
      "必须保留用户明确提供的品牌、行业、门店数、客户原话和业务目标，并区分已确认事实、待核实判断、真实需求、核心顾虑、决策角色、成交阻力和今天的下一步。",
      "不能把B2C学员、消费者或门店顾客套成企业项目决策场景。"
    ].join("\n");
  }
  if (capabilityId === "objection_reply") {
    return [
      "异议回复子交付必须逐项覆盖用户明确列出的每一类异议，每一项都给可直接复制发送的话术、追问问题、禁止承诺和进入下一步的信号。",
      "必须保留客户原话和本轮产品场景，不得用通用企业项目价格异议话术覆盖零基础、效果、就业、客源或其他具体顾虑。"
    ].join("\n");
  }
  if (capabilityId === "follow_up_plan") {
    return [
      "跟进计划子交付必须严格按用户要求的天数逐天输出；用户要求7天时，必须从第1天写到第7天。",
      "每天都写目的、触达方式、可直接发送消息、观察信号、下一步和退出/停止条件，并保留用户提供的品牌、行业、客户原话和业务目标。",
      "不得复制异议诊断来冒充跟进计划。"
    ].join("\n");
  }
  if (capabilityId === "private_domain") {
    return [
      "朋友圈私域子交付必须围绕用户本轮明确指定的客户/品牌、目标人群和承接目标，不能把用户指令中的栏目名称误当成产品名。",
      "用户要求7天时必须从第1天写到第7天，并同时给朋友圈内容、评论/私信入口、私聊跟进SOP、线索分级、负责人、每日动作、指标和复盘方式。",
      "缺失的价格、政策、案例和经营数据统一写【待补】，不得停下来只追问。"
    ].join("\n");
  }
  return undefined;
}

function videoEvidenceDirective(capabilityId?: string): string | undefined {
  if (capabilityId !== "shooting_editing" && capabilityId !== "video_review") return undefined;
  if (capabilityId === "video_review") {
    return [
      "【短视频复盘证据边界】",
      "快速诊断至少需要用户提供真实可见指标或明确观察；深度复盘分析 CSV、Excel 或已经解析成表格的后台数据。两种模式都不得假装读取链接、视频画面、口播、字幕和剪辑。",
      "深度复盘必须逐行读取全部有效记录，输出数据审计、总览、视频分层、内容健康度、单条深拆、完播、互动、趋势预警、规律、方法论、下周期选题和综合结论。",
      "平均播放时长不等于视频总时长；没有字段时不得判断限流、违规、平台机制、镜头、口播、付费/自然流量、私信、留资或成交。",
      "内容主题只来自当前文件标题/描述，不得使用企业默认行业或其他客户项目补写本轮主题。",
      "禁止输出内容九件套、完整文案、直播话术、拍摄脚本或剪辑 EDL。"
    ].join("\n");
  }
  return [
    "【视频任务边界】",
    "用户当前要求决定本次任务；附件转写、字幕、关键帧和文件名只作为分析证据，绝不能因为素材里出现“直播”“文案”“朋友圈”等词而扩大成其他技能或额外交付。",
    "只回答用户点名的视频复盘、拍摄或剪辑问题。用户没有要求重写选题时，不得擅自改题、改内容主体、改城市、改受众或生成完整文案/直播话术/朋友圈。",
    "企业画像只说明系统使用方，不等于这条视频的内容主体。城市、发布平台、目标客户、产品和转化动作，必须来自用户本轮明确说明或附件中的清晰证据；没有证据就写“待确认”，不得使用企业默认城市或产品补齐。",
    "建议必须回到现有视频证据：尽量指出对应时间段、画面、口播或字幕，再给“当前问题—为什么—具体修改动作”。无法从附件确认的内容明确标注，不得假装看见。",
    "当前只交付《视频拍摄剪辑修改建议》：先给3条最高优先级修改，再给镜头/构图、剪辑节奏、字幕、声音、封面和发布前检查；不要输出内容九件套。"
  ].join("\n");
}

function sendAgentError(reply: any, error: unknown) {
  if (error instanceof AgentClarificationRequired) {
    return reply.code(409).send({ error: "clarification_required", message: error.prompt });
  }
  if (error instanceof AgentAccessError) {
    const status = error.code === "agent_not_found" ? 404 : error.code === "agent_not_entitled" ? 403 : 403;
    return reply.code(status).send({ error: error.code });
  }
  if (isInsufficientCredits(error)) {
    return reply.code(402).send({ error: "insufficient_credits", message: "企业积分不足，请充值或联系服务团队。" });
  }
  if (error instanceof IdempotencyConflictError) {
    return reply.code(409).send({ error: "request_id_conflict", message: "该请求编号已用于其他任务，请重新提交。" });
  }
  if (error instanceof McpUnavailableError) {
    return reply.code(503).send({ error: "service_unavailable", message: "Agent 服务暂时不可用，请稍后重试。" });
  }
  throw error;
}

function compactHistoryContent(content: string, maxLength = 8_000): string {
  const trimmed = content.trim();
  if (trimmed.length <= maxLength) return trimmed;
  const separator = "\n\n【较长历史交付物已自动压缩，保留开头与结尾】\n\n";
  const available = maxLength - separator.length;
  const headLength = Math.ceil(available * 0.6);
  const tailLength = available - headLength;
  return `${trimmed.slice(0, headLength)}${separator}${trimmed.slice(-tailLength)}`;
}

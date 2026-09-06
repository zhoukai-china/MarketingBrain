import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  buildAgentMessages,
  finalizeAgentAnswer,
  inspectQuality,
  routeSkill,
  runAgent,
  type AgentResponse,
  type LlmProvider
} from "@baolu/agent";
import type { SkillId } from "@baolu/shared";
import { SKILL_MANIFESTS } from "@baolu/skills";
import { prisma } from "@baolu/db";
import { toAgentRequest } from "../services/demo-context.js";
import { InsufficientCreditsError, persistChatResult } from "../services/chat-persistence.js";
import { domesticNetworkOnly, domesticOutboundAllowlist } from "../config/env.js";
import { assertOutboundUrlAllowed } from "../services/outbound-policy.js";
import { resolveRequestContext } from "../services/request-context.js";
import { invokeSkillViaGateway, McpUnavailableError } from "../services/mcp-client.js";
import { scanIndustryTrends } from "../services/trend-intelligence.js";

type EntryId = "local" | "franchise";
type AgentId = "ip_acquisition_agent";
type IpCapabilityId =
  | "topic_inspiration"
  | "industry_hotspots"
  | "content_nine_piece"
  | "paid_traffic"
  | "dou_plus_traffic"
  | "shooting_editing"
  | "video_review"
  | "live_script"
  | "live_review"
  | "franchise_acquisition"
  | "moments_private";

const chatBodySchema = z.object({
  input: z.string().optional(),
  prompt: z.string().optional(),
  agentId: z.string().optional(),
  capabilityId: z.string().optional(),
  skillId: z.string().optional(),
  conversationId: z.string().optional(),
  deviceScope: z.enum(["desktop", "mobile"]).default("desktop"),
  requestId: z.string().min(8).max(100).optional(),
  entry: z.enum(["local", "franchise"]).optional(),
  context: z.record(z.unknown()).optional()
}).refine((value) => Boolean((value.input ?? value.prompt ?? "").trim()), {
  message: "input_required",
  path: ["input"]
});

const skillInvokeBodySchema = z.object({
  skill_id: z.string().min(1),
  entry: z.enum(["local", "franchise"]).optional(),
  params: z.record(z.unknown()).default({})
});

export async function registerChatRoutes(app: FastifyInstance, provider: LlmProvider): Promise<void> {
  app.post("/chat", async (request, reply) => {
    const parsed = chatBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    }

    try {
      if (
        parsed.data.agentId === "ip_acquisition_agent" ||
        parsed.data.agentId === "agent_acquisition" ||
        parsed.data.agentId === "agent_sales"
      ) {
        const auth = await resolveRequestContext(request.headers);
        const userInput = getUserInput(parsed.data);
        const agentAuth = mergeProfileFromFrontendContext(auth, parsed.data.context);
        const entryAwareInput = await buildEntryAwareInput({
          input: userInput,
          entry: parsed.data.entry,
          agentId: parsed.data.agentId,
          capabilityId: parsed.data.capabilityId,
          context: parsed.data.context
        });
        const agentId = parsed.data.agentId === "agent_sales" ? "agent_sales" : "agent_acquisition";
        const result = await invokeSkillViaGateway({
          requestId: parsed.data.requestId ?? randomUUID(),
          context: agentAuth,
          provider,
          agentId,
          capabilityId: normalizeLegacyCapabilityId(parsed.data.capabilityId),
          skillId: parsed.data.skillId,
          input: entryAwareInput,
          routingInput: userInput,
          conversationId: parsed.data.conversationId,
          deviceScope: parsed.data.deviceScope,
          routingSource: "legacy"
        });
        return {
          tenantId: auth.tenantId,
          planCode: auth.planCode,
          dataMode: auth.source,
          answer: result.answerText,
          conversationId: result.conversationId,
          agentRunId: result.agentRunId,
          skillId: result.skillId,
          skillVersion: result.skillVersion,
          creditCost: result.creditCost,
          remainingCredits: result.remainingCredits,
          qualityFlags: result.qualityFlags,
          mcpCallId: result.mcpCallId
        };
      }

      const userInput = getUserInput(parsed.data);
      const auth = await resolveRequestContext(request.headers);
      const agentAuth = mergeProfileFromFrontendContext(auth, parsed.data.context);
      const requestedSkillId = resolveRequestedSkillForAgent({
        userInput,
        capabilityId: parsed.data.capabilityId,
        rawSkillId: parsed.data.skillId,
        agentId: parsed.data.agentId
      });
      const agentInput = shouldUseCurrentTurnOnlyForUploadedFacts(parsed.data.capabilityId, userInput)
        ? userInput
        : await buildInputWithConversationHistory({
            tenantId: auth.tenantId,
            conversationId: parsed.data.conversationId,
            deviceScope: parsed.data.deviceScope,
            input: userInput
          });
      const routedSkillId = constrainSkillForAgent(
        resolveRoutedSkill(userInput, requestedSkillId, parsed.data.entry),
        parsed.data.agentId
      );
      const entryAwareInput = await buildEntryAwareInput({
        input: agentInput,
        entry: parsed.data.entry,
        agentId: parsed.data.agentId,
        capabilityId: parsed.data.capabilityId,
        context: parsed.data.context
      });
      const result = await runAgent(
        toAgentRequest({
          auth: agentAuth,
          input: entryAwareInput,
          requestedSkillId: routedSkillId,
          capabilityId: normalizeIpCapabilityId(parsed.data.capabilityId),
          channel: "h5"
        }),
        provider
      );
      const persistence = await persistChatResult({
        context: auth,
        input: userInput,
        result,
        provider,
          conversationId: parsed.data.conversationId,
          deviceScope: parsed.data.deviceScope
        });
      const workflow = buildWorkflowMetadata(routedSkillId, parsed.data.entry);

      return {
        tenantId: auth.tenantId,
        planCode: auth.planCode,
        dataMode: auth.source,
        action: workflow.action,
        data: workflow.data,
        checkpoint: workflow.checkpoint,
        ...persistence,
        ...result
      };
    } catch (error) {
      request.log.error(error);
      return sendChatError(reply, error);
    }
  });

  app.post("/chat/stream", async (request, reply) => {
    const parsed = chatBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    }

    const sendEvent = (event: string, data: unknown): void => {
      reply.raw.write(`event: ${event}\n`);
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const userInput = getUserInput(parsed.data);
      const auth = await resolveRequestContext(request.headers);
      const agentAuth = mergeProfileFromFrontendContext(auth, parsed.data.context);
      if (
        parsed.data.agentId === "ip_acquisition_agent" ||
        parsed.data.agentId === "agent_acquisition" ||
        parsed.data.agentId === "agent_sales"
      ) {
        const entryAwareInput = await buildEntryAwareInput({
          input: userInput,
          entry: parsed.data.entry,
          agentId: parsed.data.agentId,
          capabilityId: parsed.data.capabilityId,
          context: parsed.data.context
        });
        const agentId = parsed.data.agentId === "agent_sales" ? "agent_sales" : "agent_acquisition";
        const result = await invokeSkillViaGateway({
          requestId: parsed.data.requestId ?? randomUUID(),
          context: agentAuth,
          provider,
          agentId,
          capabilityId: normalizeLegacyCapabilityId(parsed.data.capabilityId),
          skillId: parsed.data.skillId,
          input: entryAwareInput,
          routingInput: userInput,
          conversationId: parsed.data.conversationId,
          deviceScope: parsed.data.deviceScope,
          routingSource: "legacy"
        });
        const workflow = buildWorkflowMetadata(result.skillId as SkillId, parsed.data.entry);
        reply.hijack();
        reply.raw.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no"
        });
        sendEvent("meta", {
          tenantId: auth.tenantId,
          planCode: auth.planCode,
          dataMode: auth.source,
          skillId: result.skillId,
          skillVersion: result.skillVersion,
          creditCost: result.creditCost,
          action: workflow.action,
          checkpoint: workflow.checkpoint,
          mcpCallId: result.mcpCallId
        });
        await emitStreamChunks(result.answerText, (delta) => sendEvent("delta", { delta }));
        sendEvent("done", {
          tenantId: auth.tenantId,
          planCode: auth.planCode,
          dataMode: auth.source,
          answer: result.answerText,
          action: workflow.action,
          data: workflow.data,
          checkpoint: workflow.checkpoint,
          conversationId: result.conversationId,
          agentRunId: result.agentRunId,
          skillId: result.skillId,
          skillVersion: result.skillVersion,
          creditCost: result.creditCost,
          remainingCredits: result.remainingCredits,
          qualityFlags: result.qualityFlags,
          mcpCallId: result.mcpCallId
        });
        reply.raw.end();
        return;
      }
      const requestedSkillId = resolveRequestedSkillForAgent({
        userInput,
        capabilityId: parsed.data.capabilityId,
        rawSkillId: parsed.data.skillId,
        agentId: parsed.data.agentId
      });
      const agentInput = shouldUseCurrentTurnOnlyForUploadedFacts(parsed.data.capabilityId, userInput)
        ? userInput
        : await buildInputWithConversationHistory({
            tenantId: auth.tenantId,
            conversationId: parsed.data.conversationId,
            deviceScope: parsed.data.deviceScope,
            input: userInput
          });
      const routedSkillId = constrainSkillForAgent(
        resolveRoutedSkill(userInput, requestedSkillId, parsed.data.entry),
        parsed.data.agentId
      );
      const entryAwareInput = await buildEntryAwareInput({
        input: agentInput,
        entry: parsed.data.entry,
        agentId: parsed.data.agentId,
        capabilityId: parsed.data.capabilityId,
        context: parsed.data.context
      });
      const prepared = await buildAgentMessages(
        toAgentRequest({
          auth: agentAuth,
          input: entryAwareInput,
          requestedSkillId: routedSkillId,
          capabilityId: normalizeIpCapabilityId(parsed.data.capabilityId),
          channel: "h5"
        })
      );
      const workflow = buildWorkflowMetadata(prepared.skillId, parsed.data.entry);

      if (auth.source === "database" && (auth.creditBalance ?? 0) < prepared.creditCost) {
        throw new InsufficientCreditsError();
      }

      reply.hijack();
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no"
      });
      sendEvent("meta", {
        tenantId: auth.tenantId,
        planCode: auth.planCode,
        dataMode: auth.source,
        skillId: prepared.skillId,
        skillVersion: prepared.skillVersion,
        creditCost: prepared.creditCost,
        action: workflow.action,
        checkpoint: workflow.checkpoint
      });

      const rawAnswer = await provider.complete(prepared.messages);
      const answer = await finalizeAgentAnswer({
        prepared,
        provider,
        rawAnswer
      });
      await emitStreamChunks(answer, (delta) => sendEvent("delta", { delta }));
      const result: AgentResponse = {
        skillId: prepared.skillId,
        skillVersion: prepared.skillVersion,
        tenantType: prepared.tenantType,
        answer,
        creditCost: prepared.creditCost,
        analysisMode: "fast",
        qualityFlags: inspectQuality(answer, prepared.skillId, prepared.qualityContract, prepared.messages, prepared.capabilityId)
      };
      const persistence = await persistChatResult({
        context: auth,
        input: userInput,
        result,
        provider,
        conversationId: parsed.data.conversationId,
        deviceScope: parsed.data.deviceScope
      });

      sendEvent("done", {
        tenantId: auth.tenantId,
        planCode: auth.planCode,
        dataMode: auth.source,
        action: workflow.action,
        data: workflow.data,
        checkpoint: workflow.checkpoint,
        ...persistence,
        ...result
      });
      reply.raw.end();
    } catch (error) {
      request.log.error(error);
      if (!reply.sent) {
        return sendChatError(reply, error);
      }
      sendEvent("error", {
        error:
          error instanceof InsufficientCreditsError
            ? "insufficient_credits"
            : isLoginContextError(error)
              ? "login_required"
              : isSubscriptionContextError(error)
                ? "subscription_required"
              : "agent_run_failed",
        message:
          error instanceof InsufficientCreditsError
            ? "积分不足，请充值积分后继续使用"
            : normalizeChatError(error)
      });
      reply.raw.end();
    }
  });

  app.post("/skill/invoke", async (request, reply) => {
    const parsed = skillInvokeBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    }

    try {
      const auth = await resolveRequestContext(request.headers);
      const skillId = normalizeRequestedSkill(parsed.data.skill_id);
      if (!skillId) {
        return reply.code(400).send({
          error: "skill_not_found",
          message: "未找到可调用的 skill"
        });
      }

      const input = buildSkillInvokeInput(parsed.data.skill_id, parsed.data.entry, parsed.data.params);
      const result = await runAgent(
        toAgentRequest({
          auth,
          input,
          requestedSkillId: skillId,
          channel: "workbench"
        }),
        provider
      );
      const persistence = await persistChatResult({
        context: auth,
        input,
        result,
        provider
      });

      return {
        status: "success",
        tenantId: auth.tenantId,
        dataMode: auth.source,
        result: {
          skillId: result.skillId,
          skillVersion: result.skillVersion,
          answer: result.answer,
          creditCost: result.creditCost,
          qualityFlags: result.qualityFlags
        },
        ...persistence
      };
    } catch (error) {
      request.log.error(error);
      if (error instanceof InsufficientCreditsError) {
        return reply.code(402).send({
          status: "failed",
          error: "insufficient_credits",
          message: "积分不足，请充值积分后继续使用"
        });
      }
      return reply.code(403).send({
        status: "failed",
        error: "skill_invoke_failed",
        message: normalizeChatError(error)
      });
    }
  });
}

const CHAT_ROUTE_RULES: Array<{ skillId: SkillId; patterns: RegExp[] }> = [
  {
    skillId: "general_qa",
    patterns: [/记忆不对|经营记忆.*不对|画像.*不对|信息不对|资料.*不对|清空.*记忆|重新告诉|重新开始|更新.*记忆|修改.*记忆|重新录入/]
  },
  {
    skillId: "customer_acquisition_diagnosis",
    patterns: [
      /获客成交.*诊断|获客.*链路|链路体检|获客体检|成交体检|诊断.*获客|获客.*诊断/,
      /我要获客|想做获客|同城获客|引流|来客户|来客|私信承接|到店转化/,
      /招商诊断|招商.*体检|招商.*链路|找加盟商|加盟商|招商|加盟|扩大规模|签约|到司考察/
    ]
  },
  { skillId: "enterprise_diagnosis_orchestrator", patterns: [/全企业.*诊断|系统.*诊断|六大.*板块|企业体检|经营体检|深度诊断|综合诊断|系统体检/] },
  { skillId: "supply_chain_diagnosis", patterns: [/供应链|采购|库存|损耗|品控|供应商|缺货|滞销|仓储|物料|原料|交付周期|成本波动/] },
  { skillId: "implementation_supervision_scheduler", patterns: [/督促|提醒.*执行|监督落地|任务逾期|今天干啥|明天干啥|每日任务|陪跑执行|闯关|落地进度/] },
  { skillId: "industry_benchmark_diagnosis", patterns: [/行业对标|行业差距|同行|成熟商家|行业水平|对标诊断|风险阈值|行业口径/] },
  { skillId: "baolu_live_review_engine", patterns: [/直播复盘|复盘.{0,12}直播|直播数据|场观|停留|在线峰值|直播间.*复盘/] },
  { skillId: "baolu_review_engine", patterns: [/视频数据复盘|视频复盘|复盘视频|作品复盘|复盘.*短视频|播放.*完播率|完播率|短视频.*复盘|作品.*数据/] },
  { skillId: "baolu_dreamina_video", patterns: [/即梦|AI视频|生成视频|图生视频|文生视频|数字人视频|视频生成/] },
  { skillId: "live_script_planner", patterns: [/直播脚本|直播话术|直播间脚本|直播开场|直播留人|憋单|团购直播|直播怎么播/] },
  { skillId: "ip_positioning", patterns: [/IP定位|老板IP|品牌IP|个人IP|人设|定位|卖点|账号定位|主页|昵称|简介/i] },
  { skillId: "sales_growth_advisor", patterns: [/销售|成交|问价|私聊|跟进|逼单|转化|异议|不成交|客资|线索|咨询.*成交|到店.*成交/] },
  { skillId: "baolu_finance_advisor", patterns: [/财务|利润|毛利|成本|现金流|客单价|定价|亏损|回本|盈亏|食材成本|房租|人工成本/] },
  { skillId: "delivery_standardization", patterns: [/交付|服务流程|SOP|标准化|复购|客诉|体验|口碑|售后|交付标准|门店复制/] },
  { skillId: "hr_director_consultant", patterns: [/员工|团队|招聘|招人|排班|培训|绩效|提成|岗位|店长|管理.*员工|老板太累/] },
  { skillId: "baolu_shangxueyuan", patterns: [/商学院|培训体系|督导|课程|加盟商培训|门店培训|复制体系|标准课件|考试|作业/] },
  { skillId: "baolu_content_creator", patterns: [/朋友圈.*短视频|短视频.*朋友圈|短视频|脚本|文案|口播|图文|小红书|拍什么|发什么|选题|标题|钩子|种草|内容获客|食欲|购买欲望|到店欲望/] },
  { skillId: "moments_generator", patterns: [/朋友圈|私域|社群|微信文案|老客复购|复购文案|成交朋友圈|私域承接/] },
  { skillId: "digital_twin_factory", patterns: [/企业AI分身|数字分身定制|数字分身|AI分身|客服分身|销售分身|招商顾问分身|老师分身|专家分身|AI交付分身/] },
  { skillId: "yuanshen_factory", patterns: [/老板思维模型|经营判断分身|老板经验沉淀|思维克隆|克隆体|元神|决策分身|老板决策|帮我决策/] },
  { skillId: "ai_daily_brief", patterns: [/AI日报|日报|趋势|资讯|AI改造|企业改造|行业变化/] }
];

const SKILL_ALIASES: Record<string, SkillId> = {
  "baolu-topics": "baolu_topics",
  "customer-acquisition-diagnosis": "customer_acquisition_diagnosis",
  "ip-positioning": "ip_positioning",
  "baolu-content-creator": "baolu_content_creator",
  "moments-generator": "moments_generator",
  "baolu-ad-manager": "baolu_ad_manager",
  "sales-growth-advisor": "sales_growth_advisor",
  "live-script-planner": "live_script_planner",
  "video-review-engine": "baolu_review_engine",
  "baolu-live-review-engine": "baolu_live_review_engine",
  "yuanshen-factory": "yuanshen_factory",
  "franchise-recruitment-system": "franchise_recruitment_system",
  "franchise-compliance-checker": "franchise_compliance_checker",
  "enterprise-diagnosis-orchestrator": "enterprise_diagnosis_orchestrator",
  "supply-chain-diagnosis": "supply_chain_diagnosis",
  "implementation-supervision-scheduler": "implementation_supervision_scheduler",
  "industry-benchmark-diagnosis": "industry_benchmark_diagnosis",
  "brand-consultant": "brand_consultant",
  "digital-twin-factory": "digital_twin_factory",
  "enterprise-ai-avatar": "digital_twin_factory",
  "owner-thinking-model": "yuanshen_factory",
  "decision-avatar": "yuanshen_factory",
  "supervision-scheduler": "general_qa",
  "checkpoint-system": "general_qa"
};

const AGENT_SKILL_ALLOWLIST: Record<AgentId, Set<SkillId>> = {
  ip_acquisition_agent: new Set<SkillId>([
    "baolu_topics",
    "ai_daily_brief",
    "industry_benchmark_diagnosis",
    "baolu_content_creator",
    "optimize_local_push_ads",
    "dou_plus_ads",
    "baolu_review_engine",
    "live_script_planner",
    "moments_generator"
  ])
};

const AGENT_DEFAULT_SKILL: Record<AgentId, SkillId> = {
  ip_acquisition_agent: "baolu_content_creator"
};

function normalizeRequestedSkill(skillId?: string): SkillId | undefined {
  if (!skillId) return undefined;
  const normalized = skillId.trim();
  const alias = SKILL_ALIASES[normalized];
  if (alias) return alias;
  const underscore = normalized.replace(/-/g, "_");
  return underscore in SKILL_MANIFESTS ? (underscore as SkillId) : undefined;
}

function normalizeAgentId(agentId?: string): AgentId | undefined {
  return agentId === "ip_acquisition_agent" ? agentId : undefined;
}

function normalizeIpCapabilityId(capabilityId?: string): IpCapabilityId | undefined {
  if (
    capabilityId === "topic_inspiration" ||
    capabilityId === "industry_hotspots" ||
    capabilityId === "content_nine_piece" ||
    capabilityId === "paid_traffic" ||
    capabilityId === "dou_plus_traffic" ||
    capabilityId === "shooting_editing" ||
    capabilityId === "video_review" ||
    capabilityId === "live_script" ||
    capabilityId === "live_review" ||
    capabilityId === "franchise_acquisition" ||
    capabilityId === "moments_private"
  ) {
    return capabilityId;
  }
  return undefined;
}

function skillForIpCapability(capabilityId?: string): SkillId | undefined {
  const normalized = normalizeIpCapabilityId(capabilityId);
  if (normalized === "topic_inspiration") return "baolu_topics";
  if (normalized === "industry_hotspots") return "ai_daily_brief";
  if (normalized === "content_nine_piece") return "baolu_content_creator";
  if (normalized === "paid_traffic") return "optimize_local_push_ads";
  if (normalized === "dou_plus_traffic") return "dou_plus_ads";
  if (normalized === "shooting_editing") return "baolu_content_creator";
  if (normalized === "video_review") return "baolu_review_engine";
  if (normalized === "live_script") return "live_script_planner";
  if (normalized === "live_review") return "baolu_live_review_engine";
  if (normalized === "franchise_acquisition") return "baolu_content_creator";
  if (normalized === "moments_private") return "moments_generator";
  return undefined;
}

function resolveRequestedSkillForAgent(params: {
  userInput: string;
  capabilityId?: string;
  rawSkillId?: string;
  agentId?: string;
}): SkillId | undefined {
  const requestedSkillId = normalizeRequestedSkill(params.rawSkillId);
  if (normalizeAgentId(params.agentId) === "ip_acquisition_agent") {
    return skillForIpCapability(params.capabilityId) ?? inferIpAcquisitionSkillFromInput(params.userInput) ?? requestedSkillId ?? forceSkillFromUserInput(params.userInput);
  }
  return requestedSkillId ?? forceSkillFromUserInput(params.userInput);
}

function constrainSkillForAgent(skillId: SkillId, rawAgentId?: string): SkillId {
  const agentId = normalizeAgentId(rawAgentId);
  if (!agentId) return skillId;
  return AGENT_SKILL_ALLOWLIST[agentId].has(skillId) ? skillId : AGENT_DEFAULT_SKILL[agentId];
}

function inferIpAcquisitionSkillFromInput(input: string): SkillId | undefined {
  const cleaned = input
    .split(/\r?\n/)
    .filter((line) => !/行业热点\/内容九件套\/拍剪优化\/视频(?:数据)?复盘\/直播话术\/朋友圈私域/.test(line))
    .join("\n");

  if (/行业热点|热点趋势|近期热点|热门话题|热点选题|蹭热点|行业趋势/.test(cleaned)) {
    return "ai_daily_brief";
  }
  if (/朋友圈|私域|私欲|发圈|微信文案|老客复购|复购文案|成交朋友圈|私域承接/.test(cleaned)) {
    return "moments_generator";
  }
  if (/直播话术|直播脚本|直播间脚本|直播开场|直播留人|憋单|团购直播|直播怎么播/.test(cleaned)) {
    return "live_script_planner";
  }
  if (/视频数据复盘|视频复盘|复盘视频|作品复盘|完播率|播放.*点赞|播放.*评论|短视频.*复盘/.test(cleaned)) {
    return "baolu_review_engine";
  }
  if (/拍剪|拍摄|剪辑|镜头|分镜|EDL|字幕节奏|封面标题|发布前检查/.test(cleaned)) {
    return "baolu_content_creator";
  }
  if (/内容九件套|完整内容执行包|选题|脚本|口播|图文|小红书|标题|钩子|种草/.test(cleaned)) {
    return "baolu_content_creator";
  }
  return undefined;
}

function forceSkillFromUserInput(input: string): SkillId | undefined {
  if (/企业AI分身|数字分身定制|数字分身|AI分身|客服分身|销售分身|招商顾问分身|老师分身|专家分身|AI交付分身/.test(input)) {
    return "digital_twin_factory";
  }
  if (/老板思维模型|经营判断分身|老板经验沉淀|思维克隆|思维克隆体|克隆体|元神|决策分身|老板决策|帮我决策/.test(input)) {
    return "yuanshen_factory";
  }
  if (isExplicitContentCreationRequest(input)) return "baolu_content_creator";
  return undefined;
}

function resolveRoutedSkill(input: string, requestedSkillId?: SkillId, entry?: EntryId): SkillId {
  if (requestedSkillId) return requestedSkillId;
  if (entry && shouldStartEntryDiagnosis(input)) return "customer_acquisition_diagnosis";
  const currentRequestSkill = routeSkillFromCurrentRequest(input);
  if (currentRequestSkill) return currentRequestSkill;
  return routeSkill(input);
}

function routeSkillFromCurrentRequest(input: string): SkillId | undefined {
  if (/选题灵感|TOP\s*10.*选题|选题.*TOP\s*10|四来源.*选题|根据.*(?:录音|知识库|账号数据|对标).*选题/.test(input)) return "baolu_topics";
  if (isExplicitContentCreationRequest(input)) return "baolu_content_creator";
  return CHAT_ROUTE_RULES.find((rule) => rule.patterns.some((pattern) => pattern.test(input)))?.skillId;
}

function isExplicitContentCreationRequest(input: string): boolean {
  return /写|生成|来一条|给.*条|发什么|拍什么|选题|口播/.test(input)
    && /朋友圈|短视频|文案|脚本|小红书|图文|标题|钩子/.test(input);
}

function getUserInput(data: { input?: string; prompt?: string }): string {
  return (data.input ?? data.prompt ?? "").trim();
}

function normalizeLegacyCapabilityId(value?: string): string | undefined {
  const aliases: Record<string, string> = {
    content_nine_piece: "content_plan",
    moments_private: "private_domain"
  };
  return value ? aliases[value] ?? value : undefined;
}

function shouldStartEntryDiagnosis(input: string): boolean {
  return /开始|诊断|体检|获客|引流|来客|来客户|成交|招商|加盟|签约|扩大规模|线索/.test(input);
}

export async function buildEntryAwareInput(params: {
  input: string;
  entry?: EntryId;
  agentId?: string;
  capabilityId?: string;
  context?: Record<string, unknown>;
}): Promise<string> {
  if (!params.entry && !params.context && !params.agentId && !params.capabilityId) return params.input;
  const entryName = params.entry === "franchise" ? "连锁品牌" : params.entry === "local" ? "本地商家" : "未指定";
  const userInput = params.input.includes("用户这次说：") ? params.input : `用户这次说：${params.input}`;
  const intelContext = await buildIpCapabilityIntelContext(params.capabilityId, params.input);
  const lines = [
    `当前入口：${entryName}`,
    "产品要求：用户只和思潼对话。先诊断，再交付；能自动做的由 AI 做，需要用户执行的拆成任务；输出要带情绪价值和下一步推进。",
    buildAgentBoundary(params.agentId),
    buildCapabilityBoundary(params.capabilityId),
    intelContext,
    params.context ? `前端上下文：${JSON.stringify(params.context)}` : undefined,
    "",
    userInput
  ].filter(Boolean);
  return lines.join("\n");
}

export async function buildIpCapabilityIntelContext(
  capabilityId: string | undefined,
  input: string,
  fallbackIndustry = "",
  options: { includeIndustryHotspots?: boolean; includeCompetitorSignals?: boolean } = {}
): Promise<string | undefined> {
  const normalized = normalizeIpCapabilityId(capabilityId);
  if (normalized === "topic_inspiration") {
    const includeIndustryHotspots = options.includeIndustryHotspots !== false;
    const includeCompetitorSignals = options.includeCompetitorSignals !== false;
    if (!includeIndustryHotspots && !includeCompetitorSignals) {
      return [
        "【四大来源自动采集｜公开部分】",
        "本轮未选择行业热点或对标账号；系统不会检索或使用这两类公开来源。",
        "AI录音卡与账号数据复盘仍仅按本轮显式选择的私有材料处理。"
      ].join("\n");
    }
    const industry = extractIndustryQuery(input) || fallbackIndustry.trim();
    if (!industry) {
      return [
        "【四大来源自动采集｜公开部分】",
        "行业与用户热点：当前企业资料没有可用行业或品类，公开检索未启动；私有知识和账号数据仍由系统继续扫描。",
        "同行与对标内容：未指定行业或对标账号，公开检索未启动。",
        "不得因此只返回补资料问题；请基于已确认主体与目标完成第一版，并把公开来源标为待补。"
      ].join("\n");
    }
    const peerSources = includeCompetitorSignals ? buildCompetitorSignalSources(input, industry).slice(0, 12) : [];
    const [trendScan, peerSettled] = await Promise.all([
      includeIndustryHotspots ? scanIndustryTrends(industry, { limit: 8 }) : Promise.resolve(undefined),
      Promise.allSettled(peerSources.map((source) => fetchCompetitorSourceSignals(source, industry)))
    ]);
    const hotspots = trendScan?.verifiedHotspots.slice(0, 5) ?? [];
    const requestedAccounts = includeCompetitorSignals ? extractCompetitorAccountQueries(input).slice(0, 6) : [];
    const peerSourceResults = peerSettled.flatMap((settled, index) => {
      if (settled.status !== "fulfilled") return [];
      const source = peerSources[index];
      return settled.value.map((item) => ({
        ...item,
        // Do not lose the user-provided account name behind a search-engine label.
        // It lets the user see which competitor each collected page came from.
        label: item.label === source.label ? source.label : `${source.label}｜${item.label}`
      }));
    });
    const peerSignals = peerSourceResults
      .filter((item, index, all) => all.findIndex((candidate) => candidate.title === item.title) === index)
      .slice(0, 8);
    const accountCoverage = requestedAccounts.map((account) => {
      const hasPublicSignal = peerSourceResults.some((item) => item.label.includes(account) || item.title.includes(account));
      return hasPublicSignal
        ? `对标账号“${account}”：已抓到可回溯的公开线索，详见下方对应来源；互动数据仍需逐条核验。`
        : `对标账号“${account}”：未找到可核验的公开主页或作品，已标为待核验；建议补充主页链接，不能用同名搜索结果冒充。`;
    });
    const retrievedAt = new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(new Date());
    return [
      "【四大来源自动采集｜公开部分】",
      `检索主体：${industry}；检索日期：${retrievedAt}（北京时间）。`,
      `行业与用户热点：${includeIndustryHotspots ? (hotspots.length ? `发现${hotspots.length}条可用行业热点` : "未发现同时满足近期、相关和可回溯标准的已核验热点") : "本轮未选择，不检索或使用。"}。`,
      ...hotspots.map((item, index) => `热点${index + 1}：${item.title}｜${item.eventType}｜日期：${item.publishedAt}｜来源：${item.source}${item.url ? `｜${item.url}` : ""}`),
      `同行与对标内容：${includeCompetitorSignals ? (peerSignals.length ? `发现${peerSignals.length}条同行公开内容线索` : "未发现可回溯的同行公开内容线索") : "本轮未选择，不检索或使用。"}。`,
      ...accountCoverage,
      ...peerSignals.map((item, index) => `对标线索${index + 1}：${item.title}｜来源：${item.label}${item.publishedAt ? `｜日期：${item.publishedAt}` : "｜日期待核验"}｜互动数据未读取，爆款状态待核验｜${item.url}`),
      "公开采集边界：只有上列带来源和URL的热点可写成已核验公开线索；同行标题仅用于提取问题与表达角度，未读取到点赞、评论或私信证据时，第一关必须标记待验证。",
      "AI录音卡、账号数据复盘由当前任务的知识库、附件和历史记录提供；没有数据时标待补，但仍须完成第一版。"
    ].join("\n");
  }
  if (normalized === "industry_hotspots") {
    const industry = extractIndustryQuery(input);
    if (!industry) {
      return [
        "【公开线索上下文：行业热点】",
        "本轮尚未指定需要抓取的行业。",
        "请用户明确填写行业或赛道后再联网检索，不得根据泛化企业资料擅自猜测。"
      ].join("\n");
    }
    const scan = await scanIndustryTrends(industry, { limit: 10 });
    const signals = scan.verifiedHotspots;
    const signalLines = signals.length
      ? signals.map((item, index) => `${index + 1}. ${item.title}｜${item.eventType}｜发布日期：${item.publishedAt}｜来源：${item.source}｜核验：${item.verificationReason}${item.url ? `｜${item.url}` : ""}`)
      : [
          "本轮没有发现同时满足“近期、明确行业事件、可核验来源、具有行业影响”的热点，不用普通观点文章或营销软文凑数。",
          "请输出待观察方向和下一轮检索关键词，不得把普通文章包装成行业热点，也不得编造新闻排名或数据。"
        ];
    const retrievedAt = new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(new Date());
    return [
      "【公开线索上下文：行业热点】",
      `抓取关键词：${industry || "用户未明确行业"}`,
      `检索日期：${retrievedAt}（北京时间）`,
      `检索链路：${scan.mode === "ai" ? "AI日报专项检索" : "通用行业热点检索"}；尝试${scan.searchedSourceCount}个页面，成功读取${scan.successfulSourceCount}个。`,
      "可用公开线索：",
      ...signalLines,
      "热点判定标准：优先采用近45天内、具有权威或一手来源的政策/监管变化、重要产品或平台发布、权威报告数据、融资并购、行业标准和重大案例；普通观点文、个人感想、课程招商和营销软文不算行业热点。",
      "使用要求：先验证线索与用户业务的相关性，再做内容创作；每个采用的热点都要保留来源名称和URL。",
      "页面未提供发布日期时必须标注“发布日期待核验”，不能把检索日期冒充发布日期；没有明确来源的数据不要写成事实。"
    ].join("\n");
  }

  return undefined;
}

async function fetchCompetitorPageSignal(url: string, label = "公开页面"): Promise<{ url: string; title: string; description: string }> {
  assertOutboundUrlAllowed("competitor public page", url, {
    domesticNetworkOnly,
    allowedHosts: domesticOutboundAllowlist
  });
  const response = await fetch(url, {
    headers: { "user-agent": "SitongCompetitorIntel/1.0", accept: "text/html,*/*" },
    signal: AbortSignal.timeout(6000)
  });
  if (!response.ok) throw new Error(`public page request failed: ${response.status}`);
  const body = await response.text();
  return {
    url,
    title: extractHtmlTitle(body) || label,
    description: extractMetaDescription(body) || extractPageSignalCandidates(body, url).slice(0, 5).map((item) => item.title).join("；")
  };
}

async function fetchCompetitorSourceSignals(
  source: { label: string; url: string; query?: string },
  researchSubject: string
): Promise<Array<{ label: string; title: string; description: string; url: string; publishedAt?: string }>> {
  assertOutboundUrlAllowed("competitor public source", source.url, {
    domesticNetworkOnly,
    allowedHosts: domesticOutboundAllowlist
  });
  const response = await fetch(source.url, {
    headers: { "user-agent": "SitongCompetitorIntel/1.0", accept: "text/html,*/*" },
    signal: AbortSignal.timeout(6000)
  });
  if (!response.ok) return [];
  const body = await response.text();
  const isDiscoveryPage = /sogou\.com\/(?:web|weixin)|\/search|search_result/.test(source.url);
  if (!isDiscoveryPage) {
    const title = extractHtmlTitle(body) || source.label;
    const description = extractMetaDescription(body) || "用户提供的公开页面，互动数据需以页面显示为准";
    return [{ label: source.label, title, description, url: source.url }];
  }
  const tokens = `${researchSubject} ${source.query ?? ""}`
    .split(/[\s，。、“”‘’；;：:（）()[\]【】{}<>《》|/\\]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
  return extractPageSignalCandidates(body, source.url)
    .map((item) => ({
      ...item,
      score: scoreCompetitorSignal(item.title, tokens, item.publishedAt)
        - (researchSubject && !item.title.includes(researchSubject) ? 8 : 0)
    }))
    .filter((item) => item.score >= 4 && Boolean(item.url))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((item) => ({
      // Keep the requested-account source label. Search result sites often
      // replace it with their own domain, which made named accounts invisible.
      label: source.label,
      title: item.title,
      description: "公开搜索命中的内容选题原型；互动数据未读取，爆款状态待核验",
      url: item.url ?? source.url,
      publishedAt: item.publishedAt
    }));
}

function scoreCompetitorSignal(title: string, tokens: string[], publishedAt?: string): number {
  let score = 0;
  if (/短视频|视频|选题|文案|口播|老板|企业|AI|人工智能|智能体|Agent|改造|落地/i.test(title)) score += 4;
  if (/为什么|怎么|别再|避坑|真相|方法|步骤|案例|老板|企业|成本|效果|增长|获客|转化/.test(title)) score += 3;
  score += tokens.filter((token) => title.includes(token)).length * 2;
  if (/首页|搜索结果|登录|注册|联系我们|下一页|上一页|免责声明|招聘|企业推广|关于搜狗|搜狗服务/.test(title)) score -= 10;
  if (publishedAt) {
    const ageDays = (Date.now() - new Date(`${publishedAt}T00:00:00+08:00`).getTime()) / 86_400_000;
    if (ageDays <= 30) score += 5;
    else if (ageDays <= 90) score += 2;
    else if (ageDays > 180) score -= 12;
  }
  return score;
}

export function buildCompetitorSignalSources(input: string, fallbackIndustry = ""): Array<{ label: string; url: string; query?: string }> {
  const urls = extractPublicUrls(input).map((url) => ({ label: "用户提供链接", url }));
  const accounts = extractCompetitorAccountQueries(input).slice(0, 6);
  if (accounts.length === 0) {
    const industry = fallbackIndustry.trim();
    if (!industry) return urls;
    const genericQueries = [
      `${industry} 抖音 用户问题 案例`,
      `${industry} 视频号 避坑 方法`,
      `${industry} 小红书 消费者 关注`,
      `${industry} 短视频 热门 选题`
    ];
    return uniqueByUrl([
      ...urls,
      ...genericQueries.flatMap((query, index) => [
        { label: `同行公开网页检索${index + 1}`, query, url: `https://www.sogou.com/web?query=${encodeURIComponent(query)}` },
        { label: `同行微信内容检索${index + 1}`, query, url: `https://weixin.sogou.com/weixin?type=2&query=${encodeURIComponent(query)}` }
      ])
    ]);
  }
  return uniqueByUrl([
    ...urls,
    ...accounts.flatMap((account) => {
      const sources = buildCompetitorAccountSources(account, input, fallbackIndustry);
      const primary = sources.find((item) => /^(?:抖音|小红书|视频号)公开/.test(item.label)) ?? sources[0];
      const publicSearch = sources.find((item) => item.label.startsWith("公开网页搜索"))
        ?? sources.find((item) => item.label.startsWith("模糊账号搜索"));
      return [primary, publicSearch].filter((item): item is { label: string; url: string; query?: string } => Boolean(item));
    })
  ]);
}

function buildCompetitorAccountSources(account: string, input: string, fallbackIndustry = ""): Array<{ label: string; url: string; query?: string }> {
  const encoded = encodeURIComponent(account);
  const inferred: Array<{ label: string; url: string; query?: string }> = [];
  if (/抖音|douyin/i.test(input)) {
    inferred.push({ label: `抖音公开搜索：${account}`, url: `https://www.douyin.com/search/${encoded}?type=general` });
  }
  if (/小红书|xiaohongshu|xhs/i.test(input)) {
    inferred.push({ label: `小红书公开搜索：${account}`, url: `https://www.xiaohongshu.com/search_result?keyword=${encoded}` });
  }
  if (/视频号|微信|channels/i.test(input)) {
    inferred.push({ label: `视频号公开页面：${account}`, url: `https://channels.weixin.qq.com/platform/search?keyword=${encoded}` });
  }
  if (inferred.length === 0) {
    inferred.push(
      { label: `抖音公开搜索：${account}`, url: `https://www.douyin.com/search/${encoded}?type=general` },
      { label: `小红书公开搜索：${account}`, url: `https://www.xiaohongshu.com/search_result?keyword=${encoded}` }
    );
  }
  const platformKeyword = /抖音/.test(input) ? "抖音" : /小红书/.test(input) ? "小红书" : /视频号|微信/.test(input) ? "视频号" : "短视频";
  const publicQuery = `${account} ${platformKeyword} 账号`;
  const articleQuery = `${account} ${platformKeyword} 视频`;
  const fuzzyQueries = [
    `"${account}" ${platformKeyword}`,
    `${account} ${platformKeyword} 主页`,
    `${account} ${platformKeyword} ${fallbackIndustry || "老板 商业思维"}`
  ];
  inferred.push(
    { label: `公开网页搜索：${account}`, query: publicQuery, url: `https://www.sogou.com/web?query=${encodeURIComponent(publicQuery)}` },
    ...fuzzyQueries.map((query, index) => ({
      label: `模糊账号搜索${index + 1}：${account}`,
      query,
      url: `https://www.sogou.com/web?query=${encodeURIComponent(query)}`
    })),
    { label: `微信文章搜索：${account}`, query: articleQuery, url: `https://weixin.sogou.com/weixin?type=2&query=${encodeURIComponent(articleQuery)}` }
  );
  return inferred;
}

export interface CompetitorAccountCandidate {
  displayName: string;
  platform: "抖音" | "小红书" | "视频号" | "哔哩哔哩" | "西瓜视频" | "待确认";
  confidence: "high" | "medium";
  evidenceType: "profile" | "content_mention";
  evidenceTitle: string;
  url?: string;
  score: number;
}

export function rankCompetitorAccountCandidates(
  account: string,
  input: string,
  signals: Array<{ title: string; url?: string }>
): CompetitorAccountCandidate[] {
  const query = normalizeCompetitorName(account);
  if (query.length < 2) return [];
  const candidates = signals.flatMap((signal) => {
    const normalizedTitle = normalizeCompetitorName(signal.title);
    const similarity = competitorNameSimilarity(query, normalizedTitle);
    if (!normalizedTitle.includes(query) && similarity < 0.66) return [];
    if (/招聘|游戏解说|玩了这么久|软柿子|王者荣耀|和平精英|吃鸡|电竞/.test(signal.title)) return [];
    const profileSignal = isCompetitorProfileSignal(signal.title, account, signal.url);
    const businessMention = normalizedTitle.includes(query)
      && /商业思维|短视频|视频号|企业|老板|创业|生意|AI|人工智能|智能体|管理|获客|直播/i.test(signal.title);
    if (!profileSignal && !businessMention) return [];
    const displayName = inferCompetitorDisplayName(signal.title, account);
    const evidencePlatform = inferCompetitorPlatform(`${signal.title} ${signal.url ?? ""}`);
    const platform = evidencePlatform === "待确认" ? inferCompetitorPlatform(input) : evidencePlatform;
    let score = Math.round(similarity * 20);
    if (normalizedTitle.includes(query)) score += 20;
    if (platform !== "待确认") score += 8;
    if (profileSignal) score += 12;
    else score += 4;
    if (/主页|的抖音|的主页|官方账号|账号主页/.test(signal.title)) score += 10;
    if (normalizeCompetitorName(displayName) !== query && normalizeCompetitorName(displayName).includes(query)) score += 6;
    if (/AI|人工智能|智能体|企业管理|商业思维/i.test(input) && /AI|人工智能|智能体|企业管理|商业思维/i.test(signal.title)) score += 6;
    if (/登录|注册|搜索结果|百科|新闻|招聘/.test(signal.title)) score -= 15;
    if (score < 24) return [];
    return [{
      displayName,
      platform,
      confidence: score >= 42 ? "high" as const : "medium" as const,
      evidenceType: profileSignal ? "profile" as const : "content_mention" as const,
      evidenceTitle: signal.title.slice(0, 100),
      url: signal.url,
      score
    }];
  });
  const bestByName = new Map<string, CompetitorAccountCandidate>();
  for (const candidate of candidates) {
    const key = `${candidate.platform}:${normalizeCompetitorName(candidate.displayName)}`;
    const existing = bestByName.get(key);
    if (!existing || candidate.score > existing.score) bestByName.set(key, candidate);
  }
  return [...bestByName.values()]
    .sort((left, right) => right.score - left.score || right.displayName.length - left.displayName.length)
    .slice(0, 5);
}

function buildCompetitorCandidateContext(account: string, candidates: CompetitorAccountCandidate[]): string[] {
  if (!account) return [];
  if (candidates.length === 0) {
    return [
      `账号模糊搜索：已围绕“${account}”尝试账号名、主页、平台和内容主题等组合关键词，本轮未得到可验证候选。`,
      "不得把暂时未读取到候选等同于账号不存在；可继续让用户补平台、头像、简介关键词或主页截图做二次消歧。"
    ];
  }
  const best = candidates[0];
  return [
    `账号模糊搜索：用户输入“${account}”，已进行别名、前后缀、平台和主页组合召回。`,
    `最可能匹配账号：${best.displayName}｜平台：${best.platform}｜匹配置信度：${best.confidence === "high" ? "高" : "中"}｜证据类型：${best.evidenceType === "profile" ? "账号主页特征" : "相关内容身份线索"}｜证据：${best.evidenceTitle}${best.url ? `｜${best.url}` : ""}`,
    `候选账号：${candidates.map((candidate, index) => `${index + 1}.${candidate.displayName}（${candidate.platform}，${candidate.confidence === "high" ? "高" : "中"}，${candidate.evidenceType === "profile" ? "主页" : "内容提及"}）`).join("；")}`,
    candidates.length === 1 || best.score - candidates[1].score >= 8
      ? "消歧规则：当前首选候选明显领先，可以先按该账号分析，并在结论中说明是模糊匹配结果。"
      : "消歧规则：存在多个接近候选。先列出候选与判断依据；涉及具体作品数据前，请用户用平台、头像或简介关键词确认，不能擅自合并同名账号。"
  ];
}

function inferCompetitorDisplayName(title: string, account: string): string {
  const escaped = account.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const profilePatterns = [
    new RegExp(`^\\s*抖音\\s*([\\u4e00-\\u9fa5A-Za-z0-9_·]{0,12}${escaped}[\\u4e00-\\u9fa5A-Za-z0-9_·]{0,8})\\s*$`, "i"),
    new RegExp(`^\\s*([\\u4e00-\\u9fa5A-Za-z0-9_·]{0,12}${escaped})的(?:抖音|小红书|视频号)(?:\\s*[-｜].*)?$`, "i"),
    new RegExp(`^\\s*([\\u4e00-\\u9fa5A-Za-z0-9_·]{0,12}${escaped}[\\u4e00-\\u9fa5A-Za-z0-9_·]{0,8})\\s*[-｜]\\s*(?:抖音|小红书|视频号)`, "i"),
    new RegExp(`^\\s*(${escaped}[A-Za-z0-9_·-]{0,18})的个人空间`, "i")
  ];
  for (const pattern of profilePatterns) {
    const value = title.match(pattern)?.[1]?.trim();
    if (value && value.length <= 24) return value;
  }
  return account;
}

function isCompetitorProfileSignal(title: string, account: string, url?: string): boolean {
  const escaped = account.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^抖音[^。｜-]{0,24}${escaped}$|^${escaped}的(?:抖音|小红书|视频号)|${escaped}.{0,20}(?:个人空间|账号主页|官方账号|主页)|(?:个人空间|账号主页|官方账号|主页).{0,20}${escaped})`, "i").test(title)
    || Boolean(url && /douyin\.com\/user|xiaohongshu\.com\/user\/profile|space\.bilibili\.com/i.test(url) && normalizeCompetitorName(title).includes(normalizeCompetitorName(account)));
}

function inferCompetitorPlatform(source: string): CompetitorAccountCandidate["platform"] {
  if (/抖音|douyin\.com/i.test(source)) return "抖音";
  if (/小红书|xiaohongshu\.com/i.test(source)) return "小红书";
  if (/视频号|channels\.weixin\.qq\.com/i.test(source)) return "视频号";
  if (/哔哩哔哩|bilibili\.com/i.test(source)) return "哔哩哔哩";
  if (/西瓜视频|ixigua\.com/i.test(source)) return "西瓜视频";
  return "待确认";
}

function normalizeCompetitorName(value: string): string {
  return value.toLowerCase().replace(/抖音|小红书|视频号|官方|账号|帐号|主页|[^\u4e00-\u9fa5a-z0-9]/g, "");
}

function competitorNameSimilarity(query: string, candidate: string): number {
  if (!query || !candidate) return 0;
  if (candidate.includes(query) || query.includes(candidate)) return Math.min(query.length, candidate.length) / Math.max(query.length, candidate.length);
  const queryChars = Array.from(new Set(query));
  const overlap = queryChars.filter((char) => candidate.includes(char)).length / queryChars.length;
  let queryIndex = 0;
  for (const char of candidate) {
    if (char === query[queryIndex]) queryIndex += 1;
    if (queryIndex >= query.length) break;
  }
  const subsequence = queryIndex / query.length;
  return Math.max(overlap, subsequence);
}

export function extractCompetitorAccountQuery(input: string): string {
  return extractCompetitorAccountQueries(input)[0] ?? "";
}

export function extractCompetitorAccountQueries(input: string): string[] {
  const candidates: string[] = [];
  const addCandidate = (value: string) => {
    value
      .split(/[\n,，、;；]+/)
      .map((item) => item.replace(/^\s*(?:[-*•]|\d+[.、)、)])\s*/, "").trim())
      .map((item) => item.split(/[｜|]/).map((part) => part.trim()).find((part) => part && !/^(?:抖音|小红书|视频号|微信|账号|帐号)$/i.test(part) && !/^https?:\/\//i.test(part)) ?? "")
      .map(cleanCompetitorQuery)
      .filter((item) => item.length >= 2 && !/^待补|未填写|无$/.test(item))
      .forEach((item) => candidates.push(item));
  };

  const structuredBlock = input.match(/【来源二[｜|]对标账号】([\s\S]*?)(?=\n【|$)/)?.[1] ?? "";
  if (structuredBlock) {
    structuredBlock.split("\n").forEach((line) => {
      if (/^(?:对标线索|只能够|只能|同行标题|同行与|互动数据|公开采集边界|模糊账号)/.test(line.trim())) return;
      addCandidate(line);
    });
  }
  const patterns = [
    /(?:对标竞品|竞品|对标对象)(?:账号(?:名)?)?[：:是为叫\s]+([^。\n，,；;]{2,50})/,
    /(?:账号名|对标账号(?:名)?|竞品账号(?:名)?|抖音号|小红书账号(?:名)?|视频号)[：:\s]+([^。\n，,；;]{2,50})/,
    /对标([^。\n，,；;]{2,50})/,
    /看看([^。\n，,；;]{2,50})(?:最近|账号|动态)/
  ];
  for (const pattern of patterns) {
    const value = input.match(pattern)?.[1]?.trim();
    if (value) addCandidate(value);
  }
  return Array.from(new Set(candidates)).slice(0, 6);
}

function cleanCompetitorQuery(value: string): string {
  return value
    .replace(/^(抖音|小红书|视频号|对标竞品|竞品|对标对象|账号|帐号|号|是|为|叫|：|:)+/g, "")
    .replace(/(最近发什么|最新动态|爆款结构|我能学什么|主页链接|作品链接).*$/g, "")
    .trim()
    .slice(0, 40);
}

function uniqueByUrl<T extends { label: string; url: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (!item.url || seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });
}

export function extractIndustryQuery(input: string): string {
  const bracket = input.match(/【行业\/品类】([^。\n]+)/)?.[1];
  if (bracket) return cleanIndustryQuery(bracket);
  const explicit = input.match(/(?:^|[\n。；;])\s*(?:行业|品类)\s*[：:]\s*([^。\n，,；;]{2,24})/m)?.[1];
  if (explicit) return cleanIndustryQuery(explicit);
  const aiTransformation = input.match(/(?:AI企业改造|企业AI改造|企业智能化改造|企业改造|AI改造)/)?.[0];
  if (aiTransformation) return aiTransformation.includes("AI") ? aiTransformation : "AI企业改造";
  const beforeIndustry = input.match(/(?:抓取|分析|看看|查一下|搜索|了解)?\s*([^。\n，,；;]{2,20}?)(?:行业|赛道|领域)(?:的|近期|最新|热点|机会|趋势|消息)/)?.[1];
  if (beforeIndustry) return cleanIndustryQuery(beforeIndustry);
  const doing = input.match(/(?:我是|我们是|我做|我们做|做)\s*([^。\n，,；;]{2,24})/)?.[1];
  if (doing) return cleanIndustryQuery(doing);
  const direct = input.match(/(?:行业|品类)[：:是为\s]*([^。\n，,；;]{2,24})/)?.[1];
  if (direct && !/^的/.test(direct.trim())) return cleanIndustryQuery(direct);
  return "";
}

function cleanIndustryQuery(value: string): string {
  return value
    .replace(/^(?:请|帮我|给我|抓取|分析|搜索|看看|查一下|了解)+/, "")
    .replace(/^(?:一家|一个|做)/, "")
    .replace(/行业的?.*$/g, "")
    .replace(/(客户|全国|本地|抖音|视频号|小红书|想知道|近期|热点).*$/g, "")
    .replace(/[，。,；;\s]+$/g, "")
    .trim()
    .slice(0, 24);
}

function extractPublicUrls(input: string): string[] {
  return Array.from(new Set((input.match(/https?:\/\/[^\s，。；;）)】]+/g) ?? []).map((url) => url.trim())));
}

function extractPageSignalCandidates(body: string, sourceUrl: string): Array<{ title: string; url?: string; publishedAt?: string; sourceLabel?: string }> {
  const candidates: Array<{ title: string; url?: string; publishedAt?: string; sourceLabel?: string }> = [];
  for (const match of body.matchAll(/<li[^>]+id=["']sogou_vr_11002601_box_\d+["'][^>]*>([\s\S]*?)<\/li>/gi)) {
    const item = match[1];
    const titleMatch = item.match(/<h3[^>]*>[\s\S]*?<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h3>/i);
    if (!titleMatch) continue;
    const timestamp = Number(item.match(/timeConvert\(['"]?(\d{9,13})['"]?\)/i)?.[1]);
    const publishedAt = Number.isFinite(timestamp)
      ? new Date(timestamp * (timestamp < 10_000_000_000 ? 1000 : 1)).toISOString().slice(0, 10)
      : undefined;
    const rawSourceLabel = stripHtml(item.match(/<span[^>]+class=["']all-time-y2["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? "").trim();
    const sourceLabel = rawSourceLabel.length >= 2 && rawSourceLabel.length <= 50 ? rawSourceLabel : undefined;
    const title = normalizeSignalTitle(stripHtml(titleMatch[2]));
    if (title) candidates.push({ title, url: normalizeCandidateUrl(titleMatch[1], sourceUrl), publishedAt, sourceLabel });
  }
  for (const match of body.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]{6,220}?)<\/a>/gi)) {
    const href = match[1];
    const title = normalizeSignalTitle(stripHtml(match[2]));
    if (!title) continue;
    candidates.push({ title, url: normalizeCandidateUrl(href, sourceUrl) });
  }
  for (const match of body.matchAll(/<(?:title|h1|h2|h3)[^>]*>([\s\S]{6,180}?)<\/(?:title|h1|h2|h3)>/gi)) {
    const title = normalizeSignalTitle(stripHtml(match[1]));
    if (!title) continue;
    candidates.push({ title, url: sourceUrl });
  }
  const seen = new Set<string>();
  return candidates.filter((item) => {
    const key = item.title.replace(/\s+/g, "");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 60);
}

function normalizeSignalTitle(title: string): string {
  const normalized = title
    .replace(/\s+/g, " ")
    .replace(/^[·\-—\s]+/, "")
    .replace(/[·\-—\s]+$/, "")
    .trim();
  if (normalized.length < 6 || normalized.length > 110) return "";
  if (/^\d+$/.test(normalized)) return "";
  if (/首页|搜索结果|搜狗微信搜索|相关微信公众号文章|登录|注册|联系我们|关于我们|下一页|上一页|提交后没解决问题|免责声明|京ICP/.test(normalized)) return "";
  return normalized;
}

function normalizeCandidateUrl(href: string, sourceUrl: string): string | undefined {
  if (!href || href.startsWith("javascript:") || href.startsWith("#")) return sourceUrl;
  try {
    return new URL(href, sourceUrl).toString();
  } catch {
    return sourceUrl;
  }
}

function extractHtmlTitle(body: string): string {
  return stripHtml(body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").slice(0, 120);
}

function extractMetaDescription(body: string): string {
  return stripHtml(
    body.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1] ??
      body.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i)?.[1] ??
      body.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)?.[1] ??
      ""
  ).slice(0, 180);
}

function stripHtml(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&ldquo;|&rdquo;/g, "\"")
    .replace(/&lsquo;|&rsquo;/g, "'")
    .replace(/&middot;/g, "·")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCharCode(Number.parseInt(code, 16)))
    .trim();
}

function sourceNameFromUrl(sourceUrl: string): string {
  try {
    return new URL(sourceUrl).hostname.replace(/^www\./, "");
  } catch {
    return sourceUrl;
  }
}

function buildCapabilityBoundary(capabilityId?: string): string | undefined {
  const normalized = normalizeIpCapabilityId(capabilityId);
  if (!normalized) return undefined;
  const lines: Record<IpCapabilityId, string[]> = {
    topic_inspiration: [
      "当前能力入口：选题灵感。",
      "点击后自动扫描AI录音卡、行业与用户热点、自身账号数据复盘、同行与对标内容，先形成16至20条内部候选。",
      "再做三关筛选：目标用户兴趣证据、共识层级与客资精准度标签、账号阶段配比，最终交付10条可测试选题。",
      "必须输出四大来源自动采集结果、带第一关证据状态的TOP10、配比调整建议和证据边界；禁止四维评分和综合分。",
      "缺失来源写待补或待核验，但仍先完成第一版；只做选题，不展开完整逐字稿或九件套。"
    ],
    industry_hotspots: [
      "当前能力入口：行业热点。",
      "必须围绕用户输入的行业/品类、区域、目标客户和平台，先整理近期公开热点线索和客户正在咨询的问题，再转成IP选题、内容机会和今天可执行动作。",
      "输出必须包含：行业热点速览、热点来源/线索、热点判断、IP获客机会、可蹭选题、短视频切入、朋友圈切入、直播切入、风险提醒、今日动作。",
      "必须先回答“这个行业近期有哪些热点咨询”，再回答“这些热点怎么变成IP选题”；不能直接跳到泛泛内容建议。",
      "如果没有拿到可靠实时来源，不要编造具体新闻、账号数据或热榜排名；要明确写“公开实时数据待补”，并基于行业逻辑给可验证的热点方向和检索关键词。",
      "禁止输出内容九件套，除非用户明确要求把某个热点进一步转成完整内容九件套。"
    ],
    content_nine_piece: [
      "当前能力入口：内容九件套。",
      "必须按完整内容执行包逻辑输出。输出必须覆盖九项：选题、文案、拍摄脚本、拍摄注意事项、剪辑EDL、发布标题话题、发布时间、评论区引导话术、投流建议。"
    ],
    paid_traffic: [
      "当前能力入口：巨量本地推。只输出本地推/抖音本地生活的投流决策与 PREVIEW_ONLY 执行建议。",
      "先检查客户与账户身份、投放目标、地区/门店、素材、自然流量数据、历史投放、预算、承接页和转化口径；缺失信息明确写待补，不能擅自补数。",
      "固定输出：投流结论、账户身份、证据与数据口径、根因强度、P0动作、验证指标、观察条件、止损、回退方案、PREVIEW_ONLY变更单。",
      "第一版只提供建议，不得声称已经创建、启动、暂停或修改广告账户、计划和预算；未来桌面控制也必须经用户确认后执行。",
      "禁止顺带输出完整内容九件套；除非用户明确要求，只给素材修改方向和测试变量。"
    ],
    dou_plus_traffic: [
      "当前能力入口：DOU+ 投放。只处理内容加热与账号/视频测试，不混同巨量本地推。",
      "先核验视频/账号、投放目标、自然数据、承接动作、预算上限、历史结果和审核状态；无法实时核验的平台规则写待核验。",
      "固定输出：DOU+投放结论、视频/账号与目标核验、官方资料状态与规则边界、证据与诊断假设、素材测试与投放设置预览、监控指标与观察条件、止损与回退、PREVIEW_ONLY变更单、风险与待补信息。",
      "只生成投放预览，不得声称已经支付、创建、启动、暂停或提交真实 DOU+ 投放。"
    ],
    shooting_editing: [
      "当前能力入口：拍剪优化。",
      "复用内容创作里的拍摄与剪辑方法论，但只输出拍摄注意事项、镜头结构、分镜脚本、剪辑EDL、字幕/BGM/封面标题、发布前检查清单。",
      "禁止输出完整内容九件套；不要展开选题、发布时间、投流建议，除非它们服务于发布前检查。"
    ],
    video_review: [
      "当前能力入口：视频数据复盘。",
      "只分析 CSV、Excel 或已解析的数据表，不分析视频画面、口播和剪辑。",
      "必须逐行读取全部有效记录，并按 video-review-report-baolu-wechat 标准样板输出十二段：数据质量审计、数据总览、视频分层、内容结构健康度、单条深拆、完播率深层归因、互动深度分析、趋势分析、规律总结、方法论沉淀、下周期选题建议、综合诊断结论。",
      "写清计算口径与字段覆盖；缺字段时明确不可判断，不得推断行业、平台机制、画面、口播、镜头、投流或成交。",
      "禁止输出完整内容九件套、文案、直播话术、拍摄脚本或剪辑EDL。"
    ],
    live_script: [
      "当前能力入口：直播话术。",
      "必须先判断直播场景：本地生活带货、招商加盟、知识付费。不同场景话术体系不能串场。",
      "必须按直播话术策划逻辑输出。输出直播目标、场景识别、开播前检查、主播口播稿、运营配合动作、合规提醒、复盘指标。",
      "主播口播稿必须覆盖开场留人、互动、产品承接、转化、逼单、下播跟进，并且能直接照读。",
      "招商加盟场景必须包含痛点挖掘、实力背书、模型测算/数据占位、扶持保障、留资钩子和风险提示；禁止承诺稳赚、保底收益、零风险。",
      "本地生活带货场景必须围绕到店理由、团购福利、核销路径、限时限量和评论互动。",
      "禁止输出完整内容九件套、短视频拍摄脚本、剪辑EDL或投流计划。"
    ],
    live_review: [
      "当前能力入口：直播复盘。",
      "只基于用户提供的直播数据、场次记录和转化结果复盘；缺失字段必须写待补，不得编造直播间表现。",
      "输出数据质量、核心指标、流量与停留、互动与转化、问题归因、下场动作和验证指标。",
      "禁止输出完整内容九件套或冒充已经修改直播间设置。"
    ],
    franchise_acquisition: [
      "当前能力入口：招商获客。",
      "围绕招商目标客户、项目证据、内容钩子、留资承接和7天执行计划输出，不承诺稳赚、回本周期或保底收益。",
      "缺少可核验经营数据时使用待补占位，不得编造案例和收益。"
    ],
    moments_private: [
      "当前能力入口：朋友圈私域。",
      "必须按朋友圈私域逻辑输出。输出朋友圈策略、七柱内容组合、可直接发布的朋友圈文案、私聊承接话术和发布前检查。",
      "禁止输出完整内容九件套、短视频拍摄脚本、剪辑EDL或投流建议。"
    ]
  };
  return lines[normalized].join("\n");
}

function buildAgentBoundary(agentId?: string): string | undefined {
  if (normalizeAgentId(agentId) !== "ip_acquisition_agent") return undefined;
  return [
    "当前智能体：IP获客智能体。",
    "本智能体当前开放十个能力：选题灵感、行业热点、内容九件套、投流系统、拍剪优化、视频数据复盘、直播话术、直播复盘、招商获客、朋友圈私域。",
    "不要调用或输出这些隐藏能力入口：IP定位、获客体检、销售成交、AI视频生成、诊断Agent、销售Agent、交付管理Agent。",
    "如果用户要求隐藏能力，简短说明当前版本暂不开放，并引导用户从十个开放能力里继续。"
  ].join("\n");
}

function mergeProfileFromFrontendContext<T extends { profile: { tenantName: string; industry?: string; city?: string; data?: Record<string, unknown> } }>(
  auth: T,
  context?: Record<string, unknown>
): T {
  const memory = context?.memory;
  if (!memory || typeof memory !== "object" || Array.isArray(memory)) return auth;
  const memoryRecord = memory as Record<string, unknown>;
  const tenantName = stringFromMemory(memoryRecord.tenantName) ?? auth.profile.tenantName;
  const industry = stringFromMemory(memoryRecord.industry) ?? auth.profile.industry;
  const city = stringFromMemory(memoryRecord.city) ?? auth.profile.city;
  return {
    ...auth,
    profile: {
      ...auth.profile,
      tenantName,
      industry,
      city,
      data: {
        ...(auth.profile.data ?? {}),
        ...memoryRecord
      }
    }
  };
}

function stringFromMemory(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function buildSkillInvokeInput(skillId: string, entry: EntryId | undefined, params: Record<string, unknown>): string {
  const entryName = entry === "franchise" ? "连锁品牌" : entry === "local" ? "本地商家" : "未指定";
  return [
    `当前入口：${entryName}`,
    `请求调用：${skillId}`,
    "请按该 skill 的方法论输出可执行结果。",
    `参数：${JSON.stringify(params)}`
  ].join("\n");
}

function buildWorkflowMetadata(skillId: SkillId, entry?: EntryId): {
  action: "diagnose" | "generate_content" | "generate_script" | "review" | "transfer_human";
  data: Record<string, unknown>;
  checkpoint: Record<string, unknown>;
} {
  const action = inferAction(skillId);
  const cycleDays = entry === "franchise" ? 30 : 14;
  return {
    action,
    data: {
      entry: entry ?? "local",
      stage: action,
      generatedBy: "思潼",
      workflow: ["diagnose", "deliver", "supervise", "review", "rediagnose"],
      nextActions: buildNextActions(action, cycleDays)
    },
    checkpoint: {
      cycleDays,
      status: action === "diagnose" ? "diagnosis_ready" : "delivery_ready",
      taskBoardHint: "诊断完成后会拆成 AI、老板、团队三类任务"
    }
  };
}

function inferAction(skillId: SkillId): "diagnose" | "generate_content" | "generate_script" | "review" | "transfer_human" {
  if (skillId === "customer_acquisition_diagnosis" || skillId === "ip_positioning") return "diagnose";
  if (skillId === "baolu_content_creator" || skillId === "moments_generator" || skillId === "baolu_dreamina_video") return "generate_content";
  if (skillId === "sales_growth_advisor" || skillId === "live_script_planner") return "generate_script";
  if (skillId === "baolu_review_engine" || skillId === "baolu_live_review_engine" || skillId === "store_data_analyst") return "review";
  return "transfer_human";
}

function buildNextActions(action: string, cycleDays: number): string[] {
  if (action === "diagnose") {
    return [`进入${cycleDays}天工作台`, "先生成内容计划", "先生成私信/跟进话术"];
  }
  if (action === "review") return ["生成综合周报", "识别红灯维度", "进入单点再诊断"];
  return ["拆成任务", "安排明天重点", "准备复盘数据"];
}

async function buildInputWithConversationHistory(params: {
  tenantId: string;
  conversationId?: string;
  deviceScope: "desktop" | "mobile";
  input: string;
}): Promise<string> {
  if (!params.conversationId) return params.input;

  const conversation = await prisma.conversation.findFirst({
    where: {
      id: params.conversationId,
      tenantId: params.tenantId,
      deviceScope: params.deviceScope
    },
    select: { id: true }
  });
  if (!conversation) return params.input;

  const messages = await prisma.message.findMany({
    where: {
      tenantId: params.tenantId,
      conversationId: conversation.id
    },
    orderBy: {
      createdAt: "desc"
    },
    take: 8
  });
  if (messages.length === 0) return params.input;

  const history = [...messages]
    .reverse()
    .map((message) => `${message.role === "user" ? "用户" : "咨询师"}：${message.content.slice(0, 500)}`)
    .join("\n");

  return [
    "最近对话上下文：",
    history,
    "",
    "请延续上下文。如果本次用户只回复数字、价格、时间、地点、人数、比例或很短一句话，必须理解为对上一轮咨询师追问的回答。",
    "路由和本次回答优先看下面这句用户原话；上面的历史只作为理解上下文，不参与抢路由。",
    `用户这次说：${params.input}`
  ].join("\n");
}

function shouldUseCurrentTurnOnlyForUploadedFacts(capabilityId: string | undefined, input: string): boolean {
  if (normalizeIpCapabilityId(capabilityId) !== "video_review") return false;
  return /【本次用户上传\/粘贴的附件】|附件摘要|视频号动态数据明细|\.csv|\.xlsx|\.xls|关键帧|画面解析|语音\/字幕转写|用户上传了视频文件/i.test(input);
}

function sendChatError(reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }, error: unknown): unknown {
  if (error instanceof McpUnavailableError) {
    return reply.code(503).send({
      error: "service_unavailable",
      message: "Agent 服务暂时不可用，请稍后重试。"
    });
  }
  if (error instanceof InsufficientCreditsError) {
    return reply.code(402).send({
      error: "insufficient_credits",
      message: "积分不足，请充值积分后继续使用"
    });
  }
  if (isLoginContextError(error)) {
    return reply.code(401).send({
      error: "login_required",
      message: normalizeChatError(error)
    });
  }
  if (isSubscriptionContextError(error)) {
    return reply.code(403).send({
      error: "subscription_required",
      message: normalizeChatError(error)
    });
  }
  return reply.code(403).send({
    error: "agent_run_failed",
    message: normalizeChatError(error)
  });
}

function isLoginContextError(error: unknown): boolean {
  return error instanceof Error && (error.message === "missing_tenant_or_user" || error.message === "membership_not_found");
}

function isSubscriptionContextError(error: unknown): boolean {
  return error instanceof Error && error.message === "subscription_not_found";
}

function normalizeChatError(error: unknown): string {
  if (!(error instanceof Error)) return "咨询师会诊失败，请稍后重试。";
  if (error.message === "missing_tenant_or_user") {
    return "请先完成微信登录和账号绑定。";
  }
  if (error.message === "membership_not_found") {
    return "登录状态已失效，请重新登录或完成企业入驻。";
  }
  if (error.message === "subscription_not_found") {
    return "当前账号暂时无法使用，请联系服务团队。";
  }
  if (/cannot use skill|not available|requires/.test(error.message)) {
    return "当前账号暂时不能使用这个专项咨询师，请联系服务团队。";
  }
  if (/ENOENT|prompt\.md|no such file/i.test(error.message)) {
    return "这个专项咨询师正在更新方法论，我先切回思潼帮你处理。";
  }
  return error.message || "咨询师会诊失败，请稍后重试。";
}

async function emitStreamChunks(text: string, onDelta: (delta: string) => void): Promise<void> {
  for (let index = 0; index < text.length; index += 32) {
    onDelta(text.slice(index, index + 32));
  }
}

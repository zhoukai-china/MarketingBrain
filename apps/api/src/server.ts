import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import {
  env,
  validateRuntimeConfig
} from "./config/env.js";
import { createRuntimeLlmProvider } from "./services/llm-provider-factory.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerCatalogRoutes } from "./routes/catalog.js";
import { registerChatRoutes } from "./routes/chat.js";
import { registerAccountRoutes } from "./routes/account.js";
import { registerWorkbenchRoutes } from "./routes/workbench.js";
import { registerAdminRoutes } from "./routes/admin.js";
import { registerTenantRoutes } from "./routes/tenant.js";
import { registerConversationRoutes } from "./routes/conversations.js";
import { registerFeedbackRoutes } from "./routes/feedback.js";
import { registerContinuousImprovementRoutes } from "./routes/continuous-improvement.js";
import { registerFileRoutes } from "./routes/files.js";
import { registerAutomationRoutes } from "./routes/automation.js";
import { registerDesktopRoutes } from "./routes/desktop.js";
import { registerBillingRoutes } from "./routes/billing.js";
import { registerBillingAccessTokenRoutes } from "./routes/billing-access-tokens.js";
import { registerBillingConsumeRoutes } from "./routes/billing-consume.js";
import { registerCreditRoutes } from "./routes/credits.js";
import { registerAudioCardRoutes } from "./routes/audio-cards.js";
import { registerReportRoutes } from "./routes/reports.js";
import { registerProactiveRoutes } from "./routes/proactive.js";
import { registerDailyBriefRoutes } from "./routes/daily-brief.js";
import { registerDiagnosisRoutes } from "./routes/diagnosis.js";
import { registerOfflineEventRoutes } from "./routes/offline-events.js";
import { registerExportRoutes } from "./routes/exports.js";
import { registerMediaRoutes } from "./routes/media.js";
import { registerMcpRoutes } from "./routes/mcp.js";
import { registerAgentProductRoutes } from "./routes/agents.js";
import { registerAgentAdminRoutes } from "./routes/agent-admin.js";
import { registerClipLabRoutes } from "./routes/clip-lab.js";
import { registerKnowledgeBaseRoutes } from "./routes/knowledge-base.js";
import { registerCeoCockpitRoutes } from "./routes/ceo-cockpit.js";
import { registerTakeawayGrowthRoutes } from "./routes/takeaway-growth.js";
import { registerBeautyIndustryRoutes } from "./routes/beauty-industry.js";
import { registerMomentRoutes } from "./routes/moments.js";
import { registerAcquireRoutes } from "./routes/acquire.js";
import { registerLanqiReferralRoutes } from "./routes/lanqi-referrals.js";
import { registerLanqiStoreProfileRoutes } from "./routes/lanqi-store-profile.js";
import { registerLanqiDiagnosisRoutes } from "./routes/lanqi-diagnosis.js";
import { registerLanqiExecutionPlanRoutes } from "./routes/lanqi-execution-plan.js";
import { registerLanqiContentStudioRoutes } from "./routes/lanqi-content-studio.js";
  import { registerLanqiMediaGenerationRoutes } from "./routes/lanqi-media-generation.js";
  import { registerLanqiXhsPackageRoutes } from "./routes/lanqi-xhs-package.js";
import { registerLanqiBusinessQaRoutes } from "./routes/lanqi-business-qa.js";
import { registerLanqiViralSearchRoutes } from "./routes/lanqi-viral-search.js";
import { registerLanqiDashboardRoutes } from "./routes/lanqi-dashboard.js";
import { requireProductEntitlement } from "./services/access-guards.js";
import { registerViralVideoReplicationRoutes } from "./routes/viral-video-replication.js";
import { registerLanqiFirstFramePublicRoute } from "./services/lanqi-media-staging.js";
import { registerWorkbuddyMcpRoutes } from "./routes/workbuddy-mcp.js";
import { registerWechatMessageRoutes } from "./routes/wechat-messages.js";
import { registerWechatKfRoutes } from "./routes/wechat-kf.js";
import { registerWorkbuddySettingsRoutes } from "./routes/workbuddy-settings.js";
import { registerMarketplaceRoutes } from "./routes/marketplace.js";
import { registerGeoRoutes } from "./routes/geo.js";
import { ensureAgentProductCatalog } from "./services/agent-catalog.js";
import { registerBeautyDailyBriefScheduler } from "./products/beauty-industry/daily-brief-service.js";

export async function buildServer() {
  const configIssues = validateRuntimeConfig();
  if (configIssues.length > 0) {
    throw new Error(`Invalid runtime config: ${configIssues.join("; ")}`);
  }

  const app = Fastify({
    logger: true
  });

  app.setErrorHandler((error, request, reply) => {
    request.log.error(error);
    if (error.message === "missing_tenant_or_user" || error.message === "membership_not_found") {
      return reply.code(401).send({
        error: "login_required",
        message:
          error.message === "membership_not_found"
            ? "登录状态已失效，请重新登录或完成企业入驻。"
            : "请先完成微信登录和账号绑定。"
      });
    }
    if (error.message === "subscription_not_found") {
      return reply.code(403).send({
        error: "subscription_required",
        message: "当前账号暂时无法使用，请联系服务团队。"
      });
    }
    if (typeof error.statusCode === "number" && error.statusCode >= 400 && error.statusCode < 500) {
      return reply.code(error.statusCode).send({
        error: "invalid_request",
        message: error.message
      });
    }
    return reply.code(500).send({
      error: "internal_server_error",
      message: "服务暂时不可用，请稍后重试"
    });
  });

  await app.register(cors, {
    origin: true,
    credentials: true
  });
  await app.register(multipart, {
    limits: {
      fileSize: 30 * 1024 * 1024
    }
  });

  const provider = createRuntimeLlmProvider();
  await ensureAgentProductCatalog();

  await registerAuthRoutes(app);
  await registerHealthRoutes(app, provider);
  await registerCatalogRoutes(app);
  await registerTenantRoutes(app);
  await registerAccountRoutes(app);
  await registerWorkbenchRoutes(app);
  await registerAdminRoutes(app);
  await registerConversationRoutes(app);
  await registerFeedbackRoutes(app);
  await registerContinuousImprovementRoutes(app);
  await registerFileRoutes(app, provider);
  await registerAutomationRoutes(app);
  await registerDesktopRoutes(app);
  await registerBillingRoutes(app);
  await registerBillingAccessTokenRoutes(app);
  await registerBillingConsumeRoutes(app);
  await registerOfflineEventRoutes(app);
  await registerCreditRoutes(app);
  await registerAudioCardRoutes(app, provider);
  await registerReportRoutes(app, provider);
  await registerProactiveRoutes(app);
  await registerDailyBriefRoutes(app, provider);
  await registerDiagnosisRoutes(app, provider);
  await registerExportRoutes(app);
  await registerMediaRoutes(app);
  await registerMcpRoutes(app, provider);
  await registerWorkbuddyMcpRoutes(app, provider);
  await registerWorkbuddySettingsRoutes(app);
  await registerWechatMessageRoutes(app, provider);
  await registerWechatKfRoutes(app, provider);
  await registerMarketplaceRoutes(app);
  await registerAgentProductRoutes(app, provider);
  await registerAgentAdminRoutes(app, provider);
  await registerClipLabRoutes(app, provider);
  await registerKnowledgeBaseRoutes(app, provider);
  await registerCeoCockpitRoutes(app);
  await registerTakeawayGrowthRoutes(app);
  await app.register(async beautyIndustry => {
    beautyIndustry.addHook("preHandler", requireProductEntitlement("beauty-industry"));
    await registerBeautyIndustryRoutes(beautyIndustry, provider);
    await registerMomentRoutes(beautyIndustry, "/beauty-industry");
    await registerAcquireRoutes(beautyIndustry, "/beauty-industry");
  });
  registerBeautyDailyBriefScheduler(app);
  await app.register(async lanqi => {
    lanqi.addHook("preHandler", requireProductEntitlement("lanqi"));
    await registerLanqiReferralRoutes(lanqi);
    // 经营驾驶舱（板块 1）与它唯一的手输写入口「本月 4 个目标」（LQ-20）。
    await registerLanqiDashboardRoutes(lanqi);
    // 私域营销 / 公域获客是兰琪 8 板块工作台的第 3、4 块，必须挂在兰琪产品
    // 作用域内：此前它们只在 beauty-industry 作用域注册，兰琪租户调用必然 403
    // （WorkBuddy 2026-09-10 报告 Bug1）。
    // 兰琪侧注册的是 `/lanqi/...`，与美业单品的 `/beauty-industry/...` 是两套
    // 独立路径，避免同一条 path 在两个作用域重复注册，也不会把兰琪前端再打回
    // 美业作用域（那样仍然 403）。
    await registerMomentRoutes(lanqi, "/lanqi");
    await registerAcquireRoutes(lanqi, "/lanqi");
    await registerLanqiStoreProfileRoutes(lanqi);
    await registerLanqiDiagnosisRoutes(lanqi);
    await registerLanqiExecutionPlanRoutes(lanqi);
    await registerLanqiContentStudioRoutes(lanqi, provider);
    await registerLanqiMediaGenerationRoutes(lanqi, provider);
    await registerLanqiXhsPackageRoutes(lanqi, provider);
    await registerLanqiBusinessQaRoutes(lanqi, provider);
    // 兰琪专属：视频获客 · 爆款复刻的爆款检索源（抖音 / 视频号）。用户 2026-09-12 口径
    // 「爆款复刻暂时只在兰琪去用」，因此只在兰琪作用域注册，美业单品侧不挂这条路由。
    await registerLanqiViralSearchRoutes(lanqi);
  });
  await registerViralVideoReplicationRoutes(app);
  // 兰琪视频首帧图的限时签名外链：读取方是阿里云百炼的视频模型，不是登录用户，
  // 所以必须注册在兰琪产品 entitlement 作用域之外，只用签名校验。
  registerLanqiFirstFramePublicRoute(app);
  await registerChatRoutes(app, provider);
  await registerGeoRoutes(app, provider);

  return app;
}

const app = await buildServer();
await app.listen({ port: env.PORT, host: env.API_HOST });

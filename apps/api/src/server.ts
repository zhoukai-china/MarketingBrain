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
import { registerLanqiReferralRoutes } from "./routes/lanqi-referrals.js";
import { registerLanqiStoreProfileRoutes } from "./routes/lanqi-store-profile.js";
import { registerLanqiDiagnosisRoutes } from "./routes/lanqi-diagnosis.js";
import { registerLanqiExecutionPlanRoutes } from "./routes/lanqi-execution-plan.js";
import { registerLanqiContentStudioRoutes } from "./routes/lanqi-content-studio.js";
  import { registerLanqiMediaGenerationRoutes } from "./routes/lanqi-media-generation.js";
  import { registerLanqiXhsPackageRoutes } from "./routes/lanqi-xhs-package.js";
import { registerLanqiBusinessQaRoutes } from "./routes/lanqi-business-qa.js";
import { requireProductEntitlement } from "./services/access-guards.js";
import { registerViralVideoReplicationRoutes } from "./routes/viral-video-replication.js";
import { registerWorkbuddyMcpRoutes } from "./routes/workbuddy-mcp.js";
import { registerWechatMessageRoutes } from "./routes/wechat-messages.js";
import { registerWechatKfRoutes } from "./routes/wechat-kf.js";
import { registerWorkbuddySettingsRoutes } from "./routes/workbuddy-settings.js";
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
  await registerAgentProductRoutes(app, provider);
  await registerAgentAdminRoutes(app, provider);
  await registerClipLabRoutes(app, provider);
  await registerKnowledgeBaseRoutes(app, provider);
  await registerCeoCockpitRoutes(app);
  await registerTakeawayGrowthRoutes(app);
  await app.register(async beautyIndustry => {
    beautyIndustry.addHook("preHandler", requireProductEntitlement("beauty-industry"));
    await registerBeautyIndustryRoutes(beautyIndustry, provider);
  });
  registerBeautyDailyBriefScheduler(app);
  await app.register(async lanqi => {
    lanqi.addHook("preHandler", requireProductEntitlement("lanqi"));
    await registerLanqiReferralRoutes(lanqi);
    await registerLanqiStoreProfileRoutes(lanqi);
    await registerLanqiDiagnosisRoutes(lanqi);
    await registerLanqiExecutionPlanRoutes(lanqi);
    await registerLanqiContentStudioRoutes(lanqi, provider);
    await registerLanqiMediaGenerationRoutes(lanqi, provider);
    await registerLanqiXhsPackageRoutes(lanqi, provider);
    await registerLanqiBusinessQaRoutes(lanqi, provider);
  });
  await registerViralVideoReplicationRoutes(app);
  await registerChatRoutes(app, provider);

  return app;
}

const app = await buildServer();
await app.listen({ port: env.PORT, host: env.API_HOST });

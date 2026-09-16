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
import { registerVoiceRoutes } from "./routes/voice.js";
import { registerMcpRoutes } from "./routes/mcp.js";
import { registerAgentProductRoutes } from "./routes/agents.js";
import { registerAgentAdminRoutes } from "./routes/agent-admin.js";
import { registerClipLabRoutes } from "./routes/clip-lab.js";
import { registerKnowledgeBaseRoutes } from "./routes/knowledge-base.js";
import { registerWorkbuddyMcpRoutes } from "./routes/workbuddy-mcp.js";
import { registerWechatMessageRoutes } from "./routes/wechat-messages.js";
import { registerWechatKfRoutes } from "./routes/wechat-kf.js";
import { registerWorkbuddySettingsRoutes } from "./routes/workbuddy-settings.js";
import { registerMarketplaceRoutes } from "./routes/marketplace.js";
import { registerGeoRoutes } from "./routes/geo.js";
import { ensureAgentProductCatalog } from "./services/agent-catalog.js";
import { registerProductRoutes } from "./products/register.js";

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
  await registerVoiceRoutes(app);
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
  await registerProductRoutes(app, provider);
  await registerChatRoutes(app, provider);
  await registerGeoRoutes(app, provider);

  return app;
}

const app = await buildServer();
await app.listen({ port: env.PORT, host: env.API_HOST });

/**
 * 优雅关闭（2026-09-16 事故根治）：**重启不能打断正在生成的请求**。
 *
 * 事故：发布脚本 `systemctl restart` 时进程没有 SIGTERM 处理，Node 默认立即退出，
 * 正在跑的智能体生成（IP 定位约 21–60 秒、文案约 15–30 秒）被掐断，nginx 报
 * `connect() failed (111)` / `upstream prematurely closed connection` → 用户看到「请求失败（502）」，
 * 而且这一次生成白等（模型成本我们已付出、用户没拿到结果）。
 *
 * 现在：收到 SIGTERM/SIGINT 后调用 `app.close()`——Fastify 会先停止接受新连接，
 * **等在途请求跑完**再退出；配合 systemd `TimeoutStopSec=180`，一次正常生成不会被重启打断。
 */
let shutdownStarted = false;
async function shutdown(signal: string): Promise<void> {
  if (shutdownStarted) return;
  shutdownStarted = true;
  console.log(JSON.stringify({ event: "server_shutdown_started", signal, at: new Date().toISOString() }));
  try {
    await app.close();
    console.log(JSON.stringify({ event: "server_shutdown_finished", signal }));
  } catch (error) {
    console.error(JSON.stringify({ event: "server_shutdown_failed", signal, message: error instanceof Error ? error.message : String(error) }));
  }
  process.exit(0);
}
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    void shutdown(signal);
  });
}

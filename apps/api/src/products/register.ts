import type { FastifyInstance } from "fastify";
import type { RuntimeLlmProvider } from "../services/llm-provider-factory.js";
import { registerCeoCockpitRoutes } from "../routes/ceo-cockpit.js";
import { registerTakeawayGrowthRoutes } from "../routes/takeaway-growth.js";
import { registerBeautyIndustryRoutes } from "../routes/beauty-industry.js";
import { registerMomentRoutes } from "../routes/moments.js";
import { registerAcquireRoutes } from "../routes/acquire.js";
import { registerLanqiReferralRoutes } from "../routes/lanqi-referrals.js";
import { registerLanqiStoreProfileRoutes } from "../routes/lanqi-store-profile.js";
import { registerLanqiDiagnosisRoutes } from "../routes/lanqi-diagnosis.js";
import { registerLanqiExecutionPlanRoutes } from "../routes/lanqi-execution-plan.js";
import { registerLanqiContentStudioRoutes } from "../routes/lanqi-content-studio.js";
import { registerLanqiMediaGenerationRoutes } from "../routes/lanqi-media-generation.js";
import { registerLanqiXhsPackageRoutes } from "../routes/lanqi-xhs-package.js";
import { registerLanqiBusinessQaRoutes } from "../routes/lanqi-business-qa.js";
import { registerLanqiDashboardRoutes } from "../routes/lanqi-dashboard.js";
import { requireProductEntitlement } from "../services/access-guards.js";
import { registerViralVideoReplicationRoutes } from "../routes/viral-video-replication.js";
import { registerLanqiFirstFramePublicRoute } from "../services/lanqi-media-staging.js";
import { registerBeautyDailyBriefScheduler } from "./beauty-industry/daily-brief-service.js";

/**
 * 注册各产品专用路由（美业 / 兰琪 / 外卖 / CEO 驾驶舱 / 视频复刻等）。
 *
 * 公共平台路由仍由 server.ts 统一注册；新增产品时优先在本文件挂载，避免改动
 * server.ts。注册顺序与原 server.ts 保持一致（保持路由匹配与鉴权行为不变）。
 */
export async function registerProductRoutes(
  app: FastifyInstance,
  provider: RuntimeLlmProvider
): Promise<void> {
  await registerCeoCockpitRoutes(app);
  await registerTakeawayGrowthRoutes(app);

  await app.register(async (beautyIndustry) => {
    beautyIndustry.addHook("preHandler", requireProductEntitlement("beauty-industry"));
    await registerBeautyIndustryRoutes(beautyIndustry, provider);
    await registerMomentRoutes(beautyIndustry, "/beauty-industry");
    await registerAcquireRoutes(beautyIndustry, "/beauty-industry");
  });
  registerBeautyDailyBriefScheduler(app);

  await app.register(async (lanqi) => {
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
  });

  await registerViralVideoReplicationRoutes(app);
  // 兰琪视频首帧图的限时签名外链：读取方是阿里云百炼的视频模型，不是登录用户，
  // 所以必须注册在兰琪产品 entitlement 作用域之外，只用签名校验。
  registerLanqiFirstFramePublicRoute(app);
}

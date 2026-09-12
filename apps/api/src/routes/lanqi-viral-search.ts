/**
 * 兰琪「视频获客 · 爆款复刻」的爆款检索路由（LQ-25）。
 *
 * 路径：`POST /lanqi/acquire/video/viral-search`
 *
 * 为什么单独一个路由文件而不是并进 `acquire.ts`：
 * `registerAcquireRoutes()` 会同时被美业单品（`/beauty-industry`）复用，而用户 2026-09-12 的口径是
 * **「爆款复刻暂时只在兰琪去用」**。放在这里、只在 `server.ts` 的兰琪作用域注册，
 * 美业单品那条链路在结构上就不可能误开到同一个检索源。
 *
 * 计费口径：兰琪视频侧一期不做积分 / 定价（见 `LanqiAcquireVideoPage.tsx` 顶部硬约束），
 * 因此本路由**不扣费、不写流水、不落库**，只做「关键词 → 真实公开页面条目」的只读检索。
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@baolu/db";
import { env } from "../config/env.js";
import { resolveRequestContext } from "../services/request-context.js";
import { accessLevelForRole, assertStoreVisible } from "../services/store-access-guard.js";
import {
  VIRAL_SEARCH_ERROR_CODES,
  ViralSearchError,
  createWebSearchProvider,
  searchLanqiViralVideos,
  type ViralSearchProvider
} from "../products/lanqi/viral-search-service.js";

const VIRAL_SEARCH_SCHEMA = z.object({
  storeId: z.string().trim().min(1),
  keyword: z.string().trim().min(1).max(40),
  platform: z.enum(["all", "dy", "sph"]).default("all"),
  category: z.enum(["skin", "nail", "spa", "mix"]).optional()
});

/**
 * 检索源只由环境变量决定：
 *   未配置（默认 `disabled`）或没有凭据 → `null` → 接口失败关闭并说明「还没有开通」；
 *   配置齐全 → 走真实公开网页检索，条目全部来自真实可点开的平台页面。
 */
export function createLanqiViralSearchProvider(): ViralSearchProvider | null {
  if (env.LANQI_VIRAL_SEARCH_DRIVER !== "aliyun_web_search") return null;
  return createWebSearchProvider({
    // 生产 / 测试实例的百炼密钥历史上放在 `DASHSCOPE_API_KEY`（`ALIYUN_API_KEY` 可能为空），
    // 与兰琪其它媒体链路（`lanqi-media-generation.ts`、`media.ts`）保持同一取用顺序。
    apiKey: env.ALIYUN_API_KEY || env.DASHSCOPE_API_KEY,
    model: env.LANQI_VIRAL_SEARCH_MODEL,
    strategy: env.LANQI_VIRAL_SEARCH_STRATEGY,
    timeoutMs: env.LANQI_VIRAL_SEARCH_TIMEOUT_MS,
    domesticNetworkOnly: env.DOMESTIC_NETWORK_ONLY !== "false",
    allowedHosts: env.DOMESTIC_OUTBOUND_ALLOWLIST.split(",").map(host => host.trim().toLowerCase()).filter(Boolean)
  });
}

/** 门店隔离 + RBAC 每次请求重算（与公域获客其它接口同口径），单店角色无权检索其它门店。 */
async function assertStoreAccess(
  context: { tenantId: string; userId: string | null },
  storeId: string
): Promise<{ code: number; bodyCode: string; message: string } | null> {
  const membership = context.userId
    ? await prisma.membership.findUnique({
        where: { tenantId_userId: { tenantId: context.tenantId, userId: context.userId } },
        select: { role: true, storeId: true }
      })
    : null;
  const role = membership?.role ?? "staff";
  const access = { role, level: accessLevelForRole(role), membershipStoreId: membership?.storeId ?? null };
  const store = await prisma.store.findFirst({
    where: { id: storeId, tenantId: context.tenantId },
    select: { id: true }
  });
  if (!store || !assertStoreVisible(access, storeId).allowed) {
    return { code: 404, bodyCode: "store_not_found", message: "门店不存在或无权访问" };
  }
  return null;
}

export async function registerLanqiViralSearchRoutes(app: FastifyInstance): Promise<void> {
  app.post("/lanqi/acquire/video/viral-search", async (request, reply) => {
    try {
      const context = await resolveRequestContext(request.headers);
      const parsed = VIRAL_SEARCH_SCHEMA.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ code: "invalid_viral_search_request", message: "参数不合法" });
      }
      const denied = await assertStoreAccess(context, parsed.data.storeId);
      if (denied) return reply.code(denied.code).send({ code: denied.bodyCode, message: denied.message });

      const provider = createLanqiViralSearchProvider();
      const result = await searchLanqiViralVideos(
        {
          storeId: parsed.data.storeId,
          keyword: parsed.data.keyword,
          platform: parsed.data.platform,
          category: parsed.data.category
        },
        { provider, limit: env.LANQI_VIRAL_SEARCH_RESULT_LIMIT }
      );
      return { ok: true, tenantId: context.tenantId, result };
    } catch (error) {
      if (error instanceof ViralSearchError) {
        return reply.code(error.httpStatus).send({ code: error.code, message: error.message });
      }
      // 兜底也必须失败关闭：不返回空壳成功、不返回任何编造条目。
      return reply.code(502).send({
        code: VIRAL_SEARCH_ERROR_CODES.upstreamFailed,
        message: "检索服务这次没有返回结果（可能超时或被限流），请稍后重试。"
      });
    }
  });
}

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createHash } from "node:crypto";
import { prisma } from "@baolu/db";
import { resolveRequestContext } from "../services/request-context.js";
import {
  upgradeMoments,
  upgradeMomentsLlm,
  generateWechatGroupLlm,
  validateStoreScope,
  type MomentsUpgradeInput
} from "../products/beauty-industry/moments-service.js";
import { accessLevelForRole, assertStoreVisible, type StoreAccess } from "../services/store-access-guard.js";
import { generateMomentImage, readMomentAsset } from "../products/beauty-industry/moments-image.js";

const MOMENTS_INPUT_SCHEMA = z.object({
  storeId: z.string().trim().min(1),
  mode: z.enum(["fast", "pro"]),
  goal: z.enum(["engage", "visit", "sell", "trust", "back"]).optional(),
  tone: z.enum(["亲切大姐", "专业院长", "实在老板娘"]).optional(),
  level: z.enum(["light", "std", "deep"]).optional(),
  keepMine: z.boolean().optional(),
  raw: z.string().trim().max(2000).optional(),
  pillar: z.enum(["work", "problem", "method", "case", "value", "life", "invite"]).optional(),
  fields: z.record(z.string()).optional()
});

const INVALID_MSG =
  /还差必填|请先选择内容类型|至少 15 字|请先写一句你的原话|未知模式|缺少门店标识|参数不合法|请填写要聊的主题|请填写具体内容|违规引导词/;

/**
 * 「老板填错了」和「我们这边出故障了」的唯一分界。
 *
 * 边界：输入类 → 4xx + 原文回显（那是给老板看的填表提示）；其余 → 5xx + 只说人话。
 *
 * 导出给 `scripts/lanqi-moments-input-error-paths-smoke.ts`：用例直接拿规则层/服务层
 * **真实抛出的每一条校验文案**来过这个判定，而不是复述正则，这样以后新增一句校验提示
 * 却忘了同步正则会立刻红灯——2026-09-11 快速模式空输入就是这样从 422 退化成 500 的
 * （WorkBuddy 复测报告看到 500，把它当成了「页面坏掉 / 结果被清空」）。
 */
export function isMomentsInputError(message: string): boolean {
  return INVALID_MSG.test(message);
}

function momentRequestKey(tenantId: string, storeId: string, input: unknown): string {
  const digest = createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 32);
  return `moments:${storeId}:${digest}`;
}

/**
 * 生成失败的对外口径。
 *
 * 兰琪页面的验收条件明确要求「不暴露模型名 / 厂商名」，但 Provider 抛出的
 * `deepseek_provider_http_error`、`llm_provider_not_configured` 这类串会被前端
 * `readResponse` 直接渲染到页面上。所以这里把两类错误分开：
 * - 输入类（`INVALID_MSG`）→ 422，原文回显，因为那是给老板看的填表提示；
 * - 其余（Provider / 网络 / 未知）→ 500，只回一句能看懂的话，原始报错进服务端日志。
 */
export function userFacingGenerationError(kind: "moments" | "wechat" | "image"): string {
  if (kind === "wechat") return "群话术这次没生成出来，稍后再点一次；刚才填的内容还在，不用重填。";
  if (kind === "image") return "配图这次没生成出来，稍后再点一次；文案还在，不用重写。";
  return "文案这次没生成出来，稍后再点一次；刚才填的内容还在，不用重填。";
}

/**
 * 私域营销（朋友圈/微信群）是兰琪八板块工作台的第 3 块，同时也是美业单品的板块。
 * 同一份 handler 必须在两个产品作用域下各注册一次，路径前缀由调用方给出：
 * - 兰琪：`/lanqi`（前端 `/lanqi/stores`、`/lanqi/moments/upgrade` 等）
 * - 美业单品与手机端：`/beauty-industry`（历史路径，保持兼容）
 */
export async function registerMomentRoutes(app: FastifyInstance, basePath = "/beauty-industry"): Promise<void> {
  async function loadStoreAccess(context: { tenantId: string; userId?: string }): Promise<StoreAccess> {
    const membership = context.userId
      ? await prisma.membership.findUnique({
          where: { tenantId_userId: { tenantId: context.tenantId, userId: context.userId } },
          select: { role: true, storeId: true }
        })
      : null;
    const role = membership?.role ?? "staff";
    return { role, level: accessLevelForRole(role), membershipStoreId: membership?.storeId ?? null };
  }

  async function assertRequestStoreAccess(context: { tenantId: string; userId?: string }, storeId: string): Promise<boolean> {
    const access = await loadStoreAccess(context);
    return assertStoreVisible(access, storeId).allowed;
  }

  app.get(`${basePath}/stores`, async (request, reply) => {
    try {
      const context = await resolveRequestContext(request.headers);
      const access = await loadStoreAccess(context);
      const stores = access.level === "boss"
        ? await prisma.store.findMany({ where: { tenantId: context.tenantId }, select: { id: true, name: true, city: true }, orderBy: { createdAt: "asc" } })
        : access.membershipStoreId
          ? await prisma.store.findMany({ where: { id: access.membershipStoreId, tenantId: context.tenantId }, select: { id: true, name: true, city: true } })
          : [];
      return { ok: true, stores };
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      return reply.code(500).send({ code: "stores_error", message });
    }
  });

  app.post(`${basePath}/moments/upgrade`, async (request, reply) => {
    try {
      const context = await resolveRequestContext(request.headers);
      const parsed = MOMENTS_INPUT_SCHEMA.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({
          code: "invalid_moments_request",
          message: "参数不合法",
          details: parsed.error.flatten()
        });
      }
      const input = parsed.data as MomentsUpgradeInput;
      validateStoreScope(input);

      // 门店隔离：门店必须属于当前租户；RBAC（老板/店长/前台）在 store-access-guard 逐请求重算。
      const store = await prisma.store.findFirst({
        where: { id: input.storeId, tenantId: context.tenantId },
        select: { id: true }
      });
      if (!store) {
        return reply.code(404).send({ code: "store_not_found", message: "门店不存在或无权访问" });
      }
      if (!(await assertRequestStoreAccess(context, input.storeId))) {
        return reply.code(404).send({ code: "store_not_found", message: "门店不存在或无权访问" });
      }

      const result = await upgradeMomentsLlm(input);
      const requestKey = momentRequestKey(context.tenantId, input.storeId, parsed.data);
      const saved = await prisma.lanqiMomentUpgrade.upsert({
        where: { tenantId_requestKey: { tenantId: context.tenantId, requestKey } },
        create: {
          tenantId: context.tenantId,
          userId: context.userId ?? null,
          storeId: input.storeId,
          requestKey,
          mode: result.mode,
          pillar: result.pillar ?? null,
          goal: result.goal ?? null,
          tone: result.tone ?? null,
          level: result.level,
          keepMine: result.keepMine,
          raw: result.raw,
          body: result.body,
          core: result.core ?? null,
          rawLen: result.rawLen,
          newLen: result.newLen,
          rawScore: result.rawScore,
          newScore: result.newScore,
          issues: JSON.parse(JSON.stringify(result.issues)),
          ups: JSON.parse(JSON.stringify(result.ups)),
          checks: JSON.parse(JSON.stringify(result.checks)),
          status: "succeeded",
          traceId: result.traceId ?? null
        },
        update: {}
      });
      return { ok: true, tenantId: context.tenantId, result };
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      const invalid = isMomentsInputError(message);
      if (!invalid) request.log.error({ err: error }, "lanqi_moments_upgrade_failed");
      return reply
        .code(invalid ? 422 : 500)
        .send({
          code: invalid ? "invalid_moments_input" : "moments_error",
          message: invalid ? message : userFacingGenerationError("moments")
        });
    }
  });

  app.get(`${basePath}/moments/upgrades`, async (request, reply) => {
    try {
      const context = await resolveRequestContext(request.headers);
      const query = z
        .object({ storeId: z.string().trim().min(1), limit: z.coerce.number().int().min(1).max(50).default(10) })
        .safeParse(request.query ?? {});
      if (!query.success) return reply.code(400).send({ code: "invalid_moments_history_request", message: "参数不合法" });
      const { storeId, limit } = query.data;
      const store = await prisma.store.findFirst({
        where: { id: storeId, tenantId: context.tenantId },
        select: { id: true }
      });
      if (!store || !(await assertRequestStoreAccess(context, storeId))) {
        return reply.code(404).send({ code: "store_not_found", message: "门店不存在或无权访问" });
      }
      const items = await prisma.lanqiMomentUpgrade.findMany({
        where: { tenantId: context.tenantId, storeId, status: "succeeded" },
        orderBy: { createdAt: "desc" },
        take: limit,
        select: {
          id: true,
          requestKey: true,
          mode: true,
          pillar: true,
          goal: true,
          level: true,
          raw: true,
          body: true,
          rawLen: true,
          newLen: true,
          rawScore: true,
          newScore: true,
          createdAt: true
        }
      });
      return { ok: true, items };
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      return reply.code(500).send({ code: "moments_history_error", message });
    }
  });

  const WECHAT_SCHEMA = z.object({
    storeId: z.string().trim().min(1),
    scene: z.enum(["notice", "activity", "qa", "reactivate", "care"]),
    // 主题可选：老板把要说的话写进「具体内容」就够了，主题由服务层从内容派生。
    topic: z.string().trim().max(100).optional(),
    detail: z.string().trim().min(1).max(2000),
    tone: z.enum(["亲切大姐", "专业院长", "实在老板娘"]).optional()
  });

  app.post(`${basePath}/moments/wechat-group`, async (request, reply) => {
    try {
      const context = await resolveRequestContext(request.headers);
      const parsed = WECHAT_SCHEMA.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ code: "invalid_wechat_group_request", message: "参数不合法", details: parsed.error.flatten() });
      }
      const store = await prisma.store.findFirst({
        where: { id: parsed.data.storeId, tenantId: context.tenantId },
        select: { id: true }
      });
      if (!store || !(await assertRequestStoreAccess(context, parsed.data.storeId))) {
        return reply.code(404).send({ code: "store_not_found", message: "门店不存在或无权访问" });
      }
      const result = await generateWechatGroupLlm(parsed.data);
      const requestKey = momentRequestKey(context.tenantId, parsed.data.storeId, parsed.data);
      await prisma.lanqiMomentUpgrade.upsert({
        where: { tenantId_requestKey: { tenantId: context.tenantId, requestKey } },
        create: {
          tenantId: context.tenantId,
          userId: context.userId ?? null,
          storeId: parsed.data.storeId,
          requestKey,
          mode: "wechat",
          pillar: null,
          goal: parsed.data.scene,
          tone: result.tone,
          level: "std",
          keepMine: false,
          raw: `${result.title}\n${result.body}`,
          body: result.body,
          core: null,
          rawLen: result.rawLen,
          newLen: result.newLen,
          rawScore: 0,
          newScore: 0,
          issues: [],
          ups: [],
          checks: JSON.parse(JSON.stringify(result.checks)),
          status: "succeeded",
          traceId: result.traceId ?? null
        },
        update: {}
      });
      return { ok: true, tenantId: context.tenantId, result };
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      const invalid = isMomentsInputError(message);
      if (!invalid) request.log.error({ err: error }, "lanqi_moments_wechat_group_failed");
      return reply
        .code(invalid ? 422 : 500)
        .send({
          code: invalid ? "invalid_wechat_group_input" : "wechat_group_error",
          message: invalid ? message : userFacingGenerationError("wechat")
        });
    }
  });

  const IMAGE_SCHEMA = z.object({
    storeId: z.string().trim().min(1),
    caption: z.string().trim().min(1).max(200),
    requestKey: z.string().trim().min(1).max(120).optional()
  });

  app.post(`${basePath}/moments/image`, async (request, reply) => {
    try {
      const context = await resolveRequestContext(request.headers);
      const parsed = IMAGE_SCHEMA.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ code: "invalid_moments_image_request", message: "参数不合法", details: parsed.error.flatten() });
      }
      const store = await prisma.store.findFirst({
        where: { id: parsed.data.storeId, tenantId: context.tenantId },
        select: { id: true }
      });
      if (!store || !(await assertRequestStoreAccess(context, parsed.data.storeId))) {
        return reply.code(404).send({ code: "store_not_found", message: "门店不存在或无权访问" });
      }
      const asset = await generateMomentImage({
        tenantId: context.tenantId,
        userId: context.userId,
        storeId: parsed.data.storeId,
        caption: parsed.data.caption,
        requestKey: parsed.data.requestKey,
        // 资产 URL 跟随注册作用域：兰琪 `/lanqi` 返回的图必须仍能在 `/lanqi` 下取回。
        // 写死 `/beauty-industry` 会落到美业单品 entitlement 门禁上，兰琪租户取图 403 → 前端破图。
        assetBasePath: basePath
      });
      return { ok: true, asset };
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      request.log.error({ err: error }, "lanqi_moments_image_failed");
      return reply.code(500).send({ code: "moments_image_error", message: userFacingGenerationError("image") });
    }
  });

  app.get(`${basePath}/moments/assets/:assetId`, async (request, reply) => {
    try {
      const context = await resolveRequestContext(request.headers);
      const params = z.object({ assetId: z.string().trim().min(1) }).safeParse(request.params ?? {});
      if (!params.success) return reply.code(400).send({ code: "invalid_asset_request", message: "参数不合法" });
      const bytes = await readMomentAsset(params.data.assetId, context.tenantId);
      reply.header("content-type", "image/png");
      reply.header("cache-control", "private, max-age=3600");
      return reply.send(bytes);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      if (message === "asset_not_found") return reply.code(404).send({ code: "asset_not_found", message: "图片不存在或无权访问" });
      return reply.code(500).send({ code: "asset_error", message });
    }
  });
}

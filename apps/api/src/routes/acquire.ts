import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@baolu/db";
import { resolveRequestContext } from "../services/request-context.js";
import { accessLevelForRole, assertStoreVisible } from "../services/store-access-guard.js";
import {
  LANQI_COPY_KIT_SECTIONS,
  generateLanqiCopyKit,
  lanqiCopyKitInputHash,
  lanqiCopyKitPriceCredits,
  readLanqiCopyKitCache,
  writeLanqiCopyKitCache
} from "../products/lanqi/copy-kit-service.js";
import { chargeLanqiWallet, precheckLanqiWallet } from "../services/lanqi-wallet.js";
import { rewriteShortVideoCopy } from "../products/beauty-industry/acquire-service.js";
import { answerAdvisorQuestion } from "../products/beauty-industry/advisor-service.js";
import {
  buildLivePlan,
  generateLiveFiller,
  generateLiveSegments,
  validateLiveInput,
  type LiveInput
} from "../products/beauty-industry/live-service.js";
import {
  buildStoryboard,
  rebuildShot,
  validateVideoScriptInput,
  type StoryboardInput
} from "../products/beauty-industry/video-script-service.js";
import {
  VIDEO_COPY_DURS,
  VIDEO_COPY_PLATFORMS,
  VIDEO_COPY_STYLES,
  generateVideoCopyCandidates,
  validateVideoCopyBrief
} from "../products/beauty-industry/video-copy-service.js";

const COPYWRITER_SCHEMA = z.object({
  storeId: z.string().trim().min(1),
  raw: z.string().trim().min(1).max(3000),
  purpose: z.enum(["auto", "deal", "aware", "exposure"]).default("auto"),
  goal: z.enum(["all", "completion", "engagement", "conversion"]).default("all"),
  extra: z.string().trim().max(500).optional()
});

/**
 * 一键成片（原「文案转片」）第 1–2 步：说需求 → 后端大模型出 3 版候选文案。
 * 口径见 `2026-09-12-视频获客一期最终范围-Codex交接.md`：本期**没有手动贴文案入口**。
 */
const VIDEO_COPY_SCHEMA = z.object({
  storeId: z.string().trim().min(1),
  need: z.string().trim().min(1).max(120),
  cat: z.string().trim().max(32).default("skin"),
  style: z.enum(VIDEO_COPY_STYLES.map(style => style.k) as [string, ...string[]]).default("hook"),
  dur: z.coerce.number().int().refine(value => VIDEO_COPY_DURS.includes(value as 15 | 30 | 45), {
    message: "目标时长只支持 15 / 30 / 45 秒"
  }).default(30),
  sell: z.string().trim().max(120).default(""),
  plat: z.enum(VIDEO_COPY_PLATFORMS.map(platform => platform.k) as [string, ...string[]]).default("all"),
  round: z.coerce.number().int().min(0).max(99).default(0)
});

/**
 * LQ-33「美业文案十件套」：独立一张卡、独立计费（默认取正式 Skill 的 baseCreditCost，可 env 覆盖）。
 * 生成失败 / 信息不足 / 合同校验不过一律不扣积分；同一 requestKey 重复提交复用同一份结果。
 */
const COPY_KIT_SCHEMA = z.object({
  storeId: z.string().trim().min(1),
  brief: z.string().trim().min(1).max(1200),
  platform: z.enum(["all", "dy", "xhs", "sph"]).default("all"),
  goal: z.enum(["visit", "private", "franchise"]).default("visit"),
  requestKey: z.string().regex(/^[A-Za-z0-9_-]{12,120}$/)
});

const ADVISOR_SCHEMA = z.object({
  storeId: z.string().trim().min(1),
  question: z.string().trim().min(1).max(1000),
  platform: z.enum(["auto", "dy", "sph", "mt"]).default("auto"),
  history: z
    .array(z.object({ role: z.enum(["user", "ai"]), content: z.string().trim().max(2000) }))
    .max(6)
    .optional()
});

const INVALID_MSG = /缺少门店标识|请先贴|还差 \d+ 字|还缺一个关键信息|参数不合法|违规引导词|结构门禁|请先描述|说得具体一点/;

const LIVE_INPUT_SCHEMA = z.object({
  storeId: z.string().trim().min(1),
  host: z.string().trim().max(80).default(""),
  carries: z.array(z.enum(["团购券", "居家产品", "会员卡"])).max(3).default([]),
  main: z.string().trim().max(120).default(""),
  sell: z.string().trim().max(600).default(""),
  price: z.string().trim().max(300).default(""),
  card: z.string().trim().max(300).default(""),
  platforms: z.array(z.enum(["抖音", "视频号"])).max(2).default([])
});

const LIVE_BATCH_SCHEMA = LIVE_INPUT_SCHEMA.extend({
  batchNo: z.coerce.number().int().min(1).max(64)
});

const LIVE_INVALID_MSG =
  /还差必填|批次不存在|门店标识|请先|说得具体一点|合规门禁|主播念不动|模型|llm_output|请重新输出|请补齐|不足 3 条|是空的/;

const VIDEO_SCRIPT_SCHEMA = z.object({
  storeId: z.string().trim().min(1),
  script: z.string().trim().max(6000).default(""),
  styleKey: z.string().trim().max(32).optional(),
  splitMode: z.enum(["auto", "s10", "s5"]).default("auto"),
  castName: z.string().trim().max(40).optional(),
  sceneNames: z.array(z.string().trim().max(40)).max(12).optional(),
  propNames: z.array(z.string().trim().max(40)).max(12).optional()
});

const VIDEO_SHOT_SCHEMA = z.object({
  storeId: z.string().trim().min(1),
  text: z.string().trim().min(1).max(1200),
  styleKey: z.string().trim().max(32).optional(),
  castName: z.string().trim().max(40).optional(),
  sceneName: z.string().trim().max(40).optional(),
  propName: z.string().trim().max(40).optional(),
  index: z.coerce.number().int().min(0).max(200).default(0),
  total: z.coerce.number().int().min(1).max(400).default(1)
});

function toLiveInput(parsed: z.infer<typeof LIVE_INPUT_SCHEMA>): LiveInput {
  return {
    storeId: parsed.storeId,
    host: parsed.host,
    carries: parsed.carries,
    main: parsed.main,
    sell: parsed.sell,
    price: parsed.price,
    card: parsed.card,
    platforms: parsed.platforms
  };
}

/**
 * 公域获客是兰琪八板块工作台的第 4 块，同时也是美业单品的板块。
 * 路径前缀由调用方给出：兰琪 `/lanqi`，美业单品与手机端 `/beauty-industry`（历史路径）。
 */
export async function registerAcquireRoutes(app: FastifyInstance, basePath = "/beauty-industry"): Promise<void> {
  app.post(`${basePath}/acquire/copywriter`, async (request, reply) => {
    try {
      const context = await resolveRequestContext(request.headers);
      const parsed = COPYWRITER_SCHEMA.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ code: "invalid_acquire_request", message: "参数不合法", details: parsed.error.flatten() });
      }
      const denied = await assertStoreAccess(context, parsed.data.storeId);
      if (denied) return reply.code(denied.code).send({ code: denied.bodyCode, message: denied.message });
      const result = await rewriteShortVideoCopy(parsed.data);
      return { ok: true, tenantId: context.tenantId, result };
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      const invalid = INVALID_MSG.test(message);
      return reply.code(invalid ? 422 : 500).send({ code: invalid ? "invalid_acquire_input" : "acquire_error", message });
    }
  });

  /**
   * LQ-33「美业文案十件套」：新增一张卡、独立计费。
   * 计费口径与媒体侧一致走门店租户的积分账户（`creditAccount`）：
   *   ① 先查余额，不足直接 402，**不调模型、不扣分**；
   *   ② 模型失败 / 信息不足 / 合同校验不过 → 不扣分（只有拿到合格十件套才扣）；
   *   ③ 扣费用条件更新（`balance >= price`）保证并发不为负，并写 `creditTransaction` 流水；
   *   ④ 同一 `requestKey` 复用缓存结果，重复点击不会重复扣分。
   */
  app.post(`${basePath}/acquire/copy-kit`, async (request, reply) => {
    try {
      const context = await resolveRequestContext(request.headers);
      const parsed = COPY_KIT_SCHEMA.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ code: "invalid_copy_kit_request", message: "参数不合法", details: parsed.error.flatten() });
      }
      const denied = await assertStoreAccess(context, parsed.data.storeId);
      if (denied) return reply.code(denied.code).send({ code: denied.bodyCode, message: denied.message });

      const price = lanqiCopyKitPriceCredits();
      const requestInput = {
        brief: parsed.data.brief,
        platform: parsed.data.platform,
        goal: parsed.data.goal,
        storeName: (await prisma.store.findFirst({
          where: { id: parsed.data.storeId, tenantId: context.tenantId },
          select: { name: true }
        }))?.name
      };
      const inputHash = lanqiCopyKitInputHash(requestInput);
      const cached = await readLanqiCopyKitCache({ tenantId: context.tenantId, requestKey: parsed.data.requestKey });
      if (cached) {
        // 同键不同输入必须显式冲突：不能把上一次的结果当成这一次的需求交付。
        if (cached.inputHash !== inputHash) {
          return reply.code(409).send({
            code: "copy_kit_request_key_conflict",
            message: "这个请求标识已经生成过别的内容，请重新点一次生成（平台会换一个新的请求标识）。",
            consumedCredits: 0
          });
        }
        return {
          ok: true,
          tenantId: context.tenantId,
          cached: true,
          consumedCredits: 0,
          creditCost: cached.creditCost,
          contractVersion: cached.contractVersion,
          sections: [...LANQI_COPY_KIT_SECTIONS],
          result: { content: cached.content }
        };
      }

      /**
       * LQ-34（用户 2026-09-16）：兰琪扣的是**通用钱包**——本店老板（owner）的钱包，
       * 与「我的 · 充值」和思潼 AI 是同一本账。余额不足先挡下，**不调模型**。
       */
      const precheck = await precheckLanqiWallet({ tenantId: context.tenantId, credits: price });
      if (!precheck.ok) {
        if (precheck.code === "lanqi_wallet_owner_missing") {
          return reply.code(409).send({
            code: "lanqi_wallet_owner_missing",
            message: precheck.message,
            consumedCredits: 0
          });
        }
        return reply.code(402).send({
          code: "insufficient_credits",
          error: "insufficient_credits",
          message: precheck.message,
          balance: precheck.balance,
          required: price,
          rechargeUrl: "/recharge",
          consumedCredits: 0
        });
      }

      let generation: Awaited<ReturnType<typeof generateLanqiCopyKit>>;
      try {
        generation = await generateLanqiCopyKit({
          request: requestInput
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown";
        const notConfigured = /not_configured|未配置/.test(message);
        return reply.code(notConfigured ? 503 : 502).send({
          code: notConfigured ? "copy_kit_provider_not_configured" : "copy_kit_provider_failed",
          message: notConfigured ? "文案能力当前没有放行，本次没有生成、没有扣积分。" : "这次生成失败了，没有扣积分，请重试。",
          consumedCredits: 0
        });
      }

      if (generation.result.status === "needs_input") {
        return {
          ok: true,
          tenantId: context.tenantId,
          needsInput: true,
          consumedCredits: 0,
          message: generation.result.message
        };
      }
      if (generation.result.status === "invalid") {
        return reply.code(422).send({
          code: "copy_kit_output_invalid",
          message: "这次交付没有通过内容合同校验，没有扣积分：请把「项目 / 卖点」和「想触达的人群」说得更具体一点再试。",
          reasons: generation.result.failures.slice(0, 8),
          consumedCredits: 0
        });
      }

      // 扣费：扣本店老板的通用钱包（paid → bonus），流水记「谁操作的」；同 requestKey 不重复扣。
      const charged = await chargeLanqiWallet({
        tenantId: context.tenantId,
        operatorUserId: context.userId,
        requestId: parsed.data.requestKey,
        credits: price,
        skillId: "lanqi_copy_kit"
      });
      if (charged.status === "owner_missing") {
        return reply.code(409).send({ code: "lanqi_wallet_owner_missing", message: "本店还没有可扣费的老板账号，本次没有生成、没有扣积分。", consumedCredits: 0 });
      }
      if (charged.status === "insufficient") {
        return reply.code(402).send({
          code: "insufficient_credits",
          error: "insufficient_credits",
          message: "积分不足：这次没有生成、也没有扣积分。请点右上角「我的 · 充值」充值后再试。",
          balance: charged.wallet.balance,
          required: price,
          rechargeUrl: "/recharge",
          consumedCredits: 0
        });
      }

      await writeLanqiCopyKitCache({
        tenantId: context.tenantId,
        requestKey: parsed.data.requestKey,
        entry: {
          inputHash,
          content: generation.result.content,
          contractVersion: generation.contractVersion,
          promptHash: generation.promptHash,
          creditCost: price,
          createdAt: new Date().toISOString()
        }
      });

      return {
        ok: true,
        tenantId: context.tenantId,
        consumedCredits: price,
        balance: charged.wallet.balance,
        creditCost: price,
        contractVersion: generation.contractVersion,
        sections: [...LANQI_COPY_KIT_SECTIONS],
        result: { content: generation.result.content }
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      return reply.code(500).send({ code: "copy_kit_error", message });
    }
  });

  app.post(`${basePath}/acquire/advisor`, async (request, reply) => {
    try {
      const context = await resolveRequestContext(request.headers);
      const parsed = ADVISOR_SCHEMA.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ code: "invalid_advisor_request", message: "参数不合法", details: parsed.error.flatten() });
      }
      const denied = await assertStoreAccess(context, parsed.data.storeId);
      if (denied) return reply.code(denied.code).send({ code: denied.bodyCode, message: denied.message });
      const result = await answerAdvisorQuestion(parsed.data);
      return { ok: true, tenantId: context.tenantId, result };
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      const invalid = INVALID_MSG.test(message);
      return reply.code(invalid ? 422 : 500).send({ code: invalid ? "invalid_advisor_input" : "advisor_error", message });
    }
  });

  // 直播话术：规则先出 5 组 / 23 段骨架（不调模型，秒回），再由端按批调用生成。
  app.post(`${basePath}/acquire/live/plan`, async (request, reply) => {
    try {
      const context = await resolveRequestContext(request.headers);
      const parsed = LIVE_INPUT_SCHEMA.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ code: "invalid_live_request", message: "参数不合法", details: parsed.error.flatten() });
      }
      const denied = await assertStoreAccess(context, parsed.data.storeId);
      if (denied) return reply.code(denied.code).send({ code: denied.bodyCode, message: denied.message });
      const input = toLiveInput(parsed.data);
      const missing = validateLiveInput(input);
      if (missing.length) {
        return reply.code(422).send({ code: "invalid_live_input", message: `还差必填：${missing.join("、")}` });
      }
      return { ok: true, tenantId: context.tenantId, result: buildLivePlan(input) };
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      return reply.code(500).send({ code: "live_plan_error", message });
    }
  });

  // 直播话术：单批段落生成（单请求体量受控，避免内测网关 120s 超时）。
  app.post(`${basePath}/acquire/live/segments`, async (request, reply) => {
    try {
      const context = await resolveRequestContext(request.headers);
      const parsed = LIVE_BATCH_SCHEMA.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ code: "invalid_live_request", message: "参数不合法", details: parsed.error.flatten() });
      }
      const denied = await assertStoreAccess(context, parsed.data.storeId);
      if (denied) return reply.code(denied.code).send({ code: denied.bodyCode, message: denied.message });
      const input = toLiveInput(parsed.data);
      const missing = validateLiveInput(input);
      if (missing.length) {
        return reply.code(422).send({ code: "invalid_live_input", message: `还差必填：${missing.join("、")}` });
      }
      const result = await generateLiveSegments(input, parsed.data.batchNo);
      return { ok: true, tenantId: context.tenantId, result };
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      const invalid = LIVE_INVALID_MSG.test(message);
      return reply.code(invalid ? 422 : 500).send({ code: invalid ? "invalid_live_input" : "live_error", message });
    }
  });

  // 直播话术：通用救场话术库（5 类 × 6 条）。
  app.post(`${basePath}/acquire/live/filler`, async (request, reply) => {
    try {
      const context = await resolveRequestContext(request.headers);
      const parsed = LIVE_INPUT_SCHEMA.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ code: "invalid_live_request", message: "参数不合法", details: parsed.error.flatten() });
      }
      const denied = await assertStoreAccess(context, parsed.data.storeId);
      if (denied) return reply.code(denied.code).send({ code: denied.bodyCode, message: denied.message });
      const input = toLiveInput(parsed.data);
      const missing = validateLiveInput(input);
      if (missing.length) {
        return reply.code(422).send({ code: "invalid_live_input", message: `还差必填：${missing.join("、")}` });
      }
      const result = await generateLiveFiller(input);
      return { ok: true, tenantId: context.tenantId, result };
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      const invalid = LIVE_INVALID_MSG.test(message);
      return reply.code(invalid ? 422 : 500).send({ code: invalid ? "invalid_live_input" : "live_error", message });
    }
  });

  // 视频获客 · 文案转片：口播文案 → 分镜脚本（每镜带生视频提示词）。
  // 纯规则秒回，不调模型；真实视频生成能力单独开关，未开通时端侧 fail closed。
  app.post(`${basePath}/acquire/video/storyboard`, async (request, reply) => {
    try {
      const context = await resolveRequestContext(request.headers);
      const parsed = VIDEO_SCRIPT_SCHEMA.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ code: "invalid_video_script_request", message: "参数不合法", details: parsed.error.flatten() });
      }
      const denied = await assertStoreAccess(context, parsed.data.storeId);
      if (denied) return reply.code(denied.code).send({ code: denied.bodyCode, message: denied.message });
      const input: StoryboardInput = {
        script: parsed.data.script,
        styleKey: parsed.data.styleKey,
        splitMode: parsed.data.splitMode,
        castName: parsed.data.castName,
        sceneNames: parsed.data.sceneNames,
        propNames: parsed.data.propNames
      };
      const missing = validateVideoScriptInput(input);
      if (missing.length) {
        return reply.code(422).send({ code: "invalid_video_script_input", message: `还差必填：${missing.join("、")}` });
      }
      return { ok: true, tenantId: context.tenantId, result: buildStoryboard(input) };
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      return reply.code(500).send({ code: "video_script_error", message });
    }
  });

  // 视频获客 · 文案转片：重写单镜（改风格 / 换素材后重出一版画面描述与提示词）。
  app.post(`${basePath}/acquire/video/shot`, async (request, reply) => {
    try {
      const context = await resolveRequestContext(request.headers);
      const parsed = VIDEO_SHOT_SCHEMA.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ code: "invalid_video_shot_request", message: "参数不合法", details: parsed.error.flatten() });
      }
      const denied = await assertStoreAccess(context, parsed.data.storeId);
      if (denied) return reply.code(denied.code).send({ code: denied.bodyCode, message: denied.message });
      const { storeId: _storeId, ...shotInput } = parsed.data;
      return { ok: true, tenantId: context.tenantId, result: rebuildShot(shotInput) };
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      const invalid = /是空的|请先补上/.test(message);
      return reply.code(invalid ? 422 : 500).send({ code: invalid ? "invalid_video_shot_input" : "video_shot_error", message });
    }
  });

  // 一键成片 · 第 1–2 步：说需求 → 3 版候选文案（真实大模型，前端不拼模板）。
  app.post(`${basePath}/acquire/video/copy-candidates`, async (request, reply) => {
    try {
      const context = await resolveRequestContext(request.headers);
      const parsed = VIDEO_COPY_SCHEMA.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ code: "invalid_video_copy_request", message: "参数不合法", details: parsed.error.flatten() });
      }
      const denied = await assertStoreAccess(context, parsed.data.storeId);
      if (denied) return reply.code(denied.code).send({ code: denied.bodyCode, message: denied.message });

      const brief = validateVideoCopyBrief(parsed.data);
      if (!brief.ok) return reply.code(422).send({ code: "invalid_video_copy_brief", message: brief.message });

      const result = await generateVideoCopyCandidates(brief.brief);
      return { ok: true, tenantId: context.tenantId, result };
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      if (message === "llm_provider_not_configured") {
        return reply.code(503).send({ code: "video_copy_unavailable", message: "文案生成服务还没有开通，暂时写不出文案。" });
      }
      if (/llm_output_invalid_structure|违规引导词/.test(message)) {
        // 失败关闭：不返回半成品、不返回演示文案。
        return reply.code(502).send({
          code: "video_copy_failed",
          message: "这次没有生成出可用的文案，请点「换一批」重试，或退回第 1 步把需求再说具体一点。"
        });
      }
      return reply.code(500).send({ code: "video_copy_error", message });
    }
  });
}

/** 门店隔离 + RBAC 每次请求重算（不缓存），单店角色无权访问其它门店。 */
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

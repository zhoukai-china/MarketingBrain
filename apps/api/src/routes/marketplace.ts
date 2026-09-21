import type { FastifyBaseLogger, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { Prisma, prisma } from "@baolu/db";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { LlmMessage } from "@baolu/agent";
import type { SkillId } from "@baolu/shared";
import { env, domesticNetworkOnly, domesticOutboundAllowlist } from "../config/env.js";
import { requireAdminToken } from "../services/access-guards.js";
import { resolveRequestContext, type RequestContext } from "../services/request-context.js";
import { DomesticChatProvider, type DomesticProviderUsageObservation } from "../services/domestic-chat-provider.js";
import { searchPublicTopicSources } from "../services/public-topic-search.js";
import { fetchGetnoteNotes } from "../services/getnote.js";
import {
  estimateMarketplaceModelCostCny,
  marketplaceCreditsForUsage
} from "../services/marketplace-cost.js";
import { usesCostBasedPricing } from "../services/billing-cost-model.js";
import {
  MAX_TRIAL_CREDITS,
  TrialGrantError,
  grantMarketplaceTrialCredits,
  listMarketplaceTrialGrants
} from "../services/marketplace-trial-grant.js";
import {
  PlatformSettingError,
  isMarketplaceTrialGrantEnabled,
  readPlatformSettings,
  updatePlatformSettings
} from "../services/referral-config.js";
// 内容十件套 V5 合同（提示词 + 结构校验）唯一出处：货架「文案智能体」与兰琪「美业文案十件套」共用。
import { COPY_TEN_SYSTEM_PROMPT, parseCopyTenContract } from "../products/beauty-industry/copy-ten-contract.js";
import {
  ReferralCodeError,
  issueReferralCode,
  listReferralBindings,
  listReferralCodesOfOwner
} from "../services/referral-attribution.js";
import { issueSelfReferralLink, readSelfReferralLink } from "../services/referral-self-service.js";
import {
  consumeWalletCredits,
  getOrCreateWallet,
  readWallet,
  buildRechargeUrl
} from "../services/sitong-wallet.js";
import { maybeGrantReferralReward } from "../services/referral-rewards.js";
import {
  MARKETPLACE_ZONES,
  MARKETPLACE_INDUSTRIES,
  PUBLIC_MARKETPLACE_STATUSES,
  demoMarketplace,
  ensureMarketplaceCatalog,
  isMarketplaceSkuPurchasable,
  matchesMarketplaceQuery,
  normalizeJsonArray,
  toPublicMarketplaceSku,
  type MarketplaceSkuQuery,
  type MarketplaceSkuStatus,
  type PublicMarketplaceSku
} from "../services/marketplace-catalog.js";
import {
  computeVidrevMetrics,
  parseVidrevRowsFromText,
  validateVidrevReport,
  vidrevMetricBrief,
  vidrevQuadrantTable,
  type VidrevMetrics,
  type VidrevPayload,
  type VidrevRawRow
} from "../services/video-review-engine.js";

// expert = 行业专家专区（用户 2026-09-15 新增，先放能力分身）。
const zoneEnum = z.enum(["ipzone", "canyin", "meiye", "chongwu", "expert"]);
const skuStatusEnum = z.enum(["selling", "trial", "internal", "coming_soon", "offline"]);
const supplierTypeEnum = z.enum(["self_operated", "third_party"]);

const skuQuerySchema = z.object({
  q: z.string().optional(),
  zone: zoneEnum.optional(),
  tag: z.string().optional(),
  badge: z.string().optional(),
  trial: z.enum(["true", "false"]).optional(),
  supplierId: z.string().optional(),
  minPpu: z.coerce.number().int().nonnegative().optional(),
  maxPpu: z.coerce.number().int().nonnegative().optional(),
  minSub: z.coerce.number().int().nonnegative().optional(),
  maxSub: z.coerce.number().int().nonnegative().optional(),
  status: skuStatusEnum.optional()
});

const marketplaceRunSchema = z.object({
  // 视频复盘支持结构化入参（rows），因此 input 允许为空；其余技能在路由里强制要求 input。
  input: z.string().trim().max(50_000).optional(),
  // 兼容字段：前端历史版本会带 redoOf 表示「免费重做」。免费重做已于 2026-09-15 下线，
  // 服务端对带该字段的请求显式拒绝（见 marketplace_free_redo_removed）。
  redoOf: z.string().trim().min(8).max(200).optional(),
  history: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().trim().min(1).max(50_000)
  })).max(12).optional(),
  // 视频复盘结构化入参（附件 §六 接口契约）；缺字段一律不传，禁止前端补 0。
  platform: z.string().trim().max(40).optional().nullable(),
  period: z.object({
    start: z.string().trim().max(40).optional().nullable(),
    end: z.string().trim().max(40).optional().nullable()
  }).optional().nullable(),
  rows: z.array(z.record(z.unknown())).max(50).optional(),
  has_revenue_data: z.boolean().optional()
});

/**
 * 视频复盘「文件到底有没有到后端」的预检（工单 2.4）：
 * 只解析、不调模型、不消耗积分；前端可先确认「文件到了 + 解析到了」，再发起正式复盘。
 */
const vidrevParsePreviewSchema = z.object({
  content: z.string().max(400_000).optional(),
  rows: z.array(z.record(z.unknown())).max(50).optional(),
  platform: z.string().trim().max(40).optional().nullable()
});

/**
 * 从表头/正文里猜平台。
 *
 * 2026-09-15 用户口径：**视频复盘只做抖音和视频号**，小红书 / 快手 / B站 一律不支持；
 * 识别到这些平台时返回 "其他平台"，由调用方 fail closed（不出报告、不消耗积分）。
 */
function detectVidrevPlatform(text: string): string | null {
  const head = (text ?? "").slice(0, 4000);
  // 先判「不支持」的平台，避免它们的字段（如「分享数」）被抖音规则误吞。
  if (/小红书|xiaohongshu|薯条|笔记标题|观看量|快手|kuaishou|磁力|B站|bilibili|哔哩|弹幕/.test(head)) return "其他平台";
  if (/视频号|微信视频号|channels\.weixin|发表时间|转发量/.test(head)) return "视频号";
  if (/抖音|douyin|创作者中心|5\s*秒完播率|分享数/.test(head)) return "抖音";
  return null;
}

/** 视频复盘当前支持的平台（用户 2026-09-15 口径）。 */
const VIDREV_SUPPORTED_PLATFORMS = ["抖音", "视频号"];
const VIDREV_UNSUPPORTED_MESSAGE =
  "视频复盘目前只支持**抖音**和**视频号**：请上传抖音创作者中心或视频号助手导出的作品数据表。小红书 / 快手 / B站 等平台的数据暂不支持复盘。";

/**
 * 把「平台」这一步传上来的自由文本解析成平台名（2026-09-17 现场缺陷）。
 *
 * 现场：老板在「平台」那一步没点选项，直接把「复盘（附件：视频号动态数据明细.csv）」当答案发出来，
 * 于是 `platform` 成了**这一整句**，被 `VIDREV_SUPPORTED_PLATFORMS.includes()` 判成「非抖音/视频号」，
 * 同一份视频号文件连发三次都被回「只支持抖音和视频号」——文件本身完全没问题。
 *
 * 口径（按优先级）：
 *   1. 这句话里点名了平台（含小红书 / 快手 / B站 → 判「其他平台」fail closed，不得被默认值兜过去）；
 *   2. 否则看数据表本身（视频号后台的「发表时间 / 转发量」、抖音的「分享数 / 5秒完播率」等）；
 *   3. 都没有时按调用方默认值（保持历史上「未指定按抖音」的行为）。
 */
export function resolveVidrevPlatform(platformText: string, content: string, fallback = "抖音"): string {
  const fromText = detectVidrevPlatform(platformText ?? "");
  if (fromText) return fromText;
  const fromData = detectVidrevPlatform(content ?? "");
  if (fromData) return fromData;
  return fallback;
}

const MARKETPLACE_SKILL_BY_CAPABILITY: Record<string, string> = {
  ip_positioning: "ip_positioning",
  topic_inspiration: "baolu_topics",
  content_plan: "baolu_content_creator",
  video_data_review: "baolu_review_engine",
  live_script: "live_script_planner",
  live_review: "baolu_live_review_engine",
  private_domain: "moments_generator",
  customer_diagnosis: "sales_growth_advisor"
};

// 直播话术需要交付「几万字 · 2 小时完整逐字稿」，单次输出体量远大于普通货架技能。
// 用 DeepSeek 高能力模型（deepseek-v4-pro）并放开输出上限，保证九段 + 四附属件不被截断。
const LIVESCRIPT_MAX_TOKENS = 16_384;


const skuInputSchema = z.object({
  skuCode: z.string().min(1).max(80),
  agentId: z.string().min(1).max(80).optional().nullable(),
  capabilityKey: z.string().min(1).max(80).optional().nullable(),
  supplierId: z.string().min(1),
  zone: zoneEnum,
  name: z.string().min(1).max(120),
  icon: z.string().max(20).optional().nullable(),
  badge: z.string().max(40).optional().nullable(),
  description: z.string().min(1).max(2000),
  verbs: z.array(z.string().min(1).max(80)).min(1).max(12),
  useCase: z.string().min(1).max(500),
  need: z.string().min(1).max(500),
  tags: z.array(z.string().min(1).max(80)).max(50),
  keywords: z.array(z.string().min(1).max(80)).max(50),
  ppu: z.coerce.number().int().nonnegative(),
  subscriptionPriceCny: z.coerce.number().int().nonnegative().optional().nullable(),
  subscriptionQuota: z.string().max(200).optional().nullable(),
  trial: z.boolean().default(false),
  status: skuStatusEnum,
  sortOrder: z.coerce.number().int().nonnegative().default(0)
});

const supplierInputSchema = z.object({
  code: z.string().min(1).max(80),
  name: z.string().min(1).max(120),
  type: supplierTypeEnum,
  settlementRate: z.coerce.number().min(0).max(1),
  contactEmail: z.string().email().optional().nullable(),
  status: z.enum(["active", "inactive"]).default("active")
});

const ppuConsumeSchema = z.object({
  skuId: z.string().min(1),
  idempotencyKey: z.string().min(1).max(140)
});

const subscriptionSchema = z.object({
  skuId: z.string().min(1)
});

const industryProfilePatchSchema = z.object({
  who: z.string().trim().max(1000).optional().nullable(),
  lexicon: z.array(z.string().trim().min(1).max(120)).max(100).optional(),
  pains: z.array(z.string().trim().min(1).max(500)).max(100).optional(),
  redline: z.array(z.string().trim().min(1).max(1000)).max(100).optional(),
  ov: z.record(z.string(), z.record(z.string(), z.unknown())).optional()
});

// PLAT-11：销售/运营自助发放体验额度。身份四选一，金额带上限，grant-id 作为幂等键。
const trialGrantIdentitySchema = z
  .object({
    userId: z.string().trim().min(1).max(64).optional(),
    phone: z.string().trim().min(1).max(32).optional(),
    wechatOpenid: z.string().trim().min(1).max(128).optional(),
    wechatUnionid: z.string().trim().min(1).max(128).optional()
  })
  .refine(
    (value) => [value.userId, value.phone, value.wechatOpenid, value.wechatUnionid].filter(Boolean).length === 1,
    { message: "必须且只能提供一个身份：手机号 / 微信 openid / 微信 unionid / user-id" }
  );

const trialGrantInputSchema = z.object({
  identity: trialGrantIdentitySchema,
  amount: z.number().int().min(1).max(MAX_TRIAL_CREDITS),
  grantId: z
    .string()
    .trim()
    .min(8)
    .max(80)
    .regex(/^[A-Za-z0-9_-]+$/, "发放编号只允许字母、数字、- 和 _"),
  operator: z.string().trim().min(2).max(40).optional(),
  tenantId: z.string().trim().min(1).max(64).optional(),
  dryRun: z.boolean().optional()
});

// PLAT-28：平台运行期配置位（推荐有礼 9 键 + 人工发放总开关），后台可读写。
const platformSettingUpdateSchema = z.object({
  updates: z.record(z.string().trim().min(1).max(64), z.unknown()),
  operator: z.string().trim().min(2).max(40).optional()
});

// PLAT-28：给推荐人下发推荐码（第③批的推荐人视角后台会在此基础上做）。
const referralCodeInputSchema = z.object({
  identity: trialGrantIdentitySchema,
  label: z.string().trim().max(40).optional(),
  operator: z.string().trim().min(2).max(40).optional()
});

/**
 * 已付费交付物在服务端的留存天数（用户 2026-09-16：「同意保留 7 天，别太多，会占用我们的空间」）。
 * 到期由读取路径顺带清理，不额外常驻空间。
 */
const DELIVERABLE_RETENTION_DAYS = 7;

export type MarketplaceRunOutcome =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; status: number; body: Record<string, unknown> };

/**
 * 货架 SKU 的执行 + 计费核心（PLAT-47）。
 *
 * 网页货架 `POST /market/skus/:skuId/run` 与 WorkBuddy MCP `sitong.ask` 共用这一份实现，
 * 避免两套「执行 + 计费」漂移。返回结构化 outcome，由调用方映射成 HTTP 或 JSON-RPC 响应。
 */
export async function runMarketplaceSku(params: {
  context: RequestContext;
  sku: PublicMarketplaceSku;
  body: z.infer<typeof marketplaceRunSchema>;
  log: FastifyBaseLogger;
}): Promise<MarketplaceRunOutcome> {
  const context = params.context;
  const sku = params.sku;
  const log = params.log;
  const parsed = { data: params.body } as { data: z.infer<typeof marketplaceRunSchema> };
  const access = await accessStateFor(context, sku);
  if (access.state === "unavailable") {
    const comingSoon = sku.status === "coming_soon";
    return {
      ok: false,
      status: 409,
      body: {
        error: comingSoon ? "marketplace_sku_coming_soon" : "marketplace_sku_not_available",
        message: comingSoon
          ? "该智能体正在开发中，敬请期待；本次不消耗积分。"
          : "该智能体暂不可用；本次不消耗积分。",
        status: sku.status
      }
    };
  }

  const skillId = resolveMarketplaceSkillId(sku.capabilityKey);
  if (!skillId) return { ok: false, status: 409, body: { error: "marketplace_skill_not_configured" } };

  const core = sku.skuCode.includes("__") ? sku.skuCode.slice(sku.skuCode.lastIndexOf("__") + 2) : sku.skuCode;
  const rawInput = parsed.data.input ?? "";
  const structuredRows = (parsed.data.rows ?? []) as unknown as VidrevRawRow[];
  if (core !== "vidrev" && rawInput.trim().length === 0) {
    return { ok: false, status: 400, body: { error: "invalid_request", details: { input: ["必填"] } } };
  }
  if (core === "vidrev" && rawInput.trim().length === 0 && structuredRows.length === 0) {
    return {
      ok: false,
      status: 400,
      body: {
        error: "invalid_request",
        details: { input: ["视频复盘需要数据行（rows）或文字说明（input）"] }
      }
    };
  }

  const requestId = randomUUID();
  const usage = { promptTokens: 0, completionTokens: 0, reasoningTokens: 0 };
  const baseProvider = new DomesticChatProvider({
    providerName: "deepseek",
    apiKey: env.DEEPSEEK_API_KEY,
    baseUrl: env.DEEPSEEK_BASE_URL,
    model: core === "livescript" ? env.DEEPSEEK_MODEL : process.env.MARKETPLACE_MODEL ?? "deepseek-v4-flash",
    timeoutMs: env.LLM_TIMEOUT_MS,
    domesticNetworkOnly,
    allowedHosts: domesticOutboundAllowlist,
    onUsage: (obs: DomesticProviderUsageObservation) => {
      usage.promptTokens += obs.promptTokens ?? 0;
      usage.completionTokens += obs.completionTokens ?? 0;
      usage.reasoningTokens += obs.reasoningTokens ?? 0;
    }
  });
  const provider = {
    name: baseProvider.name,
    isConfigured: () => baseProvider.isConfigured(),
    getModel: () => baseProvider.getModel(),
    complete: (messages: Parameters<typeof baseProvider.complete>[0], options: Parameters<typeof baseProvider.complete>[1]) => baseProvider.complete(messages, {
      ...(options as object),
      reasoningProfile: "standard",
      thinkingMode: "disabled",
      maxTokens: Math.min(Math.max(((options as { maxTokens?: number })?.maxTokens) ?? 8000, 8000), LIVESCRIPT_MAX_TOKENS)
    })
  };

  const price = sku.ppu;
  if (price <= 0) {
    return { ok: false, status: 409, body: { error: "marketplace_ppu_not_configured", message: "该智能体暂未开放使用" } };
  }
  const costBased = usesCostBasedPricing(sku.skuCode);

  if (parsed.data.redoOf) {
    return {
      ok: false,
      status: 409,
      body: {
        error: "marketplace_free_redo_removed",
        message: "需要再要一份时，重新发起一次即可（用量按实际消耗计算）。",
        retryable: false,
        providerCalls: 0,
        creditCost: 0
      }
    };
  }

  const activeSubscription = context.source === "database" ? await activeSubscriptionFor(context, sku.id) : null;
  const subscriptionQuota = activeSubscription?.dailyQuota ?? sku.subscriptionDailyQuota ?? null;
  const subscriptionUsedToday = activeSubscription
    ? await countSubscriptionUsageToday(context, sku.id, activeSubscription.id)
    : 0;
  const coveredBySubscription = Boolean(activeSubscription);
  if (activeSubscription && subscriptionQuota != null && subscriptionUsedToday >= subscriptionQuota) {
    return {
      ok: false,
      status: 409,
      body: {
        error: "marketplace_subscription_quota_exhausted",
        message: `你已开通本智能体的包月：今天 ${subscriptionQuota} 次已经用完（今日已用 ${subscriptionUsedToday} 次）。本次不消耗积分，额度每天 0 点恢复。`,
        quota: subscriptionQuota,
        usedToday: subscriptionUsedToday,
        subscriptionEndDate: activeSubscription.endDate,
        providerCalls: 0,
        creditCost: 0
      }
    };
  }

  const walletBefore = await readWallet(context.userId);
  if (!coveredBySubscription && walletBefore.balance < price) {
    return {
      ok: false,
      status: 402,
      body: {
        error: "insufficient_credits",
        message: "当前积分不足，请先充值后再使用。",
        balance: walletBefore.balance,
        required: price,
        rechargeUrl: buildRechargeUrl(sku.skuCode)
      }
    };
  }

  try {
    let userContent = marketplaceRunInput(sku, rawInput);
    if (core === "topic") {
      const industryMatch = /(?:行业|账号阶段)[^：:]*[：:]\s*([^\n]+)/.exec(rawInput);
      const benchMatch = /(?:同行爆款|对标账号)[^：:]*[：:]\s*([^\n]+)/.exec(rawInput);
      const industry = industryMatch?.[1]?.trim() ?? "";
      const bench = benchMatch?.[1]?.trim() ?? "";
      try {
        const search = await searchPublicTopicSources(industry, bench);
        userContent += `\n\n【搜索源 · 实时检索】\n行业热点：${search.hot.fetched ? search.hot.items.join("；") : search.hot.note}\n同行爆款：${search.bench.fetched ? search.bench.items.join("；") : search.bench.note}`;
      } catch {
        userContent += "\n\n【搜索源 · 实时检索】行业热点：检索失败；同行爆款：未提供";
      }
      const apiKeyMatch = /API\s*[Kk]ey[：:\s]*([A-Za-z0-9_.]+)/.exec(rawInput);
      const clientMatch = /Client\s*I[Dd][：:\s]*([A-Za-z0-9_]+)/.exec(rawInput);
      const apiKey = apiKeyMatch?.[1] ?? (process.env.GETNOTE_API_KEY ?? "");
      const clientId = clientMatch?.[1] ?? (process.env.GETNOTE_CLIENT_ID ?? "");
      if (apiKey && clientId) {
        const notes = await fetchGetnoteNotes(apiKey, clientId).catch(() => []);
        if (notes.length > 0) {
          userContent += `\n\n【Get笔记 · 录音卡（真实拉取）】\n${notes.map((n) => `- ${n.title}：${n.summary || "（无摘要）"}`).join("\n")}`;
        } else {
          userContent += "\n\n【Get笔记 · 录音卡】已提供 API Key，但拉取未取到笔记（可能未授权/网络），按「无」处理。";
        }
      }
    }
    let vidrevMetrics: VidrevMetrics | null = null;
    let vidrevHasRevenue = parsed.data.has_revenue_data ?? false;
    if (core === "vidrev") {
      const rows = structuredRows.length > 0 ? structuredRows : parseVidrevRowsFromText(rawInput).rows;
      vidrevHasRevenue = parsed.data.has_revenue_data ?? false;
      // 平台名可能是一整句自由文本（现场：「复盘（附件：视频号动态数据明细.csv）」）——
      // 先解析成受支持的平台名，明确点名小红书/快手/B站时仍走 fail closed。
      const platform = resolveVidrevPlatform(parsed.data.platform ?? "", rawInput);
      if (!VIDREV_SUPPORTED_PLATFORMS.includes(platform)) {
        return {
          ok: false,
          status: 422,
          body: {
            error: "vidrev_platform_not_supported",
            message: VIDREV_UNSUPPORTED_MESSAGE,
            platform,
            providerCalls: 0,
            creditCost: 0
          }
        };
      }
      const period = parsed.data.period ?? null;
      vidrevMetrics = computeVidrevMetrics(rows);
      if (vidrevMetrics.count === 0) {
        return {
          ok: false,
          status: 422,
          body: {
            error: "marketplace_output_invalid",
            message: "没有识别到视频记录，本次不消耗积分。请上传视频号/抖音后台导出的 CSV/Excel（至少包含 1 条视频数据，表头含标题 / 播放 / 互动等字段）。",
            reasons: ["V0 未解析到可复算的数据行：深度复盘必须有结构化数据（rows 或可解析的数据表）。"],
            failed_rules: ["V0"]
          }
        };
      }
      userContent += `\n\n【本次复盘参数】模式=深度复盘；平台=${platform}；周期=${period?.start ?? "未提供"} ~ ${period?.end ?? "未提供"}；是否有成交金额=${vidrevHasRevenue ? "有" : "无"}。`;
      userContent += `\n\n【后端重算口径 · 必须逐字照抄，写错即判失败】\n${vidrevMetricBrief(vidrevMetrics)}`;
      userContent += `\n\n【结构化数据明细 · 只能引用这些 video_id，禁止编造视频】\n${vidrevRowsTable(vidrevMetrics)}`;
      // 第二章「视频分层」由后端给定照抄表（2026-09-17 现场：模型把「#」列填成序号，校验器读到的
      // 却是 video_id → V3 判失败、用户拿不到报告）。模型只负责原样复制，不改行、不改 id。
      userContent += `\n\n【二、视频分层 · 必须原样照抄下面这张表（列名、行顺序、video_id 都不得改动，空象限保持「无」），表格前只补一句分层口径】\n${vidrevQuadrantTable(vidrevMetrics)}`;
    }
    const history = parsed.data.history ?? [];
    const turnMessages: LlmMessage[] = [
      ...history.map((item) => ({ role: item.role, content: item.content }) as LlmMessage),
      { role: "user", content: userContent }
    ];
    let answerText: string;
    let ipPosPayload: IpPosPayload | null = null;
    let vidrevPayload: VidrevPayload | null = null;
    try {
      if (core === "ip-pos") {
        const [partA, partB] = (await Promise.all([
          provider.complete(
            [{ role: "system", content: IP_POS_SYSTEM_PROMPT_A }, ...turnMessages] as LlmMessage[],
            { maxTokens: 8192 }
          ),
          provider.complete(
            [{ role: "system", content: IP_POS_SYSTEM_PROMPT_B }, ...turnMessages] as LlmMessage[],
            { maxTokens: 8192 }
          )
        ])) as unknown as [string, string];
        const clarifyA = extractClarification(partA ?? "");
        const clarifyB = extractClarification(partB ?? "");
        answerText = clarifyA
          ? String(partA ?? "")
          : clarifyB
            ? String(partB ?? "")
            : `${String(partA ?? "").trim()}\n\n${String(partB ?? "").trim()}`;
      } else if (core === "livescript") {
        answerText = await generateLiveScriptFull(
          marketplaceSkillSystemPrompt(sku),
          turnMessages,
          (messages, options) => provider.complete(messages, options)
        );
      } else {
        answerText = (await provider.complete(
          [
            {
              role: "system",
              content: marketplaceSkillSystemPrompt(sku)
            },
            ...turnMessages
          ] as LlmMessage[],
          { maxTokens: 2048 }
        )) as unknown as string;
      }
    } catch (modelError) {
      const code = (modelError as { code?: string })?.code ?? "model_call_failed";
      /**
       * 2026-09-17 现场（50 条导出实测）：深度复盘报告的长度随视频条数线性增长，一次生成的输出
       * 上限是 8000 tokens；20 条约 7000 tokens 已是临界，50 条必然被截断（finishReason=length）。
       * 这种失败必须说清「是数据太多、不是系统坏了」，并给出可执行的下一步；绝不能糊成
       * 「模型调用失败（model_call_failed）」让老板反复重试。仍然不消耗积分。
       */
      const isVidrevTooLong = core === "vidrev" && code === "output_token_limit";
      return {
        ok: false,
        status: 502,
        body: {
          error: "marketplace_provider_failed",
          code,
          message: isVidrevTooLong
            ? `本次要复盘的视频有 ${vidrevMetrics?.count ?? 0} 条，超过单次深度复盘能生成的报告篇幅上限，报告会被截断——所以没有交付，本次也不消耗积分。请把导出周期改成「近 7 天 / 近 14 天」分批复盘（每批 20 条以内最稳），或先只复盘其中一批。`
            : `模型调用失败（${code}），本次不消耗积分。`
        }
      };
    }

    const clarification = extractClarification(answerText);
    if (clarification) {
      return {
        ok: true,
        body: {
          needsInput: true,
          answer: clarification,
          consumedCredits: 0,
          balance: walletBefore.balance,
          required: price
        }
      };
    }

    if (core === "topic") {
      let validation = parseTopicTable(answerText);
      if (validation.failures.length > 0) {
        const firstAttemptUsage = { ...usage };
        log.warn({ event: "topic_output_invalid_retry", attempt: 1, failures: validation.failures.slice(0, 6) }, "选题未通过技能校验，自动重试一次");
        try {
          const corrective = [
            "上一次输出未通过技能校验，请在不改动已经正确的选题与结构的前提下，重新输出完整选题表格并只修正下列问题：",
            ...validation.failures.slice(0, 12).map((item, index) => `${index + 1}. ${item}`)
          ].join("\n");
          const retryText = (await provider.complete(
            [
              { role: "system", content: marketplaceSkillSystemPrompt(sku) },
              ...turnMessages,
              { role: "assistant", content: answerText },
              { role: "user", content: corrective }
            ] as LlmMessage[],
            { maxTokens: 8192 }
          )) as unknown as string;
          const retryValidation = parseTopicTable(retryText ?? "");
          if (retryValidation.failures.length === 0) {
            answerText = retryText;
            validation = retryValidation;
            usage.promptTokens = firstAttemptUsage.promptTokens;
            usage.completionTokens = firstAttemptUsage.completionTokens;
            usage.reasoningTokens = firstAttemptUsage.reasoningTokens;
            log.info({ event: "topic_output_invalid_retry_ok" }, "选题重试后通过校验");
          } else {
            log.warn({ event: "topic_output_invalid_retry_failed", failures: retryValidation.failures.slice(0, 6) }, "选题重试后仍未通过校验");
          }
        } catch (retryError) {
          log.warn({ err: retryError }, "选题重试调用失败，按首次校验结果返回");
        }
      }
      if (validation.failures.length > 0) {
        return {
          ok: false,
          status: 422,
          body: {
            error: "marketplace_output_invalid",
            message: "选题交付未通过技能校验，本次不消耗积分：\n" + validation.failures.slice(0, 8).join("\n"),
            reasons: validation.failures.slice(0, 20)
          }
        };
      }
    }
    if (core === "copy") {
      let validation = parseCopyTenContract(answerText);
      if (validation.failures.length > 0) {
        const firstAttemptUsage = { ...usage };
        log.warn({ event: "copy_output_invalid_retry", attempt: 1, failures: validation.failures.slice(0, 6) }, "文案未通过技能校验，自动重试一次");
        try {
          const corrective = [
            "上一次输出未通过技能校验，请在不改动已经正确的章节与内容的前提下，重新输出完整十件套并只修正下列问题：",
            ...validation.failures.slice(0, 12).map((item, index) => `${index + 1}. ${item}`),
            "特别注意：评论区引导与意向转化话术只能用「主页/评论/合集/到店」等自然承接，不得出现私信、加微信、电话、联系我、找我、留个、扫码领、加我等违规引导词。"
          ].join("\n");
          const retryText = (await provider.complete(
            [
              { role: "system", content: marketplaceSkillSystemPrompt(sku) },
              ...turnMessages,
              { role: "assistant", content: answerText },
              { role: "user", content: corrective }
            ] as LlmMessage[],
            { maxTokens: 8192 }
          )) as unknown as string;
          const retryValidation = parseCopyTenContract(retryText ?? "");
          if (retryValidation.failures.length === 0) {
            answerText = retryText;
            validation = retryValidation;
            usage.promptTokens = firstAttemptUsage.promptTokens;
            usage.completionTokens = firstAttemptUsage.completionTokens;
            usage.reasoningTokens = firstAttemptUsage.reasoningTokens;
            log.info({ event: "copy_output_invalid_retry_ok" }, "文案重试后通过校验");
          } else {
            log.warn({ event: "copy_output_invalid_retry_failed", failures: retryValidation.failures.slice(0, 6) }, "文案重试后仍未通过校验");
          }
        } catch (retryError) {
          log.warn({ err: retryError }, "文案重试调用失败，按首次校验结果返回");
        }
      }
      if (validation.failures.length > 0) {
        return {
          ok: false,
          status: 422,
          body: {
            error: "marketplace_output_invalid",
            message: "文案交付未通过技能校验，本次不消耗积分：\n" + validation.failures.join("\n"),
            reasons: validation.failures
          }
        };
      }
    }
    if (core === "ip-pos") {
      let validation = parseIpPosFull(answerText, rawInput);
      if (validation.failures.length > 0) {
        const firstAttemptUsage = { ...usage };
        log.warn(
          { event: "ip_pos_output_invalid_retry", attempt: 1, failures: validation.failures.slice(0, 6) },
          "IP 定位全案未通过技能校验，自动重试一次"
        );
        try {
          const [retryA, retryB] = (await Promise.all([
            provider.complete(
              [{ role: "system", content: IP_POS_SYSTEM_PROMPT_A }, ...turnMessages] as LlmMessage[],
              { maxTokens: 8192 }
            ),
            provider.complete(
              [{ role: "system", content: IP_POS_SYSTEM_PROMPT_B }, ...turnMessages] as LlmMessage[],
              { maxTokens: 8192 }
            )
          ])) as unknown as [string, string];
          const retryText = `${String(retryA ?? "").trim()}\n\n${String(retryB ?? "").trim()}`;
          const retryValidation = parseIpPosFull(retryText, rawInput);
          if (retryValidation.failures.length === 0) {
            answerText = retryText;
            validation = retryValidation;
            usage.promptTokens = firstAttemptUsage.promptTokens;
            usage.completionTokens = firstAttemptUsage.completionTokens;
            usage.reasoningTokens = firstAttemptUsage.reasoningTokens;
            log.info({ event: "ip_pos_output_invalid_retry_ok" }, "IP 定位全案重试后通过校验");
          } else {
            log.warn(
              { event: "ip_pos_output_invalid_retry_failed", failures: retryValidation.failures.slice(0, 6) },
              "IP 定位全案重试后仍未通过校验"
            );
          }
        } catch (retryError) {
          log.warn(
            { err: retryError },
            "IP 定位全案重试调用失败，按首次校验结果返回"
          );
        }
      }
      if (validation.failures.length > 0) {
        return {
          ok: false,
          status: 422,
          body: {
            error: "marketplace_output_invalid",
            message: "IP 定位全案未通过技能校验，本次不消耗积分：\n" + validation.failures.slice(0, 8).join("\n"),
            reasons: validation.failures.slice(0, 20)
          }
        };
      }
      ipPosPayload = validation.payload;
    }
    if (core === "vidrev") {
      const validateVidrev = (markdown: string) =>
        validateVidrevReport({
          markdown,
          metrics: vidrevMetrics,
          mode: "deep",
          hasRevenueData: vidrevHasRevenue
        });
      let validation = validateVidrev(answerText);
      if (validation.failures.length > 0) {
        await dumpVidrevDebugOutput("first", answerText, validation.failures);
        const corrective = [
          "上一次输出未通过技能校验，请在不改动已经正确的数字与结论的前提下，重新输出完整报告并只修正下列问题：",
          ...validation.failures.slice(0, 12).map((item, index) => `${index + 1}. ${item}`),
          "硬性排版：单条深拆必须先写「为什么…：」独占一行，紧接着用「1.」「2.」「3.」列出至少 3 条理由（不要用项目符号）；第八章规律总结的「支撑视频」列必须填具体 video_id（如 v1、v5），不能留空或写「—」；第九章方法论沉淀每条用「1.」「2.」编号独占一段，五个字段各占一行（类型：/规律：/证据：/置信度：/相关选题：），禁止用「/」把五个字段串成一行。"
        ].join("\n");
        try {
          const retryText = (await provider.complete(
            [
              {
                role: "system",
                content: marketplaceSkillSystemPrompt(sku)
              },
              ...turnMessages,
              { role: "assistant", content: answerText },
              { role: "user", content: corrective }
            ] as LlmMessage[],
            { maxTokens: 8192 }
          )) as unknown as string;
          const retryValidation = validateVidrev(retryText ?? "");
          if (retryValidation.failures.length === 0) {
            answerText = retryText;
            validation = retryValidation;
          } else {
            await dumpVidrevDebugOutput("retry", retryText ?? "", retryValidation.failures);
          }
        } catch {
          // 纠错重跑失败则保留首次输出，走下面的 422 分支（不消耗积分）。
        }
      }
      if (validation.failures.length > 0) {
        return {
          ok: false,
          status: 422,
          body: {
            error: "marketplace_output_invalid",
            message: "视频复盘未通过技能校验，本次不消耗积分：\n" + validation.failures.slice(0, 8).join("\n"),
            reasons: validation.failures.slice(0, 20),
            failed_rules: [...new Set(validation.failures.map((item) => item.split(/[\s：:]/)[0]))]
          }
        };
      }
      vidrevPayload = validation.payload;
    }
    const answer = marketplaceWrappedAnswer(sku, answerText);
    const costCny = estimateMarketplaceModelCostCny(usage);
    const dynamicCredits = marketplaceCreditsForUsage(usage);
    const charge = coveredBySubscription ? 0 : costBased ? dynamicCredits : price;

    let walletAfter = walletBefore;
    let spent: { paid: number; bonus: number } = { paid: 0, bonus: 0 };
    if (!coveredBySubscription) {
      const consumed = await consumeWalletCredits({
        userId: context.userId,
        requestId,
        price: charge,
        skillId: sku.skuCode,
        source: "web"
      });
      if (consumed.status === "insufficient") {
        return {
          ok: false,
          status: 402,
          body: {
            error: "insufficient_credits",
            message: "当前积分不足，请先充值后再使用。",
            balance: consumed.wallet.balance,
            paidBalance: consumed.wallet.paidBalance,
            bonusBalance: consumed.wallet.bonusBalance,
            required: charge,
            rechargeUrl: buildRechargeUrl(sku.skuCode)
          }
        };
      }
      walletAfter = consumed.wallet;
      spent = consumed.spent;
    }

    await prisma.marketplaceLedgerEntry.create({
      data: {
        tenantId: context.tenantId,
        userId: context.userId,
        skuId: sku.id,
        type: "ppu_consume",
        direction: "debit",
        amountCredits: charge,
        amountCny: 0,
        status: "completed",
        idempotencyKey: requestId,
        refType: coveredBySubscription ? SUBSCRIPTION_USAGE_REF_TYPE : "marketplace_run",
        refId: coveredBySubscription ? activeSubscription?.id ?? requestId : requestId,
        metadata: {
          pricingMode: coveredBySubscription ? "subscription" : costBased ? "cost_based" : "fixed_ppu",
          estimatedCredits: dynamicCredits,
          listPpu: price,
          modelCostCny: costCny,
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          reasoningTokens: usage.reasoningTokens,
          ...(coveredBySubscription
            ? {
                subscriptionId: activeSubscription?.id ?? null,
                subscriptionDailyQuota: subscriptionQuota,
                subscriptionUsedTodayBefore: subscriptionUsedToday
              }
            : {})
        }
      }
    });

    await maybeGrantReferralReward({ referredUserId: context.userId, kind: "referrer_first_use" }).catch((error: unknown) => {
      log.warn({ err: error }, "referral reward(referrer_first_use) failed");
    });

    await prisma.marketplaceDeliverable
      .create({
        data: {
          tenantId: context.tenantId,
          userId: context.userId,
          skuCode: sku.skuCode,
          skuName: sku.name,
          input: String(rawInput ?? "").slice(0, 20_000),
          answer: String(answerText ?? "").slice(0, 60_000),
          credits: charge,
          requestId,
          expiresAt: new Date(Date.now() + DELIVERABLE_RETENTION_DAYS * 24 * 60 * 60 * 1000)
        }
      })
      .catch((error: unknown) => {
        log.warn({ err: error }, "marketplace deliverable retention failed");
      });
    return {
      ok: true,
      body: {
        state: "completed",
        answer,
        qualityFlags: null,
        deliveryStatus: "completed",
        consumedCredits: charge,
        pricingMode: coveredBySubscription ? "subscription" : costBased ? "cost_based" : "fixed_ppu",
        freeRedo: false,
        requestId,
        balance: walletAfter.balance,
        paidBalance: walletAfter.paidBalance,
        bonusBalance: walletAfter.bonusBalance,
        spent,
        ...(coveredBySubscription
          ? {
              subscription: {
                covered: true,
                id: activeSubscription?.id ?? null,
                dailyQuota: subscriptionQuota,
                usedToday: subscriptionUsedToday + 1,
                remaining:
                  subscriptionQuota == null ? null : Math.max(0, subscriptionQuota - (subscriptionUsedToday + 1)),
                endDate: activeSubscription?.endDate ?? null
              }
            }
          : {}),
        ...(ipPosPayload ? { payload: ipPosPayload } : {}),
        ...(vidrevPayload ? { payload: vidrevPayload } : {})
      }
    };
  } catch (error) {
    throw error;
  }
}

export async function registerMarketplaceRoutes(app: FastifyInstance): Promise<void> {
  await ensureMarketplaceCatalog();

  // 视频复盘预检（工单 2.4）：验证「文件真的到了后端、字段也解析到了」，不调模型、不消耗积分。
  app.post("/vidrev/parse-preview", async (request, reply) => {
    const parsed = vidrevParsePreviewSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    }
    const content = parsed.data.content ?? "";
    const structured = (parsed.data.rows ?? []) as unknown as VidrevRawRow[];
    const result = structured.length > 0
      ? { rows: structured, notes: [`已收到结构化数据行 ${structured.length} 条。`] }
      : parseVidrevRowsFromText(content);

    const fields = new Set<string>();
    for (const row of result.rows) {
      for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
        if (value !== null && value !== undefined && value !== "") fields.add(key);
      }
    }
    const dates = result.rows
      .map((row) => row.published_at)
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .sort();
    const metrics = result.rows.length > 0 ? computeVidrevMetrics(result.rows) : null;
    const detectedPlatform = parsed.data.platform ?? detectVidrevPlatform(content);

    // 2026-09-15 用户口径：只做抖音 / 视频号；识别到小红书等平台时明确说明，不进解析、不消耗积分。
    if (detectedPlatform === "其他平台" || (detectedPlatform && !VIDREV_SUPPORTED_PLATFORMS.includes(detectedPlatform))) {
      return {
        ok: false,
        rowCount: 0,
        fields: [],
        platform: detectedPlatform,
        period: { start: null, end: null },
        limitedDimensions: [],
        notes: [VIDREV_UNSUPPORTED_MESSAGE]
      };
    }

    return {
      ok: result.rows.length > 0,
      rowCount: result.rows.length,
      fields: [...fields],
      platform: detectedPlatform,
      period: { start: dates[0] ?? null, end: dates[dates.length - 1] ?? null },
      limitedDimensions: metrics?.limitedDimensions ?? [],
      notes: result.notes
    };
  });

  await app.register(async (market) => {
    market.get("/zones", async () => ({
      zones: MARKETPLACE_ZONES,
      industries: Object.values(MARKETPLACE_INDUSTRIES)
    }));

    market.get<{ Querystring: z.infer<typeof skuQuerySchema> }>("/skus", async (request, reply) => {
      const parsed = skuQuerySchema.safeParse(request.query ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
      }
      const query: MarketplaceSkuQuery = {
        ...parsed.data,
        trial: parsed.data.trial === undefined ? undefined : parsed.data.trial === "true"
      };
      return {
        zones: MARKETPLACE_ZONES,
        skus: await listMarketplaceSkus(query, false)
      };
    });

    market.get<{ Params: { skuId: string } }>("/skus/:skuId", async (request, reply) => {
      const sku = await getMarketplaceSku(request.params.skuId);
      if (!sku) return reply.code(404).send({ error: "marketplace_sku_not_found" });
      return { sku, industry: MARKETPLACE_INDUSTRIES[sku.zone] ?? null };
    });

    market.get<{ Params: { skuId: string } }>("/skus/:skuId/access", async (request) => {
      const sku = await getMarketplaceSku(request.params.skuId);
      if (!sku) {
        return {
          state: "guest",
          track: null,
          balance: 0,
          reason: "marketplace_sku_not_found"
        };
      }
      const context = await tryResolveContext(request);
      if (!context) {
        return {
          state: "guest",
          track: null,
          balance: 0,
          sku: { skuCode: sku.skuCode, ppu: sku.ppu }
        };
      }
      return accessStateFor(context, sku);
    });

    market.post<{ Params: { skuId: string } }>("/skus/:skuId/run", async (request, reply) => {
      const parsed = marketplaceRunSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
      }
      const context = await resolveRequestContext(request.headers);
      const sku = await getMarketplaceSku(request.params.skuId);
      if (!sku) return reply.code(404).send({ error: "marketplace_sku_not_found" });
      const outcome = await runMarketplaceSku({ context, sku, body: parsed.data, log: request.log });
      if (outcome.ok) return outcome.body;
      return reply.code(outcome.status).send(outcome.body);
    });

    /**
     * 找回「已付费交付物」（用户 2026-09-16：客户换了手机/关了页面之后要能拿回自己的报告）。
     *
     * 只返回**当前登录人自己**、且**还在 7 天留存期内**的交付物（租户 + 用户双重过滤）；
     * 每次读取顺手清掉过期行，避免这 7 天留存无限增长。
     */
    market.get<{ Querystring: { skuCode?: string } }>("/me/deliverables", async (request, reply) => {
      const context = await resolveRequestContext(request.headers);
      if (context.source !== "database") return { deliverables: [] };
      await prisma.marketplaceDeliverable
        .deleteMany({ where: { expiresAt: { lt: new Date() } } })
        .catch(() => {});
      const skuCode = (request.query?.skuCode ?? "").trim();
      const rows = await prisma.marketplaceDeliverable.findMany({
        where: {
          tenantId: context.tenantId,
          userId: context.userId,
          ...(skuCode ? { skuCode } : {}),
          expiresAt: { gt: new Date() }
        },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { id: true, skuCode: true, skuName: true, input: true, answer: true, credits: true, createdAt: true, expiresAt: true }
      });
      return {
        retentionDays: DELIVERABLE_RETENTION_DAYS,
        deliverables: rows.map((row) => ({
          id: row.id,
          skuCode: row.skuCode,
          skuName: row.skuName,
          input: row.input,
          answer: row.answer,
          credits: row.credits,
          createdAt: row.createdAt,
          expiresAt: row.expiresAt
        }))
      };
    });

    market.get("/me", async (request, reply) => {
      const context = await resolveRequestContext(request.headers);
      const wallet = context.source === "database" ? await readWallet(context.userId) : { balance: await getCreditBalance(context) };
      return {
        dataMode: context.source,
        creditBalance: wallet.balance,
        subscriptions: await listSubscriptions(context),
        recentPpu: await listRecentPpuUsage(context),
        recentRefunds: await listRecentRefunds(context)
      };
    });

    /**
     * 「常用智能体」独立页的数据源（用户 2026-09-16）。只读、按租户隔离；
     * 未登录显式 401（与 `/me/referral-link` 同一口径，路由被单独挂载时也不把「未登录」说成 500）。
     */
    market.get("/me/agents", async (request, reply) => {
      let context;
      try {
        context = await resolveRequestContext(request.headers);
      } catch {
        return reply.code(401).send({ error: "login_required", message: "请先登录后再查看常用智能体。" });
      }
      return { agents: await listFrequentAgents(context) };
    });

    // PLAT-38（用户 2026-09-15）：「我的」页的自助邀请链接。
    // 只需要登录态（身份取自服务端验签会话，不接受客户端传 userId），不要求平台管理令牌——
    // 但只能操作**自己**的推荐码，明文只在签发时返回一次（与 PLAT-28 的安全模型一致）。
    market.get("/me/referral-link", async (request, reply) => {
      // 显式 401：自服务入口不依赖全局错误处理器，路由被单独挂载时也不能把「未登录」说成 500。
      let context;
      try {
        context = await resolveRequestContext(request.headers);
      } catch {
        return reply.code(401).send({ error: "login_required", message: "请先登录后再查看邀请链接。" });
      }
      return await readSelfReferralLink(context.userId);
    });

    market.post("/me/referral-link", async (request, reply) => {
      let context;
      try {
        context = await resolveRequestContext(request.headers);
      } catch {
        return reply.code(401).send({ error: "login_required", message: "请先登录后再生成邀请链接。" });
      }
      const regenerate = Boolean((request.body as { regenerate?: unknown } | undefined)?.regenerate);
      return await issueSelfReferralLink({ userId: context.userId, regenerate });
    });

    market.post("/ppu/consume", async (request, reply) => {
      const parsed = ppuConsumeSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
      }
      const context = await resolveRequestContext(request.headers);
      const sku = await getMarketplaceSku(parsed.data.skuId);
      if (!sku) return reply.code(404).send({ error: "marketplace_sku_not_found" });
      if (!isMarketplaceSkuPurchasable(sku.status)) {
        const comingSoon = sku.status === "coming_soon";
        return reply.code(409).send({
          error: comingSoon ? "marketplace_sku_coming_soon" : "marketplace_sku_not_available",
          message: comingSoon
            ? "该智能体正在开发中，敬请期待；本次不消耗积分。"
            : "该智能体暂不可用；本次不消耗积分。",
          status: sku.status
        });
      }
      return await consumeMarketplacePpu(context, sku, parsed.data.idempotencyKey);
    });

    market.post("/subscriptions", async (request, reply) => {
      const parsed = subscriptionSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
      }
      const context = await resolveRequestContext(request.headers);
      const sku = await getMarketplaceSku(parsed.data.skuId);
      if (!sku) return reply.code(404).send({ error: "marketplace_sku_not_found" });
      /**
       * 积分口径包月（用户 2026-09-17 拍板）：文案智能体 4000 积分/月、每天 5 条。
       *
       * 为什么必须用积分口径：老的人民币口径包月价格在生产里全是 NULL（等于没上架），
       * 且订阅支付只有 `mock-pay`（`NODE_ENV=production` 直接 404），所以「包月」以前根本走不通。
       * 平台本来就有统一积分钱包，直接扣积分即可闭环，不需要再接一条支付渠道。
       */
      if (context.source === "database" && (sku.subscriptionCredits ?? 0) > 0) {
        return await subscribeMarketplaceSkuWithCredits(context, sku, reply);
      }
      if (!sku.subscriptionPriceCny) {
        return reply.code(409).send({ error: "marketplace_subscription_not_available" });
      }
      return await createMarketplaceSubscription(context, sku);
    });

    market.post<{ Params: { orderId: string } }>("/subscriptions/:orderId/mock-pay", async (request, reply) => {
      if (env.NODE_ENV === "production") {
        return reply.code(404).send({ error: "not_found" });
      }
      const context = await resolveRequestContext(request.headers);
      return await mockPayMarketplaceSubscription(context, request.params.orderId);
    });

    await market.register(async (admin) => {
      admin.addHook("preHandler", requireMarketplaceAdmin("read"));

      admin.get("/overview", async (request) => {
        const context = await resolveRequestContext(request.headers);
        return { overview: await marketplaceOverview() };
      });

      admin.get("/industries", async () => ({
        industries: Object.values(MARKETPLACE_INDUSTRIES)
      }));

      admin.patch<{ Params: { key: string } }>("/industries/:key", async (request, reply) => {
        await requireMarketplaceAdmin("write")(request, reply);
        if (reply.sent) return;
        const parsed = industryProfilePatchSchema.safeParse(request.body ?? {});
        if (!parsed.success) {
          return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
        }
        const key = request.params.key;
        const existing = await prisma.marketplaceIndustryProfile.findUnique({ where: { zoneKey: key } });
        if (!existing) {
          return reply.code(404).send({ error: "marketplace_industry_not_found" });
        }
        const updateData: Prisma.MarketplaceIndustryProfileUpdateInput = {};
        if (parsed.data.who !== undefined) updateData.who = parsed.data.who;
        if (parsed.data.lexicon !== undefined) updateData.lexicon = parsed.data.lexicon as Prisma.InputJsonValue;
        if (parsed.data.pains !== undefined) updateData.pains = parsed.data.pains as Prisma.InputJsonValue;
        if (parsed.data.redline !== undefined) updateData.redline = parsed.data.redline as Prisma.InputJsonValue;
        if (parsed.data.ov !== undefined) updateData.ov = parsed.data.ov as Prisma.InputJsonValue;
        await prisma.marketplaceIndustryProfile.update({ where: { id: existing.id }, data: updateData });
        await ensureMarketplaceCatalog();
        return { industry: MARKETPLACE_INDUSTRIES[key] ?? null };
      });

      admin.get("/skus", async (request, reply) => {
        const parsed = skuQuerySchema.safeParse(request.query ?? {});
        if (!parsed.success) {
          return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
        }
        const query: MarketplaceSkuQuery = {
          ...parsed.data,
          trial: parsed.data.trial === undefined ? undefined : parsed.data.trial === "true"
        };
        return { skus: await listMarketplaceSkus(query, true) };
      });

      admin.post("/skus", async (request, reply) => {
        await requireMarketplaceAdmin("write")(request, reply);
        if (reply.sent) return;
        const parsed = skuInputSchema.safeParse(request.body ?? {});
        if (!parsed.success) {
          return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
        }
        return { sku: await upsertMarketplaceSku(parsed.data) };
      });

      admin.patch<{ Params: { skuId: string } }>("/skus/:skuId", async (request, reply) => {
        await requireMarketplaceAdmin("write")(request, reply);
        if (reply.sent) return;
        const parsed = skuInputSchema.partial().safeParse(request.body ?? {});
        if (!parsed.success) {
          return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
        }
        return { sku: await upsertMarketplaceSku(parsed.data, request.params.skuId) };
      });

      admin.get("/suppliers", async () => ({ suppliers: await listMarketplaceSuppliers() }));

      admin.post("/suppliers", async (request, reply) => {
        await requireMarketplaceAdmin("write")(request, reply);
        if (reply.sent) return;
        const parsed = supplierInputSchema.safeParse(request.body ?? {});
        if (!parsed.success) {
          return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
        }
        return { supplier: await upsertMarketplaceSupplier(parsed.data) };
      });

      admin.patch<{ Params: { supplierId: string } }>("/suppliers/:supplierId", async (request, reply) => {
        await requireMarketplaceAdmin("write")(request, reply);
        if (reply.sent) return;
        const parsed = supplierInputSchema.partial().safeParse(request.body ?? {});
        if (!parsed.success) {
          return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
        }
        return { supplier: await upsertMarketplaceSupplier(parsed.data, request.params.supplierId) };
      });

      admin.get<{ Querystring: { limit?: string } }>("/ledger", async (request) => {
        const limit = clampLimit(request.query.limit);
        return { ledger: await listMarketplaceLedger(undefined, limit) };
      });

      // PLAT-11：体验额度发放（销售/运营自助）。
      //
      // P0（QA-20260911-009）：体验额度是**资金侧写操作**，只靠租户级角色是放不住的——
      // `context.role` 来自 membership，任何商家注册后就是自己租户的 `owner`，
      // 只查角色等于给每个商家开了「给自己无限发积分」的入口（实测一条 grant-id 可发 800）。
      // 因此这两条路由除角色守卫外，还必须由平台运维凭证证明调用方是内部人员：
      //   - 生产：`x-sitong-admin-token` 必须等于 `env.ADMIN_TOKEN`（同 `/admin/invites`）；
      //   - 本地/开发：`ADMIN_TOKEN` 未配置时沿用既有「未配置即放行」语义，角色守卫仍然生效。
      // 读侧同样要凭证：列表含全平台客户手机号，属于跨租户数据。
      admin.get<{ Querystring: { limit?: string } }>(
        "/trial-grants",
        { preHandler: requireAdminToken },
        async (request) => {
          const limit = clampLimit(request.query.limit);
          return { grants: await listMarketplaceTrialGrants(limit) };
        }
      );

      admin.post("/trial-grants", async (request, reply) => {
        await requireAdminToken(request, reply);
        if (reply.sent) return;
        await requireMarketplaceAdmin("write")(request, reply);
        if (reply.sent) return;
        // PLAT-28 第①批（用户 2026-09-12）：人工发放入口默认停用，历史流水只读保留。
        // 停用必须是「明确已停用」而不是 500，所以在这里直接返回 403 + 专属错误码；
        // 想重新放行只能改后台开关（PlatformSetting.MARKETPLACE_TRIAL_GRANT_ENABLED），
        // 不走「再加一个后门参数」的路子。
        if (!(await isMarketplaceTrialGrantEnabled())) {
          return reply.code(403).send({
            error: "trial_grant_disabled",
            message:
              "人工发放体验额度已停用（推荐有礼上线前收口）。历史发放记录仍可查看；如需重新放行，请在后台打开「人工体验额度发放」开关。"
          });
        }
        const parsed = trialGrantInputSchema.safeParse(request.body ?? {});
        if (!parsed.success) {
          return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
        }
        const context = await resolveRequestContext(request.headers);
        try {
          const grant = await grantMarketplaceTrialCredits({
            identity: parsed.data.identity,
            amount: parsed.data.amount,
            grantId: parsed.data.grantId,
            operator: parsed.data.operator ?? context.userId,
            tenantId: parsed.data.tenantId ?? null,
            dryRun: parsed.data.dryRun ?? false
          });
          return { grant };
        } catch (error) {
          if (error instanceof TrialGrantError) {
            const status =
              error.code === "trial_grant_user_not_found"
                ? 404
                : error.code === "trial_grant_id_conflict" || error.code === "trial_grant_user_ambiguous"
                  ? 409
                  : 400;
            return reply.code(status).send({ error: error.code, message: error.message });
          }
          throw error;
        }
      });

      // ---------------------------------------------------------------------
      // PLAT-28 第①批：推荐有礼配置位（后台可读写）+ 推荐码下发 + 归因查询
      //
      // 这一批**不发任何奖励**：配置位只负责「读得到、写得到、校验严格」，
      // 奖励发放口径（三段金额、首次真实使用/首充触发、退款冲正）留给第②批。
      // 写操作一律要求平台运维凭证 + 运营角色，与体验额度发放同一套守卫。
      // ---------------------------------------------------------------------
      admin.get("/referral-config", { preHandler: requireAdminToken }, async () => {
        return await readPlatformSettings();
      });

      admin.patch("/referral-config", async (request, reply) => {
        await requireAdminToken(request, reply);
        if (reply.sent) return;
        await requireMarketplaceAdmin("write")(request, reply);
        if (reply.sent) return;
        const parsed = platformSettingUpdateSchema.safeParse(request.body ?? {});
        if (!parsed.success) {
          return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
        }
        const context = await resolveRequestContext(request.headers);
        try {
          const snapshot = await updatePlatformSettings(
            parsed.data.updates,
            parsed.data.operator ?? context.userId
          );
          return snapshot;
        } catch (error) {
          if (error instanceof PlatformSettingError) {
            return reply.code(400).send({ error: error.code, key: error.key, message: error.message });
          }
          throw error;
        }
      });

      admin.post("/referral-codes", async (request, reply) => {
        await requireAdminToken(request, reply);
        if (reply.sent) return;
        await requireMarketplaceAdmin("write")(request, reply);
        if (reply.sent) return;
        const parsed = referralCodeInputSchema.safeParse(request.body ?? {});
        if (!parsed.success) {
          return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
        }
        const context = await resolveRequestContext(request.headers);
        try {
          const issued = await issueReferralCode({
            identity: parsed.data.identity,
            label: parsed.data.label ?? null,
            createdBy: parsed.data.operator ?? context.userId
          });
          return { referralCode: issued };
        } catch (error) {
          if (error instanceof ReferralCodeError) {
            const status = error.code === "referral_user_not_found" ? 404 : error.code === "referral_user_ambiguous" ? 409 : 400;
            return reply.code(status).send({ error: error.code, message: error.message });
          }
          throw error;
        }
      });

      admin.get<{ Querystring: { limit?: string; ownerUserId?: string } }>(
        "/referral-codes",
        { preHandler: requireAdminToken },
        async (request, reply) => {
          const ownerUserId = (request.query.ownerUserId ?? "").trim();
          if (!ownerUserId) {
            return reply.code(400).send({
              error: "invalid_request",
              message: "按推荐人查推荐码需要 ownerUserId（全量码清单属于第③批推荐明细后台）。"
            });
          }
          return { codes: await listReferralCodesOfOwner(ownerUserId) };
        }
      );

      admin.get<{ Querystring: { limit?: string } }>(
        "/referrals",
        { preHandler: requireAdminToken },
        async (request) => {
          const limit = clampLimit(request.query.limit);
          return { bindings: await listReferralBindings(limit) };
        }
      );
    }, { prefix: "/admin" });
  }, { prefix: "/market" });
}

type MarketplaceAdminOperation = "read" | "write";

function requireMarketplaceAdmin(operation: MarketplaceAdminOperation) {
  return async function guard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const context = await resolveRequestContext(request.headers);
    const rank = roleRank(context.role);
    if (operation === "read") {
      if (rank < 1) await reply.code(403).send({ error: "marketplace_admin_required" });
      return;
    }
    if (rank < 2) await reply.code(403).send({ error: "marketplace_admin_write_required" });
  };
}

function roleRank(role: string): number {
  if (role === "owner" || role === "admin") return 3;
  if (role === "operator") return 2;
  if (role === "manager") return 1;
  return 0;
}

async function tryResolveContext(request: FastifyRequest): Promise<RequestContext | null> {
  try {
    return await resolveRequestContext(request.headers);
  } catch {
    return null;
  }
}

async function getCreditBalance(context: RequestContext): Promise<number> {
  if (context.source === "demo") return demoMarketplace.getBalance(context.tenantId);
  // 货架只认用户双桶钱包：展示（/market/me、访问态）与消耗积分（/run、/ppu/consume）必须同源，
  // 否则会出现「余额显示够、消耗积分却失败」或反向的错账。
  return (await readWallet(context.userId)).balance;
}

export async function listMarketplaceSkus(query: MarketplaceSkuQuery, includeOffline: boolean): Promise<PublicMarketplaceSku[]> {
  if (env.DATA_MODE === "demo") {
    return demoMarketplace.listSkus(query, includeOffline).map((sku) => demoMarketplace.toPublic(sku));
  }

  const rows = await prisma.marketplaceSku.findMany({
    where: {
      ...(includeOffline ? {} : { status: { in: PUBLIC_MARKETPLACE_STATUSES } }),
      ...(query.status ? { status: query.status } : {})
    },
    include: { supplier: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }]
  });

  return rows
    .filter((row) =>
      matchesMarketplaceQuery(
        {
          name: row.name,
          description: row.description,
          useCase: row.useCase,
          need: row.need,
          badge: row.badge,
          verbs: normalizeJsonArray(row.verbs),
          tags: normalizeJsonArray(row.tags),
          keywords: normalizeJsonArray(row.keywords),
          zone: row.zone,
          supplierName: row.supplier.name
        },
        query
      )
    )
    .filter((row) => {
      if (query.supplierId && row.supplierId !== query.supplierId) return false;
      if (query.badge && row.badge !== query.badge) return false;
      if (typeof query.trial === "boolean" && row.trial !== query.trial) return false;
      if (typeof query.minPpu === "number" && row.ppu < query.minPpu) return false;
      if (typeof query.maxPpu === "number" && row.ppu > query.maxPpu) return false;
      if (typeof query.minSub === "number" && (row.subscriptionPriceCny ?? 0) < query.minSub) return false;
      if (typeof query.maxSub === "number" && (row.subscriptionPriceCny ?? 0) > query.maxSub) return false;
      return true;
    })
    .map((row) =>
      toPublicMarketplaceSku({
        ...row,
        supplierName: row.supplier.name,
        supplierType: row.supplier.type
      })
    );
}

export async function getMarketplaceSku(idOrCode: string): Promise<PublicMarketplaceSku | null> {
  if (env.DATA_MODE === "demo") {
    const sku = demoMarketplace.getSku(idOrCode);
    return sku ? demoMarketplace.toPublic(sku) : null;
  }

  const row = await prisma.marketplaceSku.findFirst({
    where: { OR: [{ id: idOrCode }, { skuCode: idOrCode }] },
    include: { supplier: true }
  });
  if (!row) return null;
  return toPublicMarketplaceSku({
    ...row,
    supplierName: row.supplier.name,
    supplierType: row.supplier.type
  });
}

/**
 * 包月订阅（积分口径）——用户 2026-09-17 拍板。
 *
 * 口径：
 *   1. 每个智能体自己决定计费方式：按次（`ppu`）、按消耗（成本口径）、或按月订阅。
 *   2. 订阅期内**不再扣积分**，只受「每天 N 次」限制（`subscriptionDailyQuota`）。
 *   3. 额度用完后是**显式拒绝**，不静默改成扣积分（用户选了包月就不该被扣分）。
 *
 * 用量按「上海时区自然日」统计，落在 `MarketplaceLedgerEntry` 上（`refType=marketplace_subscription_usage`，
 * `refId=订阅 id`），不新增计数器表——账本本来就是唯一真相，充值/扣费/退款都能从它回溯。
 */
const SUBSCRIPTION_PERIOD_DAYS = 30;
const SUBSCRIPTION_USAGE_REF_TYPE = "marketplace_subscription_usage";

/** 上海时区当天 0 点（订阅额度按自然日重置；服务器时区可能是 UTC，不能直接 setHours）。 */
function shanghaiDayStart(now: Date = new Date()): Date {
  const offsetMs = 8 * 60 * 60_000;
  const shifted = new Date(now.getTime() + offsetMs);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - offsetMs);
}

async function activeSubscriptionFor(context: RequestContext, skuId: string) {
  return prisma.marketplaceSubscription.findFirst({
    where: {
      tenantId: context.tenantId,
      skuId,
      status: "active",
      endDate: { gt: new Date() }
    },
    orderBy: { endDate: "desc" }
  });
}

async function countSubscriptionUsageToday(
  context: RequestContext,
  skuId: string,
  subscriptionId: string
): Promise<number> {
  return prisma.marketplaceLedgerEntry.count({
    where: {
      tenantId: context.tenantId,
      skuId,
      refType: SUBSCRIPTION_USAGE_REF_TYPE,
      refId: subscriptionId,
      status: "completed",
      createdAt: { gte: shanghaiDayStart() }
    }
  });
}

async function subscribeMarketplaceSkuWithCredits(
  context: RequestContext,
  sku: PublicMarketplaceSku,
  reply: FastifyReply
) {
  const price = sku.subscriptionCredits ?? 0;
  const existing = await activeSubscriptionFor(context, sku.id);
  if (existing) {
    // 幂等：重复点「订阅」不重复扣分，直接把当前这期还给前端。
    const usedToday = await countSubscriptionUsageToday(context, sku.id, existing.id);
    return {
      dataMode: "database",
      applied: false,
      alreadySubscribed: true,
      subscription: existing,
      balance: (await readWallet(context.userId)).balance,
      subscriptionStatus: {
        dailyQuota: existing.dailyQuota ?? sku.subscriptionDailyQuota ?? null,
        usedToday,
        endDate: existing.endDate
      }
    };
  }

  const walletBefore = await readWallet(context.userId);
  if (walletBefore.balance < price) {
    return reply.code(402).send({
      error: "insufficient_credits",
      message: `订阅本智能体包月需要 ${price} 积分，当前积分不足，请先充值后再订阅（本次不消耗积分）。`,
      balance: walletBefore.balance,
      required: price,
      rechargeUrl: buildRechargeUrl(sku.skuCode)
    });
  }

  const consumed = await consumeWalletCredits({
    userId: context.userId,
    requestId: `marketplace_subscription:${randomUUID()}`,
    price,
    skillId: sku.skuCode,
    source: "marketplace"
  });
  if (consumed.status === "insufficient") {
    return reply.code(402).send({
      error: "insufficient_credits",
      message: `订阅本智能体包月需要 ${price} 积分，当前积分不足，请先充值后再订阅（本次不消耗积分）。`,
      balance: consumed.wallet.balance,
      required: price,
      rechargeUrl: buildRechargeUrl(sku.skuCode)
    });
  }

  const startDate = new Date();
  const endDate = new Date(startDate.getTime() + SUBSCRIPTION_PERIOD_DAYS * 24 * 60 * 60_000);
  const dailyQuota = sku.subscriptionDailyQuota ?? null;
  const subscription = await prisma.marketplaceSubscription.create({
    data: {
      tenantId: context.tenantId,
      userId: context.userId,
      skuId: sku.id,
      status: "active",
      startDate,
      endDate,
      priceCny: 0,
      credits: price,
      dailyQuota,
      quota: sku.subscriptionQuota ?? null
    }
  });
  await prisma.marketplaceLedgerEntry.create({
    data: {
      tenantId: context.tenantId,
      userId: context.userId,
      skuId: sku.id,
      type: "subscription_charge",
      direction: "debit",
      amountCredits: price,
      amountCny: 0,
      status: "completed",
      idempotencyKey: `marketplace-subscription:${subscription.id}`,
      refType: "marketplace_subscription",
      refId: subscription.id,
      metadata: {
        pricingMode: "subscription_credits",
        dailyQuota,
        periodDays: SUBSCRIPTION_PERIOD_DAYS
      }
    }
  });
  return {
    dataMode: "database",
    applied: true,
    subscription,
    credits: price,
    balance: consumed.wallet.balance,
    paidBalance: consumed.wallet.paidBalance,
    bonusBalance: consumed.wallet.bonusBalance,
    spent: consumed.spent,
    subscriptionStatus: { dailyQuota, usedToday: 0, endDate }
  };
}

async function accessStateFor(context: RequestContext, sku: PublicMarketplaceSku) {
  if (context.source === "demo") {
    const demo = demoMarketplace.getSku(sku.skuCode);
    if (!demo) return { state: "unavailable", balance: 0 };
    return demoMarketplace.accessState(context.tenantId, demo);
  }

  if (!isMarketplaceSkuPurchasable(sku.status)) {
    return { state: "unavailable", balance: await getCreditBalance(context), reason: sku.status };
  }
  const now = new Date();
  const subscription = await prisma.marketplaceSubscription.findFirst({
    where: {
      tenantId: context.tenantId,
      skuId: sku.id,
      status: "active",
      endDate: { gt: now }
    },
    orderBy: { endDate: "desc" }
  });
  if (subscription) {
    const dailyQuota = subscription.dailyQuota ?? sku.subscriptionDailyQuota ?? null;
    const usedToday = await countSubscriptionUsageToday(context, sku.id, subscription.id);
    return {
      state: "subscribed",
      track: "subscription",
      balance: await getCreditBalance(context),
      /** 前端据此显示「已订阅 · 今天还剩 N 条」，并解释为什么这次不扣积分。 */
      subscription: {
        id: subscription.id,
        endDate: subscription.endDate,
        dailyQuota,
        usedToday,
        remaining: dailyQuota == null ? null : Math.max(0, dailyQuota - usedToday),
        exhausted: dailyQuota != null && usedToday >= dailyQuota
      }
    };
  }
  const balance = await getCreditBalance(context);
  const subscribable = (sku.subscriptionCredits ?? 0) > 0;
  return {
    ...(balance >= sku.ppu
      ? { state: "ready" as const, track: "ppu" as const, balance }
      : { state: "insufficient_credits" as const, track: "ppu" as const, balance }),
    /** 支持包月的智能体：把包月价透给前端，让用户自己选「按次」还是「包月」。 */
    subscriptionOffer: subscribable
      ? {
          credits: sku.subscriptionCredits,
          dailyQuota: sku.subscriptionDailyQuota ?? null,
          quota: sku.subscriptionQuota ?? null,
          periodDays: SUBSCRIPTION_PERIOD_DAYS
        }
      : null
  };
}

async function consumeMarketplacePpu(
  context: RequestContext,
  sku: PublicMarketplaceSku,
  idempotencyKey: string
) {
  if (context.source === "demo") {
    return demoMarketplace.consumePpu(context.tenantId, context.userId, sku.skuCode, idempotencyKey);
  }

  const existingLedger = await prisma.marketplaceLedgerEntry.findUnique({
    where: { tenantId_idempotencyKey: { tenantId: context.tenantId, idempotencyKey } }
  });
  if (existingLedger) {
    return {
      state: "completed",
      balance: await getCreditBalance(context),
      idempotent: true
    };
  }

  // 与 /market/skus/:skuId/run 相同的用户双桶钱包消耗积分，保证 /market/me 显示的余额就是被扣的钱包。
  const consumed = await consumeWalletCredits({
    userId: context.userId,
    requestId: `marketplace_ppu:${idempotencyKey}`,
    price: sku.ppu,
    skillId: sku.skuCode,
    source: "marketplace"
  });
  if (consumed.status === "insufficient") {
    return { state: "insufficient_credits", balance: consumed.wallet.balance };
  }

  await prisma.marketplaceLedgerEntry.create({
    data: {
      tenantId: context.tenantId,
      userId: context.userId,
      skuId: sku.id,
      type: "ppu_consume",
      direction: "debit",
      amountCredits: sku.ppu,
      amountCny: 0,
      status: "completed",
      idempotencyKey,
      refType: "marketplace_ppu_consume",
      refId: idempotencyKey
    }
  });
  return { state: "completed", balance: consumed.wallet.balance, idempotent: consumed.idempotent };
}


async function createMarketplaceSubscription(context: RequestContext, sku: PublicMarketplaceSku) {
  if (context.source === "demo") {
    const order = demoMarketplace.createSubscription(context.tenantId, context.userId, sku.skuCode);
    return { dataMode: "demo", order };
  }

  const expiresAt = new Date(Date.now() + 30 * 60_000);
  const order = await prisma.marketplaceSubscriptionOrder.create({
    data: {
      tenantId: context.tenantId,
      userId: context.userId,
      skuId: sku.id,
      priceCny: sku.subscriptionPriceCny ?? 0,
      expiresAt,
      codeUrl: `weixin://wxpay/pending/${Date.now()}`
    }
  });
  return { dataMode: "database", order };
}

async function mockPayMarketplaceSubscription(context: RequestContext, orderId: string) {
  if (context.source === "demo") {
    const subscription = demoMarketplace.paySubscription(orderId, context.tenantId);
    return { dataMode: "demo", subscription, applied: true };
  }

  const order = await prisma.marketplaceSubscriptionOrder.findFirst({
    where: { id: orderId, tenantId: context.tenantId }
  });
  if (!order) throw Object.assign(new Error("marketplace_order_not_found"), { statusCode: 404 });
  if (order.status === "paid") {
    const existing = await prisma.marketplaceSubscription.findUnique({
      where: { id: order.subscriptionId ?? "" }
    });
    return { dataMode: "database", subscription: existing, applied: true };
  }
  if (order.status !== "pending") {
    throw Object.assign(new Error(`marketplace_order_not_payable:${order.status}`), { statusCode: 409 });
  }

  const sku = await prisma.marketplaceSku.findUnique({ where: { id: order.skuId } });
  if (!sku || !sku.subscriptionPriceCny) {
    throw Object.assign(new Error("marketplace_subscription_not_available"), { statusCode: 409 });
  }

  const endDate = new Date(Date.now() + 30 * 24 * 60 * 60_000);
  const result = await prisma.$transaction(async (tx) => {
    const subscription = await tx.marketplaceSubscription.create({
      data: {
        tenantId: order.tenantId,
        userId: order.userId,
        skuId: order.skuId,
        status: "active",
        startDate: new Date(),
        endDate,
        priceCny: order.priceCny,
        quota: sku.subscriptionQuota,
        providerOrderId: order.providerOrderId
      }
    });
    await tx.marketplaceSubscriptionOrder.update({
      where: { id: order.id },
      data: { status: "paid", paidAt: new Date(), subscriptionId: subscription.id }
    });
    await tx.marketplaceLedgerEntry.create({
      data: {
        tenantId: order.tenantId,
        userId: order.userId,
        skuId: order.skuId,
        type: "subscription_charge",
        direction: "debit",
        amountCredits: 0,
        amountCny: order.priceCny,
        status: "completed",
        idempotencyKey: `subscription-order:${order.id}`,
        refType: "marketplace_subscription_order",
        refId: order.id
      }
    });
    return subscription;
  });
  return { dataMode: "database", subscription: result, applied: true };
}

async function listSubscriptions(context: RequestContext) {
  if (context.source === "demo") {
    return demoMarketplace.listSubscriptions(context.tenantId);
  }
  return prisma.marketplaceSubscription.findMany({
    where: { tenantId: context.tenantId },
    orderBy: { endDate: "desc" },
    take: 50
  });
}

/**
 * 「我的」页的**积分退回记录**（用户 2026-09-16：客户 4 次 Word 下载失败被多扣 30 积分，
 * 退了钱但他自己看不到——只显示消耗记录等于让他无从核对）。
 *
 * 只列**与客户切身相关**的退回（Word 导出重复扣费这类），不把内部的预留/结算差额晾出来
 * （那是我们自己的对账动作，客户看不懂也不该看）。
 */
async function listRecentRefunds(context: RequestContext) {
  if (context.source === "demo") return [];
  const rows = await prisma.walletLedger.findMany({
    /**
     * 口径：只列**客户能看懂、该知道自己拿到了**的退回——
     * 即我们主动给客户打的退回（source 形如 `web:ops:<说明>` 或 `web:<说明>:…`）；
     * 内部预留/结算的差额回退 source 恰好就是 `web`，对客户是噪音，这里排除掉。
     */
    where: { userId: context.userId, type: "refund", source: { startsWith: "web:" }, NOT: { source: "web" } },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { id: true, delta: true, source: true, createdAt: true }
  });
  return rows.map((row) => ({
    id: row.id,
    label: (row.source ?? "").replace(/^web:ops:/, "").replace(/^web:/, "").split(":")[0] || "积分退回",
    amountCredits: row.delta,
    detail: row.source?.replace(/^web:/, "") ?? "",
    createdAt: row.createdAt
  }));
}

async function listRecentPpuUsage(context: RequestContext) {
  if (context.source === "demo") {
    return demoMarketplace
      .listLedger(context.tenantId, 20)
      .filter((entry) => entry.type === "ppu_consume")
      .map((entry) => {
        const sku = demoMarketplace.getSku(entry.skuId ?? "");
        return {
          id: entry.id,
          skuCode: sku?.skuCode ?? null,
          skuName: sku?.name ?? null,
          skuIcon: sku?.icon ?? null,
          amountCredits: entry.amountCredits,
          createdAt: entry.createdAt
        };
      });
  }

  const rows = await prisma.marketplaceLedgerEntry.findMany({
    where: { tenantId: context.tenantId, type: "ppu_consume" },
    orderBy: { createdAt: "desc" },
    take: 20,
    include: { sku: true }
  });
  return rows.map((entry) => ({
    id: entry.id,
    skuCode: entry.sku?.skuCode ?? null,
    skuName: entry.sku?.name ?? null,
    skuIcon: entry.sku?.icon ?? null,
    amountCredits: entry.amountCredits,
    createdAt: entry.createdAt.toISOString()
  }));
}

function resolveMarketplaceSkillId(capabilityKey: string | null | undefined): SkillId | undefined {
  if (!capabilityKey) return undefined;
  return MARKETPLACE_SKILL_BY_CAPABILITY[capabilityKey] as SkillId | undefined;
}

/**
 * 「常用智能体」列表（用户 2026-09-16：「常用智能体要不要做成独立的智能体列表页」→ 要）。
 *
 * 与 `listRecentPpuUsage`（最近 20 条流水，用于「我的」页的时间线）不同，这里按 **SKU 聚合**：
 * 每个智能体给「用过几次 / 累计消耗多少积分 / 最近一次什么时候」，页面据此排序（最近用的在最前），
 * 客户点一下就能接着用。口径与扣费账本一致（`marketplaceLedgerEntry.type = ppu_consume`），
 * 只读、按租户隔离。
 */
async function listFrequentAgents(context: RequestContext) {
  if (context.source === "demo") {
    const bySku = new Map<string, { skuCode: string; skuName: string | null; skuIcon: string | null; runs: number; credits: number; lastUsedAt: string }>();
    for (const entry of demoMarketplace.listLedger(context.tenantId, 200)) {
      if (entry.type !== "ppu_consume" || !entry.skuId) continue;
      const sku = demoMarketplace.getSku(entry.skuId);
      const skuCode = sku?.skuCode ?? entry.skuId;
      const current = bySku.get(skuCode);
      if (current) {
        current.runs += 1;
        current.credits += Math.abs(entry.amountCredits ?? 0);
        if (entry.createdAt > current.lastUsedAt) current.lastUsedAt = entry.createdAt;
      } else {
        bySku.set(skuCode, {
          skuCode,
          skuName: sku?.name ?? null,
          skuIcon: sku?.icon ?? null,
          runs: 1,
          credits: Math.abs(entry.amountCredits ?? 0),
          lastUsedAt: entry.createdAt
        });
      }
    }
    return [...bySku.values()].sort((a, b) => (a.lastUsedAt < b.lastUsedAt ? 1 : -1));
  }

  const grouped = await prisma.marketplaceLedgerEntry.groupBy({
    by: ["skuId"],
    where: { tenantId: context.tenantId, type: "ppu_consume", skuId: { not: null } },
    _count: { _all: true },
    _sum: { amountCredits: true },
    _max: { createdAt: true }
  });
  const skuIds = grouped.map((row) => row.skuId).filter((id): id is string => Boolean(id));
  if (skuIds.length === 0) return [];
  const skus = await prisma.marketplaceSku.findMany({
    where: { id: { in: skuIds } },
    select: { id: true, skuCode: true, name: true, icon: true, zone: true }
  });
  const skuById = new Map(skus.map((sku) => [sku.id, sku]));
  return grouped
    .map((row) => {
      const sku = row.skuId ? skuById.get(row.skuId) : null;
      return {
        skuCode: sku?.skuCode ?? null,
        skuName: sku?.name ?? null,
        skuIcon: sku?.icon ?? null,
        zone: sku?.zone ?? null,
        runs: row._count._all,
        credits: Math.abs(row._sum.amountCredits ?? 0),
        lastUsedAt: (row._max.createdAt ?? new Date(0)).toISOString()
      };
    })
    .filter((row) => Boolean(row.skuCode))
    .sort((a, b) => (a.lastUsedAt < b.lastUsedAt ? 1 : -1));
}

function marketplaceIndustryContext(sku: PublicMarketplaceSku): string | null {
  const industry = MARKETPLACE_INDUSTRIES[sku.zone];
  if (!industry) return null;
  const core = sku.skuCode.includes("__") ? sku.skuCode.slice(sku.skuCode.lastIndexOf("__") + 2) : sku.skuCode;
  const ov = (industry.ov ?? {})[core] ?? {};
  const cap = typeof ov.cap === "string" ? ov.cap : "";
  const tips = Array.isArray(ov.tip) ? ov.tip.map((item) => String(item)).filter(Boolean) : [];
  if (industry.general) {
    return [
      cap ? `该场景方法论（照此产出）：${cap}` : "",
      tips.length > 0 ? `落地提示：${tips.join("；")}` : ""
    ].filter(Boolean).join("\n") || null;
  }
  return [
    `你是「${industry.title}」行业智能体，服务对象：${industry.who ?? "行业经营者"}。`,
    `行业术语：${industry.lexicon.join("、")}。`,
    `典型痛点：${industry.pains.join("；")}。`,
    `必须遵守的合规红线：${industry.redline.join("；")}。`,
    cap ? `该场景方法论（照此产出）：${cap}` : "",
    tips.length > 0 ? `落地提示：${tips.join("；")}` : ""
  ].filter(Boolean).join("\n");
}

function marketplaceRunInput(sku: PublicMarketplaceSku, input: string): string {
  const context = marketplaceIndustryContext(sku);
  const instruction =
    "\n\n输出要求：只给用户交付成果，格式严格按上文要求（章节标题 / 表格结构保持清晰）。禁止输出任何推导过程、评分标准、内部评估、工作区/任务卡等字样。";
  return context ? `${context}\n\n用户输入：\n${input}${instruction}` : `${input}${instruction}`;
}

/** 把后端重算出的视频明细渲染成 Markdown 表，喂给模型只做归因，不做数字计算。 */
function vidrevRowsTable(metrics: VidrevMetrics): string {
  const num = (value: number | null, unit = ""): string => (value === null ? "数据缺失" : `${value}${unit}`);
  const pct = (value: number | null): string => (value === null ? "数据缺失" : `${(value * 100).toFixed(2)}%`);
  const header = "| video_id | 标题 | 时长(s) | 发布时间 | 播放 | 赞 | 评论 | 分享 | 收藏 | 完播率 | 5秒完播率 | 咨询 | 投流金额 | 内容类型 |";
  const divider = "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|";
  const rows = metrics.videos.map((video) =>
    [
      "",
      video.id,
      video.title,
      num(video.durationSec),
      video.publishedAt ?? "数据缺失",
      num(video.plays),
      num(video.likes),
      num(video.comments),
      num(video.shares),
      num(video.saves),
      pct(video.completionRate),
      pct(video.completion5s),
      num(video.conversions),
      num(video.adSpend, " 元"),
      video.contentType.length > 0 ? video.contentType : "未标注",
      ""
    ].join(" | ")
  );
  return [header, divider, ...rows].join("\n");
}

/**
 * 排障用：仅在显式设置 `VIDREV_DEBUG_DUMP_DIR` 时，把未通过校验的模型原文落盘。
 * 用于定位「模型排版漂移」类间歇失败（默认不写盘、不落库、不影响交付）。
 */
async function dumpVidrevDebugOutput(stage: string, markdown: string, failures: string[]): Promise<void> {
  const dir = process.env.VIDREV_DEBUG_DUMP_DIR;
  if (!dir || markdown.trim().length === 0) return;
  try {
    await mkdir(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await writeFile(
      join(dir, `vidrev-${stage}-${stamp}.md`),
      `<!-- failed_rules: ${failures.join(" | ")} -->\n\n${markdown}`,
      "utf8"
    );
  } catch {
    // 诊断写入失败不得影响交付。
  }
}

const MARKETPLACE_SKILL_PROMPTS: Record<string, string> = {
  "ip-pos": "按 IP 定位方法论，输出一个 Markdown 表格，列依次为：维度（项目定位 / 目标用户 / 人设定位 / 记忆板块 / 内容矩阵）、结论、说明。每个维度一行。",
  topic: "按选题三关筛选方法论，输出一个 Markdown 表格，列依次为：序号、选题、切入角度、平台建议、是否踩雷。给 3-5 行。",
  copy: "按文案方法论，输出一个 Markdown 表格，列依次为：模块（钩子 / 正文 / 标题话题 / 发布建议）、内容。每模块一行。",
  vidrev: "按视频复盘方法论，输出一个 Markdown 表格，列依次为：模块（数据概览 / 归因 / 下一条动作）、内容。每模块一行。",
  livescript: "按直播话术方法论输出完整 2 小时直播逐字稿（统一九段环节 + 每段【主播口播稿】/【主播节奏提示】双块 + 节奏表 / 控场清单 / 高频应答 / 开播前检查四附属件）。",
  liverev: "按直播复盘方法论，输出一个 Markdown 表格，列依次为：模块（定量指标 / 定性问题 / 话术迭代带）、内容。每模块一行。",
  sales: "按销售成交方法论，输出一个 Markdown 表格，列依次为：模块（客户判断 / 标准话术 / 异议处理 / 合规提示）、内容。每模块一行。",
  moments: "按朋友圈七柱方法论，输出一个 Markdown 表格，列依次为：模块（正文 / 配图建议 / 发布时间）、内容。每模块一行。",
  "ip-pack": "按 IP 增长全链路方法论，输出一个 Markdown 表格，列依次为：模块（现状判断 / 先打哪一环 / 排兵布阵）、内容。每模块一行。"
};

const LIVESCRIPT_SYSTEM_PROMPT = [
  "你是思潼AI「直播话术智能体」，交付一份可直接照读的完整 2 小时直播逐字稿。",
  "先看输入里的「场次类型」：带货 / 团购按 C 端带货写；招商加盟按 B 端招商写。两条线的话术体系完全不同，绝不串场。",
  "",
  "## 输出结构（统一九段环节，默认 2 小时）",
  "严格按下面九段输出，每段固定两个子块：【主播口播稿】和【主播节奏提示】。",
  "1. 开场暖场（两步式自我介绍：量化入脑 + 共情入心）",
  "2. 痛点共鸣（说目标人群的苦，抛互动）",
  "3. 首轮塑品（带货=FABE / 项目塑品；招商=实力背书 + 单店模型测算）",
  "4. 第一轮逼单留资（带货=下单 / 领券；招商=领测算表 / 留资）",
  "5. 互动答疑（念评论 / 连麦问答）",
  "6. 循环带货 / 循环塑品（第二轮·换角度换案例，骨架不变）",
  "7. 案例背书（讲真实客户体验，不承诺结果）",
  "8. 异议处理（算账 + 降门槛 + 给路径三连）",
  "9. 锁客收尾（留资 / 逼单升级 + 合规提示）",
  "",
  "## 形态铁律",
  "- 从 0:00 连续铺到 120:00，每段不空、不跳、不写「此处自由发挥」。",
  "- 【主播口播稿】写主播真实会念的话，动作 / 神态用 [ ] 标注在句前（如 [笑着挥手] [认真脸]）。",
  "- 【主播节奏提示】写场控 / 运营动作（贴片、切连麦、弹入口、看评论念两条等），与口播稿并列。",
  "- 核心塑品每 20 分钟轮播一次，每轮换角度 / 换真实案例，骨架不变，保证任意时间进来的观众都能接上。",
  "",
  "## 必交付四附属件（放在逐字稿之后）",
  "1. 2 小时节奏表（主播版）：时间段 / 主题 / 主播节奏。",
  "2. 控场执行清单：评论区置顶 / BGM 节点 / 画面切换 / 弹窗时机 / 违规监控 / 库存通报。",
  "3. 高频应答（最常见 5 问标准应答），带合规安全词。",
  "4. 开播前检查清单（人货场）。",
  "",
  "## 合规红线（必须遵守）",
  "- 禁用《广告法》极限词：最 / 第一 / 国家级 / 首选 / 独家 / 顶级 / 极致。",
  "- 招商禁止承诺收益：包赚 / 稳赚 / 保底 / 零风险 / 回本承诺一律删除，改用「模型测算 / 历史数据参考」，并口播「投资有风险，加盟需谨慎」。",
  "- 带货禁止虚构价格、库存、名额、折扣与效果承诺（美业尤其禁止治疗 / 根治 / 七天见效等疗效词）。",
  "- 只用输入里已确认的事实；没给的数字、门店数、案例、政策不编造，可写「以门店 / 官方口径为准」。",
  "- 不出现竞品名、个人名、课程名；方法论只说框架名。",
  "",
  "直接输出完整逐字稿正文（九段 + 四附属件），不要输出「正在生成」之类的前言。"
].join("\n");

// 直播话术完整版：统一九段 + 四附属件，分九段生成后再单独生成四附属件，拼装成真正铺满 0:00–120:00 的逐字稿。
// 单次调用受 max_tokens 上限限制只能产出约 30–40 分钟口播量，分段生成才能达到「几万字」体量。
const LIVE_SCRIPT_SEGMENTS: Array<{ title: string; time: string; minutes: number; points: string }> = [
  { title: "一、开场暖场（两步式自我介绍）", time: "0:00–0:10", minutes: 10, points: "量化入脑（做多久/规模/服务多少人）+ 共情入心（说目标人群怕踩坑）" },
  { title: "二、痛点共鸣", time: "0:10–0:25", minutes: 15, points: "说出目标人群的苦：没方向/怕被割/怕投进去没回响；抛「扣1」互动" },
  { title: "三、首轮塑品", time: "0:25–0:45", minutes: 20, points: "带货=FABE；招商=实力背书→单店模型测算→扶持具象→留资钩子" },
  { title: "四、第一轮逼单留资", time: "0:45–0:55", minutes: 10, points: "带货=下单/领券；招商=领测算表/留资；不虚构稀缺" },
  { title: "五、互动答疑（连麦望闻问切）", time: "0:55–1:05", minutes: 10, points: "念两条评论作答/连麦问答，托举不说教" },
  { title: "六、循环塑品（第二轮·换角度）", time: "1:05–1:25", minutes: 20, points: "换角度/换案例再讲一轮，骨架不变（每20分钟一轮）" },
  { title: "七、案例背书", time: "1:25–1:40", minutes: 15, points: "讲真实客户体验，只说「他怎么说」，不承诺结果" },
  { title: "八、异议处理", time: "1:40–1:50", minutes: 10, points: "算账+降门槛+给路径三连" },
  { title: "九、锁客收尾", time: "1:50–2:00", minutes: 10, points: "留资/逼单升级 + 合规提示（招商口播「投资有风险，加盟需谨慎」）" }
];

async function generateLiveScriptFull(
  systemPrompt: string,
  turnMessages: LlmMessage[],
  complete: (messages: LlmMessage[], options?: { maxTokens?: number }) => Promise<string>
): Promise<string> {
  const parts: string[] = [];
  for (let i = 0; i < LIVE_SCRIPT_SEGMENTS.length; i++) {
    const seg = LIVE_SCRIPT_SEGMENTS[i];
    const targetChars = Math.round(seg.minutes * 165);
    const directive = [
      `## 当前生成任务：${seg.title}（第 ${i + 1}/${LIVE_SCRIPT_SEGMENTS.length} 段）`,
      "你正在分九段生成一场 2 小时直播的完整逐字稿。现在只生成上面这一段，禁止输出其它段落、总标题、目录或任何附属件。",
      `该段时段为 ${seg.time}，要点：${seg.points}。`,
      "要求：",
      "1. 只输出两个子块，标题固定为【主播口播稿】和【主播节奏提示】。",
      `2. 口播稿按该段时长写足、写满，目标约 ${targetChars} 字，逐字可照读，不写“此处自由发挥/此处讲痛点”这类提示词。`,
      "3. 动作/神态用 [ ] 标注在对应句前；托举式语气贯穿。",
      "4. 严格只用输入里已确认的真实事实，不编造数字、收益、门店、名额或案例；该提「投资有风险，加盟需谨慎」的段落必须提。"
    ].join("\n");
    const text = await complete(
      [{ role: "system", content: `${systemPrompt}\n\n---\n\n${directive}` }, ...turnMessages] as LlmMessage[],
      { maxTokens: LIVESCRIPT_MAX_TOKENS }
    );
    parts.push(`## ${seg.title}（${seg.time}）\n\n${(text ?? "").trim()}`);
  }

  const attachmentDirective = [
    "## 当前生成任务：四附属件",
    "现在只输出以下四个附属件，禁止重复整场逐字稿：",
    "1. 2小时节奏表（主播版）：时间段 / 主题 / 主播节奏。",
    "2. 控场执行清单：评论区置顶话术、BGM节点、画面切换、弹窗时机、违规监控、名额/线索通报。",
    "3. 高频应答（最常见5问标准应答），带合规安全词。",
    "4. 开播前检查清单（人货场）。",
    "5. 节奏表必须出现术语「20分钟黄金循环」，并说明核心塑品每 20 分钟轮播一次。",
    "所有内容与整场逐字稿一致，事实只能来自输入里已确认的信息，收益与费用一律走“模型测算/历史数据参考”，并保留合规安全词。"
  ].join("\n");
  const attachmentText = await complete(
    [{ role: "system", content: `${systemPrompt}\n\n---\n\n${attachmentDirective}` }, ...turnMessages] as LlmMessage[],
    { maxTokens: LIVESCRIPT_MAX_TOKENS }
  );

  const header = [
    "# 2 小时直播 · 完整逐字稿",
    "",
    "> 按统一九段环节分九段生成，时间轴 0:00–120:00；每段含【主播口播稿】+【主播节奏提示】双块，四附属件见文末。",
    ""
  ].join("\n");
  return `${header}${parts.join("\n\n")}\n\n---\n\n# 附属件（四件）\n\n${(attachmentText ?? "").trim()}`;
}

function marketplaceSkillSystemPrompt(sku: PublicMarketplaceSku): string {
  const core = sku.skuCode.includes("__") ? sku.skuCode.slice(sku.skuCode.lastIndexOf("__") + 2) : sku.skuCode;
  if (core === "topic") return TOPIC_SYSTEM_PROMPT;
  if (core === "copy") return COPY_TEN_SYSTEM_PROMPT;
  if (core === "vidrev") return VIDREV_SYSTEM_PROMPT;
  if (core === "livescript") return LIVESCRIPT_SYSTEM_PROMPT;
  const prompt = MARKETPLACE_SKILL_PROMPTS[core] ?? "输出一个 Markdown 表格，列依次为：模块、内容。";
  return `你是思潼AI行业智能体平台的「${sku.name}」。${prompt}\n只输出一个 Markdown 表格，不要输出表格之外的任何说明、推导、评分或内部评估。`;
}

const TOPIC_SYSTEM_PROMPT = [
  "你是思潼AI行业智能体平台的「选题智能体」。一次交付 10 条选题，输出严格按下面的 Markdown 结构，主表格必须正好是这 7 列：",
  "| # | 选题 | 类型 | 来源 | 共识层级 | 客资准度 | 创作建议 |",
  "",
  "字段取值：",
  "- 类型：认知型 / 信任型 / 连接型 / 转化型",
  "- 来源：Get笔记 / 行业热点 / 数据复盘 / 同行爆款（可复合，如 `Get笔记+同行爆款`）",
  "- 共识层级：人性共识 / 时代共识 / 利益共识 / 热点共识 / 专业共识",
  "- 客资准度：★☆☆☆☆ / ★★★☆☆ / ★★★★☆ / ★★★★★",
  "",
  "共识层级与客资准度必须严格按下表绑定，不可自由组合：",
  "| 共识层级 | 客资准度 | 战略目的 |",
  "|---|---|---|",
  "| 人性共识 | ★☆☆☆☆ | 拉流量，撬自然流 |",
  "| 时代共识 | ★★★☆☆ | 建认知，让目标客户认识你 |",
  "| 利益共识 | ★★★★☆ | 主力内容，流量+客资双拿 |",
  "| 热点共识 | ★★★☆☆ | 借势曝光 |",
  "| 专业共识 | ★★★★★ | 收客资，看了就想咨询 |",
  "",
  "三关（结果体现在选题里）：关① 一票否决（目标用户想不想看，取值 通过 / 通过（弱证据） / 否决，禁止写'应该有人想看'，无数据时标'弱证据：依据公开报道'）；关② 共识层级×客资准度只贴标签不淘汰；关③ 阶段配比（起号期 人性5/时代2/利益2/专业1，增长期 3/3/3/1，变现期 2/2/3/3，热点看时机）。",
  "来源配额（10 条）：Get笔记 3-4 / 行业热点 2-3 / 数据复盘 2 / 同行爆款 2。若用户未提供账号数据，来源③的 2 条并入①②，并如实写「来源③：未提供数据，2 条配额已并入①②」，禁止用'内容空白'猜测。",
  "CTA 严禁出现：私信 / 电话 / 找我 / 留个 / 加我 / 扫码领（合规引导用'看主页/评论区/关注'）。扩展字段（hook/gates/gate1_evidence/platform/risk_level/shoot_tip/cta）补不出时留空白显示 —，禁止编造，不进主表格 7 列。",
  "",
  "输出结构（严格）：",
  "## 一、四个来源实拉结果",
  "| 来源 | 实拉情况 | 拿到什么 |",
  "## 二、选题 10 条（三关已过）",
  "| # | 选题 | 类型 | 来源 | 共识层级 | 客资准度 | 创作建议 |",
  "（10 行）",
  "## 三、配比校验（{阶段}）",
  "| 层级 | 基线 | 本次 | 结论 |",
  "结论 + 调整建议",
  "## 四、来源配额核对",
  "| 来源 | 目标 | 实际 | 说明 |",
  "",
  "先判断信息是否够用：若「行业 / 账号阶段」缺失、敷衍（乱码、随意字符、与业务无关）或明显无法理解，则不要输出选题表；只输出：第一行「【需补充信息】」，下面 1-3 条「- 需要补充：…」问清行业与账号阶段。",
  "其中「阶段」由用户账号阶段决定：起号期 / 增长期 / 变现期。只输出该 Markdown，不要输出表格之外的任何说明、推导、评分或内部评估。"
].join("\n");

interface TopicRow {
  id: string;
  title: string;
  type: string;
  source: string;
  consensus: string;
  precision: string;
  advice: string;
}

function parseTopicTable(text: string): { rows: TopicRow[]; failures: string[] } {
  const failures: string[] = [];
  const lines = text.split(/\r?\n/);
  const rows: TopicRow[] = [];
  let idx = 0;
  // 找到主表格（表头含 选题 的 7 列表）
  for (let i = 0; i < lines.length; i++) {
    const cells = splitRow(lines[i]);
    if (cells.length >= 7 && cells[0].trim() === "#" && (cells[1] ?? "").trim() === "选题") {
      idx = i + 1;
      break;
    }
  }
  if (idx === 0) {
    return { rows, failures: ["未找到符合 7 列（# / 选题 / 类型 / 来源 / 共识层级 / 客资准度 / 创作建议）的主表格"] };
  }
  for (; idx < lines.length; idx++) {
    const line = lines[idx].trim();
    if (!line.startsWith("|")) break;
    const cells = splitRow(line).map((c) => c.trim());
    if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue;
    if (cells.length < 7) {
      failures.push(`第 ${rows.length + 1} 行字段不足（应为 7 列，实际 ${cells.length}）`);
      rows.push({ id: cells[0] ?? "", title: cells[1] ?? "", type: cells[2] ?? "", source: cells[3] ?? "", consensus: cells[4] ?? "", precision: cells[5] ?? "", advice: cells[6] ?? "" });
      continue;
    }
    rows.push({ id: cells[0], title: cells[1], type: cells[2], source: cells[3], consensus: cells[4], precision: cells[5], advice: cells[6] });
  }
  if (rows.length < 10) failures.push(`选题不足 10 条（实际 ${rows.length} 条）`);
  const binding: Record<string, number> = { "人性共识": 1, "时代共识": 3, "利益共识": 4, "热点共识": 3, "专业共识": 5 };
  rows.forEach((r, i) => {
    const expected = binding[r.consensus];
    const stars = (r.precision.match(/★/g) ?? []).length;
    if (expected === undefined) failures.push(`第 ${i + 1} 条共识层级非法：${r.consensus}`);
    else if (stars !== expected) failures.push(`第 ${i + 1} 条「${r.consensus}」应绑定 ${"★".repeat(expected)}，实际 ${r.precision}`);
    if (!r.title || !r.type || !r.source || !r.advice) failures.push(`第 ${i + 1} 条存在空字段`);
  });
  if (!/配比校验/.test(text)) failures.push("缺少「配比校验」块");
  if (/私信|电话|找我|留个|加我|扫码领/.test(text)) failures.push("CTA 含违禁词（私信/电话/找我/留个/加我/扫码领）");
  return { rows, failures };
}

function splitRow(line: string): string[] {
  const l = line.trim();
  if (!l.startsWith("|") || !l.endsWith("|")) return [];
  return l.slice(1, -1).split("|");
}

const VIDREV_SYSTEM_PROMPT = [
  "你是思潼AI行业智能体平台的「视频复盘智能体」。一次交付 = 1 份完整复盘报告：1 个一级标题（H1）+ 第零章到第十章共 11 个二级标题（H2），章节名与顺序逐字照抄下面这份清单，章节内禁止使用 H3/H4：",
  "H1：`# 短视频复盘报告 · <周期起> ~ <周期止>（<平台名>）`",
  "## 零、数据质量审计",
  "## 一、数据总览",
  "## 二、视频分层",
  "## 三、内容结构健康度",
  "## 四、单条深拆（TOP3 + BOTTOM3）",
  "## 五、完播率深层归因",
  "## 六、互动深度分析",
  "## 七、趋势预警",
  "## 八、规律总结",
  "## 九、方法论沉淀",
  "## 十、下个周期选题建议",
  "",
  "【零、数据质量审计】必须是一张「检查项 | 结果」表格，检查项至少含：总记录数、完播率覆盖、评论数据、发布时段、投流标记。表格后接「受限维度：」并用 1. 2. 3. 逐条列出每一个缺失维度、影响和降级口径；确实没有缺失时写「受限维度：无」。",
  "「发布时段」一律按下文数据明细里的「发布时间」列判定：有则该行写「精确到日/精确到小时」，无（写「数据缺失」）才在受限维度里声明缺失——禁止数据里有发布时间却宣称「发布时段缺失」。",
  "【一、数据总览】用「指标 | 数值」表格，至少含：视频总数、总播放、总互动（含互动率，注明加权）、总转化、投流金额、ROI、趋势、账号基线（中位数）。**ROI 无成交金额字段时必须写「数据缺失（无成交金额字段）」，禁止填 0 或编造数值。** 表格后可点明均值是否被极值污染、判断账号健康度一律看中位数。",
  "【二、视频分层】先写分层口径（播放中位数、转化中位数、高播放 ≥1.5× 中位数、高转化 ≥1.5× 中位数），再原样照抄后端给出的分层表，列名固定为：象限 | video_id | 标题 | 播放 | 咨询 | 完播。**第二列必须是 video_id（逐字照抄后端数据明细里的 ID，例如 v3 或 export/UzFf…），禁止用 1. / 2. 这类序号或把「标题」顶到第二列代替。** 四象限名称固定为「又爆又赚 / 有量无转 / 有转无量 / 没量没转」，空象限写「无」。**四象限条数之和必须等于总条数，每条视频只能出现在一行**；落在中间带的按播放是否达基线二分。",
  "【三、内容结构健康度】用「类型 | 条数 | 占比 | 均播 | 互动率 | 完播率 | 判定」表格逐类型列出；再写 `健康度评分 =（爆款型 + 人设型）/ 总数 = xx% → 🟢/🟡/🔴`，档位必须与分数一致（>50%🟢 / 30–50%🟡 / <30%🔴）；再写核心矛盾（太少/太多/错配）与调整建议（增/减/改）。",
  "【四、单条深拆】格式：`1. <video_id>「<标题>」｜<象限>`，下一行写该条指标（播放 / 赞 / 评 / 分享 / 收藏 / 完播 / 5秒完播 / 咨询 / 是否投流），再写「为什么好：」或「为什么流量好但转化差：」或「为什么不行：」+ 1. 2. 3. **至少 3 条理由**，最后写「可复用：…」与「改进：…」。总条数 ≥6 时必须 TOP3 + BOTTOM3 共 6 条；<6 时至少 TOP1 + BOTTOM1。**video_id 必须来自本次数据，禁止编造视频。**",
  "【五、完播率深层归因】按时长自适应分桶（3–5 桶，每桶 ≥1 条，默认 <30s / 30-45s / 45-60s / >60s；某桶为空要合并并注明「该桶本周期无内容，无法评估」），用「时长区间 | 条数 | 均播 | 完播率」表格；再按类型给完播率；最后写「最佳配方：」指名「类型 × 时长」。**禁止写死 <10s/10-20s/20-40s。**",
  "【六、互动深度分析】给出浅互动率、深互动率、赞/分享比与判定（<2:1🟢 / 2–4:1🟡 / >4:1🔴），并列出分享率 TOP3。",
  "【七、趋势预警】先写账号基线（播放中位数、互动率中位数、警戒线、优秀线），再写「周次 | 条数 | 均播 | 播放中位数」表格（周度数字后端已给出，照抄不要自己重算）；再写告警（🔴/🟡 等级 + 触发条件 + 动作）与积极信号。**数据不足 3 条时本章只写一句「样本不足 3 条，本周期不输出趋势预警。」**",
  "【八、规律总结】用表格逐维列出钩子 / 选题 / 形式 / 时间 / 转化五个维度，**五维各 ≥1 条，每条必须指名支撑视频（如 v1、v5）。** 只有本次数据完全没有「发布时间」时，时间维度才允许写「数据缺失，本周期不做时间归因」并把「支撑视频」列写「无」。",
  "【九、方法论沉淀】≥2 条，每条用 `1.` `2.` 编号独占一段，五个字段各占一行、字段名逐字写全：`类型：…`、`规律：…`、`证据：…`、`置信度：…`、`相关选题：…`（禁止把五个字段用「/」串成一行）；证据必须带具体视频与数字；置信度只能取「疑似规律 / 已确认 / 黄金法则」。",
  "【十、下个周期选题建议】四个方向必须齐全且用这些标题：主力复制（又爆又赚池）/ 优化重拍（有量无转池）/ 投流放量（有转无量池）/ 放弃方向，每个方向给出基于具体 video_id 的动作；最后给「候选选题（直接进选题池，来源：数据复盘）」**≥2 条**，每条一句可发布的选题标题 + 依据。候选选题的标题与评论引导**严禁出现：私信 / 电话 / 找我 / 留个 / 加我 / 扫码领**。",
  "",
  "【硬口径（写错即判失败、不消耗积分）】",
  "1. 所有比率一律加权平均（总量相除）：互动率 = Σ互动 ÷ Σ播放，完播率按播放加权；禁止逐条相除再平均。",
  "2. 空值不等于 0：缺失字段按缺失处理并写「数据缺失」，禁止用 0 兜底参与计算（ROI、完播率、投流金额尤其注意）。",
  "3. 四象限由后端函数判定，报告必须与后端给的口径完全一致，禁止自行改判。",
  "4. 时长分桶必须自适应 3–5 桶，每桶至少 1 条。",
  "5. 不做共识层级、不写口播稿/脚本、不做 IP 定位。",
  "",
  "【排版】一段不超过 5 行；能用表格就不用列表；加粗不超过 12 处；除 🔴🟡🟢 外不要装饰性 emoji；数值百分比保留两位小数。",
  "【输出前自检】① 十章齐全、章节名逐字一致；② 第二章分层表第二列是 video_id（不是序号），四象限条数之和 = 总条数、每条只出现一次；③ 深拆条数与 reasons/reusable/improve 达标，且深拆里的 video_id 逐字照抄；④ 健康度档位与分数一致；⑤ 无成交金额时 ROI 写「数据缺失」；⑥ 第十章四方向齐全且候选选题 ≥2 条、无违禁词。",
  "只输出这一份 Markdown 报告，禁止输出任何推导过程、评分标准、内部评估、工作区/任务卡字样。"
].join("\n");

function extractClarification(text: string): string | null {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return null;
  // 只认开头附近的固定标记，避免正文里偶发提到时误判。
  if (!/【需补充信息】/.test(trimmed.slice(0, 120))) return null;
  const message = trimmed.replace(/[\s*_#>]*【需补充信息】[\s*_]*/, "").trim();
  return message || "还需要补充关键信息才能生成，请补充「行业 / 产品卖点」与「目标人群」后再试。";
}

/* ---------------------------------------------------------------------------
 * IP 定位智能体（ip-pos）：400 积分/次（用户 2026-09-17 拍板「按次计费、不按消耗量计费」，
 * 已在 `billing-cost-model.ts` 的 `FIXED_PRICE_SKUS` 中退出成本计费），一次交付 1 份完整 IP 定位全案。
 * 全案体量大（1分钟速览 + 八章 + ≥80 条选题），按「0–四章 / 五–八章」两段并发生成再合并，
 * 合并结果必须通过下面的硬校验（V1–V10）才消耗积分，校验不通过不消耗积分、可免费重跑。
 * ------------------------------------------------------------------------- */

const IP_POS_OVERVIEW_FIELDS = [
  "项目定位",
  "核心用户",
  "IP人设",
  "IP原型",
  "当前IP状态",
  "内容重心",
  "首选平台",
  "第一个月核心动作"
];

const IP_POS_COMMON_RULES = [
  "【一次交付】交付 1 份完整的 IP 定位全案（📌1分钟速览 + 一~八章）；允许分轮追问，同一会话只算一次。",
  "【信息不全先问，不许硬出方案】「品牌名 / 现状（有无账号、粉丝量、做过什么）/ 目标用户 / 目标（招商 · 获客 · 卖课）」四项缺一，或回答敷衍（乱码、随意字符、与业务无关，或只写「无 / 没有 / 测试 / 111」），就不要输出任何章节内容，只输出两行：",
  "【需补充信息】",
  "- 需要补充：…（最多 3 条，一次最多问 3 个问题，只问真正缺的，不要重复用户已经给过的信息）",
  "信息够用时，绝对不要出现「需补充信息」这几个字。",
  "【不做什么】不写逐字口播稿 / 拍摄脚本（那是文案智能体的活）、不做实际投放、不承诺涨粉或客资数字、不给回本周期结论。",
  "【空值】用户没给的数据（粉丝量、门店数、月营收、客单价、成本等）一律写「—」或「待补充：需要用户提供…」，严禁编造任何品牌名、数字、案例、资质、客户原话。",
  "【违禁词·命中即判失败】用户可见文案（一句话定位、人设描述、语言正例、签名档、选题标题、钩子话术、执行建议）里禁止出现：私信 / 加微信 / 打电话 / 联系我 / 找我 / 留个 / 扫码；第一 / 唯一 / 最好 / 绝对 / 100% / 保证 / 顶级；包回本 / 稳赚 / 月入过万 / 零风险 / 躺赚 / 必赚。引导一律用「评论区说下你在哪个城市」「看主页置顶」这类合规说法，也不要在正文里复述这些词。",
  "【五步递进不许跳步】项目 → 用户 → 人设 → 内容 → 选题。",
  "【格式】只输出 Markdown 正文；章节号、章节标题、字段名严格照抄下面的结构，表格列名一字不改；不要输出推导过程、评分标准、内部评估、工作区 / 任务卡 / 提示词等字样。"
].join("\n");

const IP_POS_SYSTEM_PROMPT_A = [
  "你是思潼AI行业智能体平台的「IP 定位智能体」。本次你交付 IP 定位全案的【前半部分】：📌1分钟速览 + 一、项目定位 + 二、目标用户定位 + 三、IP人设定位 + 四、内容定位。",
  "第五章及以后由同一次交付的另一段负责，你不要重复输出，也不要写「（后略）」「详见后文」这类占位。",
  IP_POS_COMMON_RULES,
  "",
  "严格按下面的结构输出：",
  "",
  "## 📌 1分钟速览",
  "| 维度 | 结论 |",
  "|---|---|",
  "| 项目定位 | 谁、靠什么、帮谁、赚什么钱 |",
  "| 核心用户 | 最典型的客户是谁 + 他最痛的一件事 |",
  "| IP人设 | 一句话人设（身份 + 帮谁 + 凭什么信） |",
  "| IP原型 | 主原型 + 辅助原型 |",
  "| 当前IP状态 | 账号现状 / 粉丝量 / 内容现状 / 核心卡点（没数据就写 —） |",
  "| 内容重心 | 先打哪一类内容、怎么打 |",
  "| 首选平台 | 主阵地 + 一句话理由 |",
  "| 第一个月核心动作 | 3 条，用 ①②③ 分隔 |",
  "以上 8 行一行都不能少、不能改字段名，缺一判失败。",
  "",
  "## 一、项目定位",
  "### 1.1 一句话定位",
  "> 你做什么 + 帮谁解决什么 + 跟同行最大的不同（一句话）",
  "### 1.2 核心差异化",
  "| 序号 | 差异化点 | 支撑证据 | 用户价值 |",
  "|---|---|---|---|",
  "至少 3 行；「支撑证据」必须是真实数据 / 客户原话 / 可验证事实，禁止只写「专业」「靠谱」这类形容词；用户没给证据就写「待补充：需要用户提供…」。",
  "### 1.3 竞品对比",
  "| 维度 | 我们 | 竞品A | 竞品B | 机会点 |",
  "|---|---|---|---|---|",
  "至少 3 行；竞品 ≥2 个；用户没给竞品就用「竞品A（待补充）」这类占位，不要编造真实品牌。",
  "### 1.4 阶段判断",
  "- 当前阶段：起步期 / 成长期 / 成熟期（按用户给的账号现状判断）",
  "- IP策略方向：一句话说明先做什么、不做什么",
  "",
  "## 二、目标用户定位",
  "### 2.1 用户画像（代号：…）",
  "| 维度 | 描述 |",
  "|---|---|",
  "| 年龄/城市/职业/收入 | … |",
  "| 一句话描述 | …（用目标用户自己的口气说） |",
  "### 2.2 痛点地图",
  "| 序号 | 痛点 | 类型 | 紧急度 | 现状 |",
  "|---|---|---|---|---|",
  "至少 5 行，不足判失败；类型取 功能 / 情感 / 社会，紧急度取 高 / 中 / 低。",
  "### 2.3 决策旅程",
  "| 阶段 | 他在想什么 | 匹配内容类型 |",
  "|---|---|---|",
  "至少 4 行；第三列必须标明内容类型：信任型 / 认知型 / 连接型 / 转化型。",
  "### 2.4 内容消费偏好",
  "| 平台 | 时段 | 信任源 |",
  "|---|---|---|",
  "至少 2 行。",
  "",
  "## 三、IP人设定位",
  "### 3.1 一句话人设",
  "> …",
  "### 3.2 五维人设模型",
  "| 维度 | 内容 |",
  "|---|---|",
  "| 身份标签 | 主：… / 辅：… |",
  "| 性格特质 | … % + … % + … % |",
  "| 信任锚点 | 核心：… ／ 阶段验证：… ／ 持续证明：… |",
  "| 表达风格 | … |",
  "| 价值主张 | … |",
  "五维一行都不能少。",
  "- **3 个月认知转变**：从「…」→ 到「…」",
  "### 3.3 IP原型",
  "- 主原型：…（领路型 / 专家型 / 同行型 / 挑战型）",
  "- 辅助原型：…",
  "- 理由：…",
  "### 3.4 语言风格",
  "**正例**（100–200 字，口语，用户能直接照读）：",
  "> …",
  "**反例**（约 100 字，说明为什么用户会划走）：",
  "> …",
  "### 3.5 视觉建议",
  "| 主色调 | 场景 | 着装 | 质感 |",
  "|---|---|---|---|",
  "### 3.6 记忆板块",
  "#### 视觉锤",
  "- 主锤：…",
  "- 辅锤：…",
  "- 使用场景：…",
  "#### 声音钉",
  "- 开场音/BGM：…",
  "- 标志语/口头禅：…",
  "- 语调特征：…",
  "### 3.7 主页四件套",
  "#### 昵称建议",
  "- 推荐：…",
  "- 备选：…",
  "#### 头像建议",
  "- 拍摄要点：…",
  "- 要求：…",
  "#### 签名档",
  "必须正好 4 行，放在代码块里，一行一条：",
  "```",
  "第1行（身份标签）：…",
  "第2行（价值主张）：…",
  "第3行（信任钩子）：…",
  "第4行（行动引导）：…",
  "```",
  "签名档不是 4 行判失败；第 4 行的引导语必须是合规说法。",
  "#### 背景图建议",
  "- 内容：…",
  "- 风格：…",
  "",
  "## 四、内容定位",
  "### 4.1 内容使命",
  "> 让谁，看完多少条内容，敢做什么（一句话）",
  "### 4.2 内容矩阵",
  "| 类型 | 配比 | 方向 | 示例选题 |",
  "|---|---|---|---|",
  "| 信任型 | …% | … | … |",
  "| 认知型 | …% | … | … |",
  "| 连接型 | …% | … | … |",
  "| 转化型 | …% | … | … |",
  "至少 4 类，配比合计 100%。",
  "### 4.3 平台差异化",
  "| 平台 | 定位 | 侧重 | 频率 |",
  "|---|---|---|---|",
  "至少 2 个平台；每个平台的「侧重」和「频率」必须不同，全平台一样判失败。",
  "",
  "输出前自检：速览 8 行齐全、四章齐全、痛点 ≥5、差异化 ≥3 条且都有支撑证据、决策旅程每阶段标了内容类型、签名档正好 4 行、平台 ≥2 个且侧重/频率不同、没有违禁词。"
].join("\n");

const IP_POS_SYSTEM_PROMPT_B = [
  "你是思潼AI行业智能体平台的「IP 定位智能体」。本次你交付 IP 定位全案的【后半部分】：五、选题方向 + 六、投流建议 + 七、IP发展规划 + 八、执行建议。",
  "前四章（项目 / 用户 / 人设 / 内容）由同一次交付的另一段负责，你不要重复输出，直接从第五章开始。",
  IP_POS_COMMON_RULES,
  "",
  "严格按下面的结构输出：",
  "",
  "## 五、选题方向",
  "### 5.1 信任型选题（共 22 条）",
  "1. 选题标题 ｜ 内容形式 ｜ ⭐⭐⭐",
  "必须把 22 条全部写完，一条一行，每行固定为「序号. 选题标题 ｜ 内容形式 ｜ 优先级」，优先级取 ⭐ / ⭐⭐ / ⭐⭐⭐。",
  "### 5.2 认知型选题（共 22 条）",
  "同上，22 条全部写完。",
  "### 5.3 连接型选题（共 22 条）",
  "同上，22 条全部写完。",
  "### 5.4 转化型选题（共 14 条）",
  "同上，14 条全部写完。",
  "四类合计 ≥80 条，一条都不能省，禁止写「其余按同一结构推导」这类占位；少一条判失败。",
  "### 5.5 TOP10 优先选题",
  "| 排名 | 选题标题方向 | 类型 | 预期效果 | 创作要点 |",
  "|---|---|---|---|---|",
  "正好 10 行，排名 1–10；类型取 信任型 / 认知型 / 连接型 / 转化型。",
  "### 5.6 第一个月选题日历",
  "| 日期 | 类型 | 选题 | 备注 |",
  "|---|---|---|---|",
  "| D1 | 信任型 | … | |",
  "D1 到 D30 共 30 行，每周留 1 天「休息」，四类轮换；少于 28 行判失败。",
  "### 5.7 结尾钩子规范",
  "| 类型 | 目的 | 话术模板 |",
  "|---|---|---|",
  "| 关注钩 | 引导关注 | … |",
  "| 行动钩 | 引导进主页 | … |",
  "| 共鸣钩 | 引导评论 | … |",
  "| 留资钩 | 合规引导 | … |",
  "- 声音钉收尾语：…",
  "- 第一个月 A/B 测试计划：…",
  "",
  "## 六、投流建议",
  "### 6.1 投流前置判断",
  "| 内容 | 完播率 | 互动率 | 自然播放 | 是否适合投 |",
  "|---|---|---|---|---|",
  "### 6.2 DOU+ 投放方案",
  "| 场景 | 目标 | 金额 | 时长 | 定向 |",
  "|---|---|---|---|---|",
  "- 投放节奏：…",
  "- 注意事项：…",
  "### 6.3 本地推投放方案",
  "| 场景 | 目标 | 金额 | 范围 | 关键设置 |",
  "|---|---|---|---|---|",
  "投放城市没给就写「待补充：需用户确认目标城市」，不要编造。",
  "### 6.4 月预算分配",
  "| 项目 | 金额 | 占比 |",
  "|---|---|---|",
  "| DOU+ | … | …% |",
  "| 本地推 | … | …% |",
  "| **合计** | **…** | **100%** |",
  "预算金额未给时按「待补充：需用户确认月预算」处理，占比给出建议值且合计 100%。",
  "### 6.5 第一个月投放日历",
  "| 日期 | 投什么内容 | 渠道 | 金额 |",
  "|---|---|---|---|",
  "至少 4 行。",
  "本节是平台设置项名词区，可以出现「私信留资」这类平台功能名；其余章节一律不许出现违禁引导词。",
  "",
  "## 七、IP发展规划",
  "### 7.1 IP能力评估",
  "| 维度 | 评分(0-10) | 当前表现 | 目标(3个月) |",
  "|---|---|---|---|",
  "| 表达能力 | … | … | … |",
  "| 内容能力 | … | … | … |",
  "| 平台认知 | … | … | … |",
  "| 账号基础 | … | … | … |",
  "| 投入度 | … | … | … |",
  "| **综合** | **X/50** | | **Y/50** |",
  "五维缺一项或缺综合分判失败；综合分必须等于五项之和。",
  "### 7.2 现状诊断",
  "- 当前最短板：…",
  "- 当前最大卡点：…",
  "- 当前最大优势（别丢了）：…",
  "### 7.3 三阶段发展路径",
  "| 阶段 | 时间 | 人设侧重 | 内容重心 | 关键里程碑 |",
  "|---|---|---|---|---|",
  "| 起步期 | 第 1–3 月 | … | … | … |",
  "| 成长期 | … | … | … | … |",
  "| 成熟期 | … | … | … | … |",
  "### 7.4 第一个月能力提升计划",
  "| 周次 | 练什么 | 怎么练 | 检验标准 |",
  "|---|---|---|---|",
  "第 1–4 周，共 4 行。",
  "",
  "## 八、执行建议",
  "- **关键成功因素**：① … ② … ③ …（正好 3 条）",
  "- **风险提示**：① … ② …（正好 2 条，写风险本身，不要复述任何违禁词）",
  "- **迭代周期**：…",
  "",
  "输出前自检：四类选题合计 ≥80 条且数量达标（信任 ≥22 / 认知 ≥22 / 连接 ≥22 / 转化 ≥14）、TOP10 正好 10 行、日历 ≥28 天、预算占比合计 100%、能力五维 + 综合分齐全、成功因素 3 条 / 风险 2 条、没有违禁词。"
].join("\n");

interface IpPosPayloadError {
  code: string;
  field: string;
  message: string;
}

export interface IpPosPayload {
  meta: { brand: string; industry: string; goal: string; generatedAt: string };
  overview: {
    project: string;
    user: string;
    persona: string;
    archetype: string;
    ip_status: string;
    content_focus: string;
    platform: string;
    month_actions: string;
  };
  stats: {
    topic_total: number;
    by_type: { trust: number; cognitive: number; connection: number; conversion: number };
  };
  validation: { passed: boolean; errors: IpPosPayloadError[] };
  /** 主页四件套「可直接抄」卡片用；bio 为签名档 4 行原文。 */
  homepage: { nickname: string; avatar: string; bio: string[]; banner: string };
  /** 语言风格正/反例，供前端单独展示与「口播正例导出 TXT」。 */
  tone: { positive: string; negative: string };
  topics: {
    trust: string[];
    cognitive: string[];
    connection: string[];
    conversion: string[];
    top10: string[];
    calendar30: string[];
  };
  sections: Record<string, string>;
}

/** 取某一章的正文（从章标题行到下一个章标题行）。 */
function ipPosChapterText(text: string, label: string): string {
  const lines = text.split(/\r?\n/);
  const heading = new RegExp(`^\\s*(?:#{1,5}\\s*)?(?:[*_]{1,2}\\s*)?${label}、`);
  const start = lines.findIndex((line) => heading.test(line));
  if (start < 0) return "";
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\s*(?:#{1,5}\s*)?(?:[*_]{1,2}\s*)?(?:一|二|三|四|五|六|七|八|九|十|十一|十二)、/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

/**
 * 章内小节（从匹配行到下一个同级或更高级标题，或 x.y 小节标题）。
 * 命中行本身是标题时必须允许它的子标题留在小节内，否则
 * 「### 3.7 主页四件套」这种“标题紧跟子标题”的小节会被切成空串，
 * 导致签名档等内容整体丢失。
 */
function ipPosSubSection(section: string, pattern: RegExp): string {
  const lines = section.split(/\r?\n/);
  const start = lines.findIndex((line) => pattern.test(line));
  if (start < 0) return "";
  const startHeading = /^\s*(#{1,6})\s/.exec(lines[start]);
  const startLevel = startHeading ? startHeading[1].length : 0;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    const heading = /^\s*(#{1,6})\s/.exec(line);
    if (heading) {
      if (startLevel > 0 && heading[1].length > startLevel) continue;
      end = i;
      break;
    }
    if (/^\s*(?:[*_]{1,2}\s*)?\d+\.\d+[.、\s]/.test(line)) {
      end = i;
      break;
    }
    if (/^\s*\*\*\s*\d+\.\d+/.test(line)) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

/** 段落里以指定表头单元格开头的表格数据行。 */
function ipPosTableRows(section: string, headerCell: string): string[][] {
  const lines = section.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const cells = splitRow(lines[i]).map((c) => c.trim());
    if (cells.some((c) => c.replace(/[*_`\s]/g, "") === headerCell)) {
      const rows: string[][] = [];
      for (let j = i + 1; j < lines.length; j++) {
        if (!lines[j].trim().startsWith("|")) break;
        const c2 = splitRow(lines[j]).map((x) => x.trim());
        if (c2.length === 0) continue;
        if (c2.every((x) => /^:?-{2,}:?$/.test(x))) continue;
        rows.push(c2);
      }
      return rows;
    }
  }
  return [];
}

/** 键值两列表格 → 记录（去掉加粗标记）。 */
function ipPosKeyValueRows(section: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of section.split(/\r?\n/)) {
    const cells = splitRow(line).map((c) => c.trim());
    if (cells.length < 2) continue;
    const key = (cells[0] ?? "").replace(/[*_`\s]/g, "");
    if (!key || /^:?-{2,}:?$/.test(key)) continue;
    if (out[key] === undefined) out[key] = cells[1] ?? "";
  }
  return out;
}

/** 选题小节里的条目（要求「选题 ｜ 形式 ｜ 优先级」三段式）。 */
function ipPosTopicItems(section: string): string[] {
  const items = section
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^(?:\d{1,3}\s*[.、)]|[-*])\s+\S/.test(line))
    .map((line) => line.replace(/^(?:\d{1,3}\s*[.、)]|[-*])\s+/, "").trim())
    .filter(Boolean);
  const structured = items.filter((item) => (item.match(/[｜|]/g) ?? []).length >= 2);
  return structured.length > 0 ? structured : items;
}

/** 主页签名档行（优先取「签名档」小节里的代码块内容）。 */
function ipPosSignatureLines(section: string): string[] {
  const lines = section.split(/\r?\n/);
  // 优先标题行/加粗标签行，避免正文顺带提到「签名档」时从错误位置截取。
  const labeled = lines.findIndex(
    (line) => /签名档/.test(line) && /^\s*(?:#{1,6}\s|\*\*|[-*]\s)/.test(line)
  );
  const start = labeled >= 0 ? labeled : lines.findIndex((line) => /签名档/.test(line));
  if (start < 0) return [];
  const rest = lines.slice(start).join("\n");
  const fenced = /```[^\n]*\n([\s\S]*?)```/.exec(rest);
  if (fenced) {
    return (fenced[1] ?? "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }
  return rest
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^(?:[-*]\s*)?(?:\*\*)?第\s*[1-4一二三四]\s*行/.test(line));
}

/** 小节里的「标签：值」取首个匹配（主页四件套各字段）。 */
function ipPosLabeledValue(section: string, label: string): string {
  const match = new RegExp(`${label}[^\\n：:]{0,8}[：:]\\s*([^\\n]+)`).exec(section.replace(/[*`]/g, ""));
  return (match?.[1] ?? "").replace(/[*`]/g, "").trim();
}

/** 小节首条可用文本：优先指定标签行，其次首条列表项，最后首个正文行。 */
function ipPosFirstValue(section: string, label?: string): string {
  if (label) {
    const labeled = ipPosLabeledValue(section, label);
    if (labeled) return labeled;
  }
  const lines = section.split(/\r?\n/).map((line) => line.trim());
  const bullet = lines.find((line) => /^[-*]\s+\S/.test(line));
  if (bullet) return bullet.replace(/^[-*]\s+/, "").replace(/[*`]/g, "").trim();
  const plain = lines.find((line) => line && !/^#{1,6}\s/.test(line) && !/^-{2,}$/.test(line));
  return plain ? plain.replace(/[*`]/g, "").trim() : "—";
}

/** 标签（正例 / 反例）下方的引用块正文；模型没写引用块时退回第一段正文。 */
function ipPosQuotedAfter(section: string, pattern: RegExp): string {
  const lines = section.split(/\r?\n/);
  const start = lines.findIndex((line) => pattern.test(line));
  if (start < 0) return "";
  const buffer: string[] = [];
  let inside = false;
  for (let i = start; i < lines.length; i++) {
    const line = lines[i].trim();
    if (/^>/.test(line)) {
      inside = true;
      buffer.push(line.replace(/^>\s?/, "").trim());
      continue;
    }
    if (inside) break;
  }
  if (buffer.length > 0) return buffer.join("").trim();
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (/^\*\*(?:正例|反例)\*\*/.test(line) || /^#{1,6}\s/.test(line)) break;
    return line.replace(/^[-*]\s+/, "").replace(/[*`]/g, "").trim();
  }
  return "";
}

/**
 * 「第一 / 最好 / 100%」只在宣称式语境下判失败。
 * 契约样例本身会使用序号（第一家店 / 第一年 / 第一个月 / 第一印象）、
 * 占比（合计 100%）和比较式（挑数据最好的发），这些属于正常表达，
 * 不能整体当成有效广告的绝对化用语。
 */
const IP_POS_ABSOLUTE_CLAIM_PATTERNS: RegExp[] = [
  /(?:行业|全国|全网|全球|市场|本地|同城|赛道|领域|业内|品类|区域|中国|亚洲|世界)\s*第\s*一/,
  /(?:销量|口碑|排名|业绩|流量|粉丝量)\s*第\s*一/,
  /第\s*一\s*(?:名|品牌|人|梯队|选择|股)/,
  /(?:全网|全国|行业|市场|业内|同城|本地|全球|中国|亚洲|世界)\s*最\s*(?:好|强|优|牛|厉害|专业)/,
  /最\s*(?:好|强|优|牛|厉害)\s*的?\s*(?:品牌|门店|机构|团队|老师|课程|服务|方案|效果|选择|模式|方法|平台|系统|项目|美容院|连锁|品质|体验|资源)/,
  /100\s*%\s*(?:保证|承诺|确保|有效|成功|回本|赚钱|见(?:效|结果)|提升|放心|转化|增长|成交|爆款|涨粉|上岸)/,
  /(?:保证|承诺|确保)[^。；！？\n]{0,6}100\s*%/
];

function ipPosAbsoluteClaim(text: string): string | null {
  for (const pattern of IP_POS_ABSOLUTE_CLAIM_PATTERNS) {
    const matched = pattern.exec(text);
    if (matched) return matched[0].replace(/\s+/g, "");
  }
  return null;
}

/**
 * 「唯一 / 绝对 / 保证 / 顶级」只拦宣称式用法，避免把正常中文误判成绝对化用语：
 * - 唯一：排除否定式（钱不是唯一解）和名词性用法（唯一性）；
 * - 绝对：只拦「绝对 + 正面宣称」（绝对有效 / 绝对是），放行「绝对不要 / 没有绝对」；
 * - 保证：只拦对客户的收益/效果承诺（保证你稳赚 / 保证见效），放行「保证一周 2 天投入」「保证金」；
 * - 顶级：等级宣称，命中即判失败。
 */
function ipPosBannedAbsoluteWord(text: string): string | null {
  for (const hit of text.matchAll(/唯一|绝对|保证|顶级/g)) {
    const word = hit[0];
    const at = hit.index ?? 0;
    const before = text.slice(Math.max(0, at - 4), at);
    const after = text.slice(at + word.length, at + word.length + 2);
    if (word === "唯一") {
      if (/(?:不是|并非|没有|不|非|无|没)$/.test(before)) continue;
      if (/^性/.test(after)) continue;
      return word;
    }
    if (word === "绝对") {
      if (!/^(?:有效|第一|最好|好|领先|正确|可靠|放心|安全|专业|是|能|可以|会|让|成功|赚钱|稳赚|回本|提升|值得|保证)/.test(after)) continue;
      return word;
    }
    if (word === "保证") {
      if (!/^(?:您|你|效果|收益|赚|盈利|回本|成功|涨粉|客资|成交|转化|增长|上岸|结果|通过|录取|供货|正品|品质|质量|底价|最低价|有效|见效)/.test(after)) continue;
      return word;
    }
    return word; // 顶级
  }
  return null;
}

/** 剔除非文案区（第六章平台设置项名词）与合规说明行，再查违禁词。 */
function ipPosVisibleCopyText(text: string): string {
  let inAds = false;
  let inNegativeSample = false;
  const kept: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const flat = line.replace(/\s+/g, "");
    if (/^(?:#{1,5}|[*_]{1,2})?六、/.test(flat)) {
      inAds = true;
      continue;
    }
    if (inAds && /^(?:#{1,5}|[*_]{1,2})?七、/.test(flat)) inAds = false;
    if (inAds) continue;
    // 「反例」是契约要求模型写的反面样本（演示用户为什么会划走），不是交付给用户照读的文案，
    // 坏样例里必然带违禁词。跳过反例标签行及其正文，避免误伤整份输出、让模型白扣一次费。
    if (/^约?反例/.test(flat.replace(/^[#>*_+\-]+/, ""))) {
      inNegativeSample = true;
      continue;
    }
    if (inNegativeSample) {
      const trimmed = line.trim();
      const startsNewBlock = /^#{1,6}\s/.test(trimmed) || /^\*\*(?:正例|反例)\*\*/.test(trimmed);
      if (!startsNewBlock) continue;
      inNegativeSample = false;
    }
    kept.push(line);
  }
  return kept
    .filter(
      (line) =>
        !/严禁|禁忌|违禁|合规提示|绝对化用语|反例|不要说|不能写|不要复述|避免[^，。]{0,12}(承诺|词|表述|用语)/.test(line)
    )
    .join("\n")
    .replace(/第(?:一|二|三|四|五|六|七|八|九|十)?个?月/g, "")
    .replace(/第[一二三四五六七八九十\d]+(?:周|步|次|类|行|条|时间|印象|反应|桶金|大)/g, "");
}

export function parseIpPosFull(text: string, userInput: string): { failures: string[]; payload: IpPosPayload } {
  const errors: IpPosPayloadError[] = [];
  const failures: string[] = [];
  const fail = (code: string, field: string, message: string) => {
    errors.push({ code, field, message });
    failures.push(message);
  };

  const chapters: Array<{ label: string; keyword: string; key: string }> = [
    { label: "一", keyword: "项目定位", key: "positioning" },
    { label: "二", keyword: "目标用户", key: "user" },
    { label: "三", keyword: "IP人设", key: "ip" },
    { label: "四", keyword: "内容定位", key: "content" },
    { label: "五", keyword: "选题方向", key: "topics" },
    { label: "六", keyword: "投流建议", key: "ads" },
    { label: "七", keyword: "IP发展规划", key: "growth" },
    { label: "八", keyword: "执行建议", key: "execution" }
  ];

  const sections: Record<string, string> = {};
  for (const chapter of chapters) {
    const body = ipPosChapterText(text, chapter.label);
    sections[chapter.key] = body;
    const expected = `${chapter.label}、${chapter.keyword}`.replace(/\s+/g, "");
    const found = text.split(/\r?\n/).some((line) =>
      line
        .replace(/\s+/g, "")
        .replace(/^[#>*_\-—\d.、]+/, "")
        .startsWith(expected)
    );
    if (!body || !found) fail("V2", `chapter_${chapter.key}`, `缺少「${chapter.label}、${chapter.keyword}」章节`);
  }

  // V1 · 1 分钟速览 8 项
  const overviewSection = (() => {
    const lines = text.split(/\r?\n/);
    const start = lines.findIndex((line) => /1\s*分钟速览/.test(line));
    if (start < 0) return "";
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      if (/^\s*(?:#{1,5}\s*)?(?:[*_]{1,2}\s*)?一、/.test(lines[i])) {
        end = i;
        break;
      }
    }
    return lines.slice(start, end).join("\n");
  })();
  const overviewRows = ipPosKeyValueRows(overviewSection);
  const overviewMissing = IP_POS_OVERVIEW_FIELDS.filter((field) => {
    const value = (overviewRows[field] ?? "").trim();
    return !value || value === "—" || value === "-" || value === "待补充";
  });
  if (!overviewSection) {
    fail("V1", "overview", "缺少「📌 1分钟速览」板块");
  } else if (overviewMissing.length > 0) {
    fail("V1", "overview", `1分钟速览缺项：${overviewMissing.join("、")}`);
  }

  // V3 · 选题数量（四类合计 ≥80，且各类达标）
  const topicsSection = sections.topics ?? "";
  const topicBuckets = {
    trust: ipPosTopicItems(ipPosSubSection(topicsSection, /信任型选题/)),
    cognitive: ipPosTopicItems(ipPosSubSection(topicsSection, /认知型选题/)),
    connection: ipPosTopicItems(ipPosSubSection(topicsSection, /连接型选题/)),
    conversion: ipPosTopicItems(ipPosSubSection(topicsSection, /转化型选题/))
  };
  const topicTotal =
    topicBuckets.trust.length +
    topicBuckets.cognitive.length +
    topicBuckets.connection.length +
    topicBuckets.conversion.length;
  const thresholds: Array<[keyof typeof topicBuckets, number, string]> = [
    ["trust", 22, "信任型"],
    ["cognitive", 22, "认知型"],
    ["connection", 22, "连接型"],
    ["conversion", 14, "转化型"]
  ];
  for (const [key, threshold, name] of thresholds) {
    if (topicBuckets[key].length < threshold) {
      fail("V3", `topics_${key}`, `${name}选题不足 ${threshold} 条（实际 ${topicBuckets[key].length} 条）`);
    }
  }
  if (topicTotal < 80) fail("V3", "topics_total", `选题总量不足 80 条（实际 ${topicTotal} 条）`);

  // V4 · 痛点 ≥5
  const painRows = ipPosTableRows(sections.user ?? "", "痛点");
  if (painRows.length < 5) fail("V4", "user_pains", `痛点不足 5 个（实际 ${painRows.length} 个）`);

  // V5 · 差异化必须有支撑证据
  const diffRows = ipPosTableRows(sections.positioning ?? "", "差异化点");
  if (diffRows.length < 3) {
    fail("V5", "positioning_differentiation", `核心差异化不足 3 条（实际 ${diffRows.length} 条）`);
  } else {
    diffRows.forEach((row, index) => {
      const evidence = (row[2] ?? "").trim().replace(/[*_`]/g, "");
      if (!evidence || evidence === "—" || evidence === "-" || evidence.length < 3) {
        fail("V5", `positioning_differentiation[${index + 1}]`, `第 ${index + 1} 条差异化缺「支撑证据」`);
      }
    });
  }

  // V6 · 签名档正好 4 行
  const homeSection = ipPosSubSection(sections.ip ?? "", /主页四件套|签名档/);
  const signatureLines = ipPosSignatureLines(homeSection);
  if (signatureLines.length !== 4) {
    fail("V6", "ip_homepage_bio", `签名档必须正好 4 行（实际 ${signatureLines.length} 行）`);
  }

  // V7 · 平台差异化（≥2 个平台，侧重/频率不得完全相同）
  const platformRows = ipPosTableRows(sections.content ?? "", "平台").filter((row) => {
    const name = (row[0] ?? "").replace(/[*_`\s]/g, "");
    return Boolean(name) && !/^:?-{2,}:?$/.test(name) && name !== "平台";
  });
  if (platformRows.length < 2) {
    fail("V7", "content_platform_diff", `平台差异化不足 2 个平台（实际 ${platformRows.length} 个）`);
  } else {
    const signatures = new Set(
      platformRows.map((row) => `${(row[2] ?? "").replace(/[*_`\s]/g, "")}|${(row[3] ?? "").replace(/[*_`\s]/g, "")}`)
    );
    if (signatures.size < 2) fail("V7", "content_platform_diff", "各平台侧重/频率完全相同，未体现平台差异化");
  }

  // V8 · 五维人设 + 能力五维 + 综合分
  const fiveDimSection = ipPosSubSection(sections.ip ?? "", /五维/);
  const fiveDimMissing = ["身份标签", "性格特质", "信任锚点", "表达风格", "价值主张"].filter(
    (field) => !fiveDimSection.replace(/[*_`\s]/g, "").includes(field)
  );
  if (fiveDimMissing.length > 0) {
    fail("V8", "ip_five_dim", `五维人设缺项：${fiveDimMissing.join("、")}`);
  }
  const abilitySection = ipPosSubSection(sections.growth ?? "", /能力评估|能力打分/);
  const abilityMissing = ["表达能力", "内容能力", "平台认知", "账号基础", "投入度"].filter(
    (field) => !abilitySection.replace(/[*_`\s]/g, "").includes(field)
  );
  if (abilityMissing.length > 0) {
    fail("V8", "growth_ability", `IP能力评估缺项：${abilityMissing.join("、")}`);
  }
  if (!/综合[\s\S]{0,20}?\d{1,2}\s*\/\s*50/.test(abilitySection.replace(/[*_`]/g, ""))) {
    fail("V8", "growth_ability_total", "IP能力评估缺少综合分（格式：X/50）");
  }

  // V9 · TOP10 正好 10 行、日历 ≥28 天
  const top10Rows = ipPosTableRows(ipPosSubSection(topicsSection, /TOP\s*10|优先选题/i), "排名");
  if (top10Rows.length !== 10) fail("V9", "topics_top10", `TOP10 必须正好 10 行（实际 ${top10Rows.length} 行）`);
  const calendarSection = ipPosSubSection(topicsSection, /日历/);
  const calendarDays = new Set(
    (calendarSection.match(/(?:^|\|)\s*D\s*(\d{1,2})\b/gi) ?? []).map((item) => (item.match(/\d{1,2}/) ?? [""])[0])
  );
  if (calendarDays.size < 28) fail("V9", "topics_calendar30", `第一个月选题日历不足 28 天（实际 ${calendarDays.size} 天）`);

  // V10 · 违禁词（文案区，排除第六章平台设置项名词）
  const copyText = ipPosVisibleCopyText(text);
  if (/私信|加微信|打电话|联系我|找我|留个|扫码/.test(copyText)) {
    fail("V10", "banned_guide", "文案区含违规引导词（私信/加微信/打电话/联系我/找我/留个/扫码）");
  }
  const bannedAbsoluteWord = ipPosBannedAbsoluteWord(copyText);
  if (bannedAbsoluteWord) {
    fail("V10", "banned_absolute", `文案区含绝对化用语（唯一/绝对/保证/顶级：${bannedAbsoluteWord}）`);
  }
  const absoluteClaim = ipPosAbsoluteClaim(copyText);
  if (absoluteClaim) {
    fail("V10", "banned_absolute", `文案区含绝对化用语（宣称式：${absoluteClaim}）`);
  }
  if (/包回本|稳赚|月入过万|零风险|躺赚|必赚/.test(copyText)) {
    fail("V10", "banned_promise", "文案区含承诺类表述（包回本/稳赚/月入过万/零风险/躺赚/必赚）");
  }

  const pick = (patterns: RegExp[]): string => {
    for (const pattern of patterns) {
      const matched = pattern.exec(userInput)?.[1]?.trim();
      if (matched) return matched;
    }
    return "—";
  };
  const top10 = top10Rows
    .map((row) => (row[1] ?? "").replace(/[*_`]/g, "").trim())
    .filter(Boolean);
  const calendar30 = calendarSection
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^\|/.test(line) && /(?:^|\|)\s*D\s*\d{1,2}\b/i.test(line));

  const payload: IpPosPayload = {
    meta: {
      brand: pick([/(?:品牌名|品牌名称|品牌|项目名|项目名称)[^\n：:]{0,6}[：:]\s*([^\n]{1,40})/]),
      industry: pick([/(?:行业|赛道|领域)[^\n：:]{0,6}[：:]\s*([^\n]{1,40})/]),
      goal: pick([/(?:核心目标|目标|诉求)[^\n：:]{0,8}[：:]\s*([^\n]{1,40})/]),
      generatedAt: new Date().toISOString()
    },
    overview: {
      project: overviewRows["项目定位"] ?? "—",
      user: overviewRows["核心用户"] ?? "—",
      persona: overviewRows["IP人设"] ?? "—",
      archetype: overviewRows["IP原型"] ?? "—",
      ip_status: overviewRows["当前IP状态"] ?? "—",
      content_focus: overviewRows["内容重心"] ?? "—",
      platform: overviewRows["首选平台"] ?? "—",
      month_actions: overviewRows["第一个月核心动作"] ?? "—"
    },
    stats: {
      topic_total: topicTotal,
      by_type: {
        trust: topicBuckets.trust.length,
        cognitive: topicBuckets.cognitive.length,
        connection: topicBuckets.connection.length,
        conversion: topicBuckets.conversion.length
      }
    },
    validation: { passed: failures.length === 0, errors },
    homepage: {
      nickname: ipPosFirstValue(ipPosSubSection(homeSection, /昵称建议|昵称/), "推荐"),
      avatar: ipPosFirstValue(ipPosSubSection(homeSection, /头像建议|头像/), "拍摄要点"),
      bio: signatureLines,
      banner: ipPosFirstValue(ipPosSubSection(homeSection, /背景图建议|背景图/), "内容")
    },
    tone: {
      positive: ipPosQuotedAfter(ipPosSubSection(sections.ip ?? "", /语言风格/), /正例/),
      negative: ipPosQuotedAfter(ipPosSubSection(sections.ip ?? "", /语言风格/), /反例/)
    },
    topics: {
      trust: topicBuckets.trust,
      cognitive: topicBuckets.cognitive,
      connection: topicBuckets.connection,
      conversion: topicBuckets.conversion,
      top10,
      calendar30
    },
    sections
  };

  return { failures, payload };
}

function marketplaceWrappedAnswer(sku: PublicMarketplaceSku, answer: string): string {
  const industry = MARKETPLACE_INDUSTRIES[sku.zone];
  if (!industry || industry.general || industry.redline.length === 0) return answer;
  return `${answer}\n\n行业落地提示与合规红线：\n${industry.redline.map((line) => `- ${line}`).join("\n")}`;
}

async function marketplaceOverview() {
  if (env.DATA_MODE === "demo") return demoMarketplace.overview();

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const [ppu, gmv, activeTenants] = await Promise.all([
    prisma.marketplaceLedgerEntry.findMany({
      where: { type: "ppu_consume", createdAt: { gte: startOfToday } },
      select: { amountCredits: true }
    }),
    prisma.marketplaceLedgerEntry.aggregate({
      where: {
        type: { in: ["subscription_charge", "topup"] },
        createdAt: { gte: startOfToday }
      },
      _sum: { amountCny: true }
    }),
    prisma.marketplaceLedgerEntry.findMany({
      where: { createdAt: { gte: startOfToday } },
      distinct: ["tenantId"],
      select: { tenantId: true }
    })
  ]);
  return {
    todayCalls: ppu.length,
    todayPoints: ppu.reduce((sum, entry) => sum + entry.amountCredits, 0),
    activeTenants: activeTenants.length,
    gmvCny: gmv._sum.amountCny ?? 0
  };
}

async function listMarketplaceLedger(tenantId: string | undefined, limit: number) {
  if (env.DATA_MODE === "demo") return demoMarketplace.listLedger(tenantId, limit);
  return prisma.marketplaceLedgerEntry.findMany({
    where: tenantId ? { tenantId } : {},
    orderBy: { createdAt: "desc" },
    take: limit
  });
}

async function listMarketplaceSuppliers() {
  if (env.DATA_MODE === "demo") return demoMarketplace.listSuppliers();
  return prisma.marketplaceSupplier.findMany({ orderBy: { code: "asc" } });
}

async function upsertMarketplaceSupplier(
  input: Partial<z.infer<typeof supplierInputSchema>>,
  supplierId?: string
) {
  if (env.DATA_MODE === "demo") {
    return demoMarketplace.upsertSupplier({
      ...input,
      code: input.code ?? (supplierId ?? "unknown"),
      name: input.name ?? "未命名供应商",
      type: input.type ?? "self_operated",
      settlementRate: input.settlementRate ?? 0,
      status: input.status ?? "active",
      contactEmail: input.contactEmail ?? undefined,
      id: supplierId
    });
  }
  const data: Record<string, unknown> = {};
  if (input.code !== undefined) data.code = input.code;
  if (input.name !== undefined) data.name = input.name;
  if (input.type !== undefined) data.type = input.type;
  if (input.settlementRate !== undefined) data.settlementRate = new Prisma.Decimal(input.settlementRate);
  if (input.contactEmail !== undefined) data.contactEmail = input.contactEmail;
  if (input.status !== undefined) data.status = input.status;
  if (supplierId) {
    return prisma.marketplaceSupplier.update({ where: { id: supplierId }, data: data as any });
  }
  return prisma.marketplaceSupplier.create({ data: data as any });
}

async function upsertMarketplaceSku(
  input: Partial<z.infer<typeof skuInputSchema>>,
  skuId?: string
) {
  if (env.DATA_MODE === "demo") {
    if (skuId) {
      const existing = demoMarketplace.getSku(skuId);
      if (!existing) throw Object.assign(new Error("marketplace_sku_not_found"), { statusCode: 404 });
      return demoMarketplace.upsertSku({
        skuCode: input.skuCode ?? existing.skuCode,
        agentId: input.agentId ?? existing.agentId,
        capabilityKey: input.capabilityKey ?? existing.capabilityKey,
        supplierId: existing.supplierId,
        zone: input.zone ?? existing.zone,
        name: input.name ?? existing.name,
        icon: input.icon ?? existing.icon,
        badge: input.badge ?? existing.badge,
        description: input.description ?? existing.description,
        verbs: input.verbs ?? existing.verbs,
        useCase: input.useCase ?? existing.useCase,
        need: input.need ?? existing.need,
        tags: input.tags ?? existing.tags,
        keywords: input.keywords ?? existing.keywords,
        ppu: input.ppu ?? existing.ppu,
        subscriptionPriceCny: input.subscriptionPriceCny ?? existing.subscriptionPriceCny,
        subscriptionQuota: input.subscriptionQuota ?? existing.subscriptionQuota,
        trial: input.trial ?? existing.trial,
        status: input.status ?? existing.status,
        sortOrder: input.sortOrder ?? existing.sortOrder
      });
    }
    const required = skuInputSchema.safeParse(input);
    if (!required.success) throw Object.assign(new Error("invalid_request"), { statusCode: 400 });
    return demoMarketplace.upsertSku({
      ...required.data,
      agentId: required.data.agentId ?? undefined,
      capabilityKey: required.data.capabilityKey ?? undefined,
      icon: required.data.icon ?? "🛒",
      badge: required.data.badge ?? undefined,
      subscriptionPriceCny: required.data.subscriptionPriceCny ?? undefined,
      subscriptionQuota: required.data.subscriptionQuota ?? undefined
    });
  }

  const data: Record<string, unknown> = {};
  if (input.skuCode !== undefined) data.skuCode = input.skuCode;
  if (input.agentId !== undefined) data.agentId = input.agentId;
  if (input.capabilityKey !== undefined) data.capabilityKey = input.capabilityKey;
  if (input.supplierId !== undefined) data.supplierId = input.supplierId;
  if (input.zone !== undefined) data.zone = input.zone;
  if (input.name !== undefined) data.name = input.name;
  if (input.icon !== undefined) data.icon = input.icon;
  if (input.badge !== undefined) data.badge = input.badge;
  if (input.description !== undefined) data.description = input.description;
  if (input.verbs !== undefined) data.verbs = input.verbs;
  if (input.useCase !== undefined) data.useCase = input.useCase;
  if (input.need !== undefined) data.need = input.need;
  if (input.tags !== undefined) data.tags = input.tags;
  if (input.keywords !== undefined) data.keywords = input.keywords;
  if (input.ppu !== undefined) data.ppu = input.ppu;
  if (input.subscriptionPriceCny !== undefined) data.subscriptionPriceCny = input.subscriptionPriceCny;
  if (input.subscriptionQuota !== undefined) data.subscriptionQuota = input.subscriptionQuota;
  if (input.trial !== undefined) data.trial = input.trial;
  if (input.status !== undefined) data.status = input.status;
  if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;

  if (skuId) {
    const existing = await prisma.marketplaceSku.findFirst({
      where: { OR: [{ id: skuId }, { skuCode: skuId }] },
      select: { id: true }
    });
    if (!existing) {
      throw Object.assign(new Error("marketplace_sku_not_found"), { statusCode: 404 });
    }
    return prisma.marketplaceSku.update({ where: { id: existing.id }, data: data as any });
  }
  if (!input.skuCode || !input.name || !input.zone || !input.supplierId) {
    throw Object.assign(new Error("invalid_request"), { statusCode: 400 });
  }
  return prisma.marketplaceSku.create({ data: data as any });
}

function clampLimit(rawLimit: string | undefined): number {
  const parsed = Number(rawLimit ?? 50);
  if (!Number.isFinite(parsed)) return 50;
  return Math.max(1, Math.min(Math.trunc(parsed), 200));
}

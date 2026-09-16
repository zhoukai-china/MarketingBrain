import { z } from "zod";
import {
  getHighCapabilityLlmModels as buildHighCapabilityLlmModels,
  highCapabilityLlmPolicyMessage,
  isHighCapabilityLlmModel
} from "../services/llm-model-policy.js";
import { parseAllowedHosts, validateAllowedHosts, validateOutboundUrl } from "../services/outbound-policy.js";
import { getMissingBeautyProviderAssetRuntimeHosts } from "../services/beauty-provider-asset-policy.js";

const emptyToUndefined = (value: unknown): unknown => (value === "" ? undefined : value);
const optionalString = z.preprocess(emptyToUndefined, z.string().optional());
const optionalUrl = z.preprocess(emptyToUndefined, z.string().url().optional());
const urlWithDefault = (defaultValue: string) =>
  z.preprocess(emptyToUndefined, z.string().url().default(defaultValue));

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3011),
  API_HOST: z.string().trim().min(1).default("0.0.0.0"),
  DATA_MODE: z.enum(["demo", "database"]).default("demo"),
  CONTINUOUS_IMPROVEMENT_ENABLED: z.enum(["true", "false"]).default("false"),
  CONTINUOUS_IMPROVEMENT_AUTO_PERSIST: z.enum(["true", "false"]).default("false"),
  CONTINUOUS_IMPROVEMENT_AUTO_ACTIVATE: z.enum(["true", "false"]).default("false"),
  CONTINUOUS_IMPROVEMENT_MIN_SAMPLE: z.coerce.number().int().positive().default(10),
  LLM_PROVIDER: z.enum(["deepseek", "aliyun", "domestic_compatible"]).default("deepseek"),
  LLM_ALLOWED_MODELS: optionalString,
  DEEPSEEK_API_KEY: optionalString,
  DEEPSEEK_BASE_URL: optionalUrl,
  DEEPSEEK_MODEL: z.string().trim().min(1).default("deepseek-v4-pro"),
  LANQI_LOW_RISK_TEXT_MODEL: z.enum(["deepseek-v4-flash", "qwen3.8-flash"]).default("qwen3.8-flash"),
  LANQI_LOW_RISK_TEXT_ENABLED: z.enum(["true", "false"]).default("false"),
  LANQI_LOW_RISK_TEXT_EVAL_APPROVED: z.enum(["true", "false"]).default("false"),
  ALIYUN_API_KEY: optionalString,
  ALIYUN_BASE_URL: urlWithDefault("https://dashscope.aliyuncs.com/compatible-mode/v1"),
  ALIYUN_MODEL: z.string().trim().min(1).default("qwen-max"),
  ALIYUN_VIDEO_MODEL: z.string().trim().min(1).default("qwen-vl-max"),
  ALIYUN_VIDEO_REPLICATION_API_KEY: optionalString,
  ALIYUN_VIDEO_REPLICATION_ENDPOINT: optionalUrl,
  ALIYUN_VIDEO_REPLICATION_MODEL: z.string().trim().min(1).default("wan2.2-animate-mix"),
  ALIYUN_VIDEO_REPLICATION_CREDITS: z.coerce.number().int().nonnegative().default(0),
  ALIYUN_VIDEO_REPLICATION_CREDITS_PER_SECOND: z.coerce.number().int().nonnegative().default(0),
  // 付费执行的「单批人民币上限」（单位：分）。默认 0 = 禁止任何付费外发；
  // 只有显式配置（例如首次联调 ¥10 = 1000）才可能真正调用付费视频接口。
  ALIYUN_VIDEO_REPLICATION_MAX_COST_FEN: z.coerce.number().int().nonnegative().default(0),
  BEAUTY_VIDEO_STAGING_DRIVER: z.enum(["disabled", "aliyun_oss"]).default("disabled"),
  BEAUTY_VIDEO_EXECUTION_MODE: z.enum(["disabled", "controlled"]).default("disabled"),
  BEAUTY_VIDEO_EXECUTION_AUTHORITY_KEY: optionalString,
  /**
   * 单批许可签发方式（用户 2026-09-14 拍板 A：条件满足自动签发，仍受同一套预算上限约束）。
   * 默认 `operator` = 与改动前完全一致（没有任何接口能签许可，只有运营离线签）；
   * 显式置 `auto` 才会由服务端按 `ALIYUN_VIDEO_REPLICATION_MAX_COST_FEN` 反推输出上限自动签。
   * 取值非法一律按 `operator` 失败关闭（不落回放行）。
   */
  VIDEO_REPLICATION_PERMIT_MODE: z.enum(["operator", "auto"]).default("operator"),
  SEEDANCE_EXECUTION_MODE: z.enum(["disabled", "controlled"]).default("disabled"),
  ARK_API_KEY: optionalString,
  SEEDANCE_EXECUTION_AUTHORITY_KEY: optionalString,
  SEEDANCE_REVIEW_AUTHORITY_KEY: optionalString,
  SEEDANCE_ACCOUNT_BINDING: optionalString,
  SEEDANCE_CREDIT_COST: z.string().regex(/^\d{1,6}$/).default("0"),
  SEEDANCE_CREDIT_QUOTE_VERSION: optionalString,
  BEAUTY_VIDEO_RESULT_HOSTS: optionalString,
  BEAUTY_VIDEO_OSS_BUCKET: optionalString,
  BEAUTY_VIDEO_OSS_REGION: z.string().default("cn-beijing"),
  BEAUTY_VIDEO_OSS_PREFIX: optionalString,
  BEAUTY_VIDEO_OSS_APPROVED_ORIGIN: optionalString,
  BEAUTY_VIDEO_OSS_ACCESS_KEY_ID: optionalString,
  BEAUTY_VIDEO_OSS_ACCESS_KEY_SECRET: optionalString,
  BEAUTY_VIDEO_OSS_SECURITY_TOKEN: optionalString,
  BEAUTY_VIDEO_OSS_CREDENTIAL_EXPIRES_AT: optionalString,
  ALIYUN_VIDEO_REPLICATION_CALLBACK_TOKEN: optionalString,
  ALIYUN_MEDIA_GENERATION_CALLBACK_TOKEN: optionalString,
  LANQI_MEDIA_IMAGE_MODEL: z.string().trim().min(1).default("wan2.7-image"),
  LANQI_MEDIA_TEXT_TO_VIDEO_MODEL: optionalString,
  LANQI_MEDIA_IMAGE_TO_VIDEO_MODEL: optionalString,
  LANQI_MEDIA_EXECUTION_MODE: z.enum(["disabled", "mock", "real"]).default("disabled"),
  LANQI_MEDIA_REAL_EXECUTION_APPROVED: z.enum(["true", "false"]).default("false"),
  // 图片与视频分开放行：本轮预算只批了「文案转片」图生视频，不能顺带把付费生图也打开。
  LANQI_MEDIA_IMAGE_REAL_EXECUTION_APPROVED: z.enum(["true", "false"]).default("false"),
  LANQI_MEDIA_ASSET_STORAGE: z.enum(["disabled", "local"]).default("disabled"),
  LANQI_MEDIA_TASK_TIMEOUT_MINUTES: z.coerce.number().int().min(5).max(180).default(30),
  // 首帧图暂存：门店上传的首帧图放进本平台自己的存储，再生成一条「限时、一次性签名」
  // 的 HTTPS 外链交给视频模型抓取。没有公网基址或签名密钥时整条链路 fail closed。
  LANQI_MEDIA_PUBLIC_BASE_URL: optionalUrl,
  LANQI_MEDIA_STAGING_SECRET: optionalString,
  LANQI_MEDIA_FIRST_FRAME_TTL_MINUTES: z.coerce.number().int().min(5).max(1440).default(240),
  LANQI_MEDIA_FIRST_FRAME_MAX_MB: z.coerce.number().positive().max(10).default(6),
  /**
   * 图片对客价（兰琪图片 / 美业小红书三图包**共用同一口径**）：
   * ¥1/张 = 20 积分（用户 2026-09-12 拍板「图片改成对客价一元一张」）。
   * 供应商成本 ¥0.2/张 → 约 5 倍毛利，与视频线同量级（见 docs/PRICING.md）。
   * 三图包 = 60 积分（原 300）。
   */
  LANQI_MEDIA_IMAGE_CREDITS: z.coerce.number().int().positive().default(20),
  /**
   * 兰琪视频（图生视频 / 文案转片，`wan2.6-i2v-flash` 720P）按秒计价。
   *
   * 口径（用户 2026-09-15）：「视频改成 2 倍成本」——实测成本 ¥0.30/秒 × 2 = **12 积分/秒**
   * （= ¥0.60/秒；一镜 3 秒 = 36 积分）。此前是 30 积分/秒 = 成本 ×5，与统一倍数表不一致。
   * 真正的「文生视频」走另一组固定包价（`LANQI_MEDIA_*P_*S_CREDITS`），当前未配模型。
   */
  LANQI_MEDIA_VIDEO_CREDITS_PER_SECOND: z.coerce.number().int().positive().default(12),
  BEAUTY_MEDIA_EXECUTION_MODE: z.enum(["disabled", "real"]).default("disabled"),
  BEAUTY_MEDIA_PRODUCT_ENABLED: z.enum(["true", "false"]).default("false"),
  BEAUTY_MEDIA_MAX_REAL_IMAGES: z.coerce.number().int().min(0).max(3).default(0),
  BEAUTY_MEDIA_MAX_PROVIDER_COST_YUAN: z.coerce.number().min(0).max(1).default(0),
  BEAUTY_MEDIA_IMAGE_CREDITS: z.coerce.number().int().positive().default(20),
  BEAUTY_MEDIA_ASSET_STORAGE: z.enum(["disabled", "local"]).default("disabled"),
  /**
   * 推荐有礼（PLAT-28）。全部默认关闭，上线前改 env 即生效，不发版。
   *
   * 口径（用户 2026-09-12 冻结，2026-09-15 收窄）：
   * - 用户 2026-09-15 原话：「先只做推荐有礼，被推荐人获得 100 积分、推荐人获得 100 积分」——
   *   所以**双向各 100**；原第二段「推荐人首充再加 200」按本次口径**默认关闭（0）**，
   *   要恢复 2026-09-12 的三段口径，把这个数改回 200 即可（机制没删，仍在 `maybeGrantReferralReward`）。
   * - 奖励积分**只能用于文字类智能体**（`REFERRAL_REWARD_TEXT_ONLY`，服务端硬限制）；
   * - 奖励进 bonus 桶，90 天有效；不设单人月上限，改为超阈值**告警**；
   * - 绑定 / 首次真实使用 / 首次真实充值三个事件都必须落在活动窗内（左闭右开）。
   */
  REFERRAL_REWARD_ENABLED: z.enum(["true", "false"]).default("false"),
  REFERRAL_CAMPAIGN_STARTS_AT: optionalString,
  REFERRAL_CAMPAIGN_ENDS_AT: optionalString,
  REFERRAL_NEW_USER_CREDITS: z.coerce.number().int().nonnegative().default(100),
  REFERRAL_REFERRER_FIRST_USE_CREDITS: z.coerce.number().int().nonnegative().default(100),
  REFERRAL_REFERRER_FIRST_RECHARGE_CREDITS: z.coerce.number().int().nonnegative().default(0),
  REFERRAL_REWARD_VALID_DAYS: z.coerce.number().int().positive().default(90),
  REFERRAL_REWARD_ALERT_THRESHOLD_CREDITS: z.coerce.number().int().positive().default(20000),
  REFERRAL_REWARD_TEXT_ONLY: z.enum(["true", "false"]).default("true"),
  /**
   * 人工体验额度发放入口总开关（PLAT-28 第①批，2026-09-12 用户口径）。
   * 默认 false：`POST /market/admin/trial-grants` 与运维 CLI `scripts/grant-marketplace-trial-credits.mjs`
   * 一律拒绝（`403 trial_grant_disabled`，CLI 退出码 2），历史流水只读保留、一条不删。
   * 后台 `/agents/admin` 的同一个键可覆盖此默认值（PlatformSetting 表）。
   */
  MARKETPLACE_TRIAL_GRANT_ENABLED: z.enum(["true", "false"]).default("false"),
  BEAUTY_MEDIA_ACCEPTANCE_OPERATOR_GATE: z.enum(["true", "false"]).default("false"),
  BEAUTY_DAILY_BRIEF_RUNTIME_MODE: z.enum(["disabled", "controlled_mock", "live"]).default("disabled"),
  BEAUTY_DAILY_BRIEF_SCHEDULER_ENABLED: z.enum(["true", "false"]).default("false"),
  BEAUTY_DAILY_BRIEF_RECURRING_APPROVED: z.enum(["true", "false"]).default("false"),
  BEAUTY_DAILY_BRIEF_SCHEDULER_TENANT_ID: optionalString,
  BEAUTY_DAILY_BRIEF_SCHEDULER_USER_ID: optionalString,
  BEAUTY_DAILY_BRIEF_MANUAL_RETRY_APPROVED: z.enum(["true", "false"]).default("false"),
  BEAUTY_DAILY_BRIEF_DAILY_NETWORK_REQUEST_LIMIT: z.coerce.number().int().min(0).max(500).default(0),
  BEAUTY_DAILY_BRIEF_DAILY_MODEL_CALL_LIMIT: z.coerce.number().int().min(0).max(10).default(0),
  BEAUTY_DAILY_BRIEF_DAILY_COST_LIMIT_YUAN: z.coerce.number().min(0).max(100).default(0),
  BEAUTY_DAILY_BRIEF_MONTHLY_NETWORK_REQUEST_LIMIT: z.coerce.number().int().min(0).max(1116).default(0),
  BEAUTY_DAILY_BRIEF_MONTHLY_MODEL_CALL_LIMIT: z.coerce.number().int().min(0).max(31).default(0),
  BEAUTY_DAILY_BRIEF_MONTHLY_COST_LIMIT_YUAN: z.coerce.number().min(0).max(4.1).default(0),
  LANQI_MEDIA_720P_5S_CREDITS: z.coerce.number().int().positive().default(990),
  LANQI_MEDIA_720P_10S_CREDITS: z.coerce.number().int().positive().default(1690),
  LANQI_MEDIA_1080P_5S_CREDITS: z.coerce.number().int().positive().default(1490),
  LANQI_MEDIA_1080P_10S_CREDITS: z.coerce.number().int().positive().default(2690),
  ALIYUN_ASR_MODEL: z.string().trim().min(1).default("qwen3-asr-flash"),
  ALIYUN_ASR_FILETRANS_MODEL: z.string().trim().min(1).default("qwen3-asr-flash-filetrans"),
  ALIYUN_MEDIA_BASE64_MAX_MB: z.coerce.number().positive().default(12),
  ALIYUN_MEDIA_ANALYSIS_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(30_000),
  // 公共平台语音输入（PLAT-33）：只接短录音，服务端限体积 + 限每小时次数，
  // 这两个值就是这次外发 ASR 的「预算准入」，客户端无法覆盖。
  VOICE_TRANSCRIBE_MAX_MB: z.coerce.number().positive().default(10),
  VOICE_TRANSCRIBE_HOURLY_LIMIT: z.coerce.number().int().min(1).default(60),
  VOICE_TRANSCRIBE_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(60_000),
  // 按真实成本计费（PLAT-37，用户 2026-09-15 拍板大方向）。默认 false：
  // 关着时线上扣费仍是 SKU 固定 ppu，与改造前一字不差；打开才切到「成本 × 倍数」。
  BILLING_COST_BASED_ENABLED: z.enum(["true", "false"]).default("false"),
  /**
   * 按成本计费的 **SKU 白名单**（逗号分隔；用户 2026-09-15「先只切有实测成本的三个」）。
   *
   * 只有列在这里的 SKU 才按「实际 token 成本 × 100 倍」扣费（实测：文案 32 / IP 定位 116 / 视频复盘 ≈61）；
   * 没列的继续用固定 `ppu`。**空 = 全部维持固定价（默认）**。
   * 支持通配 `*`：用户 2026-09-16 定「每个新增的智能体产生多少成本就按对应倍数收费」→ `*` = 所有 SKU（含以后新增）。
   * 为什么按 SKU 白名单而不是一个全局开关：没有真实成本样本的 SKU 贸然切价会把价格定偏
   * （估低了贴近甚至低于成本，估高了客户不买），所以按 SKU 灰度、拿到真实样本再逐个加。
   */
  BILLING_COST_BASED_SKUS: optionalString,
  DASHSCOPE_API_KEY: optionalString,
  DASHSCOPE_BASE_URL: optionalUrl,
  PEXELS_API_KEY: optionalString,
  PIXABAY_API_KEY: optionalString,
  DOMESTIC_COMPATIBLE_PROVIDER_NAME: z.string().trim().min(1).default("domestic-compatible"),
  DOMESTIC_COMPATIBLE_API_KEY: optionalString,
  DOMESTIC_COMPATIBLE_BASE_URL: optionalUrl,
  DOMESTIC_COMPATIBLE_MODEL: z.string().trim().min(1).default("deepseek-v4-pro"),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(180000),
  // V4 Pro reasoning_high exhausted a 2048-token budget without final content
  // at 56.8s; keep a bounded 4096-token generation inside this outer deadline.
  FOUNDER_IP_CONTENT_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(120_000),
  AGENT_ORCHESTRATION_STEP_TIMEOUT_MS: z.coerce.number().int().positive().default(90000),
  AGENT_ORCHESTRATION_TOTAL_TIMEOUT_MS: z.coerce.number().int().positive().default(150000),
  SKILL_MCP_URL: optionalUrl,
  SKILL_MCP_TOKEN: optionalString,
  SKILL_MCP_REQUIRED: z.enum(["true", "false"]).default("false"),
  SKILL_MCP_INVOKE_TIMEOUT_MS: z.coerce.number().int().positive().default(420000),
  ORIGINAL_SKILL_ROOT: z.string().default("mcp-skills/skills"),
  WORKBUDDY_MCP_ENABLED: z.enum(["true", "false"]).default("false"),
  WORKBUDDY_MCP_CONNECTIONS_JSON: optionalString,
  WORKBUDDY_MCP_PUBLIC_URL: urlWithDefault("https://api.lcppch.top/os-v2/api/integrations/workbuddy/mcp"),
  // 对外公开站点根地址（生成「我的邀请链接」用；服务端拼链接，不接受客户端传入的地址）。
  PUBLIC_WEB_BASE_URL: urlWithDefault("https://api.lcppch.top/os-v2/"),
  // 平台管理后台的账号密码登录（用户 2026-09-15：普通用户进不去，管理员账号密码登入）。
  // 密码优先用 hash（`scrypt$<salt>$<hash>`，见 scripts/hash-admin-password.mjs），没配 hash 才用明文。
  ADMIN_LOGIN_USERNAME: optionalString,
  ADMIN_LOGIN_PASSWORD_HASH: optionalString,
  ADMIN_LOGIN_PASSWORD: optionalString,
  // 后台会话签名密钥；未配则退回 ADMIN_TOKEN。
  ADMIN_SESSION_SECRET: optionalString,
  JWT_SECRET: optionalString,
  KNOWLEDGE_CREDENTIALS_KEY: optionalString,
  ADMIN_TOKEN: optionalString,
  OPS_TOKEN: optionalString,
  /**
   * 企业微信机器人 webhook（与 `scripts/ops/disk-alert.sh` 同一条通道）。
   * 用途（用户 2026-09-16）：磁盘告警 + **客户付费到账**通知。未配置时只写日志，不影响任何主流程。
   */
  SITONG_ALERT_WEBHOOK: optionalString,
  INVITE_REQUIRED: z.enum(["true", "false"]).default("true"),
  // 仅测试实例开启：允许「本机直接开通」免邀请码登录（dev-login）。生产不设=关闭。
  DIRECT_TEST_LOGIN: z.enum(["true", "false"]).default("false"),
  INVITE_CODES: optionalString,
  DOMESTIC_NETWORK_ONLY: z.enum(["true", "false"]).default("true"),
  DOMESTIC_OUTBOUND_ALLOWLIST: z
    .string()
    .default("api.deepseek.com,dashscope.aliyuncs.com,bailian.aliyuncs.com,oss-cn-beijing.aliyuncs.com,oss-accelerate.aliyuncs.com,openapi.biji.com,api.weixin.qq.com,api.mch.weixin.qq.com,qyapi.weixin.qq.com,www.jiqizhixin.com,www.leiphone.com,www.tmtpost.com,www.sogou.com,weixin.sogou.com,www.cac.gov.cn,www.miit.gov.cn,www.caict.ac.cn,www.douyin.com,douyin.com,www.xiaohongshu.com,xiaohongshu.com,channels.weixin.qq.com,mp.weixin.qq.com,api.pexels.com,images.pexels.com,videos.pexels.com,pixabay.com,cdn.pixabay.com"),
  AI_DAILY_NEWS_SOURCES: z
    .string()
    .default("https://www.cac.gov.cn/yaowen/wxyw/A093602index_1.htm,https://www.miit.gov.cn/xwfb/bldhd/index.html,https://www.caict.ac.cn/kxyj/qwfb/,https://www.jiqizhixin.com,https://www.leiphone.com,https://www.tmtpost.com"),
  WECHAT_AUTH_REQUIRED: z.enum(["true", "false"]).default("true"),
  WECHAT_AUTH_APPID: optionalString,
  WECHAT_AUTH_SECRET: optionalString,
  WECHAT_AUTH_REDIRECT_URI: optionalUrl,
  WECHAT_MESSAGE_ENABLED: z.enum(["true", "false"]).default("false"),
  WECHAT_MESSAGE_TOKEN: optionalString,
  WECHAT_MESSAGE_DEFAULT_AGENT_ID: z.string().trim().min(1).default("agent_acquisition"),
  WECHAT_MESSAGE_BIND_URL: optionalUrl,
  WECHAT_KF_ENABLED: z.enum(["true", "false"]).default("false"),
  WECHAT_KF_CORP_ID: optionalString,
  WECHAT_KF_SECRET: optionalString,
  WECHAT_KF_TOKEN: optionalString,
  WECHAT_KF_ENCODING_AES_KEY: optionalString,
  WECHAT_KF_DEFAULT_AGENT_ID: z.string().trim().min(1).default("agent_acquisition"),
  WECHAT_KF_BIND_URL: optionalUrl,
  WECHAT_PAY_APPID: optionalString,
  WECHAT_PAY_MCH_ID: optionalString,
  WECHAT_PAY_API_V3_KEY: optionalString,
  WECHAT_PAY_CERT_SERIAL_NO: optionalString,
  WECHAT_PAY_PRIVATE_KEY: optionalString,
  WECHAT_PAY_PRIVATE_KEY_FILE: optionalString,
  WECHAT_PAY_NOTIFY_URL: optionalUrl,
  WECHAT_PAY_PLATFORM_PUBLIC_KEY: optionalString,
  WECHAT_PAY_PLATFORM_PUBLIC_KEY_FILE: optionalString,
  WECHAT_PAY_REQUIRED: z.enum(["true", "false"]).default("true"),
  NEW_USER_LOCAL_TRIAL_CREDITS: z.coerce.number().int().nonnegative().optional(),
  /**
   * 新用户注册即赠送的积分（用户 2026-09-16：「新用户注册即赠送 100 积分，后面新用户注册都给送」）。
   * 进 **bonus 桶**（赠送积分，不退款、与推荐奖励同桶）；类型专属的 `NEW_USER_*_TRIAL_CREDITS`
   * 仍可覆盖（隔离测试/内测环境用）。改这个数只影响**之后新注册**的账号，不动存量。
   */
  NEW_USER_SIGNUP_CREDITS: z.coerce.number().int().nonnegative().default(100),
  NEW_USER_CHAIN_TRIAL_CREDITS: z.coerce.number().int().nonnegative().optional(),
  NEW_USER_IP_TRIAL_CREDITS: z.coerce.number().int().nonnegative().optional(),
  DEDAO_BRAIN_RECORDS_URL: optionalUrl,
  UPLOAD_DIR: z.string().default("uploads"),
  TENANT_CNAME_TARGET: z.string().trim().min(1).default("custom.sitong.ai")
});

export const env = envSchema.parse(process.env);

export const domesticNetworkOnly = env.DOMESTIC_NETWORK_ONLY !== "false";
export const domesticOutboundAllowlist = parseAllowedHosts(env.DOMESTIC_OUTBOUND_ALLOWLIST);
export const inviteRequired = env.INVITE_REQUIRED !== "false";
export const inviteCodes = parseAllowedHosts(env.INVITE_CODES ?? "");
export const wechatAuthRequired = env.WECHAT_AUTH_REQUIRED !== "false";

/** 解析可选的 ISO 8601 时间（推荐有礼活动窗等）。空值或非法值返回 null。 */
export function parseOptionalIsoDate(value: string | null | undefined): Date | null {
  const text = (value ?? "").trim();
  if (!text) return null;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function validateRuntimeConfig(): string[] {
  const issues: string[] = [];
  const activeLlm = getActiveLlmConfig();

  if (env.NODE_ENV === "production" && env.DATA_MODE !== "database") {
    issues.push("NODE_ENV=production requires DATA_MODE=database");
  }
  if (env.NODE_ENV === "production" && (process.env.LLM_MOCK_MODE === "true" || process.env.USE_MOCK_LLM === "true")) {
    issues.push("production forbids LLM_MOCK_MODE and USE_MOCK_LLM");
  }
  if (env.DATA_MODE === "database" && !process.env.DATABASE_URL) {
    issues.push("DATA_MODE=database requires DATABASE_URL");
  }
  if (env.CONTINUOUS_IMPROVEMENT_AUTO_PERSIST === "true" && env.CONTINUOUS_IMPROVEMENT_ENABLED !== "true") {
    issues.push("CONTINUOUS_IMPROVEMENT_AUTO_PERSIST=true requires CONTINUOUS_IMPROVEMENT_ENABLED=true");
  }
  if (env.CONTINUOUS_IMPROVEMENT_AUTO_ACTIVATE === "true") {
    issues.push("CONTINUOUS_IMPROVEMENT_AUTO_ACTIVATE must remain false; candidates require eval, approval and canary release");
  }
  // PLAT-28 推荐有礼：开奖必须在完整活动窗内（左闭右开），且奖励积分必须只能用于文字类智能体。
  // 这两条是用户 2026-09-12 冻结口径，不做「配置错了也能启动」的容错。
  if (env.REFERRAL_REWARD_ENABLED === "true") {
    const referralStartsAt = parseOptionalIsoDate(env.REFERRAL_CAMPAIGN_STARTS_AT);
    const referralEndsAt = parseOptionalIsoDate(env.REFERRAL_CAMPAIGN_ENDS_AT);
    if (!referralStartsAt || !referralEndsAt) {
      issues.push(
        "REFERRAL_REWARD_ENABLED=true requires REFERRAL_CAMPAIGN_STARTS_AT and REFERRAL_CAMPAIGN_ENDS_AT in ISO 8601"
      );
    } else if (referralStartsAt.getTime() >= referralEndsAt.getTime()) {
      issues.push("REFERRAL_CAMPAIGN_STARTS_AT must be earlier than REFERRAL_CAMPAIGN_ENDS_AT (活动窗左闭右开)");
    }
  }
  if (env.REFERRAL_REWARD_TEXT_ONLY !== "true") {
    issues.push(
      "REFERRAL_REWARD_TEXT_ONLY must remain true: 推荐奖励积分只能用于文字类智能体（用户 2026-09-12 冻结口径）"
    );
  }
  if (env.BEAUTY_DAILY_BRIEF_SCHEDULER_ENABLED === "true") {
    if (env.DATA_MODE !== "database") issues.push("BEAUTY_DAILY_BRIEF_SCHEDULER_ENABLED=true requires DATA_MODE=database");
    if (!env.BEAUTY_DAILY_BRIEF_SCHEDULER_TENANT_ID || !env.BEAUTY_DAILY_BRIEF_SCHEDULER_USER_ID) {
      issues.push("Beauty daily scheduler requires an explicit billing tenant and user");
    }
    if (env.NODE_ENV === "production" && (env.BEAUTY_DAILY_BRIEF_RUNTIME_MODE !== "live" || env.BEAUTY_DAILY_BRIEF_RECURRING_APPROVED !== "true")) {
      issues.push("Production beauty daily scheduler requires live mode and explicit recurring approval");
    }
  }
  if (env.BEAUTY_DAILY_BRIEF_RUNTIME_MODE === "live") {
    if (env.BEAUTY_DAILY_BRIEF_RECURRING_APPROVED !== "true") issues.push("Beauty daily live mode requires recurring approval");
    if (env.BEAUTY_DAILY_BRIEF_DAILY_NETWORK_REQUEST_LIMIT <= 0) issues.push("Beauty daily live mode requires a positive daily network request limit");
    if (env.BEAUTY_DAILY_BRIEF_DAILY_MODEL_CALL_LIMIT <= 0) issues.push("Beauty daily live mode requires a positive daily model call limit");
    if (env.BEAUTY_DAILY_BRIEF_DAILY_COST_LIMIT_YUAN <= 0) issues.push("Beauty daily live mode requires a positive daily cost limit");
    if (env.BEAUTY_DAILY_BRIEF_DAILY_NETWORK_REQUEST_LIMIT > 36) issues.push("Beauty daily live mode network limit exceeds approval");
    if (env.BEAUTY_DAILY_BRIEF_DAILY_MODEL_CALL_LIMIT !== 1) issues.push("Beauty daily live mode requires exactly one daily model call");
    if (env.BEAUTY_DAILY_BRIEF_DAILY_COST_LIMIT_YUAN > 0.13) issues.push("Beauty daily live mode daily cost exceeds approval");
    if (env.BEAUTY_DAILY_BRIEF_MONTHLY_NETWORK_REQUEST_LIMIT <= 0 || env.BEAUTY_DAILY_BRIEF_MONTHLY_NETWORK_REQUEST_LIMIT > 1116) issues.push("Beauty daily live mode monthly network limit is invalid");
    if (env.BEAUTY_DAILY_BRIEF_MONTHLY_MODEL_CALL_LIMIT <= 0 || env.BEAUTY_DAILY_BRIEF_MONTHLY_MODEL_CALL_LIMIT > 31) issues.push("Beauty daily live mode monthly model limit is invalid");
    if (env.BEAUTY_DAILY_BRIEF_MONTHLY_COST_LIMIT_YUAN <= 0 || env.BEAUTY_DAILY_BRIEF_MONTHLY_COST_LIMIT_YUAN > 4.1) issues.push("Beauty daily live mode monthly cost limit is invalid");
  }
  if ((env.NODE_ENV === "production" || env.DATA_MODE === "database") && !env.JWT_SECRET) {
    issues.push("JWT_SECRET is required outside demo development");
  }
  if (env.NODE_ENV === "production" && (!env.KNOWLEDGE_CREDENTIALS_KEY || env.KNOWLEDGE_CREDENTIALS_KEY.length < 32)) {
    issues.push("production requires KNOWLEDGE_CREDENTIALS_KEY of at least 32 characters");
  }
  if (env.NODE_ENV === "production" && (!activeLlm.apiKey || !activeLlm.baseUrl)) {
    issues.push(`production requires ${activeLlm.apiKeyEnv} and ${activeLlm.baseUrlEnv}`);
  }
  if (!isHighCapabilityLlmModel(activeLlm.model, env.LLM_ALLOWED_MODELS)) {
    issues.push(highCapabilityLlmPolicyMessage(activeLlm.model, env.LLM_ALLOWED_MODELS));
  }
  if (env.LANQI_LOW_RISK_TEXT_ENABLED === "true" || env.LANQI_LOW_RISK_TEXT_EVAL_APPROVED === "true") {
    if (env.LANQI_LOW_RISK_TEXT_ENABLED !== "true" || env.LANQI_LOW_RISK_TEXT_EVAL_APPROVED !== "true") {
      issues.push("Lanqi low-risk text candidate requires both explicit enablement and Eval approval");
    }
    if (env.LANQI_LOW_RISK_TEXT_MODEL === "qwen3.8-flash" && (!env.ALIYUN_API_KEY || !env.ALIYUN_BASE_URL)) {
      issues.push("LANQI_LOW_RISK_TEXT_MODEL=qwen3.8-flash requires ALIYUN_API_KEY and ALIYUN_BASE_URL");
    }
    if (env.LANQI_LOW_RISK_TEXT_MODEL === "deepseek-v4-flash" && (!env.DEEPSEEK_API_KEY || !env.DEEPSEEK_BASE_URL)) {
      issues.push("LANQI_LOW_RISK_TEXT_MODEL=deepseek-v4-flash requires DEEPSEEK_API_KEY and DEEPSEEK_BASE_URL");
    }
  }
  if (env.SKILL_MCP_REQUIRED === "true" && !env.SKILL_MCP_URL) {
    issues.push("SKILL_MCP_REQUIRED=true requires SKILL_MCP_URL");
  }
  if (env.NODE_ENV === "production" && env.SKILL_MCP_REQUIRED !== "true") {
    issues.push("production requires SKILL_MCP_REQUIRED=true; Agent execution may not bypass MCP");
  }
  if (env.NODE_ENV === "production" && (!env.SKILL_MCP_TOKEN || env.SKILL_MCP_TOKEN.length < 32)) {
    issues.push("production requires a SKILL_MCP_TOKEN of at least 32 characters for the internal MCP execution gateway");
  }
  if (env.WORKBUDDY_MCP_ENABLED === "true" && env.WORKBUDDY_MCP_CONNECTIONS_JSON) {
    issues.push(...validateWorkbuddyConnections(env.WORKBUDDY_MCP_CONNECTIONS_JSON));
  }
  if (env.WECHAT_MESSAGE_ENABLED === "true") {
    if (!env.WECHAT_MESSAGE_TOKEN) issues.push("WECHAT_MESSAGE_ENABLED=true requires WECHAT_MESSAGE_TOKEN");
    if (!env.WECHAT_AUTH_APPID) issues.push("WECHAT_MESSAGE_ENABLED=true requires WECHAT_AUTH_APPID");
    if (!env.WECHAT_AUTH_SECRET) issues.push("WECHAT_MESSAGE_ENABLED=true requires WECHAT_AUTH_SECRET");
  }
  if (env.WECHAT_KF_ENABLED === "true") {
    const required = [
      ["WECHAT_KF_CORP_ID", env.WECHAT_KF_CORP_ID],
      ["WECHAT_KF_SECRET", env.WECHAT_KF_SECRET],
      ["WECHAT_KF_TOKEN", env.WECHAT_KF_TOKEN],
      ["WECHAT_KF_ENCODING_AES_KEY", env.WECHAT_KF_ENCODING_AES_KEY]
    ];
    for (const [name, value] of required) if (!value) issues.push(`WECHAT_KF_ENABLED=true requires ${name}`);
    if (env.WECHAT_KF_ENCODING_AES_KEY && env.WECHAT_KF_ENCODING_AES_KEY.length !== 43) {
      issues.push("WECHAT_KF_ENCODING_AES_KEY must be 43 characters");
    }
  }
  if (env.NODE_ENV === "production" && !env.ADMIN_TOKEN) {
    issues.push("production requires ADMIN_TOKEN");
  }
  if (env.NODE_ENV === "production" && !env.OPS_TOKEN) {
    issues.push("production requires OPS_TOKEN");
  }
  if (
    env.NODE_ENV === "production" &&
    env.DATA_MODE !== "database" &&
    inviteRequired &&
    inviteCodes.length === 0
  ) {
    issues.push("production invite gate requires INVITE_CODES or INVITE_REQUIRED=false");
  }
  if (env.NODE_ENV === "production" && !domesticNetworkOnly) {
    issues.push("production requires DOMESTIC_NETWORK_ONLY=true");
  }
  issues.push(...validateAllowedHosts("DOMESTIC_OUTBOUND_ALLOWLIST", domesticOutboundAllowlist));
  if (env.BEAUTY_MEDIA_EXECUTION_MODE === "real") {
    if (env.BEAUTY_MEDIA_MAX_PROVIDER_COST_YUAN <= 0) {
      issues.push("Beauty real media requires a positive Provider cost limit");
    }
    for (const host of getMissingBeautyProviderAssetRuntimeHosts(domesticOutboundAllowlist)) {
      issues.push(`Beauty real media requires DOMESTIC_OUTBOUND_ALLOWLIST to include ${host}`);
    }
  }
  if (activeLlm.baseUrl) {
    issues.push(
      ...validateOutboundUrl(activeLlm.providerLabel, activeLlm.baseUrl, {
        domesticNetworkOnly,
        allowedHosts: domesticOutboundAllowlist
      })
    );
  }
  for (const [index, sourceUrl] of parseAllowedHosts(env.AI_DAILY_NEWS_SOURCES).entries()) {
    if (!sourceUrl.startsWith("http")) continue;
    issues.push(
      ...validateOutboundUrl(`AI_DAILY_NEWS_SOURCES[${index}]`, sourceUrl, {
        domesticNetworkOnly,
        allowedHosts: domesticOutboundAllowlist
      })
    );
  }

  return issues;
}

export function getHighCapabilityLlmModels(): string[] {
  return buildHighCapabilityLlmModels(env.LLM_ALLOWED_MODELS);
}

export function getActiveLlmConfig(): {
  provider: typeof env.LLM_PROVIDER;
  providerLabel: string;
  apiKey?: string;
  apiKeyEnv: string;
  baseUrl?: string;
  baseUrlEnv: string;
  model: string;
} {
  if (env.LLM_PROVIDER === "aliyun") {
    return {
      provider: env.LLM_PROVIDER,
      providerLabel: "Aliyun DashScope",
      apiKey: env.ALIYUN_API_KEY,
      apiKeyEnv: "ALIYUN_API_KEY",
      baseUrl: env.ALIYUN_BASE_URL,
      baseUrlEnv: "ALIYUN_BASE_URL",
      model: env.ALIYUN_MODEL
    };
  }
  if (env.LLM_PROVIDER === "domestic_compatible") {
    return {
      provider: env.LLM_PROVIDER,
      providerLabel: env.DOMESTIC_COMPATIBLE_PROVIDER_NAME,
      apiKey: env.DOMESTIC_COMPATIBLE_API_KEY,
      apiKeyEnv: "DOMESTIC_COMPATIBLE_API_KEY",
      baseUrl: env.DOMESTIC_COMPATIBLE_BASE_URL,
      baseUrlEnv: "DOMESTIC_COMPATIBLE_BASE_URL",
      model: env.DOMESTIC_COMPATIBLE_MODEL
    };
  }
  return {
    provider: env.LLM_PROVIDER,
    providerLabel: "DeepSeek",
    apiKey: env.DEEPSEEK_API_KEY,
    apiKeyEnv: "DEEPSEEK_API_KEY",
    baseUrl: env.DEEPSEEK_BASE_URL,
    baseUrlEnv: "DEEPSEEK_BASE_URL",
    model: env.DEEPSEEK_MODEL
  };
}

export function getWechatPayConfigIssues(): string[] {
  const required = [
    ["WECHAT_PAY_APPID", env.WECHAT_PAY_APPID],
    ["WECHAT_PAY_MCH_ID", env.WECHAT_PAY_MCH_ID],
    ["WECHAT_PAY_API_V3_KEY", env.WECHAT_PAY_API_V3_KEY],
    ["WECHAT_PAY_CERT_SERIAL_NO", env.WECHAT_PAY_CERT_SERIAL_NO],
    ["WECHAT_PAY_PRIVATE_KEY or WECHAT_PAY_PRIVATE_KEY_FILE", env.WECHAT_PAY_PRIVATE_KEY ?? env.WECHAT_PAY_PRIVATE_KEY_FILE],
    ["WECHAT_PAY_NOTIFY_URL", env.WECHAT_PAY_NOTIFY_URL]
  ];
  return required
    .filter(([, value]) => !value)
    .map(([name]) => `${name} is required for WeChat Pay`);
}

export function getWechatAuthConfigIssues(): string[] {
  if (!wechatAuthRequired) return [];

  const required = [
    ["WECHAT_AUTH_APPID", env.WECHAT_AUTH_APPID],
    ["WECHAT_AUTH_SECRET", env.WECHAT_AUTH_SECRET],
    [
      "WECHAT_AUTH_REDIRECT_URI or VITE_WECHAT_AUTH_REDIRECT_URI",
      env.WECHAT_AUTH_REDIRECT_URI ?? process.env.VITE_WECHAT_AUTH_REDIRECT_URI
    ]
  ];
  return required
    .filter(([, value]) => !value)
    .map(([name]) => `${name} is required for WeChat Auth`);
}

function validateWorkbuddyConnections(source: string): string[] {
  try {
    const parsed = JSON.parse(source) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return ["WORKBUDDY_MCP_CONNECTIONS_JSON must be a non-empty JSON array"];
    }
    const issues: string[] = [];
    parsed.forEach((value, index) => {
      const record = value && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
      for (const key of ["token", "tenantId", "userId", "agentId"] as const) {
        if (typeof record[key] !== "string" || !record[key].trim()) {
          issues.push(`WorkBuddy connection ${index + 1} requires ${key}`);
        }
      }
      if (typeof record.token === "string" && record.token.length < 32) {
        issues.push(`WorkBuddy connection ${index + 1} token must be at least 32 characters`);
      }
    });
    return issues;
  } catch {
    return ["WORKBUDDY_MCP_CONNECTIONS_JSON must be valid JSON"];
  }
}

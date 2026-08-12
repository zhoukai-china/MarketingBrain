import { z } from "zod";
import {
  getHighCapabilityLlmModels as buildHighCapabilityLlmModels,
  highCapabilityLlmPolicyMessage,
  isHighCapabilityLlmModel
} from "../services/llm-model-policy.js";
import { parseAllowedHosts, validateAllowedHosts, validateOutboundUrl } from "../services/outbound-policy.js";

const emptyToUndefined = (value: unknown): unknown => (value === "" ? undefined : value);
const optionalString = z.preprocess(emptyToUndefined, z.string().optional());
const optionalUrl = z.preprocess(emptyToUndefined, z.string().url().optional());
const urlWithDefault = (defaultValue: string) =>
  z.preprocess(emptyToUndefined, z.string().url().default(defaultValue));

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3011),
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
  ALIYUN_API_KEY: optionalString,
  ALIYUN_BASE_URL: urlWithDefault("https://dashscope.aliyuncs.com/compatible-mode/v1"),
  ALIYUN_MODEL: z.string().trim().min(1).default("qwen-max"),
  ALIYUN_VIDEO_MODEL: z.string().trim().min(1).default("qwen-vl-max"),
  ALIYUN_VIDEO_REPLICATION_API_KEY: optionalString,
  ALIYUN_VIDEO_REPLICATION_ENDPOINT: optionalUrl,
  ALIYUN_VIDEO_REPLICATION_MODEL: z.string().trim().min(1).default("wan-animate-mix"),
  ALIYUN_VIDEO_REPLICATION_CREDITS: z.coerce.number().int().nonnegative().default(0),
  ALIYUN_VIDEO_REPLICATION_CALLBACK_TOKEN: optionalString,
  ALIYUN_ASR_MODEL: z.string().trim().min(1).default("qwen3-asr-flash"),
  ALIYUN_ASR_FILETRANS_MODEL: z.string().trim().min(1).default("qwen3-asr-flash-filetrans"),
  ALIYUN_MEDIA_BASE64_MAX_MB: z.coerce.number().positive().default(12),
  DASHSCOPE_API_KEY: optionalString,
  DASHSCOPE_BASE_URL: optionalUrl,
  PEXELS_API_KEY: optionalString,
  PIXABAY_API_KEY: optionalString,
  DOMESTIC_COMPATIBLE_PROVIDER_NAME: z.string().trim().min(1).default("domestic-compatible"),
  DOMESTIC_COMPATIBLE_API_KEY: optionalString,
  DOMESTIC_COMPATIBLE_BASE_URL: optionalUrl,
  DOMESTIC_COMPATIBLE_MODEL: z.string().trim().min(1).default("deepseek-v4-pro"),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(180000),
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
  JWT_SECRET: optionalString,
  KNOWLEDGE_CREDENTIALS_KEY: optionalString,
  ADMIN_TOKEN: optionalString,
  OPS_TOKEN: optionalString,
  INVITE_REQUIRED: z.enum(["true", "false"]).default("true"),
  INVITE_CODES: optionalString,
  DOMESTIC_NETWORK_ONLY: z.enum(["true", "false"]).default("true"),
  DOMESTIC_OUTBOUND_ALLOWLIST: z
    .string()
    .default("api.deepseek.com,dashscope.aliyuncs.com,bailian.aliyuncs.com,oss-cn-beijing.aliyuncs.com,openapi.biji.com,api.weixin.qq.com,api.mch.weixin.qq.com,qyapi.weixin.qq.com,www.jiqizhixin.com,www.leiphone.com,www.tmtpost.com,www.sogou.com,weixin.sogou.com,www.cac.gov.cn,www.miit.gov.cn,www.caict.ac.cn,www.douyin.com,douyin.com,www.xiaohongshu.com,xiaohongshu.com,channels.weixin.qq.com,mp.weixin.qq.com,api.pexels.com,images.pexels.com,videos.pexels.com,pixabay.com,cdn.pixabay.com"),
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

export function validateRuntimeConfig(): string[] {
  const issues: string[] = [];
  const activeLlm = getActiveLlmConfig();

  if (env.NODE_ENV === "production" && env.DATA_MODE !== "database") {
    issues.push("NODE_ENV=production requires DATA_MODE=database");
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

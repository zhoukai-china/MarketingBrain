import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (arg === "--") continue;
  if (arg.startsWith("--")) {
    const next = process.argv[index + 1];
    args.set(arg, next && !next.startsWith("--") ? next : "true");
    if (next && !next.startsWith("--")) index += 1;
  }
}

const defaultEnvPath = path.resolve(process.cwd(), ".env");
const envPath = args.get("--env") ?? (existsSync(defaultEnvPath) ? defaultEnvPath : undefined);
const env = {
  ...process.env,
  ...(envPath ? readEnvFile(envPath) : {})
};

const issues = [];
const warnings = [];

requireValue("NODE_ENV", "production");
requireValue("DATA_MODE", "database");
requirePresent("DATABASE_URL");
const llm = getActiveDomesticLlmConfig();
if (!llm) {
  issues.push("LLM_PROVIDER must be one of: deepseek, aliyun, domestic_compatible");
} else {
  requirePresent(llm.apiKeyEnv);
  requireUrl(llm.baseUrlEnv);
  requireApprovedStrongDomesticModel(llm.modelEnv);
}
requireMinLength("JWT_SECRET", 32);
requireMinLength("KNOWLEDGE_CREDENTIALS_KEY", 32);
requireMinLength("ADMIN_TOKEN", 32);
requireMinLength("OPS_TOKEN", 32);
if (env.INVITE_REQUIRED !== "false" && env.DATA_MODE !== "database") {
  requirePresent("INVITE_CODES");
} else if (env.INVITE_REQUIRED !== "false" && !env.INVITE_CODES) {
  warnings.push(
    "INVITE_CODES is empty; make sure at least one active database invite code exists before beta launch."
  );
}
requireValue("DOMESTIC_NETWORK_ONLY", "true");
requirePresent("DOMESTIC_OUTBOUND_ALLOWLIST");
if (env.WECHAT_AUTH_REQUIRED !== "false") {
  requirePresent("WECHAT_AUTH_APPID");
  requirePresent("WECHAT_AUTH_SECRET");
  requireAny(["WECHAT_AUTH_REDIRECT_URI", "VITE_WECHAT_AUTH_REDIRECT_URI"]);
} else {
  warnings.push("WECHAT_AUTH_REQUIRED=false; beta launch will use invite-only login until WeChat OAuth is ready.");
}
if (env.WECHAT_PAY_REQUIRED !== "false") {
  requirePresent("WECHAT_PAY_APPID");
  requirePresent("WECHAT_PAY_MCH_ID");
  requireMinLength("WECHAT_PAY_API_V3_KEY", 16);
  requirePresent("WECHAT_PAY_CERT_SERIAL_NO");
  requireAny(["WECHAT_PAY_PRIVATE_KEY", "WECHAT_PAY_PRIVATE_KEY_FILE"]);
  requireUrl("WECHAT_PAY_NOTIFY_URL");
  requireAny(["WECHAT_PAY_PLATFORM_PUBLIC_KEY", "WECHAT_PAY_PLATFORM_PUBLIC_KEY_FILE"]);
} else {
  warnings.push("WECHAT_PAY_REQUIRED=false; beta launch can proceed with manual payment/opening.");
}
requirePresent("UPLOAD_DIR");
requireUrl("SKILL_MCP_URL");
requireValue("SKILL_MCP_REQUIRED", "true");
requireMinLength("SKILL_MCP_TOKEN", 32);
requirePresent("ORIGINAL_SKILL_ROOT");
if (env.ORIGINAL_SKILL_ROOT && !path.isAbsolute(env.ORIGINAL_SKILL_ROOT)) {
  warnings.push("ORIGINAL_SKILL_ROOT should be an absolute server path in production.");
}

if (env.UPLOAD_DIR && env.UPLOAD_DIR === "uploads") {
  warnings.push("UPLOAD_DIR uses local default 'uploads'; production should use an absolute server path.");
}

const allowlist = parseAllowedHosts(env.DOMESTIC_OUTBOUND_ALLOWLIST ?? "");
checkAllowedHosts("DOMESTIC_OUTBOUND_ALLOWLIST", allowlist);
if (llm) {
  checkDomesticUrl(llm.baseUrlEnv, env[llm.baseUrlEnv], allowlist);
}
for (const [index, sourceUrl] of parseAllowedHosts(env.AI_DAILY_NEWS_SOURCES ?? "").entries()) {
  if (sourceUrl.startsWith("http")) {
    checkDomesticUrl(`AI_DAILY_NEWS_SOURCES[${index}]`, sourceUrl, allowlist);
  }
}
if (env.WECHAT_PAY_NOTIFY_URL) {
  checkDomesticUrl("WECHAT_PAY_NOTIFY_URL", env.WECHAT_PAY_NOTIFY_URL, allowlist, {
    allowOwnDomain: true
  });
}

if (env.NODE_ENV !== "production") {
  issues.push("NODE_ENV must be production before customer launch; otherwise dev-login remains available.");
}

const result = {
  ok: issues.length === 0,
  checkedEnvPath: envPath ? path.resolve(envPath) : "process.env",
  issues,
  warnings,
  nextAction:
    issues.length === 0
      ? "Static prelaunch check passed. Continue with /ready, /ops/launch-check, /ops/llm-smoke, and payment callback tests on the server."
      : "Fix all issues before opening v2 to customer testing."
};

console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);

function readEnvFile(filePath) {
  const absolute = path.resolve(filePath);
  if (!existsSync(absolute)) {
    console.error(`Env file not found: ${absolute}`);
    process.exit(1);
  }

  const values = {};
  const text = readFileSync(absolute, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex < 0) continue;
    const key = trimmed.slice(0, equalsIndex).trim();
    const rawValue = trimmed.slice(equalsIndex + 1).trim();
    values[key] = stripQuotes(rawValue);
  }
  return values;
}

function stripQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function requirePresent(name) {
  if (!env[name]) {
    issues.push(`${name} is required`);
  }
}

function requireAny(names) {
  if (!names.some((name) => env[name])) {
    issues.push(`${names.join(" or ")} is required`);
  }
}

function requireValue(name, expected) {
  if (env[name] !== expected) {
    issues.push(`${name} must be ${expected}`);
  }
}

function requireMinLength(name, minLength) {
  if (!env[name]) {
    issues.push(`${name} is required`);
  } else if (env[name].length < minLength) {
    issues.push(`${name} must be at least ${minLength} characters`);
  }
}

function requireUrl(name) {
  if (!env[name]) {
    issues.push(`${name} is required`);
    return;
  }
  try {
    new URL(env[name]);
  } catch {
    issues.push(`${name} must be a valid URL`);
  }
}

function getActiveDomesticLlmConfig() {
  const provider = env.LLM_PROVIDER || "deepseek";
  if (provider === "deepseek") {
    return {
      apiKeyEnv: "DEEPSEEK_API_KEY",
      baseUrlEnv: "DEEPSEEK_BASE_URL",
      modelEnv: "DEEPSEEK_MODEL"
    };
  }
  if (provider === "aliyun") {
    return {
      apiKeyEnv: "ALIYUN_API_KEY",
      baseUrlEnv: "ALIYUN_BASE_URL",
      modelEnv: "ALIYUN_MODEL"
    };
  }
  if (provider === "domestic_compatible") {
    return {
      apiKeyEnv: "DOMESTIC_COMPATIBLE_API_KEY",
      baseUrlEnv: "DOMESTIC_COMPATIBLE_BASE_URL",
      modelEnv: "DOMESTIC_COMPATIBLE_MODEL"
    };
  }
  return null;
}

function requireApprovedStrongDomesticModel(name) {
  const raw = env[name];
  if (!raw) {
    issues.push(`${name} is required`);
    return;
  }
  const approved = new Set([
    "deepseek-v4-pro",
    "deepseek-v4pro",
    "qwen-max",
    "qwen3-max",
    "qwen3-235b-a22b",
    "qwq-plus",
    ...String(env.LLM_ALLOWED_MODELS || "")
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
  ]);
  const normalized = raw.trim().toLowerCase();
  if (!approved.has(normalized)) {
    issues.push(`${name} must be an approved top-tier China-hosted model. Current value: ${raw}`);
  }
  if (isBlockedModelName(raw)) {
    issues.push(`${name} must not use overseas, low-tier, or explicitly blocked model names. Current value: ${raw}`);
  }
}

function isBlockedModelName(raw) {
  return [
    /deepseek[-_]?reasoner/i,
    /deepseek[-_]?r1/i,
    /(turbo|lite|mini|cheap|flash|small)/i,
    /\bgpt[-_\d]?/i,
    /chatgpt/i,
    /openai/i,
    /claude/i,
    /anthropic/i,
    /gemini/i,
    /mistral/i,
    /llama/i,
    /grok/i
  ].some((pattern) => pattern.test(raw));
}

function parseAllowedHosts(raw) {
  return raw
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
}

function checkDomesticUrl(name, rawUrl, allowlist, options = {}) {
  if (!rawUrl) return;

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return;
  }

  const hostname = url.hostname.toLowerCase();
  const blockedHosts = [
    "openai.com",
    "api.openai.com",
    "chatgpt.com",
    "anthropic.com",
    "api.anthropic.com",
    "googleapis.com",
    "generativelanguage.googleapis.com",
    "gemini.google.com",
    "cohere.ai",
    "mistral.ai"
  ];

  if (blockedHosts.some((host) => hostname === host || hostname.endsWith(`.${host}`))) {
    issues.push(`${name} uses blocked overseas AI host: ${hostname}`);
  }

  if (options.allowOwnDomain && !isKnownExternalService(hostname)) {
    return;
  }

  const allowed = allowlist.some((host) => hostname === host || hostname.endsWith(`.${host}`));
  if (!allowed) {
    issues.push(`${name} host ${hostname} is not in DOMESTIC_OUTBOUND_ALLOWLIST`);
  }
}

function checkAllowedHosts(name, allowlist) {
  const blocked = [
    "openai.com",
    "api.openai.com",
    "chatgpt.com",
    "anthropic.com",
    "api.anthropic.com",
    "googleapis.com",
    "generativelanguage.googleapis.com",
    "gemini.google.com",
    "cohere.ai",
    "mistral.ai",
    "techcrunch.com",
    "theverge.com",
    "venturebeat.com",
    "artificialintelligence-news.com",
    "huggingface.co",
    "arxiv.org",
    "technologyreview.com",
    "careerengine.us"
  ];
  for (const hostname of allowlist) {
    if (blocked.some((host) => hostname === host || hostname.endsWith(`.${host}`))) {
      issues.push(`${name} contains blocked overseas host: ${hostname}`);
    }
  }
}

function isKnownExternalService(hostname) {
  return hostname.includes("deepseek") || hostname.includes("weixin") || hostname.includes("qq.com");
}

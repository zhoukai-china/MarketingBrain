import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "../config/env.js";

/**
 * 平台管理后台的账号密码登录（用户 2026-09-15：后台不能给普通用户用，得用管理员账号密码登入）。
 *
 * 设计取舍：
 * - 之前只有一个共享密钥 `ADMIN_TOKEN`（脚本、运维、后台共用），既不能按人撤销、也不适合老板日常登录。
 *   现在加一层**账号 + 密码 → 有期限的管理会话令牌**；`ADMIN_TOKEN` 继续保留给脚本/运维（向后兼容）。
 * - 会话令牌是 HMAC 签名的一次性短令牌（默认 12 小时），不落库；签名密钥优先用 `ADMIN_SESSION_SECRET`，
 *   没配就退回 `ADMIN_TOKEN`（生产两者都有/都强随机）。
 * - 密码支持两种配置：`ADMIN_LOGIN_PASSWORD_HASH`（推荐，`scrypt$<salt>$<hash>`）或
 *   `ADMIN_LOGIN_PASSWORD`（明文，仅方便老板临时改；配了 hash 就忽略明文）。
 */

const SESSION_TTL_SECONDS_DEFAULT = 12 * 60 * 60;

export interface AdminSessionPayload {
  username: string;
  iat: number;
  exp: number;
}

export class AdminLoginNotConfiguredError extends Error {
  constructor() {
    super("admin_login_not_configured");
    this.name = "AdminLoginNotConfiguredError";
  }
}

function sessionSecret(): string {
  const secret = env.ADMIN_SESSION_SECRET || env.ADMIN_TOKEN || env.JWT_SECRET;
  if (!secret) throw new AdminLoginNotConfiguredError();
  return secret;
}

/* ------------------------------------------------------------------ *
 * 自动生成后台账号（算力计费 v1.0，用户 2026-09-28 要求「自动生成用户名和密码」）：
 * - env 配置了 ADMIN_LOGIN_* 时以 env 为准（行为不变）；
 * - 否则**首次登录时自动生成**用户名/密码：scrypt 哈希落盘，明文只在生成瞬间打印一次；
 * - 凭证文件：apps/api/.admin-credentials.json（已 gitignore）。重置 = 删文件重启。
 * ------------------------------------------------------------------ */

interface AdminBootstrapRecord {
  username: string;
  passwordHash: string;
  createdAt: string;
  generatedBy: "bootstrap";
}

const ADMIN_CREDENTIALS_FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".admin-credentials.json");

function envCredentialsConfigured(): boolean {
  return Boolean(env.ADMIN_LOGIN_PASSWORD_HASH || env.ADMIN_LOGIN_PASSWORD);
}

function readBootstrapCredentials(): AdminBootstrapRecord | null {
  try {
    if (!existsSync(ADMIN_CREDENTIALS_FILE)) return null;
    const raw = JSON.parse(readFileSync(ADMIN_CREDENTIALS_FILE, "utf8")) as AdminBootstrapRecord;
    if (raw?.username && typeof raw.passwordHash === "string" && raw.passwordHash.startsWith("scrypt$")) return raw;
    return null;
  } catch {
    return null;
  }
}

/** env 未配置时确保存在凭证文件；不存在则生成并在控制台打印一次明文。 */
export function ensureAdminBootstrapCredentials(): AdminBootstrapRecord | null {
  if (envCredentialsConfigured()) return null;
  const existing = readBootstrapCredentials();
  if (existing) return existing;
  const username = `admin_${randomBytes(3).toString("hex")}`;
  const password = randomBytes(12).toString("base64url");
  const record: AdminBootstrapRecord = {
    username,
    passwordHash: hashAdminPassword(password),
    createdAt: new Date().toISOString(),
    generatedBy: "bootstrap"
  };
  writeFileSync(ADMIN_CREDENTIALS_FILE, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  console.log("============================================================");
  console.log("[admin-bootstrap] 已自动生成管理后台账号（明文只显示这一次，请妥善保存）：");
  console.log(`[admin-bootstrap]   账号：${username}`);
  console.log(`[admin-bootstrap]   密码：${password}`);
  console.log(`[admin-bootstrap] 凭证文件：${ADMIN_CREDENTIALS_FILE}（仅存哈希；删除该文件并重启即可重置）`);
  console.log("============================================================");
  return record;
}

function configuredUsername(): string {
  if (env.ADMIN_LOGIN_USERNAME?.trim()) return env.ADMIN_LOGIN_USERNAME.trim();
  return readBootstrapCredentials()?.username ?? "admin";
}

export function hashAdminPassword(password: string, salt = randomBytes(16).toString("hex")): string {
  const derived = scryptSync(password, salt, 32).toString("hex");
  return `scrypt$${salt}$${derived}`;
}

function verifyScryptPassword(password: string, hash: string): boolean {
  const [scheme, salt, expected] = hash.split("$");
  if (scheme !== "scrypt" || !salt || !expected) return false;
  const derived = scryptSync(password, salt, 32);
  const expectedBuffer = Buffer.from(expected, "hex");
  if (expectedBuffer.length !== derived.length) return false;
  return timingSafeEqual(derived, expectedBuffer);
}

/** 密码校验：env 优先；env 未配置时校验自动生成的凭证文件（须先经 ensureAdminBootstrapCredentials 生成）。 */
export function verifyAdminCredentials(username: string, password: string): boolean {
  if (envCredentialsConfigured()) {
    if (username.trim() !== configuredUsername()) return false;
    const hash = (env.ADMIN_LOGIN_PASSWORD_HASH ?? "").trim();
    if (hash) return verifyScryptPassword(password, hash);
    const expectedPlain = Buffer.from(env.ADMIN_LOGIN_PASSWORD ?? "");
    const providedPlain = Buffer.from(password);
    if (expectedPlain.length !== providedPlain.length) return false;
    return timingSafeEqual(expectedPlain, providedPlain);
  }
  const boot = readBootstrapCredentials();
  if (!boot) return false;
  if (username.trim() !== boot.username) return false;
  return verifyScryptPassword(password, boot.passwordHash);
}

export function adminLoginConfigured(): boolean {
  return envCredentialsConfigured() || Boolean(readBootstrapCredentials());
}

function sign(payload: string): string {
  return createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
}

export function createAdminSessionToken(params: { username: string; ttlSeconds?: number }): { token: string; expiresAt: string } {
  const now = Math.floor(Date.now() / 1000);
  const payload: AdminSessionPayload = {
    username: params.username,
    iat: now,
    exp: now + (params.ttlSeconds ?? SESSION_TTL_SECONDS_DEFAULT)
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return { token: `${body}.${sign(body)}`, expiresAt: new Date(payload.exp * 1000).toISOString() };
}

/** 校验后台会话令牌；过期 / 篡改 / 结构不对一律返回 null（失败关闭）。 */
export function verifyAdminSessionToken(token: string | undefined): AdminSessionPayload | null {
  const raw = (token ?? "").trim();
  if (!raw || !raw.includes(".")) return null;
  const [body, signature] = raw.split(".");
  if (!body || !signature) return null;
  let expected: string;
  try {
    expected = sign(body);
  } catch {
    return null;
  }
  const providedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (providedBuffer.length !== expectedBuffer.length || !timingSafeEqual(providedBuffer, expectedBuffer)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as AdminSessionPayload;
    if (typeof payload.username !== "string" || !payload.username) return null;
    if (typeof payload.exp !== "number" || payload.exp * 1000 <= Date.now()) return null;
    if (payload.username !== configuredUsername()) return null;
    return payload;
  } catch {
    return null;
  }
}

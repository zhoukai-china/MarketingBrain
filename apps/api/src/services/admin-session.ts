import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
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
  const secret = env.ADMIN_SESSION_SECRET || env.ADMIN_TOKEN;
  if (!secret) throw new AdminLoginNotConfiguredError();
  return secret;
}

function configuredUsername(): string {
  return (env.ADMIN_LOGIN_USERNAME || "admin").trim();
}

export function hashAdminPassword(password: string, salt = randomBytes(16).toString("hex")): string {
  const derived = scryptSync(password, salt, 32).toString("hex");
  return `scrypt$${salt}$${derived}`;
}

/** 密码校验：hash 优先，其次明文配置；都没配视为「未开通后台登录」。 */
export function verifyAdminCredentials(username: string, password: string): boolean {
  if (!env.ADMIN_LOGIN_PASSWORD_HASH && !env.ADMIN_LOGIN_PASSWORD) throw new AdminLoginNotConfiguredError();
  if (username.trim() !== configuredUsername()) return false;

  const hash = (env.ADMIN_LOGIN_PASSWORD_HASH ?? "").trim();
  if (hash) {
    const [scheme, salt, expected] = hash.split("$");
    if (scheme !== "scrypt" || !salt || !expected) return false;
    const derived = scryptSync(password, salt, 32);
    const expectedBuffer = Buffer.from(expected, "hex");
    if (expectedBuffer.length !== derived.length) return false;
    return timingSafeEqual(derived, expectedBuffer);
  }

  const expectedPlain = Buffer.from(env.ADMIN_LOGIN_PASSWORD ?? "");
  const providedPlain = Buffer.from(password);
  if (expectedPlain.length !== providedPlain.length) return false;
  return timingSafeEqual(expectedPlain, providedPlain);
}

export function adminLoginConfigured(): boolean {
  return Boolean(env.ADMIN_LOGIN_PASSWORD_HASH || env.ADMIN_LOGIN_PASSWORD);
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

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import { env } from "../config/env.js";

/**
 * 微信 OAuth `state` 的服务端签发与验签（无状态）。
 *
 * 为什么要服务端签发：state 的作用是防「登录 CSRF」（诱导用户拿攻击者的 code 完成登录）。
 * 原先由前端生成 state、存在浏览器里，回调页比对——但微信安卓在授权往返中会切换
 * webview 内核（XWEB ↔ 老 X5），**localStorage / sessionStorage / cookie 都不跨内核共享**，
 * 比对必然失败（2026-09-22 生产真机复现，日志实锤）。把 state 改成服务端签名的令牌后，
 * 校验不再依赖任何客户端存储：微信把 state 原样带回，回调页交服务端验签即可。
 *
 * 令牌格式（点号分隔三段，base64url 与 hex 都不含 `.`，可安全 split）：
 *   `w1.<payloadBase64url>.<hmacSha256Hex>`
 * payload 为 JSON：`{ n, t, ref?, pcode?, host?, b?, s? }`，有效期 10 分钟。
 */

const STATE_PREFIX = "w1";
const STATE_TTL_MS = 10 * 60 * 1000;
/** 允许客户端时钟略快，但不容忍明显来自未来的时间戳。 */
const CLOCK_SKEW_MS = 60 * 1000;

export interface WechatOauthStatePayload {
  /** nonce */
  n: string;
  /** 签发时间（毫秒） */
  t: number;
  /** 推荐码（原样带回，回调页据此补种） */
  ref?: string;
  /** 产品登录码（回跳后补资料用） */
  pcode?: string;
  /** 品牌自定义域名 */
  host?: string;
  /** 扫码中转会话 id（PLAT-13） */
  b?: string;
  /** 扫码中转会话 secret（PLAT-13） */
  s?: string;
}

export interface WechatOauthStateInput {
  ref?: string;
  pcode?: string;
  host?: string;
  b?: string;
  s?: string;
}

function signingSecret(): string {
  // 复用 JWT_SECRET：生产/数据库模式已强制要求存在；demo 下给个固定值即可。
  return env.JWT_SECRET ?? "sitong-wechat-oauth-state-dev";
}

function sign(body: string): string {
  return createHmac("sha256", signingSecret()).update(body).digest("hex");
}

/** 判断一个字符串是否是本服务签发的 state（用于区分旧客户端传来的随机串）。 */
export function looksLikeWechatOauthState(raw: string): boolean {
  return raw.startsWith(`${STATE_PREFIX}.`);
}

export function mintWechatOauthState(input: WechatOauthStateInput): string {
  const payload: WechatOauthStatePayload = { n: randomUUID(), t: Date.now() };
  if (input.ref) payload.ref = input.ref;
  if (input.pcode) payload.pcode = input.pcode;
  if (input.host) payload.host = input.host;
  if (input.b) payload.b = input.b;
  if (input.s) payload.s = input.s;
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${STATE_PREFIX}.${body}.${sign(body)}`;
}

export type WechatOauthStateVerify =
  | { state: "ok"; payload: WechatOauthStatePayload }
  | { state: "invalid"; reason: "malformed" | "signature" | "expired" };

export function verifyWechatOauthState(raw: string): WechatOauthStateVerify {
  const parts = raw.split(".");
  if (parts.length !== 3 || parts[0] !== STATE_PREFIX) {
    return { state: "invalid", reason: "malformed" };
  }
  const body = parts[1] ?? "";
  const signature = parts[2] ?? "";
  const expected = sign(body);
  const a = Buffer.from(signature, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { state: "invalid", reason: "signature" };
  }
  let payload: WechatOauthStatePayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as WechatOauthStatePayload;
  } catch {
    return { state: "invalid", reason: "malformed" };
  }
  if (typeof payload?.t !== "number" || typeof payload?.n !== "string" || !payload.n) {
    return { state: "invalid", reason: "malformed" };
  }
  const age = Date.now() - payload.t;
  if (age > STATE_TTL_MS || age < -CLOCK_SKEW_MS) {
    return { state: "invalid", reason: "expired" };
  }
  return { state: "ok", payload };
}

export const WECHAT_OAUTH_STATE_TTL_MS = STATE_TTL_MS;

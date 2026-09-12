import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

/**
 * 电脑端「微信扫码登录」的一次性中转会话（PLAT-13）。
 *
 * 为什么需要它：公众号网页授权（`open.weixin.qq.com/connect/oauth2/authorize`）只在微信
 * 内置浏览器里能打开，电脑浏览器直接跳过去只会看到微信的「请在微信客户端打开链接」死页
 * （2026-09-11 用户生产实测）。所以电脑端不再直接跳授权，而是走一次中转：
 *
 *   电脑 --start--> 服务端（发一次性 id+secret，二维码指向 /wechat-bridge?b=&s=）
 *   手机（微信内）扫二维码 -> 微信授权 -> /wechat-bridge -> complete（服务端换 code 换登录结果）
 *   电脑 --轮询 status--> 服务端（取走登录结果，一次性，取走即焚）
 *
 * 存内存而不是数据库：生产 API 是单实例 systemd 服务（`ExecStart=pnpm --filter @baolu/api start`），
 * 会话只活 5 分钟、用完即焚，不值得为它加一次数据库迁移。代价是 API 重启会让在途二维码作废，
 * 用户刷新二维码即可——这条已知限制登记在任务卡里。
 */

/** 一次登录结果：与 `/auth/wechat-login` 的响应体同形，只有电脑端能取走。 */
export interface WechatLoginBridgeResult {
  statusCode: number;
  body: Record<string, unknown>;
}

export interface WechatLoginBridgeContext {
  productCode?: string;
  tenantHostname?: string;
  expiresAt: number;
}

export type WechatLoginBridgeRead =
  | { state: "not_found" }
  | { state: "expired" }
  | { state: "pending"; context: WechatLoginBridgeContext }
  | { state: "completed"; context: WechatLoginBridgeContext; result: WechatLoginBridgeResult };

/** 二维码有效期：够一次扫码授权，又不给暴力试探留窗口。 */
export const WECHAT_BRIDGE_TTL_MS = 5 * 60 * 1000;

/** 内存上限：匿名可创建会话，必须封顶，防止刷接口把进程内存打满。 */
const MAX_SESSIONS = 500;

interface BridgeSession {
  id: string;
  secretHash: Buffer;
  createdAt: number;
  expiresAt: number;
  productCode?: string;
  tenantHostname?: string;
  result?: WechatLoginBridgeResult;
}

const sessions = new Map<string, BridgeSession>();

function hashSecret(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}

function matchesSecret(session: BridgeSession, secret: string): boolean {
  const candidate = hashSecret(secret);
  return candidate.length === session.secretHash.length && timingSafeEqual(candidate, session.secretHash);
}

function sweep(now: number): void {
  for (const [id, session] of sessions) {
    if (session.expiresAt <= now) sessions.delete(id);
  }
  while (sessions.size > MAX_SESSIONS) {
    const oldest = sessions.keys().next();
    if (oldest.done) break;
    sessions.delete(oldest.value);
  }
}

/** 电脑端创建扫码会话；secret 只在创建时返回一次，服务端只留哈希。 */
export function createWechatLoginBridge(
  input: { productCode?: string; tenantHostname?: string; ttlMs?: number; now?: number } = {}
): { id: string; secret: string; expiresAt: number } {
  const now = input.now ?? Date.now();
  sweep(now);
  const id = randomUUID();
  const secret = randomBytes(24).toString("base64url");
  const expiresAt = now + (input.ttlMs ?? WECHAT_BRIDGE_TTL_MS);
  sessions.set(id, {
    id,
    secretHash: hashSecret(secret),
    createdAt: now,
    expiresAt,
    productCode: input.productCode,
    tenantHostname: input.tenantHostname
  });
  return { id, secret, expiresAt };
}

function locate(
  input: { id: string; secret: string; now?: number }
): { ok: true; session: BridgeSession; now: number } | { ok: false; state: "not_found" | "expired" } {
  const now = input.now ?? Date.now();
  const session = sessions.get(input.id);
  // id 不存在与 secret 不匹配返回同一个结果，避免被用来探测有效 id。
  if (!session || !matchesSecret(session, input.secret)) return { ok: false, state: "not_found" };
  if (session.expiresAt <= now) {
    sessions.delete(session.id);
    return { ok: false, state: "expired" };
  }
  return { ok: true, session, now };
}

function contextOf(session: BridgeSession): WechatLoginBridgeContext {
  return { productCode: session.productCode, tenantHostname: session.tenantHostname, expiresAt: session.expiresAt };
}

/**
 * 读会话状态。`consume: true` 时，只有「登录成功」的结果会被取走并销毁——
 * 失败结果保留，允许用户重新授权一次（微信授权码是一次性的，回退后必须能再来一遍）。
 */
export function readWechatLoginBridge(input: {
  id: string;
  secret: string;
  consume?: boolean;
  now?: number;
}): WechatLoginBridgeRead {
  const found = locate(input);
  if (!found.ok) return { state: found.state };
  const { session } = found;
  if (!session.result) return { state: "pending", context: contextOf(session) };
  const read: WechatLoginBridgeRead = { state: "completed", context: contextOf(session), result: session.result };
  if (input.consume && session.result.statusCode === 200) sessions.delete(session.id);
  return read;
}

/** 手机端（微信内）回填登录结果；失败结果可被下一次成功覆盖。 */
export function completeWechatLoginBridge(input: {
  id: string;
  secret: string;
  result: WechatLoginBridgeResult;
  now?: number;
}): { ok: true; context: WechatLoginBridgeContext } | { ok: false; state: "not_found" | "expired" } {
  const found = locate(input);
  if (!found.ok) return { ok: false, state: found.state };
  if (found.session.result && found.session.result.statusCode === 200) {
    // 已经成功过一次：保持第一次的结果，不覆盖（避免二次提交换人）。
    return { ok: true, context: contextOf(found.session) };
  }
  found.session.result = input.result;
  return { ok: true, context: contextOf(found.session) };
}

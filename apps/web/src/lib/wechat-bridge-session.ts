/**
 * 电脑端扫码登录（PLAT-13）在手机侧的会话暂存。
 *
 * 手机扫到二维码后进 `/wechat-bridge?b=&s=`，先把一次性 id/secret 暂存，再跳到微信授权；
 * 回到 `/wechat-callback` 时把 code 连同 id/secret 一起交回服务端。
 *
 * 存储：sessionStorage 为主，并额外写一份 cookie 兜底。原因同 wechat-oauth-state.ts——
 * 微信安卓授权往返会切换 webview 内核，sessionStorage 不跨内核共享，id/secret 一旦丢失
 * 扫码链路就会断（code 交不回电脑）。cookie 由全局 CookieManager 管理、跨内核可读。
 */

const wechatBridgeIdKey = "wechat_bridge_id";
const wechatBridgeSecretKey = "wechat_bridge_secret";

interface BridgeCookieLike {
  id: string;
  secret: string;
}

function setCookie(name: string, value: string, maxAgeSeconds: number): void {
  document.cookie =
    `${name}=${encodeURIComponent(value)}` +
    `; path=/` +
    `; max-age=${maxAgeSeconds}` +
    `; SameSite=Lax` +
    `; Secure`;
}

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

export interface PendingWeChatBridge {
  id: string;
  secret: string;
}

export function savePendingWeChatBridge(pending: PendingWeChatBridge): void {
  const maxAge = 10 * 60;
  try {
    sessionStorage.setItem(wechatBridgeIdKey, pending.id);
    sessionStorage.setItem(wechatBridgeSecretKey, pending.secret);
  } catch {
    // 隐私模式下 sessionStorage 可能不可写；此时扫码链路会退化成「回电脑重试」。
  }
  try {
    setCookie(wechatBridgeIdKey, pending.id, maxAge);
    setCookie(wechatBridgeSecretKey, pending.secret, maxAge);
  } catch {
    // 同上，靠 sessionStorage 兜底。
  }
}

export function readPendingWeChatBridge(): PendingWeChatBridge | null {
  const lsId = readLs(wechatBridgeIdKey);
  const lsSecret = readLs(wechatBridgeSecretKey);
  if (lsId && lsSecret) return { id: lsId, secret: lsSecret };

  // sessionStorage 缺失（跨内核/隐私模式）时回退 cookie。
  const cId = readCookie(wechatBridgeIdKey);
  const cSecret = readCookie(wechatBridgeSecretKey);
  if (cId && cSecret) return { id: cId, secret: cSecret };

  return null;
}

export function clearPendingWeChatBridge(): void {
  try {
    sessionStorage.removeItem(wechatBridgeIdKey);
    sessionStorage.removeItem(wechatBridgeSecretKey);
  } catch {
    // 忽略。
  }
  try {
    setCookie(wechatBridgeIdKey, "", 0);
    setCookie(wechatBridgeSecretKey, "", 0);
  } catch {
    // 忽略。
  }
}

function readLs(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

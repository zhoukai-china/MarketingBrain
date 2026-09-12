/**
 * 电脑端扫码登录（PLAT-13）在手机侧的会话暂存。
 *
 * 手机扫到二维码后进 `/wechat-bridge?b=&s=`，先把一次性 id/secret 放进
 * `sessionStorage`（同一台手机、同一个标签页内有效），再跳到微信授权；
 * 回到 `/wechat-callback` 时把 code 连同 id/secret 一起交回服务端。
 */
export const wechatBridgeIdKey = "wechat_bridge_id";
export const wechatBridgeSecretKey = "wechat_bridge_secret";

export interface PendingWeChatBridge {
  id: string;
  secret: string;
}

export function savePendingWeChatBridge(pending: PendingWeChatBridge): void {
  try {
    sessionStorage.setItem(wechatBridgeIdKey, pending.id);
    sessionStorage.setItem(wechatBridgeSecretKey, pending.secret);
  } catch {
    // 隐私模式下 sessionStorage 可能不可写；此时扫码链路会退化成「回电脑重试」。
  }
}

export function readPendingWeChatBridge(): PendingWeChatBridge | null {
  try {
    const id = sessionStorage.getItem(wechatBridgeIdKey) ?? "";
    const secret = sessionStorage.getItem(wechatBridgeSecretKey) ?? "";
    return id && secret ? { id, secret } : null;
  } catch {
    return null;
  }
}

export function clearPendingWeChatBridge(): void {
  try {
    sessionStorage.removeItem(wechatBridgeIdKey);
    sessionStorage.removeItem(wechatBridgeSecretKey);
  } catch {
    // 忽略：清理失败不影响用户流程。
  }
}

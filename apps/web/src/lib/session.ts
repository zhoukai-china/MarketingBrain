import { apiPath, getAppPath, getAppRoutePath } from "./api.js";

/**
 * 会话（登录态）工具：本地只保存 token，「是否还登录着」一律由服务端判定。
 *
 * 背景（登录死循环，QA-20260910-018）：此前判断「已登录」只看 localStorage 里
 * 有没有 `store_os_token`。token 过期或被吊销后这个判断依旧成立，于是访问
 * `/login` 会被直接弹回平台首页（`/agents`，旧地址 `/market`），而首页又因为
 * token 无效显示「未登录 · 点击登录」，用户就在登录页和首页之间来回跳，
 * 永远进不去登录页。
 * 这里统一用一次只读探针（接口 `GET /market/me`，与页面路由无关）来判定会话是否真的可用。
 */

export const SESSION_TOKEN_KEY = "store_os_token";
const ONBOARDING_TOKEN_KEY = "store_os_onboarding_token";
const POST_LOGIN_REDIRECT_KEY = "store_os_post_login_redirect";

export type SessionProbe = "valid" | "invalid" | "unknown";

export function readSessionToken(): string {
  try {
    return localStorage.getItem(SESSION_TOKEN_KEY) ?? "";
  } catch {
    // 隐私模式下 localStorage 可能不可读，按未登录处理。
    return "";
  }
}

/** 清掉本地会话痕迹。幂等，且不触碰任何服务端数据。 */
export function clearStoredSession(): void {
  try {
    localStorage.removeItem(SESSION_TOKEN_KEY);
    localStorage.removeItem(ONBOARDING_TOKEN_KEY);
  } catch {
    // 隐私模式下 localStorage 可能不可写；登录页仍然必须能打开。
  }
}

/**
 * 只读探针：服务端是否仍然接受这个 token。
 *
 * - `valid`：200，可以放心按「已登录」处理。
 * - `invalid`：401 / 403，token 已失效，调用方必须清掉本地会话，
 *   否则又会回到登录死循环。
 * - `unknown`：网络异常或 5xx。**不清 token**，避免把正在路上的用户误登出；
 *   调用方按「未登录」渲染登录页即可。
 */
export async function probeSession(token: string): Promise<SessionProbe> {
  if (!token) return "invalid";
  try {
    const response = await fetch(apiPath("/market/me"), {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store"
    });
    if (response.status === 401 || response.status === 403) return "invalid";
    if (!response.ok) return "unknown";
    return "valid";
  } catch {
    return "unknown";
  }
}

/**
 * 取登录后要落地的地址并消费掉它；没有有效地址时返回 null。
 *
 * 这个 key 在仓库里被多个页面用不同形态写入（有的写 `getAppPath()` 结果，
 * 有的写裸 `window.location.pathname`），所以统一按「只取 pathname → 去掉站点
 * 基础路径 → 再加回来」归一化；非同源或登录页自身一律退回默认地址，
 * 防止把用户送回 `/login` 形成新的死循环。
 *
 * 调用方分两类：
 * - 只需要一个落地地址：`takePostLoginRedirect(fallback)`，没有深链时用 `fallback`。
 * - 需要自己决定默认入口（产品/内部登录要按入口类型决定落哪）：`takePostLoginRedirect()`
 *   不传 fallback，没有深链时返回 null；底层原语是 `readPostLoginRedirect()`。
 */
export function readPostLoginRedirect(): string | null {
  try {
    const stored = localStorage.getItem(POST_LOGIN_REDIRECT_KEY);
    localStorage.removeItem(POST_LOGIN_REDIRECT_KEY);
    if (stored && stored.startsWith("/")) {
      const route = getAppRoutePath(new URL(stored, window.location.origin).pathname);
      if (route.startsWith("/") && !route.startsWith("/login")) return getAppPath(route);
    }
  } catch {
    // 解析失败按「没有待跳转地址」处理，由调用方决定兜底。
  }
  return null;
}

/**
 * 取登录后要落地的地址并消费掉它。
 *
 * 不传 `fallback`：没有有效地址时返回 null，由调用方决定默认入口。
 * 传 `fallback`：没有有效地址时返回 `getAppPath(fallback)`。
 */
export function takePostLoginRedirect(): string | null;
export function takePostLoginRedirect(fallback: string): string;
export function takePostLoginRedirect(fallback?: string): string | null {
  const redirect = readPostLoginRedirect();
  if (redirect) return redirect;
  return fallback === undefined ? null : getAppPath(fallback);
}

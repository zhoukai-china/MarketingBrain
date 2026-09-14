/**
 * 推荐码的「跨授权往返」暂存（PLAT-28 第①批补充，2026-09-12 真机实测后加固）。
 *
 * 真机现场：老板用链接 A 完成注册（新用户 + 新工作区都建了），但 `ReferralBinding` 是 0 ——
 * 服务端用同一条码复现时 `state=bound`（归因正常），说明**前端没把码带过去**：
 * 旧实现只把码存在 `sessionStorage`，而微信授权往返（甚至某些机型会换一个 webview）以及
 * 回调后 `window.location.replace("/login")` 丢掉 `?ref=` 这两件事叠加，码就没了。
 *
 * 现在的双保险：
 *   1. `sessionStorage`（同标签页，最快）；
 *   2. `localStorage` + 时间戳（24 小时有效，跨 webview / 跨标签页仍能读到）；
 *   3. 回调回跳的 URL 上继续带 `?ref=`（见 WeChatCallback / LoginPage）。
 * 只有注册成功或用户主动换号时才清除。
 */
const PENDING_REFERRAL_SESSION_KEY = "store_os_pending_referral";
const PENDING_REFERRAL_LOCAL_KEY = "store_os_pending_referral_v2";
const PENDING_REFERRAL_TTL_MS = 24 * 60 * 60 * 1000;

export function rememberPendingReferral(code: string | null | undefined): void {
  const normalized = (code ?? "").trim();
  if (!normalized) {
    clearPendingReferral();
    return;
  }
  try {
    sessionStorage.setItem(PENDING_REFERRAL_SESSION_KEY, normalized);
  } catch {
    /* 隐私模式：跳过，靠 localStorage 或 URL */
  }
  try {
    localStorage.setItem(PENDING_REFERRAL_LOCAL_KEY, JSON.stringify({ code: normalized, at: Date.now() }));
  } catch {
    /* ignore */
  }
}

export function readPendingReferral(): string {
  try {
    const fromSession = (sessionStorage.getItem(PENDING_REFERRAL_SESSION_KEY) ?? "").trim();
    if (fromSession) return fromSession;
  } catch {
    /* ignore */
  }
  try {
    const raw = localStorage.getItem(PENDING_REFERRAL_LOCAL_KEY);
    if (!raw) return "";
    const parsed = JSON.parse(raw) as { code?: unknown; at?: unknown };
    const code = typeof parsed.code === "string" ? parsed.code.trim() : "";
    const at = typeof parsed.at === "number" ? parsed.at : 0;
    if (!code) return "";
    if (!at || Date.now() - at > PENDING_REFERRAL_TTL_MS) {
      localStorage.removeItem(PENDING_REFERRAL_LOCAL_KEY);
      return "";
    }
    return code;
  } catch {
    return "";
  }
}

export function clearPendingReferral(): void {
  try {
    sessionStorage.removeItem(PENDING_REFERRAL_SESSION_KEY);
  } catch {
    /* ignore */
  }
  try {
    localStorage.removeItem(PENDING_REFERRAL_LOCAL_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * 生成「去登录」的站内路径，并自动带上暂存的推荐码。
 *
 * 2026-09-13 真机取证（nginx 访问日志）：用户从推荐链接进登录页（`/login?ref=…`），
 * 之后在货架点了「登录」→ 跳到 **不带 query 的 `/login`** → 微信授权 → 回跳也只到 `/login`
 * → 提交时手上已经没有码，`ReferralBinding` 落不了。把那一次的跳转补上码，这条断点就闭合。
 *
 * 用法：`window.location.href = loginPathWithPendingReferral()`（可用 path 指定其它登录入口）。
 */
export function loginPathWithPendingReferral(path = "/login"): string {
  const code = readPendingReferral();
  if (!code) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}ref=${encodeURIComponent(code)}`;
}

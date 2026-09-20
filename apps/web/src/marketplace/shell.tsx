import { useState } from "react";
import { apiPath, getAppPath } from "../lib/api.js";
import { clearStoredSession } from "../lib/session.js";
import { loginPathWithPendingReferral } from "../lib/pending-referral.js";

export function authHeaders(json = false): Record<string, string> {
  const token = localStorage.getItem("store_os_token");
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(json ? { "Content-Type": "application/json" } : {})
  };
}

export async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({})) as T & { message?: string };
  if (!response.ok) throw new Error(data.message ?? `请求失败（${response.status}）`);
  return data;
}

/** 管理端读取：把 401/403 翻译成销售能看懂的话，其余沿用服务端 message / error。 */
export async function adminReadJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    if (response.status === 403) {
      const data = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
      // PLAT-28：停用是「功能关闭」，不是「你没权限」，两者的用户动作完全不同，必须分开讲。
      if (data.error === "trial_grant_disabled") {
        throw new Error(data.message ?? "人工发放体验额度已停用。");
      }
      throw new Error("当前账号没有发放权限（需要 operator 及以上角色），请用运营/销售后台账号登入。");
    }
    if (response.status === 401) {
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(
        data.error === "admin_token_required"
          ? "体验额度发放需要平台运营凭证：请在上方填写「平台管理令牌」后再试。"
          : "登录已失效，请重新登入后再发放。"
      );
    }
    const data = (await response.json().catch(() => ({}))) as { message?: string; error?: string };
    throw new Error(data.message ?? data.error ?? `请求失败（${response.status}）`);
  }
  return (await response.json()) as T;
}

/**
 * 运营后台专用请求头（PLAT-11）。
 *
 * 体验额度是资金侧写操作，服务端除角色守卫外还要求平台运营凭证
 * （`x-sitong-admin-token` == `ADMIN_TOKEN`，与 `/admin/invites` 同源），
 * 否则任何商家 owner 都能给自己发体验积分（QA-20260911-009）。
 * 凭证只挂在这一条请求路径上，不并进通用 `authHeaders`，避免泄漏到普通接口。
 */
export function adminAuthHeaders(json = false): Record<string, string> {
  const token = sessionStorage.getItem("sitong_admin_token");
  return {
    ...authHeaders(json),
    ...(token ? { "x-sitong-admin-token": token } : {})
  };
}

/**
 * 服务端判定「会话失效」（401/403）时统一收口：清掉本地 token。
 * 不清的话页面会一边显示「未登录 · 点击登录」、一边在 localStorage 里留着失效 token，
 * 用户点登录立刻被弹回货架，形成登录死循环（QA-20260910-018）。
 */
export function handleStaleSession(status: number): boolean {
  if (status !== 401 && status !== 403) return false;
  clearStoredSession();
  return true;
}

/** 读货架账户信息（余额 / 使用记录）；未登录或会话失效时返回 null。 */
export async function fetchMarketMe<T>(): Promise<T | null> {
  if (!localStorage.getItem("store_os_token")) return null;
  const response = await fetch(apiPath("/market/me"), { headers: authHeaders(), cache: "no-store" });
  if (handleStaleSession(response.status)) return null;
  return readJson<T>(response);
}

/**
 * 主题切换（2026-09-11：平台默认浅色）。
 *
 * 用 state 记住当前主题，切换后按钮能立即反映新状态；`data-theme` 与 localStorage
 * 仍然是唯一事实来源（首次渲染从 DOM 读取，避免和 main.tsx 的初始化打架）。
 */
export function useTheme(): { theme: "light" | "dark"; toggle: () => void } {
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "dark"
      ? "dark"
      : "light"
  );
  const toggle = () => {
    const next: "light" | "dark" = theme === "light" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", next);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", next === "dark" ? "#101721" : "#F4F7FC");
    try {
      localStorage.setItem("sitong-theme", next);
    } catch {
      // 隐私模式下不阻断主流程。
    }
    setTheme(next);
  };
  return { theme, toggle };
}

export function guestToLogin(path: string): void {
  localStorage.setItem("store_os_post_login_redirect", getAppPath(path));
  // 带上暂存的推荐码：不带的话，从货架点「登录」这一跳会把归因码丢掉
  // （2026-09-13 真机 nginx 日志实证：/login?ref=… → /login → 回调 → /login，码全丢）。
  window.location.href = getAppPath(loginPathWithPendingReferral("/login"));
}

export function Topbar({
  active,
  balance,
  onNavigate,
  walletPath = "/agents"
}: {
  active: string;
  balance: number | null;
  onNavigate: (path: string) => void;
  /** 未登录时点积分胶囊要带去登录、并在登录后回到哪一页（充值页要回自己，见 2026-09-19 用户）。 */
  walletPath?: string;
}) {
  const { theme, toggle } = useTheme();
  /*
   * 2026-09-19（用户）：「未登录，为什么还显示要退出登录？」
   *
   * 旧实现把「本地还残留着一个 token」直接当登录态：token 过期或被吊销后，未登录的人
   * 也会看到「退出登录」——同一屏里左边写着「🔒 未登录 · 点击登录」，右边挂着退出按钮，
   * 自相矛盾。现在**登录态只认服务端**：页面从 `/market/me` 拿到余额才算登录；
   * `fetchMarketMe` 在 401/403 时会清掉本地 token，balance 保持 null。
   */
  const loggedIn = balance !== null;

  function handleLogout() {
    clearStoredSession();
    // 运营凭证只活在当前标签页，退出时一并清掉，避免换账号后残留。
    try {
      sessionStorage.removeItem("sitong_admin_token");
    } catch {
      // 隐私模式下 sessionStorage 不可写：不影响退出登录主流程。
    }
    // 退出后落回货架，重新登入成功仍回到货架，不会卡在登录页。
    localStorage.setItem("store_os_post_login_redirect", getAppPath("/agents"));
    window.location.href = getAppPath(loginPathWithPendingReferral("/login"));
  }

  return (
    <>
      <header className="topbar">
        <div className="brand" onClick={() => onNavigate("/agents")}>
          <span className="brand-mark">思潼<span className="brand-accent">AI</span></span>
        </div>
        <nav className="topnav">
          <a className={`nav-link ${active === "market" ? "active" : ""}`} onClick={() => onNavigate("/agents")}>商城</a>
          {/* 2026-09-16：用户要求「常用智能体」做成独立列表页（只列自己用过的智能体），不再是「我的」的锚点。 */}
          <a className={`nav-link ${active === "my-agents" ? "active" : ""}`} onClick={() => onNavigate("/my-agents")}>常用</a>
          <a className={`nav-link ${active === "recharge" ? "active" : ""}`} onClick={() => onNavigate("/recharge")}>积分充值</a>
          {/*
           * 2026-09-16（用户）：「我的」要做到一级导航栏、放在「积分充值」后面。
           * 页面本身就是「我的」（余额 / 常用智能体 / 历史交付物 / 积分退回 / 邀请链接），
           * 所以这一栏是它的正名入口，高亮也归它（`active="me"`），避免与「常用智能体」抢高亮。
           */}
          <a className={`nav-link ${active === "me" ? "active" : ""}`} onClick={() => onNavigate("/mine")}>我的</a>
        </nav>
        <button className="theme-toggle" onClick={toggle} title="切换深色 / 浅色">
          <span className="tt-ico">{theme === "light" ? "☀️" : "🌙"}</span>
          <span>{theme === "light" ? "浅色" : "深色"}</span>
        </button>
        <div className="wallet-pill" onClick={() => (balance === null ? guestToLogin(walletPath) : onNavigate("/recharge"))} title="积分余额 · 点击充值">
          {balance === null ? "🔒 未登录 · 点击登录" : <>💎 <b>{balance}</b> 积分 <span className="wp-tag">全平台通用</span></>}
        </div>
        {loggedIn ? (
          <button className="logout-link" onClick={handleLogout} title="退出后用另一个账号重新登入">退出登录</button>
        ) : null}
      </header>
      <div className="shared-banner">💎 <b>积分全平台通用</b> · 数字员工、数字咨询师与各行业专区共用同一份积分</div>
    </>
  );
}

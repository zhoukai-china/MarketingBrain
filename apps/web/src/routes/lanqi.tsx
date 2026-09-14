import { lazy, useEffect, useState, type ReactNode } from "react";
import { apiPath, getAppPath } from "../lib/api.js";
import { DIRECT_TEST_LOGIN_ENABLED } from "../lib/direct-test-session.js";

const LanqiStoreProfilePage = lazy(() => import("../pages/LanqiStoreProfilePage.js").then(module => ({ default: module.LanqiStoreProfilePage })));
const LanqiDiagnosisPage = lazy(() => import("../pages/LanqiDiagnosisPage.js").then(module => ({ default: module.LanqiDiagnosisPage })));
const LanqiExecutionPlanPage = lazy(() => import("../pages/LanqiExecutionPlanPage.js").then(module => ({ default: module.LanqiExecutionPlanPage })));
const LanqiContentStudioPage = lazy(() => import("../pages/LanqiContentStudioPage.js").then(module => ({ default: module.LanqiContentStudioPage })));
const LanqiImageStudioPage = lazy(() => import("../pages/LanqiImageStudioPage.js").then(module => ({ default: module.LanqiImageStudioPage })));
const LanqiBusinessQaPage = lazy(() => import("../pages/LanqiBusinessQaPage.js").then(module => ({ default: module.LanqiBusinessQaPage })));
const LanqiMomentsPage = lazy(() => import("../pages/LanqiMomentsPage.js").then(module => ({ default: module.LanqiMomentsPage })));
const LanqiBrainHomePage = lazy(() => import("../pages/LanqiBrainHomePage.js").then(module => ({ default: module.LanqiBrainHomePage })));
const LanqiMomentsHomePage = lazy(() => import("../pages/LanqiMomentsHomePage.js").then(module => ({ default: module.LanqiMomentsHomePage })));
const LanqiAcquireHomePage = lazy(() => import("../pages/LanqiAcquireHomePage.js").then(module => ({ default: module.LanqiAcquireHomePage })));
const LanqiAcquireCopywriterPage = lazy(() => import("../pages/LanqiAcquireCopywriterPage.js").then(module => ({ default: module.LanqiAcquireCopywriterPage })));
const LanqiAcquireMethodsPage = lazy(() => import("../pages/LanqiAcquireMethodsPage.js").then(module => ({ default: module.LanqiAcquireMethodsPage })));
const LanqiAcquireLivePage = lazy(() => import("../pages/LanqiAcquireLivePage.js").then(module => ({ default: module.LanqiAcquireLivePage })));
const LanqiAcquireVideoPage = lazy(() => import("../pages/LanqiAcquireVideoPage.js").then(module => ({ default: module.LanqiAcquireVideoPage })));
const LanqiAcquireVideoCopyPage = lazy(() => import("../pages/LanqiAcquireVideoPage.js").then(module => ({ default: module.LanqiAcquireVideoCopyPage })));
const LanqiMomentsWechatGroupPage = lazy(() => import("../pages/LanqiMomentsWechatGroupPage.js").then(module => ({ default: module.LanqiMomentsWechatGroupPage })));
const LanqiDashboardPage = lazy(() => import("../pages/LanqiDashboardPage.js").then(module => ({ default: module.LanqiDashboardPage })));
const LanqiGoalSettingPage = lazy(() => import("../pages/LanqiGoalSettingPage.js").then(module => ({ default: module.LanqiGoalSettingPage })));
const LanqiCasesPage = lazy(() => import("../pages/LanqiPlaceholderPage.js").then(module => ({ default: module.LanqiCasesPage })));
const LanqiCustomersPage = lazy(() => import("../pages/LanqiPlaceholderPage.js").then(module => ({ default: module.LanqiCustomersPage })));
const LanqiAnalysisPage = lazy(() => import("../pages/LanqiPlaceholderPage.js").then(module => ({ default: module.LanqiAnalysisPage })));
const LanqiSalesSimPage = lazy(() => import("../pages/LanqiPlaceholderPage.js").then(module => ({ default: module.LanqiSalesSimPage })));
const LanqiStoreAdminPage = lazy(() => import("../pages/LanqiPlaceholderPage.js").then(module => ({ default: module.LanqiStoreAdminPage })));
const LanqiDashboardInDevelopmentPage = lazy(() => import("../pages/LanqiPlaceholderPage.js").then(module => ({ default: module.LanqiDashboardInDevelopmentPage })));
const LanqiAcquireInDevelopmentPage = lazy(() => import("../pages/LanqiPlaceholderPage.js").then(module => ({ default: module.LanqiAcquireInDevelopmentPage })));

/*
 * 兰琪上线口径开关（用户 2026-09-11 要求）：
 * 「目前私域营销可以正常上线，其他板块显示开发中即可」。
 * true = 只有 /lanqi/moments* 是已上线功能，经营驾驶舱、公域获客等未验收板块
 * 一律由「开发中」占位页接管（真实页面组件与路由分支保留在仓库，未被删除）。
 * 后续某个板块验收通过，只需把它单独放行或整体改回 false。
 */
export const LANQI_MOMENTS_ONLY_LAUNCH = true;
/** 公域获客（板块3）已验收放开：true = 枢纽页/文案改稿/顾问/直播话术可用（爆款复刻与一键成片始终放行）；
 *  经营驾驶舱（板块1）仍由 LANQI_MOMENTS_ONLY_LAUNCH 单独按「开发中」占位，不受本开关影响。 */
export const LANQI_ACQUIRE_LAUNCHED = true;

function LanqiLocalAccessPage() {
  const [message, setMessage] = useState("正在打开本机兰琪体验工作区…");

  useEffect(() => {
    const isLocalMachine = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
    if (!import.meta.env.DEV || !isLocalMachine) {
      window.location.replace(getAppPath("/login/lanqi"));
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(apiPath("/auth/dev-login"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tenantRole: "local_business",
            tenantName: "本机兰琪体验工作区",
            planCode: "local_standard",
          }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.token) throw new Error(data.message ?? "本机体验登录暂时不可用。");
        if (cancelled) return;
        localStorage.setItem("store_os_token", data.token);
        localStorage.setItem("store_os_tenant_role", "local_business");
        localStorage.setItem("store_os_tenant_name", "本机兰琪体验工作区");
        window.location.replace(getAppPath("/lanqi/content-studio"));
      } catch (cause) {
        if (!cancelled) setMessage(cause instanceof Error ? cause.message : "本机体验登录失败，请确认本地 API 正在运行。");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return <main className="loginPage"><section className="loginCard"><div className="loginBrand"><span className="loginBadge">兰琪美业 · 本机专用</span><h1>正在进入体验工作区</h1><p>{message}</p></div></section></main>;
}

/**
 * 兰琪路由的「已处理（重定向）后停止」哨兵：与「未命中（返回 null，继续匹配后续路由）」区分开。
 */
const HANDLED: unique symbol = Symbol("lanqi.route.handled");
export type LanqiRouteResult = ReactNode | typeof HANDLED | null;
export const isLanqiHandled = (value: LanqiRouteResult): value is typeof HANDLED => value === HANDLED;

export function renderLanqiRoutes(path: string): LanqiRouteResult {
  // 兰琪工作台需要会话：未登录访问 `/lanqi/*` 时不渲染任何功能入口或表单，
  // 直接带回兰琪登录页（保住兰琪产品上下文，不落进平台通用产品选择页）。
  // 内测免登录实例（DIRECT_TEST_LOGIN_ENABLED）由 DirectTestLoginGate 先建立
  // 会话，因此本判断对它无影响；`/lanqi/local` 是登录前的本机入口，单独放行。
  if (
    (path === "/lanqi" || path === "/lanqi/" || path.startsWith("/lanqi/")) &&
    !DIRECT_TEST_LOGIN_ENABLED &&
    !localStorage.getItem("store_os_token")
  ) {
    window.location.replace(getAppPath("/login/lanqi"));
    return HANDLED;
  }

  if (path === "/lanqi/local" || path === "/lanqi/local/") {
    return <LanqiLocalAccessPage />;
  }

  // 兰琪工作台入口：`/lanqi` 与 `/lanqi/` 直达当前唯一已上线的「私域营销」
  // （不是八板块卡片墙，也不再落进旧的「美业智能体」单品页
  // `/agents/beauty-industry`）。八板块总览仍在 `/lanqi/brain`。
  if (path === "/lanqi" || path === "/lanqi/") {
    window.location.replace(getAppPath("/lanqi/moments"));
    return HANDLED;
  }

  if (path === "/lanqi/brain" || path === "/lanqi/brain/") {
    return <LanqiBrainHomePage />;
  }

  if (path.startsWith("/lanqi/store-profile")) {
    return <LanqiStoreProfilePage />;
  }

  if (path.startsWith("/lanqi/business-qa")) {
    return <LanqiBusinessQaPage />;
  }

  if (path.startsWith("/lanqi/diagnosis")) {
    return <LanqiDiagnosisPage />;
  }

  if (path.startsWith("/lanqi/execution-plan")) {
    return <LanqiExecutionPlanPage />;
  }

  if (path.startsWith("/lanqi/content-studio")) {
    return <LanqiContentStudioPage />;
  }

  if (path.startsWith("/lanqi/image-studio")) {
    return <LanqiImageStudioPage />;
  }
  if (path.startsWith("/lanqi/moments/wechat-group")) {
    return <LanqiMomentsWechatGroupPage />;
  }
  if (path.startsWith("/lanqi/moments/friend-circle")) {
    return <LanqiMomentsPage />;
  }
  if (path.startsWith("/lanqi/moments")) {
    return <LanqiMomentsHomePage />;
  }
  /*
   * 公域获客（LQ-19 及子页）尚未验收上线，本轮口径是「开发中」。
   * 放在 acquire 各子路由最前面，确保 /lanqi/acquire* 全部落在占位页，
   * 不让用户点进未验收的功能；真实组件与下方分支保留，验收通过后放开开关即可。
   * 例外：文案转片（LQ-23）已接通真实图生视频并单独验收，必须排在总闸之前放行。
   */
  /*
   * 0912 一期口径：视频获客 = 两个独立任务页（爆款复刻 / 一键成片），各自独立路由，
   * 不做成一个页面的页签。旧深链 `?mode=script` 一跳转到一键成片页，`?mode=assets|clip`
   * 本期不交付 → 回到爆款复刻页（页面本身也不提供这两个入口）。
   */
  if (path.startsWith("/lanqi/acquire/video-copy")) {
    return <LanqiAcquireVideoCopyPage />;
  }
  if (path.startsWith("/lanqi/acquire/video")) {
    const legacyMode = new URLSearchParams(window.location.search).get("mode");
    if (legacyMode === "script") {
      window.location.replace(`${getAppPath("/lanqi/acquire/video-copy")}${window.location.hash}`);
      return <LanqiAcquireVideoCopyPage />;
    }
    return <LanqiAcquireVideoPage />;
  }
  if (path.startsWith("/lanqi/acquire")) {
    if (LANQI_MOMENTS_ONLY_LAUNCH && !LANQI_ACQUIRE_LAUNCHED) return <LanqiAcquireInDevelopmentPage />;
  }
  if (path.startsWith("/lanqi/acquire/copywriter")) {
    return <LanqiAcquireCopywriterPage />;
  }
  if (path.startsWith("/lanqi/acquire/methods")) {
    return <LanqiAcquireMethodsPage />;
  }
  if (path.startsWith("/lanqi/acquire/live")) {
    return <LanqiAcquireLivePage />;
  }
  if (path.startsWith("/lanqi/acquire/video")) {
    return <LanqiAcquireVideoPage />;
  }
  if (path.startsWith("/lanqi/acquire")) {
    return <LanqiAcquireHomePage />;
  }

  /*
   * 兰琪经营驾驶舱（LQ-20）：demo 的 home.html 就是这一页，也是登录后的默认落地页。
   * 必须放在全局兜底 `NotFoundPage` 之前，否则会掉进「页面不存在」页（报告 Bug2）。
   */
  if (path === "/lanqi/dashboard" || path === "/lanqi/dashboard/") {
    return LANQI_MOMENTS_ONLY_LAUNCH ? <LanqiDashboardInDevelopmentPage /> : <LanqiDashboardPage />;
  }
  if (path.startsWith("/lanqi/goal-setting")) {
    return LANQI_MOMENTS_ONLY_LAUNCH ? <LanqiDashboardInDevelopmentPage /> : <LanqiGoalSettingPage />;
  }

  /*
   * 侧栏里还没开发的板块：每一项都要能落在兰琪自己的页面上（占位页明说「开发中」），
   * 不能因为路由缺失掉进别的产品首页。
   */
  if (path === "/lanqi/cases" || path === "/lanqi/cases/") {
    return <LanqiCasesPage />;
  }
  if (path === "/lanqi/customers" || path === "/lanqi/customers/") {
    return <LanqiCustomersPage />;
  }
  if (path === "/lanqi/analysis" || path === "/lanqi/analysis/") {
    return <LanqiAnalysisPage />;
  }
  if (path === "/lanqi/sales-sim" || path === "/lanqi/sales-sim/") {
    return <LanqiSalesSimPage />;
  }
  if (path === "/lanqi/store" || path === "/lanqi/store/") {
    return <LanqiStoreAdminPage />;
  }
  // 私域营销在部分入口里带前缀：`/lanqi/private-domain/moments` 也回到私域营销首页。
  if (path.startsWith("/lanqi/private-domain/moments")) {
    return <LanqiMomentsHomePage />;
  }

  return null;
}

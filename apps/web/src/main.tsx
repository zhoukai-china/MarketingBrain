import React, { Component, lazy, Suspense, useState, useEffect, useRef, type ErrorInfo, type ReactNode } from "react";
import ReactDOM from "react-dom/client";
import type { LoginEntry, LoginResult } from "./pages/LoginPage.js";
import { PRODUCT_LOGIN_DEFINITIONS } from "@baolu/shared";
import { apiPath, getAppPath, getAppRoutePath } from "./lib/api.js";
import {
  DIRECT_TEST_LOGIN_ENABLED,
  ensureDirectTestSession,
  hasDirectTestSession,
} from "./lib/direct-test-session.js";
import { clearStoredSession, probeSession, readSessionToken, takePostLoginRedirect } from "./lib/session.js";
import { rememberPendingReferral } from "./lib/pending-referral.js";
import { renderLanqiRoutes, isLanqiHandled } from "./routes/lanqi.js";
import "./styles/app.css";
import "./styles/store-growth.css";
import "./styles/baolu-diagnosis.css";
import "./styles/growth-flywheel.css";
import "./styles/agent-products.css";
import "./styles/takeaway-operating-brief.css";
import "./styles/takeaway-supplement-impact.css";
import "./styles/takeaway-analytics.css";
import "./styles/takeaway-baseline-flow.css";
import "./styles/agent-work-map.css";
import "./styles/topic-system-workbench.css";
import "./styles/clip-lab.css";
import "./styles/client-project-workbench.css";
import "./styles/lanqi-store-profile.css";
import "./styles/lanqi-diagnosis.css";
import "./styles/lanqi-execution-plan.css";
import "./styles/lanqi-content-studio.css";
import "./styles/lanqi-image-studio.css";
import "./styles/lanqi-agent-entry.css";
import "./styles/lanqi-business-qa.css";
import "./styles/beauty-industry.css";
import "./styles/lanqi-moments.css";
import "./styles/beauty-video-review.css";
import "./styles/sitong-design.css";

// 2026-09-11 产品拍板：平台默认浅色主题（此前默认深色）。仅在用户没有
// 主动选择过主题时才用浅色兜底；用户切换过的偏好仍按 localStorage 生效。
const initialTheme = localStorage.getItem("sitong-theme") === "dark" ? "dark" : "light";
document.documentElement.setAttribute("data-theme", initialTheme);
document
  .querySelector('meta[name="theme-color"]')
  ?.setAttribute("content", initialTheme === "dark" ? "#101721" : "#F4F7FC");
/**
 * 设备判定（2026-09-11 真机修复：手机端页面显示不完整）。
 *
 * 此前这里恒写 `"desktop"`，于是 `sitong-design.css` 里
 * `body[data-device="mobile"]` 的整套移动端规则在手机上一条都不生效：
 * 顶栏 Tab 被 flex 挤成 46px 宽的竖排字、顶栏高 222px 顶满首屏，
 * 钱包胶囊溢出到屏幕右侧（QA-20260911-012）。
 *
 * 现在按「视口宽度 + 移动端 UA」判定，并在窗口尺寸变化时重算，
 * 覆盖微信内置浏览器、横竖屏切换和桌面拖窄窗口三种情况。
 */
const MOBILE_MAX_WIDTH = 900;

function resolveDevice(): "mobile" | "desktop" {
  const narrow = window.innerWidth <= MOBILE_MAX_WIDTH;
  const mobileUa = /Android|iPhone|iPad|iPod|Windows Phone|MicroMessenger|Mobile Safari|HarmonyOS/i.test(
    navigator.userAgent
  );
  if (narrow) return "mobile";
  return mobileUa && window.innerWidth <= 1180 ? "mobile" : "desktop";
}

function applyDevice(): void {
  document.body.setAttribute("data-device", resolveDevice());
}

applyDevice();

/**
 * 邀请链接的统一落地（PLAT-38 补充，用户 2026-09-15「以后找客户都用同一个链接」）。
 *
 * 老板对外只发一条链接，形如
 *   `https://api.lcppch.top/os-v2/login?ref=<推荐码>&next=/recharge`
 * 这里在**应用启动最早**的时候把两件事记下来，之后不管用户中间跳到哪一页、
 * 微信授权往返换了几次 webview，都不会丢：
 *   1. `ref` → 暂存推荐码（注册成功后由登录流程提交，归因落库）；
 *   2. `next` → 注册/登录成功后的落地页（例如充值页 `/recharge`）。
 */
try {
  const params = new URLSearchParams(window.location.search);
  const refCode = (params.get("ref") ?? "").trim();
  if (refCode) rememberPendingReferral(refCode);
  const next = (params.get("next") ?? "").trim();
  if (next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/login")) {
    localStorage.setItem("store_os_post_login_redirect", getAppPath(next.split("?")[0]));
  }
} catch {
  // 隐私模式下读不到 URL 参数也不影响主流程。
}
window.addEventListener("resize", applyDevice, { passive: true });
window.addEventListener("orientationchange", applyDevice, { passive: true });

// Pages are isolated at the route boundary so the first visit only downloads
// the active experience instead of every workbench and internal tool.
const StoreGrowthApp = lazy(() => import("./pages/StoreGrowthApp.js").then(module => ({ default: module.StoreGrowthApp })));
const LoginPage = lazy(() => import("./pages/LoginPage.js"));
const WeChatCallback = lazy(() => import("./pages/WeChatCallback.js"));
const WeChatBridgePage = lazy(() => import("./pages/WeChatBridgePage.js"));
const LegalPage = lazy(() => import("./pages/LegalPage.js"));
const NotFoundPage = lazy(() => import("./pages/NotFoundPage.js"));
const KnowledgeBasePage = lazy(() => import("./pages/KnowledgeBasePage.js").then(module => ({ default: module.KnowledgeBasePage })));
const EnterpriseKnowledgeBasePage = lazy(() => import("./pages/EnterpriseKnowledgeBasePage.js").then(module => ({ default: module.EnterpriseKnowledgeBasePage })));
const KnowledgeConnectionHelpPage = lazy(() => import("./pages/KnowledgeConnectionHelpPage.js").then(module => ({ default: module.KnowledgeConnectionHelpPage })));
const ClientProjectWorkbenchPage = lazy(() => import("./pages/ClientProjectWorkbenchPage.js").then(module => ({ default: module.ClientProjectWorkbenchPage })));
const AccountCenterPage = lazy(() => import("./pages/AgentProductsApp.js").then(module => ({ default: module.AccountCenterPage })));
const AgentMarketingPage = lazy(() => import("./pages/AgentProductsApp.js").then(module => ({ default: module.AgentMarketingPage })));
const AgentWorkspacePage = lazy(() => import("./pages/AgentProductsApp.js").then(module => ({ default: module.AgentWorkspacePage })));
const InternalAgentAdminPage = lazy(() => import("./pages/AgentProductsApp.js").then(module => ({ default: module.InternalAgentAdminPage })));
const BeautyIndustryAcquisitionPage = lazy(() => import("./pages/BeautyIndustryAcquisitionPage.js").then(module => ({ default: module.BeautyIndustryAcquisitionPage })));
const BeautyIndustryWorkBuddyPage = lazy(() => import("./pages/BeautyIndustryWorkBuddyPage.js").then(module => ({ default: module.BeautyIndustryWorkBuddyPage })));
const MarketplaceHomePage = lazy(() => import("./pages/MarketplaceApp.js").then(module => ({ default: module.MarketplaceHomePage })));
const MarketplaceAdminPage = lazy(() => import("./pages/MarketplaceApp.js").then(module => ({ default: module.MarketplaceAdminPage })));
const AdminConsolePage = lazy(() => import("./marketplace/AdminConsolePage.js").then(module => ({ default: module.AdminConsolePage })));
const MarketplaceAgentDetailPage = lazy(() => import("./pages/MarketplaceApp.js").then(module => ({ default: module.MarketplaceAgentDetailPage })));
const MarketplaceMinePage = lazy(() => import("./pages/MarketplaceApp.js").then(module => ({ default: module.MarketplaceMinePage })));
const MarketplaceMyAgentsPage = lazy(() => import("./pages/MarketplaceApp.js").then(module => ({ default: module.MarketplaceMyAgentsPage })));
const MarketplaceAgentChatPage = lazy(() => import("./pages/MarketplaceApp.js").then(module => ({ default: module.MarketplaceAgentChatPage })));
const RechargePage = lazy(() => import("./pages/RechargePage.js").then(module => ({ default: module.RechargePage })));

type AppStage = "login" | "diagnosis" | "main";

interface StoredLoginInfo {
  token: string;
  tenantId: string;
  userId: string;
  tenantRole: string;
  tenantName: string;
  planCode: string;
  dataMode: string;
}

class EnterpriseKnowledgeErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Enterprise knowledge base render failed", error, info);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: "#f4f8f5", color: "#173d32" }}>
      <section style={{ width: "min(560px, 100%)", padding: 32, border: "1px solid #d5e2da", borderRadius: 20, background: "#fff", boxShadow: "0 18px 50px rgba(25,73,54,.12)" }}>
        <h1 style={{ margin: "0 0 12px", fontSize: 28 }}>企业知识库暂时没有正确显示</h1>
        <p style={{ margin: "0 0 22px", lineHeight: 1.7, color: "#60776e" }}>页面已拦截异常，没有丢失企业资料。请重新加载；若仍未恢复，可先返回品牌获客工作地图。</p>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <button onClick={() => window.location.reload()} style={{ padding: "11px 18px", border: 0, borderRadius: 10, background: "#176b50", color: "#fff", fontWeight: 700 }}>重新加载</button>
          <button onClick={() => window.location.href = getAppPath("/agents/acquisition")} style={{ padding: "11px 18px", border: "1px solid #bad0c3", borderRadius: 10, background: "#fff", color: "#176b50", fontWeight: 700 }}>返回工作地图</button>
        </div>
      </section>
    </main>;
  }
}

let founderIpLocalE2ESetupStarted = false;

function FounderIpLocalE2EPage() {
  const [message, setMessage] = useState("正在准备创始人 IP 获客页面验收数据…");

  useEffect(() => {
    const localOnly = import.meta.env.DEV && ["localhost", "127.0.0.1"].includes(window.location.hostname);
    if (!localOnly) {
      window.location.replace(getAppPath("/login/founder-ip"));
      return;
    }
    // React StrictMode mounts effects twice in development. This local fixture
    // writes tenant-scoped records, so only one setup flow may run per page load.
    if (founderIpLocalE2ESetupStarted) return;
    founderIpLocalE2ESetupStarted = true;
    void (async () => {
      const scenario = new URLSearchParams(window.location.search).get("scenario") ?? "success";
      const json = async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
        const response = await fetch(apiPath(path), init);
        const data = await response.json().catch(() => ({})) as T & { message?: string };
        if (!response.ok) throw new Error(data.message ?? `本机验收数据准备失败（${response.status}）`);
        return data;
      };
      const login = await json<{ token: string }>("/auth/dev-login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tenantRole: "personal_ip", tenantName: "FIP美业加盟合成验收租户", planCode: "ip_standard", industry: "美业问题肌" }) });
      const headers = { Authorization: `Bearer ${login.token}`, "Content-Type": "application/json" };
      const subjectName = "FIP美业加盟合成验收主体";
      const existingSubjects = await json<{ subjects: Array<{ id: string; name: string }> }>("/knowledge-base/subjects", { headers });
      const existingSubject = existingSubjects.subjects.find((item) => item.name === subjectName);
      const subject = existingSubject
        ? { subject: existingSubject }
        : await json<{ subject: { id: string; name: string } }>("/knowledge-base/subjects", { method: "POST", headers, body: JSON.stringify({ subjectType: "ip", name: subjectName, industry: "美业问题肌" }) });
      const briefs = [
        { target: "franchise", identity: "美业问题肌品牌创始人", targetCustomer: "10万投资预算的美业从业者", acquisitionGoal: "获取加盟咨询", offer: "问题肌加盟条件需在咨询中确认" },
        { target: "store_visit", identity: "美业问题肌门店创始人", targetCustomer: "门店周边有问题肌护理需求的消费者", acquisitionGoal: "预约到店", offer: "问题肌护理团购与到店条件待确认" },
        { target: "student", identity: "皮肤管理培训创始人", targetCustomer: "计划转行的初学者", acquisitionGoal: "获取课程咨询", offer: "课程与试听条件待确认" },
        { target: "partner", identity: "美业问题肌区域联营负责人", targetCustomer: "有本地美业渠道的合作伙伴", acquisitionGoal: "获取合作咨询", offer: "问题肌项目合作资格与投入条件待确认" }
      ];
      for (const brief of briefs) {
        await json("/agents/acquisition/founder-ip-goal-briefs", { method: "PUT", headers, body: JSON.stringify({ subjectId: subject.subject.id, ...brief, accountStage: "稳定更新期", industry: "美业问题肌", benchmarkAccounts: [] }) });
      }
      const selection = { subjectId: subject.subject.id, target: "franchise", topic: "10万预算做问题肌门店，先核对哪三类经营条件", audience: "10万投资预算的美业从业者", sourceEvidence: "本机合成验收数据：美业加盟条件需沟通确认", factBoundary: "案例、数字、价格、政策和收益待核验，不得写成事实", goalRelation: "帮助美业从业者先判断是否值得发起加盟咨询" };
      const draft = await json<{ draft: { id: string } }>("/agents/acquisition/founder-ip-content-drafts", { method: "POST", headers, body: JSON.stringify(selection) });
      if (scenario === "success" || scenario === "foreign") {
        const content = ["# 10万预算做问题肌门店，先核对哪三类经营条件", "目标人群：10万投资预算的美业从业者", "获客目标简报：美业问题肌加盟；获取加盟咨询", "来源依据：本机合成验收数据；真实条件待确认", "与获客目标的关系：帮助美业从业者先判断是否值得发起加盟咨询", "## 开场钩子", "10万预算做问题肌门店，先别急着下结论，先核对客群、服务边界和运营支持。", "## 核心观点", "面向美业问题肌加盟意向人群，案例、数字、价格、政策和收益保持待确认，不把待核验信息写成事实。", "## 承接动作", "如需判断是否适合，请发起加盟咨询并申请条件评估。"].join("\n\n");
        await json(`/agents/acquisition/founder-ip-content-drafts/${encodeURIComponent(draft.draft.id)}`, { method: "PATCH", headers, body: JSON.stringify({ content }) });
      }
      let browserToken = login.token;
      if (scenario === "foreign") {
        const foreign = await json<{ token: string }>("/auth/dev-login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tenantRole: "personal_ip", tenantName: "FIP页面隔离租户", planCode: "ip_standard", industry: "创始人IP获客" }) });
        browserToken = foreign.token;
      }
      Object.keys(sessionStorage)
        .filter((key) => key.startsWith("sitong_agent_") || key.startsWith("sitong_conversation_") || key.startsWith("sitong_trial_"))
        .forEach((key) => sessionStorage.removeItem(key));
      localStorage.setItem("store_os_token", browserToken);
      localStorage.setItem("store_os_tenant_role", "personal_ip");
      localStorage.setItem("store_os_tenant_name", scenario === "foreign" ? "FIP页面隔离租户" : "FIP美业加盟合成验收租户");
      const destination = new URL(getAppPath("/agents/acquisition"), window.location.origin);
      destination.searchParams.set("system", "content_plan");
      destination.searchParams.set("fipDraft", draft.draft.id);
      destination.searchParams.set("fipSubject", subject.subject.id);
      destination.searchParams.set("fipE2eScenario", scenario);
      const apiBase = new URLSearchParams(window.location.search).get("apiBase");
      if (apiBase) destination.searchParams.set("apiBase", apiBase);
      window.location.replace(destination);
    })().catch(error => setMessage(error instanceof Error ? error.message : "本机验收数据准备失败。"));
  }, []);

  return <main className="loginPage"><section className="loginCard"><div className="loginBrand"><span className="loginBadge">创始人 IP 获客 · 本机合成验收数据</span><h1>正在准备页面验收</h1><p>{message}</p></div></section></main>;
}

// 内测实例免登录：第一次进入（本机还没有体验会话）时先建立会话再渲染页面，
// 之后只要有会话就直接渲染，用户点开链接不会看到登录页；生产实例开关关闭，
// 行为不变。
//
// 2026-09-11（QA-20260911-013）：内测实例的侧栏导航是整页跳转（`<a href>`），
// 每次跳转都会重新挂载本组件。以前无论本地有没有会话都先把整页挡成
// 「正在进入体验工作区」，于是用户每点一个功能都会先看到一次中间页。
// 现在本地已有会话时直接渲染页面，会话是否仍然有效放到后台静默校验：
// 校验通过就什么都不做，真失效了才重建会话并让页面刷新一次。
function DirectTestLoginGate({ children }: { children: ReactNode }) {
  const renderedWithStoredSession = useRef(hasDirectTestSession());
  const [state, setState] = useState<"checking" | "ready" | "failed">(
    DIRECT_TEST_LOGIN_ENABLED && !renderedWithStoredSession.current ? "checking" : "ready"
  );
  const [message, setMessage] = useState("正在进入美业智能体体验工作区…");

  useEffect(() => {
    if (!DIRECT_TEST_LOGIN_ENABLED) return;
    let cancelled = false;
    void ensureDirectTestSession()
      .then((created) => {
        if (cancelled) return;
        // 页面已经带着旧会话渲染过了，而这次后台校验发现旧会话不可用并重建了
        // 会话：页面上首批数据请求拿的是旧 token，会 401，所以刷新一次让页面
        // 重新取数。短时间（15s）内最多自动刷新一次，避免会话始终建不起来时
        // 变成刷新死循环。
        if (created && renderedWithStoredSession.current) {
          const key = "store_os_direct_test_session_refresh_at";
          const last = Number(sessionStorage.getItem(key) ?? 0);
          if (!Number.isFinite(last) || Date.now() - last > 15_000) {
            sessionStorage.setItem(key, String(Date.now()));
            window.location.reload();
          }
          return;
        }
        setState("ready");
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        // 已有旧会话时页面已经渲染出来了，不该因为一次后台校验失败把整页换成
        // 错误页；只有本来就没有会话（首屏还在挡着）才提示失败。
        if (renderedWithStoredSession.current) {
          setState("ready");
          return;
        }
        setMessage(cause instanceof Error ? cause.message : "本机体验登录失败。");
        setState("failed");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!DIRECT_TEST_LOGIN_ENABLED || state !== "ready") return;
    const path = getAppRoutePath(window.location.pathname);
    const isEntry = path === "/" || path === "" || path.startsWith("/login");
    if (isEntry) window.location.replace(getAppPath("/lanqi/moments"));
  }, [state]);

  if (state === "ready") return <>{children}</>;

  return (
    <main className="loginPage">
      <section className="loginCard">
        <div className="loginBrand">
          <span className="loginBadge">兰琪美业 · 内测实例</span>
          <h1>{state === "failed" ? "体验入口暂时打不开" : "正在进入体验工作区"}</h1>
          <p>{message}</p>
          {state === "failed" && (
            <button className="loginDemoBtn" type="button" onClick={() => window.location.reload()}>
              重新进入
            </button>
          )}
        </div>
      </section>
    </main>
  );
}

/**
 * 平台登录页的会话前置校验（QA-20260910-018）。
 *
 * 「已登录就不给看登录页」这条规则只有在服务端确认 token 仍然有效时才成立。
 * 以前只看 localStorage 有没有 token，token 一旦失效就会把用户从 /login 弹回
 * 平台首页（`/agents`，旧地址 `/market`），而首页又显示「未登录 · 点击登录」——
 * 点一次弹一次，用户永远进不了登录页。
 *
 * 现在的行为：
 * - token 有效 → 按登录后落地地址跳走（默认平台首页）；
 * - token 失效（401/403）→ 清掉本地会话，正常渲染登录页；
 * - 网络异常（探针 cannot tell）→ 不清 token，也渲染登录页，让用户至少能重新登录。
 */
function LoginSessionGate({ children }: { children: ReactNode }) {
  const path = getAppRoutePath(window.location.pathname);
  const isLoginRoute = path === "/login" || path === "/login/";
  const shouldProbe = !DIRECT_TEST_LOGIN_ENABLED && isLoginRoute && Boolean(readSessionToken());
  const [state, setState] = useState<"probing" | "resolved">(shouldProbe ? "probing" : "resolved");

  useEffect(() => {
    if (!shouldProbe) return;
    let cancelled = false;
    // 用户 2026-09-12：过渡页不能无限停着——最多闪 1500ms，
    // 之后先把登录页渲染出来，会话探针在后台继续跑（有效仍会跳工作台），
    // 这样最坏情况只是闪一下，不会让人对着「正在确认登录状态」干等。
    const splashTimer = window.setTimeout(() => {
      if (!cancelled) setState("resolved");
    }, 1500);
    void probeSession(readSessionToken()).then((result) => {
      if (cancelled) return;
      if (result === "valid") {
        // 页面正在卸载，保持在过渡态避免闪一下登录表单。
        window.location.replace(takePostLoginRedirect("/agents"));
        return;
      }
      if (result === "invalid") clearStoredSession();
      setState("resolved");
    });
    return () => {
      cancelled = true;
      window.clearTimeout(splashTimer);
    };
  }, [shouldProbe]);

  if (state === "resolved") return <>{children}</>;

  return (
    <main className="loginPage">
      <section className="loginCard">
        <div className="loginBrand">
          <span className="loginBadge">思潼 AI</span>
          <h1>正在确认登录状态</h1>
          <p>马上就好；如果这个页面停留超过几秒，请刷新重试。</p>
        </div>
      </section>
    </main>
  );
}

/**
 * 货架 SKU 编码 = `<行业专区>__<能力>`（见 `apps/api/src/services/marketplace-catalog.ts`，
 * 例如 `ipzone__vidrev` / `meiye__copy` / `n__copy`）；工作台智能体 slug
 * （`acquisition`、`clipper`、`takeaway-growth`…）不含双下划线，两套命名不会冲突。
 */
function isMarketplaceSkuCode(slug: string): boolean {
  return slug.includes("__");
}

function Root() {
  const path = getAppRoutePath(window.location.pathname);
  const isDiagnosisRoute = path.startsWith("/diagnosis") || path.startsWith("/d/");
  const isWorkbenchRoute = path.startsWith("/workbench") || path.startsWith("/app");
  const isLoginRoute = path.startsWith("/login");
  const isWechatCallbackRoute = path.startsWith("/wechat-callback");
  // 电脑端扫码登录：手机扫到二维码后落到本站的中转页（PLAT-13）。
  const isWechatBridgeRoute = path.startsWith("/wechat-bridge");
  const marketingMatch = path.match(/^\/p\/([a-z0-9_-]+)\/?$/i);
  const agentMatch = path.match(/^\/agents\/([a-z0-9_-]+)\/?$/i);
  const marketplaceChatMatch = path.match(/^\/agent\/([a-z0-9_-]+)\/chat\/?$/i);
  const marketplaceAgentMatch = path.match(/^\/agent\/([a-z0-9_-]+)\/?$/i);

  // 平台首页是唯一入口：根路径直接落到平台首页，不再进入旧的单品落地页。
  // 2026-09-11 起平台首页地址为 `/agents`（产品叫「智能体平台」，URL 不再用 market）。
  if (path === "/" || path === "") {
    window.location.replace(getAppPath("/agents"));
    return null;
  }

  // 注意：不要再在这里按「localStorage 里有 token」把 /login 弹回货架。
  // 那是登录死循环的成因（QA-20260910-018），判断已移到 LoginSessionGate，
  // 由服务端探针决定去留。

  // Brand acquisition uses a dedicated, full-page knowledge base. Keep this
  // route separate from the legacy global /knowledge-base manager so a work
  // map node can never fall back to the old page or an in-agent drawer.
  if (path.startsWith("/agents/acquisition/enterprise-knowledge-base/connection-help")) {
    return <KnowledgeConnectionHelpPage />;
  }
  if (path.startsWith("/agents/acquisition/enterprise-knowledge-base")) {
    return <EnterpriseKnowledgeErrorBoundary><EnterpriseKnowledgeBasePage /></EnterpriseKnowledgeErrorBoundary>;
  }

  if (path === "/terms" || path === "/terms/") {
    return <LegalPage kind="terms" />;
  }

  if (path === "/privacy" || path === "/privacy/") {
    return <LegalPage kind="privacy" />;
  }

  if (marketingMatch) {
    return <AgentMarketingPage slug={marketingMatch[1]} />;
  }

  if (marketplaceChatMatch) {
    return <MarketplaceAgentChatPage skuId={marketplaceChatMatch[1]} />;
  }

  if (marketplaceAgentMatch) {
    return <MarketplaceAgentDetailPage skuId={marketplaceAgentMatch[1]} />;
  }

  if (path === "/mine" || path.startsWith("/mine/")) {
    return <MarketplaceMinePage />;
  }

  /**
   * 「常用智能体」独立页（用户 2026-09-16）。放在 `/mine` 之后判定，两条路径互不影响；
   * 页面只列这个账号**真的用过**的智能体，见 `marketplace/MyAgentsPage.tsx`。
   */
  if (path === "/my-agents" || path === "/my-agents/") {
    return <MarketplaceMyAgentsPage />;
  }

  /*
   * 平台首页（智能体平台入口）：`/agents`。
   *
   * 2026-09-11 由 `/market` 更名——产品对外叫「思潼AI 智能体平台」，入口地址不该再出现
   * market（旧地址按下方兼容分支 1:1 跳转，已发出去的链接不会 404）。
   * `/agents` 是**精确匹配**：这里只是和 `/agents/:slug`（单品落地页）共用命名空间，
   * 不接管 `/agents/beauty-industry`、`/agents/acquisition` 等既有页面。
   */
  if (path === "/agents/admin" || path.startsWith("/agents/admin/")) {
    // PLAT-35：`/agents/admin` 换成统一后台（侧边导航：概览 / 客户 / 订单与收款 / 积分干预 /
    // 智能体与货架 / 推荐归因 / 质量与安全）。旧页面保留在 `/agents/admin/legacy`，
    // 它的「推荐有礼配置位」可写编辑不在新后台里重复造。
    if (path === "/agents/admin/legacy" || path === "/agents/admin/legacy/") {
      return <MarketplaceAdminPage />;
    }
    return <AdminConsolePage />;
  }

  if (path === "/agents" || path === "/agents/") {
    return <MarketplaceHomePage />;
  }

  if (path === "/agents/beauty-industry/workbuddy" || path === "/agents/beauty-industry/workbuddy/") {
    return <BeautyIndustryWorkBuddyPage />;
  }

  if (path === "/agents/beauty-industry" || path === "/agents/beauty-industry/" || path.startsWith("/agents/beauty-industry/")) {
    return <BeautyIndustryAcquisitionPage />;
  }

  /*
   * 货架 SKU 的落地链接：`/agents/<zone>__<capability>`（例如 `/agents/ipzone__vidrev`）。
   *
   * `/agents` 是平台首页，`/agent/<skuCode>` 是货架详情页，两者共用同一套 SKU 编码；
   * 对外发出去的验收/分享链接两种写法都会出现。SKU 编码不是工作台智能体 slug，
   * 落进工作台页会在 `/api/agents/me` 里找不到，被兜底成「服务暂时不可用」（QA-20260911-015），
   * 把「智能体还没上线 / 链接写法不对」说成了服务故障。这里显式归到货架命名空间。
   */
  if (agentMatch && isMarketplaceSkuCode(agentMatch[1])) {
    return <MarketplaceAgentDetailPage skuId={agentMatch[1]} />;
  }

  if (agentMatch) {
    return <AgentWorkspacePage slug={agentMatch[1]} />;
  }

  /**
   * 2026-09-15 用户口径：旧「专业工作地图」工作台（/my-ai，含 CEO 驾驶舱 / 外卖 / 餐饮等历史智能体）
   * **已下线**。这条地址不再渲染历史页面，统一跳到新的智能体平台货架 `/agents`，
   * 这样老链接不会 404，也不会再有人误入历史页面。
   */
  if (path.startsWith("/my-ai")) {
    window.location.replace(takePostLoginRedirect("/agents"));
    return null;
  }

  const lanqiRoute = renderLanqiRoutes(path);
  if (isLanqiHandled(lanqiRoute)) return null;
  if (lanqiRoute !== null) return lanqiRoute;

  if (path === "/fip/e2e/local" || path === "/fip/e2e/local/") {
    return <FounderIpLocalE2EPage />;
  }

  if (path.startsWith("/enterprise-knowledge-base/connection-help")) {
    return <KnowledgeConnectionHelpPage />;
  }
  if (path.startsWith("/enterprise-knowledge-base")) {
    return <EnterpriseKnowledgeErrorBoundary><EnterpriseKnowledgeBasePage /></EnterpriseKnowledgeErrorBoundary>;
  }

  if (path.startsWith("/knowledge-base")) {
    return <KnowledgeBasePage />;
  }

  if (path.startsWith("/account")) {
    return <AccountCenterPage />;
  }

  if (path.startsWith("/recharge")) {
    return <RechargePage />;
  }

  /*
   * 旧平台首页地址兼容（2026-09-11 更名 `/market` → `/agents`）。
   *
   * 「market」已经不合适：产品叫智能体平台，入口不该读成市场/货架。但更名前发出去、
   * 印在物料上、被客户收藏的 `/os-v2/market*` 链接必须继续能用，所以这里按**同后缀**
   * 跳到新地址（`/market` → `/agents`、`/market/admin` → `/agents/admin`），
   * 而不是笼统地全塞回首页。
   */
  if (path === "/market" || path.startsWith("/market/")) {
    window.location.replace(getAppPath(`/agents${path.slice("/market".length)}`));
    return null;
  }

  if (path.startsWith("/internal/legacy")) {
    return <InternalLegacyGate />;
  }

  if (path.startsWith("/internal/projects")) {
    return <ClientProjectWorkbenchPage />;
  }

  if (path === "/internal/onboarding" || path === "/internal/onboarding/") {
    return <AppFlow />;
  }

  if (path.startsWith("/internal")) {
    return <InternalAgentAdminPage />;
  }

  /**
   * 旧版「9 轮经营诊断」已下线（2026-09-13 用户要求清除）。
   *
   * 它是单点登录时代的上手流程，现在平台的主线是「登录 → 货架」，这套诊断既不再引导用户，
   * 又会在用户带 token 打开任意网址时把页面顶掉（见 AppFlow 里被删掉的状态分支）。
   * 这里把老链接统一重定向到货架，避免老书签落进 404 或旧页面。
   */
  if (isDiagnosisRoute) {
    window.location.replace(getAppPath("/agents"));
    return null;
  }

  /**
   * 旧工作台地址（`/workbench`、`/app`）→ 货架。
   *
   * 2026-09-15 用户口径：旧「专业工作地图」工作台已下线，`/my-ai` 自身也跳货架；
   * 这两个老地址直接跳货架，不再走「/workbench → /my-ai → /agents」两跳。
   */
  if (isWorkbenchRoute) {
    window.location.replace(takePostLoginRedirect("/agents"));
    return null;
  }

  if (isLoginRoute || isWechatCallbackRoute || isWechatBridgeRoute) {
    return <AppFlow />;
  }

  /*
   * 未知网址统一兜底（PLAT-18 验收条件 2）。
   *
   * 这里以前直接渲染 `<AgentHomePage />`：输错网址、访问已下线的历史地址
   * （`/legacy-diagnosis`、`/v4-preview`、`/industry-prototype`、`/clip-lab`）
   * 都会显示「外卖增长智能体」的首页，用户会以为打开的正是那个产品。
   * 现在统一落到「页面不存在 / 已下线」说明页：不显示任何具体产品的内容。
   */
  return <NotFoundPage />;
}

function AppFlow() {
  const path = getAppRoutePath(window.location.pathname);
  const loginEntry: LoginEntry = path.startsWith("/login/founder-ip") ? "founder-ip"
    : path.startsWith("/login/takeaway") ? "takeaway"
    : path.startsWith("/login/lanqi") ? "lanqi"
    : path.startsWith("/login/beauty-industry") ? "beauty-industry"
    : path.startsWith("/internal/onboarding") ? "internal"
    : "generic";
  const [stage, setStage] = useState<AppStage>(() => {
    // A product-specific URL must never be captured by a stale generic
    // diagnosis state from a previous account or another product.
    if (loginEntry !== "generic" && loginEntry !== "internal") return "login";
    /**
     * 2026-09-13（用户要求清除旧诊断页）：这里以前是
     * `token && diagnosisDone ? "main" : token ? "diagnosis" : "login"`——
     * 只要浏览器里有 token、而 `store_os_diagnosis_done` 不是 "true"，
     * **打开任意网址都会被顶进旧版 9 轮诊断页**（用户的现场：复制已登录网址新开标签页 → 见到旧诊断页）。
     * 现在：有 token 直接进主界面（货架/工作台），不再有诊断阶段。
     */
    const token = localStorage.getItem("store_os_token");
    if (token) return "main";
    return "login";
  });

  const [loginInfo, setLoginInfo] = useState<StoredLoginInfo>(() => {
    const token = localStorage.getItem("store_os_token") ?? "";
    return {
      token,
      tenantId: "",
      userId: "",
      tenantRole: localStorage.getItem("store_os_tenant_role") ?? "local_business",
      tenantName: localStorage.getItem("store_os_tenant_name") ?? "",
      planCode: "local_standard",
      dataMode: "demo"
    };
  });

  const [diagnosisReport, setDiagnosisReport] = useState(() => {
    try {
      const raw = localStorage.getItem("store_os_diagnosis_report");
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });

  function handleLogin(result: LoginResult) {
    localStorage.setItem("store_os_tenant_role", result.tenantRole);
    localStorage.setItem("store_os_tenant_name", result.tenantName);

    setLoginInfo({
      token: result.token,
      tenantId: result.tenantId,
      userId: result.userId,
      tenantRole: result.tenantRole,
      tenantName: result.tenantName,
      planCode: result.planCode,
      dataMode: result.dataMode
    });

    // 一次性消费安全回跳地址：有深链就回深链，没有就按登录入口决定默认落地页。
    const redirect = takePostLoginRedirect();
    if (redirect) {
      window.location.href = redirect;
      return;
    }
    const productDefaultPath = loginEntry !== "generic" && loginEntry !== "internal"
      ? PRODUCT_LOGIN_DEFINITIONS[loginEntry].defaultPath
      : "/agents";
    const isLocalDev =
      import.meta.env.DEV &&
      ["localhost", "127.0.0.1"].includes(window.location.hostname);
    const brainEntry =
      (isLocalDev || import.meta.env.VITE_DIRECT_TEST_LOGIN === "true") && (loginEntry === "beauty-industry" || loginEntry === "lanqi")
        ? "/lanqi/moments"
        : productDefaultPath;
    window.location.href = getAppPath(brainEntry);
  }

  function handleDiagnosisComplete(report: unknown, selectedPlan: string) {
    setDiagnosisReport(report);
    setLoginInfo(prev => ({ ...prev, planCode: selectedPlan }));
    setStage("main");
  }

  // 旧版诊断已下线（2026-09-13）：重新诊断的入口与状态一并移除。

  function handleLogout() {
    localStorage.removeItem("store_os_token");
    localStorage.removeItem("store_os_onboarding_token");
    localStorage.removeItem("store_os_tenant_role");
    localStorage.removeItem("store_os_tenant_name");
    localStorage.removeItem("store_os_diagnosis_done");
    localStorage.removeItem("store_os_diagnosis_report");
    setStage("login");
  }

  if (path === "/wechat-callback") {
    return <WeChatCallback onLogin={handleLogin} />;
  }

  if (path === "/wechat-bridge") {
    return <WeChatBridgePage />;
  }

  if (stage === "login") {
    return <LoginPage mode={import.meta.env.PROD ? "production" : "dev"} entry={loginEntry} onLogin={handleLogin} />;
  }

  // 旧版诊断阶段与旧工作台都已下线（2026-09-13 / 2026-09-15）：兜底统一回智能体平台货架。
  window.location.replace(takePostLoginRedirect("/agents"));
  return null;
}

function DiagnosisAwareApp({
  loginInfo,
  diagnosisReport,
  onReDiagnosis,
  onLogout
}: {
  loginInfo: StoredLoginInfo;
  diagnosisReport: unknown;
  onReDiagnosis: () => void;
  onLogout: () => void;
}) {
  const [showPostDiagnosis, setShowPostDiagnosis] = useState(() => !localStorage.getItem("store_os_diagnosis_confirmed"));

  function confirmDiagnosis() {
    localStorage.setItem("store_os_diagnosis_confirmed", "true");
    setShowPostDiagnosis(false);
  }

  if (showPostDiagnosis && diagnosisReport) {
    const report = diagnosisReport as Record<string, unknown>;
    const roadmap = (report.roadmap as Array<Record<string, unknown>>) ?? [];
    const recommendedPlan = (report.recommendedPlan as string) ?? "local_standard";

    return (
      <div className="diagnosisPage">
        <div className="diagnosisCard reportCard">
          <span className="diagnosisBadge">诊断完成</span>
          <h1>诊断结果已保存</h1>

          <div className="reportSummary">
            <h3>现状总结</h3>
            <p>{(report.summary as string) ?? ""}</p>
          </div>

          <div className="reportPlanCard">
            <h3>推荐版本</h3>
            <div className="planRecCard">
              <strong>{formatPlanLabel(recommendedPlan)}</strong>
              <p>{(report.recommendReason as string) ?? "根据你的经营阶段和核心问题匹配"}</p>
            </div>
          </div>

          {roadmap.length > 0 && (
            <div className="reportSection">
              <h3>落地路线图</h3>
              {roadmap.map((phase, i) => (
                <div key={i} className="roadmapPhase">
                  <strong>{phase.phase as string}</strong>
                  <ul>
                    {((phase.actions as string[]) ?? []).map((action, j) => (
                      <li key={j}>{action}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}

          <div className="reportActions">
            <button className="reportConfirmBtn" onClick={confirmDiagnosis}>
              进入思潼AI 行业智能体平台 →
            </button>
            <button className="reportBackBtn" onClick={onReDiagnosis}>
              重新诊断
            </button>
          </div>
        </div>
      </div>
    );
  }

  return <StoreGrowthApp />;
}

function InternalLegacyGate() {
  const [token, setToken] = useState(() => localStorage.getItem("sitong_admin_token") ?? "");
  const [authorized, setAuthorized] = useState(false);
  const [error, setError] = useState("");

  async function verifyAdmin() {
    setError("");
    const response = await fetch(apiPath("/admin/agents"), {
      headers: { "x-sitong-admin-token": token }
    });
    if (!response.ok) {
      setAuthorized(false);
      setError("管理员凭证无效，旧工作台仅供思潼内部使用。");
      return;
    }
    localStorage.setItem("sitong_admin_token", token);
    setAuthorized(true);
  }

  if (authorized) {
    return (
      <>
        <div className="internalLegacyBanner">
          <strong>思潼内部旧工作台</strong>
          <button onClick={() => window.location.assign(getAppPath("/internal"))}>返回 Agent 控制台</button>
        </div>
        <StoreGrowthApp />
      </>
    );
  }

  return (
    <main className="agentProductPage internalPage">
      <section className="adminLogin internalLegacyLogin">
        <h1>内部工作台验证</h1>
        <p>该页面不对普通客户开放。</p>
        <input type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder="ADMIN_TOKEN" />
        <button className="primaryButton" onClick={() => void verifyAdmin()}>验证并进入</button>
        {error && <p className="agentError">{error}</p>}
      </section>
    </main>
  );
}

function formatPlanLabel(code: string): string {
  const map: Record<string, string> = {
    local_standard: "本地商家标准版",
    local_premium: "本地商家高级版",
    ip_standard: "个人IP标准版",
    ip_premium: "个人IP高级版",
    chain_standard: "连锁品牌标准版",
    chain_premium: "连锁品牌高级版"
  };
  return map[code] ?? code;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Suspense fallback={<main className="agentProductPage" aria-busy="true" />}>
      <DirectTestLoginGate>
        <LoginSessionGate>
          <Root />
        </LoginSessionGate>
      </DirectTestLoginGate>
    </Suspense>
  </React.StrictMode>
);

import React, { Component, lazy, Suspense, useState, useEffect, type ErrorInfo, type ReactNode } from "react";
import ReactDOM from "react-dom/client";
import type { LoginEntry, LoginResult } from "./pages/LoginPage.js";
import { PRODUCT_LOGIN_DEFINITIONS } from "@baolu/shared";
import { apiPath, getAppPath, getAppRoutePath } from "./lib/api.js";
import { DIRECT_TEST_LOGIN_ENABLED, ensureDirectTestSession } from "./lib/direct-test-session.js";
import { clearStoredSession, probeSession, readSessionToken, takePostLoginRedirect } from "./lib/session.js";
import "./styles/app.css";
import "./styles/store-growth.css";
import "./styles/baolu-diagnosis.css";
import "./styles/sitong-v4.css";
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
import "./styles/industry-workbench-prototype.css";
import "./styles/sitong-design.css";

document.documentElement.setAttribute(
  "data-theme",
  localStorage.getItem("sitong-theme") || "dark"
);
document.body.setAttribute("data-device", "desktop");

// Pages are isolated at the route boundary so the first visit only downloads
// the active experience instead of every workbench and internal tool.
const StoreGrowthApp = lazy(() => import("./pages/StoreGrowthApp.js").then(module => ({ default: module.StoreGrowthApp })));
const FlywheelDiagnosisApp = lazy(() => import("./pages/FlywheelDiagnosisApp.js"));
const SitongV4App = lazy(() => import("./pages/SitongV4App.js").then(module => ({ default: module.SitongV4App })));
const BaoluDiagnosisApp = lazy(() => import("./pages/BaoluDiagnosisApp.js"));
const LoginPage = lazy(() => import("./pages/LoginPage.js"));
const WeChatCallback = lazy(() => import("./pages/WeChatCallback.js"));
const LegalPage = lazy(() => import("./pages/LegalPage.js"));
const ClipLabApp = lazy(() => import("./pages/ClipLabApp.js"));
const KnowledgeBasePage = lazy(() => import("./pages/KnowledgeBasePage.js").then(module => ({ default: module.KnowledgeBasePage })));
const EnterpriseKnowledgeBasePage = lazy(() => import("./pages/EnterpriseKnowledgeBasePage.js").then(module => ({ default: module.EnterpriseKnowledgeBasePage })));
const KnowledgeConnectionHelpPage = lazy(() => import("./pages/KnowledgeConnectionHelpPage.js").then(module => ({ default: module.KnowledgeConnectionHelpPage })));
const ClientProjectWorkbenchPage = lazy(() => import("./pages/ClientProjectWorkbenchPage.js").then(module => ({ default: module.ClientProjectWorkbenchPage })));
const AccountCenterPage = lazy(() => import("./pages/AgentProductsApp.js").then(module => ({ default: module.AccountCenterPage })));
const AgentHomePage = lazy(() => import("./pages/AgentProductsApp.js").then(module => ({ default: module.AgentHomePage })));
const AgentMarketingPage = lazy(() => import("./pages/AgentProductsApp.js").then(module => ({ default: module.AgentMarketingPage })));
const AgentWorkspacePage = lazy(() => import("./pages/AgentProductsApp.js").then(module => ({ default: module.AgentWorkspacePage })));
const InternalAgentAdminPage = lazy(() => import("./pages/AgentProductsApp.js").then(module => ({ default: module.InternalAgentAdminPage })));
const MyAiPage = lazy(() => import("./pages/AgentProductsApp.js").then(module => ({ default: module.MyAiPage })));
const LanqiStoreProfilePage = lazy(() => import("./pages/LanqiStoreProfilePage.js").then(module => ({ default: module.LanqiStoreProfilePage })));
const LanqiDiagnosisPage = lazy(() => import("./pages/LanqiDiagnosisPage.js").then(module => ({ default: module.LanqiDiagnosisPage })));
const LanqiExecutionPlanPage = lazy(() => import("./pages/LanqiExecutionPlanPage.js").then(module => ({ default: module.LanqiExecutionPlanPage })));
const LanqiContentStudioPage = lazy(() => import("./pages/LanqiContentStudioPage.js").then(module => ({ default: module.LanqiContentStudioPage })));
const LanqiImageStudioPage = lazy(() => import("./pages/LanqiImageStudioPage.js").then(module => ({ default: module.LanqiImageStudioPage })));
const LanqiBusinessQaPage = lazy(() => import("./pages/LanqiBusinessQaPage.js").then(module => ({ default: module.LanqiBusinessQaPage })));
const LanqiMomentsPage = lazy(() => import("./pages/LanqiMomentsPage.js").then(module => ({ default: module.LanqiMomentsPage })));
const LanqiBrainHomePage = lazy(() => import("./pages/LanqiBrainHomePage.js").then(module => ({ default: module.LanqiBrainHomePage })));
const LanqiMomentsHomePage = lazy(() => import("./pages/LanqiMomentsHomePage.js").then(module => ({ default: module.LanqiMomentsHomePage })));
const LanqiAcquireHomePage = lazy(() => import("./pages/LanqiAcquireHomePage.js").then(module => ({ default: module.LanqiAcquireHomePage })));
const LanqiAcquireCopywriterPage = lazy(() => import("./pages/LanqiAcquireCopywriterPage.js").then(module => ({ default: module.LanqiAcquireCopywriterPage })));
const LanqiAcquireMethodsPage = lazy(() => import("./pages/LanqiAcquireMethodsPage.js").then(module => ({ default: module.LanqiAcquireMethodsPage })));
const LanqiAcquireLivePage = lazy(() => import("./pages/LanqiAcquireLivePage.js").then(module => ({ default: module.LanqiAcquireLivePage })));
const LanqiAcquireVideoPage = lazy(() => import("./pages/LanqiAcquireVideoPage.js").then(module => ({ default: module.LanqiAcquireVideoPage })));
const LanqiMomentsWechatGroupPage = lazy(() => import("./pages/LanqiMomentsWechatGroupPage.js").then(module => ({ default: module.LanqiMomentsWechatGroupPage })));
const LanqiDashboardPage = lazy(() => import("./pages/LanqiDashboardPage.js").then(module => ({ default: module.LanqiDashboardPage })));
const LanqiGoalSettingPage = lazy(() => import("./pages/LanqiGoalSettingPage.js").then(module => ({ default: module.LanqiGoalSettingPage })));
const LanqiCasesPage = lazy(() => import("./pages/LanqiPlaceholderPage.js").then(module => ({ default: module.LanqiCasesPage })));
const LanqiCustomersPage = lazy(() => import("./pages/LanqiPlaceholderPage.js").then(module => ({ default: module.LanqiCustomersPage })));
const LanqiAnalysisPage = lazy(() => import("./pages/LanqiPlaceholderPage.js").then(module => ({ default: module.LanqiAnalysisPage })));
const LanqiSalesSimPage = lazy(() => import("./pages/LanqiPlaceholderPage.js").then(module => ({ default: module.LanqiSalesSimPage })));
const LanqiStoreAdminPage = lazy(() => import("./pages/LanqiPlaceholderPage.js").then(module => ({ default: module.LanqiStoreAdminPage })));
const BeautyIndustryAcquisitionPage = lazy(() => import("./pages/BeautyIndustryAcquisitionPage.js").then(module => ({ default: module.BeautyIndustryAcquisitionPage })));
const BeautyIndustryWorkBuddyPage = lazy(() => import("./pages/BeautyIndustryWorkBuddyPage.js").then(module => ({ default: module.BeautyIndustryWorkBuddyPage })));
const IndustryWorkbenchPrototypePage = lazy(() => import("./pages/IndustryWorkbenchPrototypePage.js").then(module => ({ default: module.IndustryWorkbenchPrototypePage })));
const MarketplaceHomePage = lazy(() => import("./pages/MarketplaceApp.js").then(module => ({ default: module.MarketplaceHomePage })));
const MarketplaceAdminPage = lazy(() => import("./pages/MarketplaceApp.js").then(module => ({ default: module.MarketplaceAdminPage })));
const MarketplaceAgentDetailPage = lazy(() => import("./pages/MarketplaceApp.js").then(module => ({ default: module.MarketplaceAgentDetailPage })));
const MarketplaceMinePage = lazy(() => import("./pages/MarketplaceApp.js").then(module => ({ default: module.MarketplaceMinePage })));
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
        localStorage.setItem("store_os_diagnosis_done", "false");
        window.location.replace(getAppPath("/lanqi/content-studio"));
      } catch (cause) {
        if (!cancelled) setMessage(cause instanceof Error ? cause.message : "本机体验登录失败，请确认本地 API 正在运行。");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return <main className="loginPage"><section className="loginCard"><div className="loginBrand"><span className="loginBadge">兰琪美业 · 本机专用</span><h1>正在进入体验工作区</h1><p>{message}</p></div></section></main>;
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

// 内测实例免登录：开关打开时先建立体验会话，再渲染页面，
// 用户点开链接不会看到登录页；生产实例开关关闭，行为不变。
function DirectTestLoginGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<"checking" | "ready" | "failed">(
    DIRECT_TEST_LOGIN_ENABLED ? "checking" : "ready"
  );
  const [message, setMessage] = useState("正在进入美业智能体体验工作区…");

  useEffect(() => {
    if (!DIRECT_TEST_LOGIN_ENABLED) return;
    let cancelled = false;
    void ensureDirectTestSession()
      .then(() => {
        if (!cancelled) setState("ready");
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
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
    if (isEntry) window.location.replace(getAppPath("/lanqi/dashboard"));
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
 * /market，而货架又显示「未登录 · 点击登录」——点一次弹一次，用户永远进不了登录页。
 *
 * 现在的行为：
 * - token 有效 → 按登录后落地地址跳走（默认货架）；
 * - token 失效（401/403）→ 清掉本地会话，正常渲染登录页；
 * - 网络异常（探针 cannot tell）→ 不清 token，也渲染登录页，让用户至少能重新登录。
 */
function LoginSessionGate({ children }: { children: ReactNode }) {
  const path = getAppRoutePath(window.location.pathname);
  const isLoginRoute = path === "/login" || path === "/login/";
  const shouldProbe = !DIRECT_TEST_LOGIN_ENABLED && isLoginRoute && Boolean(readSessionToken());
  const [state, setState] = useState<"probing" | "resolved">(shouldProbe ? "probing" : "resolved");

  useEffect(() => {
    if (state !== "probing") return;
    let cancelled = false;
    void probeSession(readSessionToken()).then((result) => {
      if (cancelled) return;
      if (result === "valid") {
        // 页面正在卸载，保持在过渡态避免闪一下登录表单。
        window.location.replace(takePostLoginRedirect("/market"));
        return;
      }
      if (result === "invalid") clearStoredSession();
      setState("resolved");
    });
    return () => {
      cancelled = true;
    };
  }, [state]);

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

function Root() {
  const path = getAppRoutePath(window.location.pathname);
  const isDiagnosisRoute = path.startsWith("/diagnosis") || path.startsWith("/d/");
  const isLegacyDiagnosisRoute = path.startsWith("/legacy-diagnosis");
  const isWorkbenchRoute = path.startsWith("/workbench") || path.startsWith("/app");
  const isLoginRoute = path.startsWith("/login");
  const isWechatCallbackRoute = path.startsWith("/wechat-callback");
  const isV4PreviewRoute = path.startsWith("/v4-preview");
  const marketingMatch = path.match(/^\/p\/([a-z0-9_-]+)\/?$/i);
  const agentMatch = path.match(/^\/agents\/([a-z0-9_-]+)\/?$/i);
  const marketplaceChatMatch = path.match(/^\/agent\/([a-z0-9_-]+)\/chat\/?$/i);
  const marketplaceAgentMatch = path.match(/^\/agent\/([a-z0-9_-]+)\/?$/i);

  // 平台首页（货架）是唯一入口：根路径直接落到货架，不再进入旧的单品落地页。
  if (path === "/" || path === "") {
    window.location.replace(getAppPath("/market"));
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

  if (path.startsWith("/clip-lab")) {
    if (import.meta.env.PROD) {
      window.location.replace(getAppPath("/agents/clipper"));
      return null;
    }
    return <ClipLabApp />;
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

  if (path === "/industry-prototype" || path.startsWith("/industry-prototype/")) {
    return <IndustryWorkbenchPrototypePage />;
  }

  if (path === "/agents/beauty-industry/workbuddy" || path === "/agents/beauty-industry/workbuddy/") {
    return <BeautyIndustryWorkBuddyPage />;
  }

  if (path === "/agents/beauty-industry" || path === "/agents/beauty-industry/" || path.startsWith("/agents/beauty-industry/")) {
    return <BeautyIndustryAcquisitionPage />;
  }

  if (agentMatch) {
    return <AgentWorkspacePage slug={agentMatch[1]} />;
  }

  if (path.startsWith("/my-ai")) {
    return <MyAiPage />;
  }

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
    return null;
  }

  if (path === "/lanqi/local" || path === "/lanqi/local/") {
    return <LanqiLocalAccessPage />;
  }

  // 兰琪工作台入口：`/lanqi` 与 `/lanqi/`（demo 的 home.html 对应地址）直达 0909
  // 经营驾驶舱（不是八板块卡片墙，也不再落进旧的「美业智能体」单品页
  // `/agents/beauty-industry`）。八板块总览仍在 `/lanqi/brain`。
  if (path === "/lanqi" || path === "/lanqi/") {
    window.location.replace(getAppPath("/lanqi/dashboard"));
    return null;
  }

  if (path === "/lanqi/brain" || path === "/lanqi/brain/") {
    return <LanqiBrainHomePage />;
  }

  if (path === "/fip/e2e/local" || path === "/fip/e2e/local/") {
    return <FounderIpLocalE2EPage />;
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
   * 必须放在全局兜底 `AgentHomePage` 之前，否则会掉进外卖增长智能体的首页（报告 Bug2）。
   */
  if (path === "/lanqi/dashboard" || path === "/lanqi/dashboard/") {
    return <LanqiDashboardPage />;
  }
  if (path.startsWith("/lanqi/goal-setting")) {
    return <LanqiGoalSettingPage />;
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

  if (path.startsWith("/market/admin")) {
    return <MarketplaceAdminPage />;
  }

  if (path.startsWith("/market")) {
    return <MarketplaceHomePage />;
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

  if (isLegacyDiagnosisRoute) {
    return <BaoluDiagnosisApp />;
  }

  // /diagnosis or /d/ → always standalone diagnosis (free entry, no login)
  if (isDiagnosisRoute) {
    return <FlywheelDiagnosisApp />;
  }

  if (isV4PreviewRoute) {
    return <SitongV4App />;
  }

  if (isWorkbenchRoute) {
    window.location.replace(getAppPath("/my-ai"));
    return null;
  }

  if (isLoginRoute || isWechatCallbackRoute) {
    return <AppFlow />;
  }

  return <AgentHomePage />;
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
    const token = localStorage.getItem("store_os_token");
    const diagnosisDone = localStorage.getItem("store_os_diagnosis_done") === "true";
    if (token && diagnosisDone) return "main";
    if (token && !diagnosisDone) return "diagnosis";
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
    localStorage.setItem("store_os_diagnosis_done", "false");

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
      : "/market";
    const isLocalDev =
      import.meta.env.DEV &&
      ["localhost", "127.0.0.1"].includes(window.location.hostname);
    const brainEntry =
      (isLocalDev || import.meta.env.VITE_DIRECT_TEST_LOGIN === "true") && (loginEntry === "beauty-industry" || loginEntry === "lanqi")
        ? "/lanqi/dashboard"
        : productDefaultPath;
    window.location.href = getAppPath(brainEntry);
  }

  function handleDiagnosisComplete(report: unknown, selectedPlan: string) {
    setDiagnosisReport(report);
    setLoginInfo(prev => ({ ...prev, planCode: selectedPlan }));
    setStage("main");
  }

  function handleReDiagnosis() {
    localStorage.setItem("store_os_diagnosis_done", "false");
    setStage("diagnosis");
  }

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

    if (stage === "login") {
    return <LoginPage mode={import.meta.env.PROD ? "production" : "dev"} entry={loginEntry} onLogin={handleLogin} />;
  }

  if (stage === "diagnosis") {
    return <FlywheelDiagnosisApp />;
  }

  return <MyAiPage />;
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

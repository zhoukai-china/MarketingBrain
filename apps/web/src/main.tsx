import React, { Component, lazy, Suspense, useState, useEffect, type ErrorInfo, type ReactNode } from "react";
import ReactDOM from "react-dom/client";
import type { LoginResult } from "./pages/LoginPage.js";
import { apiPath, getAppPath } from "./lib/api.js";
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

const postLoginRedirectKey = "store_os_post_login_redirect";

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

function takePostLoginRedirect(): string | null {
  const redirect = localStorage.getItem(postLoginRedirectKey);
  localStorage.removeItem(postLoginRedirectKey);
  if (!redirect || !redirect.startsWith("/") || redirect.startsWith("//")) return null;
  return redirect;
}

function Root() {
  const rawPath = window.location.pathname;
  const path = rawPath.startsWith("/os-v2") ? rawPath.slice("/os-v2".length) || "/" : rawPath;
  const isDiagnosisRoute = path.startsWith("/diagnosis") || path.startsWith("/d/");
  const isLegacyDiagnosisRoute = path.startsWith("/legacy-diagnosis");
  const isWorkbenchRoute = path.startsWith("/workbench") || path.startsWith("/app");
  const isLoginRoute = path.startsWith("/login");
  const isWechatCallbackRoute = path.startsWith("/wechat-callback");
  const isV4PreviewRoute = path.startsWith("/v4-preview");
  const marketingMatch = path.match(/^\/p\/([a-z0-9_-]+)\/?$/i);
  const agentMatch = path.match(/^\/agents\/([a-z0-9_-]+)\/?$/i);

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

  if (agentMatch) {
    return <AgentWorkspacePage slug={agentMatch[1]} />;
  }

  if (path.startsWith("/my-ai")) {
    return <MyAiPage />;
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

  if (path.startsWith("/internal/legacy")) {
    return <InternalLegacyGate />;
  }

  if (path.startsWith("/internal/projects")) {
    return <ClientProjectWorkbenchPage />;
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
  const [stage, setStage] = useState<AppStage>(() => {
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

    const redirect = takePostLoginRedirect();
    if (redirect) {
      window.location.href = redirect;
      return;
    }
    window.location.href = getAppPath("/my-ai");
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


  const rawPath = window.location.pathname;
  const path = rawPath.startsWith("/os-v2") ? rawPath.slice("/os-v2".length) || "/" : rawPath;

  if (path === "/wechat-callback") {
    return <WeChatCallback onLogin={handleLogin} />;
  }

    if (stage === "login") {
    return <LoginPage mode={import.meta.env.PROD ? "production" : "dev"} onLogin={handleLogin} />;
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
              进入思潼 企业AI增长飞轮 →
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
      <Root />
    </Suspense>
  </React.StrictMode>
);

import { useEffect, useMemo, useState } from "react";
import type { ConsultantId } from "../types";
import { BillingView } from "../components/billing/BillingView";
import { OnboardingView } from "../components/onboarding/OnboardingView";
import { ConsultViewWrapper } from "../components/consult/ConsultViewWrapper";
import { DailyView } from "../components/diagnosis/DailyView";
import { initialDiagnosisDoneKey } from "../data/constants";
import {
  getIpAcquisitionCapability,
  IP_ACQUISITION_AGENT_ID,
  ipAcquisitionCapabilities,
  type IpAcquisitionCapabilityId
} from "../data/ipAcquisitionAgent";

const defaultCapabilityId: IpAcquisitionCapabilityId = "industry_hotspots";

type View = "daily" | "consult" | "onboarding" | "billing";

function getCodeFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get("code");
}

const defaultApiBase = (() => {
  if (typeof window !== "undefined" && window.location.hostname === "localhost") {
    return "http://localhost:3011";
  }
  const basePath = (import.meta.env.BASE_URL as string | undefined) ?? "/";
  const normalizedBase = basePath.startsWith("/") ? basePath : `/${basePath}`;
  return `${normalizedBase.replace(/\/$/, "")}/api`;
})();

const apiBase = import.meta.env.VITE_API_BASE_URL ?? defaultApiBase;
const wechatAppId = import.meta.env.VITE_WECHAT_AUTH_APPID ?? "wxf405233d62ec376a";
const betaInviteCode = "BLV2-NEICE-0628";
const allowDemoChat = import.meta.env.DEV;

export function StoreGrowthApp() {
  const [token, setToken] = useState(() => localStorage.getItem("store_os_token") ?? "");
  const [view, setView] = useState<View>("daily");
  const [planCode, setPlanCode] = useState(() => localStorage.getItem("store_os_plan_code") ?? "local_standard");
  const [selectedCapabilityId, setSelectedCapabilityId] = useState<IpAcquisitionCapabilityId>(defaultCapabilityId);
  const selectedCapability = getIpAcquisitionCapability(selectedCapabilityId);
  const [currentConsultantId, setCurrentConsultantId] = useState<ConsultantId>(selectedCapability.skillId);
  const [draftPrompt, setDraftPrompt] = useState("");

  const authHeaders = useMemo<Record<string, string>>(
    () => (token ? { Authorization: `Bearer ${token}` } : {} as Record<string, string>),
    [token]
  );

  const code = getCodeFromUrl();

  useEffect(() => {
    if (!code) return;
    const cached = sessionStorage.getItem("store_os_login_processing");
    if (cached === code) return;
    sessionStorage.setItem("store_os_login_processing", code);
    void (async () => {
      try {
        const res = await fetch(`${apiBase}/auth/wechat-qrc`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, appId: wechatAppId, inviteCode: betaInviteCode })
        });
        const data = (await res.json()) as { token?: string; planCode?: string };
        if (data.token) {
          setToken(data.token);
          localStorage.setItem("store_os_token", data.token);
          localStorage.setItem(initialDiagnosisDoneKey, "1");
          if (data.planCode) {
            setPlanCode(data.planCode);
            localStorage.setItem("store_os_plan_code", data.planCode);
          }
          setView("daily");
        }
      } finally {
        sessionStorage.removeItem("store_os_login_processing");
      }
    })();
  }, [code]);

  function openCapability(capabilityId: IpAcquisitionCapabilityId) {
    const capability = getIpAcquisitionCapability(capabilityId);
    setSelectedCapabilityId(capability.id);
    setCurrentConsultantId(capability.skillId);
    switchView("consult");
  }

  function handleNeedLogin() {
    setToken("");
    localStorage.removeItem("store_os_token");
    switchView("onboarding");
  }

  function switchView(nextView: View) {
    setView(nextView);
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    });
  }

  return (
    <div className="storeApp ipAgentApp">
      <aside className="storeSidebar ipAgentSidebar">
        <div className="brandBlock">
          <span>思潼</span>
          <h1>思潼AI 行业智能体平台</h1>
        </div>

        <nav className="storeNav ipAgentNav" aria-label="Agent 列表">
          <button className={view === "daily" ? "active" : ""} type="button" onClick={() => switchView("daily")}>
            <strong>AI日报</strong>
            <span>行业趋势 / 经营提醒 / 今日动作</span>
          </button>
          <button className={view === "consult" ? "active" : ""} type="button" onClick={() => switchView("consult")}>
            <strong>IP获客智能体</strong>
            <span>热点 / 竞品 / 内容 / 复盘 / 私域</span>
          </button>
        </nav>

        <button className="payEntryButton ipAgentPayButton" onClick={() => switchView("billing")}>
          套餐 / 积分
        </button>
      </aside>

      <section className={view === "consult" ? "storeWorkspace chatMode" : "storeWorkspace scrollMode"}>
        {view === "consult" && (
          <div className="ipAgentWorkspace">
            <ConsultViewWrapper
              token={token}
              headers={authHeaders}
              currentConsultantId={currentConsultantId}
              capabilityId={selectedCapability.id}
              currentAbilityLabel={selectedCapability.title}
              currentAbilitySubtitle={selectedCapability.subtitle}
              agentId={IP_ACQUISITION_AGENT_ID}
              allowDemoChat={allowDemoChat}
              draftPrompt={draftPrompt}
              onDraftPromptConsumed={() => setDraftPrompt("")}
              onSelectConsultant={setCurrentConsultantId}
              onOpenCapability={openCapability}
              onNeedLogin={handleNeedLogin}
              onOpenBilling={() => switchView("billing")}
            />

            <aside className="ipAgentCapabilityPanel" aria-label="IP获客能力入口">
              <div>
                <span>能力入口</span>
                <h2>IP获客智能体</h2>
                <p>当前开放 {ipAcquisitionCapabilities.length} 个能力，所有对话都会限制在当前智能体允许的能力范围内。</p>
              </div>

              <div className="ipAgentCapabilityList">
                {ipAcquisitionCapabilities.map((capability) => (
                  <button
                    key={capability.id}
                    type="button"
                    className={capability.id === selectedCapabilityId ? "active" : ""}
                    onClick={() => openCapability(capability.id)}
                  >
                    <strong>{capability.title}</strong>
                    <span>{capability.subtitle}</span>
                  </button>
                ))}
              </div>
            </aside>
          </div>
        )}

        {view === "daily" && (
          <DailyView headers={authHeaders} onNeedLogin={handleNeedLogin} onConsult={() => switchView("consult")} />
        )}

        {view === "onboarding" && (
          <OnboardingView token={token} headers={authHeaders} />
        )}
        {view === "billing" && (
          <BillingView token={token} headers={authHeaders} onNeedLogin={() => switchView("onboarding")} />
        )}
      </section>
    </div>
  );
}

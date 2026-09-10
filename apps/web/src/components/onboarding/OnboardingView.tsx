import { useState } from "react";

type OnboardingStep = "info" | "connect" | "verify" | "done";

const apiBase = import.meta.env.VITE_API_BASE_URL ?? (() => {
  if (typeof window !== "undefined" && window.location.hostname === "localhost") {
    return "http://localhost:3011";
  }
  const basePath = (import.meta.env.BASE_URL as string | undefined) ?? "/";
  const normalizedBase = basePath.startsWith("/") ? basePath : `/${basePath}`;
  return `${normalizedBase.replace(/\/$/, "")}/api`;
})();

function apiPath(path: string): string {
  return `${apiBase}${path.startsWith("/") ? path : `/${path}`}`;
}

function planCodeForRole(role: string): string {
  if (role === "chain_brand") return "chain_standard";
  if (role === "personal_ip") return "ip_standard";
  return "local_standard";
}

interface OnboardingForm {
  tenantName: string;
  businessRole: string;
  industry: string;
  city: string;
  phone: string;
}

const ROLE_OPTIONS = [
  { value: "local_business", label: "本地生活商家", description: "餐饮、美业、零售、生活服务等" },
  { value: "personal_ip", label: "个人IP/知识付费", description: "个人品牌、知识付费、自媒体等" },
  { value: "chain_brand", label: "连锁品牌", description: "多门店连锁品牌、招商加盟等" },
];

const INDUSTRY_OPTIONS = [
  "餐饮", "美业", "零售", "教培", "酒店", "旅游",
  "健身", "宠物", "摄影", "家政", "汽车", "其他",
];

interface OnboardingViewProps {
  token: string;
  headers: Record<string, string>;
}

export function OnboardingView({ token, headers }: OnboardingViewProps) {
  const [step, setStep] = useState<OnboardingStep>("info");
  const [form, setForm] = useState<OnboardingForm>({
    tenantName: "",
    businessRole: "",
    industry: "",
    city: "",
    phone: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function updateField(key: keyof OnboardingForm, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setError("");
  }

  async function handleInfoSubmit() {
    if (!form.tenantName.trim() || !form.businessRole) {
      setError("请填写完整信息");
      return;
    }
    setStep("connect");
  }

  async function handleFinalSubmit() {
    const onboardingToken = localStorage.getItem("store_os_onboarding_token") ?? "";
    if (!onboardingToken && !token) {
      setError("请先完成微信登录或内测登录，再创建企业工作区。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch(apiPath("/auth/onboarding/create-workspace"), {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          onboardingToken,
          tenantName: form.tenantName,
          planCode: planCodeForRole(form.businessRole),
          industry: form.industry,
          city: form.city,
          phone: form.phone,
          inviteCode: localStorage.getItem("store_os_invite_code") ?? undefined
        }),
      });
      const data = await res.json();
      if (res.ok && !data.error) {
        if (data.token) localStorage.setItem("store_os_token", data.token);
        localStorage.setItem("store_os_initial_diagnosis_done", "1");
        setStep("done");
      } else {
        setError(data.message ?? "入驻失败");
      }
    } catch {
      setError("网络错误，请稍后重试");
    }
    setBusy(false);
  }

  if (step === "done") {
    return (
      <div className="diagnosisPage">
        <div className="diagnosisCard" style={{ textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🎉</div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text)", margin: "0 0 8px" }}>
            入驻成功！
          </h1>
          <p style={{ fontSize: 14, color: "var(--muted)", margin: "0 0 24px", lineHeight: 1.7 }}>
            思潼已为你准备好专属 AI 经营工作台，
            接下来你可以开始诊断，或直接和思潼说你的经营问题。
          </p>
          <button className="diagnosisStartBtn" onClick={() => window.location.reload()}>
            进入思潼AI 行业智能体平台
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="diagnosisPage">
      <div className="diagnosisCard" style={{ maxWidth: 560 }}>
        <span className="diagnosisBadge">企业入驻</span>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text)", margin: "12px 0 4px" }}>
          {step === "info" ? "完善企业信息" : "绑定平台账号"}
        </h1>
        <p style={{ fontSize: 14, color: "var(--muted)", margin: "0 0 24px" }}>
          {step === "info"
            ? "填写基础信息，思潼会以此为基础给你量身定制方案"
            : "连接你的社交媒体账号，让思潼自动获取经营数据"}
        </p>

        {/* Progress dots */}
        <div className="diagnosisProgress" style={{ marginBottom: 24 }}>
          <div className="diagnosisSteps">
            <div className={`diagnosisDots${step === "info" ? " done" : ""}`} />
            <div className={`diagnosisDots${step === "connect" ? " done" : ""}`} />
            <div className={`diagnosisDots${step === "verify" ? " done" : ""}`} />
          </div>
        </div>

        {error && <div className="diagnosisError" style={{ marginBottom: 16 }}>{error}</div>}

        {step === "info" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 6 }}>
                企业/品牌名称 *
              </label>
              <input
                type="text"
                value={form.tenantName}
                onChange={(e) => updateField("tenantName", e.target.value)}
                placeholder="如：思潼说商业、XX餐饮管理有限公司"
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 6,
                  border: "1px solid var(--line)",
                  background: "var(--panel)",
                  color: "var(--text)",
                  fontSize: 14,
                  outline: "none",
                }}
              />
            </div>

            <div>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 6 }}>
                经营类型 *
              </label>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {ROLE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => updateField("businessRole", opt.value)}
                    style={{
                      textAlign: "left",
                      padding: "12px 14px",
                      borderRadius: 8,
                      border: form.businessRole === opt.value ? "2px solid var(--gold)" : "1px solid var(--line)",
                      background: form.businessRole === opt.value ? "rgba(217,184,117,0.1)" : "var(--panel2)",
                      color: form.businessRole === opt.value ? "var(--text)" : "var(--muted)",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{opt.label}</div>
                    <div style={{ fontSize: 12, marginTop: 2 }}>{opt.description}</div>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 6 }}>
                行业
              </label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {INDUSTRY_OPTIONS.map((ind) => (
                  <button
                    key={ind}
                    onClick={() => updateField("industry", ind)}
                    style={{
                      padding: "6px 14px",
                      borderRadius: 20,
                      border: form.industry === ind ? "2px solid var(--gold)" : "1px solid var(--line)",
                      background: form.industry === ind ? "rgba(217,184,117,0.1)" : "transparent",
                      color: form.industry === ind ? "var(--gold)" : "var(--muted)",
                      fontSize: 12,
                      cursor: "pointer",
                    }}
                  >
                    {ind}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 6 }}>
                所在城市
              </label>
              <input
                type="text"
                value={form.city}
                onChange={(e) => updateField("city", e.target.value)}
                placeholder="如：成都"
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 6,
                  border: "1px solid var(--line)",
                  background: "var(--panel)",
                  color: "var(--text)",
                  fontSize: 14,
                  outline: "none",
                }}
              />
            </div>

            <div>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 6 }}>
                手机号
              </label>
              <input
                type="tel"
                value={form.phone}
                onChange={(e) => updateField("phone", e.target.value)}
                placeholder="用于接收重要通知"
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 6,
                  border: "1px solid var(--line)",
                  background: "var(--panel)",
                  color: "var(--text)",
                  fontSize: 14,
                  outline: "none",
                }}
              />
            </div>

            <button
              className="diagnosisStartBtn"
              onClick={handleInfoSubmit}
              style={{ marginTop: 8 }}
            >
              下一步：绑定平台账号
            </button>
          </div>
        )}

        {step === "connect" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div className="diagnosisCard" style={{ padding: "16px 18px", background: "var(--panel2)", border: "1px solid var(--line)", borderRadius: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14, color: "var(--text)" }}>抖音</div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>授权后AI可读取你的抖音账号数据</div>
                </div>
                <button className="diagnosisStartBtn" style={{ padding: "6px 16px", fontSize: 13 }}>
                  授权
                </button>
              </div>
            </div>

            <div className="diagnosisCard" style={{ padding: "16px 18px", background: "var(--panel2)", border: "1px solid var(--line)", borderRadius: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14, color: "var(--text)" }}>小红书</div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>授权后AI可读取你的小红书账号数据</div>
                </div>
                <button className="diagnosisStartBtn" style={{ padding: "6px 16px", fontSize: 13 }}>
                  授权
                </button>
              </div>
            </div>

            <div className="diagnosisCard" style={{ padding: "16px 18px", background: "var(--panel2)", border: "1px solid var(--line)", borderRadius: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14, color: "var(--text)" }}>企业微信</div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>连接后AI可推送日报到企业微信</div>
                </div>
                <button className="diagnosisStartBtn" style={{ padding: "6px 16px", fontSize: 13 }}>
                  授权
                </button>
              </div>
            </div>

            <button
              className="diagnosisStartBtn"
              onClick={handleFinalSubmit}
              disabled={busy}
              style={{ marginTop: 8 }}
            >
              {busy ? "入驻中..." : "完成入驻"}
            </button>
            <button
              style={{
                background: "transparent",
                border: "none",
                color: "var(--soft)",
                fontSize: 13,
                cursor: "pointer",
                padding: 8,
              }}
              onClick={() => setStep("info")}
            >
              ← 返回上一步
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

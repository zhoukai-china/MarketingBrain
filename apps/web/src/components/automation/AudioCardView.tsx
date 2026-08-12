import { useState, useEffect } from "react";
import type { AudioCardBinding } from "../../types";

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

const MOCK_BINDINGS: AudioCardBinding[] = [
  {
    bindingId: "demo-1",
    provider: "getnote",
    label: "Get笔记·会议录音",
    description: "自动拉取Get笔记中的会议录音并生成摘要卡片",
    mode: "pull",
    webhookUrl: "https://api.lcppch.top/os-v2/api/audio-card-webhooks/getnote",
    pullUrl: "https://api.getnote.cn/recordings/recent?source=sitong",
    pullReady: true,
    tokenHeader: "X-GetNote-Token",
    createdAt: new Date().toISOString(),
  },
  {
    bindingId: "demo-2",
    provider: "feishu",
    label: "飞书妙记·访谈录音",
    description: "拉取飞书妙记的会议/访谈转写并自动生成行动卡片",
    mode: "pull",
    webhookUrl: "https://api.lcppch.top/os-v2/api/audio-card-webhooks/feishu",
    pullUrl: "",
    pullReady: false,
    tokenHeader: "Authorization",
    createdAt: new Date().toISOString(),
  },
];

const PROVIDER_OPTIONS = [
  { value: "getnote", label: "Get笔记", icon: "📝" },
  { value: "feishu", label: "飞书妙记", icon: "📋" },
  { value: "wechat_voice", label: "微信语音", icon: "💬" },
];

interface AudioCardViewProps {
  token: string;
  headers: Record<string, string>;
  onNeedLogin: () => void;
  onOpenBilling: () => void;
}

export function AudioCardView({ token, headers, onNeedLogin, onOpenBilling }: AudioCardViewProps) {
  const [bindings, setBindings] = useState<AudioCardBinding[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newProvider, setNewProvider] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    async function fetchBindings() {
      try {
        const res = await fetch(apiPath("/audio-card-bindings"), {
          headers: { ...headers, "Content-Type": "application/json" },
        });
        const data = await res.json();
        if (data.bindings?.length) {
          setBindings(data.bindings);
        } else {
          setBindings(MOCK_BINDINGS);
        }
      } catch {
        setBindings(MOCK_BINDINGS);
      }
      setLoading(false);
    }
    fetchBindings();
  }, []);

  async function handleAddBinding() {
    if (!newProvider || !newLabel.trim()) return;
    setAdding(true);
    setError("");
    try {
      const res = await fetch(apiPath("/audio-card-bindings"), {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ provider: newProvider, label: newLabel.trim(), pullConfig: {} }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error || !data.binding) {
        setError(data.message ?? "绑定失败，请检查权限或稍后重试");
        return;
      }
      setBindings((prev) => [...prev, data.binding]);
      setNewProvider("");
      setNewLabel("");
      setShowAdd(false);
    } catch {
      setError("网络错误，请稍后重试");
    } finally {
      setAdding(false);
    }
  }

  if (loading) {
    return (
      <div className="diagnosisPage">
        <div className="diagnosisCard generatingCard">
          <div className="generatingSpinner" />
          <h2>正在加载录音卡...</h2>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 680, margin: "0 auto", padding: "24px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: "var(--text)", margin: "0 0 6px" }}>
            录音卡
          </h1>
          <p style={{ fontSize: 14, color: "var(--muted)", margin: 0 }}>
            连接录音/会议工具，AI自动生成行动卡片
          </p>
        </div>
        <button
          className="diagnosisStartBtn"
          onClick={() => setShowAdd(!showAdd)}
          style={{ padding: "8px 16px", fontSize: 13 }}
        >
          {showAdd ? "取消" : "+ 绑定新来源"}
        </button>
      </div>

      {showAdd && (
        <div className="diagnosisCard" style={{ marginBottom: 20, padding: "20px 24px" }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, color: "var(--text)", margin: "0 0 12px" }}>
            新增录音来源
          </h3>
          {error && <div className="diagnosisError" style={{ marginBottom: 12 }}>{error}</div>}
          <div className="audioModeGrid" style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            {PROVIDER_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setNewProvider(opt.value)}
                style={{
                  flex: 1,
                  padding: "10px",
                  borderRadius: 8,
                  border: newProvider === opt.value ? "2px solid var(--gold)" : "1px solid var(--line)",
                  background: newProvider === opt.value ? "rgba(217,184,117,0.1)" : "var(--panel2)",
                  color: newProvider === opt.value ? "var(--gold)" : "var(--muted)",
                  cursor: "pointer",
                }}
              >
                <div style={{ fontSize: 20 }}>{opt.icon}</div>
                <div style={{ fontSize: 12, marginTop: 4 }}>{opt.label}</div>
              </button>
            ))}
          </div>
          <input
            type="text"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="给这个绑定起个名字，如：每周例会录音"
            style={{
              width: "100%",
              padding: "10px 12px",
              borderRadius: 6,
              border: "1px solid var(--line)",
              background: "var(--panel)",
              color: "var(--text)",
              fontSize: 14,
              marginBottom: 12,
              outline: "none",
            }}
          />
          <button
            className="diagnosisStartBtn"
            onClick={handleAddBinding}
            disabled={!newProvider || !newLabel.trim() || adding}
            style={{ width: "100%" }}
          >
            {adding ? "绑定中..." : "确认绑定"}
          </button>
        </div>
      )}

      <div className="bindingList" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {bindings.map((b) => (
          <div key={b.bindingId} className="diagnosisCard bindingCard" style={{ padding: "18px 22px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <h3 style={{ fontSize: 15, fontWeight: 600, color: "var(--text)", margin: "0 0 4px" }}>
                  {b.label}
                </h3>
                <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>
                  {b.description}
                </p>
              </div>
              <span
                className="diagnosisBadge"
                style={{
                  background: b.pullReady ? "rgba(43,208,189,0.2)" : "rgba(217,184,117,0.15)",
                  color: b.pullReady ? "#2bd0bd" : "var(--gold)",
                }}
              >
                {b.pullReady ? "✓ 已连接" : "待配置"}
              </span>
            </div>
            {b.webhookUrl && (
              <div style={{ marginTop: 10, fontSize: 11, color: "var(--soft)", wordBreak: "break-all" }}>
                Webhook: {b.webhookUrl}
              </div>
            )}
          </div>
        ))}
      </div>

      {bindings.length === 0 && (
        <div style={{ textAlign: "center", padding: 40, color: "var(--muted)" }}>
          还没有绑定任何录音来源，点击上方按钮开始
        </div>
      )}
    </div>
  );
}

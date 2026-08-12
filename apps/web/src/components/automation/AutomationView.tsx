import { useState, useEffect } from "react";

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

interface AutomationRule {
  id: string;
  name: string;
  description: string;
  trigger: string;
  action: string;
  enabled: boolean;
  lastRun?: string;
  status: "active" | "idle" | "error";
}

const PRESET_AUTOMATIONS: AutomationRule[] = [
  {
    id: "daily-brief",
    name: "每日经营简报",
    description: "每天早上8点自动汇总经营数据，生成今日简报推送",
    trigger: "定时：每天早上 8:00",
    action: "调用AI生成简报 → 微信推送",
    enabled: false,
    status: "idle",
  },
  {
    id: "comment-monitor",
    name: "AI评论监控回复",
    description: "监控抖音/视频号新评论，AI自动分析并生成回复建议，人工确认后发布",
    trigger: "事件：新评论到达",
    action: "AI分析意图 → 生成回复 → 等待人工确认",
    enabled: false,
    status: "idle",
  },
  {
    id: "lead-followup",
    name: "线索跟进提醒",
    description: "超过24小时未跟进的意向客户自动提醒，附带AI生成的跟进话术",
    trigger: "条件：意向客户超过24h未跟进",
    action: "生成提醒 → 推送话术建议",
    enabled: false,
    status: "idle",
  },
  {
    id: "content-review",
    name: "周度内容复盘",
    description: "每周一自动分析上周视频/图文数据，输出复盘报告和选题建议",
    trigger: "定时：每周一 9:00",
    action: "AI复盘 → 生成报告 → 推送",
    enabled: false,
    status: "idle",
  },
  {
    id: "data-sync",
    name: "平台数据同步",
    description: "每2小时自动同步抖音/小红书数据到经营看板",
    trigger: "定时：每2小时",
    action: "拉取平台API → 更新看板数据",
    enabled: false,
    status: "idle",
  },
];

const STATUS_COLORS: Record<string, string> = {
  active: "#2bd0bd",
  idle: "var(--muted)",
  error: "#f2a2a2",
};

interface AutomationViewProps {
  token: string;
  headers: Record<string, string>;
  onNeedLogin: () => void;
}

export function AutomationView({ token, headers, onNeedLogin }: AutomationViewProps) {
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchRules() {
      try {
        const res = await fetch(apiPath("/automation/tasks"), {
          headers: { ...headers, "Content-Type": "application/json" },
        });
        const data = await res.json();
        if (data.tasks?.length) {
          setRules(data.tasks.map((task: any) => ({
            id: task.id,
            name: task.type,
            description: task.payload?.title ?? "自动化任务",
            trigger: new Date(task.runAt).toLocaleString("zh-CN"),
            action: task.status,
            enabled: !["failed", "canceled"].includes(task.status),
            status: task.status === "failed" ? "error" : task.status === "succeeded" ? "idle" : "active"
          })));
        } else {
          setRules(PRESET_AUTOMATIONS);
        }
      } catch {
        setRules(PRESET_AUTOMATIONS);
      }
      setLoading(false);
    }
    fetchRules();
  }, []);

  function toggleRule(id: string) {
    if (!token) {
      onNeedLogin();
      return;
    }
    setRules((prev) =>
      prev.map((r) =>
        r.id === id
          ? { ...r, enabled: !r.enabled, status: !r.enabled ? "active" : "idle" }
          : r
      )
    );
  }

  if (loading) {
    return (
      <div className="diagnosisPage">
        <div className="diagnosisCard generatingCard">
          <div className="generatingSpinner" />
          <h2>正在加载自动化规则...</h2>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 780, margin: "0 auto", padding: "24px 16px" }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: "var(--text)", margin: "0 0 6px" }}>
          自动化规则
        </h1>
        <p style={{ fontSize: 14, color: "var(--muted)", margin: 0 }}>
          设置自动化规则，让经营数据、客户跟进、内容复盘自动运转
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {rules.map((rule) => (
          <div
            key={rule.id}
            className="diagnosisCard"
            style={{ padding: "18px 22px", opacity: rule.enabled ? 1 : 0.7 }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <h3 style={{ fontSize: 15, fontWeight: 600, color: "var(--text)", margin: 0 }}>
                    {rule.name}
                  </h3>
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: STATUS_COLORS[rule.status],
                      display: "inline-block",
                    }}
                  />
                </div>
                <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 8px", lineHeight: 1.5 }}>
                  {rule.description}
                </p>
                <div style={{ display: "flex", gap: 16, fontSize: 12, color: "var(--soft)" }}>
                  <span>🔔 {rule.trigger}</span>
                  <span>⚡ {rule.action}</span>
                </div>
                {rule.lastRun && (
                  <div style={{ marginTop: 6, fontSize: 11, color: "var(--soft)" }}>
                    上次执行：{new Date(rule.lastRun).toLocaleString("zh-CN")}
                  </div>
                )}
              </div>
              <button
                onClick={() => toggleRule(rule.id)}
                style={{
                  minWidth: 64,
                  padding: "6px 14px",
                  borderRadius: 20,
                  border: "none",
                  background: rule.enabled ? "linear-gradient(135deg, rgba(43,208,189,0.2), rgba(43,208,189,0.1))" : "var(--panel2)",
                  color: rule.enabled ? "#2bd0bd" : "var(--muted)",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                {rule.enabled ? "已开启" : "已关闭"}
              </button>
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 24, padding: "16px 20px", background: "var(--panel2)", border: "1px solid var(--line)", borderRadius: 10 }}>
        <p style={{ fontSize: 13, color: "var(--muted)", margin: 0, textAlign: "center" }}>
          💡 开启自动化后，系统将在后台按规则执行任务。
          更多高级规则请联系思潼开通企业版。
        </p>
      </div>
    </div>
  );
}

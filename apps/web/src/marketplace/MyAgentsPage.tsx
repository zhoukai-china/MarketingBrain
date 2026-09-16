import { useEffect, useState } from "react";
import { apiPath, getAppPath } from "../lib/api.js";
import { authHeaders, fetchMarketMe, guestToLogin, readJson, Topbar } from "./shell.js";

/**
 * 「常用智能体」独立页（用户 2026-09-16：「常用智能体要不要做成独立的智能体列表页」→ 要）。
 *
 * 口径：列的是**这个账号真的用过**的智能体（按扣费账本 `ppu_consume` 聚合），不是货架全量。
 * 每张卡给「用过几次 / 累计消耗多少积分 / 最近一次什么时候」+ 「继续使用」，让老客户跳过挑货架这一步。
 * 空态明确告诉客户「还没用过 → 去货架」；未登录给登录引导（不静默失败）。
 */
interface FrequentAgent {
  skuCode: string;
  skuName: string | null;
  skuIcon: string | null;
  zone: string | null;
  runs: number;
  credits: number;
  lastUsedAt: string;
}

export function MarketplaceMyAgentsPage() {
  const [agents, setAgents] = useState<FrequentAgent[]>([]);
  const [zoneNames, setZoneNames] = useState<Record<string, string>>({});
  const [balance, setBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [signedIn, setSignedIn] = useState(() => Boolean(localStorage.getItem("store_os_token")));

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetch(apiPath("/market/me/agents"), { headers: authHeaders(), cache: "no-store" })
      .then(async (response) => {
        if (cancelled) return;
        if (response.status === 401 || response.status === 403) {
          setSignedIn(false);
          return;
        }
        const data = await readJson<{ agents?: FrequentAgent[] }>(response);
        if (!cancelled) setAgents(data.agents ?? []);
      })
      .catch(() => {
        /* 读不到就按空列表渲染，页面其它内容不受影响 */
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    // 专区中文名（卡片上标注「美业专区」这类归属），失败不影响主流程。
    void fetch(apiPath("/market/zones"))
      .then((response) => (response.ok ? readJson<{ zones: Array<{ key: string; name: string }> }>(response) : null))
      .then((data) => {
        if (!cancelled && data?.zones) {
          setZoneNames(Object.fromEntries(data.zones.map((zone) => [zone.key, zone.name])));
        }
      })
      .catch(() => undefined);
    void fetchMarketMe<{ creditBalance: number }>()
      .then((data) => {
        if (cancelled) return;
        if (!data) {
          setSignedIn(false);
          return;
        }
        setBalance(data.creditBalance);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (!signedIn) {
    return (
      <main className="app-wrap">
        <Topbar active="mine" balance={null} onNavigate={(p) => { window.location.href = getAppPath(p); }} />
        <section className="view view-mine">
          <div className="login-gate big">
            🔒 你还未登录
            <p>登录后这里会列出你用过的智能体，点一下接着用。</p>
            <button className="btn primary" onClick={() => guestToLogin("/my-agents")}>登录</button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="app-wrap">
      <Topbar active="mine" balance={balance} onNavigate={(p) => { window.location.href = getAppPath(p); }} />
      <section className="view view-mine">
        <h1>常用智能体</h1>
        <p className="mine-tip">你用过、还在用的智能体都在这里——点「继续使用」直接回到对话，不用再翻货架。</p>
        {loading ? (
          <div className="loading">正在加载…</div>
        ) : agents.length === 0 ? (
          <>
            <p className="mine-tip">还没有用过智能体。去货架挑一个，第一次用就会自动出现在这里。</p>
            <button className="btn primary" onClick={() => { window.location.href = getAppPath("/agents"); }}>去货架逛逛</button>
          </>
        ) : (
          <div className="card-grid">
            {agents.map((agent) => (
              <article className="agent-card owned-card" key={agent.skuCode}>
                <div className="ac-ico">{agent.skuIcon ?? "🤖"}</div>
                <div className="ac-name">{agent.skuName ?? agent.skuCode}</div>
                <div className="ac-price">用过 {agent.runs} 次 · 累计 {agent.credits} 积分</div>
                <div className="ac-foot">
                  <span className="chip owned">{agent.zone ? zoneNames[agent.zone] ?? agent.zone : "智能体"}</span>
                  <span className="chip">最近 {new Date(agent.lastUsedAt).toLocaleDateString("zh-CN")}</span>
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                  <button className="btn primary sm" onClick={() => { window.location.href = getAppPath(`/agent/${encodeURIComponent(agent.skuCode)}/chat`); }}>继续使用</button>
                  <button className="btn ghost sm" onClick={() => { window.location.href = getAppPath(`/agent/${encodeURIComponent(agent.skuCode)}`); }}>看详情</button>
                </div>
              </article>
            ))}
          </div>
        )}
        <p className="mine-tip" style={{ marginTop: 18 }}>
          交付物（生成的报告 / 文案）在「<a onClick={() => { window.location.href = getAppPath("/mine"); }}>我的</a>」页，平台保留 7 天，请及时下载。
        </p>
      </section>
    </main>
  );
}

import { useEffect, useState } from "react";
import { getAppPath } from "../lib/api.js";
import { fetchMarketMe, guestToLogin, Topbar } from "./shell.js";

export function MarketplaceMinePage() {
  const [balance, setBalance] = useState<number | null>(null);
  const [recent, setRecent] = useState<Array<{ id: string; skuName?: string | null; amountCredits: number; createdAt: string }>>([]);
  const [loading, setLoading] = useState(true);
  // 本地有 token 不代表还登录着（token 可能已过期）；只有服务端确认过才算已登录，
  // 否则这里会一边显示余额区一边显示「未登录」，用户点登录又被弹回来。
  const [signedIn, setSignedIn] = useState(() => Boolean(localStorage.getItem("store_os_token")));

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetchMarketMe<{ creditBalance: number; recentPpu: Array<{ id: string; skuName?: string | null; amountCredits: number; createdAt: string }> }>()
      .then((d) => {
        if (cancelled) return;
        if (!d) {
          setSignedIn(false);
          setBalance(null);
          return;
        }
        setBalance(d.creditBalance);
        setRecent(d.recentPpu ?? []);
      })
      .catch(() => { if (!cancelled) setBalance(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (!signedIn) {
    return (
      <main className="app-wrap">
        <Topbar active="mine" balance={null} onNavigate={(p) => { window.location.href = getAppPath(p); }} />
        <section className="view view-mine"><div className="login-gate big">🔒 你还未登录<p>登录后可查看积分余额与使用记录。</p><button className="btn primary" onClick={() => guestToLogin("/mine")}>登录</button></div></section>
      </main>
    );
  }

  return (
    <main className="app-wrap">
      <Topbar active="mine" balance={balance} onNavigate={(p) => { window.location.href = getAppPath(p); }} />
      <section className="view view-mine">
        <h1>常用智能体</h1>
        <div className="mine-top">
          <div className="balance-card"><div className="bc-label">积分余额</div><div className="bc-val">💎 {balance ?? "—"}</div><div className="bc-sub">按次使用 · 全平台通用</div><button className="btn ghost sm" onClick={() => { window.location.href = getAppPath("/recharge"); }}>+ 充值积分</button></div>
          <div className="shared-card wide">💎 <b>跨智能体通用</b><br />积分在统一钱包，可在创始人IP专区与各行业专区的智能体抵扣——只充一次，处处可用。</div>
        </div>
        <h3>近期按次使用</h3>
        {loading ? <div className="loading">正在加载…</div> : recent.length === 0 ? <p className="mine-tip">暂无按次使用记录</p> : (
          <div className="card-grid">
            {recent.map((entry) => (
              <article className="agent-card owned-card" key={entry.id}>
                <div className="ac-ico">🤖</div>
                <div className="ac-name">{entry.skuName ?? "智能体"}</div>
                <div className="ac-price">{entry.amountCredits} 积分</div>
                <div className="ac-foot"><span className="chip owned">{new Date(entry.createdAt).toLocaleDateString("zh-CN")}</span></div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

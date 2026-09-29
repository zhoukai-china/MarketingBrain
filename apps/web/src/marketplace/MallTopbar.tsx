import { useEffect, useState } from "react";
import { getAppPath } from "../lib/api.js";
import { fetchMarketMe } from "./shell.js";
import { IconGlyph } from "./IconGlyph.js";

/**
 * 商城统一顶栏（样式基准：工作台 demo 顶栏）。
 * 左：可选「← 返回」胶囊 + 思潼AI商城 字标（思潼深色 + AI 橙色）+ 页面徽标；
 * 右：⚡算力余额胶囊 + 充值按钮。余额自取（fetchMarketMe）。
 */
export function MallTopbar({ back, badge, onRecharge }: { back?: string; badge?: string; onRecharge?: () => void }) {
  const [balance, setBalance] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void fetchMarketMe<{ creditBalance: number }>()
        .then((d) => { if (!cancelled) setBalance(d ? d.creditBalance : null); })
        .catch(() => { if (!cancelled) setBalance(null); });
    };
    load();
    // 抽屉支付成功后广播该事件，顶栏余额即时刷新。
    window.addEventListener("sitong:balance-changed", load);
    return () => { cancelled = true; window.removeEventListener("sitong:balance-changed", load); };
  }, []);

  return (
    <header className="eh-topbar">
      <div className="eh-topbar-in">
        {back ? (
          <button type="button" className="eh-backpill" onClick={() => { window.location.href = getAppPath(back); }}>← 返回</button>
        ) : null}
        <span className="eh-logo"><b>思潼</b><em>AI</em>商城</span>
        {badge ? <span className="eh-page-badge">{badge}</span> : null}
        <span className="eh-sp" />
        <div className="eh-wallet">
          <span className="eh-bal2"><i className="eh-bal2-bolt"><IconGlyph name="bolt" size={12} /></i>算力 <b>{balance ?? "—"}</b></span>
          <button type="button" className="eh-mini" onClick={() => { if (onRecharge) onRecharge(); else window.location.href = getAppPath("/recharge"); }}>充值</button>
        </div>
      </div>
    </header>
  );
}

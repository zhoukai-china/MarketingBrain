import { useEffect, useState } from "react";
import { getAppPath } from "../lib/api.js";
import { fetchMarketMe } from "./shell.js";

/**
 * 商城版式顶栏（照原型 agents-home-tech-demo v3.28 顶栏）：
 * 品牌 + 「● AI 全员在线 · HH:MM」+ 余额橙 chip + 流光充值按钮 + ？帮助。
 * 商城首页与各数字人详情页共用；余额自取（fetchMarketMe）。
 */
export function MallTopbar() {
  const [balance, setBalance] = useState<number | null>(null);
  const [clock, setClock] = useState("");

  useEffect(() => {
    let cancelled = false;
    void fetchMarketMe<{ creditBalance: number }>()
      .then((d) => { if (!cancelled) setBalance(d ? d.creditBalance : null); })
      .catch(() => { if (!cancelled) setBalance(null); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const fmt = () => {
      const d = new Date();
      return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    };
    setClock(fmt());
    const timer = window.setInterval(() => setClock(fmt()), 15000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <header className="eh-topbar">
      <div className="eh-brand">
        <div className="eh-brand-txt">
          <b>思潼AI商城</b>
          <span className="eh-ai"><i></i>AI 全员在线 <em>{clock}</em></span>
        </div>
      </div>
      <span className="eh-sp" />
      <div className="eh-wallet">
        <span className="eh-bal">⚡ <b>{balance ?? "—"}</b><i>{balance != null ? `≈ ¥${(balance / 10).toFixed(balance % 10 === 0 ? 0 : 1)}` : ""}</i></span>
        <button type="button" className="eh-mini" onClick={() => { window.location.href = getAppPath("/recharge"); }}>充值</button>
      </div>
    </header>
  );
}

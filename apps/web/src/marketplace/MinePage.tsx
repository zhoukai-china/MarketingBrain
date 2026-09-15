import { useEffect, useRef, useState } from "react";
import { apiPath, getAppPath } from "../lib/api.js";
import { authHeaders, fetchMarketMe, guestToLogin, readJson, Topbar } from "./shell.js";
import "../styles/referral-card.css";

/**
 * 我的邀请链接（PLAT-38，用户 2026-09-15）：把统一注册链接给到本人，含复制与二维码。
 *
 * 推荐码明文只在签发时返回一次（PLAT-28 的安全模型），所以页面只有两种情况：
 * 没码 → 点「生成我的邀请链接」拿到链接 + 二维码；已有码 → 显示预览与「再生成一条」。
 */
interface ReferralLinkView {
  state: "none" | "existing" | "created";
  link: string | null;
  code: string | null;
  codePreview: string | null;
  qrSvg: string | null;
  codesCount: number;
  hint: string;
}

function ReferralLinkCard() {
  const [view, setView] = useState<ReferralLinkView | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState(false);
  /**
   * 版本号：**POST（用户点按钮）的结果永远优先**。
   *
   * 2026-09-15 验收实测的竞态：首屏 GET 还没回来时用户就点了「生成邀请链接」，
   * POST 先返回（created + 链接），随后 GET 的旧结果把状态覆盖回「已有推荐码」，
   * 用户看到的就是「点了按钮却没有链接」。慢网络下更容易出现。
   * 规则：GET 只允许在自己这轮没有被 POST 打断时写状态。
   */
  const stateVersionRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const version = stateVersionRef.current;
    void (async () => {
      try {
        const data = await readJson<ReferralLinkView>(await fetch(apiPath("/market/me/referral-link"), { headers: authHeaders(), cache: "no-store" }));
        if (!cancelled && stateVersionRef.current === version) setView(data);
      } catch {
        // 读不到不影响「我的」页其它内容：卡片自己给出人话。
        if (!cancelled) setNotice("邀请链接暂时读取失败，稍后可重试。");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function issue(regenerate: boolean) {
    setBusy(true);
    setNotice("");
    setCopied(false);
    try {
      const response = await fetch(apiPath("/market/me/referral-link"), {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify({ regenerate })
      });
      const data = await readJson<ReferralLinkView>(response);
      stateVersionRef.current += 1;
      setView(data);
      if (data.state === "created") setNotice("已生成，请立刻复制或保存——明文只显示这一次。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "生成失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    const link = view?.link ?? "";
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setNotice("链接已复制，粘贴给朋友即可。");
    } catch {
      setNotice("浏览器没让复制，请手动选中下面的链接复制。");
    }
  }

  return (
    <section className="referral-card" data-referral-card>
      <header>
        <h3>我的邀请链接</h3>
        <span className="chip">{view?.codePreview ? `已有推荐码 ${view.codePreview}` : "还没有推荐码"}</span>
      </header>
      <p className="referral-hint">{view?.hint ?? "正在读取邀请链接…"}</p>

      {view?.link ? (
        <div className="referral-link-row">
          <input readOnly value={view.link} onFocus={(event) => event.currentTarget.select()} aria-label="我的邀请链接" />
          <button type="button" className="btn primary sm" onClick={() => void copyLink()}>{copied ? "已复制" : "复制链接"}</button>
        </div>
      ) : null}

      {view?.qrSvg ? (
        <div className="referral-qr" data-referral-qr dangerouslySetInnerHTML={{ __html: view.qrSvg }} />
      ) : null}

      <div className="referral-actions">
        {view && view.state !== "created" && !view.link && (
          // 按钮文案无论「还没有推荐码」还是「已有推荐码」都是「生成…邀请链接」——这是用户的显式动作，
          // 一律按「签一条新的」处理（服务端保证旧链接仍然有效）。这样不会出现 GET 说没有、POST 说有
          // 的状态打架（2026-09-15 测试实例实测：那种打架会让用户点了按钮却看不到链接）。
          <button type="button" className="btn primary sm" onClick={() => void issue(true)} disabled={busy}>
            {busy ? "生成中…" : view.state === "existing" ? "生成新的邀请链接" : "生成我的邀请链接"}
          </button>
        )}
        {view && view.state === "existing" && view.link && (
          <button type="button" className="btn ghost sm" onClick={() => void issue(true)} disabled={busy}>再生成一条（旧链接仍然有效）</button>
        )}
        {!view && <button type="button" className="btn ghost sm" onClick={() => void issue(false)} disabled={busy}>重试</button>}
      </div>
      {notice && <p className="referral-notice">{notice}</p>}
      <p className="referral-tip">朋友从这条链接首次开通工作区时，推荐关系会自动登记到你名下；已有账号的老用户直接登录，不重复绑定。</p>
    </section>
  );
}

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
        <ReferralLinkCard />
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

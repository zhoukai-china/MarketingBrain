import { useCallback, useEffect, useRef, useState } from "react";
import { apiPath, getAppPath } from "../lib/api.js";
import { authHeaders, fetchMarketMe, guestToLogin, readJson, Topbar } from "./shell.js";
import "../styles/referral-card.css";

/**
 * 市场合伙人后台（老板 2026-09-18 验收意见）。
 *
 * 原来这块（PLAT-49 专属链接 + PLAT-48 第③批只读分销后台）挂在**用户端「我的」页**上，
 * 老板的原话：「不应该给所有用户展示啊，就是个单独的后台，由我单独找市场合伙人发放，
 * 不应该在用户端。」所以改成**独立地址 `/partner`**：
 * - 不进任何用户端导航（顶栏、工作地图都不出现），地址由平台方单独发给合伙人；
 * - 资格仍然是服务端 fail-closed（`MarketPartnerGrant`）：未授予的用户打开只看到「无资格」提示，
 *   `GET/POST /market/me/partner-link` 依旧返回 403，佣金与客户数据也不会下发；
 * - 授予/撤销留在管理后台（`/agents/admin` 的「市场合伙人」页），那里同时给出这个入口地址。
 */

/** 市场合伙人专属链接（PLAT-49）：未授予资格时整张卡片不渲染（fail-closed）。 */
interface PartnerLinkView {
  state: "forbidden" | "none" | "existing" | "created";
  link: string | null;
  code: string | null;
  codePreview: string | null;
  qrSvg: string | null;
  linksCount: number;
  hint: string;
}

function PartnerLinkCard({ onForbidden }: { onForbidden: () => void }) {
  const [view, setView] = useState<PartnerLinkView | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState(false);
  const stateVersionRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const version = stateVersionRef.current;
    void (async () => {
      try {
        const response = await fetch(apiPath("/market/me/partner-link"), { headers: authHeaders(), cache: "no-store" });
        if (response.status === 403) {
          if (!cancelled) {
            setForbidden(true);
            onForbidden();
          }
          return;
        }
        const data = await readJson<PartnerLinkView>(response);
        if (!cancelled && stateVersionRef.current === version) setView(data);
      } catch {
        if (!cancelled) setNotice("市场合伙人专属链接暂时读取失败，稍后可重试。");
      }
    })();
    return () => { cancelled = true; };
  }, [onForbidden]);

  async function issue(regenerate: boolean) {
    setBusy(true);
    setNotice("");
    setCopied(false);
    try {
      const response = await fetch(apiPath("/market/me/partner-link"), {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify({ regenerate })
      });
      if (response.status === 403) {
        setForbidden(true);
        onForbidden();
        return;
      }
      const data = await readJson<PartnerLinkView>(response);
      stateVersionRef.current += 1;
      setView(data);
      if (data.state === "created") setNotice("已生成，复制或保存后即可发给客户。");
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
      setNotice("链接已复制，粘贴给客户即可。");
    } catch {
      setNotice("浏览器没让复制，请手动选中下面的链接复制。");
    }
  }

  if (forbidden) return null;

  return (
    <section className="referral-card" data-partner-card>
      <header>
        <h3>市场合伙人专属链接</h3>
        <span className="chip">{view?.codePreview ? `已有专属链接 ${view.codePreview}` : "还没有专属链接"}</span>
      </header>
      <p className="referral-hint">{view?.hint ?? "正在读取市场合伙人专属链接…"}</p>

      {view?.link ? (
        <div className="referral-link-row">
          <input readOnly value={view.link} onFocus={(event) => event.currentTarget.select()} aria-label="市场合伙人专属链接" />
          <button type="button" className="btn primary sm" onClick={() => void copyLink()}>{copied ? "已复制" : "复制链接"}</button>
        </div>
      ) : null}

      {view?.qrSvg ? (
        <div className="referral-qr" data-partner-qr dangerouslySetInnerHTML={{ __html: view.qrSvg }} />
      ) : null}

      <div className="referral-actions">
        {view && view.state === "existing" && view.link ? (
          <button type="button" className="btn ghost sm" onClick={() => void issue(true)} disabled={busy}>再生成一条（旧链接仍然有效）</button>
        ) : null}
        {view && view.state !== "created" && !view.link ? (
          <button type="button" className="btn primary sm" onClick={() => void issue(false)} disabled={busy}>
            {busy ? "生成中…" : "生成我的专属链接"}
          </button>
        ) : null}
        {!view ? (
          <button type="button" className="btn ghost sm" onClick={() => void issue(false)} disabled={busy}>重试</button>
        ) : null}
      </div>
      {notice && <p className="referral-notice">{notice}</p>}
      <p className="referral-tip">客户从这条链接首次开通工作区时，会自动归因到你名下；其充值后消耗的付费积分，按已确认口径为你计算佣金（佣金展示在下面的分销数据里）。</p>
    </section>
  );
}

/** 市场合伙人只读分销后台（PLAT-48 第③批）：只显示当前用户自己的客户与佣金。 */
interface PartnerDashboardView {
  isPartner: boolean;
  partner?: {
    name: string;
    code: string;
    totalEarningsCny: number;
    frozenAmountCny: number;
    availableAmountCny: number;
    totalWithdrawnCny: number;
    customerCount: number;
  };
  customers?: Array<{
    tenantId: string;
    name: string;
    source: string;
    registeredAt: string;
    industry: string | null;
    city: string | null;
    rechargedCredits: number;
    consumedCredits: number;
    commissionCny: number;
  }>;
}

function PartnerDashboardCard() {
  const [view, setView] = useState<PartnerDashboardView | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(apiPath("/market/me/partner-dashboard"), { headers: authHeaders(), cache: "no-store" });
        const data = await readJson<PartnerDashboardView>(response);
        if (!cancelled) setView(data);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "分销后台读取失败，稍后可重试。");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (view && view.isPartner === false) return null;

  return (
    <section className="referral-card" data-partner-dashboard>
      <header>
        <h3>我的分销数据</h3>
        {view?.partner ? <span className="chip">客户 {view.partner.customerCount} 个</span> : null}
      </header>
      {error && <p className="referral-notice">{error}</p>}
      {!view ? <p className="referral-hint">正在读取分销数据…</p> : view.partner ? (
        <>
          <div className="mine-top" style={{ marginTop: "0.6rem" }}>
            <div className="balance-card"><div className="bc-label">可提现佣金</div><div className="bc-val">¥{view.partner.availableAmountCny.toFixed(2)}</div><div className="bc-sub">已解冻</div></div>
            <div className="balance-card"><div className="bc-label">冻结佣金</div><div className="bc-val">¥{view.partner.frozenAmountCny.toFixed(2)}</div><div className="bc-sub">冻结期内</div></div>
            <div className="balance-card"><div className="bc-label">累计佣金</div><div className="bc-val">¥{view.partner.totalEarningsCny.toFixed(2)}</div><div className="bc-sub">含已提现</div></div>
          </div>
          {view.customers && view.customers.length > 0 ? (
            <div className="mine-tip" style={{ marginTop: "0.8rem" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.86rem" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: "0.35rem 0.4rem", borderBottom: "1px solid #e6e6e6" }}>客户</th>
                    <th style={{ textAlign: "right", padding: "0.35rem 0.4rem", borderBottom: "1px solid #e6e6e6" }}>充值积分</th>
                    <th style={{ textAlign: "right", padding: "0.35rem 0.4rem", borderBottom: "1px solid #e6e6e6" }}>消耗积分</th>
                    <th style={{ textAlign: "right", padding: "0.35rem 0.4rem", borderBottom: "1px solid #e6e6e6" }}>佣金</th>
                  </tr>
                </thead>
                <tbody>
                  {view.customers.map((customer) => (
                    <tr key={customer.tenantId}>
                      <td style={{ padding: "0.35rem 0.4rem", borderBottom: "1px solid #f2f2f2" }}>
                        <div>{customer.name}</div>
                        <div style={{ color: "#888", fontSize: "0.78rem" }}>{[customer.industry, customer.city].filter(Boolean).join(" · ") || "—"}</div>
                      </td>
                      <td style={{ textAlign: "right", padding: "0.35rem 0.4rem", borderBottom: "1px solid #f2f2f2" }}>{customer.rechargedCredits}</td>
                      <td style={{ textAlign: "right", padding: "0.35rem 0.4rem", borderBottom: "1px solid #f2f2f2" }}>{customer.consumedCredits}</td>
                      <td style={{ textAlign: "right", padding: "0.35rem 0.4rem", borderBottom: "1px solid #f2f2f2" }}>¥{customer.commissionCny.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="referral-tip">还没有客户经你的专属链接注册；把链接发给客户后，这里会出现客户与佣金。</p>
          )}
        </>
      ) : null}
    </section>
  );
}

export function MarketPartnerConsolePage() {
  // 本地有 token 不代表还登录着（token 可能已过期）；只有服务端确认过才算已登录。
  const [signedIn, setSignedIn] = useState(() => Boolean(localStorage.getItem("store_os_token")));
  const [balance, setBalance] = useState<number | null>(null);
  const [forbidden, setForbidden] = useState(false);
  /**
   * 无资格时由页面**整页**给出人话提示：卡片自己 `return null` 会让页面只剩标题，
   * 合伙人会以为「链接功能坏了」，所以状态要往页面层上报。
   */
  const handleForbidden = useCallback(() => setForbidden(true), []);

  useEffect(() => {
    let cancelled = false;
    void fetchMarketMe<{ creditBalance: number }>()
      .then((data) => {
        if (cancelled) return;
        if (!data) {
          setSignedIn(false);
          return;
        }
        setBalance(data.creditBalance);
      })
      .catch(() => { /* 读不到余额不影响资格判定 */ });
    return () => { cancelled = true; };
  }, []);

  if (!signedIn) {
    return (
      <main className="app-wrap">
        <Topbar active="me" balance={null} onNavigate={(p) => { window.location.href = getAppPath(p); }} />
        <section className="view view-mine">
          <h1>市场合伙人后台</h1>
          <div className="login-gate big">🔒 你还未登录<p>这个后台只对本人开放，登录后即可查看专属链接与分销数据。</p><button className="btn primary" onClick={() => guestToLogin("/partner")}>登录</button></div>
        </section>
      </main>
    );
  }

  return (
    <main className="app-wrap">
      <Topbar active="me" balance={balance} onNavigate={(p) => { window.location.href = getAppPath(p); }} />
      <section className="view view-mine">
        <h1>市场合伙人后台</h1>
        <p className="mine-tip">这个地址由平台单独发给市场合伙人，不在用户端展示；客户拿到的只是你的专属链接。</p>
        {forbidden ? (
          <div className="login-gate big">🔒 你还没有市场合伙人资格<p>这个后台只对已授权的市场合伙人开放；需要开通请联系平台管理员。</p></div>
        ) : (
          <>
            <PartnerLinkCard onForbidden={handleForbidden} />
            <PartnerDashboardCard />
          </>
        )}
      </section>
    </main>
  );
}

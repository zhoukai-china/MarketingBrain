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
  /**
   * 推荐活动是否开放（用户 2026-09-16：「暂时不开放，等我通知，预计 10.1–10.7 再开放，先下架」）。
   * 服务端按活动开关 + 活动窗判断；为 false 时整张卡片不渲染。
   */
  campaignActive?: boolean;
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

  /**
   * 活动没开就**整张卡片不渲染**（用户 2026-09-16：先下架，等 10.1–10.7 活动再开放）。
   * 判断由服务端给（`campaignActive`），活动开关一开卡片自己回来，不用改代码。
   */
  if (view && view.campaignActive === false) return null;

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
  /**
   * 用户 2026-09-16：客户被多扣的积分退了，但他自己看不到（这里原来只列消耗）。
   * 服务端把「与客户切身相关」的退回（Word 导出重复扣费）单独给出来，这里显式展示 +N 积分。
   */
  const [refunds, setRefunds] = useState<Array<{ id: string; label: string; amountCredits: number; createdAt: string }>>([]);
  /**
   * 历史交付物（用户 2026-09-16：「用户历史产物在我的下载，告知用户保存 7 天请及时下载」）。
   * 服务端只留 7 天，这里把「交付时间 + 剩余可下载天数」直接写出来，让客户自己抓紧存。
   */
  const [deliverables, setDeliverables] = useState<Array<{ id: string; skuName?: string | null; answer: string; credits: number; createdAt: string; expiresAt: string }>>([]);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  async function downloadDeliverable(item: { id: string; answer: string; skuName?: string | null }): Promise<void> {
    setDownloadingId(item.id);
    try {
      const response = await fetch(apiPath("/exports/docx"), {
        method: "POST",
        headers: { ...authHeaders(true), "content-type": "application/json" },
        body: JSON.stringify({ title: `历史交付物-${item.skuName ?? "智能体"}`, content: item.answer })
      });
      const data = (await response.json().catch(() => ({}))) as { downloadUrl?: string; message?: string };
      if (!response.ok || !data.downloadUrl) throw new Error(data.message ?? "导出失败");
      // 与对话页同一口径：把真实链接交给浏览器/系统去下载（手机才能交给 WPS）。
      window.location.assign(apiPath(data.downloadUrl));
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "导出失败，请稍后重试。");
    } finally {
      setDownloadingId(null);
    }
  }
  const [loading, setLoading] = useState(true);
  // 本地有 token 不代表还登录着（token 可能已过期）；只有服务端确认过才算已登录，
  // 否则这里会一边显示余额区一边显示「未登录」，用户点登录又被弹回来。
  const [signedIn, setSignedIn] = useState(() => Boolean(localStorage.getItem("store_os_token")));

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetchMarketMe<{ creditBalance: number; recentPpu: Array<{ id: string; skuName?: string | null; amountCredits: number; createdAt: string }>; recentRefunds?: Array<{ id: string; label: string; amountCredits: number; createdAt: string }> }>()
      .then((d) => {
        if (cancelled) return;
        if (!d) {
          setSignedIn(false);
          setBalance(null);
          return;
        }
        setBalance(d.creditBalance);
        setRecent(d.recentPpu ?? []);
        setRefunds(d.recentRefunds ?? []);
      })
      .catch(() => { if (!cancelled) setBalance(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    void fetch(apiPath("/market/me/deliverables"), { headers: authHeaders(), cache: "no-store" })
      .then((response) => (response.ok ? readJson<{ deliverables?: Array<{ id: string; skuName?: string | null; answer: string; credits: number; createdAt: string; expiresAt: string }> }>(response) : null))
      .then((data) => { if (!cancelled && data?.deliverables) setDeliverables(data.deliverables); })
      .catch(() => {
        /* 拿不到历史交付物不影响页面其它内容 */
      });
    return () => { cancelled = true; };
  }, []);

  /**
   * 「常用智能体」（`/mine#recent`）是同一页的锚点入口：整页加载时 React 还没渲染出那段，
   * 浏览器自身的 hash 定位常常落空，所以数据到齐后再主动滚一次。
   */
  useEffect(() => {
    if (window.location.hash !== "#recent") return;
    document.getElementById("recent")?.scrollIntoView({ block: "start" });
  }, [loading]);

  if (!signedIn) {
    return (
      <main className="app-wrap">
        <Topbar active="me" balance={null} onNavigate={(p) => { window.location.href = getAppPath(p); }} />
        <section className="view view-mine"><div className="login-gate big">🔒 你还未登录<p>登录后可查看积分余额与使用记录。</p><button className="btn primary" onClick={() => guestToLogin("/mine")}>登录</button></div></section>
      </main>
    );
  }

  return (
    <main className="app-wrap">
      <Topbar active="me" balance={balance} onNavigate={(p) => { window.location.href = getAppPath(p); }} />
      <section className="view view-mine">
        <h1>我的</h1>
        <div className="mine-top">
          <div className="balance-card"><div className="bc-label">积分余额</div><div className="bc-val">💎 {balance ?? "—"}</div><div className="bc-sub">全平台通用</div><button className="btn ghost sm" onClick={() => { window.location.href = getAppPath("/recharge"); }}>+ 充值积分</button></div>
          <div className="shared-card wide">💎 <b>跨智能体通用</b><br />同一份积分，在创始人IP专区与各行业专区的智能体都能用——只充一次，处处可用。</div>
        </div>
        <ReferralLinkCard />
        {/* 「常用智能体」导航栏锚点：同一页直接定位到这段使用记录。 */}
        <h3 id="recent">近期使用记录</h3>
        {loading ? <div className="loading">正在加载…</div> : recent.length === 0 ? <p className="mine-tip">暂无使用记录</p> : (
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
        {/* 历史交付物（服务端保留 7 天）：明确告诉客户「及时下载」，并提供一键导出 Word。 */}
        {deliverables.length > 0 && (
          <>
            <h3>历史交付物 · 保存 7 天，请及时下载</h3>
            <p className="mine-tip">
              平台只为你保留 <b>7 天</b>，到期自动清理；需要长期保存请点「下载 Word」存到自己手机/电脑（用 WPS 或 Word 都能打开）。
            </p>
            <div className="card-grid">
              {deliverables.map((item) => {
                const daysLeft = Math.max(0, Math.ceil((new Date(item.expiresAt).getTime() - Date.now()) / 86_400_000));
                return (
                  <article className="agent-card owned-card" key={item.id}>
                    <div className="ac-ico">📄</div>
                    <div className="ac-name">{item.skuName ?? "智能体交付物"}</div>
                    <div className="ac-price">消耗 {item.credits} 积分</div>
                    <div className="ac-foot">
                      <span className="chip owned">{new Date(item.createdAt).toLocaleDateString("zh-CN")} · 剩余 {daysLeft} 天</span>
                    </div>
                    <button
                      type="button"
                      className="btn primary"
                      disabled={downloadingId === item.id}
                      onClick={() => void downloadDeliverable(item)}
                    >
                      {downloadingId === item.id ? "正在准备…" : "下载 Word"}
                    </button>
                  </article>
                );
              })}
            </div>
          </>
        )}
        {refunds.length > 0 && (
          <>
            <h3>积分退回</h3>
            <div className="card-grid">
              {refunds.map((entry) => (
                <article className="agent-card owned-card" key={entry.id}>
                  <div className="ac-ico">↩️</div>
                  <div className="ac-name">{entry.label}</div>
                  <div className="ac-price">+{entry.amountCredits} 积分</div>
                  <div className="ac-foot"><span className="chip owned">{new Date(entry.createdAt).toLocaleDateString("zh-CN")}</span></div>
                </article>
              ))}
            </div>
          </>
        )}
      </section>
    </main>
  );
}

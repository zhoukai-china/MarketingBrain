import { useEffect, useState } from "react";
import { apiPath, getAppPath, getAppRoutePath } from "../lib/api.js";
import { readSessionToken } from "../lib/session.js";
import { referenceCaseForSku, type ReferenceCase } from "./reference-cases.js";
import { authHeaders, fetchMarketMe, guestToLogin, handleStaleSession, readJson, Topbar } from "./shell.js";
import {
  bundleSteps,
  bundleTotal,
  isBundle,
  isComingSoon,
  type MarketplaceIndustry,
  type MarketplaceSku
} from "./sku-model.js";

/**
 * 双保险（2026-09-16，WorkBuddy 全链路检测 B1）：服务端已剥离 `useCase` 里的历史前缀
 * 「一次使用 = 」，但若线上出现「API 还是旧版本、网页已是新版本」的错位，模板这里会再拼一次
 * 前缀而重复渲染。渲染前再剥一遍，保证用户永远只看到一次。
 */
function stripLegacyUsePrefix(value: string): string {
  return value.replace(/^\s*(?:1|一)\s*次使用\s*[=＝:：]?\s*/, "").trim();
}

export function MarketplaceAgentDetailPage({ skuId }: { skuId: string }) {
  const [sku, setSku] = useState<MarketplaceSku | null>(null);
  const [industry, setIndustry] = useState<MarketplaceIndustry | null>(null);
  const [all, setAll] = useState<MarketplaceSku[]>([]);
  const [balance, setBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [benchmark, setBenchmark] = useState<ReferenceCase | null>(null);
  /**
   * 包月状态（用户 2026-09-17 二次反馈：`/agent/ipzone__copy` 上「并没有文案包月功能」）。
   *
   * 之前包月只做在对话页的「请先确认需求」面板里，用户要先填完几轮问答才看得到，
   * 详情页一个字都没有——用户根本走不到那个入口。这里把套餐入口放到用户实际打开的页面上。
   */
  const [subscribing, setSubscribing] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [subscriptionNotice, setSubscriptionNotice] = useState("");
  const [rechargeHref, setRechargeHref] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const [detail, catalog] = await Promise.all([
          fetch(apiPath(`/market/skus/${encodeURIComponent(skuId)}`)).then((r) => readJson<{ sku: MarketplaceSku; industry: MarketplaceIndustry | null }>(r)),
          fetch(apiPath("/market/skus")).then((r) => readJson<{ skus: MarketplaceSku[] }>(r))
        ]);
        if (cancelled) return;
        setSku(detail.sku);
        setIndustry(detail.industry);
        setAll(catalog.skus);
      } catch (reason) {
        if (!cancelled) setNotice(reason instanceof Error ? reason.message : "智能体不存在");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [skuId]);

  useEffect(() => {
    let cancelled = false;
    void fetchMarketMe<{ creditBalance: number }>()
      .then((d) => { if (!cancelled) setBalance(d ? d.creditBalance : null); })
      .catch(() => { if (!cancelled) setBalance(null); });
    return () => { cancelled = true; };
  }, []);

  if (loading) return <main className="app-wrap"><Topbar active="market" balance={null} onNavigate={(p) => { window.location.href = getAppPath(p); }} /><div className="loading">正在加载智能体…</div></main>;
  if (!sku) return <main className="app-wrap"><Topbar active="market" balance={null} onNavigate={(p) => { window.location.href = getAppPath(p); }} /><div className="search-empty">智能体不存在或已下架。</div></main>;

  const bundle = isBundle(sku);
  const steps = bundleSteps(sku, all);
  const total = bundleTotal(sku, all);
  const runSku = bundle ? steps[0] ?? sku : sku;
  const soon = isComingSoon(sku);
  /** 参考样例只对有样例的智能体有意义；没有样例时按钮不该出现（见下方 B4 注释）。 */
  const refCase = referenceCaseForSku(sku.skuCode) ?? null;

  function startChat() {
    if (!runSku || soon) return;
    window.location.href = getAppPath(`/agent/${encodeURIComponent(runSku.skuCode)}/chat`);
  }

  /**
   * 这个智能体是否卖包月：由 `marketplace-v3.json` 的 `sub` 配置经接口透到 SKU 字段，
   * 页面上只读字段、不写死价格（`subscriptionCredits` 为空 = 只有按结果交付）。
   */
  const subscriptionOffer = (sku.subscriptionCredits ?? 0) > 0
    ? {
        credits: sku.subscriptionCredits as number,
        dailyQuota: sku.subscriptionDailyQuota ?? null,
        quota: sku.subscriptionQuota ?? null
      }
    : null;
  const subscriptionQuotaText = subscriptionOffer
    ? subscriptionOffer.quota ?? (subscriptionOffer.dailyQuota == null ? "不限次数" : `每天 ${subscriptionOffer.dailyQuota} 条`)
    : "";

  /**
   * 开通包月。
   *
   * 与对话页走**同一个** `POST /market/subscriptions`，服务端语义也一致：
   * 已在包月期内会把当前这期原样返回（`alreadySubscribed`，不重复消耗积分），
   * 余额不足在扣费前 402 并带回充值入口。
   */
  async function subscribeMonthly() {
    if (!subscriptionOffer || !runSku || subscribing) return;
    if (!readSessionToken()) {
      guestToLogin(`${getAppRoutePath(window.location.pathname)}${window.location.search}`);
      return;
    }
    setSubscribing(true);
    setSubscriptionNotice("");
    setRechargeHref("");
    try {
      const response = await fetch(apiPath("/market/subscriptions"), {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify({ skuId: runSku.skuCode })
      });
      if (handleStaleSession(response.status)) {
        throw new Error("登录已过期，本地登录信息已清除。请点右上角「未登录 · 点击登录」重新登录后再开通；本次不消耗积分。");
      }
      if (response.status === 402) {
        const payload = (await response.json().catch(() => ({}))) as { message?: string };
        setSubscriptionNotice(
          `${payload.message ?? `开通包月需要 ${subscriptionOffer.credits} 积分，当前积分不足，请先充值。`}`
          + "（本次不消耗积分；充完回来再点「开通包月」即可。）"
        );
        setRechargeHref(
          getAppPath(
            `/recharge?from=agent&skill=${encodeURIComponent(runSku.skuCode)}`
            + `&next=${encodeURIComponent(`${getAppRoutePath(window.location.pathname)}${window.location.search}`)}`
          )
        );
        return;
      }
      const result = await readJson<{
        alreadySubscribed?: boolean;
        credits?: number;
        balance?: number;
        subscription?: { endDate?: string | null; dailyQuota?: number | null } | null;
        subscriptionStatus?: { dailyQuota?: number | null; usedToday?: number; endDate?: string | null };
      }>(response);
      const dailyQuota = result.subscriptionStatus?.dailyQuota ?? result.subscription?.dailyQuota ?? subscriptionOffer.dailyQuota;
      const endDate = result.subscriptionStatus?.endDate ?? result.subscription?.endDate ?? null;
      const usedToday = result.subscriptionStatus?.usedToday ?? 0;
      setBalance(typeof result.balance === "number" ? result.balance : balance);
      setSubscribed(true);
      const until = endDate ? new Date(endDate).toLocaleDateString("zh-CN") : "";
      const quotaText = dailyQuota == null ? "不限次数" : `每天 ${dailyQuota} 条`;
      setSubscriptionNotice(
        result.alreadySubscribed
          ? `你已经在包月期内了，这次没有重复消耗积分：${quotaText}，额度每天 0 点恢复${until ? `，本期末到 ${until}` : ""}。`
          : `✅ 包月已开通：本期已消耗 ${result.credits ?? subscriptionOffer.credits} 积分（${quotaText}${until ? `，本期末到 ${until}` : ""}）。`
            + `从现在起，本智能体的生成不再额外消耗积分${dailyQuota == null ? "" : `；今天还剩 ${Math.max(0, dailyQuota - usedToday)} 条`}。`
      );
    } catch (reason) {
      setSubscriptionNotice(reason instanceof Error ? reason.message : "开通失败，请稍后再试。");
    } finally {
      setSubscribing(false);
    }
  }

  return (
    <main className="app-wrap">
      <Topbar active="market" balance={balance} onNavigate={(p) => { window.location.href = getAppPath(p); }} />
      <section className="view view-detail">
        <button className="back" onClick={() => { window.location.href = getAppPath("/agents"); }}>‹ 返回商城</button>
        <div className="detail-grid">
          <div className="detail-main">
            <div className="d-head"><span className="d-ico">{sku.icon}</span><div><h1>{sku.name}</h1><div className="d-cat">{sku.zoneName}{sku.verbs.length ? ` · ${sku.verbs.join(" / ")}` : ""}</div></div></div>
            <div className="completes-card">🎯 <b>一次使用 = 帮你完成：</b>{stripLegacyUsePrefix(sku.useCase)}</div>
            {sku.need && <div className="need-card">🧩 <b>使用前准备：</b>{sku.need}<div className="need-hint">准备好这些，AI 会逐轮主动提问，每轮只补一个维度；信息齐了再生成全案，产出更贴你。</div></div>}
            {industry && !industry.general && (
              <div className="ind-card">
                <div className="ind-h">🏭 {industry.title.replace("专区", "")}专属 · 说{industry.title.replace("专区", "")}的行话，不说外行话</div>
                {industry.who && <div className="ind-row"><span>服务谁</span><b>{industry.who}</b></div>}
                {industry.lexicon.length > 0 && <div className="ind-row"><span>行业术语</span><b>{industry.lexicon.join(" · ")}</b></div>}
                {industry.pains.length > 0 && <div className="ind-row"><span>典型痛点</span><b>{industry.pains.join(" · ")}</b></div>}
                {industry.redline.length > 0 && <div className="ind-row cr-redline"><span>合规红线</span><b>{industry.redline.join(" · ")}</b></div>}
              </div>
            )}
            <h3>能力介绍</h3><p className="d-cap">{sku.description}</p>
            {sku.tags.length > 0 && <><h3>能力标签</h3><div className="ac-verbs">{sku.tags.map((t) => <span key={t}>{t}</span>)}</div></>}
          </div>

          <aside className="detail-buy">
            {soon && (
              <div className="zone-soon">🚧 <b>该智能体正在开发中</b>：能力介绍和输出参考案例可以先看，暂未开放使用。上线后可直接使用，和平台其他智能体共用同一份积分，不需要重复充值。</div>
            )}
            <div className="use-card">
              <div className="use-label">开始使用 · 对话式智能体</div>
              {soon
                ? <div className="use-quick off">🚧 开发中 · 敬请期待</div>
                : <div className="use-quick" onClick={startChat}>💬 直接进对话体验 ›</div>}
              <div className="use-sub">AI 会先读你上传的资料，再按对应方法论<b>逐轮主动提问</b>补全信息，最后产出结构化结果。</div>
            </div>
            <div className="price-card">
              {bundle ? (
                <div className="pc-block">
                  <div className="pc-label">分步交付 · 走一步交付一步</div>
                  <div className="pc-pts">{steps.length} <span>步 · 走完全链路</span></div>
                  <div className="pk-steps">
                    {steps.map((s, i) => <div className="pk-row" key={s.skuCode}><i>{i + 1}</i><b>{s.name.replace(/智能体$/, "")}</b><span>第 {i + 1} 步</span></div>)}
                    <div className="pk-row total"><i>Σ</i><b>走完全链路</b><span>{steps.length} 步</span></div>
                  </div>
                  <button className="btn primary block" disabled={soon} onClick={startChat}>{soon ? "开发中 · 敬请期待" : "开始第 1 步"}</button>
                  {soon
                    ? <div className="pc-note">🚧 组合内各环节正在开发中，上线后开放按环节使用。</div>
                    : <div className="pc-note">🎯 <b>不用一次走完</b>：进入后一步一步来，每步交付完才结算——<b>中途停下来，没做的环节不消耗积分</b>。</div>}
                </div>
              ) : (
                <div className="pc-block">
                  <div className="pc-label">用一次 · 交付什么</div>
                  <div className="pc-result">{sku.useCase}</div>
                  <button className="btn primary block" disabled={soon} onClick={startChat}>{soon ? "开发中 · 敬请期待" : "直接开始"}</button>
                  {soon
                    ? <div className="pc-note">🚧 该智能体内核正在开发中，暂不能发起生成；上线时间以公告为准。</div>
                    : <div className="pc-note">🎯 <b>按结果交付</b>：一次拿到上面那份完整交付物；如需再要一份，重新发起一次即可，用量按实际消耗计算。</div>}
                </div>
              )}
              {/*
               * 包月套餐块（用户 2026-09-17 二次反馈：`/agent/ipzone__copy` 上看不到「文案包月」）。
               *
               * 只对配置了 `sub` 的 SKU 渲染：套餐价与每日条数全部来自接口字段，页面上不写死数字，
               * 以后给别的智能体上包月（`marketplace-v3.json` 加 `sub`）这个块会自动出现。
               *
               * 不违反 PLAT-31「不前置报价」：那条禁的是**按次**报价（「N 积分/次」「约扣 N 积分」与折算人民币写法）；
               * 包月是用户拍板「可以自己选包月或按消耗计费」的独立售卖方案，价格必须看得见。
               */}
              {subscriptionOffer && !bundle && !soon && (
                <div className="pc-block sub">
                  <div className="pc-label">📅 也可以按月订阅 · 订阅期内生成不再额外消耗积分</div>
                  <div className="pc-pts">{subscriptionOffer.credits}<span> 积分/月</span></div>
                  <div className="pc-quota">{subscriptionQuotaText}</div>
                  {subscribed ? (
                    <>
                      <button className="btn primary block" onClick={startChat}>💬 开始用（本次不消耗积分）</button>
                      <div className="pc-subnote">包月期内额度每天 0 点恢复；本期结束前再来生成都不会再消耗积分。</div>
                    </>
                  ) : (
                    <>
                      <button
                        className="btn primary block"
                        disabled={subscribing}
                        onClick={() => { void subscribeMonthly(); }}
                      >
                        {subscribing ? "正在开通…" : `📅 开通包月：${subscriptionOffer.credits} 积分/月`}
                      </button>
                      <div className="pc-subnote">低频使用按结果交付更划算；高频用选包月，订阅期内不再消耗积分。</div>
                    </>
                  )}
                  {subscriptionNotice && (
                    <div className="pc-subnote" style={{ color: "var(--accent2)" }}>
                      {subscriptionNotice}
                      {rechargeHref && (
                        <>
                          {" "}
                          <button
                            type="button"
                            className="btn ghost sm"
                            onClick={() => { window.location.href = rechargeHref; }}
                          >
                            去充值（回来接着开通）
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}
              {/*
               * 方案②：行业专属样例按完整 SKU 命中，通用专区一律回落通用中性样例。
               *
               * 2026-09-16（WorkBuddy 全链路检测 B4）：之前**永远**渲染这个按钮，但兰琪美业门店经营大脑
               * （`lanqi__lanqi-brain`）是**品牌工作台入口**、不是单次生成的智能体，也没有参考案例——
               * 点下去什么都不会发生，用户以为坏了。现在没有样例就不给样例按钮，工作台入口给真正的入口。
               */}
              {refCase ? (
                <button className="btn ghost block demo-chat-btn" onClick={() => setBenchmark(refCase)}>👀 输出参考案例 · 不消耗积分</button>
              ) : sku.skuCode === "lanqi__lanqi-brain" ? (
                <>
                  <div className="pc-note">🧭 这是<b>品牌工作台入口</b>，不是单次生成的智能体：进去后用门店档案、经营诊断、到店获客与卡项客户管理（需要兰琪授权）。</div>
                  <button className="btn primary block" onClick={() => { window.location.href = getAppPath("/lanqi"); }}>进入品牌工作台</button>
                </>
              ) : null}
            </div>
            <div className="shared-card">💎 <b>一份积分，全平台通用</b><br />创始人IP专区与各行业专区的智能体共用同一份积分；在 WorkBuddy 里用思潼智能体，用的也是这份积分。</div>
            {notice && <div className="notice">{notice}</div>}
          </aside>
        </div>
      </section>

      {benchmark && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 80, background: "var(--ovl-bg)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
          onClick={() => setBenchmark(null)}
        >
          <div
            style={{ maxWidth: 760, width: "100%", maxHeight: "86vh", overflow: "auto", background: "var(--drawer-bg)", border: "1px solid var(--line)", borderRadius: 18, padding: "22px 24px", color: "var(--text)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", marginBottom: 10 }}>
              <div>
                <div style={{ color: "var(--muted)", fontSize: 13 }}>输出参考案例 · 不消耗积分 · 不调用模型</div>
                <h2 style={{ margin: "4px 0 0", fontSize: 22 }}>{sku.name}</h2>
              </div>
              <button className="back" onClick={() => setBenchmark(null)}>关闭</button>
            </div>
            <div style={{ background: "var(--glass)", border: "1px solid var(--line)", borderRadius: 12, padding: "10px 14px", marginBottom: 16, color: "var(--muted)", fontSize: 14 }}>
              {benchmark.input}
            </div>
            {benchmark.html ? (
              <div style={{ fontSize: 15 }} dangerouslySetInnerHTML={{ __html: benchmark.html }} />
            ) : (
              <>
                <div style={{ fontSize: 17, fontWeight: 700, margin: "0 0 10px" }}>{benchmark.title}</div>
                {(benchmark.rows ?? []).map((row) => (
                  <div key={row.k} style={{ display: "grid", gridTemplateColumns: "minmax(120px,200px) 1fr", gap: 12, padding: "10px 0", borderTop: "1px solid rgba(255,255,255,.07)" }}>
                    <b style={{ color: "var(--accent2)" }}>{row.k}</b>
                    <span style={{ color: "var(--text)", lineHeight: 1.65, whiteSpace: "pre-wrap" }}>{row.v}</span>
                  </div>
                ))}
                <p style={{ marginTop: 16, color: "var(--muted-2)", fontSize: 12, lineHeight: 1.6 }}>
                  🔒 案例已做脱敏处理：客户品牌名、创始人姓名、可反推的具体数据均已隐去或模糊化。实际产出由智能体按你的输入逐轮推导，非套用固定模板。
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </main>
  );
}

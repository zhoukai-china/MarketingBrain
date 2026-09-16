import { useEffect, useState } from "react";
import { apiPath, getAppPath } from "../lib/api.js";
import { referenceCaseForSku, type ReferenceCase } from "./reference-cases.js";
import { fetchMarketMe, readJson, Topbar } from "./shell.js";
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

  return (
    <main className="app-wrap">
      <Topbar active="market" balance={balance} onNavigate={(p) => { window.location.href = getAppPath(p); }} />
      <section className="view view-detail">
        <button className="back" onClick={() => { window.location.href = getAppPath("/agents"); }}>‹ 返回货架</button>
        <div className="detail-grid">
          <div className="detail-main">
            <div className="d-head"><span className="d-ico">{sku.icon}</span><div><h1>{sku.name}</h1><div className="d-cat">{sku.zoneName}{sku.verbs.length ? ` · ${sku.verbs.join(" / ")}` : ""}</div></div></div>
            <div className="completes-card">🎯 <b>一次使用 = 帮你完成：</b>{stripLegacyUsePrefix(sku.useCase)}</div>
            {sku.need && <div className="need-card">🧩 <b>使用前准备：</b>{sku.need}<div className="need-hint">准备好这些，AI 一次引导提问就能补全，产出更贴你。</div></div>}
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

import { useEffect, useMemo, useState } from "react";
import { apiPath, getAppPath } from "../lib/api.js";
import { clearExistingUserReferralNotice, readExistingUserReferralNotice } from "../lib/referral-notice.js";
import { fetchMarketMe, readJson, Topbar } from "./shell.js";
import {
  bundleSteps,
  groupByZone,
  isBundle,
  isComingSoon,
  type MarketplaceSku,
  type MarketplaceZone
} from "./sku-model.js";

export function MarketplaceHomePage() {
  const [zones, setZones] = useState<MarketplaceZone[]>([]);
  const [skus, setSkus] = useState<MarketplaceSku[]>([]);
  const [query, setQuery] = useState("");
  const [zone, setZone] = useState("");
  const [balance, setBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  /** 老账号带推荐码登录的一次性提示（见 lib/referral-notice.js）。 */
  const [referralNotice, setReferralNotice] = useState(() => readExistingUserReferralNotice());
  const dismissReferralNotice = () => {
    clearExistingUserReferralNotice();
    setReferralNotice(false);
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [zoneData, skuData] = await Promise.all([
          fetch(apiPath("/market/zones")).then((r) => readJson<{ zones: MarketplaceZone[] }>(r)),
          fetch(apiPath("/market/skus")).then((r) => readJson<{ skus: MarketplaceSku[] }>(r))
        ]);
        if (cancelled) return;
        setZones(zoneData.zones);
        setSkus(skuData.skus);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchMarketMe<{ creditBalance: number }>()
      .then((d) => { if (!cancelled) setBalance(d ? d.creditBalance : null); })
      .catch(() => { if (!cancelled) setBalance(null); });
    return () => { cancelled = true; };
  }, []);

  const q = query.trim().toLowerCase();
  /** 专区级命中：搜「美业」即使单个 SKU 名称不含，也要把该专区整组带出（用户 2026-09-13 反馈）。 */
  const zoneHits = useMemo(() => {
    const queryText = query.trim().toLowerCase();
    if (!queryText) return new Set<string>();
    return new Set(
      zones
        .filter((z) => `${z.name} ${z.tagline ?? ""} ${z.prefix ?? ""}`.toLowerCase().includes(queryText))
        .map((z) => z.key)
    );
  }, [zones, query]);

  const filtered = useMemo(() => {
    return skus.filter((sku) => {
      if (zone && sku.zone !== zone) return false;
      if (!q) return true;
      const hay = [sku.name, sku.skuCode, sku.zoneName, sku.badge ?? "", sku.description, sku.useCase, sku.need, ...sku.verbs, ...sku.tags, ...sku.keywords].join(" ").toLowerCase();
      return q.split(/\s+/).every((term) => hay.includes(term)) || zoneHits.has(sku.zone);
    });
  }, [skus, query, zone, zoneHits]);

  const groups = useMemo(() => groupByZone(filtered, zones), [filtered, zones]);

  /**
   * 2026-09-16（WorkBuddy 全链路检测 B2）：专区自身一个 SKU 都没有时（`canyin`/`chongwu` 未 ready，
   * `expert` 是「先建栏、后放专家」的 ready 空栏），分类栏以前显示「0」，点进去是一片空白——
   * 用户看到的是「这平台没东西」。这里按**专区总量**判断（不是搜索结果数，避免搜索无命中被误判成「待上线」），
   * 空专区统一给「即将上线 / 待上线」+ 占位说明，绝不留白屏。
   */
  const zoneSkuCount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const sku of skus) counts.set(sku.zone, (counts.get(sku.zone) ?? 0) + 1);
    return counts;
  }, [skus]);

  return (
    <main className="app-wrap">
      <Topbar active="market" balance={balance} onNavigate={(p) => { window.location.href = getAppPath(p); }} />
      {referralNotice && (
        <div
          role="status"
          style={{
            maxWidth: 1100,
            margin: "10px auto 0",
            padding: "10px 14px",
            borderRadius: 12,
            border: "1px solid var(--line)",
            background: "var(--glass)",
            color: "var(--text)",
            fontSize: 13.5,
            lineHeight: 1.6,
            display: "flex",
            gap: 12,
            alignItems: "center",
            justifyContent: "space-between"
          }}
        >
          <span>
            ℹ️ 你已有工作区，本次是<b>直接登录</b>：推荐关系只在<b>被推荐人首次开通工作区</b>时建立，
            所以这次不会新增推荐归因——你现有的账号、积分和工作区都不受影响。
          </span>
          <button className="back" type="button" onClick={dismissReferralNotice}>知道了</button>
        </div>
      )}
      <section className="view view-home">
        <div className="hero">
          <div className="hero-anchor">行业 AI 解决方案 · 不是通用 AI 工具</div>
          <h1>懂你行业的 AI 智能体</h1>
          <p>同样是 IP 定位、直播话术、销售跟单，讲给美业门店听、和讲给餐饮店听，根本不是一套话。大厂做通用工具，我们只做行业解决方案——每个智能体说你行业的行话、盯你行业的痛点，不说外行话。</p>
          <div className="arch-note">🎯 <b>创始人IP专区</b>：定位 → 内容 → 直播 → 成交，什么行业都能用　·　<b>行业专区</b>：说该行业的行话、盯该行业的痛点、守该行业的规矩</div>
          <div className="hero-cta"><span className="h-cta-item">🏭 懂你的行业，不说外行话</span><span className="h-cta-item">💎 充一次，处处可用</span><span className="h-cta-item">📦 用一次，办成一件事</span></div>
        </div>

        <div className="shop-bar">
          <div className="searchbar"><span className="sb-ico">🔍</span><input type="text" placeholder="搜智能体：如 定位 / 朋友圈 / 直播复盘…" value={query} onChange={(e) => setQuery(e.target.value)} />{query && <span className="sb-clear" onClick={() => setQuery("")}>✕</span>}</div>
          <div className="zone-nav">
            <button className={`zone-chip ${zone === "" ? "on" : ""}`} onClick={() => setZone("")}>全部 <em>{skus.length}</em></button>
            {zones.map((z) => (
              <button key={z.key} className={`zone-chip ${zone === z.key ? "on" : ""}${z.ready ? "" : " soon"}`} onClick={() => setZone(z.key)}>
                {z.name.replace("专区", "")} {zoneSkuCount.get(z.key) ? <em>{zoneSkuCount.get(z.key)}</em> : <em>{z.ready ? "即将上线" : "待上线"}</em>}
              </button>
            ))}
          </div>
        </div>

        {loading ? <div className="loading">正在加载货架…</div> : (
          <div className="home-res">
            {groups.map(({ zone: z, items }) => (
              <div className="shelf" key={z.key}>
                <div className="shelf-head"><h2>{z.name}</h2><span className="shelf-tag">{z.tagline}</span></div>
                <div className="card-grid skill-grid">
                  {items.map((sku) => <AgentCard key={sku.id} sku={sku} all={skus} />)}
                </div>
              </div>
            ))}
            {zones.filter((z) => (zoneSkuCount.get(z.key) ?? 0) === 0 && (!query.trim() || zoneHits.has(z.key))).map((z) => (
              <div className="shelf" key={z.key}>
                <div className="shelf-head"><h2>{z.name}</h2><span className="shelf-tag">{z.tagline}</span></div>
                <div className="zone-soon">🚧 该专区正在上新，敬请期待。</div>
              </div>
            ))}
            {groups.length === 0 && <div className="search-empty">🔍 没有匹配「{query}」的智能体<br /><span>试试搜：定位 / 选题 / 文案 / 复盘 / 直播 / 销售 / 朋友圈 / 套装</span></div>}
          </div>
        )}
      </section>
    </main>
  );
}

function AgentCard({ sku, all }: { sku: MarketplaceSku; all: MarketplaceSku[] }) {
  const bundle = isBundle(sku);
  const soon = isComingSoon(sku);
  // 2026-09-13 用户口径：**不要在使用前反复告诉用户「要扣多少积分」**（感受不好），
  // 只在交付完成之后告诉他这次消耗了多少（见 chat 页的「本次消耗 N 积分」）。
  const priceText = soon
    ? `🧩 开发中 · 敬请期待`
    : bundle
      ? `分 ${bundleSteps(sku, all).length} 步交付`
      : "";
  return (
    <article className="agent-card skill-card" onClick={() => { window.location.href = getAppPath(`/agent/${encodeURIComponent(sku.skuCode)}`); }}>
      <div className="ac-top">
        <div className="ac-ico">{sku.icon}</div>
        <div className="ac-head">
          <div className="ac-name">{sku.name}</div>
          {sku.verbs.length > 0 && <div className="ac-verbs">{sku.verbs.map((v) => <span key={v}>{v}</span>)}</div>}
        </div>
        {(soon || sku.badge) && <div className="ac-tags">{soon && <span className="chip soon">🚧 开发中</span>}{sku.badge && <span className="chip kit">{sku.badge}</span>}</div>}
      </div>
      <p className="ac-use">{sku.useCase}</p>
      <div className="ac-need">🧩 需要：{(sku.need || "你的业务输入").split("；")[0]}…</div>
      {priceText ? <div className={`ac-price${soon ? " soon" : ""}`}>{priceText}</div> : null}
      <div className="ac-foot">{soon ? <span className="chip soon only">开发中 · 敬请期待</span> : <span className="chip go only">去看看 ›</span>}</div>
    </article>
  );
}

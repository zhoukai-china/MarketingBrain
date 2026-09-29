import { useState } from "react";
import { getAppPath, getPublicAssetPath } from "../lib/api.js";
import { MallTopbar } from "./MallTopbar.js";
import { PRODUCT_PAGES } from "./product-pages-data.js";

/**
 * 人民币直购 / OPC 商品详情页（F4–F6 点击后的内页，2026-09-29 用户拍板：完整模板）。
 * 内容照原型 agent-product-detail-demo-20260923.html 各商品 sec 逐字提取（见 product-pages-data.ts）。
 * 购买/加购为本地演示态（支付随后端能力上线）；OPC 两件明确标注「🧪 演示商品 · 购买不入算力余额」。
 */
export function ProductDetailPage({ productKey }: { productKey: string }) {
  const data = PRODUCT_PAGES[productKey];
  const [ctaNotice, setCtaNotice] = useState("");

  if (!data) {
    return (
      <main className="app-wrap ipd-page eh">
        <MallTopbar back="/agents" badge="商品详情" />
        <div className="pd-page">
          <div className="pd-card" style={{ textAlign: "center", padding: "60px 20px" }}>
            <div style={{ fontSize: 34 }}>🧭</div>
            <p style={{ color: "#94796B" }}>没有找到该商品，<a style={{ color: "#E86A00", cursor: "pointer" }} onClick={() => { window.location.href = getAppPath("/agents"); }}>回商城逛逛 ›</a></p>
          </div>
        </div>
      </main>
    );
  }

  function cta(label: string) {
    setCtaNotice(data.demo
      ? "🧪 演示商品 · 购买不入算力余额，支付随后端能力上线。"
      : "演示环境：支付随后端能力上线，商品已记录在本机购物意图。");
    void label;
  }

  return (
    <main className="app-wrap ipd-page eh">
      <MallTopbar back="/agents" badge={`${data.name} · 商品详情`} />
      <div className="pd-page">
        {/* 封面 Hero */}
        <div className="pd-cover">
          <img src={getPublicAssetPath(data.cover)} alt={data.name} />
          <span className="pd-cover-badge">{data.icon} {data.badge}</span>
          <span className="pd-scanline" />
        </div>

        {/* 标题区 */}
        <h1 className="pd-title">{data.heroTitle}</h1>
        <div className="pd-brandline">{data.brandLine} · {data.shopLine}</div>
        <p className="pd-desc">{data.desc}</p>
        {data.rating ? <div className="pd-rating">{data.rating}</div> : null}

        {/* 价格卡 */}
        <div className="pd-pricecard">
          <div className="pd-price-row">
            <b>{data.price}</b>
            {data.unit ? <span className="pd-unit">{data.unit}</span> : null}
          </div>
          <div className="pd-price-note">{data.priceNote}</div>
          <div className="pd-paynote">{data.payNote}</div>
          <div className="pd-perks">
            {data.perks.map((perk) => <span key={perk}>{perk}</span>)}
          </div>
          <div className="pd-cta">
            <button type="button" className="pd-btn outline" onClick={() => cta(data.cta.cart)}>{data.cta.cart}</button>
            {data.cta.buy ? (
              <button type="button" className="pd-btn primary" onClick={() => cta(data.cta.buy ?? "")}>{data.cta.buy}</button>
            ) : null}
          </div>
          {ctaNotice ? <div className="pd-cta-notice">{ctaNotice}</div> : null}
        </div>

        {/* 特性四卡 */}
        <div className="pd-feats">
          {data.features.map((f) => (
            <div key={f.t} className="pd-feat">
              <span className="pd-feat-ico">{f.icon}</span>
              <b>{f.t}</b>
              <p>{f.d}</p>
            </div>
          ))}
        </div>

        {/* 附加清单（包装清单 / 你将获得） */}
        {data.extras && data.extras.length ? (
          <div className="pd-card">
            <h3>{data.extrasTitle ?? "📦 清单"}</h3>
            <ul className="pd-list">
              {data.extras.map((x) => <li key={x}>{x}</li>)}
            </ul>
          </div>
        ) : null}

        {/* 分栏说明 */}
        <div className="pd-card">
          <div className="pd-tabs">
            {data.tabs.map((tab, i) => (
              <details key={tab.t} open={i === 0}>
                <summary>{tab.t}</summary>
                <ul className="pd-list">
                  {tab.lines.map((line) => <li key={line}>{line}</li>)}
                </ul>
              </details>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}

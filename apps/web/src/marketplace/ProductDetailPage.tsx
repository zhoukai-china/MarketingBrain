import { useState } from "react";
import { getAppPath, getPublicAssetPath } from "../lib/api.js";
import { MallTopbar } from "./MallTopbar.js";
import { BookingModal } from "./BookingModal.js";
import { PRODUCT_PAGES } from "./product-pages-data.js";
import { IconAuto } from "./IconGlyph.js";

type GalleryView = "cover" | "feat" | "after";

/**
 * F4–F6 商品详情页（未上线商品 · 预约制）。
 * 版式照原型 agent-product-detail-demo-20260923.html 的 product sec 落地：
 *   头图三视图（商品主图 / 核心卖点 / 售后保障）+ 缩略图切换 + 包装清单 + 底部 tabs。
 * 2026-09-29 用户拍板：F3–F7 均为未上线功能，页面按「未上线 · 预约中」呈现，
 *   CTA 为留手机号预约（非直接购买）；预约数据可在管理后台「商品预约」查看。
 */
export function ProductDetailPage({ productKey }: { productKey: string }) {
  const data = PRODUCT_PAGES[productKey];
  const [view, setView] = useState<GalleryView>("cover");
  const [tab, setTab] = useState(0);
  const [bookingOpen, setBookingOpen] = useState(false);

  if (!data) {
    return (
      <main className="app-wrap ipd-page pd-lite eh">
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

  const captions: Record<GalleryView, string> = {
    cover: `${data.name} · ${data.badge}`,
    feat: `核心卖点 · ${data.features.map((f) => f.t).join(" → ")}`,
    after: "售后保障 · 7 天无理由 · 1 年质保 · 包邮开票"
  };

  return (
    <main className="app-wrap ipd-page pd-lite eh">
      <MallTopbar back="/agents" badge={`${data.name} · 商品详情`} />

      {/* ============ 上半屏：左头图（三视图切换） + 右信息/价格/预约 ============ */}
      <section className="ipd-pd">
        <div className="ipd-gallery">
          <div className="ipd-gmain">
            {view === "cover" && (
              <div className="ipd-gview flush">
                <img className="ipd-pcover" src={getPublicAssetPath(data.cover)} alt={data.name} />
                <span className="pd-cover-badge"><IconAuto v={data.icon} /> {data.badge}</span>
              </div>
            )}
            {view === "feat" && (
              <div className="ipd-gview">
                <div className="pd-gfeat">
                  {data.features.map((f) => (
                    <div key={f.t} className="pf-row">
                      <span className="pf-ico"><IconAuto v={f.icon} /></span>
                      <div>
                        <b>{f.t}</b>
                        <span>{f.d}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {view === "after" && (
              <div className="ipd-gview">
                <div className="ipd-grate">
                  <b>7天</b>
                  <div className="ipd-stars lg">🛡️</div>
                  <span>{data.payNote}</span>
                </div>
              </div>
            )}
          </div>
          <div className="ipd-gthumbs">
            <button className={view === "cover" ? "on" : ""} title="商品主图" onClick={() => setView("cover")}><IconAuto v={data.icon} /></button>
            <button className={view === "feat" ? "on" : ""} title="核心卖点" onClick={() => setView("feat")}><IconAuto v="✨" /></button>
            <button className={view === "after" ? "on" : ""} title="售后保障" onClick={() => setView("after")}><IconAuto v="🛡️" /></button>
          </div>
          <div className="ipd-gcap">{captions[view]}</div>
        </div>

        <div className="ipd-info">
          <h1 className="ipd-title">{data.heroTitle} <small>（{data.brandLine}）</small></h1>
          <div className="ipd-status soon"><IconAuto v="🔔" /> 未上线 · 预约中 · 留手机号上线即通知</div>
          <p className="ipd-desc">{data.desc}</p>
          {data.rating ? <div className="ipd-rate">{data.rating}</div> : null}

          <div className="ipd-price">
            <div className="ipd-price-line">
              <span className="ipd-num">{data.price}</span>
              {data.unit ? <span className="ipd-unit">{data.unit}</span> : null}
              <span className="ipd-approx">{data.priceNote}</span>
            </div>
            <div className="ipd-price-meta">上线说明：<b>功能打磨中，暂不可购买</b> · 预约用户上线后享首发权益</div>
            <div className="pd-perks">
              {data.perks.map((p) => <span key={p}><IconAuto v={p} /></span>)}
            </div>
          </div>

          {data.extras && data.extras.length ? (
            <div className="ipd-deliver">
              <h3>{data.extrasTitle ?? "📦 包装清单"}</h3>
              <ul>
                {data.extras.map((x) => <li key={x}>{x}</li>)}
              </ul>
            </div>
          ) : null}

          <div className="ipd-cta-row">
            <button type="button" className="ipd-btn ghost" onClick={() => setBookingOpen(true)}><IconAuto v="🔔" /> 预约上线提醒</button>
            <button type="button" className="ipd-btn main" onClick={() => setBookingOpen(true)}><IconAuto v="📲" /> 预约体验 · 上线短信通知</button>
          </div>
          <div className="ipd-after-cta">
            未上线商品 · 留手机号，上线第一时间<b>短信通知</b> · 预约享首发权益
          </div>
        </div>
      </section>

      {/* ============ 下半屏：商品说明 / 规格参数 / 售后保障 ============ */}
      <section className="ipd-detail">
        <div className="ipd-tabs" role="tablist">
          {data.tabs.map((t, i) => (
            <button
              key={t.t}
              type="button"
              role="tab"
              aria-selected={tab === i}
              className={tab === i ? "ipd-tab on" : "ipd-tab"}
              onClick={() => setTab(i)}
            >{t.t}</button>
          ))}
        </div>
        <div className="ipd-panel">
          <ul className="pd-list">
            {(data.tabs[tab]?.lines ?? []).map((line) => <li key={line}>{line}</li>)}
          </ul>
        </div>
      </section>

      {bookingOpen ? (
        <BookingModal open productName={data.name} productKey={data.key} source="product-detail" onClose={() => setBookingOpen(false)} />
      ) : null}
    </main>
  );
}

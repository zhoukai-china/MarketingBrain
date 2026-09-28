// 直播话术师 · 商品详情页（/agent/ipzone__livescript/detail）
//
// 落地自设计原型 agent-product-detail-demo-20260923.html?agent=live-host（2026-09-28 用户指派）。
// 与 IpPos / Copy / Vidrev 详情页同一套骨架与 ipd- 样式（零新增 CSS），仅内容换成罗盘（livescript）：
//   ① 「⚡ 充值算力」→ /recharge
//   ② 「⚡ 立即使用」→ /agent/ipzone__livescript/workbench（直播话术工作台）
// 内容口径：
//   - livescript 在 FIXED_PRICE_SKUS（目录 ppu=200 算力）：价格卡「一口价 200 算力/场」，
//     原型里的「50 算力」是演示价，不照抄；「交付才扣 / 失败不扣费」按原型保留；
//   - 简报 6 字段与真实直播话术工作台一致（场次类型/品牌 主推/目标人群/转化动作/场次时长/交付深度）；
//   - 原型工作台地址写的旧 sku「live-host」→ 统一替换为真实地址「livescript」；
//   - 人物头像圈统一「橙渐变圆 + 姓氏字」（罗/郑/楠）。

import { useEffect, useState } from "react";
import { apiPath, getAppPath } from "../lib/api.js";
import { fetchMarketMe, readJson, Topbar } from "./shell.js";
import { employeeAvatarPath } from "./eco-mall-data.js";

const WORKBENCH_URL_TEXT = "ai.lcppch.top/agent/ipzone__livescript/workbench";
const WORKBENCH_PATH = "/agent/ipzone__livescript/workbench";

/** 脚本简报 6 字段（与 LivescriptWorkbench 的 FIELDS 同口径）。 */
const BRIEF_FIELDS = ["🎬 场次类型", "🏷️ 品牌 / 主推", "👥 目标人群", "🎯 转化动作", "⏱️ 场次时长", "📋 交付深度"] as const;

/** 本单交付清单（原型 deliver 区，逐字）。 */
const DELIVERABLES = [
  "整场脚本包：开场 / 留人 / 塑品 / 逼单 / 下播分区",
  "逐字稿可照读（时间轴 + 动作标签）",
  "合规红线内建：真实履历缺失标「待补」，不编造",
  "一场只主推一个转化动作，钩子收尾围着它转"
] as const;

/** 能力清单（原型 ability tab，逐字）。 */
const ABILITIES = [
  "按场次类型分流：招商加盟 / 带货 / 知识付费，两套打法不串场",
  "一次只问一个问题，回答自动填入脚本简报",
  "整场脚本包分区交付：时间轴逐字稿 + 动作标签，可照读",
  "合规红线内建：价格机制未确认不写进逼单，履历缺失标「待补」",
  "一场只主推一个转化动作——钩子和收尾都围着它转"
] as const;

/** 底层能力。 */
const FOUNDATIONS = [
  "直播话术要串行跑 9 段 + 附属件（约 5-10 分钟），进度逐件点亮",
  "节奏表按「每 20 分钟一浪」从开播排到下播",
  "交付可导出 Word / WPS 存档（免费）"
] as const;

/** 用户评价（原型 reviews tab；演示价改为不与固定价口径冲突的说法）。 */
const REVIEWS = [
  {
    initial: "郑",
    who: "郑总 · 鲜卤驿站城市合伙人项目",
    stars: 5,
    text: "第一场招商直播照着罗盘的脚本念，在线峰值破了我们记录——最值的是它把「待补」都标出来了，不敢瞎编。"
  },
  {
    initial: "楠",
    who: "楠楠 · 瑜伽馆小班课",
    stars: 5,
    text: "带货场和招商场是两套话术，罗盘分得很清，一场下来比请运营便宜太多了。"
  }
] as const;

/** 实拍③：整场脚本时间轴（原型 shot ③ 口径 + 工作台分段真源）。 */
const TIMELINE: Array<{ tm: string; title: string; text: string }> = [
  { tm: "⏱ 0:00-0:30", title: "开场留人", text: "【两步式自我介绍 · 量化结果】我是罗盘，做本地生意增长操盘出身…（履历缺失标「待补」）" },
  { tm: "⏱ 0:30-2:00", title: "塑品", text: "【一套系统 · 八个数字员工】获客、转化、复购替老板跑起来…" },
  { tm: "⏱ 2:00-115", title: "四套轮播 · 逼单", text: "痛点浪潮 → 系统演示 → 怎么赚钱 → 总部扶持，每 20 分钟一浪，钩子×3 轮换" },
  { tm: "⏱ 115-120", title: "收尾下播", text: "到点就收不硬拖；整场只围绕你选定的那一个转化动作" }
];

type TabKey = "ability" | "standard" | "shots" | "reviews";
type GalleryView = "wb" | "photo" | "rate";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "ability", label: "能力清单" },
  { key: "standard", label: "交付标准" },
  { key: "shots", label: "工作台实拍" },
  { key: "reviews", label: "用户评价" }
];

const VIEW_CAP: Record<GalleryView, string> = {
  wb: "工作台实况 · 开播引导 → 脚本简报 → 整场脚本包（一口价）",
  photo: "职业形象照 · 数字员工「罗盘」形象",
  rate: "用户口碑 · 评分与好评率"
};

function WbBar({ live }: { live: string }) {
  return (
    <div className="ipd-wb-bar">
      <span className="ipd-dots"><i /><i /><i /></span>
      <span className="ipd-wb-url">{WORKBENCH_URL_TEXT}</span>
      <span className="ipd-live">● {live}</span>
    </div>
  );
}

function WbChatHeader() {
  // 数字员工头像用系统内置形象（真实照片）；加载失败时回退姓氏字
  const av = employeeAvatarPath("ipzone__livescript");
  return (
    <div className="ipd-wb-chat-h">
      {av ? <img className="ipd-wb-av" src={av} alt="数字员工形象" /> : <span className="ipd-wb-av">罗</span>}
      <div>
        <b>罗盘 · 开播引导</b>
        <span>一次只问一个问题 · 按场次类型分流</span>
      </div>
    </div>
  );
}

function WbBrief({ filled }: { filled: number }) {
  return (
    <div className="ipd-ws">
      <div className="ipd-brief-h"><span>📋 脚本简报</span><b>{filled}/6</b></div>
      <div className="ipd-brief-grid">
        {BRIEF_FIELDS.map((f, i) => (
          <span key={f} className={i < filled ? "ipd-bf in" : "ipd-bf"}>{f}</span>
        ))}
      </div>
    </div>
  );
}

export function LivescriptDetailPage() {
  const [balance, setBalance] = useState<number | null>(null);
  const [tab, setTab] = useState<TabKey>("ability");
  const [view, setView] = useState<GalleryView>("wb");
  const avatar = employeeAvatarPath("ipzone__livescript");
  /** 真实目录价（livescript 固定价，FIXED_PRICE_SKUS）；一口价、单位「算力」。 */
  const [skuPpu, setSkuPpu] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchMarketMe<{ creditBalance: number }>()
      .then((d) => { if (!cancelled) setBalance(d ? d.creditBalance : null); })
      .catch(() => { if (!cancelled) setBalance(null); });
    void fetch(apiPath("/market/skus"))
      .then((r) => readJson<{ skus: Array<{ skuCode: string; ppu: number }> }>(r))
      .then((data) => {
        if (cancelled) return;
        const sku = data?.skus?.find((s) => s.skuCode === "ipzone__livescript");
        if (sku && typeof sku.ppu === "number") setSkuPpu(sku.ppu);
      })
      .catch(() => { /* 取不到就显示「一口价」，不阻塞 */ });
    return () => { cancelled = true; };
  }, []);

  return (
    <main className="app-wrap ipd-page">
      <Topbar active="chat" balance={balance} onNavigate={(p) => { window.location.href = getAppPath(p); }} />

      <button className="ipd-back" onClick={() => { window.location.href = getAppPath("/agents"); }}>‹ 返回商城</button>

      {/* ============ 上半屏：左头图（可切换视图） + 右信息/价格/CTA ============ */}
      <section className="ipd-pd">
        <div className="ipd-gallery">
          <div className="ipd-gmain">
            {view === "wb" && (
              <div className="ipd-gview flush">
                <div className="ipd-wb-frame">
                  <WbBar live="开播引导 · 场次分流" />
                  <div className="ipd-wb-body">
                    <div className="ipd-wb-chat">
                      <WbChatHeader />
                      <div className="ipd-msg q">这场直播是哪一种？先定「这场赚谁的钱」——两套打法完全不同，我不串场。</div>
                      <div className="ipd-opts">
                        <span>🤝 招商加盟</span>
                        <span>🛒 带货</span>
                        <span>📚 知识付费</span>
                      </div>
                      <div className="ipd-msg a">招商场——按「赚创业者的钱」配整场打法。全场唯一的转化动作是什么？钩子和收尾都围着它转。</div>
                      <div className="ipd-input"><span>🎤</span><i>打字或点 🎤 说话…</i><b>发送</b></div>
                    </div>
                    <div className="ipd-wb-right">
                      <WbBrief filled={4} />
                      <div className="ipd-gen">✨ 生成脚本包</div>
                      <div className="ipd-fee">先选场次类型 · 再选交付深度 · 逐字稿可照读 · 失败不扣费</div>
                    </div>
                  </div>
                </div>
              </div>
            )}
            {view === "photo" && (
              <div className="ipd-gview flush">
                {avatar
                  ? <img className="ipd-photo" src={avatar} alt="罗盘 · 职业形象照（数字员工形象）" />
                  : <div className="ipd-photo-fallback">罗</div>}
              </div>
            )}
            {view === "rate" && (
              <div className="ipd-gview">
                <div className="ipd-grate">
                  <b>4.9</b>
                  <div className="ipd-stars lg">★★★★★</div>
                  <span>近 30 天 · 100+ 场直播使用 · 好评率 97%</span>
                </div>
              </div>
            )}
          </div>
          <div className="ipd-gthumbs">
            <button className={view === "wb" ? "on" : ""} title="工作台实况" onClick={() => setView("wb")}>🧰</button>
            <button className={view === "photo" ? "on" : ""} title="职业形象照 · 数字员工形象" onClick={() => setView("photo")}>👤</button>
            <button className={view === "rate" ? "on" : ""} title="用户口碑" onClick={() => setView("rate")}>⭐</button>
          </div>
          <div className="ipd-gcap">{VIEW_CAP[view]}</div>
        </div>

        <div className="ipd-info">
          <h1 className="ipd-title">罗盘 · 直播话术师 <small>（直播脚本智能体）</small></h1>
          <div className="ipd-status">已上线 · 可直接对话</div>
          <p className="ipd-desc">
            开播前我按场次类型带你配齐整场信息——从开场到下播的脚本包一次交付：时间轴逐字稿可照读、动作标签清晰、合规红线内建，一场只主推一个转化动作。
          </p>
          <div className="ipd-rate">
            <b>4.9</b>
            <span className="ipd-stars">★★★★★</span>
            <span>100+ 场直播使用</span>
            <i>|</i>
            <span>好评率 97%</span>
          </div>

          <div className="ipd-price">
            <div className="ipd-price-line">
              <span className="ipd-num">{skuPpu ?? "—"}</span>
              <span className="ipd-unit">算力 / 场</span>
              <span className="ipd-approx">{skuPpu != null ? `≈ ¥${(skuPpu / 10).toFixed(1)}` : "≈ ¥"} · 整场直播逐字稿 · 一口价</span>
            </div>
            <div className="ipd-price-meta">计费说明：<b>0 元开通</b> · 不收月费 · 使用后扣算力，失败不扣费</div>
            <div className="ipd-guar">⚡ 1元 = 10算力　🎁 注册赠 100 算力　📄 账单逐笔可查</div>
          </div>

          <div className="ipd-deliver">
            <h3>本单交付</h3>
            <ul>
              {DELIVERABLES.map((d) => <li key={d}>{d}</li>)}
            </ul>
          </div>

          {/* 两处跳转（用户 2026-09-28 指定）：充值 → /recharge；立即使用 → 直播话术工作台 */}
          <div className="ipd-cta-row">
            <button className="ipd-btn ghost" onClick={() => { window.location.href = getAppPath("/recharge"); }}>⚡ 充值算力</button>
            <button className="ipd-btn main" onClick={() => { window.location.href = getAppPath(WORKBENCH_PATH); }}>
              ⚡ 立即使用{skuPpu != null ? `（${skuPpu} 算力/场）` : ""}
            </button>
          </div>
          <div className="ipd-after-cta">
            1 元 = 10 算力 · 本单 {skuPpu ?? "—"} 算力 ≈ ¥{skuPpu != null ? (skuPpu / 10).toFixed(1) : "—"} · <b>交付才扣 · 失败不扣费</b> · 交付物云端保存可回看
          </div>
        </div>
      </section>

      {/* ============ 下半屏：四个 tab ============ */}
      <section className="ipd-detail">
        <div className="ipd-tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.key} role="tab" aria-selected={tab === t.key}
              className={tab === t.key ? "ipd-tab on" : "ipd-tab"}
              onClick={() => setTab(t.key)}>{t.label}</button>
          ))}
        </div>

        {tab === "ability" && (
          <div className="ipd-panel">
            <h3>能力清单</h3>
            <ul className="ipd-foundation">
              {ABILITIES.map((a) => <li key={a}>{a}</li>)}
            </ul>
            <h3>底层能力</h3>
            <ul className="ipd-foundation">
              {FOUNDATIONS.map((f) => <li key={f}>{f}</li>)}
            </ul>
          </div>
        )}

        {tab === "standard" && (
          <div className="ipd-panel">
            <h3>交付口径</h3>
            <p>每次交付 1 份整场脚本包：直播总览（场景 / 目标 / 人群 / 合规边界）+ 开场 / 痛点 / 塑品 / 赚钱 / 扶持四套轮播脚本 + 钩子与应答（合规安全版）+ 收尾脚本 + 全场节奏表（每 20 分钟一浪）+ 场控清单。生成后自动存入「我的交付物」，可随时回看与导出。</p>
            <h3>质量标准</h3>
            <ul className="ipd-foundation">
              <li><b>过程：</b>先选场次类型、再选交付深度；简报齐了才放行生成，脚本包流式分区点亮，进度实时可见（约 5-10 分钟）</li>
              <li><b>口径：</b>真实价格没确认就不写逼单话术；履历缺失标「待补」，不编造；改简报可整包重跑</li>
              <li><b>计费：</b>一口价按场结算（1 元 = 10 算力），交付才扣算力，失败不扣费</li>
            </ul>
          </div>
        )}

        {tab === "shots" && (
          <div className="ipd-panel">
            {/* 实拍①：开播引导 · 场次分流 */}
            <div className="ipd-shot">
              <div className="ipd-shot-cap"><b>① 开播引导 · 场次分流</b><span>先定「这场赚谁的钱」再配打法；一次只问一个问题，没有的信息写「暂无」，绝不瞎编</span></div>
              <div className="ipd-wb lg">
                <WbBar live="开播引导" />
                <div className="ipd-wb-body">
                  <div className="ipd-wb-chat">
                    <WbChatHeader />
                    <div className="ipd-msg q">这场直播是哪一种？先定「这场赚谁的钱」——带货赚消费者、招商赚创业者，两套打法完全不同，我不串场。</div>
                    <div className="ipd-opts">
                      <span>🤝 招商加盟</span>
                      <span>🛒 带货</span>
                      <span>📚 知识付费</span>
                    </div>
                    <div className="ipd-msg a">招商场——先说品牌：有哪些看得见的硬实力？直营数据、供应链、培训体系…没有的先写「暂无」，我不瞎编。</div>
                    <div className="ipd-input"><span>🎤</span><i>打字或点 🎤 说话…</i><b>发送</b></div>
                  </div>
                  <div className="ipd-wb-right">
                    <WbBrief filled={2} />
                    <div className="ipd-fee">没有的信息写「暂无」 · 我不瞎编</div>
                  </div>
                </div>
              </div>
            </div>

            {/* 实拍②：简报确认 · 生成脚本包 */}
            <div className="ipd-shot">
              <div className="ipd-shot-cap"><b>② 简报确认 · 生成脚本包</b><span>6 项齐了才放行——先看简报再花钱；整场脚本包一口价按场结算，失败不扣费</span></div>
              <div className="ipd-wb lg">
                <WbBar live="简报确认" />
                <div className="ipd-wb-body">
                  <div className="ipd-wb-chat">
                    <WbChatHeader />
                    <div className="ipd-msg a">简报齐了 ✅ 确认后点「生成脚本包」——从开场到下播一次交付，全程围绕你选的转化动作。</div>
                    <div className="ipd-opts">
                      <span>✓ 确认，生成脚本包</span>
                      <span>✏️ 先改简报</span>
                    </div>
                    <div className="ipd-input"><span>🎤</span><i>打字或点 🎤 说话…</i><b>发送</b></div>
                  </div>
                  <div className="ipd-wb-right">
                    <WbBrief filled={6} />
                    <div className="ipd-gen">✨ 生成脚本包</div>
                    <div className="ipd-fee">整场脚本包流式分区点亮 · 失败不扣费</div>
                  </div>
                </div>
              </div>
            </div>

            {/* 实拍③：已交付 · 逐字稿可照读 */}
            <div className="ipd-shot">
              <div className="ipd-shot-cap"><b>③ 已交付 · 逐字稿可照读</b><span>时间轴 + 动作标签，从开场排到下播；每 20 分钟一浪，钩子收尾围绕唯一转化动作</span></div>
              <div className="ipd-wb lg">
                <WbBar live="脚本交付" />
                <div className="ipd-canvas">
                  {TIMELINE.map((t) => (
                    <div key={t.tm} className="ipd-zone">
                      <div className="ipd-zone-h">{t.tm} · {t.title}</div>
                      <p>{t.text}</p>
                    </div>
                  ))}
                </div>
                <div className="ipd-canvas-foot">
                  <span>时间轴 + 动作标签 · 逐字稿可照读 · 已存「我的交付物」</span>
                  <b>可导出 Word / WPS（免费）</b>
                </div>
              </div>
            </div>

            <div className="ipd-foot-note">
              头图与详情图均按罗盘直播话术工作台（{WORKBENCH_URL_TEXT}）的真实界面逻辑制作——<b>买到的就是这台工作台，所见即所得</b>。
            </div>
          </div>
        )}

        {tab === "reviews" && (
          <div className="ipd-panel">
            {REVIEWS.map((r) => (
              <div key={r.who} className="ipd-rev">
                <div className="ipd-rev-head">
                  <span className="ipd-rev-ava">{r.initial}</span>
                  <b>{r.who}</b>
                  <span className="ipd-rev-stars">{"★".repeat(r.stars)}</span>
                </div>
                <p>{r.text}</p>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

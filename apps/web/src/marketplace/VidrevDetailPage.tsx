// 视频复盘官 · 商品详情页（/agent/ipzone__vidrev/detail）
//
// 落地自设计原型 agent-product-detail-demo-20260923.html?agent=video-diag（2026-09-28 用户指派）。
// 与 IpPosDetailPage / CopyDetailPage 同一套骨架与 ipd- 样式（零新增 CSS），仅内容换成江流（vidrev）：
//   ① 「⚡ 充值算力」→ /recharge
//   ② 「⚡ 立即使用」→ /agent/ipzone__vidrev/workbench（视频复盘工作台）
// 内容口径：
//   - 计费与视频复盘工作台同源：按实际用量结算，价格取真实目录 ppu（/market/skus），单位「算力」；
//     原型里的「50 算力/次」是演示价，不照抄；「上传体检免费 / 校验不过不出报告 / 失败不扣费」按原型保留；
//   - 头图三视图：工作台实况（拖表上传 + 体检面板）/ 职业形象照（系统内置 video-diag 形象）/ 用户口碑；
//   - 人物头像圈统一「橙渐变圆 + 姓氏字」（江/谭/池）。

import { useEffect, useState } from "react";
import { apiPath, getAppPath } from "../lib/api.js";
import { readJson } from "./shell.js";
import { IconAuto, IconLead } from "./IconGlyph.js";
import { MallTopbar } from "./MallTopbar.js";
import { employeeAvatarPath } from "./eco-mall-data.js";

const WORKBENCH_URL_TEXT = "ai.lcppch.top/agent/ipzone__vidrev/workbench";
const WORKBENCH_PATH = "/agent/ipzone__vidrev/workbench";

/** 本单交付清单（原型 deliver 区，逐字）。 */
const DELIVERABLES = [
  "数据体检：播放 / 互动 / 成交 / 投流 7 项校验，缺列先教你怎么补",
  "11 章复盘报告：流量 / 互动 / 转化 / ROI 归因 / 钩子拆解 / 行动清单",
  "四象限分层：又爆而赚 · 爆而不赚 · 赚而不爆 · 不爆不赚",
  "支持抖音「作品明细」/ 视频号导出表 · 可导出 Word 存档"
] as const;

/** 能力清单（原型 ability tab，逐字）。 */
const ABILITIES = [
  "拖表上传：抖音「作品明细」/ 视频号导出表直接拖进来就能跑",
  "先体检、再复盘：7 项数据校验，缺列 / 错位先修再算，不出糊涂账",
  "四象限归因：每条视频给出「加投 / 止损 / 迭代 / 复制」动作建议",
  "体检不扣算力，出报告才扣；失败不扣费"
] as const;

/** 底层能力。 */
const FOUNDATIONS = [
  "按天汇总表 fail-closed 拒收，并给出后台导出指引",
  "受限维度降级口径写清（缺什么、影响哪一章），不编数字",
  "候选选题一键加入选题池，交付可导出 Word / CSV"
] as const;

/** 用户评价（原型 reviews tab，逐字）。 */
const REVIEWS = [
  {
    initial: "谭",
    who: "谭总 · 轻食沙拉店主理人",
    stars: 5,
    text: "按天汇总的表传上去，江流直接告诉我缺成交金额两列、还教我怎么导明细——补完一次跑通。四象限把 31 条视频分完，哪条加投哪条停，一目了然。"
  },
  {
    initial: "池",
    who: "池经理 · 家居门店运营",
    stars: 5,
    text: "以前复盘全靠感觉，现在「爆而不赚」的视频一眼就揪出来——上个月止损 3 条、复制 2 条，整体 ROI 从 1.2 提到 2.6。"
  }
] as const;

/** 数据体检 7 项（原型体检面板；warn=true 为演示「2 警告」态）。 */
const HEALTH_ITEMS: Array<{ label: string; warnKey: boolean }> = [
  { label: "▶️ 播放", warnKey: false },
  { label: "❤️ 互动", warnKey: false },
  { label: "⏱ 发布", warnKey: false },
  { label: "#️⃣ 话题", warnKey: false },
  { label: "💰 成交", warnKey: true },
  { label: "🚀 投流", warnKey: true },
  { label: "🧩 表结构", warnKey: false }
];

/** 四象限分层（原型实拍③）。 */
const QUADRANTS: Array<{ icon: string; name: string; text: string }> = [
  { icon: "🌟", name: "加投", text: "「同城探店 v3」播放 52w · ROI 3.8 → 追投同款钩子" },
  { icon: "😮", name: "止损", text: "「挂车晚 40s」播放 31w · ROI 0.4 → 本周重拍" },
  { icon: "🔧", name: "复制", text: "「后厨直拍」播放 0.9w · ROI 4.2 → 小众刚需 ×2" },
  { icon: "💤", name: "迭代", text: "常规内容 1.2w · ROI 1.1 → 结构微调" }
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
  wb: "工作台实况 · 拖表上传 → 先体检再复盘 → 11 章报告（按实际用量结算）",
  photo: "职业形象照 · 数字员工「江流」形象",
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
  const av = employeeAvatarPath("ipzone__vidrev");
  return (
    <div className="ipd-wb-chat-h">
      {av ? <img className="ipd-wb-av" src={av} alt="数字员工形象" /> : <span className="ipd-wb-av">江</span>}
      <div>
        <b>江流 · 复盘引导</b>
        <span>拖表上传 · 先体检、再复盘</span>
      </div>
    </div>
  );
}

/** 数据体检面板（headTitle/warn 控制演示态：7 项·2 警告 或 7/7 通过）。 */
function HealthPanel({ headTitle, warn }: { headTitle: string; warn: boolean }) {
  return (
    <div className="ipd-ws">
      <div className="ipd-brief-h"><span>{headTitle}</span><b>{warn ? "7 项 · 2 警告" : "7/7 通过"}</b></div>
      <div className="ipd-brief-grid">
        {HEALTH_ITEMS.map((it) => (
          <span key={it.label} className="ipd-bf in">{it.label} {warn && it.warnKey ? "⚠️" : "✅"}</span>
        ))}
      </div>
    </div>
  );
}

export function VidrevDetailPage() {
  const [tab, setTab] = useState<TabKey>("ability");
  const [view, setView] = useState<GalleryView>("wb");
  const avatar = employeeAvatarPath("ipzone__vidrev");
  /** 真实目录价（与视频复盘工作台同源 /market/skus）；按实际用量结算，单位「算力」。 */
  const [skuPpu, setSkuPpu] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch(apiPath("/market/skus"))
      .then((r) => readJson<{ skus: Array<{ skuCode: string; ppu: number }> }>(r))
      .then((data) => {
        if (cancelled) return;
        const sku = data?.skus?.find((s) => s.skuCode === "ipzone__vidrev");
        if (sku && typeof sku.ppu === "number") setSkuPpu(sku.ppu);
      })
      .catch(() => { /* 取不到就显示「按实际用量结算」，不阻塞 */ });
    return () => { cancelled = true; };
  }, []);

  return (
    <main className="app-wrap ipd-page eh">
      <MallTopbar back="/agents" badge="视频复盘智能体 · 商品详情" />


      {/* ============ 上半屏：左头图（可切换视图） + 右信息/价格/CTA ============ */}
      <section className="ipd-pd">
        <div className="ipd-gallery">
          <div className="ipd-gmain">
            {view === "wb" && (
              <div className="ipd-gview flush">
                <div className="ipd-wb-frame">
                  <WbBar live="数据体检 · 先体检再复盘" />
                  <div className="ipd-wb-body">
                    <div className="ipd-wb-chat">
                      <WbChatHeader />
                      <div className="ipd-msg q">把后台导出的数据表拖进来——抖音「作品明细」或视频号导出都行，我先体检、再复盘，不出糊涂账。</div>
                      <div className="ipd-msg a">🩺 体检完成：播放/互动正常，成交金额两列缺失 ⚠️、投流标记待确认 ⚠️。<br />按天汇总的表常有这问题——补一条逐条作品明细，我就能把 ROI 归因算准。</div>
                      <div className="ipd-input"><span>🎤</span><i>拖入数据表，或点 🎤 说话…</i><b>发送</b></div>
                    </div>
                    <div className="ipd-wb-right">
                      <HealthPanel headTitle="🩺 数据体检" warn />
                      <div className="ipd-gen">📦 生成复盘报告</div>
                      <div className="ipd-fee">上传体检不扣算力 · 校验不过不出报告 · 失败不扣费</div>
                    </div>
                  </div>
                </div>
              </div>
            )}
            {view === "photo" && (
              <div className="ipd-gview flush">
                {avatar
                  ? <img className="ipd-photo" src={avatar} alt="江流 · 职业形象照（数字员工形象）" />
                  : <div className="ipd-photo-fallback">江</div>}
              </div>
            )}
            {view === "rate" && (
              <div className="ipd-gview">
                <div className="ipd-grate">
                  <b>4.9</b>
                  <div className="ipd-stars lg">★★★★★</div>
                  <span>近 30 天 · 复盘视频 500+ 条 · 好评率 96%</span>
                </div>
              </div>
            )}
          </div>
          <div className="ipd-gthumbs">
            <button className={view === "wb" ? "on" : ""} title="工作台实况" onClick={() => setView("wb")}><IconAuto v="🧰" /></button>
            <button className={view === "photo" ? "on" : ""} title="职业形象照 · 数字员工形象" onClick={() => setView("photo")}><IconAuto v="👤" /></button>
            <button className={view === "rate" ? "on" : ""} title="用户口碑" onClick={() => setView("rate")}><IconAuto v="⭐" /></button>
          </div>
          <div className="ipd-gcap">{VIEW_CAP[view]}</div>
        </div>

        <div className="ipd-info">
          <h1 className="ipd-title">江流 · 视频复盘官 <small>（视频复盘智能体）</small></h1>
          <div className="ipd-status">已上线 · 可直接对话</div>
          <p className="ipd-desc">
            把后台导出的数据表拖进来，我先体检、再复盘——7 项数据校验缺列先告诉你怎么补；11 章报告把每条视频归因到「加投 / 止损 / 迭代 / 复制」，不再靠感觉猜哪条该投。
          </p>
          <div className="ipd-rate">
            <b>4.9</b>
            <span className="ipd-stars">★★★★★</span>
            <span>复盘视频 500+ 条</span>
            <i>|</i>
            <span>好评率 96%</span>
          </div>

          <div className="ipd-price">
            <div className="ipd-price-line">
              <span className="ipd-num">{skuPpu ?? "—"}</span>
              <span className="ipd-unit">算力 / 次 起</span>
              <span className="ipd-approx">{skuPpu != null ? `≈ ¥${(skuPpu / 10).toFixed(1)}` : "≈ ¥"} · 按实际用量结算</span>
            </div>
            <div className="ipd-price-meta">计费说明：<b>0 元开通</b> · 不收月费 · 上传体检免费，出报告才扣算力</div>
            <div className="ipd-guar"><IconAuto v="⚡" /> 1元 = 10算力　<IconAuto v="🎁" /> 注册赠 100 算力　<IconAuto v="📄" /> 账单逐笔可查</div>
          </div>

          <div className="ipd-deliver">
            <h3>本单交付</h3>
            <ul>
              {DELIVERABLES.map((d) => <li key={d}>{d}</li>)}
            </ul>
          </div>

          {/* 两处跳转（用户 2026-09-28 指定）：充值 → /recharge；立即使用 → 视频复盘工作台 */}
          <div className="ipd-cta-row">
            <button className="ipd-btn ghost" onClick={() => { window.dispatchEvent(new Event("sitong:open-recharge")); }}><IconAuto v="⚡" /> 充值算力</button>
            <button className="ipd-btn main" onClick={() => { window.location.href = getAppPath(WORKBENCH_PATH); }}>
              ⚡ 立即使用{skuPpu != null ? `（约 ${skuPpu} 算力/次）` : ""}
            </button>
          </div>
          <div className="ipd-after-cta">
            上传体检不扣算力 · <b>校验不过不出报告</b> · 出报告按实际用量结算（1 元 = 10 算力）· 失败不扣费
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
            <p>每次交付 1 份深度复盘报告（11 章）：第零章数据质量审计 + 数据总览 / 四象限分层 / 健康度 + 单条深拆 / 完播归因 / 互动分析 + 趋势 / 规律 / 方法论 + 下个周期选题建议。生成后自动存入「我的交付物」，可随时回看与导出。</p>
            <h3>质量标准</h3>
            <ul className="ipd-foundation">
              <li><b>过程：</b>拖表上传 → 体检报告先出（免费）→ 缺什么补什么 → 口径确认后生成，11 章报告流式点亮，约 60 秒</li>
              <li><b>口径：</b>上传体检不扣算力，出报告按实际用量结算；校验不过不出报告、不出糊涂账；交付可导出 Word</li>
              <li><b>数据：</b>按天汇总表拒收并给导出指引；受限维度（成交 / 投流缺失）按降级口径写清，不编数字</li>
            </ul>
          </div>
        )}

        {tab === "shots" && (
          <div className="ipd-panel">
            {/* 实拍①：上传即体检 */}
            <div className="ipd-shot">
              <div className="ipd-shot-cap"><b>① 上传即体检 · 免费不扣算力</b><span>拖表进来先做 7 项校验；按天汇总表缺成交金额会直接标 ⚠️，先教你怎么补——校验不过不出报告</span></div>
              <div className="ipd-wb lg">
                <WbBar live="数据体检" />
                <div className="ipd-wb-body">
                  <div className="ipd-wb-chat">
                    <WbChatHeader />
                    <div className="ipd-msg q">把后台导出的数据表拖进来——我先体检：7 项校验过一遍，缺列先告诉你怎么补。</div>
                    <div className="ipd-msg a">🩺 体检完成：表结构 ✅ · 播放/互动 ✅ · 成交金额两列缺失 ⚠️ · 投流标记待确认 ⚠️</div>
                    <div className="ipd-input"><span>🎤</span><i>拖入数据表，或点 🎤 说话…</i><b>发送</b></div>
                  </div>
                  <div className="ipd-wb-right">
                    <HealthPanel headTitle="🩺 数据体检" warn />
                    <div className="ipd-fee">体检不扣算力 · 缺列先教你补，不出糊涂账</div>
                  </div>
                </div>
              </div>
            </div>

            {/* 实拍②：口径确认 · 生成报告 */}
            <div className="ipd-shot">
              <div className="ipd-shot-cap"><b>② 口径确认 · 生成报告</b><span>7 项全过才放行生成——ROI 归因口径你来定；11 章报告按实际用量结算，失败不扣费</span></div>
              <div className="ipd-wb lg">
                <WbBar live="口径确认" />
                <div className="ipd-wb-body">
                  <div className="ipd-wb-chat">
                    <WbChatHeader />
                    <div className="ipd-msg a">数据齐了 ✅ 成交金额按「支付口径」还是「成交口径」算？确认后我开跑，约 60 秒。</div>
                    <div className="ipd-opts">
                      <span>✓ 支付口径，生成报告</span>
                      <span>✏️ 换成交口径</span>
                    </div>
                    <div className="ipd-input"><span>🎤</span><i>拖入数据表，或点 🎤 说话…</i><b>发送</b></div>
                  </div>
                  <div className="ipd-wb-right">
                    <HealthPanel headTitle="🩺 数据体检" warn={false} />
                    <div className="ipd-gen">📦 生成复盘报告</div>
                    <div className="ipd-fee">11 章流式点亮 · 失败不扣费</div>
                  </div>
                </div>
              </div>
            </div>

            {/* 实拍③：已交付 · 四象限分层 */}
            <div className="ipd-shot">
              <div className="ipd-shot-cap"><b>③ 已交付 · 四象限分层</b><span>31 条视频按「又爆而赚 / 爆而不赚 / 赚而不爆 / 不爆不赚」分完，第 11 章直接给行动清单</span></div>
              <div className="ipd-wb lg">
                <WbBar live="四象限交付" />
                <div className="ipd-canvas">
                  {QUADRANTS.map((q) => (
                    <div key={q.name} className="ipd-zone">
                      <div className="ipd-zone-h"><IconAuto v={q.icon} /> {q.name}</div>
                      <p>{q.text}</p>
                    </div>
                  ))}
                </div>
                <div className="ipd-canvas-foot">
                  <span>四象限 + 11 章 · 行动清单可执行 · 已存「我的交付物」</span>
                  <b>可导出 Word / CSV（免费）</b>
                </div>
              </div>
            </div>

            <div className="ipd-foot-note">
              头图与详情图均按江流视频复盘工作台（{WORKBENCH_URL_TEXT}）的真实界面逻辑制作——<b>买到的就是这台工作台，所见即所得</b>。
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

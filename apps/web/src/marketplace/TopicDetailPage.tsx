// 选题策略官 · 商品详情页（/agent/ipzone__topic/detail）
//
// 落地自设计原型 agent-product-detail-demo-20260923.html?agent=topic（2026-09-28 用户指派）。
// 与其余四个详情页同一套骨架与 ipd- 样式（零新增 CSS），内容为何策（topic）：
//   ① 「⚡ 充值算力」→ /recharge
//   ② 「⚡ 立即使用」→ /agent/ipzone__topic/workbench（选题工作台）
// 口径适配（用户要求：预约改成充值算力和立即使用）：
//   - 原型是「内测 / 预约」态：状态徽标改「已上线 · 可直接对话」；「📲 预约体验」改「⚡ 立即使用」；
//     「预约免费 / 留手机号」等内测文案全部替换为已上线计费口径；
//   - topic 按实际用量结算（不在 FIXED_PRICE_SKUS）：价格取真实目录 ppu，单位「积分」，
//     原型「99 算力（上线价）」是演示价不照抄；
//   - 头像：对话窗用系统内置形象（topic.jpg，真实照片）；评价区顾客保留姓氏字圆。

import { useEffect, useState } from "react";
import { apiPath, getAppPath } from "../lib/api.js";
import { fetchMarketMe, readJson, Topbar } from "./shell.js";
import { employeeAvatarPath } from "./eco-mall-data.js";

const WORKBENCH_URL_TEXT = "ai.lcppch.top/agent/ipzone__topic/workbench";
const WORKBENCH_PATH = "/agent/ipzone__topic/workbench";

/** 交付清单（原型 deliver 区，逐字）。 */
const DELIVERABLES = [
  "一批 5 条选题：每条带阶段标签 / 来源 / 参考结构",
  "四大来源喂料：私有知识库（主力）· 行业热点 · 对标账号 · 数据复盘",
  "三关筛选：一票否决 → 贴标签 → 按阶段配，不合格不出题",
  "与秦文 / 江流联动：选题 → 拍摄脚本 → 发布后复盘一条龙"
] as const;

/** 能力清单（原型 ability tab，逐字）。 */
const ABILITIES = [
  "四大来源自动喂料：私有知识库（主力）· 行业热点 · 对标账号 · 数据复盘",
  "三关筛选：一票否决（合规 / 常识错）→ 贴标签（行业 / 阶段）→ 按阶段配比",
  "一批 5 条：每条带阶段标签 + 来源 + 参考结构，拿去就能拍",
  "与秦文 / 江流联动：选题 → 拍摄脚本 → 发布后复盘一条龙"
] as const;

/** 底层能力。 */
const FOUNDATIONS = [
  "来源池可配置、阶段可切换（获客 / 转化 / 复购 / 裂变）",
  "私有知识库是独有素材，别人抄不走",
  "选题直接对接拍摄脚本与复盘，全链路闭环"
] as const;

/** 三关筛选（原型实拍②）。 */
const GATES: Array<{ icon: string; name: string; text: string }> = [
  { icon: "1️⃣", name: "一票否决", text: "合规 / 常识错 → 淘汰 6 条" },
  { icon: "2️⃣", name: "贴标签", text: "行业 × 阶段 → 打标 18 条" },
  { icon: "3️⃣", name: "按阶段配", text: "获客 3 + 转化 1 + 裂变 1 → 出一批 5 条" }
];

/** 已交付样例（原型头图选题清单节选）。 */
const SAMPLES: Array<{ title: string; meta: string }> = [
  { title: "「开业 90 天，同城获客成本砍下来一半的 3 个动作」", meta: "阶段：获客 · 来源：私有知识库 · 参考结构：反常识开头 + 数据佐证" },
  { title: "「顾客进店 30 秒，开口先说这一句」", meta: "阶段：转化 · 来源：对标账号 · 参考结构：场景痛点 + 一句话留人" },
  { title: "「老带新海报，别再写『转发有礼』」", meta: "阶段：裂变 · 来源：数据复盘 · 参考结构：反例开场 + 给模板" }
];

/** 用户评价（原型内测反馈 tab，逐字；内测字样保留——是真实内测商家）。 */
const REVIEWS = [
  {
    initial: "贺",
    who: "贺店长 · 轻食沙拉门店（内测）",
    stars: 5,
    text: "最值钱的是「按阶段配」——开业期 3 条获客题全被拍爆了，终于不用拍脑袋想选题。"
  },
  {
    initial: "齐",
    who: "齐经理 · 家居门店运营（内测）",
    stars: 5,
    text: "三关筛选把关很严，出来的题没有一条是发不出去的——热点题都被合规关筛过一遍，放心拍。"
  }
] as const;

/** 选题来源池 4 路（原型来源池面板）。 */
const SOURCES: Array<{ icon: string; name: string; main?: boolean }> = [
  { icon: "📚", name: "私有知识库", main: true },
  { icon: "🔥", name: "行业热点" },
  { icon: "🎯", name: "对标账号" },
  { icon: "📈", name: "数据复盘" }
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
  wb: "工作台实况 · 四大来源喂料 → 三关筛选 → 一批 5 条（按实际用量结算）",
  photo: "职业形象照 · 数字员工「何策」形象",
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
  const av = employeeAvatarPath("ipzone__topic");
  return (
    <div className="ipd-wb-chat-h">
      {av ? <img className="ipd-wb-av" src={av} alt="数字员工形象" /> : <span className="ipd-wb-av">何</span>}
      <div>
        <b>何策 · 选题访谈</b>
        <span>四大来源喂料 · 三关筛选出题</span>
      </div>
    </div>
  );
}

/** 选题来源池面板（原型右栏）。 */
function SourcePanel() {
  return (
    <div className="ipd-ws">
      <div className="ipd-brief-h"><span>🗂️ 选题来源池</span><b>4 路</b></div>
      <div className="ipd-brief-grid">
        {SOURCES.map((s) => (
          <span key={s.name} className="ipd-bf in">{s.icon} {s.name}{s.main ? " · 主力" : ""}</span>
        ))}
      </div>
    </div>
  );
}

export function TopicDetailPage() {
  const [balance, setBalance] = useState<number | null>(null);
  const [tab, setTab] = useState<TabKey>("ability");
  const [view, setView] = useState<GalleryView>("wb");
  const avatar = employeeAvatarPath("ipzone__topic");
  /** 真实目录价（topic 按实际用量结算），单位「积分」。 */
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
        const sku = data?.skus?.find((s) => s.skuCode === "ipzone__topic");
        if (sku && typeof sku.ppu === "number") setSkuPpu(sku.ppu);
      })
      .catch(() => { /* 取不到就显示「按实际用量结算」，不阻塞 */ });
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
                  <WbBar live="内测版 · 选题来源池" />
                  <div className="ipd-wb-body">
                    <div className="ipd-wb-chat">
                      <WbChatHeader />
                      <div className="ipd-msg q">先说说你的行业和阶段——门店起步期看获客、成熟期看转化，两头的选题策略完全不同。</div>
                      <div className="ipd-opts">
                        <span>🍽️ 餐饮门店</span>
                        <span>💪 瑜伽健身</span>
                        <span>🏠 家居建材</span>
                      </div>
                      <div className="ipd-msg a">本地生活服务 · 开业 3 个月——那这批题以「同城获客」为主，我从知识库和热点里配。</div>
                      <div className="ipd-input"><span>🎤</span><i>打字或点 🎤 说话…</i><b>发送</b></div>
                    </div>
                    <div className="ipd-wb-right">
                      <SourcePanel />
                      <div className="ipd-gen">✨ 出一批选题</div>
                      <div className="ipd-fee">预计消耗约 {skuPpu ?? "—"} 积分 · 按实际用量结算 · 失败不扣费</div>
                    </div>
                  </div>
                </div>
              </div>
            )}
            {view === "photo" && (
              <div className="ipd-gview flush">
                {avatar
                  ? <img className="ipd-photo" src={avatar} alt="何策 · 职业形象照（数字员工形象）" />
                  : <div className="ipd-photo-fallback">何</div>}
              </div>
            )}
            {view === "rate" && (
              <div className="ipd-gview">
                <div className="ipd-grate">
                  <b>4.9</b>
                  <div className="ipd-stars lg">★★★★★</div>
                  <span>50+ 商家使用 · 内测反馈全好评</span>
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
          <h1 className="ipd-title">何策 · 选题策略官 <small>（选题策划智能体）</small></h1>
          <div className="ipd-status">已上线 · 可直接对话</div>
          <p className="ipd-desc">
            不用再拍脑袋想选题——四大来源自动喂料（私有知识库为主力），三关筛选把关后一批给你 5 条，每条带阶段标签、来源和参考结构，拿去就能拍。
          </p>
          <div className="ipd-rate">
            <b>4.9</b>
            <span className="ipd-stars">★★★★★</span>
            <span>50+ 商家使用</span>
            <i>|</i>
            <span>内测反馈全好评</span>
          </div>

          <div className="ipd-price">
            <div className="ipd-price-line">
              <span className="ipd-num">{skuPpu ?? "—"}</span>
              <span className="ipd-unit">积分 / 次 起</span>
              <span className="ipd-approx">{skuPpu != null ? `≈ ¥${(skuPpu / 10).toFixed(1)}` : "≈ ¥"} · 按实际用量结算</span>
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

          {/* 两处跳转（用户 2026-09-28 指定：预约改成充值算力和立即使用） */}
          <div className="ipd-cta-row">
            <button className="ipd-btn ghost" onClick={() => { window.location.href = getAppPath("/recharge"); }}>⚡ 充值算力</button>
            <button className="ipd-btn main" onClick={() => { window.location.href = getAppPath(WORKBENCH_PATH); }}>
              ⚡ 立即使用{skuPpu != null ? `（约 ${skuPpu} 积分/次）` : ""}
            </button>
          </div>
          <div className="ipd-after-cta">
            1 元 = 10 算力 · 使用后扣算力 · <b>失败不扣费</b> · 交付物云端保存可回看
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
            <p>每次交付 1 批 5 条选题：每条带阶段标签（获客 / 转化 / 复购 / 裂变）、来源（知识库 / 热点 / 对标 / 复盘）和参考结构（开头 + 佐证方式），拿去就能拍。生成后自动存入「我的交付物」，可随时回看。</p>
            <h3>质量标准</h3>
            <ul className="ipd-foundation">
              <li><b>过程：</b>两问定行业和阶段 → 来源池自动配齐 → 三关筛选出题，一批 5 条流式点亮，约 30 秒</li>
              <li><b>口径：</b>来源池可配置、阶段可切换（获客 / 转化 / 复购 / 裂变）；按实际用量结算，失败不扣费</li>
              <li><b>联动：</b>选题 → 秦文拍摄脚本 → 江流发布后复盘，一条龙闭环</li>
            </ul>
          </div>
        )}

        {tab === "shots" && (
          <div className="ipd-panel">
            {/* 实拍①：配置四大来源 */}
            <div className="ipd-shot">
              <div className="ipd-shot-cap"><b>① 配置四大来源 · 知识库为主力</b><span>私有知识库是独有素材，别人抄不走；行业热点 / 对标账号 / 数据复盘做补充，来源池可配置</span></div>
              <div className="ipd-wb lg">
                <WbBar live="选题来源池" />
                <div className="ipd-wb-body">
                  <div className="ipd-wb-chat">
                    <WbChatHeader />
                    <div className="ipd-msg q">先说说你的行业和阶段——门店起步期看获客、成熟期看转化，两头的选题策略完全不同。</div>
                    <div className="ipd-opts">
                      <span>🍽️ 餐饮门店</span>
                      <span>💪 瑜伽健身</span>
                      <span>🏠 家居建材</span>
                    </div>
                    <div className="ipd-msg a">好，本地生活服务 · 获客期——来源池我按「知识库 12 篇 + 热点 5 条 + 对标 3 个」配，数据复盘等你跑起来再喂。</div>
                    <div className="ipd-input"><span>🎤</span><i>打字或点 🎤 说话…</i><b>发送</b></div>
                  </div>
                  <div className="ipd-wb-right">
                    <SourcePanel />
                    <div className="ipd-fee">知识库是你的独有素材 · 别人抄不走</div>
                  </div>
                </div>
              </div>
            </div>

            {/* 实拍②：三关筛选 */}
            <div className="ipd-shot">
              <div className="ipd-shot-cap"><b>② 三关筛选 · 一批 5 条</b><span>一票否决卡合规，贴标签定行业阶段，最后按你的经营阶段配比出题——不合格的不出</span></div>
              <div className="ipd-wb lg">
                <WbBar live="三关筛选" />
                <div className="ipd-canvas">
                  {GATES.map((g) => (
                    <div key={g.name} className="ipd-zone">
                      <div className="ipd-zone-h">{g.icon} {g.name}</div>
                      <p>{g.text}</p>
                    </div>
                  ))}
                </div>
                <div className="ipd-canvas-foot">
                  <span>三关全过才出题 · 每条带标签和参考结构</span>
                  <b>一批 5 条 · 按实际用量结算</b>
                </div>
              </div>
            </div>

            {/* 实拍③：已交付 · 一批 5 条 */}
            <div className="ipd-shot">
              <div className="ipd-shot-cap"><b>③ 已交付 · 一批 5 条（节选）</b><span>每条带「阶段标签 + 来源 + 参考结构」，三关筛选全过，拿去就能拍</span></div>
              <div className="ipd-wb lg">
                <WbBar live="选题交付" />
                <div className="ipd-canvas">
                  {SAMPLES.map((s) => (
                    <div key={s.title} className="ipd-zone">
                      <div className="ipd-zone-h">{s.title}</div>
                      <p>{s.meta}</p>
                    </div>
                  ))}
                </div>
                <div className="ipd-canvas-foot">
                  <span>一批 5 条 · 已存「我的交付物」</span>
                  <b>与拍摄脚本 / 复盘联动</b>
                </div>
              </div>
            </div>

            <div className="ipd-foot-note">
              头图与详情图均按何策选题工作台（{WORKBENCH_URL_TEXT}）的真实界面逻辑制作——<b>买到的就是这台工作台，所见即所得</b>。
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

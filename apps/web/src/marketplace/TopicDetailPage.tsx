// 选题策略官 · 商品详情页（/agent/ipzone__topic/detail）
//
// 落地自设计原型 agent-product-detail-demo-20260923.html?agent=topic（2026-09-28 用户指派）。
// 2026-09-28 E 线更新（同事 c540857：何策详情页对齐选题工作台逻辑）：
//   - 头图/实拍由「对话式访谈」改为**配置面板式**（四大来源配置卡 + 配额徽章 + 流水线步骤 +
//     三关 chip + 阶段按钮 + 运行指标 17/11/2/10，无对话框，与 topic 工作台一致）；
//   - 交付 5 条 → 10 条可换一批；三关命名对齐工作台（一票否决 → 对号入座 → 配比校准）；
//     阶段口径对齐（起号期 / 增长期 / 变现期）；数据链路 17 → 淘汰 6 → 打标 11 → 交付 10；
//   - 输出样例取自工作台交付表（类型 + 来源证据状态 + 创作建议）；内测评价术语同步。
// 与其余四个详情页同一套骨架与 ipd- 样式（零新增 CSS），内容为何策（topic）：
//   ① 「⚡ 充值算力」→ /recharge
//   ② 「⚡ 立即使用」→ /agent/ipzone__topic/workbench（选题工作台）
// 口径适配（用户要求：预约改成充值算力和立即使用）：
//   - 原型是「内测 / 预约」态：状态徽标改「已上线 · 可直接对话」；「📲 预约体验」改「⚡ 立即使用」；
//     「预约免费 / 留手机号」等内测文案全部替换为已上线计费口径；
//   - topic 按实际用量结算（不在 FIXED_PRICE_SKUS）：价格取真实目录 ppu，单位「算力」，
//     原型「99 算力（上线价）」是演示价不照抄；
//   - 头像：对话窗用系统内置形象（topic.jpg，真实照片）；评价区顾客保留姓氏字圆。

import { useEffect, useState } from "react";
import { apiPath, getAppPath } from "../lib/api.js";
import { readJson } from "./shell.js";
import { MallTopbar } from "./MallTopbar.js";
import { employeeAvatarPath } from "./eco-mall-data.js";

const WORKBENCH_URL_TEXT = "ai.lcppch.top/agent/ipzone__topic/workbench";
const WORKBENCH_PATH = "/agent/ipzone__topic/workbench";

/** 交付清单（原型 deliver 区，逐字，c540857 更新版：交付 5 → 10 条）。 */
const DELIVERABLES = [
  "交付 10 条选题：每条带类型 / 来源证据状态 / 创作建议，不满意可换一批",
  "四大来源喂料：私有知识库（主力）· 行业热点 · 对标账号 · 数据复盘",
  "候选池涌现：按配额出 16–20 条，缺源自动重分配",
  "三关筛选：一票否决 → 对号入座 → 配比校准，不合格不出题",
  "与秦文 / 江流联动：选题 → 拍摄脚本 → 发布后复盘一条龙"
] as const;

/** 能力清单（原型 ability tab，逐字，c540857 更新版）。 */
const ABILITIES = [
  "四大来源自动喂料：私有知识库（主力）· 行业热点 · 对标账号 · 数据复盘",
  "候选池涌现：按配额出 16–20 条，缺源自动重分配",
  "三关筛选：一票否决（无证据淘汰）→ 对号入座（类型 × 共识层级 × 客资准度）→ 配比校准（起号 / 增长 / 变现）",
  "交付 10 条：每条带类型 + 来源证据状态（✓ 通过 / ⏳ 待验证）+ 创作建议",
  "与秦文 / 江流联动：选题 → 拍摄脚本 → 发布后复盘一条龙"
] as const;

/** 三关筛选（c540857 三关命名对齐工作台：一票否决 → 对号入座 → 配比校准；数据链路 17→淘汰6→打标11→交付10）。 */
const GATES: Array<{ icon: string; name: string; text: string }> = [
  { icon: "1️⃣", name: "一票否决", text: "无证据淘汰 → 淘汰 6 条" },
  { icon: "2️⃣", name: "对号入座", text: "类型 × 共识层级 × 客资准度 → 打标 11 条" },
  { icon: "3️⃣", name: "配比校准", text: "起号 / 增长 / 变现 → 交付 10 条" }
];

/** 已交付样例（原型工作台交付表节选：类型 + 来源证据状态 + 创作建议）。 */
const SAMPLES: Array<{ title: string; meta: string }> = [
  { title: "① 越省钱越亏钱：小老板最容易算错的一笔账", meta: "认知型 · 私有知识 · 客户原话 · ✓ 通过（私信 3 人问过）· 建议：开头用客户原话，30 秒内给一个反例" },
  { title: "② 客户只问价不下单？你缺的不是折扣，是步骤", meta: "转化型 · 私有知识 · 销售记录 · ✓ 通过（客服高频）· 建议：先讲场景再给方法，结尾留咨询钩子" },
  { title: "③ 这个月大家都在聊的新规，对你说人话翻译", meta: "连接型 · 行业热点 · ⏳ 待验证（先核验官方来源）· 建议：注明来源与日期，24 小时内跟发" }
];

/** 选题流水线四步（原型头图 chip 行）。 */
const PIPELINE_STEPS = ["① 配置四大来源", "② 候选池涌现", "③ 三关筛选", "④ 交付 10 条"] as const;

/** 三关 chip（对齐工作台命名）。 */
const GATE_CHIPS = ["1️⃣ 一票否决", "2️⃣ 对号入座", "3️⃣ 配比校准"] as const;

/** 阶段口径（对齐工作台：起号期 / 增长期 / 变现期）。 */
const STAGES = ["起号期", "增长期", "变现期"] as const;

/** 运行指标（原型头图：17 候选池 / 11 过一关 / 2 待验证 / 10 交付）。 */
const METRICS: Array<{ num: string; label: string }> = [
  { num: "17", label: "候选池" },
  { num: "11", label: "过一关" },
  { num: "2", label: "待验证" },
  { num: "10", label: "交付" }
];

/** 四大来源配置卡（原型头图工作台实况：配置面板式 · 无对话框）。 */
const SOURCE_CARDS: Array<{ icon: string; name: string; main?: boolean; desc: string; quota: string; off?: boolean }> = [
  { icon: "📚", name: "私有知识库", main: true, desc: "录音卡笔记 / 客户原话 / 案例素材自动汇入", quota: "配额 35% · 候选 6 条" },
  { icon: "🔥", name: "行业热点", desc: "抖音检索 · 逐条核验来源，无来源不入池", quota: "配额 25% · 候选 3 条" },
  { icon: "🎯", name: "对标账号", desc: "粘贴主页链接 · 分析可借鉴角度入池", quota: "配额 20% · 候选 4 条" },
  { icon: "📈", name: "数据复盘", desc: "复盘智能体供稿 · 缺源自动重分配", quota: "未启用 · 配额已重分配", off: true }
];

/** 用户评价（原型内测反馈，c540857 术语同步：按阶段配→配比校准、合规关→一票否决）。 */
const REVIEWS = [
  {
    initial: "贺",
    who: "贺店长 · 轻食沙拉门店（内测）",
    stars: 5,
    text: "最值钱的是「配比校准」——开业期 3 条获客题全被拍爆了，终于不用拍脑袋想选题。"
  },
  {
    initial: "齐",
    who: "齐经理 · 家居门店运营（内测）",
    stars: 5,
    text: "三关筛选把关很严，出来的题没有一条是发不出去的——热点题都被一票否决筛过一遍，放心拍。"
  }
] as const;

type TabKey = "ability" | "standard" | "shots" | "reviews";
type GalleryView = "wb" | "photo" | "rate";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "ability", label: "能力清单" },
  { key: "standard", label: "交付标准" },
  { key: "shots", label: "工作台实拍" },
  { key: "reviews", label: "用户评价" }
];

const VIEW_CAP: Record<GalleryView, string> = {
  wb: "工作台实况 · 四大来源 → 候选池涌现 → 三关筛选 → 交付 10 条（按实际用量结算）",
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
        <b>何策 · 选题流水线</b>
        <span>配置即出题 · 无需对话</span>
      </div>
    </div>
  );
}

/** 来源池 chips 行（原型「4 路 · 缺源自动重分配」）。 */
function SourceChipRow() {
  return (
    <div className="ipd-ws">
      <div className="ipd-brief-h"><span>🗂️ 选题来源池</span><b>4 路 · 缺源自动重分配</b></div>
      <div className="ipd-brief-grid">
        <span className="ipd-bf in">📚 私有知识库 · 主力</span>
        <span className="ipd-bf in">🔥 行业热点</span>
        <span className="ipd-bf in">🎯 对标账号</span>
        <span className="ipd-bf in">📈 数据复盘</span>
      </div>
    </div>
  );
}

/** 四大来源配置卡（原型配置面板：配置卡 + 配额徽章 + 候选数；数据复盘未启用置灰）。 */
function SourceConfigPanel() {
  return (
    <div className="ipd-canvas">
      {SOURCE_CARDS.map((c) => (
        <div key={c.name} className="ipd-zone" style={c.off ? { opacity: 0.55 } : undefined}>
          <div className="ipd-zone-h">{c.icon} {c.name}{c.main ? " · 主力" : ""}</div>
          <p>{c.desc}</p>
          <p><b>{c.quota}</b></p>
        </div>
      ))}
    </div>
  );
}

/** 运行指标条（17 候选池 / 11 过一关 / 2 待验证 / 10 交付）。 */
function MetricsRow() {
  return (
    <div className="ipd-opts">
      {METRICS.map((m) => (
        <span key={m.label}><b>{m.num}</b> {m.label}</span>
      ))}
    </div>
  );
}

export function TopicDetailPage() {
  const [tab, setTab] = useState<TabKey>("ability");
  const [view, setView] = useState<GalleryView>("wb");
  const avatar = employeeAvatarPath("ipzone__topic");
  /** 真实目录价（topic 按实际用量结算），单位「算力」。 */
  const [skuPpu, setSkuPpu] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
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
    <main className="app-wrap ipd-page eh">
      <MallTopbar back="/agents" badge="选题策略智能体 · 商品详情" />


      {/* ============ 上半屏：左头图（可切换视图） + 右信息/价格/CTA ============ */}
      <section className="ipd-pd">
        <div className="ipd-gallery">
          <div className="ipd-gmain">
            {view === "wb" && (
              <div className="ipd-gview flush">
                <div className="ipd-wb-frame">
                  <WbBar live="配置即出题 · 选题来源池" />
                  <div className="ipd-wb-body">
                    <div className="ipd-wb-chat">
                      <WbChatHeader />
                      <div className="ipd-opts">
                        {PIPELINE_STEPS.map((s) => <span key={s}>{s}</span>)}
                      </div>
                      <SourceConfigPanel />
                    </div>
                    <div className="ipd-wb-right">
                      <SourceChipRow />
                      <div className="ipd-opts">
                        {GATE_CHIPS.map((g) => <span key={g}>{g}</span>)}
                      </div>
                      <div className="ipd-opts">
                        {STAGES.map((s, i) => (
                          <span key={s} style={i === 0 ? { borderColor: "#e7651a", color: "#e7651a", fontWeight: 700 } : undefined}>{s}</span>
                        ))}
                      </div>
                      <MetricsRow />
                      <div className="ipd-gen">✨ 一键生成今天选题</div>
                      <div className="ipd-fee">预计消耗约 {skuPpu ?? "—"} 算力 · 交付 10 条 · 可换一批 · 失败不扣费</div>
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
            不用再拍脑袋想选题——四大来源自动喂料（私有知识库为主力），候选池涌现 16–20 条，三关筛选把关后交付 10 条，每条带来源证据状态和创作建议，不满意可换一批。
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
              <span className="ipd-unit">算力 / 次 起</span>
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
              ⚡ 立即使用{skuPpu != null ? `（约 ${skuPpu} 算力/次）` : ""}
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
          </div>
        )}

        {tab === "standard" && (
          <div className="ipd-panel">
            <h3>交付口径</h3>
            <p>每次交付 <b>10 条</b>选题：每条带类型（认知 / 转化 / 连接）、来源证据状态（✓ 通过 / ⏳ 待验证）和创作建议，三关筛选全过才出题，<b>不满意可换一批</b>。生成后自动存入「我的交付物」，可随时回看。</p>
            <h3>质量标准</h3>
            <ul className="ipd-foundation">
              <li><b>过程：</b>配置四大来源 → 候选池涌现 16–20 条（缺源自动重分配）→ 三关筛选 → 交付 10 条</li>
              <li><b>口径：</b>来源池可配置、阶段可切换（起号期 / 增长期 / 变现期）；按实际用量结算，失败不扣费</li>
              <li><b>联动：</b>选题 → 秦文拍摄脚本 → 江流发布后复盘，一条龙闭环</li>
            </ul>
          </div>
        )}

        {tab === "shots" && (
          <div className="ipd-panel">
            {/* 实拍①：配置四大来源（配置面板式 · 无对话框） */}
            <div className="ipd-shot">
              <div className="ipd-shot-cap"><b>① 配置四大来源 · 知识库为主力 · 无需对话</b><span>私有知识库是独有素材，别人抄不走；行业热点 / 对标账号 / 数据复盘做补充，缺源自动重分配</span></div>
              <div className="ipd-wb lg">
                <WbBar live="选题流水线 · 第 1 步" />
                <div className="ipd-wb-body">
                  <div className="ipd-wb-chat">
                    <WbChatHeader />
                    <div className="ipd-opts">
                      {PIPELINE_STEPS.map((s) => <span key={s}>{s}</span>)}
                    </div>
                    <SourceConfigPanel />
                  </div>
                  <div className="ipd-wb-right">
                    <SourceChipRow />
                    <div className="ipd-fee">知识库是你的独有素材 · 别人抄不走</div>
                  </div>
                </div>
              </div>
            </div>

            {/* 实拍②：三关筛选 */}
            <div className="ipd-shot">
              <div className="ipd-shot-cap"><b>② 三关筛选 · 候选池 17 → 交付 10 条</b><span>一票否决卡无证据，对号入座定类型与客资准度，最后按你的经营阶段配比校准——不合格的不出</span></div>
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
                  <span>数据链路 17 → 淘汰 6 → 打标 11 → 交付 10 · 三关全过才出题</span>
                  <b>10 条 · 按实际用量结算</b>
                </div>
              </div>
            </div>

            {/* 实拍③：已交付 · 10 条（节选） */}
            <div className="ipd-shot">
              <div className="ipd-shot-cap"><b>③ 已交付 · 本批选题 10 条（节选）· 可换一批</b><span>每条带「类型 + 来源证据状态 + 创作建议」，三关筛选全过，拿去就能拍</span></div>
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
                  <span>每条带「类型 + 来源证据状态 + 创作建议」· 三关筛选全过</span>
                  <b>不满意可换一批 · 已存「我的交付物」</b>
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

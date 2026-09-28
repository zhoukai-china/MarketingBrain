// 首席定位官 · 商品详情页（/agent/ipzone__ip-pos/detail）
//
// 落地自设计原型 agent-product-detail-demo-20260923.html?agent=ip-position（2026-09-27 用户指派）。
// 定位：纯展示页，无复杂交互——只有两处跳转：
//   ① 「⚡ 充值算力」→ /recharge
//   ② 「⚡ 立即使用」→ /agent/ipzone__ip-pos/workbench（定位工作台）
// 内容口径：
//   - 价格/单位一律走 `sku-model.ts` 的 IP_POS_PRICE / IP_POS_UNIT（99 算力），不写死数字；
//   - 头图照原型做成「暖橙渐变画布 + 缩略图切换」：工作台实况 / 职业形象照 / 用户口碑三视图，
//     职业形象照用系统内置虚拟人形象 `employeeAvatarPath`（public/avatars/ip-position.jpg）；
//   - 人物头像圈统一照原型：橙渐变圆 + 姓氏字（沈/王/李），照片只出现在职业形象照视图，
//     避免「带图的地方长得不一样」（用户 2026-09-27 二次反馈）；
//   - 定位简报字段与 2026-09-27 拍板的 6 字段工作台一致（商业模式并入「项目」、IP目标并入「创始人」），
//     原型里旧的 0/8 简报不照抄，避免与真实工作台自相矛盾；
//   - 样式走 sitong-design token（深浅色自适应），作用域前缀 `ipd-`，不影响其他页面。

import { useEffect, useState } from "react";
import { getAppPath } from "../lib/api.js";
import { fetchMarketMe, Topbar } from "./shell.js";
import { employeeAvatarPath } from "./eco-mall-data.js";
import { IP_POS_PRICE, IP_POS_UNIT } from "./sku-model.js";

/** 工作台 URL 展示文案（原型 wb-url：头图窗口栏里标明「买到的就是这台工作台」）。 */
const WORKBENCH_URL_TEXT = "ai.lcppch.top/agent/ipzone__ip-pos/workbench";

/** 定位简报 6 字段（与 IpPosWorkbench 的 FIELDS 同口径）。 */
const BRIEF_FIELDS = ["🧭 角色", "🏷️ 项目", "⚔️ 竞争格局", "🎯 目标用户", "👤 创始人", "📊 现状投入"] as const;

/** 全案 5 分区（与 IpPosWorkbench 的 PIECES 同口径：速览 + 8 章）。 */
const CANVAS_ZONES: Array<{ icon: string; name: string; items: string }> = [
  { icon: "📌", name: "速览区", items: "1分钟速览 · 8 维结论，老板先看这张" },
  { icon: "🎯", name: "定位区", items: "一 · 项目定位　二 · 目标用户定位" },
  { icon: "🧑", name: "人设区", items: "三 · IP人设定位" },
  { icon: "✍️", name: "内容区", items: "四 · 内容定位　五 · 选题方向" },
  { icon: "🚀", name: "增长区", items: "六 · 投流建议　七 · IP发展规划　八 · 执行建议" }
];

/** 本单交付清单（原型 deliver 区）。 */
const DELIVERABLES = [
  `1 份 IP 定位全案（一句话定位 / 目标用户 / 人设五维）`,
  `1 套内容矩阵 + 选题方向，直接排进日历`,
  `行业合规表达边界提示（含红线词过滤）`
] as const;

/** 四大职联（原型「能力清单」tab）。 */
const CAPABILITIES: Array<{ icon: string; name: string; desc: string }> = [
  { icon: "🔍", name: "洞察", desc: "现状访谈 / 目标用户画像 / 竞对定位扫描" },
  { icon: "🎯", name: "定位", desc: "一句话定位 / 人设五维 / 差异化主张" },
  { icon: "🗺️", name: "规划", desc: "内容矩阵 / 选题方向 / 平台优先级" },
  { icon: "✅", name: "校准", desc: "合规边界检查 / 落地动作清单" }
];

/** 底层能力（原型「能力清单」tab）。 */
const FOUNDATIONS = [
  "接入私有知识库（品牌资料 / 历史内容）",
  "三关筛选：能拍 / 愿拍 / 拍了有人看",
  "输出可执行的定位全案与下一步动作"
] as const;

/** 用户评价（原型「用户评价」tab）。 */
const REVIEWS = [
  {
    initial: "王",
    who: "王姐 · 轻氧SPA（2家店）",
    stars: 5,
    text: "以前找策划公司花了两万做的定位，还不如沈定十分钟问出来的准。连美业的话术红线都标好了。"
  },
  {
    initial: "李",
    who: "李哥 · 老巷口烧烤",
    stars: 5,
    text: "把店的情况说清楚，出来的人设和内容矩阵直接能排下周的拍摄计划，99 算力（≈¥9.9）花得值。"
  }
] as const;

type TabKey = "ability" | "standard" | "shots" | "reviews";
/** 头图四视图（原型 g-view：工作台实况 / AI 工作实况 / 职业形象照 / 用户口碑）。 */
type GalleryView = "wb" | "live" | "photo" | "rate";

/** AI 工作实况四段（原型 live 视图：SHENDING · AI 工作实况 + ● LIVE）。 */
const LIVE_SECTIONS: Array<{ name: string; text: string }> = [
  { name: "核心观点", text: "一句话说清「你是谁、对谁说、凭什么信你」" },
  { name: "定位方向", text: "招商获客型创始人 IP · 差异化人设落位" },
  { name: "红线命中", text: "绝对化用语 / 承诺性表述 0 处" },
  { name: "全案交付", text: "速览 + 8 章 · 自动存「我的交付物」" }
];

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "ability", label: "能力清单" },
  { key: "standard", label: "交付标准" },
  { key: "shots", label: "工作台实拍" },
  { key: "reviews", label: "用户评价" }
];

/** 头图视图说明（原型 g-cap，随视图切换）。 */
const VIEW_CAP: Record<GalleryView, string> = {
  wb: `工作台实况 · 6 步访谈 → 定位简报 → 速览 + 8 章全案（${IP_POS_PRICE} ${IP_POS_UNIT}/份）`,
  live: "AI 工作实况 · 核心观点 → 定位方向 → 红线命中 → 全案交付",
  photo: "职业形象照 · 数字员工「沈定」形象",
  rate: "用户口碑 · 评分与好评率"
};

/** 工作台窗口栏：红黄绿圆点 + 工作台地址 + 状态徽标（原型 wb-bar，文案随窗口场景变）。 */
function WbBar({ live }: { live: string }) {
  return (
    <div className="ipd-wb-bar">
      <span className="ipd-dots"><i /><i /><i /></span>
      <span className="ipd-wb-url">{WORKBENCH_URL_TEXT}</span>
      <span className="ipd-live">● {live}</span>
    </div>
  );
}

/** 对话窗头像 + 姓名（头像圈照原型：橙渐变圆 + 姓氏字，与评价区同一套画法）。 */
function WbChatHeader() {
  // 数字员工头像用系统内置形象（真实照片）；加载失败时回退姓氏字
  const av = employeeAvatarPath("ipzone__ip-pos");
  return (
    <div className="ipd-wb-chat-h">
      {av ? <img className="ipd-wb-av" src={av} alt="数字员工形象" /> : <span className="ipd-wb-av">沈</span>}
      <div>
        <b>沈定 · 首席定位官</b>
        <span>6 步访谈 · 一次只问一个维度</span>
      </div>
    </div>
  );
}

/** 定位简报卡：filled 控制打勾数量（0/6 或 6/6）。 */
function WbBrief({ filled }: { filled: number }) {
  return (
    <div className="ipd-ws">
      <div className="ipd-brief-h"><span>📋 定位简报</span><b>{filled}/6</b></div>
      <div className="ipd-brief-grid">
        {BRIEF_FIELDS.map((f, i) => (
          <span key={f} className={i < filled ? "ipd-bf in" : "ipd-bf"}>{f}</span>
        ))}
      </div>
    </div>
  );
}

/** 访谈对话窗内容（头图视图与实拍①共用同一套对话）。 */
function InterviewChat() {
  return (
    <div className="ipd-wb-chat">
      <WbChatHeader />
      <div className="ipd-msg q">先确认——你是老板本人，还是代运营？品牌是单店还是连锁？</div>
      <div className="ipd-opts">
        <span>🏭 连锁总部 · 老板本人</span>
        <span>🏪 本地单店</span>
        <span>💼 OPC 代运营</span>
      </div>
      <div className="ipd-msg a">明白——按「招商获客型创始人IP」深度来做。</div>
      <div className="ipd-msg q">项目叫什么？赚谁的钱、怎么赚？</div>
      <div className="ipd-input"><span>🎤</span><i>打字或点 🎤 说话…</i><b>发送</b></div>
    </div>
  );
}

export function IpPosDetailPage() {
  const [balance, setBalance] = useState<number | null>(null);
  const [tab, setTab] = useState<TabKey>("ability");
  const [view, setView] = useState<GalleryView>("wb");
  const avatar = employeeAvatarPath("ipzone__ip-pos");

  useEffect(() => {
    let cancelled = false;
    void fetchMarketMe<{ creditBalance: number }>()
      .then((d) => { if (!cancelled) setBalance(d ? d.creditBalance : null); })
      .catch(() => { if (!cancelled) setBalance(null); });
    return () => { cancelled = true; };
  }, []);

  return (
    <main className="app-wrap ipd-page">
      <Topbar active="chat" balance={balance} onNavigate={(p) => { window.location.href = getAppPath(p); }} />

      {/* 返回按钮照原型 back-btn：小号橙色药丸（align-self 防 .app-wrap 纵向 flex 拉伸） */}
      <button className="ipd-back" onClick={() => { window.location.href = getAppPath("/agents"); }}>‹ 返回商城</button>

      {/* ============ 上半屏：左头图（可切换视图） + 右信息/价格/CTA ============ */}
      <section className="ipd-pd">
        <div className="ipd-gallery">
          <div className="ipd-gmain">
            {view === "wb" && (
              <div className="ipd-gview flush">
                <div className="ipd-wb-frame">
                  <WbBar live="6 步访谈" />
                  <div className="ipd-wb-body">
                    <InterviewChat />
                    <div className="ipd-wb-right">
                      <WbBrief filled={0} />
                      <div className="ipd-gen">✨ 生成定位全案 · {IP_POS_PRICE} {IP_POS_UNIT}</div>
                      <div className="ipd-fee">完成 6 步访谈后可生成 · 全案（速览 + 8 章）{IP_POS_PRICE} {IP_POS_UNIT}/份</div>
                    </div>
                  </div>
                </div>
              </div>
            )}
            {view === "live" && (
              <div className="ipd-gview flush">
                <div className="ipd-wb-frame">
                  <WbBar live="AI 工作实况" />
                  <div className="ipd-canvas">
                    {LIVE_SECTIONS.map((s) => (
                      <div key={s.name} className="ipd-zone">
                        <div className="ipd-zone-h">– {s.name}</div>
                        <p>{s.text}</p>
                      </div>
                    ))}
                  </div>
                  <div className="ipd-canvas-foot">
                    <span>全案四段流式生成实况 · 完成后自动存「我的交付物」</span>
                    <b>● LIVE</b>
                  </div>
                </div>
              </div>
            )}
            {view === "photo" && (
              <div className="ipd-gview flush">
                {avatar
                  ? <img className="ipd-photo" src={avatar} alt="沈定 · 职业形象照（数字员工形象）" />
                  : <div className="ipd-photo-fallback">沈</div>}
              </div>
            )}
            {view === "rate" && (
              <div className="ipd-gview">
                <div className="ipd-grate">
                  <b>4.9</b>
                  <div className="ipd-stars lg">★★★★★</div>
                  <span>近 30 天 · 128 位老板使用 · 好评率 98%</span>
                </div>
              </div>
            )}
          </div>
          <div className="ipd-gthumbs">
            <button className={view === "wb" ? "on" : ""} title="工作台实况" onClick={() => setView("wb")}>🧰</button>
            <button className={view === "live" ? "on" : ""} title="AI 工作实况" onClick={() => setView("live")}>▶</button>
            <button className={view === "photo" ? "on" : ""} title="职业形象照 · 数字员工形象" onClick={() => setView("photo")}>👤</button>
            <button className={view === "rate" ? "on" : ""} title="用户口碑" onClick={() => setView("rate")}>⭐</button>
          </div>
          <div className="ipd-gcap">{VIEW_CAP[view]}</div>
        </div>

        <div className="ipd-info">
          <h1 className="ipd-title">沈定 · 首席定位官 <small>（IP定位智能体）</small></h1>
          <div className="ipd-status">已上线 · 可直接对话</div>
          <p className="ipd-desc">
            先把你这个人想明白——对谁说、说啥，再给你一份能直接用的 IP 定位全案：一句话定位、目标用户、人设五维、内容矩阵、选题方向。
          </p>
          <div className="ipd-rate">
            <b>4.9</b>
            <span className="ipd-stars">★★★★★</span>
            <span>128 人使用</span>
            <i>|</i>
            <span>好评率 98%</span>
          </div>

          <div className="ipd-price">
            <div className="ipd-price-line">
              <span className="ipd-num">{IP_POS_PRICE}</span>
              <span className="ipd-unit">{IP_POS_UNIT} / 份</span>
              <span className="ipd-approx">≈ ¥9.9 · 一口价</span>
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

          {/* 两处跳转（用户 2026-09-27 指定）：充值 → /recharge；立即使用 → 工作台 */}
          <div className="ipd-cta-row">
            <button className="ipd-btn ghost" onClick={() => { window.location.href = getAppPath("/recharge"); }}>⚡ 充值算力</button>
            <button className="ipd-btn main" onClick={() => { window.location.href = getAppPath("/agent/ipzone__ip-pos/workbench"); }}>
              ⚡ 立即使用（{IP_POS_PRICE} {IP_POS_UNIT}/份）
            </button>
          </div>
          <div className="ipd-after-cta">
            1 元 = 10 算力 · 本单 {IP_POS_PRICE} {IP_POS_UNIT} ≈ ¥9.9 · 交付才扣 · <b>失败不扣费</b> · 交付物云端保存可回看
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
            <h3>四大职联（Agent 流程架构）</h3>
            <div className="ipd-caps">
              {CAPABILITIES.map((c) => (
                <div key={c.name} className="ipd-cap">
                  <span className="ipd-cap-ico">{c.icon}</span>
                  <div><b>{c.name}</b><p>{c.desc}</p></div>
                </div>
              ))}
            </div>
            <h3>底层能力</h3>
            <ul className="ipd-foundation">
              {FOUNDATIONS.map((f) => <li key={f}>{f}</li>)}
            </ul>
          </div>
        )}

        {tab === "standard" && (
          <div className="ipd-panel">
            <h3>交付口径</h3>
            <p>每次对话交付 1 份完整定位全案，含：一句话定位、目标用户画像、人设五维、内容矩阵、选题方向。生成后自动存入「我的交付物」，可随时回看与导出。</p>
            <h3>质量标准</h3>
            <ul className="ipd-foundation">
              <li><b>结构完整：</b>五模块缺一不可，缺失会自动追问补齐</li>
              <li><b>可执行：</b>每条结论都带「下一步动作」</li>
              <li><b>合规：</b>美业/餐饮版自带红线词过滤</li>
            </ul>
          </div>
        )}

        {tab === "shots" && (
          <div className="ipd-panel">
            {/* 实拍①：6 步访谈 */}
            <div className="ipd-shot">
              <div className="ipd-shot-cap"><b>① 6 步访谈 · 收信息</b><span>一次只问一个维度，回答自动填入右侧定位简报</span></div>
              <div className="ipd-wb lg">
                <WbBar live="6 步访谈" />
                <div className="ipd-wb-body">
                  <InterviewChat />
                  <div className="ipd-wb-right">
                    <WbBrief filled={0} />
                    <div className="ipd-fee">回答自动填入简报 · 老手可直接填简报</div>
                  </div>
                </div>
              </div>
            </div>

            {/* 实拍②：简报确认 · 一次生成 */}
            <div className="ipd-shot">
              <div className="ipd-shot-cap"><b>② 简报确认 · 一次生成</b><span>6 字段齐了才放行生成——先看简报再花钱；全案（速览 + 8 章）{IP_POS_PRICE} {IP_POS_UNIT}/份，失败不扣费</span></div>
              <div className="ipd-wb lg">
                <WbBar live="简报确认" />
                <div className="ipd-wb-body">
                  <div className="ipd-wb-chat">
                    <WbChatHeader />
                    <div className="ipd-msg a">6 步访谈完成 ✅ 右侧简报你过目——确认后我按「速览 + 8 章」全案交付。</div>
                    <div className="ipd-opts">
                      <span>✓ 确认，开始生成</span>
                      <span>✏️ 先改简报</span>
                    </div>
                    <div className="ipd-input"><span>🎤</span><i>打字或点 🎤 说话…</i><b>发送</b></div>
                  </div>
                  <div className="ipd-wb-right">
                    <WbBrief filled={6} />
                    <div className="ipd-gen">✨ 生成定位全案 · {IP_POS_PRICE} {IP_POS_UNIT}</div>
                    <div className="ipd-fee">线上流式约 50 秒 · 失败不扣费</div>
                  </div>
                </div>
              </div>
            </div>

            {/* 实拍③：已交付 · 全案 9 件 */}
            <div className="ipd-shot">
              <div className="ipd-shot-cap"><b>③ 已交付 · 全案 9 件</b><span>按 5 个分区点亮交付：每章可单独复制、单章重生成；交付物云端保存，随时回看</span></div>
              <div className="ipd-wb lg">
                <WbBar live="全案交付" />
                <div className="ipd-canvas">
                  {CANVAS_ZONES.map((z) => (
                    <div key={z.name} className="ipd-zone">
                      <div className="ipd-zone-h">{z.icon} {z.name}</div>
                      <p>{z.items}</p>
                    </div>
                  ))}
                </div>
                <div className="ipd-canvas-foot">
                  <span>9 件 · 单章复制 / 单章重生成 · 已存「我的交付物」</span>
                  <b>一键导出 Word（WPS 可开 · 免费）</b>
                </div>
              </div>
            </div>

            <div className="ipd-foot-note">
              头图与详情图均按沈定定位工作台（{WORKBENCH_URL_TEXT}）的真实界面逻辑制作——<b>买到的就是这台工作台，所见即所得</b>。
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

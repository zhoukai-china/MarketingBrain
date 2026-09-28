// 金牌文案主笔 · 商品详情页（/agent/ipzone__copy/detail）
//
// 落地自设计原型 agent-product-detail-demo-20260923.html?agent=copywriter（2026-09-28 用户指派）。
// 与 IpPosDetailPage 同一套骨架与 ipd- 样式（零新增 CSS），仅内容换成秦文（copywriter）：
//   ① 「⚡ 充值算力」→ /recharge
//   ② 「⚡ 立即使用」→ /agent/ipzone__copy/workbench（文案工作台）
// 内容口径：
//   - 计费与文案工作台同源：按实际用量结算，价格取真实目录 ppu（/market/skus），单位「算力」；
//     原型里的「10/15 算力」是演示价，不照抄（避免页面价 ≠ 服务端结算价，ip-pos 的老教训）；
//   - 「失败不扣费」按原型保留（生成失败确实不扣）；
//   - 简报 6 字段（产品/卖点/平台/动作/深度/出镜）与真实文案工作台一致；
//   - 交付分区按真实工作台 10 件（原型头图漏了「拍摄注意事项」，照工作台真源补齐）；
//   - 头像：职业形象照用系统内置形象 `employeeAvatarPath`（public/avatars/copywriter.jpg），
//     人物头像圈统一「橙渐变圆 + 姓氏字」（秦/陈/周）。

import { useEffect, useState } from "react";
import { apiPath, getAppPath } from "../lib/api.js";
import { MallTopbar } from "./MallTopbar.js";
import { employeeAvatarPath } from "./eco-mall-data.js";
import { readJson } from "./shell.js";

/** 工作台 URL 展示文案（原型 wb-url：头图窗口栏里标明「买到的就是这台工作台」）。 */
const WORKBENCH_URL_TEXT = "ai.lcppch.top/agent/ipzone__copy/workbench";
const WORKBENCH_PATH = "/agent/ipzone__copy/workbench";

/** 创作简报 6 字段（与 CopyWorkbench 的 FIELDS 同口径）。 */
const BRIEF_FIELDS = ["📦 产品", "🌟 卖点", "📱 平台", "🎯 动作", "📏 深度", "🎬 出镜"] as const;

/** 内容十件套 5 分区（与 CopyWorkbench 的 PIECES 同口径：10 件）。 */
const CANVAS_ZONES: Array<{ icon: string; name: string; items: string }> = [
  { icon: "🧭", name: "策划区", items: "① 选题策划 · 角度/爆款元素/脚本类型/漏斗层级" },
  { icon: "✍️", name: "文稿区", items: "② 口播逐字稿　③ 访谈话术" },
  { icon: "🎬", name: "拍摄区", items: "④ 拍摄脚本　⑤ 拍摄注意事项　⑥ 剪辑 EDL" },
  { icon: "📣", name: "发布区", items: "⑦ 发布标题与话题　⑧ 最佳发布时间　⑨ 评论区引导" },
  { icon: "🚀", name: "投流区", items: "⑩ 投流建议 · PREVIEW_ONLY 路由草案" }
];

/** 本单交付清单。 */
const DELIVERABLES = [
  "轻量：1 条可直发文案（标题 + 正文 + 话题）",
  "完整：内容十件套，五分区逐件点亮（选题→口播→访谈→拍摄→剪辑→标题→时间→评论→投流）",
  "单件复制；交付后可一键导出 Word / WPS（免费）",
  "多平台适配（抖音 / 视频号 / 小红书）"
] as const;

/** 能力清单（原型 ability tab，逐字）。 */
const ABILITIES = [
  "6 问引导简报：产品 / 卖点 / 平台 / 动作 / 深度 / 出镜，一次只问一个问题",
  "双交付深度：轻量 1 条可直发文案；完整内容十件套",
  "五分区结构化交付：策划 / 文稿 / 拍摄 / 发布 / 投流，告别一坨长文",
  "单件复制；老手可直接填简报，对话能力不降级",
  "行业合规表达边界提示（含红线词过滤）"
] as const;

/** 底层能力。 */
const FOUNDATIONS = [
  "接入私有知识库（品牌资料 / 历史内容）",
  "行业样例与合规红线内置（餐饮 / 美业 / 通用）",
  "输出可直发的完整文案与拍摄交付物"
] as const;

/** 用户评价（原型 reviews tab；评价文案里的演示价格改为不与计费口径冲突的说法）。 */
const REVIEWS = [
  {
    initial: "陈",
    who: "陈姐 · 一碗深巷麻辣烫",
    stars: 5,
    text: "十件套连拍摄脚本和剪辑清单都给了，我们店小哥照着拍，第一条就跑了 4 万播放。"
  },
  {
    initial: "周",
    who: "周老板 · 拾光烘焙",
    stars: 5,
    text: "急用的时候只要 1 条文案，一杯豆浆钱的成本，改两版直接发，不再求人。"
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
  wb: "工作台实况 · 6 问引导 → 创作简报 → 内容十件套（按实际用量结算）",
  photo: "职业形象照 · 数字员工「秦文」形象",
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
  const av = employeeAvatarPath("ipzone__copy");
  return (
    <div className="ipd-wb-chat-h">
      {av ? <img className="ipd-wb-av" src={av} alt="数字员工形象" /> : <span className="ipd-wb-av">秦</span>}
      <div>
        <b>秦文 · 金牌文案主笔</b>
        <span>引导问答 · 一次只问一个问题</span>
      </div>
    </div>
  );
}

function WbBrief({ filled }: { filled: number }) {
  return (
    <div className="ipd-ws">
      <div className="ipd-brief-h"><span>📋 创作简报</span><b>{filled}/6</b></div>
      <div className="ipd-brief-grid">
        {BRIEF_FIELDS.map((f, i) => (
          <span key={f} className={i < filled ? "ipd-bf in" : "ipd-bf"}>{f}</span>
        ))}
      </div>
    </div>
  );
}

/** 头图视图对话（① 引导问答）。 */
function InterviewChat() {
  return (
    <div className="ipd-wb-chat">
      <WbChatHeader />
      <div className="ipd-msg q">这次给什么产品 / 服务写文案？一句话卖点就行。</div>
      <div className="ipd-opts">
        <span>🍲 麻辣烫团购套餐</span>
        <span>🎂 周年庆活动</span>
        <span>💪 健身私教课</span>
      </div>
      <div className="ipd-msg a">收到——主要发布到哪个平台？多平台我会做适配。</div>
      <div className="ipd-opts">
        <span>📱 抖音</span>
        <span>视频号</span>
        <span>小红书</span>
      </div>
      <div className="ipd-input"><span>🎤</span><i>打字或点 🎤 说话…</i><b>发送</b></div>
    </div>
  );
}

export function CopyDetailPage() {
  const [tab, setTab] = useState<TabKey>("ability");
  const [view, setView] = useState<GalleryView>("wb");
  const avatar = employeeAvatarPath("ipzone__copy");
  /** 真实目录价（与文案工作台/对话页同源 /market/skus）；文案按实际用量结算，单位「算力」。 */
  const [skuPpu, setSkuPpu] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch(apiPath("/market/skus"))
      .then((r) => readJson<{ skus: Array<{ skuCode: string; ppu: number }> }>(r))
      .then((data) => {
        if (cancelled) return;
        const sku = data?.skus?.find((s) => s.skuCode === "ipzone__copy");
        if (sku && typeof sku.ppu === "number") setSkuPpu(sku.ppu);
      })
      .catch(() => { /* 取不到就显示「按实际用量结算」，不阻塞 */ });
    return () => { cancelled = true; };
  }, []);

  return (
    <main className="app-wrap ipd-page eh">
      <MallTopbar />

      <button className="ipd-back" onClick={() => { window.location.href = getAppPath("/agents"); }}>← 返回</button>

      {/* ============ 上半屏：左头图（可切换视图） + 右信息/价格/CTA ============ */}
      <section className="ipd-pd">
        <div className="ipd-gallery">
          <div className="ipd-gmain">
            {view === "wb" && (
              <div className="ipd-gview flush">
                <div className="ipd-wb-frame">
                  <WbBar live="引导问答 · 6 项简报" />
                  <div className="ipd-wb-body">
                    <InterviewChat />
                    <div className="ipd-wb-right">
                      <WbBrief filled={5} />
                      <div className="ipd-gen">✨ 生成内容十件套</div>
                      <div className="ipd-fee">预计消耗约 {skuPpu ?? "—"} 算力 · 按实际用量结算 · 失败不扣费</div>
                    </div>
                  </div>
                </div>
              </div>
            )}
            {view === "photo" && (
              <div className="ipd-gview flush">
                {avatar
                  ? <img className="ipd-photo" src={avatar} alt="秦文 · 职业形象照（数字员工形象）" />
                  : <div className="ipd-photo-fallback">秦</div>}
              </div>
            )}
            {view === "rate" && (
              <div className="ipd-gview">
                <div className="ipd-grate">
                  <b>4.9</b>
                  <div className="ipd-stars lg">★★★★★</div>
                  <span>近 30 天 · 300+ 位老板使用 · 好评率 96%</span>
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
          <h1 className="ipd-title">秦文 · 金牌文案主笔 <small>（文案智能体）</small></h1>
          <div className="ipd-status">已上线 · 可直接对话</div>
          <p className="ipd-desc">
            把这条文案的信息一次配齐——6 问引导填创作简报，轻量出 1 条可直发文案，完整出内容十件套（选题→口播→访谈→拍摄→剪辑→标题→时间→评论→投流），五分区逐件点亮，单件复制。
          </p>
          <div className="ipd-rate">
            <b>4.9</b>
            <span className="ipd-stars">★★★★★</span>
            <span>300+ 人使用</span>
            <i>|</i>
            <span>好评率 96%</span>
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

          {/* 两处跳转（用户 2026-09-28 指定）：充值 → /recharge；立即使用 → 文案工作台 */}
          <div className="ipd-cta-row">
            <button className="ipd-btn ghost" onClick={() => { window.location.href = getAppPath("/recharge"); }}>⚡ 充值算力</button>
            <button className="ipd-btn main" onClick={() => { window.location.href = getAppPath(WORKBENCH_PATH); }}>
              ⚡ 立即使用{skuPpu != null ? `（约 ${skuPpu} 算力/次）` : ""}
            </button>
          </div>
          <div className="ipd-after-cta">
            1 元 = 10 算力 · 使用后扣算力 · <b>交付才扣 · 失败不扣费</b> · 交付物云端保存可回看
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
            <p>每次交付「轻量 1 条可直发文案」或「完整内容十件套」（选题→口播→访谈→拍摄→剪辑→标题→时间→评论→投流）。生成后自动存入「我的交付物」，可随时回看与导出。</p>
            <h3>质量标准</h3>
            <ul className="ipd-foundation">
              <li><b>过程：</b>先看简报再创作——6 项信息齐了才放行；轻量约 3 分钟，十件套约 5-10 分钟流式逐件点亮，进度实时可见</li>
              <li><b>口径：</b>价格机制没确认的信息不编造；改简报可整包重跑</li>
              <li><b>计费：</b>按实际用量结算，交付才扣算力，失败不扣费</li>
              <li><b>合规：</b>行业版自带红线词过滤（不出现私信 / 加微信等违规引导）</li>
            </ul>
          </div>
        )}

        {tab === "shots" && (
          <div className="ipd-panel">
            {/* 实拍①：引导问答 */}
            <div className="ipd-shot">
              <div className="ipd-shot-cap"><b>① 引导问答 · 配齐信息</b><span>一次只问一个问题，回答自动填入右侧「创作简报」；急用可跳过问答直接填简报，对话能力不降级</span></div>
              <div className="ipd-wb lg">
                <WbBar live="引导问答" />
                <div className="ipd-wb-body">
                  <InterviewChat />
                  <div className="ipd-wb-right">
                    <WbBrief filled={3} />
                    <div className="ipd-fee">回答自动填入简报 · 老手可直接填简报</div>
                  </div>
                </div>
              </div>
            </div>

            {/* 实拍②：简报确认 · 开始创作 */}
            <div className="ipd-shot">
              <div className="ipd-shot-cap"><b>② 简报确认 · 开始创作</b><span>先选交付深度再花钱：轻量 1 条可直发文案、完整内容十件套；按实际用量结算，失败不扣费</span></div>
              <div className="ipd-wb lg">
                <WbBar live="简报确认" />
                <div className="ipd-wb-body">
                  <div className="ipd-wb-chat">
                    <WbChatHeader />
                    <div className="ipd-msg a">简报 6/6 ✅ 右侧你过目——确认后点「开始创作」，我按完整十件套交付，中途随时可以打断我改简报。</div>
                    <div className="ipd-opts">
                      <span>✓ 确认，开始创作</span>
                      <span>✏️ 先改简报</span>
                    </div>
                    <div className="ipd-input"><span>🎤</span><i>打字或点 🎤 说话…</i><b>发送</b></div>
                  </div>
                  <div className="ipd-wb-right">
                    <WbBrief filled={6} />
                    <div className="ipd-gen">✨ 生成内容十件套</div>
                    <div className="ipd-fee">轻量约 3 分钟 · 十件套 5-10 分钟流式 · 失败不扣费</div>
                  </div>
                </div>
              </div>
            </div>

            {/* 实拍③：已交付 · 十件逐件点亮 */}
            <div className="ipd-shot">
              <div className="ipd-shot-cap"><b>③ 已交付 · 十件逐件点亮</b><span>按 5 个分区点亮交付：每件可单独复制；交付物云端保存，随时回看</span></div>
              <div className="ipd-wb lg">
                <WbBar live="十件套交付" />
                <div className="ipd-canvas">
                  {CANVAS_ZONES.map((z) => (
                    <div key={z.name} className="ipd-zone">
                      <div className="ipd-zone-h">{z.icon} {z.name}</div>
                      <p>{z.items}</p>
                    </div>
                  ))}
                </div>
                <div className="ipd-canvas-foot">
                  <span>10 件 · 单件复制 · 已存「我的交付物」</span>
                  <b>一键导出 Word（WPS 可开 · 免费）</b>
                </div>
              </div>
            </div>

            <div className="ipd-foot-note">
              头图与详情图均按秦文创作工作台（{WORKBENCH_URL_TEXT}）的真实界面逻辑制作——<b>买到的就是这台工作台，所见即所得</b>。
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

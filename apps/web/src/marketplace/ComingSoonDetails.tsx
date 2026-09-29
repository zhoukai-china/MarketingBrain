// 未上线智能体详情页（许复 / 易成 / 周域，2026-09-28 E 线补齐）
//
// 落地自原型 agent-product-detail-demo-20260923.html 的 v12 预约 sec（live-coach / sales-coach / private）：
//   - 三个智能体 status=coming_soon，口径与已上线的何策不同：保留「打磨中 · 支持预约」+
//     预约弹窗收口（表单态 → 成功态，原型 20260923 v12「预约统一收口到详情页」）；
//   - 价格显示真实目录 ppu（50 / 25 / 5 算力，2026-09-28 对齐原型报价）＋「上线价」小字；
//   - 复用 ipd- 骨架样式（零新增骨架 CSS，仅预约弹窗一小段）；头图是「形态预览」对话式（照原型）；
//   - 预约目前为**本地演示态**：localStorage 记录，后端预约接口落库后切换。
// 头像：employeeAvatarPath 真实照片，失败回退姓氏字。

import { useEffect, useState } from "react";
import { apiPath, getAppPath } from "../lib/api.js";
import { readJson } from "./shell.js";
import { IconAuto, IconLead } from "./IconGlyph.js";
import { MallTopbar } from "./MallTopbar.js";
import { employeeAvatarPath } from "./eco-mall-data.js";

export interface ComingSoonContent {
  /** 目录 sku 全码，如 ipzone__liverev。 */
  skuId: string;
  /** 头像加载失败时的姓氏字。 */
  surname: string;
  name: string;
  title: string;
  roleLabel: string;
  desc: string;
  /** 头图「形态预览」对话。 */
  chat: { headerSub: string; q: string; opts: string[]; a: string };
  /** 右栏面板。 */
  panel: { title: string; badge: string; chips: string[]; foot: string };
  wbCap: string;
  /** 输出样例（实拍①）。 */
  sample: { cap: string; sub: string; title: string; lines: string[]; foot: string };
  rate: string;
  abilities: string[];
  standardIntro: string;
  standardItems: string[];
  reviewName: string;
  reviewText: string;
  priceUnit: string;
}

type TabKey = "ability" | "standard" | "shots" | "reviews";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "ability", label: "能力清单" },
  { key: "standard", label: "交付标准" },
  { key: "shots", label: "工作台实拍" },
  { key: "reviews", label: "内测反馈" }
];

function WbBar({ live }: { live: string }) {
  return (
    <div className="ipd-wb-bar">
      <span className="ipd-dots"><i /><i /><i /></span>
      <span className="ipd-wb-url">ai.lcppch.top/agent/workbench</span>
      <span className="ipd-live">● {live}</span>
    </div>
  );
}

/** 预约弹窗（原型 v12：表单态 → 成功态；本地演示态，后端落库后切换）。 */
function BookDialog({ content, onClose }: { content: ComingSoonContent; onClose: () => void }) {
  const storageKey = `ipd_book_${content.skuId}`;
  const [phone, setPhone] = useState("");
  const [done, setDone] = useState(() => Boolean(localStorage.getItem(storageKey)));
  const [err, setErr] = useState("");

  function submit() {
    if (!/^1\d{10}$/.test(phone.trim())) {
      setErr("请输入正确的 11 位手机号");
      return;
    }
    localStorage.setItem(storageKey, JSON.stringify({ phone: phone.trim(), at: new Date().toISOString() }));
    setDone(true);
  }

  return (
    <div className="ipd-book-mask" onClick={onClose}>
      <div className="ipd-book" onClick={(e) => e.stopPropagation()}>
        <button className="ipd-book-x" onClick={onClose}>×</button>
        {done ? (
          <>
            <div className="ipd-book-ico ok">✓</div>
            <h3>预约成功</h3>
            <p>上线后将第一时间短信通知你；预约用户可优先开通体验。</p>
          </>
        ) : (
          <>
            <div className="ipd-book-ico"><IconAuto v="📲" /></div>
            <h3>预约「{content.name} · {content.title}」</h3>
            <p>该数字员工正在打磨中，上方可先看形态预览。留下手机号，上线后第一时间通知你。</p>
            <input
              inputMode="numeric"
              maxLength={11}
              placeholder="手机号"
              value={phone}
              onChange={(e) => { setPhone(e.target.value.replace(/\D/g, "")); setErr(""); }}
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            />
            {err && <p className="ipd-book-err">{err}</p>}
            <button className="ipd-btn main" onClick={submit}>确认预约</button>
            <p className="ipd-book-tip">仅用于上线通知，不做营销骚扰</p>
          </>
        )}
      </div>
    </div>
  );
}

export function ComingSoonDetailPage({ content }: { content: ComingSoonContent }) {
  const [tab, setTab] = useState<TabKey>("ability");
  const [view, setView] = useState<"wb" | "photo" | "rate">("wb");
  const [skuPpu, setSkuPpu] = useState<number | null>(null);
  const [booking, setBooking] = useState(false);
  const avatar = employeeAvatarPath(content.skuId);

  useEffect(() => {
    let cancelled = false;
    void fetch(apiPath("/market/skus"))
      .then((r) => readJson<{ skus: Array<{ skuCode: string; ppu: number }> }>(r))
      .then((data) => {
        if (cancelled) return;
        const sku = data?.skus?.find((s) => s.skuCode === content.skuId);
        if (sku && typeof sku.ppu === "number") setSkuPpu(sku.ppu);
      })
      .catch(() => { /* 取不到就显示「—」，不阻塞 */ });
    return () => { cancelled = true; };
  }, [content.skuId]);

  const DELIVERABLES = content.abilities.slice(0, 4);

  return (
    <main className="app-wrap ipd-page eh">
      <MallTopbar back="/agents" badge={`${content.name} · 商品详情`} />

      <section className="ipd-pd">
        <div className="ipd-gallery">
          <div className="ipd-gmain">
            {view === "wb" && (
              <div className="ipd-gview flush">
                <div className="ipd-wb-frame">
                  <WbBar live="内测版 · 形态预览" />
                  <div className="ipd-wb-body">
                    <div className="ipd-wb-chat">
                      <div className="ipd-wb-chat-h">
                        {avatar ? <img className="ipd-wb-av" src={avatar} alt="数字员工形象" /> : <span className="ipd-wb-av">{content.surname}</span>}
                        <div><b>{content.name} · {content.title.replace(/官|师$/, "")}</b><span>{content.chat.headerSub}</span></div>
                      </div>
                      <div className="ipd-msg q">{content.chat.q}</div>
                      <div className="ipd-opts">{content.chat.opts.map((o) => <span key={o}>{o}</span>)}</div>
                      <div className="ipd-msg a">{content.chat.a}</div>
                      <div className="ipd-input"><span><IconAuto v="🎤" /></span><i>打字或点麦克风说话…</i><b>发送</b></div>
                    </div>
                    <div className="ipd-wb-right">
                      <div className="ipd-ws">
                        <div className="ipd-brief-h"><span>{content.panel.title}</span><b>{content.panel.badge}</b></div>
                        <div className="ipd-brief-grid">
                          {content.panel.chips.map((c) => <span key={c} className="ipd-bf in">{c}</span>)}
                        </div>
                      </div>
                      <div className="ipd-fee">{content.panel.foot}</div>
                    </div>
                  </div>
                </div>
              </div>
            )}
            {view === "photo" && (
              <div className="ipd-gview flush">
                {avatar ? <img className="ipd-photo" src={avatar} alt={`${content.name} · 职业形象照（数字员工形象）`} /> : <div className="ipd-photo-fallback">{content.surname}</div>}
              </div>
            )}
            {view === "rate" && (
              <div className="ipd-gview">
                <div className="ipd-grate">
                  <b>4.9</b>
                  <div className="ipd-stars lg">★★★★★</div>
                  <span>{content.rate}</span>
                </div>
              </div>
            )}
          </div>
          <div className="ipd-gthumbs">
            <button className={view === "wb" ? "on" : ""} title="工作台形态预览" onClick={() => setView("wb")}><IconAuto v="🧰" /></button>
            <button className={view === "photo" ? "on" : ""} title="职业形象照 · 数字员工形象" onClick={() => setView("photo")}><IconAuto v="👤" /></button>
            <button className={view === "rate" ? "on" : ""} title="内测口碑" onClick={() => setView("rate")}><IconAuto v="⭐" /></button>
          </div>
          <div className="ipd-gcap">{view === "wb" ? content.wbCap : view === "photo" ? `职业形象照 · 数字员工「${content.name}」形象` : "内测口碑 · 评分与好评率"}</div>
        </div>

        <div className="ipd-info">
          <h1 className="ipd-title">{content.name} · {content.title} <small>（{content.roleLabel}）</small></h1>
          <div className="ipd-status">打磨中 · 支持预约</div>
          <p className="ipd-desc">{content.desc}</p>
          <div className="ipd-rate">
            <b>4.9</b>
            <span className="ipd-stars">★★★★★</span>
            <span>内测商家 30+</span>
            <i>|</i>
            <span>上线后开放购买</span>
          </div>

          <div className="ipd-price">
            <div className="ipd-price-line">
              <span className="ipd-num">{skuPpu ?? "—"}</span>
              <span className="ipd-unit">算力 {content.priceUnit}</span>
              <span className="ipd-approx">{skuPpu != null ? `≈ ¥${(skuPpu / 10).toFixed(1)}` : "≈ ¥"} · 上线价</span>
            </div>
            <div className="ipd-price-meta">计费说明：<b>0 元开通</b> · 上线后按次扣算力 · <b>失败不扣费</b> · 预约免费</div>
            <div className="ipd-guar"><IconAuto v="⚡" /> 1元 = 10算力　<IconAuto v="🎁" /> 注册赠 100 算力　<IconAuto v="📄" /> 账单逐笔可查</div>
          </div>

          <div className="ipd-deliver">
            <h3>上线后交付</h3>
            <ul>
              {DELIVERABLES.map((d) => <li key={d}>{d}</li>)}
            </ul>
          </div>

          <div className="ipd-cta-row">
            <button className="ipd-btn ghost" onClick={() => { window.location.href = getAppPath("/recharge"); }}><IconAuto v="⚡" /> 充值算力</button>
            <button className="ipd-btn main" onClick={() => setBooking(true)}><IconAuto v="📲" /> 预约体验</button>
          </div>
          <div className="ipd-after-cta">
            上线价 {skuPpu ?? "—"} 算力{content.priceUnit} ≈ ¥{skuPpu != null ? (skuPpu / 10).toFixed(1) : "—"}（1 元 = 10 算力）· 预约用户优先开通 · 留手机号接收上线通知
          </div>
        </div>
      </section>

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
              {content.abilities.map((a) => <li key={a}>{a}</li>)}
            </ul>
          </div>
        )}

        {tab === "standard" && (
          <div className="ipd-panel">
            <h3>交付口径</h3>
            <p>{content.standardIntro}</p>
            <h3>质量标准</h3>
            <ul className="ipd-foundation">
              {content.standardItems.map((s) => <li key={s}>{s}</li>)}
            </ul>
          </div>
        )}

        {tab === "shots" && (
          <div className="ipd-panel">
            <div className="ipd-shot">
              <div className="ipd-shot-cap"><b>{content.sample.cap}</b><span>{content.sample.sub}</span></div>
              <div className="ipd-wb lg">
                <WbBar live="输出样例" />
                <div className="ipd-canvas">
                  <div className="ipd-zone">
                    <div className="ipd-zone-h">{content.sample.title}</div>
                    {content.sample.lines.map((l) => <p key={l}>{l}</p>)}
                  </div>
                </div>
                <div className="ipd-canvas-foot">
                  <span>{content.sample.foot}</span>
                  <b>上线价 {skuPpu ?? "—"} 算力{content.priceUnit}</b>
                </div>
              </div>
            </div>
            <div className="ipd-foot-note">
              形态与详情图均按真实工作台逻辑制作——<b>上线后买到的就是这台工作台，所见即所得</b>。
            </div>
          </div>
        )}

        {tab === "reviews" && (
          <div className="ipd-panel">
            <div className="ipd-rev">
              <div className="ipd-rev-head">
                <span className="ipd-rev-ava">{content.reviewName}</span>
                <b>{content.reviewName}店长 · 内测商家</b>
                <span className="ipd-rev-stars">★★★★★</span>
              </div>
              <p>{content.reviewText}</p>
            </div>
          </div>
        )}
      </section>

      {booking && <BookDialog content={content} onClose={() => setBooking(false)} />}
    </main>
  );
}

/* ============ 三个 SKU 的内容常量（照原型 v12 预约 sec 逐字） ============ */

const LIVE_REV: ComingSoonContent = {
  skuId: "ipzone__liverev",
  surname: "许",
  name: "许复",
  title: "直播复盘官",
  roleLabel: "直播复盘智能体",
  desc: "复盘只对数据说话，不看感觉——以直播后台数据为准，每场交付 3 项重点 + 下场迭代动作：流量承接、转化漏斗、话术执行，盘完就知道下场改哪。",
  chat: {
    headerSub: "先对齐本场目标 · 再拉数据",
    q: "先对齐本场目标——这场直播主拉新还是主转化？复盘重点完全不同。",
    opts: ["🎯 主转化", "🧲 主拉新", "📌 混合"],
    a: "好，主转化——重点盘「268 观看 → 9 单」的漏斗断点，和 3 段逼单话术的执行偏差。"
  },
  panel: {
    title: "📊 复盘重点",
    badge: "3 项交付",
    chips: ["🧲 流量承接", "💰 转化漏斗", "🗣️ 话术执行", "👥 老带新动作"],
    foot: "📊 拉完数据后可复盘 · 50 算力/场"
  },
  wbCap: "工作台形态预览 · 对齐目标 → 拉后台数据 → 3 项交付 + 下场迭代",
  sample: {
    cap: "🧾 第 14 场直播复盘 · 摘要 3 项交付",
    sub: "复盘只对数据说话 · 不看感觉",
    title: "主转化场 · 268 观看 → 9 单",
    lines: [
      "主转化场 · 268 观看 → 9 单——漏斗断点和下场迭代动作都找齐了。",
      "🧲 流量承接：开场 15 分钟掉线 38%（福利前置过晚）",
      "💰 转化漏斗：卡在「报穿搭尺寸」环节，23 人放弃",
      "🗣️ 话术执行：3 段逼单话术平均停留 41s，高于均值",
      "迭代 1：福利前置到开场 8 分钟 · 迭代 2：报尺寸改一键表单 · 迭代 3：引价话术换框架"
    ],
    foot: "每场 3 项交付 + 下场迭代动作 · 以直播后台数据为准"
  },
  rate: "内测商家 30+ · 上线后开放购买 · 预约优先",
  abilities: [
    "复盘只对数据说话：以直播后台导出数据为准，不看感觉、不编数字",
    "每场 3 项交付：流量承接 / 转化漏斗 / 话术执行，外加老带新动作检查",
    "下场迭代动作：每个断点都给「下场怎么改」的具体动作",
    "与罗盘 / 江流联动：开播前话术（罗盘）→ 播后复盘（许复）→ 视频二次诊断（江流）"
  ],
  standardIntro: "每场复盘交付 3 项重点（流量承接 / 转化漏斗 / 话术执行）+ 下场迭代动作，全部以直播后台导出数据为准；生成后自动存入「我的交付物」，可随时回看。",
  standardItems: [
    "过程：对齐本场目标 → 上传/同步后台数据 → 三项复盘 + 迭代动作",
    "口径：按场计费（上线价 50 算力/场），失败不扣费",
    "联动：罗盘话术 → 许复复盘 → 下场话术迭代，闭环"
  ],
  reviewName: "郑",
  reviewText: "复盘不再凭感觉了——每场 3 项交付+下场改哪都写得明明白白，照着改完下一场留存真的上来了。",
  priceUnit: "/场"
};

const SALES: ComingSoonContent = {
  skuId: "ipzone__sales",
  surname: "易",
  name: "易成",
  title: "销售专家",
  roleLabel: "销售话术智能体",
  desc: "先对练再上岗——真实场景一问一答陪练：到店比价、「我再看看」、犹豫价格、老客复购，练完给标准接法话术 + 异议脚本，店员拿去就能用。",
  chat: {
    headerSub: "对练真实场景 · 一问一答",
    q: "客户逛完说「我再看看别家」，你的店员现在怎么接？",
    opts: ["「好的您随便看」", "马上递优惠", "跟着出门"],
    a: "三种接法都在送客——对练一遍标准接法：不拦人、不贬同行，把「比」变成「留」。"
  },
  panel: {
    title: "🎯 对练场景",
    badge: "喂场景就开练",
    chips: ["🆚 到店比价", "🚶「我再看看」", "🤔 犹豫价格", "🔁 老客复购"],
    foot: "选定场景后开练 · 25 算力/次"
  },
  wbCap: "工作台形态预览 · 选场景 → 一问一答对练 → 标准接法 + 异议脚本",
  sample: {
    cap: "🧾 场景对练 ·「我再看看」标准接法话术 + 异议脚本",
    sub: "先对练再上岗 · 上线后按次计费",
    title: "「我再看看」标准接法",
    lines: [
      "「没问题，比货比的是服务」——递上对比卡，把主动权拿回来。",
      "接法：不拦不贬，给比较工具",
      "追问：锁定需求，帮客户省事",
      "异议脚本：客户提出「别家更便宜」时的三步回应框架"
    ],
    foot: "标准接法 + 异议脚本 · 店员拿去就能用"
  },
  rate: "内测商家 30+ · 上线后开放购买 · 预约优先",
  abilities: [
    "对练真实场景：到店比价 / 「我再看看」/ 犹豫价格 / 老客复购，喂场景就开练",
    "标准接法话术：不拦人、不贬同行，把「比」变成「留」",
    "异议脚本：客户常见异议的三步回应框架，店员直接照用",
    "与秦文联动：话术模板可交给秦文扩写成完整内容"
  ],
  standardIntro: "每次对练交付标准接法话术 + 异议脚本（含追问与对比工具用法），场景可自选也可自定义；生成后自动存入「我的交付物」，可随时回看。",
  standardItems: [
    "过程：选对练场景 → 一问一答陪练 → 标准接法 + 异议脚本",
    "口径：按次计费（上线价 25 算力/次），失败不扣费",
    "对象：店长带练新人、门店销售日常陪练都可用"
  ],
  reviewName: "王",
  reviewText: "新人上岗前先跟易成对练两轮，「我再看看」的标准接法背熟了，比老带新快多了。",
  priceUnit: "/次"
};

const MOMENTS: ComingSoonContent = {
  skuId: "ipzone__moments",
  surname: "周",
  name: "周域",
  title: "私域营销官",
  roleLabel: "朋友圈文案智能体",
  desc: "朋友圈是信任位，不是广告位——先定人设，再按「信任 2 + 业务 1 + 软引导 1」配本周 4 条，广告不硬；也能出 30 天月历，客户刷到你就有印象。",
  chat: {
    headerSub: "人设访谈 · 朋友圈是信任位 · 不是广告位",
    q: "你希望客户刷到这条朋友圈时，记住你哪一点？",
    opts: ["🤝 懂行的老朋友", "🏆 行业专家", "😄 生活老板娘"],
    a: "好，「懂行的老朋友」——本周 4 条按「信任 2 + 业务 1 + 软引导 1」配，广告不硬。"
  },
  panel: {
    title: "🗓️ 本周朋友圈",
    badge: "4 条 / 周",
    chips: ["🤝 信任向 ×2", "🛒 业务向 ×1", "🪝 软引导 ×1", "📅 月历 30 天"],
    foot: "确认人设后出文 · 5 算力/条"
  },
  wbCap: "工作台形态预览 · 人设访谈 → 本周 4 条配比 → 单条成文",
  sample: {
    cap: "🧾 朋友圈 · 单条示例（业务向 · 周三）",
    sub: "人设是你的 · 文案为你定制",
    title: "业务向 · 周三",
    lines: [
      "「上周帮 3 家店改了陈列，销量最好的那家只动了一件事——把爆款挪到了门口（附图）。」",
      "🤝 信任向：门店日常 + 专业观点，攒人设",
      "🛒 业务向：上款 / 到货 / 案例，带单",
      "🪝 软引导：评论区留钩子，私信接住"
    ],
    foot: "单条 5 算力 · 本周 4 条 / 月历 30 天 可批量"
  },
  rate: "内测商家 30+ · 上线后开放购买 · 预约优先",
  abilities: [
    "人设访谈：先定「客户记住你哪一点」，文案不跑偏",
    "本周 4 条：信任 2 + 业务 1 + 软引导 1，广告不硬",
    "月历 30 天：一整月朋友圈节奏一次排好",
    "与何策联动：选题池里的私域题直接喂给周域成文"
  ],
  standardIntro: "按条计费（上线价 5 算力/条），单条或整周批量均可；每条带向别标注（信任 / 业务 / 软引导）与发布节奏建议，生成后自动存入「我的交付物」。",
  standardItems: [
    "过程：人设访谈 → 配比确认 → 单条成文 / 整周批量",
    "口径：按条计费（上线价 5 算力/条），失败不扣费",
    "要求：广告不硬——信任向打底，业务向带单"
  ],
  reviewName: "陈",
  reviewText: "照「信任 2 + 业务 1 + 软引导 1」发了两周，评论区终于有人回话了——以前全是硬广没人理。",
  priceUnit: "/条"
};

export function LiverevDetailPage() {
  return <ComingSoonDetailPage content={LIVE_REV} />;
}

export function SalesDetailPage() {
  return <ComingSoonDetailPage content={SALES} />;
}

export function MomentsDetailPage() {
  return <ComingSoonDetailPage content={MOMENTS} />;
}

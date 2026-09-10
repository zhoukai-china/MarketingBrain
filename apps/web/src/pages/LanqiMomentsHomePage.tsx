import { LanqiBrainShell } from "../components/lanqi-brain/LanqiBrainShell.js";
import { getAppPath } from "../lib/api.js";

const ENTRIES = [
  {
    key: "friend-circle",
    icon: "📱",
    name: "朋友圈营销",
    tags: [{ text: "今日推荐", cls: "rec" }, { text: "2 种模式", cls: "" }],
    desc: "围绕朋友圈内容获客：快速模式帮你升级已有草稿，专业模式按七柱体系从零写完整图文。",
    stats: [{ n: "12", l: "近 7 天已发" }],
    flow: "流程：选朋友圈营销 → 快速模式 / 专业模式 → AI 生成 → 发布",
    href: getAppPath("/lanqi/moments/friend-circle")
  },
  {
    key: "wechat-group",
    icon: "👥",
    name: "微信群营销",
    tags: [{ text: "群消息", cls: "b" }],
    desc: "围绕微信群活跃与转化：活动通知、日常维护、裂变引流、节日问候，AI 按群聊节奏拆多条。",
    stats: [{ n: "5", l: "群触达 · 138 人次" }],
    flow: "流程：选微信群营销 → 填需求 → AI 拆多条 → 复制逐条发",
    href: getAppPath("/lanqi/moments/wechat-group")
  }
];

export function LanqiMomentsHomePage() {
  return (
    <LanqiBrainShell active="moments" mainTitle="私域营销" subtitle="① 选阵地（朋友圈 / 微信群） → ② 选模式 → ③ AI 生成 → ④ 发布">
      <div className="lq-moments">
        <div className="lq-moments__backline">
          <a href={getAppPath("/lanqi/acquire")} className="lq-moments__back">← 返回公域获客</a>
        </div>
        <div className="lq-md-wrap">
          {ENTRIES.map((e) => (
            <a key={e.key} className="lq-md-card" href={e.href}>
              <div className="lq-md-card__top">
                <span className="lq-md-card__ic">{e.icon}</span>
                <span className="lq-md-card__name">{e.name}</span>
                {e.tags.map((t) => <span key={t.text} className={`lq-md-card__tag ${t.cls}`.trim()}>{t.text}</span>)}
              </div>
              <div className="lq-md-card__desc">{e.desc}</div>
              <div className="lq-md-card__stats">
                {e.stats.map((s) => <span key={s.l}><span className="n">{s.n}</span><span className="l"> {s.l}</span></span>)}
              </div>
              <div className="lq-md-card__flow">{e.flow}</div>
            </a>
          ))}
        </div>
      </div>
    </LanqiBrainShell>
  );
}

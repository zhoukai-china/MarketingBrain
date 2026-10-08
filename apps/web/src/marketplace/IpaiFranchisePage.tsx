// IP+AI 业绩倍增系统 · 招商加盟版 —— 系统内页面（React 实现，2026-10-09）
//
// 由交付原型 ipai-franchise-demo-20261008.html 落成为**真页面**：内容/价格/计费口径抽到
// ipai-franchise-data.ts（与原型一致），交互全部用系统自己的组件与路由实现，不再是一份静态 HTML。
// 关键接线：9 位数字高管 → 系统内真实工作台路由（同域相对路径，不再写死线上域名）；
//          甄映（文生视频）系统暂无该能力 → 提示「即将上线」，不假接。
// 路由：/ipai/franchise（演示主界面）· /ipai/franchise/spec（产品说明）。

import { useMemo, useState } from "react";
import { getAppPath } from "../lib/api.js";
import { MallTopbar } from "./MallTopbar.js";
import {
  IPAI_AGENTS,
  IPAI_BILLING,
  IPAI_FREQ,
  IPAI_RECOMMEND,
  IPAI_SCHEDULES,
  IPAI_SPEC,
  type IpaiAgent,
  type IpaiSchedule
} from "./ipai-franchise-data.js";

type Tab = "home" | "agents" | "tasks" | "me";

const TABS: Array<{ key: Tab; label: string; icon: string }> = [
  { key: "home", label: "首页", icon: "🏠" },
  { key: "agents", label: "高管", icon: "👥" },
  { key: "tasks", label: "定时任务", icon: "🗓️" },
  { key: "me", label: "我的", icon: "🙋" }
];

/** 首页「最近生成」（演示记录，与原型一致）。 */
const RECENT: Array<{ key: string; title: string; desc: string; time: string }> = [
  { key: "qinwen", title: "苏笺 · 招商文案", desc: "品牌招商朋友圈 · 合伙人社群 1 条", time: "今天 09:12 · 已扣 15 算力" },
  { key: "luzhen", title: "甄映 · 文生视频", desc: "招商口播视频 · 15 秒竖版", time: "昨天 16:40 · 已扣 120 算力" },
  { key: "hece", title: "金点 · 选题包", desc: "本周招商选题 3 条 · 已拍 1 条", time: "10-04 · 已扣 99 算力" }
];

/** 首页快捷闭环（定位 → 内容 → 流量 → 私域），点一下直达对应高管工作台。 */
const LOOP: Array<{ label: string; key: string }> = [
  { label: "定位", key: "shending" },
  { label: "内容", key: "qinwen" },
  { label: "流量", key: "jiangliu" },
  { label: "私域", key: "zhouyu" }
];

function agentOf(key: string): IpaiAgent | undefined {
  return IPAI_AGENTS.find((a) => a.key === key);
}

/** 进系统内真实工作台；无对应能力则提示。 */
function goWorkbench(agent: IpaiAgent, toast: (m: string) => void) {
  if (!agent.workbench) {
    toast(`${agent.name}（${agent.role}）工作台即将上线`);
    return;
  }
  window.location.href = getAppPath(agent.workbench);
}

export function IpaiFranchisePage() {
  const [tab, setTab] = useState<Tab>("home");
  const [toastMsg, setToastMsg] = useState("");
  const [schedules, setSchedules] = useState<IpaiSchedule[]>(IPAI_SCHEDULES);
  const [memoryOn, setMemoryOn] = useState(true);

  function toast(m: string) {
    setToastMsg(m);
    window.setTimeout(() => setToastMsg(""), 2200);
  }

  // 今日推荐：原型按星期取一条
  const today = useMemo(() => {
    const item = IPAI_RECOMMEND[new Date().getDay()] ?? IPAI_RECOMMEND[0];
    return { agent: agentOf(item[0]), day: item[1], desc: item[2] };
  }, []);

  return (
    <main className="app-wrap">
      <MallTopbar back="/agents" badge="IP+AI 业绩倍增系统 · 招商加盟版" />
      <div className="ipai">
        <header className="ipai-head">
          <div className="ipai-head-t">
            <h1>IP+AI 业绩倍增系统</h1>
            <span className="ipai-v">招商加盟版</span>
          </div>
          <p>九位数字高管替你干招商全流程的活 · 演示案例统一为「连锁烘焙品牌招商」（虚构）</p>
          <button type="button" className="ipai-spec-link" onClick={() => { window.location.href = getAppPath("/ipai/franchise/spec"); }}>
            📄 产品说明 · 功能与计费口径
          </button>
        </header>

        {tab === "home" && (
          <section className="ipai-page">
            {today.agent && (
              <div className="ipai-card ipai-rec">
                <div className="ipai-card-h">✨ 今日推荐 · {today.day}</div>
                <div className="ipai-rec-row">
                  <span className="ipai-ava">{today.agent.initial}</span>
                  <div className="ipai-rec-m">
                    <b>{today.agent.name} · {today.agent.role.replace(" · 数字高管", "")}</b>
                    <span>{today.desc}</span>
                  </div>
                </div>
                <button type="button" className="ipai-btn" onClick={() => goWorkbench(today.agent!, toast)}>去派活 ›</button>
              </div>
            )}

            <div className="ipai-card">
              <div className="ipai-card-h">🔁 招商闭环 · 点哪段进哪位高管</div>
              <div className="ipai-loop">
                {LOOP.map((l) => {
                  const a = agentOf(l.key);
                  return (
                    <button type="button" key={l.key} className="ipai-loop-it" onClick={() => a && goWorkbench(a, toast)}>
                      <b>{l.label}</b>
                      <span>{a?.name ?? "—"}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="ipai-card">
              <div className="ipai-card-h">🗂️ 最近生成</div>
              {RECENT.map((r) => {
                const a = agentOf(r.key);
                return (
                  <div key={r.key} className="ipai-gen" onClick={() => a && goWorkbench(a, toast)} role="button" tabIndex={0}
                       onKeyDown={(e) => { if (e.key === "Enter" && a) goWorkbench(a, toast); }}>
                    <span className="ipai-ava sm">{a?.initial ?? "·"}</span>
                    <div className="ipai-gen-m">
                      <b>{r.title}</b>
                      <span>{r.desc}</span>
                      <span className="ipai-gen-t">{r.time}</span>
                    </div>
                    <span className="ipai-arrow">›</span>
                  </div>
                );
              })}
            </div>

            <div className="ipai-card">
              <div className="ipai-card-h">📌 待办</div>
              <div className="ipai-todo">
                <b>招商定位还没想清</b>
                <span>让庄衡先定「招什么商、对谁招」</span>
                <button type="button" className="ipai-btn ghost" onClick={() => { const a = agentOf("shending"); a && goWorkbench(a, toast); }}>去定位 ›</button>
              </div>
            </div>
          </section>
        )}

        {tab === "agents" && (
          <section className="ipai-page">
            <div className="ipai-hint">点任意一位 → 进他/她的工作台（系统内真实功能）。头像为占位，真人形象照待生成。</div>
            {IPAI_AGENTS.map((a) => (
              <article key={a.key} className="ipai-agent">
                <span className="ipai-ava lg">{a.initial}</span>
                <div className="ipai-agent-m">
                  <b>{a.name}</b>
                  <span className="ipai-role">{a.role}</span>
                  <div className="ipai-scenes">
                    {a.scenes.map((s) => <span key={s} className="ipai-chip">{s}</span>)}
                  </div>
                  <div className="ipai-price">{a.price} 算力/次 <i>{a.approx}</i></div>
                </div>
                <button type="button" className="ipai-btn" onClick={() => goWorkbench(a, toast)}>派活 ›</button>
              </article>
            ))}
          </section>
        )}

        {tab === "tasks" && (
          <section className="ipai-page">
            <div className="ipai-hint">到点自动派活，结果进「最近生成」。开关为演示态，不落库。</div>
            {schedules.map((s, i) => (
              <div key={s.key + i} className="ipai-sch">
                <span className="ipai-when">{s.when}</span>
                <div className="ipai-sch-m">
                  <b>{s.name}</b>
                  <span>{s.desc}</span>
                </div>
                <button
                  type="button"
                  className={s.on ? "ipai-tgl on" : "ipai-tgl"}
                  onClick={() => {
                    setSchedules((prev) => prev.map((x, idx) => (idx === i ? { ...x, on: !x.on } : x)));
                    toast(s.on ? "定时任务已暂停（演示）" : "定时任务已开启 · 到点自动派活（演示）");
                  }}
                  aria-pressed={s.on}
                >
                  <i />
                </button>
              </div>
            ))}

            <div className="ipai-card">
              <div className="ipai-card-h">➕ 新建定时任务</div>
              <NewScheduleForm onCreate={(s) => { setSchedules((prev) => [...prev, s]); toast("定时任务已新增（演示）"); }} />
            </div>
          </section>
        )}

        {tab === "me" && (
          <section className="ipai-page">
            <div className="ipai-card ipai-rights">
              <span className="ipai-r-tag">招商加盟版 · 年卡</span>
              <h3>IP+AI 业绩倍增系统</h3>
              <p className="ipai-r-sub">九位数字高管全年可用 · 演示权益</p>
              <div className="ipai-r-price"><b>¥49,800</b><i>/年 · 基础 3 席位</i></div>
            </div>

            <div className="ipai-card">
              <div className="ipai-card-h">⚡ 算力与计费</div>
              <ul className="ipai-billing">
                {IPAI_BILLING.map((b) => <li key={b}>{b}</li>)}
              </ul>
            </div>

            <div className="ipai-card">
              <div className="ipai-card-h">🧠 记忆与进化</div>
              <div className="ipai-mem">
                <div>
                  <b>数字高管会记住你的口味</b>
                  <span>每次交付后沉淀偏好，下次按这个风格来（演示）</span>
                </div>
                <button
                  type="button"
                  className={memoryOn ? "ipai-tgl on" : "ipai-tgl"}
                  onClick={() => { setMemoryOn((v) => !v); toast(memoryOn ? "记忆已暂停（演示）" : "记忆已开启 · 下次照这个口味来（演示）"); }}
                  aria-pressed={memoryOn}
                ><i /></button>
              </div>
            </div>

            <button type="button" className="ipai-btn wide" onClick={() => { window.location.href = getAppPath("/ipai/franchise/spec"); }}>
              📄 查看产品说明（功能与计费口径）
            </button>
          </section>
        )}

        <nav className="ipai-tabbar" aria-label="演示导航">
          {TABS.map((t) => (
            <button type="button" key={t.key} className={tab === t.key ? "ipai-tab on" : "ipai-tab"} onClick={() => setTab(t.key)}>
              <i>{t.icon}</i><span>{t.label}</span>
            </button>
          ))}
        </nav>

        {toastMsg ? <div className="ipai-toast">{toastMsg}</div> : null}
      </div>
    </main>
  );
}

function NewScheduleForm({ onCreate }: { onCreate: (s: IpaiSchedule) => void }) {
  const [key, setKey] = useState(IPAI_AGENTS[0].key);
  const [freq, setFreq] = useState(IPAI_FREQ[0]);
  const agent = agentOf(key);

  return (
    <div className="ipai-form">
      <label>
        <span>高管</span>
        <select value={key} onChange={(e) => setKey(e.target.value)}>
          {IPAI_AGENTS.map((a) => <option key={a.key} value={a.key}>{a.name} · {a.role.replace(" · 数字高管", "")}</option>)}
        </select>
      </label>
      <label>
        <span>频率</span>
        <select value={freq} onChange={(e) => setFreq(e.target.value)}>
          {IPAI_FREQ.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
      </label>
      <label>
        <span>场景</span>
        <select value={agent?.scenes[0] ?? ""} disabled>
          <option>{agent?.scenes[0] ?? "—"}</option>
        </select>
      </label>
      <button
        type="button"
        className="ipai-btn"
        onClick={() => onCreate({ key, when: freq, name: `${agent?.name ?? ""} · ${agent?.scenes[0] ?? ""}`, desc: "到点自动派活 · 结果进「最近生成」", on: true })}
      >
        保存定时任务
      </button>
    </div>
  );
}

export function IpaiFranchiseSpecPage() {
  return (
    <main className="app-wrap">
      <MallTopbar back="/ipai/franchise" badge="产品说明 · 招商加盟版" />
      <div className="ipai ipai-spec">
        <header className="ipai-head">
          <div className="ipai-head-t">
            <h1>产品说明</h1>
            <span className="ipai-v">招商加盟版</span>
          </div>
          <p>功能边界、单价、算力计费与免责口径 · 与演示页完全一致</p>
        </header>

        {IPAI_SPEC.map((s) => (
          <section key={s.h} className="ipai-sec">
            <h2>{s.h}</h2>
            {s.cards.map((c, i) => (
              <div key={i} className="ipai-spec-card">
                {c.t ? <b>{c.t}</b> : null}
                <p>{c.b}</p>
              </div>
            ))}
            {s.steps.length ? (
              <ol className="ipai-steps">
                {s.steps.map((st, i) => <li key={i}><span>{i + 1}</span>{st}</li>)}
              </ol>
            ) : null}
            {s.rows.length ? (
              <div className="ipai-rows">
                {s.rows.map((r) => (
                  <div key={r.t} className="ipai-row"><b>{r.t}</b><span>{r.p}</span></div>
                ))}
              </div>
            ) : null}
            {s.paras.map((p, i) => <p key={i} className="ipai-para">{p}</p>)}
          </section>
        ))}

        <button type="button" className="ipai-btn wide" onClick={() => { window.location.href = getAppPath("/ipai/franchise"); }}>
          ← 回到演示
        </button>
      </div>
    </main>
  );
}

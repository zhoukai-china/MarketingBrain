// IP+AI 业绩倍增系统 · 招商加盟版 —— 系统内页面（2026-10-09）
//
// 与上一版的区别：**不是我自己重画的一版页面**，而是把交付原型 ipai-franchise-demo-20261008.html
// 原样搬进系统：
//   · 结构 = IpaiFranchiseMarkup.tsx（原型 HTML 逐字转成的 JSX，类名/文案完全一致）
//   · 样式 = styles/ipai-franchise.css（原型 CSS 原样拷贝，仅加 .ipai-root 作用域）
//   · 行为 = 本组件用 React 接管（原型的 onclick 转成 data-act，由 onAct 统一处理）
//   · 数据 = ipai-franchise-data.ts（价格/场景/任务/说明页均由原型抽取）
// 唯一改动：9 位数字高管的「派活」由原型跳本地 demo 改为**跳系统内真实工作台**；
//          甄映（文生视频）系统暂无该能力，提示「即将上线」，不假接。

import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { getAppPath } from "../lib/api.js";
import { MallTopbar } from "./MallTopbar.js";
import {
  AgentsMarkup,
  HeadMarkup,
  HeroMarkup,
  HomeMarkup,
  MeMarkup,
  RedlineMarkup,
  SheetMarkup,
  TabbarMarkup,
  TaskMarkup
} from "./IpaiFranchiseMarkup.js";
import { IPAI_AGENTS, IPAI_FREQ, IPAI_RECOMMEND, IPAI_SCHEDULES, IPAI_SPEC, type IpaiSchedule } from "./ipai-franchise-data.js";

/** 首页「最近生成」（原型同款演示记录）。 */
const RECENT: Array<{ key: string; title: string; desc: string; time: string }> = [
  { key: "qinwen", title: "苏笺 · 招商文案", desc: "品牌招商朋友圈 · 合伙人社群 1 条", time: "今天 09:12 · 已扣 15 算力" },
  { key: "luzhen", title: "甄映 · 文生视频", desc: "招商口播视频 · 15 秒竖版", time: "昨天 16:40 · 已扣 120 算力" },
  { key: "hece", title: "金点 · 选题包", desc: "本周招商选题 3 条 · 已拍 1 条", time: "10-04 · 已扣 99 算力" }
];

function agentOf(key: string) {
  return IPAI_AGENTS.find((a) => a.key === key);
}

export function IpaiFranchisePage() {
  const [tab, setTab] = useState<"home" | "agents" | "task" | "me">("home");
  const [toastMsg, setToastMsg] = useState("");
  const [sheet, setSheet] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [schedules, setSchedules] = useState<IpaiSchedule[]>(IPAI_SCHEDULES);
  const [sfKey, setSfKey] = useState(IPAI_AGENTS[0].key);
  const [sfFreq, setSfFreq] = useState(IPAI_FREQ[0]);
  const rootRef = useRef<HTMLDivElement>(null);

  function toast(m: string) {
    setToastMsg(m);
    window.setTimeout(() => setToastMsg(""), 2200);
  }

  /** 派活 → 系统内真实工作台 */
  function openOrder(key: string) {
    const a = agentOf(key);
    if (!a) return;
    if (!a.workbench) {
      toast(`${a.name}（${a.role.replace(" · 数字高管", "")}）工作台即将上线`);
      return;
    }
    window.location.href = getAppPath(a.workbench);
  }

  /** 原型 onclick 的统一接管器 */
  function onAct(e: MouseEvent<HTMLElement>) {
    const el = (e.target as HTMLElement).closest("[data-act]") as HTMLElement | null;
    if (!el) return;
    const act = el.getAttribute("data-act") || "";
    const m = /^(\w+)\((.*)\)$/.exec(act.trim());
    if (!m) return;
    const fn = m[1];
    const args = m[2]
      ? m[2].split(",").map((x: string) => x.trim().replace(/^['"]|['"]$/g, ""))
      : [];

    switch (fn) {
      case "switchTab":
        if (args[0]) setTab(args[0] as "home" | "agents" | "task" | "me");
        window.scrollTo(0, 0);
        break;
      case "openOrder":
        openOrder(args[0]);
        break;
      case "loopJump":
      case "chipFilter":
        setTab("agents");
        window.scrollTo(0, 0);
        break;
      case "openSched":
        setSheet(true);
        break;
      case "closeSched":
        setSheet(false);
        setFormOpen(false);
        break;
      case "openSchedForm":
        setFormOpen(true);
        break;
      case "closeSchedForm":
        setFormOpen(false);
        break;
      case "pickSfAgent":
        setSfKey(args[0]);
        break;
      case "pickSf":
        if (args[0] === "freq") setSfFreq(args[1]);
        else setSfKey(args[1]);
        break;
      case "saveSched": {
        const a = agentOf(sfKey);
        setSchedules((prev) => [
          ...prev,
          { key: sfKey, when: sfFreq, name: `${a?.name ?? ""} · ${a?.scenes[0] ?? ""}`, desc: "到点自动派活 · 结果进增长台「最近生成」", on: true }
        ]);
        setFormOpen(false);
        toast("定时任务已保存（演示）");
        break;
      }
      case "tglSch":
        el.classList.toggle("on");
        toast(el.classList.contains("on") ? "定时任务已开启 · 到点自动派活（演示）" : "定时任务已暂停（演示）");
        break;
      case "checkTask":
        el.classList.toggle("done");
        break;
      case "apiConnect":
        toast("录音卡为演示：API 连接以线上为准");
        break;
      case "memAdd":
      case "memEdit":
      case "memSave":
      case "memCancel":
      case "memCancelNew":
      case "memDel":
        toast("记忆与进化为演示功能 · 正式版以线上为准");
        break;
      case "toast":
        toast(args[0] || "");
        break;
      default:
        toast("演示环境 · 该功能以线上为准");
    }
  }

  // 原型用 .act 标记当前 tab；这里由 React 状态同步到 DOM 类
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    root.querySelectorAll<HTMLElement>(".tab").forEach((el) => {
      el.classList.toggle("act", el.getAttribute("data-tab") === tab);
    });
  }, [tab]);

  // 原型用 .act 标记当前页/当前 tab；这里用 React 状态驱动
  const todayPick = useMemo(() => IPAI_RECOMMEND[new Date().getDay()] ?? IPAI_RECOMMEND[0], []);

  const recNode = (
    <>
      {RECENT.map((r) => {
        const a = agentOf(r.key);
        return (
          <div key={r.key} className="gen-it" onClick={() => openOrder(r.key)} role="button" tabIndex={0}
               onKeyDown={(ev) => { if (ev.key === "Enter") openOrder(r.key); }}>
            <div className="gen-ic">{a?.outH.slice(0, 2) ?? "·"}</div>
            <div className="gen-m">
              <b>{r.title}</b>
              <span>{r.desc}</span>
              <span className="rc-t">{r.time}</span>
            </div>
            <span className="gen-arrow">›</span>
          </div>
        );
      })}
      <div className="card-note">今日推荐：{agentOf(todayPick[0])?.name} · {todayPick[2]}</div>
    </>
  );

  const schedNode = (
    <>
      {schedules.map((s, i) => (
        <div key={s.key + i} className="sch">
          <span className="sch-when">
            {s.when.split(" ").map((part, idx) => (
              <span key={idx}>{part}{idx === 0 ? <br /> : null}</span>
            ))}
          </span>
          <div className="tk-t">
            <b>{s.name}</b>
            <span>{s.desc}</span>
          </div>
          <button
            type="button"
            className={s.on ? "tgl on" : "tgl"}
            onClick={() => {
              setSchedules((prev) => prev.map((x, idx) => (idx === i ? { ...x, on: !x.on } : x)));
              toast(s.on ? "定时任务已暂停（演示）" : "定时任务已开启 · 到点自动派活（演示）");
            }}
          />
        </div>
      ))}
    </>
  );

  const sfAgentsNode = (
    <div className="chips">
      {IPAI_AGENTS.map((a) => (
        <button key={a.key} type="button" className={a.key === sfKey ? "chip on" : "chip"} onClick={() => setSfKey(a.key)}>
          {a.name}
        </button>
      ))}
    </div>
  );

  const sfFreqNode = (
    <div className="chips">
      {IPAI_FREQ.map((f) => (
        <button key={f} type="button" className={f === sfFreq ? "chip on" : "chip"} onClick={() => setSfFreq(f)}>
          {f}
        </button>
      ))}
    </div>
  );

  return (
    <main className="app-wrap">
      <MallTopbar back="/agents" badge="IP+AI 业绩倍增系统 · 招商加盟版" />
      <div className="ipai-root" ref={rootRef}>
        <HeadMarkup onAct={onAct} />
        <HeroMarkup onAct={onAct} />

        {tab === "home" ? <HomeMarkup rec={recNode} onAct={onAct} /> : null}
        {tab === "agents" ? <AgentsMarkup onAct={onAct} /> : null}
        {tab === "task" ? <TaskMarkup sched={null} onAct={onAct} /> : null}
        {tab === "me" ? <MeMarkup onAct={onAct} /> : null}

        <RedlineMarkup onAct={onAct} />
        {sheet ? <SheetMarkup sfAgents={sfAgentsNode} sfFreq={sfFreqNode} sched={schedNode} onAct={onAct} /> : null}
        <TabbarMarkup onAct={onAct} />
        {toastMsg ? <div className="toast on">{toastMsg}</div> : null}
        <button
          type="button"
          className="ipai-spec-entry"
          onClick={() => { window.location.href = getAppPath("/ipai/franchise/spec"); }}
        >
          📄 产品说明 · 功能与计费口径
        </button>
      </div>
    </main>
  );
}

export function IpaiFranchiseSpecPage() {
  return (
    <main className="app-wrap">
      <MallTopbar back="/ipai/franchise" badge="产品说明 · 招商加盟版" />
      <div className="ipai-root ipai-spec">
        <div className="spec-wrap">
          <div className="card">
            <div className="card-h">📄 产品说明 · 招商加盟版</div>
            <div className="card-note">内容由原型说明页原样抽取，计费口径与免责条款未作改动。</div>
          </div>
          {IPAI_SPEC.map((s) => (
            <div className="card" key={s.h}>
              <div className="card-h">{s.h}</div>
              {s.cards.map((c, i) => (
                <div key={i} className="spec-card">
                  {c.t ? <b>{c.t}</b> : null}
                  <p>{c.b}</p>
                </div>
              ))}
              {s.steps.length ? (
                <ol className="spec-steps">
                  {s.steps.map((st, i) => <li key={i}><span>{i + 1}</span>{st}</li>)}
                </ol>
              ) : null}
              {s.rows.length ? (
                <div className="spec-rows">
                  {s.rows.map((r) => (
                    <div key={r.t} className="spec-row"><b>{r.t}</b><span>{r.p}</span></div>
                  ))}
                </div>
              ) : null}
              {s.paras.map((p, i) => <p key={i} className="spec-para">{p}</p>)}
            </div>
          ))}
          <button type="button" className="big-btn" onClick={() => { window.location.href = getAppPath("/ipai/franchise"); }}>
            进入「招商加盟版」演示 →
          </button>
        </div>
      </div>
    </main>
  );
}

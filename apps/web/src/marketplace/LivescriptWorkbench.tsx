// 直播话术工作台（/agent/ipzone__livescript/workbench）
//
// 视觉与交互对齐原型 livescript-workbench-demo-20260924（与文案/视频复盘工作台同一套 cpw- 骨架）：
//  - 左：罗盘引导对话（先定场次类型 → 按对应打法一次只问一个问题 → 答案自动填「📋 开播简报」）；
//  - 右：开播简报（6 字段可点改）+ 脚本包画布（占位 / 生成中逐件点亮 / 交付）。
//
// 「后端功能与 /chat 一样」的落地：
//  - 同一个 /market/skus/ipzone__livescript/run；需求单文本与对话页同构（业务字段逐行列出），
//    并把场次类型 / 品牌 / 人群 / 动作 / 时长 / 交付深度全部带全（不因分流丢信息）；
//  - livescript 在 FIXED_PRICE_SKUS（按次一口价，目录 ppu），费用口径「一口价 N 算力/次 · 失败不扣费」，
//    不写「按实际用量结算」；✅ 生成失败不扣费按原型保留；
//  - livescript 是最重的技能（串行 9 段 + 附属件，常 5-10 分钟）：超时放宽到 15 分钟，
//    进度沿用「诚实机制」——日志末行由后端真实返回揭晓，未返回前进度 <100%。
// 原型里的「知识付费」场次后端无专属分支：照常收集信息并写进需求单（引擎按场次类型适配）。

import { useEffect, useRef, useState } from "react";
import { apiPath, getAppPath, getAppRoutePath } from "../lib/api.js";
import { useScrollLock } from "../lib/use-scroll-lock.js";
import { authHeaders, handleStaleSession, readJson } from "./shell.js";
import { IconAuto, IconLead } from "./IconGlyph.js";
import { MallTopbar } from "./MallTopbar.js";
import { renderMarkdownHtml } from "./AgentChatPage.js";
import { employeeAvatarPath } from "./eco-mall-data.js";
import sitongAvatar from "../assets/sitong-beauty.png";

/* ================= 原型数据（逐字对齐 livescript-workbench-demo-20260924） ================= */

const FIELDS: Array<{ key: string; icon: string; label: string }> = [
  { key: "mode", icon: "🎬", label: "场次类型" },
  { key: "brand", icon: "🏷️", label: "品牌 / 主推" },
  { key: "audience", icon: "👥", label: "目标人群" },
  { key: "action", icon: "🎯", label: "转化动作" },
  { key: "duration", icon: "⏱️", label: "场次时长" },
  { key: "depth", icon: "📋", label: "交付深度" }
];

interface QOpt { t: string; d: string; v: string; rec?: boolean; /** example：行业示例——点击先进输入框让用户改，回车确认才进简报（不直接落库）。 */ example?: boolean }
interface QFlow { field: string; when?: { mode: string[] }; q: string; hint: string; opts?: QOpt[] }

const QFLOW: QFlow[] = [
  { field: "mode", q: "这场直播是哪一种？", hint: "先定「这场赚谁的钱」——带货赚消费者、招商赚创业者，两套打法完全不同，我不串场。",
    opts: [
      { t: "招商加盟", d: "示例：招城市合伙人 · 走完整链路", v: "招商加盟", rec: true },
      { t: "带货（本地生活团购）", d: "到店 & 团购核销类", v: "带货" },
      { t: "知识付费 / 课程", d: "按产品=课程处理", v: "知识付费" }
    ] },
  { field: "brand", when: { mode: ["招商加盟"] }, q: "品牌是做什么的？有哪些看得见的硬实力？", hint: "直营数据、供应链、培训体系…没有的先写「暂无」，我不瞎编。",
    opts: [
      { t: "📦 供应链 / 实体工厂型品牌", d: "示例：有直营与产能背书 · 点了改成你的", v: "供应链 / 实体工厂型品牌，有直营门店与产能背书", example: true },
      { t: "🏥 连锁服务型品牌", d: "示例：美业 / 餐饮连锁 · 点了改成你的", v: "连锁服务型品牌，有成熟单店模型", example: true }
    ] },
  { field: "audience", when: { mode: ["招商加盟"] }, q: "这场想吸引谁进直播间？", hint: "决定痛点脚本讲给谁听。",
    opts: [
      { t: "想找第二增长曲线的本地老板", d: "示例：有生意基础，想加新线", v: "想找第二增长曲线的本地老板", rec: true },
      { t: "想创业的上班族", d: "", v: "想创业的上班族" },
      { t: "同行转型者", d: "", v: "同行转型者" }
    ] },
  { field: "action", when: { mode: ["招商加盟"] }, q: "全场唯一的转化动作是什么？", hint: "一场只主推一个动作，钩子和收尾都围着它转。",
    opts: [
      { t: "私信「合伙人」领测算表 + 预约沟通", d: "示例：关键词私信 → 留资承接", v: "私信「合伙人」领《盈利测算表》并预约一对一", rec: true },
      { t: "点小风车留资", d: "", v: "小风车留资" },
      { t: "预约到司考察", d: "", v: "预约到司考察" }
    ] },
  { field: "brand", when: { mode: ["带货", "知识付费"] }, q: "主推什么产品 / 套餐？真实价格是多少？", hint: "品名 + 真实团购价。价格机制没确认，我不会写进逼单。",
    opts: [
      { t: "💆 到店核销类团单", d: "示例：美业 / 门店服务 · 点了改成你的", v: "到店核销类团单", example: true },
      { t: "🍚 餐饮双人套餐", d: "示例：餐饮团购 · 点了改成你的", v: "餐饮双人套餐团单", example: true }
    ] },
  { field: "audience", when: { mode: ["带货", "知识付费"] }, q: "来看直播的主要是谁？", hint: "决定痛点场景怎么讲。",
    opts: [
      { t: "门店周边 3 公里的本地客", d: "示例：到店型消费", v: "门店周边 3 公里的本地客", rec: true },
      { t: "囤券型价格敏感客", d: "", v: "囤券型价格敏感客" }
    ] },
  { field: "action", when: { mode: ["带货", "知识付费"] }, q: "最想让观众做什么？", hint: "团购券下单、领券到店核销，还是直接下单？",
    opts: [
      { t: "团购券下单", d: "", v: "团购券下单", rec: true },
      { t: "领券到店核销", d: "", v: "领券到店核销" }
    ] },
  { field: "duration", q: "这场播多久？", hint: "时长决定节奏表——每 20 分钟一浪，从 0 分钟排到你下播。",
    opts: [
      { t: "120 分钟", d: "示例：5-7 轮完整浪潮 · 招商完整场次", v: "120", rec: true },
      { t: "90 分钟", d: "", v: "90" },
      { t: "60 分钟", d: "", v: "60" }
    ] },
  { field: "depth", q: "脚本交付到什么深度？", hint: "只要一段能念的，还是整场从开场到下播的完整脚本包？",
    opts: [
      { t: "轻量 · 单段脚本", d: "1-2 分钟可照读 + 运营配合 · 约 3 分钟", v: "light" },
      { t: "完整 · 整场脚本十件套", d: "总览→开场→四套轮播→钩子→应答→收尾→节奏表→场控清单 · 约 5-10 分钟", v: "full", rec: true }
    ] }
];

/** 整场脚本十件套（原型 PIECES 元数据，逐字）。 */
const PIECES: Array<{ no: string; g: string; gt: string; icon: string; title: string; d: string }> = [
  { no: "①", g: "plan", gt: "策划区", icon: "🧭", title: "直播总览", d: "场景·目标·人群·合规边界" },
  { no: "②", g: "script", gt: "脚本区", icon: "🎬", title: "开场暖场", d: "0:00-0:05 暖场 · 两步式自我介绍" },
  { no: "③", g: "script", gt: "脚本区", icon: "💔", title: "痛点浪潮", d: "第一浪起手 · 讲给想找增长线的老板" },
  { no: "④", g: "script", gt: "脚本区", icon: "🏗️", title: "系统实演示", d: "系统实演示 · 只讲事实不讲保证" },
  { no: "⑤", g: "script", gt: "脚本区", icon: "📐", title: "怎么赚钱", d: "怎么赚钱讲清楚 · 风险提示强制嵌入" },
  { no: "⑥", g: "script", gt: "脚本区", icon: "🤝", title: "总部扶持", d: "总部给什么 + 不是给钱就收" },
  { no: "⑦", g: "hook", gt: "承接区", icon: "🪝", title: "钩子与应答", d: "钩子×3 轮换 · 应答×5 合规安全版" },
  { no: "⑧", g: "script", gt: "脚本区", icon: "🏁", title: "收尾脚本", d: "0:115-0:120 · 到点就收不硬拖" },
  { no: "⑨", g: "exec", gt: "执行区", icon: "🗓️", title: "全场节奏表", d: "0→120 连续覆盖 · 20 分钟一浪" },
  { no: "⑩", g: "exec", gt: "执行区", icon: "🛠️", title: "场控清单", d: "开播前 / 直播中 / 下播后 + 合规提醒" }
];
const GROUP_COLOR: Record<string, string> = { plan: "#E8651A", script: "#2563eb", hook: "#b26a00", exec: "#7c3aed" };
const GROUP_SOFT: Record<string, string> = { plan: "#fdeee2", script: "#e8effd", hook: "#fff4e0", exec: "#f1eafd" };
/** 轻量模式唯一交付卡（原型 LIGHT_PIECE）。 */
const LIGHT_PIECE = { no: "✦", g: "script", gt: "脚本区", icon: "📄", title: "单段脚本 · 开场暖场（可照读）", d: "1-2 分钟可照读 + 运营配合" };

type Phase = "idle" | "ask" | "confirm" | "gen" | "done";
interface ChatMsg { id: number; who: "ai" | "user"; html: string; pending?: boolean; /** 临时消息（如「已恢复对话」提示）：不落草稿——否则每次重进叠一条。 */ ephemeral?: boolean }

const RUN_TIMEOUT_MS = 900_000; // livescript 串行 9 段+附属件，常 5-10 分钟
const LOG_DELAY_MS = 650;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function LivescriptWorkbench({ skuId }: { skuId: string }) {
  const [skuPpu, setSkuPpu] = useState<number | null>(null);
  const avatar = employeeAvatarPath(skuId) ?? sitongAvatar;

  const [phase, setPhase] = useState<Phase>("idle");
  const [brief, setBrief] = useState<Record<string, string>>({});
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [optsQ, setOptsQ] = useState<number | null>(null); // 当前待答题在 qList 中的下标
  const [confirmOpts, setConfirmOpts] = useState(false);
  const [freeInput, setFreeInput] = useState("");
  const [flashFields, setFlashFields] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [supplement, setSupplement] = useState("");

  // 生成中（诚实进度：末行由后端真实返回揭晓）
  const [logLines, setLogLines] = useState<string[]>([]);
  const [logIdx, setLogIdx] = useState(0);
  const [genIdx, setGenIdx] = useState(-1);
  const [elapsed, setElapsed] = useState(0);
  const runResultRef = useRef<{ answer: string; consumed: number | null } | null>(null);
  const [runSettled, setRunSettled] = useState(false);
  const [logDone, setLogDone] = useState(false);

  const [answerMd, setAnswerMd] = useState("");
  const [consumed, setConsumed] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);

  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const draftRef = useRef<HTMLTextAreaElement | null>(null);

  // 2026-09-29（用户）：编辑弹窗打开后，背景固定、不可滚动。
  useScrollLock(Boolean(editing));

  const msgIdRef = useRef(0);
  const briefRef = useRef<Record<string, string>>({});
  const logRef = useRef<HTMLDivElement | null>(null);
  const timersRef = useRef<number[]>([]);
  const qListRef = useRef<QFlow[]>([]); // 当前分流下的问题队列
  const depthRef = useRef<"light" | "full">("full");
  /** 会话轮次：跳过/重置时 +1，让飞行中的生成回调知道自己已过期、放弃推进。 */
  const runIdRef = useRef(0);
  /** 生成进行中：期间自由输入先不接（AI 还没问下一题，答了会对不上题）。 */
  const digestingRef = useRef(false);
  /** 生成候选：q = 属于第几题（qList 下标）。只有那道题真的问出来才渲染——先问后荐。 */
  const [genCandidates, setGenCandidates] = useState<{ q: number; list: string[] } | null>(null);

  function pushMsg(who: "ai" | "user", html: string, pending = false): number {
    const id = ++msgIdRef.current;
    setMessages((prev) => [...prev, { id, who, html, pending }]);
    return id;
  }
  /** 消化回应成型后替换占位；html 传 null = 移除该条（无兜底话术的流程用）。 */
  function replaceMsg(id: number, html: string | null) {
    setMessages((prev) => (html == null ? prev.filter((m) => m.id !== id) : prev.map((m) => (m.id === id ? { ...m, html, pending: false } : m))));
  }
  function later(fn: () => void, ms: number) {
    const t = window.setTimeout(fn, ms);
    timersRef.current.push(t);
    return t;
  }
  function flash(fields: string[]) {
    setFlashFields(fields);
    later(() => setFlashFields([]), 700);
  }

  useEffect(() => {
    document.title = "直播话术工作台 · 思潼AI商城";
    let cancelled = false;
    void fetch(apiPath("/market/skus"))
      .then((r) => readJson<{ skus: Array<{ skuCode: string; ppu: number }> }>(r))
      .then((data) => {
        if (cancelled) return;
        const sku = data?.skus?.find((s) => s.skuCode === skuId);
        if (sku && typeof sku.ppu === "number") setSkuPpu(sku.ppu);
      })
      .catch(() => { /* 价格取不到就隐藏，不阻塞 */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skuId]);

  useEffect(() => () => {
    timersRef.current.forEach((t) => { window.clearTimeout(t); window.clearInterval(t); });
  }, []);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, optsQ, confirmOpts]);

  /*
   * 进页：有草稿就**恢复整个对话**（聊天记录 + 简报 + 分流队列 + 进度），
   * 没有才从头开始问候。restoreDraft 幂等（StrictMode 双跑不产生重复消息）。
   */
  useEffect(() => {
    if (!restoreDraft()) resetAll(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 对话草稿的 localStorage 键：按 skuId 隔离。 */
  const DRAFT_KEY = `livescript_chat_draft_${skuId}`;

  /** 访谈进行中实时落草稿；生成中不落（正式结果另有交付区找回）。 */
  useEffect(() => {
    if (phase === "gen") return;
    // 空对话不落盘：StrictMode 双跑时挂载初期的空 state 会先于恢复生效，
    // 若此时覆盖写，会把刚读到的真草稿清成空、导致下一次启动恢复失败（ip-pos 实测踩中）。
    if (messages.length === 0) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({
        v: 1,
        phase, optsQ,
        brief: briefRef.current,
        messages: messages.filter((m) => !m.pending && !m.ephemeral),
        genCandidates
      }));
    } catch { /* 存储满等异常忽略：草稿是尽力而为 */ }
  }, [DRAFT_KEY, phase, optsQ, messages, genCandidates]);

  /** 恢复上次对话；返回是否成功。幂等：setMessages 整组替换，StrictMode 双跑结果一致。 */
  function restoreDraft(): boolean {
    let d: {
      phase?: string; optsQ?: number | null;
      brief?: Record<string, string>;
      messages?: ChatMsg[];
      genCandidates?: { q: number; list: string[] } | null;
    } | null = null;
    try {
      const raw = localStorage.getItem(`livescript_chat_draft_${skuId}`);
      if (raw) d = JSON.parse(raw);
    } catch { d = null; }
    if (!d || !Array.isArray(d.messages)) return false;
    const msgs = d.messages.filter((m): m is ChatMsg => Boolean(m) && typeof m.id === "number" && typeof m.who === "string" && !m.pending && !m.ephemeral);
    if (msgs.length === 0) return false;
    const maxId = msgs.reduce((acc, m) => Math.max(acc, m.id), 0);
    const brief0 = d.brief ?? {};
    // gen/done 不恢复（生成中的活没法续、交付物另有找回），落到确认态让用户改简报重生成
    const wasEnd = d.phase === "gen" || d.phase === "done";
    // 分流队列按存档时的场次类型重建（qList 下标才有效）
    qListRef.current = brief0.mode
      ? QFLOW.filter((x) => !x.when || x.when.mode.includes(brief0.mode!))
      : [QFLOW[0]];
    depthRef.current = brief0.depth === "light" ? "light" : "full";
    const lastIdx = Math.max(0, qListRef.current.length - 1);
    const optsQ0 = Math.min(Math.max(0, Number(d.optsQ) || 0), lastIdx);
    msgIdRef.current = maxId + 1;
    setMessages([...msgs, { id: maxId + 1, who: "ai", html: "↩️ 已恢复上次的对话，接着答就行；右侧简报也原样保留。", ephemeral: true }]);
    setBrief(brief0); briefRef.current = brief0;
    if (!wasEnd && d.phase === "ask") {
      setPhase("ask"); setOptsQ(optsQ0);
    } else {
      setPhase("confirm"); setConfirmOpts(true); setOptsQ(null);
    }
    if (d.genCandidates && d.genCandidates.q === optsQ0 && Array.isArray(d.genCandidates.list)) {
      setGenCandidates(d.genCandidates);
    }
    return true;
  }

  function resetAll(greet: boolean) {
    timersRef.current.forEach((t) => { window.clearTimeout(t); window.clearInterval(t); });
    timersRef.current = [];
    setPhase("idle"); setBrief({}); briefRef.current = {};
    setMessages([]); setOptsQ(null); setConfirmOpts(false); setFreeInput("");
    setGenCandidates(null); runIdRef.current += 1; digestingRef.current = false;
    // 用户主动重置 = 丢弃对话草稿，下次从头开始
    try { localStorage.removeItem(`livescript_chat_draft_${skuId}`); } catch { /* ignore */ }
    setError(null); setLogLines([]); setLogIdx(0); setGenIdx(-1);
    setRunSettled(false); setLogDone(false); runResultRef.current = null;
    setAnswerMd(""); setConsumed(null);
    qListRef.current = [QFLOW[0]];
    depthRef.current = "full";
    if (greet) {
      pushMsg("ai", `你好，我是<b>罗盘</b>，你的直播操盘总监 🎤<br>开播前我带你把整场信息配齐——先定<b>场次类型</b>，我按对应打法<b>一次只问一个问题</b>，答案自动填进「📋 开播简报」。`);
      later(() => askQuestion(0), 600);
    }
  }

  /* ---------- 对话流（分流引导，逐字对齐原型话术） ---------- */

  function askQuestion(index: number) {
    setPhase("ask");
    setOptsQ(index);
    const q = qListRef.current[index];
    pushMsg("ai", `<b>${q.q}</b><br><span class="q-hint">${q.hint || ""}</span>`);
  }

  function applyAnswer(q: QFlow, value: string, displayText: string) {
    setOptsQ(null);
    pushMsg("user", escapeHtml(displayText));
    briefRef.current = { ...briefRef.current, [q.field]: value };
    setBrief(briefRef.current);
    flash([q.field]);
    // 场次类型定了 → 按分支重排后续问题队列（消化前就重排：hints 的「下一题」要用）
    if (q.field === "mode") {
      qListRef.current = QFLOW.filter((x) => !x.when || x.when.mode.includes(value));
    }
    if (q.field === "depth") {
      depthRef.current = value === "light" ? "light" : "full";
    }
    // 对话节奏（workbench-conversation-pattern.md §3）：先放「正在消化」占位，
    // 模型生成消化回应回来一次成型（失败就移除占位——本流程没有写死兜底话术），
    // 消化成型后才问下一题；9s 拿不到就直接推进，不让用户对着三个点干等。
    const placeholderId = pushMsg("ai", '<span class="cpw-thinking"><i></i><i></i><i></i></span>', true);
    setGenCandidates(null);
    const nqi = q.field === "mode" ? 1 : (optsQ == null ? 0 : optsQ + 1);
    const next = nqi < qListRef.current.length
      ? (() => { const nq = qListRef.current[nqi]; return { fields: [nq.field], q: nq.q, hint: nq.hint }; })()
      : null;
    const runId = runIdRef.current;
    digestingRef.current = true;
    void loadGenHints(briefRef.current, q.field, displayText, next, placeholderId, nqi, runId);
  }

  /** 调后端生成「消化回应 + 下一题候选」；失败静默（移除占位、照常推进）。 */
  async function loadGenHints(
    answered: Record<string, string>,
    answeredField: string,
    answeredText: string,
    next: { fields: string[]; q: string; hint?: string } | null,
    placeholderId: number,
    nqi: number,
    runId: number
  ) {
    let digest: string | null = null;
    let candidates: string[] = [];
    try {
      const res = await fetch(apiPath("/market/interview-hints"), {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify({
          answered, answeredField, answeredText, next,
          persona: { name: "罗盘", role: "直播操盘总监，正在引导用户收集开播信息（一次只问一个维度）" }
        }),
        signal: AbortSignal.timeout(9000)
      });
      if (res.ok) {
        const data = (await res.json()) as { digest?: string | null; candidates?: string[] };
        digest = typeof data.digest === "string" ? data.digest : null;
        candidates = Array.isArray(data.candidates) ? data.candidates : [];
      }
    } catch { /* 超时/网络异常：占位移除、照常推进 */ }
    replaceMsg(placeholderId, digest);
    if (candidates.length > 0 && runIdRef.current === runId) setGenCandidates({ q: nqi, list: candidates });
    advanceAfterDigest(nqi, runId);
  }

  /** 消化成型后停顿片刻再问下一题；期间用户重置（runId 变了）则放弃推进。 */
  function advanceAfterDigest(nqi: number, runId: number) {
    digestingRef.current = false;
    if (runIdRef.current !== runId) return;
    later(() => {
      if (runIdRef.current !== runId) return;
      if (nqi < qListRef.current.length) askQuestion(nqi);
      else enterConfirm();
    }, 600);
  }

  function chooseOpt(q: QFlow, o: QOpt) {
    if (phase !== "ask") return;
    // 行业示例选项（example）：点击**先进输入框**让用户改成自己的，回车才进简报——
    // 示例数据永不直接落库（workbench-conversation-pattern.md §1/§2）。
    if (o.example) { setFreeInput(o.v); return; }
    applyAnswer(q, o.v, o.t);
  }

  function enterConfirm() {
    setPhase("confirm"); setConfirmOpts(true);
    const b = briefRef.current;
    const dep = depthRef.current === "full"
      ? `整场脚本十件套（${b.mode ?? ""} · ${b.duration ?? ""} 分钟）`
      : "轻量单段脚本";
    pushMsg("ai", `齐了 ✅ 简报 6/6。到 <b>「📋 开播简报」</b>确认后点 <b>「✨ 生成脚本包」</b>，我按 <b>${dep}</b> 交付。中途可以随时打断我改简报。`);
  }

  /** 自由输入：提问中 = 回答当前问题；确认后 = 补充说明。 */
  function freeSend() {
    const v = freeInput.trim();
    if (!v) return;
    if (digestingRef.current) return; // 消化中：AI 还没问下一题，答了会对不上题
    setFreeInput("");
    if (phase === "ask" && optsQ != null) {
      const q = qListRef.current[optsQ];
      applyAnswer(q, v, v);
    } else if (phase === "confirm") {
      pushMsg("user", escapeHtml(v));
      setSupplement((prev) => (prev ? `${prev}；${v}` : v));
      pushMsg("ai", "已记录 ✅ 会把这条说明一并交给脚本引擎，点「✨ 生成脚本包」生效。");
    } else {
      pushMsg("user", escapeHtml(v));
      pushMsg("ai", "已记录。生成中不适合改动需求，等这一稿交付后再告诉我～");
    }
  }

  /** 老手通道：跳过引导直接进确认态，字段留空由用户自己填——宁可不填，也不填错的。 */
  function skipGuide() {
    if (phase === "gen" || phase === "done") return;
    timersRef.current.forEach((t) => { window.clearTimeout(t); window.clearInterval(t); });
    timersRef.current = [];
    setMessages([]); setOptsQ(null); setConfirmOpts(false);
    setBrief({}); briefRef.current = {};
    setGenCandidates(null); runIdRef.current += 1; digestingRef.current = false;
    depthRef.current = "full";
    setPhase("confirm"); setConfirmOpts(true);
    pushMsg("ai", "好，老手通道 🚀 跳过引导，直接在右侧「📋 开播简报」把 6 项填好（点字段即可输入）。填完点 <b>「✨ 生成脚本包」</b>。");
  }

  /* ---------- 生成（后端与 /chat 同一个 /run） ---------- */

  function buildInput(): string {
    const brief = briefRef.current;
    const items = [
      `- 场次类型：${brief.mode || "（待补充）"}`,
      `- 品牌 / 主推：${brief.brand || "（待补充）"}`,
      `- 目标人群：${brief.audience || "（待补充）"}`,
      `- 转化动作：${brief.action || "（待补充）"}`,
      `- 场次时长：${brief.duration ? `${brief.duration} 分钟` : "（待补充）"}`,
      `- 交付深度：${depthRef.current === "light" ? "轻量 · 单段脚本" : "完整 · 整场脚本十件套"}`,
      supplement ? `- 补充说明：${supplement}` : ""
    ].filter(Boolean).join("\n");
    return `请按「直播话术」方法论，基于下面业务信息生成最终交付。\n${items}`;
  }

  async function startGen() {
    if (phase !== "confirm") return;
    if (FIELDS.filter((f) => (briefRef.current[f.key] ?? "").trim()).length < FIELDS.length) {
      setError(`开播简报还有 ${FIELDS.length - FIELDS.filter((f) => (briefRef.current[f.key] ?? "").trim()).length} 项没填，点简报字段补全后再生成。`);
      return;
    }
    setError(null);
    setConfirmOpts(false);
    setPhase("gen");
    setElapsed(0); setGenIdx(-1);
    setRunSettled(false); setLogDone(false); runResultRef.current = null;
    setAnswerMd(""); setConsumed(null);

    // 日志（原型同款）；末行 ✅ 由后端真实返回揭晓——结果没回来前进度 <100%
    const list = depthRef.current === "light" ? [LIGHT_PIECE] : PIECES;
    const ordered: string[] = [
      "→ 读取开播简报与场次参数 …",
      "→ 加载直播脚本 skill（live_script_planner V3.1）",
      `→ 场景识别：${brief.mode} · 整场 ${brief.duration} 分钟`,
      "→ 合规预审：扫描违禁词库 … 0 命中 ✓",
      ...list.map((p) => `✓ ${p.no} ${p.title}`)
    ];
    setLogLines([...ordered, "✓ 交付完成，已写入交付区"]);

    let li = 0;
    const step = () => {
      li += 1;
      setLogIdx(li);
      const t = ordered[li - 1] ?? "";
      if (t.startsWith("✓")) setGenIdx((g) => g + 1);
      if (li < ordered.length) later(step, LOG_DELAY_MS);
      // 走完停在最后一件 ✓；完成行由 runSettled 揭晓
    };
    later(step, 300);
    const tick = window.setInterval(() => setElapsed((e) => e + 1), 1000);
    timersRef.current.push(tick);

    try {
      const res = await fetch(apiPath(`/market/skus/${encodeURIComponent(skuId)}/run`), {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify({ input: buildInput() })
      });
      window.clearInterval(tick);
      if (handleStaleSession(res.status)) {
        throw new Error("登录已过期，本地登录信息已清除。请点右上角「未登录 · 点击登录」重新登录；本次不消耗算力。");
      }
      if (res.status === 402) {
        const data = (await res.json().catch(() => ({}))) as { message?: string };
        const nextRoute = `${getAppRoutePath(window.location.pathname)}${window.location.search}`;
        setError(`${data.message ?? "当前算力不足，请先充值后再使用。"}（本次未消耗算力） 请前往充值页后回来，简报已在本页保留。`);
        setPhase("confirm"); setConfirmOpts(true);
        window.setTimeout(() => {
          window.location.href = getAppPath(`/agents?recharge=1&skill=${encodeURIComponent(skuId)}&next=${encodeURIComponent(nextRoute)}`);
        }, 400);
        return;
      }
      if (res.status === 502 || res.status === 503 || res.status === 504) {
        throw new Error(
          `直播话术要串行跑 9 段 + 附属件（常 5-10 分钟），这次网关的等待上限先到了（HTTP ${res.status}）。` +
          "这一稿在后台通常还在继续：生成成功会正常计费并留存 7 天，稍后可回到对话页找回，不必急着重做。"
        );
      }
      const result = await readJson<{
        answer: string;
        consumedCredits: number;
        needsInput?: boolean;
        requestId?: string;
      }>(res);
      if (result.needsInput) {
        const question = (result.answer ?? "").trim();
        throw new Error(
          (question ? `罗盘还想确认一下：${question} ` : "还需要补充一些关键信息。") +
          "请对照左侧简报补充后重新生成（本次不消耗算力）。"
        );
      }
      runResultRef.current = {
        answer: result.answer ?? "",
        consumed: typeof result.consumedCredits === "number" ? result.consumedCredits : null
      };
      setRunSettled(true);
    } catch (e) {
      window.clearInterval(tick);
      setError(e instanceof Error ? e.message : "生成失败，请稍后重试。");
      setPhase("confirm"); setConfirmOpts(true);
      pushMsg("ai", "这一稿没有生成成功（<b>本次不消耗算力</b>）。按提示补充或稍后再点「✨ 生成脚本包」。");
    }
  }

  /** 日志末行（交付完成）由后端真实返回触发揭晓——结果没回来前日志停在最后一件 ✓、进度条封顶 <100%。 */
  useEffect(() => {
    if (phase !== "gen" || !runSettled || logDone || logLines.length === 0) return;
    if (logIdx < logLines.length - 1) return;
    const result = runResultRef.current;
    if (!result) return;
    setConsumed(result.consumed);
    setAnswerMd(result.answer);
    setLogIdx(logLines.length);
    setLogDone(true);
    setPhase("done");
    pushMsg("ai", `交付完成 ✅ <b>${depthRef.current === "full" ? "整场脚本十件套" : "单段脚本"}</b>已放到右侧——从开场到下播按节奏表走，钩子与应答都是合规安全版。可复制全部、导出 Word。本次消耗 <b>${result.consumed ?? skuPpu ?? "—"} 算力</b>。`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, runSettled, logDone, logIdx, logLines]);

  /* ---------- 简报编辑 ---------- */

  function editField(key: string) {
    if (phase === "gen") return;
    setDraft(brief[key] ?? "");
    setEditing(key);
  }
  function saveEditing() {
    if (!editing) return;
    const key = editing;
    const v = draft.trim();
    setBrief((prev) => {
      const next = { ...prev };
      if (v) next[key] = v;
      else delete next[key];
      return next;
    });
    if (key === "depth") depthRef.current = v === "light" ? "light" : "full";
    if (phase === "done") { setPhase("confirm"); setAnswerMd(""); setConsumed(null); }
    setEditing(null);
  }
  useEffect(() => {
    if (!editing) return;
    const t = window.setTimeout(() => draftRef.current?.focus(), 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setEditing(null);
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); saveEditing(); }
    };
    window.addEventListener("keydown", onKey);
    return () => { window.clearTimeout(t); window.removeEventListener("keydown", onKey); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  /* ---------- 导出 ---------- */

  function copyText(t: string) {
    try { void navigator.clipboard.writeText(t); } catch { /* 隐私模式忽略 */ }
  }
  async function exportWord() {
    if (exporting || !answerMd.trim()) return;
    setExporting(true);
    try {
      const response = await fetch(apiPath("/exports/docx"), {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify({ title: "直播话术脚本包 · 思潼AI", content: answerMd })
      });
      if (handleStaleSession(response.status)) {
        window.alert("登录状态已失效，本地登录信息已清除。请重新登录后再导出。");
        return;
      }
      const created = await readJson<{ downloadUrl?: string; filename?: string }>(response);
      if (!created.downloadUrl) throw new Error("Word 生成失败，请稍后再试。");
      const fileResponse = await fetch(apiPath(created.downloadUrl), { headers: authHeaders(), cache: "no-store" });
      if (!fileResponse.ok) throw new Error("Word 下载失败，请重新导出。");
      const blob = await fileResponse.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = created.filename || "直播话术脚本包.docx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Word 生成失败，请稍后再试。");
    } finally {
      setExporting(false);
    }
  }

  /* ---------- 派生 ---------- */

  const filled = FIELDS.filter((f) => (brief[f.key] ?? "").trim()).length;
  const statusText =
    phase === "gen" ? "生成中 · 串行推导" :
    phase === "done" ? "已交付" :
    phase === "confirm" ? "引导完成" :
    phase === "ask" ? `引导中（${filled}/6）` : "待引导";
  const feeHint =
    phase === "done" ? <>本次实际消耗 <b>{consumed ?? skuPpu ?? "—"} 算力</b></> :
    phase === "confirm" ? <>本次交付：<b>{depthRef.current === "full" ? "整场脚本十件套" : "单段脚本"} · 一口价 {skuPpu ?? "—"} 算力/次</b></> :
    <>完成引导后可生成 · 一口价 <b>{skuPpu ?? "—"} 算力</b>/次（校验不过 / 失败不扣费）</>;
  const gpTotal = logLines.length || 1;
  const gpPct = Math.round(Math.min(logIdx, gpTotal) / gpTotal * 100);
  const pieceList = depthRef.current === "light" ? [LIGHT_PIECE] : PIECES;

  return (
    <main className="cpw-page">
      <MallTopbar back={`/agent/${encodeURIComponent(skuId)}/detail`} badge="直播话术智能体 · 话术工作台" />

      <header className="cpw-hero">
        <div className="cpw-wrap">
          <div className="cpw-chips">
            <span className="cpw-chip dev">直播话术智能体</span>
            <span className="cpw-chip">罗盘 · 直播操盘总监</span>
            <span className="cpw-chip">直播话术工作台</span>
          </div>
          <h1><img className="cpw-emoji" src={avatar} alt="罗盘" />直播话术工作台</h1>
          <p className="cpw-hook">左边罗盘把整场信息配齐，右边整场脚本十件套实时长出来。</p>
          <p className="cpw-ability">先定场次类型（招商 / 带货 / 知识付费）→ 开播简报 → 整场脚本十件套（总览 / 开场 / 四套轮播 / 钩子应答 / 收尾 / 节奏表 / 场控）分区交付：可复制全部、导出 Word（免费），一口价 {skuPpu ?? "—"} 算力/次。直播话术要串行跑 9 段+附属件，常 5-10 分钟，请耐心等进度条。</p>
        </div>
      </header>

      <section className="cpw-demo">
        <div className="cpw-wrap">
          <div className="cpw-sec-head"><h2>▶ <span className="cpw-k">工作台</span></h2><span className="cpw-desc">左：开播引导｜右：开播简报 + 脚本交付</span></div>
          <div className="cpw-stage">
            <div className="cpw-bar">
              <span className="cpw-dot r" /><span className="cpw-dot y" /><span className="cpw-dot g" />
              <span className="cpw-url">思潼AI · 直播话术工作台</span>
              <span className="cpw-st"><span className={`cpw-st-dot ${phase === "gen" ? "playing" : phase === "done" ? "done" : ""}`} /><span>{statusText}</span></span>
              <div className="cpw-ctrls">
                <button className="cpw-sbtn" onClick={() => resetAll(true)}>↻ 重置</button>
              </div>
            </div>
            <div className="cpw-body">
              {/* 左：引导对话 */}
              <div className="cpw-chat">
                <div className="cpw-chat-head">
                  <div className="cpw-av"><img src={avatar} alt="罗盘" /></div>
                  <div><b>罗盘 · 开播引导</b><span>一次只问一个问题 · 回答自动填入右侧简报</span></div>
                </div>
                <div className="cpw-log" ref={logRef}>
                  {messages.map((m) => (
                    <div key={m.id} className={`cpw-msg${m.who === "user" ? " user" : ""}`}>
                      {m.who === "ai" && <div className="cpw-m-av"><img src={avatar} alt="" /></div>}
                      <div className={`cpw-bub${m.pending ? " is-pending" : ""}`} dangerouslySetInnerHTML={{ __html: m.html }} />
                    </div>
                  ))}
                  {optsQ != null && phase === "ask" && qListRef.current[optsQ] && (
                    <div className="cpw-opts">
                      {(qListRef.current[optsQ].opts ?? []).map((o, i) => (
                        <button key={i} className="cpw-opt" onClick={() => chooseOpt(qListRef.current[optsQ], o)}>
                          {o.t}{o.d ? <small>{o.d}</small> : null}
                        </button>
                      ))}
                    </div>
                  )}
                  {confirmOpts && phase === "confirm" && (
                    <div className="cpw-opts">
                      <button className="cpw-opt go" onClick={() => { setConfirmOpts(false); void startGen(); }}>
                        ✓ 确认，开始生成<small>整场脚本十件套 · 一口价 {skuPpu ?? "—"} 算力 · 常 5-10 分钟</small>
                      </button>
                      <button className="cpw-opt" onClick={() => { setConfirmOpts(false); pushMsg("ai", "直接点击右侧简报里的字段修改，改完点「✨ 生成脚本包」。"); }}>
                        ✎ 改一下再生成<small>点击右侧简报字段直接修改</small>
                      </button>
                    </div>
                  )}
                </div>
                {phase === "ask" && genCandidates && optsQ === genCandidates.q && genCandidates.list.length > 0 && (
                  /* 模型按你的场次/行业生成的候选：点了放进输入框，改完再发（不直接进简报）。 */
                  <div className="cpw-opts">
                    {genCandidates.list.map((c, i) => (
                      <button key={i} className="cpw-opt" onClick={() => setFreeInput(c)}>{c}</button>
                    ))}
                  </div>
                )}
                <div className="cpw-skip">赶时间？<a onClick={skipGuide}>跳过引导，直接在右侧简报填写 6 项 →</a></div>
                <div className="cpw-input">
                  <input
                    value={freeInput}
                    onChange={(e) => setFreeInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") freeSend(); }}
                    placeholder="也可以直接打字回答当前问题，或补充要求"
                  />
                  <button onClick={freeSend}>发送</button>
                </div>
              </div>

              {/* 右：工作区 */}
              <div className="cpw-ws">
                <div className="cpw-ws-inner">
                  <div className="cpw-brief">
                    <div className="cpw-brief-t">
                      <b>📋 开播简报</b>
                      <span className="cpw-brief-sub">字段可随时点击修改，改完可重新生成</span>
                      <div className="cpw-meter"><span>{filled}/6</span><div className="cpw-segs">{FIELDS.map((f, i) => <div key={f.key} className={`cpw-seg${i < filled ? " on" : ""}`} />)}</div></div>
                    </div>
                    <div className="cpw-grid">
                      {FIELDS.map((f) => {
                        const v = (brief[f.key] ?? "").trim();
                        const show = f.key === "depth" && v ? (v === "light" ? "轻量 · 单段脚本" : "完整 · 整场脚本十件套") : v;
                        return (
                          <div key={f.key} className={`cpw-bf${v ? " filled" : ""}${flashFields.includes(f.key) ? " flash" : ""}`} title={v ? "点击修改" : "等待左侧引导填入"} onClick={() => editField(f.key)}>
                            <div className="cpw-bf-k"><IconAuto v={f.icon} /> {f.label}{v ? "" : " · 待填"}</div>
                            <div className="cpw-bf-v">{show || "——"}</div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="cpw-ops">
                      {phase !== "gen" && phase !== "done" && (
                        <button className="cpw-big-btn gen" onClick={() => {
                          const missing = FIELDS.filter((f) => !(brief[f.key] ?? "").trim());
                          if (missing.length > 0) {
                            setError(`还有 ${missing.length} 项没填：${missing.map((f) => f.label).join("、")}。点右侧简报字段补全后再生成。`);
                            return;
                          }
                          setError(null);
                          setConfirmOpts(false);
                          void startGen();
                        }}><IconAuto v="✨" /> 生成脚本包</button>
                      )}
                      {phase === "done" && (
                        <button className="cpw-big-btn ghost" onClick={() => { setPhase("confirm"); setAnswerMd(""); setConsumed(null); }}>↻ 改简报重新生成</button>
                      )}
                      <span className="cpw-fee">{feeHint}</span>
                      <span className="cpw-safe-tag"><IconAuto v="🛡" /> 失败不扣费</span>
                    </div>
                    {error && <div className="cpw-err">{error}</div>}
                  </div>

                  <div className="cpw-canvas">
                    {phase === "done" && answerMd.trim() ? (
                      <div className="cpw-dl">
                        <div className="cpw-dl-head">
                          <span className="cpw-ok-tag">✓ 已交付</span>
                          <span className="cpw-time">{depthRef.current === "full" ? "整场脚本十件套" : "单段脚本"} · {brief.mode} · {brief.duration} 分钟 · 消耗 {consumed ?? skuPpu ?? "—"} 算力</span>
                          <div className="cpw-dl-ops">
                            <button className="cpw-cbtn" onClick={() => copyText(answerMd)}>⧉ 复制全部</button>
                            <button className="cpw-cbtn" onClick={() => void exportWord()} disabled={exporting}>{exporting ? "导出中…" : "↓ 导出 Word"}</button>
                          </div>
                        </div>
                        <div className="cpw-pc-c markdown" dangerouslySetInnerHTML={{ __html: renderMarkdownHtml(answerMd) }} />
                      </div>
                    ) : phase === "gen" ? (
                      <>
                        <div className="cpw-ph-note">⏳ 生成中 · 已等待 {elapsed} 秒，脚本包逐件点亮<span className="cpw-tag">{depthRef.current === "full" ? "整场十件套" : "轻量单段"}</span></div>
                        <div className="cpw-gen-prog">
                          <div className="cpw-gp-row"><div className="cpw-gp-bar"><i style={{ width: `${gpPct}%` }} /></div><b>{gpPct}%</b></div>
                          <div className="cpw-gp-meta"><span>{logLines[logIdx - 1]?.replace(/^(→ |✓ |✅ )/, "")?.slice(0, 24) || "准备中…"}</span><span>{logIdx >= logLines.length - 1 && !runSettled ? `后端生成中… 已等待 ${elapsed} 秒（常 5-10 分钟）` : gpPct >= 100 ? "马上就好…" : `预计还需 ~${Math.max(1, Math.ceil((gpTotal - logIdx) * LOG_DELAY_MS / 1000))} 秒`}</span></div>
                        </div>
                        <div className="cpw-genlog">
                          {logLines.slice(0, logIdx).map((ln, i) => (
                            <div key={i} className={`cpw-ln ${ln.startsWith("✅") ? "hl" : ln.startsWith("✓") ? "ok" : ""}`}>{ln}</div>
                          ))}
                        </div>
                        <div className="cpw-ph-grid">
                          {pieceList.map((p, i) => {
                            const cls = i < genIdx ? "cpw-ph done" : i === genIdx ? "cpw-ph gening" : "cpw-ph locked";
                            const spanCls = depthRef.current === "light" ? " span2" : "";
                            return (
                              <div key={p.no} className={cls + spanCls}>
                                {i === genIdx && <span className="cpw-spin" />}
                                <div className="cpw-no" style={{ color: GROUP_COLOR[p.g], background: GROUP_SOFT[p.g] }}>{p.no} · {p.gt}</div>
                                <b><IconAuto v={p.icon} /> {p.title}</b>
                                <span className="cpw-d">{p.d}</span>
                              </div>
                            );
                          })}
                        </div>
                      </>
                    ) : phase === "confirm" ? (
                      <>
                        <div className="cpw-ph-note">🧩 交付结构预览 · 确认简报后点「✨ 生成脚本包」<span className="cpw-tag">{depthRef.current === "full" ? "整场十件套" : "轻量单段"}</span></div>
                        <div className="cpw-ph-grid">
                          {(depthRef.current === "light" ? [LIGHT_PIECE] : PIECES).map((p) => (
                            <div key={p.no} className="cpw-ph locked">
                              <div className="cpw-no" style={{ color: GROUP_COLOR[p.g], background: GROUP_SOFT[p.g] }}>{p.no} · {p.gt}</div>
                              <b><IconAuto v={p.icon} /> {p.title}</b>
                              <span className="cpw-d">{p.d}</span>
                            </div>
                          ))}
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="cpw-ph-note">👋 完成引导后，脚本包会在这里分区生成<span className="cpw-tag">先选场次类型</span><span className="cpw-tag">再选交付深度</span></div>
                        <div className="cpw-ph-grid initial">
                          <div className="cpw-ph locked span2"><div className="cpw-no" style={{ color: GROUP_COLOR.script, background: GROUP_SOFT.script }}>轻量</div><b>📄 单段脚本</b><span className="cpw-d">1-2 分钟可照读 + 运营配合 · 约 3 分钟</span></div>
                          <div className="cpw-ph locked span3"><div className="cpw-no" style={{ color: GROUP_COLOR.plan, background: GROUP_SOFT.plan }}>完整</div><b>🎬 整场脚本十件套</b><span className="cpw-d">总览→开场→四套轮播→钩子→应答→收尾→节奏表→场控清单 · 约 5-10 分钟</span></div>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {editing && (
        <div className="cpw-modal-mask" onClick={() => setEditing(null)}>
          <div className="cpw-modal" onClick={(e) => e.stopPropagation()}>
            <div className="cpw-modal-t">{FIELDS.find((f) => f.key === editing) && <IconAuto v={FIELDS.find((f) => f.key === editing)!.icon} />} 修改「{FIELDS.find((f) => f.key === editing)?.label}」</div>
            {editing === "depth" ? (
              <div className="cpw-depth-opts">
                <button className={`cpw-depth-opt${draft === "light" ? " act" : ""}`} onClick={() => setDraft("light")}>📄 轻量 · 单段脚本<small>1-2 分钟可照读 + 运营配合</small></button>
                <button className={`cpw-depth-opt${draft !== "light" ? " act" : ""}`} onClick={() => setDraft("full")}>🎬 完整 · 整场脚本十件套<small>总览→开场→四套轮播→钩子→应答→收尾→节奏表→场控</small></button>
              </div>
            ) : (
              <textarea ref={draftRef} value={draft} onChange={(e) => setDraft(e.target.value)} rows={4} placeholder="输入内容，留空保存 = 清空该字段" />
            )}
            <div className="cpw-modal-ops">
              <button className="cpw-big-btn ghost" onClick={() => setEditing(null)}>取消</button>
              <button className="cpw-big-btn gen" onClick={() => saveEditing()}>保存（⌘/Ctrl+Enter）</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

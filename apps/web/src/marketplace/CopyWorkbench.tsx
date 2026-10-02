// 文案创作工作台（/agent/ipzone__copy/workbench）
//
// 视觉与交互**严格对齐原型** copy-workbench-demo-20260922.html：
//  - 左：暗色引导对话（一次只问一个问题，5 问固定话术 + 选项 chips，答案自动填右侧简报）；
//  - 右：创作简报（5 字段可点改）+ 画布（占位 / 生成中日志+进度 / 分区 tabs 交付区）。
//
// 2026-10-02 用户：交付深度不再让用户选——**默认就是完整（内容十件套）**，简报槽位由 6 减到 5，
// 提交时固定按「完整」交付。轻量的选项/入口全部去掉（保留 LIGHT 相关代码仅为兼容旧草稿，正常不会命中）。
//
// 「功能与 /chat 一样」指的是**后端**：同一个 `/market/skus/ipzone__copy/run`（计费、
// 十件套契约、needsInput 全同源）。请求体与 chat-flows.buildRunBody 同构（{ input: 需求单文本 }）。
// 后端契约固定输出「一、选题策划 … 十、投流建议」十段 Markdown（copy-ten-contract.ts），
// 交付区按这十段拆卡、按原型分区（策划/文稿/拍摄/发布/投流）分 tab。
//
// 计费口径（不犯 ip-pos 的错）：文案按**次固定收费**（2026-10-01 用户拍板），费用文案用真实目录 ppu 与「算力」，
// 不照抄原型里的演示价（10/15 算力）；「🛡️ 失败不扣费」按原型保留（生成失败确实不扣）。

import { useEffect, useRef, useState } from "react";
import { apiPath, getAppPath, getAppRoutePath } from "../lib/api.js";
import { useScrollLock } from "../lib/use-scroll-lock.js";
import { authHeaders, handleStaleSession, readJson } from "./shell.js";
import { IconAuto, IconLead } from "./IconGlyph.js";
import { DemoBar, scheduleInterviewDemo, scheduleDemoLog } from "./workbench-demo.js";
import { COPY_DEMO_STEPS, COPY_DEMO_ANSWER_MD } from "./copy-demo-data.js";
import { MallTopbar } from "./MallTopbar.js";
import { renderRichReportHtml } from "./rich-report.js";
import { employeeAvatarPath } from "./eco-mall-data.js";
import sitongAvatar from "../assets/sitong-beauty.png";

/* ================= 原型数据（逐字对齐 QFLOW / FIELDS / PIECES） ================= */

const FIELDS: Array<{ key: string; icon: string; label: string }> = [
  { key: "product", icon: "📦", label: "产品 / 服务" },
  { key: "selling", icon: "💎", label: "核心卖点" },
  { key: "platform", icon: "📺", label: "投放平台" },
  { key: "action", icon: "🎯", label: "期望动作" },
  { key: "camera", icon: "🎬", label: "出镜方式" }
];

interface QOpt { t: string; d: string; v: string; rec?: boolean; /** example：行业示例——点击先进输入框让用户改，回车确认才进简报（不直接落库）。 */ example?: boolean }
/** opts 可选。enum: 系统枚举题（如交付深度 light/full）——选项是封闭集合，不走 LLM 候选，直接让用户二选一。 */
interface QFlow { field: string; q: string; hint: string; opts?: QOpt[]; enum?: boolean }

const QFLOW: QFlow[] = [
  { field: "product", q: "这次给什么产品 / 服务写文案？", hint: "名字 + 一句话卖点就行，也可以后面传资料让我自己读。",
    opts: [
      { t: "🐶 宠物门店洗护年卡", d: "示例：门店年卡锁客类 · 点了改成你的", v: "宠物门店洗护年卡（全年不限次）", example: true },
      { t: "🍜 餐饮门店 / 团购", d: "示例：到店 & 团购核销类 · 点了改成你的", v: "餐饮门店团购套餐", example: true },
      { t: "💆 美业门店服务", d: "示例：护理 / 科技美容类 · 点了改成你的", v: "美业门店护理服务", example: true }
    ] },
  { field: "selling", q: "它最想让观众记住的一个卖点是什么？", hint: "不用完美，先给一个方向，我写稿时会放大。" },
  { field: "platform", q: "主要发布到哪个平台？", hint: "多平台也没关系，我会做适配。",
    opts: [
      { t: "抖音 + 视频号", d: "示例：双平台同发", v: "抖音 + 视频号", rec: true },
      { t: "仅抖音", d: "", v: "抖音" },
      { t: "仅视频号", d: "", v: "视频号" },
      { t: "小红书", d: "", v: "小红书" }
    ] },
  { field: "action", q: "希望观众看完做什么动作？", hint: "这是文案最后一句的落点，也是钩子设计方向。",
    opts: [
      { t: "评论区留言「洗澡」约体验", d: "示例：关键词互动 → 到店转化", v: "引导评论区留言「洗澡」约到店体验", rec: true },
      { t: "关注账号", d: "", v: "关注账号" },
      { t: "私信咨询", d: "", v: "私信咨询" },
      { t: "到店 / 留资", d: "", v: "到店 / 留资" }
    ] },
  { field: "camera", q: "出镜方式是哪种？", hint: "决定拍摄脚本和注意事项怎么写。",
    opts: [
      { t: "老板 / 创始人自己出镜", d: "示例：门店老板抱宠出镜", v: "门店老板抱宠出镜", rec: true },
      { t: "代运营拍摄", d: "", v: "代运营拍摄" },
      { t: "无人出镜（图文 / 混剪）", d: "", v: "无人出镜（图文 / 混剪）" }
    ] }
];

/** 十件套元数据（与后端 copy-ten-contract 的「一、…十、」十段一一对应）。 */
interface PieceMeta { no: string; num: string; g: string; gt: string; icon: string; title: string; d: string }
const PIECES: PieceMeta[] = [
  { no: "①", num: "一", g: "plan", gt: "策划区", icon: "🧭", title: "选题策划", d: "角度·爆款元素·脚本类型·漏斗层级" },
  { no: "②", num: "二", g: "doc", gt: "文稿区", icon: "🎤", title: "口播逐字稿", d: "60 秒 · 可照读 · 带 B-roll 切换点" },
  { no: "③", num: "三", g: "doc", gt: "文稿区", icon: "🗣️", title: "访谈话术", d: "一问一答补可信" },
  { no: "④", num: "四", g: "shoot", gt: "拍摄区", icon: "🎥", title: "拍摄脚本", d: "固定机位镜号表 + B-roll 清单" },
  { no: "⑤", num: "五", g: "shoot", gt: "拍摄区", icon: "🧾", title: "拍摄注意事项", d: "前期准备清单" },
  { no: "⑥", num: "六", g: "shoot", gt: "拍摄区", icon: "🎬", title: "剪辑 EDL", d: "给剪辑师的精确指令" },
  { no: "⑦", num: "七", g: "pub", gt: "发布区", icon: "🏷️", title: "发布标题与话题", d: "多版本标题 + 三层话题矩阵" },
  { no: "⑧", num: "八", g: "pub", gt: "发布区", icon: "⏰", title: "最佳发布时间", d: "平台 × 时段 × 策略" },
  { no: "⑨", num: "九", g: "pub", gt: "发布区", icon: "💬", title: "评论区引导话术", d: "置顶 + 互动 + 软转化" },
  { no: "⑩", num: "十", g: "ads", gt: "投流区", icon: "💰", title: "投流建议", d: "PREVIEW_ONLY 路由草案" }
];
const GROUP_NAME: Record<string, string> = { plan: "📋 策划", doc: "✍️ 文稿", shoot: "🎬 拍摄", pub: "🚀 发布", ads: "💰 投流" };
/** 轻量模式唯一交付卡（原型 LIGHT_PIECE）：用十件套的「二、口播稿」+「七、标题话题」合成。 */
const LIGHT_META: PieceMeta = { no: "✦", num: "", g: "doc", gt: "文稿区", icon: "📄", title: "可直发文案（1 条）", d: "标题 + 正文 + 话题" };const GROUP_COLOR: Record<string, string> = { plan: "#E8651A", doc: "#2563eb", shoot: "#7c3aed", pub: "#0f8a5f", ads: "#b26a00" };
const GROUP_SOFT: Record<string, string> = { plan: "#fdeee2", doc: "#e8effd", shoot: "#f1eafd", pub: "#e6f5ee", ads: "#fff4e0" };

type Phase = "idle" | "ask" | "confirm" | "gen" | "done";
interface ChatMsg { id: number; who: "ai" | "user"; html: string; pending?: boolean; /** 临时消息（如「已恢复对话」提示）：不落草稿——否则每次重进叠一条。 */ ephemeral?: boolean }
interface Piece { meta: PieceMeta; body: string }
/** 演示前的现场快照（退出演示时整帧还原）。 */
interface DemoSnapshot {
  messages: ChatMsg[]; brief: Record<string, string>; qi: number; phase: Phase;
  optsQ: number | null; genCandidates: { q: number; list: string[] } | null;
  depth: "light" | "full" | null; pieces: Piece[]; answerMd: string; consumed: number | null;
}

const RUN_TIMEOUT_MS = 300_000;
const LOG_DELAY_MS = 750;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** 把后端十段 Markdown 拆成 { meta, body }；契约保证一、…十、齐全。 */
function parseSections(answerMd: string): Piece[] {
  const out: Piece[] = [];
  const re = /(?:^|\n)#{0,4}\s*\**\s*([一二三四五六七八九十])、\s*([^\n]*)/g;
  const hits: Array<{ num: string; idx: number; end: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(answerMd))) hits.push({ num: m[1], idx: m.index + (m[0].startsWith("\n") ? 1 : 0), end: re.lastIndex });
  for (let i = 0; i < hits.length; i++) {
    const meta = PIECES.find((p) => p.num === hits[i].num);
    if (!meta) continue;
    const bodyStart = hits[i].end;
    const bodyEnd = i + 1 < hits.length ? hits[i + 1].idx : answerMd.length;
    out.push({ meta, body: answerMd.slice(bodyStart, bodyEnd).trim() });
  }
  return out;
}

export function CopyWorkbench({ skuId }: { skuId: string }) {
  const [skuPpu, setSkuPpu] = useState<number | null>(null);
  // 原型固定话术里的人设称呼（逐字对齐）：金牌文案主笔
  const persona = "金牌文案主笔";
  const avatar = employeeAvatarPath(skuId) ?? sitongAvatar;

  const [phase, setPhase] = useState<Phase>("idle");
  /** 演示模式（进页自动播一遍，可随时停止并还原原对话）。 */
  const demoRef = useRef(false);
  const [demoOn, setDemoOn] = useState(false);
  const demoTickRef = useRef<number | null>(null);
  const demoSnapshotRef = useRef<DemoSnapshot | null>(null);
  const [qi, setQi] = useState(0);
  const [brief, setBrief] = useState<Record<string, string>>({});
  // 2026-10-02 用户：交付深度不再让用户选——**默认即完整**，全流程固定按「内容十件套」交付。
  const [depth, setDepth] = useState<"light" | "full" | null>("full");
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [optsQ, setOptsQ] = useState<number | null>(null); // 当前待答的题号（渲染 opts chips）
  const [supplement, setSupplement] = useState("");
  const [freeInput, setFreeInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  // 生成中：日志行 + 进度 + 已点亮的件
  const [logLines, setLogLines] = useState<string[]>([]);
  const [logIdx, setLogIdx] = useState(0);
  const [genIdx, setGenIdx] = useState(-1);
  const [elapsed, setElapsed] = useState(0);
  // 生成结果（后端 resolve 才有）：与「日志走完」共同构成交付门槛——都完成才切 done
  const runResultRef = useRef<{ answer: string; consumed: number | null; subCovered: boolean } | null>(null);
  const [runSettled, setRunSettled] = useState(false);
  const [logDone, setLogDone] = useState(false);

  const [pieces, setPieces] = useState<Piece[]>([]);
  const [answerMd, setAnswerMd] = useState("");
  const [consumed, setConsumed] = useState<number | null>(null);
  const [subCovered, setSubCovered] = useState(false);
  const [tab, setTab] = useState("all");
  const [exporting, setExporting] = useState(false);

  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const draftRef = useRef<HTMLTextAreaElement | null>(null);

  // 2026-09-29（用户）：编辑弹窗打开后，背景固定、不可滚动。
  useScrollLock(Boolean(editing));

  const msgIdRef = useRef(0);
  const logRef = useRef<HTMLDivElement | null>(null);
  const timersRef = useRef<number[]>([]);
  /** brief 的同步镜像：异步生成 hints 时要拿「含本题在内」的最新字段（state 闭包会过期）。 */
  const briefRef = useRef<Record<string, string>>({});
  /** 会话轮次：跳过/重置时 +1，让飞行中的生成回调知道自己已过期、放弃推进。 */
  const runIdRef = useRef(0);
  /** 生成进行中：期间自由输入先不接（AI 还没问下一题，答了会对不上题）。 */
  const digestingRef = useRef(false);
  /** 生成候选：q = 属于第几题。只有那道题真的问出来（optsQ 就位）才渲染——先问后荐。 */
  const [genCandidates, setGenCandidates] = useState<{ q: number; list: string[] } | null>(null);

  function pushMsg(who: "ai" | "user", html: string, pending = false): number {
    // 同步捕获 id：updater 在批处理/重渲染时才执行，读 ref 会撞号（React key 重复告警的根源）
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
  }

  useEffect(() => {
    document.title = "文案创作工作台 · 思潼AI";
    let cancelled = false;
    void fetch(apiPath("/market/skus"))
      .then((r) => readJson<{ skus: Array<{ skuCode: string; ppu: number }> }>(r))
      .then((data) => {
        if (cancelled) return;
        const sku = data?.skus?.find((s) => s.skuCode === skuId);
        if (sku && typeof sku.ppu === "number") setSkuPpu(sku.ppu);
      })
      .catch(() => { /* 价格取不到就隐藏，不阻塞 */ });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skuId]);

  // 定时器只在真正卸载时清理（不能放进带依赖的 effect cleanup：StrictMode 重挂会误清引导定时器）
  useEffect(() => () => {
    timersRef.current.forEach((t) => window.clearTimeout(t));
  }, []);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, optsQ]);

  /*
   * 进页：有草稿就**恢复整个对话**（聊天记录 + 简报 + 进度，2026-09-30 用户要求），
   * 没有才从头开始引导。restoreDraft 幂等（StrictMode 双跑不产生重复消息）。
   */
  useEffect(() => {
    // 进页一律自动演示（演示 = 另开一层叠在上面，退出时整帧还原）。快照必须在覆盖状态前抓。
    const restored = restoreDraft();
    beginDemo(restored ?? {
      messages: [], brief: {}, qi: 0, phase: "idle", optsQ: null, genCandidates: null,
      depth: null, pieces: [], answerMd: "", consumed: null
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 对话草稿的 localStorage 键：按 skuId 隔离。 */
  const DRAFT_KEY = `copy_chat_draft_${skuId}`;

  /** 访谈进行中实时落草稿；生成中不落（正式结果另有交付区找回）。 */
  useEffect(() => {
    if (phase === "gen") return;
    if (demoOn) return; // 演示对话绝不写进真实草稿
    // 空对话不落盘：StrictMode 双跑时挂载初期的空 state 会先于恢复生效，
    // 若此时覆盖写，会把刚读到的真草稿清成空、导致下一次启动恢复失败（ip-pos 实测踩中）。
    if (messages.length === 0) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({
        v: 1,
        phase, qi, optsQ,
        brief,
        messages: messages.filter((m) => !m.pending && !m.ephemeral),
        genCandidates
      }));
    } catch { /* 存储满等异常忽略：草稿是尽力而为 */ }
  }, [DRAFT_KEY, phase, qi, optsQ, brief, messages, genCandidates]);

  /** 恢复上次对话；返回是否成功。幂等：setMessages 整组替换，StrictMode 双跑结果一致。 */
  function restoreDraft(): DemoSnapshot | null {
    let d: {
      phase?: string; qi?: number; optsQ?: number | null;
      brief?: Record<string, string>;
      messages?: ChatMsg[];
      genCandidates?: { q: number; list: string[] } | null;
    } | null = null;
    try {
      const raw = localStorage.getItem(`copy_chat_draft_${skuId}`);
      if (raw) d = JSON.parse(raw);
    } catch { d = null; }
    if (!d || !Array.isArray(d.messages)) return null;
    const msgs = d.messages.filter((m): m is ChatMsg => Boolean(m) && typeof m.id === "number" && typeof m.who === "string" && !m.pending && !m.ephemeral);
    if (msgs.length === 0) return null;
    const maxId = msgs.reduce((acc, m) => Math.max(acc, m.id), 0);
    const brief0 = d.brief ?? {};
    // gen/done 不恢复（生成中的活没法续、交付物另有找回），落到确认态让用户改简报重生成
    const wasEnd = d.phase === "gen" || d.phase === "done";
    const qi0 = Math.min(Math.max(0, Number(d.qi) || 0), QFLOW.length - 1);
    msgIdRef.current = maxId + 1;
    const restoredMsgs: ChatMsg[] = [...msgs, { id: maxId + 1, who: "ai", html: "↩️ 已恢复上次的对话，接着答就行；右侧简报也原样保留。", ephemeral: true }];
    setMessages(restoredMsgs);
    setBrief(brief0); briefRef.current = brief0;
    setDepth("full");
    setQi(qi0);
    if (!wasEnd && d.phase === "ask") {
      setPhase("ask");
      setOptsQ(Math.min(Math.max(0, Number(d.optsQ) || qi0), QFLOW.length - 1));
    } else {
      setPhase("confirm"); setOptsQ(null);
    }
    if (d.genCandidates && d.genCandidates.q === qi0 && Array.isArray(d.genCandidates.list)) {
      setGenCandidates(d.genCandidates);
    }
    return {
      messages: restoredMsgs, brief: brief0, qi: qi0,
      phase: wasEnd ? "confirm" : ((d.phase as Phase) ?? "ask"),
      optsQ: !wasEnd && d.phase === "ask" ? Math.min(Math.max(0, Number(d.optsQ) || qi0), QFLOW.length - 1) : null,
      genCandidates: d.genCandidates && d.genCandidates.q === qi0 ? d.genCandidates : null,
      depth: "full", pieces: [], answerMd: "", consumed: null
    };
  }

  /* ---------- 对话流（逐字对齐原型话术） ---------- */

  function resetAll(greet: boolean, keepDraft = false) {
    timersRef.current.forEach((t) => window.clearTimeout(t));
    timersRef.current = [];
    demoRef.current = false; setDemoOn(false);
    if (demoTickRef.current != null) { window.clearInterval(demoTickRef.current); demoTickRef.current = null; }
    setPhase("idle"); setQi(0); setBrief({}); briefRef.current = {}; setDepth("full");
    setMessages([]); setOptsQ(null); setSupplement(""); setFreeInput("");
    setGenCandidates(null); runIdRef.current += 1; digestingRef.current = false;
    // 用户主动重置 = 丢弃对话草稿；演示开局传 keepDraft=true（演示不得删用户真实进度）
    if (!keepDraft) {
      try { localStorage.removeItem(`copy_chat_draft_${skuId}`); } catch { /* ignore */ }
    }
    setError(null); setLogLines([]); setLogIdx(0); setGenIdx(-1);
    setRunSettled(false); setLogDone(false); runResultRef.current = null;
    setPieces([]); setAnswerMd(""); setConsumed(null); setSubCovered(false); setTab("all");
    if (greet) {
      pushMsg("ai", `你好，我是<b>${persona}</b> ✍️<br>我来带你把这条文案的信息一次配齐——<b>一次只问一个问题</b>，答案会自动填进右侧「创作简报」。`);
      later(() => askQuestion(0), 600);
    }
  }

  function askQuestion(index: number) {
    setPhase("ask"); setQi(index); setOptsQ(index);
    const q = QFLOW[index];
    pushMsg("ai", `<b>${q.q}</b><br><span class="q-hint">${q.hint || ""}</span>`);
  }

  function applyAnswer(field: string, value: string, displayHtml: string) {
    setOptsQ(null);
    pushMsg("user", displayHtml);
    const merged = { ...briefRef.current, [field]: value };
    briefRef.current = merged;
    setBrief(merged);
    if (field === "depth") {
      setDepth("full");
    }
    // 对话节奏（workbench-conversation-pattern.md §3）：先放「正在消化」占位，
    // 模型生成消化回应回来一次成型（失败就移除占位——本流程没有写死兜底话术），
    // 消化成型后才问下一题；9s 拿不到就直接推进，不让用户对着三个点干等。
    const placeholderId = pushMsg("ai", '<span class="cpw-thinking"><i></i><i></i><i></i></span>', true);
    setGenCandidates(null);
    const nqi = qi + 1;
    setQi(nqi);
    // 下一题是系统枚举题（enum）→ 不为它生成候选（选项就是封闭集合，直接二选一），
    // 但当前回答的消化话术照常生成。
    const nq = nqi < QFLOW.length ? QFLOW[nqi] : null;
    const next = nq && !nq.enum
      ? { fields: [nq.field], q: nq.q, hint: nq.hint }
      : null;
    const runId = runIdRef.current;
    digestingRef.current = true;
    void loadGenHints(merged, field, value, next, placeholderId, nqi, runId);
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
          persona: { name: persona, role: "短视频文案主笔，正在引导用户收集创作信息（一次只问一个维度）" }
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
      if (nqi < QFLOW.length) askQuestion(nqi);
      else confirmStep();
    }, 600);
  }

  /* ---------- 演示模式：纯前端脚本走完整流程（不调接口 / 不写草稿 / 不扣算力） ---------- */

  function captureCurrent(): DemoSnapshot {
    return {
      messages: messages.filter((m) => !m.pending && !m.ephemeral),
      brief: { ...briefRef.current }, qi, phase, optsQ, genCandidates, depth,
      pieces, answerMd, consumed
    };
  }

  function beginDemo(snap: DemoSnapshot) {
    if (phase === "gen" && !demoRef.current) { setError("生成中，等这一稿交付后再看演示。"); return; }
    demoSnapshotRef.current = snap;
    startDemo();
  }

  function startDemo() {
    resetAll(false, true); // keepDraft：演示不得删用户真实进度
    demoRef.current = true; setDemoOn(true);
    pushMsg("ai", `你好，我是<b>${persona}</b> 🎬 先<b>演示一遍</b>这套流程怎么用——看完点上方「停止演示」，就能按你自己的产品开始。`);
    const t = scheduleInterviewDemo(COPY_DEMO_STEPS, {
      later, isActive: () => demoRef.current,
      ask: (i) => askQuestion(i),
      showCandidates: (i, list) => setGenCandidates({ q: i, list }),
      hideCandidates: () => setGenCandidates(null),
      fillBrief: (_i, step) => {
        const merged = { ...briefRef.current, ...step.values };
        briefRef.current = merged; setBrief(merged);
        if (step.values.depth === "full" || step.values.depth === "light") setDepth(step.values.depth);
      },
      pushUser: (_i, step) => pushMsg("user", escapeHtml(step.display)),
      pushThinking: () => pushMsg("ai", '<span class="cpw-thinking"><i></i><i></i><i></i></span>', true),
      replaceMsg: (id, html) => replaceMsg(id, html)
    });
    later(() => {
      if (!demoRef.current) return;
      setPhase("confirm");
      setDepth("full");
      pushMsg("ai", "5 项齐了 ✅ 右侧简报就是刚才演示填的。下方的 <b>「✨ 开始创作」</b> 就是这一步——演示替你点一下：");
    }, t + 600);
    // 演示「点下去」这个动作（用户气泡明示），别让按钮一闪而过看起来像没走
    later(() => { if (demoRef.current) pushMsg("user", "▶ 点了「✨ 开始创作」"); }, t + 2600);
    later(() => { if (demoRef.current) runDemoGen(); }, t + 4200);
  }

  /** 模拟生成：复用真实生成页的日志/进度渲染，只换数据来源（无 fetch）。 */
  function runDemoGen() {
    setPhase("gen"); setElapsed(0); setLogIdx(0); setGenIdx(-1);
    setRunSettled(false); setLogDone(false); setPieces([]); setAnswerMd("");
    const list = depth === "light" ? [] : PIECES;
    const ordered = ["→ 读取创作简报与产品资料 …", "→ 加载内容十件套引擎", ...list.map((p) => `✓ ${p.no} ${p.title}`)];
    setLogLines([...ordered, "✓ 交付完成，已写入交付区"]);
    scheduleDemoLog(
      ordered,
      { later, isActive: () => demoRef.current },
      (_line, idx) => {
        setLogIdx(idx);
        const ln = ordered[idx - 1] ?? "";
        if (ln.startsWith("✓")) setGenIdx((g) => g + 1);
      },
      () => finishDemoGen()
    );
    demoTickRef.current = window.setInterval(() => setElapsed((e) => e + 1), 1000);
  }

  function finishDemoGen() {
    if (demoTickRef.current != null) { window.clearInterval(demoTickRef.current); demoTickRef.current = null; }
    setLogDone(true); setLogIdx((i) => Math.max(i, logLines.length));
    setPieces(parseSections(COPY_DEMO_ANSWER_MD));
    setAnswerMd(COPY_DEMO_ANSWER_MD);
    setConsumed(0); setPhase("done");
    pushMsg("ai", "演示完成 ✅ 右侧就是这套流程能交付的<b>内容十件套</b>（用的是示例案例，演示不消耗算力）。点上方 <b>「停止演示」</b>，就能按你自己的产品开始。");
  }

  /** 停止演示 → 清定时器 + 整帧还原演示前的现场。 */
  function stopDemo() {
    if (!demoRef.current) return;
    const snap = demoSnapshotRef.current;
    demoRef.current = false; setDemoOn(false);
    timersRef.current.forEach((t) => { window.clearTimeout(t); window.clearInterval(t); });
    timersRef.current = [];
    if (demoTickRef.current != null) { window.clearInterval(demoTickRef.current); demoTickRef.current = null; }
    demoSnapshotRef.current = null;
    runIdRef.current += 1;
    if (!snap || snap.messages.length === 0) { resetAll(true); return; }
    const maxId = snap.messages.reduce((acc, m) => Math.max(acc, m.id), 0);
    msgIdRef.current = maxId + 1;
    setMessages(snap.messages); setBrief(snap.brief); briefRef.current = snap.brief;
    setDepth(snap.depth); setQi(snap.qi); setPhase(snap.phase); setOptsQ(snap.optsQ);
    setGenCandidates(snap.genCandidates);
    setPieces(snap.pieces); setAnswerMd(snap.answerMd); setConsumed(snap.consumed);
    setLogLines([]); setLogIdx(0); setGenIdx(-1);
    setRunSettled(false); setLogDone(false); runResultRef.current = null;
    setError(null); setFreeInput(""); setElapsed(0); setTab("all");
  }

  function confirmStep() {
    setPhase("confirm");
    pushMsg("ai", `齐了 ✅ 简报 5/5。右侧确认后点 <b>「✨ 开始创作」</b>，我按 <b>完整内容十件套</b> 交付。中途可以随时打断我改简报。`);
  }

  /** 选项点击（原型 answer()） */
  function chooseOpt(q: QFlow, o: QOpt) {
    if (demoRef.current) { setError("演示中，脚本会自己走——点上方「停止演示」即可接管。"); return; }
    if (phase !== "ask") return;
    // 行业示例选项（example）：点击**先进输入框**让用户改成自己的，回车才进简报——
    // 示例数据永不直接落库（workbench-conversation-pattern.md §1/§2）。
    if (o.example) { setFreeInput(o.v || o.t); return; }
    applyAnswer(q.field, o.v, escapeHtml(q.field === "depth" ? o.t : (o.v || o.t)));
  }

  /** 自由输入：提问中 = 回答当前问题；确认后 = 补充说明（真实并入需求单） */
  function freeSend() {
    const v = freeInput.trim();
    if (!v) return;
    if (demoRef.current) { setError("演示中，脚本会自己走——点上方「停止演示」即可接管。"); return; }
    if (digestingRef.current) return; // 消化中：AI 还没问下一题，答了会对不上题
    setFreeInput("");
    if (phase === "ask") {
      const q = QFLOW[qi];
      applyAnswer(q.field, v, escapeHtml(v));
    } else if (phase === "confirm") {
      setSupplement((prev) => (prev ? `${prev}；${v}` : v));
      pushMsg("user", escapeHtml(v));
      pushMsg("ai", "已记录 ✅ 会把这条补充一并交给文案主笔，点「✨ 开始创作」生效。");
    } else {
      pushMsg("user", escapeHtml(v));
      pushMsg("ai", "已记录。生成中不适合改动需求，等这一稿交付后再告诉我～");
    }
  }

  /** 老手通道：跳过访谈直接进确认态，字段留空由用户自己填——宁可不填，也不填错的。 */
  function skipGuide() {
    if (demoRef.current) { setError("演示中，脚本会自己走——点上方「停止演示」即可接管。"); return; }
    if (phase === "gen" || phase === "done") return;
    timersRef.current.forEach((t) => window.clearTimeout(t));
    timersRef.current = [];
    setMessages([]); setOptsQ(null); setSupplement("");
    setBrief({}); briefRef.current = {}; setDepth("full");
    setGenCandidates(null); runIdRef.current += 1; digestingRef.current = false;
    setPhase("confirm"); setQi(QFLOW.length);
    pushMsg("ai", "好，老手通道 🚀 跳过引导，直接在右侧「创作简报」把 5 项填好（点字段即可输入）。填完点 <b>「✨ 开始创作」</b>。");
  }

  /* ---------- 生成（后端与 /chat 同一个 /run） ---------- */

  function buildInput(): string {
    // 轻量模式（2026-09-30 用户：交付目标就是"可直接发的文案"，不是口播稿）：
    // 后端只有一套十件套提示词、没有轻量分支，必须在输入里把输出格式钉死，
    // 否则模型会按十件套里的「口播逐字稿」结构输出 0-3秒/动作/B-roll。
    const depthLine = depth === "light"
      ? [
          "- 交付深度：轻量 · 只交付 1 条可直接发布的文案（不要交付口播逐字稿）",
          "- 输出格式（严格遵守，四段，不加其他小节）：",
          "  标题：一条（20 字内，带钩子）",
          "  正文：可直接复制发布的成稿文案（适配所选平台；禁止 0-3秒/动作/【】标记/B-roll 等拍摄指令）",
          "  话题：#开头的推荐话题若干",
          "  发布建议：一句话（最佳发布时间段）"
        ].join("\n")
      : "- 交付深度：完整 · 内容十件套";
    const items = [
      `- 行业 / 产品卖点：${brief.product || "（待补充）"}`,
      `- 核心卖点：${brief.selling || "（待补充）"}`,
      `- 目标人群：从产品与卖点推断；投放平台：${brief.platform || "（待补充）"}`,
      `- 期望动作：${brief.action || "（待补充）"}`,
      depthLine,
      `- 出镜方式：${brief.camera || "（待补充）"}`,
      supplement ? `- 补充说明：${supplement}` : ""
    ].filter(Boolean).join("\n");
    return `请按「文案」方法论，基于下面业务信息生成最终交付。\n${items}`;
  }

  async function startGen() {
    if (demoRef.current) { setError("演示中不真实生成——点上方「停止演示」结束演示后再生成（那时才消耗算力）。"); return; }
    if (phase !== "confirm" && phase !== "done") return;
    setError(null);
    setPhase("gen");
    setLogIdx(0); setGenIdx(-1); setElapsed(0);
    setRunSettled(false); setLogDone(false); runResultRef.current = null;
    setPieces([]); setAnswerMd(""); setConsumed(null); setSubCovered(false);

    // 日志脚本（原型同款）。末行「交付完成」**由后端真实返回触发揭晓**：
    // 定时器走到最后一件 ✓ 就停住——结果没回来前日志不出完成行、进度条封顶 <100%。
    const list = depth === "light" ? [] : PIECES;
    const ordered = [
      "→ 读取创作简报与产品资料 …",
      "→ 加载内容十件套引擎",
      ...list.map((p) => `✓ ${p.no} ${p.title}`)
    ];
    setLogLines([...ordered, "✓ 交付完成，已写入交付区"]);

    // 日志定时推进
    let li = 0;
    const step = () => {
      li += 1;
      setLogIdx(li);
      if (ordered[li - 1]?.startsWith("✓")) setGenIdx((g) => g + 1);
      if (li < ordered.length) later(step, LOG_DELAY_MS);
      // 走完停在最后一件 ✓；完成行见下方揭晓 effect
    };
    later(step, LOG_DELAY_MS);
    // 计时
    const tick = window.setInterval(() => setElapsed((e) => e + 1), 1000);
    timersRef.current.push(tick);

    // 真实 /run（与 /chat 同源）
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
        setPhase("confirm");
        window.setTimeout(() => {
          window.location.href = getAppPath(`/agents?recharge=1&skill=${encodeURIComponent(skuId)}&next=${encodeURIComponent(nextRoute)}`);
        }, 400);
        return;
      }
      if (res.status === 409) {
        const payload = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
        if (payload.error === "marketplace_subscription_quota_exhausted") {
          setError(`${payload.message ?? "你已开通本智能体的包月，今天的次数已经用完。"}（本次不消耗算力；额度每天 0 点恢复。）`);
          setPhase("confirm");
          return;
        }
        throw new Error(payload.message ?? "本次请求被拒绝；本次不消耗算力。");
      }
      if (res.status === 502 || res.status === 503 || res.status === 504) {
        throw new Error(
          `生成还没跑完，网关的等待上限先到了（HTTP ${res.status}）。这一稿在后台通常还在继续：` +
          "生成成功会正常计费并留存 7 天，稍后重新回到本页面会自动找回，不必急着重做。"
        );
      }
      const result = await readJson<{
        answer: string;
        consumedCredits: number;
        needsInput?: boolean;
        subscription?: { covered?: boolean };
      }>(res);
      if (result.needsInput) {
        const question = (result.answer ?? "").trim();
        throw new Error(
          (question ? `文案主笔还想确认一下：${question} ` : "还需要补充一些关键信息。") +
          "请补充后重新生成（本次不消耗算力）。"
        );
      }
      runResultRef.current = {
        answer: result.answer ?? "",
        consumed: typeof result.consumedCredits === "number" ? result.consumedCredits : null,
        subCovered: Boolean(result.subscription?.covered)
      };
      setRunSettled(true);
      // 扣费已完成（后端返回 consumedCredits/balance）：立即广播余额刷新——
      // 右上角余额只监听 sitong:balance-changed（此前仅充值抽屉会发），不广播就「看起来没扣」。
      window.dispatchEvent(new CustomEvent("sitong:balance-changed"));
    } catch (e) {
      window.clearInterval(tick);
      setError(e instanceof Error ? e.message : "生成失败，请稍后重试。");
      setPhase("confirm");
      pushMsg("ai", "这一稿没有生成成功（<b>本次不消耗算力</b>）。按提示补充或稍后再点「✨ 开始创作」。");
    }
  }

  /** 日志末行（交付完成）由后端真实返回触发揭晓——结果没回来前日志停在某件 ✓、进度条封顶 <100%。 */
  useEffect(() => {
    if (phase !== "gen" || !runSettled || logDone || logLines.length === 0) return;
    if (logIdx >= logLines.length - 1) setLogDone(true);
  }, [phase, runSettled, logDone, logIdx, logLines]);

  /** 交付门槛：后端结果返回 && 日志走完（不提前展示结果） */
  useEffect(() => {
    if (phase !== "gen" || !runSettled || !logDone) return;
    const result = runResultRef.current;
    if (!result) return;
    setConsumed(result.consumed);
    setSubCovered(result.subCovered);
    setAnswerMd(result.answer);
    const parsed = parseSections(result.answer);
    if (depth === "light") {
      // 轻量：只交付 1 张「可直发文案」卡（标题取自第七节主标题、正文取自第二节口播稿、话题取自第七节）
      const s2 = parsed.find((p) => p.meta.num === "二");
      const s7 = parsed.find((p) => p.meta.num === "七");
      if (s2 && s7) {
        const title = (s7.body.match(/主标题[:：]\s*(.+)/) ?? [, ""])[1]?.trim() ?? "";
        const topics = (s7.body.match(/#[^\s#，。；;]+/g) ?? []).slice(0, 6).join(" ");
        const body = `### 标题\n${title}\n\n### 正文（60 秒口播）\n${s2.body}\n\n### 话题\n${topics}`;
        setPieces([{ meta: LIGHT_META, body }]);
      } else {
        setPieces(parsed);
      }
    } else {
      setPieces(parsed.length >= 5 ? parsed : []);
    }
    setPhase("done");
    pushMsg("ai", "交付完成 ✅ 十件已分区放好，每件可单独复制。要改哪件，直接告诉我。");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runSettled, logDone, phase]);

  /* ---------- 简报编辑 ---------- */

  function editField(key: string) {
    if (demoRef.current) { setError("演示中，简报是演示内容——点上方「停止演示」后可编辑。"); return; }
    if (phase === "gen") return;
    setDraft(key === "depth" ? (brief[key] ?? "full") : (brief[key] ?? ""));
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
    if (key === "depth") setDepth(v === "light" ? "light" : "full");
    if (phase === "done") { setPhase("confirm"); setPieces([]); setAnswerMd(""); }
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

  /* ---------- 交付区操作 ---------- */

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
        body: JSON.stringify({ title: "内容十件套 · 思潼AI", content: answerMd })
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
      a.download = created.filename || "内容十件套.docx";
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
  const pieceList = depth === "light" ? [] : PIECES;
  const groups = [...new Set(pieces.map((p) => p.meta.g))];
  const shownPieces = tab === "all" ? pieces : pieces.filter((p) => p.meta.g === tab);
  const gpTotal = logLines.length || 1;
  const gpPct = Math.round(Math.min(logIdx, gpTotal) / gpTotal * 100);
  const statusText =
    phase === "gen" ? `创作中…（已等待 ${elapsed} 秒）` :
    phase === "done" ? "已交付" :
    phase === "confirm" ? "引导完成" :
    phase === "ask" ? `引导中（${Math.min(qi + 1, 5)}/5）` : "待引导";
  const feeHint =
    phase === "done" ? (
      subCovered ? <>本次由<b>包月覆盖</b>，不扣算力</> : <>本次实际消耗 <b>{consumed ?? skuPpu ?? "—"} 算力</b>（按次固定收费）</>
    ) : (
      <>完成引导后可创作 · 预计消耗约 <b>{skuPpu ?? "—"} 算力</b>（按次固定收费）</>
    );

  return (
    <main className="cpw-page">
      {/* Topbar 在作用域外（商城红线：留白/主题由全局容器与 Topbar 自己管） */}
      <MallTopbar back={`/agent/${encodeURIComponent(skuId)}/detail`} badge="文案主笔智能体 · 文案工作台" />

      <header className="cpw-hero">
        <div className="cpw-wrap">
          <h1><img className="cpw-emoji" src={avatar} alt={persona} />文案创作工作台</h1>
          <p className="cpw-hook">跟{persona}聊几句，它帮你把选题、口播稿、拍摄、发布一次备齐。</p>
          <p className="cpw-ability">回答几个问题 → 出创作简报 → 十件套分区交付：单件可复制，交付后可导出 Word（免费）。</p>
        </div>
      </header>

      <section className="cpw-demo">
        <div className="cpw-wrap">
          <div className="cpw-sec-head"><h2>▶ <span className="cpw-k">工作台</span></h2><span className="cpw-desc">左：引导对话｜右：简报 + 交付区</span></div>
          <div className="cpw-stage">
            <div className="cpw-bar">
              <span className="cpw-dot r" /><span className="cpw-dot y" /><span className="cpw-dot g" />
              <span className="cpw-url">思潼AI · 文案创作工作台</span>
              <span className="cpw-st"><span className={`cpw-st-dot ${phase === "gen" ? "playing" : phase === "done" ? "done" : ""}`} /><span>{statusText}</span></span>
              <div className="cpw-ctrls">
                <button className="cpw-sbtn" onClick={() => beginDemo(captureCurrent())}>▶ 看演示</button>
                <button className="cpw-sbtn" onClick={() => resetAll(true)}>↻ 重置</button>
              </div>
            </div>
            <div className="cpw-body">
              {/* 左：引导对话 */}
              <div className="cpw-chat">
                <div className="cpw-chat-head">
                  <div className="cpw-av"><img src={avatar} alt={persona} /></div>
                  <div><b>{persona} · 创作引导</b><span>一次只问一个问题 · 回答自动填入右侧简报</span></div>
                </div>
                {demoOn && <DemoBar onStop={stopDemo} hasPrior={Boolean(demoSnapshotRef.current && demoSnapshotRef.current.messages.length > 0)} />}
                <div className="cpw-log" ref={logRef}>
                  {messages.map((m) => (
                    <div key={m.id} className={`cpw-msg${m.who === "user" ? " user" : ""}`}>
                      {m.who === "ai" && <div className="cpw-m-av"><img src={avatar} alt="" /></div>}
                      <div className={`cpw-bub${m.pending ? " is-pending" : ""}`} dangerouslySetInnerHTML={{ __html: m.html }} />
                    </div>
                  ))}
                  {optsQ != null && phase === "ask" && !(genCandidates && genCandidates.q === optsQ && genCandidates.list.length > 0) && (
                    <div className="cpw-opts">
                      {(QFLOW[optsQ].opts ?? []).map((o, i) => (
                        <button key={i} className="cpw-opt" onClick={() => chooseOpt(QFLOW[optsQ], o)}>
                          {o.t}{o.d ? <small>{o.d}</small> : null}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {phase === "ask" && genCandidates && optsQ === genCandidates.q && genCandidates.list.length > 0 && (
                  /* 模型按你的行业生成的候选：点了放进输入框，改完再发（不直接进简报）。 */
                  <div className="cpw-opts">
                    {genCandidates.list.map((c, i) => (
                      <button key={i} className="cpw-opt" onClick={() => setFreeInput(c)}>{c}</button>
                    ))}
                  </div>
                )}
                <div className="cpw-skip">赶时间？<a onClick={skipGuide}>跳过引导，直接在右侧简报填写 5 项 →</a></div>
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
                      <b>📋 创作简报</b>
                      <span className="cpw-brief-sub">字段可随时点击修改，改完可重新生成</span>
                      <div className="cpw-meter"><span>{filled}/5</span><div className="cpw-segs">{FIELDS.map((f, i) => <div key={f.key} className={`cpw-seg${i < filled ? " on" : ""}`} />)}</div></div>
                    </div>
                    <div className="cpw-grid">
                      {FIELDS.map((f) => {
                        const v = (brief[f.key] ?? "").trim();
                        const show = f.key === "depth" && v ? (v === "full" ? "完整内容十件套" : "轻量 · 1 条可直发文案") : v;
                        return (
                          <div key={f.key} className={`cpw-bf${v ? " filled" : ""}`} title={v ? "点击修改" : "等待左侧引导填入"} onClick={() => editField(f.key)}>
                            <div className="cpw-bf-k"><IconAuto v={f.icon} /> {f.label}{v ? "" : " · 待填"}</div>
                            <div className="cpw-bf-v">{show || "——"}</div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="cpw-ops">
                      {/* 按钮只在确认态出现（workbench-conversation-pattern.md §6）：
                          原来访谈中就渲染 + disabled，点击被静默 return = 「点了没反应」。 */}
                      {phase === "confirm" && (
                        <button className="cpw-big-btn gen" onClick={() => {
                          const missing = FIELDS.filter((f) => !(brief[f.key] ?? "").trim());
                          if (missing.length > 0) {
                            setError(`还有 ${missing.length} 项没填：${missing.map((f) => f.label).join("、")}。点右侧简报字段补全后再开始创作。`);
                            return;
                          }
                          setError(null);
                          void startGen();
                        }}>✨ 开始创作</button>
                      )}
                      {phase === "done" && (
                        <button className="cpw-big-btn ghost" onClick={() => { setPhase("confirm"); setPieces([]); setAnswerMd(""); setConsumed(null); }}>↻ 改简报重新生成</button>
                      )}
                      <span className="cpw-fee">{feeHint}</span>
                      <span className="cpw-safe-tag"><IconAuto v="🛡" /> 失败不扣费</span>
                    </div>
                    {error && <div className="cpw-err">{error}</div>}
                  </div>

                  <div className="cpw-canvas">
                    {phase === "idle" || phase === "ask" ? (
                      <>
                        <div className="cpw-ph-note">👋 完成左侧引导后，交付物会在这里分区生成<span className="cpw-tag">默认完整 · 内容十件套</span></div>
                        <div className="cpw-ph-grid initial">
                          <div className="cpw-ph locked span3"><div className="cpw-no g-shoot">完整</div><b>📦 内容十件套</b><span className="cpw-d">选题→口播→访谈→拍摄→剪辑→标题→时间→评论→投流 · 约 5-10 分钟</span></div>
                        </div>
                      </>
                    ) : null}

                    {(phase === "confirm" || phase === "gen") && depth && (
                      <>
                        <div className="cpw-ph-note">
                          {phase === "gen" ? <>⏳ 生成中 · 已等待 {elapsed} 秒，十件逐件点亮</> : <>🧩 交付结构预览 · 确认简报后点「✨ 开始创作」</>}
                          <span className="cpw-tag">完整十件套</span>
                        </div>
                        {phase === "gen" && (
                          <div className="cpw-gen-prog">
                            <div className="cpw-gp-row"><div className="cpw-gp-bar"><i style={{ width: `${gpPct}%` }} /></div><b>{gpPct}%</b></div>
                            <div className="cpw-gp-meta"><span>{logLines[logIdx - 1]?.replace(/^(→ |✓ |✅ )/, "")?.slice(0, 24) || "准备中…"}</span><span>{logIdx >= logLines.length - 1 && !runSettled ? `后端生成中… 已等待 ${elapsed} 秒` : gpPct >= 100 ? "马上就好…" : `预计还需 ~${Math.max(1, Math.ceil((gpTotal - logIdx) * LOG_DELAY_MS / 1000))} 秒`}</span></div>
                          </div>
                        )}
                        {phase === "gen" && (
                          <div className="cpw-genlog">
                            {logLines.slice(0, logIdx).map((ln, i) => (
                              <div key={i} className={`cpw-ln ${ln.startsWith("✓") ? "ok" : i === 0 ? "" : "hl"}`}>{ln}</div>
                            ))}
                          </div>
                        )}
                        <div className="cpw-ph-grid">
                          {(depth === "light" ? [{ no: "✦", g: "doc", gt: "文稿区", icon: "📄", title: "可直发文案（1 条）", d: "标题 + 正文 + 话题" }] : PIECES).map((p, i) => (
                            <div key={p.no} className={`cpw-ph ${phase === "gen" ? (i <= genIdx ? "gening" : "locked") : "locked"}`}>
                              {phase === "gen" && i <= genIdx && <span className="cpw-spin" />}
                              <div className={`cpw-no g-${p.g}`}>{p.no} {p.gt}</div><b><IconAuto v={p.icon} /> {p.title}</b><span className="cpw-d">{p.d}</span>
                            </div>
                          ))}
                        </div>
                      </>
                    )}

                    {phase === "done" && (
                      <div className="cpw-dl">
                        <div className="cpw-dl-head">
                          <span className="cpw-ok-tag">✓ 已交付</span>
                          <span className="cpw-time">{pieces.length || (depth === "light" ? 1 : 10)} 件 · {subCovered ? "包月覆盖" : `消耗 ${consumed ?? skuPpu ?? "—"} 算力`}</span>
                          <div className="cpw-dl-ops">
                            <button className="cpw-cbtn" onClick={() => copyText(answerMd)}>⧉ 复制全部</button>
                            <button className="cpw-cbtn" onClick={() => void exportWord()} disabled={exporting}>{exporting ? "导出中…" : "↓ 导出 Word"}</button>
                          </div>
                        </div>
                        {pieces.length > 0 && (
                          <>
                            <div className="cpw-tabs">
                              <button className={`cpw-tab${tab === "all" ? " act" : ""}`} onClick={() => setTab("all")}>全部 {pieces.length}</button>
                              {groups.map((g) => (
                                <button key={g} className={`cpw-tab${tab === g ? " act" : ""}`} onClick={() => setTab(g)}>{GROUP_NAME[g]} {pieces.filter((p) => p.meta.g === g).length}</button>
                              ))}
                            </div>
                            <div className="cpw-pieces">
                              {shownPieces.map((p) => (
                                <div className="cpw-pc" key={p.meta.no}>
                                  <div className="cpw-pc-h">
                                    <span className="cpw-pc-no" style={{ background: GROUP_COLOR[p.meta.g] }}>{p.meta.no}</span>
                                    <b><IconAuto v={p.meta.icon} /> {p.meta.title}</b>
                                    <span className="cpw-g-tag" style={{ color: GROUP_COLOR[p.meta.g], background: GROUP_SOFT[p.meta.g] }}>{p.meta.gt}</span>
                                    <div className="cpw-pc-btns">
                                      <button className="cpw-cbtn" onClick={() => copyText(`#${p.meta.num}、${p.meta.title}\n\n${p.body}`)}>⧉ 复制本件</button>
                                    </div>
                                  </div>
                                  <div className="cpw-pc-c markdown" dangerouslySetInnerHTML={{ __html: renderRichReportHtml(p.body) }} />
                                </div>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
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
                <button className={`cpw-depth-opt${draft === "light" ? " act" : ""}`} onClick={() => setDraft("light")}>📄 轻量 · 1 条可直发文案<small>标题 + 正文 + 话题</small></button>
                <button className={`cpw-depth-opt${draft !== "light" ? " act" : ""}`} onClick={() => setDraft("full")}>📦 完整 · 内容十件套<small>选题→口播→访谈→拍摄→剪辑→标题→时间→评论→投流</small></button>
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

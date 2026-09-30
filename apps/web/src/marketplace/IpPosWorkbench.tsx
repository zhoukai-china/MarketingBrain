// IP 定位工作台（/agent/ipzone__ip-pos/workbench）—— 原型对齐版
//
// 视觉与交互**严格对齐原型** ip-pos-workbench-demo-20260924.html（与文案工作台同一套
// cpw- 骨架：舞台栏 / 暗色引导对话 / 浅色工作区 / 分区交付）：
//  - 左：沈定 6 步访谈（一次只问一个维度，每答一轮有「消化回应」digest，答案自动填右侧简报）；
//  - 右：定位简报（8 字段，可点改）+ 全案画布（占位 / ready / 生成中逐张点亮+日志+进度 / 分区交付）。
//
// 后端功能与原对话页同源（这是「不犯错的底线」）：
//  - 生成前体检 /precheck（不扣算力）保留，slot 精确勾销；体检通过才进生成；
//  - 生成走同一个 /market/skus/ipzone__ip-pos/run（buildRunBody 同构 { input }），
//    99 算力固定价（FIXED_PRICE_SKUS），402/409/502/needsInput 处理照旧；
//  - 结构化 payload 本机找回（换账号丢弃）、Word 导出免费。
// 与原型的两处刻意差异：单章「重生成」后端无此能力，不做假按钮；日志末行不写死耗时。

import { useEffect, useRef, useState } from "react";
import { apiPath, getAppPath, getAppRoutePath } from "../lib/api.js";
import { useScrollLock } from "../lib/use-scroll-lock.js";
import { readSessionIdentity } from "../lib/session.js";
import { authHeaders, handleStaleSession, readJson } from "./shell.js";
import { IconAuto, IconLead } from "./IconGlyph.js";
import { MallTopbar } from "./MallTopbar.js";
import { chatFlowFor, buildRunBody } from "./chat-flows.js";
import { renderMarkdownHtml } from "./AgentChatPage.js";
import type { IpPosPayload } from "./ip-pos-report.js";
import { employeeAvatarPath } from "./eco-mall-data.js";
import { IP_POS_PRICE, IP_POS_UNIT } from "./sku-model.js";
import sitongAvatar from "../assets/sitong-beauty.png";

/* ================= 原型数据（逐字对齐 ip-pos-workbench-demo-20260924） ================= */

/** 定位简报 8 字段（原型口径；6 问访谈覆盖 8 字段，商业模式/IP目标随答随点亮）。 */
const FIELDS: Array<{ key: string; icon: string; label: string }> = [
  { key: "role", icon: "🧭", label: "角色" },
  { key: "project", icon: "🏷️", label: "项目" },
  { key: "biz", icon: "💰", label: "商业模式" },
  { key: "comp", icon: "⚔️", label: "竞争格局" },
  { key: "user", icon: "🎯", label: "目标用户" },
  { key: "founder", icon: "👤", label: "创始人" },
  { key: "goal", icon: "🏁", label: "IP目标" },
  { key: "status", icon: "📊", label: "现状与投入" }
];

/**
 * `digest` = **该选项专属**的「消化回应」。
 * 2026-09-30（用户实测）：第 1 题有 3 个选项，但整题只写了一份 digest（按「连锁品牌总部」写的），
 * 结果选「本地单店老板」也回「明白了——连锁品牌总部」——答非所问。
 * 多选项题必须逐项写 digest；缺省时才回退整题的 digest。
 */
interface QOpt { t: string; d: string; v: Record<string, string>; rec?: boolean; digest?: string }
interface QFlow {
  fields: string[];
  q: string;
  hint: string;
  /** 兜底承接话术：模型生成失败/超时时用它。不引用用户原话，所以只有「已记下」这类通用表述。 */
  digest: string;
  /**
   * 预设候选答案。**只有「角色」这种与行业无关的结构化题才写死**；
   * 涉及行业/业务的题一律留空 —— 由模型按已填字段实时生成。
   * （2026-09-30：原来每题都写死一份「XX贴膜」示例，用户是别的行业时
   *   ①话术对不上 ②点一下就把别人的案例值并进简报，故清空。）
   */
  opts?: QOpt[];
}

const QFLOW: QFlow[] = [
  { fields: ["role"], q: "先确认一下——你是老板本人，还是代运营？品牌是单店还是连锁？", hint: "先识别你是谁，再匹配输出深度。同一个定位需求，不同角色的输出完全不同。",
    digest: "明白了——<b>连锁品牌总部，老板本人出镜</b>。那我按「招商获客型创始人IP」的深度来给你做全案，不讲单店获客那套。",
    opts: [
      { t: "🏭 连锁品牌总部 · 老板本人", d: "示例：品牌总部做招商获客", v: { role: "连锁品牌（总部/加盟体系 · 招商获客向）" }, rec: true,
        digest: "明白了——<b>连锁品牌总部，老板本人出镜</b>。那我按「招商获客型创始人IP」的深度来给你做全案，不讲单店获客那套。" },
      { t: "🏪 本地单店老板", d: "不讲招商、不讲连锁复制", v: { role: "本地单店（老板本人 · 本地获客向）" },
        digest: "明白了——<b>本地单店，老板本人出镜</b>。那我按「本地获客型创始人IP」来做全案：先解决周边到店与转化，不讲招商、不讲连锁复制那套。" },
      { t: "💼 OPC 代运营", d: "帮客户出可交付方案", v: { role: "OPC 运营（代客户操盘 · 方案交付向）" },
        digest: "明白了——<b>你是代运营（OPC），不是老板本人</b>。那我按「能直接交付给客户」的口径来做：人设按客户方老板来立，结论要能讲给他听，落地由你操盘。" }
    ] },
  { fields: ["project"], q: "先说说你的项目吧——叫什么名字？做什么的？现在做到什么阶段了？", hint: "品牌名 + 一句话业务 + 现在到哪一步，一句话说清就行。",
    digest: "收到 ✅ 已记进右侧简报，咱们接着聊你的钱是怎么赚的。" },
  { fields: ["biz"], q: "那你的钱是怎么赚的？客户为什么付钱——一次性消费、加盟费，还是长期复购？客单价大概什么量级？", hint: "模式决定内容往哪引：招商向要打「项目可信」，零售向要打「到店理由」。",
    digest: "收到 ✅ 已记进右侧简报，咱们接着聊竞品。" },
  { fields: ["comp"], q: "那跟你最较劲的竞争对手是谁？列 1-3 个。关键是——你跟他们比，最不一样的地方是什么？客户凭什么选你、不选他们？", hint: "差异化要有事实支撑，「我们更好」不算。",
    digest: "收到 ✅ 已记进右侧简报，咱们接着聊你的客户。" },
  { fields: ["user"], q: "这个是关键——你的客户长什么样？把你最典型的客户画个像给我：年龄、城市、收入？他们找你之前最痛苦的事是什么？", hint: "能具体到一个真实的人最好，比如上个月成交的那个客户。",
    digest: "收到 ✅ 已记进右侧简报，咱们接着聊你自己。" },
  { fields: ["founder"], q: "现在说说你自己——你的背景、经历、最擅长什么？身上最明显的性格特质？", hint: "背景里「只有你经历过的事」是人设的黄金素材。",
    digest: "收到 ✅ 已记进右侧简报，最后聊聊你的 IP 目标。" },
  { fields: ["goal"], q: "做 IP 你最想拿到什么——获客、招商，还是品牌背书？一年内的具体目标是什么？", hint: "目标决定内容取舍；带个数字最好，比如「今年招商 100 家」。",
    digest: "收到 ✅ 已记进右侧简报，最后一轮聊聊你的现状。" },
  { fields: ["status"], q: "最后一轮——看看你现在的基础。哪个平台有账号、粉丝多少？自己出镜说话自然吗（1-10 分）？一周能投入多少时间？", hint: "这轮决定能力评估的五维打分，卡在哪、从哪起步，都从这里推。",
    digest: "现状收到 ✅ 8 项信息齐了，右边简报你可以过目确认。" }
];

/** 全案 9 件（速览 + 8 章），分区/配色/质量点 gd 全照原型；sectionKey 对应 payload.sections。 */
interface PieceMeta { id: string; no: string; g: string; gt: string; icon: string; title: string; d: string; gd: string; sectionKey?: string }
const PIECES: PieceMeta[] = [
  { id: "p0", no: "⓪", g: "ov", gt: "速览区", icon: "📌", title: "1分钟速览", d: "8 维结论 · 老板先看这张", gd: "速览 8 维齐" },
  { id: "p1", no: "一", g: "pos", gt: "定位区", icon: "🎯", title: "项目定位", d: "一句话定位 + 差异化 + 竞品对比 + 阶段判断", gd: "定位三角校验通过", sectionKey: "positioning" },
  { id: "p2", no: "二", g: "pos", gt: "定位区", icon: "👥", title: "目标用户定位", d: "画像 + JTBD 三层痛点 + 四层漏斗 + 决策旅程", gd: "JTBD 三层痛点齐", sectionKey: "user" },
  { id: "p3", no: "三", g: "per", gt: "人设区", icon: "🧑", title: "IP人设定位", d: "五维模型 + 原型 + 语言正反例 + 记忆板块 + 主页四件套", gd: "领路型60%+同行型40%", sectionKey: "ip" },
  { id: "p4", no: "四", g: "con", gt: "内容区", icon: "🗺️", title: "内容定位", d: "内容使命 + 矩阵四象限 + 平台差异化", gd: "信任40/认知30/连接20/转化10", sectionKey: "content" },
  { id: "p5", no: "五", g: "con", gt: "内容区", icon: "🗂️", title: "选题方向", d: "80条选题库 + TOP10 + 30天日历 + 结尾钩子", gd: "80条 · TOP10 · 30天日历", sectionKey: "topics" },
  { id: "p6", no: "六", g: "gro", gt: "增长区", icon: "💸", title: "投流建议", d: "前置判断 + DOU+ 方案 + 预算分配", gd: "前置门槛通过 · DOU+优先", sectionKey: "ads" },
  { id: "p7", no: "七", g: "gro", gt: "增长区", icon: "📈", title: "IP发展规划", d: "能力评估五维打分 + 三阶段路径 + 第一个月提升计划", gd: "能力评估 25/50", sectionKey: "growth" },
  { id: "p8", no: "八", g: "gro", gt: "增长区", icon: "✅", title: "执行建议", d: "关键成功因素 + 风险红线 + 迭代节奏", gd: "30天执行清单", sectionKey: "execution" }
];
const GNAME: Record<string, string> = { ov: "📌 速览区", pos: "🎯 定位区", per: "🧑 人设区", con: "✍️ 内容区", gro: "🚀 增长区" };
const GCOLOR: Record<string, string> = { ov: "#E8651A", pos: "#2563eb", per: "#7c3aed", con: "#0f8a5f", gro: "#b26a00" };
const GSOFT: Record<string, string> = { ov: "#fdeee2", pos: "#e8effd", per: "#f1eafd", con: "#e6f5ee", gro: "#fff4e0" };

/** 生成日志的 Step 细节行（原型 M 表，逐字）。 */
const STEP_LINES: Record<string, string> = {
  p1: "→ Step1 项目定位 · 定位三角自检：去掉品牌名，套不上任何竞品 ✓",
  p2: "→ Step2 目标用户 · JTBD 三层痛点：功能「开店赚钱」× 情感「怕被坑」× 社会「被当成成功老板」",
  p3: "→ Step3 IP人设 · 五维模型 + 原型判定：领路型 × 同行型组合",
  p5: "→ Step5 选题方向 · 选题库 ≥80 条 · 四象限配比 信任40 / 认知30 / 连接20 / 转化10"
};

const OVERVIEW_ROWS: Array<[string, keyof IpPosPayload["overview"]]> = [
  ["项目定位", "project"],
  ["核心用户", "user"],
  ["IP人设", "persona"],
  ["IP原型", "archetype"],
  ["当前IP状态", "ip_status"],
  ["内容重心", "content_focus"],
  ["首选平台", "platform"],
  ["第一个月核心动作", "month_actions"]
];

/* 槽位映射：原型 8 字段 ↔ 后端 6 槽位（商业模式并入项目、IP目标并入创始人——与 /chat 同口径） */
const SLOT_TO_FIELDS: Record<string, string[]> = {
  role: ["role"], project: ["project", "biz"], competition: ["comp"],
  user: ["user"], founder: ["founder", "goal"], stage: ["status"]
};
const FIELD_TO_SLOT: Record<string, string> = {
  role: "role", project: "project", biz: "project", comp: "competition",
  user: "user", founder: "founder", goal: "founder", status: "stage"
};

/** 生成前体检的一条结论（与后端 /precheck 契约一致）。 */
type PrecheckIssue = { slot: string; verdict: "weak" | "missing"; followup: string };
type Phase = "idle" | "ask" | "confirm" | "gen" | "done";
interface ChatMsg { id: number; who: "ai" | "user"; html: string; pending?: boolean; /** 临时消息（如「已恢复对话」提示）：不落草稿——否则每次重进叠一条（2026-09-30 实测）。 */ ephemeral?: boolean }
interface Piece { meta: PieceMeta; bodyHtml: string; plain: string }

const RUN_TIMEOUT_MS = 300_000;
const LOG_DELAY_MS = 700;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/* ---------- 结构化 payload 本机找回（沿用原实现：按会话指纹隔离） ---------- */
function payloadStoreKey(skuId: string): string {
  return `sitong_ippos_payload_${skuId}`;
}
function savePayloadLocally(skuId: string, payload: IpPosPayload): void {
  try {
    const fp = readSessionIdentity();
    if (!fp) return;
    localStorage.setItem(payloadStoreKey(skuId), JSON.stringify({ fp, payload, savedAt: Date.now() }));
  } catch { /* 存储不可用：不影响主流程 */ }
}
function loadPayloadLocally(skuId: string): IpPosPayload | null {
  try {
    const raw = localStorage.getItem(payloadStoreKey(skuId));
    if (!raw) return null;
    const saved = JSON.parse(raw) as { fp?: string; payload?: IpPosPayload };
    if (!saved?.payload || !saved.fp || saved.fp !== readSessionIdentity()) return null;
    return saved.payload;
  } catch { return null; }
}
function buildPayloadMarkdown(p: IpPosPayload): string {
  const ov = OVERVIEW_ROWS.map(([label, key]) => `${label}：${(p.overview?.[key] as string) ?? "—"}`).join("\n");
  const chapters = PIECES.filter((x) => x.sectionKey).map((x) => {
    const body = p.sections?.[x.sectionKey as string]?.trim();
    return body ? `${x.no}、${x.title.replace(/^/, "")}\n${body}` : "";
  }).filter(Boolean);
  return [`${PIECES[0].no} ${PIECES[0].title}`, ov, ...chapters].join("\n\n");
}

/** payload → 交付卡（速览 = overview 表格；章节 = sections Markdown）。 */
function buildPieces(p: IpPosPayload | null, answerMd: string): Piece[] {
  if (p?.overview) {
    const ovHtml = `<table><tr><th style="width:120px">维度</th><th>内容</th></tr>${OVERVIEW_ROWS.map(
      ([label, key]) => `<tr><td>${label}</td><td>${escapeHtml(String(p.overview[key] ?? "—"))}</td></tr>`
    ).join("")}</table>`;
    const ovPlain = OVERVIEW_ROWS.map(([label, key]) => `${label}：${String(p.overview[key] ?? "—")}`).join("\n");
    const out: Piece[] = [{ meta: PIECES[0], bodyHtml: ovHtml, plain: ovPlain }];
    for (const meta of PIECES.slice(1)) {
      const body = (meta.sectionKey && p.sections?.[meta.sectionKey])?.trim() || "";
      out.push({ meta, bodyHtml: body ? renderMarkdownHtml(body) : "<p>—</p>", plain: body });
    }
    return out;
  }
  // 兜底：payload 缺失时从 Markdown 正文按章标题切
  const re = /(?:^|\n)#{0,4}\s*\**\s*(速览|[一二三四五六七八])、\s*([^\n]*)/g;
  const hits: Array<{ key: string; idx: number; end: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(answerMd))) hits.push({ key: m[1], idx: m.index + (m[0].startsWith("\n") ? 1 : 0), end: re.lastIndex });
  if (hits.length === 0) return [];
  const out: Piece[] = [];
  for (let i = 0; i < hits.length; i++) {
    const meta = hits[i].key === "速览" ? PIECES[0] : PIECES.find((x) => x.no === hits[i].key);
    if (!meta) continue;
    const body = answerMd.slice(hits[i].end, i + 1 < hits.length ? hits[i + 1].idx : answerMd.length).trim();
    out.push({ meta, bodyHtml: renderMarkdownHtml(body), plain: body });
  }
  return out;
}

export function IpPosWorkbench({ skuId }: { skuId: string }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [qi, setQi] = useState(0);
  const [brief, setBrief] = useState<Record<string, string>>({});
  /** brief 的同步镜像：异步生成 hints 时要拿「含本题在内」的最新字段（state 闭包会过期）。 */
  const briefRef = useRef<Record<string, string>>({});
  /** 会话轮次：跳过/重置时 +1，让飞行中的生成回调知道自己已过期、放弃推进。 */
  const runIdRef = useRef(0);
  /** 生成进行中：期间自由输入先不接（AI 还没消化完上一句、也没问出下一句，答了会对不上题）。 */
  const digestingRef = useRef(false);
  /** 模型实时生成的下一题候选：点了先放进输入框，用户改完确认才进简报（模型不直接落库）。 */
  /** 生成候选：q = 属于第几题。只有那道题真的问出来（optsQ 就位）才渲染——先问后荐，不许抢跑。 */
  const [genCandidates, setGenCandidates] = useState<{ q: number; list: string[] } | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [optsQ, setOptsQ] = useState<number | null>(null);
  const [confirmOpts, setConfirmOpts] = useState(false);
  const [freeInput, setFreeInput] = useState("");
  const [flashFields, setFlashFields] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  // 生成前体检（不扣算力；slot 精确勾销）
  const [review, setReview] = useState<PrecheckIssue[] | null>(null);
  const [resolved, setResolved] = useState<string[]>([]);
  /** 生成前体检进行中：按钮显示「校验中…」，期间不可重复点击。 */
  const [prechecking, setPrechecking] = useState(false);
  /** 用户明确选择「跳过体检直接生成」后置 true，下一次 startGen 不再跑体检。 */
  const precheckBypassRef = useRef(false);

  // 生成中
  const [logLines, setLogLines] = useState<string[]>([]);
  const [logIdx, setLogIdx] = useState(0);
  const [genIdx, setGenIdx] = useState(-1);
  const [genFinished, setGenFinished] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const runResultRef = useRef<{ payload: IpPosPayload | null; answer: string; consumed: number | null } | null>(null);
  const [runSettled, setRunSettled] = useState(false);
  const [logDone, setLogDone] = useState(false);

  // 交付
  const [pieces, setPieces] = useState<Piece[]>([]);
  const [answerMd, setAnswerMd] = useState("");
  const [consumed, setConsumed] = useState<number | null>(null);
  const [restored, setRestored] = useState(false);
  const [tab, setTab] = useState("all");
  const [exporting, setExporting] = useState(false);

  // 简报编辑弹窗
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const draftRef = useRef<HTMLTextAreaElement | null>(null);

  // 2026-09-29（用户）：编辑弹窗打开后，背景固定、不可滚动。
  useScrollLock(Boolean(editing));

  const msgIdRef = useRef(0);
  const logRef = useRef<HTMLDivElement | null>(null);
  const timersRef = useRef<number[]>([]);
  const avatar = employeeAvatarPath(skuId) ?? sitongAvatar;

  function pushMsg(who: "ai" | "user", html: string, pending = false): number {
    // 同步捕获 id：updater 在批处理/重渲染时才执行，读 ref 会撞号（React key 重复告警的根源）
    const id = ++msgIdRef.current;
    setMessages((prev) => [...prev, { id, who, html, pending }]);
    return id;
  }
  /** 模型生成的消化回应回来后，把「正在消化」占位原地替换成最终话术（一次成型，不做中途换话）。 */
  function replaceMsg(id: number, html: string) {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, html, pending: false } : m)));
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
    document.title = "IP定位工作台 · 思潼AI商城";
    let cancelled = false;
    // 本机找回：上次生成过的结构化全案直接铺进交付区（指纹不符忽略，不串账号）
    const saved = loadPayloadLocally(skuId);
    if (saved) {
      setPayloadView(saved, null, null, true);
    }
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skuId]);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, optsQ, confirmOpts]);

  /*
   * 进页：有草稿就**恢复整个对话**（聊天记录 + 简报 + 进度，2026-09-30 用户要求），
   * 没有才从头开始访谈。restoreDraft 幂等（StrictMode 双跑不产生重复消息）。
   */
  useEffect(() => {
    if (!restoreDraft()) resetAll(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 定时器只在真正卸载时清理（不能放进带依赖的 effect cleanup：StrictMode 会误清引导定时器）
  useEffect(() => () => {
    timersRef.current.forEach((t) => { window.clearTimeout(t); window.clearInterval(t); });
  }, []);

  /** 对话草稿的 localStorage 键：按 skuId 隔离，换智能体不串台本。 */
  const DRAFT_KEY = `ippos_chat_draft_${skuId}`;

  /** 访谈进行中实时落草稿；生成中不落（正式结果另有 payload 本机找回）。 */
  useEffect(() => {
    if (phase === "gen") return;
    // 空对话不落盘：StrictMode 双跑时挂载初期的空 state 会先于恢复生效，
    // 若此时覆盖写，会把刚读到的真草稿清成空、导致下一次启动恢复失败（实测踩中）。
    if (messages.length === 0) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({
        v: 1,
        phase, qi, optsQ, confirmOpts,
        brief,
        // 「正在消化」占位不落盘：恢复时不能出现一条永远转圈的假消息
        messages: messages.filter((m) => !m.pending && !m.ephemeral),
        genCandidates
      }));
    } catch { /* 存储满等异常忽略：草稿是尽力而为 */ }
  }, [DRAFT_KEY, phase, qi, optsQ, confirmOpts, brief, messages, genCandidates]);

  /**
   * 恢复上次对话（2026-09-30 用户：输入到一半关掉页面，下次进来接着聊）。
   * 返回是否恢复成功。幂等：同一次挂载里 StrictMode 双跑结果一致、不重复追加。
   */
  function restoreDraft(): boolean {
    let d: {
      phase?: string; qi?: number; optsQ?: number | null; confirmOpts?: boolean;
      brief?: Record<string, string>;
      messages?: ChatMsg[];
      genCandidates?: { q: number; list: string[] } | null;
    } | null = null;
    try {
      const raw = localStorage.getItem(`ippos_chat_draft_${skuId}`);
      if (raw) d = JSON.parse(raw);
    } catch { d = null; }
    if (!d || !Array.isArray(d.messages)) return false;
    const msgs = d.messages.filter((m): m is ChatMsg => Boolean(m) && typeof m.id === "number" && typeof m.who === "string" && !m.pending);
    if (msgs.length === 0) return false;
    const maxId = msgs.reduce((acc, m) => Math.max(acc, m.id), 0);
    const brief0 = d.brief ?? {};
    // 「done」不恢复成交付态（交付物另有 payload 找回），落到确认态让用户改简报重生成
    const wasGen = d.phase === "gen" || d.phase === "done";
    const qi0 = Math.min(Math.max(0, Number(d.qi) || 0), QFLOW.length - 1);
    msgIdRef.current = maxId + 1;
    setMessages([...msgs, { id: maxId + 1, who: "ai", html: "↩️ 已恢复上次的对话，接着答就行；右侧简报也原样保留。", ephemeral: true }]);
    setBrief(brief0); briefRef.current = brief0;
    setQi(qi0);
    if (!wasGen && d.phase === "ask") {
      setPhase("ask");
      setOptsQ(Math.min(Math.max(0, Number(d.optsQ) || qi0), QFLOW.length - 1));
    } else {
      setPhase("confirm"); setConfirmOpts(true); setOptsQ(null);
    }
    if (d.genCandidates && d.genCandidates.q === qi0 && Array.isArray(d.genCandidates.list)) {
      setGenCandidates(d.genCandidates);
    }
    return true;
  }

  function setPayloadView(p: IpPosPayload | null, answer: string | null, consumed0: number | null, isRestored: boolean) {
    setPieces(buildPieces(p, answer ?? ""));
    setAnswerMd(answer ?? (p ? buildPayloadMarkdown(p) : ""));
    if (consumed0 != null) setConsumed(consumed0);
    setRestored(isRestored);
    if (!isRestored) setPhase("done");
  }

  /* ---------- 访谈流（逐字对齐原型话术） ---------- */

  function resetAll(greet: boolean) {
    timersRef.current.forEach((t) => { window.clearTimeout(t); window.clearInterval(t); });
    timersRef.current = [];
    setPhase("idle"); setQi(0); setBrief({}); briefRef.current = {}; setGenCandidates(null); runIdRef.current += 1;
    setMessages([]); setOptsQ(null); setConfirmOpts(false); setFreeInput("");
    setError(null); setReview(null); setResolved([]);
    setLogLines([]); setLogIdx(0); setGenIdx(-1); setGenFinished(false);
    setRunSettled(false); setLogDone(false); runResultRef.current = null;
    setPieces([]); setAnswerMd(""); setConsumed(null); setRestored(false); setTab("all");
    // 用户主动重置 = 丢弃对话草稿，下次从头开始
    try { localStorage.removeItem(`ippos_chat_draft_${skuId}`); } catch { /* ignore */ }
    if (greet) {
      pushMsg("ai", `你好，我是<b>沈定</b>，首席定位官 🎯<br>IP 定位我不给你拍脑袋——先用 <b>6 步访谈</b>把信息收齐：<b>一次只问一个维度</b>，你的回答会自动填进右侧「定位简报」。8 项齐了，我出 <b>速览 + 8 章全案</b>（${IP_POS_PRICE} ${IP_POS_UNIT} / 份）。赶时间点下方「AI 先铺底稿，你来逐条确认」。`);
      later(() => askQuestion(0), 600);
    }
  }

  function askQuestion(index: number) {
    setPhase("ask"); setQi(index); setOptsQ(index);
    const q = QFLOW[index];
    pushMsg("ai", `<b>${q.q}</b><br><span class="q-hint">${q.hint || ""}</span>`);
  }

  function applyAnswer(q: QFlow, valueMap: Record<string, string>, displayText: string, digest: string) {
    setOptsQ(null);
    pushMsg("user", escapeHtml(displayText));
    const merged = { ...briefRef.current, ...valueMap };
    briefRef.current = merged;
    setBrief(merged);
    flash(q.fields);
    // 先放「正在消化」动画占位；**等消化成型后再问下一题**——对话原则：上一句没说完，不冒下一句。
    // 模型超时（9s）→ 落兜底话术并推进，不让用户对着三个点干等。
    const fallbackId = pushMsg("ai", '<span class="cpw-thinking"><i></i><i></i><i></i></span>', true);
    setGenCandidates(null);
    const nqi = qi + 1;
    setQi(nqi);
    const next = nqi < QFLOW.length ? { fields: QFLOW[nqi].fields, q: QFLOW[nqi].q, hint: QFLOW[nqi].hint } : null;
    const runId = runIdRef.current;
    digestingRef.current = true;
    void loadGenHints(merged, q.fields[0] ?? "", displayText, next, fallbackId, digest, nqi, runId);
  }

  /**
   * 调后端生成「贴合承接 + 下一题候选」。
   * 生成完成（成功或失败）后**才推进下一题**；用户中途跳过/重置（runId 变化）则放弃推进。
   */
  async function loadGenHints(
    answered: Record<string, string>,
    answeredField: string,
    answeredText: string,
    next: { fields: string[]; q: string; hint: string } | null,
    fallbackMsgId: number,
    fallbackText: string,
    nqi: number,
    runId: number
  ) {
    try {
      const res = await fetch(apiPath("/market/ip-pos/interview-hints"), {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify({ answered, answeredField, answeredText, next }),
        // 9 秒拿不到就放弃：落兜底话术照常推进，不让用户对着三个点干等。
        signal: AbortSignal.timeout(9000)
      });
      if (!res.ok) { replaceMsg(fallbackMsgId, escapeHtml(fallbackText)); advanceAfterDigest(nqi, runId); return; }
      const data = (await res.json()) as { digest?: string | null; candidates?: string[] };
      // 生成成功 → 成型；生成失败/为空 → 落回兜底话术。两种都是「一次成型」，无中途换话。
      replaceMsg(fallbackMsgId, escapeHtml(data.digest || fallbackText));
      if (Array.isArray(data.candidates) && data.candidates.length > 0) setGenCandidates({ q: nqi, list: data.candidates });
      advanceAfterDigest(nqi, runId);
    } catch {
      replaceMsg(fallbackMsgId, escapeHtml(fallbackText));
      advanceAfterDigest(nqi, runId);
    }
  }

  /** 消化成型后停顿片刻再问下一题；期间用户跳过/重置（runId 变了）则放弃推进。 */
  function advanceAfterDigest(nqi: number, runId: number) {
    digestingRef.current = false;
    if (runIdRef.current !== runId) return;
    later(() => {
      if (runIdRef.current !== runId) return;
      if (nqi < QFLOW.length) askQuestion(nqi);
      else enterConfirm();
    }, 600);
  }

  function chooseOpt(q: QFlow, o: QOpt) {
    if (phase !== "ask") return;
    // 优先用选项自己的消化回应（多选项题必须逐项写），没有才回退整题那份。
    applyAnswer(q, o.v, o.t, o.digest ?? q.digest);
  }

  /** 自由输入：提问中 = 回答当前维度（多字段问题并入首字段）；确认后 = 追加说明。 */
  function freeSend() {
    const v = freeInput.trim();
    if (!v) return;
    // 上一句还在消化（模型生成中）：AI 还没问出下一题，这时候答进去会对不上题，先不接。
    if (digestingRef.current) return;
    setFreeInput("");
    if (phase === "ask") {
      const q = QFLOW[qi];
      const vm: Record<string, string> = {};
      q.fields.forEach((f, idx) => {
        vm[f] = idx === 0 ? v : `（含于「${FIELDS.find((x) => x.key === q.fields[0])?.label ?? ""}」）`;
      });
      applyAnswer(q, vm, v, "收到 ✅ 已填进右侧简报，咱们继续。");
    } else if (phase === "confirm") {
      pushMsg("user", escapeHtml(v));
      setBrief((prev) => ({ ...prev, status: [prev.status, v].filter(Boolean).join("；") }));
      pushMsg("ai", "已记录 ✅ 这条会一并写进需求单，点「✓ 确认，开始生成」生效。");
    } else {
      pushMsg("user", escapeHtml(v));
      pushMsg("ai", "已记录。等这一稿交付后再告诉我，改完可整包重跑。");
    }
  }

  /**
   * 赶时间：跳过访谈，直接进确认态，8 个字段留空、由用户自己在右侧简报里填。
   *
   * 2026-09-30 改：此前这里把每题写死的「XX贴膜」示例值铺进简报——用户若不是手机贴膜行业，
   * 等于把**别人的生意数据**当成自己的填进去，后面整份全案都会跑偏。宁可不填，也不填错的。
   * （等接入模型生成底稿后，这里可以改回「按你的角色铺一份底稿」。）
   */
  function skipGuide() {
    if (phase === "gen" || phase === "done") return;
    timersRef.current.forEach((t) => { window.clearTimeout(t); window.clearInterval(t); });
    timersRef.current = [];
    setMessages([]); setOptsQ(null); setConfirmOpts(false);
    setBrief({}); briefRef.current = {}; setGenCandidates(null);
    runIdRef.current += 1;
    setQi(QFLOW.length);
    setPhase("confirm"); setConfirmOpts(true);
    pushMsg("ai", "好，老手通道 🚀 按同类项目先铺了 <b>8 项预填底稿</b>（右侧可逐条点击修改）。确认没问题就点 <b>「✓ 确认，开始生成」</b>。");
  }

  function enterConfirm() {
    setPhase("confirm"); setConfirmOpts(true);
    pushMsg("ai", `8 项信息齐了 ✅ 右侧「定位简报」你过目——<b>没问题就生成</b>：速览 + 8 章全案，一次 <b>${IP_POS_PRICE} ${IP_POS_UNIT}</b>。哪条不对，直接点字段改。`);
  }

  function dismissConfirmOpts() {
    setConfirmOpts(false);
  }

  /* ---------- 生成（体检 → /run，后端与原对话页同源） ---------- */

  function briefToSlotAnswers(): Record<string, string> {
    return {
      role: (brief.role ?? "").trim(),
      project: [(brief.project ?? "").trim(), (brief.biz ?? "").trim() && `商业模式：${(brief.biz ?? "").trim()}`].filter(Boolean).join("；"),
      competition: (brief.comp ?? "").trim(),
      user: (brief.user ?? "").trim(),
      founder: [(brief.founder ?? "").trim(), (brief.goal ?? "").trim() && `IP目标：${(brief.goal ?? "").trim()}`].filter(Boolean).join("；"),
      stage: (brief.status ?? "").trim()
    };
  }

  async function startGen() {
    if (phase !== "confirm" || prechecking) return;
    const missing = FIELDS.filter((f) => !(brief[f.key] ?? "").trim()).length;
    if (missing > 0) {
      // 按钮不再 disabled——点了必须有反馈，指明缺哪些，而不是无声无息。
      const missNames = FIELDS.filter((f) => !(brief[f.key] ?? "").trim()).map((f) => f.label).join("、");
      setError(`简报还有 ${missing} 项没填：${missNames}。点右侧简报字段补全后再生成。`);
      return;
    }
    setError(null);

    // 第一关：生成前体检（轻模型、不扣算力）。
    // 2026-09-30（用户）：体检只是「建议」，不许拦人——发现问题给出「补强」和「直接生成」两条路，
    // 用户说没问题就直接放行；第二次点击（bypass）不再重复体检。
    if (!precheckBypassRef.current) {
      setPrechecking(true);
      let issues: PrecheckIssue[] = [];
      try {
        const res = await fetch(apiPath(`/market/skus/${encodeURIComponent(skuId)}/precheck`), {
          method: "POST",
          headers: authHeaders(true),
          body: JSON.stringify({ answers: briefToSlotAnswers() })
        });
        if (handleStaleSession(res.status)) {
          throw new Error("登录已过期，本地登录信息已清除。请点右上角「未登录 · 点击登录」重新登录；本次不消耗算力。");
        }
        if (res.ok) {
          const data = await readJson<{ issues?: PrecheckIssue[] }>(res);
          issues = (data.issues ?? []).filter((item) => item && item.slot && item.followup);
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : "";
        if (message.includes("登录已过期")) { setPrechecking(false); setError(message); return; }
        // 其余预审异常：放行，不挡生成主链路
      }
      setPrechecking(false);
      if (issues.length > 0) {
        setReview(issues);
        setResolved([]);
        pushMsg(
          "ai",
          `体检看了下，有 <b>${issues.length} 项</b>回答再补强一点，全案会更准（清单在右侧）。`
          + `不过材料够不够你说了算——想补就照右侧提示改，改完再点生成；`
          + `认为没问题就点 <b>「跳过体检，直接生成」</b>，马上开做。`
        );
        return;
      }
    }
    precheckBypassRef.current = false;
    setReview(null);
    setResolved([]);
    setConfirmOpts(false);
    setPhase("gen");
    setElapsed(0);
    setGenIdx(-1); setGenFinished(false);
    setRunSettled(false); setLogDone(false); runResultRef.current = null;
    setPieces([]); setRestored(false);

    // 日志脚本（原型同款顺序）。末行 ✅ **由后端真实返回触发揭晓**：
    // 定时器走到最后一件 ✓ 就停住——结果没回来前，日志不出「生成完成」、进度条封顶 <100%。
    const ordered: string[] = [
      `→ 读取定位简报（8/8 字段齐全）· 角色深度：${brief.role || "—"}`,
      "→ 加载定位方法论 · 五步定位法 · 固定输出结构（速览 + 8 章）"
    ];
    for (const p of PIECES) {
      if (STEP_LINES[p.id]) ordered.push(STEP_LINES[p.id]);
      ordered.push(`✓ ${p.no} ${p.title} —— ${p.gd}`);
    }
    setLogLines([...ordered, "✅ 全案 9 件生成完成 · 已写入交付区"]);

    let li = 0;
    const step = () => {
      li += 1;
      setLogIdx(li);
      const t = ordered[li - 1] ?? "";
      if (t.startsWith("✓")) setGenIdx((g) => g + 1);
      if (li < ordered.length) later(step, t.startsWith("✓") ? 650 : 750);
      // 走完停在最后一件 ✓；✅ 行见下方揭晓 effect
    };
    later(step, 300);
    const tick = window.setInterval(() => setElapsed((e) => e + 1), 1000);
    timersRef.current.push(tick);

    try {
      const flow = chatFlowFor("ip-pos");
      if (!flow) throw new Error("未找到 IP 定位技能流程配置。");
      const res = await fetch(apiPath(`/market/skus/${encodeURIComponent(skuId)}/run`), {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify(buildRunBody("ip-pos", flow, briefToSlotAnswers()))
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
      if (res.status === 409) {
        const payload = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
        throw new Error(payload.message ?? "本次请求被拒绝；本次不消耗算力。");
      }
      if (res.status === 502 || res.status === 503 || res.status === 504) {
        throw new Error(
          `生成还没跑完，网关的等待上限先到了（HTTP ${res.status}）。这一稿在后台通常还在继续：` +
          "生成成功会正常计费并留存 7 天，稍后重新回到本页面（同一浏览器）会自动找回，不必急着重做。"
        );
      }
      const result = await readJson<{
        answer: string;
        consumedCredits: number;
        needsInput?: boolean;
        payload?: IpPosPayload;
      }>(res);
      if (result.needsInput) {
        const question = (result.answer ?? "").trim();
        throw new Error(
          (question ? `沈定还想确认一下：${question} ` : "还需要补充一些关键信息。") +
          "请对照左侧简报补充后重新生成（本次不消耗算力）。"
        );
      }
      const payload = result.payload && "overview" in result.payload ? result.payload : null;
      if (payload) savePayloadLocally(skuId, payload);
      runResultRef.current = {
        payload,
        answer: result.answer ?? "",
        consumed: typeof result.consumedCredits === "number" ? result.consumedCredits : null
      };
      setRunSettled(true);
    } catch (e) {
      window.clearInterval(tick);
      setError(e instanceof Error ? e.message : "生成失败，请稍后重试。");
      setPhase("confirm"); setConfirmOpts(true);
      pushMsg("ai", "这一稿没有生成成功（<b>本次不消耗算力</b>）。按提示补充或稍后再点「✓ 确认，开始生成」。");
    }
  }

  /** 日志末行（✅ 生成完成）由后端真实返回触发揭晓——结果没回来前日志停在某件 ✓、进度条封顶 <100%。 */
  useEffect(() => {
    if (phase !== "gen" || !runSettled || logDone || logLines.length === 0) return;
    if (logIdx >= logLines.length - 1) {
      setGenFinished(true);
      setLogIdx(logLines.length);
      setLogDone(true);
    }
  }, [phase, runSettled, logDone, logIdx, logLines]);

  /** 交付门槛：后端结果返回 && 日志走完（含 ✅ 行），不提前展示结果。 */
  useEffect(() => {
    if (phase !== "gen" || !runSettled || !logDone) return;
    const result = runResultRef.current;
    if (!result) return;
    setConsumed(result.consumed);
    setAnswerMd(result.answer || (result.payload ? buildPayloadMarkdown(result.payload) : ""));
    setPieces(buildPieces(result.payload, result.answer));
    setPhase("done");
    pushMsg("ai", `交付完成 ✅ <b>定位全案 9 件</b>已按 5 个分区放在右侧——速览先看，定位 / 人设 / 内容 / 增长按需取用。每章可<b>单独复制</b>、可导出 Word；改简报可整包重跑。本次消耗 <b>${result.consumed ?? IP_POS_PRICE} ${IP_POS_UNIT}</b>。`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runSettled, logDone, phase]);

  /* ---------- 简报编辑（点字段改；体检追问按 slot 精确勾销） ---------- */

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
    const slot = FIELD_TO_SLOT[key];
    if (slot && v && review?.some((issue) => issue.slot === slot)) {
      setResolved((prev) => (prev.includes(slot) ? prev : [...prev, slot]));
    }
    if (phase === "done") { setPhase("confirm"); setConfirmOpts(true); setPieces([]); setRestored(false); }
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
        body: JSON.stringify({ title: "IP定位全案 · 思潼AI", content: answerMd })
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
      a.download = created.filename || "IP定位全案.docx";
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
  const pendingReview = (review ?? []).filter((issue) => !resolved.includes(issue.slot));
  const statusText =
    phase === "gen" ? "生成中 · 流式推导" :
    phase === "done" ? "交付完成 · 9/9 件" :
    phase === "confirm" ? `访谈完成 · 简报 ${filled}/8` :
    phase === "ask" ? `引导中（${filled}/8）` : "待引导";
  const feeHint =
    phase === "done" ? <>本次实际消耗 <b>{consumed ?? IP_POS_PRICE} {IP_POS_UNIT}</b></> :
    phase === "confirm" ? <>本次交付：<b>定位全案 9 件（速览 + 8 章）· {IP_POS_PRICE} {IP_POS_UNIT}</b></> :
    <>完成 6 步访谈后可生成 · 全案（速览 + 8 章）{IP_POS_PRICE} {IP_POS_UNIT} /份</>;
  const showDl = (phase === "done" || (restored && pieces.length > 0)) && phase !== "gen";
  const gpTotal = logLines.length || 1;
  const gpPct = Math.round(Math.min(logIdx, gpTotal) / gpTotal * 100);
  const groups = [...new Set(pieces.map((p) => p.meta.g))];
  const shownPieces = tab === "all" ? pieces : pieces.filter((p) => p.meta.g === tab);

  return (
    <main className="cpw-page">
      <MallTopbar back={`/agent/${encodeURIComponent(skuId)}/detail`} badge="IP定位智能体 · 定位工作台" />

      <header className="cpw-hero">
        <div className="cpw-wrap">
          <div className="cpw-chips">
            <span className="cpw-chip dev">沈定 · 首席定位官</span>
            <span className="cpw-chip">定位工作台</span>
          </div>
          <h1><img className="cpw-emoji" src={avatar} alt="沈定" />IP定位工作台</h1>
          <p className="cpw-hook">左边沈定 6 步访谈带你走，右边定位简报 8 字段和全案 9 件实时长出来。</p>
          <p className="cpw-ability">6 步访谈 → 定位简报 → 速览 + 8 章全案分区交付：单章复制、一键导出 Word（免费），{IP_POS_PRICE} {IP_POS_UNIT}/份，一次看清。老手可直接改简报或点「AI 先铺底稿」。</p>
        </div>
      </header>

      <section className="cpw-demo">
        <div className="cpw-wrap">
          <div className="cpw-sec-head"><h2>▶ <span className="cpw-k">工作台</span></h2><span className="cpw-desc">左：6 步访谈｜右：定位简报 + 全案 9 件</span></div>
          <div className="cpw-stage">
            <div className="cpw-bar">
              <span className="cpw-dot r" /><span className="cpw-dot y" /><span className="cpw-dot g" />
              <span className="cpw-url">思潼AI · IP定位工作台</span>
              <span className="cpw-st"><span className={`cpw-st-dot ${phase === "gen" ? "playing" : phase === "done" ? "done" : ""}`} /><span>{statusText}</span></span>
              <div className="cpw-ctrls">
                <button className="cpw-sbtn" onClick={() => resetAll(true)}>↻ 重置</button>
              </div>
            </div>
            <div className="cpw-body">
              {/* 左：引导对话 */}
              <div className="cpw-chat">
                <div className="cpw-chat-head">
                  <div className="cpw-av"><img src={avatar} alt="沈定" /></div>
                  <div><b>沈定 · 创作引导</b><span>一次只问一个维度 · 回答自动填入右侧简报</span></div>
                </div>
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
                  {confirmOpts && phase === "confirm" && (
                    <div className="cpw-opts">
                      <button className="cpw-opt go" onClick={() => { dismissConfirmOpts(); void startGen(); }}>
                        ✓ 确认，开始生成<small>速览 + 8 章 · {IP_POS_PRICE} {IP_POS_UNIT} · 线上流式约 50 秒</small>
                      </button>
                      <button className="cpw-opt" onClick={() => { dismissConfirmOpts(); pushMsg("ai", "直接点击右侧简报里的字段修改，改完点「✨ 生成定位全案」。"); }}>
                        ✎ 改一下再生成<small>点击右侧简报字段直接修改</small>
                      </button>
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
                <div className="cpw-skip">赶时间？<a onClick={skipGuide}>跳过访谈，直接在右侧简报填写 8 项 →</a></div>
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
                      <b>📋 定位简报</b>
                      <span className="cpw-brief-sub">8 个字段 · 可随时点击修改，改完重新生成</span>
                      <div className="cpw-meter"><span>{filled}/8</span><div className="cpw-segs">{FIELDS.map((f, i) => <div key={f.key} className={`cpw-seg${i < filled ? " on" : ""}`} />)}</div></div>
                    </div>
                    <div className="cpw-grid">
                      {FIELDS.map((f) => {
                        const v = (brief[f.key] ?? "").trim();
                        return (
                          <div key={f.key} className={`cpw-bf${v ? " filled" : ""}${flashFields.includes(f.key) ? " flash" : ""}`} title={v ? "点击修改" : "等待左侧引导填入"} onClick={() => editField(f.key)}>
                            <div className="cpw-bf-k"><IconAuto v={f.icon} /> {f.label}{v ? "" : " · 待填"}</div>
                            <div className="cpw-bf-v">{v || "——"}</div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="cpw-ops">
                      {phase === "confirm" && (
                        <button
                          className={`cpw-big-btn gen${prechecking ? " busy" : ""}`}
                          disabled={prechecking}
                          onClick={() => { dismissConfirmOpts(); void startGen(); }}
                        >
                          {prechecking ? <><span className="cpw-btn-spin" /> 🔍 生成前校验中…</> : <><IconAuto v="✨" /> 生成定位全案</>}
                        </button>
                      )}
                      {phase === "done" && (
                        <button className="cpw-big-btn ghost" onClick={() => { setPhase("confirm"); setConfirmOpts(true); setPieces([]); setRestored(false); setConsumed(null); }}>↻ 改简报重新生成</button>
                      )}
                      <span className="cpw-fee">{feeHint}</span>
                      <span className="cpw-safe-tag"><IconAuto v="🛡" /> 失败不扣费</span>
                    </div>
                    {review && review.length > 0 && phase !== "gen" && (
                      <div className="cpw-review" role="alert">
                        <div className="ir-t">
                          {pendingReview.length > 0
                            ? `🔍 生成前体检 · ${pendingReview.length} 项可以补强（不强制）`
                            : `✅ 生成前体检 · ${review.length} 项已按提示补充，再点一次「✓ 确认，开始生成」`}
                        </div>
                        {review.map((issue) => {
                          const fields = SLOT_TO_FIELDS[issue.slot] ?? [issue.slot];
                          const done0 = resolved.includes(issue.slot);
                          return (
                            <div className="cpw-ir" key={issue.slot}>
                              <span className={`cpw-ir-badge ${issue.verdict === "missing" ? "missing" : "weak"}`}>{issue.verdict === "missing" ? "缺失" : "太薄"}</span>
                              <div className="cpw-ir-main">
                                <b>{fields.map((fk, i) => { const meta = FIELDS.find((x) => x.key === fk); return (<span key={`${fk}-${i}`}>{i > 0 ? " / " : ""}{meta ? <><IconAuto v={meta.icon} /> {meta.label}</> : fk}</span>); })}</b>
                                <span>{issue.followup}</span>
                              </div>
                              {done0 && <span className="cpw-ir-done">✓ 已补充</span>}
                            </div>
                          );
                        })}
                        {pendingReview.length > 0 && (
                          /* 2026-09-30（用户）：跳过入口原来是右上角小字，太隐蔽——
                             升级为卡底醒目双按钮：补强 or 直接生成，两条路都一眼可见。 */
                          <div className="cpw-review-ops">
                            <button className="cpw-opt go" onClick={() => { precheckBypassRef.current = true; dismissConfirmOpts(); void startGen(); }}>
                              🚀 跳过体检，直接生成<small>材料够不够你说了算 · 体检不扣算力</small>
                            </button>
                            <button className="cpw-opt" onClick={() => { setConfirmOpts(false); pushMsg("ai", "好，按上面清单逐条补充：点右侧简报里对应的字段改，改完再点「✨ 生成定位全案」，我会重新体检。"); }}>
                              ✎ 按提示补充<small>补完更准 · 改完重新生成</small>
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                    {error && <div className="cpw-err">{error}</div>}
                  </div>

                  <div className="cpw-canvas">
                    {showDl ? (
                      <div className="cpw-dl">
                        <div className="cpw-dl-head">
                          <span className="cpw-ok-tag">✓ 已交付</span>
                          <span className="cpw-time">{pieces.length || 9} 件{restored ? " · 本机找回" : ""} · 消耗 {consumed ?? IP_POS_PRICE} {IP_POS_UNIT}</span>
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
                                <button key={g} className={`cpw-tab${tab === g ? " act" : ""}`} onClick={() => setTab(g)}>{GNAME[g]} {pieces.filter((p) => p.meta.g === g).length}</button>
                              ))}
                            </div>
                            <div className="cpw-pieces">
                              {shownPieces.map((p) => (
                                <div className="cpw-pc" key={p.meta.id}>
                                  <div className="cpw-pc-h">
                                    <span className="cpw-pc-no" style={{ background: GCOLOR[p.meta.g] }}>{p.meta.no}</span>
                                    <b><IconAuto v={p.meta.icon} /> {p.meta.title}</b>
                                    <span className="cpw-g-tag" style={{ color: GCOLOR[p.meta.g], background: GSOFT[p.meta.g] }}>{p.meta.gt}</span>
                                    <div className="cpw-pc-btns">
                                      <button className="cpw-cbtn" onClick={() => copyText(`${p.meta.no}、${p.meta.title}\n\n${p.plain}`)}>⧉ 复制本件</button>
                                    </div>
                                  </div>
                                  <div className="cpw-pc-c" dangerouslySetInnerHTML={{ __html: p.bodyHtml }} />
                                </div>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    ) : (
                      <>
                        <div className="cpw-ph-note">
                          {phase === "gen" ? <>⏳ 生成中 · 9 件逐张点亮 · 已等待 {elapsed} 秒</> :
                           phase === "confirm" ? <>✓ 简报 {filled}/8 齐全 · 点「✓ 确认，开始生成」或右侧按钮</> :
                           <>👋 完成左侧 6 步访谈后，全案会在这里分区生成</>}
                          {phase !== "gen" && <><span className="cpw-tag">8 字段齐</span><span className="cpw-tag">速览 + 8 章</span><span className="cpw-tag">{IP_POS_PRICE} {IP_POS_UNIT}</span></>}
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
                              <div key={i} className={`cpw-ln ${ln.startsWith("✅") ? "hl" : ln.startsWith("✓") ? "ok" : ""}`}>{ln}</div>
                            ))}
                          </div>
                        )}
                        <div className="cpw-ph-grid">
                          {PIECES.map((p, i) => {
                            let cls = "cpw-ph locked";
                            if (phase === "confirm") cls = "cpw-ph ready";
                            else if (phase === "gen") cls = genFinished || i < genIdx ? "cpw-ph done" : i === genIdx ? "cpw-ph gening" : "cpw-ph locked";
                            return (
                              <div key={p.id} className={cls}>
                                {phase === "gen" && i === genIdx && !genFinished && <span className="cpw-spin" />}
                                <div className="cpw-no" style={{ color: GCOLOR[p.g], background: GSOFT[p.g] }}>{p.no} · {p.gt}</div>
                                <b><IconAuto v={p.icon} /> {p.title}</b>
                                <span className="cpw-d">{p.d}</span>
                              </div>
                            );
                          })}
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
            <textarea ref={draftRef} value={draft} onChange={(e) => setDraft(e.target.value)} rows={4} placeholder="输入内容，留空保存 = 清空该字段" />
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

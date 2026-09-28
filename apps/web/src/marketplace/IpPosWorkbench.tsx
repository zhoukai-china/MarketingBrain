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
import { readSessionIdentity } from "../lib/session.js";
import { authHeaders, handleStaleSession, readJson } from "./shell.js";
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

interface QOpt { t: string; d: string; v: Record<string, string>; rec?: boolean }
interface QFlow { fields: string[]; q: string; hint: string; digest: string; opts: QOpt[] }

const QFLOW: QFlow[] = [
  { fields: ["role"], q: "先确认一下——你是老板本人，还是代运营？品牌是单店还是连锁？", hint: "先识别你是谁，再匹配输出深度。同一个定位需求，不同角色的输出完全不同。",
    digest: "明白了——<b>连锁品牌总部，老板本人出镜</b>。那我按「招商获客型创始人IP」的深度来给你做全案，不讲单店获客那套。",
    opts: [
      { t: "🏭 连锁品牌总部 · 老板本人", d: "演示示例：品牌总部做招商获客", v: { role: "连锁品牌（总部/加盟体系 · 招商获客向）" }, rec: true },
      { t: "🏪 本地单店老板", d: "不讲招商、不讲连锁复制", v: { role: "本地单店（老板本人 · 本地获客向）" } },
      { t: "💼 OPC 代运营", d: "帮客户出可交付方案", v: { role: "OPC 运营（代客户操盘 · 方案交付向）" } }
    ] },
  { fields: ["project", "biz"], q: "先说说你的项目吧——叫什么名字？做什么的？赚谁的钱、怎么赚？现在做到什么阶段了？", hint: "一句话能说清就行；答得好时，项目和商业模式两个字段会一起点亮。",
    digest: "收到——<b>「XX贴膜」，手机后市场连锁加盟，供应链驱动，几百家门店</b>。模型已经跑通，现在是 1-10 增长期，这个判断后面全案会用到。",
    opts: [
      { t: "XX贴膜：手机后市场连锁加盟，以贴膜为入口做全链条；赚想小成本创业的加盟商的钱；已有几百家门店", d: "演示示例：点一次，项目+商业模式两个字段同时点亮", v: { project: "XX贴膜 · 手机后市场连锁加盟", biz: "加盟连锁：供应链驱动，以贴膜为入口做手机全链条生意" }, rec: true }
    ] },
  { fields: ["comp"], q: "那跟你最较劲的竞争对手是谁？列 1-3 个。关键是——你跟他们比，最不一样的地方是什么？客户凭什么选你、不选他们？", hint: "差异化要有事实支撑，「我们更好」不算。",
    digest: "竞品锁定：<b>平台A、平台B、街边手机店</b>。你的差异我记下了——<b>自有供应链 + 开的是自己的店</b>，这条会进定位三角校验。",
    opts: [
      { t: "平台A、平台B、街边手机店。我们最不一样：自有3000平供应链，加盟商开的是自己的店", d: "演示示例：3 个竞品 + 有事实的差异化", v: { comp: "平台A / 平台B / 街边手机店；差异=自有3000平供应链，开的是自己的店" }, rec: true }
    ] },
  { fields: ["user"], q: "这个是关键——你的客户长什么样？把你最典型的客户画个像给我：年龄、城市、收入？他们找你之前最痛苦的事是什么？", hint: "能具体到一个真实的人最好，比如上个月成交的那个客户。",
    digest: "用户画像很清晰——<b>30-45 岁想小成本创业的男性，「不知道做什么、怕被坑」</b>。这就是后面 JTBD 三层痛点的原型，内容全部围绕他设计。",
    opts: [
      { t: "30-45岁想小成本创业的男性，预算5-15万；「不知道做什么、怕被坑」；刷抖音搜小本创业", d: "演示示例：画像 + 痛点 + 平台习惯", v: { user: "30-45岁想小成本创业的男性，「不知道做什么、怕被坑」" }, rec: true }
    ] },
  { fields: ["founder", "goal"], q: "现在说说你自己——你的背景、经历、最擅长什么？身上最明显的性格特质？还有，做 IP 的核心目标是获客、招商还是品牌？", hint: "背景里「只有你经历过的事」是人设的黄金素材；答得好，创始人+IP目标两个字段一起点亮。",
    digest: "X总这个背景很好用——<b>10 年供应链老炮，说话直接、不装</b>。目标也明确：<b>IP 驱动招商，奔 1000 家店去</b>。人设不用造，找到真实自我里最能吸引这批用户的那个面就行。",
    opts: [
      { t: "X总，80后，干手机配件供应链10年，3000平仓库；说话直接、不装。核心目标：创始人IP驱动招商，奔1000家店去", d: "演示示例：点一次，创始人+IP目标两个字段同时点亮", v: { founder: "X总，80后，手机配件供应链10年，3000平仓库；说话直接、不装", goal: "创始人IP驱动招商，目标1000家店" }, rec: true }
    ] },
  { fields: ["status"], q: "最后一轮——看看你现在的基础。哪个平台有账号、粉丝多少？自己出镜说话自然吗（1-10 分）？一周能投入多少时间？", hint: "这轮决定能力评估的五维打分，卡在哪、从哪起步，都从这里推。",
    digest: "现状收到——<b>1.3w 粉但方向散、客资月均只有 1-2 条；表达自然但不会选题</b>。卡点在内容能力，不在表达。8 项信息齐了，右边简报你可以过目确认。",
    opts: [
      { t: "抖音1.3w粉但方向散，客资月均1-2条；出镜自然(7/10)但不会选题；愿意投入，缺方法", d: "演示示例：账号 + 表达 + 能力 + 投入，一轮收齐", v: { status: "抖音1.3w粉但方向散，客资月均1-2条；表达自然(7/10)，不会选题；愿投入缺方法" }, rec: true }
    ] }
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
interface ChatMsg { id: number; who: "ai" | "user"; html: string }
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
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [optsQ, setOptsQ] = useState<number | null>(null);
  const [confirmOpts, setConfirmOpts] = useState(false);
  const [freeInput, setFreeInput] = useState("");
  const [flashFields, setFlashFields] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  // 生成前体检（不扣算力；slot 精确勾销）
  const [review, setReview] = useState<PrecheckIssue[] | null>(null);
  const [resolved, setResolved] = useState<string[]>([]);

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

  const msgIdRef = useRef(0);
  const logRef = useRef<HTMLDivElement | null>(null);
  const timersRef = useRef<number[]>([]);
  const avatar = employeeAvatarPath(skuId) ?? sitongAvatar;

  function pushMsg(who: "ai" | "user", html: string) {
    // 同步捕获 id：updater 在批处理/重渲染时才执行，读 ref 会撞号（React key 重复告警的根源）
    const id = ++msgIdRef.current;
    setMessages((prev) => [...prev, { id, who, html }]);
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

  // 定时器只在真正卸载时清理（不能放进带依赖的 effect cleanup：StrictMode 会误清引导定时器）
  useEffect(() => () => {
    timersRef.current.forEach((t) => { window.clearTimeout(t); window.clearInterval(t); });
  }, []);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, optsQ, confirmOpts]);

  // 进页即开始访谈；不加 ref 守卫（StrictMode 模拟卸载会清定时器，须重跑收敛）
  useEffect(() => {
    resetAll(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    setPhase("idle"); setQi(0); setBrief({});
    setMessages([]); setOptsQ(null); setConfirmOpts(false); setFreeInput("");
    setError(null); setReview(null); setResolved([]);
    setLogLines([]); setLogIdx(0); setGenIdx(-1); setGenFinished(false);
    setRunSettled(false); setLogDone(false); runResultRef.current = null;
    setPieces([]); setAnswerMd(""); setConsumed(null); setRestored(false); setTab("all");
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
    setBrief((prev) => ({ ...prev, ...valueMap }));
    flash(q.fields);
    pushMsg("ai", digest);
    const nqi = qi + 1;
    setQi(nqi);
    if (nqi < QFLOW.length) later(() => askQuestion(nqi), 800);
    else later(enterConfirm, 500);
  }

  function chooseOpt(q: QFlow, o: QOpt) {
    if (phase !== "ask") return;
    applyAnswer(q, o.v, o.t, q.digest);
  }

  /** 自由输入：提问中 = 回答当前维度（多字段问题并入首字段）；确认后 = 追加说明。 */
  function freeSend() {
    const v = freeInput.trim();
    if (!v) return;
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

  /** 老手快填：按推荐答案铺 8 字段底稿，直接进确认态。 */
  function skipGuide() {
    if (phase === "gen" || phase === "done") return;
    timersRef.current.forEach((t) => { window.clearTimeout(t); window.clearInterval(t); });
    timersRef.current = [];
    setMessages([]); setOptsQ(null); setConfirmOpts(false);
    const pre: Record<string, string> = {};
    for (const q of QFLOW) for (const o of q.opts) if (o.rec) Object.assign(pre, o.v);
    setBrief(pre);
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
    if (phase !== "confirm") return;
    if (FIELDS.filter((f) => (brief[f.key] ?? "").trim()).length < FIELDS.length) {
      setError(`简报还有 ${FIELDS.length - FIELDS.filter((f) => (brief[f.key] ?? "").trim()).length} 项没填，点简报字段补全后再生成。`);
      return;
    }
    setError(null);

    // 第一关：生成前体检（轻模型、不扣算力）。预审不通过 → 追问卡（slot 精确勾销），不进生成。
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
      if (message.includes("登录已过期")) { setError(message); return; }
      // 其余预审异常：放行，不挡生成主链路
    }
    if (issues.length > 0) {
      setReview(issues);
      setResolved([]);
      pushMsg("ai", `先别急——体检发现 <b>${issues.length} 项</b>回答还要补强（见右侧清单）。补完后再次点「✓ 确认，开始生成」（体检不扣算力）。`);
      return;
    }
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
          window.location.href = getAppPath(`/recharge?from=agent&skill=${encodeURIComponent(skuId)}&next=${encodeURIComponent(nextRoute)}`);
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
                      <div className="cpw-bub" dangerouslySetInnerHTML={{ __html: m.html }} />
                    </div>
                  ))}
                  {optsQ != null && phase === "ask" && (
                    <div className="cpw-opts">
                      {QFLOW[optsQ].opts.map((o, i) => (
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
                <div className="cpw-skip">赶时间？<a onClick={skipGuide}>AI 先铺底稿，你来逐条确认 →</a></div>
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
                            <div className="cpw-bf-k">{f.icon} {f.label}{v ? "" : " · 待填"}</div>
                            <div className="cpw-bf-v">{v || "——"}</div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="cpw-ops">
                      {phase !== "gen" && phase !== "done" && (
                        <button className="cpw-big-btn gen" disabled={filled < 8} onClick={() => { dismissConfirmOpts(); void startGen(); }}>✨ 生成定位全案</button>
                      )}
                      {phase === "done" && (
                        <button className="cpw-big-btn ghost" onClick={() => { setPhase("confirm"); setConfirmOpts(true); setPieces([]); setRestored(false); setConsumed(null); }}>↻ 改简报重新生成</button>
                      )}
                      <span className="cpw-fee">{feeHint}</span>
                      <span className="cpw-safe-tag">🛡️ 失败不扣费</span>
                    </div>
                    {review && review.length > 0 && phase !== "gen" && (
                      <div className="cpw-review" role="alert">
                        <div className="ir-t">
                          {pendingReview.length > 0 ? `🔍 生成前体检 · ${pendingReview.length} 项需要补充` : `✅ 生成前体检 · ${review.length} 项已按提示补充，再点一次「✓ 确认，开始生成」`}
                        </div>
                        {review.map((issue) => {
                          const fields = SLOT_TO_FIELDS[issue.slot] ?? [issue.slot];
                          const done0 = resolved.includes(issue.slot);
                          return (
                            <div className="cpw-ir" key={issue.slot}>
                              <span className={`cpw-ir-badge ${issue.verdict === "missing" ? "missing" : "weak"}`}>{issue.verdict === "missing" ? "缺失" : "太薄"}</span>
                              <div className="cpw-ir-main">
                                <b>{fields.map((fk) => { const meta = FIELDS.find((x) => x.key === fk); return meta ? `${meta.icon} ${meta.label}` : fk; }).join(" / ")}</b>
                                <span>{issue.followup}</span>
                              </div>
                              {done0 && <span className="cpw-ir-done">✓ 已补充</span>}
                            </div>
                          );
                        })}
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
                                    <b>{p.meta.icon} {p.meta.title}</b>
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
                                <b>{p.icon} {p.title}</b>
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
            <div className="cpw-modal-t">{FIELDS.find((f) => f.key === editing)?.icon} 修改「{FIELDS.find((f) => f.key === editing)?.label}」</div>
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

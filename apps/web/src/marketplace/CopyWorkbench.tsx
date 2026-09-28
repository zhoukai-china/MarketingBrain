// 文案创作工作台（/agent/ipzone__copy/workbench）
//
// 视觉与交互**严格对齐原型** copy-workbench-demo-20260922.html：
//  - 左：暗色引导对话（一次只问一个问题，6 问固定话术 + 选项 chips，答案自动填右侧简报）；
//  - 右：创作简报（6 字段可点改）+ 画布（占位 / 生成中日志+进度 / 分区 tabs 交付区）。
//
// 「功能与 /chat 一样」指的是**后端**：同一个 `/market/skus/ipzone__copy/run`（计费、
// 十件套契约、needsInput 全同源）。请求体与 chat-flows.buildRunBody 同构（{ input: 需求单文本 }）。
// 后端契约固定输出「一、选题策划 … 十、投流建议」十段 Markdown（copy-ten-contract.ts），
// 交付区按这十段拆卡、按原型分区（策划/文稿/拍摄/发布/投流）分 tab。
//
// 计费口径（不犯 ip-pos 的错）：文案按**实际用量结算**，费用文案用真实目录 ppu 与「积分」，
// 不照抄原型里的演示价（10/15 算力）；「🛡️ 失败不扣费」按原型保留（生成失败确实不扣）。

import { useEffect, useRef, useState } from "react";
import { apiPath, getAppPath, getAppRoutePath } from "../lib/api.js";
import { authHeaders, fetchMarketMe, handleStaleSession, readJson, Topbar } from "./shell.js";
import { renderMarkdownHtml } from "./AgentChatPage.js";
import { employeeAvatarPath } from "./eco-mall-data.js";
import sitongAvatar from "../assets/sitong-beauty.png";

/* ================= 原型数据（逐字对齐 QFLOW / FIELDS / PIECES） ================= */

const FIELDS: Array<{ key: string; icon: string; label: string }> = [
  { key: "product", icon: "📦", label: "产品 / 服务" },
  { key: "selling", icon: "💎", label: "核心卖点" },
  { key: "platform", icon: "📺", label: "投放平台" },
  { key: "action", icon: "🎯", label: "期望动作" },
  { key: "depth", icon: "📋", label: "交付深度" },
  { key: "camera", icon: "🎬", label: "出镜方式" }
];

interface QOpt { t: string; d: string; v: string; rec?: boolean }
interface QFlow { field: string; q: string; hint: string; opts: QOpt[] }

const QFLOW: QFlow[] = [
  { field: "product", q: "这次给什么产品 / 服务写文案？", hint: "名字 + 一句话卖点就行，也可以后面传资料让我自己读。",
    opts: [
      { t: "🐶 宠物门店洗护年卡", d: "演示示例：门店年卡锁客类", v: "宠物门店洗护年卡（全年不限次）", rec: true },
      { t: "🍜 餐饮门店 / 团购", d: "到店 & 团购核销类", v: "（示例）餐饮门店团购套餐" },
      { t: "💆 美业门店服务", d: "护理 / 科技美容类", v: "（示例）美业门店护理服务" }
    ] },
  { field: "selling", q: "它最想让观众记住的一个卖点是什么？", hint: "不用完美，先给一个方向，我写稿时会放大。",
    opts: [
      { t: "全年不限次，一次买断省一半", d: "演示示例：价格锚点 + 锁客", v: "全年洗护不限次，一次买断，单次折算省一半", rec: true },
      { t: "持证美容师，中大型犬也敢接", d: "专业与安全背书", v: "美容师持证上岗，中大型犬也敢接" }
    ] },
  { field: "platform", q: "主要发布到哪个平台？", hint: "多平台也没关系，我会做适配。",
    opts: [
      { t: "抖音 + 视频号", d: "演示示例：双平台同发", v: "抖音 + 视频号", rec: true },
      { t: "仅抖音", d: "", v: "抖音" },
      { t: "仅视频号", d: "", v: "视频号" },
      { t: "小红书", d: "", v: "小红书" }
    ] },
  { field: "action", q: "希望观众看完做什么动作？", hint: "这是文案最后一句的落点，也是钩子设计方向。",
    opts: [
      { t: "评论区留言「洗澡」约体验", d: "演示示例：关键词互动 → 到店转化", v: "引导评论区留言「洗澡」约到店体验", rec: true },
      { t: "关注账号", d: "", v: "关注账号" },
      { t: "私信咨询", d: "", v: "私信咨询" },
      { t: "到店 / 留资", d: "", v: "到店 / 留资" }
    ] },
  { field: "depth", q: "这次要交付到什么深度？", hint: "只要一条能发的文案，还是连拍摄剪辑发布投流一起出完整十件套？",
    opts: [
      { t: "轻量 · 1 条可直发文案", d: "标题 + 正文 + 话题 · 约 3 分钟", v: "light" },
      { t: "完整 · 内容十件套", d: "选题→口播→访谈→拍摄→剪辑→标题→时间→评论→投流 · 约 5-10 分钟", v: "full", rec: true }
    ] },
  { field: "camera", q: "出镜方式是哪种？", hint: "决定拍摄脚本和注意事项怎么写。",
    opts: [
      { t: "老板 / 创始人自己出镜", d: "演示示例：门店老板抱宠出镜", v: "门店老板抱宠出镜", rec: true },
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
interface ChatMsg { id: number; who: "ai" | "user"; html: string }
interface Piece { meta: PieceMeta; body: string }

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
  const [balance, setBalance] = useState<number | null>(null);
  const [skuPpu, setSkuPpu] = useState<number | null>(null);
  // 原型固定话术里的人设称呼（逐字对齐）：金牌文案主笔
  const persona = "金牌文案主笔";
  const avatar = employeeAvatarPath(skuId) ?? sitongAvatar;

  const [phase, setPhase] = useState<Phase>("idle");
  const [qi, setQi] = useState(0);
  const [brief, setBrief] = useState<Record<string, string>>({});
  const [depth, setDepth] = useState<"light" | "full" | null>(null);
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

  const msgIdRef = useRef(0);
  const logRef = useRef<HTMLDivElement | null>(null);
  const timersRef = useRef<number[]>([]);

  function pushMsg(who: "ai" | "user", html: string) {
    // 同步捕获 id：updater 在批处理/重渲染时才执行，读 ref 会撞号（React key 重复告警的根源）
    const id = ++msgIdRef.current;
    setMessages((prev) => [...prev, { id, who, html }]);
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
    void fetchMarketMe<{ creditBalance: number }>()
      .then((data) => { if (!cancelled) setBalance(data ? data.creditBalance : null); })
      .catch(() => { if (!cancelled) setBalance(null); });
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

  // 进页即开始引导（原型经 IntersectionObserver 触发；真实页直接打招呼）。
  // 不加 ref 守卫：StrictMode 模拟卸载会清掉定时器，必须让本 effect 重跑一次才补得回来
  //（resetAll 自身会清空重置，两次调用结果收敛，不会出现重复欢迎语）。
  useEffect(() => {
    resetAll(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- 对话流（逐字对齐原型话术） ---------- */

  function resetAll(greet: boolean) {
    timersRef.current.forEach((t) => window.clearTimeout(t));
    timersRef.current = [];
    setPhase("idle"); setQi(0); setBrief({}); setDepth(null);
    setMessages([]); setOptsQ(null); setSupplement(""); setFreeInput("");
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
    setBrief((prev) => ({ ...prev, [field]: value }));
    if (field === "depth") {
      const d = value === "full" ? "full" : "light";
      setDepth(d);
    }
    const next = QFLOW.findIndex((_, i) => i > qi);
    const nqi = qi + 1;
    setQi(nqi);
    if (nqi < QFLOW.length) {
      later(() => askQuestion(nqi), 500);
    } else {
      later(confirmStep, 400);
    }
  }

  function confirmStep() {
    setPhase("confirm");
    pushMsg("ai", `齐了 ✅ 简报 6/6。右侧确认后点 <b>「✨ 开始创作」</b>，我按 <b>${depth === "light" ? "轻量 1 条文案" : "完整十件套"}</b> 交付。中途可以随时打断我改简报。`);
  }

  /** 选项点击（原型 answer()） */
  function chooseOpt(q: QFlow, o: QOpt) {
    if (phase !== "ask") return;
    applyAnswer(q.field, o.v, escapeHtml(q.field === "depth" ? o.t : (o.v || o.t)));
  }

  /** 自由输入：提问中 = 回答当前问题；确认后 = 补充说明（真实并入需求单） */
  function freeSend() {
    const v = freeInput.trim();
    if (!v) return;
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

  /** 老手快填：按同类项目铺 6 条推荐底稿，直接进确认态（可在右侧改） */
  function skipGuide() {
    if (phase === "gen" || phase === "done") return;
    timersRef.current.forEach((t) => window.clearTimeout(t));
    timersRef.current = [];
    setMessages([]); setOptsQ(null); setSupplement("");
    const pre: Record<string, string> = {};
    for (const q of QFLOW) pre[q.field] = (q.opts.find((o) => o.rec) ?? q.opts[0]).v;
    setBrief(pre);
    setDepth("full");
    setPhase("confirm"); setQi(QFLOW.length);
    pushMsg("ai", "好，老手通道 🚀 按同类项目先铺了 <b>6 条预填底稿</b>（右侧可逐条点击修改）。确认没问题就点 <b>「✨ 开始创作」</b>。");
  }

  /* ---------- 生成（后端与 /chat 同一个 /run） ---------- */

  function buildInput(): string {
    const items = [
      `- 行业 / 产品卖点：${brief.product || "（待补充）"}`,
      `- 核心卖点：${brief.selling || "（待补充）"}`,
      `- 目标人群：从产品与卖点推断；投放平台：${brief.platform || "（待补充）"}`,
      `- 期望动作：${brief.action || "（待补充）"}`,
      `- 交付深度：${depth === "light" ? "轻量 · 1 条可直发文案" : "完整 · 内容十件套"}`,
      `- 出镜方式：${brief.camera || "（待补充）"}`,
      supplement ? `- 补充说明：${supplement}` : ""
    ].filter(Boolean).join("\n");
    return `请按「文案」方法论，基于下面业务信息生成最终交付。\n${items}`;
  }

  async function startGen() {
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
        throw new Error("登录已过期，本地登录信息已清除。请点右上角「未登录 · 点击登录」重新登录；本次不消耗积分。");
      }
      if (res.status === 402) {
        const data = (await res.json().catch(() => ({}))) as { message?: string };
        const nextRoute = `${getAppRoutePath(window.location.pathname)}${window.location.search}`;
        setError(`${data.message ?? "当前积分不足，请先充值后再使用。"}（本次未消耗积分） 请前往充值页后回来，简报已在本页保留。`);
        setPhase("confirm");
        window.setTimeout(() => {
          window.location.href = getAppPath(`/recharge?from=agent&skill=${encodeURIComponent(skuId)}&next=${encodeURIComponent(nextRoute)}`);
        }, 400);
        return;
      }
      if (res.status === 409) {
        const payload = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
        if (payload.error === "marketplace_subscription_quota_exhausted") {
          setError(`${payload.message ?? "你已开通本智能体的包月，今天的次数已经用完。"}（本次不消耗积分；额度每天 0 点恢复。）`);
          setPhase("confirm");
          return;
        }
        throw new Error(payload.message ?? "本次请求被拒绝；本次不消耗积分。");
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
          "请补充后重新生成（本次不消耗积分）。"
        );
      }
      runResultRef.current = {
        answer: result.answer ?? "",
        consumed: typeof result.consumedCredits === "number" ? result.consumedCredits : null,
        subCovered: Boolean(result.subscription?.covered)
      };
      setRunSettled(true);
    } catch (e) {
      window.clearInterval(tick);
      setError(e instanceof Error ? e.message : "生成失败，请稍后重试。");
      setPhase("confirm");
      pushMsg("ai", "这一稿没有生成成功（<b>本次不消耗积分</b>）。按提示补充或稍后再点「✨ 开始创作」。");
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
  const canGen = filled === 6 && (phase === "confirm" || phase === "done");
  const pieceList = depth === "light" ? [] : PIECES;
  const groups = [...new Set(pieces.map((p) => p.meta.g))];
  const shownPieces = tab === "all" ? pieces : pieces.filter((p) => p.meta.g === tab);
  const gpTotal = logLines.length || 1;
  const gpPct = Math.round(Math.min(logIdx, gpTotal) / gpTotal * 100);
  const statusText =
    phase === "gen" ? `创作中…（已等待 ${elapsed} 秒）` :
    phase === "done" ? "已交付" :
    phase === "confirm" ? "引导完成" :
    phase === "ask" ? `引导中（${Math.min(qi + 1, 6)}/6）` : "待引导";
  const feeHint =
    phase === "done" ? (
      subCovered ? <>本次由<b>包月覆盖</b>，不扣积分</> : <>本次实际消耗 <b>{consumed ?? skuPpu ?? "—"} 积分</b>（按实际用量结算）</>
    ) : (
      <>完成引导后可创作 · 预计消耗约 <b>{skuPpu ?? "—"} 积分</b>（按本次实际用量结算）</>
    );

  return (
    <main className="cpw-page">
      {/* Topbar 在作用域外（商城红线：留白/主题由全局容器与 Topbar 自己管） */}
      <Topbar active="chat" balance={balance} onNavigate={(path) => { window.location.href = getAppPath(path); }} />

      <header className="cpw-hero">
        <div className="cpw-wrap">
          <button className="cpw-backbtn" onClick={() => { window.location.href = getAppPath(`/agent/${encodeURIComponent(skuId)}/detail`); }}>← 返回</button>
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
                      <b>📋 创作简报</b>
                      <span className="cpw-brief-sub">字段可随时点击修改，改完可重新生成</span>
                      <div className="cpw-meter"><span>{filled}/6</span><div className="cpw-segs">{FIELDS.map((f, i) => <div key={f.key} className={`cpw-seg${i < filled ? " on" : ""}`} />)}</div></div>
                    </div>
                    <div className="cpw-grid">
                      {FIELDS.map((f) => {
                        const v = (brief[f.key] ?? "").trim();
                        const show = f.key === "depth" && v ? (v === "full" ? "完整内容十件套" : "轻量 · 1 条可直发文案") : v;
                        return (
                          <div key={f.key} className={`cpw-bf${v ? " filled" : ""}`} title={v ? "点击修改" : "等待左侧引导填入"} onClick={() => editField(f.key)}>
                            <div className="cpw-bf-k">{f.icon} {f.label}{v ? "" : " · 待填"}</div>
                            <div className="cpw-bf-v">{show || "——"}</div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="cpw-ops">
                      <button className="cpw-big-btn gen" disabled={!canGen} onClick={() => void startGen()}>✨ 开始创作</button>
                      {phase === "done" && (
                        <button className="cpw-big-btn ghost" onClick={() => { setPhase("confirm"); setPieces([]); setAnswerMd(""); setConsumed(null); }}>↻ 改简报重新生成</button>
                      )}
                      <span className="cpw-fee">{feeHint}</span>
                      <span className="cpw-safe-tag">🛡️ 失败不扣费</span>
                    </div>
                    {error && <div className="cpw-err">{error}</div>}
                  </div>

                  <div className="cpw-canvas">
                    {phase === "idle" || phase === "ask" || (phase === "confirm" && !depth) ? (
                      <>
                        <div className="cpw-ph-note">👋 完成左侧引导后，交付物会在这里分区生成<span className="cpw-tag">先选交付深度</span><span className="cpw-tag">再开始创作</span></div>
                        <div className="cpw-ph-grid initial">
                          <div className="cpw-ph locked span2"><div className="cpw-no g-doc">轻量</div><b>📄 1 条可直发文案</b><span className="cpw-d">标题 + 正文 + 话题 · 约 3 分钟</span></div>
                          <div className="cpw-ph locked span3"><div className="cpw-no g-shoot">完整</div><b>📦 内容十件套</b><span className="cpw-d">选题→口播→访谈→拍摄→剪辑→标题→时间→评论→投流 · 约 5-10 分钟</span></div>
                        </div>
                      </>
                    ) : null}

                    {(phase === "confirm" || phase === "gen") && depth && (
                      <>
                        <div className="cpw-ph-note">
                          {phase === "gen" ? <>⏳ 生成中 · 已等待 {elapsed} 秒，{depth === "full" ? "十件" : "文案"}逐件点亮</> : <>🧩 交付结构预览 · 确认简报后点「✨ 开始创作」</>}
                          <span className="cpw-tag">{depth === "full" ? "完整十件套" : "轻量 1 条"}</span>
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
                              <div className={`cpw-no g-${p.g}`}>{p.no} {p.gt}</div><b>{p.icon} {p.title}</b><span className="cpw-d">{p.d}</span>
                            </div>
                          ))}
                        </div>
                      </>
                    )}

                    {phase === "done" && (
                      <div className="cpw-dl">
                        <div className="cpw-dl-head">
                          <span className="cpw-ok-tag">✓ 已交付</span>
                          <span className="cpw-time">{pieces.length || (depth === "light" ? 1 : 10)} 件 · {subCovered ? "包月覆盖" : `消耗 ${consumed ?? skuPpu ?? "—"} 积分`}</span>
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
                                    <b>{p.meta.icon} {p.meta.title}</b>
                                    <span className="cpw-g-tag" style={{ color: GROUP_COLOR[p.meta.g], background: GROUP_SOFT[p.meta.g] }}>{p.meta.gt}</span>
                                    <div className="cpw-pc-btns">
                                      <button className="cpw-cbtn" onClick={() => copyText(`#${p.meta.num}、${p.meta.title}\n\n${p.body}`)}>⧉ 复制本件</button>
                                    </div>
                                  </div>
                                  <div className="cpw-pc-c markdown" dangerouslySetInnerHTML={{ __html: renderMarkdownHtml(p.body) }} />
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
            <div className="cpw-modal-t">{FIELDS.find((f) => f.key === editing)?.icon} 修改「{FIELDS.find((f) => f.key === editing)?.label}」</div>
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

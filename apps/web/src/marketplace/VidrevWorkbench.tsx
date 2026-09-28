// 视频复盘工作台（/agent/ipzone__vidrev/workbench）
//
// 视觉与交互对齐原型 vidrev-workbench-demo-20260924（与文案/IP定位工作台同一套 cpw- 骨架）：
//  - 左：江流引导对话（拖入数据表 → 先体检、再复盘 → 确认成交金额 → 开始复盘）；
//  - 右：🩺 体检面板（平台/文件/周期/记录数/数据形态/成交金额 + 字段覆盖）+ 交付画布。
//
// 「后端功能与 /chat 一样」的落地：
//  - /run 走 vidrev 结构化入参（buildVidrevRunBody 同构：{ input, platform, period, has_revenue_data }），
//    数据表文本与对话页同源（CSV 带编码探测 readAttachmentText；Excel 走 /media/analyze 文档解析）；
//  - 交付渲染复用对话页同一个 `VidrevReport` 组件（含导出 CSV / 加入选题池），所见即所得；
//  - 计费按实际用量结算（vidrev 不在 FIXED_PRICE_SKUS），价格取真实目录 ppu，单位「算力」；
//    校验不过不扣算力（后端 fail-closed 契约）。
// 客户端体检只做「能不能收」（逐条明细 vs 按天汇总 fail-closed、字段覆盖、平台/周期识别），
// 深度审计仍由后端第零章给出——前端不重算后端口径。原型里的「快速速读」后端无此模式，不做假选项。

import { useEffect, useRef, useState } from "react";
import { apiPath, getAppPath, getAppRoutePath } from "../lib/api.js";
import { authHeaders, handleStaleSession, readJson } from "./shell.js";
import { MallTopbar } from "./MallTopbar.js";
import { chatFlowFor, buildVidrevRunBody, normalizeVidrevPlatform } from "./chat-flows.js";
import { readAttachmentText } from "./text-attachment.js";
import { VidrevReport, isVidrevPayload, type VidrevPayload } from "./vidrev-report.js";
import { renderMarkdownHtml } from "./AgentChatPage.js";
import { employeeAvatarPath } from "./eco-mall-data.js";
import sitongAvatar from "../assets/sitong-beauty.png";

const WORKBENCH_URL_TEXT = "ai.lcppch.top/agent/ipzone__vidrev/workbench";
const LOG_DELAY_MS = 620;
const MAX_DATA_TEXT = 40_000;

/** 深度复盘 11 章（原型 CHAPTERS 元数据，逐字）。 */
const CHAPTERS: Array<{ no: string; g: string; gt: string; icon: string; title: string; d: string }> = [
  { no: "零", g: "audit", gt: "数据审计", icon: "🩺", title: "数据质量审计", d: "检查项表 + 受限维度" },
  { no: "一", g: "overview", gt: "总览分层", icon: "📊", title: "数据总览", d: "指标表 + 基线判断" },
  { no: "二", g: "overview", gt: "总览分层", icon: "🧭", title: "视频分层（四象限）", d: "口径 + 分层表" },
  { no: "三", g: "overview", gt: "总览分层", icon: "🧬", title: "内容结构健康度", d: "类型分布 + 健康度评分" },
  { no: "四", g: "deep", gt: "深拆归因", icon: "🔬", title: "单条深拆（TOP3 + BOTTOM3）", d: "6 条逐条拆解" },
  { no: "五", g: "deep", gt: "深拆归因", icon: "⏱️", title: "完播率深层归因", d: "时长分桶 + 最佳配方" },
  { no: "六", g: "deep", gt: "深拆归因", icon: "💬", title: "互动深度分析", d: "浅/深互动 + 分享率" },
  { no: "七", g: "trend", gt: "趋势规律", icon: "📈", title: "趋势预警", d: "周趋势 + 告警" },
  { no: "八", g: "trend", gt: "趋势规律", icon: "🧠", title: "规律总结", d: "五维规律表" },
  { no: "九", g: "trend", gt: "趋势规律", icon: "📚", title: "方法论沉淀", d: "可复用规律（入知识库）" },
  { no: "十", g: "action", gt: "选题行动", icon: "🚀", title: "下个周期选题建议", d: "四方向 + 候选选题" }
];

const GROUP_COLOR: Record<string, string> = { audit: "#0f8a5f", overview: "#E8651A", deep: "#2563eb", trend: "#7c3aed", action: "#b26a00" };
const GROUP_SOFT: Record<string, string> = { audit: "#e6f5ee", overview: "#fdeee2", deep: "#e8effd", trend: "#f1eafd", action: "#fff4e0" };

/** 客户端体检的 10 个关键字段（原型 fields 口径）。 */
const CHECK_FIELDS: Array<{ label: string; re: RegExp }> = [
  { label: "作品标题", re: /作品标题|动态描述|视频名称|标题/ },
  { label: "播放量", re: /播放量|播放/ },
  { label: "点赞量", re: /点赞/ },
  { label: "评论量", re: /评论/ },
  { label: "分享量", re: /分享|转发/ },
  { label: "完播率", re: /完播率/ },
  { label: "5秒完播率", re: /5秒完播|5 秒完播/ },
  { label: "咨询/转化", re: /咨询|转化|成交/ },
  { label: "发布时间", re: /发布时间|发表时间|发布日期/ },
  { label: "投流标记", re: /投流/ }
];

interface FileCheck {
  ok: boolean;
  platform: string | null;
  rows: number;
  period: string;
  shape: string;
  coverage: Array<{ label: string; ok: boolean }>;
  limited: string[];
  guide?: string;
  fileName: string;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** 客户端体检：只判「能不能收」，不重算后端指标。 */
function checkDataText(fileName: string, raw: string): FileCheck {
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const header = lines[0] ?? "";
  const dataLines = lines.slice(1);
  const platform = normalizeVidrevPlatform(`${fileName} ${header.slice(0, 200)}`);
  const hasTitleCol = /作品标题|动态描述|视频名称|标题/.test(header);
  const isDaily = /日期|投稿量|总播放/.test(header) && !hasTitleCol;
  const limited: string[] = [];
  const coverage = CHECK_FIELDS.map((f) => {
    const ok = f.re.test(header);
    if (!ok && (f.label === "5秒完播率" || f.label === "投流标记")) {
      limited.push(f.label === "5秒完播率" ? "5秒完播缺失 → 完播归因仅按整体完播率" : "投流标记缺失 → 无法区分自然流 / 付费流");
    }
    return { label: f.label, ok };
  });
  const dates = raw.match(/\d{4}[-/年.]\d{1,2}[-/月.]\d{1,2}/g) ?? [];
  const period = dates.length >= 2 ? `${dates[0]} ~ ${dates[dates.length - 1]}` : dates.length === 1 ? dates[0] : "未识别";
  if (isDaily) {
    return {
      ok: false, platform, rows: 0, period, shape: "按天汇总（每行 = 一天）", coverage, limited,
      guide: "检测到<b>按天汇总</b>数据：视频复盘需要<b>逐条作品数据</b>（每行一个作品，含播放/点赞/评论/分享）。请在抖音创作者中心 → 内容管理 → 作品数据 导出，或另存为 CSV 后重新上传。",
      fileName
    };
  }
  const ok = hasTitleCol && dataLines.length > 0 && platform != null;
  return {
    ok,
    platform,
    rows: dataLines.length,
    period,
    shape: hasTitleCol ? "逐条作品明细（每行一个作品）" : "无法识别的表结构",
    coverage,
    limited,
    guide: ok ? undefined : (!platform
      ? "没有识别出平台：文件名或表头里应含「视频号 / 抖音」字样（平台后台导出的文件自带）。"
      : "表头里没有找到「作品标题 / 动态描述」这类标题列——请确认导出的是作品数据明细表。"),
    fileName
  };
}

type Phase = "idle" | "greet" | "checked" | "rejected" | "confirm" | "gen" | "done";
interface ChatMsg { id: number; who: "ai" | "user"; html: string }

export function VidrevWorkbench({ skuId }: { skuId: string }) {
  const [skuPpu, setSkuPpu] = useState<number | null>(null);
  const avatar = employeeAvatarPath(skuId) ?? sitongAvatar;

  const [phase, setPhase] = useState<Phase>("idle");
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [showDropzone, setShowDropzone] = useState(false);
  const [freeInput, setFreeInput] = useState("");
  const [check, setCheck] = useState<FileCheck | null>(null);
  const [revenue, setRevenue] = useState<boolean | null>(null);
  const [supplement, setSupplement] = useState("");
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 生成中（与另外两个工作台同一套「诚实进度」机制：末行由后端真实返回揭晓）
  const [logLines, setLogLines] = useState<string[]>([]);
  const [logIdx, setLogIdx] = useState(0);
  const [genIdx, setGenIdx] = useState(-1);
  const [elapsed, setElapsed] = useState(0);
  const runResultRef = useRef<{ payload: VidrevPayload | null; answer: string; consumed: number | null } | null>(null);
  const [runSettled, setRunSettled] = useState(false);
  const [logDone, setLogDone] = useState(false);

  const [payload, setPayload] = useState<VidrevPayload | null>(null);
  const [answerMd, setAnswerMd] = useState("");
  const [consumed, setConsumed] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);

  const msgIdRef = useRef(0);
  const logRef = useRef<HTMLDivElement | null>(null);
  const timersRef = useRef<number[]>([]);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const dataTextRef = useRef<string>("");

  function pushMsg(who: "ai" | "user", html: string) {
    const id = ++msgIdRef.current;
    setMessages((prev) => [...prev, { id, who, html }]);
  }
  function later(fn: () => void, ms: number) {
    const t = window.setTimeout(fn, ms);
    timersRef.current.push(t);
  }

  useEffect(() => {
    document.title = "视频复盘工作台 · 思潼AI商城";
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
  }, [messages, showDropzone, parsing]);

  // 进页即问候；不加 ref 守卫（StrictMode 模拟卸载会清定时器，须重跑收敛）
  useEffect(() => {
    resetAll(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function resetAll(greet: boolean) {
    timersRef.current.forEach((t) => { window.clearTimeout(t); window.clearInterval(t); });
    timersRef.current = [];
    setPhase("idle"); setMessages([]); setShowDropzone(false); setFreeInput("");
    setCheck(null); setRevenue(null); setSupplement(""); setParsing(false); setError(null);
    setLogLines([]); setLogIdx(0); setGenIdx(-1);
    setRunSettled(false); setLogDone(false); runResultRef.current = null;
    setPayload(null); setAnswerMd(""); setConsumed(null);
    dataTextRef.current = "";
    if (greet) {
      pushMsg("ai", `老板，我是<b>江流</b>。你把后台导出的数据表拖进来，我<b>先体检、再复盘</b>：数据合不合格、缺什么字段、影响哪一章结论，体检面板上写得明明白白，<b>体检不扣算力</b>，不合格我不会瞎出报告。<br><span class="q-hint">目前支持抖音、视频号两个平台（一次一个平台）。把文件拖进下方虚线框，或点「选择文件」。</span>`);
      setShowDropzone(true);
      setPhase("greet");
    }
  }

  /* ---------- 上传与体检（与对话页同源：CSV 编码探测 / Excel 文档解析） ---------- */

  async function parseFile(file: File): Promise<string> {
    if (/\.(xlsx|xls)$/i.test(file.name)) {
      const formData = new FormData();
      formData.append("file", file, file.name);
      formData.append("metadata", "视频复盘数据表");
      formData.append("frames", "[]");
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 60_000);
      try {
        const response = await fetch(apiPath("/media/analyze"), {
          method: "POST",
          headers: authHeaders(),
          body: formData,
          signal: controller.signal
        });
        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as { message?: string };
          throw new Error(payload.message?.trim() || `解析失败（${response.status}）`);
        }
        const payload = (await response.json()) as { documentText?: string };
        return (payload.documentText ?? "").trim();
      } catch (e) {
        if ((e as { name?: string }).name === "AbortError") throw new Error("解析超过 60 秒已停止，请换更小的表格重试");
        throw e;
      } finally {
        window.clearTimeout(timeoutId);
      }
    }
    const decoded = await readAttachmentText(file);
    return decoded.text;
  }

  async function handleFiles(files: File[]) {
    if (files.length === 0 || phase === "gen" || parsing) return;
    const file = files[0];
    setParsing(true);
    setShowDropzone(false);
    pushMsg("user", `（上传：${escapeHtml(file.name)} · ${(file.size / 1024).toFixed(1)} KB）`);
    try {
      const raw = await parseFile(file);
      if (!raw) throw new Error("没有读到可用数据：请确认导出的是视频号 / 抖音后台的作品数据表（至少含标题、发布时间、播放量等列）。");
      dataTextRef.current = raw.slice(0, MAX_DATA_TEXT);
      const result = checkDataText(file.name, dataTextRef.current);
      setCheck(result);
      setRevenue(null);
      if (result.ok) {
        setPhase("checked");
        const okN = result.coverage.filter((f) => f.ok).length;
        pushMsg("ai",
          `<div class="chk pass"><div class="ch">✅ 数据体检通过 · 核心字段 ${okN}/${result.coverage.length} 覆盖</div><div class="cb">` +
          `<div class="row"><span>识别平台</span><b>${result.platform}</b></div>` +
          `<div class="row"><span>数据形态</span><b>${result.shape}</b></div>` +
          `<div class="row"><span>记录数</span><b>${result.rows} 条（周期 ${result.period}）</b></div>` +
          `<div class="row"><span>受限维度</span><b>${result.limited.length} 项${result.limited.length ? "（已标注降级口径，第零章审计会写清）" : ""}</b></div>` +
          `</div></div>最后一件事：这批数据里<b>有没有成交金额</b>（营业额 / GMV）？<span class="q-hint">有的话 ROI 能算；没有我按「数据缺失」处理，不会编数字。回复「有」或「没有」。</span>`);
      } else {
        setPhase("rejected");
        pushMsg("ai",
          `这份表我拒收了，先说清楚原因，免得你白等：` +
          `<div class="chk fail"><div class="ch">⛔ 数据体检不通过 · 本次不生成报告、不消耗算力</div><div class="cb">` +
          `<div class="row"><span>识别平台</span><b>${result.platform ?? "未识别"}</b></div>` +
          `<div class="row"><span>数据形态</span><b>${result.shape}</b></div>` +
          `<div class="row"><span>解析记录</span><b>0 条</b></div>` +
          `<div class="guide">${result.guide ?? ""}</div></div></div>换一份<b>逐条作品明细</b>（每行一个作品）拖进来就行。`);
        setShowDropzone(true);
      }
    } catch (e) {
      setPhase("rejected");
      setError(e instanceof Error ? e.message : "文件读取失败，请重试。");
      setShowDropzone(true);
    } finally {
      setParsing(false);
    }
  }

  function answerRevenue(yes: boolean) {
    if (phase !== "checked") return;
    setRevenue(yes);
    setPhase("confirm");
    pushMsg("user", yes ? "有" : "没有");
    const c = check;
    if (!c) return;
    const lim = c.limited.length
      ? `受限维度 ${c.limited.length} 项（${c.limited.join("；")}），相关章节会写清降级口径。`
      : "无受限维度。";
    pushMsg("ai",
      `复述一遍本次复盘参数：<b>平台=${c.platform}；周期=${c.period}；记录=${c.rows} 条；成交金额=${yes ? "有（ROI 可核算）" : "无（ROI 按缺失处理）"}；模式=深度复盘（11 章）。</b>${lim}<br>没问题就点 <b>「📊 开始复盘」</b>（右侧体检面板）；要换数据，把新的表拖进来即可。`);
  }

  /* ---------- 生成（后端与 /chat 同源：vidrev 结构化入参） ---------- */

  async function startGen() {
    if (phase !== "confirm" || !check?.ok) return;
    setError(null);
    setPhase("gen");
    setElapsed(0); setGenIdx(-1);
    setRunSettled(false); setLogDone(false); runResultRef.current = null;
    setPayload(null); setAnswerMd(""); setConsumed(null);

    // 日志（原型同款）；末行 ✅ 由后端真实返回揭晓——结果没回来前进度 <100%
    const ordered: string[] = [
      `→ 注入复盘参数 mode=deep · platform=${check.platform} · period=${check.period}`,
      `→ 数据体检复核通过：${check.rows} 条逐条作品明细 · 字段覆盖 ${check.coverage.filter((f) => f.ok).length}/${check.coverage.length}`,
      "→ 加载视频复盘引擎 · 后端重算四象限与加权口径",
      ...CHAPTERS.map((ch) => `✓ ${ch.no}、${ch.title}`)
    ];
    setLogLines([...ordered, "✅ V1–V9 质量门禁通过 · 交付完成"]);

    let li = 0;
    const step = () => {
      li += 1;
      setLogIdx(li);
      const t = ordered[li - 1] ?? "";
      if (t.startsWith("✓")) setGenIdx((g) => g + 1);
      if (li < ordered.length) later(step, LOG_DELAY_MS);
      // 走完停在最后一章 ✓；完成行由 runSettled 揭晓
    };
    later(step, 300);
    const tick = window.setInterval(() => setElapsed((e) => e + 1), 1000);
    timersRef.current.push(tick);

    try {
      const flow = chatFlowFor("vidrev");
      if (!flow) throw new Error("未找到视频复盘技能流程配置。");
      const answers: Record<string, string> = {
        platform: check.platform ?? "",
        data: dataTextRef.current,
        // 体检识别到的周期一并提供给结构化入参（buildVidrevRunBody 会解析 start/end）
        ...(check.period && check.period !== "未识别" ? { period: check.period } : {}),
        ...(supplement ? { __supplement: supplement } : {})
      };
      const body = buildVidrevRunBody(flow, answers);
      if (revenue === true) body.has_revenue_data = true;
      const res = await fetch(apiPath(`/market/skus/${encodeURIComponent(skuId)}/run`), {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify(body)
      });
      window.clearInterval(tick);
      if (handleStaleSession(res.status)) {
        throw new Error("登录已过期，本地登录信息已清除。请点右上角「未登录 · 点击登录」重新登录；本次不消耗算力。");
      }
      if (res.status === 402) {
        const data = (await res.json().catch(() => ({}))) as { message?: string };
        const nextRoute = `${getAppRoutePath(window.location.pathname)}${window.location.search}`;
        setError(`${data.message ?? "当前算力不足，请先充值后再使用。"}（本次未消耗算力） 请前往充值页后回来，体检结果已在本页保留。`);
        setPhase("confirm");
        window.setTimeout(() => {
          window.location.href = getAppPath(`/recharge?from=agent&skill=${encodeURIComponent(skuId)}&next=${encodeURIComponent(nextRoute)}`);
        }, 400);
        return;
      }
      if (res.status === 502 || res.status === 503 || res.status === 504) {
        throw new Error(
          `复盘还没跑完，网关的等待上限先到了（HTTP ${res.status}）。这一稿在后台通常还在继续：` +
          "生成成功会正常计费并留存 7 天，稍后重新回到本页面可以重新复盘，不必急着重做。"
        );
      }
      const result = await readJson<{
        answer: string;
        consumedCredits: number;
        needsInput?: boolean;
        payload?: unknown;
      }>(res);
      if (result.needsInput) {
        const question = (result.answer ?? "").trim();
        throw new Error(
          (question ? `江流还想确认一下：${question} ` : "还需要补充一些关键信息。") +
          "请补充后重新复盘（本次不消耗算力）。"
        );
      }
      const vp = isVidrevPayload(result.payload) ? result.payload : null;
      runResultRef.current = {
        payload: vp,
        answer: result.answer ?? "",
        consumed: typeof result.consumedCredits === "number" ? result.consumedCredits : null
      };
      setRunSettled(true);
    } catch (e) {
      window.clearInterval(tick);
      setError(e instanceof Error ? e.message : "生成失败，请稍后重试。");
      setPhase("confirm");
      pushMsg("ai", "这一稿没有生成成功（<b>本次不消耗算力</b>）。按提示补充或稍后再点「📊 开始复盘」。");
    }
  }

  /** 日志末行（✅ 交付完成）由后端真实返回触发揭晓——结果没回来前日志停在第十章 ✓、进度条封顶 <100%。 */
  useEffect(() => {
    if (phase !== "gen" || !runSettled || logDone || logLines.length === 0) return;
    if (logIdx < logLines.length - 1) return;
    const result = runResultRef.current;
    if (!result) return;
    setPayload(result.payload);
    setAnswerMd(result.answer || result.payload?.report_markdown || "");
    setConsumed(result.consumed);
    setLogIdx(logLines.length);
    setLogDone(true);
    setPhase("done");
    pushMsg("ai", "交付完成 ✅ <b>深度复盘报告</b>已放到右侧——第零章先看数据质量审计，受限维度的降级口径都写清了。数据表可导出 CSV，候选选题可一键加入选题池。");
  }, [phase, runSettled, logDone, logIdx, logLines]);

  /* ---------- 自由输入 ---------- */

  function freeSend() {
    const v = freeInput.trim();
    if (!v) return;
    setFreeInput("");
    if (phase === "checked") {
      if (/没有|无|不是|no/i.test(v)) { answerRevenue(false); return; }
      if (/有|是|对|yes/i.test(v)) { answerRevenue(true); return; }
      pushMsg("user", escapeHtml(v));
      pushMsg("ai", "这里回复「有」或「没有」就行（数据里有没有成交金额 / GMV）。");
    } else if (phase === "confirm") {
      setSupplement((prev) => (prev ? `${prev}；${v}` : v));
      pushMsg("user", escapeHtml(v));
      pushMsg("ai", "已记录 ✅ 会把这条说明一并交给复盘引擎，点「📊 开始复盘」生效。");
    } else if (phase === "done") {
      pushMsg("user", escapeHtml(v));
      pushMsg("ai", "已记录。想基于这份报告重新复盘（换数据 / 补说明），直接拖新表进来，会按实际用量结算。");
    } else {
      pushMsg("user", escapeHtml(v));
      pushMsg("ai", "收到。把<b>数据表</b>拖进来（下方虚线框），我从文件里认平台——比口头说更准。");
    }
  }

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
        body: JSON.stringify({ title: "视频深度复盘报告 · 思潼AI", content: answerMd })
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
      a.download = created.filename || "视频深度复盘报告.docx";
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

  const badge = !check
    ? { cls: "idle", text: "待上传数据" }
    : !check.ok
      ? { cls: "blocked", text: "体检不通过 · 换数据" }
      : revenue === null
        ? { cls: "standard", text: "体检通过 · 待确认成交" }
        : { cls: "full", text: "体检通过 · 可复盘" };
  const canGen = Boolean(check?.ok) && revenue !== null && phase === "confirm";
  const statusText =
    phase === "gen" ? "复盘生成中 · 流式推导" :
    phase === "done" ? "已交付" :
    phase === "confirm" ? "体检通过 · 可复盘" :
    phase === "checked" ? "体检通过 · 待确认成交" :
    phase === "rejected" ? "体检不通过" : "待上传数据";
  const gpTotal = logLines.length || 1;
  const gpPct = Math.round(Math.min(logIdx, gpTotal) / gpTotal * 100);
  const briefRows: Array<{ icon: string; label: string; value: string | null; tag?: string }> = [
    { icon: "📱", label: "平台", value: check?.platform ?? null },
    { icon: "📄", label: "数据文件", value: check ? check.fileName : null },
    { icon: "📅", label: "复盘周期", value: check?.period ?? null },
    { icon: "🔢", label: "记录数", value: check && check.ok ? `${check.rows} 条` : null },
    { icon: "🧾", label: "数据形态", value: check?.shape ?? null },
    { icon: "💰", label: "成交金额", value: revenue === null ? null : revenue ? "有成交数据（ROI 可核算）" : "无（ROI 按缺失处理）", tag: "影响 ROI" }
  ];

  return (
    <main className="cpw-page">
      <MallTopbar back={`/agent/${encodeURIComponent(skuId)}/detail`} badge="视频复盘智能体 · 复盘工作台" />

      <header className="cpw-hero">
        <div className="cpw-wrap">
          <div className="cpw-chips">
            <span className="cpw-chip dev">视频复盘智能体</span>
            <span className="cpw-chip">江流 · 复盘顾问</span>
            <span className="cpw-chip">视频复盘工作台</span>
          </div>
          <h1><img className="cpw-emoji" src={avatar} alt="江流" />视频复盘工作台</h1>
          <p className="cpw-hook">拖进后台导出的数据表，江流先体检、再复盘：合格才出报告，不合格写清原因。</p>
          <p className="cpw-ability">上传数据 → 体检面板（字段覆盖 / 受限维度）→ 深度复盘 11 章（零章审计 + 一~十章归因 + 选题建议）：按实际用量结算，校验不过不扣算力。交付与对话页同一个复盘报告组件，所见即所得。</p>
        </div>
      </header>

      <section className="cpw-demo">
        <div className="cpw-wrap">
          <div className="cpw-sec-head"><h2>▶ <span className="cpw-k">工作台</span></h2><span className="cpw-desc">左：复盘引导｜右：体检面板 + 复盘报告</span></div>
          <div className="cpw-stage">
            <div className="cpw-bar">
              <span className="cpw-dot r" /><span className="cpw-dot y" /><span className="cpw-dot g" />
              <span className="cpw-url">思潼AI · 视频复盘工作台</span>
              <span className="cpw-st"><span className={`cpw-st-dot ${phase === "gen" ? "playing" : phase === "done" ? "done" : ""}`} /><span>{statusText}</span></span>
              <div className="cpw-ctrls">
                <button className="cpw-sbtn" onClick={() => resetAll(true)}>↻ 重置</button>
              </div>
            </div>
            <div className="cpw-body">
              {/* 左：引导对话 */}
              <div className="cpw-chat">
                <div className="cpw-chat-head">
                  <div className="cpw-av"><img src={avatar} alt="江流" /></div>
                  <div><b>江流 · 复盘引导</b><span>先体检、再复盘 · 数据不合格不出报告</span></div>
                </div>
                <div className="cpw-log" ref={logRef}>
                  {messages.map((m) => (
                    <div key={m.id} className={`cpw-msg${m.who === "user" ? " user" : ""}`}>
                      {m.who === "ai" && <div className="cpw-m-av"><img src={avatar} alt="" /></div>}
                      <div className="cpw-bub" dangerouslySetInnerHTML={{ __html: m.html }} />
                    </div>
                  ))}
                  {showDropzone && (
                    <div
                      className="cpw-dropzone"
                      onClick={() => fileRef.current?.click()}
                      onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add("drag"); }}
                      onDragLeave={(e) => { e.currentTarget.classList.remove("drag"); }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.currentTarget.classList.remove("drag");
                        void handleFiles(Array.from(e.dataTransfer.files ?? []));
                      }}
                    >
                      <div className="cpw-dz-t">{parsing ? "⏳ 正在读取数据表…" : "📥 把数据表拖到这里，或点击选择文件"}</div>
                      <div className="cpw-dz-d">抖音创作者中心 / 视频号助手导出 · CSV / Excel · 近 30 天（体检不扣算力）</div>
                      <button className="cpw-dz-btn" onClick={(e) => { e.stopPropagation(); fileRef.current?.click(); }}>选择文件</button>
                    </div>
                  )}
                </div>
                <div className="cpw-input">
                  <input
                    value={freeInput}
                    onChange={(e) => setFreeInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") freeSend(); }}
                    placeholder={phase === "checked" ? "回复「有」或「没有」（有成交金额则 ROI 可核算）" : "也可以直接打字，例如：视频号"}
                  />
                  <button onClick={freeSend}>发送</button>
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,.tsv,.txt,.xlsx,.xls"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? []);
                    e.target.value = "";
                    void handleFiles(files);
                  }}
                />
              </div>

              {/* 右：体检面板 + 交付画布 */}
              <div className="cpw-ws">
                <div className="cpw-ws-inner">
                  <div className="cpw-brief">
                    <div className="cpw-brief-t">
                      <b>🩺 体检面板</b>
                      <span className={`cpw-cmpl ${badge.cls}`}>{badge.text}</span>
                      <div className="cpw-meter"><span>{check?.ok ? `${check.coverage.filter((f) => f.ok).length}/${check.coverage.length}` : "—"}</span><div className="cpw-segs">{CHECK_FIELDS.slice(0, 8).map((f, i) => <div key={f.label} className={`cpw-seg${check?.ok && check.coverage[i]?.ok ? " on" : ""}`} />)}</div></div>
                    </div>
                    <div className="cpw-grid">
                      {briefRows.map((r) => (
                        <div key={r.label} className={`cpw-bf${r.value ? " filled" : ""}`} style={{ cursor: "default" }}>
                          <div className="cpw-bf-k">{r.icon} {r.label}{r.tag ? <span className="cpw-opt-tag">{r.tag}</span> : null}</div>
                          <div className="cpw-bf-v">{r.value || "——"}</div>
                        </div>
                      ))}
                    </div>
                    {check?.ok && (
                      <div className="cpw-cov">
                        <div className="cpw-cov-t">字段覆盖 · {check.coverage.filter((f) => f.ok).length}/{check.coverage.length}</div>
                        <div className="cpw-cov-chips">
                          {check.coverage.map((f) => (
                            <span key={f.label} className={f.ok ? "cpw-chipok" : "cpw-chipmiss"}>{f.ok ? "✓" : "✗"} {f.label}{!f.ok && <i>缺失</i>}</span>
                          ))}
                        </div>
                        {check.limited.length > 0 && (
                          <div className="cpw-limited">受限维度：{check.limited.join("；")}（第零章审计写清降级口径）</div>
                        )}
                      </div>
                    )}
                    <div className="cpw-ops">
                      <button className="cpw-big-btn gen" disabled={!canGen} onClick={() => void startGen()}>📊 开始复盘</button>
                      {phase === "done" && (
                        <button className="cpw-big-btn ghost" onClick={() => resetAll(true)}>↻ 重新复盘</button>
                      )}
                      <span className="cpw-fee">
                        {phase === "done"
                          ? <>本次实际消耗 <b>{consumed ?? skuPpu ?? "—"} 算力</b>（按实际用量结算）</>
                          : <>预计消耗约 <b>{skuPpu ?? "—"} 算力</b>（按实际用量结算 · 体检不扣 · 校验不过不扣）</>}
                      </span>
                      <span className="cpw-safe-tag">🛡️ 失败不扣费</span>
                    </div>
                    {error && <div className="cpw-err">{error}</div>}
                  </div>

                  <div className="cpw-canvas">
                    {phase === "done" && payload ? (
                      <div className="cpw-dl">
                        <div className="cpw-dl-head">
                          <span className="cpw-ok-tag">✓ 已交付</span>
                          <span className="cpw-time">深度复盘 · {check?.platform} · {check?.period} · 消耗 {consumed ?? skuPpu ?? "—"} 算力</span>
                          <div className="cpw-dl-ops">
                            <button className="cpw-cbtn" onClick={() => copyText(answerMd)}>⧉ 复制全部</button>
                            <button className="cpw-cbtn" onClick={() => void exportWord()} disabled={exporting}>{exporting ? "导出中…" : "↓ 导出 Word"}</button>
                          </div>
                        </div>
                        <VidrevReport payload={payload} renderMarkdown={renderMarkdownHtml} />
                      </div>
                    ) : phase === "gen" ? (
                      <>
                        <div className="cpw-ph-note">⏳ 复盘生成中 · 11 章逐章点亮 · 已等待 {elapsed} 秒<span className="cpw-tag">深度复盘</span></div>
                        <div className="cpw-gen-prog">
                          <div className="cpw-gp-row"><div className="cpw-gp-bar"><i style={{ width: `${gpPct}%` }} /></div><b>{gpPct}%</b></div>
                          <div className="cpw-gp-meta"><span>{logLines[logIdx - 1]?.replace(/^(→ |✓ |✅ )/, "")?.slice(0, 24) || "准备中…"}</span><span>{logIdx >= logLines.length - 1 && !runSettled ? `后端生成中… 已等待 ${elapsed} 秒` : gpPct >= 100 ? "马上就好…" : `预计还需 ~${Math.max(1, Math.ceil((gpTotal - logIdx) * LOG_DELAY_MS / 1000))} 秒`}</span></div>
                        </div>
                        <div className="cpw-genlog">
                          {logLines.slice(0, logIdx).map((ln, i) => (
                            <div key={i} className={`cpw-ln ${ln.startsWith("✅") ? "hl" : ln.startsWith("✓") ? "ok" : ""}`}>{ln}</div>
                          ))}
                        </div>
                        <div className="cpw-ph-grid">
                          {CHAPTERS.map((ch, i) => {
                            const cls = i < genIdx ? "cpw-ph done" : i === genIdx ? "cpw-ph gening" : "cpw-ph locked";
                            return (
                              <div key={ch.no} className={cls}>
                                {i === genIdx && <span className="cpw-spin" />}
                                <div className="cpw-no" style={{ color: GROUP_COLOR[ch.g], background: GROUP_SOFT[ch.g] }}>{ch.no} · {ch.gt}</div>
                                <b>{ch.icon} {ch.title}</b>
                                <span className="cpw-d">{ch.d}</span>
                              </div>
                            );
                          })}
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="cpw-ph-note">👋 拖入数据表并通过体检后，深度复盘会在这里分章生成<span className="cpw-tag">逐条明细</span><span className="cpw-tag">先体检</span><span className="cpw-tag">再复盘</span></div>
                        <div className="cpw-ph-grid initial">
                          <div className="cpw-ph locked span2"><div className="cpw-no" style={{ color: GROUP_COLOR.audit, background: GROUP_SOFT.audit }}>🩺 第一步</div><b>数据体检 · 不扣算力</b><span className="cpw-d">平台 / 形态 / 记录数 / 字段覆盖 / 受限维度，不合格写清原因</span></div>
                          <div className="cpw-ph locked span3"><div className="cpw-no" style={{ color: GROUP_COLOR.overview, background: GROUP_SOFT.overview }}>📊 第二步</div><b>深度复盘 · 11 章</b><span className="cpw-d">零章审计 + 一~十章归因 + 选题建议 · 校验不过不扣算力</span></div>
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
    </main>
  );
}

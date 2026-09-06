import { useEffect, useMemo, useState } from "react";
import { apiPath, getAppPath } from "../../lib/api.js";

type DailyItem = { section: string; source: string; title: string; summary: string; sourceFacts: string[]; sourceIndustry: string; sourceLabel: string; sitongComment: string; inferenceLabel: "beauty_interpretation"; possibleImpact: string; applicabilityConditions: string[]; verificationNeeded: string[]; sourceUrl: string; publishedAt: string; verificationStatus: "verified_hotspot" | "trend_observation"; beautySegments: string[] };
type DailyReport = { businessDate: string; cutoffAt: string; generatedAt: string; lastSuccessfulAt: string; trigger: "scheduled" | "catchup" | "manual"; sourceWindowHours: 24 | 72; runtimeMode: "controlled_mock" | "live"; controlledNotice?: string; sections: Array<{ name: string; items: DailyItem[] }>; trends: Array<{ title: string; evidence: string; action: string }>; todayAction: { title: string; why: string; steps: string[] } };
type DailyState = { businessDate: string; status: string; phase: string; trigger: string | null; cutoffAt: string; nextScheduledAt: string; sourceWindowHours: number | null; sourceCount: number; lastSuccessfulAt: string | null; errorCode: string | null; errorMessage: string | null; runtimeMode: "disabled" | "controlled_mock" | "live"; schedulerEnabled: boolean; formalAutomationEnabled: boolean; controlledNotice: string | null; report: DailyReport | null };
type DailyHistory = { reports: DailyState[] };

const ACTIVE = new Set(["queued", "collecting_sources", "verifying_sources", "generating", "validating_contract"]);
const PHASE_LABELS: Record<string, string> = { not_generated: "尚未生成", queued: "已入队", collecting_sources: "正在采集来源", verifying_sources: "正在核验来源", generating: "正在生成日报", validating_contract: "正在校验合同", succeeded: "已完成", source_insufficient: "来源不足", failed: "生成失败", terminal_unknown: "终态待人工核对" };
const TRIGGER_LABELS: Record<string, string> = { scheduled: "09:00 正常生成", catchup: "服务恢复后补跑", manual: "受权人工重试" };

export function BeautyIndustryDailyBrief({ headers }: { headers: Record<string, string> }) {
  const [state, setState] = useState<DailyState | null>(null);
  const [history, setHistory] = useState<DailyState[]>([]);
  const [selectedDate, setSelectedDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const currentDate = state?.businessDate ?? "";
  const selected = selectedDate || currentDate;

  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (!state || !ACTIVE.has(state.status)) return;
    const timer = window.setInterval(() => { void loadState(selectedDate || undefined, false); }, 1200);
    return () => window.clearInterval(timer);
  }, [state?.status, selectedDate]);

  async function load() {
    setLoading(true); setError("");
    try {
      const [next, historyResponse] = await Promise.all([fetchState(), fetch(apiPath("/beauty-industry/daily-brief/history?limit=31"), { headers }).then(readJson<DailyHistory>)]);
      setState(next); setHistory(historyResponse.reports); setSelectedDate(next.businessDate);
    } catch (reason) { setError(readError(reason)); }
    finally { setLoading(false); }
  }

  async function loadState(date?: string, showLoading = true) {
    if (showLoading) setLoading(true);
    setError("");
    try { setState(await fetchState(date)); }
    catch (reason) { setError(readError(reason)); }
    finally { if (showLoading) setLoading(false); }
  }

  async function fetchState(date?: string): Promise<DailyState> {
    const query = date ? `?date=${encodeURIComponent(date)}` : "";
    return readJson<DailyState>(await fetch(apiPath(`/beauty-industry/daily-brief${query}`), { headers }));
  }

  async function runControlled(action: "generate" | "retry") {
    if (!state || submitting || state.runtimeMode !== "controlled_mock") return;
    setSubmitting(true); setError("");
    try {
      await readJson(await fetch(apiPath("/beauty-industry/daily-brief"), { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ action, date: state.businessDate }) }));
      await loadState(state.businessDate, false);
    } catch (reason) { setError(readError(reason)); }
    finally { setSubmitting(false); }
  }

  const report = state?.report;
  const statusLabel = state ? PHASE_LABELS[state.phase] ?? state.phase : "读取中";
  const canGenerate = state?.runtimeMode === "controlled_mock" && state.status === "not_generated";
  const canRetry = state?.runtimeMode === "controlled_mock" && ["failed", "source_insufficient"].includes(state.status);
  const scheduleText = useMemo(() => state ? formatBeijing(state.nextScheduledAt) : "—", [state?.nextScheduledAt]);

  if (loading && !state) return <section className="beautyDailyBriefState" role="status"><span className="beautyIndustryLoadingMark" /><h1>正在读取美业 AI 日报</h1><p>正在恢复北京时间业务日期、来源状态和已验证缓存。</p></section>;
  if (error && !state) return <section className="beautyDailyBriefState beautyDailyBriefError" role="alert"><h1>日报暂时没有加载成功</h1><p>{error}</p><button type="button" onClick={() => void load()}>重新加载</button></section>;

  return <section className="beautyDailyBriefPage">
    <div className="beautyIndustryPageBreadcrumb"><a href={getAppPath("/agents/beauty-industry")}>美业智能体</a><span>/</span>美业 AI 日报</div>
    <header className="beautyDailyBriefHero"><div><span>面向门店经营者的每日 AI 情报与行动建议</span><h1>美业 AI 日报</h1><p>每天北京时间 09:00 生成公开资讯快照；只展示有来源、日期和核验状态的内容。</p></div><aside><strong>{statusLabel}</strong><small>{state?.formalAutomationEnabled ? "正式自动更新已启用" : "正式自动更新待持续运行授权"}</small></aside></header>
    {state?.controlledNotice && <p className="beautyDailyBriefMockNotice" role="status">{state.controlledNotice}</p>}
    {error && <div className="beautyIndustryError" role="alert"><span>{error}</span><button type="button" onClick={() => setError("")}>关闭</button></div>}
    <section className="beautyDailyBriefMeta">
      <article><span>日报业务日期</span><strong>{state?.businessDate ?? "—"}</strong></article>
      <article><span>数据截止时间</span><strong>{state ? formatBeijing(state.cutoffAt) : "—"}</strong></article>
      <article><span>生成方式</span><strong>{state?.trigger ? TRIGGER_LABELS[state.trigger] ?? state.trigger : "尚未生成"}</strong></article>
      <article><span>来源窗口</span><strong>{state?.sourceWindowHours ? `最近 ${state.sourceWindowHours} 小时` : "先 24 小时，不足扩至 72 小时"}</strong></article>
      <article><span>最后成功更新</span><strong>{state?.lastSuccessfulAt ? formatBeijing(state.lastSuccessfulAt) : "暂无"}</strong></article>
      <article><span>下次计划时间</span><strong>{scheduleText}</strong></article>
    </section>
    <div className="beautyDailyBriefControls">
      <label>历史日期<select value={selected} onChange={(event) => { setSelectedDate(event.target.value); void loadState(event.target.value); }}><option value={currentDate}>{currentDate || "今天"}</option>{history.filter((item) => item.businessDate !== currentDate).map((item) => <option key={item.businessDate} value={item.businessDate}>{item.businessDate} · {PHASE_LABELS[item.status] ?? item.status}</option>)}</select></label>
      {canGenerate && <button type="button" disabled={submitting} onClick={() => void runControlled("generate")}>{submitting ? "正在入队…" : "生成受控测试日报"}</button>}
      {canRetry && <button type="button" disabled={submitting} onClick={() => void runControlled("retry")}>{submitting ? "正在入队…" : "受权人工重试"}</button>}
      {state?.runtimeMode === "disabled" && <p>当前不会读取公开来源、调用模型、创建付费任务或扣除积分。</p>}
    </div>
    {ACTIVE.has(state?.status ?? "") && <section className="beautyDailyBriefProgress" aria-live="polite"><strong>{statusLabel}</strong><p>已核验/进入合同的来源：{state?.sourceCount ?? 0}；刷新或离开后再回来仍会从同一日键恢复。</p></section>}
    {["source_insufficient", "failed", "terminal_unknown"].includes(state?.status ?? "") && <section className="beautyDailyBriefFailure" role="alert"><h2>{statusLabel}</h2><p>{state?.errorMessage || "任务没有形成可保存日报；没有用旧闻或模板凑满 15 条。"}</p><small>错误码：{state?.errorCode || "未提供"}</small></section>}
    {!report && !ACTIVE.has(state?.status ?? "") && !["source_insufficient", "failed", "terminal_unknown"].includes(state?.status ?? "") && <section className="beautyDailyBriefEmpty"><h2>当天日报尚未生成</h2><p>正式自动任务仍受持续来源、模型与费用授权门禁保护；无已验证结果时保持真实空状态。</p></section>}
    {report && <>
      <section className="beautyDailyBriefSections">{report.sections.map((section) => <div key={section.name}><header><span>{section.name}</span><strong>3 条</strong></header>{section.items.map((item) => <article key={item.sourceUrl}><div><em>{item.verificationStatus === "verified_hotspot" ? "已核验热点" : "趋势观察"}</em><span>{item.sourceLabel} · {item.sourceIndustry} · {formatBeijing(item.publishedAt)}</span></div><h2>{item.title}</h2><p>{item.summary}</p><details><summary>查看来源事实</summary><ul>{item.sourceFacts.map((fact) => <li key={fact}>{fact}</li>)}</ul></details><blockquote><strong>思潼点评 · 美业解释</strong>{item.sitongComment}<span>对门店的可能影响：{item.possibleImpact}</span><small>适用条件：{item.applicabilityConditions.join("；")}</small><small>建议验证：{item.verificationNeeded.join("；")}</small></blockquote><footer><span>{item.beautySegments.join(" · ")}</span><a href={item.sourceUrl} target="_blank" rel="noreferrer">查看来源 ↗</a></footer></article>)}</div>)}</section>
      <section className="beautyDailyBriefTrends"><header><span>3 条趋势</span><h2>今天值得持续观察</h2></header><div>{report.trends.map((trend) => <article key={trend.title}><h3>{trend.title}</h3><p>{trend.evidence}</p><strong>{trend.action}</strong></article>)}</div></section>
      <section className="beautyDailyBriefAction"><span>今日可落地动作</span><h2>{report.todayAction.title}</h2><p>{report.todayAction.why}</p><ol>{report.todayAction.steps.map((step) => <li key={step}>{step}</li>)}</ol></section>
    </>}
  </section>;
}

async function readJson<T = unknown>(response: Response): Promise<T> { const data = await response.json().catch(() => ({})) as { message?: string; error?: string }; if (!response.ok) throw new Error(data.message || data.error || `请求失败（${response.status}）`); return data as T; }
function readError(reason: unknown): string { return reason instanceof Error ? reason.message : "日报服务暂时不可用，请稍后重试。"; }
function formatBeijing(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? "时间待核验" : new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date); }

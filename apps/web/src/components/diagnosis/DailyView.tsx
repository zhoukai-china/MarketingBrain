import { useEffect, useMemo, useState } from "react";
import { apiPath } from "../../lib/api";

interface DailyBriefItem {
  no: number;
  source: string;
  title: string;
  summary: string;
  sourceLabel: string;
  sitongComment: string;
}

interface DailyBriefSection {
  title: string;
  emoji: string;
  items?: DailyBriefItem[];
}

interface DailyBriefReport {
  id: string;
  reportDate: string;
  issueNo: number;
  title: string;
  summary: string;
  content?: {
    date: string;
    weekday: string;
    issueNo: number;
    headline: string;
    sections?: DailyBriefSection[];
    trends?: string[];
    action: string;
  } | null;
  markdown: string;
  publishedAt?: string | null;
}

interface DailyViewProps {
  headers?: Record<string, string>;
  onNeedLogin?: () => void;
  onConsult?: () => void;
}

export function DailyView({ headers = {}, onNeedLogin, onConsult }: DailyViewProps) {
  const [report, setReport] = useState<DailyBriefReport | null>(null);
  const [history, setHistory] = useState<DailyBriefReport[]>([]);
  const [busy, setBusy] = useState(false);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [error, setError] = useState("");
  const [shareNotice, setShareNotice] = useState("");

  const sections = report?.content?.sections ?? [];
  const totalItems = useMemo(() => sections.reduce((sum, section) => sum + (section.items?.length ?? 0), 0), [sections]);

  async function load() {
    setBusy(true);
    setError("");
    try {
      const todayRes = await fetch(apiPath("/daily-brief/today"), { headers });
      if (todayRes.status === 401) {
        onNeedLogin?.();
        return;
      }
      const todayData = await readDailyBriefJson<{ report?: DailyBriefReport; message?: string }>(todayRes);
      if (!todayRes.ok) throw new Error(todayData.message ?? "AI日报加载失败");
      setReport(normalizeDailyBriefReport(todayData.report));
      await fetch(apiPath("/daily-brief/read"), {
        method: "POST",
        headers
      }).catch(() => {});
    } catch (err) {
      setReport(buildFallbackDailyBriefReport());
      setHistory([]);
      setError(err instanceof Error ? `线上日报暂时没有加载成功，已先展示今日离线版。原因：${err.message}` : "线上日报暂时没有加载成功，已先展示今日离线版。");
    } finally {
      setBusy(false);
    }
  }

  async function loadHistory() {
    if (historyLoaded || historyBusy) return;
    setHistoryBusy(true);
    try {
      const historyRes = await fetch(apiPath("/daily-brief/history"), { headers });
      if (historyRes.status === 401) {
        onNeedLogin?.();
        return;
      }
      const historyData = await readDailyBriefJson<{ reports?: DailyBriefReport[]; message?: string }>(historyRes);
      if (!historyRes.ok) throw new Error(historyData.message ?? "往期日报加载失败");
      setHistory((historyData.reports ?? []).map(normalizeDailyBriefReport));
      setHistoryLoaded(true);
    } catch {
      setHistory([buildFallbackDailyBriefReport()]);
      setHistoryLoaded(true);
    } finally {
      setHistoryBusy(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function shareTodayBrief() {
    if (!report) return;
    setShareNotice("");
    try {
      const title = `思潼AI日报 · 第${report.issueNo}期`;
      const text = `${report.summary || report.content?.headline || "今日AI日报已生成"}\n\n来自思潼AI 行业智能体平台。`;
      if (navigator.share) {
        await navigator.share({ title, text, url: window.location.href });
        setShareNotice("已打开分享面板。");
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(`${title}\n${text}\n${window.location.href}`);
        setShareNotice("日报摘要已复制，可直接发送给朋友。");
      } else {
        setShareNotice("当前浏览器不支持一键分享，请复制页面地址后发送。");
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setShareNotice("分享暂时没有完成，请稍后再试。");
    }
  }

  function toggleHistory() {
    const nextOpen = !historyOpen;
    setHistoryOpen(nextOpen);
    if (nextOpen) void loadHistory();
  }

  return (
    <div className="dailyBriefPage">
      {error && (
        <div className="dailyBriefError">
          <span>{error}</span>
          <button type="button" onClick={() => void load()} disabled={busy}>重新加载</button>
        </div>
      )}
      {busy && <DailyBriefLoadingPanel />}

      {report && (
        <article className="dailyBriefArticle">
          <header className="dailyBriefTitleBlock">
            <span>{formatDate(report.reportDate)} · 第{report.issueNo}期</span>
            <h2>思潼 X AI日报</h2>
            <p>{report.summary}</p>
            <div className="dailyBriefStats">
              <strong>{totalItems || 15}条精选</strong>
              <strong>{sections.length || 5}大版块</strong>
              <strong>{report.content?.trends?.length || 3}个趋势</strong>
            </div>
            <p className="dailyBriefSlogan">Business × AI · 让每个老板都拥有AI增长引擎</p>
          </header>

          <div className="dailyBriefShareActions">
            <button className="dailyBriefShareButton" type="button" onClick={shareTodayBrief}>分享今日摘要</button>
            {onConsult && <button className="dailyBriefConsultButton" type="button" onClick={onConsult}>交给IP获客智能体</button>}
            <button className="dailyBriefMoreButton" type="button" onClick={toggleHistory}>
              {historyOpen ? "收起往期" : "更多往期日报"}
            </button>
            {shareNotice && <small className="dailyBriefShareNotice">{shareNotice}</small>}
          </div>

          {sections.map((section) => (
            <section className="dailyBriefSection" key={section.title}>
              <h3>{section.emoji} {section.title} <span>{section.items?.length ?? 0}条</span></h3>
              <div className="dailyBriefItemGrid">
                {(section.items ?? []).map((item) => (
                  <div className="dailyBriefItem" key={`${section.title}-${item.no}`}>
                    <small>#{item.no} {item.source}</small>
                    <h4>{item.title}</h4>
                    <p>{item.summary}</p>
                    <em>来源：{item.sourceLabel}</em>
                    <div className="dailyBriefComment">思潼点评：{item.sitongComment}</div>
                  </div>
                ))}
              </div>
            </section>
          ))}

          {report.content?.action && (
            <section className="dailyBriefAction">
              <span>今日可落地动作</span>
              <p>{report.content.action}</p>
            </section>
          )}
        </article>
      )}

      {historyOpen && (
        <aside className="dailyBriefHistory">
          <div className="dailyBriefHistoryHead">
            <h3>往期日报</h3>
            {historyBusy && <span>正在加载...</span>}
          </div>
          <div>
            {history.map((item) => (
              <button key={item.id} type="button" onClick={() => setReport(item)}>
                <strong>{formatDate(item.reportDate)}</strong>
                <span>第{item.issueNo}期 · {item.summary}</span>
              </button>
            ))}
          </div>
        </aside>
      )}
    </div>
  );
}

function formatDate(value: string) {
  const [year, month, day] = value.split("-");
  return `${year}年${Number(month)}月${Number(day)}日`;
}

function normalizeDailyBriefReport(report?: DailyBriefReport | null): DailyBriefReport {
  if (!report || !Array.isArray(report.content?.sections) || report.content.sections.length === 0) {
    return buildFallbackDailyBriefReport();
  }
  return {
    ...report,
    content: {
      ...report.content,
      sections: report.content.sections.map((section) => ({
        ...section,
        emoji: section.emoji || "•",
        items: Array.isArray(section.items) ? section.items : []
      })),
      trends: Array.isArray(report.content.trends) ? report.content.trends : []
    }
  };
}

function buildFallbackDailyBriefReport(): DailyBriefReport {
  const reportDate = new Date().toISOString().slice(0, 10);
  return {
    id: `fallback-daily-${reportDate}`,
    reportDate,
    issueNo: 1,
    title: "思潼AI日报",
    summary: "今天重点看三件事：大模型能力升级、AI产品进入工作流、企业落地开始看ROI。",
    markdown: "",
    publishedAt: new Date().toISOString(),
    content: {
      date: reportDate,
      weekday: "今日",
      issueNo: 1,
      headline: "今天重点看三件事：大模型能力升级、AI产品进入工作流、企业落地开始看ROI。",
      trends: ["大模型多模态", "企业AI工作台", "经营流程自动化"],
      action: "今天先选一个重复高频场景，整理10条真实问题和标准回答，让AI生成一版可检查、可复制、可培训的话术。",
      sections: [
        buildFallbackSection("模型动态", "🧠", 0),
        buildFallbackSection("产品发布", "🚀", 3),
        buildFallbackSection("行业风云", "🏭", 6),
        buildFallbackSection("企业改造案例", "🏢", 9),
        buildFallbackSection("趋势洞察", "🔮", 12)
      ]
    }
  };
}

function buildFallbackSection(title: string, emoji: string, start: number): DailyBriefSection {
  return {
    title,
    emoji,
    items: [1, 2, 3].map((offset) => ({
      no: start + offset,
      source: "思潼观察",
      title: `${title}：AI正在进入真实经营动作`,
      summary: "这条动态说明AI正在从单点工具变成企业流程能力。老板真正要关注的是它能不能进入获客、销售、客服、交付和管理动作。",
      sourceLabel: "系统离线日报",
      sitongComment: "不要只看热闹。先选一个重复场景试跑，再看是否能降本、提效、沉淀标准流程。"
    }))
  };
}

async function readDailyBriefJson<T>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    throw new Error("AI日报暂时没有加载成功，请稍后重试。");
  }
}

const DAILY_BRIEF_LOADING_STEPS = [
  { title: "读取今日线索", detail: "正在抓取今日 AI 行业变化和企业应用进展。" },
  { title: "筛选老板该看的内容", detail: "保留和经营、获客、交付、效率有关的信息。" },
  { title: "生成思潼解读", detail: "把技术变化转成机会、风险和今天能做的动作。" }
];

function DailyBriefLoadingPanel() {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const activeIndex = Math.min(Math.floor(elapsed / 2), DAILY_BRIEF_LOADING_STEPS.length - 1);
  const progress = Math.min(88, 28 + elapsed * 12);

  return (
    <div className="dailyBriefLoadingPanel" role="status" aria-live="polite">
      <div className="dailyBriefLoadingHeader">
        <div>
          <span>思潼AI日报</span>
          <strong>{DAILY_BRIEF_LOADING_STEPS[activeIndex].title}</strong>
          <p>{DAILY_BRIEF_LOADING_STEPS[activeIndex].detail}</p>
        </div>
        <small>马上好</small>
      </div>
      <div className="dailyBriefLoadingProgress" aria-hidden="true">
        <i style={{ width: `${progress}%` }} />
      </div>
      <div className="dailyBriefLoadingSteps">
        {DAILY_BRIEF_LOADING_STEPS.map((step, index) => (
          <div
            className={index === activeIndex ? "active" : index < activeIndex ? "done" : ""}
            key={step.title}
          >
            <b>{index + 1}</b>
            <span>{step.title}</span>
          </div>
        ))}
      </div>
      {elapsed >= 6 && (
        <p className="dailyBriefLoadingHint">
          今天内容较多，先展示核心日报；往期内容可点“更多往期日报”查看。
        </p>
      )}
    </div>
  );
}

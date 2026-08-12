import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useState } from "react";

export interface LiveReviewTurn {
  question: string;
  answer?: string;
}

interface Props {
  busy: boolean;
  questionResult?: string;
  dataResult?: string;
  turns: LiveReviewTurn[];
  onBackToMap: () => void;
  onAsk: (question: string) => void;
  onUploadData: () => void;
}

export function LiveReviewWorkbench({ busy, questionResult, dataResult, turns, onBackToMap, onAsk, onUploadData }: Props) {
  const [question, setQuestion] = useState("");
  return <div className="liveReviewWorkbench">
    <header className="topicSystemHero liveReviewHero">
      <div><button type="button" onClick={onBackToMap}>← 返回工作地图</button><span>LIVE PERFORMANCE REVIEW SYSTEM</span><h2>直播复盘系统</h2><p>简单问题先给可执行的复盘建议；上传直播后台数据后，按真实指标完成专业复盘。没有数据时不伪造场观、转化、话术表现或成交结论。</p></div>
      <aside><strong>复</strong><span>直播数据复盘</span><em>文字咨询 / 文件分析</em></aside>
    </header>
    <section className="liveReviewGrid" aria-label="直播复盘系统操作区">
      <article className="liveReviewCard">
        <header><span>01</span><div><strong>直播复盘问题咨询</strong><small>针对流量、停留、互动、转化或话术执行，直接问一个具体问题。</small></div></header>
        <textarea value={question} onChange={(event) => setQuestion(event.target.value)} rows={8} placeholder="例如：直播间进人不少但停留很短，通常先排查哪些问题？怎么判断是流量问题还是话术问题？" />
        <p>没有后台数据时，回答判断方法、排查顺序和应补的关键指标；不会把通用建议说成你的直播结论。</p>
        <button type="button" disabled={busy || !question.trim()} onClick={() => onAsk(question.trim())}>{busy ? "正在分析…" : "获取复盘建议"}</button>
      </article>
      <article className="liveReviewCard">
        <header><span>02</span><div><strong>上传直播后台数据</strong><small>上传平台导出的 CSV 或 Excel，生成专业直播复盘建议。</small></div></header>
        <div className="liveReviewDataHint"><b>数据</b><strong>上传直播后台数据文件</strong><span>建议包含场观、曝光/进房、在线峰值、平均停留、互动、商品点击、成交/订单、私信或留资等字段。</span></div>
        <p>系统会先审计字段、统计周期和数据口径，再输出流量诊断、转化归因、互动诊断、人货场判断与下一场调整清单。</p>
        <button type="button" className="secondary" disabled={busy} onClick={onUploadData}>{busy ? "当前任务处理中…" : "选择数据文件，自动开始复盘"}</button>
        <p>选择文件后会立即读取并自动提交，不需要到其他对话框再发送。</p>
      </article>
    </section>
    {turns.length > 0 && <section className="systemDialoguePanel" aria-label="直播复盘系统对话记录"><header><span>问</span><div><strong>直播复盘对话记录</strong><small>每轮只围绕直播数据、流量、互动、转化或话术执行微调，不串到内容创作或投流系统。</small></div></header><div className="systemDialogueHistory">{turns.map((turn, index) => <article key={`${turn.question}-${index}`}><b>你的问题</b><p>{turn.question}</p>{turn.answer && <><b>直播复盘建议</b><div><ReactMarkdown remarkPlugins={[remarkGfm]}>{turn.answer}</ReactMarkdown></div></>}</article>)}</div></section>}
    {(questionResult || dataResult) && <section className="liveReviewOutput" aria-live="polite"><header><span>LIVE REVIEW OUTPUT</span><h3>{dataResult ? "本次专业直播复盘" : "最新直播复盘建议"}</h3></header><div className="topicSystemMarkdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{dataResult || questionResult || ""}</ReactMarkdown></div></section>}
  </div>;
}

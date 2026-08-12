import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useState } from "react";

interface Props {
  busy: boolean;
  questionResult?: string;
  dataResult?: string;
  uploadStatus?: string;
  onBackToMap: () => void;
  onAsk: (question: string) => void;
  onUploadData: () => void;
  onStop: () => void;
}

export function VideoReviewWorkbench({ busy, questionResult, dataResult, uploadStatus, onBackToMap, onAsk, onUploadData, onStop }: Props) {
  const [question, setQuestion] = useState("");

  return <div className="videoReviewWorkbench">
    <header className="topicSystemHero videoReviewHero">
      <div>
        <button type="button" onClick={onBackToMap}>← 返回工作地图</button>
        <span>VIDEO PERFORMANCE REVIEW SYSTEM</span>
        <h2>视频复盘系统</h2>
        <p>先问清一个视频数据问题，或上传平台后台数据文件做专业复盘；只根据真实数据得出结论，不把内容创作、拍剪或投流方案混在一起。</p>
      </div>
      <aside><strong>复</strong><span>短视频数据复盘</span><em>文字咨询 / 文件分析</em></aside>
    </header>

    <section className="videoReviewGrid" aria-label="视频复盘系统操作区">
      <article className="videoReviewCard reviewQuestionCard">
        <header><span>01</span><div><strong>视频复盘问题咨询</strong><small>简单问一个指标、现象或复盘方法，先获得清晰的文字答复。</small></div></header>
        <label>你想了解什么？
          <textarea value={question} onChange={(event) => setQuestion(event.target.value)} rows={8} placeholder="例如：完播率和平均播放时长分别说明什么？一条视频播放高但关注低，下一步先排查什么？" />
        </label>
        <p>没有上传数据时，只回答通用方法和判断逻辑；涉及“我的视频为什么不好”时，系统会明确告诉你需要补哪些真实指标。</p>
        <button type="button" disabled={busy || !question.trim()} onClick={() => onAsk(question.trim())}>{busy ? "正在分析…" : "获取文字答复"}</button>
      </article>

      <article className="videoReviewCard reviewDataCard">
        <header><span>02</span><div><strong>上传视频数据做专业复盘</strong><small>读取平台后台导出的作品数据，逐条核对后生成专业复盘报告。</small></div></header>
        <div className="reviewDataDropHint"><b>数据</b><strong>上传 CSV 或 Excel 数据文件</strong><span>建议包含：作品标题、发布时间、播放、完播率或平均播放时长、点赞评论分享、关注和主页访问等字段。</span></div>
        <p>系统会先检查字段、周期和数据质量，再输出表现分层、关键问题、原因判断、下一轮选题方向与待补数据；不会编造视频内容或效果。</p>
        <button type="button" className="secondary" disabled={busy} onClick={onUploadData}>{busy ? "当前任务处理中…" : "上传数据并开始专业复盘"}</button>
        {uploadStatus && <div className="videoReviewUploadStatus" role="status">{uploadStatus}</div>}
        {busy && <button type="button" className="videoReviewStopButton" onClick={onStop}>停止本次处理并重新上传</button>}
      </article>
    </section>

    {(questionResult || dataResult) && <section className="videoReviewOutput" aria-live="polite">
      <header><span>VIDEO REVIEW OUTPUT</span><h3>{dataResult ? "本次专业复盘报告" : "视频复盘文字答复"}</h3></header>
      <div className="topicSystemMarkdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{dataResult || questionResult || ""}</ReactMarkdown></div>
    </section>}
  </div>;
}

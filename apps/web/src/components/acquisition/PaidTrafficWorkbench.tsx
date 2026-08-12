import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export type TrafficMode = "auto" | "dou_plus_traffic" | "paid_traffic";

interface Props {
  busy: boolean;
  questionResult?: string;
  dataResult?: string;
  videoResult?: string;
  uploadStatus?: string;
  onBackToMap: () => void;
  onAsk: (question: string, mode: TrafficMode) => void;
  onReviewData: (mode: TrafficMode) => void;
  onPlanVideo: (videoContext: string, mode: TrafficMode) => void;
  onStop: () => void;
}

const modeLabels: Record<TrafficMode, string> = {
  auto: "AI 判断",
  dou_plus_traffic: "DOU+",
  paid_traffic: "巨量本地推"
};

export function PaidTrafficWorkbench({ busy, questionResult, dataResult, videoResult, uploadStatus, onBackToMap, onAsk, onReviewData, onPlanVideo, onStop }: Props) {
  const [mode, setMode] = useState<TrafficMode>("auto");
  const [question, setQuestion] = useState("");
  const [videoContext, setVideoContext] = useState("");

  return <div className="paidTrafficWorkbench">
    <header className="topicSystemHero paidTrafficHero">
      <div>
        <button type="button" onClick={onBackToMap}>← 返回工作地图</button>
        <span>PAID TRAFFIC DECISION SYSTEM</span>
        <h2>投流系统</h2>
        <p>围绕投流问题、真实投放数据和单条视频做判断；只生成投放建议与预览，不会操作广告账户。</p>
      </div>
      <aside><strong>{mode === "auto" ? "AI" : mode === "dou_plus_traffic" ? "D+" : "本推"}</strong><span>本轮投放工具</span><em>{modeLabels[mode]}</em></aside>
    </header>

    <section className="trafficModePicker" aria-label="选择投放工具">
      {(Object.keys(modeLabels) as TrafficMode[]).map((item) => <button key={item} type="button" className={mode === item ? "active" : ""} onClick={() => setMode(item)}>
        <strong>{modeLabels[item]}</strong>
        <small>{item === "auto" ? "根据目标、地域、承接和数据选工具" : item === "dou_plus_traffic" ? "内容加热、互动与账号验证" : "到店、交易、线索及本地生活承接"}</small>
      </button>)}
    </section>

    <section className="paidTrafficGrid" aria-label="投流系统操作区">
      <article className="paidTrafficCard trafficQuestionCard">
        <header><span>01</span><div><strong>投流问题问答</strong><small>描述现状和目标，获得平台选择、预算、素材与止损建议。</small></div></header>
        <textarea value={question} onChange={(event) => setQuestion(event.target.value)} rows={7} placeholder="例如：抖音一条视频自然播放 8,000，想获取企业客户咨询，预算上限 500 元，适合投 DOU+ 还是本地推？" />
        <p>建议补充：业务目标、承接动作、地域、待投视频/账号、自然数据、预算上限。</p>
        <button type="button" disabled={busy || !question.trim()} onClick={() => onAsk(question.trim(), mode)}>{busy ? "正在分析…" : "获取投流建议"}</button>
      </article>

      <article className="paidTrafficCard trafficDataCard">
        <header><span>02</span><div><strong>上传投放数据复盘</strong><small>上传 CSV、Excel、截图或投放报表，读取真实指标后给下一轮建议。</small></div></header>
        <div className="trafficUploadHint"><b>数据</b><strong>消耗、曝光、点击、转化、成本、地域、素材均可上传</strong><span>系统先核对字段、周期和口径；缺少转化数据会明确指出，不会编造结论。</span></div>
        <button type="button" className="secondary" disabled={busy} onClick={() => onReviewData(mode)}>{busy ? "当前任务处理中…" : "上传投放数据并复盘"}</button>
        {uploadStatus && <div className={`trafficUploadStatus ${busy ? "working" : ""}`} role="status" aria-live="polite"><span>{uploadStatus}</span>{busy && <button type="button" onClick={onStop}>停止并重新上传</button>}</div>}
      </article>

      <article className="paidTrafficCard trafficVideoCard">
        <header><span>03</span><div><strong>单条视频投放决策</strong><small>针对一条待投视频，判断是否适合投、选 DOU+ 还是本地推，并给具体预览。</small></div></header>
        <textarea value={videoContext} onChange={(event) => setVideoContext(event.target.value)} rows={7} placeholder="粘贴视频链接或描述视频内容，并说明希望获得播放互动、私信留资、到店交易或其他结果。" />
        <p>输出会分为「DOU+投放建议」和「本地推投放建议」；不适用的一侧会明确说明原因。</p>
        <button type="button" disabled={busy || !videoContext.trim()} onClick={() => onPlanVideo(videoContext.trim(), mode)}>{busy ? "正在判断…" : "生成单视频投放建议"}</button>
      </article>
    </section>

    {(questionResult || dataResult || videoResult) && <section className="paidTrafficOutputs" aria-live="polite">
      {dataResult && <article className="paidTrafficOutput primary"><header><span>DATA REVIEW</span><h3>投放数据复盘结果</h3></header><div className="topicSystemMarkdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{dataResult}</ReactMarkdown></div></article>}
      {questionResult && <article className="paidTrafficOutput"><header><span>TRAFFIC ADVICE</span><h3>投流问题建议</h3></header><div className="topicSystemMarkdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{questionResult}</ReactMarkdown></div></article>}
      {videoResult && <article className="paidTrafficOutput"><header><span>VIDEO PLAN</span><h3>单条视频投放决策</h3></header><div className="topicSystemMarkdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{videoResult}</ReactMarkdown></div></article>}
    </section>}
  </div>;
}

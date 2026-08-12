import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useState } from "react";

export interface IpPositioningTurn {
  question: string;
  answer?: string;
}

interface Props {
  busy: boolean;
  knowledgeDocumentCount: number;
  result?: string;
  interview?: string;
  turns: IpPositioningTurn[];
  onBackToMap: () => void;
  onOpenKnowledge: () => void;
  onGenerate: () => void;
  onStop: () => void;
  onAsk: (question: string) => void;
}

export function IpPositioningWorkbench({ busy, knowledgeDocumentCount, result, interview, turns, onBackToMap, onOpenKnowledge, onGenerate, onStop, onAsk }: Props) {
  const [question, setQuestion] = useState("");
  const interviewing = Boolean(interview && !result);

  return <div className="ipPositioningWorkbench">
    <header className="topicSystemHero ipPositioningHero">
      <div>
        <button type="button" onClick={onBackToMap}>← 返回工作地图</button>
        <span>IP POSITIONING SYSTEM</span>
        <h2>IP定位系统</h2>
        <p>先以企业知识库中已确认的资料建立完整IP定位方案，再把定位作为选题与直播系统的共同起点；缺少的事实会明确标为待确认，不会被编造成定位结论。</p>
      </div>
      <aside><strong>{knowledgeDocumentCount}</strong><span>已选知识库资料</span><button type="button" onClick={onOpenKnowledge}>管理知识库</button></aside>
    </header>

    <section className="ipPositioningGrid" aria-label="IP定位系统操作区">
      <article className="ipPositioningCard">
        <header><span>01</span><div><strong>根据知识库生成IP定位方案</strong><small>一键读取本任务已选资料与已确认企业信息，只生成可执行的IP定位方案。</small></div></header>
        <div className={`liveKnowledgeStatus ${knowledgeDocumentCount > 0 ? "ready" : "empty"}`}>
          <b>{knowledgeDocumentCount > 0 ? "知" : "待"}</b>
          <div><strong>{knowledgeDocumentCount > 0 ? `已选择 ${knowledgeDocumentCount} 条知识库资料` : "尚未选择知识库资料"}</strong><span>{knowledgeDocumentCount > 0 ? "将优先使用已确认的企业、IP、客户项目、产品、案例与表达资料。" : "请先选择至少一条与当前主体相关的资料。这样才能生成有依据的定位方案，而不是泛泛的模板。"}</span></div>
          <button type="button" className="secondary" onClick={onOpenKnowledge}>选择资料</button>
        </div>
        <ul className="ipPositioningCoverage"><li>项目与用户定位</li><li>IP人设与表达边界</li><li>内容定位与选题方向</li><li>增长路径与执行建议</li></ul>
        <div className="ipPositioningActions">
          <button type="button" disabled={busy} onClick={knowledgeDocumentCount > 0 ? onGenerate : onOpenKnowledge}>{busy ? "正在生成IP定位方案..." : knowledgeDocumentCount > 0 ? "一键生成IP定位方案" : "先选择资料再生成"}</button>
          {busy && <button type="button" className="secondary" onClick={onStop}>停止本次生成</button>}
        </div>
      </article>

      <article className="ipPositioningCard">
        <header><span>02</span><div><strong>{interviewing ? "继续IP定位访谈" : "通过对话调整定位"}</strong><small>{interviewing ? "先回答当前这一轮的一个问题；系统会确认后再追问下一项关键事实。" : "明确想调整的章节、对象或表达方向，系统只改动对应的定位内容。"}</small></div></header>
        <textarea value={question} onChange={(event) => setQuestion(event.target.value)} rows={8} placeholder={interviewing ? "请只补充上方这一轮问题对应的真实信息，例如创始人的经历、目标或当前账号情况。" : "例如：把目标用户从创业者改成连锁品牌老板；我的IP定位更强调AI落地，不要写成泛泛的培训老师；重写内容定位和前三个月的选题方向。"} />
        <p>{interviewing ? "资料尚未覆盖完整定位维度，当前不是全案修改。补充后系统每轮只问一个关键问题，资料充分才生成完整全案。" : "可以修改项目定位、目标用户、IP人设、内容方向、增长路径或执行建议。未确认的事实会保留【待确认】。"}</p>
        <button type="button" disabled={busy || !question.trim()} onClick={() => { onAsk(question.trim()); setQuestion(""); }}>{busy ? (interviewing ? "正在继续访谈..." : "正在调整...") : (interviewing ? "提交本轮信息" : "发送定位修改要求")}</button>
      </article>
    </section>

    {interview && !result && <section className="ipPositioningInterview" aria-live="polite"><header><span>IP POSITIONING INTERVIEW</span><h3>定位访谈 · 还差 1 个关键信息</h3><p>当前资料不足以形成完整全案。请先回答下面这一轮问题；系统不会把访谈内容伪装成定位报告。</p></header><div className="ipPositioningInterviewBody"><ReactMarkdown remarkPlugins={[remarkGfm]}>{interview}</ReactMarkdown></div></section>}
    {result && <section className="ipPositioningOutput" aria-live="polite"><header><span>IP POSITIONING OUTPUT</span><h3>完整IP定位方案</h3><p>本区只展示通过 IP 定位完整结构校验的内容，不混入访谈、选题、文案、投流或复盘结果。</p></header><div className="ipPositioningReport"><ReactMarkdown remarkPlugins={[remarkGfm]}>{result}</ReactMarkdown></div></section>}
    {turns.length > 0 && <section className="ipPositioningConversation" aria-live="polite"><header><span>IP POSITIONING DIALOGUE</span><h3>定位修改记录</h3></header><div>{turns.map((turn, index) => <article key={`${turn.question}-${index}`}><div className="liveUserTurn"><small>你的修改要求</small><p>{turn.question}</p></div>{turn.answer && <div className="liveAssistantTurn"><small>定位全案调整</small><ReactMarkdown remarkPlugins={[remarkGfm]}>{turn.answer}</ReactMarkdown></div>}</article>)}</div></section>}
  </div>;
}

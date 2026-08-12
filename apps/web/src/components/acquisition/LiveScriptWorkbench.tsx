import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useState } from "react";

export interface LiveScriptTurn {
  question: string;
  answer?: string;
}

interface Props {
  busy: boolean;
  knowledgeDocumentCount: number;
  scriptResult?: string;
  turns: LiveScriptTurn[];
  onBackToMap: () => void;
  onOpenKnowledge: () => void;
  onGenerate: () => void;
  onAsk: (question: string) => void;
  onStop: () => void;
}

export function LiveScriptWorkbench({ busy, knowledgeDocumentCount, scriptResult, turns, onBackToMap, onOpenKnowledge, onGenerate, onAsk, onStop }: Props) {
  const [question, setQuestion] = useState("");

  return <div className="liveScriptWorkbench">
    <header className="topicSystemHero liveScriptHero">
      <div>
        <button type="button" onClick={onBackToMap}>← 返回工作地图</button>
        <span>LIVE CONVERSION SCRIPT SYSTEM</span>
        <h2>直播系统</h2>
        <p>从本任务已经确认的知识库资料生成直播话术；生成后可围绕任一环节继续沟通、修改和补写，不会混入短视频文案或直播数据复盘。</p>
      </div>
      <aside><strong>{knowledgeDocumentCount}</strong><span>已选知识库资料</span><button type="button" onClick={onOpenKnowledge}>管理知识库</button></aside>
    </header>

    <section className="liveScriptGrid" aria-label="直播系统操作区">
      <article className="liveScriptCard liveGenerateCard">
        <header><span>01</span><div><strong>根据知识库生成直播话术</strong><small>一键读取本任务已选资料和已确认企业信息，生成可照读、可执行的直播话术。</small></div></header>
        <div className={`liveKnowledgeStatus ${knowledgeDocumentCount > 0 ? "ready" : "empty"}`}>
          <b>{knowledgeDocumentCount > 0 ? "知识" : "待选"}</b>
          <div><strong>{knowledgeDocumentCount > 0 ? `已选 ${knowledgeDocumentCount} 条知识库资料` : "尚未手动选择知识库资料"}</strong><span>{knowledgeDocumentCount > 0 ? "会自动带入已确认的产品、受众、案例、表达边界与业务目标。" : "可先选择资料；未提供的价格、福利、案例和政策不会被系统编造。"}</span></div>
          <button type="button" className="secondary" onClick={onOpenKnowledge}>选择资料</button>
        </div>
        <ul className="liveScriptCoverage"><li>开场与留人</li><li>互动与价值讲解</li><li>咨询转化与异议回应</li><li>收口及下播跟进</li></ul>
        <button type="button" disabled={busy} onClick={onGenerate}>{busy ? "正在生成直播话术…" : "一键生成直播话术"}</button>
        {busy && <div className="liveScriptProgress" role="status" aria-live="polite">
          <strong>正在读取 {knowledgeDocumentCount} 条资料并调用直播话术 Skill</strong>
          <span>通常 30—70 秒完成；模型超时后会自动切换标准模板，不会一直等待。</span>
          <button type="button" onClick={onStop}>停止本次生成并重试</button>
        </div>}
      </article>

      <article className="liveScriptCard liveConsultCard">
        <header><span>02</span><div><strong>话术沟通与修改</strong><small>针对开场、留人、产品讲解、异议、转化或收口，像对话一样提出具体修改要求。</small></div></header>
        <textarea value={question} onChange={(event) => setQuestion(event.target.value)} rows={8} placeholder="例如：把开场改得更适合招商直播；客户问加盟费太贵时，帮我只重写这一段回应；把第 20 到 30 分钟的互动话术再具体一些。" />
        <p>只修改你点名的直播环节；缺少真实价格、福利、案例时会保留待确认，不会自行补造。</p>
        <button type="button" disabled={busy || !question.trim()} onClick={() => { onAsk(question.trim()); setQuestion(""); }}>{busy ? "请等待当前任务完成" : "发送修改要求"}</button>
      </article>
    </section>

    {scriptResult && <section className="liveScriptOutput" aria-live="polite"><header><span>LIVE SCRIPT OUTPUT</span><h3>本次直播话术</h3></header><div className="topicSystemMarkdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{scriptResult}</ReactMarkdown></div></section>}

    {turns.length > 0 && <section className="liveConversation" aria-live="polite">
      <header><span>LIVE SCRIPT DIALOGUE</span><h3>话术沟通记录</h3></header>
      <div>{turns.map((turn, index) => <article key={`${turn.question}-${index}`}>
        <div className="liveUserTurn"><small>你的修改要求</small><p>{turn.question}</p></div>
        {turn.answer && <div className="liveAssistantTurn"><small>直播话术调整</small><ReactMarkdown remarkPlugins={[remarkGfm]}>{turn.answer}</ReactMarkdown></div>}
      </article>)}</div>
    </section>}
  </div>;
}

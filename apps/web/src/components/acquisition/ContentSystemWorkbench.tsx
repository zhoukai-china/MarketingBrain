import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { apiPath } from "../../lib/api.js";
import { normalizeFilenamePart } from "../../lib/utils.js";
import { splitContentDelivery } from "./contentDelivery.js";

export interface ContentSystemTurn {
  question: string;
  answer?: string;
}

interface Props {
  busy: boolean;
  result?: string;
  videoResult?: string;
  turns: ContentSystemTurn[];
  headers: Record<string, string>;
  onGenerate: (topics: string[]) => void;
  onAsk: (question: string) => void;
  onUploadVideo: () => void;
  onBackToMap: () => void;
  onStop: () => void;
}

function parseTopics(value: string): string[] {
  return Array.from(new Set(value
    .split(/\r?\n|(?=\s*\d+[.、])/)
    .map((item) => item.replace(/^\s*\d+[.、]\s*/, "").trim())
    .filter(Boolean)))
    .slice(0, 10);
}

async function downloadContentDocx(content: string, headers: Record<string, string>, setDownloading: (value: boolean) => void): Promise<void> {
  setDownloading(true);
  try {
    const response = await fetch(apiPath("/exports/docx"), {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "内容系统-完整内容执行包", content })
    });
    const data = (await response.json().catch(() => ({}))) as { downloadUrl?: string; filename?: string; message?: string };
    if (!response.ok || !data.downloadUrl) throw new Error(data.message || "Word 文件生成失败");
    const anchor = document.createElement("a");
    anchor.href = apiPath(data.downloadUrl);
    anchor.download = data.filename || `${normalizeFilenamePart("内容系统-完整内容执行包")}.docx`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } catch (error) {
    console.error("Content document export failed", error);
    window.alert("Word 文件生成失败，请稍后再试。");
  } finally {
    setDownloading(false);
  }
}

export function ContentSystemWorkbench({ busy, result, videoResult, turns, headers, onGenerate, onAsk, onUploadVideo, onBackToMap, onStop }: Props) {
  const [topicText, setTopicText] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [question, setQuestion] = useState("");
  const [replicationOpen, setReplicationOpen] = useState(false);
  const [referenceVideoUrl, setReferenceVideoUrl] = useState("");
  const [portraitImageUrl, setPortraitImageUrl] = useState("");
  const [referenceFileId, setReferenceFileId] = useState("");
  const [portraitFileId, setPortraitFileId] = useState("");
  const [referenceFileName, setReferenceFileName] = useState("");
  const [portraitFileName, setPortraitFileName] = useState("");
  const [uploadingAsset, setUploadingAsset] = useState("");
  const [replicationModel, setReplicationModel] = useState<"aliyun_strict" | "seedance_creative">("aliyun_strict");
  const [rights, setRights] = useState({ visual: false, audio: false, performer: false, portrait: false });
  const [replicationNotice, setReplicationNotice] = useState("");
  const [replicationQuote, setReplicationQuote] = useState<{ canConfirm?: boolean; creditCost?: number | null; message?: string } | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [submittingReplication, setSubmittingReplication] = useState(false);
  const [replicationRequestKey, setReplicationRequestKey] = useState(() => crypto.randomUUID());
  const topics = useMemo(() => parseTopics(topicText), [topicText]);
  const delivery = useMemo(() => result ? splitContentDelivery(result) : undefined, [result]);
  const contentReady = Boolean(result?.trim());
  const replicationPayload = () => ({
    referenceVideoUrl: referenceVideoUrl.trim() || undefined,
    portraitImageUrl: portraitImageUrl.trim() || undefined,
    referenceFileId: referenceFileId || undefined,
    portraitFileId: portraitFileId || undefined,
    requestKey: replicationRequestKey,
    model: replicationModel,
    visualRightsConfirmed: rights.visual,
    audioRightsConfirmed: rights.audio,
    performerConsentConfirmed: rights.performer,
    portraitConsentConfirmed: rights.portrait
  });
  async function requestReplicationQuote(): Promise<void> {
    setQuoting(true); setReplicationNotice(""); setReplicationQuote(null);
    try {
      const response = await fetch(apiPath("/viral-video-replication/quote"), { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(replicationPayload()) });
      const data = await response.json().catch(() => ({})) as { message?: string; canConfirm?: boolean; creditCost?: number | null };
      if (!response.ok) throw new Error(data.message || "报价校验失败");
      setReplicationQuote(data); setReplicationNotice(data.message || "报价已生成");
    } catch (error) { setReplicationNotice(error instanceof Error ? error.message : "报价校验失败"); }
    finally { setQuoting(false); }
  }
  async function uploadReplicationAsset(kind: "reference" | "portrait", file: File | undefined): Promise<void> {
    if (!file) return;
    setUploadingAsset(kind); setReplicationNotice("");
    try {
      const form = new FormData(); form.append("file", file);
      const response = await fetch(apiPath("/files"), { method: "POST", headers, body: form });
      const data = await response.json().catch(() => ({})) as { file?: { id?: string }; message?: string };
      if (!response.ok || !data.file?.id) throw new Error(data.message || "素材上传失败");
      if (kind === "reference") { setReferenceFileId(data.file.id); setReferenceFileName(file.name); }
      else { setPortraitFileId(data.file.id); setPortraitFileName(file.name); }
    } catch (error) { setReplicationNotice(error instanceof Error ? error.message : "素材上传失败"); }
    finally { setUploadingAsset(""); }
  }
  async function confirmReplication(): Promise<void> {
    setSubmittingReplication(true); setReplicationNotice("");
    try {
      const response = await fetch(apiPath("/viral-video-replication/confirm"), { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(replicationPayload()) });
      const data = await response.json().catch(() => ({})) as { job?: { id?: string; status?: string }; message?: string };
      if (!response.ok) throw new Error(data.message || "创建任务失败");
      setReplicationNotice(`任务 ${data.job?.id || ""} 已提交，当前状态：${data.job?.status || "submitted"}。`); setReplicationRequestKey(crypto.randomUUID()); setReplicationQuote(null);
    } catch (error) { setReplicationNotice(error instanceof Error ? error.message : "创建任务失败"); }
    finally { setSubmittingReplication(false); }
  }

  return <div className="contentSystemWorkbench">
    <header className="topicSystemHero contentSystemHero">
      <div>
        <button type="button" onClick={onBackToMap}>← 返回工作地图</button>
        <span>CONTENT PRODUCTION SYSTEM</span>
        <h2>内容系统</h2>
        <p>粘贴选题后直接生成可执行内容；上传视频后只做拍摄与剪辑优化，不混入其他系统。</p>
      </div>
      <aside><strong>{topics.length}<small>/10</small></strong><span>本次待生产选题</span><em>{topics.length ? "已识别选题" : "粘贴一个或多个选题"}</em></aside>
    </header>

    <section className="contentSystemGrid" aria-label="内容系统操作区">
      <article className="contentSystemCard contentGenerateCard">
        <header><span>01</span><div><strong>选题生成完整内容</strong><small>每行一个选题，可一次粘贴多个；每条选题独立产出，不串题。</small></div></header>
        <label>本次要创作的选题
          <textarea value={topicText} onChange={(event) => setTopicText(event.target.value)} rows={10} placeholder={"例如：\n1. 企业做 AI 改造，为什么先别急着买工具？\n2. 连锁品牌做 IP，内容为什么总是像广告？"} />
        </label>
        <p>将按完整内容执行包输出：选题策划、口播逐字稿、拍摄、剪辑、发布与投流动作。</p>
        <div className="contentGenerationActions">
          <button type="button" disabled={busy || topics.length === 0} onClick={() => onGenerate(topics)}>{busy ? "正在生成完整内容…" : `生成 ${topics.length || ""} 条内容`}</button>
          {busy && <button type="button" className="secondary contentStopButton" onClick={onStop}>停止生成</button>}
        </div>
        {busy && <p className="contentGenerationStatus" role="status">正在一次生成完整内容执行包；已跳过二次模型返工，可随时停止本次生成。</p>}
      </article>

      <article className={`contentSystemCard videoOptimizeCard ${contentReady ? "ready" : "independent"}`}>
        <header><span>02</span><div><strong>上传成片，做拍剪复盘</strong><small>可按左侧文案拍摄后上传；已有成片时，也可直接上传分析。</small></div></header>
        <div className="contentVideoDropHint"><b>视频</b><strong>{busy ? "正在处理当前任务，请稍候上传" : contentReady ? "可结合本次文案，开始 AI 拍剪复盘" : "已有成片？可直接上传 AI 分析"}</strong><span>{contentReady ? "AI 会对照本次文案和真实画面、口播、字幕给出优化建议。" : "无需先生成文案；AI 会仅根据视频实际画面、口播和字幕分析，缺少的证据会明确标注。"}</span></div>
        <button type="button" className="secondary" disabled={busy} onClick={onUploadVideo}>{busy ? "当前任务处理中…" : contentReady ? "上传成片，开始拍剪复盘" : "直接上传视频分析"}</button>
      </article>

      <article className="contentSystemCard viralReplicationCard">
        <header><span>03</span><div><strong>爆款复刻</strong><small>在已授权的原视频基础上，严格替换本人或已授权主角。</small></div></header>
        <div className="contentVideoDropHint"><b>复刻</b><strong>保留场景、动作、节奏与授权原音频</strong><span>仅支持授权原文件或 HTTPS 文件直链；不读取抖音、小红书等播放页。</span></div>
        <button type="button" disabled={busy} onClick={() => setReplicationOpen(true)}>创建爆款复刻任务</button>
      </article>
    </section>

    {replicationOpen && <div className="viralReplicationOverlay" role="dialog" aria-modal="true" aria-label="爆款复刻任务">
      <section className="viralReplicationPanel">
        <button type="button" className="viralReplicationClose" onClick={() => setReplicationOpen(false)} aria-label="关闭">×</button>
        <span>VIRAL REPLICATION</span><h3>爆款复刻任务</h3>
        <p>严格复刻只替换主角；原视频、原音频、原主角肖像与替换照片均须已获得授权。成片将带 AI 标识与审计记录。</p>
        <label>原视频 HTTPS 文件直链<input value={referenceVideoUrl} onChange={(event) => setReferenceVideoUrl(event.target.value)} placeholder="https://.../authorized-source.mp4" /></label>
        <label className="viralFileInput">或上传已授权原视频<input type="file" accept="video/mp4,video/quicktime,video/webm,.m4v" onChange={(event) => void uploadReplicationAsset("reference", event.target.files?.[0])} /> <small>{uploadingAsset === "reference" ? "上传中…" : referenceFileName || "MP4、MOV、M4V、WebM"}</small></label>
        <label>本人/已授权主角照片 HTTPS 文件直链<input value={portraitImageUrl} onChange={(event) => setPortraitImageUrl(event.target.value)} placeholder="https://.../authorized-portrait.jpg" /></label>
        <label className="viralFileInput">或上传本人/已授权主角照片<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void uploadReplicationAsset("portrait", event.target.files?.[0])} /> <small>{uploadingAsset === "portrait" ? "上传中…" : portraitFileName || "JPG、PNG、WebP"}</small></label>
        <label>生成模式<select value={replicationModel} onChange={(event) => setReplicationModel(event.target.value as "aliyun_strict" | "seedance_creative")}><option value="aliyun_strict">阿里云｜严格复刻（当前可接入）</option><option value="seedance_creative">Seedance 2.0｜创意复刻（暂未开放）</option></select></label>
        <div className="viralRights">{([ ["visual", "我拥有原视频画面及改编使用权"], ["audio", "我拥有原音频/音乐的使用权"], ["performer", "原视频主角已单独同意被替换"], ["portrait", "替换照片本人/主角已授权使用"] ] as const).map(([key, label]) => <label key={key}><input type="checkbox" checked={rights[key]} onChange={(event) => setRights((current) => ({ ...current, [key]: event.target.checked }))} />{label}</label>)}</div>
        <div className="viralReplicationActions"><button type="button" disabled={quoting} onClick={() => void requestReplicationQuote()}>{quoting ? "正在校验…" : "生成报价与可执行性检查"}</button>{replicationQuote?.canConfirm && <button type="button" className="secondary" disabled={submittingReplication} onClick={() => void confirmReplication()}>{submittingReplication ? "正在提交…" : "确认并创建任务"}</button>}</div>
        {replicationQuote && <p className="viralQuote">{replicationQuote.creditCost ? `预计 ${replicationQuote.creditCost} 积分，确认后才扣减。` : "尚未配置供应商计费，不能扣费。"}</p>}
        {replicationNotice && <p className="viralNotice" role="status">{replicationNotice}</p>}
      </section>
    </div>}

    {result && <section className="topicSystemResult contentSystemResult" aria-live="polite">
      <header className="contentDeliveryHeader"><div><span>CONTENT OUTPUT</span><h3>完整内容执行包</h3><small>每个模块可直接用于拍摄、发布与承接。</small></div><button type="button" className="secondary" disabled={downloading} onClick={() => void downloadContentDocx(result, headers, setDownloading)}>{downloading ? "正在生成 Word…" : "下载 Word"}</button></header>
      {delivery && delivery.sections.length > 0 ? <div className="contentDeliveryLayout">
        {delivery.preface.length > 0 && <div className="contentDeliveryPreface"><ReactMarkdown remarkPlugins={[remarkGfm]}>{delivery.preface.join("\n")}</ReactMarkdown></div>}
        <div className="contentDeliveryCards">{delivery.sections.map((section, index) => <article key={`${section.title}-${index}`} className={`contentDeliveryCard section-${index + 1}`}><header><span>{String(index + 1).padStart(2, "0")}</span><h4>{section.title}</h4></header><div><ReactMarkdown remarkPlugins={[remarkGfm]}>{section.lines.join("\n")}</ReactMarkdown></div></article>)}</div>
      </div> : <div className="topicSystemMarkdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{result}</ReactMarkdown></div>}
    </section>}
    {videoResult && <section className="topicSystemResult contentSystemResult videoReviewResult" aria-live="polite">
      <header><span>VIDEO REVIEW</span><h3>本条成片的拍剪优化建议</h3><small>仅基于本次上传的视频解析、口播和字幕生成。</small></header>
      <div className="topicSystemMarkdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{videoResult}</ReactMarkdown></div>
    </section>}
    <section className="systemDialoguePanel" aria-label="内容系统对话微调">
      <header><span>对话</span><div><strong>内容系统对话微调</strong><p>可只修改其中一个选题、一段口播、拍摄脚本或发布动作，不会重做无关系统。</p></div></header>
      {turns.length > 0 && <div className="systemDialogueHistory">{turns.map((turn, index) => <article key={`${turn.question}-${index}`}><b>你</b><p>{turn.question}</p>{turn.answer && <><b>内容系统</b><div><ReactMarkdown remarkPlugins={[remarkGfm]}>{turn.answer}</ReactMarkdown></div></>}</article>)}</div>}
      <textarea rows={4} value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="例如：只把第 2 条的开场改得更有冲突；口播保留我的表达习惯；把拍摄脚本改成办公室场景。" />
      <button type="button" disabled={busy || !question.trim()} onClick={() => { onAsk(question.trim()); setQuestion(""); }}>{busy ? "正在调整…" : "发送内容修改要求"}</button>
    </section>
  </div>;
}

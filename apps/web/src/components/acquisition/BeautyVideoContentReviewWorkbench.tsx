import { useRef, useState } from "react";

export const BEAUTY_VIDEO_CONTENT_WORKFLOW_VERSION = "video_content_review_workflow_v1" as const;

export interface BeautyVideoContentPreflight {
  requestId: string;
  receiptId: string;
  filename: string;
  mimeType: string;
  byteSize: number;
  durationSeconds: number;
  width?: number;
  height?: number;
  videoCodec?: string;
  audioCodec?: string;
  audioSampleRateHz?: number;
  audioChannels?: number;
  formatName: string;
  providerCalls: 0;
  creditCost: 0;
  retainedMedia: false;
  sourceDeleted: true;
  visualStatus: "not_run_preflight_only";
  asrStatus: "not_run_preflight_only";
  checkedAt: string;
}

export interface BeautyVideoContentWorkflowDraft {
  version: typeof BEAUTY_VIDEO_CONTENT_WORKFLOW_VERSION;
  platform: string;
  accountName: string;
  videoId: string;
  videoTitle: string;
  originalCaption: string;
  businessObjective: string;
  targetAudience: string;
  transcript: string;
  visualEvidence: string;
  sceneTimeline: string;
  contentStructure: string;
  factBoundary: string;
  mediaPreflight?: BeautyVideoContentPreflight;
}

interface Props {
  workflow: BeautyVideoContentWorkflowDraft;
  onChange: (value: BeautyVideoContentWorkflowDraft) => void;
  onPreflight: (file: File | undefined) => void;
  onRun: () => void;
  onBackToVideo: () => void;
  onOpenDataReview: () => void;
  preflighting: boolean;
  running: boolean;
  result?: string;
  savedAt: string;
  notice: string;
  error: string;
}

const PROVIDER_REQUIREMENTS = [
  { label: "视觉解析", model: "qwen-vl-max", status: "准入已通过", impact: "当前业务视频仍必须提供可核验画面证据；本页不会把元数据预检冒充视觉解析。" },
  { label: "语音转写", model: "qwen3-asr-flash", status: "准入已通过", impact: "当前业务视频仍必须提供真实口播/字幕证据；缺失时禁止生成正式复盘。" }
] as const;

export function createEmptyBeautyVideoContentWorkflow(defaults?: Partial<BeautyVideoContentWorkflowDraft>): BeautyVideoContentWorkflowDraft {
  return {
    version: BEAUTY_VIDEO_CONTENT_WORKFLOW_VERSION,
    platform: "",
    accountName: "",
    videoId: "",
    videoTitle: "",
    originalCaption: "",
    businessObjective: "",
    targetAudience: "",
    transcript: "",
    visualEvidence: "",
    sceneTimeline: "",
    contentStructure: "",
    factBoundary: "",
    ...defaults
  };
}

export function getBeautyVideoContentMissingFields(workflow: BeautyVideoContentWorkflowDraft): string[] {
  const missing: string[] = [];
  if (!workflow.platform.trim()) missing.push("发布平台");
  if (workflow.videoTitle.trim().length < 2) missing.push("视频标题或内部识别名");
  if (workflow.businessObjective.trim().length < 2) missing.push("本轮业务目标");
  if (workflow.targetAudience.trim().length < 2) missing.push("目标人群");
  if (!workflow.mediaPreflight) missing.push("重新选择视频并完成零费用元数据预检");
  if (!workflow.transcript.trim()) missing.push("当前视频的真实口播/字幕证据");
  if (!workflow.visualEvidence.trim() && !workflow.sceneTimeline.trim()) missing.push("当前视频的真实画面或分镜证据");
  return missing;
}

export function BeautyVideoContentReviewWorkbench(props: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showEvidenceFields, setShowEvidenceFields] = useState(false);
  const requiredBeforeUpload = [
    !props.workflow.platform.trim() ? "发布平台" : "",
    props.workflow.videoTitle.trim().length < 2 ? "视频标题或内部识别名" : "",
    props.workflow.businessObjective.trim().length < 2 ? "业务目标" : "",
    props.workflow.targetAudience.trim().length < 2 ? "目标人群" : ""
  ].filter(Boolean);
  const missing = getBeautyVideoContentMissingFields(props.workflow);

  const update = (key: keyof BeautyVideoContentWorkflowDraft, value: string) => {
    props.onChange({ ...props.workflow, [key]: value });
  };

  return <section className="beautyVideoContentWorkbench" aria-label="视频内容复盘专属工作区">
    <header className="beautyVideoContentHero">
      <div>
        <button type="button" onClick={props.onBackToVideo}>← 返回视频获客</button>
        <span>正式 Skill 合同 · 媒体准入已通过</span>
        <h1>视频内容复盘</h1>
        <p>把真实视频、目标、口播与画面证据准备完整，再进入固定视频内容复盘 Skill。文件预检仍为零费用元数据检查，不会冒充已读取画面或口播。</p>
      </div>
      <aside><strong>当前状态</strong><span>已开放 · 证据齐全后可执行</span><em>本页预检 Provider 0 次 · 费用 ¥0</em></aside>
    </header>

    <div className="beautyVideoContentGate" role="note">
      <strong>当前视频必须先补齐什么？</strong>
      <p>BY-15 的 qwen-vl-max 与 qwen3-asr-flash 准入已经真实通过；但每个业务视频仍须有当前租户确认的口播与画面证据。仅完成元数据预检时不会声称系统理解了视频，也不会生成结果。</p>
    </div>

    <div className="beautyVideoContentGrid">
      <section className="beautyVideoContentBrief">
        <header><span>01</span><div><strong>视频与业务识别</strong><small>这些字段将由 Web 与 WorkBuddy 共用；不会从自由文本改路由。</small></div></header>
        <div className="beautyVideoContentFields">
          <label>发布平台<select value={props.workflow.platform} onChange={(event) => update("platform", event.target.value)}><option value="">请选择</option>{["抖音", "视频号", "小红书", "快手", "B站", "其他"].map((item) => <option key={item}>{item}</option>)}</select></label>
          <label>账号名称（选填）<input value={props.workflow.accountName} onChange={(event) => update("accountName", event.target.value)} placeholder="只填当前租户可确认的账号" /></label>
          <label>平台视频 ID / 链接标识（选填）<input value={props.workflow.videoId} onChange={(event) => update("videoId", event.target.value)} placeholder="用于追溯，不代表已连接平台" /></label>
          <label>视频标题或内部识别名<input value={props.workflow.videoTitle} onChange={(event) => update("videoTitle", event.target.value)} placeholder="例如：8月新客基础护理介绍" /></label>
          <label className="wide">原发布文案（选填）<textarea rows={3} value={props.workflow.originalCaption} onChange={(event) => update("originalCaption", event.target.value)} placeholder="粘贴真实标题/正文；没有就留空" /></label>
          <label>本轮业务目标<input value={props.workflow.businessObjective} onChange={(event) => update("businessObjective", event.target.value)} placeholder="例如：提高有效咨询，不承诺指标提升" /></label>
          <label>目标人群<input value={props.workflow.targetAudience} onChange={(event) => update("targetAudience", event.target.value)} placeholder="只填已确认人群" /></label>
          <label className="wide">已知内容结构（选填）<textarea rows={3} value={props.workflow.contentStructure} onChange={(event) => update("contentStructure", event.target.value)} placeholder="例如：问题开场—过程展示—咨询承接" /></label>
          <label className="wide">事实与合规边界（选填）<textarea rows={3} value={props.workflow.factBoundary} onChange={(event) => update("factBoundary", event.target.value)} placeholder="价格、案例、授权、疗效等未确认内容明确写待补" /></label>
        </div>

        <section className="beautyVideoContentUpload">
          <header><span>02</span><div><strong>上传真实视频做零费用预检</strong><small>支持 MP4、MOV、M4V、WebM；上限由服务端返回。只读取格式、时长、分辨率与音视频流元数据，临时文件随请求删除。</small></div></header>
          <input ref={fileInputRef} type="file" accept="video/mp4,video/quicktime,video/webm,.m4v" hidden onChange={(event) => props.onPreflight(event.target.files?.[0])} />
          <button type="button" className="beautyVideoContentFileButton" disabled={props.preflighting || requiredBeforeUpload.length > 0} onClick={() => fileInputRef.current?.click()}>{props.preflighting ? "正在预检…" : props.workflow.mediaPreflight ? "重新选择视频预检" : "选择视频并预检"}</button>
          {requiredBeforeUpload.length > 0 && <p className="beautyVideoContentHint">上传前请先补：{requiredBeforeUpload.join("、")}。</p>}
          {props.workflow.mediaPreflight ? <div className="beautyVideoContentReceipt">
            <strong>{props.workflow.mediaPreflight.filename}</strong>
            <span>{formatBytes(props.workflow.mediaPreflight.byteSize)} · {props.workflow.mediaPreflight.durationSeconds.toFixed(3)} 秒{props.workflow.mediaPreflight.width && props.workflow.mediaPreflight.height ? ` · ${props.workflow.mediaPreflight.width}×${props.workflow.mediaPreflight.height}` : ""}</span>
            <span>{props.workflow.mediaPreflight.videoCodec ? `视频 ${props.workflow.mediaPreflight.videoCodec}` : "视频流待核对"} · {props.workflow.mediaPreflight.audioCodec ? `音频 ${props.workflow.mediaPreflight.audioCodec}${props.workflow.mediaPreflight.audioSampleRateHz ? ` / ${props.workflow.mediaPreflight.audioSampleRateHz} Hz` : ""}${props.workflow.mediaPreflight.audioChannels ? ` / ${props.workflow.mediaPreflight.audioChannels} 声道` : ""}` : "未检测到音频流"}</span>
            <p>元数据可读取；Provider 调用 {props.workflow.mediaPreflight.providerCalls}，积分 {props.workflow.mediaPreflight.creditCost}，文件未保留。</p>
          </div> : <div className="beautyVideoContentEmpty"><strong>尚未完成视频预检</strong><p>刷新后不会保留本地视频；开始新一轮时必须重新选择，系统不会伪造已读取状态。</p></div>}
        </section>

        <section className="beautyVideoContentEvidence">
          <header><span>03</span><div><strong>当前视频证据</strong><small>口播与画面证据是正式复盘必填项；只填写当前租户可核验事实。</small></div></header>
          <button type="button" className="beautyVideoContentEvidenceToggle" aria-expanded={showEvidenceFields} onClick={() => setShowEvidenceFields((value) => !value)}>{showEvidenceFields ? "收起补充资料" : "补充转写、画面与时间轴"}</button>
          {showEvidenceFields && <div className="beautyVideoContentFields oneColumn">
            <label>用户确认的口播/字幕转写<textarea rows={5} value={props.workflow.transcript} onChange={(event) => update("transcript", event.target.value)} placeholder="粘贴当前视频的真实转写；不确定处明确标记听不清" /></label>
            <label>用户确认的画面证据<textarea rows={4} value={props.workflow.visualEvidence} onChange={(event) => update("visualEvidence", event.target.value)} placeholder="只描述确定看见的主体、场景、动作；不推断设备或效果" /></label>
            <label>时间轴/分镜记录<textarea rows={4} value={props.workflow.sceneTimeline} onChange={(event) => update("sceneTimeline", event.target.value)} placeholder="例如：0–3秒：门头；3–10秒：项目过程" /></label>
          </div>}
        </section>
      </section>

      <aside className="beautyVideoContentStatus">
        <header><span>证据门禁</span><h2>视觉与口播必须分别可核验</h2><p>“视频数据复盘”看后台指标；本页只准备视频内容证据，两者不会混用。</p></header>
        <div className="beautyVideoProviderCards">{PROVIDER_REQUIREMENTS.map((item) => <article key={item.model}><div><strong>{item.label}</strong><span>{item.model}</span></div><em>{item.status}</em><p>{item.impact}</p></article>)}</div>
        <section className="beautyVideoContentMissing"><h3>正式复盘仍缺少</h3><ul>{missing.map((item) => <li key={item}>{item}</li>)}</ul><p>全部满足后，正式结果才会按“视频基本信息 + 现有版本诊断 + 八段优化方案”输出；没有后台数据时不承诺播放、完播或转化提升。</p></section>
        <section className="beautyVideoContentOutputContract"><h3>正式输出合同</h3><ol>{["视频基本信息与现有版本诊断", "优化版选题定位与口播逐字稿", "优化版拍摄脚本与拍摄注意事项", "优化版剪辑 EDL 与发布策略", "投流建议与核心改进点"].map((item) => <li key={item}>{item}</li>)}</ol></section>
        <div className="beautyVideoContentBlockedAction"><strong>{missing.length ? "资料未齐，正式复盘保持关闭" : "资料已齐，可进入固定 Skill 复盘"}</strong><p>{missing.length ? "补齐当前视频的口播、画面和预检证据后才会创建 AgentRun；不会用模板补缺。" : "本次只把当前表单的正式合同传入 shooting_editing，不会自由文本切换 Skill。"}</p></div>
        <button type="button" className="beautyVideoContentFileButton" disabled={props.running || missing.length > 0} onClick={props.onRun}>{props.running ? "正在生成正式复盘…" : "开始正式内容复盘"}</button>
        {props.result && <section className="beautyVideoContentOutputContract"><h3>已保存的正式复盘</h3><pre>{props.result}</pre></section>}
        <button type="button" className="beautyVideoContentSecondary" onClick={props.onOpenDataReview}>需要看播放/完播指标？进入视频数据复盘</button>
        {props.savedAt && <small>表单自动保存于 {new Date(props.savedAt).toLocaleTimeString()}；视频文件和预检回执不会跨刷新保留。</small>}
      </aside>
    </div>
    {props.notice && <p className="beautyIndustryNotice" role="status">{props.notice}</p>}
    {props.error && <div className="beautyIndustryError" role="alert"><span>{props.error}</span></div>}
  </section>;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

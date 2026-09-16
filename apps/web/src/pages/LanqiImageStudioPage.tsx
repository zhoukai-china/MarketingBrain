import { useEffect, useRef, useState } from "react";
import { apiPath, getAppPath } from "../lib/api.js";
import "../styles/lanqi-image-studio-enhancer.css";
import { createLanqiPreviewRequestCoordinator, stageForElapsedSeconds, type LanqiPreviewRequestState } from "./lanqi-image-preview-request.js";

type Purpose = "xiaohongshu_cover" | "social_poster" | "service_intro" | "store_branding";
type Ratio = "1:1" | "3:4" | "9:16" | "16:9";
type Style = "natural" | "warm" | "premium" | "clean";
type TextMode = "no_text" | "title_space" | "provided_text";

type Direction = {
  id: string;
  name: string;
  variable: string;
  positivePrompt: string;
  negativePrompt: string;
  overlayText: { mode: "post_process"; text: string; placement: string };
  parameters: {
    purpose: Purpose; aspectRatio: Ratio; style: Style; composition: string; subject: string;
    scene: string; lighting: string; colorPalette: string; camera: string; materials: string; clarity: "high";
  };
};

type ImagePreview = {
  id: string;
  request: string;
  inputSummary: string;
  purpose: Purpose;
  ratio: Ratio;
  style: Style;
  textMode: TextMode;
  overlayText?: string;
  intentUnderstanding: string;
  missingQuestions: string[];
  directions: Direction[];
  selectedDirectionId: string;
  promptPreview: string;
  negativePrompt: string;
  factBoundary: string[];
  complianceNotes?: string[];
  enhancer: { id: string; version: string; source: "runtime_skill" | "deterministic_fallback"; revisionSummary: string };
  modelAdapter: {
    capability: "media.image.generate";
    parameters: { aspectRatio: Ratio; canvas: { width: number; height: number }; imageCount: 1; renderText: false; watermark: true };
  };
  knowledgeVersion: { status: "not_loaded"; version: null; note: string };
  quotePreview: { creditCost: number; billable: false; confirmationRequired: true; note: string };
  execution: { status: "preview_only"; canSubmit: false; requiredCapability: "media.image.generate"; blockedReason: string };
  status: "preview";
  updatedAt: string;
};

type GenerationQuote = {
  creditCost: number;
  canConfirm: boolean;
  billable: boolean;
  executionMode: "disabled" | "mock" | "real";
  message: string;
  blockCode?: "media_execution_blocked" | "quota_exhausted";
};

type GenerationJob = {
  id: string;
  previewId?: string;
  status: "queued" | "submitted" | "processing" | "succeeded" | "failed" | "canceled";
  progress: number;
  creditCost: number;
  billingStatus: string;
  assetStatus: string;
  outputUrl?: string;
  errorMessage?: string;
  canCancel: boolean;
  canRetry: boolean;
  selectedAt?: string;
  savedAt?: string;
  createdAt: string;
  updatedAt: string;
  executionMode: "mock" | "real";
};

const purposeLabels: Record<Purpose, string> = {
  xiaohongshu_cover: "小红书封面", social_poster: "社交平台海报", service_intro: "服务项目介绍", store_branding: "门店品牌形象",
};
const ratioOptions: Ratio[] = ["1:1", "3:4", "9:16", "16:9"];

function headers(): HeadersInit {
  const token = localStorage.getItem("store_os_token");
  return token ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
}

function dedupe(items: ImagePreview[]): ImagePreview[] {
  const seen = new Set<string>();
  return items.filter(item => {
    const key = `${item.inputSummary || item.request}|${item.purpose}|${item.ratio}|${item.style}|${item.promptPreview}`.replace(/\s+/g, " ").toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function errorMessage(cause: unknown, manuallyCancelled: boolean, fallback: string): string {
  if (cause instanceof DOMException && cause.name === "AbortError") return manuallyCancelled ? "已取消本次预览，输入仍然保留。" : "预览准备超时，输入已保留，可以直接重试。";
  return cause instanceof TypeError ? fallback : cause instanceof Error ? cause.message : fallback;
}

function generationStatus(status: GenerationJob["status"]): string {
  return ({ queued: "等待生成", submitted: "已提交", processing: "生成中", succeeded: "图片已生成", failed: "生成失败", canceled: "已取消" })[status] ?? status;
}

const previewStageLabels = {
  understand: "理解需求",
  compose: "组织构图/风格",
  verify: "检查事实与品牌边界",
} as const;

export function LanqiImageStudioPage() {
  const [request, setRequest] = useState("");
  const [purpose, setPurpose] = useState<Purpose>("xiaohongshu_cover");
  const [ratio, setRatio] = useState<Ratio>("3:4");
  const [style, setStyle] = useState<Style>("warm");
  const [textMode, setTextMode] = useState<TextMode>("title_space");
  const [overlayText, setOverlayText] = useState("");
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [previews, setPreviews] = useState<ImagePreview[]>([]);
  const [active, setActive] = useState<ImagePreview | null>(null);
  const [intentDraft, setIntentDraft] = useState("");
  const [revisionInstruction, setRevisionInstruction] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [previewProgress, setPreviewProgress] = useState<LanqiPreviewRequestState | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [quote, setQuote] = useState<GenerationQuote | null>(null);
  const [jobs, setJobs] = useState<GenerationJob[]>([]);
  const [generationBusy, setGenerationBusy] = useState(false);
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>({});
  const [jobActionNotices, setJobActionNotices] = useState<Record<string, string>>({});
  const submittingRef = useRef(false);
  const requestKeyRef = useRef<string | null>(null);
  const generationKeyRef = useRef<string | null>(null);
  const previewCoordinatorRef = useRef<ReturnType<typeof createLanqiPreviewRequestCoordinator> | null>(null);

  if (!previewCoordinatorRef.current) {
    previewCoordinatorRef.current = createLanqiPreviewRequestCoordinator({
      timeoutMs: 95_000,
      onState: state => {
        setPreviewProgress(state);
        if (state.status === "running") {
          submittingRef.current = true;
          setBusy(true);
          return;
        }
        submittingRef.current = false;
        setBusy(false);
        if (state.status === "cancelled") setNotice("已取消本次预览，输入和旧预览仍然保留；不会生成图片或扣图片积分。");
        if (state.status === "timed_out") setNotice("专业提示词增强已超时，本次没有生成图片或扣图片积分；输入仍保留，可以重试。");
      },
    });
  }

  useEffect(() => {
    if (!localStorage.getItem("store_os_token")) {
      localStorage.setItem("store_os_post_login_redirect", window.location.pathname);
      window.location.replace(getAppPath("/login/lanqi"));
      return;
    }
    void Promise.all([load(), loadJobs()]);
  }, []);

  useEffect(() => {
    const selectedDirection = active?.directions.find(item => item.id === active.selectedDirectionId) ?? active?.directions[0];
    if (!active || !selectedDirection) { setQuote(null); return; }
    void loadQuote(active, selectedDirection);
  }, [active?.id, active?.selectedDirectionId]);

  useEffect(() => {
    const pending = jobs.find(job => ["queued", "submitted", "processing"].includes(job.status));
    if (!pending) return;
    const timer = window.setTimeout(() => void refreshJob(pending.id), 1400);
    return () => window.clearTimeout(timer);
  }, [jobs]);

  useEffect(() => {
    jobs.filter(job => job.status === "succeeded" && job.outputUrl && !assetUrls[job.id]).forEach(job => void loadAsset(job));
  }, [jobs, assetUrls]);

  useEffect(() => {
    if (!busy || !previewProgress || previewProgress.status !== "running") return;
    const tick = () => {
      const next = Math.max(0, Math.floor((Date.now() - previewProgress.startedAt) / 1000));
      setElapsedSeconds(next);
      previewCoordinatorRef.current?.updateElapsed(previewProgress.id, next);
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [busy, previewProgress?.id, previewProgress?.status, previewProgress?.startedAt]);

  function markChanged() { requestKeyRef.current = null; generationKeyRef.current = null; }

  async function load() {
    setLoading(true);
    try {
      const response = await fetch(apiPath("/lanqi/image-studio/previews"), { headers: headers() });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error("已保存的图片预览暂时无法加载，请稍后重试。");
      const items = dedupe((body.previews ?? []) as ImagePreview[]);
      setPreviews(items);
      setActive(current => {
        const next = current ?? items[0] ?? null;
        if (next) setIntentDraft(next.intentUnderstanding);
        return next;
      });
    } catch (cause) {
      setNotice(errorMessage(cause, false, "网络暂时不可用，已保存的图片预览没有加载成功。"));
    } finally { setLoading(false); }
  }

  async function loadJobs() {
    try {
      const response = await fetch(apiPath("/lanqi/media/jobs"), { headers: headers() });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error("图片任务暂时无法加载。" );
      setJobs((body.jobs ?? []) as GenerationJob[]);
    } catch (cause) { setNotice(errorMessage(cause, false, "网络暂时不可用，图片任务没有加载成功。")); }
  }

  async function loadQuote(preview: ImagePreview, direction: Direction) {
    try {
      const response = await fetch(apiPath("/lanqi/media/quote"), {
        method: "POST", headers: headers(), body: JSON.stringify({ kind: "image", previewId: preview.id, promptVersion: preview.enhancer.version, prompt: direction.positivePrompt, negativePrompt: direction.negativePrompt, ratio: preview.ratio }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message ?? "费用预览暂时无法读取。" );
      setQuote(body as GenerationQuote);
    } catch (cause) {
      setQuote(null);
      setNotice(errorMessage(cause, false, "网络暂时不可用，费用预览没有加载成功。"));
    }
  }

  async function confirmGeneration(forceNew = false) {
    if (!active || !selected || !quote?.canConfirm || generationBusy) return;
    setGenerationBusy(true); setNotice("");
    if (forceNew) generationKeyRef.current = null;
    const requestKey = generationKeyRef.current ?? crypto.randomUUID();
    generationKeyRef.current = requestKey;
    try {
      const response = await fetch(apiPath("/lanqi/media/confirm"), {
        method: "POST", headers: { ...headers(), "X-Idempotency-Key": requestKey },
        body: JSON.stringify({ kind: "image", previewId: active.id, promptVersion: active.enhancer.version, prompt: selected.positivePrompt, negativePrompt: selected.negativePrompt, ratio: active.ratio, requestKey, confirmed: true }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message ?? "图片任务没有创建成功。" );
      const job = body.job as GenerationJob;
      setJobs(items => [job, ...items.filter(item => item.id !== job.id)]);
      setNotice(body.idempotent ? "已恢复同一图片任务，没有重复创建或扣费。" : job.executionMode === "mock" ? "受控模拟任务已创建，不调用外部模型、不扣积分。" : "图片任务已创建，正在生成。" );
    } catch (cause) { setNotice(errorMessage(cause, false, "网络暂时不可用，图片任务没有创建成功。")); }
    finally { setGenerationBusy(false); }
  }

  async function refreshJob(jobId: string) {
    try {
      const response = await fetch(apiPath(`/lanqi/media/jobs/${jobId}/refresh`), { method: "POST", headers: headers(), body: "{}" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok && !body.job) throw new Error(body.message ?? "任务进度暂时无法刷新。" );
      if (body.job) setJobs(items => items.map(item => item.id === jobId ? body.job as GenerationJob : item));
      if (!response.ok) setNotice(body.message ?? "任务已结束。" );
    } catch (cause) { setNotice(errorMessage(cause, false, "网络暂时不可用，任务进度暂时无法刷新。")); }
  }

  async function cancelGeneration(jobId: string) {
    try {
      const response = await fetch(apiPath(`/lanqi/media/jobs/${jobId}/cancel`), { method: "POST", headers: headers(), body: "{}" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message ?? "任务当前无法取消。" );
      setJobs(items => items.map(item => item.id === jobId ? body.job as GenerationJob : item));
      setNotice("任务已取消；未交付结果不会收费，已预留积分会自动退回。" );
    } catch (cause) { setNotice(errorMessage(cause, false, "网络暂时不可用，取消没有完成。")); }
  }

  async function markGeneration(jobId: string, action: "select" | "save") {
    try {
      const response = await fetch(apiPath(`/lanqi/media/jobs/${jobId}/assets/${action}`), { method: "POST", headers: headers(), body: "{}" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message ?? "图片状态没有保存成功。" );
      setJobs(items => items.map(item => item.id === jobId ? body.job as GenerationJob : item));
      setNotice(action === "select" ? "已选择这张图片。" : "图片已保存在本门店媒体资产中，刷新后仍可恢复。" );
    } catch (cause) { setNotice(errorMessage(cause, false, "网络暂时不可用，图片状态没有保存成功。")); }
  }

  function prepareRegeneration(job: GenerationJob) {
    const blockedReason = quote?.message ?? "费用与授权状态尚未恢复，请稍后刷新；本次不会创建任务或扣积分。";
    if (!quote?.canConfirm) {
      setJobActionNotices(items => ({ ...items, [job.id]: blockedReason }));
      return;
    }
    const preview = previews.find(item => item.id === job.previewId);
    if (preview) restore(preview);
    generationKeyRef.current = null;
    setJobActionNotices(items => ({ ...items, [job.id]: "已准备重新生成；这是新的付费动作，请回到费用卡重新确认后再创建任务。" }));
    setNotice("重新生成不会一键付费；请核对提示词和费用，并再次点击“确认并生成图片”。");
  }

  async function loadAsset(job: GenerationJob) {
    if (!job.outputUrl) return;
    try {
      const response = await fetch(apiPath(job.outputUrl), { headers: headers() });
      if (!response.ok) return;
      const url = URL.createObjectURL(await response.blob());
      setAssetUrls(items => ({ ...items, [job.id]: url }));
    } catch { /* Task card keeps the result recoverable; the user can retry loading. */ }
  }

  async function createPreview(mode: "new" | "revise" = "new") {
    if (submittingRef.current || request.trim().length < 2 || !rightsConfirmed) return;
    if (mode === "revise" && (!active || revisionInstruction.trim().length < 2)) return;
    const coordinator = previewCoordinatorRef.current!;
    const run = coordinator.begin();
    setElapsedSeconds(0);
    setNotice("");
    const requestKey = requestKeyRef.current ?? crypto.randomUUID();
    requestKeyRef.current = requestKey;
    try {
      const response = await fetch(apiPath("/lanqi/image-studio/previews"), {
        method: "POST",
        headers: { ...headers(), "X-Idempotency-Key": requestKey },
        signal: run.signal,
        body: JSON.stringify({
          request, purpose, ratio, style, textMode, overlayText, rightsConfirmed, requestKey,
          ...(mode === "revise" && active ? { basePreviewId: active.id, revisionInstruction, intentUnderstanding: intentDraft } : {}),
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!coordinator.isCurrent(run.id)) return;
      if (!response.ok) throw new Error(body.message ?? "提示词预览暂时没有准备成功，请稍后重试。");
      const preview = body.preview as ImagePreview;
      if (!coordinator.complete(run.id)) return;
      generationKeyRef.current = null;
      setActive(preview);
      setIntentDraft(preview.intentUnderstanding);
      setRevisionInstruction("");
      setPreviews(items => dedupe([preview, ...items.filter(item => item.id !== preview.id)]));
      setNotice(body.idempotent ? "已恢复本次预览，没有重复保存或计费。" : preview.enhancer.source === "runtime_skill" ? "专业模型提示词与费用预览已保存，没有生成图片或扣积分。" : "受控草稿已保存；专业模型增强未完成，没有生成图片或扣积分。");
    } catch (cause) {
      if (!coordinator.isCurrent(run.id)) return;
      coordinator.fail(run.id);
      setNotice(errorMessage(cause, false, "网络暂时不可用，输入已保留，可以直接重试。"));
    }
  }

  function cancelPreview() {
    const current = previewProgress;
    if (current?.status === "running") previewCoordinatorRef.current?.cancel(current.id);
  }

  async function chooseDirection(directionId: string) {
    if (!active || directionId === active.selectedDirectionId) return;
    try {
      const response = await fetch(apiPath(`/lanqi/image-studio/previews/${active.id}/selection`), {
        method: "PATCH", headers: headers(), body: JSON.stringify({ directionId }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message ?? "视觉方向没有保存成功，请重试。");
      const preview = body.preview as ImagePreview;
      setActive(preview);
      setPreviews(items => items.map(item => item.id === preview.id ? preview : item));
      setNotice("已保存这个视觉方向；真实生成时会使用对应的正负提示词和参数。");
    } catch (cause) { setNotice(errorMessage(cause, false, "方向暂时无法保存，请稍后重试。")); }
  }

  function restore(preview: ImagePreview) {
    setActive(preview); setIntentDraft(preview.intentUnderstanding); setRequest(preview.inputSummary || preview.request);
    setPurpose(preview.purpose); setRatio(preview.ratio); setStyle(preview.style); setTextMode(preview.textMode);
    setOverlayText(preview.overlayText ?? ""); setRightsConfirmed(true); setRevisionInstruction(""); requestKeyRef.current = null;
    setNotice("已恢复这次图片预览，可选择方向或输入一条调整要求。");
  }

  const selected = active?.directions.find(item => item.id === active.selectedDirectionId) ?? active?.directions[0];

  return <div className="lanqiImagePage">
    <header className="lanqiImageHeader">
      <button className="lanqiImageBrand" onClick={() => window.location.href = getAppPath("/my-ai")}>兰琪美业 <span>文生图</span></button>
      <nav><button onClick={() => window.location.href = getAppPath("/lanqi/content-studio")}>小红书文案</button><button onClick={() => window.location.href = getAppPath("/lanqi/store-profile")}>经营档案</button></nav>
    </header>

    <main className="lanqiImageMain">
      <section className="lanqiImageHero"><p>兰琪 AI · 独立图片工具</p><h1>把普通想法，变成专业绘图提示词</h1><span>用户只说自然需求，系统负责理解意图、补足视觉语言并提供多个方向；确认后在同页查看受控生成进度与结果。</span></section>

      <section className="lanqiImageWorkspace">
        <article className="lanqiImageFormCard">
          <div className="lanqiImageKicker">01 · 图片需求</div><h2>这张图要展示什么？</h2>
          <label className="wide">画面需求<textarea value={request} onChange={event => { setRequest(event.target.value); markChanged(); }} placeholder="例如：做一张夏季补水护理的小红书封面，温柔高级，不出现顾客正脸。" /></label>
          <div className="lanqiImageFields">
            <label>图片用途<select value={purpose} onChange={event => { setPurpose(event.target.value as Purpose); markChanged(); }}>{Object.entries(purposeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label>视觉偏好<select value={style} onChange={event => { setStyle(event.target.value as Style); markChanged(); }}><option value="natural">自然真实</option><option value="warm">温暖亲和</option><option value="premium">精致高级</option><option value="clean">清爽干净</option></select></label>
          </div>
          <fieldset className="lanqiRatioField"><legend>画面比例</legend><div>{ratioOptions.map(item => <button type="button" key={item} className={ratio === item ? "active" : ""} onClick={() => { setRatio(item); markChanged(); }}>{item}</button>)}</div></fieldset>
          <div className="lanqiImageFields">
            <label>中文叠字<select value={textMode} onChange={event => { setTextMode(event.target.value as TextMode); markChanged(); }}><option value="no_text">不需要文字</option><option value="title_space">预留标题区域</option><option value="provided_text">使用我提供的短标题</option></select></label>
            {textMode === "provided_text" && <label>短标题<input maxLength={40} value={overlayText} onChange={event => { setOverlayText(event.target.value); markChanged(); }} placeholder="后期叠加，不交给绘图模型" /></label>}
          </div>
          <label className="lanqiRightsCheck"><input type="checkbox" checked={rightsConfirmed} onChange={event => { setRightsConfirmed(event.target.checked); markChanged(); }} /><span>我确认本次文字、品牌和人物描述均有权使用，不要求模仿未授权真人或其他门店。</span></label>
          <div className="lanqiImageActions"><button className="lanqiImagePrimary" disabled={busy || request.trim().length < 2 || !rightsConfirmed} onClick={() => void createPreview()}>{busy ? `${previewProgress?.stage ? previewStageLabels[previewProgress.stage] : "理解需求"}…` : "生成提示词与费用预览"}</button>{busy && <button type="button" className="lanqiImageCancel" onClick={cancelPreview}>取消预览</button>}</div>
          {busy && previewProgress?.status === "running" && <div className="lanqiPreviewProgress" role="status" aria-live="polite"><b>{previewStageLabels[stageForElapsedSeconds(elapsedSeconds)]}</b><span>已耗时 {elapsedSeconds} 秒</span><small>{elapsedSeconds >= 30 ? "仍在处理，可随时取消；不会生成图片或扣图片积分。" : "旧预览仍可阅读，本次只锁定提交区域。"}</small></div>}
          <small className="lanqiZeroPay">本步骤不生成图片、不扣积分，也不会发布到任何平台。</small>
        </article>

        <article className="lanqiImageGuideCard"><div className="lanqiImageKicker">02 · 增强原则</div><h2>真正适合模型的提示词</h2><ol><li><b>保留意图</b><span>不替换服务、城市、品牌、人群或禁止项。</span></li><li><b>视觉化</b><span>明确构图、主体、场景、光线、色彩、镜头与材质。</span></li><li><b>文字分离</b><span>中文标题后期叠加，不让绘图模型生成乱码。</span></li><li><b>事实受控</b><span>不编门店实景、顾客案例、疗效、价格或销量。</span></li></ol></article>
      </section>

      {notice && <section className="lanqiImageNotice" aria-live="polite">{notice}</section>}

      {active && selected && <section className="lanqiImageResult">
        <div className="lanqiImageResultHeading"><div><div className="lanqiImageKicker">已保存预览 · {active.enhancer.version}</div><h2>{purposeLabels[active.purpose]} · {active.ratio}</h2></div><span>{active.enhancer.source === "runtime_skill" ? "专业模型增强" : "受控草稿（专业模型未完成）"}</span></div>

        <article className="lanqiIntentCard">
          <label>AI 对需求的理解（可编辑）<textarea value={intentDraft} onChange={event => { setIntentDraft(event.target.value); markChanged(); }} /></label>
          <div>{active.complianceNotes?.length ? <><h3>合规改写说明</h3><ul>{active.complianceNotes.map(note => <li key={note}>{note}</li>)}</ul></> : null}{active.missingQuestions.length > 0 && <><h3>待补的关键问题</h3><ul>{active.missingQuestions.map(question => <li key={question}>{question}</li>)}</ul></>}</div>
        </article>

        <div className="lanqiDirectionTabs" role="tablist" aria-label="视觉方向">{active.directions.map(direction => <button role="tab" aria-selected={direction.id === active.selectedDirectionId} className={direction.id === active.selectedDirectionId ? "active" : ""} key={direction.id} onClick={() => void chooseDirection(direction.id)}><b>{direction.name}</b><span>只改变：{direction.variable}</span></button>)}</div>

        <div className="lanqiImageResultGrid">
          <article className="lanqiPromptCard"><h3>正向视觉提示词</h3><pre>{selected.positivePrompt}</pre><h3>负向提示词</h3><p className="lanqiNegativePrompt">{selected.negativePrompt}</p><h3>中文标题或文案叠字</h3><p>{selected.overlayText.text || "本方向只预留标题安全区；绘图阶段不生成中文，后期再叠加。"}</p></article>
          <aside>
            <h3>费用与执行边界</h3><dl><div><dt>积分预估</dt><dd>{quote?.creditCost ?? active.quotePreview.creditCost} 积分</dd></div><div><dt>本次计费</dt><dd>{quote?.billable ? "确认后预留" : "不计费"}</dd></div><div><dt>所需能力</dt><dd><code>{active.execution.requiredCapability}</code></dd></div><div><dt>当前状态</dt><dd>{quote?.executionMode === "mock" ? "受控模拟验收" : quote?.canConfirm ? "已受控放行" : "等待真实生成放行"}</dd></div></dl>
             <p>{quote?.message ?? active.execution.blockedReason}</p>
             <button className={quote?.canConfirm ? "lanqiGenerateReady" : "lanqiGenerateDisabled"} aria-disabled={!quote?.canConfirm || generationBusy} title={!quote?.canConfirm ? quote?.message ?? active.execution.blockedReason : undefined} disabled={!quote?.canConfirm || generationBusy} onClick={() => void confirmGeneration()}>{generationBusy ? "正在创建任务…" : quote?.blockCode === "quota_exhausted" ? "本次验收额度已用完" : "确认并生成图片"}</button>
             <small>{quote?.executionMode === "mock" ? "模拟图片只用于验证任务、进度、保存和恢复，不代表真实模型画质。" : quote?.canConfirm ? "只有本次明确确认会创建任务；同一请求键只恢复已有任务，不会重复生成。" : quote?.message ?? "服务端未放行，本次不会创建任务或扣积分。"}</small>
          </aside>
        </div>

        <article className="lanqiParameterCard"><h3>模型参数预览</h3><dl>{Object.entries({ 比例: selected.parameters.aspectRatio, 构图: selected.parameters.composition, 主体: selected.parameters.subject, 场景: selected.parameters.scene, 光线: selected.parameters.lighting, 色彩: selected.parameters.colorPalette, 镜头: selected.parameters.camera, 材质: selected.parameters.materials, 清晰度: selected.parameters.clarity }).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl><p>最终 capability：<code>{active.modelAdapter.capability}</code> · 画布：{active.modelAdapter.parameters.canvas.width}×{active.modelAdapter.parameters.canvas.height} · 文字渲染：关闭</p></article>

        <article className="lanqiRevisionCard"><h3>继续调整这个方向</h3><p>例如：更高级、更真实、更温暖、减少元素，或“保持构图只改颜色”。</p><div><input maxLength={300} value={revisionInstruction} onChange={event => { setRevisionInstruction(event.target.value); markChanged(); }} placeholder="输入一条本轮调整要求" /><button disabled={busy || revisionInstruction.trim().length < 2} onClick={() => void createPreview("revise")}>按这次要求优化提示词</button></div><small>{active.enhancer.revisionSummary}</small></article>

        <article className="lanqiFactBoundary"><h3>知识版本与事实边界</h3><p>{active.knowledgeVersion.note}</p><ul>{active.factBoundary.map(item => <li key={item}>{item}</li>)}</ul></article>
      </section>}

      <section className="lanqiGenerationHistory">
        <div className="lanqiImageHistoryHeading"><div><div className="lanqiImageKicker">同页任务</div><h2>图片生成与保存</h2></div><button onClick={() => void loadJobs()}>刷新任务</button></div>
        {jobs.length === 0 ? <p>还没有图片生成任务。先完成专业提示词预览，再在上方确认生成。</p> : <div className="lanqiGenerationGrid">{jobs.map(job => <article key={job.id} className={`lanqiGenerationJob ${job.status}`}>
          <div className="lanqiGenerationJobHead"><b>{generationStatus(job.status)}</b><span>{job.executionMode === "mock" ? "受控模拟" : `${job.creditCost} 积分`}</span></div>
          <div className="lanqiGenerationProgress"><i style={{ width: `${job.progress}%` }} /></div>
          {assetUrls[job.id] && <img src={assetUrls[job.id]} alt="兰琪图片生成结果" />}
          {job.errorMessage && <p className="lanqiGenerationError">{job.errorMessage}</p>}
          <small>{new Date(job.updatedAt).toLocaleString("zh-CN")} · {job.savedAt ? "已保存" : job.selectedAt ? "已选择" : job.assetStatus === "persisted" ? "已安全落库" : "等待结果"}</small>
          <div className="lanqiGenerationActions">
            {job.canCancel && <button onClick={() => void cancelGeneration(job.id)}>取消任务</button>}
            {["queued", "submitted", "processing"].includes(job.status) && <button onClick={() => void refreshJob(job.id)}>刷新进度</button>}
            {job.status === "succeeded" && <button className={job.selectedAt ? "active" : ""} onClick={() => void markGeneration(job.id, "select")}>{job.selectedAt ? "已选择" : "选择这张"}</button>}
            {job.status === "succeeded" && <button className={job.savedAt ? "active" : ""} onClick={() => void markGeneration(job.id, "save")}>{job.savedAt ? "已保存" : "保存图片"}</button>}
             {(job.canRetry || job.status === "succeeded") && active && <button aria-disabled={!quote?.canConfirm || generationBusy} title={!quote?.canConfirm ? quote?.message ?? "新的付费动作尚未放行" : "先返回费用卡再次确认"} disabled={!quote?.canConfirm || generationBusy} onClick={() => prepareRegeneration(job)}>重新生成</button>}
           </div>
           {(job.canRetry || job.status === "succeeded") && !quote?.canConfirm && <small className="lanqiGenerationBlocked">{quote?.message ?? "重新生成属于新的付费动作；费用或授权状态未就绪。"}</small>}
           {jobActionNotices[job.id] && <p className="lanqiGenerationActionNotice" aria-live="polite">{jobActionNotices[job.id]}</p>}
        </article>)}</div>}
      </section>

      <section className="lanqiImageHistory"><div className="lanqiImageHistoryHeading"><div><div className="lanqiImageKicker">本店历史</div><h2>已保存的图片预览</h2></div><button disabled={loading} onClick={() => void load()}>{loading ? "加载中…" : "刷新"}</button></div>{loading ? <p>正在读取本店图片预览…</p> : previews.length ? previews.map(preview => <button key={preview.id} className={active?.id === preview.id ? "active" : ""} onClick={() => restore(preview)}><b>{purposeLabels[preview.purpose]} · {preview.ratio}</b><span>{preview.inputSummary || preview.request}</span><small>{new Date(preview.updatedAt).toLocaleString("zh-CN")}</small></button>) : <p>还没有图片预览。保存后只在本门店工作区显示。</p>}</section>
    </main>
  </div>;
}

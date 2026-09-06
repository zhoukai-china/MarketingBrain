import { useEffect, useState, type FormEvent } from "react";

type XhsDelivery = {
  preview: boolean;
  customerDeliverable: {
    titles: string[];
    body: string;
    tags: string[];
    engagement: string;
  };
};

type XhsRun = {
  id: string;
  creditCost: number;
  usageChannel?: string;
  createdAt: string;
  structuredDelivery?: XhsDelivery;
  taskSnapshot?: XhsTaskSnapshot;
};

type XhsTaskSnapshot = {
  version: "beauty-xhs-task-snapshot-v1";
  themeAndPurpose: string;
  project: string;
  audience: string;
  city: string;
  storeFacts: string;
  contentAngle: string;
  tone: string;
  overallVisualRequirements: string;
  confirmedFacts: string;
  prohibitedContent: string;
};

type XhsOptions = {
  audience: string;
  project: string;
  tone: string;
  visualStyle: string;
  city: string;
  storeFacts: string;
  contentAngle: string;
  prohibitedContent: string;
};

type XhsImageQuote = {
  creditCost: number;
  imageCount: 1 | 3;
  canConfirm: boolean;
  stateCode: string;
  retryEligible: boolean;
  retryOfJobId?: string;
  regenerationEligible?: boolean;
  regenerationOfJobId?: string;
  message: string;
  imagePlan: {
    linkedTitle: string;
    directions: Array<{ role: "cover" | "content" | "engagement"; label: string; purpose: string }>;
  };
};

type XhsImageJob = {
  id: string;
  status: string;
  batchStatus: "processing" | "succeeded" | "quality_failed";
  qualityStatus: "pending_review" | "passed" | "rejected" | "manual_review_required";
  customerUsable: boolean;
  progress: number;
  canCancel: boolean;
  canRecover: boolean;
  failureRetryable: boolean;
  errorMessage?: string;
  selectedTitle?: string;
};

type Props = {
  question: string;
  options: XhsOptions;
  confirmedFacts: string;
  profileSummary: { store: string; city: string; project: string; audience: string; goal: string };
  missingRequiredFields: string[];
  savedAt: string;
  busy: boolean;
  elapsed: number;
  notice: string;
  error: string;
  preview: boolean;
  activeRun: XhsRun | null;
  history: XhsRun[];
  mediaQuote: XhsImageQuote | null;
  mediaJobs: XhsImageJob[];
  mediaBatchStatus: "processing" | "succeeded" | "quality_failed";
  mediaLoading: boolean;
  mediaObjectUrls: Record<string, string>;
  onQuestionChange: (value: string) => void;
  onOptionsChange: (value: XhsOptions) => void;
  onConfirmedFactsChange: (value: string) => void;
  onGenerate: () => void;
  onCancel: () => void;
  onRestore: () => void;
  onOpenProfile: () => void;
  onDismissError: () => void;
  onSelectHistory: (runId: string) => void;
  onConfirmImages: (selectedTitle: string) => void;
  onSelectedTitleChange: () => void;
  onPrepareImageRetry: () => void;
  onResumeImages: () => void;
  onCancelImage: (jobId: string) => void;
  onDownloadImage: (job: XhsImageJob, index: number) => void;
  onCopy: (text: string, successMessage: string) => void;
};

type CopyPart = "title" | "body" | "tags" | "package";

export function buildBeautyXhsCustomerCopy(delivery: XhsDelivery, selectedTitleIndex: number, part: CopyPart): string {
  const selectedTitle = delivery.customerDeliverable.titles[selectedTitleIndex] ?? delivery.customerDeliverable.titles[0] ?? "";
  const tags = delivery.customerDeliverable.tags.map((tag) => tag.startsWith("#") ? tag : `#${tag}`).join(" ");
  if (part === "title") return selectedTitle;
  if (part === "body") return delivery.customerDeliverable.body;
  if (part === "tags") return tags;
  return [selectedTitle, delivery.customerDeliverable.body, tags].filter(Boolean).join("\n\n");
}

const IMAGE_ROLE_COPY = {
  cover: "接待咨询区 · 承接选中标题的门店封面场景",
  content: "护理空间 · 呼应正文项目的通用护理场景",
  engagement: "到店承接空间 · 用于正文结尾互动的咨询氛围"
} as const;

export function BeautyXhsWorkbench(props: Props) {
  const [selectedTitleIndex, setSelectedTitleIndex] = useState(0);
  const delivery = props.activeRun?.structuredDelivery;

  useEffect(() => setSelectedTitleIndex(0), [props.activeRun?.id]);
  useEffect(() => {
    const persistedTitle = props.mediaJobs.find((job) => job.selectedTitle)?.selectedTitle;
    if (!persistedTitle || !delivery) return;
    const index = delivery.customerDeliverable.titles.indexOf(persistedTitle);
    if (index >= 0) setSelectedTitleIndex(index);
  }, [delivery, props.activeRun?.id, props.mediaJobs]);

  function submit(event: FormEvent) {
    event.preventDefault();
    props.onGenerate();
  }

  function copy(part: CopyPart, message: string) {
    if (!delivery) return;
    props.onCopy(buildBeautyXhsCustomerCopy(delivery, selectedTitleIndex, part), message);
  }

  const profileRows = [
    ["门店/品牌", props.profileSummary.store],
    ["城市", props.profileSummary.city],
    ["主推项目", props.profileSummary.project],
    ["目标顾客", props.profileSummary.audience],
    ["本次目标", props.profileSummary.goal]
  ];
  const imageDirections = props.mediaQuote?.imagePlan.directions ?? [
    { role: "cover" as const, label: "封面图", purpose: IMAGE_ROLE_COPY.cover },
    { role: "content" as const, label: "内容图", purpose: IMAGE_ROLE_COPY.content },
    { role: "engagement" as const, label: "互动承接图", purpose: IMAGE_ROLE_COPY.engagement }
  ];
  const selectedTitle = delivery?.customerDeliverable.titles[selectedTitleIndex] ?? delivery?.customerDeliverable.titles[0] ?? "";

  return <section className="beautyXhsWorkbench" data-testid="beauty-xhs-workbench">
    {props.preview && <p className="beautyXhsEnvironmentNotice" role="note">当前文字仅提供流程预览，不能作为正式发布内容；完成正式文字后可单独确认真实生成商业摄影感配图。</p>}
    <div className="beautyXhsWorkbenchGrid">
      <form className="beautyXhsBriefPanel" onSubmit={submit}>
        <header><span>01</span><div><strong>本次图文需求</strong><small>经营档案只作为默认值；这里的修改只属于本次任务，不会自动写回长期档案。</small></div></header>
        <section className="beautyXhsProfileSummary">
          <div><strong>经营档案默认资料</strong><button type="button" onClick={props.onOpenProfile}>查看长期档案</button></div>
          <dl>{profileRows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || "未填写"}</dd></div>)}</dl>
        </section>
        <label className="beautyXhsMainBrief">本次主题与目的（必填）<textarea rows={5} value={props.question} onChange={(event) => props.onQuestionChange(event.target.value)} placeholder="例如：为皮肤管理产品做一套面向附近女性顾客的小红书图文" aria-invalid={props.missingRequiredFields.includes("本次主题与目的")} /></label>
        <details className="beautyXhsOptionalFacts" open>
          <summary>直接编辑本次采用的信息</summary>
          <div>
            <label>目标顾客（必填）<input value={props.options.audience} onChange={(event) => props.onOptionsChange({ ...props.options, audience: event.target.value })} placeholder="只填已确认的人群" aria-invalid={props.missingRequiredFields.includes("目标顾客")} /><small>{props.options.audience.trim() ? "本次已填写" : props.profileSummary.audience ? `未填写时采用经营档案默认值：${props.profileSummary.audience}` : "请填写本次目标顾客"}</small></label>
            <label>本次项目（必填）<input value={props.options.project} onChange={(event) => props.onOptionsChange({ ...props.options, project: event.target.value })} placeholder="只填已确认的项目" aria-invalid={props.missingRequiredFields.includes("本次项目")} /><small>{props.options.project.trim() ? "本次已填写" : props.profileSummary.project ? `未填写时采用经营档案默认值：${props.profileSummary.project}` : "请填写本次项目"}</small></label>
            <label>本次城市（可选）<input value={props.options.city} onChange={(event) => props.onOptionsChange({ ...props.options, city: event.target.value })} placeholder="仅使用已确认城市" /></label>
            <label>门店事实（可选）<textarea rows={2} value={props.options.storeFacts} onChange={(event) => props.onOptionsChange({ ...props.options, storeFacts: event.target.value })} placeholder="例如：单店、可预约；不要填写未确认数据" /></label>
            <label>内容角度<input value={props.options.contentAngle} onChange={(event) => props.onOptionsChange({ ...props.options, contentAngle: event.target.value })} placeholder="例如：顾客常见困扰切入" /></label>
            <label>表达语气<input value={props.options.tone} onChange={(event) => props.onOptionsChange({ ...props.options, tone: event.target.value })} placeholder="例如：自然、温和、专业" /></label>
            <label>三图总体视觉要求<textarea rows={2} value={props.options.visualStyle} onChange={(event) => props.onOptionsChange({ ...props.options, visualStyle: event.target.value })} placeholder="例如：高级商业摄影、温暖自然光、真实材质与空间层次" /><small>默认生成非本店实景、无人出镜的通用美业场景。本店还原或人物场景需要已授权参考资料，当前不会伪造。</small></label>
            <label>本次明确事实<textarea rows={2} value={props.confirmedFacts} onChange={(event) => props.onConfirmedFactsChange(event.target.value)} placeholder="只写本次已确认且可用于文案和图片的事实" /></label>
            <label>明确禁用内容<textarea rows={2} value={props.options.prohibitedContent} onChange={(event) => props.onOptionsChange({ ...props.options, prohibitedContent: event.target.value })} placeholder="例如：价格、疗效、顾客案例、品牌文字、人物正脸" /></label>
          </div>
          <p>这些字段随本次任务保存；不会修改经营档案。需要长期复用时，请由你主动进入经营档案保存。</p>
        </details>
        {props.missingRequiredFields.length > 0 && <div className="beautyXhsRequiredNotice" role="alert" data-testid="xhs-required-fields"><strong>还不能生成文案</strong><p>请先补齐：{props.missingRequiredFields.join("、")}。补齐后才会调用模型和预留积分。</p></div>}
        <div className="beautyXhsGenerateActions">
          <button type="submit" className="beautyIndustryPrimary" disabled={props.busy || props.missingRequiredFields.length > 0}>{props.busy ? `正在生成文案 · ${props.elapsed}s` : "生成标题、正文和话题｜预计 8 积分"}</button>
          {props.busy && <button type="button" className="beautyIndustrySecondary" onClick={props.onCancel}>取消</button>}
        </div>
        <p className="beautyXhsSaveState">{props.savedAt ? `草稿已自动保存于 ${new Date(props.savedAt).toLocaleTimeString()}` : "输入会自动保存到当前租户"}<button type="button" onClick={props.onRestore}>恢复上次任务</button></p>
        {props.notice && <p className="beautyIndustryNotice" role="status">{props.notice}</p>}
        {props.error && <div className="beautyIndustryError" role="alert"><span>{props.error}</span><button type="button" onClick={props.onDismissError}>关闭</button></div>}
      </form>

      <article className="beautyXhsResultPanel">
        <header><div><span>02</span><div><strong>{delivery ? delivery.preview ? "图文流程预览" : "图文成品" : "等待生成"}</strong><small>{delivery ? "先选定一个标题，再复制或继续生成图片。" : "标题、正文和话题会在这里出现。"}</small></div></div>{props.activeRun && <time>{new Date(props.activeRun.createdAt).toLocaleString()}</time>}</header>
        {delivery ? <>
          {delivery.preview && <p className="beautyXhsPreviewBoundary">这是流程预览，不代表正式内容质量，也不建议直接发布。</p>}
          <section className="beautyXhsTitlePicker">
            <div className="beautyXhsSectionHead"><div><span>标题候选</span><strong>选择一个用于本次复制</strong></div><button type="button" data-testid="copy-xhs-title" onClick={() => copy("title", "已复制选中标题。")}>复制标题</button></div>
            <div>{delivery.customerDeliverable.titles.map((title, index) => <button key={`${index}-${title}`} type="button" data-testid="xhs-title-option" className={selectedTitleIndex === index ? "selected" : ""} aria-pressed={selectedTitleIndex === index} onClick={() => { setSelectedTitleIndex(index); props.onSelectedTitleChange(); }}><span>{index + 1}</span><strong>{title}</strong></button>)}</div>
          </section>
          <section className="beautyXhsCopySection">
            <div className="beautyXhsSectionHead"><div><span>正文</span><strong>客户阅读区</strong></div><button type="button" data-testid="copy-xhs-body" onClick={() => copy("body", "已复制正文。")}>复制正文</button></div>
            <p>{delivery.customerDeliverable.body}</p>
            {delivery.customerDeliverable.engagement && <aside><strong>互动承接</strong><p>{delivery.customerDeliverable.engagement}</p></aside>}
          </section>
          <section className="beautyXhsTopicSection">
            <div className="beautyXhsSectionHead"><div><span>话题</span><strong>共 {delivery.customerDeliverable.tags.length} 个</strong></div><button type="button" data-testid="copy-xhs-tags" onClick={() => copy("tags", "已复制话题。")}>复制话题</button></div>
            <div>{delivery.customerDeliverable.tags.map((tag) => <span key={tag}>{tag.startsWith("#") ? tag : `#${tag}`}</span>)}</div>
          </section>
          <button type="button" className="beautyXhsCopyPackage" data-testid="copy-xhs-package" onClick={() => copy("package", "已复制选中标题、正文和话题。")}>复制整套图文</button>

          {props.activeRun?.taskSnapshot && <details className="beautyXhsTaskSnapshot" open>
            <summary>本次采用的信息</summary>
            <dl>{[
              ["主题与目的", props.activeRun.taskSnapshot.themeAndPurpose],
              ["项目", props.activeRun.taskSnapshot.project],
              ["目标顾客", props.activeRun.taskSnapshot.audience],
              ["城市", props.activeRun.taskSnapshot.city],
              ["内容角度", props.activeRun.taskSnapshot.contentAngle],
              ["表达语气", props.activeRun.taskSnapshot.tone],
              ["三图视觉要求", props.activeRun.taskSnapshot.overallVisualRequirements],
              ["本次明确事实", props.activeRun.taskSnapshot.confirmedFacts],
              ["禁用内容", props.activeRun.taskSnapshot.prohibitedContent]
            ].filter(([, value]) => Boolean(value)).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
          </details>}

          <section className="beautyXhsImageDelivery">
            <header><div><span>03</span><div><strong>三张商业摄影感配图</strong><small>文案已保存后，再由你确认积分并真实生成；画面非本店实景。</small></div></div>{props.mediaQuote && <em>{props.mediaQuote.imageCount} 张 · {props.mediaQuote.creditCost} 积分</em>}</header>
            {props.mediaQuote?.imagePlan && <p className="beautyXhsLinkedTitle">接待咨询区、护理空间和到店承接空间将围绕已选择标题“{selectedTitle}”生成，并与本次图文一起恢复。</p>}
            <div className="beautyXhsImageCards">{imageDirections.map((direction, index) => {
              const job = props.mediaJobs[index];
              const isUsable = Boolean(job?.customerUsable && props.mediaObjectUrls[job.id]);
              const isRejected = job?.qualityStatus === "rejected" || job?.qualityStatus === "manual_review_required" || props.mediaBatchStatus === "quality_failed";
              const state = isUsable ? "已通过并保存" : isRejected ? "未达到交付标准" : job ? job.status === "failed" ? "生成失败" : job.status === "canceled" ? "已取消" : `生成中 ${job.progress}%` : "等待确认";
              return <article key={direction.role} data-testid="xhs-image-card" className={isUsable ? "passed" : isRejected ? "rejected" : ""}>
                <div>{isUsable ? <img src={props.mediaObjectUrls[job.id]} alt={`${direction.label}，已通过质量检查`} /> : <span>{state}</span>}</div>
                <strong>{direction.label}</strong><p>{IMAGE_ROLE_COPY[direction.role]}</p><small>{state}</small>
                {isUsable ? <button type="button" onClick={() => props.onDownloadImage(job, index)}>下载这张图片</button> : job?.canCancel ? <button type="button" onClick={() => props.onCancelImage(job.id)}>取消本张任务</button> : null}
              </article>;
            })}</div>
            {props.mediaBatchStatus === "quality_failed" && <div className="beautyXhsImageFailure" role="alert"><p>图片未达到交付标准，不建议使用；当前不提供查看或下载。积分按完整交付规则释放或补偿，本批不会自动补图。</p>{props.mediaQuote?.retryEligible && <button type="button" className="beautyIndustrySecondary" onClick={props.onPrepareImageRetry}>修改本次图片要求后重新生成</button>}</div>}
            {props.mediaBatchStatus === "succeeded" && props.mediaQuote?.regenerationEligible && <div className="beautyXhsImageRegeneration"><p>本批三张图片已交付。若需要换一组，请先修改本次图片要求并重新查看费用；不会自动生成或扣费。</p><button type="button" className="beautyIndustrySecondary" onClick={props.onPrepareImageRetry}>修改图片要求并重新报价</button></div>}
            {props.mediaJobs.length === 0 ? <button type="button" className="beautyIndustryPrimary" disabled={!props.mediaQuote?.canConfirm || props.mediaLoading} onClick={() => props.onConfirmImages(selectedTitle)}>{props.mediaLoading ? "正在创建真实图片任务…" : props.mediaQuote ? `确认真实生成三张图片｜${props.mediaQuote.creditCost} 积分` : "正在读取图片费用…"}</button> : props.mediaJobs.some((job) => job.canRecover || !["succeeded", "failed", "canceled"].includes(job.status)) ? <button type="button" className="beautyIndustrySecondary" disabled={props.mediaLoading} onClick={props.onResumeImages}>{props.mediaLoading ? "正在恢复任务状态…" : "恢复本批图片进度"}</button> : null}
            {props.mediaJobs.length > 0 && props.mediaBatchStatus === "quality_failed" && props.mediaQuote?.canConfirm && <button type="button" className="beautyIndustryPrimary" disabled={props.mediaLoading} onClick={() => props.onConfirmImages(selectedTitle)}>{props.mediaLoading ? "正在创建新的三图批次…" : `再次确认新批次｜${props.mediaQuote.creditCost} 积分`}</button>}
            {props.mediaJobs.length > 0 && props.mediaBatchStatus === "succeeded" && props.mediaQuote?.canConfirm && <button type="button" className="beautyIndustryPrimary" disabled={props.mediaLoading} onClick={() => props.onConfirmImages(selectedTitle)}>{props.mediaLoading ? "正在创建新的三图批次…" : `确认生成新一组三图｜${props.mediaQuote.creditCost} 积分`}</button>}
            {props.mediaQuote && !props.mediaQuote.canConfirm && <p className="beautyXhsMediaActionHint" role="status">{props.mediaQuote.message}</p>}
            <p className="beautyXhsPaidBoundary">确认一次只创建当前三图批次；失败不会自动重试、不会自动补图，也不会追加第 4 张。</p>
          </section>
        </> : <div className="beautyXhsEmptyResult"><span>标题</span><span>正文</span><span>话题</span><p>填写左侧需求后开始生成；结果会保存到当前租户，刷新后可以恢复。</p></div>}
      </article>
    </div>

    <details className="beautyXhsTaskHistory" data-testid="xhs-task-history">
      <summary>最近的小红书图文任务 <span>{props.history.length}</span></summary>
      <p>打开历史只恢复已保存结果，不会再次生成或扣费。</p>
      <div>{props.history.length ? props.history.map((run) => <button key={run.id} type="button" data-run-id={run.id} className={props.activeRun?.id === run.id ? "active" : ""} onClick={() => props.onSelectHistory(run.id)}><strong>{new Date(run.createdAt).toLocaleString()}</strong><span>{run.creditCost} 积分 · 已保存</span></button>) : <span>还没有已保存任务。</span>}</div>
    </details>
  </section>;
}

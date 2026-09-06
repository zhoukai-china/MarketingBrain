import { useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export const BEAUTY_LIVE_REVIEW_WORKFLOW_VERSION = "live_review_workflow_v1" as const;

export interface BeautyLiveReviewWorkflowDraft {
  version: typeof BEAUTY_LIVE_REVIEW_WORKFLOW_VERSION;
  scenario: "product" | "franchise" | "knowledge";
  platform: string;
  sessionTitle: string;
  sessionTime: string;
  businessObjective: string;
  liveData: string;
  recordingTranscript: string;
  scriptPlan: string;
  interactionEvidence: string;
  projectEvidence: string;
  conversionDefinition: string;
  visualEvidence: string;
  factBoundary: string;
  sourceFilename?: string;
  parseStatus?: "parsed" | "failed";
}

export interface BeautyLiveReviewRun {
  id: string;
  capabilityId?: string;
  skillId: string;
  output: string;
  creditCost: number;
  usageChannel?: string;
  abilityUsed?: string;
  createdAt: string;
}

interface Props {
  workflow: BeautyLiveReviewWorkflowDraft;
  onChange: (value: BeautyLiveReviewWorkflowDraft) => void;
  onParseFile: (file: File | undefined) => void;
  onRun: () => void;
  onCancel: () => void;
  onBackToLive: () => void;
  busy: boolean;
  fileParsing: boolean;
  elapsed: number;
  activeRun: BeautyLiveReviewRun | null;
  history: BeautyLiveReviewRun[];
  onSelectHistory: (run: BeautyLiveReviewRun) => void;
  permitted: boolean;
  savedAt: string;
  notice: string;
  error: string;
}

const FORMAL_SECTIONS = [
  "一、核心数据速览", "二、流量诊断", "三、转化归因", "四、互动诊断",
  "五、话术执行对照表", "六、人货场诊断", "七、方法论沉淀", "八、下次直播调整清单"
] as const;

const PLATFORM_EXPORT_GUIDANCE: Record<string, string> = {
  抖音: "抖音直播中心 → 数据中心 → 直播场次 → 导出当前场次明细",
  视频号: "视频号助手 → 直播数据 → 选择当前场次 → 导出明细",
  小红书: "小红书专业号平台 → 直播管理 → 数据复盘 → 导出场次数据",
  快手: "快手直播伴侣/创作者中心 → 直播数据 → 场次分析 → 导出",
  其他: "从对应平台后台导出单场数据，保留原始列名和时间粒度，不要手工补零"
};

export function createEmptyBeautyLiveReviewWorkflow(defaults?: Partial<BeautyLiveReviewWorkflowDraft>): BeautyLiveReviewWorkflowDraft {
  return {
    version: BEAUTY_LIVE_REVIEW_WORKFLOW_VERSION,
    scenario: "product",
    platform: "",
    sessionTitle: "",
    sessionTime: "",
    businessObjective: "",
    liveData: "",
    recordingTranscript: "",
    scriptPlan: "",
    interactionEvidence: "",
    projectEvidence: "",
    conversionDefinition: "",
    visualEvidence: "",
    factBoundary: "价格、优惠、疗效、案例、顾客身份和未提供数据均不得推断。",
    ...defaults
  };
}

export function getBeautyLiveReviewReadiness(workflow: BeautyLiveReviewWorkflowDraft) {
  const evidence = {
    data: Boolean(workflow.liveData.trim()),
    transcript: Boolean(workflow.recordingTranscript.trim()),
    plan: Boolean(workflow.scriptPlan.trim()),
    visual: Boolean(workflow.visualEvidence.trim())
  };
  const blocking = [
    !workflow.platform.trim() ? "选择直播平台" : "",
    !workflow.sessionTitle.trim() ? "填写直播间或场次名称" : "",
    !workflow.sessionTime.trim() ? "填写直播时间或统计周期" : "",
    !workflow.businessObjective.trim() ? "填写本场真实业务目标" : "",
    !workflow.factBoundary.trim() ? "确认事实边界" : "",
    !evidence.data && !evidence.transcript ? "补充真实直播数据或录音/录屏转写（至少一类）" : ""
  ].filter(Boolean);
  const degraded = [
    !evidence.data ? "数据待补：核心数据、流量、互动和转化模块不能给本场数值结论。" : "",
    !evidence.transcript ? "转写待补：不能引用主播原话或定位逐段话术、互动和转化原因。" : "",
    !evidence.plan ? "计划待补：话术执行对照表不能判断原计划与实际执行偏差。" : "",
    !evidence.visual ? "画面待补：人货场中的布景、陈列、镜头和人员状态保持待核验。" : ""
  ].filter(Boolean);
  return { evidence, blocking, degraded };
}

export function buildBeautyLiveReviewQuestion(workflow: BeautyLiveReviewWorkflowDraft): string {
  return [
    `请复盘${workflow.platform}场次“${workflow.sessionTitle}”（${workflow.sessionTime}）。`,
    `直播场景：${workflow.scenario}；本场业务目标：${workflow.businessObjective}。`,
    "严格依据本次正式工作流已核验的资料，按固定八模块输出；资料缺失处必须降级并列出下次补采动作。",
    "不得编造场观、停留、互动、咨询、成交、项目、价格、疗效、顾客反馈或已读取录屏。"
  ].join("\n");
}

export function BeautyLiveReviewWorkbench(props: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [copying, setCopying] = useState(false);
  const [localNotice, setLocalNotice] = useState("");
  const readiness = getBeautyLiveReviewReadiness(props.workflow);
  const sections = useMemo(() => splitReviewResult(props.activeRun?.output || ""), [props.activeRun?.output]);

  const update = (key: keyof BeautyLiveReviewWorkflowDraft, value: string) => {
    const next = { ...props.workflow, [key]: value };
    if (key === "liveData" && props.workflow.parseStatus === "parsed") {
      next.parseStatus = undefined;
      next.sourceFilename = undefined;
    }
    props.onChange(next);
    setLocalNotice("");
  };

  async function copyResult() {
    if (!props.activeRun?.output) return;
    setCopying(true);
    try {
      await navigator.clipboard.writeText(props.activeRun.output);
      setLocalNotice("直播复盘报告已复制；只包含当前租户已保存结果。");
    } catch {
      setLocalNotice("浏览器未允许复制，请检查剪贴板权限后重试。");
    } finally {
      setCopying(false);
    }
  }

  return <section className="beautyLiveReviewWorkbench" aria-label="直播复盘专属工作区">
    <header className="beautyLiveReviewHero">
      <div><button type="button" onClick={props.onBackToLive}>← 返回直播获客</button><span>数据/转写/计划 · 正式 V3</span><h1>直播复盘</h1><p>先核验当前场次的数据、转写和原话术计划，再按固定八模块形成问题、证据、原因边界与下一场动作。</p></div>
      <aside><strong>综合直播复盘</strong><span>固定 Skill · 不自由路由</span><em>{props.savedAt ? `自动保存 ${new Date(props.savedAt).toLocaleTimeString()}` : "填写中 · 刷新可恢复文字资料"}</em></aside>
    </header>

    {!props.permitted && <div className="beautyLiveReviewPermission" role="alert"><strong>当前账号未开放直播复盘</strong><p>页面不会绕过产品权限运行。请由管理员核对 entitlement 与 `acquisition:live-review` scope。</p></div>}

    <div className="beautyLiveReviewLayout">
      <form className="beautyLiveReviewForm" onSubmit={(event) => { event.preventDefault(); if (props.permitted && !readiness.blocking.length) props.onRun(); }}>
        <section className="beautyLiveReviewStep"><header><span>01</span><div><strong>确认当前场次</strong><small>场次、时间和目标是本次证据边界，不会读取未连接的平台账号。</small></div></header><div className="beautyLiveReviewFields">
          <label>直播场景<select value={props.workflow.scenario} onChange={(event) => update("scenario", event.target.value)}><option value="product">项目/产品型直播</option><option value="franchise">招商/合作型直播</option><option value="knowledge">知识/咨询型直播</option></select></label>
          <label>直播平台<select value={props.workflow.platform} onChange={(event) => update("platform", event.target.value)}><option value="">请选择真实平台</option>{Object.keys(PLATFORM_EXPORT_GUIDANCE).map((item) => <option key={item}>{item}</option>)}</select></label>
          <label>直播间/场次名称<input value={props.workflow.sessionTitle} onChange={(event) => update("sessionTitle", event.target.value)} placeholder="例如：8月25日晚场；不要填顾客姓名" /></label>
          <label>直播时间或统计周期<input value={props.workflow.sessionTime} onChange={(event) => update("sessionTime", event.target.value)} placeholder="按后台或转写真实时间填写" /></label>
          <label className="wide">本场真实业务目标<textarea rows={2} value={props.workflow.businessObjective} onChange={(event) => update("businessObjective", event.target.value)} placeholder="例如：核对项目讲解后的有效咨询承接；没有成交口径时不要写成交目标" /></label>
        </div></section>

        <section className="beautyLiveReviewStep"><header><span>02</span><div><strong>补充三类核心资料</strong><small>数据/转写/计划分别进入后端合同；缺一类只降级对应模块，不用另一类冒充。</small></div></header>
          <div className="beautyLiveReviewUpload"><input ref={fileInputRef} hidden type="file" accept=".csv,.xls,.xlsx" onChange={(event) => { props.onParseFile(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }} /><button type="button" disabled={!props.permitted || props.fileParsing || props.busy} onClick={() => fileInputRef.current?.click()}>{props.fileParsing ? "正在后端解析…" : props.workflow.parseStatus === "parsed" ? "重新选择场次数据" : "上传 CSV / Excel 场次数据"}</button><p>{props.workflow.platform ? PLATFORM_EXPORT_GUIDANCE[props.workflow.platform] : "先选择平台，页面会显示对应导出位置。"}</p><div className={props.workflow.parseStatus === "parsed" ? "parsed" : props.workflow.parseStatus === "failed" ? "failed" : "empty"}><strong>{props.workflow.parseStatus === "parsed" ? "当前文件解析成功" : props.workflow.parseStatus === "failed" ? "解析失败，未进入复盘" : "尚未上传数据文件"}</strong><span>{props.workflow.sourceFilename || "也可以在下方粘贴脱敏后的真实指标"}</span></div></div>
          <label>真实直播数据<textarea rows={6} value={props.workflow.liveData} onChange={(event) => update("liveData", event.target.value)} placeholder="粘贴当前场次后台指标，保留字段名、数值、单位和时间粒度；缺失值不要补零" /></label>
          <label>录音/录屏转写<textarea rows={7} value={props.workflow.recordingTranscript} onChange={(event) => update("recordingTranscript", event.target.value)} placeholder="粘贴当前场次真实转写；尽量保留时间戳。未做 ASR 时请明确未提供，不要写系统已听取" /></label>
          <label>原话术/直播计划<textarea rows={6} value={props.workflow.scriptPlan} onChange={(event) => update("scriptPlan", event.target.value)} placeholder="粘贴本场开播前确认的流程、话术或计划，用于与实际转写对照" /></label>
        </section>

        <section className="beautyLiveReviewStep"><header><span>03</span><div><strong>补充业务口径与可核验证据</strong><small>选填项只扩展有证据的模块；未提供时报告必须保持待补。</small></div></header><div className="beautyLiveReviewFields oneColumn">
          <label>互动证据（选填）<textarea rows={3} value={props.workflow.interactionEvidence} onChange={(event) => update("interactionEvidence", event.target.value)} placeholder="只填已脱敏评论、提问类型、互动时段或后台互动字段" /></label>
          <label>项目/商品事实（选填）<textarea rows={3} value={props.workflow.projectEvidence} onChange={(event) => update("projectEvidence", event.target.value)} placeholder="只填已确认项目、权益和真实讲解信息；价格、库存、疗效未知时留空" /></label>
          <label>咨询/成交口径（选填）<textarea rows={3} value={props.workflow.conversionDefinition} onChange={(event) => update("conversionDefinition", event.target.value)} placeholder="说明哪些字段代表有效咨询、预约、到店或成交；未提供时不做转化结论" /></label>
          <label>用户确认的画面/场景证据（选填）<textarea rows={3} value={props.workflow.visualEvidence} onChange={(event) => update("visualEvidence", event.target.value)} placeholder="只填你已核对的主播、布景、项目陈列或录屏时间点；本页不会上传或自动理解录屏" /></label>
          <label>事实边界<textarea rows={3} value={props.workflow.factBoundary} onChange={(event) => update("factBoundary", event.target.value)} /></label>
        </div></section>

        {readiness.blocking.length > 0 && <div className="beautyLiveReviewBlocking" role="status"><strong>正式复盘前还需要</strong><ul>{readiness.blocking.map((item) => <li key={item}>{item}</li>)}</ul><p>资料请从平台直播后台、当前场次转写或开播前确认的话术计划补充；三类核心资料全缺时不会调用 Provider 或扣积分。</p></div>}
        <div className="beautyLiveReviewActions"><button className="beautyIndustryPrimary" type="submit" disabled={!props.permitted || props.busy || props.fileParsing || readiness.blocking.length > 0}>{props.busy ? `正在复盘 · ${props.elapsed}s` : "开始正式直播复盘｜预计15积分"}</button>{props.busy && <button className="beautyIndustrySecondary" type="button" onClick={props.onCancel}>取消</button>}</div>
        {props.busy && <p className="beautyLiveReviewProgress" role="status">正在核验三类证据 → 生成八模块报告 → 保存当前租户结果；失败或取消不会自动重试。</p>}
        {props.notice && <p className="beautyIndustryNotice" role="status">{props.notice}</p>}{props.error && <p className="beautyIndustryError" role="alert">{props.error}</p>}
      </form>

      <aside className="beautyLiveReviewEvidence"><header><span>证据核验</span><h2>{readiness.blocking.length ? "待补必要资料" : "可以按当前证据复盘"}</h2><p>就绪仅代表输入合同通过，不代表系统已连接平台或读取录屏。</p></header><div className="beautyLiveReviewEvidenceCards">
        <article className={readiness.evidence.data ? "ready" : "missing"}><strong>直播数据</strong><span>{readiness.evidence.data ? "已提供" : "待补"}</span></article>
        <article className={readiness.evidence.transcript ? "ready" : "missing"}><strong>场次转写</strong><span>{readiness.evidence.transcript ? "已提供" : "待补"}</span></article>
        <article className={readiness.evidence.plan ? "ready" : "missing"}><strong>原话术计划</strong><span>{readiness.evidence.plan ? "已提供" : "待补"}</span></article>
        <article className={readiness.evidence.visual ? "ready" : "missing"}><strong>画面证据</strong><span>{readiness.evidence.visual ? "用户已确认" : "待补"}</span></article>
      </div><section><strong>缺失资料影响</strong><ul>{readiness.degraded.map((item) => <li key={item}>{item}</li>)}</ul></section><section><strong>费用与媒体边界</strong><p>CSV/Excel 解析为零 Provider、零积分；本页不上传直播录屏，不调用视觉或 ASR。点击正式复盘才进入现有文本 Skill 与统一账本。</p></section></aside>
    </div>

    <section className="beautyLiveReviewResult"><header className="beautyIndustryResultHead"><div><span>04 · 当前租户已保存结果</span><h2>{props.activeRun ? "正式直播复盘报告" : "等待当前场次证据"}</h2></div>{props.activeRun && <button type="button" disabled={copying} onClick={() => void copyResult()}>{copying ? "复制中…" : "复制复盘报告"}</button>}</header>{props.activeRun ? <><div className="beautyIndustryMeta"><span>{props.activeRun.creditCost} 积分</span><span>{props.activeRun.usageChannel === "mcp" ? "WorkBuddy" : "网页"}</span><span>本次使用：{props.activeRun.abilityUsed || "直播复盘"}</span><span>{new Date(props.activeRun.createdAt).toLocaleString()}</span></div><nav aria-label="直播复盘报告章节">{FORMAL_SECTIONS.map((section) => <span key={section} className={props.activeRun?.output.includes(section) ? "present" : "limited"}>{section}</span>)}</nav><div className="beautyLiveReviewReport">{sections.map((section) => <section key={section.title}><h3>{section.title}</h3><ReactMarkdown remarkPlugins={[remarkGfm]}>{section.body}</ReactMarkdown></section>)}</div>{localNotice && <p className="beautyIndustryNotice" role="status">{localNotice}</p>}</> : <div className="beautyIndustryEmpty"><h3>先核验一场真实直播</h3><p>完整结果固定展示八个模块；缺失资料会在对应模块标记待补，不生成模板结论。</p></div>}</section>

    <details className="beautyLiveReviewHistory"><summary>直播复盘历史 <span>{props.history.length} 条</span></summary><p>网页与 WorkBuddy 共用同一 AgentRun；恢复记录不会再次调用或扣积分。</p><div className="beautyIndustryHistoryList">{props.history.length ? props.history.map((run) => <button key={run.id} type="button" className={props.activeRun?.id === run.id ? "active" : ""} onClick={() => props.onSelectHistory(run)}><strong>直播复盘</strong><span>{run.usageChannel === "mcp" ? "WorkBuddy" : "网页"} · {run.creditCost} 积分</span><time>{new Date(run.createdAt).toLocaleString()}</time></button>) : <p>当前租户还没有直播复盘记录。</p>}</div></details>
  </section>;
}

function splitReviewResult(markdown: string): Array<{ title: string; body: string }> {
  if (!markdown.trim()) return [];
  const matches = [...markdown.matchAll(/^##\s+(.+)$/gm)];
  if (!matches.length) return [{ title: "直播复盘报告", body: markdown }];
  return matches.map((match, index) => ({
    title: match[1]?.trim() || `复盘模块 ${index + 1}`,
    body: markdown.slice((match.index ?? 0) + match[0].length, matches[index + 1]?.index ?? markdown.length).trim()
  }));
}

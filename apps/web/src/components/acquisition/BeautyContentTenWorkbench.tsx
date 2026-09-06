import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { apiPath } from "../../lib/api.js";
import { normalizeFilenamePart } from "../../lib/utils.js";
import { splitContentDelivery } from "./contentDelivery.js";

export const BEAUTY_CONTENT_WORKFLOW_VERSION = "content_workflow_v1" as const;

export interface BeautyContentWorkflowDraft {
  version: typeof BEAUTY_CONTENT_WORKFLOW_VERSION;
  topic: string;
  objective: string;
  targetAudience: string;
  platform: string;
  format: string;
  duration: string;
  presenter: string;
  projectFacts: string;
  shootingConstraints: string;
  sourceTopic?: {
    topic: string;
    audience: string;
    sourceEvidence: string;
    factBoundary: string;
    goalRelation: string;
  };
}

export interface BeautyContentTenRun {
  id: string;
  capabilityId?: string;
  skillId: string;
  output: string;
  creditCost: number;
  usageChannel?: string;
  abilityUsed?: string;
  createdAt: string;
  structuredDelivery?: {
    version: string;
    preview: boolean;
    customerDeliverable: { copyMarkdown: string };
    productionNotes: { markdown: string };
    auditReceipt: { markdown: string };
  };
}

interface Props {
  workflow: BeautyContentWorkflowDraft;
  onChange: (value: BeautyContentWorkflowDraft) => void;
  onGenerate: () => void;
  onCancel: () => void;
  onBackToTopics: () => void;
  busy: boolean;
  elapsed: number;
  sourceRunId?: string;
  activeRun: BeautyContentTenRun | null;
  history: BeautyContentTenRun[];
  onSelectHistory: (run: BeautyContentTenRun) => void;
  headers: Record<string, string>;
  savedAt: string;
  notice: string;
  error: string;
  preview: boolean;
}

const V5_HEADINGS = [
  "短结论",
  "一、选题",
  "二、口播逐字稿",
  "三、访谈话术",
  "四、拍摄脚本",
  "五、拍摄注意事项",
  "六、剪辑EDL",
  "七、发布标题与话题",
  "八、最佳发布时间",
  "九、评论区引导话术",
  "十、投流建议"
] as const;

export function createEmptyBeautyContentWorkflow(defaults?: Partial<BeautyContentWorkflowDraft>): BeautyContentWorkflowDraft {
  return {
    version: BEAUTY_CONTENT_WORKFLOW_VERSION,
    topic: "",
    objective: "",
    targetAudience: "",
    platform: "抖音",
    format: "真人口播短视频",
    duration: "60秒内",
    presenter: "",
    projectFacts: "",
    shootingConstraints: "",
    ...defaults
  };
}

export function getBeautyContentMissingFields(workflow: BeautyContentWorkflowDraft): string[] {
  const missing: string[] = [];
  if (workflow.topic.trim().length < 2) missing.push("本次选题或内容任务");
  if (workflow.objective.trim().length < 2) missing.push("本轮获客目标");
  if (workflow.targetAudience.trim().length < 2) missing.push("目标顾客");
  if (!workflow.platform.trim()) missing.push("发布平台");
  return missing;
}

export function BeautyContentTenWorkbench(props: Props) {
  const [copying, setCopying] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [actionNotice, setActionNotice] = useState("");
  const missing = getBeautyContentMissingFields(props.workflow);
  const customerOutput = useMemo(() => {
    if (!props.activeRun?.output) return "";
    if (props.activeRun.structuredDelivery?.customerDeliverable.copyMarkdown) return props.activeRun.structuredDelivery.customerDeliverable.copyMarkdown;
    const auditIndex = props.activeRun.output.indexOf("## 质量与合规检查");
    return (auditIndex >= 0 ? props.activeRun.output.slice(0, auditIndex) : props.activeRun.output).trim();
  }, [props.activeRun]);
  const auditOutput = useMemo(() => {
    if (props.activeRun?.structuredDelivery?.auditReceipt.markdown) return props.activeRun.structuredDelivery.auditReceipt.markdown;
    const marker = "## 质量与合规检查";
    const auditIndex = props.activeRun?.output.indexOf(marker) ?? -1;
    return auditIndex >= 0 ? props.activeRun!.output.slice(auditIndex + marker.length).trim() : "";
  }, [props.activeRun]);
  const delivery = useMemo(
    () => customerOutput ? splitContentDelivery(customerOutput) : undefined,
    [customerOutput]
  );

  const update = (key: keyof BeautyContentWorkflowDraft, value: string) => {
    props.onChange({ ...props.workflow, [key]: value });
    setActionNotice("");
  };

  async function copyDelivery(): Promise<void> {
    if (!customerOutput) return;
    setCopying(true);
    try {
      await navigator.clipboard.writeText(customerOutput);
      setActionNotice(`${props.preview ? "流程预览" : "十件交付"}已复制；不包含质量审核、内部路由、Skill 或模型日志。`);
    } catch {
      setActionNotice("浏览器未允许复制，请检查剪贴板权限后重试。");
    } finally {
      setCopying(false);
    }
  }

  async function downloadWord(): Promise<void> {
    if (!customerOutput || downloading) return;
    setDownloading(true);
    setActionNotice("正在生成排版 Word…");
    try {
      const taskSummary = [
        "内容系统（十件交付）",
        `本次任务：${props.workflow.topic}`,
        `目标顾客：${props.workflow.targetAudience}`,
        `本轮目标：${props.workflow.objective}`,
        `发布平台：${props.workflow.platform}`,
        props.workflow.format ? `内容形式：${props.workflow.format}` : "",
        props.workflow.duration ? `建议时长：${props.workflow.duration}` : "",
        "",
        customerOutput
      ].filter((item, index, values) => item || (index > 0 && values[index - 1])).join("\n");
      const response = await fetch(apiPath("/exports/docx"), {
        method: "POST",
        headers: { ...props.headers, "Content-Type": "application/json" },
        body: JSON.stringify({ title: "美业内容系统", content: taskSummary })
      });
      const data = await response.json().catch(() => ({})) as { downloadUrl?: string; filename?: string; message?: string };
      if (!response.ok || !data.downloadUrl) throw new Error(data.message || "Word 文件生成失败");
      const fileResponse = await fetch(apiPath(data.downloadUrl), { headers: props.headers });
      if (!fileResponse.ok) throw new Error("Word 文件下载失败");
      const url = URL.createObjectURL(await fileResponse.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = data.filename || `${normalizeFilenamePart("美业内容系统")}.docx`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setActionNotice("Word 已生成并下载；文件仅包含本次任务摘要和十件交付正文。");
    } catch (reason) {
      setActionNotice(reason instanceof Error ? reason.message : "Word 文件生成失败，请稍后重试。");
    } finally {
      setDownloading(false);
    }
  }

  return <section className="beautyContentTenWorkbench" aria-label="内容系统专属工作区">
    <header className="beautyContentTenHero">
      <div>
        <button type="button" onClick={props.onBackToTopics}>← 返回选题系统</button>
        <span>{props.preview ? "流程预览 · 非正式生成" : "CONTENT SKILL V5"}</span>
        <h2>内容系统</h2>
        <p>把一个已选选题或本次内容任务，转成十件可拍、可剪、可发布、可复盘的内容交付。</p>
      </div>
      <aside><strong>{props.sourceRunId ? "已承接" : "直接创建"}</strong><span>{props.sourceRunId ? "来自 TOP10，不会重新跑选题" : "填写本次内容任务"}</span><em>{props.savedAt ? `自动保存 ${new Date(props.savedAt).toLocaleTimeString()}` : "等待输入"}</em></aside>
    </header>

    <div className="beautyContentTenGrid">
      <form className="beautyContentTenBrief" onSubmit={(event) => { event.preventDefault(); if (!missing.length) props.onGenerate(); }}>
        <header><span>01</span><div><strong>本次内容任务</strong><small>页面字段直接对应 content skill V5 输入，不会根据关键词切换到其他能力。</small></div></header>
        {props.workflow.sourceTopic && <section className="beautyContentSourceCard">
          <b>已从选题系统承接</b><strong>{props.workflow.sourceTopic.topic}</strong><p>{props.workflow.sourceTopic.sourceEvidence}</p><small>{props.workflow.sourceTopic.factBoundary}</small>
        </section>}
        <label>选题 / 内容任务<textarea rows={4} value={props.workflow.topic} onChange={(event) => update("topic", event.target.value)} placeholder="例如：第一次做基础补水护理前，先确认这三件事" /></label>
        <label>本轮获客目标<input value={props.workflow.objective} onChange={(event) => update("objective", event.target.value)} placeholder="例如：让附近成年顾客发起咨询并了解预约流程" /></label>
        <label>目标顾客<input value={props.workflow.targetAudience} onChange={(event) => update("targetAudience", event.target.value)} placeholder="例如：门店附近关注日常皮肤护理的成年顾客" /></label>
        <div className="beautyContentTenFields">
          <label>发布平台<input value={props.workflow.platform} onChange={(event) => update("platform", event.target.value)} /></label>
          <label>内容形式<input value={props.workflow.format} onChange={(event) => update("format", event.target.value)} placeholder="真人口播、探店记录…" /></label>
          <label>建议时长<input value={props.workflow.duration} onChange={(event) => update("duration", event.target.value)} placeholder="例如：60秒内" /></label>
          <label>出镜/表达主体<input value={props.workflow.presenter} onChange={(event) => update("presenter", event.target.value)} placeholder="例如：店长本人；未确认可留空" /></label>
        </div>

        <section className={`beautyContentFollowup ${missing.length ? "needed" : "ready"}`}>
          <header><span>02</span><div><strong>需要补充什么</strong><small>{missing.length ? "补齐真正影响生成的必填项后，在同一任务继续。" : "必填简报已齐；下面资料可选填，未提供时只进入折叠的质量审核，不会污染十件交付。"}</small></div></header>
          {missing.length > 0 && <ul>{missing.map((item) => <li key={item}>{item}</li>)}</ul>}
          <label>本次可使用的项目与服务事实（选填）<textarea rows={3} value={props.workflow.projectFacts} onChange={(event) => update("projectFacts", event.target.value)} placeholder="只填已确认项目、服务特色、门店环境或活动；不要填疗效、虚构案例或顾客隐私" /></label>
          <label>拍摄与素材约束（选填）<textarea rows={3} value={props.workflow.shootingConstraints} onChange={(event) => update("shootingConstraints", event.target.value)} placeholder="例如：不出现顾客正脸；只拍授权门店区域；竖屏拍摄" /></label>
        </section>

        <div className="beautyContentTenActions">
          <button type="submit" className="beautyIndustryPrimary" disabled={props.busy || missing.length > 0}>{props.busy ? `生成内容中 · ${props.elapsed}s` : props.preview ? "生成内容系统流程预览｜预计12积分" : "生成内容系统｜预计12积分"}</button>
          {props.busy && <button type="button" className="beautyIndustrySecondary" onClick={props.onCancel}>取消</button>}
        </div>
        {props.busy && <p className="beautyContentGenerationState" role="status">正在核对简报 → 生成十件交付 → 检查事实与结构 → 保存；可取消，不会自动重试。</p>}
        {props.notice && <p className="beautyIndustryNotice" role="status">{props.notice}</p>}
        {props.error && <p className="beautyIndustryError" role="alert">{props.error}</p>}
      </form>

      <article className="beautyContentTenResult">
        <header className="beautyIndustryResultHead"><div><span>03 · {props.preview ? "已保存流程预览" : "已保存交付"}</span><h2>{props.activeRun ? props.preview ? "内容系统流程预览（非正式生成）" : "正式 V5 内容系统" : "等待生成"}</h2></div>{props.activeRun && <div className="beautyContentResultActions"><button type="button" disabled={copying} onClick={() => void copyDelivery()}>{copying ? "复制中…" : props.preview ? "复制预览内容" : "复制十件交付"}</button><button type="button" disabled={downloading} onClick={() => void downloadWord()}>{downloading ? "正在生成 Word…" : "下载 Word"}</button></div>}</header>
        {props.activeRun ? <>
          <div className="beautyIndustryMeta"><span>{props.activeRun.creditCost} 积分</span><span>{props.activeRun.usageChannel === "mcp" ? "WorkBuddy" : "网页"}</span><span>本次使用：{props.activeRun.abilityUsed || "内容系统"}</span><span>{new Date(props.activeRun.createdAt).toLocaleString()}</span></div>
          {delivery && delivery.sections.length === 10 ? <div className="contentDeliveryLayout">
            {delivery.preface.length > 0 && <div className="contentDeliveryPreface"><ReactMarkdown remarkPlugins={[remarkGfm]}>{delivery.preface.join("\n")}</ReactMarkdown></div>}
            <div className="contentDeliveryCards">{delivery.sections.map((section, index) => <article key={`${section.title}-${index}`} className={`contentDeliveryCard section-${index + 1}`}><header><span>{String(index + 1).padStart(2, "0")}</span><h4>{section.title}</h4></header><div><ReactMarkdown remarkPlugins={[remarkGfm]}>{section.lines.join("\n")}</ReactMarkdown></div></article>)}</div>
          </div> : <div className="beautyIndustryMarkdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{customerOutput}</ReactMarkdown></div>}
          {auditOutput && <details className="beautyContentAudit"><summary>质量与合规检查</summary><ReactMarkdown remarkPlugins={[remarkGfm]}>{auditOutput}</ReactMarkdown></details>}
          {actionNotice && <p className="beautyIndustryNotice" role="status">{actionNotice}</p>}
        </> : <div className="beautyIndustryEmpty"><h3>先完成左侧简报</h3><p>生成结果会按 V5 十项分卡展示，并保存到当前租户任务历史。</p></div>}
      </article>
    </div>

    <details className="beautyContentHistory">
      <summary>任务历史 <span>{props.history.length} 条</span></summary>
      <p>历史已收纳；恢复记录不会再次调用模型或扣积分。</p>
      <div className="beautyIndustryHistoryList">{props.history.length ? props.history.map((run) => <button key={run.id} type="button" className={props.activeRun?.id === run.id ? "active" : ""} onClick={() => props.onSelectHistory(run)}><strong>内容系统</strong><span>{run.usageChannel === "mcp" ? "WorkBuddy" : "网页"} · {run.creditCost} 积分</span><time>{new Date(run.createdAt).toLocaleString()}</time></button>) : <p>还没有内容系统记录。</p>}</div>
    </details>
    <span className="beautyContentTenContract" hidden>{V5_HEADINGS.join("｜")}</span>
  </section>;
}

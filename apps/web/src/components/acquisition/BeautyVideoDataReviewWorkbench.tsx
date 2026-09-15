import { useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export const BEAUTY_VIDEO_REVIEW_WORKFLOW_VERSION = "video_data_review_workflow_v1" as const;

export interface BeautyVideoReviewWorkflowDraft {
  version: typeof BEAUTY_VIDEO_REVIEW_WORKFLOW_VERSION;
  platform: string;
  reviewPeriod: string;
  reviewGoal: string;
  conversionDefinition: string;
  observationWindow: string;
}

export interface BeautyVideoDataReviewRun {
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
  workflow: BeautyVideoReviewWorkflowDraft;
  onChange: (value: BeautyVideoReviewWorkflowDraft) => void;
  onParseFile: (file: File | undefined) => void;
  onGenerate: () => void;
  onCancel: () => void;
  onBackToVideo: () => void;
  onOpenTopics: () => void;
  busy: boolean;
  fileParsing: boolean;
  elapsed: number;
  parseStatus: "" | "parsed" | "failed";
  parsedEvidence: string;
  sourceFilename: string;
  activeRun: BeautyVideoDataReviewRun | null;
  history: BeautyVideoDataReviewRun[];
  onSelectHistory: (run: BeautyVideoDataReviewRun) => void;
  savedAt: string;
  notice: string;
  error: string;
  permitted: boolean;
}

const PLATFORM_GUIDANCE: Record<string, string> = {
  抖音: "抖音创作者中心（电脑版）→ 内容管理 → 视频数据 → 选择时间范围 → 导出数据",
  视频号: "视频号助手 → 数据中心 → 内容数据 → 选择时间范围 → 导出明细"
};

const EVIDENCE_GROUPS = [
  { key: "title", label: "作品标题", pattern: /作品标题|视频标题|笔记标题|标题|视频描述|内容名称/i, required: true, impact: "无法把结论追溯到具体作品；请从平台作品明细重新导出。" },
  { key: "play", label: "播放/观看", pattern: /播放量|观看量|播放次数|曝光量|观看次数/i, required: true, impact: "无法计算播放基线与作品分层；请补导播放或观看字段。" },
  { key: "date", label: "发布日期", pattern: /发布时间|发布日期|发布日|日期|时间/i, required: false, impact: "无法判断趋势和发布周期；请补导发布日期，最好包含时分。" },
  { key: "completion", label: "完播/观看时长", pattern: /完播率|五秒完播|5秒完播|平均播放时长|平均观看时长|观看时长/i, required: false, impact: "无法做完播率深层归因；缺失值会保持未提供，不按零处理。" },
  { key: "engagement", label: "点赞评论分享", pattern: /点赞|喜欢|评论|分享|收藏/i, required: false, impact: "互动率只能按已提供字段计算；缺少的互动项不会补成零。" },
  { key: "conversion", label: "咨询/预约/到店", pattern: /咨询|私信|线索|留资|预约|到店|核销|订单|成交|转化/i, required: false, impact: "无法判断业务转化，只能复盘内容表现；请从线索或门店台账补齐同周期口径。" },
  { key: "paid", label: "自然/付费标记", pattern: /投流|付费|自然流|消耗|金额|ROI|DOU/i, required: false, impact: "未区分自然/付费时，不判断投流效果或 ROI。" }
] as const;

const FORMAL_SECTIONS = [
  "数据质量审计", "数据总览", "视频分层", "内容结构健康度", "单条深拆", "完播率深层归因",
  "互动深度分析", "趋势分析", "规律总结", "方法论沉淀", "下周期选题建议", "综合诊断结论"
] as const;

export function createEmptyBeautyVideoReviewWorkflow(defaults?: Partial<BeautyVideoReviewWorkflowDraft>): BeautyVideoReviewWorkflowDraft {
  return {
    version: BEAUTY_VIDEO_REVIEW_WORKFLOW_VERSION,
    platform: "",
    reviewPeriod: "",
    reviewGoal: "账号表现与下周期选题",
    conversionDefinition: "",
    observationWindow: "",
    ...defaults
  };
}

export function getBeautyVideoReviewMissingFields(workflow: BeautyVideoReviewWorkflowDraft, parseStatus: Props["parseStatus"], parsedEvidence: string): string[] {
  const missing: string[] = [];
  if (!workflow.platform.trim()) missing.push("选择数据平台");
  if (workflow.reviewPeriod.trim().length < 2) missing.push("填写复盘周期");
  if (parseStatus !== "parsed" || !parsedEvidence.trim()) missing.push("上传并成功解析 CSV、XLS 或 XLSX 数据文件");
  return missing;
}

export function buildBeautyVideoReviewQuestion(workflow: BeautyVideoReviewWorkflowDraft): string {
  return [
    `请复盘${workflow.platform}在${workflow.reviewPeriod}的后台作品数据。`,
    `本轮目标：${workflow.reviewGoal}。`,
    workflow.conversionDefinition.trim() ? `业务转化口径：${workflow.conversionDefinition.trim()}。` : "未提供业务转化口径；不得推断咨询、预约、到店或成交。",
    workflow.observationWindow.trim() ? `数据观察窗口：${workflow.observationWindow.trim()}。` : "未提供统一观察窗口；涉及跨作品比较时明确证据限制。",
    "逐行核对已解析字段，缺失值保持缺失；按正式视频数据复盘合同输出，不分析未提供的画面、口播、拍摄或剪辑。"
  ].join("\n");
}

export function buildBeautyVideoReviewContentStructure(workflow: BeautyVideoReviewWorkflowDraft): string {
  return [
    `复盘周期：${workflow.reviewPeriod || "待补"}`,
    `复盘目标：${workflow.reviewGoal}`,
    `业务转化口径：${workflow.conversionDefinition.trim() || "未提供，不做转化推断"}`,
    `观察窗口：${workflow.observationWindow.trim() || "未提供，跨作品比较需标注限制"}`
  ].join("；");
}

export function BeautyVideoDataReviewWorkbench(props: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [copying, setCopying] = useState(false);
  const [actionNotice, setActionNotice] = useState("");
  const missing = getBeautyVideoReviewMissingFields(props.workflow, props.parseStatus, props.parsedEvidence);
  const evidence = useMemo(() => inspectEvidence(props.parsedEvidence), [props.parsedEvidence]);
  const resultSections = useMemo(() => splitReviewResult(props.activeRun?.output || ""), [props.activeRun?.output]);

  const update = (key: keyof BeautyVideoReviewWorkflowDraft, value: string) => {
    props.onChange({ ...props.workflow, [key]: value });
    setActionNotice("");
  };

  async function copyResult(): Promise<void> {
    if (!props.activeRun?.output) return;
    setCopying(true);
    try {
      await navigator.clipboard.writeText(props.activeRun.output);
      setActionNotice("复盘报告已复制；只包含当前租户已保存的本次结果。");
    } catch {
      setActionNotice("浏览器未允许复制，请检查剪贴板权限后重试。");
    } finally {
      setCopying(false);
    }
  }

  return <section className="beautyVideoReviewWorkbench" aria-label="视频数据复盘专属工作区">
    <header className="beautyVideoReviewHero">
      <div>
        <button type="button" onClick={props.onBackToVideo}>← 返回视频获客</button>
        <span>结构化视频数据复盘 · V2</span>
        <h2>视频数据复盘</h2>
        <p>上传平台后台真实数据，先审计字段与口径，再做作品分层、规律判断和下一周期单变量测试建议。</p>
      </div>
      <aside><strong>只读数据证据</strong><span>CSV、XLS 或 XLSX</span><em>{props.savedAt ? `自动保存 ${new Date(props.savedAt).toLocaleTimeString()}` : "填写中 · 刷新后可恢复"}</em></aside>
    </header>

    {!props.permitted && <div className="beautyVideoReviewPermission" role="alert"><strong>当前账号未开放视频数据复盘</strong><p>页面不会绕过产品权限发起运行。请由管理员核对美业产品 entitlement 与 `acquisition:video-data-review` scope。</p></div>}

    <div className="beautyVideoReviewGrid">
      <form className="beautyVideoReviewBrief" onSubmit={(event) => { event.preventDefault(); if (props.permitted && !missing.length) props.onGenerate(); }}>
        <header><span>01</span><div><strong>确认数据来源与复盘口径</strong><small>页面字段固定进入视频数据复盘合同，不会根据自由文本切换 Skill。</small></div></header>
        <div className="beautyVideoReviewFields">
          <label>选择数据平台<select value={props.workflow.platform} onChange={(event) => update("platform", event.target.value)}><option value="">请选择真实来源</option>{Object.keys(PLATFORM_GUIDANCE).map((platform) => <option key={platform}>{platform}</option>)}</select></label>
          <label>复盘周期<input value={props.workflow.reviewPeriod} onChange={(event) => update("reviewPeriod", event.target.value)} placeholder="按导出文件真实时间范围填写" /></label>
          <label>本轮复盘目标<select value={props.workflow.reviewGoal} onChange={(event) => update("reviewGoal", event.target.value)}><option>账号表现与下周期选题</option><option>定位完播与互动卡点</option><option>核对业务转化链路</option><option>比较自然流与付费流</option></select></label>
          <label>统一观察窗口（选填）<input value={props.workflow.observationWindow} onChange={(event) => update("observationWindow", event.target.value)} placeholder="例如：每条作品发布后采用相同观察窗口" /></label>
        </div>
        <label>业务转化口径（有真实数据时填写）<textarea rows={3} value={props.workflow.conversionDefinition} onChange={(event) => update("conversionDefinition", event.target.value)} placeholder="说明哪些字段代表有效咨询、预约、到店或成交；未提供时系统不会推断" /></label>

        <section className="beautyVideoReviewUpload">
          <header><span>02</span><div><strong>上传平台数据文件</strong><small>{props.workflow.platform ? PLATFORM_GUIDANCE[props.workflow.platform] : "先选择数据平台，页面会显示对应导出位置。"}</small></div></header>
          <input ref={fileInputRef} hidden type="file" accept=".csv,.xlsx,.xls" onChange={(event) => { const file = event.currentTarget.files?.[0]; props.onParseFile(file); event.currentTarget.value = ""; }} />
          <button type="button" className="beautyVideoReviewFileButton" disabled={!props.permitted || props.fileParsing || props.busy} onClick={() => fileInputRef.current?.click()}>{props.fileParsing ? "正在后端解析…" : props.parseStatus === "parsed" ? "重新选择文件" : "选择 CSV / Excel 文件"}</button>
          <div className={`beautyVideoReviewFileState ${props.parseStatus || "empty"}`}>
            <strong>{props.parseStatus === "parsed" ? "解析成功" : props.parseStatus === "failed" ? "解析失败，已停止" : "尚未读取数据"}</strong>
            <span>{props.sourceFilename || "文件名会在成功解析后显示"}</span>
            <p>{props.parseStatus === "parsed" ? "只有下方后端解析证据会进入当前复盘；不会读取视频画面、音频或其他租户文件。" : props.parseStatus === "failed" ? "请回到对应平台后台重新导出逐条作品数据，再重新选择文件；失败状态不会调用复盘能力或扣积分。" : "接受 CSV、XLS 或 XLSX；空文件、错误类型和无法读取的工作簿会失败关闭。"}</p>
          </div>
        </section>

        {props.parseStatus === "parsed" && <section className="beautyVideoEvidenceAudit">
          <header><span>03</span><div><strong>字段覆盖</strong><small>只显示本次解析文本真实命中的维度，不代表平台已连接。</small></div></header>
          <div className="beautyVideoEvidenceChips">{EVIDENCE_GROUPS.map((group) => <span key={group.key} className={evidence.found.has(group.key) ? "found" : "missing"}>{evidence.found.has(group.key) ? "已读取" : "待补"} · {group.label}</span>)}</div>
          <div className="beautyVideoMissingEvidence"><strong>缺失资料与影响</strong>{evidence.missing.length ? <ul>{evidence.missing.map((item) => <li key={item.key}><b>{item.label}</b><span>{item.impact}</span></li>)}</ul> : <p>正式复盘所需主要维度均已在解析文本中命中；最终仍以逐行数据质量审计为准。</p>}</div>
        </section>}

        <details className="beautyVideoMetricContract">
          <summary>指标口径</summary>
          <dl>
            <div><dt>互动率 engagementRate</dt><dd>（点赞 + 评论 + 分享）÷ 播放；只使用文件存在的字段。</dd></div>
            <div><dt>平均完播率 averageCompletionRate</dt><dd>只平均非缺失完播值；缺失值不按零处理。</dd></div>
            <div><dt>作品分层 quadrants</dt><dd>播放中位数 × 互动率中位数；无转化字段时不冒充商业转化分层。</dd></div>
            <div><dt>付费与自然流</dt><dd>未区分自然/付费时，不输出 ROI 或投流效果结论。</dd></div>
          </dl>
        </details>

        {missing.length > 0 && <div className="beautyVideoReviewMissing" role="status"><strong>开始前还需要</strong><ul>{missing.map((item) => <li key={item}>{item}</li>)}</ul></div>}
        <div className="beautyVideoReviewActions"><button type="submit" className="beautyIndustryPrimary" disabled={!props.permitted || props.busy || props.fileParsing || missing.length > 0}>{props.busy ? `正在复盘 · ${props.elapsed}s` : "开始专业复盘｜预计15积分"}</button>{props.busy && <button type="button" className="beautyIndustrySecondary" onClick={props.onCancel}>取消</button>}</div>
        {props.busy && <p className="beautyVideoReviewProgress" role="status">正在读取已解析证据 → 数据质量审计 → 作品分层 → 生成行动建议 → 保存；可取消，不自动重试。</p>}
        {props.notice && <p className="beautyIndustryNotice" role="status">{props.notice}</p>}
        {props.error && <p className="beautyIndustryError" role="alert">{props.error}</p>}
      </form>

      <article className="beautyVideoReviewResult">
        <header className="beautyIndustryResultHead"><div><span>04 · 当前租户已保存结果</span><h2>{props.activeRun ? "正式视频数据复盘报告" : "等待真实数据"}</h2></div>{props.activeRun && <button type="button" disabled={copying} onClick={() => void copyResult()}>{copying ? "复制中…" : "复制复盘报告"}</button>}</header>
        {props.activeRun ? <>
          <div className="beautyIndustryMeta"><span>{props.activeRun.creditCost} 积分</span><span>{props.activeRun.usageChannel === "mcp" ? "WorkBuddy" : "网页"}</span><span>本次使用：{props.activeRun.abilityUsed || "视频数据复盘"}</span><span>{new Date(props.activeRun.createdAt).toLocaleString()}</span></div>
          <nav className="beautyVideoReviewOutline" aria-label="复盘报告章节">{FORMAL_SECTIONS.map((section) => <span key={section} className={props.activeRun?.output.includes(section) ? "present" : "limited"}>{section}</span>)}</nav>
          <div className="beautyVideoReviewReport">{resultSections.length > 1 ? resultSections.map((section) => <section key={section.title}><h3>{section.title}</h3><ReactMarkdown remarkPlugins={[remarkGfm]}>{section.body}</ReactMarkdown></section>) : <ReactMarkdown remarkPlugins={[remarkGfm]}>{props.activeRun.output}</ReactMarkdown>}</div>
          <div className="beautyVideoReviewNext"><strong>继续当前流程</strong><p>复盘结论可作为选题系统四来源之一；进入选题只携带当前租户已保存记录，不会在本页自动生成内容或执行外部动作。</p><button type="button" className="beautyIndustrySecondary" onClick={props.onOpenTopics}>进入下一轮选题</button></div>
          {actionNotice && <p className="beautyIndustryNotice" role="status">{actionNotice}</p>}
        </> : <div className="beautyIndustryEmpty"><h3>先上传真实平台数据</h3><p>结果将按数据质量、作品分层、归因、规律和行动建议展示，并保存到当前租户任务历史。</p></div>}
      </article>
    </div>

    <details className="beautyVideoReviewHistory">
      <summary>任务历史 <span>{props.history.length} 条</span></summary>
      <p>网页与 WorkBuddy 共用同一 AgentRun 历史；恢复记录不会再次运行或扣积分，刷新后可恢复。</p>
      <div className="beautyIndustryHistoryList">{props.history.length ? props.history.map((run) => <button key={run.id} type="button" className={props.activeRun?.id === run.id ? "active" : ""} onClick={() => props.onSelectHistory(run)}><strong>视频数据复盘</strong><span>{run.usageChannel === "mcp" ? "WorkBuddy" : "网页"} · {run.creditCost} 积分</span><time>{new Date(run.createdAt).toLocaleString()}</time></button>) : <p>还没有视频数据复盘记录。</p>}</div>
    </details>
  </section>;
}

function inspectEvidence(value: string): { found: Set<string>; missing: typeof EVIDENCE_GROUPS[number][] } {
  const normalized = value.normalize("NFKC");
  const found = new Set(EVIDENCE_GROUPS.filter((group) => group.pattern.test(normalized)).map((group) => group.key));
  return { found, missing: EVIDENCE_GROUPS.filter((group) => !found.has(group.key)) };
}

function splitReviewResult(markdown: string): Array<{ title: string; body: string }> {
  if (!markdown.trim()) return [];
  const matches = [...markdown.matchAll(/^##\s+(.+)$/gm)];
  if (!matches.length) return [{ title: "视频数据复盘报告", body: markdown }];
  return matches.map((match, index) => ({
    title: match[1]?.trim() || `复盘章节 ${index + 1}`,
    body: markdown.slice((match.index ?? 0) + match[0].length, matches[index + 1]?.index ?? markdown.length).trim()
  }));
}

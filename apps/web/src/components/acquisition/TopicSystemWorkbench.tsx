import { useEffect, useMemo, useState, type FormEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { apiPath } from "../../lib/api.js";
import type { DeviceScope } from "@baolu/shared";

interface TopicConnection {
  id: string;
  provider: string;
  status: string;
  lastSyncedAt?: string | null;
  lastError?: string | null;
}

interface TopicTranscript {
  id: string;
  title: string;
  characterCount: number;
  occurredAt?: string | null;
  preview?: string;
  metadata?: unknown;
}

interface VideoReviewSource {
  id: string;
  title: string;
  content: string;
  createdAt: string;
}

export interface TopicSystemGenerationRequest {
  mode: "franchise" | "store";
  identity: string;
  targetCustomer: string;
  acquisitionGoal: string;
  offer: string;
  accountStage: string;
  industry: string;
  benchmarkAccounts: string[];
  transcriptDocumentIds: string[];
  videoReview: VideoReviewSource | null;
}

export interface TopicSystemTurn {
  question: string;
  answer?: string;
}

interface Props {
  agentSlug: string;
  mode?: "franchise" | "store";
  headers: Record<string, string>;
  deviceScope: DeviceScope;
  tenantRole: "owner" | "admin" | "member";
  subjectId?: string;
  subjectName?: string;
  defaultIndustry?: string;
  busy: boolean;
  result?: string;
  turns: TopicSystemTurn[];
  onGenerate: (request: TopicSystemGenerationRequest) => void;
  onAsk: (question: string) => void;
  onOpenKnowledge: () => void;
  onOpenVideoReview: () => void;
  onChooseSubject: () => void;
  onBackToMap: () => void;
}

export function TopicSystemWorkbench({
  agentSlug,
  mode = "franchise",
  headers,
  deviceScope,
  tenantRole,
  subjectId,
  subjectName,
  defaultIndustry,
  busy,
  result,
  turns,
  onGenerate,
  onAsk,
  onOpenKnowledge,
  onOpenVideoReview,
  onChooseSubject,
  onBackToMap
}: Props) {
  const isFranchise = mode === "franchise";
  const scopeLabel = isFranchise ? "招商" : "门店获客";
  const storageSuffix = `${mode}_${subjectId || "enterprise"}`;
  // A generic enterprise cache is often created by the demo workspace. Do not
  // reuse it until the user has selected a real subject or a real default profile.
  const canReuseStoredInputs = Boolean(subjectId || subjectName || defaultIndustry);
  const [industry, setIndustry] = useState(() => canReuseStoredInputs ? (localStorage.getItem(`sitong_topic_industry_${storageSuffix}`) || defaultIndustry || "") : "");
  const [identity, setIdentity] = useState(() => canReuseStoredInputs ? localStorage.getItem(`sitong_topic_identity_${storageSuffix}`) || "" : "");
  const [targetCustomer, setTargetCustomer] = useState(() => canReuseStoredInputs ? localStorage.getItem(`sitong_topic_target_customer_${storageSuffix}`) || "" : "");
  const [acquisitionGoal, setAcquisitionGoal] = useState(() => canReuseStoredInputs ? localStorage.getItem(`sitong_topic_acquisition_goal_${storageSuffix}`) || "" : "");
  const [offer, setOffer] = useState(() => canReuseStoredInputs ? localStorage.getItem(`sitong_topic_offer_${storageSuffix}`) || "" : "");
  const [accountStage, setAccountStage] = useState(() => canReuseStoredInputs ? localStorage.getItem(`sitong_topic_account_stage_${storageSuffix}`) || "" : "");
  const [benchmarkText, setBenchmarkText] = useState(() => canReuseStoredInputs ? (localStorage.getItem(`sitong_topic_benchmarks_${storageSuffix}`) || "") : "");
  const [connection, setConnection] = useState<TopicConnection | null>(null);
  const [transcripts, setTranscripts] = useState<TopicTranscript[]>([]);
  const [unusableTranscriptCount, setUnusableTranscriptCount] = useState(0);
  const [videoReview, setVideoReview] = useState<VideoReviewSource | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [clientId, setClientId] = useState("");
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [question, setQuestion] = useState("");

  const canManageConnection = tenantRole === "owner" || tenantRole === "admin";
  const recordingCredentialsNeedUpdate = connection?.status === "error";
  const recordingSyncWarning = Boolean(connection && !recordingCredentialsNeedUpdate && connection.lastError);
  const benchmarkAccounts = useMemo(() => Array.from(new Set(benchmarkText
    .split(/[\n,，;；]+/)
    .map((item) => item.trim())
    .filter(Boolean))).slice(0, 12), [benchmarkText]);
  const enabledSourceCount = [industry.trim(), benchmarkAccounts.length, transcripts.length, videoReview].filter(Boolean).length;

  useEffect(() => {
    setIndustry(canReuseStoredInputs ? (localStorage.getItem(`sitong_topic_industry_${storageSuffix}`) || defaultIndustry || "") : "");
    setIdentity(canReuseStoredInputs ? localStorage.getItem(`sitong_topic_identity_${storageSuffix}`) || "" : "");
    setTargetCustomer(canReuseStoredInputs ? localStorage.getItem(`sitong_topic_target_customer_${storageSuffix}`) || "" : "");
    setAcquisitionGoal(canReuseStoredInputs ? localStorage.getItem(`sitong_topic_acquisition_goal_${storageSuffix}`) || "" : "");
    setOffer(canReuseStoredInputs ? localStorage.getItem(`sitong_topic_offer_${storageSuffix}`) || "" : "");
    setAccountStage(canReuseStoredInputs ? localStorage.getItem(`sitong_topic_account_stage_${storageSuffix}`) || "" : "");
    setBenchmarkText(canReuseStoredInputs ? (localStorage.getItem(`sitong_topic_benchmarks_${storageSuffix}`) || "") : "");
  }, [canReuseStoredInputs, defaultIndustry, storageSuffix]);

  useEffect(() => {
    if (!canReuseStoredInputs) return;
    localStorage.setItem(`sitong_topic_industry_${storageSuffix}`, industry);
    localStorage.setItem(`sitong_topic_identity_${storageSuffix}`, identity);
    localStorage.setItem(`sitong_topic_target_customer_${storageSuffix}`, targetCustomer);
    localStorage.setItem(`sitong_topic_acquisition_goal_${storageSuffix}`, acquisitionGoal);
    localStorage.setItem(`sitong_topic_offer_${storageSuffix}`, offer);
    localStorage.setItem(`sitong_topic_account_stage_${storageSuffix}`, accountStage);
    localStorage.setItem(`sitong_topic_benchmarks_${storageSuffix}`, benchmarkText);
  }, [accountStage, acquisitionGoal, benchmarkText, canReuseStoredInputs, identity, industry, offer, storageSuffix, targetCustomer]);

  useEffect(() => { void loadSources(); }, [agentSlug, deviceScope, subjectId]);

  async function loadSources(): Promise<void> {
    setLoading(true);
    setError("");
    try {
      const documentQuery = new URLSearchParams({ type: "transcript", limit: "20" });
      // 普通客户只有一个企业知识库时，这里等同于其默认资料夹；顾问有多个
      // 客户资料夹时，自动带入的只能是当前资料夹。跨资料夹参考必须由用户在
      // 知识库中明确选择，不能先全量带入再在运行时拦截。
      if (subjectId) documentQuery.set("subjectId", subjectId);
      const [connectionPayload, documentPayload, reviewPayload] = await Promise.all([
        fetch(apiPath("/knowledge-base/connections"), { headers, cache: "no-store" }).then((response) => readJson<{ connections: TopicConnection[] }>(response)),
        fetch(apiPath(`/knowledge-base/documents?${documentQuery.toString()}`), { headers, cache: "no-store" }).then((response) => readJson<{ documents: TopicTranscript[] }>(response)),
        fetch(apiPath(`/agents/${agentSlug}/latest-video-review?deviceScope=${deviceScope}`), { headers, cache: "no-store" }).then((response) => readJson<{ review: VideoReviewSource | null }>(response))
      ]);
      setConnection(connectionPayload.connections.find((item) => item.provider === "getnote") ?? null);
      const returnedTranscripts = documentPayload.documents ?? [];
      const usableTranscripts = returnedTranscripts.filter(isUsableTopicTranscript);
      setTranscripts(usableTranscripts);
      setUnusableTranscriptCount(returnedTranscripts.length - usableTranscripts.length);
      setVideoReview(reviewPayload.review ?? null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "选题数据源读取失败");
    } finally {
      setLoading(false);
    }
  }

  async function connectRecordingCard(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!canManageConnection || connecting) return;
    setConnecting(true);
    setError("");
    setNotice(connection ? "正在验证新的 API Key…" : "正在验证并连接得到大脑…");
    try {
      const payload = await fetch(apiPath("/knowledge-base/connections/getnote"), {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: apiKey.trim(),
          ...(clientId.trim() ? { clientId: clientId.trim() } : {}),
          label: "得到大脑"
        })
      }).then((response) => readJson<{ connection: TopicConnection }>(response));
      setApiKey("");
      setClientId("");
      setConnection(payload.connection);
      setNotice("连接成功，正在同步已经转写好的录音文字…");
      await syncRecordingCard(payload.connection.id);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "录音卡连接失败";
      setNotice("");
      setError(message);
    } finally {
      setConnecting(false);
    }
  }

  async function syncRecordingCard(connectionId = connection?.id): Promise<void> {
    if (!connectionId || !canManageConnection || syncing) return;
    setSyncing(true);
    setError("");
    setNotice("正在同步得到大脑里的录音转写…");
    try {
      const payload = await fetch(apiPath(`/knowledge-base/connections/${connectionId}/sync`), {
        method: "POST",
        headers
      }).then((response) => readJson<{ sync: { created: number; updated: number; failed: number } }>(response));
      setNotice(`同步完成：新增 ${payload.sync.created} 条，更新 ${payload.sync.updated} 条${payload.sync.failed ? `，失败 ${payload.sync.failed} 条` : ""}。`);
      await loadSources();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "录音转写同步失败";
      setNotice("");
      // Reload the authoritative server-side connection state. A temporary
      // provider outage or rate limit is retryable and must not be presented as
      // lost credentials after the next page refresh.
      await loadSources();
      setError(message);
    } finally {
      setSyncing(false);
    }
  }

  function generateTopics(): void {
    if (!identity.trim() || !targetCustomer.trim() || !acquisitionGoal.trim() || !industry.trim() || busy) return;
    onGenerate({
      mode,
      identity: identity.trim(),
      targetCustomer: targetCustomer.trim(),
      acquisitionGoal: acquisitionGoal.trim(),
      offer: offer.trim(),
      accountStage: accountStage.trim(),
      industry: industry.trim(),
      benchmarkAccounts,
      transcriptDocumentIds: transcripts.map((item) => item.id).slice(0, 20),
      videoReview
    });
  }

  return <div className="topicSystemWorkbench">
    <header className="topicSystemHero">
      <div>
        <button type="button" onClick={onBackToMap}>← 返回工作地图</button>
        <span>TOPIC INTELLIGENCE SYSTEM</span>
        <h2>{isFranchise ? "招商选题系统" : "门店选题系统"}</h2>
        <p>{isFranchise ? "只围绕品牌招商加盟，把行业趋势、对标招商账号、真实表达和历史视频表现放在一起，再完成筛选。" : "只围绕门店本地消费者，把商圈、行业趋势、对标账号、真实表达和历史视频表现放在一起，再完成筛选。"}</p>
      </div>
      <aside><strong>{enabledSourceCount}<small>/4</small></strong><span>当前可用数据源</span><em>{subjectName || "尚未选择服务主体"}</em><button type="button" onClick={onChooseSubject}>{subjectName ? "更换主体" : "选择主体"}</button></aside>
    </header>

    <section className="topicBriefCard" aria-label={`本轮${scopeLabel} Brief`}>
      <header><span>本轮目标</span><div><strong>本轮{scopeLabel} Brief</strong><p>{isFranchise ? "先说明品牌、目标加盟商与招商目标；这不是资料库，填写后会记住并可随时修改。" : "先说明门店、目标消费者与本轮到店目标；这不是资料库，填写后会记住并可随时修改。"}</p></div></header>
      <div className="topicBriefFields">
        <label>{isFranchise ? "品牌 / 项目名称" : "门店 / 项目名称"} <b>必填</b><input value={identity} onChange={(event) => setIdentity(event.target.value)} placeholder={isFranchise ? "例如：蓝旗美业连锁，华南招商负责人" : "例如：南山万象天地 XX 美业门店"} /></label>
        <label>{isFranchise ? "目标加盟商" : "目标消费者"} <b>必填</b><input value={targetCustomer} onChange={(event) => setTargetCustomer(event.target.value)} placeholder={isFranchise ? "例如：有 20–50 万预算的美业创业者" : "例如：门店 3 公里内的白领女性"} /></label>
        <label>本轮{scopeLabel}目标 <b>必填</b><select value={acquisitionGoal} onChange={(event) => setAcquisitionGoal(event.target.value)}><option value="">请选择本轮目标</option>{isFranchise ? <><option value="获取加盟咨询">获取加盟咨询</option><option value="获取加盟商留资">获取加盟商留资</option><option value="预约品牌考察">预约品牌考察</option><option value="筛选意向加盟商">筛选意向加盟商</option><option value="建立招商认知">建立招商认知</option></> : <><option value="获取私信咨询">获取私信咨询</option><option value="团购下单">团购下单</option><option value="预约到店">预约到店</option><option value="到店核销">到店核销</option><option value="复购唤醒">复购唤醒</option></>}</select></label>
        <label>{isFranchise ? "招商主推产品 / 加盟模型" : "主推产品 / 团购套餐"} <small>选填</small><input value={offer} onChange={(event) => setOffer(event.target.value)} placeholder={isFranchise ? "例如：美业加盟模型，预算 20–30 万" : "例如：双人护理套餐；价格与优惠需已确认"} /></label>
        <label>{isFranchise ? "招商账号与内容阶段" : "门店账号与内容阶段"}<small>选填</small><select value={accountStage} onChange={(event) => setAccountStage(event.target.value)}><option value="">暂不确定</option><option value="抖音新号冷启动">抖音新号冷启动</option><option value="起号测试期">起号测试期</option><option value="稳定更新期">稳定更新期</option><option value="已有爆款，准备放大">已有爆款，准备放大</option><option value="视频号或小红书运营">视频号或小红书运营</option></select></label>
      </div>
    </section>

    <section className="topicSourceGrid" aria-label="四个选题数据来源">
      <article className={`topicSourceCard ${industry.trim() ? "ready" : "missing"}`}>
        <header><span>01</span><div><strong>行业热点</strong><small>确定要研究的行业，再检索近期变化与用户关注点</small></div><em>{industry.trim() ? "已填写" : "待填写"}</em></header>
        <label>所在行业<input value={industry} onChange={(event) => setIndustry(event.target.value)} placeholder="例如：AI企业服务、美业、餐饮连锁" /></label>
        <p>本轮只围绕这里填写的行业检索，不继承其他客户项目的行业。</p>
      </article>

      <article className={`topicSourceCard ${benchmarkAccounts.length ? "ready" : "missing"}`}>
        <header><span>02</span><div><strong>对标账号</strong><small>输入账号名或主页链接，支持多个账号</small></div><em>{benchmarkAccounts.length ? `${benchmarkAccounts.length} 个` : "待填写"}</em></header>
        <label>对标账号<textarea rows={3} value={benchmarkText} onChange={(event) => setBenchmarkText(event.target.value)} placeholder="例如：抖音｜陈厂长｜主页链接\n视频号｜某某品牌创始人" /></label>
        <p>系统只分析能够核验的公开内容；同名账号无法确认时会标记待核实。</p>
      </article>

      <article className={`topicSourceCard ${recordingCredentialsNeedUpdate ? "error" : transcripts.length ? "ready" : connection ? "partial" : "missing"}`}>
        <header><span>03</span><div><strong>AI录音卡</strong><small>读取得到大脑里已经转写好的真实表达</small></div><em>{recordingCredentialsNeedUpdate ? "需更新凭证" : transcripts.length ? `${transcripts.length} 条有效转写` : connection ? "暂无有效转写" : "未连接"}</em></header>
        {connection && !recordingCredentialsNeedUpdate ? <div className="topicConnectedSource">
          <strong>得到大脑已连接</strong>
          <span>{connection.lastSyncedAt ? `最近同步：${formatDate(connection.lastSyncedAt)}` : "尚未完成首次同步"}</span>
          {recordingSyncWarning && <span className="topicSourceWarning">上次同步未完成：{connection.lastError} 已保存凭证仍然有效，可直接重试。</span>}
          {unusableTranscriptCount > 0 && <span>已忽略 {unusableTranscriptCount} 条0秒或空转写，不会作为选题证据。</span>}
          <div>{canManageConnection && <button type="button" onClick={() => void syncRecordingCard()} disabled={syncing}>{syncing ? "同步中…" : "同步最新录音"}</button>}<button type="button" className="secondary" onClick={onOpenKnowledge}>查看知识库</button></div>
        </div> : canManageConnection ? <form className="topicConnectionForm" onSubmit={(event) => void connectRecordingCard(event)}>
          {recordingCredentialsNeedUpdate && <div className="topicCredentialRecovery"><strong>同步授权已失效</strong><span>{connection?.lastError || "请更新 API Key 后重新同步最新录音。"}</span></div>}
          <label>{recordingCredentialsNeedUpdate ? "新的 API Key" : "API Key"}<input type="password" autoComplete="off" minLength={8} value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="请输入得到大脑 API Key" required /></label>
          <label>{recordingCredentialsNeedUpdate ? "Client ID（如有变更再填写）" : "Client ID"}<input autoComplete="off" minLength={3} value={clientId} onChange={(event) => setClientId(event.target.value)} placeholder={recordingCredentialsNeedUpdate ? "已安全保存；如未变更可留空" : "请输入得到大脑 Client ID"} required={!connection} /></label>
          <button type="submit" disabled={connecting}>{connecting ? "验证并同步中…" : recordingCredentialsNeedUpdate ? "更新 API Key 并同步最新录音" : "连接并同步"}</button>
        </form> : <div className="topicSourceEmpty"><strong>需要管理员连接</strong><span>普通成员不能查看或修改企业 API 凭证，请联系企业管理员。</span></div>}
      </article>

      <article className={`topicSourceCard ${videoReview ? "ready" : "missing"}`}>
        <header><span>04</span><div><strong>视频数据复盘</strong><small>自动读取复盘系统最近一次真实数据结论</small></div><em>{videoReview ? "已回流" : "暂无复盘"}</em></header>
        {videoReview ? <div className="topicReviewSource"><strong>{videoReview.title}</strong><span>{formatDate(videoReview.createdAt)}</span><p>{plainPreview(videoReview.content)}</p><button type="button" onClick={onOpenVideoReview}>进入视频复盘系统</button></div> : <div className="topicSourceEmpty"><strong>还没有可用的视频复盘</strong><span>先上传视频后台数据完成复盘，结果会自动回流到这里。</span><button type="button" onClick={onOpenVideoReview}>去做视频数据复盘</button></div>}
      </article>
    </section>

    {(notice || error) && <p className={`topicSystemNotice ${error ? "error" : ""}`} role="status">{error || notice}</p>}

    <section className="topicGenerateBar">
      <div><span>本轮生成规则</span><strong>四大来源形成候选池 → 选题 Skill 三关筛选 → 输出10条可测试选题</strong><small>缺少的来源会明确标记“待补/待核验”，不会用占位内容冒充事实。</small></div>
      <button type="button" disabled={busy || loading || !identity.trim() || !targetCustomer.trim() || !acquisitionGoal.trim() || !industry.trim()} onClick={generateTopics}>{busy ? "正在深度生成…" : loading ? "正在读取数据源…" : "从四大来源生成选题"}</button>
    </section>

    {result && <section className="topicSystemResult" aria-live="polite"><header><span>TOPIC OUTPUT</span><h3>本轮选题结果</h3></header><div className="topicSystemMarkdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{result}</ReactMarkdown></div></section>}
    <section className="systemDialoguePanel" aria-label="选题系统对话微调">
      <header><span>对话</span><div><strong>选题系统对话微调</strong><p>围绕本轮选题继续删改、补充来源或调整目标客户；不会改写为完整文案。</p></div></header>
      {turns.length > 0 && <div className="systemDialogueHistory">{turns.map((turn, index) => <article key={`${turn.question}-${index}`}><b>你</b><p>{turn.question}</p>{turn.answer && <><b>选题系统</b><div><ReactMarkdown remarkPlugins={[remarkGfm]}>{turn.answer}</ReactMarkdown></div></>}</article>)}</div>}
      <textarea rows={4} value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="例如：把目标客户改成连锁品牌创始人；只保留有录音证据的选题；第 3 条改成更适合抖音口播的表达。" />
      <button type="button" disabled={busy || !question.trim()} onClick={() => { onAsk(question.trim()); setQuestion(""); }}>{busy ? "正在调整…" : "发送选题修改要求"}</button>
    </section>
  </div>;
}

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  let data: any = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text }; }
  if (!response.ok) throw new Error(data.message || data.error || `请求失败（${response.status}）`);
  return data as T;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function isUsableTopicTranscript(document: TopicTranscript): boolean {
  const sample = `${document.title}\n${document.preview ?? ""}\n${JSON.stringify(document.metadata ?? {})}`;
  if (document.characterCount < 40) return false;
  return !/(?:空录音转写内容|录音(?:时长|总时长)[：:\s]*0\s*秒|时长[：:\s]*(?:约\s*)?0\s*秒|无有效.*转写|未识别到.*(?:语音|转写))/.test(sample);
}

function plainPreview(value: string): string {
  return value.replace(/[#>*_`|\[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 180) || "已取得复盘结果。";
}

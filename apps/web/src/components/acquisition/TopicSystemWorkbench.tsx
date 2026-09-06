import { useEffect, useMemo, useState, type FormEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { apiPath } from "../../lib/api.js";
import { knowledgeSyncProgressText, knowledgeSyncResultText, resumeKnowledgeSync, runKnowledgeSync } from "../../lib/knowledge-sync.js";
import type { DeviceScope } from "@baolu/shared";
import { parseFounderTopicSelections, type FounderIpContentSelection } from "./founderIpContentDraft.js";

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
  confirmed: boolean;
  industry?: string | null;
  subjectIds?: string[];
}

interface VideoReviewSource {
  id: string;
  title: string;
  content: string;
  createdAt: string;
}

export interface TopicSystemPresentation {
  title?: string;
  subtitle?: string;
  backLabel?: string;
  subjectActionLabel?: string;
  subjectFallback?: string;
  flowLabel?: string;
  identityLabel?: string;
  identityPlaceholder?: string;
  customerLabel?: string;
  customerPlaceholder?: string;
  goalLabel?: string;
  offerLabel?: string;
  offerPlaceholder?: string;
}

interface PersistedFounderTopicBrief {
  subjectId: string;
  target: FounderTopicTarget;
  identity: string;
  targetCustomer: string;
  acquisitionGoal: string;
  offer?: string | null;
  accountStage?: string | null;
  industry: string;
  benchmarkAccounts: unknown;
  updatedAt: string;
}

export type FounderTopicTarget = "franchise" | "store_visit" | "student" | "partner";

const targetDefinitions: Record<FounderTopicTarget, {
  label: string;
  identityLabel: string;
  identityPlaceholder: string;
  customerLabel: string;
  customerPlaceholder: string;
  goalLabel: string;
  offerLabel: string;
  offerPlaceholder: string;
  goals: string[];
}> = {
  franchise: {
    label: "招商加盟",
    identityLabel: "创始人身份 / 项目名称",
    identityPlaceholder: "例如：兰琪美业创始人，华南招商负责人",
    customerLabel: "目标加盟商",
    customerPlaceholder: "例如：有 20–50 万预算的美业创业者",
    goalLabel: "本轮线索目标",
    offerLabel: "主推加盟项目 / 加盟模型",
    offerPlaceholder: "例如：美业加盟模型；价格与政策须已确认",
    goals: ["获取加盟咨询", "预约品牌考察", "筛选意向加盟商", "建立招商认知"]
  },
  store_visit: {
    label: "C端团购到店",
    identityLabel: "创始人身份 / 门店项目",
    identityPlaceholder: "例如：南山万象天地 XX 美业门店创始人",
    customerLabel: "目标消费者",
    customerPlaceholder: "例如：门店 3 公里内的白领女性",
    goalLabel: "本轮线索目标",
    offerLabel: "主推产品 / 团购套餐",
    offerPlaceholder: "例如：双人护理套餐；价格与优惠须已确认",
    goals: ["获取私信咨询", "团购下单", "预约到店", "到店核销", "复购唤醒"]
  },
  student: {
    label: "学员招募",
    identityLabel: "创始人身份 / 课程项目",
    identityPlaceholder: "例如：皮肤管理培训创始人",
    customerLabel: "目标学员",
    customerPlaceholder: "例如：计划转行的零基础美业从业者",
    goalLabel: "本轮线索目标",
    offerLabel: "主推课程 / 试听说明会",
    offerPlaceholder: "例如：皮肤管理入门课；课程价格与名额须已确认",
    goals: ["获取课程咨询", "预约试听", "报名说明会", "筛选适合学员"]
  },
  partner: {
    label: "合作方招募",
    identityLabel: "创始人身份 / 合作项目",
    identityPlaceholder: "例如：连锁项目创始人，城市合伙合作负责人",
    customerLabel: "目标合作方",
    customerPlaceholder: "例如：有本地渠道资源的城市合作伙伴",
    goalLabel: "本轮线索目标",
    offerLabel: "合作类型 / 已确认条件",
    offerPlaceholder: "例如：城市联营；分润和区域条件须已确认",
    goals: ["获取合作咨询", "筛选合作资格", "预约方案沟通", "推进合作洽谈", "建立合作认知"]
  }
};

function normalizeAcquisitionGoal(target: FounderTopicTarget, value: string | null | undefined): string {
  const trimmed = value?.trim() ?? "";
  if (target === "franchise" && (trimmed === "获取加盟商留资" || trimmed === "获取加盟商留址")) {
    return "获取加盟咨询";
  }
  if (target === "student" && trimmed === "完成报名") {
    return "报名说明会";
  }
  return trimmed;
}

export interface TopicSystemGenerationRequest {
  mode: "founder" | "franchise" | "store";
  target: FounderTopicTarget;
  identity: string;
  targetCustomer: string;
  acquisitionGoal: string;
  offer: string;
  accountStage: string;
  industry: string;
  benchmarkAccounts: string[];
  transcriptDocumentIds: string[];
  videoReview: VideoReviewSource | null;
  subjectId: string;
  sourceSelection: { industry: boolean; benchmark: boolean; transcript: boolean; videoReview: boolean };
}

export interface TopicSystemTurn {
  question: string;
  answer?: string;
}

interface Props {
  agentSlug: string;
  mode?: "founder" | "franchise" | "store";
  initialTarget?: FounderTopicTarget;
  headers: Record<string, string>;
  deviceScope: DeviceScope;
  tenantRole: "owner" | "admin" | "member";
  subjectId?: string;
  sourceSubjectId?: string | null;
  subjectName?: string;
  defaultIndustry?: string;
  busy: boolean;
  result?: string;
  turns: TopicSystemTurn[];
  onGenerate: (request: TopicSystemGenerationRequest) => Promise<void> | void;
  onAsk: (question: string) => void;
  onOpenContentSystem: (selection: FounderIpContentSelection) => Promise<void> | void;
  onOpenVideoReview: () => void;
  onChooseSubject: () => void;
  onBackToMap: () => void;
  localFixture?: boolean;
  presentation?: TopicSystemPresentation;
}

export function TopicSystemWorkbench({
  agentSlug,
  mode = "founder",
  initialTarget,
  headers,
  deviceScope,
  tenantRole,
  subjectId,
  sourceSubjectId,
  subjectName,
  defaultIndustry,
  busy,
  result,
  turns,
  onGenerate,
  onAsk,
  onOpenContentSystem,
  onOpenVideoReview,
  onChooseSubject,
  onBackToMap,
  localFixture = false,
  presentation
}: Props) {
  const isFounderMode = mode === "founder";
  const [target, setTarget] = useState<FounderTopicTarget>(initialTarget ?? (mode === "store" ? "store_visit" : "franchise"));
  const activeTarget: FounderTopicTarget = isFounderMode ? target : mode === "store" ? "store_visit" : "franchise";
  const targetDefinition = targetDefinitions[activeTarget];
  const scopeLabel = presentation?.flowLabel || targetDefinition.label;
  const storageSuffix = `${mode}_${subjectId || "enterprise"}${isFounderMode ? `_${activeTarget}` : ""}`;
  // A generic enterprise cache is often created by the demo workspace. Do not
  // reuse it until the user has selected a real subject or a real default profile.
  const canReuseStoredInputs = Boolean(subjectId || subjectName || defaultIndustry);
  const [industry, setIndustry] = useState(() => canReuseStoredInputs ? (localStorage.getItem(`sitong_topic_industry_${storageSuffix}`) || defaultIndustry || "") : "");
  const effectiveSourceSubjectId = sourceSubjectId === undefined ? subjectId : sourceSubjectId ?? undefined;
  const [identity, setIdentity] = useState(() => canReuseStoredInputs ? localStorage.getItem(`sitong_topic_identity_${storageSuffix}`) || subjectName || "" : subjectName || "");
  const [targetCustomer, setTargetCustomer] = useState(() => canReuseStoredInputs ? localStorage.getItem(`sitong_topic_target_customer_${storageSuffix}`) || "" : "");
  const [acquisitionGoal, setAcquisitionGoal] = useState(() => canReuseStoredInputs ? normalizeAcquisitionGoal(activeTarget, localStorage.getItem(`sitong_topic_acquisition_goal_${storageSuffix}`)) : "");
  const [offer, setOffer] = useState(() => canReuseStoredInputs ? localStorage.getItem(`sitong_topic_offer_${storageSuffix}`) || "" : "");
  const [accountStage, setAccountStage] = useState(() => canReuseStoredInputs ? localStorage.getItem(`sitong_topic_account_stage_${storageSuffix}`) || "" : "");
  const [benchmarkText, setBenchmarkText] = useState(() => canReuseStoredInputs ? (localStorage.getItem(`sitong_topic_benchmarks_${storageSuffix}`) || "") : "");
  const [connection, setConnection] = useState<TopicConnection | null>(null);
  const [sourceTranscripts, setSourceTranscripts] = useState<TopicTranscript[]>([]);
  const [videoReview, setVideoReview] = useState<VideoReviewSource | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [clientId, setClientId] = useState("");
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [briefLoading, setBriefLoading] = useState(false);
  const [briefSaving, setBriefSaving] = useState(false);
  const [question, setQuestion] = useState("");
  const [selectedTopicIndex, setSelectedTopicIndex] = useState("0");
  const [openingContent, setOpeningContent] = useState(false);
  const [sourceSelection, setSourceSelection] = useState({ industry: true, benchmark: true, transcript: true, videoReview: true });

  const canManageConnection = tenantRole === "owner" || tenantRole === "admin";
  const recordingCredentialsNeedUpdate = connection?.status === "error";
  const recordingSyncWarning = Boolean(connection && !recordingCredentialsNeedUpdate && connection.lastError);
  const benchmarkAccounts = useMemo(() => Array.from(new Set(benchmarkText
    .split(/[\n,，;；]+/)
    .map((item) => item.trim())
    .filter(Boolean))).slice(0, 12), [benchmarkText]);
  const transcripts = useMemo(
    () => sourceTranscripts.filter((document) => isQualifiedFounderIpTranscript(document, industry, effectiveSourceSubjectId)),
    [effectiveSourceSubjectId, industry, sourceTranscripts]
  );
  const unusableTranscriptCount = sourceTranscripts.length - transcripts.length;
  const enabledSourceCount = [sourceSelection.industry && industry.trim(), sourceSelection.benchmark && benchmarkAccounts.length, sourceSelection.transcript && transcripts.length, sourceSelection.videoReview && videoReview].filter(Boolean).length;
  const beautyTopicCards = useMemo(() => result ? parseBeautyTopicCards(result) : [], [result]);
  const selectableTopics = useMemo(() => result ? (beautyTopicCards.length ? beautyTopicCards : parseFounderTopicSelections(result)).map((item) => ({
    ...item,
    audience: item.audience === "待补" ? targetCustomer.trim() || "待补" : item.audience
  })) : [], [beautyTopicCards, result, targetCustomer]);

  async function copyBeautyTopics(index?: number): Promise<void> {
    const selected = typeof index === "number" ? beautyTopicCards.slice(index, index + 1) : beautyTopicCards;
    if (!selected.length) return;
    const text = selected.map((item, itemIndex) => [
      `${typeof index === "number" ? index + 1 : itemIndex + 1}. ${item.topic}`,
      `适合人群：${item.audience}`,
      `内容角度：${item.angle}`,
      `为什么有助获客：${item.goalRelation}`,
      `建议内容形式：${item.format}`
    ].join("\n")).join("\n\n");
    try { await navigator.clipboard.writeText(text); setNotice(typeof index === "number" ? "已复制这一条选题。" : "已复制干净的TOP10，不包含内部审核信息。"); }
    catch { setError("浏览器未允许复制，请检查剪贴板权限。"); }
  }

  async function openSelectedTopicInContentSystem(index = Number(selectedTopicIndex)): Promise<void> {
    const selectedTopic = selectableTopics[index];
    if (!selectedTopic || !subjectId) {
      setError("请先保存当前获客目标简报，再选择一条选题进入内容系统。");
      return;
    }
    setSelectedTopicIndex(String(index));
    setOpeningContent(true);
    setError("");
    try {
      await onOpenContentSystem({
        subjectId,
        target: activeTarget,
        identity: identity.trim(),
        targetCustomer: targetCustomer.trim(),
        acquisitionGoal: acquisitionGoal.trim(),
        offer: offer.trim(),
        accountStage: accountStage.trim(),
        industry: industry.trim(),
        ...selectedTopic
      });
    } catch (reason) {
      setError(reason instanceof Error ? `进入内容系统失败：${reason.message}` : "进入内容系统失败，请稍后重试。");
    } finally {
      setOpeningContent(false);
    }
  }

  useEffect(() => {
    const readStored = (key: string) => canReuseStoredInputs ? localStorage.getItem(`${key}_${storageSuffix}`) || "" : "";
    setIndustry(readStored("sitong_topic_industry") || defaultIndustry || "");
    setIdentity(readStored("sitong_topic_identity") || subjectName || "");
    setTargetCustomer(readStored("sitong_topic_target_customer"));
    setAcquisitionGoal(normalizeAcquisitionGoal(activeTarget, readStored("sitong_topic_acquisition_goal")));
    setOffer(readStored("sitong_topic_offer"));
    setAccountStage(readStored("sitong_topic_account_stage"));
    setBenchmarkText(readStored("sitong_topic_benchmarks"));
  }, [activeTarget, canReuseStoredInputs, defaultIndustry, storageSuffix, subjectName]);

  useEffect(() => {
    if (isFounderMode && initialTarget) setTarget(initialTarget);
  }, [initialTarget, isFounderMode]);

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

  useEffect(() => {
    if (!isFounderMode || !subjectId) return;
    let cancelled = false;
    setBriefLoading(true);
    setError("");
    void fetch(apiPath(`/agents/${agentSlug}/founder-ip-goal-briefs?${new URLSearchParams({ subjectId, target: activeTarget }).toString()}`), { headers, cache: "no-store" })
      .then((response) => readJson<{ brief: PersistedFounderTopicBrief | null }>(response))
      .then((payload) => {
        if (cancelled) return;
        const brief = payload.brief;
        if (!brief) return;
        setIdentity(brief.identity);
        setTargetCustomer(brief.targetCustomer);
        setAcquisitionGoal(normalizeAcquisitionGoal(activeTarget, brief.acquisitionGoal));
        setOffer(brief.offer ?? "");
        setAccountStage(brief.accountStage ?? "");
        setIndustry(brief.industry);
        setBenchmarkText(Array.isArray(brief.benchmarkAccounts) ? brief.benchmarkAccounts.filter((item): item is string => typeof item === "string").join("\n") : "");
        setNotice(`已恢复${targetDefinitions[activeTarget].label}获客目标简报，可继续修改。`);
      })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? `获客目标简报恢复失败：${reason.message}` : "获客目标简报恢复失败，请重试。"); })
      .finally(() => { if (!cancelled) setBriefLoading(false); });
    return () => { cancelled = true; };
  }, [activeTarget, agentSlug, headers.Authorization, isFounderMode, subjectId]);

  useEffect(() => { void loadSources(); }, [agentSlug, deviceScope, subjectId]);

  useEffect(() => {
    if (localFixture || !connection || syncing || !canManageConnection) return;
    const controller = new AbortController();
    let resumedActive = false;
    void resumeKnowledgeSync(connection.id, headers, (progress) => {
      if (progress.status === "queued" || progress.status === "running") resumedActive = true;
      if (resumedActive) {
        setSyncing(progress.status === "queued" || progress.status === "running");
        setNotice(progress.status === "succeeded" ? knowledgeSyncResultText(progress) : knowledgeSyncProgressText(progress));
      }
    }, controller.signal).then((result) => {
      if (resumedActive && result?.status !== "succeeded") setError(knowledgeSyncResultText(result!));
      if (resumedActive && result?.status === "succeeded") void loadSources();
    }).catch((reason) => { if ((reason as { name?: string }).name !== "AbortError") setError(reason instanceof Error ? reason.message : "同步状态恢复失败"); });
    return () => controller.abort();
  }, [connection?.id]);

  async function loadSources(): Promise<void> {
    setLoading(true);
    setError("");
    if (localFixture) {
      setConnection(null);
      setSourceTranscripts([]);
      setVideoReview(null);
      setLoading(false);
      return;
    }
    try {
      const documentQuery = new URLSearchParams({ type: "transcript", limit: "20" });
      // 普通客户只有一个企业知识库时，这里等同于其默认资料夹；顾问有多个
      // 客户资料夹时，自动带入的只能是当前资料夹。跨资料夹参考必须由用户在
      // 知识库中明确选择，不能先全量带入再在运行时拦截。
      if (effectiveSourceSubjectId) documentQuery.set("subjectId", effectiveSourceSubjectId);
      const [connectionPayload, documentPayload, reviewPayload] = await Promise.all([
        fetch(apiPath("/knowledge-base/connections"), { headers, cache: "no-store" }).then((response) => readJson<{ connections: TopicConnection[] }>(response)),
        fetch(apiPath(`/knowledge-base/documents?${documentQuery.toString()}`), { headers, cache: "no-store" }).then((response) => readJson<{ documents: TopicTranscript[] }>(response)),
        fetch(apiPath(`/agents/${agentSlug}/latest-video-review?deviceScope=${deviceScope}`), { headers, cache: "no-store" }).then((response) => readJson<{ review: VideoReviewSource | null }>(response))
      ]);
      setConnection(connectionPayload.connections.find((item) => item.provider === "getnote") ?? null);
      const returnedTranscripts = documentPayload.documents ?? [];
      setSourceTranscripts(returnedTranscripts);
      setVideoReview(reviewPayload.review ?? null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "选题数据源读取失败");
    } finally {
      setLoading(false);
    }
  }

  async function connectRecordingCard(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (localFixture || !canManageConnection || connecting) return;
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
    if (localFixture || !connectionId || !canManageConnection || syncing) return;
    setSyncing(true);
    setError("");
    setNotice("正在提交同步任务…");
    try {
      const result = await runKnowledgeSync(connectionId, headers, (progress) => setNotice(knowledgeSyncProgressText(progress)));
      if (result.status !== "succeeded") throw new Error(knowledgeSyncResultText(result));
      setNotice(knowledgeSyncResultText(result));
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

  async function saveBrief(): Promise<boolean> {
    if (!isFounderMode) return true;
    if (!subjectId) {
      setError("本客户工作区正在准备，请稍后再保存或生成选题。");
      return false;
    }
    if (!identity.trim() || !targetCustomer.trim() || !acquisitionGoal.trim() || !industry.trim()) {
      setError("请先填写身份/项目、目标人群、本轮线索目标和所在行业。");
      return false;
    }
    if (briefSaving) return false;
    setBriefSaving(true);
    setError("");
    try {
      await fetch(apiPath(`/agents/${agentSlug}/founder-ip-goal-briefs`), {
        method: "PUT",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ subjectId, target: activeTarget, identity: identity.trim(), targetCustomer: targetCustomer.trim(), acquisitionGoal: acquisitionGoal.trim(), offer: offer.trim() || undefined, accountStage: accountStage.trim() || undefined, industry: industry.trim(), benchmarkAccounts })
      }).then((response) => readJson<{ event: string }>(response));
      setNotice(`已保存${targetDefinition.label}获客目标简报；刷新后会从本客户工作区恢复。`);
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? `保存失败：${reason.message}` : "保存失败，请检查网络后重试。");
      return false;
    } finally {
      setBriefSaving(false);
    }
  }

  async function generateTopics(): Promise<void> {
    if (localFixture) {
      setNotice("");
      setError("本机合成验收数据仅用于检查页面与已保存结果，不连接真实资料，也不会调用 AI 模型。请从正式客户工作区生成新选题。");
      return;
    }
    setNotice("正在检查本轮选题条件…");
    if (!identity.trim() || !targetCustomer.trim() || !acquisitionGoal.trim() || !industry.trim()) {
      setError("请先填写身份/项目、目标人群、本轮线索目标和所在行业。");
      return;
    }
    if (busy || briefLoading) {
      setNotice("本轮选题正在处理中，请稍候。");
      return;
    }
    setError("");
    setNotice("正在保存获客目标简报并从四大来源生成选题…");
    try {
      if (!(await saveBrief())) return;
      if (!subjectId) return;
      await onGenerate({
        mode,
        target: activeTarget,
        identity: identity.trim(),
        targetCustomer: targetCustomer.trim(),
        acquisitionGoal: acquisitionGoal.trim(),
        offer: offer.trim(),
        accountStage: accountStage.trim(),
        industry: industry.trim(),
        benchmarkAccounts: sourceSelection.benchmark ? benchmarkAccounts : [],
        transcriptDocumentIds: sourceSelection.transcript ? transcripts.map((item) => item.id).slice(0, 20) : [],
        videoReview: sourceSelection.videoReview ? videoReview : null,
        sourceSelection,
        subjectId
      });
    } catch (reason) {
      setError(reason instanceof Error ? `选题生成失败：${reason.message}` : "选题生成失败，请稍后重试。");
    }
  }

  return <div className="topicSystemWorkbench">
    {localFixture && <div className="topicFixtureBanner" role="status" data-testid="fip-synthetic-data-banner"><strong>本机合成验收数据</strong><span>仅用于页面验收；不连接真实资料、不调用 AI 模型、不产生费用。</span></div>}
    <header className="topicSystemHero">
      <div>
        <button type="button" onClick={onBackToMap}>← {presentation?.backLabel || "返回工作地图"}</button>
        <span>TOPIC INTELLIGENCE SYSTEM</span>
        <h2>{presentation?.title || (isFounderMode ? "创始人 IP 选题系统" : activeTarget === "franchise" ? "招商选题系统" : "门店选题系统")}</h2>
        <p>{presentation?.subtitle || (isFounderMode ? "先选本轮获客目标，再将近期热点、对标账号、真实录音与自己账号的真实复盘汇总为可执行选题。" : activeTarget === "franchise" ? "只围绕品牌招商加盟，把行业趋势、对标招商账号、真实表达和历史视频表现放在一起，再完成筛选。" : "只围绕门店本地消费者，把商圈、行业趋势、对标账号、真实表达和历史视频表现放在一起，再完成筛选。")}</p>
      </div>
      <aside><strong>{enabledSourceCount}<small>/4</small></strong><span>当前可用数据源</span><em>{isFounderMode ? "本客户工作区" : subjectName || presentation?.subjectFallback || "尚未选择服务主体"}</em>{!isFounderMode && <button type="button" onClick={onChooseSubject}>{presentation?.subjectActionLabel || (subjectName ? "更换主体" : "选择主体")}</button>}</aside>
    </header>

    <section className="topicBriefCard" aria-label={`本轮${scopeLabel}获客目标简报`}>
      <header><span>本轮目标</span><div><strong>本轮{scopeLabel}获客目标简报</strong><p>先说明你的身份、目标人群和本轮要获得的线索；保存后仅归属本客户工作区与当前获客目标，可随时修改。</p></div></header>
      <div className="topicBriefFields">
        {isFounderMode && <label>获客目标 <b>必填</b><select value={target} onChange={(event) => { setTarget(event.target.value as FounderTopicTarget); setAcquisitionGoal(""); }}><option value="franchise">招商加盟</option><option value="store_visit">C端团购到店</option><option value="student">学员招募</option><option value="partner">合作方招募</option></select></label>}
        <label>{presentation?.identityLabel || targetDefinition.identityLabel} <b>必填</b><input value={identity} onChange={(event) => setIdentity(event.target.value)} placeholder={presentation?.identityPlaceholder || targetDefinition.identityPlaceholder} /></label>
        <label>{presentation?.customerLabel || targetDefinition.customerLabel} <b>必填</b><input value={targetCustomer} onChange={(event) => setTargetCustomer(event.target.value)} placeholder={presentation?.customerPlaceholder || targetDefinition.customerPlaceholder} /></label>
        <label>{presentation?.goalLabel || targetDefinition.goalLabel} <b>必填</b><select value={acquisitionGoal} onChange={(event) => setAcquisitionGoal(event.target.value)}><option value="">请选择本轮目标</option>{targetDefinition.goals.map((goal) => <option key={goal} value={goal}>{goal}</option>)}</select></label>
        <label>{presentation?.offerLabel || targetDefinition.offerLabel} <small>选填</small><input value={offer} onChange={(event) => setOffer(event.target.value)} placeholder={presentation?.offerPlaceholder || targetDefinition.offerPlaceholder} /></label>
        <label>账号与内容阶段<small>选填</small><select value={accountStage} onChange={(event) => setAccountStage(event.target.value)}><option value="">暂不确定</option><option value="抖音新号冷启动">抖音新号冷启动</option><option value="起号测试期">起号测试期</option><option value="稳定更新期">稳定更新期</option><option value="已有爆款，准备放大">已有爆款，准备放大</option><option value="视频号或小红书运营">视频号或小红书运营</option></select></label>
      </div>
      {isFounderMode && <div className="topicBriefSaveBar"><small>{briefLoading ? "正在恢复本客户获客目标简报…" : "本客户获客目标简报按当前获客目标独立保存。"}</small><button type="button" disabled={!subjectId || briefSaving || briefLoading || busy} onClick={() => void saveBrief()}>{briefSaving ? "保存中…" : "保存获客目标简报"}</button></div>}
    </section>

    <section className="topicSourceGrid" aria-label="四个选题数据来源">
      <article className={`topicSourceCard ${industry.trim() ? "ready" : "missing"}`}>
        <header><span>01</span><div><strong>行业热点</strong><small>确定要研究的行业，再检索近期变化与用户关注点</small></div><button type="button" className="topicSourceToggle" aria-pressed={sourceSelection.industry} onClick={() => setSourceSelection((current) => ({ ...current, industry: !current.industry }))}>{sourceSelection.industry ? "已启用" : "未启用"}</button></header>
        <label>所在行业<input value={industry} onChange={(event) => setIndustry(event.target.value)} placeholder="例如：AI企业服务、美业、餐饮连锁" /></label>
        <p>本轮只围绕这里填写的行业检索，不继承其他客户项目的行业。</p>
      </article>

      <article className={`topicSourceCard ${benchmarkAccounts.length ? "ready" : "missing"}`}>
        <header><span>02</span><div><strong>对标账号</strong><small>输入账号名或主页链接，支持多个账号</small></div><button type="button" className="topicSourceToggle" aria-pressed={sourceSelection.benchmark} onClick={() => setSourceSelection((current) => ({ ...current, benchmark: !current.benchmark }))}>{sourceSelection.benchmark ? "已启用" : "未启用"}</button></header>
        <label>对标账号<textarea rows={3} value={benchmarkText} onChange={(event) => setBenchmarkText(event.target.value)} placeholder="例如：抖音｜陈厂长｜主页链接\n视频号｜某某品牌创始人" /></label>
        <p>系统只分析能够核验的公开内容；同名账号无法确认时会标记待核实。</p>
      </article>

      <article className={`topicSourceCard ${recordingCredentialsNeedUpdate ? "error" : transcripts.length ? "ready" : connection ? "partial" : "missing"}`}>
        <header><span>03</span><div><strong>AI录音卡</strong><small>读取得到大脑里已经转写好的真实表达</small></div><button type="button" className="topicSourceToggle" aria-pressed={sourceSelection.transcript} disabled={localFixture} onClick={() => setSourceSelection((current) => ({ ...current, transcript: !current.transcript }))}>{sourceSelection.transcript ? "已启用" : "未启用"}</button></header>
        {localFixture ? <div className="topicSourceEmpty"><strong>合成验收环境未连接真实录音</strong><span>正式客户工作区只会使用已确认、属于当前项目且与本轮行业相关的录音。</span></div> : connection && !recordingCredentialsNeedUpdate ? <div className="topicConnectedSource">
          <strong>得到大脑已连接</strong>
          <span>{connection.lastSyncedAt ? `最近同步：${formatDate(connection.lastSyncedAt)}` : "尚未完成首次同步"}</span>
          {recordingSyncWarning && <span className="topicSourceWarning">上次同步未完成：{connection.lastError} 已保存凭证仍然有效，可直接重试。</span>}
          {unusableTranscriptCount > 0 && <span>已忽略 {unusableTranscriptCount} 条0秒或空转写，不会作为选题证据。</span>}
          <div>{canManageConnection && <button type="button" onClick={() => void syncRecordingCard()} disabled={syncing}>{syncing ? "同步中…" : "同步最新录音"}</button>}</div>
        </div> : canManageConnection ? <form className="topicConnectionForm" onSubmit={(event) => void connectRecordingCard(event)}>
          {recordingCredentialsNeedUpdate && <div className="topicCredentialRecovery"><strong>同步授权已失效</strong><span>{connection?.lastError || "请更新 API Key 后重新同步最新录音。"}</span></div>}
          <label>{recordingCredentialsNeedUpdate ? "新的 API Key" : "API Key"}<input type="password" autoComplete="off" minLength={8} value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="请输入得到大脑 API Key" required /></label>
          <label>{recordingCredentialsNeedUpdate ? "Client ID（如有变更再填写）" : "Client ID"}<input autoComplete="off" minLength={3} value={clientId} onChange={(event) => setClientId(event.target.value)} placeholder={recordingCredentialsNeedUpdate ? "已安全保存；如未变更可留空" : "请输入得到大脑 Client ID"} required={!connection} /></label>
          <button type="submit" disabled={connecting}>{connecting ? "验证并同步中…" : recordingCredentialsNeedUpdate ? "更新 API Key 并同步最新录音" : "连接并同步"}</button>
        </form> : <div className="topicSourceEmpty"><strong>需要管理员连接</strong><span>普通成员不能查看或修改企业 API 凭证，请联系企业管理员。</span></div>}
      </article>

      <article className={`topicSourceCard ${videoReview ? "ready" : "missing"}`}>
        <header><span>04</span><div><strong>自己账号真实数据复盘</strong><small>自动读取最近一次真实账号复盘，识别爆款方向与应放弃的选题</small></div><button type="button" className="topicSourceToggle" aria-pressed={sourceSelection.videoReview} onClick={() => setSourceSelection((current) => ({ ...current, videoReview: !current.videoReview }))}>{sourceSelection.videoReview ? "已启用" : "未启用"}</button></header>
        {videoReview ? <div className="topicReviewSource"><strong>{videoReview.title}</strong><span>{formatDate(videoReview.createdAt)}</span><p>{plainPreview(videoReview.content)}</p><button type="button" onClick={onOpenVideoReview}>查看账号数据复盘</button></div> : <div className="topicSourceEmpty"><strong>还没有可用的自己账号真实数据复盘</strong><span>上传账号后台数据完成复盘后，系统才会把爆款方向和应放弃的选题回流到这里。</span><button type="button" onClick={onOpenVideoReview}>去做账号数据复盘</button></div>}
      </article>
    </section>

    {(notice || error) && <p className={`topicSystemNotice ${error ? "error" : ""}`} role="status">{error || notice}</p>}

    <section className="topicGenerateBar">
      <div><span>本轮生成规则</span><strong>四大来源形成候选池 → 选题三关筛选 → 输出10条可测试选题</strong><small>缺少的来源会明确标记“待补/待核验”，不会用占位内容冒充事实。</small>{isFounderMode && <small data-testid="fip-topic-ai-generation-notice">点击生成会调用 AI 模型；只查看和编辑已保存结果不会调用。</small>}</div>
      <button type="button" disabled={localFixture || busy || loading || briefLoading || briefSaving || !identity.trim() || !targetCustomer.trim() || !acquisitionGoal.trim() || !industry.trim()} onClick={() => void generateTopics()}>{localFixture ? "合成验收仅查看（不调用 AI）" : busy ? "正在深度生成…" : loading || briefLoading ? "正在读取数据源…" : "保存获客目标简报并从四大来源生成选题"}</button>
    </section>

    {result && <section className="topicSystemResult" aria-live="polite">
      <header>
        <span>{beautyTopicCards.length ? "流程预览 · 非正式生成" : "TOPIC OUTPUT"}</span>
        <h3>{beautyTopicCards.length ? "用户可用TOP10预览" : "本轮选题结果"}</h3>
        {selectableTopics.length > 0 ? <div className="topicContentEntry">
          <select aria-label="选择要进入内容系统的选题" value={selectedTopicIndex} onChange={(event) => setSelectedTopicIndex(event.target.value)}>
            {selectableTopics.map((item, index) => <option key={`${item.topic}-${index}`} value={String(index)}>{index + 1}. {item.topic}</option>)}
          </select>
          <button type="button" disabled={busy || openingContent} onClick={() => void openSelectedTopicInContentSystem()}>{openingContent ? "正在带入选题…" : "用此选题进入内容系统"}</button>
        </div> : <p className="topicSelectionUnavailable">本轮结果缺少可识别的选题字段，请重新生成后再进入内容系统。</p>}
      </header>
      {beautyTopicCards.length ? <>
        <div className="beautyTopicResultActions"><button type="button" onClick={() => void copyBeautyTopics()}>复制全部TOP10</button></div>
        <div className="beautyTopicCards">{beautyTopicCards.map((item, index) => <article key={item.topic}>
          <header><span>{String(index + 1).padStart(2, "0")}</span><h4>{item.topic}</h4></header>
          <dl>
            <div><dt>适合人群</dt><dd>{item.audience}</dd></div>
            <div><dt>内容角度</dt><dd>{item.angle}</dd></div>
            <div><dt>为什么有助团购下单</dt><dd>{item.goalRelation}</dd></div>
            <div><dt>建议内容形式</dt><dd>{item.format}</dd></div>
          </dl>
          <div><button type="button" onClick={() => void copyBeautyTopics(index)}>复制本条</button><button type="button" disabled={openingContent} onClick={() => void openSelectedTopicInContentSystem(index)}>生成内容</button></div>
        </article>)}</div>
        <details className="beautyTopicAudit"><summary>选题策略摘要与来源质量审核</summary><ReactMarkdown remarkPlugins={[remarkGfm]}>{result.slice(result.indexOf("## 选题策略摘要"))}</ReactMarkdown></details>
      </> : <div className="topicSystemMarkdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{result}</ReactMarkdown></div>}
    </section>}
    <section className="systemDialoguePanel" aria-label="选题系统对话微调">
      <header><span>对话</span><div><strong>选题系统对话微调</strong><p>围绕本轮选题继续删改、补充来源或调整目标客户；不会改写为完整文案。</p></div></header>
      {turns.length > 0 && <div className="systemDialogueHistory">{turns.map((turn, index) => <article key={`${turn.question}-${index}`}><b>你</b><p>{turn.question}</p>{turn.answer && <><b>选题系统</b><div><ReactMarkdown remarkPlugins={[remarkGfm]}>{turn.answer}</ReactMarkdown></div></>}</article>)}</div>}
      <textarea rows={4} value={question} disabled={localFixture} onChange={(event) => setQuestion(event.target.value)} placeholder={localFixture ? "合成验收环境不调用 AI；请进入正式客户工作区微调选题。" : "例如：把目标客户改成连锁品牌创始人；只保留有录音证据的选题；第 3 条改成更适合抖音口播的表达。"} />
      <button type="button" disabled={localFixture || busy || !question.trim()} onClick={() => { onAsk(question.trim()); setQuestion(""); }}>{busy ? "正在调整…" : "发送选题修改要求"}</button>
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

type BeautyTopicCard = Pick<FounderIpContentSelection, "topic" | "audience" | "sourceEvidence" | "factBoundary" | "goalRelation"> & { angle: string; format: string };

function parseBeautyTopicCards(markdown: string): BeautyTopicCard[] {
  const block = markdown.match(/## 用户可用TOP10\s*\n([\s\S]*?)(?=\n## 选题策略摘要)/)?.[1] ?? "";
  const matches = [...block.matchAll(/^###\s+(\d{2})\.\s+(.+)$/gm)];
  return matches.slice(0, 10).map((match, index) => {
    const body = block.slice((match.index ?? 0) + match[0].length, matches[index + 1]?.index ?? block.length);
    const read = (label: string) => body.match(new RegExp(`^[-*]\\s*${label}[：:]\\s*(.+)$`, "m"))?.[1]?.trim() ?? "";
    return {
      topic: match[2]?.trim() ?? "",
      audience: read("适合人群"),
      angle: read("内容角度"),
      goalRelation: read("为什么有助[^：:]+") || read("为什么有助获客"),
      format: read("建议内容形式"),
      sourceEvidence: "来源状态在折叠审核区逐项保留",
      factBoundary: "未确认信息不进入用户TOP10"
    };
  }).filter((item) => item.topic && item.audience && item.angle && item.goalRelation && item.format);
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

export function isQualifiedFounderIpTranscript(document: TopicTranscript, industry: string, subjectId?: string): boolean {
  if (!isUsableTopicTranscript(document) || !document.confirmed) return false;
  if (subjectId && !document.subjectIds?.includes(subjectId)) return false;
  const normalizedIndustry = industry.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  const documentIndustry = (document.industry ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  const preview = `${document.title}\n${document.preview ?? ""}`.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  if (documentIndustry && normalizedIndustry && !documentIndustry.includes(normalizedIndustry) && !normalizedIndustry.includes(documentIndustry)) return false;
  if (!documentIndustry && normalizedIndustry && !preview.includes(normalizedIndustry)) return false;
  return true;
}

function plainPreview(value: string): string {
  return value.replace(/[#>*_`|\[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 180) || "已取得复盘结果。";
}

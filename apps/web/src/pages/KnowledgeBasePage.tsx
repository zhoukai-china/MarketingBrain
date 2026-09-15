import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { apiPath, getAppPath } from "../lib/api.js";
import { knowledgeSyncProgressText, knowledgeSyncResultText, resumeKnowledgeSync, runKnowledgeSync } from "../lib/knowledge-sync.js";
import { tenantBrandLogoSrc, useTenantBranding } from "../lib/tenant-branding.js";

interface KnowledgeConnection {
  id: string;
  provider: string;
  label: string;
  status: string;
  lastSyncedAt?: string;
  lastError?: string;
}

interface KnowledgeDocument {
  id: string;
  title: string;
  preview: string;
  characterCount: number;
  occurredAt?: string;
  sourceClass: string;
  knowledgeLayer: "raw_private" | "confirmed_ip" | "brand_asset" | "project_private" | "enterprise_experience" | "enterprise_industry";
  usagePolicy: "auto" | "recommend" | "manual";
  sensitivity: "normal" | "internal" | "sensitive";
  confirmed: boolean;
  industry?: string;
  subjectIds: string[];
  subjects: Array<{ id: string; subjectType: string; name: string }>;
}

interface KnowledgeSubject {
  id: string;
  subjectType: "enterprise" | "ip" | "brand" | "client_project";
  typeLabel: string;
  name: string;
  description?: string;
  industry?: string;
  isDefault: boolean;
  documentCount: number;
  autoDocumentCount: number;
  recommendedDocumentCount: number;
}

interface IndustryPack {
  id: string;
  name: string;
  description: string;
  reviewStatus: string;
  version: string;
  principles: string[];
}

interface KnowledgeAgent {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon?: string;
}

interface AgentAnalysis {
  agentId: string;
  agentName: string;
  status: string;
  output?: string;
  errorMessage?: string;
}

interface AnalysisBatch {
  id: string;
  title: string;
  status: string;
  createdAt: string;
  documentIds?: string[];
  agentIds?: string[];
  analyses: AgentAnalysis[];
  synthesis?: { status: string; content?: string; errorMessage?: string } | null;
}

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("store_os_token");
  const profile = localStorage.getItem("store_os_tenant_profile");
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(profile ? { "x-sitong-profile": encodeURIComponent(profile) } : {})
  };
}

async function readJson<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(payload.message ?? payload.error ?? "请求失败"), { status: response.status });
  return payload as T;
}

function displayAgentName(name: string, slug?: string): string {
  if (slug === "acquisition") return "获客智能体";
  if (slug === "sales") return "销售智能体";
  return name.replace(/agent/gi, "智能体").replace(/智能体智能体/g, "智能体");
}

function initialIdentityContext(): string {
  const saved = localStorage.getItem("sitong_kb_identity_context");
  if (saved) return saved;
  try {
    const profile = JSON.parse(localStorage.getItem("store_os_tenant_profile") ?? "{}") as Record<string, unknown>;
    const parts = [
      typeof profile.industry === "string" && profile.industry.trim() ? `行业：${profile.industry.trim()}` : "",
      typeof profile.offer === "string" && profile.offer.trim() ? `核心产品或服务：${profile.offer.trim()}` : "",
      typeof profile.customer === "string" && profile.customer.trim() ? `目标客户：${profile.customer.trim()}` : ""
    ].filter(Boolean);
    return parts.join("；");
  } catch {
    return "";
  }
}

export function KnowledgeBasePage() {
  const tenantBranding = useTenantBranding();
  const routeParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const requestedSubjectId = routeParams.get("subjectId") ?? "";
  const returnTo = routeParams.get("returnTo")?.startsWith("/agents/") ? routeParams.get("returnTo") ?? "" : "";
  const createFromAgent = routeParams.get("mode") === "create";
  const [connections, setConnections] = useState<KnowledgeConnection[]>([]);
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [subjects, setSubjects] = useState<KnowledgeSubject[]>([]);
  const [activeSubjectId, setActiveSubjectId] = useState("");
  const [industryPacks, setIndustryPacks] = useState<IndustryPack[]>([]);
  const [enterpriseSupplementCount, setEnterpriseSupplementCount] = useState(0);
  const [agents, setAgents] = useState<KnowledgeAgent[]>([]);
  const [history, setHistory] = useState<AnalysisBatch[]>([]);
  const [selectedDocuments, setSelectedDocuments] = useState<string[]>([]);
  const [selectedAgents, setSelectedAgents] = useState<string[]>([]);
  const [activeBatch, setActiveBatch] = useState<AnalysisBatch | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [clientId, setClientId] = useState("");
  const [instruction, setInstruction] = useState("");
  const [identityContext, setIdentityContext] = useState(initialIdentityContext);
  const [businessGoal, setBusinessGoal] = useState(() => localStorage.getItem("sitong_kb_business_goal") ?? "");
  const [factCorrections, setFactCorrections] = useState(() => localStorage.getItem("sitong_kb_fact_corrections") ?? "");
  const [supplement, setSupplement] = useState("");
  const [newSubjectType, setNewSubjectType] = useState<KnowledgeSubject["subjectType"]>(() => {
    const requestedType = routeParams.get("subjectType");
    return requestedType === "enterprise" || requestedType === "ip" || requestedType === "brand" || requestedType === "client_project" ? requestedType : "ip";
  });
  const [newSubjectName, setNewSubjectName] = useState("");
  const [newSubjectIndustry, setNewSubjectIndustry] = useState("");
  const [newSubjectDescription, setNewSubjectDescription] = useState("");
  const [creatingSubject, setCreatingSubject] = useState(false);
  const [updatingDocumentId, setUpdatingDocumentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [manualTitle, setManualTitle] = useState("");
  const [manualContent, setManualContent] = useState("");
  const [savingManual, setSavingManual] = useState(false);
  const [importingFiles, setImportingFiles] = useState(false);
  const [externalProvider, setExternalProvider] = useState<"wecom" | "feishu">("wecom");
  const [externalApiKey, setExternalApiKey] = useState("");
  const [externalClientId, setExternalClientId] = useState("");
  const [externalApiBaseUrl, setExternalApiBaseUrl] = useState("");
  const [savingExternal, setSavingExternal] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  const getNoteConnection = connections.find((item) => item.provider === "getnote");
  const getNoteNeedsReconnect = Boolean(getNoteConnection && getNoteConnection.status !== "active");
  const activeSubject = subjects.find((item) => item.id === activeSubjectId);
  const allDocumentsSelected = documents.length > 0 && selectedDocuments.length === documents.length;
  const allAgentsSelected = agents.length > 0 && selectedAgents.length === agents.length;
  const ready = (selectedDocuments.length > 0 || (activeSubject?.autoDocumentCount ?? 0) > 0) && selectedAgents.length > 0 && !analyzing;
  const selectedCharacterCount = useMemo(() => documents
    .filter((item) => selectedDocuments.includes(item.id))
    .reduce((sum, item) => sum + item.characterCount, 0), [documents, selectedDocuments]);

  useEffect(() => {
    if (!localStorage.getItem("store_os_token")) {
      localStorage.setItem("store_os_post_login_redirect", getAppPath("/knowledge-base"));
      window.location.href = getAppPath("/login");
      return;
    }
    void loadAll();
  }, []);

  useEffect(() => {
    localStorage.setItem("sitong_kb_identity_context", identityContext);
    localStorage.setItem("sitong_kb_business_goal", businessGoal);
    localStorage.setItem("sitong_kb_fact_corrections", factCorrections);
  }, [identityContext, businessGoal, factCorrections]);

  useEffect(() => {
    if (!getNoteConnection || syncing) return;
    const controller = new AbortController();
    let resumedActive = false;
    void resumeKnowledgeSync(getNoteConnection.id, authHeaders(), (progress) => {
      if (progress.status === "queued" || progress.status === "running") resumedActive = true;
      if (resumedActive) {
        setSyncing(progress.status === "queued" || progress.status === "running");
        setNotice(progress.status === "succeeded" ? knowledgeSyncResultText(progress) : knowledgeSyncProgressText(progress));
      }
    }, controller.signal).then((result) => {
      if (resumedActive && result?.status !== "succeeded") setError(knowledgeSyncResultText(result!));
      if (resumedActive && result?.status === "succeeded") void loadAll();
    }).catch((reason) => { if ((reason as { name?: string }).name !== "AbortError") setError(reason instanceof Error ? reason.message : "同步状态恢复失败"); });
    return () => controller.abort();
  }, [getNoteConnection?.id]);

  async function loadAll() {
    setLoading(true);
    setError("");
    try {
      const [connectionPayload, documentPayload, agentPayload, historyPayload, subjectPayload] = await Promise.all([
        fetch(apiPath("/knowledge-base/connections"), { headers: authHeaders() }).then((response) => readJson<{ connections: KnowledgeConnection[] }>(response)),
        fetch(apiPath("/knowledge-base/documents"), { headers: authHeaders() }).then((response) => readJson<{ documents: KnowledgeDocument[] }>(response)),
        fetch(apiPath("/knowledge-base/agents"), { headers: authHeaders() }).then((response) => readJson<{ agents: KnowledgeAgent[] }>(response)),
        fetch(apiPath("/knowledge-base/analyses"), { headers: authHeaders() }).then((response) => readJson<{ batches: AnalysisBatch[] }>(response)),
        fetch(apiPath("/knowledge-base/subjects"), { headers: authHeaders() }).then((response) => readJson<{ subjects: KnowledgeSubject[] }>(response))
      ]);
      setConnections(connectionPayload.connections);
      setDocuments(documentPayload.documents);
      setAgents(agentPayload.agents);
      setHistory(historyPayload.batches);
      setSubjects(subjectPayload.subjects);
      const nextSubjectId = requestedSubjectId && subjectPayload.subjects.some((item) => item.id === requestedSubjectId)
        ? requestedSubjectId
        : activeSubjectId && subjectPayload.subjects.some((item) => item.id === activeSubjectId)
        ? activeSubjectId
        : subjectPayload.subjects.find((item) => item.isDefault)?.id ?? subjectPayload.subjects[0]?.id ?? "";
      setActiveSubjectId(nextSubjectId);
      if (nextSubjectId) await loadIndustryPacks(nextSubjectId);
      setSelectedAgents(agentPayload.agents.map((agent) => agent.id));
      if (historyPayload.batches[0]) setActiveBatch(historyPayload.batches[0]);
    } catch (reason) {
      const typed = reason as Error & { status?: number };
      if (typed.status === 401) {
        localStorage.setItem("store_os_post_login_redirect", getAppPath("/knowledge-base"));
        window.location.href = getAppPath("/login");
        return;
      }
      setError(typed.message);
    } finally {
      setLoading(false);
    }
  }

  async function connectGetNote(event: FormEvent) {
    event.preventDefault();
    setConnecting(true);
    setError("");
    setNotice("正在验证得到大脑授权…");
    try {
      await fetch(apiPath("/knowledge-base/connections/getnote"), {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey, clientId, label: "得到大脑" })
      }).then((response) => readJson(response));
      setApiKey("");
      setClientId("");
      setNotice("得到大脑已连接。现在可以同步已转写的文字。API Key 不会显示在页面中。");
      await loadAll();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "连接失败");
      setNotice("");
    } finally {
      setConnecting(false);
    }
  }

  async function syncGetNote() {
    if (!getNoteConnection) return;
    setSyncing(true);
    setError("");
    setNotice("正在提交同步任务…");
    try {
      const sync = await runKnowledgeSync(getNoteConnection.id, authHeaders(), (progress) => setNotice(knowledgeSyncProgressText(progress)), { subjectId: activeSubjectId || undefined });
      if (sync.status !== "succeeded") throw new Error(knowledgeSyncResultText(sync));
      setNotice(knowledgeSyncResultText(sync));
      await loadAll();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "同步失败");
      setNotice("");
    } finally {
      setSyncing(false);
    }
  }

  async function createManualDocument(event: FormEvent) {
    event.preventDefault();
    if (!manualTitle.trim() || !manualContent.trim() || savingManual) return;
    setSavingManual(true);
    setError("");
    try {
      await fetch(apiPath("/knowledge-base/documents/manual"), {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ title: manualTitle.trim(), content: manualContent.trim(), subjectId: activeSubjectId || undefined, sourceLabel: "自定义输入" })
      }).then((response) => readJson(response));
      setManualTitle("");
      setManualContent("");
      setNotice("自定义资料已沉淀到当前知识主体，默认需要你确认后才会自动调用。");
      await loadAll();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存自定义资料失败");
    } finally {
      setSavingManual(false);
    }
  }

  async function importKnowledgeFiles(files: FileList | null) {
    if (!files?.length || importingFiles) return;
    setImportingFiles(true);
    setError("");
    const failures: string[] = [];
    let imported = 0;
    try {
      for (const file of Array.from(files).slice(0, 100)) {
        const form = new FormData();
        form.append("file", file);
        if (activeSubjectId) form.append("subjectId", activeSubjectId);
        form.append("sourceLabel", "批量文件上传");
        try {
          await fetch(apiPath("/knowledge-base/documents/upload"), { method: "POST", headers: authHeaders(), body: form }).then((response) => readJson(response));
          imported += 1;
        } catch (reason) {
          failures.push(`${file.name}：${reason instanceof Error ? reason.message : "导入失败"}`);
        }
      }
      await loadAll();
      if (imported) setNotice(`已导入 ${imported} 份文件到“${activeSubject?.name ?? "当前主体"}”。导入后默认由你确认是否自动调用。`);
      if (failures.length) setError(failures.join("；"));
    } finally {
      setImportingFiles(false);
    }
  }

  async function configureExternalConnection(event: FormEvent) {
    event.preventDefault();
    if (!externalApiKey.trim() || savingExternal) return;
    setSavingExternal(true);
    setError("");
    try {
      const label = externalProvider === "wecom" ? "企业微信" : "飞书";
      const payload = await fetch(apiPath("/knowledge-base/connections/external"), {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ provider: externalProvider, label, apiKey: externalApiKey.trim(), clientId: externalClientId.trim() || undefined, apiBaseUrl: externalApiBaseUrl.trim() || undefined })
      }).then((response) => readJson<{ message?: string }>(response));
      setExternalApiKey("");
      setExternalClientId("");
      setExternalApiBaseUrl("");
      setNotice(payload.message ?? "外部系统 API 配置已加密保存，等待完成授权与字段映射。 ");
      await loadAll();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存外部系统配置失败");
    } finally {
      setSavingExternal(false);
    }
  }

  async function loadIndustryPacks(subjectId: string) {
    const payload = await fetch(apiPath(`/knowledge-base/industry-packs?subjectId=${encodeURIComponent(subjectId)}`), { headers: authHeaders() })
      .then((response) => readJson<{ platformPacks: IndustryPack[]; enterpriseSupplementCount: number }>(response));
    setIndustryPacks(payload.platformPacks);
    setEnterpriseSupplementCount(payload.enterpriseSupplementCount);
  }

  async function selectSubject(subjectId: string) {
    setActiveSubjectId(subjectId);
    setSelectedDocuments([]);
    setError("");
    try { await loadIndustryPacks(subjectId); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "行业知识读取失败"); }
  }

  async function createSubject(event: FormEvent) {
    event.preventDefault();
    if (!newSubjectName.trim() || creatingSubject) return;
    setCreatingSubject(true);
    setError("");
    try {
      const payload = await fetch(apiPath("/knowledge-base/subjects"), {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          subjectType: newSubjectType,
          name: newSubjectName.trim(),
          industry: newSubjectIndustry.trim() || undefined,
          description: newSubjectDescription.trim() || undefined,
          isDefault: subjects.length === 0
        })
      }).then((response) => readJson<{ subject: KnowledgeSubject }>(response));
      setNewSubjectName(""); setNewSubjectIndustry(""); setNewSubjectDescription("");
      setNotice(`已建立${payload.subject.typeLabel}“${payload.subject.name}”。现在可以把录音和资料归入这个主体。`);
      await loadAll();
      await selectSubject(payload.subject.id);
      if (returnTo) {
        localStorage.setItem("sitong_pending_acquisition_subject", payload.subject.id);
        window.location.href = getAppPath(returnTo);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "创建知识主体失败");
    } finally {
      setCreatingSubject(false);
    }
  }

  async function classifyDocument(document: KnowledgeDocument, options: { usagePolicy?: KnowledgeDocument["usagePolicy"]; sensitivity?: KnowledgeDocument["sensitivity"]; knowledgeLayer?: KnowledgeDocument["knowledgeLayer"] }) {
    if (!activeSubject || updatingDocumentId) return;
    setUpdatingDocumentId(document.id);
    setError("");
    const sensitivity = options.sensitivity ?? document.sensitivity;
    const requestedPolicy = options.usagePolicy ?? document.usagePolicy;
    const usagePolicy = sensitivity === "sensitive" && requestedPolicy === "auto" ? "recommend" : requestedPolicy;
    const knowledgeLayer = options.knowledgeLayer ?? (document.knowledgeLayer === "raw_private"
      ? activeSubject.subjectType === "ip" ? "confirmed_ip" : activeSubject.subjectType === "brand" ? "brand_asset" : activeSubject.subjectType === "client_project" ? "project_private" : "enterprise_experience"
      : document.knowledgeLayer);
    const subjectIds = Array.from(new Set([...document.subjectIds, activeSubject.id]));
    try {
      const payload = await fetch(apiPath(`/knowledge-base/documents/${document.id}/classification`), {
        method: "PATCH",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          subjectIds,
          knowledgeLayer,
          usagePolicy,
          sensitivity,
          confirmed: usagePolicy === "auto" || document.confirmed,
          industry: knowledgeLayer === "enterprise_industry" ? (activeSubject.industry || document.industry || undefined) : document.industry || undefined
        })
      }).then((response) => readJson<{ document: KnowledgeDocument }>(response));
      setDocuments((current) => current.map((item) => item.id === document.id ? payload.document : item));
      const subjectPayload = await fetch(apiPath("/knowledge-base/subjects"), { headers: authHeaders() }).then((response) => readJson<{ subjects: KnowledgeSubject[] }>(response));
      setSubjects(subjectPayload.subjects);
      await loadIndustryPacks(activeSubject.id);
      setNotice(usagePolicy === "auto" ? "资料已确认，智能体服务该主体时会自动调用。" : usagePolicy === "recommend" ? "资料已归档为相关推荐，使用前仍由用户选择。" : "资料已归档为仅手动调用。 ");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "资料归类失败");
    } finally {
      setUpdatingDocumentId(null);
    }
  }

  async function runAnalysis(options?: { supplement?: string; reuseActiveBatch?: boolean }) {
    const documentIds = options?.reuseActiveBatch && activeBatch?.documentIds?.length ? activeBatch.documentIds : selectedDocuments;
    const agentIds = options?.reuseActiveBatch && activeBatch?.agentIds?.length ? activeBatch.agentIds : selectedAgents;
    if (!documentIds.length || !agentIds.length || analyzing) return;
    const supplementedInstruction = [instruction, options?.supplement ? `用户在上一版报告后补充：${options.supplement}` : ""].filter(Boolean).join("\n");
    setAnalyzing(true);
    setError("");
    setNotice(agentIds.length > 1
      ? `正在让 ${agentIds.length} 个智能体分别分析，再生成联合会诊报告…`
      : "正在让智能体结合你的身份、业务目标和资料完成分析…");
    try {
      const payload = await fetch(apiPath("/knowledge-base/analyses"), {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          documentIds,
          subjectId: activeSubjectId || undefined,
          agentIds,
          instruction: supplementedInstruction || undefined,
          identityContext: identityContext || undefined,
          businessGoal: businessGoal || undefined,
          factCorrections: factCorrections || undefined
        })
      }).then((response) => readJson<{ batch: AnalysisBatch }>(response));
      setActiveBatch(payload.batch);
      setHistory((current) => [payload.batch, ...current.filter((item) => item.id !== payload.batch.id)]);
      if (options?.supplement) setSupplement("");
      setNotice(payload.batch.status === "completed" ? (agentIds.length > 1 ? "联合会诊完成。" : "智能体分析完成。") : "分析已完成，但有部分结果未能返回。");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "会诊失败");
      setNotice("");
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <main className="agentProductPage knowledgeBasePage">
      <nav className="agentTopbar knowledgeTopbar">
        {/* 2026-09-15：旧「专业工作地图」工作台 /my-ai 已下线（现在只做跳转），
            品牌回货架、返回入口回新的「常用智能体」页 /mine。 */}
        <button className="agentBrand whiteLabelBrand" onClick={() => window.location.href = getAppPath("/agents")}><span className={`tenantBrandLogo ${tenantBranding.logoUrl ? "hasImage" : ""}`} style={{ background: tenantBranding.logoUrl ? undefined : tenantBranding.primaryColor }}>{tenantBranding.logoUrl ? <img src={tenantBrandLogoSrc(tenantBranding)} alt={`${tenantBranding.brandName} Logo`} /> : tenantBranding.brandName.slice(0, 2)}</span><strong>{tenantBranding.isCustomized ? `${tenantBranding.brandName}企业知识库` : "企业知识库"}</strong></button>
        <div>{returnTo && <button className="ghostButton" onClick={() => window.location.href = getAppPath(returnTo)}>返回品牌获客</button>}<button className="ghostButton" onClick={() => window.location.href = getAppPath("/mine")}>返回常用智能体</button><button className="ghostButton" onClick={() => window.location.href = getAppPath("/account")}>企业账户</button></div>
      </nav>

      <section className="knowledgeHero">
        <div><p className="agentKicker">ENTERPRISE KNOWLEDGE BASE</p><h1>企业知识库</h1><p>统一沉淀企业文件、IP 本人资料、外部转写与行业知识。智能体只调用已确认、可追溯且属于当前主体的资料。</p></div>
        <div className="knowledgeStats"><article><strong>{documents.filter((item) => item.sourceClass === "upload" || item.sourceClass === "manual").length}</strong><span>企业私有资料</span></article><article><strong>{connections.length}</strong><span>外部接入来源</span></article><article><strong>{industryPacks.length}</strong><span>行业知识包</span></article></div>
      </section>

      {!loading && <section className="knowledgeSubjectHub">
        <div className="knowledgeSubjectManager">
          <header><div><span>SUBJECTS</span><h2>当前服务主体</h2><p>IP、品牌和客户项目各走各的知识，防止串资料。</p></div></header>
          <div className="knowledgeSubjectTabs">{subjects.map((subject) => <button key={subject.id} className={activeSubjectId === subject.id ? "active" : ""} onClick={() => void selectSubject(subject.id)}><strong>{subject.name}</strong><span>{subject.typeLabel}{subject.industry ? ` · ${subject.industry}` : ""}</span><small>自动 {subject.autoDocumentCount} · 推荐 {subject.recommendedDocumentCount} · 共 {subject.documentCount}</small></button>)}</div>
        </div>
        <form className={`knowledgeSubjectCreate ${createFromAgent ? "highlight" : ""}`} onSubmit={createSubject}>
          <strong>{createFromAgent ? "新增客户项目" : "新增IP或客户项目"}</strong>
          <div><select value={newSubjectType} onChange={(event) => setNewSubjectType(event.target.value as KnowledgeSubject["subjectType"])}><option value="ip">IP本人</option><option value="brand">品牌</option><option value="client_project">客户项目</option><option value="enterprise">企业</option></select><input value={newSubjectName} onChange={(event) => setNewSubjectName(event.target.value)} placeholder="主体名称" required /></div>
          <input value={newSubjectIndustry} onChange={(event) => setNewSubjectIndustry(event.target.value)} placeholder="所属行业，例如：餐饮、企业AI、手机后市场" />
          <input value={newSubjectDescription} onChange={(event) => setNewSubjectDescription(event.target.value)} placeholder="主营产品、目标客户或项目说明（可选）" />
          <button disabled={creatingSubject}>{creatingSubject ? "创建中…" : returnTo ? "建立并返回品牌获客" : "建立独立知识空间"}</button>
        </form>
      </section>}

      {error && <p className="knowledgeAlert error">{error}</p>}
      {notice && <p className="knowledgeAlert">{notice}</p>}
      {loading ? <p className="agentNotice">正在打开企业经营资料库…</p> : (
        <>
          <section className="knowledgeIntakeHub" aria-label="资料接入中心">
            <header><div><span>KNOWLEDGE INTAKE</span><h2>把资料沉淀为可调用的经营事实</h2><p>资料只保存一份，按当前企业、IP 或客户项目归属；未经确认的原始资料不会自动参与智能体判断。</p></div><strong>{activeSubject?.name ?? "请选择知识主体"}</strong></header>
            <div className="knowledgeIntakeGrid">
              <article className="knowledgeIntakeAction upload">
                <input ref={uploadInputRef} className="knowledgeFileInput" type="file" multiple accept=".txt,.md,.csv,.tsv,.json,.log,text/plain,text/markdown,text/csv,application/json" onChange={(event) => { void importKnowledgeFiles(event.target.files); event.currentTarget.value = ""; }} disabled={importingFiles} />
                <span>01</span><strong>企业私有资料</strong><p>上传企业文件、IP 本人资料、客户项目资料或已确认的经验。支持 TXT、MD、CSV、TSV、JSON、LOG，最多 20 份。</p>
                <button type="button" onClick={() => uploadInputRef.current?.click()} disabled={importingFiles}>{importingFiles ? "正在导入…" : "选择文件上传"}</button>
              </article>
              <article className="knowledgeIntakeAction recording">
                <span>02</span><strong>外部资料接入</strong><p>{getNoteConnection && !getNoteNeedsReconnect ? "得到大脑已连接，可将最新录音转写同步为知识资料。企业微信、飞书可在下方配置。" : "得到大脑授权已失效或尚未连接：请直接重新填写 API Key 和 Client ID。"}</p>
                {getNoteConnection && !getNoteNeedsReconnect ? <button type="button" onClick={() => void syncGetNote()} disabled={syncing}>{syncing ? "同步中…" : "同步最新录音"}</button> : <form className="getNoteReconnectForm" onSubmit={connectGetNote}><input type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="得到大脑 API Key" required /><input value={clientId} autoComplete="off" onChange={(event) => setClientId(event.target.value)} placeholder="Client ID" required /><button disabled={connecting}>{connecting ? "重新连接中…" : "重新连接并同步"}</button></form>}
                <details className="externalConnectMore"><summary>接入企业微信 / 飞书</summary><form onSubmit={configureExternalConnection}><select value={externalProvider} onChange={(event) => setExternalProvider(event.target.value as "wecom" | "feishu")}><option value="wecom">企业微信</option><option value="feishu">飞书</option></select><input type="password" autoComplete="off" value={externalApiKey} onChange={(event) => setExternalApiKey(event.target.value)} placeholder="API Key / Access Token" required /><input value={externalClientId} onChange={(event) => setExternalClientId(event.target.value)} placeholder="Client ID / App ID（可选）" /><button disabled={savingExternal}>{savingExternal ? "保存中…" : "保存 API 配置"}</button></form></details>
              </article>
              <form className="knowledgeIntakeAction manual" onSubmit={createManualDocument}>
                <span>03</span><strong>企业 / IP 自定义资料</strong><input value={manualTitle} onChange={(event) => setManualTitle(event.target.value)} placeholder="资料标题，例如：IP 本人表达习惯" required /><textarea rows={3} value={manualContent} onChange={(event) => setManualContent(event.target.value)} placeholder="粘贴已经确认的事实、案例、方法、纪要或表达习惯…" required /><button disabled={savingManual}>{savingManual ? "保存中…" : "保存为企业资料"}</button>
              </form>
              <article className="knowledgeIntakeAction external">
                <span>04</span><strong>AI 抓取的行业知识</strong><p>行业基础包与企业补充经验分层保存。选择当前主体所属行业后，系统会加载审核过的行业垂类知识。</p><button type="button" onClick={() => document.getElementById("knowledge-industry-layers")?.scrollIntoView({ behavior: "smooth", block: "start" })}>查看行业知识</button><small>仅使用有来源、可追溯的行业资料；不会把网络推测写成企业事实。</small>
              </article>
            </div>
          </section>
          <div className="knowledgeLayout">
          <aside className="knowledgeSourcesPanel">
            <header><span>01</span><div><h2>连接资料来源</h2><p>目前先接入得到大脑</p></div></header>
            {getNoteConnection ? (
              <article className="connectedSource">
                <div className="sourceLogo">得</div><div><strong>{getNoteConnection.label}</strong><span className={`sourceStatus ${getNoteConnection.status}`}>{getNoteConnection.status === "active" ? "已安全连接" : "需要检查"}</span></div>
                <p>只读取你在得到大脑中已经转写好的文字，不上传录音、不进行语音识别。</p>
                <small>上次同步：{getNoteConnection.lastSyncedAt ? new Date(getNoteConnection.lastSyncedAt).toLocaleString("zh-CN") : "尚未同步"}</small>
                <button className="primaryButton" disabled={syncing} onClick={() => void syncGetNote()}>{syncing ? "同步中…" : "同步最新资料"}</button>
              </article>
            ) : (
              <form className="getNoteConnectForm" onSubmit={connectGetNote}>
                <div className="sourceIdentity"><span className="sourceLogo">得</span><div><strong>得到大脑</strong><small>GetNote OpenAPI</small></div></div>
                <label>API Key<input id="getnote-api-key" type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="gk_live_..." required /></label>
                <label>Client ID<input value={clientId} autoComplete="off" onChange={(event) => setClientId(event.target.value)} placeholder="cli_..." required /></label>
                <p>需要 <code>note.content.read</code> 权限。凭证加密保存，不会提供给任何智能体。</p>
                <button className="primaryButton" disabled={connecting}>{connecting ? "验证中…" : "验证并连接"}</button>
              </form>
            )}
            <div className="plannedSources"><p>后续可接入</p><span>钉钉录音与文档</span><span>微信读书书摘</span><small>仅在平台提供正式授权 API 时开放</small></div>
          </aside>

          <section className="knowledgeWorkbench">
            <article className="knowledgeSelectionCard">
              <header><span>02</span><div><h2>整理“{activeSubject?.name ?? "当前主体"}”的资料</h2><p>已确认自动调用；原始录音、推荐资料和敏感项目资料仍由用户选择。当前手动选中 {selectedDocuments.length} 条。</p></div><button onClick={() => setSelectedDocuments(allDocumentsSelected ? [] : documents.map((item) => item.id))}>{allDocumentsSelected ? "取消全选" : "全选资料"}</button></header>
              <div className="knowledgeDocumentList">
                {documents.length ? documents.map((document) => {
                  const belongsToActiveSubject = Boolean(activeSubjectId && document.subjectIds.includes(activeSubjectId));
                  return <article key={document.id} className={`knowledgeDocumentManage ${selectedDocuments.includes(document.id) ? "selected" : ""} ${belongsToActiveSubject ? "assigned" : ""}`}>
                    <label><input type="checkbox" checked={selectedDocuments.includes(document.id)} onChange={(event) => setSelectedDocuments(event.target.checked ? [...selectedDocuments, document.id] : selectedDocuments.filter((id) => id !== document.id))} /><div><strong>{document.title}</strong><small>{document.occurredAt ? new Date(document.occurredAt).toLocaleDateString("zh-CN") : "日期未知"} · {document.characterCount.toLocaleString()} 字 · {document.subjects.length ? document.subjects.map((item) => item.name).join("、") : "尚未归属主体"}</small><p>{document.preview}</p></div></label>
                    <div className="knowledgeDocumentPolicy">
                      <span className={`knowledgePolicyBadge ${document.usagePolicy}`}>{document.usagePolicy === "auto" ? "已确认·自动调用" : document.usagePolicy === "recommend" ? "相关推荐·使用前选择" : "仅手动调用"}</span>
                      <select value={document.knowledgeLayer} onChange={(event) => void classifyDocument(document, { knowledgeLayer: event.target.value as KnowledgeDocument["knowledgeLayer"] })}><option value="raw_private">原始私有资料</option><option value="confirmed_ip">IP本人知识</option><option value="brand_asset">品牌资产</option><option value="project_private">客户项目资料</option><option value="enterprise_experience">企业经验</option><option value="enterprise_industry">企业行业补充</option></select>
                      <select value={document.sensitivity} onChange={(event) => void classifyDocument(document, { sensitivity: event.target.value as KnowledgeDocument["sensitivity"] })}><option value="normal">普通资料</option><option value="internal">内部资料</option><option value="sensitive">敏感资料</option></select>
                      <button disabled={!activeSubject || updatingDocumentId === document.id} onClick={() => void classifyDocument(document, { usagePolicy: "auto" })}>确认并自动调用</button>
                      <button disabled={!activeSubject || updatingDocumentId === document.id} onClick={() => void classifyDocument(document, { usagePolicy: "recommend" })}>归为推荐</button>
                      <button disabled={!activeSubject || updatingDocumentId === document.id} onClick={() => void classifyDocument(document, { usagePolicy: "manual" })}>仅手动</button>
                    </div>
                  </article>;
                }) : <div className="knowledgeEmpty"><strong>还没有知识资料</strong><p>连接得到大脑后，点击“同步最新资料”。</p></div>}
              </div>
            </article>

            <article id="knowledge-industry-layers" className="knowledgeSelectionCard knowledgeIndustryLayers">
              <header><span>行业</span><div><h2>行业知识分层</h2><p>平台基础包负责补盲，企业补充资料保留自己的经验来源，不能混成企业事实。</p></div></header>
              <div className="industryLayerGrid">
                <section><span>平台审核基础包</span>{industryPacks.map((pack) => <article key={pack.id}><strong>{pack.name}</strong><small>平台审核 · v{pack.version}</small><p>{pack.description}</p></article>)}</section>
                <section><span>企业行业经验</span><article><strong>{activeSubject?.industry || "当前行业"}企业补充</strong><small>{enterpriseSupplementCount} 条企业资料</small><p>把资料层级改为“企业行业补充”，可沉淀本企业验证过的方法、术语和经验；仍会与平台基础包分层引用。</p></article></section>
              </div>
            </article>

            <article className="knowledgeSelectionCard knowledgeAnalysisRelocated">
              <header><span>03</span><div><h2>经营分析已移至 CEO 驾驶舱</h2><p>企业知识库负责资料接入、归属、分层、权限和人工确认；分析、会诊与报告在 CEO 驾驶舱完成。</p></div></header>
              <div className="knowledgeAnalysisRelocatedBody"><p>当前主体已沉淀 <strong>{activeSubject?.documentCount ?? 0}</strong> 条资料，其中 <strong>{activeSubject?.autoDocumentCount ?? 0}</strong> 条可由智能体自动调用。你也可以继续在本页选择资料、调整资料层级和调用权限。</p><button type="button" onClick={() => window.location.href = getAppPath("/agents/ceo-cockpit")}>前往 CEO 驾驶舱发起经营会诊</button></div>
            </article>
          </section>
          </div>
        </>
      )}
    </main>
  );
}

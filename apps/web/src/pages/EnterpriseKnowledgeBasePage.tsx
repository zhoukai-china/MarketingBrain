import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { apiPath, getAppPath } from "../lib/api.js";

type Connection = { id: string; provider: string; label: string; status: string; capabilities: string[]; lastSyncedAt?: string; lastError?: string };
type Subject = { id: string; name: string; typeLabel: string; industry?: string; isDefault: boolean; documentCount: number };
type Document = { id: string; title: string; preview: string; characterCount: number; sourceClass: string; occurredAt?: string; subjects: Array<{ id: string; name: string }> };
type DocumentPagination = { page: number; limit: number; total: number; hasMore: boolean };
type IndustryPack = { id: string; name: string; description: string; version: string };
type IndustryResearch = { created: number; updated: number; stored: number; cap: number; discovered: number; hasMore: boolean; mode?: "base" | "expanded"; keywords?: string[]; message?: string };
type PlatformProvider = "feishu" | "wecom";

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function normalizeSubjects(value: unknown): Subject[] {
  return asArray<Record<string, unknown>>(value).map((item) => ({
    id: String(item.id ?? ""),
    name: String(item.name ?? "未命名主体"),
    typeLabel: String(item.typeLabel ?? "企业"),
    industry: typeof item.industry === "string" ? item.industry : undefined,
    isDefault: Boolean(item.isDefault),
    documentCount: Number.isFinite(Number(item.documentCount)) ? Number(item.documentCount) : 0
  })).filter((item) => item.id);
}

function normalizeDocuments(value: unknown): Document[] {
  return asArray<Record<string, unknown>>(value).map((item) => ({
    id: String(item.id ?? ""),
    title: String(item.title ?? "未命名资料"),
    preview: String(item.preview ?? ""),
    characterCount: Number.isFinite(Number(item.characterCount)) ? Number(item.characterCount) : 0,
    sourceClass: String(item.sourceClass ?? "企业资料"),
    occurredAt: typeof item.occurredAt === "string" ? item.occurredAt : undefined,
    subjects: asArray<Record<string, unknown>>(item.subjects).map((subject) => ({ id: String(subject.id ?? ""), name: String(subject.name ?? "") })).filter((subject) => subject.id && subject.name)
  })).filter((item) => item.id);
}

function normalizeConnections(value: unknown): Connection[] {
  return asArray<Record<string, unknown>>(value).map((item) => ({
    id: String(item.id ?? ""),
    provider: String(item.provider ?? ""),
    label: String(item.label ?? "外部资料源"),
    status: String(item.status ?? "inactive"),
    capabilities: asArray<unknown>(item.capabilities).map(String),
    lastSyncedAt: typeof item.lastSyncedAt === "string" ? item.lastSyncedAt : undefined,
    lastError: typeof item.lastError === "string" ? item.lastError : undefined
  })).filter((item) => item.id);
}

function normalizeIndustryPacks(value: unknown): IndustryPack[] {
  return asArray<Record<string, unknown>>(value).map((item) => ({
    id: String(item.id ?? ""),
    name: String(item.name ?? "行业知识包"),
    description: String(item.description ?? ""),
    version: String(item.version ?? "1")
  })).filter((item) => item.id);
}

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("store_os_token");
  const profile = localStorage.getItem("store_os_tenant_profile");
  return { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(profile ? { "x-sitong-profile": encodeURIComponent(profile) } : {}) };
}

async function readJson<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message ?? payload.error ?? "请求失败");
  return payload as T;
}

export function EnterpriseKnowledgeBasePage() {
  const query = useMemo(() => new URLSearchParams(window.location.search), []);
  const returnTo = query.get("returnTo")?.startsWith("/agents/") ? query.get("returnTo") ?? "/agents/acquisition" : "/agents/acquisition";
  const inputRef = useRef<HTMLInputElement>(null);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [subjectId, setSubjectId] = useState("");
  const [documents, setDocuments] = useState<Document[]>([]);
  const [documentPagination, setDocumentPagination] = useState<DocumentPagination>({ page: 1, limit: 50, total: 0, hasMore: false });
  const [connections, setConnections] = useState<Connection[]>([]);
  const [industryPacks, setIndustryPacks] = useState<IndustryPack[]>([]);
  const [industryDialogOpen, setIndustryDialogOpen] = useState(false);
  const [industryInput, setIndustryInput] = useState("");
  const [industryKeywords, setIndustryKeywords] = useState("");
  const [industryResearch, setIndustryResearch] = useState<IndustryResearch | null>(null);
  const [researchingIndustry, setResearchingIndustry] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [clientId, setClientId] = useState("");
  const [manualTitle, setManualTitle] = useState("");
  const [manualContent, setManualContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncingConnectionIds, setSyncingConnectionIds] = useState<string[]>([]);
  const [platformProvider, setPlatformProvider] = useState<PlatformProvider>("feishu");
  const [platformAppId, setPlatformAppId] = useState("");
  const [platformSecret, setPlatformSecret] = useState("");
  const [platformAgentId, setPlatformAgentId] = useState("");
  const [platformResourceUrl, setPlatformResourceUrl] = useState("");
  const [platformConnecting, setPlatformConnecting] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const getNote = connections.find((item) => item.provider === "getnote");
  const feishuConnection = connections.find((item) => item.provider === "feishu");
  const wecomConnection = connections.find((item) => item.provider === "wecom");
  const activeSubject = subjects.find((item) => item.id === subjectId);
  const needsReconnect = Boolean(getNote && getNote.status !== "active");
  const isSyncing = (connectionId?: string) => Boolean(connectionId && syncingConnectionIds.includes(connectionId));
  const visibleDocuments = documents.filter((item) => !subjectId || item.subjects.some((subject) => subject.id === subjectId));

  useEffect(() => { void load(); }, []);

  async function load(nextSubjectId?: string) {
    setLoading(true);
    try {
      const [subjectData, connectionData] = await Promise.all([
        fetch(apiPath("/knowledge-base/subjects"), { headers: authHeaders() }).then((response) => readJson<{ subjects: Subject[] }>(response)),
        fetch(apiPath("/knowledge-base/connections"), { headers: authHeaders() }).then((response) => readJson<{ connections: Connection[] }>(response))
      ]);
      const nextSubjects = normalizeSubjects(subjectData.subjects);
      const nextConnections = normalizeConnections(connectionData.connections);
      const nextId = nextSubjectId && nextSubjects.some((item) => item.id === nextSubjectId)
        ? nextSubjectId : subjectId && nextSubjects.some((item) => item.id === subjectId)
          ? subjectId : nextSubjects.find((item) => item.isDefault)?.id ?? nextSubjects[0]?.id ?? "";
      const documentQuery = new URLSearchParams({ page: "1", limit: "50" });
      if (nextId) documentQuery.set("subjectId", nextId);
      const documentData = await fetch(apiPath(`/knowledge-base/documents?${documentQuery.toString()}`), { headers: authHeaders() }).then((response) => readJson<{ documents: Document[]; pagination: DocumentPagination }>(response));
      setSubjects(nextSubjects); setSubjectId(nextId); setDocuments(normalizeDocuments(documentData.documents)); setDocumentPagination(documentData.pagination); setConnections(nextConnections);
      if (nextId) {
        const packData = await fetch(apiPath(`/knowledge-base/industry-packs?subjectId=${encodeURIComponent(nextId)}`), { headers: authHeaders() }).then((response) => readJson<{ platformPacks: IndustryPack[] }>(response));
        setIndustryPacks(normalizeIndustryPacks(packData.platformPacks));
      } else setIndustryPacks([]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "读取知识库失败"); }
    finally { setLoading(false); }
  }

  async function loadMoreDocuments() {
    if (loadingMore || !documentPagination.hasMore) return;
    setLoadingMore(true);
    try {
      const query = new URLSearchParams({ page: String(documentPagination.page + 1), limit: String(documentPagination.limit) });
      if (subjectId) query.set("subjectId", subjectId);
      const data = await fetch(apiPath(`/knowledge-base/documents?${query.toString()}`), { headers: authHeaders() }).then((response) => readJson<{ documents: Document[]; pagination: DocumentPagination }>(response));
      setDocuments((current) => [...current, ...normalizeDocuments(data.documents).filter((item) => !current.some((existing) => existing.id === item.id))]);
      setDocumentPagination(data.pagination);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "加载更多资料失败"); }
    finally { setLoadingMore(false); }
  }

  async function upload(files: FileList | null) {
    const selected = Array.from(files ?? []).slice(0, 100); if (!selected.length) return;
    setUploading(true); setError("");
    try {
      for (const file of selected) { const form = new FormData(); form.append("file", file); if (subjectId) form.append("subjectId", subjectId); await fetch(apiPath("/knowledge-base/documents/upload"), { method: "POST", headers: authHeaders(), body: form }).then(readJson); }
      setNotice(`已导入 ${selected.length} 份企业资料。`); await load(subjectId);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "文件导入失败"); }
    finally { setUploading(false); }
  }

  async function connect(event: FormEvent) {
    event.preventDefault(); setConnecting(true); setError("");
    try {
      await fetch(apiPath("/knowledge-base/connections/getnote"), { method: "POST", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ apiKey, clientId, label: "得到大脑" }) }).then(readJson);
      setApiKey(""); setClientId(""); setNotice("得到大脑已重新连接，现在可同步已转写的录音文字。"); await load(subjectId);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "重新连接失败"); }
    finally { setConnecting(false); }
  }

  async function sync() {
    if (!getNote || isSyncing(getNote.id)) return; setSyncingConnectionIds((current) => [...current, getNote.id]); setError("");
    try {
      const data = await fetch(apiPath(`/knowledge-base/connections/${getNote.id}/sync`), { method: "POST", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ subjectId: subjectId || undefined }) }).then((response) => readJson<{ sync: { created: number; updated: number; assignedToSubject?: number } }>(response));
      setNotice(`同步完成：新增 ${data.sync.created} 条，更新 ${data.sync.updated} 条，归入当前主体 ${data.sync.assignedToSubject ?? 0} 条。`); await load(subjectId);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "同步失败"); }
    finally { setSyncingConnectionIds((current) => current.filter((id) => id !== getNote.id)); }
  }

  async function syncPlatform(connection: Connection) {
    if (isSyncing(connection.id)) return;
    setSyncingConnectionIds((current) => [...current, connection.id]); setError("");
    try {
      const data = await fetch(apiPath(`/knowledge-base/connections/${connection.id}/sync`), { method: "POST", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ subjectId: subjectId || undefined }) }).then((response) => readJson<{ sync: { created: number; updated: number; scanned: number; assignedToSubject?: number } }>(response));
      const providerName = connection.provider === "feishu" ? "飞书" : "企业微信";
      setNotice(`${providerName}同步完成：扫描 ${data.sync.scanned} 项，新增 ${data.sync.created} 条，更新 ${data.sync.updated} 条，归入当前主体 ${data.sync.assignedToSubject ?? 0} 条。`);
      await load(subjectId);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "平台同步失败"); }
    finally { setSyncingConnectionIds((current) => current.filter((id) => id !== connection.id)); }
  }

  async function connectPlatform(event: FormEvent) {
    event.preventDefault();
    setPlatformConnecting(true); setError("");
    try {
      const body = platformProvider === "feishu"
        ? { provider: "feishu", label: "飞书企业资料", appId: platformAppId, appSecret: platformSecret, resourceUrl: platformResourceUrl || undefined }
        : { provider: "wecom", label: "企业微信资料", corpId: platformAppId, agentId: platformAgentId || undefined, corpSecret: platformSecret, resourceUrl: platformResourceUrl || undefined };
      const data = await fetch(apiPath("/knowledge-base/connections/platform"), { method: "POST", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(readJson<{ message?: string }>);
      setPlatformSecret("");
      setNotice(data.message ?? "连接已验证并保存。系统只会同步你明确授权的资料范围。");
      await load(subjectId);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "平台连接校验失败"); }
    finally { setPlatformConnecting(false); }
  }

  async function saveManual(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError("");
    try {
      await fetch(apiPath("/knowledge-base/documents/manual"), { method: "POST", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ title: manualTitle, content: manualContent, subjectId: subjectId || undefined, sourceLabel: "企业自定义资料" }) }).then(readJson);
      setManualTitle(""); setManualContent(""); setNotice("已保存为企业知识资料。"); await load(subjectId);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "保存失败"); }
    finally { setSaving(false); }
  }

  async function runIndustryResearch(mode: "base" | "expanded") {
    if (!subjectId || !industryInput.trim() || researchingIndustry) return;
    setResearchingIndustry(true); setError(""); setNotice(""); setIndustryResearch(null);
    try {
      await fetch(apiPath(`/knowledge-base/subjects/${encodeURIComponent(subjectId)}`), {
        method: "PATCH",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ industry: industryInput.trim() })
      }).then(readJson);
      const keywords = Array.from(new Set(industryKeywords.split(/[\n,，;；]/).map((item) => item.trim()).filter((item) => item.length >= 2))).slice(0, 12);
      const data = await fetch(apiPath("/knowledge-base/industry-research"), {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ subjectId, mode, keywords })
      }).then((response) => readJson<{ industry: string } & IndustryResearch>(response));
      setIndustryResearch(data); setNotice(`已保存行业“${data.industry}”：本批入库 ${data.created} 篇，当前累计 ${data.stored}/${data.cap} 篇公开行业资料。`); await load(subjectId);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "行业资料抓取失败"); }
    finally { setResearchingIndustry(false); }
  }

  async function researchIndustry(event: FormEvent) {
    event.preventDefault();
    await runIndustryResearch("base");
  }

  return <div className="enterpriseKnowledgePage">
    <header className="enterpriseKnowledgeTopbar">
      <button className="enterpriseKnowledgeBrand" onClick={() => window.location.href = getAppPath(returnTo)}><span className="tenantBrandLogo" style={{ background: "#1f6a57" }}>思潼</span><strong>品牌获客 · 企业知识库</strong></button>
      <button onClick={() => window.location.href = getAppPath(returnTo)}>← 返回品牌获客工作地图</button>
    </header>
    <main>
      <section className="enterpriseKnowledgeHero"><div><span>ENTERPRISE KNOWLEDGE BASE</span><h1>企业知识库</h1><p>统一沉淀企业文件、IP 本人资料、外部平台资料和行业知识，供品牌获客的定位、选题、内容与直播系统调用。</p></div><div className="enterpriseKnowledgeCounters"><div><b>{loading ? "—" : documentPagination.total}</b><small>当前主体资料</small></div><div><b>{connections.length}</b><small>外部接入</small></div><div><b>{industryPacks.length}</b><small>行业知识包</small></div></div></section>
      <section className="enterpriseKnowledgeSubject"><label>当前资料归属<select value={subjectId} onChange={(event) => void load(event.target.value)}>{subjects.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.typeLabel}</option>)}</select></label><p>{activeSubject?.industry ? `当前行业：${activeSubject.industry}` : "当前主体尚未填写行业，可在资料权限管理中补充。"}<br /><button onClick={() => window.location.href = getAppPath(`/knowledge-base?returnTo=${encodeURIComponent(returnTo)}`)}>管理主体与资料权限</button></p></section>
      {notice && <p className="enterpriseKnowledgeNotice">{notice}</p>}{error && <p className="enterpriseKnowledgeNotice error">{error}</p>}
      <section className="enterpriseKnowledgeSources">
        <header><span>KNOWLEDGE SOURCES</span><h2>三类知识来源</h2><p>资料只保存一份，并按当前企业、IP 或客户项目隔离。</p></header>
        <div>
          <article><span>01</span><h3>企业自己上传的资料</h3><p>包括企业文件、IP 本人经历与表达习惯、产品资料、客户项目和经营案例。</p><input ref={inputRef} className="enterpriseKnowledgeFile" type="file" multiple accept=".txt,.md,.csv,.tsv,.json,.log,text/plain,text/markdown,text/csv,application/json" onChange={(event) => { void upload(event.target.files); event.currentTarget.value = ""; }} /><button disabled={uploading} onClick={() => inputRef.current?.click()}>{uploading ? "导入中…" : "批量上传企业文件"}</button><form onSubmit={saveManual}><input value={manualTitle} onChange={(event) => setManualTitle(event.target.value)} placeholder="或录入 IP / 企业资料标题" required /><textarea rows={3} value={manualContent} onChange={(event) => setManualContent(event.target.value)} placeholder="粘贴已确认的事实、案例、方法或 IP 表达习惯" required /><button disabled={saving}>{saving ? "保存中…" : "保存文字资料"}</button></form></article>
          <article><span>02</span><h3>外部平台接入</h3><p>录音卡、企业微信、飞书等由企业授权后接入，不会默认读取全部内容。</p><button type="button" className="connectionHelpTrigger" onClick={() => window.location.href = getAppPath(`${window.location.pathname.startsWith("/agents/acquisition/") ? "/agents/acquisition/enterprise-knowledge-base" : "/enterprise-knowledge-base"}/connection-help?returnTo=${encodeURIComponent(`${window.location.pathname}${window.location.search}`)}`)}>不知道密钥在哪里？打开接入帮助</button>{getNote && !needsReconnect ? <><p className="connectionReady">得到大脑已连接{getNote.lastSyncedAt ? ` · 上次同步 ${new Date(getNote.lastSyncedAt).toLocaleString("zh-CN")}` : ""}</p><button disabled={isSyncing(getNote.id)} onClick={() => void sync()}>{isSyncing(getNote.id) ? "同步中…" : "同步最新录音"}</button></> : <form onSubmit={connect}><p className="connectionWarning">得到大脑授权失效或尚未连接，请重新填写凭证。</p><a className="connectionConsoleLink" href="https://www.biji.com/openapi" target="_blank" rel="noreferrer">先打开得到大脑开放平台 ↗</a><input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="得到大脑 API Key" required /><input value={clientId} onChange={(event) => setClientId(event.target.value)} placeholder="Client ID" required /><button disabled={connecting}>{connecting ? "连接中…" : "重新连接并同步"}</button></form>}<details className="enterprisePlatformConnect" open><summary>连接飞书或企业微信</summary><p>飞书会一键同步应用已获授权的知识空间；企业微信会一键同步应用可见范围内的通讯录。不会读取聊天存档或微盘。</p><div className="platformConnectionState"><span className={feishuConnection?.status === "active" ? "active" : ""}>飞书：{feishuConnection?.status === "active" ? "已连接" : "未连接"}</span><span className={wecomConnection?.status === "active" ? "active" : ""}>企业微信：{wecomConnection?.status === "active" ? "已连接" : "未连接"}</span></div>{feishuConnection?.status === "active" && <button type="button" disabled={isSyncing(feishuConnection.id)} onClick={() => void syncPlatform(feishuConnection)}>{isSyncing(feishuConnection.id) ? "同步中…" : "一键同步飞书资料"}</button>}{wecomConnection?.status === "active" && <button type="button" disabled={isSyncing(wecomConnection.id)} onClick={() => void syncPlatform(wecomConnection)}>{isSyncing(wecomConnection.id) ? "同步中…" : "一键同步企业微信通讯录"}</button>}<form onSubmit={connectPlatform}><select value={platformProvider} onChange={(event) => { setPlatformProvider(event.target.value as PlatformProvider); setPlatformAppId(""); setPlatformSecret(""); setPlatformAgentId(""); }}><option value="feishu">飞书企业自建应用</option><option value="wecom">企业微信自建应用</option></select><a className="connectionConsoleLink" href={platformProvider === "feishu" ? "https://open.feishu.cn/app" : "https://work.weixin.qq.com/wework_admin/frame#apps"} target="_blank" rel="noreferrer">{platformProvider === "feishu" ? "打开飞书开发者后台" : "打开企业微信管理后台"} ↗</a><input value={platformAppId} onChange={(event) => setPlatformAppId(event.target.value)} placeholder={platformProvider === "feishu" ? "飞书 App ID（cli_ 开头）" : "企业微信 Corp ID"} required /><input type="password" value={platformSecret} onChange={(event) => setPlatformSecret(event.target.value)} placeholder={platformProvider === "feishu" ? "飞书 App Secret" : "企业微信应用 Secret"} required />{platformProvider === "wecom" && <input value={platformAgentId} onChange={(event) => setPlatformAgentId(event.target.value)} placeholder="企业微信 AgentId（可选）" />}<input value={platformResourceUrl} onChange={(event) => setPlatformResourceUrl(event.target.value)} placeholder={platformProvider === "feishu" ? "可选：只同步某份飞书文档或知识库链接" : "企业微信资料范围说明（可选）"} /><button disabled={platformConnecting}>{platformConnecting ? "正在校验…" : `校验并连接${platformProvider === "feishu" ? "飞书" : "企业微信"}`}</button></form><small>飞书：默认一键同步应用已授权的知识空间；如填链接则仅同步该资料。企业微信：一键同步当前应用已授权的通讯录；微盘和会话存档需单独开通。</small></details></article>
          <article className="industry"><span>03</span><h3>AI 抓取的行业知识</h3><p>平台审核的行业垂类基础包，与企业自己的事实分层保存。</p><div className="industryPackList">{industryPacks.length ? industryPacks.map((item) => <div key={item.id}><strong>{item.name}</strong><small>审核基础包 · v{item.version}</small><p>{item.description}</p></div>) : <p>请先为当前主体填写所属行业，系统才会匹配行业知识包。</p>}</div><button type="button" onClick={() => { setIndustryInput(activeSubject?.industry ?? ""); setIndustryKeywords(""); setIndustryResearch(null); setIndustryDialogOpen(true); }}>补充行业并开始抓取</button></article>
        </div>
      </section>
      {industryDialogOpen && <div className="industryResearchDialog" role="dialog" aria-modal="true" aria-labelledby="industry-research-title"><form onSubmit={researchIndustry}><header><div><span>INDUSTRY RESEARCH</span><h2 id="industry-research-title">请填写所属行业</h2><p>首轮最多入库 200 篇国内白名单公开资料；分批抓取并保留来源、链接和时间，不会自动写成企业事实。</p></div><button type="button" className="close" onClick={() => setIndustryDialogOpen(false)} aria-label="关闭">×</button></header><label>所属行业 / 品类<input autoFocus value={industryInput} onChange={(event) => setIndustryInput(event.target.value)} placeholder="例如：连锁餐饮、医美、美业、企业 AI 服务" required maxLength={100} /></label><label>补充检索关键词（可选）<textarea rows={2} value={industryKeywords} onChange={(event) => setIndustryKeywords(event.target.value)} placeholder="例如：企业级 AI、RAG、智能体应用；用逗号或换行分隔" maxLength={960} /></label><small>系统会用关键词扩展检索，但只会入库国内白名单、可追溯且正文质量合格的公开资料。</small><button className="research" disabled={researchingIndustry}>{researchingIndustry ? "AI 正在抓取并入库…" : "保存行业并抓取基础资料"}</button><button type="button" className="research secondary" disabled={researchingIndustry} onClick={() => void runIndustryResearch("expanded")}>{researchingIndustry ? "AI 正在扩展抓取…" : "继续扩展抓取"}</button>{industryResearch && <section className="industryResearchResults"><p>本批新增 {industryResearch.created} 篇、更新 {industryResearch.updated} 篇；当前累计 {industryResearch.stored}/{industryResearch.cap} 篇。已发现 {industryResearch.discovered} 个可追溯候选来源。</p>{industryResearch.hasMore ? <p>仍有可抓取资料；可继续点击“继续扩展抓取”。</p> : <p>{industryResearch.message ?? "本轮候选已抓取完成；可补充关键词或点击“继续扩展抓取”扩大检索范围。"}</p>}</section>}</form></div>}
      <section className="enterpriseKnowledgeMaterials"><aside><h3>当前主体的知识资产</h3><p>{loading ? "正在读取资料…" : <>已沉淀 {documentPagination.total} 条资料。当前展示 {visibleDocuments.length} / 共 {documentPagination.total} 条。智能体只调用已确认、可追溯且属于当前主体的内容。</>}</p></aside><section>{visibleDocuments.length ? <>{visibleDocuments.map((item) => <article key={item.id}><strong>{item.title}</strong><p>{item.preview}</p><small>{item.sourceClass} · {item.characterCount.toLocaleString()} 字{item.subjects.length ? ` · ${item.subjects.map((subject) => subject.name).join("、")}` : ""}</small></article>)}<div className="enterpriseKnowledgeLoadMore"><p>当前展示 {visibleDocuments.length} / 共 {documentPagination.total} 条</p>{documentPagination.hasMore && <button type="button" disabled={loadingMore} onClick={() => void loadMoreDocuments()}>{loadingMore ? "加载中…" : "加载更多资料"}</button>}</div></> : <p className="empty">还没有资料。请从上方上传企业资料、连接录音卡，或填写当前行业。</p>}</section></section>
    </main>
  </div>;
}

import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { apiPath, getAppPath } from "../../lib/api.js";

interface Subject {
  id: string;
  name: string;
  typeLabel: string;
  industry?: string;
  autoDocumentCount: number;
  documentCount: number;
}

interface Document {
  id: string;
  title: string;
  preview: string;
  characterCount: number;
  occurredAt?: string;
}

interface Agent {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon?: string;
}

interface Batch {
  id: string;
  title: string;
  status: string;
  documentIds?: string[];
  agentIds?: string[];
  analyses: Array<{ agentId: string; agentName: string; status: string; output?: string; errorMessage?: string }>;
  synthesis?: { status: string; content?: string; errorMessage?: string } | null;
}

function headers(): Record<string, string> {
  const token = localStorage.getItem("store_os_token");
  const profile = localStorage.getItem("store_os_tenant_profile");
  return { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(profile ? { "x-sitong-profile": encodeURIComponent(profile) } : {}) };
}

async function readJson<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message ?? payload.error ?? "请求失败");
  return payload as T;
}

function displayName(agent: Agent): string {
  if (agent.slug === "acquisition") return "获客智能体";
  if (agent.slug === "sales") return "销售智能体";
  return agent.name.replace(/agent/gi, "智能体").replace(/智能体智能体/g, "智能体");
}

/** CEO 驾驶舱内的经营会诊入口；资料本身仍只在企业知识库管理。 */
export function CeoKnowledgeAnalysisPanel() {
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [subjectId, setSubjectId] = useState("");
  const [documents, setDocuments] = useState<Document[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedDocuments, setSelectedDocuments] = useState<string[]>([]);
  const [selectedAgents, setSelectedAgents] = useState<string[]>([]);
  const [identityContext, setIdentityContext] = useState("");
  const [businessGoal, setBusinessGoal] = useState("");
  const [factCorrections, setFactCorrections] = useState("");
  const [instruction, setInstruction] = useState("");
  const [activeBatch, setActiveBatch] = useState<Batch | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  const subject = subjects.find((item) => item.id === subjectId);
  const ready = (selectedDocuments.length > 0 || (subject?.autoDocumentCount ?? 0) > 0) && selectedAgents.length > 0 && !running;
  const allDocumentsSelected = documents.length > 0 && selectedDocuments.length === documents.length;
  const allAgentsSelected = agents.length > 0 && selectedAgents.length === agents.length;

  async function loadDocuments(nextSubjectId: string): Promise<void> {
    const query = new URLSearchParams({ page: "1", limit: "100" });
    if (nextSubjectId) query.set("subjectId", nextSubjectId);
    const payload = await fetch(apiPath(`/knowledge-base/documents?${query.toString()}`), { headers: headers() }).then((response) => readJson<{ documents: Document[] }>(response));
    setDocuments(payload.documents);
    setSelectedDocuments([]);
  }

  async function load(): Promise<void> {
    setLoading(true);
    setError("");
    try {
      const [subjectPayload, agentPayload, historyPayload] = await Promise.all([
        fetch(apiPath("/knowledge-base/subjects"), { headers: headers() }).then((response) => readJson<{ subjects: Subject[] }>(response)),
        fetch(apiPath("/knowledge-base/agents"), { headers: headers() }).then((response) => readJson<{ agents: Agent[] }>(response)),
        fetch(apiPath("/knowledge-base/analyses"), { headers: headers() }).then((response) => readJson<{ batches: Batch[] }>(response))
      ]);
      setSubjects(subjectPayload.subjects);
      setAgents(agentPayload.agents);
      const nextSubjectId = subjectId || subjectPayload.subjects.find((item) => item.documentCount > 0)?.id || subjectPayload.subjects[0]?.id || "";
      setSubjectId(nextSubjectId);
      setActiveBatch(historyPayload.batches[0] ?? null);
      await loadDocuments(nextSubjectId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "驾驶舱会诊资料加载失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function changeSubject(nextSubjectId: string): Promise<void> {
    setSubjectId(nextSubjectId);
    setError("");
    try { await loadDocuments(nextSubjectId); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "当前主体资料加载失败"); }
  }

  async function run(): Promise<void> {
    if (!ready) return;
    setRunning(true);
    setError("");
    try {
      const payload = await fetch(apiPath("/knowledge-base/analyses"), {
        method: "POST",
        headers: { ...headers(), "Content-Type": "application/json" },
        body: JSON.stringify({ documentIds: selectedDocuments, subjectId: subjectId || undefined, agentIds: selectedAgents, instruction: instruction || undefined, identityContext: identityContext || undefined, businessGoal: businessGoal || undefined, factCorrections: factCorrections || undefined })
      }).then((response) => readJson<{ batch: Batch }>(response));
      setActiveBatch(payload.batch);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "经营会诊失败");
    } finally {
      setRunning(false);
    }
  }

  return <section className="ceoKnowledgeAnalysis" aria-label="CEO经营资料会诊">
    <header><div><span>CEO ANALYSIS</span><h2>经营资料会诊</h2><p>在驾驶舱决定由哪些智能体分析什么；资料接入、归类、编辑与权限仍在企业知识库。</p></div><button type="button" onClick={() => window.location.href = getAppPath("/enterprise-knowledge-base")}>管理企业知识库</button></header>
    {loading ? <p className="ceoKnowledgeEmpty">正在载入可用经营资料…</p> : <>
      <div className="ceoKnowledgeControls">
        <label>分析主体<select value={subjectId} onChange={(event) => void changeSubject(event.target.value)}>{subjects.map((item) => <option value={item.id} key={item.id}>{item.typeLabel} · {item.name}{item.industry ? ` · ${item.industry}` : ""}</option>)}</select></label>
        <p><b>{subject?.documentCount ?? 0}</b> 条沉淀资料，其中 <b>{subject?.autoDocumentCount ?? 0}</b> 条已确认可自动调用。</p>
      </div>
      <section className="ceoKnowledgeStep"><header><span>01</span><div><strong>选择本次需要重点看的资料</strong><small>未选择时，系统仍会按主体使用已确认的资料。</small></div><button type="button" onClick={() => setSelectedDocuments(allDocumentsSelected ? [] : documents.map((item) => item.id))}>{allDocumentsSelected ? "取消全选" : "全选当前资料"}</button></header>
        <div className="ceoKnowledgeDocumentList">{documents.length ? documents.map((item) => <label key={item.id}><input type="checkbox" checked={selectedDocuments.includes(item.id)} onChange={(event) => setSelectedDocuments(event.target.checked ? [...selectedDocuments, item.id] : selectedDocuments.filter((id) => id !== item.id))} /><div><strong>{item.title}</strong><small>{item.occurredAt ? new Date(item.occurredAt).toLocaleDateString("zh-CN") : "日期未知"} · {item.characterCount.toLocaleString()} 字</small><p>{item.preview}</p></div></label>) : <p className="ceoKnowledgeEmpty">这个主体还没有资料。请先到企业知识库接入或归类。</p>}</div>
      </section>
      <section className="ceoKnowledgeStep"><header><span>02</span><div><strong>选择会诊智能体</strong><small>每个智能体独立分析，再生成可追溯的联合结论。</small></div><button type="button" onClick={() => setSelectedAgents(allAgentsSelected ? [] : agents.map((item) => item.id))}>{allAgentsSelected ? "取消全选" : "全选智能体"}</button></header>
        <div className="ceoKnowledgeAgents">{agents.map((item) => <label key={item.id} className={selectedAgents.includes(item.id) ? "selected" : ""}><input type="checkbox" checked={selectedAgents.includes(item.id)} onChange={(event) => setSelectedAgents(event.target.checked ? [...selectedAgents, item.id] : selectedAgents.filter((id) => id !== item.id))} /><b>{item.icon ?? "智"}</b><div><strong>{displayName(item)}</strong><small>{item.description}</small></div></label>)}</div>
      </section>
      <section className="ceoKnowledgeBrief"><label>身份与专业定位<textarea value={identityContext} onChange={(event) => setIdentityContext(event.target.value)} rows={2} placeholder="例如：连锁餐饮品牌主理人，重点关注加盟与到店增长。" /></label><label>本次经营目标<textarea value={businessGoal} onChange={(event) => setBusinessGoal(event.target.value)} rows={2} placeholder="例如：明确下周优先解决的增长瓶颈。" /></label><label>已确认的事实纠正<textarea value={factCorrections} onChange={(event) => setFactCorrections(event.target.value)} rows={2} placeholder="会覆盖资料中的自动摘要与模型推测。" /></label><label>本次特别要求（可选）<textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} rows={2} placeholder="例如：优先复盘最近一周录音中的成交阻塞。" /></label></section>
      <button className="ceoKnowledgeRun" type="button" disabled={!ready} onClick={() => void run()}>{running ? "正在会诊…" : selectedAgents.length > 1 ? `让 ${selectedAgents.length} 个智能体联合会诊` : "开始经营会诊"}</button>
    </>}
    {error && <p className="ceoKnowledgeError">{error}</p>}
    {activeBatch && <article className="ceoKnowledgeReport"><header><div><span>ANALYSIS REPORT</span><h3>{activeBatch.title}</h3></div><em>{activeBatch.status === "completed" ? "已完成" : activeBatch.status === "partial" ? "部分完成" : activeBatch.status}</em></header>{activeBatch.synthesis?.content ? <div className="ceoKnowledgeMarkdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{activeBatch.synthesis.content}</ReactMarkdown></div> : <p className="ceoKnowledgeEmpty">{activeBatch.synthesis?.errorMessage ?? "暂无汇总报告"}</p>}<details><summary>查看 {activeBatch.analyses.length} 份独立分析</summary>{activeBatch.analyses.map((item) => <section key={item.agentId}><h4>{item.agentName} <small>{item.status === "success" ? "分析完成" : item.errorMessage}</small></h4>{item.output && <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.output}</ReactMarkdown>}</section>)}</details></article>}
  </section>;
}

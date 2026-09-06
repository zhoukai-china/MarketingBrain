import { useEffect, useMemo, useRef, useState } from "react";
import { apiPath, getAppPath } from "../lib/api.js";

type ConversationSummary = { id: string; title: string | null; updatedAt: string; _count: { messages: number } };
type QaMessage = { id: string; role: string; content: string; createdAt: string };

function authHeaders(): HeadersInit {
  const token = localStorage.getItem("store_os_token");
  return token ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
}

async function readJson(response: Response) {
  const body = await response.json().catch(() => ({}));
  if (response.status === 401) {
    localStorage.setItem("store_os_post_login_redirect", `${window.location.pathname}${window.location.search}`);
    localStorage.removeItem("store_os_token");
    window.location.replace(getAppPath("/login/lanqi"));
    throw new Error("登录状态已失效，正在返回登录页。");
  }
  if (!response.ok) throw new Error(body.message ?? "服务暂时不可用，请稍后重试。");
  return body;
}

export function LanqiBusinessQaPage() {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | undefined>();
  const [messages, setMessages] = useState<QaMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [mode, setMode] = useState<"controlled_mock" | "real" | undefined>();
  const controllerRef = useRef<AbortController | null>(null);
  const requestKeyRef = useRef<string | null>(null);
  const canSubmit = question.trim().length >= 2 && !busy;
  const title = useMemo(() => conversations.find(item => item.id === activeId)?.title ?? "新的经营问题", [conversations, activeId]);

  useEffect(() => {
    if (!localStorage.getItem("store_os_token")) {
      localStorage.setItem("store_os_post_login_redirect", `${window.location.pathname}${window.location.search}`);
      window.location.replace(getAppPath("/login/lanqi"));
      return;
    }
    void loadHistory();
    return () => controllerRef.current?.abort();
  }, []);

  async function loadHistory(preferredId?: string) {
    setLoading(true); setNotice("");
    try {
      const body = await readJson(await fetch(apiPath("/lanqi/business-qa/conversations"), { headers: authHeaders() }));
      setMode(body.mode);
      const items = (body.conversations ?? []) as ConversationSummary[];
      setConversations(items);
      const nextId = preferredId ?? activeId ?? items[0]?.id;
      if (nextId) await openConversation(nextId, false, true);
      else { setActiveId(undefined); setMessages([]); }
    } catch (error) { setNotice(error instanceof Error ? error.message : "历史记录加载失败。"); }
    finally { setLoading(false); }
  }

  async function openConversation(id: string, resetNotice = true, allowWhileBusy = false) {
    if (busy && !allowWhileBusy) return;
    if (resetNotice) setNotice("");
    try {
      const body = await readJson(await fetch(apiPath(`/lanqi/business-qa/conversations/${encodeURIComponent(id)}`), { headers: authHeaders() }));
      setMode(body.mode);
      setActiveId(id);
      setMessages(((body.conversation?.messages ?? []) as QaMessage[]).filter(item => item.role === "user" || item.role === "assistant"));
    } catch (error) { setNotice(error instanceof Error ? error.message : "这条记录暂时无法打开。"); }
  }

  function startNew() {
    if (busy) return;
    setActiveId(undefined); setMessages([]); setQuestion(""); setNotice(""); requestKeyRef.current = null;
  }

  async function submit() {
    const normalized = question.trim();
    if (normalized.length < 2 || busy) return;
    const requestKey = requestKeyRef.current ?? `lanqi-qa-${crypto.randomUUID()}`;
    requestKeyRef.current = requestKey;
    const controller = new AbortController();
    controllerRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 48_000);
    setBusy(true); setNotice("");
    try {
      const body = await readJson(await fetch(apiPath("/lanqi/business-qa/ask"), {
        method: "POST",
        headers: authHeaders(),
        signal: controller.signal,
        body: JSON.stringify({ question: normalized, conversationId: activeId, requestKey, deviceScope: window.innerWidth <= 640 ? "mobile" : "desktop" })
      }));
      setMode(body.mode);
      setQuestion(""); requestKeyRef.current = null;
      await loadHistory(body.conversationId);
    } catch (error) {
      if ((error as { name?: string }).name === "AbortError") setNotice("本次回答已停止，问题仍保留在输入框中，可以稍后重试。");
      else setNotice(error instanceof Error ? error.message : "本次没有生成有效回答，请稍后重试。");
    } finally {
      window.clearTimeout(timeout); controllerRef.current = null; setBusy(false);
    }
  }

  return <div className="lanqiQaPage">
    <header className="lanqiQaHeader">
      <button className="lanqiQaBrand" onClick={() => window.location.href = getAppPath("/my-ai")}>兰琪美业 <span>经营增长系统</span></button>
      <nav><button onClick={() => window.location.href = getAppPath("/lanqi/store-profile")}>经营档案</button><button onClick={() => window.location.href = getAppPath("/lanqi/diagnosis")}>经营诊断</button></nav>
    </header>
    <main className="lanqiQaLayout">
      <aside className="lanqiQaHistory" aria-label="问答历史">
        <div><p>问答历史</p><button onClick={startNew} disabled={busy}>＋ 新问题</button></div>
        {loading && conversations.length === 0 ? <span className="lanqiQaMuted">正在加载…</span> : conversations.length === 0 ? <span className="lanqiQaMuted">还没有问答记录</span> : conversations.map(item => <button key={item.id} className={item.id === activeId ? "active" : ""} onClick={() => void openConversation(item.id)}><strong>{item.title || "经营问题"}</strong><small>{new Date(item.updatedAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</small></button>)}
      </aside>
      <section className="lanqiQaWorkbench">
        <div className="lanqiQaIntro"><div><p>LANQI · BUSINESS ADVISOR</p><h1>美业经营问答</h1><span>围绕获客、销售、复购、团队与门店经营，先给今天能执行的一步。</span></div>{mode === "controlled_mock" && <em>流程预览 · 不代表正式智能回答质量</em>}</div>
        <div className="lanqiQaThread" aria-live="polite">
          {messages.length === 0 ? <div className="lanqiQaEmpty"><h2>今天经营上哪里卡住了？</h2><p>可以直接描述现象。经营档案会作为已确认背景；资料不足时只提示最关键的待补项，不会编造数字或案例。</p><div>{["最近咨询不少，但预约少，先查哪里？", "老顾客复购下降，今天先做什么？", "员工回复顾客太生硬，怎么调整？"].map(item => <button key={item} onClick={() => setQuestion(item)}>{item}</button>)}</div></div> : <><h2>{title}</h2>{messages.map(item => <article key={item.id} className={`lanqiQaMessage ${item.role}`}><span>{item.role === "user" ? "你" : "经营顾问"}</span>{item.role === "assistant" ? <Answer content={item.content} /> : <p>{item.content}</p>}</article>)}</>}
          {busy && <div className="lanqiQaThinking"><span />正在根据本门店已确认资料整理回答…</div>}
        </div>
        {notice && <div className="lanqiQaNotice" role="alert">{notice}<button onClick={() => setNotice("")}>关闭</button></div>}
        <div className="lanqiQaComposer"><label htmlFor="lanqi-qa-input">{activeId ? "继续追问" : "提出经营问题"}</label><textarea id="lanqi-qa-input" value={question} onChange={event => { setQuestion(event.target.value); requestKeyRef.current = null; }} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") void submit(); }} maxLength={1200} placeholder="例如：最近咨询不少，但预约到店少，我今天应该先检查哪一步？" disabled={busy} /><div><small>{question.trim().length < 2 ? "请至少写 2 个字；没有其他强制字段" : `${question.length}/1200 · Ctrl/⌘ + Enter 发送`}</small>{busy ? <button className="secondary" onClick={() => controllerRef.current?.abort()}>停止回答</button> : <button onClick={() => void submit()} disabled={!canSubmit}>发送问题</button>}</div></div>
      </section>
    </main>
  </div>;
}

function Answer({ content }: { content: string }) {
  return <div className="lanqiQaAnswer">{content.split(/\r?\n/).filter(Boolean).map((line, index) => {
    if (/^#{1,3}\s/.test(line)) return <h3 key={index}>{line.replace(/^#{1,3}\s*/, "")}</h3>;
    if (/^\d+[.、]\s*/.test(line)) return <p className="step" key={index}>{line}</p>;
    if (/^-\s*/.test(line)) return <p className="bullet" key={index}>{line.replace(/^-\s*/, "")}</p>;
    return <p key={index}>{line}</p>;
  })}</div>;
}

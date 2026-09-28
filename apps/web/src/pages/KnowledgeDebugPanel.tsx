// 【临时调试】把「得到大脑成品 → 结构化条目 → 去重 → 入库 → 按需取用」拆成五步按钮，
// 每步的结论直接堆在下面，方便逐步验证效果。调试确认后再并入正式流程。
import { useState, type CSSProperties, type ReactNode } from "react";
import { apiPath } from "../lib/api.js";

type StepKey = "pull" | "parse" | "cluster" | "persist" | "pick";
type StepState = { running: boolean; error?: string; data?: Record<string, unknown>; at?: string };

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("store_os_token");
  const profile = localStorage.getItem("store_os_tenant_profile");
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(profile ? { "x-sitong-profile": encodeURIComponent(profile) } : {})
  };
}

async function postJson(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fetch(apiPath(path), {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw new Error(String(payload.message ?? payload.error ?? `HTTP ${response.status}`));
  return payload;
}

function num(value: unknown): number {
  return typeof value === "number" ? value : Number(value ?? 0) || 0;
}
function str(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}
function arr(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];
}

// 整块面板自成一格：固定浅底深字，不依赖页面主题，避免任何主题下都发灰看不清。
const panel: CSSProperties = { margin: "28px 0", padding: 18, border: "1px solid #bbb", borderRadius: 14, background: "#ffffff", color: "#111111" };
const row: CSSProperties = { display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 14 };
const button: CSSProperties = { padding: "8px 14px", cursor: "pointer", fontSize: 13 };
const card: CSSProperties = { border: "1px solid #dcdcdc", borderRadius: 10, padding: 14, marginBottom: 14, background: "#f6f6f6", color: "#111111" };
const headline: CSSProperties = { fontWeight: 600, fontSize: 14, marginBottom: 8, lineHeight: 1.7, color: "#000000" };
const muted: CSSProperties = { fontSize: 13, lineHeight: 1.75, color: "#333333" };
const quoteBox: CSSProperties = { padding: "10px 12px", marginTop: 10, borderRadius: 8, background: "#ecebeb", color: "#1a1a1a", fontSize: 13, lineHeight: 1.75 };

function JsonBlock({ data }: { data: Record<string, unknown> }) {
  return (
    <details>
      <summary style={muted}>原始返回 JSON</summary>
      <pre style={{ maxHeight: 400, overflow: "auto", fontSize: 13, lineHeight: 1.7, marginTop: 8, padding: 12, borderRadius: 8, border: "1px solid #cccccc", background: "#f2f2f2", color: "#111111", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{JSON.stringify(data, null, 2)}</pre>
    </details>
  );
}

function Highlight({ children }: { children: ReactNode }) {
  return (
    <p style={{ ...headline, fontSize: 15, color: "#0b5f2a", borderLeft: "3px solid #0b5f2a", paddingLeft: 12, marginBottom: 12 }}>
      结论：{children}
    </p>
  );
}

export function KnowledgeDebugPanel({ connectionId }: { connectionId: string }) {
  const [limit, setLimit] = useState(20);
  const [query, setQuery] = useState("直播获客");
  const [dryRun, setDryRun] = useState(true);
  const [results, setResults] = useState<Partial<Record<StepKey, StepState>>>({});

  async function run(step: StepKey, body: Record<string, unknown>): Promise<void> {
    setResults((prev) => ({ ...prev, [step]: { running: true } }));
    try {
      const data = await postJson(`/knowledge-base/debug/${step}`, { connectionId, ...body });
      setResults((prev) => ({ ...prev, [step]: { running: false, data, at: new Date().toLocaleTimeString("zh-CN") } }));
    } catch (error) {
      setResults((prev) => ({ ...prev, [step]: { running: false, error: error instanceof Error ? error.message : "失败" } }));
    }
  }

  function cardFor(step: StepKey): ReactNode {
    const state = results[step];
    if (!state) return null;
    if (state.running) return <div style={card}><p style={headline}>执行中…</p></div>;
    if (state.error) return <div style={card}><p style={{ ...headline, color: "crimson" }}>失败：{state.error}</p></div>;
    const data = state.data ?? {};

    if (step === "pull") {
      return (
        <div style={card}>
          <Highlight>
            扫到 {num(data.scanned)} 个候选，成功拉取 {num(data.pulled)} 条（有效 {num(data.valid)} 篇、空录音 {num(data.skippedEmpty)} 篇已排除），失败 {num(data.failed)} 条。
            成品总结 {num(data.noteSummaryChars).toLocaleString()} 字，对应原始逐字稿 {num(data.noteTranscriptChars).toLocaleString()} 字（相差 {(num(data.noteTranscriptChars) / Math.max(num(data.noteSummaryChars), 1)).toFixed(1)} 倍）。
          </Highlight>
          {arr(data.failures).length > 0 && <p style={muted}>失败样例：{arr(data.failures).map(String).join(" | ")}</p>}
          {arr(data.samples).map((item, index) => (
            <div key={index} style={quoteBox}>
              <strong>{str(item.title)}</strong>
              <span style={muted}> · 总结 {num(item.summaryChars)} 字 / 逐字稿 {num(item.transcriptChars)} 字</span>
              <p style={muted}>{str(item.preview)}</p>
            </div>
          ))}
          <JsonBlock data={data} />
        </div>
      );
    }

    if (step === "parse") {
      return (
        <div style={card}>
          <Highlight>
            解析 {num(data.parsedCount)} 篇（跳过空录音 {num(data.skippedEmpty)} 篇）→ 金句 {num(data.quoteCount)} 条、核心观点 {num(data.viewCount)} 条、章节 {num(data.chapterCount)} 个。
            <strong> LLM 调用 {num(data.llmCalls)} 次。</strong>
          </Highlight>
          {arr(data.samples).map((item, index) => (
            <div key={index} style={quoteBox}>
              <strong>{str(item.title)}</strong>
              <p style={muted}>概述：{str(item.overview)}</p>
              <p style={muted}>金句：{arr(item.quotes).map((quote) => `${str(quote.text)}${quote.tag ? `（${str(quote.tag)}）` : ""}`).join(" / ")}</p>
              <p style={muted}>观点：{arr(item.coreViews).map((view) => (view.topic ? `[${str(view.topic)}] ${str(view.text)}` : str(view.text))).slice(0, 3).join(" / ")}</p>
            </div>
          ))}
          <JsonBlock data={data} />
        </div>
      );
    }

    if (step === "cluster") {
      return (
        <div style={card}>
          <Highlight>
            去重前 {num(data.beforeCount)} 条 → 归并为 {num(data.clusterCount)} 个主题簇，保留 {num(data.afterCount)} 条代表性内容（同系列课程重复度很高）。
          </Highlight>
          {arr(data.clusters).map((item, index) => (
            <div key={index} style={quoteBox}>
              <strong>{index + 1}. {str(item.label)}</strong>
              <span style={muted}> · {num(item.size)} 条</span>
              {arr(item.mergedLabels).length > 0 && <p style={muted}>合并自：{arr(item.mergedLabels).map(String).join("、")}</p>}
              <p style={muted}>观点：{arr(item.views).map(String).join(" / ")}</p>
              {arr(item.quotes).length > 0 && <p style={muted}>金句：{arr(item.quotes).map(String).join(" / ")}</p>}
              <p style={muted}>来源：{arr(item.sources).map(String).join("、")}</p>
            </div>
          ))}
          <JsonBlock data={data} />
        </div>
      );
    }

    if (step === "persist") {
      return (
        <div style={card}>
          <Highlight>
            {dryRun ? "试运行（未写库）：" : "已写库："}新增 {num(data.created)} 条、更新 {num(data.updated)} 条。LLM 调用 {num(data.llmCalls)} 次。
          </Highlight>
          <p style={muted}>{str(data.note)}</p>
          {arr(data.rows).map((item, index) => (
            <div key={index} style={{ marginTop: 6 }}>
              <strong>{str(item.title)}</strong>
              <span style={muted}> · {str(item.action)} · 金句 {num(item.quotes)} / 观点 {num(item.views)}</span>
            </div>
          ))}
          <JsonBlock data={data} />
        </div>
      );
    }

    return (
      <div style={card}>
        <Highlight>
          话题「{str(data.query)}」命中 topic {num(data.limit)} 上限、实际取出 {num(data.count)} 条，这就是真正喂给选题模型的内容。LLM 调用 {num(data.llmCalls)} 次。
        </Highlight>
        <pre style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>{str(data.text)}</pre>
        <JsonBlock data={data} />
      </div>
    );
  }

  const busy = (step: StepKey): boolean => Boolean(results[step]?.running);

  return (
    <section style={panel} data-testid="knowledge-debug-panel">
      <h3>【调试】得到大脑成品入库五步</h3>
      <p style={muted}>逐步点，逐步看结论。前四步不花任何 LLM 费用。条数建议填 5 以上——列表按创建时间倒序，最新几条常是 0 秒空录音，已被自动排除。</p>
      <div style={row}>
        <button type="button" style={button} disabled={busy("pull")} onClick={() => void run("pull", { limit, windowDays: 30 })}>
          {busy("pull") ? "① 拉取中…" : "① 拉取详情"}
        </button>
        <label style={muted}>条数 <input type="number" value={limit} min={1} max={100} onChange={(event) => setLimit(Number(event.target.value) || 20)} style={{ width: 70 }} /></label>
        <button type="button" style={button} disabled={busy("parse")} onClick={() => void run("parse", {})}>
          {busy("parse") ? "② 解析中…" : "② 解析成品"}
        </button>
        <button type="button" style={button} disabled={busy("cluster")} onClick={() => void run("cluster", {})}>
          {busy("cluster") ? "③ 聚类中…" : "③ 去重聚类"}
        </button>
        <button type="button" style={button} disabled={busy("persist")} onClick={() => void run("persist", { dryRun })}>
          {busy("persist") ? "④ 处理中…" : dryRun ? "④ 入库（试运行）" : "④ 入库（真写）"}
        </button>
        <label style={muted}><input type="checkbox" checked={!dryRun} onChange={(event) => setDryRun(!event.target.checked)} /> 真写入库</label>
      </div>
      <div style={row}>
        <button type="button" style={button} disabled={busy("pick")} onClick={() => void run("pick", { query, limit: 20 })}>
          {busy("pick") ? "⑤ 检索中…" : "⑤ 取 top N 证据包"}
        </button>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="选题话题，例如：直播获客" style={{ minWidth: 260, padding: "5px 8px" }} />
      </div>
      {cardFor("pull")}
      {cardFor("parse")}
      {cardFor("cluster")}
      {cardFor("persist")}
      {cardFor("pick")}
    </section>
  );
}

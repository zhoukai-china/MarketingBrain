import { useEffect, useState } from "react";
import { apiPath, getAppPath } from "../lib/api.js";

type Finding = { title: string; detail: string; source: "confirmed" | "estimated" | "needs_input" | "missing"; fields: string[] };
type Report = {
  generatedAt: string;
  summary: string;
  confidence: "资料不足" | "基础可诊断";
  knowledgeStatus: "pending_authorized_knowledge";
  knowledgeMessage: string;
  evidence: Finding[];
  priorities: Finding[];
  blockedOutputs: string[];
};

function headers(): HeadersInit {
  const token = localStorage.getItem("store_os_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function readResponse(response: Response): Promise<any> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message ?? body.error ?? "诊断暂时无法生成，请稍后重试。");
  return body;
}

export function LanqiDiagnosisPage() {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!localStorage.getItem("store_os_token")) {
      localStorage.setItem("store_os_post_login_redirect", window.location.pathname);
      window.location.replace(getAppPath("/login"));
      return;
    }
    void loadReport();
  }, []);

  async function loadReport() {
    setLoading(true);
    setError("");
    try {
      const result = await readResponse(await fetch(apiPath("/lanqi/diagnosis/current"), { headers: headers() }));
      setReport(result.report as Report);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "诊断加载失败。 ");
    } finally {
      setLoading(false);
    }
  }

  return <div className="lanqiDiagnosisPage">
    <header className="lanqiDiagnosisHeader">
      <button className="lanqiDiagnosisBrand" onClick={() => window.location.href = getAppPath("/my-ai")}>兰琪美业 <span>经营增长系统</span></button>
      <div><button onClick={() => window.location.href = getAppPath("/lanqi/business-qa")}>经营问答</button><button onClick={() => window.location.href = getAppPath("/lanqi/store-profile")}>编辑经营档案</button><button onClick={() => window.location.href = getAppPath("/my-ai")}>返回我的 AI</button></div>
    </header>
    <main className="lanqiDiagnosisMain">
      <section className="lanqiDiagnosisHero"><p>LANQI AI · FIRST DIAGNOSIS</p><h1>门店经营诊断</h1><span>先以真实资料建立判断基础，再接入经授权的兰琪方法论。</span></section>
      {loading && <section className="lanqiDiagnosisLoading">正在整理本门店经营依据…</section>}
      {error && <section className="lanqiDiagnosisError">{error}<button onClick={() => void loadReport()}>重新生成</button></section>}
      {report && <>
        <section className="lanqiDiagnosisSummary">
          <div><small>当前结论</small><h2>{report.summary}</h2></div>
          <span className={report.confidence === "基础可诊断" ? "ready" : "pending"}>{report.confidence}</span>
        </section>
        <section className="lanqiDiagnosisKnowledge"><span>方法论状态</span><strong>等待兰琪授权知识</strong><p>{report.knowledgeMessage}</p></section>
        <section className="lanqiDiagnosisGrid">
          <article><div className="sectionKicker">WHAT WE KNOW</div><h2>当前判断依据</h2>{report.evidence.map((item, index) => <FindingCard key={index} item={item} />)}</article>
          <article><div className="sectionKicker">NEXT TO CONFIRM</div><h2>下一步优先补充</h2>{report.priorities.map((item, index) => <FindingCard key={index} item={item} priority />)}</article>
        </section>
        <section className="lanqiDiagnosisBoundary"><h2>当前不会输出</h2><p>为保证兰琪方法论和内部定价的严肃性，下列内容会在获得授权知识并完成资料核实前保持关闭：</p><div>{report.blockedOutputs.map(item => <span key={item}>{item}</span>)}</div></section>
        <div className="lanqiDiagnosisActions"><button onClick={() => window.location.href = getAppPath("/lanqi/store-profile")}>去补齐门店资料</button><button className="secondary" onClick={() => void loadReport()}>刷新本次诊断</button></div>
      </>}
    </main>
  </div>;
}

function FindingCard({ item, priority = false }: { item: Finding; priority?: boolean }) {
  const labels: Record<Finding["source"], string> = { confirmed: "已确认", estimated: "经营估算", needs_input: "待补资料", missing: "尚未提供" };
  return <div className={`lanqiFinding ${priority ? "priority" : ""}`}><span>{labels[item.source]}</span><h3>{item.title}</h3><p>{item.detail}</p></div>;
}

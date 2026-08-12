import { useState, useEffect, useRef } from "react";

import type { ProjectPackageCode } from "../../types";
import { apiPath } from "../../lib/api";

interface DiagnosisReport {
  summary: string;
  businessStatus?: string[];
  coreIssues: string[];
  opportunities?: string[];
  profitGap?: string;
  potentialRisks?: string[];
  industryGap?: string[];
  riskLevel?: string;
  recommendedPlan?: string;
  recommendReason?: string;
  roadmap?: Array<{ phase: string; actions: string[]; priority: number }>;
  aiConsultants?: string[];
  onboardingChecklist?: string[];
}

type DiagnosisStage = "intro" | "chatting" | "generating" | "report";

interface DiagnosisViewProps {
  token: string;
  headers: Record<string, string>;
  planCode: string;
  setPlanCode: (code: string) => void;
  onOpenConsultant: (consultantId: string, prompt: string) => void;
  onDone: () => void;
}

const ROLE_QUESTIONS = [
  "你目前最大的经营困惑是什么？",
  "你现在主要用什么方式获客？效果怎么样？",
  "团队现在有多少人？分工是怎么样的？",
  "过去三个月收入趋势怎么样？",
  "你觉得最消耗你时间的事情是什么？",
  "你希望AI优先帮你解决哪个环节的问题？",
];

export function DiagnosisView({ token, headers, planCode, setPlanCode, onOpenConsultant, onDone }: DiagnosisViewProps) {
  const [stage, setStage] = useState<DiagnosisStage>("intro");
  const [conversationId, setConversationId] = useState("");
  const [currentQuestion, setCurrentQuestion] = useState("");
  const [questionIndex, setQuestionIndex] = useState(0);
  const [totalRounds, setTotalRounds] = useState(ROLE_QUESTIONS.length);
  const [inputValue, setInputValue] = useState("");
  const [messages, setMessages] = useState<Array<{ role: "advisor" | "user"; content: string }>>([]);
  const [report, setReport] = useState<DiagnosisReport | null>(null);
  const [offlineEvent, setOfflineEvent] = useState<any>(null);
  const [eventQrSrc, setEventQrSrc] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);
  const eventReportedRef = useRef(false);
  const eventCode = new URLSearchParams(window.location.search).get("event") ?? localStorage.getItem("sitong_offline_event_code") ?? "";

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, stage]);

  useEffect(() => {
    if (!eventCode) return;
    localStorage.setItem("sitong_offline_event_code", eventCode);
    fetch(apiPath(`/offline-events/${encodeURIComponent(eventCode)}`))
      .then((res) => res.json())
      .then((data) => {
        if (data.event) setOfflineEvent(data.event);
      })
      .catch(() => undefined);
  }, [eventCode]);

  useEffect(() => {
    if (!eventCode || !report || eventReportedRef.current) return;
    eventReportedRef.current = true;
    void fetch(apiPath(`/offline-events/${encodeURIComponent(eventCode)}/diagnosis-completed`), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ conversationId, report })
    }).catch(() => undefined);
  }, [conversationId, eventCode, headers, report]);

  function resolveTenantRole() {
    if (planCode.startsWith("chain")) return "chain_brand";
    if (planCode.startsWith("ip")) return "personal_ip";
    return "local_business";
  }

  async function startDiagnosis() {
    setStage("chatting");
    setBusy(true);
    setError("");
    try {
      const res = await fetch(apiPath("/diagnosis/start"), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ role: resolveTenantRole(), source: "login", eventCode: eventCode || undefined }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setError(data.message ?? "启动诊断失败");
        setStage("intro");
        return;
      }
      setConversationId(data.conversationId);
      setCurrentQuestion(data.question ?? ROLE_QUESTIONS[0]);
      setQuestionIndex(data.questionIndex ?? 0);
      setTotalRounds(data.totalRounds ?? ROLE_QUESTIONS.length);
      setMessages([{ role: "advisor", content: data.question ?? ROLE_QUESTIONS[0] }]);
    } catch {
      startLocalDiagnosis();
    }
    setBusy(false);
  }

  function startLocalDiagnosis() {
    const q = ROLE_QUESTIONS[0];
    setCurrentQuestion(q);
    setMessages([{ role: "advisor", content: q }]);
    setBusy(false);
  }

  async function sendAnswer() {
    if (!inputValue.trim() || busy) return;
    const answer = inputValue.trim();
    setInputValue("");
    const newMessages = [...messages, { role: "user" as const, content: answer }];
    setMessages(newMessages);
    setBusy(true);

    if (conversationId) {
      try {
        const res = await fetch(apiPath("/diagnosis/answer"), {
          method: "POST",
          headers: { "Content-Type": "application/json", ...headers },
          body: JSON.stringify({ conversationId, answer, questionIndex }),
        });
        const data = await res.json();
        if (res.ok && !data.error) {
          if (data.complete) {
            await generateRemoteReport(newMessages);
            return;
          }
          const nextQuestion = data.question ?? ROLE_QUESTIONS[Math.min(questionIndex + 1, ROLE_QUESTIONS.length - 1)];
          setCurrentQuestion(nextQuestion);
          setQuestionIndex(data.questionIndex ?? questionIndex + 1);
          setMessages([...newMessages, { role: "advisor", content: nextQuestion }]);
          setBusy(false);
          return;
        }
      } catch {
        // fall back to local scripted questions
      }
    }

    if (questionIndex + 1 >= totalRounds) {
      setStage("generating");
      const localReport = generateLocalReport(newMessages);
      setReport(localReport);
      setStage("report");
      setBusy(false);
      return;
    }

    const nextQuestion = ROLE_QUESTIONS[questionIndex + 1];
    setCurrentQuestion(nextQuestion);
    setQuestionIndex(prev => prev + 1);
    setMessages([...newMessages, { role: "advisor", content: nextQuestion }]);
    setBusy(false);
  }

  async function generateRemoteReport(fallbackMessages: Array<{ role: "advisor" | "user"; content: string }>) {
    setStage("generating");
    try {
      const res = await fetch(apiPath("/diagnosis/generate-report"), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ conversationId }),
      });
      const data = await res.json();
      if (res.ok && !data.error) {
        setReport(data.report ?? data);
        setStage("report");
        setBusy(false);
        return;
      }
    } catch {
      // fall back below
    }
    setReport(generateLocalReport(fallbackMessages));
    setStage("report");
    setBusy(false);
  }

  async function createEventOrder(projectPackageCode: ProjectPackageCode) {
    if (!token) {
      setError("请先登录后再下单，系统需要把项目绑定到你的商家工作区。");
      return;
    }
    setBusy(true);
    setError("");
    setEventQrSrc("");
    try {
      const res = await fetch(apiPath("/billing/orders"), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ type: "project_package", projectPackageCode, eventCode: eventCode || undefined }),
      });
      const data = await res.json();
      if (!res.ok || data.error || !data.order?.id) {
        setError(data.message ?? "下单失败，请稍后重试");
        return;
      }
      setEventQrSrc(apiPath(`/billing/orders/${data.order.id}/wechat-qr.svg`));
    } catch {
      setError("网络错误，请稍后重试");
    } finally {
      setBusy(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendAnswer();
    }
  }

  function generateLocalReport(msgs: Array<{ role: string; content: string }>): DiagnosisReport {
    return {
      summary: "根据你的回答，思潼已初步了解你的经营现状。当前报告只展示现状、漏洞、缺口、风险和行业差距。",
      businessStatus: ["经营信息已完成初步采集。", "当前仍缺少可持续追踪的经营数据口径。"],
      coreIssues: ["获客渠道单一，依赖自然流量", "团队分工不清晰，老板兼顾太多", "缺乏系统的客户跟进机制"],
      opportunities: [],
      profitGap: "当前缺少营收、客流、客单和成本数据，无法准确量化盈利缺口。",
      potentialRisks: ["获客和成交数据不完整，容易误判真实漏损环节。", "团队执行信息不透明，可能持续消耗老板时间。"],
      industryGap: ["成熟商家通常持续记录来源、咨询、成交、复购和成本数据。", "当前经营管理与周期性复盘闭环仍有差距。"],
      riskLevel: "中风险",
      recommendedPlan: planCode || "chain_standard",
      recommendReason: "专属咨询落地方案属于付费/积分兑换资产。",
      roadmap: [],
      aiConsultants: [],
      onboardingChecklist: [],
    };
  }

  // Intro
  if (stage === "intro") {
    return (
      <div className="diagnosisPage">
        <div className="diagnosisCard">
          <span className="diagnosisBadge">经营诊断</span>
          <h1>让思潼了解你的生意</h1>
          <p className="diagnosisSubtitle">
            回答 6 个问题，思潼将在 2 分钟内生成专属经营诊断报告，
            并推荐最适合你的版本和下一步工作重点。
          </p>
          <div className="diagnosisIntroInfo">
            <div className="introInfoItem">
              <strong>{ROLE_QUESTIONS.length}</strong>
              <span>个问题</span>
            </div>
            <div className="introInfoItem">
              <strong>≈2分钟</strong>
              <span>完成时间</span>
            </div>
            <div className="introInfoItem">
              <strong>1份报告</strong>
              <span>专属诊断</span>
            </div>
          </div>
          {offlineEvent && (
            <div className="reportSection" style={{ marginTop: 18 }}>
              <h3>本期AI体检</h3>
              <ul>
                <li>{offlineEvent.topic}</li>
                <li>完成AI体检后，可继续进入适合自己的AI工作台。</li>
              </ul>
            </div>
          )}
          {error && <div className="diagnosisError">{error}</div>}
          <button className="diagnosisStartBtn" onClick={startDiagnosis} disabled={busy}>
            {busy ? "连接中..." : "开始诊断"}
          </button>
          <p className="diagnosisHint" style={{ marginTop: 12 }}>
            已购买套餐？<a href="#" onClick={(e) => { e.preventDefault(); onDone(); }}>跳过诊断，直接使用</a>
          </p>
        </div>
      </div>
    );
  }

  if (stage === "chatting") {
    return (
      <div className="diagnosisPage">
        <div className="diagnosisCard">
          <div className="diagnosisProgress">
            <span className="diagnosisRoundMeta">问题 {questionIndex + 1} / {totalRounds}</span>
            <div className="diagnosisSteps">
              {Array.from({ length: totalRounds }).map((_, i) => (
                <div key={i} className={`diagnosisDots${i <= questionIndex ? " done" : ""}`} />
              ))}
            </div>
          </div>
          <div className="diagnosisChatCard">
            <div className="chatMessages">
              {messages.map((msg, i) => (
                <div key={i} className="diagnosisHistoryPair">
                  <div className={`diagnosisChatBubble ${msg.role}`}>{msg.content}</div>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
            {error && <div className="diagnosisError">{error}</div>}
            <div className="chatComposer compactForm">
              <textarea
                className="chatInput"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="输入你的回答..."
                rows={2}
                disabled={busy}
              />
              <button onClick={sendAnswer} disabled={busy || !inputValue.trim()}>
                {busy ? "..." : "发送"}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (stage === "generating") {
    return (
      <div className="diagnosisPage">
        <div className="diagnosisCard generatingCard">
          <div className="generatingSpinner" />
          <h2>正在分析你的经营情况...</h2>
          <p>思潼正在基于你的回答生成诊断报告和版本推荐</p>
        </div>
      </div>
    );
  }

  return (
    <div className="diagnosisPage">
      <div className="diagnosisCard reportCard">
        <span className="diagnosisBadge">诊断报告</span>
        <h1>经营诊断报告</h1>
        <div className="reportSummary">
          <h3>现状总结</h3>
          <p>{report?.summary}</p>
        </div>
        {report?.businessStatus && (
          <div className="reportSection">
            <h3>经营现状</h3>
            <ul>
              {report.businessStatus.map((item, i) => <li key={i}>{item}</li>)}
            </ul>
          </div>
        )}
        <div className="reportSection">
          <h3>现存漏洞</h3>
          <ul>
            {report?.coreIssues.map((issue, i) => <li key={i}>{issue}</li>)}
          </ul>
        </div>
        {report?.profitGap && (
          <div className="reportSection">
            <h3>盈利缺口</h3>
            <ul>
              <li>{report.profitGap}</li>
            </ul>
          </div>
        )}
        <div className="reportSection">
          <h3>潜在经营风险</h3>
          <ul>
            {(report?.potentialRisks ?? []).map((risk, i) => <li key={i}>{risk}</li>)}
          </ul>
        </div>
        <div className="reportSection">
          <h3>行业差距</h3>
          <ul>
            {(report?.industryGap ?? []).map((gap, i) => <li key={i}>{gap}</li>)}
          </ul>
        </div>
        {report && (
          <>
            {offlineEvent && (
              <div className="reportSection" style={{ marginTop: 20 }}>
                <h3>下一步服务</h3>
                <ul>
                  <li>¥6,980 本地商家30天AI增长陪跑包：适合需要按天推进执行的商家。</li>
                  <li>¥1,980 AI增长体检加急解读：适合先把报告和行动顺序讲清楚。</li>
                </ul>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button className="diagnosisStartBtn" onClick={() => createEventOrder("local_growth_30")} disabled={busy}>
                    购买30天增长陪跑
                  </button>
                  <button
                    className="diagnosisStartBtn"
                    style={{ background: "var(--panel2)", color: "var(--gold)", border: "1px solid var(--gold)" }}
                    onClick={() => createEventOrder("ai_health_express")}
                    disabled={busy}
                  >
                    购买加急解读
                  </button>
                </div>
                {eventQrSrc && (
                  <div style={{ marginTop: 16 }}>
                    <p style={{ color: "var(--gold)", fontWeight: 800 }}>扫码支付</p>
                    <img src={eventQrSrc} alt="支付二维码" style={{ width: 220, height: 220, borderRadius: 8, background: "#fff", padding: 8 }} />
                  </div>
                )}
                {error && <div className="diagnosisError" style={{ marginTop: 12 }}>{error}</div>}
              </div>
            )}
            <button className="diagnosisStartBtn" style={{ marginTop: 20 }} onClick={() => {
              localStorage.setItem("store_os_initial_diagnosis_done", "1");
              onOpenConsultant("general_qa", report.summary);
            }}>
              解锁专属咨询落地方案 →
            </button>
          </>
        )}
      </div>
    </div>
  );
}

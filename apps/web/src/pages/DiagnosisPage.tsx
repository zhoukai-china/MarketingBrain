import { useEffect, useRef, useState } from "react";
import { WeaknessComparisonMatrix } from "@baolu/dashboard";
import type { WeaknessTag } from "@baolu/shared";
import { apiBase } from "../lib/api.js";

interface DiagnosisReport {
  summary: string;
  coreIssues: string[];
  opportunities: string[];
  recommendedPlan: string;
  recommendReason: string;
  roadmap: Array<{ phase: string; actions: string[]; priority: number }>;
  aiConsultants: string[];
  onboardingChecklist: string[];
  tenantRole?: string;
  tenantName?: string;
  industry?: string;
  city?: string;
  questions?: string[];
  answers?: string[];
}

interface DiagnosisPageProps {
  token: string;
  tenantRole: string;
  tenantName: string;
  onComplete: (report: DiagnosisReport, selectedPlan: string) => void;
}

type DiagnosisStage = "intro" | "chatting" | "generating" | "report";

const ROLE_LABELS: Record<string, string> = {
  personal_ip: "个人IP/知识付费",
  local_business: "本地生活商家",
  chain_brand: "连锁品牌",
};

const PLAN_LABELS: Record<string, string> = {
  local_standard: "本地商家标准版",
  local_premium: "本地商家高级版",
  ip_standard: "个人IP标准版",
  ip_premium: "个人IP高级版",
  chain_standard: "连锁品牌标准版",
  chain_premium: "连锁品牌高级版",
};

const PLAN_PRICES: Record<string, string> = {
  local_standard: "¥199/月",
  local_premium: "¥399/月",
  ip_standard: "¥99/月",
  ip_premium: "¥199/月",
  chain_standard: "¥299/月",
  chain_premium: "¥599/月",
};

const ACQUISITION_KEYWORDS = [
  "获客",
  "流量",
  "客户",
  "引流",
  "曝光",
  "粉丝",
  "咨询",
  "线索",
  "抖音",
  "视频号",
  "小红书",
  "推广",
  "广告",
  "营销",
  "渠道",
];
const DELIVERY_KEYWORDS = [
  "交付",
  "服务",
  "体验",
  "复购",
  "口碑",
  "售后",
  "履约",
  "质量",
  "标准",
  "流程",
  "SOP",
  "培训",
];
const MANAGEMENT_KEYWORDS = [
  "管理",
  "团队",
  "员工",
  "招聘",
  "绩效",
  "考核",
  "激励",
  "制度",
  "组织",
  "效率",
  "人效",
  "成本",
  "利润",
];

function countHits(text: string, keywords: string[]): number {
  let hits = 0;
  for (const kw of keywords) {
    if (text.includes(kw)) hits++;
  }
  return hits;
}

function deriveScoresFromReport(
  report: DiagnosisReport,
): Record<WeaknessTag, number> {
  const sourceText = [
    report.summary ?? "",
    (report.coreIssues ?? []).join(" "),
    (report.opportunities ?? []).join(" "),
  ].join(" ");

  const acqHits = countHits(sourceText, ACQUISITION_KEYWORDS);
  const delHits = countHits(sourceText, DELIVERY_KEYWORDS);
  const mgtHits = countHits(sourceText, MANAGEMENT_KEYWORDS);
  const totalHits = acqHits + delHits + mgtHits || 1;

  return {
    acquisition: Math.round(Math.max(10, 90 - (acqHits / totalHits) * 80)),
    delivery: Math.round(Math.max(10, 90 - (delHits / totalHits) * 80)),
    management: Math.round(Math.max(10, 90 - (mgtHits / totalHits) * 80)),
  };
}

export default function DiagnosisPage({
  token,
  tenantRole,
  tenantName,
  onComplete,
}: DiagnosisPageProps) {
  const [stage, setStage] = useState<DiagnosisStage>("intro");
  const [conversationId, setConversationId] = useState("");
  const [currentQuestion, setCurrentQuestion] = useState("");
  const [questionIndex, setQuestionIndex] = useState(0);
  const [totalRounds, setTotalRounds] = useState(8);
  const [inputValue, setInputValue] = useState("");
  const [messages, setMessages] = useState<
    Array<{ role: "advisor" | "user"; content: string }>
  >([]);
  const [report, setReport] = useState<DiagnosisReport | null>(null);
  const [selectedPlan, setSelectedPlan] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, stage]);
  async function startDiagnosis() {
    setStage("chatting");
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`${apiBase}/diagnosis/start`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ role: tenantRole, tenantName, source: "login" }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setError(data.message ?? "启动诊断失败");
        setStage("intro");
        return;
      }
      setConversationId(data.conversationId);
      setCurrentQuestion(data.question);
      setQuestionIndex(data.questionIndex ?? 0);
      setTotalRounds(data.totalRounds ?? 8);
      setMessages([{ role: "advisor", content: data.question }]);
    } catch {
      setError("网络异常，请重试");
      setStage("intro");
    } finally {
      setBusy(false);
    }
  }
  async function sendAnswer() {
    if (!inputValue.trim() || busy) return;
    const answer = inputValue.trim();
    setInputValue("");
    setMessages((prev) => [...prev, { role: "user", content: answer }]);
    setBusy(true);
    try {
      const res = await fetch(`${apiBase}/diagnosis/answer`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ conversationId, answer, questionIndex }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setError(data.message ?? "发送失败");
        return;
      }
      if (data.complete) {
        await generateReport();
      } else {
        setCurrentQuestion(data.question);
        setQuestionIndex(data.questionIndex);
        setMessages((prev) => [
          ...prev,
          { role: "advisor", content: data.question },
        ]);
      }
    } catch {
      setError("发送失败，请重试");
    } finally {
      setBusy(false);
    }
  }
  async function generateReport() {
    setStage("generating");
    setBusy(true);
    try {
      const res = await fetch(`${apiBase}/diagnosis/generate-report`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ conversationId }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setError(data.message ?? "生成报告失败");
        setStage("chatting");
        return;
      }
      setReport(data.report);
      setSelectedPlan(data.report.recommendedPlan);
      setStage("report");
    } catch {
      setError("生成报告失败，请重试");
      setStage("chatting");
    } finally {
      setBusy(false);
    }
  }
  function handleConfirm() {
    if (!report) return;
    localStorage.setItem("store_os_diagnosis_done", "true");
    localStorage.setItem("store_os_diagnosis_report", JSON.stringify(report));
    onComplete(report, selectedPlan);
  }
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey && stage === "chatting") {
      e.preventDefault();
      sendAnswer();
    }
  }

  // Intro stage
  if (stage === "intro") {
    return (
      <div className="diagnosisPage">
        {" "}
        <div className="diagnosisCard introCard">
          {" "}
          <span className="diagnosisBadge">AI经营诊断</span>{" "}
          <h1>你好，我是思潼</h1>{" "}
          <p className="diagnosisSubtitle">
            {" "}
            我会陪你梳理{ROLE_LABELS[tenantRole] ?? "企业"}的经营问题。 <br />{" "}
            接下来我会像微信聊天一样，问你几个关键问题，帮你找到当前最该发力的一两个增长杠杆。{" "}
          </p>{" "}
          <div className="diagnosisIntroInfo">
            {" "}
            <div className="introInfoItem">
              {" "}
              <strong>{tenantName || "你的企业"}</strong>{" "}
              <span>正在等待诊断</span>{" "}
            </div>{" "}
            <div className="introInfoItem">
              {" "}
              <strong>{ROLE_LABELS[tenantRole] ?? "企业"}</strong>{" "}
              <span>经营类型</span>{" "}
            </div>{" "}
          </div>{" "}
          <div className="diagnosisIntroHints">
            {" "}
            <p>我会这样了解你的情况：</p>{" "}
            <ul>
              {" "}
              <li>新客从哪里来？线上还是线下？</li>{" "}
              <li>顾客从知道到买单，中间卡在哪？</li>{" "}
              <li>复购和转介绍现在什么状态？</li>{" "}
              <li>团队执行力，老板最头疼什么？</li>{" "}
              <li>如果AI帮你减负，最想先交出去什么？</li>{" "}
            </ul>{" "}
          </div>{" "}
          {error && <div className="diagnosisError">{error}</div>}{" "}
          <button
            className="diagnosisStartBtn"
            onClick={startDiagnosis}
            disabled={busy}
          >
            {" "}
            {busy ? "正在准备..." : "开始诊断对话 ⟶"}{" "}
          </button>{" "}
          <p className="diagnosisHint">
            大约需要 2-3 分钟，像微信聊天一样轻松
          </p>{" "}
        </div>{" "}
      </div>
    );
  }

  // Chatting stage
  if (stage === "chatting") {
    return (
      <div className="diagnosisPage">
        {" "}
        <div className="diagnosisCard chatCard">
          {" "}
          <div className="chatHeader">
            {" "}
            <span className="chatAdvisorLabel">思潼 · 经营诊断中</span>{" "}
            <span className="chatProgress">
              {" "}
              {questionIndex + 1} / {totalRounds}{" "}
            </span>{" "}
          </div>{" "}
          <div className="chatMessages">
            {" "}
            {messages.map((msg, i) => (
              <div
                key={i}
                className={msg.role === "advisor" ? "msg advisor" : "msg user"}
              >
                {" "}
                <div className="msgBubble">{msg.content}</div>{" "}
              </div>
            ))}{" "}
            {busy && (
              <div className="msg advisor typing">
                {" "}
                <div className="msgBubble">
                  {" "}
                  <span className="typingDots">...</span>{" "}
                </div>{" "}
              </div>
            )}{" "}
            <div ref={chatEndRef} />{" "}
          </div>{" "}
          {error && <div className="diagnosisError">{error}</div>}{" "}
          <div className="chatInput">
            {" "}
            <textarea
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入你的回答..."
              rows={2}
              disabled={busy}
            />{" "}
            <button onClick={sendAnswer} disabled={busy || !inputValue.trim()}>
              {" "}
              {busy ? "..." : "发送"}{" "}
            </button>{" "}
          </div>{" "}
        </div>{" "}
      </div>
    );
  }

  // Generating report stage
  if (stage === "generating") {
    return (
      <div className="diagnosisPage">
        {" "}
        <div className="diagnosisCard generatingCard">
          {" "}
          <div className="generatingSpinner" /> <h2>正在分析你的经营情况...</h2>{" "}
          <p>思潼正在基于你的回答生成诊断报告和版本推荐</p>{" "}
        </div>{" "}
      </div>
    );
  }

  // Report stage
  return (
    <div className="diagnosisPage">
      {" "}
      <div className="diagnosisCard reportCard">
        {" "}
        <span className="diagnosisBadge">诊断报告</span>{" "}
        <h1>{tenantName || "企业"} · 经营诊断报告</h1>{" "}
        <div className="reportSummary">
          {" "}
          <h3>现状总结</h3> <p>{report?.summary}</p>{" "}
        </div>{" "}
        <div className="reportSection">
          {" "}
          <h3>核心问题</h3>{" "}
          <ul>
            {" "}
            {report?.coreIssues.map((issue, i) => (
              <li key={i}>{issue}</li>
            ))}{" "}
          </ul>{" "}
        </div>{" "}
        {/* === Phase 2: Weakness Comparison Matrix === */}{" "}
        {report && (
          <div className="reportSection">
            {" "}
            <WeaknessComparisonMatrix
              tenantName={report.tenantName ?? tenantName}
              tenantRole={report.tenantRole ?? tenantRole}
              scores={deriveScoresFromReport(report)}
            />{" "}
          </div>
        )}{" "}
        <div className="reportSection">
          {" "}
          <h3>增长机会</h3>{" "}
          <ul>
            {" "}
            {(report?.opportunities ?? []).map((opp, i) => (
              <li key={i}>{opp}</li>
            ))}{" "}
          </ul>{" "}
        </div>{" "}
        <div className="reportPlanCard">
          {" "}
          <h3>推荐版本</h3>{" "}
          <div className="planRecCard">
            {" "}
            <strong>
              {PLAN_LABELS[report?.recommendedPlan ?? ""] ??
                report?.recommendedPlan}
            </strong>{" "}
            <span className="planPrice">
              {PLAN_PRICES[report?.recommendedPlan ?? ""]}
            </span>{" "}
            <p>{report?.recommendReason}</p>{" "}
          </div>{" "}
          <p className="planHint">
            你也可以选择其他版本（登录后随时可升级）
          </p>{" "}
        </div>{" "}
        <div className="reportSection">
          {" "}
          <h3>落地路线图</h3>{" "}
          {(report?.roadmap ?? []).map((phase, i) => (
            <div key={i} className="roadmapPhase">
              {" "}
              <strong>{phase.phase}</strong>{" "}
              <ul>
                {" "}
                {phase.actions.map((action, j) => (
                  <li key={j}>{action}</li>
                ))}{" "}
              </ul>{" "}
            </div>
          ))}{" "}
        </div>{" "}
        <div className="reportSection">
          {" "}
          <h3>优先启动的工作重点</h3>{" "}
          <div className="aiConsultantTags">
            {" "}
            {(report?.aiConsultants ?? []).map((c, i) => (
              <span key={i} className="consultantTag">
                {c}
              </span>
            ))}{" "}
          </div>{" "}
        </div>{" "}
        <div className="reportSection">
          {" "}
          <h3>入驻清单</h3>{" "}
          <ul>
            {" "}
            {(report?.onboardingChecklist ?? []).map((item, i) => (
              <li key={i}>{item}</li>
            ))}{" "}
          </ul>{" "}
        </div>{" "}
        <div className="reportActions">
          {" "}
          <button className="reportConfirmBtn" onClick={handleConfirm}>
            {" "}
            确认版本，进入思潼AI 行业智能体平台 ⟶{" "}
          </button>{" "}
          <button className="reportBackBtn" onClick={() => setStage("intro")}>
            {" "}
            重新诊断{" "}
          </button>{" "}
        </div>{" "}
      </div>{" "}
    </div>
  );
}

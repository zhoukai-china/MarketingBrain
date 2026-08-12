import { useEffect, useMemo, useRef, useState } from "react";
import sitongChiefAvatar from "../assets/sitong-beauty.png";

import { WeaknessComparisonMatrix } from "@baolu/dashboard";
import type { WeaknessTag } from "@baolu/shared";

const ACQUISITION_KW = ["获客","流量","客户","引流","曝光","粉丝","咨询","线索","抖音","视频号","小红书","推广","广告","营销","渠道"];
const DELIVERY_KW = ["交付","服务","体验","复购","口碑","售后","履约","质量","标准","流程","SOP","培训"];
const MANAGEMENT_KW = ["管理","团队","员工","招聘","绩效","考核","激励","制度","组织","效率","人效","成本","利润"];
function kwHits(text: string, kws: string[]): number { let h = 0; for (const kw of kws) { if (text.includes(kw)) h++; } return h; }
function deriveScoresFromAnswers(answers: Record<string,string>): Record<WeaknessTag,number> {
  const txt = Object.values(answers).join(" ");
  const a = kwHits(txt, ACQUISITION_KW);
  const d = kwHits(txt, DELIVERY_KW);
  const m = kwHits(txt, MANAGEMENT_KW);
  const t = a + d + m || 1;
  return { acquisition: Math.round(Math.max(10, 90 - (a/t)*80)), delivery: Math.round(Math.max(10, 90 - (d/t)*80)), management: Math.round(Math.max(10, 90 - (m/t)*80)) };
}
// ── Types ──

type BusinessRole = "personal_ip" | "local_business" | "chain_brand";
type DiagnosisKey = "acquisition" | "sales" | "delivery" | "management";

interface DiagnosisQuestion {
  key: DiagnosisKey;
  title: string;
  prompt: string;
}

interface DiagnosisChatItem {
  question: string;
  answer: string;
  key: string;
}

interface DiagnosisReport {
  acquisition: string;
  sales: string;
  delivery: string;
  management: string;
  positioning: string;
  customer: string;
}

interface MemoryState {
  role: BusinessRole;
  tenantName: string;
  industry: string;
  city: string;
  positioning: string;
  customer: string;
  acquisition: string;
  sales: string;
  delivery: string;
  management: string;
  startedAt?: string;
  completedAt?: string;
}

type PageMode = "landing" | "register" | "chat";

// ── Constants ──

const roleOptions: { value: BusinessRole; title: string }[] = [
  { value: "personal_ip", title: "OPC / 个人IP" },
  { value: "local_business", title: "本地商家" },
  { value: "chain_brand", title: "连锁品牌" },
];

const ROLE_LABELS: Record<BusinessRole, string> = {
  personal_ip: "OPC个人IP",
  local_business: "本地商家",
  chain_brand: "连锁品牌",
};

const DIMENSION_LABELS: Record<DiagnosisKey, string> = {
  acquisition: "获客诊断",
  sales: "销售诊断",
  delivery: "交付诊断",
  management: "管理诊断",
};

function diagnosisQuestionsByRole(role: BusinessRole): DiagnosisQuestion[] {
  if (role === "personal_ip") {
    return [
      { key: "acquisition", title: "获客诊断", prompt: "现在别人主要从哪里认识你？拍短视频、写公众号、做直播，还是靠老客户转介绍？" },
      { key: "sales", title: "销售诊断", prompt: "别人认识你之后，怎么变成付费客户？是靠私信咨询，还是加了微信之后慢慢聊？" },
      { key: "delivery", title: "交付诊断", prompt: "客户付钱之后，你是怎么交付的？比如一对一咨询、课程、陪跑，还是社群服务？" },
      { key: "management", title: "管理诊断", prompt: "现在团队多少人？最让你头疼的管理问题是什么？" },
    ];
  }
  if (role === "chain_brand") {
    return [
      { key: "acquisition", title: "获客诊断", prompt: "现在各区域的加盟商新客主要从哪里来？总部统一引流，还是各门店自己想办法？" },
      { key: "sales", title: "销售诊断", prompt: "加盟线索到了之后怎么跟进？总部统一招商团队在跟，还是区域代理在跟？" },
      { key: "delivery", title: "交付诊断", prompt: "加盟商开店之后总部怎么扶商？有标准化的培训SOP吗？" },
      { key: "management", title: "管理诊断", prompt: "现在总部团队多少人？加盟店总数多少？最让你操心的管理短板在哪？" },
    ];
  }
  return [
    { key: "acquisition", title: "获客诊断", prompt: "现在新客主要从哪里来？是路过看到店招，还是抖音/美团/小红书来的？" },
    { key: "sales", title: "销售诊断", prompt: "客户进店或线上问完之后，转化率怎么样？最容易卡在哪一步？" },
    { key: "delivery", title: "交付诊断", prompt: "客户消费完之后体验怎么样？有没有人反馈过哪里不满意？" },
    { key: "management", title: "管理诊断", prompt: "你现在每天花最多时间在什么事情上？" },
  ];
}

function buildDiagnosisPositioning(role: BusinessRole, tenantName: string, industry: string, city: string): string {
  const label = ROLE_LABELS[role];
  const id = tenantName || "未填写";
  const ind = industry || "未填写";
  const loc = city || "未填写";
  if (role === "personal_ip") return `${label} · ${id} · ${ind} · 坐标${loc}`;
  if (role === "chain_brand") return `${label} · ${id} · ${ind} 连锁 · 总部${loc}`;
  return `${label} · ${id} · ${ind} · ${loc}`;
}

function buildDiagnosisCustomer(role: BusinessRole): string {
  if (role === "personal_ip") return "创始人IP的粉丝/学员/咨询客户";
  if (role === "chain_brand") return "加盟商/区域代理/终端消费者";
  return "门店周边客户及线上到店客户";
}

function buildDiagnosisSummary(
  role: BusinessRole,
  tenantName: string,
  industry: string,
  city: string,
  answers: Record<string, string>
): MemoryState {
  return {
    role,
    tenantName: tenantName.trim() || ROLE_LABELS[role],
    industry: industry.trim() || "未填写",
    city: city.trim() || "未填写",
    positioning: buildDiagnosisPositioning(role, tenantName, industry, city),
    customer: buildDiagnosisCustomer(role),
    acquisition: answers.acquisition?.trim() || "获客信息暂未收集",
    sales: answers.sales?.trim() || "销售信息暂未收集",
    delivery: answers.delivery?.trim() || "交付信息暂未收集",
    management: answers.management?.trim() || "管理信息暂未收集",
    startedAt: new Date().toISOString(),
  };
}

function buildDiagnosisReport(memory: MemoryState): DiagnosisReport {
  return {
    positioning: memory.positioning,
    customer: memory.customer,
    acquisition: memory.acquisition,
    sales: memory.sales,
    delivery: memory.delivery,
    management: memory.management,
  };
}

// ── Presets (mock memory for demo purposes) ──

const DEMO_PRESETS: Record<string, MemoryState> = {
  demo_personal_ip: {
    role: "personal_ip",
    tenantName: "李敏",
    industry: "知识付费",
    city: "杭州",
    positioning: "OPC个人IP · 李敏 · 知识付费 · 坐标杭州",
    customer: "创始人IP的粉丝/学员/咨询客户",
    acquisition: "主要靠抖音短视频引流到私域，每天发3条，偶尔直播",
    sales: "私域加微信后一对一咨询转化，客单价9800，月均成交5-8单",
    delivery: "一对一陪跑3个月 + 每月线上答疑",
    management: "就自己加一个助理，内容制作和客户跟进都靠自己，忙不过来",
  },
};

// ── Url helpers ──

function encodeShareData(data: { role: BusinessRole; tenantName: string; industry: string; city: string }): string {
  const json = JSON.stringify(data);
  return btoa(encodeURIComponent(json));
}

function decodeShareData(token: string): { role: BusinessRole; tenantName: string; industry: string; city: string } | null {
  try {
    return JSON.parse(decodeURIComponent(atob(token)));
  } catch {
    return null;
  }
}

// localStorage keys
const STORAGE_KEY_MEMORY = "baolu_os_diagnosis_memory_v2";
const STORAGE_KEY_ITEMS = "baolu_os_diagnosis_chat_items_v2";
const STORAGE_KEY_STEP = "baolu_os_diagnosis_step_v2";
const STORAGE_KEY_PROMPTS = "baolu_os_diagnosis_prompts_v2";

function loadFromStorage(): {
  memory: MemoryState | null;
  step: number;
  stepItems: Record<number, DiagnosisChatItem>;
  stepPrompts: Record<number, string>;
} {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_MEMORY);
    const memory = raw ? (JSON.parse(raw) as MemoryState) : null;
    const step = parseInt(localStorage.getItem(STORAGE_KEY_STEP) || "0", 10) || 0;
    const stepItems = JSON.parse(localStorage.getItem(STORAGE_KEY_ITEMS) || "{}");
    const stepPrompts = JSON.parse(localStorage.getItem(STORAGE_KEY_PROMPTS) || "{}");
    return { memory, step, stepItems, stepPrompts };
  } catch {
    return { memory: null, step: 0, stepItems: {}, stepPrompts: {} };
  }
}

function saveToStorage(
  memory: MemoryState | null,
  step: number,
  stepItems: Record<number, DiagnosisChatItem>,
  stepPrompts: Record<number, string>
) {
  if (memory) localStorage.setItem(STORAGE_KEY_MEMORY, JSON.stringify(memory));
  localStorage.setItem(STORAGE_KEY_STEP, String(step));
  localStorage.setItem(STORAGE_KEY_ITEMS, JSON.stringify(stepItems));
  localStorage.setItem(STORAGE_KEY_PROMPTS, JSON.stringify(stepPrompts));
}

function clearDiagnosisStorage() {
  localStorage.removeItem(STORAGE_KEY_MEMORY);
  localStorage.removeItem(STORAGE_KEY_ITEMS);
  localStorage.removeItem(STORAGE_KEY_STEP);
  localStorage.removeItem(STORAGE_KEY_PROMPTS);
}

// ── API helpers ──

const API_BASE = "/api";

async function apiGet<T = unknown>(path: string): Promise<{ ok: boolean; status: number; data?: T }> {
  try {
    const res = await fetch(`${API_BASE}${path}`);
    const text = await res.text();
    return { ok: res.ok, status: res.status, data: text ? (JSON.parse(text) as T) : undefined };
  } catch {
    return { ok: false, status: 0 };
  }
}

async function apiPost<T = unknown>(path: string, body: unknown): Promise<{ ok: boolean; status: number; data?: T }> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, data: text ? (JSON.parse(text) as T) : undefined };
  } catch {
    return { ok: false, status: 0 };
  }
}

// ── Sub-components ──

function DimensionCard({
  dim,
  label,
  chatItem,
  isActive,
  onClick,
}: {
  dim: DiagnosisKey;
  label: string;
  chatItem?: DiagnosisChatItem;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`dimensionCard ${isActive ? "active" : ""} ${chatItem?.answer?.trim() ? "answered" : ""}`}
      onClick={onClick}
      aria-pressed={isActive}
    >
      <span className="dimBadge">{label}</span>
      {chatItem?.answer?.trim() ? (
        <span className="dimPreview">{chatItem.answer.slice(0, 40)}{chatItem.answer.length > 40 ? "…" : ""}</span>
      ) : (
        <span className="dimPlaceholder">待回答</span>
      )}
    </button>
  );
}

function ConfirmDialog({
  title,
  message,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="dialogOverlay" onClick={onCancel}>
      <div className="dialogBox" onClick={(e) => e.stopPropagation()}>
        <h4>{title}</h4>
        <p>{message}</p>
        <div className="dialogActions">
          <button className="outlineSm" onClick={onCancel}>取消</button>
          <button className="primarySm" onClick={onConfirm}>确认</button>
        </div>
      </div>
    </div>
  );
}

// ── Main component ──

export default function BaoluDiagnosisApp() {
  // Read URL params for sharing
  const urlParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const shareToken = urlParams.get("d");
  const shareData = shareToken ? decodeShareData(shareToken) : null;

  const [mode, setMode] = useState<PageMode>(() => {
    if (shareToken && shareData) return "register";
    return "landing";
  });

  // Registration form
  const [role, setRole] = useState<BusinessRole>(shareData?.role ?? "personal_ip");
  const [tenantName, setTenantName] = useState(shareData?.tenantName ?? "");
  const [industry, setIndustry] = useState(shareData?.industry ?? "");
  const [city, setCity] = useState(shareData?.city ?? "");

  // Resume state
  const [hasExistingSession, setHasExistingSession] = useState(() => {
    try {
      return !!localStorage.getItem(STORAGE_KEY_MEMORY);
    } catch {
      return false;
    }
  });

  // Chat state
  const [memory, setMemory] = useState<MemoryState | null>(null);
  const [step, setStep] = useState(0);
  const [stepItems, setStepItems] = useState<Record<number, DiagnosisChatItem>>({});
  const [stepPrompts, setStepPrompts] = useState<Record<number, string>>({});
  const [draftAnswer, setDraftAnswer] = useState("");
  const [dynamicPrompt, setDynamicPrompt] = useState("");
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [showConfirmRestart, setShowConfirmRestart] = useState(false);
  const [shareUrl, setShareUrl] = useState("");

  const inputRef = useRef<HTMLInputElement>(null);

  const questions = useMemo(() => diagnosisQuestionsByRole(role), [role]);
  const currentQuestion = questions[step];
  const currentPrompt = stepPrompts[step] || dynamicPrompt || currentQuestion?.prompt || "";
  const currentSavedAnswer = stepItems[step]?.answer ?? "";
  const canGoNext = step < questions.length - 1;

  // Aggregate answers per dimension
  const dimensionAnswers = useMemo(() => {
    const map: Record<DiagnosisKey, string> = { acquisition: "", sales: "", delivery: "", management: "" };
    for (const item of Object.values(stepItems)) {
      if (item.key && map[item.key as DiagnosisKey] !== undefined && item.answer.trim()) {
        map[item.key as DiagnosisKey] += (map[item.key as DiagnosisKey] ? " | " : "") + item.answer.trim();
      }
    }
    return map;
  }, [stepItems]);

  // Load dynamic prompt from API
  useEffect(() => {
    if (!memory || !currentQuestion || mode !== "chat") return;
    let cancelled = false;

    async function loadDynamicPrompt() {
      const answers: Record<string, string> = {};
      for (const item of Object.values(stepItems)) {
        if (item.key && item.answer.trim()) {
          answers[item.key] = (answers[item.key] ? answers[item.key] + " | " : "") + item.answer.trim();
        }
      }

      setIsLoading(true);
      const result = await apiPost<{ question?: string }>("/diagnosis/next-question", {
        role,
        tenantName: memory!.tenantName,
        industry: memory!.industry,
        city: memory!.city,
        stepKey: currentQuestion.key,
        stepTitle: currentQuestion.title,
        roundIndex: step + 1,
        totalRounds: questions.length,
        answers,
      });

      if (cancelled) return;
      setIsLoading(false);

      const question = result.data?.question?.trim();
      if (result.ok && question) {
        setDynamicPrompt(question);
        setStepPrompts((prev) => ({ ...prev, [step]: question }));
      }
    }

    // Small delay before loading
    const timer = window.setTimeout(() => {
      void loadDynamicPrompt();
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [memory, currentQuestion?.key, step, mode]);

  // Sync draft answer when step changes
  useEffect(() => {
    setDraftAnswer(stepItems[step]?.answer ?? "");
    setDynamicPrompt("");
  }, [step, stepItems]);

  // Focus input
  useEffect(() => {
    if (mode === "chat" && inputRef.current) {
      inputRef.current.focus();
    }
  }, [mode, step]);

  // ── Actions ──

  function handleSelectRole(nextRole: BusinessRole) {
    setRole(nextRole);
    setStep(0);
    setStepItems({});
    setDraftAnswer("");
    setStepPrompts({});
    setDynamicPrompt("");
  }

  function handleStartNew() {
    if (hasExistingSession) {
      setShowConfirmRestart(true);
      return;
    }
    startNewSession();
  }

  function startNewSession() {
    setShowConfirmRestart(false);
    const mem = buildDiagnosisSummary(role, tenantName, industry, city, {});
    setMemory(mem);
    setStep(0);
    setStepItems({});
    setStepPrompts({});
    setDraftAnswer("");
    setDynamicPrompt("");
    setMessage("");
    setShowReport(false);
    setMode("chat");
    clearDiagnosisStorage();
    saveToStorage(mem, 0, {}, {});
  }

  function handleResume() {
    const { memory: stored, step: s, stepItems: items, stepPrompts: prompts } = loadFromStorage();
    if (!stored) return;
    setMemory(stored);
    setRole(stored.role);
    setTenantName(stored.tenantName);
    setIndustry(stored.industry);
    setCity(stored.city);
    setStep(s);
    setStepItems(items);
    setStepPrompts(prompts);
    setMode("chat");
  }

  function handleEnterAfterRegister() {
    const mem = buildDiagnosisSummary(role, tenantName, industry, city, {});
    setMemory(mem);
    setStep(0);
    setStepItems({});
    setStepPrompts({});
    setDraftAnswer("");
    setDynamicPrompt("");
    setMessage("");
    setShowReport(false);
    setMode("chat");
    clearDiagnosisStorage();
    saveToStorage(mem, 0, {}, {});
  }

  function saveCurrentRound(): Record<number, DiagnosisChatItem> | null {
    const answer = draftAnswer.trim();
    if (!answer) {
      setMessage("先简单回答这一句，我再继续追问。");
      return null;
    }
    const nextItems = {
      ...stepItems,
      [step]: {
        question: currentPrompt,
        answer,
        key: currentQuestion.key,
      },
    };
    setStepItems(nextItems);
    setMessage("");
    return nextItems;
  }

  function handleNext() {
    const nextItems = saveCurrentRound();
    if (!nextItems) return;
    if (canGoNext) {
      const nextStep = step + 1;
      setStep(nextStep);
      saveToStorage(memory, nextStep, nextItems, stepPrompts);
    } else {
      finishDiagnosis(nextItems);
    }
  }

  function handlePrevious() {
    setMessage("");
    setDynamicPrompt("");
    setStep(Math.max(0, step - 1));
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleNext();
    }
  }

  async function finishDiagnosis(finalStepItems = stepItems) {
    const finalAnswers: Record<string, string> = {};
    for (const item of Object.values(finalStepItems)) {
      if (item.key && item.answer.trim()) {
        finalAnswers[item.key] = (finalAnswers[item.key] ? finalAnswers[item.key] + " | " : "") + item.answer.trim();
      }
    }

    const previousMemory = memory || buildDiagnosisSummary(role, "", "", "", {});
    const normalizedMemory: MemoryState = {
      ...previousMemory,
      role,
      tenantName: tenantName.trim() || ROLE_LABELS[role],
      industry: industry.trim() || "未填写",
      city: city.trim() || "未填写",
      positioning: buildDiagnosisPositioning(role, tenantName, industry, city),
      customer: buildDiagnosisCustomer(role),
      acquisition: finalAnswers.acquisition?.trim() || "获客信息暂未收集",
      sales: finalAnswers.sales?.trim() || "销售信息暂未收集",
      delivery: finalAnswers.delivery?.trim() || "交付信息暂未收集",
      management: finalAnswers.management?.trim() || "管理信息暂未收集",
      completedAt: new Date().toISOString(),
    };

    setMemory(normalizedMemory);
    clearDiagnosisStorage();
    saveToStorage(normalizedMemory, step, finalStepItems, stepPrompts);

    setIsLoading(true);
    const result = await apiPost<{ summary: string }>("/diagnosis/next-question", {
      role,
      tenantName: normalizedMemory.tenantName,
      industry: normalizedMemory.industry,
      city: normalizedMemory.city,
      stepKey: "summary",
      stepTitle: "诊断汇总",
      roundIndex: questions.length,
      totalRounds: questions.length,
      answers: finalAnswers,
    });
    setIsLoading(false);

    setShowReport(true);

    // Generate share link
    const encoded = encodeShareData({ role, tenantName, industry, city });
    setShareUrl(`${window.location.origin}/diagnosis?d=${encoded}`);
  }

  function handleCopyLink() {
    void navigator.clipboard.writeText(shareUrl);
    setMessage("链接已复制到剪贴板，可以发给思潼帮你做诊断");
    setTimeout(() => setMessage(""), 3000);
  }

  function handleRestart() {
    clearDiagnosisStorage();
    setMemory(null);
    setStep(0);
    setStepItems({});
    setStepPrompts({});
    setDraftAnswer("");
    setDynamicPrompt("");
    setMessage("");
    setShowReport(false);
    setMode("landing");
    setHasExistingSession(false);
  }

  // ── Render: Landing Page (3 modes) ──

  if (mode === "landing") {
    return (
      <div className="baoluDiagnosisSurface">
        {showConfirmRestart && (
          <ConfirmDialog
            title="重新开始诊断？"
            message="你有一个未完成的诊断会话，重新开始会丢失之前的回答。"
            onConfirm={startNewSession}
            onCancel={() => setShowConfirmRestart(false)}
          />
        )}

        <section className="diagnosisLanding">
          <div className="landingHero">
            <img src={sitongChiefAvatar} alt="思潼" className="landingAvatar" />
            <h1 className="landingTitle">思潼 AI 经营诊断</h1>
            <p className="landingSubtitle">
              像微信一对一聊天一样，把经营情况聊清楚。<br />
              聊完后形成经营记忆和AI能力入口。
            </p>
          </div>

          <div className="landingCards">
            {/* Mode A: Shareable link */}
            <div className="landingCard">
              <div className="landingCardIcon">🔗</div>
              <h3>可分享链接诊断</h3>
              <p>填写行业和城市，生成一个思潼诊断链接发给客户。客户打开后像跟思潼一对一聊天一样完成诊断。</p>
              <button className="primaryAction" onClick={() => setMode("register")}>
                生成诊断链接
              </button>
            </div>

            {/* Mode B: Resume */}
            <div className="landingCard">
              <div className="landingCardIcon">📋</div>
              <h3>继续未完成的诊断</h3>
              <p>上次诊断还没聊完？从这里继续。</p>
              {hasExistingSession ? (
                <button className="outlineAction" onClick={handleResume}>
                  继续诊断
                </button>
              ) : (
                <p className="softText">没有未完成的诊断会话</p>
              )}
            </div>

            {/* Mode C: AI private chat */}
            <div className="landingCard">
              <div className="landingCardIcon">💬</div>
              <h3>AI 私聊诊断</h3>
              <p>选角色填简要信息，像跟思潼一对一聊天一样完成一轮诊断。所有问题卡片实时展示在右侧。</p>
              <button className="primaryAction" onClick={handleStartNew}>
                开始诊断
              </button>
            </div>
          </div>
        </section>
      </div>
    );
  }

  // ── Render: Register Page (from share link or mode A) ──

  if (mode === "register") {
    return (
      <div className="baoluDiagnosisSurface">
        <section className="diagnosisRegister">
          <div className="registerHeader">
            <img src={sitongChiefAvatar} alt="思潼" className="registerAvatar" />
            <h2>开始你的经营诊断</h2>
            <p>思潼会用微信聊天一样的方式，一步步了解你的经营情况</p>
          </div>

          <div className="registerForm">
            <div className="diagnosisRoleTabs" aria-label="选择角色">
              {roleOptions.map((option) => (
                <button
                  className={role === option.value ? "active" : ""}
                  key={option.value}
                  onClick={() => handleSelectRole(option.value)}
                >
                  <strong>{option.title}</strong>
                </button>
              ))}
            </div>

            <div className="formGridNew compactForm">
              <label>
                名称
                <input value={tenantName} onChange={(e) => setTenantName(e.target.value)} placeholder="你的品牌/名字" />
              </label>
              <label>
                行业
                <input value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="如：餐饮、知识付费、美业" />
              </label>
              <label>
                城市
                <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="如：杭州" />
              </label>
            </div>

            <button className="primaryAction fullWidth" onClick={handleEnterAfterRegister}>
              开始诊断
            </button>

            <button className="textLink" onClick={() => setMode("landing")}>
              ← 返回首页
            </button>
          </div>
        </section>
      </div>
    );
  }

  // ── Render: Chat Page (like chatgpt.com) ──

  const report = showReport && memory ? buildDiagnosisReport(memory) : null;

  return (
    <div className="baoluDiagnosisSurface diagnosisChatLayout">
      {/* Left sidebar - dimension cards */}
      <aside className="diagnosisSidebar">
        <div className="sidebarHeader">
          <img src={sitongChiefAvatar} alt="思潼" className="sidebarAvatar" />
          <div>
            <strong>思潼 AI诊断</strong>
            <p className="softText">{ROLE_LABELS[role]}</p>
          </div>
        </div>

        <div className="dimensionCards">
          {questions.map((q) => {
            const item = Object.values(stepItems).find((v) => v.key === q.key);
            return (
              <DimensionCard
                key={q.key}
                dim={q.key}
                label={DIMENSION_LABELS[q.key]}
                chatItem={item}
                isActive={currentQuestion?.key === q.key}
                onClick={() => {
                  // Navigate to the step of the first matching item or stay
                  const idx = questions.findIndex((qq) => qq.key === q.key);
                  if (idx >= 0 && idx <= step) setStep(idx);
                }}
              />
            );
          })}
        </div>

        {showReport && (
          <button className="textLink sidebarReset" onClick={handleRestart}>
            开始新的诊断
          </button>
        )}
      </aside>

      {/* Main chat area */}
      <main className="diagnosisMain">
        {!showReport ? (
          <>
            {/* Chat header */}
            <div className="chatHeader">
              <div className="chatHeaderInfo">
                <strong>{tenantName || ROLE_LABELS[role]}</strong>
                <span className="softText">{industry || "未填写行业"} · {city || "未填写城市"}</span>
              </div>
              <span className="stepBadge">第 {step + 1}/{questions.length} 轮</span>
            </div>

            {/* Chat messages */}
            <div className="chatMessages">
              {/* Welcome message */}
              <div className="chatBubble advisor">
                <img src={sitongChiefAvatar} alt="思潼" className="bubbleAvatar" />
                <div className="bubbleContent">
                  <p>你好！我是思潼，你的AI经营诊断助手。</p>
                  <p>我会像微信聊天一样，按获客、销售、交付、管理的逻辑一轮一轮追问。一次只问一个问题，你一句一句回答就好。</p>
                </div>
              </div>

              {/* Previous rounds */}
              {Array.from({ length: step }, (_, i) => {
                const item = stepItems[i];
                if (!item) return null;
                return (
                  <div key={i}>
                    <div className="chatBubble advisor">
                      <img src={sitongChiefAvatar} alt="思潼" className="bubbleAvatar" />
                      <div className="bubbleContent">
                        <p>{item.question}</p>
                      </div>
                    </div>
                    <div className="chatBubble user">
                      <div className="bubbleContent">
                        <p>{item.answer}</p>
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Current question */}
              <div className="chatBubble advisor">
                <img src={sitongChiefAvatar} alt="思潼" className="bubbleAvatar" />
                <div className="bubbleContent">
                  {isLoading ? (
                    <p className="typingIndicator">思潼正在思考…</p>
                  ) : (
                    <p>{currentPrompt}</p>
                  )}
                </div>
              </div>

              {/* User's saved answer */}
              {currentSavedAnswer.trim() && (
                <div className="chatBubble user">
                  <div className="bubbleContent">
                    <p>{currentSavedAnswer}</p>
                  </div>
                </div>
              )}
            </div>

            {/* Input area */}
            <div className="chatInputArea">
              {message && <div className="noticeBox">{message}</div>}
              <div className="chatInputRow">
                <input
                  ref={inputRef}
                  type="text"
                  className="chatInput"
                  placeholder="输入你的回答…"
                  value={draftAnswer}
                  onChange={(e) => setDraftAnswer(e.target.value)}
                  onKeyDown={handleKeyDown}
                />
                <button className="primarySm" onClick={handleNext} disabled={isLoading}>
                  {canGoNext ? "下一轮 →" : "完成诊断 ✓"}
                </button>
              </div>
              <div className="chatNavRow">
                {step > 0 && (
                  <button className="textLink" onClick={handlePrevious}>
                    ← 上一轮
                  </button>
                )}
                <span className="softText">
                  {DIMENSION_LABELS[currentQuestion?.key]}
                </span>
              </div>
            </div>
          </>
        ) : report ? (
          /* Report view */
          <div className="diagnosisReport">
            <div className="reportHeader">
              <img src={sitongChiefAvatar} alt="思潼" className="reportAvatar" />
              <h2>诊断报告</h2>
              <p className="softText">{report.positioning}</p>
            </div>

            <div className="reportSections">
              <div className="reportItem">
                <h4>目标客户</h4>
                <p>{report.customer}</p>
              </div>
              <div className="reportItem">
                <h4>获客诊断</h4>
                <p>{report.acquisition}</p>
              </div>
              <div className="reportItem">
                <h4>销售诊断</h4>
                <p>{report.sales}</p>
              </div>
              <div className="reportItem">
                <h4>交付诊断</h4>
                <p>{report.delivery}</p>
              </div>
              <div className="reportItem">
                <h4>管理诊断</h4>
                <p>{report.management}</p>
              </div>
            </div>

            <WeaknessComparisonMatrix
              tenantName={memory?.tenantName || report.positioning}
              tenantRole={memory?.role || "local_business"}
              scores={deriveScoresFromAnswers({
                acquisition: report.acquisition,
                delivery: report.delivery,
                management: report.management,
              })}
            />

            <div className="reportActions">
              {shareUrl && (
                <button className="primaryAction" onClick={handleCopyLink}>
                  📋 复制诊断链接
                </button>
              )}
              <button className="outlineAction" onClick={handleRestart}>
                开始新的诊断
              </button>
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}

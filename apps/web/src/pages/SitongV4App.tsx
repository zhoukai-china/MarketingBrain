import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { v4Entries, v4EntryList, type V4EntryConfig, type V4EntryId } from "../data/v4Entries";

const defaultApiBase = (() => {
  if (typeof window !== "undefined" && window.location.hostname === "localhost") {
    return "http://localhost:3011";
  }
  const basePath = (import.meta.env.BASE_URL as string | undefined) ?? "/";
  const normalizedBase = basePath.startsWith("/") ? basePath : `/${basePath}`;
  return `${normalizedBase.replace(/\/$/, "")}/api`;
})();

const apiBase = import.meta.env.VITE_API_BASE_URL ?? defaultApiBase;
const appBasePath = (import.meta.env.BASE_URL ?? "/").replace(/\/+$/, "");
const profileStorageKey = "sitong_v4_shared_profile";

type PageId = "home" | "entry" | "chat" | "dashboard" | "pricing" | "cases";

interface RouteState {
  page: PageId;
  entryId?: V4EntryId;
}

interface SharedProfile {
  businessName: string;
  industry: string;
  city: string;
  currentGoal: string;
  contact: string;
}

interface V4Message {
  id: string;
  role: "sitong" | "user" | "system";
  content: string;
  preview?: {
    title: string;
    items: string[];
  };
}

interface CsvResult {
  fileName: string;
  rowCount: number;
  fields: string[];
  missing: string[];
  sample: Record<string, string>[];
}

interface GenerationState {
  step: number;
  progress: number;
}

const generationSteps = ["理解你的情况", "整理经营卡点", "生成诊断预览", "拆解下一步任务"];

const defaultProfile: SharedProfile = {
  businessName: "",
  industry: "",
  city: "",
  currentGoal: "",
  contact: ""
};

export function SitongV4App() {
  const [route, setRoute] = useState<RouteState>(() => parseRoute(window.location.pathname));
  const [token, setToken] = useState(() => localStorage.getItem("store_os_token") ?? "");
  const [profile, setProfile] = useState<SharedProfile>(() => loadSharedProfile());
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const onPop = () => setRoute(parseRoute(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    localStorage.setItem(profileStorageKey, JSON.stringify(profile));
  }, [profile]);

  const currentEntry = route.entryId ? v4Entries[route.entryId] : undefined;

  function navigate(nextRoute: RouteState) {
    const path = routeToPath(nextRoute);
    window.history.pushState({}, "", path);
    setRoute(nextRoute);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function startDevLogin(entry: V4EntryConfig) {
    setNotice("正在创建体验工作区...");
    try {
      const res = await fetch(`${apiBase}/auth/dev-login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantRole: entry.id === "franchise" ? "chain_brand" : "local_business",
          tenantName: profile.businessName || "思潼体验工作区",
          industry: profile.industry || undefined,
          city: profile.city || undefined
        })
      });
      const data = await res.json();
      if (!res.ok || !data.token) {
        setNotice(data.message ?? "登录失败，请稍后重试。");
        return;
      }
      localStorage.setItem("store_os_token", data.token);
      localStorage.setItem("store_os_tenant_role", entry.id === "franchise" ? "chain_brand" : "local_business");
      localStorage.setItem("store_os_tenant_name", profile.businessName || "思潼体验工作区");
      setToken(data.token);
      setNotice("已进入体验工作区，思潼可以开始做诊断和交付。");
    } catch {
      setNotice("暂时连不上后端，先看页面流程；服务恢复后可继续诊断和生成任务。");
    }
  }

  return (
    <div className="sitongV4Root">
      <header className="v4Topbar">
        <button className="v4Brand" onClick={() => navigate({ page: "home" })}>
          <span>思潼</span>
          <strong>思潼AI 行业智能体平台</strong>
        </button>
        <nav aria-label="业务类型导航">
          {v4EntryList.map((entry) => (
            <button
              key={entry.id}
              className={currentEntry?.id === entry.id ? "active" : ""}
              onClick={() => navigate({ page: "entry", entryId: entry.id })}
            >
              {entry.entryName.replace("入口", "")}
            </button>
          ))}
        </nav>
        <div className="v4Session">
          <span className={token ? "online" : ""}>{token ? "工作区已连接" : "访客预览"}</span>
        </div>
      </header>

      {notice && (
        <div className="v4Notice">
          <span>{notice}</span>
          <button onClick={() => setNotice("")}>知道了</button>
        </div>
      )}

      {route.page === "home" && <HomeView profile={profile} setProfile={setProfile} navigate={navigate} />}
      {currentEntry && route.page === "entry" && (
        <EntryLanding entry={currentEntry} profile={profile} setProfile={setProfile} navigate={navigate} onLogin={startDevLogin} token={token} />
      )}
      {currentEntry && route.page === "chat" && (
        <ChatView key={currentEntry.id} entry={currentEntry} profile={profile} token={token} navigate={navigate} onLogin={startDevLogin} />
      )}
      {currentEntry && route.page === "dashboard" && <DashboardView entry={currentEntry} navigate={navigate} />}
      {currentEntry && route.page === "pricing" && <PricingView entry={currentEntry} navigate={navigate} onLogin={startDevLogin} token={token} />}
      {currentEntry && route.page === "cases" && <CasesView entry={currentEntry} navigate={navigate} />}
    </div>
  );
}

function HomeView({
  profile,
  setProfile,
  navigate
}: {
  profile: SharedProfile;
  setProfile: (profile: SharedProfile) => void;
  navigate: (route: RouteState) => void;
}) {
  return (
    <main className="v4Main">
      <section className="v4HeroBand">
        <div>
          <p className="v4Eyebrow">获客成交诊断</p>
          <h1>先找卡点，再给下一步行动清单。</h1>
          <p>
            思潼会把获客、承接、成交和复盘放在一次对话里，先判断最卡的一环，再拆成今天就能开始做的任务。
          </p>
        </div>
        <SharedProfilePanel profile={profile} setProfile={setProfile} compact />
      </section>

      <section className="v4EntryGrid" aria-label="选择入口">
        {v4EntryList.map((entry) => (
          <article key={entry.id} className="v4EntryCard">
            <span>{entry.cycleDays} 天闭环</span>
            <h2>{entry.heroTitle}</h2>
            <p>{entry.heroSubtitle}</p>
            <dl>
              <div>
                <dt>适合谁</dt>
                <dd>{entry.targetUser}</dd>
              </div>
              <div>
                <dt>体验积分</dt>
                <dd>{entry.trialCreditsLabel}</dd>
              </div>
            </dl>
            <div className="v4CardActions">
              <button className="v4PrimaryBtn" onClick={() => navigate({ page: "chat", entryId: entry.id })}>
                {entry.cta}
              </button>
              <button className="v4GhostBtn" onClick={() => navigate({ page: "entry", entryId: entry.id })}>
                查看工作台
              </button>
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}

function EntryLanding({
  entry,
  profile,
  setProfile,
  navigate,
  onLogin,
  token
}: {
  entry: V4EntryConfig;
  profile: SharedProfile;
  setProfile: (profile: SharedProfile) => void;
  navigate: (route: RouteState) => void;
  onLogin: (entry: V4EntryConfig) => void;
  token: string;
}) {
  return (
    <main className="v4Main">
      <EntryTabs entry={entry} active="entry" navigate={navigate} />
      <section className="v4HeroBand entryHero">
        <div>
          <p className="v4Eyebrow">{entry.entryName} · 思潼陪跑</p>
          <h1>{entry.heroTitle}</h1>
          <p>{entry.heroSubtitle}</p>
          <div className="v4HeroActions">
            <button className="v4PrimaryBtn" onClick={() => navigate({ page: "chat", entryId: entry.id })}>
              {entry.cta}
            </button>
            <button className="v4GhostBtn" onClick={() => navigate({ page: "dashboard", entryId: entry.id })}>
              看 {entry.cycleDays} 天工作台
            </button>
            {!token && (
              <button className="v4QuietBtn" onClick={() => onLogin(entry)}>
                创建体验工作区
              </button>
            )}
          </div>
        </div>
        <div className="v4ChatPreview">
          <span>思潼开场</span>
          <p>{entry.greeting}</p>
        </div>
      </section>

      <SharedProfilePanel profile={profile} setProfile={setProfile} />
      <WorkflowSection entry={entry} />
      <TimelineSection entry={entry} />
      <KpiSection entry={entry} />
      <section className="v4TwoColumn">
        <TaskBoard entry={entry} />
        <OutcomePanel entry={entry} />
      </section>
    </main>
  );
}

function ChatView({
  entry,
  profile,
  token,
  navigate,
  onLogin
}: {
  entry: V4EntryConfig;
  profile: SharedProfile;
  token: string;
  navigate: (route: RouteState) => void;
  onLogin: (entry: V4EntryConfig) => void;
}) {
  const [messages, setMessages] = useState<V4Message[]>(() => [
    { id: "hello", role: "sitong", content: entry.greeting, preview: { title: "当前流程", items: entry.workflow.map((step) => step.title) } }
  ]);
  const [input, setInput] = useState(entry.startPrompt);
  const [busy, setBusy] = useState(false);
  const [generation, setGeneration] = useState<GenerationState | null>(null);
  const [creditModal, setCreditModal] = useState(false);
  const [remainingCredits, setRemainingCredits] = useState<number | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, generation]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setBusy(true);
    setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: "user", content: text }]);

    try {
      await playGeneration();
      const res = await fetch(`${apiBase}/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          input: text,
          entry: entry.id,
          context: {
            sharedProfile: profile,
            cycleDays: entry.cycleDays,
            skillMapping: entry.skillMapping
          }
        })
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 402) {
        setCreditModal(true);
        setMessages((prev) => [
          ...prev,
          {
            id: `c-${Date.now()}`,
            role: "system",
            content: `该动作需要积分。${entry.trialCreditsLabel}，你可以先进入定价页确认充值或月度方案。`
          }
        ]);
        return;
      }
      if (!res.ok) {
        setMessages((prev) => [
          ...prev,
          {
            id: `e-${Date.now()}`,
            role: "sitong",
            content: data.message ?? "这次没有处理成功。我先把需求记录下来，你可以稍后重试。"
          }
        ]);
        return;
      }
      if (typeof data.remainingCredits === "number") setRemainingCredits(data.remainingCredits);
      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: "sitong",
          content: data.answer ?? data.reply ?? "我已经完成这一轮诊断，下一步可以拆任务或进入工作台。",
          preview: buildPreview(data.action, entry)
        }
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: `offline-${Date.now()}`,
          role: "sitong",
          content: "后端暂时没有连上。你的需求已经留在输入框里，服务恢复后可以继续生成诊断和任务。"
        }
      ]);
    } finally {
      setGeneration(null);
      setBusy(false);
    }
  }

  async function playGeneration() {
    for (let index = 0; index < generationSteps.length; index += 1) {
      setGeneration({ step: index, progress: Math.round(((index + 1) / generationSteps.length) * 100) });
      await delay(220);
    }
  }

  return (
    <main className="v4Main chatPage">
      <EntryTabs entry={entry} active="chat" navigate={navigate} />
      <section className="v4ChatShell">
        <aside className="v4ChatAside">
          <p className="v4Eyebrow">{entry.entryName}</p>
          <h2>{entry.cycleDays} 天闭环对话</h2>
          <CreditStrip entry={entry} remainingCredits={remainingCredits} />
          <button className="v4PrimaryBtn" onClick={() => onLogin(entry)}>
            {token ? "刷新工作区" : "创建体验工作区"}
          </button>
          <button className="v4GhostBtn" onClick={() => navigate({ page: "dashboard", entryId: entry.id })}>
            打开任务看板
          </button>
          <div className="v4MiniStack">
            {entry.workflow.map((step) => (
              <span key={step.id}>{step.title}</span>
            ))}
          </div>
        </aside>

        <div className="v4Conversation">
          <div className="v4MessageList">
            {messages.map((message) => (
              <article key={message.id} className={`v4Message ${message.role}`}>
                <strong>{message.role === "user" ? "你" : message.role === "system" ? "系统" : "思潼"}</strong>
                <p>{message.content}</p>
                {message.preview && (
                  <div className="v4PreviewCard">
                    <span>{message.preview.title}</span>
                    {message.preview.items.map((item) => (
                      <em key={item}>{item}</em>
                    ))}
                  </div>
                )}
              </article>
            ))}
            {generation && <GenerationPanel state={generation} />}
            <div ref={endRef} />
          </div>
          <div className="v4PromptChips">
            {[entry.startPrompt, "先帮我拆成今天能做的任务", "我有数据了，帮我复盘下一轮"].map((prompt) => (
              <button key={prompt} onClick={() => setInput(prompt)} disabled={busy}>
                {prompt}
              </button>
            ))}
          </div>
          <div className="v4Composer">
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
              placeholder="直接和思潼说你的情况..."
            />
            <button className="v4PrimaryBtn" onClick={() => void send()} disabled={busy}>
              {busy ? "思潼处理中" : "发送"}
            </button>
          </div>
        </div>
      </section>
      {creditModal && <CreditModal entry={entry} close={() => setCreditModal(false)} navigate={navigate} />}
    </main>
  );
}

function DashboardView({ entry, navigate }: { entry: V4EntryConfig; navigate: (route: RouteState) => void }) {
  const [csv, setCsv] = useState<CsvResult | null>(null);
  const [weeklyReport, setWeeklyReport] = useState<string[]>([]);

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!/\.(csv|tsv)$/i.test(file.name)) {
      setCsv({
        fileName: file.name,
        rowCount: 0,
        fields: [],
        missing: entry.csvRequiredFields,
        sample: []
      });
      return;
    }
    const text = await file.text();
    setCsv(parseCsv(file.name, text, entry.csvRequiredFields));
  }

  function buildWeeklyReport() {
    if (!csv || csv.missing.length > 0) return;
    setWeeklyReport([
      "本周先看进步：你已经把执行数据回流到思潼，闭环开始成立。",
      `本次共解析 ${csv.rowCount} 行数据，字段包含 ${csv.fields.join("、")}。`,
      `下一轮建议只盯 1-2 个红灯维度，不要全量重做 ${entry.cycleDays} 天计划。`,
      "行动清单：补齐低转化环节的话术，明天继续记录同一口径数据。"
    ]);
  }

  return (
    <main className="v4Main">
      <EntryTabs entry={entry} active="dashboard" navigate={navigate} />
      <section className="v4DashboardHeader">
        <div>
          <p className="v4Eyebrow">{entry.cycleDays} 天工作台</p>
          <h1>诊断、任务、数据、复盘放在同一个工作台。</h1>
        </div>
        <button className="v4PrimaryBtn" onClick={() => navigate({ page: "chat", entryId: entry.id })}>
          回到对话
        </button>
      </section>
      <TimelineSection entry={entry} compact />
      <section className="v4TwoColumn">
        <TaskBoard entry={entry} />
        <DataUploadPanel entry={entry} csv={csv} handleFile={handleFile} buildWeeklyReport={buildWeeklyReport} />
      </section>
      {weeklyReport.length > 0 && (
        <section className="v4ReportBand">
          <p className="v4Eyebrow">综合周报预览</p>
          <h2>执行情况 + 数据复盘 + 下周行动清单</h2>
          {weeklyReport.map((line) => (
            <p key={line}>{line}</p>
          ))}
          <div className="v4ReportActions">
            <button>查看 MD</button>
            <button>下载精美 Word</button>
            <button>下载 PDF</button>
            <button>拆任务</button>
          </div>
        </section>
      )}
    </main>
  );
}

function PricingView({
  entry,
  navigate,
  onLogin,
  token
}: {
  entry: V4EntryConfig;
  navigate: (route: RouteState) => void;
  onLogin: (entry: V4EntryConfig) => void;
  token: string;
}) {
  return (
    <main className="v4Main">
      <EntryTabs entry={entry} active="pricing" navigate={navigate} />
      <section className="v4PricingHeader">
        <p className="v4Eyebrow">积分 + 月度陪跑</p>
        <h1>{entry.priceLead}：{entry.monthlyOffer}</h1>
        <p>{entry.trialCreditsLabel}。最终赠送数量以开通页面显示为准。</p>
      </section>
      <section className="v4PricingGrid">
        <article className="v4PriceCard">
          <span>体验入口</span>
          <h2>{entry.trialCreditsLabel}</h2>
          <p>用于体验诊断、少量内容、话术和一次复盘。赠送数量待最终商定。</p>
          <button className="v4PrimaryBtn" onClick={() => onLogin(entry)}>
            {token ? "查看当前积分" : "创建体验工作区"}
          </button>
        </article>
        <article className="v4PriceCard">
          <span>按量充值</span>
          <h2>积分包</h2>
          {entry.rechargeOptions.map((option) => (
            <p key={option}>{option}</p>
          ))}
          <button className="v4GhostBtn" onClick={() => navigate({ page: "chat", entryId: entry.id })}>
            回到对话
          </button>
        </article>
        <article className="v4PriceCard featured">
          <span>{entry.priceLead}</span>
          <h2>{entry.monthlyOffer}</h2>
          <p>适合连续跑完诊断、交付、监督、复盘、再诊断的完整闭环。</p>
          <button className="v4PrimaryBtn">进入付费流程</button>
        </article>
      </section>
    </main>
  );
}

function CasesView({ entry, navigate }: { entry: V4EntryConfig; navigate: (route: RouteState) => void }) {
  return (
    <main className="v4Main">
      <EntryTabs entry={entry} active="cases" navigate={navigate} />
      <section className="v4ReservedCases">
        <p className="v4Eyebrow">案例展示区</p>
        <h1>{entry.entryName}案例正在整理中</h1>
        <p>后续会按行业、城市、阶段和复盘数据展示真实经营变化。</p>
        <div className="v4CaseSlots">
          {["诊断前", "方案执行", "数据复盘"].map((slot) => (
            <div key={slot}>
              <span>{slot}</span>
              <strong>待补充</strong>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

function SharedProfilePanel({
  profile,
  setProfile,
  compact = false
}: {
  profile: SharedProfile;
  setProfile: (profile: SharedProfile) => void;
  compact?: boolean;
}) {
  function update(key: keyof SharedProfile, value: string) {
    setProfile({ ...profile, [key]: value });
  }

  return (
    <section className={compact ? "v4ProfilePanel compact" : "v4ProfilePanel"}>
      <div>
        <p className="v4Eyebrow">经营档案</p>
        <h2>基础信息只需要填一次</h2>
      </div>
      <div className="v4ProfileGrid">
        <label>
          <span>主体名称</span>
          <input value={profile.businessName} onChange={(event) => update("businessName", event.target.value)} placeholder="例如：贴膜小子" />
        </label>
        <label>
          <span>行业</span>
          <input value={profile.industry} onChange={(event) => update("industry", event.target.value)} placeholder="例如：手机后市场" />
        </label>
        <label>
          <span>城市</span>
          <input value={profile.city} onChange={(event) => update("city", event.target.value)} placeholder="例如：广州" />
        </label>
        <label>
          <span>当前目标</span>
          <input value={profile.currentGoal} onChange={(event) => update("currentGoal", event.target.value)} placeholder="例如：提升同城线索" />
        </label>
      </div>
    </section>
  );
}

function EntryTabs({
  entry,
  active,
  navigate
}: {
  entry: V4EntryConfig;
  active: PageId;
  navigate: (route: RouteState) => void;
}) {
  const tabs: Array<{ page: PageId; label: string }> = [
    { page: "entry", label: "概览" },
    { page: "chat", label: "对话" },
    { page: "dashboard", label: "工作台" },
    { page: "pricing", label: "定价" },
    { page: "cases", label: "案例" }
  ];
  return (
    <nav className="v4Tabs" aria-label={`${entry.entryName}页面`}>
      {tabs.map((tab) => (
        <button key={tab.page} className={active === tab.page ? "active" : ""} onClick={() => navigate({ page: tab.page, entryId: entry.id })}>
          {tab.label}
        </button>
      ))}
    </nav>
  );
}

function WorkflowSection({ entry }: { entry: V4EntryConfig }) {
  return (
    <section className="v4Section">
      <div className="v4SectionHeader">
        <p className="v4Eyebrow">五步陪跑</p>
        <h2>先聊清楚问题，再把行动安排到每天。</h2>
      </div>
      <div className="v4WorkflowGrid">
        {entry.workflow.map((step, index) => (
          <article key={step.id} className="v4WorkflowStep">
            <span>{String(index + 1).padStart(2, "0")}</span>
            <h3>{step.title}</h3>
            <p>{step.userSense}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function TimelineSection({ entry, compact = false }: { entry: V4EntryConfig; compact?: boolean }) {
  return (
    <section className={compact ? "v4Section compactTimeline" : "v4Section"}>
      <div className="v4SectionHeader">
        <p className="v4Eyebrow">{entry.cycleDays} 天时间线</p>
        <h2>每个阶段都有下一步，不让方案停在纸面。</h2>
      </div>
      <div className="v4Timeline">
        {entry.timeline.map((item) => (
          <article key={item.day}>
            <span>{item.day}</span>
            <h3>{item.title}</h3>
            <p>{item.focus}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function KpiSection({ entry }: { entry: V4EntryConfig }) {
  return (
    <section className="v4Section">
      <div className="v4SectionHeader">
        <p className="v4Eyebrow">KPI 看板</p>
        <h2>不同业务看不同指标，数据都会沉淀到同一份经营档案。</h2>
      </div>
      <div className="v4KpiGrid">
        {entry.kpis.map((kpi) => (
          <article key={kpi.key}>
            <strong>{kpi.label}</strong>
            <span>{kpi.source}</span>
          </article>
        ))}
      </div>
    </section>
  );
}

function TaskBoard({ entry }: { entry: V4EntryConfig }) {
  const groups = ["AI", "老板", "团队"] as const;
  return (
    <section className="v4TaskBoard">
      <p className="v4Eyebrow">监督落地</p>
      <h2>分角色任务列表</h2>
      <div className="v4TaskColumns">
        {groups.map((group) => (
          <div key={group}>
            <h3>{group}</h3>
            {entry.tasks.filter((task) => task.role === group).map((task) => (
              <article key={task.title} className={`v4Task ${task.status}`}>
                <strong>{task.title}</strong>
                <span>{task.due}</span>
              </article>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

function OutcomePanel({ entry }: { entry: V4EntryConfig }) {
  return (
    <section className="v4Mapping">
      <p className="v4Eyebrow">交付内容</p>
      <h2>每一轮都要留下能执行的东西</h2>
      {entry.workflow.map((step) => (
        <div key={step.id}>
          <strong>{step.title}</strong>
          <span>{step.userSense}</span>
        </div>
      ))}
    </section>
  );
}

function DataUploadPanel({
  entry,
  csv,
  handleFile,
  buildWeeklyReport
}: {
  entry: V4EntryConfig;
  csv: CsvResult | null;
  handleFile: (event: ChangeEvent<HTMLInputElement>) => void;
  buildWeeklyReport: () => void;
}) {
  return (
    <section className="v4UploadPanel">
      <p className="v4Eyebrow">数据上传 + 复盘</p>
      <h2>上传 CSV 后自动校验字段</h2>
      <label className="v4FileDrop">
        <input type="file" accept=".csv,.tsv,.xlsx" onChange={handleFile} />
        <span>选择 CSV / Excel 文件</span>
        <small>支持 CSV/TSV；Excel 数据可以先另存为 CSV 上传。</small>
      </label>
      <div className="v4RequiredFields">
        {entry.csvRequiredFields.map((field) => (
          <span key={field}>{field}</span>
        ))}
      </div>
      {csv && (
        <div className="v4CsvResult">
          <strong>{csv.fileName}</strong>
          <p>解析 {csv.rowCount} 行，识别字段：{csv.fields.join("、") || "暂无"}</p>
          {csv.missing.length > 0 ? (
            <p className="bad">缺少字段：{csv.missing.join("、")}</p>
          ) : (
            <p className="good">字段校验通过，可以开始自动复盘。</p>
          )}
        </div>
      )}
      <button className="v4PrimaryBtn" onClick={buildWeeklyReport} disabled={!csv || csv.missing.length > 0}>
        开始复盘
      </button>
    </section>
  );
}

function CreditStrip({ entry, remainingCredits }: { entry: V4EntryConfig; remainingCredits: number | null }) {
  const low = typeof remainingCredits === "number" && remainingCredits <= entry.creditWarningAt;
  return (
    <div className={low ? "v4CreditStrip warning" : "v4CreditStrip"}>
      <span>{entry.trialCreditsLabel}</span>
      <strong>{typeof remainingCredits === "number" ? `剩余 ${remainingCredits} 积分` : "余额登录后同步"}</strong>
    </div>
  );
}

function GenerationPanel({ state }: { state: GenerationState }) {
  return (
    <article className="v4Generation">
      <div>
        <strong>{generationSteps[state.step]}</strong>
        <span>{state.progress}%</span>
      </div>
      <div className="v4ProgressTrack">
        <i style={{ width: `${state.progress}%` }} />
      </div>
      <details>
        <summary>展开思潼正在做什么</summary>
        <p>我在整理你的行业、当前目标、主要卡点和下一步行动。</p>
      </details>
    </article>
  );
}

function CreditModal({
  entry,
  close,
  navigate
}: {
  entry: V4EntryConfig;
  close: () => void;
  navigate: (route: RouteState) => void;
}) {
  return (
    <div className="v4ModalLayer" role="dialog" aria-modal="true">
      <section className="v4Modal">
        <h2>积分不足</h2>
        <p>该动作需要积分。你可以充值积分继续，也可以开通月度方案跑完整闭环。</p>
        <div>
          {entry.rechargeOptions.map((option) => (
            <span key={option}>{option}</span>
          ))}
        </div>
        <button className="v4PrimaryBtn" onClick={() => navigate({ page: "pricing", entryId: entry.id })}>
          查看定价
        </button>
        <button className="v4GhostBtn" onClick={close}>
          先关闭
        </button>
      </section>
    </div>
  );
}

function parseCsv(fileName: string, text: string, required: string[]): CsvResult {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  const delimiter = lines[0]?.includes("\t") ? "\t" : ",";
  const fields = (lines[0] ?? "").split(delimiter).map((field) => field.trim());
  const sample = lines.slice(1, 4).map((line) => {
    const values = line.split(delimiter);
    return fields.reduce<Record<string, string>>((row, field, index) => {
      row[field] = values[index] ?? "";
      return row;
    }, {});
  });
  return {
    fileName,
    rowCount: Math.max(0, lines.length - 1),
    fields,
    missing: required.filter((field) => !fields.includes(field)),
    sample
  };
}

function buildPreview(action: string | undefined, entry: V4EntryConfig): V4Message["preview"] {
  if (action === "diagnose") {
    return {
      title: "下一步",
      items: [`进入 ${entry.cycleDays} 天工作台`, "拆成分角色任务", "生成内容或话术交付物"]
    };
  }
  if (action === "review") {
    return {
      title: "复盘闭环",
      items: ["生成综合周报", "识别 1-2 个红灯维度", "触发单点再诊断"]
    };
  }
  return {
    title: "完成态操作",
    items: ["查看 MD", "下载精美 Word", "下载 PDF", "拆任务"]
  };
}

function loadSharedProfile(): SharedProfile {
  try {
    const raw = localStorage.getItem(profileStorageKey);
    return raw ? { ...defaultProfile, ...JSON.parse(raw) } : defaultProfile;
  } catch {
    return defaultProfile;
  }
}

function parseRoute(pathname: string): RouteState {
  const normalizedPath = appBasePath && pathname.startsWith(appBasePath)
    ? pathname.slice(appBasePath.length) || "/"
    : pathname;
  const parts = normalizedPath.split("/").filter(Boolean);
  const [first, second] = parts[0] === "v4-preview" ? parts.slice(1) : parts;
  if (first === "local" || first === "franchise") {
    const page = second === "chat" || second === "dashboard" || second === "pricing" || second === "cases" ? second : "entry";
    return { page, entryId: first };
  }
  return { page: "home" };
}

function routeToPath(route: RouteState): string {
  const prefix = `${appBasePath || ""}/v4-preview`;
  if (route.page === "home" || !route.entryId) return `${prefix}/`;
  if (route.page === "entry") return `${prefix}/${route.entryId}/`;
  return `${prefix}/${route.entryId}/${route.page}/`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { apiPath, getAppPath, getAppRoutePath } from "../lib/api.js";
import {
  TopicSystemWorkbench,
  type TopicSystemGenerationRequest
} from "../components/acquisition/TopicSystemWorkbench.js";
import {
  BeautyContentTenWorkbench,
  createEmptyBeautyContentWorkflow,
  type BeautyContentWorkflowDraft
} from "../components/acquisition/BeautyContentTenWorkbench.js";
import {
  BeautyVideoDataReviewWorkbench,
  buildBeautyVideoReviewContentStructure,
  buildBeautyVideoReviewQuestion,
  createEmptyBeautyVideoReviewWorkflow,
  type BeautyVideoReviewWorkflowDraft
} from "../components/acquisition/BeautyVideoDataReviewWorkbench.js";
import {
  BeautyVideoContentReviewWorkbench,
  createEmptyBeautyVideoContentWorkflow,
  type BeautyVideoContentPreflight,
  type BeautyVideoContentWorkflowDraft
} from "../components/acquisition/BeautyVideoContentReviewWorkbench.js";
import {
  BeautyLiveReviewWorkbench,
  buildBeautyLiveReviewQuestion,
  createEmptyBeautyLiveReviewWorkflow,
  type BeautyLiveReviewWorkflowDraft
} from "../components/acquisition/BeautyLiveReviewWorkbench.js";
import { BeautyXhsWorkbench } from "../components/acquisition/BeautyXhsWorkbench.js";
import { BeautyIndustryShell, type BeautyIndustryNavKey, type BeautyIndustryPublicBrand } from "../components/beauty-industry/BeautyIndustryShell.js";
import { BeautyIndustryDailyBrief } from "../components/beauty-industry/BeautyIndustryDailyBrief.js";

type BeautyBranch = "xhs" | "video" | "live";
type RunMode = "quick" | "professional";
type BeautyPlanningKey = "daily" | "knowledge" | "delivery" | "operations" | "viral-replication" | "text-video" | "image-video";
type BeautyView = "home" | "daily" | "acquisition-home" | "branch-home" | "video-review-home" | "workspace" | "profile" | "tasks" | "planning" | "not-found";
type BeautyRoute = { view: BeautyView; navKey: BeautyIndustryNavKey; pageTitle: string; path: string; branch?: BeautyBranch; toolName?: string; planningKey?: BeautyPlanningKey };
type OptionKey = "audience" | "project" | "platform" | "tone" | "visualStyle" | "budgetPreview" | "contentStructure" | "shootingRequirements" | "edlRequirements" | "imageCount" | "parsedEvidence" | "parseStatus" | "sourceFilename" | "priceBoundary" | "customerConcern" | "communicationStage" | "allowedNextAction" | "city" | "storeFacts" | "contentAngle" | "prohibitedContent";
type ProfessionalOptions = Record<Exclude<OptionKey, "imageCount" | "parseStatus">, string> & { imageCount: 1 | 3; parseStatus: "" | "parsed" | "failed" };
type FormField = { key: OptionKey; label: string; placeholder?: string; type?: "text" | "imageCount" };
type TaskDefinition = { name: string; label: string; hint: string; stage: string; credits: number; formSchema: FormField[]; unavailableReason?: string; pendingValidation?: boolean };
type BranchDefinition = { label: string; summary: string; tasks: TaskDefinition[]; planned?: string[] };

const BRANCH_DEFINITIONS: Record<BeautyBranch, BranchDefinition> = {
  xhs: { label: "图文获客", summary: "一次生成小红书标题、正文、标签和三张商业摄影感配图；图片须另经积分确认。", tasks: [
    { name: "beauty.xiaohongshu_package", label: "小红书图文生成", hint: "文字与配图方向保存在同一任务中", stage: "图文生成", credits: 8, formSchema: [
      { key: "audience", label: "目标顾客", placeholder: "留空则沿用美业经营档案" }, { key: "project", label: "本次项目", placeholder: "只填写已确认项目" },
      { key: "city", label: "本次城市" }, { key: "storeFacts", label: "门店事实" }, { key: "contentAngle", label: "内容角度" },
      { key: "tone", label: "表达风格", placeholder: "例如：真实、温和、专业" }, { key: "visualStyle", label: "图片风格", placeholder: "例如：干净自然、不出现顾客正脸" }, { key: "prohibitedContent", label: "明确禁用内容" }, { key: "imageCount", label: "配图数量", type: "imageCount" }
    ] }
  ] },
  video: { label: "视频获客", summary: "围绕选题、内容制作和证据复盘组织独立工作区；每项能力都有稳定路由。", tasks: [
    { name: "beauty.topic_ideas", label: "选题系统", hint: "获客目标 + 四来源候选 + 三关筛选 + TOP10", stage: "选题", credits: 10, formSchema: [] },
    { name: "beauty.content_ten_pack", label: "内容系统", hint: "当前交付仍沿用正式 V5 十件结构，不拆成十个导航入口", stage: "内容", credits: 12, formSchema: [
      { key: "audience", label: "目标顾客" }, { key: "project", label: "本次项目" }, { key: "platform", label: "发布平台" }, { key: "tone", label: "表达语气" },
      { key: "contentStructure", label: "内容要求", placeholder: "例如：问题切入—门店建议—咨询承接" }, { key: "shootingRequirements", label: "拍摄约束", placeholder: "例如：不出现顾客正脸" }, { key: "edlRequirements", label: "时长与剪辑要求", placeholder: "例如：60秒竖屏；只用于内容系统当前十件交付" }
    ] },
    { name: "beauty.video_data_review", label: "视频数据复盘", hint: "上传 CSV/Excel，解析成功后分析播放、完播、互动和转化", stage: "数据复盘", credits: 15, formSchema: [{ key: "platform", label: "数据平台" }, { key: "contentStructure", label: "指标口径与缺失字段", placeholder: "例如：播放、完播、点赞、评论、咨询；缺失项请保留" }] },
    { name: "beauty.video_content_review", label: "视频内容复盘", hint: "基于当前视频的真实口播与画面证据，生成结构化内容复盘", stage: "内容复盘", credits: 12, formSchema: [] }
  ], planned: ["文生视频（数字人方向 · 规划中）", "图生视频（数字人方向 · 规划中）"] },
  live: { label: "直播获客", summary: "直播话术 → 直播复盘；策划要素包含在话术任务内。", tasks: [
    { name: "beauty.live_script", label: "直播话术", hint: "包含流程、项目讲解、互动与到店承接", stage: "话术", credits: 12, formSchema: [{ key: "audience", label: "直播受众" }, { key: "project", label: "讲解项目" }, { key: "tone", label: "主播语气" }, { key: "contentStructure", label: "直播策划要素", placeholder: "时长、环节、互动、咨询承接；未确认价格请留空" }] },
    { name: "beauty.live_review", label: "直播复盘", hint: "分别核验直播数据、场次转写和原话术计划，按固定八模块复盘", stage: "直播复盘", credits: 15, formSchema: [] }
  ] }
};
const SALES_TASK: TaskDefinition = { name: "beauty.sales_advice", label: "美业销售", hint: "快速模式先给一条通用初步回复；专业模式基于完整事实生成个性化异议策略", stage: "销售建议", credits: 12, formSchema: [
  { key: "project", label: "本次项目", placeholder: "已确认的服务项目" },
  { key: "priceBoundary", label: "已确认价格或优惠边界", placeholder: "例如：只可发送价目表，不承诺额外优惠" },
  { key: "customerConcern", label: "顾客原话或主要顾虑", placeholder: "填写顾客已明确表达的原话或顾虑" },
  { key: "communicationStage", label: "沟通阶段", placeholder: "例如：首次咨询、到店后未决定" },
  { key: "allowedNextAction", label: "允许的下一步动作", placeholder: "例如：发送已确认项目说明；询问是否愿意预约" },
  { key: "tone", label: "沟通语气", placeholder: "例如：自然、简短、不施压" }
] };

type BeautyOverview = { productName: string; brand: BeautyIndustryPublicBrand; localAcceptance: boolean; executionMode: "controlled_mock" | "configured_provider"; creditBalance: number; workspaceScope: string; tenantRole: "owner" | "admin" | "member"; recommendationMode: "start" | "today"; enterpriseBase: { enterpriseName: string; brandName: string; city: string | null; storeCount: number | null; source: "account" }; todayActions: Array<{ id: string; title: string; reason: string; toolName?: string; profileAction?: boolean }>; lastProgress: { id: string; capabilityId?: string; usageChannel?: string; createdAt: string } | null; tools: Array<{ name: string; description: string }> };
type BeautyStructuredDeliveryBase = {
  version: string;
  preview: boolean;
  customerDeliverable: { copyMarkdown: string; titles?: string[]; body?: string; tags?: string[]; engagement?: string };
  productionNotes: { markdown: string };
  auditReceipt: { markdown: string };
};
type BeautyXhsDelivery = BeautyStructuredDeliveryBase & {
  version: "beauty-xhs-delivery-v2";
  customerDeliverable: { copyMarkdown: string; titles: string[]; body: string; tags: string[]; engagement: string };
};
type BeautySalesDelivery = BeautyStructuredDeliveryBase & {
  version: "beauty-sales-delivery-v1";
  resultType: "quick_response" | "professional_advice";
  customerDeliverable: BeautyStructuredDeliveryBase["customerDeliverable"] & { primaryReply: string; rationale: string; likelyNextReply: string; nextQuestion: string };
};
type BeautyStructuredDelivery = BeautyXhsDelivery | BeautySalesDelivery | BeautyStructuredDeliveryBase;
type BeautyXhsTaskSnapshot = { version: "beauty-xhs-task-snapshot-v1"; themeAndPurpose: string; project: string; audience: string; city: string; storeFacts: string; contentAngle: string; tone: string; overallVisualRequirements: string; confirmedFacts: string; prohibitedContent: string };
type BeautyRun = { id: string; capabilityId?: string; skillId: string; abilityUsed?: string; input?: string; output: string; creditCost: number; usageChannel?: string; conversationId?: string; createdAt: string; structuredDelivery?: BeautyStructuredDelivery; taskSnapshot?: BeautyXhsTaskSnapshot };
type BeautyConnection = { id: string; productCode?: string | null; status: string; lastUsedAt?: string | null; createdAt: string };
type BeautyConnections = { enabled: boolean; connections: BeautyConnection[] };
type BeautyMediaBatchStatus = "processing" | "succeeded" | "quality_failed";
type BeautyXhsImagePlan = { version: "beauty-xhs-image-plan-v2"; textSkillVersion: string; imageCount: 1 | 3; ratio: "3:4"; linkedTitle: string; customerBoundary: string; rightsBoundary: string; directions: Array<{ index: number; role: "cover" | "content" | "engagement"; label: string; purpose: string; composition: string; textStrategy: string }> };
type BeautyMediaQualityEvidence = { detectorType: string; reason: string; decision: "rejected" | "manual_review_required"; confidence: number; bbox: { x: number; y: number; width: number; height: number }; metrics: Record<string, string | number | boolean> };
type BeautyMediaJob = { id: string; runId?: string; status: string; technicalStatus: string; batchStatus: BeautyMediaBatchStatus; qualityStatus: "pending_review" | "passed" | "rejected" | "manual_review_required"; qualityReasons: string[]; qualityEvidence: BeautyMediaQualityEvidence[]; customerUsable: boolean; progress: number; creditCost: number; billingStatus: string; assetStatus: string; outputUrl?: string; errorMessage?: string; failureStage?: string; failureCode?: string; failureRetryable: boolean; canCancel: boolean; canRecover: boolean; selectedTitle?: string; compositionStatus?: string; compositionVersion?: string; createdAt: string; updatedAt: string; model: string; provider: string };
type BeautyMediaQuote = { runId: string; imageCount: 1 | 3; creditCost: number; canConfirm: boolean; existing: boolean; stateCode: string; retryEligible: boolean; retryOfJobId?: string; regenerationEligible?: boolean; regenerationOfJobId?: string; deliveryMode?: "real_provider_composed"; message: string; imagePlan: BeautyXhsImagePlan };
type BeautyProfile = { segment: "skin_management" | "hairdressing" | "nail_lash" | "scalp_hair_care" | "lifestyle_beauty" | "medical_beauty" | "tattoo_embroidery" | "body_spa" | "postpartum_care" | "makeup_styling" | "beauty_retail" | "other"; customSegment?: string; operationType: "single_store" | "chain_brand"; operatingStage: "startup" | "growth" | "stable" | "adjustment"; storeName?: string; city?: string; services: string[]; targetCustomers?: string; channels: string[]; acquisitionGoal?: string; factBoundaries: string; source: "user_confirmed"; confirmationStatus: "confirmed"; version: number; confirmedAt: string };
type ProfileDraft = { segment: BeautyProfile["segment"]; customSegment: string; operationType: BeautyProfile["operationType"]; operatingStage: BeautyProfile["operatingStage"]; storeName: string; city: string; services: string; targetCustomers: string; channels: string[]; otherChannel: string; acquisitionGoal: string; factBoundaries: string };
type SavedWorkspace = { branch: BeautyBranch; selectedTool: string; mode: RunMode; question: string; confirmedFacts: string; professionalOptions: ProfessionalOptions; contentWorkflow?: BeautyContentWorkflowDraft; videoReviewWorkflow?: BeautyVideoReviewWorkflowDraft; videoContentWorkflow?: BeautyVideoContentWorkflowDraft; liveReviewWorkflow?: BeautyLiveReviewWorkflowDraft; sourceRunId?: string; activeRunId?: string; savedAt: string };
type BeautyTopicWorkflow = {
  identity?: string;
  targetCustomer: string;
  acquisitionGoal: string;
  offer?: string;
  accountStage?: string;
  industry: string;
  benchmarkAccounts: string[];
  transcriptDocumentIds: string[];
  videoReviewId?: string;
  sourceSelection: { industry: boolean; benchmark: boolean; transcript: boolean; videoReview: boolean };
};

const EMPTY_OPTIONS: ProfessionalOptions = { audience: "", project: "", platform: "", tone: "", visualStyle: "", budgetPreview: "", contentStructure: "", shootingRequirements: "", edlRequirements: "", parsedEvidence: "", parseStatus: "", sourceFilename: "", priceBoundary: "", customerConcern: "", communicationStage: "", allowedNextAction: "", city: "", storeFacts: "", contentAngle: "", prohibitedContent: "", imageCount: 3 };
const EMPTY_PROFILE: ProfileDraft = { segment: "skin_management", customSegment: "", operationType: "single_store", operatingStage: "growth", storeName: "", city: "", services: "", targetCustomers: "", channels: [], otherChannel: "", acquisitionGoal: "", factBoundaries: "" };
const SEGMENTS: Record<BeautyProfile["segment"], string> = { skin_management: "皮肤管理", hairdressing: "美发", nail_lash: "美甲美睫", scalp_hair_care: "头疗养发", lifestyle_beauty: "生活美容", medical_beauty: "医疗美容", tattoo_embroidery: "纹绣/半永久", body_spa: "身体护理/SPA", postpartum_care: "产后护理", makeup_styling: "化妆造型", beauty_retail: "美妆零售", other: "其他/自定义" };
const CHANNELS = ["小红书", "抖音", "视频号", "朋友圈/社群", "直播", "线下到店", "其他"] as const;
const STAGES: Record<BeautyProfile["operatingStage"], string> = { startup: "起步期", growth: "增长期", stable: "稳定期", adjustment: "调整期" };
const BEAUTY_PLANNING_PAGES: Record<BeautyPlanningKey, { title: string; purpose: string; prerequisites: string[]; boundary: string }> = {
  daily: { title: "美业AI改造日报", purpose: "把已授权的经营资料、任务进展和异常信号整理成门店每日经营摘要。", prerequisites: ["明确日报可读取的数据源与指标口径", "完成租户级查看权限和脱敏规则", "建立日报结果与经营动作的回归 Eval"], boundary: "当前不会生成日报、读取未连接平台或推断门店经营结果。" },
  knowledge: { title: "美业知识问题", purpose: "基于当前租户已授权、可追溯的美业知识回答经营问题。", prerequisites: ["接入当前租户受控知识源", "完成引用、缺资料与跨租户硬门禁", "明确可回答和必须转人工确认的边界"], boundary: "当前不会检索客户私有知识、调用模型或把通用常识写成门店事实。" },
  delivery: { title: "美业专属交付", purpose: "承接已确认的美业项目交付进度、材料和验收结果。", prerequisites: ["定义交付对象、里程碑与验收合同", "确认负责人和租户权限", "建立失败、退回与历史恢复路径"], boundary: "当前没有可执行交付流程，不展示虚假项目、进度或完成按钮。" },
  operations: { title: "美业专属经营诊断", purpose: "围绕门店真实经营数据提供诊断、行动计划和复盘闭环。", prerequisites: ["确认经营数据源和指标口径", "建立诊断证据、建议和执行结果的边界", "完成租户隔离与业务回归"], boundary: "当前不会读取未连接数据、生成经营诊断或声称已执行任何动作。" },
  "text-video": { title: "文生视频", purpose: "把已确认内容资产转成可审阅的视频生成任务。", prerequisites: ["完成视频 Provider、存储和费用合同", "建立人物、版权和合规 Eval", "取得逐次付费授权与失败退款能力"], boundary: "当前不会创建视频任务、调用媒体 Provider、扣费或展示占位成片。" },
  "image-video": { title: "图生视频", purpose: "基于已授权图片和内容脚本生成可审阅的视频任务。", prerequisites: ["完成图片授权与资产租户隔离", "接入视频 Provider、费用和失败恢复", "建立画面一致性与合规 Eval"], boundary: "当前不会上传外部图片、创建视频任务、调用 Provider 或扣费。" },
  "viral-replication": { title: "爆款复刻", purpose: "未来基于已获授权的参考视频或链接、可核验画面、转写与数据证据，拆解可迁移结构并生成门店自己的创作方案。", prerequisites: ["取得参考素材或链接的明确使用授权", "完成画面、转写和数据证据核验", "建立原创改写、版权与平台合规 Eval"], boundary: "当前不会抓取未授权内容、复制他人素材、绕过平台、创建任务、调用 Provider、扣费或展示伪结果。" }
};
const CAPABILITY_TO_TOOL: Record<string, string> = { beauty_xiaohongshu_package: "beauty.xiaohongshu_package", topic_inspiration: "beauty.topic_ideas", content_plan: "beauty.content_ten_pack", video_data_review: "beauty.video_data_review", shooting_editing: "beauty.video_content_review", live_script: "beauty.live_script", live_review: "beauty.live_review", beauty_sales: "beauty.sales_advice" };

export function BeautyIndustryAcquisitionPage() {
  const initialRoute = readBeautyRoute();
  const [overview, setOverview] = useState<BeautyOverview | null>(null);
  const [history, setHistory] = useState<BeautyRun[]>([]);
  const [connections, setConnections] = useState<BeautyConnections | null>(null);
  const [profile, setProfile] = useState<BeautyProfile | null>(null);
  const [profileDraft, setProfileDraft] = useState<ProfileDraft>(EMPTY_PROFILE);
  const [profileOpen, setProfileOpen] = useState(false);
  const [currentRoute, setCurrentRoute] = useState<BeautyRoute>(initialRoute);
  const view = currentRoute.view;
  const [branch, setBranch] = useState<BeautyBranch>(initialRoute.branch ?? "xhs");
  const [workspaceModule, setWorkspaceModule] = useState<"acquisition" | "sales">(initialRoute.toolName === SALES_TASK.name ? "sales" : "acquisition");
  const [selectedTool, setSelectedTool] = useState(initialRoute.toolName ?? "beauty.xiaohongshu_package");
  const [mode, setMode] = useState<RunMode>("quick");
  const [question, setQuestion] = useState("");
  const [confirmedFacts, setConfirmedFacts] = useState("");
  const [professionalOptions, setProfessionalOptions] = useState(EMPTY_OPTIONS);
  const [contentWorkflow, setContentWorkflow] = useState<BeautyContentWorkflowDraft>(() => createEmptyBeautyContentWorkflow());
  const [videoReviewWorkflow, setVideoReviewWorkflow] = useState<BeautyVideoReviewWorkflowDraft>(() => createEmptyBeautyVideoReviewWorkflow());
  const [videoContentWorkflow, setVideoContentWorkflow] = useState<BeautyVideoContentWorkflowDraft>(() => createEmptyBeautyVideoContentWorkflow());
  const [liveReviewWorkflow, setLiveReviewWorkflow] = useState<BeautyLiveReviewWorkflowDraft>(() => createEmptyBeautyLiveReviewWorkflow());
  const [activeResult, setActiveResult] = useState<BeautyRun | null>(null);
  const [sourceRunId, setSourceRunId] = useState<string | undefined>();
  const [savedAt, setSavedAt] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [fileParsing, setFileParsing] = useState(false);
  const [videoPreflighting, setVideoPreflighting] = useState(false);
  const [mediaQuote, setMediaQuote] = useState<BeautyMediaQuote | null>(null);
  const [mediaJobs, setMediaJobs] = useState<BeautyMediaJob[]>([]);
  const [mediaBatchStatus, setMediaBatchStatus] = useState<BeautyMediaBatchStatus>("processing");
  const [mediaLoading, setMediaLoading] = useState(false);
  const [mediaObjectUrls, setMediaObjectUrls] = useState<Record<string, string>>({});
  const [mediaRetryRequested, setMediaRetryRequested] = useState(false);
  const [mediaRetryOfJobId, setMediaRetryOfJobId] = useState<string | undefined>();
  const abortRef = useRef<AbortController | null>(null);
  const requestInFlightRef = useRef(false);
  const requestIdRef = useRef<string | null>(null);
  const mediaRequestKeyRef = useRef<string | null>(null);
  const mediaConfirmInFlightRef = useRef(false);
  const videoPreflightRequestIdRef = useRef<string | null>(null);
  const restoredRef = useRef(false);
  const mediaLoadSequenceRef = useRef(0);
  const initialLoadStartedRef = useRef(false);
  const authHeaders = useMemo<Record<string, string>>(() => { const token = localStorage.getItem("store_os_token"); const value: Record<string, string> = {}; if (token) value.Authorization = `Bearer ${token}`; return value; }, []);
  const currentTask = workspaceModule === "sales" ? SALES_TASK : findTask(selectedTool) ?? BRANCH_DEFINITIONS[branch].tasks[0];
  const salesProfessionalMissing = currentTask.name === SALES_TASK.name && mode === "professional"
    ? [
        ["project", "本次项目"], ["priceBoundary", "已确认价格或优惠边界"], ["customerConcern", "顾客原话或主要顾虑"],
        ["communicationStage", "沟通阶段"], ["allowedNextAction", "允许的下一步动作"]
      ].filter(([key]) => !String(professionalOptions[key as OptionKey] ?? "").trim()).map(([, label]) => label)
    : [];
  const storageKey = overview?.workspaceScope ? `beauty-industry-workspace-v2:${overview.workspaceScope}` : null;

  useEffect(() => {
    if (!("Authorization" in authHeaders)) { redirectToBeautyLogin(); return; }
    if (!initialLoadStartedRef.current) {
      initialLoadStartedRef.current = true;
      void loadWorkspace();
    }
    const restoreRoute = () => applyBeautyRoute(readBeautyRoute());
    window.addEventListener("popstate", restoreRoute);
    return () => window.removeEventListener("popstate", restoreRoute);
  }, []);
  useEffect(() => { if (!loading) { setElapsed(0); return; } const started = Date.now(); const id = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1_000); return () => window.clearInterval(id); }, [loading]);
  useEffect(() => {
    if (!storageKey || !restoredRef.current) return;
    const persistedOptions = selectedTool === "beauty.video_data_review"
      ? { ...professionalOptions, parsedEvidence: "", parseStatus: "" as const, sourceFilename: "" }
      : professionalOptions;
    const persistedLiveReview = liveReviewWorkflow.parseStatus === "parsed"
      ? { ...liveReviewWorkflow, liveData: "", parseStatus: undefined, sourceFilename: undefined }
      : liveReviewWorkflow;
    const value: SavedWorkspace = { branch, selectedTool, mode, question, confirmedFacts, professionalOptions: persistedOptions, contentWorkflow, videoReviewWorkflow, videoContentWorkflow: { ...videoContentWorkflow, mediaPreflight: undefined }, liveReviewWorkflow: persistedLiveReview, sourceRunId, activeRunId: activeResult?.id, savedAt: new Date().toISOString() };
    const id = window.setTimeout(() => { localStorage.setItem(storageKey, JSON.stringify(value)); setSavedAt(value.savedAt); }, 250);
    return () => window.clearTimeout(id);
  }, [storageKey, branch, selectedTool, mode, question, confirmedFacts, professionalOptions, contentWorkflow, videoReviewWorkflow, videoContentWorkflow, liveReviewWorkflow, sourceRunId, activeResult?.id]);
  useEffect(() => {
    if (activeResult?.capabilityId === "beauty_xiaohongshu_package") void loadMediaPackage(activeResult.id);
    else {
      mediaLoadSequenceRef.current += 1;
      setMediaQuote(null); setMediaJobs([]); setMediaBatchStatus("processing");
      setMediaObjectUrls((current) => { Object.values(current).forEach(URL.revokeObjectURL); return {}; });
    }
  }, [activeResult?.id, activeResult?.capabilityId, professionalOptions.imageCount, professionalOptions.visualStyle, professionalOptions.prohibitedContent, mediaRetryRequested, mediaRetryOfJobId]);
  useEffect(() => () => { Object.values(mediaObjectUrls).forEach(URL.revokeObjectURL); }, [mediaObjectUrls]);

  async function loadWorkspace() {
    setInitialLoading(true); setLoadError("");
    try {
      // Authenticate before fanning out the remaining bootstrap calls. A stale
      // browser token should produce one observable 401 and a recoverable login,
      // not four parallel failures that leave the workspace in an error state.
      const overviewValue = await readJson<BeautyOverview>(await fetch(apiPath("/beauty-industry/acquisition"), { headers: authHeaders, cache: "no-store" }));
      const [historyValue, profileValue, connectionValue] = await Promise.all([
        readJson<{ runs: BeautyRun[] }>(await fetch(apiPath("/beauty-industry/acquisition/history"), { headers: authHeaders, cache: "no-store" })),
        readJson<{ profile: BeautyProfile | null }>(await fetch(apiPath("/beauty-industry/profile"), { headers: authHeaders, cache: "no-store" })),
        readJson<BeautyConnections>(await fetch(apiPath("/integrations/workbuddy/connections"), { headers: authHeaders, cache: "no-store" }))
      ]);
      setOverview(overviewValue); setHistory(historyValue.runs); setConnections({ ...connectionValue, connections: connectionValue.connections.filter((connection) => connection.productCode === "beauty-industry") }); setProfile(profileValue.profile); setProfileDraft(profileToDraft(profileValue.profile)); setProfileOpen(!profileValue.profile);
      restoreWorkspace(overviewValue.workspaceScope, historyValue.runs, profileValue.profile);
    } catch (reason) {
      if (reason instanceof ApiRequestError && reason.status === 401) {
        localStorage.removeItem("store_os_token");
        redirectToBeautyLogin();
        return;
      }
      setLoadError(friendlyError(reason, "美业经营工作台加载失败"));
    }
    finally { setInitialLoading(false); }
  }

  function restoreWorkspace(scope: string, runs: BeautyRun[], profileValue: BeautyProfile | null = profile) {
    const key = `beauty-industry-workspace-v2:${scope}`;
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || "null") as SavedWorkspace | null;
      if (parsed && BRANCH_DEFINITIONS[parsed.branch] && (taskBelongsToBranch(parsed.selectedTool, parsed.branch) || parsed.selectedTool === SALES_TASK.name)) {
        setWorkspaceModule(parsed.selectedTool === SALES_TASK.name ? "sales" : "acquisition"); setBranch(parsed.branch); setSelectedTool(parsed.selectedTool); setMode(parsed.mode); setQuestion(parsed.question); setConfirmedFacts(parsed.confirmedFacts); setProfessionalOptions({ ...EMPTY_OPTIONS, ...parsed.professionalOptions }); setContentWorkflow(parsed.contentWorkflow ? { ...createEmptyBeautyContentWorkflow(), ...parsed.contentWorkflow } : createContentWorkflowFromProfile(profileValue)); setVideoReviewWorkflow(parsed.videoReviewWorkflow ? { ...createEmptyBeautyVideoReviewWorkflow(), ...parsed.videoReviewWorkflow } : createVideoReviewWorkflowFromProfile(profileValue)); setVideoContentWorkflow(parsed.videoContentWorkflow ? { ...createEmptyBeautyVideoContentWorkflow(), ...parsed.videoContentWorkflow, mediaPreflight: undefined } : createVideoContentWorkflowFromProfile(profileValue)); setLiveReviewWorkflow(parsed.liveReviewWorkflow ? { ...createEmptyBeautyLiveReviewWorkflow(), ...parsed.liveReviewWorkflow, ...(parsed.liveReviewWorkflow.parseStatus === "parsed" ? { liveData: "", parseStatus: undefined, sourceFilename: undefined } : {}) } : createLiveReviewWorkflowFromProfile(profileValue)); setSourceRunId(parsed.sourceRunId); setSavedAt(parsed.savedAt);
        setActiveResult(runs.find((run) => run.id === parsed.activeRunId) ?? runs[0] ?? null); setNotice(parsed.selectedTool === "beauty.video_data_review" ? "已恢复复盘口径和已保存结果；浏览器不会保留本地数据文件，新复盘请重新选择文件。" : parsed.selectedTool === "beauty.video_content_review" ? "已恢复视频内容复盘资料；视频与预检回执未保留，请重新选择真实视频。视觉与 ASR 仍未调用。" : parsed.selectedTool === "beauty.live_review" ? "已恢复直播场次文字资料和已保存结果；本地数据文件及其解析内容未保留，新复盘请重新选择文件。" : "已恢复上次任务；当前分支、输入和结果均保持不变。");
      } else {
        setProfessionalOptions(readBeautyRoute().toolName === "beauty.xiaohongshu_package" ? createXhsOptionsFromProfile(profileValue) : EMPTY_OPTIONS);
        setActiveResult(runs[0] ?? null);
      }
    } catch {
      setProfessionalOptions(readBeautyRoute().toolName === "beauty.xiaohongshu_package" ? createXhsOptionsFromProfile(profileValue) : EMPTY_OPTIONS);
      setActiveResult(runs[0] ?? null);
    }
    applyBeautyRoute(readBeautyRoute(), runs);
    restoredRef.current = true;
  }

  function applyBeautyRoute(route: BeautyRoute, runs: BeautyRun[] = history) {
    setCurrentRoute(route);
    if (route.view !== "workspace" || !route.toolName) return;
    setSelectedTool(route.toolName);
    setWorkspaceModule(route.toolName === SALES_TASK.name ? "sales" : "acquisition");
    if (route.branch) setBranch(route.branch);
    const capabilityId = Object.entries(CAPABILITY_TO_TOOL).find(([, tool]) => tool === route.toolName)?.[0];
    if (capabilityId) setActiveResult(runs.find((run) => run.capabilityId === capabilityId) ?? null);
  }

  function navigateTo(path: string, route: BeautyRoute = readBeautyRoute(path)) {
    const target = getAppPath(path);
    if (window.location.pathname !== target) window.history.pushState({}, "", target);
    applyBeautyRoute(route);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openView(next: Exclude<BeautyView, "workspace">) {
    const path = next === "home" ? "/agents/beauty-industry" : `/agents/beauty-industry/${next}`;
    navigateTo(path);
  }

  function openTool(toolName: string) {
    const route = beautyRouteForTool(toolName);
    if (!route) return;
    setProfessionalOptions(toolName === "beauty.xiaohongshu_package" ? createXhsOptionsFromProfile(profile) : EMPTY_OPTIONS); setSourceRunId(undefined); requestIdRef.current = null;
    setMediaRetryRequested(false); setMediaRetryOfJobId(undefined); mediaRequestKeyRef.current = null;
    if (toolName === "beauty.content_ten_pack") setContentWorkflow(createContentWorkflowFromProfile(profile));
    if (toolName === "beauty.video_data_review") setVideoReviewWorkflow(createVideoReviewWorkflowFromProfile(profile));
    if (toolName === "beauty.video_content_review") setVideoContentWorkflow(createVideoContentWorkflowFromProfile(profile));
    navigateTo(route.path, route);
  }

  function enterBranch(nextBranch: BeautyBranch, requestedTool?: string) {
    const nextTool = requestedTool && taskBelongsToBranch(requestedTool, nextBranch) ? requestedTool : BRANCH_DEFINITIONS[nextBranch].tasks[0].name;
    openTool(nextTool);
    setNotice(`已进入${BRANCH_DEFINITIONS[nextBranch].label}。`);
  }

  async function submit(event: FormEvent) { event.preventDefault(); await runSelectedTask(selectedTool, sourceRunId); }
  async function runSelectedTask(toolName: string, inheritedRunId?: string, inputOverride?: string, modeOverride?: RunMode, topicWorkflow?: BeautyTopicWorkflow, contentWorkflowOverride?: BeautyContentWorkflowDraft, professionalOptionsOverride?: ProfessionalOptions, videoContentWorkflowOverride?: BeautyVideoContentWorkflowDraft, liveReviewWorkflowOverride?: BeautyLiveReviewWorkflowDraft) {
    const task = findTask(toolName); const effectiveQuestion = (inputOverride ?? question).trim(); const effectiveMode = modeOverride ?? mode;
    if (!task || task.unavailableReason || requestInFlightRef.current || effectiveQuestion.length < 6) return;
    const effectiveProfessionalOptions = professionalOptionsOverride ?? professionalOptions;
    if (toolName === "beauty.xiaohongshu_package") {
      const missing = assessXhsWebReadiness({
        question: effectiveQuestion,
        project: effectiveProfessionalOptions.project.trim() || profile?.services.join("、") || "",
        audience: effectiveProfessionalOptions.audience.trim() || profile?.targetCustomers || ""
      });
      if (missing.length > 0) {
        setNotice("必填资料尚未提交，因此没有预留积分或调用模型。");
        setError(`请先补齐：${missing.join("、")}。`);
        return;
      }
    }
    if (toolName === SALES_TASK.name && effectiveMode === "professional") {
      const missing = [
        ["project", "本次项目"], ["priceBoundary", "已确认价格或优惠边界"], ["customerConcern", "顾客原话或主要顾虑"],
        ["communicationStage", "沟通阶段"], ["allowedNextAction", "允许的下一步动作"]
      ].filter(([key]) => !String(effectiveProfessionalOptions[key as OptionKey] ?? "").trim()).map(([, label]) => label);
      if (missing.length > 0) {
        setNotice("专业模式资料尚未提交，因此没有预留积分或调用模型。");
        setError(`请先补齐：${missing.join("、")}。`);
        return;
      }
    }
    const requestId = requestIdRef.current ?? crypto.randomUUID(); requestIdRef.current = requestId;
    const controller = new AbortController(); abortRef.current = controller; requestInFlightRef.current = true; setLoading(true); setError(""); setNotice(`正在${task.stage}，已锁定 ${task.label}；不会自动发布、投放或付款。`);
    try {
      const fileTask = toolName === "beauty.video_data_review";
      const selectedOptions = contentWorkflowOverride
        ? {
            audience: contentWorkflowOverride.targetAudience,
            project: contentWorkflowOverride.topic,
            platform: contentWorkflowOverride.platform,
            contentStructure: [contentWorkflowOverride.format, contentWorkflowOverride.presenter].filter(Boolean).join("；"),
            shootingRequirements: contentWorkflowOverride.shootingConstraints,
            edlRequirements: contentWorkflowOverride.duration
          }
        : pickTaskOptions(task, effectiveProfessionalOptions);
      if (fileTask) Object.assign(selectedOptions, { parsedEvidence: effectiveProfessionalOptions.parsedEvidence, parseStatus: effectiveProfessionalOptions.parseStatus, sourceFilename: effectiveProfessionalOptions.sourceFilename });
      const result = await readJson<{ answerText: string; agentRunId: string; capabilityId: string; skillId: string; abilityUsed?: string; creditCost: number; remainingCredits?: number; conversationId?: string; structuredDelivery?: BeautyXhsDelivery; taskSnapshot?: BeautyXhsTaskSnapshot }>(await fetch(apiPath("/beauty-industry/acquisition/runs"), { method: "POST", headers: { ...authHeaders, "Content-Type": "application/json" }, signal: controller.signal, body: JSON.stringify({ toolName, question: effectiveQuestion, confirmedFacts: contentWorkflowOverride?.projectFacts?.trim() || confirmedFacts.trim() || undefined, mode: effectiveMode, professionalOptions: liveReviewWorkflowOverride ? undefined : effectiveMode === "professional" || fileTask ? selectedOptions : undefined, topicWorkflow, contentWorkflow: contentWorkflowOverride, videoContentWorkflow: videoContentWorkflowOverride, liveReviewWorkflow: liveReviewWorkflowOverride, sourceRunId: inheritedRunId, requestId, deviceScope: window.matchMedia("(max-width: 600px)").matches ? "mobile" : "desktop" }) }));
      const run: BeautyRun = { id: result.agentRunId, capabilityId: result.capabilityId, skillId: result.skillId, abilityUsed: result.abilityUsed, output: result.answerText, creditCost: result.creditCost, usageChannel: "web", conversationId: result.conversationId, createdAt: new Date().toISOString(), structuredDelivery: result.structuredDelivery, taskSnapshot: result.taskSnapshot };
      setActiveResult(run); setHistory((items) => [run, ...items.filter((item) => item.id !== run.id)]); setSourceRunId(undefined); requestIdRef.current = null;
      setMediaRetryRequested(false); setMediaRetryOfJobId(undefined); mediaRequestKeyRef.current = null;
      setOverview((value) => value && typeof result.remainingCredits === "number" ? { ...value, creditBalance: result.remainingCredits } : value); setNotice("结果已保存；刷新后可恢复。实际积分已由统一账本幂等结算。");
    } catch (reason) {
      if (controller.signal.aborted) {
        setNotice("本次请求已取消；不会自动重试，预留积分由服务端释放。");
        requestIdRef.current = null;
      } else {
        // A known terminal response has already released (or never created) a
        // reservation, so the next explicit click must use a fresh request id.
        // Network uncertainty keeps the old id and lets the server recover the
        // same run instead of risking a duplicate Provider call.
        const terminalFailure = isTerminalApiFailure(reason);
        if (terminalFailure) requestIdRef.current = null;
        setNotice(isSystemOutputFailure(reason)
          ? "系统未生成有效结果，未保存且预留积分已释放；无需重复点击。"
          : terminalFailure
            ? "本次请求已失败；未保存结果，预留积分已释放，可修改后重试。"
            : "网络连接中断；未自动重试，可使用同一请求恢复状态。");
        setError(friendlyError(reason, "生成失败，请稍后重试"));
      }
    }
    finally { abortRef.current = null; requestInFlightRef.current = false; setLoading(false); }
  }

  async function runTopicSystem(request: TopicSystemGenerationRequest): Promise<void> {
    const topicWorkflow: BeautyTopicWorkflow = {
      identity: request.identity,
      targetCustomer: request.targetCustomer,
      acquisitionGoal: request.acquisitionGoal,
      offer: request.offer || undefined,
      accountStage: request.accountStage || undefined,
      industry: request.industry,
      benchmarkAccounts: request.benchmarkAccounts,
      transcriptDocumentIds: request.transcriptDocumentIds,
      videoReviewId: request.videoReview?.id,
      sourceSelection: request.sourceSelection
    };
    const taskQuestion = [
      `为${request.identity || "本店"}面向${request.targetCustomer}生成视频选题。`,
      `本轮获客目标：${request.acquisitionGoal}。`,
      request.offer ? `本轮项目：${request.offer}。` : "",
      "严格使用当前四来源状态，先形成候选并完成三关筛选，最终交付TOP10。"
    ].filter(Boolean).join("\n");
    setQuestion(taskQuestion);
    await runSelectedTask("beauty.topic_ideas", undefined, taskQuestion, "professional", topicWorkflow);
  }

  async function runContentTen(): Promise<void> {
    const taskQuestion = [
      `围绕选题“${contentWorkflow.topic.trim()}”生成内容系统正式十件交付。`,
      `目标顾客：${contentWorkflow.targetAudience.trim()}。`,
      `本轮目标：${contentWorkflow.objective.trim()}。`,
      `发布平台：${contentWorkflow.platform.trim()}。`
    ].join("\n");
    setQuestion(taskQuestion);
    setMode("professional");
    await runSelectedTask("beauty.content_ten_pack", sourceRunId, taskQuestion, "professional", undefined, contentWorkflow);
  }

  async function runVideoDataReview(): Promise<void> {
    const taskQuestion = buildBeautyVideoReviewQuestion(videoReviewWorkflow);
    const nextOptions: ProfessionalOptions = {
      ...professionalOptions,
      platform: videoReviewWorkflow.platform,
      contentStructure: buildBeautyVideoReviewContentStructure(videoReviewWorkflow)
    };
    setQuestion(taskQuestion);
    setMode("professional");
    setProfessionalOptions(nextOptions);
    await runSelectedTask("beauty.video_data_review", sourceRunId, taskQuestion, "professional", undefined, undefined, nextOptions);
  }

  async function runVideoContentReview(): Promise<void> {
    const taskQuestion = [
      `复盘${videoContentWorkflow.platform}视频“${videoContentWorkflow.videoTitle.trim()}”。`,
      `目标人群：${videoContentWorkflow.targetAudience.trim()}。`,
      `业务目标：${videoContentWorkflow.businessObjective.trim()}。`,
      "严格依据本轮口播与画面证据，输出正式视频内容复盘；不得补造平台数据、人物、案例、价格或疗效。"
    ].join("\n");
    setQuestion(taskQuestion);
    setMode("professional");
    await runSelectedTask("beauty.video_content_review", sourceRunId, taskQuestion, "professional", undefined, undefined, undefined, videoContentWorkflow);
  }

  async function runLiveReview(): Promise<void> {
    const taskQuestion = buildBeautyLiveReviewQuestion(liveReviewWorkflow);
    setQuestion(taskQuestion);
    setMode("professional");
    await runSelectedTask("beauty.live_review", sourceRunId, taskQuestion, "professional", undefined, undefined, undefined, undefined, liveReviewWorkflow);
  }

  function generateNext(toolName: string) {
    const next = findTask(toolName); if (!next || !activeResult || loading) return;
    const inheritedId = activeResult.id;
    if (toolName === "beauty.video_data_review") {
      openTool(toolName);
      setSourceRunId(inheritedId);
      setMode("professional");
      setVideoReviewWorkflow(createVideoReviewWorkflowFromProfile(profile));
      setNotice("已进入视频数据复盘；请先选择平台、填写周期并上传后台数据。尚未运行复盘或扣积分。");
      return;
    }
    if (toolName === "beauty.live_review") {
      openTool(toolName);
      setSourceRunId(inheritedId);
      setMode("professional");
      setLiveReviewWorkflow({ ...createLiveReviewWorkflowFromProfile(profile), scriptPlan: activeResult.output.slice(0, 20_000) });
      setNotice("已把上一步直播话术作为待对照计划带入；请补当前场次真实数据或转写。尚未运行复盘或扣积分。");
      return;
    }
    const nextQuestion = `请基于上一步已保存结果，继续完成${next.label}。只沿用上一步草稿作为任务上下文，不把其中推断当作门店事实。`;
    setBranch(branchForTool(toolName)); setSelectedTool(toolName); setSourceRunId(inheritedId); setQuestion(nextQuestion); setMode("quick"); setProfessionalOptions(EMPTY_OPTIONS); requestIdRef.current = null;
    const route = beautyRouteForTool(toolName); if (route) navigateTo(route.path, route);
    void runSelectedTask(toolName, inheritedId, nextQuestion, "quick");
  }

  async function saveProfile(event: FormEvent) {
    event.preventDefault(); if (profileSaving) return; setProfileSaving(true); setError("");
    try {
      const channels = profileDraft.channels.flatMap((channel) => channel === "其他" ? profileDraft.otherChannel.trim() ? [`其他：${profileDraft.otherChannel.trim()}`] : ["其他"] : [channel]);
      const value = await readJson<{ profile: BeautyProfile }>(await fetch(apiPath("/beauty-industry/profile"), { method: "PUT", headers: { ...authHeaders, "Content-Type": "application/json" }, body: JSON.stringify({ ...profileDraft, customSegment: profileDraft.segment === "other" ? profileDraft.customSegment.trim() : "", services: splitList(profileDraft.services), channels, otherChannel: undefined }) }));
      setProfile(value.profile); setProfileDraft(profileToDraft(value.profile)); setProfileOpen(false); setNotice("美业经营档案已确认保存；网页与 WorkBuddy 共用这一产品级资料。");
    }
    catch (reason) { setError(friendlyError(reason, "美业经营档案保存失败")); } finally { setProfileSaving(false); }
  }
  async function removeProfile() { if (!profile || profileSaving || !window.confirm("确认删除美业经营档案？")) return; setProfileSaving(true); try { await readJson(await fetch(apiPath("/beauty-industry/profile"), { method: "DELETE", headers: authHeaders })); setProfile(null); setProfileDraft(EMPTY_PROFILE); setProfileOpen(true); setNotice("美业经营档案已删除；旧资料不会继续注入网页或 WorkBuddy。"); } catch (reason) { setError(friendlyError(reason, "删除失败")); } finally { setProfileSaving(false); } }
  async function copyResult() { if (!activeResult?.output) return; try { await navigator.clipboard.writeText(activeResult.structuredDelivery?.customerDeliverable.copyMarkdown ?? activeResult.output); setNotice(activeResult.structuredDelivery ? "客户成品已复制，不包含制作说明和内部审核。" : "文字结果已一键复制。"); } catch { setError("浏览器未允许复制，请检查剪贴板权限。"); } }
  async function loadMediaPackage(runId: string) {
    const loadSequence = ++mediaLoadSequenceRef.current;
    try {
      const imageRequirements = { overallVisualRequirements: professionalOptions.visualStyle.trim(), prohibitedContent: professionalOptions.prohibitedContent.trim() };
      const [quote, jobs] = await Promise.all([
        readJson<BeautyMediaQuote>(await fetch(apiPath(`/beauty-industry/acquisition/runs/${encodeURIComponent(runId)}/media/quote`), { method: "POST", headers: { ...authHeaders, "Content-Type": "application/json" }, body: JSON.stringify({ imageCount: professionalOptions.imageCount, imageRequirements, retryAfterQualityFailure: mediaRetryRequested && mediaBatchStatus === "quality_failed", retryOfJobId: mediaBatchStatus === "quality_failed" ? mediaRetryOfJobId : undefined, regenerateAfterDelivery: mediaRetryRequested && mediaBatchStatus === "succeeded", regenerateOfJobId: mediaBatchStatus === "succeeded" ? mediaRetryOfJobId : undefined }) })),
        readJson<{ jobs: BeautyMediaJob[]; batchStatus: BeautyMediaBatchStatus }>(await fetch(apiPath(`/beauty-industry/acquisition/runs/${encodeURIComponent(runId)}/media/jobs`), { headers: authHeaders, cache: "no-store" }))
      ]);
      if (loadSequence !== mediaLoadSequenceRef.current) return;
      setMediaQuote(quote); setMediaJobs(jobs.jobs); setMediaBatchStatus(jobs.batchStatus); await loadMediaAssets(jobs.jobs);
    } catch (reason) {
      if (loadSequence !== mediaLoadSequenceRef.current) return;
      setMediaQuote(null); setError(friendlyError(reason, "图片费用和历史状态加载失败"));
    }
  }
  async function confirmImages(selectedTitle: string) {
    if (!activeResult || !mediaQuote?.canConfirm || mediaLoading || mediaConfirmInFlightRef.current) return;
    mediaConfirmInFlightRef.current = true;
    setMediaLoading(true); setError(""); setNotice("已确认本次费用，正在创建图片任务；不会自动重试或重复扣费。");
    mediaRequestKeyRef.current ??= `beauty_media_${crypto.randomUUID().replace(/-/g, "")}`;
    try {
      const result = await readJson<{ jobs: BeautyMediaJob[]; batchStatus: BeautyMediaBatchStatus; idempotent: boolean; partial?: boolean; message?: string }>(await fetch(apiPath(`/beauty-industry/acquisition/runs/${encodeURIComponent(activeResult.id)}/media/confirm`), { method: "POST", headers: { ...authHeaders, "Content-Type": "application/json", "X-Idempotency-Key": mediaRequestKeyRef.current }, body: JSON.stringify({ imageCount: mediaQuote.imageCount, confirmed: true, requestKey: mediaRequestKeyRef.current, imageRequirements: { overallVisualRequirements: professionalOptions.visualStyle.trim(), prohibitedContent: professionalOptions.prohibitedContent.trim(), selectedTitle }, retryAfterQualityFailure: mediaRetryRequested && mediaBatchStatus === "quality_failed", retryOfJobId: mediaBatchStatus === "quality_failed" ? mediaRetryOfJobId : undefined, regenerateAfterDelivery: mediaRetryRequested && mediaBatchStatus === "succeeded", regenerateOfJobId: mediaBatchStatus === "succeeded" ? mediaRetryOfJobId : undefined }) }));
      setMediaJobs(result.jobs); setMediaBatchStatus(result.batchStatus);
      setMediaRetryRequested(false); setMediaRetryOfJobId(undefined);
      if (result.idempotent) setNotice(result.message || "已恢复现有图片任务，不会重复生成或扣费。");
      await pollMediaJobs(result.jobs);
    } catch (reason) { setError(friendlyError(reason, "图片任务未创建；没有自动重试")); }
    finally { mediaConfirmInFlightRef.current = false; setMediaLoading(false); }
  }
  function prepareMediaRetry() {
    const continuationOfJobId = mediaQuote?.regenerationOfJobId ?? mediaQuote?.retryOfJobId ?? mediaJobs[0]?.id;
    if (!mediaQuote?.retryEligible || !["quality_failed", "succeeded"].includes(mediaBatchStatus) || !continuationOfJobId || mediaLoading) return;
    setMediaRetryRequested(true);
    setMediaRetryOfJobId(continuationOfJobId);
    mediaRequestKeyRef.current = null;
    setNotice("请修改本次三图总体视觉要求或禁用内容；更新后的费用和积分会重新展示，只有再次确认才创建新批次。");
  }
  async function pollMediaJobs(initial: BeautyMediaJob[]) {
    let current = initial;
    let transientFailures = 0;
    for (let attempt = 0; attempt < 40 && current.some((job) => job.canRecover || !["succeeded", "failed", "canceled"].includes(job.status)); attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 3_000));
      const refreshed: BeautyMediaJob[] = [];
      for (const job of current) {
        if (!job.canRecover && ["succeeded", "failed", "canceled"].includes(job.status)) { refreshed.push(job); continue; }
        try {
          const value = await readJson<{ job: BeautyMediaJob; batchStatus: BeautyMediaBatchStatus }>(await fetch(apiPath(`/beauty-industry/media/jobs/${encodeURIComponent(job.id)}/refresh`), { method: "POST", headers: authHeaders }));
          refreshed.push(value.job); setMediaBatchStatus(value.batchStatus);
        } catch {
          transientFailures += 1;
          refreshed.push(job);
          setNotice("图片状态查询暂时失败；现有 Provider 任务仍保留，可继续恢复，不会创建新任务或重复扣费。");
        }
      }
      current = refreshed;
      setMediaJobs(current);
    }
    await loadMediaAssets(current);
    const succeeded = current.filter((job) => job.status === "succeeded").length;
    const failed = current.filter((job) => job.status === "failed" || job.status === "canceled").length;
    const pending = current.filter((job) => job.canRecover || !["succeeded", "failed", "canceled"].includes(job.status)).length;
    const usable = current.filter((job) => job.customerUsable).length;
    setNotice(current.some((job) => job.batchStatus === "quality_failed") ? `图片未达到交付标准，不建议使用；技术成功 ${succeeded} 张、客户可用 ${usable} 张，积分已按完整交付合同释放或补偿。` : succeeded === current.length ? `${succeeded} 张图片已通过质量检查并保存到当前图文任务。` : pending > 0 ? `仍有 ${pending} 个现有图片任务待恢复；状态查询暂时失败 ${transientFailures} 次，没有创建新任务或重复扣费。` : `图片任务部分完成：成功 ${succeeded} 张，未完成 ${failed} 张；没有自动付费重试。`);
  }
  async function resumeMediaJobs() {
    if (mediaLoading || mediaJobs.length === 0) return;
    setMediaLoading(true); setError(""); setNotice("正在恢复已有图片任务状态；不会创建新任务或重复扣费。");
    try { await pollMediaJobs(mediaJobs); }
    finally { setMediaLoading(false); }
  }
  async function cancelMediaJob(jobId: string) {
    try {
      const value = await readJson<{ job: BeautyMediaJob; batchStatus: BeautyMediaBatchStatus }>(await fetch(apiPath(`/beauty-industry/media/jobs/${encodeURIComponent(jobId)}/cancel`), { method: "POST", headers: authHeaders }));
      setMediaJobs((jobs) => jobs.map((job) => job.id === value.job.id ? value.job : job)); setMediaBatchStatus(value.batchStatus); setNotice("图片任务已取消；未交付部分会释放预留积分。");
    } catch (reason) { setError(friendlyError(reason, "任务已进入处理，当前不能取消")); }
  }
  async function loadMediaAssets(jobs: BeautyMediaJob[]) {
    const succeeded = jobs.filter((job) => job.customerUsable && job.status === "succeeded" && job.assetStatus === "persisted");
    const next: Record<string, string> = {};
    for (const job of succeeded) {
      try {
        const response = await fetch(apiPath(`/beauty-industry/media/assets/${encodeURIComponent(job.id)}`), { headers: authHeaders });
        if (response.ok) next[job.id] = URL.createObjectURL(await response.blob());
      } catch { /* 下载按钮保留显式错误反馈。 */ }
    }
    setMediaObjectUrls((current) => { Object.values(current).forEach(URL.revokeObjectURL); return next; });
  }
  async function downloadImage(job: BeautyMediaJob, index: number) {
    try {
      const response = await fetch(apiPath(`/beauty-industry/media/assets/${encodeURIComponent(job.id)}/download`), { headers: authHeaders });
      if (!response.ok) throw new Error("download_failed");
      const blob = await response.blob(); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `beauty-xhs-${activeResult?.id.slice(0, 8) ?? "image"}-${index + 1}.${blob.type.includes("jpeg") ? "jpg" : blob.type.includes("webp") ? "webp" : "png"}`; anchor.click(); URL.revokeObjectURL(url); setNotice(`第 ${index + 1} 张图片已下载。`);
    } catch (reason) { setError(friendlyError(reason, "图片下载失败，请稍后重试")); }
  }
  async function parseReviewFile(file: File | undefined) {
    if (!file || fileParsing) return;
    if (!/\.(csv|xlsx|xls)$/i.test(file.name)) { setError("视频数据复盘只接受 CSV 或 Excel 文件。"); return; }
    setFileParsing(true); setError(""); setNotice("正在解析文件；解析完成前不会调用复盘模型。");
    try {
      const form = new FormData(); form.append("file", file, file.name); form.append("metadata", "美业视频数据复盘");
      const parsed = await readJson<{ contextText?: string; documentText?: string; warnings?: string[]; providerTrace?: unknown[]; framesAnalyzed?: number; frameSummary?: string; transcript?: string }>(await fetch(apiPath("/media/analyze"), { method: "POST", headers: authHeaders, body: form }));
      if ((parsed.providerTrace?.length ?? 0) > 0 || parsed.framesAnalyzed || parsed.frameSummary || parsed.transcript) {
        throw new Error("数据表解析触发了不应发生的媒体 Provider 路径，已停止本次复盘。");
      }
      const evidence = (parsed.contextText || parsed.documentText || "").trim();
      if (!evidence) throw new Error(parsed.warnings?.join("；") || "文件没有解析出可用于复盘的证据。");
      if (!hasBeautyVideoReviewDataRecords(evidence)) throw new Error("文件只有表头或没有可复盘的数值记录；请从平台后台重新导出包含作品数据的文件。");
      setProfessionalOptions((value) => ({ ...value, parsedEvidence: evidence.slice(0, 20_000), parseStatus: "parsed", sourceFilename: file.name }));
      if (activeResult?.capabilityId === "video_data_review") setActiveResult(null);
      requestIdRef.current = null; setNotice(`已解析 ${file.name}。只有这份后端解析数据会进入当前复盘；媒体 Provider 调用为 0。`);
    } catch (reason) {
      setProfessionalOptions((value) => ({ ...value, parsedEvidence: "", parseStatus: "failed", sourceFilename: file.name }));
      setNotice("文件解析失败；已禁止复盘，不会调用模型或扣积分。");
      setError(friendlyError(reason, "文件解析失败；不会声称看过文件。"));
    } finally { setFileParsing(false); }
  }

  async function parseLiveReviewFile(file: File | undefined) {
    if (!file || fileParsing) return;
    if (!/\.(csv|xlsx|xls)$/i.test(file.name)) {
      setLiveReviewWorkflow((value) => ({ ...value, liveData: "", parseStatus: "failed", sourceFilename: undefined }));
      setError("直播复盘数据只接受 CSV、XLS 或 XLSX；录屏和音频不会在本页上传或解析。");
      return;
    }
    setFileParsing(true); setError(""); setNotice("正在后端解析当前场次数据；不会调用文本、视觉、ASR 或媒体 Provider。");
    try {
      const form = new FormData(); form.append("file", file, file.name); form.append("metadata", "美业直播复盘场次数据");
      const parsed = await readJson<{ contextText?: string; documentText?: string; warnings?: string[]; providerTrace?: unknown[]; framesAnalyzed?: number; frameSummary?: string; transcript?: string }>(await fetch(apiPath("/media/analyze"), { method: "POST", headers: authHeaders, body: form }));
      if ((parsed.providerTrace?.length ?? 0) > 0 || parsed.framesAnalyzed || parsed.frameSummary || parsed.transcript) throw new Error("数据表解析触发了不允许的媒体 Provider 路径，已停止本次直播复盘。");
      const evidence = (parsed.contextText || parsed.documentText || "").trim();
      if (!evidence) throw new Error(parsed.warnings?.join("；") || "文件没有解析出可用于当前场次复盘的证据。");
      if (!hasBeautyLiveReviewDataRecords(evidence)) throw new Error("文件只有表头或没有直播指标数值记录；请从平台后台重新导出当前场次明细。");
      setLiveReviewWorkflow((value) => ({ ...value, liveData: evidence.slice(0, 20_000), parseStatus: "parsed", sourceFilename: file.name }));
      if (activeResult?.capabilityId === "live_review") setActiveResult(null);
      requestIdRef.current = null;
      setNotice(`已解析 ${file.name}；只把本次后端解析数据放入直播复盘合同，Provider 调用 0、积分 0。`);
    } catch (reason) {
      setLiveReviewWorkflow((value) => ({ ...value, liveData: "", parseStatus: "failed", sourceFilename: undefined }));
      setNotice("场次数据解析失败；未创建复盘、未调用 Provider、未扣积分。");
      setError(friendlyError(reason, "文件解析失败；不会声称已读取场次数据。"));
    } finally { setFileParsing(false); }
  }

  async function preflightVideoContentFile(file: File | undefined) {
    if (!file || videoPreflighting) return;
    if (!/\.(mp4|mov|m4v|webm)$/i.test(file.name)) {
      videoPreflightRequestIdRef.current = null;
      setVideoContentWorkflow((value) => ({ ...value, mediaPreflight: undefined }));
      setError("视频内容复盘只接受 MP4、MOV、M4V 或 WebM 视频；请重新导出后上传。");
      return;
    }
    const requestId = videoPreflightRequestIdRef.current ?? `video_preflight_${crypto.randomUUID().replace(/-/g, "")}`;
    videoPreflightRequestIdRef.current = requestId;
    setVideoPreflighting(true); setError(""); setNotice("正在做零费用格式与元数据预检；不会调用视觉、ASR 或文本 Provider。");
    try {
      const form = new FormData();
      form.append("requestId", requestId);
      form.append("workflow", JSON.stringify({ ...videoContentWorkflow, mediaPreflight: undefined }));
      form.append("file", file, file.name);
      const result = await readJson<{ status: "metadata_ready_evidence_required"; preflight: BeautyVideoContentPreflight; providerCalls: 0; creditCost: 0; message: string }>(await fetch(apiPath("/beauty-industry/video-content/preflight"), { method: "POST", headers: authHeaders, body: form }));
      if (result.providerCalls !== 0 || result.creditCost !== 0 || result.preflight.providerCalls !== 0 || !result.preflight.sourceDeleted || result.preflight.retainedMedia) {
        throw new Error("预检返回了不允许的 Provider、费用或文件留存状态，已停止。");
      }
      setVideoContentWorkflow((value) => ({ ...value, mediaPreflight: result.preflight }));
      setNotice(result.message);
    } catch (reason) {
      videoPreflightRequestIdRef.current = null;
      setVideoContentWorkflow((value) => ({ ...value, mediaPreflight: undefined }));
      setNotice("视频预检未完成；没有创建任务、调用 Provider 或扣费，可以修正文件后重试。");
      setError(friendlyError(reason, "视频预检失败，请重新选择文件。"));
    } finally { setVideoPreflighting(false); }
  }

  const nextSteps = activeResult ? nextToolsFor(activeResult.capabilityId) : [];
  const isTopicWorkspace = workspaceModule === "acquisition" && selectedTool === "beauty.topic_ideas";
  const isXhsWorkspace = workspaceModule === "acquisition" && selectedTool === "beauty.xiaohongshu_package";
  const isContentTenWorkspace = workspaceModule === "acquisition" && selectedTool === "beauty.content_ten_pack";
  const isVideoDataReviewWorkspace = workspaceModule === "acquisition" && selectedTool === "beauty.video_data_review";
  const isVideoContentReviewWorkspace = workspaceModule === "acquisition" && selectedTool === "beauty.video_content_review";
  const isLiveReviewWorkspace = workspaceModule === "acquisition" && selectedTool === "beauty.live_review";
  const isControlledTextPreview = overview?.executionMode === "controlled_mock"
    && Boolean(activeResult)
    && ["beauty_xiaohongshu_package", "live_script", "sales_advice"].includes(activeResult?.capabilityId ?? "");
  const topicResult = activeResult?.capabilityId === "topic_inspiration" ? activeResult.output : undefined;
  const profileCompletion = calculateProfileCompletion(profile);
  const permittedTools = new Set(overview?.tools.map((tool) => tool.name) ?? []);
  const activeConnections = connections?.connections.filter((connection) => connection.status === "active") ?? [];
  const todaySuggestion = overview?.todayActions[0] ?? null;
  const permissionState = currentRoute.toolName && !permittedTools.has(currentRoute.toolName) ? "unavailable" : "available";
  const shell = (children: ReactNode) => <BeautyIndustryShell
    activeKey={currentRoute.navKey}
    pageTitle={currentRoute.pageTitle}
    creditBalance={overview?.creditBalance}
    enterpriseName={overview?.enterpriseBase.brandName}
    city={overview?.enterpriseBase.city}
    localAcceptance={overview?.localAcceptance}
    permittedTools={permittedTools}
    brand={overview?.brand}
  >{children}</BeautyIndustryShell>;

  function openHistoryRun(run: BeautyRun) {
    const tool = CAPABILITY_TO_TOOL[run.capabilityId || ""];
    if (!tool) return;
    openTool(tool);
    setActiveResult(run);
  }

  function runTodayAction(action: BeautyOverview["todayActions"][number]) {
    if (action.profileAction) { setProfileOpen(true); openView("profile"); return; }
    if (action.toolName) openTool(action.toolName);
  }

  if (initialLoading || loadError || view !== "workspace") return shell(
    initialLoading ? <section className="beautyIndustryLoadState" role="status"><span className="beautyIndustryLoadingMark" /><h1>正在读取美业智能体</h1><p>正在核对当前租户的积分、经营档案、连接和任务。</p></section> : loadError ? <section className="beautyIndustryLoadState beautyIndustryLoadError" role="alert"><h1>当前页面暂时没有加载成功</h1><p>{loadError}</p><button type="button" onClick={() => void loadWorkspace()}>重新加载</button></section> : view === "profile" ? <section className="beautyIndustryProfilePage">
          <header><button type="button" onClick={() => openView("home")}>← 返回工作台首页</button><span>经营档案</span><h1>确认可长期复用的美业经营资料</h1><p>资料只属于当前租户；网页与 WorkBuddy 共用，未确认的信息不会自动补造。</p></header>
          <section className="beautyIndustryProfileCard"><div className="beautyIndustryProfileSummary"><div><span className="beautyIndustryKicker">美业经营档案 · 用户确认</span><h2>{profile ? `${profile.segment === "other" ? profile.customSegment : SEGMENTS[profile.segment]} · ${profile.operationType === "chain_brand" ? "连锁" : "单店"}` : "尚未建立"}</h2><p>当前完整度 {profileCompletion}%；门店/品牌名称和城市在账户资料维护。</p></div><div className="beautyIndustryProfileActions">{profile && <button type="button" className="danger" onClick={() => void removeProfile()}>删除档案</button>}</div></div>
            <form className="beautyIndustryProfileForm" onSubmit={saveProfile}>
              <label>细分赛道<select value={profileDraft.segment} onChange={(e) => setProfileDraft({ ...profileDraft, segment: e.target.value as BeautyProfile["segment"] })}>{Object.entries(SEGMENTS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              {profileDraft.segment === "other" && <label>具体美业方向<input value={profileDraft.customSegment} onChange={(e) => setProfileDraft({ ...profileDraft, customSegment: e.target.value })} placeholder="例如：采耳、轻体管理等" required /></label>}
              <label>经营类型<select value={profileDraft.operationType} onChange={(e) => setProfileDraft({ ...profileDraft, operationType: e.target.value as BeautyProfile["operationType"] })}><option value="single_store">单店</option><option value="chain_brand">连锁</option></select></label>
              <label>经营阶段<select value={profileDraft.operatingStage} onChange={(e) => setProfileDraft({ ...profileDraft, operatingStage: e.target.value as BeautyProfile["operatingStage"] })}>{Object.entries(STAGES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label>核心项目<input value={profileDraft.services} onChange={(e) => setProfileDraft({ ...profileDraft, services: e.target.value })} placeholder="逗号分隔，只填已确认项目" /></label><label>目标顾客<input value={profileDraft.targetCustomers} onChange={(e) => setProfileDraft({ ...profileDraft, targetCustomers: e.target.value })} /></label>
              <fieldset className="wide beautyIndustryChannelOptions"><legend>准备发布/经营的渠道（可多选）</legend><div>{CHANNELS.map((channel) => <label key={channel}><input type="checkbox" checked={profileDraft.channels.includes(channel)} onChange={() => setProfileDraft((value) => ({ ...value, channels: value.channels.includes(channel) ? value.channels.filter((item) => item !== channel) : [...value.channels, channel] }))} />{channel}</label>)}</div>{profileDraft.channels.includes("其他") && <input value={profileDraft.otherChannel} onChange={(e) => setProfileDraft({ ...profileDraft, otherChannel: e.target.value })} placeholder="填写其他渠道" />}</fieldset>
              <label>当前获客目标<input value={profileDraft.acquisitionGoal} onChange={(e) => setProfileDraft({ ...profileDraft, acquisitionGoal: e.target.value })} /></label><label className="wide">{profileDraft.segment === "medical_beauty" ? "资质与服务范围说明（必填）" : "本店可以确认的信息（选填）"}<textarea value={profileDraft.factBoundaries} onChange={(e) => setProfileDraft({ ...profileDraft, factBoundaries: e.target.value })} placeholder="例如：可使用的项目、服务特色、门店环境或已确认活动；不要填写顾客隐私" required={profileDraft.segment === "medical_beauty"} /></label>
              <div className="wide beautyIndustryProfileSave"><button className="beautyIndustryPrimary" disabled={profileSaving}>{profileSaving ? "保存中…" : "确认并保存档案"}</button></div>
            </form>
            {notice && <p className="beautyIndustryNotice" role="status">{notice}</p>}{error && <div className="beautyIndustryError" role="alert"><span>{error}</span><button type="button" onClick={() => setError("")}>关闭</button></div>}
          </section>
        </section> : view === "daily" ? <BeautyIndustryDailyBrief headers={authHeaders} /> : view === "tasks" ? <section className="beautyIndustryTaskCenter">
          <header><button type="button" onClick={() => openView("home")}>← 返回工作台首页</button><span>任务中心</span><h1>当前租户的美业任务</h1><p>网页与 WorkBuddy 共用同一结果历史；打开记录不会再次调用或扣费。</p></header>
          <div>{history.length ? history.map((run) => <button key={run.id} type="button" onClick={() => openHistoryRun(run)}><span>{run.usageChannel === "mcp" ? "WorkBuddy" : "网页"}</span><strong>{findTask(CAPABILITY_TO_TOOL[run.capabilityId || ""])?.label ?? "美业任务"}</strong><small>{new Date(run.createdAt).toLocaleString()} · {run.creditCost} 积分</small><em>打开任务 →</em></button>) : <article className="beautyIndustryTrueEmpty"><h2>还没有最近任务</h2><p>从图文、视频、直播或销售入口开始后，已完成结果会出现在这里。</p><button type="button" onClick={() => openTool("beauty.xiaohongshu_package")}>进入图文获客</button></article>}</div>
        </section> : view === "acquisition-home" ? <BeautyAcquisitionHomePage permittedTools={permittedTools} />
        : view === "branch-home" && currentRoute.branch ? <BeautyBranchHomePage branch={currentRoute.branch} permittedTools={permittedTools} />
        : view === "video-review-home" ? <BeautyVideoReviewHomePage permittedTools={permittedTools} />
        : view === "planning" && currentRoute.planningKey ? <BeautyPlanningPage pageKey={currentRoute.planningKey} />
        : view === "not-found" ? <BeautyNotFoundPage />
        : <section className="beautyIndustryHome">
          <div className="beautyIndustryHomeBreadcrumb">美业智能体 <span>/</span> 工作台首页</div>
          <section className="beautyIndustryHomeHero"><div><span>邀请制内测 · 当前经营工作台</span><h1>{overview?.recommendationMode === "today" ? "继续推进今天最重要的经营动作" : "从真实经营资料开始第一项获客任务"}</h1><p>建议、档案、连接和任务均来自当前租户数据；没有数据时保持空状态。</p><div><button type="button" onClick={() => todaySuggestion && runTodayAction(todaySuggestion)} disabled={!todaySuggestion}>{todaySuggestion ? "开始今日建议" : "等待建议"}</button><button type="button" onClick={() => { setProfileOpen(true); openView("profile"); }}>完善经营档案</button></div></div>
            <aside className="beautyIndustryHomeSuggestion"><span>今日建议</span>{todaySuggestion ? <><h2>{todaySuggestion.title}</h2><p>{todaySuggestion.reason}</p><button type="button" onClick={() => runTodayAction(todaySuggestion)}>开始处理 →</button></> : <><h2>暂无今日建议</h2><p>当前租户没有可用建议，请重新加载或先完善经营档案。</p></>}</aside>
          </section>
          <section className="beautyIndustryHomeFacts">
            <article className="beautyIndustryProfileProgress"><span>经营档案完整度</span><strong>{profileCompletion}%</strong><div><i style={{ width: `${profileCompletion}%` }} /></div><p>{profile ? `版本 ${profile.version} · ${profile.services.length ? profile.services.join("、") : "核心项目待补"}` : "尚未建立经营档案"}</p><button type="button" onClick={() => { setProfileOpen(true); openView("profile"); }}>{profile ? "查看与修改" : "建立档案"}</button></article>
            <article><span>积分余额</span><strong>{overview?.creditBalance ?? "—"}</strong><p>读取当前租户统一积分账户</p></article>
            <article><span>最近任务</span><strong>{history.length}</strong><p>{history.length ? `最近完成于 ${new Date(history[0].createdAt).toLocaleString()}` : "还没有已完成任务"}</p><button type="button" onClick={() => openView("tasks")}>进入任务中心</button></article>
          </section>
          <section className="beautyIndustryHomeSection"><header><span>美业获客</span><h2>按真实经营结果进入工作</h2><p>三条业务路径保持固定 Skill 与工具映射。</p></header><div className="beautyIndustryAcquisitionCards">
            {([[/beauty\.xiaohongshu_package/, "图文获客", "生成小红书标题、正文、标签与配图方向。", "/agents/beauty-industry/acquisition/xhs"], [/beauty\.topic_ideas/, "视频获客", "从选题、内容系统到基于真实证据的复盘。", "/agents/beauty-industry/acquisition/video"], [/beauty\.live_script/, "直播获客", "先生成直播话术，再基于真实数据进入复盘。", "/agents/beauty-industry/acquisition/live"]] as const).map(([matcher, title, description, path]) => { const open = [...permittedTools].some((name) => matcher.test(name)); return <article key={path} className={open ? "open" : "planned"}><span>{open ? "已开放" : "未开通"}</span><h3>{title}</h3><p>{description}</p><a href={getAppPath(path)}>{`进入${title} →`}</a></article>; })}
          </div></section>
          <section className="beautyIndustryHomeUtilityGrid">
            <article><span>销售</span><h2>美业销售</h2><p>基于真实顾客沟通生成诊断、合规回复和跟进建议。</p><a href={getAppPath("/agents/beauty-industry/sales")}>{permittedTools.has("beauty.sales_advice") ? "进入美业销售 →" : "查看未开通状态 →"}</a></article>
            <article className="beautyIndustryConnectionCard"><span>数据连接</span><h2>WorkBuddy</h2><p>{!connections?.enabled ? "当前环境未启用 WorkBuddy MCP。" : activeConnections.length ? `当前有 ${activeConnections.length} 个有效连接${activeConnections[0]?.lastUsedAt ? `；最近使用于 ${new Date(activeConnections[0].lastUsedAt).toLocaleString()}` : "。"}` : "尚未建立有效连接。"}</p><button type="button" onClick={() => window.location.href = getAppPath("/agents/beauty-industry/workbuddy")}>{activeConnections.length ? "管理连接 →" : "连接 WorkBuddy →"}</button></article>
          </section>
          <section className="beautyIndustryRecentTasks"><header><div><span>最近任务</span><h2>继续上次的经营动作</h2></div><button type="button" onClick={() => openView("tasks")}>查看任务中心 →</button></header><div>{history.length ? history.slice(0, 3).map((run) => <button key={run.id} type="button" onClick={() => openHistoryRun(run)}><span>{run.usageChannel === "mcp" ? "WorkBuddy" : "网页"}</span><strong>{findTask(CAPABILITY_TO_TOOL[run.capabilityId || ""])?.label ?? "美业任务"}</strong><small>{new Date(run.createdAt).toLocaleString()} · {run.creditCost} 积分</small></button>) : <article className="beautyIndustryTrueEmpty"><h3>暂无最近任务</h3><p>完成第一项美业任务后，这里会显示当前租户的真实结果。</p></article>}</div></section>
        </section>
  );
  if (isVideoContentReviewWorkspace) return shell(<BeautyVideoContentReviewWorkbench
    workflow={videoContentWorkflow}
    onChange={(value) => { setVideoContentWorkflow(value); videoPreflightRequestIdRef.current = null; }}
    onPreflight={(file) => void preflightVideoContentFile(file)}
    onRun={() => void runVideoContentReview()}
    onBackToVideo={() => navigateTo("/agents/beauty-industry/acquisition/video/review")}
    onOpenDataReview={() => openTool("beauty.video_data_review")}
    preflighting={videoPreflighting}
    running={loading}
    result={activeResult?.capabilityId === "shooting_editing" ? activeResult.output : undefined}
    savedAt={savedAt}
    notice={notice}
    error={error}
  />);
  if (permissionState === "unavailable") return shell(<BeautyPermissionState pageTitle={currentRoute.pageTitle} />);
  if (isLiveReviewWorkspace) return shell(<BeautyLiveReviewWorkbench
    workflow={liveReviewWorkflow}
    onChange={(value) => { setLiveReviewWorkflow(value); requestIdRef.current = null; }}
    onParseFile={(file) => void parseLiveReviewFile(file)}
    onRun={() => void runLiveReview()}
    onCancel={() => abortRef.current?.abort()}
    onBackToLive={() => navigateTo("/agents/beauty-industry/acquisition/live")}
    busy={loading}
    fileParsing={fileParsing}
    elapsed={elapsed}
    activeRun={activeResult?.capabilityId === "live_review" ? activeResult : null}
    history={history.filter((run) => run.capabilityId === "live_review")}
    onSelectHistory={(run) => setActiveResult(run)}
    permitted={permittedTools.has("beauty.live_review")}
    savedAt={savedAt}
    notice={notice}
    error={error}
  />);
  if (isVideoDataReviewWorkspace) return shell(<div className="beautyVideoReviewStandalone">
    <BeautyVideoDataReviewWorkbench
      workflow={videoReviewWorkflow}
      onChange={(value) => { setVideoReviewWorkflow(value); requestIdRef.current = null; }}
      onParseFile={(file) => void parseReviewFile(file)}
      onGenerate={() => void runVideoDataReview()}
      onCancel={() => abortRef.current?.abort()}
      onBackToVideo={() => navigateTo("/agents/beauty-industry/acquisition/video/review")}
      onOpenTopics={() => openTool("beauty.topic_ideas")}
      busy={loading}
      fileParsing={fileParsing}
      elapsed={elapsed}
      parseStatus={professionalOptions.parseStatus}
      parsedEvidence={professionalOptions.parsedEvidence}
      sourceFilename={professionalOptions.sourceFilename}
      activeRun={activeResult?.capabilityId === "video_data_review" ? activeResult : null}
      history={history.filter((run) => run.capabilityId === "video_data_review")}
      onSelectHistory={(run) => setActiveResult(run)}
      savedAt={savedAt}
      notice={notice}
      error={error}
      permitted={permittedTools.has("beauty.video_data_review")}
    />
  </div>);
  return shell(<div className="beautyIndustryWorkspacePage">
    <section className="beautyIndustryWorkspaceHeader"><a href={getAppPath(currentRoute.navKey === "sales" ? "/agents/beauty-industry" : currentRoute.branch === "video" ? "/agents/beauty-industry/acquisition/video" : currentRoute.branch === "live" ? "/agents/beauty-industry/acquisition/live" : "/agents/beauty-industry/acquisition")}>← 返回上一级</a><span>{currentRoute.navKey === "sales" ? "美业销售" : `${BRANCH_DEFINITIONS[branch].label} · 正式工作区`}</span><h1>{currentRoute.pageTitle}</h1><p>{currentTask.hint}</p></section>
    {overview?.executionMode === "controlled_mock" && !isXhsWorkspace && <p className="beautyIndustryTestBanner" role="note">当前为 controlled mock 确定性流程验收：文本结果只验证路由、权限、正式合同、积分、保存与恢复，不调用真实文本模型、不产生文本模型费用，也不代表真实模型质量或客户最终内容。真实图片与视频仍按页面单独授权和费用边界执行。</p>}
    {overview?.executionMode === "configured_provider" && <p className="beautyIndustryLiveBanner" role="status">正式文案生成已就绪。图片只会在文案成功后展示费用与积分确认，由你明确确认后生成；不会自动重试、补图或追加调用。</p>}
    {!isXhsWorkspace && <><section className="beautyIndustryDataLayers" aria-label="资料三层边界">
      <article><span>账号共用</span><h3>企业基础资料</h3><p>{overview ? `${overview.enterpriseBase.brandName} · ${overview.enterpriseBase.city || "城市待补"} · ${overview.enterpriseBase.storeCount ?? "门店数待补"}` : "加载中"}</p><small>门店/品牌、城市和门店数，在账户资料中统一维护。</small></article>
      <article><span>美业产品</span><h3>美业经营档案</h3><p>{profile ? `${profile.segment === "other" ? profile.customSegment : SEGMENTS[profile.segment]} · ${profile.services.join("、") || "项目待补"} · 版本 ${profile.version}` : "尚未确认"}</p><small>赛道、项目、目标顾客、渠道和阶段，网页与 WorkBuddy 共用。</small></article>
      <article><span>仅本次</span><h3>本次任务资料</h3><p>{confirmedFacts || "尚未补充"}</p><small>只影响当前任务；点击保存到经营档案后才会长期使用。</small></article>
    </section>
    <section className="beautyIndustryProfileCard"><div className="beautyIndustryProfileSummary"><div><span className="beautyIndustryKicker">当前经营档案摘要</span><h2>{profile ? `${profile.segment === "other" ? profile.customSegment : SEGMENTS[profile.segment]} · ${profile.operationType === "chain_brand" ? "连锁" : "单店"}` : "尚未建立"}</h2><p>工作区只读取已确认资料；新增或修改请进入独立经营档案页面。</p></div><div className="beautyIndustryProfileActions"><a href={getAppPath("/agents/beauty-industry/profile")}>{profile ? "查看经营档案" : "建立经营档案"}</a></div></div></section></>}
    {isXhsWorkspace ? <BeautyXhsWorkbench
      question={question}
      options={{ audience: professionalOptions.audience, project: professionalOptions.project, tone: professionalOptions.tone, visualStyle: professionalOptions.visualStyle, city: professionalOptions.city, storeFacts: professionalOptions.storeFacts, contentAngle: professionalOptions.contentAngle, prohibitedContent: professionalOptions.prohibitedContent }}
      confirmedFacts={confirmedFacts}
      profileSummary={{
        store: profile?.storeName || overview?.enterpriseBase.brandName || "",
        city: profile?.city || overview?.enterpriseBase.city || "",
        project: profile?.services.join("、") || "",
        audience: profile?.targetCustomers || "",
        goal: profile?.acquisitionGoal || ""
      }}
      missingRequiredFields={assessXhsWebReadiness({
        question,
        project: professionalOptions.project.trim() || profile?.services.join("、") || "",
        audience: professionalOptions.audience.trim() || profile?.targetCustomers || ""
      })}
      savedAt={savedAt}
      busy={loading}
      elapsed={elapsed}
      notice={notice}
      error={error}
      preview={activeResult?.capabilityId === "beauty_xiaohongshu_package" && activeResult.structuredDelivery?.version === "beauty-xhs-delivery-v2"
        ? activeResult.structuredDelivery.preview
        : overview?.executionMode === "controlled_mock"}
      activeRun={activeResult?.capabilityId === "beauty_xiaohongshu_package" ? { ...activeResult, structuredDelivery: activeResult.structuredDelivery?.version === "beauty-xhs-delivery-v2" ? activeResult.structuredDelivery as BeautyXhsDelivery : undefined } : null}
      history={history.filter((run) => run.capabilityId === "beauty_xiaohongshu_package").map((run) => ({ id: run.id, creditCost: run.creditCost, usageChannel: run.usageChannel, createdAt: run.createdAt, taskSnapshot: run.taskSnapshot }))}
      mediaQuote={mediaQuote}
      mediaJobs={mediaJobs}
      mediaBatchStatus={mediaBatchStatus}
      mediaLoading={mediaLoading}
      mediaObjectUrls={mediaObjectUrls}
      onQuestionChange={(value) => { setQuestion(value); requestIdRef.current = null; }}
      onOptionsChange={(value) => { setProfessionalOptions((current) => ({ ...current, ...value, imageCount: 3 })); requestIdRef.current = null; }}
      onConfirmedFactsChange={(value) => { setConfirmedFacts(value); requestIdRef.current = null; }}
      onGenerate={() => void runSelectedTask("beauty.xiaohongshu_package", sourceRunId, question, "professional", undefined, undefined, { ...professionalOptions, imageCount: 3 })}
      onCancel={() => abortRef.current?.abort()}
      onRestore={() => restoreWorkspace(overview!.workspaceScope, history)}
      onOpenProfile={() => navigateTo("/agents/beauty-industry/profile")}
      onDismissError={() => setError("")}
      onSelectHistory={(runId) => { setMediaRetryRequested(false); setMediaRetryOfJobId(undefined); mediaRequestKeyRef.current = null; setActiveResult(history.find((run) => run.id === runId) ?? null); }}
      onConfirmImages={(selectedTitle) => void confirmImages(selectedTitle)}
      onSelectedTitleChange={() => { mediaRequestKeyRef.current = null; }}
      onPrepareImageRetry={prepareMediaRetry}
      onResumeImages={() => void resumeMediaJobs()}
      onCancelImage={(jobId) => void cancelMediaJob(jobId)}
      onDownloadImage={(job, index) => void downloadImage(job as BeautyMediaJob, index)}
      onCopy={(text, successMessage) => { void navigator.clipboard.writeText(text).then(() => setNotice(successMessage)).catch(() => setError("浏览器未允许复制，请检查剪贴板权限。")); }}
    /> : isTopicWorkspace ? <section className="beautyIndustryTopicWorkspace">
      {notice && <p className="beautyIndustryNotice" role="status">{notice}</p>}{error && <div className="beautyIndustryError" role="alert"><span>{error}</span><button type="button" onClick={() => setError("")}>关闭</button></div>}
      <TopicSystemWorkbench
        agentSlug="beauty-industry"
        mode="store"
        headers={authHeaders}
        deviceScope={window.matchMedia("(max-width: 600px)").matches ? "mobile" : "desktop"}
        tenantRole={overview?.tenantRole ?? "member"}
        subjectId={overview?.workspaceScope}
        sourceSubjectId={null}
        subjectName={profile?.storeName || overview?.enterpriseBase.brandName || "本店"}
        defaultIndustry={profile ? (profile.segment === "other" ? profile.customSegment || "美业" : SEGMENTS[profile.segment]) : "美业"}
        busy={loading}
        result={topicResult}
        turns={[]}
        onGenerate={runTopicSystem}
        onAsk={(value) => { setQuestion(value); setNotice("请在上方调整目标或来源后重新生成；系统不会把对话关键词切换到其他能力。"); }}
        onOpenContentSystem={async (selection) => {
          setBranch("video");
          setSelectedTool("beauty.content_ten_pack");
          setSourceRunId(activeResult?.id);
          setQuestion(`围绕选题“${selection.topic}”生成内容系统当前十件交付；目标顾客：${selection.audience}。`);
          setConfirmedFacts(`选题来源：${selection.sourceEvidence}\n事实边界：${selection.factBoundary}\n与获客目标的关系：${selection.goalRelation}`);
          setContentWorkflow(createEmptyBeautyContentWorkflow({
            topic: selection.topic,
            objective: selection.goalRelation,
            targetAudience: selection.audience,
            platform: profile?.channels[0] || "抖音",
            projectFacts: profile?.services.join("、") || "",
            shootingConstraints: profile?.factBoundaries || "",
            sourceTopic: {
              topic: selection.topic,
              audience: selection.audience,
              sourceEvidence: selection.sourceEvidence,
              factBoundary: selection.factBoundary,
              goalRelation: selection.goalRelation
            }
          }));
          setMode("professional");
          requestIdRef.current = null;
          navigateTo("/agents/beauty-industry/acquisition/video/content");
          setNotice("已把选题、来源与事实边界带入内容系统；尚未调用模型或扣积分。");
        }}
        onOpenVideoReview={() => openTool("beauty.video_data_review")}
        onChooseSubject={() => navigateTo("/agents/beauty-industry/profile")}
        onBackToMap={() => navigateTo("/agents/beauty-industry/acquisition/video")}
        presentation={{
          title: "美业视频选题系统",
          subtitle: "先确认本轮获客目标，再汇总行业与用户线索、同行对标、已确认录音和自己账号数据复盘，完成三关筛选并输出 TOP10。",
          backLabel: "返回视频获客",
          subjectActionLabel: "修改美业经营档案",
          subjectFallback: "本店",
          flowLabel: "视频选题",
          identityLabel: "门店/品牌名称",
          identityPlaceholder: "默认使用已确认经营档案，也可修改本轮展示名称",
          customerLabel: "本轮目标顾客",
          customerPlaceholder: "例如：门店附近关注日常皮肤护理的成年顾客",
          goalLabel: "本轮获客目标",
          offerLabel: "本轮主推项目",
          offerPlaceholder: "只填写已确认项目；价格、优惠未知时留空"
        }}
      />
    </section> : isContentTenWorkspace ? <BeautyContentTenWorkbench
      workflow={contentWorkflow}
      onChange={(value) => { setContentWorkflow(value); requestIdRef.current = null; }}
      onGenerate={runContentTen}
      onCancel={() => abortRef.current?.abort()}
      onBackToTopics={() => openTool("beauty.topic_ideas")}
      busy={loading}
      elapsed={elapsed}
      sourceRunId={sourceRunId}
      activeRun={activeResult?.capabilityId === "content_plan" ? activeResult : null}
      history={history.filter((run) => run.capabilityId === "content_plan")}
      onSelectHistory={(run) => setActiveResult(run)}
      headers={authHeaders}
      savedAt={savedAt}
      notice={notice}
      error={error}
      preview={overview?.executionMode === "controlled_mock"}
    /> : isVideoDataReviewWorkspace ? <BeautyVideoDataReviewWorkbench
      workflow={videoReviewWorkflow}
      onChange={(value) => { setVideoReviewWorkflow(value); requestIdRef.current = null; }}
      onParseFile={(file) => void parseReviewFile(file)}
      onGenerate={() => void runVideoDataReview()}
      onCancel={() => abortRef.current?.abort()}
      onBackToVideo={() => openTool("beauty.topic_ideas")}
      onOpenTopics={() => openTool("beauty.topic_ideas")}
      busy={loading}
      fileParsing={fileParsing}
      elapsed={elapsed}
      parseStatus={professionalOptions.parseStatus}
      parsedEvidence={professionalOptions.parsedEvidence}
      sourceFilename={professionalOptions.sourceFilename}
      activeRun={activeResult?.capabilityId === "video_data_review" ? activeResult : null}
      history={history.filter((run) => run.capabilityId === "video_data_review")}
      onSelectHistory={(run) => setActiveResult(run)}
      savedAt={savedAt}
      notice={notice}
      error={error}
      permitted={permittedTools.has("beauty.video_data_review")}
    /> : <section className="beautyIndustryWorkspace"><form className="beautyIndustryComposer" onSubmit={submit}><div className="beautyIndustryTaskStatus"><strong>当前阶段：{currentTask.stage}</strong><span>{savedAt ? `自动保存于 ${new Date(savedAt).toLocaleTimeString()}` : "等待自动保存"}</span>{storageKey && <button type="button" onClick={() => restoreWorkspace(overview!.workspaceScope, history)}>恢复上次任务</button>}</div>
      <div className="beautyIndustryModeSwitch"><button type="button" className={mode === "quick" ? "active" : ""} onClick={() => setMode("quick")}>快速模式<span>一句需求 + 已确认档案</span></button><button type="button" className={mode === "professional" ? "active" : ""} onClick={() => setMode("professional")}>专业模式<span>仅显示本任务需要的参数</span></button></div>
      <h2>{currentTask.label}</h2>
      {currentTask.unavailableReason ? <div className="beautyIndustryUnavailable"><strong>暂未开放</strong><p>{currentTask.unavailableReason}</p></div> : <>
        <label>这次要完成什么？<textarea rows={5} value={question} onChange={(e) => { setQuestion(e.target.value); requestIdRef.current = null; }} placeholder={taskPlaceholder(currentTask.name)} /></label>
        {mode === "professional" && <><label>本次可以使用的真实信息（选填）<textarea rows={3} value={confirmedFacts} onChange={(e) => { setConfirmedFacts(e.target.value); requestIdRef.current = null; }} placeholder="可填项目、服务特色、门店环境或已确认活动；不要填价格、疗效或顾客隐私" /></label>
        <button className="beautyIndustrySecondary" type="button" onClick={() => { setProfileDraft((value) => ({ ...value, services: professionalOptions.project || value.services, targetCustomers: professionalOptions.audience || value.targetCustomers, channels: professionalOptions.platform ? mergeChannelSelection(value.channels, professionalOptions.platform) : value.channels })); setProfileOpen(true); navigateTo("/agents/beauty-industry/profile"); setNotice("已带入独立经营档案页面；只有点击“确认并保存档案”才会长期使用。"); }}>保存到经营档案</button>
        <div className="beautyIndustryProfessionalFields">{currentTask.formSchema.map((field) => <TaskField key={field.key} field={field} options={professionalOptions} onChange={(next) => { setProfessionalOptions(next); requestIdRef.current = null; }} />)}</div></>}
        {salesProfessionalMissing.length > 0 && <p className="beautyIndustryPreflight" role="status">专业模式还需补齐：{salesProfessionalMissing.join("、")}。补齐前不预留积分。</p>}
        {currentTask.name === "beauty.video_data_review" && <div className="beautyIndustryMediaBoundary"><strong>上传 CSV / Excel</strong><p>{professionalOptions.parseStatus === "parsed" ? `已解析：${professionalOptions.sourceFilename}` : professionalOptions.parseStatus === "failed" ? "解析失败，已禁止复盘。" : "必须先成功解析；文件类型不能混用。"}</p><input type="file" accept=".csv,.xlsx,.xls" disabled={fileParsing || loading} onChange={(event) => void parseReviewFile(event.target.files?.[0])} /></div>}
        {currentTask.name === "beauty.xiaohongshu_package" && <div className="beautyIndustryMediaBoundary"><strong>图文同任务交付</strong><p>先生成标题、正文、标签和三图视觉计划；商业摄影感配图在当前任务结果区确认积分后真实生成，默认非本店实景且无人出镜。</p></div>}
        <div className="beautyIndustryComposerActions"><button className="beautyIndustryPrimary" disabled={loading || fileParsing || question.trim().length < 6 || salesProfessionalMissing.length > 0 || (currentTask.name === "beauty.video_data_review" && professionalOptions.parseStatus !== "parsed")}>{loading ? `${currentTask.stage}中 · ${elapsed}s` : fileParsing ? "解析文件中…" : `生成${currentTask.label}｜预计${currentTask.credits}积分`}</button>{loading && <button className="beautyIndustrySecondary" type="button" onClick={() => abortRef.current?.abort()}>取消</button>}</div>
      </>}
      {notice && <p className="beautyIndustryNotice" role="status">{notice}</p>}{error && <div className="beautyIndustryError" role="alert"><span>{error}</span><button type="button" onClick={() => setError("")}>关闭</button></div>}
    </form>
    <article className="beautyIndustryResult">
      <header className="beautyIndustryResultHead"><div><span>{activeResult?.structuredDelivery?.preview || isControlledTextPreview ? "流程预览 · 非正式生成" : "已保存结果"}</span><h2>{activeResult?.structuredDelivery ? activeResult.capabilityId === "beauty_sales" ? activeResult.structuredDelivery.preview ? "销售回复流程预览（非正式生成）" : "销售回复与策略" : activeResult.structuredDelivery.preview ? "客户成品预览（非正式生成）" : "客户可复制成品" : activeResult ? isControlledTextPreview ? `${findTask(CAPABILITY_TO_TOOL[activeResult.capabilityId || ""])?.label ?? "美业结果"}流程预览（非正式生成）` : findTask(CAPABILITY_TO_TOOL[activeResult.capabilityId || ""])?.label ?? "美业获客结果" : "等待生成"}</h2></div>{activeResult && <button type="button" onClick={() => void copyResult()}>{activeResult.capabilityId === "beauty_sales" ? "复制可发送回复" : activeResult.structuredDelivery ? activeResult.structuredDelivery.preview ? "复制客户成品预览（非正式）" : "复制客户成品" : isControlledTextPreview ? "复制流程预览（非正式）" : "复制当前结果"}</button>}</header>
      {activeResult ? <>
        <div className="beautyIndustryMeta"><span>{activeResult.creditCost} 积分</span><span>{activeResult.usageChannel === "mcp" ? "WorkBuddy" : "网页"}</span><span>本次使用：{activeResult.abilityUsed ?? findTask(CAPABILITY_TO_TOOL[activeResult.capabilityId || ""])?.label ?? "美业能力"}</span><span>{new Date(activeResult.createdAt).toLocaleString()}</span></div>
        {activeResult.structuredDelivery?.version === "beauty-xhs-delivery-v2" ? <BeautyXhsStructuredResult delivery={activeResult.structuredDelivery as BeautyXhsDelivery} /> : activeResult.structuredDelivery?.version === "beauty-sales-delivery-v1" ? <BeautySalesStructuredResult delivery={activeResult.structuredDelivery as BeautySalesDelivery} /> : activeResult.capabilityId === "beauty_xiaohongshu_package" ? <details className="beautyXhsLegacyResult"><summary>旧流程结果，不作为客户成品</summary><div className="beautyIndustryMarkdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{activeResult.output}</ReactMarkdown></div></details> : <div className="beautyIndustryMarkdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{activeResult.output}</ReactMarkdown></div>}
        {activeResult.capabilityId === "beauty_xiaohongshu_package" && <section className="beautyIndustryMediaPackage">
          <header><div><strong>同一图文任务的真实生成配图</strong><p>{mediaBatchStatus === "quality_failed" ? "图片未达到交付标准，不建议使用；不合格原图只保留供内部审核。" : mediaQuote?.message ?? "正在加载图片计划与历史状态…"}</p></div>{mediaQuote && <span>{mediaQuote.creditCost} 积分 · {mediaQuote.imageCount} 张</span>}</header>
          {mediaQuote?.imagePlan && <section className="beautyXhsImagePlan" data-plan-version={mediaQuote.imagePlan.version}><header><div><span>与文字成品关联</span><strong>{mediaQuote.imagePlan.linkedTitle}</strong></div><em>{mediaQuote.imagePlan.ratio} 竖图</em></header><div>{mediaQuote.imagePlan.directions.map((direction) => <article key={direction.role}><strong>{direction.label}</strong><p>{direction.purpose}</p><small>{direction.composition} · {direction.textStrategy}</small></article>)}</div><p>{mediaQuote.imagePlan.customerBoundary}</p><small>{mediaQuote.imagePlan.rightsBoundary}</small></section>}
          {mediaBatchStatus === "quality_failed" && <p className="beautyIndustryMediaQualityFail" role="alert">技术生成成功不等于客户可用。本批次未交付完整合格图片，未提供不合格图下载，也不会自动重试、补图或换模型。</p>}
          {mediaJobs.length > 0 ? <>
            <div className="beautyIndustryMediaGrid">{mediaJobs.map((job, index) => <article key={job.id} className={job.customerUsable ? "qualityPassed" : job.qualityStatus === "rejected" ? "qualityRejected" : job.qualityStatus === "manual_review_required" ? "qualityReviewRequired" : ""}>
              <div>{job.customerUsable && mediaObjectUrls[job.id] ? <img src={mediaObjectUrls[job.id]} alt={`小红书配图 ${index + 1}`} /> : <span>{job.qualityStatus === "rejected" ? "内部审核已隔离" : job.qualityStatus === "manual_review_required" ? "等待人工复核，暂不交付" : job.status === "succeeded" ? "等待质量检查" : job.failureStage ? "本地交付链未完成" : `生成进度 ${job.progress}%`}</span>}</div>
              <p>{job.customerUsable ? "已通过客户质量检查" : job.qualityStatus === "rejected" ? "未达到交付标准，不建议使用" : job.qualityStatus === "manual_review_required" ? "证据不足，当前不可查看或下载" : job.status === "failed" ? job.errorMessage ?? "生成失败，未自动重试" : job.status === "canceled" ? "已取消" : "图片生成中"}</p>
              {job.customerUsable ? <button type="button" onClick={() => void downloadImage(job, index)}>下载合格图片</button> : job.canCancel ? <button type="button" onClick={() => void cancelMediaJob(job.id)}>取消任务</button> : null}
            </article>)}</div>
            <details className="beautyIndustryMediaAudit"><summary>内部图片质量审核</summary><ul>{mediaJobs.map((job, index) => <li key={job.id}>第 {index + 1} 张：技术状态 {job.technicalStatus}；质量状态 {job.qualityStatus === "passed" ? "通过" : job.qualityStatus === "rejected" ? "已拒绝" : job.qualityStatus === "manual_review_required" ? "需人工复核（不可交付）" : "待检查"}{job.failureStage ? `；交付链阶段 ${beautyMediaPersistenceStageLabel(job.failureStage)}（不可自动重试）` : ""}{job.qualityReasons.length ? `；风险筛查 ${job.qualityReasons.map(beautyMediaRiskLabel).join("、")}` : ""}{job.qualityEvidence.length ? <ul>{job.qualityEvidence.map((item, evidenceIndex) => <li key={`${job.id}-${evidenceIndex}`}>{beautyMediaDetectorLabel(item.detectorType)} · 置信度 {Math.round(item.confidence * 100)}% · 区域 x{item.bbox.x}/y{item.bbox.y}/w{item.bbox.width}/h{item.bbox.height} · {beautyMediaMetricSummary(item.metrics)}</li>)}</ul> : null}</li>)}</ul><small>这是确定性风险筛查，不代表系统理解全部画面；证据不足时进入人工复核状态并保持客户不可见。</small></details>
            {mediaJobs.some((job) => job.canRecover || !["succeeded", "failed", "canceled"].includes(job.status)) && <button type="button" disabled={mediaLoading} aria-disabled={mediaLoading} onClick={() => void resumeMediaJobs()}>{mediaLoading ? "正在恢复状态…" : "恢复图片任务状态"}</button>}
          </> : <button type="button" className="beautyIndustryPrimary" disabled={!mediaQuote?.canConfirm || mediaLoading} aria-disabled={!mediaQuote?.canConfirm || mediaLoading} onClick={() => void confirmImages(mediaQuote?.imagePlan.linkedTitle ?? "")}>{mediaLoading ? "正在生成真实图片…" : mediaQuote ? `确认真实生成三张图片｜${mediaQuote.creditCost} 积分` : "正在加载图片计划…"}</button>}
          <small>确认后按本次文字与视觉计划生成三张可下载成品；逐图通过质量检查后才进入客户图库，失败不自动重试。</small>
        </section>}
        {nextSteps.length > 0 && <div className="beautyIndustryNextSteps"><span>继续当前流程</span>{nextSteps.map((tool) => { const task = findTask(tool)!; return <button key={tool} type="button" disabled={loading} onClick={() => generateNext(tool)}>生成{task.label}｜预计{task.credits}积分</button>; })}<small>点击即确认本次费用；会携带当前结果和门店档案真实生成，重复请求由服务端幂等。</small></div>}
      </> : <div className="beautyIndustryEmpty"><h3>填写本页任务资料后开始生成</h3><p>结果会保存到当前租户任务历史，刷新后可恢复。</p></div>}
    </article>
  </section>}
    {!isXhsWorkspace && !isContentTenWorkspace && !isVideoDataReviewWorkspace && !isLiveReviewWorkspace && <section className="beautyIndustryHistory"><div><span className="beautyIndustryKicker">任务历史</span><h2>网页与 WorkBuddy 共用</h2><p>选择记录只恢复结果，不会再次调用或扣费。</p></div><div className="beautyIndustryHistoryList">{history.length ? history.map((run) => <button key={run.id} type="button" className={activeResult?.id === run.id ? "active" : ""} onClick={() => openHistoryRun(run)}><strong>{findTask(CAPABILITY_TO_TOOL[run.capabilityId || ""])?.label ?? "美业获客结果"}</strong><span>{run.usageChannel === "mcp" ? "WorkBuddy" : "网页"} · {run.creditCost} 积分</span><time>{new Date(run.createdAt).toLocaleString()}</time></button>) : <p>还没有已保存任务。</p>}</div></section>}
  </div>);
}

function BeautyXhsStructuredResult({ delivery }: { delivery: BeautyXhsDelivery }) {
  return <div className="beautyXhsStructuredResult">
    {delivery.preview && <p className="beautyXhsPreviewNotice">流程预览（非正式生成）：这是受控测试环境结果，不代表真实模型质量，也不是正式发布结果。</p>}
    <section className="beautyXhsCustomerDeliverable"><span>客户可复制成品</span><ol>{delivery.customerDeliverable.titles.map((title) => <li key={title}>{title}</li>)}</ol><p>{delivery.customerDeliverable.body}</p><div className="beautyXhsTags">{delivery.customerDeliverable.tags.map((tag) => <span key={tag}>{tag}</span>)}</div><aside><strong>互动与承接</strong><p>{delivery.customerDeliverable.engagement}</p></aside></section>
    <details className="beautyXhsAuditReceipt"><summary>质量与合规检查（内部审核）</summary><ReactMarkdown remarkPlugins={[remarkGfm]}>{delivery.auditReceipt.markdown}</ReactMarkdown></details>
  </div>;
}

function beautyMediaRiskLabel(reason: string): string {
  if (reason === "qr_or_barcode_like") return "二维码/条形码样式";
  if (reason === "visible_text_or_brand_like") return "可见文字或品牌样式";
  if (reason === "interface_or_watermark_like") return "界面或水印样式";
  if (reason === "person_or_device_like") return "人物、手部或电子设备样式";
  if (reason === "unsupported_image_format") return "暂不支持的安全检查格式";
  return "图片无法完成确定性安全检查";
}

function beautyMediaDetectorLabel(detectorType: string): string {
  if (detectorType === "qr_finder_pattern") return "二维码 finder 组合";
  if (detectorType === "barcode_stripes") return "条码平行条纹";
  if (detectorType === "glyph_sequence") return "连续字形轮廓";
  if (detectorType === "corner_watermark") return "角落水印字形";
  if (detectorType === "ui_layout") return "界面网格布局";
  return "图片格式检查";
}

function beautyMediaPersistenceStageLabel(stage: string): string {
  if (stage === "url_validation") return "来源安全校验";
  if (stage === "download_request" || stage === "download_response") return "安全下载";
  if (stage === "content_type" || stage === "payload_size") return "文件格式校验";
  if (stage === "path_resolution" || stage === "directory_prepare") return "本地存储准备";
  if (stage === "image_write" || stage === "metadata_write" || stage === "image_commit" || stage === "metadata_commit") return "本地原子保存";
  if (stage === "asset_verify") return "本地文件校验";
  if (stage === "quality_screen") return "本地质量筛查";
  return "本地交付准备";
}

function beautyMediaMetricSummary(metrics: Record<string, string | number | boolean>): string {
  return Object.entries(metrics).slice(0, 4).map(([key, value]) => `${key}=${String(value)}`).join("，");
}

function BeautySalesStructuredResult({ delivery }: { delivery: BeautySalesDelivery }) {
  return <div className="beautySalesStructuredResult">
    {delivery.preview && <p className="beautyXhsPreviewNotice">流程预览（非正式生成）：用于验证销售工作流，不代表真实模型质量或个性化最终方案。</p>}
    <section className="beautySalesPrimaryReply"><span>{delivery.resultType === "quick_response" ? "通用初步回复" : "专业模式回复"}</span><h3>建议先这样回复</h3><p>{delivery.customerDeliverable.primaryReply}</p></section>
    <div className="beautySalesGuidanceGrid"><article><h3>为什么这样回</h3><p>{delivery.customerDeliverable.rationale}</p></article><article><h3>顾客可能的下一句</h3><p>{delivery.customerDeliverable.likelyNextReply}</p></article><article><h3>你接下来问什么</h3><p>{delivery.customerDeliverable.nextQuestion}</p></article></div>
    <details className="beautySalesStrategyDetails"><summary>展开完整策略详情</summary><ReactMarkdown remarkPlugins={[remarkGfm]}>{delivery.productionNotes.markdown}</ReactMarkdown></details>
    <details className="beautySalesAuditReceipt"><summary>质量与合规检查（内部审核）</summary><ReactMarkdown remarkPlugins={[remarkGfm]}>{delivery.auditReceipt.markdown}</ReactMarkdown></details>
  </div>;
}

function BeautyPlanningPage({ pageKey }: { pageKey: BeautyPlanningKey }) {
  const page = BEAUTY_PLANNING_PAGES[pageKey];
  return <section className="beautyIndustryIndependentPage beautyIndustryPlanningPage">
    <div className="beautyIndustryPageBreadcrumb"><a href={getAppPath(pageKey === "text-video" || pageKey === "image-video" || pageKey === "viral-replication" ? "/agents/beauty-industry/acquisition/video" : "/agents/beauty-industry")}>{pageKey === "text-video" || pageKey === "image-video" || pageKey === "viral-replication" ? "视频获客" : "美业智能体"}</a><span>/</span>{page.title}</div>
    <header><span>规划中 · 尚未开放</span><h1>{page.title}</h1><p>{page.purpose}</p></header>
    <div className="beautyIndustryPlanningGrid"><article><h2>开放前置条件</h2><ol>{page.prerequisites.map((item) => <li key={item}>{item}</li>)}</ol></article><article><h2>当前能力边界</h2><p>{page.boundary}</p><small>本页仅说明产品规划，不包含可执行按钮、演示数据或伪功能。</small></article></div>
  </section>;
}

function BeautyAcquisitionHomePage({ permittedTools }: { permittedTools: ReadonlySet<string> }) {
  const branches = [
    { key: "xhs", title: "图文获客", path: "/agents/beauty-industry/acquisition/xhs", tools: ["beauty.xiaohongshu_package"], description: "小红书标题、正文、标签和配图方向在同一真实任务中交付。" },
    { key: "video", title: "视频获客", path: "/agents/beauty-industry/acquisition/video", tools: ["beauty.topic_ideas", "beauty.content_ten_pack", "beauty.video_data_review"], description: "从选题、内容系统到真实结构化证据复盘。" },
    { key: "live", title: "直播获客", path: "/agents/beauty-industry/acquisition/live", tools: ["beauty.live_script", "beauty.live_review"], description: "直播话术与直播复盘使用各自固定合同。" }
  ];
  return <section className="beautyIndustryIndependentPage beautyIndustryAcquisitionHomePage">
    <div className="beautyIndustryPageBreadcrumb"><a href={getAppPath("/agents/beauty-industry")}>美业智能体</a><span>/</span>美业获客</div>
    <header><span>已开放模块</span><h1>美业获客</h1><p>图文、视频、直播各自使用稳定子路由；页面不会根据自由文本切换 capability 或 Skill。</p></header>
    <div className="beautyIndustryModuleCards">{branches.map((item) => { const available = item.tools.some((tool) => permittedTools.has(tool)); return <article key={item.key}><span>{available ? "已开放" : "当前租户未开通"}</span><h2>{item.title}</h2><p>{item.description}</p><a href={getAppPath(item.path)}>进入{item.title} →</a></article>; })}</div>
  </section>;
}

function BeautyBranchHomePage({ branch, permittedTools }: { branch: BeautyBranch; permittedTools: ReadonlySet<string> }) {
  const branchDefinition = BRANCH_DEFINITIONS[branch];
  const taskPaths: Record<string, string> = {
    "beauty.xiaohongshu_package": "/agents/beauty-industry/acquisition/xhs",
    "beauty.topic_ideas": "/agents/beauty-industry/acquisition/video/topics",
    "beauty.content_ten_pack": "/agents/beauty-industry/acquisition/video/content",
    "beauty.video_data_review": "/agents/beauty-industry/acquisition/video/data-review",
    "beauty.video_content_review": "/agents/beauty-industry/acquisition/video/content-review",
    "beauty.live_script": "/agents/beauty-industry/acquisition/live/script",
    "beauty.live_review": "/agents/beauty-industry/acquisition/live/review"
  };
  const planned = branch === "video" ? [
    { title: "文生视频", path: "/agents/beauty-industry/acquisition/video/text-to-video" },
    { title: "图生视频", path: "/agents/beauty-industry/acquisition/video/image-to-video" }
  ] : [];
  if (branch === "video") {
    const primaryTasks = branchDefinition.tasks.filter((task) => task.name === "beauty.topic_ideas" || task.name === "beauty.content_ten_pack");
    const reviewAvailable = permittedTools.has("beauty.video_data_review") || permittedTools.has("beauty.video_content_review");
    return <section className="beautyIndustryIndependentPage beautyIndustryBranchHomePage">
      <div className="beautyIndustryPageBreadcrumb"><a href={getAppPath("/agents/beauty-industry/acquisition")}>美业获客</a><span>/</span>{branchDefinition.label}</div>
      <header><span>获客分支</span><h1>{branchDefinition.label}</h1><p>{branchDefinition.summary}</p></header>
      <div className="beautyIndustryModuleCards beautyVideoAcquisitionSixCards">
        {primaryTasks.map((task) => { const available = permittedTools.has(task.name); return <article key={task.name}><span>{available ? "已开放" : "当前租户未开通"}</span><h2>{task.label}</h2><p>{task.hint}</p>{available ? <a href={getAppPath(taskPaths[task.name])}>进入{task.label} →</a> : <small>权限开通后显示真实执行入口；当前不会创建任务或扣费。</small>}</article>; })}
        <article><span>{reviewAvailable ? "已开放" : "当前租户未开通"}</span><h2>复盘系统</h2><p>在独立页面选择视频数据复盘或视频内容复盘，分别使用真实指标或画面与转写证据。</p><a href={getAppPath("/agents/beauty-industry/acquisition/video/review")}>进入复盘系统 →</a></article>
        <article className="planned"><span>规划中</span><h2>爆款复刻</h2><p>查看未来基于获授权参考素材和可核验证据进行结构迁移的能力边界。</p><a href={getAppPath("/agents/beauty-industry/acquisition/video/viral-replication")}>查看规划说明 →</a></article>
        {planned.map((item) => <article key={item.path} className="planned"><span>规划中</span><h2>{item.title}</h2><p>查看用途、开放前置条件和当前能力边界。</p><a href={getAppPath(item.path)}>查看规划说明 →</a></article>)}
      </div>
    </section>;
  }
  return <section className="beautyIndustryIndependentPage beautyIndustryBranchHomePage">
    <div className="beautyIndustryPageBreadcrumb"><a href={getAppPath("/agents/beauty-industry/acquisition")}>美业获客</a><span>/</span>{branchDefinition.label}</div>
    <header><span>获客分支</span><h1>{branchDefinition.label}</h1><p>{branchDefinition.summary}</p></header>
    <div className="beautyIndustryModuleCards">{branchDefinition.tasks.map((task) => { const available = permittedTools.has(task.name); const pending = Boolean(task.pendingValidation); return <article key={task.name} className={pending ? "planned" : ""}><span>{available ? "已开放" : pending ? "媒体成功链待验证" : "当前租户未开通"}</span><h2>{task.label}</h2><p>{task.hint}</p>{available ? <a href={getAppPath(taskPaths[task.name])}>进入{task.label} →</a> : pending ? <a href={getAppPath(taskPaths[task.name])}>准备真实验收资料 →</a> : <small>权限开通后才会显示真实执行入口；当前不会调用或扣费。</small>}</article>; })}{planned.map((item) => <article key={item.path} className="planned"><span>规划中</span><h2>{item.title}</h2><p>查看用途、开放前置条件和当前能力边界。</p><a href={getAppPath(item.path)}>查看规划说明 →</a></article>)}</div>
  </section>;
}

function BeautyVideoReviewHomePage({ permittedTools }: { permittedTools: ReadonlySet<string> }) {
  const reviews = [
    {
      tool: "beauty.video_data_review",
      title: "视频数据复盘",
      path: "/agents/beauty-industry/acquisition/video/data-review",
      description: "上传 CSV 或 Excel，并严格基于成功解析的播放、完播、互动与转化指标复盘。"
    },
    {
      tool: "beauty.video_content_review",
      title: "视频内容复盘",
      path: "/agents/beauty-industry/acquisition/video/content-review",
      description: "基于已授权视频、可核验画面与真实转写证据复盘，不把元数据预检冒充内容理解。"
    }
  ];
  return <section className="beautyIndustryIndependentPage beautyIndustryBranchHomePage beautyVideoReviewHomePage">
    <div className="beautyIndustryPageBreadcrumb"><a href={getAppPath("/agents/beauty-industry/acquisition/video")}>视频获客</a><span>/</span>复盘系统</div>
    <header><span>独立复盘入口</span><h1>复盘系统</h1><p>先选择要核对的数据证据或内容证据；两个工作区保持各自正式合同、权限和历史。</p></header>
    <div className="beautyIndustryModuleCards">{reviews.map((item) => {
      const available = permittedTools.has(item.tool);
      return <article key={item.tool}><span>{available ? "已开放" : "当前租户未开通"}</span><h2>{item.title}</h2><p>{item.description}</p>{available ? <a href={getAppPath(item.path)}>进入{item.title} →</a> : <small>权限开通后显示真实执行入口；当前不会创建任务或扣费。</small>}</article>;
    })}</div>
  </section>;
}

function BeautyNotFoundPage() {
  return <section className="beautyIndustryIndependentPage beautyIndustryNotFoundPage"><header><span>404</span><h1>这个美业页面不存在</h1><p>当前地址没有对应的已开放或规划页面；没有执行任务、调用 Provider 或扣除积分。</p></header><a href={getAppPath("/agents/beauty-industry")}>返回工作台首页</a></section>;
}

function BeautyPermissionState({ pageTitle }: { pageTitle: string }) {
  return <section className="beautyIndustryIndependentPage beautyIndustryPermissionState"><header><span>当前租户未开通</span><h1>{pageTitle}</h1><p>页面路由有效，但服务端权限清单没有返回该能力，因此没有展示执行表单，也不会创建任务或扣除积分。</p></header><a href={getAppPath("/agents/beauty-industry/acquisition")}>返回美业获客</a></section>;
}

function TaskField({ field, options, onChange }: { field: FormField; options: ProfessionalOptions; onChange: (value: ProfessionalOptions) => void }) {
  if (field.type === "imageCount") return <label>{field.label}<select value={options.imageCount} onChange={(e) => onChange({ ...options, imageCount: Number(e.target.value) as 1 | 3 })}><option value={1}>1 张</option><option value={3}>3 张</option></select></label>;
  return <label>{field.label}<input value={String(options[field.key] ?? "")} onChange={(e) => onChange({ ...options, [field.key]: e.target.value })} placeholder={field.placeholder} /></label>;
}
function findTask(name: string): TaskDefinition | undefined { return name === SALES_TASK.name ? SALES_TASK : Object.values(BRANCH_DEFINITIONS).flatMap((value) => value.tasks).find((task) => task.name === name); }
function hasBeautyVideoReviewDataRecords(value: string): boolean {
  if (/(?:播放量|播放次数|完播率|平均播放时长|点赞|评论|分享|有效咨询|预约|到店|成交|核销)[：:\s]+[0-9]/.test(value)) return true;
  const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const headerIndex = lines.findIndex((line) => ((line.match(/作品标题|视频标题|播放量|播放次数|完播率|平均播放时长|点赞|评论|分享|有效咨询|预约|到店|成交|核销/g) ?? []).length >= 2) && /[\t,]/.test(line));
  return headerIndex >= 0 && lines.slice(headerIndex + 1).some((line) => /[\t,]/.test(line) && /[0-9]/.test(line) && !/^【.+】$/.test(line));
}
function hasBeautyLiveReviewDataRecords(value: string): boolean {
  const source = value.normalize("NFKC");
  const metric = /(?:曝光|进房|场观|观看|在线|峰值|停留|互动|评论|点赞|分享|商品点击|项目点击|咨询|私信|留资|预约|到店|订单|成交|核销|GMV|销售额)/i;
  if (metric.test(source) && /(?:^|[^\p{L}\p{N}])\d+(?:\.\d+)?%?/u.test(source)) return true;
  const lines = source.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const headerIndex = lines.findIndex((line) => metric.test(line) && /[,\t|]/.test(line));
  return headerIndex >= 0 && lines.slice(headerIndex + 1).some((line) => /[,\t|]/.test(line) && /\d/.test(line));
}
function branchForTool(name: string): BeautyBranch { return (Object.entries(BRANCH_DEFINITIONS) as Array<[BeautyBranch, BranchDefinition]>).find(([, value]) => value.tasks.some((task) => task.name === name))?.[0] ?? "xhs"; }
function readBeautyRoute(pathOverride?: string): BeautyRoute {
  const sourcePath = pathOverride ?? (typeof window === "undefined" ? "/agents/beauty-industry" : getAppRoutePath(window.location.pathname));
  const path = sourcePath.replace(/\/$/, "") || "/agents/beauty-industry";
  const staticRoutes: Record<string, BeautyRoute> = {
    "/agents/beauty-industry": { view: "home", navKey: "home", pageTitle: "工作台首页", path },
    "/agents/beauty-industry/daily": { view: "daily", navKey: "daily", pageTitle: "美业 AI 日报", path },
    "/agents/beauty-industry/knowledge": { view: "planning", navKey: "knowledge", pageTitle: "美业知识问题", path, planningKey: "knowledge" },
    "/agents/beauty-industry/acquisition": { view: "acquisition-home", navKey: "acquisition", pageTitle: "美业获客", path },
    "/agents/beauty-industry/acquisition/video": { view: "branch-home", navKey: "acquisition", pageTitle: "视频获客", path, branch: "video" },
    "/agents/beauty-industry/acquisition/video/review": { view: "video-review-home", navKey: "acquisition", pageTitle: "复盘系统", path, branch: "video" },
    "/agents/beauty-industry/acquisition/video/viral-replication": { view: "planning", navKey: "acquisition", pageTitle: "爆款复刻", path, planningKey: "viral-replication", branch: "video" },
    "/agents/beauty-industry/acquisition/live": { view: "branch-home", navKey: "acquisition", pageTitle: "直播获客", path, branch: "live" },
    "/agents/beauty-industry/acquisition/video/text-to-video": { view: "planning", navKey: "acquisition", pageTitle: "文生视频", path, planningKey: "text-video", branch: "video" },
    "/agents/beauty-industry/acquisition/video/image-to-video": { view: "planning", navKey: "acquisition", pageTitle: "图生视频", path, planningKey: "image-video", branch: "video" },
    "/agents/beauty-industry/delivery": { view: "planning", navKey: "delivery", pageTitle: "美业专属交付", path, planningKey: "delivery" },
    "/agents/beauty-industry/operations": { view: "planning", navKey: "operations", pageTitle: "美业专属经营", path, planningKey: "operations" },
    "/agents/beauty-industry/profile": { view: "profile", navKey: "profile", pageTitle: "经营档案", path },
    "/agents/beauty-industry/tasks": { view: "tasks", navKey: "tasks", pageTitle: "任务中心", path }
  };
  if (staticRoutes[path]) return staticRoutes[path];
  const routes: Record<string, { branch?: BeautyBranch; toolName: string; pageTitle: string }> = {
    "/agents/beauty-industry/acquisition/xhs": { branch: "xhs", toolName: "beauty.xiaohongshu_package", pageTitle: "图文获客" },
    "/agents/beauty-industry/acquisition/video/topics": { branch: "video", toolName: "beauty.topic_ideas", pageTitle: "选题系统" },
    "/agents/beauty-industry/acquisition/video/content": { branch: "video", toolName: "beauty.content_ten_pack", pageTitle: "内容系统" },
    "/agents/beauty-industry/acquisition/video/content-ten": { branch: "video", toolName: "beauty.content_ten_pack", pageTitle: "内容系统" },
    "/agents/beauty-industry/acquisition/video/data-review": { branch: "video", toolName: "beauty.video_data_review", pageTitle: "视频数据复盘" },
    "/agents/beauty-industry/acquisition/video/content-review": { branch: "video", toolName: "beauty.video_content_review", pageTitle: "视频内容复盘" },
    "/agents/beauty-industry/acquisition/live/script": { branch: "live", toolName: "beauty.live_script", pageTitle: "直播话术" },
    "/agents/beauty-industry/acquisition/live/review": { branch: "live", toolName: "beauty.live_review", pageTitle: "直播复盘" },
    "/agents/beauty-industry/sales": { toolName: "beauty.sales_advice", pageTitle: "美业销售" }
  };
  return routes[path]
    ? { view: "workspace", navKey: routes[path].toolName === SALES_TASK.name ? "sales" : "acquisition", path, ...routes[path] }
    : { view: "not-found", navKey: "home", pageTitle: "页面未找到", path };
}
function beautyRouteForTool(toolName: string): BeautyRoute | null {
  const paths: Record<string, string> = {
    "beauty.xiaohongshu_package": "/agents/beauty-industry/acquisition/xhs",
    "beauty.topic_ideas": "/agents/beauty-industry/acquisition/video/topics",
    "beauty.content_ten_pack": "/agents/beauty-industry/acquisition/video/content",
    "beauty.video_data_review": "/agents/beauty-industry/acquisition/video/data-review",
    "beauty.video_content_review": "/agents/beauty-industry/acquisition/video/content-review",
    "beauty.live_script": "/agents/beauty-industry/acquisition/live/script",
    "beauty.live_review": "/agents/beauty-industry/acquisition/live/review",
    "beauty.sales_advice": "/agents/beauty-industry/sales"
  };
  const path = paths[toolName];
  return path ? readBeautyRoute(path) : null;
}
function calculateProfileCompletion(profile: BeautyProfile | null): number {
  if (!profile) return 0;
  const checks = [
    profile.segment === "other" ? Boolean(profile.customSegment?.trim()) : Boolean(profile.segment),
    Boolean(profile.operationType),
    Boolean(profile.operatingStage),
    profile.services.length > 0,
    Boolean(profile.targetCustomers?.trim()),
    profile.channels.length > 0,
    Boolean(profile.acquisitionGoal?.trim()),
    Boolean(profile.factBoundaries?.trim())
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}
function createXhsOptionsFromProfile(profile: BeautyProfile | null): ProfessionalOptions {
  return {
    ...EMPTY_OPTIONS,
    audience: profile?.targetCustomers ?? "",
    project: profile?.services.join("、") ?? "",
    city: profile?.city ?? "",
    storeFacts: profile?.storeName ?? ""
  };
}
function taskBelongsToBranch(name: string, branch: BeautyBranch): boolean { return BRANCH_DEFINITIONS[branch].tasks.some((task) => task.name === name); }
function pickTaskOptions(task: TaskDefinition, value: ProfessionalOptions): Partial<ProfessionalOptions> { const allowed = new Set(task.formSchema.map((field) => field.key)); return Object.fromEntries(Object.entries(value).filter(([key, item]) => allowed.has(key as OptionKey) && item !== "")) as Partial<ProfessionalOptions>; }
function nextToolsFor(capability?: string): string[] { if (capability === "topic_inspiration") return ["beauty.content_ten_pack"]; if (capability === "content_plan") return ["beauty.video_data_review"]; if (capability === "live_script") return ["beauty.live_review"]; if (capability === "video_data_review") return ["beauty.topic_ideas"]; return []; }
function taskPlaceholder(name: string): string { if (name === "beauty.xiaohongshu_package") return "例如：为夏季基础补水护理做一套面向附近女性顾客的小红书图文"; if (name === "beauty.video_data_review") return "上传数据文件后，说明本次最想复盘的问题；没有的数据请明确写未提供"; if (name === "beauty.live_review") return "填写真实直播数据、材料和原话术；不要粘贴短视频数据"; if (name === "beauty.sales_advice") return "粘贴脱敏后的真实顾客沟通，并说明要诊断、回复还是制定跟进动作"; return "用普通话描述这次想完成的内容和目标"; }
function profileToDraft(profile: BeautyProfile | null): ProfileDraft {
  if (!profile) return EMPTY_PROFILE;
  const knownChannels = profile.channels.filter((channel) => CHANNELS.includes(channel as typeof CHANNELS[number]));
  const customChannel = profile.channels.find((channel) => !CHANNELS.includes(channel as typeof CHANNELS[number]) || channel.startsWith("其他："));
  return { segment: profile.segment, customSegment: profile.customSegment ?? "", operationType: profile.operationType, operatingStage: profile.operatingStage, storeName: profile.storeName ?? "", city: profile.city ?? "", services: profile.services.join("、"), targetCustomers: profile.targetCustomers ?? "", channels: customChannel ? [...knownChannels.filter((item) => item !== "其他"), "其他"] : knownChannels, otherChannel: customChannel?.replace(/^其他：/, "") ?? "", acquisitionGoal: profile.acquisitionGoal ?? "", factBoundaries: profile.factBoundaries };
}
function mergeChannelSelection(current: string[], value: string): string[] { const matched = CHANNELS.find((channel) => value.includes(channel)); return matched && !current.includes(matched) ? [...current, matched] : current; }
function splitList(value: string): string[] { return value.split(/[，,、\n]/).map((item) => item.trim()).filter(Boolean); }
function createContentWorkflowFromProfile(profile: BeautyProfile | null): BeautyContentWorkflowDraft {
  return createEmptyBeautyContentWorkflow({
    objective: profile?.acquisitionGoal ?? "",
    targetAudience: profile?.targetCustomers ?? "",
    platform: profile?.channels[0] || "抖音",
    projectFacts: [profile?.services.join("、"), profile?.factBoundaries].filter(Boolean).join("；"),
    shootingConstraints: profile?.factBoundaries ?? ""
  });
}
function createVideoReviewWorkflowFromProfile(profile: BeautyProfile | null): BeautyVideoReviewWorkflowDraft {
  const videoPlatforms = new Set(["抖音", "视频号", "小红书", "快手", "B站"]);
  const platform = profile?.channels.find((channel) => videoPlatforms.has(channel)) ?? "";
  return createEmptyBeautyVideoReviewWorkflow({ platform });
}
function createVideoContentWorkflowFromProfile(profile: BeautyProfile | null): BeautyVideoContentWorkflowDraft {
  const videoPlatforms = new Set(["抖音", "视频号", "小红书", "快手", "B站"]);
  const platform = profile?.channels.find((channel) => videoPlatforms.has(channel)) ?? "";
  return createEmptyBeautyVideoContentWorkflow({
    platform,
    businessObjective: profile?.acquisitionGoal ?? "",
    targetAudience: profile?.targetCustomers ?? "",
    factBoundary: profile?.factBoundaries ?? ""
  });
}
function createLiveReviewWorkflowFromProfile(profile: BeautyProfile | null): BeautyLiveReviewWorkflowDraft {
  const livePlatforms = new Set(["抖音", "视频号", "小红书", "快手"]);
  const platform = profile?.channels.find((channel) => livePlatforms.has(channel)) ?? "";
  return createEmptyBeautyLiveReviewWorkflow({
    platform,
    businessObjective: profile?.acquisitionGoal ?? "",
    projectEvidence: profile?.services.join("、") ?? "",
    factBoundary: profile?.factBoundaries || "价格、优惠、疗效、案例、顾客身份和未提供数据均不得推断。"
  });
}
class ApiRequestError extends Error {
  constructor(message: string, readonly code: string, readonly status: number) { super(message); }
}
function redirectToBeautyLogin() {
  localStorage.setItem("store_os_post_login_redirect", `${window.location.pathname}${window.location.search}${window.location.hash}`);
  window.location.replace(getAppPath("/login/beauty-industry"));
}
async function readJson<T = unknown>(response: Response): Promise<T> { const body = await response.json().catch(() => ({})) as { message?: string; error?: string }; if (!response.ok) throw new ApiRequestError(body.message || body.error || `请求失败（${response.status}）`, body.error || `http_${response.status}`, response.status); return body as T; }
function isTerminalApiFailure(reason: unknown): boolean {
  return reason instanceof ApiRequestError && reason.code !== "billing_request_in_progress";
}
function isSystemOutputFailure(reason: unknown): boolean {
  return reason instanceof ApiRequestError && [
    "beauty_output_contract_failed",
    "beauty_topic_output_pollution",
    "beauty_topic_output_structure_invalid",
    "beauty_topic_output_validation_failed"
  ].includes(reason.code);
}
function friendlyError(reason: unknown, fallback: string): string {
  if (reason instanceof DOMException && reason.name === "AbortError") return "本次请求已取消";
  if (reason instanceof TypeError && /fetch|network|load failed/i.test(reason.message)) return "网络连接失败，本次任务未完成；请检查网络后重试，不会自动重复调用或扣费。";
  return reason instanceof Error ? reason.message : fallback;
}
function assessXhsWebReadiness(input: { question: string; project: string; audience: string }): string[] {
  return [
    input.question.trim().length >= 6 ? undefined : "本次主题与目的",
    input.project.trim().length >= 2 ? undefined : "本次项目",
    input.audience.trim().length >= 2 ? undefined : "目标顾客"
  ].filter((value): value is string => Boolean(value));
}

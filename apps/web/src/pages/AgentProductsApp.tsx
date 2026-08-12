import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import chainBrandIpAcquisitionAvatar from "../assets/chain-brand-ip-acquisition-agent.jpg";
import { apiPath, getAppPath } from "../lib/api.js";
import { inferAcquisitionCapability, resolveAcquisitionTaskCapabilities, scopeAcquisitionCapabilityHistory } from "../lib/acquisition-routing.js";
import { ChatComposer, type AcquisitionComposerCapabilityId } from "../components/chat/ChatComposer.js";
import { AgentAutomationDrawer } from "../components/automation/AgentAutomationDrawer.js";
import { TopicSystemWorkbench, type TopicSystemGenerationRequest, type TopicSystemTurn } from "../components/acquisition/TopicSystemWorkbench.js";
import { ContentSystemWorkbench, type ContentSystemTurn } from "../components/acquisition/ContentSystemWorkbench.js";
import { PaidTrafficWorkbench, type TrafficMode } from "../components/acquisition/PaidTrafficWorkbench.js";
import { VideoReviewWorkbench } from "../components/acquisition/VideoReviewWorkbench.js";
import { LiveScriptWorkbench, type LiveScriptTurn } from "../components/acquisition/LiveScriptWorkbench.js";
import { LiveReviewWorkbench, type LiveReviewTurn } from "../components/acquisition/LiveReviewWorkbench.js";
import { TakeawayGrowthDataPanel } from "../components/takeaway/TakeawayGrowthDataPanel.js";
import { TakeawayGrowthWorkbench } from "../components/takeaway/TakeawayGrowthWorkbench.js";
import { AgentWorkMap } from "../components/work-map/AgentWorkMap.js";
import { CeoKnowledgeAnalysisPanel } from "../components/ceo/CeoKnowledgeAnalysisPanel.js";
import type { TakeawayWorkbenchDataStatus } from "../components/takeaway/takeaway-workbench-config.js";
import type { ConsultantId } from "../types/index.js";
import { normalizeFilenamePart } from "../lib/utils.js";
import { currentDeviceScope } from "../lib/device-scope.js";
import { formatStructuredSectionMarkdown } from "../lib/structured-answer.js";
import {
  DEFAULT_TENANT_BRANDING,
  clearTenantBrandingCache,
  normalizeTenantBranding,
  publishTenantBranding,
  tenantBrandLogoSrc,
  useTenantBranding
} from "../lib/tenant-branding.js";
import ClipLabApp from "./ClipLabApp.js";
import {
  isTenantBrandedAgent,
  tenantAgentDisplayName,
  type AgentReasoningProfile,
  type AgentWorkMapDefinition,
  type DeviceScope,
  type StableAgentDelivery,
  type TenantBrandingConfig
} from "@baolu/shared";

interface AgentCapabilityView {
  key: string;
  title: string;
  subtitle: string;
  promptTemplate?: string;
}

interface AgentView {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon?: string;
  status: "active" | "coming_soon" | "draft" | "archived";
  entitled: boolean;
  marketing?: {
    eyebrow?: string;
    headline?: string;
    promise?: string;
    audience?: string;
    shortName?: string;
    method?: string;
    tagline?: string;
    automationAction?: {
      enabled: boolean;
      buttonLabel: string;
      defaultTaskType: string;
      defaultInstruction: string;
      allowedTaskTypes: string[];
      capabilityId?: string;
    };
    workMap?: AgentWorkMapDefinition;
  };
  knowledgeAction?: {
    enabled: boolean;
    buttonLabel: string;
    defaultInstruction: string;
    allowedDocumentTypes: string[];
    capabilityId?: string;
  };
  automationAction?: {
    enabled: boolean;
    buttonLabel: string;
    defaultTaskType: string;
    defaultInstruction: string;
    allowedTaskTypes: string[];
    capabilityId?: string;
  };
  capabilities: AgentCapabilityView[];
}

interface KnowledgeSourceView {
  id: string;
  title: string;
  documentType: string;
  occurredAt?: string | null;
  knowledgeLayer?: string;
  autoIncluded?: boolean;
}

interface KnowledgeSubjectView {
  id: string;
  subjectType: "enterprise" | "ip" | "brand" | "client_project";
  typeLabel?: string;
  name: string;
  industry?: string;
  isDefault?: boolean;
  documentCount?: number;
  autoDocumentCount?: number;
  recommendedDocumentCount?: number;
}

interface AgentCatalogResponse {
  agents: AgentView[];
  allAgents?: AgentView[];
  defaultEntry?: string | null;
  creditBalance?: number;
}

interface WorkbuddyConnectionView {
  id: string;
  label: string;
  tokenPrefix: string;
  status: string;
  lastUsedAt?: string | null;
  createdAt: string;
  agent: { id: string; name: string; slug: string };
}

interface WorkbuddyConnectionsResponse {
  enabled: boolean;
  mcpUrl: string;
  connections: WorkbuddyConnectionView[];
}

interface ProductMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  agentRunId?: string;
  capabilityId?: string;
  analysisMode?: "fast" | "deep";
  analysisBrief?: AgentAnalysisBrief;
  nextActions?: string[];
  knowledgeSources?: KnowledgeSourceView[];
  ipVoiceStyleApplied?: boolean;
  ipVoiceStyleConfidence?: "high" | "medium" | "low";
  deliveryStatus?: "completed" | "needs_input" | "failed";
  reasoningProfile?: AgentReasoningProfile;
  stableDelivery?: StableAgentDelivery;
  execution?: AgentExecutionView;
}

function takeawayDialogueMode(content: string): "ask" | "revise" | undefined {
  const match = content.match(/^【外卖任务对话｜[^｜】]+(?:｜(ask|revise))?】/);
  if (!match) return undefined;
  // Messages created before the mode selector were ordinary follow-up
  // questions, even though the old UI accidentally replaced the task result.
  return match[1] === "revise" ? "revise" : "ask";
}

function latestTakeawayPrimaryAssistant(messages: ProductMessage[]): ProductMessage | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role !== "assistant") continue;
    let userIndex = index - 1;
    while (userIndex >= 0 && messages[userIndex]?.role !== "user") userIndex -= 1;
    if (userIndex < 0) return messages[index] ?? null;
    const dialogueMode = takeawayDialogueMode(messages[userIndex]?.content ?? "");
    if (!dialogueMode || dialogueMode === "revise") return messages[index] ?? null;
  }
  return null;
}

interface AgentExecutionView {
  planId?: string;
  mode?: "single" | "parallel" | "sequential" | "hybrid";
  steps: Array<{
    stepId: string;
    capabilityId?: string;
    skillId: string;
    skillVersion: string;
    status: "success" | "needs_input" | "failed";
    durationMs: number;
    qualityFlags: string[];
    error?: { code: string; retryable: boolean };
  }>;
}

interface AgentWorkspaceTask {
  id: string;
  deviceScope: DeviceScope;
  title: string;
  customTitle?: string;
  messages: ProductMessage[];
  conversationId?: string;
  capabilityId?: string;
  updatedAt: string;
  loaded: boolean;
  knowledgeDocumentIds: string[];
  knowledgeSubjectId?: string;
  customerProfile?: TaskCustomerProfile;
  draft: AgentWorkspaceDraft;
}

interface TaskCustomerProfile {
  name?: string;
  industry?: string;
  targetCustomer?: string;
  city?: string;
  storeScale?: string;
  currentProblem?: string;
  growthGoal?: string;
  platforms?: string;
}

interface AgentWorkspaceDraft {
  deviceScope: DeviceScope;
  content: string;
  updatedAt: string;
}

interface AgentWorkspaceTaskState {
  tasks: AgentWorkspaceTask[];
  activeTaskId: string;
}

interface AgentTaskPreference {
  title?: string;
  hidden?: boolean;
}

interface SmartArtifactView {
  id: string;
  title: string;
  content: string;
  version: number;
}

const DELIVERY_CAPABILITY_TITLES = [
  "行业热点",
  "选题灵感",
  "内容文案",
  "文案创作",
  "投流系统",
  "招商获客",
  "拍剪优化",
  "视频复盘",
  "直播话术",
  "朋友圈私域",
  "餐饮经营诊断",
  "外卖订单增长",
  "外卖增长总诊断",
  "AI找问题与路由",
  "老店增长",
  "新店业绩突破",
  "数据口径审计",
  "菜单货盘与利润",
  "活动投放诊断",
  "活动成本 / 投放诊断",
  "流失竞品诊断",
  "单变量增长实验",
  "周期复盘与决策",
  "堂食到店增长",
  "连锁门店增长",
  "餐饮招商加盟"
];

const ACQUISITION_SCENARIO_STARTERS = [
  {
    id: "content_growth",
    title: "内容获客增长",
    subtitle: "选题 / 短视频 / 直播 / 朋友圈",
    capabilityIds: ["industry_hotspots", "content_plan", "live_script"],
    prompt: "请为【品牌/IP/客户项目名称】制定内容获客增长方案。行业：【请填写】；目标客户：【请填写】；当前内容卡点：【请填写】；发布平台：【抖音/视频号/小红书/朋友圈】。请先区分已确认事实与待补信息，并联合交付：1. 有来源的行业热点与待验证选题；2. 7天短视频与朋友圈内容计划；3. 60分钟内容型直播话术与私信承接。只做内容、直播、朋友圈和内容投流，不诊断任何外卖或其他经营平台。"
  },
  {
    id: "beauty_store_growth",
    title: "美业到店增长",
    subtitle: "消费者获客 / 预约 / 到店复购",
    capabilityIds: ["topic_inspiration", "content_plan", "private_domain"],
    prompt: "请为【美业品牌/门店名称】制定消费者到店增长方案。细分品类：【皮肤管理/美容/美甲美睫等】；城市/商圈：【请填写】；主推项目：【请填写】；当前问题：【请填写】。请组合选题、短视频文案和朋友圈私域承接，输出从本地曝光、有效咨询、预约、实际到店到复购的7天动作与核心指标；不要转成培训招生或店长合伙人招募。"
  },
  {
    id: "restaurant_franchise_growth",
    title: "餐饮招商加盟",
    subtitle: "加盟内容 / 线索 / 考察签约",
    capabilityIds: ["franchise_acquisition", "live_script", "private_domain"],
    prompt: "请为【餐饮连锁品牌名称】制定招商加盟增长方案。餐饮品类：【请填写】；目标加盟商：【请按真实情况填写：身份/经验、是否本人经营、预算区间、计划区域、能否接受标准化；参考写法：有餐饮经验、愿意全职经营、预算10万元以内、计划在沈阳开店、接受统一供应链和培训的夫妻创业者或餐饮店老板】；重点区域：【请填写】；当前招商卡点：【请填写】。请组合招商短视频、60分钟完整招商直播话术包和私域承接，输出线索筛选、考察转化与30天行动计划；参考内容不得当成真实事实，不得承诺收益。"
  },
  {
    id: "beauty_franchise_growth",
    title: "美业招商加盟",
    subtitle: "加盟获客 / 线索筛选 / 考察签约",
    capabilityIds: ["franchise_acquisition", "live_script", "private_domain"],
    prompt: "请为【美业连锁品牌名称】制定招商加盟增长方案。细分品类：【皮肤管理/美容/美甲美睫等】；门店模型：【请填写】；目标加盟商：【请按真实情况填写：经验/资源、是否本人经营、预算、区域、标准化接受度；参考写法：有本地女性客群资源、愿意本人参与经营、预算20至30万元、计划在二三线城市开店、接受统一品牌与运营标准的创业者】；重点区域：【请填写】；当前招商卡点：【请填写】。请组合招商短视频、招商直播话术和朋友圈私域承接，输出加盟线索筛选、到店考察、签约跟进与30天行动计划；参考内容不得当成真实事实，不得承诺收益，不要转成培训招生或店长合伙人培养。"
  }
] as const;

const RESTAURANT_SCENARIO_STARTERS = [
  {
    id: "restaurant_takeaway_growth",
    title: "外卖订单增长",
    subtitle: "美团 / 饿了么 / 淘宝闪购",
    capabilityIds: ["takeaway_growth", "content_plan"],
    prompt: "请为【餐饮品牌/门店名称】制定线上外卖订单增长方案。城市：【请填写】；门店数量：【请填写】；主要成交平台：【美团/饿了么/淘宝闪购】；当前问题：【请填写】。短视频只负责本地曝光、菜品种草与品牌搜索，成交回到外卖平台，不要默认抖音团购。请先完成外卖漏斗诊断，再给7天优先动作和可直接拍摄的内容第一版；未提供的菜品、套餐、价格、优惠与经营数据用【待补】标记。"
  },
  {
    id: "restaurant_dine_in_growth",
    title: "堂食到店增长",
    subtitle: "曝光 / 到店 / 消费 / 复购",
    capabilityIds: ["dine_in_growth", "content_plan", "private_domain"],
    prompt: "请为【餐饮品牌/门店名称】制定堂食到店增长方案。城市/商圈：【请填写】；主推消费场景：【请填写】；当前问题：【请填写】。请先诊断本地曝光、搜索咨询、实际到店、消费体验和复购漏斗，再组合短视频内容与私域承接给出7天行动计划；不要把播放、点赞或咨询直接写成到店结果。"
  },
  {
    id: "restaurant_chain_growth",
    title: "连锁门店增长",
    subtitle: "单店模型 / 门店分层 / 样板复制",
    capabilityIds: ["chain_store_growth"],
    prompt: "请为【餐饮连锁品牌名称】制定连锁门店增长方案。现有门店数量与城市：【请填写】；门店经营模型：【堂食/外卖/复合】；当前共性问题：【请填写】。请区分总部与门店责任，先给统一数据口径、门店分层、样板店试点和复制机制；没有各店真实数据时只给采集模板，不生成假排名。"
  },
  {
    id: "restaurant_franchise_growth",
    title: "餐饮招商加盟",
    subtitle: "内容获客 / 线索 / 考察签约",
    capabilityIds: ["franchise_acquisition", "content_plan", "private_domain"],
    prompt: "请为【餐饮连锁品牌名称】制定招商加盟增长方案。餐饮品类：【请填写】；目标加盟商：【请按真实情况填写：身份/经验、是否本人经营、预算区间、计划区域、标准化接受度；参考写法：有餐饮经验、愿意全职经营、预算10万元以内、计划在沈阳开店、接受统一供应链和培训的夫妻创业者或餐饮店老板】；重点区域：【请填写】；当前招商卡点：【请填写】。请先诊断招商漏斗，再组合招商内容与私域承接给出30天行动计划；参考内容不得当成真实事实，未提供的政策、费用、案例、收益和回本周期用【待补】标记，不得承诺收益。"
  }
] as const;

const TAKEAWAY_SCENARIO_STARTERS = [
  {
    id: "mature_store_growth",
    title: "老店增长",
    subtitle: "找出成熟门店的增长瓶颈",
    capabilityIds: ["mature_store_growth"],
    prompt: "请为【品牌名称】的老店做外卖增长诊断。门店名称：【请填写】；平台：【美团/饿了么/淘宝闪购】；分析周期：【请填写】；当前月有效完成单和目标：【请填写】。请用本店历史基线和可比兄弟门店判断曝光、进店、商品、下单、客单、利润、履约和复购的最大瓶颈，保护已验证有效的动作，并生成一个待审批的单变量增量实验。"
  },
  {
    id: "new_store_breakthrough",
    title: "新店业绩突破",
    subtitle: "7天 / 14天 / 30天冷启动",
    capabilityIds: ["new_store_breakthrough"],
    prompt: "请为【品牌名称】的新店制定外卖业绩突破计划。门店名称：【请填写】；开业日和平台上线日：【请填写】；商圈和配送半径：【请填写】；首月有效完成单和利润目标：【请填写】。请选择可比成熟门店作为样板，区分可复制经验和必须重新验证的变量，输出7天、14天、30天行动计划及第一轮待审批实验。"
  },
  {
    id: "takeaway_data_audit",
    title: "接入门店数据",
    subtitle: "先核对口径，再开始诊断",
    capabilityIds: ["takeaway_data_audit"],
    prompt: "请审计【品牌名称】的外卖经营数据。门店名称：【请填写】；门店阶段：【老店/新店】；平台和周期：【请填写】。请核对逐单、日报、商品、活动投放、成本、履约和竞品数据，建立有效完成单与贡献毛利口径，输出可用字段、冲突项、缺失项和最小补数清单。"
  },
  {
    id: "takeaway_experiment",
    title: "创建增长实验",
    subtitle: "执行、止损、反馈与复盘",
    capabilityIds: ["takeaway_experiment"],
    prompt: "请把【品牌名称】当前最优先的外卖问题设计成7至14天单变量实验。门店名称和阶段：【请填写】；问题和证据：【请填写】。请写清基线期、排除日、测试期、唯一变量、保持不变项、订单与利润护栏、止损条件、负责人、审批人、执行回传要求和复盘日。"
  }
] as const;

const ACQUISITION_SYSTEM_ENTRIES = [
  {
    capabilityId: "topic_inspiration",
    icon: "题",
    title: "招商选题系统",
    subtitle: "招商行业、对标、录音、复盘四源选题"
  },
  {
    capabilityId: "content_plan",
    icon: "文",
    title: "招商内容系统",
    subtitle: "固定调用招商内容 Skill"
  },
  {
    capabilityId: "paid_traffic",
    icon: "投",
    title: "招商投流系统",
    subtitle: "招商线索 DOU+ / 本地推诊断"
  },
  {
    capabilityId: "video_review",
    icon: "盘",
    title: "招商内容复盘",
    subtitle: "固定调用招商内容复盘 Skill"
  },
  {
    capabilityId: "live_script",
    icon: "播",
    title: "招商直播系统",
    subtitle: "固定调用招商直播话术 Skill"
  },
  {
    capabilityId: "live_review",
    icon: "复",
    title: "招商直播复盘",
    subtitle: "固定调用招商直播复盘 Skill"
  }
] as const;

const STORE_ACQUISITION_SYSTEM_ENTRIES = [
  { capabilityId: "topic_inspiration", icon: "题", title: "门店选题系统", subtitle: "商圈、对标、录音、复盘四源选题" },
  { capabilityId: "content_plan", icon: "文", title: "到店内容系统", subtitle: "固定调用门店内容 Skill" },
  { capabilityId: "paid_traffic", icon: "投", title: "门店投流系统", subtitle: "团购承接 DOU+ / 本地推诊断" },
  { capabilityId: "video_review", icon: "盘", title: "门店内容复盘", subtitle: "固定调用门店内容复盘 Skill" },
  { capabilityId: "live_script", icon: "播", title: "门店直播系统", subtitle: "固定调用门店直播话术 Skill" },
  { capabilityId: "live_review", icon: "复", title: "门店直播复盘", subtitle: "固定调用门店直播复盘 Skill" }
] as const;

function isAcquisitionWorkspace(slug: string): boolean {
  return slug === "acquisition" || slug === "store-acquisition";
}

function acquisitionSystemEntriesFor(slug: string) {
  return slug === "store-acquisition" ? STORE_ACQUISITION_SYSTEM_ENTRIES : ACQUISITION_SYSTEM_ENTRIES;
}

function splitTopLevelDeliverables(content: string): Array<{ title: string; content: string }> {
  const lines = content.split(/\r?\n/);
  const titlePattern = new RegExp(`^(?:[一二三四五六七八九十]+|\\d+)[、.]\\s*(${DELIVERY_CAPABILITY_TITLES.join("|")})\\s*$`);
  const boundaries = lines.flatMap((line, index) => {
    const match = line.trim().match(titlePattern);
    return match ? [{ index, title: match[1] }] : [];
  });
  if (boundaries.length < 2) return [];
  return boundaries.map((boundary, index) => {
    const nextIndex = boundaries[index + 1]?.index ?? lines.length;
    const body = lines.slice(boundary.index + 1, nextIndex).join("\n").trim();
    return {
      title: boundary.title,
      content: `${boundary.title}完整交付\n\n${body}`.trim()
    };
  }).filter((item) => item.content.length > item.title.length + 8);
}

function buildSmartArtifacts(messages: ProductMessage[]): SmartArtifactView[] {
  const assistantMessages = [...messages].reverse().filter((message) =>
    message.role === "assistant"
    && message.content.trim().length > 80
    && !/^现在还不能直接生成选题|^请先补充.{0,8}关键信息/.test(message.content.trim())
  );
  return assistantMessages.flatMap((message, messageIndex) => {
    const deliveries = splitTopLevelDeliverables(message.content);
    if (deliveries.length > 1) {
      return deliveries.map((delivery, deliveryIndex) => ({
        id: `${message.id}:${deliveryIndex}:${delivery.title}`,
        title: `${delivery.title}完整版`,
        content: delivery.content,
        version: assistantMessages.length - messageIndex
      }));
    }
    const preview = buildCompactAnswerPreview(message.content);
    return [{
      id: message.id,
      title: preview.title,
      content: message.content,
      version: assistantMessages.length - messageIndex
    }];
  });
}

function TenantBrandMark({ branding }: { branding: TenantBrandingConfig }) {
  const logoSource = tenantBrandLogoSrc(branding);
  return <><span className={`tenantBrandLogo ${logoSource ? "hasImage" : ""}`} style={{ background: logoSource ? undefined : branding.primaryColor }}>{logoSource ? <img src={logoSource} alt={`${branding.brandName} Logo`} /> : branding.brandName.slice(0, 2)}</span><strong>{branding.systemName}</strong></>;
}

function AgentAvatar({ agent, className = "", branding }: { agent: Pick<AgentView, "slug" | "icon" | "name">; className?: string; branding?: TenantBrandingConfig }) {
  const isWhiteLabel = Boolean(branding && isTenantBrandedAgent(agent.slug, branding));
  const customBrandLogo = isWhiteLabel && branding ? tenantBrandLogoSrc(branding) : undefined;
  const avatarSource = isWhiteLabel ? customBrandLogo : isAcquisitionWorkspace(agent.slug) ? chainBrandIpAcquisitionAvatar : undefined;
  const avatarName = isWhiteLabel && branding ? branding.brandName : customerAgentName(agent.name);
  return <span className={`agentAvatar ${isWhiteLabel ? "tenantAgentAvatar" : ""} ${className}`.trim()} style={isWhiteLabel && branding && !customBrandLogo ? { background: branding.primaryColor, color: "#fff" } : undefined}>{avatarSource ? <img src={avatarSource} alt={`${avatarName}头像`} /> : isWhiteLabel && branding ? branding.brandName.slice(0, 2) : agent.icon ?? "AI"}</span>;
}

function customerAgentName(name: string): string {
  return name.replace(/agent/gi, "智能体").replace(/智能体智能体/g, "智能体");
}

function isLegacyTopicResult(content: string): boolean {
  return /四维评分|综合分|有效权重/.test(content)
    && /TOP10选题|选题灵感|来源依据/.test(content);
}

function ipVoiceStyleLabel(confidence?: "high" | "medium" | "low"): string {
  if (confidence === "high") return "已参考 IP 表达风格 · 样本充分";
  if (confidence === "medium") return "已参考 IP 表达风格 · 持续学习";
  return "已初步参考 IP 表达风格 · 建议增加本人原话";
}

interface AgentAnalysisBrief {
  goal: string;
  confirmedFacts: Array<{ fact: string; source: string }>;
  findings: Array<{ conclusion: string; evidence: string[]; confidence: "high" | "medium" | "low" }>;
  missingInformation: string[];
}

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("store_os_token");
  const storedProfile = localStorage.getItem("store_os_tenant_profile");
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(storedProfile ? { "x-sitong-profile": encodeURIComponent(storedProfile) } : {})
  };
}

async function recordAgentOutcome(
  agentRunId: string | undefined,
  eventType: "downloaded" | "regenerated" | "continued" | "task_completed",
  eventKey?: string
): Promise<void> {
  if (!agentRunId) return;
  try {
    await fetch(apiPath(`/agent-runs/${encodeURIComponent(agentRunId)}/outcomes`), {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ eventType, eventKey })
    });
  } catch {
    // Telemetry must never block the user's primary task.
  }
}

async function submitAgentFeedback(
  agentRunId: string,
  helpful: boolean,
  reasonCode?: "factual_error" | "not_relevant" | "incomplete" | "format_issue" | "tool_failure"
): Promise<boolean> {
  try {
    const response = await fetch(apiPath(`/agent-runs/${encodeURIComponent(agentRunId)}/feedback`), {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(
        helpful
          ? { feedbackKey: `feedback:${agentRunId}`, rating: 5, reasonCodes: ["user_helpful"] }
          : { feedbackKey: `feedback:${agentRunId}`, rating: 1, issueType: reasonCode ?? "not_helpful", reasonCodes: [reasonCode ?? "user_not_helpful"] }
      )
    });
    return response.ok;
  } catch {
    return false;
  }
}

function adminHeaders(token: string, json = false): Record<string, string> {
  return {
    "x-sitong-admin-token": token,
    ...(json ? { "Content-Type": "application/json" } : {})
  };
}

function navigate(path: string): void {
  window.location.href = getAppPath(path);
}

function loginFor(path: string): void {
  localStorage.setItem("store_os_post_login_redirect", getAppPath(path));
  navigate("/login");
}

function clearCustomerSession(): void {
  clearTenantBrandingCache();
  [
    "store_os_token",
    "store_os_onboarding_token",
    "store_os_tenant_role",
    "store_os_tenant_name",
    "store_os_plan_code",
    "store_os_diagnosis_done",
    "store_os_diagnosis_report",
    "store_os_post_login_redirect",
    "store_os_memory",
    "store_os_tenant_profile"
  ].forEach((key) => localStorage.removeItem(key));
  Object.keys(localStorage)
    .filter((key) => key.startsWith("sitong_trial_token_") || key.startsWith("sitong_trial_claimable_"))
    .forEach((key) => localStorage.removeItem(key));
  Object.keys(sessionStorage)
    .filter((key) => key.startsWith("sitong_agent_messages_") || key.startsWith("sitong_conversation_") || key.startsWith("sitong_agent_tasks_") || key.startsWith("sitong_agent_active_task_") || key.startsWith("sitong_trial_result_") || key.startsWith("sitong_trial_history_"))
    .forEach((key) => sessionStorage.removeItem(key));
}

function logoutCustomer(): void {
  clearCustomerSession();
  navigate("/");
}

async function readJson<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(payload.message ?? payload.error ?? "request_failed"), { status: response.status, payload });
  return payload as T;
}

function customerErrorMessage(reason: unknown, fallback = "服务暂时不可用，请稍后再试。"): string {
  const message = reason instanceof Error ? reason.message : String(reason ?? "");
  if (/insufficient_credits/.test(message)) return "企业积分不足，请充值后继续使用。";
  if (/agent_not_entitled|agent_member_access_denied/.test(message)) return "当前账号尚未开通这项服务，请联系企业管理员。";
  if (/skill_not_allowed/.test(message)) return "这个任务不属于当前 AI 顾问，请选择页面中的其他任务。";
  if (/mcp_service_unavailable|mcp_execution_failed|agent_run_failed|internal_server_error|request_failed/.test(message)) return fallback;
  if (/clarification_required/.test(message)) return "请再具体说一下你现在想解决的问题。";
  return message && !/^[a-z0-9_:-]+$/i.test(message) ? message : fallback;
}

function compactHistoryContent(content: string, maxLength = 8_000): string {
  const trimmed = content.trim();
  if (trimmed.length <= maxLength) return trimmed;
  const separator = "\n\n【较长历史交付物已自动压缩，保留开头与结尾】\n\n";
  const available = maxLength - separator.length;
  const headLength = Math.ceil(available * 0.6);
  const tailLength = available - headLength;
  return `${trimmed.slice(0, headLength)}${separator}${trimmed.slice(-tailLength)}`;
}

function useAgentCatalog(authenticated = false) {
  const [data, setData] = useState<AgentCatalogResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    void fetch(apiPath(authenticated ? "/agents/me" : "/agents/catalog"), { headers: authHeaders(), cache: "no-store" })
      .then((response) => readJson<AgentCatalogResponse>(response))
      .then(setData)
      .catch((reason: Error & { status?: number }) => {
        if (reason.status === 401 && authenticated) {
          clearCustomerSession();
          loginFor("/my-ai");
        }
        setError(customerErrorMessage(reason));
      })
      .finally(() => setLoading(false));
  }, [authenticated]);
  return { data, error, loading };
}

export function AgentHomePage() {
  const { data, loading } = useAgentCatalog(Boolean(localStorage.getItem("store_os_token")));
  useEffect(() => {
    if (localStorage.getItem("store_os_token") && data?.defaultEntry && data.defaultEntry !== "/") {
      navigate(data.defaultEntry);
    }
  }, [data]);
  return (
    <main className="agentProductPage agentHome">
      <nav className="agentTopbar">
        <button className="agentBrand" onClick={() => navigate("/")}><span>枕水江南</span><strong>外卖增长智能体</strong></button>
        <button className="ghostButton" onClick={() => localStorage.getItem("store_os_token") ? navigate("/account") : loginFor("/account")}>企业账户</button>
      </nav>
      <section className="agentHomeHero">
        <p className="agentKicker">枕水江南专属经营助手</p>
        <h1>把外卖经营数据变成<br />可执行、可复盘的增长动作</h1>
        <p>从数据导入、经营诊断、实验审批到结果复盘，先服务枕水江南总部与门店。</p>
      </section>
      <AgentCardGrid agents={(data?.allAgents ?? data?.agents ?? []).filter((agent) => agent.slug === "takeaway-growth")} publicMode />
      {loading && <p className="agentNotice">正在加载智能体目录…</p>}
    </main>
  );
}

export function AgentMarketingPage({ slug }: { slug: string }) {
  const deviceScope = useMemo(() => currentDeviceScope(), []);
  const [agent, setAgent] = useState<AgentView | null>(null);
  const [selected, setSelected] = useState("");
  const [selectedByUser, setSelectedByUser] = useState(false);
  const [input, setInput] = useState("");
  const [result, setResult] = useState("");
  const [trialCanContinue, setTrialCanContinue] = useState(false);
  const [trialMeta, setTrialMeta] = useState<{ analysisMode?: "fast" | "deep"; analysisBrief?: AgentAnalysisBrief; nextActions?: string[] }>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [offer, setOffer] = useState<{ code: string; name: string; description: string; amountCny: number; credits: number; durationDays: number } | null>(() => defaultMarketingOffer(slug));
  const [paymentQr, setPaymentQr] = useState("");
  const trialInputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    void fetch(apiPath(`/agents/${slug}`), { headers: authHeaders() })
      .then((response) => readJson<AgentView>(response))
      .then((value) => { setAgent(value); setSelected(value.slug === "restaurant-growth" ? "takeaway_growth" : value.capabilities[0]?.key ?? ""); setSelectedByUser(false); })
      .catch((reason: Error) => setError(customerErrorMessage(reason)));
    void fetch(apiPath("/billing/catalog"))
      .then((response) => readJson<{ agentOffers?: Array<{ code: string; name: string; description: string; amountCny: number; credits: number; durationDays: number; agents: Array<{ slug: string }> }> }>(response))
      .then((value) => setOffer(value.agentOffers?.find((item) => item.agents.some((agentItem) => agentItem.slug === slug)) ?? defaultMarketingOffer(slug)))
      .catch(() => undefined);
  }, [slug]);

  async function buyAgent() {
    if (!offer) return;
    if (!localStorage.getItem("store_os_token")) { loginFor(`/p/${slug}`); return; }
    setBusy(true); setError("");
    try {
      const order = await fetch(apiPath("/billing/orders"), {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ type: "agent_offer", offerCode: offer.code })
      }).then((response) => readJson<{ order: { id: string } }>(response));
      await fetch(apiPath(`/billing/orders/${order.order.id}/wechat-prepay`), {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ tradeType: "native" })
      }).then((response) => readJson(response));
      setPaymentQr(apiPath(`/billing/orders/${order.order.id}/wechat-qr.svg`));
    } catch (reason) { setError(customerErrorMessage(reason, "订单暂时无法创建，请稍后再试。")); }
    finally { setBusy(false); }
  }

  async function runTrial(inputOverride?: string, displayOverride?: string) {
    const modelInput = (inputOverride ?? input).trim();
    const displayInput = (displayOverride ?? modelInput).trim();
    const inferredCapability = inferAcquisitionCapability(modelInput, selected);
    const capabilityId = selectedByUser && !(selected === "content_plan" && inferredCapability === "franchise_acquisition")
      ? selected
      : inferredCapability;
    if (!capabilityId || !modelInput) return;
    const tokenKey = `sitong_trial_token_${slug}`;
    const claimableKey = `sitong_trial_claimable_${slug}`;
    if (localStorage.getItem(claimableKey) === "true") {
      setError("这次免费体验已完成。登录后可以继续追问、保存和导出。");
      return;
    }
    setBusy(true); setError(""); setResult(""); setTrialMeta({});
    try {
      const deviceKey = "sitong_agent_trial_device";
      let deviceId = localStorage.getItem(deviceKey);
      if (!deviceId) { deviceId = crypto.randomUUID(); localStorage.setItem(deviceKey, deviceId); }
      let token = localStorage.getItem(tokenKey);
      if (!token) {
        const started = await fetch(apiPath(`/agents/${slug}/trials/start`), {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deviceId })
        }).then((response) => readJson<{ token: string }>(response));
        token = started.token;
        localStorage.setItem(tokenKey, token);
      }
      const history = readTrialHistory(slug, deviceScope);
      const requestInput = history.length > 0 && (capabilityId === "content_plan" || capabilityId === "franchise_acquisition")
        ? `${modelInput}\n\n请基于本轮补充和上文，直接完成一份7天抖音和朋友圈获客计划：每天发什么、怎么承接私信。`
        : modelInput;
      const trial = await fetch(apiPath(`/agents/${slug}/trials/run`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: crypto.randomUUID(), token, input: requestInput, capabilityId, history, deviceScope })
      }).then((response) => readJson<{ answerText: string; canContinueTrial?: boolean; analysisMode?: "fast" | "deep"; analysisBrief?: AgentAnalysisBrief; nextActions?: string[] }>(response));
      const canContinueTrial = trial.canContinueTrial === true;
      const nextHistory = [...history, { role: "user" as const, content: modelInput }, { role: "assistant" as const, content: trial.answerText }].slice(-4);
      if (canContinueTrial) {
        localStorage.removeItem(claimableKey);
        sessionStorage.setItem(deviceScopedKey("sitong_trial_history", slug, deviceScope), JSON.stringify(nextHistory));
        sessionStorage.removeItem(deviceScopedKey("sitong_trial_result", slug, deviceScope));
      } else {
        localStorage.setItem(claimableKey, "true");
        sessionStorage.removeItem(deviceScopedKey("sitong_trial_history", slug, deviceScope));
        sessionStorage.setItem(deviceScopedKey("sitong_trial_result", slug, deviceScope), JSON.stringify({
          input: displayInput,
          answer: trial.answerText,
          capabilityId
        }));
      }
      setResult(trial.answerText);
      setInput("");
      setTrialCanContinue(canContinueTrial);
      setTrialMeta({ analysisMode: trial.analysisMode, analysisBrief: trial.analysisBrief, nextActions: trial.nextActions });
    } catch (reason) {
      setError(customerErrorMessage(reason, "体验暂时不可用，请稍后再试。"));
    } finally { setBusy(false); }
  }

  if (!agent) return <PageState text={error || "正在加载智能体…"} />;
  if (agent.slug === "clipper") {
    return (
      <main className="agentProductPage marketingPage clipperMarketingPage">
        <nav className="agentTopbar">
          <button className="agentBrand" onClick={() => navigate("/")}><AgentAvatar agent={agent} /><strong>{customerAgentName(agent.name)}</strong></button>
          <button className="ghostButton" onClick={() => agent.entitled ? navigate("/agents/clipper") : loginFor("/agents/clipper")}>{agent.entitled ? "进入工作台" : "登录 / 开通"}</button>
        </nav>
        <section className="marketingHero clipperMarketingHero">
          <div>
            <p className="agentKicker">{agent.marketing?.eyebrow}</p>
            <h1>{agent.marketing?.headline}</h1>
            <p>{agent.marketing?.promise}</p>
            <div className="heroActions">
              <button className="primaryButton" onClick={() => agent.entitled ? navigate("/agents/clipper") : loginFor("/agents/clipper")}>{agent.entitled ? "开始自由组片" : "登录并申请体验"}</button>
              {offer && !agent.entitled && <button className="ghostButton" onClick={() => void buyAgent()}>购买开通 · ¥{offer.amountCny}</button>}
            </div>
          </div>
          <div className="agentPortrait"><AgentAvatar agent={agent} /><strong>AI先做 80%</strong><p>剪辑手完成事实、节奏和审美判断</p></div>
        </section>
        <section className="clipperWorkflowShowcase">
          <article><span>01</span><strong>上传素材</strong><p>整场直播先按商品拆；商品素材直接进入细分。</p></article>
          <article><span>02</span><strong>AI 拆成细片段</strong><p>识别开头、证据、规格、价格、场景、行动或独立观点。</p></article>
          <article><span>03</span><strong>自由组片</strong><p>使用模板或自行排序、替换、微调，下载到剪映精修。</p></article>
        </section>
        <section className="capabilityShowcase"><p className="agentKicker">两种剪辑模式</p><h2>同一个工作台，处理两类内容</h2><AgentCapabilities capabilities={agent.capabilities} selected={agent.capabilities[0]?.key ?? ""} onSelect={() => navigate(agent.entitled ? "/agents/clipper" : "/login")} /></section>
        {paymentQr && <div className="paymentPanel"><img src={paymentQr} alt="微信支付二维码" /><div><strong>微信扫码开通自由组片智能体</strong><p>支付成功后，当前企业账号即可进入工作台。</p></div></div>}
        {error && <p className="agentError">{error}</p>}
      </main>
    );
  }
  return (
    <main className={`agentProductPage marketingPage ${slug}`}>
      <nav className="agentTopbar">
        <button className="agentBrand" onClick={() => navigate("/")}><AgentAvatar agent={agent} /><strong>{customerAgentName(agent.name)}</strong></button>
        <button className="ghostButton" onClick={() => agent.entitled ? navigate(`/agents/${slug}`) : loginFor(`/agents/${slug}`)}>{agent.entitled ? "进入智能体" : "登录 / 开通"}</button>
      </nav>
      <section className="marketingHero">
        <div>
          <p className="agentKicker">{agent.marketing?.eyebrow}</p>
          <h1>{agent.marketing?.headline ?? customerAgentName(agent.name)}</h1>
          <p>{agent.marketing?.promise ?? agent.description}</p>
          <div className="heroActions">
            <button className="primaryButton" onClick={() => document.getElementById("agent-trial")?.scrollIntoView({ behavior: "smooth" })}>免费完成一次任务</button>
            <button className="ghostButton" onClick={() => agent.entitled ? navigate(`/agents/${slug}`) : loginFor(`/agents/${slug}`)}>{agent.entitled ? "直接使用" : "登录开通"}</button>
            {offer && !agent.entitled && slug !== "restaurant-growth" && <button className="ghostButton" onClick={() => void buyAgent()}>购买开通 · ¥{offer.amountCny}</button>}
          </div>
          {offer && slug === "acquisition" && (
            <div className="agentOfferSummary">
              <strong>老客户首发：¥{offer.amountCny} / {offer.durationDays}天</strong>
              <span>含 {offer.credits} 积分，日常使用够用；用量增加时可按需购买积分加量包。</span>
            </div>
          )}
        </div>
        <div className="agentPortrait"><AgentAvatar agent={agent} /><strong>{customerAgentName(agent.name)}</strong><p>{agent.marketing?.audience}</p></div>
      </section>
      {slug === "restaurant-growth" && <RestaurantTakeawayMarketing />}
      <section className="capabilityShowcase"><h2>{slug === "restaurant-growth" ? "从外卖订单切入，也保留完整餐饮增长能力" : "它可以帮你完成"}</h2><AgentCapabilities capabilities={agent.capabilities} selected={selected} onSelect={(capabilityId) => { setSelected(capabilityId); setSelectedByUser(true); }} /></section>
      <section id="agent-trial" className="trialPanel">
        <div><p className="agentKicker">免登录真实体验</p><h2>先完成一件真实工作</h2><p>补充必要信息不计入体验；第一份完整结果展示后，再登录继续追问、保存或导出。</p></div>
        <div className="trialComposerWrap">
          <select value={selected} onChange={(event) => { setSelected(event.target.value); setSelectedByUser(true); }}>{agent.capabilities.map((item) => <option key={item.key} value={item.key}>{item.title}</option>)}</select>
          <ChatComposer
            inputValue={input}
            busy={busy}
            currentConsultantId={consultantForCapability(selectedByUser ? selected : inferAcquisitionCapability(input, selected))}
            capabilityId={composerCapability(selectedByUser ? selected : inferAcquisitionCapability(input, selected))}
            headers={authHeaders()}
            inputRef={trialInputRef}
            onInputChange={(value) => {
              setInput(value);
              if (!selectedByUser) setSelected(inferAcquisitionCapability(value, selected));
            }}
            onKeyDown={() => undefined}
            onSend={runTrial}
          />
        </div>
        {error && <p className="agentError">{error}</p>}
        {result && <div className="trialResult"><div className="resultLabel">{customerAgentName(agent.name)} 的结果</div><AgentAnswer message={{ id: "trial-result", role: "assistant", content: result, ...trialMeta }} agentName={customerAgentName(agent.name)} onAction={(action) => { setInput(action); trialInputRef.current?.focus(); }} />{trialCanContinue ? <p className="agentNotice">补全上面的信息后直接发送，我会免费完成第一份计划。</p> : <button className="primaryButton" onClick={() => loginFor(`/agents/${slug}`)}>登录后继续追问</button>}</div>}
        {paymentQr && <div className="paymentPanel"><img src={paymentQr} alt="微信支付二维码" /><div><strong>微信扫码开通 {customerAgentName(agent.name)}</strong><p>支付成功后，当前企业账号即可使用。</p></div></div>}
      </section>
    </main>
  );
}

function defaultMarketingOffer(slug: string) {
  if (slug !== "acquisition") return null;
  return {
    code: "acquisition_agent",
    name: "思潼·品牌获客智能体",
    description: "199元使用30天，含2000积分；积分用完可购买加量包。",
    amountCny: 199,
    credits: 2000,
    durationDays: 30
  };
}

function RestaurantTakeawayMarketing() {
  return (
    <>
      <section className="restaurantValueStrip" aria-label="外卖增长诊断价值">
        <article><span>01</span><strong>读取真实资料</strong><p>现有后台导出和截图有什么先给什么，不要求重新造报表。</p></article>
        <article><span>02</span><strong>只改一个变量</strong><p>菜单、套餐、价格、活动、投放或复购动作，每轮只验证一个。</p></article>
        <article><span>03</span><strong>用结果做决定</strong><p>第7天明确继续、调整或停止，不以感觉代替经营复盘。</p></article>
      </section>

      <section className="restaurantFunnelShowcase">
        <p className="agentKicker">线上外卖经营漏斗</p>
        <h2>订单低，不一定是流量问题</h2>
        <p>先确认问题发生在哪一段，再决定是改入口、商品、下单承接、履约还是复购。</p>
        <div className="restaurantFunnelTrack" aria-label="平台曝光到复购的经营漏斗">
          {["平台曝光", "线上进店", "商品点击", "加购结算", "实付订单", "履约评价", "复购"].map((step, index) => <span key={step}><b>{String(index + 1).padStart(2, "0")}</b>{step}</span>)}
        </div>
        <small>“线上进店”指用户进入外卖店铺页面，不是线下堂食到店。</small>
      </section>

      <section className="restaurantWorkflowShowcase">
        <div><p className="agentKicker">一次诊断怎样进行</p><h2>从资料进入，到7天复盘</h2><p>交付的是一套能验收的经营诊断闭环，不是一份泛化运营建议。</p></div>
        <ol>
          <li><span>01</span><div><strong>资料核对</strong><p>检查日期、门店、平台和指标口径，明确真正影响判断的缺口。</p></div></li>
          <li><span>02</span><div><strong>建立基线</strong><p>按门店、平台和周期形成曝光、访问、订单、履约与复购事实。</p></div></li>
          <li><span>03</span><div><strong>定位断点</strong><p>严格区分已确认事实、分析假设和待补信息。</p></div></li>
          <li><span>04</span><div><strong>7天实验</strong><p>确定唯一主要变量、负责人、指标、护栏和停止条件。</p></div></li>
          <li><span>05</span><div><strong>结果复盘</strong><p>用前后证据判断有效、待验证、无效或无法判断。</p></div></li>
        </ol>
      </section>

      <section className="restaurantFitShowcase">
        <article className="fit"><span>适合进入诊断</span><h2>已经有真实门店和明确问题</h2><p>能提供至少14天，最好28天以上后台资料；店内有人可以执行一个7天动作。</p></article>
        <article><span>暂时不适合</span><h2>要求AI替代全部运营或保证结果</h2><p>完全没有经营资料、没有执行人，或希望一次解决外卖、堂食、品牌、招商和选址全部问题。</p></article>
      </section>

      <section className="restaurantBoundaryCallout">
        <strong>四条产品底线</strong>
        <p>没有数据，不把假设说成结论；不接收无关顾客个人信息；不把内容播放量直接说成外卖订单；不保证平台算法、排名、订单或收益结果。</p>
      </section>
    </>
  );
}

export function AgentWorkspacePage({ slug }: { slug: string }) {
  const acquisitionSystemEntries = acquisitionSystemEntriesFor(slug);
  const isAcquisitionAgent = isAcquisitionWorkspace(slug);
  const isFranchiseAgent = slug === "acquisition";
  const tenantBranding = useTenantBranding();
  const deviceScope = useMemo(() => currentDeviceScope(), []);
  // Systems opened from the work map must be addressable pages.  Keeping this
  // in the URL prevents an old conversation capability (for example 内容系统)
  // from winning over the card the user just opened.
  const requestedAcquisitionSystem = useMemo(() => {
    if (!isAcquisitionWorkspace(slug)) return "";
    const requested = new URLSearchParams(window.location.search).get("system") ?? "";
    return acquisitionSystemEntriesFor(slug).some((entry) => entry.capabilityId === requested) ? requested : "";
  }, [slug]);
  const initialTaskStateRef = useRef<AgentWorkspaceTaskState | null>(null);
  if (!initialTaskStateRef.current) initialTaskStateRef.current = readAgentTaskState(slug, deviceScope);
  const initialTaskState = initialTaskStateRef.current;
  const initialActiveTask = initialTaskState.tasks.find((task) => task.id === initialTaskState.activeTaskId) ?? initialTaskState.tasks[0];
  const [agent, setAgent] = useState<AgentView | null>(null);
  const [selected, setSelected] = useState(requestedAcquisitionSystem || (initialActiveTask?.capabilityId ?? inferTaskCapabilityFromMessages(initialActiveTask?.messages ?? [])));
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>(requestedAcquisitionSystem ? [requestedAcquisitionSystem] : []);
  const [input, setInput] = useState(initialActiveTask?.draft.content ?? "");
  const [tasks, setTasks] = useState<AgentWorkspaceTask[]>(initialTaskState.tasks);
  const [activeTaskId, setActiveTaskId] = useState(initialTaskState.activeTaskId);
  const [messages, setMessages] = useState<ProductMessage[]>(initialActiveTask?.messages ?? []);
  const [conversationId, setConversationId] = useState<string | undefined>(initialActiveTask?.conversationId);
  const [runningTaskIds, setRunningTaskIds] = useState<string[]>([]);
  const [runningCapabilitiesByTask, setRunningCapabilitiesByTask] = useState<Record<string, string[]>>({});
  const busy = runningTaskIds.includes(activeTaskId);
  const [claimingTrial, setClaimingTrial] = useState(false);
  const [error, setError] = useState("");
  const [scenarioNotice, setScenarioNotice] = useState("");
  const [takeawayDataStatus, setTakeawayDataStatus] = useState<TakeawayWorkbenchDataStatus | null>(null);
  const [takeawayOpenImportSignal, setTakeawayOpenImportSignal] = useState(0);
  const [contentVideoUploadSignal, setContentVideoUploadSignal] = useState(0);
  const [videoReviewUploadSignal, setVideoReviewUploadSignal] = useState(0);
  const [videoReviewUploadStatus, setVideoReviewUploadStatus] = useState("");
  const [liveReviewUploadSignal, setLiveReviewUploadSignal] = useState(0);
  const [trafficUploadSignal, setTrafficUploadSignal] = useState(0);
  const [trafficUploadCapability, setTrafficUploadCapability] = useState<"paid_traffic" | "dou_plus_traffic">("paid_traffic");
  const [trafficUploadStatus, setTrafficUploadStatus] = useState("");
  const [tenantProfile, setTenantProfile] = useState<{ tenantName?: string; industry?: string; city?: string; data?: Record<string, unknown> } | null>(null);
  const [tenantRole, setTenantRole] = useState<"owner" | "admin" | "member">("member");
  const [knowledgeDrawerOpen, setKnowledgeDrawerOpen] = useState(false);
  const [automationDrawerOpen, setAutomationDrawerOpen] = useState(false);
  const [workMapOpen, setWorkMapOpen] = useState(false);
  const [takeawayMapEntry, setTakeawayMapEntry] = useState<{ capabilityId: string; requestId: number } | null>(null);
  const [customerProfileDrawerOpen, setCustomerProfileDrawerOpen] = useState(false);
  const [customerSubjectPickerOpen, setCustomerSubjectPickerOpen] = useState(false);
  const [knowledgeSubjects, setKnowledgeSubjects] = useState<KnowledgeSubjectView[]>([]);
  const [taskMenuId, setTaskMenuId] = useState<string | null>(null);
  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null);
  const [renamingTaskId, setRenamingTaskId] = useState<string | null>(null);
  const [renameTaskValue, setRenameTaskValue] = useState("");
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const workspaceInputRef = useRef<HTMLTextAreaElement>(null);
  const productMessagesRef = useRef<HTMLElement>(null);
  const shouldStickToLatestRef = useRef(true);
  const isJumpingToLatestRef = useRef(false);
  const jumpToLatestTimerRef = useRef<number | undefined>(undefined);
  const requestAbortRef = useRef<Map<string, AbortController>>(new Map());

  useEffect(() => {
    if (!agent) return;
    if (isAcquisitionWorkspace(slug)) {
      const systemId = requestedAcquisitionSystem || selectedSkillIds[0] || selected;
      const systemTitle = acquisitionSystemEntriesFor(slug).find((entry) => entry.capabilityId === systemId)?.title;
      document.title = systemTitle
        ? `${systemTitle}｜${isFranchiseAgent ? "思潼·品牌招商智能体" : "思潼·门店获客智能体"}`
        : isFranchiseAgent ? "思潼·品牌招商智能体" : "思潼·门店获客智能体";
      return;
    }
    document.title = tenantAgentDisplayName(agent.slug, customerAgentName(agent.name), tenantBranding);
  }, [agent, requestedAcquisitionSystem, selected, selectedSkillIds, slug, tenantBranding]);
  const activeTaskIdRef = useRef(activeTaskId);
  activeTaskIdRef.current = activeTaskId;
  const [lastRun, setLastRun] = useState<{ input: string; display: string } | null>(null);
  const activeKnowledgeDocumentIds = tasks.find((task) => task.id === activeTaskId)?.knowledgeDocumentIds ?? [];
  const activeKnowledgeSubjectId = tasks.find((task) => task.id === activeTaskId)?.knowledgeSubjectId;
  const activeCustomerProfile = tasks.find((task) => task.id === activeTaskId)?.customerProfile;
  const activeKnowledgeSubject = knowledgeSubjects.find((subject) => subject.id === activeKnowledgeSubjectId);
  useEffect(() => {
    if (agent?.marketing?.workMap) setWorkMapOpen(true);
  }, [agent?.marketing?.workMap?.id]);
  useEffect(() => {
    if (!localStorage.getItem("store_os_token")) { loginFor(`/agents/${slug}`); return; }
    let cancelled = false;
    const pendingTrial = readTrialResult(slug, deviceScope);
    if (pendingTrial) {
      setMessages([
        { id: `trial-user-${slug}`, role: "user", content: pendingTrial.input },
        { id: `trial-assistant-${slug}`, role: "assistant", content: pendingTrial.answer }
      ]);
    }
    const trialToken = localStorage.getItem(`sitong_trial_token_${slug}`);
    const trialClaimable = localStorage.getItem(`sitong_trial_claimable_${slug}`) === "true" || Boolean(pendingTrial && trialToken);
    void fetch(apiPath("/tenant/current"), { headers: authHeaders() })
      .then((response) => readJson<{ profile?: typeof tenantProfile; role?: "owner" | "admin" | "member" }>(response))
      .then((value) => { if (!cancelled) { setTenantProfile(value.profile ?? null); setTenantRole(value.role ?? "member"); } })
      .catch(() => undefined);
    if (isAcquisitionWorkspace(slug)) {
      void fetch(apiPath("/knowledge-base/subjects"), { headers: authHeaders() })
        .then((response) => readJson<{ subjects: KnowledgeSubjectView[] }>(response))
        .then((value) => {
          if (cancelled) return;
          setKnowledgeSubjects(value.subjects);
        })
        .catch(() => undefined);
    }
    void (async () => {
      if (trialToken && trialClaimable) {
        setClaimingTrial(true);
        try {
          const claim = await fetch(apiPath("/agents/trials/claim"), {
            method: "POST", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ token: trialToken, deviceScope })
          }).then((response) => readJson<{ conversationId?: string }>(response));
          if (cancelled) return;
          if (claim.conversationId) {
            setConversationId(claim.conversationId);
            sessionStorage.setItem(deviceScopedKey("sitong_conversation", slug, deviceScope), claim.conversationId);
          }
          localStorage.removeItem(`sitong_trial_token_${slug}`);
          localStorage.removeItem(`sitong_trial_claimable_${slug}`);
          sessionStorage.removeItem(deviceScopedKey("sitong_trial_result", slug, deviceScope));
        } catch {
          if (!cancelled) setError("免费体验结果暂时未能保存，请稍后重试。");
        } finally {
          if (!cancelled) setClaimingTrial(false);
        }
      }
      try {
        const catalog = await fetch(apiPath("/agents/me"), { headers: authHeaders(), cache: "no-store" })
          .then((response) => readJson<AgentCatalogResponse>(response));
        if (cancelled) return;
        const value = (catalog.allAgents ?? catalog.agents).find((item) => item.slug === slug);
        if (!value) throw new Error("agent_not_found");
        setAgent(value);
        setSelected("");
        if (!value.entitled) return;
        if (pendingTrial) return;
        const pendingSubjectId = isAcquisitionWorkspace(slug) ? localStorage.getItem(`sitong_pending_acquisition_subject_${slug}`) ?? localStorage.getItem("sitong_pending_acquisition_subject") : null;
        if (pendingSubjectId) {
          const task = { ...createAgentWorkspaceTask([], undefined, undefined, undefined, deviceScope), knowledgeSubjectId: pendingSubjectId };
          setTasks((current) => [task, ...current]);
          setActiveTaskId(task.id);
          activeTaskIdRef.current = task.id;
          setMessages([]);
          setConversationId(undefined);
          localStorage.removeItem(`sitong_pending_acquisition_subject_${slug}`);
          localStorage.removeItem("sitong_pending_acquisition_subject");
          return;
        }
        const conversations = await fetch(apiPath(`/conversations?agentId=${encodeURIComponent(value.id)}&deviceScope=${deviceScope}`), { headers: authHeaders() })
          .then((response) => readJson<{ dataMode?: string; conversations?: Array<{ id: string; title?: string; updatedAt?: string; deviceScope?: DeviceScope }> }>(response));
        const taskPreferences = readAgentTaskPreferences(slug, deviceScope);
        const visibleConversations = (conversations.conversations ?? []).filter((conversation) => !taskPreferences[`remote-${conversation.id}`]?.hidden);
        const latest = visibleConversations[0];
        if (!latest || conversations.dataMode === "demo") return;
        const history = await fetch(apiPath(`/conversations/${latest.id}/messages?deviceScope=${deviceScope}`), { headers: authHeaders() })
          .then((response) => readJson<{ messages?: Array<{ id: string; role: string; content: string; displayContent?: string }> }>(response));
        if (cancelled) return;
        const remoteTasks = visibleConversations.map((conversation) => {
          const id = `remote-${conversation.id}`;
          const customTitle = taskPreferences[id]?.title?.trim();
          const localTaskState = initialTaskState.tasks.find((task) => task.id === id || task.conversationId === conversation.id);
          return {
            id,
            deviceScope,
            title: customTitle || conversation.title?.trim() || "历史任务",
            ...(customTitle ? { customTitle } : {}),
            messages: [] as ProductMessage[],
            conversationId: conversation.id,
            capabilityId: undefined,
            updatedAt: conversation.updatedAt ?? new Date().toISOString(),
            loaded: conversation.id === latest.id,
            knowledgeDocumentIds: localTaskState?.knowledgeDocumentIds ?? [] as string[],
            knowledgeSubjectId: localTaskState?.knowledgeSubjectId,
            customerProfile: localTaskState?.customerProfile,
            draft: { deviceScope, content: "", updatedAt: conversation.updatedAt ?? new Date().toISOString() }
          };
        });
        const latestMessages = (history.messages ?? [])
          .filter((message) => message.role === "user" || message.role === "assistant")
          .map((message) => ({ id: message.id, role: message.role as ProductMessage["role"], content: message.displayContent ?? message.content }));
        const latestTaskId = `remote-${latest.id}`;
        const latestCapabilityId = inferTaskCapabilityFromMessages(latestMessages);
        setTasks(remoteTasks.map((task) => task.id === latestTaskId ? { ...task, messages: latestMessages, capabilityId: latestCapabilityId } : task));
        setActiveTaskId(latestTaskId);
        setConversationId(latest.id);
        setSelected(latestCapabilityId);
        sessionStorage.setItem(deviceScopedKey("sitong_conversation", slug, deviceScope), latest.id);
        setMessages(latestMessages);
      } catch (reason) {
        const typedReason = reason as Error & { status?: number };
        if (cancelled) return;
        if (typedReason.status === 401) {
          clearCustomerSession();
          loginFor(`/agents/${slug}`);
          return;
        }
        setError(customerErrorMessage(typedReason));
      }
    })();
    return () => { cancelled = true; };
  }, [deviceScope, slug]);
  useEffect(() => {
    if (!taskMenuId) return;
    const closeTaskMenu = () => { setTaskMenuId(null); setDeletingTaskId(null); };
    document.addEventListener("pointerdown", closeTaskMenu);
    return () => document.removeEventListener("pointerdown", closeTaskMenu);
  }, [taskMenuId]);
  useEffect(() => {
    setTasks((current) => current.map((task) => task.id === activeTaskId
      ? {
          ...task,
          title: task.customTitle || taskTitleFromMessages(messages),
          messages: messages.slice(-40),
          conversationId,
          updatedAt: new Date().toISOString(),
          loaded: true
        }
      : task));
    sessionStorage.setItem(deviceScopedKey("sitong_agent_messages", slug, deviceScope), JSON.stringify(messages.slice(-40)));
    if (conversationId) sessionStorage.setItem(deviceScopedKey("sitong_conversation", slug, deviceScope), conversationId);
    else sessionStorage.removeItem(deviceScopedKey("sitong_conversation", slug, deviceScope));
  }, [activeTaskId, conversationId, deviceScope, messages, slug]);
  useEffect(() => {
    const activeTask = tasks.find((task) => task.id === activeTaskId);
    if (!activeTask || activeTask.capabilityId) return;
    const inferredCapabilityId = inferTaskCapabilityFromMessages(messages);
    if (!inferredCapabilityId) return;
    setTasks((current) => current.map((task) => task.id === activeTaskId
      ? { ...task, capabilityId: inferredCapabilityId }
      : task));
    setSelected(inferredCapabilityId);
  }, [activeTaskId, messages, tasks]);
  useEffect(() => {
    setTasks((current) => current.map((task) => task.id === activeTaskId
      ? { ...task, draft: { deviceScope, content: input, updatedAt: new Date().toISOString() } }
      : task));
  }, [activeTaskId, deviceScope, input]);
  useEffect(() => {
    sessionStorage.setItem(deviceScopedKey("sitong_agent_tasks", slug, deviceScope), JSON.stringify(tasks));
    sessionStorage.setItem(deviceScopedKey("sitong_agent_active_task", slug, deviceScope), activeTaskId);
  }, [activeTaskId, deviceScope, slug, tasks]);
  useEffect(() => {
    if (!activeKnowledgeSubject || activeCustomerProfile?.name === activeKnowledgeSubject.name && activeCustomerProfile?.industry === activeKnowledgeSubject.industry) return;
    setTasks((current) => current.map((task) => task.id === activeTaskId
      ? { ...task, customerProfile: mergeTaskCustomerProfile(task.customerProfile, { name: activeKnowledgeSubject.name, industry: activeKnowledgeSubject.industry }), updatedAt: new Date().toISOString() }
      : task));
  }, [activeCustomerProfile?.industry, activeCustomerProfile?.name, activeKnowledgeSubject, activeTaskId]);
  useEffect(() => {
    if (jumpToLatestTimerRef.current !== undefined) window.clearTimeout(jumpToLatestTimerRef.current);
    shouldStickToLatestRef.current = true;
    isJumpingToLatestRef.current = false;
    setShowJumpToLatest(false);
    return () => {
      if (jumpToLatestTimerRef.current !== undefined) window.clearTimeout(jumpToLatestTimerRef.current);
    };
  }, [activeTaskId]);
  useEffect(() => {
    const element = productMessagesRef.current;
    if (!element) return;
    const frame = window.requestAnimationFrame(() => {
      if (shouldStickToLatestRef.current) {
        element.scrollTo({ top: element.scrollHeight, behavior: "auto" });
        setShowJumpToLatest(false);
        return;
      }
      setShowJumpToLatest(!isNearLatestMessage(element));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeTaskId, busy, claimingTrial, messages]);

  function isNearLatestMessage(element: HTMLElement): boolean {
    return element.scrollHeight - element.scrollTop - element.clientHeight <= 72;
  }

  function handleMessagesScroll(): void {
    const element = productMessagesRef.current;
    if (!element) return;
    const nearLatest = isNearLatestMessage(element);
    if (isJumpingToLatestRef.current && !nearLatest) return;
    if (nearLatest) {
      isJumpingToLatestRef.current = false;
      if (jumpToLatestTimerRef.current !== undefined) {
        window.clearTimeout(jumpToLatestTimerRef.current);
        jumpToLatestTimerRef.current = undefined;
      }
    }
    shouldStickToLatestRef.current = nearLatest;
    setShowJumpToLatest(!nearLatest);
  }

  function jumpToLatestMessage(): void {
    const element = productMessagesRef.current;
    if (!element) return;
    shouldStickToLatestRef.current = true;
    isJumpingToLatestRef.current = true;
    setShowJumpToLatest(false);
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    element.scrollTo({ top: element.scrollHeight, behavior: reduceMotion ? "auto" : "smooth" });
    jumpToLatestTimerRef.current = window.setTimeout(() => {
      isJumpingToLatestRef.current = false;
      const latestElement = productMessagesRef.current;
      if (!latestElement) return;
      const nearLatest = isNearLatestMessage(latestElement);
      shouldStickToLatestRef.current = nearLatest;
      setShowJumpToLatest(!nearLatest);
      jumpToLatestTimerRef.current = undefined;
    }, reduceMotion ? 0 : 700);
  }

  function startNewConversation(): void {
    const task = createAgentWorkspaceTask([], undefined, undefined, undefined, deviceScope);
    setTasks((current) => [task, ...current]);
    setActiveTaskId(task.id);
    activeTaskIdRef.current = task.id;
    setMessages([]);
    setConversationId(undefined);
    setSelected("");
    setSelectedSkillIds([]);
    setInput(task.draft.content);
    setError("");
    setLastRun(null);
  }

  function activateAcquisitionSystem(capabilityId: string): void {
    const isDefinedSystem = acquisitionSystemEntries.some((entry) => entry.capabilityId === capabilityId);
    if (!isDefinedSystem && !agent?.capabilities.some((item) => item.key === capabilityId)) return;
    setSelected(capabilityId);
    setSelectedSkillIds([capabilityId]);
    setError("");
    if (isAcquisitionAgent) {
      const destination = new URL(window.location.href);
      destination.searchParams.set("system", capabilityId);
      window.history.pushState({ acquisitionSystem: capabilityId }, "", destination);
    }
    setTasks((current) => current.map((task) => task.id === activeTaskId
      ? { ...task, capabilityId, updatedAt: new Date().toISOString() }
      : task));
    if (capabilityId === "topic_inspiration") return;
    window.requestAnimationFrame(() => workspaceInputRef.current?.focus());
  }

  function stageTakeawayPrompt(title: string, capabilityIds: readonly string[], prompt: string): void {
    setSelected(capabilityIds[0] ?? "");
    setSelectedSkillIds([...capabilityIds]);
    setInput(prompt);
    setScenarioNotice(`已选择“${title}”。问题模板已放入下方输入框，请补充已知数据后发送。`);
    window.requestAnimationFrame(() => {
      workspaceInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      workspaceInputRef.current?.focus();
    });
  }

  function setActiveKnowledgeDocumentIds(documentIds: string[]): void {
    const uniqueIds = Array.from(new Set(documentIds)).slice(0, 100);
    setTasks((current) => current.map((task) => task.id === activeTaskId
      ? { ...task, knowledgeDocumentIds: uniqueIds, updatedAt: new Date().toISOString() }
      : task));
  }

  function setActiveKnowledgeSubjectId(knowledgeSubjectId: string): void {
    const subject = knowledgeSubjects.find((item) => item.id === knowledgeSubjectId);
    setTasks((current) => current.map((task) => task.id === activeTaskId
      ? {
          ...task,
          knowledgeSubjectId,
          knowledgeDocumentIds: [],
          customerProfile: subject
            ? mergeTaskCustomerProfile(task.customerProfile, { name: subject.name, industry: subject.industry })
            : task.customerProfile,
          updatedAt: new Date().toISOString()
        }
      : task));
  }

  async function activateTask(task: AgentWorkspaceTask): Promise<void> {
    setActiveTaskId(task.id);
    activeTaskIdRef.current = task.id;
    setConversationId(task.conversationId);
    setSelected(task.capabilityId ?? inferTaskCapabilityFromMessages(task.messages));
    setSelectedSkillIds([]);
    setInput(task.draft.content);
    setError("");
    setLastRun(null);
    if (task.loaded || !task.conversationId) {
      setMessages(task.messages);
      return;
    }
    setMessages([]);
    try {
      const history = await fetch(apiPath(`/conversations/${task.conversationId}/messages?deviceScope=${deviceScope}`), { headers: authHeaders() })
        .then((response) => readJson<{ messages?: Array<{ id: string; role: string; content: string; displayContent?: string }> }>(response));
      const loadedMessages = (history.messages ?? [])
        .filter((message) => message.role === "user" || message.role === "assistant")
        .map((message) => ({ id: message.id, role: message.role as ProductMessage["role"], content: message.displayContent ?? message.content }));
      const loadedCapabilityId = task.capabilityId ?? inferTaskCapabilityFromMessages(loadedMessages);
      setTasks((current) => current.map((item) => item.id === task.id ? { ...item, messages: loadedMessages, loaded: true, capabilityId: loadedCapabilityId } : item));
      if (activeTaskIdRef.current === task.id) { setMessages(loadedMessages); setSelected(loadedCapabilityId); }
    } catch (reason) {
      setError(customerErrorMessage(reason, "历史任务加载失败，请稍后重试。"));
    }
  }

  async function switchConversation(taskId: string): Promise<void> {
    if (taskId === activeTaskId) return;
    const task = tasks.find((item) => item.id === taskId);
    if (!task) return;
    await activateTask(task);
  }

  function beginTaskRename(task: AgentWorkspaceTask): void {
    setTaskMenuId(null);
    setDeletingTaskId(null);
    setRenamingTaskId(task.id);
    setRenameTaskValue(task.customTitle || (task.id === activeTaskId ? taskTitleFromMessages(messages) : task.title));
  }

  function commitTaskRename(taskId: string): void {
    const title = renameTaskValue.trim().replace(/\s+/g, " ").slice(0, 80);
    setRenamingTaskId(null);
    setRenameTaskValue("");
    if (!title) return;
    setTasks((current) => current.map((task) => task.id === taskId
      ? { ...task, title, customTitle: title, updatedAt: new Date().toISOString() }
      : task));
    writeAgentTaskPreference(slug, deviceScope, taskId, { title, hidden: false });
  }

  function deleteTask(task: AgentWorkspaceTask): void {
    requestAbortRef.current.get(task.id)?.abort();
    writeAgentTaskPreference(slug, deviceScope, task.id, { title: task.customTitle, hidden: true });
    setTaskMenuId(null);
    setDeletingTaskId(null);
    setRenamingTaskId(null);
    const remaining = tasks.filter((item) => item.id !== task.id);
    if (remaining.length === 0) {
      const replacement = createAgentWorkspaceTask([], undefined, undefined, undefined, deviceScope);
      setTasks([replacement]);
      void activateTask(replacement);
      return;
    }
    setTasks(remaining);
    if (task.id === activeTaskId) {
      const replacement = [...remaining].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
      void activateTask(replacement);
    }
  }

  async function send(inputOverride?: string, displayOverride?: string, capabilityOverride?: string | string[], knowledgeDocumentIdsOverride?: string[], knowledgeSubjectIdOverride?: string) {
    const text = (inputOverride ?? input).trim();
    const displayText = (displayOverride ?? text).trim();
    if (!text || busy || claimingTrial || !agent) return;
    const taskId = activeTaskId;
    const taskConversationId = conversationId;
    const activeTask = tasks.find((task) => task.id === taskId);
    const taskKnowledgeDocumentIds = knowledgeDocumentIdsOverride ?? activeTask?.knowledgeDocumentIds ?? [];
    const taskKnowledgeSubjectId = knowledgeSubjectIdOverride ?? activeTask?.knowledgeSubjectId;
    const taskCustomerProfile = mergeTaskCustomerProfile(activeTask?.customerProfile, inferTaskCustomerProfile(displayText));
    const knowledgeIdentityContext = localStorage.getItem("sitong_kb_identity_context")?.trim();
    const knowledgeBusinessGoal = localStorage.getItem("sitong_kb_business_goal")?.trim();
    const knowledgeFactCorrections = localStorage.getItem("sitong_kb_fact_corrections")?.trim();
    const explicitCapabilityIds = (capabilityOverride ? (Array.isArray(capabilityOverride) ? capabilityOverride : [capabilityOverride]) : selectedSkillIds)
      .filter((id) => agent.capabilities.some((item) => item.key === id));
    const inferredTaskCapability = activeTask ? inferTaskCapabilityFromMessages(activeTask.messages) : "";
    const pinnedCapabilityCandidate = inferredTaskCapability || activeTask?.capabilityId || "";
    const pinnedTaskCapability = pinnedCapabilityCandidate && isAcquisitionTaskCapability(agent, pinnedCapabilityCandidate)
      ? pinnedCapabilityCandidate
      : undefined;
    const resolvedCapabilityIds = slug === "acquisition"
      ? resolveAcquisitionTaskCapabilities(displayText, pinnedTaskCapability, explicitCapabilityIds)
      : explicitCapabilityIds;
    const requestCapabilityIds = resolvedCapabilityIds;
    const inferredCapability = resolvedCapabilityIds[0] || selected;
    const capabilityId = requestCapabilityIds.length <= 1 && isAcquisitionTaskCapability(agent, inferredCapability)
      ? inferredCapability
      : "";
    const scopedHistory = slug === "acquisition" && explicitCapabilityIds.length === 1
      ? scopeAcquisitionCapabilityHistory(messages, explicitCapabilityIds[0])
      : messages;
    const taskHistorySource = scopedHistory.length <= 12
      ? scopedHistory
      : [...scopedHistory.slice(0, 2), ...scopedHistory.slice(-10)];
    const taskHistory = taskHistorySource.map((message) => ({
      role: message.role,
      content: compactHistoryContent(message.content)
    }));
    if (inferredCapability && inferredCapability !== selected) setSelected(inferredCapability);
    const controller = new AbortController();
    let requestTimedOut = false;
    const requestTimeoutMs = inferredCapability === "video_review" ? 180_000 : 120_000;
    const requestTimeoutId = window.setTimeout(() => {
      requestTimedOut = true;
      controller.abort();
    }, requestTimeoutMs);
    requestAbortRef.current.set(taskId, controller);
    shouldStickToLatestRef.current = true;
    isJumpingToLatestRef.current = false;
    setShowJumpToLatest(false);
    setRunningTaskIds((current) => current.includes(taskId) ? current : [...current, taskId]);
    setRunningCapabilitiesByTask((current) => ({ ...current, [taskId]: requestCapabilityIds }));
    setInput(""); setError("");
    setLastRun({ input: text, display: displayText });
    const userMessage: ProductMessage = { id: crypto.randomUUID(), role: "user", content: displayText };
    setMessages((current) => [...current, userMessage]);
    setTasks((current) => current.map((task) => task.id === taskId
      ? { ...task, title: task.customTitle || taskTitleFromMessages([...task.messages, userMessage]), messages: [...task.messages, userMessage].slice(-40), capabilityId: capabilityId || task.capabilityId, customerProfile: taskCustomerProfile, knowledgeDocumentIds: taskKnowledgeDocumentIds, knowledgeSubjectId: taskKnowledgeSubjectId, updatedAt: new Date().toISOString() }
      : task));
    try {
      const response = await fetch(apiPath(`/agents/${slug}/runs`), {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          requestId: crypto.randomUUID(),
           input: text,
           routingInput: displayText,
           capabilityId: capabilityId || undefined,
           capabilityIds: requestCapabilityIds.length > 1 ? requestCapabilityIds : undefined,
          capabilitySelectionMode: explicitCapabilityIds.length > 0 || Boolean(pinnedTaskCapability) ? "explicit" : "auto",
          conversationId: taskConversationId,
          deviceScope,
          history: taskHistory,
          knowledgeDocumentIds: taskKnowledgeDocumentIds.length ? taskKnowledgeDocumentIds : undefined,
          knowledgeSubjectId: taskKnowledgeSubjectId || undefined,
          knowledgeIdentityContext: knowledgeIdentityContext || undefined,
          knowledgeBusinessGoal: knowledgeBusinessGoal || undefined,
          knowledgeFactCorrections: knowledgeFactCorrections || undefined,
          taskCustomerProfile: Object.keys(taskCustomerProfile).length > 0 ? taskCustomerProfile : undefined
        })
      });
      if (controller.signal.aborted) return;
      if (response.status === 401) { clearCustomerSession(); loginFor(`/agents/${slug}`); return; }
      const data = await readJson<{
        answerText?: string;
        message?: string;
        agentRunId?: string;
        conversationId?: string;
        capabilityId?: string;
        analysisMode?: "fast" | "deep";
        analysisBrief?: AgentAnalysisBrief;
        nextActions?: string[];
        knowledgeSources?: KnowledgeSourceView[];
        ipVoiceStyleApplied?: boolean;
        ipVoiceStyleConfidence?: "high" | "medium" | "low";
        deliveryStatus?: "completed" | "needs_input" | "failed";
        reasoningProfile?: AgentReasoningProfile;
        stableDelivery?: StableAgentDelivery;
        execution?: AgentExecutionView;
      }>(response);
      const assistantMessage: ProductMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: data.answerText ?? data.message ?? "",
        agentRunId: data.agentRunId,
        capabilityId: data.capabilityId ?? (capabilityId || undefined),
        analysisMode: data.analysisMode,
        analysisBrief: data.analysisBrief,
        nextActions: data.nextActions,
        knowledgeSources: data.knowledgeSources,
        ipVoiceStyleApplied: data.ipVoiceStyleApplied,
        ipVoiceStyleConfidence: data.ipVoiceStyleConfidence,
        deliveryStatus: data.deliveryStatus,
        reasoningProfile: data.reasoningProfile,
        stableDelivery: data.stableDelivery,
        execution: data.execution
      };
      setTasks((current) => current.map((task) => task.id === taskId
        ? {
            ...task,
            conversationId: data.conversationId ?? task.conversationId,
            capabilityId: data.capabilityId ?? task.capabilityId,
            messages: [...task.messages, assistantMessage].slice(-40),
            updatedAt: new Date().toISOString(),
            loaded: true
          }
        : task));
      if (activeTaskIdRef.current === taskId) {
        if (data.conversationId) setConversationId(data.conversationId);
        if (data.capabilityId && agent.capabilities.some((item) => item.key === data.capabilityId)) setSelected(data.capabilityId);
        setMessages((current) => [...current, assistantMessage]);
      }
    } catch (reason) {
      const message = (reason as { name?: string }).name === "AbortError"
        ? requestTimedOut
          ? inferredCapability === "video_review"
            ? "本次文件复盘超过180秒，系统已停止异常请求。文件无需缩小，请直接重新上传；系统会优先使用表格复盘引擎生成报告。"
            : "本次分析超过120秒，系统已自动停止，避免页面一直等待。请检查网络后重新尝试。"
          : "已停止本次生成。你可以补充信息后再试，或直接点击“重新生成”。"
        : customerErrorMessage(reason, "服务暂时忙，请稍后再试。");
      const assistantMessage: ProductMessage = { id: crypto.randomUUID(), role: "assistant", content: message };
      setTasks((current) => current.map((task) => task.id === taskId
        ? { ...task, messages: [...task.messages, assistantMessage].slice(-40), updatedAt: new Date().toISOString() }
        : task));
      if (activeTaskIdRef.current === taskId) setMessages((current) => [...current, assistantMessage]);
    } finally {
      window.clearTimeout(requestTimeoutId);
      if (requestAbortRef.current.get(taskId) === controller) requestAbortRef.current.delete(taskId);
      setRunningTaskIds((current) => current.filter((id) => id !== taskId));
      setRunningCapabilitiesByTask((current) => {
        const next = { ...current };
        delete next[taskId];
        return next;
      });
    }
  }

  function stopGeneration(): void {
    requestAbortRef.current.get(activeTaskId)?.abort();
  }

  function regenerateLastRun(): void {
    if (!lastRun) return;
    const previous = [...messages].reverse().find((message) => message.role === "assistant" && message.agentRunId);
    void recordAgentOutcome(previous?.agentRunId, "regenerated");
    void send(lastRun.input, lastRun.display);
  }

  if (!agent) return <PageState text={error || "正在进入智能体…"} />;
  if (!agent.entitled) return <AccessRequired agent={agent} />;
  if (agent.slug === "clipper") return <ClipLabApp />;
  const orderedTasks = [...tasks].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const primarySkillId = selectedSkillIds[0] || selected || (agent.slug === "ceo-cockpit" ? agent.capabilities[0]?.key ?? "" : "");
  const activeAcquisitionSystem = isAcquisitionAgent && selectedSkillIds.length === 1
    ? acquisitionSystemEntries.find((entry) => entry.capabilityId === selectedSkillIds[0])
    : undefined;
  const topicSystemActive = activeAcquisitionSystem?.capabilityId === "topic_inspiration";
  const contentSystemActive = activeAcquisitionSystem?.capabilityId === "content_plan";
  const paidTrafficSystemActive = activeAcquisitionSystem?.capabilityId === "paid_traffic";
  const videoReviewSystemActive = activeAcquisitionSystem?.capabilityId === "video_review";
  const liveScriptSystemActive = activeAcquisitionSystem?.capabilityId === "live_script";
  const liveReviewSystemActive = activeAcquisitionSystem?.capabilityId === "live_review";
  const acquisitionSystemWorkbenchActive = topicSystemActive || contentSystemActive || paidTrafficSystemActive || videoReviewSystemActive || liveScriptSystemActive || liveReviewSystemActive;
  const knowledgeDrawerAction = {
    label: agent.knowledgeAction?.buttonLabel ?? "使用这些资料分析",
    placeholder: undefined,
    capabilityId: agent.knowledgeAction?.capabilityId
  };
  const lastTopicRequestIndex = messages.reduce((latest, message, index) => message.role === "user" && /选题系统四源运行|从四大来源生成选题/.test(message.content) ? index : latest, -1);
  const latestTopicResult = lastTopicRequestIndex >= 0
    ? messages.slice(lastTopicRequestIndex + 1).find((message) => message.role === "assistant")?.content
    : undefined;
  const topicSystemTurns: TopicSystemTurn[] = messages.reduce<TopicSystemTurn[]>((turns, message, index) => {
    if (message.role !== "user" || !message.content.startsWith("【Topic System｜Refinement】")) return turns;
    turns.push({ question: message.content.replace("【Topic System｜Refinement】", "").trim(), answer: messages.slice(index + 1).find((item) => item.role === "assistant")?.content });
    return turns;
  }, []);
  const lastContentGenerationRequestIndex = messages.reduce((latest, message, index) => message.role === "user" && /内容系统[｜|]批量内容生成/.test(message.content) ? index : latest, -1);
  const latestContentResult = lastContentGenerationRequestIndex >= 0
    ? messages.slice(lastContentGenerationRequestIndex + 1).find((message) => message.role === "assistant")?.content
    : undefined;
  const contentSystemTurns: ContentSystemTurn[] = messages.reduce<ContentSystemTurn[]>((turns, message, index) => {
    if (message.role !== "user" || !message.content.startsWith("【Content System｜Refinement】")) return turns;
    turns.push({ question: message.content.replace("【Content System｜Refinement】", "").trim(), answer: messages.slice(index + 1).find((item) => item.role === "assistant")?.content });
    return turns;
  }, []);
  const lastContentVideoRequestIndex = messages.reduce((latest, message, index) => message.role === "user" && /内容系统[｜|]拍剪优化/.test(message.content) ? index : latest, -1);
  const latestContentVideoResult = lastContentVideoRequestIndex >= 0
    ? messages.slice(lastContentVideoRequestIndex + 1).find((message) => message.role === "assistant")?.content
    : undefined;
  const lastTrafficQuestionIndex = messages.reduce((latest, message, index) => message.role === "user" && /投流(?:系统[｜|])?问题问答/.test(message.content) ? index : latest, -1);
  const latestTrafficQuestionResult = lastTrafficQuestionIndex >= 0
    ? messages.slice(lastTrafficQuestionIndex + 1).find((message) => message.role === "assistant")?.content
    : undefined;
  const lastTrafficDataIndex = messages.reduce((latest, message, index) => message.role === "user" && /投流系统[｜|]投放数据复盘/.test(message.content) ? index : latest, -1);
  const latestTrafficDataResult = lastTrafficDataIndex >= 0
    ? messages.slice(lastTrafficDataIndex + 1).find((message) => message.role === "assistant")?.content
    : undefined;
  const lastTrafficVideoIndex = messages.reduce((latest, message, index) => message.role === "user" && /(?:投流系统[｜|])?单视频投放决策/.test(message.content) ? index : latest, -1);
  const latestTrafficVideoResult = lastTrafficVideoIndex >= 0
    ? messages.slice(lastTrafficVideoIndex + 1).find((message) => message.role === "assistant")?.content
    : undefined;
  const lastVideoReviewQuestionIndex = messages.reduce((latest, message, index) => message.role === "user" && /视频复盘系统[｜|]文字咨询/.test(message.content) ? index : latest, -1);
  const latestVideoReviewQuestionResult = lastVideoReviewQuestionIndex >= 0
    ? messages.slice(lastVideoReviewQuestionIndex + 1).find((message) => message.role === "assistant")?.content
    : undefined;
  const lastVideoReviewDataIndex = messages.reduce((latest, message, index) => message.role === "user" && /视频复盘系统[｜|]数据文件复盘/.test(message.content) ? index : latest, -1);
  const latestVideoReviewDataResult = lastVideoReviewDataIndex >= 0
    ? messages.slice(lastVideoReviewDataIndex + 1).find((message) => message.role === "assistant")?.content
    : undefined;
  const lastLiveScriptGenerationIndex = messages.reduce((latest, message, index) => message.role === "user" && /直播系统[｜|]知识库一键生成/.test(message.content) ? index : latest, -1);
  const latestLiveScriptResult = lastLiveScriptGenerationIndex >= 0
    ? messages.slice(lastLiveScriptGenerationIndex + 1).find((message) => message.role === "assistant")?.content
    : undefined;
  const liveScriptTurns: LiveScriptTurn[] = messages.reduce<LiveScriptTurn[]>((turns, message, index) => {
    if (message.role !== "user" || !/直播系统[｜|]话术修改对话/.test(message.content)) return turns;
    const answer = messages.slice(index + 1).find((item) => item.role === "assistant")?.content;
    const question = message.content.replace(/^【直播系统[｜|]话术修改对话】\s*/, "").replace(/^只修改[\s\S]*?用户修改要求：\s*/, "").trim();
    turns.push({ question, answer });
    return turns;
  }, []);
  const lastLiveReviewQuestionIndex = messages.reduce((latest, message, index) => message.role === "user" && /直播复盘系统[｜|]文字咨询/.test(message.content) ? index : latest, -1);
  const latestLiveReviewQuestionResult = lastLiveReviewQuestionIndex >= 0 ? messages.slice(lastLiveReviewQuestionIndex + 1).find((message) => message.role === "assistant")?.content : undefined;
  const liveReviewTurns: LiveReviewTurn[] = messages.reduce<LiveReviewTurn[]>((turns, message, index) => {
    if (message.role !== "user" || !/直播复盘系统[｜|]文字咨询/.test(message.content)) return turns;
    const question = message.content.replace(/^【直播复盘系统[｜|]文字咨询】\s*/, "").replace(/[\s\S]*?用户问题：\s*/, "").trim();
    turns.push({ question, answer: messages.slice(index + 1).find((item) => item.role === "assistant")?.content });
    return turns;
  }, []);
  const lastLiveReviewDataIndex = messages.reduce((latest, message, index) => message.role === "user" && /直播复盘系统[｜|]数据文件复盘/.test(message.content) ? index : latest, -1);
  const latestLiveReviewDataResult = lastLiveReviewDataIndex >= 0 ? messages.slice(lastLiveReviewDataIndex + 1).find((message) => message.role === "assistant")?.content : undefined;
  const whiteLabelAcquisition = isAcquisitionAgent && tenantBranding.isCustomized;
  const whiteLabelTakeaway = agent.slug === "takeaway-growth" && tenantBranding.isCustomized;
  const latestTakeawayAssistant = agent.slug === "takeaway-growth"
    ? latestTakeawayPrimaryAssistant(messages)
    : null;
  const displayedAgentName = tenantAgentDisplayName(
    agent.slug,
    customerAgentName(agent.name),
    tenantBranding
  );
  const automationAction = agent.automationAction ?? agent.marketing?.automationAction;
  function sendCurrentTaskToClipper(): void {
    const latestAssistant = [...messages].reverse().find((message) => message.role === "assistant")?.content ?? "";
    sessionStorage.setItem("sitong_clipper_handoff", JSON.stringify({
      sourceAgent: slug,
      taskTitle: taskTitleFromMessages(messages),
      capabilityId: selected || undefined,
      summary: latestAssistant.replace(/\s+/g, " ").slice(0, 1200),
      createdAt: new Date().toISOString()
    }));
    navigate("/agents/clipper");
  }

  function runTopicSystem(request: TopicSystemGenerationRequest): void {
    const scopeRule = request.mode === "franchise"
      ? "【品牌招商边界】只生成品牌招商加盟相关选题。目标对象是加盟商，不得生成门店到店、团购券、消费者优惠、核销、菜品促销或门店复购内容。"
      : "【门店获客边界】只生成门店本地消费者相关选题，可围绕团购、到店与复购；不得生成招商加盟、加盟商招募或品牌考察内容。";
    const profileSubject = tenantProfile?.tenantName?.trim();
    const subjectLabel = activeKnowledgeSubject?.name
      || activeCustomerProfile?.name
      || (profileSubject && !/^(?:演示|demo)/i.test(profileSubject) ? profileSubject : "本轮主体待确认");
    const benchmarkSource = request.benchmarkAccounts.length
      ? request.benchmarkAccounts.map((item, index) => `${index + 1}. ${item}`).join("\n")
      : "待补：本轮没有填写对标账号，不得虚构账号或作品。";
    const recordingSource = request.transcriptDocumentIds.length
      ? `已选择 ${request.transcriptDocumentIds.length} 条得到大脑录音转写，必须从本次知识资料中提炼真实观点、故事、案例、痛点和口头表达。`
      : "待补：当前没有可用录音转写，不得编造IP原话、案例或经历。";
    const reviewSource = request.videoReview
      ? [`复盘名称：${request.videoReview.title}`, `复盘时间：${request.videoReview.createdAt}`, "复盘正文：", request.videoReview.content.slice(0, 6_000)].join("\n")
      : "待补：还没有视频数据复盘结果，不得虚构播放、完播、互动、私信或成交数据。";
    const prompt = [
      "【选题系统自动运行】【选题系统四源运行】",
      `本轮服务主体：${subjectLabel}`,
      `【本轮${request.mode === "franchise" ? "招商" : "门店获客"} Brief】`,
      `${request.mode === "franchise" ? "品牌/项目名称" : "门店/项目名称"}：${request.identity}`,
      `${request.mode === "franchise" ? "目标加盟商" : "目标消费者"}：${request.targetCustomer}`,
      `本轮${request.mode === "franchise" ? "招商" : "门店获客"}目标：${request.acquisitionGoal}`,
      `${request.mode === "franchise" ? "招商主推产品/加盟模型" : "主推产品/团购套餐"}：${request.offer || "待补；不得虚构产品、价格或承诺。"}`,
      `${request.mode === "franchise" ? "招商账号与内容阶段" : "门店账号与内容阶段"}：${request.accountStage || "待补；默认按首轮测试处理。"}`,
      `本轮明确行业：${request.industry}`,
      scopeRule,
      "请固定调用选题系统 Skill（topic_inspiration / baolu_topics），只生成选题，不展开完整文案。",
      "",
      "【来源一｜行业热点】",
      `围绕“${request.industry}”检索和核验近期行业变化、用户问题与可用内容机会。无法核验时间或来源时必须标记待核验。`,
      "",
      "【来源二｜对标账号】",
      benchmarkSource,
      "只能使用能够确认归属的公开账号和公开内容；同名账号或无法访问的链接标记待核实。",
      "",
      "【来源三｜AI录音卡】",
      recordingSource,
      "",
      "【来源四｜视频数据复盘】",
      reviewSource,
      "",
      "先从四个来源分别形成候选，再去重合并为16至20条内部候选；随后通过三关筛选：1. 目标用户是否愿意看，并写明证据状态；2. 共识层级与客资精准度；3. 账号阶段配比。最终输出10条可测试选题，并标明每条使用了哪些来源。",
      "来源不足不能用占位框架冒充结果，也不能瞎补事实；已有来源足够时直接完成第一版。禁止四维评分和综合分。"
    ].join("\n");
    const display = `从四大来源生成${request.mode === "franchise" ? "招商" : "门店"}选题\n${request.mode === "franchise" ? "品牌/项目" : "门店/项目"}：${request.identity}\n${request.mode === "franchise" ? "目标加盟商" : "目标消费者"}：${request.targetCustomer}\n本轮目标：${request.acquisitionGoal}\n行业：${request.industry}\n对标账号：${request.benchmarkAccounts.length ? request.benchmarkAccounts.join("、") : "待补"}\nAI录音卡：${request.transcriptDocumentIds.length} 条转写\n视频数据复盘：${request.videoReview ? "已回流" : "待补"}`;
    setActiveKnowledgeDocumentIds(request.transcriptDocumentIds);
    void send(prompt, display, "topic_inspiration", request.transcriptDocumentIds);
  }

  function refineTopics(question: string): void {
    const prompt = [
      "【Topic System｜Refinement】",
      question,
      "只围绕当前选题系统的本轮候选题进行调整：可修改目标客户、来源证据、选题角度、优先级或发布平台。只输出可替换的选题结果和必要的待核实项，不得扩写为完整文案、直播话术、投流方案或复盘报告。没有真实来源支撑的事实必须标记【待核实】。"
    ].join("\n");
    void send(prompt, `选题系统微调\n${question}`, "topic_inspiration", activeKnowledgeDocumentIds);
  }

  function runContentSystem(topics: string[]): void {
    if (topics.length === 0) return;
    const profileSubject = tenantProfile?.tenantName?.trim();
    const subjectLabel = activeKnowledgeSubject?.name
      || activeCustomerProfile?.name
      || (profileSubject && !/^(?:演示|demo)/i.test(profileSubject) ? profileSubject : "本轮主体待确认");
    const scopeRule = isFranchiseAgent
      ? "只生成品牌招商加盟内容，目标对象是加盟商；不得生成门店到店、团购券、消费者优惠、核销、菜品促销或门店复购内容。"
      : "只生成门店本地消费者内容，可围绕团购、到店与复购；不得生成招商加盟、加盟商招募或品牌考察内容。";
    const prompt = [
      "【内容系统｜批量内容生成】",
      `本轮服务主体：${subjectLabel}`,
      "以下是用户已经确认、需要分别创作的选题：",
      ...topics.map((topic, index) => `${index + 1}. ${topic}`),
      "",
      "固定调用内容创作能力（content_plan / baolu_content_creator）。每一个选题必须独立输出一份完整内容执行包，严禁把不同选题、行业或客户项目混在一起。",
      scopeRule,
      "每份交付必须覆盖：选题策划、60至90秒口播逐字稿、拍摄脚本、拍摄注意事项、剪辑EDL、发布标题与话题、发布时间、评论区引导话术、投流建议。",
      "缺少事实时只标待补，不得虚构品牌、数据、案例、城市或承诺。面向用户不要出现九件套、Skill、Prompt 等内部名称。"
    ].join("\n");
    const display = `【内容系统｜批量内容生成】\n已选 ${topics.length} 个选题：\n${topics.map((topic, index) => `${index + 1}. ${topic}`).join("\n")}`;
    void send(prompt, display, "content_plan");
  }

  function trafficCapabilities(mode: TrafficMode): Array<"paid_traffic" | "dou_plus_traffic"> {
    if (mode === "dou_plus_traffic" || mode === "paid_traffic") return [mode];
    // “AI 判断”同时调用两个投流 skill，再做对比结论；不能假装只用其中一个就完成选型。
    return ["dou_plus_traffic", "paid_traffic"];
  }

  function runTrafficQuestion(question: string, mode: TrafficMode): void {
    const capabilities = trafficCapabilities(mode);
    const scopeRule = isFranchiseAgent
      ? "只给招商加盟线索投流建议，禁止门店到店、团购券、消费者优惠与核销投放。"
      : "只给门店本地消费者、团购和到店投流建议，禁止招商加盟线索投放。";
    const prompt = [
      "【投流系统｜问题问答】",
      `用户选择：${mode === "auto" ? "先比较 DOU+ 与巨量本地推" : mode === "dou_plus_traffic" ? "DOU+" : "巨量本地推"}`,
      "请基于用户的真实业务、目标、地域、承接和预算回答投流问题。若比较两种工具，必须分别给出「DOU+投放建议」与「本地推投放建议」，再给最终选择理由；缺少的数据明确列为待补。",
      "只输出诊断、测试与 PREVIEW_ONLY 预览，不得声称已经操作真实广告账户。",
      scopeRule,
      "用户问题：",
      question
    ].join("\n");
    void send(prompt, `投流问题问答 · ${mode === "auto" ? "比较 DOU+ 与本地推" : mode === "dou_plus_traffic" ? "DOU+" : "巨量本地推"}\n${question}`, capabilities);
  }

  function runTrafficVideo(videoContext: string, mode: TrafficMode): void {
    const capabilities = trafficCapabilities(mode);
    const prompt = [
      "【投流系统｜单视频投放决策】",
      "请判断这条视频是否适合投放。输出必须分成「DOU+投放建议」和「本地推投放建议」：每部分写适用性、目标、素材前提、预算/测试变量、监控、止损与待补信息；最后给明确选择或暂缓理由。",
      "未提供真实视频数据、账户权限或平台当前设置时，只能给预览建议，不能编造效果或操作账户。",
      "视频与需求：",
      videoContext
    ].join("\n");
    void send(prompt, `单视频投放决策 · ${mode === "auto" ? "比较 DOU+ 与本地推" : mode === "dou_plus_traffic" ? "DOU+" : "巨量本地推"}\n${videoContext}`, capabilities);
  }

  function refineContent(question: string): void {
    const prompt = [
      "【Content System｜Refinement】",
      question,
      "只修改当前内容系统已经生成的内容交付。用户点名哪一条选题、哪一段口播、哪个拍摄脚本、剪辑 EDL、发布动作或投流建议，就只调整该部分，并保留其他九件套模块。未确认的品牌、数据、案例、价格与承诺标记【待确认】，不要补造事实。"
    ].join("\n");
    void send(prompt, `内容系统微调\n${question}`, "content_plan", activeKnowledgeDocumentIds);
  }

  function uploadTrafficData(mode: TrafficMode): void {
    const capabilities = trafficCapabilities(mode);
    // 上传附件只能绑定一个解析能力；自动模式先按本地推的数据诊断口径读取，再在结果中保留 DOU+ 对照建议。
    const uploadCapability = capabilities.includes("paid_traffic") ? "paid_traffic" : "dou_plus_traffic";
    setTrafficUploadCapability(uploadCapability);
    setTrafficUploadStatus("请选择 CSV、Excel、截图或投放报表；选择后会自动读取并开始复盘。");
    setInput([
      "【投流系统｜投放数据复盘】",
      `本轮工具：${mode === "auto" ? "先按本地推诊断，并同时给 DOU+ 对照建议" : mode === "dou_plus_traffic" ? "DOU+" : "巨量本地推"}`,
      "请逐项读取上传数据，先说明字段、周期和数据口径，再诊断投放问题并给下一轮投放建议。若需比较，分别列出 DOU+投放建议和本地推投放建议。"
    ].join("\n"));
    setTrafficUploadSignal((value) => value + 1);
  }

  function runVideoReviewQuestion(question: string): void {
    const prompt = [
      "【视频复盘系统｜文字咨询】",
      "这是一个视频复盘方法或指标咨询。请直接用清晰、专业的文字回答用户的问题。",
      "如果没有提供真实后台数据，不得推断某条视频的具体表现；只说明判断逻辑、常见原因和需要补充的指标。",
      "不要输出完整内容文案、拍剪方案、直播话术或投流方案。",
      "用户问题：",
      question
    ].join("\n");
    void send(prompt, `视频复盘咨询\n${question}`, "video_review");
  }

  function uploadVideoReviewData(): void {
    setVideoReviewUploadStatus("请选择 CSV、Excel 或其他支持的数据文件。选择后会自动读取并提交复盘。");
    setInput([
      "【视频复盘系统｜数据文件复盘】",
      "请逐行读取我上传的视频平台后台数据文件。先审计字段、周期和数据质量，再按视频复盘标准输出：数据总览、作品分层、关键问题、原因判断、下一轮选题测试与待补数据。",
      "只使用文件中的真实数据；没有的字段明确标注待补，不得编造视频内容、账号情况或业务结果。"
    ].join("\n"));
    setVideoReviewUploadSignal((value) => value + 1);
  }

  function generateLiveScript(): void {
    const prompt = [
      "【直播系统｜知识库一键生成】",
      "请严格调用直播话术能力，基于本任务已选择的知识库资料、当前服务主体和已确认企业信息，生成一份可直接照读和执行的完整直播话术。",
      "完整输出应包含：开场、留人互动、价值讲解、咨询与转化承接、常见异议回应、收口与下播跟进；每段必须是主播可直接使用的话术，并配必要的运营动作。",
      "未被知识库或本轮输入确认的价格、福利、库存、门店、案例、政策和承诺，统一标记【待确认】，不得编造。不要输出短视频文案、拍剪建议或直播数据复盘。"
    ].join("\n");
    void send(prompt, "直播系统｜根据知识库一键生成直播话术", "live_script");
  }

  function reviseLiveScript(question: string): void {
    const prompt = [
      "【直播系统｜话术修改对话】",
      "请基于本任务已有直播话术和已确认知识库资料，只修改用户点名的直播环节。直接给出可照读的新话术及必要的场控动作，不要扩写成无关的短视频、投流或复盘交付。",
      "缺少真实事实时，明确标记【待确认】，不得自行虚构价格、福利、案例、政策或效果。",
      "用户修改要求：",
      question
    ].join("\n");
    void send(prompt, `直播话术修改\n${question}`, "live_script");
  }

  function runLiveReviewQuestion(question: string): void {
    const prompt = [
      "【直播复盘系统｜文字咨询】",
      "这是一个直播复盘方法或指标咨询。请直接用专业、清晰的文字回答，并给出可执行的排查顺序。",
      "没有真实后台数据时，只能说明判断逻辑、常见原因和应补数据；不得推断用户某一场直播的具体流量、转化或话术表现。",
      "不要输出直播话术、短视频文案、投流方案或占位式完整复盘报告。",
      "用户问题：",
      question
    ].join("\n");
    void send(prompt, `直播复盘咨询\n${question}`, "live_review");
  }

  function uploadLiveReviewData(): void {
    setInput([
      "【直播复盘系统｜数据文件复盘】",
      "请读取我上传的直播后台数据文件。先审计字段、时间范围和统计口径，再严格按直播复盘结构输出：核心数据速览、流量诊断、转化归因、互动诊断、话术执行对照表、人货场诊断、方法论沉淀和下次直播调整清单。",
      "只使用文件中的真实数据；缺少的字段标记【数据缺口】或【待核实】，不得编造场观、成交、话术原话或经营结果。"
    ].join("\n"));
    setLiveReviewUploadSignal((value) => value + 1);
  }
  return (
    <div className={`agentWorkspacePage workbuddyLayout ${slug} ${slug === "takeaway-growth" ? "takeawayWorkbenchMode" : ""} ${topicSystemActive ? "topicSystemStandaloneMode" : contentSystemActive ? "contentSystemStandaloneMode" : paidTrafficSystemActive ? "paidTrafficStandaloneMode" : videoReviewSystemActive ? "videoReviewStandaloneMode" : liveScriptSystemActive ? "liveScriptStandaloneMode" : liveReviewSystemActive ? "liveReviewStandaloneMode" : ""}`}>
      <aside className="agentSidebar agentTaskSidebar">
        <button className="agentBrand" onClick={() => navigate("/my-ai")}><AgentAvatar agent={agent} branding={tenantBranding} /><strong>{displayedAgentName}</strong></button>
        <button className="newAgentTaskButton" type="button" onClick={startNewConversation}><span>＋</span>新建任务</button>
        {agent.marketing?.workMap && <button className="knowledgeSidebarButton workMapSidebarButton" type="button" onClick={() => setWorkMapOpen(true)}><span>图</span><div><strong>{agent.slug === "takeaway-growth" ? "任务地图" : "工作地图"}</strong><small>{agent.slug === "takeaway-growth" ? "按数据、诊断、实验与复盘进入" : "查看业务路径、分支和复盘回流"}</small></div></button>}
        {agent.knowledgeAction?.enabled && <button className={`knowledgeSidebarButton ${activeKnowledgeDocumentIds.length ? "active" : ""}`} type="button" onClick={() => setKnowledgeDrawerOpen(true)}><span>◉</span><div><strong>经营资料库</strong><small>{activeKnowledgeDocumentIds.length ? `当前任务已选 ${activeKnowledgeDocumentIds.length} 条` : "选择资料让智能体分析"}</small></div></button>}
        {automationAction?.enabled && <button className="knowledgeSidebarButton automationSidebarButton" type="button" onClick={() => setAutomationDrawerOpen(true)}><span>⏱</span><div><strong>自动化</strong><small>让当前智能体按计划自动工作</small></div></button>}
        {isAcquisitionAgent && <nav className="acquisitionSystemNav" aria-label="获客系统板块">
          {acquisitionSystemEntries.map((entry) => <button
            key={entry.capabilityId}
            className={activeAcquisitionSystem?.capabilityId === entry.capabilityId ? "active" : ""}
            type="button"
            aria-pressed={activeAcquisitionSystem?.capabilityId === entry.capabilityId}
            onClick={() => activateAcquisitionSystem(entry.capabilityId)}
          ><span>{entry.icon}</span><div><strong>{entry.title}</strong><small>{entry.subtitle}</small></div></button>)}
        </nav>}
        {isAcquisitionAgent && <button className={`customerProfileSidebarButton ${activeKnowledgeSubject?.name || activeCustomerProfile?.name ? "active" : ""}`} type="button" onClick={() => setCustomerSubjectPickerOpen(true)}><span>客</span><div><strong>当前客户资料</strong><small>{activeKnowledgeSubject?.name ? `${activeKnowledgeSubject.name} · ${activeKnowledgeSubject.documentCount ?? 0} 条资料` : activeCustomerProfile?.name ? `${activeCustomerProfile.name}${activeCustomerProfile.city ? ` · ${activeCustomerProfile.city}` : ""}` : "点击选择已有客户或新增客户"}</small></div></button>}
        {isAcquisitionAgent && <button className="clipperSidebarButton" type="button" onClick={sendCurrentTaskToClipper}><span>🎬</span><div><strong>发送到自由组片</strong><small>携带当前任务摘要，进入独立剪辑工作台</small></div></button>}
        <section className="agentTaskList">
          <div className="agentTaskListHeader"><span>任务 · {deviceScope === "desktop" ? "电脑端" : "手机端"}</span><small>{orderedTasks.length}</small></div>
          {orderedTasks.map((task) => {
            const active = task.id === activeTaskId;
            const running = runningTaskIds.includes(task.id);
            const displayTitle = task.customTitle || (active ? taskTitleFromMessages(messages) : task.title);
            const renaming = renamingTaskId === task.id;
            return <article className={`agentTaskItem ${active ? "active" : ""} ${running ? "running" : ""}`.trim()} key={task.id}>
              {renaming ? <div className="taskSelectButton taskRenameRow">
                <span className="taskStatusDot" />
                <input
                  autoFocus
                  aria-label="修改任务名称"
                  maxLength={80}
                  value={renameTaskValue}
                  onChange={(event) => setRenameTaskValue(event.target.value)}
                  onBlur={() => commitTaskRename(task.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") { event.preventDefault(); commitTaskRename(task.id); }
                    if (event.key === "Escape") { setRenamingTaskId(null); setRenameTaskValue(""); }
                  }}
                />
              </div> : <button className="taskSelectButton" type="button" onClick={() => void switchConversation(task.id)}>
                <span className="taskStatusDot" />
                <span className="taskText"><strong title={displayTitle}>{displayTitle}</strong><small>{running ? "执行中" : task.messages.length > 0 ? active ? "最近使用" : "历史任务" : "等待输入"}</small></span>
              </button>}
              {!renaming && <button
                className="taskMoreButton"
                type="button"
                aria-label={`管理任务：${displayTitle}`}
                aria-expanded={taskMenuId === task.id}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => { setDeletingTaskId(null); setTaskMenuId((current) => current === task.id ? null : task.id); }}
              >•••</button>}
              {taskMenuId === task.id && <div className="taskActionMenu" role="menu" onPointerDown={(event) => event.stopPropagation()}>
                {deletingTaskId === task.id ? <>
                  <span className="taskDeletePrompt">本设备将不再显示，确定删除？</span>
                  <div className="taskDeleteActions"><button type="button" onClick={() => setDeletingTaskId(null)}>取消</button><button type="button" className="danger" onClick={() => deleteTask(task)}>确认删除</button></div>
                </> : <>
                  <button type="button" role="menuitem" onClick={() => beginTaskRename(task)}>重命名</button>
                  <button type="button" role="menuitem" className="danger" onClick={() => setDeletingTaskId(task.id)}>删除任务</button>
                </>}
              </div>}
            </article>;
          })}
        </section>
        <section className="agentAbilityNote">
          <span>{whiteLabelAcquisition ? "企业品牌获客工作台" : whiteLabelTakeaway ? `${tenantBranding.brandName}专属外卖增长工作台` : agent.marketing?.method ?? "智能体能力"}</span>
          <p>{whiteLabelTakeaway ? "当前空间只使用本企业的门店、经营资料和指标口径；先选老店或新店，再进入诊断—实验—执行—反馈—复盘闭环。" : "直接描述任务，智能体会自动选择并组合技能；也可以在输入框里手动指定。"}</p>
        </section>
        <div className="sidebarBottom"><button onClick={() => navigate("/enterprise-knowledge-base")}>企业知识库</button><button onClick={() => navigate("/my-ai")}>我的智能体</button><button onClick={() => navigate("/account")}>企业账户</button></div>
      </aside>
      <main className="agentChatArea">
          <header><div><span>{activeAcquisitionSystem ? `${activeAcquisitionSystem.title} · MCP 直连` : whiteLabelAcquisition ? "企业品牌获客工作台" : whiteLabelTakeaway ? "专属外卖增长工作台" : agent.marketing?.method ?? "连锁品牌增长工作空间"}</span><h1>{displayedAgentName}</h1></div><div className="agentHeaderActions">{activeKnowledgeDocumentIds.length > 0 && <button className="knowledgeActivePill" onClick={() => setKnowledgeDrawerOpen(true)}>已选 {activeKnowledgeDocumentIds.length} 条经营资料</button>}<span className={`autoRoutingPill ${activeAcquisitionSystem || agent.slug === "takeaway-growth" ? "locked" : ""}`}>{agent.slug === "takeaway-growth" ? "五步工作台 · 模块固定" : activeAcquisitionSystem ? `${activeAcquisitionSystem.title} · 固定 Skill` : selectedSkillIds.length > 0 ? `已指定 ${selectedSkillIds.length} 个技能` : "自动编排技能"}</span><button className="ghostButton" onClick={startNewConversation}>{agent.slug === "takeaway-growth" ? "新一轮" : "新对话"}</button>{busy && <button className="ghostButton stopGenerationButton" onClick={stopGeneration}>停止生成</button>}{!busy && lastRun && <button className="ghostButton" onClick={regenerateLastRun}>重新生成</button>}</div></header>
        <div className="productMessagesViewport">
          <section className={`productMessages ${acquisitionSystemWorkbenchActive ? "topicSystemMessages" : ""}`} ref={productMessagesRef} onScroll={handleMessagesScroll} aria-label={topicSystemActive ? "选题系统工作台与生成结果" : contentSystemActive ? "内容系统工作台与生成结果" : videoReviewSystemActive ? "视频复盘系统工作台与复盘结果" : liveScriptSystemActive ? "直播系统工作台与话术输出" : liveReviewSystemActive ? "直播复盘系统工作台与复盘结果" : agent.slug === "takeaway-growth" ? "外卖增长工作台与交付结果" : "对话消息"}>
          {topicSystemActive ? <TopicSystemWorkbench
            agentSlug={agent.slug}
            mode={isFranchiseAgent ? "franchise" : "store"}
            key={`${activeTaskId}:${activeKnowledgeSubjectId ?? "enterprise"}`}
            headers={authHeaders()}
            deviceScope={deviceScope}
            tenantRole={tenantRole}
            subjectId={activeKnowledgeSubjectId}
            subjectName={activeKnowledgeSubject?.name || activeCustomerProfile?.name}
            defaultIndustry={activeKnowledgeSubject?.industry
              || activeCustomerProfile?.industry
              || (/^(?:演示|demo)/i.test(tenantProfile?.tenantName?.trim() || "") ? "" : tenantProfile?.industry)}
            busy={busy || claimingTrial}
            result={latestTopicResult}
            turns={topicSystemTurns}
            onGenerate={runTopicSystem}
            onAsk={refineTopics}
            onOpenKnowledge={() => setKnowledgeDrawerOpen(true)}
            onOpenVideoReview={() => {
              activateAcquisitionSystem("video_review");
              setInput(capabilityPromptExample("video_review"));
            }}
            onChooseSubject={() => setCustomerSubjectPickerOpen(true)}
            onBackToMap={() => setWorkMapOpen(true)}
          /> : contentSystemActive ? <ContentSystemWorkbench
            busy={busy || claimingTrial}
            result={latestContentResult}
            videoResult={latestContentVideoResult}
            turns={contentSystemTurns}
            headers={authHeaders()}
            onGenerate={runContentSystem}
            onAsk={refineContent}
            onStop={stopGeneration}
            onUploadVideo={() => {
              setInput("【内容系统｜拍剪优化】根据我上传的视频，给出镜头结构、拍摄问题、剪辑节奏、字幕封面和发布前修改建议。");
              setContentVideoUploadSignal((value) => value + 1);
            }}
            onBackToMap={() => setWorkMapOpen(true)}
          /> : paidTrafficSystemActive ? <PaidTrafficWorkbench
            busy={busy || claimingTrial}
            questionResult={latestTrafficQuestionResult}
            dataResult={latestTrafficDataResult}
            videoResult={latestTrafficVideoResult}
            uploadStatus={trafficUploadStatus}
            onBackToMap={() => setWorkMapOpen(true)}
            onAsk={runTrafficQuestion}
            onReviewData={uploadTrafficData}
            onPlanVideo={runTrafficVideo}
            onStop={stopGeneration}
          /> : videoReviewSystemActive ? <VideoReviewWorkbench
            busy={busy || claimingTrial}
            questionResult={lastVideoReviewQuestionIndex > lastVideoReviewDataIndex ? latestVideoReviewQuestionResult : undefined}
            dataResult={lastVideoReviewDataIndex >= lastVideoReviewQuestionIndex ? latestVideoReviewDataResult : undefined}
            uploadStatus={videoReviewUploadStatus}
            onBackToMap={() => setWorkMapOpen(true)}
            onAsk={runVideoReviewQuestion}
            onUploadData={uploadVideoReviewData}
            onStop={stopGeneration}
          /> : liveScriptSystemActive ? <LiveScriptWorkbench
            busy={busy || claimingTrial}
            knowledgeDocumentCount={activeKnowledgeDocumentIds.length}
            scriptResult={latestLiveScriptResult}
            turns={liveScriptTurns}
            onBackToMap={() => setWorkMapOpen(true)}
            onOpenKnowledge={() => setKnowledgeDrawerOpen(true)}
            onGenerate={generateLiveScript}
            onAsk={reviseLiveScript}
            onStop={stopGeneration}
          /> : liveReviewSystemActive ? <LiveReviewWorkbench
            busy={busy || claimingTrial}
            questionResult={lastLiveReviewQuestionIndex > lastLiveReviewDataIndex ? latestLiveReviewQuestionResult : undefined}
            dataResult={lastLiveReviewDataIndex >= lastLiveReviewQuestionIndex ? latestLiveReviewDataResult : undefined}
            turns={liveReviewTurns}
            onBackToMap={() => setWorkMapOpen(true)}
            onAsk={runLiveReviewQuestion}
            onUploadData={uploadLiveReviewData}
          /> : <>
          {agent.slug === "takeaway-growth" && !takeawayMapEntry && <TakeawayGrowthWorkbench
            key={activeTaskId}
            brandName={tenantBranding.isCustomized ? tenantBranding.brandName : "枕水江南"}
            storageScope={activeTaskId}
            dataStatus={takeawayDataStatus}
            busy={busy || claimingTrial}
            latestResult={latestTakeawayAssistant ? { id: latestTakeawayAssistant.id, content: latestTakeawayAssistant.content, deliveryStatus: latestTakeawayAssistant.deliveryStatus } : null}
            latestResultContent={latestTakeawayAssistant ? <StructuredAnswerBody content={latestTakeawayAssistant.content} compact /> : undefined}
            mapEntry={null}
            onOpenImport={() => setTakeawayOpenImportSignal((value) => value + 1)}
            onRun={(capabilityId, prompt, display) => void send(prompt, display, capabilityId)}
            onOpenTaskMap={() => setWorkMapOpen(true)}
          />}
          {messages.length === 0 && agent.slug !== "takeaway-growth" && (
            <div className="agentWelcome unifiedAgentWelcome">
              {agent.slug === "ceo-cockpit" ? <CeoHeroVisual /> : <AgentAvatar agent={agent} branding={tenantBranding} />}
              <span className="welcomeEyebrow">{agent.slug === "ceo-cockpit" ? "老板经营闭环 · 推 看 决 令" : agent.slug === "takeaway-growth" ? "外卖订单与利润 · 诊断到实验" : agent.slug === "restaurant-growth" ? "餐饮四场景 · 诊断到执行" : "统一对话 · 自动调用专业技能"}</span>
              <h2>{agent.slug === "ceo-cockpit" ? <>今天公司怎么样？<br />先看什么、决定什么？</> : agent.slug === "takeaway-growth" ? <>今天先做老店增长，<br />还是新店突破？</> : agent.slug === "restaurant-growth" ? <>今天先解决哪类<br />餐饮增长问题？</> : whiteLabelAcquisition ? <>今天想让{tenantBranding.brandName}<br />帮你完成什么？</> : <>今天想让{agent.slug === "sales" ? "销售智能体" : "增长智能体"}<br />帮你完成什么？</>}</h2>
              <p>{agent.marketing?.tagline ?? "直接说目标即可。一个问题里可以同时要短视频文案、直播话术、朋友圈和复盘方案。"}</p>
              {agent.slug === "acquisition" && <section className="welcomeCustomerSelector" aria-label="选择当前客户">
                <div><span>当前任务服务客户</span><strong>{activeKnowledgeSubject?.name ?? activeCustomerProfile?.name ?? "尚未选择客户"}</strong><small>{activeKnowledgeSubject ? `${activeKnowledgeSubject.typeLabel ?? "客户项目"} · 已归属 ${activeKnowledgeSubject.documentCount ?? 0} 条资料，执行时按资料权限自动调用` : "先选择客户，可避免把不同项目的资料混在一起。"}</small></div>
                <div><button type="button" onClick={() => setCustomerSubjectPickerOpen(true)}>选择已有客户</button><button type="button" className="primary" onClick={() => navigate(`/knowledge-base?mode=create&subjectType=client_project&returnTo=${encodeURIComponent(`/agents/${slug}`)}`)}>＋ 新增客户</button></div>
              </section>}
              {agent.slug === "acquisition" && <section className="welcomeScenarioSection">
                <header><strong>按业务场景开始</strong><span>自动组合多个专业技能</span></header>
                <div className="welcomeScenarioGrid">{ACQUISITION_SCENARIO_STARTERS.map((scenario) => <button type="button" key={scenario.id} onClick={() => {
                  setSelected("");
                  setSelectedSkillIds([...scenario.capabilityIds]);
                  setInput(scenario.prompt);
                  workspaceInputRef.current?.focus();
                }}><strong>{scenario.title}</strong><small>{scenario.subtitle}</small></button>)}</div>
              </section>}
              {agent.slug === "takeaway-growth" && <section className="welcomeScenarioSection takeawayScenarioSection">
                <p className="takeawayFirstUseNote"><strong>第一次使用：</strong>先在右侧“智能导入”上传平台导出的表格；数据校验完成后，再选择下面的门店阶段开始诊断。</p>
                <header><strong>先选择门店阶段</strong><span>{tenantBranding.isCustomized ? `${tenantBranding.brandName}专属经营空间` : "老店增长与新店突破使用不同方法"}</span></header>
                <div className="welcomeScenarioGrid">{TAKEAWAY_SCENARIO_STARTERS.map((scenario) => <button type="button" key={scenario.id} onClick={() => stageTakeawayPrompt(
                  scenario.title,
                  scenario.capabilityIds,
                  scenario.prompt.replace("【品牌名称】", tenantBranding.isCustomized ? tenantBranding.brandName : "【品牌名称】")
                )}><strong>{scenario.title}</strong><small>{scenario.subtitle}</small></button>)}</div>
                {scenarioNotice && <p className="agentNotice" role="status" aria-live="polite">{scenarioNotice}</p>}
              </section>}
              {agent.slug === "restaurant-growth" && <section className="welcomeScenarioSection restaurantScenarioSection">
                <header><strong>按餐饮经营场景开始</strong><span>行业诊断后自动组合执行能力</span></header>
                <div className="welcomeScenarioGrid">{RESTAURANT_SCENARIO_STARTERS.map((scenario) => <button type="button" key={scenario.id} onClick={() => {
                  setSelected("");
                  setSelectedSkillIds([...scenario.capabilityIds]);
                  setInput(scenario.prompt);
                  workspaceInputRef.current?.focus();
                }}><strong>{scenario.title}</strong><small>{scenario.subtitle}</small></button>)}</div>
              </section>}
              {agent.slug === "ceo-cockpit" && <section className="ceoLoopStrip" aria-label="CEO驾驶舱闭环"><span><b>推</b>主动简报</span><span><b>看</b>经营地图</span><span><b>决</b>老板审批</span><span><b>令</b>执行回流</span></section>}
              {agent.slug === "takeaway-growth" && <section className="ceoLoopStrip takeawayLoopStrip" aria-label="外卖增长闭环"><span><b>1</b>数据建档</span><span><b>2</b>诊断原因</span><span><b>3</b>审批实验</span><span><b>4</b>执行回传</span><span><b>5</b>复盘复制</span></section>}
              <span className="welcomeCapabilityLabel">{agent.slug === "ceo-cockpit" ? "选择驾驶舱模块" : "或选择一个专业技能"}</span>
              <div className="welcomePromptGrid">
                {agent.capabilities.map((capability) => (
                  <button type="button" key={capability.key} onClick={() => agent.slug === "takeaway-growth"
                    ? stageTakeawayPrompt(capability.title, [capability.key], capabilityPromptExample(capability.key))
                    : (setSelected(capability.key), setSelectedSkillIds([capability.key]), setInput(capabilityPromptExample(capability.key)), workspaceInputRef.current?.focus())}>
                    <strong>{capability.title}</strong><small>{capability.subtitle}</small>
                  </button>
                ))}
              </div>
            </div>
          )}
          {agent.slug === "ceo-cockpit" && <CeoKnowledgeAnalysisPanel />}
          {agent.slug !== "takeaway-growth" && messages.map((message) => (
            <article
              key={message.id}
              className={`productMessage ${message.role}`}
              aria-label={message.role === "assistant" ? `${displayedAgentName}的消息` : "你的消息"}
            >
              {message.role === "assistant" ? <AgentAvatar agent={agent} branding={tenantBranding} /> : null}
              <div className="productMessageBubble">{message.role === "assistant"
                ? <>{isLegacyTopicResult(message.content) ? <p className="legacyTopicResultNotice">这是升级前保存的历史选题结果，仍会保留原文。请重新点击“选题系统”，生成“四大来源 + 三关筛选”的新版结果。</p> : null}<AgentAnswer message={message} agentName={displayedAgentName} onAction={(action) => { setInput(action); workspaceInputRef.current?.focus(); }} />{message.knowledgeSources?.length ? <div className="messageKnowledgeSources"><span>本次实际使用的知识{message.ipVoiceStyleApplied ? <em>{ipVoiceStyleLabel(message.ipVoiceStyleConfidence)}</em> : null}</span>{message.knowledgeSources.map((source) => <button key={source.id} onClick={() => setKnowledgeDrawerOpen(true)}>{source.autoIncluded ? "自动｜" : "手动｜"}{source.title}</button>)}</div> : null}</>
                : message.content}</div>
            </article>
          ))}
          {claimingTrial && <p className="agentNotice">正在把免费体验保存到你的企业会话…</p>}
          {agent.slug !== "takeaway-growth" && busy && <article className="productMessage assistant thinking"><AgentAvatar agent={agent} branding={tenantBranding} /><div><ThinkingStatus agent={agent} capabilityIds={runningCapabilitiesByTask[activeTaskId] ?? []} /></div></article>}
          </>}
          </section>
          {showJumpToLatest && <button className="jumpToLatestButton" type="button" onClick={jumpToLatestMessage} aria-label="直达最新消息" title="直达最新消息"><span aria-hidden="true">↓</span></button>}
        </div>
        {agent.slug !== "takeaway-growth" && !acquisitionSystemWorkbenchActive && <div className="agentComposerShell">
          <ChatComposer
            inputValue={input}
            busy={busy || claimingTrial}
            currentConsultantId={agent.slug === "sales" ? "sales_growth_advisor" : consultantForCapability(primarySkillId)}
            capabilityId={agent.slug === "sales" && composerCapability(primarySkillId) === "content_plan"
              ? "customer_diagnosis"
              : composerCapability(primarySkillId)}
            profileReady={hasUsableTenantProfile(tenantProfile)}
            profileSummary={tenantProfileSummary(tenantProfile)}
            skillOptions={agent.capabilities.map((item) => ({ id: item.key, title: item.title, subtitle: item.subtitle }))}
            selectedSkillIds={selectedSkillIds}
            onSelectedSkillIdsChange={setSelectedSkillIds}
            headers={authHeaders()}
            inputRef={workspaceInputRef}
            onInputChange={setInput}
            onKeyDown={() => undefined}
            onSend={send}
            filePickerSignal={contentSystemActive ? contentVideoUploadSignal : undefined}
            autoSendVideoUpload={contentSystemActive}
          />
        </div>}
        {contentSystemActive && <ChatComposer
          inputValue={input}
          busy={busy || claimingTrial}
          currentConsultantId={consultantForCapability("shooting_editing")}
          capabilityId="shooting_editing"
          headers={authHeaders()}
          inputRef={workspaceInputRef}
          onInputChange={setInput}
          onKeyDown={() => undefined}
          onSend={send}
          filePickerSignal={contentVideoUploadSignal}
          autoSendVideoUpload
          uploadBridgeOnly
        />}
        {paidTrafficSystemActive && <ChatComposer
          inputValue={input}
          busy={busy || claimingTrial}
          currentConsultantId={consultantForCapability(trafficUploadCapability)}
          capabilityId={trafficUploadCapability}
          headers={authHeaders()}
          inputRef={workspaceInputRef}
          onInputChange={setInput}
          onKeyDown={() => undefined}
          onSend={send}
          filePickerSignal={trafficUploadSignal}
          autoSendFileUpload
          uploadAccept="image/*,video/*,.pdf,.docx,.xls,.xlsx,.csv,.txt,.md,.json,.tsv,.log"
          uploadBridgeOnly
          onUploadStatusChange={setTrafficUploadStatus}
        />}
        {videoReviewSystemActive && <ChatComposer
          inputValue={input}
          busy={busy || claimingTrial}
          currentConsultantId={consultantForCapability("video_review")}
          capabilityId="video_review"
          headers={authHeaders()}
          inputRef={workspaceInputRef}
          onInputChange={setInput}
          onKeyDown={() => undefined}
          onSend={send}
          filePickerSignal={videoReviewUploadSignal}
          autoSendFileUpload
          uploadAccept=".csv,.tsv,.xlsx,.xls,.txt,.md,.json,.pdf"
          uploadBridgeOnly
          onUploadStatusChange={setVideoReviewUploadStatus}
        />}
        {liveReviewSystemActive && <ChatComposer
          inputValue={input}
          busy={busy || claimingTrial}
          currentConsultantId={consultantForCapability("live_review")}
          capabilityId="live_review"
          headers={authHeaders()}
          inputRef={workspaceInputRef}
          onInputChange={setInput}
          onKeyDown={() => undefined}
          onSend={send}
          filePickerSignal={liveReviewUploadSignal}
          autoSendFileUpload
          uploadAccept=".csv,.tsv,.xlsx,.xls,.txt,.md,.json,.pdf"
          uploadBridgeOnly
        />}
      </main>
      {agent.slug === "ceo-cockpit"
        ? <CeoCommandPanel />
        : agent.slug === "takeaway-growth"
          ? <TakeawayGrowthDataPanel
              headers={authHeaders()}
              openImportSignal={takeawayOpenImportSignal}
              onDashboardChange={setTakeawayDataStatus}
              onStartDiagnosis={(prompt) => {
                setSelected("takeaway_data_foundation");
                setSelectedSkillIds(["takeaway_data_foundation"]);
                void send(prompt, "工作台第1步｜上传后自动检查数据是否可用", "takeaway_data_foundation");
              }}
            />
        : <SmartFilesPanel
            agent={agent}
            messages={messages}
            tenantProfile={tenantProfile}
            knowledgeSubject={activeKnowledgeSubject}
            onOpenKnowledge={() => setKnowledgeDrawerOpen(true)}
          />}
      {agent.slug === "acquisition" && <CustomerSubjectPicker
        open={customerSubjectPickerOpen}
        subjects={knowledgeSubjects}
        selectedSubjectId={activeKnowledgeSubjectId}
        onClose={() => setCustomerSubjectPickerOpen(false)}
        onSelect={(subjectId) => {
          setActiveKnowledgeSubjectId(subjectId);
          setCustomerSubjectPickerOpen(false);
        }}
        onEditProfile={() => {
          setCustomerSubjectPickerOpen(false);
          setCustomerProfileDrawerOpen(true);
        }}
        onCreate={() => navigate(`/knowledge-base?mode=create&subjectType=client_project&returnTo=${encodeURIComponent(`/agents/${slug}`)}`)}
      />}
      {agent.slug === "acquisition" && <TaskCustomerProfileDrawer
        open={customerProfileDrawerOpen}
        profile={activeCustomerProfile}
        onClose={() => setCustomerProfileDrawerOpen(false)}
        onSave={(profile) => {
          setTasks((current) => current.map((task) => task.id === activeTaskId
            ? { ...task, customerProfile: profile, updatedAt: new Date().toISOString() }
            : task));
          setCustomerProfileDrawerOpen(false);
        }}
      />}
      {agent.marketing?.workMap && <AgentWorkMap
        open={workMapOpen && !(agent.slug === "takeaway-growth" && takeawayMapEntry)}
        definition={agent.marketing.workMap}
        agentName={displayedAgentName}
        selectedCapabilityId={primarySkillId || undefined}
        knowledgeDocumentCount={activeKnowledgeDocumentIds.length}
        knowledgeHref={getAppPath(agent.slug === "acquisition"
          ? `/agents/acquisition/enterprise-knowledge-base?returnTo=${encodeURIComponent("/agents/acquisition")}`
          : `/enterprise-knowledge-base?returnTo=${encodeURIComponent(`/agents/${slug}`)}`)}
        onClose={() => setWorkMapOpen(false)}
        onSwitchAgent={() => navigate("/my-ai")}
        onOpenKnowledge={() => {
          setWorkMapOpen(false);
          // Backward compatibility for a tab that loaded the previous V2 map:
          // the first takeaway node used to be a knowledge action. Never let
          // that stale action escape to the generic knowledge-base page.
          if (agent.slug === "takeaway-growth") {
            setTakeawayMapEntry({ capabilityId: "takeaway_data_foundation", requestId: Date.now() });
            setSelected("takeaway_data_foundation");
            setSelectedSkillIds(["takeaway_data_foundation"]);
            return;
          }
          if (agent.slug === "acquisition") {
            navigate(`/agents/acquisition/enterprise-knowledge-base?returnTo=${encodeURIComponent("/agents/acquisition")}`);
            return;
          }
          navigate(`/enterprise-knowledge-base?returnTo=${encodeURIComponent(`/agents/${slug}`)}`);
        }}
        onActivateCapability={(capabilityId) => {
          setWorkMapOpen(false);
          if (agent.slug === "takeaway-growth") {
            setTakeawayMapEntry({ capabilityId, requestId: Date.now() });
            setSelected(capabilityId);
            setSelectedSkillIds([capabilityId]);
            return;
          }
          activateAcquisitionSystem(capabilityId);
        }}
      />}
      {agent.slug === "takeaway-growth" && takeawayMapEntry && <section className="takeawayTaskMapExecutionOverlay" role="dialog" aria-modal="true" aria-label="外卖增长任务执行页">
        <div className="takeawayTaskMapExecutionFrame">
          <div className="takeawayTaskMapExecutionKicker"><span>任务地图 · 当前节点</span><strong>{tenantBranding.isCustomized ? `${tenantBranding.brandName}外卖增长智能体` : "思潼·外卖增长智能体"}</strong></div>
          <TakeawayGrowthWorkbench
            key={`${activeTaskId}:${takeawayMapEntry.requestId}`}
            brandName={tenantBranding.isCustomized ? tenantBranding.brandName : "枕水江南"}
            storageScope={activeTaskId}
            dataStatus={takeawayDataStatus}
            busy={busy || claimingTrial}
            latestResult={latestTakeawayAssistant ? { id: latestTakeawayAssistant.id, content: latestTakeawayAssistant.content, deliveryStatus: latestTakeawayAssistant.deliveryStatus } : null}
            latestResultContent={latestTakeawayAssistant ? <StructuredAnswerBody content={latestTakeawayAssistant.content} compact /> : undefined}
            conversationMessages={messages.map((message) => ({ id: message.id, role: message.role, content: message.content, rendered: message.role === "assistant" ? <StructuredAnswerBody content={message.content} compact /> : undefined }))}
            mapEntry={takeawayMapEntry}
            onOpenImport={() => setTakeawayOpenImportSignal((value) => value + 1)}
            onRun={(capabilityId, prompt, display) => void send(prompt, display, capabilityId)}
            onOpenTaskMap={() => {
              setTakeawayMapEntry(null);
              setWorkMapOpen(true);
            }}
            onOpenCapability={(capabilityId) => {
              setTakeawayMapEntry({ capabilityId, requestId: Date.now() });
              setSelected(capabilityId);
              setSelectedSkillIds([capabilityId]);
            }}
            importSlot={takeawayMapEntry.capabilityId === "takeaway_data_foundation" ? <TakeawayGrowthDataPanel
              headers={authHeaders()}
              variant="import-only"
              inputId="takeaway-task-import-input"
              onDashboardChange={setTakeawayDataStatus}
              onStartDiagnosis={() => {
                setSelected("takeaway_data_foundation");
                setSelectedSkillIds(["takeaway_data_foundation"]);
              }}
            /> : null}
          />
        </div>
      </section>}
      {agent.knowledgeAction?.enabled && <RecordingKnowledgeDrawer
        open={knowledgeDrawerOpen}
        agent={agent}
        tenantRole={tenantRole}
        selectedIds={activeKnowledgeDocumentIds}
        selectedSubjectId={activeKnowledgeSubjectId}
        busy={busy}
        actionLabel={knowledgeDrawerAction.label}
        actionPlaceholder={knowledgeDrawerAction.placeholder}
        onClose={() => setKnowledgeDrawerOpen(false)}
        onSelectionChange={setActiveKnowledgeDocumentIds}
        onSubjectChange={setActiveKnowledgeSubjectId}
        onRun={(extraInstruction, knowledgeSubjectId) => {
          const text = extraInstruction.trim() || `请${knowledgeDrawerAction.label}。`;
          const display = `${knowledgeDrawerAction.label}（${activeKnowledgeDocumentIds.length} 条资料）${extraInstruction.trim() ? `\n补充要求：${extraInstruction.trim()}` : ""}`;
          setKnowledgeDrawerOpen(false);
          // The subject selector updates parent state asynchronously. Pass the
          // drawer's current value explicitly so a just-selected customer
          // project cannot fall back to the previous/default subject.
          void send(text, display, knowledgeDrawerAction.capabilityId, activeKnowledgeDocumentIds, knowledgeSubjectId);
        }}
      />}
      {automationAction?.enabled && <AgentAutomationDrawer
        open={automationDrawerOpen}
        agent={{ id: agent.id, slug: agent.slug, name: displayedAgentName }}
        action={automationAction}
        onClose={() => setAutomationDrawerOpen(false)}
      />}
    </div>
  );
}

function CustomerSubjectPicker({
  open,
  subjects,
  selectedSubjectId,
  onClose,
  onSelect,
  onEditProfile,
  onCreate
}: {
  open: boolean;
  subjects: KnowledgeSubjectView[];
  selectedSubjectId?: string;
  onClose: () => void;
  onSelect: (subjectId: string) => void;
  onEditProfile: () => void;
  onCreate: () => void;
}) {
  if (!open) return null;
  const customerSubjects = subjects.filter((subject) => subject.subjectType !== "enterprise");
  return <div className="knowledgeDrawerLayer customerSubjectPickerLayer" role="dialog" aria-modal="true" aria-label="选择已有客户">
    <button className="knowledgeDrawerBackdrop" aria-label="关闭客户选择" onClick={onClose} />
    <section className="customerSubjectPicker">
      <header><div><span>当前任务 · 客户资料</span><h2>选择已有客户</h2><p>选择后，任务会绑定这个客户项目；已归属并确认的资料会按权限自动调用。</p></div><button type="button" aria-label="关闭" onClick={onClose}>×</button></header>
      <div className="customerSubjectPickerList">
        {customerSubjects.length ? customerSubjects.map((subject) => <button
          type="button"
          key={subject.id}
          className={selectedSubjectId === subject.id ? "active" : ""}
          onClick={() => onSelect(subject.id)}
        ><span>{subject.subjectType === "client_project" ? "客" : subject.subjectType === "brand" ? "品" : "IP"}</span><div><strong>{subject.name}</strong><small>{subject.typeLabel ?? "客户项目"}{subject.industry ? ` · ${subject.industry}` : ""}</small><em>自动 {subject.autoDocumentCount ?? 0} · 推荐 {subject.recommendedDocumentCount ?? 0} · 共 {subject.documentCount ?? 0} 条</em></div>{selectedSubjectId === subject.id ? <b>当前</b> : null}</button>) : <div className="customerSubjectPickerEmpty"><strong>还没有客户项目</strong><p>先新建一个客户，再把录音、文档和运营资料归入该客户。</p></div>}
      </div>
      <footer><button type="button" onClick={onEditProfile}>只补充本任务客户信息</button><button type="button" className="primaryButton" onClick={onCreate}>＋ 新增客户</button></footer>
    </section>
  </div>;
}

function TaskCustomerProfileDrawer({
  open,
  profile,
  onClose,
  onSave
}: {
  open: boolean;
  profile?: TaskCustomerProfile;
  onClose: () => void;
  onSave: (profile: TaskCustomerProfile) => void;
}) {
  const [draft, setDraft] = useState<TaskCustomerProfile>({});
  useEffect(() => {
    if (open) setDraft(profile ?? {});
  }, [open, profile]);
  if (!open) return null;
  const update = (field: keyof TaskCustomerProfile, value: string) => setDraft((current) => ({ ...current, [field]: value }));
  const save = () => onSave(Object.fromEntries(
    Object.entries(draft).flatMap(([key, value]) => typeof value === "string" && value.trim() ? [[key, value.trim().slice(0, 500)]] : [])
  ) as TaskCustomerProfile);
  return <div className="knowledgeDrawerLayer" role="dialog" aria-modal="true" aria-label="当前客户资料">
    <button className="knowledgeDrawerBackdrop" aria-label="关闭客户资料" onClick={onClose} />
    <aside className="recordingKnowledgeDrawer taskCustomerProfileDrawer">
      <header><div><span>当前任务 · 客户事实</span><h2>客户资料卡</h2><p>只服务当前任务。多个技能共享这组事实，不会覆盖思潼自己的企业资料。</p></div><button type="button" aria-label="关闭客户资料" onClick={onClose}>×</button></header>
      <form onSubmit={(event) => { event.preventDefault(); save(); }}>
        <label>客户 / 品牌名称<input value={draft.name ?? ""} onChange={(event) => update("name", event.target.value)} placeholder="例如：枕水江南" /></label>
        <label>行业<input value={draft.industry ?? ""} onChange={(event) => update("industry", event.target.value)} placeholder="例如：中式快餐外卖连锁" /></label>
        <label>目标客户<input value={draft.targetCustomer ?? ""} onChange={(event) => update("targetCustomer", event.target.value)} placeholder="例如：沈阳25—45岁家庭聚餐和夜宵顾客" /></label>
        <div className="taskCustomerProfileRow"><label>城市<input value={draft.city ?? ""} onChange={(event) => update("city", event.target.value)} placeholder="例如：沈阳" /></label><label>门店规模<input value={draft.storeScale ?? ""} onChange={(event) => update("storeScale", event.target.value)} placeholder="例如：7家外卖店" /></label></div>
        <label>当前经营问题<textarea rows={3} value={draft.currentProblem ?? ""} onChange={(event) => update("currentProblem", event.target.value)} placeholder="例如：新店外卖销售额低，需要提升订单" /></label>
        <label>本次增长目标<textarea rows={2} value={draft.growthGoal ?? ""} onChange={(event) => update("growthGoal", event.target.value)} placeholder="例如：提升美团、饿了么、淘宝闪购订单" /></label>
        <label>主要平台<input value={draft.platforms ?? ""} onChange={(event) => update("platforms", event.target.value)} placeholder="例如：美团、饿了么、淘宝闪购、抖音" /></label>
        <div className="taskCustomerProfileActions"><button type="button" className="ghostButton" onClick={onClose}>取消</button><button type="submit" className="primaryButton">保存到当前任务</button></div>
      </form>
    </aside>
  </div>;
}

interface KnowledgeConnectionView {
  id: string;
  provider: string;
  label: string;
  status: string;
  lastSyncedAt?: string;
}

interface KnowledgeDocumentView {
  id: string;
  title: string;
  preview: string;
  characterCount: number;
  documentType: string;
  occurredAt?: string;
  knowledgeLayer?: string;
  usagePolicy?: "auto" | "recommend" | "manual";
  sensitivity?: "normal" | "internal" | "sensitive";
  confirmed?: boolean;
  subjectIds?: string[];
}

function RecordingKnowledgeDrawer({
  open,
  agent,
  tenantRole,
  selectedIds,
  selectedSubjectId,
  busy,
  actionLabel,
  actionPlaceholder,
  onClose,
  onSelectionChange,
  onSubjectChange,
  onRun
}: {
  open: boolean;
  agent: AgentView;
  tenantRole: "owner" | "admin" | "member";
  selectedIds: string[];
  selectedSubjectId?: string;
  busy: boolean;
  actionLabel: string;
  actionPlaceholder?: string;
  onClose: () => void;
  onSelectionChange: (ids: string[]) => void;
  onSubjectChange: (subjectId: string) => void;
  onRun: (extraInstruction: string, selectedSubjectId: string) => void;
}) {
  const [connections, setConnections] = useState<KnowledgeConnectionView[]>([]);
  const [documents, setDocuments] = useState<KnowledgeDocumentView[]>([]);
  const [subjects, setSubjects] = useState<KnowledgeSubjectView[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [type, setType] = useState<"transcript" | "all">("transcript");
  const [query, setQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [apiKey, setApiKey] = useState("");
  const [clientId, setClientId] = useState("");
  const [extraInstruction, setExtraInstruction] = useState("");
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const getNoteConnection = connections.find((item) => item.provider === "getnote");
  const selectedSubject = subjects.find((item) => item.id === selectedSubjectId);
  const automaticKnowledgeCount = selectedSubject?.autoDocumentCount ?? 0;
  const canManageConnection = tenantRole === "owner" || tenantRole === "admin";
  const allowedTypes = agent.knowledgeAction?.allowedDocumentTypes ?? [];
  const extraInstructionPlaceholder = actionPlaceholder ?? (agent.slug === "acquisition"
    ? "例如：只提炼适合承接加盟、IP或企业服务的选题，先不写完整文案。"
    : agent.slug === "sales"
      ? "例如：只复盘最近的客户洽谈，重点指出没有推进到下一步的地方。"
      : "例如：只分析最近的资料，优先给出下一步行动建议。");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void Promise.all([
      fetch(apiPath("/knowledge-base/connections"), { headers: authHeaders() }).then((response) => readJson<{ connections: KnowledgeConnectionView[] }>(response)),
      fetch(apiPath("/knowledge-base/subjects"), { headers: authHeaders() }).then((response) => readJson<{ subjects: KnowledgeSubjectView[] }>(response))
    ])
      .then(([connectionPayload, subjectPayload]) => {
        if (cancelled) return;
        setConnections(connectionPayload.connections);
        setSubjects(subjectPayload.subjects);
        if (!selectedSubjectId) {
          const defaultSubjectId = subjectPayload.subjects.find((item) => item.isDefault)?.id ?? subjectPayload.subjects[0]?.id;
          if (defaultSubjectId) onSubjectChange(defaultSubjectId);
        }
      })
      .catch((reason) => { if (!cancelled) setError(customerErrorMessage(reason, "知识来源读取失败。")); });
    return () => { cancelled = true; };
  }, [open, selectedSubjectId]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      const params = new URLSearchParams({ type, page: String(page), limit: "50" });
      if (query.trim()) params.set("q", query.trim());
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      void fetch(apiPath(`/knowledge-base/documents?${params.toString()}`), { headers: authHeaders(), signal: controller.signal })
        .then((response) => readJson<{ documents: KnowledgeDocumentView[]; pagination: { total: number; hasMore: boolean } }>(response))
        .then((payload) => {
          const compatible = allowedTypes.length ? payload.documents.filter((document) => allowedTypes.includes(document.documentType)) : payload.documents;
          setDocuments(compatible);
          setTotal(payload.pagination.total);
          setHasMore(payload.pagination.hasMore);
          setError("");
        })
        .catch((reason) => { if ((reason as { name?: string }).name !== "AbortError") setError(customerErrorMessage(reason, "录音资料读取失败。")); })
        .finally(() => setLoading(false));
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [allowedTypes.join("|"), dateFrom, dateTo, open, page, query, type]);

  async function connectAndSync(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!canManageConnection) return;
    setConnecting(true); setError(""); setNotice("正在验证得到大脑授权…");
    try {
      const connected = await fetch(apiPath("/knowledge-base/connections/getnote"), {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey, clientId, label: "得到大脑" })
      }).then((response) => readJson<{ connection: KnowledgeConnectionView }>(response));
      setApiKey(""); setClientId("");
      setConnections([connected.connection]);
      setNotice("授权成功，正在同步已转写的文字…");
      await syncConnection(connected.connection.id);
    } catch (reason) {
      setError(customerErrorMessage(reason, "得到大脑连接失败，请检查授权信息。"));
      setNotice("");
    } finally {
      setConnecting(false);
    }
  }

  async function syncConnection(connectionId = getNoteConnection?.id): Promise<void> {
    if (!connectionId) return;
    setSyncing(true); setError(""); setNotice("正在同步最新录音文字…");
    try {
      const payload = await fetch(apiPath(`/knowledge-base/connections/${connectionId}/sync`), { method: "POST", headers: authHeaders() })
        .then((response) => readJson<{ sync: { created: number; updated: number; skipped: number } }>(response));
      setNotice(`同步完成：新增 ${payload.sync.created} 条，更新 ${payload.sync.updated} 条，跳过 ${payload.sync.skipped} 条。`);
      setPage(1);
      const params = new URLSearchParams({ type, page: "1", limit: "50" });
      const refreshed = await fetch(apiPath(`/knowledge-base/documents?${params.toString()}`), { headers: authHeaders() })
        .then((response) => readJson<{ documents: KnowledgeDocumentView[]; pagination: { total: number; hasMore: boolean } }>(response));
      setDocuments(refreshed.documents.filter((document) => !allowedTypes.length || allowedTypes.includes(document.documentType)));
      setTotal(refreshed.pagination.total); setHasMore(refreshed.pagination.hasMore);
    } catch (reason) {
      setError(customerErrorMessage(reason, "同步失败，请稍后重试。")); setNotice("");
    } finally {
      setSyncing(false);
    }
  }

  function toggleDocument(documentId: string, checked: boolean): void {
    if (checked && selectedIds.length >= 100) { setError("每次最多选择100条资料。"); return; }
    onSelectionChange(checked ? [...selectedIds, documentId] : selectedIds.filter((id) => id !== documentId));
    setError("");
  }

  function selectRecentDays(days: number): void {
    const start = new Date();
    start.setDate(start.getDate() - days + 1);
    setDateFrom(toDateInputValue(start));
    setDateTo(toDateInputValue(new Date()));
    setPage(1);
  }

  if (!open) return null;
  return <div className="knowledgeDrawerLayer" role="dialog" aria-modal="true" aria-label="经营资料库">
    <button className="knowledgeDrawerBackdrop" aria-label="关闭经营资料库" onClick={onClose} />
    <aside className="recordingKnowledgeDrawer">
      <header><div><span>企业经营事实</span><h2>经营资料库</h2><p>选择资料后，当前{customerAgentName(agent.name)}会在本任务中持续参考。</p></div><button aria-label="关闭" onClick={onClose}>×</button></header>
      {!getNoteConnection ? <section className="knowledgeQuickConnect">
        {canManageConnection ? <form onSubmit={(event) => void connectAndSync(event)}>
          <strong>首次连接得到大脑</strong><p>只读取已经转写好的文字，凭证加密保存。</p>
          <label>API Key<input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} required /></label>
          <label>Client ID<input value={clientId} onChange={(event) => setClientId(event.target.value)} required /></label>
          <button disabled={connecting}>{connecting ? "连接中…" : "验证、连接并同步"}</button>
        </form> : <div><strong>还没有连接得到大脑</strong><p>请联系企业所有者或管理员完成连接。普通成员不会看到或修改API凭证。</p></div>}
      </section> : <>
        <section className="knowledgeDrawerSubject">
          <label>本次服务谁<select value={selectedSubjectId ?? ""} onChange={(event) => onSubjectChange(event.target.value)}>{subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.typeLabel ?? "主体"}｜{subject.name}{subject.industry ? `｜${subject.industry}` : ""}</option>)}</select></label>
          <div><strong>{selectedSubject?.name ?? "请先选择主体"}</strong><span>已确认自动调用 {automaticKnowledgeCount} 条</span><small>推荐与原始资料仍由你勾选；敏感资料不会自动调用。</small></div>
          <button type="button" onClick={() => navigate("/knowledge-base")}>管理主体与资料归属</button>
        </section>
        <section className="knowledgeDrawerToolbar">
          <div className="knowledgeTypeTabs"><button className={type === "transcript" ? "active" : ""} onClick={() => { setType("transcript"); setPage(1); }}>录音转写</button><button className={type === "all" ? "active" : ""} onClick={() => { setType("all"); setPage(1); }}>全部资料</button></div>
          <button className="knowledgeSyncButton" disabled={syncing || !canManageConnection} onClick={() => void syncConnection()}>{syncing ? "同步中…" : canManageConnection ? "同步最新资料" : "管理员可同步"}</button>
          <input className="knowledgeSearchInput" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="搜索标题或内容" />
          <div className="knowledgeDateFilters"><button onClick={() => selectRecentDays(7)}>最近7天</button><button onClick={() => selectRecentDays(30)}>最近30天</button><label>从<input type="date" value={dateFrom} onChange={(event) => { setDateFrom(event.target.value); setPage(1); }} /></label><label>到<input type="date" value={dateTo} onChange={(event) => { setDateTo(event.target.value); setPage(1); }} /></label><button onClick={() => { setDateFrom(""); setDateTo(""); setPage(1); }}>清除</button></div>
        </section>
        <section className="knowledgeDrawerSelectionBar"><span>自动调用 <strong>{automaticKnowledgeCount}</strong> 条 · 手动已选 <strong>{selectedIds.length}</strong>/100</span>{selectedIds.length > 0 && <button onClick={() => onSelectionChange([])}>清空手动选择</button>}</section>
        <section className="knowledgeDrawerDocuments">
          {loading ? <p className="knowledgeDrawerState">正在读取资料…</p> : documents.length ? documents.map((document) => {
            const belongsToSubject = Boolean(selectedSubjectId && document.subjectIds?.includes(selectedSubjectId));
            const autoIncluded = belongsToSubject && document.usagePolicy === "auto" && document.confirmed && document.sensitivity !== "sensitive";
            const belongsElsewhere = Boolean(document.subjectIds?.length && !belongsToSubject);
            return <label key={document.id} className={`${selectedIds.includes(document.id) ? "selected" : ""} ${autoIncluded ? "autoIncluded" : ""} ${belongsElsewhere ? "belongsElsewhere" : ""}`}><input type="checkbox" disabled={autoIncluded || belongsElsewhere} checked={selectedIds.includes(document.id) || autoIncluded} onChange={(event) => toggleDocument(document.id, event.target.checked)} /><div><strong>{document.title}</strong><small>{document.occurredAt ? new Date(document.occurredAt).toLocaleDateString("zh-CN") : "日期未知"} · {document.characterCount.toLocaleString()} 字 · {autoIncluded ? "已确认·自动调用" : belongsElsewhere ? "属于其他主体" : document.sensitivity === "sensitive" ? "敏感资料·手动授权" : "相关推荐·可手动选择"}</small><p>{document.preview}</p></div></label>;
          }) : <p className="knowledgeDrawerState">当前筛选下没有资料，可以先同步或切换筛选条件。</p>}
        </section>
        <div className="knowledgeDrawerPagination"><button disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>上一页</button><span>第 {page} 页</span><button disabled={!hasMore} onClick={() => setPage((value) => value + 1)}>下一页</button></div>
        <section className="knowledgeDrawerRun"><label>补充要求（可选）<textarea rows={3} value={extraInstruction} onChange={(event) => setExtraInstruction(event.target.value)} placeholder={extraInstructionPlaceholder} /></label><button disabled={(!selectedIds.length && !automaticKnowledgeCount) || !selectedSubjectId || busy} onClick={() => selectedSubjectId && onRun(extraInstruction, selectedSubjectId)}>{busy ? "智能体执行中…" : actionLabel}</button></section>
      </>}
      {notice && <p className="knowledgeDrawerNotice">{notice}</p>}{error && <p className="knowledgeDrawerError">{error}</p>}
    </aside>
  </div>;
}

function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function capabilityPromptExample(capabilityId: string): string {
  const examples: Record<string, string> = {
    daily_push: "请读取当前经营资料，先核对主体、周期、口径、来源和更新时间，再给我今日老板简报：老板先看、经营信号灯、待老板决策、行动令草案、证据与缺口和下次回流。没有真实数据不要生成假指标。",
    business_map: "请把当前资料按业务、门店或项目整理成经营地图，下钻最重要的异常，并明确区分已确认事实、分析假设和待补数据。",
    decision_center: "请根据已确认的经营结论，列出最多三项需要老板拍板的事项，比较方案、证据、收益和风险；未经我批准不要写成已经下令。",
    command_center: "请把我已经批准的决策转成行动令草案，写清责任角色、截止时间、交付物、验收标准、回传证据和复盘时间。",
    restaurant_diagnosis: "请根据我提供的餐饮业务情况，先判断属于外卖订单、堂食到店、连锁门店还是招商加盟，再区分已确认事实、分析假设和待补信息，给出主要卡点与本周优先动作。",
    takeaway_data_foundation: "上传经营数据后立即检查数据是否可用，说明已读到什么、当前可判断范围、还缺什么数据和下一步；核对重复、冲突和关键缺失，不做业绩归因或生成增长方案。",
    takeaway_growth: "进入即输出一份完整AI经营诊断：全面扫描真实外卖经营数据、输出跨维度关联、详细问题清单和完整原因地图。优先候选必须由至少两个可复核维度交叉支持；单日低谷或单品成本高只能作为线索，不能单独包装成增长根因。另行突出最多3个优先验证候选，但不要因此隐藏其他原因。本轮只选择1个原因进入问题验证。",
    takeaway_problem_validation: "请从AI经营诊断的优先候选中选择1个原因做问题验证。写清支持证据、反证、唯一验证变量、保持不变项、成立与不成立标准；不要提前生成增长方案。",
    mature_store_growth: "请为这家成熟外卖门店做老店增长诊断。门店名称、平台、分析周期、当前有效完成单和目标：【请填写】。请用本店历史基线和可比兄弟门店找出最大瓶颈，并生成一个待审批的单变量增量实验。",
    new_store_breakthrough: "请为这家新外卖门店制定业绩突破计划。门店名称、开业日、平台上线日、商圈、配送半径和首月目标：【请填写】。请从可比成熟门店提取可复制经验，输出7天、14天、30天计划和第一轮实验。",
    takeaway_data_audit: "请审计这家店的外卖数据。门店：【请填写】；平台：【美团/饿了么/淘宝闪购】；周期：【请填写】。请核对有效完成单、实付、补贴、退款、新老客、活动投放字段和逐单/日报差异，缺失项给最小补数清单。",
    takeaway_menu_profit: "请诊断外卖菜单货盘与利润。门店/平台：【请填写】；现有成本口径：【请填写】；利润底线：【请填写】。请区分菜品毛利和贡献毛利，所有改价、套餐或上下架建议先生成待审批草案。",
    takeaway_campaign_roi: "请诊断外卖活动成本和投放。门店/平台/周期：【请填写】。有计划级预算、消耗、曝光、点击、进店、下单和成交额时核对ROI；只有商家活动成本汇总时只做成本诊断，不得冒充广告消耗。",
    takeaway_competitor_loss: "请分析平台测算的流失品类与竞对品牌。门店/平台/周期：【请填写】。请区分订单流失和GMV流失，给出可验证原因与防守实验，不要把平台测算写成真实顾客去向。",
    takeaway_experiment: "请只针对已经验证成立的问题，制定7至14天增长落地方案，写清唯一增长动作、保持不变项、基线、目标、逐日执行、利润和履约护栏、止损、负责人、审批人和复盘日。",
    takeaway_execution: "请展示已审批的增长落地方案和每日执行回填。不得替门店标记完成；改价、投放、上下架和预算变更必须由人工确认。",
    takeaway_effect_evaluation: "请比较同门店、同平台、同星期、同口径的基线期与执行期，排除退款、动作日、停业、缺货、节假日和并发活动，判断增长、无增长、负增长或证据不足，并检查利润和履约副作用。",
    takeaway_review: "请复盘本轮外卖增长实验。门店/平台：【请填写】；基线期/排除日/测试期：【请填写】。请比较有效完成单、实付、客单、贡献毛利、退款、评分、履约和复购，判断假设是否被支持并给继续、调整或停止决定；单次有效只标记为候选经验。",
    dine_in_growth: "请帮我诊断堂食到店增长。品牌/门店：【请填写】；城市/商圈：【请填写】；主推消费场景：【请填写】；当前问题：【请填写】。请拆解曝光、咨询、实际到店、消费和复购漏斗。",
    chain_store_growth: "请为【餐饮连锁品牌】设计门店增长方案。门店数量和城市：【请填写】；经营模型：【请填写】；当前问题：【请填写】。请先统一数据口径，再给样板店试点、总部动作和复制机制。",
    ip_positioning: "请基于当前企业知识库中已确认的资料，为我生成一份完整IP定位方案：明确项目定位、目标用户、IP人设、内容定位、方向规划、增长路径和执行建议；没有事实依据的内容标记【待确认】，不要虚构。",
    topic_inspiration: "点击选题系统后，系统会自动扫描AI录音卡、行业与用户热点、自身账号数据复盘、同行与对标内容，再通过目标用户兴趣证据、共识层级与客资精准度、账号阶段配比三关筛选，直接给出10条可测试选题。",
    industry_hotspots: "请联网分析当前企业所属行业的近期机会，给我3个今天能用的获客选题，并把最值得拍的1个写成完整逐字稿。如需切换行业，直接补充“行业：具体行业”。",
    content_plan: "帮我写一套短视频文案，包含选题、口播、拍摄脚本、发布标题和评论区承接。",
    paid_traffic: "请帮我制定一轮小额投流测试。平台：【抖音/视频号/小红书/其他】；业务目标：【私信/留资/到店/成交】；可承接地域：【请填写】；待投素材与自然数据：【请填写或上传】；预算上限：【请填写】。请先判断是否适合投，再给素材A/B、预算节奏、监控指标、止损条件和复盘时间；当前只给建议，不要声称已经操作广告账户。",
    franchise_acquisition: "我需要给【自己的项目/客户项目】做招商短视频。品牌或项目：【请填写】；行业或品类：【请填写】；目标加盟商：【按真实情况写身份/经验、是否本人经营、预算、区域、标准化接受度；例如：有餐饮经验、愿意全职经营、预算10万元以内、计划在沈阳开店、接受统一供应链与培训的夫妻创业者或餐饮店老板】；示例仅供参考，不作为项目事实。请按SCALE逻辑先输出一条招商短视频方案。",
    shooting_editing: "根据我上传的视频，给出镜头结构、剪辑节奏和发布前修改建议。",
    video_review: "读取我上传的视频后台数据文件，逐条复盘作品表现，找出数据问题，并给出未来优化的选题方向。",
    live_script: "给我写一套直播开场、留人、互动、转化和下播后私聊跟进话术。",
    private_domain: "根据我的业务写3条朋友圈，并配好客户回复后的私聊承接话术。",
    customer_diagnosis: "请粘贴客户聊天、录音转写或团队讨论。我会按当时做法、存在问题、影响成交原因、下次具体说法和当前补救动作复盘。",
    intent_temperature: "请告诉我客户已经做过哪些动作、主动问过什么，以及预算、决策人和下一步是否确认。我会判断水温区间和跟进优先级。",
    objection_reply: "请粘贴客户的真实异议，并说明是消费者购买还是企业合作、当前到了哪一步、有哪些真实政策。我会给可直接复制的回复。",
    follow_up_plan: "请告诉我上次沟通时间、客户最后回复、决策人和下一次会议是否确认。我会给带时间、负责人、目标和停止条件的跟单计划。",
    closing_script: "请告诉我客户已经认可什么、当前真实顾虑、预算和决策人是否确认。我会给不施压的成交推进话术。",
    funnel_review: "请提供同一时间范围内各阶段数量，例如线索、建联、有效沟通、方案、成交；没有历史数据或金额成本可以直接说明。"
  };
  return examples[capabilityId] ?? "请描述当前任务、已知事实和想要的输出；已有企业资料不需要重复填写。";
}

interface CeoActionOrderView {
  id: string;
  status: string;
  confirmationStatus: string;
  createdAt: string;
  runAt: string;
  payload: {
    title?: string;
    rationale?: string;
    ownerRole?: string;
    dueAt?: string;
    deliverable?: string;
    acceptanceCriteria?: string;
    reviewAt?: string;
    approvalNote?: string;
    feedbackNote?: string;
  };
}

function CeoHeroVisual() {
  return <div className="ceoHeroVisual" role="img" aria-label="CEO经营驾驶舱推看决令经营雷达图">
    <svg viewBox="0 0 420 168" aria-hidden="true">
      <defs>
        <linearGradient id="ceoRadarGlow" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#8ce0bc" /><stop offset="0.48" stopColor="#2f8d70" /><stop offset="1" stopColor="#123e35" /></linearGradient>
        <radialGradient id="ceoRadarCore"><stop offset="0" stopColor="#f7fffb" /><stop offset="0.42" stopColor="#d9f5e8" /><stop offset="1" stopColor="#8bcbb3" /></radialGradient>
        <filter id="ceoSoftGlow"><feGaussianBlur stdDeviation="4" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
      </defs>
      <ellipse cx="210" cy="84" rx="180" ry="66" className="radarOuter" />
      <ellipse cx="210" cy="84" rx="132" ry="48" className="radarMiddle" />
      <ellipse cx="210" cy="84" rx="80" ry="30" className="radarInner" />
      <path d="M30 84H390M210 18V150M82 37L338 131M82 131L338 37" className="radarAxis" />
      <path d="M74 55C130 16 289 16 346 56" className="radarSweep" />
      <circle cx="210" cy="84" r="35" fill="url(#ceoRadarCore)" className="radarCore" />
      <circle cx="210" cy="84" r="46" className="radarCoreRing" />
      <text x="210" y="80" textAnchor="middle" className="radarCeo">CEO</text>
      <text x="210" y="96" textAnchor="middle" className="radarOs">经营中枢</text>
      <g className="radarNode"><circle cx="72" cy="48" r="16" /><text x="72" y="53" textAnchor="middle">推</text></g>
      <g className="radarNode"><circle cx="348" cy="48" r="16" /><text x="348" y="53" textAnchor="middle">看</text></g>
      <g className="radarNode"><circle cx="348" cy="120" r="16" /><text x="348" y="125" textAnchor="middle">决</text></g>
      <g className="radarNode"><circle cx="72" cy="120" r="16" /><text x="72" y="125" textAnchor="middle">令</text></g>
      <circle cx="304" cy="33" r="4" className="radarPulse" /><circle cx="116" cy="136" r="3" className="radarPulse delay" />
    </svg>
    <div className="ceoHeroStatus"><span><i />AI经营中枢在线</span><em>证据驱动 · 老板审批 · 执行回流</em></div>
  </div>;
}

interface CeoDashboardView {
  dataStatus: {
    knowledgeCount: number;
    latestKnowledgeAt?: string | null;
    latestAnalysisAt?: string | null;
  };
  orders: CeoActionOrderView[];
}

function CeoCommandPanel() {
  const [dashboard, setDashboard] = useState<CeoDashboardView | null>(null);
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [draftOpen, setDraftOpen] = useState(false);
  const [draft, setDraft] = useState({ title: "", ownerRole: "", dueAt: "", deliverable: "", acceptanceCriteria: "" });

  async function loadDashboard(): Promise<void> {
    setError("");
    try {
      const response = await fetch(apiPath("/agents/ceo-cockpit/dashboard"), { headers: authHeaders() });
      setDashboard(await readJson<CeoDashboardView>(response));
    } catch (reason) {
      setError(customerErrorMessage(reason, "驾驶舱状态暂时无法读取，请稍后重试。"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadDashboard(); }, []);

  async function createOrder(): Promise<void> {
    if (draft.title.trim().length < 2) {
      setError("请先填写行动令标题。");
      return;
    }
    setWorkingId("create");
    setError("");
    try {
      const payload = {
        title: draft.title.trim(),
        ownerRole: draft.ownerRole.trim() || undefined,
        dueAt: draft.dueAt ? new Date(draft.dueAt).toISOString() : undefined,
        deliverable: draft.deliverable.trim() || undefined,
        acceptanceCriteria: draft.acceptanceCriteria.trim() || undefined
      };
      const response = await fetch(apiPath("/agents/ceo-cockpit/orders"), {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      await readJson(response);
      setDraft({ title: "", ownerRole: "", dueAt: "", deliverable: "", acceptanceCriteria: "" });
      setDraftOpen(false);
      await loadDashboard();
    } catch (reason) {
      setError(customerErrorMessage(reason, "行动令草案创建失败，请稍后重试。"));
    } finally {
      setWorkingId(null);
    }
  }

  async function updateOrder(orderId: string, action: "approve" | "reject" | "complete" | "block"): Promise<void> {
    setWorkingId(orderId);
    setError("");
    try {
      const response = await fetch(apiPath(`/agents/ceo-cockpit/orders/${orderId}`), {
        method: "PATCH",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ action })
      });
      await readJson(response);
      await loadDashboard();
    } catch (reason) {
      setError(customerErrorMessage(reason, "行动令状态更新失败，请稍后重试。"));
    } finally {
      setWorkingId(null);
    }
  }

  const orders = dashboard?.orders ?? [];
  const pendingDecisionCount = orders.filter((order) => order.confirmationStatus === "required").length;
  const executingCount = orders.filter((order) => ["pending", "blocked"].includes(order.status)).length;
  const knowledgeCount = dashboard?.dataStatus.knowledgeCount ?? 0;
  return <aside className="agentContextPanel ceoCommandPanel">
    <header className="ceoPanelHeader"><div><span>CEO COCKPIT</span><strong>老板指挥台</strong></div><button type="button" onClick={() => setDraftOpen((value) => !value)}>＋ 行动令</button></header>
    <section className="ceoSituationVisual" aria-label="经营态势图">
      <header><div><span>BUSINESS SITUATION</span><strong>经营态势图</strong></div><em>{knowledgeCount > 0 ? "数据已接入" : "等待数据"}</em></header>
      <div className="ceoSituationCanvas">
        <i className="ceoOrbit orbitOne" /><i className="ceoOrbit orbitTwo" />
        <div className="ceoSituationCore"><span>AI</span><strong>经营中枢</strong><small>{knowledgeCount > 0 ? `${knowledgeCount} 条资料` : "待接入"}</small></div>
        <div className="ceoSituationNode nodeData"><b>{knowledgeCount}</b><span>经营资料</span></div>
        <div className="ceoSituationNode nodeDecision"><b>{pendingDecisionCount}</b><span>待老板审批</span></div>
        <div className="ceoSituationNode nodeOrder"><b>{executingCount}</b><span>执行推进</span></div>
        <div className="ceoSituationNode nodeEvidence"><b>{dashboard?.dataStatus.latestAnalysisAt ? "✓" : "—"}</b><span>最近分析</span></div>
      </div>
      <footer className="ceoSituationLegend"><span><i className="live" />已确认数据</span><span><i className="pending" />等待接入</span></footer>
    </section>
    <section className="ceoLoopPanel" aria-label="推看决令">
      <div><b>推</b><span>今日简报</span><small>发现值得介入的问题</small></div>
      <div><b>看</b><span>经营地图</span><small>查看证据与异常</small></div>
      <div><b>决</b><span>{pendingDecisionCount} 项待批</span><small>批准或驳回建议</small></div>
      <div><b>令</b><span>{executingCount} 项推进</span><small>执行、验收与回流</small></div>
    </section>
    <section className="ceoDataStatus">
      <header><strong>数据就绪度</strong><button type="button" onClick={() => navigate("/knowledge-base")}>维护资料</button></header>
      {loading ? <p>正在核对经营资料…</p> : <>
        <div><span>经营资料</span><b>{knowledgeCount} 条</b></div>
        <div><span>最近更新</span><b>{formatCeoDate(dashboard?.dataStatus.latestKnowledgeAt)}</b></div>
        <div><span>最近分析</span><b>{formatCeoDate(dashboard?.dataStatus.latestAnalysisAt)}</b></div>
      </>}
      <small>仅显示已接入或人工确认的数据；未接入平台不会生成假指标。</small>
    </section>
    {draftOpen && <section className="ceoOrderDraft">
      <header><strong>新建行动令草案</strong><small>创建后仍需老板批准</small></header>
      <input value={draft.title} onChange={(event) => setDraft((value) => ({ ...value, title: event.target.value }))} placeholder="行动令标题（必填）" />
      <div><input value={draft.ownerRole} onChange={(event) => setDraft((value) => ({ ...value, ownerRole: event.target.value }))} placeholder="责任角色" /><input type="datetime-local" value={draft.dueAt} onChange={(event) => setDraft((value) => ({ ...value, dueAt: event.target.value }))} /></div>
      <textarea rows={2} value={draft.deliverable} onChange={(event) => setDraft((value) => ({ ...value, deliverable: event.target.value }))} placeholder="交付物" />
      <textarea rows={2} value={draft.acceptanceCriteria} onChange={(event) => setDraft((value) => ({ ...value, acceptanceCriteria: event.target.value }))} placeholder="验收标准" />
      <button type="button" disabled={workingId === "create"} onClick={() => void createOrder()}>{workingId === "create" ? "正在创建…" : "保存为待审批草案"}</button>
    </section>}
    <section className="ceoOrderList">
      <header><strong>行动令</strong><span>{orders.length} 条</span></header>
      {orders.length === 0 ? <div className="ceoOrderEmpty"><b>还没有行动令</b><p>先在对话中完成判断，再把老板批准的决定转成行动令。</p></div> : orders.map((order) => {
        const waiting = order.confirmationStatus === "required";
        const working = workingId === order.id;
        return <article key={order.id} className={`ceoOrderCard ${order.status}`}>
          <header><strong>{order.payload?.title || "未命名行动令"}</strong><span>{ceoOrderStatus(order)}</span></header>
          <p>{[order.payload?.ownerRole && `责任：${order.payload.ownerRole}`, order.payload?.dueAt && `截止：${formatCeoDate(order.payload.dueAt)}`].filter(Boolean).join(" · ") || "责任与截止待补"}</p>
          {order.payload?.acceptanceCriteria && <small>验收：{order.payload.acceptanceCriteria}</small>}
          <footer>{waiting ? <>
            <button type="button" disabled={working} onClick={() => void updateOrder(order.id, "approve")}>批准</button>
            <button type="button" className="secondary" disabled={working} onClick={() => void updateOrder(order.id, "reject")}>驳回</button>
          </> : order.status === "pending" || order.status === "blocked" ? <>
            <button type="button" disabled={working} onClick={() => void updateOrder(order.id, "complete")}>确认完成</button>
            {order.status !== "blocked" && <button type="button" className="secondary" disabled={working} onClick={() => void updateOrder(order.id, "block")}>标记受阻</button>}
          </> : null}</footer>
        </article>;
      })}
    </section>
    <p className="ceoPanelBoundary">当前版本为系统内行动闭环；飞书、钉钉、企微通知将在授权接入后开放。</p>
    {error && <p className="ceoPanelError">{error}</p>}
  </aside>;
}

function formatCeoDate(value?: string | null): string {
  if (!value) return "待接入";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "待确认";
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function ceoOrderStatus(order: CeoActionOrderView): string {
  if (order.confirmationStatus === "required") return "待老板审批";
  if (order.status === "pending") return "待执行";
  if (order.status === "completed") return "已完成";
  if (order.status === "blocked") return "执行受阻";
  if (order.status === "rejected") return "已驳回";
  return "草案";
}

function SmartFilesPanel({
  agent,
  messages,
  tenantProfile,
  knowledgeSubject,
  onOpenKnowledge
}: {
  agent: AgentView;
  messages: ProductMessage[];
  tenantProfile: { tenantName?: string; industry?: string; city?: string; data?: Record<string, unknown> } | null;
  knowledgeSubject?: KnowledgeSubjectView;
  onOpenKnowledge: () => void;
}) {
  const [tab, setTab] = useState<"artifacts" | "customer" | "profile">("artifacts");
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState("");
  const [selectedArtifact, setSelectedArtifact] = useState<SmartArtifactView | null>(null);
  const [customerDocuments, setCustomerDocuments] = useState<KnowledgeDocumentView[]>([]);
  const [customerDocumentsLoading, setCustomerDocumentsLoading] = useState(false);
  const artifacts = useMemo(() => buildSmartArtifacts(messages), [messages]);

  useEffect(() => {
    if (tab !== "customer" || !knowledgeSubject?.id) {
      if (!knowledgeSubject?.id) setCustomerDocuments([]);
      return;
    }
    const controller = new AbortController();
    const params = new URLSearchParams({ type: "all", subjectId: knowledgeSubject.id, page: "1", limit: "20" });
    setCustomerDocumentsLoading(true);
    void fetch(apiPath(`/knowledge-base/documents?${params.toString()}`), { headers: authHeaders(), signal: controller.signal })
      .then((response) => readJson<{ documents: KnowledgeDocumentView[] }>(response))
      .then((payload) => setCustomerDocuments(payload.documents))
      .catch((reason) => { if ((reason as { name?: string }).name !== "AbortError") setCustomerDocuments([]); })
      .finally(() => setCustomerDocumentsLoading(false));
    return () => controller.abort();
  }, [knowledgeSubject?.id, tab]);

  async function downloadArtifact(artifact: SmartArtifactView) {
    if (workingId) return;
    setWorkingId(artifact.id);
    setDownloadError("");
    try {
      const response = await fetch(apiPath("/exports/docx"), {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          title: normalizeFilenamePart(artifact.title || `${agent.name}交付方案`),
          content: artifact.content
        })
      });
      const data = await readJson<{ downloadUrl: string; filename: string }>(response);
      const anchor = document.createElement("a");
      anchor.href = apiPath(data.downloadUrl);
      anchor.download = data.filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } catch {
      setDownloadError("文件生成失败，请稍后重试。");
    } finally {
      setWorkingId(null);
    }
  }

  return (<>
    <aside className="agentContextPanel smartFilesPanel">
      <div className="smartFilesHeader">
        <div><span>SMART FILES</span><strong>智能文件</strong></div>
        <em>{artifacts.length}</em>
      </div>
      <div className="smartFilesTabs">
        <button type="button" className={tab === "artifacts" ? "active" : ""} onClick={() => setTab("artifacts")}>产物</button>
        {agent.slug === "acquisition" && <button type="button" className={tab === "customer" ? "active" : ""} onClick={() => setTab("customer")}>客户资料</button>}
        <button type="button" className={tab === "profile" ? "active" : ""} onClick={() => setTab("profile")}>企业资料</button>
      </div>
      {tab === "artifacts" ? (
        <div className="smartArtifactList">
          {artifacts.length === 0 ? (
            <div className="smartFilesEmpty"><span>◇</span><strong>产物会出现在这里</strong><p>智能体生成的方案、文案和报告可以在这里统一查看与下载。</p></div>
          ) : artifacts.map((artifact) => {
            return (
              <article className="smartArtifactCard" key={artifact.id}>
                <span>W</span>
                <div><strong>{artifact.title}</strong><small>可在线预览 · 版本 {artifact.version}</small></div>
                <button type="button" onClick={() => setSelectedArtifact(artifact)}>
                  打开
                </button>
              </article>
            );
          })}
          {downloadError && <p className="answerDownloadError">{downloadError}</p>}
        </div>
      ) : tab === "customer" ? (
        <div className="smartCustomerKnowledgeView">
          {knowledgeSubject ? <>
            <section><span>当前任务服务客户</span><h3>{knowledgeSubject.name}</h3><p>{knowledgeSubject.typeLabel ?? "客户项目"}{knowledgeSubject.industry ? ` · ${knowledgeSubject.industry}` : ""}</p><small>自动 {knowledgeSubject.autoDocumentCount ?? 0} · 推荐 {knowledgeSubject.recommendedDocumentCount ?? 0} · 共 {knowledgeSubject.documentCount ?? 0} 条资料</small></section>
            <div className="smartCustomerDocumentList">
              {customerDocumentsLoading ? <p>正在读取客户资料…</p> : customerDocuments.length ? customerDocuments.map((document) => <article key={document.id}><span>{document.documentType === "transcript" ? "录" : "文"}</span><div><strong>{document.title}</strong><small>{document.usagePolicy === "auto" && document.confirmed ? "已确认 · 自动调用" : document.usagePolicy === "recommend" ? "推荐资料 · 使用前选择" : "仅手动调用"}</small></div></article>) : <p>这个客户项目还没有归属资料。创建客户名称不会自动复制其他主体的文件，需要在资料库中把对应文件归入该客户。</p>}
            </div>
            <button type="button" className="contextEditButton" onClick={onOpenKnowledge}>查看并选择客户资料</button>
            <button type="button" className="contextSecondaryButton" onClick={() => navigate(`/knowledge-base?subjectId=${encodeURIComponent(knowledgeSubject.id)}&returnTo=${encodeURIComponent(`/agents/${agent.slug}`)}`)}>管理资料归属</button>
          </> : <div className="smartFilesEmpty"><span>客</span><strong>尚未选择客户</strong><p>点击新建任务页的“选择已有客户”，即可查看并调用该客户资料。</p></div>}
        </div>
      ) : (
        <div className="smartProfileView">
          <section><h3>已确认企业事实</h3><ContextFact label="主体" value={tenantProfile?.tenantName} /><ContextFact label="行业" value={tenantProfile?.industry} /><ContextFact label="城市" value={tenantProfile?.city} /><ContextFact label="产品" value={typeof tenantProfile?.data?.offer === "string" ? tenantProfile.data.offer : undefined} /><ContextFact label="客户" value={typeof tenantProfile?.data?.customer === "string" ? tenantProfile.data.customer : undefined} /></section>
          <LatestAnalysisContext messages={messages} />
          <button type="button" className="contextEditButton" onClick={() => navigate("/account")}>维护企业资料</button>
        </div>
      )}
    </aside>
    {selectedArtifact && <div className="smartFilePreviewBackdrop" role="presentation" onMouseDown={() => setSelectedArtifact(null)}>
      <section className="smartFilePreviewDialog" role="dialog" aria-modal="true" aria-label={`${selectedArtifact.title}预览`} onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div><span>SMART FILE PREVIEW</span><h2>{selectedArtifact.title}</h2><p>先检查完整内容，确认无误后再下载 Word。</p></div>
          <button type="button" aria-label="关闭文件预览" onClick={() => setSelectedArtifact(null)}>×</button>
        </header>
        <div className="smartFilePreviewContent"><StructuredAnswerBody content={selectedArtifact.content} /></div>
        <footer>
          <span>这是独立完整交付件，不是聊天摘要。</span>
          <button type="button" className="primaryButton" onClick={() => void downloadArtifact(selectedArtifact)} disabled={workingId === selectedArtifact.id}>
            {workingId === selectedArtifact.id ? "正在生成 Word…" : "确认无误，下载 Word"}
          </button>
        </footer>
        {downloadError && <p className="answerDownloadError smartFilePreviewError">{downloadError}</p>}
      </section>
    </div>}
  </>);
}

function ThinkingStatus({ agent, capabilityIds }: { agent: AgentView; capabilityIds: string[] }) {
  const stages = agent.slug === "sales"
    ? ["正在整理客户与销售事实", "正在区分B2C与B2B场景", "正在分析成交卡点和证据", "正在生成可复制话术与动作", "正在复核事实边界和下一步"]
    : agent.slug === "takeaway-growth"
      ? ["正在核对平台与数据口径", "正在重算有效完成单与利润", "正在定位外卖漏斗断点", "正在设计单变量增长实验", "正在复核审批与止损边界"]
    : agent.slug === "restaurant-growth"
      ? ["正在识别餐饮经营场景", "正在核对门店与平台事实", "正在拆解经营增长漏斗", "正在编排餐饮增长动作", "正在复核数据和承诺边界"]
      : ["正在整理你的目标和已知事实", "正在检查文件与数据证据", "正在调用获客专家方法分析", "正在生成可执行计划", "正在复核结论和行动建议"];
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setIndex((current) => Math.min(current + 1, stages.length - 1)), 3200);
    return () => window.clearInterval(timer);
  }, []);
  return <div className="thinkingStages"><strong>{stages[index]}</strong><span>{index + 1}/{stages.length}</span><i><b style={{ width: `${((index + 1) / stages.length) * 100}%` }} /></i>{capabilityIds.length > 1 && <div className="thinkingSkillQueue"><small>联合执行</small>{capabilityIds.map((id) => <em key={id}>{capabilityDisplayName(id)}</em>)}</div>}</div>;
}

function ContextFact({ label, value }: { label: string; value?: string }) {
  return <p className={value ? "contextFact" : "contextFact missing"}><span>{label}</span><strong>{value || "待补"}</strong></p>;
}

function LatestAnalysisContext({ messages }: { messages: ProductMessage[] }) {
  const latest = [...messages].reverse().find((message) => message.role === "assistant" && message.analysisBrief)?.analysisBrief;
  if (!latest) return <section><h3>分析提示</h3><p>上传真实资料或补充经营数据后，关键事实、判断依据和待补信息会显示在这里。</p></section>;
  return <section><h3>最近一次判断</h3>{latest.findings.slice(0, 2).map((item) => <p key={item.conclusion}>{item.conclusion}</p>)}{latest.missingInformation.length > 0 && <><h3>待补信息</h3>{latest.missingInformation.slice(0, 3).map((item) => <p className="missingItem" key={item}>{item}</p>)}</>}</section>;
}

function ExecutionStatusSummary({ execution, deliveryStatus }: { execution?: AgentExecutionView; deliveryStatus?: ProductMessage["deliveryStatus"] }) {
  if (!execution?.steps.length) return null;
  const succeeded = execution.steps.filter((step) => step.status === "success").length;
  const failed = execution.steps.filter((step) => step.status === "failed").length;
  const headline = failed > 0
    ? `部分完成：${succeeded}/${execution.steps.length} 项可用`
    : deliveryStatus === "needs_input"
      ? `已完成 ${succeeded} 项，部分内容待补充`
      : `${execution.steps.length} 项联合任务已完成`;
  return <section className={`executionStatusSummary ${failed > 0 ? "partial" : "completed"}`}>
    <header><span>执行状态</span><strong>{headline}</strong></header>
    <div>{execution.steps.map((step) => {
      const timedOut = /timed_out|timeout/i.test(step.error?.code ?? "");
      const label = step.status === "success" ? "已完成" : step.status === "needs_input" ? "待补充" : timedOut ? "已超时" : "未完成";
      return <p className={step.status} key={step.stepId}>
        <i aria-hidden="true" />
        <span>{capabilityDisplayName(step.capabilityId)}</span>
        <small>{label}{step.durationMs > 0 ? ` · ${Math.max(1, Math.round(step.durationMs / 1000))}秒` : ""}</small>
      </p>;
    })}</div>
    {failed > 0 && <em>已保留成功内容；超时或未通过的部分可单独重试。</em>}
  </section>;
}

function capabilityDisplayName(capabilityId?: string): string {
  const names: Record<string, string> = {
    industry_hotspots: "行业热点",
    topic_inspiration: "选题灵感",
    content_plan: "文案创作",
    paid_traffic: "投流系统",
    shooting_editing: "拍剪优化",
    video_review: "视频数据复盘",
    live_script: "直播话术",
    live_review: "直播数据复盘",
    franchise_acquisition: "招商加盟",
    private_domain: "朋友圈与私域",
    restaurant_diagnosis: "餐饮经营诊断",
    takeaway_data_foundation: "数据与经营阶段",
    takeaway_growth: "AI经营诊断",
    mature_store_growth: "老店增长",
    new_store_breakthrough: "新店业绩突破",
    takeaway_data_audit: "数据口径审计",
    takeaway_menu_profit: "菜单货盘与利润",
    takeaway_campaign_roi: "活动成本 / 投放诊断",
    takeaway_competitor_loss: "流失竞品诊断",
    takeaway_problem_validation: "问题验证",
    takeaway_experiment: "增长落地方案",
    takeaway_execution: "真实执行与每日回填",
    takeaway_effect_evaluation: "增长效果评估",
    takeaway_review: "周期复盘与决策",
    dine_in_growth: "堂食到店增长",
    chain_store_growth: "连锁门店增长",
    customer_diagnosis: "客户诊断",
    objection_reply: "异议回复",
    follow_up_plan: "跟进计划"
  };
  return capabilityId ? names[capabilityId] ?? capabilityId : "专项任务";
}

function AgentAnswer({ message, agentName, onAction }: { message: ProductMessage; agentName?: string; onAction: (action: string) => void }) {
  const brief = message.analysisBrief;
  const [downloadState, setDownloadState] = useState<"idle" | "working" | "done" | "error">("idle");
  const [feedbackState, setFeedbackState] = useState<"idle" | "choosing" | "working" | "helpful" | "not_helpful" | "error">("idle");
  const preview = useMemo(() => message.stableDelivery
    ? {
        title: message.stableDelivery.title,
        conclusion: message.stableDelivery.blocks.find((block) => block.type === "summary")?.content ?? message.stableDelivery.intro,
        sections: message.stableDelivery.blocks.map((block) => block.title)
      }
    : buildCompactAnswerPreview(message.content), [message.content, message.stableDelivery]);
  const longDelivery = useMemo(
    () => isLongDelivery(message.content, preview.sections.length),
    [message.content, preview.sections.length]
  );

  async function downloadWord() {
    if (downloadState === "working") return;
    setDownloadState("working");
    try {
      const response = await fetch(apiPath("/exports/docx"), {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          title: normalizeFilenamePart(preview.title || `${agentName ?? "枕水江南"}交付方案`),
          content: message.content
        })
      });
      const data = await readJson<{ downloadUrl: string; filename: string }>(response);
      const anchor = document.createElement("a");
      anchor.href = apiPath(data.downloadUrl);
      anchor.download = data.filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setDownloadState("done");
      void recordAgentOutcome(message.agentRunId, "downloaded", `download:${message.id}`);
    } catch {
      setDownloadState("error");
    }
  }

  async function sendFeedback(
    helpful: boolean,
    reasonCode?: "factual_error" | "not_relevant" | "incomplete" | "format_issue" | "tool_failure"
  ): Promise<void> {
    if (!message.agentRunId || feedbackState === "working") return;
    setFeedbackState("working");
    const saved = await submitAgentFeedback(message.agentRunId, helpful, reasonCode);
    setFeedbackState(saved ? (helpful ? "helpful" : "not_helpful") : "error");
  }

  return (
    <div className="agentAnswer">
      <div className="answerMeta">
        {(message.reasoningProfile || message.analysisMode) && <span className={(message.reasoningProfile === "deep" || (!message.reasoningProfile && message.analysisMode === "deep")) ? "analysisMode deep" : "analysisMode"}>
          {message.reasoningProfile === "deep" || (!message.reasoningProfile && message.analysisMode === "deep") ? "深度推理" : "标准推理"}
        </span>}
        {brief?.goal && <span className="answerGoal">目标：{brief.goal}</span>}
      </div>
      <ExecutionStatusSummary execution={message.execution} deliveryStatus={message.deliveryStatus} />
      {brief && (brief.confirmedFacts.length > 0 || brief.findings.length > 0 || brief.missingInformation.length > 0) && (
        <section className="analysisEvidencePanel">
          {brief.confirmedFacts.length > 0 && <div><strong>已确认事实</strong>{brief.confirmedFacts.slice(0, 6).map((item, index) => <p key={`${item.fact}-${index}`}>{item.fact}<small>{item.source}</small></p>)}</div>}
          {brief.findings.length > 0 && <div><strong>核心判断</strong>{brief.findings.slice(0, 4).map((item, index) => <p key={`${item.conclusion}-${index}`}>{item.conclusion}<small>{item.confidence === "high" ? "高置信度" : item.confidence === "medium" ? "中置信度" : "低置信度"}</small></p>)}</div>}
          {brief.missingInformation.length > 0 && <div><strong>还需补充</strong>{brief.missingInformation.slice(0, 5).map((item, index) => <p key={`${item}-${index}`}>{item}</p>)}</div>}
        </section>
      )}
      {!longDelivery && (message.stableDelivery
        ? <StableDeliveryBody delivery={message.stableDelivery} compact />
        : <StructuredAnswerBody content={message.content} compact />)}
      {longDelivery && <section className="answerDocumentToolbar">
        <div><span>本次完整交付</span><strong>{preview.title}</strong><small>{preview.sections.length ? `${preview.sections.length} 个执行模块 · 已在下方完整展开` : "已在下方完整展开"}</small></div>
        <button type="button" className="ghostButton" onClick={() => void downloadWord()} disabled={downloadState === "working"}>
          {downloadState === "working" ? "正在生成 Word…" : downloadState === "done" ? "已下载，可再次下载" : "下载 Word"}
        </button>
        {downloadState === "error" && <p className="answerDownloadError">Word 生成失败，请稍后重试。</p>}
      </section>}
      {longDelivery && (message.stableDelivery
        ? <StableDeliveryBody delivery={message.stableDelivery} document />
        : <StructuredAnswerBody content={message.content} document />)}
      {message.nextActions && message.nextActions.length > 0 && (
        <div className="answerActions"><span>继续执行</span>{message.nextActions.map((action, index) => <button type="button" key={action} onClick={() => { void recordAgentOutcome(message.agentRunId, "continued", `continue:${message.id}:${index}`); onAction(action); }}>{action}</button>)}</div>
      )}
      {message.agentRunId && <div className="answerFeedbackBar" aria-label="评价本次结果"><span>{feedbackState === "helpful" ? "已记录：有帮助" : feedbackState === "not_helpful" ? "已记录：有问题" : feedbackState === "choosing" ? "主要问题是？" : "这个结果有帮助吗？"}</span>{feedbackState === "idle" || feedbackState === "error" ? <><button type="button" onClick={() => void sendFeedback(true)}>有帮助</button><button type="button" onClick={() => setFeedbackState("choosing")}>有问题</button></> : null}{feedbackState === "choosing" && <><button type="button" onClick={() => void sendFeedback(false, "factual_error")}>事实不准</button><button type="button" onClick={() => void sendFeedback(false, "not_relevant")}>没解决问题</button><button type="button" onClick={() => void sendFeedback(false, "incomplete")}>内容不完整</button><button type="button" onClick={() => void sendFeedback(false, "format_issue")}>格式难用</button><button type="button" onClick={() => void sendFeedback(false, "tool_failure")}>执行失败</button></>}{feedbackState === "error" && <small>记录失败，可稍后重试</small>}</div>}
    </div>
  );
}

function StableDeliveryBody({
  delivery,
  compact = false,
  document = false
}: {
  delivery: StableAgentDelivery;
  compact?: boolean;
  document?: boolean;
}) {
  const isTakeawayOperatingBrief = delivery.capabilityId.startsWith("takeaway_") || ["mature_store_growth", "new_store_breakthrough"].includes(delivery.capabilityId);
  const className = document
    ? "structuredAnswer documentAnswer stableDelivery"
    : compact
      ? "structuredAnswer compact stableDelivery"
      : "structuredAnswer expandedAnswer stableDelivery";
  return (
    <article className={`${className} ${delivery.validation.status} ${isTakeawayOperatingBrief ? "takeawayOperatingBrief" : ""}`} data-capability={delivery.capabilityId}>
      <header className="structuredAnswerTitle">
        <span>{capabilityDisplayName(delivery.capabilityId)} · 稳定交付</span>
        <h2>{stripAnswerStars(delivery.title)}</h2>
      </header>
      {delivery.intro && <div className="markdownResult structuredAnswerIntro"><ReactMarkdown remarkPlugins={[remarkGfm]}>{stripAnswerStars(delivery.intro)}</ReactMarkdown></div>}
      <div className="answerSectionList">
        {delivery.blocks.map((block, index) => {
          const visual = answerSectionVisual({ title: block.title, marker: block.marker, content: block.content, tone: block.type === "summary" ? "summary" : block.type === "warning" ? "warning" : block.type === "next_steps" ? "next" : "standard" }, index);
          return (
            <section className={`answerSectionCard ${block.type} ${visual.tone}`} key={block.id}>
              <header>
                <span className="answerSectionMarker">{block.marker || String(index + 1).padStart(2, "0")}</span>
                <div className="answerSectionHeaderText"><small>{visual.label}</small><h3>{stripAnswerStars(block.title)}</h3></div>
              </header>
              <div className="markdownResult"><ReactMarkdown remarkPlugins={[remarkGfm]}>{cleanStructuredMarkdown(block.content)}</ReactMarkdown></div>
            </section>
          );
        })}
      </div>
    </article>
  );
}

function isLongDelivery(content: string, sectionCount: number): boolean {
  const compactLength = content.replace(/\s+/g, "").length;
  return compactLength >= 1_100 || sectionCount >= 6 || /完整内容执行包|SCALE招商获客逻辑|七天|第7天/.test(content);
}

interface DisplayAnswerSection {
  title: string;
  marker: string;
  content: string;
  tone: "summary" | "standard" | "warning" | "next";
}

function StructuredAnswerBody({ content, compact = false, document = false }: { content: string; compact?: boolean; document?: boolean }) {
  const safeContent = stripAnswerStars(content);
  const parsed = useMemo(() => parseDisplayAnswer(safeContent), [safeContent]);
  if (parsed.sections.length === 0) {
    return <div className="markdownResult directAnswer"><ReactMarkdown remarkPlugins={[remarkGfm]}>{safeContent}</ReactMarkdown></div>;
  }
  return (
    <div className={document ? "structuredAnswer documentAnswer" : compact ? "structuredAnswer compact" : "structuredAnswer expandedAnswer"}>
      {parsed.title && <header className="structuredAnswerTitle"><span>枕水江南交付</span><h2>{parsed.title}</h2></header>}
      {parsed.intro && <div className="markdownResult structuredAnswerIntro"><ReactMarkdown remarkPlugins={[remarkGfm]}>{parsed.intro}</ReactMarkdown></div>}
      <div className="answerSectionList">
        {parsed.sections.map((section, index) => {
          const visual = answerSectionVisual(section, index);
          const marker = displaySectionMarker(section.marker, index);
          const body = <>
            <header>
              <span className="answerSectionMarker">{marker}</span>
              <div className="answerSectionHeaderText">
                <small>{visual.label}</small>
                <h3>{section.title}</h3>
              </div>
            </header>
            <div className="markdownResult"><ReactMarkdown remarkPlugins={[remarkGfm]}>{cleanStructuredMarkdown(section.content)}</ReactMarkdown></div>
          </>;
          return document ? (
            <section className={`documentAnswerSection ${section.tone} ${visual.tone}`} key={`${section.title}-${index}`}>
              <header><span>{marker}</span><div><small>{visual.label}</small><h3>{section.title}</h3></div></header>
              <div className="markdownResult"><ReactMarkdown remarkPlugins={[remarkGfm]}>{cleanStructuredMarkdown(section.content)}</ReactMarkdown></div>
            </section>
          ) : compact ? (
            <section className={`answerSectionCard ${section.tone} ${visual.tone}`} key={`${section.title}-${index}`}>
              {body}
            </section>
          ) : (
            <details className={`answerSectionCard collapsible ${section.tone} ${visual.tone}`} key={`${section.title}-${index}`} open={section.tone === "summary"}>
              <summary>
                <span className="answerSectionMarker">{marker}</span>
                <div className="answerSectionHeaderText"><small>{visual.label}</small><h3>{section.title}</h3></div>
                <em>展开</em>
              </summary>
              <div className="markdownResult"><ReactMarkdown remarkPlugins={[remarkGfm]}>{cleanStructuredMarkdown(section.content)}</ReactMarkdown></div>
            </details>
          );
        })}
      </div>
    </div>
  );
}

function answerSectionVisual(section: DisplayAnswerSection, index: number): { tone: string; label: string } {
  const title = section.title;
  if (section.tone === "summary") return { tone: "insight", label: "先看结论" };
  if (section.tone === "warning") return { tone: "risk", label: "风险边界" };
  if (section.tone === "next") return { tone: "nextStep", label: "继续推进" };
  if (/一句话结论|这次有效吗/.test(title)) return { tone: "insight", label: "先看结论" };
  if (/问题出在哪里|为什么这么判断/.test(title)) return { tone: "strategy", label: "主要问题" };
  if (/怎么看有没有用|只看这3个数/.test(title)) return { tone: "nextStep", label: "观察结果" };
  if (/还缺什么数据|还缺什么/.test(title)) return { tone: "risk", label: "需要补充" };
  if (/这次只改什么|照着怎么做|接下来只做什么/.test(title)) return { tone: "growth", label: "照着执行" };
  if (/什么情况立即停止/.test(title)) return { tone: "risk", label: "停止条件" };
  if (/已确认事实|本次使用数据|数据事实/.test(title)) return { tone: "insight", label: "已确认事实" };
  if (/AI发现|异常/.test(title)) return { tone: "strategy", label: "异常判断" };
  if (/可能原因|待验证假设/.test(title)) return { tone: "risk", label: "待验证假设" };
  if (/下一步.*验证|怎么验证|验证方法/.test(title)) return { tone: "nextStep", label: "验证方法" };
  if (/本轮只做|唯一动作|只做一件事/.test(title)) return { tone: "growth", label: "本轮动作" };
  if (/继续.*调整.*停止|复盘标准|决策标准/.test(title)) return { tone: "insight", label: "决策标准" };
  if (/口播|逐字稿|文案|话术|朋友圈|开场|钩子/.test(title)) return { tone: "copy", label: "可直接使用" };
  if (/拍摄|镜头|分镜|剪辑|EDL|画面|素材/.test(title)) return { tone: "production", label: "制作执行" };
  if (/评论|私信|承接|留资|转化|线索/.test(title)) return { tone: "conversion", label: "转化承接" };
  if (/发布|标题|话题|时间|投流|复盘|数据/.test(title)) return { tone: "growth", label: "发布增长" };
  if (/SCALE|策略|逻辑|选题|规划|判断/.test(title)) return { tone: "strategy", label: "策略判断" };
  return { tone: index % 2 === 0 ? "standardA" : "standardB", label: "执行模块" };
}

function parseDisplayAnswer(content: string): { title: string; intro: string; sections: DisplayAnswerSection[] } {
  const lines = content.split(/\r?\n/);
  let title = "";
  const firstNonEmpty = lines.findIndex((line) => line.trim());
  if (firstNonEmpty >= 0 && !parseDisplaySectionHeading(lines[firstNonEmpty])) {
    title = cleanAnswerLine(lines[firstNonEmpty]);
    lines.splice(firstNonEmpty, 1);
  }
  const intro: string[] = [];
  const sections: DisplayAnswerSection[] = [];
  let current: DisplayAnswerSection | undefined;
  for (const rawLine of lines) {
    const heading = parseDisplaySectionHeading(rawLine);
    if (heading) {
      current = { ...heading, content: "" };
      sections.push(current);
      continue;
    }
    if (current) current.content = [current.content, rawLine].filter(Boolean).join("\n");
    else intro.push(rawLine);
  }
  return {
    title,
    intro: intro.join("\n").trim(),
    sections: sections.filter((section) => section.content.trim())
  };
}

function parseDisplaySectionHeading(line: string): Omit<DisplayAnswerSection, "content"> | undefined {
  const isMarkdownHeading = /^\s*#{1,6}\s+/.test(line);
  const cleaned = cleanAnswerLine(line);
  if (!cleaned) return undefined;
  if (cleaned === "完整内容执行包") return { title: cleaned, marker: "执行", tone: "standard" };
  if (cleaned === "短结论") return { title: "短结论", marker: "结论", tone: "summary" };
  if (/^(?:合规提醒|风险提醒|风险与边界)$/.test(cleaned)) return { title: cleaned, marker: "!", tone: "warning" };
  if (/^(?:下一步|今日动作|补齐后可升级|继续执行)$/.test(cleaned)) return { title: cleaned, marker: "→", tone: "next" };
  if (isMarkdownHeading && cleaned.length <= 48) return { title: cleaned, marker: "", tone: "standard" };
  const numbered = cleaned.match(/^([一二三四五六七八九十]+|\d+)[、.）)]\s*(.{2,32})$/);
  if (!numbered) return undefined;
  // A numbered sentence inside a section (for example "1. 流量入口变化：...")
  // is a body item, not a new top-level card. Only short, label-like text is
  // allowed to create a section card.
  if (/[：:；;。]/.test(numbered[2]) || !/结论|事实|异常|原因|验证|动作|继续|调整|停止|数据|审计|补充|问题|分析|计划|执行|复盘|建议|目标|策略|方案|风险|结果|步骤|指标|投放|菜单|利润|竞品/.test(numbered[2])) return undefined;
  return { title: numbered[2], marker: numbered[1], tone: "standard" };
}

function displaySectionMarker(marker: string, index: number): string {
  // Model-provided section numbers are unreliable when a section contains its
  // own 1/2/3 list. Use the actual display order for all numbered sections.
  if (/^(?:\d+|[一二三四五六七八九十]+)$/.test(marker)) return String(index + 1);
  return marker || String(index + 1);
}

function buildCompactAnswerPreview(content: string): { title: string; conclusion: string; directUse?: string; directUseLabel?: string; sections: string[] } {
  const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const isHeading = (line: string) => /^(?:短结论|[一二三四五六七八九十]+、|\d+[.、])/.test(cleanAnswerLine(line));
  const isDivider = (line: string) => /^(?:-{3,}|_{3,}|\*{3,})$/.test(line);
  const title = cleanAnswerLine(lines.find((line) => !isHeading(line) && !isDivider(line)) || "思潼获客交付方案");
  const conclusionIndex = lines.findIndex((line) => /^短结论/.test(line));
  const nextHeadingIndex = conclusionIndex >= 0
    ? lines.findIndex((line, index) => index > conclusionIndex && isHeading(line))
    : -1;
  const conclusionCandidates = conclusionIndex >= 0
    ? lines.slice(conclusionIndex + 1, nextHeadingIndex > conclusionIndex ? nextHeadingIndex : undefined).slice(0, 2)
    : lines.slice(1, 3);
  const conclusion = cleanAnswerLine(conclusionCandidates.join(" ") || "方案已经生成，可先看结论，也可以下载完整 Word 交付件。").slice(0, 260);
  const sections = Array.from(new Set(lines.flatMap((line) => {
    const match = line.match(/^(?:[一二三四五六七八九十]+、|\d+[.、])\s*(.{2,28})$/);
    return match?.[1] ? [cleanAnswerLine(match[1])] : [];
  })));
  const directLine = lines.find((line) => /文案类型.{0,12}短视频口播文案/.test(cleanAnswerLine(line)))
    ?? lines.find((line) => /可直接发布的朋友圈|可直接发布的文案|口播逐字稿|主播口播稿/.test(cleanAnswerLine(line)));
  const directIndex = directLine ? lines.indexOf(directLine) : -1;
  const directEndIndex = directIndex >= 0
    ? lines.findIndex((line, index) => index > directIndex && isHeading(line))
    : -1;
  const directUse = directIndex >= 0
    ? cleanAnswerLine(lines
        .slice(directIndex + 1, directEndIndex > directIndex ? directEndIndex : undefined)
        .filter((line) => !isHeading(line) && !isDivider(line))
        .filter((line) => !/^(?:[-*]\s*)?(?:目标作用|文案类型|画面建议)[：:）)]/.test(cleanAnswerLine(line)))
        .filter((line) => !/^\*{0,2}[（(].*(?:画面|镜头).*[）)]\*{0,2}$/.test(line))
        .slice(0, 4)
        .join(" ")).slice(0, 420)
    : undefined;
  const directUseLabel = directLine && /口播逐字稿|主播口播稿|短视频口播文案/.test(cleanAnswerLine(directLine))
    ? "逐字稿开头预览 · 打开查看全文"
    : directLine
      ? "文案开头预览 · 打开查看全文"
      : undefined;
  return { title, conclusion, directUse: directUse || undefined, directUseLabel, sections };
}

function cleanAnswerLine(value: string): string {
  return stripAnswerStars(value).replace(/^#{1,6}\s*/, "").replace(/^[-*]\s+/, "").trim();
}

function stripAnswerStars(value: string): string {
  return value.replace(/[＊*]/g, "");
}

function cleanStructuredMarkdown(value: string): string {
  return stripAnswerStars(formatStructuredSectionMarkdown(stripAnswerStars(value)));
}

function hasUsableTenantProfile(profile: { industry?: string; city?: string; data?: Record<string, unknown> } | null): boolean {
  const offer = typeof profile?.data?.offer === "string" ? profile.data.offer.trim() : "";
  const customer = typeof profile?.data?.customer === "string" ? profile.data.customer.trim() : "";
  return Boolean(profile?.industry?.trim() && offer && customer);
}

function tenantProfileSummary(profile: { industry?: string; city?: string; data?: Record<string, unknown> } | null): string {
  const industry = profile?.industry?.trim();
  const city = profile?.city?.trim();
  const offer = typeof profile?.data?.offer === "string" ? profile.data.offer.trim() : "";
  const customer = typeof profile?.data?.customer === "string" ? profile.data.customer.trim() : "";
  return [
    city ? `地区：${city}` : "",
    industry ? `行业：${industry}` : "",
    offer ? `产品/服务：${offer}` : "",
    customer ? `目标客户：${customer}` : ""
  ].filter(Boolean).join("；");
}

function composerCapability(capabilityId: string): AcquisitionComposerCapabilityId {
  if (capabilityId === "sales_growth_advisor") return "customer_diagnosis";
  if (capabilityId === "ip_positioning") return "ip_positioning";
  if (capabilityId === "topic_inspiration") return "topic_inspiration";
  if (capabilityId === "private_domain") return "private_domain";
  if (capabilityId === "franchise_acquisition") return "franchise_acquisition";
  if (capabilityId === "content_plan") return "content_plan";
  if (capabilityId === "paid_traffic" || capabilityId === "dou_plus_traffic") return capabilityId;
  if (capabilityId === "industry_hotspots" || capabilityId === "shooting_editing" || capabilityId === "video_review" || capabilityId === "live_script" || capabilityId === "live_review") return capabilityId;
  if (["daily_push", "business_map", "decision_center", "command_center"].includes(capabilityId)) return capabilityId as AcquisitionComposerCapabilityId;
  if (["customer_diagnosis", "intent_temperature", "objection_reply", "follow_up_plan", "closing_script", "funnel_review"].includes(capabilityId)) {
    return capabilityId as AcquisitionComposerCapabilityId;
  }
  return "content_plan";
}

function consultantForCapability(capabilityId: string): ConsultantId {
  if (["takeaway_data_foundation", "takeaway_growth", "mature_store_growth", "new_store_breakthrough", "takeaway_data_audit", "takeaway_menu_profit", "takeaway_campaign_roi", "takeaway_competitor_loss", "takeaway_problem_validation", "takeaway_experiment", "takeaway_execution", "takeaway_effect_evaluation", "takeaway_review"].includes(capabilityId)) return "takeaway-growth-advisor";
  if (["restaurant_diagnosis", "dine_in_growth", "chain_store_growth"].includes(capabilityId)) return "restaurant-growth-advisor";
  if (capabilityId === "sales_growth_advisor") return "sales_growth_advisor";
  if (capabilityId === "ip_positioning") return "ip_positioning";
  if (capabilityId === "topic_inspiration") return "baolu_topics";
  if (capabilityId === "industry_hotspots") return "ai_daily_brief";
  if (capabilityId === "paid_traffic") return "optimize_local_push_ads";
  if (capabilityId === "dou_plus_traffic") return "dou_plus_ads";
  if (capabilityId === "video_review") return "baolu_review_engine";
  if (capabilityId === "live_script") return "live_script_planner";
  if (capabilityId === "live_review") return "baolu_live_review_engine";
  if (capabilityId === "private_domain") return "moments_generator";
  if (["daily_push", "business_map", "decision_center", "command_center"].includes(capabilityId)) return "ceo-cockpit-analyst";
  if (["customer_diagnosis", "intent_temperature", "objection_reply", "follow_up_plan", "closing_script", "funnel_review"].includes(capabilityId)) return "sales_growth_advisor";
  return "baolu_content_creator";
}

export function MyAiPage() {
  const { data, error, loading } = useAgentCatalog(true);
  const tenantBranding = useTenantBranding();
  const owned = data?.agents ?? [];
  return (
    <main className="agentProductPage myAiPage">
      <nav className="agentTopbar"><button className="agentBrand whiteLabelBrand" onClick={() => navigate("/my-ai")}><TenantBrandMark branding={tenantBranding} /></button><div><span className="creditPill">{data?.creditBalance ?? 0} 企业积分</span><button className="ghostButton" onClick={() => navigate("/knowledge-base")}>企业经营资料库</button><button className="ghostButton" onClick={() => navigate("/account")}>企业账户</button></div></nav>
      <section className="myAiHero"><p className="agentKicker">思潼 AI 智能体工作台</p><h1>选择今天要进入的<br />专业工作地图</h1><p>每个智能体都有独立的业务路径、分支与复盘闭环；知识资产仍由企业统一管理。</p></section>
      {loading ? <p className="agentNotice">正在加载已开通的智能体…</p> : <AgentCardGrid agents={owned} branding={tenantBranding} />}
      {error && <p className="agentError">{error}</p>}
    </main>
  );
}

export function AccountCenterPage() {
  const { data } = useAgentCatalog(true);
  const tenantBranding = useTenantBranding();
  const [tenant, setTenant] = useState<Record<string, any> | null>(null);
  const [profile, setProfile] = useState({ industry: "", city: "", offer: "", customer: "" });
  const [status, setStatus] = useState("");
  const [brandingDraft, setBrandingDraft] = useState<TenantBrandingConfig>(tenantBranding);
  const [brandingStatus, setBrandingStatus] = useState("");
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [domainDraft, setDomainDraft] = useState("");
  const [domainStatus, setDomainStatus] = useState("");
  const [access, setAccess] = useState<Record<string, any> | null>(null);
  const [orders, setOrders] = useState<any[]>([]);
  const [workbuddy, setWorkbuddy] = useState<WorkbuddyConnectionsResponse | null>(null);
  const [workbuddyAgentId, setWorkbuddyAgentId] = useState("");
  const [workbuddyLabel, setWorkbuddyLabel] = useState("我的 WorkBuddy");
  const [workbuddyToken, setWorkbuddyToken] = useState("");
  const [workbuddyStatus, setWorkbuddyStatus] = useState("");
  useEffect(() => {
    if (!localStorage.getItem("store_os_token")) { loginFor("/account"); return; }
    void fetch(apiPath("/tenant/current"), { headers: authHeaders() })
      .then((response) => readJson<Record<string, any>>(response))
      .then((value) => {
        setTenant(value);
        setBrandingDraft(normalizeTenantBranding(value.branding));
        setDomainDraft(value.domain?.hostname ?? "");
        setProfile({
          industry: value.profile?.industry ?? "",
          city: value.profile?.city ?? "",
          offer: value.profile?.data?.offer ?? "",
          customer: value.profile?.data?.customer ?? ""
        });
      });
    void fetch(apiPath("/account/agent-access"), { headers: authHeaders() })
      .then((response) => readJson<Record<string, any>>(response))
      .then(setAccess);
    void fetch(apiPath("/billing/orders"), { headers: authHeaders() })
      .then((response) => readJson<{ orders?: any[] }>(response))
      .then((value) => setOrders(value.orders ?? []));
    void loadWorkbuddyConnections();
  }, []);
  useEffect(() => {
    if (!workbuddyAgentId && data?.agents?.[0]?.id) setWorkbuddyAgentId(data.agents[0].id);
  }, [data?.agents, workbuddyAgentId]);

  async function loadWorkbuddyConnections() {
    try {
      const value = await fetch(apiPath("/integrations/workbuddy/connections"), { headers: authHeaders() })
        .then((response) => readJson<WorkbuddyConnectionsResponse>(response));
      setWorkbuddy(value);
    } catch (reason) {
      setWorkbuddyStatus(reason instanceof Error ? reason.message : "WorkBuddy 连接加载失败");
    }
  }

  async function createWorkbuddyConnection(event: FormEvent) {
    event.preventDefault();
    if (!workbuddyAgentId) return;
    setWorkbuddyStatus("正在生成专属连接…");
    setWorkbuddyToken("");
    try {
      const value = await fetch(apiPath("/integrations/workbuddy/connections"), {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: workbuddyAgentId, label: workbuddyLabel })
      }).then((response) => readJson<WorkbuddyConnectionsResponse & { token: string; connection: WorkbuddyConnectionView }>(response));
      setWorkbuddyToken(value.token);
      setWorkbuddy((current) => ({
        enabled: value.enabled,
        mcpUrl: value.mcpUrl,
        connections: [value.connection, ...(current?.connections ?? [])]
      }));
      setWorkbuddyStatus("连接已生成。密钥只显示这一次，请立即复制到 WorkBuddy。");
    } catch (reason) {
      setWorkbuddyStatus(reason instanceof Error ? reason.message : "WorkBuddy 连接生成失败");
    }
  }

  async function revokeWorkbuddyConnection(connectionId: string) {
    if (!window.confirm("撤销后，使用这个密钥的 WorkBuddy 将立即无法调用思潼 AI。确认撤销？")) return;
    setWorkbuddyStatus("正在撤销连接…");
    try {
      await fetch(apiPath(`/integrations/workbuddy/connections/${connectionId}`), {
        method: "DELETE",
        headers: authHeaders()
      }).then((response) => readJson(response));
      setWorkbuddy((current) => current ? {
        ...current,
        connections: current.connections.map((item) => item.id === connectionId ? { ...item, status: "revoked" } : item)
      } : current);
      setWorkbuddyStatus("连接已撤销。");
    } catch (reason) {
      setWorkbuddyStatus(reason instanceof Error ? reason.message : "撤销失败");
    }
  }

  async function copyWorkbuddySetupInstruction() {
    if (!workbuddy?.mcpUrl || !workbuddyToken) return;
    const config = JSON.stringify({
      mcpServers: {
        "sitong-ai": {
          type: "streamable-http",
          url: workbuddy.mcpUrl,
          headers: { Authorization: `Bearer ${workbuddyToken}` }
        }
      }
    }, null, 2);
    const instruction = `请帮我在 WorkBuddy 中接入“思潼 AI”MCP。请打开 MCP 配置，将下面的 sitong-ai 配置合并进现有的 mcpServers（不要删除我已有的其他 MCP），保存配置并刷新 MCP 服务列表。配置完成后请提示我：我会自行前往 MCP 服务管理页面，对 sitong-ai 点击信任并启用。\n\n${config}`;
    await navigator.clipboard.writeText(instruction);
    setWorkbuddyStatus("给 WorkBuddy 的安装指令已复制，直接粘贴发送即可。");
  }
  async function saveProfile(event: FormEvent) {
    event.preventDefault(); setStatus("正在保存…");
    try {
      await fetch(apiPath("/tenant/current/profile"), {
        method: "PATCH", headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ industry: profile.industry, city: profile.city, profile: { offer: profile.offer, customer: profile.customer } })
      }).then((response) => readJson(response));
      localStorage.setItem("store_os_tenant_profile", JSON.stringify({
        industry: profile.industry,
        city: profile.city,
        offer: profile.offer,
        customer: profile.customer
      }));
      setStatus("已保存，所有智能体将共享这些已确认信息。");
    } catch (reason) { setStatus(reason instanceof Error ? reason.message : "保存失败"); }
  }
  async function saveBranding(event: FormEvent) {
    event.preventDefault();
    setBrandingStatus("正在保存品牌外观…");
    try {
      const result = await fetch(apiPath("/tenant/current/branding"), {
        method: "PATCH",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          brandName: brandingDraft.brandName,
          systemName: brandingDraft.systemName,
          primaryColor: brandingDraft.primaryColor,
          loginHeadline: brandingDraft.loginHeadline,
          loginDescription: brandingDraft.loginDescription,
          exportFooter: brandingDraft.exportFooter
        })
      }).then((response) => readJson<{ branding: TenantBrandingConfig }>(response));
      const branding = publishTenantBranding(result.branding);
      setBrandingDraft(branding);
      setBrandingStatus("品牌外观已保存，企业专属智能体已同步更新。");
    } catch (reason) {
      setBrandingStatus(reason instanceof Error ? reason.message : "品牌外观保存失败");
    }
  }
  async function uploadBrandLogo(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 512 * 1024) { setBrandingStatus("Logo 需小于 512KB。"); return; }
    if (!/image\/(?:png|jpeg|webp)/.test(file.type)) { setBrandingStatus("Logo 仅支持 PNG、JPG 或 WebP。"); return; }
    setUploadingLogo(true);
    setBrandingStatus("正在上传 Logo…");
    try {
      const formData = new FormData();
      formData.append("logo", file);
      const result = await fetch(apiPath("/tenant/current/branding/logo"), {
        method: "POST",
        headers: authHeaders(),
        body: formData
      }).then((response) => readJson<{ branding: TenantBrandingConfig }>(response));
      const branding = publishTenantBranding(result.branding);
      setBrandingDraft(branding);
      setBrandingStatus("Logo 已上传并立即应用。");
    } catch (reason) {
      setBrandingStatus(reason instanceof Error ? reason.message : "Logo 上传失败");
    } finally {
      setUploadingLogo(false);
    }
  }
  async function resetBranding() {
    if (!window.confirm("恢复思潼默认品牌？自定义名称、颜色和 Logo 将不再显示。")) return;
    setBrandingStatus("正在恢复默认品牌…");
    try {
      const result = await fetch(apiPath("/tenant/current/branding"), {
        method: "DELETE",
        headers: authHeaders()
      }).then((response) => readJson<{ branding: TenantBrandingConfig }>(response));
      const branding = publishTenantBranding(result.branding);
      setBrandingDraft(branding);
      setBrandingStatus("已恢复思潼默认品牌。");
    } catch (reason) {
      setBrandingStatus(reason instanceof Error ? reason.message : "恢复失败");
    }
  }
  async function saveDomain(event: FormEvent) {
    event.preventDefault();
    setDomainStatus("正在生成域名验证信息…");
    try {
      const result = await fetch(apiPath("/tenant/current/domain"), {
        method: "PUT",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ hostname: domainDraft })
      }).then((response) => readJson<{ domain: Record<string, any> }>(response));
      setTenant((current) => current ? { ...current, domain: result.domain } : current);
      setDomainDraft(result.domain.hostname);
      setDomainStatus("域名已保存。请按下方指引配置 DNS，然后点击验证。");
    } catch (reason) {
      setDomainStatus(reason instanceof Error ? reason.message : "域名保存失败");
    }
  }
  async function verifyDomain() {
    setDomainStatus("正在检查 DNS 配置…");
    try {
      const result = await fetch(apiPath("/tenant/current/domain/verify"), {
        method: "POST", headers: authHeaders()
      }).then((response) => readJson<{ verified: boolean; domain: Record<string, any> }>(response));
      setTenant((current) => current ? { ...current, domain: result.domain } : current);
      setDomainStatus(result.verified ? "域名 DNS 验证成功。完成网关路由与 HTTPS 证书配置后，即可用该域名访问你的企业品牌。" : "暂未验证通过，请确认 DNS 已生效后稍后重试。");
    } catch (reason) {
      setDomainStatus(reason instanceof Error ? reason.message : "域名验证失败");
    }
  }
  async function removeDomain() {
    if (!window.confirm("确认解绑该专属域名？解绑后该域名不会再展示你的企业品牌。")) return;
    setDomainStatus("正在解绑域名…");
    try {
      await fetch(apiPath("/tenant/current/domain"), { method: "DELETE", headers: authHeaders() }).then((response) => readJson(response));
      setTenant((current) => current ? { ...current, domain: null } : current);
      setDomainDraft("");
      setDomainStatus("域名已解绑。");
    } catch (reason) {
      setDomainStatus(reason instanceof Error ? reason.message : "域名解绑失败");
    }
  }
  const canEditBranding = tenant?.role === "owner" || tenant?.role === "admin";
  const brandingPreviewLogo = tenantBrandLogoSrc(brandingDraft);
  return (
    <main className="agentProductPage accountPage">
      <nav className="agentTopbar"><button className="agentBrand whiteLabelBrand" onClick={() => navigate("/my-ai")}><TenantBrandMark branding={tenantBranding} /></button><div className="accountTopbarActions"><button className="ghostButton" onClick={() => navigate("/knowledge-base")}>企业经营资料库</button><button className="ghostButton" onClick={() => navigate(data?.defaultEntry ?? "/my-ai")}>返回智能体</button><button className="ghostButton danger" onClick={logoutCustomer}>退出登录</button></div></nav>
      <section className="accountGrid">
        <article className="accountCard"><span>企业空间</span><h2>{tenant?.profile?.tenantName ?? "正在加载…"}</h2><p>当前角色：{tenant?.role ?? "-"}</p><strong>{tenant?.creditBalance ?? data?.creditBalance ?? 0} 积分</strong></article>
        <article className="accountCard"><span>已开通智能体</span><h2>{data?.agents?.length ?? 0} 个</h2><div className="miniAgentList">{data?.agents?.map((agent) => <button key={agent.id} onClick={() => navigate(`/agents/${agent.slug}`)}><AgentAvatar agent={agent} className="miniAgentAvatar" branding={tenantBranding} />{tenantAgentDisplayName(agent.slug, customerAgentName(agent.name), tenantBranding)}</button>)}</div></article>
      </section>
      <section className="tenantBrandingEditor">
        <div><p className="agentKicker">你的企业AI系统</p><h2>保留思潼能力底座，展示你的品牌</h2><p>品牌名称、Logo、智能体外显主色、登录页和导出报告只对本企业生效；未配置时统一显示“思潼”。老板和管理员可以修改。</p></div>
        <form onSubmit={saveBranding}>
          <div className="brandPreviewCard" style={{ "--brand-preview-color": brandingDraft.primaryColor } as React.CSSProperties}>
            <span className={`brandPreviewLogo ${brandingPreviewLogo ? "hasImage" : ""}`}>{brandingPreviewLogo ? <img src={brandingPreviewLogo} alt="品牌 Logo 预览" /> : brandingDraft.brandName.slice(0, 2)}</span>
            <div><small>登录后的企业专属工作台</small><strong>{brandingDraft.systemName}</strong><span>{brandingDraft.brandName}外卖增长智能体 · 由思潼 AI 提供能力</span></div>
          </div>
          <label>品牌名<input maxLength={60} disabled={!canEditBranding} value={brandingDraft.brandName} onChange={(event) => setBrandingDraft({ ...brandingDraft, brandName: event.target.value })} placeholder="例如：三只松鼠" /></label>
          <label>系统名称<input maxLength={80} disabled={!canEditBranding} value={brandingDraft.systemName} onChange={(event) => setBrandingDraft({ ...brandingDraft, systemName: event.target.value })} placeholder="例如：枕水江南AI经营系统" /></label>
          <label>品牌主色<div className="brandColorField"><input type="color" disabled={!canEditBranding} value={brandingDraft.primaryColor} onChange={(event) => setBrandingDraft({ ...brandingDraft, primaryColor: event.target.value })} /><code>{brandingDraft.primaryColor}</code></div></label>
          <label>登录页主标题<input maxLength={120} disabled={!canEditBranding} value={brandingDraft.loginHeadline} onChange={(event) => setBrandingDraft({ ...brandingDraft, loginHeadline: event.target.value })} placeholder="例如：让 AI 成为企业稳定获客的工作台" /></label>
          <label>登录页说明<textarea rows={3} maxLength={300} disabled={!canEditBranding} value={brandingDraft.loginDescription} onChange={(event) => setBrandingDraft({ ...brandingDraft, loginDescription: event.target.value })} placeholder="说明成员登录后可以获得什么" /></label>
          <label>导出报告页脚<input maxLength={160} disabled={!canEditBranding} value={brandingDraft.exportFooter} onChange={(event) => setBrandingDraft({ ...brandingDraft, exportFooter: event.target.value })} placeholder="例如：由 XX 品牌获客系统生成" /></label>
          <label>品牌 Logo<span className="brandLogoHint">建议正方形 PNG，文件小于 512KB；支持 PNG、JPG、WebP。</span><span className="brandUploadButton">{uploadingLogo ? "上传中…" : brandingDraft.logoUrl ? "更换 Logo" : "上传 Logo"}<input type="file" accept="image/png,image/jpeg,image/webp" disabled={!canEditBranding || uploadingLogo} onChange={(event) => void uploadBrandLogo(event)} /></span></label>
          <div className="brandingFormActions"><button className="primaryButton" disabled={!canEditBranding || uploadingLogo}>保存品牌外观</button>{brandingDraft.isCustomized && canEditBranding && <button className="ghostButton" type="button" onClick={() => void resetBranding()}>恢复默认品牌</button>}</div>
          {!canEditBranding && <p>当前账号只有查看权限，请联系企业老板或管理员修改。</p>}
          <p className="brandingStatus" role="status">{brandingStatus}</p>
        </form>
      </section>
      <section className="tenantDomainEditor">
        <div><p className="agentKicker">企业专属访问域名</p><h2>用自己的域名打开企业AI系统</h2><p>绑定后，成员从该域名进入登录页，会自动匹配并展示本企业的品牌名称、Logo 与主色。请先在域名服务商处完成 DNS 配置。</p></div>
        <form onSubmit={saveDomain}>
          <label>专属域名<input inputMode="url" disabled={!canEditBranding} value={domainDraft} onChange={(event) => setDomainDraft(event.target.value)} placeholder="例如：ai.example.com" /></label>
          <div className="domainFormActions"><button className="primaryButton" disabled={!canEditBranding || !domainDraft.trim()}>保存并获取验证信息</button>{tenant?.domain && canEditBranding && <button className="ghostButton" type="button" onClick={() => void removeDomain()}>解绑域名</button>}</div>
          {tenant?.domain && <div className={`domainVerification domain-${tenant.domain.status}`}>
            <strong>{tenant.domain.status === "verified" ? "已验证" : tenant.domain.status === "failed" ? "验证未通过" : "等待验证"}</strong>
            <p>任选一种方式配置，DNS 生效通常需要几分钟到数小时。</p>
            <dl><dt>方式一：CNAME</dt><dd>主机记录 <code>{tenant.domain.hostname}</code> 指向 <code>{tenant.domain.cnameTarget}</code></dd><dt>方式二：TXT</dt><dd>主机记录 <code>{tenant.domain.verificationName}</code>，记录值 <code>{tenant.domain.verificationValue}</code></dd></dl>
            <button className="ghostButton" type="button" disabled={!canEditBranding} onClick={() => void verifyDomain()}>检查 DNS 并验证</button>
          </div>}
          {!canEditBranding && <p>当前账号只有查看权限，请联系企业老板或管理员修改。</p>}
          <p className="brandingStatus" role="status">{domainStatus}</p>
        </form>
      </section>
      <section className="workbuddyIntegrationEditor">
        <div>
          <p className="agentKicker">WorkBuddy 调用思潼 AI</p>
          <h2>为当前账号生成专属 MCP 连接</h2>
          <p>每个密钥只绑定当前用户、当前企业和一个已开通的智能体。WorkBuddy 不能修改租户身份，也不能绕过智能体权限和积分。</p>
        </div>
        <form onSubmit={createWorkbuddyConnection}>
          <label>连接名称<input maxLength={80} value={workbuddyLabel} onChange={(event) => setWorkbuddyLabel(event.target.value)} placeholder="例如：老板的 WorkBuddy" /></label>
          <label>允许调用的智能体<select value={workbuddyAgentId} onChange={(event) => setWorkbuddyAgentId(event.target.value)}>{data?.agents?.map((agent) => <option key={agent.id} value={agent.id}>{customerAgentName(agent.name)}</option>)}</select></label>
          <button className="primaryButton" disabled={!workbuddyAgentId || !workbuddyLabel.trim()}>生成专属连接</button>
        </form>
        {!workbuddy?.enabled && <p className="integrationWarning">服务器通道尚未启用。可以先完成配置，启用后连接会立即生效。</p>}
        {workbuddyToken && <div className="workbuddySecretPanel">
          <strong>密钥只显示一次</strong>
          <p>无需手动编辑 JSON。复制安装指令后，直接作为一条消息发送给 WorkBuddy；它会完成配置，你再到 MCP 服务管理中点击信任并启用即可。</p>
          <code>{workbuddyToken}</code>
          <div><button className="primaryButton" type="button" onClick={() => void copyWorkbuddySetupInstruction()}>复制并发送给 WorkBuddy</button><button className="ghostButton" type="button" onClick={() => void navigator.clipboard.writeText(workbuddyToken)}>只复制密钥</button></div>
        </div>}
        <div className="workbuddyConnectionList">
          {workbuddy?.connections.length ? workbuddy.connections.map((connection) => <article key={connection.id} className={`workbuddyConnection status-${connection.status}`}>
            <div><strong>{connection.label}</strong><span>{customerAgentName(connection.agent.name)}</span><code>{connection.tokenPrefix}</code></div>
            <div><small>{connection.lastUsedAt ? `最近调用：${new Date(connection.lastUsedAt).toLocaleString()}` : `创建于：${new Date(connection.createdAt).toLocaleString()}`}</small><span>{connection.status === "active" ? "已启用" : "已撤销"}</span>{connection.status === "active" && <button className="ghostButton danger" type="button" onClick={() => void revokeWorkbuddyConnection(connection.id)}>撤销</button>}</div>
          </article>) : <p>还没有 WorkBuddy 连接。</p>}
        </div>
        <p className="brandingStatus" role="status">{workbuddyStatus}</p>
      </section>
      <section className="profileEditor"><div><p className="agentKicker">已确认的企业事实</p><h2>只填一次，所有智能体共享</h2><p>AI 从对话中的推测不会自动覆盖这里的资料。</p></div><form onSubmit={saveProfile}><label>行业<input value={profile.industry} onChange={(event) => setProfile({ ...profile, industry: event.target.value })} /></label><label>城市<input value={profile.city} onChange={(event) => setProfile({ ...profile, city: event.target.value })} /></label><label>核心产品 / 服务<input value={profile.offer} onChange={(event) => setProfile({ ...profile, offer: event.target.value })} /></label><label>目标客户<textarea rows={3} value={profile.customer} onChange={(event) => setProfile({ ...profile, customer: event.target.value })} /></label><button className="primaryButton">保存企业资料</button><p>{status}</p></form></section>
      <section className="accountManagement"><div><p className="agentKicker">成员智能体权限</p><h2>把合适的智能体分配给合适的人</h2></div><div>{access?.members?.map((member: any) => <MemberAccessEditor key={member.id} member={member} agents={access.agents ?? []} editable={tenant?.role === "owner" || tenant?.role === "admin"} />) ?? <p>正在加载成员…</p>}</div></section>
      <section className="accountManagement"><div><p className="agentKicker">订单记录</p><h2>购买与开通记录</h2></div><div>{orders.length ? orders.map((order) => <div className="orderRow" key={order.id}><strong>{order.type}</strong><span>{order.status}</span><span>¥{order.amountCny}</span><small>{new Date(order.createdAt).toLocaleDateString()}</small></div>) : <p>暂无在线订单，后台手工开通的智能体不会生成支付订单。</p>}</div></section>
    </main>
  );
}

function MemberAccessEditor({ member, agents, editable }: { member: any; agents: AgentView[]; editable: boolean }) {
  const [selected, setSelected] = useState<string[]>(() => member.agentAccess?.map((item: any) => item.agentId) ?? []);
  const [status, setStatus] = useState("");
  async function save() {
    setStatus("保存中…");
    try {
      await fetch(apiPath(`/account/members/${member.id}/agents`), {
        method: "PUT", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ agentIds: selected })
      }).then((response) => readJson(response));
      setStatus("已保存");
    } catch (reason) { setStatus(reason instanceof Error ? reason.message : "保存失败"); }
  }
  return <article className="memberAccessRow"><div><strong>{member.user?.nickname ?? member.user?.phone ?? "企业成员"}</strong><span>{member.role}</span></div><div>{agents.map((agent) => <label key={agent.id}><input type="checkbox" checked={selected.includes(agent.id)} disabled={!editable || member.role === "owner"} onChange={(event) => setSelected(event.target.checked ? [...selected, agent.id] : selected.filter((id) => id !== agent.id))} /><AgentAvatar agent={agent} className="memberAgentAvatar" />{customerAgentName(agent.name)}</label>)}</div>{editable && member.role !== "owner" && <button className="ghostButton" onClick={() => void save()}>保存权限</button>}<small>{status}</small></article>;
}

export function InternalAgentAdminPage() {
  const [token, setToken] = useState(() => localStorage.getItem("sitong_admin_token") ?? "");
  const [data, setData] = useState<Record<string, any> | null>(null);
  const [error, setError] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [grantAgentId, setGrantAgentId] = useState("");
  const [grantStatus, setGrantStatus] = useState("");
  async function load() {
    setError(""); localStorage.setItem("sitong_admin_token", token);
    try { setData(await fetch(apiPath("/admin/agents"), { headers: adminHeaders(token) }).then((response) => readJson(response))); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "后台加载失败"); }
  }
  async function setAgentStatus(agentId: string, status: string) {
    await fetch(apiPath(`/admin/agents/${agentId}`), { method: "PATCH", headers: adminHeaders(token, true), body: JSON.stringify({ status }) }).then((response) => readJson(response));
    await load();
  }
  async function grantAgent() {
    if (!tenantId || !grantAgentId) return;
    setGrantStatus("开通中…");
    try {
      await fetch(apiPath("/admin/agent-entitlements"), {
        method: "POST",
        headers: adminHeaders(token, true),
        body: JSON.stringify({ tenantId, agentId: grantAgentId, action: "grant", membershipIds: [] })
      }).then((response) => readJson(response));
      setGrantStatus("已开通 Agent，企业老板和管理员可直接使用。");
      await load();
    } catch (reason) { setGrantStatus(reason instanceof Error ? reason.message : "开通失败"); }
  }
  return (
    <main className="agentProductPage internalPage">
      <nav className="agentTopbar"><div className="agentBrand"><span>思潼</span><strong>内部 Agent 控制台</strong></div><div className="heroActions"><button className="primaryButton" onClick={() => navigate("/internal/projects")}>客户项目工作台</button><button className="ghostButton" onClick={() => navigate("/internal/legacy")}>旧工作台</button></div></nav>
      <section className="adminLogin"><input type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder="ADMIN_TOKEN" /><button className="primaryButton" onClick={() => void load()}>进入内部后台</button></section>
      {error && <p className="agentError">{error}</p>}
      <section className="adminGrid">{data?.agents?.map((agent: any) => <article className="adminCard" key={agent.id}><div><AgentAvatar agent={agent} className="adminAgentAvatar" /><h2>{agent.name}</h2><p>{agent.slug} · {agent._count?.entitlements ?? 0} 家企业已开通</p></div><select value={agent.status} onChange={(event) => void setAgentStatus(agent.id, event.target.value)}><option value="draft">草稿</option><option value="active">已上线</option><option value="coming_soon">即将上线</option><option value="archived">已归档</option></select><ul>{agent.capabilities?.map((item: any) => <li key={item.id}>{item.title}<small>{item.skillRelease?.skillId} · {item.skillRelease?.version}</small></li>)}</ul></article>)}</section>
      {data && <SkillReleaseAdmin releases={data.skillReleases ?? []} agents={data.agents ?? []} token={token} onSaved={load} />}
      <section className="offerAdmin"><p className="agentKicker">销售层</p><h2>销售 Offer</h2><p>Agent 产品与销售组合已分离。确认价格、积分和有效期后再上架。</p>{data?.offers?.map((offer: any) => <OfferEditor key={offer.id} offer={offer} allAgents={data.agents ?? []} token={token} onSaved={load} />)}</section>
      <section className="offerAdmin"><p className="agentKicker">线下成交</p><h2>给企业手工开通 Agent</h2><div className="grantForm"><input value={tenantId} onChange={(event) => setTenantId(event.target.value)} placeholder="企业 tenantId" /><select value={grantAgentId} onChange={(event) => setGrantAgentId(event.target.value)}><option value="">选择 Agent</option>{data?.agents?.map((agent: any) => <option value={agent.id} key={agent.id}>{agent.name}</option>)}</select><button className="primaryButton" onClick={() => void grantAgent()}>立即开通</button></div><p>{grantStatus}</p></section>
    </main>
  );
}

function SkillReleaseAdmin({ releases, agents, token, onSaved }: { releases: any[]; agents: any[]; token: string; onSaved: () => Promise<void> }) {
  const skillIds = [...new Set(agents.flatMap((agent) => agent.skillBindings?.map((binding: any) => binding.skillRelease?.skillId) ?? []))] as string[];
  const [draft, setDraft] = useState({ skillId: skillIds[0] ?? "", version: "", prompt: "" });
  const [testInput, setTestInput] = useState("请用这个版本完成一次内部质量测试，并给出可执行结果。");
  const [targetAgentId, setTargetAgentId] = useState(agents[0]?.id ?? "");
  const [status, setStatus] = useState("");
  async function createRelease() {
    setStatus("正在创建不可变版本…");
    try {
      await fetch(apiPath("/admin/skill-releases"), { method: "POST", headers: adminHeaders(token, true), body: JSON.stringify(draft) }).then((response) => readJson(response));
      setStatus("草稿版本已创建，请先内部试跑。"); setDraft({ ...draft, version: "", prompt: "" }); await onSaved();
    } catch (reason) { setStatus(reason instanceof Error ? reason.message : "创建失败"); }
  }
  async function testRelease(releaseId: string) {
    setStatus("正在内部试跑…");
    try {
      const result = await fetch(apiPath(`/admin/skill-releases/${releaseId}/test`), { method: "POST", headers: adminHeaders(token, true), body: JSON.stringify({ input: testInput }) }).then((response) => readJson<any>(response));
      setStatus(`试跑完成；质量标记：${result.qualityFlags?.join("、") || "无"}`); await onSaved();
    } catch (reason) { setStatus(reason instanceof Error ? reason.message : "试跑失败"); }
  }
  async function activateRelease(releaseId: string) {
    if (!targetAgentId) return;
    setStatus("正在切换 Agent 版本…");
    try {
      await fetch(apiPath(`/admin/agents/${targetAgentId}/skill-releases/${releaseId}/activate`), { method: "POST", headers: adminHeaders(token) }).then((response) => readJson(response));
      setStatus("已原子切换；选择历史版本执行同一操作即可回滚。"); await onSaved();
    } catch (reason) { setStatus(reason instanceof Error ? reason.message : "切换失败"); }
  }
  return <section className="offerAdmin"><p className="agentKicker">执行层</p><h2>Skill 版本发布与回滚</h2><p>新版本先建草稿并内部试跑；试跑通过后再切换指定 Agent。历史版本不会被覆盖。</p><div className="skillReleaseCreate"><select value={draft.skillId} onChange={(event) => setDraft({ ...draft, skillId: event.target.value })}>{skillIds.map((skillId) => <option key={skillId}>{skillId}</option>)}</select><input value={draft.version} onChange={(event) => setDraft({ ...draft, version: event.target.value })} placeholder="版本号，例如 1.1.0" /><textarea value={draft.prompt} onChange={(event) => setDraft({ ...draft, prompt: event.target.value })} placeholder="粘贴完整 Skill 内容（至少 50 字）" /><button className="ghostButton" onClick={() => void createRelease()}>创建草稿版本</button></div><div className="skillReleaseToolbar"><input value={testInput} onChange={(event) => setTestInput(event.target.value)} /><select value={targetAgentId} onChange={(event) => setTargetAgentId(event.target.value)}>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></div><div className="skillReleaseList">{releases.map((release) => <article key={release.id}><div><strong>{release.skillId}</strong><span>{release.version} · {release.status}</span><small>{release.fileHash?.slice(0, 12)}</small></div><button className="ghostButton" onClick={() => void testRelease(release.id)}>内部试跑</button><button className="ghostButton" onClick={() => void activateRelease(release.id)}>切换 / 回滚</button></article>)}</div><p>{status}</p></section>;
}

function OfferEditor({ offer, allAgents, token, onSaved }: { offer: any; allAgents: any[]; token: string; onSaved: () => Promise<void> }) {
  const [draft, setDraft] = useState({
    name: offer.name as string,
    description: (offer.description ?? "") as string,
    status: offer.status as string,
    amountCny: Number(offer.amountCny ?? 0),
    credits: Number(offer.credits ?? 0),
    durationDays: Number(offer.durationDays ?? 365),
    agentIds: offer.agents?.map((item: any) => item.agentId) ?? [] as string[]
  });
  const [status, setStatus] = useState("");
  async function save() {
    setStatus("保存中…");
    try {
      await fetch(apiPath("/admin/agent-offers"), {
        method: "PUT",
        headers: adminHeaders(token, true),
        body: JSON.stringify({ ...draft, code: offer.code })
      }).then((response) => readJson(response));
      setStatus("已保存"); await onSaved();
    } catch (reason) { setStatus(reason instanceof Error ? reason.message : "保存失败"); }
  }
  return <article className="offerEditor"><div><strong>{offer.code}</strong><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></div><label>价格（元）<input type="number" min="0" value={draft.amountCny} onChange={(event) => setDraft({ ...draft, amountCny: Number(event.target.value) })} /></label><label>赠送积分<input type="number" min="0" value={draft.credits} onChange={(event) => setDraft({ ...draft, credits: Number(event.target.value) })} /></label><label>有效天数<input type="number" min="1" value={draft.durationDays} onChange={(event) => setDraft({ ...draft, durationDays: Number(event.target.value) })} /></label><select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })}><option value="draft">草稿</option><option value="active">上架</option><option value="archived">下架</option></select><div className="offerAgents">{allAgents.map((agent) => <label key={agent.id}><input type="checkbox" checked={draft.agentIds.includes(agent.id)} onChange={(event) => setDraft({ ...draft, agentIds: event.target.checked ? [...draft.agentIds, agent.id] : draft.agentIds.filter((id: string) => id !== agent.id) })} />{agent.name}</label>)}</div><button className="ghostButton" onClick={() => void save()}>保存 Offer</button><small>{status}</small></article>;
}

function AgentCardGrid({ agents, publicMode = false, branding }: { agents: AgentView[]; publicMode?: boolean; branding?: TenantBrandingConfig }) {
  return <section className="agentCardGrid">{agents.map((agent) => {
    const baseName = customerAgentName(agent.name);
    const displayName = branding ? tenantAgentDisplayName(agent.slug, baseName, branding) : baseName;
    return <article key={agent.id} className={`agentProductCard ${agent.entitled ? "owned" : "locked"}`}><AgentAvatar agent={agent} className="agentIcon" branding={branding} /><div><small>{agent.status === "coming_soon" ? "即将上线" : agent.marketing?.method ?? (agent.entitled ? "已开通" : "独立智能体")}</small><h2>{displayName}</h2><p>{agent.marketing?.tagline ?? agent.description}</p></div><button className={agent.entitled ? "primaryButton" : "ghostButton"} disabled={agent.status !== "active"} onClick={() => navigate(agent.entitled ? `/agents/${agent.slug}` : `/p/${agent.slug}`)}>{agent.status !== "active" ? "敬请期待" : agent.entitled ? "开始工作" : publicMode ? "了解并体验" : "申请体验 / 开通"}</button></article>;
  })}</section>;
}

function AgentCapabilities({ capabilities, selected, onSelect, compact = false }: { capabilities: AgentCapabilityView[]; selected: string; onSelect: (key: string) => void; compact?: boolean }) {
  return <div className={`agentCapabilityGrid ${compact ? "compact" : ""}`}>{capabilities.map((item) => <button key={item.key} className={selected === item.key ? "active" : ""} onClick={() => onSelect(item.key)}><strong>{item.title}</strong><span>{item.subtitle}</span></button>)}</div>;
}

function AccessRequired({ agent }: { agent: AgentView }) {
  return <main className="agentProductPage accessRequired"><AgentAvatar agent={agent} className="agentIcon" /><h1>{customerAgentName(agent.name)} 尚未开通</h1><p>当前企业账号还不能使用这项服务。</p><div className="heroActions"><button className="primaryButton" onClick={() => navigate(`/p/${agent.slug}`)}>查看介绍与体验</button><button className="ghostButton" onClick={() => navigate("/my-ai")}>返回我的智能体</button></div></main>;
}

function PageState({ text }: { text: string }) { return <main className="agentProductPage pageState"><div className="agentSpinner" /><p>{text}</p><button className="ghostButton" onClick={() => navigate("/")}>返回首页</button></main>; }

function createAgentWorkspaceTask(messages: ProductMessage[] = [], conversationId?: string, title?: string, updatedAt?: string, deviceScope: DeviceScope = "desktop"): AgentWorkspaceTask {
  const timestamp = updatedAt ?? new Date().toISOString();
  return {
    id: conversationId ? `remote-${conversationId}` : `local-${crypto.randomUUID()}`,
    deviceScope,
    title: title?.trim() || taskTitleFromMessages(messages),
    messages: messages.slice(-40),
    conversationId,
    capabilityId: inferTaskCapabilityFromMessages(messages),
    updatedAt: timestamp,
    loaded: true,
    knowledgeDocumentIds: [],
    draft: { deviceScope, content: "", updatedAt: timestamp }
  };
}

function taskTitleFromMessages(messages: ProductMessage[]): string {
  const firstUserMessage = messages.find((message) => message.role === "user")?.content.trim();
  return firstUserMessage ? firstUserMessage.replace(/\s+/g, " ").slice(0, 34) : "新对话";
}

function inferTaskCapabilityFromMessages(messages: ProductMessage[]): string {
  const firstUserMessage = messages.find((message) => message.role === "user")?.content ?? "";
  return resolveAcquisitionTaskCapabilities(firstUserMessage)[0] ?? "";
}

function isAcquisitionTaskCapability(agent: AgentView, capabilityId: string): boolean {
  if (!capabilityId) return false;
  if (agent.capabilities.some((item) => item.key === capabilityId)) return true;
  return ["franchise_acquisition", "industry_hotspots", "private_domain"].includes(capabilityId);
}

function readAgentTaskPreferences(slug: string, deviceScope: DeviceScope): Record<string, AgentTaskPreference> {
  try {
    const raw = localStorage.getItem(deviceScopedKey("sitong_agent_task_preferences", slug, deviceScope))
      ?? (deviceScope === "desktop" ? localStorage.getItem(`sitong_agent_task_preferences_${slug}`) : null)
      ?? "{}";
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).flatMap(([taskId, value]) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return [];
      const record = value as Record<string, unknown>;
      const title = typeof record.title === "string" ? record.title.trim().slice(0, 80) : undefined;
      const hidden = record.hidden === true;
      return [[taskId, { ...(title ? { title } : {}), ...(hidden ? { hidden: true } : {}) }]];
    }));
  } catch {
    return {};
  }
}

function writeAgentTaskPreference(slug: string, deviceScope: DeviceScope, taskId: string, preference: AgentTaskPreference): void {
  const current = readAgentTaskPreferences(slug, deviceScope);
  current[taskId] = {
    ...(preference.title?.trim() ? { title: preference.title.trim().slice(0, 80) } : {}),
    ...(preference.hidden ? { hidden: true } : {})
  };
  localStorage.setItem(deviceScopedKey("sitong_agent_task_preferences", slug, deviceScope), JSON.stringify(current));
}

function readAgentTaskState(slug: string, deviceScope: DeviceScope): AgentWorkspaceTaskState {
  try {
    const preferences = readAgentTaskPreferences(slug, deviceScope);
    const raw = sessionStorage.getItem(deviceScopedKey("sitong_agent_tasks", slug, deviceScope))
      ?? (deviceScope === "desktop" ? sessionStorage.getItem(`sitong_agent_tasks_${slug}`) : null);
    const parsed = raw ? JSON.parse(raw) : undefined;
    if (Array.isArray(parsed) && parsed.length > 0) {
      const tasks = parsed.flatMap((item): AgentWorkspaceTask[] => {
        if (!item || typeof item !== "object") return [];
        const record = item as Record<string, unknown>;
        if (typeof record.id !== "string" || !Array.isArray(record.messages)) return [];
        const storedDeviceScope = record.deviceScope === "mobile" ? "mobile" : "desktop";
        if (storedDeviceScope !== deviceScope) return [];
        const preference = preferences[record.id];
        if (preference?.hidden) return [];
        const messages = record.messages.filter((message): message is ProductMessage => Boolean(
          message && typeof message === "object" &&
          (((message as ProductMessage).role === "user") || ((message as ProductMessage).role === "assistant")) &&
          typeof (message as ProductMessage).content === "string"
        )).slice(-40);
        const customTitle = preference?.title || (typeof record.customTitle === "string" ? record.customTitle.trim().slice(0, 80) : undefined);
        const rawDraft = record.draft && typeof record.draft === "object" && !Array.isArray(record.draft)
          ? record.draft as Record<string, unknown>
          : undefined;
        const draftContent = rawDraft && (rawDraft.deviceScope === deviceScope || (!rawDraft.deviceScope && deviceScope === "desktop")) && typeof rawDraft.content === "string"
          ? rawDraft.content
          : "";
        return [{
          id: record.id,
          deviceScope,
          title: customTitle || (typeof record.title === "string" && record.title.trim() ? record.title : taskTitleFromMessages(messages)),
          ...(customTitle ? { customTitle } : {}),
          messages,
          conversationId: typeof record.conversationId === "string" ? record.conversationId : undefined,
          capabilityId: typeof record.capabilityId === "string" ? record.capabilityId : inferTaskCapabilityFromMessages(messages),
          updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : new Date().toISOString(),
          loaded: record.loaded !== false,
          knowledgeDocumentIds: Array.isArray(record.knowledgeDocumentIds)
            ? record.knowledgeDocumentIds.filter((item): item is string => typeof item === "string").slice(0, 100)
            : [],
          knowledgeSubjectId: typeof record.knowledgeSubjectId === "string" ? record.knowledgeSubjectId : undefined,
          customerProfile: normalizeTaskCustomerProfile(record.customerProfile),
          draft: {
            deviceScope,
            content: draftContent,
            updatedAt: rawDraft && typeof rawDraft.updatedAt === "string" ? rawDraft.updatedAt : new Date().toISOString()
          }
        }];
      });
      if (tasks.length > 0) {
        const storedActiveId = sessionStorage.getItem(deviceScopedKey("sitong_agent_active_task", slug, deviceScope))
          ?? (deviceScope === "desktop" ? sessionStorage.getItem(`sitong_agent_active_task_${slug}`) : null);
        return {
          tasks,
          activeTaskId: storedActiveId && tasks.some((task) => task.id === storedActiveId) ? storedActiveId : tasks[0].id
        };
      }
    }
  } catch {
    // Fall through to legacy single-conversation migration.
  }
  const legacyMessages = deviceScope === "desktop" ? readMessages(slug, deviceScope, true) : [];
  const legacyConversationId = deviceScope === "desktop" ? sessionStorage.getItem(`sitong_conversation_${slug}`) ?? undefined : undefined;
  const initialTask = createAgentWorkspaceTask(legacyMessages, legacyConversationId, undefined, undefined, deviceScope);
  return { tasks: [initialTask], activeTaskId: initialTask.id };
}

function normalizeTaskCustomerProfile(value: unknown): TaskCustomerProfile | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const profile: TaskCustomerProfile = {};
  for (const key of ["name", "industry", "targetCustomer", "city", "storeScale", "currentProblem", "growthGoal", "platforms"] as const) {
    if (typeof record[key] === "string" && record[key].trim()) profile[key] = record[key].trim().slice(0, 500);
  }
  return Object.keys(profile).length > 0 ? profile : undefined;
}

function mergeTaskCustomerProfile(existing?: TaskCustomerProfile, inferred?: TaskCustomerProfile): TaskCustomerProfile {
  return normalizeTaskCustomerProfile({ ...(inferred ?? {}), ...(existing ?? {}) }) ?? {};
}

function inferTaskCustomerProfile(input: string): TaskCustomerProfile | undefined {
  const source = input.replace(/\s+/g, " ").trim();
  if (!source) return undefined;
  const capturedName = source.match(/(?:客户|品牌|项目)[：:]\s*([^，。；;：:\n]{2,30})/)?.[1]
    ?? source.match(/为([^，。；;]{2,24}?)(?:制定|生成|输出|做一份)/)?.[1];
  const industry = source.match(/行业[：:]\s*([^，。；;\n]{2,40})/)?.[1];
  const targetCustomer = source.match(/(?:目标客户|目标人群|希望吸引|面向)[：:]?\s*([^，。；;\n]{2,80})/)?.[1]
    ?? source.match(/目标(?:客户|人群|受众)?不是[^，。；;\n]{1,40}(?:而是|是)\s*([^，。；;\n]{2,80})/)?.[1];
  const city = source.match(/城市[：:]\s*([^，。；;\n]{2,20})/)?.[1]
    ?? source.match(/(?:位于|都在|地区是|城市是)(北京|上海|天津|重庆|沈阳|大连|长春|哈尔滨|广州|深圳|杭州|南京|成都|武汉|西安|郑州|济南|青岛|长沙|福州|厦门|昆明|合肥|南昌|太原|石家庄)/)?.[1];
  const storeScale = source.match(/(?:目前(?:大概)?|现有|共有|大约)?\s*(\d+\s*家(?:外卖)?(?:门)?店)/)?.[1];
  const explicitProblem = source.match(/(?:当前问题|经营问题|最大问题)[：:]\s*([^。；;\n]{3,160})/)?.[1];
  const observedProblem = explicitProblem
    ?? source.match(/((?:新店|门店|招商|招生|外卖)[^。；;]{0,80}(?:不好|低|慢|难|下滑|没有增长|需要提升)[^。；;]{0,50})/)?.[1];
  const explicitGoal = source.match(/(?:本次目标|增长目标|目标)[：:]\s*([^。；;\n]{3,160})/)?.[1];
  const platforms = ["美团", "饿了么", "淘宝闪购", "抖音", "视频号", "小红书", "微信私域"]
    .filter((platform) => source.includes(platform))
    .join("、");
  return normalizeTaskCustomerProfile({
    name: capturedName?.trim(),
    industry: industry?.trim(),
    targetCustomer: targetCustomer?.trim(),
    city: city?.trim(),
    storeScale: storeScale?.trim(),
    currentProblem: observedProblem?.trim(),
    growthGoal: explicitGoal?.trim() ?? (/外卖(?:线上)?订单|外卖销售额/.test(source) ? "提升线上外卖订单与销售额" : undefined),
    platforms: platforms || undefined
  });
}

function readMessages(slug: string, deviceScope: DeviceScope, allowLegacy = false): ProductMessage[] {
  try {
    const raw = sessionStorage.getItem(deviceScopedKey("sitong_agent_messages", slug, deviceScope))
      ?? (allowLegacy ? sessionStorage.getItem(`sitong_agent_messages_${slug}`) : null)
      ?? "[]";
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value.slice(-40) : [];
  }
  catch { return []; }
}

function readTrialResult(slug: string, deviceScope: DeviceScope): { input: string; answer: string; capabilityId?: string } | null {
  try {
    const raw = sessionStorage.getItem(deviceScopedKey("sitong_trial_result", slug, deviceScope))
      ?? (deviceScope === "desktop" ? sessionStorage.getItem(`sitong_trial_result_${slug}`) : null);
    if (!raw) return null;
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (typeof value.input !== "string" || typeof value.answer !== "string") return null;
    return {
      input: value.input,
      answer: value.answer,
      capabilityId: typeof value.capabilityId === "string" ? value.capabilityId : undefined
    };
  } catch {
    return null;
  }
}

function readTrialHistory(slug: string, deviceScope: DeviceScope): Array<{ role: "user" | "assistant"; content: string }> {
  try {
    const raw = sessionStorage.getItem(deviceScopedKey("sitong_trial_history", slug, deviceScope))
      ?? (deviceScope === "desktop" ? sessionStorage.getItem(`sitong_trial_history_${slug}`) : null)
      ?? "[]";
    const value = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    const history: Array<{ role: "user" | "assistant"; content: string }> = [];
    for (const item of value) {
      if (!item || typeof item !== "object") continue;
      const record = item as Record<string, unknown>;
      const role = record.role;
      if ((role === "user" || role === "assistant") && typeof record.content === "string" && record.content.trim()) {
        history.push({ role, content: record.content.slice(0, 8_000) });
      }
    }
    return history.slice(-4);
  } catch {
    return [];
  }
}

function deviceScopedKey(base: string, slug: string, deviceScope: DeviceScope): string {
  return `${base}_${deviceScope}_${slug}`;
}

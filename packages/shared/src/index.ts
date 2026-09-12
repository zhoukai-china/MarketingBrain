export type TenantType = "local_business" | "chain_brand" | "personal_ip";

export type PlanCode =
  | "local_standard"
  | "local_premium"
  | "ip_standard"
  | "ip_premium"
  | "chain_standard"
  | "chain_premium";

export const PRODUCT_LOGIN_CODES = ["founder-ip", "takeaway", "lanqi", "beauty-industry"] as const;
export type ProductLoginCode = (typeof PRODUCT_LOGIN_CODES)[number];

export interface ProductLoginDefinition {
  code: ProductLoginCode;
  name: string;
  shortName: string;
  headline: string;
  description: string;
  tenantRole: TenantType;
  planCode: PlanCode;
  defaultPath: string;
  agentIds: readonly string[];
}

export const PRODUCT_LOGIN_DEFINITIONS: Record<ProductLoginCode, ProductLoginDefinition> = {
  "founder-ip": {
    code: "founder-ip",
    name: "创始人 IP 获客系统",
    shortName: "创始人 IP 获客",
    headline: "进入创始人 IP 获客系统",
    description: "围绕招商加盟、到店团购、学员招募和合作方招募推进获客。",
    tenantRole: "personal_ip",
    planCode: "ip_standard",
    defaultPath: "/agents/acquisition",
    agentIds: ["agent_acquisition"],
  },
  takeaway: {
    code: "takeaway",
    name: "枕水江南外卖增长智能体",
    shortName: "外卖增长",
    headline: "进入外卖增长智能体",
    description: "为品牌总部与门店提供外卖诊断、经营动作和复盘工作台。",
    tenantRole: "chain_brand",
    planCode: "chain_standard",
    defaultPath: "/agents/takeaway-growth",
    agentIds: ["agent_takeaway_growth"],
  },
  lanqi: {
    code: "lanqi",
    name: "兰琪美业经营增长系统",
    shortName: "兰琪美业",
    headline: "进入兰琪美业经营增长系统",
    description: "使用兰琪授权的方法论，建立门店档案、经营诊断和增长执行方案。",
    tenantRole: "local_business",
    planCode: "local_standard",
    // 当前口径（用户 2026-09-11）：只有「私域营销」可正常上线，作为默认落地页；
    // 经营驾驶舱等未验收板块显示「开发中」。
    defaultPath: "/lanqi/moments",
    agentIds: [],
  },
  "beauty-industry": {
    code: "beauty-industry",
    name: "美业智能体",
    shortName: "美业智能体",
    headline: "进入美业智能体",
    description: "围绕门店经营档案、内容获客、直播复盘与美业销售，提供可保存、可继续推进的经营工作台。",
    tenantRole: "local_business",
    planCode: "local_standard",
    defaultPath: "/agents/beauty-industry",
    agentIds: ["agent_beauty_acquisition"],
  },
};

export function isProductLoginCode(value: unknown): value is ProductLoginCode {
  return typeof value === "string" && (PRODUCT_LOGIN_CODES as readonly string[]).includes(value);
}


export type WeaknessTag = "acquisition" | "delivery" | "management";

export type UserRole = "owner" | "admin" | "operator" | "manager" | "staff";

export type AgentWorkMapNodeKind = "knowledge" | "system" | "review";

export type AgentWorkMapNodeAction =
  | { type: "knowledge" }
  | { type: "static" }
  | { type: "capability"; capabilityId: string };

export interface AgentWorkMapPoint {
  x: number;
  y: number;
}

export interface AgentWorkMapNode {
  id: string;
  title: string;
  subtitle: string;
  icon: string;
  kind: AgentWorkMapNodeKind;
  position: AgentWorkMapPoint;
  action: AgentWorkMapNodeAction;
}

export interface AgentWorkMapEdge {
  id: string;
  from: string;
  to: string;
  type: "flow" | "branch" | "feedback";
  label?: string;
  waypoints?: AgentWorkMapPoint[];
}

/**
 * Agent workbenches share this graph contract, not one hard-coded linear page.
 * Each agent may define its own nodes, branches, feedback loops and positions.
 */
export interface AgentWorkMapDefinition {
  id: string;
  version: number;
  title: string;
  subtitle: string;
  nodes: AgentWorkMapNode[];
  edges: AgentWorkMapEdge[];
}

export function validateAgentWorkMapDefinition(
  definition: AgentWorkMapDefinition,
  allowedCapabilityIds: readonly string[] = []
): string[] {
  const issues: string[] = [];
  const nodeIds = new Set<string>();
  const allowedCapabilities = new Set(allowedCapabilityIds);

  if (!definition.id.trim()) issues.push("work_map_id_missing");
  if (!Number.isInteger(definition.version) || definition.version < 1) issues.push("work_map_version_invalid");
  if (!definition.nodes.length) issues.push("work_map_nodes_missing");

  for (const node of definition.nodes) {
    if (!node.id.trim()) issues.push("work_map_node_id_missing");
    if (nodeIds.has(node.id)) issues.push(`work_map_node_duplicate:${node.id}`);
    nodeIds.add(node.id);
    if (!Number.isFinite(node.position.x) || node.position.x < 0 || node.position.x > 100) issues.push(`work_map_node_x_invalid:${node.id}`);
    if (!Number.isFinite(node.position.y) || node.position.y < 0 || node.position.y > 100) issues.push(`work_map_node_y_invalid:${node.id}`);
    if (node.action.type === "capability" && allowedCapabilities.size > 0 && !allowedCapabilities.has(node.action.capabilityId)) {
      issues.push(`work_map_capability_unknown:${node.id}:${node.action.capabilityId}`);
    }
  }

  const edgeIds = new Set<string>();
  for (const edge of definition.edges) {
    if (!edge.id.trim()) issues.push("work_map_edge_id_missing");
    if (edgeIds.has(edge.id)) issues.push(`work_map_edge_duplicate:${edge.id}`);
    edgeIds.add(edge.id);
    if (!nodeIds.has(edge.from)) issues.push(`work_map_edge_from_unknown:${edge.id}:${edge.from}`);
    if (!nodeIds.has(edge.to)) issues.push(`work_map_edge_to_unknown:${edge.id}:${edge.to}`);
    for (const point of edge.waypoints ?? []) {
      if (!Number.isFinite(point.x) || point.x < 0 || point.x > 100 || !Number.isFinite(point.y) || point.y < 0 || point.y > 100) {
        issues.push(`work_map_edge_waypoint_invalid:${edge.id}`);
      }
    }
  }

  return issues;
}

/**
 * Normalizes common speech-to-text and input-method variants for business
 * platform names. Replacements are deliberately context-aware so ordinary
 * expressions such as “这段音乐低音太重” keep their original meaning.
 */
export function normalizeBusinessInput(input: string): string {
  if (!input) return input;

  let normalized = input;
  const platformLabel = "(?:发布平台|账号平台|对标平台|内容平台|平台)";
  const accountSuffix = "(?:平台|账号|帐号|号|主页|作品|短视频|直播|投流)";

  const replaceLabeledPlatform = (aliases: string, canonical: string) => {
    normalized = normalized.replace(
      new RegExp(`(${platformLabel}\\s*[：:=]?\\s*)(?:${aliases})(?=\\s*(?:[，,。；;、|｜/]|$))`, "gi"),
      `$1${canonical}`
    );
    normalized = normalized.replace(
      new RegExp(`(?:${aliases})(?=\\s*${accountSuffix})`, "gi"),
      canonical
    );
  };

  replaceLabeledPlatform("低音|斗音|豆音|抖阴|dou\\s*音", "抖音");
  replaceLabeledPlatform("小红薯|小红叔|小宏书", "小红书");
  replaceLabeledPlatform("视屏号|视频好", "视频号");

  const hasPlatformTaskContext = /竞品|对标|同行|账号|帐号|主页|作品|短视频|直播|发布|投流|获客|内容/.test(normalized);
  const hasAudioMeaning = /音乐|音频|音色|声道|音响|耳机|喇叭|低频|bass/i.test(normalized);
  if (hasPlatformTaskContext && !hasAudioMeaning) {
    normalized = normalized
      .replace(/低音|斗音|豆音|抖阴|dou\s*音/gi, "抖音")
      .replace(/小红薯|小红叔|小宏书/g, "小红书")
      .replace(/视屏号|视频好/g, "视频号");
  }

  return normalized;
}

export type AcquisitionCapabilityId =
  | "topic_inspiration"
  | "industry_hotspots"
  | "content_plan"
  | "paid_traffic"
  | "dou_plus_traffic"
  | "shooting_editing"
  | "video_review"
  | "live_script"
  | "live_review"
  | "fip_franchise"
  | "fip_store_visit"
  | "fip_student_recruitment"
  | "fip_partner_recruitment"
  | "baolu_ip_advisor"
  | "franchise_acquisition"
  | "private_domain";

const acquisitionRoutingPatterns = {
  // Four-goal entries are explicit product goals. Keep ordinary short
  // franchise-content requests on the legacy-compatible franchise route so
  // they still receive the established fact-clarification flow.
  fipFranchise: /(?:招商加盟|招商获客|找加盟商|加盟商|加盟咨询|招商线索|加盟考察|加盟开店|加盟项目|加盟政策|开放加盟|招(?:区域)?代理)[^。；;\n]{0,40}(?:Brief|本轮目标|获客目标)|(?:招商|加盟)(?:Brief|目标)/,
  fipStoreVisit: /团购到店|团购核销|到店核销|到店预约|预约到店|消费者到店|本地消费者获客/,
  fipStudentRecruitment: /招学员|招募学员|招生|学员招募|课程招生|课程报名|试听(?:课)?|说明会报名|训练营报名/,
  fipPartnerRecruitment: /合作方招募|招(?:募)?合作方|城市合伙人|渠道合作(?:方)?|联营(?:合作)?|寻找(?:渠道|联营|城市)合作/,
  franchise: /招商加盟|招商获客|找加盟商|加盟商|加盟咨询|招商线索|加盟考察|加盟开店|加盟项目|加盟政策|开放加盟|招(?:区域)?代理|招商短视频/,
  liveReview: /直播数据复盘|直播复盘|直播数据|场观|在线峰值|平均停留|直播间.*复盘/,
  videoReview: /视频复盘|复盘(?:这|该|我)?(?:次)?(?:上传的)?(?:条)?(?:视频|文件|数据表)|播放量|完播率|平均播放|作品复盘|视频(?:号)?(?:动态)?数据|后台数据|\.csv|Excel表/,
  shootingEditing: /拍剪|剪辑|分镜|镜头|拍摄优化|拍摄建议|剪辑建议|修改建议|剪辑节奏|字幕节奏|发布前(?:修改|检查)|EDL|拆片/,
  live: /直播|开场|留人|逼单|下播/,
  explicitLiveScript: /直播话术|直播[^。；;]{0,24}(?:开场|留人|互动|转化|逼单|下播)|(?:开场|留人|互动|转化|逼单|下播)[^。；;]{0,24}直播/,
  privateDomain: /朋友圈|私域|社群|私聊承接/,
  paidTraffic: /投流|投放广告|付费流量|广告计划|广告预算|DOU\+|抖加|本地推|巨量引擎|巨量本地推|千川|随心推|出价策略|投放计划|获客成本|线索成本|投产比|广告ROI/i,
  content: /内容|选题|脚本|文案|口播|短视频|抖音|小红书|视频号|7天|一周|发布计划/,
  hotspot: /热点|趋势|行业变化|近期咨询/,
  topicInspiration: /选题灵感|TOP\s*10.*选题|选题.*TOP\s*10|四来源.*选题|根据.*(?:录音|知识库|账号数据|对标).*选题/,
  explicitMulti: /同时|一起|一并|另外|还要|再给|并且|以及|分别|全都|都要|多技能/,
  negatedPaidTraffic: /(?:不要|不需要|无需|不含|别给|排除)[^。；;]{0,24}(?:投流|投放|广告)/,
  negatedShootingEditing: /(?:不要|不需要|无需|不含|别给|只要)[^。；;]{0,24}(?:拍摄|拍摄脚本|剪辑|分镜|镜头|EDL|投流)/
} as const;

/** The single server-authoritative semantic router for acquisition capabilities. */
export function inferAcquisitionCapabilities(input: string): AcquisitionCapabilityId[] {
  const text = normalizeBusinessInput(input).replace(/\s+/g, "");
  if (!text) return [];
  const matches = {
    fipFranchise: acquisitionRoutingPatterns.fipFranchise.test(text),
    fipStoreVisit: acquisitionRoutingPatterns.fipStoreVisit.test(text),
    fipStudentRecruitment: acquisitionRoutingPatterns.fipStudentRecruitment.test(text),
    fipPartnerRecruitment: acquisitionRoutingPatterns.fipPartnerRecruitment.test(text),
    franchise: acquisitionRoutingPatterns.franchise.test(text),
    liveReview: acquisitionRoutingPatterns.liveReview.test(text),
    videoReview: acquisitionRoutingPatterns.videoReview.test(text),
    shootingEditing: acquisitionRoutingPatterns.shootingEditing.test(text) && !acquisitionRoutingPatterns.negatedShootingEditing.test(text),
    live: acquisitionRoutingPatterns.live.test(text),
    privateDomain: acquisitionRoutingPatterns.privateDomain.test(text) && !/短视频|抖音|视频号|小红书/.test(text),
    paidTraffic: acquisitionRoutingPatterns.paidTraffic.test(text) && !acquisitionRoutingPatterns.negatedPaidTraffic.test(text),
    content: acquisitionRoutingPatterns.content.test(text),
    hotspot: acquisitionRoutingPatterns.hotspot.test(text),
    topicInspiration: acquisitionRoutingPatterns.topicInspiration.test(text)
  };

  if (!acquisitionRoutingPatterns.explicitMulti.test(text)) {
    if (matches.fipStudentRecruitment) return ["fip_student_recruitment"];
    if (matches.fipPartnerRecruitment) return ["fip_partner_recruitment"];
    if (matches.fipStoreVisit) return ["fip_store_visit"];
    if (matches.fipFranchise) return ["fip_franchise"];
    if (matches.topicInspiration) return ["topic_inspiration"];
    if (matches.liveReview) return ["live_review"];
    if (matches.videoReview) return ["video_review"];
    if (matches.shootingEditing) return ["shooting_editing"];
    if (matches.hotspot) return ["industry_hotspots"];
    if (acquisitionRoutingPatterns.explicitLiveScript.test(text)) return ["live_script"];
    if (matches.franchise) return ["franchise_acquisition"];
    if (matches.paidTraffic) return ["paid_traffic"];
    if (matches.live) return ["live_script"];
    if (matches.privateDomain) return ["private_domain"];
    if (matches.content) return ["content_plan"];
    return [];
  }

  const result: AcquisitionCapabilityId[] = [];
  const add = (id: AcquisitionCapabilityId) => { if (!result.includes(id)) result.push(id); };
  if (matches.fipFranchise) add("fip_franchise");
  if (matches.fipStoreVisit) add("fip_store_visit");
  if (matches.fipStudentRecruitment) add("fip_student_recruitment");
  if (matches.fipPartnerRecruitment) add("fip_partner_recruitment");
  if (matches.topicInspiration) add("topic_inspiration");
  if (matches.liveReview) add("live_review");
  if (matches.franchise && !matches.fipFranchise) add("franchise_acquisition");
  if (!matches.fipFranchise && !matches.fipStoreVisit && !matches.fipStudentRecruitment && !matches.fipPartnerRecruitment && !matches.franchise) {
    if (matches.paidTraffic) add("paid_traffic");
    if (matches.content) add("content_plan");
  }
  if (matches.live && !matches.liveReview) add("live_script");
  if (matches.videoReview) add("video_review");
  if (matches.privateDomain) add("private_domain");
  if (matches.shootingEditing) add("shooting_editing");
  if (matches.hotspot) add("industry_hotspots");
  return result.slice(0, 3);
}

export type RestaurantCapabilityId =
  | "restaurant_diagnosis"
  | "takeaway_growth"
  | "dine_in_growth"
  | "chain_store_growth"
  | "franchise_acquisition"
  | "content_plan"
  | "live_script"
  | "private_domain"
  | "video_review";

const restaurantRoutingPatterns = {
  takeaway: /外卖订单|外卖增长|外卖店|美团.{0,12}(?:订单|进店|曝光|转化)|饿了么|淘宝闪购|配送范围|外卖平台|商品点击|外卖菜单|外卖套餐/,
  dineIn: /堂食|到店增长|到店客流|附近顾客|翻台|团购核销|午餐客流|晚餐客流|到店消费|门店客流/,
  chain: /连锁门店增长|多店经营|多店运营|门店对比|门店排名|区域门店|店群|同店增长|总部运营|连锁经营/,
  franchise: /招商加盟|找加盟商|加盟线索|加盟考察|加盟签约|加盟增长|开放加盟|招(?:区域)?代理/,
  content: /选题|文案|脚本|口播|短视频|抖音|小红书|视频号|内容计划|发布计划/,
  live: /直播话术|直播脚本|直播间|开场|留人|互动话术|下播/,
  privateDomain: /朋友圈|私域|社群|私聊承接/,
  videoReview: /视频复盘|作品复盘|播放量|完播率|平均播放|(?:视频|作品)(?:后台)?数据|上传.{0,12}(?:\.csv|Excel表)|\.(?:csv|xlsx|xls)\b/i,
  diagnosis: /餐饮诊断|经营诊断|增长诊断|经营体检|问题在哪|增长方案|经营分析|餐饮增长/
} as const;

/** Server-authoritative semantic router for the restaurant industry Agent. */
export function inferRestaurantCapabilities(input: string): RestaurantCapabilityId[] {
  const text = normalizeBusinessInput(input).replace(/\s+/g, "");
  if (!text) return [];
  const matches = {
    takeaway: restaurantRoutingPatterns.takeaway.test(text),
    dineIn: restaurantRoutingPatterns.dineIn.test(text),
    chain: restaurantRoutingPatterns.chain.test(text),
    franchise: restaurantRoutingPatterns.franchise.test(text),
    content: restaurantRoutingPatterns.content.test(text),
    live: restaurantRoutingPatterns.live.test(text),
    privateDomain: restaurantRoutingPatterns.privateDomain.test(text),
    videoReview: restaurantRoutingPatterns.videoReview.test(text),
    diagnosis: restaurantRoutingPatterns.diagnosis.test(text)
  };
  const asksOnlyForContent = matches.content && /(?:只要|只写|只做|帮我写|生成|创作)[^。；;]{0,18}(?:选题|文案|脚本|口播|短视频)/.test(text);

  if (!acquisitionRoutingPatterns.explicitMulti.test(text)) {
    if (matches.videoReview) return ["video_review"];
    if (matches.live) return ["live_script"];
    if (matches.privateDomain) return ["private_domain"];
    if (asksOnlyForContent) return ["content_plan"];
    if (matches.franchise) return ["franchise_acquisition"];
    if (matches.takeaway) return ["takeaway_growth"];
    if (matches.dineIn) return ["dine_in_growth"];
    if (matches.chain) return ["chain_store_growth"];
    if (matches.content) return ["content_plan"];
    if (matches.diagnosis) return ["restaurant_diagnosis"];
    return [];
  }

  const result: RestaurantCapabilityId[] = [];
  const add = (id: RestaurantCapabilityId) => { if (!result.includes(id)) result.push(id); };
  if (matches.franchise) add("franchise_acquisition");
  else {
    if (matches.takeaway) add("takeaway_growth");
    if (matches.dineIn) add("dine_in_growth");
    if (matches.chain) add("chain_store_growth");
  }
  if (matches.content) add("content_plan");
  if (matches.live) add("live_script");
  if (matches.privateDomain) add("private_domain");
  if (matches.videoReview) add("video_review");
  if (result.length === 0 && matches.diagnosis) add("restaurant_diagnosis");
  return result.slice(0, 3);
}

export type SalesCapabilityId =
  | "customer_diagnosis"
  | "intent_temperature"
  | "objection_reply"
  | "follow_up_plan"
  | "closing_script"
  | "funnel_review";

/** Server-authoritative semantic router for the sales Agent. */
export function inferSalesCapabilities(input: string): SalesCapabilityId[] {
  const text = normalizeBusinessInput(input).replace(/\s+/g, "");
  if (!text) return [];
  const matched: SalesCapabilityId[] = [];
  const add = (id: SalesCapabilityId, pattern: RegExp) => { if (pattern.test(text) && !matched.includes(id)) matched.push(id); };
  add("funnel_review", /销售漏斗|漏斗复盘|线索.*成交|转化率|各阶段数据|成交数据/);
  add("objection_reply", /异议|太贵|价格高|再考虑|没效果|怎么回复|如何回复/);
  add("follow_up_plan", /跟单|跟进计划|下一步跟进|多久联系|跟进节奏/);
  add("closing_script", /成交话术|推进成交|促成签约|逼单|临门一脚/);
  add("intent_temperature", /意向|水温|优先级|值不值得跟|成交概率/);
  add("customer_diagnosis", /客户诊断|客户需求|聊天记录|决策人|决策卡点|客户情况/);
  if (matched.length === 0) return [];
  return acquisitionRoutingPatterns.explicitMulti.test(text) ? matched.slice(0, 3) : matched.slice(0, 1);
}

export type CreditPackCode = "pack_50" | "pack_100" | "pack_300" | "pack_500" | "pack_1000";

export type ProjectPackageCode =
  | "ai_health_express"
  | "local_growth_30"
  | "local_growth_90"
  | "expert_project_entry";

export type SkillId =
  | "general_qa"
  | "customer_acquisition_diagnosis"
  | "ip_positioning"
  | "baolu_topics"
  | "baolu_ip_advisor"
  | "xiaohongshu_ops"
  | "lanqi-image-prompt-enhancer"
  | "beauty-industry-compliance"
  | "beauty-industry-content-diff"
  | "beauty-industry-xhs"
  | "wechat-xhs-content-line"
  | "baolu_content_creator"
  | "founder_ip_content_creator"
  | "optimize_local_push_ads"
  | "dou_plus_ads"
  | "baolu_ad_manager"
  | "baolu_dreamina_video"
  | "moments_generator"
  | "live_script_planner"
  | "baolu_review_engine"
  | "baolu_live_review_engine"
  | "sales_growth_advisor"
  | "delivery_standardization"
  | "baolu_shangxueyuan"
  | "baolu_finance_advisor"
  | "hr_director_consultant"
  | "yuanshen_factory"
  | "ai_daily_brief"
  | "brand_consultant"
  | "digital_twin_factory"
  | "franchise_compliance_checker"
  | "franchise_recruitment_system"
  | "management_consultant"
  | "menu_optimizer"
  | "multi_store_dashboard"
  | "opc_client_education"
  | "opc_delivery_system"
  | "opc_pricing_model"
  | "promotion_planner"
  | "store_data_analyst"
  | "enterprise_diagnosis_orchestrator"
  | "supply_chain_diagnosis"
  | "implementation_supervision_scheduler"
  | "industry_benchmark_diagnosis"
  | "ceo-cockpit-analyst"
  | "takeaway-growth-advisor"
  | "restaurant-growth-advisor";

export interface PlanDefinition {
  code: PlanCode;
  name: string;
  tenantType: TenantType;
  tier: "standard" | "premium";
  monthlyPriceCny: number;
  yearlyPriceCny: number;
  monthlyCredits: number;
  includedSeatLimit: number;
  includedStoreLimit: number;
  skills: SkillId[];
  hasWorkbench: boolean;
  hasFileAnalysis: boolean;
  hasAudioCardAnalysis: boolean;
  hasAdvancedAutomation: boolean;
}

export type { DeviceScope } from "./device-scope.js";

export interface CreditPackDefinition {
  code: CreditPackCode;
  name: string;
  priceCny: number;
  /** 基础积分，严格等于 priceCny × 20。 */
  baseCredits: number;
  /** 阶梯赠送积分，独立记账，不混入基础积分。 */
  bonusCredits: number;
}

/**
 * 思潼AI 统一积分钱包定价口径（定稿）。
 * 1 元 = 20 积分；售价锚交付价值，成本只做毛利告警，不进定价公式。
 */
export const CREDIT_PRICING = {
  ptsPerYuan: 20,
  customerPriceCnyPerCredit: 0.05,
  formula: "售价锚交付价值；成本波动由毛利吸收，不传导到前端价格"
} as const;

/**
 * 平台公共能力定价（全平台统一）。
 * 精美 Word 导出（/exports/docx）按次扣积分；成本不进定价公式。
 */
export const EXPORT_PRICING = {
  docxVersion: 1,
  docxEffectiveAt: "2026-09-10",
  docxCredits: 10
} as const;

/**
 * 积分 → 人民币折算（基准 1 元 = 20 积分）。
 * 只用于标价展示，不参与定价公式；成本波动由毛利吸收，不传导到售价。
 */
export function creditsToYuan(
  credits: number,
  ptsPerYuan: number = CREDIT_PRICING.ptsPerYuan
): number {
  const points = Number(credits);
  if (!Number.isFinite(points) || !Number.isFinite(ptsPerYuan) || ptsPerYuan <= 0) return 0;
  return points / ptsPerYuan;
}

/** 人民币展示文本：去掉多余小数位（10 → "10"，0.5 → "0.5"，0.05 → "0.05"）。 */
export function formatYuanText(amount: number): string {
  const value = Number.isFinite(amount) ? amount : 0;
  const rounded = Math.round(value * 100) / 100;
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

/**
 * 标价文案：200 积分 → "≈ ¥10"；40 积分 → "≈ ¥2"；10 积分 → "≈ ¥0.5"。
 *
 * ⚠️ 仅供内部 / 管理端使用（PLAT-19，用户 2026-09-12 要求）：
 * 面向客户的智能体页面、聊天页、生成确认与扣费提示**只显示积分**，
 * 不显示折算人民币。`apps/web` 客户界面禁止再引用本函数（有契约 smoke 兜底：
 * `pnpm marketplace:credits-only-contract-smoke`）。
 */
export function yuanLabelForCredits(
  credits: number,
  ptsPerYuan: number = CREDIT_PRICING.ptsPerYuan
): string {
  return `≈ ¥${formatYuanText(creditsToYuan(credits, ptsPerYuan))}`;
}

export interface ProjectPackageDefinition {
  code: ProjectPackageCode;
  name: string;
  priceCny: number;
  includedCredits: number;
  durationDays: number;
  intensiveDays: number;
  accessDays: number;
  bufferDays: number;
  defaultSeatLimit: number;
  defaultCommissionRate: number;
  tier: "entry" | "cohort" | "premium" | "expert";
  description: string;
}

export const ACTIVE_SKILLS: SkillId[] = [
  "general_qa",
  "customer_acquisition_diagnosis",
  "ip_positioning",
  "baolu_topics",
  "baolu_ip_advisor",
  "xiaohongshu_ops",
  "lanqi-image-prompt-enhancer",
  "beauty-industry-compliance",
  "beauty-industry-content-diff",
  "beauty-industry-xhs",
  "wechat-xhs-content-line",
  "baolu_content_creator",
  "founder_ip_content_creator",
  "optimize_local_push_ads",
  "dou_plus_ads",
  "baolu_ad_manager",
  "baolu_dreamina_video",
  "moments_generator",
  "live_script_planner",
  "baolu_review_engine",
  "baolu_live_review_engine",
  "sales_growth_advisor",
  "delivery_standardization",
  "baolu_shangxueyuan",
  "baolu_finance_advisor",
  "hr_director_consultant",
  "yuanshen_factory",
  "ai_daily_brief",
  "brand_consultant",
  "digital_twin_factory",
  "franchise_compliance_checker",
  "franchise_recruitment_system",
  "management_consultant",
  "menu_optimizer",
  "multi_store_dashboard",
  "opc_client_education",
  "opc_delivery_system",
  "opc_pricing_model",
  "promotion_planner",
  "store_data_analyst",
  "enterprise_diagnosis_orchestrator",
  "supply_chain_diagnosis",
  "implementation_supervision_scheduler",
  "industry_benchmark_diagnosis",
  "ceo-cockpit-analyst",
  "takeaway-growth-advisor",
  "restaurant-growth-advisor"
];

// Plans remain as tenant-profile compatibility keys. They are no longer a
// billing tier or a capability paywall: every active skill is credit-eligible.
export const STANDARD_LOCAL_SKILLS: SkillId[] = [...ACTIVE_SKILLS];

export const PREMIUM_LOCAL_SKILLS: SkillId[] = [...STANDARD_LOCAL_SKILLS];

export const STANDARD_CHAIN_SKILLS: SkillId[] = [...ACTIVE_SKILLS];

export const PREMIUM_CHAIN_SKILLS: SkillId[] = [...STANDARD_CHAIN_SKILLS];

export const STANDARD_IP_SKILLS: SkillId[] = [...ACTIVE_SKILLS];

export const PREMIUM_IP_SKILLS: SkillId[] = [...STANDARD_IP_SKILLS];

export const PLANS: Record<PlanCode, PlanDefinition> = {
  local_standard: {
    code: "local_standard",
    name: "按积分使用",
    tenantType: "local_business",
    tier: "standard",
    monthlyPriceCny: 0,
    yearlyPriceCny: 0,
    monthlyCredits: 0,
    includedSeatLimit: 1,
    includedStoreLimit: 1,
    skills: STANDARD_LOCAL_SKILLS,
    hasWorkbench: true,
    hasFileAnalysis: true,
    hasAudioCardAnalysis: true,
    hasAdvancedAutomation: true
  },
  local_premium: {
    code: "local_premium",
    name: "按积分使用",
    tenantType: "local_business",
    tier: "premium",
    monthlyPriceCny: 0,
    yearlyPriceCny: 0,
    monthlyCredits: 0,
    includedSeatLimit: 8,
    includedStoreLimit: 10,
    skills: PREMIUM_LOCAL_SKILLS,
    hasWorkbench: true,
    hasFileAnalysis: true,
    hasAudioCardAnalysis: true,
    hasAdvancedAutomation: true
  },
  ip_standard: {
    code: "ip_standard",
    name: "按积分使用",
    tenantType: "personal_ip",
    tier: "standard",
    monthlyPriceCny: 0,
    yearlyPriceCny: 0,
    monthlyCredits: 0,
    includedSeatLimit: 1,
    includedStoreLimit: 1,
    skills: STANDARD_IP_SKILLS,
    hasWorkbench: true,
    hasFileAnalysis: true,
    hasAudioCardAnalysis: true,
    hasAdvancedAutomation: true
  },
  ip_premium: {
    code: "ip_premium",
    name: "按积分使用",
    tenantType: "personal_ip",
    tier: "premium",
    monthlyPriceCny: 0,
    yearlyPriceCny: 0,
    monthlyCredits: 0,
    includedSeatLimit: 3,
    includedStoreLimit: 1,
    skills: PREMIUM_IP_SKILLS,
    hasWorkbench: true,
    hasFileAnalysis: true,
    hasAudioCardAnalysis: true,
    hasAdvancedAutomation: true
  },
  chain_standard: {
    code: "chain_standard",
    name: "按积分使用",
    tenantType: "chain_brand",
    tier: "standard",
    monthlyPriceCny: 0,
    yearlyPriceCny: 0,
    monthlyCredits: 0,
    includedSeatLimit: 5,
    includedStoreLimit: 5,
    skills: STANDARD_CHAIN_SKILLS,
    hasWorkbench: true,
    hasFileAnalysis: true,
    hasAudioCardAnalysis: true,
    hasAdvancedAutomation: true
  },
  chain_premium: {
    code: "chain_premium",
    name: "按积分使用",
    tenantType: "chain_brand",
    tier: "premium",
    monthlyPriceCny: 0,
    yearlyPriceCny: 0,
    monthlyCredits: 0,
    includedSeatLimit: 20,
    includedStoreLimit: 50,
    skills: PREMIUM_CHAIN_SKILLS,
    hasWorkbench: true,
    hasFileAnalysis: true,
    hasAudioCardAnalysis: true,
    hasAdvancedAutomation: true
  }
};

export const CREDIT_PACKS: Record<CreditPackCode, CreditPackDefinition> = {
  pack_50: {
    code: "pack_50",
    name: "试试看",
    priceCny: 50,
    baseCredits: 1000,
    bonusCredits: 0
  },
  pack_100: {
    code: "pack_100",
    name: "够用一阵",
    priceCny: 100,
    baseCredits: 2000,
    bonusCredits: 200
  },
  pack_300: {
    code: "pack_300",
    name: "常用",
    priceCny: 300,
    baseCredits: 6000,
    bonusCredits: 1000
  },
  pack_500: {
    code: "pack_500",
    name: "重度",
    priceCny: 500,
    baseCredits: 10000,
    bonusCredits: 2000
  },
  pack_1000: {
    code: "pack_1000",
    name: "团队年用",
    priceCny: 1000,
    baseCredits: 20000,
    bonusCredits: 5000
  }
};

export const PROJECT_PACKAGES: Record<ProjectPackageCode, ProjectPackageDefinition> = {
  ai_health_express: {
    code: "ai_health_express",
    name: "AI增长体检加急解读",
    priceCny: 1980,
    includedCredits: 80,
    durationDays: 30,
    intensiveDays: 7,
    accessDays: 30,
    bufferDays: 30,
    defaultSeatLimit: 1,
    defaultCommissionRate: 0.2,
    tier: "entry",
    description: "报告人工解读、优先问题排序和30天行动建议，后续升级项目可抵扣。"
  },
  local_growth_30: {
    code: "local_growth_30",
    name: "本地商家30天AI增长陪跑包",
    priceCny: 6980,
    includedCredits: 500,
    durationDays: 120,
    intensiveDays: 30,
    accessDays: 90,
    bufferDays: 120,
    defaultSeatLimit: 50,
    defaultCommissionRate: 0.2,
    tier: "cohort",
    description: "30天密集陪跑，系统每日任务推进，老师关键节点统一讲解和点评。"
  },
  local_growth_90: {
    code: "local_growth_90",
    name: "本地商家90天增长启动包",
    priceCny: 16800,
    includedCredits: 1200,
    durationDays: 120,
    intensiveDays: 90,
    accessDays: 90,
    bufferDays: 120,
    defaultSeatLimit: 20,
    defaultCommissionRate: 0.15,
    tier: "premium",
    description: "适合定位、内容、成交和复盘一起跑通的本地商家深度启动项目。"
  },
  expert_project_entry: {
    code: "expert_project_entry",
    name: "专家项目起步包",
    priceCny: 49800,
    includedCredits: 3000,
    durationDays: 180,
    intensiveDays: 90,
    accessDays: 180,
    bufferDays: 180,
    defaultSeatLimit: 5,
    defaultCommissionRate: 0.08,
    tier: "expert",
    description: "成熟客户的复杂经营、招商、门店标准化或组织管理项目入口。"
  }
};

export function planAllowsSkill(planCode: PlanCode, skillId: SkillId): boolean {
  return PLANS[planCode].skills.includes(skillId);
}

export interface RecommendedProduct {
  consultantId: SkillId;
  reason: string;
  process: string;
}

export const WEAKNESS_TAG_CONSULTANTS: Record<WeaknessTag, RecommendedProduct[]> = {
  acquisition: [
    {
      consultantId: "baolu_content_creator",
      reason: "获客是当前最短的板。林策帮你重构内容线，从选题、文案到脚本，把'不知道发什么'变成每天都有内容可发。",
      process: "第1步：把行业发给林策 \u2192 第2步：AI生成本周5条选题 \u2192 第3步：你挑3条 \u2192 第4步：AI生成口播稿+分镜脚本 \u2192 第5步：你拍 \u2192 第6步：AI帮你做标题+封面+发"
    },
    {
      consultantId: "ip_positioning",
      reason: "获客难的根往往是'别人不知道你是谁'。许岚帮你把IP人设钉准，让内容有方向、有辨识度、有信任感。",
      process: "第1步：和许岚聊20分钟 \u2192 第2步：AI生成IP定位报告 \u2192 第3步：你确认人设关键词 \u2192 第4步：AI输出3条内容选题方向"
    },
    {
      consultantId: "live_script_planner",
      reason: "直播是最快的获客杠杆。白燃帮你写完整话术脚本，从开场留人到逼单成交，一场直播顶一周自然流量。",
      process: "第1步：告诉白燃你的产品和活动 \u2192 第2步：AI生成2小时完整话术包 \u2192 第3步：你试播 \u2192 第4步：AI复盘优化"
    }
  ],
  delivery: [
    {
      consultantId: "delivery_standardization",
      reason: "交付是最该标准化的环节。沈管帮你把服务流程拆成SOP，让体验、复购和口碑可复制。",
      process: "第1步：和沈管聊你现在的交付流程 \u2192 第2步：AI拆解成SOP清单 \u2192 第3步：你选3个优先标准化的环节 \u2192 第4步：AI生成标准话术和检查表"
    },
    {
      consultantId: "sales_growth_advisor",
      reason: "交付不稳直接拖累成交。周成帮你把每一次咨询变成可推进、可跟进、可成交的动作，不让交付问题劝退客户。",
      process: "第1步：和周成聊你的销售流程 \u2192 第2步：AI生成标准跟进SOP \u2192 第3步：每天按节奏推进 \u2192 第4步：AI复盘转化率"
    },
    {
      consultantId: "baolu_shangxueyuan",
      reason: "如果是连锁加盟，加盟商培训是交付的核心。商学院帮加盟商从选址到开业全流程标准化。",
      process: "第1步：录入你的加盟商SOP \u2192 第2步：AI生成培训课程 \u2192 第3步：加盟商自助学习 \u2192 第4步：AI追踪学习进度"
    }
  ],
  management: [
    {
      consultantId: "ai_daily_brief",
      reason: "管理问题本质是信息不对称。AI日报帮你把团队每天的工作自动汇总，不用开会就知道谁在干什么。",
      process: "第1步：团队成员在企业微信提交日报 \u2192 第2步：AI自动汇总部门日报 \u2192 第3步：你每天早上打开就看到重点成果和风险"
    },
    {
      consultantId: "hr_director_consultant",
      reason: "老板太累的核心是没人帮你管人。HR顾问帮你做招聘、绩效、团队建设，把人从'要管'变成'自运转'。",
      process: "第1步：和HR顾问聊团队现状 \u2192 第2步：AI生成岗位描述和面试问题 \u2192 第3步：AI帮你筛选简历 \u2192 第4步：AI生成绩效模板"
    },
    {
      consultantId: "delivery_standardization",
      reason: "无法规模化复制的根是缺少SOP。沈管帮你把老板脑子里的经验变成团队能执行的标准化流程。",
      process: "第1步：把你脑子里'怎么做'写下来 \u2192 第2步：AI拆成步骤级SOP \u2192 第3步：团队按SOP执行 \u2192 第4步：AI追踪执行率"
    }
  ]
};

export function getRecommendedConsultants(
  weaknessTags: WeaknessTag[]
): RecommendedProduct[] {
  const seen = new Set<SkillId>();
  const results: RecommendedProduct[] = [];
  for (const tag of weaknessTags) {
    const consultants = WEAKNESS_TAG_CONSULTANTS[tag] ?? [];
    for (const c of consultants) {
      if (!seen.has(c.consultantId)) {
        seen.add(c.consultantId);
        results.push(c);
      }
    }
  }
  return results;
}

/**
 * Stable delivery contract used by the four acquisition workbench systems.
 * The API owns this structure so web clients never need to guess document
 * sections from model-specific Markdown formatting.
 */
export type StableDeliveryCapabilityId =
  | "topic_inspiration"
  | "content_plan"
  | "paid_traffic"
  | "video_review";

export type AgentReasoningProfile = "standard" | "deep";

export interface StableDeliveryBlock {
  id: string;
  type: "summary" | "section" | "warning" | "next_steps";
  title: string;
  content: string;
  marker: string;
}

export interface StableDeliveryValidation {
  status: "valid" | "degraded";
  issues: string[];
}

export interface StableAgentDelivery {
  version: "1.0";
  capabilityId: StableDeliveryCapabilityId;
  title: string;
  intro: string;
  blocks: StableDeliveryBlock[];
  fallbackMarkdown: string;
  validation: StableDeliveryValidation;
}

export interface TenantBrandingConfig {
  brandName: string;
  systemName: string;
  logoUrl?: string;
  primaryColor: string;
  loginHeadline: string;
  loginDescription: string;
  exportFooter: string;
  isCustomized: boolean;
}

export function isTenantBrandedAgent(slug: string, branding: TenantBrandingConfig): boolean {
  return branding.isCustomized && Boolean(slug);
}

export function tenantAgentDisplayName(
  slug: string,
  fallbackName: string,
  branding: TenantBrandingConfig
): string {
  if (!isTenantBrandedAgent(slug, branding)) return fallbackName;
  if (slug === "takeaway-growth") return `${branding.brandName}外卖增长智能体`;
  // The enterprise system name may describe a specific product (for example
  // an external-delivery workspace). It must not rename a separate agent.
  return fallbackName;
}

export type TenantDomainStatus = "pending" | "verified" | "failed";

export interface TenantDomainView {
  hostname: string;
  status: TenantDomainStatus;
  verificationName: string;
  verificationValue: string;
  cnameTarget: string;
  verifiedAt?: string;
  lastCheckedAt?: string;
}

import { readFile } from "node:fs/promises";
import path from "node:path";
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { PlanCode, SkillId, TenantType } from "@baolu/shared";
import { planAllowsSkill } from "@baolu/shared";

export interface SkillManifest {
  id: SkillId;
  name: string;
  version: string;
  description: string;
  allowedTenantTypes: TenantType[];
  minimumPlans: PlanCode[];
  baseCreditCost: number;
  isAutomationEligible: boolean;
  requiresWorkbench: boolean;
}

export interface SkillQualityContract {
  version?: string;
  qualityBar?: "sample_grade" | "standard";
  minLength?: number;
  scoreThreshold?: number;
  rubricDimensions?: string[];
  requiredTerms?: string[];
  requiredSections?: string[];
  requiredDeliverables?: string[];
  forbiddenTerms?: string[];
  styleRules?: string[];
  failurePatterns?: string[];
  repairInstruction?: string;
}

interface OriginalSkillMcpPackage {
  prompt: string;
  source?: unknown;
  textFiles?: Array<{ path?: unknown; text?: unknown }>;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const skillMcpPackageCache = new Map<string, Promise<OriginalSkillMcpPackage | undefined>>();

function getSkillRootCandidates(): string[] {
  return [
    path.resolve(__dirname, "..", "skills"),
    path.resolve(__dirname, "..", "..", "..", "skills"),
    path.resolve(process.cwd(), "packages", "skills", "skills")
  ];
}

const allPlans: PlanCode[] = [
  "local_standard",
  "local_premium",
  "ip_standard",
  "ip_premium",
  "chain_standard",
  "chain_premium"
];

const premiumPlans: PlanCode[] = ["local_premium", "ip_premium", "chain_premium"];

export const SKILL_MANIFESTS: Record<SkillId, SkillManifest> = {  general_qa: {
    id: "general_qa",
    name: "思潼 · 首席咨询师",
    version: "0.2.0",
    description: "总入口，负责理解问题、调度专项咨询师，并给出下一步经营动作。",
    allowedTenantTypes: ["local_business", "chain_brand", "personal_ip"],
    minimumPlans: allPlans,
    baseCreditCost: 5,
    isAutomationEligible: true,
    requiresWorkbench: false
  },
  baolu_ip_advisor: {
    id: "baolu_ip_advisor",
    name: "保禄 · 新媒体与创始人IP能力分身",
    version: "1.0.0",
    description: "围绕新媒体内容、创始人IP表达、账号定位、选题与内容转化，给出事实受控的专业判断和下一步。",
    allowedTenantTypes: ["local_business", "chain_brand", "personal_ip"],
    minimumPlans: allPlans,
    baseCreditCost: 5,
    isAutomationEligible: false,
    requiresWorkbench: false
  },
  customer_acquisition_diagnosis: {
    id: "customer_acquisition_diagnosis",
    name: "思潼 · 获客成交链路体检",
    version: "0.1.0",
    description: "按本地商家或连锁品牌入口，诊断获客、承接、成交和复盘链路，输出优先级和任务拆解。",
    allowedTenantTypes: ["local_business", "chain_brand", "personal_ip"],
    minimumPlans: allPlans,
    baseCreditCost: 18,
    isAutomationEligible: true,
    requiresWorkbench: false
  },
  "restaurant-growth-advisor": {
    id: "restaurant-growth-advisor",
    name: "思潼 · 餐饮增长顾问",
    version: "1.0.0",
    description: "诊断餐饮外卖订单、堂食到店、连锁门店运营与招商加盟增长，按证据边界输出行动方案。",
    allowedTenantTypes: ["local_business", "chain_brand"],
    minimumPlans: allPlans,
    baseCreditCost: 18,
    isAutomationEligible: true,
    requiresWorkbench: false
  },
  "takeaway-growth-advisor": {
    id: "takeaway-growth-advisor",
    name: "思潼 · 外卖增长顾问",
    version: "1.1.0",
    description: "审计外卖经营数据，全面诊断经营原因，验证真因后生成可审批增长方案，并跟踪真实执行、效果评估与周期复盘。",
    allowedTenantTypes: ["local_business", "chain_brand"],
    minimumPlans: allPlans,
    baseCreditCost: 18,
    isAutomationEligible: true,
    requiresWorkbench: false
  },
  ip_positioning: {
    id: "ip_positioning",
    name: "思潼 · IP定位咨询师",
    version: "0.2.0",
    description: "围绕老板IP、品牌IP、OPC账号做定位、表达角度和私域承接方案。",
    allowedTenantTypes: ["local_business", "chain_brand", "personal_ip"],
    minimumPlans: allPlans,
    baseCreditCost: 10,
    isAutomationEligible: true,
    requiresWorkbench: false
  },
  baolu_topics: {
    id: "baolu_topics",
    name: "选题灵感",
    version: "2.1.2",
    description: "自动扫描私有知识、行业热点、账号复盘和对标内容，以三关筛选法生成10个可测试选题。",
    allowedTenantTypes: ["local_business", "chain_brand", "personal_ip"],
    minimumPlans: allPlans,
    baseCreditCost: 10,
    isAutomationEligible: true,
    requiresWorkbench: false
  },
  xiaohongshu_ops: {
    id: "xiaohongshu_ops",
    name: "兰琪 · 小红书文案助手",
    version: "1.0.0",
    description: "根据门店真实资料和用户本轮需求生成小红书标题、正文、标签与互动承接；缺失事实明确待补，不生成图片、视频或发布动作。",
    allowedTenantTypes: ["local_business", "chain_brand"],
    minimumPlans: allPlans,
    baseCreditCost: 8,
    isAutomationEligible: false,
    requiresWorkbench: false
  },
  "lanqi-image-prompt-enhancer": {
    id: "lanqi-image-prompt-enhancer",
    name: "兰琪 · 文生图提示词增强",
    version: "1.0.1",
    description: "将门店自然语言图片需求转换为可编辑创作简报、差异明确的视觉方向、正负提示词和供应商无关参数；不生成图片或计费。",
    allowedTenantTypes: ["local_business", "chain_brand"],
    minimumPlans: allPlans,
    baseCreditCost: 0,
    isAutomationEligible: false,
    requiresWorkbench: false
  },
  "beauty-industry-compliance": {
    id: "beauty-industry-compliance",
    name: "美业行业合规",
    version: "1.0.0",
    description: "检查美业获客内容的事实、功效、资质、价格、素材授权和外部动作边界。",
    allowedTenantTypes: ["local_business", "chain_brand"],
    minimumPlans: allPlans,
    baseCreditCost: 5,
    isAutomationEligible: false,
    requiresWorkbench: false
  },
  "beauty-industry-content-diff": {
    id: "beauty-industry-content-diff",
    name: "美业获客内容差异",
    version: "1.1.0",
    description: "在通用获客任务上补充品牌中立的美业顾客、服务场景、内容与到店承接差异。",
    allowedTenantTypes: ["local_business", "chain_brand"],
    minimumPlans: allPlans,
    baseCreditCost: 10,
    isAutomationEligible: false,
    requiresWorkbench: false
  },
  "beauty-industry-xhs": {
    id: "beauty-industry-xhs",
    name: "美业小红书图文",
    version: "1.1.0",
    description: "生成品牌中立、事实受控的美业小红书文案与零付费配图提示词预览。",
    allowedTenantTypes: ["local_business", "chain_brand"],
    minimumPlans: allPlans,
    baseCreditCost: 8,
    isAutomationEligible: false,
    requiresWorkbench: false
  },
  "wechat-xhs-content-line": {
    id: "wechat-xhs-content-line",
    name: "公众号与小红书内容生产线",
    version: "1.0.3",
    description: "先建立事实母版，再将小红书客户成品、门店制作说明与内部质量审核分层交付；不执行发布或付费生图。",
    allowedTenantTypes: ["local_business", "chain_brand", "personal_ip"],
    minimumPlans: allPlans,
    baseCreditCost: 8,
    isAutomationEligible: false,
    requiresWorkbench: false
  },
  baolu_content_creator: {
    id: "baolu_content_creator",
    name: "林策 · 内容获客咨询师",
    version: "5.0.0",
    description: "输出选题、口播稿、访谈话术、拍摄脚本、剪辑 EDL、发布承接和受控投流预览的内容十件套。",
    allowedTenantTypes: ["local_business", "chain_brand", "personal_ip"],
    minimumPlans: allPlans,
    baseCreditCost: 12,
    isAutomationEligible: true,
    requiresWorkbench: false
  },
  founder_ip_content_creator: {
    id: "founder_ip_content_creator",
    name: "创始人 IP 获客内容生成",
    version: "1.0.0",
    description: "基于当前获客目标简报、已选题和来源证据，生成目标一致、事实受控且可编辑的创始人 IP 内容草稿。",
    allowedTenantTypes: ["personal_ip"],
    minimumPlans: allPlans,
    baseCreditCost: 12,
    isAutomationEligible: false,
    requiresWorkbench: true
  },
  optimize_local_push_ads: {
    id: "optimize_local_push_ads",
    name: "巨量本地推投流专家",
    version: "1.0.0",
    description: "面向巨量本地推线索获客，输出账户诊断、计划草案、变更预览、验证指标与回退方案。",
    allowedTenantTypes: ["local_business", "chain_brand"],
    minimumPlans: allPlans,
    baseCreditCost: 18,
    isAutomationEligible: false,
    requiresWorkbench: false
  },
  dou_plus_ads: {
    id: "dou_plus_ads",
    name: "DOU+ 投放专家",
    version: "1.0.0",
    description: "基于官方资料输出抖音 DOU+ 内容加热诊断、素材测试和安全投放预览。",
    allowedTenantTypes: ["local_business", "chain_brand", "personal_ip"],
    minimumPlans: allPlans,
    baseCreditCost: 15,
    isAutomationEligible: false,
    requiresWorkbench: false
  },
  baolu_dreamina_video: {
    id: "baolu_dreamina_video",
    name: "白墨 · 图文生视频",
    version: "0.1.0",
    description: "围绕AI视频、图生视频、文生视频输出可执行视频生成方案。",
    allowedTenantTypes: ["local_business", "chain_brand", "personal_ip"],
    minimumPlans: allPlans,
    baseCreditCost: 12,
    isAutomationEligible: true,
    requiresWorkbench: false
  },
  moments_generator: {
    id: "moments_generator",
    name: "陈域 · 朋友圈私域咨询师",
    version: "0.3.0",
    description: "生成信任型、场景型、成交型朋友圈和私域承接话术。",
    allowedTenantTypes: ["local_business", "chain_brand", "personal_ip"],
    minimumPlans: allPlans,
    baseCreditCost: 10,
    isAutomationEligible: true,
    requiresWorkbench: false
  },
  live_script_planner: {
    id: "live_script_planner",
    name: "白燃 · 直播脚本咨询师",
    version: "3.1.0",
    description: "按真实资料和实际时长生成招商、带货或知识付费直播话术包；信息不足时只追问，不生成占位框架。",
    allowedTenantTypes: ["local_business", "chain_brand", "personal_ip"],
    minimumPlans: allPlans,
    baseCreditCost: 12,
    isAutomationEligible: true,
    requiresWorkbench: false
  },
  baolu_review_engine: {
    id: "baolu_review_engine",
    name: "顾数 · 短视频复盘咨询师",
    version: "2.0.0",
    description: "支持单条快速诊断与批量深度复盘，完成数据审计、内容健康度、趋势预警、方法论和下一轮选题。",
    allowedTenantTypes: ["local_business", "chain_brand", "personal_ip"],
    minimumPlans: allPlans,
    baseCreditCost: 15,
    isAutomationEligible: true,
    requiresWorkbench: false
  },
  baolu_live_review_engine: {
    id: "baolu_live_review_engine",
    name: "罗盘 · 直播复盘咨询师",
    version: "3.0.0",
    description: "基于直播后台数据、录音转写和原定话术计划，输出证据受控的八模块直播复盘。",
    allowedTenantTypes: ["local_business", "chain_brand", "personal_ip"],
    minimumPlans: allPlans,
    baseCreditCost: 15,
    isAutomationEligible: true,
    requiresWorkbench: false
  },
  sales_growth_advisor: {
    id: "sales_growth_advisor",
    name: "周成 · 销售增长咨询师",
    version: "3.0.0",
    description: "基于真实对话和数据，分流B2C/B2B完成客户诊断、异议话术、跟单、成交推进与销售漏斗复盘。",
    allowedTenantTypes: ["local_business", "chain_brand", "personal_ip"],
    minimumPlans: allPlans,
    baseCreditCost: 12,
    isAutomationEligible: true,
    requiresWorkbench: false
  },
  delivery_standardization: {
    id: "delivery_standardization",
    name: "沈管 · 交付标准化咨询师",
    version: "0.2.0",
    description: "设计服务SOP、交付标准、客户体验、门店复制和复购机制。",
    allowedTenantTypes: ["local_business", "chain_brand", "personal_ip"],
    minimumPlans: premiumPlans,
    baseCreditCost: 15,
    isAutomationEligible: true,
    requiresWorkbench: true
  },
  baolu_shangxueyuan: {
    id: "baolu_shangxueyuan",
    name: "商学院 · 培训复制咨询师",
    version: "0.2.0",
    description: "为连锁品牌设计培训内容、课程体系、作业、考核和督导节奏。",
    allowedTenantTypes: ["chain_brand"],
    minimumPlans: ["chain_standard", "chain_premium"],
    baseCreditCost: 15,
    isAutomationEligible: true,
    requiresWorkbench: false
  },
  baolu_finance_advisor: {
    id: "baolu_finance_advisor",
    name: "衡数 · 财务经营咨询师",
    version: "0.2.0",
    description: "处理成本、利润、现金流、客单价、毛利和经营模型。",
    allowedTenantTypes: ["local_business", "chain_brand", "personal_ip"],
    minimumPlans: premiumPlans,
    baseCreditCost: 15,
    isAutomationEligible: true,
    requiresWorkbench: true
  },
  hr_director_consultant: {
    id: "hr_director_consultant",
    name: "陆城 · 组织人事咨询师",
    version: "0.2.0",
    description: "处理招聘、排班、绩效、岗位、培训和团队管理。",
    allowedTenantTypes: ["local_business", "chain_brand", "personal_ip"],
    minimumPlans: premiumPlans,
    baseCreditCost: 15,
    isAutomationEligible: true,
    requiresWorkbench: false
  },
  yuanshen_factory: {
    id: "yuanshen_factory",
    name: "老板思维模型",
    version: "0.1.0",
    description: "通过轻量访谈沉淀老板的机会判断、取舍原则和管理边界，形成团队可参考的经营判断分身。",
    allowedTenantTypes: ["local_business", "chain_brand", "personal_ip"],
    minimumPlans: allPlans,
    baseCreditCost: 15,
    isAutomationEligible: true,
    requiresWorkbench: false
  },
  ai_daily_brief: {
    id: "ai_daily_brief",
    name: "晨报 · AI日报咨询师",
    version: "1.0.0",
    description: "把已核验的公开 AI 新闻事实与面向经营者的行业解释严格分层，生成可追溯、可执行的每日情报。",
    allowedTenantTypes: ["local_business", "chain_brand", "personal_ip"],
    minimumPlans: allPlans,
    baseCreditCost: 5,
    isAutomationEligible: true,
    requiresWorkbench: false
  },  brand_consultant: {
    id: "brand_consultant",
    name: "品牌战略咨询师",
    version: "0.1.0",
    description: "连锁品牌顶层设计、品牌定位、品牌升级与品牌管理体系搭建。",
    allowedTenantTypes: ["chain_brand", "local_business"],
    minimumPlans: premiumPlans,
    baseCreditCost: 15,
    isAutomationEligible: false,
    requiresWorkbench: true
  },
  digital_twin_factory: {
    id: "digital_twin_factory",
    name: "企业AI分身定制",
    version: "0.2.0",
    description: "高级交付项目：把老板、专家或总部的表达、话术、SOP和交付方法沉淀成企业可调用的AI分身。",
    allowedTenantTypes: ["chain_brand", "personal_ip"],
    minimumPlans: premiumPlans,
    baseCreditCost: 30,
    isAutomationEligible: false,
    requiresWorkbench: true
  },
  franchise_compliance_checker: {
    id: "franchise_compliance_checker",
    name: "加盟合规检查员",
    version: "0.1.0",
    description: "加盟招商材料合规审查，包括广告法、特许经营条例等风险评估。",
    allowedTenantTypes: ["chain_brand"],
    minimumPlans: premiumPlans,
    baseCreditCost: 12,
    isAutomationEligible: false,
    requiresWorkbench: true
  },
  franchise_recruitment_system: {
    id: "franchise_recruitment_system",
    name: "招商体系架构师",
    version: "0.1.0",
    description: "连锁品牌招商体系设计：招商模式、政策、流程、话术、转化全链路。",
    allowedTenantTypes: ["chain_brand"],
    minimumPlans: premiumPlans,
    baseCreditCost: 20,
    isAutomationEligible: false,
    requiresWorkbench: true
  },
  management_consultant: {
    id: "management_consultant",
    name: "管理咨询顾问",
    version: "0.1.0",
    description: "企业组织架构、绩效考核、人才梯队建设等管理咨询。",
    allowedTenantTypes: ["chain_brand", "local_business"],
    minimumPlans: premiumPlans,
    baseCreditCost: 15,
    isAutomationEligible: false,
    requiresWorkbench: true
  },
  menu_optimizer: {
    id: "menu_optimizer",
    name: "菜单优化师",
    version: "0.1.0",
    description: "餐饮菜单结构优化、定价策略、菜品组合分析与利润最大化。",
    allowedTenantTypes: ["local_business"],
    minimumPlans: allPlans,
    baseCreditCost: 10,
    isAutomationEligible: false,
    requiresWorkbench: false
  },
  multi_store_dashboard: {
    id: "multi_store_dashboard",
    name: "多店数据看板",
    version: "0.1.0",
    description: "连锁多门店数据汇总、对比分析、异常预警与经营诊断。",
    allowedTenantTypes: ["chain_brand"],
    minimumPlans: premiumPlans,
    baseCreditCost: 20,
    isAutomationEligible: true,
    requiresWorkbench: true
  },
  opc_client_education: {
    id: "opc_client_education",
    name: "OPC客户教育顾问",
    version: "0.1.0",
    description: "为代运营客户提供内容策略教育、数据解读和合作预期管理。",
    allowedTenantTypes: ["chain_brand", "personal_ip"],
    minimumPlans: allPlans,
    baseCreditCost: 10,
    isAutomationEligible: false,
    requiresWorkbench: false
  },
  opc_delivery_system: {
    id: "opc_delivery_system",
    name: "OPC交付系统顾问",
    version: "0.1.0",
    description: "代运营交付标准化：内容排期、质量把控、客户反馈闭环。",
    allowedTenantTypes: ["chain_brand", "personal_ip"],
    minimumPlans: premiumPlans,
    baseCreditCost: 12,
    isAutomationEligible: true,
    requiresWorkbench: true
  },
  opc_pricing_model: {
    id: "opc_pricing_model",
    name: "OPC定价模型顾问",
    version: "0.1.0",
    description: "代运营服务定价策略：基础服务费+效果分成模型设计。",
    allowedTenantTypes: ["chain_brand", "personal_ip"],
    minimumPlans: premiumPlans,
    baseCreditCost: 15,
    isAutomationEligible: false,
    requiresWorkbench: true
  },
  promotion_planner: {
    id: "promotion_planner",
    name: "促销策划师",
    version: "0.1.0",
    description: "门店促销活动策划：活动设计、预算分配、ROI预测与复盘。",
    allowedTenantTypes: ["local_business", "chain_brand"],
    minimumPlans: allPlans,
    baseCreditCost: 8,
    isAutomationEligible: false,
    requiresWorkbench: false
  },
  store_data_analyst: {
    id: "store_data_analyst",
    name: "门店数据分析师",
    version: "0.1.0",
    description: "单店经营数据分析：营收拆解、成本结构、人效坪效诊断。",
    allowedTenantTypes: ["local_business", "chain_brand"],
    minimumPlans: allPlans,
    baseCreditCost: 10,
    isAutomationEligible: true,
    requiresWorkbench: false
  },
  enterprise_diagnosis_orchestrator: {
    id: "enterprise_diagnosis_orchestrator",
    name: "思潼 · 企业系统诊断总控",
    version: "0.1.0",
    description: "统一调度营收、获客、团队、门店运营、供应链、招商拓店六大板块，生成免费深度诊断报告。",
    allowedTenantTypes: ["local_business", "chain_brand", "personal_ip"],
    minimumPlans: allPlans,
    baseCreditCost: 0,
    isAutomationEligible: true,
    requiresWorkbench: false
  },
  supply_chain_diagnosis: {
    id: "supply_chain_diagnosis",
    name: "思潼 · 供应链诊断顾问",
    version: "0.1.0",
    description: "诊断采购、库存、损耗、交付周期、品控、供应商稳定性和成本波动。",
    allowedTenantTypes: ["local_business", "chain_brand"],
    minimumPlans: allPlans,
    baseCreditCost: 0,
    isAutomationEligible: true,
    requiresWorkbench: false
  },
  implementation_supervision_scheduler: {
    id: "implementation_supervision_scheduler",
    name: "思潼 · 落地督促调度员",
    version: "0.1.0",
    description: "把最终方案拆成每日任务，识别逾期、掉线和需提醒对象，推动执行闭环。",
    allowedTenantTypes: ["local_business", "chain_brand", "personal_ip"],
    minimumPlans: allPlans,
    baseCreditCost: 0,
    isAutomationEligible: true,
    requiresWorkbench: false
  },
  industry_benchmark_diagnosis: {
    id: "industry_benchmark_diagnosis",
    name: "思潼 · 行业对标诊断顾问",
    version: "0.1.0",
    description: "按行业和业务类型建立对标口径，判断行业差距、风险阈值和短板严重程度。",
    allowedTenantTypes: ["local_business", "chain_brand", "personal_ip"],
    minimumPlans: allPlans,
    baseCreditCost: 0,
    isAutomationEligible: true,
    requiresWorkbench: false
  },
  "ceo-cockpit-analyst": {
    id: "ceo-cockpit-analyst",
    name: "思潼 · CEO经营驾驶舱分析师",
      version: "1.1.0",
      description: "按推、看、决、令汇总经营资料，输出可审批、可下令、可追踪的老板经营闭环。",
    allowedTenantTypes: ["local_business", "chain_brand", "personal_ip"],
    minimumPlans: allPlans,
    baseCreditCost: 10,
    isAutomationEligible: true,
    requiresWorkbench: false
  },
  baolu_ad_manager: {
    id: "baolu_ad_manager",
    name: "广告投放专家",
    version: "0.1.0",
    description: "本地推+抖加策略优化，ROI分析和投放方案设计。",
    allowedTenantTypes: ["local_business", "chain_brand", "personal_ip"],
    minimumPlans: allPlans,
    baseCreditCost: 15,
    isAutomationEligible: false,
    requiresWorkbench: false
  },};

export function getSkillManifest(skillId: SkillId): SkillManifest {
  return SKILL_MANIFESTS[skillId];
}

export function getAllowedSkills(planCode: PlanCode): SkillManifest[] {
  return Object.values(SKILL_MANIFESTS).filter((skill) => isSkillAllowedForPlan(skill, planCode));
}

export function assertSkillAllowed(params: {
  skillId: SkillId;
  planCode: PlanCode;
  tenantType: TenantType;
}): SkillManifest {
  const manifest = getSkillManifest(params.skillId);
  if (!manifest.allowedTenantTypes.includes(params.tenantType)) {
    throw new Error(`Skill ${params.skillId} is not available for ${params.tenantType}`);
  }
  if (!planAllowsSkill(params.planCode, params.skillId)) {
    throw new Error(`Plan ${params.planCode} cannot use skill ${params.skillId}`);
  }
  return manifest;
}

function isSkillAllowedForPlan(skill: SkillManifest, planCode: PlanCode): boolean {
  // Subscription tiers no longer sell capability access. Tenant-type checks
  // remain above; each enabled skill is charged by its actual credit cost.
  return planAllowsSkill(planCode, skill.id);
}

export async function loadSkillPrompt(skillId: SkillId): Promise<string> {
  const mcpPackage = await loadSkillPackageFromMcp(skillId).catch((error: unknown) => {
    if (process.env.SKILL_MCP_REQUIRED === "true") {
      throw error;
    }
    return undefined;
  });
  if (mcpPackage?.prompt) return mcpPackage.prompt;

  const attemptedPaths: string[] = [];
  for (const skillRoot of getSkillRootCandidates()) {
    const promptPath = path.join(skillRoot, skillId, "prompt.md");
    attemptedPaths.push(promptPath);
    try {
      return await readFile(promptPath, "utf8");
    } catch (error) {
      if ((error as { code?: string }).code !== "ENOENT") {
        throw error;
      }
    }
  }
  throw new Error(`Skill prompt not found for ${skillId}. Tried: ${attemptedPaths.join(", ")}`);
}

async function loadSkillPackageFromMcp(skillId: SkillId): Promise<OriginalSkillMcpPackage | undefined> {
  const cacheKey = String(skillId);
  const cached = skillMcpPackageCache.get(cacheKey);
  if (cached) return cached;

  const promise = fetchSkillPackageFromMcp(skillId);
  skillMcpPackageCache.set(cacheKey, promise);
  try {
    return await promise;
  } catch (error) {
    // Do not permanently cache a transient MCP/network failure. Only remove
    // the exact in-flight promise so a later successful refresh cannot be
    // deleted by an older rejected request.
    if (skillMcpPackageCache.get(cacheKey) === promise) {
      skillMcpPackageCache.delete(cacheKey);
    }
    throw error;
  }
}

async function fetchSkillPackageFromMcp(skillId: SkillId): Promise<OriginalSkillMcpPackage | undefined> {
  // Local demo must validate the checked-out Skill package. An already-running
  // MCP worker may still serve an older release and must not shadow source work.
  if (process.env.DATA_MODE === "demo") return undefined;
  const mcpUrl = process.env.SKILL_MCP_URL?.trim();
  if (!mcpUrl || process.env.SKILL_MCP_ENABLED === "false") return undefined;

  const controller = new AbortController();
  const timeoutMs = parsePositiveIntEnv(process.env.SKILL_MCP_TIMEOUT_MS, 8000);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    };
    if (process.env.SKILL_MCP_TOKEN) {
      headers.Authorization = `Bearer ${process.env.SKILL_MCP_TOKEN}`;
    }

    const response = await fetch(mcpUrl, {
      method: "POST",
      signal: controller.signal,
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: `load-skill-${skillId}`,
        method: "tools/call",
        params: {
          name: "sitong_original_skill.load",
          arguments: { skillId }
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Skill MCP request failed: ${response.status} ${(await response.text()).slice(0, 300)}`);
    }

    const payload = (await response.json()) as {
      error?: { message?: string };
      result?: { content?: Array<{ type?: string; text?: string }> };
    };
    if (payload.error) {
      throw new Error(`Skill MCP error: ${payload.error.message ?? "unknown_error"}`);
    }

    const text = payload.result?.content?.find((item) => item.type === "text" && item.text)?.text;
    if (!text) {
      throw new Error("Skill MCP response missing text content");
    }

    const parsed = JSON.parse(text) as OriginalSkillMcpPackage;
    if (typeof parsed.prompt !== "string" || !parsed.prompt.trim()) {
      throw new Error("Skill MCP response missing prompt");
    }
    return {
      ...parsed,
      prompt: parsed.prompt.trim()
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Skill MCP request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function parsePositiveIntEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export async function loadSkillQualityContract(skillId: SkillId): Promise<SkillQualityContract | undefined> {
  const mcpContract = await loadSkillPackageFromMcp(skillId).then((pkg) => {
    const raw = getMcpTextFile(pkg, "contract.json");
    return raw ? normalizeSkillQualityContract(JSON.parse(raw)) : undefined;
  }).catch((error: unknown) => {
    if (process.env.SKILL_MCP_REQUIRED === "true") {
      throw error;
    }
    return undefined;
  });
  if (mcpContract) return mcpContract;
  if (process.env.SKILL_MCP_REQUIRED === "true") return undefined;

  for (const skillRoot of getSkillRootCandidates()) {
    const contractPath = path.join(skillRoot, skillId, "contract.json");
    try {
      const raw = await readFile(contractPath, "utf8");
      return normalizeSkillQualityContract(JSON.parse(raw));
    } catch (error) {
      if ((error as { code?: string }).code !== "ENOENT") {
        throw error;
      }
    }
  }
  return undefined;
}

export async function loadSkillExampleSnippets(skillId: SkillId, limit = 3, maxCharsPerExample = 2400): Promise<string[]> {
  const mcpExamples = await loadSkillPackageFromMcp(skillId).then((pkg) => {
    const files = (pkg?.textFiles ?? [])
      .filter((file): file is { path: string; text: string } => (
        typeof file.path === "string" &&
        typeof file.text === "string" &&
        /^examples\/.+\.md$/i.test(file.path)
      ))
      .sort((a, b) => a.path.localeCompare(b.path))
      .slice(0, limit)
      .map((file) => file.text.trim().slice(0, maxCharsPerExample))
      .filter(Boolean);
    return files;
  }).catch((error: unknown) => {
    if (process.env.SKILL_MCP_REQUIRED === "true") {
      throw error;
    }
    return [];
  });
  if (mcpExamples.length > 0) return mcpExamples;
  if (process.env.SKILL_MCP_REQUIRED === "true") return [];

  for (const skillRoot of getSkillRootCandidates()) {
    const examplesDir = path.join(skillRoot, skillId, "examples");
    try {
      const entries = await readdir(examplesDir, { withFileTypes: true });
      const files = entries
        .filter((entry) => entry.isFile() && /\.md$/i.test(entry.name))
        .map((entry) => entry.name)
        .sort()
        .slice(0, limit);
      const snippets = await Promise.all(
        files.map(async (file) => {
          const raw = await readFile(path.join(examplesDir, file), "utf8");
          return raw.trim().slice(0, maxCharsPerExample);
        })
      );
      return snippets.filter(Boolean);
    } catch (error) {
      if ((error as { code?: string }).code !== "ENOENT") {
        throw error;
      }
    }
  }
  return [];
}

function getMcpTextFile(pkg: OriginalSkillMcpPackage | undefined, relativePath: string): string | undefined {
  const match = (pkg?.textFiles ?? []).find((file) => file.path === relativePath);
  return typeof match?.text === "string" && match.text.trim() ? match.text : undefined;
}

function normalizeSkillQualityContract(value: unknown): SkillQualityContract {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  return {
    version: asString(record.version),
    qualityBar: record.qualityBar === "sample_grade" ? "sample_grade" : record.qualityBar === "standard" ? "standard" : undefined,
    minLength: asPositiveNumber(record.minLength),
    scoreThreshold: asPositiveNumber(record.scoreThreshold),
    rubricDimensions: asStringArray(record.rubricDimensions),
    requiredTerms: asStringArray(record.requiredTerms),
    requiredSections: asStringArray(record.requiredSections),
    requiredDeliverables: asStringArray(record.requiredDeliverables),
    forbiddenTerms: asStringArray(record.forbiddenTerms),
    styleRules: asStringArray(record.styleRules),
    failurePatterns: asStringArray(record.failurePatterns),
    repairInstruction: asString(record.repairInstruction)
  };
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asPositiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
  return items.length > 0 ? items : undefined;
}

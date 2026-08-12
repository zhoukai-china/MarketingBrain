export type ClientProjectStatus = "draft" | "ready" | "running" | "completed" | "needs_input" | "failed";

export interface ProjectExecutionStep {
  stepId: string;
  capabilityId: string;
  skillId: string;
  skillVersion: string;
  status: "success" | "needs_input" | "failed";
  durationMs: number;
  qualityFlags: string[];
  error?: { code: string; retryable: boolean };
}

export interface ClientProjectRun {
  id: string;
  createdAt: string;
  status: "completed" | "needs_input" | "failed";
  answer: string;
  solutionId: string;
  agentSlug: string;
  capabilityIds: string[];
  qualityFlags: string[];
  executionMode?: string;
  steps: ProjectExecutionStep[];
  durationMs: number;
  traceId?: string;
  conversationId?: string;
}

export interface ClientProject {
  id: string;
  title: string;
  clientName: string;
  industry: string;
  businessType: "single_store" | "chain_brand";
  storeCount: string;
  city: string;
  currentProblem: string;
  goal: string;
  knownFacts: string;
  missingFacts: string;
  solutionId: string;
  status: ClientProjectStatus;
  createdAt: string;
  updatedAt: string;
  runs: ClientProjectRun[];
}

export interface ProjectSolution {
  id: string;
  name: string;
  shortName: string;
  description: string;
  agentSlug: "acquisition" | "takeaway-growth" | "restaurant-growth" | "sales";
  capabilityIds: string[];
  capabilityNames: string[];
  deliveryRequest: string;
}

export const PROJECT_SOLUTIONS: ProjectSolution[] = [
  {
    id: "restaurant_store_growth",
    name: "线上外卖订单增长解决方案",
    shortName: "外卖订单增长",
    description: "面向美团、饿了么、淘宝闪购等外卖平台提升曝光、进店、加购、下单与复购；抖音短视频负责本地曝光和种草，不默认走抖音团购。",
    agentSlug: "takeaway-growth",
    capabilityIds: ["takeaway_growth", "takeaway_data_audit", "takeaway_experiment"],
    capabilityNames: ["外卖增长总诊断", "数据口径审计", "单变量增长实验"],
    deliveryRequest: "请形成一套可直接内部评审的外卖订单与利润增长第一版方案。业务目标是提升美团、饿了么、淘宝闪购等平台的有效完成单和贡献利润。先核对门店、平台、周期、目标、有效完成单、实付、补贴、退款和利润口径，再审计逐单、每日经营、商品、活动投放、成本、履约和竞品数据，区分事实、方向性信号、分析假设与待补信息。定位曝光、进店、商品、支付、有效完成、履约和复购中最值得先验证的一环，并设计一个7至14天单变量实验，写清基线期、排除日、测试期、保持不变项、利润与履约护栏、止损条件、负责人、审批人和复盘日。所有改价、上下架、活动、投放与预算动作只生成待审批草案；历史前后对比不直接写成因果；平台流失竞品必须标记为平台测算。"
  },
  {
    id: "beauty_store_growth",
    name: "美业门店增长解决方案",
    shortName: "美业门店增长",
    description: "适合美业单店或连锁品牌门店获客、到店转化和私域复购。",
    agentSlug: "acquisition",
    capabilityIds: ["topic_inspiration", "content_plan", "private_domain"],
    capabilityNames: ["选题灵感", "文案创作", "朋友圈私域"],
    deliveryRequest: "请形成一套可直接内部评审和与客户沟通的美业门店增长第一版方案，覆盖短视频获客、到店承接、私域跟进和30天执行计划。所有缺少的数据统一标记为【待补】，不要虚构效果。"
  },
  {
    id: "restaurant_franchise_growth",
    name: "餐饮连锁招商加盟解决方案",
    shortName: "餐饮招商加盟",
    description: "面向餐饮连锁品牌，以招商内容、加盟线索和私域承接推动扩张。",
    agentSlug: "acquisition",
    capabilityIds: ["franchise_acquisition", "live_script", "private_domain"],
    capabilityNames: ["招商获客", "直播话术", "朋友圈私域"],
    deliveryRequest: "请形成一套餐饮连锁招商加盟增长第一版方案，覆盖招商定位、目标加盟商、短视频招商内容、招商直播、私域承接、线索筛选、考察转化、30天行动表和关键指标。不得承诺收益，缺少的加盟政策和经营数据统一标记为【待补】。"
  },
  {
    id: "beauty_franchise_growth",
    name: "美业连锁招商加盟解决方案",
    shortName: "美业招商加盟",
    description: "面向美业连锁品牌，以门店模型、招商内容、加盟线索、到店考察和持续跟进推动加盟扩张。",
    agentSlug: "acquisition",
    capabilityIds: ["franchise_acquisition", "live_script", "private_domain"],
    capabilityNames: ["招商获客", "直播话术", "朋友圈私域"],
    deliveryRequest: "请形成一套美业连锁招商加盟增长第一版方案，覆盖品牌与门店模型、目标加盟商、短视频招商内容、招商直播、朋友圈私域承接、线索筛选、到店考察、签约跟进、30天行动表和关键指标。不得承诺收益，不得转成培训招生、招店长合伙人或合伙人培养；缺少的加盟政策、门店模型和经营数据统一标记为【待补】。"
  }
];

const now = "2026-07-30T09:00:00.000Z";

export const SEED_CLIENT_PROJECTS: ClientProject[] = [
  {
    id: "project-zhenshui-jiangnan",
    title: "枕水江南｜新店外卖增长",
    clientName: "枕水江南",
    industry: "中式快餐外卖",
    businessType: "chain_brand",
    storeCount: "7家外卖店",
    city: "沈阳",
    currentProblem: "新开外卖店线上订单表现不好，需要提升外卖平台订单量与销售额。",
    goal: "围绕美团、饿了么、淘宝闪购优化曝光—进店—加购—下单—复购链路，并用抖音短视频增加沈阳本地曝光与品牌搜索。",
    knownFacts: "老客户，关系很熟，可直接联系老板。\n目前共有7家外卖店，全部位于沈阳。\n本轮优先解决新开外卖店线上订单量和销售额问题。\n主要成交平台为美团、饿了么、淘宝闪购等外卖平台。\n抖音短视频负责本地曝光与种草，用户可能回到美团等平台下单；目前抖音团购不是主要成交方式。",
    missingFacts: "新店具体商圈与配送半径\n近30天外卖平台数据、客单价、毛利和订单结构\n门店核心菜品、套餐、评价与竞品情况\n现有短视频、直播、投流和私域基础",
    solutionId: "restaurant_store_growth",
    status: "ready",
    createdAt: now,
    updatedAt: now,
    runs: []
  },
  {
    id: "project-sanhe-tangshui",
    title: "三禾糖水铺｜招商加盟增长",
    clientName: "三禾糖水铺",
    industry: "餐饮糖水",
    businessType: "chain_brand",
    storeCount: "约30家门店",
    city: "",
    currentProblem: "招商加盟扩张速度慢。",
    goal: "建立招商获客、线索筛选、考察承接与持续跟进的一体化增长方案。",
    knownFacts: "老客户，关系很熟，可直接联系老板。\n目前约30家门店。\n本轮核心问题是招商加盟扩张慢。",
    missingFacts: "当前加盟政策、投资预算与回本口径\n理想加盟商画像和重点招商区域\n历史线索、到访、签约及流失数据\n现有招商内容、直播和销售团队情况",
    solutionId: "restaurant_franchise_growth",
    status: "ready",
    createdAt: now,
    updatedAt: now,
    runs: []
  },
  {
    id: "project-chuyan-miji",
    title: "初颜秘集｜消费者到店增长",
    clientName: "初颜秘集",
    industry: "美业皮肤管理",
    businessType: "chain_brand",
    storeCount: "3家门店",
    city: "",
    currentProblem: "需要提升本地消费者的有效咨询、预约、实际到店和后续复购。",
    goal: "打通短视频与朋友圈曝光、私信咨询、预约、实际到店和复购链路。",
    knownFacts: "老客户，关系很熟，可直接联系老板。\n目前有3家门店。\n本轮按美业消费者到店增长方向形成第一版方案。",
    missingFacts: "3家门店所在城市、商圈与服务半径\n主推项目、价格、毛利、服务周期和到店承载量\n近30天咨询、预约、到店、成交和复购数据\n现有账号、内容素材、私域客户量和跟进流程",
    solutionId: "beauty_store_growth",
    status: "ready",
    createdAt: now,
    updatedAt: now,
    runs: []
  }
];

export function solutionForProject(project: ClientProject): ProjectSolution {
  return PROJECT_SOLUTIONS.find((solution) => solution.id === project.solutionId) ?? PROJECT_SOLUTIONS[0];
}

export function buildClientProjectInput(project: ClientProject): string {
  const solution = solutionForProject(project);
  return [
    "你正在为思潼的真实老客户项目生成内部方案初稿。请严格保留以下已确认事实，不要把思潼自身业务当成客户业务。",
    "",
    "【客户项目】",
    `客户：${project.clientName || "【待补】"}。行业：${project.industry || "【待补】"}。`,
    `客户名称：${project.clientName || "【待补】"}`,
    `行业：${project.industry || "【待补】"}`,
    `经营形态：${project.businessType === "chain_brand" ? "连锁品牌" : "单店"}`,
    `门店规模：${project.storeCount || "【待补】"}`,
    `城市/区域：${project.city || "【待补】"}`,
    `核心问题：${project.currentProblem || "【待补】"}`,
    `本次目标：${project.goal || "【待补】"}`,
    "",
    "【已确认事实】",
    project.knownFacts.trim() || "【待补】",
    "",
    "【当前缺失信息】",
    project.missingFacts.trim() || "无",
    "",
    "【交付要求】",
    solution.deliveryRequest,
    "先交付能够成立的第一版，不要只返回问题清单。所有无法从已确认事实推出的客户数据、政策、案例、价格和效果必须明确标记为【待补】；允许基于经验提出假设，但必须标记为【建议验证】，不得伪装成客户事实。",
    "结尾请单列：1）建议老板优先确认的5个问题；2）本周即可执行的3个动作；3）本方案的事实边界。"
  ].join("\n");
}

export function createEmptyProject(): ClientProject {
  const createdAt = new Date().toISOString();
  return {
    id: `project-${crypto.randomUUID()}`,
    title: "新客户项目",
    clientName: "",
    industry: "",
    businessType: "single_store",
    storeCount: "",
    city: "",
    currentProblem: "",
    goal: "",
    knownFacts: "",
    missingFacts: "",
    solutionId: PROJECT_SOLUTIONS[0].id,
    status: "draft",
    createdAt,
    updatedAt: createdAt,
    runs: []
  };
}

export function projectCompletion(project: ClientProject): { completed: number; total: number; missing: string[] } {
  const fields = [
    ["客户名称", project.clientName],
    ["行业", project.industry],
    ["门店规模", project.storeCount],
    ["核心问题", project.currentProblem],
    ["本次目标", project.goal],
    ["已确认事实", project.knownFacts],
    ["解决方案", project.solutionId]
  ] as const;
  const missing = fields.filter(([, value]) => !value.trim()).map(([label]) => label);
  return { completed: fields.length - missing.length, total: fields.length, missing };
}

export function cloneSeedProjects(): ClientProject[] {
  return JSON.parse(JSON.stringify(SEED_CLIENT_PROJECTS)) as ClientProject[];
}

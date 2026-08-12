export type KnowledgeSubjectType = "enterprise" | "ip" | "brand" | "client_project";
export type KnowledgeLayer = "raw_private" | "confirmed_ip" | "brand_asset" | "project_private" | "enterprise_experience" | "enterprise_industry";
export type KnowledgeUsagePolicy = "auto" | "recommend" | "manual";
export type KnowledgeSensitivity = "normal" | "internal" | "sensitive";

export interface KnowledgeSubjectSummary {
  id: string;
  subjectType: KnowledgeSubjectType | string;
  name: string;
  description?: string | null;
  industry?: string | null;
  isDefault?: boolean;
}

export interface PlatformIndustryPack {
  id: string;
  name: string;
  industries: string[];
  description: string;
  reviewStatus: "platform_reviewed";
  version: string;
  principles: string[];
}

const PLATFORM_INDUSTRY_PACKS: PlatformIndustryPack[] = [
  {
    id: "platform-enterprise-operating-basics",
    name: "企业经营与内容事实基础包",
    industries: ["*"],
    description: "用于区分事实、判断、建议和待核实信息，防止智能体把计划写成结果。",
    reviewStatus: "platform_reviewed",
    version: "1.0",
    principles: [
      "企业画像是使用方背景，不自动等于本轮内容主体。",
      "用户本轮指定的IP、品牌、客户项目、受众和转化目标优先。",
      "计划、意向、建议和尝试不能改写成已经成交、已经落地或已经取得效果。",
      "资料不足时标注待核实，不用模型常识补造企业私有事实。"
    ]
  },
  {
    id: "platform-ai-service-basics",
    name: "企业AI服务行业基础包",
    industries: ["企业AI", "AI服务", "数字化", "人工智能"],
    description: "企业AI项目的需求识别、价值表达和交付边界。",
    reviewStatus: "platform_reviewed",
    version: "1.0",
    principles: [
      "先明确业务问题、现有流程、负责人和验收指标，再讨论模型或工具。",
      "AI价值应落到节省时间、降低错误、提高转化或形成新交付能力，不能只讲技术概念。",
      "客户数据、权限、人工复核和异常兜底属于交付边界，不能省略。",
      "没有真实验收数据时只描述方案和验证计划，不承诺确定效果。"
    ]
  },
  {
    id: "platform-chain-franchise-basics",
    name: "连锁与招商加盟行业基础包",
    industries: ["连锁", "招商", "加盟", "品牌"],
    description: "连锁模型、招商获客和加盟沟通的基础事实边界。",
    reviewStatus: "platform_reviewed",
    version: "1.0",
    principles: [
      "招商内容面向潜在加盟商时，重点是项目适配条件、真实样板、支持体系和风险边界。",
      "门店数、投资额、回本周期、利润和扶持政策必须来自项目资料，未知即待补。",
      "禁止承诺稳赚、保本、固定回报或用虚构稀缺制造成交压力。",
      "团队内部讨论用于诊断准备、分工、报价口径和跟进机制，不能把团队成员当销售对象。"
    ]
  },
  {
    id: "platform-local-service-basics",
    name: "本地生活与门店经营基础包",
    industries: ["餐饮", "美业", "门店", "本地生活", "摄影", "健康管理"],
    description: "本地门店获客、到店承接和内容表达的通用基础。",
    reviewStatus: "platform_reviewed",
    version: "1.0",
    principles: [
      "内容要说明适合谁、解决什么具体场景、如何到店或预约，不只展示环境和口号。",
      "价格、套餐、疗效、库存、活动时间和门店地址必须按真实资料表达。",
      "投放产品根据转化目标、可承接范围、定向能力和实测数据选择，不能仅凭产品名称判断地域。",
      "敏感健康、美容效果和收益类表达必须避免夸大承诺。"
    ]
  },
  {
    id: "platform-mobile-aftermarket-basics",
    name: "手机后市场行业基础包",
    industries: ["手机后市场", "手机贴膜", "手机维修", "手机配件"],
    description: "手机贴膜、维修、配件和连锁服务的分类与内容边界。",
    reviewStatus: "platform_reviewed",
    version: "1.0",
    principles: [
      "手机贴膜、手机维修和手机配件属于手机后市场，不属于汽车后市场。",
      "专利、设备、门店数量、培训、仓配和加盟支持必须有项目资料依据。",
      "面向消费者与面向加盟商是两套内容目标，不能混写。"
    ]
  }
];

export function listPlatformIndustryPacks(industry?: string | null): PlatformIndustryPack[] {
  const normalized = industry?.trim().toLocaleLowerCase("zh-CN") ?? "";
  return PLATFORM_INDUSTRY_PACKS.filter((pack) => pack.industries.includes("*") || (
    normalized && pack.industries.some((item) => normalized.includes(item.toLocaleLowerCase("zh-CN")) || item.toLocaleLowerCase("zh-CN").includes(normalized))
  ));
}

export function buildPlatformIndustryContext(industry?: string | null): string | undefined {
  const packs = listPlatformIndustryPacks(industry);
  if (packs.length === 0) return undefined;
  return [
    "【平台审核行业基础知识｜不能覆盖企业私有事实】",
    ...packs.flatMap((pack, index) => [
      `${index + 1}. ${pack.name}（版本 ${pack.version}）`,
      ...pack.principles.map((item) => `- ${item}`)
    ]),
    "使用规则：行业基础包只补充通用判断框架。涉及当前企业、IP、客户项目的身份、产品、数据、案例和进度，必须以已确认私有知识为准；发生冲突时明确指出，不得混成同一种事实。"
  ].join("\n");
}

export function subjectTypeLabel(subjectType: string): string {
  if (subjectType === "enterprise") return "企业";
  if (subjectType === "ip") return "IP";
  if (subjectType === "brand") return "品牌";
  if (subjectType === "client_project") return "客户项目";
  return "知识主体";
}

export function defaultKnowledgeLayer(subjectType: string): KnowledgeLayer {
  if (subjectType === "ip") return "confirmed_ip";
  if (subjectType === "brand") return "brand_asset";
  if (subjectType === "client_project") return "project_private";
  return "enterprise_experience";
}

export function buildKnowledgeSubjectContext(subject?: KnowledgeSubjectSummary | null): string | undefined {
  if (!subject) return undefined;
  return [
    "【本轮服务主体】",
    `类型：${subjectTypeLabel(subject.subjectType)}`,
    `名称：${subject.name}`,
    subject.industry ? `行业：${subject.industry}` : undefined,
    subject.description ? `主体说明：${subject.description}` : undefined,
    "所有身份、事实、案例、语言风格和业务目标必须先判断是否属于该主体。其他IP、企业或客户项目的资料不得串入；通用行业知识只能补盲，不能冒充该主体已经发生的事实。"
  ].filter(Boolean).join("\n");
}

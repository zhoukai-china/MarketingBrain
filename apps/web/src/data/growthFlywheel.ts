import type { CreditPackCode, PlanCode, ProjectPackageCode } from "@baolu/shared";

export type DiagnosisMode = "quick" | "deep";

export type QuickDiagnosisCategory =
  | "short_video_ip"
  | "store_acquisition"
  | "team_management"
  | "franchise"
  | "revenue";

export interface DiagnosisModeConfig {
  id: DiagnosisMode;
  title: string;
  subtitle: string;
  duration: string;
  audience: string;
  output: string;
  cta: string;
}

export interface QuickDiagnosisCategoryConfig {
  id: QuickDiagnosisCategory;
  title: string;
  description: string;
}

export interface MembershipOffer {
  code: PlanCode;
  name: string;
  price: number;
  audience: string;
  highlighted?: boolean;
  benefits: string[];
}

export interface CreditOffer {
  code: CreditPackCode;
  title: string;
  price: number;
  credits: number;
  description: string;
}

export interface SolutionPurchaseOffer {
  id: "single_solution" | "enterprise_solution";
  title: string;
  price: number;
  description: string;
}

export interface ProjectPackageOffer {
  code: ProjectPackageCode;
  title: string;
  price: number;
  badge: string;
  description: string;
  benefits: string[];
}

export const diagnosisModes: DiagnosisModeConfig[] = [
  {
    id: "quick",
    title: "单项快速诊断",
    subtitle: "8-10分钟完成一个专项经营访谈",
    duration: "约8-10分钟",
    audience: "OPC单人创业者、单店小微商家",
    output: "单项专项诊断简报",
    cta: "选择单项诊断"
  },
  {
    id: "deep",
    title: "全企业系统深度诊断",
    subtitle: "10分钟完成六大经营板块体检",
    duration: "约10分钟",
    audience: "多门店本地商家、连锁品牌、招商加盟企业",
    output: "完整版企业诊断报告",
    cta: "选择深度诊断"
  }
];

export const quickDiagnosisCategories: QuickDiagnosisCategoryConfig[] = [
  {
    id: "short_video_ip",
    title: "IP诊断",
    description: "账号定位、内容信任、私域承接"
  },
  {
    id: "store_acquisition",
    title: "门店获客诊断",
    description: "同城流量、到店转化、复购来源"
  },
  {
    id: "team_management",
    title: "人员管理诊断",
    description: "分工、执行、绩效和老板时间"
  },
  {
    id: "franchise",
    title: "招商诊断",
    description: "线索、招商话术、加盟转化风险"
  },
  {
    id: "revenue",
    title: "营收诊断",
    description: "客流、客单、毛利和盈利缺口"
  }
];

export const membershipOffers: MembershipOffer[] = [
  {
    code: "local_standard",
    name: "按积分使用",
    price: 0,
    audience: "单店商家、个人IP、OPC单人创业者",
    benefits: [
      "不收月度订阅费",
      "注册不赠送积分，按实际使用扣积分",
      "开放首版IP获客智能体",
      "实际执行时按积分扣费"
    ]
  },
  {
    code: "local_premium",
    name: "按积分使用",
    price: 0,
    audience: "多门店本地实体商家",
    highlighted: true,
    benefits: [
      "不收月度订阅费",
      "内容九件套、拍剪优化、视频数据复盘",
      "直播话术、朋友圈私域",
      "支持精美Word下载"
    ]
  },
  {
    code: "chain_premium",
    name: "按积分使用",
    price: 0,
    audience: "连锁品牌、招商加盟企业",
    benefits: [
      "不收月度订阅费",
      "团队可集中测试IP获客输出",
      "统一按积分控制调用成本",
      "不够用再充值积分"
    ]
  }
];

export const solutionPurchaseOffers: SolutionPurchaseOffer[] = [];

export const projectPackageOffers: ProjectPackageOffer[] = [
  {
    code: "local_growth_30",
    title: "本地商家30天AI增长陪跑包",
    price: 6980,
    badge: "推荐方案",
    description: "系统按天拆任务，老师在关键节点讲解和点评，陪你先跑通一个增长场景。",
    benefits: ["30天密集陪跑", "聚焦一个获客/内容/成交场景", "90天系统巩固", "120天内可补做未完成任务"]
  },
  {
    code: "ai_health_express",
    title: "AI增长体检加急解读",
    price: 1980,
    badge: "体检解读",
    description: "适合先把诊断报告讲清楚，确认优先问题和行动顺序。",
    benefits: ["报告人工解读", "优先问题排序", "30天行动建议", "后续升级项目可抵扣"]
  },
  {
    code: "local_growth_90",
    title: "本地商家90天增长启动包",
    price: 16800,
    badge: "高配升级",
    description: "适合定位、内容、成交和复盘一起跑通的客户。",
    benefits: ["90天深度启动", "更完整的增长链路", "阶段复盘", "适合复杂问题客户"]
  }
];

export const creditOffers: CreditOffer[] = [
  {
    code: "pack_50",
    title: "试试看",
    price: 50,
    credits: 1000,
    description: "起充档，零赠送，适合先试一次"
  },
  {
    code: "pack_100",
    title: "够用一阵",
    price: 100,
    credits: 2200,
    description: "默认档，多送 200 积分"
  },
  {
    code: "pack_300",
    title: "常用",
    price: 300,
    credits: 7000,
    description: "多送 1000 积分"
  },
  {
    code: "pack_500",
    title: "重度",
    price: 500,
    credits: 12000,
    description: "多送 2000 积分"
  },
  {
    code: "pack_1000",
    title: "团队年用",
    price: 1000,
    credits: 25000,
    description: "多送 5000 积分，适合团队长期使用"
  }
];

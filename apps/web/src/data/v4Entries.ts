export type V4EntryId = "local" | "franchise";

export interface V4WorkflowStep {
  id: string;
  title: string;
  userSense: string;
  skills: string[];
}

export interface V4Task {
  role: "AI" | "老板" | "团队";
  title: string;
  due: string;
  status: "done" | "doing" | "waiting" | "overdue";
}

export interface V4EntryConfig {
  id: V4EntryId;
  slug: string;
  entryName: string;
  targetUser: string;
  cycleDays: number;
  heroTitle: string;
  heroSubtitle: string;
  cta: string;
  greeting: string;
  startPrompt: string;
  priceLead: string;
  monthlyOffer: string;
  trialCreditsLabel: string;
  creditWarningAt: number;
  rechargeOptions: string[];
  workflow: V4WorkflowStep[];
  kpis: Array<{ key: string; label: string; source: string }>;
  timeline: Array<{ day: string; title: string; focus: string }>;
  tasks: V4Task[];
  skillMapping: Record<string, string[]>;
  csvRequiredFields: string[];
}

const sharedWorkflowTail: V4WorkflowStep[] = [
  {
    id: "supervise",
    title: "监督落地",
    userSense: "思潼把方案拆成 AI、老板、团队三类任务，按时间推进。",
    skills: ["supervision-scheduler"]
  },
  {
    id: "review",
    title: "数据复盘",
    userSense: "上传短视频、直播或销售数据后，思潼自动出周报。",
    skills: ["video-review-engine", "baolu-live-review-engine", "sales-funnel-review", "store-visit-review"]
  },
  {
    id: "rediagnose",
    title: "再诊断",
    userSense: "复盘后只追问红灯维度，不让用户重复填基础信息。",
    skills: ["customer-acquisition-diagnosis"]
  }
];

export const v4Entries: Record<V4EntryId, V4EntryConfig> = {
  local: {
    id: "local",
    slug: "local",
    entryName: "本地商家入口",
    targetUser: "本地高客单服务商、餐饮、美业、零售、教培门店",
    cycleDays: 14,
    heroTitle: "思潼，帮本地商家 14 天跑通获客到成交",
    heroSubtitle: "前 7 天跑通定位、内容、引流钩子和私信承接；第 7 天复盘下一轮怎么调；第 8-14 天根据真实反馈继续优化。",
    cta: "免费诊断我的门店",
    greeting: "你好，我是思潼，能帮你做获客和成交。先聊聊你的情况：你做什么品类，开在哪，现在每天大概多少客人？",
    startPrompt: "我想做本地获客，请先帮我做获客成交链路体检。",
    priceLead: "首月体验价",
    monthlyOffer: "199 元 / 首月",
    trialCreditsLabel: "新用户体验积分：待定",
    creditWarningAt: 50,
    rechargeOptions: ["100 元 = 200 积分", "200 元 = 500 积分"],
    workflow: [
      {
        id: "diagnose",
        title: "链路体检",
        userSense: "思潼先问清门店、流量、内容、私信、到店转化。",
        skills: ["customer-acquisition-diagnosis", "ip-positioning"]
      },
      {
        id: "deliver",
        title: "交付方案",
        userSense: "输出主页文案、14 天内容计划、私信承接话术。",
        skills: ["baolu-content-creator", "moments-generator", "sales-growth-advisor"]
      },
      ...sharedWorkflowTail
    ],
    kpis: [
      { key: "exposure", label: "同城曝光量", source: "用户手动输入或 CSV 上传" },
      { key: "consultation", label: "私信咨询数", source: "用户手动输入" },
      { key: "visitRate", label: "到店转化率", source: "咨询数 / 到店数" },
      { key: "avgPrice", label: "客单价", source: "用户输入" },
      { key: "repurchase", label: "复购率", source: "用户输入" },
      { key: "referral", label: "转介绍数", source: "用户输入" }
    ],
    timeline: [
      { day: "Day 0", title: "链路体检", focus: "找出红灯卡点，确认 14 天目标" },
      { day: "Day 1", title: "主页与钩子", focus: "改主页四件套，确定团购/到店礼" },
      { day: "Day 2-3", title: "内容九件套", focus: "生成 3 条短视频脚本和朋友圈承接" },
      { day: "Day 4-5", title: "私信话术", focus: "问价、问地址、犹豫不来三类话术" },
      { day: "Day 7", title: "第一次复盘", focus: "用真实播放、私信、到店数据调下一轮" },
      { day: "Day 8-14", title: "继续迭代", focus: "补短板，做第二轮内容和成交跟进" }
    ],
    tasks: [
      { role: "AI", title: "生成获客成交链路体检报告", due: "今天", status: "doing" },
      { role: "老板", title: "确认主推品类和到店钩子", due: "今天 20:00", status: "waiting" },
      { role: "AI", title: "输出 3 条短视频九件套", due: "明天 09:00", status: "waiting" },
      { role: "团队", title: "记录每条内容的播放、私信、到店数据", due: "每天收口", status: "waiting" },
      { role: "老板", title: "第 7 天上传数据并选择下一轮方向", due: "Day 7", status: "waiting" }
    ],
    skillMapping: {
      diagnose: ["customer-acquisition-diagnosis", "ip-positioning"],
      acquire: ["baolu-content-creator", "moments-generator", "baolu-ad-manager"],
      close: ["sales-growth-advisor", "live-script-planner"],
      supervise: ["supervision-scheduler"],
      review: ["video-review-engine", "baolu-live-review-engine", "store-visit-review"]
    },
    csvRequiredFields: ["date", "views", "messages", "visits", "orders"]
  },
  franchise: {
    id: "franchise",
    slug: "franchise",
    entryName: "连锁品牌入口",
    targetUser: "连锁加盟品牌创始人、招商负责人、直营样板店负责人",
    cycleDays: 30,
    heroTitle: "思潼，帮连锁品牌跑通直营样板店与招商成交",
    heroSubtitle: "一轨看直营店获客和单店模型，一轨看招商内容、线索、跟进、到司和签约漏斗。",
    cta: "诊断我的招商链路",
    greeting: "你好，我是思潼，能帮你做两件事：一是直营样板店的本地获客和成交，二是招商体系的获客和签约。先说说你现在多少家店，最近 90 天新增了几个加盟商？",
    startPrompt: "我想做连锁招商，请先帮我做直营样板店和招商成交双轨体检。",
    priceLead: "月度陪跑",
    monthlyOffer: "3980 元 / 月",
    trialCreditsLabel: "新用户体验积分：待定",
    creditWarningAt: 100,
    rechargeOptions: ["500 元 = 800 积分", "1000 元 = 2000 积分"],
    workflow: [
      {
        id: "diagnose",
        title: "双轨体检",
        userSense: "思潼同时看直营样板店获客和招商成交漏斗。",
        skills: ["customer-acquisition-diagnosis", "franchise-recruitment-system", "franchise-compliance-checker"]
      },
      {
        id: "deliver",
        title: "招商交付",
        userSense: "输出招商内容矩阵、投资回报卡、线索跟进话术。",
        skills: ["baolu-content-creator", "sales-growth-advisor", "brand-consultant"]
      },
      ...sharedWorkflowTail
    ],
    kpis: [
      { key: "leadCount", label: "招商线索数", source: "用户输入或 CSV 上传" },
      { key: "qualifiedLead", label: "有效意向数", source: "线索分级" },
      { key: "visitCount", label: "到司考察数", source: "跟进表" },
      { key: "signedCount", label: "签约数", source: "销售漏斗" },
      { key: "conversionRate", label: "签约转化率", source: "签约数 / 线索数" },
      { key: "leadCost", label: "单客获取成本", source: "费用 / 线索数" }
    ],
    timeline: [
      { day: "Day 0", title: "双轨体检", focus: "确认样板店模型和招商漏斗红灯" },
      { day: "Day 1-3", title: "单店模型表达", focus: "投资额、回本、利润、支持体系讲清楚" },
      { day: "Day 4-7", title: "招商内容矩阵", focus: "创始人 IP、加盟商故事、行业观点" },
      { day: "Day 8-14", title: "线索承接", focus: "首聊、资料包、邀约到司、异议处理" },
      { day: "Day 15-21", title: "漏斗复盘", focus: "看线索到签约各环节哪里漏" },
      { day: "Day 22-30", title: "第二轮放大", focus: "根据数据修内容、话术和招商政策" }
    ],
    tasks: [
      { role: "AI", title: "生成直营 + 招商双轨体检报告", due: "今天", status: "doing" },
      { role: "老板", title: "确认单店模型三组核心数据", due: "今天 20:00", status: "waiting" },
      { role: "AI", title: "输出 5 条招商内容脚本", due: "明天 12:00", status: "waiting" },
      { role: "团队", title: "把现有线索按 A/B/C 分级", due: "3 天内", status: "waiting" },
      { role: "老板", title: "第 15 天上传招商漏斗数据", due: "Day 15", status: "waiting" }
    ],
    skillMapping: {
      diagnose: ["customer-acquisition-diagnosis", "franchise-recruitment-system", "franchise-compliance-checker"],
      acquire: ["baolu-content-creator", "baolu-ad-manager", "digital-twin-factory"],
      close: ["sales-growth-advisor", "franchise-recruitment-system", "brand-consultant"],
      supervise: ["supervision-scheduler"],
      review: ["video-review-engine", "baolu-live-review-engine", "sales-funnel-review"]
    },
    csvRequiredFields: ["date", "leads", "qualified", "visits", "signed"]
  }
};

export const v4EntryList = Object.values(v4Entries);

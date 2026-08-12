import { useEffect, useMemo, useState } from "react";
import sitongChiefAvatar from "../assets/sitong-beauty.png";
import {
  FREE_TRIAL_CREDITS,
  creditOffers,
  diagnosisModes,
  membershipOffers,
  quickDiagnosisCategories,
  type DiagnosisMode,
  type QuickDiagnosisCategory
} from "../data/growthFlywheel";
import { v4Entries } from "../data/v4Entries";
import { apiPath, getAppPath } from "../lib/api.js";

type Stage = "form" | "generating" | "report" | "solution" | "implementation";
type RiskLevel = "低风险" | "中风险" | "高风险";
type ScoreStatus = "红灯" | "黄灯" | "绿灯";
type TaskStatus = "pending" | "review" | "done" | "remind";
type TaskOwner = "思潼AI" | "用户" | "团队";
type ReminderStatus = "active" | "done";

interface BaseProfile {
  businessName: string;
  role: "OPC单人创业者" | "本地单店商家" | "多门店/连锁品牌";
  industry: string;
  city: string;
  monthlyRevenue: string;
}

interface ReportScore {
  dimension: string;
  score: number;
  status: ScoreStatus;
  evidence: string;
}

interface DiagnosisReport {
  title: string;
  mode: DiagnosisMode;
  categoryLabel?: string;
  summary: string;
  businessStatus: string[];
  currentLeaks: string[];
  profitGap: string;
  potentialRisks: string[];
  industryGap: string[];
  riskLevel: RiskLevel;
  weaknessTags: string[];
  scores: ReportScore[];
  missingData: string[];
}

interface SolutionTask {
  id: string;
  owner: TaskOwner;
  title: string;
  detail: string;
  outputHint?: string;
}

interface SolutionDay {
  day: number;
  theme: string;
  goal: string;
  aiTasks: SolutionTask[];
  userTasks: SolutionTask[];
  teamTasks: SolutionTask[];
  checkMetric: string;
}

interface LandingSolution {
  id: string;
  title: string;
  mode?: DiagnosisMode;
  category?: QuickDiagnosisCategory;
  profileSnapshot?: BaseProfile;
  source: string;
  cycleDays: number;
  summary: string;
  firstLevel: string;
  painPointMappings: Array<{ pain: string; asset: string; result: string }>;
  executionFlow: string[];
  templates: Array<{ title: string; content: string }>;
  roles: Array<{ owner: TaskOwner; responsibility: string }>;
  unlockedCapabilities: string[];
  growthTargets: string[];
  timeline: SolutionDay[];
  adjustments: string[];
  confirmed: boolean;
  createdAt: string;
}

interface TaskReminder {
  id: string;
  taskId: string;
  taskTitle: string;
  owner: TaskOwner;
  day: number;
  dayTheme: string;
  dueLabel: string;
  status: ReminderStatus;
  createdAt: string;
}

interface IpPositioningQuestion {
  key: string;
  title: string;
  prompt: string;
  empathy: string;
  capture: string;
}

interface IpPositioningInterviewState {
  started: boolean;
  completed: boolean;
  currentIndex: number;
  draft: string;
  answers: Record<string, string>;
}

interface AiOutputAdjustmentReview {
  feedback: string;
  decision: "recommend_adjust" | "recommend_keep";
  focus: string;
  analysis: string;
  recommendation: string;
  proposedOutput: string;
  createdAt: string;
}

interface SkillInvokeResponse {
  status?: string;
  message?: string;
  error?: string;
  result?: {
    skillId?: string;
    skillVersion?: string;
    answer?: string;
    qualityFlags?: string[];
  };
}

interface InterviewQuestion {
  key: string;
  title: string;
  prompt: string;
  empathy: string;
  why: string;
  afterAnswer: string;
  probes: string[];
  dataPoints: string[];
  riskSignals: string[];
}

const latestReportKey = "sitong_latest_diagnosis_report";
const latestSolutionKey = "sitong_latest_landing_solution";
const latestAiOutputsKey = "sitong_latest_ai_outputs";
const latestAiOutputVersionsKey = "sitong_latest_ai_output_versions";
const latestTaskStatusKey = "sitong_latest_task_status";
const latestTaskRemindersKey = "sitong_latest_task_reminders";
const latestIpPositioningInterviewsKey = "sitong_latest_ip_positioning_interviews";
const latestAiOutputAdjustmentReviewsKey = "sitong_latest_ai_output_adjustment_reviews";

const baseProfileDefault: BaseProfile = {
  businessName: "",
  role: "本地单店商家",
  industry: "",
  city: "",
  monthlyRevenue: ""
};

const profileInterviewQuestion: InterviewQuestion = {
  key: "profile",
  title: "基础画像",
  prompt: "先轻松说一下：你做什么生意，在哪个城市，月营收大概多少？不用精确，说个范围就行。",
  empathy: "老板不用紧张，这不是填资料，就是让我先知道你站在哪个经营阶段。",
  why: "我先确认基础画像，是为了后面判断风险时不拿错行业和体量做对标。",
  afterAnswer: "好，我先记下你的业务画像。后面我会按这个体量和行业来判断，不会用泛泛模板套你。",
  probes: ["品牌/门店", "行业品类", "城市/商圈", "月营收范围", "门店/团队规模"],
  dataPoints: ["城市", "行业", "月营收", "门店数", "团队人数"],
  riskSignals: ["体量说不清", "营收口径不稳定", "基础数据长期没人记录"]
};

const ipPositioningInterviewQuestions: IpPositioningQuestion[] = [
  {
    key: "role_adaptation",
    title: "角色和业务类型",
    prompt: "你好，我是思潼。先确认一下：你是老板本人，还是帮老板做运营的操盘手？你们现在是单店、多店，还是连锁/招商品牌？",
    empathy: "这不是身份审查，是为了决定方案深度。老板本人、操盘手、单店和连锁，IP定位的打法完全不一样。",
    capture: "用户角色、业务类型、方案深度"
  },
  {
    key: "project_foundation",
    title: "项目基础",
    prompt: "先说说你的项目吧：叫什么名字，做什么的，赚谁的钱、怎么赚？现在大概做到什么阶段了？",
    empathy: "你不用讲得像商业计划书，像聊天一样说就行。定位先落到真实生意上，后面的主页和脚本才不会飘。",
    capture: "项目名称、赛道产品、赚钱方式、当前阶段"
  },
  {
    key: "competition",
    title: "竞争格局",
    prompt: "跟你最较劲的竞争对手是谁？客户为什么会拿你和他们比？你真实能做到、但对方不一定做到的地方是什么？",
    empathy: "不用贬低同行。我们只找能被证据撑住的不同点，能证明的差异化才会变成信任。",
    capture: "竞品、差异化、客户选择理由"
  },
  {
    key: "target_customer",
    title: "目标用户",
    prompt: "你的客户长什么样？最典型的一类人是谁，他们最痛苦的事是什么，从看到你到成交中间通常怎么走？",
    empathy: "先聚焦一类人不是放弃其他客户，而是让第一眼刷到你的人更快知道：这个账号就是在说我。",
    capture: "客户画像、痛点、决策路径、真实案例"
  },
  {
    key: "founder_goal",
    title: "创始人和目标",
    prompt: "再说说你本人：你的背景、经历、性格和真实故事是什么？做这个IP的核心目标是获客、招商、成交，还是品牌信任？",
    empathy: "IP不是演一个完美人设，而是把你真实可信的那部分放大。越像本人，后面执行越不累。",
    capture: "老板背景、性格故事、商业目标、信任证据"
  },
  {
    key: "ip_current_state",
    title: "IP现状和能力",
    prompt: "最后看你现在的基础：在哪些平台有账号，粉丝和内容数据大概怎样？团队、预算、每周可投入时间怎么样？最大的卡点在哪？",
    empathy: "定位必须能落地。这里不是考你资源多不多，而是避免给你一个看起来高级、实际执行不了的定位。",
    capture: "账号数据、团队资源、预算时间、最大卡点"
  }
];

const quickQuestionMap: Record<QuickDiagnosisCategory, InterviewQuestion[]> = {
  short_video_ip: [
    {
      key: "ip_offer",
      title: "定位和信任",
      prompt: "老板，我先看账号定位。你现在主卖什么？你平时会怎么介绍自己和产品？",
      empathy: "账号做不起来时，很多老板不是不努力，是用户第一眼没看懂你值在哪。",
      why: "我先问定位和信任，是因为流量差很多时候不是内容少，而是客户没有形成明确记忆点。",
      afterAnswer: "收到，这里我会先判断你的身份、产品和信任理由有没有被用户一眼看见。",
      probes: ["主推产品/服务", "客户信任理由", "老板或品牌身份", "和同行的差别"],
      dataPoints: ["主页介绍", "主推产品价格", "近30天爆款/低迷内容"],
      riskSignals: ["卖点说不清", "内容只有环境展示", "用户不知道下一步找谁"]
    },
    {
      key: "content_data",
      title: "内容数据",
      prompt: "近30天你能回忆出几组数据：播放、完播、私信、加微、成交大概分别是多少？",
      empathy: "别担心，数据不完整很正常，很多门店都是先凭感觉做内容。",
      why: "我问这组数，是为了分清是内容前端没人看，还是后端承接没接住。",
      afterAnswer: "好，我会把播放、私信、加微和成交分开看，不会只用播放量判断好坏。",
      probes: ["播放稳定性", "完播/互动", "私信和加微", "内容带来的成交"],
      dataPoints: ["近30天发布条数", "平均播放", "最高播放", "私信/加微数"],
      riskSignals: ["只看播放不看咨询", "没有加微统计", "不知道哪条内容带客"]
    },
    {
      key: "customer_objection",
      title: "客户顾虑",
      prompt: "客户看完内容后，最常问什么？价格、位置、效果、停车、排队，哪个最卡？",
      empathy: "客户问完不买最磨人，但这些顾虑其实正好能反推内容和话术的漏洞。",
      why: "我问顾虑，是为了找出用户心里没被你提前解释掉的那一块。",
      afterAnswer: "明白，这一轮我会重点看顾虑是不是提前出现在内容和私信承接里。",
      probes: ["高频提问", "成交顾虑", "评论区反馈", "私信流失点"],
      dataPoints: ["常见问题前三名", "咨询未成交原因", "评论/私信截图口径"],
      riskSignals: ["问价后沉默", "只点赞不咨询", "顾虑没人统一回复"]
    },
    {
      key: "private_domain",
      title: "承接链路",
      prompt: "流量来了以后，谁负责承接？怎么从私信推进到加微、到店或成交？",
      empathy: "很多老板以为是流量不够，其实最可惜的是流量来了以后悄悄漏掉。",
      why: "我问承接，是为了判断账号后面有没有一条能成交的路。",
      afterAnswer: "收到，我会把回复速度、下一步动作和成交承接分开判断。",
      probes: ["回复速度", "标准话术", "加微动作", "到店邀约"],
      dataPoints: ["平均回复时长", "加微率", "到店率", "成交率"],
      riskSignals: ["店员临场回复", "没有下一步动作", "私域无人维护"]
    }
  ],
  store_acquisition: [
    {
      key: "source_mix",
      title: "新客来源",
      prompt: "我先看客人从哪来。最近30天新客主要来自同城平台、老客转介绍、路过自然客，分别大概占多少？",
      empathy: "门店最怕的不是今天没客人，而是不知道客人为什么来、为什么不来。",
      why: "先问来源，是为了判断你现在靠自然运气，还是有可复制的获客入口。",
      afterAnswer: "好，我会先看新客来源是不是过于单一，以及有没有可放大的入口。",
      probes: ["渠道占比", "自然客", "平台流量", "转介绍"],
      dataPoints: ["近30天新客数", "渠道来源", "获客成本"],
      riskSignals: ["来源单一", "只靠路过", "不知道客户从哪来"]
    },
    {
      key: "funnel_numbers",
      title: "获客漏斗",
      prompt: "我们看一条链路：曝光、咨询、到店、成交、复购，你哪一段数字最弱或最不清楚？",
      empathy: "不用一次拿出完美数据，大概数也有价值，至少能先找出漏水点。",
      why: "我问漏斗，是为了避免把所有问题都误判成“没流量”。",
      afterAnswer: "收到，我会按曝光、咨询、到店、成交、复购拆开判断，不混成一个问题。",
      probes: ["曝光", "咨询", "到店", "成交", "复购"],
      dataPoints: ["曝光/咨询/到店/成交", "复购人数", "转介绍人数"],
      riskSignals: ["有咨询不到店", "到店不成交", "成交后不复购"]
    },
    {
      key: "hook",
      title: "到店钩子",
      prompt: "现在有没有让客户立刻来的理由？比如团购品、体验品、到店礼或转介绍奖励。",
      empathy: "客户不行动不一定是不喜欢你，很多时候只是缺一个现在来的理由。",
      why: "我问钩子，是为了判断流量能不能被及时转成到店动作。",
      afterAnswer: "明白，我会看这个钩子是不是既能吸引客户，又不会把利润打穿。",
      probes: ["主推品", "到店利益点", "团购核销", "转介绍"],
      dataPoints: ["核销率", "活动成交率", "客单价变化"],
      riskSignals: ["只有打折", "钩子和利润款脱节", "活动没有复盘"]
    },
    {
      key: "followup",
      title: "咨询承接",
      prompt: "客户咨询后，谁跟进？多久回复？有没有问价、问地址、犹豫不来的统一话术？",
      empathy: "咨询来了没成交很心疼，这里往往不是员工不用心，而是没有统一承接方法。",
      why: "我问跟进，是为了判断客户热度有没有在回复过程中掉下去。",
      afterAnswer: "好，这里我会重点看负责人、回复速度和二次跟进有没有形成闭环。",
      probes: ["负责人", "回复速度", "话术", "二次跟进"],
      dataPoints: ["平均响应时间", "二次跟进比例", "未成交原因"],
      riskSignals: ["没人追", "只回复价格", "没有二次触达"]
    }
  ],
  team_management: [
    {
      key: "roles",
      title: "岗位分工",
      prompt: "团队现在几个人？每个岗位每天最核心的产出是什么，谁对结果负责？",
      empathy: "老板累很多时候不是能力问题，是所有责任最后都回到你身上。",
      why: "我问岗位，是为了判断团队有没有从“有人在忙”变成“有人对结果负责”。",
      afterAnswer: "收到，我会把岗位、产出和责任人拆开看，判断老板是不是被过度消耗。",
      probes: ["岗位", "负责人", "每日产出", "检查人"],
      dataPoints: ["人数", "岗位清单", "日目标"],
      riskSignals: ["老板兜底", "岗位边界不清", "没人对结果负责"]
    },
    {
      key: "owner_time",
      title: "老板时间",
      prompt: "你每天最容易被哪些事拖住？这些事是必须你做，还是没人接所以你在做？",
      empathy: "你被琐事拖住这件事很关键，因为老板的时间本身就是企业最贵的资源。",
      why: "我问老板时间，是为了找出哪些事可以交给系统、团队或SOP。",
      afterAnswer: "明白，我会判断哪些是必须由你拍板，哪些其实是组织机制缺口。",
      probes: ["高频打断", "决策事项", "可授权事项", "时间消耗"],
      dataPoints: ["老板每日被占用时长", "重复事项", "授权失败点"],
      riskSignals: ["老板离不开", "店长不敢决策", "小事反复找老板"]
    },
    {
      key: "management_rhythm",
      title: "管理节奏",
      prompt: "现在有没有日清、周会、绩效、培训或检查表？有的话简单说说怎么做，没做也直接说没有。",
      empathy: "有管理动作但没结果特别消耗人，说明不是没管，而是节奏和指标没咬住。",
      why: "我问管理节奏，是为了判断团队执行能不能被稳定看见和纠偏。",
      afterAnswer: "好，我会看这些动作是推动结果，还是只是在消耗会议和表格。",
      probes: ["日清", "周会", "绩效", "培训", "检查表"],
      dataPoints: ["会议频率", "检查表", "奖惩口径"],
      riskSignals: ["只开会不追结果", "绩效和经营目标脱节", "培训后没人检查"]
    },
    {
      key: "breakpoint",
      title: "执行掉线",
      prompt: "最近一个月最容易掉链子的场景是什么？比如服务、销售、卫生、内容、跟进，造成了什么损失？",
      empathy: "反复掉同一个链子最让老板憋屈，但它也最适合先做系统化修复。",
      why: "我问掉线场景，是为了找到第一关最该先补的执行漏洞。",
      afterAnswer: "收到，我会把这个场景作为团队执行风险的核心证据。",
      probes: ["掉线场景", "频率", "损失", "责任归因"],
      dataPoints: ["客诉", "漏跟进", "损耗", "返工次数"],
      riskSignals: ["反复同一问题", "责任不清", "没有复盘"]
    }
  ],
  franchise: [
    {
      key: "store_model",
      title: "单店模型",
      prompt: "先看样板店。现在直营和加盟各多少家？你手里大概有投资、回本、毛利和月营收这些数吗？",
      empathy: "招商难不一定是招商团队弱，很多时候是样板店模型还没被讲清楚。",
      why: "我问单店模型，是为了判断加盟商凭什么相信这个项目能复制。",
      afterAnswer: "好，我会先看你的样板店数据能不能支撑招商信任。",
      probes: ["门店数", "投资额", "回本周期", "单店利润"],
      dataPoints: ["直营/加盟数量", "样板店数据", "毛利和回本"],
      riskSignals: ["单店模型讲不清", "只讲品牌不讲回本", "样板店数据缺失"]
    },
    {
      key: "franchise_funnel",
      title: "招商漏斗",
      prompt: "最近90天招商漏斗是多少：线索、有效意向、到司、签约，各是多少？",
      empathy: "招商最怕看起来线索不少，最后签约很少，这中间一定有漏点。",
      why: "我问漏斗，是为了分清是线索质量、邀约到司，还是临门签约出了问题。",
      afterAnswer: "收到，我会按线索、有效意向、到司、签约逐段判断。",
      probes: ["线索", "有效意向", "到司", "签约"],
      dataPoints: ["线索量", "到司率", "签约率", "单线索成本"],
      riskSignals: ["有线索不到司", "到司不签", "线索不分级"]
    },
    {
      key: "trust_objection",
      title: "加盟信任",
      prompt: "加盟商最常问的顾虑是什么？回本、选址、获客、培训、供应链，哪个最难回答？",
      empathy: "加盟商反复问顾虑不是挑刺，是他还没有看到足够确定的安全感。",
      why: "我问顾虑，是为了判断招商材料有没有提前解除风险感。",
      afterAnswer: "明白，我会把这些顾虑放进行业信任差距里判断。",
      probes: ["高频顾虑", "总部回应", "资料包", "案例"],
      dataPoints: ["顾虑TOP3", "资料包完整度", "案例数量"],
      riskSignals: ["承诺大于交付", "缺少真实案例", "政策讲不清"]
    },
    {
      key: "training_delivery",
      title: "培训督导",
      prompt: "加盟商签完以后，总部怎么培训、督导和纠偏？有没有作业、考试、巡店或数据回传？",
      empathy: "很多品牌前端招商很用力，后端交付跟不上，最后口碑会反噬总部。",
      why: "我问培训督导，是为了判断招商承诺能不能真的落到门店结果。",
      afterAnswer: "收到，我会看总部支持是不是有标准动作和数据回传。",
      probes: ["培训", "督导", "巡店", "数据回传"],
      dataPoints: ["培训周期", "督导频率", "加盟商成活率"],
      riskSignals: ["重招商轻交付", "开店后没人管", "加盟商数据回不来"]
    }
  ],
  revenue: [
    {
      key: "revenue_trend",
      title: "营收趋势",
      prompt: "最近3个月营收、客流、客单价、毛利率大概怎么变？不知道毛利也没关系，先说你记得的数。",
      empathy: "营收压力很容易让人焦虑，我们先不急着找办法，先把钱到底漏在哪看清楚。",
      why: "我问趋势，是为了区分是客流问题、客单问题，还是毛利和成本问题。",
      afterAnswer: "好，我会把流水和利润分开看，不会只用营业额判断经营好坏。",
      probes: ["营收", "客流", "客单", "毛利"],
      dataPoints: ["3个月营收", "客单价", "毛利率", "现金流"],
      riskSignals: ["只看流水", "毛利不清", "下滑没归因"]
    },
    {
      key: "cost_pressure",
      title: "成本压力",
      prompt: "房租、人工、投流、原料或履约成本里，哪一项最压利润？有没有每周看？",
      empathy: "成本压利润这件事很隐蔽，很多店不是不赚钱，是利润被一点点吃掉了。",
      why: "我问成本，是为了判断哪些费用已经影响到现金流安全。",
      afterAnswer: "明白，我会把固定成本和变动成本分开判断。",
      probes: ["固定成本", "变动成本", "投流成本", "履约成本"],
      dataPoints: ["房租", "人工", "原料", "投流", "物流"],
      riskSignals: ["成本口径混乱", "投流不算ROI", "原料涨价没同步定价"]
    },
    {
      key: "product_profit",
      title: "产品利润",
      prompt: "你现在卖得最多的产品是什么？你觉得最赚钱、最容易让客户复购的产品分别是什么？",
      empathy: "产品卖得多但不赚钱也很常见，这不是产品不好，是结构没分层。",
      why: "我问产品分层，是为了看你的营收是不是越忙越薄。",
      afterAnswer: "收到，我会看引流款、利润款和复购款有没有各司其职。",
      probes: ["引流款", "利润款", "复购款", "套餐结构"],
      dataPoints: ["SKU毛利", "销量", "复购率", "连带率"],
      riskSignals: ["爆品不赚钱", "利润款卖不动", "没有产品分层"]
    },
    {
      key: "dashboard",
      title: "经营看板",
      prompt: "你每周会固定看哪些数字？比如收入、客流、成本、利润、库存，没固定看也直接说没有。",
      empathy: "没有看板时，老板只能靠直觉扛压力，这会非常累。",
      why: "我问看板，是为了判断你的经营能不能进入周期复盘，而不是每天救火。",
      afterAnswer: "好，我会把数据缺口列进报告，这会影响后续复盘准确度。",
      probes: ["周报", "看板", "复盘", "责任人"],
      dataPoints: ["周复盘频率", "关键指标", "负责人"],
      riskSignals: ["靠感觉决策", "数据没人填", "复盘没有下一步"]
    }
  ]
};

const quickDepthFollowupMap: Record<QuickDiagnosisCategory, InterviewQuestion[]> = {
  short_video_ip: [
    {
      key: "homepage_audit",
      title: "主页四件套",
      prompt: "我再核一遍主页：你的头像、昵称、简介、置顶视频和私信入口现在分别是什么样？记不清就挑记得的说。",
      empathy: "主页不是装修门面那么简单，它决定客户看完视频后会不会继续相信你。",
      why: "这一轮是做账号入口体检，判断用户刷到你以后有没有清晰的下一步。",
      afterAnswer: "收到，我会把主页入口单独列成风险，不再笼统归到内容问题。",
      probes: ["头像", "昵称", "简介", "置顶", "私信入口"],
      dataPoints: ["主页访问", "私信数", "置顶视频播放", "主页转化率"],
      riskSignals: ["主页看不懂", "置顶不承接", "没有明确私信口令"]
    },
    {
      key: "content_matrix",
      title: "内容矩阵",
      prompt: "你最近发的视频主要拍什么？比如环境、产品、案例、老板出镜、客户反馈，想到几类说几类。",
      empathy: "视频发了很多但没结果，通常不是勤奋不够，而是内容结构没有承担不同任务。",
      why: "我要判断内容是不是只有曝光型，没有信任型和转化型。",
      afterAnswer: "好，我会按曝光、信任、转化三类内容判断结构缺口。",
      probes: ["环境展示", "痛点教育", "案例", "人设", "产品效果"],
      dataPoints: ["各类视频占比", "爆款来源", "咨询来源内容"],
      riskSignals: ["只拍环境", "没有案例", "没有转化内容"]
    },
    {
      key: "conversion_evidence",
      title: "转化证据",
      prompt: "客户真正决定咨询前，最需要看到什么证据？案例、价格、效果、老板专业度，还是门店真实反馈？",
      empathy: "客户不是不信你，是他还没看到足够让他敢行动的证据。",
      why: "这一轮用来判断内容缺的是流量，还是成交前的信任证据。",
      afterAnswer: "明白，我会把关键证据口径写进报告，后面方案再对应生成素材。",
      probes: ["客户案例", "效果证明", "价格解释", "老板专业度", "真实反馈"],
      dataPoints: ["案例数量", "评价截图", "成交前高频问题"],
      riskSignals: ["没有可展示案例", "承诺多证据少", "客户只围观不行动"]
    },
    {
      key: "review_rhythm",
      title: "复盘节奏",
      prompt: "你多久复盘一次内容？会不会固定看哪条带来私信、哪条带来加微、哪条只是播放高？",
      empathy: "只看播放量很容易误判，真正重要的是内容有没有带来下一步动作。",
      why: "这一轮决定报告里要不要标记为内容复盘能力不足。",
      afterAnswer: "收到，我会把复盘口径和数据缺口拆出来，不只说内容质量。",
      probes: ["复盘频率", "私信来源", "加微来源", "播放和成交差异"],
      dataPoints: ["周复盘", "内容带客表", "私信/加微来源"],
      riskSignals: ["只看播放", "不追内容来源", "没有复盘记录"]
    }
  ],
  store_acquisition: [
    {
      key: "entry_offer",
      title: "进店理由",
      prompt: "你现在有没有团购、体验品、到店礼、预约礼或转介绍奖励？有就说内容，没有也直接说没有。",
      empathy: "客户拖着不来很正常，他需要一个足够明确、足够安全的行动理由。",
      why: "这能判断获客链路是不是缺少把兴趣变成到店的触发器。",
      afterAnswer: "好，我会把到店触发力作为单独漏洞判断。",
      probes: ["体验品", "到店礼", "团购", "预约理由", "利润边界"],
      dataPoints: ["核销率", "预约率", "到店率", "活动毛利"],
      riskSignals: ["只会打折", "到店理由弱", "活动伤利润"]
    },
    {
      key: "consult_loss",
      title: "咨询流失",
      prompt: "最近10个咨询没到店的客户，大概是因为什么走掉？价格、距离、犹豫、没回复，还是没被继续跟进？",
      empathy: "客户流失不一定是产品不行，很多时候是某一句话、某一次慢回复把热度放掉了。",
      why: "我要找到咨询到到店之间最具体的漏点。",
      afterAnswer: "明白，我会把未到店原因和承接风险拆开写。",
      probes: ["问价", "问地址", "回复速度", "二次跟进", "未到店原因"],
      dataPoints: ["咨询数", "到店数", "未到店原因TOP3"],
      riskSignals: ["只回复价格", "没人二次跟进", "未到店原因不记录"]
    },
    {
      key: "repeat_referral",
      title: "复购转介绍",
      prompt: "老客复购和转介绍现在靠自然发生，还是有固定提醒、权益、回访和记录？",
      empathy: "新客贵的时候，老客复购和转介绍就是最容易被忽略的利润池。",
      why: "这能判断获客是否完全依赖新增流量。",
      afterAnswer: "收到，我会把复购和转介绍是否系统化列进报告。",
      probes: ["复购", "转介绍", "回访", "权益", "客户标签"],
      dataPoints: ["复购率", "转介绍数", "回访频率"],
      riskSignals: ["只靠自然复购", "老客没人维护", "转介绍没有机制"]
    },
    {
      key: "channel_roi",
      title: "渠道ROI",
      prompt: "你记得哪些获客渠道的大概账？比如花了多少钱、来了多少咨询、到店多少、成交多少，记得多少说多少。",
      empathy: "钱花出去没结果最难受，先把账算清楚，才知道该停哪一个、留哪一个。",
      why: "这一轮判断你有没有渠道级经营账。",
      afterAnswer: "好，我会把渠道ROI不清作为行业差距或风险项。",
      probes: ["投流", "平台", "团购", "自然客", "转介绍"],
      dataPoints: ["费用", "咨询", "到店", "成交", "客单"],
      riskSignals: ["只看曝光", "不知道渠道成本", "无法判断渠道好坏"]
    }
  ],
  team_management: [
    {
      key: "role_output",
      title: "岗位产出",
      prompt: "每个岗位每天有没有一个必须交付的结果？比如咨询数、跟进数、好评数、成交数、巡检数。",
      empathy: "员工忙不代表岗位有效，老板要看到的是岗位到底产出了什么。",
      why: "这一轮判断团队是不是有岗位产出标准。",
      afterAnswer: "收到，我会把岗位产出不清作为团队管理漏洞。",
      probes: ["岗位目标", "每日结果", "负责人", "检查人"],
      dataPoints: ["岗位KPI", "日清表", "检查频率"],
      riskSignals: ["只看态度", "不看产出", "没人检查结果"]
    },
    {
      key: "training_copy",
      title: "培训复制",
      prompt: "新人上手靠谁带？有没有标准话术、服务流程、考核题和上岗标准？",
      empathy: "新人反复教不会，通常不是人笨，是训练材料和检查机制不够清楚。",
      why: "这能判断团队能力能不能复制，而不是依赖老员工经验。",
      afterAnswer: "好，我会把培训复制能力作为团队稳定性的证据。",
      probes: ["新人培训", "话术", "SOP", "考试", "上岗标准"],
      dataPoints: ["培训周期", "通过率", "返工次数"],
      riskSignals: ["口口相传", "新人靠感觉", "没有上岗标准"]
    },
    {
      key: "incentive_link",
      title: "奖惩挂钩",
      prompt: "现在绩效和奖惩是挂在过程动作上，还是挂在经营结果上？员工知道怎么多拿钱吗？",
      empathy: "员工没动力不一定是懒，很多时候是不知道做什么能真正影响收入。",
      why: "这一轮判断绩效是否和经营目标脱节。",
      afterAnswer: "明白，我会把激励口径和经营结果的关系写进报告。",
      probes: ["绩效", "提成", "奖惩", "过程动作", "结果指标"],
      dataPoints: ["提成规则", "绩效表", "达成率"],
      riskSignals: ["奖惩模糊", "只罚不奖", "绩效和利润无关"]
    },
    {
      key: "manager_layer",
      title: "店长层",
      prompt: "如果你一天不在店里，谁能替你发现问题、安排动作、检查结果？",
      empathy: "老板离不开店，不代表你不努力，很多时候是中间管理层还没长出来。",
      why: "这一轮判断组织是否具备离开老板也能运转的基础。",
      afterAnswer: "收到，我会把店长层能力作为老板时间风险的核心证据。",
      probes: ["店长", "授权", "巡检", "问题处理", "结果复盘"],
      dataPoints: ["老板离店时长", "店长检查表", "异常处理记录"],
      riskSignals: ["老板一走就乱", "店长只传话", "没人做复盘"]
    }
  ],
  franchise: [
    {
      key: "model_evidence",
      title: "模型证据",
      prompt: "招商资料里有没有真实样板店数据、回本拆解、加盟商案例和失败边界？",
      empathy: "加盟商要的不是一句项目很好，而是他能不能看见确定性和风险边界。",
      why: "这一轮判断招商信任是否有证据支撑。",
      afterAnswer: "好，我会把模型证据不足作为招商风险。",
      probes: ["样板店", "回本", "案例", "失败边界"],
      dataPoints: ["样板店数", "回本周期", "案例数量"],
      riskSignals: ["只讲愿景", "缺少真实数据", "不讲风险边界"]
    },
    {
      key: "lead_grading",
      title: "线索分级",
      prompt: "线索进来以后有没有A/B/C分级？按资金、意向、城市、经验、到司可能性怎么分？",
      empathy: "招商线索多但乱，会把团队精力消耗在低质量客户身上。",
      why: "这一轮判断招商漏斗有没有前端筛选能力。",
      afterAnswer: "收到，我会把线索分级能力列入招商链路判断。",
      probes: ["资金", "城市", "经验", "意向", "到司可能性"],
      dataPoints: ["A/B/C线索数", "到司率", "签约率"],
      riskSignals: ["线索不分级", "销售平均用力", "高意向无人跟"]
    },
    {
      key: "sales_material",
      title: "成交资料",
      prompt: "从首聊到签约，顾问手里有没有标准资料包、异议库、测算表和跟进节奏？",
      empathy: "招商成交靠个人发挥会很不稳定，资料和节奏才是团队复制的基础。",
      why: "这一轮判断招商成交是否标准化。",
      afterAnswer: "好，我会把资料包和跟进节奏作为成交风险证据。",
      probes: ["资料包", "异议库", "测算表", "跟进节奏"],
      dataPoints: ["资料完整度", "跟进次数", "异议TOP3"],
      riskSignals: ["顾问各说各话", "没有测算表", "跟进断档"]
    },
    {
      key: "post_opening",
      title: "开店成活",
      prompt: "加盟商开业后30天、60天、90天分别看什么数据？有没有低于红线就介入的机制？",
      empathy: "招商真正的口碑不是签约那一刻，而是加盟商开店后能不能活下来。",
      why: "这一轮判断总部交付是否支撑长期招商。",
      afterAnswer: "明白，我会把开店成活数据作为连锁风险关键证据。",
      probes: ["30天", "60天", "90天", "红线", "介入机制"],
      dataPoints: ["开业成活率", "首月营收", "督导频率"],
      riskSignals: ["开业后失联", "无红线", "总部介入滞后"]
    }
  ],
  revenue: [
    {
      key: "break_even",
      title: "盈亏平衡",
      prompt: "你现在每个月固定成本大概多少？要做到多少流水才刚好不亏？这个数你清楚吗？",
      empathy: "很多老板不是不会经营，是每天在忙，却没有一个清晰的盈亏底线。",
      why: "这一轮判断企业有没有安全线意识。",
      afterAnswer: "收到，我会把盈亏平衡点是否清楚写进风险判断。",
      probes: ["固定成本", "保本流水", "现金流", "安全线"],
      dataPoints: ["房租", "人工", "水电", "平台费", "保本营收"],
      riskSignals: ["不知道保本线", "现金流紧", "流水增长但仍亏"]
    },
    {
      key: "gross_margin_mix",
      title: "毛利结构",
      prompt: "卖得最好的产品和最赚钱的产品是不是同一个？如果不是，差距大概在哪里？",
      empathy: "最忙的产品不一定最赚钱，这个坑很多店都会踩。",
      why: "这一轮判断营收结构是否越卖越薄。",
      afterAnswer: "好，我会把销量和利润错位写成独立漏洞。",
      probes: ["爆品", "利润款", "销量", "毛利", "连带"],
      dataPoints: ["SKU毛利", "销量排行", "利润排行"],
      riskSignals: ["爆品低毛利", "利润款没人买", "套餐结构单一"]
    },
    {
      key: "cash_cycle",
      title: "现金周期",
      prompt: "现金流压力主要来自哪里？压货、账期、人工房租、平台结算，还是季节波动？",
      empathy: "账面有流水但手里没钱，是很典型的经营压力，不是你一个人遇到。",
      why: "这一轮判断利润缺口是不是被现金周期放大。",
      afterAnswer: "明白，我会把现金周期风险和利润缺口分开呈现。",
      probes: ["库存", "账期", "结算", "固定支出", "季节波动"],
      dataPoints: ["库存金额", "回款周期", "月固定支出"],
      riskSignals: ["现金周转慢", "压货高", "平台结算拖慢"]
    },
    {
      key: "roi_review",
      title: "ROI复盘",
      prompt: "最近一次促销、投流或上新，你有没有算投入、产出、毛利和复购？结果是赚了还是热闹了？",
      empathy: "活动热闹但不赚钱特别常见，我们要把热闹和利润分开看。",
      why: "这一轮判断增长动作有没有经营闭环。",
      afterAnswer: "收到，我会把ROI复盘缺口作为营收诊断的核心证据。",
      probes: ["活动", "投流", "上新", "毛利", "复购"],
      dataPoints: ["投入", "产出", "毛利", "复购", "客单"],
      riskSignals: ["只看成交额", "不算毛利", "活动后没复盘"]
    }
  ]
};

const deepQuestions: InterviewQuestion[] = [
  {
    key: "revenue",
    title: "营收",
    prompt: "老板，我们先看营收底盘。近3个月营收、客流、客单、毛利、现金流，哪一个最不稳？",
    empathy: "经营压力先落在钱上很正常，我们先把钱的来龙去脉看清楚，你不用一次说得特别专业。",
    why: "我先问营收，是因为后面获客、团队、供应链都要回到利润和现金流上验证。",
    afterAnswer: "收到，我会把营收、毛利和现金流分开判断，避免只看流水。",
    probes: ["收入趋势", "客流趋势", "客单价", "毛利率", "现金流"],
    dataPoints: ["近3个月营收", "客单价", "毛利率", "固定成本"],
    riskSignals: ["只看流水不看利润", "下滑原因说不清", "成本没拆开"]
  },
  {
    key: "acquisition",
    title: "获客",
    prompt: "接着看获客。新客从哪里来？曝光、咨询、到店、成交这条链路，哪一步最漏？",
    empathy: "获客问题最容易让老板着急，但我会先帮你分清到底是没流量，还是有流量没接住。",
    why: "这一问决定后面第一关是补流量入口，还是补承接成交。",
    afterAnswer: "好，我会按来源、咨询、到店、成交分段看，不把它们混成一句“缺客户”。",
    probes: ["渠道来源", "内容入口", "投流", "转介绍", "私域承接"],
    dataPoints: ["曝光", "咨询", "到店", "成交", "复购"],
    riskSignals: ["来源单一", "有流量没咨询", "私信承接不标准"]
  },
  {
    key: "team",
    title: "团队",
    prompt: "团队这块我想看老板是不是被拖住。现在几个人，岗位怎么分，谁对结果负责？",
    empathy: "团队让老板累，不代表你不会管人，很多时候是机制还没有替你承担压力。",
    why: "我问团队，是为了判断执行掉线到底是人不行，还是岗位、绩效和检查缺口。",
    afterAnswer: "收到，我会重点看老板时间、岗位责任和检查节奏。",
    probes: ["岗位分工", "绩效", "培训", "店长管理", "老板时间"],
    dataPoints: ["人数", "岗位产出", "检查频率", "老板每日耗时"],
    riskSignals: ["老板离不开", "责任人不清", "会议没有结果"]
  },
  {
    key: "store",
    title: "门店运营",
    prompt: "再看门店运营。服务流程、客户体验、复购、客诉、标准化，最近最常出问题的是哪一段？",
    empathy: "门店运营里的小问题最容易被忽略，但它们会慢慢影响复购和口碑。",
    why: "我问运营，是为了判断客户体验和标准化有没有拖住增长。",
    afterAnswer: "明白，我会把服务、复购、客诉和标准化分开记录。",
    probes: ["服务流程", "客户体验", "复购", "客诉", "标准化"],
    dataPoints: ["复购率", "客诉数", "服务检查表", "门店数据记录"],
    riskSignals: ["服务靠个人", "客户体验不稳定", "复购没人管"]
  },
  {
    key: "supply",
    title: "供应链",
    prompt: "供应链我单独问。采购、库存、损耗、品控、交付周期、供应商稳定性，哪个最容易影响利润？",
    empathy: "供应链问题通常不显眼，但一出问题就直接吞利润，你能说个大概就行。",
    why: "这一问是为了看利润缺口是不是藏在采购、库存、损耗或品控里。",
    afterAnswer: "收到，这部分我会按供应链风险单独进报告，不再用财务问题一笔带过。",
    probes: ["采购", "库存", "损耗", "品控", "交付周期", "供应商"],
    dataPoints: ["库存周转", "损耗率", "缺货频率", "核心供应商数量"],
    riskSignals: ["库存不清", "损耗不算", "核心物料单一供应商"]
  },
  {
    key: "franchise",
    title: "招商拓店",
    prompt: "最后看招商拓店。如果你有多店或加盟，线索、到司、签约、培训督导，哪一步最弱？没有也直接说没有。",
    empathy: "如果你暂时没有招商也没关系，我问这一块是为了判断未来复制能力，不是逼你做加盟。",
    why: "这能判断企业是单店经营问题，还是已经进入多店复制和招商风险。",
    afterAnswer: "好，我会把招商拓店作为独立维度判断，有就深看，没有就标记为暂不适用。",
    probes: ["招商线索", "到司", "签约", "选址", "培训督导"],
    dataPoints: ["门店数", "线索数", "到司率", "签约率", "加盟商成活情况"],
    riskSignals: ["单店模型讲不清", "线索不分级", "重招商轻交付"]
  },
  {
    key: "revenue_cost_detail",
    title: "成本拆解",
    prompt: "我再追一下利润细节：房租、人工、原料、投流、平台佣金里，哪一项最像在悄悄吃利润？",
    empathy: "很多老板不是没有收入，是收入进来以后被成本一点点吃掉了，这个特别值得单独看。",
    why: "这一问能判断盈利缺口是收入端问题，还是成本结构问题。",
    afterAnswer: "收到，我会把固定成本和变动成本分开写进报告。",
    probes: ["房租", "人工", "原料", "投流", "平台佣金"],
    dataPoints: ["成本占比", "毛利率", "净利率", "异常成本"],
    riskSignals: ["成本长期没复盘", "爆品不赚钱", "平台佣金压缩利润"]
  },
  {
    key: "acquisition_channel_detail",
    title: "渠道矩阵",
    prompt: "获客渠道我再问细一点：抖音、视频号、小红书、团购、老客转介绍，你现在真正能稳定带客的是哪几个？",
    empathy: "渠道多不代表获客稳，真正重要的是有没有一个能持续带来咨询和成交的入口。",
    why: "这一问能判断你是渠道没铺开，还是铺了但没有形成稳定转化。",
    afterAnswer: "好，我会把渠道数量、稳定性和转化结果分开判断。",
    probes: ["短视频", "团购", "私域", "转介绍", "线下自然客"],
    dataPoints: ["各渠道线索数", "成交数", "成本", "复购来源"],
    riskSignals: ["只靠单一平台", "渠道有动作没数据", "转介绍机制缺失"]
  },
  {
    key: "team_execution_detail",
    title: "执行检查",
    prompt: "团队执行我再核实一下：每天谁检查结果？检查的是动作完成，还是经营数字变好了？",
    empathy: "团队忙了一天但老板还是不放心，通常是检查口径没有对准结果。",
    why: "这一问能判断管理问题是人效低，还是检查机制没有闭环。",
    afterAnswer: "明白，我会把执行动作和结果指标分开看。",
    probes: ["检查人", "检查频率", "结果指标", "奖惩"],
    dataPoints: ["日清表", "周会记录", "绩效指标", "返工次数"],
    riskSignals: ["只检查有没有做", "没人看结果", "奖惩和经营目标脱节"]
  },
  {
    key: "store_operation_detail",
    title: "运营数据",
    prompt: "门店运营有没有固定记录：客诉、好评、复购、核销、退单、服务异常？有记录说记录，没有就说大概靠感觉。",
    empathy: "门店运营的细节最容易被日常忙碌盖住，但这些数据会直接影响复购。",
    why: "这一问能判断门店有没有进入可复盘运营，而不是每天救火。",
    afterAnswer: "收到，我会把运营数据缺口作为门店风险单独标出来。",
    probes: ["客诉", "好评", "复购", "核销", "退单", "异常"],
    dataPoints: ["客诉数", "好评率", "复购率", "退单率"],
    riskSignals: ["体验问题没人记录", "复购靠自然发生", "异常没有责任人"]
  },
  {
    key: "supply_loss_detail",
    title: "损耗品控",
    prompt: "供应链再问一个关键点：库存、损耗和品控有没有固定盘点？有没有出现缺货、浪费、口味不稳？",
    empathy: "供应链问题不一定每天爆出来，但一旦长期没人看，会悄悄吞利润和口碑。",
    why: "这一问能判断供应链是不是已经影响毛利和交付稳定性。",
    afterAnswer: "好，这里我会结合供应链诊断口径单独评红黄绿。",
    probes: ["盘点频率", "损耗", "缺货", "品控", "口味稳定"],
    dataPoints: ["库存周转天数", "损耗率", "缺货次数", "品控记录"],
    riskSignals: ["库存账实不符", "损耗没人算", "品控靠经验"]
  },
  {
    key: "franchise_delivery_detail",
    title: "复制交付",
    prompt: "如果未来要多店或加盟，你现在有没有一套能复制的培训、督导、巡店和数据回传机制？",
    empathy: "复制不是开更多店这么简单，真正难的是每家店都能稳定做出结果。",
    why: "这一问能判断你是否具备连锁复制基础，还是暂时只能靠老板个人能力。",
    afterAnswer: "明白，我会把复制能力作为招商拓店风险的一部分。",
    probes: ["培训", "督导", "巡店", "数据回传", "标准化"],
    dataPoints: ["培训周期", "巡店频率", "作业/考试", "门店数据"],
    riskSignals: ["标准只在老板脑子里", "新店开业后没人督导", "数据回不来"]
  }
];

const availableSkillCoverage: Record<string, string[]> = {
  short_video_ip: ["IP定位", "内容九件套", "视频数据复盘", "朋友圈私域承接"],
  store_acquisition: ["获客成交链路体检", "门店数据分析", "营销活动策划", "销售成交话术"],
  team_management: ["组织人事", "管理咨询", "交付标准化"],
  franchise: ["招商体系", "加盟合规", "商学院培训", "销售成交"],
  revenue: ["财务经营", "门店数据分析", "菜单利润优化", "活动ROI"],
  deep: ["企业系统诊断", "行业对标", "获客成交", "营收财务", "供应链诊断", "组织人事", "落地督促"]
};

const solutionServiceTitles: Record<QuickDiagnosisCategory, string> = {
  short_video_ip: "IP获客系统咨询落地方案",
  store_acquisition: "门店获客系统咨询落地方案",
  team_management: "团队管理系统咨询落地方案",
  franchise: "招商增长系统咨询落地方案",
  revenue: "营收增长系统咨询落地方案"
};

const solutionServiceSuffixPattern =
  /\s*(AI咨询落地方案|IP获客系统咨询落地方案|门店获客系统咨询落地方案|团队管理系统咨询落地方案|招商增长系统咨询落地方案|营收增长系统咨询落地方案|企业经营系统咨询落地方案)$/;

function solutionServiceTitleForMode(mode: DiagnosisMode, category: QuickDiagnosisCategory) {
  return mode === "deep" ? "企业经营系统咨询落地方案" : solutionServiceTitles[category];
}

function stripSolutionServiceTitle(title: string) {
  return title.replace(solutionServiceSuffixPattern, "").trim();
}

function buildSolutionDisplayTitle(
  businessName: string | undefined,
  mode: DiagnosisMode,
  category: QuickDiagnosisCategory
) {
  const serviceTitle = solutionServiceTitleForMode(mode, category);
  const name = businessName?.trim();
  return name && name !== "企业" ? `${name} ${serviceTitle}` : serviceTitle;
}

function displaySolutionTitle(solution: LandingSolution, fallbackMode: DiagnosisMode, fallbackCategory: QuickDiagnosisCategory) {
  const strippedName = stripSolutionServiceTitle(solution.title);
  const businessName = solution.profileSnapshot?.businessName?.trim() || (strippedName === "企业" ? "" : strippedName);
  return buildSolutionDisplayTitle(businessName, solution.mode ?? fallbackMode, solution.category ?? fallbackCategory);
}

function readStoredJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function normalizeMode(value: string | null): DiagnosisMode {
  return value === "deep" ? "deep" : "quick";
}

function normalizeCategory(value: string | null): QuickDiagnosisCategory {
  return quickDiagnosisCategories.some((item) => item.id === value)
    ? (value as QuickDiagnosisCategory)
    : "short_video_ip";
}

function parseRevenueWan(value: string): number {
  const range = value.match(/(\d+(?:\.\d+)?)\s*(?:-|~|—|到|至)\s*(\d+(?:\.\d+)?)/);
  const num = range ? Number(range[2]) : Number(value.replace(/[^\d.]/g, ""));
  if (!Number.isFinite(num)) return 0;
  if (value.includes("万") || /w/i.test(value)) return num;
  return num > 1000 ? num / 10000 : num;
}

function clampScore(value: number) {
  return Math.max(25, Math.min(92, Math.round(value)));
}

function scoreStatus(score: number): ScoreStatus {
  if (score < 55) return "红灯";
  if (score < 75) return "黄灯";
  return "绿灯";
}

function normalizeScoreStatus(value: unknown): ScoreStatus {
  if (value === "红灯" || value === "绿灯" || value === "黄灯") return value;
  return "黄灯";
}

function buildRiskLevel(scores: ReportScore[], monthlyRevenue: string): RiskLevel {
  const redCount = scores.filter((item) => item.status === "红灯").length;
  const yellowCount = scores.filter((item) => item.status === "黄灯").length;
  const revenue = parseRevenueWan(monthlyRevenue);
  if (redCount >= 3 || (redCount >= 2 && monthlyRevenue && revenue <= 2)) return "高风险";
  if (redCount >= 1 || yellowCount >= 3 || !monthlyRevenue || revenue <= 10) return "中风险";
  return "低风险";
}

const dimensionEvidenceTitles: Record<string, string[]> = {
  定位信任: ["定位信任", "定位和信任", "主页四件套", "转化证据"],
  内容数据: ["内容数据", "内容矩阵", "复盘节奏"],
  私域承接: ["私域承接", "承接链路", "客户顾虑", "转化证据"],
  成交转化: ["成交转化", "客户顾虑", "承接链路", "复盘节奏"],
  新客来源: ["新客来源", "渠道ROI", "进店理由"],
  咨询到店: ["获客漏斗", "咨询承接", "咨询流失"],
  成交复购: ["获客漏斗", "复购转介绍", "咨询流失"],
  数据复盘: ["渠道ROI", "复购转介绍", "获客漏斗"],
  岗位分工: ["岗位分工", "岗位产出", "店长层"],
  绩效检查: ["管理节奏", "奖惩挂钩", "岗位产出"],
  培训复制: ["培训复制", "执行掉线", "管理节奏"],
  老板时间: ["老板时间", "店长层", "岗位分工"],
  招商线索: ["招商漏斗", "线索分级", "模型证据"],
  到司签约: ["招商漏斗", "成交资料", "加盟信任"],
  加盟信任: ["加盟信任", "模型证据", "成交资料"],
  培训督导: ["培训督导", "开店成活", "复制交付"],
  营收结构: ["营收趋势", "产品利润", "毛利结构"],
  毛利成本: ["成本压力", "盈亏平衡", "毛利结构"],
  客单复购: ["产品利润", "ROI复盘", "营收趋势"],
  经营看板: ["经营看板", "ROI复盘", "现金周期"],
  营收: ["营收", "成本拆解", "经营看板"],
  获客: ["获客", "渠道矩阵", "执行检查"],
  团队: ["团队", "执行检查", "团队检查"],
  门店运营: ["门店运营", "运营数据", "复制交付"],
  供应链: ["供应链", "损耗品控", "成本拆解"],
  招商拓店: ["招商拓店", "复制交付", "渠道矩阵"]
};

const dimensionMissingEvidence: Record<string, string> = {
  定位信任: "主页四件套、置顶内容、客户信任证据",
  内容数据: "近30天内容发布、播放、私信、加微、成交来源",
  私域承接: "回复时长、加微率、到店率、成交率",
  成交转化: "客户顾虑TOP3、未成交原因、统一承接话术记录",
  新客来源: "渠道来源占比、获客成本、转介绍数量",
  咨询到店: "咨询数、到店数、未到店原因",
  成交复购: "成交率、复购率、转介绍率",
  数据复盘: "渠道ROI表和每周复盘记录",
  岗位分工: "岗位产出、责任人和每日检查口径",
  绩效检查: "绩效表、奖惩规则和结果追踪",
  培训复制: "新人训练材料、考核题和上岗标准",
  老板时间: "老板每日被占用事项和授权失败记录",
  招商线索: "线索A/B/C分层、到司率和签约率",
  到司签约: "到司转签约数据、异议记录和测算表",
  加盟信任: "样板店数据、加盟案例和风险边界",
  培训督导: "开业30/60/90天数据和督导介入红线",
  营收结构: "产品销量排行、利润排行和客单变化",
  毛利成本: "固定成本、变动成本、毛利率和保本线",
  客单复购: "客单价、连带率、复购率和活动后复购",
  经营看板: "周经营看板、ROI复盘和现金周期",
  营收: "近3个月营收、客流、客单、毛利、现金流",
  获客: "曝光、咨询、到店、成交、复购全链路数据",
  团队: "岗位、绩效、培训、检查和老板时间记录",
  门店运营: "客诉、好评、复购、核销、退单和服务异常",
  供应链: "库存周转、损耗率、缺货频率和供应商稳定性",
  招商拓店: "线索、到司、签约、培训督导和加盟成活率"
};

function stripAnswerPrefix(answer: string) {
  const index = answer.indexOf("：");
  return index >= 0 ? answer.slice(index + 1).trim() : answer.trim();
}

function answerTitle(answer: string) {
  const index = answer.indexOf("：");
  return index >= 0 ? answer.slice(0, index).trim() : "";
}

function compactText(value: string, max = 38) {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function relatedAnswersForDimension(dimension: string, answers: string[]) {
  const titles = dimensionEvidenceTitles[dimension] ?? [dimension];
  const related = answers
    .filter((answer) => answer.trim())
    .filter((answer) => {
      const title = answerTitle(answer);
      return titles.some((item) => title.includes(item) || answer.includes(item));
    });
  return related.length ? related : answers.filter((answer) => answer.trim()).slice(0, 2);
}

function dimensionJudgement(dimension: string, riskHits: number, positiveHits: number) {
  if (riskHits > positiveHits + 1) return `${dimension}已出现明确掉线信号，需要优先纳入风险排序。`;
  if (positiveHits > riskHits) return `${dimension}已有部分经营动作，但还缺连续数据证明稳定性。`;
  return `${dimension}目前信息偏散点，暂不能证明已经形成可复盘闭环。`;
}

function hasAnySignal(text: string, signals: string[]) {
  return signals.some((signal) => text.includes(signal));
}

function extractMonthlyPublishCount(text: string) {
  const monthly = text.match(/(?:近?30天|一个月|本月|月)[^\d]{0,8}(\d+(?:\.\d+)?)\s*(?:条|个|篇|次)/);
  if (monthly) return Number(monthly[1]);
  const weekly = text.match(/(?:每周|周更)[^\d]{0,4}(\d+(?:\.\d+)?)\s*(?:条|个|篇|次)?/);
  if (weekly) return Number(weekly[1]) * 4;
  return undefined;
}

function shortVideoConfirmedSummary(dimension: string, answers: string[], fallback: string) {
  const related = relatedAnswersForDimension(dimension, answers).map(stripAnswerPrefix).filter(Boolean);
  return related.length ? related.slice(0, 2).map((item) => compactText(item, 58)).join("；") : fallback;
}

function buildShortVideoIpDimensionScore(dimension: string, answers: string[]): ReportScore | null {
  if (!["定位信任", "内容数据", "私域承接", "成交转化"].includes(dimension)) return null;
  const text = answers.join(" ");
  const publishCount = extractMonthlyPublishCount(text);
  let score = 68;
  let confirmed = shortVideoConfirmedSummary(dimension, answers, "访谈中暂未形成有效事实");
  let missing = dimensionMissingEvidence[dimension];
  let judgement = `${dimension}目前信息偏散点，暂不能证明已经形成可复盘闭环。`;

  if (dimension === "定位信任") {
    const positioningWeak = hasAnySignal(text, ["无定位", "没有定位", "定位不清", "账号无定位", "不知道自己卖什么", "客户不知道"]);
    const homepageWeak = hasAnySignal(text, ["头像是招牌", "头像招牌", "简介不清", "置顶环境", "昵称", "主页看不懂", "主页四件套"]);
    const evidenceWeak = hasAnySignal(text, ["无案例", "没有案例", "无客户好评", "没有客户好评", "缺少证据", "无信任"]);
    const riskCount = [positioningWeak, homepageWeak, evidenceWeak].filter(Boolean).length;
    score = riskCount >= 2 ? 42 : riskCount === 1 ? 58 : 78;
    missing = "主页访问率、置顶点击、私信口令触发数、客户信任证据";
    judgement = riskCount >= 2
      ? "用户第一眼还难判断你是谁、帮谁解决什么和凭什么信，定位信任属于红灯。"
      : riskCount === 1
        ? "已有部分定位信息，但主页和信任证据仍未形成稳定闭环。"
        : "定位信任已有基础，但仍要用主页访问和私信口令数据验证。";
  }

  if (dimension === "内容数据") {
    const lowFrequency = publishCount !== undefined && publishCount < 8;
    const narrowContent = hasAnySignal(text, ["90%以上", "环境展示", "只拍环境", "无案例", "没有案例", "无痛点", "无人设", "效果视频"]);
    const noContentData = hasAnySignal(text, ["无完播", "没有完播", "不追踪", "只看播放量", "无数据", "不知道完播"]);
    const riskCount = [lowFrequency, narrowContent, noContentData].filter(Boolean).length;
    score = riskCount >= 2 ? 40 : riskCount === 1 ? 56 : 78;
    confirmed = `${publishCount !== undefined ? `近30天约发布${publishCount}条` : "近30天发布频率未形成明确口径"}；${shortVideoConfirmedSummary(dimension, answers, "内容结构信息不足")}`;
    missing = "发布频率、完播率、主页访问、私信、加微、成交来源";
    judgement = riskCount >= 2
      ? "当前内容供给和内容数据同时偏弱，容易出现有播放但没有咨询的红灯状态。"
      : riskCount === 1
        ? "内容动作已经出现，但数据链路还不足以证明内容能稳定带来咨询。"
        : "内容数据已有基础，后续重点看连续30天的转化口径。";
  }

  if (dimension === "私域承接") {
    const noOwner = hasAnySignal(text, ["无人专门负责", "没人负责", "无专人", "自己接", "没有人负责"]);
    const noScript = hasAnySignal(text, ["无固定话术", "没有话术", "未主动要微信", "未主动加微", "没有主动加微", "无承接"]);
    const lowInquiry = hasAnySignal(text, ["私信极少", "几乎没有私信", "没有私信", "加微2-3", "加微2到3", "加微很少"]);
    const riskCount = [noOwner, noScript, lowInquiry].filter(Boolean).length;
    score = riskCount >= 2 ? 36 : riskCount === 1 ? 54 : 76;
    missing = "回复时长、加微率、到店率、成交率、承接责任人";
    judgement = riskCount >= 2
      ? "流量进入私域后缺少责任人和标准话术，承接链路属于红灯。"
      : riskCount === 1
        ? "私域承接有动作但标准化不足，后续容易丢失咨询。"
        : "私域承接已有基础，需要用回复时长和加微率验证稳定性。";
  }

  if (dimension === "成交转化") {
    const noProof = hasAnySignal(text, ["无案例", "没有案例", "无客户好评", "没有客户好评", "价格未解释", "问价后沉默"]);
    const noReason = hasAnySignal(text, ["不知道未成交", "未成交原因不清", "没有未成交", "不记录原因", "无人回复"]);
    const noReview = hasAnySignal(text, ["基本不复盘", "不复盘", "只看播放量", "不追踪", "没复盘", "成交来源"]);
    const riskCount = [noProof, noReason, noReview].filter(Boolean).length;
    score = riskCount >= 2 ? 42 : riskCount === 1 ? 57 : 77;
    missing = "客户顾虑TOP3、未成交原因、价格解释内容、成交来源、复盘记录";
    judgement = riskCount >= 2
      ? "从内容到成交缺少证据和复盘口径，成交转化属于红灯。"
      : riskCount === 1
        ? "成交证据或复盘口径仍有缺口，暂不能证明转化稳定。"
        : "成交转化已有基础，需要用未成交原因和成交来源继续验证。";
  }

  const evidence = `已确认：${confirmed}。待量化：${missing}。判断：${judgement}`;
  return { dimension, score, status: scoreStatus(score), evidence };
}

function buildDimensionScore(dimension: string, answers: string[], monthlyRevenue: string): ReportScore {
  const shortVideoScore = buildShortVideoIpDimensionScore(dimension, answers);
  if (shortVideoScore) return shortVideoScore;

  const text = answers.join(" ");
  const highRiskWords = ["没有", "不清楚", "不会", "下滑", "亏", "没人", "混乱", "卡", "低", "高", "投诉", "不稳定", "靠感觉", "无数据", "没复盘", "断"];
  const positiveWords = ["固定", "记录", "复盘", "数据", "负责人", "标准", "稳定", "增长", "转介绍", "毛利"];
  const riskHits = highRiskWords.filter((word) => text.includes(word)).length;
  const positiveHits = positiveWords.filter((word) => text.includes(word)).length;
  const base = answers.some((answer) => answer.trim()) ? 68 : 45;
  const revenuePenalty = monthlyRevenue ? 0 : 8;
  const score = clampScore(base - riskHits * 4 + positiveHits * 3 - revenuePenalty);
  const related = relatedAnswersForDimension(dimension, answers).map(stripAnswerPrefix).filter(Boolean);
  const confirmed = related.length ? related.slice(0, 2).map((item) => compactText(item)).join("；") : "访谈中暂未形成有效事实";
  const evidence = text.trim()
    ? `已确认：${confirmed}。待量化：${dimensionMissingEvidence[dimension] ?? "连续经营数据和责任人口径"}。判断：${dimensionJudgement(dimension, riskHits, positiveHits)}`
    : `${dimension}板块暂未形成有效事实描述，先按高风险处理。`;
  return { dimension, score, status: scoreStatus(score), evidence };
}

function focusDimensions(mode: DiagnosisMode, category: QuickDiagnosisCategory): string[] {
  if (mode === "deep") return ["营收", "获客", "团队", "门店运营", "供应链", "招商拓店"];
  const map: Record<QuickDiagnosisCategory, string[]> = {
    short_video_ip: ["定位信任", "内容数据", "私域承接", "成交转化"],
    store_acquisition: ["新客来源", "咨询到店", "成交复购", "数据复盘"],
    team_management: ["岗位分工", "绩效检查", "培训复制", "老板时间"],
    franchise: ["招商线索", "到司签约", "加盟信任", "培训督导"],
    revenue: ["营收结构", "毛利成本", "客单复购", "经营看板"]
  };
  return map[category];
}

function formatProfitGap(monthlyRevenue: string, riskLevel: RiskLevel, scores: ReportScore[]) {
  const revenue = parseRevenueWan(monthlyRevenue);
  if (!revenue) {
    return "当前暂未形成可用于精确测算的月营收、客流、客单、毛利和成本口径，盈利缺口只能先做风险判断。";
  }
  const redCount = scores.filter((score) => score.status === "红灯").length;
  const yellowCount = scores.filter((score) => score.status === "黄灯").length;
  const rate = redCount >= 3 ? 0.18 : redCount >= 1 ? 0.12 : yellowCount >= 3 ? 0.09 : riskLevel === "中风险" ? 0.08 : 0.04;
  const gap = Math.max(0.5, revenue * rate).toFixed(1);
  const acquisitionGap = (Number(gap) * 0.4).toFixed(1);
  const handoffGap = (Number(gap) * 0.35).toFixed(1);
  const conversionGap = (Number(gap) * 0.25).toFixed(1);
  return `估算公式：月营收${revenue.toFixed(1)}万元 × 红黄灯漏损系数${Math.round(rate * 100)}% = 约${gap}万元/月。拆分口径：获客入口约${acquisitionGap}万元、私域承接约${handoffGap}万元、成交证据约${conversionGap}万元。该数字是经营体检粗估，后续需用咨询数、到店数、成交率和复购数据复核。`;
}

function categoryDepthLabel(mode: DiagnosisMode, category: QuickDiagnosisCategory) {
  if (mode === "deep") return "六大经营板块深度访谈";
  const map: Record<QuickDiagnosisCategory, string> = {
    short_video_ip: "IP获客专项访谈：定位、主页、内容、承接、成交证据、复盘",
    store_acquisition: "门店获客专项访谈：来源、漏斗、进店理由、咨询流失、复购转介绍、ROI",
    team_management: "人员管理专项访谈：岗位、老板时间、管理节奏、培训复制、奖惩、店长层",
    franchise: "招商专项访谈：单店模型、招商漏斗、加盟信任、线索分级、成交资料、开店成活",
    revenue: "营收专项访谈：趋势、成本、产品利润、保本线、毛利结构、现金周期、ROI"
  };
  return map[category];
}

function buildBusinessStatusLines(
  profile: BaseProfile,
  mode: DiagnosisMode,
  category: QuickDiagnosisCategory,
  answers: string[]
) {
  const filled = answers.filter((answer) => answer.trim());
  const profileAnswer = filled.find((answer) => answerTitle(answer) === "基础画像");
  return [
    `${profile.role}，行业为${profile.industry || "暂未确认"}，城市为${profile.city || "暂未确认"}，月营收口径为${profile.monthlyRevenue || "暂未确认"}。`,
    `本次完成${filled.length}轮访谈，覆盖${categoryDepthLabel(mode, category)}。`,
    profileAnswer ? `基础画像原始描述：${compactText(stripAnswerPrefix(profileAnswer), 70)}` : "基础画像仍未完整确认，行业、城市、体量和团队规模存在判断缺口。",
    "本报告按“已确认事实、后续量化口径、风险推断”三层呈现。"
  ];
}

function buildPotentialRiskLines(category: QuickDiagnosisCategory, riskLevel: RiskLevel, weaknessTags: string[]) {
  const topWeakness = weaknessTags.slice(0, 3).join("、") || "核心链路";
  const common = [
    `当前${topWeakness}存在证据缺口，如果继续凭感觉推进，容易把系统性漏洞误判为单点问题。`,
    "关键数字没有连续记录时，后续即使做了动作，也无法判断增长来自哪里、漏损是否变轻。"
  ];
  const map: Record<QuickDiagnosisCategory, string> = {
    short_video_ip: "短视频侧若只追播放，不追主页访问、私信、加微和成交来源，可能持续产出热闹但不产生成交。",
    store_acquisition: "门店获客若不拆曝光、咨询、到店、成交、复购，容易继续花钱买流量，但漏点留在承接和复购。",
    team_management: "团队管理若只靠老板盯现场，岗位责任和检查机制会持续吞掉老板时间。",
    franchise: "招商若前端承诺强、后端交付证据弱，签约效率和加盟商成活率都会受影响。",
    revenue: "营收若只看流水，不看毛利、保本线、现金周期和ROI，可能出现越忙越薄、活动热闹但利润没变厚。"
  };
  return [...common, map[category], riskLevel === "高风险" ? "当前红灯维度较多，新增投入可能先放大漏损，而不是带来净增长。" : "当前风险仍可控，但需要尽快补齐数据口径，避免后续复盘失真。"];
}

function buildIndustryGapLines(mode: DiagnosisMode, category: QuickDiagnosisCategory, answers: string[] = []) {
  const answerText = answers.join(" ");
  const publishCount = extractMonthlyPublishCount(answerText);
  const publishLabel = publishCount !== undefined ? `当前访谈约${publishCount}条/月` : "当前发布频率未形成明确口径";
  const inquiryLabel = hasAnySignal(answerText, ["私信极少", "几乎没有私信", "没有私信", "月询盘<5", "询盘小于5"])
    ? "当前月询盘接近低位"
    : "当前询盘、加微和成交来源仍需连续记录";
  if (mode === "deep") {
    return [
      "成熟企业会把营收、获客、团队、门店运营、供应链、招商拓店放进同一套经营驾驶舱。",
      "成熟连锁会按周记录各门店的来源、咨询、成交、复购、成本、损耗和负责人，而不是只看总流水。",
      "当前访谈信息仍偏散点，和可复制、可监督、可复盘的经营系统存在差距。"
    ];
  }
  const map: Record<QuickDiagnosisCategory, string[]> = {
    short_video_ip: [
      `同行有效账号通常保持月均发布≥20条、周更≥5条；${publishLabel}，内容供给密度存在差距。`,
      `成熟IP账号会同时记录播放、完播、主页访问、私信、加微和成交来源；${inquiryLabel}，暂不能证明内容已形成咨询闭环。`,
      "成熟主页四件套会在3秒内讲清账号定位、信任证据、置顶内容和私信口令；当前专项信息仍需要补强主页到私域的连续证据。"
    ],
    store_acquisition: [
      "成熟门店会把获客拆成来源、咨询、到店、成交、复购和转介绍，而不是只说客流好坏。",
      "成熟商家会按渠道算ROI，知道哪类客户值得继续投入。",
      "当前专项信息仍需要补强渠道级成本和漏斗转化证据。"
    ],
    team_management: [
      "成熟团队会把岗位产出、检查频率、培训复制和奖惩口径固定下来。",
      "成熟店长层能替老板发现问题、安排动作、检查结果。",
      "当前团队信息仍难证明企业已经摆脱老板个人兜底。"
    ],
    franchise: [
      "成熟招商体系会用样板店数据、回本测算、异议库和开店成活率建立信任。",
      "成熟品牌会按线索分级管理招商漏斗，而不是所有线索平均跟进。",
      "当前招商信息仍需要补强从签约到开业成活的闭环证据。"
    ],
    revenue: [
      "成熟商家会同时看流水、毛利、保本线、现金周期和活动ROI。",
      "成熟经营会区分引流款、利润款、复购款，避免爆品卖得多但利润薄。",
      "当前营收信息仍需要补强产品级毛利、保本线和活动复盘证据。"
    ]
  };
  return map[category];
}

function buildMissingDataLines(mode: DiagnosisMode, category: QuickDiagnosisCategory, profile: BaseProfile, dimensions: string[]) {
  const base = [
    !profile.monthlyRevenue ? "后续复盘建议记录：月营收、毛利、主要成本、保本流水" : "",
    ...dimensions.slice(0, 4).map((dimension) => dimensionMissingEvidence[dimension] ?? `${dimension}连续数据`)
  ].filter(Boolean);
  if (mode === "deep") return [...base, "后续复盘建议记录：供应链库存、损耗、交付周期数据", "后续复盘建议记录：招商拓店线索、到司、签约、成活率数据"];
  return [...base, "后续复盘建议记录：本专项最近一次复盘记录和负责人"];
}

function buildProfessionalReport(
  profile: BaseProfile,
  mode: DiagnosisMode,
  category: QuickDiagnosisCategory,
  answers: string[]
): DiagnosisReport {
  const categoryLabel = quickDiagnosisCategories.find((item) => item.id === category)?.title ?? "单项诊断";
  const dimensions = focusDimensions(mode, category);
  const scores = dimensions.map((dimension) => buildDimensionScore(dimension, answers, profile.monthlyRevenue));
  const riskLevel = buildRiskLevel(scores, profile.monthlyRevenue);
  const redOrYellow = scores.filter((score) => score.status !== "绿灯");
  const mainWeaknesses = redOrYellow.slice(0, 3).map((item) => item.dimension);
  const weaknessTags = mainWeaknesses.length ? mainWeaknesses : dimensions.slice(0, 3);

  return {
    title: mode === "deep"
      ? `${profile.businessName || "企业"} 全企业系统深度诊断报告`
      : `${profile.businessName || "企业"} ${categoryLabel}简报`,
    mode,
    categoryLabel: mode === "quick" ? categoryLabel : undefined,
    summary: redOrYellow.length
      ? `当前最先暴露的是${mainWeaknesses.join("、")}，主要问题不是单点动作少，而是关键事实、连续数据和复盘口径还没有形成闭环。`
      : "当前基础链路较完整，但仍需要用连续数据验证真实增长空间。",
    businessStatus: buildBusinessStatusLines(profile, mode, category, answers),
    currentLeaks: scores.map((score) => `${score.dimension}：${score.status}，${score.evidence}`),
    profitGap: formatProfitGap(profile.monthlyRevenue, riskLevel, scores),
    potentialRisks: buildPotentialRiskLines(category, riskLevel, weaknessTags),
    industryGap: buildIndustryGapLines(mode, category, answers),
    riskLevel,
    weaknessTags,
    scores,
    missingData: buildMissingDataLines(mode, category, profile, dimensions)
  };
}

function normalizeRemoteReport(
  remote: Partial<DiagnosisReport> | null,
  fallback: DiagnosisReport
): DiagnosisReport {
  if (!remote) return fallback;
  const hasDepth = (items: unknown, minLength = 80) =>
    Array.isArray(items) && items.join("").length >= minLength;
  const remoteScores = Array.isArray(remote.scores) && remote.scores.length && remote.scores.some((score) => String(score.evidence ?? "").length > 45)
    ? remote.scores.map((score) => ({
      dimension: String(score.dimension ?? "经营维度"),
      score: clampScore(Number(score.score ?? 60)),
      status: normalizeScoreStatus(score.status),
      evidence: String(score.evidence ?? "依据当前访谈信息判断。")
    }))
    : null;
  const fallbackRedCount = fallback.scores.filter((score) => score.status === "红灯").length;
  const remoteRedCount = remoteScores?.filter((score) => score.status === "红灯").length ?? 0;
  const useRemoteDiagnosisText = Boolean(remoteScores && remoteRedCount >= fallbackRedCount);
  const scores = remoteScores && remoteRedCount >= fallbackRedCount ? remoteScores : fallback.scores;
  const riskRank: Record<RiskLevel, number> = { 低风险: 1, 中风险: 2, 高风险: 3 };
  const remoteRisk = remote.riskLevel === "低风险" || remote.riskLevel === "高风险" || remote.riskLevel === "中风险"
    ? remote.riskLevel
    : fallback.riskLevel;
  const riskLevel = riskRank[remoteRisk] >= riskRank[fallback.riskLevel] ? remoteRisk : fallback.riskLevel;
  const remoteProfitGap = typeof remote.profitGap === "string" && remote.profitGap.length > 28 && /公式|×|=/.test(remote.profitGap)
    ? remote.profitGap
    : fallback.profitGap;
  return {
    ...fallback,
    summary: useRemoteDiagnosisText && remote.summary && remote.summary.length > 28 ? remote.summary : fallback.summary,
    businessStatus: hasDepth(remote.businessStatus) ? remote.businessStatus as string[] : fallback.businessStatus,
    currentLeaks: useRemoteDiagnosisText && hasDepth(remote.currentLeaks, 120) ? remote.currentLeaks as string[] : fallback.currentLeaks,
    profitGap: remoteProfitGap,
    potentialRisks: useRemoteDiagnosisText && hasDepth(remote.potentialRisks) ? remote.potentialRisks as string[] : fallback.potentialRisks,
    industryGap: useRemoteDiagnosisText && hasDepth(remote.industryGap) && /\d/.test((remote.industryGap as string[]).join(""))
      ? remote.industryGap as string[]
      : fallback.industryGap,
    riskLevel,
    weaknessTags: Array.isArray(remote.weaknessTags) ? remote.weaknessTags : fallback.weaknessTags,
    scores,
    missingData: hasDepth(remote.missingData, 45) ? remote.missingData as string[] : fallback.missingData
  };
}

function saveReport(report: DiagnosisReport) {
  localStorage.setItem(latestReportKey, JSON.stringify(report));
  localStorage.setItem("store_os_diagnosis_done", "true");
}

function buildTemplateForCategory(category: QuickDiagnosisCategory) {
  const templates: Record<QuickDiagnosisCategory, LandingSolution["templates"]> = {
    short_video_ip: [
      { title: "IP定位全案输出模板", content: "先完成专项访谈，再输出1分钟速览、八章定位全案、主页四件套、80+选题和30天内容日历。" },
      { title: "主页四件套模板", content: "昵称、头像、简介、背景图必须统一指向同一个IP定位，不再各说各话。" },
      { title: "内容执行包模板", content: "脚本、分镜、拍摄清单、剪辑EDL、标题、评论引导和投流建议，都围绕已确认定位展开。" }
    ],
    store_acquisition: [
      { title: "到店钩子模板", content: "本周到店报暗号，可领取[体验礼]，适合正在纠结[痛点]的客户先低门槛体验。" },
      { title: "咨询跟进话术", content: "我先问你两个情况，方便判断你适合哪个套餐：预算区间和最想改善的问题是什么？" }
    ],
    team_management: [
      { title: "日清表模板", content: "今日目标、已完成、未完成原因、明日补救动作、需要老板决策的事项。" },
      { title: "绩效检查模板", content: "岗位产出、过程动作、客户反馈、数据结果、下周改进。每周固定同一时间检查。" }
    ],
    franchise: [
      { title: "招商首聊话术", content: "我先确认你看项目最关心回本、选址、培训还是获客？不同顾虑我给你发对应资料。" },
      { title: "单店模型表达", content: "投资额、毛利结构、回本周期、总部支持、样板店数据，用一页讲清楚。" }
    ],
    revenue: [
      { title: "利润拆解表", content: "营收=客流×转化率×客单价×复购频次；利润=营收×毛利率-固定成本-投流成本。" },
      { title: "每周经营复盘", content: "本周收入、毛利、成本异常、主推品表现、下周只改一个变量。" }
    ]
  };
  return templates[category];
}

function taskTextForCategory(category: QuickDiagnosisCategory, day: number) {
  const generic = {
    ai: "整理今日任务所需的文案、表格或检查清单",
    user: "确认真实经营数据，并反馈执行结果",
    team: "按检查表记录过程数据",
    metric: "今日是否留下可复盘数据"
  };
  const map: Partial<Record<QuickDiagnosisCategory, Array<typeof generic>>> = {
    short_video_ip: [
      { ai: "完成IP定位，生成IP定位全案", user: "确认定位全案里的身份、事实证据和表达边界", team: "整理老板经历、客户案例和可拍摄证明素材", metric: "IP定位全案是否确认" },
      { ai: "基于IP定位生成账号主页四件套", user: "确认昵称、头像方向、简介和背景图口径", team: "按确认版替换主页素材并补齐案例证据", metric: "主页四件套是否按定位改完" },
      { ai: "基于IP定位生成第一条短视频完整内容执行包", user: "确认脚本口径、事实边界和不能夸大的表述", team: "按脚本完成拍摄、剪辑和发布准备", metric: "第一条脚本是否确认并进入拍摄" },
      { ai: "基于定位生成3条内容选题和私域承接话术", user: "确认发布口令、承接边界和客户不可承诺事项", team: "发布第一条内容并记录播放、评论、私信和加微数据", metric: "是否发布1条内容并记录承接数据" },
      { ai: "生成首条内容数据记录表和复盘判断", user: "确认数据是否真实、口径是否漏记", team: "回传播放、完播、评论、私信、加微和成交来源", metric: "数据是否能判断定位是否跑偏" },
      { ai: "按定位修正第二条短视频脚本", user: "确认上一条内容最卡的位置和修正方向", team: "补拍缺失场景或证据素材并完成剪辑", metric: "第二条脚本是否避开上一条问题" },
      { ai: "生成定位复盘表和下一轮判断", user: "确认定位是否继续、收窄还是换角度", team: "汇总7天发布、承接、投流和成交数据", metric: "是否形成第一轮定位复盘" },
      { ai: "基于复盘生成第二轮内容执行包", user: "确认第二轮主打栏目和表达边界", team: "按第二轮脚本安排拍摄、剪辑和排期", metric: "第二轮内容方向是否确认" },
      { ai: "生成私信成交跟进话术", user: "确认价格、套餐、到店和承诺边界", team: "按统一话术承接新咨询并标记客户阶段", metric: "私信是否有下一步动作" },
      { ai: "生成客户案例证据模板", user: "确认可公开的客户故事或门店场景", team: "补齐案例图片、对话截图、视频素材或数据证明", metric: "是否沉淀至少1条案例证据" },
      { ai: "生成短视频素材库清单", user: "确认每周可拍摄时间和可公开场景", team: "按清单拍摄、归档素材并标注可用栏目", metric: "素材库是否能支撑下周拍摄" },
      { ai: "生成定位数据校准表", user: "确认关注、私信、加微和成交来源统计口径", team: "补齐最近12天发布、投流、私信和成交数据", metric: "数据口径是否统一" },
      { ai: "生成短板补救脚本和投流建议", user: "确认最弱一环是主页、内容、私信还是成交", team: "按补救脚本拍摄剪辑，并按建议执行小额投流测试", metric: "短板补救动作是否明确" },
      { ai: "生成14天定位复盘和下阶段内容方向", user: "确认下一阶段继续放大或重新定位", team: "整理14天拍摄、发布、投流、承接和客户反馈", metric: "是否确定下一阶段内容方向" }
    ],
    store_acquisition: [
      { ai: "生成同城获客钩子和咨询分流话术", user: "确认主推品和到店利益点", team: "记录咨询、到店、成交数量", metric: "咨询到店链路是否开始记录" },
      { ai: "生成问价、问地址、犹豫不来三类话术", user: "抽查10条咨询记录", team: "按新话术回复新咨询", metric: "咨询回复是否统一" }
    ],
    team_management: [
      { ai: "生成岗位分工表和今日检查表", user: "指定每个岗位负责人", team: "按日清表提交结果", metric: "是否完成岗位责任确认" },
      { ai: "生成绩效检查口径和周会提纲", user: "确认奖惩和检查频率", team: "提交首日执行反馈", metric: "是否形成检查节奏" }
    ],
    franchise: [
      { ai: "生成招商漏斗体检表和首聊话术", user: "确认单店模型三组核心数据", team: "整理现有线索并分级", metric: "线索是否完成A/B/C分层" },
      { ai: "生成招商资料包目录和异议回应框架", user: "确认总部支持和培训承诺边界", team: "补齐到司、签约、掉线记录", metric: "招商资料是否成稿" }
    ],
    revenue: [
      { ai: "生成利润拆解表和成本异常检查清单", user: "补齐客单、毛利、人工、房租、投流数据", team: "记录今日收入和成本异常", metric: "利润表是否补齐" },
      { ai: "生成主推产品分层和价格观察表", user: "确认引流款、利润款、复购款", team: "记录各产品销量和毛利", metric: "产品分层是否完成" }
    ]
  };
  const sequence = map[category] ?? [];
  return sequence[(day - 1) % sequence.length] ?? generic;
}

function timelineThemesForCategory(category: QuickDiagnosisCategory) {
  if (category === "short_video_ip") {
    return [
      "IP定位",
      "主页改造",
      "首条脚本",
      "发布承接",
      "数据记录",
      "脚本修正",
      "定位复盘",
      "第二轮内容",
      "成交跟进",
      "案例证据",
      "素材沉淀",
      "数据校准",
      "补短板",
      "阶段复盘"
    ];
  }
  return [
    "确认第一关",
    "补齐数据",
    "生成交付物",
    "执行第一轮",
    "检查承接",
    "修正话术",
    "第一次复盘",
    "第二轮内容",
    "成交跟进",
    "复购承接",
    "团队检查",
    "数据校准",
    "补短板",
    "阶段复盘"
  ];
}

function timelineGoalForCategory(
  report: DiagnosisReport,
  category: QuickDiagnosisCategory,
  day: number,
  index: number
) {
  if (category === "short_video_ip") {
    const goals = [
      "先做IP定位，不直接写主页和脚本；先确认你是谁、帮谁解决什么问题、凭什么让人信。",
      "基于已确认的IP定位改主页四件套，让用户第一眼看懂账号价值和下一步入口。",
      "基于定位生成第一条可拍可发的短视频内容执行包，保证脚本服务于定位，不追随机热点。",
      "发布第一条内容并打通私信承接，开始记录播放、评论、私信和加微数据。",
      "用第一条内容数据判断定位是否跑偏，而不是只看播放量高低。",
      "按真实反馈修正第二条脚本，让内容继续服务同一个定位。",
      "完成第一轮定位复盘，决定继续放大、收窄人群还是调整表达角度。"
    ];
    return goals[index] ?? `围绕${report.weaknessTags[Math.min(report.weaknessTags.length - 1, index % Math.max(1, report.weaknessTags.length))] ?? "IP定位"}继续推进，并留下可复盘数据。`;
  }
  return day === 1
    ? `先从${report.weaknessTags[0] ?? "最急卡点"}开始，完成第一关可执行任务。`
    : `围绕${report.weaknessTags[Math.min(report.weaknessTags.length - 1, index % Math.max(1, report.weaknessTags.length))] ?? "核心短板"}推进并留下数据。`;
}

function buildExecutionFlowForCategory(category: QuickDiagnosisCategory) {
  if (category === "short_video_ip") {
    return [
      "思潼先完成IP定位：一句话定位、目标客户、人设关键词和信任证据",
      "用户确认定位和事实边界后，思潼生成主页四件套、脚本和私域话术",
      "团队按确认版执行拍摄、剪辑、发布、投流和私信承接",
      "团队回传播放、评论、私信、加微、成交来源和投流数据",
      "思潼第7天复盘定位是否跑偏，再生成第二轮内容方向"
    ];
  }
  return [
    "确认第一关目标和本轮指标",
    "思潼先生成可直接使用的交付物",
    "用户和团队按日完成线下动作",
    "每日记录数据，思潼判断是否掉线",
    "第7天做第一次复盘，决定继续放大还是返工"
  ];
}

function buildGrowthTargetsForCategory(category: QuickDiagnosisCategory, cycleDays: number) {
  if (category === "short_video_ip") {
    return [
      "第1天确认一句话定位、目标客户和信任证据",
      "第2天完成基于定位的主页四件套",
      "第3天思潼产出第一条短视频内容执行包，用户确认最终稿",
      "第4天团队完成拍摄、剪辑、发布和数据记录",
      "第7天完成第一轮定位和内容数据复盘",
      `第${cycleDays}天沉淀下一阶段内容方向`
    ];
  }
  return [
    "第1天完成第一关目标和数据口径确认",
    "第3天产出首批可执行交付物",
    "第7天形成第一份复盘记录",
    `第${cycleDays}天沉淀下一轮优化方向`
  ];
}

function buildRolesForCategory(category: QuickDiagnosisCategory): LandingSolution["roles"] {
  if (category === "short_video_ip") {
    return [
      { owner: "思潼AI", responsibility: "负责IP定位、主页四件套、短视频脚本、私域话术、复盘表、数据判断和投流建议。" },
      { owner: "用户", responsibility: "只负责确认真实信息、表达边界、最终稿和必须由老板拍板的事项。" },
      { owner: "团队", responsibility: "负责按确认稿执行拍摄、剪辑、发布、投流、私信承接和数据回传。" }
    ];
  }
  return [
    { owner: "思潼AI", responsibility: "生成文案、话术、表格、检查清单和复盘判断。" },
    { owner: "用户", responsibility: "确认关键业务事实，做必须由老板拍板的动作。" },
    { owner: "团队", responsibility: "执行门店、私域、销售、招商或交付动作，并回传数据。" }
  ];
}

function shortVideoTaskIdSuffix(day: number) {
  const suffixes = [
    "positioning",
    "homepage",
    "content-pack",
    "publish",
    "data",
    "script-revise",
    "positioning-review",
    "round-two",
    "conversion",
    "case-proof",
    "asset-bank",
    "data-calibration",
    "weakness-fix",
    "stage-review"
  ];
  return `${suffixes[day - 1] ?? "main"}-v2`;
}

function buildTimeline(
  report: DiagnosisReport,
  mode: DiagnosisMode,
  category: QuickDiagnosisCategory
): SolutionDay[] {
  const isFranchise = category === "franchise" || (mode === "deep" && report.weaknessTags.includes("招商拓店"));
  const cycleDays = isFranchise || mode === "deep" ? 30 : 14;
  const themes = timelineThemesForCategory(category);
  return Array.from({ length: cycleDays }).map((_, index) => {
    const day = index + 1;
    const task = taskTextForCategory(category, day);
    const theme = themes[index] ?? (day % 7 === 0 ? "周复盘" : "持续推进");
    const taskIdSuffix = category === "short_video_ip" ? shortVideoTaskIdSuffix(day) : "main";
    return {
      day,
      theme,
      goal: timelineGoalForCategory(report, category, day, index),
      aiTasks: [
        {
          id: `d${day}-ai-${taskIdSuffix}`,
          owner: "思潼AI",
          title: task.ai,
          detail: category === "short_video_ip" && day === 1
            ? "思潼先按IP定位skill完成专项访谈并生成标准IP定位全案，定位没确认前不直接跳到主页和脚本。"
            : category === "short_video_ip"
              ? "思潼负责生成定位、主页、脚本、话术、复盘表和投流建议；用户确认后交给团队执行。"
              : "思潼直接生成可复制内容、表格或检查清单，用户只需要确认和使用。",
          outputHint: "点击后生成今日可用交付物。"
        }
      ],
      userTasks: [
        {
          id: `d${day}-user-${taskIdSuffix}`,
          owner: "用户",
          title: task.user,
          detail: category === "short_video_ip"
            ? "用户只负责确认真实信息、事实边界和最终稿，不负责拍摄剪辑发布投流。"
            : "需要你确认真实业务信息或完成线下动作，思潼会按天提醒和复盘。"
        }
      ],
      teamTasks: [
        {
          id: `d${day}-team-${taskIdSuffix}`,
          owner: "团队",
          title: task.team,
          detail: category === "short_video_ip"
            ? "团队负责拍摄、剪辑、发布、投流、私信承接和数据回传；执行后必须留下数据。"
            : "团队执行后必须留下数据，否则下一轮无法判断是否有效。"
        }
      ],
      checkMetric: task.metric
    };
  });
}

function isSoloExecutionFeedback(feedback?: string) {
  if (!feedback) return false;
  return /一个人|单人|自己执行|我自己|本人执行|不要团队|不安排团队|暂不要安排团队|先不要安排团队|无团队|没有团队|老板自己/.test(feedback);
}

function applySolutionFeedback(solution: LandingSolution, feedback?: string): LandingSolution {
  if (!isSoloExecutionFeedback(feedback)) return solution;

  const painPoints = solution.painPointMappings.map((item) => item.pain).join("、") || "核心短板";
  const isShortVideoPositioning = solution.category === "short_video_ip" || solution.timeline[0]?.aiTasks.some((task) => task.title.includes("IP定位"));
  return {
    ...solution,
    summary: `已按你的反馈调整为单人确认版：团队动作暂不安排，优先保留思潼AI可直接生成的交付物，以及你本人必须确认的定位、事实边界和最终稿。本方案仍围绕${painPoints}推进。`,
    painPointMappings: solution.painPointMappings.map((item) => ({
      ...item,
      result: item.result.replace("让团队照着做", "你一个人也能照着做")
    })),
    executionFlow: isShortVideoPositioning
      ? [
        "先完成单人版IP定位：一句话定位、目标客户和信任证据",
        "基于定位改主页四件套",
        "基于定位生成第一条短视频内容执行包",
        "你先确认当天交付物，拍摄、发布、投流另列为待安排团队执行项",
        "第7天用播放、私信、加微数据复盘定位是否跑偏"
      ]
      : [
        "确认单人可执行的第一关目标",
        "思潼先生成可直接使用的交付物",
        "你只确认关键业务事实和当天必须做的一件事",
        "每天只记录最小数据：做了什么、产生多少咨询或反馈",
        "第7天做一次轻量复盘，决定继续放大还是返工"
      ],
    roles: [
      { owner: "思潼AI", responsibility: "生成文案、话术、表格、检查清单和复盘判断，尽量减少你手工整理。" },
      { owner: "用户", responsibility: "只做必须本人完成的确认、事实边界、最终稿和关键业务拍板。" }
    ],
    timeline: solution.timeline.map((day) => ({
      ...day,
      theme: day.theme.includes("团队") ? day.theme.replace("团队", "个人") : day.theme,
      goal: day.day === 1
        ? (day.aiTasks.some((task) => task.title.includes("IP定位"))
          ? "单人确认版也先做IP定位：先确认一句话定位、目标客户和信任证据，不安排拍摄发布投流。"
          : "先按单人确认节奏完成第一关，只保留今天必须确认的一件事。")
        : `${day.goal}（单人确认版：当天只保留用户必须确认的事项，不把拍摄发布投流安排给用户本人。）`,
      userTasks: day.userTasks.map((task) => ({
        ...task,
        title: task.title.startsWith("确认") ? task.title.replace("确认", "你本人确认") : task.title,
        detail: "单人确认版：这一步只保留你本人必须确认的事实和最终稿，拍摄发布投流不安排给用户本人。"
      })),
      teamTasks: [],
      checkMetric: `${day.checkMetric}（单人确认版）`
    }))
  };
}

function defaultIpPositioningInterview(): IpPositioningInterviewState {
  return {
    started: false,
    completed: false,
    currentIndex: 0,
    draft: "",
    answers: {}
  };
}

function isIpPositioningTask(task: SolutionTask) {
  return task.owner === "思潼AI" && (
    task.title.includes("IP定位")
    || task.title.includes("定位确认卡")
    || task.title.includes("定位卡")
  );
}

function isMeaningfulIpAnswer(value?: string) {
  const text = value?.trim() ?? "";
  if (text.length < 4) return false;
  return !/^(不知道|不清楚|不确定|都可以|都行|随便|暂无|没有|无|先不说|后面再说)$/i.test(text);
}

function ipPositioningInterviewProgress(interview?: IpPositioningInterviewState) {
  const meaningfulQuestions = ipPositioningInterviewQuestions.filter((question) => (
    isMeaningfulIpAnswer(interview?.answers[question.key])
  ));
  return {
    meaningfulAnswers: meaningfulQuestions.length,
    coveredCategories: meaningfulQuestions.length,
    total: ipPositioningInterviewQuestions.length
  };
}

function hasEnoughIpPositioningData(interview?: IpPositioningInterviewState) {
  const progress = ipPositioningInterviewProgress(interview);
  return progress.meaningfulAnswers >= 6 && progress.coveredCategories >= 5;
}

function compactIpText(value: string | undefined, fallback: string, maxLength = 86) {
  const text = value?.replace(/\s+/g, " ").trim();
  if (!text) return fallback;
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function stripIpSentenceTail(value: string) {
  return value.replace(/[。！？!?；;]+$/g, "").trim();
}

function ipSentenceFragment(
  interview: IpPositioningInterviewState | undefined,
  key: string,
  fallback: string,
  prefixes: RegExp[],
  maxLength = 64
) {
  let text = stripIpSentenceTail(compactIpText(interview?.answers[key], fallback, maxLength));
  prefixes.forEach((prefix) => {
    text = text.replace(prefix, "").trim();
  });
  return stripIpSentenceTail(text) || fallback;
}

function ipAnswer(interview: IpPositioningInterviewState | undefined, key: string, fallback: string, maxLength = 86) {
  return compactIpText(interview?.answers[key], fallback, maxLength);
}

function buildIpPositioningInterviewFacts(interview?: IpPositioningInterviewState) {
  return ipPositioningInterviewQuestions
    .map((question) => {
      const answer = interview?.answers[question.key]?.trim();
      if (!answer) return "";
      return `${question.title}：${compactIpText(answer, "待补充", 120)}`;
    })
    .filter(Boolean);
}

function classifyAiOutputAdjustment(feedback: string) {
  if (/不用改|不用调整|不需要改|不需要调整|没问题|可以了|就这样|保持/.test(feedback)) {
    return {
      decision: "recommend_keep" as const,
      focus: "保留当前版",
      analysis: "这条反馈没有指出明确业务事实变化，直接重写反而可能把已经确认的信息改散。",
      recommendation: "建议先保留当前版；如果只是担心措辞，可以只改局部表达，不重做整份交付物。"
    };
  }

  if (/客户|人群|用户|客群|宝妈|学生|老板|加盟商|年轻|家庭|同城/.test(feedback)) {
    return {
      decision: "recommend_adjust" as const,
      focus: "目标客户",
      analysis: "这条反馈会影响定位的服务对象。目标客户一变，后面的主页四件套、脚本钩子和私域承接口径都要跟着改。",
      recommendation: "建议调整，而且先只收窄目标客户，不同时大改产品卖点，避免定位失焦。"
    };
  }

  if (/定位|一句话|身份|账号|人设|主理人|老板|专家|达人/.test(feedback)) {
    return {
      decision: "recommend_adjust" as const,
      focus: "一句话定位",
      analysis: "这条反馈会影响用户第一眼如何理解账号。如果定位句不准，后续主页和脚本都会跑偏。",
      recommendation: "建议调整定位句，但保留已确认的真实证据，不要为了更好听而写成无法证明的人设。"
    };
  }

  if (/证据|案例|背书|数据|评价|反馈|经历|截图|实拍/.test(feedback)) {
    return {
      decision: "recommend_adjust" as const,
      focus: "信任证据",
      analysis: "这条反馈补充了信任依据。对短视频IP来说，证据越具体，用户越容易从围观进入私信或到店。",
      recommendation: "建议调整信任证据段，把可公开、可持续复用的证据放到定位卡前面。"
    };
  }

  if (/夸大|太大|太虚|太官方|口吻|语气|风格|不能说|不承诺|边界/.test(feedback)) {
    return {
      decision: "recommend_adjust" as const,
      focus: "表达边界",
      analysis: "这条反馈关系到能不能长期稳定执行。过度包装会短期好看，但容易让用户和团队都接不住。",
      recommendation: "建议调整表达边界，把承诺改成可验证事实，保留真实、克制、像老板说话的表达。"
    };
  }

  if (/团队|一个人|时间|预算|拍摄|剪辑|发布|投流|执行/.test(feedback)) {
    return {
      decision: "recommend_adjust" as const,
      focus: "执行资源",
      analysis: "这条反馈会影响后续落地路径。IP定位本身可以先确认，但主页、脚本和发布节奏要按真实人手改。",
      recommendation: "建议调整执行口径，不改变核心定位，只把后续任务拆成更符合当前资源的版本。"
    };
  }

  return {
    decision: "recommend_adjust" as const,
    focus: "局部口径",
    analysis: "这条反馈有调整价值，但目前更像局部口径修正，不适合推翻整版方案。",
    recommendation: "建议做局部调整：保留诊断访谈里已经确认的事实，只改你指出的那一块。"
  };
}

function stripGeneratedHeader(output: string) {
  return output
    .split("\n")
    .filter((line) => !line.startsWith("已生成：") && !line.startsWith("版本："))
    .join("\n")
    .trim();
}

function buildAdjustedAiOutput(params: {
  task: SolutionTask;
  originalOutput: string;
  feedback: string;
  version: number;
  focus: string;
  analysis: string;
  recommendation: string;
}) {
  const conciseFeedback = compactIpText(params.feedback, params.feedback, 140);
  const originalBody = stripGeneratedHeader(params.originalOutput);
  return [
    `已生成：${params.task.title}`,
    `版本：${deliverableVersionLabel(params.version)}｜按反馈讨论修订`,
    "",
    "【本轮调整依据】",
    `用户指出：${conciseFeedback}`,
    `思潼判断：${params.analysis}`,
    `思潼建议：${params.recommendation}`,
    "",
    "【本轮建议改动】",
    `1. 优先调整：${params.focus}`,
    "2. 必须保留：前面专项访谈里已经确认的真实事实和证据。",
    "3. 暂不建议：为了更好听而扩大承诺、虚构客户结果或跳过老板确认。",
    "",
    "【调整后的确认口径】",
    `这版先按「${params.focus}」修订：${conciseFeedback}`,
    "如果你拍板采用，后续主页四件套、短视频脚本、私域话术都按这个新口径继续生成；如果你不采用，系统保留当前版。",
    "",
    "【原版核心内容保留参考】",
    originalBody
  ].join("\n");
}

function buildAiOutputAdjustmentReview(task: SolutionTask, originalOutput: string, feedback: string, version: number): AiOutputAdjustmentReview {
  const result = classifyAiOutputAdjustment(feedback);
  const proposedOutput = result.decision === "recommend_adjust"
    ? buildAdjustedAiOutput({
      task,
      originalOutput,
      feedback,
      version,
      focus: result.focus,
      analysis: result.analysis,
      recommendation: result.recommendation
    })
    : originalOutput;

  return {
    feedback,
    decision: result.decision,
    focus: result.focus,
    analysis: result.analysis,
    recommendation: result.recommendation,
    proposedOutput,
    createdAt: new Date().toISOString()
  };
}

function buildLandingSolution(
  report: DiagnosisReport,
  profile: BaseProfile,
  mode: DiagnosisMode,
  category: QuickDiagnosisCategory,
  source: string,
  adjustment?: string
): LandingSolution {
  const entry = category === "franchise" || profile.role === "多门店/连锁品牌" ? v4Entries.franchise : v4Entries.local;
  const timeline = buildTimeline(report, mode, category);
  const cycleDays = timeline.length;
  const coverage = availableSkillCoverage[mode === "deep" ? "deep" : category] ?? availableSkillCoverage.store_acquisition;
  const mappings = report.weaknessTags.slice(0, 4).map((tag, index) => ({
    pain: tag,
    asset: ["诊断拆解表", "话术/文案模板", "每日执行表", "复盘看板"][index] ?? "落地清单",
    result: ["先看清漏点", "让团队照着做", "按天推进", "用数据复盘"][index] ?? "形成闭环"
  }));

  const solution: LandingSolution = {
    id: `solution_${Date.now()}`,
    title: buildSolutionDisplayTitle(profile.businessName, mode, category),
    mode,
    category,
    profileSnapshot: profile,
    source,
    cycleDays,
    summary: adjustment
      ? `已按你的反馈调整：${adjustment}。本方案仍围绕${report.weaknessTags.join("、")}推进。`
      : category === "short_video_ip"
        ? `本方案对应诊断报告里的${report.weaknessTags.join("、")}，按${cycleDays}天拆成三类任务：思潼负责出定位、主页、脚本、话术和复盘判断；用户负责确认；团队负责拍摄、剪辑、发布、投流和数据回传。`
        : `本方案对应诊断报告里的${report.weaknessTags.join("、")}，按${cycleDays}天拆成AI、用户、团队三类任务。`,
    firstLevel: timeline[0]?.goal ?? entry.timeline[0]?.focus ?? "先完成第一关任务。",
    painPointMappings: mappings.length ? mappings : [{ pain: "经营链路不清晰", asset: "经营拆解表", result: "先确定第一关" }],
    executionFlow: buildExecutionFlowForCategory(category),
    templates: buildTemplateForCategory(category),
    roles: buildRolesForCategory(category),
    unlockedCapabilities: coverage,
    growthTargets: buildGrowthTargetsForCategory(category, cycleDays),
    timeline,
    adjustments: adjustment ? [adjustment] : [],
    confirmed: false,
    createdAt: new Date().toISOString()
  };

  return applySolutionFeedback(solution, adjustment);
}

function saveSolution(solution: LandingSolution) {
  localStorage.setItem(latestSolutionKey, JSON.stringify(solution));
  localStorage.setItem("store_os_initial_diagnosis_done", "1");
  localStorage.setItem("store_os_diagnosis_done", "true");
}

function extractSolutionBusinessName(solution: LandingSolution) {
  const titleName = stripSolutionServiceTitle(solution.title);
  return solution.profileSnapshot?.businessName?.trim() || (titleName && titleName !== "企业" ? titleName : "") || "你的项目";
}

function extractPrimaryPain(solution: LandingSolution) {
  return solution.painPointMappings[0]?.pain || solution.firstLevel || "获客和成交链路不清晰";
}

function targetCustomerForSolution(solution: LandingSolution) {
  const role = solution.profileSnapshot?.role;
  if (role === "OPC单人创业者") return "需要通过内容获客和建立信任的客户";
  if (role === "多门店/连锁品牌") return "加盟商、区域合作人和高意向门店客户";
  return "同城高意向客户";
}

function positioningStatementForSolution(solution: LandingSolution) {
  const businessName = extractSolutionBusinessName(solution);
  const identity = businessName === "企业" || businessName === "你的项目" ? "这个账号" : businessName;
  const primaryPain = extractPrimaryPain(solution);
  return `${identity}要成为${targetCustomerForSolution(solution)}一眼能看懂、愿意相信的专业账号，重点看清${primaryPain}，用真实案例和可验证结果建立信任。`;
}

function evidenceDirectionForSolution(solution: LandingSolution) {
  const role = solution.profileSnapshot?.role;
  if (role === "多门店/连锁品牌") return "样板店数据、加盟商反馈、总部支持动作、门店复制案例";
  if (role === "OPC单人创业者") return "客户交付案例、运营前后对比、客户原话、你本人方法论";
  return "门店实拍、客户反馈、到店/私信/成交数据、老板本人经历";
}

function deliverableVersionLabel(version: number) {
  if (version <= 26) return `版本${String.fromCharCode(64 + Math.max(1, version))}`;
  return `第${version}版`;
}

function deliverableAngle(version: number) {
  const angles = ["信任诊断版", "案例证据版", "老板口播版", "反常识钩子版"];
  return angles[(Math.max(1, version) - 1) % angles.length];
}

function deliverableVersionLine(version: number) {
  return `版本：${deliverableVersionLabel(version)}｜${deliverableAngle(version)}`;
}

function buildShortVideoHomepageDeliverable(task: SolutionTask, solution: LandingSolution, version = 1) {
  const businessName = extractSolutionBusinessName(solution);
  const accountName = businessName === "企业" || businessName === "你的项目" ? "账号名待确认" : businessName;
  const primaryPain = extractPrimaryPain(solution);
  const positioning = positioningStatementForSolution(solution);
  const targetCustomer = targetCustomerForSolution(solution);
  const privateKeyword = version % 2 === 0 ? "体检" : "定位";
  return [
    `已生成：${task.title}`,
    deliverableVersionLine(version),
    "",
    "【基于定位的账号主页四件套】",
    `定位依据：${positioning}`,
    "",
    `1. 昵称：${accountName}｜${primaryPain}诊断`,
    "   规则：昵称要让用户第一眼知道你是谁、解决什么，不要只写品牌名或口号。",
    "2. 头像：主理人清晰半身照 / 真实门店或工作场景头像",
    "   规则：头像要服务信任，不用模糊logo、抽象图或过度修图。",
    "3. 简介三行：",
    `   第一行：我帮${targetCustomer}看清${primaryPain}`,
    `   第二行：用真实案例拆解「为什么看了不信、问了不买、来了不成交」`,
    `   第三行：私信发「${privateKeyword}」，先帮你看账号第一眼哪里漏`,
    "4. 背景图：一句结果承诺 + 真实证据",
    `   推荐文案：让${targetCustomer}第一眼看懂你、相信你、知道怎么找你`,
    "",
    "【置顶内容方向】",
    "置顶1：我是谁，为什么我懂这个问题",
    `置顶2：${primaryPain}最常见的3个误区`,
    "置顶3：一个真实案例拆解：客户从不信到愿意咨询，中间发生了什么",
    "",
    "【今天需要你确认】",
    "1. 四件套是否都指向同一句定位。",
    "2. 简介里有没有你做不到或不能证明的话。",
    `3. 私信口令是否统一为「${privateKeyword}」，后面方便统计咨询来源。`
  ].join("\n");
}

function buildShortVideoContentPackDeliverable(task: SolutionTask, solution: LandingSolution, version = 1) {
  const primaryPain = extractPrimaryPain(solution);
  const positioning = positioningStatementForSolution(solution);
  const targetCustomer = targetCustomerForSolution(solution);
  const openingAngles = [
    `如果你现在最卡的是${primaryPain}，先别急着发更多视频。`,
    "客户不咨询，不一定是内容没流量，而是第一眼没有信任理由。",
    "真正漏钱的位置，经常不是播放量，而是定位、主页和私信承接没有串起来。",
    "你的视频像不像广告，客户3秒就能感觉出来。"
  ];
  return [
    `已生成：${task.title}`,
    deliverableVersionLine(version),
    "",
    "【可直接发布的内容执行包】",
    `定位依据：${positioning}`,
    "",
    "一、选题策划",
    `选题：《${targetCustomer}刷到你以后，为什么没有继续咨询？》`,
    "角度：不是追热点，而是用一个真实问题证明你的定位。",
    "脚本类型：教知识 + 晒过程。",
    "内容任务：让用户看懂你能解决什么，并愿意去主页/私信下一步。",
    "",
    "二、口播文案",
    `开头：${openingAngles[(Math.max(1, version) - 1) % openingAngles.length]}`,
    "正文：很多账号不是没内容，而是用户刷到以后看不懂你是谁、帮谁解决什么、为什么值得信。先把定位讲清楚，再让主页接住，再让私信有下一步。",
    "结尾：你可以先私信发「定位」，我帮你看第一眼最漏的是定位、主页，还是私信承接。",
    "",
    "三、拍摄脚本",
    "镜头1：主理人正面口播，字幕打出「别急着追热点，先看定位」。",
    "镜头2：切一张纸或白板，写下「我是谁 / 帮谁 / 解决什么 / 凭什么信」。",
    "镜头3：展示一个真实案例或客户常问问题，不展示隐私信息。",
    "镜头4：回到主理人，给出私信口令。",
    "",
    "四、拍摄注意事项",
    "不要拍成广告片；要像在和一个具体客户解释问题。画面优先真实，其次清晰，最后才是好看。",
    "",
    "五、剪辑EDL",
    "0-3秒：问题钩子；4-12秒：说明误区；13-28秒：拆定位四要素；29-40秒：案例证据；41-45秒：私信口令。",
    "",
    "六、发布标题和话题",
    `标题：${primaryPain}，先别急着追热点`,
    "话题：#账号定位 #短视频获客 #老板IP #内容获客",
    "",
    "七、发布时间",
    "先选你能稳定回复私信的时间发布，优先 11:30-13:00 或 19:30-21:30。",
    "",
    "八、评论区引导话术",
    "置顶评论：如果你也不确定账号第一眼有没有讲清楚，评论「定位」，我按这4个点帮你看。",
    "",
    "九、投流建议",
    "第一条先不急着大额投流。自然发布24小时后看完播率、主页访问和私信率；如果完播率过关但私信弱，先改主页和承接，不盲目加预算。"
  ].join("\n");
}

function buildShortVideoTopicDeliverable(task: SolutionTask, solution: LandingSolution, version = 1) {
  const primaryPain = extractPrimaryPain(solution);
  const positioning = positioningStatementForSolution(solution);
  return [
    `已生成：${task.title}`,
    deliverableVersionLine(version),
    "",
    `定位依据：${positioning}`,
    "",
    "【3条可拍选题】",
    `1. 《为什么你一直发视频，客户还是不咨询？》切入点：把${primaryPain}讲成客户看得懂的问题。`,
    "2. 《主页最容易漏掉的4个位置》切入点：昵称、头像、简介、背景图是否指向同一个定位。",
    "3. 《客户问了价格就消失，通常卡在这一步》切入点：私信承接没有继续推进。",
    "",
    "【私域承接话术】",
    "客户：多少钱？",
    "回复：我先不急着给你报套餐，先确认你现在是想解决获客、成交，还是复购？不同问题价格和动作都不一样，我怕给你推荐错。",
    "",
    "客户：你们在哪？",
    "回复：我们在[城市/商圈]，你方便的话我先问你两个情况，判断你适不适合到店体验，避免你白跑。",
    "",
    "【今天检查】",
    "发布后只记录3个数：播放、私信、加微。不要只看播放量。"
  ].join("\n");
}

function buildStoreAcquisitionDeliverable(task: SolutionTask, version = 1) {
  return [
    `已生成：${task.title}`,
    deliverableVersionLine(version),
    "",
    "【同城获客钩子】",
    "本周到店报暗号「体检」，可先做一次免费问题判断。适合最近客流下滑、咨询变少、老客复购变弱的老板。",
    "",
    "【咨询分流话术】",
    "你现在最想解决的是没新客、客户只问不来，还是来了不成交？我先按这个判断你卡在哪一段。",
    "",
    "【今日记录表】",
    "来源｜咨询数｜到店数｜成交数｜未成交原因｜负责人"
  ].join("\n");
}

function buildGenericAiDeliverable(task: SolutionTask, solution: LandingSolution, version = 1) {
  return [
    `已生成：${task.title}`,
    deliverableVersionLine(version),
    "",
    "【今日可用交付物】",
    `核心卡点：${extractPrimaryPain(solution)}`,
    "执行口径：今天只推进一个动作，避免多线开工导致无法复盘。",
    "",
    "【复制给负责人】",
    `今天先完成「${task.title}」。完成后只回传三项：做了什么、产生多少数据、遇到什么卡点。`,
    "",
    "【复盘记录表】",
    "动作｜负责人｜完成数｜咨询/成交/反馈｜异常原因｜明天是否继续"
  ].join("\n");
}

function buildAiOutput(task: SolutionTask, solution: LandingSolution, version = 1) {
  if (task.title.includes("主页四件套")) {
    return buildShortVideoHomepageDeliverable(task, solution, version);
  }
  if (task.title.includes("短视频完整内容执行包")) {
    return buildShortVideoContentPackDeliverable(task, solution, version);
  }
  if (isIpPositioningTask(task)) {
    return "这一步必须调用 ip_positioning skill 生成《IP定位全案》，不能使用前端本地模板。";
  }
  if (task.title.includes("内容选题") || task.title.includes("私域承接话术")) {
    return buildShortVideoTopicDeliverable(task, solution, version);
  }
  if (task.title.includes("同城获客") || task.title.includes("咨询分流话术")) {
    return buildStoreAcquisitionDeliverable(task, version);
  }
  return buildGenericAiDeliverable(task, solution, version);
}

const skillInvokeApiPath = apiPath("/skill/invoke");
const postLoginRedirectKey = "store_os_post_login_redirect";

function redirectToLoginFromCurrentPage() {
  localStorage.setItem(
    postLoginRedirectKey,
    `${window.location.pathname}${window.location.search}${window.location.hash}`
  );
  window.location.href = getAppPath("/login");
}

function skillEntryForProfile(profile: BaseProfile) {
  return profile.role === "多门店/连锁品牌" ? "franchise" : "local";
}

function compactReportForSkill(report: DiagnosisReport | null) {
  if (!report) return null;
  return {
    title: report.title,
    mode: report.mode,
    categoryLabel: report.categoryLabel,
    summary: report.summary,
    riskLevel: report.riskLevel,
    weaknessTags: report.weaknessTags,
    scores: report.scores,
    businessStatus: report.businessStatus,
    currentLeaks: report.currentLeaks,
    profitGap: report.profitGap,
    potentialRisks: report.potentialRisks,
    industryGap: report.industryGap,
    missingData: report.missingData
  };
}

function buildIpPositioningSkillParams({
  task,
  profile,
  report,
  solution,
  interview,
  diagnosisAnswers,
  version,
  feedback,
  currentOutput
}: {
  task: SolutionTask;
  profile: BaseProfile;
  report: DiagnosisReport | null;
  solution: LandingSolution;
  interview: IpPositioningInterviewState;
  diagnosisAnswers: string[];
  version: number;
  feedback?: string;
  currentOutput?: string;
}) {
  const progress = ipPositioningInterviewProgress(interview);
  const interviewDimensions = ipPositioningInterviewQuestions.map((question) => ({
    key: question.key,
    dimension: question.title,
    capture: question.capture,
    answer: interview.answers[question.key]?.trim() || "待补"
  }));

  return {
    task: feedback ? "复核用户调整意见，并按IP定位skill决定是否修订全案" : "生成标准IP定位全案",
    pageTaskTitle: task.title,
    version,
    profile,
    diagnosisReport: compactReportForSkill(report),
    diagnosisInterviewAnswers: diagnosisAnswers.filter(Boolean),
    landingSolutionContext: {
      title: solution.title,
      summary: solution.summary,
      firstLevel: solution.firstLevel,
      painPointMappings: solution.painPointMappings,
      executionFlow: solution.executionFlow,
      growthTargets: solution.growthTargets
    },
    ipPositioningInterview: {
      meaningfulAnswers: progress.meaningfulAnswers,
      coveredCategories: progress.coveredCategories,
      total: progress.total,
      dimensions: interviewDimensions
    },
    currentOutput,
    userAdjustmentRequest: feedback,
    hardRequirements: [
      "必须严格调用 ip_positioning skill 的标准访谈流程和标准方案输出结构。",
      "这是落地页 Day 1 的正式交付物，不允许输出前端简化版定位确认卡。",
      "如果信息仍不足，只能先消化确认并追问1个最关键问题；不要硬编完整方案。",
      "如果信息足够，必须输出《IP定位全案 · 项目/品牌名》。",
      "最终全案必须包含：1分钟速览表；一、项目定位；二、目标用户定位；三、IP人设定位；四、内容定位；五、选题方向；六、投流建议；七、IP发展规划；八、执行建议。",
      "选题方向必须达到样板深度：信任型不少于22个，认知型不少于22个，连接型不少于22个，转化型不少于14个；同时给TOP10优先选题和30天选题日历。",
      "所有事实只能来自用户已回答内容、诊断报告和当前上下文；没有的数据写待补或标注基于已有信息推断。"
    ]
  };
}

async function invokeSkillOutput(skillId: "ip_positioning", entry: "local" | "franchise", params: Record<string, unknown>) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = localStorage.getItem("store_os_token");
  if (!token) {
    redirectToLoginFromCurrentPage();
    throw new Error("需要先登录或完成企业入驻，正在打开登录页面。");
  }
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(skillInvokeApiPath, {
    method: "POST",
    headers,
    body: JSON.stringify({
      skill_id: skillId,
      entry,
      params
    })
  });
  const data = (await response.json().catch(() => ({}))) as SkillInvokeResponse;
  if (response.status === 401 || data.error === "login_required") {
    localStorage.removeItem("store_os_token");
    redirectToLoginFromCurrentPage();
    throw new Error("登录状态已失效，正在打开登录页面。");
  }
  if (!response.ok || data.status === "failed") {
    throw new Error(data.message || data.error || `skill调用失败：${response.status}`);
  }
  const answer = data.result?.answer?.trim();
  if (!answer) throw new Error("skill没有返回可展示内容，请稍后重试。");
  return answer;
}

function isLegacyIpPositioningOutput(output: string) {
  return /IP定位确认卡|定位确认卡|已生成：完成IP定位|【访谈依据】/.test(output) && !/IP定位全案/.test(output);
}

function skillAnswerSuggestsKeep(answer: string) {
  return /建议先保留|不建议调整|无需调整|先保留当前版|不建议改/.test(answer.slice(0, 800));
}

function getQuestionList(mode: DiagnosisMode, category: QuickDiagnosisCategory): InterviewQuestion[] {
  if (mode === "deep") return [profileInterviewQuestion, ...deepQuestions];
  return [profileInterviewQuestion, ...quickQuestionMap[category], ...quickDepthFollowupMap[category]];
}

function buildInterviewAnswers(questions: InterviewQuestion[], answers: string[]): string[] {
  return questions.map((question, index) => {
    const answer = answers[index]?.trim();
    return answer ? `${question.title}：${answer}` : "";
  });
}

const insufficientDiagnosisAnswers = new Set([
  "不知道",
  "不清楚",
  "不确定",
  "没有",
  "无",
  "暂时没有",
  "还没想好",
  "说不清",
  "随便",
  "测试",
  "瞎写",
  "乱写",
  "test"
]);

function normalizeDiagnosisAnswerInput(answer: string) {
  return stripAnswerPrefix(answer).replace(/\s+/g, " ").trim();
}

function isObviouslyInvalidDiagnosisAnswer(answer: string) {
  const value = normalizeDiagnosisAnswerInput(answer);
  if (value.length < 2) return true;
  if (/^(.)\1{2,}$/.test(value)) return true;
  if (/^(test|asdf|qwer|demo|xxx|瞎写|乱写|随便|哈哈|呵呵)$/i.test(value)) return true;
  if (/^[0-9\s.,，。！？!?'"]{1,10}$/.test(value)) return true;
  return false;
}

function isMeaningfulDiagnosisAnswer(answer: string) {
  const value = normalizeDiagnosisAnswerInput(answer);
  if (!value || isObviouslyInvalidDiagnosisAnswer(value)) return false;
  if (insufficientDiagnosisAnswers.has(value)) return false;
  const chineseChars = value.match(/[\u4e00-\u9fa5]/g)?.length ?? 0;
  const digitChars = value.match(/\d/g)?.length ?? 0;
  const businessSignals = /营收|客流|客单|毛利|利润|成本|现金流|客户|成交|私信|加微|到店|复购|转介绍|门店|团队|员工|老板|岗位|投流|内容|视频|账号|主页|定位|案例|价格|供应链|库存|招商|加盟|线索|行业|城市|产品|服务|数据|转化|来源|投诉|好评/.test(value);
  const concreteSignals = /第|个|家|年|月|天|%|％|万|w|W|元|人|单|条|次|店|城/.test(value);
  return chineseChars >= 4 && value.length >= 10 && (businessSignals || digitChars > 0 || concreteSignals || value.length >= 22);
}

function getDiagnosisAnswerQuality(answers: string[], totalQuestions: number) {
  const filledCount = answers.filter((answer) => normalizeDiagnosisAnswerInput(answer)).length;
  const meaningfulCount = answers.filter(isMeaningfulDiagnosisAnswer).length;
  const requiredCount = Math.max(4, Math.ceil(totalQuestions * 0.65));
  return {
    filledCount,
    meaningfulCount,
    requiredCount,
    enough: meaningfulCount >= requiredCount
  };
}

function syncDiagnosisUrl(mode: DiagnosisMode, category: QuickDiagnosisCategory) {
  const params = new URLSearchParams();
  params.set("mode", mode);
  if (mode === "quick") params.set("category", category);
  window.history.replaceState(null, "", `/diagnosis?${params.toString()}`);
}

const knownCityWords = ["北京", "上海", "广州", "深圳", "杭州", "成都", "重庆", "武汉", "西安", "南京", "苏州", "天津", "郑州", "长沙", "青岛", "大连", "沈阳", "厦门", "福州", "济南", "合肥", "昆明", "南宁", "宁波", "无锡", "佛山", "东莞", "石家庄", "哈尔滨", "长春", "太原", "贵阳", "南昌"];
const knownIndustryWords = ["IP打造", "短视频IP", "短视频", "内容获客", "账号运营", "餐饮", "火锅", "烤肉", "美业", "教培", "零售", "服务", "招商", "加盟", "OPC"];
const invalidCityCandidates = ["价格", "价格上", "效果", "内容", "客户", "主页", "私信", "视频", "账号", "流量", "成交", "问题", "案例"];

function inferCityFromText(text: string) {
  const known = knownCityWords.find((word) => text.includes(word));
  if (known) return known;
  const explicit = text.match(/(?:城市|位于|在)([\u4e00-\u9fa5]{2,6})(?:市|做|开|，|,|\s|$)/)?.[1];
  if (!explicit || invalidCityCandidates.some((word) => explicit.includes(word))) return "";
  return explicit;
}

function inferRevenueLabelFromText(text: string) {
  const range = text.match(/(\d+(?:\.\d+)?)\s*(?:-|~|—|到|至)\s*(\d+(?:\.\d+)?)\s*(?:w|W|万)(?:\s*\/?\s*月|每月|月)?/);
  if (range) return `${range[1]}-${range[2]}万/月`;
  const single = text.match(/(\d+(?:\.\d+)?)\s*(?:w|W|万)(?:\s*\/?\s*月|每月|月)?/);
  return single ? `${single[1]}万/月` : "";
}

function deriveProfileFromInterview(base: BaseProfile, reportAnswers: string[]): BaseProfile {
  const text = reportAnswers.join(" ");
  const profileText = stripAnswerPrefix(reportAnswers.find((answer) => answerTitle(answer) === "基础画像") ?? "") || text;
  const businessMatch = text.match(/(?:叫|品牌是|门店是|我是|我们是)([\u4e00-\u9fa5A-Za-z0-9·-]{2,16})/);
  const industry = base.industry || knownIndustryWords.find((word) => profileText.toLowerCase().includes(word.toLowerCase())) || knownIndustryWords.find((word) => text.toLowerCase().includes(word.toLowerCase())) || "";
  return {
    ...base,
    businessName: base.businessName || businessMatch?.[1] || "",
    industry,
    city: base.city || inferCityFromText(profileText) || inferCityFromText(text),
    monthlyRevenue: base.monthlyRevenue || inferRevenueLabelFromText(profileText) || inferRevenueLabelFromText(text)
  };
}

function interviewProgressLabel(current: number, total: number) {
  return `第${Math.min(current + 1, total)}轮 / 共${total}轮`;
}

function interviewDepthPath(mode: DiagnosisMode, category: QuickDiagnosisCategory) {
  if (mode === "deep") return "路径：基础画像 → 六大板块 → 数据证据 → 经营风险 → 行业差距";
  const map: Record<QuickDiagnosisCategory, string> = {
    short_video_ip: "路径：账号定位 → 内容数据 → 主页入口 → 私域承接 → 成交证据 → 复盘缺口",
    store_acquisition: "路径：新客来源 → 获客漏斗 → 进店理由 → 咨询流失 → 复购转介绍 → 渠道ROI",
    team_management: "路径：岗位分工 → 老板时间 → 管理节奏 → 培训复制 → 奖惩挂钩 → 店长层",
    franchise: "路径：单店模型 → 招商漏斗 → 加盟信任 → 线索分级 → 成交资料 → 开店成活",
    revenue: "路径：营收趋势 → 成本压力 → 产品利润 → 盈亏平衡 → 毛利结构 → 现金周期 → ROI复盘"
  };
  return map[category];
}

function statusLabel(status?: TaskStatus) {
  if (status === "review") return "待确认";
  if (status === "done") return "已完成";
  if (status === "remind") return "提醒待办";
  return "待执行";
}

function statusClass(status?: TaskStatus) {
  if (status === "review") return "review";
  if (status === "done") return "done";
  if (status === "remind") return "remind";
  return "pending";
}

function reportFromSolutionForMigration(solution: LandingSolution, category: QuickDiagnosisCategory): DiagnosisReport {
  const weaknessTags = solution.painPointMappings.map((item) => item.pain).filter(Boolean);
  return {
    title: `${extractSolutionBusinessName(solution)} 迁移诊断`,
    mode: solution.mode ?? "quick",
    categoryLabel: quickDiagnosisCategories.find((item) => item.id === category)?.title,
    summary: solution.summary,
    businessStatus: [],
    currentLeaks: [],
    profitGap: "",
    potentialRisks: [],
    industryGap: [],
    riskLevel: "中风险",
    weaknessTags: weaknessTags.length ? weaknessTags : ["定位信任", "内容数据", "私域承接"],
    scores: [],
    missingData: []
  };
}

function normalizeStoredSolutionForCategory(
  solution: LandingSolution | null,
  category: QuickDiagnosisCategory
) {
  if (!solution || category !== "short_video_ip") return solution;
  const firstAiTask = solution.timeline[0]?.aiTasks[0]?.title ?? "";
  const oldUserExecution = solution.timeline.some((day) =>
    day.userTasks.some((task) => /完成拍摄|拍摄或录制|发布第一条内容|完成发布|执行投流|投流测试/.test(task.title))
  );
  const hasTeamTasks = solution.timeline.some((day) => day.teamTasks.length > 0);
  const oldRoleCopy = hasTeamTasks && !solution.roles.some((role) =>
    role.owner === "团队" && role.responsibility.includes("拍摄") && role.responsibility.includes("剪辑") && role.responsibility.includes("投流")
  );
  if (firstAiTask.includes("IP定位") && !oldUserExecution && !oldRoleCopy) return solution;

  const migrationReport = reportFromSolutionForMigration(solution, category);
  const timeline = buildTimeline(migrationReport, solution.mode ?? "quick", category);
  const nextSolution: LandingSolution = {
    ...solution,
    category,
    mode: solution.mode ?? "quick",
    summary: solution.adjustments.length
      ? solution.summary
      : `本方案对应诊断报告里的${migrationReport.weaknessTags.join("、")}，按${timeline.length}天拆成三类任务：思潼负责出定位、主页、脚本、话术和复盘判断；用户负责确认；团队负责拍摄、剪辑、发布、投流和数据回传。`,
    firstLevel: timeline[0]?.goal ?? "先完成IP定位。",
    executionFlow: buildExecutionFlowForCategory(category),
    templates: buildTemplateForCategory(category),
    roles: buildRolesForCategory(category),
    growthTargets: buildGrowthTargetsForCategory(category, timeline.length),
    timeline
  };
  const soloFeedback = solution.adjustments.find((item) => isSoloExecutionFeedback(item));
  return soloFeedback ? applySolutionFeedback(nextSolution, soloFeedback) : nextSolution;
}

export default function FlywheelDiagnosisApp() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const [mode, setMode] = useState<DiagnosisMode>(() => normalizeMode(params.get("mode")));
  const [category, setCategory] = useState<QuickDiagnosisCategory>(() => normalizeCategory(params.get("category")));
  const storedSolution = useMemo(
    () => normalizeStoredSolutionForCategory(readStoredJson<LandingSolution>(latestSolutionKey), normalizeCategory(params.get("category"))),
    [params]
  );
  const [stage, setStage] = useState<Stage>(() => {
    if (window.location.hash === "#solution" && storedSolution) return "solution";
    if (window.location.hash === "#implementation" && storedSolution) return "implementation";
    return "form";
  });
  const [profile, setProfile] = useState<BaseProfile>(baseProfileDefault);
  const [answers, setAnswers] = useState<string[]>([]);
  const [report, setReport] = useState<DiagnosisReport | null>(() => readStoredJson<DiagnosisReport>(latestReportKey));
  const [solution, setSolution] = useState<LandingSolution | null>(storedSolution);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [adjustment, setAdjustment] = useState("");
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [currentInterviewInput, setCurrentInterviewInput] = useState("");
  const [diagnosisQualityError, setDiagnosisQualityError] = useState("");
  const [activeDay, setActiveDay] = useState(1);
  const [taskStatus, setTaskStatus] = useState<Record<string, TaskStatus>>(() => readStoredJson<Record<string, TaskStatus>>(latestTaskStatusKey) ?? {});
  const [taskReminders, setTaskReminders] = useState<TaskReminder[]>(() => readStoredJson<TaskReminder[]>(latestTaskRemindersKey) ?? []);
  const [aiOutputs, setAiOutputs] = useState<Record<string, string>>(() => readStoredJson<Record<string, string>>(latestAiOutputsKey) ?? {});
  const [aiOutputVersions, setAiOutputVersions] = useState<Record<string, number>>(() => readStoredJson<Record<string, number>>(latestAiOutputVersionsKey) ?? {});
  const [aiOutputLoading, setAiOutputLoading] = useState<Record<string, boolean>>({});
  const [aiOutputErrors, setAiOutputErrors] = useState<Record<string, string>>({});
  const [ipPositioningInterviews, setIpPositioningInterviews] = useState<Record<string, IpPositioningInterviewState>>(
    () => readStoredJson<Record<string, IpPositioningInterviewState>>(latestIpPositioningInterviewsKey) ?? {}
  );
  const [aiOutputAdjustmentDrafts, setAiOutputAdjustmentDrafts] = useState<Record<string, string>>({});
  const [aiOutputAdjustmentReviews, setAiOutputAdjustmentReviews] = useState<Record<string, AiOutputAdjustmentReview>>(
    () => readStoredJson<Record<string, AiOutputAdjustmentReview>>(latestAiOutputAdjustmentReviewsKey) ?? {}
  );

  const currentQuestions = getQuestionList(mode, category);
  const activeInterviewQuestion = currentQuestions[currentQuestionIndex] ?? currentQuestions[0];
  const completedInterviewCount = answers.filter((answer) => answer.trim()).length;
  const currentDiagnosisQuality = getDiagnosisAnswerQuality(buildInterviewAnswers(currentQuestions, answers), currentQuestions.length);
  const modeInfo = diagnosisModes.find((item) => item.id === mode);
  const categoryInfo = quickDiagnosisCategories.find((item) => item.id === category);
  const activeDayPlan = solution?.timeline.find((day) => day.day === activeDay) ?? solution?.timeline[0];
  const solutionTaskIds = useMemo(
    () => solution?.timeline.flatMap((day) => [...day.aiTasks, ...day.userTasks, ...day.teamTasks].map((task) => task.id)) ?? [],
    [solution]
  );
  const isSoloSolution = solution ? solution.timeline.every((day) => day.teamTasks.length === 0) : false;
  const visibleReminders = useMemo(
    () => taskReminders.filter((reminder) => solutionTaskIds.includes(reminder.taskId)),
    [solutionTaskIds, taskReminders]
  );
  const activeReminderCount = visibleReminders.filter((reminder) => reminder.status === "active").length;
  const progress = solution
    ? Math.round((solutionTaskIds.filter((taskId) => taskStatus[taskId] === "done").length / Math.max(1, solutionTaskIds.length)) * 100)
    : 0;

  useEffect(() => {
    if (!solution) return;
    const normalized = normalizeStoredSolutionForCategory(solution, category);
    if (!normalized || normalized === solution) return;
    saveSolution(normalized);
    setSolution(normalized);
    setAiOutputs({});
    setAiOutputVersions({});
    setAiOutputLoading({});
    setAiOutputErrors({});
    setTaskStatus({});
    setTaskReminders([]);
    setIpPositioningInterviews({});
    setAiOutputAdjustmentDrafts({});
    setAiOutputAdjustmentReviews({});
    setActiveDay(1);
    localStorage.removeItem(latestAiOutputsKey);
    localStorage.removeItem(latestAiOutputVersionsKey);
    localStorage.removeItem(latestTaskStatusKey);
    localStorage.removeItem(latestTaskRemindersKey);
    localStorage.removeItem(latestIpPositioningInterviewsKey);
    localStorage.removeItem(latestAiOutputAdjustmentReviewsKey);
  }, [category, solution]);

  useEffect(() => {
    if (!solution) return;
    const ipTaskIds = solution.timeline.flatMap((day) => day.aiTasks).filter(isIpPositioningTask).map((task) => task.id);
    if (ipTaskIds.length === 0) return;
    const staleTaskIds = ipTaskIds.filter((taskId) => {
      const output = aiOutputs[taskId];
      if (!output) return false;
      return !ipPositioningInterviews[taskId]?.completed || isLegacyIpPositioningOutput(output);
    });
    if (staleTaskIds.length === 0) return;

    setAiOutputs((prev) => {
      const next = { ...prev };
      staleTaskIds.forEach((taskId) => delete next[taskId]);
      localStorage.setItem(latestAiOutputsKey, JSON.stringify(next));
      return next;
    });
    setAiOutputVersions((prev) => {
      const next = { ...prev };
      staleTaskIds.forEach((taskId) => delete next[taskId]);
      persistAiOutputVersions(next);
      return next;
    });
    setTaskStatus((prev) => {
      const next = { ...prev };
      staleTaskIds.forEach((taskId) => delete next[taskId]);
      persistTaskStatus(next);
      return next;
    });
    setAiOutputAdjustmentDrafts((prev) => {
      const next = { ...prev };
      staleTaskIds.forEach((taskId) => delete next[taskId]);
      return next;
    });
    setAiOutputAdjustmentReviews((prev) => {
      const next = { ...prev };
      staleTaskIds.forEach((taskId) => delete next[taskId]);
      localStorage.setItem(latestAiOutputAdjustmentReviewsKey, JSON.stringify(next));
      return next;
    });
  }, [aiOutputs, ipPositioningInterviews, solution]);

  function changeMode(nextMode: DiagnosisMode) {
    setMode(nextMode);
    syncDiagnosisUrl(nextMode, category);
    setCurrentQuestionIndex(0);
    setAnswers([]);
    setCurrentInterviewInput("");
    setDiagnosisQualityError("");
  }

  function changeCategory(nextCategory: QuickDiagnosisCategory) {
    setCategory(nextCategory);
    syncDiagnosisUrl("quick", nextCategory);
    setCurrentQuestionIndex(0);
    setAnswers([]);
    setCurrentInterviewInput("");
    setDiagnosisQualityError("");
  }

  function saveInterviewAnswer() {
    const trimmedInput = currentInterviewInput.trim();
    if (!trimmedInput) return;
    if (isObviouslyInvalidDiagnosisAnswer(trimmedInput)) {
      setDiagnosisQualityError("这轮信息太少或像测试内容，思潼没法据此做专业判断。请补充一个真实经营事实，比如城市、客户、成交、营收、团队或数据。");
      return;
    }
    setDiagnosisQualityError("");
    setAnswers((prev) => {
      const next = [...prev];
      next[currentQuestionIndex] = trimmedInput;
      return next;
    });
    setCurrentInterviewInput("");
    if (currentQuestionIndex < currentQuestions.length - 1) {
      setCurrentQuestionIndex((prev) => prev + 1);
      return;
    }
    void generateReport(buildInterviewAnswers(currentQuestions, [
      ...answers.slice(0, currentQuestionIndex),
      trimmedInput
    ]));
  }

  function editInterviewAnswer(index: number) {
    setCurrentQuestionIndex(index);
    setCurrentInterviewInput(answers[index] ?? "");
  }

  async function generateReport(answerOverride?: string[]) {
    const reportAnswers = answerOverride ?? buildInterviewAnswers(currentQuestions, answers);
    const quality = getDiagnosisAnswerQuality(reportAnswers, currentQuestions.length);
    if (!quality.enough) {
      setDiagnosisQualityError(`现在有效经营事实只有 ${quality.meaningfulCount}/${quality.requiredCount} 条，还不能生成专业诊断报告。请继续补充真实业务情况，思潼会把“没问到”和“没给出”的信息分开判断。`);
      setStage("form");
      return;
    }
    setDiagnosisQualityError("");
    const effectiveProfile = deriveProfileFromInterview(profile, reportAnswers);
    setProfile(effectiveProfile);
    const fallback = buildProfessionalReport(effectiveProfile, mode, category, reportAnswers);
    setStage("generating");
    window.scrollTo({ top: 0, behavior: "smooth" });
    try {
      const res = await fetch(apiPath("/diagnosis/flywheel-report"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, category, profile: effectiveProfile, answers: reportAnswers })
      });
      const data = (await res.json().catch(() => ({}))) as { report?: Partial<DiagnosisReport>; message?: string };
      if (!res.ok) {
        if (res.status === 422) {
          setDiagnosisQualityError(data.message || "有效经营信息不足，暂时不能生成专业诊断报告。请继续补充真实业务事实。");
          setStage("form");
          return;
        }
        throw new Error(data.message || `诊断报告生成失败：${res.status}`);
      }
      const nextReport = normalizeRemoteReport(data.report ?? null, fallback);
      saveReport(nextReport);
      setReport(nextReport);
    } catch {
      saveReport(fallback);
      setReport(fallback);
    }
    setStage("report");
  }

  function unlockSolution(source: string) {
    if (!report) return;
    const nextSolution = buildLandingSolution(report, profile, mode, category, source);
    saveSolution(nextSolution);
    setSolution(nextSolution);
    setAiOutputs({});
    setAiOutputVersions({});
    setAiOutputLoading({});
    setAiOutputErrors({});
    setTaskStatus({});
    setTaskReminders([]);
    setIpPositioningInterviews({});
    setAiOutputAdjustmentDrafts({});
    setAiOutputAdjustmentReviews({});
    localStorage.removeItem(latestAiOutputsKey);
    localStorage.removeItem(latestAiOutputVersionsKey);
    localStorage.removeItem(latestTaskStatusKey);
    localStorage.removeItem(latestTaskRemindersKey);
    localStorage.removeItem(latestIpPositioningInterviewsKey);
    localStorage.removeItem(latestAiOutputAdjustmentReviewsKey);
    setPaywallOpen(false);
    setStage("solution");
    window.location.hash = "solution";
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function adjustCurrentSolution() {
    if (!report || !adjustment.trim()) return;
    const nextSolution = buildLandingSolution(report, profile, mode, category, solution?.source ?? "方案调整", adjustment.trim());
    nextSolution.adjustments = [...(solution?.adjustments ?? []), adjustment.trim()];
    saveSolution(nextSolution);
    setSolution(nextSolution);
    setAiOutputs({});
    setAiOutputVersions({});
    setAiOutputLoading({});
    setAiOutputErrors({});
    setTaskStatus({});
    setTaskReminders([]);
    setIpPositioningInterviews({});
    setAiOutputAdjustmentDrafts({});
    setAiOutputAdjustmentReviews({});
    setActiveDay(1);
    localStorage.removeItem(latestAiOutputsKey);
    localStorage.removeItem(latestAiOutputVersionsKey);
    localStorage.removeItem(latestTaskStatusKey);
    localStorage.removeItem(latestTaskRemindersKey);
    localStorage.removeItem(latestIpPositioningInterviewsKey);
    localStorage.removeItem(latestAiOutputAdjustmentReviewsKey);
    setAdjustment("");
  }

  function confirmSolution() {
    if (!solution) return;
    const confirmed = { ...solution, confirmed: true };
    saveSolution(confirmed);
    setSolution(confirmed);
    setStage("implementation");
    window.location.hash = "implementation";
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function persistTaskStatus(next: Record<string, TaskStatus>) {
    localStorage.setItem(latestTaskStatusKey, JSON.stringify(next));
  }

  function persistTaskReminders(next: TaskReminder[]) {
    localStorage.setItem(latestTaskRemindersKey, JSON.stringify(next));
  }

  function persistAiOutputVersions(next: Record<string, number>) {
    localStorage.setItem(latestAiOutputVersionsKey, JSON.stringify(next));
  }

  function persistIpPositioningInterviews(next: Record<string, IpPositioningInterviewState>) {
    localStorage.setItem(latestIpPositioningInterviewsKey, JSON.stringify(next));
  }

  function persistAiOutputAdjustmentReviews(next: Record<string, AiOutputAdjustmentReview>) {
    localStorage.setItem(latestAiOutputAdjustmentReviewsKey, JSON.stringify(next));
  }

  function markTask(task: SolutionTask, status: TaskStatus) {
    setTaskStatus((prev) => {
      const next = { ...prev, [task.id]: status };
      persistTaskStatus(next);
      return next;
    });

    if (status === "remind") {
      const reminder: TaskReminder = {
        id: task.id,
        taskId: task.id,
        taskTitle: task.title,
        owner: task.owner,
        day: activeDayPlan?.day ?? activeDay,
        dayTheme: activeDayPlan?.theme ?? `Day ${activeDay}`,
        dueLabel: "今天收工前检查",
        status: "active",
        createdAt: new Date().toISOString()
      };
      setTaskReminders((prev) => {
        const next = [reminder, ...prev.filter((item) => item.taskId !== task.id)];
        persistTaskReminders(next);
        return next;
      });
      return;
    }

    if (status === "done") {
      setTaskReminders((prev) => {
        const next = prev.map((item) => item.taskId === task.id ? { ...item, status: "done" as const } : item);
        persistTaskReminders(next);
        return next;
      });
    }
  }

  function commitAiOutput(task: SolutionTask, output: string, nextVersion: number) {
    setAiOutputs((prev) => {
      const next = { ...prev, [task.id]: output };
      localStorage.setItem(latestAiOutputsKey, JSON.stringify(next));
      return next;
    });
    setAiOutputVersions((prev) => {
      const next = { ...prev, [task.id]: nextVersion };
      persistAiOutputVersions(next);
      return next;
    });
    setAiOutputAdjustmentDrafts((prev) => ({ ...prev, [task.id]: "" }));
    setAiOutputAdjustmentReviews((prev) => {
      const next = { ...prev };
      delete next[task.id];
      persistAiOutputAdjustmentReviews(next);
      return next;
    });
    markTask(task, "review");
  }

  function generateAiOutput(task: SolutionTask, nextVersion: number) {
    if (!solution) return;
    const output = buildAiOutput(task, solution, nextVersion);
    commitAiOutput(task, output, nextVersion);
  }

  async function generateIpPositioningSkillOutput(task: SolutionTask, nextVersion: number, completedInterview: IpPositioningInterviewState) {
    if (!solution) return;
    setAiOutputLoading((prev) => ({ ...prev, [task.id]: true }));
    setAiOutputErrors((prev) => {
      const next = { ...prev };
      delete next[task.id];
      return next;
    });

    try {
      const output = await invokeSkillOutput("ip_positioning", skillEntryForProfile(profile), buildIpPositioningSkillParams({
        task,
        profile,
        report,
        solution,
        interview: completedInterview,
        diagnosisAnswers: buildInterviewAnswers(currentQuestions, answers),
        version: nextVersion
      }) as Record<string, unknown>);
      commitAiOutput(task, output, nextVersion);
    } catch (error) {
      setAiOutputErrors((prev) => ({
        ...prev,
        [task.id]: error instanceof Error ? error.message : "思潼暂时没能调用IP定位skill，请稍后重试。"
      }));
    } finally {
      setAiOutputLoading((prev) => ({ ...prev, [task.id]: false }));
    }
  }

  function startIpPositioningInterview(task: SolutionTask) {
    setIpPositioningInterviews((prev) => {
      const existing = prev[task.id] ?? defaultIpPositioningInterview();
      const activeQuestion = ipPositioningInterviewQuestions[existing.currentIndex] ?? ipPositioningInterviewQuestions[0];
      const next = {
        ...prev,
        [task.id]: {
          ...existing,
          started: true,
          draft: existing.draft || existing.answers[activeQuestion.key] || ""
        }
      };
      persistIpPositioningInterviews(next);
      return next;
    });
  }

  function updateIpPositioningDraft(task: SolutionTask, draft: string) {
    setIpPositioningInterviews((prev) => {
      const existing = prev[task.id] ?? { ...defaultIpPositioningInterview(), started: true };
      const next = { ...prev, [task.id]: { ...existing, started: true, draft } };
      persistIpPositioningInterviews(next);
      return next;
    });
  }

  function submitIpPositioningAnswer(task: SolutionTask) {
    setIpPositioningInterviews((prev) => {
      const existing = prev[task.id] ?? { ...defaultIpPositioningInterview(), started: true };
      const activeQuestion = ipPositioningInterviewQuestions[existing.currentIndex] ?? ipPositioningInterviewQuestions[0];
      const answer = existing.draft.trim();
      if (!answer) return prev;
      const answers = { ...existing.answers, [activeQuestion.key]: answer };
      const nextIncompleteIndex = ipPositioningInterviewQuestions.findIndex((question) => !isMeaningfulIpAnswer(answers[question.key]));
      const enough = hasEnoughIpPositioningData({ ...existing, answers });
      const nextIndex = enough
        ? existing.currentIndex
        : nextIncompleteIndex >= 0
          ? nextIncompleteIndex
          : Math.min(existing.currentIndex + 1, ipPositioningInterviewQuestions.length - 1);
      const nextState: IpPositioningInterviewState = {
        ...existing,
        started: true,
        completed: enough,
        answers,
        currentIndex: nextIndex,
        draft: enough ? "" : (answers[ipPositioningInterviewQuestions[nextIndex]?.key] ?? "")
      };
      const next = { ...prev, [task.id]: nextState };
      persistIpPositioningInterviews(next);
      return next;
    });
  }

  function backIpPositioningQuestion(task: SolutionTask) {
    setIpPositioningInterviews((prev) => {
      const existing = prev[task.id] ?? { ...defaultIpPositioningInterview(), started: true };
      const nextIndex = Math.max(0, existing.currentIndex - 1);
      const nextQuestion = ipPositioningInterviewQuestions[nextIndex] ?? ipPositioningInterviewQuestions[0];
      const next = {
        ...prev,
        [task.id]: {
          ...existing,
          started: true,
          currentIndex: nextIndex,
          draft: existing.answers[nextQuestion.key] ?? ""
        }
      };
      persistIpPositioningInterviews(next);
      return next;
    });
  }

  async function runAiTask(task: SolutionTask) {
    if (!solution) return;
    if (isIpPositioningTask(task)) {
      const interview = ipPositioningInterviews[task.id];
      if (!hasEnoughIpPositioningData(interview)) {
        startIpPositioningInterview(task);
        return;
      }
      const completedInterview: IpPositioningInterviewState = {
        ...(interview ?? defaultIpPositioningInterview()),
        started: true,
        completed: true
      };
      setIpPositioningInterviews((prev) => {
        const next = { ...prev, [task.id]: completedInterview };
        persistIpPositioningInterviews(next);
        return next;
      });
      const nextVersion = (aiOutputVersions[task.id] ?? (aiOutputs[task.id] ? 1 : 0)) + 1;
      await generateIpPositioningSkillOutput(task, nextVersion, completedInterview);
      return;
    }

    const nextVersion = (aiOutputVersions[task.id] ?? (aiOutputs[task.id] ? 1 : 0)) + 1;
    generateAiOutput(task, nextVersion);
  }

  function startAiOutputAdjustment(task: SolutionTask) {
    setAiOutputAdjustmentDrafts((prev) => ({ ...prev, [task.id]: prev[task.id] ?? "" }));
  }

  function updateAiOutputAdjustmentDraft(task: SolutionTask, draft: string) {
    setAiOutputAdjustmentDrafts((prev) => ({ ...prev, [task.id]: draft }));
  }

  async function analyzeAiOutputAdjustment(task: SolutionTask) {
    const output = aiOutputs[task.id];
    const feedback = aiOutputAdjustmentDrafts[task.id]?.trim();
    if (!output || !feedback) return;
    const proposedVersion = (aiOutputVersions[task.id] ?? 1) + 1;

    if (isIpPositioningTask(task) && solution) {
      const interview = ipPositioningInterviews[task.id] ?? defaultIpPositioningInterview();
      setAiOutputLoading((prev) => ({ ...prev, [task.id]: true }));
      setAiOutputErrors((prev) => {
        const next = { ...prev };
        delete next[task.id];
        return next;
      });

      try {
        const answer = await invokeSkillOutput("ip_positioning", skillEntryForProfile(profile), buildIpPositioningSkillParams({
          task,
          profile,
          report,
          solution,
          interview,
          diagnosisAnswers: buildInterviewAnswers(currentQuestions, answers),
          version: proposedVersion,
          feedback,
          currentOutput: output
        }) as Record<string, unknown>);
        const shouldKeep = skillAnswerSuggestsKeep(answer);
        const review: AiOutputAdjustmentReview = {
          feedback,
          decision: shouldKeep ? "recommend_keep" : "recommend_adjust",
          focus: "IP定位skill复核",
          analysis: shouldKeep
            ? answer
            : "思潼已按你的调整意见重新调用 IP 定位 skill 复核；如果你认可下面这版，再点击采用，最终仍由你拍板。",
          recommendation: shouldKeep
            ? "建议先保留当前版；如果你仍坚持调整，可以继续说明更具体的原因。"
            : "建议采用下面这版修订稿；如果仍不满意，可以继续指出要调整的部分。",
          proposedOutput: shouldKeep ? output : answer,
          createdAt: new Date().toISOString()
        };
        setAiOutputAdjustmentReviews((prev) => {
          const next = { ...prev, [task.id]: review };
          persistAiOutputAdjustmentReviews(next);
          return next;
        });
      } catch (error) {
        setAiOutputErrors((prev) => ({
          ...prev,
          [task.id]: error instanceof Error ? error.message : "思潼暂时没能调用IP定位skill复核，请稍后重试。"
        }));
      } finally {
        setAiOutputLoading((prev) => ({ ...prev, [task.id]: false }));
      }
      return;
    }

    const review = buildAiOutputAdjustmentReview(task, output, feedback, proposedVersion);
    setAiOutputAdjustmentReviews((prev) => {
      const next = { ...prev, [task.id]: review };
      persistAiOutputAdjustmentReviews(next);
      return next;
    });
  }

  function acceptAiOutputAdjustment(task: SolutionTask) {
    const review = aiOutputAdjustmentReviews[task.id];
    if (!review || review.decision !== "recommend_adjust") return;
    const nextVersion = (aiOutputVersions[task.id] ?? 1) + 1;
    setAiOutputs((prev) => {
      const next = { ...prev, [task.id]: review.proposedOutput };
      localStorage.setItem(latestAiOutputsKey, JSON.stringify(next));
      return next;
    });
    setAiOutputVersions((prev) => {
      const next = { ...prev, [task.id]: nextVersion };
      persistAiOutputVersions(next);
      return next;
    });
    setAiOutputAdjustmentDrafts((prev) => ({ ...prev, [task.id]: "" }));
    setAiOutputAdjustmentReviews((prev) => {
      const next = { ...prev };
      delete next[task.id];
      persistAiOutputAdjustmentReviews(next);
      return next;
    });
    markTask(task, "review");
  }

  function keepCurrentAiOutput(task: SolutionTask) {
    setAiOutputAdjustmentDrafts((prev) => ({ ...prev, [task.id]: "" }));
    setAiOutputAdjustmentReviews((prev) => {
      const next = { ...prev };
      delete next[task.id];
      persistAiOutputAdjustmentReviews(next);
      return next;
    });
    markTask(task, "review");
  }

  function confirmAiOutput(task: SolutionTask) {
    markTask(task, "done");
  }

  function openReminder(reminder: TaskReminder) {
    setActiveDay(reminder.day);
    window.setTimeout(() => {
      document.querySelector(".dayDetail")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  }

  function completeReminder(reminder: TaskReminder) {
    setTaskStatus((prev) => {
      const next = { ...prev, [reminder.taskId]: "done" as const };
      persistTaskStatus(next);
      return next;
    });
    setTaskReminders((prev) => {
      const next = prev.map((item) => item.taskId === reminder.taskId ? { ...item, status: "done" as const } : item);
      persistTaskReminders(next);
      return next;
    });
  }

  return (
    <div className="flywheelDiagnosis">
      <header className="diagnosisTop">
        <button onClick={() => window.location.href = "/"}>思潼企业AI增长飞轮</button>
        <span>诊断和报告永久免费，不扣积分、不占会员额度</span>
      </header>

      {stage === "form" && (
        <main className="diagnosisFormShell">
          <section className="diagnosisIntroPanel">
            <img src={sitongChiefAvatar} alt="思潼" />
            <p className="flywheelEyebrow">免费经营体检</p>
            <h1>{modeInfo?.title}</h1>
            <p>{modeInfo?.subtitle}</p>
            <div className="modeSwitch" aria-label="选择诊断模式">
              <button className={mode === "quick" ? "active" : ""} onClick={() => changeMode("quick")}>
                单项快速诊断
              </button>
              <button className={mode === "deep" ? "active" : ""} onClick={() => changeMode("deep")}>
                全企业深度诊断
              </button>
            </div>
            {mode === "quick" && (
              <div className="quickCategorySelect" aria-label="单项诊断类目">
                {quickDiagnosisCategories.map((item) => (
                  <button
                    key={item.id}
                    className={category === item.id ? "active" : ""}
                    onClick={() => changeCategory(item.id)}
                  >
                    <strong>{item.title}</strong>
                    <span>{item.description}</span>
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="diagnosisQuestionPanel interviewPanel">
            <div className="interviewTopBar">
              <div>
                <span>{mode === "quick" ? categoryInfo?.title : "全企业六大板块访谈"}</span>
                <strong>{interviewProgressLabel(currentQuestionIndex, currentQuestions.length)}</strong>
              </div>
              <div className="interviewProgressDots" aria-label="访谈进度">
                {currentQuestions.map((question, index) => (
                  <button
                    key={question.key}
                    className={index === currentQuestionIndex ? "active" : answers[index]?.trim() ? "done" : ""}
                    onClick={() => answers[index]?.trim() && editInterviewAnswer(index)}
                    aria-label={`${question.title}${answers[index]?.trim() ? "已回答" : "未回答"}`}
                  />
                ))}
              </div>
            </div>
            <p className="interviewDepthPath">{interviewDepthPath(mode, category)}</p>

            <div className="interviewChat">
              {currentQuestions.slice(0, currentQuestionIndex).map((question, index) => (
                <div className="interviewRound" key={question.key}>
                  <article className="advisorInterviewBubble compact">
                    <img src={sitongChiefAvatar} alt="思潼" />
                    <div>
                      <span>思潼问 · {question.title}</span>
                      <p>{question.prompt}</p>
                    </div>
                  </article>
                  <article className="userInterviewBubble">
                    <p>{answers[index]}</p>
                    <button onClick={() => editInterviewAnswer(index)}>修改这一轮</button>
                  </article>
                  <article className="advisorInterviewBubble compact feedback">
                    <img src={sitongChiefAvatar} alt="思潼" />
                    <div>
                      <span>思潼已记录</span>
                      <p>{question.afterAnswer}</p>
                    </div>
                  </article>
                </div>
              ))}

              {activeInterviewQuestion && (
                <article className="advisorInterviewBubble current">
                  <img src={sitongChiefAvatar} alt="思潼" />
                  <div>
                    <span>思潼访谈 · {activeInterviewQuestion.title}</span>
                    <p>{activeInterviewQuestion.empathy}</p>
                    <strong>{activeInterviewQuestion.prompt}</strong>
                    <em>{activeInterviewQuestion.why}</em>
                  </div>
                </article>
              )}
            </div>

            {activeInterviewQuestion && (
              <div className="interviewCueGrid">
                <div>
                  <span>这一轮我会听什么</span>
                  <div>{activeInterviewQuestion.probes.map((item) => <b key={item}>{item}</b>)}</div>
                </div>
                <div>
                  <span>最好能带上的数字</span>
                  <div>{activeInterviewQuestion.dataPoints.map((item) => <b key={item}>{item}</b>)}</div>
                </div>
                <div>
                  <span>我会重点识别的风险</span>
                  <div>{activeInterviewQuestion.riskSignals.map((item) => <b key={item}>{item}</b>)}</div>
                </div>
              </div>
            )}

            <div className="interviewComposer">
              <textarea
                rows={4}
                value={currentInterviewInput}
                onChange={(event) => setCurrentInterviewInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    saveInterviewAnswer();
                  }
                }}
                placeholder="像聊天一样回答就行。按 Enter 发送，Shift+Enter 换行。"
              />
              <div>
                <button className="secondaryAction" onClick={() => setCurrentQuestionIndex((prev) => Math.max(0, prev - 1))} disabled={currentQuestionIndex === 0}>
                  上一轮
                </button>
                <button className="generateReportButton" onClick={saveInterviewAnswer} disabled={!currentInterviewInput.trim()}>
                  {currentQuestionIndex >= currentQuestions.length - 1 ? "完成访谈，生成报告" : "回答这一轮"}
                </button>
                {currentDiagnosisQuality.enough && (
                  <button className="textOnlyAction" onClick={() => void generateReport()}>
                    信息够了，先出诊断报告
                  </button>
                )}
                {!currentDiagnosisQuality.enough && completedInterviewCount >= 2 && (
                  <small className="diagnosisQualityHint">
                    有效经营事实 {currentDiagnosisQuality.meaningfulCount}/{currentDiagnosisQuality.requiredCount}，继续聊完再出报告。
                  </small>
                )}
              </div>
              {diagnosisQualityError && <p className="diagnosisQualityError">{diagnosisQualityError}</p>}
            </div>
          </section>
        </main>
      )}

      {stage === "generating" && (
        <main className="diagnosisReportShell">
          <section className="reportHeroPanel">
              <div>
                <p className="flywheelEyebrow">正在诊断</p>
                <h1>思潼正在做经营体检</h1>
              <p>正在按专项方法论梳理现状、漏洞、盈利缺口和经营风险。</p>
              </div>
            <div className="riskBadge">
              <span>分析中</span>
              <strong>...</strong>
            </div>
          </section>
        </main>
      )}

      {stage === "report" && report && (
        <main className="diagnosisReportShell">
          <section className="reportHeroPanel">
            <div>
              <p className="flywheelEyebrow">免费诊断报告</p>
              <h1>{report.title}</h1>
              <p>{report.summary}</p>
              <p>报告按已确认事实、后续量化口径和风险推断拆开呈现，方便先看清问题。</p>
            </div>
            <div className={`riskBadge risk${report.riskLevel}`}>
              <span>风险等级</span>
              <strong>{report.riskLevel}</strong>
            </div>
          </section>

          <section className="reportScoreGrid">
            {report.scores.map((score) => (
              <ScoreCard key={score.dimension} score={score} />
            ))}
          </section>

          <ReportVisualSummary report={report} />

          <section className="reportPaywallNotice">
            <div>
              <p className="flywheelEyebrow">下一步付费资产</p>
              <h2>生成{solutionServiceTitleForMode(mode, category)}</h2>
              <p>方案会逐条对应诊断痛点，包含分步执行流程、文案模板、人员分工、闯关任务和阶段增长目标。</p>
            </div>
            <button onClick={() => setPaywallOpen(true)}>解锁并生成方案</button>
          </section>

          <section className="trialCreditNotice">
            <strong>新账号注册即赠送{FREE_TRIAL_CREDITS}积分</strong>
            <span>可兑换1套全企业落地方案，完整体验诊断、报告、方案和简易落地闭环。</span>
          </section>
        </main>
      )}

      {stage === "solution" && solution && (
        <main className="solutionShell">
          <section className="solutionHeroPanel">
            <div>
              <p className="flywheelEyebrow">{solutionServiceTitleForMode(solution.mode ?? mode, solution.category ?? category)}</p>
              <h1>{displaySolutionTitle(solution, mode, category)}</h1>
              <p>{solution.summary}</p>
              <strong>第一关：{solution.firstLevel}</strong>
            </div>
            <div className="solutionMeta">
              <span>{solution.cycleDays}天陪跑</span>
              <span>{solution.source}</span>
              <span>{solution.confirmed ? "已确认" : "待确认"}</span>
            </div>
          </section>

          <section className="solutionGrid">
            <div className="solutionPanel">
              <h2>痛点对应交付物</h2>
              {solution.painPointMappings.map((item) => (
                <article key={`${item.pain}-${item.asset}`}>
                  <strong>{item.pain}</strong>
                  <span>{item.asset}</span>
                  <p>{item.result}</p>
                </article>
              ))}
            </div>
            <div className="solutionPanel">
              <h2>执行流程</h2>
              <ol>
                {solution.executionFlow.map((step) => <li key={step}>{step}</li>)}
              </ol>
            </div>
          </section>

          <section className="solutionGrid">
            <div className="solutionPanel">
              <h2>可复用模板</h2>
              {solution.templates.map((template) => (
                <article key={template.title}>
                  <strong>{template.title}</strong>
                  <p>{template.content}</p>
                </article>
              ))}
            </div>
            <div className="solutionPanel">
              <h2>分工和解锁能力</h2>
              {solution.roles.map((role) => (
                <article key={role.owner}>
                  <strong>{role.owner}</strong>
                  <p>{role.responsibility}</p>
                </article>
              ))}
              <div className="capabilityChips">
                {solution.unlockedCapabilities.map((item) => <span key={item}>{item}</span>)}
              </div>
            </div>
          </section>

          <section className="solutionPanel">
            <h2>阶段增长目标</h2>
            <div className="growthTargetGrid">
              {solution.growthTargets.map((target) => <span key={target}>{target}</span>)}
            </div>
          </section>

          <section className="solutionAdjustPanel">
            <div>
              <h2>确认或调整方案</h2>
              <p>如果目标、资源、人手或周期不对，可以先写反馈，思潼会重排方案。确认最终版后进入逐日落地页。</p>
            </div>
            <textarea value={adjustment} onChange={(event) => setAdjustment(event.target.value)} placeholder="例如：我只有一个人执行，先不要安排团队动作；或先做短视频获客，不做投流。" />
            <div>
              <button className="secondaryAction" onClick={adjustCurrentSolution} disabled={!adjustment.trim()}>按反馈调整方案</button>
              <button className="generateReportButton" onClick={confirmSolution}>确认最终版，进入落地</button>
            </div>
            {solution.adjustments.length > 0 && (
              <div className="solutionAdjustmentNotice">
                <strong>{isSoloSolution ? "已切换为单人确认版" : "已应用你的调整"}</strong>
                <p>{solution.summary}</p>
                <div>
                  {solution.adjustments.map((item, index) => (
                    <span key={`${item}-${index}`}>反馈{index + 1}：{item}</span>
                  ))}
                </div>
              </div>
            )}
          </section>
        </main>
      )}

      {stage === "implementation" && solution && (
        <main className="implementationShell">
          <section className="implementationHeader">
            <div>
              <p className="flywheelEyebrow">逐日落地陪跑</p>
              <h1>{displaySolutionTitle(solution, mode, category)}</h1>
              <p>{isSoloSolution
                ? "思潼AI能直接做的任务会在这里生成；需要你本人确认的事项会逐日列出来，拍摄发布投流不安排给用户本人。"
                : solution.category === "short_video_ip"
                  ? "思潼AI负责生成定位、主页、脚本、话术和复盘判断；你负责确认，团队负责拍摄、剪辑、发布、投流、承接和数据回传。"
                  : "思潼AI能直接做的任务会在这里生成；需要你或团队执行的任务会逐日列出来，完成后回传结果。"}</p>
            </div>
            <div className="progressPanel">
              <span>整体进度</span>
              <strong>{progress}%</strong>
              <em>{activeReminderCount > 0 ? `${activeReminderCount} 个提醒待办` : "暂无提醒待办"}</em>
              <i><b style={{ width: `${progress}%` }} /></i>
            </div>
          </section>

          <section className="reminderPanel">
            <div>
              <p className="flywheelEyebrow">思潼提醒待办</p>
              <h2>提醒会出现在这里</h2>
              <span>当前是页面内提醒，会保存到本机；后续接企业微信或短信后，再做外部推送。</span>
            </div>
            {visibleReminders.length > 0 ? (
              <div className="reminderList">
                {visibleReminders.map((reminder) => (
                  <article key={reminder.id} className={reminder.status === "done" ? "done" : ""}>
                    <div>
                      <span>{reminder.status === "done" ? "已完成" : "待提醒"} · Day {reminder.day} {reminder.dayTheme}</span>
                      <strong>{reminder.taskTitle}</strong>
                      <p>{reminder.owner}任务｜{reminder.dueLabel}</p>
                    </div>
                    <aside>
                      <button onClick={() => openReminder(reminder)}>查看任务</button>
                      {reminder.status !== "done" && <button onClick={() => completeReminder(reminder)}>标记完成</button>}
                    </aside>
                  </article>
                ))}
              </div>
            ) : (
              <div className="emptyReminder">
                <strong>还没有提醒</strong>
                <p>点击任一任务的“加入提醒”，它会出现在这里。</p>
              </div>
            )}
          </section>

          <section className="implementationGrid">
            <aside className="dayRail">
              {solution.timeline.map((day) => (
                <button key={day.day} className={activeDay === day.day ? "active" : ""} onClick={() => setActiveDay(day.day)}>
                  <span>Day {day.day}</span>
                  <strong>{day.theme}</strong>
                </button>
              ))}
            </aside>

            {activeDayPlan && (
              <section className="dayDetail">
                <div className="dayDetailHead">
                  <span>Day {activeDayPlan.day}</span>
                  <h2>{activeDayPlan.theme}</h2>
                  <p>{activeDayPlan.goal}</p>
                  <strong>今日检查指标：{activeDayPlan.checkMetric}</strong>
                </div>

                <TaskGroup
                  title="思潼AI直接落地"
                  tasks={activeDayPlan.aiTasks}
                  taskStatus={taskStatus}
                  aiOutputs={aiOutputs}
                  aiOutputVersions={aiOutputVersions}
                  aiOutputLoading={aiOutputLoading}
                  aiOutputErrors={aiOutputErrors}
                  ipPositioningInterviews={ipPositioningInterviews}
                  aiOutputAdjustmentDrafts={aiOutputAdjustmentDrafts}
                  aiOutputAdjustmentReviews={aiOutputAdjustmentReviews}
                  onRunAiTask={runAiTask}
                  onUpdateIpPositioningDraft={updateIpPositioningDraft}
                  onSubmitIpPositioningAnswer={submitIpPositioningAnswer}
                  onBackIpPositioningQuestion={backIpPositioningQuestion}
                  onConfirmAiOutput={confirmAiOutput}
                  onStartAiOutputAdjustment={startAiOutputAdjustment}
                  onUpdateAiOutputAdjustmentDraft={updateAiOutputAdjustmentDraft}
                  onAnalyzeAiOutputAdjustment={analyzeAiOutputAdjustment}
                  onAcceptAiOutputAdjustment={acceptAiOutputAdjustment}
                  onKeepCurrentAiOutput={keepCurrentAiOutput}
                  onMarkTask={markTask}
                />
                <TaskGroup
                  title="需要用户完成"
                  tasks={activeDayPlan.userTasks}
                  taskStatus={taskStatus}
                  onMarkTask={markTask}
                />
                {activeDayPlan.teamTasks.length > 0 ? (
                  <TaskGroup
                    title="需要团队配合"
                    tasks={activeDayPlan.teamTasks}
                    taskStatus={taskStatus}
                    onMarkTask={markTask}
                  />
                ) : (
                  <div className="soloTaskNotice">
                    <strong>单人确认版已隐藏团队执行任务</strong>
                    <p>这一版只保留思潼AI可直接完成的交付物，以及你本人当天必须确认的事项。</p>
                  </div>
                )}
              </section>
            )}
          </section>
        </main>
      )}

      {paywallOpen && report && (
        <div className="diagnosisPickerLayer" role="dialog" aria-modal="true" aria-label={`解锁${solutionServiceTitleForMode(mode, category)}`}>
          <section className="solutionPaywall">
            <button className="modalClose" onClick={() => setPaywallOpen(false)} aria-label="关闭">×</button>
            <p className="flywheelEyebrow">按实际调用扣积分，积分不足时再充值</p>
            <h2>解锁后立即生成方案</h2>
            <p className="paywallLead">生成后会进入方案确认页，可调整目标、人手和周期，最终确认后进入逐日落地。</p>
            <div className="paywallCards">
              {membershipOffers.map((plan) => (
                <article key={plan.code} className={plan.highlighted ? "paywallPrimary" : ""}>
                  <span>{plan.highlighted ? "首选推荐" : "按积分使用"}</span>
                  <strong>{plan.name} · 不收月费</strong>
                  <em>{plan.audience}</em>
                  <p>{plan.benefits.join(" / ")}</p>
                  <button onClick={() => unlockSolution(`${plan.name}权益`)}>开通并生成方案</button>
                </article>
              ))}
              <article className="creditFallback">
                <span>积分兑换</span>
                {creditOffers.map((offer) => <p key={offer.code}>{offer.price}元={offer.credits}积分</p>)}
                <button onClick={() => unlockSolution(`${FREE_TRIAL_CREDITS}积分兑换`)}>用积分生成方案</button>
              </article>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function parseScoreEvidence(evidence: string) {
  const confirmed = evidence.match(/已确认：([\s\S]*?)(?:。(?:缺失证据|待量化)：|$)/)?.[1]?.trim();
  const missing = evidence.match(/(?:缺失证据|待量化)：([\s\S]*?)(?:。判断：|$)/)?.[1]?.trim();
  const judgement = evidence.match(/判断：([\s\S]*)/)?.[1]?.trim();
  if (confirmed || missing || judgement) {
    return {
      confirmed: confirmed || "当前访谈信息不足",
      missing: missing || "连续数据和责任人口径",
      judgement: judgement || "暂不能证明已经形成稳定闭环。"
    };
  }
  return {
    confirmed: evidence,
    missing: "连续数据和责任人口径",
    judgement: "需要结合更多经营事实复核。"
  };
}

function scoreRiskPercent(score: number) {
  return Math.max(8, Math.min(100, 100 - score));
}

function scoreStatusCount(scores: ReportScore[], status: ScoreStatus) {
  return scores.filter((score) => score.status === status).length;
}

function ReportVisualSummary({ report }: { report: DiagnosisReport }) {
  const redCount = scoreStatusCount(report.scores, "红灯");
  const yellowCount = scoreStatusCount(report.scores, "黄灯");
  const greenCount = scoreStatusCount(report.scores, "绿灯");
  const total = Math.max(1, report.scores.length);
  const weakest = [...report.scores].sort((a, b) => a.score - b.score).slice(0, 3);

  return (
    <section className="reportVisualGrid">
      <article className="reportChartCard wide">
        <div className="chartCardHead">
          <div>
            <span>短板风险图</span>
            <h2>哪几个环节最需要优先盯住</h2>
          </div>
          <strong>{report.riskLevel}</strong>
        </div>
        <div className="riskBarList">
          {report.scores.map((score) => (
            <div className="riskBarRow" key={score.dimension}>
              <span>{score.dimension}</span>
              <div aria-label={`${score.dimension}风险强度`}>
                <b className={`bar${score.status}`} style={{ width: `${scoreRiskPercent(score.score)}%` }} />
              </div>
              <em>{score.score}</em>
            </div>
          ))}
        </div>
      </article>

      <article className="reportChartCard">
        <div className="chartCardHead">
          <div>
            <span>风险分布</span>
            <h2>红黄绿占比</h2>
          </div>
        </div>
        <div className="riskStack" aria-label="风险等级分布">
          <i className="stackRed" style={{ width: `${(redCount / total) * 100}%` }} />
          <i className="stackYellow" style={{ width: `${(yellowCount / total) * 100}%` }} />
          <i className="stackGreen" style={{ width: `${(greenCount / total) * 100}%` }} />
        </div>
        <div className="riskLegend">
          <span><b className="legendRed" />红灯 {redCount}</span>
          <span><b className="legendYellow" />黄灯 {yellowCount}</span>
          <span><b className="legendGreen" />绿灯 {greenCount}</span>
        </div>
      </article>

      <article className="reportChartCard">
        <div className="chartCardHead">
          <div>
            <span>经营画像</span>
            <h2>访谈基础盘</h2>
          </div>
        </div>
        <div className="profileFactList">
          {report.businessStatus.slice(0, 3).map((item, index) => <p key={`profile-${index}`}>{item}</p>)}
        </div>
      </article>

      <article className="reportChartCard wide">
        <div className="chartCardHead">
          <div>
            <span>证据链状态</span>
            <h2>已采集事实与后续量化口径</h2>
          </div>
        </div>
        <div className="evidenceMatrix">
          {weakest.map((score) => {
            const evidence = parseScoreEvidence(score.evidence);
            return (
              <div className="evidenceMatrixRow" key={score.dimension}>
                <strong>{score.dimension}</strong>
                <p><span>已采集</span>{evidence.confirmed}</p>
                <p><span>后续量化</span>{evidence.missing}</p>
              </div>
            );
          })}
        </div>
      </article>

      <article className="reportChartCard">
        <div className="chartCardHead">
          <div>
            <span>盈利缺口</span>
            <h2>当前漏损口径</h2>
          </div>
        </div>
        <p className="chartNarrative">{report.profitGap}</p>
      </article>

      <article className="reportChartCard">
        <div className="chartCardHead">
          <div>
            <span>行业对标</span>
            <h2>成熟商家通常怎么记录</h2>
          </div>
        </div>
        <ul className="compactReportList">
          {report.industryGap.map((item, index) => <li key={`gap-${index}`}>{item}</li>)}
        </ul>
      </article>
    </section>
  );
}

function ScoreCard({ score }: { score: ReportScore }) {
  const evidence = parseScoreEvidence(score.evidence);
  return (
    <article className={`scoreCard status${score.status}`}>
      <div className="scoreCardHead">
        <div>
          <span className="scoreStatusBadge">{score.status}</span>
          <strong>{score.dimension}</strong>
        </div>
        <em>{score.score}</em>
      </div>
      <div className="scoreEvidenceGrid">
        <section className="scoreEvidenceBlock">
          <span>已确认</span>
          <p>{evidence.confirmed}</p>
        </section>
        <section className="scoreEvidenceBlock">
          <span>后续量化</span>
          <p>{evidence.missing}</p>
        </section>
        <section className="scoreEvidenceBlock judgement">
          <span>判断</span>
          <p>{evidence.judgement}</p>
        </section>
      </div>
    </article>
  );
}

function TaskGroup({
  title,
  tasks,
  taskStatus,
  aiOutputs,
  aiOutputVersions,
  aiOutputLoading,
  aiOutputErrors,
  ipPositioningInterviews,
  aiOutputAdjustmentDrafts,
  aiOutputAdjustmentReviews,
  onRunAiTask,
  onUpdateIpPositioningDraft,
  onSubmitIpPositioningAnswer,
  onBackIpPositioningQuestion,
  onConfirmAiOutput,
  onStartAiOutputAdjustment,
  onUpdateAiOutputAdjustmentDraft,
  onAnalyzeAiOutputAdjustment,
  onAcceptAiOutputAdjustment,
  onKeepCurrentAiOutput,
  onMarkTask
}: {
  title: string;
  tasks: SolutionTask[];
  taskStatus: Record<string, TaskStatus>;
  aiOutputs?: Record<string, string>;
  aiOutputVersions?: Record<string, number>;
  aiOutputLoading?: Record<string, boolean>;
  aiOutputErrors?: Record<string, string>;
  ipPositioningInterviews?: Record<string, IpPositioningInterviewState>;
  aiOutputAdjustmentDrafts?: Record<string, string>;
  aiOutputAdjustmentReviews?: Record<string, AiOutputAdjustmentReview>;
  onRunAiTask?: (task: SolutionTask) => void | Promise<void>;
  onUpdateIpPositioningDraft?: (task: SolutionTask, draft: string) => void;
  onSubmitIpPositioningAnswer?: (task: SolutionTask) => void;
  onBackIpPositioningQuestion?: (task: SolutionTask) => void;
  onConfirmAiOutput?: (task: SolutionTask) => void;
  onStartAiOutputAdjustment?: (task: SolutionTask) => void;
  onUpdateAiOutputAdjustmentDraft?: (task: SolutionTask, draft: string) => void;
  onAnalyzeAiOutputAdjustment?: (task: SolutionTask) => void | Promise<void>;
  onAcceptAiOutputAdjustment?: (task: SolutionTask) => void;
  onKeepCurrentAiOutput?: (task: SolutionTask) => void;
  onMarkTask: (task: SolutionTask, status: TaskStatus) => void;
}) {
  return (
    <div className="taskGroup">
      <h3>{title}</h3>
      {tasks.map((task) => {
        const current = taskStatus[task.id];
        const output = aiOutputs?.[task.id];
        const outputVersion = aiOutputVersions?.[task.id] ?? (output ? 1 : 0);
        const isOutputLoading = Boolean(aiOutputLoading?.[task.id]);
        const taskOutputError = aiOutputErrors?.[task.id];
        const requiresOutputReview = Boolean(output && current === "review");
        const adjustmentDraft = aiOutputAdjustmentDrafts?.[task.id] ?? "";
        const adjustmentReview = aiOutputAdjustmentReviews?.[task.id];
        const isPositioningTask = isIpPositioningTask(task);
        const ipInterview = ipPositioningInterviews?.[task.id];
        const ipProgress = ipPositioningInterviewProgress(ipInterview);
        const activeIpQuestion = ipPositioningInterviewQuestions[ipInterview?.currentIndex ?? 0] ?? ipPositioningInterviewQuestions[0];
        const hasEnoughIpData = hasEnoughIpPositioningData(ipInterview);
        const showIpInterview = Boolean(isPositioningTask && ipInterview?.started && !output);
        const aiActionLabel = isOutputLoading
          ? "思潼调用中"
          : output
          ? "提出调整"
          : isPositioningTask
            ? hasEnoughIpData
              ? "生成IP定位全案"
              : ipInterview?.started
                ? "继续访谈"
                : "开始定位访谈"
            : "让思潼执行";
        return (
          <article key={task.id} className={`implementationTask ${statusClass(current)}`}>
            <div>
              <span>{task.owner}</span>
              <strong>{task.title}</strong>
              <p>{task.detail}</p>
              {task.outputHint && <em>{task.outputHint}</em>}
              {taskOutputError && <p className="taskOutputError">{taskOutputError}</p>}
              {isOutputLoading && <p className="taskOutputPending">思潼正在调用 IP 定位 skill，请稍等。</p>}
              {showIpInterview && (
                <section className="ipPositioningInterview">
                  <div className="ipInterviewHead">
                    <div>
                      <span>思潼访谈 · IP定位专项</span>
                      <strong>已完成 {ipProgress.meaningfulAnswers}/6 轮有效调研</strong>
                    </div>
                    <p>先访谈，再定位。资料不够时，思潼不会硬编主页和脚本。</p>
                  </div>

                  <div className="ipInterviewCoverage" aria-label="IP定位访谈覆盖项">
                    {ipPositioningInterviewQuestions.map((question, index) => (
                      <span
                        key={question.key}
                        className={[
                          index === ipInterview?.currentIndex ? "active" : "",
                          isMeaningfulIpAnswer(ipInterview?.answers[question.key]) ? "done" : ""
                        ].filter(Boolean).join(" ")}
                      >
                        {question.capture}
                      </span>
                    ))}
                  </div>

                  {hasEnoughIpData ? (
                    <div className="ipInterviewReady">
                      <strong>信息够了，可以调用 IP 定位 skill 生成全案。</strong>
                      <p>这一版会基于刚才的专项访谈生成标准《IP定位全案》；生成后你可以确认采用，也可以指出哪里不准，让思潼先判断是否需要调整。</p>
                      <div>
                        <button onClick={() => onBackIpPositioningQuestion?.(task)}>修改上一轮</button>
                        <button onClick={() => void onRunAiTask?.(task)} disabled={isOutputLoading}>生成IP定位全案</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="ipInterviewCoach">
                        <span>第 {(ipInterview?.currentIndex ?? 0) + 1} 轮 · {activeIpQuestion.title}</span>
                        <strong>{activeIpQuestion.prompt}</strong>
                        <p>{activeIpQuestion.empathy}</p>
                      </div>
                      <textarea
                        value={ipInterview?.draft ?? ""}
                        onChange={(event) => onUpdateIpPositioningDraft?.(task, event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" && !event.shiftKey) {
                            event.preventDefault();
                            onSubmitIpPositioningAnswer?.(task);
                          }
                        }}
                        placeholder="像和思潼聊天一样回答即可。按 Enter 发送，Shift+Enter 换行。"
                      />
                      <div className="ipInterviewActions">
                        <button
                          onClick={() => onBackIpPositioningQuestion?.(task)}
                          disabled={(ipInterview?.currentIndex ?? 0) === 0}
                        >
                          上一轮
                        </button>
                        <button onClick={() => onSubmitIpPositioningAnswer?.(task)}>
                          回答这一轮
                        </button>
                      </div>
                    </>
                  )}
                </section>
              )}
              {output && (
                <section className="taskDeliverable">
                  <div>
                    <b>{isPositioningTask ? "思潼IP定位skill输出" : "思潼已生成交付物"} · 第{outputVersion || 1}版</b>
                    <button onClick={() => void navigator.clipboard?.writeText(output)}>复制交付物</button>
                  </div>
                  <pre>{output}</pre>
                  <section className={`deliverableReview ${current === "done" ? "accepted" : ""}`}>
                    <div>
                      <span>{current === "done" ? "已确认采用" : "等待你确认"}</span>
                      <p>{current === "done" ? "这版已进入逐日落地任务；后续要改，需要重新提出调整意见再拍板。" : "确认采用后，这个交付物才会进入已完成；如果哪里不准，先写清楚要调什么，思潼会判断是否建议调整，最后由你拍板。"}</p>
                    </div>
                    {current !== "done" && (
                      <button onClick={() => onConfirmAiOutput?.(task)}>确认采用</button>
                    )}
                  </section>
                  {current !== "done" && (
                    <section className="deliverableAdjustment">
                      <div>
                        <span>需要调整时，先和思潼说明</span>
                        <p>不要只换一个随机版本。请直接说哪里不准、想收窄谁、哪些话不能说，思潼会先判断该不该改。</p>
                      </div>
                      <textarea
                        value={adjustmentDraft}
                        onChange={(event) => onUpdateAiOutputAdjustmentDraft?.(task, event.target.value)}
                        onFocus={() => onStartAiOutputAdjustment?.(task)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" && !event.shiftKey) {
                            event.preventDefault();
                            void onAnalyzeAiOutputAdjustment?.(task);
                          }
                        }}
                        placeholder="例如：目标客户太宽，先只做大连家庭聚餐客户；或这句话太夸大，不能承诺效果。"
                      />
                      <div className="deliverableReviewActions">
                        <button onClick={() => void onAnalyzeAiOutputAdjustment?.(task)} disabled={!adjustmentDraft.trim() || isOutputLoading}>
                          {isOutputLoading ? "思潼复核中" : "让思潼先判断"}
                        </button>
                      </div>
                      {adjustmentReview && (
                        <article className={`adjustmentReviewCard ${adjustmentReview.decision}`}>
                          <span>{adjustmentReview.decision === "recommend_adjust" ? "思潼建议调整" : "思潼建议先保留"}</span>
                          <strong>{adjustmentReview.focus}</strong>
                          <p>{adjustmentReview.analysis}</p>
                          <p>{adjustmentReview.recommendation}</p>
                          {adjustmentReview.decision === "recommend_adjust" && (
                            <pre>{adjustmentReview.proposedOutput}</pre>
                          )}
                          <div className="deliverableReviewActions">
                            {adjustmentReview.decision === "recommend_adjust" && (
                              <button onClick={() => onAcceptAiOutputAdjustment?.(task)}>采用思潼建议稿</button>
                            )}
                            <button onClick={() => onKeepCurrentAiOutput?.(task)}>保留当前版</button>
                          </div>
                        </article>
                      )}
                    </section>
                  )}
                </section>
              )}
            </div>
            <aside>
              <small>{statusLabel(current)}</small>
              {output
                ? <button onClick={() => onStartAiOutputAdjustment?.(task)}>{aiActionLabel}</button>
                : onRunAiTask && <button onClick={() => void onRunAiTask(task)} disabled={isOutputLoading}>{aiActionLabel}</button>}
              <button onClick={() => onMarkTask(task, "done")} disabled={current === "done" || requiresOutputReview}>
                {current === "done" ? "已完成" : requiresOutputReview ? "等待确认" : "标记完成"}
              </button>
              <button onClick={() => onMarkTask(task, "remind")} disabled={current === "done" || current === "remind"}>{current === "remind" ? "已加入提醒" : "加入提醒"}</button>
            </aside>
          </article>
        );
      })}
    </div>
  );
}

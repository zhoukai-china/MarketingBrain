import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent, type KeyboardEvent, type RefObject } from "react";
import type { ConsultantId } from "../../types";
import type { IpAcquisitionCapabilityId } from "../../data/ipAcquisitionAgent";
import { apiPath } from "../../lib/api";

type SalesComposerCapabilityId = "customer_diagnosis" | "intent_temperature" | "objection_reply" | "follow_up_plan" | "closing_script" | "funnel_review";
type CeoCockpitComposerCapabilityId = "daily_push" | "business_map" | "decision_center" | "command_center";
export type AcquisitionComposerCapabilityId = IpAcquisitionCapabilityId | "ip_positioning" | "content_plan" | "private_domain" | "franchise_acquisition" | "fip_franchise" | "fip_store_visit" | "fip_student_recruitment" | "fip_partner_recruitment" | "baolu_ip_advisor" | SalesComposerCapabilityId | CeoCockpitComposerCapabilityId;
type ComposerTemplateCapabilityId = IpAcquisitionCapabilityId | "ip_positioning" | "franchise_acquisition" | "fip_franchise" | "fip_store_visit" | "fip_student_recruitment" | "fip_partner_recruitment" | "baolu_ip_advisor" | SalesComposerCapabilityId | CeoCockpitComposerCapabilityId | "generic";

interface ChatComposerProps {
  inputValue: string;
  busy: boolean;
  currentConsultantId: ConsultantId;
  capabilityId?: AcquisitionComposerCapabilityId;
  headers: Record<string, string>;
  profileReady?: boolean;
  profileSummary?: string;
  skillOptions?: Array<{ id: string; title: string; subtitle?: string }>;
  selectedSkillIds?: string[];
  onSelectedSkillIdsChange?: (ids: string[]) => void;
  inputRef: RefObject<HTMLTextAreaElement>;
  onInputChange: (value: string) => void;
  onKeyDown: (e: KeyboardEvent) => void;
  onSend: (inputOverride?: string, displayOverride?: string, capabilityOverride?: string) => void | Promise<void>;
  filePickerSignal?: number;
  autoSendVideoUpload?: boolean;
  autoSendFileUpload?: boolean;
  uploadAccept?: string;
  uploadBridgeOnly?: boolean;
  onUploadStatusChange?: (message: string) => void;
}

interface PendingAttachment {
  id: string;
  filename: string;
  mimeType: string;
  kind: "image" | "video" | "audio" | "text" | "file";
  sizeLabel: string;
  detailLabel: string;
  summary: string;
  processingError?: string;
}

interface MediaAnalysisResponse {
  configured?: boolean;
  frameSummary?: string;
  transcript?: string;
  documentText?: string;
  warnings?: string[];
  contextText?: string;
}

interface CapabilityTemplateConfig {
  title: string;
  summary: string;
  template: string;
  placeholder: string;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

interface SpeechRecognitionEventLike {
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
}

interface SpeechRecognitionErrorEventLike {
  error?: string;
  message?: string;
}

type SpeechWindow = Window & {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
};

const capabilityTemplateMap: Record<ComposerTemplateCapabilityId, CapabilityTemplateConfig> = {
  generic: {
    title: "请补充本次任务信息",
    summary: "直接描述要解决的问题、已知事实、已有资料和希望得到的结果。",
    placeholder: "例如：粘贴客户对话并说明想复盘什么，或上传数据后说明希望诊断哪个问题。",
    template: [
      "【本次任务】要解决什么问题",
      "【已知事实】已经确认的信息",
      "【已有资料】对话、录音、文件或数据",
      "【想要输出】希望得到的具体结果",
      "【限制】不能编造或需要重点核实的内容"
    ].join("\n")
  },
  daily_push: {
    title: "请补充今日简报信息",
    summary: "经营主体、统计周期、核心指标、数据来源和更新时间；也可以直接上传Excel、CSV或报表截图。",
    placeholder: "例如：这是7家门店7月的美团与饿了么经营数据，请先核对口径，再给老板今日简报、经营信号灯和待决事项。",
    template: [
      "【经营主体】企业/品牌/门店或项目名称",
      "【统计周期】本周/本月/自定义起止日期",
      "【核心指标】目标值、实际值、上期值或同比值",
      "【数据来源】经营资料库/Excel/CSV/报表截图/手工确认",
      "【更新时间】数据最后更新到哪一天",
      "【老板最关心】营收、利润、现金流、获客、复购、门店或团队中的哪几项",
      "【想要输出】老板先看 + 经营信号灯 + 待老板决策 + 行动令草案 + 证据与缺口 + 下次回流"
    ].join("\n")
  },
  business_map: {
    title: "请补充经营地图信息",
    summary: "异常发生在哪个指标和周期、影响范围、对比基准与可核验资料。",
    placeholder: "例如：沈阳7家外卖店中，新店近14天订单低于预期。这里是各店订单、曝光、进店、转化和客单数据，请定位异常并区分事实与假设。",
    template: [
      "【异常现象】哪个指标出现了什么变化",
      "【统计周期】异常期与对比期",
      "【影响范围】涉及哪些门店/产品/渠道/团队",
      "【当前数据】实际值、目标值、上期值或行业基准来源",
      "【已做动作】已经采取过什么措施",
      "【可用证据】上传文件或说明经营资料库中的资料",
      "【想要输出】现象 + 证据 + 影响 + 可能原因 + 待验证数据 + 优先行动"
    ].join("\n")
  },
  decision_center: {
    title: "请补充待决事项",
    summary: "已确认事实、可选方案、收益、风险和最晚决策时间，最多形成三项待老板审批事项。",
    placeholder: "例如：根据刚才的诊断，列出需要我拍板的事项，比较方案、依据和风险，先不要当成已经批准。",
    template: [
      "【已确认结论】这次行动依据什么事实",
      "【需要拍板】老板要决定什么",
      "【可选方案】方案A/B及关键差异",
      "【收益与风险】每个方案可能带来的结果",
      "【最晚决策时间】何时以前必须决定",
      "【限制】最多三件事，未经批准不得写成已经下令"
    ].join("\n")
  },
  command_center: {
    title: "请补充行动令信息",
    summary: "仅将已批准决策拆成责任、截止、交付物、验收标准和回流时间。",
    placeholder: "例如：这项决策我已批准。请形成行动令草案，写清负责人、截止时间、交付物、验收标准和复盘时间。",
    template: [
      "【已批准决策】老板明确批准的事项",
      "【责任角色】由哪个岗位负责",
      "【截止时间】具体日期和时间",
      "【交付物】需要提交什么",
      "【验收标准】看到什么结果算完成",
      "【回传证据】数据、文件、截图或结果记录",
      "【复盘时间】何时检查结果"
    ].join("\n")
  },
  ip_positioning: {
    title: "请补充IP定位系统信息",
    summary: "系统会优先读取企业知识库；请补充本次服务主体、想解决的定位问题和已有事实，缺少的信息会被标记待确认。",
    placeholder: "例如：为我的AI咨询IP做定位；我服务企业老板，核心是帮企业把AI落地到业务流程，想让内容更有辨识度并带来咨询线索。",
    template: [
      "【本次服务主体】自己的IP/企业，或具体客户项目",
      "【当前业务或产品】已经确认的产品、服务或业务模型",
      "【目标用户】最希望被谁认识、信任或咨询",
      "【已有差异】真实经历、能力、案例、表达习惯或边界",
      "【定位问题】目前最困扰的是不清晰、同质化、信任不足还是转化弱",
      "【想要输出】完整IP定位方案，或指定修改项目定位/人设/内容方向/增长路径",
      "【事实边界】未确认的价格、数据、案例、城市和承诺请明确写待确认"
    ].join("\n")
  },
  topic_inspiration: {
    title: "选题系统将自动扫描四大来源",
    summary: "系统先用企业资料自动运行；你也可以补充本轮特殊目标或指定对标账号。",
    placeholder: "可选补充：本轮想吸引谁、达成什么目标，或指定要分析的对标账号。已有企业资料不用重复填写。",
    template: [
      "【本轮主体】自己的IP/企业，或具体客户项目",
      "【核心业务/产品】本轮要承接什么业务",
      "【目标客户】希望吸引谁",
      "【发布平台】抖音/视频号/小红书等",
      "【转化目标】私信咨询/预约/到店/招商留资等",
      "【私有知识】系统自动读取当前主体资料；也可额外选择录音、笔记或项目资料",
      "【行业热点】系统围绕当前行业自动检索并核验",
      "【账号复盘】上传后台数据或选择已确认复盘结论",
      "【对标账号】可选填账号名、链接或截图；未指定时系统自动检索同行公开内容",
      "【想要输出】四大来源采集结果 + 三关筛选后的TOP10 + 配比调整 + 待验证动作"
    ].join("\n")
  },
  industry_hotspots: {
    title: "行业热点任务已识别",
    summary: "已填写行业即可直接执行；城市、目标客户、重点平台和内容形式均为可选补充，已有信息不用重复填写。",
    placeholder: "可选补充：目标客户、重点平台，或希望生成几个选题/是否需要完整逐字稿；已填写的信息不用重复。",
    template: [
      "【行业/品类】例如：AI改造、口腔、餐饮加盟、教培、家政",
      "【城市/区域】例如：成都/本地/全国",
      "【目标客户】例如：中小企业老板、创业者、宝妈、附近3公里女性",
      "【重点平台】例如：抖音/小红书/视频号/朋友圈",
      "【想看的热点咨询】例如：客户最近在问什么、担心什么、想解决什么",
      "【想蹭热点的目标】例如：涨粉、私信咨询、预约到店、招商留资",
      "【想要输出】近期热点咨询 + 来源线索 + IP选题 + 短视频/朋友圈/直播切入"
    ].join("\n")
  },
  content_nine_piece: {
    title: "请补充内容文案信息",
    summary: "本次为谁创作、产品/服务、目标客户、发布平台、目标动作、已有文件、想要输出。",
    placeholder: "可以这样说：这次是给我自己还是客户项目创作，内容主体是谁，主推什么，想吸引谁，希望客户完成什么动作。",
    template: [
      "【本次内容主体】给自己企业/给客户项目；例如：为我的连锁品牌客户写招商加盟内容",
      "【企业/业务】例如：成都美甲店、本地家政公司、少儿口才机构",
      "【主推产品/活动】例如：198元通勤美甲、新客体验套餐",
      "【终端客户】例如：附近3公里、25-35岁、有明确需求的消费者",
      "【发布平台】例如：抖音/小红书/视频号",
      "【本次转化目标】例如：私信预约、到店、加微信、团购核销",
      "【内容主题/角度】例如：避坑、案例、过程、价格解释；未定可由AI推荐",
      "【已有素材/限制】例如：有门店照片和作品图，老板不出镜",
      "【想要输出】选题 + 可发布文案 + 拍摄脚本 + 拍摄注意事项 + 剪辑EDL + 发布标题话题 + 发布时间 + 评论区引导 + 投流建议"
    ].join("\n")
  },
  paid_traffic: {
    title: "请补充投流测试信息",
    summary: "平台、转化目标、承接地域、待投素材、自然数据、预算上限和历史投放。",
    placeholder: "例如：抖音账号准备投一条口播视频，目标是企业微信留资，可承接全国客户；自然播放和私信数据如下，首轮预算上限500元。",
    template: [
      "【投放平台/账户】抖音、视频号、小红书或其他；账户当前可用工具",
      "【业务与转化目标】私信、表单留资、加微信、预约、到店或成交",
      "【可承接地域】实际能服务或成交的城市/区域",
      "【待投素材】视频/图文标题、素材文件或素材编号",
      "【自然数据】发布时长、播放、完播、互动、主页访问、私信/留资；没有写待补",
      "【历史投放】过去投过什么、花费、结果和异常；没有写首次测试",
      "【预算边界】总预算、单日上限和最多测试几天",
      "【落地承接】主页、私信、表单、企业微信或门店由谁承接",
      "【想要输出】能否投 + 平台工具选择 + 素材A/B + 预算节奏 + 监控指标 + 止损条件 + 复盘时间 + 执行草案"
    ].join("\n")
  },
  dou_plus_traffic: {
    title: "请补充 DOU+ 测试信息",
    summary: "待投视频、账号自然数据、目标动作、预算上限、承接方式和历史加热结果。",
    placeholder: "例如：这条抖音口播自然播放8000，目标是主页访问后私信咨询，预算上限500元，想判断是否适合 DOU+。",
    template: [
      "【待投视频/账号】视频链接、标题、账号或素材文件",
      "【投放目标】播放互动、主页访问、涨粉、直播间或其他当前页面可选目标",
      "【自然数据】发布时长、播放、完播、互动、主页访问、私信；没有写待补",
      "【承接动作】主页、私信、直播间、商品或其他承接方式",
      "【预算边界】总预算、单日上限和最多测试几天",
      "【历史加热】是否投过、花费、结果和审核状态；没有写首次测试",
      "【想要输出】是否适合 DOU+ + 单变量测试 + 监控指标 + 止损回退 + PREVIEW_ONLY 预览"
    ].join("\n")
  },
  franchise_acquisition: {
    title: "请补充招商获客信息",
    summary: "品牌项目、目标加盟商、招商区域、真实证据、留资动作和合规边界。",
    placeholder: "参考案例：我们是中式快餐连锁，目标加盟商是愿意本人全职经营、预算10万元以内、计划在沈阳开店、能接受标准化供应链和培训的夫妻创业者或现有餐饮店老板。以上仅为填写示例，请按真实项目修改。",
    template: [
      "【品牌/加盟项目】例如：中式快餐连锁、社区咖啡、家政服务连锁",
      "【目标加盟商】建议写清5项：身份/经验、是否本人经营、预算区间、计划区域、合作条件接受度",
      "【目标加盟商参考案例A｜餐饮】有餐饮/外卖经验，愿意本人全职经营，预算10万元以内，计划在沈阳开店，接受标准化供应链与培训的夫妻创业者或现有餐饮店老板（仅作格式参考）",
      "【目标加盟商参考案例B｜美业】有本地女性客群资源或门店经验，愿意本人参与经营，预算20至30万元，计划在二三线城市开店，接受统一品牌、项目与运营标准的创业者（仅作格式参考）",
      "【目标加盟商参考案例C｜服务业】有销售或团队管理经验，可全职运营，具备当地企业客户资源，预算按真实政策填写，接受区域保护与服务交付标准的城市合伙人（仅作格式参考）",
      "【招商区域】例如：全国、华东、浙江省或指定城市",
      "【真实经营证据】例如：直营/样板店、产品过程、供应链、培训和运营支持；没有的数据写待补",
      "【加盟政策】例如：投资区间、门店面积、合作条件、支持内容；未确认内容不要编造",
      "【本次内容场景】例如：招商短视频、创始人口播、加盟直播、招商朋友圈",
      "【单一留资动作】例如：评论/私信“资料”、填写加盟表、预约项目沟通或到店考察",
      "【合规边界】不承诺稳赚、保本、固定回报；案例和经营数据必须真实授权",
      "【想要输出】SCALE招商逻辑 + 招商短视频文案 + 拍摄脚本 + 评论区线索承接 + 投流建议 + 合规提醒"
    ].join("\n")
  },
  fip_franchise: {
    title: "请补充招商加盟 Brief",
    summary: "目标加盟商、真实政策或证据、咨询/考察承接和禁止承诺。",
    placeholder: "例如：本轮招哪类加盟商；已确认的政策与证据有哪些；咨询后如何筛选和安排考察。",
    template: "【获客目标】招商加盟\n【目标加盟商】\n【真实政策/证据】\n【承接动作】咨询/筛选/考察\n【本轮结果】\n【禁止承诺】\n【想要输出】"
  },
  fip_store_visit: {
    title: "请补充团购到店 Brief",
    summary: "商品、门店地域、目标消费者、预约/核销承接和真实数据边界。",
    placeholder: "例如：主推商品和门店；消费者是谁；预约、到店和核销由谁承接。",
    template: "【获客目标】C端团购到店\n【商品/门店/地域】\n【目标消费者】\n【承接动作】预约/到店/核销\n【本轮结果】\n【真实价格或优惠】未确认写待补\n【想要输出】"
  },
  fip_student_recruitment: {
    title: "请补充学员招募 Brief",
    summary: "课程对象、学习边界、试听/说明会承接与报名交付边界。",
    placeholder: "例如：课程适合谁；能提供什么学习结果；如何安排试听和报名。",
    template: "【获客目标】学员招募\n【课程对象】\n【学习结果边界】\n【承接动作】咨询/试听/说明会/报名\n【本轮结果】\n【禁止承诺】不编造证书、就业、收入\n【想要输出】"
  },
  fip_partner_recruitment: {
    title: "请补充合作方招募 Brief",
    summary: "合作类型、双方条件、洽谈承接和履约边界。",
    placeholder: "例如：寻找渠道、联营或城市合作方；双方需要满足什么条件；如何进入洽谈。",
    template: "【获客目标】合作方招募\n【合作类型】\n【双方条件】\n【承接动作】资格判断/沟通/洽谈\n【本轮结果】\n【合作政策】未确认写待补\n【想要输出】"
  },
  baolu_ip_advisor: {
    title: "问问保禄",
    summary: "用保禄的新媒体与创始人IP能力分身，获得直接判断、依据和今天可执行的一步。",
    placeholder: "例如：我的账号定位太宽，应该先收窄人群还是先调整内容？请按新媒体和创始人IP经验回答。",
    template: "【我想问保禄】\n【我的账号/业务】\n【当前困惑】\n【已知事实或数据】\n【希望得到】直接判断 + 依据 + 今天可执行的一步\n【待确认边界】"
  },
  customer_diagnosis: {
    title: "请发客户对话或团队讨论",
    summary: "复盘当时做法、成交影响、下次具体说法和当前补救动作。",
    placeholder: "可以粘贴客户聊天、录音转写或团队讨论，并说明当时你做了什么、现在想补救还是沉淀话术。",
    template: [
      "【复盘对象】客户对话/团队销售讨论",
      "【真实记录】粘贴聊天原文、录音转写或关键对话",
      "【当时动作】我当时怎么问、怎么回、发了什么",
      "【当前状态】已回复/未回复/仍在内部讨论/已经流失",
      "【想要输出】当时做法—存在问题—影响成交原因—下次具体说法—当前补救动作"
    ].join("\n")
  },
  intent_temperature: {
    title: "请补充客户行为证据",
    summary: "基于真实行为判断水温、决策复杂度和跟进优先级。",
    placeholder: "说清客户参加过什么沟通、主动问过什么、预算和决策人是否确认、下一步是否约定。",
    template: [
      "【客户已做的动作】例如：参加会议、主动问实施、索取报价",
      "【已确认需求】客户明确想解决什么",
      "【预算/决策人】已确认或待确认",
      "【下一步】是否已经约定会议或待办",
      "【想要输出】水温区间 + 判断依据 + 跟进优先级 + 待确认信息 + 下一步话术"
    ].join("\n")
  },
  objection_reply: {
    title: "请粘贴客户的真实异议",
    summary: "先判断表面异议背后的待核实问题，再给可直接复制的回复。",
    placeholder: "例如：客户看完企业AI方案后说太贵了、再考虑考虑；我们没有提供回本数据和优惠政策。",
    template: [
      "【客户原话】请尽量原样粘贴",
      "【B2C/B2B场景】消费者购买/企业合作/招商加盟等",
      "【已确认产品与政策】只写真实存在的内容",
      "【当前阶段】刚咨询/看过方案/报过价/内部讨论",
      "【想要输出】当前判断 + 2至3套可直接回复 + 预判应对 + 下一步动作"
    ].join("\n")
  },
  follow_up_plan: {
    title: "请补充当前跟单阶段",
    summary: "明确时间、负责人、沟通目标、推进信号和停止条件。",
    placeholder: "例如：方案发出5天，客户说内部讨论，拍板人和下次会议都没确认。",
    template: [
      "【上次动作与时间】例如：5天前发出方案",
      "【客户最后回复】请粘贴原话",
      "【决策人/预算/时间】已确认或待确认",
      "【当前卡点】例如：没有下一次会议",
      "【想要输出】分时间节点跟单计划 + 可复制话术 + 风险与停止条件"
    ].join("\n")
  },
  closing_script: {
    title: "请补充成交前的真实顾虑",
    summary: "不施压、不编承诺，推进一个可验证的合理下一步。",
    placeholder: "例如：客户认可方案和预算，但担心团队配合不上，所以迟迟不签。",
    template: [
      "【已确认价值】客户已经认可什么",
      "【客户顾虑原话】请尽量原样粘贴",
      "【预算/决策人】是否已经确认",
      "【真实交付边界】已有的分工、支持和验收方式",
      "【想要输出】不施压成交话术 + 可能回复应对 + 下一步动作"
    ].join("\n")
  },
  funnel_review: {
    title: "请补充同口径销售漏斗数据",
    summary: "计算相邻和累计转化率，区分绝对流失与比例流失。",
    placeholder: "例如：本月40条线索、25个建联、12个有效沟通、6个方案、2个成交；没有上月数据和金额成本。",
    template: [
      "【时间范围】例如：本月/最近30天",
      "【B2C/B2B场景】消费者到店/企业合作/招商加盟等",
      "【各阶段数量】线索—建联—有效沟通—方案/会议—成交",
      "【口径】是否去重、无效线索如何定义",
      "【金额与成本】没有可写未提供，不估算ROI",
      "【想要输出】数据审计 + 可复算漏斗 + 双卡点 + 原因边界 + 下周动作"
    ].join("\n")
  },
  shooting_editing: {
    title: "请补充拍剪优化信息",
    summary: "视频目的、拍摄对象、出镜方式、已有文件、剪辑风格、发布平台。",
    placeholder: "可以这样说：我要拍什么视频，谁出镜，已有照片/视频，想发到哪里，想要什么风格，哪里最担心。",
    template: [
      "【视频目的】例如：让附近客户私信预约/到店/加微信",
      "【拍摄对象】例如：老板本人/员工/门店环境/产品细节/客户案例",
      "【出镜方式】例如：老板不出镜，只拍手部和成品",
      "【已有文件】例如：已上传视频/照片，或有门店、产品、客户反馈文件",
      "【剪辑风格】例如：真实纪实/专业干净/节奏快/温柔种草",
      "【发布平台】例如：抖音/小红书/视频号/朋友圈",
      "【想要输出】镜头结构、分镜、剪辑EDL、字幕节奏、封面标题、发布前检查"
    ].join("\n")
  },
  video_review: {
    title: "上传视频后台数据进行复盘",
    summary: "仅支持 CSV/Excel 数据复盘，逐行读取作品标题、播放、停留、互动和关注数据。",
    placeholder: "上传视频号/抖音后台导出的 CSV 或 Excel，再说你最想优化播放、停留、互动、关注还是业务线索。",
    template: [
    "【上传文件】视频号/抖音后台导出的 CSV 或 Excel",
    "【优先指标】例如：播放、平均播放时长、完播、分享、关注、私信/线索",
    "【业务目标】例如：建立IP认知、获得企业客户咨询、招商加盟或到店成交",
    "【想要输出】按标准报告输出数据审计、总览、分层、内容健康度、单条深拆、完播、互动、趋势、规律、方法论、下周期选题和综合结论",
    "【证据边界】只有数据表时不判断具体画面、口播和剪辑问题"
    ].join("\n")
  },
  live_script: {
    title: "请补充直播话术信息",
    summary: "直播场景、产品或项目、目标人群、直播目标、时长节奏和合规边界。",
    placeholder: "可以这样说：这是卖货/到店/招商直播，我讲什么产品或项目，客户是谁，想让他们下单/留资/预约考察，需要哪些环节话术。",
    template: [
      "【直播场景】卖货/团购到店/专业咨询/招商加盟",
      "【直播产品或项目】卖什么、讲什么；价格/福利/加盟政策只填真实信息",
      "【目标人群】消费者、潜在客户或加盟创业者，最关心和最犹豫什么",
      "【直播目标】留人、咨询、下单、加微信、留资或预约考察",
      "【直播时长与节奏】预计播多久，是否循环讲解",
      "【真实证据/已有素材】产品、门店、案例、样板店、后台数据或客户反馈",
      "【合规边界】禁用词、效果限制；招商场景不得承诺固定收益",
      "【需要话术】开场、留人、互动、产品/项目承接、转化、逼单、下播跟进"
    ].join("\n")
  },
  live_review: {
    title: "上传直播后台数据进行复盘",
    summary: "读取直播后台数据、直播记录或话术执行记录，复盘停留、互动和转化。",
    placeholder: "上传直播后台数据后，可以说明本场直播目标、产品/项目、时长，以及最想优化停留、互动、留资还是成交。",
    template: [
      "【上传文件】直播后台 CSV/Excel、直播记录或话术执行记录",
      "【直播目标】卖货/团购到店/咨询留资/招商加盟",
      "【产品或项目】本场实际讲解和承接的内容",
      "【优先指标】场观、平均停留、在线峰值、互动、商品点击、留资或成交",
      "【想要输出】数据审计 + 节奏诊断 + 话术诊断 + 转化卡点 + 下一场调整清单",
      "【证据边界】缺失的数据和执行记录标记待补，不根据结果倒推不存在的话术或动作"
    ].join("\n")
  },
  moments_private: {
    title: "请补充朋友圈私域信息",
    summary: "你是谁、朋友圈里的人、主推产品、成交目标、表达风格。",
    placeholder: "可以这样说：我是做什么的，朋友圈里主要是谁，最近主推什么，想种草/预约/成交，想要什么表达风格。",
    template: [
    "【我是谁/做什么】",
    "【朋友圈里的人】老客/新客/潜在客户分别是谁",
    "【主推产品/活动】",
    "【本次目标】种草、预约、复购、转介绍、成交",
    "【表达风格】专业、真实、老板本人、温柔、有稀缺感",
    "【想要输出】朋友圈文案 + 私聊承接话术"
    ].join("\n")
  }
};

export function ChatComposer({
  inputValue,
  busy,
  currentConsultantId,
  capabilityId = "content_nine_piece",
  headers,
  profileReady = false,
  profileSummary = "",
  skillOptions = [],
  selectedSkillIds = [],
  onSelectedSkillIdsChange,
  inputRef,
  onInputChange,
  onKeyDown,
  onSend,
  filePickerSignal = 0,
  autoSendVideoUpload = false,
  autoSendFileUpload = false,
  uploadAccept = "image/*,video/*,audio/*,.pdf,.docx,.xls,.xlsx,.csv,.txt,.md,.json,.tsv,.log",
  uploadBridgeOnly = false,
  onUploadStatusChange
}: ChatComposerProps) {
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [uploadMessage, setUploadMessage] = useState("");
  const [uploading, setUploading] = useState(false);
  const [voiceMessage, setVoiceMessage] = useState("");
  const [recording, setRecording] = useState(false);
  const [skillMenuOpen, setSkillMenuOpen] = useState(false);
  const [preEnhancedInput, setPreEnhancedInput] = useState<string | null>(null);
  const [preEnhancedSkillIds, setPreEnhancedSkillIds] = useState<string[] | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const voiceStartingRef = useRef(false);
  const voiceStopTimerRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const handledFilePickerSignalRef = useRef(0);
  const normalizedCapabilityId = useMemo(() => normalizeCapabilityId(capabilityId), [capabilityId]);
  const templateConfig = useMemo(() => capabilityTemplateMap[normalizedCapabilityId] ?? capabilityTemplateMap.content_nine_piece, [normalizedCapabilityId]);
  const displayConfig = useMemo(() => {
    if (!profileReady || !["content_nine_piece", "franchise_acquisition", "moments_private"].includes(normalizedCapabilityId)) return templateConfig;
    const isMoments = normalizedCapabilityId === "moments_private";
    const isFranchise = normalizedCapabilityId === "franchise_acquisition";
    return {
      ...templateConfig,
      title: isMoments
        ? "企业资料已就绪，直接说今天想发什么"
        : isFranchise
          ? "企业资料已就绪，补充本次招商目标即可"
          : "企业资料已就绪，可以直接生成内容",
      summary: `${profileSummary || "已确认行业、产品和目标客户"}。AI 会自动引用，不需要重复填写。`,
      placeholder: isMoments
        ? "例如：写一条今天能直接发的朋友圈，语气真实一点，目的是让客户来咨询。"
        : isFranchise
          ? "例如：给我一条招商加盟短视频；这是客户项目，行业和品牌待补，目标是让符合条件的意向合作人私信领取资料。"
          : "例如：帮我写今天能直接发布的终端客户获客文案。"
    };
  }, [normalizedCapabilityId, profileReady, profileSummary, templateConfig]);
  const template = templateConfig.template;

  useEffect(() => {
    if (!filePickerSignal || filePickerSignal === handledFilePickerSignalRef.current || busy || uploading) return;
    handledFilePickerSignalRef.current = filePickerSignal;
    fileInputRef.current?.click();
  }, [busy, filePickerSignal, uploading]);

  useEffect(() => {
    onUploadStatusChange?.(uploadMessage);
  }, [onUploadStatusChange, uploadMessage]);

  function toggleSelectedSkill(skillId: string) {
    if (!onSelectedSkillIdsChange) return;
    const exists = selectedSkillIds.includes(skillId);
    onSelectedSkillIdsChange(exists
      ? selectedSkillIds.filter((id) => id !== skillId)
      : [...selectedSkillIds, skillId].slice(0, 3));
  }

  function insertTemplate() {
    const trimmed = inputValue.trim();
    onInputChange(trimmed ? `${trimmed}\n\n${template}` : template);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }

  function enhancePrompt() {
    if (preEnhancedInput !== null) {
      onInputChange(preEnhancedInput);
      if (onSelectedSkillIdsChange && preEnhancedSkillIds) onSelectedSkillIdsChange(preEnhancedSkillIds);
      setPreEnhancedInput(null);
      setPreEnhancedSkillIds(null);
      setUploadMessage("已恢复增强前的提问。");
      window.setTimeout(() => inputRef.current?.focus(), 0);
      return;
    }
    const original = cleanVisiblePromptInput(inputValue);
    const enhanceCapabilityId = inferEnhanceCapability(original, normalizedCapabilityId);
    const source = original || capabilityTemplateMap[enhanceCapabilityId].template;
    const enhanced = buildEnhancedPrompt(enhanceCapabilityId, source, profileSummary);
    setPreEnhancedInput(inputValue);
    setPreEnhancedSkillIds(selectedSkillIds);
    if (onSelectedSkillIdsChange) onSelectedSkillIdsChange([composerCapabilityToSkillId(enhanceCapabilityId)]);
    onInputChange(enhanced);
    setUploadMessage(getEnhanceStatus(enhanceCapabilityId, Boolean(profileSummary.trim())));
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }

  async function handleFileInput(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;
    const containsVideo = files.some(isVideoFile);
    const videoCapabilityId = resolveVideoUploadCapability(normalizedCapabilityId, inputValue);
    if (containsVideo && !inputValue.trim() && videoCapabilityId === "shooting_editing") {
      onInputChange("根据我上传的视频，给出镜头结构、剪辑节奏和发布前修改建议。");
    }
    setUploading(true);
    const next: PendingAttachment[] = [];
    try {
      for (const [index, file] of files.entries()) {
        if (isVideoFile(file)) {
          setUploadMessage(`正在解析视频文件 ${index + 1}/${files.length}，会自动抽帧并尝试转写。解析完成前先不要发送。`);
        } else {
          setUploadMessage(`正在读取文件 ${index + 1}/${files.length}，读取完成前先不要发送。`);
        }
        next.push(await buildAttachment(file, undefined, isVideoFile(file) ? videoCapabilityId : normalizedCapabilityId));
      }
      setAttachments((prev) => [...prev, ...next]);
      if ((autoSendVideoUpload && containsVideo) || autoSendFileUpload) {
        const unreadableFiles = next.filter((attachment) => attachment.processingError);
        if (unreadableFiles.length > 0) {
          setAttachments([]);
          setUploadMessage(`未能读取文件正文：${unreadableFiles.map((item) => item.filename).join("、")}。${unreadableFiles[0]?.processingError || "请重新上传。"}`);
          return;
        }
        const requestText = inputValue.trim() || (containsVideo
          ? "根据我上传的视频，给出镜头结构、拍摄问题、剪辑节奏、字幕封面和发布前修改建议。"
          : "请读取我上传的投放数据，核对字段、周期和指标口径，诊断问题并给出下一轮投放建议。");
        const fullInput = buildInputWithAttachments(requestText, next);
        const displayInput = buildDisplayInputWithAttachments(requestText, next);
        setAttachments([]);
        setUploadMessage(containsVideo ? "视频已解析并提交分析，正在生成建议…" : "数据文件已读取并提交复盘，正在生成建议…");
        await onSend(fullInput, displayInput, containsVideo ? videoCapabilityId : normalizedCapabilityId);
        setUploadMessage(containsVideo ? "视频分析请求已完成，请查看下方结果。" : "数据复盘请求已完成，请查看下方结果。若显示超时，可直接重新上传。 ");
        return;
      }
      const videoParseIssues = next
        .filter((attachment) => attachment.kind === "video")
        .filter((attachment) => /解析暂未启用|解析失败|未拿到自动解析结果|没有可靠画面解析|没有口播\/字幕转写/.test(attachment.summary));
      const parsedVideos = next
        .filter((attachment) => attachment.kind === "video")
        .filter((attachment) => /画面解析：|语音\/字幕转写：/.test(attachment.summary));
      if (videoParseIssues.length > 0 && parsedVideos.length === 0) {
        setUploadMessage("视频已添加，但智能解析未完成，目前只有时长、尺寸等基础信息。发送后不会假装看过视频；请稍后重试或补充截图/口播/字幕。");
      } else if (parsedVideos.length > 0) {
        setUploadMessage(`已解析 ${parsedVideos.length} 个视频，发送时会结合关键帧/转写一起分析。`);
      } else {
        setUploadMessage(`已添加 ${next.length} 个文件，发送时会作为本轮上下文一起分析。`);
      }
    } catch (error) {
      const detail = error instanceof Error && error.message ? error.message : "文件读取失败";
      setUploadMessage(`文件处理失败：${detail}。请检查文件后重新上传。`);
    } finally {
      setUploading(false);
    }
  }

  async function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.clipboardData.files ?? []).filter((file) => file.type.startsWith("image/"));
    if (files.length === 0) return;
    event.preventDefault();
    const next = await Promise.all(files.map((file, index) => buildAttachment(file, `粘贴截图-${Date.now()}-${index + 1}.png`)));
    setAttachments((prev) => [...prev, ...next]);
    setUploadMessage(`已添加 ${next.length} 张粘贴截图，发送时会作为文件上下文。`);
  }

  async function buildAttachment(file: File, fallbackName?: string, attachmentCapabilityId: ComposerTemplateCapabilityId = normalizedCapabilityId): Promise<PendingAttachment> {
    const filename = file.name || fallbackName || `附件-${Date.now()}`;
    const sizeLabel = formatFileSize(file.size);
    let summary = "";
    let processingError = "";
    let kind: PendingAttachment["kind"] = "file";
    let detailLabel = file.type || "未知类型";
    if (/^(text\/|application\/json)|\.(txt|md|csv|tsv|json|log)$/i.test(file.type || filename)) {
      kind = "text";
      const analysis = await analyzeMediaAttachment(file, "文本/数据文件");
      detailLabel = analysis?.documentText ? "已读取正文/数据" : "可读取文字";
      const text = analysis?.documentText ?? await file.text().catch(() => "");
      summary = buildTextAttachmentSummary({
        capabilityId: attachmentCapabilityId,
        filename,
        mimeType: file.type || "",
        text
      });
      if (analysis?.warnings?.length) summary = `${summary}\n\n解析提醒：${analysis.warnings.join("；")}`;
    } else if (file.type.startsWith("image/")) {
      kind = "image";
      const metadata = await readImageMetadata(file);
      const analysis = await analyzeMediaAttachment(file, metadata);
      detailLabel = [metadata, analysis?.frameSummary ? "已识别画面" : ""].filter(Boolean).join("，") || "图片文件";
      summary = analysis?.contextText
        ? buildAnalyzedAttachmentSummary(filename, sizeLabel, analysis)
        : `用户上传了图片/照片文件：${filename}，${[metadata, sizeLabel].filter(Boolean).join("，")}。本次没有拿到可靠画面解析，不得假装已经看过图片内容。`;
    } else if (file.type.startsWith("audio/")) {
      kind = "audio";
      const analysis = await analyzeMediaAttachment(file, "音频文件");
      detailLabel = analysis?.transcript ? "已完成语音转写" : "音频文件";
      summary = analysis?.contextText
        ? buildAnalyzedAttachmentSummary(filename, sizeLabel, analysis)
        : `用户上传了音频文件：${filename}，${sizeLabel}。本次没有拿到可靠转写，不得猜测音频内容。`;
    } else if (isVideoFile(file)) {
      kind = "video";
      const metadata = await readVideoMetadata(file);
      detailLabel = metadata || "视频文件";
      const analysis = await analyzeMediaAttachment(file, metadata);
      if (analysis?.contextText) {
        const parsedLabel = analysis.transcript || analysis.frameSummary ? "" : "解析未完成";
        detailLabel = [metadata, analysis.transcript ? "已转写" : "", analysis.frameSummary ? "已抽帧解析" : parsedLabel]
          .filter(Boolean)
          .join("，") || "视频已解析";
        summary = buildVideoAttachmentSummary({
          capabilityId: attachmentCapabilityId,
          filename,
          metadata,
          sizeLabel,
          contextText: analysis.contextText,
          hasTranscript: Boolean(analysis.transcript),
          hasFrameSummary: Boolean(analysis.frameSummary),
          warnings: analysis.warnings ?? []
        });
      } else {
        summary = buildVideoAttachmentSummary({
          capabilityId: attachmentCapabilityId,
          filename,
          metadata,
          sizeLabel,
          contextText: "",
          hasTranscript: false,
          hasFrameSummary: false,
          warnings: ["本次未拿到自动解析结果"]
        });
      }
    } else {
      const analysis = await analyzeMediaAttachment(file, "");
      detailLabel = analysis?.documentText ? "已读取正文" : file.type || "业务文件";
      summary = analysis?.contextText
        ? buildAnalyzedAttachmentSummary(filename, sizeLabel, analysis)
        : `用户上传了文件：${filename}，${sizeLabel}。本次未能读取文件正文，不得假装已经看过文件内容。`;
      if (!analysis?.contextText) processingError = analysis?.warnings?.join("；") || "文件正文为空或格式暂不支持，请检查后重新上传。";
    }
    return {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      filename,
      mimeType: file.type || "application/octet-stream",
      kind,
      sizeLabel,
      detailLabel,
      summary,
      processingError: processingError || undefined
    };
  }

  async function analyzeMediaAttachment(file: File, metadata: string): Promise<MediaAnalysisResponse | null> {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 60_000);
    try {
      const frames = isVideoFile(file) ? await extractVideoFrames(file) : [];
      const formData = new FormData();
      formData.append("file", file, file.name || `video-${Date.now()}.mp4`);
      formData.append("metadata", metadata);
      formData.append("frames", JSON.stringify(frames));
      const response = await fetch(apiPath("/media/analyze"), {
        method: "POST",
        headers: stripMultipartHeaders(headers),
        body: formData,
        signal: controller.signal
      });
      if (!response.ok) {
        let detail = `语音服务请求失败（${response.status}）`;
        try {
          const payload = (await response.json()) as { message?: string; error?: string };
          detail = payload.message?.trim() || payload.error?.trim() || detail;
        } catch {
          // Keep the status-based message when the server does not return JSON.
        }
        return { configured: false, warnings: [detail] };
      }
      return (await response.json()) as MediaAnalysisResponse;
    } catch (error) {
      if ((error as { name?: string }).name === "AbortError") {
        return { configured: false, warnings: ["文件解析超过60秒，已自动停止。请检查文件大小或网络后重新上传。"] };
      }
      const detail = error instanceof Error && error.message ? error.message : "网络连接异常";
      return { configured: false, warnings: [`文件解析服务暂时不可用：${detail}`] };
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  function removeAttachment(id: string) {
    setAttachments((prev) => prev.filter((item) => item.id !== id));
  }

  /**
   * 语音输入转写（PLAT-33）：录音只走平台自己的受授权入口 `/voice/transcribe`。
   * 这条通道必须带登录态；任何失败都返回带 warning 的结果，由 `voiceTranscriptionFailureMessage`
   * 统一翻成人话，不静默丢录音。
   */
  async function transcribeVoiceAttachment(file: File): Promise<MediaAnalysisResponse | null> {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 60_000);
    try {
      const formData = new FormData();
      formData.append("file", file, file.name);
      const response = await fetch(apiPath("/voice/transcribe"), {
        method: "POST",
        headers: stripMultipartHeaders(headers),
        body: formData,
        signal: controller.signal
      });
      if (!response.ok) {
        let detail = `语音转写请求失败（${response.status}）`;
        try {
          const payload = (await response.json()) as { message?: string; error?: string };
          detail = payload.message?.trim() || payload.error?.trim() || detail;
        } catch {
          // 服务端没返回 JSON 时保留状态码文案。
        }
        return { configured: false, warnings: [detail] };
      }
      return (await response.json()) as MediaAnalysisResponse;
    } catch (error) {
      if ((error as { name?: string }).name === "AbortError") {
        return { configured: false, warnings: ["语音转写超过60秒，已自动停止；本次未扣积分，请缩短录音或直接用文字输入。"] };
      }
      const detail = error instanceof Error && error.message ? error.message : "网络连接异常";
      return { configured: false, warnings: [`语音转写服务暂时不可用：${detail}`] };
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  function toggleVoice() {
    const activeRecorder = mediaRecorderRef.current;
    if (activeRecorder && activeRecorder.state !== "inactive") {
      setVoiceMessage("录音结束，正在准备转成文字…");
      activeRecorder.stop();
      return;
    }
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      return;
    }
    if (voiceStartingRef.current) return;

    // Prefer recording + the product's own ASR service. Chromium may expose the
    // Web Speech API even when its remote recognition service is unavailable.
    if (typeof navigator.mediaDevices?.getUserMedia === "function" && typeof MediaRecorder !== "undefined") {
      void startRecordedVoiceInput();
      return;
    }
    startNativeSpeechRecognition();
  }

  function startNativeSpeechRecognition() {
    const SpeechRecognitionClass =
      (window as SpeechWindow).SpeechRecognition ?? (window as SpeechWindow).webkitSpeechRecognition;
    if (!SpeechRecognitionClass) {
      setVoiceMessage("当前浏览器不支持语音输入，请改用最新版 Chrome、Edge 或系统浏览器。");
      return;
    }
    const recognition = new SpeechRecognitionClass();
    recognition.lang = "zh-CN";
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      const text = Array.from(event.results)
        .map((result) => result[0]?.transcript ?? "")
        .join("")
        .trim();
      if (text) onInputChange([inputValue.trim(), text].filter(Boolean).join("\n"));
      setVoiceMessage("");
    };
    recognition.onerror = (event) => {
      setVoiceMessage(nativeSpeechErrorMessage(event.error));
      setRecording(false);
    };
    recognition.onend = () => {
      setRecording(false);
      recognitionRef.current = null;
    };
    recognitionRef.current = recognition;
    setRecording(true);
    setVoiceMessage("正在听你说话，说完会自动填进输入框。");
    try {
      recognition.start();
    } catch (error) {
      recognitionRef.current = null;
      setRecording(false);
      setVoiceMessage(voiceCaptureErrorMessage(error));
    }
  }

  async function startRecordedVoiceInput() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setVoiceMessage("当前浏览器不支持语音输入，请先用文字输入。");
      return;
    }
    voiceStartingRef.current = true;
    setVoiceMessage("正在请求麦克风权限…");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]
        .find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? "";
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      const chunks: BlobPart[] = [];
      let recordingFailed = false;
      recorder.ondataavailable = (event) => { if (event.data.size > 0) chunks.push(event.data); };
      recorder.onerror = () => {
        recordingFailed = true;
        setVoiceMessage("录音中断了，请确认麦克风没有被其他应用占用后重试。");
        if (recorder.state !== "inactive") recorder.stop();
        stopRecordedVoiceStream();
      };
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        stopRecordedVoiceStream();
        if (recordingFailed) return;
        if (blob.size < 512) {
          setVoiceMessage("没有录到有效声音。请靠近麦克风说话，再试一次。");
          return;
        }
        void transcribeRecordedVoice(blob);
      };
      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      setRecording(true);
      setVoiceMessage("正在录音，再点一次麦克风结束并转成文字。");
      recorder.start(250);
      voiceStopTimerRef.current = window.setTimeout(() => {
        if (recorder.state !== "inactive") recorder.stop();
      }, 120_000);
    } catch (error) {
      setVoiceMessage(voiceCaptureErrorMessage(error));
      stopRecordedVoiceStream();
    } finally {
      voiceStartingRef.current = false;
    }
  }

  async function transcribeRecordedVoice(blob: Blob) {
    setUploading(true);
    setVoiceMessage("录音完成，正在转成文字…");
    try {
      const mimeType = blob.type || "audio/webm";
      const file = new File([blob], `语音输入-${Date.now()}.${audioExtensionForMime(mimeType)}`, { type: mimeType });
      // PLAT-33：语音输入走独立的受授权转写入口（`/media/analyze` 对音视频一律 fail-closed）。
      const analysis = await transcribeVoiceAttachment(file);
      const transcript = analysis?.transcript?.trim();
      if (transcript) {
        onInputChange([inputValue.trim(), transcript].filter(Boolean).join("\n"));
        setVoiceMessage("语音已转成文字，你可以检查后发送。");
      } else {
        setVoiceMessage(voiceTranscriptionFailureMessage(analysis));
      }
    } catch (error) {
      const detail = error instanceof Error && error.message ? error.message : "未知错误";
      setVoiceMessage(`语音转写失败：${detail}`);
    } finally {
      setUploading(false);
    }
  }

  function stopRecordedVoiceStream() {
    if (voiceStopTimerRef.current !== null) {
      window.clearTimeout(voiceStopTimerRef.current);
      voiceStopTimerRef.current = null;
    }
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
    mediaRecorderRef.current = null;
    setRecording(false);
  }

  function send() {
    if (uploading) {
      setUploadMessage("文件还在读取/解析中，完成后再发送，避免复盘时丢失文件内容。");
      return;
    }
    const fullInput = buildInputWithAttachments(inputValue.trim(), attachments);
    const displayInput = buildDisplayInputWithAttachments(inputValue.trim(), attachments);
    if (!fullInput || busy) return;
    setAttachments([]);
    setUploadMessage("");
    setPreEnhancedInput(null);
    void onSend(fullInput, displayInput);
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send();
      return;
    }
    onKeyDown(event);
  }

  if (uploadBridgeOnly) {
    return <div className="contentSystemUploadBridge" aria-hidden="true">
      <input ref={fileInputRef} className="consultFileInput" type="file" accept={uploadAccept} multiple onChange={(event) => void handleFileInput(event)} />
    </div>;
  }

  return (
    <div className="consultChatComposer ipComposer">
      {!profileReady && <div className="ipInputTemplate">
        <div>
          <strong>{displayConfig.title}</strong>
          <span>{displayConfig.summary}</span>
        </div>
        <button type="button" onClick={insertTemplate} disabled={busy || uploading}>
          套用输入模板
        </button>
      </div>}

      <div className="composerEditorSurface">
        <div className="consultComposerInputWrap">
          <textarea
            ref={inputRef}
            value={inputValue}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={handleComposerKeyDown}
            onPaste={(event) => void handlePaste(event)}
            placeholder={displayConfig.placeholder}
            rows={4}
            disabled={busy || uploading}
          />
          {voiceMessage && <div className={recording ? "voiceInputStatus recording" : "voiceInputStatus"}>{voiceMessage}</div>}
          {uploadMessage && <div className="fileUploadStatus">{uploadMessage}</div>}
        </div>

        {attachments.length > 0 && (
          <div className="attachmentTray" aria-label="待发送附件">
            {attachments.map((attachment) => (
              <div className={attachment.kind === "image" ? "attachmentChip image" : attachment.kind === "video" ? "attachmentChip video" : attachment.kind === "audio" ? "attachmentChip audio" : "attachmentChip"} key={attachment.id}>
                <span aria-hidden="true">{attachmentIcon(attachment.kind)}</span>
                <strong>{attachment.filename}</strong>
                <em>{attachment.detailLabel} · {attachment.sizeLabel}</em>
                <button type="button" onClick={() => removeAttachment(attachment.id)} aria-label={`移除 ${attachment.filename}`}>
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="composerToolbar">
          <div className="composerTools">
            {skillOptions.length > 0 && (
              <div className="composerSkillPicker">
                <button
                  className={selectedSkillIds.length > 0 ? "composerSkillButton selected" : "composerSkillButton"}
                  type="button"
                  disabled={busy || uploading}
                  onClick={() => setSkillMenuOpen((value) => !value)}
                  aria-expanded={skillMenuOpen}
                >
                  <span aria-hidden="true">⌘</span>
                  <strong>{selectedSkillIds.length > 0 ? `${selectedSkillIds.length} 个技能` : "自动技能"}</strong>
                </button>
                {skillMenuOpen && (
                  <div className="composerSkillMenu">
                    <div><strong>本次调用技能</strong><small>不选择时由 Agent 自动编排，最多可指定 3 个。</small></div>
                    <button
                      type="button"
                      className={selectedSkillIds.length === 0 ? "active" : ""}
                      onClick={() => onSelectedSkillIdsChange?.([])}
                    >
                      <span>自动</span><div><strong>智能选择</strong><small>根据问题自动调用一个或多个能力</small></div>
                    </button>
                    {skillOptions.map((skill) => (
                      <button
                        type="button"
                        className={selectedSkillIds.includes(skill.id) ? "active" : ""}
                        key={skill.id}
                        onClick={() => toggleSelectedSkill(skill.id)}
                      >
                        <span>{selectedSkillIds.includes(skill.id) ? "✓" : "+"}</span>
                        <div><strong>{skill.title}</strong><small>{skill.subtitle}</small></div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <button className="promptEnhanceButton" type="button" disabled={busy || uploading || (!inputValue.trim() && preEnhancedInput === null)} onClick={enhancePrompt} title="按获客任务结构增强提问">
              <span aria-hidden="true">✦</span>
              <strong>{preEnhancedInput === null ? "增强" : "还原"}</strong>
            </button>
            <button className="fileUploadButton" type="button" disabled={busy || uploading} onClick={() => fileInputRef.current?.click()} title="上传照片、视频或文件" aria-label="上传照片、视频或文件">
              ＋
            </button>
            <input
              ref={fileInputRef}
              className="consultFileInput"
              type="file"
              accept={uploadAccept}
              multiple
              onChange={(event) => void handleFileInput(event)}
            />
            <button
              className={recording ? "voiceInputButton recording" : "voiceInputButton"}
              type="button"
              disabled={busy || uploading}
              onClick={toggleVoice}
              title={recording ? "结束录音并转成文字" : "开始录音"}
              aria-label={recording ? "结束录音并转成文字" : "开始录音"}
            >
              <span className="voiceInputIcon" aria-hidden="true" />
            </button>
          </div>
          <button className="consultSendButton" type="button" onClick={send} disabled={busy || uploading || (!inputValue.trim() && attachments.length === 0)}>
            {busy || uploading ? "..." : "发送"}
          </button>
        </div>
      </div>
    </div>
  );
}

function normalizeCapabilityId(capabilityId?: AcquisitionComposerCapabilityId): ComposerTemplateCapabilityId {
  if (!capabilityId) return "generic";
  if (capabilityId === "content_plan") return "content_nine_piece";
  if (capabilityId === "private_domain") return "moments_private";
  return capabilityId;
}

function inferEnhanceCapability(input: string, fallback: ComposerTemplateCapabilityId): ComposerTemplateCapabilityId {
  const text = input.replace(/\s+/g, "");
  if (!text) return fallback;
  if (/问问保禄|保禄.*(?:怎么看|怎么做|建议|判断|请教)/i.test(text)) return "baolu_ip_advisor";
  if (/选题灵感|TOP\s*10.*选题|选题.*TOP\s*10|四来源.*选题/i.test(text)) return "topic_inspiration";
  if (/直播数据复盘|直播复盘|直播数据|场观|在线峰值|平均停留|直播间.*复盘/i.test(text)) return "live_review";
  if (/视频复盘|复盘(?:这|该|我)?(?:次)?(?:上传的)?(?:条)?(?:视频|文件|数据表)|播放量|完播率|平均播放|后台数据|\.csv|Excel表/i.test(text)) return "video_review";
  if (/拍剪|剪辑|分镜|镜头|拍摄优化|拍摄建议|剪辑建议|修改建议|发布前|EDL|拆片/i.test(text)) return "shooting_editing";
  if (/行业热点|近期热点|热点咨询|行业趋势/i.test(text)) return "industry_hotspots";
  if (/投流|投放广告|付费流量|DOU\+|抖加|本地推|巨量引擎|千川|随心推|广告预算|出价策略|获客成本|线索成本|投产比|广告ROI/i.test(text)) return "paid_traffic";
  if (/招商加盟|招商获客|找加盟商|加盟商|加盟项目|加盟政策|开放加盟|招(?:区域)?代理/i.test(text)) return "franchise_acquisition";
  if (/团购到店|团购核销|到店预约|预约到店|消费者到店/i.test(text)) return "fip_store_visit";
  if (/招学员|招募学员|招生|学员招募|课程报名|试听|说明会报名/i.test(text)) return "fip_student_recruitment";
  if (/合作方招募|招募合作方|城市合伙人|渠道合作|联营合作/i.test(text)) return "fip_partner_recruitment";
  if (/销售漏斗|线索.*建联|建联.*成交|转化率.*成交/i.test(text)) return "funnel_review";
  if (/跟单|跟进计划|方案发.*天|内部讨论.*会议/i.test(text)) return "follow_up_plan";
  if (/成交话术|不施压|迟迟不签|推进签约/i.test(text)) return "closing_script";
  if (/太贵|考虑考虑|异议|怎么回复客户/i.test(text)) return "objection_reply";
  if (/水温|意向.*优先级|客户意向/i.test(text)) return "intent_temperature";
  if (/复盘.*客户|客户对话|销售沟通|团队讨论/i.test(text)) return "customer_diagnosis";
  if (/直播|开场话术|留人话术|下播|主播话术/i.test(text)) return "live_script";
  if (/朋友圈|私域|社群|私聊承接/i.test(text)) return "moments_private";
  return fallback;
}

function composerCapabilityToSkillId(capabilityId: ComposerTemplateCapabilityId): string {
  if (capabilityId === "content_nine_piece") return "content_plan";
  if (capabilityId === "moments_private") return "private_domain";
  return capabilityId;
}

function buildAnalyzedAttachmentSummary(filename: string, sizeLabel: string, analysis: MediaAnalysisResponse): string {
  return [
    `用户上传了业务文件：${filename}，${sizeLabel}。`,
    analysis.contextText ?? "",
    analysis.warnings?.length ? `解析提醒：${analysis.warnings.join("；")}` : "",
    "分析时只能引用上面的文件事实；没有读取到的内容必须标记为待补。"
  ].filter(Boolean).join("\n");
}

function buildEnhancedPrompt(capabilityId: ComposerTemplateCapabilityId, source: string, profileSummary = ""): string {
  const normalizedSource = source.trim();
  const contextBlock = [
    "【用户原始需求】",
    normalizedSource,
    "",
    "【系统已确认的企业资料】",
    profileSummary.trim() || "企业资料尚未完整；缺少的信息标记为待确认，不要编造。",
    profileSummary.trim() ? "请直接使用这些资料，不要再次要求用户重复填写。" : ""
  ].filter(Boolean);
  if (capabilityId === "industry_hotspots") {
    return [
      "请先帮我抓取近期行业热点，再整理客户正在咨询的问题。",
      "",
      ...contextBlock,
      "",
      "【请重点围绕这些点输出】",
      "1. 我所在行业/品类是什么，城市或区域在哪里",
      "2. 这个行业近期有哪些热点资讯/公开线索",
      "3. 目标客户最近正在咨询什么、担心什么、想解决什么",
      "4. 我主要发哪个平台：抖音、小红书、视频号还是朋友圈",
      "5. 哪些热点适合我蹭，哪些不适合我蹭",
      "6. 热点怎么转成IP选题、短视频切入、朋友圈内容或直播话题",
      "7. 今天最值得我马上执行哪3个动作",
      "",
      "【我希望的呈现方式】",
      "请先给近期热点咨询和来源线索，再给可蹭IP选题、内容切入、发布动作和风险提醒。热点来源和动作建议适合对照的地方可以用表格。"
    ].join("\n");
  }

  if (capabilityId === "franchise_acquisition") {
    return [
      "请按SCALE招商获客逻辑完成这次招商内容方案。",
      "",
      ...contextBlock,
      "",
      "【请重点围绕这些点输出】",
      "1. 品牌/加盟项目是什么，本轮想招哪类加盟商",
      "2. 开放区域、合作条件和希望筛选掉哪些不匹配人群",
      "3. 有哪些可验证的直营店、样板店、产品、供应链、培训或运营支持证据",
      "4. 本次是招商短视频、创始人口播、直播还是朋友圈场景",
      "5. 全片只保留哪个留资动作：关键词资料、加盟表、项目沟通或考察预约",
      "6. 哪些投资、收益、案例和数据尚未确认，必须标记待补",
      "",
      "【我希望的呈现方式】",
      "请按SCALE完成筛人、建信、讲模型、留资、证据与边界，并给招商短视频文案、拍摄脚本、评论区线索承接、投流建议和合规提醒。不要套用面向终端消费者的团购到店逻辑。"
    ].join("\n");
  }

  if (["fip_franchise", "fip_store_visit", "fip_student_recruitment", "fip_partner_recruitment"].includes(capabilityId)) {
    return [
      `【创始人IP获客目标】${capabilityId}`,
      ...contextBlock,
      "必须围绕当前单一目标生成内容与承接草案；事实缺失标记【待补】，不得编造结果或声称已执行投流、发布、付款或发消息。",
      "不得使用其他获客目标的线索、预算、承接状态或成功指标。"
    ].join("\n");
  }

  if (capabilityId === "baolu_ip_advisor") {
    return [
      "请以保禄的新媒体与创始人IP能力分身回答，不冒充保禄本人。",
      "只处理新媒体内容、创始人IP定位与表达、账号经营、选题、内容结构、自然获客和内容承接问题；超出范围时请明确说明边界。",
      "先给直接判断，再给判断依据、今天可执行的一步和待确认/待验证项。没有本轮证据的账号数据、平台规则、案例、效果或结果不得编造。",
      "不得声称已经发布、投放、发消息、修改账号或执行任何外部动作。",
      "",
      ...contextBlock
    ].join("\n");
  }

  if (capabilityId === "paid_traffic") {
    return [
      "请只完成本次投流诊断与测试方案，不扩写成完整内容创作。",
      "",
      ...contextBlock,
      "",
      "【请先判断】",
      "1. 投放平台、账户当前能使用哪些投流工具",
      "2. 目标是播放、主页访问、私信、表单留资、加微、预约、到店还是成交",
      "3. 实际可承接地域和落地承接方式",
      "4. 待投素材及其自然播放、完播、互动、主页访问和私信/留资数据",
      "5. 历史投放结果、总预算、单日上限和测试周期",
      "",
      "【直接输出】",
      "是否建议投；平台与工具选择依据；素材A/B；小额测试预算与节奏；人群和地域；监控指标；止损条件；复盘时间；合规提醒；供未来桌面自动化读取的执行草案。",
      "",
      "当前阶段只给建议。没有读取到真实广告账户时，不得声称已经创建、修改、提交或启动投放。数据不足时把缺口写清楚，并给不依赖假数据的最小测试方案。"
    ].join("\n");
  }

  if (capabilityId === "live_script") {
    return [
      "请基于已确认的企业资料，直接完成这次直播话术设计。",
      "",
      ...contextBlock,
      "",
      "【本次任务范围】",
      "只输出直播间可以直接使用的话术，不自动增加用户没有要求的其他交付物。",
      "",
      "【直接输出】",
      "1. 3分钟开场话术",
      "2. 留人和互动话术",
      "3. 产品/服务价值讲解话术",
      "4. 常见顾虑回应话术",
      "5. 咨询和转化承接话术",
      "6. 下播前收口及后续跟进话术",
      "",
      "平台、时长、价格、福利或案例没有提供时标记“待确认”，先基于已有企业资料给出第一版，不要反复询问已经确认的身份、产品和目标客户。"
    ].join("\n");
  }

  if (capabilityId === "moments_private") {
    return [
      "请帮我完成这次朋友圈私域内容设计。",
      "",
      ...contextBlock,
      "",
      "【请重点围绕这些点输出】",
      "1. 我是做什么的，主推什么产品/服务",
      "2. 朋友圈里主要是谁：老客、新客、潜在客户还是同行",
      "3. 这次想建立信任、种草、预约、复购、转介绍还是成交",
      "4. 有哪些真实案例、客户反馈、门店现场或产品文件",
      "5. 有哪些不能说、不能夸大或需要注意的边界",
      "6. 我想要几条朋友圈，以及是否需要私聊承接话术",
      "",
      "【我希望的呈现方式】",
      "请直接给我像真人能发出去的朋友圈文案，并配好私聊承接话术。信任型、场景型、成交型分清楚，适合对照的话术可以用表格。"
    ].join("\n");
  }

  if (capabilityId === "video_review") {
    return [
      "请帮我完成这次视频数据复盘。",
      "",
      ...contextBlock,
      "",
      "【请重点围绕这些点输出】",
      "1. 上传哪个平台后台导出的 CSV/Excel 数据文件",
      "2. 最想优先分析播放、完播、平均播放时长、互动、关注还是业务线索",
      "3. 本轮要复盘的日期范围和账号/项目范围",
      "4. 文件里是否包含投流、主页访问、私信、留资或成交字段",
      "5. 下一轮最想提升哪个指标",
      "",
      "【我希望的呈现方式】",
      "请严格按 video-review-report-baolu-wechat 标准报告输出十二段深度复盘；先审计全部数据，再做分层、内容健康度、单条深拆、完播、互动、趋势、规律、方法论、下周期选题和综合结论。不要分析视频画面。"
    ].join("\n");
  }

  if (capabilityId === "shooting_editing") {
    return [
      "请帮我完成这次拍剪优化。",
      "",
      ...contextBlock,
      "",
      "【请重点围绕这些点输出】",
      "1. 我要拍什么视频，想让客户看完做什么动作",
      "2. 谁出镜，拍什么场景、产品、案例或细节",
      "3. 已经有哪些照片、视频、口播、客户反馈或门店文件",
      "4. 准备发到哪个平台，想要什么节奏和风格",
      "5. 有哪些拍摄限制：不出镜、不能露客户、环境嘈杂、时间有限等",
      "6. 我这次最想拿到镜头结构、分镜、EDL还是发布前检查",
      "",
      "【我希望的呈现方式】",
      "请直接给拍摄和剪辑能执行的清单、分镜和剪辑EDL。镜头、字幕、封面、发布前检查分清楚。"
    ].join("\n");
  }

  return [
    "请基于已确认的企业资料完成本次内容任务。",
    "",
    ...contextBlock,
    "",
    "【本次任务范围】",
    "先识别用户明确要求的是选题、标题、口播逐字稿、直播话术、复盘还是完整方案，只输出用户明确要求的部分。",
    "用户没有明确要求完整方案时，不要主动扩展交付范围。",
    "",
    "【输出要求】",
    "结合企业的行业、产品/服务和目标客户直接给出可执行结果；未知的平台、目标动作、素材或限制标记“待确认”，但不要重复询问系统已经确认的企业信息。"
  ].join("\n");
}

function getEnhanceStatus(capabilityId: ComposerTemplateCapabilityId, usedProfile: boolean): string {
  const profileNote = usedProfile ? "，并自动带入已确认的企业资料" : "";
  if (capabilityId === "industry_hotspots") return `已识别为行业热点任务${profileNote}。`;
  if (capabilityId === "paid_traffic") return `已识别为投流策略任务${profileNote}，当前只生成建议和执行草案。`;
  if (capabilityId === "franchise_acquisition") return `已识别为招商获客任务${profileNote}。`;
  if (capabilityId === "fip_franchise") return `已识别为招商加盟目标${profileNote}，指标将与其他目标隔离。`;
  if (capabilityId === "fip_store_visit") return `已识别为C端团购到店目标${profileNote}，仅按预约、到店、核销与复购口径处理。`;
  if (capabilityId === "fip_student_recruitment") return `已识别为学员招募目标${profileNote}，不承诺证书、就业或收入。`;
  if (capabilityId === "fip_partner_recruitment") return `已识别为合作方招募目标${profileNote}，仅生成资格判断与洽谈草案。`;
  if (capabilityId === "baolu_ip_advisor") return `已进入问问保禄：仅提供新媒体与创始人IP专业判断${profileNote}。`;
  if (capabilityId === "live_review") return `已识别为直播数据复盘任务${profileNote}。`;
  if (capabilityId === "live_script") return `已识别为直播话术任务${profileNote}，只会输出直播话术。`;
  if (capabilityId === "moments_private") return `已识别为朋友圈私域任务${profileNote}。`;
  if (capabilityId === "video_review") return `已识别为视频数据复盘任务${profileNote}。`;
  if (capabilityId === "shooting_editing") return `已识别为拍剪优化任务${profileNote}。`;
  return `已按用户当前要求完善提问${profileNote}，不会自动扩大交付范围。`;
}

function buildInputWithAttachments(input: string, attachments: PendingAttachment[]): string {
  if (attachments.length === 0) return input;
  const attachmentContext = attachments
    .map((attachment, index) =>
      [
        `附件${index + 1}：${attachment.filename}`,
        `类型：${attachment.mimeType}`,
        "附件摘要：",
        attachment.summary
      ].join("\n")
    )
    .join("\n\n");

  return [
    input || "请结合本次上传的附件进行分析。",
    "",
    "【本次用户上传/粘贴的附件】",
    attachmentContext,
    "",
    "请把附件当作本轮用户输入的一部分，严格按当前 IP获客智能体能力输出。"
  ].join("\n");
}

function buildVideoAttachmentSummary(params: {
  capabilityId: ComposerTemplateCapabilityId;
  filename: string;
  metadata: string;
  sizeLabel: string;
  contextText: string;
  hasTranscript: boolean;
  hasFrameSummary: boolean;
  warnings: string[];
}): string {
  const baseInfo = `用户上传了视频文件：${params.filename}，${[params.metadata, params.sizeLabel].filter(Boolean).join("，")}。`;
  const taskLine =
    params.capabilityId === "video_review"
      ? "当前能力是视频数据复盘，但该能力只接受 CSV/Excel 数据文件；当前上传的是视频文件，请改用拍剪优化能力。"
      : params.capabilityId === "shooting_editing"
        ? "当前能力是拍剪优化：必须聚焦镜头结构、拍摄注意事项、分镜、剪辑EDL、字幕、封面标题和发布前检查。"
        : "请把视频文件作为本轮上下文的一部分，按当前能力输出。";
  const evidenceBoundary = [
    "路由边界：视频转写和画面解析只是证据，不能因为素材中出现“直播”“文案”“朋友圈”等词就新增其他任务。",
    "事实边界：不得从企业默认画像推断这条视频的城市、平台、内容主体、目标客户或转化动作；只有用户本轮明确说明，或视频画面/口播清楚出现时才能采用，否则标为待确认。",
    "修改边界：用户要修改建议时，先评价现有视频并给具体改法，不得擅自改成另一个选题、另一个城市或“我们家”的营销文案。"
  ].join("\n");
  const factLine = params.contextText || "本次没有拿到自动画面解析或口播转写结果，只能基于用户文字、视频基础信息和已给数据列出待补项，不要生成具体画面结论。";
  const noAnalysisLine =
    !params.hasTranscript && !params.hasFrameSummary
      ? "注意：本次只读取到了视频基础信息，没有可靠画面解析或口播转写。不能编造视频内容、行业场景、画面问题或数据结论；请先说明解析缺口，并让用户补充开头截图、口播/字幕或后台数据。"
      : "";
  const missingLine =
    !params.hasTranscript && params.capabilityId === "video_review"
      ? "不要根据视频基础信息生成复盘；请提示用户上传平台后台导出的 CSV/Excel 数据明细。"
      : "";
  const warningLine = params.warnings.length ? `解析提示：${params.warnings.join("；")}` : "";
  return [baseInfo, taskLine, evidenceBoundary, factLine, noAnalysisLine, missingLine, warningLine].filter(Boolean).join("\n");
}

function buildTextAttachmentSummary(params: {
  capabilityId: ComposerTemplateCapabilityId;
  filename: string;
  mimeType: string;
  text: string;
}): string {
  if (!params.text) return "文件已选择，但未读取到可用文字。";
  const hasVideoDataColumns = /视频描述|视频标题|作品标题/.test(params.text)
    && /播放量|完播率|平均播放时长|评论量|关注量|转发聊天和朋友圈/.test(params.text);
  const looksLikeVideoDataTable = hasVideoDataColumns
    && (params.capabilityId === "video_review" || /\.csv$/i.test(params.filename) || /csv/i.test(params.mimeType));
  const maxChars = looksLikeVideoDataTable ? 16000 : 4000;
  const trimmed = params.text.slice(0, maxChars);
  if (!looksLikeVideoDataTable) return trimmed;

  const headerLine = params.text.split(/\r?\n/).find((line) => /视频描述|发布时间|完播率|平均播放时长|播放量/.test(line)) ?? "";
  const fields = Array.from(headerLine.matchAll(/"([^"]+)"/g))
    .map((match) => match[1])
    .filter((field) => /视频描述|发布时间|完播率|平均播放时长|播放量|推荐|喜欢|评论量|分享量|关注量|转发聊天和朋友圈/.test(field))
    .slice(0, 12);

  return [
    "【视频号数据表解析结果】",
    `文件：${params.filename}`,
    "类型：数据表，不是视频画面文件。",
    fields.length ? `已识别字段：${fields.join("、")}` : "已识别字段：待从完整表头继续确认。",
    "使用要求：必须逐行读取表格，核对记录数、字段、日期范围和代表作品；只能按表格字段和用户原话复盘。表内出现的招商、加盟、餐饮或门店只是作品主题证据，不得因此调用招商获客或生成招商文案。不要假设画面、口播或镜头细节，涉及画面/口播必须写待补。",
    params.text.length > maxChars ? `读取提示：文件内容较长，本轮已纳入前 ${maxChars} 字；如需全量统计，请拆分或上传导出的核心字段。` : "读取提示：本轮已纳入当前文件的可读文本内容。",
    "",
    "原始可读内容：",
    trimmed
  ].join("\n");
}

function buildDisplayInputWithAttachments(input: string, attachments: PendingAttachment[]): string {
  if (attachments.length === 0) return input;
  const attachmentLines = attachments.map((attachment, index) => {
    const label = attachment.kind === "video" ? "视频" : attachment.kind === "audio" ? "音频" : attachment.kind === "image" ? "图片" : attachment.kind === "text" ? "文件" : "附件";
    return `${index + 1}. ${label}：${attachment.filename}（${attachment.detailLabel}，${attachment.sizeLabel}）`;
  });
  return [
    input || (attachments.some((attachment) => attachment.kind === "video")
      ? "根据我上传的视频，给出镜头结构、剪辑节奏和发布前修改建议。"
      : "请结合我上传的文件分析。"),
    "",
    "已上传文件：",
    ...attachmentLines
  ].join("\n");
}

function stripMultipartHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).filter(([key]) => key.toLowerCase() !== "content-type"));
}

function isVideoFile(file: File): boolean {
  return file.type.startsWith("video/") || /\.(mp4|mov|m4v|avi|webm|mkv)$/i.test(file.name);
}

function resolveVideoUploadCapability(
  currentCapabilityId: ComposerTemplateCapabilityId,
  input: string
): ComposerTemplateCapabilityId {
  if (currentCapabilityId !== "content_nine_piece") return currentCapabilityId;
  const text = input.replace(/\s+/g, "");
  if (/视频复盘|复盘(?:这|该|上传的)?(?:条)?视频|播放量|完播率|平均播放|作品复盘|视频数据|后台数据/.test(text)) return "video_review";
  if (/文案|脚本|口播|选题|内容九件套/.test(text) && !/拍剪|镜头|分镜|拍摄|剪辑|修改建议|发布前|EDL|拆片/.test(text)) return "content_nine_piece";
  return "shooting_editing";
}

function attachmentIcon(kind: PendingAttachment["kind"]): string {
  if (kind === "image") return "图";
  if (kind === "video") return "视";
  if (kind === "audio") return "音";
  if (kind === "text") return "文";
  return "件";
}

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "大小未知";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function audioExtensionForMime(mimeType: string): "m4a" | "webm" {
  return mimeType.toLowerCase().includes("mp4") ? "m4a" : "webm";
}

function voiceCaptureErrorMessage(error: unknown): string {
  const name = error instanceof DOMException
    ? error.name
    : typeof error === "object" && error && "name" in error
      ? String(error.name)
      : "";
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") {
    return "麦克风权限未开启。请在浏览器地址栏或系统设置中允许本页面使用麦克风，然后重试。";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "没有检测到可用麦克风，请连接或启用麦克风后重试。";
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return "麦克风当前无法使用，可能正被微信、会议软件或其他应用占用。关闭占用后再试。";
  }
  if (name === "OverconstrainedError") {
    return "当前麦克风不支持所需的录音设置，请换一个麦克风后重试。";
  }
  return "无法启动语音输入，请检查麦克风权限和设备状态后重试。";
}

function nativeSpeechErrorMessage(errorCode?: string): string {
  if (errorCode === "not-allowed" || errorCode === "service-not-allowed") {
    return "麦克风权限未开启。请在浏览器地址栏或系统设置中允许本页面使用麦克风，然后重试。";
  }
  if (errorCode === "audio-capture") {
    return "没有检测到可用麦克风，或麦克风正被其他应用占用。";
  }
  if (errorCode === "no-speech") {
    return "没有听到清晰语音，请靠近麦克风后重试。";
  }
  if (errorCode === "network") {
    return "语音识别服务网络连接失败，请检查网络后重试。";
  }
  return "语音识别失败，请检查麦克风权限和网络后重试。";
}

function voiceTranscriptionFailureMessage(analysis: MediaAnalysisResponse | null): string {
  const warning = analysis?.warnings?.find((item) => /语音|转写|ASR|百炼|请求|服务/i.test(item))
    ?? analysis?.warnings?.[0]
    ?? "";
  if (/返回为空|未识别|没有识别|没有.*内容/.test(warning)) {
    return "没有识别到清晰语音。请靠近麦克风、连续说一句完整的话后重试。";
  }
  if (/未配置|未启用/.test(warning) || analysis?.configured === false) {
    return warning || "语音转写服务尚未启用，请联系管理员配置后重试。";
  }
  return warning || "没有识别到清晰语音，请重试或直接输入文字。";
}

function readVideoMetadata(file: File): Promise<string> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    const cleanup = () => {
      URL.revokeObjectURL(url);
      video.removeAttribute("src");
      video.load();
    };
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      const duration = Number.isFinite(video.duration) && video.duration > 0 ? formatDuration(video.duration) : "";
      const size = video.videoWidth && video.videoHeight ? `${video.videoWidth}x${video.videoHeight}` : "";
      cleanup();
      resolve([duration, size].filter(Boolean).join("，") || "视频文件");
    };
    video.onerror = () => {
      cleanup();
      resolve("视频文件");
    };
    video.src = url;
  });
}

async function extractVideoFrames(file: File, maxFrames = 6): Promise<string[]> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    const frames: string[] = [];
    const cleanup = () => {
      URL.revokeObjectURL(url);
      video.removeAttribute("src");
      video.load();
    };

    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.onloadedmetadata = async () => {
      try {
        const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : maxFrames;
        const sampleCount = Math.max(1, Math.min(maxFrames, Math.floor(duration)));
        const times = Array.from({ length: sampleCount }, (_, index) => {
          const ratio = sampleCount === 1 ? 0.1 : index / (sampleCount - 1);
          return Math.max(0.05, Math.min(duration - 0.05, duration * ratio));
        });
        const canvas = document.createElement("canvas");
        for (const time of times) {
          await seekVideo(video, time);
          const width = Math.min(video.videoWidth || 720, 720);
          const height = video.videoWidth && video.videoHeight
            ? Math.round((width / video.videoWidth) * video.videoHeight)
            : 1280;
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext("2d");
          if (!context) continue;
          context.drawImage(video, 0, 0, width, height);
          const frame = canvas.toDataURL("image/jpeg", 0.72);
          if (frame && frame.length < 900_000) frames.push(frame);
        }
      } catch {
        // Ignore frame extraction failures; upload still proceeds with metadata.
      } finally {
        cleanup();
        resolve(frames);
      }
    };
    video.onerror = () => {
      cleanup();
      resolve([]);
    };
    video.src = url;
  });
}

function seekVideo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("video_seek_timeout"));
    }, 3000);
    const cleanup = () => {
      window.clearTimeout(timeout);
      video.removeEventListener("seeked", handleSeeked);
      video.removeEventListener("error", handleError);
    };
    const handleSeeked = () => {
      cleanup();
      resolve();
    };
    const handleError = () => {
      cleanup();
      reject(new Error("video_seek_failed"));
    };
    video.addEventListener("seeked", handleSeeked, { once: true });
    video.addEventListener("error", handleError, { once: true });
    video.currentTime = time;
  });
}

function readImageMetadata(file: File): Promise<string> {
  return new Promise((resolve) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    const cleanup = () => URL.revokeObjectURL(url);
    image.onload = () => {
      const dimensions = image.naturalWidth && image.naturalHeight ? `${image.naturalWidth}x${image.naturalHeight}` : "";
      cleanup();
      resolve(dimensions ? `图片 ${dimensions}` : "图片文件");
    };
    image.onerror = () => {
      cleanup();
      resolve("图片文件");
    };
    image.src = url;
  });
}

function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return minutes > 0 ? `${minutes}分${String(rest).padStart(2, "0")}秒` : `${rest}秒`;
}

function cleanVisiblePromptInput(value: string): string {
  const trimmed = value.trim();
  const providedMatch = trimmed.match(/(?:【用户已提供的信息】|【我的基础信息】)\s*([\s\S]*?)(?:\n\s*【请用户\/系统优先补齐的关键输入】|\n\s*【请重点围绕这些点输出】|$)/);
  const visiblePart = (providedMatch?.[1] ?? trimmed).trim();
  return visiblePart
    .split(/\r?\n/)
    .filter((line) => {
      const text = line.trim();
      if (!text) return true;
      return !(
        /skill|隐藏能力|用户\/系统|请严格按当前|不调用\s*IP定位|其他隐藏能力/i.test(text) ||
        text === "【输出要求】" ||
        text === "【请用户/系统优先补齐的关键输入】" ||
        /^按所选能力输出/.test(text)
      );
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

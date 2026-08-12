import type { AgentWorkMapDefinition } from "@baolu/shared";

export type AgentSeedStatus = "active" | "coming_soon";

export interface AgentCapabilitySeed {
  key: string;
  title: string;
  subtitle: string;
  skillId: string;
  promptTemplate: string;
}

export interface AgentDefinitionSeed {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon: string;
  status: AgentSeedStatus;
  sortOrder: number;
  defaultSkillId: string;
  capabilities: AgentCapabilitySeed[];
  marketing: {
    eyebrow: string;
    headline: string;
    promise: string;
    audience: string;
    shortName?: string;
    method?: string;
    tagline?: string;
    knowledgeAction?: {
      enabled: boolean;
      buttonLabel: string;
      defaultInstruction: string;
      allowedDocumentTypes: string[];
      capabilityId: string;
    };
    automationAction?: {
      enabled: boolean;
      buttonLabel: string;
      defaultTaskType: string;
      defaultInstruction: string;
      allowedTaskTypes: string[];
      capabilityId: string;
    };
    workMap?: AgentWorkMapDefinition;
  };
}

export const AGENT_DEFINITIONS: AgentDefinitionSeed[] = [
  {
    id: "agent_ceo_cockpit",
    slug: "ceo-cockpit",
    name: "思潼·CEO经营驾驶舱智能体",
    description: "专门给老板使用的经营决策系统，把企业资料和真实数据变成主动简报、经营判断、决策审批与行动追踪。",
    icon: "舱",
    status: "active",
    sortOrder: 5,
    defaultSkillId: "ceo-cockpit-analyst",
    marketing: {
      shortName: "CEO经营驾驶舱",
      method: "老板经营决策系统",
      tagline: "围绕推、看、决、令形成经营闭环：主动发现问题、看清证据、辅助决策、下达并追踪行动。",
      eyebrow: "专门给老板使用的AI经营系统",
      headline: "每天先看经营简报，再把关键问题变成可审批、可追踪的行动令",
      promise: "先核对数据口径和证据，再给经营信号、待决事项和行动令草案；没有真实数据时不生成假仪表盘，未经老板批准不冒充已下令。",
      audience: "企业老板、连锁品牌负责人、门店经营者和OPC主理人",
      knowledgeAction: {
        enabled: true,
        buttonLabel: "分析这些经营资料",
        capabilityId: "daily_push",
        defaultInstruction: "请从老板视角分析选中的经营资料。先标明经营主体、统计周期、数据来源和更新时间，再输出老板先看、优势放大、经营信号灯、问题优化、待老板决策、行动令草案、证据与缺口和下次回流。建议数量与篇幅按约一半问题优化、约一半优势放大组织；优势必须写亮点证据、有效机制、放大动作和验证指标。没有真实数据时只给当前可判断内容和最小补数清单，不生成虚假仪表盘，也不编造亮点。",
        allowedDocumentTypes: ["transcript", "note", "web_page"]
      },
      automationAction: {
        enabled: true,
        buttonLabel: "设置经营自动化",
        defaultTaskType: "daily_business_advice",
        defaultInstruction: "每天根据本企业已确认的经营资料生成老板简报，只输出有证据的风险、机会、待决策事项和行动草案；资料不足时列出最小补数清单，不编造数据。",
        allowedTaskTypes: ["daily_business_advice", "file_analysis_followup", "ceo_action_order"],
        capabilityId: "daily_push"
      }
    },
    capabilities: [
      {
        key: "daily_push",
        title: "推｜今日简报",
        subtitle: "主动汇总值得老板介入的风险、机会与待办",
        skillId: "ceo-cockpit-analyst",
        promptTemplate: "请读取本轮提供的经营资料、手工数据和文件，先审计主体、周期、口径、来源与更新时间，再生成老板今日简报。建议数量与篇幅按约一半问题优化、约一半优势放大组织；从录音和经营资料提炼有证据的沟通或经营亮点，写清有效机制、放大动作与验证指标。只推送值得老板介入的风险、机会和待决事项；没有真实数据时只显示资料完整度和最小补数清单，不编造亮点。"
      },
      {
        key: "business_map",
        title: "看｜经营地图",
        subtitle: "按业务、门店、项目下钻经营事实与异常",
        skillId: "ceo-cockpit-analyst",
        promptTemplate: "请按业务、门店或项目整理经营地图。问题优化按现象、证据、影响、可能原因和待验证数据下钻；优势放大按亮点证据、有效机制、放大动作和验证指标展开，二者数量与篇幅各约一半。必须区分已确认事实、分析假设和待补数据，不把相关性直接写成因果，也不编造正向亮点。"
      },
      {
        key: "decision_center",
        title: "决｜决策中心",
        subtitle: "比较方案、依据与风险，等待老板批准或驳回",
        skillId: "ceo-cockpit-analyst",
        promptTemplate: "请根据已确认的经营结论，把需要老板拍板的事项压缩为三项以内。既包含短板修复，也包含有证据的优势放大，整体数量与篇幅各约一半；每项给出建议方案、证据、收益、风险、备选方案和最晚决策时间，并明确标记为待老板同意，不得冒充已批准。"
      },
      {
        key: "command_center",
        title: "令｜执行指挥",
        subtitle: "把已批准决策拆成责任、截止、验收与回流",
        skillId: "ceo-cockpit-analyst",
        promptTemplate: "请只把老板已经批准的决策转成三项以内行动令草案。每项写明责任角色、截止时间、交付物、验收标准、回传证据和复盘时间；未获批准的事项继续标记为草案，不得声称已经通知负责人。"
      }
    ]
  },
  {
    id: "agent_takeaway_growth",
    slug: "takeaway-growth",
    name: "思潼·外卖增长智能体",
    description: "面向外卖老店增长与新店突破的专业工作台：审计平台经营数据，定位订单与利润断点，并生成可审批、可复盘的增长实验。",
    icon: "外",
    status: "active",
    sortOrder: 7,
    defaultSkillId: "takeaway-growth-advisor",
    marketing: {
      shortName: "思潼外卖增长",
      method: "思潼外卖订单与利润增长系统",
      tagline: "老店找增量，新店做突破；从数据口径、平台漏斗、菜单利润到活动投放，找到最值得先改的一环。",
      eyebrow: "思潼 · 外卖平台经营诊断",
      headline: "老店先找增长瓶颈，新店先跑通冷启动，再决定改菜单、活动还是投放",
      promise: "上传枕水江南外卖后台原始导出，先校验有效完成单、实付、补贴、退款和利润口径，再定位曝光、进店、商品、下单、履约、复购中的主要断点，最后生成一个带审批与止损条件的单变量实验。资料不足时继续交付暂定版，不编造数据或因果结论。",
      audience: "供品牌总部及门店运营团队使用；每轮测试需保持变量稳定7至14天。",
      knowledgeAction: {
        enabled: true,
        buttonLabel: "审计这些外卖经营资料",
        capabilityId: "takeaway_data_audit",
        defaultInstruction: "请审计选中的外卖经营资料。先确认门店、平台、周期、指标定义和数据完整度，再区分可确认事实、方向性信号与待补信息；按有效完成单、实付、补贴、退款、平台漏斗、商品结构、履约和利润护栏输出第一版诊断。不得泄露顾客个人信息，不得把前后对比直接写成因果。",
        allowedDocumentTypes: ["transcript", "note", "web_page"]
      },
      automationAction: {
        enabled: true,
        buttonLabel: "设置外卖经营自动化",
        defaultTaskType: "daily_business_advice",
        defaultInstruction: "按设定周期检查本门店外卖经营资料，校验平台、门店、周期与指标口径后提示订单、利润、履约和活动异常；不得用汇总截图替代原始数据，也不得把相关性写成因果。",
        allowedTaskTypes: ["daily_business_advice", "file_analysis_followup", "local_push_ad_plan"],
        capabilityId: "takeaway_data_audit"
      },
      workMap: {
        id: "takeaway-growth-map",
        version: 5,
        title: "枕水江南外卖增长任务地图",
        subtitle: "上传数据后立即核验数据可用性和经营阶段，再由AI全面诊断、验证真因、制定方案、真实执行、评估增长并周期复盘。",
        nodes: [
          {
            id: "takeaway_knowledge",
            title: "1. 数据与经营阶段",
            subtitle: "上传后自动检查可用范围与待补数据",
            icon: "资",
            kind: "system",
            position: { x: 8, y: 30 },
            action: { type: "capability", capabilityId: "takeaway_data_foundation" }
          },
          {
            id: "takeaway_growth",
            title: "2. AI经营诊断",
            subtitle: "进入即输出完整诊断，优先识别跨维度组合信号",
            icon: "诊",
            kind: "system",
            position: { x: 35, y: 30 },
            action: { type: "capability", capabilityId: "takeaway_growth" }
          },
          {
            id: "takeaway_problem_validation",
            title: "3. 问题验证",
            subtitle: "每轮只验证1个原因假设",
            icon: "验",
            kind: "system",
            position: { x: 62, y: 30 },
            action: { type: "capability", capabilityId: "takeaway_problem_validation" }
          },
          {
            id: "takeaway_growth_plan",
            title: "4. 增长落地方案",
            subtitle: "真因确认后制定可审批执行计划",
            icon: "案",
            kind: "system",
            position: { x: 80, y: 72 },
            action: { type: "capability", capabilityId: "takeaway_experiment" }
          },
          {
            id: "takeaway_execution",
            title: "5. 真实执行与回填",
            subtitle: "门店落地，每日记录动作和结果",
            icon: "执",
            kind: "system",
            position: { x: 58, y: 72 },
            action: { type: "capability", capabilityId: "takeaway_execution" }
          },
          {
            id: "takeaway_effect_evaluation",
            title: "6. 增长效果评估",
            subtitle: "对比基线，判断是否真的增长",
            icon: "效",
            kind: "system",
            position: { x: 36, y: 72 },
            action: { type: "capability", capabilityId: "takeaway_effect_evaluation" }
          },
          {
            id: "takeaway_review",
            title: "7. 周期复盘与决策",
            subtitle: "继续、调整或停止，并决定下一轮",
            icon: "复",
            kind: "review",
            position: { x: 14, y: 72 },
            action: { type: "capability", capabilityId: "takeaway_review" }
          }
        ],
        edges: [
          { id: "takeaway-foundation-diagnosis", from: "takeaway_knowledge", to: "takeaway_growth", type: "flow" },
          { id: "takeaway-diagnosis-validation", from: "takeaway_growth", to: "takeaway_problem_validation", type: "flow" },
          { id: "takeaway-validation-plan", from: "takeaway_problem_validation", to: "takeaway_growth_plan", type: "flow" },
          { id: "takeaway-plan-execution", from: "takeaway_growth_plan", to: "takeaway_execution", type: "flow" },
          { id: "takeaway-execution-evaluation", from: "takeaway_execution", to: "takeaway_effect_evaluation", type: "flow" },
          { id: "takeaway-evaluation-review", from: "takeaway_effect_evaluation", to: "takeaway_review", type: "flow" },
          {
            id: "takeaway-review-feedback",
            from: "takeaway_review",
            to: "takeaway_growth",
            type: "feedback",
            label: "无效则回到诊断，有效则进入下一轮",
            waypoints: [{ x: 14, y: 6 }, { x: 35, y: 6 }]
          }
        ]
      }
    },
    capabilities: [
      {
        key: "takeaway_data_foundation",
        title: "数据与经营阶段",
        subtitle: "上传即自动核验可用性、覆盖范围与待补数据",
        skillId: "takeaway-growth-advisor",
        promptTemplate: "请在外卖经营文件上传完成后立即进行数据可用性检查，并结合门店填写的经营阶段输出：数据是否可用、已经读到什么、当前可判断范围、还缺什么数据、下一步。核对文件、周期、字段覆盖、重复、冲突和关键缺失；不做业绩归因，不输出增长方案，也不要要求用户再进入独立的数据质量任务。"
      },
      {
        key: "takeaway_growth",
        title: "AI经营诊断",
        subtitle: "全面扫描原因地图，突出最优先的三个验证候选",
        skillId: "takeaway-growth-advisor",
        promptTemplate: "请从外卖经营事实中主动寻找未知问题。先锁定门店、经营阶段、平台、周期和有效完成单口径，再全面扫描流量、进店、商品点击、价格套餐、活动投放、支付、履约、退款评价、时段供应、复购、竞品和数据口径。优先寻找至少两个维度相互印证的组合信号：平台漏斗与订单趋势、客单与订单、价格策略与承接、投放回收与下单、履约与退款等。单日低谷或单品成本高只能作为线索，除非有第二项可复核证据交叉支持，否则不得列为优先问题。先输出达到异常门槛的详细问题清单，再输出完整原因地图。没有异常证据只能写暂无异常证据或数据不足，不能因为字段存在就写基本排除。订单增长影响与利润影响分开说明：成本高首先是利润问题，履约只有存在取消、退款、差评或复购证据时才可写成增长原因。页面只突出最多三个最优先验证候选，但不得隐藏其他原因。每个候选写明支持证据、反证和验证办法；诊断页不生成7天或14天计划。不得把假设写成真因。"
      },
      {
        key: "mature_store_growth",
        title: "老店增长",
        subtitle: "突破平台、商品、客单与复购瓶颈",
        skillId: "takeaway-growth-advisor",
        promptTemplate: "请聚焦成熟外卖门店增长。先用本店历史基线和同口径兄弟门店识别平台流量、进店、商品结构、客单、利润、履约和复购中的瓶颈；保护已经验证有效的商品与活动，每轮只测试一个增量变量。"
      },
      {
        key: "new_store_breakthrough",
        title: "新店业绩突破",
        subtitle: "7天、14天、30天冷启动与样板复制",
        skillId: "takeaway-growth-advisor",
        promptTemplate: "请聚焦新外卖门店业绩突破。先确认开业日、商圈、配送半径、平台上线日和首月目标，再从可比成熟门店提取已验证的商品、价格带、活动与履约经验，形成7天、14天、30天冷启动计划；跨商圈复制必须重新验证。"
      },
      {
        key: "takeaway_data_audit",
        title: "数据口径审计",
        subtitle: "订单、实付、补贴、退款与缺失值",
        skillId: "takeaway-growth-advisor",
        promptTemplate: "请聚焦外卖数据口径与质量。核对逐单明细和每日汇总能否互相校验，明确有效完成单、实付、商家补贴、平台补贴、退款、新老客、活动投放字段的可用范围；数据缺失时给最小补数清单，不得用截图或汇总值替代可获得的原始导出。"
      },
      {
        key: "takeaway_menu_profit",
        title: "菜单货盘与利润",
        subtitle: "菜品结构、价格带、套餐与贡献毛利",
        skillId: "takeaway-growth-advisor",
        promptTemplate: "请聚焦菜单货盘、价格带、套餐结构和利润护栏。优先使用贡献毛利口径：顾客实付加平台补贴，扣食材、包装、商家补贴、佣金、配送服务费和退款损失；口径未确认时并列展示，不得直接建议降价或上活动。"
      },
      {
        key: "takeaway_campaign_roi",
        title: "活动成本 / 投放诊断",
        subtitle: "活动成本汇总与计划级投放ROI分级判断",
        skillId: "takeaway-growth-advisor",
        promptTemplate: "请聚焦外卖活动成本和投放。只有计划级名称、日期、消耗、曝光、点击、进店、下单、成交额齐备时才能审计投放ROI；只有商家活动成本或每日汇总时，标题和结论必须明确写成活动成本汇总，不得冒充广告消耗或计划级ROI。任何新建、改价、加预算、暂停或下架动作必须写成待审批草案。"
      },
      {
        key: "takeaway_competitor_loss",
        title: "流失竞品诊断",
        subtitle: "流失品类、竞对品牌与防守机会",
        skillId: "takeaway-growth-advisor",
        promptTemplate: "请聚焦测算流失品类与流失竞对品牌。区分订单流失、实付GMV流失和品类替代，输出竞品、所属品类、流失规模、可验证原因和防守动作；平台只给聚合估算时必须标记为平台测算，不得写成真实顾客去向。"
      },
      {
        key: "takeaway_problem_validation",
        title: "问题验证",
        subtitle: "用最低成本验证一个原因假设是否成立",
        skillId: "takeaway-growth-advisor",
        promptTemplate: "请聚焦AI经营诊断选出的一个原因假设。只设计问题验证，不提前给增长方案；写清支持证据、反证、唯一验证变量、保持不变项、成立与不成立标准、所需周期、负责人和数据回填。若证据不支持，应回到AI经营诊断选择下一候选。"
      },
      {
        key: "takeaway_experiment",
        title: "增长落地方案",
        subtitle: "真因确认后的增长动作、审批、止损与执行清单",
        skillId: "takeaway-growth-advisor",
        promptTemplate: "请只针对已经验证成立的问题制定7至14天增长落地方案。写清已验证问题和证据、唯一增长动作、保持不变项、基线期、执行目标、核心指标、利润与履约护栏、止损条件、负责人、审批人、逐日执行清单和复盘日。若问题尚未验证，必须退回问题验证，不得把可能原因直接写成增长方案。"
      },
      {
        key: "takeaway_execution",
        title: "真实执行与每日回填",
        subtitle: "按已审批方案落地并记录动作、指标和异常",
        skillId: "takeaway-growth-advisor",
        promptTemplate: "请聚焦已审批增长方案的真实执行。展示待执行方案、今日动作、负责人、完成标准、每日回填指标和异常记录；不得替用户声称已完成，不得擅自改价、投放、上下架或扩大预算。触发止损条件时应停止并提交人工确认。"
      },
      {
        key: "takeaway_effect_evaluation",
        title: "增长效果评估",
        subtitle: "比较同口径基线与执行期，判断是否真的增长",
        skillId: "takeaway-growth-advisor",
        promptTemplate: "请评估真实执行后的增长效果。先验证基线期和执行期是否同门店、同平台、同星期、同口径，并排除退款、动作当日、停业、缺货、节假日和并发活动；再比较有效完成单、实付、客单、贡献毛利、退款、履约、评分和复购，明确增长、无增长、负增长或证据不足，并列出风险与副作用。不得把模拟回填当真实增长。"
      },
      {
        key: "takeaway_review",
        title: "周期复盘与决策",
        subtitle: "有效完成单、利润、履约与下一轮动作",
        skillId: "takeaway-growth-advisor",
        promptTemplate: "请复盘一个完整外卖测试周期。先排除退款和动作当日，比较同口径基线期与测试期的有效完成单、实付、客单、贡献毛利、履约、评分和复购；明确继续、调整或停止，并只生成下一轮待审批动作。"
      }
    ]
  },
  {
    id: "agent_restaurant_growth",
    slug: "restaurant-growth",
    name: "思潼·餐饮增长智能体",
    description: "面向餐饮单店与连锁品牌，诊断外卖订单、堂食到店、多店经营和招商加盟增长，并调度内容、直播、私域与复盘能力落地。",
    icon: "餐",
    status: "active",
    sortOrder: 8,
    defaultSkillId: "restaurant-growth-advisor",
    marketing: {
      shortName: "餐饮增长",
      method: "餐饮四场景增长系统",
      tagline: "从外卖订单、堂食到店、连锁门店到招商加盟，先诊断经营卡点，再生成可执行增长动作。",
      eyebrow: "美团 · 饿了么 · 淘宝闪购外卖诊断",
      headline: "别急着继续投流，先找出外卖订单卡在哪一环",
      promise: "上传现有外卖后台资料，先核对数据口径，再定位曝光、线上进店、商品、下单、履约或复购中的主要断点，最后设计一个7天单变量实验。资料不足时只标记待验证假设，不编造经营结论。",
      audience: "适合有真实外卖门店、能提供14—28天后台资料，并有负责人执行7天动作的餐饮经营者",
      knowledgeAction: {
        enabled: true,
        buttonLabel: "诊断这些餐饮经营资料",
        capabilityId: "restaurant_diagnosis",
        defaultInstruction: "请分析选中的餐饮经营资料，先判断属于外卖订单、堂食到店、连锁门店或招商加盟场景，再区分已确认事实、分析假设和待补信息，输出增长漏斗、主要卡点、本周优先动作、行动计划、复盘指标与风险边界。资料中没有的经营数字、平台结论、优惠政策和招商收益不得补写。",
        allowedDocumentTypes: ["transcript", "note", "web_page"]
      },
      automationAction: {
        enabled: true,
        buttonLabel: "设置餐饮经营自动化",
        defaultTaskType: "daily_business_advice",
        defaultInstruction: "按设定周期读取当前餐饮项目的经营资料，识别经营场景、可确认事实、问题和优势，给出下一步动作与验收指标；缺少门店、周期或数据口径时先提示补充。",
        allowedTaskTypes: ["daily_business_advice", "weekly_topic_push", "file_analysis_followup"],
        capabilityId: "restaurant_diagnosis"
      }
    },
    capabilities: [
      {
        key: "restaurant_diagnosis",
        title: "餐饮经营诊断",
        subtitle: "识别增长场景、漏斗卡点与优先动作",
        skillId: "restaurant-growth-advisor",
        promptTemplate: "请先识别本轮属于外卖订单、堂食到店、连锁门店还是招商加盟场景，再按证据边界完成经营诊断。输出已确认事实、分析假设、待补信息、增长漏斗、主要卡点、本周优先动作和复盘方式。"
      },
      {
        key: "takeaway_growth",
        title: "外卖订单增长",
        subtitle: "美团、饿了么、淘宝闪购的线上订单漏斗",
        skillId: "takeaway-growth-advisor",
        promptTemplate: "请聚焦线上外卖订单增长。主成交平台按用户实际情况识别为美团、饿了么或淘宝闪购；短视频只作为本地曝光、菜品种草和品牌搜索入口，用户成交回到外卖平台，不要默认使用抖音团购或堂食核销。围绕曝光、进店、商品点击、加购、下单、履约和复购输出行动方案。"
      },
      {
        key: "dine_in_growth",
        title: "堂食到店增长",
        subtitle: "本地曝光、咨询预约、到店消费与复购",
        skillId: "restaurant-growth-advisor",
        promptTemplate: "请聚焦餐饮堂食到店增长，围绕本地曝光、门店搜索、咨询或预约、实际到店、消费体验、评价与复购拆解漏斗。不得把线上曝光直接等同于到店，不得虚构核销、客流或翻台数据。"
      },
      {
        key: "chain_store_growth",
        title: "连锁门店增长",
        subtitle: "单店模型、门店分层、总部动作与复制验证",
        skillId: "restaurant-growth-advisor",
        promptTemplate: "请聚焦餐饮连锁门店增长。先区分总部与门店责任，再建立单店模型、门店分层、样板店验证、区域复制和复盘机制；没有各店真实数据时只提供数据模板与试点方法，不生成虚假门店排名。"
      },
      {
        key: "franchise_acquisition",
        title: "餐饮招商加盟",
        subtitle: "加盟定位、线索筛选、考察签约与开店支持",
        skillId: "restaurant-growth-advisor",
        promptTemplate: "请聚焦餐饮招商加盟增长，围绕加盟定位、内容获客、有效线索筛选、首次沟通、到店考察、签约与开店支持拆解漏斗。未提供加盟政策、费用、案例或回报数据时统一标记待补，不得承诺收益或回本周期。"
      },
      {
        key: "content_plan",
        title: "餐饮内容创作",
        subtitle: "围绕增长场景生成可直接拍摄的短视频成品",
        skillId: "baolu_content_creator",
        promptTemplate: "请根据本轮餐饮增长场景、已确认产品和目标用户生成可直接拍摄的完整内容。外卖场景把短视频定位为本地曝光、菜品种草和品牌搜索入口；招商场景面向加盟线索；未确认的菜名、套餐、价格、优惠和经营效果全部标记待补。"
      },
      {
        key: "live_script",
        title: "餐饮直播话术",
        subtitle: "外卖种草、堂食到店或招商直播的完整话术",
        skillId: "live_script_planner",
        promptTemplate: "请按本轮餐饮场景生成完整直播话术。必须明确成交或承接平台，外卖场景引导用户回到实际外卖平台下单；未确认的菜品、套餐、价格、配送范围、优惠和加盟政策不得补写。"
      },
      {
        key: "private_domain",
        title: "餐饮私域承接",
        subtitle: "朋友圈、社群、私聊与线索跟进",
        skillId: "moments_generator",
        promptTemplate: "请围绕本轮餐饮增长目标生成朋友圈、社群或私聊承接内容。堂食面向到店与复购，招商面向加盟线索筛选；不得虚构顾客评价、经营案例、优惠政策或稀缺名额。"
      },
      {
        key: "video_review",
        title: "餐饮内容复盘",
        subtitle: "依据真实作品数据复盘曝光与有效经营信号",
        skillId: "baolu_review_engine",
        promptTemplate: "请依据用户提供的真实作品数据或明确观察复盘餐饮内容。区分内容平台指标与外卖订单、堂食到店或加盟线索等经营结果；没有跨平台归因数据时不得声称内容直接带来订单或到店。"
      }
    ]
  },
  {
    id: "agent_acquisition",
    slug: "acquisition",
    name: "思潼·品牌招商智能体",
    description: "服务连锁品牌老客户，只围绕招商加盟内容、加盟商线索、考察与签约承接开展工作。",
    icon: "🎯",
    status: "active",
    sortOrder: 10,
    defaultSkillId: "baolu_content_creator",
    marketing: {
      shortName: "品牌招商",
      method: "品牌招商增长系统",
      tagline: "只为连锁品牌生成招商加盟内容、线索承接、考察与签约增长方案。",
      eyebrow: "品牌招商增长系统",
      headline: "思潼·品牌招商智能体",
      promise: "围绕招商加盟生成选题、内容、直播与投流预览，不生成门店到店、团购或消费者促销方案。",
      audience: "连锁品牌总部、招商团队与加盟业务负责人",
      knowledgeAction: {
        enabled: true,
        buttonLabel: "从这些资料提炼招商选题",
        capabilityId: "topic_inspiration",
        defaultInstruction: "请只扫描与品牌招商加盟有关的资料，结合招商行业热点、对标招商账号、录音资料和视频复盘，交付10条可测试招商选题。不得生成门店到店、团购券、消费者优惠或核销内容；缺失来源标记待补或待核验。",
        allowedDocumentTypes: ["transcript", "note", "web_page"]
      },
      automationAction: {
        enabled: true,
        buttonLabel: "设置招商内容自动化",
        defaultTaskType: "weekly_topic_push",
        defaultInstruction: "每周仅基于当前品牌已确认的招商资料，提炼有事实依据的招商加盟选题；先确认目标加盟商和招商目标，不把门店消费者业务混入招商任务。",
        allowedTaskTypes: ["weekly_topic_push", "moments_push", "file_analysis_followup", "audio_card_analysis", "video_publish_plan"],
        capabilityId: "topic_inspiration"
      },
      workMap: {
        id: "acquisition-growth-map",
        version: 2,
        title: "品牌招商工作地图",
        subtitle: "先填写本轮招商 Brief，再用招商行业热点、对标账号、录音卡与视频复盘增强选题，复盘结果持续回流下一轮执行。",
        nodes: [
          {
            id: "enterprise_knowledge",
            title: "品牌招商资料库",
            subtitle: "可选的品牌、加盟模型、招商案例与录音证据",
            icon: "知",
            kind: "knowledge",
            position: { x: 12, y: 48 },
            action: { type: "knowledge" }
          },
          {
            id: "topic_system",
            title: "招商选题系统",
            subtitle: "先填招商 Brief，再用四类来源生成加盟选题",
            icon: "题",
            kind: "system",
            position: { x: 36, y: 27 },
            action: { type: "capability", capabilityId: "topic_inspiration" }
          },
          {
            id: "content_system",
            title: "招商内容系统",
            subtitle: "生成招商短视频、图文与拍摄交付",
            icon: "文",
            kind: "system",
            position: { x: 52, y: 27 },
            action: { type: "capability", capabilityId: "content_plan" }
          },
          {
            id: "traffic_system",
            title: "招商投流系统",
            subtitle: "诊断招商素材、线索目标、预算、监控与止损",
            icon: "投",
            kind: "system",
            position: { x: 68, y: 27 },
            action: { type: "capability", capabilityId: "paid_traffic" }
          },
          {
            id: "video_review_system",
            title: "招商内容复盘",
            subtitle: "读取真实数据并沉淀下一轮招商规律",
            icon: "盘",
            kind: "review",
            position: { x: 84, y: 27 },
            action: { type: "capability", capabilityId: "video_review" }
          },
          {
            id: "live_system",
            title: "招商直播系统",
            subtitle: "招商开场、答疑、留资、考察与跟进",
            icon: "播",
            kind: "system",
            position: { x: 45, y: 72 },
            action: { type: "capability", capabilityId: "live_script" }
          },
          {
            id: "live_review_system",
            title: "招商直播复盘",
            subtitle: "复盘流量、加盟咨询、留资和话术执行",
            icon: "复",
            kind: "review",
            position: { x: 68, y: 72 },
            action: { type: "capability", capabilityId: "live_review" }
          }
        ],
        edges: [
          { id: "knowledge-topic", from: "enterprise_knowledge", to: "topic_system", type: "flow", label: "可选证据" },
          { id: "topic-content", from: "topic_system", to: "content_system", type: "flow" },
          { id: "content-traffic", from: "content_system", to: "traffic_system", type: "flow" },
          { id: "traffic-video-review", from: "traffic_system", to: "video_review_system", type: "flow" },
          {
            id: "video-review-topic-feedback",
            from: "video_review_system",
            to: "topic_system",
            type: "feedback",
            label: "复盘回流",
            waypoints: [{ x: 84, y: 8 }, { x: 36, y: 8 }]
          },
          {
            id: "topic-live-branch",
            from: "topic_system",
            to: "live_system",
            type: "branch",
            label: "直播分支",
            waypoints: [{ x: 36, y: 72 }]
          },
          { id: "live-live-review", from: "live_system", to: "live_review_system", type: "flow" },
          {
            id: "live-review-feedback",
            from: "live_review_system",
            to: "live_system",
            type: "feedback",
            label: "复盘回流",
            waypoints: [{ x: 68, y: 91 }, { x: 45, y: 91 }]
          }
        ]
      }
    },
    capabilities: [
      {
        key: "topic_inspiration",
        title: "招商选题",
        subtitle: "四类来源、三关筛选，生成10个可拍招商选题",
        skillId: "baolu_topics",
        promptTemplate: "这是品牌招商选题系统的固定任务。只围绕品牌招商加盟，扫描招商录音资料、招商行业热点、招商账号复盘与对标内容，先形成16至20条内部候选，再按目标加盟商兴趣、加盟商匹配度与账号阶段筛选，最终输出10条可测试招商选题。不得生成门店到店、团购券、消费者优惠、核销或门店促销内容；来源缺失时标记待补或待核验，不得虚构API、案例或数据。只输出选题表和待验证动作，不展开完整文案。"
      },
      {
        key: "content_plan",
        title: "招商内容创作",
        subtitle: "招商口播逐字稿、拍摄脚本与发布方案",
        skillId: "baolu_content_creator",
        promptTemplate: "只创作品牌招商加盟内容：面向目标加盟商的短视频、图文、招商直播与私域承接。需要完整方案时再输出拍摄、剪辑、发布与招商线索承接方案。不得生成门店到店、团购券、消费者优惠、核销、菜品促销或门店复购内容。"
      },
      {
        key: "paid_traffic",
        title: "招商投流",
        subtitle: "加盟线索诊断、计划预览与安全变更单",
        skillId: "optimize_local_push_ads",
        promptTemplate: "这是品牌招商投流系统的固定任务。只处理招商加盟线索获客：核对目标加盟商、地域、招商素材、咨询承接、回传、预算与有效加盟线索。输出证据、动作、验证指标、观察条件、止损、回退方案和 PREVIEW_ONLY 变更单。不得生成门店到店、团购券、消费者优惠或核销投放；不得声称已操作真实广告账户。"
      },
      {
        key: "dou_plus_traffic",
        title: "DOU+ 投放",
        subtitle: "内容加热诊断、素材测试与安全投放预览",
        skillId: "dou_plus_ads",
        promptTemplate: "这是抖音 DOU+ 的固定单技能任务。只处理内容加热：先核验视频/账号、当前页面可用目标、自然数据、承接、预算上限、历史结果和审核状态。输出 DOU+投放结论、官方资料状态、单变量素材测试、监控、止损、回退和 PREVIEW_ONLY 变更单。课程视频或规则无法实时取得时写待研读/待核验；不得声称已登录、支付、创建、启动、暂停或提交真实 DOU+ 投放。"
      },
      {
        key: "shooting_editing",
        title: "拍剪优化",
        subtitle: "镜头结构、剪辑时间线与发布检查",
        skillId: "baolu_content_creator",
        promptTemplate: "请只聚焦品牌招商内容的拍摄和剪辑优化，给出分镜、招商表达注意事项、剪辑时间线（EDL）、字幕节奏、封面标题和发布前检查清单；不得写门店团购或到店促销。"
      },
      {
        key: "video_review",
        title: "视频数据复盘",
        subtitle: "快速诊断或深度复盘，沉淀规律与下轮选题",
        skillId: "baolu_review_engine",
        promptTemplate: "这是复盘系统的固定单技能任务。先判断是快速诊断还是深度复盘：快速诊断必须基于用户提供的真实可见指标或明确观察，输出3至5个证据受控要点；深度复盘必须完整读取CSV、Excel或表格数据，输出数据质量审计、总览、作品分层、内容结构健康度、单条深拆、完播、互动、趋势预警、规律、方法论和下周期选题。只依据本轮证据，不假装读取链接、视频画面或后台，不编造平台原因和业务转化。"
      },
      {
        key: "live_script",
        title: "招商直播话术",
        subtitle: "招商开场、加盟答疑、留资和考察跟进",
        skillId: "live_script_planner",
        promptTemplate: "请只根据品牌招商目标，生成招商直播的开场、加盟答疑、留资、考察邀约和下播跟进话术；不得生成面向消费者的团购售卖或到店促销话术。"
      },
      {
        key: "live_review",
        title: "直播数据复盘",
        subtitle: "复盘场观、停留、互动、转化和话术节奏",
        skillId: "baolu_live_review_engine",
        promptTemplate: "请读取我提供的直播后台数据、带时间戳的录音转写和原定话术计划，按固定八模块完成直播复盘：核心数据速览、流量诊断、转化归因、互动诊断、话术执行对照表、人货场诊断、方法论沉淀、下次直播调整清单。缺哪类证据只降级对应模块，所有经营数字、案例、优惠和承诺必须有本轮证据。"
      },
      {
        key: "industry_hotspots",
        title: "行业热点",
        subtitle: "检索近期公开热点，再生成可拍选题",
        skillId: "ai_daily_brief",
        promptTemplate: "必须先检索并核验与我行业相关的近期公开热点，标注标题、来源、链接和日期；再筛选与我业务定位、目标客户和获客目标匹配的内容角度，生成今天可以拍摄的选题。不得跳过热点检索直接输出泛化选题。"
      },
      {
        key: "franchise_acquisition",
        title: "招商获客",
        subtitle: "招商短视频、加盟线索与考察承接",
        skillId: "baolu_content_creator",
        promptTemplate: "请识别为招商获客内容创作，按SCALE招商获客逻辑输出可直接拍摄的短视频文案、镜头、评论区留资承接和投流建议。不要套用面向终端消费者的团购到店逻辑。"
      },
      {
        key: "private_domain",
        title: "招商私域承接",
        subtitle: "建立信任、承接加盟咨询和考察",
        skillId: "moments_generator",
        promptTemplate: "请根据品牌招商产品和目标加盟商，生成建立信任、承接加盟咨询并引导考察的朋友圈内容；不得生成面向消费者的团购、到店或优惠促销内容。"
      }
    ]
  },
  {
    id: "agent_store_acquisition",
    slug: "store-acquisition",
    name: "思潼·门店获客智能体",
    description: "服务单店和区域门店，通过本地内容、团购套餐、到店承接与复购，获取真实消费者。",
    icon: "店",
    status: "active",
    sortOrder: 11,
    defaultSkillId: "baolu_content_creator",
    marketing: {
      shortName: "门店获客",
      method: "门店本地获客系统",
      tagline: "围绕本地消费者，生成团购、到店、内容和复购增长方案。",
      eyebrow: "门店本地获客系统",
      headline: "思潼·门店获客智能体",
      promise: "只服务门店本地消费者获客、到店与复购；不生成招商加盟线索方案。",
      audience: "单店老板、区域门店运营与本地生活团队",
      knowledgeAction: {
        enabled: true,
        buttonLabel: "从这些资料提炼门店选题",
        capabilityId: "topic_inspiration",
        defaultInstruction: "请基于已确认的门店资料、商圈、产品、消费者反馈和内容数据，生成可测试的本地获客选题。未确认的套餐、价格、优惠和活动均标记待补；不得生成招商加盟内容。",
        allowedDocumentTypes: ["transcript", "note", "web_page"]
      },
      automationAction: {
        enabled: true,
        buttonLabel: "设置门店内容自动化",
        defaultTaskType: "weekly_topic_push",
        defaultInstruction: "每周仅基于当前门店已确认资料生成本地消费者选题，优先围绕商圈、产品、团购、到店和复购；不得混入品牌招商任务。",
        allowedTaskTypes: ["weekly_topic_push", "moments_push", "file_analysis_followup", "audio_card_analysis", "video_publish_plan"],
        capabilityId: "topic_inspiration"
      },
      workMap: {
        id: "store-acquisition-map",
        version: 1,
        title: "门店获客工作地图",
        subtitle: "从门店资料和商圈事实出发，生成本地内容、团购到店承接与复盘动作；不进入招商加盟流程。",
        nodes: [
          { id: "store_knowledge", title: "门店经营资料", subtitle: "门店、商圈、产品、顾客反馈与内容数据", icon: "知", kind: "knowledge", position: { x: 12, y: 48 }, action: { type: "knowledge" } },
          { id: "topic_system", title: "门店选题系统", subtitle: "商圈、热点、对标、录音与视频复盘选题", icon: "题", kind: "system", position: { x: 36, y: 27 }, action: { type: "capability", capabilityId: "topic_inspiration" } },
          { id: "content_system", title: "到店内容系统", subtitle: "生成门店短视频、图文与团购承接内容", icon: "文", kind: "system", position: { x: 52, y: 27 }, action: { type: "capability", capabilityId: "content_plan" } },
          { id: "traffic_system", title: "门店投流系统", subtitle: "本地推、团购素材与到店线索预览", icon: "投", kind: "system", position: { x: 68, y: 27 }, action: { type: "capability", capabilityId: "paid_traffic" } },
          { id: "video_review_system", title: "门店内容复盘", subtitle: "复盘内容数据、到店与团购承接信号", icon: "盘", kind: "review", position: { x: 84, y: 27 }, action: { type: "capability", capabilityId: "video_review" } },
          { id: "live_system", title: "门店直播系统", subtitle: "产品展示、团购承接与到店转化", icon: "播", kind: "system", position: { x: 45, y: 72 }, action: { type: "capability", capabilityId: "live_script" } },
          { id: "live_review_system", title: "门店直播复盘", subtitle: "复盘互动、团购咨询、到店与复购", icon: "复", kind: "review", position: { x: 68, y: 72 }, action: { type: "capability", capabilityId: "live_review" } }
        ],
        edges: [
          { id: "knowledge-topic", from: "store_knowledge", to: "topic_system", type: "flow", label: "门店事实" },
          { id: "topic-content", from: "topic_system", to: "content_system", type: "flow" },
          { id: "content-traffic", from: "content_system", to: "traffic_system", type: "flow" },
          { id: "traffic-review", from: "traffic_system", to: "video_review_system", type: "flow" },
          { id: "review-topic-feedback", from: "video_review_system", to: "topic_system", type: "feedback", label: "复盘回流", waypoints: [{ x: 84, y: 8 }, { x: 36, y: 8 }] },
          { id: "topic-live", from: "topic_system", to: "live_system", type: "branch", label: "直播分支", waypoints: [{ x: 36, y: 72 }] },
          { id: "live-review", from: "live_system", to: "live_review_system", type: "flow" },
          { id: "live-review-feedback", from: "live_review_system", to: "live_system", type: "feedback", label: "复盘回流", waypoints: [{ x: 68, y: 91 }, { x: 45, y: 91 }] }
        ]
      }
    },
    capabilities: [
      { key: "topic_inspiration", title: "门店选题", subtitle: "从商圈、产品、对标和复盘生成可拍选题", skillId: "baolu_topics", promptTemplate: "只围绕门店本地消费者获客，生成可验证的商圈、产品、团购、到店和复购选题。不得生成招商加盟内容；未确认的价格、套餐和优惠必须标记待补。" },
      { key: "content_plan", title: "门店内容创作", subtitle: "短视频、图文、团购与到店承接内容", skillId: "baolu_content_creator", promptTemplate: "只创作门店本地消费者内容：短视频、图文、团购与到店承接。套餐、价格、优惠、库存和经营效果只能使用用户确认事实；不得生成招商加盟内容。" },
      { key: "paid_traffic", title: "门店投流", subtitle: "本地推诊断、团购素材测试与预览", skillId: "optimize_local_push_ads", promptTemplate: "只处理门店本地消费者获客的投流诊断和 PREVIEW_ONLY 计划，核对商圈、门店、团购承接、预算与真实数据；不得生成招商加盟投流方案，也不得操作真实广告账户。" },
      { key: "dou_plus_traffic", title: "门店 DOU+", subtitle: "本地内容加热、素材测试与安全预览", skillId: "dou_plus_ads", promptTemplate: "只为门店本地消费者内容给出 DOU+ 测试和 PREVIEW_ONLY 预览，未确认产品、价格、优惠或账户状态时标记待补；不得生成招商加盟投放。" },
      { key: "shooting_editing", title: "门店拍剪", subtitle: "镜头、剪辑与发布检查", skillId: "baolu_content_creator", promptTemplate: "只优化门店本地获客视频的分镜、拍摄、剪辑和发布检查；不得混入招商加盟表达。" },
      { key: "video_review", title: "门店内容复盘", subtitle: "复盘真实内容数据和到店承接信号", skillId: "baolu_review_engine", promptTemplate: "只依据本轮真实内容和经营证据复盘门店内容、团购与到店承接，数据不足时明确待补；不得把播放量直接写成到店或成交。" },
      { key: "live_script", title: "门店直播话术", subtitle: "产品展示、团购承接与到店转化", skillId: "live_script_planner", promptTemplate: "只生成门店面向消费者的直播话术，包括产品展示、团购承接、到店和售后提示；不得生成招商加盟话术。" },
      { key: "live_review", title: "门店直播复盘", subtitle: "复盘互动、到店、团购与复购", skillId: "baolu_live_review_engine", promptTemplate: "只依据真实直播数据复盘门店直播互动、团购承接、到店和复购信号；不得虚构订单或招商线索。" },
      { key: "industry_hotspots", title: "本地生活热点", subtitle: "检索公开热点并生成门店可拍选题", skillId: "ai_daily_brief", promptTemplate: "先检索并核验本地生活和门店所属行业的公开热点，再生成门店消费者选题；不得把未验证热点写成事实或生成招商加盟内容。" },
      { key: "private_domain", title: "门店私域承接", subtitle: "朋友圈、社群、复购与到店沟通", skillId: "moments_generator", promptTemplate: "只生成面向门店消费者的私域内容，用于到店、团购咨询与复购；不得生成招商加盟招募内容，未确认优惠不得补写。" }
    ]
  },
  {
    id: "agent_sales",
    slug: "sales",
    name: "销售智能体",
    description: "帮老板和销售人员做客户诊断、异议回复、跟单计划和转化复盘。",
    icon: "🤝",
    status: "active",
    sortOrder: 20,
    defaultSkillId: "sales_growth_advisor",
    marketing: {
      shortName: "销售增长",
      method: "销售增长工作空间",
      tagline: "发来客户对话或销售数据，完成客户诊断、异议回复、跟单计划、成交推进和漏斗复盘。",
      eyebrow: "每一个客户都有清晰的下一步",
      headline: "把客户判断、异议处理和跟单节奏变成可复用的销售系统",
      promise: "发来客户情况或聊天记录，先完成一次真实客户诊断。",
      audience: "企业老板、销售负责人、招商和高客单销售团队",
      knowledgeAction: {
        enabled: true,
        buttonLabel: "复盘这些资料中的对话",
        capabilityId: "customer_diagnosis",
        defaultInstruction: "请复盘选中知识资料中的真实客户沟通或团队讨论。明确指出当时哪些销售动作做得好，哪些地方没有聊到位、做错、漏做或时机不对，为什么会影响合作与成交；按“当时做法—存在问题—影响成交的原因—下次具体说法—当前补救动作”输出。团队讨论用于诊断销售准备、分工、报价口径和跟进机制，不要把团队成员当作销售对象。证据不足时必须标注待核实，不得虚构原话。",
        allowedDocumentTypes: ["transcript", "note", "web_page"]
      },
      automationAction: {
        enabled: true,
        buttonLabel: "设置销售自动化",
        defaultTaskType: "inactive_user_wakeup",
        defaultInstruction: "按设定周期复盘已授权的客户沟通与团队讨论，识别遗漏动作、异议、决策链和跟进节点，输出下一步跟进提醒与建议话术；证据不足时标记待核实。",
        allowedTaskTypes: ["inactive_user_wakeup", "file_analysis_followup", "audio_card_analysis"],
        capabilityId: "customer_diagnosis"
      }
    },
    capabilities: [
      ["customer_diagnosis", "客户诊断", "看清客户真实需求和决策卡点", "请根据我提供的客户背景或聊天记录，区分已确认、待确认和矛盾信息，并判断客户真实需求和决策卡点。"],
      ["intent_temperature", "意向与水温", "判断值不值得跟与优先级", "请判断这位客户的水温、意向、决策复杂度和跟进优先级，并标明判断依据与待确认信息。"],
      ["objection_reply", "异议回复", "处理太贵、考虑和担心没效果", "请判断客户异议背后的真实担心，给出可直接发送的回复话术，不虚假承诺，不制造假稀缺。"],
      ["follow_up_plan", "跟单计划", "明确下一步、负责人和时间", "请根据客户当前阶段，制定下一步跟单动作、沟通目标、时间和风险提醒。"],
      ["closing_script", "成交话术", "重构价值并推进合理的下一步", "请在不承诺确定结果、不施压的前提下，帮我设计价值呈现、顾虑消除和下一步成交话术。"],
      ["funnel_review", "销售漏斗复盘", "找出转化损失最大的环节", "请根据我提供的线索、建联、意向、方案和成交数据，计算转化漏斗，找出最大卡点并给出下周改进动作。"]
    ].map(([key, title, subtitle, promptTemplate]) => ({
      key,
      title,
      subtitle,
      promptTemplate,
      skillId: "sales_growth_advisor"
    }))
  },
  {
    id: "agent_clipper",
    slug: "clipper",
    name: "思潼·自由组片智能体",
    description: "把整场直播或商品素材拆成可预览、可替换、可排序的细片段，生成可交给剪映精修的干净初剪。",
    icon: "🎬",
    status: "active",
    sortOrder: 30,
    defaultSkillId: "baolu_content_creator",
    marketing: {
      shortName: "自由组片",
      method: "AI 切片剪辑系统",
      tagline: "AI先找素材、拆片段、排结构，剪辑手再自由组片并完成最后判断。",
      eyebrow: "给切片剪辑手的 AI 初剪工作台",
      headline: "把几小时素材，变成可以自由组合的成片轨道",
      promise: "上传整场直播或已经切好的商品素材，AI先完成语义拆分、候选分类和首版排列，再由剪辑手预览、替换和微调。",
      audience: "切片剪辑手、短视频团队、直播带货公司和达人内容团队",
      automationAction: {
        enabled: true,
        buttonLabel: "设置剪辑自动化",
        defaultTaskType: "video_publish_plan",
        defaultInstruction: "在用户授权的素材与发布计划范围内，按设定周期整理待剪素材、生成初剪与发布计划草案；正式发布、删除视频或修改投放前必须由用户确认。",
        allowedTaskTypes: ["video_publish_plan", "file_analysis_followup"],
        capabilityId: "commerce_clipping"
      }
    },
    capabilities: [
      {
        key: "commerce_clipping",
        title: "带货视频",
        subtitle: "按商品、证据、规格、价格、场景和行动拆片并自由组片",
        skillId: "baolu_content_creator",
        promptTemplate: "进入带货视频自由组片工作台，上传整场直播或商品素材后，按商品和成交信息拆分、预览、替换、排序并生成干净初剪。"
      },
      {
        key: "persona_clipping",
        title: "人设 / 观点视频",
        subtitle: "识别多个话题与完整观点，分别组合成多条短视频",
        skillId: "baolu_content_creator",
        promptTemplate: "进入人设与观点视频工作台，识别素材中的独立话题、观点和情绪高光，生成可继续精修的多条短视频。"
      }
    ]
  }
];

export const AGENT_BY_ID = new Map(AGENT_DEFINITIONS.map((agent) => [agent.id, agent]));
export const AGENT_BY_SLUG = new Map(AGENT_DEFINITIONS.map((agent) => [agent.slug, agent]));

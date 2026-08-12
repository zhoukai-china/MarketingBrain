import type { Consultant, QuickPrompt, MemoryState } from "../types";

export const consultants: Consultant[] = [
  { id: "general_qa", name: "思潼", title: "企业AI增长飞轮", description: "先判断经营卡点，再安排下一步动作", spriteX: 0, spriteY: 0, spriteW: 64, spriteH: 64 },
  { id: "customer_acquisition_diagnosis", name: "获客成交体检", title: "增长链路诊断", description: "先找获客、承接、成交卡点，再拆行动清单", spriteX: 0, spriteY: 0, spriteW: 64, spriteH: 64 },
  { id: "ip_positioning", name: "IP定位", title: "思潼工作重点", description: "创始人IP五步定位法", spriteX: 64, spriteY: 0, spriteW: 64, spriteH: 64 },
  { id: "baolu_content_creator", name: "内容计划", title: "思潼工作重点", description: "四大脚本模型+爆款内容生产", spriteX: 128, spriteY: 0, spriteW: 64, spriteH: 64 },
  { id: "sales_growth_advisor", name: "成交话术", title: "思潼工作重点", description: "客户沟通与成交话术全链路", spriteX: 192, spriteY: 0, spriteW: 64, spriteH: 64 },
  { id: "delivery_standardization", name: "交付标准化", title: "思潼工作重点", description: "SOP+加盟商交付升级", spriteX: 256, spriteY: 0, spriteW: 64, spriteH: 64 },
  { id: "baolu_review_engine", name: "数据复盘", title: "思潼工作重点", description: "数据分析+转化归因+选题建议", spriteX: 320, spriteY: 0, spriteW: 64, spriteH: 64 },
  { id: "live_script_planner", name: "直播话术", title: "思潼工作重点", description: "带货+招商双引擎直播策划", spriteX: 384, spriteY: 0, spriteW: 64, spriteH: 64 },
  { id: "moments_generator", name: "朋友圈私域", title: "思潼工作重点", description: "七柱内容体系+朋友圈经营", spriteX: 448, spriteY: 0, spriteW: 64, spriteH: 64 },
  { id: "ai_daily_brief", name: "晨报·AI日报", title: "行业趋势分析", description: "AI新闻+经营视角翻译", spriteX: 512, spriteY: 0, spriteW: 64, spriteH: 64 },
  { id: "hr_director_consultant", name: "团队管理", title: "思潼工作重点", description: "招聘+培训+绩效考核", spriteX: 576, spriteY: 0, spriteW: 64, spriteH: 64 },
  { id: "baolu_finance_advisor", name: "财务优化", title: "思潼工作重点", description: "成本控制+利润优化", spriteX: 640, spriteY: 0, spriteW: 64, spriteH: 64 },
  { id: "baolu_shangxueyuan", name: "商学院交付", title: "加盟商培训", description: "扶商系统+加盟商教育", spriteX: 0, spriteY: 64, spriteW: 64, spriteH: 64 },
  { id: "baolu_ad_manager", name: "投流指导", title: "思潼工作重点", description: "本地推+抖加策略优化", spriteX: 64, spriteY: 64, spriteW: 64, spriteH: 64 },
  { id: "brand_consultant", name: "品牌战略", title: "思潼工作重点", description: "连锁品牌四层架构", spriteX: 128, spriteY: 64, spriteW: 64, spriteH: 64 },
  { id: "management_consultant", name: "经营管理", title: "思潼工作重点", description: "组织架构+流程标准化", spriteX: 192, spriteY: 64, spriteW: 64, spriteH: 64 },
  { id: "menu_optimizer", name: "菜单优化", title: "思潼工作重点", description: "餐饮菜单工程+定价策略", spriteX: 256, spriteY: 64, spriteW: 64, spriteH: 64 },
  { id: "promotion_planner", name: "营销策划", title: "思潼工作重点", description: "全年营销活动策划", spriteX: 320, spriteY: 64, spriteW: 64, spriteH: 64 },
  { id: "franchise_recruitment_system", name: "加盟招商", title: "思潼工作重点", description: "连锁加盟全流程招商", spriteX: 384, spriteY: 64, spriteW: 64, spriteH: 64 },
  { id: "store_data_analyst", name: "门店数据", title: "思潼工作重点", description: "多维度门店经营分析", spriteX: 448, spriteY: 64, spriteW: 64, spriteH: 64 },
  { id: "franchise_compliance_checker", name: "加盟合规", title: "思潼工作重点", description: "加盟合规+法律风险筛查", spriteX: 512, spriteY: 64, spriteW: 64, spriteH: 64 },
  { id: "opc_delivery_system", name: "OPC交付", title: "思潼工作重点", description: "OPC项目全流程交付", spriteX: 576, spriteY: 64, spriteW: 64, spriteH: 64 },
  { id: "opc_client_education", name: "OPC客户教育", title: "思潼工作重点", description: "客户培训+认知升级", spriteX: 640, spriteY: 64, spriteW: 64, spriteH: 64 },
  { id: "opc_pricing_model", name: "OPC定价", title: "思潼工作重点", description: "OPC项目定价策略", spriteX: 0, spriteY: 128, spriteW: 64, spriteH: 64 },
  { id: "multi_store_dashboard", name: "多店看板", title: "思潼工作重点", description: "多门店数据总览", spriteX: 64, spriteY: 128, spriteW: 64, spriteH: 64 },
  { id: "yuanshen_factory", name: "老板思维模型", title: "经营资产沉淀", description: "沉淀老板判断方式", spriteX: 128, spriteY: 128, spriteW: 64, spriteH: 64 },
  { id: "digital_twin_factory", name: "企业AI分身定制", title: "高级交付项目", description: "沉淀话术、SOP和交付方法", spriteX: 192, spriteY: 128, spriteW: 64, spriteH: 64 },
];

export function consultantByRole(role: string): Consultant | undefined {
  return consultants.find((c) => c.id === role);
}

export const quickPrompts: QuickPrompt[] = [
  {
    title: "先做获客体检",
    subtitle: "找出获客到成交卡点",
    buildPrompt: (memory: MemoryState) => `我是${memory.tenantName || "一家本地商家"}，做${memory.industry || "服务业"}，在${memory.city || "本地"}。请先帮我做获客成交链路体检：现在获客方式是${memory.acquisition || "还不稳定"}，成交情况是${memory.sales || "咨询不少但成交不稳"}，请判断当前最该先改哪一环。`
  },
  {
    title: "今天发什么？",
    subtitle: "基于你的行业和定位生成选题",
    buildPrompt: (memory: MemoryState) => `我的定位是${memory.positioning || memory.industry || "本地商家"}，目标客户是${memory.customer || "到店顾客"}，主推${memory.offer || "店内产品/服务"}。今天适合发什么内容的短视频/朋友圈？请给3个选题，每个带标题+角度+开头第一句话。`
  },
  {
    title: "怎么写文案？",
    subtitle: "口播文案/朋友圈/短视频脚本",
    buildPrompt: (memory: MemoryState) => `我是${memory.tenantName || "本地商家"}，做${memory.industry || "服务业"}，在${memory.city || "本地"}。请用「${memory.tone || "说人话，像朋友聊天"}」的风格，写一条关于${memory.offer || "我们店的产品"}的口播文案，约200字。`
  },
  {
    title: "有话术吗？",
    subtitle: "应对客户常见问题的回复",
    buildPrompt: (memory: MemoryState) => `我的店是${memory.tenantName || "本地商家"}，做${memory.industry || "服务业"}，主推${memory.offer || "店内产品/服务"}。遇到客户说"太贵了"/"再考虑考虑"/"别家更便宜"/"到底有没有效果"这四种情况，给每句一个高转化回复。格式：客户说 → 销售回。`
  },
  {
    title: "怎么复盘？",
    subtitle: "短视频/直播数据分析",
    buildPrompt: (memory: MemoryState) => `我是${memory.tenantName || "本地商家"}，做${memory.industry || "服务业"}。请告诉我复盘一条短视频需要看哪5个核心数据，每个数据代表什么，及格线是多少，低于及格线怎么改善。`
  },
  {
    title: "跟我直播怎么说？",
    subtitle: "直播话术+互动脚本",
    buildPrompt: (memory: MemoryState) => `我是${memory.tenantName || "本地商家"}，在${memory.city || "本地"}做${memory.industry || "服务业"}，主推${memory.offer || "店内产品/服务"}，目标客户是${memory.customer || "到店顾客"}。请给我一套直播开场5分钟的话术：开头怎么留人→怎么介绍福利→怎么引导互动→怎么引流到店。`
  }
];

export const diagnosisQuestions = [
  { key: "tenantName" as keyof MemoryState, prompt: "你的店叫什么名字？或者品牌叫什么？", placeholder: "例：李中正手机配件 / XX品牌连锁 / 个人IP账号名" },
  { key: "industry" as keyof MemoryState, prompt: "你做什么行业？说具体一点。", placeholder: "例：手机后市场/新茶饮/美容美发/餐饮/教培" },
  { key: "city" as keyof MemoryState, prompt: "你的店在哪里？一个城市还是多个城市？", placeholder: "例：杭州单店 / 全国加盟" },
  { key: "positioning" as keyof MemoryState, prompt: "你给自己的店或者品牌的定位是什么？一句话说。", placeholder: "例：杭州最卷的一家手机配件店 / 专注下沉市场的新茶饮" },
  { key: "customer" as keyof MemoryState, prompt: "你的目标客户是谁？说具体一点。", placeholder: "例：25-35岁女性白领 / 想做小生意的普通人 / 手机店老板" },
  { key: "offer" as keyof MemoryState, prompt: "你主推的产品或服务是什么？", placeholder: "例：手机膜+手机壳 / 加盟套餐68,000元 / 980元基础课" },
  { key: "tone" as keyof MemoryState, prompt: "你觉得自己的表达风格应该是什么样？", placeholder: "例：说人话，像朋友聊天 / 专业，数据说话 / 真实接地气，说实话" },
  { key: "acquisition" as keyof MemoryState, prompt: "现在你怎么获客？效果怎么样？简单说。", placeholder: "例：靠抖音发视频，每天来10-20个咨询 / 主要是老客转介绍 / 还没开始获客" },
  { key: "sales" as keyof MemoryState, prompt: "现在成交怎么样？遇到什么瓶颈？简单说。", placeholder: "例：咨询的人多但成交少 / 转化还行但客单价做不上去 / 线上不成交，主要靠线下到店" },
  { key: "delivery" as keyof MemoryState, prompt: "你的产品或服务交付有没有问题？简单说。", placeholder: "例：加盟商落地速度太慢 / 复购率还可以 / 服务时间太长忙不过来" },
  { key: "management" as keyof MemoryState, prompt: "你现在团队多大？管理上有什么痛点吗？简单说。", placeholder: "例：小型团队 / 店长不好招 / 加盟商难管 / 跨部门沟通别扭" },
  { key: "diagnosisSummary" as keyof MemoryState, prompt: "总结一下：你认为当前最需要AI帮你解决的一个经营问题是什么？", placeholder: "例：获客不够 / 转化率低 / 内容没人看 / 加盟商管不好 / 成本太高 / 团队没人带" }
];

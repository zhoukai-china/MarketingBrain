/**
 * AI 资讯页（/agents/ai-news）内容种子数据。
 *
 * 来源：docs/prototypes/ai-news-demo-20261006.html（案例均基于公开报道整理，
 * 「思潼解读」为编辑观点）。正式版由每日 08:00 抓取流水线写入；在本页接入
 * 大模型前，这里同时充当 LLM 不可用时的兜底内容（编辑审校稿优先展示）。
 *
 * ctaHref 一律指向站内真实路由（商城首页 / 兰琪门店经营大脑静态页），
 * 不再指向原型 HTML。
 */

export type AiNewsType = "case" | "ind";

export interface AiNewsItem {
  /** 稳定 slug，用作接口定位与前端 key */
  id: string;
  type: AiNewsType;
  cat: string;
  color: string;
  src: string;
  time: string;
  title: string;
  summary: string;
  tags: string[];
  tagColor?: "" | "blue" | "green" | "purple";
  /** 编辑审校的默认「思潼解读」，同时是 LLM 失败时的兜底文案 */
  insight: string;
  cta: string;
  ctaHref: string;
  hot?: boolean;
}

export interface AiNewsHero {
  title: string;
  summary: string;
  meaning: string;
}

export const AI_NEWS: AiNewsItem[] = [
  {
    id: "jd-caixiaodong-digital-human",
    type: "case", cat: "零售电商", color: "#FF7A45", src: "36氪等综合", time: "昨天",
    title: "刘强东 AI 数字人「采销东哥」直播首秀：观看超 2000 万人次，带货超 5000 万",
    summary: "京东创始人数字人下场带货，言犀数字人复刻其形象与声线，全程无人值守；此后京东采销直播间把数字人常态化用于凌晨等时段补位，主播休息、直播间不下播。",
    tags: ["观看 2000万+", "带货 5000万+", "24h 不下播"], tagColor: "",
    insight: "老板的 IP 是企业最贵资产——但老板的时间只有一份。数字分身让「老板 IP」变成 24 小时在线的可复制资产：一份形象，十个直播间同时开工。",
    cta: "用数字分身做同款", ctaHref: "/agents", hot: true
  },
  {
    id: "luckin-digital-midplatform",
    type: "case", cat: "餐饮连锁", color: "#F0554D", src: "亿邦动力等综合", time: "3 天前",
    title: "瑞幸的数字化中台：从数据选品到 2 万家门店的智能补货排班",
    summary: "从酱香拿铁式的联名爆品，到万店规模下依然保持低损耗，瑞幸把选品、订货、排班都交给数据与算法：系统预测门店销量，指导备货与人效安排，联名爆品由数据驱动节奏。",
    tags: ["门店 2万+", "爆品数据选品", "损耗 ↓"], tagColor: "",
    insight: "连锁门店最值钱的不是压货能力，是预测能力。这套能力过去只有头部养得起，如今被拆成按月订阅的「门店 AI 经营大脑」，街边小店同样用得起。",
    cta: "开通门店经营大脑", ctaHref: "/lanqi-v2/home.html", hot: true
  },
  {
    id: "linqingxuan-online-guides",
    type: "case", cat: "美业", color: "#E8558A", src: "联商网等综合", time: "5 天前",
    title: "林清轩的数字化导购：线下停摆的一个月，业绩反超同期 145%",
    summary: "2020 年 2 月线下门店停摆，林清轩把 300+ 门店导购全部转移到线上：小程序 + 社群 + 直播，总部统一生产内容物料，当月业绩反超去年同期 145%，成为零售数字化转型的标志性案例。",
    tags: ["业绩 +145%", "导购全员上线", "私域标杆"], tagColor: "green",
    insight: "把导购变成「内容分发节点」是私域获客的本质。现在 AI 把这条流水线再压缩一层：种草素材、朋友圈文案、跟单话术，一个智能体批量生成、按人分发。",
    cta: "开通 AI 获客工作台", ctaHref: "/agents", hot: false
  },
  {
    id: "huazhu-30s-checkin",
    type: "case", cat: "出行酒旅", color: "#2BB673", src: "环球旅讯等综合", time: "上周",
    title: "华住「30 秒入住、0 秒退房」：从自助机到智能客服，前台被重新定义",
    summary: "华住自研自助机覆盖全国数千家门店，30 秒入住、0 秒退房成为标配；智能客服承接高频问询，前台人力转向服务与二次销售，入住数据回流会员体系。",
    tags: ["30 秒入住", "0 秒退房", "数千门店"], tagColor: "green",
    insight: "前台降本只是第一步，真正的收益在后面：入住行为数据沉淀后，复购、升舱、跨店推荐才有了燃料。改造别只盯着「省人」，要盯着「数据回流」。",
    cta: "开通门店经营大脑", ctaHref: "/lanqi-v2/home.html", hot: false
  },
  {
    id: "tsingtao-lighthouse-factory",
    type: "case", cat: "制造", color: "#4C7DFF", src: "世界经济论坛等综合", time: "上周",
    title: "青岛啤酒入选 WEF「灯塔工厂」：定制啤酒交付周期缩短 50%",
    summary: "青岛啤酒全流程数字化智能化工厂入选世界经济论坛「灯塔工厂」，为全球啤酒饮料业首家；私人定制啤酒从接单、排产到交付的周期缩短 50% 以上，跑通「大规模个性化」。",
    tags: ["交付周期 -50%", "WEF 灯塔工厂", "大规模定制"], tagColor: "blue",
    insight: "制造业的 AI 改造别急着上「无人化」，先把「接单—排产—交付」这条链路的数据打通。链路通了，每个环节上什么智能体一目了然。",
    cta: "咨询决策智能体方案", ctaHref: "/agents", hot: false
  },
  {
    id: "mengniu-ningxia-smart-factory",
    type: "case", cat: "制造", color: "#4C7DFF", src: "乳业媒体等综合", time: "2 周前",
    title: "蒙牛宁夏工厂：全球乳业首家全数智化工厂，「30 人干 3000 人的活」",
    summary: "蒙牛宁夏工厂 2023 年投产，被业界称为全球乳业首家全数智化工厂：上百人团队完成全厂运营，单线效率与人均产值数倍于传统工厂，质量数据全程在线。",
    tags: ["全球乳业首家", "全数智化", "人均产值 ↑"], tagColor: "blue",
    insight: "工厂智能化省下来的人，应该流向研发和市场——那才是 AI 替不掉的岗位。算这笔账时，把「人效」和「钱效」放在一起算。",
    cta: "咨询智能体方案", ctaHref: "/agents", hot: false
  },
  {
    id: "watsons-ai-skin-test",
    type: "case", cat: "美业", color: "#E8558A", src: "化妆品观察等综合", time: "2 周前",
    title: "屈臣氏把试妆台搬进小程序：AI 肤质检测 + O2O，把客流变会员",
    summary: "屈臣氏用 AI 肤质检测、虚拟试妆降低试用门槛，配合门店 1 小时达，把到店客流沉淀为线上会员池，导购按肤质数据做精准复购推荐。",
    tags: ["AI 试妆", "O2O 1小时达", "精准复购"], tagColor: "green",
    insight: "美业 AI 改造先做「体验数字化」：检测、试妆生成的数据是最精准的销售线索。有了这份数据，后续所有智能体的推荐才有准头。",
    cta: "开通门店经营大脑", ctaHref: "/lanqi-v2/home.html", hot: false
  },
  {
    id: "ctrip-wendao-llm",
    type: "case", cat: "出行酒旅", color: "#2BB673", src: "环球旅讯等综合", time: "3 周前",
    title: "携程发布旅游垂直大模型「问道」：AI 替用户做行程决策",
    summary: "携程发布旅游垂直大模型「问道」，主打行程规划与售中售后智能服务；同程「程心 AI」、飞猪 AI 行程助手随后跟进，OTA 服务全面 AI 化，咨询响应时长大幅下降。",
    tags: ["垂直大模型", "行程一键规划", "响应时长 ↓"], tagColor: "green",
    insight: "垂类大模型的打法 = 行业数据 + 专属工作流。这个公式中小企业完全可以复制：用智能体平台 + 自己的行业 know-how，搭出本行业的「问道」。",
    cta: "用古人智慧做决策", ctaHref: "/agents", hot: false
  },
  {
    id: "policy-ai-plus-opinion",
    type: "ind", cat: "行业动态", color: "#8B5CF6", src: "综合公开报道", time: "昨天",
    title: "国务院印发「人工智能+」行动意见：AI 改造进入政策红利期",
    summary: "国务院发布《关于深入实施「人工智能+」行动的意见》，围绕制造、消费、民生等领域部署重点行动，鼓励人工智能新技术新产品应用场景落地，地方配套补贴与样板案例扶持陆续跟进。",
    tags: ["政策定调", "场景落地", "红利期"], tagColor: "purple",
    insight: "政策文件的信号意义在于：AI 改造从「企业自选动作」变成「行业规定动作」。越早跑出结果的企业，越容易拿补贴、评样板、上案例。",
    cta: "抢占先机 · 逛智能体", ctaHref: "/agents", hot: false
  },
  {
    id: "deepseek-open-source-moment",
    type: "ind", cat: "行业动态", color: "#8B5CF6", src: "综合公开报道", time: "3 天前",
    title: "DeepSeek 时刻一年后：开源模型把「大模型智力」打成公共资源",
    summary: "DeepSeek-V3 论文披露的训练成本约 558 万美元、R1 性能对标顶级闭源模型，API 价格仅为同类产品的几十分之一；此后开源社区快速跟进，企业「私有部署 + 微调」的门槛持续下探。",
    tags: ["训练成本 ↓↓", "API 几十分之一", "开源逼近闭源"], tagColor: "purple",
    insight: "成本逻辑变了：过去「用 AI」是一笔投资决策，现在是一次订阅决策。正确的顺序是——先用小场景验证 ROI，再决定往哪加大投入。",
    cta: "从获客环节开始试", ctaHref: "/agents", hot: false
  },
  {
    id: "cloud-price-war-97",
    type: "ind", cat: "行业动态", color: "#8B5CF6", src: "综合公开报道", time: "上周",
    title: "云厂商价格战：主力模型降幅最高 97%，推理成本进入「水电费」区间",
    summary: "头部云厂商先后对大模型 API 多轮降价，主力模型降幅最高达 97%；另一家厂商把价格打到 0.0008 元 / 千 tokens——生成 100 万字内容，成本不到一杯奶茶。",
    tags: ["降幅 97%", "0.0008 元/千 tokens", "百万字 < 一杯奶茶"], tagColor: "purple",
    insight: "推理成本进入「水电费」区间后，企业比拼的不再是「用不用得起模型」，而是「谁先把手里的业务数据喂进工作流」。数据是新的护城河。",
    cta: "开通 AI 获客工作台", ctaHref: "/agents", hot: false
  },
  {
    id: "wechat-deepseek-r1",
    type: "ind", cat: "行业动态", color: "#8B5CF6", src: "综合公开报道", time: "上周",
    title: "微信灰度接入 DeepSeek-R1：国民级入口把 AI 用法教育成本降为零",
    summary: "微信搜一搜灰度测试接入 DeepSeek-R1，用户无需下载 App 即可使用深度思考；腾讯元宝等多款产品同步接入。AI 的使用门槛进一步消失，全民 AI 用法普及加速。",
    tags: ["全民入口", "零下载", "教育成本归零"], tagColor: "purple",
    insight: "你的客户已经在用 AI 提问了。企业侧的智能体若还不上线，相当于「客户在门口敲了一年门，店里没人应」。",
    cta: "布置你的 AI 门店", ctaHref: "/lanqi-v2/home.html", hot: false
  },
  {
    id: "agent-year-consensus",
    type: "ind", cat: "行业动态", color: "#8B5CF6", src: "综合公开报道", time: "上个月",
    title: "从聊天到干活：通用智能体集中爆发，「智能体元年」成共识",
    summary: "通用智能体产品集中上线并出圈，国内外平台相继开放智能体编排与插件生态；行业共识从「对话机器人」转向「能干活的智能体」：接单、写作、排程、汇报全流程托管。",
    tags: ["智能体元年", "全流程托管", "平台生态"], tagColor: "purple",
    insight: "智能体和聊天机器人的区别是「交付」：聊天给答案，智能体给结果。企业采购时认准一个标准——这个 AI 交付的是「一段话」还是「干完的活」。",
    cta: "认领你的 AI 员工", ctaHref: "/agents", hot: false
  },
  {
    id: "sany-pile-machine-lighthouse",
    type: "case", cat: "制造", color: "#4C7DFF", src: "综合公开报道", time: "上个月",
    title: "三一重工北京桩机工厂：全球重工行业首家「灯塔工厂」",
    summary: "三一重工北京桩机工厂入选世界经济论坛「灯塔工厂」，为全球重工行业首家：AI 排产、机器视觉质检与柔性制造上线后，产能与人均产值大幅提升，重型装备实现混流生产。",
    tags: ["全球重工首家", "AI 排产", "人均产值 ↑"], tagColor: "blue",
    insight: "离散制造的痛点是「插单」。AI 排产先解决「忙而不乱」，再谈黑灯工厂——顺序反了，投多少都打水漂。",
    cta: "咨询智能体方案", ctaHref: "/agents", hot: false
  },
  {
    id: "midea-5-lighthouse",
    type: "case", cat: "制造", color: "#4C7DFF", src: "综合公开报道", time: "上个月",
    title: "美的集团第 5 家「灯塔工厂」：从卖家电到对外输出智造能力",
    summary: "美的集团旗下灯塔工厂增至 5 家，规模居全球前列；美的把改造经验打包成工业互联网平台对外输出，「自己先用好，再卖给别人」成为制造业数字化转型的典型路径。",
    tags: ["5 家灯塔工厂", "能力外溢", "平台化输出"], tagColor: "blue",
    insight: "先用出结果，再把结果卖成产品——这条路径适合所有行业龙头。中小企业则刚好反过来：直接订阅别人验证过的结果，跳过试错成本。",
    cta: "订阅验证过的方案", ctaHref: "/agents", hot: false
  },
  {
    id: "luzhoulaojiao-smart-brewing",
    type: "case", cat: "餐饮连锁", color: "#F0554D", src: "综合公开报道", time: "上个月",
    title: "泸州老窖智能酿造：传统白酒产业的「数智工厂」样本",
    summary: "泸州老窖建成智能化酿酒生态园，把老师傅的酿造经验转化为可复制的数字工艺参数，出酒率与品质稳定性提升，传统产业与 AI 结合的代表性案例。",
    tags: ["经验数字化", "品质稳定", "出酒率 ↑"], tagColor: "",
    insight: "老手艺数字化 = 把「老师傅的直觉」变成「系统的参数」。任何行业里最值钱的隐性经验，都值得先用 AI 存一遍。",
    cta: "用古人智慧管经验", ctaHref: "/agents", hot: false
  },
  {
    id: "muyuan-smart-pig-house",
    type: "case", cat: "零售电商", color: "#FF7A45", src: "综合公开报道", time: "2 个月前",
    title: "牧原的智能猪舍：猪脸识别与 AI 查情，养殖业的新基建",
    summary: "牧原股份在养殖场试点智能化改造：猪脸识别个体管理、AI 查情预警、巡检机器人替代人工夜巡，养殖效率与防疫水平同步提升，传统农业场景的 AI 标杆。",
    tags: ["猪脸识别", "AI 预警", "无人巡检"], tagColor: "",
    insight: "越是「苦脏累」的行业，AI 改造的 ROI 越好算——省下的人力立刻变现。别小看传统行业，它们往往是 AI 落地最快的地方。",
    cta: "咨询智能体方案", ctaHref: "/agents", hot: false
  }
];

/** 置顶「思潼解读」编辑审校稿（LLM 失败 / 未配置时的兜底） */
export const AI_NEWS_HERO_SEED: AiNewsHero = {
  title: "大模型降到「地板价」：中小企业做 AI 改造，账算得过来了",
  summary: "2024 年以来主流大模型 API 多轮降价：有云厂商主力模型降幅最高 97%，有厂商把价格打到 0.0008 元 / 千 tokens；DeepSeek 等开源模型的训练成本与调用价格再降一个量级。过去一套企业智能系统动辄几十万起步，如今同样能力的 AI 工作流，按订阅算只要千元级 / 月。",
  meaning: "AI 改造从「大厂专属」变成「人人可试」。建议别从「上系统」开始，从最能算清 ROI 的三个环节开始：获客、私域运营、门店经营。"
};

export function findAiNewsItem(id: string): AiNewsItem | undefined {
  return AI_NEWS.find((item) => item.id === id);
}

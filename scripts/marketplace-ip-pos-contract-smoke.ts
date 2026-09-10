// IP 定位智能体（ip-pos）输出契约回归：离线校验 parseIpPosFull 的硬门禁 V1–V10。
// 不需要模型和数据库，毫秒级可重复；用于防止「正确输出被判失败」和「错误输出被放行」。
import { parseIpPosFull } from "../apps/api/src/routes/marketplace.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

const TOPIC_TYPES: Array<[string, number]> = [
  ["信任型", 22],
  ["认知型", 22],
  ["连接型", 22],
  ["转化型", 14]
];

function table(header: string, rows: string[]): string {
  const columns = header.split("|").length;
  const separator = `|${Array.from({ length: columns }, () => "---").join("|")}|`;
  return [header, separator, ...rows].join("\n");
}

/** 一份对齐契约（速览 + 八章 + ≥80 条选题）的“应该通过”样例。 */
function buildValidDoc(): string {
  const topicSections = TOPIC_TYPES.map(([type, count]) => {
    const items = Array.from({ length: count }, (_, index) => `${index + 1}. ${type}选题示例 ${index + 1} ｜ 口播 ｜ ⭐⭐`);
    return [`### 5.${TOPIC_TYPES.findIndex(([name]) => name === type) + 1} ${type}选题（共 ${count} 条）`, ...items].join("\n");
  }).join("\n\n");

  const top10 = table(
    "| 排名 | 选题标题方向 | 类型 | 预期效果 | 创作要点 |",
    Array.from(
      { length: 10 },
      (_, index) => `| ${index + 1} | 优先选题方向 ${index + 1} | 信任型 | 建立第一印象 | 开场给数据 |`
    )
  );

  const calendar = table(
    "| 日期 | 类型 | 选题 | 备注 |",
    Array.from({ length: 30 }, (_, index) => `| D${index + 1} | 信任型 | 第 ${index + 1} 天选题 | ${index === 6 ? "休息日" : "发布"}`)
  );

  return [
    "# IP定位全案 · 测试品牌",
    "",
    "## 📌 1分钟速览",
    table(
      "| 维度 | 结论 |",
      [
        "| 项目定位 | 用门店 SOP 帮二三线城市老板把店开稳，赚加盟与服务费 |",
        "| 核心用户 | 想开美容院但怕亏的女性创业者，最痛的是没客源 |",
        "| IP人设 | 12 家直营店老板，用真账真数据带店 |",
        "| IP原型 | 主原型：专家型；辅助原型：同行型 |",
        "| 当前IP状态 | 抖音 1.2 万粉，视频号 3000 粉，内容未成体系 |",
        "| 内容重心 | 先打门店经营实证类信任型内容 |",
        "| 首选平台 | 抖音为主阵地，同城创业人群密度高 |",
        "| 第一个月核心动作 | ①拆 12 条门店实证 ②固定每周 3 条 ③改主页四件套 |"
      ]
    ),
    "",
    "## 一、项目定位",
    "### 1.1 一句话定位",
    "> 我开第一家店的时候只有 4 个人，现在 12 家直营店跑出来的 SOP 都在这儿。",
    "### 1.2 核心差异化",
    table(
      "| 序号 | 差异化点 | 支撑证据 | 用户价值 |",
      [
        "| 1 | 从 1 家店做到 12 家直营店 | 12 家直营店（用户提供） | 听的是开过店的人的经验 |",
        "| 2 | 专做门店 SOP 与员工带教 | 待补充：需要用户提供 SOP 模块名 | 解决员工留不住 |",
        "| 3 | 加盟后继续陪跑经营 | 待补充：需要用户提供陪跑清单 | 降低交了钱没人管的顾虑 |"
      ]
    ),
    "### 1.3 竞品对比",
    table(
      "| 维度 | 我们 | 竞品A | 竞品B | 机会点 |",
      [
        "| 出身 | 12 家直营店 | 竞品A（待补充） | 竞品B（待补充） | 直营店数量可验证 |",
        "| 服务 | 含陪跑 | 竞品A（待补充） | 竞品B（待补充） | 陪跑做成可展示交付物 |",
        "| 内容 | 门店实证 | 竞品A（待补充） | 竞品B（待补充） | 实证型内容稀缺 |"
      ]
    ),
    "### 1.4 阶段判断",
    "- 当前阶段：起步期（抖音 1.2 万粉，团队 3 人）",
    "- IP策略方向：先打透「12 家直营店老板」这一个身份，不做泛美业知识。",
    "",
    "## 二、目标用户定位",
    "### 2.1 用户画像（代号：想开店的阿梅）",
    table("| 维度 | 描述 |", ["| 年龄/城市/职业/收入 | 30–45 岁 / 二三线 / 待开店 / 20–50 万 |", "| 一句话描述 | 我怕投进去的钱打水漂 |"]),
    "### 2.2 痛点地图",
    table(
      "| 序号 | 痛点 | 类型 | 紧急度 | 现状 |",
      [
        "| 1 | 没客源 | 功能 | 高 | 靠发传单 |",
        "| 2 | 员工留不住 | 功能 | 高 | 半年走一半 |",
        "| 3 | 不会做线上获客 | 功能 | 高 | 账号没起色 |",
        "| 4 | 怕被同行割韭菜 | 情感 | 中 | 报了课没结果 |",
        "| 5 | 不敢跟家人说 | 社会 | 中 | 自己扛着 |"
      ]
    ),
    "### 2.3 决策旅程",
    table(
      "| 阶段 | 他在想什么 | 匹配内容类型 |",
      ["| 怀疑期 | 这人靠谱吗 | 信任型 |", "| 学习期 | 开店到底要多少钱 | 认知型 |", "| 对比期 | 他家是不是更好 | 连接型 |", "| 决策期 | 现在报名合适吗 | 转化型 |"]
    ),
    "### 2.4 内容消费偏好",
    table("| 平台 | 时段 | 信任源 |", ["| 抖音 | 21:00–23:00 | 门店实拍 |", "| 视频号 | 12:00–13:00 | 朋友圈口碑 |"]),
    "",
    "## 三、IP人设定位",
    "### 3.1 一句话人设",
    "> 我是兰琪，12 家直营美容院的老板，专讲开店能落地的动作。",
    "### 3.2 五维人设模型",
    table(
      "| 维度 | 内容 |",
      [
        "| 身份标签 | 主：连锁美容院创始人 / 辅：门店带教者 |",
        "| 性格特质 | 务实 50% + 直接 30% + 较真 20% |",
        "| 信任锚点 | 核心：12 家直营店 ／ 阶段验证：SOP 落地 ／ 持续证明：门店数据 |",
        "| 表达风格 | 中等偏快，语气平实，不喊口号 |",
        "| 价值主张 | 把店开稳比开快重要 |"
      ]
    ),
    "- **3 个月认知转变**：从「又一个招商号」→ 到「这人是真开店的」",
    "### 3.3 IP原型",
    "- 主原型：专家型",
    "- 辅助原型：同行型",
    "- 理由：门店经验可验证，表达像同行不像机构。",
    "### 3.4 语言风格",
    "**正例**（100–200 字，口语，用户能直接照读）：",
    "> 我开第一家店的时候招了 4 个人，半年走了 3 个，当时我也想不通，工资没少给。后来把接待流程拆成 7 步，新人照着做，人就没再走。今天我把这 7 步和带教周期一起说清楚，你照着改，最少能少踩一次坑。",
    "**反例**（约 100 字，说明为什么用户会划走）：",
    "> 大家好我是某某老师，今天给大家分享三个干货，一定要看到最后。",
    "### 3.5 视觉建议",
    table("| 主色调 | 场景 | 着装 | 质感 |", ["| 米白 | 门店前台 | 素色针织 | 干净真实 |"]),
    "### 3.6 记忆板块",
    "#### 视觉锤",
    "- 主锤：门店实景横图",
    "- 辅锤：手写 SOP 白板",
    "- 使用场景：每条内容的开场画面",
    "#### 声音钉",
    "- 开场音/BGM：轻鼓点无歌词",
    "- 标志语/口头禅：我跟你说实话",
    "- 语调特征：平实、不煽动",
    "### 3.7 主页四件套",
    "#### 昵称建议",
    "- 推荐：兰琪｜12家美容院老板",
    "- 备选：兰琪聊美容院经营",
    "#### 头像建议",
    "- 拍摄要点：半身正面，门店前台背景，自然光",
    "- 要求：不重度美颜，面部占比 60%",
    "#### 签名档",
    "```",
    "第1行（身份标签）：兰琪｜从1家店做到12家直营美容院",
    "第2行（价值主张）：专讲门店SOP和员工带教，开店能落地的动作",
    "第3行（信任钩子）：12家直营店的真账真数据，踩过的坑都在这",
    "第4行（行动引导）：想看门店经营干货，看主页置顶",
    "```",
    "#### 背景图建议",
    "- 内容：门店实景横图 + 一句「开店不是靠运气」",
    "- 风格：干净、真实，无浮夸促销元素",
    "",
    "## 四、内容定位",
    "### 4.1 内容使命",
    "> 让想开店的老板看完 30 条内容，敢来问一句「我这种情况怎么做」。",
    "### 4.2 内容矩阵",
    table(
      "| 类型 | 配比 | 方向 | 示例选题 |",
      [
        "| 信任型 | 40% | 门店实证 | 12 家店怎么带教 |",
        "| 认知型 | 25% | 开店算账 | 开一家店要多少钱 |",
        "| 连接型 | 20% | 同行共鸣 | 老板的一天 |",
        "| 转化型 | 15% | 招商咨询 | 陪跑怎么合作 |"
      ]
    ),
    "### 4.3 平台差异化",
    table(
      "| 平台 | 定位 | 侧重 | 频率 |",
      [
        "| 抖音 | 主阵地 | 门店实证与避坑 | 每周 3 条 |",
        "| 视频号 | 承接阵地 | 案例复盘与答疑 | 每周 1 条 |"
      ]
    ),
    "",
    "## 五、选题方向",
    topicSections,
    "",
    "### 5.5 TOP10 优先选题",
    top10,
    "### 5.6 第一个月选题日历",
    calendar,
    "### 5.7 结尾钩子规范",
    "- 结尾统一用：评论区说下你在哪个城市",
    "",
    "## 六、投流建议",
    "### 6.1 投流前置判断",
    "- 是否适合投流：适合，先测信任型内容",
    "### 6.2 DOU+ 投放方案",
    table("| 目标 | 金额 | 时长 | 人群 |", ["| 内容加热 | 100 元/条 | 24 小时 | 创业人群 |"]),
    "### 6.3 本地推投放方案",
    table("| 场景 | 目标 | 金额 | 范围 | 关键设置 |", ["| 到店咨询 | 留资 | 待补充：需用户确认月预算 | 待补充：需用户确认目标城市 | 私信留资 |"]),
    "### 6.4 月预算分配",
    table("| 项目 | 金额 | 占比 |", ["| DOU+ | 3000 元 | 70% |", "| 本地推 | 1000 元 | 30% |", "| **合计** | **4000 元** | **100%** |"]),
    "### 6.5 第一个月投放日历",
    table("| 日期 | 投什么内容 | 渠道 | 金额 |", ["| D1 | 门店实证 | DOU+ | 100 元 |", "| D8 | 算账干货 | 本地推 | 200 元 |", "| D15 | 同行共鸣 | DOU+ | 100 元 |", "| D22 | 招商答疑 | 本地推 | 200 元 |"]),
    "",
    "## 七、IP发展规划",
    "### 7.1 IP能力评估",
    table(
      "| 维度 | 评分(0-10) | 当前表现 | 目标(3个月) |",
      [
        "| 表达能力 | 7 | 讲得清 | 8 |",
        "| 内容能力 | 5 | 不成体系 | 8 |",
        "| 平台认知 | 6 | 知道但不会用 | 8 |",
        "| 账号基础 | 4 | 1.2 万粉 | 7 |",
        "| 投入度 | 8 | 每周 2 天 | 9 |",
        "| **综合** | **30/50** | | **40/50** |"
      ]
    ),
    "### 7.2 现状诊断",
    "- 当前最短板：内容能力",
    "- 当前最大卡点：没形成选题体系",
    "- 当前最大优势（别丢了）：门店 SOP 经验",
    "### 7.3 三阶段发展路径",
    table(
      "| 阶段 | 时间 | 人设侧重 | 内容重心 | 关键里程碑 |",
      ["| 起步期 | 第 1–3 月 | 12 家直营店老板 | 门店实证 | 跑通选题体系 |", "| 成长期 | 第 4–6 月 | 门店带教者 | 案例复盘 | 出现自然咨询 |", "| 成熟期 | 第 7–12 月 | 行业带教者 | 方法论输出 | 招商转化稳定 |"]
    ),
    "### 7.4 第一个月能力提升计划",
    table(
      "| 周次 | 练什么 | 怎么练 | 检验标准 |",
      ["| 第1周 | 开场 3 秒 | 每条视频拍 3 个不同开头，挑数据最好的发 | 完播不掉 40% |", "| 第2周 | 讲数字 | 每条内容带 1 个真实数字 | 评论出现提问 |", "| 第3周 | 讲故事 | 用低谷故事开场 | 停留时长上升 |", "| 第4周 | 收尾引导 | 统一评论区引导 | 主页访问上升 |"]
    ),
    "",
    "## 八、执行建议",
    "- **关键成功因素**：① 每周固定 3 条 ② 门店实景素材不断供 ③ 老板本人出镜",
    "- **风险提示**：① 内容更新中断会掉权重 ② 素材千篇一律会让用户划走",
    "- **迭代周期**：每月复盘一次，按数据调整选题配比"
  ].join("\n");
}

function main(): void {
  const input = [
    "- 品牌名：兰琪美业",
    "- 行业：美容院连锁加盟",
    "- 现状：抖音 1.2 万粉、视频号 3000 粉，团队 3 人",
    "- 目标：招商加盟"
  ].join("\n");

  const valid = buildValidDoc();
  const validResult = parseIpPosFull(valid, input);
  assert(
    validResult.failures.length === 0,
    `contract sample passes every hard check, got: ${validResult.failures.join(" / ")}`
  );
  assert(validResult.payload.validation.passed, "validation flag is true for a passing sample");
  assert(validResult.payload.stats.by_type.trust === 22, "trust topics counted from the sample");
  assert(validResult.payload.stats.by_type.conversion === 14, "conversion topics counted from the sample");
  assert(validResult.payload.topics.top10.length === 10, "TOP10 parsed from the sample");
  assert(validResult.payload.topics.calendar30.length >= 28, "calendar parsed from the sample");
  assert(
    validResult.payload.overview.project.includes("门店 SOP"),
    "overview keeps the project positioning text"
  );

  // 前端「主页四件套 / 口播正例」卡片依赖的结构化字段必须稳定产出。
  assert(validResult.payload.homepage.bio.length === 4, "homepage bio keeps the 4 signature lines");
  assert(
    validResult.payload.homepage.bio[0].includes("第1行") && validResult.payload.homepage.bio[3].includes("第4行"),
    "homepage bio keeps the line order"
  );
  assert(
    validResult.payload.homepage.nickname.includes("兰琪"),
    `homepage nickname parsed from the 推荐 line, got: ${validResult.payload.homepage.nickname}`
  );
  assert(
    validResult.payload.homepage.avatar.includes("门店前台"),
    `homepage avatar parsed from the 拍摄要点 line, got: ${validResult.payload.homepage.avatar}`
  );
  assert(
    validResult.payload.homepage.banner.includes("门店实景"),
    `homepage banner parsed from the 内容 line, got: ${validResult.payload.homepage.banner}`
  );
  assert(
    validResult.payload.tone.positive.includes("招了 4 个人"),
    `tone positive keeps the 正例 blockquote, got: ${validResult.payload.tone.positive.slice(0, 40)}`
  );
  assert(
    validResult.payload.tone.negative.includes("要看到最后"),
    `tone negative keeps the 反例 blockquote, got: ${validResult.payload.tone.negative.slice(0, 40)}`
  );

  // 模型没写引用块时（格式漂移）退回标签下方的正文，不能抛错或把正反例串成一段。
  const noQuote = valid
    .replace("> 我开第一家店的时候招了 4 个人", "我开第一家店的时候招了 4 个人")
    .replace("> 大家好我是某某老师", "大家好我是某某老师");
  const noQuoteResult = parseIpPosFull(noQuote, input);
  assert(
    noQuoteResult.payload.tone.positive.includes("招了 4 个人") &&
      noQuoteResult.payload.tone.negative.includes("要看到最后") &&
      !noQuoteResult.payload.tone.positive.includes("要看到最后"),
    `a drifting tone format still separates 正例/反例, got: ${noQuoteResult.payload.tone.positive.slice(0, 60)}`
  );
  assert(noQuoteResult.payload.homepage.bio.length === 4, "homepage bio survives a tone format drift");

  // 连正例标签都缺时只返回空串，交给前端显示占位，不能把别的内容塞进来。
  const noToneLabel = valid.replace("**正例**（100–200 字，口语，用户能直接照读）：\n", "");
  const noToneLabelResult = parseIpPosFull(noToneLabel, input);
  assert(noToneLabelResult.payload.tone.positive === "", "a missing 正例 label yields an empty tone text");

  // 「序号式」和「比较式」的正常表达不能被当成绝对化用语。
  assert(valid.includes("我开第一家店的时候"), "fixture keeps the ordinal 第一家店 wording");
  assert(valid.includes("挑数据最好的发"), "fixture keeps the descriptive 最好 wording");
  assert(valid.includes("**100%**"), "fixture keeps the required 100% ratio wording");

  // 签名档不足 4 行必须判失败。
  const brokenSignature = valid.replace(
    "第4行（行动引导）：想看门店经营干货，看主页置顶\n",
    ""
  );
  const brokenSignatureResult = parseIpPosFull(brokenSignature, input);
  assert(
    brokenSignatureResult.failures.some((item) => item.includes("签名档必须正好 4 行")),
    "a signature block with 3 lines is rejected"
  );

  // 宣称式绝对化用语必须判失败。
  const absoluteClaim = valid.replace(
    "> 我开第一家店的时候只有 4 个人",
    "> 我们是行业第一的门店带教团队，我开第一家店的时候只有 4 个人"
  );
  const absoluteClaimResult = parseIpPosFull(absoluteClaim, input);
  assert(
    absoluteClaimResult.failures.some((item) => item.includes("绝对化用语")),
    "an industry-first claim is rejected"
  );

  // 承诺类表述必须判失败。
  const promiseClaim = valid.replace("现在的 12 家直营店", "现在的 12 家直营店").replace(
    "- 当前最短板：内容能力",
    "- 当前最短板：内容能力，跟我们合作稳赚不赔"
  );
  const promiseClaimResult = parseIpPosFull(promiseClaim, input);
  assert(
    promiseClaimResult.failures.some((item) => item.includes("承诺类表述")),
    "a guarantee-style promise is rejected"
  );

  // 契约要求模型写「反例」演示用户为什么会划走，坏文案里必然带违禁词；
  // 反例是刻意坏样本、不是交付文案，命中违禁词不应判失败（真实模型 422 复现）。
  const badNegativeExample = valid.replace(
    "> 大家好我是某某老师，今天给大家分享三个干货，一定要看到最后。",
    "> 大家好，我们是行业领先的美容院连锁品牌，拥有顶级的加盟体系和百分百成功的扶持模式，加入我们保证你稳赚不赔，轻松月入过万。想了解的朋友赶紧私信我，名额有限。"
  );
  const badNegativeExampleResult = parseIpPosFull(badNegativeExample, input);
  assert(
    badNegativeExampleResult.failures.length === 0,
    `banned words inside the 反例 sample must not fail the run, got: ${badNegativeExampleResult.failures.join(" / ")}`
  );
  assert(
    badNegativeExampleResult.payload.tone.negative.includes("稳赚不赔"),
    "the 反例 sample is still captured for the front-end card"
  );

  // 同一批违禁词出现在「正例」里必须照旧判失败，证明上面的例外只放开反例、没有放宽整体校验。
  const bannedPositive = valid.replace(
    "> 我开第一家店的时候招了 4 个人",
    "> 我开第一家店的时候招了 4 个人，我们是唯一的选择，保证你稳赚不赔"
  );
  const bannedPositiveResult = parseIpPosFull(bannedPositive, input);
  assert(
    bannedPositiveResult.failures.some(
      (item) => item.includes("绝对化用语") || item.includes("承诺类表述")
    ),
    "banned words inside the 正例 must still fail"
  );

  // 否定式和名词性用法不是排他性宣称（真实模型 422 复现：选题「钱不是唯一解」被误判）。
  const negatedAbsolute = valid.replace(
    "20. 认知型选题示例 20 ｜ 口播 ｜ ⭐⭐",
    "20. 美容院员工激励，钱不是唯一解 ｜ 口播 ｜ ⭐⭐"
  );
  assert(
    negatedAbsolute.includes("不是唯一解"),
    "fixture keeps the negated 唯一 wording"
  );
  const negatedAbsoluteResult = parseIpPosFull(negatedAbsolute, input);
  assert(
    negatedAbsoluteResult.failures.length === 0,
    `negated/compound absolute words must not fail the run, got: ${negatedAbsoluteResult.failures.join(" / ")}`
  );

  // 「唯一性 / 保证金」这类名词不算绝对化宣称。
  const nounUsage = valid
    .replace("| 类型 | 配比 | 方向 | 示例选题 |", "| 类型 | 配比 | 方向 | 示例选题 |")
    .replace(
      "- **3 个月认知转变**：从「又一个招商号」→ 到「这人是真开店的」",
      "- **3 个月认知转变**：从「又一个招商号」→ 到「这人是真开店的」（强化人设唯一性，加盟保证金政策待补充）"
    );
  const nounUsageResult = parseIpPosFull(nounUsage, input);
  assert(
    nounUsageResult.failures.length === 0,
    `noun usages like 唯一性/保证金 must not fail the run, got: ${nounUsageResult.failures.join(" / ")}`
  );

  // 「保证一周 2 天投入」是内部执行承诺，不是对客户的收益承诺（真实模型 422 复现）。
  const executionGuarantee = valid.replace(
    "- **迭代周期**：每月复盘一次，按数据调整选题配比",
    "- **迭代周期**：每月复盘一次；团队 3 人分工明确，保证一周 2 天投入能稳定产出"
  );
  const executionGuaranteeResult = parseIpPosFull(executionGuarantee, input);
  assert(
    executionGuaranteeResult.failures.length === 0,
    `an internal execution commitment must not fail the run, got: ${executionGuaranteeResult.failures.join(" / ")}`
  );

  // 「绝对不要」是强调禁止的副词，同样不算绝对化宣称；「绝对有效」这类宣称仍要拦。
  const prohibitionAdverb = valid.replace(
    "- 结尾统一用：评论区说下你在哪个城市",
    "- 结尾统一用：评论区说下你在哪个城市；绝对不要用「一定要看到最后」这类开场"
  );
  assert(
    parseIpPosFull(prohibitionAdverb, input).failures.length === 0,
    "the adverb 绝对不要 must not be treated as an absolute claim"
  );
  const absoluteEffective = valid.replace(
    "- 结尾统一用：评论区说下你在哪个城市",
    "- 结尾统一用：评论区说下你在哪个城市；这套方法绝对有效"
  );
  assert(
    parseIpPosFull(absoluteEffective, input).failures.some((item) => item.includes("绝对化用语")),
    "the claim 绝对有效 must still be rejected"
  );

  // 选题数量不足必须判失败。
  const fewTopics = valid.replace("22. 信任型选题示例 22 ｜ 口播 ｜ ⭐⭐\n", "");
  const fewTopicsResult = parseIpPosFull(fewTopics, input);
  assert(
    fewTopicsResult.failures.some((item) => item.includes("信任型选题不足 22 条")),
    "a short trust topic list is rejected"
  );

  // 痛点不足 5 个必须判失败。
  const fewPains = valid.replace("| 5 | 不敢跟家人说 | 社会 | 中 | 自己扛着 |\n", "");
  const fewPainsResult = parseIpPosFull(fewPains, input);
  assert(
    fewPainsResult.failures.some((item) => item.includes("痛点不足 5 个")),
    "a short pain list is rejected"
  );

  console.log("PASS marketplace-ip-pos-contract-smoke");
}

main();

import { runAgent } from "../packages/agent/src/index.js";

const baseRequest = {
  tenantId: "live-script-v3",
  userId: "qa-user",
  role: "owner" as const,
  planCode: "chain_standard" as const,
  tenantProfile: {
    tenantId: "live-script-v3",
    tenantName: "企业AI服务商旧画像",
    tenantType: "chain_brand" as const,
    businessMemory: {
      industry: "企业AI改造",
      product: "企业AI咨询"
    }
  },
  channel: "h5" as const,
  requestedSkillId: "live_script_planner" as const,
  capabilityId: "live_script"
};

const throwingProvider = {
  name: "live-script-v3-fallback",
  async complete() {
    throw new Error("force_live_script_v3_fallback");
  }
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertFullPackage(answer: string, duration: number) {
  const required = [
    "场景识别", "直播目标", "直播总览", "开场话术", "核心轮播话术",
    "话术A", "话术B", "话术C", "话术D", "承接钩子", "高频问题应答",
    "收尾话术", "轮播节奏表", "场控执行清单", "主播口播稿",
    "运营配合动作", "合规提醒", "复盘指标", "下播后跟进"
  ];
  const missing = required.filter((term) => !answer.includes(term));
  assert(missing.length === 0, `完整场次缺少：${missing.join("、")}\n${answer.slice(0, 1200)}`);
  assert(/(?:^|\n|\|)\s*0-/.test(answer), "时间轴没有从0分钟开始");
  assert(new RegExp(`-${duration}分钟`).test(answer), `时间轴没有覆盖到${duration}分钟`);
}

async function testRichFranchise() {
  const input = [
    "给贴膜小子生成2小时完整招商加盟直播话术包。",
    "行业：手机后市场/手机贴膜连锁。",
    "手机贴膜引流，整店总投资5-8万。",
    "核心利润：手机维修、二手机回收翻新、配件销售。",
    "扶持政策：总部选址评估、15天技术培训、开业3天督导带店、线上引流支持、全年运营督导。",
    "已有400+门店，每天稳定20+条客资，半年新增40家。",
    "留资送《手机后市场盈利白皮书2026》和单店投资回报测算表，目标是领取资料并预约沟通。"
  ].join("\n");
  const result = await runAgent({ ...baseRequest, input }, throwingProvider);
  assertFullPackage(result.answer, 120);
  assert(result.answer.includes("贴膜小子"), "招商样板没有保留品牌");
  assert(result.answer.includes("手机后市场"), "招商样板没有保留行业");
  assert(!/企业AI改造|企业AI咨询/.test(result.answer), "招商样板串入企业旧画像");
  assert(!/经营9年|跑了9年|月营业额2万|月营业额3万|6-12个月|报销路费|价值3800|前10位|还剩5个/.test(result.answer), "招商样板混入未经输入确认的事实");
  return result.answer;
}

async function testRichProduct() {
  const input = [
    "给三禾糖水铺生成120分钟完整到店团购直播话术包。",
    "行业：餐饮/甜品/糖水；目标客户：大连本地想吃广式糖水的顾客。",
    "产品详情：招牌双皮奶、杨枝甘露、陈皮红豆沙、姜撞奶。",
    "真实价格：招牌双人套餐原价68元、团购29.9元；单人经典套餐原价38元、团购16.8元。",
    "购买路径：直播间下单，大连5家直营门店到店核销。",
    "直播目标：引导团购下单并到店核销。库存、有效期、赠品和退款规则暂无。"
  ].join("\n");
  const result = await runAgent({ ...baseRequest, input }, throwingProvider);
  assertFullPackage(result.answer, 120);
  assert(result.answer.includes("三禾糖水铺"), "团购样板没有保留品牌");
  assert(result.answer.includes("29.9元"), "团购样板没有保留真实价格");
  assert(!/每天凌晨5点|不加奶粉|美容养颜|不长胖|免费送|隐藏菜单|有效期30天|最后20单|限量100单/.test(result.answer), "团购样板混入未经输入确认的产品、福利或库存事实");
  return result.answer;
}

async function testClarificationStops() {
  let providerCalls = 0;
  const result = await runAgent({
    ...baseRequest,
    input: "给贴膜小子做2小时完整招商直播话术。加盟费3.98万，整店输出，送设备物料和培训，已有几百家门店。"
  }, {
    name: "must-not-call-provider",
    async complete() {
      providerCalls += 1;
      return "不应调用";
    }
  });
  assert(providerCalls === 0, "信息不足时仍调用了模型");
  assert(result.qualityFlags.includes("live_script_clarification_used"), "信息不足时没有命中直播追问门禁");
  assert(result.answer.includes("已确认信息") && result.answer.includes("请一次性补充"), "追问没有先确认已知信息");
  assert(result.answer.includes("品牌/项目：贴膜小子"), "追问没有继承用户已提供的品牌名");
  assert(result.answer.includes("直播项目：贴膜小子整店输出加盟项目"), "追问没有继承用户已提供的整店输出项目信息");
  assert(!result.answer.includes("直播产品或项目：这场具体讲什么、卖什么"), "追问重复索要用户已经提供的直播项目");
  assert(!/直播总览|核心轮播话术|轮播节奏表|场控执行清单|框架版/.test(result.answer), "信息不足时仍输出了框架或完整产物");
  return result.answer;
}

async function testFocusedScope() {
  const result = await runAgent({
    ...baseRequest,
    input: "给鲁蒙肉饼写一段招商直播开场话术，只要开场。产品是中式快餐加盟项目，目标客户是山东准备开店的创业者，目标是私信‘加盟资料’预约沟通，没有回本数据和成功案例。"
  }, throwingProvider);
  assert(result.answer.includes("开场话术") && result.answer.includes("主播口播稿"), "单段任务没有交付开场逐字稿");
  assert(!/轮播节奏表|场控执行清单|话术A|话术B/.test(result.answer), "单段任务被扩成完整场次");
  assert(result.answer.includes("鲁蒙肉饼") && !/企业AI改造|企业AI咨询/.test(result.answer), `单段任务品牌错误或串旧画像\n${result.answer}`);
  return result.answer;
}

async function testClarificationFollowUpKeepsFullScope() {
  const initial = "给贴膜小子做2小时完整招商直播话术。加盟费3.98万，整店输出，送设备物料和培训，已有几百家门店。";
  const followUp = "补充信息：直播项目是手机后市场连锁门店招商加盟，目标客户是准备开店的创业者。整店总投资5-8万元。真实盈利项目包括手机维修、二手机回收翻新和配件销售。总部支持包括选址评估、15天技术培训、开业3天督导带店、线上引流支持和全年运营督导。承接资料是《手机后市场盈利白皮书2026》和单店投资回报测算表；唯一转化动作是私信‘项目资料’领取资料并预约沟通。";
  const result = await runAgent({
    ...baseRequest,
    input: followUp,
    history: [
      { role: "user", content: initial },
      { role: "assistant", content: "请一次性补充整店总投资、盈利项目、扶持动作和承接资料。" }
    ]
  }, throwingProvider);
  assertFullPackage(result.answer, 120);
  assert(result.answer.includes("贴膜小子") && result.answer.includes("项目资料"), "补充信息后没有继承品牌或转化动作");
  assert(result.answer.includes("手机后市场连锁门店招商加盟"), "补充信息后没有继承本轮直播项目");
  assert(result.answer.includes("手机维修、二手机回收翻新和配件销售"), "补充信息后没有继承真实盈利项目");
  assert(!/培训机构主推产品|企业AI改造|企业AI咨询/.test(result.answer), "补充信息后串入企业旧画像或错误项目");
  assert(!result.answer.includes("本轮只交付用户点名的转化环节"), "补充字段中的转化动作把完整任务错误降级为单段输出");
  return result.answer;
}

async function main() {
  const franchise = await testRichFranchise();
  const product = await testRichProduct();
  const clarification = await testClarificationStops();
  const focused = await testFocusedScope();
  const followUp = await testClarificationFollowUpKeepsFullScope();
  console.log(JSON.stringify({
    ok: true,
    cases: 5,
    franchiseChars: franchise.length,
    productChars: product.length,
    clarificationChars: clarification.length,
    focusedChars: focused.length,
    followUpChars: followUp.length,
    checks: [
      "招商120分钟完整结构",
      "团购120分钟完整结构",
      "信息不足只追问并停止",
      "单段需求严格控范围",
      "补充信息后保持完整任务范围",
      "企业旧画像不串入",
      "未确认数字/福利/库存不编造"
    ]
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

import { routeSkill, runAgent } from "../packages/agent/src/index.js";

let providerCalls = 0;
const provider = {
  name: "live-skill-regression",
  async complete() {
    providerCalls += 1;
    throw new Error("force_live_skill_fallback");
  }
};

const requestBase = {
  tenantId: "live-skill-regression",
  userId: "live-skill-user",
  role: "owner" as const,
  planCode: "chain_standard" as const,
  tenantProfile: {
    tenantId: "live-skill-regression",
    tenantName: "测试企业",
    tenantType: "chain_brand" as const
  },
  channel: "h5" as const
};

const reviewSections = [
  "一、核心数据速览",
  "二、流量诊断",
  "三、转化归因",
  "四、互动诊断",
  "五、话术执行对照表",
  "六、人货场诊断",
  "七、方法论沉淀",
  "八、下次直播调整清单"
];

function assertLiveReviewStructure(answer: string, label: string) {
  const missing = reviewSections.filter((term) => !answer.includes(term));
  if (missing.length) throw new Error(`${label}缺少：${missing.join("、")}\n${answer}`);
  if (!/数据缺口/.test(answer) || !/负责人/.test(answer) || !/验收指标/.test(answer)) {
    throw new Error(`${label}缺少证据边界或执行字段\n${answer}`);
  }
  const unsafe = ["前50个", "3个月回本", "一分不少退", "稳赚", "利润分析报告", "不用留电话", "西安李哥", "完整内容执行包", "剪辑EDL", "拍摄脚本"];
  const hit = unsafe.find((term) => answer.includes(term));
  if (hit) throw new Error(`${label}出现未提供事实/错误模板：${hit}\n${answer}`);
}

async function testLiveScript() {
  const inputs = [
    "给我的成都美甲店写直播话术，主推通勤美甲，吸引附近上班族预约到店。",
    "给客户的中式快餐连锁项目写招商直播话术，吸引有餐饮经验的创业者私信领取项目资料。",
    "我是做企业AI改造的，给我写一场面向中小企业老板的咨询直播话术，目标是获得诊断预约。"
  ];
  const required = ["场景识别", "直播目标", "开播前检查", "主播口播稿", "开场", "留人", "互动", "产品承接", "转化", "逼单", "下播后跟进", "运营配合动作", "合规提醒", "复盘指标"];
  for (const input of inputs) {
    const result = await runAgent({ ...requestBase, input, requestedSkillId: "live_script_planner", capabilityId: "live_script" }, provider);
    const missing = required.filter((term) => !result.answer.includes(term));
    if (missing.length || /完整内容执行包|拍摄脚本|剪辑EDL/.test(result.answer)) {
      throw new Error(`直播话术不合格：${missing.join("、")}\n${result.answer}`);
    }
  }
}

async function testFullLiveReview() {
  const input = [
    "复盘这场视频号招商加盟直播。",
    "直播后台：时长125分钟，累计观看8743，峰值在线326，平均在线142，新增关注187，评论1247，分享89，项目点击412，留资47，无投流。",
    "分段数据：0-30分钟峰值283、点击89、留资11；30-60分钟峰值326、点击156、留资21；60-90分钟峰值198、点击98、留资9；90-120分钟峰值154、点击69、留资6。",
    "录音转写：开场语速约280字/分钟；12分钟出现5秒停顿；35分钟回答没经验能不能做；72分钟讲扶持时出现负面评论；96分钟出现20秒断流；口癖“然后”31次、“就是说”18次。",
    "主播原话：品牌做了9年，有400家门店，毛利60%以上。以上经营数据尚未提供证明材料。",
    "原计划：开场、痛点、实力、模型、扶持、案例、留资循环；目标留资60-80，峰值在线500以上，平均在线200以上。"
  ].join("\n");
  const result = await runAgent({ ...requestBase, input, requestedSkillId: "baolu_live_review_engine", capabilityId: "live_review" }, provider);
  assertLiveReviewStructure(result.answer, "完整直播复盘");
  if (result.analysisMode !== "deep") throw new Error(`直播复盘应走深度思考，实际为${result.analysisMode}`);
  const blockingFlags = result.qualityFlags.filter((flag) => flag !== "provider_fallback_used");
  if (blockingFlags.length) throw new Error(`完整直播复盘存在阻断性质量标记：${blockingFlags.join("、")}`);
  for (const fact of ["8743", "326", "142", "1247", "412", "47", "0.54%", "11.41%", "78.33%", "58.75%", "65.20%", "71.00%", "平均停留未提供", "主播原话"]) {
    if (!result.answer.includes(fact)) throw new Error(`完整直播复盘未保留/计算：${fact}\n${result.answer}`);
  }
  if (/平均停留(?:为|：|\s)*(?:3|4|5)\s*(?:-|至|到)?\s*(?:3|4|5)?\s*分钟/.test(result.answer)) throw new Error(`完整直播复盘虚构平均停留\n${result.answer}`);
}

async function testLiveDataOnlyReview() {
  const input = "复盘这场团购直播。抖音后台：时长60分钟，累计观看1200，峰值在线88，平均在线41，评论96，商品点击150，订单18，GMV2160，无投流。";
  const result = await runAgent({ ...requestBase, input, requestedSkillId: "baolu_live_review_engine", capabilityId: "live_review" }, provider);
  assertLiveReviewStructure(result.answer, "仅后台数据复盘");
  if (!result.answer.includes("场观下单率：18 ÷ 1200 × 100% = 1.50%")) throw new Error(`仅后台数据复盘计算错误\n${result.answer}`);
  if (!/未提供转写|待补转写/.test(result.answer)) throw new Error(`仅后台数据复盘未正确降级话术模块\n${result.answer}`);
}

async function testTranscriptOnlyReview() {
  const input = "复盘这场知识咨询直播。录音转写：开场语速约260字/分钟；第8分钟回答企业老板关于AI落地的问题；第24分钟出现7秒停顿；口癖“然后”22次。没有导出直播后台数据，也没有原定话术计划。";
  const result = await runAgent({ ...requestBase, input, requestedSkillId: "baolu_live_review_engine", capabilityId: "live_review" }, provider);
  assertLiveReviewStructure(result.answer, "仅转写复盘");
  for (const fact of ["260字/分钟", "7秒停顿", "“然后”22次", "累计观看未提供", "未提供原计划"]) {
    if (!result.answer.includes(fact)) throw new Error(`仅转写复盘未正确保留或降级：${fact}\n${result.answer}`);
  }
}

async function testNoEvidenceClarification() {
  const before = providerCalls;
  const result = await runAgent({ ...requestBase, input: "帮我复盘昨天的直播", requestedSkillId: "baolu_live_review_engine", capabilityId: "live_review" }, provider);
  if (!/还没有收到可分析的后台数据或录音转写/.test(result.answer) || /一、核心数据速览/.test(result.answer)) {
    throw new Error(`无证据时没有正确追问\n${result.answer}`);
  }
  if (providerCalls !== before) throw new Error("无证据直播复盘不应调用模型");
}

async function testUnsafeProviderIsRejected() {
  let calls = 0;
  const unsafeProvider = {
    name: "unsafe-live-review-provider",
    async complete() {
      calls += 1;
      return calls === 1
        ? "not-json"
        : "平均停留3-5分钟，前50个送利润分析报告，3个月回本，一分不少退。";
    }
  };
  const input = "复盘视频号招商直播。累计观看8743，峰值在线326，项目点击412，留资47。录音转写：第35分钟回答没经验能不能做。原计划：开场、问答、留资。";
  const result = await runAgent({ ...requestBase, input, requestedSkillId: "baolu_live_review_engine", capabilityId: "live_review" }, unsafeProvider);
  assertLiveReviewStructure(result.answer, "错误答案拦截后的直播复盘");
  if (/平均停留3-5|前50个|利润分析报告|3个月回本|一分不少退/.test(result.answer)) {
    throw new Error(`错误答案未被拦截\n${result.answer}`);
  }
}

async function main() {
  if (routeSkill("给我写一套直播话术") !== "live_script_planner") throw new Error("直播话术路由失败");
  if (routeSkill("复盘昨天这场直播") !== "baolu_live_review_engine") throw new Error("直播复盘路由失败");
  await testLiveScript();
  console.log("LIVE_SCRIPT=PASS");
  await testFullLiveReview();
  await testLiveDataOnlyReview();
  await testTranscriptOnlyReview();
  await testNoEvidenceClarification();
  await testUnsafeProviderIsRejected();
  console.log("LIVE_REVIEW_V3=PASS");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

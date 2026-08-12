import { runAgent } from "../packages/agent/src/index.js";

const base = {
  tenantId: "content-golden-regression",
  userId: "content-golden-user",
  role: "owner" as const,
  planCode: "local_standard" as const,
  requestedSkillId: "baolu_content_creator" as const,
  tenantProfile: {
    tenantId: "content-golden-regression",
    tenantName: "思潼AI增长",
    tenantType: "personal_ip" as const,
    industry: "IP与AI企业服务"
  },
  channel: "h5" as const
};

const provider = {
  name: "content-golden-deterministic",
  async complete() {
    throw new Error("force_content_golden_fallback");
  }
};

async function main() {
  const franchise = await runAgent({
    ...base,
    capabilityId: "franchise_acquisition",
    input: "我是枕水江南连锁品牌方，做中式快餐招商加盟，目标加盟商是有餐饮经验、准备开店的创业者；现有直营样板店、标准化产品和供应链、培训与运营支持；希望对方私信‘加盟’领取资料包并预约考察。给我写下招商获客短视频文案。"
  }, provider);

  const franchiseRequired = [
    "品牌信息",
    "枕水江南",
    "中式快餐",
    "一、选题策划",
    "二、口播逐字稿",
    "三、拍摄脚本",
    "B-roll",
    "四、拍摄注意事项",
    "五、剪辑EDL",
    "六、发布标题与话题",
    "七、最佳发布时间",
    "八、评论区引导话术",
    "九、投流建议"
  ];
  const franchiseMissing = franchiseRequired.filter((term) => !franchise.answer.includes(term));
  const copiedDemoFacts = ["山东的", "培训3天", "培训三天", "流水直接干到15万", "毛利60%", "纯利2.5万", "纯利两万五", "9300元/月"]
    .filter((term) => franchise.answer.includes(term));
  if (franchiseMissing.length > 0 || copiedDemoFacts.length > 0) {
    throw new Error(`招商黄金样板回归失败。缺少：${franchiseMissing.join("、")}；复制演示事实：${copiedDemoFacts.join("、")}\n${franchise.answer}`);
  }

  const shooting = await runAgent({
    ...base,
    capabilityId: "shooting_editing",
    input: [
      "给这条77视频做下拍摄剪辑优化建议。",
      "【本次用户上传/粘贴的附件】",
      "附件1：77.mp4",
      "基础信息：视频文件77.mp4，28.77秒，720x1280。",
      "【业务文件解析结果】",
      "关键帧：已抽取14帧。",
      "画面解析：女性正面近景出镜，背景可见钢琴，首屏大字为‘90%的人都听得出哪句跑调’，画面有中英字幕。",
      "语音/字幕转写：我来清唱两句，天上的星星，来猜一猜吧，你能学得会就说明听辨正确。",
      "客户主体：王思瑶，声乐老师。",
      "发布平台：抖音"
    ].join("\n")
  }, provider);

  const shootingRequired = [
    "视频基本信息",
    "77.mp4",
    "28.77秒",
    "现有版本诊断",
    "一、优化版选题定位",
    "二、优化版口播逐字稿",
    "三、优化版拍摄脚本",
    "B-roll",
    "四、拍摄注意事项",
    "五、优化版剪辑EDL",
    "六、优化版发布策略",
    "七、投流建议",
    "八、核心改进点"
  ];
  const shootingMissing = shootingRequired.filter((term) => !shooting.answer.includes(term));
  const shootingViolations = [
    shooting.answer.includes("50-60秒") ? "复制样板错误时长" : "",
    /仅靠手机内置麦/.test(shooting.answer) ? "无证据断言手机内置麦" : "",
    /(?:提升|预估)[+＋]?(?:\d+%|\d+pp|\d+倍)/.test(shooting.answer) && !/(?:待验证|验证指标|测试目标)/.test(shooting.answer) ? "无证据承诺提升" : ""
  ].filter(Boolean);
  if (shootingMissing.length > 0 || shootingViolations.length > 0) {
    throw new Error(`拍剪黄金样板回归失败。缺少：${shootingMissing.join("、")}；违规：${shootingViolations.join("、")}\n${shooting.answer}`);
  }

  console.log("CONTENT_GOLDEN_SAMPLES_REGRESSION_OK");
  console.log(`franchise_length=${franchise.answer.length}`);
  console.log(`shooting_length=${shooting.answer.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

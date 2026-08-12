import { runAgent } from "../packages/agent/src/index.js";

const baseRequest = {
  tenantId: "paid-traffic-upload-smoke",
  userId: "qa-user",
  role: "owner" as const,
  planCode: "chain_standard" as const,
  tenantProfile: {
    tenantId: "paid-traffic-upload-smoke",
    tenantName: "鲁蒙肉饼",
    tenantType: "chain_brand" as const,
    businessMemory: {
      industry: "中式快餐连锁",
      product: "鲁蒙肉饼招商加盟"
    }
  },
  channel: "h5" as const
};

const throwingProvider = {
  name: "paid-traffic-upload-smoke-fallback",
  async complete() {
    throw new Error("force_paid_traffic_fallback");
  }
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const douPlus = await runAgent({
    ...baseRequest,
    requestedSkillId: "dou_plus_ads" as const,
    capabilityId: "dou_plus_traffic",
    input: "请分析这份DOU+投放数据并给下一轮建议。预算500元，目标是企业客户私信留资；当前数据：播放12000、5秒完播率38%、主页访问260、私信18、有效留资4。"
  }, throwingProvider);

  const requiredDouPlusSections = [
    "DOU+投放结论",
    "视频/账号与目标核验",
    "官方资料状态与规则边界",
    "证据与诊断假设",
    "素材测试与投放设置预览",
    "监控指标与观察条件",
    "止损与回退",
    "PREVIEW_ONLY",
    "风险与待补信息"
  ];
  assert(requiredDouPlusSections.every((section) => douPlus.answer.includes(section)), "DOU+兜底报告缺少标准模块");
  assert(douPlus.answer.includes("500"), "DOU+兜底报告没有继承用户预算");
  assert(douPlus.answer.includes("私信") && douPlus.answer.includes("留资"), "DOU+兜底报告没有继承转化目标");

  const localPush = await runAgent({
    ...baseRequest,
    requestedSkillId: "optimize_local_push_ads" as const,
    capabilityId: "paid_traffic",
    input: "这是本地推投放数据文件解析结果：消耗800元，曝光56000，点击2100，到店核销32单，成交额3200元。请复盘并给下一轮预算、素材和止损建议。"
  }, throwingProvider);

  assert(localPush.answer.length >= 400, "本地推兜底报告过短");
  assert(/本地推|投放/.test(localPush.answer), "本地推兜底报告场景错配");
  assert(/预算|消耗/.test(localPush.answer) && /止损|回退/.test(localPush.answer), "本地推兜底报告缺少预算或止损建议");

  console.log("paid-traffic-upload-smoke: PASS");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

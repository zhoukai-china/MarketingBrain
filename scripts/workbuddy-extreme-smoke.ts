process.env.NODE_ENV = "test";
process.env.DATA_MODE = "demo";
process.env.IP_AGENT_PRIMARY_TIMEOUT_MS = "80";
process.env.IP_AGENT_REPAIR_TIMEOUT_MS = "50";

type ExtremeCase = {
  id: number;
  name: string;
  requestedSkillId: string;
  capabilityId?: string;
  input: string;
  requiredTerms: string[];
  forbiddenTerms?: string[];
  deliveryPolicy?: "clarify" | "draft_with_placeholders";
};

async function main() {
  const { runAgent } = await import("../packages/agent/src/index.js");
  const cases: ExtremeCase[] = [
    {
      id: 1,
      name: "信息混杂的抖音获客诊断",
      requestedSkillId: "baolu_content_creator",
      capabilityId: "content_plan",
      input: "我是大连一家烤肉店老板，3家门店，想做抖音获客但不知道从哪下手。抖音号做了2个月发了20多条视频，每条播放500-2000，3000粉。有人说内容太像广告，也有人说后厨烤肉很真实。评论区经常有人问价格地址，但真到店好像就一两个。美团评分4.3，每个月美团来的大概30桌，午餐写字楼白领多，但晚餐上座率只有40%。要不要找达人拍探店？",
      requiredTerms: ["短结论", "内容链路的三个卡点", "今天就做 3 件事", "边界说明", "下一步"],
      forbiddenTerms: ["保证到店", "保证爆", "稳赚"],
      deliveryPolicy: "draft_with_placeholders"
    },
    {
      id: 2,
      name: "抗拒出镜且反感套话",
      requestedSkillId: "baolu_content_creator",
      capabilityId: "content_plan",
      input: "我实在不想拍视频，站镜头前就说不出来话。员工也不愿意露脸。别给空泛鼓励，给我不露脸也能做餐饮内容的真办法。",
      requiredTerms: ["三种不露脸方案", "方案一", "方案二", "方案三", "今天就做 3 件事", "下一步"],
      deliveryPolicy: "draft_with_placeholders"
    },
    {
      id: 3,
      name: "一句话要求写文案",
      requestedSkillId: "baolu_content_creator",
      capabilityId: "content_plan",
      input: "帮我写个文案。",
      requiredTerms: ["主推产品/服务", "咨询入口或产品形式", "第一批目标客户", "按序号回复即可"],
      deliveryPolicy: "clarify"
    },
    {
      id: 4,
      name: "要求十个爆款选题",
      requestedSkillId: "baolu_topics",
      capabilityId: "topic_inspiration",
      input: "给我10个能爆的选题，不要枯燥。我在上海做轻食品牌内容，主要面向陆家嘴白领，客单价45。半年抖音没起色，做过沙拉过程但没人看。",
      requiredTerms: ["四大来源", "三关筛选", "TOP10", "待验证"],
      forbiddenTerms: ["保证爆", "外卖订单优化"]
    },
    {
      id: 5,
      name: "模糊数据复盘与抱怨",
      requestedSkillId: "baolu_review_engine",
      capabilityId: "video_review",
      input: "最近视频数据太差。上个月两条视频点赞一条3000多，另一条2000多，但没人问价也没人到店；其他视频几十赞、几百播放。我投了1000块DOU+也没效果，感觉被割韭菜。我到底问题出在哪？",
      requiredTerms: ["短结论", "数据", "下一条怎么改", "待补"],
      forbiddenTerms: ["平台割韭菜", "保证效果"]
    },
    {
      id: 6,
      name: "说不清目标的朋友圈",
      requestedSkillId: "moments_generator",
      capabilityId: "moments_private",
      input: "朋友圈你帮我发几条吧，我也不知道该发啥。有时候转公众号，有时候发店里菜，没人互动，想让客人多来。",
      requiredTerms: ["朋友圈私域方案", "今日朋友圈策略", "信任型朋友圈", "场景型朋友圈", "成交型朋友圈", "发布前检查"]
    },
    {
      id: 7,
      name: "零经验直播且害怕尴尬",
      requestedSkillId: "live_script_planner",
      capabilityId: "live_script",
      input: "烤肉店想直播卖团购券但完全没经验，对着手机尴尬，没人看更尴尬。请给能照着做的90分钟灶台直播方案，目标先稳定50人观看。",
      requiredTerms: ["直播", "90", "话术", "下一步"],
      forbiddenTerms: ["保证50人", "保证收益"],
      deliveryPolicy: "draft_with_placeholders"
    },
    {
      id: 8,
      name: "小预算投流且历史效果差",
      requestedSkillId: "baolu_content_creator",
      capabilityId: "paid_traffic",
      input: "一个月最多500块投流。前两个月投了800块本地推，只来了3桌客人，成本接近300一桌。现在美团推广通每月200块。到底哪里不对？",
      requiredTerms: ["投流判断", "素材A/B", "预算与节奏", "止损条件", "合规提醒", "执行草案"],
      forbiddenTerms: ["保证到店", "保证回本"]
    },
    {
      id: 9,
      name: "招商咨询与合规边界",
      requestedSkillId: "baolu_content_creator",
      capabilityId: "franchise_acquisition",
      input: "沈阳有7家直营店，每家月营收约15-20万，想做全国招商加盟。有人打电话问却聊不下去。给我一套合规的招商视频方向和邀约到店对话，不要承诺收益。",
      requiredTerms: ["合规", "待核实", "邀约", "下一步"],
      deliveryPolicy: "draft_with_placeholders"
    },
    {
      id: 10,
      name: "质疑AI只会套话",
      requestedSkillId: "general_qa",
      input: "AI不了解我的店、不了解客人，也不知道产品好不好。你怎么保证不是一堆通用模板？你自己就是AI，有什么资格说别的AI不行？",
      requiredTerms: ["质疑是对的", "它能做的是三件可验证的事", "它不能替你做的事", "怎么避免套话", "下一步"]
    }
  ];

  const failures: string[] = [];
  for (const item of cases) {
    const result = await runAgent(
      {
        tenantId: "workbuddy-extreme",
        userId: "workbuddy-extreme",
        role: "owner",
        planCode: "local_standard",
        requestedSkillId: item.requestedSkillId as any,
        capabilityId: item.capabilityId as any,
        input: item.input,
        tenantProfile: {
          tenantId: "workbuddy-extreme",
          tenantName: "大连烤肉测试店",
          tenantType: "local_business",
          industry: "餐饮",
          city: "大连"
        },
        channel: "h5",
        deliveryPolicy: item.deliveryPolicy
      },
      {
        name: `workbuddy-extreme-${item.id}`,
        async complete() {
          throw new Error("force_deterministic_extreme_fallback");
        }
      }
    );
    const missing = item.requiredTerms.filter((term) => !result.answer.includes(term));
    const forbidden = (item.forbiddenTerms ?? []).filter((term) => result.answer.includes(term));
    if (missing.length || forbidden.length) {
      failures.push(`${item.id}. ${item.name}: 缺少=${missing.join("、") || "无"}；越界=${forbidden.join("、") || "无"}`);
      console.error(`FAIL OUTPUT ${item.id}/10 ${item.name}\n${result.answer}\n---`);
      continue;
    }
    console.log(`PASS ${item.id}/10 ${item.name} | ${result.skillId}/${result.analysisMode}`);
  }
  if (failures.length) {
    console.error("WorkBuddy 十项极限测试失败：\n" + failures.join("\n"));
    process.exit(1);
  }
  console.log("WorkBuddy 十项极限测试全部通过。");
}

void main();

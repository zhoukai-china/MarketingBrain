import {
  BEAUTY_DAILY_BRIEF_SECTIONS,
  type BeautyDailyBriefReport,
  type BeautyDailyBriefSourceCandidate
} from "./daily-brief-contract.js";

const SECTION_FOCUS = {
  模型动态: "门店可验证的模型能力边界与人工复核流程",
  产品发布: "美业门店数字工具的功能变化与使用条件",
  行业风云: "美业经营环境、平台规则与合规信息变化",
  企业改造案例: "连锁与单店采用数字工具后的流程改造方法",
  趋势洞察: "顾客需求、内容渠道和门店组织能力的变化线索"
} as const;

export function buildControlledBeautyDailyBriefSources(cutoffAt: Date, ageHours: number[] = [2, 5, 8]): BeautyDailyBriefSourceCandidate[] {
  return BEAUTY_DAILY_BRIEF_SECTIONS.flatMap((section, sectionIndex) => ageHours.map((age, itemIndex) => {
    const ordinal = sectionIndex * 3 + itemIndex + 1;
    const focus = SECTION_FOCUS[section];
    return {
      section,
      source: `合成公开来源${ordinal}`,
      title: `${section}合成核验条目${ordinal}：${focus}`,
      summary: `这是一条完全合成的美业日报验收资料，用于检查${focus}是否能按照固定版块、真实日期和来源状态进入结果。内容不对应任何人物、品牌、顾客、门店或经营事实，也不能作为实时资讯传播。`,
      sourceFacts: [`合成条目${ordinal}只用于核验${focus}的合同结构`, "该条目不对应任何真实新闻或经营结果"],
      sourceIndustry: "通用AI" as const,
      sourceLabel: "合成验收来源",
      sitongComment: `门店经营者只应把这条资料用于验证页面流程与合同结构；正式使用时必须回到可访问来源核对日期、事实和适用边界，再决定是否形成当天行动。`,
      inferenceLabel: "beauty_interpretation" as const,
      possibleImpact: "若正式来源证实相关能力可用，美业门店可考虑先用非敏感资料做小范围流程验证。",
      applicabilityConditions: ["只适用于已完成权限与数据边界核对的门店流程"],
      verificationNeeded: ["正式使用前核验来源、产品能力、费用与当前门店适用条件"],
      sourceUrl: `https://beauty-daily-fixtures.invalid/source-${ordinal}`,
      publishedAt: new Date(cutoffAt.getTime() - age * 60 * 60 * 1000).toISOString(),
      verificationStatus: itemIndex === 2 ? "trend_observation" : "verified_hotspot",
      beautySegments: ["全美业", itemIndex === 0 ? "生活美容" : itemIndex === 1 ? "美甲美睫" : "皮肤管理"],
      reachable: true,
      authoritative: true,
      contentMatchesSource: true
    };
  }));
}

export function controlledBeautyDailyBriefTrends(): BeautyDailyBriefReport["trends"] {
  return [1, 2, 3].map((index) => ({
    title: `合成趋势观察${index}`,
    evidence: "仅由本轮合成来源夹具支持，不代表真实行业趋势。",
    action: "检查真实来源和当前门店适用条件后，再决定是否进入行动清单。"
  }));
}

export function controlledBeautyDailyBriefAction(): BeautyDailyBriefReport["todayAction"] {
  return {
    title: "完成一条来源核验练习",
    why: "受控验收只验证合同和页面恢复，不替代真实经营判断。",
    steps: ["打开一条合成来源记录", "核对日期与状态字段", "确认页面没有把测试结果标为实时资讯"]
  };
}

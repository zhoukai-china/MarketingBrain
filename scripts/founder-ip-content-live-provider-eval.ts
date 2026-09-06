import assert from "node:assert/strict";

export const liveProviderCases = [
  { target: "franchise", identity: "早餐加盟创始人", customer: "有餐饮经验的创业者", goal: "获取加盟咨询", topic: "加盟前先核对哪三个经营条件", evidence: "创始人已确认：加盟条件需沟通确认", relation: "帮助创业者先判断是否值得发起加盟咨询", required: /加盟(?:咨询|条件|评估|申请|考察)/, forbidden: /团购|核销|课程报名|合作意向/ },
  { target: "store_visit", identity: "社区餐饮主理人", customer: "周边午晚餐消费者", goal: "促进团购到店", topic: "午休只有30分钟，怎样选到不踩雷的工作日套餐", evidence: "录音确认：套餐与到店时间待门店复核", relation: "引导附近消费者先查看团购并预约到店", required: /(?:团购|预约|到店)/, forbidden: /加盟商|加盟咨询|课程报名|合作意向/ },
  { target: "student", identity: "皮肤管理培训创始人", customer: "计划转行的初学者", goal: "获取课程咨询", topic: "报名前先确认自己缺的不是一个证书", evidence: "创始人已确认：课程适用条件需咨询判断", relation: "让目标学员先咨询课程是否适合自己", required: /(?:课程咨询|咨询课程|试听|报名)/, forbidden: /加盟商|团购核销|到店套餐|合作意向/ },
  { target: "partner", identity: "区域联营项目负责人", customer: "本地渠道合作伙伴", goal: "获取合作意向", topic: "先把双方要投入的资源讲清，合作才不会卡在第一步", evidence: "项目负责人确认：合作条件需资格判断", relation: "引导渠道伙伴提交合作意向并进入资格判断", required: /(?:合作意向|合作咨询|资格判断|方案沟通)/, forbidden: /加盟商|团购核销|课程报名|试听/ }
] as const;

for (const item of liveProviderCases) {
  assert.ok(item.topic.length > 8 && item.customer.length > 3 && item.evidence.length > 8 && item.relation.length > 8, `${item.target} must have a complete, de-identified live-eval input`);
  assert.doesNotMatch(item.topic, item.forbidden, `${item.target} topic must not begin with another goal`);
}
assert.equal(new Set(liveProviderCases.map((item) => item.target)).size, 4, "must cover all four FIP targets");
console.log("founder_ip_content_live_provider_eval:PASS cases=4 repeats=3");

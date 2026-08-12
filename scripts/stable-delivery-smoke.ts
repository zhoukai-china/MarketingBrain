import assert from "node:assert/strict";
import {
  buildStableAgentDelivery,
  resolveReasoningProfile
} from "../apps/api/src/services/structured-delivery.js";

const fixtures = {
  topic_inspiration: `选题系统交付

一、来源与证据
行业搜索趋势与用户评论是当前证据，未确认信息标记为待核验。

二、三关筛选后的 TOP 10 选题
1. 新手最容易忽略的三个问题
2. 预算有限时先做什么
3. 用户真实案例拆解
4. 常见误区
5. 成本对比
6. 决策清单
7. 一天工作流
8. 失败案例
9. 工具实测
10. 下月趋势

三、待验证动作与证据边界
先小样测试点击与收藏，再决定是否进入内容生产。`,
  content_plan: `内容系统交付

一、选题与核心承诺
围绕预算有限时的第一步，提供可执行结论。

二、口播文案
开头提出痛点，中段给出三步方法，结尾提示评论关键词。

三、拍摄分镜
近景开场、屏幕演示、结果对比三个镜头。

四、发布标题
预算有限，先把这一步做对。

五、评论私信承接
评论“清单”获取资料，私信继续承接需求。`,
  paid_traffic: `投流系统交付

一、投流判断
当前建议小预算测试，不直接放量。

二、投放目标
以有效私信成本为主要目标。

三、素材 A/B 测试
A 版本强调成本，B 版本强调结果。

四、预算与监控指标
首轮预算 300 元，监控点击率、私信率与有效线索成本。

五、止损与复盘
连续两日成本超过目标 30% 时止损，并按素材、受众复盘。

六、执行草案
先跑 48 小时，达标后每次放量不超过 30%。`,
  video_review: `复盘系统交付

一、数据质量审计
播放与互动口径一致，成交归因仍需补充，属于待验证项。

二、数据总览
本周期发布 12 条，完播率上升，私信率持平。

三、视频分层
3 条高潜、6 条稳定、3 条待优化。

四、趋势与证据
开头直接展示结果的视频表现更好，但样本不足，暂不做因果结论。

五、下周期动作
下一轮复用高潜开头，同时验证两种承接话术。`
} as const;

assert.equal(resolveReasoningProfile("topic_inspiration"), "standard");
assert.equal(resolveReasoningProfile("content_plan"), "standard");
assert.equal(resolveReasoningProfile("paid_traffic"), "deep");
assert.equal(resolveReasoningProfile("video_review"), "deep");

for (const [capabilityId, answerText] of Object.entries(fixtures)) {
  const delivery = buildStableAgentDelivery({ capabilityId, answerText });
  assert.ok(delivery, `${capabilityId} should produce a stable delivery`);
  assert.equal(delivery.validation.status, "valid", `${capabilityId}: ${delivery.validation.issues.join(",")}`);
  assert.ok(delivery.blocks.length >= 3, `${capabilityId} should have at least three cards`);
  assert.ok(delivery.blocks.every((block) => block.id && block.title && block.content));
}

const contaminated = buildStableAgentDelivery({
  capabilityId: "paid_traffic",
  answerText: `${fixtures.paid_traffic}\n\n七、口播逐字稿\n大家好，今天教你怎么拍。`
});
assert.ok(contaminated);
assert.equal(contaminated.validation.status, "degraded");
assert.ok(contaminated.validation.issues.includes("cross_capability_content"));

const unstructured = buildStableAgentDelivery({
  capabilityId: "video_review",
  answerText: "数据不错，建议继续做。"
});
assert.ok(unstructured);
assert.equal(unstructured.validation.status, "degraded");
assert.ok(unstructured.validation.issues.includes("unstructured_answer"));

console.log("stable delivery smoke: ok");

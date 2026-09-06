import assert from "node:assert/strict";
import { inspectQuality } from "../packages/agent/src/index.js";
import { loadSkillQualityContract } from "../packages/skills/src/index.js";
import { buildBeautyIndustryRunInput, type BeautyIndustryProfile } from "../apps/api/src/products/beauty-industry/profile.js";
import { applyBeautyTopicVerifiedBrief, evaluateBeautyTopicEvidence } from "../apps/api/src/products/beauty-industry/topic-evidence.js";
import { buildBeautyWorkflowPrompt } from "../apps/api/src/products/beauty-industry/workflows.js";
import { assertBeautyWorkflowRuntimeResult } from "../apps/api/src/products/beauty-industry/output-contract.js";

const profile: BeautyIndustryProfile = {
  segment: "skin_management",
  operationType: "single_store",
  operatingStage: "growth",
  services: ["基础清洁", "日常补水护理"],
  targetCustomers: "附近重视日常护理体验、担心强推销的顾客",
  channels: ["抖音"],
  factBoundaries: "不编造疗效、价格、案例或顾客反馈",
  source: "user_confirmed",
  confirmationStatus: "confirmed",
  version: 1,
  confirmedAt: "2026-08-25T00:00:00.000Z"
};

const workflow = {
  identity: "本店",
  targetCustomer: "附近重视日常护理体验、担心强推销的顾客",
  acquisitionGoal: "获得真实私信咨询并引导到店了解",
  offer: "日常补水护理",
  accountStage: "增长期",
  industry: "皮肤管理",
  benchmarkAccounts: ["同城公开账号待核验"],
  transcriptDocumentIds: [],
  sourceSelection: {
    industry: true,
    benchmark: true,
    transcript: false,
    videoReview: false
  }
} as const;

const evidence = evaluateBeautyTopicEvidence({
  profileIndustry: "皮肤管理",
  workflow,
  documents: [],
  videoReview: null
});

const userSource = buildBeautyIndustryRunInput({
  question: [
    `为${workflow.identity}面向${workflow.targetCustomer}生成视频选题。`,
    `本轮获客目标：${workflow.acquisitionGoal}。`,
    `本轮项目：${workflow.offer}。`,
    "严格使用当前四来源状态，先形成候选并完成三关筛选，最终交付TOP10。"
  ].join("\n"),
  profile,
  mode: "professional",
  topicEvidenceContext: evidence.directive
});

const rows = Array.from({ length: 10 }, (_, index) => {
  const number = index + 1;
  return `| ${number} | 日常补水护理前，顾客最想先确认什么？${number} | 认知型 | 行业与用户热点 | 待核验：未提供实时热点证据 | 利益共识 | ★★★☆☆ | 增长期 | 围绕真实流程解释，不承诺疗效 | 做成一条知识型短视频 |`;
}).join("\n");

const answer = [
  "# 选题系统 · 四大来源三关筛选",
  "## 本轮主体与目标",
  "服务主体：本店；目标用户：门店周边关注基础护理体验、抗拒强推销的人；本轮获客目标：获得有效私信并承接到店咨询；本轮项目：日常补水护理；账号阶段：增长期。",
  "## 四大来源自动采集结果",
  "| 来源 | 采集状态 | 证据摘要 | 内部候选贡献 |",
  "|---|---|---|---:|",
  "| 私有知识与客户问题 | 待补 | 本轮没有合格录音或客户问题资料 | 0 |",
  "| 行业与用户热点 | 待核验 | 已确认皮肤管理赛道，但没有实时热点证据 | 4 |",
  "| 自身账号数据复盘 | 待补 | 本轮没有已解析账号数据 | 0 |",
  "| 同行与对标内容 | 待核验 | 有同城公开账号线索，尚未读取作品互动证据 | 3 |",
  "## 三关筛选说明",
  "第一关证据：区分已验证与待核验；第二关标注共识层级和客资准度；第三关按适用阶段排序。",
  "## 三关筛选后的TOP10",
  "| # | 最终选题 | 类型 | 来源 | 第一关证据 | 共识层级 | 客资准度 | 适用阶段 | 创作建议 | 下一步生成内容 |",
  "|---:|---|---|---|---|---|---|---|---|---|",
  rows,
  "## 配比调整建议",
  "增长期先验证认知型与信任型内容，依据真实完播、评论和私信再调整。",
  "## 待验证动作与证据边界",
  "未提供的录音、账号数据、热点、价格、疗效、案例和顾客反馈均保持待补，不声称已经读取。"
].join("\n\n");

async function main() {
  const workflowPrompt = await buildBeautyWorkflowPrompt("topic_inspiration");
  assert.match(
    workflowPrompt.prompt,
    /目标用户、账号阶段和本轮获客目标[^\n]*逐字保留服务端核验值/,
    "topic workflow must prevent semantic paraphrase from triggering the fact-retention postflight"
  );
  const qualityContract = await loadSkillQualityContract("baolu_topics");
  assert.ok(qualityContract, "baolu_topics quality contract must exist");

  const flags = inspectQuality(
    answer,
    "baolu_topics",
    qualityContract,
    [
      { role: "system", content: "【固定美业能力】选题系统；capabilityLocked=true。" },
      { role: "user", content: userSource }
    ],
    "topic_inspiration"
  );

  assert.equal(
    flags.includes("rubric_fact_retention_weak"),
    false,
    `a formal four-source beauty topic delivery retained the explicit target and goal but was rejected: ${flags.join(",")}`
  );
  assert.equal(flags.some((flag) => /scene_mismatch|missing_contract_terms|wrong_|cross_industry/.test(flag)), false, flags.join(","));

  const normalized = applyBeautyTopicVerifiedBrief({
    answerText: answer.replace("目标用户：门店周边关注基础护理体验、抗拒强推销的人", "目标用户：附近关注护理的人"),
    qualityFlags: ["rubric_fact_retention_weak"]
  }, workflow);
  assert.match(normalized.answerText, new RegExp(`目标用户：${workflow.targetCustomer}`));
  assert.match(normalized.answerText, new RegExp(`账号阶段：${workflow.accountStage}`));
  assert.match(normalized.answerText, new RegExp(`本轮获客目标：${workflow.acquisitionGoal}`));
  assert.match(normalized.answerText, new RegExp(`细分赛道：${workflow.industry}`));
  assert.equal(normalized.qualityFlags.includes("rubric_fact_retention_weak"), false);
  assert.equal(normalized.qualityFlags.includes("beauty_topic_verified_brief_applied"), true);

  const validHandoffAnswer = `${normalized.answerText}\n\n下一步：选中选题后进入内容系统再生成口播逐字稿、拍摄脚本和剪辑EDL；本页没有生成这些内容。`;
  await assertBeautyWorkflowRuntimeResult({
    capabilityId: "topic_inspiration",
    expectedSkillId: "baolu_topics",
    expectedSkillVersion: workflowPrompt.version,
    result: {
      capabilityId: "topic_inspiration",
      skillId: "baolu_topics",
      skillVersion: workflowPrompt.version,
      answerText: validHandoffAnswer,
      deliveryStatus: "completed",
      qualityFlags: [],
      creditCost: 8
    },
    observedProviderOutputs: [validHandoffAnswer],
    replay: false
  });

  await assert.rejects(
    () => assertBeautyWorkflowRuntimeResult({
      capabilityId: "topic_inspiration",
      expectedSkillId: "baolu_topics",
      expectedSkillVersion: workflowPrompt.version,
      result: {
        capabilityId: "topic_inspiration",
        skillId: "baolu_topics",
        skillVersion: workflowPrompt.version,
        answerText: `${normalized.answerText}\n\n## 拍摄脚本\n镜头一：直接开始拍摄。`,
        deliveryStatus: "completed",
        qualityFlags: [],
        creditCost: 8
      },
      observedProviderOutputs: [`${normalized.answerText}\n\n## 拍摄脚本\n镜头一：直接开始拍摄。`],
      replay: false
    }),
    /beauty_workflow_output_contract_failed:forbidden_拍摄脚本/
  );

  console.log("beauty_industry_topic_fact_retention_p1_smoke:PASS");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

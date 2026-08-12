import { runAgent } from "../packages/agent/src/index.js";

const provider = {
  name: "personal-ip-entity-semantics-test",
  async complete() {
    throw new Error("force_deterministic_semantic_fallback");
  }
};

const tenantProfile = {
  tenantId: "baolu-personal-ip-regression",
  tenantName: "保禄",
  tenantType: "personal_ip" as const,
  industry: "企业AI重构",
  city: "大连",
  data: {
    offer: "企业AI重构服务",
    customer: "希望用AI重构获客和经营流程的传统企业老板",
    identityContext: "保禄是本人姓名，也是个人IP名称，不是产品、商品或套餐。",
    businessGoal: "获得企业AI重构咨询线索"
  }
};

const facts = [
  "【选题系统自动运行】",
  "本轮主体：保禄",
  "本人姓名：保禄",
  "个人IP名称：保禄",
  "主体角色：本人出镜的个人IP",
  "核心产品/服务：企业AI重构服务",
  "目标客户：希望用AI重构获客和经营流程的传统企业老板",
  "发布平台：抖音、视频号、小红书",
  "转化目标：获得企业AI重构咨询线索",
  "请自动扫描四大来源并通过三关筛选生成10条选题。"
].join("\n");

function assertNoNameAsProduct(answer: string, label: string) {
  const forbidden = [
    /选择保禄/,
    /购买保禄/,
    /使用保禄/,
    /执行保禄/,
    /采用保禄/,
    /做保禄(?:之前|之后|前|后|时|是否)/,
    /了解保禄(?:之前|之后|以前|以后|前|后)/,
    /保禄(?:产品|商品|套餐|案例应该|的客户为什么)/
  ];
  const leaked = forbidden.find((pattern) => pattern.test(answer));
  if (leaked) throw new Error(`${label}:个人IP名称被当成业务对象:${leaked}\n${answer}`);
}

async function main() {
  const topics = await runAgent({
    tenantId: tenantProfile.tenantId,
    userId: "baolu-personal-ip-user",
    role: "owner",
    planCode: "ip_standard",
    input: facts,
    routingInput: "启动选题系统",
    requestedSkillId: "baolu_topics",
    capabilityId: "topic_inspiration",
    capabilityLocked: true,
    deliveryPolicy: "draft_with_placeholders",
    tenantProfile,
    channel: "workbench"
  }, provider);

  for (const term of [
    "服务主体：保禄",
    "主体角色：个人IP/内容发布者（不是商品或服务名称）",
    "选题业务对象：企业AI重构服务",
    "三关筛选后的TOP10"
  ]) {
    if (!topics.answer.includes(term)) throw new Error(`topic_missing:${term}\n${topics.answer}`);
  }
  assertNoNameAsProduct(topics.answer, "topics");

  const content = await runAgent({
    tenantId: tenantProfile.tenantId,
    userId: "baolu-personal-ip-user",
    role: "owner",
    planCode: "ip_standard",
    input: `${facts}\n请写一条解释企业AI重构为什么要先梳理流程的短视频内容。`,
    routingInput: "企业AI重构短视频内容",
    requestedSkillId: "baolu_content_creator",
    capabilityId: "content_plan",
    capabilityLocked: true,
    deliveryPolicy: "draft_with_placeholders",
    tenantProfile,
    channel: "workbench"
  }, provider);
  assertNoNameAsProduct(content.answer, "content");
  if (!/企业AI(?:重构|改造|服务)/.test(content.answer)) {
    throw new Error(`content_business_missing\n${content.answer}`);
  }

  console.log(JSON.stringify({
    passed: true,
    topicSkillVersion: topics.skillVersion,
    topicQualityFlags: topics.qualityFlags,
    contentSkillVersion: content.skillVersion,
    contentQualityFlags: content.qualityFlags
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

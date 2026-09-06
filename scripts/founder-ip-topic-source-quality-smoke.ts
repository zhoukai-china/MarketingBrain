import assert from "node:assert/strict";
import { runAgent } from "../packages/agent/src/index.ts";

const provider = {
  name: "founder-ip-topic-source-quality-fallback",
  async complete(): Promise<string> {
    throw new Error("force_founder_ip_topic_source_quality_fallback");
  }
};

const base = {
  tenantId: "fip-topic-source-quality-a",
  userId: "fip-topic-source-quality-user",
  role: "owner" as const,
  planCode: "ip_standard" as const,
  requestedSkillId: "baolu_topics" as const,
  capabilityId: "topic_inspiration",
  deliveryPolicy: "draft_with_placeholders" as const,
  channel: "workbench" as const,
  tenantProfile: {
    tenantId: "fip-topic-source-quality-a",
    tenantName: "脱敏创始人IP验收主体",
    tenantType: "personal_ip" as const,
    industry: "连锁餐饮加盟服务"
  }
};

const sharedBrief = [
  "【选题系统自动运行】【选题系统四源运行】",
  "本轮服务主体：脱敏创始人IP验收主体",
  "【本轮创始人IP获客目标简报】",
  "获客目标：招商加盟",
  "创始人身份/项目：连锁餐饮加盟顾问",
  "目标人群：准备评估餐饮加盟项目的城市合伙人",
  "本轮线索目标：获取加盟咨询",
  "主推项目/真实承接：加盟诊断沟通",
  "账号与内容阶段：稳定更新期",
  "本轮明确行业：连锁餐饮加盟服务"
];

const sourceCases = [
  {
    name: "industry",
    anchor: "门店明厨巡检新规",
    input: [
      ...sharedBrief,
      "【来源一｜行业热点】已选择。热点1：门店明厨巡检新规｜日期：2026-08-14｜来源：权威行业公告｜https://example.com/hotspot",
      "【来源二｜对标账号】本轮未选择。",
      "【来源三｜AI录音卡】本轮未选择。",
      "【来源四｜自己账号真实数据复盘】本轮未选择。"
    ].join("\n")
  },
  {
    name: "benchmark",
    anchor: "门店巡检回应加盟疑问",
    input: [
      ...sharedBrief,
      "【来源一｜行业热点】本轮未选择。",
      "【来源二｜对标账号】已选择。对标账号：陈厂长；对标线索1：门店巡检回应加盟疑问｜来源：陈厂长公开主页｜日期：2026-08-14｜互动数据待核验｜https://example.com/benchmark",
      "【来源三｜AI录音卡】本轮未选择。",
      "【来源四｜自己账号真实数据复盘】本轮未选择。"
    ].join("\n")
  },
  {
    name: "recording",
    anchor: "交了钱没有陪跑",
    input: [
      ...sharedBrief,
      "【来源一｜行业热点】本轮未选择。",
      "【来源二｜对标账号】本轮未选择。",
      "【来源三｜AI录音卡】已选择。录音转写：客户原话：加盟商最怕交了钱没有陪跑，先看真实门店巡检记录，再谈合作条件。",
      "【来源四｜自己账号真实数据复盘】本轮未选择。"
    ].join("\n")
  },
  {
    name: "review",
    anchor: "门店巡检现场类视频完播更高",
    input: [
      ...sharedBrief,
      "【来源一｜行业热点】本轮未选择。",
      "【来源二｜对标账号】本轮未选择。",
      "【来源三｜AI录音卡】本轮未选择。",
      "【来源四｜自己账号真实数据复盘】已选择。复盘结论：门店巡检现场类视频完播更高，纯口号类视频应放弃或降频；仅为脱敏验收数据。"
    ].join("\n")
  }
] as const;

function assertUsableTopicOutput(answer: string): void {
  const required = ["选题/钩子", "目标人群", "核心观点/内容角度", "来源依据", "与获客目标的关系", "下一步生成内容", "三关筛选后的TOP10", "待验证动作与证据边界"];
  for (const term of required) assert.ok(answer.includes(term), `missing required topic field: ${term}\n${answer}`);
  assert.equal(answer.split("\n").filter((line) => /^\|\s*(?:[1-9]|10)\s*\|/.test(line)).length, 10, `must output exactly ten topic rows\n${answer}`);
  assert.doesNotMatch(answer, /四维评分|综合分/, `retired scoring must not reappear\n${answer}`);
}

async function generate(input: string): Promise<string> {
  const result = await runAgent({ ...base, input }, provider);
  assert.equal(result.skillId, "baolu_topics");
  return result.answer;
}

async function main(): Promise<void> {
  for (const sourceCase of sourceCases) {
    const answer = await generate(sourceCase.input);
    assertUsableTopicOutput(answer);
    assert.ok(answer.includes(sourceCase.anchor), `${sourceCase.name} evidence must materially change the generated topics instead of only changing source status\n${answer}`);
  }

  const combined = await generate([
    ...sharedBrief,
    "【来源一｜行业热点】已选择。热点1：门店明厨巡检新规｜日期：2026-08-14｜来源：权威行业公告｜https://example.com/hotspot",
    "【来源二｜对标账号】已选择。对标账号：陈厂长；对标线索1：门店巡检回应加盟疑问｜来源：陈厂长公开主页｜日期：2026-08-14｜互动数据待核验｜https://example.com/benchmark",
    "【来源三｜AI录音卡】本轮未选择。",
    "【来源四｜自己账号真实数据复盘】已选择。复盘结论：门店巡检现场类视频完播更高，纯口号类视频应放弃或降频；仅为脱敏验收数据。"
  ].join("\n"));
  assertUsableTopicOutput(combined);
  for (const anchor of ["门店明厨巡检新规", "门店巡检回应加盟疑问", "门店巡检现场类视频完播更高"]) {
    assert.ok(combined.includes(anchor), `combined source output must retain traceable evidence: ${anchor}\n${combined}`);
  }

  const secondCombined = await generate([
    ...sharedBrief,
    "【来源一｜行业热点】本轮未选择。",
    "【来源二｜对标账号】已选择。对标账号：陈厂长；对标线索1：门店巡检回应加盟疑问｜来源：陈厂长公开主页｜日期：2026-08-14｜互动数据待核验｜https://example.com/benchmark",
    "【来源三｜AI录音卡】已选择。录音转写：客户原话：加盟商最怕交了钱没有陪跑，先看真实门店巡检记录，再谈合作条件。",
    "【来源四｜自己账号真实数据复盘】本轮未选择。"
  ].join("\n"));
  assertUsableTopicOutput(secondCombined);
  for (const anchor of ["门店巡检回应加盟疑问", "交了钱没有陪跑"]) {
    assert.ok(secondCombined.includes(anchor), `second combined output must fuse each selected source: ${anchor}\n${secondCombined}`);
  }

  const missing = await generate([
    ...sharedBrief,
    "【来源一｜行业热点】本轮未选择。",
    "【来源二｜对标账号】本轮未选择。",
    "【来源三｜AI录音卡】本轮未选择。",
    "【来源四｜自己账号真实数据复盘】本轮未选择。"
  ].join("\n"));
  assertUsableTopicOutput(missing);
  assert.match(missing, /未发现\/待补|待核验/, `missing sources must be explicit, not fabricated\n${missing}`);
  assert.doesNotMatch(missing, /门店明厨巡检新规|门店巡检回应加盟疑问|交了钱没有陪跑|门店巡检现场类视频完播更高/, `missing-source output must not leak another run's evidence\n${missing}`);

  const timeout = await generate([
    ...sharedBrief,
    "【来源一｜行业热点】已选择。本次检索超时，未取得可核验的近期热点、URL或日期；不得把超时当作已读取。",
    "【来源二｜对标账号】本轮未选择。",
    "【来源三｜AI录音卡】本轮未选择。",
    "【来源四｜自己账号真实数据复盘】本轮未选择。"
  ].join("\n"));
  assertUsableTopicOutput(timeout);
  assert.match(timeout, /未发现\/待补|待核验/, `source timeout must be explicit instead of fabricated\n${timeout}`);
  assert.doesNotMatch(timeout, /近期已核验变化|热点“/, `timed-out hotspot must not be presented as verified\n${timeout}`);

  for (const target of ["C端团购到店", "学员招募", "合作方招募"]) {
    const answer = await generate([
      ...sharedBrief.map((line) => line === "获客目标：招商加盟" ? `获客目标：${target}` : line),
      "【来源一｜行业热点】本轮未选择。",
      "【来源二｜对标账号】本轮未选择。",
      "【来源三｜AI录音卡】已选择。录音转写：客户原话：先把适合谁、怎么咨询说清楚。",
      "【来源四｜自己账号真实数据复盘】本轮未选择。"
    ].join("\n"));
    assertUsableTopicOutput(answer);
    assert.ok(answer.includes(target), `topic output must preserve the active target: ${target}\n${answer}`);
  }

  console.log("founder_ip_topic_source_quality_smoke:PASS");
}

void main();

import { routeSkill, runAgent } from "../packages/agent/src/index.js";

const provider = {
  name: "topic-inspiration-fallback-test",
  async complete() {
    throw new Error("force_topic_inspiration_fallback");
  }
};

const base = {
  tenantId: "topic-inspiration-regression",
  userId: "topic-inspiration-user",
  role: "owner" as const,
  planCode: "ip_standard" as const,
  requestedSkillId: "baolu_topics" as const,
  capabilityId: "topic_inspiration",
  tenantProfile: {
    tenantId: "topic-inspiration-regression",
    tenantName: "服务商账户",
    tenantType: "personal_ip" as const,
    industry: "IP与AI企业服务"
  },
  channel: "h5" as const
};

function assertStandardOutput(answer: string) {
  const required = [
    "本轮主体与目标",
    "四大来源自动采集结果",
    "AI录音卡",
    "行业与用户热点",
    "自身账号数据复盘",
    "同行与对标内容",
    "三关筛选后的TOP10",
    "第一关证据",
    "共识层级",
    "客资准度",
    "适用阶段",
    "配比调整建议",
    "待验证动作与证据边界"
  ];
  const missing = required.filter((term) => !answer.includes(term));
  const rows = answer.split("\n").filter((line) => /^\|\s*\d+\s*\|/.test(line));
  if (missing.length || rows.length !== 10) {
    throw new Error(`选题灵感标准输出不合格：缺少 ${missing.join("、")}；选题行数 ${rows.length}\n${answer}`);
  }
  if (/四维评分|综合分|完整内容执行包|口播逐字稿|剪辑EDL|稳赚|保本/.test(answer)) {
    throw new Error(`选题灵感仍有旧评分、越界文案或违规承诺\n${answer}`);
  }
}

async function main() {
  if (routeSkill("根据录音知识给我做一份选题灵感TOP10") !== "baolu_topics") {
    throw new Error("选题灵感没有路由到 baolu_topics");
  }

  const complete = await runAgent({
    ...base,
    input: [
      "本轮主体：枕水江南客户项目（仅测试，不代表真实资料）",
      "目标客户：关注中式快餐连锁合作的创业者",
      "发布平台：视频号",
      "转化目标：获得有效项目咨询",
      "AI录音卡：客户反复强调，先看真实门店过程，再谈合作条件。",
      "行业热点来源：https://example.com/test，日期2026-07-29，仅用于回归测试。",
      "账号数据复盘：已上传CSV，案例过程类作品的平均播放时长相对更高。",
      "同行与对标内容：已提供一个主页链接，公开作品常用门店过程拆解。",
      "请输出选题灵感TOP10，只做选题。"
    ].join("\n")
  }, provider);
  assertStandardOutput(complete.answer);
  if (!complete.answer.includes("枕水江南") || complete.answer.includes("IP与AI企业服务最容易被误解")) {
    throw new Error(`本轮客户项目没有覆盖账户默认身份\n${complete.answer}`);
  }

  const missingSources = await runAgent({
    ...base,
    input: "本轮给一个美业客户项目做选题灵感，只选择了一段老板录音：客户不是没需求，而是不知道该先问什么。"
  }, provider);
  assertStandardOutput(missingSources.answer);
  for (const source of ["行业与用户热点", "自身账号数据复盘", "同行与对标内容"]) {
    const row = missingSources.answer.split("\n").find((line) => line.includes(`| ${source} |`));
    if (!row || !row.includes("未发现/待补") || !/\|\s*0\s*\|/.test(row)) {
      throw new Error(`缺失来源没有正确标记：${source}\n${missingSources.answer}`);
    }
  }

  const selectedRecordingContext = await runAgent({
    ...base,
    input: [
      "下面是用户本次主动选择的企业私有知识资料。",
      "【资料 1｜脱敏访谈录音】",
      "录音里反复提到：企业客户真正担心的不是AI工具数量，而是业务流程没有梳理清楚、负责人不明确、上线后没人验收。客户还追问过，应该先选哪个流程做小范围验证。",
      "用户这次补充：选题系统自动运行。已选择 1 条得到大脑录音转写，请从四大来源生成选题。"
    ].join("\n\n")
  }, provider);
  assertStandardOutput(selectedRecordingContext.answer);
  const recordingRow = selectedRecordingContext.answer
    .split("\n")
    .find((line) => line.includes("| AI录音卡 |"));
  if (!recordingRow || !recordingRow.includes("已读取") || !/\|\s*[1-9]\d*\s*\|/.test(recordingRow)) {
    throw new Error(`已携带有效录音正文却没有被选题 Skill 识别\n${selectedRecordingContext.answer}`);
  }

  console.log("Topic inspiration verification passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

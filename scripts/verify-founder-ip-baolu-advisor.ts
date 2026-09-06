import assert from "node:assert/strict";
import { runAgent } from "../packages/agent/src/index.js";

const provider = {
  name: "baolu-ip-advisor-contract-test",
  async complete(messages: Array<{ content: string }>) {
    const systemPrompt = messages.map((message) => message.content).join("\n");
    assert.match(systemPrompt, /保禄的新媒体与创始人IP能力分身/);
    assert.match(systemPrompt, /不冒充保禄本人/);
    assert.match(systemPrompt, /不得编造/);
    return [
      "直接判断：先收窄一个最优先的人群和一个内容支柱，再测试表达，不要同时改定位、选题和发布频率。",
      "判断依据：\n- 已知事实：你提供的是内容分散这一现象，未提供账号后台数据。\n- 经验判断：新号或内容分散账号同时改太多变量，无法判断哪一个变化带来改善。\n- 待验证：需用未来两周的完播、互动、主页访问和有效咨询验证。",
      "今天先做：写下一个目标人群的三个高频问题，只围绕其中一个问题连续发布三条不同角度的内容草案。",
      "待确认/待验证：没有本轮真实账号数据，以上是经验判断，不代表平台实时规则或既有爆款结果。"
    ].join("\n");
  }
};

async function main() {
  for (const input of [
    "我想问问保禄：创始人IP内容很散，先收窄人群还是先固定内容支柱？",
    "我想问问保禄：新媒体账号定位不清晰，今天第一步应该做什么？",
    "我想问问保禄：没有后台数据时，怎样判断一个选题是否值得继续测试？"
  ]) {
    const result = await runAgent({
      tenantId: "baolu-advisor-regression-tenant",
      userId: "baolu-advisor-regression-user",
      role: "owner",
      planCode: "ip_standard",
      requestedSkillId: "baolu_ip_advisor",
      capabilityId: "baolu_ip_advisor",
      capabilityLocked: true,
      input,
      tenantProfile: {
        tenantId: "baolu-advisor-regression-tenant",
        tenantName: "脱敏创始人IP测试项目",
        tenantType: "personal_ip",
        industry: "企业服务"
      },
      channel: "h5"
    }, provider);

    assert.equal(result.skillId, "baolu_ip_advisor");
    for (const heading of ["直接判断", "判断依据", "今天先做", "待确认/待验证"]) {
      assert.match(result.answer, new RegExp(heading));
    }
    assert.doesNotMatch(result.answer, /我亲自服务过|我的真实客户|已经发布|已经投放|保证爆款|保证涨粉/);
  }

  console.log("founder_ip_baolu_advisor_verification:PASS");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

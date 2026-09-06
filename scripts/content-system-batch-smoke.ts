import assert from "node:assert/strict";
import { runAgent } from "../packages/agent/src/index.ts";

let providerCalls = 0;

async function main(): Promise<void> {
const result = await runAgent({
  tenantId: "content-system-test-tenant",
  userId: "content-system-test-user",
  role: "owner",
  planCode: "local_standard",
  requestedSkillId: "baolu_content_creator",
  capabilityId: "content_plan",
  deliveryPolicy: "draft_with_placeholders",
  channel: "workbench",
  input: [
    "【内容系统｜批量内容生成】",
    "本轮服务主体：测试企业",
    "以下是用户已经确认、需要分别创作的选题：",
    "1. AI案例应该看实施过程，还是只看结果？",
    "固定调用内容创作能力。每一个选题必须独立输出一份完整内容执行包。"
  ].join("\n"),
  tenantProfile: {
    tenantId: "content-system-test-tenant",
    tenantName: "测试企业",
    tenantType: "local_business",
    industry: "企业AI服务",
    data: { offer: "AI落地服务", customer: "企业老板" }
  }
}, {
  name: "content-system-incomplete-first-draft",
  async complete() {
    providerCalls += 1;
    // Deliberately incomplete: the runtime must not return this four-part draft.
    return [
      "短视频脚本完整版",
      "一、选题\n主选题：测试",
      "二、口播逐字稿\n测试正文",
      "三、拍摄脚本\n镜头一",
      "四、发布与承接\n标题：测试"
    ].join("\n");
  }
});

const requiredSections = [
  "完整内容执行包",
  "选题",
  "文案",
  "访谈话术",
  "拍摄脚本",
  "拍摄注意事项",
  "剪辑EDL",
  "发布标题",
  "发布时间",
  "评论区引导",
  "投流建议"
];

assert.equal(providerCalls, 1, "内容系统必须只调用一次模型，不得因缺栏目发起第二次长请求");
for (const section of requiredSections) {
  assert.ok(result.answer.includes(section), `内容系统交付缺少栏目：${section}`);
}

console.log(`CONTENT_SYSTEM_BATCH_SMOKE_OK calls=${providerCalls} length=${result.answer.length}`);
}

void main();

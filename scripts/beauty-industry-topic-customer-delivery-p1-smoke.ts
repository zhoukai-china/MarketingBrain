import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DomesticChatProvider } from "../apps/api/src/services/domestic-chat-provider.js";
import { assertBeautyWorkflowRuntimeResult } from "../apps/api/src/products/beauty-industry/output-contract.js";
import { BEAUTY_WORKFLOWS, buildBeautyWorkflowPrompt } from "../apps/api/src/products/beauty-industry/workflows.js";

async function main(): Promise<void> {
  process.env.LLM_MOCK_MODE = "true";
  const workflow = BEAUTY_WORKFLOWS.topics;
  const composed = await buildBeautyWorkflowPrompt(workflow.capabilityId);
  const provider = new DomesticChatProvider({
    providerName: "deepseek",
    model: "deepseek-v4-pro",
    timeoutMs: 1_000,
    domesticNetworkOnly: true,
    allowedHosts: []
  });
  const output = await provider.complete([
    { role: "system", content: composed.prompt },
    { role: "user", content: [
      "【固定美业能力】topic_inspiration",
      "服务主体：本店。",
      "目标用户：关于日常皮肤管理的女性用户。",
      "本轮获客目标：团购下单。",
      "细分赛道：皮肤管理。",
      "已启用且有可用资料的来源：行业与用户热点、同行与对标内容。"
    ].join("\n") }
  ]);
  const customerBlock = output.split("## 来源与质量审核")[0] ?? "";
  assert.match(customerBlock, /关于日常皮肤管理的女性用户/);
  assert.match(customerBlock, /团购下单/);
  assert.match(customerBlock, /皮肤管理/);
  assert.equal(output.match(/^###\s+(?:0[1-9]|10)[.、：:]\s*\S.+$/gm)?.length, 10);
  assert.doesNotMatch(customerBlock, /待补|待核验|核验|controlled|mock|Schema|Eval|\|/iu);
  await assertBeautyWorkflowRuntimeResult({
    capabilityId: workflow.capabilityId,
    expectedSkillId: workflow.primarySkillId,
    expectedSkillVersion: composed.version,
    result: {
      capabilityId: workflow.capabilityId,
      skillId: workflow.primarySkillId,
      skillVersion: composed.version,
      answerText: output,
      deliveryStatus: "completed",
      qualityFlags: []
    },
    observedProviderOutputs: [output],
    replay: false
  });

  const web = readFileSync(new URL("../apps/web/src/components/acquisition/TopicSystemWorkbench.tsx", import.meta.url), "utf8");
  assert.match(web, /beautyTopicCards/);
  assert.match(web, /复制全部TOP10/);
  assert.match(web, /copyBeautyTopics\(index\)/);
  assert.match(web, /openSelectedTopicInContentSystem/);
  assert.match(web, /navigator\.clipboard\.writeText\(text\)/, "topic copy must use the clean card projection");
  assert.doesNotMatch(web, /navigator\.clipboard\.writeText\(result/, "topic copy must not include the raw result or audit block");

  process.env.LLM_MOCK_MODE = "false";
  console.log("beauty_industry_topic_customer_delivery_p1_smoke:PASS provider=0 cost=0");
}

main().catch((error) => {
  process.env.LLM_MOCK_MODE = "false";
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

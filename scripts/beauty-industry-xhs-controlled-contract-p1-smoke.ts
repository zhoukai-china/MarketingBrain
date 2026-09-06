import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { inspectQuality } from "../packages/agent/src/index.js";
import { loadSkillQualityContract } from "../packages/skills/src/index.js";
import { DomesticChatProvider } from "../apps/api/src/services/domestic-chat-provider.js";
import { parseBeautyImageDirections } from "../apps/api/src/products/beauty-industry/media-contract.js";
import { assertBeautyWorkflowRuntimeResult } from "../apps/api/src/products/beauty-industry/output-contract.js";
import { BEAUTY_WORKFLOWS, buildBeautyWorkflowPrompt } from "../apps/api/src/products/beauty-industry/workflows.js";
import { buildBeautyIndustryRunInput } from "../apps/api/src/products/beauty-industry/profile.js";
import { buildBeautyXhsTaskFactDirective } from "../apps/api/src/products/beauty-industry/xhs-task-facts.js";

const USER_INPUT = "为皮肤管理产品做一套面向附近女性顾客的小红书图文";
const DIAGNOSTIC_REQUEST_FINGERPRINT = "2132b435a0a829a1";

async function main(): Promise<void> {
  process.env.LLM_MOCK_MODE = "true";
  const workflow = BEAUTY_WORKFLOWS.xiaohongshu;
  const composed = await buildBeautyWorkflowPrompt(workflow.capabilityId);
  const contract = await loadSkillQualityContract(workflow.primarySkillId);
  assert.ok(contract, "formal XHS quality contract must exist");
  assert.equal(workflow.capabilityId, "beauty_xiaohongshu_package");
  assert.equal(workflow.scope, "acquisition:xhs");
  assert.equal(workflow.primarySkillId, "wechat-xhs-content-line");
  assert.match(composed.version, /^wechat-xhs-content-line@1\.0\.3\+beauty-industry-xhs@1\.1\.0\+beauty-industry-compliance@1\.0\.0$/);
  assert.match(composed.prompt, /任何输出层都不得出现[“\"]我做过[”\"]/);
  assert.match(composed.prompt, /没有可核验第一人称经历时，改用门店中性说明/);
  assert.match(DIAGNOSTIC_REQUEST_FINGERPRINT, /^[a-f0-9]{16}$/);

  const taskFactSource = buildBeautyIndustryRunInput({
    question: USER_INPUT,
    profile: null,
    mode: "quick",
    xhsTaskFactDirective: buildBeautyXhsTaskFactDirective({ question: USER_INPUT })
  });
  const messages = [
    { role: "system" as const, content: composed.prompt },
    { role: "user" as const, content: taskFactSource }
  ];
  const provider = new DomesticChatProvider({
    providerName: "deepseek",
    model: "deepseek-v4-pro",
    timeoutMs: 1_000,
    domesticNetworkOnly: true,
    allowedHosts: []
  });
  const answer = await provider.complete(messages);
  const qualityFlags = inspectQuality(answer, workflow.primarySkillId, contract, messages, workflow.capabilityId);

  assert.equal(
    qualityFlags.some((flag) => flag.startsWith("missing_contract_terms:")),
    false,
    `diagnostic ${DIAGNOSTIC_REQUEST_FINGERPRINT}: controlled mock must satisfy the formal XHS terms (${qualityFlags.join(";")})`
  );
  await assertBeautyWorkflowRuntimeResult({
    capabilityId: workflow.capabilityId,
    expectedSkillId: workflow.primarySkillId,
    expectedSkillVersion: composed.version,
    result: {
      capabilityId: workflow.capabilityId,
      skillId: workflow.primarySkillId,
      skillVersion: composed.version,
      answerText: answer,
      deliveryStatus: "completed",
      qualityFlags,
      creditCost: 8
    },
    observedProviderOutputs: [answer],
    replay: false,
    taskFactSource
  });

  assert.equal((answer.match(/#[^\s#，,；;]+/g) ?? []).length, 6, "controlled output must contain 5-8 topic tags");
  assert.equal(parseBeautyImageDirections(answer, 3).length, 3, "all three image directions must be independently parseable");
  for (const term of ["互动与承接", "事实与合规待补"]) assert.match(answer, new RegExp(term));
  for (const term of ["正向视觉提示词", "负向提示词", "后期叠字", "视觉参数"]) {
    assert.equal(answer.split(term).length - 1, 3, `${term} must appear once in every image direction`);
  }
  assert.match(answer, /客户可复制成品/);
  assert.match(answer, /门店制作说明/);
  assert.match(answer, /质量与合规检查/);
  assert.doesNotMatch(answer.match(/## 客户可复制成品[\s\S]*?(?=## 门店制作说明)/)?.[0] ?? "", /待补|核验|供应商|Schema|Eval|受控流程/);
  assert.doesNotMatch(answer, /兰琪|餐饮|外卖|疗效保证|一次根治|已经发布|已经生成图片/);

  const pageSource = await readFile(new URL("../apps/web/src/pages/BeautyIndustryAcquisitionPage.tsx", import.meta.url), "utf8");
  const inFlightGuard = pageSource.indexOf("requestInFlightRef.current || effectiveQuestion.length < 6");
  const requestLock = pageSource.indexOf("requestInFlightRef.current = true", inFlightGuard);
  const requestFetch = pageSource.indexOf('fetch(apiPath("/beauty-industry/acquisition/runs")', requestLock);
  assert.ok(inFlightGuard >= 0 && requestLock > inFlightGuard && requestFetch > requestLock, "the synchronous in-flight lock must be acquired before the request fetch");
  assert.match(pageSource, /const requestId = requestIdRef\.current \?\? crypto\.randomUUID\(\)/, "network-uncertain retries must retain the same server idempotency key");

  const incomplete = answer.replace(/### 事实与合规待补[\s\S]*$/, "");
  await assert.rejects(
    () => assertBeautyWorkflowRuntimeResult({
      capabilityId: workflow.capabilityId,
      expectedSkillId: workflow.primarySkillId,
      expectedSkillVersion: composed.version,
      result: { capabilityId: workflow.capabilityId, skillId: workflow.primarySkillId, skillVersion: composed.version, answerText: incomplete, deliveryStatus: "completed", qualityFlags: [], creditCost: 8 },
      observedProviderOutputs: [incomplete],
      replay: false,
      taskFactSource
    }),
    /beauty_workflow_output_contract_failed:missing_事实与合规待补/
  );

  const contaminated = answer.replace("皮肤管理产品", "餐饮团购产品");
  await assert.rejects(
    () => assertBeautyWorkflowRuntimeResult({
      capabilityId: workflow.capabilityId,
      expectedSkillId: workflow.primarySkillId,
      expectedSkillVersion: composed.version,
      result: { capabilityId: workflow.capabilityId, skillId: workflow.primarySkillId, skillVersion: composed.version, answerText: contaminated, deliveryStatus: "completed", qualityFlags: [], creditCost: 8 },
      observedProviderOutputs: [contaminated],
      replay: false,
      taskFactSource
    }),
    /beauty_workflow_output_foreign_module_failed:foreign_industry_or_internal/
  );

  console.log(`BEAUTY_XHS_CONTROLLED_CONTRACT_P1_OK fingerprint=${DIAGNOSTIC_REQUEST_FINGERPRINT} provider_calls=0 paid_yuan=0`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

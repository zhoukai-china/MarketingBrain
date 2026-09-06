import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { inspectQuality } from "../packages/agent/src/index.js";
import { loadSkillQualityContract } from "../packages/skills/src/index.js";
import { buildBeautyIndustryRunInput } from "../apps/api/src/products/beauty-industry/profile.js";
import { DomesticChatProvider } from "../apps/api/src/services/domestic-chat-provider.js";
import { assertBeautyWorkflowRuntimeResult } from "../apps/api/src/products/beauty-industry/output-contract.js";
import { BEAUTY_WORKFLOWS, buildBeautyWorkflowPrompt } from "../apps/api/src/products/beauty-industry/workflows.js";
import {
  buildBeautyXhsTaskFactDirective,
  extractBeautyXhsTaskFacts,
  inspectBeautyXhsTaskFactIssues
} from "../apps/api/src/products/beauty-industry/xhs-task-facts.js";

const USER_INPUT = "为夏季基础补水护理做一套面向附近女性顾客的小红书图文";
const REQUEST_FINGERPRINT = "2132b435a0a829a1";

async function validateRuntime(answer: string, qualityFlags: string[], taskFactSource: string): Promise<void> {
  const workflow = BEAUTY_WORKFLOWS.xiaohongshu;
  const composed = await buildBeautyWorkflowPrompt(workflow.capabilityId);
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
}

function replaceAllFacts(answer: string): string {
  return answer
    .replaceAll("夏季", "当下")
    .replaceAll("基础补水护理", "日常护理")
    .replaceAll("附近女性顾客", "目标顾客")
    .replaceAll("附近", "本次")
    .replaceAll("女性顾客", "顾客")
    .replaceAll("小红书图文", "内容成品")
    .replace(/^[-*]\s*(?:季节\/时点|服务项目|地理范围|目标顾客|平台|交付形式)[：:].*$/gm, "");
}

async function main(): Promise<void> {
  process.env.LLM_MOCK_MODE = "true";
  const workflow = BEAUTY_WORKFLOWS.xiaohongshu;
  const composed = await buildBeautyWorkflowPrompt(workflow.capabilityId);
  const contract = await loadSkillQualityContract(workflow.primarySkillId);
  assert.ok(contract);

  const taskFactSource = buildBeautyIndustryRunInput({
    question: USER_INPUT,
    profile: null,
    mode: "quick",
    xhsTaskFactDirective: buildBeautyXhsTaskFactDirective({ question: USER_INPUT })
  });
  assert.deepEqual(extractBeautyXhsTaskFacts({ question: USER_INPUT }), [
    { key: "time_context", value: "夏季" },
    { key: "service_project", value: "基础补水护理" },
    { key: "audience_geography", value: "附近" },
    { key: "target_audience", value: "女性顾客" },
    { key: "platform", value: "小红书" },
    { key: "deliverable", value: "图文" }
  ]);
  assert.deepEqual(
    extractBeautyXhsTaskFacts({ question: "请为秋季舒缓护理制作一套面向周边上班族的小红书图文" }),
    [
      { key: "time_context", value: "秋季" },
      { key: "service_project", value: "舒缓护理" },
      { key: "audience_geography", value: "附近" },
      { key: "target_audience", value: "上班族" },
      { key: "platform", value: "小红书" },
      { key: "deliverable", value: "图文" }
    ],
    "the extractor must generalize beyond the diagnostic sentence"
  );
  assert.match(taskFactSource, new RegExp(`用户这次说：${USER_INPUT}`), "the Web/WorkBuddy request must reach the backend unchanged");

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
  const complete = await provider.complete(messages);
  const missingFacts = replaceAllFacts(complete);
  const missingQuality = inspectQuality(missingFacts, workflow.primarySkillId, contract, messages, workflow.capabilityId);

  const failures: string[] = [];
  if (!/本次任务事实清单/.test(taskFactSource)) failures.push("normalized_input_missing_machine_verifiable_fact_list");
  if (!/任务事实回执/.test(composed.prompt)) failures.push("prompt_missing_fact_receipt_requirement");
  if (!(contract.requiredSections ?? []).includes("任务事实回执")) failures.push("formal_schema_missing_fact_receipt");
  if (!missingQuality.includes("rubric_fact_retention_weak")) failures.push("rubric_did_not_reject_known_fact_omission");

  try {
    await validateRuntime(missingFacts, [], taskFactSource);
    failures.push("product_contract_accepted_structurally_complete_but_fact_empty_output");
  } catch (error) {
    assert.match(String(error), /fact_retention|rubric_fact_retention_weak/);
  }

  const synonymAnswer = complete
    .replaceAll("夏季", "夏天")
    .replaceAll("附近女性顾客", "周边女性客群")
    .replaceAll("基础补水护理", "日常补水护理");
  await validateRuntime(synonymAnswer, inspectQuality(synonymAnswer, workflow.primarySkillId, contract, messages, workflow.capabilityId), taskFactSource)
    .catch((error) => failures.push(`reasonable_synonyms_rejected:${String(error)}`));

  const ageAudienceFactSource = buildBeautyIndustryRunInput({
    question: USER_INPUT,
    profile: null,
    mode: "quick",
    xhsTaskFactDirective: buildBeautyXhsTaskFactDirective({
      question: USER_INPUT,
      project: "基础补水护理",
      audience: "25-45岁女性",
      platform: "小红书"
    })
  });
  const ageSynonymAnswer = complete.replace(/^[-*]\s*目标顾客[：:].*$/m, "- 目标顾客：25至45岁女生");
  assert.deepEqual(
    inspectBeautyXhsTaskFactIssues(ageSynonymAnswer, ageAudienceFactSource),
    [],
    "25至45岁女生 must be accepted as the same age range and female audience"
  );
  const ageSynonymMessages = [
    { role: "system" as const, content: composed.prompt },
    { role: "user" as const, content: ageAudienceFactSource }
  ];
  await validateRuntime(
    ageSynonymAnswer,
    inspectQuality(ageSynonymAnswer, workflow.primarySkillId, contract, ageSynonymMessages, workflow.capabilityId),
    ageAudienceFactSource
  ).catch((error) => failures.push(`age_and_female_synonym_rejected:${String(error)}`));

  const ageMissingAnswer = complete.replace(/^[-*]\s*目标顾客[：:].*$/m, "- 目标顾客：女生");
  assert.deepEqual(
    inspectBeautyXhsTaskFactIssues(ageMissingAnswer, ageAudienceFactSource),
    [{ kind: "missing", key: "target_audience" }],
    "omitting an explicit age range must be missing, not contradiction"
  );
  assert.ok(
    inspectQuality(ageMissingAnswer, workflow.primarySkillId, contract, ageSynonymMessages, workflow.capabilityId)
      .includes("rubric_fact_retention_weak"),
    "the Agent rubric must agree that an explicit age range was omitted"
  );
  await assert.rejects(
    () => validateRuntime(ageMissingAnswer, [], ageAudienceFactSource),
    /beauty_workflow_output_fact_retention_failed:target_audience/
  );

  const ageContradictionAnswer = complete.replace(/^[-*]\s*目标顾客[：:].*$/m, "- 目标顾客：30至40岁男性顾客");
  assert.deepEqual(
    inspectBeautyXhsTaskFactIssues(ageContradictionAnswer, ageAudienceFactSource),
    [{ kind: "contradiction", key: "target_audience" }],
    "an explicit male and different-age replacement must remain a contradiction"
  );

  const contradiction = complete
    .replaceAll("夏季", "冬季")
    .replaceAll("附近女性顾客", "远途男性顾客")
    .replaceAll("基础补水护理", "强效美白治疗");
  try {
    await validateRuntime(contradiction, [], taskFactSource);
    failures.push("product_contract_accepted_fact_contradiction");
  } catch (error) {
    assert.match(String(error), /fact_contradiction|fact_retention/);
  }

  for (const [label, key] of [
    ["季节/时点", "time_context"],
    ["服务项目", "service_project"],
    ["地理范围", "audience_geography"],
    ["目标顾客", "target_audience"]
  ] as const) {
    const omitted = complete.replace(new RegExp(`^[-*]\\s*${label.replace("/", "\\/")}[:：].*$`, "m"), "");
    await assert.rejects(
      () => validateRuntime(omitted, [], taskFactSource),
      new RegExp(`beauty_workflow_output_fact_retention_failed:${key}`),
      `omitting ${key} must fail closed`
    );
  }

  const contaminated = complete.replace("基础补水护理", "餐饮团购套餐");
  await assert.rejects(() => validateRuntime(contaminated, [], taskFactSource), /foreign_industry_or_internal/);
  const structureMissing = complete.replace(/### 配图方向三｜互动承接图[\s\S]*?(?=## 质量与合规检查)/, "");
  await assert.rejects(() => validateRuntime(structureMissing, [], taskFactSource), /missing_配图方向三_互动承接图/);

  const webSource = await readFile(new URL("../apps/web/src/pages/BeautyIndustryAcquisitionPage.tsx", import.meta.url), "utf8");
  const mcpSource = await readFile(new URL("../apps/api/src/products/beauty-industry/mcp-adapter.ts", import.meta.url), "utf8");
  const liveRunnerSource = await readFile(new URL("./beauty-industry-by17-xhs-live-acceptance.mjs", import.meta.url), "utf8");
  assert.match(webSource, /question:\s*effectiveQuestion/, "Web must send the full task request");
  assert.match(mcpSource, /input:\s*question/, "WorkBuddy must send the same question to shared execution");
  assert.match(
    liveRunnerSource,
    /arguments:\s*\{\s*question:\s*USER_INPUT,[\s\S]{0,180}professionalOptions:\s*PROFESSIONAL_OPTIONS/,
    "the live WorkBuddy runner must send one-off task facts in professionalOptions, matching the public MCP contract"
  );
  assert.doesNotMatch(
    liveRunnerSource,
    /arguments:\s*\{\s*question:\s*USER_INPUT,[\s\S]{0,180}\.\.\.\(PROFESSIONAL_OPTIONS\s*\?\?\s*\{\}\)/,
    "the live runner must not spread one-off task fields into unsupported top-level MCP arguments"
  );

  assert.deepEqual(failures, [], `QA-20260825-009 red/green gate failed: ${failures.join(";")}`);
  console.log(`BEAUTY_XHS_FACT_RETENTION_P1_OK fingerprint=${REQUEST_FINGERPRINT} provider_calls=0 paid_yuan=0`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

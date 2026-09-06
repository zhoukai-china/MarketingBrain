import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildAgentMessages, inspectQuality, type LlmProvider } from "../packages/agent/src/index.js";
import { loadSkillQualityContract } from "../packages/skills/src/index.js";
import { buildBeautyWorkflowPrompt } from "../apps/api/src/products/beauty-industry/workflows.js";
import { buildBeautyIndustryRunInput } from "../apps/api/src/products/beauty-industry/profile.js";
import { buildBeautyXhsTaskFactDirective } from "../apps/api/src/products/beauty-industry/xhs-task-facts.js";
import { buildBeautyXhsTaskSnapshot, buildBeautyXhsTaskSnapshotDirective } from "../apps/api/src/products/beauty-industry/xhs-task-snapshot.js";
import { assertBeautyWorkflowRuntimeResult } from "../apps/api/src/products/beauty-industry/output-contract.js";

const USER_INPUT = "为烟台女生写一条问题肌修复的图文内容";
const OPTIONS = {
  project: "问题肌修复",
  audience: "25-45岁女性",
  city: "烟台",
  storeFacts: "单店 可预约",
  contentAngle: "顾客痛点切入",
  tone: "自然",
  visualStyle: "摄影感 有场景有人物"
} as const;

async function main(): Promise<void> {
  process.env.LLM_MOCK_MODE = "false";
  process.env.USE_MOCK_LLM = "false";
  const composed = await buildBeautyWorkflowPrompt("beauty_xiaohongshu_package");
  assert.match(
    composed.prompt,
    /beauty-xhs-provider-output-v1/,
    "red: the configured Provider prompt has no machine-verifiable XHS transport contract"
  );

  const snapshot = buildBeautyXhsTaskSnapshot({
    question: USER_INPUT,
    profile: null,
    professionalOptions: OPTIONS
  });
  const taskFactSource = buildBeautyIndustryRunInput({
    question: USER_INPUT,
    profile: null,
    mode: "quick",
    professionalOptions: OPTIONS,
    xhsTaskFactDirective: buildBeautyXhsTaskFactDirective({
      question: USER_INPUT,
      project: OPTIONS.project,
      audience: OPTIONS.audience,
      platform: "小红书"
    }),
    xhsTaskSnapshotDirective: buildBeautyXhsTaskSnapshotDirective(snapshot)
  });
  assert.match(taskFactSource, /问题肌修复/);
  assert.match(taskFactSource, /25-45岁女性/);
  assert.match(taskFactSource, /烟台/);
  assert.match(taskFactSource, /单店 可预约/);
  const prepared = await buildAgentMessages({
    tenantId: "qa-xhs-provider-structure-tenant",
    userId: "qa-xhs-provider-structure-user",
    role: "owner",
    planCode: "local_premium",
    input: taskFactSource,
    requestedSkillId: "wechat-xhs-content-line",
    capabilityId: "beauty_xiaohongshu_package",
    capabilityLocked: true,
    deliveryPolicy: "clarify",
    skillPrompt: composed.prompt,
    skillVersionOverride: composed.version,
    tenantProfile: {
      tenantId: "qa-xhs-provider-structure-tenant",
      tenantName: "合成测试门店",
      tenantType: "local_business",
      industry: "生活美容",
      city: "烟台",
      data: { synthetic: true }
    },
    channel: "workbuddy"
  });
  assert.ok(
    Buffer.byteLength(JSON.stringify(prepared.messages), "utf8") <= 25_000,
    "the exact user journey must remain inside the Provider preflight byte limit"
  );

  const { createBeautyXhsStructuredOutputProvider } = await import(
    "../apps/api/src/products/beauty-industry/xhs-provider-output.js"
  );
  const replay = JSON.parse(await readFile(
    new URL("./fixtures/beauty-xhs-provider-output-qa-20260829-006.json", import.meta.url),
    "utf8"
  )) as Record<string, any>;
  assert.equal(replay.failureBoundary.stage, "structured_output_adapter");
  assert.equal(replay.failureBoundary.observedProviderOutputs, 0);
  assert.equal(replay.failureBoundary.rawOutputPersisted, false);
  assert.equal(replay.failureBoundary.specificContractRuleKnown, false);
  assert.equal(replay.providerTerminal.finishReason, "stop");
  const bossUsableReplay = JSON.parse(await readFile(
    new URL("./fixtures/beauty-xhs-boss-usable-qa-20260829-006.json", import.meta.url),
    "utf8"
  )) as Record<string, any>;
  assert.equal(bossUsableReplay.adapter.status, "succeeded");
  assert.equal(bossUsableReplay.adapter.titleCount, 3);
  assert.equal(bossUsableReplay.adapter.imageDirectionCount, 3);
  assert.deepEqual(bossUsableReplay.quality.blockingFlags, ["rubric_not_boss_usable"]);
  assert.equal(bossUsableReplay.quality.otherBlockingFlagCount, 0);
  assert.equal(bossUsableReplay.persistence.agentRunCount, 0);
  assert.equal(bossUsableReplay.persistence.creditNet, 0);
  assert.equal(bossUsableReplay.mediaProviderCalls, 0);
  let providerCalls = 0;
  let observedResponseFormat: string | undefined;
  const acceptedDiagnostics: Array<Record<string, any>> = [];
  const fixturePayload = {
    titles: ["烟台问题肌护理，先把这3件事说明白", "25-45岁女性做护理前，建议先看这一篇", "问题肌修复别急着追求立刻变化"],
    body: "在烟台，25-45岁女性面对反复不稳定的皮肤状态，更需要先了解自己的日常护理习惯与实际需求。问题肌修复应以温和护理、规范流程和持续观察为基础，不承诺疗效，也不替代医疗判断。单店支持预约，可先沟通当前困扰与可接受的护理安排，再决定是否到店了解。",
    tags: ["#烟台皮肤管理", "#问题肌护理", "#女性护肤", "#日常皮肤管理", "#到店预约"],
    interaction: "你现在最困扰的是反复不稳定、干燥还是泛红？可以先留言说说想了解的方向。",
    imageDirections: [
      { role: "cover", positivePrompt: "烟台城市生活感的自然摄影画面，问题肌护理主题，干净温和", negativePrompt: "文字、字母、数字、品牌、Logo、二维码、水印、疗效对比", postProductionText: "问题肌护理先看这3点", visualParams: "竖版3:4，自然光，中近景" },
      { role: "content", positivePrompt: "温和护理用品与舒适环境的生活摄影细节，无品牌包装", negativePrompt: "文字、字母、数字、品牌、Logo、二维码、水印、医疗器械", postProductionText: "温和·规范·持续观察", visualParams: "竖版3:4，暖色自然光，静物细节" },
      { role: "engagement", positivePrompt: "女性顾客在舒适空间咨询护理需求的自然场景，人物不具可识别身份", negativePrompt: "文字、字母、数字、品牌、Logo、二维码、水印、界面、疗效承诺", postProductionText: "你最想先了解什么？", visualParams: "竖版3:4，自然抓拍，留安全边距" }
    ],
    factReceipt: {
      timeContext: "未提供",
      serviceProject: "问题肌修复",
      audienceGeography: "烟台",
      targetAudience: "25-45岁女性",
      platform: "小红书",
      deliverable: "图文"
    },
    compliancePending: ["未提供可核验的疗效、价格、案例或联系方式，正文未作相关承诺。"]
  };
  const fixtureProvider: LlmProvider = {
    name: "deepseek",
    async complete(_messages, options) {
      providerCalls += 1;
      observedResponseFormat = options?.responseFormat;
      return JSON.stringify(fixturePayload);
    }
  };
  const provider = createBeautyXhsStructuredOutputProvider(fixtureProvider, {
    onAccepted(diagnostic: Record<string, any>) {
      acceptedDiagnostics.push(diagnostic);
    }
  });
  const answer = await provider.complete([{ role: "user", content: taskFactSource }]);
  assert.equal(providerCalls, 1, "one customer task must produce exactly one Provider call");
  assert.equal(observedResponseFormat, "json_object");
  assert.equal(acceptedDiagnostics.length, 1, "one valid Provider result must emit one redacted adapter trace");
  assert.equal(acceptedDiagnostics[0]?.contractRule, "accepted");
  assert.equal(acceptedDiagnostics[0]?.stage, "render");
  assert.equal(acceptedDiagnostics[0]?.structure?.titleCount, 3);
  assert.equal(acceptedDiagnostics[0]?.structure?.imageDirectionCount, 3);
  assert.match(acceptedDiagnostics[0]?.outputHash ?? "", /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(acceptedDiagnostics[0]), /烟台|问题肌|25-45|单店|positivePrompt|negativePrompt/);
  assert.equal((answer.match(/#### 负向提示词/g) ?? []).length, 3);
  assert.match(answer, /- 服务项目：问题肌修复/);
  assert.match(answer, /- 地理范围：烟台/);
  assert.match(answer, /- 目标顾客：25-45岁女性/);
  const multilinePostTextProvider: LlmProvider = {
    name: "deepseek",
    async complete() {
      const payload = structuredClone(fixturePayload);
      payload.imageDirections[0].postProductionText = "问题肌护理\n先看这3点";
      return JSON.stringify(payload);
    }
  };
  const normalizedPostTextAnswer = await createBeautyXhsStructuredOutputProvider(multilinePostTextProvider)
    .complete([{ role: "user", content: taskFactSource }]);
  assert.match(
    normalizedPostTextAnswer,
    /#### 后期叠字\n问题肌护理 先看这3点/,
    "red: post-production copy must preserve its words while normalizing transport newlines for deterministic composition"
  );
  assert.doesNotMatch(
    normalizedPostTextAnswer,
    /#### 后期叠字\n问题肌护理\n先看这3点/,
    "post-production copy must not carry Provider line breaks into the single-line production contract"
  );
  const qualityContract = await loadSkillQualityContract("wechat-xhs-content-line");
  assert.ok(qualityContract);
  const messages = [
    { role: "system" as const, content: composed.prompt },
    { role: "user" as const, content: taskFactSource }
  ];
  const qualityFlags = inspectQuality(
    answer,
    "wechat-xhs-content-line",
    qualityContract,
    messages,
    "beauty_xiaohongshu_package"
  );
  assert.equal(
    qualityFlags.includes("rubric_not_boss_usable"),
    false,
    "red: the canonical XHS customer-delivery headings must count as a directly usable boss asset without requiring the model to say 文案"
  );
  for (const [name, malformed] of [
    ["two_titles", answer.replace("3. 问题肌修复别急着追求立刻变化\n", "")],
    ["four_tags", answer.replace("#到店预约", "")],
    ["missing_engagement", answer.replace(/### 互动与承接\n[^\n]+/, "### 互动与承接\n")]
  ] as const) {
    const malformedFlags = inspectQuality(
      malformed,
      "wechat-xhs-content-line",
      qualityContract,
      messages,
      "beauty_xiaohongshu_package"
    );
    assert.equal(
      malformedFlags.includes("rubric_not_boss_usable"),
      true,
      `${name}: the XHS-specific boss-usability check must not accept an incomplete customer deliverable`
    );
  }
  await assertBeautyWorkflowRuntimeResult({
    capabilityId: "beauty_xiaohongshu_package",
    expectedSkillId: "wechat-xhs-content-line",
    expectedSkillVersion: composed.version,
    result: {
      capabilityId: "beauty_xiaohongshu_package",
      skillId: "wechat-xhs-content-line",
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
  await assert.rejects(
    () => assertBeautyWorkflowRuntimeResult({
      capabilityId: "beauty_xiaohongshu_package",
      expectedSkillId: "wechat-xhs-content-line",
      expectedSkillVersion: composed.version,
      result: {
        capabilityId: "beauty_xiaohongshu_package",
        skillId: "wechat-xhs-content-line",
        skillVersion: composed.version,
        answerText: answer.replace("不承诺疗效", "我做过餐饮疗效案例"),
        deliveryStatus: "completed",
        qualityFlags: [],
        creditCost: 8
      },
      observedProviderOutputs: [answer.replace("不承诺疗效", "我做过餐饮疗效案例")],
      replay: false,
      taskFactSource
    }),
    /(?:forbidden|foreign_industry_or_internal)/,
    "first-person claims and cross-industry pollution must remain fail closed"
  );

  const invalidProvider: LlmProvider = {
    name: "deepseek",
    async complete() {
      return JSON.stringify({
        titles: ["一", "二", "三"],
        body: "这是一段满足最小长度的合成正文，只用于验证缺失制作字段会在一次调用后失败关闭。它不会触发修复调用、第二次模型请求、模板补写或绕过正式合同，测试结束后也不会进入任何客户结果或历史任务。",
        tags: ["#一", "#二", "#三", "#四", "#五"],
        interaction: "你最想先了解哪一项？",
        imageDirections: [],
        factReceipt: {
          timeContext: "未提供",
          serviceProject: "问题肌修复",
          audienceGeography: "烟台",
          targetAudience: "25-45岁女性",
          platform: "小红书",
          deliverable: "图文"
        },
        compliancePending: ["未确认事实不进入正文。"]
      });
    }
  };
  await assert.rejects(
    () => createBeautyXhsStructuredOutputProvider(invalidProvider).complete([{ role: "user", content: taskFactSource }]),
    /beauty_xhs_provider_output_invalid:image_directions_count/,
    "missing production fields must fail closed without a repair call"
  );

  const rejectionDiagnostics: Array<Record<string, any>> = [];
  const fencedInvalidProvider: LlmProvider = {
    name: "deepseek",
    async complete() {
      return "```json\n{\"titles\":[]}\n```";
    }
  };
  const fencedError = await createBeautyXhsStructuredOutputProvider(fencedInvalidProvider, {
    onRejected(diagnostic: Record<string, any>) {
      rejectionDiagnostics.push(diagnostic);
    }
  }).complete([{ role: "user", content: taskFactSource }]).then(
    () => undefined,
    (error: unknown) => error
  );
  assert.ok(fencedError && typeof fencedError === "object");
  assert.equal((fencedError as any).providerFailure?.code, "invalid_response", "red: adapter failures must not collapse to provider_failure:unknown");
  assert.equal(rejectionDiagnostics.length, 1, "red: one adapter failure must emit one safe diagnostic");
  assert.equal(rejectionDiagnostics[0]?.stage, "json_parse");
  assert.equal(rejectionDiagnostics[0]?.contractRule, "json");
  assert.equal(rejectionDiagnostics[0]?.structure?.hasCodeFence, true);
  assert.equal(rejectionDiagnostics[0]?.structure?.parsedTopLevelType, "unparsed");
  assert.match(rejectionDiagnostics[0]?.outputHash ?? "", /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(rejectionDiagnostics[0]), /titles|taskFactSource|问题肌修复|```json/, "diagnostic must not contain raw output or task text");

  const extraKeyDiagnostics: Array<Record<string, any>> = [];
  const extraKeyProvider: LlmProvider = {
    name: "deepseek",
    async complete() {
      return JSON.stringify({
        titles: ["甲", "乙", "丙"],
        body: "这是一段只用于结构观测的合成正文，不包含客户资料、真实门店事实或可发布业务结论。它用于证明额外字段会以脱敏规则失败，而不是记录模型正文或放宽正式合同。",
        tags: ["#一", "#二", "#三", "#四", "#五"],
        interaction: "请选择想继续了解的方向。",
        imageDirections: [],
        factReceipt: {},
        compliancePending: ["合成测试"],
        unexpected: true
      });
    }
  };
  await assert.rejects(
    () => createBeautyXhsStructuredOutputProvider(extraKeyProvider, {
      onRejected(diagnostic: Record<string, any>) {
        extraKeyDiagnostics.push(diagnostic);
      }
    }).complete([{ role: "user", content: taskFactSource }]),
    /beauty_xhs_provider_output_invalid:keys/
  );
  assert.equal(extraKeyDiagnostics[0]?.stage, "top_level_shape");
  assert.equal(extraKeyDiagnostics[0]?.contractRule, "keys");
  assert.equal(extraKeyDiagnostics[0]?.structure?.topLevelKeyCount, 8);
  assert.equal(extraKeyDiagnostics[0]?.structure?.titleCount, 3);
  assert.equal(extraKeyDiagnostics[0]?.structure?.tagCount, 5);
  assert.equal(extraKeyDiagnostics[0]?.structure?.imageDirectionCount, 0);

  console.log("BEAUTY_XHS_PROVIDER_STRUCTURE_P1_OK provider_calls=0 paid_yuan=0");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

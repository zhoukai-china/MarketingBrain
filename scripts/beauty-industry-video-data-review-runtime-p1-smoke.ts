import { readFile } from "node:fs/promises";
import { runAgent } from "../packages/agent/src/index.js";
import { buildBeautyIndustryRunInput, hasBeautyStructuredDataRecords } from "../apps/api/src/products/beauty-industry/profile.js";
import { assertBeautyWorkflowRuntimeResult } from "../apps/api/src/products/beauty-industry/output-contract.js";
import { buildBeautyWorkflowPrompt } from "../apps/api/src/products/beauty-industry/workflows.js";

async function main(): Promise<void> {
  const parsedEvidence = await readFile(new URL("./fixtures/beauty-video-data.csv", import.meta.url), "utf8");
  if (hasBeautyStructuredDataRecords("作品标题,播放量,完播率")) throw new Error("只有表头的数据不应通过复盘前置校验");
  if (!hasBeautyStructuredDataRecords(parsedEvidence)) throw new Error("真实数值记录被错误拒绝");
  const input = buildBeautyIndustryRunInput({
    question: "复盘抖音 2026-08-18 至 2026-08-24 的后台视频数据，目标是账号表现与下周期选题。",
    profile: null,
    mode: "professional",
    professionalOptions: {
      platform: "抖音",
      contentStructure: "复盘周期：2026-08-18 至 2026-08-24；统一观察窗口：发布后 7 天；业务转化口径：有效咨询",
      parsedEvidence: [
        "【业务文件解析结果】",
        "文件：beauty-video-data.csv",
        "类型：text/csv",
        "文件正文/数据：",
        parsedEvidence
      ].join("\n"),
      parseStatus: "parsed",
      sourceFilename: "beauty-video-data.csv"
    }
  });
  const composed = await buildBeautyWorkflowPrompt("video_data_review");

  let providerCalled = false;
  const result = await runAgent({
    tenantId: "beauty-video-data-review-runtime-smoke",
    userId: "beauty-video-data-review-runtime-smoke-user",
    role: "owner",
    planCode: "local_standard",
    requestedSkillId: "baolu_review_engine",
    capabilityId: "video_data_review",
    input,
    skillPrompt: composed.prompt,
    skillVersionOverride: composed.version,
    tenantProfile: {
      tenantId: "beauty-video-data-review-runtime-smoke",
      tenantName: "美业视频复盘脱敏测试",
      tenantType: "personal_ip",
      industry: "生活美容"
    },
    channel: "h5",
    deliveryPolicy: "clarify"
  }, {
    name: "forbidden-paid-provider",
    async complete() {
      providerCalled = true;
      throw new Error("structured video review must not call a provider");
    }
  });

  if (providerCalled) throw new Error("视频数据表复盘调用了模型 Provider");
  if (result.providerFailure) throw new Error(`零费用直出被标记为 Provider 失败：${result.providerFailure.code}`);
  if (!result.qualityFlags.includes("video_table_review_direct")) throw new Error("未命中视频数据表确定性直出引擎");
  for (const term of ["数据质量审计", "视频分层", "完播率深层归因", "下周期选题建议", "证据边界"]) {
    if (!result.answer.includes(term)) throw new Error(`正式复盘结果缺少：${term}`);
  }
  if (!result.answer.includes("平均完播率 36.5%")) throw new Error("百分比口径未按导出值保真");
  if (!result.answer.includes("业务转化合计 7")) throw new Error("有效咨询字段没有进入业务转化口径");
  await assertBeautyWorkflowRuntimeResult({
    capabilityId: "video_data_review",
    expectedSkillId: "baolu_review_engine",
    expectedSkillVersion: composed.version,
    result: {
      capabilityId: "video_data_review",
      skillId: result.skillId,
      skillVersion: result.skillVersion,
      answerText: result.answer,
      deliveryStatus: result.deliveryStatus === "needs_input" ? "needs_input" : "completed",
      qualityFlags: result.qualityFlags,
      creditCost: result.creditCost,
      providerFailure: result.providerFailure
    },
    observedProviderOutputs: [],
    replay: false,
    taskFactSource: input
  });
  console.log("BEAUTY_VIDEO_DATA_REVIEW_RUNTIME_P1_SMOKE_OK provider=0");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  BEAUTY_VIDEO_CONTENT_MEDIA_ACCEPTANCE_CONTRACT,
  BEAUTY_VIDEO_CONTENT_REVIEW_PENDING_WORKFLOW,
  BEAUTY_VIDEO_CONTENT_WORKFLOW_VERSION,
  assessBeautyVideoContentReadiness,
  assertBeautyVideoContentRealMediaAcceptance,
  buildPendingBeautyVideoContentReviewPrompt,
  inspectBeautyVideoContentFile,
  readBeautyVideoContentWorkflow
} from "../apps/api/src/products/beauty-industry/video-content-workflow.js";
import {
  BEAUTY_VIDEO_CONTENT_REVIEW_PENDING_INPUT_SCHEMA,
  getBeautyIndustryToolRegistration,
  listBeautyIndustryMcpTools
} from "../apps/api/src/products/beauty-industry/mcp-adapter.js";
import { assertPendingBeautyVideoContentReviewOutput } from "../apps/api/src/products/beauty-industry/output-contract.js";

async function main(): Promise<void> {
  const fixtureManifest = JSON.parse(await readFile("scripts/fixtures/beauty-video-content-av.fixture.json", "utf8")) as {
    asset: string;
    sha256: string;
    visualExpectation: string[];
    asrExpectation: string;
    durationSeconds: number;
    width: number;
    height: number;
    videoCodec: string;
    audioCodec: string;
    audioSampleRateHz: number;
    audioChannels: number;
  };
  if (/兰琪|品牌|价格|¥|疗效|治愈|顾客案例|经营数据/.test(fixtureManifest.asrExpectation)) {
    throw new Error("audio-video fixture transcript crossed the beauty compliance boundary");
  }
  const workflow = readBeautyVideoContentWorkflow({
    version: BEAUTY_VIDEO_CONTENT_WORKFLOW_VERSION,
    platform: "抖音",
    accountName: "脱敏测试账号",
    videoId: "masked-video-001",
    videoTitle: "基础护理流程说明",
    originalCaption: "只说明已确认的服务流程，不包含价格或疗效承诺。",
    businessObjective: "核对内容表达并形成可执行拍剪改进",
    targetAudience: "希望先了解服务流程的附近顾客",
    transcript: "用户提供的脱敏口播转写，仅作为补充资料。",
    visualEvidence: "用户确认：室内单人出镜，未确认设备与顾客素材。",
    sceneTimeline: "0-1秒：人物正面；1-8秒：说明流程。",
    factBoundary: "价格、案例、设备、疗效均待补；不得推断。"
  });

  const video = await readFile(fixtureManifest.asset);
  const fixtureHash = createHash("sha256").update(video).digest("hex");
  if (fixtureHash !== fixtureManifest.sha256) throw new Error("audio-video fixture hash drifted");
  const preflight = await inspectBeautyVideoContentFile({
    tenantId: "tenant-beauty-video-content-a",
    requestId: "preflight-test-001",
    filename: "beauty-video-content-av.mp4",
    mimeType: "video/mp4",
    buffer: video,
    maxBytes: 12 * 1024 * 1024
  });
  if (preflight.providerCalls !== 0 || preflight.creditCost !== 0) throw new Error("preflight must be zero-provider and zero-credit");
  if (preflight.retainedMedia || !preflight.sourceDeleted) throw new Error("preflight must delete the temporary source");
  if (preflight.durationSeconds !== fixtureManifest.durationSeconds) throw new Error(`exact duration not preserved: ${preflight.durationSeconds}`);
  if (preflight.width !== fixtureManifest.width || preflight.height !== fixtureManifest.height) throw new Error("fixture dimensions drifted");
  if (preflight.videoCodec !== fixtureManifest.videoCodec) throw new Error("fixture video codec drifted");
  if (preflight.audioCodec !== fixtureManifest.audioCodec) throw new Error("fixture audio codec drifted");
  if (preflight.audioSampleRateHz !== fixtureManifest.audioSampleRateHz || preflight.audioChannels !== fixtureManifest.audioChannels) {
    throw new Error("fixture audio stream drifted");
  }

  const readiness = assessBeautyVideoContentReadiness({ ...workflow, mediaPreflight: preflight });
  if (!readiness.preflightReady || !readiness.executionReady || readiness.missing.length > 0) throw new Error("admitted readiness did not accept complete evidence");

  let damagedRejected = false;
  try {
    await inspectBeautyVideoContentFile({
      tenantId: "tenant-beauty-video-content-a",
      requestId: "preflight-test-bad",
      filename: "damaged.mp4",
      mimeType: "video/mp4",
      buffer: Buffer.from("not-a-video"),
      maxBytes: 12 * 1024 * 1024
    });
  } catch (error) {
    damagedRejected = error instanceof Error && error.message === "beauty_video_content_metadata_invalid";
  }
  if (!damagedRejected) throw new Error("damaged video did not fail closed");

  const pendingSchema = BEAUTY_VIDEO_CONTENT_REVIEW_PENDING_INPUT_SCHEMA as { properties?: { videoContentWorkflow?: { properties?: { version?: { const?: string } } } } };
  if (pendingSchema.properties?.videoContentWorkflow?.properties?.version?.const !== BEAUTY_VIDEO_CONTENT_WORKFLOW_VERSION) {
    throw new Error("Web/WorkBuddy version contract drifted");
  }
  const publicTools = listBeautyIndustryMcpTools({
    credentialId: "active-contract-smoke",
    tenantId: "tenant-beauty-video-content-a",
    userId: "user-a",
    productCode: "beauty-industry",
    operatingEntityId: "tenant-beauty-video-content-a",
    scopes: ["acquisition:video-content-review"],
    entitled: true
  });
  if (!publicTools.some((tool) => tool.name === BEAUTY_VIDEO_CONTENT_REVIEW_PENDING_WORKFLOW.toolName)) throw new Error("admitted tool missing from tools/list");
  const activeRegistration = getBeautyIndustryToolRegistration(BEAUTY_VIDEO_CONTENT_REVIEW_PENDING_WORKFLOW.toolName);
  if (activeRegistration.capabilityId !== "shooting_editing") throw new Error("admitted tool capability drifted");

  const prompt = await buildPendingBeautyVideoContentReviewPrompt();
  if (!prompt.version.includes("baolu_content_creator@5.0.0")) throw new Error("formal primary skill version missing");
  if (/创始人\s*IP|餐饮|外卖|牛肉面|火锅|烧烤|兰琪|枕水江南/.test(prompt.prompt)) throw new Error("cross-product prompt contamination");
  if (!prompt.prompt.includes("shooting_editing") || !prompt.prompt.includes("八、核心改进点")) throw new Error("formal shooting contract missing");

  if (BEAUTY_VIDEO_CONTENT_MEDIA_ACCEPTANCE_CONTRACT.templateFallbackAllowed !== false) throw new Error("template fallback became allowed");
  const acceptedEvidence = assertBeautyVideoContentRealMediaAcceptance({
    expectedVisualFacts: fixtureManifest.visualExpectation,
    expectedTranscript: fixtureManifest.asrExpectation,
    visual: {
      provider: "aliyun-bailian",
      model: "qwen-vl-max",
      status: "succeeded",
      observedFacts: fixtureManifest.visualExpectation
    },
    asr: {
      provider: "aliyun-bailian",
      model: "qwen3-asr-flash",
      status: "succeeded",
      transcript: fixtureManifest.asrExpectation
    },
    formalInput: {
      visualEvidence: fixtureManifest.visualExpectation.join("；"),
      transcript: fixtureManifest.asrExpectation
    },
    fallbackUsed: false
  });
  if (!acceptedEvidence.visualMatched || !acceptedEvidence.asrMatched || !acceptedEvidence.formalInputMatched) {
    throw new Error("dual evidence did not enter the formal contract");
  }

  for (const invalid of [
    { fallbackUsed: true },
    { visual: { provider: "aliyun-bailian", model: "qwen-vl-max", status: "succeeded", observedFacts: ["未知画面"] } },
    { asr: { provider: "aliyun-bailian", model: "qwen3-asr-flash", status: "succeeded", transcript: "错误转写" } }
  ]) {
    let rejected = false;
    try {
      assertBeautyVideoContentRealMediaAcceptance({
        expectedVisualFacts: fixtureManifest.visualExpectation,
        expectedTranscript: fixtureManifest.asrExpectation,
        visual: {
          provider: "aliyun-bailian",
          model: "qwen-vl-max",
          status: "succeeded",
          observedFacts: fixtureManifest.visualExpectation,
          ...(invalid.visual ?? {})
        },
        asr: {
          provider: "aliyun-bailian",
          model: "qwen3-asr-flash",
          status: "succeeded",
          transcript: fixtureManifest.asrExpectation,
          ...(invalid.asr ?? {})
        },
        formalInput: {
          visualEvidence: fixtureManifest.visualExpectation.join("；"),
          transcript: fixtureManifest.asrExpectation
        },
        fallbackUsed: invalid.fallbackUsed ?? false
      });
    } catch { rejected = true; }
    if (!rejected) throw new Error("invalid real-media acceptance evidence did not fail closed");
  }

  const draft = [
    "视频基本信息\n平台：抖音；时长：1.000秒；视觉成功回执：已核对；ASR成功回执：已核对。",
    "现有版本诊断\n只依据本轮脱敏证据。",
    "一、优化版选题定位\n待真实业务确认。",
    "二、优化版口播逐字稿\n仅保留已确认原意。",
    "三、优化版拍摄脚本\n镜头与B-roll按证据安排。",
    "四、拍摄注意事项\n设备未见，实际设备待确认。",
    "五、优化版剪辑EDL\n按1.000秒真实时长编排。",
    "六、优化版发布策略\n发布时间按账号后台数据确认。",
    "七、投流建议\n自然发布后再决定，不编预算。",
    "八、核心改进点\n指标待发布验证。"
  ].join("\n\n");
  assertPendingBeautyVideoContentReviewOutput(draft);

  console.log("BEAUTY_VIDEO_CONTENT_REVIEW_RUNTIME_P1_SMOKE_OK provider=0 credits=0 publicTool=true fixture=dual_stream acceptance=visual_plus_asr");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

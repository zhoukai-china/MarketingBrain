import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import dotenv from "dotenv";

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(process.cwd());
const FIXTURE_PATH = path.join(REPO_ROOT, "scripts", "fixtures", "beauty-video-content-av.mp4");
const MANIFEST_PATH = path.join(REPO_ROOT, "scripts", "fixtures", "beauty-video-content-av.fixture.json");
const EXPECTED_SHA256 = "bd613075b9b7044947809fd8bebab44bc7c488294c453dc030fae3a7a5e88c1a";
const VISUAL_MODEL = "qwen-vl-max";
const ASR_MODEL = "qwen3-asr-flash";
const ALLOWED_ENDPOINT_HOSTS = new Set([
  "dashscope.aliyuncs.com",
  "ws-gws91avluml5mkau.cn-beijing.maas.aliyuncs.com"
]);

type SafeObservation = {
  stage: "visual" | "asr";
  provider: "aliyun-bailian";
  model: string;
  region: string;
  endpointHost: string;
  inputMediaType: string;
  terminalStatus: "succeeded" | "failed" | "timed_out" | "cancelled";
  terminalCode: string;
  requestFingerprint: string;
  requestFingerprintSource: "provider" | "local";
  httpStatus?: number;
  providerCode?: string;
  finishReason?: string;
  elapsedMs: number;
  timeoutMs: number;
  billingStarted: "confirmed" | "not_started" | "unknown";
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    audioSeconds?: number;
  };
};

interface FixtureManifest {
  asset: string;
  sha256: string;
  byteSize: number;
  durationSeconds: number;
  width: number;
  height: number;
  videoCodec: string;
  audioCodec: string;
  audioSampleRateHz: number;
  audioChannels: number;
  visualExpectation: string[];
  asrExpectation: string;
}

interface SafeReport {
  acceptanceId: "BY-15";
  approvedScope: {
    fixture: string;
    maxCalls: { visual: 1; asr: 1 };
    retryAllowed: false;
    modelSwitchAllowed: false;
    expectedCostCny: "about 0.10";
    conservativeCostCeilingCny: 0.2;
    absoluteUserApprovedCeilingCny: 1;
  };
  asset: {
    sha256: string;
    byteSize: number;
    durationSeconds: number;
    width: number;
    height: number;
    videoCodec: string;
    audioCodec: string;
    audioSampleRateHz: number;
    audioChannels: number;
    derivedFrames: number;
    derivedAudioFormat: "mp3-16khz-mono";
  };
  calls: { visual: number; asr: number };
  observations: SafeObservation[];
  gates: {
    visualExpectedFactsMatched: boolean;
    asrExpectedTranscriptMatched: boolean;
    formalInputMatched: boolean;
    fallbackUsed: false;
  };
  evidence: {
    visualClassification?: Record<string, boolean>;
    visualResponseFingerprint?: string;
    transcriptFingerprint?: string;
    transcriptNormalizedLength?: number;
  };
  result: "passed" | "failed";
  failureCode?: string;
  temporaryDerivedMediaDeleted: boolean;
  rawProviderResponsePersisted: false;
}

const report: SafeReport = {
  acceptanceId: "BY-15",
  approvedScope: {
    fixture: "scripts/fixtures/beauty-video-content-av.mp4",
    maxCalls: { visual: 1, asr: 1 },
    retryAllowed: false,
    modelSwitchAllowed: false,
    expectedCostCny: "about 0.10",
    conservativeCostCeilingCny: 0.2,
    absoluteUserApprovedCeilingCny: 1
  },
  asset: {
    sha256: "",
    byteSize: 0,
    durationSeconds: 0,
    width: 0,
    height: 0,
    videoCodec: "",
    audioCodec: "",
    audioSampleRateHz: 0,
    audioChannels: 0,
    derivedFrames: 0,
    derivedAudioFormat: "mp3-16khz-mono"
  },
  calls: { visual: 0, asr: 0 },
  observations: [],
  gates: {
    visualExpectedFactsMatched: false,
    asrExpectedTranscriptMatched: false,
    formalInputMatched: false,
    fallbackUsed: false
  },
  evidence: {},
  result: "failed",
  temporaryDerivedMediaDeleted: false,
  rawProviderResponsePersisted: false
};

async function main(): Promise<void> {
  let tempRoot = "";
  let exitCode = 2;

  try {
  assert.equal(process.env.BY15_REAL_MEDIA_APPROVED, "true", "by15_explicit_approval_gate_missing");
  dotenv.config({ path: path.join(REPO_ROOT, "apps", "api", ".env"), override: false, quiet: true });

  const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8")) as FixtureManifest;
  assert.equal(manifest.asset, report.approvedScope.fixture, "by15_fixture_manifest_path_mismatch");
  assert.equal(manifest.sha256, EXPECTED_SHA256, "by15_fixture_manifest_hash_mismatch");
  assert.deepEqual(manifest.visualExpectation, [
    "浅绿色竖屏背景",
    "上半部深绿色矩形",
    "下半部金色矩形",
    "无人物",
    "无文字"
  ], "by15_visual_expectation_changed");
  assert.equal(manifest.asrExpectation, "这是美业视频内容复盘测试样本，不包含真实客户信息。", "by15_asr_expectation_changed");

  const fixture = await readFile(FIXTURE_PATH);
  const fixtureHash = sha256(fixture);
  assert.equal(fixtureHash, EXPECTED_SHA256, "by15_fixture_hash_mismatch");
  const fixtureStat = await stat(FIXTURE_PATH);
  assert.equal(fixtureStat.size, manifest.byteSize, "by15_fixture_size_mismatch");

  const apiKey = process.env.ALIYUN_API_KEY?.trim() || process.env.DASHSCOPE_API_KEY?.trim();
  const baseUrl = process.env.ALIYUN_BASE_URL?.trim() || process.env.DASHSCOPE_BASE_URL?.trim();
  assert.ok(apiKey, "by15_media_provider_key_missing");
  assert.ok(baseUrl, "by15_media_provider_base_url_missing");
  const endpointHost = new URL(baseUrl).hostname.toLowerCase();
  assert.ok(ALLOWED_ENDPOINT_HOSTS.has(endpointHost), "by15_media_provider_endpoint_not_allowlisted");
  assert.equal(process.env.ALIYUN_VIDEO_MODEL, VISUAL_MODEL, "by15_visual_model_mismatch");
  assert.equal(process.env.ALIYUN_ASR_MODEL, ASR_MODEL, "by15_asr_model_mismatch");

  tempRoot = await mkdtemp(path.join(tmpdir(), "beauty-by15-live-acceptance-"));
  const probe = await probeFixture(FIXTURE_PATH);
  assert.equal(probe.durationSeconds, manifest.durationSeconds, "by15_fixture_duration_mismatch");
  assert.equal(probe.width, manifest.width, "by15_fixture_width_mismatch");
  assert.equal(probe.height, manifest.height, "by15_fixture_height_mismatch");
  assert.equal(probe.videoCodec, manifest.videoCodec, "by15_fixture_video_codec_mismatch");
  assert.equal(probe.audioCodec, manifest.audioCodec, "by15_fixture_audio_codec_mismatch");
  assert.equal(probe.audioSampleRateHz, manifest.audioSampleRateHz, "by15_fixture_audio_rate_mismatch");
  assert.equal(probe.audioChannels, manifest.audioChannels, "by15_fixture_audio_channels_mismatch");
  report.asset = {
    sha256: fixtureHash,
    byteSize: fixtureStat.size,
    ...probe,
    derivedFrames: 0,
    derivedAudioFormat: "mp3-16khz-mono"
  };

  const frameDataUrls = await extractFrames(FIXTURE_PATH, tempRoot);
  report.asset.derivedFrames = frameDataUrls.length;
  const audioPath = await extractAudio(FIXTURE_PATH, tempRoot);
  const audio = await readFile(audioPath);

  const { callObservedMediaChat } = await import("../apps/api/src/services/media-provider-observation.js");
  const { assertBeautyVideoContentRealMediaAcceptance } = await import("../apps/api/src/products/beauty-industry/video-content-workflow.js");
  const timeoutMs = 120_000;

  report.calls.visual += 1;
  const visualResult = await callObservedMediaChat({
    stage: "visual",
    model: VISUAL_MODEL,
    baseUrl,
    apiKey,
    inputMediaType: "image/png-derived-from-approved-fixture",
    timeoutMs,
    body: {
      model: VISUAL_MODEL,
      temperature: 0,
      messages: [{
        role: "user",
        content: [
          {
            type: "text",
            text: [
              "你是严格的合成测试画面核验器。只根据随后三张关键帧判断可见事实，不推测品牌、门店、人物或业务。",
              "请只返回一个 JSON 对象，不要 Markdown、解释或额外文字。字段必须完整且值只能是 boolean：",
              '{"portraitLightGreenBackground":boolean,"upperDarkGreenRectangle":boolean,"lowerGoldRectangle":boolean,"hasPerson":boolean,"hasVisibleText":boolean}',
              "三帧来自同一个已授权合成测试视频；按所有帧一致可见的事实作答。"
            ].join("\n")
          },
          ...frameDataUrls.map((url) => ({ type: "image_url", image_url: { url } }))
        ]
      }]
    }
  });
  report.observations.push(visualResult.observation);
  report.evidence.visualResponseFingerprint = sha256(Buffer.from(visualResult.content, "utf8")).slice(0, 16);
  const visualClassification = parseVisualClassification(visualResult.content);
  report.evidence.visualClassification = visualClassification;
  assert.deepEqual(visualClassification, {
    portraitLightGreenBackground: true,
    upperDarkGreenRectangle: true,
    lowerGoldRectangle: true,
    hasPerson: false,
    hasVisibleText: false
  }, "by15_visual_expected_facts_mismatch");
  report.gates.visualExpectedFactsMatched = true;

  report.calls.asr += 1;
  const asrResult = await callObservedMediaChat({
    stage: "asr",
    model: ASR_MODEL,
    baseUrl,
    apiKey,
    inputMediaType: "audio/mpeg-derived-from-approved-fixture",
    timeoutMs,
    body: {
      model: ASR_MODEL,
      messages: [{
        role: "user",
        content: [{
          type: "input_audio",
          input_audio: { data: `data:audio/mpeg;base64,${audio.toString("base64")}` }
        }]
      }],
      asr_options: { enable_itn: false }
    }
  });
  report.observations.push(asrResult.observation);
  const normalizedTranscript = normalizeEvidence(asrResult.content);
  const normalizedExpectedTranscript = normalizeEvidence(manifest.asrExpectation);
  report.evidence.transcriptFingerprint = sha256(Buffer.from(normalizedTranscript, "utf8")).slice(0, 16);
  report.evidence.transcriptNormalizedLength = normalizedTranscript.length;
  assert.equal(normalizedTranscript, normalizedExpectedTranscript, "by15_asr_expected_transcript_mismatch");
  report.gates.asrExpectedTranscriptMatched = true;

  const observedFacts = [
    "浅绿色竖屏背景",
    "上半部深绿色矩形",
    "下半部金色矩形",
    "无人物",
    "无文字"
  ];
  assertBeautyVideoContentRealMediaAcceptance({
    expectedVisualFacts: manifest.visualExpectation,
    expectedTranscript: manifest.asrExpectation,
    visual: {
      provider: "aliyun-bailian",
      model: VISUAL_MODEL,
      status: visualResult.observation.terminalStatus,
      observedFacts
    },
    asr: {
      provider: "aliyun-bailian",
      model: ASR_MODEL,
      status: asrResult.observation.terminalStatus,
      transcript: asrResult.content
    },
    formalInput: {
      visualEvidence: observedFacts.join("；"),
      transcript: asrResult.content
    },
    fallbackUsed: false
  });
  report.gates.formalInputMatched = true;
  report.result = "passed";
  exitCode = 0;
  } catch (error) {
    const observation = readSafeObservation(error);
    if (observation && !report.observations.some((item) => item.requestFingerprint === observation.requestFingerprint)) {
      report.observations.push(observation);
    }
    report.failureCode = safeFailureCode(error);
  } finally {
    if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
    report.temporaryDerivedMediaDeleted = tempRoot ? !(await exists(tempRoot)) : true;
    const reportRoot = path.join("F:\\思潼AI增长os\\test-environments\\beauty-industry-acceptance-20260821", "reports");
    const reportPath = path.join(reportRoot, "by15-live-media-acceptance-safe.json");
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = exitCode;
  }
}

void main();

async function probeFixture(inputPath: string): Promise<{
  durationSeconds: number;
  width: number;
  height: number;
  videoCodec: string;
  audioCodec: string;
  audioSampleRateHz: number;
  audioChannels: number;
}> {
  const ffprobe = await resolveMediaBinary("ffprobe");
  const { stdout } = await execFileAsync(ffprobe, [
    "-v", "error",
    "-show_entries", "format=duration:stream=codec_type,codec_name,width,height,sample_rate,channels",
    "-of", "json",
    inputPath
  ], { windowsHide: true, timeout: 15_000, maxBuffer: 1024 * 1024 });
  const parsed = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number; sample_rate?: string; channels?: number }>;
  };
  const video = parsed.streams?.find((item) => item.codec_type === "video");
  const audio = parsed.streams?.find((item) => item.codec_type === "audio");
  return {
    durationSeconds: Number(Number(parsed.format?.duration).toFixed(3)),
    width: Number(video?.width),
    height: Number(video?.height),
    videoCodec: String(video?.codec_name || ""),
    audioCodec: String(audio?.codec_name || ""),
    audioSampleRateHz: Number(audio?.sample_rate),
    audioChannels: Number(audio?.channels)
  };
}

async function extractFrames(inputPath: string, outputRoot: string): Promise<string[]> {
  const ffmpeg = await resolveMediaBinary("ffmpeg");
  const timestamps = ["0", "4", "7"];
  const urls: string[] = [];
  for (const [index, timestamp] of timestamps.entries()) {
    const outputPath = path.join(outputRoot, `frame-${index}.png`);
    await execFileAsync(ffmpeg, ["-y", "-ss", timestamp, "-i", inputPath, "-frames:v", "1", outputPath], {
      windowsHide: true,
      timeout: 20_000,
      maxBuffer: 2 * 1024 * 1024
    });
    urls.push(`data:image/png;base64,${(await readFile(outputPath)).toString("base64")}`);
  }
  return urls;
}

async function extractAudio(inputPath: string, outputRoot: string): Promise<string> {
  const ffmpeg = await resolveMediaBinary("ffmpeg");
  const outputPath = path.join(outputRoot, "audio.mp3");
  await execFileAsync(ffmpeg, ["-y", "-i", inputPath, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "64k", outputPath], {
    windowsHide: true,
    timeout: 30_000,
    maxBuffer: 2 * 1024 * 1024
  });
  return outputPath;
}

async function resolveMediaBinary(name: "ffmpeg" | "ffprobe"): Promise<string> {
  const bundled = path.join(
    process.env.USERPROFILE ?? "",
    ".workbuddy",
    "binaries",
    "ffmpeg",
    "ffmpeg-8.1.1-essentials_build",
    "bin",
    `${name}.exe`
  );
  try {
    await stat(bundled);
    return bundled;
  } catch {
    return name;
  }
}

function parseVisualClassification(content: string): Record<string, boolean> {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  assert.ok(start >= 0 && end > start, "by15_visual_response_not_json");
  const value = JSON.parse(content.slice(start, end + 1)) as Record<string, unknown>;
  const keys = [
    "portraitLightGreenBackground",
    "upperDarkGreenRectangle",
    "lowerGoldRectangle",
    "hasPerson",
    "hasVisibleText"
  ];
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), "by15_visual_response_schema_mismatch");
  for (const key of keys) assert.equal(typeof value[key], "boolean", "by15_visual_response_boolean_required");
  return Object.fromEntries(keys.map((key) => [key, value[key] as boolean]));
}

function normalizeEvidence(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[\s，。；、,.!?！？：:'"“”‘’（）()\[\]【】_-]+/g, "");
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function readSafeObservation(error: unknown): SafeObservation | undefined {
  if (!error || typeof error !== "object" || !("observation" in error)) return undefined;
  return (error as { observation?: SafeObservation }).observation;
}

function safeFailureCode(error: unknown): string {
  const value = error instanceof Error ? error.message : "by15_unknown_failure";
  return value.replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 160) || "by15_unknown_failure";
}

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

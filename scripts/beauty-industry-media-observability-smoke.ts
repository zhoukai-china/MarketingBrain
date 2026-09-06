import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MediaProviderCallError,
  callObservedMediaChat,
  fingerprintProviderRequest,
  summarizeMediaAnalysis,
  type MediaProviderObservation
} from "../apps/api/src/services/media-provider-observation.js";

const fakeKey = "fixture-key-never-sent";
const base = {
  baseUrl: "https://fixture.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
  apiKey: fakeKey,
  timeoutMs: 100,
  body: { model: "fixture-model", messages: [] }
};

async function main(): Promise<void> {
const visual = await callObservedMediaChat({
  ...base,
  stage: "visual",
  model: "qwen-vl-max",
  inputMediaType: "image/data-url",
  fetchImpl: async () => jsonResponse({ id: "provider-request-visual-secret", choices: [{ finish_reason: "stop", message: { content: "三帧显示无人物护理台、自然光和稳定字幕安全区。" } }], usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 } }, 200, "provider-request-visual-secret")
});
const asr = await callObservedMediaChat({
  ...base,
  stage: "asr",
  model: "qwen3-asr-flash",
  inputMediaType: "audio/mpeg",
  fetchImpl: async () => jsonResponse({ request_id: "provider-request-asr-secret", choices: [{ finish_reason: "stop", message: { content: "今天演示日常护理流程。" } }], usage: { prompt_tokens: 4, completion_tokens: 6, total_tokens: 10, seconds: 8 } }, 200)
});
assert.equal(visual.observation.billingStarted, "confirmed");
assert.equal(asr.observation.billingStarted, "confirmed");
assert.equal(visual.observation.model, "qwen-vl-max");
assert.equal(asr.observation.model, "qwen3-asr-flash");
assert.equal(visual.observation.region, "cn-beijing");
assert.equal(visual.observation.inputMediaType, "image/data-url");
assert.equal(asr.observation.inputMediaType, "audio/mpeg");
assert.equal(visual.observation.finishReason, "stop");
assert.equal(visual.observation.httpStatus, 200);
assert.match(visual.observation.requestFingerprint, /^[a-f0-9]{16}$/);
assert.equal(visual.observation.requestFingerprint, fingerprintProviderRequest("provider-request-visual-secret"));
assert.ok(!JSON.stringify([visual.observation, asr.observation]).includes("provider-request-"), "raw provider request IDs must never be observed");

const complete = summarizeMediaAnalysis({ visualRequested: true, asrRequested: true, visualContent: visual.content, transcript: asr.content, observations: [visual.observation, asr.observation] });
assert.deepEqual(complete, { status: "complete", usable: true, failedStages: [] });

const forbidden = await captureFailure(callObservedMediaChat({
  ...base,
  stage: "visual",
  model: "qwen-vl-max",
  inputMediaType: "image/data-url",
  fetchImpl: async () => jsonResponse({ request_id: "provider-request-denied-secret", code: "AccessDenied.Model", message: "raw account detail must not escape" }, 403)
}));
assert.equal(forbidden.observation.httpStatus, 403);
assert.equal(forbidden.observation.providerCode, "AccessDenied.Model");
assert.equal(forbidden.observation.billingStarted, "unknown");
assert.ok(!JSON.stringify(forbidden).includes("raw account detail"));
assert.ok(!JSON.stringify(forbidden).includes("provider-request-denied-secret"));

const partial = summarizeMediaAnalysis({ visualRequested: true, asrRequested: true, transcript: asr.content, observations: [forbidden.observation, asr.observation] });
assert.deepEqual(partial, { status: "partial", usable: true, failedStages: ["visual"] });
const fullFailure = summarizeMediaAnalysis({ visualRequested: true, asrRequested: true, observations: [forbidden.observation, { ...forbidden.observation, stage: "asr" }] });
assert.deepEqual(fullFailure, { status: "failed", usable: false, failedStages: ["visual", "asr"] });

const timeout = await captureFailure(callObservedMediaChat({
  ...base,
  stage: "asr",
  model: "qwen3-asr-flash",
  inputMediaType: "audio/mpeg",
  timeoutMs: 5,
  fetchImpl: (_input, init) => waitForAbort(init?.signal)
}));
assert.equal(timeout.observation.terminalStatus, "timed_out");
assert.equal(timeout.observation.terminalCode, "provider_timeout");
assert.equal(summarizeMediaAnalysis({ visualRequested: false, asrRequested: true, observations: [timeout.observation] }).status, "timed_out");

const cancelController = new AbortController();
const cancelledPromise = callObservedMediaChat({
  ...base,
  stage: "visual",
  model: "qwen-vl-max",
  inputMediaType: "image/data-url",
  signal: cancelController.signal,
  fetchImpl: (_input, init) => waitForAbort(init?.signal)
});
cancelController.abort(new Error("fixture_cancel"));
const cancelled = await captureFailure(cancelledPromise);
assert.equal(cancelled.observation.terminalStatus, "cancelled");
assert.equal(summarizeMediaAnalysis({ visualRequested: true, asrRequested: false, observations: [cancelled.observation] }).status, "cancelled");

const routeSource = readFileSync("apps/api/src/routes/media.ts", "utf8");
const pageSource = readFileSync("apps/web/src/pages/BeautyIndustryAcquisitionPage.tsx", "utf8");
const asrBlock = routeSource.match(/async function transcribeMedia[\s\S]*?async function extractAudioForAsr/)?.[0] ?? "";
assert.ok(asrBlock.includes('stage: "asr"'));
assert.ok(!asrBlock.includes("temperature:"), "Qwen ASR requests must not receive the visual model temperature parameter");
assert.ok(routeSource.includes('event: "media_analysis.terminal"'));
assert.ok(routeSource.includes("providerTrace"));
assert.ok(pageSource.includes('name: "beauty.video_content_review"'), "admitted video content review tool is missing");
assert.ok(pageSource.includes("workflow={videoContentWorkflow}"), "the admitted page must pass the formal evidence workflow instead of a free-text route");
assert.ok(pageSource.includes("runVideoContentReview"), "the admitted page must retain its evidence-gated execution path");
assert.ok(/runSelectedTask\(["']beauty\.video_content_review["'][\s\S]*?videoContentWorkflow\)/.test(pageSource), "video content review must send the formal evidence workflow to shared execution");
assert.ok(!routeSource.includes("reserveCreditsBeforeProvider"), "file parsing must not reserve product credits before usable evidence exists");

console.log("beauty_industry_media_observability_smoke=PASS;provider_calls=0;complete_partial_failed_timeout_cancelled=PASS");
}

function jsonResponse(payload: unknown, status: number, requestId?: string): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json", ...(requestId ? { "X-Request-Id": requestId } : {}) } });
}

async function captureFailure(promise: Promise<unknown>): Promise<MediaProviderCallError> {
  try {
    await promise;
    assert.fail("expected MediaProviderCallError");
  } catch (error) {
    assert.ok(error instanceof MediaProviderCallError);
    return error;
  }
}

function waitForAbort(signal?: AbortSignal | null): Promise<Response> {
  return new Promise((_resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

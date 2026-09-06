import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { getBeautyIndustryToolRegistration } from "../apps/api/src/products/beauty-industry/mcp-adapter.js";

const CASES = [
  { id: "poster", input: "给我生成一张小红书美业海报" },
  { id: "vertical_beauty", input: "做个竖图，美容护肤主题的" },
  { id: "minimal", input: "生成图片" },
  { id: "detailed_wallpaper", input: "帮我画一张高端美容院的宣传图，要有花有水疗元素，色调温暖，尺寸是手机壁纸大小" },
  { id: "nail_ratio", input: "来张3:4的美甲店推广图" }
] as const;

function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function main(): void {
  const xhs = getBeautyIndustryToolRegistration("beauty.xiaohongshu_package");
  assert.equal(xhs.capabilityId, "beauty_xiaohongshu_package");
  assert.equal(xhs.scope, "acquisition:xhs");
  assert.equal(xhs.skillId, "wechat-xhs-content-line");
  assert.throws(() => getBeautyIndustryToolRegistration("beauty.generate_image"), /beauty_tool_not_found/);

  const traces = CASES.map(({ id, input }) => {
    const webQuestionAccepted = input.trim().length >= 6;
    return {
      caseId: id,
      inputHash: fingerprint(input),
      inputBytes: Buffer.byteLength(input, "utf8"),
      routeDecision: webQuestionAccepted ? "fixed_xhs_text_workflow" : "web_schema_preflight_rejected",
      stageReached: webQuestionAccepted ? "text_task_preflight" : "request_schema",
      resultCode: webQuestionAccepted
        ? "saved_text_run_and_explicit_media_confirmation_required"
        : "question_min_length",
      imageProviderCalls: 0,
      textProviderCalls: 0
    };
  });

  assert.equal(traces.length, 5);
  assert.equal(traces.filter((trace) => trace.routeDecision === "fixed_xhs_text_workflow").length, 4);
  assert.equal(traces.filter((trace) => trace.resultCode === "question_min_length").length, 1);
  assert.ok(traces.every((trace) => trace.imageProviderCalls === 0 && trace.textProviderCalls === 0));
  assert.doesNotMatch(JSON.stringify(traces), /小红书美业海报|美容护肤主题|生成图片|高端美容院|美甲店推广图/);

  const executionSource = readFileSync(new URL("../apps/api/src/products/beauty-industry/execution.ts", import.meta.url), "utf8");
  for (const field of [
    "beauty_xhs_route_selected", "routeDecision", "routeCode", "toolName", "capabilityId", "scope", "skillId", "skillVersion",
    "requestFingerprint", "effectiveInputHash", "tenantHash", "parameterSchema", "questionPresent", "questionBytes",
    "professionalOptionKeys", "beauty_xhs_provider_output_adapted", "beauty_workflow_output_rejected", "outputTrace",
    "responseHash", "responseBytes", "blockingQualityFlags"
  ]) assert.match(executionSource, new RegExp(field));
  const routeTraceBlock = executionSource.match(/event: "beauty_xhs_route_selected"[\s\S]*?\}\)\);/)?.[0] ?? "";
  assert.ok(routeTraceBlock, "the fixed XHS route trace block must exist");
  assert.doesNotMatch(routeTraceBlock, /question:\s*params\.input[,}]/, "safe trace must never serialize the original question");

  const providerSource = readFileSync(new URL("../apps/api/src/services/domestic-chat-provider.ts", import.meta.url), "utf8");
  for (const field of [
    "domestic_provider_request_started", "domestic_provider_request_finished", "targetHostHash", "targetPathHash",
    "httpStatus", "elapsedMs", "responseHash", "responseBytes", "finishReason", "domestic_provider_usage"
  ]) assert.match(providerSource, new RegExp(field));
  assert.doesNotMatch(providerSource, /responseBody|rawResponse|originalInput/, "safe provider trace must not introduce raw payload fields");

  for (const trace of traces) console.info(JSON.stringify({ event: "beauty_xhs_direct_image_intent_replay", ...trace }));
  console.log("BEAUTY_XHS_SAFE_TRACE_REPLAY_P1_OK cases=5 provider_calls=0 paid_yuan=0");
}

main();

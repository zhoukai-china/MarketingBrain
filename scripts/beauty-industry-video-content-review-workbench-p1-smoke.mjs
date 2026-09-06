import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(path, "utf8");

const [page, component, contract, routes, adapter, workflows, admission, outputContract, fixtureGenerator, fixtureManifestText] = await Promise.all([
  read("apps/web/src/pages/BeautyIndustryAcquisitionPage.tsx"),
  read("apps/web/src/components/acquisition/BeautyVideoContentReviewWorkbench.tsx"),
  read("apps/api/src/products/beauty-industry/video-content-workflow.ts"),
  read("apps/api/src/routes/beauty-industry.ts"),
  read("apps/api/src/products/beauty-industry/mcp-adapter.ts"),
  read("apps/api/src/products/beauty-industry/workflows.ts"),
  read("scripts/beauty-industry-skill-admission-smoke.ts"),
  read("apps/api/src/products/beauty-industry/output-contract.ts"),
  read("scripts/generate-beauty-video-content-av-fixture.ps1"),
  read("scripts/fixtures/beauty-video-content-av.fixture.json")
]);
const fixtureManifest = JSON.parse(fixtureManifestText);

assert.match(page, /\/agents\/beauty-industry\/acquisition\/video\/content-review/, "dedicated stable route is missing");
assert.match(page, /BeautyVideoContentReviewWorkbench/, "dedicated workbench is not wired");
assert.match(page, /beauty\.video_content_review/, "fixed pending tool identity is missing from the page mapping");
assert.match(component, /video_content_review_workflow_v1/, "versioned Web\/WorkBuddy workflow is missing");
assert.match(component, /视频内容复盘/);
assert.match(component, /视觉解析/);
assert.match(component, /语音转写/);
assert.match(component, /准入已通过|已开放/);
assert.doesNotMatch(component, /通用文本框|示例结果/);

for (const field of ["platform", "accountName", "videoId", "videoTitle", "originalCaption", "businessObjective", "targetAudience", "transcript", "visualEvidence", "sceneTimeline", "factBoundary", "mediaPreflight"]) {
  assert.match(contract, new RegExp(`\\b${field}\\b`), `shared workflow field missing: ${field}`);
}
for (const term of ["shooting_editing", "baolu_content_creator", "beauty-industry-content-diff", "beauty-industry-compliance", "qwen-vl-max", "qwen3-asr-flash"]) {
  assert.match(contract, new RegExp(term), `pending formal mapping missing: ${term}`);
}
for (const field of ["videoCodec", "audioCodec", "audioSampleRateHz", "audioChannels"]) {
  assert.match(contract, new RegExp(`\\b${field}\\b`), `dual-stream preflight field missing: ${field}`);
}
assert.match(contract, /BEAUTY_VIDEO_CONTENT_MEDIA_ACCEPTANCE_CONTRACT/);
assert.match(contract, /templateFallbackAllowed:\s*false/);
assert.match(contract, /requireBothEvidenceInFormalInput:\s*true/);
assert.match(component, /未检测到音频流|audioCodec/, "audio stream state is not visible in the preflight receipt");
assert.doesNotMatch(component, /onChange\(\{ \.\.\.props\.workflow, \[key\]: value, mediaPreflight: undefined \}\)/, "editing confirmed evidence after preflight must not discard the receipt and permanently block the run button");
assert.match(fixtureGenerator, /Microsoft Huihui Desktop/);
assert.match(fixtureGenerator, /System\.Speech/);
assert.equal(fixtureManifest.asset, "scripts/fixtures/beauty-video-content-av.mp4");
assert.match(fixtureManifest.sha256, /^[a-f0-9]{64}$/);
assert.equal(fixtureManifest.videoCodec, "h264");
assert.equal(fixtureManifest.audioCodec, "aac");
assert.equal(fixtureManifest.audioSampleRateHz, 22050);
assert.equal(fixtureManifest.audioChannels, 1);
assert.match(fixtureManifest.asrExpectation, /不包含真实客户信息/);
for (const heading of ["视频基本信息", "现有版本诊断", "一、优化版选题定位", "二、优化版口播逐字稿", "三、优化版拍摄脚本", "四、拍摄注意事项", "五、优化版剪辑EDL", "六、优化版发布策略", "七、投流建议", "八、核心改进点"]) {
  assert.match(contract + outputContract, new RegExp(heading), `formal output heading missing: ${heading}`);
}

assert.match(routes, /\/beauty-industry\/video-content\/preflight/, "tenant-protected zero-cost preflight route is missing");
assert.match(routes, /resolveRequestContext[\s\S]*assertAgentAccess/, "preflight must use product auth and permission boundaries");
assert.match(routes, /providerCalls:\s*0/, "preflight must prove zero provider calls");
assert.match(routes, /creditCost:\s*0/, "preflight must prove zero ledger cost");

assert.match(adapter, /acquisition:video-content-review/, "admitted scope is missing");
assert.match(adapter, /BEAUTY_WORKFLOWS\["video-content-review"\]\.toolName/, "admitted WorkBuddy tool is missing");
assert.match(workflows, /"video-content-review"[\s\S]*capabilityId:\s*"shooting_editing"/, "admitted workflow is missing");
assert.match(admission, /video-content-review/, "admission coverage is missing");

console.log("beauty industry video content review workbench P1 smoke passed (active after real admission, provider=0)");

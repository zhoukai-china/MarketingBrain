import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const beautyPage = read("apps/web/src/pages/BeautyIndustryAcquisitionPage.tsx");
const reviewWorkbench = read("apps/web/src/components/acquisition/BeautyVideoDataReviewWorkbench.tsx");
const workflow = read("apps/api/src/products/beauty-industry/workflows.ts");
const adapter = read("apps/api/src/products/beauty-industry/mcp-adapter.ts");
const execution = read("apps/api/src/products/beauty-industry/execution.ts");
const skillContract = JSON.parse(read("packages/skills/skills/baolu_review_engine/contract.json"));

assert.equal(skillContract.skillId, "baolu_review_engine");
assert.equal(skillContract.version, "2.0.0");
assert.deepEqual(skillContract.acceptedInputs.slice(0, 3), ["csv", "xlsx", "xls"]);

assert.match(beautyPage, /BeautyVideoDataReviewWorkbench/, "video data review must use a dedicated Skill-driven workspace");
assert.match(beautyPage, /isVideoDataReviewWorkspace/, "video data review must not fall through the generic composer");
assert.match(beautyPage, /runVideoDataReview/, "structured review form must call the fixed backend capability");
assert.match(beautyPage, /toolName === "beauty\.video_data_review"[\s\S]{0,500}return/, "content handoff must stop for file collection before calling review");
assert.match(beautyPage, /requestInFlightRef\.current/, "same-tick duplicate clicks need a synchronous in-flight guard");

for (const term of [
  "视频数据复盘",
  "选择数据平台",
  "复盘周期",
  "业务转化口径",
  "CSV、XLS 或 XLSX",
  "字段覆盖",
  "缺失资料与影响",
  "指标口径",
  "数据质量审计",
  "视频分层",
  "完播率深层归因",
  "互动深度分析",
  "趋势分析",
  "下周期选题建议",
  "任务历史",
  "刷新后可恢复"
]) {
  assert.match(reviewWorkbench, new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `missing dedicated review marker: ${term}`);
}

for (const term of ["engagementRate", "averageCompletionRate", "quadrants", "缺失值不按零处理", "未区分自然/付费"]) {
  assert.match(reviewWorkbench, new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `missing formal metric boundary: ${term}`);
}

assert.doesNotMatch(reviewWorkbench, /视频内容复盘|上传 MP4|分析画面|口播逐字稿|剪辑EDL|直播复盘/, "data review workspace must not expose other review systems");
assert.doesNotMatch(reviewWorkbench, /2680|12条|2个|100000播放/, "workspace must not contain demo business metrics");

assert.match(workflow, /"video-data-review"[\s\S]*capabilityId: "video_data_review"[\s\S]*primarySkillId: "baolu_review_engine"[\s\S]*evidenceMode: "structured_data"/);
assert.match(adapter, /"beauty\.video_data_review": new Set\(\["platform", "contentStructure", "parsedEvidence", "parseStatus", "sourceFilename"\]\)/);
assert.match(execution, /workflow\.evidenceMode === "structured_data"/);
assert.match(execution, /beauty_video_data_not_parsed/);
assert.match(execution, /createEvidenceOnlyProvider/, "structured video review must not call a paid model provider");

process.stdout.write("beauty-industry-video-data-review-workbench-p1-smoke: PASS\n");

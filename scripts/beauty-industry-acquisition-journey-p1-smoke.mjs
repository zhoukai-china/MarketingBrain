import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [page, route, adapter, profile, main, workbuddyPage] = await Promise.all([
  readFile("apps/web/src/pages/BeautyIndustryAcquisitionPage.tsx", "utf8"),
  readFile("apps/api/src/routes/beauty-industry.ts", "utf8"),
  readFile("apps/api/src/products/beauty-industry/mcp-adapter.ts", "utf8"),
  readFile("apps/api/src/products/beauty-industry/profile.ts", "utf8"),
  readFile("apps/web/src/main.tsx", "utf8"),
  readFile("apps/web/src/pages/BeautyIndustryWorkBuddyPage.tsx", "utf8").catch(() => "")
]);

assert.match(page, /type BeautyBranch = "xhs" \| "video" \| "live"/);
assert.match(page, /const BRANCH_DEFINITIONS/);
for (const label of ["图文获客", "视频获客", "直播获客"]) assert.match(page, new RegExp(label));
assert.doesNotMatch(page, /获客问答|beauty\.acquisition_plan/);
assert.match(page, /formSchema/);
assert.match(page, /sourceRunId/);
assert.match(page, /beauty-industry-workspace-v2/);
assert.match(page, /自动保存于/);
assert.match(page, /恢复上次任务/);
assert.match(page, /getAppPath\("\/agents\/beauty-industry\/workbuddy"\)/);
assert.match(page, /生成[^`"<]+｜预计\$\{[^}]+\}积分/);
assert.match(page, /文生视频/);
assert.match(page, /图生视频/);
assert.match(page, /内容系统/);
assert.match(page, /正式 V5 十件结构/);
assert.match(page, /数字人方向/);
assert.doesNotMatch(page, /内容四件套/);
assert.match(page, /暂未开放/);

assert.match(route, /sourceRunId/);
assert.match(route, /loadBeautySourceRun/);
assert.match(route, /priorTaskContext/);
assert.match(route, /input: true/);
assert.match(profile, /AI 草稿，不是门店事实/);

assert.doesNotMatch(adapter, /beauty\.acquisition_plan/);
assert.doesNotMatch(adapter, /acquisition:strategy/);
for (const tool of ["beauty.xiaohongshu_package", "beauty.topic_ideas", "beauty.content_ten_pack", "beauty.video_data_review", "beauty.video_content_review", "beauty.live_script", "beauty.live_review", "beauty.sales_advice"]) {
  assert.match(adapter, new RegExp(tool.replaceAll(".", "\\.")));
}
assert.match(adapter, /beauty\.video_content_review|acquisition:video-content-review/);
assert.match(page, /\/agents\/beauty-industry\/acquisition\/video\/content-review/);
assert.doesNotMatch(page, /pendingValidation:\s*true/);
assert.match(page, /runSelectedTask\(["']beauty\.video_content_review["']/);
assert.doesNotMatch(adapter, /beauty\.paid_traffic_preview|beauty\.compliance_check/);
assert.match(adapter, /内容系统当前正式 V5 十件交付/);

assert.match(main, /BeautyIndustryWorkBuddyPage/);
assert.match(main, /\/agents\/beauty-industry\/workbuddy/);
assert.match(workbuddyPage, /beauty-industry/);
assert.match(workbuddyPage, /一次性/);
assert.match(workbuddyPage, /轮换/);
assert.match(workbuddyPage, /撤销/);
assert.doesNotMatch(workbuddyPage, /tenantId|productCode\s*[:=]\s*<input/);

console.log("beauty industry acquisition three-branch P1 journey smoke passed");

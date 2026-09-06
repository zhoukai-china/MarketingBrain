import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [page, styles, main, route, connections] = await Promise.all([
  read("apps/web/src/pages/BeautyIndustryAcquisitionPage.tsx"),
  read("apps/web/src/styles/beauty-industry.css"),
  read("apps/web/src/main.tsx"),
  read("apps/api/src/routes/beauty-industry.ts"),
  read("apps/api/src/routes/workbuddy-settings.ts")
]);

for (const marker of [
  "beautyIndustryShell",
  "beautyIndustrySidebar",
  "beautyIndustryHome",
  "beautyIndustryHomeSuggestion",
  "beautyIndustryProfileProgress",
  "beautyIndustryAcquisitionCards",
  "beautyIndustryConnectionCard",
  "beautyIndustryRecentTasks",
  "beautyIndustryTaskCenter"
]) assert.match(`${page}\n${styles}`, new RegExp(marker), `missing formal-home marker: ${marker}`);

for (const label of ["工作台首页", "今日建议", "经营档案完整度", "图文获客", "视频获客", "直播获客", "美业销售", "数据连接", "最近任务", "规划中"])
  assert.match(page, new RegExp(label), `missing formal-home label: ${label}`);

assert.match(page, /\/integrations\/workbuddy\/connections/, "home must read the real WorkBuddy connection endpoint");
assert.match(page, /overview\?\.creditBalance|overview\.creditBalance/, "credits must come from the tenant overview");
assert.match(page, /overview\?\.todayActions|overview\.todayActions/, "today suggestions must come from the tenant overview");
assert.match(page, /history\.slice\(/, "recent tasks must be derived from real tenant history");
assert.match(page, /profileCompletion/, "profile completeness must be derived from the real profile");
assert.match(page, /connection\.productCode === "beauty-industry"/, "connection state must be filtered to this product");
assert.match(page, /status === "active"/, "connection state must distinguish active and revoked credentials");

for (const path of [
  "/agents/beauty-industry/profile",
  "/agents/beauty-industry/tasks",
  "/agents/beauty-industry/acquisition/xhs",
  "/agents/beauty-industry/acquisition/video/topics",
  "/agents/beauty-industry/acquisition/video/content-ten",
  "/agents/beauty-industry/acquisition/video/data-review",
  "/agents/beauty-industry/acquisition/live/script",
  "/agents/beauty-industry/acquisition/live/review",
  "/agents/beauty-industry/sales",
  "/agents/beauty-industry/workbuddy"
]) assert.match(`${page}\n${main}`, new RegExp(path.replaceAll("/", "\\/")), `missing stable route: ${path}`);

assert.match(page, /popstate/, "browser back/forward restoration is missing");
assert.match(page, /重新加载/, "initial-load retry action is missing");
assert.match(main, /path\.startsWith\("\/agents\/beauty-industry\/"\)/, "nested beauty workspace routes are not wired");

for (const forbidden of ["2,680", "2680", "12条", "2个"]) assert.doesNotMatch(page, new RegExp(forbidden), `synthetic prototype number leaked: ${forbidden}`);
assert.match(route, /tenantId: context\.tenantId[\s\S]*userId: context\.userId[\s\S]*productCode: "beauty-industry"/, "recent-run query must remain tenant/user/product scoped");
assert.match(connections, /tenantId: context\.tenantId, userId: context\.userId/, "connection query must remain tenant/user scoped");

console.log("beauty industry formal home smoke passed: real tenant data, permission-aware navigation, stable routes, empty/error states and tenant boundaries");

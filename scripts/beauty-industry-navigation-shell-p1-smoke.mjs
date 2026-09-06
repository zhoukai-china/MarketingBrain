import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const shellPath = "apps/web/src/components/beauty-industry/BeautyIndustryShell.tsx";
assert.ok(fs.existsSync(new URL(`../${shellPath}`, import.meta.url)), "shared beauty navigation shell is missing");

const shell = read(shellPath);
const page = read("apps/web/src/pages/BeautyIndustryAcquisitionPage.tsx");
const workbuddy = read("apps/web/src/pages/BeautyIndustryWorkBuddyPage.tsx");
const styles = read("apps/web/src/styles/beauty-industry.css");

for (const text of ["美业智能体", "门店 AI 经营大脑", "BEAUTY_INDUSTRY_NAV_ITEMS", "aria-expanded", "aria-controls", "Escape", "document.title"]) {
  assert.match(shell, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `shared shell missing ${text}`);
}
for (const path of [
  "/agents/beauty-industry",
  "/agents/beauty-industry/daily",
  "/agents/beauty-industry/knowledge",
  "/agents/beauty-industry/acquisition",
  "/agents/beauty-industry/sales",
  "/agents/beauty-industry/delivery",
  "/agents/beauty-industry/operations",
  "/agents/beauty-industry/tasks",
  "/agents/beauty-industry/profile",
  "/agents/beauty-industry/workbuddy"
]) assert.match(shell, new RegExp(path.replaceAll("/", "\\/")), `navigation route missing: ${path}`);

const navPaths = [...shell.matchAll(/path:\s*"([^\"]+)"/g)].map((match) => match[1]);
assert.equal(navPaths.length, 10, "visible main navigation must contain exactly ten stable routes");
assert.equal(new Set(navPaths).size, navPaths.length, "visible main navigation routes must be unique");
assert.doesNotMatch(shell, /disabled=/, "planning and permission-aware navigation entries must remain real links");
assert.match(styles, /@media\(max-width:900px\)/, "mobile navigation breakpoint is missing");
assert.match(styles, /\.beautyIndustryMobileMenu\{display:block/, "mobile navigation toggle must be visible below the breakpoint");
assert.match(styles, /\.beautyIndustrySidebar\[data-open="true"\]\{transform:translateX\(0\)/, "mobile drawer open state is missing");
assert.match(styles, /focus-visible/, "mobile and keyboard navigation require visible focus styles");

for (const path of ["/agents/beauty-industry/acquisition/video", "/agents/beauty-industry/acquisition/live"]) {
  assert.match(page, new RegExp(path.replaceAll("/", "\\/")), `branch page route missing: ${path}`);
}
for (const marker of ["BeautyPlanningPage", "BeautyAcquisitionHomePage", "BeautyBranchHomePage", "BeautyNotFoundPage", "permissionState"]) {
  assert.match(page, new RegExp(marker), `independent page contract missing: ${marker}`);
}
assert.doesNotMatch(shell, /企业经营工作台|本机美业智能体工作区/);
assert.match(workbuddy, /BeautyIndustryShell/);
assert.doesNotMatch(workbuddy, /beautyIndustryTopbar/);

process.stdout.write("beauty-industry-navigation-shell-p1-smoke: PASS\n");

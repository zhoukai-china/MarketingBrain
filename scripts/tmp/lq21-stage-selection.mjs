/**
 * LQ-21 提交前分片暂存脚本（一次性工具，不进发布包）。
 *
 * 目的：工作区里同时躺着多条工作线的未提交改动，本轮只把 LQ-21
 * （兰琪品牌 Logo + 上线板块收口）自己的改动放进暂存区，其余工作线
 * 的改动原样留在工作区。
 *
 * 做法：对「混合文件」不强改工作区，而是用 HEAD 版本 + 本轮自己的改动
 * 重建一份暂存内容，写临时文件 -> `git hash-object -w --path` -> `git update-index`。
 * 每个替换都断言命中次数，命中数不对就直接报错退出，不做部分应用。
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repo = process.cwd();
const git = (args) =>
  execFileSync("git", args, { cwd: repo, encoding: "utf8", maxBuffer: 1 << 30 });
const head = (p) => git(["show", `HEAD:${p}`]);
const work = (p) => readFileSync(join(repo, p), "utf8");
const lines = (t) => t.split("\n");

const tmp = mkdtempSync(join(tmpdir(), "lq21-stage-"));
const results = [];

function replaceOnce(text, needle, replacement, label) {
  const n = text.split(needle).length - 1;
  if (n !== 1) throw new Error(`${label}: 期望命中 1 次，实际 ${n} 次`);
  return text.replace(needle, replacement);
}
function replaceExact(text, needle, replacement, label) {
  const n = text.split(needle).length - 1;
  return { text: text.split(needle).join(replacement), count: n, label };
}
function findLine(arr, predicate, label) {
  const i = arr.findIndex(predicate);
  if (i < 0) throw new Error(`${label}: 没找到锚点行`);
  return i;
}
function stage(path, text) {
  const f = join(tmp, path.replace(/[\\/]/g, "__"));
  writeFileSync(f, text, "utf8");
  const sha = git(["hash-object", "-w", `--path=${path}`, f]).trim();
  git(["update-index", "--cacheinfo", `100644,${sha},${path}`]);
  const roundTrip = git(["cat-file", "-p", sha]);
  if (roundTrip !== text) throw new Error(`${path}: 暂存 blob 与预期内容不一致`);
  results.push({ path, sha: sha.slice(0, 12), bytes: Buffer.byteLength(text, "utf8") });
}

/* ---------------- main.tsx ---------------- */
{
  const path = "apps/web/src/main.tsx";
  const hl = lines(head(path));
  const wl = lines(work(path));
  let staged = hl.join("\n");

  // 1) 新增两个「开发中」页 lazily 引入 + 上线口径开关
  const a = findLine(wl, (l) => l.startsWith("const LanqiDashboardInDevelopmentPage = lazy("), "main.tsx 开发中页 lazy");
  const b = findLine(wl, (l) => l.startsWith("const BeautyIndustryAcquisitionPage = lazy("), "main.tsx 美业获客 lazy");
  const block1 = wl.slice(a, b).join("\n");
  staged = replaceOnce(
    staged,
    'const LanqiStoreAdminPage = lazy(() => import("./pages/LanqiPlaceholderPage.js").then(module => ({ default: module.LanqiStoreAdminPage })));',
    'const LanqiStoreAdminPage = lazy(() => import("./pages/LanqiPlaceholderPage.js").then(module => ({ default: module.LanqiStoreAdminPage })));\n' + block1,
    "main.tsx 插入上线开关"
  );

  // 2) 经营驾驶舱 / 目标设定由「开发中」占位页接管
  const dash = wl[findLine(wl, (l) => l.includes("LANQI_MOMENTS_ONLY_LAUNCH ? <LanqiDashboardInDevelopmentPage /> : <LanqiDashboardPage />;"), "main.tsx dashboard 门控行")];
  staged = replaceOnce(staged, "    return <LanqiDashboardPage />;", dash, "main.tsx dashboard 门控");
  const goal = wl[findLine(wl, (l) => l.includes("LANQI_MOMENTS_ONLY_LAUNCH ? <LanqiDashboardInDevelopmentPage /> : <LanqiGoalSettingPage />;"), "main.tsx goal 门控行")];
  staged = replaceOnce(staged, "    return <LanqiGoalSettingPage />;", goal, "main.tsx goal 门控");

  // 3) 公域获客整段落在「开发中」占位页（放在 acquire 子路由最前）
  const k = findLine(wl, (l) => l.includes('if (path.startsWith("/lanqi/acquire")) {'), "main.tsx acquire 门控");
  if (wl[k - 5].trim() !== "/*" || wl[k + 2].trim() !== "}") throw new Error("main.tsx acquire 门控块形状不符");
  const block2 = wl.slice(k - 5, k + 3).join("\n");
  staged = replaceOnce(
    staged,
    '  if (path.startsWith("/lanqi/acquire/copywriter")) {',
    block2 + '\n  if (path.startsWith("/lanqi/acquire/copywriter")) {',
    "main.tsx acquire 门控插入"
  );

  // 4) /lanqi 入口注释口径（2 行换 2 行）
  const j = findLine(wl, (l) => l.includes("// 兰琪工作台入口："), "main.tsx /lanqi 入口注释");
  const hi = findLine(hl, (l) => l.includes("// 兰琪工作台入口："), "main.tsx /lanqi 入口注释(HEAD)");
  const newComment = wl.slice(j, j + 2).join("\n");
  const oldComment = hl.slice(hi, hi + 2).join("\n");
  staged = replaceOnce(staged, oldComment, newComment, "main.tsx /lanqi 入口注释替换");

  // 5) 默认落地 /lanqi/moments（入口重定向、免登录门、登录后落地）
  const g1 = replaceExact(staged, 'getAppPath("/lanqi/dashboard")', 'getAppPath("/lanqi/moments")', "getAppPath(/lanqi/dashboard)");
  if (g1.count !== 2) throw new Error(`main.tsx getAppPath 期望 2 处，实际 ${g1.count}`);
  staged = g1.text;
  staged = replaceOnce(staged, '        ? "/lanqi/dashboard"', '        ? "/lanqi/moments"', "main.tsx brainEntry 默认落地");

  stage(path, staged);
}

/* ---------------- package.json ---------------- */
{
  const path = "package.json";
  let staged = head(path);

  staged = replaceOnce(
    staged,
    '    "lanqi:moments-ui-contract-smoke": "node scripts/lanqi-moments-ui-contract-smoke.mjs",\n',
    '    "lanqi:moments-ui-contract-smoke": "node scripts/lanqi-moments-ui-contract-smoke.mjs",\n    "lanqi:brand-nav-contract-smoke": "node scripts/lanqi-brand-nav-contract-smoke.mjs",\n',
    "package.json 新增 lanqi:brand-nav-contract-smoke"
  );
  staged = replaceOnce(
    staged,
    "&& pnpm lanqi:moments-ui-contract-smoke && pnpm lanqi:acquire-smoke",
    "&& pnpm lanqi:moments-ui-contract-smoke && pnpm lanqi:brand-nav-contract-smoke && pnpm lanqi:acquire-smoke",
    "package.json qa:lanqi-foundation 接入"
  );
  staged = replaceOnce(
    staged,
    "&& pnpm lanqi:test-splash-contract-smoke && pnpm typecheck",
    "&& pnpm lanqi:test-splash-contract-smoke && pnpm lanqi:brand-nav-contract-smoke && pnpm typecheck",
    "package.json qa:fast 接入"
  );

  stage(path, staged);
}

/* ---------------- docs/BUG_REGRESSIONS.md ---------------- */
{
  const path = "docs/BUG_REGRESSIONS.md";
  const hl = lines(head(path));
  const wl = lines(work(path));
  const i = findLine(wl, (l) => l.startsWith("## QA-20260911-014："), "BUG_REGRESSIONS QA-014 起点");
  const j = findLine(wl, (l) => l.startsWith("## QA-20260911-013："), "BUG_REGRESSIONS QA-013 起点");
  const block = wl.slice(i, j).join("\n");
  const h = findLine(hl, (l) => l.startsWith("## QA-20260911-013："), "BUG_REGRESSIONS QA-013(HEAD)");
  const staged = [...hl.slice(0, h), ...block.split("\n"), ...hl.slice(h)].join("\n");
  stage(path, staged);
}

/* ---------------- docs/CURRENT_DEPLOYMENT_STATUS.md ---------------- */
{
  const path = "docs/CURRENT_DEPLOYMENT_STATUS.md";
  const hl = lines(head(path));
  const wl = lines(work(path));
  const s = findLine(wl, (l) => l.startsWith("## 最新发布：20260911-lq21-brand-launch-test1"), "部署状态 本轮小节起点");
  const e = findLine(wl, (l) => l.startsWith("## 最新发布：20260911-mobile-topbar-prod1"), "部署状态 下一小节起点");
  const section = wl.slice(s, e);
  while (section.length && section[section.length - 1].trim() === "") section.pop();
  const newTime = wl[findLine(wl, (l) => l.startsWith("更新时间："), "部署状态 更新时间行")];
  if (!hl[2].startsWith("更新时间：")) throw new Error("部署状态：HEAD 第 3 行不是更新时间行");
  if (hl[3].trim() !== "" || !hl[4].startsWith("## 最新发布：")) throw new Error("部署状态：HEAD 第 4/5 行形状不符");
  const staged = [...hl.slice(0, 2), newTime, "", ...section, "", ...hl.slice(4)].join("\n");
  stage(path, staged);
}

console.log("staged:");
for (const r of results) console.log(`  ${r.path}  blob=${r.sha}  ${r.bytes}B`);

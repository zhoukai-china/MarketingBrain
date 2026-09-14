#!/usr/bin/env node
/**
 * PLAT-18「保留网址清单」前端路由契约 smoke（只读源码：不连网、不调模型、不花钱）。
 *
 * 为什么要有这个契约：路由清理是「删代码」的活儿，删错一条就会让已经发出去、
 * 印在物料上或者被客户收藏的网址白屏/掉进别的产品。用户 2026-09-12 明确要求
 * 「每批只删一组、独立可回滚，删前先加『保留网址清单』契约，删后跑 qa:fast」。
 *
 * 这个 smoke 把三件事写死（改路由表就必须同步改契约，否则 qa:fast 直接红）：
 *  ① 保留网址清单：每一条在用/兼容跳转的路由必须在 `apps/web/src/main.tsx` 里有对应分支；
 *  ② 已删批次：第一批（/legacy-diagnosis、/v4-preview、/industry-prototype）与
 *     第二批（/clip-lab 路由分支）不得复活，对应的孤岛页面文件必须已经删除；
 *  ③ 兜底页：未知网址必须落到统一的「页面不存在/已下线」页，不能再落到
 *     `<AgentHomePage />`（外卖增长智能体首页）——这是 PLAT-18 验收条件 2。
 *
 * 本轮（第二批）完成后，第三批 `/internal/*` 仍在仓库里，用户点头后才动，
 * 所以契约里只登记「现状」：不检查、也不要求删除。
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const read = (relativePath) => readFileSync(path.join(repoRoot, relativePath), "utf8");
const exists = (relativePath) => existsSync(path.join(repoRoot, relativePath));

const results = [];
let failures = 0;

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  if (!ok) failures += 1;
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${detail ? ` :: ${detail}` : ""}`);
}

function requireContains(source, needle, name) {
  const hit = source.includes(needle);
  record(name, hit, hit ? `命中 ${needle}` : `缺少 ${needle}`);
}

function forbidContains(source, needle, name) {
  const hit = source.includes(needle);
  record(name, !hit, hit ? `仍存在 ${needle}` : "未出现");
}

function requireFile(relativePath, name) {
  const hit = exists(relativePath);
  record(name, hit, hit ? `存在 ${relativePath}` : `缺少文件 ${relativePath}`);
}

function forbidFile(relativePath, name) {
  const hit = exists(relativePath);
  record(name, !hit, hit ? `文件仍在 ${relativePath}` : `已删除 ${relativePath}`);
}

const main = read("apps/web/src/main.tsx");
const packageJson = read("package.json");

/* ------------------------------------------------------------------ *
 * ① 保留网址清单
 * ------------------------------------------------------------------ */

const PRESERVED_ROUTES = [
  {
    url: "/",
    label: "根路径 → 平台首页（兼容跳转）",
    must: ['path === "/" || path === ""', 'getAppPath("/agents")'],
  },
  {
    url: "/agents",
    label: "智能体平台首页",
    must: ['path === "/agents" || path === "/agents/"', "<MarketplaceHomePage />"],
  },
  {
    url: "/agents/admin",
    label: "额度发放后台（给真实商家配体验额度用）",
    must: ['path === "/agents/admin" || path.startsWith("/agents/admin/")', "<MarketplaceAdminPage />"],
  },
  {
    url: "/agent/<skuCode>",
    label: "货架 SKU 详情页",
    must: [
      'path.match(/^\\/agent\\/([a-z0-9_-]+)\\/chat\\/?$/i)',
      "<MarketplaceAgentDetailPage skuId={marketplaceAgentMatch[1]} />",
    ],
  },
  {
    url: "/agents/<zone>__<capability>",
    label: "货架 SKU 落地链接（如 ipzone__vidrev、meiye__vidrev）",
    must: ["isMarketplaceSkuCode(agentMatch[1])", "<MarketplaceAgentDetailPage skuId={agentMatch[1]} />"],
  },
  {
    url: "/agents/<slug>",
    label: "在售智能体工作台（含 /agents/clipper）",
    must: ["<AgentWorkspacePage slug={agentMatch[1]} />"],
  },
  {
    url: "/agents/beauty-industry*",
    label: "美业获客产品页",
    must: [
      'path === "/agents/beauty-industry" || path === "/agents/beauty-industry/" || path.startsWith("/agents/beauty-industry/")',
      "<BeautyIndustryAcquisitionPage />",
    ],
  },
  {
    url: "/agents/beauty-industry/workbuddy",
    label: "WorkBuddy 页面",
    must: ['"/agents/beauty-industry/workbuddy"', "<BeautyIndustryWorkBuddyPage />"],
  },
  {
    url: "/agents/acquisition/enterprise-knowledge-base*",
    label: "创始人 IP 企业知识库",
    must: ['path.startsWith("/agents/acquisition/enterprise-knowledge-base")', "<EnterpriseKnowledgeBasePage />"],
  },
  {
    url: "/p/<slug>",
    label: "智能体对外介绍页",
    must: ["<AgentMarketingPage slug={marketingMatch[1]} />"],
  },
  {
    url: "/my-ai",
    label: "常用智能体",
    must: ['path.startsWith("/my-ai")', "<MyAiPage />"],
  },
  {
    url: "/login*",
    label: "登录（含微信一键登录 / 产品专属登录入口）",
    must: ['path.startsWith("/login")', "isLoginRoute || isWechatCallbackRoute || isWechatBridgeRoute"],
  },
  {
    url: "/wechat-callback*",
    label: "微信登录回调",
    must: ['path.startsWith("/wechat-callback")'],
  },
  {
    url: "/wechat-bridge*",
    label: "电脑端扫码登录中转页（PLAT-13）",
    must: ['path.startsWith("/wechat-bridge")'],
  },
  {
    url: "/terms",
    label: "服务条款",
    must: ['path === "/terms" || path === "/terms/"'],
  },
  {
    url: "/privacy",
    label: "隐私政策",
    must: ['path === "/privacy" || path === "/privacy/"'],
  },
  {
    url: "/diagnosis 与 /d/",
    // 2026-09-13 用户要求清除旧版「9 轮经营诊断」：它不再渲染，老链接统一重定向到货架。
    label: "旧版诊断（已下线：重定向到货架，不得再渲染）",
    must: [
      'path.startsWith("/diagnosis") || path.startsWith("/d/")',
      'window.location.replace(getAppPath("/agents"))',
    ],
    mustNotInMain: ["<FlywheelDiagnosisApp />", 'stage === "diagnosis"', 'setStage("diagnosis")'],
  },
  {
    url: "/enterprise-knowledge-base*",
    label: "企业知识库（老入口）",
    must: ['path.startsWith("/enterprise-knowledge-base")'],
  },
  {
    url: "/enterprise-knowledge-base/connection-help",
    label: "知识库连接帮助",
    must: ['path.startsWith("/enterprise-knowledge-base/connection-help")'],
  },
  {
    url: "/knowledge-base",
    label: "知识库管理",
    must: ['path.startsWith("/knowledge-base")'],
  },
  {
    url: "/account",
    label: "企业账户",
    must: ['path.startsWith("/account")', "<AccountCenterPage />"],
  },
  {
    url: "/recharge",
    label: "充值",
    must: ['path.startsWith("/recharge")', "<RechargePage />"],
  },
  {
    url: "/market*",
    label: "旧平台入口兼容跳转（/market → /agents，同后缀）",
    must: ['path === "/market" || path.startsWith("/market/")', 'getAppPath(`/agents${path.slice("/market".length)}`)'],
  },
  {
    url: "/workbench 与 /app",
    label: "旧工作台地址兼容跳转 → /my-ai",
    must: ['path.startsWith("/workbench") || path.startsWith("/app")', 'getAppPath("/my-ai")'],
  },
  {
    url: "/fip/e2e/local",
    label: "创始人 IP 本机 E2E 入口",
    must: ['path === "/fip/e2e/local" || path === "/fip/e2e/local/"'],
  },
  {
    url: "/lanqi/*（登录前置）",
    label: "兰琪工作台未登录时不掉进平台通用页",
    must: ['path === "/lanqi" || path === "/lanqi/" || path.startsWith("/lanqi/")', 'getAppPath("/login/lanqi")'],
  },
  {
    url: "/lanqi/local",
    label: "兰琪本机入口",
    must: ['path === "/lanqi/local" || path === "/lanqi/local/"'],
  },
  {
    url: "/lanqi 与 /lanqi/",
    label: "兰琪入口 → 私域营销",
    must: ['path === "/lanqi" || path === "/lanqi/"', 'getAppPath("/lanqi/moments")'],
  },
  {
    url: "/lanqi/brain",
    label: "兰琪八板块总览",
    must: ['path === "/lanqi/brain" || path === "/lanqi/brain/"', "<LanqiBrainHomePage />"],
  },
  {
    url: "/lanqi/moments*",
    label: "私域营销（当前唯一已上线板块）",
    must: ['path.startsWith("/lanqi/moments")', "<LanqiMomentsHomePage />"],
  },
  {
    url: "/lanqi/moments/wechat-group",
    label: "私域营销 · 微信群",
    must: ['path.startsWith("/lanqi/moments/wechat-group")', "<LanqiMomentsWechatGroupPage />"],
  },
  {
    url: "/lanqi/moments/friend-circle",
    label: "私域营销 · 朋友圈",
    must: ['path.startsWith("/lanqi/moments/friend-circle")', "<LanqiMomentsPage />"],
  },
  {
    url: "/lanqi/acquire*",
    label: "公域获客（当前显示「开发中」占位，路由必须保留）",
    must: ['path.startsWith("/lanqi/acquire")', "<LanqiAcquireInDevelopmentPage />", "LANQI_MOMENTS_ONLY_LAUNCH"],
  },
  {
    url: "/lanqi/dashboard 与 /lanqi/goal-setting",
    label: "经营驾驶舱 / 目标设定（当前占位）",
    must: ['path === "/lanqi/dashboard" || path === "/lanqi/dashboard/"', 'path.startsWith("/lanqi/goal-setting")'],
  },
  {
    url: "/lanqi/cases、/lanqi/customers、/lanqi/analysis、/lanqi/sales-sim、/lanqi/store",
    label: "兰琪侧栏未开发板块（必须落在兰琪自己的占位页）",
    must: [
      'path === "/lanqi/cases" || path === "/lanqi/cases/"',
      'path === "/lanqi/customers" || path === "/lanqi/customers/"',
      'path === "/lanqi/analysis" || path === "/lanqi/analysis/"',
      'path === "/lanqi/sales-sim" || path === "/lanqi/sales-sim/"',
      'path === "/lanqi/store" || path === "/lanqi/store/"',
    ],
  },
  {
    url: "/lanqi/private-domain/moments",
    label: "私域营销带前缀入口",
    must: ['path.startsWith("/lanqi/private-domain/moments")'],
  },
  {
    url: "/lanqi/store-profile、/lanqi/business-qa、/lanqi/diagnosis、/lanqi/execution-plan、/lanqi/content-studio、/lanqi/image-studio",
    label: "兰琪各功能板块路由",
    must: [
      'path.startsWith("/lanqi/store-profile")',
      'path.startsWith("/lanqi/business-qa")',
      'path.startsWith("/lanqi/diagnosis")',
      'path.startsWith("/lanqi/execution-plan")',
      'path.startsWith("/lanqi/content-studio")',
      'path.startsWith("/lanqi/image-studio")',
    ],
  },
];

for (const route of PRESERVED_ROUTES) {
  for (const needle of route.must) {
    requireContains(main, needle, `保留网址 ${route.url}（${route.label}）`);
  }
}

/* ------------------------------------------------------------------ *
 * ② 已删批次：不得复活
 * ------------------------------------------------------------------ */

const REMOVED_BATCH_1 = [
  {
    url: "/legacy-diagnosis",
    mustNotInMain: ["isLegacyDiagnosisRoute", '"/legacy-diagnosis"'],
    filesGone: ["apps/web/src/pages/BaoluDiagnosisApp.tsx"],
  },
  {
    url: "/v4-preview",
    mustNotInMain: ["isV4PreviewRoute", '"/v4-preview"', "SitongV4App"],
    filesGone: ["apps/web/src/pages/SitongV4App.tsx", "apps/web/src/styles/sitong-v4.css"],
  },
  {
    url: "/industry-prototype",
    mustNotInMain: ['"/industry-prototype"', "IndustryWorkbenchPrototypePage"],
    filesGone: [
      "apps/web/src/pages/IndustryWorkbenchPrototypePage.tsx",
      "apps/web/src/styles/industry-workbench-prototype.css",
      "scripts/industry-workbench-prototype-smoke.mjs",
    ],
  },
];

const REMOVED_BATCH_2 = [
  {
    url: "/clip-lab",
    mustNotInMain: ['path.startsWith("/clip-lab")', "<ClipLabApp />", "pages/ClipLabApp.js"],
    // 组件与接口仍服务于在售的 `/agents/clipper` 工作台，只能删路由分支。
    filesKept: [
      "apps/web/src/pages/ClipLabApp.tsx",
      "apps/web/src/pages/PersonaClipLabApp.tsx",
      "apps/web/src/styles/clip-lab.css",
      "apps/api/src/routes/clip-lab.ts",
    ],
    stillUsedBy: "apps/web/src/pages/AgentProductsApp.tsx",
  },
];

for (const route of REMOVED_BATCH_1) {
  for (const needle of route.mustNotInMain) {
    forbidContains(main, needle, `第一批已删 ${route.url} 不得复活`);
  }
  for (const file of route.filesGone) {
    forbidFile(file, `第一批已删文件 ${file}`);
  }
}

for (const route of REMOVED_BATCH_2) {
  for (const needle of route.mustNotInMain) {
    forbidContains(main, needle, `第二批已删 ${route.url} 路由分支不得复活`);
  }
  for (const file of route.filesKept) {
    requireFile(file, `第二批保留（服务于 /agents/clipper）${file}`);
  }
  requireContains(
    read(route.stillUsedBy),
    "ClipLabApp",
    `第二批：${route.url} 工作台复用仍在 ${route.stillUsedBy}`
  );
}

/* ------------------------------------------------------------------ *
 * ③ 未知网址统一兜底（PLAT-18 验收条件 2）
 * ------------------------------------------------------------------ */

requireContains(main, "return <NotFoundPage />", "未知网址落到统一兜底页");
forbidContains(main, "return <AgentHomePage />", "未知网址不得再落到外卖增长智能体首页");
forbidContains(main, "module.AgentHomePage", "main.tsx 不再加载 AgentHomePage 组件");
requireFile("apps/web/src/pages/NotFoundPage.tsx", "兜底页组件存在");
requireFile("apps/web/src/styles/not-found.css", "兜底页样式存在");
requireContains(
  read("apps/web/src/pages/NotFoundPage.tsx"),
  "这个页面不存在，或者已经下线",
  "兜底页给出「不存在 / 已下线」明确说明"
);

/* ------------------------------------------------------------------ *
 * ⑤ 术语：对客与文档统一叫「市场合伙人」（用户 2026-09-12 指令）
 * ------------------------------------------------------------------ */

/** 递归列出 apps/web/src 下的源码文件，用来查「旧称有没有漏在客户界面」。 */
function listWebSources(dir = path.join(repoRoot, "apps/web/src"), collected = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      listWebSources(full, collected);
      continue;
    }
    if (/\.tsx?$/.test(entry)) collected.push(full);
  }
  return collected;
}

const legacyTermFiles = listWebSources()
  .filter((file) => readFileSync(file, "utf8").includes("分销商"))
  .map((file) => path.relative(repoRoot, file).split(path.sep).join("/"));
record(
  "客户界面不得再用「分销商」旧称（统一叫「市场合伙人」）",
  legacyTermFiles.length === 0,
  legacyTermFiles.length === 0 ? "0 处" : `仍出现：${legacyTermFiles.join("、")}`
);
const partnerTerm = "市场合伙人";
record(
  `PLAT-26 分润任务卡使用新称「${partnerTerm}」`,
  read("docs/agents/platform-tasks.md").includes(partnerTerm),
  read("docs/agents/platform-tasks.md").includes(partnerTerm) ? "命中" : "缺失"
);

/* ------------------------------------------------------------------ *
 * ④ 契约自身必须挂在 qa:fast 上，否则形同虚设
 * ------------------------------------------------------------------ */

requireContains(packageJson, '"platform:route-contract-smoke"', "package.json 已注册 platform:route-contract-smoke");
requireContains(
  packageJson,
  "pnpm platform:route-contract-smoke",
  "platform:route-contract-smoke 已挂进 qa:fast"
);

const passed = results.length - failures;
console.log(`\nplatform_route_contract_smoke: ${failures === 0 ? "PASS" : "FAIL"} (${passed} passed / ${failures} failed)`);
if (failures > 0) process.exit(1);

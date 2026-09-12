// 货架 SKU 分享链接路由契约回归（源码级 / 离线 / 毫秒级可重复）。
//
// 对应缺陷见 `docs/BUG_REGRESSIONS.md` QA-20260911-015 与任务卡 PLAT-16：
// `/agents/<zone>__<capability>`（例如 `/agents/ipzone__vidrev`）曾被工作台智能体页
// `AgentWorkspacePage` 接管，`/api/agents/me` 找不到该 slug 后兜底成
// 「服务暂时不可用，请稍后再试。」，把「链接写法不对 / 智能体没上线」说成了服务故障。
//
// 真实浏览器层的回归在 `scripts/marketplace-sku-link-regression.mjs`（需要起浏览器、连实例，不进 `qa:fast`）；
// 本文件只锁「路由归属 + 两套命名空间不冲突」这条源码契约，防止有人把分支顺序或判据改回去。

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { AGENT_DEFINITIONS } from "../apps/api/src/services/agent-definitions.js";
import { MARKETPLACE_V3_SKU_SEEDS } from "../apps/api/src/services/marketplace-catalog.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let passed = 0;
let failed = 0;

function check(condition: boolean, label: string, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`[PASS] ${label}`);
    return;
  }
  failed += 1;
  console.error(`[FAIL] ${label}${detail ? ` :: ${detail}` : ""}`);
}

/** 缺失文件按空内容处理，让断言干净地报 FAIL，而不是让脚本崩掉。 */
function readRepoFile(relativePath: string): string {
  try {
    return readFileSync(path.join(repoRoot, relativePath), "utf8");
  } catch {
    return "";
  }
}

const mainTsx = readRepoFile("apps/web/src/main.tsx");
const regressionScript = readRepoFile("scripts/marketplace-sku-link-regression.mjs");
const packageJson = JSON.parse(readRepoFile("package.json")) as {
  scripts: Record<string, string>;
};

// 1. 归属判据必须存在，且只认「双下划线」这一个特征（货架编码 = `<专区>__<能力>`）。
const predicateMatch = mainTsx.match(
  /function isMarketplaceSkuCode\(slug: string\): boolean \{\s*return slug\.includes\("__"\);\s*\}/
);
check(Boolean(predicateMatch), "main.tsx 保留 isMarketplaceSkuCode 判据（slug 含 `__`）");

// 2. `/agents/<slug>` 必须先过一遍货架归属，命中才交给货架详情页。
const marketplaceGuard = 'if (agentMatch && isMarketplaceSkuCode(agentMatch[1])) {';
const guardIndex = mainTsx.indexOf(marketplaceGuard);
check(guardIndex >= 0, "main.tsx 保留 `/agents/<slug>` 的货架归属分支", marketplaceGuard);
check(
  guardIndex >= 0 &&
    mainTsx
      .slice(guardIndex, guardIndex + 220)
      .includes("<MarketplaceAgentDetailPage skuId={agentMatch[1]} />"),
  "货架归属分支渲染 MarketplaceAgentDetailPage（与单数路由同一组件）"
);

// 3. 顺序不能反：货架分支必须在工作台分支之前，否则 SKU 又会被工作台页接管。
const workspaceBranch = "<AgentWorkspacePage slug={agentMatch[1]} />";
const workspaceIndex = mainTsx.indexOf(workspaceBranch);
check(workspaceIndex >= 0, "main.tsx 保留 `/agents/<slug>` 的工作台分支", workspaceBranch);
check(
  guardIndex >= 0 && workspaceIndex >= 0 && guardIndex < workspaceIndex,
  "货架归属分支排在工作台分支之前",
  `guard@${guardIndex} workspace@${workspaceIndex}`
);

// 4. 单数短链 `/agent/<skuCode>` 仍走同一个组件，不能被顺手删掉。
const singularMatch = mainTsx.match(
  /marketplaceAgentMatch[\s\S]{0,200}<MarketplaceAgentDetailPage skuId=\{marketplaceAgentMatch\[1\]\} \/>/
);
check(Boolean(singularMatch), "单数短链 `/agent/<skuCode>` 仍渲染 MarketplaceAgentDetailPage");

// 5. 两套命名空间必须仍然不冲突：货架编码全部含 `__`，工作台 slug 全部不含。
const skuCodes = MARKETPLACE_V3_SKU_SEEDS.map((seed) => seed.skuCode);
const agentSlugs = AGENT_DEFINITIONS.map((agent) => agent.slug);
check(skuCodes.length > 0, "货架 SKU 种子非空", `skus=${skuCodes.length}`);
check(agentSlugs.length > 0, "工作台智能体定义非空", `agents=${agentSlugs.length}`);

const skuWithoutSeparator = skuCodes.filter((code) => !code.includes("__"));
check(
  skuWithoutSeparator.length === 0,
  "所有货架 SKU 编码都含 `__`（判据能覆盖全部 SKU）",
  skuWithoutSeparator.slice(0, 5).join(", ")
);

const slugWithSeparator = agentSlugs.filter((slug) => slug.includes("__"));
check(
  slugWithSeparator.length === 0,
  "所有工作台 slug 都不含 `__`（判据不会误伤工作台）",
  slugWithSeparator.slice(0, 5).join(", ")
);

const overlap = skuCodes.filter((code) => agentSlugs.includes(code));
check(overlap.length === 0, "货架 SKU 与工作台 slug 集合不相交", overlap.slice(0, 5).join(", "));

// 6. 两个真实分享链接必须在浏览器回归脚本的默认覆盖范围内，且加载态文案不得从
//    TRANSIENT_MARKERS 里被删掉（删掉会重新出现「加载态被当成渲染完成」的假失败）。
for (const sku of ["ipzone__vidrev", "meiye__vidrev"]) {
  check(regressionScript.includes(`"${sku}"`), `回归脚本默认覆盖 ${sku}`);
}
check(
  regressionScript.includes('desktop-1440') && regressionScript.includes('mobile-390'),
  "回归脚本同时覆盖桌面 1440 与手机 390"
);
check(
  regressionScript.includes('"正在加载智能体"') && regressionScript.includes('"正在加载货架"'),
  "回归脚本把货架加载态文案并入 TRANSIENT_MARKERS"
);

// 7. 两个入口都要在 package.json 里可调用，避免回归脚本「存在但没人跑」。
check(
  typeof packageJson.scripts["marketplace:sku-link-regression"] === "string",
  "package.json 注册 marketplace:sku-link-regression"
);
check(
  typeof packageJson.scripts["marketplace:sku-link-contract-smoke"] === "string",
  "package.json 注册 marketplace:sku-link-contract-smoke"
);
check(
  (packageJson.scripts["qa:fast"] ?? "").includes("marketplace:sku-link-contract-smoke"),
  "qa:fast 已包含 marketplace:sku-link-contract-smoke"
);

console.log(`\n${passed} passed / ${failed} failed`);
if (failed > 0) process.exit(1);

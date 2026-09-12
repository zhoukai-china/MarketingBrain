#!/usr/bin/env node
/**
 * PLAT-21「客户侧响应不得暴露内部算力成本」契约 smoke（只读源码：不连网、不调模型、不花钱）。
 *
 * 为什么要有这个契约：用户 2026-09-12 发现 `POST /market/skus/<sku>/run` 的成功响应里带了
 * `modelCostCny`（本次运行的真实算力成本，人民币），客户打开浏览器开发者工具就能看到我们
 * 每次赚多少，直接违反 `docs/agents/beauty-industry/CONTRACTS.md` 的
 * 「不向普通用户暴露供应商、密钥或内部成本」。成本可以留在账本 `metadata` 里供内部审计，
 * 但绝不能出现在返回给浏览器的响应体里。
 *
 * 同一轮只读扫描还发现第二处同类泄露（美业图片报价）：
 * `POST /beauty-industry/acquisition/runs/:runId/media/quote` 把 `estimatedProviderCostYuan`
 * （本批图片的供应商成本，人民币）回给了客户页面；同文件的 job `serialize()` 还回传
 * `provider` / `model`。本契约对这两处一并钉住（成本字段必须摘掉；供应商/模型字段见下方注释）。
 *
 * 同一个响应里的 `estimatedCredits` 也必须摘掉：它等于 `ceil(真实成本 × 2000)`
 * （`marketplaceCreditsForCostCny`，20 倍加价 / 每积分 0.01 元成本），客户拿它反推成本只差
 * 一个向下取整，所以它和 `modelCostCny` 是同一个泄露。客户需要看到的是
 * `consumedCredits`（本次实际扣的积分，等于 SKU 定价），那个必须保留。
 *
 * 四条口径：
 *  ① 缺席：`/marketplace/run` 成功响应不得出现 `modelCostCny` / `estimatedCredits`，
 *     客户前端也不得引用这两个字段；
 *  ② 保留：内部审计必须继续走账本 `metadata`（`modelCostCny`、`estimatedCredits`、
 *     三类 token 计数一个都不能少），否则等于为了堵泄露而丢了账；
 *  ③ 保留：客户真正需要的字段不能被顺手删掉——`consumedCredits` / `balance` / `requestId`
 *     是前端扣费提示和免费重做凭证依赖的字段；
 *  ④ 不回归：三个真实运行的 smoke 必须显式断言这两个字段不在响应里（而不是只看日志），
 *     并且本契约自身必须挂在 `qa:fast` 上。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const read = (relativePath) => readFileSync(path.join(repoRoot, relativePath), "utf8");

const MARKETPLACE_ROUTE = "apps/api/src/routes/marketplace.ts";
const BEAUTY_MEDIA_ROUTE = "apps/api/src/routes/beauty-industry-media.ts";
const PACKAGE_JSON = "package.json";

const results = [];
let failures = 0;

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  if (!ok) failures += 1;
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${detail ? ` :: ${detail}` : ""}`);
}

function countOccurrences(source, needle) {
  return source.split(needle).length - 1;
}

/** 递归列出 `apps/web/src` 下的源码文件（只看 .ts / .tsx，跳过测试）。 */
function listWebSources(dir = path.join(repoRoot, "apps/web/src"), collected = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      listWebSources(full, collected);
      continue;
    }
    if (!/\.tsx?$/.test(entry) || /\.(test|spec)\.tsx?$/.test(entry)) continue;
    collected.push(path.relative(repoRoot, full).split(path.sep).join("/"));
  }
  return collected;
}

const routeSource = read(MARKETPLACE_ROUTE);

/* ------------------------------------------------------------------ *
 * ① 缺席：响应体里不得再有内部成本字段
 * ------------------------------------------------------------------ */

// 账本写入块（内部审计）允许出现一次 `modelCostCny`；其余任何位置出现都是泄露。
const ledgerAnchor = "prisma.marketplaceLedgerEntry.create({";
const ledgerIndex = routeSource.indexOf(ledgerAnchor);
record(
  "账本写入块可以被定位（锚点存在）",
  ledgerIndex >= 0,
  ledgerIndex >= 0 ? `offset=${ledgerIndex}` : `缺少锚点 ${ledgerAnchor}`
);
const ledgerBlock = ledgerIndex >= 0 ? routeSource.slice(ledgerIndex, ledgerIndex + 2000) : "";

const modelCostCount = /modelCostCny\s*:/.test(routeSource) ? countOccurrences(routeSource, "modelCostCny") : 0;
record(
  "`modelCostCny` 全仓路由文件只出现一次（仅内部账本 metadata）",
  modelCostCount === 1 && ledgerBlock.includes("modelCostCny"),
  `出现 ${modelCostCount} 次${ledgerBlock.includes("modelCostCny") ? "（账本内 1 次）" : "（账本内没有！）"}`
);

const estimatedCreditsCount = countOccurrences(routeSource, "estimatedCredits");
record(
  "`estimatedCredits` 只出现在内部账本 metadata，不再回给浏览器",
  estimatedCreditsCount === 1 && ledgerBlock.includes("estimatedCredits"),
  `出现 ${estimatedCreditsCount} 次${ledgerBlock.includes("estimatedCredits") ? "（账本内 1 次）" : "（账本内没有！）"}`
);

// 成功响应对象本身必须同时不含这两个字段（防止有人用别名/拼接再放回去）。
const responseIndex = routeSource.indexOf('state: "completed"');
const responseBlock = responseIndex >= 0 ? routeSource.slice(responseIndex, responseIndex + 900) : "";
record(
  "成功响应块被定位（state: \"completed\"）",
  responseIndex >= 0 && responseBlock.includes("consumedCredits"),
  responseIndex >= 0 ? `offset=${responseIndex}` : "缺少 state: \"completed\" 响应块"
);
record(
  "成功响应块内无 `modelCostCny` / `estimatedCredits`",
  responseBlock.length > 0 && !responseBlock.includes("modelCostCny") && !responseBlock.includes("estimatedCredits"),
  responseBlock.includes("modelCostCny") || responseBlock.includes("estimatedCredits")
    ? "响应块仍含成本字段"
    : "响应块只含客户字段"
);

/* ------------------------------------------------------------------ *
 * ② 保留：内部审计字段不能丢
 * ------------------------------------------------------------------ */

for (const key of ["modelCostCny", "estimatedCredits", "promptTokens", "completionTokens", "reasoningTokens"]) {
  record(
    `账本 metadata 保留内部审计字段 ${key}`,
    ledgerBlock.includes(key),
    ledgerBlock.includes(key) ? "命中" : "缺失"
  );
}

/* ------------------------------------------------------------------ *
 * ③ 保留：客户侧真正需要的字段不能被顺手删
 * ------------------------------------------------------------------ */

for (const key of ["consumedCredits", "balance", "paidBalance", "bonusBalance", "requestId", "spent"]) {
  record(`成功响应保留客户字段 ${key}`, responseBlock.includes(key), responseBlock.includes(key) ? "命中" : "缺失");
}

/* ------------------------------------------------------------------ *
 * ④ 不回归：客户前端与真实运行 smoke 双重守护
 * ------------------------------------------------------------------ */

/**
 * 白名单：兰琪报价页的 `estimatedCredits` 是**对外公开单价**（`quoteLanqiMedia()` 直接读
 * `LANQI_MEDIA_*_CREDITS`，例如 30 积分/秒、每镜 90 积分），不是算力成本折算；用户明确要求
 * 「确认素材权利后显示本次报价」，所以必须保留。新增豁免要在契约里显式登记。
 */
const PUBLIC_QUOTE_CREDIT_WHITELIST = new Set(["apps/web/src/pages/LanqiContentStudioPage.tsx"]);

const webSources = listWebSources();
const webFilesWithModelCost = webSources.filter((file) => /modelCostCny/.test(read(file)));
record(
  "客户前端不引用 `modelCostCny`（内部成本字段）",
  webFilesWithModelCost.length === 0,
  webFilesWithModelCost.length === 0 ? "0 处引用" : `仍引用：${webFilesWithModelCost.join("、")}`
);

const webFilesWithEstimatedCredits = webSources.filter((file) => /estimatedCredits/.test(read(file)));
const unexpectedEstimatedCredits = webFilesWithEstimatedCredits.filter((file) => !PUBLIC_QUOTE_CREDIT_WHITELIST.has(file));
record(
  "客户前端的 `estimatedCredits` 只允许出现在公开报价白名单里",
  unexpectedEstimatedCredits.length === 0,
  unexpectedEstimatedCredits.length === 0
    ? `白名单内 ${webFilesWithEstimatedCredits.length} 个文件（公开单价）`
    : `白名单外仍引用：${unexpectedEstimatedCredits.join("、")}`
);
record(
  "公开报价白名单页面仍展示「预计积分」报价（不能为了堵泄露把报价删了）",
  [...PUBLIC_QUOTE_CREDIT_WHITELIST].every((file) => read(file).includes("预计积分")),
  [...PUBLIC_QUOTE_CREDIT_WHITELIST].map((file) => `${file}${read(file).includes("预计积分") ? "=命中" : "=缺失"}`).join("、")
);

const liveSmokes = [
  "scripts/marketplace-live-run-smoke.ts",
  "scripts/marketplace-ip-pos-run-smoke.ts",
  "scripts/marketplace-vidrev-run-smoke.ts"
];
for (const file of liveSmokes) {
  const source = read(file);
  const assertsAbsence =
    /!\("modelCostCny" in (?:body|rawBody)\)/.test(source) &&
    /!\("estimatedCredits" in (?:body|rawBody)\)/.test(source) &&
    /costFieldsAbsent/.test(source);
  record(
    `${file} 显式断言响应不含成本字段`,
    assertsAbsence,
    assertsAbsence ? "命中缺席断言 + 账本审计断言" : "缺少 `!(... in body)` 缺席断言"
  );
}

const packageJson = read(PACKAGE_JSON);
const scriptName = "platform:response-cost-contract-smoke";
record(
  `package.json 注册了 ${scriptName}`,
  packageJson.includes(`"${scriptName}"`),
  packageJson.includes(`"${scriptName}"`) ? "命中" : "缺失"
);
const qaFastLine = packageJson.split("\n").find((line) => line.includes('"qa:fast"')) ?? "";
record(
  "契约挂在 qa:fast 上（防止被摘掉）",
  qaFastLine.includes(`pnpm ${scriptName}`),
  qaFastLine.includes(`pnpm ${scriptName}`) ? "命中 qa:fast" : "未挂到 qa:fast"
);

/* ------------------------------------------------------------------ *
 * ⑤ 第二处同类泄露：美业图片报价不得回传供应商成本
 * ------------------------------------------------------------------ */

const beautyMediaSource = read(BEAUTY_MEDIA_ROUTE);
// 报价响应对象（`runId`/`imageCount`/`creditCost`/... 那一块）里不得再出现供应商成本。
const quoteAnchor = "media/quote\", async (request, reply) => {";
const quoteIndex = beautyMediaSource.indexOf(quoteAnchor);
record(
  "美业图片报价路由被定位（media/quote）",
  quoteIndex >= 0,
  quoteIndex >= 0 ? `offset=${quoteIndex}` : `缺少锚点 ${quoteAnchor}`
);
const quoteRouteSource = quoteIndex >= 0 ? beautyMediaSource.slice(quoteIndex, beautyMediaSource.indexOf("media/confirm", quoteIndex)) : "";
record(
  "美业图片报价响应不含 `estimatedProviderCostYuan`（供应商成本，人民币）",
  quoteRouteSource.length > 0 && !/^\s*estimatedProviderCostYuan,/m.test(quoteRouteSource),
  /^\s*estimatedProviderCostYuan,/m.test(quoteRouteSource) ? "报价响应仍含供应商成本字段" : "报价响应只含客户字段"
);
record(
  "美业图片报价仍保留客户侧字段（creditCost / canConfirm / message / imageCount）",
  ["creditCost", "canConfirm", "message", "imageCount"].every((key) => quoteRouteSource.includes(key)),
  ["creditCost", "canConfirm", "message", "imageCount"].map((key) => `${key}=${quoteRouteSource.includes(key) ? "有" : "缺"}`).join(" ")
);
// 内部闸门必须仍按供应商成本判断（摘字段不等于摘风控）。
record(
  "美业图片报价仍在服务端按供应商成本做闸门（成本计算与 resolveReadiness 保留）",
  beautyMediaSource.includes("estimateBeautyImageProviderCostYuan") && /resolveReadiness\(context\.tenantId, directions\.length, 0, estimatedProviderCostYuan\)/.test(beautyMediaSource),
  "成本计算 + resolveReadiness 仍在"
);
// 客户前端不得再声明/读取这个内部成本字段。
const webFilesWithProviderCost = webSources.filter((file) => /estimatedProviderCostYuan/.test(read(file)));
record(
  "客户前端不引用 `estimatedProviderCostYuan`（内部成本字段）",
  webFilesWithProviderCost.length === 0,
  webFilesWithProviderCost.length === 0 ? "0 处引用" : `仍引用：${webFilesWithProviderCost.join("、")}`
);

/* ------------------------------------------------------------------ *
 * ⑥ 第三处：剪辑台渲染接口不得回传本地算力成本（PLAT-22 第一批）
 * ------------------------------------------------------------------ */

const CLIP_LAB_ROUTE = "apps/api/src/routes/clip-lab.ts";
const clipLabSource = read(CLIP_LAB_ROUTE);
record(
  "剪辑台渲染响应不含 `estimatedLocalCostYuan`（本地算力成本，人民币）",
  !/estimatedLocalCostYuan/.test(clipLabSource),
  /estimatedLocalCostYuan/.test(clipLabSource) ? "渲染响应仍含本地成本字段" : "未出现"
);
// 效率对比（不含钱）是产品卖点，不能为了删成本把它一起删了。
for (const key of ["machineVideosPerHour", "estimatedHumanMinutes", "realtimeFactor", "totalMs"]) {
  record(
    `剪辑台仍保留不含钱的效率口径 ${key}`,
    clipLabSource.includes(key),
    clipLabSource.includes(key) ? "命中" : "缺失"
  );
}
const webFilesWithLocalCost = webSources.filter((file) => /estimatedLocalCostYuan/.test(read(file)));
record(
  "客户前端不引用 `estimatedLocalCostYuan`",
  webFilesWithLocalCost.length === 0,
  webFilesWithLocalCost.length === 0 ? "0 处引用" : `仍引用：${webFilesWithLocalCost.join("、")}`
);

console.log(
  `\nresponse_cost_contract_smoke: ${failures === 0 ? "PASS" : "FAIL"} (${results.length - failures} passed / ${failures} failed)`
);
process.exit(failures === 0 ? 0 : 1);

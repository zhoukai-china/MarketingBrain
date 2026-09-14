/**
 * PLAT-23「积分 ↔ 人民币 ↔ 成本换算常量口径」契约 smoke（离线：不连网、不调模型、不花钱）。
 *
 * 用户 2026-09-12 选定方案 A：**不改任何数字，只让常量说真话**——
 * `MARKETPLACE_CREDIT_MARKUP`（写着 20 倍、实际 100 倍）换成自洽表达
 * `MARKETPLACE_TARGET_COST_TO_REVENUE_MULTIPLE = 100`，公式改为用
 * `CREDIT_PRICING.customerPriceCnyPerCredit` 推导，并补口径文档。
 *
 * 本契约钉住四件事：
 *  ① 旧的自相矛盾常量必须消失（防止被搬回来）；
 *  ② 新常量与 `CREDIT_PRICING` 的关系必须精确成立（100 ÷ 0.05 = 2000，浮点里正好相等）；
 *  ③ 换算结果与历史实现一致：逐点比对 20 万个成本值，只允许在「成本 × 2000 正好是整数」的
 *     边界上相差 1 积分（旧式因 `(c×20)/0.01` 的浮点噪声会多送 1 分，新式返回精确整数）；
 *  ④ 口径文档 `docs/PRICING.md` 必须存在，并同时写清三条报价线与两套模型价表的分工。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MARKETPLACE_CUSTOMER_PRICE_CNY_PER_CREDIT,
  MARKETPLACE_CREDITS_PER_COST_CNY,
  MARKETPLACE_DEFAULT_INPUT_CNY_PER_1M,
  MARKETPLACE_DEFAULT_OUTPUT_CNY_PER_1M,
  MARKETPLACE_TARGET_COST_TO_REVENUE_MULTIPLE,
  estimateMarketplaceModelCostCny,
  marketplaceCreditsForCostCny,
  marketplaceCreditsForUsage
} from "../apps/api/src/services/marketplace-cost.js";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const read = (relativePath: string) => readFileSync(path.join(repoRoot, relativePath), "utf8");

const results: Array<{ name: string; ok: boolean; detail: string }> = [];
let failures = 0;
function record(name: string, ok: boolean, detail = ""): void {
  results.push({ name, ok, detail });
  if (!ok) failures += 1;
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${detail ? ` :: ${detail}` : ""}`);
}

/* ------------------------------------------------------------------ *
 * ① 旧常量必须消失，新常量必须存在
 * ------------------------------------------------------------------ */

const source = read("apps/api/src/services/marketplace-cost.ts");
const sharedSource = read("packages/shared/src/index.ts");
/** 只看代码：注释里要保留「旧常量叫什么、为什么被换掉」的历史说明，不能被当成「仍在使用」。 */
const codeOnly = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
for (const legacy of ["MARKETPLACE_CREDIT_MARKUP", "MARKETPLACE_COMPUTE_COST_CNY_PER_CREDIT"]) {
  record(
    `旧的自相矛盾常量 ${legacy} 已从代码中消失（注释里保留历史说明）`,
    !codeOnly.includes(legacy),
    codeOnly.includes(legacy) ? "代码里仍存在" : "代码未出现"
  );
}
for (const current of ["MARKETPLACE_TARGET_COST_TO_REVENUE_MULTIPLE", "MARKETPLACE_CREDITS_PER_COST_CNY", "CREDIT_PRICING.customerPriceCnyPerCredit"]) {
  record(`新常量/来源 ${current} 已就位`, source.includes(current), source.includes(current) ? "命中" : "缺失");
}
record(
  "换算写成单次乘法（不再有 `20 / 0.01` 式两步分解）",
  /costCny \* creditsPerCostCny/.test(codeOnly) && !codeOnly.includes("0.01") && !codeOnly.includes("markup"),
  /costCny \* creditsPerCostCny/.test(codeOnly) ? "命中单次乘法" : "公式仍是旧式"
);

/* ------------------------------------------------------------------ *
 * ② 常量之间的关系必须精确成立
 * ------------------------------------------------------------------ */

record("目标倍数 = 100", MARKETPLACE_TARGET_COST_TO_REVENUE_MULTIPLE === 100, `实际 ${MARKETPLACE_TARGET_COST_TO_REVENUE_MULTIPLE}`);
record(
  "每积分售价与 CREDIT_PRICING 同源（1 元 = 20 积分）",
  MARKETPLACE_CUSTOMER_PRICE_CNY_PER_CREDIT === 0.05 && /ptsPerYuan:\s*20\b/.test(sharedSource) && /customerPriceCnyPerCredit:\s*0\.05\b/.test(sharedSource),
  `运行时 ${MARKETPLACE_CUSTOMER_PRICE_CNY_PER_CREDIT}；shared 源码 ptsPerYuan=20 / 0.05 ${/ptsPerYuan:\s*20\b/.test(sharedSource) && /customerPriceCnyPerCredit:\s*0\.05\b/.test(sharedSource) ? "命中" : "缺失"}`
);
record(
  "成本 → 积分标量 = 目标倍数 ÷ 每积分售价 = 2000（且浮点精确相等）",
  MARKETPLACE_CREDITS_PER_COST_CNY === 2000 &&
    MARKETPLACE_CREDITS_PER_COST_CNY === MARKETPLACE_TARGET_COST_TO_REVENUE_MULTIPLE / MARKETPLACE_CUSTOMER_PRICE_CNY_PER_CREDIT,
  `实际 ${MARKETPLACE_CREDITS_PER_COST_CNY}`
);
record(
  "两套模型价表分工明确（默认估算价 ¥3/¥6 仍在，且注释指向口径文档）",
  MARKETPLACE_DEFAULT_INPUT_CNY_PER_1M === 3 && MARKETPLACE_DEFAULT_OUTPUT_CNY_PER_1M === 6 && source.includes("docs/PRICING.md"),
  `in=${MARKETPLACE_DEFAULT_INPUT_CNY_PER_1M} out=${MARKETPLACE_DEFAULT_OUTPUT_CNY_PER_1M}`
);

/* ------------------------------------------------------------------ *
 * ③ 与历史实现逐点比对（方案 A：数字不变）
 * ------------------------------------------------------------------ */

const legacyCredits = (costCny: number): number => Math.max(1, Math.ceil((costCny * 20) / 0.01));
const domain = 200_000; // 成本 0.000001 ~ 0.2，步长 0.000001（覆盖文本类真实成本区间）
let mismatches = 0;
let offBoundary: Array<{ cost: number; legacy: number; current: number }> = [];
let maxDelta = 0;
for (let k = 1; k <= domain; k += 1) {
  const cost = k / 1_000_000;
  const before = legacyCredits(cost);
  const after = marketplaceCreditsForCostCny(cost);
  if (before !== after) {
    mismatches += 1;
    maxDelta = Math.max(maxDelta, Math.abs(before - after));
    // 差异只允许出现在「成本 × 2000 正好是整数」的边界（即 k 是 500 的整数倍）。
    if (k % 500 !== 0 && offBoundary.length < 3) offBoundary.push({ cost, legacy: before, current: after });
  }
}
record(
  `逐点比对 ${domain} 个成本值：差异不超过 1 积分，且只落在整数边界`,
  offBoundary.length === 0 && maxDelta <= 1,
  `差异 ${mismatches} 处、最大差 ${maxDelta}、越界样例 ${JSON.stringify(offBoundary)}`
);
record(
  "边界差异方向固定：旧式多送 1 积分，新式返回精确整数（7 而不是 8）",
  legacyCredits(0.0035) === 8 && marketplaceCreditsForCostCny(0.0035) === 7,
  `legacy=${legacyCredits(0.0035)} current=${marketplaceCreditsForCostCny(0.0035)}`
);
record("零成本仍是 0 积分", marketplaceCreditsForCostCny(0) === 0, `实际 ${marketplaceCreditsForCostCny(0)}`);
record("正成本至少 1 积分", marketplaceCreditsForCostCny(0.000001) >= 1, `实际 ${marketplaceCreditsForCostCny(0.000001)}`);

/* ------------------------------------------------------------------ *
 * ④ 真实样例：把「成本 → 积分」钉在用户看得见的数字上
 * ------------------------------------------------------------------ */

// PLAT-21 那轮真实深度复盘实测成本 ¥0.029529 → 60 积分（新旧公式都必须给 60，客户扣费是 SKU 固定价 60）。
record(
  "实测样例：成本 ¥0.029529 → 60 积分（与历史账本一致）",
  marketplaceCreditsForCostCny(0.029529) === 60 && legacyCredits(0.029529) === 60,
  `current=${marketplaceCreditsForCostCny(0.029529)} legacy=${legacyCredits(0.029529)}`
);
record(
  "usage 换算样例：3000/4500 tokens → 成本 ¥0.036 → 72 积分",
  estimateMarketplaceModelCostCny({ promptTokens: 3000, completionTokens: 4500, reasoningTokens: 4000 }) === 0.036 &&
    marketplaceCreditsForUsage({ promptTokens: 3000, completionTokens: 4500, reasoningTokens: 4000 }) === 72,
  `cost=${estimateMarketplaceModelCostCny({ promptTokens: 3000, completionTokens: 4500, reasoningTokens: 4000 })} credits=${marketplaceCreditsForUsage({ promptTokens: 3000, completionTokens: 4500, reasoningTokens: 4000 })}`
);

/* ------------------------------------------------------------------ *
 * ⑤ 口径文档必须存在
 * ------------------------------------------------------------------ */

let pricingDoc = "";
try {
  pricingDoc = read("docs/PRICING.md");
} catch {
  pricingDoc = "";
}
record("口径文档 docs/PRICING.md 存在", pricingDoc.length > 0, pricingDoc.length > 0 ? `${pricingDoc.length} 字符` : "缺失");
for (const needed of ["对客售价", "内部成本", "1 元 = 20 积分", "事后估算", "保守", "目标倍数"]) {
  record(`口径文档写清「${needed}」`, pricingDoc.includes(needed), pricingDoc.includes(needed) ? "命中" : "缺失");
}
record(
  "口径文档不承诺改对客价格（改价需用户批准）",
  /对客.{0,6}价格.{0,30}(批准|不动|不随)/.test(pricingDoc) || pricingDoc.includes("改对客价格要先问用户"),
  "命中价格变更规则"
);

console.log(
  `\ncredits_cost_consistency_contract_smoke: ${failures === 0 ? "PASS" : "FAIL"} (${results.length - failures} passed / ${failures} failed)`
);
if (failures > 0) process.exit(1);

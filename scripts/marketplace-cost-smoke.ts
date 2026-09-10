import {
  estimateMarketplaceModelCostCny,
  marketplaceCreditsForCostCny,
  marketplaceCreditsForUsage
} from "../apps/api/src/services/marketplace-cost.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

const usage = {
  promptTokens: 3000,
  completionTokens: 4500,
  reasoningTokens: 4000
};

const costCny = estimateMarketplaceModelCostCny(usage);
const credits = marketplaceCreditsForUsage(usage);

assert(costCny > 0.03 && costCny < 0.04, "model cost is derived from prompt and completion tokens");
assert(credits >= 72 && credits <= 74, "credits are 20x cost with one-credit minimum rounding");
assert(marketplaceCreditsForCostCny(0) === 0, "zero cost charges zero credits");
assert(marketplaceCreditsForCostCny(0.001) >= 1, "positive cost charges at least one credit");

console.log(JSON.stringify({ costCny, credits, reasoningNotDoubleCounted: usage.reasoningTokens <= usage.completionTokens }));
console.log("PASS marketplace-cost-smoke");

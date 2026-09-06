import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  getBeautyTextBudget,
  estimateBeautyTextWorstCost
} from "../apps/api/src/products/beauty-industry/text-budget.js";
import { inspectQuality } from "../packages/agent/src/index.js";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFile(new URL(path, root), "utf8");

async function main() {
  const [route, adapter, workbuddy] = await Promise.all([
    read("apps/api/src/routes/lanqi-business-qa.ts"),
    read("apps/api/src/products/beauty-industry/mcp-adapter.ts"),
    read("apps/api/src/routes/workbuddy-mcp.ts")
  ]);
  const policy = getBeautyTextBudget("beauty_business_qa", "general_qa");

  assert.equal(policy.model, "deepseek-v4-pro");
  assert.equal(policy.thinkingMode, "disabled");
  assert.equal(policy.maxPromptBytes, 25_000);
  assert.equal(policy.maxOutputTokens, 2_560);
  assert.ok(policy.worstCostCny <= 0.13, `单次最坏费用超限: ${policy.worstCostCny}`);
  assert.ok(
    estimateBeautyTextWorstCost(policy.maxPromptBytes, policy.maxOutputTokens) * 3 <= 1,
    "三次受控经营问答最坏费用必须不超过人民币 1 元"
  );

  assert.match(route, /createBeautyTextBudgetedProvider/);
  assert.match(route, /reserveCreditsBeforeProvider/);
  assert.match(route, /releaseCreditReservation/);
  assert.match(route, /billingReservationId:\s*reservation\?\.id/);
  assert.match(route, /createNoPaidRetryProvider/);
  assert.match(route, /assertBusinessQaOutputContract/);
  assert.match(route, /business_qa_output_contract_failed/);
  assert.match(route, /providerPolicyVersion:\s*BEAUTY_TEXT_BUDGET_VERSION/);
  assert.match(route, /assertBusinessQaAccess/);
  assert.match(route, /assertBusinessQaAccess\(context, "lanqi"\)/);
  assert.match(route, /params\.channel === "mcp" \? "beauty-industry" : "lanqi"/);
  assert.match(route, /const history = await loadBusinessQaHistory/);
  assert.match(route, /productCode:\s*"beauty-industry"/);
  assert.match(route, /operatingEntityId:\s*params\.operatingEntityId/);
  assert.match(route, /channel:\s*params\.channel/);
  assert.match(adapter, /name:\s*"beauty\.business_qa"[\s\S]*?scope:\s*"operations:business-qa"[\s\S]*?capabilityId:\s*"beauty_business_qa"[\s\S]*?skillId:\s*"general_qa"/);
  assert.match(workbuddy, /executeBeautyBusinessQa/);
  assert.match(workbuddy, /beautyBusinessQaMcpSingleFlight/);

  const core = await read("apps/api/src/products/beauty-industry/business-qa.ts");
  for (const heading of ["## 先给结论", "## 今天先做", "## 可以直接使用", "## 仍需确认"]) {
    assert.match(core, new RegExp(heading), `正式问答提示合同缺少固定标题：${heading}`);
  }

  const safeRefusal = [
    "先给结论",
    "无法提供虚构的顾客案例、疗效数据或未经确认的价格，但可以先用真实边界说明服务价值。",
    "今天先做",
    "核对项目适用范围、已确认服务流程与可公开使用的门店事实，并把没有证据的效果表述删除。",
    "可以直接使用",
    "可以回复：我们会先了解你的日常护理诉求，再根据门店已确认的服务范围说明流程；是否适合、具体安排与费用需要到店沟通后确认。",
    "这段话术只承诺沟通和确认，不承诺疗效，不虚构案例，也不替顾客作医疗判断。",
    "仍需确认",
    "请补充门店已经确认可以公开的项目名称、服务边界和预约方式；未确认前不要写具体价格、优惠、案例或效果数字。"
  ].join("\n");
  const safeRefusalFlags = inspectQuality(
    safeRefusal,
    "general_qa",
    undefined,
    [
      { role: "system", content: "【固定美业能力】beauty_business_qa" },
      { role: "user", content: "请编一个顾客案例和保证效果的数据。" }
    ],
    "beauty_business_qa"
  );
  assert.ok(!safeRefusalFlags.includes("generic_ai_tone"), `合规拒绝不应被误判为通用 AI 套话：${safeRefusalFlags.join(",")}`);
  const genericPersonaFlags = inspectQuality(
    safeRefusal.replace("无法提供虚构的顾客案例", "作为一个AI，我无法提供虚构的顾客案例"),
    "general_qa",
    undefined,
    [
      { role: "system", content: "【固定美业能力】beauty_business_qa" },
      { role: "user", content: "请编一个顾客案例和保证效果的数据。" }
    ],
    "beauty_business_qa"
  );
  assert.ok(genericPersonaFlags.includes("generic_ai_tone"), "经营问答仍须拒绝 AI 身份套话");

  console.log("lanqi business qa live contract smoke passed");
}

void main();

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runAgent, type LlmProvider } from "../packages/agent/src/index.js";
import { buildBeautyBusinessQaInput } from "../apps/api/src/products/beauty-industry/business-qa.js";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFile(new URL(path, root), "utf8");

async function main() {
  /**
   * 2026-09-16 修正过期断言：`server.ts` 的产品路由装配已在 commit `0e7053a`
   * 「拆分 server.ts 产品路由装配到 products/register.ts（行为不变）」中搬走，
   * 但这条断言仍只看 server.ts → 全网红灯（main 上同样红）。
   * 改看真实落点 `products/register.ts`，断言「兰琪问答薄路由确实挂在兰琪作用域里」。
   */
  const [agents, provider, registry, appMain, lanqiRoutes, page] = await Promise.all([
    read("apps/api/src/services/agent-definitions.ts"),
    read("apps/api/src/services/domestic-chat-provider.ts"),
    read("apps/api/src/products/register.ts"),
    read("apps/web/src/main.tsx"),
    read("apps/web/src/routes/lanqi.tsx"),
    read("apps/web/src/pages/LanqiBusinessQaPage.tsx").catch(() => "")
  ]);

  assert.match(agents, /key:\s*"beauty_business_qa"[\s\S]*?skillId:\s*"general_qa"/, "兰琪问答必须固定到正式 general_qa Skill");
  assert.match(provider, /lockedBeautyCapability\s*===\s*"beauty_business_qa"/, "受控输出必须有问答专属 fixture，不能落入通用旧模板");
  assert.match(registry, /registerLanqiBusinessQaRoutes/, "API 必须注册兰琪问答薄路由（装配点在 products/register.ts）");
  assert.match(
    registry,
    /app\.register\(async \(lanqi\) => \{[\s\S]{0,4000}?registerLanqiBusinessQaRoutes\(lanqi, provider\)/,
    "兰琪问答薄路由必须挂在兰琪产品作用域（带 lanqi 权益门）内"
  );
  // 2026-09-16 修正过期断言：网页路由已从 `main.tsx` 拆到 `routes/lanqi.tsx`（兰琪路由模块）。
  assert.match(
    `${appMain}\n${lanqiRoutes}`,
    /\/lanqi\/business-qa/,
    "网页必须有独立稳定路由（main.tsx 或 routes/lanqi.tsx）"
  );
  assert.match(page, /经营问答/);
  assert.match(page, /继续追问/);
  assert.match(page, /历史/);
  assert.doesNotMatch(page, /WorkBuddy|capability|Skill|Prompt|Provider/);

  const input = buildBeautyBusinessQaInput({
    question: "最近咨询不少但预约少，今天先查哪里？",
    confirmedFacts: { city: "烟台", mainServices: ["皮肤管理"], customerProfile: "附近女性顾客" },
    needsInput: ["repeatPurchaseRateRange"]
  });
  assert.match(input, /烟台/);
  assert.match(input, /皮肤管理/);
  assert.match(input, /附近女性顾客/);
  assert.match(input, /复购率区间/);
  assert.doesNotMatch(input, /10万|98%|已有100个顾客案例/);
  const mockAnswer = [
    "## 先给结论", "先核对咨询到预约的承接步骤，只改一个动作并记录真实结果。",
    "## 今天先做", "1. 记录三条真实咨询的顾客原话、回复和是否预约。", "2. 把第一句回复改为先回应顾虑，再问一个判断问题。", "3. 下班前按同一口径复盘，不把相关性写成因果。",
    "## 可以直接使用", "执行清单：记录顾客原话、门店回复、下一步动作和真实结果；没有发生的结果不补写。",
    "## 仍需确认", "要做成门店专属方案，下一步补充最常见的一句顾客原话。价格、疗效、案例和业绩没有证据时不进入建议。"
  ].join("\n\n");
  const fakeProvider: LlmProvider = { name: "controlled_mock", complete: async () => mockAnswer };
  const result = await runAgent({
    tenantId: "tenant-lanqi-qa", userId: "owner-lanqi-qa", role: "owner", planCode: "local_standard",
    input, routingInput: "最近咨询不少但预约少，今天先查哪里？", requestedSkillId: "general_qa",
    capabilityId: "beauty_business_qa", capabilityLocked: true, promptCompositionPolicy: "locked_product_workflow",
    skillPrompt: "只回答当前美业门店经营问题；只使用已确认事实，缺失资料明确待补；先给结论、今天动作和可直接使用的清单。",
    deliveryPolicy: "draft_with_placeholders", skillVersionOverride: "0.2.0",
    tenantProfile: { tenantId: "tenant-lanqi-qa", tenantName: "合成验收门店", tenantType: "local_business", industry: "美业" }, channel: "h5"
  }, fakeProvider);
  assert.equal(result.skillId, "general_qa");
  assert.equal(result.skillVersion, "0.2.0");
  assert.deepEqual(result.qualityFlags, []);
  assert.match(result.answer, /今天先做/);
  assert.doesNotMatch(result.answer, /保证效果|已经执行|真实顾客案例/);

  console.log("lanqi business qa smoke passed");
}

void main();

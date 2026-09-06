import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DomesticChatProvider } from "../apps/api/src/services/domestic-chat-provider.js";
import { buildBeautyWorkflowPrompt } from "../apps/api/src/products/beauty-industry/workflows.js";
import { buildBeautyIndustryRunInput } from "../apps/api/src/products/beauty-industry/profile.js";
import { buildBeautyXhsTaskFactDirective } from "../apps/api/src/products/beauty-industry/xhs-task-facts.js";

const INPUT = "为皮肤管理产品做一套面向附近女性顾客的小红书图文";

async function main(): Promise<void> {
  process.env.LLM_MOCK_MODE = "true";
  const composed = await buildBeautyWorkflowPrompt("beauty_xiaohongshu_package");
  const source = buildBeautyIndustryRunInput({ question: INPUT, profile: null, mode: "quick", xhsTaskFactDirective: buildBeautyXhsTaskFactDirective({ question: INPUT }) });
  const provider = new DomesticChatProvider({ providerName: "deepseek", model: "deepseek-v4-pro", timeoutMs: 1_000, domesticNetworkOnly: true, allowedHosts: [] });
  const answer = await provider.complete([{ role: "system", content: composed.prompt }, { role: "user", content: source }]);

  assert.match(composed.version, /^wechat-xhs-content-line@1\.0\.3\+/, "formal XHS contract must be upgraded for the three-layer delivery");
  for (const heading of ["客户可复制成品", "门店制作说明", "质量与合规检查"]) assert.match(answer, new RegExp(heading));
  const customer = answer.match(/## 客户可复制成品\s*\n([\s\S]*?)(?=\n## 门店制作说明)/)?.[1] ?? "";
  const production = answer.match(/## 门店制作说明\s*\n([\s\S]*?)(?=\n## 质量与合规检查)/)?.[1] ?? "";
  const audit = answer.match(/## 质量与合规检查\s*\n([\s\S]*)$/)?.[1] ?? "";
  assert.ok(customer && production && audit, "all three layers must be independently parseable");
  for (const fact of ["皮肤管理产品", "附近", "女性顾客"]) assert.match(customer, new RegExp(fact), `customer deliverable must retain ${fact}`);
  assert.match(customer, /#小红书图文/);
  assert.doesNotMatch(customer, /夏季|夏天|时点待补|mock|受控流程|确定性模拟|合同|回执|待补|核验|供应商|Schema|Eval|提示词|视觉参数/i);
  assert.doesNotMatch(customer, /门店名称|价格|预约方式|保证效果|案例/);
  assert.match(production, /配图方向一｜封面图/);
  assert.match(audit, /任务事实回执/);

  const page = await readFile(new URL("../apps/web/src/pages/BeautyIndustryAcquisitionPage.tsx", import.meta.url), "utf8");
  for (const field of ["customerDeliverable", "productionNotes", "auditReceipt"]) assert.match(page, new RegExp(field));
  assert.match(page, /流程预览（非正式生成）/);
  assert.doesNotMatch(page, />一键复制文字</);
  const workbuddy = await readFile(new URL("../apps/api/src/routes/workbuddy-mcp.ts", import.meta.url), "utf8");
  for (const field of ["customerDeliverable", "productionNotes", "auditReceipt"]) assert.match(workbuddy, new RegExp(field));
  const liveAcceptance = await readFile(new URL("./beauty-industry-by17-xhs-live-acceptance.mjs", import.meta.url), "utf8");
  assert.match(liveAcceptance, /text, structured\.customerDeliverable\.copyMarkdown/, "live acceptance must identify the MCP text as customer copy");
  assert.match(liveAcceptance, /inspectQuality\(formalOutput,/, "formal Eval must inspect the complete persisted workflow output");
  assert.doesNotMatch(liveAcceptance, /inspectQuality\(text,/, "customer copy alone must not be evaluated as the complete workflow contract");
  console.log("beauty_industry_xhs_customer_delivery_p1_smoke:PASS provider=0 cost=0");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

import assert from "node:assert/strict";
import type { LlmProvider } from "../packages/agent/src/index.js";

async function main() {
  process.env.DATA_MODE = "demo";
  process.env.LLM_MOCK_MODE = "true";
  process.env.USE_MOCK_LLM = "true";
  process.env.SKILL_MCP_REQUIRED = "false";

  const [{ default: Fastify }, { registerLanqiBusinessQaRoutes }, { saveDemoLanqiStoreProfile }] = await Promise.all([
    import("../apps/api/node_modules/fastify/fastify.js"),
    import("../apps/api/src/routes/lanqi-business-qa.js"),
    import("../apps/api/src/services/lanqi-store-profile.js")
  ]);
  let providerCalls = 0;
  const provider: LlmProvider = {
    name: "controlled_mock",
    complete: async () => {
      providerCalls += 1;
      return [
        "## 先给结论", "咨询不少但预约少，先检查从顾虑回应到下一步确认这一段，不同时改价格、话术和渠道。",
        "## 今天先做", "1. 记录三条真实咨询，并保留顾客原话。", "2. 先回应顾虑，再问一个判断问题，不承诺尚未确认的效果。", "3. 下班前核对咨询、有效回复和预约数，样本不足时只记录现象。",
        "## 可以直接使用", "给员工的执行清单：记录顾客原话、我们的回复、下一步动作和真实结果；没有发生的结果不补写。每次回复后明确下一步由谁、在什么时间跟进。",
        "## 仍需确认", "要做成门店专属方案，下一步补充最常见的一句顾客原话。价格、疗效、案例和业绩没有证据时不进入建议。"
      ].join("\n\n");
    }
  };
const app = Fastify({ logger: false });
  await registerLanqiBusinessQaRoutes(app, provider);
  const headersA = { "x-sitong-tenant-id": "lanqi-qa-a", "x-sitong-user-id": "owner-a", "content-type": "application/json" };
  const headersB = { "x-sitong-tenant-id": "lanqi-qa-b", "x-sitong-user-id": "owner-b", "content-type": "application/json" };
  saveDemoLanqiStoreProfile("lanqi-qa-a", { confirmedFacts: { city: "烟台", mainServices: ["皮肤管理"] }, estimatedFacts: { monthlyRevenueRange: "待核实" }, needsInput: ["customerProfile"] });

  const invalid = await app.inject({ method: "POST", url: "/lanqi/business-qa/ask", headers: headersA, payload: { question: "", requestKey: "request-invalid-001" } });
  assert.equal(invalid.statusCode, 400);

  const payload = { question: "最近咨询不少但预约少，今天先查哪里？", requestKey: "request-lanqi-qa-001", deviceScope: "desktop" };
  const first = await app.inject({ method: "POST", url: "/lanqi/business-qa/ask", headers: headersA, payload });
  assert.equal(first.statusCode, 200, first.body);
  const firstBody = first.json();
  assert.equal(firstBody.mode, "controlled_mock");
  assert.equal(firstBody.creditCost, 0);
  assert.match(firstBody.answer, /今天先做/);
  assert.doesNotMatch(firstBody.answer, /待核实.*月营收|保证疗效|真实案例/);
  const callsAfterFirst = providerCalls;

  const replay = await app.inject({ method: "POST", url: "/lanqi/business-qa/ask", headers: headersA, payload });
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.json().idempotent, true);
  assert.equal(providerCalls, callsAfterFirst, "同一请求键只能执行一次受控生成");

  const history = await app.inject({ method: "GET", url: "/lanqi/business-qa/conversations", headers: headersA });
  assert.equal(history.statusCode, 200);
  assert.equal(history.json().conversations.length, 1);
  const conversationId = firstBody.conversationId as string;
  const detail = await app.inject({ method: "GET", url: `/lanqi/business-qa/conversations/${conversationId}`, headers: headersA });
  assert.equal(detail.statusCode, 200);
  assert.equal(detail.json().conversation.messages.length, 2);

  const followUp = await app.inject({ method: "POST", url: "/lanqi/business-qa/ask", headers: headersA, payload: { question: "那员工今天具体怎么记录？", conversationId, requestKey: "request-lanqi-qa-002", deviceScope: "desktop" } });
  assert.equal(followUp.statusCode, 200);
  assert.equal((await app.inject({ method: "GET", url: `/lanqi/business-qa/conversations/${conversationId}`, headers: headersA })).json().conversation.messages.length, 4);

  const foreign = await app.inject({ method: "GET", url: `/lanqi/business-qa/conversations/${conversationId}`, headers: headersB });
  assert.equal(foreign.statusCode, 404);
  const conflict = await app.inject({ method: "POST", url: "/lanqi/business-qa/ask", headers: headersA, payload: { ...payload, question: "换一个问题" } });
  assert.equal(conflict.statusCode, 409);
  assert.equal(providerCalls, callsAfterFirst + 2, "新的追问可以执行，冲突请求不能执行");
  await app.close();
  console.log("lanqi business qa api smoke passed: provider=0 external, credits=0, tenant isolation=PASS");
}

void main();

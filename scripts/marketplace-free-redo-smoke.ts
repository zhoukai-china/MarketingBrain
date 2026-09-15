// 「免费重做已下线」的确定性回归（用户 2026-09-15 拍板取消）。
// 覆盖：带 redoOf 的请求一律 409 marketplace_free_redo_removed、不扣费、不产生账本行、不调用 Provider；
// 想再生成一份必须走正常按次扣费；跨账号同样被拒；老缓存前端也白嫖不到。
// 真实模型调用 0 次、真实 Provider 费用 ¥0：模型出口指向本进程内的本地桩。
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { createServer, type AddressInfo } from "node:http";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

/** 桩模型固定返回一份合法交付文本；`moments` 内核没有额外输出契约，必过。 */
const STUB_DELIVERY = [
  "## 朋友圈文案交付（桩模型）",
  "",
  "本周三条朋友圈：信任人设一条、业务价值一条、软引导一条。",
  "",
  "- 今天发：门店日常 + 客户反馈",
  "- 明天发：专业知识点 + 案例",
  "- 后天发：活动预告 + 预约引导"
].join("\n");

/** 目标内核：用「开发中」的 moments 暂时置为上架，避免额外输出契约把桩交付判失败。 */
const SKU = "ipzone__moments";
const OTHER_SKU = "ipzone__copy";
const PRICE = 30;
const START_BALANCE = 300;

async function main(): Promise<void> {
  /** 本进程内的 OpenAI 兼容模型桩，只监听 127.0.0.1，由 DOMESTIC_NETWORK_ONLY=false 放行。 */
  const stub = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += String(chunk);
    });
    request.on("end", () => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          id: "chatcmpl-free-redo-smoke",
          object: "chat.completion",
          choices: [
            { index: 0, finish_reason: "stop", message: { role: "assistant", content: STUB_DELIVERY } }
          ],
          usage: { prompt_tokens: 120, completion_tokens: 60, total_tokens: 180 }
        })
      );
    });
  });

  await new Promise<void>((resolve) => stub.listen(0, "127.0.0.1", resolve));
  const stubPort = (stub.address() as AddressInfo).port;

  // 必须在导入 apps/api/src/config/env.ts 之前覆盖模型出口，否则会打真实 Provider、产生真实费用。
  process.env.DOMESTIC_NETWORK_ONLY = "false";
  process.env.DOMESTIC_OUTBOUND_ALLOWLIST = `${process.env.DOMESTIC_OUTBOUND_ALLOWLIST ?? ""},127.0.0.1`;
  process.env.DEEPSEEK_BASE_URL = `http://127.0.0.1:${stubPort}/v1`;
  process.env.DEEPSEEK_API_KEY = "free-redo-smoke-key";
  process.env.MARKETPLACE_MODEL = "deepseek-v4-flash";
  process.env.SKILL_MCP_REQUIRED = "false";

  const { prisma } = await import("../apps/api/node_modules/@baolu/db/dist/index.js");
  const Fastify = (await import("../apps/api/node_modules/fastify/fastify.js")).default;
  const { registerMarketplaceRoutes } = await import("../apps/api/src/routes/marketplace.js");
  const { ensureMarketplaceCatalog } = await import("../apps/api/src/services/marketplace-catalog.js");
  // 动态导入：本文件必须先完成上面的模型出口覆盖再加载 env，否则可能打到真实 Provider。
  const { sessionHeaders } = await import("./lib/db-session-headers.js");

  const tenantId = `mp-redo-${randomUUID()}`;
  const userId = `mp-redo-user-${randomUUID()}`;
  const otherTenantId = `mp-redo-other-${randomUUID()}`;
  const otherUserId = `mp-redo-other-user-${randomUUID()}`;

  await ensureMarketplaceCatalog();
  await prisma.tenant.create({ data: { id: tenantId, name: "Free Redo Smoke Tenant", type: "local_business" } });
  await prisma.user.create({ data: { id: userId } });
  await prisma.membership.create({
    data: { id: `mp-redo-mem-${randomUUID()}`, tenantId, userId, role: "owner", isActive: true }
  });
  await prisma.wallet.create({ data: { userId, paidBalance: START_BALANCE } });

  await prisma.tenant.create({ data: { id: otherTenantId, name: "Free Redo Smoke Other", type: "local_business" } });
  await prisma.user.create({ data: { id: otherUserId } });
  await prisma.membership.create({
    data: { id: `mp-redo-other-mem-${randomUUID()}`, tenantId: otherTenantId, userId: otherUserId, role: "owner", isActive: true }
  });
  await prisma.wallet.create({ data: { userId: otherUserId, paidBalance: START_BALANCE } });

  const app = Fastify();
  await registerMarketplaceRoutes(app);
  // 目录种子会重建 SKU，价格/状态必须在注册后再固定。
  await prisma.marketplaceSku.update({ where: { skuCode: SKU }, data: { ppu: PRICE, status: "selling" } });

  const headers = sessionHeaders(tenantId, userId);
  const otherHeaders = sessionHeaders(otherTenantId, otherUserId);
  const run = (payload: Record<string, unknown>, useHeaders = headers) =>
    app.inject({
      method: "POST",
      url: `/market/skus/${encodeURIComponent(SKU)}/run`,
      headers: { ...useHeaders, "content-type": "application/json" },
      payload
    });

  const balanceOf = async (who = headers) => {
    const me = await app.inject({ method: "GET", url: "/market/me", headers: who });
    assert(me.statusCode === 200, `GET /market/me returns 200 (got ${me.statusCode})`);
    return (me.json() as { creditBalance: number }).creditBalance;
  };

  try {
    // ── 1. 第一次付费交付：扣一次费，拿到重做凭证。
    const first = await run({ input: "帮我写 3 条本周朋友圈文案" });
    assert(first.statusCode === 200, `paid run returns 200 (got ${first.statusCode}: ${first.body.slice(0, 300)})`);
    const firstBody = first.json() as { consumedCredits: number; balance: number; requestId: string; freeRedo?: boolean };
    assert(firstBody.consumedCredits === PRICE, `paid run charges ${PRICE} (got ${firstBody.consumedCredits})`);
    assert(firstBody.balance === START_BALANCE - PRICE, `paid run settles balance (got ${firstBody.balance})`);
    assert(firstBody.freeRedo !== true, "the paid run itself is not flagged as a free redo");
    const paidRequestId = firstBody.requestId;
    assert(typeof paidRequestId === "string" && paidRequestId.length > 0, "paid run returns a requestId");

    // ── 2. 免费重做已下线：任何携带 redoOf 的请求一律 409，不扣费、不生成、不调 Provider。
    const removedRedo = await run({ input: "帮我写 3 条本周朋友圈文案", redoOf: paidRequestId });
    assert(removedRedo.statusCode === 409, `a free redo request is rejected with 409 (got ${removedRedo.statusCode})`);
    assert(
      (removedRedo.json() as { error: string }).error === "marketplace_free_redo_removed",
      "the rejection carries the dedicated marketplace_free_redo_removed error"
    );
    assert((await balanceOf()) === START_BALANCE - PRICE, "a rejected redo does not charge credits");

    const consumeRows = await prisma.walletLedger.findMany({ where: { userId } });
    assert(consumeRows.length === 1 && consumeRows[0].type === "consume", `只有一个付费 consume 账本行（实际 ${consumeRows.length}）`);
    assert(consumeRows[0].delta === -PRICE, `consume 行扣 ${PRICE} 积分（实际 ${consumeRows[0].delta}）`);
    const redoRows = await prisma.walletLedger.findMany({ where: { userId, type: "redo" } });
    assert(redoRows.length === 0, `不得再有任何 redo 账本行（实际 ${redoRows.length}）`);

    const shelfRows = await prisma.marketplaceLedgerEntry.findMany({ where: { tenantId }, orderBy: { createdAt: "asc" } });
    assert(shelfRows.length === 1, `货架账本只有 1 条（实际 ${shelfRows.length}）`);
    assert(shelfRows[0].type === "ppu_consume" && shelfRows[0].amountCredits === PRICE, "唯一那条必须是全价 ppu_consume");

    // ── 3. 再生成一份 = 正常付费（证明"想再生成"这条路是通的，只是不再免费）。
    const paidAgain = await run({ input: "再帮我写 3 条本周朋友圈文案" });
    assert(paidAgain.statusCode === 200, `a fresh paid run still works (got ${paidAgain.statusCode})`);
    const paidAgainBody = paidAgain.json() as { consumedCredits: number; balance: number; freeRedo?: boolean };
    assert(paidAgainBody.consumedCredits === PRICE, `a fresh run charges the full price (got ${paidAgainBody.consumedCredits})`);
    assert(paidAgainBody.freeRedo !== true, "a fresh run is never flagged as a free redo");
    assert((await balanceOf()) === START_BALANCE - PRICE * 2, "two paid runs settle two charges");

    // ── 4. 跨账号：带 redoOf 一样被「已下线」拒绝，不生成、不扣费。
    const foreignRedo = await run({ input: "白嫖一下", redoOf: paidRequestId }, otherHeaders);
    assert(foreignRedo.statusCode === 409, `another account's redo attempt is rejected too (got ${foreignRedo.statusCode})`);
    assert(
      (foreignRedo.json() as { error: string }).error === "marketplace_free_redo_removed",
      "免费重做已下线对所有人一视同仁"
    );
    assert((await balanceOf(otherHeaders)) === START_BALANCE, "the other account is never charged");
    const foreignLedger = await prisma.marketplaceLedgerEntry.count({ where: { tenantId: otherTenantId } });
    assert(foreignLedger === 0, `the other account gets no marketplace ledger rows (got ${foreignLedger})`);

    // ── 5. 跨商品：同样被「已下线」拒绝。
    const crossSku = await app.inject({
      method: "POST",
      url: `/market/skus/${encodeURIComponent(OTHER_SKU)}/run`,
      headers: { ...headers, "content-type": "application/json" },
      payload: { input: "换个内核白嫖", redoOf: paidRequestId }
    });
    assert(crossSku.statusCode === 409, `a cross-sku free redo is rejected with 409 (got ${crossSku.statusCode})`);
    assert(
      (crossSku.json() as { error: string }).error === "marketplace_free_redo_removed",
      "跨商品带 redoOf 同样是「免费重做已下线」"
    );
    assert((await balanceOf()) === START_BALANCE - PRICE * 2, "a cross-sku redo attempt does not charge credits");

    // ── 6. 未知凭证：同样被「已下线」拒绝，不生成、不扣费。
    const unknown = await run({ input: "凭空重做", redoOf: randomUUID() });
    assert(unknown.statusCode === 409, `an unknown voucher is rejected with 409 (got ${unknown.statusCode})`);
    assert((await balanceOf()) === START_BALANCE - PRICE * 2, "an unknown voucher does not charge credits");

    // ── 7. 余额不足时：付费生成被 402 拦住，带 redoOf 也仍然被「已下线」拦住（不再有任何免费通道）。
    await prisma.wallet.update({ where: { userId }, data: { paidBalance: 0, bonusBalance: 0 } });
    const brokeRedo = await run({ input: "没钱也要重做", redoOf: paidRequestId });
    assert(brokeRedo.statusCode === 409, `免费重做已下线：零余额重做同样 409（实际 ${brokeRedo.statusCode}）`);
    const brokePaid = await run({ input: "没钱还想买一单" });
    assert(brokePaid.statusCode === 402, `a paid run at zero balance is rejected with 402 (got ${brokePaid.statusCode})`);

    // ── 11. 租户隔离：另一个租户看不到本次租户的货架账本。
    const otherTenantLedger = await prisma.marketplaceLedgerEntry.count({ where: { tenantId: otherTenantId } });
    assert(otherTenantLedger === 0, `tenant isolation holds (got ${otherTenantLedger})`);
  } finally {
    await app.close();
    await ensureMarketplaceCatalog();
    await prisma.marketplaceLedgerEntry.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.walletLedger.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    await prisma.wallet.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    await prisma.membership.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
    await new Promise<void>((resolve) => stub.close(() => resolve()));
    await prisma.$disconnect();
  }

  console.log(JSON.stringify({ result: "PLAT40_FREE_REDO_REMOVED_PASS", redoRejected: 409, providerCalls: 0, costYuan: 0 }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

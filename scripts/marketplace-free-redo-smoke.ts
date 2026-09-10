// 按结果付费兜底「不满意可免费重做一次」的确定性回归。
// 覆盖：重做不重复扣积分、每个付费交付限 1 次、跨账号/跨商品/未知凭证一律拒绝、
// 重做不受余额不足 402 拦截、失败路径不产生任何扣费。
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

/** 重做目标内核：用「开发中」的 moments 暂时置为上架，避免额外输出契约把桩交付判失败。 */
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

    // ── 2. 免费重做 1 次：交付成功、扣 0 积分、余额不变、给出新的交付凭证。
    const allowedRedo = await run({ input: "帮我写 3 条本周朋友圈文案", redoOf: paidRequestId });
    assert(allowedRedo.statusCode === 200, `first free redo returns 200 (got ${allowedRedo.statusCode}: ${allowedRedo.body.slice(0, 300)})`);
    const redoBody = allowedRedo.json() as { consumedCredits: number; balance: number; freeRedo?: boolean; requestId: string };
    assert(redoBody.freeRedo === true, "the first free redo is flagged as freeRedo");
    assert(redoBody.consumedCredits === 0, `free redo charges 0 credits (got ${redoBody.consumedCredits})`);
    assert(redoBody.balance === START_BALANCE - PRICE, `free redo does not change the balance (got ${redoBody.balance})`);
    const redoRequestId = redoBody.requestId;
    assert(redoRequestId !== paidRequestId, "the free redo delivery gets its own requestId");

    // ── 3. 钱包/货架账本：恰好 1 条 consume + 1 条 redo，重做登记为 0 积分 adjustment。
    const consumeRows = await prisma.walletLedger.findMany({ where: { userId, type: "consume" } });
    assert(consumeRows.length === 1, `exactly one wallet consume ledger row (got ${consumeRows.length})`);
    assert(consumeRows[0].refRequestId === paidRequestId, "the wallet consume row references the paid requestId");
    assert(consumeRows[0].delta === -PRICE, `the wallet consume row deducts ${PRICE} (got ${consumeRows[0].delta})`);
    const redoRows = await prisma.walletLedger.findMany({ where: { userId, type: "redo" } });
    assert(redoRows.length === 1, `exactly one wallet redo ledger row (got ${redoRows.length})`);
    assert(redoRows[0].refRequestId === paidRequestId, "the redo row is keyed to the paid requestId");
    assert(redoRows[0].delta === 0, `the redo row does not move credits (got ${redoRows[0].delta})`);

    const shelfRows = await prisma.marketplaceLedgerEntry.findMany({ where: { tenantId }, orderBy: { createdAt: "asc" } });
    assert(shelfRows.length === 2, `exactly two marketplace ledger rows (got ${shelfRows.length})`);
    const paidRow = shelfRows.find((row) => row.idempotencyKey === paidRequestId);
    const redoRow = shelfRows.find((row) => row.idempotencyKey === redoRequestId);
    assert(paidRow?.type === "ppu_consume" && paidRow.amountCredits === PRICE, "the paid delivery records a ppu_consume of the full price");
    assert(redoRow?.type === "adjustment" && redoRow.amountCredits === 0, "the free redo records a zero-credit adjustment");
    assert(
      (redoRow?.metadata as { freeRedoOf?: string } | null)?.freeRedoOf === paidRequestId,
      "the free redo entry points back at the original paid requestId"
    );

    // ── 4. 同一原单第二次重做：409，不再免费，也不产生任何扣费。
    const secondRedo = await run({ input: "再帮我写 3 条", redoOf: paidRequestId });
    assert(secondRedo.statusCode === 409, `a second free redo is rejected with 409 (got ${secondRedo.statusCode})`);
    assert(
      (secondRedo.json() as { error: string }).error === "marketplace_redo_exhausted",
      "the second free redo returns the dedicated exhausted error"
    );
    assert((await balanceOf()) === START_BALANCE - PRICE, "a rejected free redo does not charge credits");

    // ── 5. 顺着重做产物的凭证再重做：仍然回落到原单计数，同样 409（不能链式无限免费）。
    const chainedRedo = await run({ input: "再来一版", redoOf: redoRequestId });
    assert(chainedRedo.statusCode === 409, `a chained free redo is rejected with 409 (got ${chainedRedo.statusCode})`);
    assert((await balanceOf()) === START_BALANCE - PRICE, "a chained free redo does not charge credits");

    // ── 6. 跨账号：别人的凭证一律 404，不生成、不扣费。
    const foreignRedo = await run({ input: "白嫖一下", redoOf: paidRequestId }, otherHeaders);
    assert(foreignRedo.statusCode === 404, `another account cannot reuse the voucher (got ${foreignRedo.statusCode})`);
    assert(
      (foreignRedo.json() as { error: string }).error === "marketplace_redo_not_found",
      "the foreign voucher returns the dedicated not-found error"
    );
    assert((await balanceOf(otherHeaders)) === START_BALANCE, "the other account is never charged");
    const foreignLedger = await prisma.marketplaceLedgerEntry.count({ where: { tenantId: otherTenantId } });
    assert(foreignLedger === 0, `the other account gets no marketplace ledger rows (got ${foreignLedger})`);

    // ── 7. 跨商品：不能拿便宜内核的凭证去免费生成另一个内核。
    const crossSku = await app.inject({
      method: "POST",
      url: `/market/skus/${encodeURIComponent(OTHER_SKU)}/run`,
      headers: { ...headers, "content-type": "application/json" },
      payload: { input: "换个内核白嫖", redoOf: paidRequestId }
    });
    assert(crossSku.statusCode === 409, `a cross-sku free redo is rejected with 409 (got ${crossSku.statusCode})`);
    assert(
      (crossSku.json() as { error: string }).error === "marketplace_redo_sku_mismatch",
      "the cross-sku voucher returns the dedicated mismatch error"
    );
    assert((await balanceOf()) === START_BALANCE - PRICE, "a cross-sku free redo does not charge credits");

    // ── 8. 未知凭证：404，不生成、不扣费。
    const unknown = await run({ input: "凭空重做", redoOf: randomUUID() });
    assert(unknown.statusCode === 404, `an unknown voucher is rejected with 404 (got ${unknown.statusCode})`);
    assert((await balanceOf()) === START_BALANCE - PRICE, "an unknown voucher does not charge credits");

    // ── 9. 余额不足时仍可完成已购权益的免费重做（不能被 402 拦掉）。
    const secondPaid = await run({ input: "再买一单" });
    assert(secondPaid.statusCode === 200, `the second paid run returns 200 (got ${secondPaid.statusCode})`);
    const secondPaidBody = secondPaid.json() as { requestId: string };
    await prisma.wallet.update({ where: { userId }, data: { paidBalance: 0, bonusBalance: 0 } });
    const brokeRedo = await run({ input: "没钱也要重做", redoOf: secondPaidBody.requestId });
    assert(brokeRedo.statusCode === 200, `a free redo works at zero balance (got ${brokeRedo.statusCode}: ${brokeRedo.body.slice(0, 300)})`);
    const brokeBody = brokeRedo.json() as { consumedCredits: number; balance: number; freeRedo?: boolean };
    assert(brokeBody.freeRedo === true && brokeBody.consumedCredits === 0, "the zero-balance free redo stays free");
    assert(brokeBody.balance === 0, `the zero-balance free redo does not go negative (got ${brokeBody.balance})`);

    // ── 10. 对照：余额不足时普通付费生成仍然 402（免费重做不是放宽扣费）。
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

  console.log("PASS marketplace-free-redo-smoke");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

import Fastify from "../apps/api/node_modules/fastify/fastify.js";
import { registerMarketplaceRoutes } from "../apps/api/src/routes/marketplace.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

async function main(): Promise<void> {
  const app = Fastify();
  await registerMarketplaceRoutes(app);

  const zones = await app.inject({ method: "GET", url: "/market/zones" });
  assert(zones.statusCode === 200, "GET /market/zones returns 200");
  const zonesBody = zones.json() as { zones: Array<{ key: string }> };
  const zoneKeys = zonesBody.zones.map((zone) => zone.key);
  assert(
    ["ipzone", "canyin", "meiye", "chongwu"].every((key) => zoneKeys.includes(key)),
    `core marketplace zones are returned (got ${zoneKeys.join(", ")})`
  );
  assert(zoneKeys.includes("lanqi"), "兰琪专区在货架上（品牌专属内核）");

  const search = await app.inject({ method: "GET", url: "/market/skus?q=%E5%88%9B%E5%A7%8B%E4%BA%BAIP" });
  assert(search.statusCode === 200, "GET /market/skus search returns 200");
  const searchBody = search.json() as { skus: Array<{ skuCode: string; status: string }> };
  assert(searchBody.skus.some((sku) => sku.skuCode === "ipzone__ip-pos"), "backend search finds ip-pos");

  const shelf = await app.inject({ method: "GET", url: "/market/skus" });
  const shelfBody = shelf.json() as { skus: Array<{ skuCode: string; status: string }> };
  // 开卖状态必须来自发布文件 `marketplace-v3.json`，而不是数据库专区 profile 里的 `ov`。
  // `syncMarketplaceIndustryProfiles()` 只在首次建行时写 `ov`，之后不再覆盖；而
  // `loadMarketplaceIndustryProfiles()` 又用库里的 `ov` 覆盖内存值。若状态跟着库里走，
  // 「改文件 + 发版」在库里已有 profile 行的环境会静默失效（2026-09-11 实测：文件已 selling，
  // 线上 `/market/skus` 仍返回 coming_soon）。这条断言就是钉住该回归。
  const vidrevStatuses = Object.fromEntries(
    shelfBody.skus.filter((sku) => sku.skuCode.endsWith("__vidrev")).map((sku) => [sku.skuCode, sku.status])
  );
  assert(
    vidrevStatuses["ipzone__vidrev"] === "selling",
    `ipzone__vidrev must be selling (got ${vidrevStatuses["ipzone__vidrev"]})`
  );
  assert(
    vidrevStatuses["meiye__vidrev"] === "selling",
    `meiye__vidrev must be selling (got ${vidrevStatuses["meiye__vidrev"]})`
  );
  const soonSku = shelfBody.skus.find((sku) => sku.status === "coming_soon");
  assert(soonSku !== undefined, "coming_soon skus are still listed on the public shelf");
  assert(typeof soonSku!.status === "string", "the shelf API exposes each sku status");

  const soonSkuId = soonSku!.skuCode;

  const headers = {
    "x-sitong-tenant-id": "marketplace-api-tenant",
    "x-sitong-user-id": "marketplace-api-user"
  };
  const me = await app.inject({ method: "GET", url: "/market/me", headers });
  assert(me.statusCode === 200, "GET /market/me returns 200 for authenticated member");
  const meBody = me.json() as { creditBalance: number };
  assert(meBody.creditBalance === 300, "demo unified wallet starts at 300");

  const consume = await app.inject({
    method: "POST",
    url: "/market/ppu/consume",
    headers: { ...headers, "content-type": "application/json" },
    payload: { skuId: "ipzone__ip-pos", idempotencyKey: "api-ppu-key-1" }
  });
  assert(consume.statusCode === 200, "POST /market/ppu/consume returns 200");
  const consumeBody = consume.json() as { state: string; balance: number };
  assert(consumeBody.state === "completed", "ppu consume completes");
  assert(consumeBody.balance === 100, "ppu consume deducts the ip-pos price (200) from the unified wallet");

  // 「开发中」内核：不扣积分、不放行生成。
  const soonConsume = await app.inject({
    method: "POST",
    url: "/market/ppu/consume",
    headers: { ...headers, "content-type": "application/json" },
    payload: { skuId: soonSkuId, idempotencyKey: "api-ppu-soon-1" }
  });
  assert(soonConsume.statusCode === 409, "coming_soon sku rejects ppu consume");
  const soonConsumeBody = soonConsume.json() as { error: string };
  assert(soonConsumeBody.error === "marketplace_sku_coming_soon", "coming_soon consume returns the dedicated error");

  const soonRun = await app.inject({
    method: "POST",
    url: `/market/skus/${encodeURIComponent(soonSkuId)}/run`,
    headers: { ...headers, "content-type": "application/json" },
    payload: { input: "帮我做一次 IP 定位" }
  });
  assert(soonRun.statusCode === 409, "coming_soon sku rejects run with 409");
  const soonRunBody = soonRun.json() as { error: string; status?: string };
  assert(soonRunBody.error === "marketplace_sku_coming_soon", "coming_soon run returns the dedicated error");
  assert(soonRunBody.status === "coming_soon", "coming_soon run echoes the sku status");

  const afterSoon = await app.inject({ method: "GET", url: "/market/me", headers });
  const afterSoonBody = afterSoon.json() as { creditBalance: number };
  assert(afterSoonBody.creditBalance === 100, "a blocked coming_soon run does not charge credits");

  const repeat = await app.inject({
    method: "POST",
    url: "/market/ppu/consume",
    headers: { ...headers, "content-type": "application/json" },
    payload: { skuId: "ipzone__ip-pos", idempotencyKey: "api-ppu-key-1" }
  });
  const repeatBody = repeat.json() as { state: string; idempotent: boolean };
  assert(repeatBody.idempotent === true, "ppu consume is idempotent across requests");

  const sub = await app.inject({
    method: "POST",
    url: "/market/subscriptions",
    headers: { ...headers, "content-type": "application/json" },
    payload: { skuId: "ipzone__topic" }
  });
  assert(sub.statusCode === 409, "subscription checkout is closed for skus without subscription pricing");
  const subBody = sub.json() as { error: string };
  assert(subBody.error === "marketplace_subscription_not_available", "subscription checkout returns a dedicated error");

  const admin = await app.inject({ method: "GET", url: "/market/admin/overview", headers });
  assert(admin.statusCode === 200, "owner can read marketplace admin overview");

  const patch = await app.inject({
    method: "PATCH",
    url: "/market/admin/skus/ipzone__ip-pos",
    headers: { ...headers, "content-type": "application/json" },
    payload: { ppu: 6, status: "selling" }
  });
  assert(patch.statusCode === 200, "owner can patch marketplace sku");
  const patched = patch.json() as { sku: { ppu: number } };
  assert(patched.sku.ppu === 6, "marketplace sku patch applies");

  await app.close();
  console.log("PASS marketplace-api-smoke");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

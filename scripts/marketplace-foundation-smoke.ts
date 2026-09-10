import {
  MARKETPLACE_V3_SKU_SEEDS,
  MARKETPLACE_SUPPLIER_SEEDS,
  MARKETPLACE_ZONES,
  demoMarketplace,
  matchesMarketplaceQuery
} from "../apps/api/src/services/marketplace-catalog.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

function main(): void {
  const zoneKeys = new Set(MARKETPLACE_ZONES.map((zone) => zone.key));
  const supplierCodes = new Set(MARKETPLACE_SUPPLIER_SEEDS.map((supplier) => supplier.code));

  for (const sku of MARKETPLACE_V3_SKU_SEEDS) {
    assert(zoneKeys.has(sku.zone), `${sku.skuCode} zone is valid`);
    assert(supplierCodes.has(sku.supplierCode), `${sku.skuCode} supplier is valid`);
    assert(Number.isInteger(sku.ppu) && sku.ppu >= 0, `${sku.skuCode} ppu is valid`);
    assert(sku.verbs.length > 0, `${sku.skuCode} has verbs`);
    assert(/1\s*次使用|一次使用/.test(sku.useCase), `${sku.skuCode} has outcome anchor`);
  }

  const ipzoneOnly = demoMarketplace.listSkus({ zone: "ipzone" }, false);
  assert(ipzoneOnly.length > 0, "zone filter returns public ipzone skus");
  assert(ipzoneOnly.every((sku) => sku.zone === "ipzone"), "zone filter stays in ipzone");

  const founderIp = demoMarketplace.listSkus({ q: "创始人IP" }, false);
  assert(
    founderIp.some((sku) => sku.skuCode === "ipzone__ip-pos") && founderIp.some((sku) => sku.skuCode === "ipzone__ip-pack"),
    "scenario search finds founder IP skus"
  );

  const trialSkus = demoMarketplace.listSkus({ trial: true }, false);
  assert(trialSkus.every((sku) => sku.trial), "trial filter returns only trial skus");

  const richTenant = "marketplace-rich-tenant";
  const access = demoMarketplace.accessState(richTenant, demoMarketplace.getSku("ipzone__ip-pos")!);
  assert(access.state === "ready", "rich tenant is ready for ppu sku");

  const firstConsume = demoMarketplace.consumePpu(richTenant, "user-1", "ipzone__ip-pos", "ppu-key-1");
  assert(firstConsume.state === "completed", "ppu consume succeeds");
  const secondConsume = demoMarketplace.consumePpu(richTenant, "user-1", "ipzone__ip-pos", "ppu-key-1");
  assert(secondConsume.idempotent === true, "ppu consume is idempotent");

  // 未完成内核在货架上标「开发中」：仍然可见、但不能购买或消耗积分。
  const shelf = demoMarketplace.listSkus({}, false);
  const soonSkus = shelf.filter((sku) => sku.status === "coming_soon");
  const sellingSkus = shelf.filter((sku) => sku.status === "selling").map((sku) => sku.skuCode);
  assert(shelf.length === 19, `public shelf keeps all 19 skus visible (got ${shelf.length})`);
  assert(
    soonSkus.length === 15,
    `15 coming_soon skus stay on the shelf: 7 per 通用 ready zone + 1 品牌专属内核 (got ${soonSkus.length})`
  );
  assert(soonSkus.some((sku) => sku.skuCode === "ipzone__topic"), "coming_soon sku stays visible on the public shelf");
  // 品牌专属内核只在自己的专区上架，不污染通用分区。
  const lanqiSkus = shelf.filter((sku) => sku.zone === "lanqi").map((sku) => sku.skuCode);
  assert(
    lanqiSkus.length === 1 && lanqiSkus[0] === "lanqi__lanqi-brain",
    `兰琪专区只上架 1 个品牌内核 (got ${lanqiSkus.join(", ")})`
  );
  assert(
    !shelf.some((sku) => sku.skuCode.endsWith("__lanqi-brain") && sku.zone !== "lanqi"),
    "兰琪品牌内核不得出现在创始人IP/美业等通用专区"
  );
  assert(
    sellingSkus.length === 4 && sellingSkus.every((code) => code.endsWith("__ip-pos") || code.endsWith("__copy")),
    `only ip-pos and copy are selling (got ${sellingSkus.join(", ")})`
  );

  const topic = demoMarketplace.getSku("ipzone__topic")!;
  const topicAccess = demoMarketplace.accessState(richTenant, topic);
  assert(topicAccess.state === "unavailable", "coming_soon sku is not purchasable even with enough credits");
  const bossBalance = demoMarketplace.getBalance(richTenant);
  const blockedConsume = demoMarketplace.consumePpu(richTenant, "user-1", topic.skuCode, "ppu-soon-1");
  assert(
    blockedConsume.state === "unavailable" || demoMarketplace.getBalance(richTenant) === bossBalance,
    "coming_soon sku never consumes credits through the demo store"
  );

  // 订阅能力已下线：不提供订阅价的 SKU 直接拒绝建单。
  let subscriptionRejected = false;
  try {
    demoMarketplace.createSubscription(richTenant, "user-1", topic.skuCode);
  } catch (error) {
    subscriptionRejected = error instanceof Error && error.message === "marketplace_subscription_not_available";
  }
  assert(subscriptionRejected, "subscription path is closed for skus without subscription pricing");


  const textMatch = matchesMarketplaceQuery(
    {
      name: "IP定位智能体",
      description: "",
      useCase: "一次使用 = 交付 IP 定位草案",
      need: "",
      badge: null,
      verbs: ["定位"],
      tags: ["IP定位"],
      keywords: ["创始人IP"],
      zone: "ipzone"
    },
    { q: "创始人 IP" }
  );
  assert(textMatch, "backend text search matches scenario terms");

  console.log("PASS marketplace-foundation-smoke");
}

main();

import {
  MARKETPLACE_V3_SKU_SEEDS,
  MARKETPLACE_SUPPLIER_SEEDS,
  MARKETPLACE_ZONES,
  MARKETPLACE_INDUSTRIES,
  demoMarketplace,
  matchesMarketplaceQuery,
  refreshMarketplaceSkuSeeds
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
    // 2026-09-15 用户口径：取消「按次使用 / 一次使用」这类计费感表述，useCase 直接讲交付物。
    assert(sku.useCase.trim().length > 0, `${sku.skuCode} has useCase`);
    assert(!/按次使用|一次使用/.test(sku.useCase), `${sku.skuCode} useCase avoids per-use billing wording`);
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
    soonSkus.length === 13,
    `13 coming_soon skus stay on the shelf: 创始人IP专区 6 + 美业专区 6 + 1 品牌专属内核（视频复盘已上架）(got ${soonSkus.length})`
  );
  assert(soonSkus.some((sku) => sku.skuCode === "ipzone__topic"), "coming_soon sku stays visible on the public shelf");
  // 2026-09-15 用户口径：行业专家专区先只建栏，暂不放任何智能体（显式空 skills 白名单）。
  assert(
    MARKETPLACE_ZONES.some((zone) => zone.key === "expert"),
    `行业专家专区必须已在货架专区列表里（got ${MARKETPLACE_ZONES.map((zone) => zone.key).join(", ")}）`
  );
  assert(
    shelf.every((sku) => (sku.zone || "") !== "expert"),
    `行业专家专区当前不得上架任何智能体（got ${shelf.filter((sku) => sku.zone === "expert").map((sku) => sku.skuCode).join(", ")}）`
  );
  // 品牌专属内核只在自己的专区上架，不污染通用分区。
  const lanqiSkus = shelf.filter((sku) => sku.zone === "lanqi").map((sku) => sku.skuCode);
  assert(
    lanqiSkus.length === 1 && lanqiSkus[0] === "lanqi__lanqi-brain",
    `品牌工作台（原兰琪专区）只上架 1 个品牌内核 (got ${lanqiSkus.join(", ")})`
  );
  assert(
    !shelf.some((sku) => sku.skuCode.endsWith("__lanqi-brain") && sku.zone !== "lanqi"),
    "兰琪品牌内核不得出现在创始人IP/美业等通用专区"
  );
  assert(
    sellingSkus.length === 6
      && sellingSkus.filter((code) => code.endsWith("__ip-pos") || code.endsWith("__copy") || code.endsWith("__vidrev")).length === 6,
    `only ip-pos / copy / vidrev (both zones) are selling（视频复盘按 2026-09-13 工单验收后已重新上架）(got ${sellingSkus.join(", ")})`
  );
  // 2026-09-14 用户口径：视频复盘智能体按 2026-09-13 工单改好、验收通过后重新上架。
  assert(
    demoMarketplace.getSku("ipzone__vidrev")!.status === "selling"
      && demoMarketplace.getSku("meiye__vidrev")!.status === "selling"
      && demoMarketplace.getSku("meiye__livescript")!.status === "coming_soon",
    "两个专区的视频复盘都已上架（selling）"
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

  // 开卖状态只认发布文件 `marketplace-v3.json`（QA-20260911-016）。
  //
  // 生产实测的失效链路：`MarketplaceIndustryProfile` 行是首版建行时写入的，
  // `syncMarketplaceIndustryProfiles()` 之后只做 `update: {}`（不覆盖 `ov`），而
  // `loadMarketplaceIndustryProfiles()` 又会用库里的 `ov` 覆盖内存值 —— 于是库里
  // `ov = {}` 时，文件里新加的 `ov.<skill>.status` 被吞掉，发版后线上仍是「开发中」。
  // 这里直接模拟「库里已有空 ov 的 profile 行」，钉住种子状态必须来自文件。
  MARKETPLACE_INDUSTRIES.ipzone.ov = {};
  MARKETPLACE_INDUSTRIES.meiye.ov = {};
  refreshMarketplaceSkuSeeds();
  const seedStatus = (skuCode: string) =>
    MARKETPLACE_V3_SKU_SEEDS.find((sku) => sku.skuCode === skuCode)?.status;
  assert(
    seedStatus("ipzone__vidrev") === "selling" && seedStatus("meiye__vidrev") === "selling",
    `状态必须来自发布文件而不是库里的专区 profile：ipzone__vidrev=${seedStatus("ipzone__vidrev")} / `
      + `meiye__vidrev=${seedStatus("meiye__vidrev")}`
  );
  assert(
    seedStatus("ipzone__livescript") === "coming_soon",
    "文件里没写 status 的内核仍按内核缺省状态展示「开发中」"
  );

  console.log("PASS marketplace-foundation-smoke");
}

main();

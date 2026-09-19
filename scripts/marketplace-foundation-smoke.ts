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

  /**
   * 回归（2026-09-16，WorkBuddy 全链路检测 B1）：数据库里各专区的 `ov`（专区覆盖）可能还留着改口前的
   * 「一次使用 = 交付…」，而 `syncMarketplaceIndustryProfiles()` 只在首次建行时写入、之后不覆盖，
   * 生产美业专区就是这样：9 个 SKU 的详情页被渲染成「一次使用 = 帮你完成：一次使用 = 交付 …」。
   * 这里**主动造出那条脏数据**（模拟 DB 覆盖位），再断言构出来的种子文案是干净的——
   * 这条用例在修复前会红，在修复后必须绿。
   */
  const meiyeOv = MARKETPLACE_INDUSTRIES.meiye?.ov as Record<string, { use?: string }> | undefined;
  const copyOverride = meiyeOv?.copy;
  assert(copyOverride && typeof copyOverride.use === "string", "meiye override for copy exists (test precondition)");
  const cleanUse = copyOverride.use as string;
  copyOverride.use = `一次使用 = ${cleanUse}`;
  refreshMarketplaceSkuSeeds();
  const dirtySku = MARKETPLACE_V3_SKU_SEEDS.find((sku) => sku.skuCode === "meiye__copy");
  assert(dirtySku, "meiye__copy seed exists after refresh");
  assert(
    dirtySku!.useCase === cleanUse,
    `legacy "一次使用 =" prefix from zone override is stripped (got: ${dirtySku!.useCase})`
  );
  assert(!/一次使用/.test(dirtySku!.useCase), "stale zone override never reaches useCase");
  copyOverride.use = cleanUse;
  refreshMarketplaceSkuSeeds();
  assert(
    MARKETPLACE_V3_SKU_SEEDS.find((sku) => sku.skuCode === "meiye__copy")!.useCase === cleanUse,
    "useCase restored to the JSON wording after cleanup"
  );

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
  assert(shelf.length === 28, `public shelf keeps all 28 skus visible (got ${shelf.length})`);
  assert(
    soonSkus.length === 16,
    `16 coming_soon skus stay on the shelf: 创始人IP专区 5 + 美业专区 5 + 餐饮专区 5 + 1 品牌专属内核（视频复盘与直播话术已上架）(got ${soonSkus.length})`
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
    sellingSkus.length === 12
      && sellingSkus.filter((code) => code.endsWith("__ip-pos") || code.endsWith("__copy") || code.endsWith("__vidrev") || code.endsWith("__livescript")).length === 12,
    `only ip-pos / copy / vidrev / livescript (three zones) are selling（视频复盘与直播话术已上架）(got ${sellingSkus.join(", ")})`
  );
  // 2026-09-14 用户口径：视频复盘智能体按 2026-09-13 工单改好、验收通过后重新上架。
  assert(
    demoMarketplace.getSku("ipzone__vidrev")!.status === "selling"
      && demoMarketplace.getSku("meiye__vidrev")!.status === "selling"
      && demoMarketplace.getSku("canyin__vidrev")!.status === "selling"
      && demoMarketplace.getSku("ipzone__livescript")!.status === "selling"
      && demoMarketplace.getSku("meiye__livescript")!.status === "selling"
      && demoMarketplace.getSku("canyin__livescript")!.status === "selling",
    "三个专区的视频复盘与直播话术都已上架（selling）"
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
  MARKETPLACE_INDUSTRIES.canyin.ov = {};
  refreshMarketplaceSkuSeeds();
  const seedStatus = (skuCode: string) =>
    MARKETPLACE_V3_SKU_SEEDS.find((sku) => sku.skuCode === skuCode)?.status;
  assert(
    seedStatus("ipzone__vidrev") === "selling" && seedStatus("meiye__vidrev") === "selling" && seedStatus("canyin__vidrev") === "selling",
    `状态必须来自发布文件而不是库里的专区 profile：ipzone__vidrev=${seedStatus("ipzone__vidrev")} / `
      + `meiye__vidrev=${seedStatus("meiye__vidrev")} / canyin__vidrev=${seedStatus("canyin__vidrev")}`
  );
  assert(
    seedStatus("ipzone__livescript") === "selling" && seedStatus("canyin__livescript") === "selling",
    "直播话术内核缺省状态已是 selling（文件里写 selling 的内核按 selling 展示）"
  );

  console.log("PASS marketplace-foundation-smoke");
}

main();

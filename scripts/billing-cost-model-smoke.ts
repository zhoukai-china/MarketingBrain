// PLAT-37 按真实成本计费的换算契约（离线、无数据库、无 Provider）。
//
// 用户 2026-09-15 拍板：文字 100 倍、视频 2 倍、`max(1, ceil(成本 ÷ 0.05 × 倍数))`、
// 先预留后按实际结算。本 smoke 用**线上真实成本样本**（生产账本近 30 天记录）钉住换算结果，
// 并确认开关默认关闭（关着时线上扣费仍是固定 ppu，不动钱）。
import assert from "node:assert/strict";
import { env } from "../apps/api/src/config/env.js";
import {
  COST_TO_REVENUE_MULTIPLE,
  PARTNER_SHARE_PERCENT,
  UNIT_COST_CNY,
  costBasedBillingEnabled,
  creditsForCostCny,
  FIXED_PRICE_SKUS,
  imageCostCny,
  isCostBasedSku,
  isFixedPriceSku,
  parseCostBasedSkuList,
  reserveCreditsForEstimate,
  speechCostCny,
  splitPartnerShare,
  textCostCny,
  usesCostBasedPricing,
  videoCostCny,
  visionCostCny
} from "../apps/api/src/services/billing-cost-model.js";
import { readFileSync } from "node:fs";
import { MARKETPLACE_V3_SKU_SEEDS } from "../apps/api/src/services/marketplace-catalog.js";

function main(): void {
  // 1) 倍数表 = 用户拍板的数
  assert.equal(COST_TO_REVENUE_MULTIPLE.text, 100, "文字倍数必须是 100（用户 2026-09-15 拍板）");
  assert.equal(COST_TO_REVENUE_MULTIPLE.video, 2, "视频倍数必须是 2（用户 2026-09-15 拍板）");
  assert.equal(COST_TO_REVENUE_MULTIPLE.image, 5, "图片倍数必须是 5（用户 2026-09-15 拍板）");
  assert.equal(COST_TO_REVENUE_MULTIPLE.speech, 10, "语音识别倍数必须是 10（用户 2026-09-15 拍板）");
  assert.equal(COST_TO_REVENUE_MULTIPLE.vision, 25, "视觉倍数必须是 25（用户 2026-09-16：按 ¥0.5/次收费 = ¥0.02 × 25）");

  // 分润结构：比例未拍板前不得臆造分润（splitPartnerShare 返回 null），拍板后只改 PARTNER_SHARE_PERCENT。
  assert.equal(splitPartnerShare(100, "text"), null, "分润比例未配置时不得返回分润金额");
  const savedShare = PARTNER_SHARE_PERCENT.text;
  PARTNER_SHARE_PERCENT.text = 30;
  assert.deepEqual(splitPartnerShare(100, "text"), { partnerCredits: 30, platformCredits: 70 }, "配置 30% 后按扣费拆分");
  PARTNER_SHARE_PERCENT.text = savedShare;
  assert.equal(splitPartnerShare(100, "text"), null, "恢复未配置状态");

  // 2) 线上真实成本样本 → 应得积分（生产 MarketplaceLedgerEntry，2026-08-16~09-15）
  assert.equal(creditsForCostCny(0.0157, "text"), 32, "文案智能体：平均成本 ¥0.0157 → 32 积分（现价 40）");
  assert.equal(creditsForCostCny(0.0177, "text"), 36, "文案智能体：最高成本 ¥0.0177 → 36 积分");
  assert.equal(creditsForCostCny(0.0579, "text"), 116, "IP 定位：平均成本 ¥0.0579 → 116 积分（该换算仍保留，但 SKU 已改为固定 400）");
  assert.equal(creditsForCostCny(0.0304, "text"), 61, "视频复盘：实测成本 ¥0.0304 → 61 积分（现价 60）");
  assert.equal(creditsForCostCny(0.0339, "text"), 68, "视频复盘：实测成本 ¥0.0339 → 68 积分");

  // 3) 地板与取整：不足 1 积分按 1 积分、一律向上取整
  assert.equal(creditsForCostCny(0, "text"), 1, "零成本也要收 1 积分地板");
  assert.equal(creditsForCostCny(0.0000001, "text"), 1, "极小成本落到 1 积分地板");
  assert.equal(creditsForCostCny(0.0036, "text"), 8, "¥0.0036 × 2000 = 7.2 → 向上取整 8");
  assert.equal(creditsForCostCny(0.0035, "text"), 7, "整数边界不能因浮点噪声多收（¥0.0035 → 7）");
  assert.equal(creditsForCostCny(-1, "text"), 1, "负数成本按 0 处理，仍收地板价");

  // 4) 单位成本 → 积分：图片/视频/语音
  assert.equal(imageCostCny(1), UNIT_COST_CNY.imagePerPicture, "单张图片成本必须是价表里的 ¥0.2");
  assert.equal(creditsForCostCny(imageCostCny(1), "image"), 20, "图片 5 倍 → 20 积分/张（与现价一致）");
  assert.equal(creditsForCostCny(imageCostCny(3), "image"), 60, "3 图包 → 60 积分（与现价一致）");
  assert.equal(videoCostCny(5), 1.5, "720P 5 秒成本 ¥1.5（¥0.3/秒）");
  assert.equal(creditsForCostCny(videoCostCny(5), "video"), 60, "视频 2 倍 → 5 秒 60 积分（现价 150）");
  assert.equal(creditsForCostCny(videoCostCny(1), "video"), 12, "视频 2 倍 → 每秒 12 积分（现价 30）");
  // 语音识别：¥0.0005/秒 × 10 倍 → 每次基本落到 1 积分地板（用户 2026-09-15 拍板 10 倍）。
  assert.equal(creditsForCostCny(speechCostCny(8), "speech"), 1, "语音 8 秒（¥0.004 成本）→ 1 积分（10 倍 + 地板）");
  assert.equal(creditsForCostCny(speechCostCny(60), "speech"), 6, "语音 1 分钟（¥0.03 成本）→ 6 积分（10 倍 = 0.1 积分/秒）");
  assert.equal(creditsForCostCny(speechCostCny(600), "speech"), 60, "语音 10 分钟（¥0.3 成本）→ 60 积分（10 倍）");
  // 视觉（关键帧 / 图片 / 扫描件）：用户 2026-09-16「按 0.5 元收费」= ¥0.02 × 25 倍 = ¥0.5 = 10 积分/次。
  assert.equal(visionCostCny(1), UNIT_COST_CNY.visionPerImageCny, "单次视觉成本取自价表");
  assert.equal(creditsForCostCny(visionCostCny(1), "vision"), 10, "视觉 1 次（¥0.02 成本）→ 10 积分（25 倍 = ¥0.5）");
  assert.equal(creditsForCostCny(visionCostCny(8), "vision"), 80, "一次 8 张图（¥0.16 成本）→ 80 积分（25 倍 = ¥4）");
  assert.equal(creditsForCostCny(visionCostCny(1), "vision") / 20, 0.5, "视觉单次对客价必须正好 ¥0.5（1 元 = 20 积分）");

  // 5) 文字 token 成本与 marketplace-cost 同表（¥3/百万 input、¥6/百万 output）
  assert.equal(textCostCny({ promptTokens: 1_000_000, completionTokens: 0 }), 3, "百万 input token = ¥3");
  assert.equal(textCostCny({ promptTokens: 0, completionTokens: 1_000_000 }), 6, "百万 output token = ¥6");
  // 2767 input + 950 output → ¥0.008301 + ¥0.0057 = ¥0.014001 → ×2000 = 28.002 → 向上取整 29 积分。
  assert.equal(creditsForCostCny(textCostCny({ promptTokens: 2767, completionTokens: 950 }), "text"), 29, "真实 token 样例 → 29 积分");

  // 6) 预留口径：预留 ≥ 结算（同一套取整，永远不会把余额扣成负）
  const estimated = reserveCreditsForEstimate(0.02, "text");
  const settled = creditsForCostCny(0.0157, "text");
  assert.ok(estimated >= settled, "预留额度必须 ≥ 实际结算（否则会扣成负余额）");
  assert.equal(estimated, 40, "预留 ¥0.02 → 40 积分");

  // 7) 开关默认关：关着时线上扣费仍是固定 ppu，改造不动钱
  assert.equal(costBasedBillingEnabled(), false, "BILLING_COST_BASED_ENABLED 默认必须是 false");
  assert.equal(env.BILLING_COST_BASED_ENABLED, "false", "env 默认值必须是 false");

  /**
   * 7b) 2026-09-15 起的真实开关：`BILLING_COST_BASED_SKUS` 白名单（用户「先只切有实测成本的三个」）。
   * 默认空 → 一个 SKU 都不切；名单里的才按成本口径扣费。
   */
  assert.deepEqual(parseCostBasedSkuList(undefined), [], "白名单缺省 = 空（全部维持固定价）");
  assert.deepEqual(
    parseCostBasedSkuList(" ipzone__copy , MEIYE__copy ,, ipzone__ip-pos ,ipzone__copy"),
    ["ipzone__copy", "meiye__copy", "ipzone__ip-pos"],
    "白名单解析：去空白、转小写、去重、去空项"
  );
  assert.equal(usesCostBasedPricing("ipzone__copy"), false, "默认没配白名单时不得按成本计费");
  /**
   * 通配 `*`（用户 2026-09-16「每个新增的智能体产生多少成本就按对应倍数收费」）：
   * 配了 `*` 之后**任何** SKU（含以后新增、没进过名单的）都按成本计费，不需要每次改配置。
   */
  assert.equal(isCostBasedSku("brand-new-agent-2027", "*"), true, "通配 * 必须覆盖未来新增的 SKU");
  assert.equal(isCostBasedSku("ipzone__copy", "*"), true, "通配 * 也必须覆盖已有 SKU");
  assert.equal(isCostBasedSku("ipzone__copy", "meiye__copy"), false, "明确列出时只匹配列出的 SKU");
  assert.equal(isCostBasedSku("IPZONE__COPY", "ipzone__copy"), true, "SKU 匹配大小写不敏感");

  // 7c) 接线契约：跑货架 run 时，白名单里的 SKU 必须扣「本次真实用量算出的成本口径积分」，账本要能审计。
  const marketplaceSource = readFileSync(new URL("../apps/api/src/routes/marketplace.ts", import.meta.url), "utf8");
  assert.match(marketplaceSource, /const costBased = usesCostBasedPricing\(sku\.skuCode\)/, "run 路由必须按 SKU 白名单判定是否成本计费");
  assert.match(
    marketplaceSource,
    /const charge = coveredBySubscription \? 0 : costBased \? dynamicCredits : price;/,
    "扣费金额必须是「包月覆盖→0，否则白名单→成本口径，否则固定 ppu」"
  );
  assert.match(marketplaceSource, /price: charge,/, "consumeWalletCredits 必须扣 charge（不能仍扣固定价）");
  assert.match(marketplaceSource, /amountCredits: charge,/, "账本金额必须记 charge");
  assert.match(
    marketplaceSource,
    /pricingMode: coveredBySubscription \? "subscription" : costBased \? "cost_based" : "fixed_ppu"/,
    "账本必须记 pricingMode 以便对账"
  );
  // 2026-09-17：包月覆盖的那一次**不调用钱包**（0 积分不允许也不该扣），余额原样返回。
  // 换行写成 `\r?\n`：本仓 Windows 检出是 CRLF（Linux 发布是 LF），只写 `\n` 会在开发机上假红。
  assert.match(
    marketplaceSource,
    /if \(!coveredBySubscription\) \{\r?\n\s+const consumed = await consumeWalletCredits\(/,
    "包月覆盖时不得调用钱包扣费"
  );

  /**
   * 7d) 视觉计费契约（用户 2026-09-16「没有成本消耗也不对外收费」）：
   * 只按**成功**的视觉调用收费；一次都没成功（纯文字 PDF / 调用失败）必须全额退回、0 收费。
   */
  const mediaSource = readFileSync(new URL("../apps/api/src/routes/media.ts", import.meta.url), "utf8");
  assert.match(
    mediaSource,
    /item\.stage === "visual" && item\.terminalStatus === "succeeded"/,
    "视觉结算必须只统计成功的调用"
  );
  assert.match(mediaSource, /media_no_vision_cost/, "没有成功视觉调用时必须走全额退回");
  assert.doesNotMatch(
    mediaSource,
    /Math\.max\(1, result\.providerTrace/,
    "不得再用 max(1, …) 保底收费（没有成本消耗就不收费）"
  );

  /**
   * 7e) 固定价例外（PLAT-43，2026-09-17 用户拍板）：
   * 「IP 定位改成按次计费、不按消耗量计费」→ 400 积分/次。
   *
   * 生产 `BILLING_COST_BASED_SKUS=*`（全通配），所以这个豁免必须**优先级高于通配**，
   * 否则 ip-pos 会被成本口径覆盖成 116 积分，用户拍板的 400 就静默失效。
   */
  assert.deepEqual([...FIXED_PRICE_SKUS], ["ip-pos"], "固定价例外目前只有 ip-pos");
  assert.equal(isFixedPriceSku("ip-pos"), true, "ip-pos 必须被识别为固定价 SKU");
  assert.equal(isFixedPriceSku("IPZONE__IP-POS"), true, "固定价 SKU 匹配大小写不敏感");
  assert.equal(isFixedPriceSku("meiye__ip-pos"), true, "两个专区的 ip-pos 都要命中（货架码是 专区__核心码）");
  assert.equal(isFixedPriceSku("ipzone__copy"), false, "固定价名单之外的核心码不得命中");
  const savedWhitelist = env.BILLING_COST_BASED_SKUS;
  env.BILLING_COST_BASED_SKUS = "*";
  assert.equal(usesCostBasedPricing("ipzone__ip-pos"), false, "配了通配 * 之后 ip-pos 仍必须走固定价（豁免优先级最高）");
  assert.equal(usesCostBasedPricing("meiye__ip-pos"), false, "美业专区的 ip-pos 同样固定价");
  assert.equal(usesCostBasedPricing("ipzone__copy"), true, "通配 * 下其它 SKU 仍按成本计费（豁免只针对 ip-pos）");
  env.BILLING_COST_BASED_SKUS = savedWhitelist;

  // 固定价 = 400 必须是**三处价格源**一致，任一处漏改都会让线上售价对不上。
  const v3Raw = JSON.parse(readFileSync(new URL("../apps/api/src/data/marketplace-v3.json", import.meta.url), "utf8")) as {
    skills: Record<string, { ppu: number }>;
    industries: Record<string, { ov?: Record<string, { ppu?: number }> }>;
  };
  assert.equal(v3Raw.skills["ip-pos"]?.ppu, 400, "货架发布文件 marketplace-v3.json 的 ip-pos ppu 必须是 400");
  for (const [zoneKey, industry] of Object.entries(v3Raw.industries)) {
    const overridePpu = industry.ov?.["ip-pos"]?.ppu;
    if (typeof overridePpu === "number") {
      assert.equal(overridePpu, 400, `${zoneKey} 专区不得用 ov 覆盖 ip-pos 价格（现为 ${overridePpu}）`);
    }
  }
  const catalogSource = readFileSync(new URL("../apps/api/src/services/marketplace-catalog.ts", import.meta.url), "utf8");
  assert.doesNotMatch(catalogSource, /ppu:\s*200\b/, "marketplace-catalog 里不得再留 ip-pos 的旧价 200");
  const consumeRouteSource = readFileSync(new URL("../apps/api/src/routes/billing-consume.ts", import.meta.url), "utf8");
  assert.match(consumeRouteSource, /"ip-pos": 400/, "/billing/* 的服务端价目表 ip-pos 必须是 400");

  // 货架实际发出去的价：直接看构建后的 SKU 种子，避免只钉注释/文件。
  const ipPosSeeds = MARKETPLACE_V3_SKU_SEEDS.filter((seed) => seed.skuCode.endsWith("__ip-pos"));
  assert.ok(ipPosSeeds.length >= 2, `IP 定位必须同时在多个专区上架（got ${ipPosSeeds.length}）`);
  for (const seed of ipPosSeeds) {
    assert.equal(seed.ppu, 400, `货架 SKU ${seed.skuCode} 的 ppu 必须是 400`);
    assert.equal(isFixedPriceSku(seed.skuCode), true, `货架 SKU ${seed.skuCode} 必须命中固定价名单`);
  }

  console.log(JSON.stringify({
    result: "PLAT37_BILLING_COST_MODEL_PASS",
    multiples: COST_TO_REVENUE_MULTIPLE,
    samples: {
      copyAvgTextCredits: creditsForCostCny(0.0157, "text"),
      copyCurrentPpu: 40,
      ipPosAvgTextCredits: creditsForCostCny(0.0579, "text"),
      ipPosCurrentPpu: 400,
      videoPerSecondCredits: creditsForCostCny(videoCostCny(1), "video"),
      videoCurrentPerSecond: 30,
      imagePerPictureCredits: creditsForCostCny(imageCostCny(1), "image"),
      imageCurrentPerPicture: 20,
      speechPer8sCredits: creditsForCostCny(speechCostCny(8), "speech")
    },
    switch: { costBasedBillingEnabled: costBasedBillingEnabled() },
    providerCalls: 0,
    costYuan: 0
  }));
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}

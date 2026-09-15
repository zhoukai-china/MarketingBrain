// PLAT-37 按真实成本计费的换算契约（离线、无数据库、无 Provider）。
//
// 用户 2026-09-15 拍板：文字 100 倍、视频 2 倍、`max(1, ceil(成本 ÷ 0.05 × 倍数))`、
// 先预留后按实际结算。本 smoke 用**线上真实成本样本**（生产账本近 30 天记录）钉住换算结果，
// 并确认开关默认关闭（关着时线上扣费仍是固定 ppu，不动钱）。
import assert from "node:assert/strict";
import { env } from "../apps/api/src/config/env.js";
import {
  COST_TO_REVENUE_MULTIPLE,
  UNIT_COST_CNY,
  costBasedBillingEnabled,
  creditsForCostCny,
  imageCostCny,
  reserveCreditsForEstimate,
  speechCostCny,
  textCostCny,
  videoCostCny
} from "../apps/api/src/services/billing-cost-model.js";

function main(): void {
  // 1) 倍数表 = 用户拍板的数
  assert.equal(COST_TO_REVENUE_MULTIPLE.text, 100, "文字倍数必须是 100（用户 2026-09-15 拍板）");
  assert.equal(COST_TO_REVENUE_MULTIPLE.video, 2, "视频倍数必须是 2（用户 2026-09-15 拍板）");
  assert.equal(COST_TO_REVENUE_MULTIPLE.image, 5, "图片倍数暂定 5（＝维持 20 积分/张，待老板确认）");
  assert.equal(COST_TO_REVENUE_MULTIPLE.speech, 100, "语音倍数暂定 100（基本落到 1 积分地板）");

  // 2) 线上真实成本样本 → 应得积分（生产 MarketplaceLedgerEntry，2026-08-16~09-15）
  assert.equal(creditsForCostCny(0.0157, "text"), 32, "文案智能体：平均成本 ¥0.0157 → 32 积分（现价 40）");
  assert.equal(creditsForCostCny(0.0177, "text"), 36, "文案智能体：最高成本 ¥0.0177 → 36 积分");
  assert.equal(creditsForCostCny(0.0579, "text"), 116, "IP 定位：平均成本 ¥0.0579 → 116 积分（现价 200）");
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
  // 语音：单价按 ¥0.0005/秒 保守估 → 100 倍 = 1 积分/秒（8 秒一句 = 8 积分 = ¥0.4）。
  // 若老板希望「每次 1 积分」，等价于把语音倍数压到约 12.5×（1 ÷ (0.0005 ÷ 0.05)）；
  // 这一行是待确认项，价表本身只改 UNIT_COST_CNY.speechPerSecond 与倍数表两处。
  assert.equal(creditsForCostCny(speechCostCny(8), "speech"), 8, "语音 8 秒（¥0.004 成本）→ 8 积分（100 倍）");
  assert.equal(creditsForCostCny(speechCostCny(600), "speech"), 600, "语音 10 分钟（¥0.3 成本）→ 600 积分（100 倍）");

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

  console.log(JSON.stringify({
    result: "PLAT37_BILLING_COST_MODEL_PASS",
    multiples: COST_TO_REVENUE_MULTIPLE,
    samples: {
      copyAvgTextCredits: creditsForCostCny(0.0157, "text"),
      copyCurrentPpu: 40,
      ipPosAvgTextCredits: creditsForCostCny(0.0579, "text"),
      ipPosCurrentPpu: 200,
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

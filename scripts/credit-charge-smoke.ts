// PLAT-41「先预留 → 按实际结算 → 差额退回」的确定性回归（真实数据库，0 Provider 调用）。
//
// 用户 2026-09-15：语音识别（ASR）按 10 倍、图片/扫描件视觉解析按 100 倍扣积分；两者都走这条链路。
//
// 覆盖：
//   1. 预留扣钱、结算退差额（只收实际）
//   2. 同一笔预留重复结算幂等（不会重复退款）
//   3. 余额不足 → 抛 InsufficientCreditsForChargeError，且**不产生任何账本行**（调用前拒绝）
//   4. 失败路径 refundAll → 余额回到原点（用户不会被卡住钱）
//   5. 余额永远是 0 以上（不可能扣成负数）
//   6. 视觉 100 倍 / 语音 10 倍的换算与 billing-cost-model 一致
import dotenv from "dotenv";

dotenv.config({ path: "apps/api/.env", quiet: true });
process.env.DATA_MODE = "database";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

async function main(): Promise<void> {
  const { prisma } = await import("../apps/api/node_modules/@baolu/db/dist/index.js");
  const { readWallet } = await import("../apps/api/src/services/sitong-wallet.js");
  const {
    InsufficientCreditsForChargeError,
    refundAllCreditsForCharge,
    reserveCreditsForCharge,
    settleCreditsForCharge
  } = await import("../apps/api/src/services/credit-charge.js");
  const { creditsForCostCny, speechCostCny, visionCostCny } = await import("../apps/api/src/services/billing-cost-model.js");
  const { randomUUID } = await import("node:crypto");

  const userId = `plat41-charge-${randomUUID()}`;
  await prisma.user.create({ data: { id: userId } });
  await prisma.wallet.create({ data: { userId, paidBalance: 60, bonusBalance: 40 } });

  const balance = async () => (await readWallet(userId)).balance;
  const ledgerRows = () => prisma.walletLedger.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });

  try {
    // 6) 换算口径：视觉 25 倍（用户 2026-09-16「按 0.5 元收费」）、语音 10 倍
    assert(creditsForCostCny(visionCostCny(1), "vision") === 10, "视觉一次（¥0.02 × 25 = ¥0.5）应为 10 积分");
    assert(creditsForCostCny(speechCostCny(8), "speech") === 1, "语音 8 秒（10 倍）落 1 积分地板");

    // 1) 预留 10（视觉一次）→ 结算实际 5（按半价成本）→ 只收 5
    const reservation = await reserveCreditsForCharge({
      userId,
      requestId: `t1-${randomUUID()}`,
      capability: "vision",
        estimatedCostCny: visionCostCny(1),
        skillId: "media_analyze"
      });
    assert(reservation.reservedCredits === 10, `预留应为 10 积分（实际 ${reservation.reservedCredits}）`);
    assert((await balance()) === 90, `预留后余额应为 90（实际 ${await balance()}）`);
    const settled = await settleCreditsForCharge({
      reservation,
      userId,
      actualCostCny: visionCostCny(1) / 2,
      skillId: "media_analyze"
    });
    assert(settled.chargedCredits === 5, `实际成本一半 → 应收 5 积分（实际 ${settled.chargedCredits}）`);
    assert(settled.refundedCredits === 5, `应退 5 积分（实际 ${settled.refundedCredits}）`);
    assert((await balance()) === 95, `结算后余额应为 95（实际 ${await balance()}）`);

    // 2) 重复结算幂等
    const settledAgain = await settleCreditsForCharge({
      reservation,
      userId,
      actualCostCny: visionCostCny(1) / 2,
      skillId: "media_analyze"
    });
    assert(settledAgain.refundedCredits === 0, `重复结算不得再退钱（实际 ${settledAgain.refundedCredits}）`);
    assert((await balance()) === 95, "重复结算后余额不变");

    // 4) 失败路径：预留后全额退回
    const before = await balance();
    const failing = await reserveCreditsForCharge({
      userId,
      requestId: `t2-${randomUUID()}`,
      capability: "speech",
      estimatedCostCny: speechCostCny(60),
      skillId: "voice_input"
    });
    assert((await balance()) < before, "预留应先扣掉额度");
    await refundAllCreditsForCharge({ reservation: failing, userId, skillId: "voice_input", reason: "smoke_failure" });
    assert((await balance()) === before, `失败全额退回后余额应回到 ${before}（实际 ${await balance()}）`);

    // 3) 余额不足：调用前拒绝，且不产生账本行
    const rowsBefore = (await ledgerRows()).length;
    let insufficient: unknown = null;
    try {
      await reserveCreditsForCharge({
        userId,
        requestId: `t3-${randomUUID()}`,
        capability: "image",
        estimatedCostCny: 999,
        skillId: "media_analyze"
      });
    } catch (error) {
      insufficient = error;
    }
    assert(insufficient instanceof InsufficientCreditsForChargeError, "余额不足必须抛 InsufficientCreditsForChargeError");
    assert((await ledgerRows()).length === rowsBefore, "余额不足不得产生任何账本行（调用前拒绝）");
    assert((await balance()) === before, "余额不足后余额不变");

    // 5) 余额为 0 也不会扣成负数
    await prisma.wallet.update({ where: { userId }, data: { paidBalance: 0, bonusBalance: 0 } });
    let zeroRejected = false;
    try {
      await reserveCreditsForCharge({ userId, requestId: `t4-${randomUUID()}`, capability: "speech", estimatedCostCny: speechCostCny(8) });
    } catch (error) {
      zeroRejected = error instanceof InsufficientCreditsForChargeError;
    }
    assert(zeroRejected, "零余额必须被拒");
    assert((await balance()) === 0, "零余额不会被扣成负数");

    console.log(JSON.stringify({
      result: "PLAT41_CREDIT_CHARGE_PASS",
      reserveThenSettle: true,
      refundOnSettle: settled.refundedCredits,
      idempotentSettle: true,
      insufficientRejectedBeforeCall: true,
      failedChargeFullyRefunded: true,
      neverNegative: true,
      providerCalls: 0,
      costYuan: 0
    }));
  } finally {
    await prisma.walletLedger.deleteMany({ where: { userId } });
    await prisma.wallet.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});

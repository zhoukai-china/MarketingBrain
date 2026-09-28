/**
 * 钱包扣减顺序验证（算力计费 v1.0，HANDOFF §2.7/§7）：
 * ① 赠送先扣、充值后扣；② 过期赠送不可用；③ 退款按原桶退回。
 * 用一次性测试用户在真实库跑完事务后清理。
 * 运行：pnpm -F @baolu/api exec tsx scripts/wallet-consume-order-verify.ts
 */
import "dotenv/config";
import { prisma } from "@baolu/db";
import { consumeWalletCredits, refundWalletCredits } from "../src/services/sitong-wallet.js";

async function main() {
  const user = await prisma.user.create({ data: { nickname: "wallet-order-verify-临时" } });
  try {
    const wallet = await prisma.wallet.create({
      data: { userId: user.id, paidBalance: 100, bonusBalance: 80 }
    });
    const now = Date.now();
    // 赠送构成：50 未过期 + 30 已过期 → 可用赠送 = 50
    await prisma.walletLedger.create({
      data: { walletId: wallet.id, userId: user.id, delta: 50, bucket: "bonus", type: "bonus", source: "verify_live", expiresAt: new Date(now + 86400e3) }
    });
    await prisma.walletLedger.create({
      data: { walletId: wallet.id, userId: user.id, delta: 30, bucket: "bonus", type: "bonus", source: "verify_expired", expiresAt: new Date(now - 86400e3) }
    });

    const result = await consumeWalletCredits({
      userId: user.id,
      requestId: `verify-${now}`,
      price: 120,
      skillId: "verify"
    });
    if (result.status !== "completed") throw new Error("expected completed");
    const { paid, bonus } = result.spent;
    console.log(`消耗 120 算力 → spent: bonus=${bonus}（先扣赠送）, paid=${paid}（后扣充值）`);
    if (bonus !== 50 || paid !== 70) {
      throw new Error(`扣减顺序错误：期望 bonus=50/paid=70，实际 bonus=${bonus}/paid=${paid}`);
    }

    const refund = await refundWalletCredits({
      userId: user.id,
      requestId: `verify-${now}`,
      breakdown: { paid, bonus },
      source: "verify"
    });
    if (refund.refunded !== 120) throw new Error(`退款金额不符：${refund.refunded}`);
    const snap = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } });
    if (snap.paidBalance !== 100 || snap.bonusBalance !== 80) {
      throw new Error(`退款后余额不符：paid=${snap.paidBalance}/bonus=${snap.bonusBalance}`);
    }
    console.log("✅ 赠送先扣 + 过期赠送排除（30 不可用）+ 原桶退款 全部通过");
  } finally {
    await prisma.walletLedger.deleteMany({ where: { userId: user.id } });
    await prisma.wallet.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error("❌", error instanceof Error ? error.message : error);
  process.exit(1);
});

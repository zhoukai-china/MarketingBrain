-- 推荐奖励 90 天到期（PLAT-28 第②批）：账本行记录到期时间，消费时排除已到期的推荐奖励积分。
ALTER TABLE "WalletLedger" ADD COLUMN "expiresAt" TIMESTAMP(3);


-- CreateEnum
CREATE TYPE "WalletBucket" AS ENUM ('paid', 'bonus');

-- CreateEnum
CREATE TYPE "WalletLedgerType" AS ENUM ('recharge', 'bonus', 'consume', 'refund', 'admin', 'redo');

-- CreateEnum
CREATE TYPE "RechargeOrderStatus" AS ENUM ('created', 'paid', 'failed', 'refunded');

-- CreateTable
CREATE TABLE "Wallet" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "paidBalance" INTEGER NOT NULL DEFAULT 0,
    "bonusBalance" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletLedger" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "bucket" "WalletBucket" NOT NULL,
    "type" "WalletLedgerType" NOT NULL,
    "refOrderId" TEXT,
    "refRequestId" TEXT,
    "skillId" TEXT,
    "viaBundle" TEXT,
    "stepIndex" INTEGER,
    "priceVersion" INTEGER,
    "source" TEXT NOT NULL DEFAULT 'web',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RechargeOrder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planId" TEXT,
    "amountCny" INTEGER NOT NULL,
    "basePts" INTEGER NOT NULL,
    "bonusPts" INTEGER NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'wechat',
    "status" "RechargeOrderStatus" NOT NULL DEFAULT 'created',
    "idempotencyKey" TEXT,
    "priceVersion" INTEGER,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RechargeOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_userId_key" ON "Wallet"("userId");

-- CreateIndex
CREATE INDEX "WalletLedger_userId_createdAt_idx" ON "WalletLedger"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "WalletLedger_walletId_type_createdAt_idx" ON "WalletLedger"("walletId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "WalletLedger_walletId_refRequestId_createdAt_idx" ON "WalletLedger"("walletId", "refRequestId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RechargeOrder_idempotencyKey_key" ON "RechargeOrder"("idempotencyKey");

-- CreateIndex
CREATE INDEX "RechargeOrder_userId_createdAt_idx" ON "RechargeOrder"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "RechargeOrder_status_createdAt_idx" ON "RechargeOrder"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletLedger" ADD CONSTRAINT "WalletLedger_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletLedger" ADD CONSTRAINT "WalletLedger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RechargeOrder" ADD CONSTRAINT "RechargeOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

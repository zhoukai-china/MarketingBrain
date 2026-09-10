-- 思潼AI 智能体超市：四分区货架、SKU 与供应商、统一积分账本、按次积分 + 人民币包月双轨。
CREATE TYPE "MarketplaceSkuStatus" AS ENUM ('selling', 'trial', 'internal', 'coming_soon', 'offline');
CREATE TYPE "MarketplaceSupplierType" AS ENUM ('self_operated', 'third_party');
CREATE TYPE "MarketplaceEntitlementTrack" AS ENUM ('ppu', 'subscription');
CREATE TYPE "MarketplaceEntitlementStatus" AS ENUM ('active', 'expired', 'canceled');
CREATE TYPE "MarketplaceLedgerType" AS ENUM ('topup', 'ppu_consume', 'ppu_refund', 'subscription_charge', 'subscription_refund', 'adjustment');
CREATE TYPE "MarketplaceOrderStatus" AS ENUM ('pending', 'paid', 'canceled', 'expired', 'refunded');

CREATE TABLE "MarketplaceSupplier" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "MarketplaceSupplierType" NOT NULL DEFAULT 'self_operated',
    "settlementRate" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "contactEmail" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketplaceSupplier_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MarketplaceSku" (
    "id" TEXT NOT NULL,
    "skuCode" TEXT NOT NULL,
    "agentId" TEXT,
    "capabilityKey" TEXT,
    "supplierId" TEXT NOT NULL,
    "zone" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "badge" TEXT,
    "description" TEXT NOT NULL,
    "verbs" JSONB NOT NULL,
    "useCase" TEXT NOT NULL,
    "need" TEXT NOT NULL,
    "tags" JSONB NOT NULL,
    "keywords" JSONB NOT NULL,
    "ppu" INTEGER NOT NULL DEFAULT 0,
    "subscriptionPriceCny" INTEGER,
    "subscriptionQuota" TEXT,
    "trial" BOOLEAN NOT NULL DEFAULT false,
    "status" "MarketplaceSkuStatus" NOT NULL DEFAULT 'coming_soon',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketplaceSku_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MarketplaceSkuEntitlement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "track" "MarketplaceEntitlementTrack" NOT NULL,
    "status" "MarketplaceEntitlementStatus" NOT NULL DEFAULT 'active',
    "source" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "orderId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketplaceSkuEntitlement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MarketplaceSubscription" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "skuId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endDate" TIMESTAMP(3) NOT NULL,
    "priceCny" INTEGER NOT NULL,
    "quota" TEXT,
    "providerOrderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketplaceSubscription_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MarketplaceSubscriptionOrder" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "skuId" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "priceCny" INTEGER NOT NULL,
    "status" "MarketplaceOrderStatus" NOT NULL DEFAULT 'pending',
    "provider" TEXT NOT NULL DEFAULT 'wechat_pay',
    "providerOrderId" TEXT,
    "codeUrl" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketplaceSubscriptionOrder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MarketplaceLedgerEntry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "skuId" TEXT,
    "type" "MarketplaceLedgerType" NOT NULL,
    "direction" TEXT NOT NULL,
    "amountCredits" INTEGER NOT NULL DEFAULT 0,
    "amountCny" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "idempotencyKey" TEXT,
    "refType" TEXT,
    "refId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketplaceLedgerEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MarketplaceSupplier_code_key" ON "MarketplaceSupplier"("code");
CREATE INDEX "MarketplaceSupplier_type_status_idx" ON "MarketplaceSupplier"("type", "status");
CREATE UNIQUE INDEX "MarketplaceSku_skuCode_key" ON "MarketplaceSku"("skuCode");
CREATE INDEX "MarketplaceSku_zone_status_sortOrder_idx" ON "MarketplaceSku"("zone", "status", "sortOrder");
CREATE INDEX "MarketplaceSku_supplierId_status_idx" ON "MarketplaceSku"("supplierId", "status");
CREATE INDEX "MarketplaceSku_agentId_status_idx" ON "MarketplaceSku"("agentId", "status");
CREATE UNIQUE INDEX "MarketplaceSkuEntitlement_tenantId_skuId_key" ON "MarketplaceSkuEntitlement"("tenantId", "skuId");
CREATE INDEX "MarketplaceSkuEntitlement_tenantId_status_expiresAt_idx" ON "MarketplaceSkuEntitlement"("tenantId", "status", "expiresAt");
CREATE INDEX "MarketplaceSkuEntitlement_skuId_status_idx" ON "MarketplaceSkuEntitlement"("skuId", "status");
CREATE INDEX "MarketplaceSubscription_tenantId_status_endDate_idx" ON "MarketplaceSubscription"("tenantId", "status", "endDate");
CREATE INDEX "MarketplaceSubscription_skuId_status_endDate_idx" ON "MarketplaceSubscription"("skuId", "status", "endDate");
CREATE INDEX "MarketplaceSubscriptionOrder_tenantId_createdAt_idx" ON "MarketplaceSubscriptionOrder"("tenantId", "createdAt");
CREATE INDEX "MarketplaceSubscriptionOrder_status_createdAt_idx" ON "MarketplaceSubscriptionOrder"("status", "createdAt");
CREATE INDEX "MarketplaceSubscriptionOrder_skuId_createdAt_idx" ON "MarketplaceSubscriptionOrder"("skuId", "createdAt");
CREATE UNIQUE INDEX "MarketplaceLedgerEntry_tenantId_idempotencyKey_key" ON "MarketplaceLedgerEntry"("tenantId", "idempotencyKey");
CREATE INDEX "MarketplaceLedgerEntry_tenantId_createdAt_idx" ON "MarketplaceLedgerEntry"("tenantId", "createdAt");
CREATE INDEX "MarketplaceLedgerEntry_type_createdAt_idx" ON "MarketplaceLedgerEntry"("type", "createdAt");
CREATE INDEX "MarketplaceLedgerEntry_skuId_createdAt_idx" ON "MarketplaceLedgerEntry"("skuId", "createdAt");

ALTER TABLE "MarketplaceSku" ADD CONSTRAINT "MarketplaceSku_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "MarketplaceSupplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MarketplaceSkuEntitlement" ADD CONSTRAINT "MarketplaceSkuEntitlement_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "MarketplaceSku"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MarketplaceSubscription" ADD CONSTRAINT "MarketplaceSubscription_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "MarketplaceSku"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MarketplaceSubscriptionOrder" ADD CONSTRAINT "MarketplaceSubscriptionOrder_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "MarketplaceSku"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MarketplaceLedgerEntry" ADD CONSTRAINT "MarketplaceLedgerEntry_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "MarketplaceSku"("id") ON DELETE SET NULL ON UPDATE CASCADE;

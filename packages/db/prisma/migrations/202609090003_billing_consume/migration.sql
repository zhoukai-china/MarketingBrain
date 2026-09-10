-- CreateTable
CREATE TABLE "BillingConsume" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "accessTokenId" TEXT,
    "requestId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "creditTransactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingConsume_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BillingConsume_accessTokenId_requestId_key" ON "BillingConsume"("accessTokenId", "requestId");

-- CreateIndex
CREATE INDEX "BillingConsume_tenantId_createdAt_idx" ON "BillingConsume"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "BillingConsume_accessTokenId_status_createdAt_idx" ON "BillingConsume"("accessTokenId", "status", "createdAt");

-- AddForeignKey
ALTER TABLE "BillingConsume" ADD CONSTRAINT "BillingConsume_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingConsume" ADD CONSTRAINT "BillingConsume_accessTokenId_fkey" FOREIGN KEY ("accessTokenId") REFERENCES "BillingAccessToken"("id") ON DELETE SET NULL ON UPDATE CASCADE;

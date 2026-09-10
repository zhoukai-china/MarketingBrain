-- CreateTable
CREATE TABLE "BillingAccessToken" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" TEXT,
    "tokenHash" TEXT NOT NULL,
    "tokenPrefix" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "rotatedFromId" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingAccessToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BillingAccessToken_tokenHash_key" ON "BillingAccessToken"("tokenHash");

-- CreateIndex
CREATE INDEX "BillingAccessToken_tenantId_userId_status_idx" ON "BillingAccessToken"("tenantId", "userId", "status");

-- CreateIndex
CREATE INDEX "BillingAccessToken_rotatedFromId_idx" ON "BillingAccessToken"("rotatedFromId");

-- AddForeignKey
ALTER TABLE "BillingAccessToken" ADD CONSTRAINT "BillingAccessToken_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingAccessToken" ADD CONSTRAINT "BillingAccessToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

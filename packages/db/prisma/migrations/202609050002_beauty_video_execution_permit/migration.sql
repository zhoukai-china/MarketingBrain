-- Additive BY50 permit/counters only. Existing job, reservations and customer data are unchanged.
CREATE TABLE "BeautyVideoExecutionPermit" (
 "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "userId" TEXT NOT NULL,
 "storeId" TEXT NOT NULL, "requestKey" TEXT NOT NULL, "scope" JSONB NOT NULL,
 "signature" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'approved',
 "revokedAt" TIMESTAMP(3), "claimedAt" TIMESTAMP(3),
 "submitCount" INTEGER NOT NULL DEFAULT 0, "pollCount" INTEGER NOT NULL DEFAULT 0,
 "storageCount" INTEGER NOT NULL DEFAULT 0, "downloadCount" INTEGER NOT NULL DEFAULT 0,
 "committedCostFen" INTEGER NOT NULL DEFAULT 0, "observedProviderCostFen" INTEGER,
 "lastCode" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "BeautyVideoExecutionPermit_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "BeautyVideoExecutionPermit_nonnegative" CHECK (
   "submitCount" >= 0 AND "pollCount" >= 0 AND "storageCount" >= 0 AND
   "downloadCount" >= 0 AND "committedCostFen" >= 0
 )
);
CREATE UNIQUE INDEX "BeautyVideoExecutionPermit_tenantId_userId_requestKey_key"
 ON "BeautyVideoExecutionPermit"("tenantId","userId","requestKey");
CREATE INDEX "BeautyVideoExecutionPermit_tenantId_storeId_status_idx"
 ON "BeautyVideoExecutionPermit"("tenantId","storeId","status");

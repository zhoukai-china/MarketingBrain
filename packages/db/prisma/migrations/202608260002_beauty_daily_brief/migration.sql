ALTER TYPE "AutomationTaskType" ADD VALUE 'beauty_daily_brief';

CREATE TABLE "BeautyDailyBriefSnapshot" (
    "id" TEXT NOT NULL,
    "productCode" TEXT NOT NULL,
    "businessDate" TEXT NOT NULL,
    "contractVersion" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "automationTaskId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "phase" TEXT NOT NULL DEFAULT 'queued',
    "trigger" TEXT NOT NULL,
    "sourceWindowHours" INTEGER,
    "sourceCount" INTEGER NOT NULL DEFAULT 0,
    "report" JSONB,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "lastSuccessfulAt" TIMESTAMP(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "manualRetryCount" INTEGER NOT NULL DEFAULT 0,
    "lockedBy" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "providerCallCount" INTEGER NOT NULL DEFAULT 0,
    "networkRequestCount" INTEGER NOT NULL DEFAULT 0,
    "providerCostYuan" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BeautyDailyBriefSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BeautyDailyBriefSnapshot_automationTaskId_key" ON "BeautyDailyBriefSnapshot"("automationTaskId");
CREATE UNIQUE INDEX "BeautyDailyBriefSnapshot_productCode_businessDate_contractVersion_key" ON "BeautyDailyBriefSnapshot"("productCode", "businessDate", "contractVersion");
CREATE INDEX "BeautyDailyBriefSnapshot_status_leaseExpiresAt_idx" ON "BeautyDailyBriefSnapshot"("status", "leaseExpiresAt");
CREATE INDEX "BeautyDailyBriefSnapshot_businessDate_status_idx" ON "BeautyDailyBriefSnapshot"("businessDate", "status");
CREATE INDEX "BeautyDailyBriefSnapshot_tenantId_createdAt_idx" ON "BeautyDailyBriefSnapshot"("tenantId", "createdAt");

ALTER TABLE "BeautyDailyBriefSnapshot" ADD CONSTRAINT "BeautyDailyBriefSnapshot_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BeautyDailyBriefSnapshot" ADD CONSTRAINT "BeautyDailyBriefSnapshot_automationTaskId_fkey" FOREIGN KEY ("automationTaskId") REFERENCES "AutomationTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

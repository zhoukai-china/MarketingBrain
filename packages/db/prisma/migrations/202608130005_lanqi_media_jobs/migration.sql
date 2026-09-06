CREATE TABLE "LanqiMediaJob" (
  "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "userId" TEXT, "requestKey" TEXT NOT NULL, "kind" TEXT NOT NULL, "model" TEXT NOT NULL, "prompt" TEXT NOT NULL, "imageUrl" TEXT, "resolution" TEXT, "ratio" TEXT, "durationSeconds" INTEGER, "creditCost" INTEGER NOT NULL, "status" TEXT NOT NULL DEFAULT 'queued', "billingStatus" TEXT NOT NULL DEFAULT 'reserved', "providerTaskId" TEXT, "providerStatus" TEXT, "outputUrl" TEXT, "errorMessage" TEXT, "completedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LanqiMediaJob_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LanqiMediaJob_tenantId_requestKey_key" ON "LanqiMediaJob"("tenantId", "requestKey");
CREATE UNIQUE INDEX "LanqiMediaJob_providerTaskId_key" ON "LanqiMediaJob"("providerTaskId");
CREATE INDEX "LanqiMediaJob_tenantId_createdAt_idx" ON "LanqiMediaJob"("tenantId", "createdAt");
ALTER TABLE "LanqiMediaJob" ADD CONSTRAINT "LanqiMediaJob_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

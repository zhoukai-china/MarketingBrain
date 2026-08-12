CREATE TABLE "ViralVideoReplicationJob" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "requestKey" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "referenceVideoUrl" TEXT,
    "portraitImageUrl" TEXT,
    "referenceFileId" TEXT,
    "portraitFileId" TEXT,
    "authorizationSnapshot" JSONB NOT NULL,
    "creditCost" INTEGER NOT NULL,
    "billingStatus" TEXT NOT NULL DEFAULT 'reserved',
    "providerTaskId" TEXT,
    "providerStatus" TEXT,
    "outputVideoUrl" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ViralVideoReplicationJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ViralVideoReplicationJob_providerTaskId_key" ON "ViralVideoReplicationJob"("providerTaskId");
CREATE UNIQUE INDEX "ViralVideoReplicationJob_tenantId_requestKey_key" ON "ViralVideoReplicationJob"("tenantId", "requestKey");
CREATE INDEX "ViralVideoReplicationJob_tenantId_createdAt_idx" ON "ViralVideoReplicationJob"("tenantId", "createdAt");
CREATE INDEX "ViralVideoReplicationJob_status_createdAt_idx" ON "ViralVideoReplicationJob"("status", "createdAt");
ALTER TABLE "ViralVideoReplicationJob" ADD CONSTRAINT "ViralVideoReplicationJob_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "KnowledgeSyncJob" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "requestedByUserId" TEXT,
    "subjectId" TEXT,
    "clientRequestId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "stage" TEXT NOT NULL DEFAULT 'queued',
    "retryable" BOOLEAN NOT NULL DEFAULT false,
    "scanned" INTEGER NOT NULL DEFAULT 0,
    "processed" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER,
    "createdCount" INTEGER NOT NULL DEFAULT 0,
    "updatedCount" INTEGER NOT NULL DEFAULT 0,
    "unchangedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "assignedCount" INTEGER NOT NULL DEFAULT 0,
    "listRequests" INTEGER NOT NULL DEFAULT 0,
    "detailRequests" INTEGER NOT NULL DEFAULT 0,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "throttleMs" INTEGER NOT NULL DEFAULT 0,
    "backoffMs" INTEGER NOT NULL DEFAULT 0,
    "phaseDurations" JSONB,
    "importedByType" JSONB,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "heartbeatAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "lastSuccessfulAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "KnowledgeSyncJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "KnowledgeSyncJob_tenantId_connectionId_createdAt_idx" ON "KnowledgeSyncJob"("tenantId", "connectionId", "createdAt");
CREATE INDEX "KnowledgeSyncJob_status_heartbeatAt_idx" ON "KnowledgeSyncJob"("status", "heartbeatAt");
CREATE UNIQUE INDEX "KnowledgeSyncJob_one_active_per_connection" ON "KnowledgeSyncJob"("tenantId", "connectionId") WHERE "status" IN ('queued', 'running');

ALTER TABLE "KnowledgeSyncJob" ADD CONSTRAINT "KnowledgeSyncJob_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeSyncJob" ADD CONSTRAINT "KnowledgeSyncJob_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "KnowledgeConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

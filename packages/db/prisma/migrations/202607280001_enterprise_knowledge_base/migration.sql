-- Enterprise knowledge base: provider connections, normalized knowledge,
-- independent intelligent-agent analyses and one consolidated report.
CREATE TABLE "KnowledgeConnection" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "ownerUserId" TEXT,
  "provider" TEXT NOT NULL,
  "ownership" TEXT NOT NULL DEFAULT 'tenant',
  "label" TEXT NOT NULL,
  "encryptedCredentials" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "capabilities" JSONB,
  "syncCursor" TEXT,
  "lastSyncedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KnowledgeConnection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KnowledgeDocument" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "externalId" TEXT NOT NULL,
  "documentType" TEXT NOT NULL DEFAULT 'transcript',
  "sourceClass" TEXT NOT NULL DEFAULT 'first_party',
  "title" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3),
  "externalUpdatedAt" TIMESTAMP(3),
  "tags" JSONB,
  "metadata" JSONB,
  "contentHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KnowledgeDocument_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KnowledgeAnalysisBatch" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "instruction" TEXT,
  "documentIds" JSONB NOT NULL,
  "agentIds" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'running',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "KnowledgeAnalysisBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KnowledgeAgentAnalysis" (
  "id" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "agentName" TEXT NOT NULL,
  "skillId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'running',
  "output" TEXT,
  "creditCost" INTEGER NOT NULL DEFAULT 0,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KnowledgeAgentAnalysis_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KnowledgeSynthesisReport" (
  "id" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'running',
  "content" TEXT,
  "creditCost" INTEGER NOT NULL DEFAULT 0,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KnowledgeSynthesisReport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "KnowledgeConnection_tenantId_provider_ownership_key" ON "KnowledgeConnection"("tenantId", "provider", "ownership");
CREATE INDEX "KnowledgeConnection_tenantId_status_idx" ON "KnowledgeConnection"("tenantId", "status");
CREATE UNIQUE INDEX "KnowledgeDocument_connectionId_externalId_key" ON "KnowledgeDocument"("connectionId", "externalId");
CREATE INDEX "KnowledgeDocument_tenantId_occurredAt_idx" ON "KnowledgeDocument"("tenantId", "occurredAt");
CREATE INDEX "KnowledgeDocument_tenantId_sourceClass_idx" ON "KnowledgeDocument"("tenantId", "sourceClass");
CREATE INDEX "KnowledgeAnalysisBatch_tenantId_createdAt_idx" ON "KnowledgeAnalysisBatch"("tenantId", "createdAt");
CREATE UNIQUE INDEX "KnowledgeAgentAnalysis_batchId_agentId_key" ON "KnowledgeAgentAnalysis"("batchId", "agentId");
CREATE INDEX "KnowledgeAgentAnalysis_batchId_status_idx" ON "KnowledgeAgentAnalysis"("batchId", "status");
CREATE UNIQUE INDEX "KnowledgeSynthesisReport_batchId_key" ON "KnowledgeSynthesisReport"("batchId");

ALTER TABLE "KnowledgeConnection" ADD CONSTRAINT "KnowledgeConnection_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeConnection" ADD CONSTRAINT "KnowledgeConnection_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "KnowledgeDocument" ADD CONSTRAINT "KnowledgeDocument_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeDocument" ADD CONSTRAINT "KnowledgeDocument_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "KnowledgeConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeAnalysisBatch" ADD CONSTRAINT "KnowledgeAnalysisBatch_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeAnalysisBatch" ADD CONSTRAINT "KnowledgeAnalysisBatch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "KnowledgeAgentAnalysis" ADD CONSTRAINT "KnowledgeAgentAnalysis_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "KnowledgeAnalysisBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeSynthesisReport" ADD CONSTRAINT "KnowledgeSynthesisReport_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "KnowledgeAnalysisBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

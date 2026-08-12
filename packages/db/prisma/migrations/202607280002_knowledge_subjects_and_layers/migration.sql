ALTER TABLE "KnowledgeDocument"
  ADD COLUMN "knowledgeLayer" TEXT NOT NULL DEFAULT 'raw_private',
  ADD COLUMN "usagePolicy" TEXT NOT NULL DEFAULT 'recommend',
  ADD COLUMN "sensitivity" TEXT NOT NULL DEFAULT 'normal',
  ADD COLUMN "confirmedAt" TIMESTAMP(3),
  ADD COLUMN "industry" TEXT;

CREATE TABLE "KnowledgeSubject" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "subjectType" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "industry" TEXT,
  "goals" JSONB,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "status" TEXT NOT NULL DEFAULT 'active',
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KnowledgeSubject_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KnowledgeDocumentSubject" (
  "id" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "subjectId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "KnowledgeDocumentSubject_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "KnowledgeSubject_tenantId_subjectType_name_key" ON "KnowledgeSubject"("tenantId", "subjectType", "name");
CREATE INDEX "KnowledgeSubject_tenantId_status_idx" ON "KnowledgeSubject"("tenantId", "status");
CREATE INDEX "KnowledgeSubject_tenantId_isDefault_idx" ON "KnowledgeSubject"("tenantId", "isDefault");
CREATE UNIQUE INDEX "KnowledgeDocumentSubject_documentId_subjectId_key" ON "KnowledgeDocumentSubject"("documentId", "subjectId");
CREATE INDEX "KnowledgeDocumentSubject_subjectId_documentId_idx" ON "KnowledgeDocumentSubject"("subjectId", "documentId");
CREATE INDEX "KnowledgeDocument_tenantId_usagePolicy_confirmedAt_idx" ON "KnowledgeDocument"("tenantId", "usagePolicy", "confirmedAt");
CREATE INDEX "KnowledgeDocument_tenantId_knowledgeLayer_idx" ON "KnowledgeDocument"("tenantId", "knowledgeLayer");

ALTER TABLE "KnowledgeSubject" ADD CONSTRAINT "KnowledgeSubject_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeDocumentSubject" ADD CONSTRAINT "KnowledgeDocumentSubject_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "KnowledgeDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeDocumentSubject" ADD CONSTRAINT "KnowledgeDocumentSubject_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "KnowledgeSubject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

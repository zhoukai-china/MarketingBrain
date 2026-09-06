CREATE TABLE "LanqiContentDraft" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "userId" TEXT,
  "platform" TEXT NOT NULL,
  "goal" TEXT NOT NULL,
  "audience" TEXT NOT NULL,
  "topic" TEXT NOT NULL,
  "storeFacts" JSONB NOT NULL,
  "copyDraft" JSONB NOT NULL,
  "imagePrompt" TEXT NOT NULL,
  "videoPrompt" TEXT NOT NULL,
  "sourceMode" TEXT NOT NULL DEFAULT 'store_facts_only',
  "status" TEXT NOT NULL DEFAULT 'draft',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LanqiContentDraft_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "LanqiContentDraft" ADD CONSTRAINT "LanqiContentDraft_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "LanqiContentDraft_tenantId_createdAt_idx" ON "LanqiContentDraft"("tenantId", "createdAt");

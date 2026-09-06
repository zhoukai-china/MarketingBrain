ALTER TABLE "LanqiMediaJob"
  ADD COLUMN "previewId" TEXT,
  ADD COLUMN "negativePrompt" TEXT,
  ADD COLUMN "parameters" JSONB,
  ADD COLUMN "assetStatus" TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN "selectedAt" TIMESTAMP(3),
  ADD COLUMN "savedAt" TIMESTAMP(3),
  ADD COLUMN "canceledAt" TIMESTAMP(3);

CREATE INDEX "LanqiMediaJob_tenantId_previewId_createdAt_idx"
  ON "LanqiMediaJob"("tenantId", "previewId", "createdAt");

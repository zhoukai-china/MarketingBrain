CREATE TABLE "DiagnosisReport" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "conversationId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'initial',
    "baselineReportId" TEXT,
    "summary" TEXT NOT NULL,
    "report" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DiagnosisReport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DiagnosisReport_tenantId_createdAt_idx" ON "DiagnosisReport"("tenantId", "createdAt");
CREATE INDEX "DiagnosisReport_tenantId_source_createdAt_idx" ON "DiagnosisReport"("tenantId", "source", "createdAt");
CREATE INDEX "DiagnosisReport_conversationId_idx" ON "DiagnosisReport"("conversationId");

ALTER TABLE "DiagnosisReport" ADD CONSTRAINT "DiagnosisReport_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DiagnosisReport" ADD CONSTRAINT "DiagnosisReport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "TakeawayDataImport" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "filename" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "sourceKind" TEXT NOT NULL,
    "platform" TEXT,
    "storeName" TEXT,
    "dateFrom" TIMESTAMP(3),
    "dateTo" TIMESTAMP(3),
    "rowCount" INTEGER NOT NULL,
    "duplicateCount" INTEGER NOT NULL DEFAULT 0,
    "qualityScore" INTEGER NOT NULL,
    "fieldMappings" JSONB NOT NULL,
    "missingFields" JSONB NOT NULL,
    "warnings" JSONB NOT NULL,
    "normalizedRows" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TakeawayDataImport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TakeawayDataImport_tenantId_sha256_key" ON "TakeawayDataImport"("tenantId", "sha256");
CREATE INDEX "TakeawayDataImport_tenantId_createdAt_idx" ON "TakeawayDataImport"("tenantId", "createdAt");
CREATE INDEX "TakeawayDataImport_tenantId_storeName_platform_idx" ON "TakeawayDataImport"("tenantId", "storeName", "platform");

ALTER TABLE "TakeawayDataImport"
ADD CONSTRAINT "TakeawayDataImport_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

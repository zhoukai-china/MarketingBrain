CREATE TABLE "LanqiStoreProfile" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "confirmedFacts" JSONB NOT NULL DEFAULT '{}',
  "estimatedFacts" JSONB NOT NULL DEFAULT '{}',
  "needsInput" JSONB NOT NULL DEFAULT '[]',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LanqiStoreProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LanqiStoreProfile_tenantId_key" ON "LanqiStoreProfile"("tenantId");
ALTER TABLE "LanqiStoreProfile"
  ADD CONSTRAINT "LanqiStoreProfile_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InviteCode" ADD COLUMN "productCode" TEXT;

CREATE INDEX "InviteCode_productCode_idx" ON "InviteCode"("productCode");

CREATE TABLE "TenantProductEntitlement" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "productCode" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "source" TEXT NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TenantProductEntitlement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TenantProductEntitlement_tenantId_productCode_key" ON "TenantProductEntitlement"("tenantId", "productCode");
CREATE INDEX "TenantProductEntitlement_productCode_status_expiresAt_idx" ON "TenantProductEntitlement"("productCode", "status", "expiresAt");
ALTER TABLE "TenantProductEntitlement" ADD CONSTRAINT "TenantProductEntitlement_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "TenantProductEntitlement" ("id", "tenantId", "productCode", "status", "source", "startsAt", "expiresAt", "createdAt", "updatedAt")
SELECT 'migrated-founder-' || "tenantId", "tenantId", 'founder-ip', 'active', 'migration_agent_entitlement', "startsAt", "expiresAt", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "TenantAgentEntitlement" WHERE "agentId" = 'agent_acquisition' AND "status" = 'active'
ON CONFLICT ("tenantId", "productCode") DO NOTHING;

INSERT INTO "TenantProductEntitlement" ("id", "tenantId", "productCode", "status", "source", "startsAt", "expiresAt", "createdAt", "updatedAt")
SELECT 'migrated-takeaway-' || "tenantId", "tenantId", 'takeaway', 'active', 'migration_agent_entitlement', "startsAt", "expiresAt", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "TenantAgentEntitlement" WHERE "agentId" = 'agent_takeaway_growth' AND "status" = 'active'
ON CONFLICT ("tenantId", "productCode") DO NOTHING;

WITH "lanqiTenants" AS (
  SELECT "ownerTenantId" AS "tenantId" FROM "LanqiKnowledgeVersion"
  UNION SELECT "tenantId" FROM "LanqiStoreProfile"
  UNION SELECT "tenantId" FROM "LanqiContentDraft"
  UNION SELECT "tenantId" FROM "LanqiMediaJob"
  UNION SELECT "inviterTenantId" FROM "LanqiReferral"
  UNION SELECT "referredTenantId" FROM "LanqiReferral" WHERE "referredTenantId" IS NOT NULL
)
INSERT INTO "TenantProductEntitlement" ("id", "tenantId", "productCode", "status", "source", "startsAt", "createdAt", "updatedAt")
SELECT 'migrated-lanqi-' || "tenantId", "tenantId", 'lanqi', 'active', 'migration_lanqi_existing_data', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "lanqiTenants"
ON CONFLICT ("tenantId", "productCode") DO NOTHING;

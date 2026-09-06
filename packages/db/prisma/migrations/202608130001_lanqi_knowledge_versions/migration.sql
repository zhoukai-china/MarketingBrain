CREATE TYPE "LanqiKnowledgeTier" AS ENUM (
  'k1_authorized_core',
  'k2_headquarters_private',
  'k3_store_private',
  'k4_session_temporary'
);

CREATE TYPE "LanqiKnowledgeStatus" AS ENUM ('draft', 'active', 'retired');

CREATE TABLE "LanqiKnowledgeVersion" (
  "id" TEXT NOT NULL,
  "knowledgeId" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "ownerTenantId" TEXT NOT NULL,
  "tier" "LanqiKnowledgeTier" NOT NULL,
  "status" "LanqiKnowledgeStatus" NOT NULL DEFAULT 'draft',
  "title" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "sourceRef" TEXT,
  "reviewer" TEXT,
  "approvedAt" TIMESTAMP(3),
  "effectiveFrom" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "allowedTenantIds" JSONB,
  "allowedTenantTypes" JSONB,
  "allowedRoles" JSONB,
  "applicability" JSONB,
  "sessionId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LanqiKnowledgeVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LanqiKnowledgeVersion_knowledgeId_version_key" ON "LanqiKnowledgeVersion"("knowledgeId", "version");
CREATE INDEX "LanqiKnowledgeVersion_ownerTenantId_tier_status_idx" ON "LanqiKnowledgeVersion"("ownerTenantId", "tier", "status");
CREATE INDEX "LanqiKnowledgeVersion_knowledgeId_status_idx" ON "LanqiKnowledgeVersion"("knowledgeId", "status");

ALTER TABLE "LanqiKnowledgeVersion"
  ADD CONSTRAINT "LanqiKnowledgeVersion_ownerTenantId_fkey"
  FOREIGN KEY ("ownerTenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

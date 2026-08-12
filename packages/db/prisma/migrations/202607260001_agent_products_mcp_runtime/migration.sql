-- Agent products, entitlements, offers and versioned Skill bindings.
ALTER TYPE "BillingOrderType" ADD VALUE IF NOT EXISTS 'agent_offer';

CREATE TYPE "AgentStatus" AS ENUM ('draft', 'active', 'coming_soon', 'archived');
CREATE TYPE "AgentEntitlementStatus" AS ENUM ('active', 'paused', 'expired', 'revoked');
CREATE TYPE "AgentOfferStatus" AS ENUM ('draft', 'active', 'archived');
CREATE TYPE "SkillReleaseStatus" AS ENUM ('draft', 'active', 'retired');
CREATE TYPE "AnonymousTrialStatus" AS ENUM ('available', 'used', 'claimed');

ALTER TABLE "TenantProfile"
  ADD COLUMN "confirmedData" JSONB,
  ADD COLUMN "inferredData" JSONB;

UPDATE "TenantProfile"
SET "confirmedData" = "data"
WHERE "confirmedData" IS NULL;

ALTER TABLE "Conversation" ADD COLUMN "agentId" TEXT;

ALTER TABLE "AgentRun"
  ADD COLUMN "agentId" TEXT,
  ADD COLUMN "capabilityId" TEXT,
  ADD COLUMN "requestId" TEXT,
  ADD COLUMN "mcpCallId" TEXT,
  ADD COLUMN "routingSource" TEXT;

ALTER TABLE "BillingOrder" ADD COLUMN "offerId" TEXT;

CREATE TABLE "AgentDefinition" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "icon" TEXT,
  "status" "AgentStatus" NOT NULL DEFAULT 'draft',
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "marketing" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AgentDefinition_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SkillRelease" (
  "id" TEXT NOT NULL,
  "skillId" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "fileHash" TEXT NOT NULL,
  "status" "SkillReleaseStatus" NOT NULL DEFAULT 'draft',
  "rollbackVersion" TEXT,
  "packageSnapshot" JSONB,
  "publishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SkillRelease_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgentSkillBinding" (
  "id" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "skillReleaseId" TEXT NOT NULL,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "routingHints" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AgentSkillBinding_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgentCapability" (
  "id" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "subtitle" TEXT NOT NULL,
  "promptTemplate" TEXT,
  "skillReleaseId" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AgentCapability_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TenantAgentEntitlement" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "status" "AgentEntitlementStatus" NOT NULL DEFAULT 'active',
  "source" TEXT NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3),
  "orderId" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TenantAgentEntitlement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MemberAgentAccess" (
  "id" TEXT NOT NULL,
  "membershipId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MemberAgentAccess_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgentOffer" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "status" "AgentOfferStatus" NOT NULL DEFAULT 'draft',
  "amountCny" INTEGER NOT NULL,
  "credits" INTEGER NOT NULL DEFAULT 0,
  "durationDays" INTEGER,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AgentOffer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgentOfferAgent" (
  "offerId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  CONSTRAINT "AgentOfferAgent_pkey" PRIMARY KEY ("offerId", "agentId")
);

CREATE TABLE "AnonymousTrial" (
  "id" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "tenantId" TEXT,
  "userId" TEXT,
  "status" "AnonymousTrialStatus" NOT NULL DEFAULT 'available',
  "deviceHash" TEXT,
  "ipHash" TEXT,
  "input" TEXT,
  "output" TEXT,
  "skillId" TEXT,
  "skillVersion" TEXT,
  "usedAt" TIMESTAMP(3),
  "claimedAt" TIMESTAMP(3),
  "conversationId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AnonymousTrial_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgentDefinition_slug_key" ON "AgentDefinition"("slug");
CREATE UNIQUE INDEX "SkillRelease_skillId_version_key" ON "SkillRelease"("skillId", "version");
CREATE INDEX "SkillRelease_skillId_status_idx" ON "SkillRelease"("skillId", "status");
CREATE UNIQUE INDEX "AgentSkillBinding_agentId_skillReleaseId_key" ON "AgentSkillBinding"("agentId", "skillReleaseId");
CREATE INDEX "AgentSkillBinding_agentId_isDefault_idx" ON "AgentSkillBinding"("agentId", "isDefault");
CREATE UNIQUE INDEX "AgentCapability_agentId_key_key" ON "AgentCapability"("agentId", "key");
CREATE INDEX "AgentCapability_agentId_sortOrder_idx" ON "AgentCapability"("agentId", "sortOrder");
CREATE UNIQUE INDEX "TenantAgentEntitlement_tenantId_agentId_key" ON "TenantAgentEntitlement"("tenantId", "agentId");
CREATE INDEX "TenantAgentEntitlement_tenantId_status_idx" ON "TenantAgentEntitlement"("tenantId", "status");
CREATE INDEX "TenantAgentEntitlement_agentId_status_idx" ON "TenantAgentEntitlement"("agentId", "status");
CREATE UNIQUE INDEX "MemberAgentAccess_membershipId_agentId_key" ON "MemberAgentAccess"("membershipId", "agentId");
CREATE INDEX "MemberAgentAccess_agentId_idx" ON "MemberAgentAccess"("agentId");
CREATE UNIQUE INDEX "AgentOffer_code_key" ON "AgentOffer"("code");
CREATE INDEX "AgentOfferAgent_agentId_idx" ON "AgentOfferAgent"("agentId");
CREATE UNIQUE INDEX "AnonymousTrial_tokenHash_key" ON "AnonymousTrial"("tokenHash");
CREATE INDEX "AnonymousTrial_agentId_status_idx" ON "AnonymousTrial"("agentId", "status");
CREATE INDEX "AnonymousTrial_deviceHash_createdAt_idx" ON "AnonymousTrial"("deviceHash", "createdAt");
CREATE INDEX "AnonymousTrial_ipHash_createdAt_idx" ON "AnonymousTrial"("ipHash", "createdAt");
CREATE UNIQUE INDEX "AgentRun_requestId_key" ON "AgentRun"("requestId");
CREATE UNIQUE INDEX "AgentRun_mcpCallId_key" ON "AgentRun"("mcpCallId");
CREATE INDEX "AgentRun_agentId_createdAt_idx" ON "AgentRun"("agentId", "createdAt");
CREATE INDEX "Conversation_tenantId_agentId_updatedAt_idx" ON "Conversation"("tenantId", "agentId", "updatedAt");
CREATE INDEX "BillingOrder_offerId_idx" ON "BillingOrder"("offerId");

ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "AgentDefinition"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "AgentDefinition"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BillingOrder" ADD CONSTRAINT "BillingOrder_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "AgentOffer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AgentSkillBinding" ADD CONSTRAINT "AgentSkillBinding_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "AgentDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentSkillBinding" ADD CONSTRAINT "AgentSkillBinding_skillReleaseId_fkey" FOREIGN KEY ("skillReleaseId") REFERENCES "SkillRelease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AgentCapability" ADD CONSTRAINT "AgentCapability_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "AgentDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentCapability" ADD CONSTRAINT "AgentCapability_skillReleaseId_fkey" FOREIGN KEY ("skillReleaseId") REFERENCES "SkillRelease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TenantAgentEntitlement" ADD CONSTRAINT "TenantAgentEntitlement_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TenantAgentEntitlement" ADD CONSTRAINT "TenantAgentEntitlement_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "AgentDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TenantAgentEntitlement" ADD CONSTRAINT "TenantAgentEntitlement_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "BillingOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MemberAgentAccess" ADD CONSTRAINT "MemberAgentAccess_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MemberAgentAccess" ADD CONSTRAINT "MemberAgentAccess_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "AgentDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentOfferAgent" ADD CONSTRAINT "AgentOfferAgent_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "AgentOffer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentOfferAgent" ADD CONSTRAINT "AgentOfferAgent_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "AgentDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AnonymousTrial" ADD CONSTRAINT "AnonymousTrial_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "AgentDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AnonymousTrial" ADD CONSTRAINT "AnonymousTrial_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AnonymousTrial" ADD CONSTRAINT "AnonymousTrial_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

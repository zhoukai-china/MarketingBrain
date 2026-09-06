CREATE TYPE "LanqiReferralStatus" AS ENUM ('pending', 'claimed', 'revoked');

CREATE TABLE "LanqiReferral" (
  "id" TEXT NOT NULL,
  "inviterTenantId" TEXT NOT NULL,
  "inviteCodeId" TEXT NOT NULL,
  "referredTenantId" TEXT,
  "status" "LanqiReferralStatus" NOT NULL DEFAULT 'pending',
  "label" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "claimedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LanqiReferral_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LanqiReferral_inviteCodeId_key" ON "LanqiReferral"("inviteCodeId");
CREATE UNIQUE INDEX "LanqiReferral_referredTenantId_key" ON "LanqiReferral"("referredTenantId");
CREATE INDEX "LanqiReferral_inviterTenantId_status_createdAt_idx" ON "LanqiReferral"("inviterTenantId", "status", "createdAt");

ALTER TABLE "LanqiReferral" ADD CONSTRAINT "LanqiReferral_inviterTenantId_fkey"
  FOREIGN KEY ("inviterTenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LanqiReferral" ADD CONSTRAINT "LanqiReferral_inviteCodeId_fkey"
  FOREIGN KEY ("inviteCodeId") REFERENCES "InviteCode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LanqiReferral" ADD CONSTRAINT "LanqiReferral_referredTenantId_fkey"
  FOREIGN KEY ("referredTenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ReferralEvent" (
    "id" TEXT NOT NULL,
    "referrerTenantId" TEXT NOT NULL,
    "referredTenantId" TEXT,
    "code" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "path" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReferralEvent_eventType_referrerTenantId_referredTenantId_key"
ON "ReferralEvent"("eventType", "referrerTenantId", "referredTenantId");

CREATE INDEX "ReferralEvent_referrerTenantId_eventType_createdAt_idx"
ON "ReferralEvent"("referrerTenantId", "eventType", "createdAt");

CREATE INDEX "ReferralEvent_referredTenantId_eventType_idx"
ON "ReferralEvent"("referredTenantId", "eventType");

CREATE INDEX "ReferralEvent_code_eventType_createdAt_idx"
ON "ReferralEvent"("code", "eventType", "createdAt");

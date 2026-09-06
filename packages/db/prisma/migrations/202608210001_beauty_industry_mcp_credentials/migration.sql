ALTER TABLE "WorkbuddyMcpConnection"
ADD COLUMN "productCode" TEXT,
ADD COLUMN "operatingEntityId" TEXT,
ADD COLUMN "scopes" JSONB,
ADD COLUMN "expiresAt" TIMESTAMP(3),
ADD COLUMN "revokedAt" TIMESTAMP(3),
ADD COLUMN "rotatedFromId" TEXT,
ADD COLUMN "rateLimitPerMinute" INTEGER NOT NULL DEFAULT 30;

CREATE INDEX "WorkbuddyMcpConnection_tenantId_productCode_status_idx"
ON "WorkbuddyMcpConnection"("tenantId", "productCode", "status");

CREATE INDEX "WorkbuddyMcpConnection_rotatedFromId_idx"
ON "WorkbuddyMcpConnection"("rotatedFromId");

ALTER TABLE "AgentRun"
ADD COLUMN "productCode" TEXT,
ADD COLUMN "operatingEntityId" TEXT,
ADD COLUMN "usageChannel" TEXT,
ADD COLUMN "mcpCredentialId" TEXT;

CREATE INDEX "AgentRun_tenantId_productCode_usageChannel_createdAt_idx"
ON "AgentRun"("tenantId", "productCode", "usageChannel", "createdAt");

CREATE INDEX "AgentRun_mcpCredentialId_createdAt_idx"
ON "AgentRun"("mcpCredentialId", "createdAt");

ALTER TABLE "CreditTransaction"
ADD COLUMN "productCode" TEXT,
ADD COLUMN "operatingEntityId" TEXT,
ADD COLUMN "channel" TEXT,
ADD COLUMN "capabilityId" TEXT,
ADD COLUMN "mcpCredentialId" TEXT,
ADD COLUMN "provider" TEXT;

CREATE INDEX "CreditTransaction_tenantId_productCode_channel_createdAt_idx"
ON "CreditTransaction"("tenantId", "productCode", "channel", "createdAt");

CREATE INDEX "CreditTransaction_mcpCredentialId_createdAt_idx"
ON "CreditTransaction"("mcpCredentialId", "createdAt");

CREATE TABLE "CreditReservation" (
    "id" TEXT NOT NULL,
    "creditAccountId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "productCode" TEXT,
    "operatingEntityId" TEXT,
    "channel" TEXT NOT NULL,
    "mcpCredentialId" TEXT,
    "requestId" TEXT NOT NULL,
    "requestFingerprint" TEXT,
    "amount" INTEGER NOT NULL,
    "actualAmount" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'reserved',
    "agentRunId" TEXT,
    "errorCode" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditReservation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CreditReservation_requestId_key" ON "CreditReservation"("requestId");
CREATE INDEX "CreditReservation_tenantId_productCode_status_createdAt_idx"
ON "CreditReservation"("tenantId", "productCode", "status", "createdAt");
CREATE INDEX "CreditReservation_mcpCredentialId_status_createdAt_idx"
ON "CreditReservation"("mcpCredentialId", "status", "createdAt");

ALTER TABLE "CreditReservation" ADD CONSTRAINT "CreditReservation_creditAccountId_fkey"
FOREIGN KEY ("creditAccountId") REFERENCES "CreditAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

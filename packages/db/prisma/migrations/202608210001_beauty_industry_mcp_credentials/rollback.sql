-- Test/staging rollback only. Back up product-scoped usage metadata first;
-- rolling back removes the additive audit fields and reservation records.
DROP TABLE IF EXISTS "CreditReservation";

DROP INDEX IF EXISTS "CreditTransaction_mcpCredentialId_createdAt_idx";
DROP INDEX IF EXISTS "CreditTransaction_tenantId_productCode_channel_createdAt_idx";
ALTER TABLE "CreditTransaction"
DROP COLUMN IF EXISTS "provider",
DROP COLUMN IF EXISTS "mcpCredentialId",
DROP COLUMN IF EXISTS "capabilityId",
DROP COLUMN IF EXISTS "channel",
DROP COLUMN IF EXISTS "operatingEntityId",
DROP COLUMN IF EXISTS "productCode";

DROP INDEX IF EXISTS "AgentRun_mcpCredentialId_createdAt_idx";
DROP INDEX IF EXISTS "AgentRun_tenantId_productCode_usageChannel_createdAt_idx";
ALTER TABLE "AgentRun"
DROP COLUMN IF EXISTS "mcpCredentialId",
DROP COLUMN IF EXISTS "usageChannel",
DROP COLUMN IF EXISTS "operatingEntityId",
DROP COLUMN IF EXISTS "productCode";

DROP INDEX IF EXISTS "WorkbuddyMcpConnection_rotatedFromId_idx";
DROP INDEX IF EXISTS "WorkbuddyMcpConnection_tenantId_productCode_status_idx";
ALTER TABLE "WorkbuddyMcpConnection"
DROP COLUMN IF EXISTS "rateLimitPerMinute",
DROP COLUMN IF EXISTS "rotatedFromId",
DROP COLUMN IF EXISTS "revokedAt",
DROP COLUMN IF EXISTS "expiresAt",
DROP COLUMN IF EXISTS "scopes",
DROP COLUMN IF EXISTS "operatingEntityId",
DROP COLUMN IF EXISTS "productCode";

CREATE TABLE "ApiCredential" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "scopes" TEXT NOT NULL DEFAULT 'audio_cards:write',
    "status" TEXT NOT NULL DEFAULT 'active',
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiCredential_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ApiCredential_keyHash_key" ON "ApiCredential"("keyHash");
CREATE INDEX "ApiCredential_tenantId_status_idx" ON "ApiCredential"("tenantId", "status");
CREATE INDEX "ApiCredential_keyPrefix_idx" ON "ApiCredential"("keyPrefix");
CREATE INDEX "ApiCredential_userId_createdAt_idx" ON "ApiCredential"("userId", "createdAt");

ALTER TABLE "ApiCredential" ADD CONSTRAINT "ApiCredential_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApiCredential" ADD CONSTRAINT "ApiCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

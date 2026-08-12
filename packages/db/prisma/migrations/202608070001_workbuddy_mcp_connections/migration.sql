CREATE TABLE "WorkbuddyMcpConnection" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenPrefix" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkbuddyMcpConnection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkbuddyMcpConnection_tokenHash_key" ON "WorkbuddyMcpConnection"("tokenHash");
CREATE INDEX "WorkbuddyMcpConnection_tenantId_userId_status_idx" ON "WorkbuddyMcpConnection"("tenantId", "userId", "status");
CREATE INDEX "WorkbuddyMcpConnection_agentId_status_idx" ON "WorkbuddyMcpConnection"("agentId", "status");

ALTER TABLE "WorkbuddyMcpConnection" ADD CONSTRAINT "WorkbuddyMcpConnection_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkbuddyMcpConnection" ADD CONSTRAINT "WorkbuddyMcpConnection_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkbuddyMcpConnection" ADD CONSTRAINT "WorkbuddyMcpConnection_agentId_fkey"
FOREIGN KEY ("agentId") REFERENCES "AgentDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

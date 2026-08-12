ALTER TABLE "Conversation"
  ADD COLUMN "deviceScope" TEXT NOT NULL DEFAULT 'desktop';

ALTER TABLE "AgentRun"
  ADD COLUMN "deviceScope" TEXT NOT NULL DEFAULT 'desktop';

CREATE INDEX "Conversation_tenantId_agentId_deviceScope_updatedAt_idx"
  ON "Conversation"("tenantId", "agentId", "deviceScope", "updatedAt");

CREATE INDEX "AgentRun_tenantId_deviceScope_createdAt_idx"
  ON "AgentRun"("tenantId", "deviceScope", "createdAt");

CREATE TABLE "AiTransformationSession" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'exploring',
    "turnCount" INTEGER NOT NULL DEFAULT 0,
    "businessContext" JSONB NOT NULL,
    "opportunityMap" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AiTransformationSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiTransformationMessage" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiTransformationMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DigitalExecutive" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "sourceSessionId" TEXT,
    "templateKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "mission" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "buildMode" TEXT NOT NULL DEFAULT 'self_service',
    "spec" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "humanSupportRequestedAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DigitalExecutive_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AiTransformationSession_tenantId_updatedAt_idx" ON "AiTransformationSession"("tenantId", "updatedAt");
CREATE INDEX "AiTransformationSession_tenantId_userId_updatedAt_idx" ON "AiTransformationSession"("tenantId", "userId", "updatedAt");
CREATE INDEX "AiTransformationSession_tenantId_status_updatedAt_idx" ON "AiTransformationSession"("tenantId", "status", "updatedAt");
CREATE INDEX "AiTransformationMessage_sessionId_createdAt_idx" ON "AiTransformationMessage"("sessionId", "createdAt");
CREATE INDEX "AiTransformationMessage_tenantId_createdAt_idx" ON "AiTransformationMessage"("tenantId", "createdAt");
CREATE INDEX "DigitalExecutive_tenantId_updatedAt_idx" ON "DigitalExecutive"("tenantId", "updatedAt");
CREATE INDEX "DigitalExecutive_tenantId_status_updatedAt_idx" ON "DigitalExecutive"("tenantId", "status", "updatedAt");
CREATE INDEX "DigitalExecutive_sourceSessionId_idx" ON "DigitalExecutive"("sourceSessionId");

ALTER TABLE "AiTransformationSession" ADD CONSTRAINT "AiTransformationSession_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiTransformationSession" ADD CONSTRAINT "AiTransformationSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AiTransformationMessage" ADD CONSTRAINT "AiTransformationMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AiTransformationSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiTransformationMessage" ADD CONSTRAINT "AiTransformationMessage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DigitalExecutive" ADD CONSTRAINT "DigitalExecutive_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DigitalExecutive" ADD CONSTRAINT "DigitalExecutive_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DigitalExecutive" ADD CONSTRAINT "DigitalExecutive_sourceSessionId_fkey" FOREIGN KEY ("sourceSessionId") REFERENCES "AiTransformationSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

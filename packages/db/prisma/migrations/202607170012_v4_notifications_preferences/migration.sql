CREATE TABLE "NotificationPreference" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "inAppEnabled" BOOLEAN NOT NULL DEFAULT true,
  "wechatEnabled" BOOLEAN NOT NULL DEFAULT true,
  "smsEnabled" BOOLEAN NOT NULL DEFAULT false,
  "quietStart" TEXT NOT NULL DEFAULT '22:00',
  "quietEnd" TEXT NOT NULL DEFAULT '08:00',
  "weeklyPushDay" INTEGER NOT NULL DEFAULT 0,
  "weeklyPushTime" TEXT NOT NULL DEFAULT '20:00',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InAppNotification" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "userId" TEXT,
  "type" TEXT NOT NULL,
  "urgency" TEXT NOT NULL DEFAULT 'normal',
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "targetView" TEXT,
  "metadata" JSONB,
  "dedupeKey" TEXT,
  "readAt" TIMESTAMP(3),
  "popupShownAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InAppNotification_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UserPreference" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "agentRunId" TEXT,
  "outputId" TEXT NOT NULL,
  "outputType" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "reason" TEXT,
  "note" TEXT,
  "preferenceData" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserPreference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NotificationPreference_tenantId_userId_key" ON "NotificationPreference"("tenantId", "userId");
CREATE INDEX "NotificationPreference_tenantId_updatedAt_idx" ON "NotificationPreference"("tenantId", "updatedAt");
CREATE UNIQUE INDEX "InAppNotification_tenantId_dedupeKey_key" ON "InAppNotification"("tenantId", "dedupeKey");
CREATE INDEX "InAppNotification_tenantId_userId_readAt_createdAt_idx" ON "InAppNotification"("tenantId", "userId", "readAt", "createdAt");
CREATE UNIQUE INDEX "UserPreference_tenantId_userId_outputId_key" ON "UserPreference"("tenantId", "userId", "outputId");
CREATE INDEX "UserPreference_tenantId_userId_outputType_updatedAt_idx" ON "UserPreference"("tenantId", "userId", "outputType", "updatedAt");
CREATE INDEX "UserPreference_agentRunId_idx" ON "UserPreference"("agentRunId");

ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InAppNotification" ADD CONSTRAINT "InAppNotification_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InAppNotification" ADD CONSTRAINT "InAppNotification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserPreference" ADD CONSTRAINT "UserPreference_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserPreference" ADD CONSTRAINT "UserPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserPreference" ADD CONSTRAINT "UserPreference_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

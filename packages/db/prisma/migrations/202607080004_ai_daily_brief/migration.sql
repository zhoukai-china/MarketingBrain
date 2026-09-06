CREATE TABLE "AiDailyBriefReport" (
    "id" TEXT NOT NULL,
    "reportDate" TEXT NOT NULL,
    "issueNo" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "contentJson" JSONB NOT NULL,
    "contentMarkdown" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "generatedBy" TEXT NOT NULL DEFAULT 'sitong-ai-agent',
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AiDailyBriefReport_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiDailyBriefPreference" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "pushTime" TEXT NOT NULL DEFAULT '09:00',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Shanghai',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AiDailyBriefPreference_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiDailyBriefPushLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'in_app',
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "pushedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AiDailyBriefPushLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AiDailyBriefReport_reportDate_key" ON "AiDailyBriefReport"("reportDate");
CREATE INDEX "AiDailyBriefReport_status_reportDate_idx" ON "AiDailyBriefReport"("status", "reportDate");
CREATE INDEX "AiDailyBriefReport_publishedAt_idx" ON "AiDailyBriefReport"("publishedAt");

CREATE UNIQUE INDEX "AiDailyBriefPreference_tenantId_key" ON "AiDailyBriefPreference"("tenantId");

CREATE UNIQUE INDEX "AiDailyBriefPushLog_tenantId_reportId_channel_key" ON "AiDailyBriefPushLog"("tenantId", "reportId", "channel");
CREATE INDEX "AiDailyBriefPushLog_tenantId_status_scheduledAt_idx" ON "AiDailyBriefPushLog"("tenantId", "status", "scheduledAt");
CREATE INDEX "AiDailyBriefPushLog_reportId_status_idx" ON "AiDailyBriefPushLog"("reportId", "status");

ALTER TABLE "AiDailyBriefPreference" ADD CONSTRAINT "AiDailyBriefPreference_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiDailyBriefPushLog" ADD CONSTRAINT "AiDailyBriefPushLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiDailyBriefPushLog" ADD CONSTRAINT "AiDailyBriefPushLog_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "AiDailyBriefReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

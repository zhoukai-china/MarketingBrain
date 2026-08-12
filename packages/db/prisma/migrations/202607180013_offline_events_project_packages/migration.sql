ALTER TYPE "BillingOrderType" ADD VALUE IF NOT EXISTS 'project_package';

ALTER TABLE "BillingOrder" ADD COLUMN "projectPackageCode" TEXT;
ALTER TABLE "BillingOrder" ADD COLUMN "channelId" TEXT;
ALTER TABLE "BillingOrder" ADD COLUMN "eventId" TEXT;
ALTER TABLE "BillingOrder" ADD COLUMN "commissionRate" DECIMAL(10,4);

CREATE TABLE "OfflineEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "channelId" TEXT,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "city" TEXT,
    "venue" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "targetAttendees" INTEGER NOT NULL DEFAULT 30,
    "minAttendees" INTEGER NOT NULL DEFAULT 15,
    "commissionRate" DECIMAL(10,4) NOT NULL DEFAULT 0.2,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OfflineEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OfflineEventRegistration" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT,
    "phone" TEXT,
    "businessName" TEXT,
    "industry" TEXT,
    "city" TEXT,
    "status" TEXT NOT NULL DEFAULT 'registered',
    "source" TEXT NOT NULL DEFAULT 'offline_event',
    "diagnosisConversationId" TEXT,
    "diagnosisReportJson" JSONB,
    "checkedInAt" TIMESTAMP(3),
    "diagnosisCompletedAt" TIMESTAMP(3),
    "purchasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OfflineEventRegistration_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GrowthProjectCohort" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "eventId" TEXT,
    "packageCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "intensiveEndDate" TIMESTAMP(3) NOT NULL,
    "accessEndDate" TIMESTAMP(3) NOT NULL,
    "bufferEndDate" TIMESTAMP(3) NOT NULL,
    "seatLimit" INTEGER NOT NULL DEFAULT 50,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GrowthProjectCohort_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GrowthProject" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "cohortId" TEXT,
    "orderId" TEXT,
    "packageCode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "intensiveEndDate" TIMESTAMP(3) NOT NULL,
    "accessEndDate" TIMESTAMP(3) NOT NULL,
    "bufferEndDate" TIMESTAMP(3) NOT NULL,
    "progressPercent" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GrowthProject_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GrowthProjectTask" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT,
    "cohortId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "dueDay" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'not_started',
    "resourceUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GrowthProjectTask_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OfflineEvent_code_key" ON "OfflineEvent"("code");
CREATE INDEX "OfflineEvent_tenantId_startsAt_idx" ON "OfflineEvent"("tenantId", "startsAt");
CREATE INDEX "OfflineEvent_channelId_startsAt_idx" ON "OfflineEvent"("channelId", "startsAt");
CREATE INDEX "OfflineEvent_code_idx" ON "OfflineEvent"("code");

CREATE INDEX "OfflineEventRegistration_tenantId_createdAt_idx" ON "OfflineEventRegistration"("tenantId", "createdAt");
CREATE INDEX "OfflineEventRegistration_eventId_status_idx" ON "OfflineEventRegistration"("eventId", "status");
CREATE INDEX "OfflineEventRegistration_userId_idx" ON "OfflineEventRegistration"("userId");
CREATE INDEX "OfflineEventRegistration_phone_idx" ON "OfflineEventRegistration"("phone");

CREATE INDEX "GrowthProjectCohort_tenantId_startDate_idx" ON "GrowthProjectCohort"("tenantId", "startDate");
CREATE INDEX "GrowthProjectCohort_eventId_idx" ON "GrowthProjectCohort"("eventId");
CREATE INDEX "GrowthProjectCohort_packageCode_status_idx" ON "GrowthProjectCohort"("packageCode", "status");

CREATE UNIQUE INDEX "GrowthProject_orderId_key" ON "GrowthProject"("orderId");
CREATE INDEX "GrowthProject_tenantId_status_idx" ON "GrowthProject"("tenantId", "status");
CREATE INDEX "GrowthProject_cohortId_idx" ON "GrowthProject"("cohortId");
CREATE INDEX "GrowthProject_packageCode_idx" ON "GrowthProject"("packageCode");

CREATE INDEX "GrowthProjectTask_tenantId_dueDay_idx" ON "GrowthProjectTask"("tenantId", "dueDay");
CREATE INDEX "GrowthProjectTask_projectId_idx" ON "GrowthProjectTask"("projectId");
CREATE INDEX "GrowthProjectTask_cohortId_idx" ON "GrowthProjectTask"("cohortId");

CREATE INDEX "BillingOrder_eventId_idx" ON "BillingOrder"("eventId");
CREATE INDEX "BillingOrder_channelId_idx" ON "BillingOrder"("channelId");
CREATE INDEX "BillingOrder_projectPackageCode_idx" ON "BillingOrder"("projectPackageCode");

ALTER TABLE "OfflineEvent" ADD CONSTRAINT "OfflineEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OfflineEvent" ADD CONSTRAINT "OfflineEvent_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Distributor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OfflineEventRegistration" ADD CONSTRAINT "OfflineEventRegistration_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "OfflineEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OfflineEventRegistration" ADD CONSTRAINT "OfflineEventRegistration_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GrowthProjectCohort" ADD CONSTRAINT "GrowthProjectCohort_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GrowthProjectCohort" ADD CONSTRAINT "GrowthProjectCohort_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "OfflineEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GrowthProject" ADD CONSTRAINT "GrowthProject_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GrowthProject" ADD CONSTRAINT "GrowthProject_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GrowthProject" ADD CONSTRAINT "GrowthProject_cohortId_fkey" FOREIGN KEY ("cohortId") REFERENCES "GrowthProjectCohort"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GrowthProject" ADD CONSTRAINT "GrowthProject_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "BillingOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GrowthProjectTask" ADD CONSTRAINT "GrowthProjectTask_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "GrowthProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GrowthProjectTask" ADD CONSTRAINT "GrowthProjectTask_cohortId_fkey" FOREIGN KEY ("cohortId") REFERENCES "GrowthProjectCohort"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BillingOrder" ADD CONSTRAINT "BillingOrder_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "OfflineEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

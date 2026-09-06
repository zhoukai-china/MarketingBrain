CREATE TABLE "FounderIpGoalBrief" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "subjectId" TEXT NOT NULL,
  "target" TEXT NOT NULL,
  "identity" TEXT NOT NULL,
  "targetCustomer" TEXT NOT NULL,
  "acquisitionGoal" TEXT NOT NULL,
  "offer" TEXT,
  "accountStage" TEXT,
  "industry" TEXT NOT NULL,
  "benchmarkAccounts" JSONB NOT NULL DEFAULT '[]',
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FounderIpGoalBrief_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FounderIpGoalBrief_tenantId_subjectId_target_key" ON "FounderIpGoalBrief"("tenantId", "subjectId", "target");
CREATE INDEX "FounderIpGoalBrief_tenantId_subjectId_updatedAt_idx" ON "FounderIpGoalBrief"("tenantId", "subjectId", "updatedAt");
ALTER TABLE "FounderIpGoalBrief" ADD CONSTRAINT "FounderIpGoalBrief_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FounderIpGoalBrief" ADD CONSTRAINT "FounderIpGoalBrief_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "KnowledgeSubject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

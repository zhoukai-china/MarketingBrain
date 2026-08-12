ALTER TABLE "QualityFeedback"
ADD COLUMN "reasonCodes" JSONB,
ADD COLUMN "feedbackKey" TEXT,
ADD COLUMN "source" TEXT NOT NULL DEFAULT 'user';

CREATE TABLE "AgentOutcomeEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "agentRunId" TEXT NOT NULL,
    "eventKey" TEXT,
    "eventType" TEXT NOT NULL,
    "value" DOUBLE PRECISION,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentOutcomeEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgentQualityReview" (
    "id" TEXT NOT NULL,
    "agentRunId" TEXT NOT NULL,
    "deterministicScore" INTEGER NOT NULL,
    "feedbackScore" INTEGER,
    "behaviorScore" INTEGER,
    "overallScore" INTEGER NOT NULL,
    "hardGatePassed" BOOLEAN NOT NULL,
    "issues" JSONB NOT NULL,
    "signals" JSONB NOT NULL,
    "reviewerVersion" TEXT NOT NULL,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentQualityReview_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DailyQualitySnapshot" (
    "id" TEXT NOT NULL,
    "snapshotDate" TIMESTAMP(3) NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "agentId" TEXT,
    "skillId" TEXT,
    "runCount" INTEGER NOT NULL,
    "succeededCount" INTEGER NOT NULL,
    "failedCount" INTEGER NOT NULL,
    "flaggedCount" INTEGER NOT NULL,
    "feedbackCount" INTEGER NOT NULL,
    "positiveCount" INTEGER NOT NULL,
    "negativeCount" INTEGER NOT NULL,
    "hardGateFailureCount" INTEGER NOT NULL,
    "averageScore" DOUBLE PRECISION NOT NULL,
    "metrics" JSONB NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyQualitySnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FailureCluster" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "agentId" TEXT,
    "skillId" TEXT,
    "occurrenceCount" INTEGER NOT NULL,
    "sampleRunIds" JSONB NOT NULL,
    "evidenceSummary" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FailureCluster_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ImprovementCandidate" (
    "id" TEXT NOT NULL,
    "candidateKey" TEXT NOT NULL,
    "sourceSnapshotId" TEXT NOT NULL,
    "sourceClusterId" TEXT,
    "type" TEXT NOT NULL,
    "targetKey" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "proposedChange" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'awaiting_review',
    "baselineMetrics" JSONB,
    "candidateMetrics" JSONB,
    "riskLevel" TEXT NOT NULL DEFAULT 'medium',
    "requiresHumanApproval" BOOLEAN NOT NULL DEFAULT true,
    "decisionNote" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImprovementCandidate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "QualityExperiment" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "championVersion" TEXT NOT NULL,
    "challengerVersion" TEXT NOT NULL,
    "trafficPercent" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "guardrails" JSONB NOT NULL,
    "baselineMetrics" JSONB,
    "liveMetrics" JSONB,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "rollbackReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QualityExperiment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LearnedEvalCase" (
    "id" TEXT NOT NULL,
    "caseKey" TEXT NOT NULL,
    "sourceAgentRunId" TEXT,
    "sourceClusterId" TEXT,
    "agentId" TEXT,
    "skillId" TEXT NOT NULL,
    "inputSanitized" TEXT NOT NULL,
    "expectedBehavior" JSONB NOT NULL,
    "forbiddenBehavior" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearnedEvalCase_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AgentOutcomeEvent_agentRunId_createdAt_idx" ON "AgentOutcomeEvent"("agentRunId", "createdAt");
CREATE INDEX "AgentOutcomeEvent_tenantId_eventType_createdAt_idx" ON "AgentOutcomeEvent"("tenantId", "eventType", "createdAt");
CREATE UNIQUE INDEX "AgentOutcomeEvent_agentRunId_eventKey_key" ON "AgentOutcomeEvent"("agentRunId", "eventKey");
CREATE UNIQUE INDEX "QualityFeedback_agentRunId_feedbackKey_key" ON "QualityFeedback"("agentRunId", "feedbackKey");
CREATE UNIQUE INDEX "AgentQualityReview_agentRunId_key" ON "AgentQualityReview"("agentRunId");
CREATE INDEX "AgentQualityReview_overallScore_reviewedAt_idx" ON "AgentQualityReview"("overallScore", "reviewedAt");
CREATE INDEX "AgentQualityReview_hardGatePassed_reviewedAt_idx" ON "AgentQualityReview"("hardGatePassed", "reviewedAt");
CREATE UNIQUE INDEX "DailyQualitySnapshot_snapshotDate_scopeKey_key" ON "DailyQualitySnapshot"("snapshotDate", "scopeKey");
CREATE INDEX "DailyQualitySnapshot_scopeKey_generatedAt_idx" ON "DailyQualitySnapshot"("scopeKey", "generatedAt");
CREATE INDEX "DailyQualitySnapshot_agentId_snapshotDate_idx" ON "DailyQualitySnapshot"("agentId", "snapshotDate");
CREATE INDEX "DailyQualitySnapshot_skillId_snapshotDate_idx" ON "DailyQualitySnapshot"("skillId", "snapshotDate");
CREATE UNIQUE INDEX "FailureCluster_snapshotId_fingerprint_key" ON "FailureCluster"("snapshotId", "fingerprint");
CREATE INDEX "FailureCluster_category_severity_createdAt_idx" ON "FailureCluster"("category", "severity", "createdAt");
CREATE INDEX "FailureCluster_agentId_skillId_createdAt_idx" ON "FailureCluster"("agentId", "skillId", "createdAt");
CREATE UNIQUE INDEX "ImprovementCandidate_candidateKey_key" ON "ImprovementCandidate"("candidateKey");
CREATE INDEX "ImprovementCandidate_status_riskLevel_createdAt_idx" ON "ImprovementCandidate"("status", "riskLevel", "createdAt");
CREATE INDEX "ImprovementCandidate_type_targetKey_createdAt_idx" ON "ImprovementCandidate"("type", "targetKey", "createdAt");
CREATE INDEX "QualityExperiment_candidateId_status_idx" ON "QualityExperiment"("candidateId", "status");
CREATE INDEX "QualityExperiment_status_createdAt_idx" ON "QualityExperiment"("status", "createdAt");
CREATE UNIQUE INDEX "LearnedEvalCase_caseKey_key" ON "LearnedEvalCase"("caseKey");
CREATE INDEX "LearnedEvalCase_status_createdAt_idx" ON "LearnedEvalCase"("status", "createdAt");
CREATE INDEX "LearnedEvalCase_agentId_skillId_createdAt_idx" ON "LearnedEvalCase"("agentId", "skillId", "createdAt");

ALTER TABLE "AgentOutcomeEvent" ADD CONSTRAINT "AgentOutcomeEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentOutcomeEvent" ADD CONSTRAINT "AgentOutcomeEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AgentOutcomeEvent" ADD CONSTRAINT "AgentOutcomeEvent_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentQualityReview" ADD CONSTRAINT "AgentQualityReview_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FailureCluster" ADD CONSTRAINT "FailureCluster_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "DailyQualitySnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ImprovementCandidate" ADD CONSTRAINT "ImprovementCandidate_sourceSnapshotId_fkey" FOREIGN KEY ("sourceSnapshotId") REFERENCES "DailyQualitySnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ImprovementCandidate" ADD CONSTRAINT "ImprovementCandidate_sourceClusterId_fkey" FOREIGN KEY ("sourceClusterId") REFERENCES "FailureCluster"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "QualityExperiment" ADD CONSTRAINT "QualityExperiment_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "ImprovementCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LearnedEvalCase" ADD CONSTRAINT "LearnedEvalCase_sourceAgentRunId_fkey" FOREIGN KEY ("sourceAgentRunId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LearnedEvalCase" ADD CONSTRAINT "LearnedEvalCase_sourceClusterId_fkey" FOREIGN KEY ("sourceClusterId") REFERENCES "FailureCluster"("id") ON DELETE SET NULL ON UPDATE CASCADE;

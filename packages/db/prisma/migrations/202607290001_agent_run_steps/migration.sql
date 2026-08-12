CREATE TABLE "AgentRunStep" (
  "id" TEXT NOT NULL,
  "agentRunId" TEXT NOT NULL,
  "stepId" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "capabilityId" TEXT,
  "skillId" TEXT NOT NULL,
  "skillVersion" TEXT NOT NULL,
  "status" "SkillRunStatus" NOT NULL,
  "dependsOn" JSONB,
  "input" TEXT NOT NULL,
  "output" TEXT,
  "qualityFlags" JSONB,
  "creditCost" INTEGER NOT NULL DEFAULT 0,
  "durationMs" INTEGER NOT NULL DEFAULT 0,
  "errorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AgentRunStep_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgentRunStep_agentRunId_stepId_key" ON "AgentRunStep"("agentRunId", "stepId");
CREATE INDEX "AgentRunStep_skillId_createdAt_idx" ON "AgentRunStep"("skillId", "createdAt");
CREATE INDEX "AgentRunStep_status_createdAt_idx" ON "AgentRunStep"("status", "createdAt");

ALTER TABLE "AgentRunStep"
  ADD CONSTRAINT "AgentRunStep_agentRunId_fkey"
  FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

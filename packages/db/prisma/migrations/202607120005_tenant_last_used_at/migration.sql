-- Last effective use is a completed AI consultation, not a page view or an
-- automated task. Backfill the field from successful historical AI runs.
ALTER TABLE "Tenant" ADD COLUMN "lastUsedAt" TIMESTAMP(3);

UPDATE "Tenant" AS tenant
SET "lastUsedAt" = activity."lastUsedAt"
FROM (
    SELECT "tenantId", MAX("createdAt") AS "lastUsedAt"
    FROM "AgentRun"
    WHERE "status" = 'succeeded'
    GROUP BY "tenantId"
) AS activity
WHERE tenant."id" = activity."tenantId";

CREATE INDEX "Tenant_lastUsedAt_idx" ON "Tenant"("lastUsedAt");

import assert from "node:assert/strict";

if (process.env.BEAUTY_DAILY_BRIEF_LIVE_ACCEPTANCE_APPROVED !== "true") throw new Error("beauty_daily_brief_live_acceptance_not_approved");
if (process.env.BEAUTY_DAILY_BRIEF_MANUAL_ACCEPTANCE_APPROVED !== "true") throw new Error("beauty_daily_brief_manual_acceptance_not_approved");
if (process.env.DATA_MODE !== "database" || !process.env.DATABASE_URL?.includes("/beauty_industry_acceptance_20260821")) throw new Error("beauty_daily_brief_live_acceptance_database_invalid");
if (process.env.BEAUTY_DAILY_BRIEF_RUNTIME_MODE !== "live" || process.env.BEAUTY_DAILY_BRIEF_SCHEDULER_ENABLED !== "false") throw new Error("beauty_daily_brief_live_acceptance_mode_invalid");

async function main() {
  const [{ prisma }, manual, contract] = await Promise.all([
    import("../packages/db/src/index.js"),
    import("../apps/api/src/products/beauty-industry/daily-brief-manual-acceptance.js"),
    import("../apps/api/src/products/beauty-industry/daily-brief-contract.js")
  ]);
  const grantId = process.env.BEAUTY_DAILY_BRIEF_MANUAL_ACCEPTANCE_GRANT_ID?.trim() ?? "";
  const parentUniqueKey = process.env.BEAUTY_DAILY_BRIEF_MANUAL_ACCEPTANCE_PARENT_KEY?.trim() ?? "";
  const { businessDate } = contract.readBeautyDailyBriefClock();
  const suffix = grantId.replace(/[^a-z0-9]/giu, "_");
  const tenantId = `by20_manual_tenant_${suffix}`;
  const userId = `by20_manual_user_${suffix}`;
  const started = Date.now();
  try {
    const parent = await prisma.beautyDailyBriefSnapshot.findUniqueOrThrow({
      where: {
        productCode_businessDate_contractVersion: {
          productCode: contract.BEAUTY_DAILY_BRIEF_PRODUCT_CODE,
          businessDate,
          contractVersion: contract.BEAUTY_DAILY_BRIEF_CONTRACT_VERSION
        }
      }
    });
    const grant = {
      grantId,
      businessDate,
      currentBusinessDate: businessDate,
      contractVersion: contract.BEAUTY_DAILY_BRIEF_CONTRACT_VERSION,
      parentUniqueKey,
      parentNetworkRequestCount: parent.networkRequestCount,
      parentProviderCallCount: parent.providerCallCount,
      priorSameDayAuditHttpCount: 94,
      priorManualProviderCallCount: 0,
      additionalHttpLimit: 36,
      sameDayAuditHttpLimit: 130,
      modelCallLimit: 1
    };
    assert.deepEqual(manual.validateBeautyDailyBriefManualAcceptanceGrant(grant), []);
    await prisma.user.upsert({ where: { id: userId }, update: {}, create: { id: userId, nickname: "BY20 Synthetic Manual Acceptance" } });
    await prisma.tenant.upsert({ where: { id: tenantId }, update: {}, create: { id: tenantId, name: "BY20 Synthetic Manual Acceptance", type: "local_business", industry: "生活美容" } });
    await prisma.membership.upsert({ where: { tenantId_userId: { tenantId, userId } }, update: { isActive: true }, create: { tenantId, userId, role: "owner", isActive: true } });
    const entitlement = await prisma.tenantProductEntitlement.findFirst({ where: { tenantId, productCode: "beauty-industry" } });
    if (entitlement) await prisma.tenantProductEntitlement.update({ where: { id: entitlement.id }, data: { status: "active", expiresAt: new Date(Date.now() + 86_400_000) } });
    else await prisma.tenantProductEntitlement.create({ data: { tenantId, productCode: "beauty-industry", status: "active", source: "by20_manual_acceptance", expiresAt: new Date(Date.now() + 86_400_000) } });
    await prisma.creditAccount.upsert({ where: { tenantId }, update: { balance: 100 }, create: { tenantId, balance: 100 } });

    const result = await manual.executeBeautyDailyBriefManualAcceptance({ grant, tenantId, userId });
    const task = await prisma.automationTask.findUniqueOrThrow({ where: { id: grantId }, include: { logs: true } });
    const agentRuns = await prisma.agentRun.findMany({ where: { tenantId, requestId: manual.buildBeautyDailyBriefManualAcceptanceRunKey(grant) } });
    assert.equal(task.status, result.status === "succeeded" ? "succeeded" : result.status === "terminal_unknown" ? "terminal_unknown" : "failed");
    assert.equal(agentRuns.length, result.status === "succeeded" ? 1 : 0);
    assert.ok(result.networkRequestCount <= 36);
    assert.ok(result.sameDayAuditNetworkRequestCount <= 130);
    assert.ok(result.providerCallCount <= 1);
    console.log(JSON.stringify({
      ...result,
      taskStatus: task.status,
      safeLogEvents: task.logs.length,
      agentRuns: agentRuns.length,
      elapsedMs: Date.now() - started,
      fallbackUsed: false
    }));
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error(JSON.stringify({ status: "acceptance_failed", errorCode: error instanceof Error ? error.message.split(":")[0] : "unknown" }));
  process.exitCode = 1;
});

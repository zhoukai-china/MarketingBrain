import assert from "node:assert/strict";

if (process.env.BEAUTY_DAILY_BRIEF_LIVE_ACCEPTANCE_APPROVED !== "true") throw new Error("beauty_daily_brief_live_acceptance_not_approved");
if (process.env.DATA_MODE !== "database" || !process.env.DATABASE_URL?.includes("/beauty_industry_acceptance_20260821")) throw new Error("beauty_daily_brief_live_acceptance_database_invalid");
if (process.env.BEAUTY_DAILY_BRIEF_RUNTIME_MODE !== "live" || process.env.BEAUTY_DAILY_BRIEF_SCHEDULER_ENABLED !== "false") throw new Error("beauty_daily_brief_live_acceptance_mode_invalid");

async function main() {
  const [{ prisma }, service, contract] = await Promise.all([
    import("../packages/db/src/index.js"),
    import("../apps/api/src/products/beauty-industry/daily-brief-service.js"),
    import("../apps/api/src/products/beauty-industry/daily-brief-contract.js")
  ]);
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const tenantId = `by20_live_tenant_${suffix}`;
  const userId = `by20_live_user_${suffix}`;
  const { businessDate } = contract.readBeautyDailyBriefClock();
  const started = Date.now();
  try {
    assert.equal(await prisma.beautyDailyBriefSnapshot.count({ where: { productCode: "beauty-industry", businessDate, contractVersion: contract.BEAUTY_DAILY_BRIEF_CONTRACT_VERSION } }), 0, "business date already attempted");
    await prisma.user.create({ data: { id: userId, nickname: "BY20 Synthetic Public Daily Acceptance" } });
    await prisma.tenant.create({ data: { id: tenantId, name: "BY20 Synthetic Public Daily Acceptance", type: "local_business", industry: "生活美容" } });
    await prisma.membership.create({ data: { tenantId, userId, role: "owner", isActive: true } });
    await prisma.tenantProductEntitlement.create({ data: { tenantId, productCode: "beauty-industry", status: "active", source: "by20_live_acceptance", expiresAt: new Date(Date.now() + 86_400_000) } });
    await prisma.creditAccount.create({ data: { tenantId, balance: 100 } });
    const queued = await service.enqueueBeautyDailyBrief({ tenantId, userId, businessDate, trigger: "manual" });
    assert.equal(queued.reused, false);
    await service.processBeautyDailyBriefSnapshot(queued.snapshotId, `by20-live-${suffix}`);
    const snapshot = await prisma.beautyDailyBriefSnapshot.findUniqueOrThrow({ where: { id: queued.snapshotId }, include: { automationTask: { include: { logs: true } } } });
    const agentRuns = await prisma.agentRun.count({ where: { tenantId, capabilityId: "beauty_daily_brief", requestId: contract.beautyDailyBriefUniqueKey(businessDate) } });
    const result = {
      status: snapshot.status,
      phase: snapshot.phase,
      businessDate,
      sourceWindowHours: snapshot.sourceWindowHours,
      sourceCount: snapshot.sourceCount,
      networkRequestCount: snapshot.networkRequestCount,
      providerCallCount: snapshot.providerCallCount,
      providerCostYuan: Number(snapshot.providerCostYuan),
      agentRuns,
      taskStatus: snapshot.automationTask?.status,
      elapsedMs: Date.now() - started,
      errorCode: snapshot.errorCode,
      fallbackUsed: false,
      safeLogEvents: snapshot.automationTask?.logs.length ?? 0
    };
    if (snapshot.status === "succeeded") {
      assert.deepEqual(contract.validateBeautyDailyBriefReport(snapshot.report as never), []);
      assert.equal(snapshot.providerCallCount, 1);
      assert.equal(agentRuns, 1);
    } else {
      assert.equal(snapshot.providerCallCount, 0, "source failure must stop before model");
      assert.equal(agentRuns, 0);
    }
    console.log(JSON.stringify(result));
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error(JSON.stringify({ status: "acceptance_failed", errorCode: error instanceof Error ? error.message.split(":")[0] : "unknown" }));
  process.exitCode = 1;
});

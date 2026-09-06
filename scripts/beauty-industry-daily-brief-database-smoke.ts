import assert from "node:assert/strict";

const allowedDatabase = "beauty_industry_acceptance_20260821";
if (process.env.BEAUTY_DAILY_BRIEF_TEST_DATABASE_ALLOWED !== "true" || !process.env.DATABASE_URL?.includes(`/${allowedDatabase}`)) {
  throw new Error(`refusing_non_isolated_database:${allowedDatabase}`);
}
process.env.DATA_MODE = "database";
process.env.BEAUTY_DAILY_BRIEF_RUNTIME_MODE = "controlled_mock";
process.env.BEAUTY_DAILY_BRIEF_SCHEDULER_ENABLED = "false";
process.env.BEAUTY_DAILY_BRIEF_RECURRING_APPROVED = "false";
process.env.BEAUTY_DAILY_BRIEF_DAILY_NETWORK_REQUEST_LIMIT = "0";
process.env.BEAUTY_DAILY_BRIEF_DAILY_MODEL_CALL_LIMIT = "0";
process.env.BEAUTY_DAILY_BRIEF_DAILY_COST_LIMIT_YUAN = "0";

async function main(): Promise<void> {
  const [{ prisma }, service, contract] = await Promise.all([
    import("../packages/db/src/index.js"),
    import("../apps/api/src/products/beauty-industry/daily-brief-service.js"),
    import("../apps/api/src/products/beauty-industry/daily-brief-contract.js")
  ]);
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const tenantA = `beauty_daily_a_${suffix}`;
  const tenantB = `beauty_daily_b_${suffix}`;
  const userA = `beauty_daily_user_a_${suffix}`;
  const userB = `beauty_daily_user_b_${suffix}`;
  const businessDate = "2097-08-26";
  const recoveryDate = "2097-08-27";
  const unknownDate = "2097-08-28";
  try {
    await prisma.tenant.createMany({ data: [
      { id: tenantA, name: "Synthetic Beauty Daily A", type: "local_business", industry: "生活美容" },
      { id: tenantB, name: "Synthetic Beauty Daily B", type: "chain_brand", industry: "美甲美睫" }
    ] });
    await prisma.tenantProductEntitlement.createMany({ data: [
      { tenantId: tenantA, productCode: "beauty-industry", source: "by20_synthetic_smoke" },
      { tenantId: tenantB, productCode: "beauty-industry", source: "by20_synthetic_smoke" }
    ] });

    const duplicates = await Promise.all(Array.from({ length: 5 }, () => service.enqueueBeautyDailyBrief({ tenantId: tenantA, userId: userA, businessDate, trigger: "manual" })));
    assert.equal(new Set(duplicates.map((item) => item.snapshotId)).size, 1, "same day/version created duplicate snapshots");
    const snapshotId = duplicates[0].snapshotId;
    assert.equal(await prisma.beautyDailyBriefSnapshot.count({ where: { businessDate } }), 1);
    assert.equal(await prisma.automationTask.count({ where: { type: "beauty_daily_brief", payload: { path: ["businessDate"], equals: businessDate } } }), 1);

    await Promise.all([service.processBeautyDailyBriefSnapshot(snapshotId, "worker-a"), service.processBeautyDailyBriefSnapshot(snapshotId, "worker-b")]);
    const succeeded = await prisma.beautyDailyBriefSnapshot.findUniqueOrThrow({ where: { id: snapshotId } });
    assert.equal(succeeded.status, "succeeded");
    assert.equal(succeeded.attemptCount, 1, "multi-instance claim executed more than once");
    assert.equal(succeeded.providerCallCount, 0);
    assert.equal(succeeded.networkRequestCount, 0);
    assert.equal(succeeded.providerCostYuan.toString(), "0");
    assert.equal(succeeded.sourceCount, 15);
    assert.deepEqual(contract.validateBeautyDailyBriefReport(succeeded.report as never), []);
    const task = await prisma.automationTask.findUniqueOrThrow({ where: { id: succeeded.automationTaskId! } });
    assert.equal(task.status, "succeeded");
    assert.equal(await prisma.creditReservation.count({ where: { requestId: { contains: businessDate } } }), 0, "controlled mock reserved credits");
    const replay = await service.retryBeautyDailyBrief({ tenantId: tenantB, userId: userB, businessDate });
    assert.equal(replay.reused, true);
    assert.equal(replay.snapshotId, snapshotId);

    const recovery = await service.enqueueBeautyDailyBrief({ tenantId: tenantA, userId: userA, businessDate: recoveryDate, trigger: "catchup" });
    await prisma.beautyDailyBriefSnapshot.update({ where: { id: recovery.snapshotId }, data: { status: "generating", phase: "generating", lockedBy: "dead-worker", leaseExpiresAt: new Date(Date.now() - 10_000), providerCallCount: 0 } });
    await service.processBeautyDailyBriefSnapshot(recovery.snapshotId, "recovery-worker");
    assert.equal((await prisma.beautyDailyBriefSnapshot.findUniqueOrThrow({ where: { id: recovery.snapshotId } })).status, "succeeded", "expired zero-call lease did not recover");

    const terminal = await service.enqueueBeautyDailyBrief({ tenantId: tenantA, userId: userA, businessDate: unknownDate, trigger: "scheduled" });
    await prisma.beautyDailyBriefSnapshot.update({ where: { id: terminal.snapshotId }, data: { status: "generating", phase: "generating", lockedBy: "unknown-worker", leaseExpiresAt: new Date(Date.now() - 10_000), providerCallCount: 1 } });
    await service.processBeautyDailyBriefSnapshot(terminal.snapshotId, "forbidden-recovery-worker");
    const terminalRow = await prisma.beautyDailyBriefSnapshot.findUniqueOrThrow({ where: { id: terminal.snapshotId } });
    assert.equal(terminalRow.status, "generating", "unknown provider terminal was automatically retried");
    assert.equal(terminalRow.attemptCount, 0);

    const history = await service.listBeautyDailyBriefHistory(31);
    assert.equal(history.filter((item) => [businessDate, recoveryDate, unknownDate].includes(item.businessDate)).length, 3);
    assert.equal(history.find((item) => item.businessDate === businessDate)?.report?.runtimeMode, "controlled_mock");
    console.log(JSON.stringify({ status: "PASS", snapshots: 3, uniqueTasks: 3, providerCalls: 0, networkRequests: 0, costYuan: 0, multiInstanceClaims: 1, recoveredLease: true, terminalUnknownAutoRetry: false }));
  } finally {
    const snapshots = await prisma.beautyDailyBriefSnapshot.findMany({ where: { businessDate: { in: [businessDate, recoveryDate, unknownDate] } }, select: { automationTaskId: true } });
    await prisma.beautyDailyBriefSnapshot.deleteMany({ where: { businessDate: { in: [businessDate, recoveryDate, unknownDate] } } });
    await prisma.automationTask.deleteMany({ where: { id: { in: snapshots.flatMap((item) => item.automationTaskId ? [item.automationTaskId] : []) } } });
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
    await prisma.$disconnect();
  }
}

void main().catch((error) => { console.error(error instanceof Error ? error.stack : "beauty_daily_brief_database_smoke_failed"); process.exitCode = 1; });

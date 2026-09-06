import assert from "node:assert/strict";

if (process.env.DATA_MODE !== "database" || !process.env.DATABASE_URL?.includes("/beauty_industry_acceptance_20260821")) throw new Error("beauty_daily_brief_postflight_database_invalid");

async function main() {
  const [{ prisma }, contract] = await Promise.all([
    import("../packages/db/src/index.js"),
    import("../apps/api/src/products/beauty-industry/daily-brief-contract.js")
  ]);
  const grantId = process.env.BEAUTY_DAILY_BRIEF_MANUAL_ACCEPTANCE_GRANT_ID?.trim() ?? "";
  try {
    const task = await prisma.automationTask.findUniqueOrThrow({ where: { id: grantId }, include: { logs: true } });
    const payload = task.payload as Record<string, unknown>;
    const businessDate = String(payload.businessDate ?? "");
    const parent = await prisma.beautyDailyBriefSnapshot.findUniqueOrThrow({
      where: { productCode_businessDate_contractVersion: { productCode: "beauty-industry", businessDate, contractVersion: contract.BEAUTY_DAILY_BRIEF_CONTRACT_VERSION } }
    });
    const httpReservations = task.logs.filter((log) => log.message === "BY20_MANUAL_ACCEPTANCE_HTTP_RESERVED");
    const modelReservations = task.logs.filter((log) => log.message === "BY20_MANUAL_ACCEPTANCE_MODEL_RESERVED");
    const dayStart = new Date(`${businessDate}T00:00:00+08:00`);
    const dayEnd = new Date(dayStart.getTime() + 86_400_000);
    const [sameDayManualHttp, sameDayManualModels] = await Promise.all([
      prisma.automationLog.count({ where: { message: "BY20_MANUAL_ACCEPTANCE_HTTP_RESERVED", task: { runAt: { gte: dayStart, lt: dayEnd } } } }),
      prisma.automationLog.count({ where: { message: "BY20_MANUAL_ACCEPTANCE_MODEL_RESERVED", task: { runAt: { gte: dayStart, lt: dayEnd } } } })
    ]);
    const collectionLog = task.logs.find((log) => log.message === "BY20 同日人工终验来源采集完成");
    const agentRuns = await prisma.agentRun.findMany({ where: { tenantId: task.tenantId, requestId: String(payload.runKey ?? "") }, select: { id: true, status: true, modelProvider: true, tokenEstimate: true, creditCost: true } });
    const [transactions, reservations] = await Promise.all([
      prisma.creditTransaction.count({ where: { tenantId: task.tenantId } }),
      prisma.creditReservation.count({ where: { tenantId: task.tenantId } })
    ]);
    assert.equal(payload.oneShot, true);
    assert.equal(payload.productionBudgetInherited, false);
    assert.equal(payload.parentUniqueKey, contract.beautyDailyBriefUniqueKey(businessDate));
    assert.equal(parent.networkRequestCount, 36);
    assert.equal(parent.providerCallCount, 0);
    assert.equal(payload.priorSameDayAuditHttpCount, 94);
    assert.equal(payload.priorManualProviderCallCount, 0);
    assert.ok(httpReservations.length <= 36);
    assert.ok(parent.networkRequestCount + sameDayManualHttp <= 130);
    assert.ok(modelReservations.length <= 1);
    assert.ok(parent.providerCallCount + sameDayManualModels <= 1);
    assert.equal(task.status === "succeeded", agentRuns.length === 1);
    const safeCollection = (collectionLog?.metadata ?? {}) as Record<string, unknown>;
    console.log(JSON.stringify({
      grantId,
      taskStatus: task.status,
      businessDate,
      contractVersion: contract.BEAUTY_DAILY_BRIEF_CONTRACT_VERSION,
      parentUniqueKey: payload.parentUniqueKey,
      parentStatus: parent.status,
      parentNetworkRequests: parent.networkRequestCount,
      additionalNetworkRequests: httpReservations.length,
      sameDayAuditNetworkRequests: parent.networkRequestCount + sameDayManualHttp,
      priorSameDayAuditNetworkRequests: payload.priorSameDayAuditHttpCount,
      modelCalls: modelReservations.length,
      agentRuns,
      creditTransactions: transactions,
      creditReservations: reservations,
      sourceCollection: safeCollection,
      productionBudgetInherited: payload.productionBudgetInherited,
      oneShot: payload.oneShot
    }));
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error(JSON.stringify({ status: "postflight_failed", errorCode: error instanceof Error ? error.message.split(":")[0] : "unknown" }));
  process.exitCode = 1;
});

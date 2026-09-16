// LQ-34 ③④⑤「失败退款演练」离线回归（内存事务夹具，不发外部请求、不碰真实库）。
//
// ③④⑤ 不是「扣一笔钱」，而是**预留-结算**：钱先扣、任务后建、失败要退。这条链路上最贵的错误是
// 「钱扣了没退」「退了两次」「已经退过的 requestId 又白送一次」。本演练把这三件事逐条钉死：
//   ① 原桶退回：扣费跨 paid/bonus 时，退款必须按流水原样退回原桶（不能把 bonus 退成 paid）；
//   ② 同 requestId 只退一次（重复退款幂等，余额不会越退越多）；
//   ③ 已退款同 requestId 不允许重放（否则钱包同键幂等 → 不扣钱白送一次付费执行）；
//   ④ 建任务失败 → 按同一 requestKey 原桶补偿退款，且这次 requestKey 被封（换新单号才能再来）；
//   ⑤ `refund_processing` 中间态可重试收敛（「事务已推进状态、退款前崩溃」再跑一次能补完，且只退一次）；
//   ⑥ 成功不退款（charged 之后晚到的失败回调不能把账改回去）；
//   ⑦ 找不到 owner → fail closed（不扣费、不建任务）；
//   ⑧ 跨租户隔离（另一个门店的钱包分毫未动）+ 操作人留痕（流水 source 带 operator=）；
//   ⑨ 全套走完，旧账（CreditAccount / CreditReservation）一行都没写——兰琪只剩钱包一本账。
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  chargeLanqiWallet,
  readLanqiWalletBalance,
  refundLanqiWallet
} from "../apps/api/src/services/lanqi-wallet.js";
import { createReplicationRepository, ReplicationError } from "../apps/api/src/services/viral-video-replication-runtime.js";
import { replicationSchema } from "../apps/api/src/services/viral-video-replication.js";
import { replicationMemoryDb } from "./fixtures/replication-test-db.js";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    pass += 1;
    console.log(`ok - ${name}`);
  } else {
    fail += 1;
    console.error(`FAIL - ${name}${detail ? ` :: ${detail}` : ""}`);
  }
}

const suffix = randomUUID().slice(0, 8);
const sha = (char: string) => char.repeat(64);

async function seedStore(db: any, label: string, seat: { owner?: boolean; paid?: number; bonus?: number }) {
  const tenantId = `drill-${label}-${suffix}`;
  const userId = `drill-user-${label}-${suffix}`;
  const storeId = `drill-store-${label}-${suffix}`;
  await db.tenant.create({ data: { id: tenantId, name: "Synthetic", type: "local_business" } });
  await db.user.create({ data: { id: userId, nickname: "Synthetic" } });
  await db.store.create({ data: { id: storeId, tenantId, name: "Synthetic" } });
  // LQ-34：付费主体是租户 owner；`owner:false` 用来演练「没有可扣费的老板账号」。
  await db.membership.create({
    data: { tenantId, userId, storeId, role: seat.owner === false ? "staff" : "owner", isActive: true }
  });
  if (seat.paid || seat.bonus) {
    await db.wallet.create({ data: { userId, paidBalance: seat.paid ?? 0, bonusBalance: seat.bonus ?? 0 } });
  }
  return { tenantId, userId, storeId };
}

function admissionFor(actor: { tenantId: string; userId: string; storeId: string }, creditCost: number) {
  return {
    tenantId: actor.tenantId,
    userId: actor.userId,
    storeId: actor.storeId,
    productCode: "lanqi",
    entitlement: true,
    allowedStoreIds: [actor.storeId],
    reference: { fileId: "synthetic-reference", sha256: sha("a") },
    portrait: { fileId: "synthetic-portrait", sha256: sha("b") },
    creditCost,
    maxCostFen: 120,
    maxOutputSeconds: 2,
    stagingReady: true
  } as any;
}

function inputFor() {
  return replicationSchema.parse({
    model: "aliyun_strict",
    referenceFileId: "synthetic-reference",
    portraitFileId: "synthetic-portrait",
    requestKey: randomUUID(),
    visualRightsConfirmed: true,
    audioRightsConfirmed: true,
    performerConsentConfirmed: true,
    portraitConsentConfirmed: true
  });
}

const artifact = {
  sha256: sha("c"),
  bytes: 1024,
  width: 240,
  height: 320,
  durationSeconds: 2,
  storageKey: "synthetic/success.mp4",
  codec: "h264" as const
};

async function callRefund(fn: () => Promise<unknown>) {
  try {
    await fn();
    return undefined;
  } catch (error) {
    return error as ReplicationError;
  }
}

async function main() {
  const db = replicationMemoryDb();
  const repo = createReplicationRepository(db);
  const now = Date.now();
  const balanceOf = async (tenantId: string) => (await readLanqiWalletBalance(tenantId, db))?.balance ?? null;
  const refundRows = (userId: string) => db.walletLedger.findMany({ where: { userId, type: "refund" } });
  const consumeRows = (userId: string) => db.walletLedger.findMany({ where: { userId, type: "consume" } });

  const crossBucket = await seedStore(db, "cross", { paid: 60, bonus: 40 });
  const healthy = await seedStore(db, "healthy", { paid: 1000 });
  const failing = await seedStore(db, "failing", { paid: 30, bonus: 70 });
  const crashy = await seedStore(db, "crashy", { paid: 100 });
  const insertFail = await seedStore(db, "insertfail", { paid: 100 });
  const noOwner = await seedStore(db, "noowner", { owner: false });
  const other = await seedStore(db, "other", { paid: 500 });

  // ① 原桶退回：扣费跨 paid/bonus 两桶（60 + 40），退款必须原桶退回，不能把 bonus 退成 paid。
  const crossRequest = "drill-cross-bucket";
  const crossCharge = await chargeLanqiWallet({
    tenantId: crossBucket.tenantId, operatorUserId: "staff-operator-drill", requestId: crossRequest,
    credits: 100, skillId: "lanqi_video_replication", db
  });
  check(
    "① 扣费跨桶：paid 60 + bonus 40，余额归零",
    crossCharge.status === "completed" && crossCharge.spent.paid === 60 && crossCharge.spent.bonus === 40 && crossCharge.wallet.balance === 0,
    JSON.stringify(crossCharge).slice(0, 200)
  );
  const crossRefund = await refundLanqiWallet({ tenantId: crossBucket.tenantId, requestId: crossRequest, skillId: "lanqi_video_replication", reason: "drill_provider_failed", db });
  check(
    "① 退款按原桶退回：paid 60 / bonus 40 各回各桶",
    crossRefund.status === "refunded" && crossRefund.refunded === 100 &&
      crossRefund.wallet.paidBalance === 60 && crossRefund.wallet.bonusBalance === 40 && crossRefund.wallet.balance === 100,
    JSON.stringify(crossRefund).slice(0, 200)
  );
  const crossRows = await refundRows(crossBucket.userId);
  check(
    "① 退款流水两条、分桶、带原因（可对账）",
    crossRows.length === 2 &&
      crossRows.some((r: any) => r.bucket === "paid" && r.delta === 60) &&
      crossRows.some((r: any) => r.bucket === "bonus" && r.delta === 40) &&
      crossRows.every((r: any) => String(r.source).startsWith("lanqi:") && String(r.source).includes("drill_provider_failed")),
    JSON.stringify(crossRows)
  );

  // ② 同 requestId 只退一次：重复退款幂等，余额不会越退越多。
  const crossRefundAgain = await refundLanqiWallet({ tenantId: crossBucket.tenantId, requestId: crossRequest, skillId: "lanqi_video_replication", db });
  check(
    "② 重复退款幂等：refunded=0 且余额不变",
    crossRefundAgain.status === "refunded" && crossRefundAgain.idempotent === true &&
      crossRefundAgain.refunded === 0 && crossRefundAgain.wallet.balance === 100 &&
      (await refundRows(crossBucket.userId)).length === 2,
    JSON.stringify(crossRefundAgain).slice(0, 200)
  );

  // ③ 已退款同 requestId 不能重放：否则钱包同键幂等 → 不扣钱白送一次付费执行。
  const replayCharge = await chargeLanqiWallet({
    tenantId: crossBucket.tenantId, requestId: crossRequest, credits: 100, skillId: "lanqi_video_replication", db
  });
  check("③ 已退款 requestId 再扣费：显式 refunded，不放行", replayCharge.status === "refunded", JSON.stringify(replayCharge));
  check("③ 已退款 requestId 余额未被再次扣减", (await balanceOf(crossBucket.tenantId)) === 100);
  const replayJobInput = inputFor();
  const replayAdmission = admissionFor(crossBucket, 100);
  // 造一条「已扣已退」的流水：扣 100 → 退 100（余额回到 100），这个 requestKey 从此不许再放行。
  await chargeLanqiWallet({ tenantId: crossBucket.tenantId, requestId: replayJobInput.requestKey, credits: 100, skillId: "lanqi_video_replication", db });
  await refundLanqiWallet({ tenantId: crossBucket.tenantId, requestId: replayJobInput.requestKey, skillId: "lanqi_video_replication", reason: "drill_rolled_back", db });
  const replayError = await callRefund(() => repo.create(replayAdmission, replayJobInput, now));
  check(
    "③ 建任务侧同键已退款 → request_already_refunded 409（不放行、不建任务）",
    replayError instanceof ReplicationError && replayError.code === "request_already_refunded" && replayError.statusCode === 409 &&
      (await db.viralVideoReplicationJob.count({ where: { tenantId: crossBucket.tenantId, requestKey: replayJobInput.requestKey } })) === 0,
    String(replayError)
  );
  check("③ 已退款重放后余额不变（没有白扣也没有白送）", (await balanceOf(crossBucket.tenantId)) === 100);

  // ④ 找不到 owner → fail closed：不扣费、不建任务（宁可报错也不扣到别人头上）。
  const noOwnerInput = inputFor();
  const blocked = await callRefund(() => repo.create(admissionFor(noOwner, 100), noOwnerInput, now));
  check(
    "④ 找不到 owner → lanqi_wallet_owner_missing（不建任务、不放行）",
    blocked instanceof ReplicationError && blocked.code === "lanqi_wallet_owner_missing" &&
      (await db.viralVideoReplicationJob.count({ where: { tenantId: noOwner.tenantId } })) === 0 &&
      (await balanceOf(noOwner.tenantId)) === null,
    String(blocked)
  );

  // ⑤ 成功不退款：先扣（reserved）→ 出片成功（charged），晚到的失败回调不能把账改回去。
  const okInput = inputFor();
  const okAdmission = admissionFor(healthy, 100);
  const first = await repo.create(okAdmission, okInput, now);
  check(
    "⑤ 建任务成功：先扣费（1000 → 900）、任务处于 reserved",
    first.created === true && first.job.billingStatus === "reserved" && (await balanceOf(healthy.tenantId)) === 900,
    JSON.stringify({ status: first.job.billingStatus, balance: await balanceOf(healthy.tenantId) })
  );
  const replaySame = await repo.create(okAdmission, okInput, now);
  check(
    "⑤ 同 requestKey 重放不重复扣费（返回既有任务）",
    replaySame.created === false && replaySame.job.id === first.job.id && (await balanceOf(healthy.tenantId)) === 900 &&
      (await consumeRows(healthy.userId)).length === 1,
    JSON.stringify({ created: replaySame.created, balance: await balanceOf(healthy.tenantId) })
  );
  const okSnapshot = await db.viralVideoReplicationJob.findUnique({ where: { id: first.job.id } });
  await repo.finish(okSnapshot, "succeeded", undefined, artifact);
  check(
    "⑤ 出片成功 → charged，且不产生退款（900 保持）",
    (await db.viralVideoReplicationJob.findUnique({ where: { id: first.job.id } })).billingStatus === "charged" &&
      (await balanceOf(healthy.tenantId)) === 900 && (await refundRows(healthy.userId)).length === 0,
    JSON.stringify({ billingStatus: (await db.viralVideoReplicationJob.findUnique({ where: { id: first.job.id } })).billingStatus, balance: await balanceOf(healthy.tenantId) })
  );
  await repo.finish({ ...okSnapshot, status: "failed" } as any, "failed", "late_worker_callback");
  check(
    "⑤ 结算成功后晚到的失败回调不回退账",
    (await db.viralVideoReplicationJob.findUnique({ where: { id: first.job.id } })).billingStatus === "charged" &&
      (await balanceOf(healthy.tenantId)) === 900 && (await refundRows(healthy.userId)).length === 0
  );

  // ⑥ 失败退款（原桶）且只退一次：扣 30 paid + 70 bonus，失败必须原桶退回并封住这一次。
  const failInput = inputFor();
  const failAdmission = admissionFor(failing, 100);
  const failingJob = await repo.create(failAdmission, failInput, now);
  check(
    "⑥ 失败演练：先扣费（100 → 0，paid 30 / bonus 70）",
    failingJob.created === true && (await balanceOf(failing.tenantId)) === 0,
    JSON.stringify({ balance: await balanceOf(failing.tenantId) })
  );
  const failingSnapshot = await db.viralVideoReplicationJob.findUnique({ where: { id: failingJob.job.id } });
  await repo.finish(failingSnapshot, "failed", "synthetic_provider_failed");
  const failingAfter = await db.viralVideoReplicationJob.findUnique({ where: { id: failingJob.job.id } });
  const failingRows = await refundRows(failing.userId);
  check(
    "⑥ 失败 → 原桶退回（paid 30 / bonus 70 归位）+ 任务 refunded",
    failingAfter.billingStatus === "refunded" && (await balanceOf(failing.tenantId)) === 100 &&
      failingRows.length === 2 &&
      failingRows.some((r: any) => r.bucket === "paid" && r.delta === 30) &&
      failingRows.some((r: any) => r.bucket === "bonus" && r.delta === 70),
    JSON.stringify({ billingStatus: failingAfter.billingStatus, balance: await balanceOf(failing.tenantId), failingRows })
  );
  await repo.finish(failingSnapshot, "failed", "synthetic_provider_failed");
  check(
    "⑥ 重复结算不重复退款（余额 100、退款流水仍 2 条）",
    (await balanceOf(failing.tenantId)) === 100 && (await refundRows(failing.userId)).length === 2
  );

  // ⑦ refund_processing 中间态可重试收敛：模拟「状态已推进、退款调用前进程崩溃」。
  const crashInput = inputFor();
  const crashJob = await repo.create(admissionFor(crashy, 100), crashInput, now);
  await db.viralVideoReplicationJob.update({
    where: { id: crashJob.job.id },
    data: { status: "failed", billingStatus: "refund_processing", errorCode: "synthetic_crash_before_refund" }
  });
  check(
    "⑦ 崩溃现场：任务停在 refund_processing、钱还没退",
    (await refundRows(crashy.userId)).length === 0 && (await balanceOf(crashy.tenantId)) === 0
  );
  const crashSnapshot = await db.viralVideoReplicationJob.findUnique({ where: { id: crashJob.job.id } });
  await repo.finish(crashSnapshot, "failed", "worker_restart_retry");
  const crashAfter = await db.viralVideoReplicationJob.findUnique({ where: { id: crashJob.job.id } });
  check(
    "⑦ 重试收敛：补完退款并置 refunded（余额 0 → 100）",
    crashAfter.billingStatus === "refunded" && (await balanceOf(crashy.tenantId)) === 100 && (await refundRows(crashy.userId)).length === 1,
    JSON.stringify({ billingStatus: crashAfter.billingStatus, balance: await balanceOf(crashy.tenantId), refunds: (await refundRows(crashy.userId)).length })
  );
  await repo.finish(crashSnapshot, "failed", "worker_restart_retry");
  check(
    "⑦ 收敛后再跑不重复退款（余额 100、退款流水 1 条）",
    (await balanceOf(crashy.tenantId)) === 100 && (await refundRows(crashy.userId)).length === 1
  );

  // ⑧ 建任务失败 → 补偿退款，且这次 requestKey 被封（换新单号才能再来）。
  const insertInput = inputFor();
  const originalCreate = db.viralVideoReplicationJob.create;
  db.viralVideoReplicationJob.create = async () => {
    throw Object.assign(new Error("synthetic_job_insert_failed"), { code: "P2034" });
  };
  const insertError = await callRefund(() => repo.create(admissionFor(insertFail, 100), insertInput, now));
  db.viralVideoReplicationJob.create = originalCreate;
  check(
    "⑧ 建任务失败 → 按同一 requestKey 补偿退款（余额 100 → 0 → 100）",
    insertError instanceof ReplicationError && insertError.code === "concurrent_request_conflict" &&
      (await balanceOf(insertFail.tenantId)) === 100 && (await refundRows(insertFail.userId)).length === 1,
    JSON.stringify({ error: String(insertError), balance: await balanceOf(insertFail.tenantId) })
  );
  const insertRetry = await callRefund(() => repo.create(admissionFor(insertFail, 100), insertInput, now));
  check(
    "⑧ 已补偿退款的 requestKey 不允许再次白跑（request_already_refunded）",
    insertRetry instanceof ReplicationError && insertRetry.code === "request_already_refunded" &&
      (await balanceOf(insertFail.tenantId)) === 100 &&
      (await db.viralVideoReplicationJob.count({ where: { tenantId: insertFail.tenantId } })) === 0,
    String(insertRetry)
  );

  // ⑨ 跨租户隔离 + 操作人留痕 + 旧账零写入。
  check(
    "⑨ 跨租户隔离：另一个门店的钱包分毫未动（500）",
    (await balanceOf(other.tenantId)) === 500,
    JSON.stringify(await readLanqiWalletBalance(other.tenantId, db))
  );
  const consumes = await consumeRows(healthy.userId);
  check(
    "⑨ 操作人留痕：扣费流水 source 带 operator=<谁操作的>",
    consumes.length === 1 && String(consumes[0].source).includes("operator=") && String(consumes[0].source).startsWith("lanqi:"),
    JSON.stringify(consumes)
  );
  check(
    "⑨ 只留一本账：全套演练没写旧账（creditAccount / creditReservation 均 0 行）",
    (await db.creditAccount.count()) === 0 && (await db.creditReservation.count()) === 0,
    JSON.stringify({ creditAccount: await db.creditAccount.count(), creditReservation: await db.creditReservation.count() })
  );
  check(
    "⑨ 任务账状态口径齐全：charged / refunded 各就各位",
    (await db.viralVideoReplicationJob.count({ where: { billingStatus: "charged" } })) === 1 &&
      (await db.viralVideoReplicationJob.count({ where: { billingStatus: "refunded" } })) === 2,
    JSON.stringify({
      charged: await db.viralVideoReplicationJob.count({ where: { billingStatus: "charged" } }),
      refunded: await db.viralVideoReplicationJob.count({ where: { billingStatus: "refunded" } }),
      all: await db.viralVideoReplicationJob.count()
    })
  );
}

main()
  .catch((error) => {
    fail += 1;
    console.error("FAIL - 未捕获异常", error);
  })
  .finally(() => {
    assert.ok(true);
    console.log(
      JSON.stringify({
        result: fail === 0 ? "LANQI_WALLET_REFUND_DRILL_PASS" : "LANQI_WALLET_REFUND_DRILL_FAIL",
        passed: pass,
        failed: fail,
        db: "transactional_fixture",
        externalCalls: 0,
        providerCalls: 0,
        costYuan: 0
      })
    );
    process.exit(fail === 0 ? 0 : 1);
  });

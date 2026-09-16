import { createHash } from "node:crypto";
import { chargeLanqiWallet, refundLanqiWallet } from "./lanqi-wallet.js";
import { REPLICATION_CONTRACT, REPLICATION_MODEL, ReplicationProviderError, validateDirectAssetUrl, validateReplicationAdmission, type ReplicationAdmission, type ReplicationRequest } from "./viral-video-replication.js";

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const requestFingerprint=(a:ReplicationAdmission,input:ReplicationRequest)=>digest({version:REPLICATION_CONTRACT,userId:a.userId,storeId:a.storeId,input,reference:a.reference.sha256,portrait:a.portrait.sha256,creditCost:a.creditCost,maxCostFen:a.maxCostFen});
const terminal = new Set(["succeeded", "failed", "terminal_unknown", "canceled"]);
export class ReplicationError extends Error {
  constructor(public readonly code: string, public readonly statusCode = 409) { super(code); }
}
export type ReplicationJob = {
  id: string; tenantId: string; userId?: string | null; requestKey: string; model: string; status: string;
  creditCost: number; billingStatus: string; providerTaskId?: string | null; providerStatus?: string | null;
  outputVideoUrl?: string | null; errorCode?: string | null; updatedAt: Date; createdAt: Date;
  authorizationSnapshot: any;
};
export type ReplicationArtifact = { sha256: string; bytes: number; width: number; height: number; durationSeconds: number; storageKey: string; codec: "h264" };

/** Existing Prisma job + CreditReservation tables. No new process-local queue or business database. */
export function createReplicationRepository(db: any) {
  const transaction = <T>(fn: (tx: any) => Promise<T>): Promise<T> => db.$transaction(fn, { isolationLevel: "Serializable" });
  return {
    async findRequest(a:ReplicationAdmission,input:ReplicationRequest):Promise<ReplicationJob|null>{
      if(!input.requestKey)return null;
      const old=await db.viralVideoReplicationJob.findFirst({where:{tenantId:a.tenantId,requestKey:input.requestKey}});
      if(old&&(old.authorizationSnapshot?.fingerprint!==requestFingerprint(a,input)||old.userId!==a.userId))throw new ReplicationError("idempotency_conflict");
      return old;
    },
    async create(a: ReplicationAdmission, input: ReplicationRequest, now: number): Promise<{ job: ReplicationJob; created: boolean }> {
      if (!input.requestKey) throw new ReplicationError("idempotency_key_required", 400);
      const fingerprint = requestFingerprint(a,input);
      // LQ-34 ③：扣费主体 = **租户 owner 的通用钱包**（不再读写 creditAccount / CreditReservation）。
      // 两阶段：① 事务外扣费（幂等键 = 本次 requestKey）；② 事务内只建 job；③ 事务失败按同一 requestKey 原桶退回。
      // 扣费必须在事务外：`consumeWalletCredits` / `refundWalletCredits` 各自开事务，嵌进来就是两层事务。
      // 先看 job 是否已存在：重放（并发/重复点击）不重复扣费，也不会被"已退款"拦截误伤。
      const existing = await db.viralVideoReplicationJob.findFirst({ where: { tenantId: a.tenantId, requestKey: input.requestKey } });
      if (existing) {
        if (existing.authorizationSnapshot?.fingerprint !== fingerprint || existing.userId !== a.userId) throw new ReplicationError("idempotency_conflict");
        return { job: existing, created: false };
      }
      const charge = await chargeLanqiWallet({ tenantId: a.tenantId, operatorUserId: a.userId, requestId: input.requestKey, credits: a.creditCost, skillId: "lanqi_video_replication", db });
      if (charge.status === "owner_missing") throw new ReplicationError("lanqi_wallet_owner_missing", 409);
      if (charge.status === "insufficient") throw new ReplicationError("insufficient_credits", 402);
      // 同键此前已退款：不能再放行（否则会因为钱包同键幂等而白送一次付费执行）。
      if (charge.status === "refunded") throw new ReplicationError("request_already_refunded", 409);
      try {
        return await transaction(async tx => {
          const old = await tx.viralVideoReplicationJob.findFirst({ where: { tenantId: a.tenantId, requestKey: input.requestKey } });
          if (old) {
            if (old.authorizationSnapshot?.fingerprint !== fingerprint || old.userId !== a.userId) throw new ReplicationError("idempotency_conflict");
            return { job: old, created: false };
          }
          // 预留-结算的角色由 job.billingStatus 承担：reserved → charged（成功）/ refund_processing → refunded（失败已退）。
          const snapshot = { contractVersion: REPLICATION_CONTRACT, fingerprint, storeId: a.storeId, template: input.template, mode: input.mode, request: input, reference: a.reference, portrait: a.portrait, ...(a.stagingLeaseId?{stagingLeaseId:a.stagingLeaseId}:{}), ...(a.executionPermitId?{executionPermitId:a.executionPermitId}:{}), maxCostFen: a.maxCostFen, maxOutputSeconds: a.maxOutputSeconds, pollCount: 0, nextPollAt: now, deadline: now + 24*60*60_000 };
          const job = await tx.viralVideoReplicationJob.create({ data: { tenantId: a.tenantId, userId: a.userId, requestKey: input.requestKey, model: REPLICATION_MODEL, creditCost: a.creditCost, referenceFileId: input.referenceFileId, portraitFileId: input.portraitFileId, authorizationSnapshot: snapshot, status: "queued", billingStatus: "reserved" } });
          return { job, created: true };
        });
      } catch (error) {
        // A losing concurrent transaction may replay an already committed job, never submit again.
        const old = await db.viralVideoReplicationJob.findFirst({ where: { tenantId: a.tenantId, requestKey: input.requestKey } });
        if (old?.authorizationSnapshot?.fingerprint === fingerprint && old.userId === a.userId) return { job: old, created: false };
        if (old) throw new ReplicationError("idempotency_conflict");
        // 钱扣了但任务没落地：按同一 requestKey **原桶退回**（钱包侧同键只退一次）；
        // 这条 requestKey 随后会被 `chargeLanqiWallet` 判为已退款而拒绝重放，必须换新的 requestId 才能再来一次。
        await refundLanqiWallet({ tenantId: a.tenantId, requestId: input.requestKey, skillId: "lanqi_video_replication", reason: "replication_create_failed", db });
        if (["P2002", "P2034"].includes((error as any)?.code)) throw new ReplicationError("concurrent_request_conflict");
        throw error;
      }
    },
    async get(id: string, tenantId: string): Promise<ReplicationJob | null> { return db.viralVideoReplicationJob.findFirst({ where: { id, tenantId } }); },
    async list(tenantId: string, userId?:string): Promise<ReplicationJob[]> { return db.viralVideoReplicationJob.findMany({ where: { tenantId,...(userId?{userId}:{}) }, orderBy: { createdAt: "desc" }, take: 20 }); },
    async claim(job: ReplicationJob, status: string, now: number): Promise<ReplicationJob | null> {
      const result = await db.viralVideoReplicationJob.updateMany({ where: { id: job.id, tenantId: job.tenantId, status: job.status, updatedAt: job.updatedAt, billingStatus: "reserved" }, data: { status, updatedAt: new Date(now) } });
      return result.count === 1 ? { ...job, status, updatedAt: new Date(now) } : null;
    },
    async update(job: ReplicationJob, data: Record<string, unknown>): Promise<void> {
      const changed = await db.viralVideoReplicationJob.updateMany({ where: { id: job.id, status: job.status, updatedAt: job.updatedAt, billingStatus: "reserved" }, data });
      if (changed.count !== 1) throw new ReplicationError("job_lease_lost");
    },
    async finish(job: ReplicationJob, status: "succeeded" | "failed" | "terminal_unknown" | "canceled", code?: string, artifact?: ReplicationArtifact, providerCostFen?: number): Promise<void> {
      // LQ-34 ③ 两阶段结算：事务内只推进状态（成功 → charged；失败 → refund_processing），
      // 退出事务后再按**原扣费流水原桶退回**（钱包侧同一 requestId 只退一次），最后置 refunded。
      // 「退到一半崩了」时 job 停在 refund_processing，下一次 finish 只把退款补完 —— 可重试收敛，且绝不会退两次。
      const pending = await transaction(async tx => {
        const current = await tx.viralVideoReplicationJob.findUnique({ where: { id: job.id } });
        if (!current) return null;
        if (current.billingStatus === "refund_processing") return { tenantId: current.tenantId, requestKey: current.requestKey, reason: current.errorCode ?? code ?? current.status, refund: true };
        // 终态或已结算：不回退、不覆盖（晚到的回调/worker 不能改写已经成功的账）。
        if (terminal.has(current.status) || current.billingStatus !== "reserved") return null;
        // Completion belongs to the lease holder. Late callbacks/workers cannot overwrite/refund a success.
        if (current.status !== job.status || +current.updatedAt !== +job.updatedAt) throw new ReplicationError("job_lease_lost");
        const success = status === "succeeded";
        if (success && (!artifact || !/^[a-f0-9]{64}$/.test(artifact.sha256) || artifact.codec !== "h264")) throw new ReplicationError("artifact_verification_required");
        await tx.viralVideoReplicationJob.update({ where: { id: job.id }, data: { status, billingStatus: success ? "charged" : "refund_processing", errorCode: code ?? null, outputVideoUrl: null, completedAt: new Date(), authorizationSnapshot: { ...current.authorizationSnapshot, ...(artifact ? { artifact } : {}), ...(providerCostFen !== undefined ? { providerCostFen } : {}), providerRefundClaimed: false } } });
        return { tenantId: current.tenantId, requestKey: current.requestKey, reason: code ?? status, refund: !success };
      });
      if (!pending?.refund) return;
      const refund = await refundLanqiWallet({ tenantId: pending.tenantId, requestId: pending.requestKey, skillId: "lanqi_video_replication", reason: pending.reason, db });
      // 找不到可退的主体（owner 缺失）时保留 refund_processing：不要假装已经退过，留待人工/后续重试。
      if (refund.status === "owner_missing") throw new ReplicationError("lanqi_wallet_owner_missing", 409);
      await transaction(async tx => {
        await tx.viralVideoReplicationJob.updateMany({ where: { id: job.id, billingStatus: "refund_processing" }, data: { billingStatus: "refunded" } });
      });
    }
  };
}

export type ReplicationRuntimePorts = {
  repository: ReturnType<typeof createReplicationRepository>;
  stage(a: ReplicationAdmission, input: ReplicationRequest): Promise<{ referenceVideoUrl: string; portraitImageUrl: string; release(): Promise<void>; leaseId?:string; assertScope?():Promise<void> }>;
  authorize?(a:ReplicationAdmission,phase:"before_stage"|"before_reserve"|"before_submit"|"read",job?:ReplicationJob):Promise<void>;
  cleanup?(job:ReplicationJob):Promise<void>;
  control?: {claim(a:ReplicationAdmission,input:ReplicationRequest):Promise<void>;beforeSubmit(job:ReplicationJob):Promise<void>};
  submit(input: { referenceVideoUrl: string; portraitImageUrl: string; mode: "wan-std" | "wan-pro" },job:ReplicationJob): Promise<string>;
  poll(taskId: string,job:ReplicationJob): Promise<{ status: string; videoUrl?: string; seconds?: number }>;
  persist(job: ReplicationJob, url: string): Promise<ReplicationArtifact>;
  read(artifact: ReplicationArtifact, job: ReplicationJob): Promise<Buffer>;
  now?: () => number;
};

export function createReplicationRuntime(ports: ReplicationRuntimePorts) {
  const repo = ports.repository, now = ports.now ?? Date.now;
  const owned = async (id: string, a: ReplicationAdmission) => {
    const j = await repo.get(id, a.tenantId);
    if (!j || j.authorizationSnapshot?.contractVersion !== REPLICATION_CONTRACT || j.authorizationSnapshot.storeId !== a.storeId || j.userId !== a.userId || !a.entitlement || !a.allowedStoreIds.includes(a.storeId)) throw new ReplicationError("job_not_found", 404);
    await ports.authorize?.(a,"read",j);
    return j;
  };
  return {
    async confirm(a: ReplicationAdmission, input: ReplicationRequest) {
      const issues = validateReplicationAdmission(input, a, now());
      if (issues.length) throw new ReplicationError(issues[0], issues[0] === "asset_not_found" ? 404 : 422);
      // Staging before reservation; no private raw URL is persisted in the job or emitted in logs.
      await ports.authorize?.(a,"before_stage");
      const existing=await repo.findRequest(a,input);
      if(existing){await owned(existing.id,a);if(terminal.has(existing.status))await ports.cleanup?.(existing);return {job:publicReplicationJob(existing),idempotent:true};}
      await ports.control?.claim(a,input);
      const staged = await ports.stage(a,input);
      let job: ReplicationJob | undefined;
      let submitted = false;
      try {
        if(staged.assertScope) await staged.assertScope();
        else if (validateDirectAssetUrl(staged.referenceVideoUrl) || validateDirectAssetUrl(staged.portraitImageUrl) || !/\.(mp4|avi|mov)$/i.test(new URL(staged.referenceVideoUrl).pathname) || !/\.(png|jpg|jpeg|bmp|webp)$/i.test(new URL(staged.portraitImageUrl).pathname)) throw new ReplicationError("staged_asset_url_rejected", 422);
        await ports.authorize?.(a,"before_reserve");
        const created = await repo.create({...a,stagingLeaseId:staged.leaseId}, input, now());
        job = created.job;
        if (!created.created) return { job: publicReplicationJob(job), idempotent: true };
        const lease = await repo.claim(job, "submitting", now());
        if (!lease) return { job: publicReplicationJob((await repo.get(job.id, a.tenantId))!), idempotent: true };
        job = lease;
        await ports.authorize?.(a,"before_submit",job);
        await staged.assertScope?.();
        await ports.control?.beforeSubmit(job);
        submitted = true;
        const taskId = await ports.submit({ ...staged, mode: input.mode },job);
        await repo.update(job, { providerTaskId: taskId, providerStatus: "PENDING", status: "submitted" });
      } catch (error) {
        if (job) {
          const unknown = submitted && (!(error instanceof ReplicationProviderError) || error.uncertain);
          await repo.finish(job, unknown ? "terminal_unknown" : "failed", error instanceof ReplicationProviderError||error instanceof ReplicationError ? error.code : submitted ? "submission_persistence_unknown" : "pre_submission_failed");
        } else throw error;
      } finally {
        // Async provider may fetch later. Do not revoke its input while RUNNING or acceptance is unknown.
        // The staging adapter must enforce a <=24h TTL; terminal cleanup is a separate server operation.
        if (!submitted && (!job || terminal.has((await repo.get(job.id,a.tenantId))?.status??""))) await staged.release();
        if(job){const current=await repo.get(job.id,a.tenantId);if(current&&terminal.has(current.status))await ports.cleanup?.(current);}
      }
      return { job: publicReplicationJob((await repo.get(job!.id, a.tenantId))!), idempotent: false };
    },
    async refresh(id: string, a: ReplicationAdmission) {
      let job = await owned(id, a);
      if (terminal.has(job.status)) {await ports.cleanup?.(job);return publicReplicationJob(job);}
      const snapshot = job.authorizationSnapshot;
      if (now() >= snapshot.deadline || snapshot.pollCount >= 240) { await repo.finish(job, "terminal_unknown", "provider_deadline_exceeded"); const current=(await repo.get(id,a.tenantId))!;await ports.cleanup?.(current);return publicReplicationJob(current); }
      if (job.status === "submitting") {
        if (now() - +job.updatedAt > 60_000) {await repo.finish(job, "terminal_unknown", "submission_interrupted_unknown");await ports.cleanup?.((await repo.get(id,a.tenantId))!);}
        return publicReplicationJob((await repo.get(id, a.tenantId))!);
      }
      if (!job.providerTaskId || now() < snapshot.nextPollAt || (["polling", "persisting"].includes(job.status) && now() - +job.updatedAt < 60_000)) return publicReplicationJob(job);
      const lease = await repo.claim(job, "polling", now());
      if (!lease) return publicReplicationJob((await repo.get(id, a.tenantId))!);
      job = lease;
      let observedCostFen: number | undefined;
      try {
        const result = await ports.poll(job.providerTaskId!,job);
        if (["FAILED", "CANCELED", "UNKNOWN"].includes(result.status)) await repo.finish(job, result.status === "UNKNOWN" ? "terminal_unknown" : "failed", `provider_${result.status.toLowerCase()}`);
        else if (result.status === "SUCCEEDED") {
          const cost = Math.ceil((result.seconds ?? Infinity) * (snapshot.mode === "wan-pro" ? 90 : 60));
          if (Number.isSafeInteger(cost) && cost >= 0) observedCostFen = cost;
          if (!result.videoUrl || !Number.isFinite(result.seconds) || result.seconds! < 2 || result.seconds! > snapshot.maxOutputSeconds || cost > snapshot.maxCostFen) throw new ReplicationError("provider_output_contract_failed");
          const artifact = await ports.persist(job, result.videoUrl);
          if (artifact.durationSeconds < 2 || artifact.durationSeconds > snapshot.maxOutputSeconds || Math.abs(artifact.durationSeconds - result.seconds!) > 0.5 || artifact.width < 200 || artifact.height < 200 || artifact.bytes <= 0 || artifact.bytes > 200*1024*1024) throw new ReplicationError("artifact_metadata_invalid");
          await repo.finish(job, "succeeded", undefined, artifact, cost);
        } else if (["PENDING", "RUNNING"].includes(result.status)) {
          await repo.update(job, { status: "processing", providerStatus: result.status, authorizationSnapshot: { ...snapshot, pollCount: snapshot.pollCount + 1, nextPollAt: now() + 15_000 } });
        } else throw new ReplicationError("provider_status_invalid");
      } catch (error) {
        if (error instanceof ReplicationProviderError) {
          // Query is recoverable by explicit refresh of the same task id, never by another submit.
          await repo.update(job, { status: "processing", errorCode: error.code, authorizationSnapshot: { ...snapshot, pollCount: snapshot.pollCount + 1, nextPollAt: now() + 15_000 } });
        } else if (error instanceof ReplicationError && error.code === "job_lease_lost") throw error;
        else await repo.finish(job, error instanceof ReplicationError&&error.code.startsWith("execution_")?"terminal_unknown":"failed", error instanceof ReplicationError ? error.code : "artifact_persistence_failed", undefined, observedCostFen);
      }
      const current=(await repo.get(id,a.tenantId))!;if(terminal.has(current.status))await ports.cleanup?.(current);
      return publicReplicationJob(current);
    },
    async cancel(id: string, a: ReplicationAdmission) {
      const job = await owned(id, a);
      if (terminal.has(job.status)) {await ports.cleanup?.(job);return publicReplicationJob(job);}
      if (job.status !== "queued") throw new ReplicationError("upstream_cancellation_not_supported");
      await repo.finish(job, "canceled", "canceled_before_submit");
      await ports.cleanup?.((await repo.get(id,a.tenantId))!);
      return publicReplicationJob((await repo.get(id, a.tenantId))!);
    },
    async download(id: string, a: ReplicationAdmission): Promise<Buffer> {
      const job = await owned(id, a);
      if (job.status !== "succeeded" || job.billingStatus !== "charged" || !job.authorizationSnapshot.artifact) throw new ReplicationError("asset_not_found", 404);
      return ports.read(job.authorizationSnapshot.artifact, job);
    }
  };
}

export function publicReplicationJob(job: ReplicationJob) {
  const verified = job.authorizationSnapshot?.contractVersion === REPLICATION_CONTRACT;
  const available = verified && job.status === "succeeded" && job.billingStatus === "charged" && Boolean(job.authorizationSnapshot.artifact);
  return { id: job.id, status: verified ? job.status : "legacy_unverified", model: "aliyun_strict", creditCost: job.creditCost, billingStatus: job.billingStatus, errorCode: job.errorCode ?? null, canResubmit: false, canDownload: available, outputVideoUrl: available ? `/viral-video-replication/jobs/${job.id}/content` : null, createdAt: job.createdAt };
}

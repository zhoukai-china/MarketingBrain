import { createHmac, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { buildSeedancePayload, createSeedanceAdapter, seedanceEvidenceSchema, seedanceInputSchema, seedanceUsage,
  SEEDANCE_CONTRACT, SEEDANCE_MODEL, SEEDANCE_PRICE, SEEDANCE_FIRST_PROFILE_ESTIMATE_MICROS,
  SeedanceError, type SeedanceJournal, type SeedanceRow, type SeedanceInput, type SeedanceAuthority } from "./beauty-seedance-adapter.js";
import { createBeautyUsageMeter, usageHash, type UsageActor } from "./beauty-usage-metering.js";
import { createReplicationRepository, type ReplicationJob } from "./viral-video-replication-runtime.js";
import { createReplicationAssetStore } from "./viral-video-replication-assets.js";
import { createVideoPrivateFileReader } from "./beauty-video-private-files.js";
import { createSeedanceHttpsTransport, SEEDANCE_RESULT_ORIGIN, validateSeedanceResultUrl } from "./beauty-seedance-https.js";
import { chargeLanqiWallet, refundLanqiWallet } from "./lanqi-wallet.js";

export const SEEDANCE_EXECUTION_VERSION = "beauty-seedance-execution-v1";
export const SEEDANCE_REVIEW_VERSION = "beauty-seedance-manual-review-v1";
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,120}$/), sha = z.string().regex(/^[a-f0-9]{64}$/);
const money = z.string().regex(/^(0|[1-9]\d{0,11})$/);
const binding = z.object({ fileId: id, reviewId: id, revision: z.number().int().positive(), sha256: sha }).strict();
export const seedanceExecutionScopeSchema = z.object({
  version: z.literal(SEEDANCE_EXECUTION_VERSION), contract: z.literal(SEEDANCE_CONTRACT), permitId: id,
  tenantId: id, userId: id, storeId: id, requestKey: z.string().min(12).max(120), requestHash: sha,
  provider: z.literal("volcengine_ark"), model: z.literal(SEEDANCE_MODEL), purpose: z.literal("seedance_multireference"),
  access: z.enum(["local_only", "provider_https"]), accountBinding: id, references: z.array(binding).length(2),
  priceVersion: z.literal(SEEDANCE_PRICE), unitPriceMicros: z.literal("46"), maxCompletionTokens: z.literal(108000),
  maxCostMicros: money, storageCostUpperMicros: money, costEvidenceHash: sha,
  maxSubmit: z.literal(1), maxPoll: z.number().int().min(1).max(20), maxDownload: z.literal(1),
  creditCost: z.number().int().positive(), quoteVersion: id, quoteEvidenceHash: sha,
  issuedAt: z.number().int(), expiresAt: z.number().int()
}).strict();
export type SeedanceExecutionScope = z.infer<typeof seedanceExecutionScopeSchema>;
export const seedanceReviewSchema = z.object({
  version: z.literal(SEEDANCE_REVIEW_VERSION), reviewId: id, revision: z.number().int().positive(),
  method: z.literal("manual_console_review"), reviewerId: id, reviewedAt: z.number().int(), decision: z.enum(["approved", "revoked"]),
  basisFileId: id, basisSha256: sha, consoleEvidenceHash: sha, evidence: seedanceEvidenceSchema
}).strict();
export const seedanceExecutionRequestHash = (raw: unknown) => usageHash(JSON.stringify(seedanceInputSchema.parse(raw)));
class ExecutionError extends SeedanceError {}
function reject(code: string): never { throw new ExecutionError(`seedance_${code}`); }
function decode<T>(schema: z.ZodType<T>, raw: unknown): T { const p = schema.safeParse(raw); if (!p.success) reject("signed_evidence_invalid"); return p.data; }
function signed<T>(schema: z.ZodType<T>, raw: unknown, signature: string, key: string, domain: string): T {
  const s = decode(schema, raw), expected = createHmac("sha256", key).update(`${domain}:${JSON.stringify(s)}`).digest("hex");
  const a = Buffer.from(String(signature)), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) reject("signature_invalid"); return s;
}
type Options = { db: any; environment: Record<string, string | undefined>; uploadRoot: string; resultRoot: string;
  now?: () => number; offlineTransport?: typeof fetch; offlineResultTransport?: typeof fetch };

/** No permit/review issue endpoint; administrator-reviewed records have independent signing roots.
 * Public Seedance route stays closed. local_only signatures can never authorize a cloud transport. */
export function createSeedanceExecution(options: Options) {
  const env = options.environment, db = options.db, now = options.now ?? Date.now;
  const offline = Boolean(options.offlineTransport || options.offlineResultTransport);
  const access = offline ? "local_only" : "provider_https";
  const configured = env.SEEDANCE_EXECUTION_MODE === "controlled" &&
    [env.SEEDANCE_EXECUTION_AUTHORITY_KEY, env.SEEDANCE_REVIEW_AUTHORITY_KEY].every(k => k && Buffer.byteLength(k) >= 32) &&
    env.SEEDANCE_EXECUTION_AUTHORITY_KEY !== env.SEEDANCE_REVIEW_AUTHORITY_KEY &&
    Boolean(env.ARK_API_KEY && env.ARK_API_KEY.length >= 16 && !/\s/.test(env.ARK_API_KEY)) &&
    ![env.SEEDANCE_EXECUTION_AUTHORITY_KEY, env.SEEDANCE_REVIEW_AUTHORITY_KEY].includes(env.ARK_API_KEY) &&
    Boolean(env.SEEDANCE_ACCOUNT_BINDING && env.SEEDANCE_CREDIT_QUOTE_VERSION && /^[1-9]\d{0,5}$/.test(env.SEEDANCE_CREDIT_COST ?? "")) &&
    path.isAbsolute(options.uploadRoot) && path.isAbsolute(options.resultRoot) &&
    (!offline || Boolean(options.offlineTransport && options.offlineResultTransport));
  const guard = () => { if (!configured) reject("execution_disabled"); };
  const readFile = createVideoPrivateFileReader(options.uploadRoot, path.join(options.resultRoot, ".inspect"));
  const repository = createReplicationRepository(db);
  async function finish(...args: Parameters<typeof repository.finish>) {
    try { await repository.finish(...args); } catch { reject("database_unavailable"); }
  }
  const store = createReplicationAssetStore({ root: options.resultRoot, allowedResultHosts: [new URL(SEEDANCE_RESULT_ORIGIN).hostname],
    fetch: options.offlineResultTransport ?? createSeedanceHttpsTransport("result"), validateUrl: validateSeedanceResultUrl, recoveryReceipt: true });
  async function transaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
    // Only replay rolled-back SQL; never wrap network in a DB retry loop.
    for (let i = 0; ; i++) try { return await db.$transaction(fn, { isolationLevel: "Serializable" }); }
    catch (e: any) { if (["P2034", "P2002"].includes(e?.code) && i < 2) continue; if (e instanceof ExecutionError) throw e; return reject("database_unavailable"); }
  }
  async function currentAccess(tx: any, actor: UsageActor) {
    const member = await tx.membership.findFirst({ where: { ...actor, isActive: true } });
    const entitlement = await tx.tenantProductEntitlement.findFirst({ where: { tenantId: actor.tenantId, productCode: "beauty-industry", status: "active",
      startsAt: { lte: new Date(now()) }, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date(now()) } }] } });
    if (!member || !["owner", "admin", "manager"].includes(member.role) || !entitlement) reject("access_denied");
  }
  function permit(raw: any, actor: UsageActor, requestKey: string) {
    const s = signed(seedanceExecutionScopeSchema, raw?.scope, raw?.signature, env.SEEDANCE_EXECUTION_AUTHORITY_KEY!, SEEDANCE_EXECUTION_VERSION);
    if (s.permitId !== raw.id || s.tenantId !== actor.tenantId || s.userId !== actor.userId || s.storeId !== actor.storeId || s.requestKey !== requestKey ||
      raw.tenantId !== s.tenantId || raw.userId !== s.userId || raw.storeId !== s.storeId || raw.requestKey !== s.requestKey || s.access !== access ||
      s.accountBinding !== env.SEEDANCE_ACCOUNT_BINDING || s.creditCost !== Number(env.SEEDANCE_CREDIT_COST) || s.quoteVersion !== env.SEEDANCE_CREDIT_QUOTE_VERSION ||
      s.expiresAt <= s.issuedAt || s.expiresAt - s.issuedAt > 86400000 || s.issuedAt > now() ||
      BigInt(s.storageCostUpperMicros) <= 0n || BigInt(s.maxCostMicros) < BigInt(SEEDANCE_FIRST_PROFILE_ESTIMATE_MICROS) + BigInt(s.storageCostUpperMicros)) reject("execution_scope_invalid");
    return s;
  }
  function live(row: any, s: SeedanceExecutionScope) { if (row.revokedAt || now() >= s.expiresAt) reject("execution_expired_or_revoked"); }
  async function loadPermit(tx: any, actor: UsageActor, key: string) {
    const row = await tx.beautyVideoExecutionPermit.findFirst({ where: { tenantId: actor.tenantId, userId: actor.userId, requestKey: key } });
    if (!row) reject("execution_permit_required"); return { row, scope: permit(row, actor, key) };
  }
  async function resolve(tx: any, actor: UsageActor, refs: SeedanceInput["references"], s: SeedanceExecutionScope): Promise<SeedanceAuthority> {
    await currentAccess(tx, actor);
    const assets = [];
    for (const ref of refs) {
      const records = await tx.auditLog.findMany({ where: { tenantId: actor.tenantId, userId: actor.userId, action: "seedance.asset_review", resource: SEEDANCE_REVIEW_VERSION, resourceId: ref.fileId }, take: 101 });
      if (!records.length || records.length > 100) reject("asset_review_required");
      const reviews = records.map((r: any) => {
        let data: any; try { data = JSON.parse(r.detail); } catch { reject("signed_evidence_invalid"); }
        const v = signed(seedanceReviewSchema, data.review, data.signature, env.SEEDANCE_REVIEW_AUTHORITY_KEY!, SEEDANCE_REVIEW_VERSION);
        if (r.id !== v.reviewId || v.evidence.fileId !== ref.fileId) reject("asset_review_invalid"); return v;
      }).sort((a: any, b: any) => b.revision - a.revision);
      const review: z.infer<typeof seedanceReviewSchema> = reviews[0];
      if (new Set(reviews.map((r: any) => r.revision)).size !== reviews.length) reject("asset_review_conflict");
      const bound = s.references.find(x => x.fileId === ref.fileId), e = review.evidence;
      if (!bound || review.reviewId !== bound.reviewId || review.revision !== bound.revision || review.decision !== "approved" || review.reviewedAt > now() ||
        e.sha256 !== bound.sha256 || e.delivery !== "ark_asset") reject("asset_review_changed");
      // No HTTPS staging is silently invented: first live profile requires both accepted Ark assets.
      const file = await tx.uploadedFile.findFirst({ where: { id: ref.fileId, tenantId: actor.tenantId, userId: actor.userId } });
      const basis = await tx.uploadedFile.findFirst({ where: { id: review.basisFileId, tenantId: actor.tenantId, userId: actor.userId } });
      if (!file || !basis || basis.sha256 !== review.basisSha256) reject("asset_not_found");
      let inspected: Awaited<ReturnType<typeof readFile>>;
      try { inspected = await readFile(file, "owner"); await readFile(basis, "basis"); } catch { return reject("asset_file_unverified"); }
      if (inspected.sha256 !== e.sha256 || inspected.width !== e.width || inspected.height !== e.height || inspected.mimeType !== e.mime || inspected.bytes.length !== e.bytes) reject("asset_file_changed");
      assets.push(e);
    }
    const authority = { actor, entitlement: true, accountBinding: s.accountBinding, assets };
    buildSeedancePayload({ requestKey: s.requestKey, references: refs, text: "authority check", duration: 5, resolution: "720p", ratio: "9:16", generateAudio: false }, actor, authority, now());
    return authority;
  }
  const usageCall = { step: "video_generation", attempt: 1, provider: "volcengine_ark", model: SEEDANCE_MODEL, mode: offline ? "controlled_mock" as const : "real" as const };
  const meter = (tx: any, actor: UsageActor, s: SeedanceExecutionScope) => createBeautyUsageMeter(tx, actor, s.permitId);
  async function owned(actor: UsageActor, requestKey: string) {
    guard(); await currentAccess(db, actor);
    const job = await db.viralVideoReplicationJob.findFirst({ where: { tenantId: actor.tenantId, userId: actor.userId, requestKey } });
    if (!job || job.model !== SEEDANCE_MODEL || job.authorizationSnapshot?.contractVersion !== SEEDANCE_CONTRACT || job.authorizationSnapshot.storeId !== actor.storeId) reject("task_not_found");
    return job as ReplicationJob;
  }
  function adapter(actor: UsageActor, requestKey: string, input?: SeedanceInput) {
    const journal: SeedanceJournal = { atomic: async (key, update) => {
      if (key !== usageHash(JSON.stringify([SEEDANCE_CONTRACT, actor.tenantId, actor.userId, actor.storeId, requestKey]))) reject("journal_scope_invalid");
      // LQ-34 ④：扣费主体 = **租户 owner 的通用钱包**（不再读写 creditAccount / CreditReservation）。
      // 两阶段：首笔 submit 先把钱包扣掉（幂等键 = 该次 requestKey，可安全重放），
      // 再在 Serializable 事务里提交许可 + 建 job；事务任一步失败都按同一 requestKey 原桶退回。
      // 扣费刻意留在 `transaction()` 的重试环**之外**：P2034/P2002 重放时钱包同键本就幂等，不会重复扣。
      const known = await db.viralVideoReplicationJob.findFirst({ where: { tenantId: actor.tenantId, userId: actor.userId, requestKey } });
      const settled = Boolean(known?.authorizationSnapshot?.journal);
      if (!settled && !known) {
        const permitRow = await db.beautyVideoExecutionPermit.findFirst({ where: { tenantId: actor.tenantId, userId: actor.userId, requestKey } });
        if (permitRow) {
          // 许可里的 creditCost 由签名保护；签名不合法会在扣费前就 reject。
          const scope = permit(permitRow, actor, requestKey);
          const charge = await chargeLanqiWallet({ tenantId: actor.tenantId, operatorUserId: actor.userId, requestId: requestKey, credits: scope.creditCost, skillId: "lanqi_seedance", db });
          if (charge.status === "owner_missing") reject("wallet_owner_missing");
          if (charge.status === "insufficient") reject("insufficient_credits");
          // 同键此前已退款：不能再放行（否则会因为钱包同键幂等而白送一次付费执行）。
          if (charge.status === "refunded") reject("request_refunded");
        }
      }
      try {
        return await transaction(async tx => {
          const { row: p, scope: s } = await loadPermit(tx, actor, requestKey);
          const job = await tx.viralVideoReplicationJob.findFirst({ where: { tenantId: actor.tenantId, requestKey } });
          if (job && (job.userId !== actor.userId || job.model !== SEEDANCE_MODEL || job.authorizationSnapshot?.permitId !== s.permitId)) reject("task_not_found");
          const previous = (job?.authorizationSnapshot?.journal ?? null) as SeedanceRow | null;
          const next = update(previous ? structuredClone(previous) : null);
          if (!next.row || JSON.stringify(next.row) === JSON.stringify(previous)) return next.value;
          const submit = !previous, poll = previous && next.row.pollCount > previous.pollCount;
          if (submit || poll) {
            live(p, s); const refs = input?.references ?? next.row.references;
            const a = await resolve(tx, actor, refs, s);
            buildSeedancePayload(input ?? { requestKey, references: refs, text: "authority check", duration: 5, resolution: "720p", ratio: "9:16", generateAudio: false }, actor, a, now());
          }
          if (submit) {
            if (!input || s.requestHash !== seedanceExecutionRequestHash(input) || p.status !== "approved" || p.submitCount !== 0 || p.committedCostFen !== 0) reject("batch_already_consumed");
            await tx.beautyVideoExecutionPermit.update({ where: { id: s.permitId }, data: { status: "claimed", submitCount: 1, committedCostFen: Number((BigInt(s.maxCostMicros) + 9999n) / 10000n), claimedAt: new Date(now()), lastCode: "seedance_submit_committed" } });
            await tx.viralVideoReplicationJob.create({ data: { tenantId: actor.tenantId, userId: actor.userId, requestKey, model: SEEDANCE_MODEL, creditCost: s.creditCost, status: "submitting", billingStatus: "reserved",
              authorizationSnapshot: { contractVersion: SEEDANCE_CONTRACT, storeId: actor.storeId, permitId: s.permitId,
                requestHash: s.requestHash, committedCostMicros: s.maxCostMicros, maxOutputSeconds: 5, journal: next.row } } });
            await meter(tx, actor, s).begin(usageCall, seedanceUsage(null).measures);
          } else {
            if (poll) {
              if (p.pollCount >= s.maxPoll || next.row.pollCount !== p.pollCount + 1) reject("poll_budget_exhausted");
              await tx.beautyVideoExecutionPermit.update({ where: { id: s.permitId }, data: { pollCount: { increment: 1 }, lastCode: "seedance_get_committed" } });
            }
            await tx.viralVideoReplicationJob.update({ where: { id: job.id }, data: { providerTaskId: next.row.taskId ?? null, providerStatus: next.row.status,
              status: ["succeeded", "failed", "terminal_unknown"].includes(job.status) ? job.status : next.row.taskId ? "processing" : "submitting",
              authorizationSnapshot: { ...job.authorizationSnapshot, journal: next.row } } });
            if (next.row.events.length > previous!.events.length) {
              const event = next.row.events.at(-1)!;
              await meter(tx, actor, s).observe(usageCall, { status: next.row.status === "queued" || next.row.status === "running" ? "pending" : next.row.status === "expired" ? "failed" : next.row.status,
                code: event.code, providerRequestFingerprint: event.taskFingerprint ?? null, measures: next.row.usage.measures });
              await tx.auditLog.create({ data: { tenantId: actor.tenantId, userId: actor.userId, action: "seedance.protocol", resource: SEEDANCE_EXECUTION_VERSION, resourceId: s.permitId, detail: JSON.stringify(event) } });
            }
          }
          return next.value;
        });
      } catch (error) {
        // 钱已经扣了但任务没落地：按同一 requestKey 原桶退回（幂等）。若同键 job 已经存在，
        // 说明这次 submit 不是我们完成的，不能退走别人的账（钱包侧同键本就只扣一次）。
        if (!settled && !(await db.viralVideoReplicationJob.findFirst({ where: { tenantId: actor.tenantId, userId: actor.userId, requestKey } }))) {
          await refundLanqiWallet({ tenantId: actor.tenantId, requestId: requestKey, skillId: "lanqi_seedance", reason: "seedance_submit_failed", db });
        }
        throw error;
      }
    } };
    return createSeedanceAdapter({ mode: offline ? "fixture" : "controlled", apiKey: env.ARK_API_KEY, journal, now,
      transport: options.offlineTransport ?? createSeedanceHttpsTransport("api"),
      resolve: async (a, refs) => { const { row, scope } = await loadPermit(db, a, requestKey); live(row, scope); return resolve(db, a, refs, scope); } });
  }
  const visible = (job: ReplicationJob) => ({ id: job.id, status: job.status, billingStatus: job.billingStatus, errorCode: job.errorCode ?? null,
    canDownload: job.status === "succeeded" && job.billingStatus === "charged" && Boolean(job.authorizationSnapshot.artifact), creditCost: job.creditCost });
  return {
    enabled: Boolean(configured),
    async confirm(actor: UsageActor, raw: unknown) {
      guard(); const p = seedanceInputSchema.safeParse(raw); if (!p.success) reject("input_invalid");
      const { row, scope } = await loadPermit(db, actor, p.data.requestKey); live(row, scope);
      if (scope.requestHash !== seedanceExecutionRequestHash(p.data)) reject("request_scope_mismatch");
      await resolve(db, actor, p.data.references, scope);
      await adapter(actor, p.data.requestKey, p.data).submit(actor, p.data); return visible(await owned(actor, p.data.requestKey));
    },
    async refresh(actor: UsageActor, requestKey: string) {
      let job = await owned(actor, requestKey); if (["succeeded", "failed", "terminal_unknown"].includes(job.status)) return visible(job);
      const { row: p, scope: s } = await loadPermit(db, actor, requestKey);
      if (p.revokedAt || now() >= s.expiresAt || now() - job.authorizationSnapshot.journal.createdAt >= 3600000) {
        await finish(job, "terminal_unknown", "seedance_execution_stopped_unknown"); return visible(await owned(actor, requestKey));
      }
      // Recover atomically persisted local result after a DB failure, without a second GET/download.
      if (p.downloadCount === 1) {
        if ((job.authorizationSnapshot.persistLeaseUntil ?? 0) > now()) return visible(job);
        await resolve(db, actor, job.authorizationSnapshot.journal.references, s);
        await store.cleanupPartials(job);
        const artifact = await store.recover(job);
        if (artifact && artifact.width === 720 && artifact.height === 1280 && Math.abs(artifact.durationSeconds - 5) <= .05) await finish(job, "succeeded", undefined, artifact);
        else await finish(job, "terminal_unknown", "seedance_persistence_interrupted");
        return visible(await owned(actor, requestKey));
      }
      let receipt;
      try { receipt = await adapter(actor, requestKey).get(actor, requestKey); }
      catch (e) { if (e instanceof ExecutionError && e.message === "seedance_poll_budget_exhausted") { await finish(job, "terminal_unknown", "seedance_poll_budget_exhausted"); return visible(await owned(actor, requestKey)); } throw e; }
      job = await owned(actor, requestKey);
      if (["failed", "expired"].includes(receipt.status)) await finish(job, "failed", `seedance_${receipt.status}`);
      else if (receipt.code === "poll_budget_exhausted" || job.authorizationSnapshot.journal.halted) await finish(job, "terminal_unknown", "seedance_protocol_stopped_unknown");
      else if (receipt.status === "succeeded" && receipt.resultUrl) {
        if (receipt.usage.estimatedCostMicros === null) return visible(job); // known task may acquire delayed usage with bounded GET.
        if (BigInt(receipt.usage.measures[0].quantity!) > BigInt(s.maxCompletionTokens)) await finish(job, "failed", "seedance_observed_tokens_exceed_authorized");
        else if (BigInt(receipt.usage.estimatedCostMicros) + BigInt(s.storageCostUpperMicros) > BigInt(s.maxCostMicros)) await finish(job, "failed", "seedance_observed_cost_exceeds_authorized");
        else {
          const claimed = await transaction(async tx => {
            const { row, scope } = await loadPermit(tx, actor, requestKey); live(row, scope); await resolve(tx, actor, job.authorizationSnapshot.journal.references, scope);
            const current = await tx.viralVideoReplicationJob.findUnique({ where: { id: job.id } });
            if (row.downloadCount !== 0 || current.billingStatus !== "reserved") return false;
            await tx.beautyVideoExecutionPermit.update({ where: { id: scope.permitId }, data: { downloadCount: 1, lastCode: "seedance_download_committed" } });
            // Cover the existing 60s transport + 30s ffprobe and local commit margin.
            // A late writer still cannot overwrite a terminal/refunded job (original finish CAS).
            await tx.viralVideoReplicationJob.update({ where: { id: job.id }, data: { status: "persisting", authorizationSnapshot: { ...current.authorizationSnapshot, persistLeaseUntil: now() + 120000 } } }); return true;
          });
          if (claimed) {
            job = await owned(actor, requestKey);
            let artifact;
            try { artifact = await store.persist(job, receipt.resultUrl); if (artifact.width !== 720 || artifact.height !== 1280 || Math.abs(artifact.durationSeconds - 5) > .05) reject("artifact_specification_invalid"); }
            catch { await finish(job, "failed", "seedance_artifact_failed"); return visible(await owned(actor, requestKey)); }
            // A DB failure here leaves the local receipt for recovery. Do not refund a persisted success blindly.
            await finish(job, "succeeded", undefined, artifact);
          }
        }
      }
      return visible(await owned(actor, requestKey));
    },
    async download(actor: UsageActor, requestKey: string) {
      const job = await owned(actor, requestKey); if (!visible(job).canDownload) reject("asset_not_found");
      const { scope } = await loadPermit(db, actor, requestKey);
      await resolve(db, actor, job.authorizationSnapshot.journal.references, scope);
      return store.read(job.authorizationSnapshot.artifact, job);
    },
    async history(actor: UsageActor, requestKey: string) { return visible(await owned(actor, requestKey)); }
  };
}

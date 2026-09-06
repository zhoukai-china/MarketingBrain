import assert from "node:assert/strict";
import { existsSync } from "node:fs";
assert.ok(existsSync("apps/api/src/services/beauty-seedance-execution.ts"), "BY54_seedance_persistent_assembly_missing: fixture journal is not durable execution authority");
import { createHmac, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import Fastify from "../apps/api/node_modules/fastify/fastify.js";
import { createCanvas } from "../apps/api/node_modules/@napi-rs/canvas/index.js";
import { createSeedanceExecution, seedanceReviewSchema, seedanceExecutionScopeSchema, seedanceExecutionRequestHash, SEEDANCE_EXECUTION_VERSION, SEEDANCE_REVIEW_VERSION } from "../apps/api/src/services/beauty-seedance-execution.ts";
import { SEEDANCE_MODEL, SEEDANCE_CONTRACT, SEEDANCE_PRICE } from "../apps/api/src/services/beauty-seedance-adapter.ts";
import { createSeedanceHttpsTransport, SEEDANCE_RESULT_ORIGIN } from "../apps/api/src/services/beauty-seedance-https.ts";
import { createBeautyUsageMeter, usageHash } from "../apps/api/src/services/beauty-usage-metering.ts";
import { replicationMemoryDb } from "./fixtures/replication-test-db.ts";

const authority = "BY54-synthetic-permit-authority-no-cloud-permission", reviewKey = "BY54-synthetic-review-authority-no-cloud-permission";
const env = { SEEDANCE_EXECUTION_MODE: "controlled", ARK_API_KEY: "synthetic-NOT-A-REAL-KEY", SEEDANCE_EXECUTION_AUTHORITY_KEY: authority,
  SEEDANCE_REVIEW_AUTHORITY_KEY: reviewKey, SEEDANCE_ACCOUNT_BINDING: "synthetic-account", SEEDANCE_CREDIT_COST: "100", SEEDANCE_CREDIT_QUOTE_VERSION: "synthetic-test-only" };
const seal = (domain: string, scope: unknown, key: string) => createHmac("sha256", key).update(`${domain}:${JSON.stringify(scope)}`).digest("hex");

async function httpsTest() {
  let sockets = 0, resolved = 0, address = "8.8.8.8", remote = "8.8.8.8", status = 200;
  const fixture: any = {
    resolve: async (host: string) => { resolved++; assert.ok(["ark.cn-beijing.volces.com", new URL(SEEDANCE_RESULT_ORIGIN).hostname].includes(host)); return [{ address, family: 4 }]; },
    request: (options: any, callback: any) => {
      sockets++; assert.equal(options.agent, false); assert.equal(options.rejectUnauthorized, true); assert.equal(options.servername, options.hostname);
      assert.equal(typeof options.checkServerIdentity, "function");
      options.lookup(options.hostname, { all: true }, (_e: any, pinned: any) => assert.deepEqual(pinned, [{ address, family: 4 }]));
      assert.ok(options.checkServerIdentity("wrong.example", { subjectaltname: "DNS:other.example" }));
      const req = new EventEmitter() as any; req.destroy = () => undefined;
      req.end = () => { const response = Readable.from([Buffer.from('{}')]) as any; response.statusCode = status; response.headers = { "content-type": "application/json" }; response.socket = { remoteAddress: remote }; callback(response); };
      return req;
    }
  };
  const api = createSeedanceHttpsTransport("api", fixture), endpoint = "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks";
  assert.equal((await api(endpoint, { method: "POST", body: "{}" })).status, 200);
  assert.equal((await createSeedanceHttpsTransport("result", fixture)(`${SEEDANCE_RESULT_ORIGIN}/synthetic.mp4`)).status, 200);
  const before = sockets;
  for (const url of ["http://127.0.0.1/x", endpoint + "/../other", endpoint + "?secret=1", "https://ark.cn-beijing.volces.com.evil.test/api", `${SEEDANCE_RESULT_ORIGIN}/x.mp4`]) await assert.rejects(() => api(url, { method: "POST" }), /rejected/);
  assert.equal(sockets, before);
  for (address of ["127.0.0.1", "10.0.0.1", "169.254.169.254", "::1", "192.0.2.1"]) await assert.rejects(() => api(endpoint, { method: "POST" }), /address_rejected/);
  assert.equal(sockets, before); address = "8.8.8.8"; remote = "1.1.1.1";
  await assert.rejects(() => api(endpoint, { method: "POST" }), /connection_rejected/); remote = address; status = 302;
  await assert.rejects(() => api(endpoint, { method: "POST" }), /redirect_rejected/);
  await assert.rejects(() => api(endpoint, { method: "POST", headers: { Cookie: "not-permitted" } }), /header_rejected/);
  await assert.rejects(() => api(endpoint, { method: "POST", signal: AbortSignal.abort() }), /aborted/);
  assert.ok(resolved > sockets);
}

async function main() {
  const originalFetch = globalThis.fetch; let external = 0;
  globalThis.fetch = async () => { external++; throw new Error("network_forbidden"); };
  const root = await mkdtemp(path.join(tmpdir(), "by54-offline-")), uploadRoot = path.join(root, "uploads"), resultRoot = path.join(root, "results");
  await mkdir(uploadRoot); const videoFile = path.join(root, "synthetic.mp4");
  execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=720x1280:r=24", "-t", "5", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", videoFile], { windowsHide: true, timeout: 30000 });
  const video = await readFile(videoFile); let client: any;
  if (process.env.BY45_DB_URL) {
    const u = new URL(process.env.BY45_DB_URL); assert.equal(u.hostname, "127.0.0.1"); assert.equal(u.pathname, "/by45_fixture"); assert.equal(process.env.BY45_DB_OWNED, "true");
    assert.ok(+u.port >= 55440 && +u.port <= 55499);
    const { PrismaClient } = await import("../packages/db/node_modules/@prisma/client/index.js"); client = new PrismaClient({ datasources: { db: { url: u.toString() } } });
  }
  try {
    await httpsTest();
    for (let round = 0; round < 3; round++) {
      const db = client ?? replicationMemoryDb(), actor = { tenantId: randomUUID(), userId: randomUUID(), storeId: randomUUID() }; let now = Date.now() + 1000;
      await db.tenant.create({ data: { id: actor.tenantId, name: "Synthetic", type: "local_business" } }); await db.user.create({ data: { id: actor.userId, nickname: "Synthetic" } });
      await db.store.create({ data: { id: actor.storeId, tenantId: actor.tenantId, name: "Synthetic" } });
      await db.membership.create({ data: { ...actor, role: "owner", isActive: true } });
      await db.tenantProductEntitlement.create({ data: { tenantId: actor.tenantId, productCode: "beauty-industry", status: "active", source: "synthetic", startsAt: new Date(now - 1000) } });
      await db.creditAccount.create({ data: { tenantId: actor.tenantId, balance: 10000 } });
      const file = async (b: Buffer, mimeType: string) => {
        const dir = path.join(uploadRoot, actor.tenantId); await mkdir(dir, { recursive: true }); const id = randomUUID(), storagePath = path.join(dir, id); await writeFile(storagePath, b, { flag: "wx" });
        return db.uploadedFile.create({ data: { id, tenantId: actor.tenantId, userId: actor.userId, filename: "synthetic", mimeType, byteSize: b.length, sha256: usageHash(b.toString("base64")), storagePath } });
      };
      // UploadedFile hashes are byte SHA, not the base64 test helper representation.
      const byteHash = (b: Buffer) => { const crypto = require("node:crypto"); return crypto.createHash("sha256").update(b).digest("hex"); };
      const createFile = async (b: Buffer, mime: string) => { const f = await file(b, mime); return db.uploadedFile.update({ where: { id: f.id }, data: { sha256: byteHash(b) } }); };
      const basis = await createFile(Buffer.from("Synthetic reviewed permission evidence, not real legal authorization"), "text/plain");
      const reviews: any[] = [];
      for (const color of ["#334455", "#667788"]) {
        const canvas = createCanvas(720, 1280); canvas.getContext("2d").fillStyle = color; canvas.getContext("2d").fillRect(0, 0, 720, 1280);
        const image = await createFile(canvas.toBuffer("image/png"), "image/png");
        const review = seedanceReviewSchema.parse({ version: SEEDANCE_REVIEW_VERSION, reviewId: randomUUID(), revision: 1, method: "manual_console_review", reviewerId: "synthetic-reviewer",
          reviewedAt: now - 500, decision: "approved", basisFileId: basis.id, basisSha256: basis.sha256, consoleEvidenceHash: usageHash("synthetic-console-attestation"),
          evidence: { ...actor, fileId: image.id, role: "reference_image", product: "beauty-industry", purpose: "seedance_multireference", model: SEEDANCE_MODEL,
            authorizationVersion: 1, sha256: image.sha256, reviewed: true, revoked: false, expiresAt: now + 86400000, bytes: image.byteSize, mime: "image/png", width: 720, height: 1280,
            containsPerson: false, voiceAuthorized: true, uri: `asset://${randomUUID()}`, delivery: "ark_asset", accountBinding: env.SEEDANCE_ACCOUNT_BINDING, officialAssetAccepted: true, portraitAuthorized: true } });
        reviews.push(review); await db.auditLog.create({ data: { id: review.reviewId, tenantId: actor.tenantId, userId: actor.userId, action: "seedance.asset_review", resource: SEEDANCE_REVIEW_VERSION, resourceId: image.id,
          detail: JSON.stringify({ review, signature: seal(SEEDANCE_REVIEW_VERSION, review, reviewKey) }) } });
      }
      const fresh = () => ({ requestKey: randomUUID(), text: "合成空间与原创角色的五秒演示", references: reviews.map(r => ({ fileId: r.evidence.fileId, role: "reference_image" })), duration: 5, resolution: "720p", ratio: "9:16", generateAudio: false });
      const issue = async (input: any, patch: any = {}) => {
        const scope = seedanceExecutionScopeSchema.parse({ version: SEEDANCE_EXECUTION_VERSION, contract: SEEDANCE_CONTRACT, permitId: randomUUID(), ...actor, requestKey: input.requestKey,
          requestHash: seedanceExecutionRequestHash(input), provider: "volcengine_ark", model: SEEDANCE_MODEL, purpose: "seedance_multireference", access: "local_only", accountBinding: env.SEEDANCE_ACCOUNT_BINDING,
          references: reviews.map(r => ({ fileId: r.evidence.fileId, reviewId: r.reviewId, revision: r.revision, sha256: r.evidence.sha256 })),
          priceVersion: SEEDANCE_PRICE, unitPriceMicros: "46", maxCompletionTokens: 108000, maxCostMicros: "5500000", storageCostUpperMicros: "100000", costEvidenceHash: usageHash("synthetic-cost"),
          maxSubmit: 1, maxPoll: 4, maxDownload: 1, creditCost: 100, quoteVersion: "synthetic-test-only", quoteEvidenceHash: usageHash("synthetic-quote-not-commercial"), issuedAt: now - 500, expiresAt: now + 3600000, ...patch });
        await db.beautyVideoExecutionPermit.create({ data: { id: scope.permitId, tenantId: actor.tenantId, userId: actor.userId, storeId: actor.storeId, requestKey: input.requestKey, scope, signature: seal(SEEDANCE_EXECUTION_VERSION, scope, authority) } }); return scope;
      };
      let submits = 0, polls = 0, downloads = 0, fault = "", usage: any = { completion_tokens: 108000, total_tokens: 108000 };
      const transport: typeof fetch = async (raw, init) => {
        const u = new URL(String(raw)); assert.equal(u.origin, "https://ark.cn-beijing.volces.com");
        if (init?.method === "POST") { submits++; const body = JSON.parse(String(init.body)); assert.equal(body.model, SEEDANCE_MODEL); assert.ok(body.content.slice(1).every((x: any) => x.image_url.url.startsWith("asset://")));
          if (fault === "post") throw new Error("synthetic-disconnected-response"); return new Response(JSON.stringify({ id: `cgt-${actor.tenantId}-${submits}` })); }
        polls++; if (fault === "poll") return new Response("safe", { status: 429, headers: { "Retry-After": "2" } });
        return new Response(JSON.stringify({ id: u.pathname.split("/").at(-1), model: SEEDANCE_MODEL, status: fault === "failed" ? "failed" : "succeeded",
          resolution: "720p", ratio: "9:16", duration: 5, framespersecond: 24, content: { video_url: `${SEEDANCE_RESULT_ORIGIN}/synthetic.mp4?signature=not-for-logs` }, usage }));
      };
      const resultTransport: typeof fetch = async () => { downloads++; return new Response(fault === "artifact" ? Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom"), Buffer.alloc(24)]) : video, { headers: { "content-type": "video/mp4" } }); };
      const options = { db, environment: env, uploadRoot, resultRoot, now: () => now, offlineTransport: transport, offlineResultTransport: resultTransport };
      let service = createSeedanceExecution(options);
      const app = Fastify({ logger: false });
      // Test-only HTTP boundary; no production route is registered by BY54.
      app.post("/confirm", async req => service.confirm(actor, req.body));
      app.post("/refresh/:key", async (req: any) => service.refresh(actor, req.params.key));
      app.get("/content/:key", async (req: any, reply) => { try { const bytes = await service.download(req.headers["x-foreign"] ? { ...actor, tenantId: "foreign" } : actor, req.params.key); return reply.type("video/mp4").send(bytes); } catch { return reply.code(404).send({ code: "asset_not_found" }); } });
      const balance = async () => (await db.creditAccount.findUnique({ where: { tenantId: actor.tenantId } })).balance;
      const getPermit = (s: any) => db.beautyVideoExecutionPermit.findUnique({ where: { id: s.permitId } });
      const getJob = (i: any) => db.viralVideoReplicationJob.findFirst({ where: { tenantId: actor.tenantId, requestKey: i.requestKey } });
      const metering = (s: any) => createBeautyUsageMeter(db, actor, s.permitId).read();
      try {
        assert.equal(createSeedanceExecution({ ...options, environment: {} }).enabled, false);
        await assert.rejects(() => createSeedanceExecution({ ...options, environment: {} }).confirm(actor, fresh()), /disabled/);
        await assert.rejects(() => service.confirm(actor, fresh()), /permit_required/); assert.equal(submits, 0); assert.equal(await balance(), 10000);
        for (const patch of [{ maxCostMicros: "1000000" }, { access: "provider_https" }, { accountBinding: "foreign-account" }, { expiresAt: now - 1 }, { creditCost: 50 }]) { const i = fresh(); await issue(i, patch); await assert.rejects(() => service.confirm(actor, i), /seedance_/); }
        const forged = fresh(), forgedScope = await issue(forged);
        await db.beautyVideoExecutionPermit.update({ where: { id: forgedScope.permitId }, data: { signature: "0".repeat(64) } });
        await assert.rejects(() => service.confirm(actor, forged), /signature_invalid/);
        const noFunds = fresh(); await issue(noFunds);
        await db.creditAccount.update({ where: { tenantId: actor.tenantId }, data: { balance: 0 } });
        await assert.rejects(() => service.confirm(actor, noFunds), /insufficient_credits/);
        await db.creditAccount.update({ where: { tenantId: actor.tenantId }, data: { balance: 10000 } });
        await db.tenantProductEntitlement.updateMany({ where: { tenantId: actor.tenantId }, data: { status: "revoked" } });
        await assert.rejects(() => service.confirm(actor, noFunds), /access_denied/);
        await db.tenantProductEntitlement.updateMany({ where: { tenantId: actor.tenantId }, data: { status: "active" } });
        assert.equal(submits, 0); assert.equal(await db.creditReservation.count({ where: { tenantId: actor.tenantId } }), 0);
        const normal = fresh(), scope = await issue(normal);
        for (const patch of [{ grant: "fake" }, { model: "wan2.2-animate-mix" }, { tenantId: "foreign" }]) await assert.rejects(() => service.confirm(actor, { ...normal, ...patch }), /input_invalid/);
        const results = await Promise.all(Array.from({ length: 3 }, () => app.inject({ method: "POST", url: "/confirm", payload: normal })));
        assert.ok(results.some(r => r.statusCode === 200)); assert.equal(submits, 1); assert.equal(await balance(), 9900);
        service = createSeedanceExecution(options); // new service, same DB, no process-local claim state
        const done = await app.inject({ method: "POST", url: `/refresh/${normal.requestKey}` }); assert.equal(done.statusCode, 200, done.body); assert.equal(done.json().status, "succeeded", done.body);
        const content = await app.inject({ method: "GET", url: `/content/${normal.requestKey}` }); assert.equal(content.statusCode, 200); assert.equal(byteHash(content.rawPayload), byteHash(video));
        assert.equal((await app.inject({ method: "GET", url: `/content/${normal.requestKey}`, headers: { "x-foreign": "true" } })).statusCode, 404);
        for (const a of [{ ...actor, userId: "foreign" }, { ...actor, storeId: "foreign" }]) await assert.rejects(() => service.history(a, normal.requestKey), /access_denied|task_not_found/);
        await service.confirm(actor, normal); await service.refresh(actor, normal.requestKey); assert.equal(submits, 1); assert.equal(downloads, 1);
        const saved = await getPermit(scope); assert.equal(saved.submitCount, 1); assert.equal(saved.pollCount, 1); assert.equal(saved.downloadCount, 1); assert.equal(saved.committedCostFen, 550);
        assert.equal((await getJob(normal)).authorizationSnapshot.committedCostMicros, "5500000");
        assert.equal((await metering(scope)).groups[0].estimatedCostMicros, "4968000"); assert.equal((await metering(scope)).groups[0].observedCostMicros, null);

        const lost = fresh(), lostScope = await issue(lost); fault = "post"; await service.confirm(actor, lost); fault = "";
        await service.confirm(actor, lost); assert.equal(submits, 2); assert.equal((await getJob(lost)).billingStatus, "reserved");
        now += 3600001; await service.refresh(actor, lost.requestKey); assert.equal((await getJob(lost)).billingStatus, "refunded"); assert.equal((await getPermit(lostScope)).submitCount, 1); assert.equal((await getPermit(lostScope)).committedCostFen, 550);
        assert.equal((await metering(lostScope)).groups[0].quantity, null);

        const delayed = fresh(), delayedScope = await issue(delayed); await service.confirm(actor, delayed); usage = undefined;
        await service.refresh(actor, delayed.requestKey); assert.equal((await getJob(delayed)).billingStatus, "reserved"); assert.equal((await metering(delayedScope)).groups[0].quantity, null);
        usage = { completion_tokens: 108000, total_tokens: 108000 }; now += 2100; await service.refresh(actor, delayed.requestKey); assert.equal((await getJob(delayed)).billingStatus, "charged");
        assert.equal((await metering(delayedScope)).groups[0].estimatedCostMicros, "4968000");

        // A signed token cap is independent of a larger currency allowance.
        const overTokens = fresh(); await issue(overTokens); await service.confirm(actor, overTokens);
        usage = { completion_tokens: 108001, total_tokens: 108001 };
        const downloadsAtCap = downloads; await service.refresh(actor, overTokens.requestKey);
        assert.equal((await getJob(overTokens)).billingStatus, "refunded", "token cap must fail closed before download");
        assert.equal(downloads, downloadsAtCap); usage = { completion_tokens: 108000, total_tokens: 108000 };

        const failed = fresh(), failedScope = await issue(failed); await service.confirm(actor, failed); fault = "failed";
        await service.refresh(actor, failed.requestKey); fault = ""; assert.equal((await getJob(failed)).billingStatus, "refunded"); assert.equal((await getPermit(failedScope)).submitCount, 1);
        const refundCount = await db.creditTransaction.count({ where: { tenantId: actor.tenantId, direction: "refund" } }); await service.refresh(actor, failed.requestKey);
        assert.equal(await db.creditTransaction.count({ where: { tenantId: actor.tenantId, direction: "refund" } }), refundCount);

        const limited = fresh(), limitedScope = await issue(limited, { maxPoll: 1 }); await service.confirm(actor, limited); fault = "poll";
        await service.refresh(actor, limited.requestKey); const pollBefore = polls; await service.refresh(actor, limited.requestKey); assert.equal(polls, pollBefore);
        now += 2100; await service.refresh(actor, limited.requestKey); fault = ""; assert.equal((await getPermit(limitedScope)).pollCount, 1); assert.equal((await getJob(limited)).billingStatus, "refunded");

        const broken = fresh(); await issue(broken); await service.confirm(actor, broken); fault = "artifact"; await service.refresh(actor, broken.requestKey); fault = "";
        assert.equal((await getJob(broken)).billingStatus, "refunded");
        assert.ok(!(await readdir(resultRoot, { recursive: true })).some(x => String(x).endsWith(".partial.mp4")));

        const revoked = fresh(), revokedScope = await issue(revoked); await service.confirm(actor, revoked);
        await db.beautyVideoExecutionPermit.update({ where: { id: revokedScope.permitId }, data: { revokedAt: new Date(now) } });
        const before = polls; await service.refresh(actor, revoked.requestKey); assert.equal(polls, before); assert.equal((await getJob(revoked)).billingStatus, "refunded");

        // Before-submit metering/credit/permit must rollback together if audit write is unavailable.
        const dbFault = fresh(), dbFaultScope = await issue(dbFault); const originalTransaction = db.$transaction.bind(db);
        db.$transaction = (fn: any, txOptions: any) => originalTransaction(async (tx: any) => { const create = tx.auditLog.create.bind(tx.auditLog); tx.auditLog.create = async (args: any) => { if (args.data.action === "beauty_usage.started") throw new Error("synthetic_db_fault"); return create(args); }; try { return await fn(tx); } finally { tx.auditLog.create = create; } }, txOptions);
        const submitsBefore = submits, balanceBefore = await balance();
        try { await assert.rejects(() => service.confirm(actor, dbFault), /database_unavailable/); } finally { db.$transaction = originalTransaction; }
        assert.equal(submits, submitsBefore); assert.equal(await balance(), balanceBefore); assert.equal((await getPermit(dbFaultScope)).submitCount, 0);

        // POST accepted but its observation transaction is unavailable: do not resubmit on restart.
        const lostCommit = fresh(), lostCommitScope = await issue(lostCommit);
        db.$transaction = (fn: any, txOptions: any) => originalTransaction(async (tx: any) => { const create = tx.auditLog.create.bind(tx.auditLog); tx.auditLog.create = async (args: any) => { if (args.data.action === "seedance.protocol") throw new Error("synthetic_observation_fault"); return create(args); }; try { return await fn(tx); } finally { tx.auditLog.create = create; } }, txOptions);
        try { await assert.rejects(() => service.confirm(actor, lostCommit), /database_unavailable/); } finally { db.$transaction = originalTransaction; }
        const postCount = submits; await createSeedanceExecution(options).confirm(actor, lostCommit); assert.equal(submits, postCount);
        assert.equal((await getPermit(lostCommitScope)).submitCount, 1); assert.ok((await getJob(lostCommit)).providerTaskId == null);
        now += 3600001; await service.refresh(actor, lostCommit.requestKey); assert.equal((await getJob(lostCommit)).billingStatus, "refunded");
        assert.equal((await metering(lostCommitScope)).groups[0].quantity, null);

        // Persistence final transaction failure: recover exact local receipt, no new download or POST.
        const recovery = fresh(); await issue(recovery); await service.confirm(actor, recovery);
        db.$transaction = (fn: any, txOptions: any) => originalTransaction(async (tx: any) => { const update = tx.creditReservation.updateMany.bind(tx.creditReservation); tx.creditReservation.updateMany = async () => { throw new Error("synthetic_finish_db_fault"); }; try { return await fn(tx); } finally { tx.creditReservation.updateMany = update; } }, txOptions);
        try { await assert.rejects(() => service.refresh(actor, recovery.requestKey)); } finally { db.$transaction = originalTransaction; }
        const downloadBefore = downloads;
        assert.ok((await getJob(recovery)).authorizationSnapshot.persistLeaseUntil - now >= 90000, "persistence lease must cover 60s download plus 30s ffprobe");
        now += 121000; await createSeedanceExecution(options).refresh(actor, recovery.requestKey);
        assert.equal((await getJob(recovery)).billingStatus, "charged"); assert.equal(downloads, downloadBefore);

        // Independent OS processes share the same persistent claim. Worker transport is local injection only.
        if (client) {
          const race = fresh(), raceScope = await issue(race); const workerFile = path.join(root, `worker-${round}.json`);
          await writeFile(workerFile, JSON.stringify({ actor, input: race, environment: env, uploadRoot, resultRoot, now }), { flag: "wx" });
          const outputs = await Promise.all([0, 1, 2].map(() => new Promise<string>((resolve, reject) => {
            const child = spawn(process.execPath, ["apps/api/node_modules/tsx/dist/cli.mjs", "scripts/fixtures/seedance-execution-worker.ts", workerFile], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: process.env });
            let out = ""; child.stdout.on("data", b => out += b); child.stderr.on("data", () => undefined);
            const timer = setTimeout(() => { child.kill(); reject(new Error("owned_worker_timeout")); }, 30000);
            child.on("close", code => { clearTimeout(timer); code === 0 ? resolve(out.trim()) : reject(new Error(`owned_worker_failed:${out.trim()}`)); });
          })));
          assert.equal(outputs.filter(x => x === "SUBMITTED").length, 1); assert.equal((await getPermit(raceScope)).submitCount, 1);
          await service.confirm(actor, race); assert.equal(submits, submitsBefore + 2); // lost observation + recovery only; worker POST must not be repeated
        }
        // Latest signed revocation cannot be bypassed using an older approved review from the permit.
        const blocked = fresh(); await issue(blocked); const r = seedanceReviewSchema.parse({ ...reviews[0], reviewId: randomUUID(), revision: 2, decision: "revoked" });
        await db.auditLog.create({ data: { id: r.reviewId, tenantId: actor.tenantId, userId: actor.userId, action: "seedance.asset_review", resource: SEEDANCE_REVIEW_VERSION, resourceId: r.evidence.fileId,
          detail: JSON.stringify({ review: r, signature: seal(SEEDANCE_REVIEW_VERSION, r, reviewKey) }) } });
        await assert.rejects(() => service.confirm(actor, blocked), /asset_review_changed/);
        await assert.rejects(() => service.download(actor, normal.requestKey), /asset_review_changed/, "historical download must respect current asset revocation");
        const audit = JSON.stringify(await db.auditLog.findMany({ where: { tenantId: actor.tenantId, resource: SEEDANCE_EXECUTION_VERSION } }));
        for (const secret of [authority, reviewKey, env.ARK_API_KEY, "not-for-logs", normal.text, "https://"]) assert.ok(!audit.includes(secret));
        assert.equal(external, 0);
        console.log(JSON.stringify({ round, result: "BY54_PASS", database: client ? "isolated_postgresql" : "transactional_fixture", syntheticSubmit: submits, syntheticGet: polls, syntheticDownload: downloads, externalCalls: 0, providerCalls: 0, costCny: 0 }));
      } finally { await app.close(); }
    }
  } finally { await client?.$disconnect(); globalThis.fetch = originalFetch; }
}
main().catch(e => { console.error(e.stack); process.exitCode = 1; });

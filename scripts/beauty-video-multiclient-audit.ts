import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import Fastify from "../apps/api/node_modules/fastify/fastify.js";
import { replicationMemoryDb } from "./fixtures/replication-test-db.js";
import { createVideoAssetAuthorization } from "../apps/api/src/services/beauty-video-asset-authorization.js";
import { createVideoMaterialIntegration } from "../apps/api/src/services/beauty-video-material-integration.js";
import { createReplicationRepository, ReplicationError } from "../apps/api/src/services/viral-video-replication-runtime.js";
import { registerViralVideoReplicationRoutes } from "../apps/api/src/routes/viral-video-replication.js";
import { replicationSchema } from "../apps/api/src/services/viral-video-replication.js";
import { videoFileHash } from "../apps/api/src/services/beauty-video-private-files.js";
import { readLanqiWalletBalance } from "../apps/api/src/services/lanqi-wallet.js";

// Checklist E audit only. Two handler instances, one synthetic transactional resource store.
// No mobile OAuth claim, UI synchronization SLA, real file decoding or Provider is simulated as PASS.
async function main() {
  let externalCalls = 0;
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async () => { externalCalls++; throw new Error("external_network_forbidden"); };
  try {
    for (let round = 0; round < 3; round++) {
      const db = replicationMemoryDb(), suffix = randomUUID();
      const actor = { tenantId: `e-${suffix}`, userId: `u-${suffix}` }, storeId = `s-${suffix}`;
      const otherUser = `other-user-${suffix}`, otherStore = `other-store-${suffix}`;
      const now = Date.now(), policy = { creditCost: 100, maxCostFen: 120, maxOutputSeconds: 2 };
      await db.tenant.create({ data: { id: actor.tenantId, name: "Synthetic", type: "local_business" } });
      for (const id of [storeId, otherStore]) await db.store.create({ data: { id, tenantId: actor.tenantId, name: "Synthetic" } });
      for (const userId of [actor.userId, otherUser]) {
        await db.user.create({ data: { id: userId, nickname: "Synthetic" } });
        // LQ-34：扣费主体是**租户 owner 的通用钱包**，所以合成门店必须有一位 owner（其余成员仍是 manager）。
        await db.membership.create({ data: { tenantId: actor.tenantId, userId, storeId, role: userId === actor.userId ? "owner" : "manager", isActive: true } });
      }
      await db.tenantProductEntitlement.create({ data: { tenantId: actor.tenantId, productCode: "beauty-industry", status: "active", startsAt: new Date(now - 1000), expiresAt: null } });
      await db.wallet.create({ data: { userId: actor.userId, paidBalance: 1000, bonusBalance: 0 } });
      const walletBalance = async () => (await readLanqiWalletBalance(actor.tenantId, db))!.balance;
      const materials = new Map<string, Buffer>();
      async function file(label: string, mimeType: string) {
        const id = randomUUID(), bytes = Buffer.from(label); materials.set(id, bytes);
        return db.uploadedFile.create({ data: { id, ...actor, filename: "synthetic", mimeType, byteSize: bytes.length, sha256: videoFileHash(bytes), storagePath: "synthetic-reader-port-only" } });
      }
      const ref = await file("reference", "video/mp4"), portrait = await file("portrait", "image/png"), basis = await file("basis", "text/plain");
      const reader = async (f: any) => ({ sha256: f.sha256, bytes: materials.get(f.id)!, mimeType: f.mimeType, width: 240, height: 320, ...(f.id === ref.id ? { durationSeconds: 2 } : {}) });
      const auth = createVideoAssetAuthorization(db, reader, () => now);
      const declaration = (fileId: string, subjectRole: string) => ({ fileId, basisFileId: basis.id, subjectRole, purpose: "video_replacement", expiresAt: new Date(now + 3600_000).toISOString(), requestKey: randomUUID(), rightsDeclared: true });
      const body = declaration(ref.id, "reference"), portraitBody = declaration(portrait.id, "owner");
      const apps: ReturnType<typeof Fastify>[] = [];
      async function client() {
        const app = Fastify({ logger: false }); apps.push(app);
        const localAuth = createVideoAssetAuthorization(db, reader, () => now);
        const integration = createVideoMaterialIntegration({ db, authorization: localAuth, policy, now: () => now });
        await registerViralVideoReplicationRoutes(app, { ...integration,
          context: async headers => {
            if (!headers["x-synthetic-session"]) throw new ReplicationError("unauthorized", 401);
            return { ...actor, userId: headers["x-synthetic-other-user"] ? otherUser : actor.userId, tenantId: headers["x-synthetic-other-tenant"] ? "synthetic-other" : actor.tenantId, source: "database" } as any;
          }, entitled: async tenantId => Boolean(await db.tenantProductEntitlement.findFirst({ where: { tenantId, status: "active" } })),
          creditBalance: async (tenantId: string) => (await readLanqiWalletBalance(tenantId, db))?.balance ?? null });
        return app;
      }
      const headers = { "x-synthetic-session": "same-user-old-session" };
      const send = (app: any, method: string, url: string, payload?: any, extra: any = {}) => app.inject({ method, url, headers: { ...headers, ...extra }, ...(payload === undefined ? {} : { payload }) });
      const declarationUrl = "/viral-video-replication/material-authorizations";
      try {
        const a = await client(), b = await client();
        assert.equal((await a.inject({ method: "GET", url: "/viral-video-replication/jobs" })).statusCode, 401);
        const initial = await Promise.all([send(a, "POST", declarationUrl, body), send(b, "POST", declarationUrl, body)]);
        assert.ok(initial.every(r => r.statusCode === 201));
        const id = initial[0].json().authorization.id;
        assert.deepEqual(initial[0].json(), initial[1].json());
        assert.equal(await db.auditLog.count({ where: { action: "beauty_video.declaration" } }), 1);
        assert.equal((await send(a, "POST", declarationUrl, portraitBody)).statusCode, 201);
        // 2026-09-15（1ab02ca）起：同门店同一份内容重新上传会**就地重绑**（fileId/到期/指纹更新、version+1），
        // 不再因为「同内容换了 fileId 或到期时间」把用户挡在声明这一步。
        // 真正必须拒绝的是「同一 requestKey 指向**不同内容**」，所以这里换一份内容来制造冲突。
        const otherRef = await file("different-reference-content", "video/mp4");
        assert.equal((await send(b, "POST", declarationUrl, { ...body, fileId: otherRef.id })).statusCode, 409);
        assert.equal((await send(b, "POST", declarationUrl, { ...body, rev: 0, updatedAt: "2099-01-01" })).statusCode, 400);
        assert.equal((await db.beautyVideoAssetAuthorization.findUnique({ where: { id } })).version, 1);
        assert.equal((await send(b, "POST", declarationUrl, body, { "x-synthetic-other-user": "true" })).statusCode, 404);
        assert.equal((await send(b, "POST", declarationUrl, body, { "x-synthetic-other-tenant": "true" })).statusCode, 403);

        const input = replicationSchema.parse({ model: "aliyun_strict", referenceFileId: ref.id, portraitFileId: portrait.id, requestKey: randomUUID(), visualRightsConfirmed: true, audioRightsConfirmed: true, performerConsentConfirmed: true, portraitConsentConfirmed: true });
        const admission = await auth.admission(actor, input, { ...policy, stagingReady: false });
        assert.equal((await send(a, "POST", "/viral-video-replication/confirm", input)).statusCode, 422);
        assert.equal(await db.walletLedger.count({ where: { userId: actor.userId } }), 0);
        // Seed one previously admitted synthetic worker task. No Provider/real staging is enabled.
        const repoA = createReplicationRepository(db), repoB = createReplicationRepository(db);
        const seeded = await repoA.create(admission, input, now);
        const list = (app: any) => send(app, "GET", "/viral-video-replication/jobs");
        const left = (await list(a)).json(), right = (await list(b)).json();
        assert.deepEqual(left, right); assert.equal(left.jobs[0].status, "queued");
        const stale = (await repoB.get(seeded.job.id, actor.tenantId))!;
        const current = (await repoA.claim(seeded.job, "submitting", now + 10))!;
        assert.equal(await repoB.claim(stale, "submitting", now + 10), null);
        await assert.rejects(() => repoB.update(stale, { status: "queued" }), /job_lease_lost/);
        await assert.rejects(() => repoB.update({ ...current, updatedAt: new Date(now + 9) }, { providerStatus: "stale_revision" }), /job_lease_lost/);
        await assert.rejects(() => repoB.finish(stale, "canceled", "stale_client"), /job_lease_lost/);
        await repoA.finish(current, "failed", "synthetic_pre_submit_failure");
        await repoB.finish(stale, "canceled", "duplicate_late_release");
        assert.equal(await walletBalance(), 1000);
        assert.equal(await db.walletLedger.count({ where: { userId: actor.userId, type: "refund" } }), 1, "同一 requestKey 只退一次");
        assert.equal((await list(b)).json().jobs[0].status, "failed");
        const restarted = await client(); // Fresh server instance reads the same committed backend, no local cache.
        assert.deepEqual((await list(restarted)).json(), (await list(a)).json());

        await db.membership.updateMany({ where: { ...actor }, data: { isActive: false } });
        assert.equal((await list(a)).statusCode, 403); assert.equal((await list(b)).statusCode, 403);
        await db.membership.updateMany({ where: { ...actor }, data: { isActive: true, storeId: otherStore } });
        assert.deepEqual((await list(b)).json().jobs, []);
        await db.membership.updateMany({ where: { ...actor }, data: { storeId } });
        assert.equal((await list(a)).json().jobs.length, 1);
        await db.tenantProductEntitlement.updateMany({ where: { tenantId: actor.tenantId }, data: { status: "revoked" } });
        assert.equal((await list(a)).statusCode, 403); assert.equal((await list(b)).statusCode, 403);
        await db.tenantProductEntitlement.updateMany({ where: { tenantId: actor.tenantId }, data: { status: "active" } });
        const revoke = `${declarationUrl}/${id}/revoke`;
        const revoked = await Promise.all([send(a, "POST", revoke, {}), send(b, "POST", revoke, {})]);
        assert.ok(revoked.every(r => r.statusCode === 200 && r.json().authorization.version === 2));
        assert.equal(await db.auditLog.count({ where: { action: "beauty_video.revoke" } }), 1);
        const replay = await send(b, "POST", declarationUrl, body);
        assert.equal(replay.json().authorization.version, 2); assert.equal(replay.json().authorization.status, "revoked");
        assert.deepEqual((await list(a)).json().jobs, []); assert.deepEqual((await list(restarted)).json().jobs, []);
        const savedFind = db.viralVideoReplicationJob.findMany;
        db.viralVideoReplicationJob.findMany = async () => { throw new Error("synthetic_store_failure"); };
        const failure = await list(b); assert.equal(failure.statusCode, 503); assert.equal(failure.json().jobs, undefined);
        db.viralVideoReplicationJob.findMany = savedFind;
        assert.equal((await list(b)).statusCode, 200);
        for (const r of [...initial, ...revoked, replay]) assert.ok(!r.body.includes("storagePath") && !r.body.includes("Synthetic rights"));
      } finally { for (const app of apps) await app.close(); }
    }
    assert.equal(externalCalls, 0);
    console.log(JSON.stringify({ result: "MULTICLIENT_ENTITY_AUDIT_PASS", rounds: 3, independentHandlersPerRound: 3, db: "transactional_fixture", providerCalls: 0, externalCalls, costYuan: 0, browserE2E: "not_run", pushSla: "not_claimed" }));
  } finally { globalThis.fetch = savedFetch; }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

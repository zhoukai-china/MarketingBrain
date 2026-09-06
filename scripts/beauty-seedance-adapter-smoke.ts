import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createSeedanceAdapter, buildSeedancePayload, seedanceInputSchema, seedanceUsage,
  SEEDANCE_MODEL, SEEDANCE_ENDPOINT, SEEDANCE_PRICE, SEEDANCE_FIRST_PROFILE_ESTIMATE_MICROS,
  type SeedanceJournal, type SeedanceRow, type SeedanceEvidence, type SeedanceInput } from "../apps/api/src/services/beauty-seedance-adapter.ts";
import { createBeautyUsageMeter } from "../apps/api/src/services/beauty-usage-metering.ts";
import { replicationMemoryDb } from "./fixtures/replication-test-db.ts";
import { validateViralReplicationInput } from "../apps/api/src/services/viral-video-replication.ts";

const actor = { tenantId: "synthetic-tenant", userId: "synthetic-user", storeId: "synthetic-store" };
const input: SeedanceInput = { requestKey: "synthetic-request-0001", text: "原创虚构角色与授权合成场景演示", duration: 5, resolution: "720p", ratio: "9:16", generateAudio: true,
  references: [{ fileId: "character", role: "reference_image" }, { fileId: "scene", role: "reference_image" }] };
function asset(fileId = "character", overrides: Partial<SeedanceEvidence> = {}): SeedanceEvidence {
  return { ...actor, fileId, role: "reference_image", product: "beauty-industry", purpose: "seedance_multireference", model: SEEDANCE_MODEL,
    authorizationVersion: 1, sha256: "a".repeat(64), reviewed: true, revoked: false, expiresAt: 100000000,
    bytes: 1234, mime: "image/png", width: 720, height: 1280, containsPerson: false, voiceAuthorized: true,
    uri: "asset://synthetic-asset", delivery: "ark_asset", accountBinding: "synthetic-account", officialAssetAccepted: true, portraitAuthorized: true, ...overrides };
}
function memoryJournal() {
  const rows = new Map<string, SeedanceRow>(); let tail: Promise<unknown> = Promise.resolve();
  const journal: SeedanceJournal = { atomic<T>(key: string, update: (row: SeedanceRow | null) => { row: SeedanceRow | null; value: T }) {
    const work = tail.then(() => { const old = rows.get(key); const next = update(old ? structuredClone(old) : null); if (next.row) rows.set(key, structuredClone(next.row)); return structuredClone(next.value); });
    tail = work.catch(() => undefined); return work;
  } };
  return { rows, journal };
}
const success = { id: "cgt-synthetic", model: SEEDANCE_MODEL, status: "succeeded", resolution: "720p", ratio: "9:16", duration: 5, framespersecond: 24,
  content: { video_url: "https://ark-content-generation-cn-beijing.tos-cn-beijing.volces.com/synthetic.mp4?signature=do-not-log" }, usage: { completion_tokens: 108000, total_tokens: 108000 } };
const json = (x: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(x), { status, headers });
type Handler = (method: string, init: RequestInit) => Response | Promise<Response>;
function fixture(handler: Handler = method => json(method === "POST" ? { id: "cgt-synthetic" } : success)) {
  let time = 1000, calls = 0, posts = 0, gets = 0; const db = memoryJournal();
  const authority = { actor, entitlement: true, accountBinding: "synthetic-account", assets: [asset(), asset("scene")] };
  const options = { mode: "fixture" as const, journal: db.journal, now: () => time, timeoutMs: 10,
    resolve: async (_actor: typeof actor, _refs: SeedanceInput["references"]) => authority,
    transport: (async (url: any, init: RequestInit) => {
      calls++; if (init.method === "POST") posts++; else gets++;
      assert.equal(new URL(String(url)).origin, new URL(SEEDANCE_ENDPOINT).origin);
      assert.equal(init.redirect, "error"); assert.equal((init.headers as any).Authorization, "Bearer synthetic-offline-only");
      return handler(init.method!, init);
    }) as typeof fetch };
  return { ...db, options, authority, adapter: createSeedanceAdapter(options), counts: () => ({ calls, posts, gets }), advance: (ms = 65000) => time += ms };
}

async function main() {
  assert.ok(existsSync("apps/api/src/services/beauty-seedance-adapter.ts"), "seedance_explicit_adapter_missing: existing wan driver cannot encode official 2.0 references/status/usage");
  const original = globalThis.fetch; let external = 0;
  globalThis.fetch = async () => { external++; throw new Error("external_network_forbidden"); };
  try {
    for (let round = 0; round < 3; round++) {
      assert.equal(createSeedanceAdapter().enabled, false);
      assert.match(validateViralReplicationInput({ model: "seedance_creative", visualRightsConfirmed: true, audioRightsConfirmed: true,
        performerConsentConfirmed: true, portraitConsentConfirmed: true }) ?? "", /尚未开放/);
      await assert.rejects(() => createSeedanceAdapter().submit(actor, input), /seedance_disabled/);
      await assert.rejects(() => createSeedanceAdapter({ mode: "real" } as any).submit(actor, input), /seedance_disabled/);
      const f = fixture((method, init) => {
        if (method === "POST") {
          const p = JSON.parse(String(init.body)); assert.equal(p.model, SEEDANCE_MODEL); assert.equal(p.content.length, 3);
          assert.equal(p.content[1].role, "reference_image"); assert.equal(p.generate_audio, true);
          assert.deepEqual(Object.keys(p).sort(), ["model", "content", "resolution", "ratio", "duration", "generate_audio", "watermark", "execution_expires_after"].sort());
        }
        return json(method === "POST" ? { id: "cgt-synthetic" } : success);
      });
      const initial = await Promise.all(Array.from({ length: 10 }, () => f.adapter.submit(actor, input)));
      assert.equal(f.counts().posts, 1); assert.ok(initial.some(x => x.code === "accepted"));
      await assert.rejects(() => f.adapter.submit(actor, { ...input, text: "changed" }), /request_conflict/);
      const finished = await f.adapter.get(actor, input.requestKey);
      assert.equal(finished.status, "succeeded"); assert.equal(finished.resultUrl, success.content.video_url);
      assert.equal(finished.usage.estimatedCostMicros, SEEDANCE_FIRST_PROFILE_ESTIMATE_MICROS);
      assert.equal(finished.usage.measures.length, 1); assert.equal(finished.usage.measures[0].priceVersion, SEEDANCE_PRICE);
      const restarted = createSeedanceAdapter(f.options);
      await restarted.submit(actor, input); await restarted.get(actor, input.requestKey); assert.deepEqual(f.counts(), { calls: 2, posts: 1, gets: 1 });
      const history = JSON.stringify([...f.rows.values()]);
      for (const forbidden of [input.text, "do-not-log", success.content.video_url, "Bearer", "synthetic-offline-only", "video_url"]) assert.ok(!history.includes(forbidden));
      assert.equal([...f.rows.values()][0].events.length, 2);
      for (const foreign of [{ ...actor, tenantId: "foreign" }, { ...actor, userId: "foreign" }, { ...actor, storeId: "foreign" }]) {
        await assert.rejects(() => f.adapter.get(foreign, input.requestKey), /task_not_found/);
        await assert.rejects(() => f.adapter.submit(foreign, input), /asset_not_found/);
      }
      f.authority.assets[0].authorizationVersion++;
      await assert.rejects(() => restarted.get(actor, input.requestKey), /asset_authorization_changed/);
      f.authority.assets[0].authorizationVersion--; f.authority.assets[0].revoked = true as any;
      await assert.rejects(() => restarted.get(actor, input.requestKey), /asset_evidence_required/);

      // Public input never accepts raw URLs, caller identity, provider/model, first/last frame or budget overrides.
      for (const patch of [{ url: "https://attacker.example" }, { assetId: "asset://foreign" }, { tenantId: "foreign" }, { model: "doubao-seedance-2-5-260128" }, { maxCost: 999 }, { duration: -1 }, { resolution: "1080p" }, { references: [{ fileId: "x", role: "first_frame" }] }]) {
        const t = fixture(); await assert.rejects(() => t.adapter.submit(actor, { ...input, ...patch }), /input_invalid/); assert.equal(t.counts().calls, 0);
      }
      for (const patch of [{ tenantId: "foreign" }, { userId: "foreign" }, { storeId: "foreign" }, { accountBinding: "foreign" }, { purpose: "video_replacement" }, { reviewed: false }, { expiresAt: 0 }, { officialAssetAccepted: false }, { width: 299 }, { height: 6001 }, { width: 300, height: 1280 }, { mime: "text/html" }, { bytes: 30 * 1024 ** 2 }, { containsPerson: true, portraitAuthorized: false }, { uri: "asset://id?secret=x" }]) {
        const t = fixture(); Object.assign(t.authority.assets[0], patch);
        await assert.rejects(() => t.adapter.submit(actor, input), /seedance_/); assert.equal(t.counts().calls, 0);
      }
      const validHttps: Partial<SeedanceEvidence> = { delivery: "approved_https", uri: "https://media.example.com/scene.png?sig=not-logged", approvedOrigin: "https://media.example.com", resolvedAddresses: ["8.8.8.8"] };
      for (const patch of [{ resolvedAddresses: ["127.0.0.1"] }, { resolvedAddresses: ["169.254.169.254"] }, { resolvedAddresses: ["10.1.1.1"] }, { resolvedAddresses: ["::1"] }, { uri: "https://media.example.com.evil.test/x" }, { uri: "http://media.example.com/x" }, { uri: "https://user:pass@media.example.com/x" }, { uri: "https://media.example.com/x#fragment" }, { containsPerson: true }]) {
        const t = fixture(); Object.assign(t.authority.assets[0], validHttps, patch); await assert.rejects(() => t.adapter.submit(actor, input), /seedance_/); assert.equal(t.counts().calls, 0);
      }
      const h = fixture(); Object.assign(h.authority.assets[1], validHttps); assert.equal((await h.adapter.submit(actor, input)).status, "queued");
      const absent = fixture(); absent.authority.entitlement = false; await assert.rejects(() => absent.adapter.submit(actor, input), /asset_not_found/);
      const down = fixture(); down.options.resolve = async () => { throw new Error("SECRET must not escape"); }; await assert.rejects(() => down.adapter.submit(actor, input), /seedance_authority_unavailable/);

      // Official multimodal shapes checked independently; only two-image profile is executable in this fixture adapter.
      const img9 = Array.from({ length: 9 }, (_, i) => asset(`image${i}`));
      const videos = Array.from({ length: 3 }, (_, i) => asset(`video${i}`, { role: "reference_video", mime: "video/mp4", seconds: 5, fps: 24, codec: "h264" }));
      const audios = Array.from({ length: 3 }, (_, i) => asset(`audio${i}`, { role: "reference_audio", mime: "audio/wav", seconds: 5 }));
      const multimodal = [...img9, ...videos, ...audios], auth = { actor, entitlement: true, accountBinding: "synthetic-account", assets: multimodal };
      const multiInput = { ...input, references: multimodal.map(a => ({ fileId: a.fileId, role: a.role })) };
      assert.equal(buildSeedancePayload(multiInput, actor, auth, 1000).payload.content.length, 16);
      assert.equal(seedanceInputSchema.safeParse({ ...multiInput, references: [...multiInput.references, { fileId: "image10", role: "reference_image" }] }).success, false);
      assert.equal(seedanceInputSchema.safeParse({ ...input, references: audios.map(a => ({ fileId: a.fileId, role: a.role })) }).success, false);
      for (const patch of [{ seconds: 16 }, { seconds: 1 }, { fps: 23 }, { codec: "av1" }, { bytes: 201 * 1024 ** 2 }, { voiceAuthorized: false }]) {
        const altered = structuredClone(auth); Object.assign(altered.assets[9], patch); assert.throws(() => buildSeedancePayload(multiInput, actor, altered, 1000), /seedance_/);
      }
      const altered = structuredClone(auth); altered.assets[9].seconds = 6; assert.throws(() => buildSeedancePayload(multiInput, actor, altered, 1000), /duration_invalid/);
      const shaped = fixture(); shaped.authority.assets = multimodal; await assert.rejects(() => shaped.adapter.submit(actor, multiInput), /profile_not_admitted/); assert.equal(shaped.counts().calls, 0);

      // Any uncertain POST burns local attempt; never replay even with a fresh adapter instance.
      for (const response of [() => json({}), () => json({ id: "../foreign" }), () => json({}, 500), () => json({}, 429), () => json({}, 401), () => json({}, 302), () => new Response("bad-json"), () => new Response("x".repeat(64001)), () => { throw new Error("SECRET provider response"); }, () => new Promise<Response>(() => undefined), () => new Response(new ReadableStream({ start() {} }))]) {
        const t = fixture(() => response());
        assert.equal((await t.adapter.submit(actor, input)).status, "unknown");
        const again = createSeedanceAdapter(t.options); assert.equal((await again.submit(actor, input)).code, "existing_attempt_no_post");
        assert.equal((await again.get(actor, input.requestKey)).code, "unknown_no_task_id"); assert.equal(t.counts().posts, 1); assert.equal(t.counts().gets, 0);
        assert.ok(!JSON.stringify([...t.rows.values()]).includes("SECRET"));
      }
      const dbDown = fixture(); dbDown.options.journal = { atomic: async () => { throw new Error("SECRET db unavailable"); } }; await assert.rejects(() => dbDown.adapter.submit(actor, input), /^Error: seedance_journal_unavailable$/); assert.equal(dbDown.counts().calls, 0);
      const afterCommit = fixture(); const atomic = afterCommit.options.journal.atomic; let writes = 0;
      afterCommit.options.journal = { atomic: async (key, update) => { if (++writes === 2) throw new Error("synthetic_db_down"); return atomic(key, update); } };
      await assert.rejects(() => afterCommit.adapter.submit(actor, input), /journal_unavailable/);
      assert.equal((await createSeedanceAdapter(afterCommit.options).submit(actor, input)).status, "unknown"); assert.equal(afterCommit.counts().posts, 1);

      for (const status of ["queued", "running", "failed", "expired"] as const) {
        const t = fixture(method => json(method === "POST" ? { id: success.id } : { id: success.id, model: SEEDANCE_MODEL, status }));
        await t.adapter.submit(actor, input); assert.equal((await t.adapter.get(actor, input.requestKey)).status, status);
        if (["failed", "expired"].includes(status)) { t.advance(); assert.equal((await t.adapter.get(actor, input.requestKey)).code, "terminal_cached"); }
      }
      for (const bad of [{ ...success, id: "cgt-foreign" }, { ...success, model: "wrong-model" }, { ...success, status: "completed" }, { ...success, content: {} }, { ...success, duration: 15 }, { ...success, content: { video_url: "https://evil.test/a.mp4" } }, { ...success, content: { video_url: "http://127.0.0.1/a.mp4" } }, { ...success, content: { video_url: "https://ark-content-generation-cn-beijing.tos-cn-beijing.volces.com/a.html" } }]) {
        const t = fixture(method => json(method === "POST" ? { id: success.id } : bad)); await t.adapter.submit(actor, input);
        const result = await t.adapter.get(actor, input.requestKey); assert.equal(result.status, "unknown"); assert.equal(result.resultUrl, undefined);
        t.advance(); assert.equal((await t.adapter.get(actor, input.requestKey)).code, "terminal_cached"); assert.equal(t.counts().gets, 1);
      }
      for (const retryStatus of [429, 503, 408]) {
        const t = fixture(method => method === "POST" ? json({ id: success.id }) : json({}, retryStatus, { "Retry-After": "120" }));
        await t.adapter.submit(actor, input); assert.equal((await t.adapter.get(actor, input.requestKey)).status, "unknown");
        t.advance(119000); assert.equal((await t.adapter.get(actor, input.requestKey)).code, "poll_backoff"); t.advance(1000);
        for (let i = 0; i < 19; i++) { await t.adapter.get(actor, input.requestKey); t.advance(120000); }
        assert.equal((await t.adapter.get(actor, input.requestKey)).code, "poll_budget_exhausted"); assert.equal(t.counts().gets, 20); assert.equal(t.counts().posts, 1);
      }
      const longRetry = fixture(method => method === "POST" ? json({ id: success.id }) : json({}, 429, { "Retry-After": "86400" }));
      await longRetry.adapter.submit(actor, input); await longRetry.adapter.get(actor, input.requestKey); longRetry.advance(3600000);
      assert.equal((await longRetry.adapter.get(actor, input.requestKey)).code, "poll_budget_exhausted"); assert.equal(longRetry.counts().gets, 1);
      const concurrent = fixture(); await concurrent.adapter.submit(actor, input);
      await Promise.all(Array.from({ length: 10 }, () => concurrent.adapter.get(actor, input.requestKey))); assert.equal(concurrent.counts().gets, 1);
      const corrupt = fixture(); await corrupt.adapter.submit(actor, input);
      [...corrupt.rows.values()][0].taskId = "../../other"; await assert.rejects(() => corrupt.adapter.get(actor, input.requestKey), /journal_task_id_invalid/); assert.equal(corrupt.counts().gets, 0);
      const crashedGet = fixture(); await crashedGet.adapter.submit(actor, input);
      [...crashedGet.rows.values()][0].pollLeaseUntil = 32000; [...crashedGet.rows.values()][0].pollCount = 1;
      assert.equal((await crashedGet.adapter.get(actor, input.requestKey)).code, "poll_backoff"); crashedGet.advance(32000);
      assert.equal((await createSeedanceAdapter(crashedGet.options).get(actor, input.requestKey)).status, "succeeded"); assert.equal(crashedGet.counts().posts, 1);
      const getTimeout = fixture(method => method === "POST" ? json({ id: success.id }) : new Promise<Response>(() => undefined));
      await getTimeout.adapter.submit(actor, input); assert.equal((await getTimeout.adapter.get(actor, input.requestKey)).code, "response_unknown");
      const permanent = fixture(method => method === "POST" ? json({ id: success.id }) : json({}, 401));
      await permanent.adapter.submit(actor, input); await permanent.adapter.get(actor, input.requestKey); permanent.advance();
      assert.equal((await permanent.adapter.get(actor, input.requestKey)).code, "terminal_cached"); assert.equal(permanent.counts().gets, 1);
      const redirect = fixture(method => method === "POST" ? json({ id: success.id }) : json({}, 302, { Location: "http://127.0.0.1/private" }));
      await redirect.adapter.submit(actor, input); assert.equal((await redirect.adapter.get(actor, input.requestKey)).code, "redirect_rejected"); assert.equal(redirect.counts().gets, 1);
      const retryDate = fixture(method => method === "POST" ? json({ id: success.id }) : json({}, 429, { "Retry-After": new Date(121000).toUTCString() }));
      await retryDate.adapter.submit(actor, input); await retryDate.adapter.get(actor, input.requestKey); retryDate.advance(119000);
      assert.equal((await retryDate.adapter.get(actor, input.requestKey)).code, "poll_backoff"); retryDate.advance(1000); await retryDate.adapter.get(actor, input.requestKey); assert.equal(retryDate.counts().gets, 2);
      const missingUsage = fixture(method => json(method === "POST" ? { id: success.id } : { ...success, usage: undefined })); await missingUsage.adapter.submit(actor, input);
      assert.equal((await missingUsage.adapter.get(actor, input.requestKey)).usage.estimatedCostMicros, null);
      for (const raw of [null, {}, { total_tokens: 108000 }, { completion_tokens: -1 }, { completion_tokens: "108000" }, { completion_tokens: 5, total_tokens: 4 }]) assert.equal(seedanceUsage(raw).estimatedCostMicros, null);
      assert.equal(seedanceUsage({ completion_tokens: 10, total_tokens: 12, cache_read_input_tokens: 2 }).estimatedCostMicros, "460");
      assert.equal(seedanceUsage({ completion_tokens: 10 }, true).estimatedCostMicros, "280");
      // BY51 real schema/fold integration, no balance mutation or separate ledger; estimate != invoice.
      const meter = createBeautyUsageMeter(replicationMemoryDb(), actor, `seedance-round-${round}`);
      const call = { step: "video_generation", attempt: 1, provider: "volcengine_ark", model: SEEDANCE_MODEL, mode: "controlled_mock" as const };
      await meter.begin(call, seedanceUsage(null).measures);
      await meter.observe(call, { status: "succeeded", code: "synthetic_observed", providerRequestFingerprint: "b".repeat(64), measures: seedanceUsage(success.usage).measures });
      const view = await meter.read(); assert.equal(view.callCount, 1); assert.equal(view.groups.length, 1);
      assert.equal(view.groups[0].estimatedCostMicros, "4968000"); assert.equal(view.groups[0].observedCostMicros, null);
      assert.equal(external, 0);
    }
    console.log(JSON.stringify({ result: "BY53_SEEDANCE_ADAPTER_PASS", rounds: 3, realProviderCalls: 0, externalCalls: external, costCny: 0, liveEnabled: false, database: "transactional_fixture_only" }));
  } finally { globalThis.fetch = original; }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });

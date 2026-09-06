import { isIP } from "node:net";
import { z } from "zod";
import { usageHash, type UsageMeasure, type UsageActor } from "./beauty-usage-metering";

// Independent protocol, NOT a replacement for the wan driver or an executable product route.
export const SEEDANCE_CONTRACT = "beauty-seedance-adapter-v1";
export const SEEDANCE_MODEL = "doubao-seedance-2-0-260128";
export const SEEDANCE_PRICE = "seedance-2-0-standard-720p-cn-20260905";
export const SEEDANCE_ENDPOINT = "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks";
const resultOrigin = "https://ark-content-generation-cn-beijing.tos-cn-beijing.volces.com";
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,120}$/);
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const role = z.enum(["reference_image", "reference_video", "reference_audio"]);
export const seedanceInputSchema = z.object({
  requestKey: z.string().regex(/^[a-zA-Z0-9_-]{12,120}$/),
  // Product limit (not an asserted official hard character limit).
  text: z.string().trim().min(1).max(2000),
  references: z.array(z.object({ fileId: id, role }).strict()).min(1).max(15),
  duration: z.literal(5), resolution: z.literal("720p"), ratio: z.literal("9:16"),
  generateAudio: z.boolean()
}).strict().superRefine((v, ctx) => {
  const counts = ["reference_image", "reference_video", "reference_audio"].map(r => v.references.filter(x => x.role === r).length);
  if (counts[0] > 9 || counts[1] > 3 || counts[2] > 3 || !counts[0] && !counts[1] || new Set(v.references.map(r => r.fileId)).size !== v.references.length)
    ctx.addIssue({ code: "custom", message: "reference_shape_invalid" });
});
export type SeedanceInput = z.infer<typeof seedanceInputSchema>;
const actorSchema = z.object({ tenantId: id, userId: id, storeId: id }).strict();

/** This record must come from a SERVER resolver, never from client JSON. Format != rights.
 * Actual Ark asset verification + purpose migration from video_replacement is NOT implemented here. */
export const seedanceEvidenceSchema = z.object({
  fileId: id, tenantId: id, userId: id, storeId: id, role,
  product: z.literal("beauty-industry"), purpose: z.literal("seedance_multireference"),
  model: z.literal(SEEDANCE_MODEL), authorizationVersion: z.number().int().positive(), sha256: sha,
  reviewed: z.literal(true), revoked: z.literal(false), expiresAt: z.number().finite(),
  bytes: z.number().int().positive(), mime: z.string(), width: z.number().int().optional(), height: z.number().int().optional(),
  seconds: z.number().finite().optional(), fps: z.number().finite().optional(), codec: z.string().optional(),
  containsPerson: z.boolean(), voiceAuthorized: z.boolean(),
  uri: z.string().max(4096), delivery: z.enum(["ark_asset", "approved_https"]),
  accountBinding: id, officialAssetAccepted: z.boolean(), portraitAuthorized: z.boolean(),
  // For HTTPS, exact server-approved origin and DNS pin evidence. No suffix matching.
  approvedOrigin: z.string().optional(), resolvedAddresses: z.array(z.string()).max(16).optional()
}).strict();
export type SeedanceEvidence = z.infer<typeof seedanceEvidenceSchema>;
export type SeedanceAuthority = {
  actor: UsageActor; entitlement: boolean; accountBinding: string; assets: SeedanceEvidence[];
};

export class SeedanceError extends Error {}
function fail(code: string): never { throw new SeedanceError(`seedance_${code}`); }
const sameActor = (a: UsageActor, b: UsageActor) => a?.tenantId === b.tenantId && a?.userId === b.userId && a?.storeId === b.storeId;
const assetBinding = (authority: SeedanceAuthority, assets: SeedanceEvidence[]) => usageHash(JSON.stringify([authority.accountBinding, assets.map(a => [a.fileId, a.sha256, a.authorizationVersion])]));
function parse<T>(schema: z.ZodType<T>, value: unknown, code: string): T {
  const p = schema.safeParse(value); if (!p.success) return fail(code); return p.data;
}
function publicV4(value: string) {
  if (isIP(value) !== 4) return false; // IPv6 not yet independently verified: fail closed.
  const [a, b] = value.split(".").map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && [0, 168].includes(b) || a === 100 && b >= 64 && b <= 127 || a === 198 && [18, 19, 51].includes(b) || a === 203 && b === 0);
}
function httpsUrl(value: string, origin: string) {
  if (value.length > 4096) return fail("url_rejected");
  let u: URL; try { u = new URL(value); } catch { return fail("url_rejected"); }
  if (u.protocol !== "https:" || u.origin !== origin || u.username || u.password || u.hash || isIP(u.hostname) || u.hostname.startsWith("[") || u.port || /%(?:0d|0a)/i.test(value)) return fail("url_rejected");
  return u;
}
function checkEvidence(a: SeedanceEvidence, now: number) {
  if (a.expiresAt <= now) fail("asset_authorization_expired");
  if (a.delivery === "ark_asset") {
    if (!/^asset:\/\/[A-Za-z0-9_-]{1,120}$/.test(a.uri) || !a.officialAssetAccepted) fail("official_asset_required");
  } else {
    if (!a.approvedOrigin || !a.resolvedAddresses?.length || !a.resolvedAddresses.every(publicV4)) fail("asset_origin_unverified");
    const u = httpsUrl(a.uri, a.approvedOrigin);
    if (!u.hostname.includes(".") || /\.(local|internal|localhost|invalid)$/.test(u.hostname)) fail("url_rejected");
  }
  if (a.containsPerson && (a.delivery !== "ark_asset" || !a.portraitAuthorized || !a.officialAssetAccepted)) fail("portrait_authorization_required");
  if (a.role === "reference_audio" && !a.voiceAuthorized || a.role === "reference_video" && !a.voiceAuthorized) fail("audio_authorization_required");
  const image = a.role === "reference_image", video = a.role === "reference_video";
  if (image || video) {
    if (!a.width || !a.height || a.width < 300 || a.height < 300 || a.width > 6000 || a.height > 6000 || a.width / a.height < .4 || a.width / a.height > 2.5) fail("asset_dimensions_invalid");
  }
  if (image && (!/^image\/(jpeg|png|webp|bmp|tiff|gif|heic|heif)$/.test(a.mime) || a.bytes >= 30 * 1024 ** 2)) fail("image_metadata_invalid");
  if (video && (!['video/mp4', 'video/quicktime'].includes(a.mime) || !['h264', 'h265'].includes(a.codec ?? '') || !a.fps || a.fps < 24 || a.fps > 60 || a.width! * a.height! < 407696 || a.width! * a.height! > 8295044 || a.bytes > 200 * 1024 ** 2)) fail("video_metadata_invalid");
  if (a.role === "reference_audio" && (!['audio/wav', 'audio/mpeg'].includes(a.mime) || a.bytes > 15 * 1024 ** 2)) fail("audio_metadata_invalid");
  if (!image && (!a.seconds || a.seconds < 2 || a.seconds > 15)) fail("reference_duration_invalid");
}

/** Pure schema/authority composition. Valid multimodal shape is NOT admission to execute it. */
export function buildSeedancePayload(raw: unknown, actor: UsageActor, authority: SeedanceAuthority, now: number) {
  const input = parse(seedanceInputSchema, raw, "input_invalid");
  parse(actorSchema, actor, "actor_invalid");
  if (!authority?.entitlement || !sameActor(authority.actor, actor) || !id.safeParse(authority.accountBinding).success || !Array.isArray(authority.assets) || authority.assets.length !== input.references.length) fail("asset_not_found");
  const assets = input.references.map(ref => {
    const a = parse(seedanceEvidenceSchema, authority.assets.find(x => x.fileId === ref.fileId), "asset_evidence_required");
    if (a.tenantId !== actor.tenantId || a.userId !== actor.userId || a.storeId !== actor.storeId || a.role !== ref.role || a.accountBinding !== authority.accountBinding) fail("asset_not_found");
    checkEvidence(a, now); return a;
  });
  for (const r of ["reference_video", "reference_audio"]) if (assets.filter(a => a.role === r).reduce((n, a) => n + a.seconds!, 0) > 15) fail("reference_duration_invalid");
  const content = [{ type: "text", text: input.text }, ...assets.map(a => {
    const type = a.role.replace("reference_", "") + "_url";
    return { type, [type]: { url: a.uri }, role: a.role };
  })];
  const payload = { model: SEEDANCE_MODEL, content, resolution: input.resolution, ratio: input.ratio, duration: input.duration,
    generate_audio: input.generateAudio, watermark: false, execution_expires_after: 3600 };
  if (Buffer.byteLength(JSON.stringify(payload)) > 64 * 1024 ** 2) fail("request_too_large");
  return { input, payload, assets };
}

export function seedanceUsage(raw: unknown, withVideo = false): { measures: UsageMeasure[]; totalTokens: number | null; estimatedCostMicros: string | null } {
  const schema = z.object({ completion_tokens: z.number().int().nonnegative().max(1e10), total_tokens: z.number().int().nonnegative().max(1e10).optional() });
  const parsed = schema.safeParse(raw);
  const valid = parsed.success && (parsed.data.total_tokens === undefined || parsed.data.total_tokens >= parsed.data.completion_tokens);
  const q = valid ? parsed.data.completion_tokens : null;
  // total is diagnostic only; never additive to completion. No inferred cache/prompt/reasoning buckets.
  const rate = withVideo ? 28 : 46;
  return { totalTokens: valid ? parsed.data.total_tokens ?? null : null,
    estimatedCostMicros: q === null ? null : String(BigInt(q) * BigInt(rate)),
    measures: [{ unit: "token", meter: "completion", quantity: q === null ? null : String(q), source: q === null ? "unknown" : "provider_usage",
      currency: "CNY", priceVersion: SEEDANCE_PRICE, unitPriceMicros: String(rate), observedCostMicros: null, billingSource: "unknown" }] };
}
export const SEEDANCE_FIRST_PROFILE_ESTIMATE_MICROS = "4968000"; // 108000 tokens. Estimate, NOT a cloud spending cap.
export type SeedanceState = "queued" | "running" | "succeeded" | "failed" | "expired" | "unknown";
export type SeedanceReceipt = { status: SeedanceState; code: string; taskId?: string; resultUrl?: string; usage: ReturnType<typeof seedanceUsage> };
export type SeedanceSafeEvent = { stage: "submit" | "get"; code: string; status: SeedanceState; httpStatus?: number; elapsedMs: number;
  responseHash?: string; responseBytes?: number; taskFingerprint?: string; requestFingerprint: string; model: typeof SEEDANCE_MODEL };
export type SeedanceRow = { fingerprint: string; taskId?: string; status: SeedanceState; createdAt: number; pollCount: number;
  nextPollAt: number; pollLeaseUntil: number; halted: boolean; references: SeedanceInput["references"]; assetBinding: string;
  usage: ReturnType<typeof seedanceUsage>; events: SeedanceSafeEvent[] };
/** Future implementation MUST be a durable atomic transaction/CAS, not an in-process mutex.
 * No live implementation is exported; fixture journal exercises protocol transitions without a second queue. */
export interface SeedanceJournal {
  atomic<T>(key: string, update: (row: SeedanceRow | null) => { row: SeedanceRow | null; value: T }): Promise<T>;
}
type FixtureOptions = {
  mode: "fixture" | "controlled"; apiKey?: string; transport: typeof fetch; journal: SeedanceJournal;
  resolve: (actor: UsageActor, refs: SeedanceInput["references"]) => Promise<SeedanceAuthority>;
  now?: () => number; timeoutMs?: number;
};

/** No env/default fetch/public route. Controlled mode is assembled only by the signed server
 * execution service; a protocol adapter alone never grants product admission. */
export function createSeedanceAdapter(options?: FixtureOptions) {
  const now = options?.now ?? Date.now;
  function configured(): FixtureOptions {
    if (!options || !["fixture", "controlled"].includes(options.mode) || typeof options.transport !== "function" || !options.journal || !options.resolve ||
      options.mode === "controlled" && (!options.apiKey || options.apiKey.length < 16 || /\s/.test(options.apiKey))) fail("disabled");
    return options;
  }
  async function atomic<T>(key: string, update: (row: SeedanceRow | null) => { row: SeedanceRow | null; value: T }) {
    try { return await configured().journal.atomic(key, update); }
    catch (error) { if (error instanceof SeedanceError) throw error; return fail("journal_unavailable"); }
  }
  const keyFor = (actor: UsageActor, key: string) => { parse(actorSchema, actor, "actor_invalid"); if (!/^[a-zA-Z0-9_-]{12,120}$/.test(key)) fail("request_key_invalid"); return usageHash(JSON.stringify([SEEDANCE_CONTRACT, actor.tenantId, actor.userId, actor.storeId, key])); };
  async function call(method: "POST" | "GET", taskId?: string, payload?: unknown) {
    const c = configured(), started = now(), abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const meta: { httpStatus?: number; responseHash?: string; responseBytes?: number } = {};
    try {
      const result = await Promise.race([
        (async () => {
          const r = await c.transport(SEEDANCE_ENDPOINT + (taskId ? `/${taskId}` : ""), { method, redirect: "error", signal: abort.signal,
            headers: { Authorization: `Bearer ${c.mode === "fixture" ? "synthetic-offline-only" : c.apiKey}`, "Content-Type": "application/json" }, body: payload ? JSON.stringify(payload) : undefined });
          meta.httpStatus = r.status;
          if (abort.signal.aborted) fail("response_unknown");
          if (r.redirected || r.status >= 300 && r.status < 400) return { code: "redirect_rejected", data: null, retryAfterMs: 0 };
          if (!r.ok) {
            const retry = r.headers.get("retry-after");
            const parsed = retry && /^\d+$/.test(retry) ? Number(retry) * 1000 : retry ? Date.parse(retry) - now() : 0;
            return { code: `http_${r.status}`, data: null, retryAfterMs: Number.isFinite(parsed) ? Math.max(0, parsed) : 0 };
          }
          if (!r.body) fail("response_unknown");
          reader = r.body.getReader(); const parts: Uint8Array[] = []; let length = 0;
          for (;;) { const chunk = await reader.read(); if (chunk.done) break; length += chunk.value.byteLength; if (length > 64000) fail("response_too_large"); parts.push(chunk.value); }
          const text = Buffer.concat(parts).toString("utf8"); meta.responseBytes = length; meta.responseHash = usageHash(text);
          try { return { code: "response_received", data: JSON.parse(text), retryAfterMs: 0 }; } catch { return { code: "response_malformed", data: null, retryAfterMs: 0 }; }
        })(),
        new Promise<never>((_, reject) => { timer = setTimeout(() => { abort.abort(); reject(new Error("timeout")); }, Math.max(1, Math.min(30000, c.timeoutMs ?? 30000))); })
      ]);
      return { ...result, ...meta, elapsedMs: Math.max(0, now() - started) };
    } catch { return { code: "response_unknown", data: null, retryAfterMs: 0, ...meta, elapsedMs: Math.max(0, now() - started) }; }
    finally { if (timer) clearTimeout(timer); abort.abort(); if (reader) void reader.cancel().catch(() => undefined); }
  }
  return {
    enabled: false as const, // Never product-admitted, even when synthetic protocol tests are enabled.
    async submit(actor: UsageActor, raw: unknown): Promise<SeedanceReceipt> {
      const c = configured(), input = parse(seedanceInputSchema, raw, "input_invalid"), key = keyFor(actor, input.requestKey);
      const authority = await c.resolve(actor, input.references).catch(() => fail("authority_unavailable"));
      const built = buildSeedancePayload(input, actor, authority, now());
      if (built.assets.length !== 2 || built.assets.some(a => a.role !== "reference_image")) fail("profile_not_admitted");
      // Signed URLs may rotate. Bind semantic request + stable authorization versions/hashes, not URLs.
      const fingerprint = usageHash(JSON.stringify([input, authority.accountBinding, built.assets.map(a => [a.fileId, a.sha256, a.authorizationVersion])]));
      const claim = await atomic(key, previous => {
        if (previous) { if (previous.fingerprint !== fingerprint) fail("request_conflict"); return { row: previous, value: { created: false, row: previous } }; }
        const row: SeedanceRow = { fingerprint, status: "unknown", createdAt: now(), pollCount: 0, nextPollAt: now(), pollLeaseUntil: 0,
          halted: false, references: input.references, assetBinding: assetBinding(authority, built.assets), usage: seedanceUsage(null), events: [] };
        return { row, value: { created: true, row } };
      });
      if (!claim.created) return { status: claim.row.status, code: "existing_attempt_no_post", taskId: claim.row.taskId, usage: claim.row.usage };
      const response = await call("POST", undefined, built.payload);
      const parsedId = id.safeParse(response.data?.id);
      const taskId = response.code === "response_received" && parsedId.success ? parsedId.data : undefined;
      const status = taskId ? "queued" : "unknown", code = taskId ? "accepted" : response.code === "response_received" ? "task_id_missing" : response.code;
      const event: SeedanceSafeEvent = { stage: "submit", code, status, requestFingerprint: fingerprint, model: SEEDANCE_MODEL,
        httpStatus: response.httpStatus, elapsedMs: response.elapsedMs, responseHash: response.responseHash, responseBytes: response.responseBytes,
        taskFingerprint: taskId ? usageHash(taskId) : undefined };
      await atomic(key, row => { if (!row || row.fingerprint !== fingerprint) fail("journal_conflict"); return { row: { ...row, status, taskId, events: [...row.events, event] }, value: null }; });
      return { status, code, taskId, usage: seedanceUsage(null) };
    },
    async get(actor: UsageActor, requestKey: string): Promise<SeedanceReceipt> {
      const c = configured(), key = keyFor(actor, requestKey);
      const current = await atomic(key, row => ({ row, value: row }));
      if (!current) fail("task_not_found");
      if (current.taskId !== undefined && !id.safeParse(current.taskId).success) fail("journal_task_id_invalid");
      const auth = await c.resolve(actor, current.references).catch(() => fail("authority_unavailable"));
      const checked = buildSeedancePayload({ requestKey, text: "authorization check", references: current.references,
        duration: 5, resolution: "720p", ratio: "9:16", generateAudio: false }, actor, auth, now());
      if (assetBinding(auth, checked.assets) !== current.assetBinding) fail("asset_authorization_changed");
      const claim = await atomic(key, row => {
        if (!row) fail("task_not_found");
        let code = "poll_claimed";
        if (!row.taskId) code = "unknown_no_task_id";
        else if (row.halted || ["failed", "expired"].includes(row.status)) code = "terminal_cached";
        else if (row.pollCount >= 20 || now() - row.createdAt >= 3600000) code = "poll_budget_exhausted";
        else if (row.nextPollAt > now() || row.pollLeaseUntil > now()) code = "poll_backoff";
        if (code !== "poll_claimed") return { row, value: { row, code, execute: false } };
        const next = { ...row, pollCount: row.pollCount + 1, pollLeaseUntil: now() + 31000 };
        return { row: next, value: { row: next, code, execute: true } };
      });
      if (!claim.execute) return { status: claim.row.status, code: claim.code, taskId: claim.row.taskId, usage: claim.row.usage };
      const response = await call("GET", claim.row.taskId);
      const b = response.data; let status: SeedanceState = "unknown", code = response.code, resultUrl: string | undefined;
      let usage = seedanceUsage(null);
      if (response.code === "response_received") {
        if (b?.id !== claim.row.taskId || b?.model !== SEEDANCE_MODEL || !["queued", "running", "succeeded", "failed", "expired"].includes(b?.status)) code = "task_contract_invalid";
        else {
          status = b.status; code = "status_observed"; usage = seedanceUsage(b.usage);
          if (status === "succeeded") {
            try {
              if (b.resolution !== "720p" || b.ratio !== "9:16" || b.duration !== 5 || b.framespersecond !== 24 || typeof b.content?.video_url !== "string") fail("result_contract_invalid");
              const u = httpsUrl(b.content.video_url, resultOrigin); if (!/\.mp4$/i.test(u.pathname)) fail("result_contract_invalid");
              resultUrl = u.toString();
            } catch { status = "unknown"; code = "result_contract_invalid"; }
          }
          if (claim.row.status === "succeeded" && status !== "succeeded") { status = "unknown"; code = "terminal_conflict"; resultUrl = undefined; }
        }
      }
      const event: SeedanceSafeEvent = { stage: "get", code, status, requestFingerprint: claim.row.fingerprint, model: SEEDANCE_MODEL,
        httpStatus: response.httpStatus, elapsedMs: response.elapsedMs, responseHash: response.responseHash, responseBytes: response.responseBytes, taskFingerprint: usageHash(claim.row.taskId!) };
      const delay = Math.max(1000 * 2 ** Math.min(claim.row.pollCount - 1, 6), response.retryAfterMs);
      const retryable = response.code === "response_unknown" || response.httpStatus === 408 || response.httpStatus === 429 || (response.httpStatus ?? 0) >= 500;
      const halted = status === "unknown" && !retryable;
      await atomic(key, row => {
        if (!row || row.pollCount !== claim.row.pollCount) fail("poll_lease_lost");
        return { row: { ...row, status, halted, usage, nextPollAt: now() + delay, pollLeaseUntil: 0, events: [...row.events, event] }, value: null };
      });
      // Signed result URL is transient for a future authorized downloader; never part of audit events/journal.
      return { status, code, taskId: claim.row.taskId, resultUrl, usage };
    }
  };
}

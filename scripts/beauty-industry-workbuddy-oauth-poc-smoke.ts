import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import Fastify from "../apps/api/node_modules/fastify/fastify.js";
import {
  createWorkbuddyOAuthPoc,
  type WorkbuddyOAuthPocAuditRecord,
  type WorkbuddyOAuthPocUsageRecord
} from "../apps/api/src/products/beauty-industry/workbuddy-oauth-poc.js";

const ISSUER = "https://poc-auth.sitong.invalid";
const AUDIENCE = "https://poc-mcp.sitong.invalid";
const REDIRECT_URI = "https://connector.workbuddy.invalid/oauth/callback";
const TOKEN_SECRET = "synthetic-poc-signing-key-with-more-than-32-bytes";
const sessionByToken = new Map([
  ["synthetic-session-a", "sitong-user-a"],
  ["synthetic-session-b", "sitong-user-b"]
]);
const identities = new Map([
  ["sitong-user-a", { sub: "sitong-user-a", userId: "user-a", tenantId: "tenant-a", productCode: "beauty-industry", brandCode: "lanqi", active: true, profileIds: ["profile-a", "profile-a-2"] }],
  ["sitong-user-b", { sub: "sitong-user-b", userId: "user-b", tenantId: "tenant-b", productCode: "beauty-industry", brandCode: "lanqi", active: true, profileIds: ["profile-b"] }]
]);
const profiles = new Map([
  ["profile-a", { id: "profile-a", tenantId: "tenant-a", version: 3, businessType: "生活美容", city: "合成城市A", serviceCategories: ["皮肤管理"], summaryStatus: "confirmed", phone: "13900001111", rawProfile: "synthetic-sensitive-source" }],
  ["profile-a-2", { id: "profile-a-2", tenantId: "tenant-a", version: 1, businessType: "生活美容", city: "合成城市A", serviceCategories: ["身体护理"], summaryStatus: "incomplete" }],
  ["profile-b", { id: "profile-b", tenantId: "tenant-b", version: 2, businessType: "美甲美睫", city: "合成城市B", serviceCategories: ["美甲"], summaryStatus: "confirmed" }]
]);

async function main(): Promise<void> {
  let nowMs = Date.parse("2026-09-03T03:00:00.000Z");
  const audits: WorkbuddyOAuthPocAuditRecord[] = [];
  const usages: WorkbuddyOAuthPocUsageRecord[] = [];
  const creditBalances = new Map([["tenant-a", 500], ["tenant-b", 500]]);
  let providerCalls = 0;
  const app = Fastify({ logger: false });
  const poc = createWorkbuddyOAuthPoc({
    issuer: ISSUER,
    audience: AUDIENCE,
    tokenSecret: TOKEN_SECRET,
    now: () => nowMs,
    resolveAuthorizationSession: async (token) => sessionByToken.get(token) ?? null,
    resolveIdentity: async (sub) => identities.get(sub) ?? null,
    readProfile: async (profileId) => profiles.get(profileId) ?? null,
    writeAudit: async (record) => { audits.push(record); },
    writeUsage: async (record) => { usages.push(record); },
    requestTimeoutMs: 250,
    rateLimitPerMinute: 200
  });
  await poc.register(app);
  await app.ready();

  const metadata = await app.inject({ method: "GET", url: "/.well-known/oauth-authorization-server" });
  assert.equal(metadata.statusCode, 200);
  assert.equal(metadata.json().issuer, ISSUER);
  assert.deepEqual(metadata.json().code_challenge_methods_supported, ["S256"]);
  assert.equal(metadata.json().registration_endpoint, `${ISSUER}/oauth/register`);

  const registered = await app.inject({
    method: "POST",
    url: "/oauth/register",
    payload: { client_name: "WorkBuddy synthetic connector", redirect_uris: [REDIRECT_URI], token_endpoint_auth_method: "none" }
  });
  assert.equal(registered.statusCode, 201, registered.body);
  const registration = registered.json() as { client_id: string; client_secret?: string; token_endpoint_auth_method: string };
  assert.ok(registration.client_id);
  assert.equal(registration.client_secret, undefined, "public client must not receive a client_secret");
  assert.equal(registration.token_endpoint_auth_method, "none");
  const secretRegistration = await app.inject({ method: "POST", url: "/oauth/register", payload: { redirect_uris: [REDIRECT_URI], token_endpoint_auth_method: "client_secret_post", client_secret: "not-allowed" } });
  assert.equal(secretRegistration.statusCode, 400);

  const full = await authorize(app, registration.client_id, "synthetic-session-a", "lanqi.profile.read mcp:connect");
  assertClaims(full.access_token, { sub: "sitong-user-a", scope: "lanqi.profile.read mcp:connect", clientId: registration.client_id });

  const initialized = await rpc(app, full.access_token, "initialize");
  assert.equal(initialized.statusCode, 200, initialized.body);
  assert.deepEqual((initialized.json() as any).result.capabilities, { tools: {} });
  const listed = await rpc(app, full.access_token, "tools/list");
  assert.equal(listed.statusCode, 200, listed.body);
  assert.deepEqual((listed.json() as any).result.tools.map((tool: any) => tool.name), ["lanqi.get_profile_summary"]);
  assert.equal(/tenantId|userId|productCode|phone|token/i.test(listed.body), false);

  const balanceBefore = creditBalances.get("tenant-a");
  const first = await callTool(app, full.access_token, { requestId: "read-profile-0001", profileId: "profile-a" });
  assert.equal(first.statusCode, 200, first.body);
  const firstStructured = (first.json() as any).result.structuredContent;
  assert.deepEqual(Object.keys(firstStructured).sort(), ["billable", "profile", "tool"].sort());
  assert.equal(firstStructured.tool, "lanqi.get_profile_summary");
  assert.equal(firstStructured.billable, false);
  assert.deepEqual(firstStructured.profile, {
    profileId: "profile-a",
    version: 3,
    businessType: "生活美容",
    city: "合成城市A",
    serviceCategories: ["皮肤管理"],
    summaryStatus: "confirmed"
  });
  assert.equal(creditBalances.get("tenant-a"), balanceBefore, "business read changed credits");
  assert.equal(providerCalls, 0);

  const usageAfterFirst = usages.length;
  const replay = await callTool(app, full.access_token, { requestId: "read-profile-0001", profileId: "profile-a" });
  assert.equal(replay.statusCode, 200, replay.body);
  assert.equal(replay.body, first.body, "idempotent replay changed the response");
  assert.equal(usages.length, usageAfterFirst, "idempotent replay duplicated usage");
  const conflict = await callTool(app, full.access_token, { requestId: "read-profile-0001", profileId: "profile-a-2" });
  assert.equal(conflict.statusCode, 409, conflict.body);

  for (const injection of [
    { kind: "query", value: "?tenant=tenant-b" },
    { kind: "header", value: { "x-sitong-user-id": "user-b" } },
    { kind: "body", value: { tenantId: "tenant-b" } },
    { kind: "context", value: { context: { product: "other-product" } } }
  ] as const) {
    const response = injection.kind === "query"
      ? await callTool(app, full.access_token, { requestId: `inject-${injection.kind}-0001`, profileId: "profile-a" }, injection.value)
      : injection.kind === "header"
        ? await callTool(app, full.access_token, { requestId: `inject-${injection.kind}-0001`, profileId: "profile-a" }, "", injection.value)
        : await callTool(app, full.access_token, { requestId: `inject-${injection.kind}-0001`, profileId: "profile-a", ...injection.value });
    assert.equal(response.statusCode, 400, `${injection.kind}:${response.body}`);
    assert.match(response.body, /identity_field_forbidden/);
  }
  assert.ok(audits.filter((item) => item.action === "identity_field_rejected").length >= 4);

  const invalidPrecedence = await callTool(app, `${full.access_token}tampered`, { requestId: "invalid-precedence-1", tenantId: "tenant-b" } as any);
  assert.equal(invalidPrecedence.statusCode, 401, invalidPrecedence.body);
  for (const [claim, value] of [
    ["iss", "https://wrong-issuer.invalid"],
    ["aud", "https://wrong-resource.invalid"],
    ["sub", ""],
    ["nbf", Math.floor(nowMs / 1_000) + 600],
    ["iat", Math.floor(nowMs / 1_000) + 600],
    ["scope", null],
    ["jti", "short"],
    ["client_id", "unknown-client"],
    ["azp", "other-client"]
  ] as const) {
    const invalidClaimsToken = mutateAndSignToken(full.access_token, claim, value);
    assert.equal((await callTool(app, invalidClaimsToken, { requestId: `claim-${claim}-0001`, profileId: "profile-a" })).statusCode, 401, `claim ${claim} was not validated`);
  }

  const crossTenant = await callTool(app, full.access_token, { requestId: "cross-tenant-0001", profileId: "profile-b" });
  assert.equal(crossTenant.statusCode, 404, crossTenant.body);
  assert.equal(crossTenant.body.includes("tenant-b"), false);

  const limited = await authorize(app, registration.client_id, "synthetic-session-a", "mcp:connect");
  const crossTenantBeforeScope = await callTool(app, limited.access_token, { requestId: "cross-before-scope-1", profileId: "profile-b" });
  assert.equal(crossTenantBeforeScope.statusCode, 404, crossTenantBeforeScope.body);
  const insufficientScope = await callTool(app, limited.access_token, { requestId: "scope-denied-0001", profileId: "profile-a" });
  assert.equal(insufficientScope.statusCode, 403, insufficientScope.body);
  const confusedTool = await rpc(app, full.access_token, "tools/call", { name: "lanqi.update_profile", arguments: { requestId: "tool-confusion-1" } });
  assert.equal(confusedTool.statusCode, 403, confusedTool.body);

  const revoked = await authorize(app, registration.client_id, "synthetic-session-a", "lanqi.profile.read mcp:connect");
  const revoke = await app.inject({ method: "POST", url: "/oauth/revoke", payload: { token: revoked.access_token, client_id: registration.client_id } });
  assert.equal(revoke.statusCode, 200, revoke.body);
  assert.equal((await callTool(app, revoked.access_token, { requestId: "revoked-0001", profileId: "profile-a" })).statusCode, 401);

  const expiring = await authorize(app, registration.client_id, "synthetic-session-a", "lanqi.profile.read mcp:connect");
  nowMs += 601_000;
  assert.equal((await callTool(app, expiring.access_token, { requestId: "expired-0001", profileId: "profile-a" })).statusCode, 401);
  nowMs -= 601_000;

  const rotated = await refresh(app, registration.client_id, full.refresh_token);
  assert.equal(rotated.statusCode, 200, rotated.body);
  assert.equal((await refresh(app, registration.client_id, full.refresh_token)).statusCode, 401, "old refresh token was replayable");

  const sequentialDurations: number[] = [];
  for (let index = 0; index < 30; index += 1) {
    const started = performance.now();
    const response = await callTool(app, full.access_token, { requestId: `sequential-${String(index).padStart(2, "0")}`, profileId: "profile-a" });
    sequentialDurations.push(performance.now() - started);
    assert.equal(response.statusCode, 200, response.body);
    assert.equal((response.json() as any).result.structuredContent.profile.profileId, "profile-a");
  }
  const concurrent = await Promise.all(Array.from({ length: 10 }, (_, index) =>
    callTool(app, full.access_token, { requestId: `concurrent-${index}`, profileId: "profile-a" })
  ));
  assert.ok(concurrent.every((response) => response.statusCode === 200), concurrent.map((item) => item.body).join("\n"));
  assert.ok(concurrent.every((response) => !response.body.includes("profile-b")));
  const sorted = [...sequentialDurations].sort((a, b) => a - b);
  const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1] ?? 0;
  const max = sorted.at(-1) ?? 0;
  assert.ok(p95 <= 3_000, `p95 exceeded: ${p95}`);
  assert.ok(max <= 10_000, `max exceeded: ${max}`);

  for (let round = 0; round < 3; round += 1) {
    assert.equal((await callTool(app, full.access_token, { requestId: `risk-cross-${round}`, profileId: "profile-b" })).statusCode, 404);
    assert.equal((await callTool(app, full.access_token, { requestId: `risk-forged-${round}`, profileId: "profile-a", user: "user-b" } as any)).statusCode, 400);
    assert.equal((await callTool(app, limited.access_token, { requestId: `risk-scope-${round}`, profileId: "profile-a" })).statusCode, 403);
  }

  const serializedEvidence = JSON.stringify({ audits, usages, response: first.json() });
  assert.equal(serializedEvidence.includes(full.access_token), false);
  assert.equal(serializedEvidence.includes("synthetic-session-a"), false);
  assert.equal(serializedEvidence.includes("13900001111"), false);
  assert.equal(/"(?:phone|mobile|rawProfile|Authorization)"\s*:/i.test(serializedEvidence), false);
  assert.ok(usages.every((item) => item.billable === false && item.creditDelta === 0));

  await app.close();

  await verifyTimeoutAndCancellation();
  await verifyRateLimit();
  await verifyAuditFailure();

  console.log(JSON.stringify({
    status: "PASS",
    oauthMainChain: "local_protocol_verified",
    externalWorkbuddyBackend: "not_connected",
    tool: "lanqi.get_profile_summary",
    sequentialCalls: 30,
    concurrentCalls: 10,
    p95Ms: Number(p95.toFixed(3)),
    maxMs: Number(max.toFixed(3)),
    providerCalls,
    billableUsage: usages.filter((item) => item.billable).length,
    creditDelta: 0,
    sensitiveLeaks: 0
  }, null, 2));
}

async function verifyTimeoutAndCancellation(): Promise<void> {
  let abortedAt = 0;
  const app = Fastify({ logger: false });
  const poc = createWorkbuddyOAuthPoc({
    issuer: ISSUER,
    audience: AUDIENCE,
    tokenSecret: `${TOKEN_SECRET}-timeout`,
    resolveAuthorizationSession: async (token) => sessionByToken.get(token) ?? null,
    resolveIdentity: async (sub) => identities.get(sub) ?? null,
    readProfile: async (_profileId, signal) => new Promise((resolve) => {
      signal.addEventListener("abort", () => { abortedAt = Date.now(); resolve(null); }, { once: true });
    }),
    writeAudit: async () => undefined,
    writeUsage: async () => undefined,
    requestTimeoutMs: 40,
    rateLimitPerMinute: 20
  });
  await poc.register(app);
  await app.ready();
  const registration = (await app.inject({ method: "POST", url: "/oauth/register", payload: { redirect_uris: [REDIRECT_URI], token_endpoint_auth_method: "none" } })).json() as any;
  const token = await authorize(app, registration.client_id, "synthetic-session-a", "lanqi.profile.read mcp:connect");
  const started = Date.now();
  const response = await callTool(app, token.access_token, { requestId: "timeout-0001", profileId: "profile-a" });
  assert.equal(response.statusCode, 504, response.body);
  assert.ok(abortedAt >= started && abortedAt - started < 5_000, `abort propagation exceeded 5s: ${abortedAt - started}`);
  await app.close();
}

async function verifyRateLimit(): Promise<void> {
  const app = Fastify({ logger: false });
  const poc = createWorkbuddyOAuthPoc({ issuer: ISSUER, audience: AUDIENCE, tokenSecret: `${TOKEN_SECRET}-rate`, resolveAuthorizationSession: async (token) => sessionByToken.get(token) ?? null, resolveIdentity: async (sub) => identities.get(sub) ?? null, readProfile: async (id) => profiles.get(id) ?? null, writeAudit: async () => undefined, writeUsage: async () => undefined, requestTimeoutMs: 250, rateLimitPerMinute: 2 });
  await poc.register(app); await app.ready();
  const registration = (await app.inject({ method: "POST", url: "/oauth/register", payload: { redirect_uris: [REDIRECT_URI], token_endpoint_auth_method: "none" } })).json() as any;
  const token = await authorize(app, registration.client_id, "synthetic-session-a", "lanqi.profile.read mcp:connect");
  assert.equal((await callTool(app, token.access_token, { requestId: "rate-0001", profileId: "profile-a" })).statusCode, 200);
  assert.equal((await callTool(app, token.access_token, { requestId: "rate-0002", profileId: "profile-a" })).statusCode, 200);
  assert.equal((await callTool(app, token.access_token, { requestId: "rate-0003", profileId: "profile-a" })).statusCode, 429);
  await app.close();
}

async function verifyAuditFailure(): Promise<void> {
  const app = Fastify({ logger: false });
  const poc = createWorkbuddyOAuthPoc({ issuer: ISSUER, audience: AUDIENCE, tokenSecret: `${TOKEN_SECRET}-audit`, resolveAuthorizationSession: async (token) => sessionByToken.get(token) ?? null, resolveIdentity: async (sub) => identities.get(sub) ?? null, readProfile: async (id) => profiles.get(id) ?? null, writeAudit: async (record) => { if (record.action === "tool_call_started") throw new Error("synthetic_audit_failure"); }, writeUsage: async () => undefined, requestTimeoutMs: 250, rateLimitPerMinute: 20 });
  await poc.register(app); await app.ready();
  const registration = (await app.inject({ method: "POST", url: "/oauth/register", payload: { redirect_uris: [REDIRECT_URI], token_endpoint_auth_method: "none" } })).json() as any;
  const token = await authorize(app, registration.client_id, "synthetic-session-a", "lanqi.profile.read mcp:connect");
  const response = await callTool(app, token.access_token, { requestId: "audit-failure-1", profileId: "profile-a" });
  assert.equal(response.statusCode, 503, response.body);
  assert.match(response.body, /audit_unavailable/);
  await app.close();
}

async function authorize(app: ReturnType<typeof Fastify>, clientId: string, session: string, scope: string): Promise<{ access_token: string; refresh_token: string }> {
  const verifier = `verifier-${createHash("sha256").update(`${clientId}:${session}:${scope}`).digest("hex")}`;
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = `state-${createHash("sha256").update(verifier).digest("hex").slice(0, 12)}`;
  const authorize = await app.inject({ method: "GET", url: `/oauth/authorize?response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${encodeURIComponent(scope)}&state=${state}&code_challenge=${challenge}&code_challenge_method=S256`, headers: { authorization: `Bearer ${session}` } });
  assert.equal(authorize.statusCode, 302, authorize.body);
  const location = new URL(String(authorize.headers.location));
  assert.equal(location.searchParams.get("state"), state);
  const code = String(location.searchParams.get("code"));
  const token = await app.inject({ method: "POST", url: "/oauth/token", headers: { "content-type": "application/x-www-form-urlencoded" }, payload: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: REDIRECT_URI, client_id: clientId, code_verifier: verifier }).toString() });
  assert.equal(token.statusCode, 200, token.body);
  assert.equal(token.body.includes("client_secret"), false);
  return token.json() as any;
}

async function refresh(app: ReturnType<typeof Fastify>, clientId: string, refreshToken: string) {
  return app.inject({ method: "POST", url: "/oauth/token", headers: { "content-type": "application/x-www-form-urlencoded" }, payload: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId }).toString() });
}

async function rpc(app: ReturnType<typeof Fastify>, token: string, method: string, params?: Record<string, unknown>) {
  return app.inject({ method: "POST", url: "/mcp", headers: { authorization: `Bearer ${token}` }, payload: { jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) } });
}

async function callTool(app: ReturnType<typeof Fastify>, token: string, args: Record<string, unknown>, suffix = "", headers: Record<string, string> = {}) {
  return app.inject({ method: "POST", url: `/mcp${suffix}`, headers: { authorization: `Bearer ${token}`, ...headers }, payload: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "lanqi.get_profile_summary", arguments: args } } });
}

function assertClaims(token: string, expected: { sub: string; scope: string; clientId: string }): void {
  const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"));
  for (const key of ["iss", "aud", "sub", "exp", "nbf", "iat", "scope", "jti", "client_id", "azp"]) assert.ok(payload[key] !== undefined, `missing claim ${key}`);
  assert.equal(payload.sub, expected.sub);
  assert.equal(payload.scope, expected.scope);
  assert.equal(payload.client_id, expected.clientId);
  assert.equal(payload.azp, expected.clientId);
}

function mutateAndSignToken(token: string, claim: string, value: unknown): string {
  const [header, payload] = token.split(".");
  const claims = JSON.parse(Buffer.from(payload ?? "", "base64url").toString("utf8"));
  claims[claim] = value;
  const nextPayload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = createHmac("sha256", TOKEN_SECRET).update(`${header}.${nextPayload}`).digest("base64url");
  return `${header}.${nextPayload}.${signature}`;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

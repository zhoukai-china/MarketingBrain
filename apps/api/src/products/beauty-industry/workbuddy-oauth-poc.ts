import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

const POC_TOOL = "lanqi.get_profile_summary";
const PRODUCT_CODE = "beauty-industry";
const REQUIRED_SCOPE = "lanqi.profile.read";
const CONNECT_SCOPE = "mcp:connect";
const ACCESS_TTL_SECONDS = 600;
const REFRESH_TTL_SECONDS = 3_600;
const AUTH_CODE_TTL_SECONDS = 120;
const MAX_CLOCK_SKEW_SECONDS = 30;
const IDENTITY_HEADER_NAMES = new Set([
  "x-sitong-tenant-id",
  "x-sitong-user-id",
  "x-sitong-product-code",
  "x-sitong-operating-entity-id",
  "x-tenant-id",
  "x-user-id",
  "x-product-code",
  "x-brand-code"
]);
const IDENTITY_FIELD_NAMES = new Set([
  "tenant",
  "tenantid",
  "user",
  "userid",
  "product",
  "productcode",
  "operatingentity",
  "operatingentityid",
  "brand",
  "brandcode"
]);

export interface WorkbuddyOAuthPocIdentity {
  sub: string;
  userId: string;
  tenantId: string;
  productCode: string;
  brandCode: string;
  active: boolean;
  profileIds: string[];
}

export interface WorkbuddyOAuthPocProfile {
  id: string;
  tenantId: string;
  version: number;
  businessType: string;
  city?: string;
  serviceCategories: string[];
  summaryStatus: "confirmed" | "incomplete";
}

export interface WorkbuddyOAuthPocAuditRecord {
  action: string;
  occurredAt: string;
  subjectHash?: string;
  tenantHash?: string;
  jtiHash?: string;
  requestHash?: string;
  tool?: string;
  status: string;
  httpStatus: number;
  durationMs?: number;
  replay?: boolean;
  reasonCode?: string;
  identitySurface?: "query" | "header" | "body";
}

export interface WorkbuddyOAuthPocUsageRecord {
  usageKeyHash: string;
  occurredAt: string;
  subjectHash: string;
  tenantHash: string;
  jtiHash: string;
  requestHash: string;
  tool: typeof POC_TOOL;
  billable: false;
  creditDelta: 0;
  durationMs: number;
  status: "succeeded";
}

export interface WorkbuddyOAuthPocOptions {
  issuer: string;
  audience: string;
  tokenSecret: string;
  now?: () => number;
  resolveAuthorizationSession: (sessionToken: string) => Promise<string | null>;
  resolveIdentity: (sub: string) => Promise<WorkbuddyOAuthPocIdentity | null>;
  readProfile: (profileId: string, signal: AbortSignal) => Promise<WorkbuddyOAuthPocProfile | null>;
  writeAudit: (record: WorkbuddyOAuthPocAuditRecord) => Promise<void>;
  writeUsage: (record: WorkbuddyOAuthPocUsageRecord) => Promise<void>;
  requestTimeoutMs?: number;
  rateLimitPerMinute?: number;
}

type RegisteredClient = {
  clientId: string;
  redirectUris: string[];
  createdAt: number;
};

type AuthorizationCode = {
  code: string;
  clientId: string;
  redirectUri: string;
  sub: string;
  scope: string;
  codeChallenge: string;
  expiresAt: number;
  used: boolean;
};

type OAuthClaims = {
  iss: string;
  aud: string;
  sub: string;
  exp: number;
  nbf: number;
  iat: number;
  scope: string;
  jti: string;
  client_id: string;
  azp: string;
  token_use: "access" | "refresh";
};

type JsonRpcId = string | number | null;
type JsonRpcRequest = {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: Record<string, unknown>;
};

type ToolResponse = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result: {
    content: Array<{ type: "text"; text: string }>;
    structuredContent: {
      tool: typeof POC_TOOL;
      billable: false;
      profile: {
        profileId: string;
        version: number;
        businessType: string;
        city?: string;
        serviceCategories: string[];
        summaryStatus: string;
      };
    };
  };
};

class PocHttpError extends Error {
  constructor(readonly statusCode: number, readonly code: string) {
    super(code);
  }
}

export function createWorkbuddyOAuthPoc(options: WorkbuddyOAuthPocOptions): {
  register(app: FastifyInstance): Promise<void>;
} {
  validateOptions(options);
  const now = options.now ?? Date.now;
  const issuer = options.issuer.replace(/\/$/, "");
  const clients = new Map<string, RegisteredClient>();
  const authorizationCodes = new Map<string, AuthorizationCode>();
  const revokedJtis = new Set<string>();
  const liveRefreshJtis = new Set<string>();
  const completed = new Map<string, { fingerprint: string; response: ToolResponse }>();
  const inflight = new Map<string, { fingerprint: string; promise: Promise<ToolResponse> }>();
  const rateWindows = new Map<string, { minute: number; count: number }>();
  const requestTimeoutMs = clampInteger(options.requestTimeoutMs, 5_000, 10, 10_000);
  const rateLimitPerMinute = clampInteger(options.rateLimitPerMinute, 60, 1, 600);

  return {
    async register(app: FastifyInstance): Promise<void> {
      if (!app.hasContentTypeParser("application/x-www-form-urlencoded")) {
        app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_request, body, done) => {
          try {
            done(null, Object.fromEntries(new URLSearchParams(typeof body === "string" ? body : body.toString("utf8"))));
          } catch (error) {
            done(error as Error, undefined);
          }
        });
      }

      app.get("/.well-known/oauth-authorization-server", async () => ({
        issuer,
        authorization_endpoint: `${issuer}/oauth/authorize`,
        token_endpoint: `${issuer}/oauth/token`,
        revocation_endpoint: `${issuer}/oauth/revoke`,
        registration_endpoint: `${issuer}/oauth/register`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        token_endpoint_auth_methods_supported: ["none"],
        code_challenge_methods_supported: ["S256"],
        scopes_supported: [CONNECT_SCOPE, REQUIRED_SCOPE]
      }));

      app.get("/.well-known/oauth-protected-resource", async () => ({
        resource: options.audience,
        authorization_servers: [issuer],
        scopes_supported: [CONNECT_SCOPE, REQUIRED_SCOPE]
      }));

      app.post("/oauth/register", async (request, reply) => {
        try {
          const body = objectValue(request.body);
          if (body.client_secret !== undefined || body.token_endpoint_auth_method !== "none") {
            throw new PocHttpError(400, "public_client_secret_forbidden");
          }
          const redirectUris = Array.isArray(body.redirect_uris)
            ? body.redirect_uris.filter((value): value is string => typeof value === "string")
            : [];
          if (redirectUris.length === 0 || redirectUris.length > 5 || redirectUris.some((value) => !isSafeRedirectUri(value))) {
            throw new PocHttpError(400, "redirect_uri_invalid");
          }
          const clientId = `wb_public_${randomBytes(18).toString("base64url")}`;
          clients.set(clientId, { clientId, redirectUris, createdAt: now() });
          return reply.code(201).send({
            client_id: clientId,
            client_id_issued_at: Math.floor(now() / 1_000),
            redirect_uris: redirectUris,
            token_endpoint_auth_method: "none",
            grant_types: ["authorization_code", "refresh_token"],
            response_types: ["code"]
          });
        } catch (error) {
          return sendOAuthError(reply, error);
        }
      });

      app.get("/oauth/authorize", async (request, reply) => {
        try {
          const query = objectValue(request.query);
          const clientId = requiredString(query.client_id, "client_id_invalid");
          const client = clients.get(clientId);
          if (!client) throw new PocHttpError(400, "client_id_invalid");
          if (query.response_type !== "code") throw new PocHttpError(400, "response_type_unsupported");
          const redirectUri = requiredString(query.redirect_uri, "redirect_uri_invalid");
          if (!client.redirectUris.includes(redirectUri)) throw new PocHttpError(400, "redirect_uri_invalid");
          const state = requiredString(query.state, "state_required");
          if (state.length < 8 || state.length > 256) throw new PocHttpError(400, "state_invalid");
          if (query.code_challenge_method !== "S256") throw new PocHttpError(400, "pkce_s256_required");
          const codeChallenge = requiredString(query.code_challenge, "pkce_challenge_required");
          if (!/^[A-Za-z0-9_-]{43,128}$/.test(codeChallenge)) throw new PocHttpError(400, "pkce_challenge_invalid");
          const scope = normalizeScope(query.scope);
          if (!scope.includes(CONNECT_SCOPE)) throw new PocHttpError(400, "mcp_connect_scope_required");

          const sessionToken = readBearer(request.headers.authorization);
          if (!sessionToken) throw new PocHttpError(401, "sitong_session_required");
          const sub = await options.resolveAuthorizationSession(sessionToken);
          if (!sub) throw new PocHttpError(401, "sitong_session_invalid");
          const identity = await options.resolveIdentity(sub);
          if (!isAuthorizedIdentity(identity)) throw new PocHttpError(403, "beauty_product_not_authorized");

          const code = randomBytes(32).toString("base64url");
          authorizationCodes.set(code, {
            code,
            clientId,
            redirectUri,
            sub,
            scope: scope.join(" "),
            codeChallenge,
            expiresAt: now() + AUTH_CODE_TTL_SECONDS * 1_000,
            used: false
          });
          const target = new URL(redirectUri);
          target.searchParams.set("code", code);
          target.searchParams.set("state", state);
          return reply.redirect(target.toString());
        } catch (error) {
          return sendOAuthError(reply, error);
        }
      });

      app.post("/oauth/token", async (request, reply) => {
        try {
          const body = objectValue(request.body);
          if (body.client_secret !== undefined) throw new PocHttpError(400, "public_client_secret_forbidden");
          const clientId = requiredString(body.client_id, "client_id_invalid");
          const client = clients.get(clientId);
          if (!client) throw new PocHttpError(400, "client_id_invalid");
          if (body.grant_type === "authorization_code") {
            const codeValue = requiredString(body.code, "authorization_code_invalid");
            const record = authorizationCodes.get(codeValue);
            if (!record || record.used || record.expiresAt <= now()) throw new PocHttpError(401, "authorization_code_invalid");
            const redirectUri = requiredString(body.redirect_uri, "redirect_uri_invalid");
            if (record.clientId !== clientId || record.redirectUri !== redirectUri || !client.redirectUris.includes(redirectUri)) {
              throw new PocHttpError(400, "authorization_code_binding_invalid");
            }
            const verifier = requiredString(body.code_verifier, "pkce_verifier_required");
            if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || sha256Base64Url(verifier) !== record.codeChallenge) {
              throw new PocHttpError(401, "pkce_verifier_invalid");
            }
            record.used = true;
            return reply.send(issueTokenPair(record.sub, record.scope, clientId));
          }
          if (body.grant_type === "refresh_token") {
            const refreshToken = requiredString(body.refresh_token, "refresh_token_invalid");
            const claims = verifyToken(refreshToken, "refresh");
            if (!claims || claims.client_id !== clientId || !liveRefreshJtis.has(claims.jti)) {
              throw new PocHttpError(401, "refresh_token_invalid");
            }
            liveRefreshJtis.delete(claims.jti);
            revokedJtis.add(claims.jti);
            const identity = await options.resolveIdentity(claims.sub);
            if (!isAuthorizedIdentity(identity)) throw new PocHttpError(403, "beauty_product_not_authorized");
            return reply.send(issueTokenPair(claims.sub, claims.scope, clientId));
          }
          throw new PocHttpError(400, "grant_type_unsupported");
        } catch (error) {
          return sendOAuthError(reply, error);
        }
      });

      app.post("/oauth/revoke", async (request, reply) => {
        const body = objectValue(request.body);
        const token = typeof body.token === "string" ? body.token : "";
        const claims = token ? decodeAndVerifySignature(token) : null;
        if (claims) {
          revokedJtis.add(claims.jti);
          liveRefreshJtis.delete(claims.jti);
        }
        return reply.send({ revoked: true });
      });

      app.post("/mcp", async (request, reply) => {
        const started = now();
        let claims: OAuthClaims | null = null;
        try {
          const accessToken = readBearer(request.headers.authorization);
          claims = accessToken ? verifyToken(accessToken, "access") : null;
          if (!claims) throw new PocHttpError(401, "oauth_access_token_invalid");

          const identitySurface = findIdentityInjection(request);
          if (identitySurface) {
            await writeRequiredAudit({
              action: "identity_field_rejected",
              claims,
              status: "rejected",
              httpStatus: 400,
              reasonCode: "identity_field_forbidden",
              identitySurface
            });
            throw new PocHttpError(400, "identity_field_forbidden");
          }

          const identity = await options.resolveIdentity(claims.sub);
          if (!isAuthorizedIdentity(identity)) throw new PocHttpError(403, "beauty_product_not_authorized");

          const body = objectValue(request.body) as JsonRpcRequest;
          const id = body.id ?? null;
          if (body.jsonrpc !== "2.0" || typeof body.method !== "string") throw new PocHttpError(400, "invalid_jsonrpc_request");
          if (body.method === "initialize") {
            return reply.send(rpcResult(id, {
              protocolVersion: "2024-11-05",
              serverInfo: { name: "sitong-workbuddy-oauth-poc", version: "1.0.0" },
              capabilities: { tools: {} }
            }));
          }
          if (body.method === "notifications/initialized") return reply.code(204).send();
          if (body.method === "ping") return reply.send(rpcResult(id, {}));
          if (body.method === "tools/list") {
            if (!scopeSet(claims.scope).has(CONNECT_SCOPE)) throw new PocHttpError(403, "tool_or_scope_forbidden");
            return reply.send(rpcResult(id, { tools: [toolDefinition()] }));
          }
          if (body.method !== "tools/call") throw new PocHttpError(404, "mcp_method_not_found");
          enforceRateLimit(claims.jti);

          const params = objectValue(body.params);
          const toolName = String(params.name ?? "");
          if (toolName !== POC_TOOL) {
            await writeRequiredAudit({ action: "tool_or_scope_rejected", claims, status: "rejected", httpStatus: 403, reasonCode: "tool_or_scope_forbidden" });
            throw new PocHttpError(403, "tool_or_scope_forbidden");
          }
          const args = objectValue(params.arguments);
          const requestId = requiredString(args.requestId, "request_id_required");
          if (requestId.length < 8 || requestId.length > 160) throw new PocHttpError(400, "request_id_invalid");
          const profileId = typeof args.profileId === "string" && args.profileId.trim()
            ? args.profileId.trim()
            : identity.profileIds[0];
          if (!profileId) throw new PocHttpError(404, "profile_not_found");

          // Ownership is checked before scope to prevent cross-tenant existence leaks.
          if (!identity.profileIds.includes(profileId)) {
            await writeRequiredAudit({ action: "cross_tenant_profile_rejected", claims, status: "rejected", httpStatus: 404, reasonCode: "profile_not_found", requestId });
            throw new PocHttpError(404, "profile_not_found");
          }
          if (!scopeSet(claims.scope).has(REQUIRED_SCOPE)) {
            await writeRequiredAudit({ action: "scope_rejected", claims, status: "rejected", httpStatus: 403, reasonCode: "tool_or_scope_forbidden", requestId });
            throw new PocHttpError(403, "tool_or_scope_forbidden");
          }

          const idempotencyKey = `${claims.jti}:${POC_TOOL}:${requestId}`;
          const invocationFingerprint = opaqueHash(profileId);
          const cached = completed.get(idempotencyKey);
          if (cached) {
            if (cached.fingerprint !== invocationFingerprint) throw new PocHttpError(409, "request_id_conflict");
            await writeRequiredAudit({ action: "tool_call_replayed", claims, status: "succeeded", httpStatus: 200, requestId, replay: true, durationMs: now() - started });
            return reply.send(cached.response);
          }
          const running = inflight.get(idempotencyKey);
          if (running) {
            if (running.fingerprint !== invocationFingerprint) throw new PocHttpError(409, "request_id_conflict");
            return reply.send(await running.promise);
          }

          const execution = executeTool({ claims, identity, profileId, requestId, id, started, request });
          inflight.set(idempotencyKey, { fingerprint: invocationFingerprint, promise: execution });
          try {
            const response = await execution;
            completed.set(idempotencyKey, { fingerprint: invocationFingerprint, response });
            return reply.send(response);
          } finally {
            inflight.delete(idempotencyKey);
          }
        } catch (error) {
          const failure = normalizeHttpError(error);
          return reply.code(failure.statusCode).send(rpcError((request.body as JsonRpcRequest | undefined)?.id ?? null, failure.code));
        }
      });
    }
  };

  async function executeTool(params: {
    claims: OAuthClaims;
    identity: WorkbuddyOAuthPocIdentity;
    profileId: string;
    requestId: string;
    id: JsonRpcId;
    started: number;
    request: FastifyRequest;
  }): Promise<ToolResponse> {
    await writeRequiredAudit({ action: "tool_call_started", claims: params.claims, status: "started", httpStatus: 0, requestId: params.requestId });
    const controller = new AbortController();
    const onRequestAbort = () => controller.abort("client_cancelled");
    params.request.raw.once("aborted", onRequestAbort);
    let timer: NodeJS.Timeout | undefined;
    try {
      const profile = await Promise.race([
        options.readProfile(params.profileId, controller.signal),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            controller.abort("request_timeout");
            reject(new PocHttpError(504, "mcp_request_timed_out"));
          }, requestTimeoutMs);
        })
      ]);
      if (!profile || profile.tenantId !== params.identity.tenantId) throw new PocHttpError(404, "profile_not_found");
      const response: ToolResponse = {
        jsonrpc: "2.0",
        id: params.id,
        result: {
          content: [{ type: "text", text: "已读取当前授权门店的最小经营档案摘要。" }],
          structuredContent: {
            tool: POC_TOOL,
            billable: false,
            profile: {
              profileId: profile.id,
              version: profile.version,
              businessType: profile.businessType,
              ...(profile.city ? { city: profile.city } : {}),
              serviceCategories: [...profile.serviceCategories],
              summaryStatus: profile.summaryStatus
            }
          }
        }
      };
      const durationMs = Math.max(0, now() - params.started);
      await writeRequiredAudit({ action: "tool_call_succeeded", claims: params.claims, status: "succeeded", httpStatus: 200, requestId: params.requestId, durationMs });
      await options.writeUsage({
        usageKeyHash: opaqueHash(`${params.claims.jti}:${POC_TOOL}:${params.requestId}`),
        occurredAt: new Date(now()).toISOString(),
        subjectHash: opaqueHash(params.claims.sub),
        tenantHash: opaqueHash(params.identity.tenantId),
        jtiHash: opaqueHash(params.claims.jti),
        requestHash: opaqueHash(params.requestId),
        tool: POC_TOOL,
        billable: false,
        creditDelta: 0,
        durationMs,
        status: "succeeded"
      });
      return response;
    } catch (error) {
      const failure = normalizeHttpError(error);
      if (failure.statusCode >= 500) {
        await writeRequiredAudit({ action: "tool_call_failed", claims: params.claims, status: "failed", httpStatus: failure.statusCode, requestId: params.requestId, reasonCode: failure.code, durationMs: Math.max(0, now() - params.started) });
      }
      throw failure;
    } finally {
      if (timer) clearTimeout(timer);
      params.request.raw.off("aborted", onRequestAbort);
    }
  }

  function issueTokenPair(sub: string, scope: string, clientId: string): object {
    const issuedAt = Math.floor(now() / 1_000);
    const accessClaims = makeClaims("access", sub, scope, clientId, issuedAt, ACCESS_TTL_SECONDS);
    const refreshClaims = makeClaims("refresh", sub, scope, clientId, issuedAt, REFRESH_TTL_SECONDS);
    liveRefreshJtis.add(refreshClaims.jti);
    return {
      access_token: signToken(accessClaims),
      token_type: "Bearer",
      expires_in: ACCESS_TTL_SECONDS,
      scope,
      refresh_token: signToken(refreshClaims)
    };
  }

  function makeClaims(tokenUse: "access" | "refresh", sub: string, scope: string, clientId: string, issuedAt: number, ttl: number): OAuthClaims {
    return {
      iss: issuer,
      aud: options.audience,
      sub,
      iat: issuedAt,
      nbf: issuedAt,
      exp: issuedAt + ttl,
      scope,
      jti: randomBytes(18).toString("base64url"),
      client_id: clientId,
      azp: clientId,
      token_use: tokenUse
    };
  }

  function signToken(claims: OAuthClaims): string {
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
    const signature = createHmac("sha256", options.tokenSecret).update(`${header}.${payload}`).digest("base64url");
    return `${header}.${payload}.${signature}`;
  }

  function decodeAndVerifySignature(token: string): OAuthClaims | null {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [header, payload, signature] = parts;
    const expected = createHmac("sha256", options.tokenSecret).update(`${header}.${payload}`).digest("base64url");
    const actualBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) return null;
    try {
      const parsedHeader = JSON.parse(Buffer.from(header, "base64url").toString("utf8"));
      const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as OAuthClaims;
      if (parsedHeader.alg !== "HS256" || parsedHeader.typ !== "JWT") return null;
      return claims;
    } catch {
      return null;
    }
  }

  function verifyToken(token: string, tokenUse: "access" | "refresh"): OAuthClaims | null {
    const claims = decodeAndVerifySignature(token);
    if (!claims) return null;
    const current = Math.floor(now() / 1_000);
    const valid = claims.iss === issuer
      && claims.aud === options.audience
      && typeof claims.sub === "string" && claims.sub.length > 0
      && Number.isInteger(claims.exp) && claims.exp > current
      && Number.isInteger(claims.nbf) && claims.nbf <= current + MAX_CLOCK_SKEW_SECONDS
      && Number.isInteger(claims.iat) && claims.iat <= current + MAX_CLOCK_SKEW_SECONDS
      && typeof claims.scope === "string"
      && typeof claims.jti === "string" && claims.jti.length >= 16
      && typeof claims.client_id === "string" && clients.has(claims.client_id)
      && claims.azp === claims.client_id
      && claims.token_use === tokenUse
      && !revokedJtis.has(claims.jti);
    return valid ? claims : null;
  }

  async function writeRequiredAudit(params: {
    action: string;
    claims: OAuthClaims;
    status: string;
    httpStatus: number;
    requestId?: string;
    durationMs?: number;
    replay?: boolean;
    reasonCode?: string;
    identitySurface?: "query" | "header" | "body";
  }): Promise<void> {
    const identity = await options.resolveIdentity(params.claims.sub);
    try {
      await options.writeAudit({
        action: params.action,
        occurredAt: new Date(now()).toISOString(),
        subjectHash: opaqueHash(params.claims.sub),
        ...(identity ? { tenantHash: opaqueHash(identity.tenantId) } : {}),
        jtiHash: opaqueHash(params.claims.jti),
        ...(params.requestId ? { requestHash: opaqueHash(params.requestId) } : {}),
        tool: POC_TOOL,
        status: params.status,
        httpStatus: params.httpStatus,
        ...(params.durationMs !== undefined ? { durationMs: params.durationMs } : {}),
        ...(params.replay !== undefined ? { replay: params.replay } : {}),
        ...(params.reasonCode ? { reasonCode: params.reasonCode } : {}),
        ...(params.identitySurface ? { identitySurface: params.identitySurface } : {})
      });
    } catch {
      throw new PocHttpError(503, "audit_unavailable");
    }
  }

  function enforceRateLimit(jti: string): void {
    const minute = Math.floor(now() / 60_000);
    const current = rateWindows.get(jti);
    if (!current || current.minute !== minute) {
      rateWindows.set(jti, { minute, count: 1 });
      return;
    }
    current.count += 1;
    if (current.count > rateLimitPerMinute) throw new PocHttpError(429, "mcp_rate_limited");
  }

  function opaqueHash(value: string): string {
    return createHash("sha256").update(`workbuddy-oauth-poc:${value}`).digest("hex").slice(0, 24);
  }
}

function validateOptions(options: WorkbuddyOAuthPocOptions): void {
  if (!/^https:\/\//.test(options.issuer)) throw new Error("workbuddy_oauth_poc_issuer_https_required");
  if (!/^https:\/\//.test(options.audience)) throw new Error("workbuddy_oauth_poc_audience_https_required");
  if (options.tokenSecret.length < 32) throw new Error("workbuddy_oauth_poc_token_secret_too_short");
}

function findIdentityInjection(request: FastifyRequest): "query" | "header" | "body" | null {
  if (containsForbiddenIdentityKey(request.query)) return "query";
  if (Object.keys(request.headers).some((key) => IDENTITY_HEADER_NAMES.has(key.toLowerCase()))) return "header";
  if (containsForbiddenIdentityKey(request.body)) return "body";
  return null;
}

function containsForbiddenIdentityKey(value: unknown, depth = 0): boolean {
  if (!value || typeof value !== "object" || depth > 8) return false;
  if (Array.isArray(value)) return value.some((item) => containsForbiddenIdentityKey(item, depth + 1));
  return Object.entries(value as Record<string, unknown>).some(([key, item]) => {
    const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
    return IDENTITY_FIELD_NAMES.has(normalized) || containsForbiddenIdentityKey(item, depth + 1);
  });
}

function isAuthorizedIdentity(identity: WorkbuddyOAuthPocIdentity | null): identity is WorkbuddyOAuthPocIdentity {
  return Boolean(identity?.active && identity.productCode === PRODUCT_CODE && identity.brandCode === "lanqi");
}

function normalizeScope(value: unknown): string[] {
  if (typeof value !== "string") return [];
  const scopes = [...new Set(value.split(/\s+/).map((item) => item.trim()).filter(Boolean))];
  if (scopes.some((item) => item !== CONNECT_SCOPE && item !== REQUIRED_SCOPE)) throw new PocHttpError(400, "scope_unsupported");
  return scopes;
}

function scopeSet(value: string): Set<string> {
  return new Set(value.split(/\s+/).filter(Boolean));
}

function requiredString(value: unknown, code: string): string {
  if (typeof value !== "string" || !value.trim()) throw new PocHttpError(400, code);
  return value.trim();
}

function readBearer(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  const match = typeof raw === "string" ? /^Bearer\s+(.+)$/i.exec(raw) : null;
  return match?.[1]?.trim() || null;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function isSafeRedirectUri(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.hash) return false;
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]");
  } catch {
    return false;
  }
}

function sha256Base64Url(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

function clampInteger(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  return Number.isInteger(value) && Number(value) >= minimum && Number(value) <= maximum ? Number(value) : fallback;
}

function toolDefinition(): object {
  return {
    name: POC_TOOL,
    description: "只读返回当前授权租户的最小门店经营档案摘要。",
    inputSchema: {
      type: "object",
      properties: {
        requestId: { type: "string", description: "调用方幂等请求号" },
        profileId: { type: "string", description: "可选的合成档案资源标识" }
      },
      required: ["requestId"],
      additionalProperties: false
    }
  };
}

function rpcResult(id: JsonRpcId, result: unknown): object {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id: JsonRpcId, message: string): object {
  return { jsonrpc: "2.0", id, error: { code: -32000, message } };
}

function normalizeHttpError(error: unknown): PocHttpError {
  return error instanceof PocHttpError ? error : new PocHttpError(503, "poc_service_unavailable");
}

function sendOAuthError(reply: FastifyReply, error: unknown): unknown {
  const failure = normalizeHttpError(error);
  return reply.code(failure.statusCode).send({ error: failure.code });
}

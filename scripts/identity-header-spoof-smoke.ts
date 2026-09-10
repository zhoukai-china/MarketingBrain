// P0 回归：请求身份必须来自「服务端验签过的会话令牌」，不能来自裸 `x-sitong-*` 头。
//
// 生产复现（修复前，外网可达 https://api.lcppch.top/os-v2/api/lanqi/stores）：
//   匿名                                        -> 401
//   只带 x-sitong-tenant-id + x-sitong-user-id  -> 200，返回该租户真实门店
//   同上 + Authorization: Bearer not-a-real-token -> 200（无效令牌被忽略，回落到裸头）
// 也就是说，任何人在没有凭证的情况下只要猜到两个内部 ID，就能读走该租户数据。
//
// 本用例用真实路由模块 + 合成 membership 夹具复刻同一条链路：
//   - 修复前：裸身份头走 `resolveRequestContext` 的 header 回落 → 200，用例 FAIL；
//   - 修复后：database 模式只认验签令牌 → 401，用例 PASS。
// 不连真实数据库、不调用模型、不访问任何外部服务：membership / entitlement 存储为合成桩。
import "dotenv/config";
import Fastify from "../apps/api/node_modules/fastify/fastify.js";
import { prisma } from "../packages/db/src/index.js";
import { env } from "../apps/api/src/config/env.js";
import { createSessionToken } from "../apps/api/src/services/auth-token.js";
import { requireProductEntitlement } from "../apps/api/src/services/access-guards.js";
import { registerAccountRoutes } from "../apps/api/src/routes/account.js";

let pass = 0;
let fail = 0;
function assert(name: string, cond: boolean, detail = "") {
  if (cond) {
    pass++;
    console.log(`ok - ${name}${detail ? ` :: ${detail}` : ""}`);
  } else {
    fail++;
    console.error(`FAIL - ${name}${detail ? ` :: ${detail}` : ""}`);
  }
}

const SYNTHETIC_SECRET = "synthetic-identity-spoof-smoke-secret-never-deployed";
const OWNER = { tenantId: "synthetic-tenant-a", userId: "synthetic-owner-a" };
const COLLEAGUE = { tenantId: "synthetic-tenant-a", userId: "synthetic-colleague-a" };
const OUTSIDER = { tenantId: "synthetic-tenant-b", userId: "synthetic-owner-b" };

const savedEnv = { DATA_MODE: env.DATA_MODE, JWT_SECRET: env.JWT_SECRET, NODE_ENV: env.NODE_ENV };
const originalMembershipFindFirst = (prisma.membership as any).findFirst;
const originalEntitlementFindFirst = (prisma.tenantProductEntitlement as any).findFirst;

let membershipLookups = 0;
let entitlementLookups = 0;

async function main(): Promise<void> {
  Object.assign(env, { DATA_MODE: "database", JWT_SECRET: SYNTHETIC_SECRET, NODE_ENV: "production" });

  // 合成 membership：只承认 OWNER / COLLEAGUE / OUTSIDER 三个真实存在的主体。
  // 任何其他 tenant/user 组合都查不到成员关系（= 攻击者猜错的 ID）。
  const knownMembers = new Set([
    `${OWNER.tenantId}:${OWNER.userId}`,
    `${COLLEAGUE.tenantId}:${COLLEAGUE.userId}`,
    `${OUTSIDER.tenantId}:${OUTSIDER.userId}`
  ]);
  (prisma.membership as any).findFirst = async ({ where }: any) => {
    membershipLookups++;
    if (!knownMembers.has(`${where.tenantId}:${where.userId}`)) return null;
    return {
      tenantId: where.tenantId,
      userId: where.userId,
      role: "owner",
      tenant: {
        id: where.tenantId,
        name: "合成验收主体",
        type: "local_business",
        industry: "beauty-industry",
        city: null,
        profile: { confirmedData: {} },
        creditAccount: { balance: 100 },
        subscriptions: []
      }
    };
  };
  // 只有 synthetic-tenant-a 开通了 lanqi（复刻生产「对照租户无授权 → 403」）。
  (prisma.tenantProductEntitlement as any).findFirst = async ({ where }: any) => {
    entitlementLookups++;
    return where.tenantId === OWNER.tenantId ? { id: "synthetic-entitlement", expiresAt: null } : null;
  };

  const app = Fastify({ disableRequestLogging: true });
  // 与 apps/api/src/server.ts 的身份错误映射保持一致（同一批 message → 同一个 HTTP 语义）。
  app.setErrorHandler((error, _request, reply) => {
    if (error.message === "missing_tenant_or_user" || error.message === "membership_not_found") {
      return reply.code(401).send({
        error: "login_required",
        message: error.message === "membership_not_found" ? "登录状态已失效，请重新登录或完成企业入驻。" : "请先完成微信登录和账号绑定。"
      });
    }
    return reply.code(500).send({ error: "internal_server_error", message: "服务暂时不可用，请稍后重试" });
  });
  await registerAccountRoutes(app);
  // 与生产 `/lanqi/stores` 相同的作用域形状：产品授权守卫挂在读取租户数据之前。
  app.get("/lanqi/stores", { preHandler: requireProductEntitlement("lanqi") }, async (request) => ({
    ok: true,
    tenantId: (request as any).context?.tenantId
  }));

  const bearer = (identity: { tenantId: string; userId: string }, ttlSeconds?: number) =>
    `Bearer ${createSessionToken({ tenantId: identity.tenantId, userId: identity.userId, ttlSeconds })}`;
  const bareIdentity = (identity: { tenantId: string; userId: string }) => ({
    "x-sitong-tenant-id": identity.tenantId,
    "x-sitong-user-id": identity.userId
  });

  try {
    // ---- 1. 无凭证一律拒绝 ----
    const anonymous = await app.inject({ method: "GET", url: "/account/status" });
    assert("匿名请求必须 401", anonymous.statusCode === 401, `got ${anonymous.statusCode}`);

    // ---- 2. P0 红灯点：裸身份头不算身份 ----
    for (const [name, headers] of [
      ["裸 tenant+user 头", bareIdentity(OWNER)],
      ["裸 tenant+user 头 + 无效 Bearer", { ...bareIdentity(OWNER), authorization: "Bearer not-a-real-token" }],
      ["裸 tenant+user 头 + 伪造签名 Bearer", { ...bareIdentity(OWNER), authorization: `Bearer ${createSessionToken({ ...OWNER, ttlSeconds: -1 })}` }],
      ["只给 tenant 头", { "x-sitong-tenant-id": OWNER.tenantId }],
      ["只给 user 头", { "x-sitong-user-id": OWNER.userId }],
      ["伪造成同租户其他用户", bareIdentity(COLLEAGUE)],
      ["伪造成别的租户 owner", bareIdentity(OUTSIDER)],
      ["伪造成 internal-* 合成身份", { "x-sitong-tenant-id": "internal-project-zhenshui", "x-sitong-user-id": "internal-project-owner", "x-sitong-plan": "chain_premium" }],
      ["随机 tenant + 随机 user", bareIdentity({ tenantId: "synthetic-tenant-zzz", userId: "synthetic-user-zzz" })]
    ] as Array<[string, Record<string, string>]>) {
      const lookupsBefore = membershipLookups;
      const response = await app.inject({ method: "GET", url: "/account/status", headers });
      assert(`未验签的 ${name} 必须 401`, response.statusCode === 401, `got ${response.statusCode}`);
      assert(
        `未验签的 ${name} 不得触达 membership 查询（不能凭猜测的 ID 打到数据库）`,
        membershipLookups === lookupsBefore,
        `membership lookups ${lookupsBefore} -> ${membershipLookups}`
      );
    }

    // ---- 3. 合法会话必须照常工作 ----
    const owner = await app.inject({ method: "GET", url: "/account/status", headers: { authorization: bearer(OWNER) } });
    assert("有效会话令牌必须 200", owner.statusCode === 200, `got ${owner.statusCode}`);
    const ownerBody = owner.json() as { tenantId: string; userId: string; dataMode: string; role: string };
    assert("身份来自令牌 tenant", ownerBody.tenantId === OWNER.tenantId, ownerBody.tenantId);
    assert("身份来自令牌 user", ownerBody.userId === OWNER.userId, ownerBody.userId);
    assert("有效会话读取的是 database 上下文", ownerBody.dataMode === "database", ownerBody.dataMode);
    assert("有效会话角色来自 membership", ownerBody.role === "owner", ownerBody.role);

    // 令牌为准：伪造头不能把已登录用户顶到别的租户去。
    const spoofedHeaderWithValidToken = await app.inject({
      method: "GET",
      url: "/account/status",
      headers: { ...bareIdentity(OUTSIDER), authorization: bearer(OWNER) }
    });
    assert(
      "有效令牌 + 伪造头：仍按令牌判定身份，头不能越权",
      spoofedHeaderWithValidToken.statusCode === 200 &&
        (spoofedHeaderWithValidToken.json() as { tenantId: string }).tenantId === OWNER.tenantId,
      `${spoofedHeaderWithValidToken.statusCode} ${spoofedHeaderWithValidToken.body}`
    );

    // ---- 4. 令牌指向不存在的成员关系 → 401，不泄露是否存在 ----
    const ghost = await app.inject({
      method: "GET",
      url: "/account/status",
      headers: { authorization: bearer({ tenantId: "synthetic-tenant-zzz", userId: "synthetic-user-zzz" }) }
    });
    assert("令牌指向不存在的成员关系必须 401", ghost.statusCode === 401, `got ${ghost.statusCode}`);

    // ---- 5. 产品作用域（复刻生产 /lanqi/stores） ----
    const scopeBare = await app.inject({ method: "GET", url: "/lanqi/stores", headers: bareIdentity(OWNER) });
    assert("产品作用域上的裸身份头必须 401", scopeBare.statusCode === 401, `got ${scopeBare.statusCode}`);

    const entitlementBefore = entitlementLookups;
    const scopeGhost = await app.inject({ method: "GET", url: "/lanqi/stores", headers: bareIdentity(OUTSIDER) });
    assert("产品作用域的裸身份头不得触达 entitlement 查询", entitlementLookups === entitlementBefore && scopeGhost.statusCode === 401, `got ${scopeGhost.statusCode}`);

    const scopeOwner = await app.inject({ method: "GET", url: "/lanqi/stores", headers: { authorization: bearer(OWNER) } });
    assert("已开通产品的有效会话必须 200", scopeOwner.statusCode === 200, `got ${scopeOwner.statusCode}`);

    const scopeUnauthorized = await app.inject({ method: "GET", url: "/lanqi/stores", headers: { authorization: bearer(OUTSIDER) } });
    assert("未开通产品的有效会话必须 403（不是身份问题，是授权问题）", scopeUnauthorized.statusCode === 403, `got ${scopeUnauthorized.statusCode}`);

    console.log(`\nidentity-header-spoof-smoke -> ${pass} passed, ${fail} failed`);
  } finally {
    await app.close();
    Object.assign(env, savedEnv);
    (prisma.membership as any).findFirst = originalMembershipFindFirst;
    (prisma.tenantProductEntitlement as any).findFirst = originalEntitlementFindFirst;
  }
  if (fail > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

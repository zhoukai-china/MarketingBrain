// PLAT-39 管理后台账号密码登录回归（离线：无数据库、无 Provider）。
//
// 用户 2026-09-15：「后台普通用户进不去吧，得设置个管理员账号密码登入才行」。
//
// 覆盖：
//   1. 未配置账号密码 → /admin/login 503（明确「还没配置」，不是 500）
//   2. 密码错误 / 账号错误 → 401（且文案不区分账号与密码，防枚举）
//   3. 正确账号密码 → 200 + 会话令牌（带 expiresAt）
//   4. 会话令牌能过 requireAdminToken（等价于能打开后台数据接口）
//   5. 篡改令牌 / 过期令牌 → 401（失败关闭）
//   6. 旧的共享 ADMIN_TOKEN 仍然可用（脚本 / 运维向后兼容）
import assert from "node:assert/strict";
import Fastify from "../apps/api/node_modules/fastify/fastify.js";
import { env } from "../apps/api/src/config/env.js";
import { registerAdminRoutes } from "../apps/api/src/routes/admin.js";
import { createAdminSessionToken, hashAdminPassword } from "../apps/api/src/services/admin-session.js";
import { requireAdminToken } from "../apps/api/src/services/access-guards.js";

function assertOk(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

async function main(): Promise<void> {
  const saved = {
    username: env.ADMIN_LOGIN_USERNAME,
    hash: env.ADMIN_LOGIN_PASSWORD_HASH,
    plain: env.ADMIN_LOGIN_PASSWORD,
    secret: env.ADMIN_SESSION_SECRET,
    token: env.ADMIN_TOKEN,
    nodeEnv: env.NODE_ENV
  };
  const password = "plat39-acceptance-password";
  const username = "boss";

  const app = Fastify({ logger: false, disableRequestLogging: true });
  // 与 server.ts 相同的登录错误映射（这里只挂需要的最小子集）。
  app.setErrorHandler((error, _request, reply) => {
    if (error.message === "missing_tenant_or_user" || error.message === "membership_not_found") {
      return reply.code(401).send({ error: "login_required" });
    }
    reply.code(500).send({ error: "internal_server_error" });
  });
  await registerAdminRoutes(app);
  app.get("/admin/probe", { preHandler: requireAdminToken }, async () => ({ ok: true }));

  const login = (body: Record<string, unknown>) =>
    app.inject({ method: "POST", url: "/admin/login", headers: { "content-type": "application/json" }, payload: body });
  const probe = (token?: string) =>
    app.inject({ method: "GET", url: "/admin/probe", headers: token ? { "x-sitong-admin-token": token } : {} });
  const session = (token?: string) =>
    app.inject({ method: "GET", url: "/admin/session", headers: token ? { "x-sitong-admin-token": token } : {} });

  try {
    // 1) 未配置
    Object.assign(env, { ADMIN_LOGIN_USERNAME: "", ADMIN_LOGIN_PASSWORD_HASH: "", ADMIN_LOGIN_PASSWORD: "", ADMIN_SESSION_SECRET: "s".repeat(40), ADMIN_TOKEN: "legacy-shared-token" });
    const notConfigured = await login({ username, password });
    assertOk(notConfigured.statusCode === 503, `未配置账号密码必须 503（实际 ${notConfigured.statusCode}）`);
    assertOk(notConfigured.json().error === "admin_login_not_configured", "未配置必须回明确错误码");

    // 配置好账号密码（hash 形式）
    Object.assign(env, {
      ADMIN_LOGIN_USERNAME: username,
      ADMIN_LOGIN_PASSWORD_HASH: hashAdminPassword(password),
      ADMIN_LOGIN_PASSWORD: "",
      ADMIN_SESSION_SECRET: "s".repeat(40)
    });

    // 2) 错误账号 / 错误密码
    const wrongPassword = await login({ username, password: "wrong-password" });
    assertOk(wrongPassword.statusCode === 401, `密码错必须 401（实际 ${wrongPassword.statusCode}）`);
    const wrongUser = await login({ username: "someone-else", password });
    assertOk(wrongUser.statusCode === 401, `账号错必须 401（实际 ${wrongUser.statusCode}）`);
    assertOk(
      wrongPassword.json().message === wrongUser.json().message,
      "账号错与密码错的文案必须一致（防账号枚举）"
    );

    // 3) 正确登录
    const ok = await login({ username, password });
    assertOk(ok.statusCode === 200, `正确账号密码必须 200（实际 ${ok.statusCode} ${ok.body.slice(0, 160)}）`);
    const body = ok.json() as { token: string; expiresAt: string; username: string };
    assertOk(typeof body.token === "string" && body.token.includes("."), "必须回会话令牌");
    assertOk(Date.parse(body.expiresAt) > Date.now(), "令牌必须带未来过期时间");

    // 4) 会话令牌能打开后台数据接口
    const withSession = await probe(body.token);
    assertOk(withSession.statusCode === 200, `会话令牌必须能过后台守卫（实际 ${withSession.statusCode}）`);
    const sessionView = await session(body.token);
    assertOk(sessionView.statusCode === 200 && sessionView.json().mode === "session", "会话自检必须认这枚令牌");

    // 5) 篡改 / 过期 / 空令牌
    const tampered = `${body.token.split(".")[0]}.${"A".repeat(43)}`;
    assertOk((await probe(tampered)).statusCode === 401, "篡改签名必须 401");
    assertOk((await probe()).statusCode === 401, "不带令牌必须 401");
    const expired = createAdminSessionToken({ username, ttlSeconds: -10 }).token;
    assertOk((await probe(expired)).statusCode === 401, "过期令牌必须 401");

    // 6) 旧共享令牌仍可用（脚本/运维）
    assertOk((await probe("legacy-shared-token")).statusCode === 200, "旧 ADMIN_TOKEN 必须仍然可用");
    assertOk((await probe("legacy-shared-token-wrong")).statusCode === 401, "错误的旧令牌必须 401");

    console.log(JSON.stringify({
      result: "PLAT39_ADMIN_LOGIN_PASS",
      notConfiguredIs503: true,
      wrongCredentialsAre401: true,
      sessionTokenWorks: true,
      tamperedExpiredRejected: true,
      legacyTokenStillWorks: true,
      providerCalls: 0,
      costYuan: 0
    }));
  } finally {
    await app.close();
    Object.assign(env, {
      ADMIN_LOGIN_USERNAME: saved.username,
      ADMIN_LOGIN_PASSWORD_HASH: saved.hash,
      ADMIN_LOGIN_PASSWORD: saved.plain,
      ADMIN_SESSION_SECRET: saved.secret,
      ADMIN_TOKEN: saved.token,
      NODE_ENV: saved.nodeEnv
    });
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});

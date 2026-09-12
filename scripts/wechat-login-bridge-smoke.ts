// 回归：电脑端「微信扫码登录」中转链路（PLAT-13）。
//
// 背景（2026-09-11 生产实测）：电脑浏览器点「微信一键登录 / 注册」会跳到微信的
// 「请在微信客户端打开链接」死页——公众号网页授权只认微信内置浏览器。用户明确要求
// 「不能弹出微信二维码让用户用微信扫码登录吗」，于是电脑端改为中转：
//   电脑建会话 -> 出二维码 -> 手机微信里授权 -> 服务端换登录结果 -> 电脑轮询取走。
//
// 本用例用真实路由模块 + 合成微信响应 + 桩 prisma，不连真实数据库、不调外部服务：
//   - 修复前（未加中转路由）：所有 /auth/wechat-bridge/* 请求 404，用例 FAIL；
//   - 修复后：会话/状态/二维码/回填四段链路 PASS。
//
// 重点守护的是「不应发生」：secret 泄漏、别人的会话被读走、二维码被当通用生成器、
// 手机端偷换产品/租户、成功后二次提交换人、上游 errmsg 回显。
import "dotenv/config";
import Fastify from "../apps/api/node_modules/fastify/fastify.js";
import { prisma } from "../packages/db/src/index.js";
import { env } from "../apps/api/src/config/env.js";
import { registerAuthRoutes } from "../apps/api/src/routes/auth.js";
import {
  createWechatLoginBridge,
  readWechatLoginBridge,
} from "../apps/api/src/services/wechat-login-bridge.js";

let pass = 0;
let fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    pass++;
    console.log(`ok - ${name}${detail ? ` :: ${detail}` : ""}`);
  } else {
    fail++;
    console.error(`FAIL - ${name}${detail ? ` :: ${detail}` : ""}`);
  }
}

const SYNTHETIC_SECRET = "synthetic-wechat-bridge-smoke-secret-never-deployed";
const SYNTHETIC_APPID = "synthetic-bridge-appid";
const SYNTHETIC_OPENID = "synthetic-bridge-openid-0001";
const TEST_ORIGIN = "https://api.lcppch.top/os-v2";

const savedEnv = {
  DATA_MODE: env.DATA_MODE,
  JWT_SECRET: env.JWT_SECRET,
  WECHAT_AUTH_APPID: env.WECHAT_AUTH_APPID,
  WECHAT_AUTH_SECRET: env.WECHAT_AUTH_SECRET,
};
const originalFetch = globalThis.fetch;
const originalUserUpsert = (prisma.user as any).upsert;
const originalMembershipFindFirst = (prisma.membership as any).findFirst;
const originalMembershipCount = (prisma.membership as any).count;
const originalTenantDomainFindFirst = (prisma.tenantDomain as any).findFirst;

let membershipStub: () => unknown = () => null;
let lastMembershipWhere: any = null;

const stubWechatResponse = (payload: unknown, status = 200): void => {
  globalThis.fetch = (async () =>
    new Response(typeof payload === "string" ? payload : JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;
};

async function main(): Promise<void> {
  Object.assign(env, {
    DATA_MODE: "database",
    JWT_SECRET: SYNTHETIC_SECRET,
    WECHAT_AUTH_APPID: SYNTHETIC_APPID,
    WECHAT_AUTH_SECRET: SYNTHETIC_SECRET,
  });

  (prisma.user as any).upsert = async ({ where }: any) => ({
    id: "synthetic-bridge-user-1",
    wechatOpenid: where?.wechatOpenid ?? SYNTHETIC_OPENID,
    wechatUnionid: null,
  });
  (prisma.membership as any).findFirst = async (args: any) => {
    lastMembershipWhere = args?.where ?? null;
    return membershipStub();
  };
  (prisma.membership as any).count = async () => 0;
  (prisma.tenantDomain as any).findFirst = async () => null;

  const app = Fastify();
  app.setErrorHandler((error: any, _request, reply) => {
    if ((error as { statusCode?: number }).statusCode && error.statusCode < 500) {
      return reply.code(error.statusCode).send({ error: "invalid_request", message: error.message });
    }
    return reply.code(500).send({ error: "internal_server_error", message: "服务暂时不可用，请稍后重试" });
  });

  try {
    await registerAuthRoutes(app);

    const createSession = (payload: Record<string, unknown> = {}) =>
      app.inject({ method: "POST", url: "/auth/wechat-bridge/session", payload });
    const status = (id: string, secret: string) =>
      app.inject({ method: "GET", url: `/auth/wechat-bridge/status?id=${encodeURIComponent(id)}&secret=${encodeURIComponent(secret)}` });
    const complete = (id: string, secret: string, code: string, extra: Record<string, unknown> = {}) =>
      app.inject({
        method: "POST",
        url: "/auth/wechat-bridge/complete",
        payload: { id, secret, code, ...extra },
      });
    const qrcode = (target: string, host?: string) =>
      app.inject({
        method: "GET",
        url: `/auth/wechat-bridge/qrcode?u=${encodeURIComponent(target)}`,
        ...(host ? { headers: { host } } : {}),
      });
    const scanUrl = (id: string, secret: string) =>
      `${TEST_ORIGIN}/wechat-bridge?b=${encodeURIComponent(id)}&s=${encodeURIComponent(secret)}`;
    const noLeak = (name: string, response: { body: string }) => {
      assert(`${name} 不得回显上游 errmsg`, !/invalid appid|code been used/i.test(response.body), response.body.slice(0, 160));
      assert(`${name} 不得包含堆栈`, !/at\s+\S+\s+\(.*:\d+:\d+\)/.test(response.body), response.body.slice(0, 160));
      assert(`${name} 不得回显微信 AppSecret`, !response.body.includes(SYNTHETIC_SECRET), response.body.slice(0, 160));
    };

    // ---- 1. 服务层：TTL 与 secret 校验（不经过 HTTP，直接锁语义） ----
    const unitSession = createWechatLoginBridge({ now: 0, ttlMs: 1000 });
    assert("服务层：新建会话处于 pending", readWechatLoginBridge({ id: unitSession.id, secret: unitSession.secret, now: 500 }).state === "pending");
    assert(
      "服务层：secret 不匹配与 id 不存在返回同一种结果",
      readWechatLoginBridge({ id: unitSession.id, secret: "wrong-secret", now: 500 }).state === "not_found",
    );
    // 放在最后：读一次过期会话会把它清掉。
    assert("服务层：过期会话读成 expired", readWechatLoginBridge({ id: unitSession.id, secret: unitSession.secret, now: 2000 }).state === "expired");

    // ---- 2. 电脑端创建扫码会话 ----
    const created = await createSession({ productCode: "lanqi" });
    assert("创建会话返回 200", created.statusCode === 200, `got ${created.statusCode} ${created.body.slice(0, 160)}`);
    const createdBody = created.json() as { id?: string; secret?: string; expiresAt?: number; ttlSeconds?: number };
    assert("创建会话返回一次性 id/secret", Boolean(createdBody.id) && Boolean(createdBody.secret));
    assert("创建会话返回过期时间与有效期", typeof createdBody.expiresAt === "number" && createdBody.ttlSeconds === 300);
    noLeak("创建会话", created);

    const badHost = await createSession({ tenantHostname: "not a host!!" });
    assert("非法登录域名返回 400", badHost.statusCode === 400 && badHost.json().error === "invalid_tenant_domain", badHost.body.slice(0, 160));

    // ---- 3. 状态轮询：待授权 / 拿不到别人的会话 ----
    const id = createdBody.id!;
    const secret = createdBody.secret!;
    const pending = await status(id, secret);
    assert("未扫码时状态为 pending", pending.statusCode === 200 && pending.json().state === "pending", pending.body.slice(0, 160));
    assert("pending 响应不得带 secret", !pending.body.includes(secret), pending.body.slice(0, 160));

    const unknownId = await status("00000000-0000-0000-0000-000000000000", secret);
    assert("未知 id 返回 404", unknownId.statusCode === 404 && unknownId.json().error === "wechat_bridge_not_found", unknownId.body.slice(0, 160));
    const wrongSecret = await status(id, "not-the-right-secret");
    assert("secret 不对返回 404（与未知 id 同文案）", wrongSecret.statusCode === 404 && wrongSecret.json().error === "wechat_bridge_not_found", wrongSecret.body.slice(0, 160));
    assert(
      "secret 不对与未知 id 的响应体一致（不泄漏 id 是否有效）",
      wrongSecret.json().message === unknownId.json().message,
    );
    noLeak("状态轮询 404", wrongSecret);

    // ---- 4. 二维码：只画本站扫码中转页 ----
    const qr = await qrcode(scanUrl(id, secret), "api.lcppch.top");
    assert("合法扫码地址返回 200", qr.statusCode === 200, `got ${qr.statusCode} ${qr.body.slice(0, 160)}`);
    assert("二维码是 SVG", /image\/svg\+xml/.test(String(qr.headers["content-type"] ?? "")) && qr.body.includes("<svg"));
    const qrForeign = await qrcode(`https://evil.example.com/wechat-bridge?b=${id}&s=${secret}`, "api.lcppch.top");
    assert("外部域名不允许画二维码", qrForeign.statusCode === 400 && qrForeign.json().error === "invalid_qrcode_target", qrForeign.body.slice(0, 160));
    // 路径对、密钥有效，但域名不是本站：照样不放行（inject 默认 Host 是 localhost）。
    const qrOtherHost = await qrcode(scanUrl(id, secret));
    assert("非本站域名（路径与密钥都对）也不允许画二维码", qrOtherHost.statusCode === 400, qrOtherHost.body.slice(0, 160));
    const qrWrongPath = await qrcode("https://api.lcppch.top/os-v2/login", "api.lcppch.top");
    assert("非扫码中转页不允许画二维码", qrWrongPath.statusCode === 400, qrWrongPath.body.slice(0, 160));
    const qrDeadSession = await qrcode(scanUrl("00000000-0000-0000-0000-000000000000", secret), "api.lcppch.top");
    assert("已失效会话不画二维码", qrDeadSession.statusCode === 404, qrDeadSession.body.slice(0, 160));

    // ---- 5. 手机端回填：新用户（需要补资料）走完整链路 ----
    // 产品/品牌域名必须取电脑端创建会话时的值，手机端伪造 lanqi -> founder-ip 不算数。
    stubWechatResponse({ openid: SYNTHETIC_OPENID, scope: "snsapi_userinfo" });
    membershipStub = () => null;
    const newUserComplete = await complete(id, secret, "synthetic-valid-code", { productCode: "founder-ip" });
    assert("手机端回填成功返回 200", newUserComplete.statusCode === 200, newUserComplete.body.slice(0, 160));
    assert("回填结果只给手机端摘要、不带 token", newUserComplete.json().ok === true && newUserComplete.json().needsTenant === true, newUserComplete.body.slice(0, 160));
    assert("回填结果不含会话密钥", !newUserComplete.body.includes(secret), newUserComplete.body.slice(0, 160));
    assert(
      "产品归属以电脑端会话为准，手机端偷换无效",
      lastMembershipWhere?.tenant?.productEntitlements?.some?.productCode === "lanqi",
      JSON.stringify(lastMembershipWhere?.tenant ?? null).slice(0, 200),
    );

    const desktopGot = await status(id, secret);
    assert("电脑端取到登录结果", desktopGot.statusCode === 200 && desktopGot.json().state === "completed", desktopGot.body.slice(0, 160));
    assert("新用户结果带一次性建租令牌", typeof desktopGot.json().login?.onboardingToken === "string", desktopGot.body.slice(0, 200));
    assert("电脑端结果带 openid 供补资料", desktopGot.json().login?.needsTenant === true);
    noLeak("电脑端取结果", desktopGot);

    // ---- 6. 失败可重试：授权码失效不销毁会话 ----
    const retrySession = await createSession({});
    const retryId = (retrySession.json() as { id: string }).id;
    const retrySecret = (retrySession.json() as { secret: string }).secret;
    stubWechatResponse({ errcode: 40029, errmsg: "invalid code" });
    const failedComplete = await complete(retryId, retrySecret, "synthetic-expired-code");
    assert("授权码失效回填为失败结果", failedComplete.statusCode === 200 && failedComplete.json().ok === false, failedComplete.body.slice(0, 200));
    assert("失败结果给手机端中文可读文案", /[\u4e00-\u9fa5]/.test(String(failedComplete.json().message ?? "")), failedComplete.body.slice(0, 200));
    noLeak("授权码失效回填", failedComplete);
    const failedOnDesktop = await status(retryId, retrySecret);
    assert("失败结果不会取走会话（可重试）", failedOnDesktop.statusCode === 200 && failedOnDesktop.json().ok === false, failedOnDesktop.body.slice(0, 200));
    assert("失败结果在电脑端也是中文业务文案", /重新授权|重新登录/.test(String(failedOnDesktop.json().login?.message ?? "")), failedOnDesktop.body.slice(0, 200));

    // 重试成功：失败结果必须被成功结果覆盖（不能因为失败过就登不上）。
    stubWechatResponse({ openid: SYNTHETIC_OPENID, scope: "snsapi_userinfo" });
    membershipStub = () => ({
      tenantId: "synthetic-bridge-tenant-1",
      tenant: { type: "local_business", subscriptions: [] },
    });
    const retryOk = await complete(retryId, retrySecret, "synthetic-valid-code-2");
    assert("重新授权后回填成功", retryOk.statusCode === 200 && retryOk.json().ok === true, retryOk.body.slice(0, 200));
    const tokenTaken = await status(retryId, retrySecret);
    assert("电脑端取走成功结果", tokenTaken.statusCode === 200 && typeof tokenTaken.json().login?.token === "string", tokenTaken.body.slice(0, 200));
    noLeak("电脑端取走 token", tokenTaken);

    // ---- 7. 一次性：成功结果取走即焚，之后不能再被读或被二次提交 ----
    const afterConsume = await status(retryId, retrySecret);
    assert("成功结果取走即焚（再读 404）", afterConsume.statusCode === 404, afterConsume.body.slice(0, 160));
    stubWechatResponse({ openid: "synthetic-other-openid", scope: "snsapi_userinfo" });
    const secondSubmit = await complete(retryId, retrySecret, "synthetic-third-code");
    assert("扫描成功后不能再二次提交换人", secondSubmit.statusCode === 404, secondSubmit.body.slice(0, 160));

    // ---- 8. 参数校验 ----
    const badComplete = await app.inject({ method: "POST", url: "/auth/wechat-bridge/complete", payload: { id, secret } });
    assert("回填缺 code 返回 400", badComplete.statusCode === 400, badComplete.body.slice(0, 160));
    const badStatus = await app.inject({ method: "GET", url: "/auth/wechat-bridge/status?id=only-id" });
    assert("轮询缺 secret 返回 400", badStatus.statusCode === 400, badStatus.body.slice(0, 160));

    console.log(`\nwechat-login-bridge-smoke -> ${pass} passed, ${fail} failed`);
  } finally {
    await app.close();
    Object.assign(env, savedEnv);
    globalThis.fetch = originalFetch;
    (prisma.user as any).upsert = originalUserUpsert;
    (prisma.membership as any).findFirst = originalMembershipFindFirst;
    (prisma.membership as any).count = originalMembershipCount;
    (prisma.tenantDomain as any).findFirst = originalTenantDomainFindFirst;
  }
  if (fail > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

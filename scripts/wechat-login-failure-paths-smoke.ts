// 回归：微信授权登录的失败路径必须返回业务错误，不能被 500 兜底吞掉。
//
// 生产复现（修复前，https://api.lcppch.top/os-v2/api/auth/wechat-login）：
//   POST {"code":"invalid-probe-code","productCode":"lanqi"}
//   -> 500 {"error":"internal_server_error","message":"服务暂时不可用，请稍后重试"}
// 也就是把「授权码失效、用户重新授权即可恢复」的业务失败，说成「服务器不可用」，
// 同时污染 5xx 告警。修复后按失败类型分别返回 401 / 502 与可读中文文案。
//
// 本用例用真实路由模块 + 合成微信响应复刻同一条链路，不连真实数据库、不调用外部服务：
//   - 修复前：无效 code 走 server.ts 兜底 -> 500，用例 FAIL；
//   - 修复后：无效 code -> 401 wechat_code_invalid，用例 PASS。
import "dotenv/config";
import Fastify from "../apps/api/node_modules/fastify/fastify.js";
import { prisma } from "../packages/db/src/index.js";
import { env } from "../apps/api/src/config/env.js";
import { registerAuthRoutes } from "../apps/api/src/routes/auth.js";

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

const SYNTHETIC_SECRET = "synthetic-wechat-login-smoke-secret-never-deployed";
const SYNTHETIC_APPID = "synthetic-appid";
const SYNTHETIC_OPENID = "synthetic-openid-0001";
const savedEnv = { DATA_MODE: env.DATA_MODE, JWT_SECRET: env.JWT_SECRET, WECHAT_AUTH_APPID: env.WECHAT_AUTH_APPID, WECHAT_AUTH_SECRET: env.WECHAT_AUTH_SECRET };
const originalFetch = globalThis.fetch;
const originalUserUpsert = (prisma.user as any).upsert;
const originalMembershipFindFirst = (prisma.membership as any).findFirst;
const originalMembershipCount = (prisma.membership as any).count;
const originalTenantDomainFindFirst = (prisma.tenantDomain as any).findFirst;

// 合成微信 OAuth 响应：本用例只关心「失败怎么表达」，所以上游一律用桩。
const stubWechatResponse = (payload: unknown, status = 200): void => {
  globalThis.fetch = (async () =>
    new Response(typeof payload === "string" ? payload : JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" }
    })) as typeof fetch;
};
const stubWechatNetworkFailure = (): void => {
  globalThis.fetch = (async () => {
    throw new TypeError("fetch failed");
  }) as typeof fetch;
};

async function main(): Promise<void> {
  Object.assign(env, {
    DATA_MODE: "database",
    JWT_SECRET: SYNTHETIC_SECRET,
    WECHAT_AUTH_APPID: SYNTHETIC_APPID,
    WECHAT_AUTH_SECRET: SYNTHETIC_SECRET
  });

  // 正常路径所需的合成夹具：新微信用户、无 membership -> needsTenant。
  (prisma.user as any).upsert = async ({ where }: any) => ({
    id: "synthetic-wechat-user-1",
    wechatOpenid: where?.wechatOpenid ?? SYNTHETIC_OPENID,
    wechatUnionid: null
  });
  (prisma.membership as any).findFirst = async () => null;
  (prisma.membership as any).count = async () => 0;
  (prisma.tenantDomain as any).findFirst = async () => null;

  const app = Fastify();
  // 复刻生产 server.ts 的兜底：任何未捕获异常都会被映射成 500 internal_server_error。
  app.setErrorHandler((error: any, _request, reply) => {
    if ((error as { statusCode?: number }).statusCode && error.statusCode < 500) {
      return reply.code(error.statusCode).send({ error: "invalid_request", message: error.message });
    }
    return reply.code(500).send({ error: "internal_server_error", message: "服务暂时不可用，请稍后重试" });
  });

  try {
    await registerAuthRoutes(app);

    const login = (body: unknown) =>
      app.inject({ method: "POST", url: "/auth/wechat-login", payload: body as Record<string, unknown> });
    const text = (response: { body: string }) => response.body;
    const noLeak = (name: string, response: { body: string }) => {
      assert(`${name} 响应不得包含上游原始错误`, !/WeChat OAuth/i.test(text(response)), text(response).slice(0, 160));
      assert(`${name} 响应不得包含堆栈`, !/at\s+\S+\s+\(.*:\d+:\d+\)/.test(text(response)), text(response).slice(0, 160));
      assert(`${name} 响应不得回显 secret`, !text(response).includes(SYNTHETIC_SECRET), text(response).slice(0, 160));
    };

    // ---- 1. 参数校验失败 ----
    const missingCode = await login({});
    assert("缺 code 返回 400", missingCode.statusCode === 400, `got ${missingCode.statusCode} ${text(missingCode)}`);
    assert("缺 code 返回 invalid_request", missingCode.json().error === "invalid_request", text(missingCode));

    const emptyCode = await login({ code: "" });
    assert("code 为空串返回 400", emptyCode.statusCode === 400, `got ${emptyCode.statusCode} ${text(emptyCode)}`);

    const badHost = await login({ code: "x", tenantHostname: "not a host!!" });
    assert("非法登录域名返回 400 invalid_tenant_domain", badHost.statusCode === 400 && badHost.json().error === "invalid_tenant_domain", `got ${badHost.statusCode} ${text(badHost)}`);

    // ---- 2. 授权码失效（红灯点）：必须是 401 业务错误，不是 500 ----
    for (const [label, errcode, errmsg] of [
      ["code 无效(40029)", 40029, "invalid code"],
      ["code 已被使用(40163)", 40163, "code been used"]
    ] as Array<[string, number, string]>) {
      stubWechatResponse({ errcode, errmsg });
      const response = await login({ code: "synthetic-invalid-code", productCode: "lanqi" });
      assert(`${label} 返回 401 而不是 500`, response.statusCode === 401, `got ${response.statusCode} ${text(response)}`);
      assert(`${label} 返回 wechat_code_invalid`, response.json().error === "wechat_code_invalid", text(response));
      assert(`${label} 给用户中文可读文案`, /[\u4e00-\u9fa5]/.test(String(response.json().message ?? "")), text(response));
      assert(`${label} 提示重新授权`, /重新授权|重新登录/.test(String(response.json().message ?? "")), text(response));
      noLeak(label, response);
    }

    // ---- 3. 上游/配置故障：502，且不把上游细节给用户 ----
    stubWechatResponse({ errcode: 40013, errmsg: "invalid appid" });
    const badAppid = await login({ code: "synthetic-code", productCode: "lanqi" });
    assert("上游 errcode 40013 返回 502", badAppid.statusCode === 502, `got ${badAppid.statusCode} ${text(badAppid)}`);
    assert("上游 errcode 40013 返回 wechat_upstream_unavailable", badAppid.json().error === "wechat_upstream_unavailable", text(badAppid));
    noLeak("上游 errcode 40013", badAppid);

    stubWechatResponse("upstream boom", 503);
    const upstream5xx = await login({ code: "synthetic-code", productCode: "lanqi" });
    assert("上游 HTTP 503 返回 502", upstream5xx.statusCode === 502, `got ${upstream5xx.statusCode} ${text(upstream5xx)}`);
    noLeak("上游 HTTP 503", upstream5xx);

    stubWechatNetworkFailure();
    const networkFailure = await login({ code: "synthetic-code", productCode: "lanqi" });
    assert("网络失败返回 502", networkFailure.statusCode === 502, `got ${networkFailure.statusCode} ${text(networkFailure)}`);
    assert("网络失败不暴露 fetch 细节名", !/fetch failed/.test(text(networkFailure)), text(networkFailure).slice(0, 160));

    stubWechatResponse({ scope: "snsapi_userinfo" });
    const missingOpenid = await login({ code: "synthetic-code", productCode: "lanqi" });
    assert("上游缺少 openid 返回 502", missingOpenid.statusCode === 502, `got ${missingOpenid.statusCode} ${text(missingOpenid)}`);

    // ---- 4. 正常路径不得被新分支误伤 ----
    stubWechatResponse({ openid: SYNTHETIC_OPENID, scope: "snsapi_userinfo" });
    const ok = await login({ code: "synthetic-valid-code", productCode: "lanqi" });
    assert("有效 code（无 membership）返回 200", ok.statusCode === 200, `got ${ok.statusCode} ${text(ok)}`);
    assert("有效 code 需要补建租户", ok.json().needsTenant === true, text(ok));
    assert("有效 code 返回一次性建租令牌", typeof ok.json().onboardingToken === "string" && ok.json().onboardingToken.length > 10, text(ok).slice(0, 160));

    // ---- 5. 全局：失败路径不得出现 5xx 兜底 ----
    assert("失败路径未触发 500 兜底", !/internal_server_error/.test([missingCode.body, emptyCode.body, badHost.body, badAppid.body, upstream5xx.body, networkFailure.body, missingOpenid.body].join("\n")), "internal_server_error leaked into a business failure path");

    console.log(`\nwechat-login-failure-paths-smoke -> ${pass} passed, ${fail} failed`);
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

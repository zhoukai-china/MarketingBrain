#!/usr/bin/env node
/**
 * 生产只读探针：LQ-18 私域营销「空输入不得退化成 500」的真实修复取证。
 *
 * 背景：WorkBuddy《兰琪私域营销页复测报告》把快速模式空输入当成「页面坏掉」，
 * 复核后发现真正的 P1 是 POST /lanqi/moments/upgrade 空输入返回 HTTP 500，
 * 且把原始 Provider 报错串直接回显（QA-20260911-007）。
 *
 * 本脚本在生产机上跑，自签 JWT 借用存量兰琪租户，只发不会到达模型 Provider 的
 * 非法请求（校验在调用前失败），不写业务数据、不产生模型费用。
 *
 * 用法：ssh root@api.lcppch.top node /tmp/prod-lq18-empty-input-probe.mjs
 */
import { createHmac } from "node:crypto";
import fs from "node:fs";

const ENV_FILE = process.env.BAOLU_ENV_FILE ?? "/etc/baolu-secrets/baolu-os-v2.env";
const API = process.env.BAOLU_API ?? "http://127.0.0.1:3002";

const envText = fs.readFileSync(ENV_FILE, "utf8");
const readEnv = (key) => {
  const m = envText.match(new RegExp("^" + key + "=(.*)$", "m"));
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : "";
};
const secret = readEnv("JWT_SECRET");
if (!secret) throw new Error("JWT_SECRET not configured");

const b64 = (v) => Buffer.from(v).toString("base64url");
const sign = (d) => createHmac("sha256", secret).update(d).digest("base64url");
function token(tenantId, userId) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64(JSON.stringify({ tenantId, userId, iat: now, exp: now + 1800 }));
  return `${head}.${body}.${sign(`${head}.${body}`)}`;
}

// 生产存量兰琪租户（docs/agents/lanqi-beauty/STATUS.md）
const A = { tenant: "cmt6idd1c04v62hgb86gvh7pz", user: "cmt6idd1g04v72hgbue4moh86", store: "cmt6idd1j04v92hgbyxtcd694" };

// 预期面向老板的中文提示（用转义写死，避免脚本自身编码问题）
const EXPECT_RAW = "\u8bf7\u5148\u5199\u4e00\u53e5\u4f60\u7684\u539f\u8bdd"; // 请先写一句你的原话

// 内部串泄露标记：这些一旦出现在响应体，就是「把故障说给老板听」
const LEAK = /provider_http_error|llm_provider_not_configured|internal_server_error|INVALID_MSG|TypeError|ReferenceError|\bat\s+\S+\.(ts|js):\d+/i;

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}  ${detail}`);
}

async function call(method, path, { headers = {}, body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  return { status: res.status, text };
}

const auth = { authorization: `Bearer ${token(A.tenant, A.user)}` };

console.log(`# production LQ-18 empty-input probe  api=${API}  tenant=${A.tenant}`);

// 1) 快速模式空原话：必须 422（给老板看的填表提示），不能 500
const fast = await call("POST", "/lanqi/moments/upgrade", {
  headers: auth,
  body: { storeId: A.store, mode: "fast", raw: "" }
});
record("fast/empty raw -> 422", fast.status === 422, `status=${fast.status} body=${fast.text.slice(0, 120)}`);
record("fast/empty raw keeps boss-facing hint", fast.text.includes(EXPECT_RAW), `hintPresent=${fast.text.includes(EXPECT_RAW)}`);
record("fast/empty raw no internal leak", !LEAK.test(fast.text), `leak=${LEAK.test(fast.text)}`);

// 2) 专业模式空字段：同样必须是输入类 4xx，不是 500
const pro = await call("POST", "/lanqi/moments/upgrade", {
  headers: auth,
  body: { storeId: A.store, mode: "pro", pillar: "work", fields: {} }
});
record("pro/empty fields -> 4xx", pro.status >= 400 && pro.status < 500, `status=${pro.status} body=${pro.text.slice(0, 120)}`);
record("pro/empty fields no internal leak", !LEAK.test(pro.text), `leak=${LEAK.test(pro.text)}`);

// 3) 微信群话术空内容：schema 层必须 400「参数不合法」，不能 500
const wechat = await call("POST", "/lanqi/moments/wechat-group", {
  headers: auth,
  body: { storeId: A.store, scene: "activity", detail: "" }
});
record("wechat/empty detail -> 400", wechat.status === 400, `status=${wechat.status} body=${wechat.text.slice(0, 120)}`);
record("wechat/empty detail no internal leak", !LEAK.test(wechat.text), `leak=${LEAK.test(wechat.text)}`);

// 4) 跨门店：A 的用户不能用 B 的 storeId（不许串租户）
const foreign = await call("POST", "/lanqi/moments/upgrade", {
  headers: auth,
  body: { storeId: "cmt6wlw8b051apou3ij4oc1zx", mode: "fast", raw: "\u4eca\u5929\u5e97\u91cc\u6765\u4e86\u4e2a\u5ba2\u4eba\u505a\u4e86\u6e05\u6d01\u62a4\u7406\u76ae\u80a4\u4eae\u4e86\u4e0d\u5c11\u5f88\u6ee1\u610f" }
});
record("foreign storeId rejected (no cross-tenant)", foreign.status === 404 || foreign.status === 403, `status=${foreign.status} body=${foreign.text.slice(0, 120)}`);

const failed = results.filter((r) => !r.pass);
console.log(`\nprod-lq18-empty-input-probe -> ${results.length - failed.length} passed, ${failed.length} failed`);
if (failed.length) {
  console.log(`failed: ${failed.map((f) => f.name).join(" | ")}`);
  process.exitCode = 1;
}

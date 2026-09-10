#!/usr/bin/env bash
# 生产 LQ-18 私域营销接口验收（在 api.lcppch.top 上执行）
#
# 背景：QA-20260911-001 生产 Prisma 客户端缺失 lanqi 四个模型，
# `/lanqi/dashboard` `/lanqi/goals` `/lanqi/moments/*` 全部 500。
# 客户端就地重生成后必须重新取证，本脚本把 LQ-18 的全部对外接口跑一遍。
#
# 用法：ssh root@api.lcppch.top bash -s < scripts/tmp/prod-lanqi-lq18-acceptance.sh
# 只读 + 一次真实生成（群话术/配图走真实 Provider）；不写业务数据，不改配置。
set -u

cat > /tmp/lq18-acceptance.mjs <<'JS'
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
if (!secret) throw new Error("JWT_SECRET 未配置");

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
const B = { tenant: "cmt6wlw7w0517pou3005wvk8o", user: "cmt6wlw850518pou3jyxodf6g", store: "cmt6wlw8b051apou3ij4oc1zx" };
const NEG = { tenant: "cmqxrjp4k00029ttx2y5gjpsu", user: "cmqxfov5n0000n49iewart2zf" };

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}  ${detail}`);
}

async function call(method, path, { headers = {}, body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  return { status: res.status, text, json: (() => { try { return JSON.parse(text); } catch { return null; } })() };
}

const auth = (who) => ({ authorization: `Bearer ${token(who.tenant, who.user)}` });
const has = (haystack, needle) => haystack.includes(needle);

console.log(`# production LQ-18 acceptance  api=${API}  env=${ENV_FILE}`);
console.log(`# tenant A=${A.tenant} store=${A.store}`);

// 1) 匿名必须 401（不能因为 entitlement 回填把门禁打开）
for (const path of ["/lanqi/stores", "/lanqi/dashboard?month=2026-09"]) {
  const r = await call("GET", path);
  record(`anonymous ${path} 401`, r.status === 401, `status=${r.status} body=${r.text.slice(0, 80)}`);
}

// 2) A 租户核心读接口
const reads = [
  ["/lanqi/stores", 200],
  ["/lanqi/store-profile", 200],
  ["/lanqi/dashboard?month=2026-09", 200],
  ["/lanqi/goals", 200],
  [`/lanqi/moments/upgrades?storeId=${A.store}&limit=5`, 200]
];
for (const [path, expect] of reads) {
  const r = await call("GET", path, { headers: auth(A) });
  record(`A ${path} ${expect}`, r.status === expect, `status=${r.status} body=${r.text.slice(0, 120)}`);
}

// 3) 口径检查：dashboard 顶层的 dataSource 是「门店指标来源」（demo|pos，缺 POS
//    数据时为 demo 并由界面显式标注），/lanqi/goals 的 dataSource 是运行数据模式
//    （demo|database，来自 DATA_MODE）。两者同名不同义，这里分别按各自契约断言。
const dash = await call("GET", "/lanqi/dashboard?month=2026-09", { headers: auth(A) });
const goals = await call("GET", "/lanqi/goals", { headers: auth(A) });
const dashSource = dash.json?.dataSource ?? dash.json?.data?.dataSource ?? null;
const goalsSource = goals.json?.dataSource ?? goals.json?.data?.dataSource ?? null;
record(
  "dashboard.dataSource ∈ {demo,pos} 且 goals.dataSource ∈ {demo,database}",
  ["demo", "pos"].includes(dashSource) && ["demo", "database"].includes(goalsSource),
  `dashboard.dataSource=${dashSource}（指标来源） goals.dataSource=${goalsSource}（DATA_MODE）`
);

// 4) LQ-18 两处 P1：微信群话术 + AI 配图（真实生成）
const wechat = await call("POST", "/lanqi/moments/wechat-group", {
  headers: auth(A),
  body: { storeId: A.store, scene: "notice", detail: "本周三下午门店设备检修，18 点后正常营业，欢迎提前预约", tone: "亲切大姐" }
});
const wechatBody = wechat.json?.result?.body ?? wechat.json?.body ?? "";
const VENDOR_TOKENS = /deepseek|qwen|minimax|gpt-|openai|claude|provider|厂商|模型名/i;
record(
  "A POST /lanqi/moments/wechat-group 200",
  wechat.status === 200 && wechat.json?.ok === true && wechatBody.trim().length > 0,
  `status=${wechat.status} bodyLen=${wechatBody.length} preview=${wechatBody.slice(0, 40)}`
);
record(
  "群话术不暴露模型/厂商名",
  !VENDOR_TOKENS.test(JSON.stringify(wechat.json ?? {})),
  `hit=${VENDOR_TOKENS.test(JSON.stringify(wechat.json ?? {}))}`
);

const image = await call("POST", "/lanqi/moments/image", {
  headers: auth(A),
  body: { storeId: A.store, caption: "秋季补水护理，到店体验价" }
});
const imageUrl = image.json?.asset?.url ?? "";
record(
  "A POST /lanqi/moments/image 200 + 资产 URL 作用域为 /lanqi",
  image.status === 200 && imageUrl.startsWith("/lanqi/moments/assets/"),
  `status=${image.status} url=${imageUrl || image.text.slice(0, 80)}`
);

// 5) 配图资产必须能在 /lanqi 作用域取回（写死 /beauty-industry 会 403 破图）
const assetUrl = image.json?.asset?.url;
if (assetUrl) {
  const res = await fetch(`${API}${assetUrl}`, { headers: auth(A) });
  const buf = Buffer.from(await res.arrayBuffer());
  record(
    `A GET ${assetUrl} 200 image/png`,
    res.status === 200 && buf.length > 1024 && buf.subarray(0, 4).toString("hex") === "89504e47",
    `status=${res.status} bytes=${buf.length} magic=${buf.subarray(0, 4).toString("hex")}`
  );
} else {
  record("A GET /lanqi/moments/assets/:id 200", false, "上一步未返回 asset.url，无法校验资产可达性");
}

// 6) B 租户同样可用（生产有两个存量兰琪租户）
const storesB = await call("GET", "/lanqi/stores", { headers: auth(B) });
record("B /lanqi/stores 200", storesB.status === 200, `status=${storesB.status}`);

// 7) 租户隔离：A 用 B 的 storeId 必须 404 且不回泄 B 的门店信息
const cross = await call("GET", `/lanqi/moments/upgrades?storeId=${B.store}&limit=5`, { headers: auth(A) });
record(
  "A 读 B 门店 → 404 且不回泄",
  cross.status === 404 && !has(cross.text, B.store),
  `status=${cross.status} leaksBStoreId=${has(cross.text, B.store)} body=${cross.text.slice(0, 80)}`
);
const crossImage = await call("POST", "/lanqi/moments/image", { headers: auth(A), body: { storeId: B.store, caption: "越权探针" } });
record(
  "A 对 B 门店生成配图 → 404 且不回泄",
  crossImage.status === 404 && !has(crossImage.text, B.store),
  `status=${crossImage.status} body=${crossImage.text.slice(0, 80)}`
);

// 8) 负向对照：无 lanqi entitlement 的租户必须 403
for (const path of ["/lanqi/stores", "/lanqi/dashboard?month=2026-09"]) {
  const r = await call("GET", path, { headers: auth(NEG) });
  record(
    `无 entitlement 租户 ${path} 403 product_entitlement_missing`,
    r.status === 403 && r.json?.code === "product_entitlement_missing",
    `status=${r.status} code=${r.json?.code ?? "-"}`
  );
}

const failed = results.filter((r) => !r.pass);
console.log(`\n# summary: ${results.length - failed.length}/${results.length} PASS`);
if (failed.length) {
  console.log(`# failed: ${failed.map((f) => f.name).join(" | ")}`);
}
process.exit(failed.length ? 1 : 0);
JS

node /tmp/lq18-acceptance.mjs
echo "prod_lanqi_lq18_acceptance:exit=$?"

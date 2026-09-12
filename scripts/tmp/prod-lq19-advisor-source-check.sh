#!/usr/bin/env bash
# 生产 LQ-19 顾问「参考方法标签」只读验收（在 api.lcppch.top 上执行）
#
# 背景：QA-20260911-010 修复顾问回答里的「来源」标签编造平台官方出处的问题。
# 生产没有内测实例的 /auth/dev-login 链路，因此本脚本与 prod-lanqi-lq19-acquire-acceptance.sh
# 同口径：从生产 env 读 JWT_SECRET，现场为**既有生产兰琪租户**签发只读 token。
#
# 只读：只调用 GET /lanqi/stores 与 POST /lanqi/acquire/advisor（顾问为纯读接口，不落业务数据），
# 不改配置、不写库、不动账号。会真实调用模型（有费用），因此只在验收时跑，不进 CI。
#
# 用法：Get-Content scripts/tmp/prod-lq19-advisor-source-check.sh -Raw | ssh root@api.lcppch.top "bash -s"
set -u

TMP_JS="/tmp/lq19-advisor-source-check-$$.mjs"
cat > "$TMP_JS" <<'JS'
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

// 生产存量兰琪租户（与 prod-lanqi-lq19-acquire-acceptance.sh 一致）
const A = { tenant: "cmt6idd1c04v62hgb86gvh7pz", user: "cmt6idd1g04v72hgbue4moh86" };

const SOURCE_OFFICIAL_CLAIM = /官方|公告|通知|白皮书|算法文档|规则文档|内部资料|内部文件|红头|政策原文|平台文件/;
const VENDOR_LEAK = /minimax|wan2\.2|wan2|即梦|火山|方舟|kling|bailian|deepseek|qwen|gpt-|openai|claude|豆包|通义|stable diffusion|sora|runway|可灵|百炼/i;

const QUESTIONS = [
  { platform: "dy", question: "抖音投了本地推没转化，怎么调？" },
  { platform: "sph", question: "视频号发了没人转，问题在哪？" },
  { platform: "mt", question: "美团团购利润被压，怎么办？" },
];

let failures = 0;
function record(name, ok, detail) {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  ${detail}` : ""}`);
}

async function call(method, path, { headers = {}, body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, text, json: (() => { try { return JSON.parse(text); } catch { return null; } })() };
}

const auth = { authorization: `Bearer ${token(A.tenant, A.user)}` };

const stores = await call("GET", "/lanqi/stores", { headers: auth });
const storeId = stores.json?.stores?.[0]?.id;
record("生产兰琪门店列表可读", Boolean(storeId), `HTTP ${stores.status} · ${stores.json?.stores?.length ?? 0} 店`);
if (!storeId) {
  console.log("\nprod_lq19_advisor_source_check: FAIL (无法取得门店，后续断言未执行)");
  process.exit(1);
}

for (const q of QUESTIONS) {
  const res = await call("POST", "/lanqi/acquire/advisor", {
    headers: auth,
    body: { storeId, question: q.question, platform: q.platform },
  });
  const result = res.json?.result ?? {};
  const answer = result?.answer ?? {};
  const sources = Array.isArray(answer.sources) ? answer.sources : [];
  const prefix = `「${q.platform}」${q.question}`;

  record(
    `${prefix} 顾问回答 200 且已出动作清单`,
    res.status === 200 && result.needPlatform !== true && Boolean(result.answer),
    `HTTP ${res.status} · sources=${JSON.stringify(sources)}`,
  );
  if (res.status !== 200) continue;

  record(`${prefix} 参考标签 2~3 条`, sources.length >= 2 && sources.length <= 3, `count=${sources.length}`);
  const officialHits = sources.filter((label) => SOURCE_OFFICIAL_CLAIM.test(String(label)));
  record(`${prefix} 标签不含「官方/公告/算法文档/内部资料」等编造出处`, officialHits.length === 0, officialHits.join(",") || "无");
  const tooLong = sources.filter((label) => String(label).length > 20);
  record(`${prefix} 标签长度不超 20 字`, tooLong.length === 0, tooLong.join(",") || "无");
  const leaks = JSON.stringify(answer).match(VENDOR_LEAK) ?? [];
  record(`${prefix} 回答不泄露模型/厂商名`, leaks.length === 0, leaks.join(",") || "无");
}

console.log(`\nprod_lq19_advisor_source_check: ${failures === 0 ? "PASS" : "FAIL"} (${failures} failed)`);
process.exit(failures === 0 ? 0 : 1);
JS

BAOLU_ENV_FILE="${BAOLU_ENV_FILE:-/etc/baolu-secrets/baolu-os-v2.env}" \
BAOLU_API="${BAOLU_API:-http://127.0.0.1:3002}" \
node "$TMP_JS"
rc=$?
rm -f "$TMP_JS"
echo "prod_lq19_advisor_source_check:exit=$rc"
exit "$rc"

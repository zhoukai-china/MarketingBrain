#!/usr/bin/env bash
# 生产 LQ-19 公域获客接口验收（在 api.lcppch.top 上执行）
#
# 背景：LQ-19 公域获客（抖音/视频号文案、AI 顾问、直播话术、文案转片）
# 随 release 20260911-lanqi-lq19-acquire-prod1 发布到生产。本脚本在生产上
# 只跑「规则型接口 + 1 次真实文案生成」：不写业务数据、不改配置、不动账号。
# 规则型接口（live/plan、video/storyboard、video/shot）不调模型，秒回；
# copywriter 走真实 Provider，用于证明生产模型链路可用（与 LQ-18 同口径）。
#
# 用法：ssh root@api.lcppch.top bash -s < scripts/tmp/prod-lanqi-lq19-acquire-acceptance.sh
set -u

cat > /tmp/lq19-acquire-acceptance.mjs <<'JS'
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

const VENDOR_TOKENS = /deepseek|qwen|minimax|gpt-|openai|claude|provider|厂商|模型名/i;

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

console.log(`# production LQ-19 acquire acceptance  api=${API}  env=${ENV_FILE}`);
console.log(`# tenant A=${A.tenant} store=${A.store}`);

// ---------- 1) 匿名必须 401：公域获客路由不能被 entitlement 回填顺带打开 ----------
const anonBodies = {
  "/lanqi/acquire/video/storyboard": { storeId: A.store, script: "匿名探针" },
  "/lanqi/acquire/video/shot": { storeId: A.store, text: "匿名探针", index: 0, total: 1 },
  "/lanqi/acquire/live/plan": { storeId: A.store, host: "匿名", carries: ["团购券"], main: "补水", sell: "实测", platforms: ["抖音"] }
};
for (const [path, body] of Object.entries(anonBodies)) {
  const r = await call("POST", path, { body });
  // 未登录由 Fastify errorHandler 统一回 `{ error, message }`（不是 `code`），
  // 这里按实际契约取值，避免把正确的 401 误判成失败。
  const code = r.json?.code ?? r.json?.error ?? "-";
  record(
    `anonymous POST ${path} 401 login_required`,
    r.status === 401 && code === "login_required",
    `status=${r.status} code=${code} body=${r.text.slice(0, 80)}`
  );
}

// ---------- 2) A 租户 · 文案转片：纯规则分镜 ----------
const SCRIPT = "秋天脸干到起皮，先来做个皮肤检测。我们家的补水项目，做完当天就能上妆。今天到店体验价，进店就送小样。";
const storyboard = await call("POST", "/lanqi/acquire/video/storyboard", {
  headers: auth(A),
  body: { storeId: A.store, script: SCRIPT, splitMode: "auto", styleKey: "clean" }
});
const sb = storyboard.json?.result;
const shots = Array.isArray(sb?.shots) ? sb.shots : [];
const promptsOk = shots.length > 0 && shots.every((s) => typeof s.prompt === "string" && s.prompt.trim().length > 0);
record(
  "A POST /lanqi/acquire/video/storyboard 200 + 每镜有生视频提示词",
  storyboard.status === 200 && storyboard.json?.ok === true && shots.length > 0 && promptsOk && sb?.totalSeconds > 0,
  `status=${storyboard.status} shotCount=${sb?.shotCount ?? "-"} shots=${shots.length} totalSeconds=${sb?.totalSeconds ?? "-"} promptsOk=${promptsOk}`
);
record(
  "分镜口径：sourceChars/totalSeconds/negative 齐备且服务版本可追溯",
  typeof sb?.sourceChars === "number" && sb.sourceChars > 0 && typeof sb?.negative === "string" && sb.negative.length > 0 && /lanqi-video-script/.test(String(sb?.serviceVersion ?? "")),
  `sourceChars=${sb?.sourceChars} serviceVersion=${sb?.serviceVersion ?? "-"} negativeLen=${String(sb?.negative ?? "").length}`
);

// ---------- 3) A 租户 · 重写单镜（改风格/换素材后重出提示词） ----------
const shot = await call("POST", "/lanqi/acquire/video/shot", {
  headers: auth(A),
  body: { storeId: A.store, text: "我们家的补水项目，做完当天就能上妆", styleKey: "clean", castName: "小雅", sceneName: "前台", propName: "护理卡", index: 1, total: 4 }
});
record(
  "A POST /lanqi/acquire/video/shot 200 + 重出提示词含素材名",
  shot.status === 200 && shot.json?.ok === true && typeof shot.json?.result?.prompt === "string" && shot.json.result.prompt.includes("小雅"),
  `status=${shot.status} promptLen=${String(shot.json?.result?.prompt ?? "").length}`
);

// ---------- 4) A 租户 · 直播话术骨架：5 轮 / 23 段（纯规则） ----------
const LIVE_BODY = {
  storeId: A.store,
  host: "兰琪美业 · 阿雅",
  carries: ["团购券", "居家产品"],
  main: "秋季补水大套组",
  sell: "院线级补水，做完当天不紧绷，敏感肌可做",
  price: "到店体验价 128 元，原价 398 元",
  card: "充值 1000 送 200，卡内可拆分使用",
  platforms: ["抖音", "视频号"]
};
const livePlan = await call("POST", "/lanqi/acquire/live/plan", { headers: auth(A), body: LIVE_BODY });
const lp = livePlan.json?.result;
record(
  "A POST /lanqi/acquire/live/plan 200 + 5 轮 23 段骨架",
  livePlan.status === 200 && livePlan.json?.ok === true && Array.isArray(lp?.rounds) && lp.rounds.length === 5 && Array.isArray(lp?.segments) && lp.segments.length === 23,
  `status=${livePlan.status} rounds=${lp?.rounds?.length ?? "-"} segments=${lp?.segments?.length ?? "-"} batches=${Array.isArray(lp?.batches) ? lp.batches.length : "-"}`
);
record(
  "直播骨架：批次分段覆盖全部段号且无重复",
  (() => {
    const segNos = (lp?.batches ?? []).flatMap((b) => b.segNos ?? []);
    return segNos.length === 23 && new Set(segNos).size === 23;
  })(),
  `coveredSegNos=${(lp?.batches ?? []).flatMap((b) => b.segNos ?? []).length}`
);

// ---------- 5) A 租户 · 缺必填必须 422 反问，不静默出稿 ----------
const liveMissing = await call("POST", "/lanqi/acquire/live/plan", { headers: auth(A), body: { storeId: A.store } });
record(
  "缺必填 live/plan 422 invalid_live_input 且带「还差必填」",
  liveMissing.status === 422 && liveMissing.json?.code === "invalid_live_input" && has(String(liveMissing.json?.message ?? ""), "还差必填"),
  `status=${liveMissing.status} code=${liveMissing.json?.code ?? "-"} message=${String(liveMissing.json?.message ?? "").slice(0, 60)}`
);
const emptyScript = await call("POST", "/lanqi/acquire/video/storyboard", { headers: auth(A), body: { storeId: A.store, script: "   " } });
record(
  "空口播文案 storyboard 422 invalid_video_script_input",
  emptyScript.status === 422 && emptyScript.json?.code === "invalid_video_script_input",
  `status=${emptyScript.status} code=${emptyScript.json?.code ?? "-"} message=${String(emptyScript.json?.message ?? "").slice(0, 60)}`
);

// ---------- 6) A 租户 · 真实文案生成（唯一一次调模型，证明生产模型链路可用） ----------
const copywriter = await call("POST", "/lanqi/acquire/copywriter", {
  headers: auth(A),
  body: { storeId: A.store, raw: "秋天脸干起皮，店里新上了补水套组，让写条到店种草的短视频文案", purpose: "deal", goal: "conversion" }
});
const cwBody = copywriter.json?.result?.body ?? "";
record(
  "A POST /lanqi/acquire/copywriter 200 + 正文非空",
  copywriter.status === 200 && copywriter.json?.ok === true && String(cwBody).trim().length > 0,
  `status=${copywriter.status} bodyLen=${String(cwBody).length} preview=${String(cwBody).slice(0, 40)}`
);
record(
  "文案输出不暴露模型/厂商名",
  !VENDOR_TOKENS.test(JSON.stringify(copywriter.json ?? {})),
  `hit=${VENDOR_TOKENS.test(JSON.stringify(copywriter.json ?? {}))}`
);

// ---------- 7) 租户隔离：A 用 B 的 storeId 必须 404 且不回泄 ----------
const crossStoryboard = await call("POST", "/lanqi/acquire/video/storyboard", { headers: auth(A), body: { storeId: B.store, script: SCRIPT } });
record(
  "A 用 B 门店请求 storyboard → 404 store_not_found 且不回泄 B 门店 id",
  crossStoryboard.status === 404 && crossStoryboard.json?.code === "store_not_found" && !has(crossStoryboard.text, B.store),
  `status=${crossStoryboard.status} code=${crossStoryboard.json?.code ?? "-"} leaksBStoreId=${has(crossStoryboard.text, B.store)}`
);
const crossLive = await call("POST", "/lanqi/acquire/live/plan", { headers: auth(A), body: { ...LIVE_BODY, storeId: B.store } });
record(
  "A 用 B 门店请求 live/plan → 404 store_not_found 且不回泄 B 门店 id",
  crossLive.status === 404 && crossLive.json?.code === "store_not_found" && !has(crossLive.text, B.store),
  `status=${crossLive.status} code=${crossLive.json?.code ?? "-"} leaksBStoreId=${has(crossLive.text, B.store)}`
);

// ---------- 8) 负向对照：无 lanqi entitlement 的租户必须 403 ----------
const neg = await call("POST", "/lanqi/acquire/live/plan", { headers: auth(NEG), body: LIVE_BODY });
record(
  "无 entitlement 租户 live/plan 403 product_entitlement_missing",
  neg.status === 403 && neg.json?.code === "product_entitlement_missing",
  `status=${neg.status} code=${neg.json?.code ?? "-"}`
);

// ---------- 9) 全量响应无模型/厂商名泄露 ----------
const allPayloads = JSON.stringify([storyboard.json, shot.json, livePlan.json, copywriter.json, liveMissing.json, emptyScript.json, crossStoryboard.json, crossLive.json, neg.json]);
record("全部响应不含模型/厂商名", !VENDOR_TOKENS.test(allPayloads), `hit=${VENDOR_TOKENS.test(allPayloads)}`);

const failed = results.filter((r) => !r.pass);
console.log(`\n# summary: ${results.length - failed.length}/${results.length} PASS`);
if (failed.length) console.log(`# failed: ${failed.map((f) => f.name).join(" | ")}`);
const out = "/tmp/lq19-acquire-acceptance.json";
fs.writeFileSync(out, JSON.stringify({ api: API, at: new Date().toISOString(), results }, null, 2));
console.log(`# report: ${out}`);
process.exit(failed.length ? 1 : 0);
JS

node /tmp/lq19-acquire-acceptance.mjs
echo "prod_lanqi_lq19_acquire_acceptance:exit=$?"

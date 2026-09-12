#!/usr/bin/env node
/**
 * QA-20260911-010 证据探针（只读，不改业务数据）：
 * 打内测实例，真实调用 /beauty-industry/acquire/advisor，验证顾问回答里的「参考方法标签」
 * 不再出现「官方 / 公告 / 算法文档 / 内部资料」这类**编造的权威出处**。
 *
 * 用法：
 *   node scripts/tmp/lq19-advisor-source-note-probe.mjs --api https://api.lcppch.top/lanqi-test/api
 *
 * 注意：本脚本会真实调用模型（有费用），只在验收时跑，不进 CI。
 */
const args = process.argv.slice(2);
function argValue(flag, fallback) {
  for (let i = args.length - 1; i >= 0; i -= 1) {
    if (args[i] === flag && args[i + 1]) return args[i + 1];
  }
  return fallback;
}

const apiBase = argValue("--api", "https://api.lcppch.top/lanqi-test/api").replace(/\/+$/, "");
const rounds = Number(argValue("--rounds", "3"));

const SOURCE_OFFICIAL_CLAIM = /官方|公告|通知|白皮书|算法文档|规则文档|内部资料|内部文件|红头|政策原文|平台文件/;
const VENDOR_LEAK = /minimax|wan2\.2|wan2|即梦|火山|方舟|kling|bailian|deepseek|qwen|gpt-|openai|claude|豆包|通义|stable diffusion|sora|runway|可灵|百炼/i;

let failures = 0;
function record(name, ok, detail) {
  if (!ok) failures += 1;
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${detail ? ` :: ${detail}` : ""}`);
}

async function post(pathname, body, token) {
  const response = await fetch(`${apiBase}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 非 JSON 响应 */ }
  return { status: response.status, json, text };
}

const QUESTIONS = [
  { platform: "dy", question: "抖音投了本地推没转化，怎么调？" },
  { platform: "sph", question: "视频号发了没人转，问题在哪？" },
  { platform: "mt", question: "美团团购利润被压，怎么办？" },
];

async function main() {
  const login = await post("/auth/dev-login", {
    productCode: "lanqi",
    tenantRole: "local_business",
    tenantName: "兰琪顾问来源标签验收",
    industry: "美业",
  });
  const token = login.json?.token;
  record("dev-login 取得会话（内测实例专用链路）", Boolean(token), `HTTP ${login.status}`);
  if (!token) { process.exit(1); }

  const storesRes = await fetch(`${apiBase}/lanqi/stores`, { headers: { authorization: `Bearer ${token}` } });
  const storesJson = await storesRes.json().catch(() => ({}));
  const storeId = storesJson?.stores?.[0]?.id;
  record("门店列表返回 store_id", Boolean(storeId), `HTTP ${storesRes.status} · ${storesJson?.stores?.length ?? 0} 店`);
  if (!storeId) { process.exit(1); }

  for (let i = 0; i < rounds; i += 1) {
    const q = QUESTIONS[i % QUESTIONS.length];
    const res = await post("/lanqi/acquire/advisor", { storeId, question: q.question, platform: q.platform }, token);
    const result = res.json?.result ?? {};
    const answer = result?.answer ?? {};
    const sources = Array.isArray(answer.sources) ? answer.sources : [];
    const prefix = `第${i + 1}轮「${q.question}」`;
    record(
      `${prefix} 顾问回答 200 且已出动作清单`,
      res.status === 200 && result.needPlatform !== true && Boolean(result.answer),
      `HTTP ${res.status} · needPlatform=${result.needPlatform} · sources=${JSON.stringify(sources)} · body=${res.text.slice(0, 300)}`,
    );
    if (res.status !== 200) continue;
    record(`${prefix} sources 是 2~3 条标签`, sources.length >= 2 && sources.length <= 3, `count=${sources.length}`);
    const officialHits = sources.filter((label) => SOURCE_OFFICIAL_CLAIM.test(String(label)));
    record(`${prefix} 标签不含「官方/公告/算法文档/内部资料」等编造出处`, officialHits.length === 0, officialHits.join(",") || "无");
    const tooLong = sources.filter((label) => String(label).length > 20);
    record(`${prefix} 标签长度不超 20 字`, tooLong.length === 0, tooLong.join(",") || "无");
    const leaks = (JSON.stringify(answer).match(VENDOR_LEAK) ?? []);
    record(`${prefix} 回答不泄露模型/厂商名`, leaks.length === 0, leaks.join(",") || "无");
  }

  console.log(`\nlq19_advisor_source_note_probe: ${failures === 0 ? "PASS" : "FAIL"} (${failures} failed)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

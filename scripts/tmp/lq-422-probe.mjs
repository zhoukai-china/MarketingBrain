#!/usr/bin/env node
// 临时诊断脚本：量化 /beauty-industry/acquire/live/segments 与 /advisor 的 422（合规门禁）复发率。
// 只读诊断用，不进入仓库交付；用完删除。
const apiBase = process.argv.find((a) => a.startsWith("--api="))?.slice(6) ?? "https://api.lcppch.top/lanqi-test/api";
const liveRuns = Number(process.argv.find((a) => a.startsWith("--live="))?.slice(7) ?? 4);
const advisorRuns = Number(process.argv.find((a) => a.startsWith("--advisor="))?.slice(10) ?? 3);

async function post(path, body, token) {
  const startedAt = Date.now();
  const res = await fetch(`${apiBase}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, json, elapsedMs: Date.now() - startedAt };
}

const login = await post("/auth/dev-login", {
  productCode: "beauty-industry",
  tenantRole: "local_business",
  tenantName: "兰琪 422 探针",
  industry: "美业",
});
const token = login.json?.token;
if (!token) {
  console.log("dev-login 失败", login.status, JSON.stringify(login.json).slice(0, 300));
  process.exit(1);
}

const storesRes = await fetch(`${apiBase}/beauty-industry/stores`, { headers: { Authorization: `Bearer ${token}` } });
const storesJson = await storesRes.json().catch(() => ({}));
const storeId = storesJson?.stores?.[0]?.id;
if (!storeId) {
  console.log("门店列表为空");
  process.exit(1);
}

const liveInput = {
  storeId,
  host: "小雅",
  carries: ["团购券", "会员卡"],
  main: "补水护理体验",
  sell: "深层补水+舒缓，做完当天就能上妆，适合熬夜脸、换季干皮。",
  price: "体验价 99 元，原价 398 元，限今天直播间。",
  card: "办卡送 2 次面部护理",
  platforms: ["抖音"],
};

console.log(`# live/segments × ${liveRuns} @ ${apiBase}`);
let liveFail = 0;
for (let i = 1; i <= liveRuns; i += 1) {
  const r = await post("/beauty-industry/acquire/live/segments", { ...liveInput, batchNo: 1 }, token);
  if (!r.ok) liveFail += 1;
  console.log(
    `live#${i} HTTP ${r.status} ${r.elapsedMs}ms ${r.ok ? "" : JSON.stringify(r.json).slice(0, 300)}`
  );
}

console.log(`# advisor × ${advisorRuns}`);
let advisorFail = 0;
for (let i = 1; i <= advisorRuns; i += 1) {
  const r = await post(
    "/beauty-industry/acquire/advisor",
    { storeId, question: "我在抖音发了十几条视频都没什么人看，也没人来店里，第一周应该先做什么？", platform: "dy" },
    token
  );
  if (!r.ok) advisorFail += 1;
  console.log(
    `advisor#${i} HTTP ${r.status} ${r.elapsedMs}ms ${r.ok ? "" : JSON.stringify(r.json).slice(0, 300)}`
  );
}

console.log(`summary: live ${liveRuns - liveFail}/${liveRuns} ok · advisor ${advisorRuns - advisorFail}/${advisorRuns} ok`);

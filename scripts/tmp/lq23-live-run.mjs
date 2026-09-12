#!/usr/bin/env node
/**
 * LQ-23「文案转片」首次真实联调（在**内测实例**上跑，不是生产）。
 *
 * 走的是 Web 页面完全相同的接口顺序：
 *   /auth/dev-login → /lanqi/stores → /lanqi/media/quote → /lanqi/media/confirm
 *   → /lanqi/media/jobs/:id/refresh（轮询）→ /lanqi/media/assets/:id（取成片）
 *
 * 授权口径（用户 2026-09-12 确认）：wan2.6-i2v-flash · 720P · 无声 · 每镜 3 秒 ·
 * 30 积分/秒（3 秒 = 90 积分）· 首次联调费用上限 ¥10 · 无重试 · 失败即止。
 *
 * 用法：
 *   node scripts/tmp/lq23-live-run.mjs --base https://api.lcppch.top/lanqi-test/api \
 *     --image scripts/tmp/lq23-synthetic-portrait.png --out scripts/tmp/lq23-live/ --seconds 3
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
function argValue(flag, fallback) {
  for (let i = args.length - 1; i >= 0; i -= 1) {
    if (args[i] === flag && args[i + 1]) return args[i + 1];
  }
  return fallback;
}

const base = argValue("--base", "https://api.lcppch.top/lanqi-test/api").replace(/\/+$/, "");
const imagePath = argValue("--image", "scripts/tmp/lq23-synthetic-portrait.png");
const outDir = argValue("--out", "scripts/tmp/lq23-live");
const seconds = Number(argValue("--seconds", "3"));
const resolution = argValue("--resolution", "720P");
const pollIntervalMs = Number(argValue("--poll-interval-ms", "6000"));
const pollLimit = Number(argValue("--poll-limit", "70"));
const quoteOnly = args.includes("--quote-only");

const evidence = { base, imagePath, resolution, seconds, steps: [] };
function step(name, detail) {
  evidence.steps.push({ name, ...detail });
  console.log(`[STEP] ${name} :: ${JSON.stringify(detail)}`);
}

async function call(method, requestPath, { token, body, headers = {} } = {}) {
  const response = await fetch(base + requestPath, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { raw: text.slice(0, 400) };
  }
  return { status: response.status, body: parsed };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const login = await call("POST", "/auth/dev-login", { body: { productCode: "lanqi" } });
if (login.status !== 200 || !login.body?.token) {
  step("dev-login", { status: login.status, error: login.body });
  process.exit(1);
}
const token = login.body.token;
const tenantId = login.body.tenantId;
step("dev-login", { status: login.status, tenantId, userId: login.body.userId, creditBalance: login.body.creditBalance });

const stores = await call("GET", "/lanqi/stores", { token });
const storeList = Array.isArray(stores.body?.stores) ? stores.body.stores : Array.isArray(stores.body) ? stores.body : [];
step("stores", { status: stores.status, count: storeList.length, first: storeList[0]?.id ?? null });

const imageBytes = await readFile(imagePath);
const dataBase64 = imageBytes.toString("base64");
const payload = {
  kind: "image_to_video",
  prompt: "门店前台，出镜人微笑看向镜头，缓慢推近，光线柔和",
  negativePrompt: "低清晰度，变形脸，多手多指",
  resolution,
  durationSeconds: seconds,
  firstFrame: { contentType: "image/png", dataBase64 }
};

const quote = await call("POST", "/lanqi/media/quote", { token, body: payload });
step("quote", {
  status: quote.status,
  creditCost: quote.body?.creditCost,
  customerPriceYuan: quote.body?.customerPriceYuan,
  canConfirm: quote.body?.canConfirm,
  billable: quote.body?.billable,
  executionMode: quote.body?.executionMode,
  storage: quote.body?.storage,
  blockCode: quote.body?.blockCode,
  message: quote.body?.message
});
if (quoteOnly || quote.status !== 200 || !quote.body?.canConfirm) {
  await writeFile(path.join(await mkdir(outDir, { recursive: true }).then(() => outDir), "evidence.json"), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ liveRun: quoteOnly ? "QUOTE_ONLY" : "FAIL", quote: quote.body?.message, status: quote.status }));
  process.exit(quoteOnly ? 0 : 1);
}

const requestKey = `lq23live${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`.slice(0, 60);
const confirm = await call("POST", "/lanqi/media/confirm", {
  token,
  headers: { "X-Idempotency-Key": requestKey },
  body: { ...payload, requestKey, confirmed: true }
});
const job = confirm.body?.job;
step("confirm", {
  status: confirm.status,
  jobId: job?.id,
  jobStatus: job?.status,
  creditCost: job?.creditCost,
  billingStatus: job?.billingStatus,
  idempotent: confirm.body?.idempotent,
  error: confirm.body?.error,
  message: confirm.body?.message
});
if (!job?.id) {
  await writeFile(path.join(await mkdir(outDir, { recursive: true }).then(() => outDir), "evidence.json"), JSON.stringify(evidence, null, 2));
  process.exit(1);
}

let latest = job;
for (let attempt = 0; attempt < pollLimit; attempt += 1) {
  await sleep(pollIntervalMs);
  const refresh = await call("POST", `/lanqi/media/jobs/${job.id}/refresh`, { token });
  latest = refresh.body?.job ?? latest;
  step(`refresh#${attempt + 1}`, { status: refresh.status, jobStatus: latest?.status, providerStatus: latest?.providerStatus, progress: latest?.progress, assetStatus: latest?.assetStatus });
  if (latest?.status === "succeeded") break;
  if (latest?.status === "failed" || latest?.status === "canceled") break;
}

if (latest?.status !== "succeeded") {
  evidence.result = { jobId: job.id, status: latest?.status, errorMessage: latest?.errorMessage, passed: false };
  await writeFile(path.join(await mkdir(outDir, { recursive: true }).then(() => outDir), "evidence.json"), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ liveRun: "FAIL", jobId: job.id, status: latest?.status, errorMessage: latest?.errorMessage }));
  process.exit(2);
}

const assetResponse = await fetch(`${base}/lanqi/media/assets/${job.id}`, { headers: { Authorization: `Bearer ${token}` } });
const contentType = assetResponse.headers.get("content-type") ?? "";
const bytes = Buffer.from(await assetResponse.arrayBuffer());
await mkdir(outDir, { recursive: true });
const assetPath = path.join(outDir, `lq23-live-shot-${job.id}.mp4`);
await writeFile(assetPath, bytes);
step("asset", { status: assetResponse.status, contentType, bytes: bytes.length, assetPath });

const jobs = await call("GET", "/lanqi/media/jobs?kind=image_to_video", { token });
step("jobs", { status: jobs.status, count: Array.isArray(jobs.body?.jobs) ? jobs.body.jobs.length : null });

evidence.result = {
  passed: bytes.length > 0 && latest.status === "succeeded",
  jobId: job.id,
  status: latest.status,
  creditCost: latest.creditCost,
  billingStatus: latest.billingStatus,
  assetBytes: bytes.length,
  assetContentType: contentType,
  assetPath
};
await writeFile(path.join(outDir, "evidence.json"), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify({ liveRun: evidence.result.passed ? "PASS" : "FAIL", ...evidence.result, tenantId }));

#!/usr/bin/env node
/**
 * LQ-23 视频链路的两条「不应发生」真机验收。
 *
 * 1) 跨租户隔离（默认就跑，零成本、不创建任务）：
 *    拿内测实例上**已经真实存在**的另一租户任务（首轮联调产物），用新建租户去读 / 刷新，
 *    必须全部拿不到；同时确认新建租户自己的任务列表里没有这条别人的任务。
 *
 * 2) 重复确认不重复扣费 + 正反对照（需显式 --allow-spend，会真实创建 1 条样片）：
 *    租户 X 首次确认 → 建任务、扣 90 积分；同一个 requestKey 再确认一次 →
 *    必须返回同一任务、标记 idempotent、余额不再减少、任务总数不增加；
 *    租户 Y 读 X 的这条真实任务 → 必须 404（正对照：X 自己能读到自己的成片）。
 *
 * 用法：
 *   # 零成本：跨租户隔离
 *   node scripts/tmp/lq23-invariants.mjs --base https://api.lcppch.top/lanqi-test/api
 *
 *   # 加跑幂等 + 正对照（会产生 1 条真实样片费用 ¥0.90，需明确授权后再加 --allow-spend）
 *   node scripts/tmp/lq23-invariants.mjs --base https://api.lcppch.top/lanqi-test/api \
 *     --image scripts/tmp/lq23-synthetic-portrait.png --allow-spend
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
function argValue(flag, fallback) {
  for (let i = args.length - 1; i >= 0; i -= 1) {
    if (args[i] === flag && args[i + 1]) return args[i + 1];
  }
  return fallback;
}
function hasFlag(flag) {
  return args.includes(flag);
}

const base = argValue("--base", "https://api.lcppch.top/lanqi-test/api").replace(/\/+$/, "");
const imagePath = argValue("--image", "scripts/tmp/lq23-synthetic-portrait.png");
const outDir = argValue("--out", "scripts/tmp/lq23-invariants");
const allowSpend = hasFlag("--allow-spend");
/** 首轮真实联调产出的任务（属于另一个租户），只用来做零成本跨租户探针。 */
const knownJob = argValue("--known-job", "cmtxmyvn305atvmahiyfyws97");
const knownTenant = argValue("--known-tenant", "cmtxmyv7y059dvmahqyt9t4d8");

let failures = 0;
const evidence = { base, at: new Date().toISOString(), steps: [] };
function record(name, ok, detail) {
  if (!ok) failures += 1;
  evidence.steps.push({ name, ok, detail });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${detail ? ` :: ${detail}` : ""}`);
}
function info(name, detail) {
  evidence.steps.push({ name, info: true, detail });
  console.log(`[INFO] ${name}${detail ? ` :: ${detail}` : ""}`);
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
    parsed = { raw: text.slice(0, 200) };
  }
  return { status: response.status, body: parsed };
}

async function loginFresh(label) {
  const login = await call("POST", "/auth/dev-login", { body: { productCode: "lanqi" } });
  if (login.status !== 200 || !login.body?.token) {
    throw new Error(`${label} dev-login 失败：${login.status} ${JSON.stringify(login.body).slice(0, 160)}`);
  }
  return { token: login.body.token, tenantId: login.body.tenantId, creditBalance: login.body.creditBalance };
}

async function readBalance(token) {
  const result = await call("GET", "/credits/transactions?limit=5", { token });
  return { status: result.status, tenantId: result.body?.tenantId, balance: result.body?.creditBalance };
}

async function listJobs(token) {
  const result = await call("GET", "/lanqi/media/jobs?kind=image_to_video", { token });
  const jobs = Array.isArray(result.body?.jobs) ? result.body.jobs : [];
  return { status: result.status, jobs };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ── 1) 跨租户隔离（零成本，用另一租户已经真实存在的任务当探针）──────────
const tenantB = await loginFresh("探针租户");
record(
  "探针租户与任务所属租户确实不是同一个工作区",
  tenantB.tenantId !== knownTenant,
  `probe=${tenantB.tenantId}`
);

const refreshB = await call("POST", `/lanqi/media/jobs/${knownJob}/refresh`, { token: tenantB.token });
record(
  "别的租户刷新这条任务被拒（拿不到任务状态）",
  refreshB.status === 404,
  `status=${refreshB.status} body=${JSON.stringify(refreshB.body).slice(0, 120)}`
);

const assetB = await call("GET", `/lanqi/media/assets/${knownJob}`, { token: tenantB.token });
record(
  "别的租户取这条成片被拒（拿不到视频文件）",
  [403, 404].includes(assetB.status),
  `status=${assetB.status}`
);

const jobsB = await listJobs(tenantB.token);
record(
  "别的租户的任务列表里看不到这条任务",
  jobsB.status === 200 && !jobsB.jobs.some((job) => job.id === knownJob),
  `status=${jobsB.status} count=${jobsB.jobs.length}`
);

// 反向对照：同一租户自己读自己的任务列表接口是通的（证明上面不是整站 404）。
const balanceB = await readBalance(tenantB.token);
record(
  "探针租户自己的账单接口正常（证明上面的 404 是隔离而不是接口整体不可用）",
  balanceB.status === 200 && balanceB.tenantId === tenantB.tenantId,
  `status=${balanceB.status} tenant=${balanceB.tenantId} balance=${balanceB.balance}`
);

// ── 2) 幂等 + 正反租户对照（需 --allow-spend，会产生 1 条真实样片费用）────
let idempotency = "skipped";
let idempotencyDetail = null;
if (allowSpend) {
  idempotency = "running";
  const tenantX = await loginFresh("出片租户 X");
  const tenantY = await loginFresh("对照租户 Y");
  record("X / Y 是两个不同的工作区", tenantX.tenantId !== tenantY.tenantId, `X=${tenantX.tenantId} Y=${tenantY.tenantId}`);
  info("X 初始余额", `${tenantX.creditBalance}`);

  const imageBytes = await readFile(imagePath);
  const payload = {
    kind: "image_to_video",
    prompt: "门店前台，出镜人微笑看向镜头，缓慢推近，光线柔和",
    negativePrompt: "低清晰度，变形脸，多手多指",
    resolution: "720P",
    durationSeconds: 3,
    firstFrame: { contentType: "image/png", dataBase64: imageBytes.toString("base64") }
  };

  const quote = await call("POST", "/lanqi/media/quote", { token: tenantX.token, body: payload });
  record(
    "报价可确认（先看费用再创建任务）",
    quote.status === 200 && quote.body?.canConfirm === true,
    `status=${quote.status} creditCost=${quote.body?.creditCost} canConfirm=${quote.body?.canConfirm}`
  );
  const creditCost = quote.body?.creditCost ?? 0;

  const requestKey = `lq23inv${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`.slice(0, 60);
  const confirm1 = await call("POST", "/lanqi/media/confirm", {
    token: tenantX.token,
    headers: { "X-Idempotency-Key": requestKey },
    body: { ...payload, requestKey, confirmed: true }
  });
  const jobId = confirm1.body?.job?.id;
  record(
    "首次确认创建了真实任务",
    [200, 202].includes(confirm1.status) && Boolean(jobId),
    `status=${confirm1.status} jobId=${jobId} idempotent=${confirm1.body?.idempotent}`
  );

  const balanceAfterFirst = await readBalance(tenantX.token);
  record(
    "首次确认按报价扣了积分",
    balanceAfterFirst.balance === (tenantX.creditBalance ?? 0) - creditCost,
    `before=${tenantX.creditBalance} after=${balanceAfterFirst.balance} cost=${creditCost}`
  );

  const jobsBefore = await listJobs(tenantX.token);
  const confirm2 = await call("POST", "/lanqi/media/confirm", {
    token: tenantX.token,
    headers: { "X-Idempotency-Key": requestKey },
    body: { ...payload, requestKey, confirmed: true }
  });
  const jobsAfter = await listJobs(tenantX.token);
  const balanceAfterSecond = await readBalance(tenantX.token);

  record(
    "同一 requestKey 重复确认返回同一任务并标记 idempotent",
    [200, 202].includes(confirm2.status) &&
      confirm2.body?.job?.id === jobId &&
      confirm2.body?.idempotent === true,
    `status=${confirm2.status} jobId=${confirm2.body?.job?.id} idempotent=${confirm2.body?.idempotent}`
  );
  record(
    "重复确认没有新建任务",
    jobsBefore.jobs.length === jobsAfter.jobs.length && jobsAfter.jobs.length === 1,
    `before=${jobsBefore.jobs.length} after=${jobsAfter.jobs.length}`
  );
  record(
    "重复确认没有二次扣费",
    balanceAfterSecond.balance === balanceAfterFirst.balance,
    `first=${balanceAfterFirst.balance} second=${balanceAfterSecond.balance}`
  );

  // 等这条真实任务落地（不重试、失败即止），作为后续正对照使用。
  let latest = confirm1.body?.job ?? null;
  for (let attempt = 0; attempt < 70; attempt += 1) {
    await sleep(6000);
    const refresh = await call("POST", `/lanqi/media/jobs/${jobId}/refresh`, { token: tenantX.token });
    latest = refresh.body?.job ?? latest;
    console.log(
      `  refresh#${attempt + 1} status=${latest?.status} progress=${latest?.progress} asset=${latest?.assetStatus}`
    );
    if (latest?.status === "succeeded" || latest?.status === "failed" || latest?.status === "canceled") break;
  }
  record(
    "X 自己的真实任务最终出片成功",
    latest?.status === "succeeded",
    `status=${latest?.status} error=${latest?.errorMessage ?? ""}`
  );

  const ownAsset = await call("GET", `/lanqi/media/assets/${jobId}`, { token: tenantX.token });
  record("正对照：X 自己能读到自己的成片", ownAsset.status === 200, `status=${ownAsset.status}`);

  const crossRefresh = await call("POST", `/lanqi/media/jobs/${jobId}/refresh`, { token: tenantY.token });
  const crossAsset = await call("GET", `/lanqi/media/assets/${jobId}`, { token: tenantY.token });
  record("Y 刷新 X 的真实任务被拒", crossRefresh.status === 404, `status=${crossRefresh.status}`);
  record("Y 取 X 的真实成片被拒", [403, 404].includes(crossAsset.status), `status=${crossAsset.status}`);

  idempotency = failures === 0 ? "covered" : "failed";
  idempotencyDetail = {
    tenantX: tenantX.tenantId,
    tenantY: tenantY.tenantId,
    jobId,
    creditCost,
    balanceAfterFirst: balanceAfterFirst.balance,
    balanceAfterSecond: balanceAfterSecond.balance,
    jobStatus: latest?.status
  };
} else {
  info("未加 --allow-spend", "跳过幂等实测（会真实创建 1 条样片并扣 90 积分）；跨租户隔离已用另一租户的真实任务完成实测。");
}

await mkdir(outDir, { recursive: true });
await writeFile(
  path.join(outDir, "evidence.json"),
  JSON.stringify({ ...evidence, failures, idempotency, idempotencyDetail }, null, 2)
);
console.log(
  JSON.stringify({ invariants: failures === 0 ? "PASS" : "FAIL", failures, idempotency, idempotencyDetail })
);
process.exit(failures === 0 ? 0 : 1);

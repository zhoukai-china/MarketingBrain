import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { prisma } from "../packages/db/dist/index.js";

const webBase = process.env.BEAUTY_E2E_WEB_URL ?? "http://127.0.0.1:5176";
const apiBase = process.env.BEAUTY_E2E_API_URL ?? "http://127.0.0.1:3016";
const runId = process.env.BEAUTY_IMAGE_AUDIT_RUN_ID;
const readOnly = process.env.BEAUTY_IMAGE_E2E_READ_ONLY === "true";
const expectedProviderTasks = Number.parseInt(process.env.BEAUTY_IMAGE_EXPECTED_PROVIDER_TASKS ?? "1", 10);
const chromePath = process.env.BEAUTY_E2E_CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const route = `/agents/beauty-industry/acquisition/xhs?apiBase=${encodeURIComponent(apiBase)}`;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function sortJobSnapshots(jobs) {
  return [...jobs].sort((left, right) => left.id.localeCompare(right.id));
}

function batchRequestIdOf(job) {
  return job?.parameters && typeof job.parameters === "object" && typeof job.parameters.batchRequestId === "string"
    ? job.parameters.batchRequestId
    : null;
}

assert.ok(runId, "BEAUTY_IMAGE_AUDIT_RUN_ID is required");
assert.ok(Number.isInteger(expectedProviderTasks) && expectedProviderTasks >= 1 && expectedProviderTasks <= 3, "expected Provider task count must stay within the authorized batch");
assert.ok(process.env.JWT_SECRET, "JWT_SECRET is required");

function createSessionToken(tenantId, userId) {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = encode({ alg: "HS256", typ: "JWT" });
  const body = encode({ tenantId, userId, iat: now, exp: now + 3600 });
  const signature = createHmac("sha256", process.env.JWT_SECRET).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}

async function apiJson(url, token, init = {}) {
  const response = await fetch(`${apiBase}${url}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.body ? { "content-type": "application/json" } : {}), ...(init.headers ?? {}) }
  });
  return { response, body: await response.json().catch(() => ({})) };
}

async function createIsolatedToken() {
  const response = await fetch(`${apiBase}/auth/dev-login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tenantRole: "local_business", tenantName: `BY26隔离对照-${Date.now()}`, productCode: "beauty-industry" })
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.ok(body.token);
  return body.token;
}

async function connectChrome(userDataDir) {
  const child = spawn(chromePath, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--remote-debugging-port=0", `--user-data-dir=${userDataDir}`, "about:blank"
  ], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
  const activePortPath = path.join(userDataDir, "DevToolsActivePort");
  let endpoint;
  const endpointDeadline = Date.now() + 15_000;
  while (Date.now() < endpointDeadline) {
    const activePort = await readFile(activePortPath, "utf8").catch(() => "");
    const [port, socketPath] = activePort.trim().split(/\r?\n/);
    if (/^\d+$/.test(port ?? "") && socketPath?.startsWith("/devtools/browser/")) {
      endpoint = `ws://127.0.0.1:${port}${socketPath}`;
      break;
    }
    await delay(100);
  }
  if (!endpoint) throw new Error(`Chrome DevTools endpoint timeout (launcher=${child.exitCode ?? "running"})`);
  const socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  const consoleErrors = [];
  const requestFailures = [];
  const externalRequests = [];
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const handler = pending.get(message.id);
      if (!handler) return;
      pending.delete(message.id);
      if (message.error) handler.reject(new Error(`${handler.method}: ${message.error.message}`));
      else handler.resolve(message.result);
      return;
    }
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") consoleErrors.push(message.params.args.map((arg) => arg.value ?? arg.description ?? "").join(" "));
    if (message.method === "Log.entryAdded" && message.params.entry.level === "error") consoleErrors.push(message.params.entry.text);
    if (message.method === "Network.loadingFailed" && !message.params.canceled) requestFailures.push(message.params.errorText);
    if (message.method === "Network.requestWillBeSent") {
      const url = message.params.request.url;
      if (!url.startsWith(webBase) && !url.startsWith(apiBase) && !url.startsWith("data:") && !url.startsWith("blob:") && !url.startsWith("devtools:") && !url.startsWith("https://fonts.googleapis.com/") && !url.startsWith("https://fonts.gstatic.com/")) externalRequests.push(url);
    }
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject, method });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  return { child, socket, send, consoleErrors, requestFailures, externalRequests };
}

async function evaluate(cdp, sessionId, functionDeclaration, argument) {
  const expression = argument === undefined ? `(${functionDeclaration})()` : `(${functionDeclaration})(${JSON.stringify(argument)})`;
  const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? "Runtime.evaluate failed");
  return result.result.value;
}

async function waitFor(cdp, sessionId, expression, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(cdp, sessionId, `() => Boolean(${expression})`).catch(() => false)) return;
    await delay(100);
  }
  throw new Error(`browser condition timed out: ${expression}`);
}

async function createPage(cdp, token, viewport) {
  const { browserContextId } = await cdp.send("Target.createBrowserContext");
  const { targetId } = await cdp.send("Target.createTarget", { url: `${webBase}/login/beauty-industry?apiBase=${encodeURIComponent(apiBase)}`, browserContextId });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  for (const domain of ["Page.enable", "Runtime.enable", "Log.enable", "Network.enable"]) await cdp.send(domain, {}, sessionId);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: viewport.width, height: viewport.height, deviceScaleFactor: viewport.width === 390 ? 3 : 1, mobile: viewport.width === 390 }, sessionId);
  await waitFor(cdp, sessionId, "document.readyState === 'complete'");
  await evaluate(cdp, sessionId, `(value) => localStorage.setItem("store_os_token", value)`, token);
  await cdp.send("Page.navigate", { url: `${webBase}${route}` }, sessionId);
  await waitFor(cdp, sessionId, `document.querySelector(".beautyXhsImageFailure")`);
  return { browserContextId, sessionId };
}

async function inspectPage(cdp, sessionId, expectedWidth, expectedRejected) {
  const state = await evaluate(cdp, sessionId, `() => ({
    width: innerWidth,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    warning: document.querySelector(".beautyXhsImageFailure")?.textContent ?? "",
    packageText: document.querySelector(".beautyXhsImageDelivery")?.innerText ?? "",
    cards: document.querySelectorAll("[data-testid='xhs-image-card']").length,
    rejectedCards: document.querySelectorAll("[data-testid='xhs-image-card'].rejected").length,
    customerImages: document.querySelectorAll(".beautyXhsImageCards img").length,
    downloadButtons: [...document.querySelectorAll(".beautyXhsImageCards button")].filter((button) => /下载/.test(button.textContent ?? "")).length,
    historyPresent: Boolean(document.querySelector("[data-testid='xhs-task-history']"))
  })`);
  assert.equal(state.width, expectedWidth);
  assert.equal(state.overflow, 0);
  assert.match(state.warning, /图片未达到交付标准，不建议使用/);
  assert.match(state.packageText, /图片未达到交付标准，不建议使用/);
  assert.match(state.packageText, /不会自动重试/);
  assert.match(state.packageText, /不会自动补图/);
  assert.equal(state.cards, 3);
  assert.equal(state.rejectedCards, 3, "an incomplete three-image batch must expose no individual card as customer-usable");
  assert.equal(state.customerImages, 0);
  assert.equal(state.downloadButtons, 0);
  assert.equal(state.historyPresent, true);
}

async function main() {
  const run = await prisma.agentRun.findFirstOrThrow({ where: { id: runId, productCode: "beauty-industry", capabilityId: "beauty_xiaohongshu_package", status: "succeeded" }, select: { tenantId: true, userId: true } });
  assert.ok(run.userId);
  const tokenA = createSessionToken(run.tenantId, run.userId);
  const tokenB = await createIsolatedToken();
  const allJobsBefore = await prisma.lanqiMediaJob.findMany({
    where: { tenantId: run.tenantId, previewId: runId, kind: "beauty_image" },
    orderBy: { createdAt: "desc" },
    select: { id: true, providerTaskId: true, status: true, errorMessage: true, parameters: true }
  });
  const latestBatchRequestId = batchRequestIdOf(allJobsBefore[0]);
  assert.ok(latestBatchRequestId, "the latest historical media batch must retain its batchRequestId");
  const dbJobsBefore = sortJobSnapshots(allJobsBefore.filter((job) => batchRequestIdOf(job) === latestBatchRequestId));
  const transactionCountBefore = await prisma.creditTransaction.count({ where: { tenantId: run.tenantId } });
  if (!readOnly) {
    const quote = await apiJson(`/beauty-industry/acquisition/runs/${encodeURIComponent(runId)}/media/quote`, tokenA, { method: "POST", body: JSON.stringify({ imageCount: 3 }) });
    assert.equal(quote.response.status, 200);
    assert.equal(quote.body.existing, true);
    assert.equal(quote.body.canConfirm, false);
    assert.match(quote.body.message, /不可再次调用或补图/);
  }
  const jobs = await apiJson(`/beauty-industry/acquisition/runs/${encodeURIComponent(runId)}/media/jobs`, tokenA);
  assert.equal(jobs.response.status, 200);
  assert.equal(jobs.body.batchStatus, "quality_failed");
  assert.equal(jobs.body.jobs.length, 3);
  const dbJobs = (await prisma.lanqiMediaJob.findMany({ where: { tenantId: run.tenantId, previewId: runId, kind: "beauty_image" } }))
    .filter((job) => batchRequestIdOf(job) === latestBatchRequestId);
  const providerTaskIds = dbJobs.map((job) => job.providerTaskId).filter(Boolean).sort();
  assert.equal(providerTaskIds.length, expectedProviderTasks, "the sequential quality gate must stop at the first rejected Provider asset, wherever it occurs in the batch");
  assert.equal(jobs.body.jobs.filter((job) => job.technicalStatus === "succeeded").length, expectedProviderTasks);
  const rejectedCount = jobs.body.jobs.filter((job) => job.qualityStatus === "rejected" || job.operatorQualityStatus === "rejected").length;
  assert.equal(rejectedCount, 1);
  assert.equal(jobs.body.jobs.filter((job) => job.customerUsable).length, 0);
  if (!readOnly) {
    const duplicateBody = JSON.stringify({ imageCount: 3, confirmed: true, requestKey: "beauty_by26_quality_failed_recovery" });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const duplicate = await apiJson(`/beauty-industry/acquisition/runs/${encodeURIComponent(runId)}/media/confirm`, tokenA, { method: "POST", body: duplicateBody, headers: { "X-Idempotency-Key": "beauty_by26_quality_failed_recovery" } });
      assert.equal(duplicate.response.status, 200);
      assert.equal(duplicate.body.idempotent, true);
      assert.equal(duplicate.body.batchStatus, "quality_failed");
      assert.deepEqual((await prisma.lanqiMediaJob.findMany({ where: { tenantId: run.tenantId, previewId: runId, kind: "beauty_image" }, select: { providerTaskId: true } })).map((job) => job.providerTaskId).filter(Boolean).sort(), providerTaskIds);
    }
  }
  assert.equal(await prisma.creditTransaction.count({ where: { tenantId: run.tenantId } }), transactionCountBefore, "quality-failed recovery must not create another credit transaction");
  for (const job of jobs.body.jobs) {
    for (const suffix of ["asset", "download"]) {
      const owner = await fetch(`${apiBase}/beauty-industry/media/assets/${encodeURIComponent(job.id)}${suffix === "download" ? "/download" : ""}`, { headers: { Authorization: `Bearer ${tokenA}` } });
      const isolated = await fetch(`${apiBase}/beauty-industry/media/assets/${encodeURIComponent(job.id)}${suffix === "download" ? "/download" : ""}`, { headers: { Authorization: `Bearer ${tokenB}` } });
      assert.equal(owner.status, 404, "a rejected original must not be customer-readable by its owner");
      assert.equal(isolated.status, 404, "a rejected original must not cross tenant boundaries");
    }
  }

  const userDataDir = await mkdtemp(path.join(tmpdir(), "beauty-by26-chrome-"));
  const cdp = await connectChrome(userDataDir);
  try {
    const desktop = await createPage(cdp, tokenA, { width: 1440, height: 1000 });
    await inspectPage(cdp, desktop.sessionId, 1440, rejectedCount);
    await cdp.send("Page.reload", { ignoreCache: true }, desktop.sessionId);
    await waitFor(cdp, desktop.sessionId, `document.querySelector(".beautyXhsImageFailure")`);
    await inspectPage(cdp, desktop.sessionId, 1440, rejectedCount);
    const mobile = await createPage(cdp, tokenA, { width: 390, height: 844 });
    await inspectPage(cdp, mobile.sessionId, 390, rejectedCount);
    const actionableConsoleErrors = cdp.consoleErrors.filter((item) => !/WebSocket connection to 'ws:\/\/127\.0\.0\.1:5176\/' failed: Page entered Back-Forward Cache\./.test(item));
    assert.deepEqual(actionableConsoleErrors, []);
    assert.deepEqual(cdp.requestFailures, []);
    assert.deepEqual(cdp.externalRequests, []);
  } finally {
    await cdp.send("Browser.close").catch(() => undefined);
    cdp.socket.close();
    if (cdp.child.exitCode === null) {
      const exited = new Promise((resolve) => cdp.child.once("exit", resolve));
      cdp.child.kill();
      await Promise.race([exited, delay(2_000)]);
    }
    await rm(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
  }
  const allJobsAfter = await prisma.lanqiMediaJob.findMany({
    where: { tenantId: run.tenantId, previewId: runId, kind: "beauty_image" },
    select: { id: true, providerTaskId: true, status: true, errorMessage: true, parameters: true }
  });
  assert.deepEqual(
    sortJobSnapshots(allJobsAfter.filter((job) => batchRequestIdOf(job) === latestBatchRequestId)),
    dbJobsBefore,
    "read-only quality recovery must not mutate the latest historical Provider batch"
  );
  assert.equal(await prisma.creditTransaction.count({ where: { tenantId: run.tenantId } }), transactionCountBefore, "read-only quality recovery must not change the ledger");
  process.stdout.write(`beauty_image_quality_browser_e2e=PASS;mode=${readOnly ? "read_only" : "idempotency"};desktop=PASS;mobile390=PASS;refresh=PASS;provider_tasks=${expectedProviderTasks};technical_success=${expectedProviderTasks};quality_rejected=1;customer_usable=0;downloads=0;owner_asset_404=PASS;cross_tenant_404=PASS;ledger_changes=0;console_errors=0;external_provider_requests=0\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
}).finally(async () => prisma.$disconnect());

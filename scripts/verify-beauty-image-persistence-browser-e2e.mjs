import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { prisma } from "../packages/db/dist/index.js";

const webBase = process.env.BEAUTY_E2E_WEB_URL ?? "http://127.0.0.1:5176";
const apiBase = process.env.BEAUTY_E2E_API_URL ?? "http://127.0.0.1:3016";
const chromePath = process.env.BEAUTY_E2E_CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const route = `/agents/beauty-industry/acquisition/xhs?apiBase=${encodeURIComponent(apiBase)}`;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

assert.ok(process.env.JWT_SECRET, "JWT_SECRET is required");

function createSessionToken(tenantId, userId) {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = encode({ alg: "HS256", typ: "JWT" });
  const body = encode({ tenantId, userId, iat: now, exp: now + 3600 });
  const signature = createHmac("sha256", process.env.JWT_SECRET).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}

async function apiJson(url, token) {
  const response = await fetch(`${apiBase}${url}`, { headers: { Authorization: `Bearer ${token}` } });
  return { response, body: await response.json().catch(() => ({})) };
}

async function connectChrome(userDataDir) {
  const child = spawn(chromePath, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--remote-debugging-port=0", `--user-data-dir=${userDataDir}`, "about:blank"
  ], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
  const endpoint = await new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error("Chrome DevTools endpoint timeout")), 15_000);
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      output += chunk;
      const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    child.once("exit", (code) => reject(new Error(`Chrome exited before DevTools was ready (${code})`)));
  });
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
  await waitFor(cdp, sessionId, `document.querySelector(".beautyIndustryMediaQualityFail") && document.querySelector(".beautyIndustryMediaPackage")?.innerText.includes("本地保存未完成")`);
  return { browserContextId, sessionId };
}

async function inspectPage(cdp, sessionId, expectedWidth) {
  const state = await evaluate(cdp, sessionId, `() => ({
    width: innerWidth,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    warning: document.querySelector(".beautyIndustryMediaQualityFail")?.textContent ?? "",
    packageText: document.querySelector(".beautyIndustryMediaPackage")?.innerText ?? "",
    cards: document.querySelectorAll(".beautyIndustryMediaGrid article").length,
    customerImages: document.querySelectorAll(".beautyIndustryMediaGrid img").length,
    downloadButtons: [...document.querySelectorAll(".beautyIndustryMediaGrid button")].filter((button) => /下载/.test(button.textContent ?? "")).length,
    recoverButtons: [...document.querySelectorAll(".beautyIndustryMediaPackage button")].filter((button) => /恢复图片任务状态/.test(button.textContent ?? "")).length,
    auditText: document.querySelector(".beautyIndustryMediaAudit")?.textContent ?? ""
  })`);
  assert.equal(state.width, expectedWidth);
  assert.equal(state.overflow, 0);
  assert.match(state.warning, /不会自动重试、补图或换模型/);
  assert.match(state.packageText, /图片已生成，但本地保存未完成/);
  assert.match(state.packageText, /无需重复点击/);
  assert.match(state.packageText, /本地交付链未完成/);
  assert.equal(state.cards, 3);
  assert.equal(state.customerImages, 0);
  assert.equal(state.downloadButtons, 0);
  assert.equal(state.recoverButtons, 0);
  assert.match(state.auditText, /交付链阶段 本地交付准备（不可自动重试）/);
}

async function main() {
  const failedJob = await prisma.lanqiMediaJob.findFirstOrThrow({
    where: { kind: "beauty_image", errorMessage: "asset_persistence_failed", previewId: { not: null } },
    orderBy: { updatedAt: "desc" },
    select: { id: true, tenantId: true, userId: true, previewId: true }
  });
  assert.ok(failedJob.userId && failedJob.previewId);
  const otherMembership = await prisma.membership.findFirstOrThrow({ where: { tenantId: { not: failedJob.tenantId } }, select: { tenantId: true, userId: true } });
  const tokenA = createSessionToken(failedJob.tenantId, failedJob.userId);
  const tokenB = createSessionToken(otherMembership.tenantId, otherMembership.userId);
  const dbJobsBefore = await prisma.lanqiMediaJob.findMany({ where: { tenantId: failedJob.tenantId, previewId: failedJob.previewId, kind: "beauty_image" }, select: { id: true, providerTaskId: true, status: true, errorMessage: true } });
  const transactionsBefore = await prisma.creditTransaction.count({ where: { tenantId: failedJob.tenantId } });

  const jobs = await apiJson(`/beauty-industry/acquisition/runs/${encodeURIComponent(failedJob.previewId)}/media/jobs`, tokenA);
  assert.equal(jobs.response.status, 200);
  assert.equal(jobs.body.batchStatus, "quality_failed");
  assert.equal(jobs.body.jobs.length, 3);
  const failed = jobs.body.jobs.find((job) => job.id === failedJob.id);
  assert.ok(failed);
  assert.equal(failed.customerUsable, false);
  assert.equal(failed.canRecover, false);
  assert.equal(failed.failureRetryable, false);
  assert.equal(failed.failureStage, "legacy_unknown");
  assert.equal(failed.failureCode, "asset_persistence_failed");
  assert.match(failed.errorMessage, /本地保存未完成/);
  assert.equal(jobs.body.jobs.filter((job) => job.customerUsable).length, 0);

  for (const job of jobs.body.jobs) {
    for (const suffix of ["", "/download"]) {
      const owner = await fetch(`${apiBase}/beauty-industry/media/assets/${encodeURIComponent(job.id)}${suffix}`, { headers: { Authorization: `Bearer ${tokenA}` } });
      const isolated = await fetch(`${apiBase}/beauty-industry/media/assets/${encodeURIComponent(job.id)}${suffix}`, { headers: { Authorization: `Bearer ${tokenB}` } });
      assert.equal(owner.status, 404);
      assert.equal(isolated.status, 404);
    }
  }

  const userDataDir = await mkdtemp(path.join(tmpdir(), "beauty-by27-chrome-"));
  const cdp = await connectChrome(userDataDir);
  try {
    const desktop = await createPage(cdp, tokenA, { width: 1440, height: 1000 });
    await inspectPage(cdp, desktop.sessionId, 1440);
    await cdp.send("Page.reload", { ignoreCache: true }, desktop.sessionId);
    await waitFor(cdp, desktop.sessionId, `document.querySelector(".beautyIndustryMediaPackage")?.innerText.includes("本地保存未完成")`);
    await inspectPage(cdp, desktop.sessionId, 1440);
    const mobile = await createPage(cdp, tokenA, { width: 390, height: 844 });
    await inspectPage(cdp, mobile.sessionId, 390);
    const actionableConsoleErrors = cdp.consoleErrors.filter((item) => !/WebSocket connection to 'ws:\/\/127\.0\.0\.1:5176\/' failed: Page entered Back-Forward Cache\./.test(item));
    assert.deepEqual(actionableConsoleErrors, []);
    assert.deepEqual(cdp.requestFailures, []);
    assert.deepEqual(cdp.externalRequests, []);
  } finally {
    cdp.socket.close();
    const exited = new Promise((resolve) => cdp.child.once("exit", resolve));
    cdp.child.kill();
    await Promise.race([exited, delay(2_000)]);
    await rm(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
  }

  const dbJobsAfter = await prisma.lanqiMediaJob.findMany({ where: { tenantId: failedJob.tenantId, previewId: failedJob.previewId, kind: "beauty_image" }, select: { id: true, providerTaskId: true, status: true, errorMessage: true } });
  assert.deepEqual(dbJobsAfter, dbJobsBefore, "read-only browser recovery must not change or re-query the historical Provider task");
  assert.equal(await prisma.creditTransaction.count({ where: { tenantId: failedJob.tenantId } }), transactionsBefore, "read-only recovery must not create credit transactions");
  process.stdout.write("beauty_image_persistence_browser_e2e=PASS;desktop=PASS;mobile390=PASS;refresh=PASS;legacy_stage_unknown=PASS;customer_assets=0;owner_and_cross_tenant_404=PASS;provider_requery=0;ledger_changes=0;console_errors=0;external_provider_requests=0\n");
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
}).finally(async () => prisma.$disconnect());

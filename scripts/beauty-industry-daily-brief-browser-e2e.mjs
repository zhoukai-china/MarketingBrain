import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const webBase = process.env.BEAUTY_DAILY_E2E_WEB_URL ?? "http://127.0.0.1:5177";
const apiBase = process.env.BEAUTY_DAILY_E2E_API_URL ?? "http://127.0.0.1:3022";
const chromePath = process.env.BEAUTY_E2E_CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const query = `?apiBase=${encodeURIComponent(apiBase)}`;
const createdTenants = [];

async function main() {
  assert.match(webBase, /^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/);
  assert.match(apiBase, /^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/);
  const ready = await fetch(`${apiBase}/ready`).then((response) => response.json());
  assert.equal(ready.ok, true);
  assert.equal(ready.checks.database.ok, true);
  await cleanupPreviousSyntheticTenants();
  const first = await createTenant("合成美业日报验收A");
  const second = await createTenant("合成美业日报验收B");
  const userDataDir = await mkdtemp(path.join(tmpdir(), "beauty-daily-e2e-"));
  const cdp = await connectChrome(userDataDir);
  try {
    const desktop = await createPage(cdp, first.token, { width: 1440, height: 1000, mobile: false });
    await waitFor(cdp, desktop, `document.querySelector('.beautyDailyBriefHero') !== null`);
    const before = await evaluate(cdp, desktop, `() => ({ title: document.title, body: document.body.innerText, active: document.querySelector('a[aria-current="page"]')?.textContent, buttons: [...document.querySelectorAll('button')].map((button) => button.textContent) })`);
    assert.match(before.title, /美业 AI 日报｜美业智能体/);
    assert.match(before.body, /正式自动更新待持续运行授权/);
    assert.match(before.body, /受控测试环境：结果不是实时资讯/);
    assert.match(before.active, /美业 AI 日报/);
    assert.ok(before.buttons.some((value) => value.includes("生成受控测试日报")));
    await evaluate(cdp, desktop, `() => [...document.querySelectorAll('button')].find((button) => button.textContent.includes('生成受控测试日报'))?.click()`);
    await waitFor(cdp, desktop, `document.querySelectorAll('.beautyDailyBriefSections article').length === 15`, 20_000);
    const generated = await evaluate(cdp, desktop, `() => ({ body: document.body.innerText, itemCount: document.querySelectorAll('.beautyDailyBriefSections article').length, sectionCount: document.querySelectorAll('.beautyDailyBriefSections>div').length, sourceLinks: document.querySelectorAll('.beautyDailyBriefSections footer a').length, consoleReady: true })`);
    assert.equal(generated.itemCount, 15);
    assert.equal(generated.sectionCount, 5);
    assert.equal(generated.sourceLinks, 15);
    assert.match(generated.body, /3 条趋势/);
    assert.match(generated.body, /今日可落地动作/);
    assert.match(generated.body, /思潼点评 · 美业解释/);
    assert.match(generated.body, /对门店的可能影响/);
    assert.match(generated.body, /适用条件/);
    assert.match(generated.body, /建议验证/);
    assert.doesNotMatch(generated.body, /思潼 X AI日报|餐饮|创始人IP/);

    await cdp.send("Page.reload", { ignoreCache: true }, desktop);
    await waitFor(cdp, desktop, `document.querySelectorAll('.beautyDailyBriefSections article').length === 15`);
    assert.equal(await evaluate(cdp, desktop, `() => document.querySelectorAll('.beautyDailyBriefSections article').length`), 15, "refresh did not restore cached report");

    const mobile = await createPage(cdp, first.token, { width: 390, height: 844, mobile: true });
    await waitFor(cdp, mobile, `document.querySelectorAll('.beautyDailyBriefSections article').length === 15`);
    const mobileState = await evaluate(cdp, mobile, `() => ({ width: document.documentElement.scrollWidth, viewport: window.innerWidth, menuVisible: getComputedStyle(document.querySelector('.beautyIndustryMobileMenu')).display !== 'none' })`);
    assert.equal(mobileState.viewport, 390);
    assert.ok(mobileState.width <= 390, `mobile horizontal overflow: ${mobileState.width}`);
    assert.equal(mobileState.menuVisible, true);
    await evaluate(cdp, mobile, `() => document.querySelector('.beautyIndustryMobileMenu')?.click()`);
    await waitFor(cdp, mobile, `document.querySelector('.beautyIndustrySidebar')?.dataset.open === 'true'`);
    assert.equal(await evaluate(cdp, mobile, `() => document.querySelector('a[aria-current="page"]')?.textContent.includes('美业 AI 日报')`), true);

    const shared = await createPage(cdp, second.token, { width: 1280, height: 900, mobile: false });
    await waitFor(cdp, shared, `document.querySelectorAll('.beautyDailyBriefSections article').length === 15`);
    const sharedState = await evaluate(cdp, shared, `() => ({ tenant: document.querySelector('.beautyIndustryTenantStatus strong')?.textContent, items: document.querySelectorAll('.beautyDailyBriefSections article').length, body: document.body.innerText })`);
    assert.match(sharedState.tenant, /合成美业日报验收B/);
    assert.equal(sharedState.items, 15, "authorized tenant did not reuse product-level public cache");
    assert.doesNotMatch(sharedState.body, /合成美业日报验收A/);
    assert.deepEqual(cdp.consoleErrors, []);
    console.log(JSON.stringify({ status: "PASS", desktopItems: 15, sections: 5, sourceLinks: 15, refreshed: true, mobileWidth: 390, sharedPublicCache: true, consoleErrors: 0, providerCalls: 0 }));
  } finally {
    cdp.socket.close();
    await cleanupSyntheticTenants();
    const exited = new Promise((resolve) => cdp.child.once("exit", resolve));
    cdp.child.kill();
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3_000))]);
    await rm(userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

async function createTenant(tenantName) {
  const response = await fetch(`${apiBase}/auth/dev-login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenantRole: "local_business", tenantName, industry: "生活美容", productCode: "beauty-industry" }) });
  const body = await response.json();
  assert.equal(response.status, 200, `dev-login failed: ${body.error ?? response.status}`);
  assert.ok(body.token && body.tenantId);
  createdTenants.push(body.tenantId);
  return body;
}

async function createPage(cdp, token, viewport) {
  const { browserContextId } = await cdp.send("Target.createBrowserContext");
  const { targetId } = await cdp.send("Target.createTarget", { url: `${webBase}/login/beauty-industry${query}`, browserContextId });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  for (const domain of ["Page.enable", "Runtime.enable", "Log.enable"]) await cdp.send(domain, {}, sessionId);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: viewport.width, height: viewport.height, deviceScaleFactor: viewport.mobile ? 3 : 1, mobile: viewport.mobile }, sessionId);
  await waitFor(cdp, sessionId, "document.readyState === 'complete'");
  await evaluate(cdp, sessionId, `(token) => { localStorage.setItem('store_os_token', token); localStorage.setItem('store_os_diagnosis_done', 'true'); }`, token);
  await cdp.send("Page.navigate", { url: `${webBase}/agents/beauty-industry/daily${query}` }, sessionId);
  await waitFor(cdp, sessionId, `document.querySelector('h1')?.textContent.includes('美业 AI 日报')`);
  return sessionId;
}

async function connectChrome(userDataDir) {
  const child = spawn(chromePath, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0", `--user-data-dir=${userDataDir}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
  const endpoint = await new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error("Chrome DevTools endpoint timeout")), 15_000);
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { output += chunk; const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
    child.once("exit", (code) => reject(new Error(`Chrome exited before DevTools was ready (${code})`)));
  });
  const socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  let nextId = 0;
  const pending = new Map();
  const consoleErrors = [];
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id) { const handler = pending.get(message.id); if (!handler) return; pending.delete(message.id); message.error ? handler.reject(new Error(`${handler.method}: ${message.error.message}`)) : handler.resolve(message.result); return; }
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") consoleErrors.push(message.params.args.map((arg) => arg.value ?? arg.description ?? "").join(" "));
    if (message.method === "Log.entryAdded" && message.params.entry.level === "error") consoleErrors.push(message.params.entry.text);
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => { const id = ++nextId; pending.set(id, { resolve, reject, method }); socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); });
  return { child, socket, send, consoleErrors };
}

async function evaluate(cdp, sessionId, functionDeclaration, argument) {
  const expression = argument === undefined ? `(${functionDeclaration})()` : `(${functionDeclaration})(${JSON.stringify(argument)})`;
  const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? "browser_evaluate_failed");
  return result.result.value;
}
async function waitFor(cdp, sessionId, expression, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { if (await evaluate(cdp, sessionId, `() => Boolean(${expression})`)) return; await new Promise((resolve) => setTimeout(resolve, 150)); }
  throw new Error(`browser_wait_timeout:${expression}`);
}
async function cleanupSyntheticTenants() {
  if (!createdTenants.length || process.env.BEAUTY_DAILY_BRIEF_TEST_DATABASE_ALLOWED !== "true") return;
  const { prisma } = await import("../packages/db/dist/index.js");
  const snapshots = await prisma.beautyDailyBriefSnapshot.findMany({ where: { tenantId: { in: createdTenants } }, select: { id: true, automationTaskId: true } });
  await prisma.beautyDailyBriefSnapshot.deleteMany({ where: { id: { in: snapshots.map((item) => item.id) } } });
  await prisma.automationTask.deleteMany({ where: { id: { in: snapshots.flatMap((item) => item.automationTaskId ? [item.automationTaskId] : []) } } });
  await prisma.tenant.deleteMany({ where: { id: { in: createdTenants } } });
  await prisma.$disconnect();
}

async function cleanupPreviousSyntheticTenants() {
  if (process.env.BEAUTY_DAILY_BRIEF_TEST_DATABASE_ALLOWED !== "true") throw new Error("browser cleanup requires isolated database authorization");
  const { prisma } = await import("../packages/db/dist/index.js");
  const tenants = await prisma.tenant.findMany({ where: { name: { in: ["合成美业日报验收A", "合成美业日报验收B"] } }, select: { id: true } });
  const ids = tenants.map((item) => item.id);
  if (ids.length) {
    const snapshots = await prisma.beautyDailyBriefSnapshot.findMany({ where: { tenantId: { in: ids } }, select: { id: true, automationTaskId: true } });
    await prisma.beautyDailyBriefSnapshot.deleteMany({ where: { id: { in: snapshots.map((item) => item.id) } } });
    await prisma.automationTask.deleteMany({ where: { id: { in: snapshots.flatMap((item) => item.automationTaskId ? [item.automationTaskId] : []) } } });
    await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
  }
}

void main().catch((error) => { console.error(error instanceof Error ? error.stack : "beauty_daily_browser_failed"); process.exitCode = 1; });

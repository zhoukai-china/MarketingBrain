import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webBase = process.env.BEAUTY_E2E_WEB_URL ?? "http://127.0.0.1:5176";
const apiBase = process.env.BEAUTY_E2E_API_URL ?? "http://127.0.0.1:3016";
const chromePath = process.env.BEAUTY_E2E_CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const fixture = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "fixtures/beauty-live-review-data.csv");
const route = `/agents/beauty-industry/acquisition/live/review?apiBase=${encodeURIComponent(apiBase)}`;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function assertAcceptanceApiReady() {
  let response;
  try {
    response = await fetch(`${apiBase}/ready`, { signal: AbortSignal.timeout(3_000) });
  } catch {
    throw new Error(`live_review_e2e_api_preflight_failed endpoint=${apiBase} stage=connect`);
  }
  const body = await response.json().catch(() => ({}));
  assert.equal(response.status, 200, `live_review_e2e_api_preflight_failed endpoint=${apiBase} stage=http status=${response.status}`);
  assert.equal(body.ok, true, `live_review_e2e_api_preflight_failed endpoint=${apiBase} stage=ready`);
  assert.equal(body.checks?.database?.ok, true, `live_review_e2e_api_preflight_failed endpoint=${apiBase} stage=database`);
}

async function createTenant(label) {
  const response = await fetch(`${apiBase}/auth/dev-login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenantRole: "local_business", tenantName: label, productCode: "beauty-industry" }) });
  const body = await response.json();
  assert.equal(response.status, 200, `dev-login failed: ${JSON.stringify(body)}`);
  return body.token;
}

async function connectChrome(userDataDir) {
  const child = spawn(chromePath, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0", `--user-data-dir=${userDataDir}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
  const endpoint = await new Promise((resolve, reject) => {
    let output = ""; const timer = setTimeout(() => reject(new Error("Chrome DevTools endpoint timeout")), 15_000);
    child.stderr.setEncoding("utf8"); child.stderr.on("data", (chunk) => { output += chunk; const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
    child.once("exit", (code) => reject(new Error(`Chrome exited before DevTools was ready (${code})`)));
  });
  const socket = new WebSocket(endpoint); await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  let nextId = 0; const pending = new Map(); const consoleErrors = []; const requestFailures = []; const externalRequests = [];
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id) { const handler = pending.get(message.id); if (!handler) return; pending.delete(message.id); if (message.error) handler.reject(new Error(`${handler.method}: ${message.error.message}`)); else handler.resolve(message.result); return; }
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") consoleErrors.push(message.params.args.map((arg) => arg.value ?? arg.description ?? "").join(" "));
    if (message.method === "Log.entryAdded" && message.params.entry.level === "error") consoleErrors.push(message.params.entry.text);
    if (message.method === "Network.loadingFailed" && !message.params.canceled) requestFailures.push(message.params.errorText);
    if (message.method === "Network.requestWillBeSent") { const url = message.params.request.url; if (!url.startsWith(webBase) && !url.startsWith(apiBase) && !url.startsWith("data:") && !url.startsWith("blob:") && !url.startsWith("devtools:") && !url.startsWith("https://fonts.googleapis.com/") && !url.startsWith("https://fonts.gstatic.com/")) externalRequests.push(url); }
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => { const id = ++nextId; pending.set(id, { resolve, reject, method }); socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); });
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
  while (Date.now() < deadline) { if (await evaluate(cdp, sessionId, `() => Boolean(${expression})`).catch(() => false)) return; await delay(100); }
  throw new Error(`browser condition timed out: ${expression}`);
}

async function createPage(cdp, token, viewport) {
  const { browserContextId } = await cdp.send("Target.createBrowserContext");
  const { targetId } = await cdp.send("Target.createTarget", { url: `${webBase}/login/beauty-industry?apiBase=${encodeURIComponent(apiBase)}`, browserContextId });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  for (const domain of ["Page.enable", "Runtime.enable", "Log.enable", "Network.enable", "DOM.enable"]) await cdp.send(domain, {}, sessionId);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: viewport.width, height: viewport.height, deviceScaleFactor: viewport.width === 390 ? 3 : 1, mobile: viewport.width === 390 }, sessionId);
  await waitFor(cdp, sessionId, "document.readyState === 'complete'");
  await evaluate(cdp, sessionId, `(token) => localStorage.setItem("store_os_token", token)`, token);
  await cdp.send("Page.navigate", { url: `${webBase}${route}` }, sessionId);
  await waitFor(cdp, sessionId, `document.querySelector('h1')?.textContent?.trim() === "直播复盘"`);
  return { browserContextId, sessionId };
}

const fillScript = `({ label, value, select = false }) => {
  const targetLabel = [...document.querySelectorAll("label")].find((item) => item.textContent.includes(label));
  if (!targetLabel) throw new Error("missing label: " + label);
  const input = targetLabel.querySelector(select ? "select" : "input,textarea");
  const proto = select ? HTMLSelectElement.prototype : input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true }));
}`;

async function validateViewport(cdp, token, name, viewport) {
  const page = await createPage(cdp, token, viewport); const { sessionId } = page;
  const initial = await evaluate(cdp, sessionId, `() => ({ title: document.title, url: location.href, body: document.body.innerText, disabled: [...document.querySelectorAll("button")].find((item) => item.textContent.includes("开始正式直播复盘"))?.disabled })`);
  assert.match(initial.title, /美业智能体/); assert.equal(initial.url, `${webBase}${route}`); assert.match(initial.body, /数据\/转写\/计划/); assert.match(initial.body, /CSV\/Excel 解析为零 Provider、零积分/); assert.equal(initial.disabled, true);
  await evaluate(cdp, sessionId, fillScript, { label: "直播平台", value: "抖音", select: true });
  await evaluate(cdp, sessionId, fillScript, { label: "直播间/场次名称", value: `BY16-${name}-脱敏晚场` });
  await evaluate(cdp, sessionId, fillScript, { label: "直播时间或统计周期", value: "2026-08-24 19:00-20:00" });
  await evaluate(cdp, sessionId, fillScript, { label: "本场真实业务目标", value: "核对项目讲解后的有效咨询承接" });
  const { root } = await cdp.send("DOM.getDocument", {}, sessionId); const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector: '.beautyLiveReviewUpload input[type="file"]' }, sessionId); assert.ok(nodeId);
  await cdp.send("DOM.setFileInputFiles", { nodeId, files: [fixture] }, sessionId);
  await waitFor(cdp, sessionId, `document.querySelector('.beautyLiveReviewUpload .parsed')?.textContent?.includes('beauty-live-review-data.csv')`);
  await evaluate(cdp, sessionId, fillScript, { label: "录音/录屏转写", value: "00:00 主播说明本场只介绍已确认的日常护理流程。00:30 主播邀请观众咨询服务流程。" });
  await evaluate(cdp, sessionId, fillScript, { label: "原话术/直播计划", value: "开场说明范围；中段讲服务流程；结尾承接咨询。" });
  await evaluate(cdp, sessionId, fillScript, { label: "咨询/成交口径", value: "有效咨询为主动询问流程或预约；确认预约以门店台账为准。" });
  await waitFor(cdp, sessionId, `[...document.querySelectorAll("button")].find((item) => item.textContent.includes("开始正式直播复盘"))?.disabled === false`);
  await evaluate(cdp, sessionId, `() => [...document.querySelectorAll("button")].find((item) => item.textContent.includes("开始正式直播复盘")).click()`);
  await waitFor(cdp, sessionId, `document.querySelector('.beautyLiveReviewResult')?.textContent?.includes('八、下次直播调整清单')`, 30_000);
  const completed = await evaluate(cdp, sessionId, `() => ({ body: document.querySelector('.beautyLiveReviewResult').innerText, path: location.pathname, width: innerWidth, documentWidth: document.documentElement.scrollWidth })`);
  for (const section of ["一、核心数据速览", "二、流量诊断", "三、转化归因", "四、互动诊断", "五、话术执行对照表", "六、人货场诊断", "七、方法论沉淀", "八、下次直播调整清单"]) assert.match(completed.body, new RegExp(section));
  assert.equal(completed.path, "/agents/beauty-industry/acquisition/live/review"); assert.equal(completed.width, viewport.width); assert.ok(completed.documentWidth <= completed.width, `${name}: horizontal overflow`);
  await cdp.send("Page.navigate", { url: `${webBase}/agents/beauty-industry/acquisition/live?apiBase=${encodeURIComponent(apiBase)}` }, sessionId); await waitFor(cdp, sessionId, `document.querySelector('h1')?.textContent?.includes('直播获客')`); await evaluate(cdp, sessionId, `() => history.back()`);
  await waitFor(cdp, sessionId, `location.pathname.endsWith('/live/review') && document.querySelector('h1')?.textContent?.trim() === "直播复盘"`);
  await cdp.send("Page.reload", { ignoreCache: true }, sessionId); await waitFor(cdp, sessionId, `document.querySelector('h1')?.textContent?.trim() === "直播复盘"`);
  const restored = await evaluate(cdp, sessionId, `() => ({ title: [...document.querySelectorAll("label")].find((item) => item.textContent.includes("直播间/场次名称"))?.querySelector("input")?.value, body: document.body.innerText, fileParsed: Boolean(document.querySelector('.beautyLiveReviewUpload .parsed')), disabled: [...document.querySelectorAll("button")].find((item) => item.textContent.includes("开始正式直播复盘"))?.disabled })`);
  assert.equal(restored.title, `BY16-${name}-脱敏晚场`); assert.equal(restored.fileParsed, false); assert.match(restored.body, /本地数据文件及其解析内容未保留|尚未上传数据文件/); assert.equal(restored.disabled, false, "transcript remains valid after file evidence is cleared");
  await cdp.send("Target.disposeBrowserContext", { browserContextId: page.browserContextId });
}

async function main() {
  await assertAcceptanceApiReady();
  const stamp = Date.now(); const [tokenA, tokenB] = await Promise.all([createTenant(`BY16浏览器验收A-${stamp}`), createTenant(`BY16隔离验收B-${stamp}`)]);
  const userDataDir = await mkdtemp(path.join(tmpdir(), "beauty-by16-chrome-")); const cdp = await connectChrome(userDataDir);
  try {
    await validateViewport(cdp, tokenA, "desktop", { width: 1440, height: 1000 });
    await validateViewport(cdp, tokenA, "mobile-390", { width: 390, height: 844 });
    const isolated = await createPage(cdp, tokenB, { width: 1440, height: 1000 }); const state = await evaluate(cdp, isolated.sessionId, `() => ({ value: [...document.querySelectorAll("label")].find((item) => item.textContent.includes("直播间/场次名称"))?.querySelector("input")?.value, body: document.body.innerText })`); assert.equal(state.value, ""); assert.match(state.body, /正式复盘前还需要/); await cdp.send("Target.disposeBrowserContext", { browserContextId: isolated.browserContextId });
    const actionableConsoleErrors = cdp.consoleErrors.filter((item) => !/WebSocket connection to 'ws:\/\/127\.0\.0\.1:5176\/' failed: Page entered Back-Forward Cache\./.test(item));
    assert.deepEqual(actionableConsoleErrors, []); assert.deepEqual(cdp.requestFailures, []); assert.deepEqual(cdp.externalRequests, []);
    process.stdout.write("beauty_live_review_browser_e2e:PASS api_preflight=PASS desktop=PASS mobile390=PASS deep_link=PASS data_parse=PASS evidence_gate=PASS result8=PASS refresh=PASS back=PASS tenant_isolation=PASS console_errors=0 external_provider_requests=0\n");
  } finally { cdp.socket.close(); const exited = new Promise((resolve) => cdp.child.once("exit", resolve)); cdp.child.kill(); await Promise.race([exited, delay(2_000)]); await rm(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 }); }
}

main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`); process.exitCode = 1; });

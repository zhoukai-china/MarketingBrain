import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webBase = process.env.BEAUTY_E2E_WEB_URL ?? "http://127.0.0.1:5176";
const apiBase = process.env.BEAUTY_E2E_API_URL ?? "http://127.0.0.1:3016";
const chromePath = process.env.BEAUTY_E2E_CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const fixture = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "fixtures/beauty-video-content-av.mp4");
const route = `/agents/beauty-industry/acquisition/video/content-review?apiBase=${encodeURIComponent(apiBase)}`;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function createTenant(label) {
  const response = await fetch(`${apiBase}/auth/dev-login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ tenantRole: "local_business", tenantName: label, productCode: "beauty-industry" }),
  });
  const body = await response.json();
  assert.equal(response.status, 200, `dev-login failed: ${JSON.stringify(body)}`);
  assert.ok(body.token);
  return body.token;
}

async function connectChrome(userDataDir) {
  const child = spawn(chromePath, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0", `--user-data-dir=${userDataDir}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
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
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  let nextId = 0;
  const pending = new Map();
  const consoleErrors = [];
  const requestFailures = [];
  const externalRequests = [];
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const handler = pending.get(message.id); if (!handler) return; pending.delete(message.id);
      if (message.error) handler.reject(new Error(`${handler.method}: ${message.error.message}`)); else handler.resolve(message.result);
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
    const id = ++nextId; pending.set(id, { resolve, reject, method }); socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
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
  for (const domain of ["Page.enable", "Runtime.enable", "Log.enable", "Network.enable", "DOM.enable"]) await cdp.send(domain, {}, sessionId);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: viewport.width, height: viewport.height, deviceScaleFactor: viewport.width === 390 ? 3 : 1, mobile: viewport.width === 390 }, sessionId);
  await waitFor(cdp, sessionId, "document.readyState === 'complete'");
  await evaluate(cdp, sessionId, `(token) => localStorage.setItem("store_os_token", token)`, token);
  await cdp.send("Page.navigate", { url: `${webBase}${route}` }, sessionId);
  await waitFor(cdp, sessionId, `document.querySelector('h1')?.textContent?.trim() === "视频内容复盘"`);
  return { browserContextId, targetId, sessionId };
}

const formScript = `({ label, value, select = false }) => {
  const targetLabel = [...document.querySelectorAll("label")].find((item) => item.textContent.includes(label));
  if (!targetLabel) throw new Error("missing label: " + label);
  const input = targetLabel.querySelector(select ? "select" : "input,textarea");
  const setter = Object.getOwnPropertyDescriptor(select ? HTMLSelectElement.prototype : input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value").set;
  setter.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true }));
}`;

async function validateViewport(cdp, token, viewportName, viewport) {
  const page = await createPage(cdp, token, viewport);
  const { sessionId } = page;
  const initial = await evaluate(cdp, sessionId, `() => ({ title: document.title, url: location.href, body: document.body.innerText, disabled: [...document.querySelectorAll("button")].find((item) => item.textContent.trim() === "开始正式内容复盘")?.disabled })`);
  assert.match(initial.title, /美业智能体/); assert.equal(initial.url, `${webBase}${route}`); assert.match(initial.body, /已开放 · 证据齐全后可执行/); assert.match(initial.body, /本页预检 Provider 0 次 · 费用 ¥0/); assert.equal(initial.disabled, true);
  await evaluate(cdp, sessionId, formScript, { label: "发布平台", value: "抖音", select: true });
  await evaluate(cdp, sessionId, formScript, { label: "视频标题或内部识别名", value: `BY-15-${viewportName}-合成验收` });
  await evaluate(cdp, sessionId, formScript, { label: "本轮业务目标", value: "验证固定视频内容复盘合同，不承诺经营指标" });
  await evaluate(cdp, sessionId, formScript, { label: "目标人群", value: "内部合成测试人员" });
  await delay(250);
  const { root } = await cdp.send("DOM.getDocument", {}, sessionId);
  const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector: 'input[type="file"]' }, sessionId);
  assert.ok(nodeId, "file input missing");
  await cdp.send("DOM.setFileInputFiles", { nodeId, files: [fixture] }, sessionId);
  await waitFor(cdp, sessionId, `document.querySelector('.beautyVideoContentReceipt')?.textContent?.includes('beauty-video-content-av.mp4')`);
  const receipt = await evaluate(cdp, sessionId, `() => document.querySelector('.beautyVideoContentReceipt').innerText`);
  assert.match(receipt, /8\.000 秒/); assert.match(receipt, /360×640/); assert.match(receipt, /视频 h264/); assert.match(receipt, /音频 aac \/ 22050 Hz \/ 1 声道/); assert.match(receipt, /Provider 调用 0，积分 0，文件未保留/);
  await evaluate(cdp, sessionId, `() => [...document.querySelectorAll("button")].find((item) => item.textContent.includes("补充转写、画面与时间轴")).click()`);
  await evaluate(cdp, sessionId, formScript, { label: "用户确认的口播/字幕转写", value: "这是美业视频内容复盘测试样本，不包含真实客户信息" });
  await evaluate(cdp, sessionId, formScript, { label: "用户确认的画面证据", value: "竖屏浅绿色背景，上方深绿色矩形，下方金色矩形；无人物、无可见文字" });
  await waitFor(cdp, sessionId, `[...document.querySelectorAll("button")].find((item) => item.textContent.trim() === "开始正式内容复盘")?.disabled === false`);
  const ready = await evaluate(cdp, sessionId, `() => document.body.innerText.includes("资料已齐，可进入固定 Skill 复盘")`); assert.equal(ready, true);
  await evaluate(cdp, sessionId, `() => [...document.querySelectorAll("button")].find((item) => item.textContent.includes("进入视频数据复盘")).click()`);
  await waitFor(cdp, sessionId, `location.pathname.endsWith('/video/data-review')`);
  await evaluate(cdp, sessionId, `() => history.back()`);
  await waitFor(cdp, sessionId, `location.pathname.endsWith('/video/content-review') && document.querySelector('h1')?.textContent?.trim() === "视频内容复盘"`);
  const backState = await evaluate(cdp, sessionId, `() => ({ title: [...document.querySelectorAll("label")].find((item) => item.textContent.includes("视频标题或内部识别名"))?.querySelector("input")?.value, receipt: Boolean(document.querySelector('.beautyVideoContentReceipt')) })`);
  assert.equal(backState.title, `BY-15-${viewportName}-合成验收`); assert.equal(backState.receipt, true, "browser back should preserve the in-memory preflight receipt");
  await cdp.send("Page.reload", { ignoreCache: true }, sessionId);
  await waitFor(cdp, sessionId, `document.querySelector('h1')?.textContent?.trim() === "视频内容复盘" && document.body.innerText.includes("尚未完成视频预检")`);
  const restored = await evaluate(cdp, sessionId, `() => ({ title: [...document.querySelectorAll("label")].find((item) => item.textContent.includes("视频标题或内部识别名"))?.querySelector("input")?.value, body: document.body.innerText, disabled: [...document.querySelectorAll("button")].find((item) => item.textContent.trim() === "开始正式内容复盘")?.disabled, width: innerWidth, documentWidth: document.documentElement.scrollWidth })`);
  assert.equal(restored.title, `BY-15-${viewportName}-合成验收`); assert.match(restored.body, /尚未完成视频预检/); assert.equal(restored.disabled, true); assert.equal(restored.width, viewport.width); assert.ok(restored.documentWidth <= restored.width, `${viewportName}: horizontal overflow`);
  await cdp.send("Target.disposeBrowserContext", { browserContextId: page.browserContextId });
}

async function main() {
  const stamp = Date.now();
  const [tokenA, tokenB] = await Promise.all([createTenant(`BY15浏览器验收A-${stamp}`), createTenant(`BY15隔离验收B-${stamp}`)]);
  const userDataDir = await mkdtemp(path.join(tmpdir(), "beauty-by15-chrome-"));
  const cdp = await connectChrome(userDataDir);
  try {
    await validateViewport(cdp, tokenA, "desktop", { width: 1440, height: 1000 });
    await validateViewport(cdp, tokenA, "mobile-390", { width: 390, height: 844 });
    const isolated = await createPage(cdp, tokenB, { width: 1440, height: 1000 });
    const state = await evaluate(cdp, isolated.sessionId, `() => ({ value: [...document.querySelectorAll("label")].find((item) => item.textContent.includes("视频标题或内部识别名"))?.querySelector("input")?.value, body: document.body.innerText })`);
    assert.equal(state.value, ""); assert.match(state.body, /尚未完成视频预检/);
    await cdp.send("Target.disposeBrowserContext", { browserContextId: isolated.browserContextId });
    assert.deepEqual(cdp.consoleErrors, []); assert.deepEqual(cdp.requestFailures, []); assert.deepEqual(cdp.externalRequests, []);
    process.stdout.write("beauty_video_content_review_browser_e2e:PASS desktop=PASS mobile390=PASS deep_link=PASS preflight=PASS evidence_gate=PASS refresh=PASS back=PASS tenant_isolation=PASS console_errors=0 external_provider_requests=0\n");
  } finally {
    cdp.socket.close(); const exited = new Promise((resolve) => cdp.child.once("exit", resolve)); cdp.child.kill(); await Promise.race([exited, delay(2_000)]); await rm(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
  }
}

main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`); process.exitCode = 1; });

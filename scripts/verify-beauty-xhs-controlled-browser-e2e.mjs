import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const webBase = process.env.BEAUTY_E2E_WEB_URL ?? "http://127.0.0.1:5176";
const apiBase = process.env.BEAUTY_E2E_API_URL ?? "http://127.0.0.1:3016";
const chromePath = process.env.BEAUTY_E2E_CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const route = `/agents/beauty-industry/acquisition/xhs?apiBase=${encodeURIComponent(apiBase)}`;
const userInput = "生成面向附近女性顾客的皮肤管理产品小红书图文";
const internalPollution = /受控流程|任务事实回执|待补|待核验|供应商|Schema|Eval|mock|流程预览|合同/;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function createTenant(label) {
  const response = await fetch(`${apiBase}/auth/dev-login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tenantRole: "local_business", tenantName: label, productCode: "beauty-industry" })
  });
  const body = await response.json();
  assert.equal(response.status, 200, `dev-login failed: ${JSON.stringify(body)}`);
  assert.ok(body.token, "dev-login did not return a scoped token");
  return body.token;
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
  const runRequests = [];
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
      const { url, method } = message.params.request;
      if (method === "POST" && url === `${apiBase}/beauty-industry/acquisition/runs`) runRequests.push(url);
      if (!url.startsWith(webBase) && !url.startsWith(apiBase) && !url.startsWith("data:") && !url.startsWith("blob:") && !url.startsWith("devtools:") && !url.startsWith("https://fonts.googleapis.com/") && !url.startsWith("https://fonts.gstatic.com/")) externalRequests.push(url);
    }
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject, method });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  return { child, socket, send, consoleErrors, requestFailures, externalRequests, runRequests };
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
  await waitFor(cdp, sessionId, `document.querySelector('h1')?.textContent?.trim() === "图文获客"`);
  return { browserContextId, sessionId };
}

async function main() {
  const stamp = Date.now();
  const [tokenA, tokenB, tokenC] = await Promise.all([
    createTenant(`BY17浏览器验收A-${stamp}`),
    createTenant(`BY17隔离验收B-${stamp}`),
    createTenant(`BY35叠字失败验收C-${stamp}`)
  ]);
  const userDataDir = await mkdtemp(path.join(tmpdir(), "beauty-by17-chrome-"));
  const cdp = await connectChrome(userDataDir);
  try {
    const desktop = await createPage(cdp, tokenA, { width: 1440, height: 1000 });
    const initial = await evaluate(cdp, desktop.sessionId, `() => ({ title: document.title, body: document.querySelector("[data-testid='beauty-xhs-workbench']")?.innerText ?? "", width: innerWidth, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth })`);
    assert.match(initial.title, /美业智能体/);
    assert.match(initial.body, /当前仅提供流程预览/);
    assert.doesNotMatch(initial.body, /controlled mock|模型参数|Provider|Skill/);
    assert.equal(initial.width, 1440);
    assert.equal(initial.overflow, 0);

    await evaluate(cdp, desktop.sessionId, `(value) => {
      const textarea = document.querySelector(".beautyXhsBriefPanel textarea");
      if (!textarea) throw new Error("XHS textarea missing");
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(textarea, value);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      textarea.dispatchEvent(new Event("change", { bubbles: true }));
    }`, userInput);
    await evaluate(cdp, desktop.sessionId, `() => {
      const inputs = [...document.querySelectorAll(".beautyXhsOptionalFacts input")];
      const setValue = (input, value) => {
        if (!input) throw new Error("XHS structured task field missing");
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      };
      setValue(inputs[0], "附近女性顾客");
      setValue(inputs[1], "皮肤管理产品");
    }`);
    await waitFor(cdp, desktop.sessionId, `[...document.querySelectorAll(".beautyXhsOptionalFacts input")].slice(0, 2).map((input) => input.value).join("|") === "附近女性顾客|皮肤管理产品"`);
    await delay(200);
    await waitFor(cdp, desktop.sessionId, `document.querySelector(".beautyXhsGenerateActions .beautyIndustryPrimary")?.disabled === false`);
    await evaluate(cdp, desktop.sessionId, `() => {
      const button = document.querySelector(".beautyXhsGenerateActions .beautyIndustryPrimary");
      button.click();
      button.click();
    }`);
    await waitFor(cdp, desktop.sessionId, `document.querySelector(".beautyXhsTitlePicker")`, 30_000);
    await waitFor(cdp, desktop.sessionId, `document.querySelector(".beautyXhsImageDelivery")`);
    await waitFor(cdp, desktop.sessionId, `document.querySelector(".beautyXhsLinkedTitle")`);
    const completed = await evaluate(cdp, desktop.sessionId, `() => ({ customer: [".beautyXhsTitlePicker", ".beautyXhsCopySection", ".beautyXhsTopicSection"].map((selector) => document.querySelector(selector)?.innerText ?? "").join("\\n"), titleCount: document.querySelectorAll('[data-testid="xhs-title-option"]').length, tagCount: document.querySelectorAll(".beautyXhsTopicSection>div:last-child span").length, imagePlan: document.querySelector(".beautyXhsImageDelivery")?.innerText, rawProductionVisible: Boolean(document.querySelector(".beautyXhsProductionNotes")), auditOpen: Boolean(document.querySelector(".beautyXhsAuditReceipt")?.open), preview: document.querySelector(".beautyXhsPreviewBoundary")?.innerText, notice: document.querySelector(".beautyIndustryNotice")?.textContent, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth })`);
    assert.equal(completed.titleCount, 3);
    assert.ok(completed.tagCount >= 5 && completed.tagCount <= 8, `expected 5-8 tags, got ${completed.tagCount}`);
    assert.match(completed.customer, /皮肤管理产品/);
    assert.match(completed.customer, /附近女性顾客/);
    assert.match(completed.customer, /互动承接/);
    assert.doesNotMatch(completed.customer, internalPollution);
    assert.match(completed.imagePlan, /配图将围绕已选择标题/);
    assert.match(completed.imagePlan, /与本次图文一起恢复/);
    assert.match(completed.imagePlan, /封面图/);
    assert.doesNotMatch(completed.imagePlan, /正向视觉提示词|负向视觉提示词|wan2\.7-image|aliyun_bailian/);
    assert.equal(completed.rawProductionVisible, false);
    assert.equal(completed.auditOpen, false);
    assert.match(completed.preview, /流程预览/);
    assert.match(completed.notice, /结果已保存；刷新后可恢复/);
    assert.equal(completed.overflow, 0);
    assert.equal(cdp.runRequests.length, 1, "double click must create only one XHS run request");

    await cdp.send("Page.reload", { ignoreCache: true }, desktop.sessionId);
    await waitFor(cdp, desktop.sessionId, `document.querySelector(".beautyXhsTitlePicker")`);
    const restored = await evaluate(cdp, desktop.sessionId, `() => [".beautyXhsTitlePicker", ".beautyXhsCopySection", ".beautyXhsTopicSection"].map((selector) => document.querySelector(selector)?.innerText ?? "").join("\\n")`);
    assert.match(restored, /皮肤管理产品/);
    assert.doesNotMatch(restored, internalPollution);

    const mobile = await createPage(cdp, tokenA, { width: 390, height: 844 });
    await waitFor(cdp, mobile.sessionId, `document.querySelector(".beautyXhsTitlePicker")`);
    await waitFor(cdp, mobile.sessionId, `document.querySelector(".beautyXhsImageDelivery")`);
    await waitFor(cdp, mobile.sessionId, `document.querySelector(".beautyXhsLinkedTitle")`);
    const mobileState = await evaluate(cdp, mobile.sessionId, `() => ({ width: innerWidth, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, banner: document.querySelector(".beautyXhsEnvironmentNotice")?.textContent, result: [".beautyXhsTitlePicker", ".beautyXhsCopySection", ".beautyXhsTopicSection"].map((selector) => document.querySelector(selector)?.innerText ?? "").join("\\n"), imagePlan: document.querySelector(".beautyXhsImageDelivery")?.innerText, auditOpen: Boolean(document.querySelector(".beautyXhsAuditReceipt")?.open) })`);
    assert.equal(mobileState.width, 390);
    assert.equal(mobileState.overflow, 0);
    assert.match(mobileState.banner, /流程预览/);
    assert.match(mobileState.result, /皮肤管理产品/);
    assert.doesNotMatch(mobileState.result, internalPollution);
    assert.match(mobileState.imagePlan, /配图将围绕已选择标题/);
    assert.match(mobileState.imagePlan, /与本次图文一起恢复/);
    assert.doesNotMatch(mobileState.imagePlan, /正向视觉提示词|负向视觉提示词|wan2\.7-image|aliyun_bailian/);
    assert.equal(mobileState.auditOpen, false);

    const isolated = await createPage(cdp, tokenB, { width: 1440, height: 1000 });
    const isolatedState = await evaluate(cdp, isolated.sessionId, `() => document.querySelector(".beautyXhsResultPanel")?.innerText`);
    assert.doesNotMatch(isolatedState, /皮肤管理产品/);
    assert.match(isolatedState, /等待生成/);

    const unreadable = await createPage(cdp, tokenC, { width: 390, height: 844 });
    await evaluate(cdp, unreadable.sessionId, `(value) => {
      const textarea = document.querySelector(".beautyXhsBriefPanel textarea");
      if (!textarea) throw new Error("XHS textarea missing");
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(textarea, value);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      textarea.dispatchEvent(new Event("change", { bubbles: true }));
    }`, userInput);
    await waitFor(cdp, unreadable.sessionId, `document.querySelector(".beautyXhsGenerateActions .beautyIndustryPrimary")?.disabled === false`);
    await evaluate(cdp, unreadable.sessionId, `() => document.querySelector(".beautyXhsGenerateActions .beautyIndustryPrimary").click()`);
    await waitFor(cdp, unreadable.sessionId, `document.querySelector(".beautyIndustryError")`, 30_000);
    const unreadableState = await evaluate(cdp, unreadable.sessionId, `() => ({ error: document.querySelector(".beautyIndustryError")?.textContent ?? "", overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, imageTasks: document.querySelectorAll(".beautyXhsImageCards article img").length })`);
    assert.match(unreadableState.error, /重复片段/);
    assert.match(unreadableState.error, /选择其他标题/);
    assert.equal(unreadableState.overflow, 0);
    assert.equal(unreadableState.imageTasks, 0, "unreadable overlay must not create image assets");

    const actionableConsoleErrors = cdp.consoleErrors.filter((item) =>
      !/WebSocket connection to 'ws:\/\/127\.0\.0\.1:5176\/' failed: Page entered Back-Forward Cache\./.test(item)
      && !/Failed to load resource: the server responded with a status of 422 \(Unprocessable Entity\)/.test(item)
    );
    assert.equal(cdp.consoleErrors.filter((item) => /status of 422/.test(item)).length, 1, "the handled unreadable-overlay request must be the only expected 422 resource entry");
    assert.deepEqual(actionableConsoleErrors, []);
    assert.deepEqual(cdp.requestFailures, []);
    assert.deepEqual(cdp.externalRequests, []);
    process.stdout.write("beauty_xhs_controlled_browser_e2e:PASS desktop=PASS mobile390=PASS double_click_run_requests=1 save=PASS refresh=PASS tenant_isolation=PASS unreadable_overlay_422=PASS image_assets_before_preflight=0 console_errors=0 external_provider_requests=0\n");
  } finally {
    cdp.socket.close();
    const exited = new Promise((resolve) => cdp.child.once("exit", resolve));
    cdp.child.kill();
    await Promise.race([exited, delay(2_000)]);
    await rm(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});

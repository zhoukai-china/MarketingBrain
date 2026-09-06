import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const webBase = process.env.BEAUTY_E2E_WEB_URL ?? "http://127.0.0.1:5176";
const apiBase = process.env.BEAUTY_E2E_API_URL ?? "http://127.0.0.1:3016";
const chromePath = process.env.BEAUTY_E2E_CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const xhsPath = "/agents/beauty-industry/acquisition/xhs";
const query = `?apiBase=${encodeURIComponent(apiBase)}`;
const xhsUrl = `${webBase}${xhsPath}${query}`;
const loginUrl = `${webBase}/login/beauty-industry${query}`;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function connectChrome(userDataDir) {
  const child = spawn(chromePath, [
    "--headless=new", "--disable-gpu", "--disable-features=BackForwardCache", "--no-first-run",
    "--no-default-browser-check", "--remote-debugging-port=0", `--user-data-dir=${userDataDir}`, "about:blank"
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
  const responses = [];
  const requests = [];
  const networkFailures = [];
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
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
      consoleErrors.push({ text: message.params.args.map((arg) => arg.value ?? arg.description ?? "").join(" "), time: Date.now() });
    }
    if (message.method === "Log.entryAdded" && message.params.entry.level === "error") consoleErrors.push({ text: message.params.entry.text, time: Date.now() });
    if (message.method === "Network.responseReceived") {
      const response = message.params.response;
      responses.push({ url: response.url, status: response.status, time: Date.now() });
    }
    if (message.method === "Network.requestWillBeSent") requests.push({ url: message.params.request.url, method: message.params.request.method });
    if (message.method === "Network.loadingFailed") networkFailures.push({ errorText: message.params.errorText, time: Date.now() });
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject, method });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  return { child, socket, send, consoleErrors, responses, requests, networkFailures };
}

async function evaluate(cdp, sessionId, functionDeclaration, argument) {
  const expression = argument === undefined ? `(${functionDeclaration})()` : `(${functionDeclaration})(${JSON.stringify(argument)})`;
  const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? "Runtime.evaluate failed");
  return result.result.value;
}

async function waitFor(cdp, sessionId, expression, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(cdp, sessionId, `() => Boolean(${expression})`).catch(() => false)) return;
    await delay(100);
  }
  const state = await evaluate(cdp, sessionId, `() => ({ url: location.href, title: document.title, body: document.body?.innerText?.slice(0, 1200) })`).catch(() => ({}));
  throw new Error(`browser condition timed out: ${expression}; state=${JSON.stringify(state)}`);
}

async function openPage(cdp, viewport) {
  const { browserContextId } = await cdp.send("Target.createBrowserContext");
  const { targetId } = await cdp.send("Target.createTarget", { url: loginUrl, browserContextId });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  for (const domain of ["Page.enable", "Runtime.enable", "Log.enable", "Network.enable"]) await cdp.send(domain, {}, sessionId);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: viewport.width, height: viewport.height, deviceScaleFactor: viewport.mobile ? 3 : 1, mobile: Boolean(viewport.mobile) }, sessionId);
  await waitFor(cdp, sessionId, "document.readyState === 'complete'");
  return { browserContextId, sessionId };
}

async function clickLocalAccess(cdp, sessionId) {
  const clicked = await evaluate(cdp, sessionId, `() => {
    const button = [...document.querySelectorAll('button')].find((node) => node.textContent?.includes('本机直接开通'));
    if (!button || button.disabled) return false;
    button.click();
    return true;
  }`);
  assert.equal(clicked, true, "local development access button must be enabled");
}

async function assertWorkbench(cdp, page, viewport, scenario) {
  await waitFor(cdp, page.sessionId, "document.querySelector('[data-testid=beauty-xhs-workbench]')", 20_000);
  const preflightState = await evaluate(cdp, page.sessionId, `() => ({
    notice: [...document.querySelectorAll('[role=alert]')].find((node) => node.textContent?.includes('还不能生成文案'))?.textContent,
    disabled: [...document.querySelectorAll('button')].find((node) => node.textContent?.includes('生成标题、正文和话题'))?.disabled,
    invalidCount: document.querySelectorAll('[aria-invalid=true]').length
  })`);
  assert.match(preflightState.notice ?? "", /本次项目/);
  assert.match(preflightState.notice ?? "", /目标顾客/);
  assert.match(preflightState.notice ?? "", /本次主题与目的/);
  assert.equal(preflightState.disabled, true, `${scenario}: missing required fields must disable generation before provider/credits`);
  assert.equal(preflightState.invalidCount, 3, `${scenario}: theme, project and audience must be identified precisely`);
  const inputAccepted = await evaluate(cdp, page.sessionId, `() => {
    const root = document.querySelector('[data-testid=beauty-xhs-workbench]');
    const theme = root?.querySelector('textarea');
    const findInput = (text) => [...(document.querySelector('[data-testid=beauty-xhs-workbench]')?.querySelectorAll('label') ?? [])]
      .find((node) => node.textContent?.includes(text))?.querySelector('input');
    if (!theme || !findInput('目标顾客（必填）') || !findInput('本次项目（必填）')) return false;
    const textareaSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    const inputSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    const audience = findInput('目标顾客（必填）');
    inputSetter?.call(audience, '附近成年女性顾客');
    audience?.dispatchEvent(new Event('input', { bubbles: true }));
    const project = findInput('本次项目（必填）');
    inputSetter?.call(project, '皮肤管理服务');
    project?.dispatchEvent(new Event('input', { bubbles: true }));
    const currentTheme = document.querySelector('[data-testid=beauty-xhs-workbench] textarea');
    textareaSetter?.call(currentTheme, '本机入口恢复测试需求，不调用模型');
    currentTheme?.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }`);
  assert.equal(inputAccepted, true, `${scenario}: XHS task input must be interactive`);
  await waitFor(cdp, page.sessionId, "[...document.querySelectorAll('button')].some((node) => node.textContent?.includes('生成标题、正文和话题') && !node.disabled)");
  const state = await evaluate(cdp, page.sessionId, `() => ({
    url: location.href,
    title: document.title,
    h1: document.querySelector('h1')?.textContent?.trim(),
    workbench: Boolean(document.querySelector('[data-testid=beauty-xhs-workbench]')),
    generateDisabled: [...document.querySelectorAll('button')].find((node) => node.textContent?.includes('生成标题、正文和话题'))?.disabled,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    token: localStorage.getItem('store_os_token')
  })`);
  assert.equal(new URL(state.url).pathname, xhsPath, `${scenario}: login must return to the exact XHS deep link`);
  assert.equal(new URL(state.url).searchParams.get("apiBase"), apiBase, `${scenario}: apiBase must survive auth recovery`);
  assert.equal(state.workbench, true);
  assert.equal(state.h1, "图文获客");
  assert.equal(state.generateDisabled, false, `${scenario}: main user action must be available after auth recovery`);
  assert.equal(state.overflow, 0, `${scenario}: ${viewport.width}px must not overflow horizontally`);
  assert.ok(state.token && state.token !== "expired.acceptance.token", `${scenario}: stale token must be replaced`);
  await cdp.send("Page.reload", { ignoreCache: true }, page.sessionId);
  await waitFor(cdp, page.sessionId, "document.querySelector('[data-testid=beauty-xhs-workbench]')", 20_000);
  const openedTasks = await evaluate(cdp, page.sessionId, `() => {
    const link = [...document.querySelectorAll('a')].find((node) => node.textContent?.includes('任务中心'));
    if (!link) return false;
    link.click();
    return true;
  }`);
  assert.equal(openedTasks, true, `${scenario}: task-center navigation must be available`);
  await waitFor(cdp, page.sessionId, "location.pathname.endsWith('/agents/beauty-industry/tasks')");
  await evaluate(cdp, page.sessionId, `() => history.back()`);
  await waitFor(cdp, page.sessionId, "location.pathname.endsWith('/agents/beauty-industry/acquisition/xhs') && document.querySelector('[data-testid=beauty-xhs-workbench]')", 20_000);
  return state;
}

async function runScenario(cdp, scenario, viewport, staleToken) {
  const consoleStart = cdp.consoleErrors.length;
  const failureStart = cdp.networkFailures.length;
  const page = await openPage(cdp, viewport);
  if (staleToken) {
    await evaluate(cdp, page.sessionId, `(token) => localStorage.setItem('store_os_token', token)`, "expired.acceptance.token");
  } else {
    await evaluate(cdp, page.sessionId, `() => localStorage.removeItem('store_os_token')`);
  }
  await cdp.send("Page.navigate", { url: xhsUrl }, page.sessionId);
  await waitFor(cdp, page.sessionId, "location.pathname.includes('/login/beauty-industry')", 20_000);
  await waitFor(cdp, page.sessionId, "[...document.querySelectorAll('button')].some((node) => node.textContent?.includes('本机直接开通'))", 20_000);
  const loginStartedAt = Date.now();
  await clickLocalAccess(cdp, page.sessionId);
  const state = await assertWorkbench(cdp, page, viewport, scenario);
  const badAfterLogin = cdp.responses.filter((item) => item.time >= loginStartedAt && item.status >= 400);
  assert.deepEqual(badAfterLogin, [], `${scenario}: login and authenticated bootstrap must not return 4xx/5xx: ${JSON.stringify(badAfterLogin)}`);
  const consoleDuringScenario = cdp.consoleErrors.slice(consoleStart);
  const consoleAfterLogin = consoleDuringScenario.filter((item) => item.time >= loginStartedAt);
  assert.deepEqual(consoleAfterLogin, [], `${scenario}: authenticated workbench must not emit console errors: ${JSON.stringify(consoleAfterLogin)}`);
  const networkDuringScenario = cdp.networkFailures.slice(failureStart);
  const networkAfterLogin = networkDuringScenario.filter((item) => item.time >= loginStartedAt);
  assert.deepEqual(networkAfterLogin, [], `${scenario}: authenticated workbench must not have network failures: ${JSON.stringify(networkAfterLogin)}`);
  assert.ok(networkDuringScenario.filter((item) => item.time < loginStartedAt).every((item) => item.errorText === "net::ERR_ABORTED"), `${scenario}: only navigation aborts are allowed before login`);
  const expectedAuthErrors = consoleDuringScenario.filter((item) => item.time < loginStartedAt);
  if (staleToken) {
    assert.ok(expectedAuthErrors.length >= 1 && expectedAuthErrors.length <= 2, `${scenario}: stale auth should fail once before recovery: ${JSON.stringify(expectedAuthErrors)}`);
    assert.ok(expectedAuthErrors.every((item) => /401 \(Unauthorized\)/.test(item.text)), `${scenario}: only the expected stale-auth 401 is allowed before login`);
  } else {
    assert.deepEqual(expectedAuthErrors, [], `${scenario}: a first-time unauthenticated path must redirect before API errors`);
  }
  return { ...page, token: state.token };
}

async function main() {
  const ready = await fetch(`${apiBase}/ready`).then((response) => response.json());
  assert.equal(ready.ok, true);
  assert.equal(ready.checks?.database?.ok, true);
  const userDataDir = await mkdtemp(path.join(tmpdir(), "beauty-entry-auth-"));
  const cdp = await connectChrome(userDataDir);
  try {
    const desktop = await runScenario(cdp, "expired desktop session", { width: 1440, height: 1000, mobile: false }, true);
    const mobile = await runScenario(cdp, "first mobile session", { width: 390, height: 844, mobile: true }, false);
    assert.notEqual(desktop.token, mobile.token, "separate browser contexts must receive separate tenant sessions");
    const tenantResponses = await Promise.all([desktop.token, mobile.token].map((token) => fetch(`${apiBase}/tenant/current`, { headers: { authorization: `Bearer ${token}` } }).then(async (response) => ({ status: response.status, body: await response.json() }))));
    assert.deepEqual(tenantResponses.map((item) => item.status), [200, 200]);
    assert.notEqual(tenantResponses[0].body.tenant?.id ?? tenantResponses[0].body.tenantId, tenantResponses[1].body.tenant?.id ?? tenantResponses[1].body.tenantId, "local entry sessions must remain tenant-isolated");
    const postRequests = cdp.requests.filter((item) => item.method === "POST");
    assert.ok(postRequests.length === 2 && postRequests.every((item) => new URL(item.url).pathname === "/auth/dev-login"), `browser journey must not submit business tasks or call providers: ${JSON.stringify(postRequests)}`);
    assert.ok(cdp.requests.every((item) => ["127.0.0.1", "localhost"].includes(new URL(item.url).hostname)), "browser journey must not access external hosts");
    await cdp.send("Target.disposeBrowserContext", { browserContextId: desktop.browserContextId });
    await cdp.send("Target.disposeBrowserContext", { browserContextId: mobile.browserContextId });
    console.log("美业本机入口鉴权恢复浏览器回归通过：失效会话与无会话均返回原XHS深链，1440/390、刷新/返回、双租户、主操作、console和网络门禁均PASS；业务提交0、Provider0。");
  } finally {
    cdp.socket.close();
    cdp.child.kill();
    await Promise.race([
      new Promise((resolve) => cdp.child.once("exit", resolve)),
      delay(5_000)
    ]);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await rm(userDataDir, { recursive: true, force: true });
        break;
      } catch (error) {
        if (attempt === 4) throw error;
        await delay(250 * (attempt + 1));
      }
    }
  }
}

await main();

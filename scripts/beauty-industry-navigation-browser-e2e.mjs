import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const webBase = process.env.BEAUTY_E2E_WEB_URL ?? "http://127.0.0.1:5176";
const apiBase = process.env.BEAUTY_E2E_API_URL ?? "http://127.0.0.1:3016";
const chromePath = process.env.BEAUTY_E2E_CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const query = `?apiBase=${encodeURIComponent(apiBase)}`;
const verifyRealXhs = process.env.BEAUTY_E2E_VERIFY_REAL_XHS === "true";
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
    "--headless=new",
    "--disable-gpu",
    "--disable-features=BackForwardCache",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-debugging-port=0",
    `--user-data-dir=${userDataDir}`,
    "about:blank"
  ], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
  const endpoint = await new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error("Chrome DevTools endpoint timeout")), 15_000);
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      output += chunk;
      const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
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
      consoleErrors.push(message.params.args.map((arg) => arg.value ?? arg.description ?? "").join(" "));
    }
    if (message.method === "Log.entryAdded" && message.params.entry.level === "error") {
      consoleErrors.push(message.params.entry.text);
    }
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject, method });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  return { child, socket, send, consoleErrors };
}

async function createPage(cdp, token, tenantName, viewport) {
  const { browserContextId } = await cdp.send("Target.createBrowserContext");
  const { targetId } = await cdp.send("Target.createTarget", { url: `${webBase}/login/beauty-industry${query}`, browserContextId });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  for (const domain of ["Page.enable", "Runtime.enable", "Log.enable"]) await cdp.send(domain, {}, sessionId);
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: viewport.deviceScaleFactor ?? 1,
    mobile: viewport.mobile ?? false
  }, sessionId);
  await waitFor(cdp, sessionId, "document.readyState === 'complete'");
  await evaluate(cdp, sessionId, `(token) => { localStorage.setItem("store_os_token", token); localStorage.setItem("store_os_diagnosis_done", "false"); }`, token);
  await cdp.send("Page.navigate", { url: `${webBase}/agents/beauty-industry${query}` }, sessionId);
  await waitFor(cdp, sessionId, "document.querySelector('h1') && document.title.includes('美业智能体')");
  await waitFor(cdp, sessionId, `document.querySelector('.beautyIndustryTenantStatus strong')?.textContent?.trim() === ${JSON.stringify(tenantName)}`);
  const identity = await evaluate(cdp, sessionId, `() => ({
    tenant: document.querySelector('.beautyIndustryTenantStatus strong')?.textContent?.trim(),
    tenantLabel: document.querySelector('.beautyIndustryTenantStatus small')?.textContent?.trim(),
    product: document.querySelector('.beautyIndustryTopProduct strong')?.textContent?.trim(),
    subtitle: document.querySelector('.beautyIndustryTopProduct small')?.textContent?.trim(),
    width: innerWidth,
    height: innerHeight,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    menuDisplay: getComputedStyle(document.querySelector('.beautyIndustryMobileMenu')).display,
    title: document.title
  })`);
  assert.equal(identity.tenant, tenantName, "current tenant label must come from the scoped tenant");
  assert.match(identity.tenantLabel, /^当前租户 · /, "tenant and city must be separate from product branding");
  assert.equal(identity.product, "美业智能体");
  assert.equal(identity.subtitle, "门店 AI 经营大脑");
  assert.equal(identity.overflow, 0, `${viewport.width}px page has horizontal overflow`);
  return { browserContextId, sessionId, targetId, identity };
}

async function createDirectEntryPage(cdp, viewport) {
  const { browserContextId } = await cdp.send("Target.createBrowserContext");
  const { targetId } = await cdp.send("Target.createTarget", {
    url: `${webBase}/agents/beauty-industry/acquisition/xhs${query}`,
    browserContextId
  });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  for (const domain of ["Page.enable", "Runtime.enable", "Log.enable"]) await cdp.send(domain, {}, sessionId);
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: viewport.deviceScaleFactor ?? 1,
    mobile: viewport.mobile ?? false
  }, sessionId);

  await waitFor(cdp, sessionId, `location.pathname === "/login/beauty-industry"`);
  await waitFor(cdp, sessionId, `[...document.querySelectorAll("button")].some((node) => node.textContent?.includes("本机直接开通并进入"))`);
  await evaluate(cdp, sessionId, `() => {
    const button = [...document.querySelectorAll("button")].find((node) => node.textContent?.includes("本机直接开通并进入"));
    if (!button) throw new Error("local direct entry button missing");
    button.click();
  }`);
  await waitFor(cdp, sessionId, `location.pathname === "/agents/beauty-industry/acquisition/xhs"`);
  await waitFor(cdp, sessionId, `document.querySelector("[data-testid=beauty-xhs-workbench]")`);

  const first = await evaluate(cdp, sessionId, `() => ({
    path: location.pathname,
    workbench: Boolean(document.querySelector("[data-testid=beauty-xhs-workbench]")),
    width: innerWidth,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
  })`);
  assert.equal(first.path, "/agents/beauty-industry/acquisition/xhs");
  assert.equal(first.workbench, true);
  assert.equal(first.width, viewport.width);
  assert.equal(first.overflow, 0, `${viewport.width}px direct XHS entry has horizontal overflow`);

  await cdp.send("Page.reload", { ignoreCache: true }, sessionId);
  await waitFor(cdp, sessionId, `document.querySelector("[data-testid=beauty-xhs-workbench]")`);
  await cdp.send("Page.navigate", { url: `${webBase}/agents/beauty-industry${query}` }, sessionId);
  await waitFor(cdp, sessionId, `location.pathname === "/agents/beauty-industry"`);
  await evaluate(cdp, sessionId, `() => history.back()`);
  await waitFor(cdp, sessionId, `location.pathname === "/agents/beauty-industry/acquisition/xhs"`);
  await waitFor(cdp, sessionId, `document.querySelector("[data-testid=beauty-xhs-workbench]")`);
  return { browserContextId, sessionId, targetId, first };
}

async function evaluate(cdp, sessionId, functionDeclaration, argument) {
  const expression = argument === undefined
    ? `(${functionDeclaration})()`
    : `(${functionDeclaration})(${JSON.stringify(argument)})`;
  const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? "Runtime.evaluate failed");
  return result.result.value;
}

async function waitFor(cdp, sessionId, expression, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await evaluate(cdp, sessionId, `() => Boolean(${expression})`).catch(() => false);
    if (ready) return;
    await delay(100);
  }
  throw new Error(`browser condition timed out: ${expression}`);
}

async function main() {
  const stamp = Date.now();
  const tenantA = `BY14移动验收A-${stamp}`;
  const tenantB = `BY14隔离验收B-${stamp}`;
  const [tokenA, tokenB] = await Promise.all([createTenant(tenantA), createTenant(tenantB)]);
  const userDataDir = await mkdtemp(path.join(tmpdir(), "beauty-by14-chrome-"));
  const cdp = await connectChrome(userDataDir);
  try {
    const directDesktop = await createDirectEntryPage(cdp, { width: 1440, height: 1000 });
    const directMobile = await createDirectEntryPage(cdp, { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
    const mobile = await createPage(cdp, tokenA, tenantA, { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
    assert.equal(mobile.identity.width, 390, "mobile viewport must be 390 CSS pixels");
    assert.notEqual(mobile.identity.menuDisplay, "none", "mobile navigation toggle must be visible");
    await evaluate(cdp, mobile.sessionId, `() => document.querySelector('.beautyIndustryMobileMenu').click()`);
    await delay(150);
    const opened = await evaluate(cdp, mobile.sessionId, `() => ({
      expanded: document.querySelector('.beautyIndustryMobileMenu').getAttribute('aria-expanded'),
      drawer: document.querySelector('.beautyIndustrySidebar').getAttribute('data-open'),
      focus: document.activeElement?.textContent?.trim()
    })`);
    assert.equal(opened.expanded, "true", "mobile drawer toggle must expose its open state");
    assert.equal(opened.drawer, "true", "mobile drawer must enter its open state");
    assert.match(opened.focus, /工作台首页/, "mobile drawer must focus its first link");
    await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" }, mobile.sessionId);
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" }, mobile.sessionId);
    await delay(150);
    const closed = await evaluate(cdp, mobile.sessionId, `() => ({
      expanded: document.querySelector('.beautyIndustryMobileMenu').getAttribute('aria-expanded'),
      drawer: document.querySelector('.beautyIndustrySidebar').getAttribute('data-open'),
      focus: document.activeElement?.getAttribute('aria-label')
    })`);
    assert.deepEqual(closed, { expanded: "false", drawer: "false", focus: "展开美业智能体导航" }, "Escape must close the mobile drawer and restore focus");

    if (verifyRealXhs) {
      await cdp.send("Page.navigate", { url: `${webBase}/agents/beauty-industry/acquisition/xhs${query}` }, mobile.sessionId);
      await waitFor(cdp, mobile.sessionId, "document.querySelector('.beautyIndustryLiveBanner')");
      const liveState = await evaluate(cdp, mobile.sessionId, `() => ({
        banner: document.querySelector('.beautyIndustryLiveBanner')?.textContent?.trim(),
        controlledBanner: Boolean(document.querySelector('.beautyIndustryTestBanner')),
        width: innerWidth,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
      })`);
      assert.match(liveState.banner, /正式文案生成已就绪/);
      assert.match(liveState.banner, /明确确认后生成/);
      assert.equal(liveState.controlledBanner, false, "real acceptance must not show the controlled mock banner");
      assert.equal(liveState.width, 390);
      assert.equal(liveState.overflow, 0, "real XHS page must not overflow at 390px");
    }

    const isolated = await createPage(cdp, tokenB, tenantB, { width: 1440, height: 1000 });
    assert.notEqual(mobile.identity.tenant, isolated.identity.tenant, "two browser contexts must not share tenant identity");
    if (verifyRealXhs) {
      await cdp.send("Page.navigate", { url: `${webBase}/agents/beauty-industry/acquisition/xhs${query}` }, isolated.sessionId);
      await waitFor(cdp, isolated.sessionId, "document.querySelector('.beautyIndustryLiveBanner')");
      const desktopLiveState = await evaluate(cdp, isolated.sessionId, `() => ({
        banner: document.querySelector('.beautyIndustryLiveBanner')?.textContent?.trim(),
        controlledBanner: Boolean(document.querySelector('.beautyIndustryTestBanner')),
        width: innerWidth,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
      })`);
      assert.match(desktopLiveState.banner, /正式文案生成已就绪/);
      assert.equal(desktopLiveState.controlledBanner, false);
      assert.equal(desktopLiveState.width, 1440);
      assert.equal(desktopLiveState.overflow, 0, "real XHS page must not overflow at 1440px");
    }
    assert.equal(cdp.consoleErrors.length, 0, `browser console errors: ${cdp.consoleErrors.join(" | ")}`);
    process.stdout.write(`${JSON.stringify({
      status: "PASS",
      providerCalls: 0,
      localDirectEntry: {
        desktop: directDesktop.first,
        mobile: directMobile.first,
        refresh: "PASS",
        back: "PASS",
        inviteRequired: false
      },
      realXhs: verifyRealXhs ? "PASS" : "NOT_RUN",
      mobile: mobile.identity,
      isolatedTenant: isolated.identity.tenant,
      consoleErrors: 0
    })}\n`);
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

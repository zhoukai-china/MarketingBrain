import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

const requireFromDb = createRequire(new URL("../packages/db/package.json", import.meta.url));
const { PrismaClient } = requireFromDb("@prisma/client");
const prisma = new PrismaClient();
const webBase = process.env.BEAUTY_E2E_WEB_URL ?? "http://127.0.0.1:5176";
const apiBase = process.env.BEAUTY_E2E_API_URL ?? "http://127.0.0.1:3016";
const chromePath = process.env.BEAUTY_E2E_CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const route = `/agents/beauty-industry/acquisition/xhs?apiBase=${encodeURIComponent(apiBase)}`;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function apiJson(pathname, token, init = {}) {
  const response = await fetch(`${apiBase}${pathname}`, {
    ...init,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.body ? { "content-type": "application/json" } : {}), ...(init.headers ?? {}) }
  });
  return { response, body: await response.json().catch(() => ({})) };
}

async function createLanqiTenant(label) {
  const code = `by38-${randomBytes(18).toString("base64url")}`;
  const normalized = code.toLowerCase();
  await prisma.inviteCode.create({
    data: {
      codeHash: createHash("sha256").update(normalized).digest("hex"),
      codePreview: `${normalized.slice(0, 2)}****${normalized.slice(-2)}`,
      label: "BY-38 deterministic visual browser E2E",
      planCode: "local_standard",
      productCode: "beauty-industry",
      brandCode: "lanqi",
      maxUses: 1,
      expiresAt: new Date(Date.now() + 60 * 60_000),
      createdBy: "codex-by38-e2e"
    }
  });
  const login = await apiJson("/auth/beta-login", undefined, {
    method: "POST",
    body: JSON.stringify({ tenantName: label, productCode: "beauty-industry", inviteCode: code })
  });
  assert.equal(login.response.status, 200, JSON.stringify(login.body));
  assert.ok(login.body.token);
  const overview = await apiJson("/beauty-industry/acquisition", login.body.token);
  assert.equal(overview.response.status, 200, JSON.stringify(overview.body));
  assert.equal(overview.body.brand?.brandCode, "lanqi");
  return login.body;
}

async function createDefaultTenant(label) {
  const login = await apiJson("/auth/dev-login", undefined, {
    method: "POST",
    body: JSON.stringify({ tenantRole: "local_business", tenantName: label, productCode: "beauty-industry" })
  });
  assert.equal(login.response.status, 200, JSON.stringify(login.body));
  assert.ok(login.body.token);
  return login.body;
}

async function connectChrome(userDataDir) {
  const child = spawn(chromePath, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--remote-debugging-port=0", `--user-data-dir=${userDataDir}`, "about:blank"
  ], { stdio: ["ignore", "ignore", "ignore"], windowsHide: true });
  const activePortPath = path.join(userDataDir, "DevToolsActivePort");
  let endpoint;
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const activePort = await readFile(activePortPath, "utf8").catch(() => "");
    const [port, socketPath] = activePort.trim().split(/\r?\n/);
    if (/^\d+$/.test(port ?? "") && socketPath?.startsWith("/devtools/browser/")) {
      endpoint = `ws://127.0.0.1:${port}${socketPath}`;
      break;
    }
    await delay(100);
  }
  if (!endpoint) throw new Error("Chrome DevTools endpoint timeout");
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
  const confirmRequests = [];
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
      if (method === "POST" && /\/media\/confirm$/.test(url)) confirmRequests.push(url);
      if (!url.startsWith(webBase) && !url.startsWith(apiBase) && !url.startsWith("data:") && !url.startsWith("blob:") && !url.startsWith("devtools:") && !url.startsWith("https://fonts.googleapis.com/") && !url.startsWith("https://fonts.gstatic.com/")) externalRequests.push(url);
    }
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject, method });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  return { child, socket, send, consoleErrors, requestFailures, externalRequests, confirmRequests };
}

async function evaluate(cdp, sessionId, functionDeclaration, argument) {
  const expression = argument === undefined ? `(${functionDeclaration})()` : `(${functionDeclaration})(${JSON.stringify(argument)})`;
  const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}

async function waitFor(cdp, sessionId, expression, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(cdp, sessionId, `() => Boolean(${expression})`).catch(() => false)) return;
    await delay(150);
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
  assert.equal((await fetch(`${apiBase}/ready`).then((response) => response.json())).checks.database.ok, true);
  const stamp = Date.now();
  const owner = await createLanqiTenant(`BY38兰琪验收-${stamp}`);
  const other = await createDefaultTenant(`BY38隔离验收-${stamp}`);
  const before = await apiJson("/credits/transactions?limit=50", owner.token);
  assert.equal(before.response.status, 200);
  assert.ok(before.body.creditBalance >= 308);

  const userDataDir = await mkdtemp(path.join(tmpdir(), "beauty-by38-chrome-"));
  const cdp = await connectChrome(userDataDir);
  try {
    const desktop = await createPage(cdp, owner.token, { width: 1440, height: 1000 });
    const initial = await evaluate(cdp, desktop.sessionId, `() => ({ brand: document.querySelector('.beautyIndustryFormalPage')?.dataset?.brandCode, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, text: document.querySelector('[data-testid="beauty-xhs-workbench"]')?.innerText ?? '' })`);
    assert.equal(initial.brand, "lanqi");
    assert.equal(initial.overflow, 0);
    assert.match(initial.text, /通用美业门店场景/);
    assert.match(initial.text, /非本店实景/);
    assert.doesNotMatch(initial.text, /Provider|模型参数|内部提示词/);

    await evaluate(cdp, desktop.sessionId, `(value) => {
      const input = document.querySelector('.beautyXhsBriefPanel textarea');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }`, "为附近女性顾客生成皮肤管理产品小红书图文与三张通用美业门店场景");
    await evaluate(cdp, desktop.sessionId, `() => {
      const inputs = [...document.querySelectorAll('.beautyXhsOptionalFacts input')];
      const set = (input, value) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); };
      set(inputs[0], '附近女性顾客'); set(inputs[1], '皮肤管理产品');
    }`);
    await waitFor(cdp, desktop.sessionId, `document.querySelector('.beautyXhsGenerateActions .beautyIndustryPrimary')?.disabled === false`);
    await evaluate(cdp, desktop.sessionId, `() => { const button = document.querySelector('.beautyXhsGenerateActions .beautyIndustryPrimary'); button.click(); button.click(); }`);
    await waitFor(cdp, desktop.sessionId, `document.querySelector('.beautyXhsTitlePicker')`);
    try {
      await waitFor(cdp, desktop.sessionId, `document.querySelector('.beautyXhsImageDelivery button.beautyIndustryPrimary')?.disabled === false`);
    } catch (error) {
      const diagnostic = await evaluate(cdp, desktop.sessionId, `() => ({ button: document.querySelector('.beautyXhsImageDelivery button.beautyIndustryPrimary')?.textContent?.trim(), disabled: document.querySelector('.beautyXhsImageDelivery button.beautyIndustryPrimary')?.disabled, panel: document.querySelector('.beautyXhsImageDelivery')?.innerText ?? '', error: document.querySelector('.beautyIndustryError')?.innerText ?? '' })`);
      throw new Error(`${error instanceof Error ? error.message : String(error)} diagnostic=${JSON.stringify(diagnostic)}`);
    }
    const quote = await evaluate(cdp, desktop.sessionId, `() => ({ button: document.querySelector('.beautyXhsImageDelivery button.beautyIndustryPrimary')?.textContent?.trim(), panel: document.querySelector('.beautyXhsImageDelivery')?.innerText ?? '' })`);
    assert.match(quote.button, /确认生成三张门店场景｜300 积分/);
    assert.doesNotMatch(quote.panel, /wan|aliyun|Provider|模型/iu);

    const history = await apiJson("/beauty-industry/acquisition/history", owner.token);
    assert.equal(history.response.status, 200);
    const run = history.body.runs.find((item) => item.capabilityId === "beauty_xiaohongshu_package");
    assert.ok(run?.id);
    const creditsBeforeBlockedScene = await apiJson("/credits/transactions?limit=50", owner.token);
    const blockedScene = await apiJson(`/beauty-industry/acquisition/runs/${encodeURIComponent(run.id)}/media/confirm`, owner.token, {
      method: "POST",
      body: JSON.stringify({
        imageCount: 3,
        confirmed: true,
        requestKey: `by41blocked${stamp}`,
        imageRequirements: {
          overallVisualRequirements: "还原我的门店实景并安排顾客人物出镜",
          prohibitedContent: "",
          selectedTitle: "门店场景测试"
        }
      })
    });
    assert.equal(blockedScene.response.status, 422);
    assert.equal(blockedScene.body.error, "beauty_scene_reference_required");
    assert.match(blockedScene.body.message, /授权.*参考(?:照片|资料)/u);
    const blockedJobs = await apiJson(`/beauty-industry/acquisition/runs/${encodeURIComponent(run.id)}/media/jobs`, owner.token);
    assert.equal(blockedJobs.response.status, 200);
    assert.equal(blockedJobs.body.jobs.length, 0, "未授权本店还原/人物请求必须在图片任务创建前失败关闭");
    const creditsAfterBlockedScene = await apiJson("/credits/transactions?limit=50", owner.token);
    assert.equal(creditsAfterBlockedScene.body.creditBalance, creditsBeforeBlockedScene.body.creditBalance, "未授权场景不得预留积分");

    await evaluate(cdp, desktop.sessionId, `() => { const button = document.querySelector('.beautyXhsImageDelivery button.beautyIndustryPrimary'); button.click(); button.click(); }`);
    await waitFor(cdp, desktop.sessionId, `document.querySelectorAll('.beautyXhsImageCards img').length === 3 && [...document.querySelectorAll('.beautyXhsImageCards img')].every((image) => image.complete && image.naturalWidth === 768 && image.naturalHeight === 1024)`, 45_000);
    const delivered = await evaluate(cdp, desktop.sessionId, `() => ({ images: [...document.querySelectorAll('.beautyXhsImageCards img')].map((image) => [image.naturalWidth, image.naturalHeight]), downloads: [...document.querySelectorAll('.beautyXhsImageCards button')].filter((button) => button.textContent?.includes('下载')).length, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, panel: document.querySelector('.beautyXhsImageDelivery')?.innerText ?? '' })`);
    assert.equal(delivered.downloads, 3);
    assert.equal(delivered.overflow, 0);
    assert.equal((delivered.panel.match(/已通过并保存/g) ?? []).length, 3);
    assert.equal(cdp.confirmRequests.length, 1, "double click must create one media confirmation request");

    const jobs = await apiJson(`/beauty-industry/acquisition/runs/${encodeURIComponent(run.id)}/media/jobs`, owner.token);
    assert.equal(jobs.response.status, 200);
    assert.equal(jobs.body.batchStatus, "succeeded");
    assert.equal(jobs.body.jobs.length, 3);
    assert.ok(jobs.body.jobs.every((job) => job.customerUsable && job.provider === "local_deterministic" && job.qualityStatus === "passed"));
    for (const job of jobs.body.jobs) {
      const asset = await fetch(`${apiBase}/beauty-industry/media/assets/${encodeURIComponent(job.id)}/download`, { headers: { authorization: `Bearer ${owner.token}` } });
      assert.equal(asset.status, 200);
      assert.equal(asset.headers.get("content-type"), "image/png");
      const isolated = await fetch(`${apiBase}/beauty-industry/media/assets/${encodeURIComponent(job.id)}`, { headers: { authorization: `Bearer ${other.token}` } });
      assert.equal(isolated.status, 404);
    }

    await cdp.send("Page.reload", { ignoreCache: true }, desktop.sessionId);
    await waitFor(cdp, desktop.sessionId, `document.querySelectorAll('.beautyXhsImageCards img').length === 3`);
    const restored = await evaluate(cdp, desktop.sessionId, `() => ({ downloads: [...document.querySelectorAll('.beautyXhsImageCards button')].filter((button) => button.textContent?.includes('下载')).length, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth })`);
    assert.deepEqual(restored, { downloads: 3, overflow: 0 });

    const mobile = await createPage(cdp, owner.token, { width: 390, height: 844 });
    await waitFor(cdp, mobile.sessionId, `document.querySelectorAll('.beautyXhsImageCards img').length === 3`);
    const mobileState = await evaluate(cdp, mobile.sessionId, `() => ({ width: innerWidth, downloads: [...document.querySelectorAll('.beautyXhsImageCards button')].filter((button) => button.textContent?.includes('下载')).length, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth })`);
    assert.deepEqual(mobileState, { width: 390, downloads: 3, overflow: 0 });

    const after = await apiJson("/credits/transactions?limit=50", owner.token);
    assert.equal(before.body.creditBalance - after.body.creditBalance, 308);
    const mediaSettlements = after.body.transactions.filter((item) => item.direction === "consume" && item.amount === 300);
    assert.equal(mediaSettlements.length, 1);
    assert.deepEqual(cdp.consoleErrors, []);
    assert.deepEqual(cdp.requestFailures, []);
    assert.deepEqual(cdp.externalRequests, []);
    process.stdout.write(JSON.stringify({ ok: true, brand: "lanqi", desktop: "1440_PASS", mobile: "390_PASS", images: 3, dimensions: "768x1024", downloads: 3, confirmRequests: 1, tenantIsolation: "404_PASS", creditDelta: 308, mediaCreditsSettled: 300, providerCalls: 0, externalCostYuan: 0, consoleErrors: 0 }) + "\n");
  } finally {
    cdp.socket.close();
    cdp.child.kill();
    await Promise.race([new Promise((resolve) => cdp.child.once("exit", resolve)), delay(2_000)]);
    await rm(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());

import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

const requireFromDb = createRequire(new URL("../packages/db/package.json", import.meta.url));
const { PrismaClient } = requireFromDb("@prisma/client");

const webBase = process.env.BEAUTY_E2E_WEB_URL ?? "http://127.0.0.1:5176";
const apiBase = process.env.BEAUTY_E2E_API_URL ?? "http://127.0.0.1:3016";
const chromePath = process.env.BEAUTY_E2E_CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const query = `?apiBase=${encodeURIComponent(apiBase)}`;
const prisma = new PrismaClient();
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function jsonRequest(pathname, init = {}) {
  const response = await fetch(`${apiBase}${pathname}`, init);
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function createLanqiInvite() {
  const code = `lanqi-by30-${randomBytes(18).toString("base64url")}`;
  const normalized = code.trim().toLowerCase();
  await prisma.inviteCode.create({
    data: {
      codeHash: createHash("sha256").update(normalized).digest("hex"),
      codePreview: `${normalized.slice(0, 2)}****${normalized.slice(-2)}`,
      label: "BY-30 browser E2E",
      planCode: "local_standard",
      productCode: "beauty-industry",
      brandCode: "lanqi",
      maxUses: 1,
      expiresAt: new Date(Date.now() + 60 * 60_000),
      createdBy: "codex-by30-e2e"
    }
  });
  return code;
}

async function createLanqiTenant(label) {
  const inviteCode = await createLanqiInvite();
  const validation = await jsonRequest("/auth/product-invite/validate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ productCode: "beauty-industry", inviteCode })
  });
  assert.equal(validation.response.status, 200, JSON.stringify(validation.body));
  assert.equal(validation.body.brand?.brandCode, "lanqi");

  const login = await jsonRequest("/auth/beta-login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tenantName: label, productCode: "beauty-industry", inviteCode })
  });
  assert.equal(login.response.status, 200, JSON.stringify(login.body));
  assert.ok(login.body.token);
  return login.body;
}

async function createDefaultTenant(label) {
  const login = await jsonRequest("/auth/dev-login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tenantRole: "local_business", tenantName: label, productCode: "beauty-industry" })
  });
  assert.equal(login.response.status, 200, JSON.stringify(login.body));
  assert.ok(login.body.token);
  return login.body;
}

async function seedCustomerSafeXhsRun(auth) {
  const agent = await prisma.agentDefinition.findUnique({ where: { id: "agent_beauty_acquisition" }, select: { id: true } });
  assert.ok(agent?.id, "beauty acquisition agent must exist before browser E2E");
  const output = `## 客户可复制成品
### 标题候选
1. 附近女性顾客的日常皮肤管理清单
2. 皮肤管理产品怎么选？先看这三点
3. 一份温和实用的日常护理参考

### 正文
面对皮肤管理产品，不必追求夸张承诺。先从自己的日常护理习惯和已确认需求出发，了解产品的使用边界，再决定是否进一步咨询。门店可以提供清楚、克制的项目说明，帮助附近女性顾客先判断是否值得继续了解。

### 话题标签
#皮肤管理 #日常护理 #附近女性顾客 #门店生活 #小红书图文

### 互动与承接
你选皮肤管理产品时最先关注哪一点？欢迎留言说说。

## 门店制作说明
### 配图方向一｜封面图
正向视觉提示词：皮肤管理产品静物，温暖自然光，浅米色石材台面，主体居中偏下，上方留白，干净自然。
负向视觉提示词：真人，顾客正脸，门店实景，品牌标志，价格，疗效文字。
后期叠字：附近女性顾客的日常皮肤管理清单
视觉参数：小红书 3:4 竖图，柔和自然光，低饱和暖色。
### 配图方向二｜内容图
正向视觉提示词：皮肤管理产品与干净毛巾平铺，局部水珠和自然窗光，纯摄影静物。
负向视觉提示词：人物，商标，门店，价格，前后对比，医疗器械。
后期叠字：日常护理先看真实边界
视觉参数：小红书 3:4 竖图，近景静物，柔和光线。
### 配图方向三｜互动承接图
正向视觉提示词：皮肤管理产品与绿植静物，简洁台面，自然生活感。
负向视觉提示词：真人，二维码，电话号码，品牌，价格，促销大字。
后期叠字：你选产品时最关注哪一点？
视觉参数：小红书 3:4 竖图，中近景，低饱和自然色。

## 质量与合规检查
已确认事实：皮肤管理产品、附近女性顾客、小红书图文。未使用价格、疗效、顾客案例或联系方式。`;
  return prisma.agentRun.create({
    data: {
      tenantId: auth.tenantId,
      userId: auth.userId,
      agentId: agent.id,
      capabilityId: "beauty_xiaohongshu_package",
      requestId: `by32-browser-seed-${Date.now()}-${randomBytes(4).toString("hex")}`,
      requestFingerprint: "by32-browser-seeded-fixture",
      routingSource: "fixed_capability",
      deviceScope: "desktop",
      skillId: "wechat-xhs-content-line",
      skillVersion: "wechat-xhs-content-line@1.0.3+beauty-industry-xhs@1.1.0+beauty-industry-compliance@1.0.0",
      tenantType: "local_business",
      status: "succeeded",
      input: "全合成浏览器夹具：皮肤管理产品、附近女性顾客、小红书图文。",
      output,
      modelProvider: "browser-e2e-zero-provider-fixture",
      productCode: "beauty-industry",
      operatingEntityId: auth.tenantId,
      usageChannel: "web",
      creditCost: 0
    }
  });
}

async function assertApiContracts(lanqi, neutral) {
  const headers = { authorization: `Bearer ${lanqi.token}` };
  const lanqiOverview = await jsonRequest("/beauty-industry/acquisition", { headers });
  const neutralOverview = await jsonRequest("/beauty-industry/acquisition", { headers: { authorization: `Bearer ${neutral.token}` } });
  assert.equal(lanqiOverview.response.status, 200);
  assert.equal(lanqiOverview.body.brand.brandCode, "lanqi");
  assert.equal(lanqiOverview.body.brand.displayName, "兰琪");
  assert.equal(lanqiOverview.body.brand.knowledge.status, "awaiting_authorized_sources");
  assert.equal(lanqiOverview.body.brand.knowledge.authorized, false);
  assert.equal("knowledgePackRef" in lanqiOverview.body.brand, false);
  assert.equal(neutralOverview.body.brand.brandCode, "default");
  assert.equal(neutralOverview.body.brand.displayName, "美业智能体");
  assert.doesNotMatch(JSON.stringify(neutralOverview.body), /兰琪|lanqi-orange/);

  const spoofLogin = await jsonRequest("/auth/dev-login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tenantName: "BY30 spoof", productCode: "beauty-industry", brandCode: "lanqi" })
  });
  assert.equal(spoofLogin.response.status, 400);
  assert.equal(spoofLogin.body.error, "beauty_brand_override_forbidden");

  const beforeReservations = await prisma.creditReservation.count({ where: { tenantId: neutral.tenantId } });
  const spoofRun = await jsonRequest("/beauty-industry/acquisition/runs", {
    method: "POST",
    headers: { ...headers, "content-type": "application/json", "x-idempotency-key": `by30-spoof-${Date.now()}` },
    body: JSON.stringify({ toolName: "beauty.sales_advice", question: "客户犹豫不下单怎么办", brandCode: "default" })
  });
  assert.equal(spoofRun.response.status, 400);
  assert.equal(spoofRun.body.error, "beauty_brand_override_forbidden");
  assert.equal(await prisma.creditReservation.count({ where: { tenantId: neutral.tenantId } }), beforeReservations, "brand spoof must fail before ledger reservation");

  const connection = await jsonRequest("/integrations/workbuddy/connections", {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ productCode: "beauty-industry", label: "BY-30 Lanqi WorkBuddy" })
  });
  assert.equal(connection.response.status, 201, JSON.stringify(connection.body));
  const tools = await jsonRequest("/integrations/workbuddy/mcp", {
    method: "POST",
    headers: { authorization: `Bearer ${connection.body.token}`, "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "by30-tools", method: "tools/list", params: {} })
  });
  assert.equal(tools.response.status, 200, JSON.stringify(tools.body));
  assert.equal(tools.body.result.brandContext.brandCode, "lanqi");
  assert.equal(tools.body.result.brandContext.displayName, "兰琪");
  assert.equal("knowledgePackRef" in tools.body.result.brandContext, false);
}

async function assertSeededMediaQuote(auth, runId) {
  const quote = await jsonRequest(`/beauty-industry/acquisition/runs/${runId}/media/quote`, {
    method: "POST",
    headers: { authorization: `Bearer ${auth.token}`, "content-type": "application/json" },
    body: JSON.stringify({ imageCount: 3 })
  });
  assert.equal(quote.response.status, 200, `seeded media quote failed: ${JSON.stringify(quote.body)}`);
  assert.equal(quote.body.imageCount, 3);
  assert.equal(quote.body.imagePlan?.directions?.length, 3);
  assert.equal(quote.body.canConfirm, true, "acceptance runtime must enable the explicitly approved three-image confirmation");
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
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") consoleErrors.push(message.params.args.map((arg) => arg.value ?? arg.description ?? "").join(" "));
    if (message.method === "Log.entryAdded" && message.params.entry.level === "error") consoleErrors.push(message.params.entry.text);
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject, method });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  return { child, socket, send, consoleErrors };
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
  throw new Error(`browser condition timed out: ${expression}`);
}

async function openBrandPage(cdp, login, expected, viewport) {
  const { browserContextId } = await cdp.send("Target.createBrowserContext");
  const { targetId } = await cdp.send("Target.createTarget", { url: `${webBase}/login/beauty-industry${query}`, browserContextId });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  for (const domain of ["Page.enable", "Runtime.enable", "Log.enable"]) await cdp.send(domain, {}, sessionId);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: viewport.width, height: viewport.height, deviceScaleFactor: viewport.mobile ? 3 : 1, mobile: Boolean(viewport.mobile) }, sessionId);
  await waitFor(cdp, sessionId, "document.readyState === 'complete'");
  await evaluate(cdp, sessionId, `(value) => { localStorage.setItem("store_os_token", value); localStorage.setItem("store_os_diagnosis_done", "false"); }`, login.token);
  await cdp.send("Page.navigate", { url: `${webBase}/agents/beauty-industry${query}` }, sessionId);
  await waitFor(cdp, sessionId, `document.querySelector('.beautyIndustryFormalPage')?.dataset?.brandCode === ${JSON.stringify(expected.brandCode)}`);
  const first = await evaluate(cdp, sessionId, `() => ({
    brandCode: document.querySelector('.beautyIndustryFormalPage')?.dataset?.brandCode,
    product: document.querySelector('.beautyIndustryTopProduct strong')?.textContent?.trim(),
    sidebar: document.querySelector('.beautyIndustrySidebarBrand strong')?.textContent?.trim(),
    logo: document.querySelector('.beautyIndustrySidebarBrand>span')?.textContent?.trim(),
    theme: getComputedStyle(document.querySelector('.beautyIndustryFormalPage')).getPropertyValue('--beauty-green').trim().toUpperCase(),
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    title: document.title,
    width: innerWidth
  })`);
  assert.equal(first.product, expected.displayName);
  assert.equal(first.sidebar, expected.displayName);
  assert.equal(first.logo, expected.logo);
  assert.equal(first.theme, expected.primary);
  assert.equal(first.overflow, 0);
  assert.match(first.title, new RegExp(expected.displayName));
  await cdp.send("Page.reload", { ignoreCache: true }, sessionId);
  await waitFor(cdp, sessionId, `document.querySelector('.beautyIndustryFormalPage')?.dataset?.brandCode === ${JSON.stringify(expected.brandCode)}`);
  const refreshed = await evaluate(cdp, sessionId, `() => document.querySelector('.beautyIndustryTopProduct strong')?.textContent?.trim()`);
  assert.equal(refreshed, expected.displayName, "refresh must restore tenant-derived brand");
  return { browserContextId, sessionId, first };
}

async function assertXhsWorkbench(cdp, page, expectedBrand, expectSeededResult) {
  await cdp.send("Page.navigate", { url: `${webBase}/agents/beauty-industry/acquisition/xhs${query}` }, page.sessionId);
  await waitFor(cdp, page.sessionId, "document.querySelector('[data-testid=beauty-xhs-workbench]')");
  if (expectSeededResult) {
    await waitFor(cdp, page.sessionId, "document.querySelectorAll('[data-testid=xhs-title-option]').length === 3");
    await waitFor(cdp, page.sessionId, "[...document.querySelectorAll('.beautyXhsImageDelivery button')].some((node) => node.textContent?.includes('确认生成三张图片'))");
  }
  const state = await evaluate(cdp, page.sessionId, `() => ({
    brand: document.querySelector('.beautyIndustryFormalPage')?.dataset?.brandCode,
    workbench: Boolean(document.querySelector('[data-testid=beauty-xhs-workbench]')),
    titleCount: document.querySelectorAll('[data-testid=xhs-title-option]').length,
    copyButtons: ['copy-xhs-title','copy-xhs-body','copy-xhs-tags','copy-xhs-package'].every((id) => Boolean(document.querySelector('[data-testid=' + id + ']'))),
    imageCards: document.querySelectorAll('[data-testid=xhs-image-card]').length,
    imageAction: [...document.querySelectorAll('.beautyXhsImageDelivery button')].map((node) => node.textContent?.trim()).join('|'),
    imageConfirmDisabled: [...document.querySelectorAll('.beautyXhsImageDelivery button')].find((node) => node.textContent?.includes('确认生成三张图片'))?.disabled,
    body: document.querySelector('[data-testid=beauty-xhs-workbench]')?.innerText ?? '',
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
  })`);
  assert.equal(state.brand, expectedBrand);
  assert.equal(state.workbench, true);
  assert.equal(state.overflow, 0);
  if (expectSeededResult) {
    assert.equal(state.titleCount, 3);
    assert.equal(state.copyButtons, true);
    assert.equal(state.imageCards, 3);
    assert.match(state.imageAction, /确认生成三张图片/);
    assert.equal(state.imageConfirmDisabled, false);
    assert.doesNotMatch(state.body, /DeepSeek|wan2\.7|百炼|Provider|Skill|capability|Prompt|模型参数|源码指纹|controlled_mock/i);
    await cdp.send("Page.reload", { ignoreCache: true }, page.sessionId);
    await waitFor(cdp, page.sessionId, "document.querySelectorAll('[data-testid=xhs-title-option]').length === 3");
  } else {
    assert.equal(state.titleCount, 0, "another tenant must not restore the seeded XHS result");
  }
}

async function main() {
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL is required for isolated browser E2E");
  const stamp = Date.now();
  const lanqi = await createLanqiTenant(`BY30兰琪验收-${stamp}`);
  const neutral = await createDefaultTenant(`BY30默认美业-${stamp}`);
  const seededRun = await seedCustomerSafeXhsRun(lanqi);
  await assertApiContracts(lanqi, neutral);
  await assertSeededMediaQuote(lanqi, seededRun.id);
  const userDataDir = await mkdtemp(path.join(tmpdir(), "beauty-by30-chrome-"));
  const cdp = await connectChrome(userDataDir);
  try {
    const desktop = await openBrandPage(cdp, lanqi, { brandCode: "lanqi", displayName: "兰琪", logo: "兰琪", primary: "#B94E0A" }, { width: 1440, height: 1000 });
    const mobile = await openBrandPage(cdp, lanqi, { brandCode: "lanqi", displayName: "兰琪", logo: "兰琪", primary: "#B94E0A" }, { width: 390, height: 844, mobile: true });
    const defaultPage = await openBrandPage(cdp, neutral, { brandCode: "default", displayName: "美业智能体", logo: "美", primary: "#1F6B57" }, { width: 1440, height: 1000 });
    await assertXhsWorkbench(cdp, desktop, "lanqi", true);
    await assertXhsWorkbench(cdp, mobile, "lanqi", true);
    await assertXhsWorkbench(cdp, defaultPage, "default", false);
    assert.equal(cdp.consoleErrors.length, 0, `browser console errors: ${cdp.consoleErrors.join(" | ")}`);
    process.stdout.write(`${JSON.stringify({ status: "PASS", providerCalls: 0, xhsWorkbench: "PASS", xhsRefresh: "PASS", xhsTenantIsolation: "PASS", xhsMediaConfirmClicks: 0, lanqiTenant: lanqi.tenantId, neutralTenant: neutral.tenantId, desktop: desktop.first, mobile: mobile.first, neutral: defaultPage.first, consoleErrors: 0 })}\n`);
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
}).finally(async () => prisma.$disconnect());

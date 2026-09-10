// 生产注册验收：用一次性邀请码在真实 PROD 实例上走完「注册 / 开通工作区」页面路径。
// 这是「真人微信扫码」的确定性等价路径：微信首次授权之前的建号、发 token、建钱包、
// 扣减邀请码全部走同一套 /auth/beta-login 服务端逻辑。
// 用法：SIGNUP_WEB_URL=https://api.lcppch.top/os-v2 SIGNUP_INVITE_CODE=... node scripts/tmp/prod-signup-acceptance.mjs
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const webBase = (process.env.SIGNUP_WEB_URL ?? "https://api.lcppch.top/os-v2").replace(/\/+$/, "");
const inviteCode = process.env.SIGNUP_INVITE_CODE;
const tenantName = process.env.SIGNUP_TENANT_NAME ?? `QA注册验收工作区-${Date.now()}`;
const chromePath = process.env.DEPLOY_CHECK_CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const shotDir = process.env.SHOT_DIR ?? path.join(tmpdir(), `signup-acceptance-${Date.now()}`);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

if (!inviteCode) throw new Error("SIGNUP_INVITE_CODE is required");

const userDataDir = await mkdtemp(path.join(tmpdir(), "signup-acceptance-chrome-"));
const child = spawn(chromePath, [
  "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  "--window-size=1440,1200", "--remote-debugging-port=0", `--user-data-dir=${userDataDir}`, "about:blank"
], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });

const endpoint = await new Promise((resolve, reject) => {
  let out = "";
  const timer = setTimeout(() => reject(new Error("DevTools endpoint timeout")), 15000);
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (c) => {
    out += c;
    const m = out.match(/DevTools listening on (ws:\/\/[^\s]+)/);
    if (m) { clearTimeout(timer); resolve(m[1]); }
  });
  child.once("exit", (code) => reject(new Error(`chrome exited early (${code})`)));
});

const socket = new WebSocket(endpoint);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
let nextId = 0;
const pending = new Map();
const consoleErrors = [];
const failedRequests = [];
let resolveBetaLogin;
const betaLoginResponse = new Promise((resolve) => { resolveBetaLogin = resolve; });
socket.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data);
  if (msg.method === "Runtime.consoleAPICalled" && msg.params?.type === "error") {
    consoleErrors.push((msg.params.args ?? []).map((a) => a.value ?? a.description ?? "").join(" "));
  }
  if (msg.method === "Runtime.exceptionThrown") {
    consoleErrors.push(msg.params?.exceptionDetails?.exception?.description ?? "pageerror");
  }
  // 注册响应必须在 responseReceived 当下取回：提交成功后页面会整页跳转到 /market，
  // 跳转会把已完成的响应体从 DevTools 里清掉，事后再取只能拿到空 body。
  if (msg.method === "Network.responseReceived"
    && msg.params?.response?.url?.includes("/auth/beta-login")
    && msg.params.response.status === 200) {
    send("Network.getResponseBody", { requestId: msg.params.requestId }, msg.sessionId)
      .then((res) => { try { resolveBetaLogin(JSON.parse(res.body)); } catch { resolveBetaLogin(null); } })
      .catch(() => resolveBetaLogin(null));
  }
  if (msg.method === "Network.loadingFailed") {
    failedRequests.push(`${msg.params?.requestId}:${msg.params?.errorText}`);
  }
  if (!msg.id) return;
  const h = pending.get(msg.id);
  if (!h) return;
  pending.delete(msg.id);
  msg.error ? h.reject(new Error(msg.error.message)) : h.resolve(msg.result);
});
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = ++nextId;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
});
const evaluate = async (sessionId, fn, args) => {
  const res = await send("Runtime.evaluate", {
    expression: args ? `(${fn})(${JSON.stringify(args)})` : `(${fn})()`,
    returnByValue: true, awaitPromise: true
  }, sessionId);
  return res.result?.value;
};
const waitFor = async (sessionId, fn, timeoutMs = 30000) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await evaluate(sessionId, fn).catch(() => false);
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`waitFor timeout: ${fn}`);
    await delay(300);
  }
};
const shot = async (sessionId, name) => {
  const file = path.join(shotDir, name);
  await writeFile(file, Buffer.from((await send("Page.captureScreenshot", { format: "png" }, sessionId)).data, "base64"));
  return file;
};

await mkdir(shotDir, { recursive: true });
const report = { tenantName, inviteCodeUsed: inviteCode, steps: {}, shots: [], apiResponse: null };
try {
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  await send("Page.enable", {}, sessionId);
  await send("Runtime.enable", {}, sessionId);
  await send("Network.enable", {}, sessionId);
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1200, deviceScaleFactor: 1, mobile: false }, sessionId);

  // A. 匿名访客：根路径落货架、显示未登录、没有 token。
  await send("Page.navigate", { url: `${webBase}/` }, sessionId);
  const anon = await waitFor(sessionId, `() => {
    const text = document.body.innerText;
    const pill = document.querySelector(".wallet-pill");
    if (/正在进入体验工作区|内测实例/.test(text)) return { directTest: true, text: text.slice(0, 120) };
    if (window.location.pathname.endsWith("/market") && pill) {
      return { directTest: false, pill: pill.textContent.trim(), token: localStorage.getItem("store_os_token") };
    }
    return false;
  }`);
  assert.equal(anon.directTest, false, "PROD must not be a direct-test instance");
  assert.ok(!anon.token, "anonymous visitor has no token");
  assert.match(anon.pill, /未登录/, "anonymous visitor sees the 未登录 wallet pill");
  report.steps.anonymousShelf = "PASS";
  report.shots.push(await shot(sessionId, "01-anonymous-market.png"));

  // B. 未登录点击受保护入口，应被引导到登录页。
  await send("Page.navigate", { url: `${webBase}/mine` }, sessionId);
  const gate = await waitFor(sessionId, `() => {
    const text = document.body.innerText;
    if (/你还未登录|未登录/.test(text)) return { ok: true, text: text.slice(0, 120) };
    return false;
  }`);
  assert.ok(gate.ok, "protected page shows the login gate for anonymous visitors");
  report.steps.anonymousGate = "PASS";

  // C. 登录页：渲染平台登录/注册页 + 微信入口 + 邀请码入口。
  await send("Page.navigate", { url: `${webBase}/login` }, sessionId);
  await waitFor(sessionId, `() => document.body.innerText.includes("登录 / 注册")`);
  await waitFor(sessionId, `() => {
    const btn = document.querySelector(".wechatLoginBtn");
    return (Boolean(btn) && !btn.disabled) || /使用邀请码开通/.test(document.body.innerText);
  }`, 20000);
  const loginText = await evaluate(sessionId, `() => document.body.innerText`);
  assert.match(loginText, /思潼AI 行业智能体平台/, "login page shows the platform name");
  report.steps.loginPage = "PASS";
  report.shots.push(await shot(sessionId, "02-login-page.png"));

  // D. 展开邀请码开工作区表单并真实提交（这一步就是注册）。
  const opened = await evaluate(sessionId, `() => {
    if (document.querySelector(".loginForm form")) return "already-open";
    const link = [...document.querySelectorAll("button")].find((b) => b.textContent.includes("使用邀请码开通"));
    if (!link) return false;
    link.click();
    return "clicked";
  }`);
  assert.notEqual(opened, false, "invite-code workspace entry is reachable");
  await waitFor(sessionId, `() => document.querySelectorAll(".loginForm form input").length >= 2`);
  await evaluate(sessionId, `({ tenantName, inviteCode }) => {
    const inputs = [...document.querySelectorAll(".loginForm form input")];
    const setValue = (el, value) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    setValue(inputs[0], tenantName);
    setValue(inputs[1], inviteCode);
    return true;
  }`, { tenantName, inviteCode });
  const filled = await evaluate(sessionId, `() => {
    const inputs = [...document.querySelectorAll(".loginForm form input")];
    return inputs.map((i) => i.value);
  }`);
  assert.equal(filled[0], tenantName, "workspace name input is filled");
  assert.equal(filled[1], inviteCode, "invite code input is filled");
  report.shots.push(await shot(sessionId, "03-invite-form-filled.png"));

  await evaluate(sessionId, `() => {
    const btn = document.querySelector(".loginSubmit");
    if (!btn) throw new Error("login submit button missing");
    btn.click();
    return true;
  }`);

  // 提交后要等三件事同时成立：token 落盘、路由到货架、钱包 pill 拿到余额。
  // 钱包余额是异步拉取的，先到 /market 时 pill 仍会短暂显示「未登录」，所以必须
  // 等到 pill 真的离开匿名态，而不是一到货架就断言。
  const landed = await waitFor(sessionId, `() => {
    const token = localStorage.getItem("store_os_token");
    const pill = document.querySelector(".wallet-pill");
    const onMarket = window.location.pathname.endsWith("/market");
    if (token && onMarket && pill && !/未登录/.test(pill.textContent)) {
      return { token, pill: pill.textContent.trim(), path: window.location.pathname };
    }
    // 只把真正的错误块当失败；.loginFeedback 同时承载「正在创建你的专属工作区...」状态文案。
    const err = document.querySelector(".loginError");
    if (err && err.textContent.trim()) return { error: err.textContent.trim() };
    return false;
  }`, 90000);
  assert.ok(landed.token, `signup failed: ${landed.error ?? "no token issued"}`);
  assert.equal(landed.path.endsWith("/market"), true, "new account lands on the platform shelf");
  assert.doesNotMatch(landed.pill, /未登录/, "wallet pill switches out of the anonymous state");
  assert.match(landed.pill, /积分/, "wallet pill shows the credit wallet");
  report.steps.signupSubmit = "PASS";
  report.steps.walletPill = landed.pill;
  report.steps.landedPath = landed.path;
  report.shots.push(await shot(sessionId, "04-signed-in-market.png"));

  // 抓取 beta-login 的原始响应（tenantId / userId / plan / 邀请码回执证据）。
  const api = await Promise.race([betaLoginResponse, delay(8000).then(() => null)]);
  if (api) {
    report.apiResponse = {
      tenantId: api.tenantId, userId: api.userId, dataMode: api.dataMode,
      plan: api.plan?.planCode ?? api.plan, creditBalance: api.creditBalance,
      diagnosisRequired: api.diagnosisRequired, invite: api.invite, tenantRole: api.tenantRole
    };
    report.tokenIssued = Boolean(api.token);
  }
  assert.ok(report.apiResponse?.tenantId, "beta-login returned a tenantId");
  report.steps.betaLoginResponse = "PASS";

  // E. 会话保持：已登录再访问 /login 必须直接回平台首页，不能再次出现注册表单。
  await send("Page.navigate", { url: `${webBase}/login` }, sessionId);
  // 同样必须等到钱包余额重新拉回来，否则会把「刷新瞬间还没拿到余额」误判成掉登录。
  const stillIn = await waitFor(sessionId, `() => {
    const token = localStorage.getItem("store_os_token");
    const pill = document.querySelector(".wallet-pill");
    if (token && window.location.pathname.endsWith("/market") && pill && !/未登录/.test(pill.textContent)) {
      return { path: window.location.pathname, pill: pill.textContent.trim() };
    }
    return false;
  }`, 40000);
  assert.equal(stillIn.path.endsWith("/market"), true, "logged-in session is redirected off the login page");
  assert.doesNotMatch(stillIn.pill, /未登录/, "wallet pill stays logged in after revisiting /login");
  report.steps.sessionPersists = "PASS";
  report.shots.push(await shot(sessionId, "05-session-persists.png"));

  // F. 全新浏览器上下文（等同新设备）没有 token，必须仍是未登录 —— 证明登录态来自服务端账号而非本地残留。
  await send("Target.createBrowserContext").then(async ({ browserContextId }) => {
    const { targetId: t2 } = await send("Target.createTarget", { url: "about:blank", browserContextId });
    const { sessionId: s2 } = await send("Target.attachToTarget", { targetId: t2, flatten: true });
    await send("Page.enable", {}, s2);
    await send("Runtime.enable", {}, s2);
    await send("Page.navigate", { url: `${webBase}/market` }, s2);
    const fresh = await waitFor(s2, `() => {
      const pill = document.querySelector(".wallet-pill");
      return pill ? { pill: pill.textContent.trim(), token: localStorage.getItem("store_os_token") } : false;
    }`, 30000);
    assert.ok(!fresh.token, "a fresh browser context has no token");
    assert.match(fresh.pill, /未登录/, "a fresh browser context is anonymous");
    report.steps.freshContextAnonymous = "PASS";
    await send("Target.disposeBrowserContext", { browserContextId });
  });

  // G. 负向：同一次性邀请码不能再被复用（maxUses=1，用后必须拒绝且不建新工作区）。
  const reuse = await evaluate(sessionId, `async ({ apiBase, inviteCode }) => {
    const res = await fetch(apiBase + "/auth/beta-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantRole: "local_business", tenantName: "QA重复使用应被拒绝", inviteCode })
    });
    const body = await res.json().catch(() => null);
    return { status: res.status, error: body?.error ?? null };
  }`, { apiBase: `${webBase}/api`, inviteCode });
  assert.equal(reuse.status, 403, `reusing the one-time invite code must be rejected (got ${reuse.status})`);
  assert.equal(reuse.error, "invite_code_exhausted", "exhausted invite code reports its real reason");
  report.steps.inviteCodeSingleUse = "PASS";

  const realErrors = consoleErrors.filter((e) => !/favicon|Download the React DevTools/i.test(e));
  assert.deepEqual(realErrors, [], `console must stay clean: ${realErrors.join(" | ")}`);
  report.steps.consoleClean = "PASS";

  await writeFile(path.join(shotDir, "signup-acceptance-report.json"), JSON.stringify(report, null, 2), "utf8");
  console.log("prod_signup_acceptance:PASS");
  console.log(JSON.stringify(report, null, 2));
  console.log(`shots=${report.shots.join(",")}`);
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  await writeFile(path.join(shotDir, "signup-acceptance-report.json"), JSON.stringify(report, null, 2), "utf8").catch(() => {});
  console.error(`prod_signup_acceptance:FAIL ${report.error}`);
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
} finally {
  socket.close();
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill();
  await exited;
}

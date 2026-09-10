// 生产「兰琪产品邀请码注册」端到端验收（在真实 PROD 实例上跑，会消耗 1 个席位）。
//
// 覆盖的真实用户路径：
//   /os-v2/login/lanqi → 产品邀请码校验 → 门店资料 → /auth/beta-login →
//   发放 token → 落地兰琪经营驾驶舱 → 会话保持。
//
// 与「真人微信扫码」的关系：微信首次授权成功后会回到补资料页，
// 之后调用的仍是同一个 `/auth/beta-login` 服务端建号逻辑（建租户、发 token、
// 建钱包、扣减邀请码）。所以本脚本是扫码路径的确定性等价验收：把「微信授权」
// 一步换成直接提交资料，其余服务端链路完全一致。
//
// 席位保护：本脚本只做 1 次真实注册。失败的邀请码用一次性随机假码验证，
// 不做「同一邀请码重复使用」测试（多席位邀请码重复使用会真的再建一个租户）。
//
// 用法：
//   SIGNUP_WEB_URL=https://api.lcppch.top/os-v2 \
//   SIGNUP_INVITE_CODE=<生产邀请码> \
//   SIGNUP_STORE_NAME=<本次一次性门店名> \
//   node scripts/tmp/prod-lanqi-signup-acceptance.mjs
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const webBase = (process.env.SIGNUP_WEB_URL ?? "https://api.lcppch.top/os-v2").replace(/\/+$/, "");
const apiBase = `${webBase}/api`;
const inviteCode = process.env.SIGNUP_INVITE_CODE;
const storeName = process.env.SIGNUP_STORE_NAME ?? `兰琪注册验收门店-${Date.now()}`;
const chromePath = process.env.DEPLOY_CHECK_CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const shotDir = process.env.SHOT_DIR ?? path.join(tmpdir(), `lanqi-signup-acceptance-${Date.now()}`);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

if (!inviteCode) throw new Error("SIGNUP_INVITE_CODE is required");

const userDataDir = await mkdtemp(path.join(tmpdir(), "lanqi-signup-chrome-"));
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
const betaLogin = {};
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
  // 注册响应要在跳转前取回：提交成功后页面会整页跳到兰琪工作台，
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
  if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description ?? "evaluate failed");
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
const gate = (pass, name, detail = "") => {
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  ${detail}` : ""}`);
  if (!pass) throw new Error(`gate failed: ${name}${detail ? ` (${detail})` : ""}`);
};

await mkdir(shotDir, { recursive: true });
const report = {
  webBase, storeName, inviteCodeUsedPrefix: `${inviteCode.slice(0, 2)}…${inviteCode.slice(-2)}`,
  steps: {}, shots: [], apiResponse: null, consoleErrors: [], failedRequests: []
};
try {
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  await send("Page.enable", {}, sessionId);
  await send("Runtime.enable", {}, sessionId);
  await send("Network.enable", {}, sessionId);
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1200, deviceScaleFactor: 1, mobile: false }, sessionId);

  // A. 兰琪产品登录页：未登录、无 token、显示产品邀请码入口。
  await send("Page.navigate", { url: `${webBase}/login/lanqi` }, sessionId);
  const entry = await waitFor(sessionId, `() => {
    const form = document.querySelector(".productInviteForm");
    if (!form) return false;
    const text = document.body.innerText;
    return {
      hasInviteField: /产品邀请码/.test(text),
      hasWechat: Boolean(document.querySelector(".wechatLoginBtn")),
      token: localStorage.getItem("store_os_token"),
      text: text.slice(0, 200)
    };
  }`);
  gate(!entry.token, "anonymous visitor has no token");
  gate(entry.hasInviteField, "lanqi product entry renders the 产品邀请码 field");
  report.steps.entryPage = "PASS";
  report.steps.wechatButtonVisible = entry.hasWechat;
  report.shots.push(await shot(sessionId, "01-lanqi-invite-entry.png"));

  const fillInvite = (value) => evaluate(sessionId, `({ value }) => {
    const input = document.querySelector(".productInviteForm input");
    if (!input) throw new Error("invite input missing");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return input.value;
  }`, { value });
  const submitInvite = () => evaluate(sessionId, `() => {
    const btn = document.querySelector(".productInviteForm .loginSubmit");
    if (!btn) throw new Error("invite submit missing");
    btn.click();
    return true;
  }`);

  // B. 失败路径：随手编的一次性假邀请码必须被拒，且不得建租户、不得发 token。
  const bogusCode = `LANQI-QA-NOT-EXIST-${Date.now().toString(36).toUpperCase()}`;
  await fillInvite(bogusCode);
  await submitInvite();
  const rejected = await waitFor(sessionId, `() => {
    const err = document.querySelector(".loginError");
    return err && err.textContent.trim() ? { error: err.textContent.trim() } : false;
  }`, 30000);
  const afterBogus = await evaluate(sessionId, `() => ({
    token: localStorage.getItem("store_os_token"),
    stillOnInviteForm: Boolean(document.querySelector(".productInviteForm"))
  })`);
  gate(Boolean(rejected.error), "invalid invite code is rejected with a user-facing message", rejected.error);
  gate(!afterBogus.token, "invalid invite code issues no token");
  gate(afterBogus.stillOnInviteForm, "invalid invite code keeps the visitor on the invite form");
  report.steps.invalidInviteRejected = `PASS: ${rejected.error}`;
  report.shots.push(await shot(sessionId, "02-invalid-invite-rejected.png"));

  // C. 正常路径：真实邀请码 → 通过校验 → 补门店资料。
  await fillInvite(inviteCode);
  await submitInvite();
  await waitFor(sessionId, `() => {
    const text = document.body.innerText;
    if (/邀请码有效|门店名称/.test(text)) return true;
    const err = document.querySelector(".loginError");
    if (err && err.textContent.trim()) throw new Error(err.textContent.trim());
    return false;
  }`, 30000);
  const validated = await waitFor(sessionId, `() => {
    const inputs = [...document.querySelectorAll(".loginForm input")];
    if (inputs.length < 3) return false;
    return { count: inputs.length, text: document.body.innerText.slice(0, 400) };
  }`, 20000);
  gate(/门店名称/.test(validated.text), "validated invite code reveals the store-profile form");
  report.steps.inviteValidated = "PASS";
  report.shots.push(await shot(sessionId, "03-invite-validated.png"));

  const filled = await evaluate(sessionId, `({ storeName }) => {
    const inputs = [...document.querySelectorAll(".loginForm input")];
    const setValue = (el, value) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    setValue(inputs[0], storeName);
    setValue(inputs[1], "美业");
    setValue(inputs[2], "上海");
    return inputs.map((i) => i.value);
  }`, { storeName });
  gate(filled[0] === storeName && filled[1] === "美业" && filled[2] === "上海", "store-profile fields are filled", JSON.stringify(filled));
  report.shots.push(await shot(sessionId, "04-store-profile-filled.png"));

  await evaluate(sessionId, `() => {
    const btn = document.querySelector(".loginForm .loginSubmit");
    if (!btn) throw new Error("signup submit missing");
    btn.click();
    return true;
  }`);

  const landed = await waitFor(sessionId, `() => {
    const token = localStorage.getItem("store_os_token");
    const path = window.location.pathname;
    const inLanqi = path.includes("/lanqi/");
    if (token && inLanqi) return { token, path };
    const err = document.querySelector(".loginError");
    if (err && err.textContent.trim()) return { error: err.textContent.trim() };
    return false;
  }`, 90000);
  gate(!landed.error, "signup completes without a user-facing error", landed.error ?? "");
  gate(Boolean(landed.token), "signup issues a session token");
  gate(String(landed.path).includes("/lanqi/"), "new account lands inside the lanqi workspace", landed.path);
  report.steps.signupSubmit = "PASS";
  report.steps.landedPath = landed.path;
  report.shots.push(await shot(sessionId, "05-signed-in-lanqi.png"));

  // D. 抓 beta-login 原始响应：租户/用户/套餐/邀请码回执都在这里。
  const api = await Promise.race([betaLoginResponse, delay(8000).then(() => null)]);
  if (api) {
    report.apiResponse = {
      tenantId: api.tenantId, userId: api.userId, dataMode: api.dataMode,
      plan: api.plan?.planCode ?? api.plan, creditBalance: api.creditBalance,
      diagnosisRequired: api.diagnosisRequired, invite: api.invite, tenantRole: api.tenantRole
    };
  }
  assert.ok(report.apiResponse?.tenantId, "beta-login returned a tenantId");
  // 邀请码回执是 `{ source, redeemed }`（数据库邀请码被真实核销的凭据），
  // 不带 productCode；这里只断言「核销确实发生」，产品归属由入口与后续权限检查证明。
  const inviteReceipt = report.apiResponse.invite;
  gate(inviteReceipt?.redeemed === true,
    `beta-login confirms the invite code was redeemed (${JSON.stringify(inviteReceipt)})`);
  report.steps.betaLoginResponse = "PASS";

  // E. 会话保持：已登录再访问兰琪入口必须直接进工作台，不再出现邀请码表单。
  await send("Page.navigate", { url: `${webBase}/lanqi/dashboard` }, sessionId);
  const persists = await waitFor(sessionId, `() => {
    const token = localStorage.getItem("store_os_token");
    const path = window.location.pathname;
    if (token && path.includes("/lanqi/")) return { path, hasInviteForm: Boolean(document.querySelector(".productInviteForm")) };
    return false;
  }`, 45000);
  gate(!persists.hasInviteForm, "logged-in session is not shown the invite form again");
  report.steps.sessionPersists = "PASS";
  report.shots.push(await shot(sessionId, "06-session-persists.png"));

  // F. 新租户可用性：用刚发的 token 走两条真实读接口（门店 + 积分账户）。
  const apiChecks = await evaluate(sessionId, `async ({ apiBase, token }) => {
    const call = async (p) => {
      const res = await fetch(apiBase + p, { headers: { authorization: "Bearer " + token } });
      const text = await res.text();
      let json = null; try { json = JSON.parse(text); } catch {}
      return { status: res.status, json, text: text.slice(0, 300) };
    };
    return { stores: await call("/lanqi/stores"), account: await call("/account/status") };
  }`, { apiBase, token: landed.token });
  gate(apiChecks.stores.status === 200, `new tenant can read its own stores (${apiChecks.stores.status})`, apiChecks.stores.text);
  gate(apiChecks.account.status === 200, `new tenant can read its own wallet (${apiChecks.account.status})`, apiChecks.account.text);
  report.steps.newTenantReadApis = "PASS";
  report.steps.accountStatus = apiChecks.account.json;
  report.steps.storeCount = Array.isArray(apiChecks.stores.json?.stores) ? apiChecks.stores.json.stores.length : null;

  // G. 未登录上下文（等同新设备）仍然匿名：证明登录态来自服务端账号而非本地残留。
  const { browserContextId } = await send("Target.createBrowserContext");
  const { targetId: t2 } = await send("Target.createTarget", { url: "about:blank", browserContextId });
  const { sessionId: s2 } = await send("Target.attachToTarget", { targetId: t2, flatten: true });
  await send("Page.enable", {}, s2);
  await send("Runtime.enable", {}, s2);
  await send("Page.navigate", { url: `${webBase}/lanqi/dashboard` }, s2);
  const fresh = await waitFor(s2, `() => ({ token: localStorage.getItem("store_os_token"), path: window.location.pathname })`, 30000);
  gate(!fresh.token, "a fresh browser context has no token");
  gate(!String(fresh.path).includes("/lanqi/dashboard"), "anonymous visitor is redirected off the lanqi workspace", fresh.path);
  report.steps.freshContextAnonymous = "PASS";
  await send("Target.disposeBrowserContext", { browserContextId });

  report.consoleErrors = consoleErrors;
  report.failedRequests = failedRequests;
  await writeFile(path.join(shotDir, "lanqi-signup-acceptance-report.json"), JSON.stringify(report, null, 2), "utf8");
  console.log("prod_lanqi_signup_acceptance:PASS");
  console.log(JSON.stringify(report, null, 2));
  console.log(`shots=${report.shots.join(",")}`);
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  report.consoleErrors = consoleErrors;
  report.failedRequests = failedRequests;
  await writeFile(path.join(shotDir, "lanqi-signup-acceptance-report.json"), JSON.stringify(report, null, 2), "utf8").catch(() => {});
  console.error(`prod_lanqi_signup_acceptance:FAIL ${report.error}`);
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
} finally {
  socket.close();
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill();
  await exited;
}

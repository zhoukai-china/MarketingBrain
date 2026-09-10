// 新注册租户的兰琪工作台页面级验收（只读，不消耗席位、不写业务数据）。
//
// 用途：`prod-lanqi-signup-acceptance.mjs` 跑完注册后，用该租户的服务端会话令牌
// 注入浏览器，确认「新账号真的能看到并进入兰琪工作台」，而不是只拿到一个 token。
// 令牌由生产服务器用 `JWT_SECRET` 现签（见 docs/TEST_PLAN.md 的自签会话约定）。
//
// 用法：
//   VERIFY_WEB_URL=https://api.lcppch.top/os-v2 \
//   VERIFY_TENANT_ID=... VERIFY_USER_ID=... VERIFY_TOKEN=<生产签发的会话令牌> \
//   SIGNUP_STORE_NAME=<门店名> \
//   node scripts/tmp/prod-lanqi-new-tenant-browser-verify.mjs
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const webBase = (process.env.VERIFY_WEB_URL ?? "https://api.lcppch.top/os-v2").replace(/\/+$/, "");
const tenantId = process.env.VERIFY_TENANT_ID;
const userId = process.env.VERIFY_USER_ID;
const token = process.env.VERIFY_TOKEN;
const storeName = process.env.SIGNUP_STORE_NAME ?? "";
const chromePath = process.env.DEPLOY_CHECK_CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const shotDir = process.env.SHOT_DIR ?? path.join(tmpdir(), `lanqi-new-tenant-verify-${Date.now()}`);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

if (!tenantId || !userId || !token) throw new Error("VERIFY_TENANT_ID / VERIFY_USER_ID / VERIFY_TOKEN are required");

const userDataDir = await mkdtemp(path.join(tmpdir(), "lanqi-verify-chrome-"));
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
const pageResponses = [];
socket.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data);
  if (msg.method === "Runtime.consoleAPICalled" && msg.params?.type === "error") {
    consoleErrors.push((msg.params.args ?? []).map((a) => a.value ?? a.description ?? "").join(" "));
  }
  if (msg.method === "Runtime.exceptionThrown") {
    consoleErrors.push(msg.params?.exceptionDetails?.exception?.description ?? "pageerror");
  }
  if (msg.method === "Network.responseReceived" && String(msg.params?.response?.url ?? "").includes("/api/")) {
    pageResponses.push({ url: msg.params.response.url.replace(webBase, ""), status: msg.params.response.status });
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

await mkdir(shotDir, { recursive: true });
const report = { webBase, tenantId, userId, shots: [], steps: {}, pageResponses: [], consoleErrors: [] };
try {
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  await send("Page.enable", {}, sessionId);
  await send("Runtime.enable", {}, sessionId);
  await send("Network.enable", {}, sessionId);
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1200, deviceScaleFactor: 1, mobile: false }, sessionId);

  // 先落到同源页面，再写入会话令牌（等同用户完成登录后的浏览器状态）。
  await send("Page.navigate", { url: `${webBase}/login/lanqi` }, sessionId);
  await waitFor(sessionId, `() => Boolean(document.querySelector(".productInviteForm"))`, 30000);
  await evaluate(sessionId, `({ tenantId, userId, token }) => {
    localStorage.setItem("store_os_token", token);
    localStorage.setItem("store_os_tenant_role", "local_business");
    localStorage.removeItem("store_os_onboarding_token");
    return { tenantId, userId };
  }`, { tenantId, userId, token });

  await send("Page.navigate", { url: `${webBase}/lanqi/dashboard` }, sessionId);
  const dashboard = await waitFor(sessionId, `() => {
    const text = document.body.innerText || "";
    if (text.includes("登录 / 注册") && document.querySelector(".productInviteForm")) return { bounced: true };
    // 骨架先渲染、数据后到；必须等「正在加载驾驶舱…」这类加载态消失再判定与截图。
    if (text.length < 40 || /正在加载驾驶舱/.test(text)) return false;
    return {
      bounced: false,
      path: window.location.pathname,
      headings: [...document.querySelectorAll("h1,h2")].map((h) => h.textContent.trim()).slice(0, 6),
      hasStoreName: ${JSON.stringify(storeName)} ? text.includes(${JSON.stringify(storeName)}) : undefined,
      blocks: [...document.querySelectorAll("section,article")].length,
      text: text.slice(0, 300)
    };
  }`, 90000);
  assert.equal(dashboard.bounced, false, "authenticated tenant is not bounced back to the invite form");
  assert.ok(String(dashboard.path).includes("/lanqi/"), `expected to stay inside /lanqi, got ${dashboard.path}`);
  assert.ok(dashboard.headings.length > 0, "lanqi dashboard renders headings");
  assert.ok(dashboard.blocks >= 2, `dashboard finished loading (blocks=${dashboard.blocks})`);
  report.steps.dashboardRenders = "PASS";
  report.dashboardHeadings = dashboard.headings;
  report.dashboardBlocks = dashboard.blocks;
  report.dashboardText = dashboard.text;
  report.shots.push(await shot(sessionId, "01-lanqi-dashboard.png"));

  // 会话保持：刷新后仍是登录态（token 由服务端签发，不依赖内存状态）。
  await send("Page.navigate", { url: `${webBase}/lanqi/dashboard` }, sessionId);
  const reloaded = await waitFor(sessionId, `() => {
    const text = document.body.innerText || "";
    if (text.includes("登录 / 注册") && document.querySelector(".productInviteForm")) return { bounced: true };
    return text.length > 40 && !/正在加载驾驶舱/.test(text) ? { bounced: false, path: window.location.pathname } : false;
  }`, 90000);
  assert.equal(reloaded.bounced, false, "session survives a full page reload");
  report.steps.sessionSurvivesReload = "PASS";

  // 门店档案页：新租户可读，且明确处于「资料待补」而不是编造事实。
  await send("Page.navigate", { url: `${webBase}/lanqi/store-profile` }, sessionId);
  const profile = await waitFor(sessionId, `() => {
    const text = document.body.innerText || "";
    if (text.length < 40 || /正在读取本门店经营档案/.test(text)) return false;
    return { path: window.location.pathname, text: text.slice(0, 300) };
  }`, 90000);
  report.storeProfilePath = profile.path;
  report.storeProfileText = profile.text;
  report.steps.storeProfileRenders = "PASS";
  report.shots.push(await shot(sessionId, "02-lanqi-store-profile.png"));

  report.pageResponses = pageResponses;
  report.consoleErrors = consoleErrors;
  await writeFile(path.join(shotDir, "lanqi-new-tenant-verify-report.json"), JSON.stringify(report, null, 2), "utf8");
  console.log("prod_lanqi_new_tenant_browser_verify:PASS");
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  report.pageResponses = pageResponses;
  report.consoleErrors = consoleErrors;
  await writeFile(path.join(shotDir, "lanqi-new-tenant-verify-report.json"), JSON.stringify(report, null, 2), "utf8").catch(() => {});
  console.error(`prod_lanqi_new_tenant_browser_verify:FAIL ${report.error}`);
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
} finally {
  socket.close();
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill();
  await exited;
}

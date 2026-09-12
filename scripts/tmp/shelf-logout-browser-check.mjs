import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// 手机「退出登录并换账号重登」链路验收（2026-09-11）。
//
// 背景：货架页（/agents）此前没有任何退出入口 —— 手机用户用微信登进去以后，
// 想换一个微信号或账号重新登入，没有按钮可点（退出入口只在 /my-ai 和老的店铺流程里）。
// 本轮在货架顶栏加了「退出登录」：清本地会话 + 清运营令牌 + 落回 /login，
// 并在登录成功后回到货架。
//
// 属性：只读页面 + 只点自己新加的退出按钮；不登录、不下单、不改业务数据。
// 用法：SHELF_LOGOUT_URL=https://api.lcppch.top/lanqi-test node scripts/tmp/shelf-logout-browser-check.mjs
const webBase = (process.env.SHELF_LOGOUT_URL ?? "http://127.0.0.1:5174").replace(/\/+$/, "");
const chromePath = process.env.LOGIN_SMOKE_CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
  return condition;
};

async function startChrome() {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "sitong-shelf-logout-"));
  const child = spawn(chromePath, [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-debugging-port=0",
    `--user-data-dir=${userDataDir}`,
    "about:blank"
  ], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });

  const endpoint = await new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error("Chrome DevTools endpoint timeout")), 20_000);
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
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id) return;
    const handler = pending.get(message.id);
    if (!handler) return;
    pending.delete(message.id);
    if (message.error) handler.reject(new Error(message.error.message));
    else handler.resolve(message.result);
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  return { child, socket, send, userDataDir };
}

async function evaluate(cdp, sessionId, declaration) {
  const result = await cdp.send("Runtime.evaluate", { expression: `(${declaration})()`, returnByValue: true, awaitPromise: true }, sessionId);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? "Runtime.evaluate failed");
  return result.result.value;
}

async function waitFor(cdp, sessionId, declaration, timeoutMs = 25_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let value = false;
    try {
      value = await evaluate(cdp, sessionId, declaration);
    } catch (error) {
      if (!/Execution context was destroyed|Cannot find context|Inspected target navigated/i.test(String(error?.message))) throw error;
    }
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`waitFor timeout: ${declaration}`);
    await delay(300);
  }
}

const WECHAT_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.49(0x18003128) NetType/WIFI Language/zh_CN";

async function main() {
  const cdp = await startChrome();
  try {
    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    await cdp.send("Page.enable", {}, sessionId);
    await cdp.send("Runtime.enable", {}, sessionId);
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true }, sessionId);
    await cdp.send("Emulation.setUserAgentOverride", { userAgent: WECHAT_UA }, sessionId);

    await cdp.send("Page.navigate", { url: `${webBase}/agents` }, sessionId);
    await waitFor(cdp, sessionId, `() => document.querySelectorAll(".shelf-head h2").length >= 3`);
    await delay(800);

    const before = await evaluate(cdp, sessionId, `() => {
      const button = document.querySelector(".topbar .logout-link");
      const rect = button ? button.getBoundingClientRect() : null;
      return {
        hasLogout: Boolean(button),
        text: button ? button.textContent.trim() : null,
        visible: Boolean(button) && rect.width > 0 && rect.height > 0 && rect.right <= window.innerWidth + 1,
        tokenBefore: localStorage.getItem("store_os_token") ?? "",
        walletPill: document.querySelector(".topbar .wallet-pill")?.textContent?.trim() ?? null
      };
    }`);
    if (!check(before.hasLogout, "shelf topbar exposes a logout entry for a signed-in visitor")) {
      throw new Error(`no .logout-link rendered; probe=${JSON.stringify(before)}`);
    }
    check(before.text === "退出登录", `logout entry is labelled 退出登录 (got ${JSON.stringify(before.text)})`);
    check(before.visible, "logout entry is tappable inside the phone viewport");
    check(before.tokenBefore.length > 0, "probe starts from a real signed-in session");

    await evaluate(cdp, sessionId, `() => { document.querySelector(".topbar .logout-link").click(); return true; }`);
    await delay(1_500);

    const after = await evaluate(cdp, sessionId, `() => ({
      url: window.location.href,
      tokenAfter: localStorage.getItem("store_os_token") ?? "",
      onboardingToken: localStorage.getItem("store_os_onboarding_token") ?? "",
      adminToken: sessionStorage.getItem("sitong_admin_token") ?? "",
      postLoginRedirect: localStorage.getItem("store_os_post_login_redirect") ?? ""
    })`);

    check(after.tokenAfter === "", `logout clears the session token (got ${JSON.stringify(after.tokenAfter)})`);
    check(after.onboardingToken === "", "logout clears the onboarding token");
    check(after.adminToken === "", "logout clears the in-tab operator token");
    check(/\/agents$/.test(after.postLoginRedirect), `logout remembers to return to the shelf after re-login (got ${JSON.stringify(after.postLoginRedirect)})`);
    check(/\/login(\?|$)/.test(after.url), `logout lands on the login page (got ${after.url})`);

    process.stdout.write(`shelf_logout_before=${JSON.stringify(before)}\n`);
    process.stdout.write(`shelf_logout_after=${JSON.stringify(after)}\n`);
    if (failures.length > 0) throw new Error(`shelf logout regressions (${failures.length}):\n  - ${failures.join("\n  - ")}`);
    process.stdout.write(`shelf_logout_check:PASS url=${webBase}/agents\n`);
  } finally {
    cdp.socket.close();
    const exited = new Promise((resolve) => cdp.child.once("exit", resolve));
    cdp.child.kill();
    await Promise.race([exited, delay(2_000)]);
    await rm(cdp.userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

/**
 * QA-20260911-011 回归：电脑端打开登录页必须能当场扫码登录。
 *
 * 背景：`/login` 的「微信一键登录 / 注册」原来无条件跳
 * `open.weixin.qq.com/connect/oauth2/authorize`，在电脑浏览器里只会看到
 * 「请在微信客户端打开链接」死页 —— 用户无法登录。
 *
 * 这个脚本用真实的 Chrome 跑页面（桌面视口），把 `/auth/wechat-*` 接口在页面内
 * 打成桩，覆盖：
 *   ① 桌面 UA：点按钮 → 出现二维码块（不再跳微信），二维码指向本站 /wechat-bridge；
 *   ② 手机扫码完成后：电脑端轮询拿到结果 → 落 token → 进平台首页；
 *   ③ 二维码过期：给出「二维码已失效」和刷新入口，不让用户卡死；
 *   ④ 微信内置浏览器 UA：仍走原来的直接授权跳转（不能被改坏）。
 *
 * 运行前提：干净的 vite dev（`VITE_DIRECT_TEST_LOGIN=false`），默认 5174。
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const webBase = process.env.LOGIN_SMOKE_WEB_URL ?? "http://127.0.0.1:5174";
const chromePath = process.env.LOGIN_SMOKE_CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const desktopUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const wechatUA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.49(0x18003133) NetType/WIFI Language/zh_CN";
const bridgeSecret = "smoke-secret-0123456789abcdef0123456789";
const loginToken = "smoke-bridge-token";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 二维码是 <img>，不走 window.fetch，因此用 CDP 网络层直接返回一张占位 SVG，
// 既避免真的连一次 3011，也避免图片 404 在控制台留下噪声。
const QR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#ffffff"/></svg>`;
const WECHAT_STUB_HTML = "<!doctype html><html><head><title>wechat-oauth-stub</title></head><body>wechat-oauth-stub</body></html>";

/**
 * 注入到每个新文档最前面：把 `/auth/wechat-*` 全部改成本地桩。
 * 页面里没有真实外呼，所以这个回归不依赖 3011 或真实微信凭据。
 */
const STUB_SCRIPT = `
(() => {
  const state = {
    bridgeStatus: "pending",
    sessionId: "bridge-smoke-id",
    secret: "${bridgeSecret}",
    token: "${loginToken}",
    calls: [],
  };
  window.__wechatSmoke = state;
  const json = (status, body) => new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = typeof input === "string" ? input : (input && input.url) || "";
    let path = "";
    try { path = new URL(url, window.location.origin).pathname; } catch { path = ""; }
    if (!path.includes("/auth/wechat")) return originalFetch(input, init);
    state.calls.push(path);
    if (path.endsWith("/auth/wechat-config")) {
      return Promise.resolve(json(200, { configured: true, appid: "wx-smoke-appid", inviteRequired: false }));
    }
    if (path.endsWith("/auth/wechat-bridge/session")) {
      return Promise.resolve(json(200, { id: state.sessionId, secret: state.secret, ttlSeconds: 300 }));
    }
    if (path.endsWith("/auth/wechat-bridge/status")) {
      if (state.bridgeStatus === "expired") {
        return Promise.resolve(json(410, { error: "wechat_bridge_expired", message: "登录二维码已失效，请回到电脑刷新二维码后重新扫码。" }));
      }
      if (state.bridgeStatus === "completed") {
        return Promise.resolve(json(200, {
          state: "completed",
          ok: true,
          statusCode: 200,
          login: {
            token: state.token,
            tenantId: "tenant-smoke",
            userId: "user-smoke",
            tenantName: "扫码登录验收工作区",
            plan: { planCode: "local_standard" },
            dataMode: "database",
            diagnosisRequired: true,
          },
        }));
      }
      return Promise.resolve(json(200, { state: "pending" }));
    }
    return Promise.resolve(json(404, { error: "not_stubbed", path }));
  };
})();
`;

async function startChrome() {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "login-wechat-qr-chrome-"));
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
  const pageErrors = [];
  const sessions = new Set();
  const eventHandlers = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id) {
      if (message.method === "Runtime.exceptionThrown") {
        pageErrors.push(message.params?.exceptionDetails?.exception?.description ?? "runtime exception");
      }
      if (message.method === "Runtime.consoleAPICalled" && message.params?.type === "error" && sessions.has(message.sessionId)) {
        pageErrors.push((message.params.args ?? []).map((arg) => arg.value ?? arg.description ?? "").join(" "));
      }
      for (const handler of eventHandlers.get(message.method) ?? []) {
        handler(message.params, message.sessionId);
      }
      return;
    }
    const handler = pending.get(message.id);
    if (!handler) return;
    pending.delete(message.id);
    if (message.error) handler.reject(new Error(message.error.message));
    else handler.resolve(message.result);
  });

  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject, method });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });

  const on = (eventName, handler) => {
    const handlers = eventHandlers.get(eventName) ?? [];
    handlers.push(handler);
    eventHandlers.set(eventName, handlers);
  };

  return { child, socket, send, on, userDataDir, pageErrors, sessions };
}

async function evaluate(cdp, sessionId, functionDeclaration, argument) {
  const expression = argument === undefined ? `(${functionDeclaration})()` : `(${functionDeclaration})(${JSON.stringify(argument)})`;
  const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (result.exceptionDetails) {
    const detail = result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? "Runtime.evaluate failed";
    throw new Error(detail);
  }
  return result.result.value;
}

async function waitFor(cdp, sessionId, functionDeclaration, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let value;
    try {
      value = await evaluate(cdp, sessionId, functionDeclaration);
    } catch (error) {
      if (!/Execution context was destroyed|Cannot find context|Inspected target navigated/i.test(error instanceof Error ? error.message : String(error))) {
        throw error;
      }
      value = false;
    }
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`waitFor timeout: ${functionDeclaration}`);
    await delay(250);
  }
}

function fulfill(cdp, requestId, { status, body, contentType }, sessionId) {
  return cdp.send("Fetch.fulfillRequest", {
    requestId,
    responseCode: status,
    responseHeaders: [{ name: "Content-Type", value: contentType }],
    body: Buffer.from(body, "utf8").toString("base64")
  }, sessionId);
}

async function openPage(cdp, { userAgent, width, height, mobile }) {
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  cdp.sessions.add(sessionId);
  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send("Runtime.enable", {}, sessionId);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile }, sessionId);
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: STUB_SCRIPT }, sessionId);
  await cdp.send("Emulation.setUserAgentOverride", { userAgent }, sessionId);
  return sessionId;
}

async function main() {
  const cdp = await startChrome();

  try {
    // 二维码图片与微信授权页只在网络层挡一次，页面里不会有真实外呼。
    await cdp.send("Fetch.enable", {
      patterns: [
        { urlPattern: "*wechat-bridge/qrcode*", requestStage: "Request" },
        { urlPattern: "*open.weixin.qq.com*", requestStage: "Request" }
      ]
    });
    cdp.on("Fetch.requestPaused", (params, eventSessionId) => {
      const url = params.request?.url ?? "";
      const payload = url.includes("open.weixin.qq.com")
        ? { status: 200, body: WECHAT_STUB_HTML, contentType: "text/html; charset=utf-8" }
        : { status: 200, body: QR_SVG, contentType: "image/svg+xml; charset=utf-8" };
      void fulfill(cdp, params.requestId, payload, eventSessionId).catch(() => {});
    });

    // 0. 桌面 UA 打开登录页：必须给出可点的微信入口。
    const sessionId = await openPage(cdp, { userAgent: desktopUA, width: 1440, height: 1000, mobile: false });
    await cdp.send("Page.navigate", { url: `${webBase}/login` }, sessionId);
    await waitFor(cdp, sessionId, `() => document.body.innerText.includes("登录 / 注册")`);
    await waitFor(cdp, sessionId, `() => {
      const button = document.querySelector(".wechatLoginBtn");
      return Boolean(button && button.textContent.includes("微信一键登录"));
    }`);

    // 1. 点按钮 → 当场出二维码，不离开 /login，也不再跳 open.weixin.qq.com。
    await evaluate(cdp, sessionId, `() => { document.querySelector(".wechatLoginBtn").click(); return true; }`);
    const qrInfo = await waitFor(cdp, sessionId, `() => {
      const block = document.querySelector('[data-wechat-qr="pending"]');
      const image = document.querySelector(".wechatQrImage");
      if (!block || !image) return false;
      return {
        blockText: block.innerText,
        src: image.getAttribute("src") ?? "",
        path: window.location.pathname,
        calls: window.__wechatSmoke.calls.slice(),
        href: window.location.href,
      };
    }`);

    assert.doesNotMatch(qrInfo.path, /wechat-callback/, "desktop click must not bounce through the wechat callback");
    assert.doesNotMatch(qrInfo.href, /open\.weixin\.qq\.com/, "desktop click must not open the wechat client-only page");
    assert.match(qrInfo.blockText, /请用微信扫这个码登录/, "desktop login shows the scan prompt");
    assert.match(qrInfo.blockText, /等待扫码授权/, "desktop login shows the waiting state");
    assert.ok(qrInfo.calls.some((call) => call.endsWith("/auth/wechat-bridge/session")), "desktop click creates one bridge session");

    const qrRequest = new URL(qrInfo.src, webBase);
    assert.ok(qrRequest.pathname.endsWith("/auth/wechat-bridge/qrcode"), `qr image endpoint unexpected: ${qrInfo.src}`);
    const scanUrl = new URL(qrRequest.searchParams.get("u") ?? "");
    const loginUrl = new URL(webBase);
    assert.ok(scanUrl.pathname.endsWith("/wechat-bridge"), `qr must point at the bridge page: ${scanUrl.pathname}`);
    assert.equal(scanUrl.host, loginUrl.host, "qr must point at the same host the user is on");
    assert.equal(scanUrl.searchParams.get("b"), "bridge-smoke-id", "qr carries the bridge session id");
    assert.equal(scanUrl.searchParams.get("s"), bridgeSecret, "qr carries the one-time secret");

    // 2. 手机授权完成 → 电脑端轮询取到结果并完成登录。
    const errorsBeforeLogin = cdp.pageErrors.length;
    await evaluate(cdp, sessionId, `() => { window.__wechatSmoke.bridgeStatus = "completed"; return true; }`);
    const loggedInPath = await waitFor(cdp, sessionId, `() => {
      const segments = window.location.pathname.split("/").filter(Boolean);
      return segments[segments.length - 1] === "agents" ? window.location.href : "";
    }`, 25_000);
    assert.ok(loggedInPath, "desktop auto-login lands on the platform home");
    const bridgeToken = await evaluate(cdp, sessionId, `() => localStorage.getItem("store_os_token") ?? ""`);
    assert.equal(bridgeToken, loginToken, "desktop login persists the token handed over by the phone");

    // 3. 二维码过期：必须留在登录页并给出刷新入口（不能被清空成空白）。
    const expiredSession = await openPage(cdp, { userAgent: desktopUA, width: 1440, height: 1000, mobile: false });
    await cdp.send("Page.navigate", { url: `${webBase}/login` }, expiredSession);
    await waitFor(cdp, expiredSession, `() => Boolean(document.querySelector(".wechatLoginBtn"))`);
    await evaluate(cdp, expiredSession, `() => {
      window.__wechatSmoke.bridgeStatus = "expired";
      document.querySelector(".wechatLoginBtn").click();
      return true;
    }`);
    const expiredText = await waitFor(cdp, expiredSession, `() => {
      const block = document.querySelector('[data-wechat-qr="expired"]');
      return block ? block.innerText : false;
    }`, 25_000);
    assert.match(expiredText, /二维码已失效/, "expired qr is reported to the user");
    assert.match(expiredText, /刷新二维码/, "expired qr keeps a refresh affordance");
    assert.equal(
      await evaluate(cdp, expiredSession, `() => document.querySelector('[data-wechat-qr="expired"] .wechatQrImage') !== null`),
      false,
      "expired qr is not left on screen to be scanned"
    );

    // 4. 微信内置浏览器仍然是原来的直接授权跳转（这条链路不能被改坏）。
    const inAppSession = await openPage(cdp, { userAgent: wechatUA, width: 390, height: 844, mobile: true });
    await cdp.send("Page.navigate", { url: `${webBase}/login` }, inAppSession);
    await waitFor(cdp, inAppSession, `() => Boolean(document.querySelector(".wechatLoginBtn"))`);
    await evaluate(cdp, inAppSession, `() => { document.querySelector(".wechatLoginBtn").click(); return true; }`);
    const inAppHref = await waitFor(cdp, inAppSession, `() => window.location.href.includes("open.weixin.qq.com") ? window.location.href : ""`, 25_000);
    assert.match(inAppHref, /connect\/oauth2\/authorize/, "wechat in-app browser still redirects to the oauth authorize page");
    assert.match(inAppHref, /appid=wx-smoke-appid/, "in-app redirect keeps the configured appid");
    assert.equal(
      await evaluate(cdp, inAppSession, `() => document.querySelector(".wechatQrImage") !== null`),
      false,
      "wechat in-app browser must not fall back to the qr code"
    );

    const realErrors = cdp.pageErrors
      .slice(0, errorsBeforeLogin)
      .filter((entry) => !/favicon|Download the React DevTools/i.test(entry));
    assert.deepEqual(realErrors, [], `console must stay clean before login: ${realErrors.join(" | ")}`);

    process.stdout.write("login_wechat_qr_browser_smoke:PASS desktop_qr=PASS qr_target=PASS auto_login=PASS expired_refresh=PASS in_app_redirect=PASS\n");
  } finally {
    cdp.socket.close();
    const exited = new Promise((resolve) => cdp.child.once("exit", resolve));
    cdp.child.kill();
    await Promise.race([exited, delay(2_000)]);
    await rm(cdp.userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});

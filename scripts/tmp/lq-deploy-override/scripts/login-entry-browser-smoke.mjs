import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const webBase = process.env.LOGIN_SMOKE_WEB_URL ?? "http://127.0.0.1:5174";
const chromePath = process.env.LOGIN_SMOKE_CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 注册/开通工作区在后端是邀请制：这里先准备一个本地邀请码，让浏览器流程与生产一致。
function loadLocalEnv() {
  if (typeof process.loadEnvFile !== "function") return;
  try {
    process.loadEnvFile(path.resolve(process.cwd(), ".env"));
  } catch {
    // 没有 .env 时交给脚本自身报错，不吞掉真实失败。
  }
}

function prepareInviteCode() {
  if (!process.env.DATABASE_URL) return "";
  const code = `loginsmoke${Date.now().toString(36)}`;
  const result = spawnSync(process.execPath, ["scripts/create-beta-invite.mjs", "--code", code, "--max-uses", "5"], {
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env
  });
  if (result.status !== 0) {
    throw new Error(`create-beta-invite failed: ${result.stderr?.toString() ?? result.status}`);
  }
  return code;
}

async function startChrome() {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "login-entry-chrome-"));
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
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id) {
      if (message.method === "Runtime.exceptionThrown") {
        pageErrors.push(message.params?.exceptionDetails?.exception?.description ?? "runtime exception");
      }
      if (message.method === "Runtime.consoleAPICalled" && message.params?.type === "error" && sessions.has(message.sessionId)) {
        pageErrors.push((message.params.args ?? []).map((arg) => arg.value ?? arg.description ?? "").join(" "));
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

  return { child, socket, send, userDataDir, pageErrors, sessions };
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

async function waitFor(cdp, sessionId, functionDeclaration, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    // 页面导航期间执行上下文会被销毁，这里按等待语义重试而不当成失败。
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

async function main() {
  loadLocalEnv();
  const inviteCode = prepareInviteCode();
  const cdp = await startChrome();

  try {
    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    cdp.sessions.add(sessionId);
    await cdp.send("Page.enable", {}, sessionId);
    await cdp.send("Runtime.enable", {}, sessionId);
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false }, sessionId);

    // 0. 预检：本机 `vite dev` 会默认加载 apps/web/.env.development.local 里的
    //    VITE_DIRECT_TEST_LOGIN=true，那种「内测免登录」实例会自动建立会话并把入口
    //    直达兰琪工作台，登录/注册回归在上面根本不成立。这里必须先给出明确的环境
    //    错误，而不是让后面的断言超时成「登录坏了」的假象。
    await cdp.send("Page.navigate", { url: `${webBase}/` }, sessionId);
    const entryState = await waitFor(cdp, sessionId, `() => {
      const text = document.body.innerText;
      const autoSession = Boolean(localStorage.getItem("store_os_token"));
      if (autoSession || /内测实例|正在进入体验工作区|体验入口暂时打不开/.test(text)) {
        return { directTest: true, path: window.location.pathname, autoSession };
      }
      if (window.location.pathname.split("/").filter(Boolean).pop() === "market" && text.includes("货架")) {
        return { directTest: false, path: window.location.pathname, autoSession };
      }
      return false;
    }`, 15_000);
    if (entryState.directTest) {
      throw new Error([
        `环境错误：${webBase} 是「内测免登录」实例，登录/注册回归必须跑在干净实例上。`,
        `实测 path=${entryState.path}，自动建立会话=${entryState.autoSession}。`,
        "原因：apps/web/.env.development.local 的 VITE_DIRECT_TEST_LOGIN=true 会被 vite dev 默认加载。",
        '处理：$env:VITE_DIRECT_TEST_LOGIN="false"; pnpm.cmd --filter @baolu/web dev --port 5178 --strictPort',
        '      然后 $env:LOGIN_SMOKE_WEB_URL="http://127.0.0.1:5178"; pnpm.cmd auth:login-entry-browser-smoke'
      ].join("\n"));
    }

    // 1. 根路径必须落到平台首页（货架），不再进入旧的单品落地页。
    const lastSegment = `() => window.location.pathname.split("/").filter(Boolean).pop() === "market"`;
    await waitFor(cdp, sessionId, lastSegment);
    await waitFor(cdp, sessionId, `() => document.body.innerText.includes("货架")`);
    const homeText = await evaluate(cdp, sessionId, `() => document.body.innerText`);
    assert.match(homeText, /行业智能体平台/, "platform home shows platform brand");
    assert.match(homeText, /货架/, "platform home renders the shelf");
    assert.match(homeText, /未登录/, "anonymous visitor is prompted to log in");

    // 2. 未登录访问 /login 必须看到平台登录/注册页，而不是旧的单点诊断流程。
    await cdp.send("Page.navigate", { url: `${webBase}/login` }, sessionId);
    await waitFor(cdp, sessionId, `() => document.body.innerText.includes("登录 / 注册")`);
    // 登录方式要等 wechat-config 返回后才定型，先等它稳定再断言文案。
    await waitFor(cdp, sessionId, `() => {
      const text = document.body.innerText;
      return text.includes("微信一键登录 / 注册") || text.includes("进入思潼");
    }`);
    const loginText = await evaluate(cdp, sessionId, `() => document.body.innerText`);
    assert.match(loginText, /思潼AI 行业智能体平台/, "login page shows platform name");
    assert.match(loginText, /微信一键登录 \/ 注册|进入思潼\s*AI\s*智能体平台/, "login page offers a way in");
    assert.match(loginText, /一个账号、一个积分钱包/, "login page explains the shared wallet");
    assert.doesNotMatch(loginText, /单项快速诊断/, "login page is not the legacy diagnosis flow");

    // 2b. 微信首次授权后的「完成注册」步骤必须在同一个页面里，不跳去别处。
    await evaluate(cdp, sessionId, `() => localStorage.setItem("store_os_onboarding_token", "smoke-onboarding-token")`);
    await cdp.send("Page.navigate", { url: `${webBase}/login` }, sessionId);
    await waitFor(cdp, sessionId, `() => document.body.innerText.includes("完成注册，开通你的工作区")`);
    const signupText = await evaluate(cdp, sessionId, `() => document.body.innerText`);
    assert.match(signupText, /完成注册并进入平台/, "first-time wechat signup exposes its own submit action");
    assert.match(signupText, /不是这个微信号？重新授权/, "first-time wechat signup lets the user switch account");
    assert.match(signupText, /邀请码/, "signup asks for the invite code required by the workspace");
    await evaluate(cdp, sessionId, `() => localStorage.removeItem("store_os_onboarding_token")`);

    // 3. 走完一次真实注册/开通：补资料 -> 建工作区 -> 落到平台首页并显示余额。
    await cdp.send("Page.navigate", { url: `${webBase}/login` }, sessionId);
    await waitFor(cdp, sessionId, `() => document.body.innerText.includes("登录 / 注册")`);
    const openedForm = await evaluate(cdp, sessionId, `() => {
      if (document.querySelector(".loginForm form")) return true;
      const link = [...document.querySelectorAll("button")].find((item) => item.textContent.includes("使用邀请码开通"));
      if (!link) return false;
      link.click();
      return true;
    }`);
    assert.ok(openedForm, "invite-code entry is reachable from the platform login page");
    await waitFor(cdp, sessionId, `() => document.querySelectorAll(".loginForm form input").length >= 2`);
    await evaluate(cdp, sessionId, `(values) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      document.querySelectorAll(".loginForm form input").forEach((input, index) => {
        setter.call(input, values[index] ?? "");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    }`, ["思潼AI 登录闭环验收工作区", inviteCode]);
    const submitLabel = await evaluate(cdp, sessionId, `() => document.querySelector(".loginSubmit")?.textContent ?? ""`);
    const submitted = await evaluate(cdp, sessionId, `() => {
      window.__loginSmokeSubmits = 0;
      document.addEventListener("submit", () => { window.__loginSmokeSubmits += 1; }, true);
      const button = document.querySelector(".loginSubmit");
      if (!button) return false;
      button.click();
      return true;
    }`);
    assert.ok(submitted, `platform login page exposes the workspace submit button (label=${submitLabel})`);
    const reachedHome = await waitFor(cdp, sessionId, lastSegment, 20_000).catch(async (error) => {
      const text = await evaluate(cdp, sessionId, `() => document.body.innerText`).catch(() => "<unavailable>");
      const debug = await evaluate(cdp, sessionId, `() => ({
        url: window.location.href,
        token: localStorage.getItem("store_os_token"),
        submits: window.__loginSmokeSubmits ?? null,
        tenantNameValue: document.querySelector(".loginForm form input")?.value ?? null,
        requests: performance.getEntriesByType("resource").map((entry) => entry.name).filter((name) => name.includes("/auth/"))
      })`).catch(() => null);
      throw new Error(`${error.message}\n--- page text ---\n${text}\n--- debug ---\n${JSON.stringify(debug)}`);
    });
    assert.ok(reachedHome, "signup lands on the platform home");
    const token = await evaluate(cdp, sessionId, `() => localStorage.getItem("store_os_token") ?? ""`);
    assert.ok(token, "workspace login persists the session token");
    const balanceText = await waitFor(cdp, sessionId, `() => {
      const pill = document.querySelector(".wallet-pill");
      return pill && pill.innerText.includes("积分") ? pill.innerText : "";
    }`, 15_000);
    assert.doesNotMatch(balanceText, /未登录/, "logged-in visitor sees the shared wallet instead of a login prompt");

    // 4. 已有会话访问 /login 直接回平台首页，不再落进旧诊断流程。
    await cdp.send("Page.navigate", { url: `${webBase}/login` }, sessionId);
    await waitFor(cdp, sessionId, lastSegment);

    const realErrors = cdp.pageErrors.filter((entry) => !/favicon|Download the React DevTools/i.test(entry));
    assert.deepEqual(realErrors, [], `console must stay clean: ${realErrors.join(" | ")}`);

    process.stdout.write("login_entry_browser_smoke:PASS root_to_home=PASS login_page=PASS signup_to_home=PASS wallet_visible=PASS session_redirect=PASS console_clean=PASS\n");
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

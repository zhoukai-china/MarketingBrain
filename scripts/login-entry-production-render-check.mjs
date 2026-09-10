import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// 只读验收：确认线上根路径落到平台首页、/login 是平台登录/注册页。
// 这里不填写任何表单、不调用开通接口，因此不会在生产写入账号或工作区。
const webBase = process.env.PROD_LOGIN_CHECK_URL ?? "https://api.lcppch.top/os-v2";
const chromePath = process.env.LOGIN_SMOKE_CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function startChrome() {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "prod-login-check-"));
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

async function waitFor(cdp, sessionId, functionDeclaration, timeoutMs = 20_000) {
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
    await delay(300);
  }
}

async function main() {
  const cdp = await startChrome();
  try {
    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    cdp.sessions.add(sessionId);
    await cdp.send("Page.enable", {}, sessionId);
    await cdp.send("Runtime.enable", {}, sessionId);
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false }, sessionId);

    // 1. 生产根路径必须落到平台首页（货架），而不是旧的单品落地页。
    await cdp.send("Page.navigate", { url: `${webBase}/` }, sessionId);
    await waitFor(cdp, sessionId, `() => window.location.pathname.split("/").filter(Boolean).pop() === "market"`);
    await waitFor(cdp, sessionId, `() => document.body.innerText.includes("货架")`);
    const homeText = await evaluate(cdp, sessionId, `() => document.body.innerText`);
    assert.match(homeText, /行业智能体平台/, "production home shows platform brand");
    assert.match(homeText, /未登录/, "anonymous visitor is prompted to log in");
    const homeUrl = await evaluate(cdp, sessionId, `() => window.location.href`);

    // 2. 生产 /login 必须是平台登录/注册页，且没有任何历史诊断入口残留。
    await cdp.send("Page.navigate", { url: `${webBase}/login` }, sessionId);
    await waitFor(cdp, sessionId, `() => document.body.innerText.includes("登录 / 注册")`);
    await waitFor(cdp, sessionId, `() => {
      const text = document.body.innerText;
      return text.includes("微信一键登录 / 注册") || text.includes("进入思潼");
    }`);
    const loginText = await evaluate(cdp, sessionId, `() => document.body.innerText`);
    assert.match(loginText, /思潼AI 行业智能体平台/, "login page shows the platform name");
    assert.match(loginText, /一个账号、一个积分钱包/, "login page explains the shared wallet");
    assert.match(loginText, /使用邀请码开通/, "login page keeps the invite-code fallback");
    assert.doesNotMatch(loginText, /单项快速诊断/, "login page is not the legacy diagnosis flow");
    assert.doesNotMatch(loginText, /扣点|人民币|订阅|免费试用/, "login page avoids off-policy wording");

    // 3. 线上旧链接不能 404（历史入口仍可用）。
    for (const legacyPath of ["/diagnosis", "/terms", "/privacy"]) {
      await cdp.send("Page.navigate", { url: `${webBase}${legacyPath}` }, sessionId);
      const status = await waitFor(cdp, sessionId, `() => document.body.innerText.trim().length > 0 ? "ok" : ""`);
      assert.equal(status, "ok", `legacy path ${legacyPath} still renders`);
    }

    const realErrors = cdp.pageErrors.filter((entry) => !/favicon|Download the React DevTools/i.test(entry));
    assert.deepEqual(realErrors, [], `console must stay clean: ${realErrors.join(" | ")}`);

    process.stdout.write(
      "login_entry_production_render_check:PASS"
      + ` home_url=${homeUrl}`
      + " root_to_home=PASS"
      + " login_page=PASS"
      + " legacy_paths=PASS"
      + " console_clean=PASS\n"
    );
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

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const webBase = process.env.RECHARGE_WEB_URL ?? "http://127.0.0.1:5174";
const apiBase = process.env.RECHARGE_API_URL ?? "http://127.0.0.1:3011";
const chromePath = process.env.RECHARGE_CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function createTenant() {
  const response = await fetch(`${apiBase}/auth/dev-login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      tenantRole: "local_business",
      tenantName: "充值页浏览器验收租户",
      planCode: "local_standard"
    })
  });
  const body = await response.json();
  assert.equal(response.status, 200, `dev-login failed: ${JSON.stringify(body)}`);
  assert.ok(body.token, "dev-login did not return token");
  return body.token;
}

async function startChrome() {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "recharge-chrome-"));
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
    pending.set(id, { resolve, reject, method });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });

  return { child, socket, send, userDataDir };
}

async function evaluate(cdp, sessionId, functionDeclaration, argument) {
  const expression = argument === undefined ? `(${functionDeclaration})()` : `(${functionDeclaration})(${JSON.stringify(argument)})`;
  const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text ?? "Runtime.evaluate failed");
  }
  return result.result.value;
}

async function main() {
  const token = await createTenant();
  const cdp = await startChrome();

  try {
    const { targetId } = await cdp.send("Target.createTarget", { url: `${webBase}/` });
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    await cdp.send("Page.enable", {}, sessionId);
    await cdp.send("Runtime.enable", {}, sessionId);
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false }, sessionId);
    await delay(1200);
    await evaluate(cdp, sessionId, `(value) => { localStorage.setItem("store_os_token", value); }`, token);

    await cdp.send("Page.navigate", { url: `${webBase}/recharge?from=workbuddy&skill=beauty_business_qa` }, sessionId);
    await delay(2500);

    const text = await evaluate(cdp, sessionId, `() => document.body.innerText`);
    assert.match(text, /积分钱包/, "recharge page renders wallet heading");
    assert.match(text, /WorkBuddy 来源/, "workbuddy source banner is visible");
    assert.match(text, /体验积分包 · ¥30 = 300 积分/, "pack amount matches shared credit packs");
    assert.match(text, /行业智能体/, "industry agent section is visible");
    assert.match(text, /订阅不会进入积分钱包/, "subscription exclusion is stated");
    assert.doesNotMatch(text, /扣点/, "banned 扣点 copy is absent");

    await evaluate(cdp, sessionId, `() => { const button = [...document.querySelectorAll("button")].find((item) => item.textContent.includes("生成访问令牌")); if (button) button.click(); }`);
    await delay(1500);
    const afterToken = await evaluate(cdp, sessionId, `() => document.body.innerText`);
    assert.match(afterToken, /访问令牌已生成/, "access token creation succeeds");
    assert.match(afterToken, /sitong_bat_/, "access token is revealed once");

    // Verify the login redirect keeps the workbuddy query intact.
    await evaluate(cdp, sessionId, `() => localStorage.removeItem("store_os_token")`);
    await cdp.send("Page.navigate", { url: `${webBase}/recharge?from=workbuddy&skill=takeaway_growth` }, sessionId);
    await delay(1600);
    const redirect = await evaluate(cdp, sessionId, `() => localStorage.getItem("store_os_post_login_redirect")`);
    assert.match(redirect ?? "", /recharge\?from=workbuddy&skill=takeaway_growth/, "login redirect preserves source and skill query");

    process.stdout.write("recharge_browser_smoke:PASS desktop=PASS access_token=PASS login_redirect_query=PASS\n");
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

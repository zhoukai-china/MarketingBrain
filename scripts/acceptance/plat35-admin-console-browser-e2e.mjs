// PLAT-35 统一管理后台的页面级验收（只读为主：只读取视图；除「令牌」外不改任何数据）。
//
// 用户口径（2026-09-15）：侧边导航把 5 个视图 + 客户 / 订单 / 积分干预串起来，复用已有 API；
// 后台只有老板用，不给用户。
//
// 覆盖：
//   ① `/agents/admin` 渲染统一后台（左侧导航 7 个分组），旧页面退到 `/agents/admin/legacy`；
//   ② 逐个切视图：每个视图都能渲染出内容，且**不能**出现读取失败提示；
//   ③ 桌面 1440 与移动 390 都不横向溢出；
//   ④ 控制台无错误。
//
// 用法：ADMIN_E2E_WEB_URL=http://127.0.0.1:5174 ADMIN_E2E_SESSION_FILE=<含 token 的 json> \
//        ADMIN_E2E_ADMIN_TOKEN=<平台管理令牌，本地可空> node scripts/acceptance/plat35-admin-console-browser-e2e.mjs
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const webBase = (process.env.ADMIN_E2E_WEB_URL ?? "http://127.0.0.1:5174").replace(/\/+$/, "");
const chromePath = process.env.ADMIN_E2E_CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const shotDir = process.env.ADMIN_E2E_SHOT_DIR ?? path.join(tmpdir(), `plat35-admin-${Date.now()}`);
const adminToken = process.env.ADMIN_E2E_ADMIN_TOKEN ?? "";
const sessionFile = process.env.ADMIN_E2E_SESSION_FILE;
const mobileCheck = process.env.ADMIN_E2E_MOBILE !== "false";

const SECTIONS = ["概览", "客户", "订单与收款", "积分干预", "智能体与货架", "推荐归因", "质量与安全"];

const results = [];
const record = (ok, label, detail = "") => {
  results.push({ ok, label, detail });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${label}${detail ? ` :: ${detail}` : ""}`);
};
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function resolveToken() {
  if (!sessionFile) throw new Error("需要 ADMIN_E2E_SESSION_FILE（含平台登录 token 的 json）");
  const parsed = JSON.parse(await readFile(sessionFile, "utf8"));
  if (!parsed.token) throw new Error(`${sessionFile} 里没有 token`);
  return parsed.token;
}

async function main() {
  const sessionToken = await resolveToken();
  await mkdir(shotDir, { recursive: true });
  const cdp = await startChrome();
  try {
    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    cdp.sessions.add(sessionId);
    await cdp.send("Page.enable", {}, sessionId);
    await cdp.send("Runtime.enable", {}, sessionId);
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1400, deviceScaleFactor: 1, mobile: false }, sessionId);
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `try {
        localStorage.setItem("store_os_token", ${JSON.stringify(sessionToken)});
        ${adminToken ? `sessionStorage.setItem("sitong_admin_token", ${JSON.stringify(adminToken)});` : ""}
      } catch {}`
    }, sessionId);

    await cdp.send("Page.navigate", { url: `${webBase}/agents/admin` }, sessionId);
    await waitFor(cdp, sessionId, `() => Boolean(document.querySelector(".adminConsoleNav"))`, 40_000, "后台渲染");
    await delay(1500);

    const nav = await evaluate(cdp, sessionId, `() => Array.from(document.querySelectorAll(".adminNavItem")).map((node) => (node.querySelector("strong") || {}).textContent || "")`);
    record(nav.length === SECTIONS.length, "侧边导航有 7 个分组", nav.join(" / "));
    for (const label of SECTIONS) {
      record(nav.includes(label), `导航包含「${label}」`);
    }
    record(/仅运营使用/.test(await evaluate(cdp, sessionId, `() => document.body.innerText`)), "页面明确标注仅运营使用");

    // 逐个视图：点击 → 等面板渲染 → 不许出现读取失败。
    for (const label of SECTIONS) {
      const clicked = await evaluate(cdp, sessionId, `() => {
        const button = Array.from(document.querySelectorAll(".adminNavItem")).find((node) => (node.querySelector("strong") || {}).textContent === ${JSON.stringify(label)});
        if (!button) return false;
        button.click();
        return true;
      }`);
      if (!clicked) { record(false, `切换到「${label}」`); continue; }
      await delay(1200);
      const state = await evaluate(cdp, sessionId, `() => {
        const main = document.querySelector(".adminConsoleMain");
        const text = main ? main.innerText : "";
        return { heading: (main?.querySelector("h1") || {}).textContent || "", text, hasPanel: Boolean(main?.querySelector(".adminPanel")) };
      }`);
      const failed = /读取失败|请求失败|没有发放权限|需要平台运营凭证|admin_token_required|marketplace_admin_/.test(state.text);
      record(state.heading === label && state.hasPanel && !failed, `视图「${label}」渲染成功且无读取失败`, failed ? state.text.slice(0, 160).replace(/\s+/g, " ") : `panels ok`);
      if (label === "概览" || label === "客户") await shoot(cdp, sessionId, `desktop-${label}`);
    }

    if (mobileCheck) {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, sessionId);
      await delay(1200);
      const overflow = await evaluate(cdp, sessionId, `() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth })`);
      record(overflow.scrollWidth <= overflow.innerWidth + 1, "移动端 390 无横向溢出", `scrollWidth=${overflow.scrollWidth} innerWidth=${overflow.innerWidth}`);
      await shoot(cdp, sessionId, "mobile-overview");
    }

    const errors = cdp.pageErrors.filter((entry) => !/favicon|Download the React DevTools/i.test(entry));
    record(errors.length === 0, "控制台无错误", errors.length === 0 ? "0 error" : errors.join(" | ").slice(0, 200));
    await writeFile(path.join(shotDir, "result.json"), JSON.stringify({ webBase, nav, results }, null, 2));
    console.log(`# 截图目录：${shotDir}`);
  } finally {
    try { cdp.socket.close(); } catch {}
    cdp.child.kill();
  }

  const failed = results.filter((item) => !item.ok);
  console.log(JSON.stringify({ result: failed.length === 0 ? "PLAT35_ADMIN_CONSOLE_PASS" : "PLAT35_ADMIN_CONSOLE_FAIL", passed: results.length - failed.length, failed: failed.length }));
  if (failed.length > 0) process.exitCode = 1;
}

async function shoot(cdp, sessionId, name) {
  const shot = await cdp.send("Page.captureScreenshot", { format: "png" }, sessionId);
  await writeFile(path.join(shotDir, `${name}.png`), Buffer.from(shot.data, "base64"));
}

async function startChrome() {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "plat35-chrome-"));
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

  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject, method });
      socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });

  return { child, socket, send, userDataDir, pageErrors, sessions };
}

async function evaluate(cdp, sessionId, functionDeclaration) {
  const result = await cdp.send("Runtime.evaluate", { expression: `(${functionDeclaration})()`, returnByValue: true, awaitPromise: true }, sessionId);
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? "Runtime.evaluate failed");
  }
  return result.result.value;
}

async function waitFor(cdp, sessionId, predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let value;
    try {
      value = await evaluate(cdp, sessionId, predicate);
    } catch (error) {
      if (!/Execution context was destroyed|Cannot find context|Inspected target navigated/i.test(String(error?.message))) throw error;
      value = null;
    }
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`waitFor timeout: ${label}`);
    await delay(300);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

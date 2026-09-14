// PLAT-34 统一注册链接的页面级验收（只读，不注册、不写数据）。
//
// 用户口径（2026-09-15）：兰琪入口保留邀请码，其他入口/统一链接（`/login?ref=…`）直接注册。
// 覆盖：
//   ① `/login?ref=…` 只给「微信一键登录 / 注册」，没有邀请码输入框，且显示已识别推荐码；
//   ② `/login/lanqi` 仍然要求产品邀请码（输入框必填 + 微信通道并存）；
//   ③ `/login/beauty-industry`、`/login/founder-ip`、`/login/takeaway` 不再出现邀请码表单，
//      直接进入工作区资料表单；
//   ④ 每个入口控制台无错误。
//
// 用法：PLAT34_WEB_URL=https://api.lcppch.top/lanqi-test node scripts/acceptance/plat34-unified-login-browser-e2e.mjs
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const webBase = (process.env.PLAT34_WEB_URL ?? "http://127.0.0.1:5174").replace(/\/+$/, "");
const chromePath = process.env.PLAT34_CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const shotDir = process.env.PLAT34_SHOT_DIR ?? path.join(tmpdir(), `plat34-login-${Date.now()}`);
const referralCode = process.env.PLAT34_REF_CODE ?? "ref-acceptance-demo";

const results = [];
const record = (ok, label, detail = "") => {
  results.push({ ok, label, detail });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${label}${detail ? ` :: ${detail}` : ""}`);
};
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const PAGE_STATE = `() => {
  const inputs = Array.from(document.querySelectorAll("input")).map((node) => node.placeholder || node.name || node.type);
  const buttons = Array.from(document.querySelectorAll("button")).map((node) => (node.textContent || "").trim());
  return { pathname: window.location.pathname + window.location.search, text: document.body ? document.body.innerText : "", inputs, buttons };
}`;

async function main() {
  await mkdir(shotDir, { recursive: true });
  const cdp = await startChrome();
  try {
    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    cdp.sessions.add(sessionId);
    await cdp.send("Page.enable", {}, sessionId);
    await cdp.send("Runtime.enable", {}, sessionId);
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1200, deviceScaleFactor: 1, mobile: false }, sessionId);

    console.log(`# PLAT-34 unified login browser e2e :: ${webBase}`);

    // ① 对外统一链接：直接注册，不需要邀请码。
    const generic = await open(cdp, sessionId, `/login?ref=${encodeURIComponent(referralCode)}`);
    record(/微信一键登录 \/ 注册/.test(generic.text), "统一链接提供「微信一键登录 / 注册」", generic.pathname);
    record(!/产品邀请码/.test(generic.text), "统一链接不再出现邀请码表单");
    record(!generic.inputs.some((item) => /邀请码/.test(item)), "统一链接没有邀请码输入框", generic.inputs.join(" | ").slice(0, 80));
    record(/推荐码/.test(generic.text), "统一链接识别并展示推荐码", referralCode);
    await shoot(cdp, sessionId, "01-generic-with-ref");

    // ② 兰琪：仍然要邀请码。
    const lanqi = await open(cdp, sessionId, "/login/lanqi");
    record(/兰琪/.test(lanqi.text), "兰琪入口渲染兰琪品牌");
    record(/产品邀请码/.test(lanqi.text) && lanqi.inputs.some((item) => /邀请码/.test(item)), "兰琪入口保留邀请码输入框");
    record(/继续进入兰琪美业|继续进入/.test(lanqi.text), "兰琪入口的下一步是「继续进入」", lanqi.buttons.slice(0, 4).join(" / "));
    await shoot(cdp, sessionId, "02-lanqi-invite");

    // ③ 其他产品入口：不再要邀请码，直接进资料表单。
    for (const [code, expectedField] of [["beauty-industry", "门店/品牌名称"], ["founder-ip", "企业/品牌名称"], ["takeaway", "企业/品牌名称"]]) {
      const page = await open(cdp, sessionId, `/login/${code}`);
      record(!/产品邀请码/.test(page.text), `${code} 入口不再要求邀请码`);
      record(page.text.includes(expectedField), `${code} 入口直接进入资料表单`, expectedField);
      record(/微信授权登录/.test(page.text), `${code} 入口保留微信登录通道`);
      await shoot(cdp, sessionId, `03-${code}-direct`);
    }

    const errors = cdp.pageErrors.filter((entry) => !/favicon|Download the React DevTools/i.test(entry));
    record(errors.length === 0, "四个入口控制台无错误", errors.length === 0 ? "0 error" : errors.join(" | ").slice(0, 200));

    await writeFile(path.join(shotDir, "result.json"), JSON.stringify({ webBase, referralCode, results }, null, 2));
    console.log(`# 截图目录：${shotDir}`);
  } finally {
    try { cdp.socket.close(); } catch {}
    cdp.child.kill();
  }

  const failed = results.filter((item) => !item.ok);
  console.log(JSON.stringify({ result: failed.length === 0 ? "PLAT34_UNIFIED_LOGIN_PASS" : "PLAT34_UNIFIED_LOGIN_FAIL", passed: results.length - failed.length, failed: failed.length }));
  if (failed.length > 0) process.exitCode = 1;
}

async function open(cdp, sessionId, route) {
  cdp.pageErrors.length = 0;
  await cdp.send("Page.navigate", { url: `${webBase}${route}` }, sessionId);
  await waitFor(cdp, sessionId, `() => document.body && document.body.innerText.trim().length > 30`, 40_000, `渲染 ${route}`);
  await delay(1800);
  return evaluate(cdp, sessionId, PAGE_STATE);
}

async function shoot(cdp, sessionId, name) {
  const shot = await cdp.send("Page.captureScreenshot", { format: "png" }, sessionId);
  await writeFile(path.join(shotDir, `${name}.png`), Buffer.from(shot.data, "base64"));
}

async function startChrome() {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "plat34-chrome-"));
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

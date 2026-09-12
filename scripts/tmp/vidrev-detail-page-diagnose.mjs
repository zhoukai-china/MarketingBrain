// 只读诊断：打开「视频复盘智能体」两个详情页，抓可见文案 / 控制台错误 / 关键接口响应。
// 用法：DEPLOY_CHECK_WEB_URL=https://api.lcppch.top/os-v2 node scripts/tmp/vidrev-detail-page-diagnose.mjs
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const webBase = (process.env.DEPLOY_CHECK_WEB_URL ?? "https://api.lcppch.top/os-v2").replace(/\/+$/, "");
const chromePath = process.env.DEPLOY_CHECK_CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const shotDir = path.join(tmpdir(), `vidrev-detail-diagnose-${Date.now()}`);
const TARGETS = [
  { name: "ipzone-vidrev", url: `${webBase}/agents/ipzone__vidrev`, sku: "ipzone__vidrev" },
  { name: "meiye-vidrev", url: `${webBase}/agents/meiye__vidrev`, sku: "meiye__vidrev" }
];

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function startChrome() {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "vidrev-detail-chrome-"));
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
  const apiCalls = [];
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
      if (message.method === "Network.responseReceived" && sessions.has(message.sessionId)) {
        const { url, status } = message.params.response;
        if (/\/api\//.test(url)) apiCalls.push(`${status} ${url}`);
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

  return { child, socket, send, userDataDir, pageErrors, apiCalls, sessions };
}

async function evaluate(cdp, sessionId, functionDeclaration) {
  const result = await cdp.send("Runtime.evaluate", { expression: `(${functionDeclaration})()`, returnByValue: true, awaitPromise: true }, sessionId);
  if (result.exceptionDetails) {
    const detail = result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? "Runtime.evaluate failed";
    throw new Error(detail);
  }
  return result.result.value;
}

async function main() {
  await mkdir(shotDir, { recursive: true });
  const cdp = await startChrome();
  try {
    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    cdp.sessions.add(sessionId);
    await cdp.send("Page.enable", {}, sessionId);
    await cdp.send("Runtime.enable", {}, sessionId);
    await cdp.send("Network.enable", {}, sessionId);
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1400, deviceScaleFactor: 1, mobile: false }, sessionId);

    for (const target of TARGETS) {
      cdp.pageErrors.length = 0;
      cdp.apiCalls.length = 0;
      await cdp.send("Page.navigate", { url: target.url }, sessionId);
      await delay(6000);
      const text = await evaluate(cdp, sessionId, "() => document.body.innerText");
      const html = await evaluate(cdp, sessionId, "() => document.body.innerHTML.length");
      const shot = await cdp.send("Page.captureScreenshot", { format: "png" }, sessionId);
      const file = path.join(shotDir, `${target.name}.png`);
      await writeFile(file, Buffer.from(shot.data, "base64"));
      await writeFile(path.join(shotDir, `${target.name}.txt`), text, "utf8");
      console.log(`\n===== ${target.name} :: ${target.url} =====`);
      console.log(`bodyHtmlLength=${html} screenshot=${file}`);
      console.log(`api calls:\n  ${cdp.apiCalls.join("\n  ") || "(none)"}`);
      console.log(`console errors:\n  ${cdp.pageErrors.join("\n  ") || "(none)"}`);
      console.log("visible text:\n" + text.slice(0, 1200));
    }
  } finally {
    cdp.socket.close();
    cdp.child.kill();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

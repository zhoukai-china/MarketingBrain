#!/usr/bin/env node
/**
 * 「兰琪美业门店经营大脑首页到底落在哪个地址」只读验证探针。
 *
 * 用法：
 *   node scripts/tmp/lanqi-home-link-verify.mjs --url https://api.lcppch.top/lanqi-test/ --out <dir>
 *
 * 只做三件事：真实 Chromium 打开页面、记录最终 URL/标题/可见文案、截图。
 * 不点击业务按钮、不写任何业务数据。
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
function argValue(flag, fallback) {
  for (let i = args.length - 1; i >= 0; i -= 1) {
    if (args[i] === flag && args[i + 1]) return args[i + 1];
  }
  return fallback;
}

const urls = [];
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === "--url" && args[i + 1]) urls.push(args[i + 1]);
}
if (urls.length === 0) urls.push("https://api.lcppch.top/lanqi-test/");
const outDir = argValue("--out", path.join(tmpdir(), "lanqi-home-link-verify"));
const port = Number(argValue("--port", "9391"));
const width = Number(argValue("--width", "1440"));
const height = Number(argValue("--height", "900"));

const CHROME_CANDIDATES = [
  process.env.CHROME_BIN ?? "",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
];
function findChrome() {
  for (const candidate of CHROME_CANDIDATES) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  throw new Error("未找到可用的 Chromium/Chrome 可执行文件。");
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForDevtools(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return await response.json();
    } catch { /* 还没起来 */ }
    await sleep(250);
  }
  throw new Error("Chromium DevTools 端口未就绪。");
}

class CdpSession {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    socket.addEventListener("message", (event) => {
      const payload = JSON.parse(event.data);
      if (payload.id && this.pending.has(payload.id)) {
        const { resolve, reject } = this.pending.get(payload.id);
        this.pending.delete(payload.id);
        if (payload.error) reject(new Error(payload.error.message));
        else resolve(payload.result);
      }
    });
  }

  static async connect(wsUrl) {
    const socket = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", () => reject(new Error("CDP WebSocket 连接失败")), { once: true });
    });
    return new CdpSession(socket);
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    const message = { id, method, params };
    if (sessionId) message.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify(message));
    });
  }

  close() { this.socket.close(); }
}

async function evaluate(root, sessionId, expression) {
  const result = await root.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? "页面脚本执行失败");
  }
  return result.result.value;
}

const SNAPSHOT = `(() => {
  const text = document.body ? document.body.innerText : "";
  const brand = document.querySelector(".lq-pd__brand-name")?.innerText?.trim() ?? "";
  const navItems = Array.from(document.querySelectorAll("nav a, .lq-side a, aside a"))
    .map(a => a.innerText.replace(/\\s+/g, " ").trim()).filter(Boolean).slice(0, 14);
  const headings = Array.from(document.querySelectorAll("h1, h2"))
    .map(h => h.innerText.replace(/\\s+/g, " ").trim()).filter(Boolean).slice(0, 8);
  const hasLoginForm = !!document.querySelector("input[type=password]");
  const storageKeys = Object.keys(localStorage);
  const token = localStorage.getItem("store_os_token") ?? "";
  return {
    url: location.href,
    title: document.title,
    brand,
    headings,
    navItems,
    hasLoginForm,
    storageKeys,
    hasToken: token.length > 0,
    tenantName: localStorage.getItem("store_os_tenant_name") ?? "",
    textHead: text.replace(/\\s+/g, " ").trim().slice(0, 600),
    textLength: text.length,
  };
})()`;

async function main() {
  await mkdir(outDir, { recursive: true });
  const profileDir = await mkdtemp(path.join(tmpdir(), "lanqi-home-verify-"));
  const chrome = spawn(findChrome(), [
    "--headless=new",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    `--window-size=${width},${height}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "--disable-extensions",
    "about:blank",
  ], { stdio: "ignore" });

  const results = [];
  try {
    const version = await waitForDevtools();
    const root = await CdpSession.connect(version.webSocketDebuggerUrl);

    for (const [index, url] of urls.entries()) {
      const created = await root.send("Target.createTarget", { url: "about:blank" });
      const attached = await root.send("Target.attachToTarget", { targetId: created.targetId, flatten: true });
      const sessionId = attached.sessionId;

      await root.send("Page.enable", {}, sessionId);
      await root.send("Runtime.enable", {}, sessionId);
      await root.send("Emulation.setDeviceMetricsOverride",
        { width, height, deviceScaleFactor: 1, mobile: false }, sessionId);

      const started = Date.now();
      await root.send("Page.navigate", { url }, sessionId);
      await sleep(6000);
      const snapshot = await evaluate(root, sessionId, SNAPSHOT);
      const shot = await root.send("Page.captureScreenshot", { format: "png" }, sessionId);
      const safeName = `shot-${index + 1}-${(new URL(url)).pathname.replace(/[^a-z0-9]+/gi, "_") || "root"}.png`;
      await writeFile(path.join(outDir, safeName), Buffer.from(shot.data, "base64"));
      results.push({ requested: url, elapsedMs: Date.now() - started, screenshot: path.join(outDir, safeName), ...snapshot });
      await root.send("Target.closeTarget", { targetId: created.targetId });
    }
    root.close();
  } finally {
    chrome.kill();
  }

  await writeFile(path.join(outDir, "result.json"), JSON.stringify(results, null, 2), "utf8");
  console.log(JSON.stringify(results, null, 2));
}

main().catch((error) => {
  console.error("探针失败：", error.message);
  process.exitCode = 1;
});

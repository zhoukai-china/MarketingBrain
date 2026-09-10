#!/usr/bin/env node
/**
 * 兰琪 demo 原型（本地 HTML）逐模式截图脚本：用于「工程页 vs demo 原型」对照验收。
 *
 * 用法：
 *   node scripts/lanqi-demo-modes-shot.mjs --file "C:\...\video.html" --out C:\tmp\demo
 *
 * 仅用于本地对照，不进入生产运行路径。
 */
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
function argValue(flag, fallback) {
  for (let i = args.length - 1; i >= 0; i -= 1) {
    if (args[i] === flag && args[i + 1]) return args[i + 1];
  }
  return fallback;
}

const file = argValue("--file");
if (!file) {
  console.error("需要 --file <html 路径>");
  process.exit(2);
}
const outDir = argValue("--out", path.join(tmpdir(), "lanqi-demo-shot"));
const port = Number(argValue("--port", "9355"));
const width = 1440;
const height = 1000;
const settleMs = Number(argValue("--settle", "2500"));
const steps = (argValue("--steps", "爆款复刻|门店素材成片|AI 剪辑|文案转片|生成分镜|填入示例")).split("|");

const CHROME_CANDIDATES = [
  path.join(process.env.LOCALAPPDATA ?? "", "ms-playwright", "chromium-1234", "chrome-win64", "chrome.exe"),
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
    } catch {
      // 等浏览器起来
    }
    await sleep(250);
  }
  throw new Error("Chromium DevTools 端口未就绪。");
}

class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
    socket.addEventListener("message", (event) => {
      const payload = JSON.parse(event.data);
      if (payload.id && this.pending.has(payload.id)) {
        const { resolve, reject } = this.pending.get(payload.id);
        this.pending.delete(payload.id);
        if (payload.error) reject(new Error(payload.error.message));
        else resolve(payload.result);
        return;
      }
      for (const listener of this.listeners) listener(payload);
    });
  }
  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", () => reject(new Error("CDP 连接失败")), { once: true });
    });
    return new Cdp(socket);
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
  on(listener) {
    this.listeners.add(listener);
  }
  close() {
    this.socket.close();
  }
}

function slugify(text) {
  return text.replace(/[^\w\u4e00-\u9fa5]+/g, "-").replace(/^-|-$/g, "");
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const profileDir = await mkdtemp(path.join(tmpdir(), "lanqi-demo-shot-profile-"));
  const chrome = spawn(
    findChrome(),
    [
      "--headless=new",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profileDir}`,
      `--window-size=${width},${height}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gpu",
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  let root;
  const produced = [];
  try {
    const version = await waitForDevtools();
    root = await Cdp.connect(version.webSocketDebuggerUrl);
    const { targetId } = await root.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await root.send("Target.attachToTarget", { targetId, flatten: true });
    root.on((payload) => {
      if (payload.sessionId === sessionId && payload.method === "Page.javascriptDialogOpening") {
        void root.send("Page.handleJavaScriptDialog", { accept: true }, sessionId);
      }
    });
    await root.send("Page.enable", {}, sessionId);
    await root.send("Runtime.enable", {}, sessionId);
    await root.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false }, sessionId);
    await root.send("Page.navigate", { url: pathToFileURL(file).href }, sessionId);
    await sleep(settleMs);

    const evalJs = async (expression) => {
      const result = await root.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
      return result.result.value;
    };

    const shoot = async (name) => {
      const image = await root.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true }, sessionId);
      const target = path.join(outDir, `${name}.png`);
      await writeFile(target, Buffer.from(image.data, "base64"));
      produced.push(target);
      console.log(`shot: ${target}`);
    };

    await shoot("00-default");

    for (const [index, step] of steps.entries()) {
      const clicked = await evalJs(`(() => {
        const text = ${JSON.stringify(step)};
        const nodes = [...document.querySelectorAll("button,a,span.pill,.vm-btn")];
        const hit = nodes.find((el) => (el.innerText || el.textContent || "").replace(/\\s+/g, "").includes(text.replace(/\\s+/g, "")));
        if (!hit) return false;
        hit.scrollIntoView({ block: "center" });
        hit.click();
        return true;
      })()`);
      await sleep(clicked ? 1600 : 0);
      console.log(`${clicked ? "ok  " : "MISS"} - ${step}`);
      await shoot(`${String(index + 1).padStart(2, "0")}-${slugify(step)}`);
    }

    console.log(`\n输出目录：${outDir}`);
  } finally {
    root?.close();
    chrome.kill();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

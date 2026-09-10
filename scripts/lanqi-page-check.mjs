#!/usr/bin/env node
/**
 * 兰琪美业页面验收辅助脚本：用本机 Chromium（CDP）逐页打开目标 URL，
 * 收集标题、可见正文、控制台错误与截图，用于对照 Demo 做可重复的页面检查。
 *
 * 用法：
 *   node scripts/lanqi-page-check.mjs --url http://localhost:5174/lanqi/moments --out C:\tmp\shots
 *   （--url 可重复；--width/--height 控制视口；--settle 控制加载后等待毫秒）
 *   需要登录态的页面用 --token 预置会话；要验证按钮点击后的反馈用 --click-text。
 *
 * 例：
 *   node scripts/lanqi-page-check.mjs --url http://localhost:5174/lanqi/dashboard --token <jwt> --out C:\tmp\shots
 *   node scripts/lanqi-page-check.mjs --url http://localhost:5174/login/lanqi --click-text "继续进入兰琪美业" --out C:\tmp\shots
 *
 * 仅用于本地验收，不进入生产运行路径。
 */
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
function argValues(flag) {
  const values = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === flag && args[i + 1]) values.push(args[i + 1]);
  }
  return values;
}
function argValue(flag, fallback) {
  const found = argValues(flag);
  return found.length ? found[found.length - 1] : fallback;
}

const urls = argValues("--url");
if (!urls.length) {
  console.error("需要至少一个 --url");
  process.exit(2);
}
const width = Number(argValue("--width", "1440"));
const height = Number(argValue("--height", "960"));
const settleMs = Number(argValue("--settle", "2500"));
const outDir = argValue("--out", path.join(tmpdir(), "lanqi-page-check"));
const port = Number(argValue("--port", "9333"));
// 预置登录态：只在本地验收用，token 来自本机 dev-login，不是生产凭据。
const token = argValue("--token", "");
// 点击验收：命中第一个包含该文案的 button/a，再等一次 settle 后取最终快照。
const clickText = argValue("--click-text", "");

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
      // 浏览器还没起来，继续等
    }
    await sleep(250);
  }
  throw new Error("Chromium DevTools 端口未就绪。");
}

class CdpSession {
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

  on(listener) {
    this.listeners.add(listener);
  }

  close() {
    this.socket.close();
  }
}

async function checkPage(root, url, index) {
  const consoleErrors = [];
  const pageErrors = [];
  const { targetId } = await root.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await root.send("Target.attachToTarget", { targetId, flatten: true });

  root.on((payload) => {
    if (payload.sessionId !== sessionId) return;
    if (payload.method === "Runtime.consoleAPICalled" && payload.params.type === "error") {
      consoleErrors.push(payload.params.args.map((item) => item.value ?? item.description ?? "").join(" "));
    }
    if (payload.method === "Runtime.exceptionThrown") {
      pageErrors.push(payload.params.exceptionDetails.exception?.description ?? payload.params.exceptionDetails.text);
    }
  });

  await root.send("Page.enable", {}, sessionId);
  await root.send("Runtime.enable", {}, sessionId);
  await root.send("Network.enable", {}, sessionId);
  await root.send(
    "Emulation.setDeviceMetricsOverride",
    { width, height, deviceScaleFactor: 1, mobile: false },
    sessionId,
  );
  if (token) {
    // 新文档创建时就写入 token，避免页面首帧无会话被重定向到登录页。
    await root.send(
      "Page.addScriptToEvaluateOnNewDocument",
      { source: `try { localStorage.setItem("store_os_token", ${JSON.stringify(token)}); } catch {}` },
      sessionId,
    );
  }
  await root.send("Page.navigate", { url }, sessionId);
  await sleep(settleMs);

  let clickResult = "";
  if (clickText) {
    const clicked = await root.send(
      "Runtime.evaluate",
      {
        expression: `(() => {
          const wanted = ${JSON.stringify(clickText)};
          const el = [...document.querySelectorAll("button,a")].find((node) => ((node.innerText || node.textContent || "").trim()).includes(wanted));
          if (!el) return "not-found";
          if (el.disabled) return "disabled";
          el.click();
          return "clicked";
        })()`,
        returnByValue: true,
      },
      sessionId,
    );
    clickResult = clicked.result.value;
    await sleep(1200);
  }

  const probe = await root.send(
    "Runtime.evaluate",
    {
      expression: `(() => ({
        href: location.href,
        title: document.title,
        text: (document.body?.innerText ?? "").replace(/\\n{3,}/g, "\\n\\n").slice(0, 6000),
        buttons: [...document.querySelectorAll("button,a[href]")].slice(0, 80).map((el) => (el.innerText || el.textContent || "").trim()).filter(Boolean),
      }))()`,
      returnByValue: true,
    },
    sessionId,
  );

  const shot = await root.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true }, sessionId);
  const slug = new URL(url).pathname.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || `page-${index}`;
  const shotPath = path.join(outDir, `${String(index + 1).padStart(2, "0")}-${slug}.png`);
  await writeFile(shotPath, Buffer.from(shot.data, "base64"));

  await root.send("Target.closeTarget", { targetId });

  return {
    url,
    href: probe.result.value.href,
    title: probe.result.value.title,
    screenshot: shotPath,
    consoleErrors,
    pageErrors,
    clickResult,
    clickText,
    buttons: probe.result.value.buttons,
    text: probe.result.value.text,
  };
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const profileDir = await mkdtemp(path.join(tmpdir(), "lanqi-page-check-profile-"));
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
  try {
    const version = await waitForDevtools();
    root = await CdpSession.connect(version.webSocketDebuggerUrl);
    const results = [];
    for (const [index, url] of urls.entries()) {
      results.push(await checkPage(root, url, index));
    }
    const reportPath = path.join(outDir, "lanqi-page-check.json");
    await writeFile(reportPath, JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2), "utf8");
    for (const result of results) {
      console.log(`\n=== ${result.url} ===`);
      console.log(`title: ${result.title}`);
      console.log(`screenshot: ${result.screenshot}`);
      if (result.clickText) console.log(`click(${result.clickText}): ${result.clickResult}`);
      console.log(`consoleErrors: ${result.consoleErrors.length}`);
      for (const message of result.consoleErrors.slice(0, 5)) console.log(`  - ${message}`);
      console.log(`pageErrors: ${result.pageErrors.length}`);
      for (const message of result.pageErrors.slice(0, 5)) console.log(`  - ${message}`);
      console.log(`text:\n${result.text.slice(0, 1800)}`);
    }
    console.log(`\nreport: ${reportPath}`);
  } finally {
    root?.close();
    chrome.kill();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

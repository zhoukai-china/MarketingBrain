#!/usr/bin/env node
/**
 * 内测实例真机页面验收：点任一功能后不得再出现「正在进入体验工作区」中间页。
 *
 * 对应缺陷见 `docs/BUG_REGRESSIONS.md` QA-20260911-013；源码口径由
 * `scripts/lanqi-test-splash-contract-smoke.mjs` 常驻锁定，本脚本负责真实页面证据。
 *
 * 前置：目标实例必须是打开 `DIRECT_TEST_LOGIN`（`VITE_DIRECT_TEST_LOGIN=true`）的内测实例，
 * 默认 `https://api.lcppch.top/lanqi-test`；生产实例没有这个中间页，跑本脚本没有意义。
 *
 * 断言（桌面 1440 + 移动 390 各跑一遍）：
 *   1) 首屏（干净 profile、本地无会话）允许出现一次中间页 —— 只记录，不断言；
 *   2) 首屏结束后本地必须已有体验会话，且真的落到兰琪页面；
 *   3) 已有会话时点侧栏导航（整页跳转）**不得**再出现中间页，并落到公域获客页；
 *   4) 已有会话时直接打开/刷新子页**不得**出现中间页，且真实渲染出内容；
 *   5) 两种情况控制台错误 / 页面异常均为 0。
 *
 * 用法：
 *   node scripts/lanqi-test-instance-splash-browser-e2e.mjs --base https://api.lcppch.top/lanqi-test
 *   可选：--out <截图目录> --port <CDP 端口>
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

const base = argValue("--base", "https://api.lcppch.top/lanqi-test").replace(/\/+$/, "");
const outDir = argValue("--out", path.join(tmpdir(), "lanqi-test-splash-e2e"));
const port = Number(argValue("--port", "9361"));

/** 中间页（`DirectTestLoginGate`）的文案标记。 */
const SPLASH_MARKERS = [
  "兰琪美业 · 内测实例",
  "正在进入体验工作区",
  "正在进入美业智能体体验工作区",
  "体验入口暂时打不开",
];

let failures = 0;
function record(name, ok, detail) {
  if (!ok) failures += 1;
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${detail ? ` :: ${detail}` : ""}`);
}
function info(name, detail) {
  console.log(`[INFO] ${name}${detail ? ` :: ${detail}` : ""}`);
}

const CHROME_CANDIDATES = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  path.join(process.env.LOCALAPPDATA ?? "", "Google/Chrome/Application/chrome.exe"),
  path.join(process.env.LOCALAPPDATA ?? "", "Microsoft/Edge/Application/msedge.exe"),
];

function findChrome() {
  for (const candidate of CHROME_CANDIDATES) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  throw new Error("未找到可用的 Chrome/Edge 可执行文件。");
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForDevtools(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return await response.json();
    } catch {
      /* 端口还没起来，继续等 */
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

async function evaluate(root, sessionId, expression) {
  const result = await root.send(
    "Runtime.evaluate",
    { expression, returnByValue: true, awaitPromise: true },
    sessionId
  );
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? "页面脚本执行失败");
  }
  return result.result.value;
}

/** 逐帧采样页面文本，记录中间页是否出现过以及目标页何时就绪。 */
async function sampleUntil(root, sessionId, { durationMs, readyText }) {
  const started = Date.now();
  const deadline = started + durationMs;
  let splashSeen = false;
  let splashMs = null;
  let splashText = "";
  let readyMs = null;
  let lastPath = "";
  let lastText = "";
  while (Date.now() < deadline) {
    let snapshot = null;
    try {
      snapshot = await evaluate(
        root,
        sessionId,
        `(() => {
          const text = document.body ? document.body.innerText : "";
          return { path: location.pathname, text: text.slice(0, 400) };
        })()`
      );
    } catch {
      /* 导航切换会销毁执行上下文，跳过这一帧 */
    }
    if (snapshot) {
      lastPath = snapshot.path || lastPath;
      lastText = (snapshot.text || "").replace(/\s+/g, " ").slice(0, 160);
      if (!splashSeen && SPLASH_MARKERS.some((marker) => (snapshot.text ?? "").includes(marker))) {
        splashSeen = true;
        splashMs = Date.now() - started;
        splashText = (snapshot.text ?? "").replace(/\s+/g, " ").slice(0, 120);
      }
      if (readyMs === null && (snapshot.text ?? "").includes(readyText)) readyMs = Date.now() - started;
    }
    if (readyMs !== null) break;
    await sleep(30);
  }
  return { splashSeen, splashMs, splashText, readyMs, lastPath, lastText };
}

async function runViewport(root, viewport) {
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
      pageErrors.push(
        payload.params.exceptionDetails.exception?.description ?? payload.params.exceptionDetails.text
      );
    }
  });
  await root.send("Page.enable", {}, sessionId);
  await root.send("Runtime.enable", {}, sessionId);
  await root.send(
    "Emulation.setDeviceMetricsOverride",
    { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.mobile },
    sessionId
  );

  // 场景 1：首屏（干净 profile，没有本地会话）—— 允许出现一次中间页，只记录。
  await root.send("Page.navigate", { url: `${base}/` }, sessionId);
  const first = await sampleUntil(root, sessionId, { durationMs: 25000, readyText: "经营驾驶舱" });
  info(
    `${viewport.label} 首屏（无会话）中间页`,
    `出现=${first.splashSeen}${first.splashMs !== null ? ` @${first.splashMs}ms` : ""} · 落地=${first.lastPath} · 就绪=${first.readyMs}ms`
  );
  record(
    `${viewport.label} 首屏最终落到兰琪页面`,
    first.readyMs !== null && first.lastPath.includes("/lanqi/"),
    `path=${first.lastPath} text=${first.lastText}`
  );

  const hasSession = await evaluate(root, sessionId, `Boolean(localStorage.getItem("store_os_token"))`);
  record(`${viewport.label} 首屏后本地已有体验会话`, hasSession === true, `store_os_token=${hasSession}`);

  // 场景 2：点侧栏导航（整页跳转）—— 不得再出现中间页。
  const clickResult = await evaluate(
    root,
    sessionId,
    `(() => {
      const link = document.querySelector('.lq-pd__nav a[href$="/lanqi/acquire"]') || document.querySelector(".lq-pd__nav a");
      if (!link) return "not-found";
      link.click();
      return "clicked";
    })()`
  ).catch((error) => `error:${error.message}`);
  const afterClick = await sampleUntil(root, sessionId, { durationMs: 15000, readyText: "公域获客" });
  record(
    `${viewport.label} 点侧栏导航后不再出现中间页`,
    clickResult === "clicked" && afterClick.splashSeen === false,
    `click=${clickResult} splash=${afterClick.splashSeen}${afterClick.splashMs !== null ? ` @${afterClick.splashMs}ms` : ""}${
      afterClick.splashText ? ` text=${afterClick.splashText}` : ""
    } · 落地=${afterClick.lastPath}`
  );
  record(
    `${viewport.label} 点侧栏导航后落到公域获客页`,
    afterClick.lastPath.includes("/lanqi/acquire"),
    `path=${afterClick.lastPath}`
  );

  // 场景 3：已持有会话时直接刷新子页 —— 不得出现中间页。
  await root.send("Page.navigate", { url: `${base}/lanqi/acquire/methods` }, sessionId);
  const reload = await sampleUntil(root, sessionId, { durationMs: 15000, readyText: "AI 运营顾问" });
  record(
    `${viewport.label} 已持有会话刷新子页不再出现中间页`,
    reload.splashSeen === false,
    `splash=${reload.splashSeen}${reload.splashMs !== null ? ` @${reload.splashMs}ms` : ""}${
      reload.splashText ? ` text=${reload.splashText}` : ""
    } · 落地=${reload.lastPath}`
  );
  record(`${viewport.label} 子页真实渲染出内容`, reload.readyMs !== null, `path=${reload.lastPath} text=${reload.lastText}`);
  record(
    `${viewport.label} 控制台错误 / 页面异常为 0`,
    consoleErrors.length === 0 && pageErrors.length === 0,
    `console=${consoleErrors.length} page=${pageErrors.length}${
      consoleErrors.length ? ` :: ${consoleErrors.join(" | ")}` : ""
    }${pageErrors.length ? ` :: ${pageErrors.join(" | ")}` : ""}`
  );

  const shot = await root.send("Page.captureScreenshot", { format: "png" }, sessionId);
  const shotPath = path.join(outDir, `${viewport.mobile ? "mobile-390" : "desktop-1440"}.png`);
  await writeFile(shotPath, Buffer.from(shot.data, "base64"));
  console.log(`  screenshot: ${shotPath}`);

  await root.send("Target.closeTarget", { targetId });
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const chromePath = findChrome();
  const userDataDir = await mkdtemp(path.join(tmpdir(), "lanqi-splash-chrome-"));
  const chrome = spawn(
    chromePath,
    [
      "--headless=new",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gpu",
      "about:blank",
    ],
    { stdio: "ignore" }
  );

  try {
    const version = await waitForDevtools();
    const root = await CdpSession.connect(version.webSocketDebuggerUrl);
    for (const viewport of [
      { label: "桌面 1440", width: 1440, height: 960, mobile: false },
      { label: "移动 390", width: 390, height: 844, mobile: true },
    ]) {
      await runViewport(root, viewport);
    }
    root.close();
  } finally {
    chrome.kill();
  }

  console.log(`\nlanqi_test_instance_splash_browser_e2e: ${failures === 0 ? "PASS" : "FAIL"} (${failures} failed)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

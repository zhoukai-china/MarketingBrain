// 视频复盘 chat 页「匿名用户登录引导」真实浏览器探针（只读：不登录、不提交生成、不花钱）。
//
// 来源：WorkBuddy 2026-09-12 07:24 的《OSv2 视频复盘 agent QA 报告》三条 P1——
//   ① chat 页没有登录入口，却让用户「点右上角『未登录 · 点击登录』」；
//   ② 匿名首访看到「登录状态已失效，本地登录信息已清除」这种误导读文案；
//   ③ 登录检查放在 4 步信息收集之后，匿名用户白填一轮才撞 401。
// 本探针把「匿名打开 chat 页就该被正确引导登录」钉成可重复执行的断言（PLAT-24）。
//
// 用法：
//   PROBE_WEB_URL=https://api.lcppch.top/os-v2 node scripts/vidrev-chat-anonymous-probe.mjs
//   PROBE_WEB_URL=http://127.0.0.1:5174 node scripts/vidrev-chat-anonymous-probe.mjs   # 本地 dev 预检
//
// PROBE_EXPECT 两种口径：
//   anonymous（默认）：生产实例——访客应看到登录引导，不应进 4 步向导。
//   auto-login：内测体验实例（`VITE_DIRECT_TEST_LOGIN=true`，访客会被自动开通成体验工作区）——
//               访客应直接是登录态（顶栏有钱包/退出登录）并能进入 4 步向导；
//               这条断言用来证明「免登录体验」没有被登录闸门弄坏。
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const webBase = (process.env.PROBE_WEB_URL ?? "https://api.lcppch.top/os-v2").replace(/\/+$/, "");
const chromePath = process.env.PROBE_CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const shotDir = process.env.PROBE_SHOT_DIR ?? path.join(tmpdir(), `vidrev-login-gate-probe-${Date.now()}`);
const assertMode = process.env.PROBE_ASSERT !== "false";
const expect = process.env.PROBE_EXPECT ?? "anonymous";

const SKUS = ["ipzone__vidrev", "meiye__vidrev"];
const VIEWPORTS = [
  { name: "desktop-1440", width: 1440, height: 1200, mobile: false },
  { name: "mobile-390", width: 390, height: 844, mobile: true }
];

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function startChrome() {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "vidrev-login-gate-chrome-"));
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

async function evaluate(cdp, sessionId, functionDeclaration) {
  const result = await cdp.send("Runtime.evaluate", { expression: `(${functionDeclaration})()`, returnByValue: true, awaitPromise: true }, sessionId);
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? "Runtime.evaluate failed");
  }
  return result.result.value;
}

async function waitFor(cdp, sessionId, functionDeclaration, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let value;
    try {
      value = await evaluate(cdp, sessionId, functionDeclaration);
    } catch (error) {
      if (!/Execution context was destroyed|Cannot find context|Inspected target navigated/i.test(error instanceof Error ? error.message : String(error))) throw error;
      value = false;
    }
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`waitFor timeout: ${functionDeclaration}`);
    await delay(300);
  }
}

async function shoot(cdp, sessionId, name) {
  const shot = await cdp.send("Page.captureScreenshot", { format: "png" }, sessionId);
  const file = path.join(shotDir, `${name}.png`);
  await writeFile(file, Buffer.from(shot.data, "base64"));
  return file;
}

/** 采集 chat 页匿名首屏事实：顶栏是否有登录入口、是否直接进向导、有没有可点的登录按钮。 */
const COLLECT_FACTS = () => {
  const header = document.querySelector("header.topbar");
  const headerText = (header?.innerText ?? "").replace(/\s+/g, " ").trim();
  const bodyText = (document.body.innerText ?? "").replace(/\s+/g, " ").trim();
  const clickable = [...document.querySelectorAll("button, a")].map((el) => (el.innerText ?? "").trim()).filter(Boolean);
  return {
    title: document.title,
    headerText,
    headerHasLoginEntry: /未登录|登录/.test(headerText),
    headerHasWallet: /积分/.test(headerText),
    hasThemeToggle: Boolean(document.querySelector(".theme-toggle")),
    hasModeChoice: /快速诊断/.test(bodyText) || /深度复盘/.test(bodyText),
    hasConfirmButton: clickable.some((text) => text.includes("确认，开始生成")),
    hasLoginButton: clickable.some((text) => text.includes("登录")),
    loginGateCopy: /登录后才能使用|需要登录|先登录|登录后使用/.test(bodyText),
    bodyHead: bodyText.slice(0, 320)
  };
};

async function main() {
  await mkdir(shotDir, { recursive: true });
  const cdp = await startChrome();
  const results = [];
  const failures = [];
  try {
    for (const sku of SKUS) {
      for (const viewport of VIEWPORTS) {
        const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
        const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
        cdp.sessions.add(sessionId);
        await cdp.send("Page.enable", {}, sessionId);
        await cdp.send("Runtime.enable", {}, sessionId);
        await cdp.send("Emulation.setDeviceMetricsOverride",
          { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.mobile }, sessionId);

        const label = `${sku}-${viewport.name}`;
        const url = `${webBase}/agent/${encodeURIComponent(sku)}/chat`;
        await cdp.send("Page.navigate", { url }, sessionId);
        // 等首屏加载态消失：既覆盖「加载中」也覆盖真正的登录引导。
        await waitFor(cdp, sessionId, () => {
          const text = document.body?.innerText ?? "";
          return text.length > 20 && !text.includes("正在加载对话");
        });
        await delay(1200);
        const facts = await evaluate(cdp, sessionId, COLLECT_FACTS);
        const shot = await shoot(cdp, sessionId, label);
        results.push({ label, url, ...facts, shot });

        if (assertMode) {
          const checks = expect === "auto-login"
            ? [
                ["免登录实例访客是登录态（顶栏有钱包/退出登录）", facts.headerHasWallet && /退出登录/.test(facts.headerText), `header="${facts.headerText}"`],
                ["免登录实例仍能进入 4 步向导", facts.hasModeChoice, `mode=${facts.hasModeChoice}`],
                ["免登录实例不显示登录闸门", !facts.loginGateCopy, `gate=${facts.loginGateCopy}`]
              ]
            : [
                ["顶栏有登录入口", facts.headerHasLoginEntry, `header="${facts.headerText}"`],
                ["匿名不直接进入 4 步向导", !facts.hasModeChoice && !facts.hasConfirmButton, `mode=${facts.hasModeChoice} confirm=${facts.hasConfirmButton}`],
                ["页面给出可直接点的登录按钮", facts.hasLoginButton, `buttons=${facts.hasLoginButton}`],
                ["给出可理解的登录说明（不是「登录状态已失效」）", facts.loginGateCopy, `copy="${facts.bodyHead.slice(0, 80)}"`]
              ];
          for (const [name, ok, detail] of checks) {
            if (!ok) failures.push(`[${label}] ${name} :: ${detail}`);
          }
        }
        await cdp.send("Target.closeTarget", { targetId });
      }
    }
  } finally {
    try { cdp.socket.close(); } catch { /* ignore */ }
    try { cdp.child.kill(); } catch { /* ignore */ }
    await rm(cdp.userDataDir, { recursive: true, force: true }).catch(() => undefined);
  }

  for (const item of results) {
    console.log(JSON.stringify({
      label: item.label,
      title: item.title,
      headerText: item.headerText,
      headerHasLoginEntry: item.headerHasLoginEntry,
      hasModeChoice: item.hasModeChoice,
      hasConfirmButton: item.hasConfirmButton,
      hasLoginButton: item.hasLoginButton,
      loginGateCopy: item.loginGateCopy,
      hasThemeToggle: item.hasThemeToggle,
      shot: item.shot
    }));
  }
  console.log(`shots=${shotDir}`);
  if (!assertMode) {
    console.log("vidrev_chat_anonymous_probe: FACTS_ONLY");
    return;
  }
  if (failures.length > 0) {
    console.error(`\nvidrev_chat_anonymous_probe: FAIL (${results.length} viewports, ${failures.length} failed)`);
    for (const failure of failures) console.error(`[FAIL] ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log(`\nvidrev_chat_anonymous_probe: PASS (expect=${expect}, ${results.length} viewports)`);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

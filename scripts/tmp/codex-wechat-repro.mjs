#!/usr/bin/env node
// 临时复现脚本（不进发布包）：打开兰琪「微信群营销话术」页，填表后点生成，抓网络与页面状态。
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
function argValue(flag, fallback) {
  let found = fallback;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === flag && args[i + 1]) found = args[i + 1];
  }
  return found;
}
const base = argValue("--base", "https://api.lcppch.top/lanqi-test").replace(/\/+$/, "");
const port = Number(argValue("--port", "9351"));
const settle = Number(argValue("--settle", "15000"));
const outDir = argValue("--out", path.join(tmpdir(), "codex-wechat-repro"));

const CHROME_CANDIDATES = [
  path.join(process.env.LOCALAPPDATA ?? "", "ms-playwright", "chromium-1234", "chrome-win64", "chrome.exe"),
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
];
function findChrome() {
  for (const c of CHROME_CANDIDATES) if (c && existsSync(c)) return c;
  throw new Error("no chrome");
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitForDevtools(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (r.ok) return await r.json();
    } catch {}
    await sleep(250);
  }
  throw new Error("devtools not ready");
}
class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
    socket.addEventListener("message", (e) => {
      const p = JSON.parse(e.data);
      if (p.id && this.pending.has(p.id)) {
        const { resolve, reject } = this.pending.get(p.id);
        this.pending.delete(p.id);
        if (p.error) reject(new Error(p.error.message)); else resolve(p.result);
        return;
      }
      for (const l of this.listeners) l(p);
    });
  }
  static async connect(ws) {
    const s = new WebSocket(ws);
    await new Promise((res, rej) => {
      s.addEventListener("open", res, { once: true });
      s.addEventListener("error", () => rej(new Error("ws fail")), { once: true });
    });
    return new Cdp(s);
  }
  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    const msg = { id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify(msg));
    });
  }
  on(l) { this.listeners.add(l); }
  close() { this.socket.close(); }
}
async function evaluate(root, sessionId, expression) {
  const r = await root.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? "eval fail");
  return r.result.value;
}

await mkdir(outDir, { recursive: true });
const profile = await mkdtemp(path.join(tmpdir(), "codex-wechat-profile-"));
const chrome = spawn(findChrome(), [
  "--headless=new",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  "--window-size=1440,960",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-gpu",
  "about:blank",
], { stdio: "ignore" });

let root;
try {
  const version = await waitForDevtools();
  root = await Cdp.connect(version.webSocketDebuggerUrl);
  const { targetId } = await root.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await root.send("Target.attachToTarget", { targetId, flatten: true });
  const net = [];
  const consoleErrors = [];
  const pageErrors = [];
  root.on((p) => {
    if (p.sessionId !== sessionId) return;
    if (p.method === "Network.responseReceived") {
      const u = p.params.response.url;
      if (u.includes("/lanqi") || u.includes("/api/")) net.push({ status: p.params.response.status, url: u.replace(base, ""), ts: Date.now() });
    }
    if (p.method === "Network.loadingFailed") net.push({ status: "FAILED", url: p.params.errorText, ts: Date.now() });
    if (p.method === "Runtime.consoleAPICalled" && p.params.type === "error") consoleErrors.push(p.params.args.map((a) => a.value ?? a.description ?? "").join(" "));
    if (p.method === "Runtime.exceptionThrown") pageErrors.push(p.params.exceptionDetails.exception?.description ?? p.params.exceptionDetails.text);
  });
  await root.send("Page.enable", {}, sessionId);
  await root.send("Runtime.enable", {}, sessionId);
  await root.send("Network.enable", {}, sessionId);
  await root.send("Page.navigate", { url: `${base}/lanqi/moments/wechat-group` }, sessionId);

  const deadline = Date.now() + settle;
  let text = "";
  while (Date.now() < deadline) {
    text = await evaluate(root, sessionId, "document.body?.innerText ?? ''");
    if (text.includes("生成群话术")) break;
    await sleep(400);
  }
  await sleep(1500);
  console.log("=== initial page text (first 900) ===");
  console.log(text.slice(0, 900));

  const fill = await evaluate(root, sessionId, `(() => {
    const setInput = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    const setArea = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    const input = [...document.querySelectorAll("input")].find((el) => el.offsetParent !== null && el.type !== "checkbox");
    const area = [...document.querySelectorAll("textarea")].find((el) => el.offsetParent !== null);
    if (!input) return "no-input";
    if (!area) return "no-textarea";
    setInput.call(input, "中秋回馈老客户");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    setArea.call(area, "本店中秋推出护理套餐回馈活动，老客户可到店领取体验装，并预约本月护理时段。");
    area.dispatchEvent(new Event("input", { bubbles: true }));
    const btn = [...document.querySelectorAll("button")].find((el) => (el.innerText || "").includes("生成群话术"));
    return { filled: true, btnFound: !!btn, disabled: btn ? btn.disabled : null };
  })()`);
  console.log("=== fill result ===", JSON.stringify(fill));
  await sleep(500);

  const clicked = await evaluate(root, sessionId, `(() => {
    const btn = [...document.querySelectorAll("button")].find((el) => (el.innerText || "").includes("生成群话术"));
    if (!btn) return "no-button";
    if (btn.disabled) return "disabled";
    btn.click();
    return "clicked";
  })()`);
  console.log("=== click ===", clicked);

  await sleep(30000);
  text = await evaluate(root, sessionId, "document.body?.innerText ?? ''");
  console.log("=== after-click page text ===");
  console.log(text.slice(0, 2000));
  console.log("=== network ===");
  console.log(JSON.stringify(net.slice(-15), null, 1));
  console.log("=== console errors ===", JSON.stringify(consoleErrors));
  console.log("=== page errors ===", JSON.stringify(pageErrors));
} finally {
  try { root?.close(); } catch {}
  chrome.kill();
}

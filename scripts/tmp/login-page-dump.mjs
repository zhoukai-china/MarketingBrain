// 临时诊断：打印部署实例 /login 页面的可见文本与关键 DOM，便于定位断言失败原因。
import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const webBase = (process.env.LOGIN_READONLY_WEB_URL ?? "https://api.lcppch.top/os-v2").replace(/\/+$/, "");
const targetPath = process.env.DUMP_PATH ?? "/login";
const chromePath = process.env.DEPLOY_CHECK_CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const outFile = process.env.DUMP_OUT ?? path.join(tmpdir(), `login-dump-${Date.now()}.png`);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const userDataDir = await mkdtemp(path.join(tmpdir(), "login-dump-chrome-"));
const child = spawn(chromePath, [
  "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  "--window-size=1440,1200", "--remote-debugging-port=0", `--user-data-dir=${userDataDir}`, "about:blank"
], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });

const endpoint = await new Promise((resolve, reject) => {
  let out = "";
  const timer = setTimeout(() => reject(new Error("DevTools endpoint timeout")), 15000);
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (c) => {
    out += c;
    const m = out.match(/DevTools listening on (ws:\/\/[^\s]+)/);
    if (m) { clearTimeout(timer); resolve(m[1]); }
  });
  child.once("exit", (code) => reject(new Error(`chrome exited early (${code})`)));
});

const socket = new WebSocket(endpoint);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
let nextId = 0;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data);
  if (!msg.id) return;
  const h = pending.get(msg.id);
  if (!h) return;
  pending.delete(msg.id);
  msg.error ? h.reject(new Error(msg.error.message)) : h.resolve(msg.result);
});
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = ++nextId;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
});
const evaluate = async (sessionId, fn) => {
  const res = await send("Runtime.evaluate", { expression: `(${fn})()`, returnByValue: true, awaitPromise: true }, sessionId);
  return res.result?.value;
};

const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
await send("Page.enable", {}, sessionId);
await send("Runtime.enable", {}, sessionId);
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1200, deviceScaleFactor: 1, mobile: false }, sessionId);
await send("Page.navigate", { url: `${webBase}${targetPath}` }, sessionId);
await delay(9000);
console.log("url=" + await evaluate(sessionId, `() => window.location.href`));
console.log("path=" + await evaluate(sessionId, `() => window.location.pathname`));
console.log("buttons=" + JSON.stringify(await evaluate(sessionId, `() => [...document.querySelectorAll("button")].map((b) => ({ t: b.textContent.trim().slice(0, 40), cls: b.className, disabled: b.disabled })).slice(0, 12)`)));
console.log("--- innerText ---");
console.log(await evaluate(sessionId, `() => document.body.innerText`));
const shot = await send("Page.captureScreenshot", { format: "png" }, sessionId);
await writeFile(outFile, Buffer.from(shot.data, "base64"));
console.log("shot=" + outFile);
socket.close();
child.kill();

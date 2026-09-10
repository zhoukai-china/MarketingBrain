// 临时探针：打开一个 URL，输出渲染后的正文、console 错误与截图。
// 用法：PROBE_URL=http://127.0.0.1:4173/os-v2/ node scripts/tmp/probe-page.mjs
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const url = process.env.PROBE_URL ?? "http://127.0.0.1:4173/os-v2/";
const shot = process.env.PROBE_SHOT ?? path.join(tmpdir(), `probe-${Date.now()}.png`);
const chromePath = process.env.DEPLOY_CHECK_CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const userDataDir = await mkdtemp(path.join(tmpdir(), "probe-chrome-"));
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

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
});

const socket = new WebSocket(endpoint);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
let nextId = 0;
const pending = new Map();
const errors = [];
socket.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data);
  if (msg.method === "Runtime.consoleAPICalled" && msg.params?.type === "error") {
    errors.push((msg.params.args ?? []).map((a) => a.value ?? a.description ?? "").join(" "));
  }
  if (msg.method === "Runtime.exceptionThrown") {
    errors.push(msg.params?.exceptionDetails?.exception?.description ?? "pageerror");
  }
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

const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
await send("Page.enable", {}, sessionId);
await send("Runtime.enable", {}, sessionId);
await send("Page.navigate", { url }, sessionId);
await delay(Number(process.env.PROBE_WAIT_MS ?? 9000));
const res = await send("Runtime.evaluate", {
  expression: "({ url: location.href, text: document.body.innerText, html: document.body.innerHTML.slice(0,400) })",
  returnByValue: true
}, sessionId);
await mkdir(path.dirname(shot), { recursive: true });
await writeFile(shot, Buffer.from((await send("Page.captureScreenshot", { format: "png" }, sessionId)).data, "base64"));
console.log(JSON.stringify({ ...res.result.value, consoleErrors: errors, shot }, null, 2));
socket.close();
child.kill();

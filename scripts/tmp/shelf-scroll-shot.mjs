// 只读：打开指定 URL，向下滚动后截图，用于人工确认货架卡片是否真正渲染可见。
// 用法：DEPLOY_CHECK_WEB_URL=... SHOT_OUT=... node scripts/tmp/shelf-scroll-shot.mjs
import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const webBase = (process.env.DEPLOY_CHECK_WEB_URL ?? "https://api.lcppch.top/lanqi-test").replace(/\/+$/, "");
const chromePath = process.env.DEPLOY_CHECK_CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const shotOut = process.env.SHOT_OUT ?? path.join(tmpdir(), `shelf-scroll-${Date.now()}.png`);
const scrollY = Number(process.env.SCROLL_Y ?? "700");
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const userDataDir = await mkdtemp(path.join(tmpdir(), "shelf-scroll-chrome-"));
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

const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
await send("Page.enable", {}, sessionId);
await send("Runtime.enable", {}, sessionId);
await send("Page.navigate", { url: `${webBase}/market` }, sessionId);
await delay(6000);
await send("Runtime.evaluate", { expression: `window.scrollTo(0, ${scrollY}); 1`, awaitPromise: true }, sessionId);
await delay(2500);
const metrics = await send("Page.getLayoutMetrics", {}, sessionId);
const contentHeight = Math.round(metrics.cssContentSize?.height ?? metrics.contentSize?.height ?? 1200);
const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true }, sessionId);
await writeFile(shotOut, Buffer.from(shot.data, "base64"));

const dom = await send("Runtime.evaluate", {
  expression: `JSON.stringify({cards: document.querySelectorAll('[data-sku-card], .sku-card, article').length, imgs: document.images.length, visibleText: document.body.innerText.slice(0, 120)})`,
  returnByValue: true
}, sessionId);
console.log("content_height=" + contentHeight);
console.log(dom.result.value);
console.log("shot=" + shotOut);
socket.close();
child.kill();

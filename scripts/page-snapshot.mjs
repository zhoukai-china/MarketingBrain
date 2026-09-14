// 任意页面「打开我看下」快照工具（只读：只访问 URL、截图、抄标题与首屏文字，不点任何按钮）。
//
// 用法：
//   SNAPSHOT_URLS="https://api.lcppch.top/os-v2/agents/clipper,https://api.lcppch.top/os-v2/clip-lab" \
//   SNAPSHOT_DIR="F:\...\.tmp\shots" node scripts/page-snapshot.mjs
//
// 可选：SNAPSHOT_WIDTH（默认 1440）、SNAPSHOT_MOBILE=true 时额外出一张 390 宽、SNAPSHOT_WAIT_MS（默认 2500）。
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const urls = (process.env.SNAPSHOT_URLS ?? "").split(",").map((item) => item.trim()).filter(Boolean);
if (urls.length === 0) {
  console.error("SNAPSHOT_URLS is required (comma separated)");
  process.exit(2);
}
const outDir = process.env.SNAPSHOT_DIR ?? path.join(tmpdir(), `page-snapshot-${Date.now()}`);
const chromePath = process.env.SNAPSHOT_CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const desktopWidth = Number(process.env.SNAPSHOT_WIDTH ?? 1440);
const withMobile = process.env.SNAPSHOT_MOBILE === "true";
const waitMs = Number(process.env.SNAPSHOT_WAIT_MS ?? 2500);

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function startChrome() {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "page-snapshot-chrome-"));
  const child = spawn(chromePath, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--remote-debugging-port=0", `--user-data-dir=${userDataDir}`, "about:blank"
  ], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
  const endpoint = await new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error("Chrome DevTools endpoint timeout")), 15_000);
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      output += chunk;
      const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    child.once("exit", (code) => reject(new Error(`Chrome exited early (${code})`)));
  });
  const socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id) return;
    const handler = pending.get(message.id);
    if (!handler) return;
    pending.delete(message.id);
    if (message.error) handler.reject(new Error(message.error.message));
    else handler.resolve(message.result);
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  return { child, socket, send, userDataDir };
}

async function evaluate(cdp, sessionId, fn) {
  const result = await cdp.send("Runtime.evaluate", { expression: `(${fn})()`, returnByValue: true, awaitPromise: true }, sessionId);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? "evaluate failed");
  return result.result.value;
}

function slugify(url) {
  return url.replace(/^https?:\/\//, "").replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/_+$/, "").slice(0, 80);
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const cdp = await startChrome();
  const results = [];
  try {
    for (const url of urls) {
      const sizes = [{ name: `${desktopWidth}`, width: desktopWidth, mobile: false }];
      if (withMobile) sizes.push({ name: "390", width: 390, height: 844, mobile: true });
      for (const size of sizes) {
        const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
        const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
        await cdp.send("Page.enable", {}, sessionId);
        await cdp.send("Runtime.enable", {}, sessionId);
        await cdp.send("Emulation.setDeviceMetricsOverride",
          { width: size.width, height: size.height ?? 1000, deviceScaleFactor: 1, mobile: size.mobile }, sessionId);
        await cdp.send("Page.navigate", { url }, sessionId);
        await delay(waitMs);
        const facts = await evaluate(cdp, sessionId, () => ({
          finalUrl: location.href,
          title: document.title,
          textHead: (document.body?.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 400),
          scrollHeight: document.documentElement.scrollHeight
        }));
        const shot = await cdp.send("Page.captureScreenshot",
          { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: size.width, height: facts.scrollHeight, scale: 1 } }, sessionId);
        const file = path.join(outDir, `${slugify(url)}-${size.name}.png`);
        await writeFile(file, Buffer.from(shot.data, "base64"));
        results.push({ url, width: size.width, ...facts, file });
        await cdp.send("Target.closeTarget", { targetId });
      }
    }
  } finally {
    try { cdp.socket.close(); } catch { /* ignore */ }
    try { cdp.child.kill(); } catch { /* ignore */ }
    await rm(cdp.userDataDir, { recursive: true, force: true }).catch(() => undefined);
  }
  for (const item of results) console.log(JSON.stringify(item));
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

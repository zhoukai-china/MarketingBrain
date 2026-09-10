// 只读探针：在生产上打开「文案智能体」详情页，点开「输出参考案例」弹窗，
// 抓弹窗标题/输入说明/正文，判断两个专区的样例是否串台。
// 只读：不登录、不提交表单、不写任何数据。
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const webBase = (process.env.REF_WEB_URL ?? "https://api.lcppch.top/os-v2").replace(/\/+$/, "");
const chromePath = process.env.DEPLOY_CHECK_CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const shotDir = process.env.SHOT_DIR ?? path.join(tmpdir(), `ref-case-${Date.now()}`);
const settleMs = Number(process.env.REF_SETTLE_MS ?? 6000);
const targets = (process.env.REF_TARGETS ?? "ipzone__copy,meiye__copy").split(",").map((s) => s.trim()).filter(Boolean);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const userDataDir = await mkdtemp(path.join(tmpdir(), "ref-case-chrome-"));
const child = spawn(chromePath, [
  "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  "--window-size=1440,1600", "--remote-debugging-port=0", `--user-data-dir=${userDataDir}`, "about:blank"
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
  msg.error ? h.reject(new Error(JSON.stringify(msg.error))) : h.resolve(msg.result);
});
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = ++nextId;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
});

const evaluate = async (sessionId, expression) =>
  (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId)).result?.value;

const openCase = `(async () => {
  const norm = (s) => (s || "").replace(/\\s+/g, "");
  const btn = Array.from(document.querySelectorAll("button")).find((b) => norm(b.textContent).includes("输出参考案例"));
  if (!btn) {
    return { clicked: false, pageText: norm(document.body.textContent).slice(0, 400) };
  }
  btn.click();
  await new Promise((r) => setTimeout(r, 800));
  const dialog = document.querySelector(".sheet, .drawer, .modal, [role=dialog], .ref-case, .demo-modal") || document.body;
  return {
    clicked: true,
    title: norm(dialog.querySelector("h1,h2,h3,h4,.sheet-title,.modal-title")?.textContent),
    dialogText: norm(dialog.textContent).slice(0, 1200)
  };
})()`;

await mkdir(shotDir, { recursive: true });
const results = [];
try {
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  await send("Page.enable", {}, sessionId);
  await send("Runtime.enable", {}, sessionId);
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1600, deviceScaleFactor: 1, mobile: false }, sessionId);

  for (const sku of targets) {
    await send("Page.navigate", { url: `${webBase}/agent/${sku}` }, sessionId);
    await delay(settleMs);
    const beforeUrl = await evaluate(sessionId, "location.href");
    const probe = await evaluate(sessionId, openCase);
    const shot = path.join(shotDir, `${sku.replace(/[^a-z0-9_-]/gi, "_")}.png`);
    await writeFile(shot, Buffer.from((await send("Page.captureScreenshot", { format: "png" }, sessionId)).data, "base64"));
    const isBeauty = /不破皮|16年美容|美业老板/.test(probe?.dialogText ?? "");
    results.push({ sku, url: beforeUrl, isBeautySample: isBeauty, ...probe, shot });
    console.log(`\n=== ${sku} ===`);
    console.log(`url=${beforeUrl}`);
    console.log(`clicked=${probe?.clicked} beautySample=${isBeauty}`);
    console.log(`title=${probe?.title ?? ""}`);
    console.log(`text=${(probe?.dialogText ?? "").slice(0, 600)}`);
    console.log(`shot=${shot}`);
  }
  console.log("\nJSON=" + JSON.stringify(results));
} finally {
  socket.close();
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill();
  await exited;
}

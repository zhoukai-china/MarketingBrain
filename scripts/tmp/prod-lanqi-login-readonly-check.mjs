// 只读探针：确认生产 `/os-v2/login/lanqi` 兰琪入口可渲染、注册是否需要邀请码。
// 只加载页面 + 读取 DOM 文本，不提交表单、不创建任何数据。
// 用法：node scripts/tmp/prod-lanqi-login-readonly-check.mjs [webBase]
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const webBase = (process.argv[2] ?? "https://api.lcppch.top/os-v2").replace(/\/+$/, "");
const target = `${webBase}/login/lanqi`;
const chromePath = process.env.DEPLOY_CHECK_CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const shotDir = process.env.SHOT_DIR ?? path.join(tmpdir(), `lanqi-login-readonly-${Date.now()}`);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const userDataDir = await mkdtemp(path.join(tmpdir(), "lanqi-login-readonly-chrome-"));
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
const consoleErrors = [];
socket.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data);
  if (msg.method === "Runtime.exceptionThrown") consoleErrors.push(String(msg.params?.exceptionDetails?.text ?? "exception"));
  if (msg.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(msg.params?.type)) {
    consoleErrors.push(`${msg.params.type}: ${(msg.params.args ?? []).map((a) => a.value ?? a.description ?? "").join(" ")}`);
  }
  if (!msg.id) return;
  const handler = pending.get(msg.id);
  if (!handler) return;
  pending.delete(msg.id);
  msg.error ? handler.reject(new Error(msg.error.message)) : handler.resolve(msg.result);
});
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = ++nextId;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
});
const evaluate = async (sessionId, expression) => {
  const res = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
  return res?.result?.value;
};

await mkdir(shotDir, { recursive: true });
const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
await send("Page.enable", {}, sessionId);
await send("Runtime.enable", {}, sessionId);
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1200, deviceScaleFactor: 1, mobile: false }, sessionId);
await send("Page.navigate", { url: target }, sessionId);
await delay(7000);

const text = (await evaluate(sessionId, "document.body.innerText")) ?? "";
const title = await evaluate(sessionId, "document.title");
const pathname = await evaluate(sessionId, "location.pathname");
const config = await evaluate(sessionId,
  `fetch('${webBase}/api/auth/wechat-config').then(r=>r.json()).then(j=>JSON.stringify(j)).catch(e=>'ERR:'+e)`
);
const shot = await send("Page.captureScreenshot", { format: "png" }, sessionId);
const shotFile = path.join(shotDir, "01-lanqi-login.png");
await writeFile(shotFile, Buffer.from(shot.data, "base64"));
child.kill();

console.log(JSON.stringify({
  url: target,
  landedPath: pathname,
  title,
  hasLanqiBrand: text.includes("兰琪"),
  hasWechatButton: /微信一键登录/.test(text),
  mentionsInvite: text.includes("邀请码"),
  wechatConfig: config,
  consoleErrors,
  shot: shotFile,
}, null, 2));
console.log(text.slice(0, 700).replace(/\s+/g, " "));

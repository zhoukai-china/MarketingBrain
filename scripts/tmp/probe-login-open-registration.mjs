// 临时探针：在本机 production 构建产物上渲染登录页，并在浏览器层把 /auth/wechat-config
// 的 inviteRequired 改写成指定值，用来分别验收「开放注册」与「邀请制」两种真实渲染分支。
// 本机 3011 端口被本地 dev API 占用（其 .env 为 INVITE_REQUIRED=true），因此必须用 CDP
// 响应改写，才能在不改动他人进程的前提下验证开放注册分支。
// 用法：PROBE_URL=http://127.0.0.1:4174/os-v2/login INVITE_REQUIRED=false node scripts/tmp/probe-login-open-registration.mjs
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const url = process.env.PROBE_URL ?? "http://127.0.0.1:4174/os-v2/login";
const forced = process.env.INVITE_REQUIRED ?? "false";
const tag = forced === "true" ? "invite-required" : "open-registration";
const shot = process.env.PROBE_SHOT ?? path.join(tmpdir(), `probe-login-${tag}.png`);
const chromePath = process.env.DEPLOY_CHECK_CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const userDataDir = await mkdtemp(path.join(tmpdir(), "probe-login-chrome-"));
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
const intercepted = [];
let sessionId = null;
const send = (method, params = {}, sid) => new Promise((resolve, reject) => {
  const id = ++nextId;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params, ...(sid ? { sessionId: sid } : {}) }));
});

async function handlePaused(params) {
  const requestId = params.requestId;
  try {
    const { body, base64Encoded } = await send("Fetch.getResponseBody", { requestId }, sessionId);
    const raw = base64Encoded ? Buffer.from(body, "base64").toString("utf8") : body;
    const payload = JSON.parse(raw);
    intercepted.push({ url: params.request.url, before: payload.inviteRequired });
    payload.inviteRequired = forced === "true";
    intercepted[intercepted.length - 1].after = payload.inviteRequired;
    const headers = (params.responseHeaders ?? []).filter((h) => !["content-length", "content-encoding"].includes(h.name.toLowerCase()));
    headers.push({ name: "content-type", value: "application/json; charset=utf-8" });
    await send("Fetch.fulfillRequest", {
      requestId,
      responseCode: params.responseStatusCode ?? 200,
      responseHeaders: headers,
      body: Buffer.from(JSON.stringify(payload), "utf8").toString("base64"),
    }, sessionId);
  } catch (error) {
    errors.push(`intercept_failed:${error?.message ?? error}`);
    await send("Fetch.continueRequest", { requestId }, sessionId).catch(() => {});
  }
}

socket.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data);
  if (msg.method === "Fetch.requestPaused") { void handlePaused(msg.params); return; }
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

const { targetId } = await send("Target.createTarget", { url: "about:blank" });
({ sessionId } = await send("Target.attachToTarget", { targetId, flatten: true }));
await send("Page.enable", {}, sessionId);
await send("Runtime.enable", {}, sessionId);
await send("Fetch.enable", {
  patterns: [{ urlPattern: "*wechat-config*", requestStage: "Response" }],
}, sessionId);
await send("Page.navigate", { url }, sessionId);
await delay(Number(process.env.PROBE_WAIT_MS ?? 9000));
const res = await send("Runtime.evaluate", {
  expression: "({ url: location.href, text: document.body.innerText, html: document.body.innerHTML.slice(0,600) })",
  returnByValue: true
}, sessionId);
await mkdir(path.dirname(shot), { recursive: true });
await writeFile(shot, Buffer.from((await send("Page.captureScreenshot", { format: "png" }, sessionId)).data, "base64"));
console.log(JSON.stringify({ mode: tag, ...res.result.value, intercepted, consoleErrors: errors, shot }, null, 2));
socket.close();
child.kill();

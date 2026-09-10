// 只读探针：复现「带着失效 token 访问 /login 会被弹回货架、且货架仍显示未登录」的登录死循环，
// 并抓一张电脑端微信授权页的截图，确认 PC 扫码这一跳到底长什么样。
// 只在无头浏览器的临时 profile 里写 localStorage，不碰生产数据。
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const webBase = (process.env.LOGIN_WEB_URL ?? "https://api.lcppch.top/os-v2").replace(/\/+$/, "");
const chromePath = process.env.DEPLOY_CHECK_CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const shotDir = process.env.SHOT_DIR ?? path.join(tmpdir(), `login-loop-${Date.now()}`);
const settleMs = Number(process.env.LOGIN_SETTLE_MS ?? 6000);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const userDataDir = await mkdtemp(path.join(tmpdir(), "login-loop-chrome-"));
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
  msg.error ? h.reject(new Error(JSON.stringify(msg.error))) : h.resolve(msg.result);
});
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = ++nextId;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
});
const evaluate = async (sessionId, expression) =>
  (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId)).result?.value;
const norm = (s) => (s || "").replace(/\s+/g, " ").trim();

await mkdir(shotDir, { recursive: true });
const results = [];
try {
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  await send("Page.enable", {}, sessionId);
  await send("Runtime.enable", {}, sessionId);
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1200, deviceScaleFactor: 1, mobile: false }, sessionId);

  async function snap(name, url) {
    await send("Page.navigate", { url }, sessionId);
    await delay(settleMs);
    const current = await evaluate(sessionId, "location.href");
    const text = await evaluate(sessionId, "document.body ? document.body.innerText.slice(0, 500) : ''");
    const hasWechatBtn = await evaluate(sessionId, "Array.from(document.querySelectorAll('button')).some((b) => /微信/.test(b.textContent || ''))");
    const hasInviteInput = await evaluate(sessionId, "Boolean(document.querySelector('input[placeholder*=\"邀请码\"]'))");
    const shot = path.join(shotDir, `${name}.png`);
    await writeFile(shot, Buffer.from((await send("Page.captureScreenshot", { format: "png" }, sessionId)).data, "base64"));
    const record = { name, requested: url, landed: current, hasWechatBtn, hasInviteInput, text: norm(text).slice(0, 260), shot };
    results.push(record);
    console.log(`\n=== ${name} ===`);
    console.log(`requested = ${record.requested}`);
    console.log(`landed    = ${record.landed}`);
    console.log(`wechatBtn = ${hasWechatBtn}  inviteInput = ${hasInviteInput}`);
    console.log(`text      = ${record.text}`);
    console.log(`shot      = ${shot}`);
    return record;
  }

  // 1) 干净浏览器：直接开 /login 应该看到登录页
  await snap("01-clean-login", `${webBase}/login`);

  // 2) 同一个 profile 注入一个明显无效的 token，再开 /login —— 复现用户看到的「弹回首页」
  await send("Page.navigate", { url: `${webBase}/market` }, sessionId);
  await delay(2500);
  await evaluate(sessionId, `localStorage.setItem("store_os_token", "expired.invalid.token"); localStorage.getItem("store_os_token")`);
  await snap("02-stale-token-login", `${webBase}/login`);
  await snap("03-stale-token-market", `${webBase}/market`);
  const stuck = await evaluate(sessionId, `localStorage.getItem("store_os_token")`);
  console.log(`\nlocalStorage store_os_token after visiting /login & /market = ${stuck}`);

  // 3) 电脑端微信授权页实际长什么样
  const redirectUri = encodeURIComponent(`${webBase}/wechat-callback`);
  const authorizeUrl = `https://open.weixin.qq.com/connect/oauth2/authorize?appid=wxf405233d62ec376a&redirect_uri=${redirectUri}&response_type=code&scope=snsapi_userinfo&state=probe#wechat_redirect`;
  await snap("04-desktop-wechat-authorize", authorizeUrl);

  console.log("\nJSON=" + JSON.stringify(results));
} finally {
  socket.close();
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill();
  await exited;
}

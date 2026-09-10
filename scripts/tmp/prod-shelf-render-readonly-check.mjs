// 只读检查：PROD 货架是否真的渲染出来（上面注册截图上仍显示「正在加载货架…」，
// 需要区分「截图拍早了」和「货架卡住加载不出来」）。不提交任何表单、不写数据。
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const webBase = (process.env.SHELF_WEB_URL ?? "https://api.lcppch.top/os-v2").replace(/\/+$/, "");
const chromePath = process.env.DEPLOY_CHECK_CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const shotDir = process.env.SHOT_DIR ?? path.join(tmpdir(), `shelf-render-${Date.now()}`);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const userDataDir = await mkdtemp(path.join(tmpdir(), "shelf-render-chrome-"));
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
const consoleErrors = [];
socket.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data);
  if (msg.method === "Runtime.consoleAPICalled" && msg.params?.type === "error") {
    consoleErrors.push((msg.params.args ?? []).map((a) => a.value ?? a.description ?? "").join(" "));
  }
  if (msg.method === "Runtime.exceptionThrown") {
    consoleErrors.push(msg.params?.exceptionDetails?.exception?.description ?? "pageerror");
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
const evaluate = async (sessionId, fn) => (await send("Runtime.evaluate", {
  expression: `(${fn})()`, returnByValue: true, awaitPromise: true
}, sessionId)).result?.value;
const waitFor = async (sessionId, fn, timeoutMs = 30000) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await evaluate(sessionId, fn).catch(() => false);
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`waitFor timeout: ${fn}`);
    await delay(300);
  }
};

await mkdir(shotDir, { recursive: true });
try {
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  await send("Page.enable", {}, sessionId);
  await send("Runtime.enable", {}, sessionId);
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1600, deviceScaleFactor: 1, mobile: false }, sessionId);
  await send("Page.navigate", { url: `${webBase}/market` }, sessionId);

  const shelf = await waitFor(sessionId, `() => {
    const cards = document.querySelectorAll("article.agent-card.skill-card").length;
    if (cards > 0) {
      return {
        cards,
        soon: document.querySelectorAll(".zone-soon").length,
        pill: document.querySelector(".wallet-pill")?.textContent?.trim() ?? null,
        loadingGone: !document.body.innerText.includes("正在加载货架")
      };
    }
    return false;
  }`, 40000);
  assert.ok(shelf.cards > 0, "the shelf renders agent cards");
  assert.equal(shelf.loadingGone, true, "the shelf finishes loading instead of staying on 正在加载货架");
  assert.match(shelf.pill ?? "", /未登录/, "anonymous visitor still sees the 未登录 pill");
  const breakdownExpr = "(() => {"
    + " const rows = Array.from(document.querySelectorAll('article.agent-card.skill-card'));"
    + " const soon = rows.filter((r) => r.querySelector('.zone-soon')).map((r) => r.textContent.trim().slice(0, 24));"
    + " return { total: rows.length, comingSoon: soon.length, comingSoonSample: soon.slice(0, 3) };"
    + " })()";
  const breakdown = (await send("Runtime.evaluate", { expression: breakdownExpr, returnByValue: true }, sessionId)).result?.value;
  const report = { ...shelf, breakdown };
  await writeFile(path.join(shotDir, "shelf-loaded.png"),
    Buffer.from((await send("Page.captureScreenshot", { format: "png" }, sessionId)).data, "base64"));
  const realErrors = consoleErrors.filter((e) => !/favicon|Download the React DevTools/i.test(e));
  assert.deepEqual(realErrors, [], `console must stay clean: ${realErrors.join(" | ")}`);
  await writeFile(path.join(shotDir, "shelf-report.json"), JSON.stringify(report, null, 2), "utf8");
  console.log("prod_shelf_render_readonly_check:PASS");
  console.log(JSON.stringify(report, null, 2));
  console.log(`shot=${path.join(shotDir, "shelf-loaded.png")}`);
} finally {
  socket.close();
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill();
  await exited;
}

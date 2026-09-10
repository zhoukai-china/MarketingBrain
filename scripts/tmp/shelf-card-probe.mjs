// 只读探针：抓 /market 货架每张卡的名字、角标文案、以及卡片的实际不透明度，
// 用来确认「开发中」角标是否真的渲染出来、以及卡片是否被样式洗白。
// 不提交表单、不写任何数据。
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const webBase = (process.env.SHELF_WEB_URL ?? "https://api.lcppch.top/os-v2").replace(/\/+$/, "");
const chromePath = process.env.DEPLOY_CHECK_CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const shotDir = process.env.SHOT_DIR ?? path.join(tmpdir(), `shelf-card-probe-${Date.now()}`);
const waitMs = Number(process.env.SHELF_SETTLE_MS ?? 6000);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const userDataDir = await mkdtemp(path.join(tmpdir(), "shelf-probe-chrome-"));
const child = spawn(chromePath, [
  "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  "--window-size=1440,2400", "--remote-debugging-port=0", `--user-data-dir=${userDataDir}`, "about:blank"
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

await mkdir(shotDir, { recursive: true });
try {
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  await send("Page.enable", {}, sessionId);
  await send("Runtime.enable", {}, sessionId);
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 2400, deviceScaleFactor: 1, mobile: false }, sessionId);
  await send("Page.navigate", { url: `${webBase}/market` }, sessionId);
  await delay(waitMs);

  const probeExpr = `(() => {
    const cards = Array.from(document.querySelectorAll("article.agent-card.skill-card"));
    return cards.map((c) => {
      const cs = getComputedStyle(c);
      return {
        name: (c.querySelector(".ac-title, h3, h2")?.textContent ?? "").trim().slice(0, 30),
        chips: Array.from(c.querySelectorAll(".chip, .ac-foot .chip")).map((x) => x.textContent.trim()),
        foot: (c.querySelector(".ac-foot")?.textContent ?? "").trim(),
        opacity: cs.opacity,
        filter: cs.filter,
        disabled: c.className.includes("soon") || c.className.includes("off")
      };
    });
  })()`;
  const cards = (await send("Runtime.evaluate", { expression: probeExpr, returnByValue: true }, sessionId)).result?.value;
  const soonChips = cards.filter((c) => c.chips.some((t) => t.includes("开发中")) || c.foot.includes("开发中")).length;
  const report = { total: cards.length, cardsWith开发中: soonChips, cards };
  await writeFile(path.join(shotDir, "shelf-probe.png"),
    Buffer.from((await send("Page.captureScreenshot", { format: "png" }, sessionId)).data, "base64"));
  console.log(`total=${cards.length} cardsWithSoonBadge=${soonChips}`);
  console.log(JSON.stringify(report, null, 2));
  console.log(`shot=${path.join(shotDir, "shelf-probe.png")}`);
} finally {
  socket.close();
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill();
  await exited;
}

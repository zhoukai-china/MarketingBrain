#!/usr/bin/env node
/**
 * 临时只读探针：把 0909 原型侧栏品牌图与内测实例侧栏品牌图按**同一元素框**、同一
 * deviceScaleFactor 截出来，直接对比像素哈希，用来判定「兰琪 logo 头像不对」到底是
 * 图片不一样、还是渲染盒子不一样，还是只是肉眼错觉。
 *
 * 只截图，不改任何远端状态。
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const outDir = process.argv[2] ?? path.join(tmpdir(), "lanqi-logo-pixel-diff");
const port = 9417;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CHROME_CANDIDATES = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  path.join(process.env.LOCALAPPDATA ?? "", "Google/Chrome/Application/chrome.exe"),
  path.join(process.env.LOCALAPPDATA ?? "", "Microsoft/Edge/Application/msedge.exe"),
];

class CdpSession {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    socket.addEventListener("message", (event) => {
      const payload = JSON.parse(event.data);
      if (payload.id && this.pending.has(payload.id)) {
        const { resolve, reject } = this.pending.get(payload.id);
        this.pending.delete(payload.id);
        if (payload.error) reject(new Error(payload.error.message));
        else resolve(payload.result);
      }
    });
  }
  static async connect(wsUrl) {
    const socket = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", () => reject(new Error("CDP 连接失败")), { once: true });
    });
    return new CdpSession(socket);
  }
  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    const message = { id, method, params };
    if (sessionId) message.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify(message));
    });
  }
}

async function evaluate(root, sessionId, expression) {
  const result = await root.send(
    "Runtime.evaluate",
    { expression, returnByValue: true, awaitPromise: true },
    sessionId
  );
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? "eval failed");
  return result.result.value;
}

async function captureImg(root, sessionId, selector, file) {
  const info = await evaluate(
    root,
    sessionId,
    `(async () => {
      const img = document.querySelector(${JSON.stringify(selector)});
      if (!img) return null;
      await img.decode().catch(() => {});
      const r = img.getBoundingClientRect();
      const cs = getComputedStyle(img);
      return { x: r.x, y: r.y, width: r.width, height: r.height,
        src: img.currentSrc || img.src, nw: img.naturalWidth, nh: img.naturalHeight,
        fit: cs.objectFit, radius: cs.borderRadius, bg: cs.backgroundColor,
        border: cs.borderTopWidth + " " + cs.borderTopColor,
        fontSize: cs.fontSize, boxSizing: cs.boxSizing };
    })()`
  );
  if (!info) return null;
  const shot = await root.send("Page.captureScreenshot", {
    format: "png",
    clip: { x: info.x, y: info.y, width: info.width, height: info.height, scale: 8 },
  }, sessionId);
  const buffer = Buffer.from(shot.data, "base64");
  await writeFile(path.join(outDir, file), buffer);
  return { ...info, bytes: buffer.length, sha256: createHash("sha256").update(buffer).digest("hex").slice(0, 16) };
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const chromePath = CHROME_CANDIDATES.find((p) => p && existsSync(p));
  if (!chromePath) throw new Error("未找到 Chrome/Edge");
  const userDataDir = await mkdtemp(path.join(tmpdir(), "lanqi-logo-pixel-chrome-"));
  const chrome = spawn(chromePath, [
    "--headless=new",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "about:blank",
  ], { stdio: "ignore" });

  let version = null;
  for (let i = 0; i < 80 && !version; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) version = await res.json();
    } catch { /* wait */ }
    if (!version) await sleep(250);
  }
  if (!version) throw new Error("Chrome DevTools 端点未就绪");

  const root = await CdpSession.connect(version.webSocketDebuggerUrl);

  const targets = [
    { name: "proto", url: "https://ai.lcppch.top/lanqi/acquire.html", selector: "img.sh-icon" },
    { name: "ours", url: "https://api.lcppch.top/lanqi-test/lanqi/moments", selector: "img.lq-pd__logo" },
  ];

  const results = [];
  for (const target of targets) {
    const { targetId } = await root.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await root.send("Target.attachToTarget", { targetId, flatten: true });
    await root.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
    await root.send("Page.enable", {}, sessionId);
    await root.send("Page.navigate", { url: target.url }, sessionId);
    await sleep(5000);
    const info = await captureImg(root, sessionId, target.selector, `${target.name}-logo.png`);
    results.push({ target: target.name, url: target.url, ...info });
    await root.send("Target.closeTarget", { targetId });
  }

  console.log(JSON.stringify(results, null, 2));
  console.log("outDir=" + outDir);
  chrome.kill();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

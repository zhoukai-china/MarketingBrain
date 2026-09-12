#!/usr/bin/env node
/**
 * 临时只读探针：把原型侧栏品牌位与内测实例侧栏品牌位按同一 deviceScaleFactor 截出来，
 * 用于肉眼比对「兰琪 logo 头像不对」到底是图片错、尺寸错还是样式错。
 *
 * 只截图，不改任何远端状态。
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const outDir = process.argv[2] ?? path.join(tmpdir(), "lanqi-logo-compare");
const port = 9411;
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

async function captureClip(root, sessionId, selector, file, pad = 6) {
  const box = await evaluate(
    root,
    sessionId,
    `(() => { const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null; const r = el.getBoundingClientRect();
      const img = el.querySelector("img");
      return { x: r.x, y: r.y, width: r.width, height: r.height,
        img: img ? { src: img.currentSrc || img.src, nw: img.naturalWidth, nh: img.naturalHeight,
          w: img.getBoundingClientRect().width, h: img.getBoundingClientRect().height,
          fit: getComputedStyle(img).objectFit, radius: getComputedStyle(img).borderRadius,
          bg: getComputedStyle(img).backgroundColor } : null }; })()`
  );
  if (!box) return null;
  const clip = {
    x: Math.max(0, box.x - pad),
    y: Math.max(0, box.y - pad),
    width: box.width + pad * 2,
    height: box.height + pad * 2,
    scale: 4,
  };
  const shot = await root.send("Page.captureScreenshot", { format: "png", clip }, sessionId);
  await writeFile(path.join(outDir, file), Buffer.from(shot.data, "base64"));
  return box;
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const chromePath = CHROME_CANDIDATES.find((p) => p && existsSync(p));
  if (!chromePath) throw new Error("未找到 Chrome/Edge");
  const userDataDir = await mkdtemp(path.join(tmpdir(), "lanqi-logo-chrome-"));
  const chrome = spawn(
    chromePath,
    [
      "--headless=new",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gpu",
      "about:blank",
    ],
    { stdio: "ignore" }
  );

  let version = null;
  for (let i = 0; i < 80 && !version; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) version = await res.json();
    } catch {
      /* wait */
    }
    if (!version) await sleep(250);
  }
  if (!version) throw new Error("DevTools 未就绪");

  const root = await CdpSession.connect(version.webSocketDebuggerUrl);

  const targets = [
    {
      name: "proto",
      url: "https://ai.lcppch.top/lanqi/acquire.html",
      selector: ".sidebar-header",
      ready: "!!document.querySelector('.sh-icon')",
    },
    {
      name: "ours",
      url: "https://api.lcppch.top/lanqi-test/lanqi/moments",
      selector: ".lq-pd__brand",
      ready: "!!document.querySelector('.lq-pd__logo')",
    },
  ];

  for (const t of targets) {
    const created = await root.send("Target.createTarget", { url: "about:blank" });
    const attached = await root.send("Target.attachToTarget", { targetId: created.targetId, flatten: true });
    const sid = attached.sessionId;
    await root.send("Page.enable", {}, sid);
    await root.send("Runtime.enable", {}, sid);
    await root.send("Emulation.setDeviceMetricsOverride",
      { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false }, sid);
    await root.send("Page.navigate", { url: t.url }, sid);

    let ready = false;
    for (let i = 0; i < 120 && !ready; i += 1) {
      try {
        ready = await evaluate(root, sid, t.ready);
      } catch {
        ready = false;
      }
      if (!ready) await sleep(250);
    }
    await evaluate(
      root,
      sid,
      `(async () => { const img = document.querySelector(${JSON.stringify(t.selector)})?.querySelector("img");
        if (img) { try { await img.decode(); } catch { /* ignore */ } }
        return true; })()`
    );
    await sleep(2500);
    const box = await captureClip(root, sid, t.selector, `${t.name}-brand.png`);
    const shotHdr = await root.send("Page.captureScreenshot", { format: "png" }, sid);
    await writeFile(path.join(outDir, `${t.name}-view.png`), Buffer.from(shotHdr.data, "base64"));
    console.log(`[${t.name}] ${t.url}`);
    console.log(`  selector=${t.selector} box=${JSON.stringify(box)}`);
    await root.send("Target.closeTarget", { targetId: created.targetId });
  }

  chrome.kill();
  console.log(`outDir=${outDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

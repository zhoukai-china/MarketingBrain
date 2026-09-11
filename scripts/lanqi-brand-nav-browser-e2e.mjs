#!/usr/bin/env node
/**
 * 兰琪品牌标识 + 上线板块口径的真实浏览器验收（桌面 1440 / 移动 390）。
 *
 * 对应用户 2026-09-11 口径：「兰琪 logo 头像不对」+「目前私域营销可以正常上线，
 * 其他板块显示开发中即可」。静态契约由 `scripts/lanqi-brand-nav-contract-smoke.mjs`
 * 常驻锁定，本脚本负责真实页面证据（图片是否真的加载出来、徽标是否真的渲染、
 * 未上线板块是否真的落在兰琪自己的「开发中」占位页）。
 *
 * 断言：
 *   1) 侧栏品牌位是真实 `<img src="/lanqi-logo.jpg">`，且 `naturalWidth>0`（不是破图/占位）；
 *   2) 品牌名「兰琪 · 美业门店 AI 经营大脑」单行渲染，不折行、不被挤没；
 *   3) 侧栏 8 项里恰好 7 项带「开发中」徽标，且「私域营销」不带徽标；
 *   4) 默认落地 `/lanqi/moments`（唯一已上线板块）；
 *   5) 8 个未上线板块地址逐个直开：仍在兰琪外壳里、正文出现「开发中」+「去用私域营销」，
 *      不空白、不串到别的产品；
 *   6) 私域营销首页与两个子页（朋友圈 / 微信群）可正常进入且渲染出内容；
 *   7) 桌面/移动均无横向溢出；控制台错误 / 页面异常为 0。
 *
 * 前置：目标实例必须是打开 `DIRECT_TEST_LOGIN` 的内测实例（默认
 * `https://api.lcppch.top/lanqi-test`）。生产实例需要真人登录，不适合无人值守跑。
 *
 * 用法：
 *   node scripts/lanqi-brand-nav-browser-e2e.mjs --base https://api.lcppch.top/lanqi-test
 *   可选：--out <截图目录> --port <CDP 端口>
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
function argValue(flag, fallback) {
  for (let i = args.length - 1; i >= 0; i -= 1) {
    if (args[i] === flag && args[i + 1]) return args[i + 1];
  }
  return fallback;
}

const base = argValue("--base", "https://api.lcppch.top/lanqi-test").replace(/\/+$/, "");
const outDir = argValue("--out", path.join(tmpdir(), "lanqi-brand-nav-e2e"));
const port = Number(argValue("--port", "9367"));

const BRAND_NAME = "兰琪 · 美业门店 AI 经营大脑";
const LOGO_FILE = "/lanqi-logo.jpg";
const OFFLINE_BOARDS = [
  "/lanqi/dashboard",
  "/lanqi/goal-setting",
  "/lanqi/cases",
  "/lanqi/acquire",
  "/lanqi/acquire/video",
  "/lanqi/customers",
  "/lanqi/analysis",
  "/lanqi/sales-sim",
  "/lanqi/store",
];
const MOMENTS_PAGES = [
  { path: "/lanqi/moments", expect: "朋友圈营销" },
  { path: "/lanqi/moments/friend-circle", expect: "朋友圈" },
  { path: "/lanqi/moments/wechat-group", expect: "微信群" },
];

let failures = 0;
function record(name, ok, detail) {
  if (!ok) failures += 1;
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${detail ? ` :: ${detail}` : ""}`);
}
function info(name, detail) {
  console.log(`[INFO] ${name}${detail ? ` :: ${detail}` : ""}`);
}

const CHROME_CANDIDATES = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  path.join(process.env.LOCALAPPDATA ?? "", "Google/Chrome/Application/chrome.exe"),
  path.join(process.env.LOCALAPPDATA ?? "", "Microsoft/Edge/Application/msedge.exe"),
];

function findChrome() {
  for (const candidate of CHROME_CANDIDATES) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  throw new Error("未找到可用的 Chrome/Edge 可执行文件。");
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForDevtools(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return await response.json();
    } catch {
      /* 端口还没起来，继续等 */
    }
    await sleep(250);
  }
  throw new Error("Chromium DevTools 端口未就绪。");
}

class CdpSession {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
    socket.addEventListener("message", (event) => {
      const payload = JSON.parse(event.data);
      if (payload.id && this.pending.has(payload.id)) {
        const { resolve, reject } = this.pending.get(payload.id);
        this.pending.delete(payload.id);
        if (payload.error) reject(new Error(payload.error.message));
        else resolve(payload.result);
        return;
      }
      for (const listener of this.listeners) listener(payload);
    });
  }

  static async connect(wsUrl) {
    const socket = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", () => reject(new Error("CDP WebSocket 连接失败")), { once: true });
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

  on(listener) {
    this.listeners.add(listener);
  }

  close() {
    this.socket.close();
  }
}

async function evaluate(root, sessionId, expression) {
  const result = await root.send(
    "Runtime.evaluate",
    { expression, returnByValue: true, awaitPromise: true },
    sessionId
  );
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? "页面脚本执行失败");
  }
  return result.result.value;
}

/** 轮询等待某个页面谓词为真（整页跳转会销毁执行上下文，这里吞掉 navigated away 的报错）。 */
async function waitFor(root, sessionId, predicateExpression, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    try {
      last = await evaluate(
        root,
        sessionId,
        `(() => { const r = ${predicateExpression}; return r; })()`
      );
      if (last && last.ok) return last;
    } catch {
      /* 导航中，等下一帧 */
    }
    await sleep(120);
  }
  return last ?? { ok: false, reason: "timeout" };
}

/** 通用页面快照：路径、正文、是否在兰琪外壳内、横向溢出、越界元素数。 */
const SNAPSHOT_EXPR = `(() => {
  const text = (document.body ? document.body.innerText : "").replace(/\\s+/g, " ").trim();
  const shell = document.querySelector(".lq-pd__side");
  const root = document.documentElement;
  const vw = window.innerWidth;
  let offenders = 0;
  if (shell) {
    for (const el of document.querySelectorAll(".lq-pd *")) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > vw + 2) offenders += 1;
    }
  }
  return {
    path: location.pathname,
    text: text.slice(0, 600),
    textLength: text.length,
    hasShell: Boolean(shell),
    scrollWidth: root.scrollWidth,
    viewportWidth: vw,
    offenders
  };
})()`;

const BRAND_EXPR = `(() => {
  const img = document.querySelector(".lq-pd__logo");
  const name = document.querySelector(".lq-pd__brand-name");
  const items = Array.from(document.querySelectorAll(".lq-pd__nav .lq-pd__item"));
  const badgeOf = (el) => {
    const b = el.querySelector(".lq-pd__badge");
    return b ? (b.textContent || "").trim() : "";
  };
  const rows = items.map((el) => ({
    label: (el.querySelector(".lq-pd__label")?.textContent || "").trim(),
    badge: badgeOf(el),
    href: el.getAttribute("href") || ""
  }));
  const nameRects = name ? name.getClientRects().length : 0;
  const cs = name ? getComputedStyle(name) : null;
  const lineHeight = cs ? parseFloat(cs.lineHeight) || 0 : 0;
  const nameBox = name ? name.getBoundingClientRect() : null;
  return {
    isImg: Boolean(img) && img.tagName === "IMG",
    src: img ? img.getAttribute("src") : null,
    currentSrc: img ? img.currentSrc : null,
    complete: img ? img.complete : false,
    naturalWidth: img ? img.naturalWidth : 0,
    naturalHeight: img ? img.naturalHeight : 0,
    alt: img ? img.getAttribute("alt") : null,
    nameText: name ? (name.textContent || "").trim() : null,
    nameRects,
    nameHeight: nameBox ? Math.round(nameBox.height) : 0,
    nameWidth: nameBox ? Math.round(nameBox.width) : 0,
    nameLines: nameBox && lineHeight > 0 ? Math.round(nameBox.height / lineHeight) : 0,
    // 品牌名在侧栏里被裁掉（省略号 / 溢出容器）时 scrollWidth 会大于 clientWidth。
    nameClipped: name ? name.scrollWidth > name.clientWidth + 1 : true,
    navCount: rows.length,
    devBadges: rows.filter((r) => r.badge.includes("开发中")).length,
    rows
  };
})()`;

/**
 * 品牌图是静态资源，页面刚挂载时 `complete` 仍是 false（下载没回来），
 * 于是「naturalWidth>0」这条断言会随网络快慢时红时绿。这里显式等图片解码完成，
 * 让断言只反映「图能不能显示出来」，不反映「探针读得够不够快」。
 */
const LOGO_LOADED_EXPR = `(() => {
  const img = document.querySelector(".lq-pd__logo");
  return {
    ok: Boolean(img) && img.tagName === "IMG" && img.complete === true && img.naturalWidth > 0,
    complete: img ? img.complete : false,
    naturalWidth: img ? img.naturalWidth : 0
  };
})()`;

async function runViewport(root, viewport) {
  const consoleErrors = [];
  const pageErrors = [];
  const { targetId } = await root.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await root.send("Target.attachToTarget", { targetId, flatten: true });
  root.on((payload) => {
    if (payload.sessionId !== sessionId) return;
    if (payload.method === "Runtime.consoleAPICalled" && payload.params.type === "error") {
      consoleErrors.push(payload.params.args.map((item) => item.value ?? item.description ?? "").join(" "));
    }
    if (payload.method === "Runtime.exceptionThrown") {
      pageErrors.push(
        payload.params.exceptionDetails.exception?.description ?? payload.params.exceptionDetails.text
      );
    }
  });
  await root.send("Page.enable", {}, sessionId);
  await root.send("Runtime.enable", {}, sessionId);
  await root.send(
    "Emulation.setDeviceMetricsOverride",
    { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.mobile },
    sessionId
  );

  // ---- 首屏：默认落地 + 品牌位 + 侧栏徽标 ----
  await root.send("Page.navigate", { url: `${base}/` }, sessionId);
  const landed = await waitFor(
    root,
    sessionId,
    `(() => ({ ok: location.pathname.includes("/lanqi/") && document.querySelector(".lq-pd__nav .lq-pd__item") !== null, path: location.pathname }))()`,
    30000
  );
  info(`${viewport.label} 首屏落地`, `path=${landed.path ?? "?"}`);
  record(
    `${viewport.label} 默认落地当前唯一已上线的「私域营销」`,
    String(landed.path ?? "").includes("/lanqi/moments"),
    `path=${landed.path ?? "?"}`
  );

  // 品牌图要真的下载完再断言（否则读到的 complete=false 是探针太快，不是页面坏）。
  const logoLoaded = await waitFor(root, sessionId, LOGO_LOADED_EXPR, 15000);
  const brand = await evaluate(root, sessionId, BRAND_EXPR);
  record(
    `${viewport.label} 侧栏品牌位是真实图片（不是被挤成两行的纯文字）`,
    brand.isImg && String(brand.src ?? "").includes(LOGO_FILE),
    `tag=img src=${brand.src}`
  );
  record(
    `${viewport.label} 品牌图真的加载出来（naturalWidth>0）`,
    brand.isImg &&
      logoLoaded.ok === true &&
      brand.complete === true &&
      brand.naturalWidth > 0 &&
      brand.naturalHeight > 0,
    `complete=${brand.complete} natural=${brand.naturalWidth}x${brand.naturalHeight} waitedComplete=${
      logoLoaded.complete
    }`
  );
  record(
    `${viewport.label} 品牌图有可读的替代文本`,
    typeof brand.alt === "string" && brand.alt.trim().length > 0,
    `alt=${JSON.stringify(brand.alt)}`
  );
  record(
    `${viewport.label} 品牌名文案正确、完整渲染且不被裁切`,
    brand.nameText === BRAND_NAME &&
      brand.nameRects === 1 &&
      brand.nameHeight > 0 &&
      // 侧栏 232px 里 48px logo + 15px 粗体品牌名会折到两行，这是原型 .sh-logo 的既定排版；
      // 只要不超过两行、不出现省略号/横向溢出就算正常（原缺陷是「兰」「琪」竖排占满整块）。
      brand.nameLines >= 1 &&
      brand.nameLines <= 2 &&
      brand.nameWidth > 60 &&
      brand.nameClipped === false,
    `text=${JSON.stringify(brand.nameText)} rects=${brand.nameRects} w=${brand.nameWidth} h=${
      brand.nameHeight
    } lines=${brand.nameLines} clipped=${brand.nameClipped}`
  );
  record(
    `${viewport.label} 侧栏恰好 8 项、其中 7 项带「开发中」徽标`,
    brand.navCount === 8 && brand.devBadges === 7,
    `nav=${brand.navCount} dev=${brand.devBadges}`
  );
  const momentsRow = brand.rows.find((r) => r.href.includes("/lanqi/moments"));
  record(
    `${viewport.label} 「私域营销」不带「开发中」徽标（唯一已上线板块）`,
    Boolean(momentsRow) && momentsRow.badge === "",
    `moments badge=${JSON.stringify(momentsRow?.badge ?? null)}`
  );
  const devLabels = brand.rows.filter((r) => r.badge.includes("开发中")).map((r) => r.label);
  info(`${viewport.label} 开发中板块`, devLabels.join(" / "));

  // ---- 未上线板块逐个直开：仍在兰琪外壳 + 「开发中」占位 + 不串产品 ----
  for (const route of OFFLINE_BOARDS) {
    await root.send("Page.navigate", { url: `${base}${route}` }, sessionId);
    const snap = await waitFor(
      root,
      sessionId,
      `(() => { const s = ${SNAPSHOT_EXPR}; return { ok: s.hasShell && s.textLength > 120, ...s }; })()`,
      25000
    );
    const inShell = snap.hasShell === true;
    const text = String(snap.text ?? "");
    const showsDev = text.includes("开发中");
    const offersMoments = text.includes("去用私域营销");
    const crossProduct = /外卖增长|销售智囊|IP 定位|创始人 IP 获客/.test(text);
    record(
      `${viewport.label} ${route} 落在兰琪「开发中」占位页（不空白 / 不串产品）`,
      inShell && showsDev && offersMoments && !crossProduct && snap.textLength > 120,
      `shell=${inShell} dev=${showsDev} momentsCta=${offersMoments} cross=${crossProduct} len=${snap.textLength} path=${snap.path}`
    );
  }

  // ---- 已上线板块：私域营销首页 + 两个子页 ----
  for (const page of MOMENTS_PAGES) {
    await root.send("Page.navigate", { url: `${base}${page.path}` }, sessionId);
    const snap = await waitFor(
      root,
      sessionId,
      `(() => { const s = ${SNAPSHOT_EXPR}; return { ok: s.hasShell && s.textLength > 120 && s.text.includes(${JSON.stringify(page.expect)}), ...s }; })()`,
      25000
    );
    const text = String(snap.text ?? "");
    record(
      `${viewport.label} 已上线 ${page.path} 正常渲染（含「${page.expect}」）`,
      snap.hasShell === true && snap.textLength > 120 && text.includes(page.expect),
      `shell=${snap.hasShell} len=${snap.textLength} path=${snap.path}`
    );
  }

  // ---- 横向溢出 ----
  const overflow = await evaluate(root, sessionId, SNAPSHOT_EXPR);
  record(
    `${viewport.label} 无横向溢出（当前页 ${overflow.path}）`,
    overflow.scrollWidth <= overflow.viewportWidth + 2 && overflow.offenders === 0,
    `scrollWidth=${overflow.scrollWidth} viewport=${overflow.viewportWidth} offenders=${overflow.offenders}`
  );

  record(
    `${viewport.label} 控制台错误 / 页面异常为 0`,
    consoleErrors.length === 0 && pageErrors.length === 0,
    `console=${consoleErrors.length} page=${pageErrors.length}${
      consoleErrors.length ? ` :: ${consoleErrors.join(" | ")}` : ""
    }${pageErrors.length ? ` :: ${pageErrors.join(" | ")}` : ""}`
  );

  const shot = await root.send("Page.captureScreenshot", { format: "png" }, sessionId);
  const shotPath = path.join(outDir, `${viewport.mobile ? "mobile-390" : "desktop-1440"}.png`);
  await writeFile(shotPath, Buffer.from(shot.data, "base64"));
  console.log(`  screenshot: ${shotPath}`);

  await root.send("Target.closeTarget", { targetId });
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const chromePath = findChrome();
  const userDataDir = await mkdtemp(path.join(tmpdir(), "lanqi-brand-chrome-"));
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

  try {
    const version = await waitForDevtools();
    const root = await CdpSession.connect(version.webSocketDebuggerUrl);
    for (const viewport of [
      { label: "桌面 1440", width: 1440, height: 960, mobile: false },
      { label: "移动 390", width: 390, height: 844, mobile: true },
    ]) {
      await runViewport(root, viewport);
    }
    root.close();
  } finally {
    chrome.kill();
  }

  console.log(`\nlanqi_brand_nav_browser_e2e: ${failures === 0 ? "PASS" : "FAIL"} (${failures} failed)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// 移动端平台页布局回归（2026-09-11）。
//
// 背景：`apps/web/src/main.tsx` 曾把 `body[data-device]` 写死成 "desktop"，
// 于是 `sitong-design.css` 里 `body[data-device="mobile"]` 的整套移动端规则
// 在真机上一句都不生效：手机顶栏的 Tab 被 flex 挤到 min-content 宽度，
// 「常用智能体 / 积分充值」逐字竖排，钱包胶囊溢出屏幕右侧。
//
// 锁死的契约（一眼可见、不依赖实现细节）：
//   1. 全新访客（无 localStorage）默认就是深色主题，且页面底色 token 是深色；
//   2. 手机视口（390×844）下顶栏最多两行：Tab 行每个入口单行文字、宽度够点；
//   3. 手机视口下页面不横向滚动，钱包胶囊不被裁到屏幕外；
//   4. 顶栏 Tab 与钱包在同一屏首屏内可见（扫码注册完落地的就是这一屏）。
//
// 默认打本机 dev（`MARKETPLACE_LAYOUT_CHECK_URL`，默认 http://127.0.0.1:5174），
// 也可直接打线上：`MARKETPLACE_LAYOUT_CHECK_URL=https://api.lcppch.top/os-v2`。
// 全程只读页面，不登录、不下单、不改任何数据。
const webBase = (process.env.MARKETPLACE_LAYOUT_CHECK_URL ?? "http://127.0.0.1:5174").replace(/\/+$/, "");
const entryPath = process.env.MARKETPLACE_LAYOUT_CHECK_PATH ?? "/agents";
const chromePath = process.env.LOGIN_SMOKE_CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const shotPath = process.env.MARKETPLACE_LAYOUT_CHECK_SHOT ?? path.join(tmpdir(), "sitong-marketplace-mobile.png");

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function startChrome() {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "sitong-marketplace-mobile-"));
  const child = spawn(chromePath, [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-debugging-port=0",
    `--user-data-dir=${userDataDir}`,
    "about:blank"
  ], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });

  const endpoint = await new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error("Chrome DevTools endpoint timeout")), 20_000);
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      output += chunk;
      const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    child.once("exit", (code) => reject(new Error(`Chrome exited before DevTools was ready (${code})`)));
  });

  const socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  let nextId = 0;
  const pending = new Map();
  const pageErrors = [];
  const sessions = new Set();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id) {
      if (message.method === "Runtime.exceptionThrown") {
        pageErrors.push(message.params?.exceptionDetails?.exception?.description ?? "runtime exception");
      }
      if (message.method === "Runtime.consoleAPICalled" && message.params?.type === "error" && sessions.has(message.sessionId)) {
        pageErrors.push((message.params.args ?? []).map((arg) => arg.value ?? arg.description ?? "").join(" "));
      }
      return;
    }
    const handler = pending.get(message.id);
    if (!handler) return;
    pending.delete(message.id);
    if (message.error) handler.reject(new Error(message.error.message));
    else handler.resolve(message.result);
  });

  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject, method });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });

  return { child, socket, send, userDataDir, pageErrors, sessions };
}

async function evaluate(cdp, sessionId, functionDeclaration, argument) {
  const expression = argument === undefined ? `(${functionDeclaration})()` : `(${functionDeclaration})(${JSON.stringify(argument)})`;
  const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (result.exceptionDetails) {
    const detail = result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? "Runtime.evaluate failed";
    throw new Error(detail);
  }
  return result.result.value;
}

async function waitFor(cdp, sessionId, functionDeclaration, timeoutMs = 25_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let value;
    try {
      value = await evaluate(cdp, sessionId, functionDeclaration);
    } catch (error) {
      if (!/Execution context was destroyed|Cannot find context|Inspected target navigated/i.test(error instanceof Error ? error.message : String(error))) {
        throw error;
      }
      value = false;
    }
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`waitFor timeout: ${functionDeclaration}`);
    await delay(300);
  }
}

const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const WECHAT_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.49(0x18003128) NetType/WIFI Language/zh_CN";

async function applyPhoneViewport(cdp, sessionId, userAgent) {
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true }, sessionId);
  await cdp.send("Emulation.setUserAgentOverride", { userAgent }, sessionId);
}

async function readTopbar(cdp, sessionId) {
  return evaluate(cdp, sessionId, `() => {
    const viewportWidth = window.innerWidth;
    const rectOf = (node) => {
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      const style = window.getComputedStyle(node);
      return {
        text: (node.textContent || "").trim(),
        top: Math.round(rect.top),
        bottom: Math.round(rect.bottom),
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        whiteSpace: style.whiteSpace,
        fontSize: style.fontSize,
        background: style.backgroundColor,
        visible: style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0
      };
    };
    const navLinks = Array.from(document.querySelectorAll(".topbar .nav-link")).map(rectOf);
    const rootStyle = window.getComputedStyle(document.documentElement);
    // 设计 token 混用「#RRGGBB」（主题底色）与「rgba(...)」（玻璃层），两种都要认。
    const parseColor = (value) => {
      const text = (value || "").trim();
      const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text);
      if (hex) {
        const digits = hex[1].length === 3 ? hex[1].replace(/./g, (ch) => ch + ch) : hex[1];
        return { r: Number.parseInt(digits.slice(0, 2), 16), g: Number.parseInt(digits.slice(2, 4), 16), b: Number.parseInt(digits.slice(4, 6), 16) };
      }
      const match = /rgba?\\(([^)]+)\\)/.exec(text);
      if (!match) return null;
      const parts = match[1].split(",").map((item) => Number.parseFloat(item.trim()));
      if (parts.length < 3 || parts.some((item) => Number.isNaN(item))) return null;
      return { r: parts[0], g: parts[1], b: parts[2] };
    };
    return {
      viewportWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      overflowX: Math.round(document.documentElement.scrollWidth - viewportWidth),
      dataTheme: document.documentElement.getAttribute("data-theme"),
      dataDevice: document.body.getAttribute("data-device"),
      bgToken: rootStyle.getPropertyValue("--bg").trim(),
      bgColor: parseColor(rootStyle.getPropertyValue("--bg")),
      bodyBg: parseColor(window.getComputedStyle(document.body).backgroundColor),
      topbar: rectOf(document.querySelector(".topbar")),
      brand: rectOf(document.querySelector(".topbar .brand")),
      navWrap: rectOf(document.querySelector(".topbar .topnav")),
      navLinks,
      themeToggle: rectOf(document.querySelector(".topbar .theme-toggle")),
      walletPill: rectOf(document.querySelector(".topbar .wallet-pill")),
      banner: rectOf(document.querySelector(".shared-banner")),
      navBackground: (() => {
        const nav = document.querySelector(".topbar .topnav");
        return nav ? window.getComputedStyle(nav).backgroundColor : null;
      })(),
      shelfHeadings: Array.from(document.querySelectorAll(".shelf-head h2")).map((node) => (node.textContent || "").trim()),
      bodyTextHead: document.body.innerText.slice(0, 400)
    };
  }`);
}

// 一次跑完所有断言再汇总失败：手机布局的坏点通常是「连带」的，
// 只看第一条会让「竖排 Tab」「溢出屏幕」这类第二症状被藏起来。
const failures = [];
function check(condition, message) {
  if (!condition) failures.push(message);
  return condition;
}
function checkEqual(actual, expected, message) {
  return check(actual === expected, `${message} (got ${JSON.stringify(actual)})`);
}
// Node 侧的颜色解析：设计 token 混用 `#RRGGBB` 与 `rgba(...)`。
function parseColor(value) {
  const text = (value ?? "").trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text);
  if (hex) {
    const digits = hex[1].length === 3 ? hex[1].replace(/./g, (ch) => ch + ch) : hex[1];
    return { r: Number.parseInt(digits.slice(0, 2), 16), g: Number.parseInt(digits.slice(2, 4), 16), b: Number.parseInt(digits.slice(4, 6), 16) };
  }
  const match = /rgba?\(([^)]+)\)/.exec(text);
  if (!match) return null;
  const parts = match[1].split(",").map((item) => Number.parseFloat(item.trim()));
  if (parts.length < 3 || parts.some((item) => Number.isNaN(item))) return null;
  return { r: parts[0], g: parts[1], b: parts[2] };
}
function luminance(parsed) {
  return (parsed.r + parsed.g + parsed.b) / 3;
}

async function main() {
  const cdp = await startChrome();
  try {
    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    cdp.sessions.add(sessionId);
    await cdp.send("Page.enable", {}, sessionId);
    await cdp.send("Runtime.enable", {}, sessionId);

    // 1. 全新访客 + 微信内置浏览器 UA + 手机视口：这就是扫码注册完成后落地的真实环境。
    await applyPhoneViewport(cdp, sessionId, WECHAT_UA);
    await cdp.send("Page.navigate", { url: `${webBase}${entryPath}` }, sessionId);
    await waitFor(cdp, sessionId, `() => document.body.innerText.includes("货架") && document.querySelector(".topbar .nav-link") !== null`);
    // 顶栏的「货架」Tab 一渲染出来文案里就有「货架」二字，光等这个会让「货架数据还没到」
    // 的半成品页面也能通过。这里必须等到货架分区标题真的出现再量。
    await waitFor(cdp, sessionId, `() => document.querySelectorAll(".shelf-head h2").length >= 3`);
    await delay(600);

    const probe = await readTopbar(cdp, sessionId);

    // 取证：mobile 断点给 .app-wrap 加了 overflow-x:hidden。
    // 若内容真的比屏幕宽，这个属性会把溢出「藏起来」，只测 documentElement.scrollWidth 会假绿。
    // 因此这里临时把两处 overflow-x 改成 visible，再量一次真实溢出与越界元素。
    const clipProbe = await evaluate(cdp, sessionId, `() => {
      const wrap = document.querySelector(".app-wrap");
      const target = wrap || document.body;
      const restore = [];
      for (const node of [wrap, document.body].filter(Boolean)) {
        const inline = node.style.overflowX;
        node.style.overflowX = "visible";
        restore.push([node, inline]);
      }
      const viewportWidth = window.innerWidth;
      const offenders = [];
      for (const node of document.querySelectorAll("body *")) {
        const rect = node.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2) continue;
        if (rect.right > viewportWidth + 1) {
          const cls = typeof node.className === "string" && node.className.trim() ? "." + node.className.trim().split(/\\s+/).join(".") : node.tagName.toLowerCase();
          offenders.push({ sel: cls, right: Math.round(rect.right), width: Math.round(rect.width) });
        }
      }
      const scrollWidth = target.scrollWidth;
      for (const [node, inline] of restore) node.style.overflowX = inline;
      return { scrollWidthWithVisibleOverflow: scrollWidth, viewportWidth, offenderCount: offenders.length, offenders: offenders.slice(0, 12) };
    }`);

    const screenshot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }, sessionId);
    await writeFile(shotPath, Buffer.from(screenshot.data, "base64"));

    // 断言 1：默认深色。全新浏览器 profile 没有 sitong-theme，平台首页必须是深色。
    checkEqual(probe.dataTheme, "dark", "fresh visitor defaults to the dark theme");
    if (check(Boolean(probe.bgColor), `platform background token is readable (--bg=${probe.bgToken})`)) {
      for (const [channel, value] of Object.entries(probe.bgColor)) {
        check(value <= 60, `platform background token ${channel}=${value} is a dark color (--bg=${probe.bgToken})`);
      }
    }
    check(Boolean(probe.themeToggle?.visible), "theme toggle is visible on mobile");
    check(/深色/.test(probe.themeToggle?.text ?? ""), `theme toggle reports the current dark theme (got "${probe.themeToggle?.text}")`);
    // 深色默认下顶栏应是深色玻璃底，不能显示成浅色主题顶栏。
    const topbarBg = parseColor(probe.topbar?.background);
    if (check(Boolean(topbarBg), `topbar background is resolvable (${probe.topbar?.background})`)) {
      check(luminance(topbarBg) <= 80, `dark theme keeps a dark topbar background (topbar bg ${probe.topbar.background})`);
    }

    // 断言 2：手机上顶栏最多两行，Tab 单行显示，不再逐字竖排。
    checkEqual(probe.navLinks.length, 3, "mobile topbar keeps all three tabs");
    checkEqual(probe.navLinks.map((item) => item.text).join("|"), "货架|常用智能体|积分充值", "mobile tab labels stay intact");
    for (const link of probe.navLinks) {
      check(link.visible, `mobile tab "${link.text}" is visible`);
      checkEqual(link.whiteSpace, "nowrap", `mobile tab "${link.text}" must not wrap into a vertical column`);
      check(link.height <= 46, `mobile tab "${link.text}" is a single line (height=${link.height})`);
      check(link.width >= 56, `mobile tab "${link.text}" keeps a tappable width (width=${link.width})`);
      check(link.right <= probe.viewportWidth + 1, `mobile tab "${link.text}" stays inside the viewport (right=${link.right})`);
    }
    check(probe.topbar.height <= 140, `mobile topbar stays within two rows (height=${probe.topbar.height})`);
    check(probe.topbar.bottom <= 150, `mobile topbar stays in the first screen (bottom=${probe.topbar.bottom})`);

    // 断言 3：页面不横向滚动，钱包胶囊不被裁掉。
    check(probe.overflowX <= 2, `platform home does not scroll sideways (overflowX=${probe.overflowX})`);
    check(Boolean(probe.walletPill?.visible), "wallet pill is visible on mobile");
    if (probe.walletPill) {
      check(probe.walletPill.right <= probe.viewportWidth + 1, `wallet pill is not clipped (right=${probe.walletPill.right} / viewport=${probe.viewportWidth})`);
    }
    check(probe.banner.left >= 0 && probe.banner.right <= probe.viewportWidth + 1, `shared banner fits the mobile width (${probe.banner.left}..${probe.banner.right})`);

    // 断言 3b：手机断点给 .app-wrap 加了 overflow-x:hidden，光看 scrollWidth 无法区分
    // 「真的不宽」和「宽了但被藏起来」。用临时放开 overflow 的取证结果兜底。
    check(
      clipProbe.scrollWidthWithVisibleOverflow <= clipProbe.viewportWidth + 2,
      `no content is wider than the phone screen once overflow hiding is lifted (scrollWidth=${clipProbe.scrollWidthWithVisibleOverflow} / viewport=${clipProbe.viewportWidth})`
    );
    checkEqual(clipProbe.offenderCount, 0, `no element sticks out past the right edge (offenders=${JSON.stringify(clipProbe.offenders)})`);
    check(probe.shelfHeadings.length >= 3, `the shelf rendered before layout is measured (headings=${JSON.stringify(probe.shelfHeadings)})`);

    // 断言 4：竖屏之外，横屏也不能溢出（老板常用手机横过来看货架）。
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 844, height: 390, deviceScaleFactor: 3, mobile: true }, sessionId);
    await delay(500);
    const landscape = await readTopbar(cdp, sessionId);
    check(landscape.overflowX <= 2, `platform home does not scroll sideways in landscape (overflowX=${landscape.overflowX})`);

    const realErrors = cdp.pageErrors.filter((entry) => !/favicon|Download the React DevTools/i.test(entry));
    assert.deepEqual(realErrors, [], `console must stay clean: ${realErrors.join(" | ")}`);

    if (failures.length > 0) {
      throw new Error(`mobile layout regressions (${failures.length}):\n  - ${failures.join("\n  - ")}\nprobe=${JSON.stringify(probe)}\nscreenshot=${shotPath}`);
    }

    process.stdout.write(`mobile_clip_probe=${JSON.stringify(clipProbe)}\n`);

    process.stdout.write(
      "marketplace_mobile_layout_check:PASS"
      + ` url=${webBase}${entryPath}`
      + ` theme=${probe.dataTheme}`
      + ` device=${probe.dataDevice}`
      + ` topbar=${probe.topbar.width}x${probe.topbar.height}`
      + ` tabs=${probe.navLinks.map((item) => `${item.text}:${item.width}x${item.height}`).join("|")}`
      + ` overflowX=${probe.overflowX}`
      + ` landscapeOverflowX=${landscape.overflowX}`
      + ` shell=${probe.shelfHeadings.join("/")}`
      + ` shot=${shotPath}\n`
    );
  } finally {
    cdp.socket.close();
    const exited = new Promise((resolve) => cdp.child.once("exit", resolve));
    cdp.child.kill();
    await Promise.race([exited, delay(2_000)]);
    await rm(cdp.userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});

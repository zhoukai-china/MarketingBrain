#!/usr/bin/env node
/**
 * 临时只读探针（不进发布包）：复现「电脑端点微信登录 → 请在微信客户端打开链接」死页。
 *
 * 只做三件事：打开线上 `/login`、点一次「微信一键登录 / 注册」、记录最终 URL 与页面正文。
 * 不填任何表单、不提交任何开通请求，因此不会在生产建号或写入数据。
 *
 * 用法：node scripts/tmp/prod-login-desktop-deadend-probe.mjs [--base https://api.lcppch.top/os-v2]
 */
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
function argValue(flag, fallback) {
  for (let i = 0; i < args.length; i += 1) if (args[i] === flag && args[i + 1]) return args[i + 1];
  return fallback;
}
const webBase = argValue("--base", process.env.PROD_LOGIN_CHECK_URL ?? "https://api.lcppch.top/os-v2").replace(/\/+$/, "");
const chromePath = process.env.LOGIN_SMOKE_CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const desktopUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function startChrome() {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "prod-deadend-probe-"));
  const child = spawn(chromePath, [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    `--user-agent=${desktopUA}`,
    "--remote-debugging-port=0",
    `--user-data-dir=${userDataDir}`,
    "about:blank"
  ], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });

  const endpoint = await new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error("Chrome DevTools endpoint timeout")), 15_000);
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
  return { child, endpoint, userDataDir };
}

function connect(endpoint) {
  const socket = new WebSocket(endpoint);
  let nextId = 1;
  const pending = new Map();
  const listeners = [];
  socket.addEventListener("message", (event) => {
    const payload = JSON.parse(event.data);
    if (payload.id && pending.has(payload.id)) {
      const { resolve, reject } = pending.get(payload.id);
      pending.delete(payload.id);
      if (payload.error) reject(new Error(payload.error.message));
      else resolve(payload.result);
      return;
    }
    for (const listener of listeners) listener(payload);
  });
  const ready = new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  function send(method, params = {}, sessionId) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  return { socket, ready, send, on: (fn) => listeners.push(fn) };
}

async function evaluate(cdp, sessionId, functionDeclaration) {
  // 统一按「函数字面量」传参，和仓库其它 CDP 脚本保持一致。
  const result = await cdp.send("Runtime.evaluate", {
    expression: `(${functionDeclaration})()`,
    awaitPromise: true,
    returnByValue: true,
  }, sessionId);
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? "evaluate failed");
  }
  return result.result.value;
}

async function main() {
  const { child, endpoint, userDataDir } = await startChrome();
  const cdp = connect(endpoint);
  const consoleErrors = [];
  try {
    await cdp.ready;
    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    await cdp.send("Page.enable", {}, sessionId);
    await cdp.send("Runtime.enable", {}, sessionId);
    await cdp.send("Log.enable", {}, sessionId);
    cdp.on((payload) => {
      if (payload.method === "Log.entryAdded" && payload.params?.entry?.level === "error") {
        consoleErrors.push(payload.params.entry.text);
      }
    });

    await cdp.send("Page.navigate", { url: `${webBase}/login` }, sessionId);
    // 登录页是懒路由，冷缓存下首次分片加载可能超过 4s；等按钮真正出现再动，避免把「还没渲染」误判成「没有二维码」。
    let clicked = false;
    let before = { url: "", text: "" };
    for (let attempt = 1; attempt <= 15 && !clicked; attempt += 1) {
      await delay(1000);
      before = await evaluate(cdp, sessionId, `() => ({ url: location.href, text: document.body.innerText.slice(0, 400) })`);
      clicked = await evaluate(cdp, sessionId, `() => {
        const button = [...document.querySelectorAll("button")].find((item) => /微信一键登录|微信授权登录/.test(item.textContent || ""));
        if (!button) return false;
        button.click();
        return true;
      }`);
      if (clicked) console.log(`[probe] wechat button appeared after ${attempt}s`);
    }
    console.log("[probe] login page url:", before.url);
    console.log("[probe] login page has wechat button:", /微信一键登录/.test(before.text));

    console.log("[probe] clicked wechat button:", clicked);
    await delay(8000);

    const after = await evaluate(cdp, sessionId, `() => ({ url: location.href, host: location.host, text: document.body.innerText.slice(0, 600) })`);
    console.log("RESULT url_after_click=" + after.url);
    console.log("RESULT host_after_click=" + after.host);
    console.log("RESULT dead_end_text=" + /请在微信客户端打开链接/.test(after.text));
    console.log("RESULT qr_shown=" + /微信扫一扫|二维码|请用微信扫/.test(after.text));
    const qrSrc = await evaluate(cdp, sessionId, `() => {
      const img = [...document.querySelectorAll("img")].find((item) => /qrcode|data:image/i.test(item.getAttribute("src") || "") || item.closest("[data-wechat-qr]"));
      if (!img) return null;
      const src = img.getAttribute("src") || "";
      return src.startsWith("data:image") ? "data:image(...truncated)" : src;
    }`);
    console.log("RESULT qr_img_src=" + JSON.stringify(qrSrc));
    console.log("RESULT body_excerpt=" + JSON.stringify(after.text.slice(0, 200)));
    console.log("RESULT console_errors=" + JSON.stringify(consoleErrors.slice(0, 5)));

    // 可选：留下二维码页截图作为交付证据（PROBE_SHOT_DIR=<目录>）
    const shotDir = process.env.PROBE_SHOT_DIR;
    if (shotDir) {
      await mkdir(shotDir, { recursive: true }).catch(() => {});
      const shot = await cdp.send("Page.captureScreenshot", { format: "png" }, sessionId);
      const file = path.join(shotDir, "prod-login-desktop-after-click.png");
      await writeFile(file, Buffer.from(shot.data, "base64"));
      console.log("RESULT screenshot=" + file);
    }
  } finally {
    try { child.kill(); } catch {}
    try { await rm(userDataDir, { recursive: true, force: true }); } catch {}
  }
}

main().catch((error) => {
  console.error("probe failed:", error);
  process.exit(1);
});

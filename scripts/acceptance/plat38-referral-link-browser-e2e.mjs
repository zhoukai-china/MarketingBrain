// PLAT-38「我的」页邀请链接的页面级验收（真实浏览器 + 真实后端）。
//
// 用户 2026-09-15：平台页面里要有「复制我的推荐链接」，把链接和二维码一并给出来。
//
// 覆盖：
//   ① `/mine` 出现「我的邀请链接」卡片；
//   ② 点「生成我的邀请链接」→ 出现完整链接（形如 `<公开站点>/login?ref=…`）+ 二维码 SVG；
//   ③ 「复制链接」可用（剪贴板内容 === 页面上的链接）；
//   ④ 把这条链接**真的在新标签页打开** → 注册页显示已识别推荐码（端到端证明链接可用）；
//   ⑤ 390px 无横向溢出；控制台无错误。
//
// 用法：PLAT38_WEB_URL=https://api.lcppch.top/lanqi-test PLAT38_SESSION_FILE=<含 token 的 json> \
//        node scripts/acceptance/plat38-referral-link-browser-e2e.mjs
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const webBase = (process.env.PLAT38_WEB_URL ?? "http://127.0.0.1:5174").replace(/\/+$/, "");
const chromePath = process.env.PLAT38_CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const shotDir = process.env.PLAT38_SHOT_DIR ?? path.join(tmpdir(), `plat38-referral-${Date.now()}`);
const sessionFile = process.env.PLAT38_SESSION_FILE;
const regenerate = process.env.PLAT38_REGENERATE === "1";

const results = [];
const record = (ok, label, detail = "") => {
  results.push({ ok, label, detail });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${label}${detail ? ` :: ${detail}` : ""}`);
};
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function resolveToken() {
  if (!sessionFile) throw new Error("需要 PLAT38_SESSION_FILE（含平台登录 token 的 json）");
  const parsed = JSON.parse(await readFile(sessionFile, "utf8"));
  if (!parsed.token) throw new Error(`${sessionFile} 里没有 token`);
  return parsed.token;
}

async function main() {
  const token = await resolveToken();
  await mkdir(shotDir, { recursive: true });
  const cdp = await startChrome();
  try {
    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    cdp.sessions.add(sessionId);
    await cdp.send("Page.enable", {}, sessionId);
    await cdp.send("Runtime.enable", {}, sessionId);
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1400, deviceScaleFactor: 1, mobile: false }, sessionId);
    await cdp.send("Browser.grantPermissions", { origin: webBase, permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"] });
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `try { localStorage.setItem("store_os_token", ${JSON.stringify(token)}); } catch {}`
    }, sessionId);

    await cdp.send("Page.navigate", { url: `${webBase}/mine` }, sessionId);
    await waitFor(cdp, sessionId, `() => Boolean(document.querySelector("[data-referral-card]"))`, 40_000, "邀请卡片出现");
    record(true, "「我的」页出现「我的邀请链接」卡片");

    // 等卡片真的读到后端状态（有提示文案 + 至少一个按钮），再做判断——否则会把「还在读」当成「没有链接」。
    await waitFor(cdp, sessionId, `() => {
      const card = document.querySelector("[data-referral-card]");
      if (!card) return false;
      const hint = card.querySelector(".referral-hint");
      const loaded = hint && !/正在读取/.test(hint.textContent || "");
      return Boolean(loaded && card.querySelector("button"));
    }`, 30_000, "邀请卡片读到状态");

    // 没有明文链接时先点按钮拿一次（明文只显示一次）。
    const state = await evaluate(cdp, sessionId, `() => {
      const card = document.querySelector("[data-referral-card]");
      return { text: card.innerText, hasLink: Boolean(card.querySelector("input[readonly]")), hasQr: Boolean(card.querySelector("[data-referral-qr] svg")) };
    }`);
    if (!state.hasLink) {
      const clicked = await evaluate(cdp, sessionId, `() => {
        const card = document.querySelector("[data-referral-card]");
        const button = Array.from(card.querySelectorAll("button")).find((node) => /生成.*邀请链接|再生成一条/.test(node.textContent || ""));
        if (!button) return false;
        button.click();
        return true;
      }`);
      record(clicked, "点「生成我的邀请链接 / 再生成一条」");
      await waitFor(cdp, sessionId, `() => Boolean(document.querySelector("[data-referral-card] input[readonly]"))`, 30_000, "链接出现");
    }

    const link = await evaluate(cdp, sessionId, `() => (document.querySelector("[data-referral-card] input[readonly]") || {}).value || ""`);
    record(/\/login\?ref=/.test(link), "页面给出完整邀请链接", link);
    const qr = await evaluate(cdp, sessionId, `() => {
      const svg = document.querySelector("[data-referral-qr] svg");
      return { exists: Boolean(svg), length: svg ? svg.outerHTML.length : 0 };
    }`);
    record(qr.exists && qr.length > 500, "页面渲染出二维码（SVG）", `svgChars=${qr.length}`);

    const copied = await evaluate(cdp, sessionId, `async () => {
      const card = document.querySelector("[data-referral-card]");
      const button = Array.from(card.querySelectorAll("button")).find((node) => /复制链接|已复制/.test(node.textContent || ""));
      if (!button) return { ok: false, reason: "no button" };
      button.click();
      await new Promise((resolve) => setTimeout(resolve, 400));
      try {
        const text = await navigator.clipboard.readText();
        return { ok: true, text };
      } catch (error) {
        return { ok: false, reason: String(error) };
      }
    }`);
    record(copied.ok && copied.text === link, "「复制链接」把链接真的写进剪贴板", copied.ok ? copied.text : copied.reason);
    await shoot(cdp, sessionId, "mine-referral-card");

    // ④ 端到端：把这条链接在新标签打开，注册页必须认得出推荐码。
    const { targetId: verifyTarget } = await cdp.send("Target.createTarget", { url: `${link}` });
    const { sessionId: verifySession } = await cdp.send("Target.attachToTarget", { targetId: verifyTarget, flatten: true });
    cdp.sessions.add(verifySession);
    await cdp.send("Page.enable", {}, verifySession);
    await cdp.send("Runtime.enable", {}, verifySession);
    await waitFor(cdp, verifySession, `() => document.body && document.body.innerText.trim().length > 30`, 40_000, "注册页渲染");
    await delay(1800);
    const verifyText = await evaluate(cdp, verifySession, `() => document.body.innerText`);
    const codeInLink = decodeURIComponent((link.split("ref=")[1] ?? "").toString());
    record(/已识别推荐码/.test(verifyText), "用生成的链接打开注册页 → 已识别推荐码（端到端）", `ref=${codeInLink.slice(0, 8)}…`);
    record(/微信一键登录 \/ 注册/.test(verifyText), "该链接落到统一注册入口（微信一键登录 / 注册）");
    await cdp.send("Page.captureScreenshot", { format: "png" }, verifySession).then(async (shot) => {
      await writeFile(path.join(shotDir, "login-with-referral.png"), Buffer.from(shot.data, "base64"));
    });

    // ⑤ 移动端
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, sessionId);
    await delay(1200);
    const overflow = await evaluate(cdp, sessionId, `() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth })`);
    record(overflow.scrollWidth <= overflow.innerWidth + 1, "移动端 390 无横向溢出", `scrollWidth=${overflow.scrollWidth} innerWidth=${overflow.innerWidth}`);
    await shoot(cdp, sessionId, "mine-referral-mobile");

    const errors = cdp.pageErrors.filter((entry) => !/favicon|Download the React DevTools/i.test(entry));
    record(errors.length === 0, "控制台无错误", errors.length === 0 ? "0 error" : errors.join(" | ").slice(0, 200));
    await writeFile(path.join(shotDir, "result.json"), JSON.stringify({ webBase, link, results }, null, 2));
    console.log(`# 截图目录：${shotDir}`);
  } finally {
    try { cdp.socket.close(); } catch {}
    cdp.child.kill();
  }

  const failed = results.filter((item) => !item.ok);
  console.log(JSON.stringify({ result: failed.length === 0 ? "PLAT38_REFERRAL_LINK_PASS" : "PLAT38_REFERRAL_LINK_FAIL", passed: results.length - failed.length, failed: failed.length }));
  if (failed.length > 0) process.exitCode = 1;
}

async function shoot(cdp, sessionId, name) {
  const shot = await cdp.send("Page.captureScreenshot", { format: "png" }, sessionId);
  await writeFile(path.join(shotDir, `${name}.png`), Buffer.from(shot.data, "base64"));
}

async function startChrome() {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "plat38-chrome-"));
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

  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject, method });
      socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });

  return { child, socket, send, userDataDir, pageErrors, sessions };
}

async function evaluate(cdp, sessionId, functionDeclaration) {
  const result = await cdp.send("Runtime.evaluate", { expression: `(${functionDeclaration})()`, returnByValue: true, awaitPromise: true }, sessionId);
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? "Runtime.evaluate failed");
  }
  return result.result.value;
}

async function waitFor(cdp, sessionId, predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let value;
    try {
      value = await evaluate(cdp, sessionId, predicate);
    } catch (error) {
      if (!/Execution context was destroyed|Cannot find context|Inspected target navigated/i.test(String(error?.message))) throw error;
      value = null;
    }
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`waitFor timeout: ${label}`);
    await delay(300);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

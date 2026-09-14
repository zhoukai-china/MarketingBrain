// PLAT-33 真实浏览器验收：公共平台对话页的语音输入能不能真把录音变成文字。
//
// 它用 Chrome 的假麦克风（`--use-file-for-fake-audio-capture` 喂一段真实中文录音），
// 在真实页面里点「🎤 语音」→ 说话 → 点「⏹ 结束录音」→ 断言输入框里出现中文，
// 并检查控制台没有新增错误。全程只读：不点发送、不产生 AgentRun、不扣积分。
//
// 用法：
//   PLAT33_SESSION_FILE=<含 token 的 json> PLAT33_FAKE_MIC_WAV=<16k 单声道 wav> \
//     node scripts/acceptance/plat33-voice-input-browser-e2e.mjs
//
// 可选：PLAT33_WEB_URL（默认 http://127.0.0.1:5174）、PLAT33_SKU_PATH（默认 /agent/ipzone__copy/chat）、
//       PLAT33_CHROME_PATH、PLAT33_SHOT_DIR、PLAT33_SPEAK_MS（默认 8000）。
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const webBase = (process.env.PLAT33_WEB_URL ?? "http://127.0.0.1:5174").replace(/\/+$/, "");
const skuPath = process.env.PLAT33_SKU_PATH ?? "/agent/ipzone__copy/chat";
const chromePath = process.env.PLAT33_CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const fakeMicWav = process.env.PLAT33_FAKE_MIC_WAV;
const speakMs = Number(process.env.PLAT33_SPEAK_MS ?? 8000);
/** 可选：进入工作台内层页面要按顺序点的按钮文案（用 `;` 分隔），例如 `进入图文获客`。 */
const preClicks = (process.env.PLAT33_PRE_CLICKS ?? "").split(";").map((item) => item.trim()).filter(Boolean);
const shotDir = process.env.PLAT33_SHOT_DIR ?? path.join(tmpdir(), `plat33-voice-${Date.now()}`);
const sessionFile = process.env.PLAT33_SESSION_FILE;
const inlineToken = process.env.PLAT33_SESSION_TOKEN;

const results = [];
const record = (ok, label, detail = "") => {
  results.push({ ok, label, detail });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${label}${detail ? ` :: ${detail}` : ""}`);
};
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function resolveToken() {
  if (inlineToken) return inlineToken;
  if (!sessionFile) throw new Error("需要 PLAT33_SESSION_TOKEN 或 PLAT33_SESSION_FILE");
  const parsed = JSON.parse(await readFile(sessionFile, "utf8"));
  if (!parsed.token) throw new Error(`${sessionFile} 里没有 token`);
  return parsed.token;
}

async function startChrome() {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "plat33-chrome-"));
  const args = [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--autoplay-policy=no-user-gesture-required",
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    "--remote-debugging-port=0",
    `--user-data-dir=${userDataDir}`,
    "about:blank"
  ];
  if (fakeMicWav) args.splice(6, 0, `--use-file-for-fake-audio-capture=${fakeMicWav}`);
  const child = spawn(chromePath, args, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });

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

async function shoot(cdp, sessionId, name) {
  const shot = await cdp.send("Page.captureScreenshot", { format: "png" }, sessionId);
  const file = path.join(shotDir, `${name}.png`);
  await writeFile(file, Buffer.from(shot.data, "base64"));
  return file;
}

/**
 * 语音按钮的定位规则：公共平台对话页是文字按钮（🎤 语音 / ⏹ 结束录音），
 * 智能体工作台（ChatComposer）是带 aria-label 的图标按钮，两边都要能点到。
 */
const VOICE_BUTTON = `Array.from(document.querySelectorAll("button")).find((item) =>
  /语音|结束录音|开始录音/.test((item.textContent || "") + " " + (item.getAttribute("aria-label") || ""))) || null`;

/** 当前页面状态：输入框文字、语音提示、按钮文案。 */
const PAGE_STATE = `() => {
  const textarea = document.querySelector("textarea");
  const hint = document.querySelector(".voiceInputStatus") || document.querySelector(".chat-hint") || document.querySelector(".fileUploadStatus");
  const button = ${VOICE_BUTTON};
  return {
    pathname: window.location.pathname,
    hasComposer: Boolean(textarea),
    value: textarea ? textarea.value : "",
    hint: hint ? hint.textContent : "",
    buttonText: button ? (button.textContent || button.getAttribute("aria-label") || "").trim() : "",
    buttonDisabled: button ? button.disabled : null,
    bodyText: document.body ? document.body.innerText.slice(0, 400) : ""
  };
}`;

const CLICK_VOICE = `() => {
  const button = ${VOICE_BUTTON};
  if (!button) return false;
  button.click();
  return true;
}`;

const CJK = /[\u4e00-\u9fa5]{6,}/;

async function main() {
  if (!fakeMicWav) throw new Error("需要 PLAT33_FAKE_MIC_WAV 指向一段 16kHz 单声道 wav");
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
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `try { localStorage.setItem("store_os_token", ${JSON.stringify(token)}); } catch {}`
    }, sessionId);

    console.log(`# PLAT-33 voice input browser e2e :: ${webBase}${skuPath}`);

    cdp.pageErrors.length = 0;
    await cdp.send("Page.navigate", { url: `${webBase}${skuPath}` }, sessionId);
    // 页面先渲染出内容，再按需进入内层（工作台首页到具体获客工作台）。
    await waitFor(cdp, sessionId, `() => document.body && document.body.innerText.trim().length > 0`, 40_000, "页面渲染");
    await delay(1500);
    for (const label of preClicks) {
      const clicked = await evaluate(cdp, sessionId, `() => {
        const target = Array.from(document.querySelectorAll("button, a, [role=button]")).find((item) => (item.textContent || "").includes(${JSON.stringify(label)}));
        if (!target) return false;
        target.click();
        return true;
      }`);
      record(clicked, `进入工作台内层：点击「${label}」`);
      await delay(2500);
    }
    await waitFor(cdp, sessionId, `() => Boolean(document.querySelector("textarea")) && Boolean(${VOICE_BUTTON})`, 40_000, "composer + 语音按钮出现");
    record(true, "对话输入区出现「🎤 语音」按钮");
    await delay(800);

    const before = await evaluate(cdp, sessionId, PAGE_STATE);
    record(Boolean(before.hasComposer), "输入框可用", `pathname=${before.pathname}`);
    record(before.value.trim() === "", "开始前输入框为空", JSON.stringify(before.value.slice(0, 40)));

    if (!(await evaluate(cdp, sessionId, CLICK_VOICE))) throw new Error("点不到语音按钮");
    await waitFor(cdp, sessionId, `() => {
      const button = ${VOICE_BUTTON};
      return Boolean(button) && /结束录音|recording/.test((button.textContent || "") + " " + button.className);
    }`, 15_000, "进入录音状态");
    record(true, "点一下开始录音（按钮变成「⏹ 结束录音」）");

    await delay(speakMs);
    const during = await evaluate(cdp, sessionId, PAGE_STATE);
    record(/录音|麦克风|正在/.test(during.hint), "录音中有明确状态提示", during.hint.slice(0, 60));
    const duringShot = await shoot(cdp, sessionId, "01-recording");

    await evaluate(cdp, sessionId, CLICK_VOICE);
    let final = null;
    try {
      final = await waitFor(cdp, sessionId, `() => {
        const textarea = document.querySelector("textarea");
        const hint = document.querySelector(".voiceInputStatus") || document.querySelector(".chat-hint") || document.querySelector(".fileUploadStatus");
        const value = textarea ? textarea.value : "";
        const hintText = hint ? hint.textContent : "";
        if (/[\\u4e00-\\u9fa5]{6,}/.test(value)) return { ok: true, value, hintText };
        if (/失败|不可用|未配置|请重试|没有识别|权限/.test(hintText)) return { ok: false, value, hintText };
        return null;
      }`, 75_000, "录音转写回到输入框");
    } catch (error) {
      final = await evaluate(cdp, sessionId, PAGE_STATE);
      record(false, "录音转写回到输入框", `超时：${JSON.stringify(final).slice(0, 200)}`);
    }

    const afterShot = await shoot(cdp, sessionId, "02-after-recording");
    const transcript = String(final?.value ?? "").trim();
    record(Boolean(final?.ok) && CJK.test(transcript), "语音转成了中文并填进输入框", transcript.slice(0, 80));
    const errors = cdp.pageErrors.filter((entry) => !/favicon|Download the React DevTools/i.test(entry));
    record(errors.length === 0, "整个过程控制台无错误", errors.length === 0 ? "0 error" : errors.join(" | ").slice(0, 200));

    const state = await evaluate(cdp, sessionId, PAGE_STATE);
    await writeFile(
      path.join(shotDir, "result.json"),
      JSON.stringify({ skuPath, transcript, hint: state.hint, buttonText: state.buttonText, before, during, afterShot, duringShot }, null, 2)
    );
    console.log(`# 截图：${duringShot} / ${afterShot}`);
  } finally {
    try { cdp.socket.close(); } catch {}
    cdp.child.kill();
  }

  const failed = results.filter((item) => !item.ok);
  console.log(JSON.stringify({ result: failed.length === 0 ? "PLAT33_VOICE_BROWSER_PASS" : "PLAT33_VOICE_BROWSER_FAIL", passed: results.length - failed.length, failed: failed.length }));
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

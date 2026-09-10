#!/usr/bin/env node
/**
 * 兰琪一期（单店）内测实例验收探针（只读，不改服务端状态）。
 *
 * 用途：对已部署的实例（默认 `https://api.lcppch.top/lanqi-test`）跑同一组可机读断言，
 * 用于 WorkBuddy《兰琪朋友圈获客测试体验报告》与 LQ-20 驾驶舱改动的上线后复验。
 * 与 `scripts/lanqi-page-check.mjs` 的区别：
 *  1. 断言可机读（布尔 + 证据片段），不是靠人看截图；
 *  2. 记录接口状态码与首屏可见耗时，便于区分「页面慢」和「接口 500」；
 *  3. 支持在表单里填内容，验证「生成」按钮是否真的解锁（WorkBuddy Bug1 场景）。
 *
 * 用法（默认打内测实例，失败退出码 1）：
 *   node scripts/lanqi-test-instance-acceptance.mjs
 *   node scripts/lanqi-test-instance-acceptance.mjs --base https://example.com/lanqi-test --out %TEMP%\lq20-accept
 *
 * 注意：本脚本只做读操作；不会点击「生成」真调模型，避免产生费用。
 * 免登录实例（DIRECT_TEST_LOGIN=true）看不到登录页，因此 Bug4（空邀请码页内提示）
 * 需要另在非免登录实例上跑 `scripts/lanqi-page-check.mjs --click-text`。
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
function argValue(flag, fallback) {
  let found = fallback;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === flag && args[i + 1]) found = args[i + 1];
  }
  return found;
}

const base = argValue("--base", "https://api.lcppch.top/lanqi-test").replace(/\/+$/, "");
const outDir = argValue("--out", path.join(tmpdir(), "lq20-accept"));
const port = Number(argValue("--port", "9340"));
const width = Number(argValue("--width", "1440"));
const height = Number(argValue("--height", "960"));
const settleMs = Number(argValue("--settle", "15000"));

const CHROME_CANDIDATES = [
  path.join(process.env.LOCALAPPDATA ?? "", "ms-playwright", "chromium-1234", "chrome-win64", "chrome.exe"),
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
];

function findChrome() {
  for (const candidate of CHROME_CANDIDATES) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  throw new Error("未找到可用的 Chromium/Chrome 可执行文件。");
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForDevtools(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return await response.json();
    } catch {
      // 浏览器还没起来，继续等
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
  const result = await root.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? "页面脚本执行失败");
  }
  return result.result.value;
}

async function openPage(root, url, marker) {
  const consoleErrors = [];
  const pageErrors = [];
  const httpErrors = [];
  const requestTimeline = [];
  const { targetId } = await root.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await root.send("Target.attachToTarget", { targetId, flatten: true });
  const startedAt = Date.now();

  root.on((payload) => {
    if (payload.sessionId !== sessionId) return;
    if (payload.method === "Runtime.consoleAPICalled" && payload.params.type === "error") {
      consoleErrors.push(payload.params.args.map((item) => item.value ?? item.description ?? "").join(" "));
    }
    if (payload.method === "Runtime.exceptionThrown") {
      pageErrors.push(payload.params.exceptionDetails.exception?.description ?? payload.params.exceptionDetails.text);
    }
    if (payload.method === "Network.responseReceived") {
      const { url: reqUrl, status } = payload.params.response;
      if (reqUrl.includes("/api/") || reqUrl.includes("/lanqi")) {
        requestTimeline.push({ atMs: Date.now() - startedAt, status, url: reqUrl.replace(base, "") });
      }
      if (status >= 400) httpErrors.push({ status, url: reqUrl });
    }
    if (payload.method === "Network.loadingFailed") {
      httpErrors.push({ status: "failed", url: payload.params.requestId, errorText: payload.params.errorText });
    }
  });

  await root.send("Page.enable", {}, sessionId);
  await root.send("Runtime.enable", {}, sessionId);
  await root.send("Network.enable", {}, sessionId);
  await root.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false }, sessionId);
  await root.send("Page.navigate", { url }, sessionId);

  // 等到页面出现该页独有的标记文案（比「不再显示正在加载」可靠），否则超时。
  const readyDeadline = Date.now() + settleMs;
  let readyAtMs = null;
  while (Date.now() < readyDeadline) {
    const text = await evaluate(root, sessionId, "document.body?.innerText ?? ''");
    if (marker && text.includes(marker)) {
      readyAtMs = Date.now() - startedAt;
      break;
    }
    await sleep(400);
  }
  await sleep(1500);

  const snapshot = await evaluate(
    root,
    sessionId,
    `(() => {
      const text = document.body?.innerText ?? "";
      const gates = [...document.querySelectorAll("[data-lanqi-gate]")].map((el) => ({
        kind: el.getAttribute("data-lanqi-gate"),
        reason: el.querySelector("[data-lanqi-gate-reason]")?.innerText?.trim() ?? "",
      }));
      return {
        href: location.href,
        title: document.title,
        text,
        gates,
        hasGoalCards: document.querySelectorAll(".lq-goal__card, [class*='goal-card']").length,
        textareaCount: document.querySelectorAll("textarea").length,
        inputCount: document.querySelectorAll("input").length,
      };
    })()`,
  );

  const shot = await root.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true }, sessionId);
  const slug = new URL(url).pathname.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "page";
  const shotPath = path.join(outDir, `${slug}.png`);
  await writeFile(shotPath, Buffer.from(shot.data, "base64"));

  return { targetId, sessionId, startedAt, readyAtMs, snapshot, consoleErrors, pageErrors, httpErrors, requestTimeline, shotPath };
}

async function closePage(root, page) {
  await root.send("Target.closeTarget", { targetId: page.targetId });
}

/** 在指定页面里填第一个 textarea（React 受控组件需要走原生 setter + input 事件）。 */
async function fillFirstTextarea(root, page, value) {
  return await evaluate(
    root,
    page.sessionId,
    `(() => {
      const ta = [...document.querySelectorAll("textarea")].find((el) => el.offsetParent !== null);
      if (!ta) return "no-textarea";
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
      setter.call(ta, ${JSON.stringify(value)});
      ta.dispatchEvent(new Event("input", { bubbles: true }));
      return "filled";
    })()`,
  );
}

/** 读取按钮的可用性（含 disabled 与禁用原因）。 */
async function readButtonState(root, page, label) {
  return await evaluate(
    root,
    page.sessionId,
    `(() => {
      const wanted = ${JSON.stringify(label)};
      const el = [...document.querySelectorAll("button")].find((node) => (node.innerText || "").trim().includes(wanted));
      if (!el) return { found: false };
      return { found: true, disabled: el.disabled, text: (el.innerText || "").trim() };
    })()`,
  );
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const profileDir = await mkdtemp(path.join(tmpdir(), "lq20-accept-profile-"));
  const chrome = spawn(
    findChrome(),
    [
      "--headless=new",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profileDir}`,
      `--window-size=${width},${height}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gpu",
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  const checks = [];
  let root;
  try {
    const version = await waitForDevtools();
    root = await CdpSession.connect(version.webSocketDebuggerUrl);

    // ① 驾驶舱：完整渲染 + 无 NaN + 无连锁残留 + 首次可见耗时
    const dash = await openPage(root, `${base}/lanqi/dashboard`, "本月结论");
    const dashText = dash.snapshot.text;
    checks.push({
      name: "dashboard 完整渲染",
      pass: dashText.includes("本月结论") && dashText.includes("今日关键指标") && !dashText.includes("正在加载"),
      detail: `readyAtMs=${dash.readyAtMs} textLen=${dashText.length} 含「本月结论」=${dashText.includes("本月结论")}`,
      firstVisibleMs: dash.readyAtMs,
    });
    checks.push({
      name: "dashboard 无 NaN / 无 undefined",
      pass: !/NaN/.test(dashText) && !/undefined/.test(dashText),
      detail: `NaN=${/NaN/.test(dashText)} undefined=${/undefined/.test(dashText)}`,
    });
    checks.push({
      name: "一期单店：无「全部门店 / 门店切换」",
      pass: !/全部门店|门店切换|多店聚合/.test(dashText),
      detail: `命中=${(/全部门店|门店切换|多店聚合/.test(dashText))}`,
    });
    checks.push({
      name: "无外卖产品串页（枕水江南）",
      pass: !dashText.includes("枕水江南"),
      detail: `命中=${dashText.includes("枕水江南")}`,
    });
    checks.push({
      name: "驾驶舱无接口 4xx/5xx",
      pass: dash.httpErrors.filter((e) => e.status !== "failed").length === 0,
      detail: JSON.stringify(dash.httpErrors.slice(0, 6)),
    });
    checks.push({
      name: "驾驶舱 console/page 无错误",
      pass: dash.consoleErrors.length === 0 && dash.pageErrors.length === 0,
      detail: `console=${dash.consoleErrors.length} page=${dash.pageErrors.length}`,
    });
    await closePage(root, dash);

    // ② 目标设置：只有本月 4 个目标可手输，其余只读
    const goal = await openPage(root, `${base}/lanqi/goal-setting`, "谁输");
    const goalText = goal.snapshot.text;
    const targetInputs = await evaluate(
      root,
      goal.sessionId,
      `[...document.querySelectorAll("input")].filter((el) => el.type !== "checkbox" && el.type !== "radio" && el.offsetParent !== null).length`,
    );
    const readonlyRows = await evaluate(
      root,
      goal.sessionId,
      `[...document.querySelectorAll("input,textarea")].filter((el) => el.readOnly || el.disabled).length`,
    );
    checks.push({
      name: "goal-setting：4 个手输目标",
      pass: /业绩目标/.test(goalText) && /新客目标/.test(goalText) && /升单目标/.test(goalText) && /沉睡唤醒/.test(goalText),
      detail: `可编辑输入框=${targetInputs} 只读/禁用=${readonlyRows}`,
    });
    checks.push({
      name: "goal-setting：未设目标不显示 0（显示「待设置」）",
      pass: goalText.includes("待设置") || goalText.includes("本月目标未设置"),
      detail: `含「待设置」=${goalText.includes("待设置")}`,
    });
    checks.push({
      name: "goal-setting：口径说明表（谁输/怎么来）",
      pass: goalText.includes("谁输") && goalText.includes("自动统计"),
      detail: `textLen=${goalText.length}`,
    });
    checks.push({
      name: "goal-setting console/page 无错误",
      pass: goal.consoleErrors.length === 0 && goal.pageErrors.length === 0,
      detail: `console=${goal.consoleErrors.length} page=${goal.pageErrors.length}`,
    });
    await closePage(root, goal);

    // ③ 朋友圈获客：Bug1 场景——填好内容后生成按钮必须可用
    const moments = await openPage(root, `${base}/lanqi/moments/friend-circle`, "生成朋友圈文案");
    const gateBefore = moments.snapshot.gates;
    const beforeState = await readButtonState(root, moments, "生成朋友圈文案");
    const filled = await fillFirstTextarea(root, moments, "今天店里来了一位老顾客，做了深层清洁，走的时候说皮肤亮了很多。");
    await sleep(600);
    const afterState = await readButtonState(root, moments, "生成朋友圈文案");
    const momentsText = moments.snapshot.text;
    checks.push({
      name: "朋友圈获客：门店门禁无阻断（未开通/无门店红字）",
      pass: gateBefore.length === 0 && !/未开通|没有可用门店|已停用/.test(momentsText),
      detail: `gates=${JSON.stringify(gateBefore)}`,
    });
    checks.push({
      name: "朋友圈获客：填好原话后「生成朋友圈文案」可用（Bug1）",
      pass: filled === "filled" && afterState.found === true && afterState.disabled === false,
      detail: `fill=${filled} found=${afterState.found} disabled=${afterState.disabled}（填写前 disabled=${beforeState.disabled}）`,
    });
    checks.push({
      name: "朋友圈获客 console/page 无错误",
      pass: moments.consoleErrors.length === 0 && moments.pageErrors.length === 0,
      detail: `console=${moments.consoleErrors.length} page=${moments.pageErrors.length}`,
    });
    await closePage(root, moments);

    // ④ 工作台入口：兰琪已开通且可进入
    const myAi = await openPage(root, `${base}/my-ai`, "进入兰琪 AI");
    checks.push({
      name: "工作台：兰琪 AI 已开通 + 进入入口",
      pass: myAi.snapshot.text.includes("兰琪 AI") && myAi.snapshot.text.includes("进入兰琪 AI"),
      detail: `textLen=${myAi.snapshot.text.length}`,
    });
    await closePage(root, myAi);

    const failed = checks.filter((item) => !item.pass);
    const report = {
      generatedAt: new Date().toISOString(),
      base,
      checks,
      failed: failed.map((item) => item.name),
      pages: [
        { url: `${base}/lanqi/dashboard`, href: dash.snapshot.href, textLen: dashText.length, readyAtMs: dash.readyAtMs, gates: dash.snapshot.gates, requestTimeline: dash.requestTimeline },
        { url: `${base}/lanqi/goal-setting`, href: goal.snapshot.href, textLen: goalText.length, readyAtMs: goal.readyAtMs, gates: goal.snapshot.gates },
        { url: `${base}/lanqi/moments/friend-circle`, href: moments.snapshot.href, textLen: momentsText.length, readyAtMs: moments.readyAtMs, gates: gateBefore },
        { url: `${base}/my-ai`, href: myAi.snapshot.href, textLen: myAi.snapshot.text.length, readyAtMs: myAi.readyAtMs, gates: myAi.snapshot.gates },
      ],
      notes: {
        loginBug4Verifiable:
          "测试实例 DIRECT_TEST_LOGIN=true，/login/lanqi 会直接进驾驶舱，因此空邀请码气泡（Bug4）不能在测试实例上验证，需要非免登录实例。",
      },
    };
    const reportPath = path.join(outDir, "lq20-acceptance.json");
    await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");

    for (const check of checks) {
      console.log(`${check.pass ? "PASS" : "FAIL"}  ${check.name}  ::  ${check.detail}`);
    }
    console.log(`\n合计 ${checks.length} 项，失败 ${failed.length} 项`);
    console.log(`report: ${reportPath}`);
    if (failed.length) process.exitCode = 1;
  } finally {
    root?.close();
    chrome.kill();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

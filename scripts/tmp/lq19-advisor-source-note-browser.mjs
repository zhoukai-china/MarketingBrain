#!/usr/bin/env node
/**
 * QA-20260911-010 页面级证据（真实 Chromium，只读页面、不改业务数据）：
 * 在兰琪公域获客页 #/lanqi/acquire/methods 点快捷问题触发**真实顾问回答**，验证：
 *   1) 标签上方有固定声明 data-lanqi-advisor-source-note，且写明「不是平台官方发布」；
 *   2) 标签前缀是「参考：」，页面上不存在「来源：xxx」；
 *   3) 标签文本不含「官方 / 公告 / 算法文档 / 内部资料」这类编造出处；
 *   4) 桌面 1440 与移动 390 两档都能渲染；控制台错误 / 页面异常为 0。
 *
 * 用法：
 *   node scripts/tmp/lq19-advisor-source-note-browser.mjs --base https://api.lcppch.top/lanqi-test --api https://api.lcppch.top/lanqi-test/api
 *
 * 注意：会真实调用模型一次（有费用），仅验收时运行。
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
const apiBase = argValue("--api", `${base}/api`).replace(/\/+$/, "");
const outDir = argValue("--out", path.join(tmpdir(), "lq19-source-note-browser"));
const port = Number(argValue("--port", "9347"));
const settleMs = Number(argValue("--settle", "40000"));

const SOURCE_OFFICIAL_CLAIM = /官方|公告|通知|白皮书|算法文档|规则文档|内部资料|内部文件|红头|政策原文|平台文件/;

let failures = 0;
function record(name, ok, detail) {
  if (!ok) failures += 1;
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${detail ? ` :: ${detail}` : ""}`);
}

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
    } catch { /* 还没起来 */ }
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

  on(listener) { this.listeners.add(listener); }
  close() { this.socket.close(); }
}

async function evaluate(root, sessionId, expression) {
  const result = await root.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? "页面脚本执行失败");
  }
  return result.result.value;
}

async function devLogin() {
  const res = await fetch(`${apiBase}/auth/dev-login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      productCode: "lanqi",
      tenantRole: "local_business",
      tenantName: "兰琪顾问来源标签页面验收",
      industry: "美业",
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!json.token) throw new Error(`dev-login 失败：HTTP ${res.status}`);
  return json;
}

async function runViewport(root, session, viewport, quickQuestion) {
  const consoleErrors = [];
  const pageErrors = [];
  let storesStatus = null;
  let advisorStatus = null;
  let advisorRequestId = null;
  let advisorRequestBody = null;
  let storesRequestId = null;
  let resolveStores = () => {};
  let resolveAdvisor = () => {};
  const storesReady = new Promise((resolve) => { resolveStores = resolve; });
  const advisorDone = new Promise((resolve) => { resolveAdvisor = resolve; });

  root.on((payload) => {
    if (payload.sessionId !== session.sessionId) return;
    if (payload.method === "Runtime.consoleAPICalled" && payload.params.type === "error") {
      consoleErrors.push(payload.params.args.map((item) => item.value ?? item.description ?? "").join(" "));
    }
    if (payload.method === "Runtime.exceptionThrown") {
      pageErrors.push(payload.params.exceptionDetails.exception?.description ?? payload.params.exceptionDetails.text);
    }
    if (payload.method === "Network.responseReceived") {
      const response = payload.params.response;
      const url = String(response.url ?? "");
      if (storesStatus === null && url.includes("/lanqi/stores")) {
        storesStatus = response.status;
        storesRequestId = payload.params.requestId;
        resolveStores();
      }
      if (advisorStatus === null && url.includes("/lanqi/acquire/advisor")) {
        advisorStatus = response.status;
        advisorRequestId = payload.params.requestId;
        resolveAdvisor();
      }
    }
    if (payload.method === "Network.requestWillBeSent") {
      const url = String(payload.params.request?.url ?? "");
      if (url.includes("/lanqi/acquire/advisor")) {
        advisorRequestBody = payload.params.request?.postData ?? null;
      }
    }
  });

  await root.send("Page.enable", {}, session.sessionId);
  await root.send("Runtime.enable", {}, session.sessionId);
  await root.send("Network.enable", {}, session.sessionId);
  await root.send(
    "Emulation.setDeviceMetricsOverride",
    { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.mobile },
    session.sessionId,
  );

  const pageUrl = `${base}/lanqi/acquire/methods`;
  await root.send("Page.navigate", { url: pageUrl }, session.sessionId);
  await sleep(3000);

  // 注入真实会话（与生产页面同一份 localStorage 键）
  await evaluate(
    root,
    session.sessionId,
    `(() => {
      localStorage.setItem("store_os_token", ${JSON.stringify(session.token)});
      localStorage.setItem("store_os_tenant_role", "local_business");
      localStorage.removeItem("store_os_onboarding_token");
      return "ok";
    })()`,
  );
  await root.send("Page.navigate", { url: pageUrl }, session.sessionId);

  const readyDeadline = Date.now() + 20000;
  let ready = false;
  while (Date.now() < readyDeadline) {
    const text = await evaluate(root, session.sessionId, "document.body?.innerText ?? ''");
    if (text.includes("AI 运营顾问") || text.includes("运营顾问") || text.includes("快捷")) { ready = true; break; }
    await sleep(400);
  }

  // 必须等门店档案回来（storeId 有值）再点，否则会误报「参数不合法」。
  await Promise.race([storesReady, sleep(15000)]);
  record(`${viewport.label}：门店档案 /lanqi/stores 返回 200`, storesStatus === 200, `HTTP ${storesStatus ?? "无响应"}`);
  if (storesRequestId) {
    const storesBody = await root
      .send("Network.getResponseBody", { requestId: storesRequestId }, session.sessionId)
      .catch(() => null);
    const storeCount = (() => {
      try { return JSON.parse(storesBody?.body ?? "{}")?.stores?.length ?? "?"; } catch { return "解析失败"; }
    })();
    // CDP 在部分会话里拿不到已释放的响应体，这里只做信息记录，不作为验收断言。
    console.log(`[INFO] ${viewport.label}：门店响应体 count=${storeCount} body=${String(storesBody?.body ?? "").slice(0, 200)}`);
  }
  // 门店响应到达后，等 React 把 storeId 提交进 state；否则快捷问题会带着空 storeId 发出。
  // 发送按钮 disabled 条件含 !storeId，先写入临时输入再等它变可用，得到确定性就绪信号。
  let storeStateReady = false;
  const storeStateDeadline = Date.now() + 15000;
  while (Date.now() < storeStateDeadline) {
    storeStateReady = await evaluate(
      root,
      session.sessionId,
      `(() => {
        const ta = document.querySelector(".lq-adv__input textarea");
        const btn = document.querySelector(".lq-adv__input button");
        if (!ta || !btn) return false;
        if (!ta.dataset.lqProbePrimed) {
          ta.dataset.lqProbePrimed = "1";
          const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
          setter.call(ta, "门店情况探针占位");
          ta.dispatchEvent(new Event("input", { bubbles: true }));
          return false;
        }
        return !btn.disabled;
      })()`,
    );
    if (storeStateReady) break;
    await sleep(300);
  }
  record(`${viewport.label}：门店档案已进入页面状态（发送按钮可用）`, storeStateReady, `ready=${storeStateReady}`);
  await evaluate(
    root,
    session.sessionId,
    `(() => {
      const ta = document.querySelector(".lq-adv__input textarea");
      if (!ta) return "missing";
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
      setter.call(ta, "");
      ta.dispatchEvent(new Event("input", { bubbles: true }));
      return "cleared";
    })()`,
  );

  // 点快捷问题触发真实顾问回答
  const clicked = await evaluate(
    root,
    session.sessionId,
    `(() => {
      const wanted = ${JSON.stringify(quickQuestion)};
      const el = [...document.querySelectorAll("button")].find((node) => (node.innerText || "").trim().includes(wanted) && !node.disabled);
      if (!el) return "not-found";
      el.click();
      return "clicked";
    })()`,
  );
  record(`${viewport.label}：面板就绪且能点到快捷问题`, ready && clicked === "clicked", `ready=${ready} click=${clicked}`);

  const answerDeadline = Date.now() + settleMs;
  let tags = [];
  while (Date.now() < answerDeadline) {
    tags = await evaluate(
      root,
      session.sessionId,
      `[...document.querySelectorAll(".lq-adv__tag")].map((el) => el.innerText.trim())`,
    );
    if (Array.isArray(tags) && tags.length > 0) break;
    await sleep(1000);
  }
  await Promise.race([advisorDone, sleep(2000)]);
  record(`${viewport.label}：顾问接口 /lanqi/acquire/advisor 返回 200`, advisorStatus === 200, `HTTP ${advisorStatus ?? "无响应"}`);
  if (advisorStatus !== 200) {
    let advisorResponseBody = "";
    if (advisorRequestId) {
      const bodyResult = await root
        .send("Network.getResponseBody", { requestId: advisorRequestId }, session.sessionId)
        .catch(() => null);
      advisorResponseBody = bodyResult?.body ?? "";
    }
    record(
      `${viewport.label}：诊断-顾问 400 的请求与响应`,
      false,
      `request=${String(advisorRequestBody).slice(0, 300)} · response=${advisorResponseBody.slice(0, 300)}`,
    );
  }

  const dom = await evaluate(
    root,
    session.sessionId,
    `(() => {
      const note = document.querySelector("[data-lanqi-advisor-source-note]");
      const tags = [...document.querySelectorAll(".lq-adv__tag")].map((el) => el.innerText.trim());
      const bodyText = document.body?.innerText ?? "";
      return {
        href: location.href,
        noteText: note?.innerText?.trim() ?? "",
        noteVisible: note ? note.offsetParent !== null : false,
        tags,
        metaTexts: [...document.querySelectorAll(".lq-adv__meta")].map((el) => el.innerText.trim()),
        hasOldSourcePrefix: tags.some((t) => t.startsWith("来源：")) || bodyText.includes("已附参考来源"),
        overflowX: document.documentElement.scrollWidth - window.innerWidth,
      };
    })()`,
  );

  const shot = await root.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true }, session.sessionId);
  const shotPath = path.join(outDir, `${viewport.mobile ? "mobile-390" : "desktop-1440"}.png`);
  await writeFile(shotPath, Buffer.from(shot.data, "base64"));

  record(`${viewport.label}：出现真实顾问回答的参考标签`, dom.tags.length > 0, JSON.stringify(dom.tags));
  record(
    `${viewport.label}：标签上方有「不是平台官方发布」声明且可见`,
    dom.noteVisible && dom.noteText.includes("不是平台官方发布") && dom.noteText.includes("通用打法标签"),
    `visible=${dom.noteVisible} text=${dom.noteText}`,
  );
  record(
    `${viewport.label}：标签前缀是「参考：」，不是「来源：」`,
    dom.tags.length > 0 && dom.tags.every((t) => t.startsWith("参考：")) && !dom.hasOldSourcePrefix,
    JSON.stringify(dom.tags),
  );
  const official = dom.tags.filter((t) => SOURCE_OFFICIAL_CLAIM.test(t));
  record(`${viewport.label}：标签不含编造的官方出处字样`, official.length === 0, official.join(",") || "无");
  record(
    `${viewport.label}：提示文案是「已附通用打法参考」`,
    dom.metaTexts.some((t) => t.includes("已附通用打法参考")),
    JSON.stringify(dom.metaTexts),
  );
  record(`${viewport.label}：无横向溢出`, dom.overflowX <= 1, `overflowX=${dom.overflowX}`);
  record(`${viewport.label}：控制台错误 / 页面异常为 0`, consoleErrors.length === 0 && pageErrors.length === 0,
    `console=${consoleErrors.length} page=${pageErrors.length}${consoleErrors.length ? ` :: ${consoleErrors.join(" | ")}` : ""}${pageErrors.length ? ` :: ${pageErrors.join(" | ")}` : ""}`);

  console.log(`  screenshot: ${shotPath}`);
  return { shotPath, consoleErrors, pageErrors };
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const session = await devLogin();
  record("dev-login 取得会话（内测实例专用链路）", Boolean(session.token), `tenant=${session.tenantId ?? "-"}`);

  const chromePath = findChrome();
  const userDataDir = await mkdtemp(path.join(tmpdir(), "lq19-adv-chrome-"));
  const chrome = spawn(chromePath, [
    "--headless=new",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "about:blank",
  ], { stdio: "ignore" });

  try {
    const version = await waitForDevtools();
    const root = await CdpSession.connect(version.webSocketDebuggerUrl);

    for (const viewport of [
      { label: "桌面 1440", width: 1440, height: 960, mobile: false },
      { label: "移动 390", width: 390, height: 844, mobile: true },
    ]) {
      const { targetId } = await root.send("Target.createTarget", { url: "about:blank" });
      const { sessionId } = await root.send("Target.attachToTarget", { targetId, flatten: true });
      await runViewport(root, { sessionId, token: session.token }, viewport, "抖音投了本地推没转化，怎么调？");
      await root.send("Target.closeTarget", { targetId });
    }

    root.close();
  } finally {
    chrome.kill();
  }

  console.log(`\nlq19_advisor_source_note_browser: ${failures === 0 ? "PASS" : "FAIL"} (${failures} failed)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

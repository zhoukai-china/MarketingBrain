#!/usr/bin/env node
/**
 * 兰琪「私域营销」页回归（真实浏览器，CDP，可机读断言）。
 *
 * 来源：WorkBuddy《兰琪私域营销页复测报告》（2026-09-11，stage3）。报告里的 4 条
 * 待收口项，本脚本逐条用真实页面判定，而不是只扫源码：
 *   P1（误判，反向锁）：快速模式示例是 placeholder、初始 value 为空；空输入给可读中文提示。
 *   P1（误判，反向锁）：点「生成真实 AI 配图」不清空已有文案与配图建议。
 *   P2（真缺陷，已修）：结果卡片要有「复制文案 / 重新生成」，复制成功给可见 toast。
 *   P2（真缺陷，已修）：顶栏「多端实时同步」可点，点击后给「正在同步 → 已同步 · HH:mm」。
 *
 * 同时反向锁住一条真 P1：空输入必须 4xx 且给面向老板的中文提示，不能退化成 500
 * （那正是报告里被记成「页面坏掉」的原因）。接口层的等价用例在
 * `scripts/lanqi-moments-input-error-paths-smoke.ts`。
 *
 * 用法：
 *   node scripts/lanqi-moments-retest.mjs                                # 打内测实例，只看空输入路径
 *   node scripts/lanqi-moments-retest.mjs --generate                     # 真点专业模式生成（调用真实大模型）
 *   node scripts/lanqi-moments-retest.mjs --generate --image             # 再真点一次 AI 配图（再调一次模型）
 *   node scripts/lanqi-moments-retest.mjs --base http://127.0.0.1:5174
 *
 * 默认不点「生成」/「配图」，避免未经授权产生模型费用。
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
const hasFlag = (flag) => args.includes(flag);

const base = argValue("--base", "https://api.lcppch.top/lanqi-test").replace(/\/+$/, "");
const outDir = argValue("--out", path.join(tmpdir(), "lq-moments-retest"));
const port = Number(argValue("--port", "9361"));
const settleMs = Number(argValue("--settle", "20000"));
const doGenerate = hasFlag("--generate");
const doImage = hasFlag("--image");

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
      // 浏览器还没起来
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

/** 页面快照：左侧表单态、右侧结果态、AI 配图态、结果操作区与顶栏同步反馈。 */
const SNAPSHOT_EXPR = `(() => {
  const text = document.body?.innerText ?? "";
  const btnFor = (label) => [...document.querySelectorAll("button")].find((n) => (n.innerText || "").trim().includes(label)) ?? null;
  const ta = [...document.querySelectorAll("textarea")].filter((n) => n.offsetParent !== null);
  const gen = btnFor("生成朋友圈文案");
  const aiBtn = btnFor("生成真实 AI 配图") || btnFor("真实配图生成中");
  const tools = document.querySelector("[data-lanqi-moments-tools]");
  const sync = document.querySelector("[data-lanqi-sync]");
  return {
    href: location.href,
    hasToken: Boolean(localStorage.getItem("store_os_token")),
    firstTextarea: ta[0] ? { value: ta[0].value, placeholder: ta[0].placeholder, len: ta[0].value.length } : null,
    textareaCount: ta.length,
    genButton: gen ? { found: true, disabled: gen.disabled, text: (gen.innerText || "").trim() } : { found: false },
    errorText: document.querySelector(".lq-moments__err")?.innerText?.trim() ?? null,
    emptyPlaceholder: Boolean(document.querySelector(".lq-moments__empty")),
    hasResultMeta: /字 → .* 内容分/.test(text),
    hasChecks: Boolean(document.querySelector(".lq-moments__checks")),
    hasFigs: Boolean(document.querySelector(".lq-moments__figs")),
    resultBodyLen: document.querySelector(".lq-moments__body")?.innerText?.length ?? 0,
    aiButton: aiBtn ? { found: true, disabled: aiBtn.disabled, text: (aiBtn.innerText || "").trim() } : { found: false },
    aiImageShown: Boolean(document.querySelector(".lq-moments__aiimg-view img")),
    aiImageError: document.querySelector(".lq-moments__aiimg .lq-moments__err")?.innerText?.trim() ?? null,
    tools: tools ? { found: true, labels: [...tools.querySelectorAll("button")].map((b) => (b.innerText || "").trim()) } : { found: false },
    toast: document.querySelector("[data-lanqi-moments-toast]")?.innerText?.trim() ?? null,
    syncButton: sync ? { found: true, tag: sync.tagName, disabled: sync.disabled, text: (sync.innerText || "").trim() } : { found: false },
    syncToast: document.querySelector("[data-lanqi-sync-toast]")?.innerText?.trim() ?? null,
    text,
  };
})()`;

const readState = (root, sessionId) => evaluate(root, sessionId, SNAPSHOT_EXPR);

const clickByText = (root, sessionId, label) =>
  evaluate(
    root,
    sessionId,
    `(() => {
      const el = [...document.querySelectorAll("button")].find((n) => (n.innerText || "").trim().includes(${JSON.stringify(label)}));
      if (!el) return "not-found";
      el.click();
      return "clicked";
    })()`,
  );

const fillProForm = (root, sessionId) =>
  evaluate(
    root,
    sessionId,
    `(() => {
      const list = [...document.querySelectorAll("textarea")].filter((n) => n.offsetParent !== null);
      if (list.length < 2) return "not-enough-textareas";
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
      setter.call(list[0], "兰琪美肌研体验店");
      list[0].dispatchEvent(new Event("input", { bubbles: true }));
      setter.call(list[1], "今天给一位敏感肌客人做了舒缓护理，她说泛红退了不少，走的时候一直在照镜子。");
      list[1].dispatchEvent(new Event("input", { bubbles: true }));
      return "filled";
    })()`,
  );

async function main() {
  await mkdir(outDir, { recursive: true });
  const profileDir = await mkdtemp(path.join(tmpdir(), "lq-moments-retest-profile-"));
  const chrome = spawn(
    findChrome(),
    [
      "--headless=new",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profileDir}`,
      "--window-size=1440,960",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gpu",
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  const checks = [];
  const push = (name, pass, detail) => checks.push({ name, pass: Boolean(pass), detail });
  let root;
  try {
    const version = await waitForDevtools();
    root = await CdpSession.connect(version.webSocketDebuggerUrl);

    const url = `${base}/lanqi/moments/friend-circle`;
    const consoleErrors = [];
    const pageErrors = [];
    const calls = [];
    const navigations = [];
    const { targetId } = await root.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await root.send("Target.attachToTarget", { targetId, flatten: true });
    root.on((payload) => {
      if (payload.sessionId !== sessionId) return;
      if (payload.method === "Runtime.consoleAPICalled" && payload.params.type === "error") {
        consoleErrors.push(payload.params.args.map((item) => item.value ?? item.description ?? "").join(" "));
      }
      if (payload.method === "Runtime.exceptionThrown") {
        pageErrors.push(payload.params.exceptionDetails.exception?.description ?? payload.params.exceptionDetails.text);
      }
      if (payload.method === "Network.requestWillBeSent") {
        const u = payload.params.request.url;
        if (u.includes("/lanqi/moments/")) calls.push({ url: u, method: payload.params.request.method });
      }
      if (payload.method === "Page.frameNavigated") navigations.push(payload.params.frame.url);
      if (payload.method === "Network.responseReceived") {
        const u = payload.params.response.url;
        if (u.includes("/lanqi/moments/")) calls.push({ url: u, status: payload.params.response.status, kind: "response" });
      }
    });
    await root.send("Page.enable", {}, sessionId);
    await root.send("Runtime.enable", {}, sessionId);
    await root.send("Network.enable", {}, sessionId);
    await root.send("Page.navigate", { url }, sessionId);

    const deadline = Date.now() + settleMs;
    let readyAtMs = null;
    const startedAt = Date.now();
    while (Date.now() < deadline) {
      const text = await evaluate(root, sessionId, "document.body?.innerText ?? ''");
      if (text.includes("生成朋友圈文案")) {
        readyAtMs = Date.now() - startedAt;
        break;
      }
      await sleep(400);
    }
    await sleep(2000);

    const initial = await readState(root, sessionId);
    push(
      "快速模式页可达且渲染「你的原话」文本框 + 生成按钮",
      initial.genButton.found === true && initial.text.includes("你的原话"),
      `readyAtMs=${readyAtMs} genButton=${JSON.stringify(initial.genButton)}`,
    );
    push(
      "快速模式文本框初始 value 为空、示例展示在 placeholder（不是预填真实值）",
      initial.firstTextarea !== null && initial.firstTextarea.value === "" && initial.firstTextarea.placeholder.length > 0,
      `value=${JSON.stringify(initial.firstTextarea?.value)} placeholder=${JSON.stringify(initial.firstTextarea?.placeholder)}`,
    );

    // ① 空输入直接点生成：应给中文提示，且不得清空/报错崩溃、不得退化成服务端故障。
    await clickByText(root, sessionId, "生成朋友圈文案");
    await sleep(2500);
    const afterEmptyClick = await readState(root, sessionId);
    push(
      "空输入点「生成」给出可读中文提示（不静默、不崩溃）",
      typeof afterEmptyClick.errorText === "string" && afterEmptyClick.errorText.length > 0,
      `error=${JSON.stringify(afterEmptyClick.errorText)}`,
    );
    push(
      "空输入提示是「填错了」口径（不是「服务器故障」，也不带厂商串）",
      typeof afterEmptyClick.errorText === "string" &&
        afterEmptyClick.errorText.includes("请先写一句你的原话") &&
        !/deepseek|llm_|provider|internal|stack|500/i.test(afterEmptyClick.errorText),
      `error=${JSON.stringify(afterEmptyClick.errorText)}`,
    );

    // ② 顶栏「多端实时同步」：可点，且点击后有可见反馈（P2，本轮修复项）。
    push(
      "顶栏「多端实时同步」是可点按钮（不再是点了没反应的纯文本）",
      initial.syncButton.found === true && initial.syncButton.tag === "BUTTON",
      `syncButton=${JSON.stringify(initial.syncButton)}`,
    );
    if (initial.syncButton.found) {
      await evaluate(root, sessionId, `document.querySelector("[data-lanqi-sync]")?.click()`);
      await sleep(1600);
      const afterSync = await readState(root, sessionId);
      push(
        "点「多端实时同步」后出现同步状态 toast（含完成时间）",
        typeof afterSync.syncToast === "string" && /已同步 · \d{2}:\d{2}/.test(afterSync.syncToast),
        `syncToast=${JSON.stringify(afterSync.syncToast)}`,
      );
    }

    let afterProResult = null;
    let afterImageClick = null;
    if (doGenerate) {
      await clickByText(root, sessionId, "专业模式");
      await sleep(800);
      const proEmpty = await readState(root, sessionId);
      push("切到专业模式后左侧出现七个支柱与必填字段", proEmpty.text.includes("工作现场") && proEmpty.textareaCount >= 2, `textareas=${proEmpty.textareaCount}`);
      await fillProForm(root, sessionId);
      await sleep(600);
      await clickByText(root, sessionId, "生成朋友圈文案");
      const genDeadline = Date.now() + 120000;
      while (Date.now() < genDeadline) {
        const state = await readState(root, sessionId);
        if (state.hasResultMeta) break;
        await sleep(1500);
      }
      afterProResult = await readState(root, sessionId);
      push(
        "专业模式生成后右侧有文案正文 + 配图建议",
        afterProResult.hasResultMeta && afterProResult.resultBodyLen > 50,
        `hasResultMeta=${afterProResult.hasResultMeta} bodyLen=${afterProResult.resultBodyLen} hasFigs=${afterProResult.hasFigs}`,
      );
      push(
        "结果卡片有「复制文案 / 重新生成」两个操作（P2，本轮修复项）",
        afterProResult.tools.found === true &&
          afterProResult.tools.labels.some((t) => t.includes("复制文案")) &&
          afterProResult.tools.labels.some((t) => t.includes("重新生成")),
        `tools=${JSON.stringify(afterProResult.tools)}`,
      );
      if (afterProResult.tools.found) {
        await clickByText(root, sessionId, "复制文案");
        await sleep(600);
        const afterCopy = await readState(root, sessionId);
        push(
          "点「复制文案」给出可见反馈（headless 下无剪贴板也必须有提示，不静默）",
          typeof afterCopy.toast === "string" && afterCopy.toast.length > 0,
          `toast=${JSON.stringify(afterCopy.toast)}`,
        );
      }

      if (doImage) {
        const beforeImg = await readState(root, sessionId);
        const clicked = await clickByText(root, sessionId, "生成真实 AI 配图");
        await sleep(4000);
        const midImg = await readState(root, sessionId);
        const imgDeadline = Date.now() + 150000;
        while (Date.now() < imgDeadline) {
          const state = await readState(root, sessionId);
          if (state.aiImageShown || state.aiImageError) break;
          await sleep(2000);
        }
        afterImageClick = await readState(root, sessionId);
        push(
          "点「生成真实 AI 配图」后已有文案结果仍在（未被清空）",
          afterImageClick.hasResultMeta && afterImageClick.resultBodyLen > 50,
          `clicked=${clicked} emptyPlaceholder=${afterImageClick.emptyPlaceholder} hasResultMeta=${afterImageClick.hasResultMeta} bodyLen=${afterImageClick.resultBodyLen} midEmpty=${midImg.emptyPlaceholder}`,
        );
        push(
          "点「生成真实 AI 配图」未把用户踢回登录页（token 仍在、URL 未跳转）",
          afterImageClick.hasToken === true && afterImageClick.href.includes("/lanqi/moments/friend-circle"),
          `hasToken=${afterImageClick.hasToken} href=${afterImageClick.href}`,
        );
        push(
          "AI 配图有明确终态（出图 或 可读错误），不静默",
          afterImageClick.aiImageShown || typeof afterImageClick.aiImageError === "string",
          `imageShown=${afterImageClick.aiImageShown} error=${JSON.stringify(afterImageClick.aiImageError)} beforeBodyLen=${beforeImg.resultBodyLen}`,
        );
      }
    }

    push(
      "页面 console / page 无错误",
      consoleErrors.length === 0 && pageErrors.length === 0,
      `console=${consoleErrors.length} page=${pageErrors.length} ${JSON.stringify(pageErrors.slice(0, 2))}`,
    );

    const shot = await root.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true }, sessionId);
    const shotPath = path.join(outDir, "moments-retest.png");
    await writeFile(shotPath, Buffer.from(shot.data, "base64"));

    const failed = checks.filter((item) => !item.pass);
    const report = {
      generatedAt: new Date().toISOString(),
      base,
      url,
      generateRun: doGenerate,
      imageRun: doImage,
      readyAtMs,
      checks,
      failed: failed.map((item) => item.name),
      states: {
        initial: { ...initial, text: undefined },
        afterEmptyClick: { ...afterEmptyClick, text: undefined },
        afterProResult: afterProResult ? { ...afterProResult, text: undefined } : null,
        afterImageClick: afterImageClick ? { ...afterImageClick, text: undefined } : null,
      },
      calls,
      navigations,
      consoleErrors,
      pageErrors,
    };
    const reportPath = path.join(outDir, "moments-retest.json");
    await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");

    for (const check of checks) {
      console.log(`${check.pass ? "ok  " : "FAIL"} - ${check.name} :: ${check.detail}`);
    }
    console.log(`\nlanqi-moments-retest -> ${checks.length - failed.length} passed, ${failed.length} failed`);
    console.log(`report: ${reportPath}`);
    console.log(`shot:   ${shotPath}`);
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

#!/usr/bin/env node
/**
 * 临时诊断脚本（WorkBuddy《兰琪私域营销页复测报告》复核用）：
 * 复现两条 P1 —— ① 快速模式「默认示例」是否被判为空；② 专业模式点「生成真实 AI 配图」是否清空已有结果。
 * 只用真实浏览器打测试实例，不写业务数据。用完可删，不提交、不入发布包。
 *
 * 用法：node scripts/tmp/lq-moments-retest-probe.mjs [--base https://api.lcppch.top/lanqi-test] [--generate] [--image]
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
const outDir = argValue("--out", path.join(tmpdir(), "lq-moments-retest-probe"));
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

/** 页面快照：左侧表单态、右侧结果态、AI 配图态。 */
const SNAPSHOT_EXPR = `(() => {
  const text = document.body?.innerText ?? "";
  const btnFor = (label) => [...document.querySelectorAll("button")].find((n) => (n.innerText || "").trim().includes(label)) ?? null;
  const ta = [...document.querySelectorAll("textarea")].filter((n) => n.offsetParent !== null);
  const gen = btnFor("生成朋友圈文案");
  const aiBtn = btnFor("生成真实 AI 配图") || btnFor("真实配图生成中");
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
    text,
  };
})()`;

const readState = (root, sessionId) => evaluate(root, sessionId, SNAPSHOT_EXPR);

async function fill(root, sessionId, selector, value, kind) {
  return await evaluate(
    root,
    sessionId,
    `(() => {
      const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((n) => n.offsetParent !== null);
      if (!el) return "not-found";
      const proto = ${kind === "textarea" ? "window.HTMLTextAreaElement.prototype" : "window.HTMLInputElement.prototype"};
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return "filled";
    })()`,
  );
}

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

    // ① 空输入直接点生成：应给中文提示，且不得清空/报错崩溃。
    await clickByText(root, sessionId, "生成朋友圈文案");
    await sleep(2500);
    const afterEmptyClick = await readState(root, sessionId);
    push(
      "空输入点「生成」给出可读中文提示（不静默、不崩溃）",
      typeof afterEmptyClick.errorText === "string" && afterEmptyClick.errorText.length > 0,
      `error=${JSON.stringify(afterEmptyClick.errorText)}`,
    );

    let afterProResult = null;
    let afterImageClick = null;
    if (doGenerate) {
      await clickByText(root, sessionId, "专业模式");
      await sleep(800);
      const proEmpty = await readState(root, sessionId);
      push("切到专业模式后左侧出现七个支柱与必填字段", proEmpty.text.includes("工作现场") && proEmpty.textareaCount >= 2, `textareas=${proEmpty.textareaCount}`);
      const tas = await evaluate(root, sessionId, `[...document.querySelectorAll("textarea")].filter((n) => n.offsetParent !== null).length`);
      if (tas >= 2) {
        await evaluate(
          root,
          sessionId,
          `(() => {
            const list = [...document.querySelectorAll("textarea")].filter((n) => n.offsetParent !== null);
            const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
            setter.call(list[0], "兰琪美肌研体验店");
            list[0].dispatchEvent(new Event("input", { bubbles: true }));
            setter.call(list[1], "今天给一位敏感肌客人做了舒缓护理，她说泛红退了不少，走的时候一直在照镜子。");
            list[1].dispatchEvent(new Event("input", { bubbles: true }));
            return "filled";
          })()`,
        );
      }
      await sleep(600);
      await clickByText(root, sessionId, "生成朋友圈文案");
      const genDeadline = Date.now() + 120000;
      while (Date.now() < genDeadline) {
        const state = await readState(root, sessionId);
        if (state.hasResultMeta || state.emptyPlaceholder === false) {
          if (state.hasResultMeta) break;
        }
        await sleep(1500);
      }
      afterProResult = await readState(root, sessionId);
      push(
        "专业模式生成后右侧有文案正文 + 配图建议",
        afterProResult.hasResultMeta && afterProResult.resultBodyLen > 50,
        `hasResultMeta=${afterProResult.hasResultMeta} bodyLen=${afterProResult.resultBodyLen} hasFigs=${afterProResult.hasFigs}`,
      );

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
    console.log(`\nlanqi-moments-retest-probe -> ${checks.length - failed.length} passed, ${failed.length} failed`);
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

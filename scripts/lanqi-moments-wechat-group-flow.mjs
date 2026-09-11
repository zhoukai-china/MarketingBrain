#!/usr/bin/env node
/**
 * 兰琪「微信群营销话术」页面回归（真实浏览器，CDP，可机读断言）。
 *
 * 起因（2026-09-10 用户报障「微信群营销话术生成不了」）：生产/测试实例的 journalctl 里
 * 从打开该页到离开，**没有任何 `POST /lanqi/moments/wechat-group`**；同租户 `/lanqi/stores`
 * 全是 200。也就是说后端没被调用过——症状出在前端：按钮 `disabled` 却没有告诉老板为什么。
 *
 * 本脚本锁的就是「按钮能不能点 + 点不了时必须说明原因」这两条，不看截图靠肉眼。
 *
 * 用法：
 *   node scripts/lanqi-moments-wechat-group-flow.mjs                      # 打内测实例
 *   node scripts/lanqi-moments-wechat-group-flow.mjs --base http://127.0.0.1:5174
 *   node scripts/lanqi-moments-wechat-group-flow.mjs --generate           # 真点生成（会调用真实大模型）
 *
 * 默认不点「生成群话术」，避免未经授权产生模型费用。
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
const outDir = argValue("--out", path.join(tmpdir(), "lq-wechat-group-flow"));
const port = Number(argValue("--port", "9351"));
const width = Number(argValue("--width", "1440"));
const height = Number(argValue("--height", "960"));
const settleMs = Number(argValue("--settle", "20000"));
const doGenerate = hasFlag("--generate");

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

/** 页面快照：可见文案、门店门禁、按钮态、字段级必填提示、生成请求次数。 */
const SNAPSHOT_EXPR = `(() => {
  const text = document.body?.innerText ?? "";
  const btnFor = (label) => [...document.querySelectorAll("button")].find((n) => (n.innerText || "").trim().includes(label)) ?? null;
  const gen = btnFor("生成群话术");
  const reason = document.querySelector("[data-lanqi-wechat-blocked]");
  const fieldHint = (name) => document.querySelector('[data-lanqi-wechat-field="' + name + '"]')?.innerText?.trim() ?? "";
  return {
    href: location.href,
    text,
    gates: [...document.querySelectorAll("[data-lanqi-gate]")].map((el) => ({
      kind: el.getAttribute("data-lanqi-gate"),
      reason: el.querySelector("[data-lanqi-gate-reason]")?.innerText?.trim() ?? "",
    })),
    button: gen ? { found: true, disabled: gen.disabled, text: (gen.innerText || "").trim() } : { found: false },
    blockedReason: reason ? (reason.innerText || "").trim() : null,
    detailHint: fieldHint("detail"),
    topicHint: fieldHint("topic"),
    readyToGenerate: Boolean(gen) && !gen.disabled,
  };
})()`;

async function readState(root, sessionId) {
  return await evaluate(root, sessionId, SNAPSHOT_EXPR);
}

/** React 受控组件要写原生 setter 再派发 input 事件，否则 state 不变。 */
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

async function main() {
  await mkdir(outDir, { recursive: true });
  const profileDir = await mkdtemp(path.join(tmpdir(), "lq-wechat-group-profile-"));
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
  const push = (name, pass, detail) => checks.push({ name, pass: Boolean(pass), detail });
  let root;
  try {
    const version = await waitForDevtools();
    root = await CdpSession.connect(version.webSocketDebuggerUrl);

    const url = `${base}/lanqi/moments/wechat-group`;
    const consoleErrors = [];
    const pageErrors = [];
    const generateCalls = [];
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
      if (payload.method === "Network.requestWillBeSent" && payload.params.request.url.includes("/moments/wechat-group")) {
        generateCalls.push(payload.params.request.url);
      }
    });
    await root.send("Page.enable", {}, sessionId);
    await root.send("Runtime.enable", {}, sessionId);
    await root.send("Network.enable", {}, sessionId);
    await root.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false }, sessionId);
    await root.send("Page.navigate", { url }, sessionId);

    const deadline = Date.now() + settleMs;
    let readyAtMs = null;
    const startedAt = Date.now();
    while (Date.now() < deadline) {
      const text = await evaluate(root, sessionId, "document.body?.innerText ?? ''");
      if (text.includes("生成群话术")) {
        readyAtMs = Date.now() - startedAt;
        break;
      }
      await sleep(400);
    }
    await sleep(1500);

    const initial = await readState(root, sessionId);
    push(
      "微信群话术页可达并渲染四个字段 + 生成按钮",
      initial.button.found === true &&
        initial.text.includes("场景") &&
        initial.text.includes("主题") &&
        initial.text.includes("具体内容") &&
        initial.text.includes("口吻"),
      `readyAtMs=${readyAtMs} button=${JSON.stringify(initial.button)}`,
    );
    push(
      "门店门禁无阻断（无未开通 / 无门店 / 读取失败红字）",
      initial.gates.length === 0,
      `gates=${JSON.stringify(initial.gates)}`,
    );

    // ① 只填「具体内容」（老板最自然的填法：把要说的话写进大框），主题留空也必须能生成。
    const filledDetail = await fill(
      root,
      sessionId,
      "textarea",
      "周六下午两点店里做肩颈体验，限 8 个名额，报名发我。",
      "textarea",
    );
    await sleep(500);
    const afterDetailOnly = await readState(root, sessionId);
    push(
      "只填「具体内容」即可生成群话术（主题可为空）",
      filledDetail === "filled" && afterDetailOnly.button.found === true && afterDetailOnly.button.disabled === false,
      `fill=${filledDetail} disabled=${afterDetailOnly.button.disabled} reason=${JSON.stringify(afterDetailOnly.blockedReason)}`,
    );

    // ② 清空具体内容：按钮必须禁用，且页面必须写出「为什么不能生成」。
    await fill(root, sessionId, "textarea", "", "textarea");
    await sleep(500);
    const afterClear = await readState(root, sessionId);
    push(
      "具体内容为空时按钮禁用且写明原因（不得静默变灰）",
      afterClear.button.found === true &&
        afterClear.button.disabled === true &&
        typeof afterClear.blockedReason === "string" &&
        afterClear.blockedReason.length > 0,
      `disabled=${afterClear.button.disabled} blockedReason=${JSON.stringify(afterClear.blockedReason)}`,
    );
    push(
      "「具体内容」字段有可见必填提示",
      typeof afterClear.detailHint === "string" && afterClear.detailHint.length > 0,
      `detailHint=${JSON.stringify(afterClear.detailHint)} topicHint=${JSON.stringify(afterClear.topicHint)}`,
    );

    if (doGenerate) {
      await fill(root, sessionId, "textarea", "周六下午两点店里做肩颈体验，限 8 个名额，报名发我。", "textarea");
      await sleep(500);
      const armed = await readState(root, sessionId);
      if (armed.readyToGenerate) {
        await evaluate(
          root,
          sessionId,
          `[...document.querySelectorAll("button")].find((n) => (n.innerText || "").includes("生成群话术")).click()`,
        );
        const genDeadline = Date.now() + 90000;
        let resultText = "";
        while (Date.now() < genDeadline) {
          resultText = await evaluate(root, sessionId, "document.body?.innerText ?? ''");
          if (/发布前检查|字 →/.test(resultText)) break;
          await sleep(1000);
        }
        // 契约口径：出稿成功后右侧渲染「{rawLen} 字 → {newLen} 字」改写指标，并在
        // `.lq-moments__checks` 区块里逐条渲染发布前检查项（✓/! 标签：说明）。
        // 注意：页面**没有**「发布前检查」这个纯文本标题（检查项区块本身无标题），
        // 旧断言断言了一个产品从未渲染过的字面量，会对正确出稿误判为失败。
        const checkItems = await evaluate(
          root,
          sessionId,
          `document.querySelectorAll(".lq-moments__checks > div").length`,
        );
        const checkItemCount = typeof checkItems === "number" ? checkItems : 0;
        push(
          "点「生成群话术」真实出稿（含改写字数与发布前检查项）",
          /字 →/.test(resultText) && checkItemCount >= 1 && generateCalls.length >= 1,
          `requests=${generateCalls.length} 检查项=${checkItemCount}`,
        );
        push(
          "出稿不外泄模型名/厂商名",
          !/deepseek|qwen|gpt|claude|minimax|百炼|dashscope|bailian/i.test(resultText),
          `leak=${(resultText.match(/deepseek|qwen|gpt|claude|minimax|百炼|dashscope|bailian/i) ?? ["none"])[0]}`,
        );
      } else {
        push("点「生成群话术」真实出稿（含改写字数与发布前检查）", false, "按钮仍不可点，未提交请求");
      }
    }
    push(
      "页面 console / page 无错误",
      consoleErrors.length === 0 && pageErrors.length === 0,
      `console=${consoleErrors.length} page=${pageErrors.length}`,
    );

    const finalState = await readState(root, sessionId);
    const shot = await root.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true }, sessionId);
    const shotPath = path.join(outDir, "wechat-group.png");
    await writeFile(shotPath, Buffer.from(shot.data, "base64"));

    const failed = checks.filter((item) => !item.pass);
    const report = {
      generatedAt: new Date().toISOString(),
      base,
      url,
      generateRun: doGenerate,
      readyAtMs,
      checks,
      failed: failed.map((item) => item.name),
      states: { initial, afterDetailOnly, afterClear, final: finalState },
      generateCalls,
    };
    const reportPath = path.join(outDir, "wechat-group-flow.json");
    await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");

    for (const check of checks) {
      console.log(`${check.pass ? "ok  " : "FAIL"} - ${check.name} :: ${check.detail}`);
    }
    console.log(`\nlanqi-moments-wechat-group-flow -> ${checks.length - failed.length} passed, ${failed.length} failed`);
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

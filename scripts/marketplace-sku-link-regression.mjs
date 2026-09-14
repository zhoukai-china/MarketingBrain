#!/usr/bin/env node
/**
 * 货架 SKU 落地链接回归：`/agents/<skuCode>` 必须落到货架详情页。
 *
 * 对应缺陷见 `docs/BUG_REGRESSIONS.md` QA-20260911-015：
 * 用户拿到的验收链接是 `https://api.lcppch.top/os-v2/agents/ipzone__vidrev`（复数 `/agents/`），
 * 而平台首页把 `/agents` 当命名空间用，`/agents/<slug>` 一律渲染智能体工作台页
 * （`AgentWorkspacePage`）。SKU 编码不是工作台 slug，`/api/agents/me` 里找不到，
 * 页面抛出 `agent_not_found`，又被 `customerErrorMessage` 当成机器码兜底成
 * 「服务暂时不可用，请稍后再试。」——把「链接写法不对/智能体没上线」说成了服务故障。
 *
 * 本脚本用真实 Chromium 打开链接，断言：
 *   1) 不得出现「服务暂时不可用」这类服务故障话术；
 *   2) 不得被强制跳到登录页（货架详情页是公开页，未登录也该能看到）；
 *   3) 必须渲染货架详情正文：SKU 名称 + 与该 SKU 货架状态一致的占位/开卖标记
 *      （`ipzone__vidrev` / `meiye__vidrev` 已开卖 → 不得出现「开发中」；未开卖内核仍必须出现「开发中」）；
 *   4) 详情数据来自货架接口 `200 /api/market/skus/<skuCode>`，且整轮无 5xx；
 *   5) 控制台错误 / 页面异常为 0。
 *
 * 桌面 1440 与手机 390 各跑一遍。
 *
 * 用法：
 *   node scripts/marketplace-sku-link-regression.mjs --base https://api.lcppch.top/lanqi-test
 * 可选：--out <截图目录> --sku <skuCode>（可重复，默认两个视频复盘 SKU）
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
function argValues(flag) {
  const values = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === flag && args[i + 1]) values.push(args[i + 1]);
  }
  return values;
}

const base = argValue("--base", "https://api.lcppch.top/lanqi-test").replace(/\/+$/, "");
const outDir = argValue("--out", path.join(tmpdir(), "marketplace-sku-link-regression"));
const skuArgs = argValues("--sku");
const SKUS = skuArgs.length ? skuArgs : ["ipzone__vidrev", "meiye__vidrev"];

/**
 * 每个 SKU 在页面上的期望：`name` 取自 `apps/api/src/data/marketplace-v3.json`（skill 名），
 * `state` 与该 SKU 的货架状态一致（两个专区的视频复盘按 2026-09-13 工单验收通过后已重新上架 = selling）。
 * 未列出的 SKU 一律按 coming_soon 断言，避免默认值悄悄放宽验收口径。
 */
const SKU_EXPECTED = {
  ipzone__vidrev: { name: "视频复盘", state: "selling" },
  meiye__vidrev: { name: "视频复盘", state: "selling" }
};

const VIEWPORTS = [
  {
    name: "desktop-1440",
    width: 1440,
    height: 1200,
    mobile: false,
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36"
  },
  {
    name: "mobile-390",
    width: 390,
    height: 844,
    mobile: true,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
  }
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
  "/usr/bin/google-chrome",
  "/usr/bin/chromium"
];

function findChrome() {
  for (const candidate of CHROME_CANDIDATES) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  throw new Error("未找到可用的 Chrome/Edge 可执行文件，可用 DEPLOY_CHECK_CHROME_PATH 指定。");
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function startChrome() {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "marketplace-sku-link-chrome-"));
  const child = spawn(process.env.DEPLOY_CHECK_CHROME_PATH ?? findChrome(), [
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
  const apiCalls = [];
  const sessions = new Set();
  /** requestId -> url：把 Network.loadingFailed 还原成「哪个请求没回来」。 */
  const requestUrls = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id) {
      if (!sessions.has(message.sessionId)) return;
      if (message.method === "Runtime.exceptionThrown") {
        pageErrors.push(message.params?.exceptionDetails?.exception?.description ?? "runtime exception");
      }
      if (message.method === "Runtime.consoleAPICalled" && message.params?.type === "error") {
        pageErrors.push((message.params.args ?? []).map((arg) => arg.value ?? arg.description ?? "").join(" "));
      }
      if (message.method === "Network.requestWillBeSent") {
        requestUrls.set(message.params.requestId, message.params.request.url);
      }
      if (message.method === "Network.responseReceived") {
        const { url, status } = message.params.response;
        if (/\/api\//.test(url)) apiCalls.push({ status, url });
      }
      if (message.method === "Network.loadingFailed") {
        const url = requestUrls.get(message.params.requestId) ?? "";
        if (/\/api\//.test(url)) apiCalls.push({ status: 0, url, failed: message.params.errorText ?? "loading failed" });
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

  return { child, socket, send, pageErrors, apiCalls, sessions };
}

async function evaluate(cdp, sessionId, functionDeclaration) {
  const result = await cdp.send("Runtime.evaluate", { expression: `(${functionDeclaration})()`, returnByValue: true, awaitPromise: true }, sessionId);
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? "Runtime.evaluate failed");
  }
  return result.result.value;
}

/**
 * 「稳定但不是正文」的中间态文案：
 * - 内测实例免登录门（`DirectTestLoginGate`）的过渡页；
 * - 货架详情 / 货架列表自己的加载态（`MarketplaceApp.tsx` 的 `正在加载智能体…` / `正在加载货架…`）。
 *
 * 加载态本身很稳定（两帧读数一致），若不当成中间态，脚本会在正文渲染出来之前就判绿灯 ——
 * 2026-09-11 实测就是这样：`ipzone__vidrev` / `meiye__vidrev` 偶发被判在 `正在加载智能体…`
 * 那一刻，而同一实例上 `/api/market/skus/<sku>` 已返回 200（假失败）。真卡死时下面的
 * 超时分支仍会返回最后文本，断言照样失败。
 */
const TRANSIENT_MARKERS = [
  "正在进入智能体",
  "正在进入体验工作区",
  "正在进入美业智能体体验工作区",
  "正在加载智能体",
  "正在加载货架",
];

/**
 * 等页面文本稳定（两次读取一致、且不在中间页状态），最多等 timeoutMs；返回最终文本。
 * 「稳定」不能只比两次读数：中间页本身也很稳定，会把红/绿灯判在没渲染出正文的时刻。
 */
async function readSettledText(cdp, sessionId, timeoutMs = 25_000) {
  const deadline = Date.now() + timeoutMs;
  let previous = "";
  while (Date.now() < deadline) {
    const current = await evaluate(cdp, sessionId, "() => document.body.innerText");
    const transient = TRANSIENT_MARKERS.some((marker) => current.includes(marker));
    if (current && current === previous && current.length > 0 && !transient) return current;
    previous = current;
    await sleep(600);
  }
  return previous;
}

async function main() {
  await mkdir(outDir, { recursive: true });
  info("目标实例", base);
  info("截图目录", outDir);
  const cdp = await startChrome();
  try {
    for (const viewport of VIEWPORTS) {
      for (const sku of SKUS) {
        const url = `${base}/agents/${sku}`;
        const label = `${sku}@${viewport.name}`;
        const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
        const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
        try {
          cdp.sessions.add(sessionId);
          cdp.pageErrors.length = 0;
          cdp.apiCalls.length = 0;
          await cdp.send("Page.enable", {}, sessionId);
          await cdp.send("Runtime.enable", {}, sessionId);
          await cdp.send("Network.enable", {}, sessionId);
          await cdp.send("Emulation.setDeviceMetricsOverride", {
            width: viewport.width,
            height: viewport.height,
            deviceScaleFactor: 1,
            mobile: viewport.mobile
          }, sessionId);
          await cdp.send("Network.setUserAgentOverride", { userAgent: viewport.userAgent }, sessionId);

          await cdp.send("Page.navigate", { url }, sessionId);
          const text = await readSettledText(cdp, sessionId);
          const finalUrl = await evaluate(cdp, sessionId, "() => window.location.href");
          const shot = await cdp.send("Page.captureScreenshot", { format: "png" }, sessionId);
          await writeFile(path.join(outDir, `${sku}-${viewport.name}.png`), Buffer.from(shot.data, "base64"));
          await writeFile(path.join(outDir, `${sku}-${viewport.name}.txt`), text, "utf8");

          const skuDetailCalls = cdp.apiCalls.filter((call) => call.url.includes(`/api/market/skus/${sku}`));
          const serverErrors = cdp.apiCalls.filter((call) => call.status >= 500);

          record(`${label} 不再显示「服务暂时不可用」`, !/服务暂时不可用/.test(text), text.replace(/\s+/g, " ").slice(0, 120));
          record(`${label} 未被强制跳到登录页`, !/\/login(\?|$|\/)/.test(new URL(finalUrl).pathname), `finalUrl=${finalUrl}`);
          const expect = SKU_EXPECTED[sku] ?? { name: sku, state: "coming_soon" };
          const comingSoon = expect.state === "coming_soon";
          const stateRendered = comingSoon ? /开发中/.test(text) : !/开发中/.test(text);
          const detailRendered = stateRendered && text.includes(expect.name);
          record(`${label} 渲染货架详情正文（${comingSoon ? "开发中" : "已开卖"} + ${expect.name}）`,
            detailRendered,
            text.replace(/\s+/g, " ").slice(0, 120));
          record(`${label} 详情数据来自货架接口`,
            skuDetailCalls.some((call) => call.status === 200),
            skuDetailCalls.map((call) => `${call.status} ${call.url}`).join(" | ") || "未调用货架详情接口");
          record(`${label} 本轮无 5xx`, serverErrors.length === 0, serverErrors.map((call) => `${call.status} ${call.url}`).join(" | "));
          record(`${label} 无控制台错误`, cdp.pageErrors.length === 0, cdp.pageErrors.join(" | "));
          // 正文没渲染出来时，把本轮全部 /api/ 请求与页面异常打出来：区分「请求没回来」
          // 「请求回来了但渲染抛错」「根本没发请求」，避免只凭文本猜根因。
          if (!detailRendered) {
            info(`${label} 取证 /api/ 请求`,
              cdp.apiCalls.map((call) => `${call.status || "FAILED"} ${call.url}${call.failed ? ` (${call.failed})` : ""}`).join(" | ") || "无");
            info(`${label} 取证 页面异常`, cdp.pageErrors.join(" | ") || "无");
          }
        } finally {
          cdp.sessions.delete(sessionId);
          await cdp.send("Target.closeTarget", { targetId }).catch(() => undefined);
        }
      }
    }
  } finally {
    cdp.socket.close();
    cdp.child.kill();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\nFAILED: ${failures}`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

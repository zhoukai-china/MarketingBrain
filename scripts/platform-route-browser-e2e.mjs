// PLAT-18 历史路由清理的真实浏览器只读验收（不写任何数据、不调模型）。
//
// 覆盖三件事：
//   1. 保留网址仍能打开（不是「页面不存在」，也不串到别的产品）；
//   2. 已清理的历史网址与乱码网址统一落到「这个页面不存在，或者已经下线」，
//      且不再显示「枕水江南 / 外卖增长智能体」首页（清理前的全局兜底就是这个页）；
//   3. 移动端 390×844 下兜底页无横向溢出、说明文字可见。
//
// 用法：
//   PLATFORM_ROUTE_WEB_URL=http://127.0.0.1:5174 node scripts/platform-route-browser-e2e.mjs
//   PLATFORM_ROUTE_WEB_URL=https://api.lcppch.top/lanqi-test node scripts/platform-route-browser-e2e.mjs
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const webBase = (process.env.PLATFORM_ROUTE_WEB_URL ?? "http://127.0.0.1:5174").replace(/\/+$/, "");
const chromePath = process.env.PLATFORM_ROUTE_CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const shotDir = process.env.PLATFORM_ROUTE_SHOT_DIR ?? path.join(tmpdir(), `platform-route-check-${Date.now()}`);

/** 统一兜底页的判定文案（NotFoundPage.tsx 的 h1）。 */
const NOT_FOUND_TEXT = "这个页面不存在，或者已经下线";
/** 清理前的错误兜底：外卖增长智能体首页的品牌文案，出现即判失败。 */
const WRONG_FALLBACK_MARKERS = ["枕水江南", "外卖增长智能体"];

/** 保留网址：必须真实渲染出内容，且不得落到兜底页。 */
// minLength 按「未登录时该地址本来会说什么」定，断言只要求「渲染出本产品自己的界面
// + 不是兜底页 + 不串产品」，不用固定字数卡死登录态差异：
//   /my-ai 未登录给短登录引导；
//   /lanqi/moments 未登录给兰琪自己的入口页（生产实测 138 字），登录后才展开完整内容
//   （本地开发态实测 405 字），因此这里用「兰琪」品牌词 + 较小的字数下限表达真实契约。
const KEPT_ROUTES = [
  { path: "/agents", label: "智能体平台首页（货架）", mustInclude: "货架", minLength: 200 },
  { path: "/my-ai", label: "常用智能体工作台", mustInclude: "", minLength: 40 },
  { path: "/lanqi/moments", label: "兰琪私域营销（当前唯一已上线板块）", mustInclude: "兰琪", minLength: 100 }
];

/** 已清理的历史网址 + 一个乱码网址：必须落到统一兜底页。 */
const REMOVED_ROUTES = [
  "/legacy-diagnosis",
  "/v4-preview",
  "/industry-prototype",
  "/clip-lab",
  "/__platform-route-check-not-exist"
];

const results = [];
const record = (ok, label, detail = "") => {
  results.push({ ok, label, detail });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${label}${detail ? ` :: ${detail}` : ""}`);
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function startChrome() {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "platform-route-chrome-"));
  const child = spawn(
    chromePath,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--remote-debugging-port=0",
      `--user-data-dir=${userDataDir}`,
      "about:blank"
    ],
    { stdio: ["ignore", "ignore", "pipe"], windowsHide: true }
  );

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
      if (
        message.method === "Runtime.consoleAPICalled" &&
        message.params?.type === "error" &&
        sessions.has(message.sessionId)
      ) {
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
  const expression = `(${functionDeclaration})()`;
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
      if (
        !/Execution context was destroyed|Cannot find context|Inspected target navigated/i.test(
          error instanceof Error ? error.message : String(error)
        )
      ) {
        throw error;
      }
      value = false;
    }
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`waitFor timeout: ${functionDeclaration}`);
    await delay(300);
  }
}

async function shoot(cdp, sessionId, name) {
  const shot = await cdp.send("Page.captureScreenshot", { format: "png" }, sessionId);
  const file = path.join(shotDir, `${name}.png`);
  await writeFile(file, Buffer.from(shot.data, "base64"));
  return file;
}

async function pageSnapshot(cdp, sessionId) {
  return evaluate(cdp, sessionId, `() => ({
    pathname: window.location.pathname,
    title: document.title,
    text: document.body ? document.body.innerText : "",
    length: document.body ? document.body.innerText.trim().length : 0
  })`);
}

/** 打开一个路径并等页面稳定：等待正文渲染出内容，再做断言。 */
async function openPath(cdp, sessionId, routePath) {
  cdp.pageErrors.length = 0;
  await cdp.send("Page.navigate", { url: `${webBase}${routePath}` }, sessionId);
  await waitFor(cdp, sessionId, `() => document.body && document.body.innerText.trim().length > 0`);
  // 前端是客户端路由，首屏渲染后还会再切一次（懒加载 + 登录态判定），固定观察 1.2 秒。
  await delay(1200);
  // 匿名访问受保护页（如 /my-ai）会被客户端路由带到 /login，中间可能经过短暂空窗
  // （旧 DOM 卸载、新文档还没渲染）。固定 1.2 秒可能正好落在空窗，这里等到终态页面
  // 渲染出正文（最多 15 秒），避免把「跳转中的空 body」误判为路由故障。
  const deadline = Date.now() + 15_000;
  for (;;) {
    let snap;
    try {
      snap = await pageSnapshot(cdp, sessionId);
    } catch (error) {
      if (
        !/Execution context was destroyed|Cannot find context|Inspected target navigated/i.test(
          error instanceof Error ? error.message : String(error)
        )
      ) {
        throw error;
      }
      snap = null;
    }
    if (snap && snap.length > 0) return snap;
    if (Date.now() > deadline) return snap ?? { pathname: "", title: "", text: "", length: 0 };
    await delay(300);
  }
}

function consoleErrors(cdp) {
  return cdp.pageErrors.filter((entry) => !/favicon|Download the React DevTools/i.test(entry));
}

async function main() {
  await mkdir(shotDir, { recursive: true });
  const cdp = await startChrome();
  try {
    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    cdp.sessions.add(sessionId);
    await cdp.send("Page.enable", {}, sessionId);
    await cdp.send("Runtime.enable", {}, sessionId);
    await cdp.send(
      "Emulation.setDeviceMetricsOverride",
      { width: 1440, height: 1200, deviceScaleFactor: 1, mobile: false },
      sessionId
    );

    console.log(`# platform route browser e2e :: ${webBase}`);

    for (const route of KEPT_ROUTES) {
      const snapshot = await openPath(cdp, sessionId, route.path);
      const misses = WRONG_FALLBACK_MARKERS.filter((marker) => snapshot.text.includes(marker));
      /**
       * 需要登录的保留网址：匿名访客被带到 `/login` 是**正确行为**，不是故障。
       * 2026-09-12 实测 `https://api.lcppch.top/os-v2/my-ai` 匿名会 `finalUrl=/login` 并渲染登录页
       * （「微信一键登录 / 注册 …」），而本脚本用的是干净环境（=匿名），旧断言「必须渲染出 ≥40 字正文」
       * 会抓在跳转瞬间的空 body 上，报成 `len=0` 假失败（同时控制台 0 error、其余 23 条路由全绿）。
       * 现在把「落到登录页」也算通过，但**保留反向断言**：不得是兜底页、不得串到别的产品、不得控制台报错。
       * 登录态下的真实渲染由带会话的验收（`marketplace:vidrev-browser-e2e` 等）覆盖。
       */
      const landedOnLogin = snapshot.text.includes("微信一键登录") || snapshot.pathname.endsWith("/login");
      const ok =
        !snapshot.text.includes(NOT_FOUND_TEXT) &&
        misses.length === 0 &&
        (landedOnLogin || (snapshot.length >= route.minLength && (route.mustInclude ? snapshot.text.includes(route.mustInclude) : true)));
      record(
        ok,
        `保留网址 ${route.path}（${route.label}）仍能打开`,
        ok
          ? landedOnLogin ? `匿名 → 落在登录页（该页需会话，属预期）` : `render_len=${snapshot.length}`
          : `len=${snapshot.length} 兜底页=${snapshot.text.includes(NOT_FOUND_TEXT)} 串产品=${misses.join("/") || "无"} 文本=${snapshot.text.replace(/\s+/g, " ").slice(0, 160)}`
      );
      const errors = consoleErrors(cdp);
      record(errors.length === 0, `保留网址 ${route.path} 控制台无错误`, errors.length === 0 ? "0 error" : errors.join(" | ").slice(0, 200));
      await shoot(cdp, sessionId, `kept-${route.path.replace(/[^a-z0-9]+/gi, "_")}`);
    }

    for (const routePath of REMOVED_ROUTES) {
      const snapshot = await openPath(cdp, sessionId, routePath);
      const misses = WRONG_FALLBACK_MARKERS.filter((marker) => snapshot.text.includes(marker));
      const ok = snapshot.text.includes(NOT_FOUND_TEXT) && misses.length === 0;
      record(
        ok,
        `已清理/未知网址 ${routePath} 落到统一兜底页`,
        ok
          ? `title=${snapshot.title}`
          : `兜底页=${snapshot.text.includes(NOT_FOUND_TEXT)} 串产品=${misses.join("/") || "无"}`
      );
      record(
        snapshot.title.includes("页面不存在"),
        `已清理/未知网址 ${routePath} 标签页标题说明「页面不存在」`,
        snapshot.title
      );
      const errors = consoleErrors(cdp);
      record(errors.length === 0, `已清理/未知网址 ${routePath} 控制台无错误`, errors.length === 0 ? "0 error" : errors.join(" | ").slice(0, 200));
      await shoot(cdp, sessionId, `removed-${routePath.replace(/[^a-z0-9]+/gi, "_")}`);
    }

    // 在售工作台复用：/agents/clipper 用的是 ClipLabApp，第二轮只删了 /clip-lab 路由分支。
    const clipper = await openPath(cdp, sessionId, "/agents/clipper");
    record(
      !clipper.text.includes(NOT_FOUND_TEXT) && WRONG_FALLBACK_MARKERS.every((marker) => !clipper.text.includes(marker)),
      `/agents/clipper（在售视频剪辑工作台）不受 /clip-lab 下线影响`,
      `pathname=${clipper.pathname} len=${clipper.length}`
    );
    const clipperShots = await shoot(cdp, sessionId, "kept-agents-clipper");

    // 移动端：兜底页不得横向溢出，说明文字必须可见（用户反馈过「手机端页面显示不完整」）。
    await cdp.send(
      "Emulation.setDeviceMetricsOverride",
      { width: 390, height: 844, deviceScaleFactor: 2, mobile: true },
      sessionId
    );
    const mobile = await openPath(cdp, sessionId, "/__platform-route-check-not-exist");
    const mobileLayout = await evaluate(
      cdp,
      sessionId,
      `() => {
        const h1 = document.querySelector("h1");
        const style = h1 ? getComputedStyle(h1) : null;
        return {
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
          h1Visible: Boolean(h1 && style && style.visibility !== "hidden" && style.display !== "none" && h1.getBoundingClientRect().width > 0),
          actionCount: document.querySelectorAll(".notFoundActions a").length
        };
      }`
    );
    record(
      mobile.text.includes(NOT_FOUND_TEXT) && mobileLayout.h1Visible && mobileLayout.actionCount === 2,
      "移动端 390×844 兜底页标题与两个出口链接可见",
      `h1=${mobileLayout.h1Visible} actions=${mobileLayout.actionCount}`
    );
    record(
      mobileLayout.scrollWidth <= mobileLayout.innerWidth + 1,
      "移动端 390×844 兜底页无横向溢出",
      `scrollWidth=${mobileLayout.scrollWidth} innerWidth=${mobileLayout.innerWidth}`
    );
    await shoot(cdp, sessionId, "mobile-not-found");
    await cdp.send("Emulation.clearDeviceMetricsOverride", {}, sessionId);

    const failed = results.filter((entry) => !entry.ok);
    console.log(`\nplatform_route_browser_e2e: ${failed.length === 0 ? "PASS" : "FAIL"} (${results.length - failed.length} passed / ${failed.length} failed)`);
    console.log(`screenshots: ${shotDir}`);
    console.log(`clipper screenshot: ${clipperShots}`);
    if (failed.length > 0) {
      for (const entry of failed) console.log(`[FAIL] ${entry.label} :: ${entry.detail}`);
      process.exitCode = 1;
    }
  } finally {
    try {
      cdp.socket.close();
    } catch {
      // 关闭失败不影响结论。
    }
    cdp.child.kill();
  }
}

await main();

#!/usr/bin/env node
/**
 * 兰琪一期（单店）公域获客页验收探针（只读，不改服务端状态、不真调模型）。
 *
 * 覆盖：/lanqi/acquire 枢纽页 + 四个子页（copywriter / video / live / methods）、
 * 桌面与移动两档尺寸、模型/厂商名泄露检查、接口 4xx/5xx 与控制台错误。
 *
 * 与 `scripts/lanqi-test-instance-acceptance.mjs` 同源（同一套 CDP 探针），
 * 区别是断言对象换成公域获客板块。
 *
 * 用法（默认打内测实例，失败退出码 1）：
 *   node scripts/lanqi-acquire-instance-acceptance.mjs
 *   node scripts/lanqi-acquire-instance-acceptance.mjs --base https://example.com/lanqi-test --out %TEMP%\lq-acquire
 *
 * 只做读操作：会填表单读按钮状态，也会点「生成」但在必填缺失时页面自身提前拦截，
 * 不产生模型调用与费用。
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
const outDir = argValue("--out", path.join(tmpdir(), "lq-acquire-accept"));
const port = Number(argValue("--port", "9341"));
const width = Number(argValue("--width", "1440"));
const height = Number(argValue("--height", "960"));
const settleMs = Number(argValue("--settle", "15000"));

/** 对用户可见文案里不允许出现的模型/厂商名（与 lanqi:acquire-smoke 口径一致）。 */
const VENDOR_LEAK = /minimax|wan2\.2|wan2|即梦|火山|方舟|kling|bailian|deepseek|qwen|gpt-|openai|claude|豆包|通义|stable diffusion|sora|runway|可灵|百炼/i;

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

async function openPage(root, url, marker, viewport = { width, height, mobile: false }) {
  const consoleErrors = [];
  const pageErrors = [];
  const httpErrors = [];
  const dialogs = [];
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
    if (payload.method === "Page.javascriptDialogOpening") {
      dialogs.push(payload.params.message);
      // 探针需要自动放行，否则页面被 alert 阻塞。
      void root.send("Page.handleJavaScriptDialog", { accept: true }, sessionId);
    }
  });

  await root.send("Page.enable", {}, sessionId);
  await root.send("Runtime.enable", {}, sessionId);
  await root.send("Network.enable", {}, sessionId);
  await root.send(
    "Emulation.setDeviceMetricsOverride",
    { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.mobile },
    sessionId,
  );
  await root.send("Page.navigate", { url }, sessionId);

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
        links: [...document.querySelectorAll("a")].map((a) => a.getAttribute("href")).filter(Boolean),
        overflowX: document.documentElement.scrollWidth - window.innerWidth,
        minTapHeight: Math.min(
          ...[...document.querySelectorAll("button, a")].filter((el) => el.offsetParent !== null).map((el) => el.getBoundingClientRect().height),
        ),
      };
    })()`,
  );

  const shot = await root.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true }, sessionId);
  const slug = new URL(url).pathname.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "page";
  const shotPath = path.join(outDir, `${viewport.mobile ? "mobile-" : ""}${slug}.png`);
  await writeFile(shotPath, Buffer.from(shot.data, "base64"));

  return { targetId, sessionId, startedAt, readyAtMs, snapshot, consoleErrors, pageErrors, httpErrors, dialogs, requestTimeline, shotPath };
}

async function closePage(root, page) {
  await root.send("Target.closeTarget", { targetId: page.targetId });
}

/**
 * 给指定选择器命中的第一个可见元素（textarea/input）赋值。
 * React 受控组件必须走原型上的原生 setter + input 事件，直接改 .value 不会触发 onChange。
 */
async function setFieldValue(root, page, selector, value) {
  return await evaluate(
    root,
    page.sessionId,
    `(() => {
      const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((node) => node.offsetParent !== null);
      if (!el) return "not-found";
      const proto = el instanceof window.HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
      setter.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return "filled";
    })()`,
  );
}

/** 在指定页面里填第一个可见 textarea。 */
async function fillFirstTextarea(root, page, value) {
  return await setFieldValue(root, page, "textarea", value);
}

function countRequests(page, fragment) {
  return page.requestTimeline.filter((item) => item.url.includes(fragment)).length;
}

/** 读取按钮的可用性（含 disabled）。 */
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

/** 点按钮（按可见文字匹配），返回是否点到。 */
async function clickButton(root, page, label) {
  return await evaluate(
    root,
    page.sessionId,
    `(() => {
      const wanted = ${JSON.stringify(label)};
      const el = [...document.querySelectorAll("button")].find((node) => (node.innerText || "").trim().includes(wanted) && !node.disabled);
      if (!el) return "not-found";
      el.click();
      return "clicked";
    })()`,
  );
}

function leakHit(text) {
  const match = text.match(VENDOR_LEAK);
  return match ? match[0] : null;
}

function blankErrors(page) {
  return page.httpErrors.filter((item) => item.status !== "failed" && item.status >= 400);
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const profileDir = await mkdtemp(path.join(tmpdir(), "lq-acquire-profile-"));
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
  const pageReports = [];
  let root;
  try {
    const version = await waitForDevtools();
    root = await CdpSession.connect(version.webSocketDebuggerUrl);

    function record(page, url) {
      pageReports.push({
        url,
        href: page.snapshot.href,
        textLen: page.snapshot.text.length,
        readyAtMs: page.readyAtMs,
        gates: page.snapshot.gates,
        consoleErrors: page.consoleErrors.length,
        pageErrors: page.pageErrors.length,
        dialogs: page.dialogs ?? [],
        httpErrors: page.httpErrors,
        requestTimeline: page.requestTimeline,
      });
    }

    // ① 枢纽页：五张入口卡
    const hub = await openPage(root, `${base}/lanqi/acquire`, "公域获客");
    const hubText = hub.snapshot.text;
    const hubCards = ["短视频文案改稿", "视频获客", "文案转片", "直播话术", "AI 运营顾问"];
    checks.push({
      name: "acquire 枢纽：5 张入口卡齐全",
      pass: hubCards.every((name) => hubText.includes(name)),
      detail: `缺少=[${hubCards.filter((name) => !hubText.includes(name)).join(",")}] readyAtMs=${hub.readyAtMs}`,
    });
    const hubHrefs = hub.snapshot.links.join(" ");
    checks.push({
      name: "acquire 枢纽：入口链接指向 4 个子页 + 文案转片带 mode=script",
      pass:
        hubHrefs.includes("/lanqi/acquire/copywriter") &&
        hubHrefs.includes("/lanqi/acquire/video") &&
        hubHrefs.includes("/lanqi/acquire/live") &&
        hubHrefs.includes("/lanqi/acquire/methods") &&
        hubHrefs.includes("mode=script"),
      detail: hub.snapshot.links.join(" | ").slice(0, 300),
    });
    checks.push({
      name: "acquire 枢纽：无模型/厂商名泄露",
      pass: leakHit(hubText) === null,
      detail: `命中=${leakHit(hubText) ?? "无"}`,
    });
    checks.push({
      name: "acquire 枢纽：无接口 4xx/5xx、console/page 无错误",
      pass: blankErrors(hub).length === 0 && hub.consoleErrors.length === 0 && hub.pageErrors.length === 0,
      detail: `http=${JSON.stringify(blankErrors(hub).slice(0, 4))} console=${hub.consoleErrors.length} page=${hub.pageErrors.length}`,
    });
    record(hub, `${base}/lanqi/acquire`);
    await closePage(root, hub);

    // ② 短视频文案改稿
    const cw = await openPage(root, `${base}/lanqi/acquire/copywriter`, "把已有口播稿");
    const cwText = cw.snapshot.text;
    checks.push({
      name: "copywriter：四步骨架渲染（原稿 / 用途 / 优化 / 补充要求）",
      pass: ["原稿", "这条视频主要用来", "这次更想优化", "补充要求"].every((token) => cwText.includes(token)),
      detail: `readyAtMs=${cw.readyAtMs} textLen=${cwText.length}`,
    });
    checks.push({
      name: "copywriter：门店门禁不阻断（无 data-lanqi-gate）",
      pass: cw.snapshot.gates.length === 0 && !/未开通|没有可用门店|已停用/.test(cwText),
      detail: `gates=${JSON.stringify(cw.snapshot.gates)}`,
    });
    const cwBefore = await readButtonState(root, cw, "诊断并改稿");
    // 页面自带演示原稿，先清空再点，验证「空原稿不空跑模型」的本地拦截。
    const cwCleared = await setFieldValue(root, cw, "textarea", "");
    await sleep(400);
    const cwCallsBefore = countRequests(cw, "/acquire/copywriter");
    const cwClickEmpty = await clickButton(root, cw, "诊断并改稿");
    await sleep(900);
    const cwAfterEmptyText = await evaluate(root, cw.sessionId, "document.body?.innerText ?? ''");
    const cwCallsAfter = countRequests(cw, "/acquire/copywriter");
    const cwFill = await fillFirstTextarea(root, cw, "很多姐妹以为皮肤暗是没洗干净，其实多半是屏障受损。今天在店里做了深层清洁，走的时候她说皮肤亮了一个度。");
    await sleep(600);
    const cwAfter = await readButtonState(root, cw, "诊断并改稿");
    checks.push({
      name: "copywriter：按钮存在且可用（有门店时未禁用）",
      pass: cwBefore.found === true && cwBefore.disabled === false,
      detail: `found=${cwBefore.found} disabled=${cwBefore.disabled}`,
    });
    checks.push({
      name: "copywriter：清空原稿后点「诊断并改稿」被本地拦截，不空跑模型",
      pass:
        cwCleared === "filled" &&
        cwClickEmpty === "clicked" &&
        cwAfterEmptyText.includes("请先输入原稿内容") &&
        cwCallsAfter === cwCallsBefore,
      detail: `clear=${cwCleared} click=${cwClickEmpty} 提示=${cwAfterEmptyText.includes("请先输入原稿内容")} 新增改稿请求=${cwCallsAfter - cwCallsBefore}`,
    });
    checks.push({
      name: "copywriter：填好原稿后按钮仍可用",
      pass: cwFill === "filled" && cwAfter.found === true && cwAfter.disabled === false,
      detail: `fill=${cwFill} disabled=${cwAfter.disabled}`,
    });
    checks.push({
      name: "copywriter：无模型/厂商名泄露",
      pass: leakHit(cwText) === null,
      detail: `命中=${leakHit(cwText) ?? "无"}`,
    });
    checks.push({
      name: "copywriter：无接口 4xx/5xx、console/page 无错误",
      pass: blankErrors(cw).length === 0 && cw.consoleErrors.length === 0 && cw.pageErrors.length === 0,
      detail: `http=${JSON.stringify(blankErrors(cw).slice(0, 4))} console=${cw.consoleErrors.length} page=${cw.pageErrors.length}`,
    });
    record(cw, `${base}/lanqi/acquire/copywriter`);
    await closePage(root, cw);

    // ③ 视频获客：四种做法 + 未开通能力 fail closed
    const vd = await openPage(root, `${base}/lanqi/acquire/video`, "爆款复刻");
    const vdTabs = ["爆款复刻", "门店素材成片", "AI 剪辑", "文案转片"];
    const vdTabState = await evaluate(
      root,
      vd.sessionId,
      `[...document.querySelectorAll("[role=tab]")].map((el) => ({ text: (el.innerText || "").trim(), selected: el.getAttribute("aria-selected") }))`,
    );
    checks.push({
      name: "video：四个模式页签齐全",
      pass: vdTabs.every((name) => vdTabState.some((tab) => tab.text.includes(name))),
      detail: JSON.stringify(vdTabState),
    });
    // 爆款复刻：填关键词后点搜爆款；无真实检索源时必须明确说明缺口，而不是编造条目。
    const vdKw = await setFieldValue(root, vd, "input#lq-vd-kw", "皮肤管理门店获客");
    await sleep(400);
    const vdSearchCallsBefore = vd.requestTimeline.length;
    const vdSearchClick = await clickButton(root, vd, "AI 去抖音/视频号搜爆款");
    await sleep(1200);
    const vdSearchText = await evaluate(root, vd.sessionId, "document.body?.innerText ?? ''");
    const vdSearchCallsAfter = vd.requestTimeline.length;
    checks.push({
      name: "video：爆款复刻无真实检索源 → 明确 fail closed，不编造爆款条目",
      pass:
        vdKw === "filled" &&
        vdSearchClick === "clicked" &&
        vdSearchText.includes("暂未接通真实爆款检索") &&
        vdSearchText.includes("不编造视频链接和播放量") &&
        vdSearchCallsAfter === vdSearchCallsBefore,
      detail: `fill=${vdKw} click=${vdSearchClick} 含缺口说明=${vdSearchText.includes("暂未接通真实爆款检索")} 新增请求=${vdSearchCallsAfter - vdSearchCallsBefore}`,
    });
    const vdFailClosed = [];
    for (const tab of ["门店素材成片", "AI 剪辑"]) {
      const clicked = await evaluate(
        root,
        vd.sessionId,
        `(() => {
          const el = [...document.querySelectorAll("[role=tab]")].find((node) => (node.innerText || "").trim().includes(${JSON.stringify(tab)}));
          if (!el) return "not-found";
          el.click();
          return "clicked";
        })()`,
      );
      await sleep(900);
      const tabText = await evaluate(root, vd.sessionId, "document.body?.innerText ?? ''");
      vdFailClosed.push({ tab, clicked, offline: tabText.includes("出片服务暂未开通") || tabText.includes("视频生成服务暂未开通") });
    }
    checks.push({
      name: "video：门店素材成片 / AI 剪辑 出片能力未开通 → fail closed 不假装成功",
      pass: vdFailClosed.every((item) => item.clicked === "clicked" && item.offline === true),
      detail: JSON.stringify(vdFailClosed),
    });
    const vdScript = await openPage(root, `${base}/lanqi/acquire/video?mode=script`, "文案转片");
    const scriptTabSelected = await evaluate(
      root,
      vdScript.sessionId,
      `[...document.querySelectorAll("[role=tab]")].find((el) => el.getAttribute("aria-selected") === "true")?.innerText?.trim() ?? ""`,
    );
    // 走完 4 步（分镜/提示词是本地规则 + 规则型接口，不调模型），验证最后一步出片 fail closed。
    await clickButton(root, vdScript, "填入示例文案");
    await sleep(500);
    await clickButton(root, vdScript, "生成分镜脚本");
    await sleep(2500);
    await clickButton(root, vdScript, "下一步：上传素材卡");
    await sleep(800);
    await clickButton(root, vdScript, "下一步：输出规格");
    await sleep(3500);
    const vdScriptText = await evaluate(root, vdScript.sessionId, "document.body?.innerText ?? ''");
    checks.push({
      name: "video：文案转片（?mode=script）默认选中该页签",
      pass: vdScript.snapshot.href.includes("mode=script") && scriptTabSelected.includes("文案转片"),
      detail: `href=${vdScript.snapshot.href} 选中页签=${scriptTabSelected}`,
    });
    checks.push({
      name: "video：文案转片四步走通 → 出片未开通明确提示，可先导出提示词",
      pass: vdScriptText.includes("出片服务暂未开通") && vdScriptText.includes("导出提示词"),
      detail: `含「出片服务暂未开通」=${vdScriptText.includes("出片服务暂未开通")} 含导出提示词=${vdScriptText.includes("导出提示词")}`,
    });
    // 走到最终确认：勾选肖像授权 → 确认并生成 → 授权弹层 → 真实出片仍必须 fail closed（弹窗说明 + 无出片请求）。
    const consentToggled = await evaluate(
      root,
      vdScript.sessionId,
      `(() => {
        const box = document.querySelector(".lq-vd__consent input[type=checkbox]");
        if (!box) return "not-found";
        box.click();
        return "clicked";
      })()`,
    );
    await sleep(400);
    const genClick = await clickButton(root, vdScript, "确认并生成");
    await sleep(1200);
    const modalText = await evaluate(root, vdScript.sessionId, "document.body?.innerText ?? ''");
    const authClick = await clickButton(root, vdScript, "确认授权，开始用");
    await sleep(1200);
    const genCalls = countRequests(vdScript, "/acquire/video/generate");
    checks.push({
      name: "video：点「确认并生成」走授权弹层，最终仍 fail closed（无出片请求、无假成功）",
      pass:
        consentToggled === "clicked" &&
        genClick === "clicked" &&
        modalText.includes("肖像授权确认") &&
        authClick === "clicked" &&
        vdScript.dialogs.some((message) => message.includes("视频生成服务暂未开通")) &&
        genCalls === 0,
      detail: `consent=${consentToggled} genClick=${genClick} 弹层=${modalText.includes("肖像授权确认")} authClick=${authClick} 弹窗=${JSON.stringify(vdScript.dialogs)} 出片请求=${genCalls}`,
    });
    const vdLeak = leakHit(await evaluate(root, vd.sessionId, "document.body?.innerText ?? ''"));
    checks.push({
      name: "video：无模型/厂商名泄露",
      pass: vdLeak === null,
      detail: `命中=${vdLeak ?? "无"}`,
    });
    checks.push({
      name: "video：无接口 4xx/5xx、console/page 无错误",
      pass: blankErrors(vd).length === 0 && vd.consoleErrors.length === 0 && vd.pageErrors.length === 0,
      detail: `http=${JSON.stringify(blankErrors(vd).slice(0, 4))} console=${vd.consoleErrors.length} page=${vd.pageErrors.length}`,
    });
    record(vd, `${base}/lanqi/acquire/video`);
    await closePage(root, vd);
    await closePage(root, vdScript);

    // ④ 直播话术
    const live = await openPage(root, `${base}/lanqi/acquire/live`, "直播话术生成器");
    const liveText = live.snapshot.text;
    checks.push({
      name: "live：表单 + 空态渲染",
      pass: ["直播信息", "带货标的", "主打项目", "真实卖点", "价格机制", "平台"].every((token) => liveText.includes(token)),
      detail: `readyAtMs=${live.readyAtMs} textLen=${liveText.length}`,
    });
    // 页面预填了演示门店信息，先清掉一个必填项，验证必填缺失时的本地反问。
    const liveCleared = await setFieldValue(root, live, "input#lq-live-host", "");
    await sleep(400);
    const livePlanCallsBefore = countRequests(live, "/acquire/live/plan");
    const liveClickEmpty = await clickButton(root, live, "生成 2 小时逐字稿");
    await sleep(1000);
    const liveAfterEmpty = await evaluate(root, live.sessionId, "document.body?.innerText ?? ''");
    const livePlanCallsAfter = countRequests(live, "/acquire/live/plan");
    checks.push({
      name: "live：必填缺失时点生成 → 本地反问，不捏造也不空跑模型",
      pass:
        liveCleared === "filled" &&
        liveClickEmpty === "clicked" &&
        liveAfterEmpty.includes("还差必填") &&
        livePlanCallsAfter === livePlanCallsBefore,
      detail: `clear=${liveCleared} click=${liveClickEmpty} 含「还差必填」=${liveAfterEmpty.includes("还差必填")} 新增排段请求=${livePlanCallsAfter - livePlanCallsBefore}`,
    });
    checks.push({
      name: "live：无模型/厂商名泄露",
      pass: leakHit(liveText) === null,
      detail: `命中=${leakHit(liveText) ?? "无"}`,
    });
    checks.push({
      name: "live：无接口 4xx/5xx、console/page 无错误",
      pass: blankErrors(live).length === 0 && live.consoleErrors.length === 0 && live.pageErrors.length === 0,
      detail: `http=${JSON.stringify(blankErrors(live).slice(0, 4))} console=${live.consoleErrors.length} page=${live.pageErrors.length}`,
    });
    record(live, `${base}/lanqi/acquire/live`);
    await closePage(root, live);

    // ⑤ AI 运营顾问
    const adv = await openPage(root, `${base}/lanqi/acquire/methods`, "AI 运营顾问");
    const advText = adv.snapshot.text;
    const advBefore = await readButtonState(root, adv, "发送");
    const advFill = await fillFirstTextarea(root, adv, "我是新开业的美容院，预算不多，该从哪个平台开始？");
    await sleep(600);
    const advAfter = await readButtonState(root, adv, "发送");
    checks.push({
      name: "methods：空输入发送禁用、填好后可用",
      pass: advBefore.found === true && advBefore.disabled === true && advFill === "filled" && advAfter.disabled === false,
      detail: `before.disabled=${advBefore.disabled} fill=${advFill} after.disabled=${advAfter.disabled}`,
    });
    checks.push({
      name: "methods：快捷问题 chips 可用",
      pass: /快捷问题/.test(advText) && (await evaluate(root, adv.sessionId, `document.querySelectorAll(".lq-adv__chip").length`)) >= 3,
      detail: `chips=${await evaluate(root, adv.sessionId, `document.querySelectorAll(".lq-adv__chip").length`)}`,
    });
    checks.push({
      name: "methods：无模型/厂商名泄露",
      pass: leakHit(advText) === null,
      detail: `命中=${leakHit(advText) ?? "无"}`,
    });
    checks.push({
      name: "methods：无接口 4xx/5xx、console/page 无错误",
      pass: blankErrors(adv).length === 0 && adv.consoleErrors.length === 0 && adv.pageErrors.length === 0,
      detail: `http=${JSON.stringify(blankErrors(adv).slice(0, 4))} console=${adv.consoleErrors.length} page=${adv.pageErrors.length}`,
    });
    record(adv, `${base}/lanqi/acquire/methods`);
    await closePage(root, adv);

    // ⑥ 移动端：枢纽页与视频页无横向溢出
    const mobileViewport = { width: 390, height: 844, mobile: true };
    const hubMobile = await openPage(root, `${base}/lanqi/acquire`, "公域获客", mobileViewport);
    const videoMobile = await openPage(root, `${base}/lanqi/acquire/video`, "爆款复刻", mobileViewport);
    checks.push({
      name: "移动端 390×844：枢纽页与视频页无横向溢出",
      pass: hubMobile.snapshot.overflowX <= 2 && videoMobile.snapshot.overflowX <= 2,
      detail: `hubOverflow=${hubMobile.snapshot.overflowX} videoOverflow=${videoMobile.snapshot.overflowX}`,
    });
    record(hubMobile, `${base}/lanqi/acquire (mobile)`);
    record(videoMobile, `${base}/lanqi/acquire/video (mobile)`);
    await closePage(root, hubMobile);
    await closePage(root, videoMobile);

    const failed = checks.filter((item) => !item.pass);
    const report = {
      generatedAt: new Date().toISOString(),
      base,
      checks,
      failed: failed.map((item) => item.name),
      pages: pageReports,
    };
    const reportPath = path.join(outDir, "lq-acquire-acceptance.json");
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

#!/usr/bin/env node
/**
 * 兰琪一期（单店）公域获客页验收探针（只读，不改服务端状态、不真调模型）。
 *
 * 两种口径自动切换（用户 2026-09-11：目前只有私域营销可正常上线，其余板块显示「开发中」）：
 *   A. 板块已收口（当前状态）：只验证 /lanqi/acquire* 全部落到兰琪自己的「开发中」占位页，
 *      不空白、不串到别的产品、无模型/厂商名泄露、无接口 4xx/5xx 与控制台错误；
 *   B. 板块已放开（`apps/web/src/main.tsx` 的 LANQI_MOMENTS_ONLY_LAUNCH 放开公域获客后）：
 *      自动跑下面的逐模块验收清单 —— 枢纽页 + 四个子页（copywriter / video / live / methods）、
 *      桌面与移动两档尺寸、模型/厂商名泄露检查、接口 4xx/5xx 与控制台错误。
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

/**
 * 视频获客页的真实验收（LQ-23 起该页在「收口」口径下也刻意可直达，因此不能按占位页验收）。
 *
 * 覆盖两件事：
 *  ① 单模式（爆款复刻）无模式页签；② 爆款复刻（LQ-28）参考素材由门店自备 ——
 *     页面不得再有「搜爆款」入口，两个参考素材页签都要能真正进入：
 *     「参考抖音链接」只登记来源且**不发任何检索请求、不出片**，切到「上传参考视频」
 *     必须出现可用的原片文件选择器（LQ-28 首次上测试实例时这里曾误判：两个页签是
 *     条件渲染，不切页签就取不到上传面板，属于探针缺陷，已改为切页签后再断言）。
 *     未上传原片与未勾齐授权时点「看报价」必须本地拦截（LQ-27 防线，新增请求数必须为 0）。
 */
async function verifyVideoPage(root, checks, base, label, record) {
  const vd = await openPage(root, `${base}/lanqi/acquire/video`, "爆款复刻");
  const vdShell = await evaluate(
    root,
    vd.sessionId,
    `(() => ({
      tabs: document.querySelectorAll("[role=tab]").length,
      text: document.body?.innerText ?? ""
    }))()`,
  );
  checks.push({
    name: `${label}：爆款复刻单模式（无页签、无门店素材成片 / AI 剪辑入口）`,
    pass:
      vdShell.tabs === 0 &&
      vdShell.text.includes("爆款复刻") &&
      !vdShell.text.includes("门店素材成片") &&
      !vdShell.text.includes("AI 剪辑"),
    detail: `tabs=${vdShell.tabs} 含爆款复刻=${vdShell.text.includes("爆款复刻")} 含门店素材成片=${vdShell.text.includes("门店素材成片")} 含AI剪辑=${vdShell.text.includes("AI 剪辑")}`,
  });

  // ── LQ-28 ①：搜爆款入口必须整体消失，两个参考素材页签必须在位 ──
  // 注：默认停在「参考抖音链接」页签，此时上传面板按条件渲染尚未挂载，
  // 因此这里只断言链接侧；原片选择器在下面切到上传页签后再断言。
  const vdSurface = await evaluate(
    root,
    vd.sessionId,
    `(() => {
      const text = document.body?.innerText ?? "";
      const labels = [...document.querySelectorAll("button")].map((node) => (node.innerText || "").trim());
      return {
        searchButtons: labels.filter((item) => /搜爆款|平台筛选|行业领域/.test(item)),
        keywordInput: Boolean(document.querySelector("#lq-vd-kw")),
        linkTab: text.includes("参考抖音链接"),
        uploadTab: text.includes("上传参考视频"),
        linkInput: Boolean(document.querySelector("#lq-vd-ref-link")),
        linkCaveat: text.includes("不会出片"),
      };
    })()`,
  );
  checks.push({
    name: `${label}：爆款复刻不再有「搜爆款」入口，改为参考抖音链接 / 上传参考视频两页签`,
    pass:
      vdSurface.searchButtons.length === 0 &&
      !vdSurface.keywordInput &&
      vdSurface.linkTab &&
      vdSurface.uploadTab &&
      vdSurface.linkInput &&
      vdSurface.linkCaveat &&
      leakHit(vdShell.text) === null,
    detail: `检索按钮=${JSON.stringify(vdSurface.searchButtons)} 关键词框=${vdSurface.keywordInput} 链接页签=${vdSurface.linkTab} 上传页签=${vdSurface.uploadTab} 链接输入框=${vdSurface.linkInput} 不出片提示=${vdSurface.linkCaveat}`,
  });

  // ── LQ-28 ①b：切到「上传参考视频」页签，原片选择器必须真实可用 ──
  const uploadTabOpen = await clickButton(root, vd, "上传参考视频");
  await sleep(600);
  const vdUploadPanel = await evaluate(
    root,
    vd.sessionId,
    `(() => {
      const text = document.body?.innerText ?? "";
      const picks = [...document.querySelectorAll("input[type=file]")].map((node) => ({
        accept: node.getAttribute("accept") || "",
        disabled: Boolean(node.disabled)
      }));
      return {
        videoPick: picks.some((item) => item.accept.includes("video/mp4") && item.accept.includes(".mov") && !item.disabled),
        pickCount: picks.length,
        limitCopy: text.includes("MP4 / MOV") && text.includes("200MB") && text.includes("2–30 秒"),
        linkInputGone: !document.querySelector("#lq-vd-ref-link"),
      };
    })()`,
  );
  checks.push({
    name: `${label}：切到「上传参考视频」页签后有可用的原片选择器（格式/大小/时长约束可见）`,
    pass:
      uploadTabOpen === "clicked" &&
      vdUploadPanel.videoPick &&
      vdUploadPanel.limitCopy &&
      vdUploadPanel.linkInputGone &&
      leakHit(vdShell.text) === null,
    detail: `切页签=${uploadTabOpen} 视频选择器=${vdUploadPanel.videoPick} 文件输入数=${vdUploadPanel.pickCount} 约束文案=${vdUploadPanel.limitCopy} 链接输入框已收起=${vdUploadPanel.linkInputGone}`,
  });

  // 切回「参考抖音链接」页签：下面的断言继续走「贴链接只登记来源」这条路径。
  const backToLinkTab = await clickButton(root, vd, "参考抖音链接");
  await sleep(400);

  // ── LQ-28 ②：非抖音链接必须本地拦截，且不发任何请求 ──
  await setFieldValue(root, vd, "#lq-vd-ref-link", "https://www.kuaishou.com/short-video/3xabcdef");
  await sleep(300);
  const callsBeforeBadLink = vd.requestTimeline.length;
  const badLinkClick = await clickButton(root, vd, "登记参考来源");
  await sleep(800);
  const afterBadLink = await evaluate(root, vd.sessionId, "document.body?.innerText ?? ''");
  const badLinkBlocked = /这里只登记抖音链接/.test(afterBadLink);
  const badLinkRequests = vd.requestTimeline.length - callsBeforeBadLink;
  checks.push({
    name: `${label}：非抖音链接本地拦截、不发请求`,
    pass:
      backToLinkTab === "clicked" &&
      badLinkClick === "clicked" &&
      badLinkBlocked &&
      badLinkRequests === 0 &&
      leakHit(afterBadLink) === null,
    detail: `切回链接页签=${backToLinkTab} 点击=${badLinkClick} 本地拦截提示=${badLinkBlocked} 新增请求=${badLinkRequests}`,
  });

  // ── LQ-28 ③：抖音链接只登记参考来源（不发请求、不出片）──
  await setFieldValue(root, vd, "#lq-vd-ref-link", "https://www.douyin.com/video/7400000000000000000");
  await sleep(300);
  const callsBeforeGoodLink = vd.requestTimeline.length;
  const goodLinkClick = await clickButton(root, vd, "登记参考来源");
  await sleep(900);
  const afterGoodLink = await evaluate(root, vd.sessionId, "document.body?.innerText ?? ''");
  const goodLinkRequests = vd.requestTimeline.length - callsBeforeGoodLink;
  const linkRegistered = /已登记参考来源/.test(afterGoodLink);
  const linkDoesNotProduce = /不会出片/.test(afterGoodLink) && !/任务已提交/.test(afterGoodLink);
  checks.push({
    name: `${label}：抖音链接只登记参考来源，不发请求也不出片`,
    pass:
      goodLinkClick === "clicked" &&
      linkRegistered &&
      linkDoesNotProduce &&
      goodLinkRequests === 0 &&
      leakHit(afterGoodLink) === null,
    detail: `点击=${goodLinkClick} 已登记=${linkRegistered} 不出片=${linkDoesNotProduce} 新增请求=${goodLinkRequests}`,
  });

  // ── LQ-27 防线（沿用）：出片面板齐备、未上传原片与未勾授权时本地拦截，不出现假生成 ──
  const uploadTabClick = await clickButton(root, vd, "上传参考视频");
  await sleep(500);
  const panel = await evaluate(
    root,
    vd.sessionId,
    `(() => ({
      text: document.body?.innerText ?? "",
      confirmDisabled: [...document.querySelectorAll("button")].find((node) => (node.innerText || "").includes("再出片"))?.disabled ?? null
    }))()`,
  );
  const callsBeforeQuote = vd.requestTimeline.length;
  await clickButton(root, vd, "看报价");
  await sleep(1200);
  const addedRequests = vd.requestTimeline.length - callsBeforeQuote;
  const afterQuote = await evaluate(root, vd.sessionId, "document.body?.innerText ?? ''");
  const localBlocked = /请先上传要复刻的原视频|请先逐条确认四项素材与肖像授权|请先上传/.test(afterQuote);
  checks.push({
    name: `${label}：复刻出片面板齐备、未上传原片 / 未授权时本地拦截（不出现假生成）`,
    pass:
      uploadTabClick === "clicked" &&
      panel.text.includes("上传参考视频") &&
      panel.text.includes("素材与肖像授权") &&
      panel.text.includes("报价与出片") &&
      panel.confirmDisabled === true &&
      localBlocked &&
      addedRequests === 0,
    detail: `切页签=${uploadTabClick} 面板=上传参考视频:${panel.text.includes("上传参考视频")}/授权:${panel.text.includes("素材与肖像授权")}/报价:${panel.text.includes("报价与出片")} 确认按钮禁用=${panel.confirmDisabled} 本地拦截提示=${localBlocked} 新增请求=${addedRequests}`,
  });

  checks.push({
    name: `${label}：无接口 4xx/5xx、console/page 无错误`,
    pass: blankErrors(vd).length === 0 && vd.consoleErrors.length === 0 && vd.pageErrors.length === 0,
    detail: `http=${JSON.stringify(blankErrors(vd).slice(0, 4))} console=${vd.consoleErrors.length} page=${vd.pageErrors.length}`,
  });
  record(vd, `${base}/lanqi/acquire/video`);
  await closePage(root, vd);
}

/**
 * 一键成片（0912 一期）：6 步页，第 1 步只说需求 → 后端大模型出 3 版候选 → 「用这版」直接进分镜。
 * 严格口径：**不得出现手动贴文案入口**；候选必须真发后端请求；失败时必须明确说明，不放假文案。
 */
async function verifyVideoCopyPage(root, checks, base, label, record) {
  const cp = await openPage(root, `${base}/lanqi/acquire/video-copy`, "一键成片");
  const intro = await evaluate(root, cp.sessionId, "document.body?.innerText ?? ''");
  const stepLabels = ["说需求", "AI 生成文案", "AI 分镜脚本", "传素材卡", "积分预算", "成片"];
  checks.push({
    name: `${label}：6 步首屏 + 无手动贴文案入口`,
    pass:
      stepLabels.every((item) => intro.includes(item)) &&
      !intro.includes("填入示例文案") &&
      !intro.includes("原样贴进来") &&
      !intro.includes("门店素材成片") &&
      !intro.includes("AI 剪辑"),
    detail: `6步=${stepLabels.every((item) => intro.includes(item))} 含贴文案=${intro.includes("原样贴进来")}`,
  });

  const filled = await setFieldValue(root, cp, "input#lq-copy-need", "推广祛痘体验课，想让同城客到店");
  await sleep(400);
  const callsBefore = cp.requestTimeline.length;
  const clicked = await clickButton(root, cp, "让 AI 写 3 版文案");
  let text = "";
  let cards = 0;
  for (let attempt = 0; attempt < 45; attempt++) {
    await sleep(1000);
    const probe = await evaluate(
      root,
      cp.sessionId,
      `(() => ({
        text: document.body?.innerText ?? "",
        cards: [...document.querySelectorAll("button")].filter((node) => (node.innerText || "").includes("用这版")).length
      }))()`,
    );
    text = probe?.text ?? "";
    cards = probe?.cards ?? 0;
    if (cards >= 3 || /换一批|没有生成出|稍后重试|暂未/.test(text)) break;
  }
  const requested = countRequests(cp, "/lanqi/acquire/video/copy-candidates") > 0;
  const failedClosed = cards === 0 && /没有生成出|稍后重试|暂未开通/.test(text);
  checks.push({
    name: `${label}：说需求 → 后端出 3 版文案（失败则明确说明，不放假文案）`,
    pass:
      filled === "filled" &&
      clicked === "clicked" &&
      cp.requestTimeline.length > callsBefore &&
      requested &&
      (cards === 3 || failedClosed) &&
      leakHit(text) === null,
    detail: `fill=${filled} click=${clicked} 新增请求=${cp.requestTimeline.length - callsBefore} 候选卡=${cards} 失败说明=${failedClosed}`,
  });

  if (cards === 3) {
    const picked = await clickButton(root, cp, "用这版");
    let after = "";
    for (let attempt = 0; attempt < 30; attempt++) {
      await sleep(1000);
      after = await evaluate(root, cp.sessionId, "document.body?.innerText ?? ''");
      if (after.includes("第 3 步 / 6")) break;
    }
    checks.push({
      name: `${label}：用这版直接进第 3 步分镜（没有回头贴文案的路）`,
      pass: picked === "clicked" && after.includes("第 3 步 / 6") && !after.includes("原样贴进来"),
      detail: `click=${picked} 命中第3步=${after.includes("第 3 步 / 6")}`,
    });
  }

  checks.push({
    name: `${label}：console/page 无错误、无厂商名泄露`,
    pass: cp.consoleErrors.length === 0 && cp.pageErrors.length === 0 && leakHit(text) === null,
    detail: `console=${cp.consoleErrors.length} page=${cp.pageErrors.length} 泄露=${leakHit(text) ?? "无"}`,
  });
  record(cp, `${base}/lanqi/acquire/video-copy`);
  await closePage(root, cp);
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

    async function finish() {
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
    }

    /*
     * 口径 A（当前）：公域获客板块已收口到「开发中」占位。
     * 先用一个探针判断实例当前跑的是哪种口径，避免把「已收口」误判成「板块坏了」。
     */
    const guard = await openPage(root, `${base}/lanqi/acquire`, "公域获客");
    const acquireClosed = guard.snapshot.text.includes("本板块还在开发中");
    await closePage(root, guard);

    if (acquireClosed) {
      const routes = [
        { path: "/lanqi/acquire", label: "枢纽页" },
        { path: "/lanqi/acquire/copywriter", label: "短视频文案改稿" },
        { path: "/lanqi/acquire/live", label: "直播话术" },
        { path: "/lanqi/acquire/methods", label: "AI 运营顾问" },
      ];
      for (const route of routes) {
        const page = await openPage(root, `${base}${route.path}`, "公域获客");
        const text = page.snapshot.text;
        checks.push({
          name: `收口(${route.label})：显示兰琪「开发中」占位`,
          pass: text.includes("公域获客") && text.includes("开发中") && text.includes("本板块还在开发中"),
          detail: `readyAtMs=${page.readyAtMs} textLen=${text.length} 含「开发中」=${text.includes("开发中")}`,
        });
        checks.push({
          name: `收口(${route.label})：不串到别的产品 / 无模型厂商名泄露`,
          pass: !/枕水江南|外卖增长/.test(text) && leakHit(text) === null && page.snapshot.gates.length === 0,
          detail: `串页=${/枕水江南|外卖增长/.test(text)} 泄露=${leakHit(text) ?? "无"} gates=${JSON.stringify(page.snapshot.gates)}`,
        });
        checks.push({
          name: `收口(${route.label})：无接口 4xx/5xx、console/page 无错误`,
          pass: blankErrors(page).length === 0 && page.consoleErrors.length === 0 && page.pageErrors.length === 0,
          detail: `http=${JSON.stringify(blankErrors(page).slice(0, 4))} console=${page.consoleErrors.length} page=${page.pageErrors.length}`,
        });
        record(page, `${base}${route.path}`);
        await closePage(root, page);
      }

      // 视频获客页是「收口」口径下的刻意例外（LQ-23）：直接按真实页面验收，
      // 包含 LQ-25 的爆款复刻真实检索。
      await verifyVideoPage(root, checks, base, "收口(视频获客)", record);
      await verifyVideoCopyPage(root, checks, base, "收口(一键成片)", record);

      const mobileViewport = { width: 390, height: 844, mobile: true };
      const hubMobile = await openPage(root, `${base}/lanqi/acquire`, "公域获客", mobileViewport);
      const videoMobile = await openPage(root, `${base}/lanqi/acquire/video`, "公域获客", mobileViewport);
      checks.push({
        name: "收口：移动端 390×844 无横向溢出",
        pass: hubMobile.snapshot.overflowX <= 2 && videoMobile.snapshot.overflowX <= 2,
        detail: `hubOverflow=${hubMobile.snapshot.overflowX} videoOverflow=${videoMobile.snapshot.overflowX}`,
      });
      record(hubMobile, `${base}/lanqi/acquire (mobile)`);
      record(videoMobile, `${base}/lanqi/acquire/video (mobile)`);
      await closePage(root, hubMobile);
      await closePage(root, videoMobile);

      console.log("[INFO] 公域获客板块当前为「开发中」口径，逐模块验收清单在板块放开后自动生效。");
      await finish();
      return;
    }

    // ① 枢纽页：五张入口卡
    const hub = await openPage(root, `${base}/lanqi/acquire`, "公域获客");
    const hubText = hub.snapshot.text;
    const hubCards = ["短视频文案改稿", "爆款复刻", "一键成片", "直播话术", "AI 运营顾问"];
    checks.push({
      name: "acquire 枢纽：5 张入口卡齐全",
      pass: hubCards.every((name) => hubText.includes(name)),
      detail: `缺少=[${hubCards.filter((name) => !hubText.includes(name)).join(",")}] readyAtMs=${hub.readyAtMs}`,
    });
    const hubHrefs = hub.snapshot.links.join(" ");
    checks.push({
      name: "acquire 枢纽：入口链接指向 5 个任务入口（无 mode=script 旧链）",
      pass:
        hubHrefs.includes("/lanqi/acquire/copywriter") &&
        hubHrefs.includes("/lanqi/acquire/video") &&
        hubHrefs.includes("/lanqi/acquire/video-copy") &&
        hubHrefs.includes("/lanqi/acquire/live") &&
        hubHrefs.includes("/lanqi/acquire/methods") &&
        !hubHrefs.includes("mode=script"),
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

    // ③ 视频获客（0912 一期）：爆款复刻单模式页 + 一键成片独立页（两页契约，不再有四页签）。
    // 旧「门店素材成片 / AI 剪辑」页签已按 LQ-26 收口不渲染；确认与出片一律走各自页面的既有 fail-closed 口径。
    await verifyVideoPage(root, checks, base, "video", record);
    await verifyVideoCopyPage(root, checks, base, "video-copy", record);
    // ④ 直播话术
    const live = await openPage(root, `${base}/lanqi/acquire/live`, "直播话术生成器");
    const liveText = live.snapshot.text;
    checks.push({
      name: "live：表单 + 空态渲染",
      pass: ["直播信息", "带货标的", "主打项目", "真实卖点", "价格机制", "平台"].every((token) => liveText.includes(token)),
      detail: `readyAtMs=${live.readyAtMs} textLen=${liveText.length}`,
    });
    // 0911 走查修复：直播表单默认必须为空——原来预填演示门店（美肌研 · 创始人晓曼 / 水光深层补水…），
    // 老板不清空就会生成别人家门店的逐字稿。示例只允许出现在 placeholder 与「填入示例」按钮里。
    const liveHostDefault = await evaluate(root, live.sessionId, "document.querySelector('input#lq-live-host')?.value ?? null");
    const liveHostPlaceholder = await evaluate(
      root,
      live.sessionId,
      "document.querySelector('input#lq-live-host')?.getAttribute('placeholder') ?? ''"
    );
    checks.push({
      name: "live：默认不预填演示门店（示例只在 placeholder / 「填入示例」）",
      pass: liveHostDefault === "" && String(liveHostPlaceholder).length > 0 && liveText.includes("填入示例"),
      detail: `host默认值=${JSON.stringify(liveHostDefault)} placeholder=${JSON.stringify(liveHostPlaceholder)} 含「填入示例」=${liveText.includes("填入示例")}`,
    });
    // 「填入示例」是格式参考入口：点一下应把示例填进表单（老板再逐条改成自己的真实信息）。
    const liveDemoClick = await clickButton(root, live, "填入示例");
    await sleep(400);
    const liveHostAfterDemo = await evaluate(root, live.sessionId, "document.querySelector('input#lq-live-host')?.value ?? ''");
    checks.push({
      name: "live：「填入示例」可一键填入参考信息",
      pass: liveDemoClick === "clicked" && String(liveHostAfterDemo).length > 0,
      detail: `click=${liveDemoClick} 点后 host 值长度=${String(liveHostAfterDemo).length}`,
    });
    // 清掉一个必填项，验证必填缺失时的本地反问（示例已填入，其余必填在位，单独清 host 即「缺一项」）。
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

    await finish();
  } finally {
    root?.close();
    chrome.kill();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

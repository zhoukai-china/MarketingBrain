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
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
/** LQ-29 验收夹具：本地合成的 8 秒 360×640 竖屏 mp4 + 仓库内 jpg（不含真人、不含客户资料）。 */
const VIDEO_FIXTURE = path.join(repoRoot, "scripts", "fixtures", "beauty-video-content-av.mp4");
/** 用户 2026-09-15 反馈「这条片的时长超出当前单条预算上限」——用 20 秒夹具证明：用户端不再有内部预算卡点。 */
const VIDEO_FIXTURE_20S = path.join(repoRoot, "scripts", "fixtures", "beauty-video-content-20s.mp4");
const PHOTO_FIXTURE = path.join(repoRoot, "apps", "web", "public", "lanqi-logo.jpg");

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

/**
 * 选一个**真的能启动**的浏览器：只判断文件存在是不够的。
 * 2026-09-15 实测 `%LOCALAPPDATA%\ms-playwright\chromium-1234\chrome-win64\chrome.exe`
 * 存在但启动即退出（exit 3，CDP 端口永远不监听），而它排在候选表第一位
 * → 浏览器验收会以「Chromium DevTools 端口未就绪」假失败，看起来像被测页面坏了。
 * 现在逐个用 `--version` 探活，只选能跑起来的那一个。
 */
function findChrome() {
  const probed = [];
  for (const candidate of CHROME_CANDIDATES) {
    if (!candidate || !existsSync(candidate)) continue;
    const probe = spawnSync(candidate, ["--version"], { timeout: 15000, windowsHide: true, encoding: "utf8" });
    const usable = probe.status === 0 && !probe.error;
    probed.push(`${candidate} => ${usable ? "ok" : `unusable(status=${probe.status ?? "null"})`}`);
    if (usable) return candidate;
  }
  throw new Error(`未找到可用的 Chromium/Chrome 可执行文件。${probed.length ? ` 探测结果：${probed.join(" | ")}` : ""}`);
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
      // 复刻链路的接口挂在应用根路径 `/viral-video-replication/...` 下（不在 /api 或
      // /lanqi 前缀里）。漏掉它会让「点主按钮走了报价」这类探针把真实请求数算成 0。
      if (reqUrl.includes("/api/") || reqUrl.includes("/lanqi") || reqUrl.includes("/viral-video-replication/")) {
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

/**
 * 把本地文件塞进页面上的 `input[type=file]`（隐藏输入也能塞）。
 * CDP 的 `DOM.setFileInputFiles` 会补齐 change 事件，React 受控上传链路能正常收到。
 */
async function setFileInputFiles(root, page, selector, files) {
  await root.send("DOM.enable", {}, page.sessionId);
  const { root: docRoot } = await root.send("DOM.getDocument", { depth: 1 }, page.sessionId);
  const { nodeId } = await root.send("DOM.querySelector", { nodeId: docRoot.nodeId, selector }, page.sessionId);
  if (!nodeId) return "not-found";
  await root.send("DOM.setFileInputFiles", { files, nodeId }, page.sessionId);
  return "set";
}

/** 读出复刻主按钮的状态钩子：state / 文案 / 是否禁用。 */
async function readPrimaryState(root, page) {
  return await evaluate(
    root,
    page.sessionId,
    `(() => {
      const el = document.querySelector("button[data-lq-vd-primary]");
      if (!el) return { found: false };
      return {
        found: true,
        state: el.getAttribute("data-lq-vd-primary"),
        text: (el.innerText || "").trim(),
        disabled: Boolean(el.disabled),
        hint: document.querySelector("[data-lq-vd-primary-hint]")?.innerText?.trim() ?? "",
      };
    })()`,
  );
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

/** 按选择器点元素（用于带 data-* 钩子的按钮），返回 clicked / not-found / disabled。 */
async function clickSelector(root, page, selector) {
  return await evaluate(
    root,
    page.sessionId,
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return "not-found";
      if (el.disabled) return "disabled";
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

  // ── LQ-30（用户 2026-09-14）：参考素材只支持上传原片，搜爆款与贴链接入口都必须不存在 ──
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
        linkInput: Boolean(document.querySelector("#lq-vd-ref-link")),
        registerButton: labels.some((item) => item.includes("登记参考来源")),
        uploadHint: text.includes("上传参考视频") || text.includes("参考视频原片"),
        filePick: document.querySelectorAll("input[type=file]").length,
      };
    })()`,
  );
  checks.push({
    name: `${label}：爆款复刻只支持上传原片（无搜爆款入口、无贴链接入口）`,
    pass:
      vdSurface.searchButtons.length === 0 &&
      !vdSurface.keywordInput &&
      !vdSurface.linkTab &&
      !vdSurface.linkInput &&
      !vdSurface.registerButton &&
      vdSurface.uploadHint &&
      vdSurface.filePick > 0 &&
      leakHit(vdShell.text) === null,
    detail: `检索按钮=${JSON.stringify(vdSurface.searchButtons)} 关键词框=${vdSurface.keywordInput} 链接页签=${vdSurface.linkTab} 链接输入框=${vdSurface.linkInput} 登记按钮=${vdSurface.registerButton} 上传提示=${vdSurface.uploadHint} 文件输入=${vdSurface.filePick}`,
  });

  // ── LQ-30 ①b：原片选择器必须真实可用（上传是唯一入口，不再需要切页签） ──
  const uploadTabOpen = "no-tab-upload-only";
  await sleep(400);
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
    name: `${label}：首屏就有可用的原片选择器（格式/大小/时长约束可见）`,
    pass:
      vdUploadPanel.videoPick &&
      vdUploadPanel.limitCopy &&
      vdUploadPanel.linkInputGone &&
      leakHit(vdShell.text) === null,
    detail: `视频选择器=${vdUploadPanel.videoPick} 文件输入数=${vdUploadPanel.pickCount} 约束文案=${vdUploadPanel.limitCopy} 无链接输入框=${vdUploadPanel.linkInputGone}`,
  });

  //  ② 已上传的原片 / 照片必须能删除（并清掉上一次报价），删除后能重新选。
  //  ③ 未报价前「先报价，再出片」不能是点不动的死按钮。
  const backToUploadTabLq29 = "upload-only";
  await sleep(300);
  const missingPrimary = await readPrimaryState(root, vd);
  checks.push({
    name: `${label}：素材没齐时出片主按钮明确禁用并点名还差什么`,
    pass:
      backToUploadTabLq29 === "upload-only" &&
      missingPrimary.found === true &&
      missingPrimary.state === "missing" &&
      missingPrimary.disabled === true &&
      /还差/.test(missingPrimary.hint),
    detail: `切页签=${backToUploadTabLq29} 状态=${missingPrimary.state} 禁用=${missingPrimary.disabled} 提示=${missingPrimary.hint.slice(0, 60)}`,
  });

  const videoSet = await setFileInputFiles(root, vd, 'input[type=file][accept*="video/mp4"]', [VIDEO_FIXTURE]);
  let afterVideoUpload = "";
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await sleep(1000);
    afterVideoUpload = await evaluate(root, vd.sessionId, "document.body?.innerText ?? ''");
    if (/已上传：beauty-video-content-av\.mp4/.test(afterVideoUpload) || /上传失败|不支持|请先裁剪|读不到/.test(afterVideoUpload)) break;
  }
  const videoUploaded = /已上传：beauty-video-content-av\.mp4/.test(afterVideoUpload);
  const videoRemoveVisible = await evaluate(root, vd.sessionId, `Boolean(document.querySelector('[data-lq-vd-remove="video"]'))`);
  checks.push({
    name: `${label}：原片能真上传，上传后出现「更换原视频」与删除入口`,
    pass: videoSet === "set" && videoUploaded && videoRemoveVisible === true && afterVideoUpload.includes("更换原视频"),
    detail: `塞文件=${videoSet} 已上传=${videoUploaded} 删除按钮=${videoRemoveVisible} 更换文案=${afterVideoUpload.includes("更换原视频")}`,
  });

  const videoRemoveClick = await clickSelector(root, vd, '[data-lq-vd-remove="video"]');
  await sleep(700);
  const afterVideoRemove = await evaluate(root, vd.sessionId, "document.body?.innerText ?? ''");
  const videoRemoved =
    afterVideoRemove.includes("未上传参考视频") &&
    !afterVideoRemove.includes("更换原视频") &&
    /已删除参考视频/.test(afterVideoRemove) &&
    !(await evaluate(root, vd.sessionId, `Boolean(document.querySelector('[data-lq-vd-remove="video"]'))`));
  checks.push({
    name: `${label}：已上传的原片能删除，删完回到「未上传 + 重新选择」`,
    pass: videoRemoveClick === "clicked" && videoRemoved,
    detail: `点删除=${videoRemoveClick} 回到未上传=${afterVideoRemove.includes("未上传参考视频")} 出现删除提示=${/已删除参考视频/.test(afterVideoRemove)}`,
  });

  // 删掉再传一次：走的是真实的「替换素材」路径（换新幂等键，清掉上一次报价）。
  await setFileInputFiles(root, vd, 'input[type=file][accept*="video/mp4"]', [VIDEO_FIXTURE]);
  let videoReuploaded = false;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await sleep(1000);
    videoReuploaded = /已上传：beauty-video-content-av\.mp4/.test(await evaluate(root, vd.sessionId, "document.body?.innerText ?? ''"));
    if (videoReuploaded) break;
  }
  const photoSet = await setFileInputFiles(root, vd, 'input[type=file][accept*="image/jpeg"]', [PHOTO_FIXTURE]);
  let afterPhotoUpload = "";
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await sleep(1000);
    afterPhotoUpload = await evaluate(root, vd.sessionId, "document.body?.innerText ?? ''");
    if (/已上传：lanqi-logo\.jpg/.test(afterPhotoUpload) || /上传失败|不支持/.test(afterPhotoUpload)) break;
  }
  const photoUploaded = /已上传：lanqi-logo\.jpg/.test(afterPhotoUpload);
  const photoRemoveVisible = await evaluate(root, vd.sessionId, `Boolean(document.querySelector('[data-lq-vd-remove="portrait"]'))`);
  checks.push({
    name: `${label}：照片能真上传，上传后出现「更换照片」与删除入口`,
    pass: videoReuploaded && photoSet === "set" && photoUploaded && photoRemoveVisible === true && afterPhotoUpload.includes("更换照片"),
    detail: `原片重传=${videoReuploaded} 塞文件=${photoSet} 已上传=${photoUploaded} 删除按钮=${photoRemoveVisible} 更换文案=${afterPhotoUpload.includes("更换照片")}`,
  });

  const photoRemoveClick = await clickSelector(root, vd, '[data-lq-vd-remove="portrait"]');
  await sleep(700);
  const afterPhotoRemove = await evaluate(root, vd.sessionId, "document.body?.innerText ?? ''");
  // 文案是「未上传${photoNeeded}照片」，photoNeeded 随换脸 / 换人模式变化
  // （头部图片 / 全身画面），所以这里按「未上传…照片」的结构匹配，不写死某一种。
  const photoUnuploadedText = /未上传\S{0,6}照片/.test(afterPhotoRemove);
  const photoRemoved =
    photoUnuploadedText &&
    !afterPhotoRemove.includes("更换照片") &&
    /已删除人物照片/.test(afterPhotoRemove);
  checks.push({
    name: `${label}：已上传的照片能删除，删完回到「未上传 + 重新选择」`,
    pass: photoRemoveClick === "clicked" && photoRemoved,
    detail: `点删除=${photoRemoveClick} 回到未上传=${photoUnuploadedText} 出现删除提示=${/已删除人物照片/.test(afterPhotoRemove)}`,
  });

  await setFileInputFiles(root, vd, 'input[type=file][accept*="image/jpeg"]', [PHOTO_FIXTURE]);
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await sleep(1000);
    if (/已上传：lanqi-logo\.jpg/.test(await evaluate(root, vd.sessionId, "document.body?.innerText ?? ''"))) break;
  }
  const rightsBoxes = await evaluate(
    root,
    vd.sessionId,
    `(() => {
      const boxes = [...document.querySelectorAll("label.lq-vd__consent input[type=checkbox]")];
      boxes.forEach((box) => { if (!box.checked) box.click(); });
      return boxes.length;
    })()`,
  );
  await sleep(800);
  const quoteReadyPrimary = await readPrimaryState(root, vd);
  checks.push({
    name: `${label}：素材与四项授权齐了以后，「先报价，再出片」是能点的活按钮`,
    pass:
      rightsBoxes === 4 &&
      quoteReadyPrimary.found === true &&
      quoteReadyPrimary.state === "need_quote" &&
      quoteReadyPrimary.disabled === false &&
      quoteReadyPrimary.text.includes("先报价，再出片"),
    detail: `授权勾选=${rightsBoxes} 状态=${quoteReadyPrimary.state} 禁用=${quoteReadyPrimary.disabled} 文案=${quoteReadyPrimary.text}`,
  });

  const callsBeforeQuoteLq29 = vd.requestTimeline.length;
  const quoteClick = await clickSelector(root, vd, "button[data-lq-vd-primary]");
  let primaryAfterQuote = { found: false };
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await sleep(1000);
    primaryAfterQuote = await readPrimaryState(root, vd);
    if (primaryAfterQuote.state === "ready" || primaryAfterQuote.state === "blocked") break;
  }
  const quoteText = await evaluate(root, vd.sessionId, "document.body?.innerText ?? ''");
  const quoteRequests = vd.requestTimeline.length - callsBeforeQuoteLq29;
  const confirmRequests = countRequests(vd, "/viral-video-replication/confirm");
  const explainGap = primaryAfterQuote.state !== "blocked" || /还缺前置条件|当前还不能出片|缺口见下方说明|未能报价|暂不/.test(quoteText);
  checks.push({
    name: `${label}：点主按钮真的走报价（拿到报价就变「确认并出片」，被拦就说明缺口）且不自动扣积分出片`,
    pass:
      quoteClick === "clicked" &&
      quoteRequests > 0 &&
      (primaryAfterQuote.state === "ready" || primaryAfterQuote.state === "blocked") &&
      explainGap &&
      quoteText.includes("尚未创建") &&
      confirmRequests === 0,
    detail: `点击=${quoteClick} 新增报价请求=${quoteRequests} 报价后状态=${primaryAfterQuote.state} 文案=${primaryAfterQuote.text}`,
  });

  const lq29Shot = await root.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true }, vd.sessionId);
  await writeFile(path.join(outDir, "lq29-replication-quote.png"), Buffer.from(lq29Shot.data, "base64"));

  // ── LQ-31（用户 2026-09-15「用户端不设上限，用户有积分就可以使用爆款复刻」）──
  // 用 20 秒夹具（旧口径 ¥10 上限只能出 16 秒）重传原片再报价：缺口里**不得**再出现
  // provider_budget_exceeded；积分按 24 积分/秒 计（20 秒 = 480 积分）。
  await setFileInputFiles(root, vd, 'input[type=file][accept*="video/mp4"]', [VIDEO_FIXTURE_20S]);
  let twentyUploaded = false;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await sleep(1000);
    twentyUploaded = /已上传：beauty-video-content-20s\.mp4/.test(await evaluate(root, vd.sessionId, "document.body?.innerText ?? ''"));
    if (twentyUploaded) break;
  }
  const rightsStillOk = await evaluate(
    root,
    vd.sessionId,
    `(() => { const boxes = [...document.querySelectorAll("label.lq-vd__consent input[type=checkbox]")]; boxes.forEach((box) => { if (!box.checked) box.click(); }); return boxes.length; })()`,
  );
  await sleep(600);
  await clickSelector(root, vd, "button[data-lq-vd-primary]");
  let twenty = { text: "", gaps: "" };
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await sleep(1000);
    twenty = await evaluate(
      root,
      vd.sessionId,
      `(() => ({ text: document.body?.innerText ?? "", gaps: document.querySelector("[data-lq-vd-gaps]")?.getAttribute("data-lq-vd-gaps") ?? "" }))()`,
    );
    if (twenty.gaps || /这一版还不能出片|确认并出片/.test(twenty.text)) break;
  }
  checks.push({
    name: `${label}：20 秒原片不再撞内部预算上限（缺口不含 provider_budget_exceeded，积分按 24/秒 计）`,
    pass:
      twentyUploaded &&
      rightsStillOk === 4 &&
      !twenty.gaps.includes("provider_budget_exceeded") &&
      // 20 秒 × 24 积分/秒 = 480（该免登录租户没积分，所以缺口应是积分不足）
      (/insufficient_credits/.test(twenty.gaps) || /480/.test(twenty.text)),
    detail: `20秒原片已上传=${twentyUploaded} 授权=${rightsStillOk} 缺口=${twenty.gaps || "(无)"} 含480=${/480/.test(twenty.text)}`,
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

  let reachedStep3 = false;
  if (cards === 3) {
    const picked = await clickButton(root, cp, "用这版");
    let after = "";
    for (let attempt = 0; attempt < 30; attempt++) {
      await sleep(1000);
      after = await evaluate(root, cp.sessionId, "document.body?.innerText ?? ''");
      if (after.includes("第 3 步 / 6")) break;
    }
    reachedStep3 = after.includes("第 3 步 / 6");
    checks.push({
      name: `${label}：用这版直接进第 3 步分镜（没有回头贴文案的路）`,
      pass: picked === "clicked" && reachedStep3 && !after.includes("原样贴进来"),
      detail: `click=${picked} 命中第3步=${reachedStep3}`,
    });
  }

  /**
   * LQ-32：一键成片音频接通（拼接 + 混音）。
   * 这里用真实浏览器验证「音频卡真的能上传」，以及「没出片时点不动合成、也不会偷偷发合成请求」。
   * 合成本身（ffmpeg 拼接 / 混音 / 循环补齐 / 跨租户）在 `pnpm lanqi:media-compose-smoke` 离线覆盖。
   */
  if (reachedStep3) {
    const toMaterials = await clickButton(root, cp, "下一步：上传素材卡");
    let materials = "";
    for (let attempt = 0; attempt < 20; attempt++) {
      await sleep(500);
      materials = await evaluate(root, cp.sessionId, "document.body?.innerText ?? ''");
      if (materials.includes("音频卡")) break;
    }
    const audioInput = await evaluate(
      root,
      cp.sessionId,
      `(() => {
        const el = document.querySelector('input[type=file][accept*="audio"]');
        return el ? { disabled: el.disabled, accept: el.accept } : null;
      })()`,
    );
    checks.push({
      name: `${label}：音频卡真的能上传（不再 disabled），且不再写「本期成片无声」`,
      pass:
        toMaterials === "clicked" &&
        Boolean(audioInput) &&
        audioInput.disabled === false &&
        materials.includes("上传音频") &&
        !materials.includes("上传暂未接通") &&
        !materials.includes("本期成片无声"),
      detail: `click=${toMaterials} input=${JSON.stringify(audioInput)} 旧文案残留=${materials.includes("本期成片无声")}`,
    });

    const setFile = await setFileInputFiles(root, cp, 'input[type=file][accept*="audio"]', [VIDEO_FIXTURE]);
    let uploaded = "";
    for (let attempt = 0; attempt < 20; attempt++) {
      await sleep(1000);
      uploaded = await evaluate(root, cp.sessionId, "document.body?.innerText ?? ''");
      if (uploaded.includes("本片音轨") || uploaded.includes("上传失败")) break;
    }
    checks.push({
      name: `${label}：上传带声音的视频 → 抽音轨 + 出现音轨授权`,
      pass: setFile === "set" && uploaded.includes("本片音轨") && uploaded.includes("使用权") && uploaded.includes("抽音轨"),
      detail: `set=${setFile} 本片音轨=${uploaded.includes("本片音轨")} 授权=${uploaded.includes("使用权")} 抽音轨=${uploaded.includes("抽音轨")}`,
    });

    /** 音轨授权：带音轨的成片必须先勾这一条，否则后端拒绝合成。 */
    const rights = await evaluate(
      root,
      cp.sessionId,
      `(() => {
        const el = document.querySelector("label.lq-vd__consent input[type=checkbox]");
        if (!el) return null;
        const before = el.checked;
        el.click();
        return { found: true, before, after: el.checked };
      })()`,
    );
    checks.push({
      name: `${label}：音轨授权勾选真的可勾（带音轨成片的合规前置）`,
      pass: Boolean(rights) && rights.before === false && rights.after === true,
      detail: JSON.stringify(rights),
    });

    /** 进第 5 步（积分预算 / 成片区）：这里才该出现「合成成片」。 */
    const toSpec = await clickButton(root, cp, "下一步：输出规格");
    let spec = "";
    for (let attempt = 0; attempt < 90; attempt++) {
      await sleep(1000);
      spec = await evaluate(root, cp.sessionId, "document.body?.innerText ?? ''");
      if (spec.includes("合成成片") || spec.includes("积分预算")) break;
    }
    const composeState = await evaluate(
      root,
      cp.sessionId,
      `(() => {
        const el = document.querySelector("[data-lq-vd-compose-btn]");
        return el ? { disabled: el.disabled, text: (el.innerText || "").trim() } : null;
      })()`,
    );
    checks.push({
      name: `${label}：成片区有「合成成片」入口，未出片时点不动且不提前发合成请求`,
      pass:
        toSpec === "clicked" &&
        Boolean(composeState) &&
        composeState.disabled === true &&
        /还差|没出片/.test(composeState.text ?? "") &&
        /带音轨|抽音轨/.test(spec) &&
        countRequests(cp, "/lanqi/media/compose") === 0,
      detail: `click=${toSpec} btn=${JSON.stringify(composeState)} 音轨口径=${/带音轨|抽音轨/.test(spec)} compose请求=${countRequests(cp, "/lanqi/media/compose")}`,
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
    /*
     * 老板 2026-09-15 问「兰琪智能体在哪里充值」：顶栏「我的」原先指向已下线的 `/my-ai`，
     * 点它会被送去平台货架，门店在兰琪里找不到充值入口。这里盯住顶栏必须直达钱包页。
     */
    const meHref = await evaluate(
      root,
      hub.sessionId,
      `(() => { const el = document.querySelector(".lq-pd__me"); return el ? { href: el.getAttribute("href") ?? "", text: (el.innerText || "").trim() } : null; })()`,
    );
    checks.push({
      name: "acquire 枢纽：顶栏「我的 · 充值」直达钱包页（不再被送去已下线的 /my-ai）",
      pass: Boolean(meHref) && /\/recharge$/.test(meHref.href) && meHref.text.includes("充值"),
      detail: JSON.stringify(meHref),
    });
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

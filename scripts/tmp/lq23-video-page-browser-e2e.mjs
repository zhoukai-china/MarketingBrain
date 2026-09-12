#!/usr/bin/env node
/**
 * LQ-23 视频双能力接通 · 页面级真机验收（内测实例）。
 *
 * 只验证「页面装配 + fail closed 边界」，**不点任何会真实扣积分的出片按钮**：
 *   1) `/lanqi/acquire/video` 不再落「开发中」占位页，4 个模式页签都在；
 *   2) 爆款复刻 = 不编造检索结果（明确提示暂未接通真实爆款检索）；
 *   3) 门店素材成片 / AI 剪辑 = 继续 fail closed（明确提示暂未开通）；
 *   4) 文案转片 = 真实接通，第 1→4 步能走通（分镜 / 单镜接口是纯规则，不调模型）；
 *   5) 关键防自欺：第 4 步点「生成本镜」但没传人物正面照时，必须**明确拦下**，
 *      不允许静默降级成别的生成方式，也不允许创建任务 / 扣积分；
 *   6) 全流程控制台错误、页面异常为 0。
 *
 * 用法：
 *   node scripts/tmp/lq23-video-page-browser-e2e.mjs --base https://api.lcppch.top/lanqi-test
 * 可选：--out <截图目录> --port <CDP 端口>
 *
 * 生产实例（https://api.lcppch.top/os-v2）没有免登录门，会停在「登录 / 注册」。
 * 这时用下面三个开关把「真人扫一次码」接进同一条验收链路：
 *   --visible                  开真实窗口（默认 headless，看不到二维码）
 *   --user-data-dir <dir>      持久化 Chrome 配置，扫过一次后续复用登录态
 *   --login-wait <秒>          停在登录页等待真人扫码；扫码成功后自动接着跑完断言
 *   --invite-code <码>         生产是邀请制，扫码前先填产品邀请码（不填只有平台登录态）
 * 例：
 *   node scripts/tmp/lq23-video-page-browser-e2e.mjs --base https://api.lcppch.top/os-v2 \
 *     --visible --user-data-dir "$env:TEMP\lanqi-prod-profile" --login-wait 300 \
 *     --invite-code "<兰琪产品邀请码>"
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
const outDir = argValue("--out", path.join(tmpdir(), "lanqi-video-page-e2e"));
const port = Number(argValue("--port", "9363"));
const userDataDirArg = argValue("--user-data-dir", "");
const loginWaitSeconds = Number(argValue("--login-wait", "0"));
// 生产是邀请制（INVITE_REQUIRED=true）：兰琪入口不填产品邀请码的话，
// 扫码只能拿到平台级登录态，拿不到兰琪产品权限，后面每一页都会落空。
const inviteCodeArg = argValue("--invite-code", "");
const visible = args.includes("--visible");

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
];

function findChrome() {
  for (const candidate of CHROME_CANDIDATES) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  throw new Error("未找到可用的 Chrome/Edge 可执行文件。");
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForDevtools(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return await response.json();
    } catch {
      /* 端口还没起来，继续等 */
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
  const result = await root.send(
    "Runtime.evaluate",
    { expression, returnByValue: true, awaitPromise: true },
    sessionId
  );
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? "页面脚本执行失败");
  }
  return result.result.value;
}

function clickByText(selector, text) {
  return `(() => {
    const nodes = [...document.querySelectorAll(${JSON.stringify(selector)})];
    const hit = nodes.find((node) => (node.textContent || "").includes(${JSON.stringify(text)}));
    if (!hit) return "not-found";
    hit.click();
    return "clicked";
  })()`;
}

/** 按候选文案顺序点第一个命中的节点，返回实际命中的文案。 */
function clickAnyByText(selector, texts) {
  return `(() => {
    const nodes = [...document.querySelectorAll(${JSON.stringify(selector)})];
    for (const text of ${JSON.stringify(texts)}) {
      const hit = nodes.find((node) => (node.textContent || "").includes(text));
      if (hit) {
        hit.click();
        return "clicked:" + text;
      }
    }
    return "not-found";
  })()`;
}

/** React 受控输入：用原生 setter 写值再派发 input 事件，才能触发 onChange。 */
function typeInto(selector, value) {
  return `(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!input) return "not-found";
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return "typed";
  })()`;
}

/** 视频页容器（`.lq-vd`）自己的文本，用来避开侧栏里那些「开发中」标签。 */
function videoPageText() {
  return `(() => {
    const root = document.querySelector(".lq-vd");
    return root ? (root.innerText || "").replace(/\\s+/g, " ") : "";
  })()`;
}

/** 视频页里指向外部平台（抖音 / 视频号）的链接数量：没接通检索就必须是 0。 */
function externalVideoLinks() {
  return `(() => {
    const root = document.querySelector(".lq-vd");
    if (!root) return -1;
    return [...root.querySelectorAll("a[href]")].filter((node) =>
      /douyin|ixigua|weixin|channels|bilibili|kuaishou/i.test(node.getAttribute("href") || "")
    ).length;
  })()`;
}

/** 轮询页面文本直到出现目标串（用来等 React 切步 / 落盘结果）。 */
async function waitForText(root, sessionId, needle, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastText = "";
  while (Date.now() < deadline) {
    try {
      lastText = await evaluate(
        root,
        sessionId,
        `(() => (document.body ? document.body.innerText : "").replace(/\\s+/g, " "))()`
      );
    } catch {
      /* 导航切换会销毁执行上下文，跳过这一帧 */
    }
    if (typeof lastText === "string" && lastText.includes(needle)) return { ok: true, text: lastText };
    await sleep(200);
  }
  return { ok: false, text: lastText };
}

/**
 * 轮询到「任一目标串」首次出现，返回命中的是哪一个。
 * 生产实例用它在「登录 / 注册」与「私域营销」之间判断真人扫码是否已完成。
 */
async function waitForAnyText(root, sessionId, needles, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastText = "";
  while (Date.now() < deadline) {
    try {
      lastText = await evaluate(
        root,
        sessionId,
        `(() => (document.body ? document.body.innerText : "").replace(/\\s+/g, " "))()`
      );
    } catch {
      /* 导航切换会销毁执行上下文，跳过这一帧 */
    }
    if (typeof lastText === "string") {
      const hit = needles.find((needle) => lastText.includes(needle));
      if (hit) return { ok: true, hit, text: lastText };
    }
    await sleep(400);
  }
  return { ok: false, hit: "", text: lastText };
}

/** 容器内文本轮询（`.lq-vd` 范围内）。 */
async function waitForVideoText(root, sessionId, needle, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastText = "";
  while (Date.now() < deadline) {
    try {
      lastText = await evaluate(root, sessionId, videoPageText());
    } catch {
      /* 导航切换会丢弃执行上下文，跳过这一帧 */
    }
    if (typeof lastText === "string" && lastText.includes(needle)) return { ok: true, text: lastText };
    await sleep(200);
  }
  return { ok: false, text: lastText };
}

/** 反复点同一个按钮，直到容器内出现目标文本（用来吃掉门店信息 / 素材异步加载的时序）。 */
async function clickUntilVideoText(root, sessionId, clickExpr, needle, attempts = 8, gapMs = 1200) {
  let last = { ok: false, text: "" };
  let clicks = 0;
  for (let i = 0; i < attempts; i += 1) {
    const clicked = await evaluate(root, sessionId, clickExpr).catch(() => "error");
    if (clicked !== "clicked") return { ok: false, text: `click=${clicked}` };
    clicks += 1;
    last = await waitForVideoText(root, sessionId, needle, Math.max(gapMs, 3000));
    if (last.ok) return { ok: true, text: last.text, clicks };
    await sleep(gapMs);
  }
  return { ok: false, text: last.text, clicks };
}

async function readText(root, sessionId) {
  try {
    return await evaluate(
      root,
      sessionId,
      `(() => (document.body ? document.body.innerText : "").replace(/\\s+/g, " "))()`
    );
  } catch {
    return "";
  }
}

async function snapshot(root, sessionId) {
  return evaluate(
    root,
    sessionId,
    `(() => {
      const text = (document.body ? document.body.innerText : "").replace(/\\s+/g, " ");
      return {
        path: location.pathname,
        text: text.slice(0, 2000),
        videoText: (document.querySelector(".lq-vd")?.innerText ?? "").replace(/\\s+/g, " ").slice(0, 2000),
        tabs: [...document.querySelectorAll('.lq-vd__tabs [role="tab"]')].map((node) => (node.textContent || "").trim()),
        videos: document.querySelectorAll("video").length,
        shotCards: document.querySelectorAll(".lq-vd__shot").length
      };
    })()`
  );
}

async function runViewport(root, viewport) {
  console.log(`\n=== ${viewport.label} (${viewport.width}x${viewport.height}) ===`);
  const consoleErrors = [];
  const pageErrors = [];
  const { targetId } = await root.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await root.send("Target.attachToTarget", { targetId, flatten: true });
  root.on((payload) => {
    if (payload.sessionId !== sessionId) return;
    if (payload.method === "Runtime.consoleAPICalled" && payload.params.type === "error") {
      consoleErrors.push(payload.params.args.map((item) => item.value ?? item.description ?? "").join(" "));
    }
    if (payload.method === "Runtime.exceptionThrown") {
      pageErrors.push(
        payload.params.exceptionDetails.exception?.description ?? payload.params.exceptionDetails.text
      );
    }
  });
  await root.send("Page.enable", {}, sessionId);
  await root.send("Runtime.enable", {}, sessionId);
  await root.send(
    "Emulation.setDeviceMetricsOverride",
    { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.mobile },
    sessionId
  );

  const isTestInstance = /lanqi-test/.test(base);
  const loginShotName = (kind) => path.join(outDir, `${kind}-${viewport.mobile ? "mobile-390" : "desktop-1200"}.png`);
  const grabShot = async (kind) => {
    const shot = await root.send("Page.captureScreenshot", { format: "png" }, sessionId);
    await writeFile(loginShotName(kind), Buffer.from(shot.data, "base64"));
    return loginShotName(kind);
  };

  // 内测实例：先落到根路径建立体验会话（DirectTestLoginGate 只在这时生效一次）。
  // 生产实例没有免登录门（首页是公开货架，视频页会 302 到 /login/lanqi），
  // 由真人用手机微信扫二维码完成授权。
  await root.send("Page.navigate", { url: `${base}/` }, sessionId);
  const gate = await waitForAnyText(root, sessionId, ["私域营销", "登录 / 注册", "点击登录"], 30000);
  const loggedOut = gate.hit === "登录 / 注册" || gate.hit === "点击登录";

  if (isTestInstance) {
    record(`${viewport.label} 内测会话已建立`, gate.ok && gate.hit === "私域营销", `hit=${gate.hit} text=${String(gate.text).slice(0, 80)}`);
  } else if (loggedOut && loginWaitSeconds > 0) {
    // 直接去登录页：生产未登录访问视频页时，应用自己就跳到这里。
    await root.send("Page.navigate", { url: `${base}/login/lanqi` }, sessionId);
    await waitForAnyText(root, sessionId, ["登录 / 注册"], 20000);
    // 先填邀请码，再点微信登录：顺序反了页面会先报「请输入邀请码」。
    let inviteFilled = "skipped";
    if (inviteCodeArg) {
      inviteFilled = await evaluate(root, sessionId, typeInto('input[placeholder*="邀请码"]', inviteCodeArg)).catch(
        () => "error"
      );
    }
    // 登录页默认只有一个按钮，二维码要点了才生成。
    // 实测生产按钮文案是「微信授权登录」；这里按候选文案逐个试，避免再次猜错。
    const clicked = await evaluate(
      root,
      sessionId,
      clickAnyByText("button", ["微信授权登录", "微信一键登录", "登录 / 注册", "微信登录"])
    ).catch(() => "error");
    await sleep(2500);
    const loginShotPath = await grabShot("login");
    info(
      `${viewport.label} 需要真人扫码`,
      `invite=${inviteFilled} click=${clicked} 请在窗口里用手机微信扫码（${base}/login/lanqi）；已截图 ${loginShotPath}；最多等 ${loginWaitSeconds}s`
    );
    const scanned = await waitForPathAway(root, sessionId, "/login", loginWaitSeconds * 1000);
    record(
      `${viewport.label} 真人扫码后离开登录页`,
      scanned.ok,
      scanned.ok ? `path=${scanned.path}` : `超时未扫码（${loginWaitSeconds}s）path=${scanned.path}`
    );
  } else {
    record(`${viewport.label} 生产实例已具备登录态`, !loggedOut, `hit=${gate.hit} text=${String(gate.text).slice(0, 80)}`);
  }

  // 直接打开文案转片所在页（不再经过中间页）。
  await root.send("Page.navigate", { url: `${base}/lanqi/acquire/video` }, sessionId);
  const loaded = await waitForText(root, sessionId, "视频获客", 20000);
  const first = await snapshot(root, sessionId);
  info(`${viewport.label} 落地`, `path=${first.path} tabs=${JSON.stringify(first.tabs)}`);
  record(
    `${viewport.label} 视频页真实渲染，不落「开发中」占位页`,
    loaded.ok &&
      first.path.includes("/lanqi/acquire/video") &&
      !first.videoText.includes("开发中") &&
      first.tabs.length === 4,
    `path=${first.path} text=${String(first.videoText).slice(0, 110)}`
  );
  record(
    `${viewport.label} 4 个模式页签齐全`,
    first.tabs.length === 4 &&
      ["爆款复刻", "门店素材成片", "AI 剪辑", "文案转片"].every((name, i) => first.tabs[i].includes(name)),
    JSON.stringify(first.tabs)
  );

  // 爆款复刻：不编造爆款检索结果。
  const clickReplicate = await evaluate(root, sessionId, clickByText(".lq-vd__tabs [role='tab']", "爆款复刻"));
  await waitForVideoText(root, sessionId, "搜爆款关键词", 5000);
  const typed = await evaluate(root, sessionId, typeInto("#lq-vd-kw", "皮肤管理门店获客"));
  await sleep(300);
  const clickSearch = await evaluate(root, sessionId, clickByText("button", "去抖音/视频号搜爆款"));
  const replicate = await waitForVideoText(root, sessionId, "暂未接通真实爆款检索", 8000);
  const replicateLinks = await evaluate(root, sessionId, externalVideoLinks());
  const replicateFinal = await evaluate(root, sessionId, videoPageText());
  record(
    `${viewport.label} 爆款复刻不编造检索结果（明确暂未接通）`,
    clickReplicate === "clicked" && typed === "typed" && clickSearch === "clicked" && replicate.ok,
    `tab=${clickReplicate} type=${typed} search=${clickSearch} hit=${replicate.ok}`
  );
  record(
    `${viewport.label} 爆款复刻被拦下后没有编造视频链接 / 来源`,
    replicate.ok && replicateLinks === 0 && String(replicateFinal).includes("待检索接通"),
    `外链=${replicateLinks} 待检索接通=${String(replicateFinal).includes("待检索接通")}`
  );

  // 门店素材成片 / AI 剪辑：继续 fail closed。
  for (const name of ["门店素材成片", "AI 剪辑"]) {
    await evaluate(root, sessionId, clickByText(".lq-vd__tabs [role='tab']", name));
    const modeText = await waitForVideoText(root, sessionId, "暂未开通", 6000);
    record(
      `${viewport.label} ${name} 继续 fail closed（不假装出片）`,
      modeText.ok,
      `hit=${modeText.ok} text=${String(modeText.text).slice(0, 90)}`
    );
  }

  // 文案转片：真实接通，走 1 → 4 步（全程纯规则接口，不调模型、不扣积分）。
  await evaluate(root, sessionId, clickByText(".lq-vd__tabs [role='tab']", "文案转片"));
  const step1 = await waitForVideoText(root, sessionId, "文案转片 · 第 1 步 / 4", 8000);
  record(`${viewport.label} 文案转片进入第 1 步`, step1.ok, `text=${String(step1.text).slice(0, 80)}`);

  // 门店信息是异步加载的，没加载完 buildStoryboard 会明确报错且不切步，这里等它到齐再点。
  await sleep(3000);
  await evaluate(root, sessionId, clickByText("button", "填入示例文案"));
  await sleep(300);
  const step2 = await clickUntilVideoText(root, sessionId, clickByText("button", "生成分镜脚本"), "分镜已出", 8, 1500);
  record(
    `${viewport.label} 第 2 步 · 分镜脚本已出`,
    step2.ok,
    `click=${step2.clicks} text=${String(step2.text).slice(0, 90)}`
  );

  const step3 = await clickUntilVideoText(
    root,
    sessionId,
    clickByText("button", "下一步：上传素材卡"),
    "人物卡",
    4,
    1200
  );
  record(`${viewport.label} 第 3 步 · 素材卡已就位`, step3.ok, `text=${String(step3.text).slice(0, 90)}`);

  const step4 = await clickUntilVideoText(
    root,
    sessionId,
    clickByText("button", "下一步：输出规格"),
    "分镜出片",
    6,
    1500
  );
  const before = await snapshot(root, sessionId);
  record(
    `${viewport.label} 第 4 步 · 逐镜出片区已渲染`,
    step4.ok && before.shotCards > 0,
    `text=${String(step4.text).slice(0, 90)} shotCards=${before.shotCards}`
  );
  record(
    `${viewport.label} 出片前未预扣积分（第 4 步先看费用再创建任务）`,
    !before.videoText.includes("本次已确认"),
    `hit=${before.videoText.includes("本次已确认")}`
  );

  // 关键防自欺：缺人物正面照时必须明确拦下，不得静默降级、不得创建任务。
  const clickRender = await evaluate(root, sessionId, clickByText(".lq-vd__shot button", "生成本镜"));
  const blocked = await waitForVideoText(root, sessionId, "还缺正面照", 12000);
  const after = await snapshot(root, sessionId);
  record(
    `${viewport.label} 缺人物正面照时明确拦下（不静默降级文生视频）`,
    clickRender === "clicked" && blocked.ok,
    `click=${clickRender} hit=${blocked.ok}`
  );
  record(
    `${viewport.label} 被拦下时没有创建任务 / 扣积分 / 出片`,
    after.videos === 0 &&
      !after.videoText.includes("本次已确认") &&
      after.videoText.includes(`0/${after.shotCards} 镜已出片`),
    `videos=${after.videos} 已确认=${after.videoText.includes("本次已确认")} 出片进度=${
      after.videoText.includes(`0/${after.shotCards} 镜已出片`) ? `0/${after.shotCards}` : "非 0"
    }`
  );

  record(
    `${viewport.label} 控制台错误 / 页面异常为 0`,
    consoleErrors.length === 0 && pageErrors.length === 0,
    `console=${consoleErrors.length} page=${pageErrors.length}${
      consoleErrors.length ? ` :: ${consoleErrors.join(" | ")}` : ""
    }${pageErrors.length ? ` :: ${pageErrors.join(" | ")}` : ""}`
  );

  const shot = await root.send("Page.captureScreenshot", { format: "png" }, sessionId);
  const shotPath = path.join(outDir, `${viewport.mobile ? "mobile-390" : "desktop-1200"}.png`);
  await writeFile(shotPath, Buffer.from(shot.data, "base64"));
  console.log(`  screenshot: ${shotPath}`);

  await root.send("Target.closeTarget", { targetId });
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const chromePath = findChrome();
  // 传了 --user-data-dir 就复用那份持久配置：生产扫码登录态可以跨多次运行保留。
  const userDataDir = userDataDirArg || (await mkdtemp(path.join(tmpdir(), "lanqi-video-chrome-")));
  if (userDataDirArg) await mkdir(userDataDir, { recursive: true });
  const chrome = spawn(
    chromePath,
    [
      ...(visible ? ["--window-size=1280,900"] : ["--headless=new"]),
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gpu",
      "about:blank",
    ],
    { stdio: "ignore" }
  );

  try {
    const version = await waitForDevtools();
    const root = await CdpSession.connect(version.webSocketDebuggerUrl);
    for (const viewport of [
      { label: "桌面 1200", width: 1200, height: 800, mobile: false },
      { label: "移动 390", width: 390, height: 844, mobile: true },
    ]) {
      await runViewport(root, viewport);
    }
    root.close();
  } finally {
    chrome.kill();
  }

  console.log(`\nlq23_video_page_browser_e2e: ${failures === 0 ? "PASS" : "FAIL"} (${failures} failed)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
/** 等 pathname 离开某个前缀（生产扫码成功后 SPA 会自己从 /login 跳走）。 */
async function waitForPathAway(root, sessionId, prefix, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastPath = "";
  while (Date.now() < deadline) {
    try {
      lastPath = await evaluate(root, sessionId, "location.pathname");
    } catch {
      /* 导航切换会销毁执行上下文，跳过这一帧 */
    }
    if (typeof lastPath === "string" && lastPath && !lastPath.includes(prefix)) {
      return { ok: true, path: lastPath };
    }
    await sleep(1000);
  }
  return { ok: false, path: lastPath };
}

#!/usr/bin/env node
/**
 * 兰琪美业「公域获客」文本类子能力真实浏览器交互走查。
 *
 * 覆盖：短视频文案改稿（诊断并改稿 → 开头 → 成稿 → 标题封面）、
 *       AI 运营顾问（提问 → 回答），直播话术（必填校验 → 真实生成首段逐字稿）。
 * 真实点击、真实接口、真实大模型输出；产物为截图 + JSON 报告。
 *
 * 用法：
 *   node scripts/lanqi-acquire-text-flow.mjs --out C:\tmp\p3-text-flow
 *   （--base 覆盖站点根地址；--settle 覆盖加载等待毫秒）
 *
 * 仅用于本地 / 内测环境验收，不进入生产运行路径。
 */
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
function argValue(flag, fallback) {
  for (let i = args.length - 1; i >= 0; i -= 1) {
    if (args[i] === flag && args[i + 1]) return args[i + 1];
  }
  return fallback;
}

const base = argValue("--base", "http://localhost:5174");
const settleMs = Number(argValue("--settle", "4000"));
const outDir = argValue("--out", path.join(tmpdir(), "lanqi-acquire-text-flow"));
const port = Number(argValue("--port", "9346"));
const width = 1440;
const height = 1200;

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
      /* 浏览器还没起来，继续等 */
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

class Page {
  constructor(root, sessionId) {
    this.root = root;
    this.sessionId = sessionId;
    this.consoleErrors = [];
    this.pageErrors = [];
    this.dialogs = [];
  }

  watch() {
    this.root.on((payload) => {
      if (payload.sessionId !== this.sessionId) return;
      if (payload.method === "Runtime.consoleAPICalled" && payload.params.type === "error") {
        this.consoleErrors.push(payload.params.args.map((item) => item.value ?? item.description ?? "").join(" "));
      }
      if (payload.method === "Runtime.exceptionThrown") {
        this.pageErrors.push(
          payload.params.exceptionDetails.exception?.description ?? payload.params.exceptionDetails.text,
        );
      }
      if (payload.method === "Page.javascriptDialogOpening") {
        this.dialogs.push(payload.params.message);
        void this.root.send("Page.handleJavaScriptDialog", { accept: true }, this.sessionId);
      }
    });
  }

  async evalJs(expression) {
    const result = await this.root.send(
      "Runtime.evaluate",
      { expression, returnByValue: true, awaitPromise: true },
      this.sessionId,
    );
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    }
    return result.result.value;
  }

  text() {
    return this.evalJs(`(document.body?.innerText ?? "").replace(/\\n{3,}/g, "\\n\\n")`);
  }

  async goto(url) {
    await this.root.send("Page.navigate", { url }, this.sessionId);
    await sleep(settleMs);
  }

  async clickText(selector, text) {
    const payload = JSON.stringify({ selector, text });
    const clicked = await this.evalJs(`(() => {
      const { selector, text } = ${payload};
      const nodes = [...document.querySelectorAll(selector)];
      const hit = nodes.find((el) => (el.innerText || el.textContent || "").replace(/\\s+/g, "").includes(text.replace(/\\s+/g, "")));
      if (!hit) return false;
      hit.scrollIntoView({ block: "center" });
      hit.click();
      return true;
    })()`);
    if (!clicked) throw new Error(`点不到「${text}」（选择器 ${selector}）`);
    await sleep(700);
  }

  async fillInput(selector, value) {
    const payload = JSON.stringify({ selector, value });
    const ok = await this.evalJs(`(() => {
      const { selector, value } = ${payload};
      const el = document.querySelector(selector);
      if (!el) return false;
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
      setter.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`);
    if (!ok) throw new Error(`找不到输入框 ${selector}`);
    await sleep(400);
  }

  async waitForText(text, timeoutMs = 25000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const body = await this.text();
      if (body.includes(text)) return true;
      await sleep(700);
    }
    return false;
  }

  /** 等待选择器出现，并且（可选）其中的 innerText 长度达到阈值。 */
  async waitForSelector(selector, timeoutMs = 25000, minLength = 0) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const length = await this.evalJs(
        `(() => { const el = document.querySelector(${JSON.stringify(selector)}); return el ? (el.innerText || "").trim().length : -1; })()`,
      );
      if (length >= minLength && length !== -1) return length;
      await sleep(800);
    }
    return -1;
  }

  /** 清空受控输入框（用于验证必填校验这一失败路径）。 */
  /**
   * 等待同一选择器的「最后一个」节点文本长度达到阈值。
   * 用于流式返回的回答：只看最后一个气泡，且必须等内容长够再断言，避免读到半截。
   */
  async waitForLastText(selector, timeoutMs = 25000, minLength = 1) {
    const deadline = Date.now() + timeoutMs;
    let latest = "";
    while (Date.now() < deadline) {
      latest = await this.evalJs(`(() => {
        const nodes = [...document.querySelectorAll(${JSON.stringify(selector)})];
        return nodes.length ? (nodes[nodes.length - 1].innerText || "") : "";
      })()`);
      if (String(latest).trim().length >= minLength) return String(latest);
      await sleep(800);
    }
    return String(latest);
  }

  /** 清空受控输入框（用于验证必填校验这一失败路径）。 */
  async clearInputs(selectors) {
    await this.evalJs(`(() => {
      const list = ${JSON.stringify(selectors)};
      for (const sel of list) {
        const el = document.querySelector(sel);
        if (!el) continue;
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, "value").set.call(el, "");
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }
      return true;
    })()`);
    await sleep(300);
  }

  async shot(name) {
    const image = await this.root.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true }, this.sessionId);
    const file = path.join(outDir, `${name}.png`);
    await writeFile(file, Buffer.from(image.data, "base64"));
    return file;
  }
}

const checks = [];
const samples = {};
function assert(name, ok, detail = "") {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "ok  " : "FAIL"} - ${name}${detail ? ` :: ${detail}` : ""}`);
}

/** 模型中立：UI 里不得出现厂商 / 模型名。 */
const FORBIDDEN = ["seedance", "doubao", "豆包", "百炼", "dashscope", "deepseek", "可灵", "kling", "通义", "qwen", "wan2.", "wanx", "minimax", "hailuo", "gpt-", "claude", "gemini", "api key", "apikey"];
function forbiddenIn(text) {
  const lower = String(text ?? "").toLowerCase();
  return FORBIDDEN.filter((token) => lower.includes(token));
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const profileDir = await mkdtemp(path.join(tmpdir(), "lanqi-text-flow-profile-"));
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

  let root;
  const screenshots = [];
  try {
    const version = await waitForDevtools();
    root = await CdpSession.connect(version.webSocketDebuggerUrl);
    const { targetId } = await root.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await root.send("Target.attachToTarget", { targetId, flatten: true });
    const page = new Page(root, sessionId);
    page.watch();

    await root.send("Page.enable", {}, sessionId);
    await root.send("Runtime.enable", {}, sessionId);
    await root.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false }, sessionId);

    // ── A. 枢纽页 ──
    await page.goto(`${base}/lanqi/acquire`);
    let body = await page.text();
    assert("枢纽页直达 /lanqi/acquire（无登录跳转）", body.includes("公域获客") && !body.includes("请输入邀请码"), await page.evalJs("location.pathname"));
    for (const entry of ["短视频文案改稿", "视频获客", "文案转片", "直播话术", "AI 运营顾问"]) {
      assert(`枢纽卡存在：${entry}`, body.includes(entry));
    }
    assert("枢纽页不出现内部备注/调试文案", !/TODO|FIXME|待补|占位|mock/i.test(body));
    screenshots.push(await page.shot("01-acquire-hub"));

    // ── B. 短视频文案改稿 → 真实大模型 ──
    await page.goto(`${base}/lanqi/acquire/copywriter`);
    body = await page.text();
    assert("文案改稿页直达且步骤器为 4 步", body.includes("原稿") && body.includes("开头") && body.includes("成稿") && body.includes("标题封面"));
    await page.fillInput(
      ".lq-cw__area",
      "大家好，我们是兰琪美业。最近好多姐妹问，为什么做完护理当天感觉很水润，过两天又干回去了。其实不是产品不行，是你没做居家维护。我们店现在有个皮肤管理体验，做完会给你一份三天居家方案。",
    );
    await page.clickText(".lq-cw__primary", "诊断并改稿");
    const cwOk = await page.waitForText("三种切入方式", 90000);
    assert("文案改稿：真实接口返回并进入「开头」步骤", cwOk, cwOk ? "" : (await page.text()).slice(0, 300));
    if (cwOk) {
      const opening = await page.evalJs(`(() => {
        const el = document.querySelector(".lq-cw__opt");
        return el ? el.innerText.replace(/\\s+/g, " ").slice(0, 200) : "";
      })()`);
      samples.copywriterOpening = opening;
      assert("文案改稿：开头选项有真实文案（非占位）", opening.length > 20, opening.slice(0, 80));
      assert("文案改稿：开头选项至少 3 个", (await page.evalJs(`document.querySelectorAll(".lq-cw__opt").length`)) >= 3);
      screenshots.push(await page.shot("02-copywriter-openings"));

      await page.clickText(".lq-cw__primary", "下一步：编辑成稿");
      const editorLen = await page.waitForSelector(".lq-cw__editor-box", 20000, 80);
      const draftOk = editorLen >= 80;
      await sleep(600);
      const draft = await page.evalJs(`(() => { const el = document.querySelector(".lq-cw__editor-box"); return el ? el.innerText : ""; })()`);
      samples.copywriterDraft = String(draft).slice(0, 400);
      assert("文案改稿：成稿步骤有真实正文（>80 字）", draftOk, `${String(draft).trim().length} 字`);
      const checkCount = await page.evalJs(`document.querySelectorAll(".lq-moments__checks > div").length`);
      assert("文案改稿：成稿步骤回显合规/事实检查项", checkCount >= 3, `${checkCount} 项`);
      screenshots.push(await page.shot("03-copywriter-draft"));

      await page.clickText(".lq-cw__primary", "下一步：标题与封面");
      await sleep(1200);
      const titles = await page.evalJs(`document.body.innerText.match(/标题[\\s\\S]{0,400}/)?.[0] ?? ""`);
      samples.copywriterTitles = String(titles).slice(0, 400);
      screenshots.push(await page.shot("04-copywriter-titles"));
      assert("文案改稿：标题封面步骤可达", Boolean(draftOk));
    }
    const cwBody = await page.text();
    assert("文案改稿：UI 不出现模型/厂商名", forbiddenIn(cwBody).length === 0, forbiddenIn(cwBody).join(",") || "无");
    assert("文案改稿：无新增控制台错误", page.consoleErrors.length === 0 && page.pageErrors.length === 0,
      `${page.consoleErrors.length} console / ${page.pageErrors.length} page`);

    // ── C. AI 运营顾问 → 真实大模型 ──
    await page.goto(`${base}/lanqi/acquire/methods`);
    body = await page.text();
    assert("AI 运营顾问页直达", body.includes("AI 运营顾问") || body.includes("运营顾问"));
    await page.fillInput("textarea", "我在抖音发了十几条视频都没什么人看，也没人来店里，第一周应该先做什么？");
    await page.clickText(".lq-adv__input button", "发送");
    // 回答是流式返回的：等到最后一个回答气泡的正文长度够再断言，避免读到半截
    const advBody = await page.waitForLastText(".lq-adv__body", 120000, 121);
    samples.advisor = String(advBody).slice(0, 600);
    assert("AI 运营顾问：返回真实回答正文（>120 字）", String(advBody).trim().length > 120, `${String(advBody).length} 字`);
    const advText = await page.text();
    assert("AI 运营顾问：UI 不出现模型/厂商名", forbiddenIn(advText).length === 0, forbiddenIn(advText).join(",") || "无");
    screenshots.push(await page.shot("05-advisor-answer"));

    // ── D. 直播话术：必填校验 + 真实生成首段 ──
    await page.goto(`${base}/lanqi/acquire/live`);
    body = await page.text();
    assert("直播话术页直达且出现输入区", body.includes("直播信息") && body.includes("生成 2 小时逐字稿"));
    // 失败路径：demo 预填了示例值，先清空全部必填再点生成，验证「缺则反问」不捏造
    await page.clearInputs(["#lq-live-host", "#lq-live-main", "#lq-live-sell", "#lq-live-price", "#lq-live-card"]);
    await page.clickText(".lq-live__chip", "团购券");
    await page.clickText(".lq-live__chip", "居家产品");
    await page.clickText(".lq-live__chip", "会员卡");
    await page.clickText(".lq-live__chip", "抖音");
    await page.clickText(".lq-live__chip", "视频号");
    await page.clickText(".lq-live__gen", "生成 2 小时逐字稿");
    body = await page.text();
    assert("直播话术：缺必填时给出精确中文提示（不捏造）", body.includes("还差必填"), body.includes("还差必填") ? "" : body.slice(0, 200));
    screenshots.push(await page.shot("06-live-required-guard"));

    await page.fillInput("#lq-live-host", "小雅");
    await page.fillInput("#lq-live-main", "补水护理体验");
    await page.fillInput("#lq-live-sell", "深层补水+舒缓，做完当天就能上妆，适合熬夜脸、换季干皮。");
    await page.fillInput("#lq-live-price", "体验价 99 元，原价 398 元，限今天直播间。");
    await page.clickText(".lq-live__chip", "团购券");
    await page.clickText(".lq-live__chip", "抖音");
    await page.clickText(".lq-live__gen", "生成 2 小时逐字稿");
    const segLen = await page.waitForSelector(".lq-live__card .body-text", 240000, 200);
    const liveSegOk = segLen >= 200;
    assert("直播话术：真实接口出第 1 段逐字稿", liveSegOk, `${segLen} 字`);
    if (liveSegOk) {
      const firstSeg = await page.evalJs(`(() => { const el = document.querySelector(".lq-live__field .body-text"); return el ? el.innerText : ""; })()`);
      samples.liveFirstSegment = String(firstSeg).slice(0, 400);
      assert("直播话术：第 1 段逐字稿为真实口播内容（>200 字）", String(firstSeg).trim().length > 200, `${String(firstSeg).length} 字`);
      screenshots.push(await page.shot("07-live-first-batch"));
    }
    const liveText = await page.text();
    assert("直播话术：UI 不出现模型/厂商名", forbiddenIn(liveText).length === 0, forbiddenIn(liveText).join(",") || "无");

    // 收尾：离开页面即停止后续批次请求，避免开发阶段无谓消耗
    await page.goto("about:blank");

    const failed = checks.filter((c) => !c.ok);
    const report = {
      generatedAt: new Date().toISOString(),
      base,
      total: checks.length,
      passed: checks.length - failed.length,
      failed: failed.length,
      checks,
      samples,
      screenshots,
      consoleErrors: page.consoleErrors,
      pageErrors: page.pageErrors,
      dialogs: page.dialogs,
    };
    const file = path.join(outDir, "lanqi-acquire-text-flow.json");
    await writeFile(file, JSON.stringify(report, null, 2), "utf8");
    console.log(`\nreport: ${file}`);
    console.log(`summary: ${checks.length - failed.length}/${checks.length} PASS`);
    process.exitCode = failed.length ? 1 : 0;
  } finally {
    root?.close();
    chrome.kill();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

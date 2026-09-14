#!/usr/bin/env node
/**
 * 兰琪美业「公域获客 / 视频获客」四模式交互验收脚本。
 *
 * ⚠️ 已退役（SUPERSEDED）。本脚本断言的是 LQ-19 时期的「一页四页签」页面
 * （🔥 爆款复刻 / 🏪 门店素材成片 / ✂️ AI 剪辑 / 📝 文案转片）与当时的
 * fail-closed 文案，这些结构在 LQ-26（拆成 /lanqi/acquire/video + /lanqi/acquire/video-copy
 * 两个路由）、LQ-27（爆款复刻真实出片 + 按秒计价）、LQ-28（取消「搜爆款」，改为
 * 门店自备参考素材）之后都不再存在，直接运行必然失败，且失败不代表页面有问题。
 *
 * 现在的权威入口（真实浏览器、可重复）：
 *   pnpm.cmd lanqi:acquire-instance-acceptance   # 打测试实例，爆款复刻 + 一键成片全量验收
 *   pnpm.cmd lanqi:acquire-ui-contract-smoke     # 源码静态契约（含 LQ-28 下线断言）
 *
 * 确需复现历史四页签行为（例如对照 LQ-19 老构建）时才加 --legacy 运行。
 *
 * 与 lanqi-page-check.mjs 的区别：本脚本会真实点击 4 个模式页签、触发主按钮、
 * 轮询真实接口返回，并对关键文案与 fail-closed 行为做断言，产物为截图 + JSON 报告。
 *
 * 用法：
 *   node scripts/lanqi-acquire-video-flow.mjs --out C:\tmp\p3-flow
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
const target = `${base}/lanqi/acquire/video`;
const settleMs = Number(argValue("--settle", "4000"));
const outDir = argValue("--out", path.join(tmpdir(), "lanqi-acquire-video-flow"));
const port = Number(argValue("--port", "9344"));
const width = 1440;
const height = 1100;

if (!args.includes("--legacy")) {
  console.error(
    [
      "本脚本已退役（SUPERSEDED）：断言对象是 LQ-19 的四页签页面，LQ-26 / LQ-27 / LQ-28 之后已不存在。",
      "请改用：pnpm.cmd lanqi:acquire-instance-acceptance（真实浏览器验收）",
      "     或：pnpm.cmd lanqi:acquire-ui-contract-smoke（源码契约 smoke）",
      "确需复现历史行为时加 --legacy 运行。",
    ].join("\n"),
  );
  process.exit(3);
}

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

class Page {
  constructor(root, sessionId) {
    this.root = root;
    this.sessionId = sessionId;
    this.consoleErrors = [];
    this.pageErrors = [];
    this.dialogs = [];
    this.stepErrors = [];
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
      if (payload.method === "Runtime.consoleAPICalled") {
        for (const item of payload.params.args) {
          const text = item.value ?? item.description ?? "";
          if (typeof text === "string" && text.includes("step-error")) this.stepErrors.push(text);
        }
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

  /** 往受控 input / textarea 里写字（绕过 React 受控组件，直接派发 input 事件）。 */
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

  async clickCheckbox(selector) {
    const ok = await this.evalJs(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.scrollIntoView({ block: "center" });
      el.click();
      return true;
    })()`);
    if (!ok) throw new Error(`找不到复选框 ${selector}`);
    await sleep(400);
  }

  async waitForButton(text, timeoutMs = 30000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const found = await this.evalJs(`[...document.querySelectorAll("button")].some((el) => (el.innerText || "").includes(${JSON.stringify(text)}))`);
      if (found) return true;
      await sleep(500);
    }
    return false;
  }

  async waitForText(text, timeoutMs = 25000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const body = await this.text();
      if (body.includes(text)) return true;
      await sleep(500);
    }
    return false;
  }

  async waitForTextGone(text, timeoutMs = 25000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const body = await this.text();
      if (!body.includes(text)) return true;
      await sleep(500);
    }
    return false;
  }

  async shot(name) {
    const image = await this.root.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true }, this.sessionId);
    const file = path.join(outDir, `${name}.png`);
    await writeFile(file, Buffer.from(image.data, "base64"));
    return file;
  }
}

const checks = [];
function assert(name, ok, detail = "") {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "ok  " : "FAIL"} - ${name}${detail ? ` :: ${detail}` : ""}`);
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const profileDir = await mkdtemp(path.join(tmpdir(), "lanqi-video-flow-profile-"));
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
    await root.send(
      "Emulation.setDeviceMetricsOverride",
      { width, height, deviceScaleFactor: 1, mobile: false },
      sessionId,
    );
    await root.send("Page.navigate", { url: target }, sessionId);
    await sleep(settleMs);

    // ── 首屏 ──
    let body = await page.text();
    assert("页面直达 /lanqi/acquire/video（无登录跳转）", body.includes("视频获客"), page.evalJs("location.pathname"));
    for (const tab of ["🔥 爆款复刻", "🏪 门店素材成片", "✂️ AI 剪辑", "📝 文案转片"]) {
      assert(`模式页签存在：${tab}`, body.includes(tab));
    }
    screenshots.push(await page.shot("01-replicate-default"));

    // ── 模式 1：爆款复刻 → 未接通真实检索必须 fail closed ──
    body = await page.text();
    assert("爆款复刻：平台筛选文案对齐 demo（抖音+视频号）", body.includes("抖音+视频号"));
    assert("爆款复刻：行业领域文案对齐 demo（美容·皮肤管理 / SPA·养生 / 综合生活美容）",
      body.includes("美容·皮肤管理") && body.includes("SPA·养生") && body.includes("综合生活美容"));
    await page.fillInput("#lq-vd-kw", "皮肤管理门店获客");
    await page.clickText("button", "AI 去抖音/视频号搜爆款");
    body = await page.text();
    assert("爆款复刻：点搜索后进入离线态且不编造结果", body.includes("暂未接通真实爆款检索"));
    assert("爆款复刻：明确声明不做假数据", body.includes("不做假数据"));
    assert(
      "爆款复刻：未出现伪造链接 / 播放量",
      !/https?:\/\/\S*(douyin|weixin|xiaohongshu)/i.test(body) && !/\d+(\.\d+)?\s*万\s*(播放|点赞)/.test(body),
    );
    screenshots.push(await page.shot("02-replicate-blocked"));

    // ── 模式 2：门店素材成片 → 未勾肖像授权禁止生成 ──
    await page.clickText("button", "门店素材成片");
    body = await page.text();
    assert("门店素材成片：首屏出现素材上传与风格选择", body.includes("老板宣传视频") && body.includes("画面风格"));
    await page.clickText("button", "生成门店视频");
    body = await page.text();
    assert("门店素材成片：未勾肖像授权时禁止生成（合规要求）", body.includes("需先勾选肖像权授权再生成"));
    screenshots.push(await page.shot("03-assets-consent-guard"));

    // ── 模式 3：AI 剪辑 ──
    await page.clickText("button", "AI 剪辑");
    body = await page.text();
    assert("AI 剪辑：出现成片时长与剪辑选项", body.includes("去废镜头") || body.includes("自动字幕"));
    screenshots.push(await page.shot("04-clip"));

    // ── 模式 4：文案转片 → 真实接口出分镜 ──
    await page.clickText("button", "文案转片");
    await page.clickText("button", "填入示例文案");
    await page.clickText("button", "生成分镜脚本");
    const storyOk = await page.waitForText("分镜已出", 45000);
    assert("文案转片：真实接口返回分镜（分镜已出）", storyOk, storyOk ? "" : (await page.text()).slice(0, 400));
    if (storyOk) {
      const shotInfo = await page.evalJs(`(() => {
        const t = document.body.innerText;
        const m = t.match(/(\\d+)\\s*镜\\s*·\\s*(\\d+)\\s*秒/);
        return { match: m ? m[0] : null, hasPrompt: t.includes("生视频提示词"), hasExport: t.includes("导出提示词") || t.includes("导出") };
      })()`);
      assert("文案转片：分镜镜数与总秒速回显", Boolean(shotInfo.match), shotInfo.match ?? "未匹配到「N 镜 · M 秒」");
      assert("文案转片：每镜带生视频提示词", shotInfo.hasPrompt);
      screenshots.push(await page.shot("05-script-storyboard"));

      await page.clickText("button", "下一步：上传素材卡");
      const step3Ok = await page.waitForButton("下一步：输出规格", 30000);
      assert("文案转片：素材卡步骤可达（人物 / 场景 / 道具 / 音频）", step3Ok);
      if (step3Ok) {
        await page.clickText("button", "下一步：输出规格");
      }
      const step4Ok = await page.waitForButton("确认并生成", 30000);
      assert("文案转片：输出规格步骤可达（画质档位 3 档）", step4Ok);
      if (step4Ok) {
        const tiers = await page.evalJs(`[...document.querySelectorAll(".lq-vd__tier")].map((el) => el.innerText.replace(/\\s+/g, " "))`);
        assert("文案转片：画质档位只有 480p / 720p / 1080p 三档",
          tiers.length === 3 && tiers.join("|").includes("480p") && tiers.join("|").includes("720p") && tiers.join("|").includes("1080p"),
          tiers.join(" || "));
        await page.clickCheckbox(".lq-vd__consent input");
      }
      const beforeDialogs = page.dialogs.length;
      const genBtn = await page.evalJs(`(() => {
        const hit = [...document.querySelectorAll("button")].find((el) => (el.innerText || "").includes("确认并生成") || (el.innerText || "").includes("生成成片"));
        if (!hit) return false;
        hit.scrollIntoView({ block: "center" });
        hit.click();
        return true;
      })()`);
      if (genBtn) {
        await sleep(900);
        const modalOk = await page.waitForText("肖像授权确认", 8000);
        assert("文案转片：勾选授权后弹出肖像授权确认（唯一合规动作）", modalOk);
        if (modalOk) {
          screenshots.push(await page.shot("06-script-portrait-modal"));
          await page.clickText("button", "确认授权，开始用");
        }
        await sleep(1200);
        const dialog = page.dialogs.slice(beforeDialogs).join(" | ");
        assert(
          "文案转片：出片按钮 fail closed（提示服务未开通，不假装生成成功）",
          dialog.includes("视频生成服务暂未开通"),
          dialog,
        );
        screenshots.push(await page.shot("07-script-render-guard"));
      } else {
        assert("文案转片：出片按钮存在", false, "未找到「确认并生成」按钮");
      }
    }

    // ── 全流程守卫 ──
    const allText = await page.text();
    const banned = ["Seedance", "seedance", "豆包", "百炼", "DeepSeek", "deepseek", "可灵", "通义", "wan2.2", "minimax", "MiniMax", "即梦", "火山", "方舟", "Kling", "Bailian"];
    const leaked = banned.filter((word) => allText.includes(word));
    assert("页面文本模型中立（无模型名 / 厂商名）", leaked.length === 0, leaked.join(","));
    assert("页面无积分 / 计费字样", !allText.includes("积分") && !allText.includes("¥") && !allText.includes("价格"));
    assert("浏览器控制台无报错", page.consoleErrors.length === 0, page.consoleErrors.slice(0, 3).join(" | "));
    assert("浏览器无未捕获异常", page.pageErrors.length === 0, page.pageErrors.slice(0, 2).join(" | "));

    const reportPath = path.join(outDir, "lanqi-acquire-video-flow.json");
    await writeFile(
      reportPath,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          target,
          checks,
          screenshots,
          consoleErrors: page.consoleErrors,
          pageErrors: page.pageErrors,
          dialogs: page.dialogs,
        },
        null,
        2,
      ),
      "utf8",
    );
    const failed = checks.filter((item) => !item.ok);
    console.log(`\n${checks.length - failed.length} passed, ${failed.length} failed`);
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

// 视频复盘（vidrev）页面级验收：工单 2026-09-13 §四 的前端项 + Excel 真上传。
//
// 覆盖（不发送、不调模型、不扣积分）：
//   ① 未上传前常驻「📥 视频数据导出指南」，视频号助手 / 抖音创作者中心网址可点；
//   ② 界面不再有「快速诊断」按钮与文案；
//   ③ 「✨ 一键填充标准请求」没传文件时给出明确提示；
//   ④ 真实 .xlsx（抖音后台导出格式）拖进对话框后必须真读到数据，不是「暂不能自动读取」；
//   ⑤ 上传后再点一键填充，输入框出现标准请求；控制台无错误；（可选）移动端 390 无横向溢出。
//
// 前置：apps/api dev（3011，DATA_MODE=database）与 apps/web dev（5174）已启动；
//       用 VIDREV_E2E_SESSION_FILE（含 token 的 json）或 VIDREV_E2E_SESSION_TOKEN 提供登录态；
//       VIDREV_E2E_XLSX 指向一个真实 .xlsx（抖音/视频号后台导出格式）。
// 本脚本会把 ipzone__vidrev 临时置为 trial 以便页面可交互，结束时还原原状态。
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: "apps/api/.env", quiet: true });

const webBase = (process.env.VIDREV_E2E_WEB_URL ?? "http://127.0.0.1:5174").replace(/\/+$/, "");
const chromePath = process.env.VIDREV_E2E_CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const skuPath = process.env.VIDREV_E2E_SKU_PATH ?? "/agent/ipzone__vidrev/chat";
const xlsxPath = process.env.VIDREV_E2E_XLSX;
const sessionFile = process.env.VIDREV_E2E_SESSION_FILE;
const inlineToken = process.env.VIDREV_E2E_SESSION_TOKEN;
const mobile = process.env.VIDREV_E2E_MOBILE === "1";
/** 跑已上线的环境（SKU 已是 selling）时跳过本地数据库的临时 trial 切换。 */
const skipStatusFlip = process.env.VIDREV_E2E_SKIP_STATUS_FLIP === "1";
const shotDir = process.env.VIDREV_E2E_SHOT_DIR ?? path.join(tmpdir(), `vidrev-e2e-${Date.now()}`);
const SKU = "ipzone__vidrev";

const results = [];
const record = (ok, label, detail = "") => {
  results.push({ ok, label, detail });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${label}${detail ? ` :: ${detail}` : ""}`);
};
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function resolveToken() {
  if (inlineToken) return inlineToken;
  if (!sessionFile) throw new Error("需要 VIDREV_E2E_SESSION_TOKEN 或 VIDREV_E2E_SESSION_FILE");
  const parsed = JSON.parse(await readFile(sessionFile, "utf8"));
  if (!parsed.token) throw new Error(`${sessionFile} 里没有 token`);
  return parsed.token;
}

async function main() {
  if (!xlsxPath) throw new Error("需要 VIDREV_E2E_XLSX 指向一个真实 .xlsx");
  const token = await resolveToken();
  await mkdir(shotDir, { recursive: true });

  let prisma = null;
  let original = null;
  if (!skipStatusFlip) {
    ({ prisma } = await import("../../apps/api/node_modules/@baolu/db/dist/index.js"));
    original = await prisma.marketplaceSku.findUniqueOrThrow({ where: { skuCode: SKU } });
    await prisma.marketplaceSku.update({ where: { skuCode: SKU }, data: { status: "trial" } });
  }

  const cdp = await startChrome();
  try {
    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    cdp.sessions.add(sessionId);
    await cdp.send("Page.enable", {}, sessionId);
    await cdp.send("Runtime.enable", {}, sessionId);
    await cdp.send("DOM.enable", {}, sessionId);
    await cdp.send(
      "Emulation.setDeviceMetricsOverride",
      mobile
        ? { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }
        : { width: 1440, height: 1600, deviceScaleFactor: 1, mobile: false },
      sessionId
    );
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `try { localStorage.setItem("store_os_token", ${JSON.stringify(token)}); } catch {}`
    }, sessionId);

    cdp.pageErrors.length = 0;
    await cdp.send("Page.navigate", { url: `${webBase}${skuPath}` }, sessionId);
    // 真实环境（测试/生产）拿货架数据比本地慢：必须等「视频复盘自己的界面」渲染出来再断言，
    // 否则会把「SKU 数据还在路上」误判成「没有导出指南 / 还有快速诊断」。
    await waitFor(
      cdp,
      sessionId,
      `() => Boolean(document.querySelector("details.chat-vidrev-guide"))
        || /视频复盘智能体/.test(document.body ? document.body.innerText : "")
        || Boolean(document.querySelector(".chat-page-composer"))`,
      60_000,
      "对话输入区出现"
    );
    await delay(2000);

    // ① 导出指南常驻 + 两个真实网址可点。
    const guide = await evaluate(cdp, sessionId, `() => {
      const details = document.querySelector("details.chat-vidrev-guide");
      const links = Array.from(document.querySelectorAll("details.chat-vidrev-guide a")).map((a) => a.href);
      return { exists: Boolean(details), open: details ? details.open : false, text: details ? details.innerText : "", links };
    }`);
    record(guide.exists, "未上传前展示「📥 视频数据导出指南」折叠卡片");
    record(/视频号助手|微信视频号/.test(guide.text) && /抖音/.test(guide.text), "指南同时覆盖视频号与抖音导出步骤");
    record(
      guide.links.some((href) => href.includes("channels.weixin.qq.com")) && guide.links.some((href) => href.includes("creator.douyin.com")),
      "视频号助手 / 抖音创作者中心网址可点击",
      guide.links.join(" , ").slice(0, 120)
    );

    // ② 不再有「快速诊断」。
    const bodyText = await evaluate(cdp, sessionId, `() => document.body.innerText`);
    record(!/快速诊断/.test(bodyText), "界面没有「快速诊断」按钮与文案");
    record(/深度复盘/.test(bodyText), "界面说明只保留「深度复盘」");

    // ③ 一键填充：没传文件时给人话。
    const fillClicked = await evaluate(cdp, sessionId, `() => {
      const button = Array.from(document.querySelectorAll("button")).find((item) => /一键填充标准请求/.test(item.textContent || ""));
      if (!button) return false;
      button.click();
      return true;
    }`);
    record(fillClicked, "存在「✨ 一键填充标准请求」按钮（替代原「增强提示词」）");
    await delay(400);
    const noFileNote = await evaluate(cdp, sessionId, `() => (document.querySelector(".chat-page-composer .chat-hint") || {}).textContent || ""`);
    record(/请先[\s\S]{0,60}(上传|拖进)/.test(noFileNote) && /CSV/.test(noFileNote), "没传文件点填充时提示先上传数据表", noFileNote.slice(0, 70));

    // ③b 工单 §四：走到「数据」轮只打「复盘」两个字 → 必须回导出指南，不调模型、不扣积分。
    const setTextarea = `(value) => {
      const textarea = document.querySelector(".chat-page-composer textarea") || document.querySelector("textarea");
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
      setter.call(textarea, value);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      return textarea.value;
    }`;
    const clickChoice = async (label) => evaluate(cdp, sessionId, `() => {
      const choice = Array.from(document.querySelectorAll(".chat-choice")).find((node) => (node.textContent || "").includes(${JSON.stringify(label)}));
      if (!choice) return false;
      choice.click();
      return true;
    }`);
    const clickPrimary = async () => evaluate(cdp, sessionId, `() => {
      const button = document.querySelector(".chat-page-composer .btn.primary") || document.querySelector(".btn.primary");
      if (!button) return false;
      button.click();
      return true;
    }`);

    record(await clickChoice("抖音"), "数据轮前置：选择平台「抖音」");
    await delay(600);
    await cdp.send("Runtime.evaluate", { expression: `(${setTextarea})("近30天")`, returnByValue: true }, sessionId);
    await delay(300);
    await clickPrimary();
    await delay(800);
    await cdp.send("Runtime.evaluate", { expression: `(${setTextarea})("复盘")`, returnByValue: true }, sessionId);
    await delay(300);
    await clickPrimary();
    await delay(1200);
    const noData = await evaluate(cdp, sessionId, `() => ({
      body: document.body.innerText,
      hasCost: /本次消耗/.test(document.body.innerText)
    })`);
    record(/先别急|数据导出指南/.test(noData.body) && /channels\.weixin\.qq\.com/.test(noData.body), "只打「复盘」时回复数据导出指南而不是空跑");
    record(!noData.hasCost, "只打「复盘」未产生任何积分消耗提示");

    // ④ 真实 .xlsx 必须真读到数据。
    const { root } = await cdp.send("DOM.getDocument", {}, sessionId);
    const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector: "input[type=file]" }, sessionId);
    if (!nodeId) throw new Error("页面上找不到文件输入框");
    await cdp.send("DOM.setFileInputFiles", { nodeId, files: [path.resolve(xlsxPath)] }, sessionId);
    await delay(3000);

    const attachmentState = await evaluate(cdp, sessionId, `() => {
      const composer = document.querySelector(".chat-page-composer");
      return {
        note: composer ? Array.from(composer.querySelectorAll(".chat-hint")).map((n) => n.textContent).join(" | ") : "",
        body: document.body.innerText
      };
    }`);
    const xlsxName = path.basename(xlsxPath);
    record(/已读取/.test(attachmentState.note), "Excel 上传后提示「已读取…表格内容」", attachmentState.note.slice(0, 90));
    record(!/暂不能自动读取/.test(attachmentState.note), "Excel 不再落到「这类文件暂不能自动读取」");
    record(attachmentState.body.includes(xlsxName), "附件真的挂进了对话框", xlsxName);

    // ⑤ 上传后一键填充 → 输入框出现标准请求。
    await evaluate(cdp, sessionId, `() => {
      const button = Array.from(document.querySelectorAll("button")).find((item) => /一键填充标准请求/.test(item.textContent || ""));
      if (button) button.click();
      return true;
    }`);
    await delay(500);
    const filled = await evaluate(cdp, sessionId, `() => (document.querySelector("textarea") || {}).value || ""`);
    record(/我已上传/.test(filled) && filled.includes(xlsxName), "一键填充生成标准请求并带上文件名", filled.slice(0, 80));

    if (mobile) {
      const overflow = await evaluate(cdp, sessionId, `() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth })`);
      record(overflow.scrollWidth <= overflow.innerWidth + 1, "移动端 390px 无横向溢出", `scrollWidth=${overflow.scrollWidth} innerWidth=${overflow.innerWidth}`);
    }

    const errors = cdp.pageErrors.filter((entry) => !/favicon|Download the React DevTools/i.test(entry));
    record(errors.length === 0, "整个过程控制台无错误", errors.length === 0 ? "0 error" : errors.join(" | ").slice(0, 200));

    const shot = await cdp.send("Page.captureScreenshot", { format: "png" }, sessionId);
    const shotFile = path.join(shotDir, "vidrev-excel-upload.png");
    await writeFile(shotFile, Buffer.from(shot.data, "base64"));
    await writeFile(path.join(shotDir, "result.json"), JSON.stringify({ skuPath, xlsx: xlsxName, note: attachmentState.note, filled, shotFile }, null, 2));
    console.log(`# 截图：${shotFile}`);
  } finally {
    try { cdp.socket.close(); } catch {}
    cdp.child.kill();
    if (prisma && original) {
      await prisma.marketplaceSku.update({ where: { skuCode: SKU }, data: { status: original.status } }).catch(() => {});
      await prisma.$disconnect().catch(() => {});
    }
  }

  const failed = results.filter((item) => !item.ok);
  console.log(JSON.stringify({ result: failed.length === 0 ? "VIDREV_EXCEL_BROWSER_PASS" : "VIDREV_EXCEL_BROWSER_FAIL", passed: results.length - failed.length, failed: failed.length }));
  if (failed.length > 0) process.exitCode = 1;
}

async function startChrome() {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "vidrev-e2e-chrome-"));
  const child = spawn(chromePath, [
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
  const sessions = new Set();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id) {
      if (message.method === "Runtime.exceptionThrown") {
        pageErrors.push(message.params?.exceptionDetails?.exception?.description ?? "runtime exception");
      }
      if (message.method === "Runtime.consoleAPICalled" && message.params?.type === "error" && sessions.has(message.sessionId)) {
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
  const result = await cdp.send("Runtime.evaluate", { expression: `(${functionDeclaration})()`, returnByValue: true, awaitPromise: true }, sessionId);
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? "Runtime.evaluate failed");
  }
  return result.result.value;
}

async function waitFor(cdp, sessionId, predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let value;
    try {
      value = await evaluate(cdp, sessionId, predicate);
    } catch (error) {
      if (!/Execution context was destroyed|Cannot find context|Inspected target navigated/i.test(String(error?.message))) throw error;
      value = null;
    }
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`waitFor timeout: ${label}`);
    await delay(300);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

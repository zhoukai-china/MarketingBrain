// 已部署实例的真实浏览器只读验收：打线上/测试环境的公开 URL，不写任何数据。
// 覆盖：货架渲染、积分→人民币折算（≈ ¥）、7 个未完成内核显示「开发中」、IP 定位详情页「按结果付费 + 重做」文案、控制台无新增错误。
// 用法：DEPLOY_CHECK_WEB_URL=https://api.lcppch.top/lanqi-test node scripts/deployed-marketplace-browser-check.mjs
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const webBase = (process.env.DEPLOY_CHECK_WEB_URL ?? "https://api.lcppch.top/lanqi-test").replace(/\/+$/, "");
const chromePath = process.env.DEPLOY_CHECK_CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const shotDir = process.env.DEPLOY_CHECK_SHOT_DIR ?? path.join(tmpdir(), `deployed-marketplace-check-${Date.now()}`);

const IP_POS_SKU = "ipzone__ip-pos";
/** 创始人 IP 专区 9 个内核里，7 个未完成内核必须是「开发中」。 */
const COMING_SOON_MIN = 7;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function startChrome() {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "deployed-marketplace-chrome-"));
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

  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject, method });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });

  return { child, socket, send, userDataDir, pageErrors, sessions };
}

async function evaluate(cdp, sessionId, functionDeclaration, argument) {
  const expression = argument === undefined ? `(${functionDeclaration})()` : `(${functionDeclaration})(${JSON.stringify(argument)})`;
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
      if (!/Execution context was destroyed|Cannot find context|Inspected target navigated/i.test(error instanceof Error ? error.message : String(error))) {
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

async function main() {
  await mkdir(shotDir, { recursive: true });
  const cdp = await startChrome();
  try {
    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    cdp.sessions.add(sessionId);
    await cdp.send("Page.enable", {}, sessionId);
    await cdp.send("Runtime.enable", {}, sessionId);
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1200, deviceScaleFactor: 1, mobile: false }, sessionId);

    // 1. 货架首页：专区、积分标价与人民币折算、未完成内核的「开发中」占位。
    await cdp.send("Page.navigate", { url: `${webBase}/market` }, sessionId);
    await waitFor(cdp, sessionId, `() => document.body.innerText.includes("创始人IP专区")`);
    await waitFor(cdp, sessionId, `() => document.body.innerText.includes("IP定位智能体")`);
    const shelfText = await evaluate(cdp, sessionId, `() => document.body.innerText`);
    const shelfShot = await shoot(cdp, sessionId, "01-shelf-market");
    await writeFile(path.join(shotDir, "01-shelf-market.txt"), shelfText, "utf8");
    assert.match(shelfText, /行业智能体平台/, "shelf shows the platform brand");
    assert.match(shelfText, /200 积分\/次 · ≈ ¥10/, "IP 定位标价同时展示积分与人民币折算");
    const totalSoon = (shelfText.match(/开发中/g) ?? []).length;
    assert.ok(totalSoon >= COMING_SOON_MIN, `未完成内核必须显示「开发中」，实际出现 ${totalSoon} 处`);

    // 2. IP 定位智能体详情页：按结果付费兜底文案。
    await cdp.send("Page.navigate", { url: `${webBase}/agent/${IP_POS_SKU}` }, sessionId);
    await waitFor(cdp, sessionId, `() => document.body.innerText.includes("按结果付费")`);
    const detailText = await evaluate(cdp, sessionId, `() => document.body.innerText`);
    const detailShot = await shoot(cdp, sessionId, "02-agent-ip-pos");
    await writeFile(path.join(shotDir, "02-agent-ip-pos.txt"), detailText, "utf8");
    assert.match(detailText, /积分\/次 · ≈ ¥/, "detail page shows credits with yuan conversion");
    assert.match(detailText, /不满意可申请重做一次，不重复扣积分/, "detail page explains the free-redo fallback");

    // 3. 该实例的直达入口（免登录实例落兰琪驾驶舱）必须仍然能打开，不受本次发布影响。
    await cdp.send("Page.navigate", { url: `${webBase}/lanqi/dashboard` }, sessionId);
    await waitFor(cdp, sessionId, `() => document.body.innerText.trim().length > 80`);
    const lanqiText = await evaluate(cdp, sessionId, `() => document.body.innerText`);
    const dashboardShot = await shoot(cdp, sessionId, "03-lanqi-dashboard");
    assert.doesNotMatch(lanqiText, /体验入口暂时打不开/, "direct-test entry still opens");

    const realErrors = cdp.pageErrors.filter((entry) => !/favicon|Download the React DevTools/i.test(entry));
    assert.deepEqual(realErrors, [], `console must stay clean: ${realErrors.join(" | ")}`);

    process.stdout.write(
      "deployed_marketplace_browser_check:PASS"
      + ` base=${webBase}`
      + " shelf=PASS"
      + " credits_yuan=PASS"
      + ` coming_soon_count=${totalSoon}`
      + " detail_redo_copy=PASS"
      + " direct_test_entry=PASS"
      + " console_clean=PASS"
      + ` shots=${[shelfShot, detailShot, dashboardShot].join(",")}\n`
    );
  } finally {
    cdp.socket.close();
    const exited = new Promise((resolve) => cdp.child.once("exit", resolve));
    cdp.child.kill();
    await Promise.race([exited, delay(2_000)]);
    await rm(cdp.userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});

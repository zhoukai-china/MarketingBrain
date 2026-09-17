// 视频复盘智能体（vidrev）真实浏览器验收（本地 API + Web，真实模型只跑 1 次深度复盘）。
// 覆盖：模式/平台快捷选项 → 周期/数据文本轮 → 确认生成；结构化报告（第零章置顶、四象限筛选、
// 配比堆叠条、均值+中位数双柱、候选选题加入选题池、CSV/Markdown 导出、原文折叠）；
// 桌面/移动端无横向溢出；控制台无新增错误。
// 前置：apps/api dev（127.0.0.1:3011，DATA_MODE=database）与 apps/web dev（127.0.0.1:5174）已启动，
//       且 web dev 已关闭 VITE_DIRECT_TEST_LOGIN（否则页面免登录会改写注入的验收 token）。
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const webBase = process.env.MP_E2E_WEB_URL ?? "http://127.0.0.1:5174";
const apiBase = process.env.MP_E2E_API_URL ?? "http://127.0.0.1:3011";
const chromePath = process.env.MP_E2E_CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const runChat = process.env.MP_E2E_RUN_CHAT !== "false";
const skipMobile = process.env.MP_E2E_SKIP_MOBILE === "true";
/** 平台范围相位默认跑；个别诊断场景可显式跳过（`MP_E2E_SKIP_PLATFORM_SCOPE=true`）。 */
const runPlatformScope = process.env.MP_E2E_SKIP_PLATFORM_SCOPE !== "true";
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const VIDREV_SKU = "ipzone__vidrev";
const START_BALANCE = 1000;

/** 深度复盘粘贴用的中文表头 CSV：覆盖 4 象限、缺 1 条 5 秒完播、含 1 条投流。 */
const DATA_CSV = [
  "序号,标题,时长(秒),发布时间,播放,点赞,评论,分享,收藏,完播率,5秒完播率,咨询量,是否投流,投流金额,内容类型",
  "v1,示例选题一,68,2026-08-12,124000,3200,286,410,520,31%,62%,23,否,0,人设型",
  "v2,示例选题二,55,2026-08-18,32000,900,60,120,200,38%,60%,6,否,0,干货教学",
  "v3,示例选题三,90,2026-08-25,11000,300,40,30,90,26%,44%,9,否,0,引流转化",
  "v4,示例选题四,22,2026-09-01,8600,190,12,8,40,22%,,2,否,0,入企案例",
  "v5,示例选题五,75,2026-09-03,268000,7100,320,1900,2600,41%,71%,4,否,0,干货教学",
  "v6,示例选题六,41,2026-09-07,6400,150,9,4,30,24%,50%,3,是,1200,案例拆解"
].join("\n");

const PERIOD = "2026-08-12 ~ 2026-09-07";

async function createTenant() {
  // 用美业产品身份建验收租户：与货架 e2e 相同，避免 403 触发免登录改写 token。
  const response = await fetch(`${apiBase}/auth/dev-login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      productCode: "beauty-industry",
      tenantRole: "local_business",
      tenantName: "视频复盘浏览器验收租户",
      industry: "美业"
    })
  });
  const body = await response.json();
  assert.equal(response.status, 200, `dev-login failed: ${JSON.stringify(body)}`);
  assert.ok(body.token, "dev-login did not return a token");
  return { token: body.token, userId: body.userId, tenantId: body.tenantId };
}

async function seedWallet(userId) {
  const { prisma } = await import("../apps/api/node_modules/@baolu/db/dist/index.js");
  await prisma.wallet.upsert({
    where: { userId },
    update: { paidBalance: START_BALANCE },
    create: { userId, paidBalance: START_BALANCE }
  });
  const wallet = await prisma.wallet.findUnique({ where: { userId } });
  return { prisma, wallet };
}

/** 通过真实接口确认验收租户余额已到账（避免脚本进程与 API 进程连到不同库）。 */
async function ensureWalletBalance(token, userId, prisma) {
  const deadline = Date.now() + 10_000;
  let last = null;
  while (Date.now() < deadline) {
    const response = await fetch(`${apiBase}/market/me`, { headers: { authorization: `Bearer ${token}` } });
    const text = await response.text();
    last = { status: response.status, body: text };
    if (response.status === 200) {
      const balance = JSON.parse(text).creditBalance;
      if (balance >= START_BALANCE) return balance;
    }
    await delay(400);
  }
  const readback = await prisma.wallet.findUnique({ where: { userId } }).catch(() => null);
  throw new Error(
    `验收租户余额未到账：userId=${userId} api=${JSON.stringify(last)} dbReadback=${JSON.stringify(readback)}`
  );
}

/**
 * 视频复盘 2026-09-14 按工单验收通过后已重新上架（`ipzone__vidrev` / `meiye__vidrev` = selling）。
 * 本脚本仍把该 SKU 临时置为 trial 跑验收，结束后还原为进入时的状态，避免验收脚本依赖或污染真实开卖状态。
 */
async function withVidrevTrial(prisma, run) {
  const original = await prisma.marketplaceSku.findUniqueOrThrow({ where: { skuCode: VIDREV_SKU } });
  if (original.status !== "trial") {
    await prisma.marketplaceSku.update({ where: { skuCode: VIDREV_SKU }, data: { status: "trial" } });
  }
  try {
    return await run();
  } finally {
    await prisma.marketplaceSku
      .update({ where: { skuCode: VIDREV_SKU }, data: { status: original.status } })
      .catch(() => {});
  }
}

async function connectChrome() {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "mp-vidrev-e2e-"));
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
  const consoleErrors = [];
  const networkLog = [];
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const handler = pending.get(message.id);
      if (!handler) return;
      pending.delete(message.id);
      if (message.error) handler.reject(new Error(`${handler.method}: ${message.error.message}`));
      else handler.resolve(message.result);
      return;
    }
    if (message.method === "Network.responseReceived" && /\/market\//.test(message.params.response.url)) {
      networkLog.push({ url: message.params.response.url, status: message.params.response.status });
    }
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
      consoleErrors.push(message.params.args.map((arg) => arg.value ?? arg.description ?? "").join(" "));
    }
    if (message.method === "Log.entryAdded" && message.params.entry.level === "error") {
      // 带上 URL：否则「403 Forbidden」这种控制台文本查不出是谁拒的。
      const entry = message.params.entry;
      consoleErrors.push(entry.url ? `${entry.text} @ ${entry.url}` : entry.text);
    }
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject, method });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  return { child, socket, send, consoleErrors, networkLog, userDataDir };
}

async function evaluate(cdp, sessionId, functionDeclaration, argument) {
  const expression = argument === undefined
    ? `(${functionDeclaration})()`
    : `(${functionDeclaration})(${JSON.stringify(argument)})`;
  const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? "Runtime.evaluate failed");
  return result.result.value;
}

async function waitFor(cdp, sessionId, expression, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await evaluate(cdp, sessionId, `() => Boolean(${expression})`).catch(() => false);
    if (ready) return;
    await delay(120);
  }
  throw new Error(`timeout waiting for: ${expression}`);
}

async function openPage(cdp, token, url, viewport) {
  const { browserContextId } = await cdp.send("Target.createBrowserContext");
  const { targetId } = await cdp.send("Target.createTarget", { url: webBase, browserContextId });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  for (const domain of ["Page.enable", "Runtime.enable", "Log.enable", "Network.enable"]) await cdp.send(domain, {}, sessionId);
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: false
  }, sessionId);
  await waitFor(cdp, sessionId, "document.readyState === 'complete'");
  await evaluate(cdp, sessionId, `(token) => localStorage.setItem("store_os_token", token)`, token);
  await cdp.send("Page.navigate", { url }, sessionId);
  return { browserContextId, sessionId, targetId };
}

async function clickChoice(cdp, sessionId, text) {
  const clicked = await evaluate(cdp, sessionId, `(label) => {
    const btn = [...document.querySelectorAll('.chat-choices .chat-choice')].find((node) => node.textContent?.includes(label));
    if (!btn || btn.disabled) return false;
    btn.click();
    return true;
  }`, text);
  assert.ok(clicked, `找不到可点的快捷选项：${text}`);
}

async function fillTextarea(cdp, sessionId, text) {
  await evaluate(cdp, sessionId, `(value) => {
    const area = document.querySelector('.chat-page-composer textarea');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    setter.call(area, value);
    area.dispatchEvent(new Event("input", { bubbles: true }));
  }`, text);
}

async function clickPrimary(cdp, sessionId, expectedLabel) {
  await waitFor(cdp, sessionId, `!document.querySelector('.chat-page-composer .btn.primary')?.disabled`, 10_000);
  const label = await evaluate(cdp, sessionId, `() => document.querySelector('.chat-page-composer .btn.primary')?.textContent?.trim()`);
  if (expectedLabel) assert.equal(label, expectedLabel, `主按钮文案应为 ${expectedLabel}，实际 ${label}`);
  await evaluate(cdp, sessionId, `() => document.querySelector('.chat-page-composer .btn.primary').click()`);
}

async function checkVidrevChat(cdp, token) {
  const { sessionId } = await openPage(cdp, token, `${webBase}/agent/${VIDREV_SKU}/chat`, { width: 1280, height: 1000 });
  await waitFor(cdp, sessionId, "document.querySelector('textarea')");
  const pageTokenMatches = await evaluate(
    cdp,
    sessionId,
    `(expected) => localStorage.getItem("store_os_token") === expected`,
    token
  );
  assert.ok(pageTokenMatches, "页面 token 被改写（免登录替换了验收租户），余额断言将失去意义");

  // 第 1 轮：平台快捷选项（2026-09-15 起流程只有「平台 → 数据」两步，统计周期已删除）。
  await waitFor(cdp, sessionId, "[...document.querySelectorAll('.chat-choices .chat-choice')].some((node) => node.textContent?.includes('抖音'))");
  await clickChoice(cdp, sessionId, "抖音");
  // 第 2 轮：数据表。
  await waitFor(cdp, sessionId, "document.querySelectorAll('.chat-page-composer textarea').length === 1");
  await fillTextarea(cdp, sessionId, DATA_CSV);
  await clickPrimary(cdp, sessionId, "确认需求");

  // 确认需求卡片 → 真正扣费生成。
  await waitFor(cdp, sessionId, `[...document.querySelectorAll('button')].some((node) => node.textContent?.includes('确认，开始生成'))`, 20_000);
  await evaluate(cdp, sessionId, `() => {
    [...document.querySelectorAll('button')].find((node) => node.textContent?.includes('确认，开始生成')).click();
  }`);

  try {
    await waitFor(cdp, sessionId, "document.querySelector('.vrv')", 200_000);
  } catch (error) {
    const dump = await evaluate(cdp, sessionId, `() => {
      const rows = [...document.querySelectorAll('.chat-page-list .chat-row')];
      const last = rows[rows.length - 1];
      return {
        rows: rows.length,
        lastRole: last?.className ?? null,
        lastText: last?.textContent?.slice(0, 800) ?? null,
        cost: document.querySelector('.chat-page-cost')?.textContent ?? null,
        donebar: Boolean(document.querySelector('.chat-donebar'))
      };
    }`);
    console.error("视频复盘报告未渲染，页面快照：", JSON.stringify(dump, null, 1));
    console.error("控制台错误：", JSON.stringify(cdp.consoleErrors.slice(0, 8), null, 1));
    console.error("网络日志：", JSON.stringify(cdp.networkLog, null, 1));
    throw error;
  }

  const report = await evaluate(cdp, sessionId, `() => {
    const heads = [...document.querySelectorAll('.vrv .cr-head')].map((node) => node.textContent.trim());
    const exportButtons = [...document.querySelectorAll('.vrv-export button')].map((node) => node.textContent.trim());
    return {
      heads,
      exportButtons,
      quadCells: document.querySelectorAll('.vrv-quad .vrv-quad-cell').length,
      stackSegs: document.querySelectorAll('.vrv-stack .vrv-stack-seg').length,
      meanBars: document.querySelectorAll('.vrv-bars .vrv-bar.mean').length,
      medianBars: document.querySelectorAll('.vrv-bars .vrv-bar.median').length,
      candidates: document.querySelectorAll('.vrv-candidates .vrv-candidate').length,
      queueButtons: [...document.querySelectorAll('.vrv-candidates button')].filter((node) => node.textContent?.includes('加入选题池')).length,
      // 用户 2026-09-17：报告卡片里不再有 Markdown / CSV 导出；唯一下载入口是底部 Word / WPS。
      cardExportButtons: [...document.querySelectorAll('.vrv-export button')].length,
      bottomWordButton: document.querySelector('.chat-page-composer .btn.ghost.block')?.textContent?.trim() ?? null,
      hasRawDetails: Boolean(document.querySelector('details.vrv-raw')),
      auditFirst: heads[0] ?? "",
      costText: document.querySelector('.chat-page-cost')?.textContent?.trim() ?? null,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
    };
  }`);
  assert.ok(report.heads.length >= 11, `深度报告应有 ≥11 个章节标题，实际 ${report.heads.length}`);
  assert.match(report.auditFirst, /⓪ 数据质量审计/, `第零章必须置顶，实际首章为 ${report.auditFirst}`);
  for (const label of ["一、数据总览", "二、视频分层", "五、完播率深层归因", "七、趋势预警", "十、下个周期选题建议"]) {
    assert.ok(report.heads.some((head) => head.includes(label)), `报告缺少章节「${label}」，实际 ${JSON.stringify(report.heads)}`);
  }
  assert.equal(report.quadCells, 4, `四象限应有 4 个格子，实际 ${report.quadCells}`);
  assert.ok(report.stackSegs >= 2, `内容配比堆叠条应有多段，实际 ${report.stackSegs}`);
  assert.ok(report.meanBars >= 1, `均值柱状图缺失（应 ≥1 根），实际 ${report.meanBars}`);
  assert.ok(report.medianBars >= 1, `中位数柱状图缺失（应 ≥1 根），实际 ${report.medianBars}`);
  assert.ok(report.candidates >= 2, `候选选题应 ≥2 条，实际 ${report.candidates}`);
  assert.ok(report.queueButtons >= 2, `候选选题都应带「加入选题池」，实际 ${report.queueButtons}`);
  /**
   * 用户 2026-09-17 最终口径：「这个下载应该下载 word 或者 wps 吧，csv 格式应该没法展示这么多内容
   * 输出吧」+「下方有下载精美 word，所以这里的输出不用再说输出 markdown 和 csv，也不需要展开
   * markdown 原文」——报告卡片里**不再有任何导出按钮 / 原文折叠**，唯一下载入口是底部那颗绿色
   * Word / WPS 按钮（「下载精美 Word / WPS 报告」）。
   */
  assert.equal(
    report.cardExportButtons,
    0,
    `报告卡片里不得再有导出按钮（实际 ${JSON.stringify(report.exportButtons)}）`
  );
  assert.equal(report.hasRawDetails, false, "报告卡片不得再展开 md 原文（details.vrv-raw）");
  assert.match(
    report.bottomWordButton ?? "",
    /下载精美 Word \/ WPS 报告/,
    `底部必须有唯一的 Word / WPS 下载入口，实际 ${report.bottomWordButton}`
  );
  assert.match(report.costText ?? "", /60 积分/, `本次消耗应显示 60 积分，实际 ${report.costText}`);
  assert.equal(report.overflow, 0, "1280px 视频复盘结果页出现横向溢出");

  // 点击一个象限 → 出现可筛选的逐条明细卡片。
  await evaluate(cdp, sessionId, `() => {
    const cell = [...document.querySelectorAll('.vrv-quad .vrv-quad-cell')].find((node) => node.querySelector('.vrv-quad-count')?.textContent?.includes('条'));
    cell?.click();
  }`);
  await waitFor(cdp, sessionId, "document.querySelector('.vrv-quad-detail')", 8_000);
  const detail = await evaluate(cdp, sessionId, `() => ({
    present: Boolean(document.querySelector('.vrv-quad-detail')),
    cards: document.querySelectorAll('.vrv-quad-detail .vrv-video-card').length
  })`);
  assert.ok(detail.present, "点击象限后应出现筛选明细区");
  assert.ok(detail.cards >= 1, `象限筛选应至少渲染 1 张视频卡片，实际 ${detail.cards}`);

  return { sessionId, report, detail };
}

async function checkMobile(cdp, sessionId) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true
  }, sessionId);
  await delay(500);
  const mobile = await evaluate(cdp, sessionId, `() => ({
    width: innerWidth,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    reportVisible: Boolean(document.querySelector('.vrv'))
  })`);
  assert.equal(mobile.width, 390, "移动端视口宽度未生效");
  assert.equal(mobile.reportVisible, true, "移动端丢失视频复盘结构化报告");
  assert.equal(mobile.overflow, 0, "390px 视频复盘结果页出现横向溢出");
  return mobile;
}

/** PLAT-25B：带登录态打开两个视频复盘 chat 页，验证浏览器 <title> 与页内标题去重。零模型成本。 */
async function checkChatTitles(cdp, token) {
  const expected = [
    { sku: "ipzone__vidrev", agent: "视频复盘智能体", zone: "创始人IP专区" },
    { sku: "meiye__vidrev", agent: "美业视频复盘智能体", zone: "美业专区" }
  ];
  const results = {};
  for (const item of expected) {
    const ctx = await openPage(cdp, token, `${webBase}/agent/${item.sku}/chat`, { width: 1280, height: 1000 });
    await waitFor(cdp, ctx.sessionId, "document.querySelector('.chat-page-title')", 20_000);
    const snap = await evaluate(cdp, ctx.sessionId, `() => ({
      pageTitle: document.querySelector('.chat-page-title')?.textContent?.trim() ?? "",
      docTitle: document.title
    })`);
    results[item.sku] = snap;
    assert.ok(snap.pageTitle.includes(item.agent), `${item.sku} 页内标题应含「${item.agent}」，实际「${snap.pageTitle}」`);
    assert.ok(snap.pageTitle.includes(item.zone), `${item.sku} 页内标题应含专区「${item.zone}」，实际「${snap.pageTitle}」`);
    assert.ok(!/^视频复盘 · 视频复盘/.test(snap.pageTitle), `${item.sku} 页内标题不得是旧重复段，实际「${snap.pageTitle}」`);
    assert.ok(snap.docTitle.includes(item.agent), `${item.sku} 浏览器 <title> 应含「${item.agent}」，实际「${snap.docTitle}」`);
    assert.notEqual(snap.docTitle, "思潼AI 行业智能体平台", `${item.sku} 浏览器 <title> 不得退回通用平台名`);
    await cdp.send("Target.closeTarget", { targetId: ctx.targetId });
    await cdp.send("Target.disposeBrowserContext", { browserContextId: ctx.browserContextId });
  }
  assert.notEqual(results.ipzone__vidrev.docTitle, results.meiye__vidrev.docTitle, "两个 SKU 的浏览器 <title> 必须不同（多标签可区分）");
  assert.notEqual(results.ipzone__vidrev.pageTitle, results.meiye__vidrev.pageTitle, "两个 SKU 的页内标题必须不同");
  console.log(`vidrev chat titles: ${JSON.stringify(results)}`);
  return results;
}

/**
 * 平台范围相位（用户 2026-09-15：视频复盘只做抖音 / 视频号）。
 *
 * 为什么要有这一段：`marketplace:vidrev-platform-scope-smoke` 钉的是服务端接口，
 * 而「平台快捷选项里还留着小红书 / 快手 / B站」是用户一眼就能看见的回归，必须用真页面钉住。
 * 不生成、不调模型、不花钱。
 */
async function checkPlatformScope(cdp, token) {
  const ctx = await openPage(cdp, token, `${webBase}/agent/${VIDREV_SKU}/chat`, { width: 1280, height: 1000 });
  try {
    await waitFor(cdp, ctx.sessionId, "document.querySelector('textarea')");
    const snap = await evaluate(cdp, ctx.sessionId, `() => ({
      choices: [...document.querySelectorAll('.chat-choices .chat-choice')].map((node) => (node.textContent ?? '').trim()),
      text: document.body.innerText
    })`);
    const leaked = ["小红书", "快手", "B站", "哔哩哔哩"].filter((word) => snap.text.includes(word));
    assert.deepEqual(snap.choices, ["抖音", "视频号"], `平台快捷选项只允许抖音 / 视频号，实际 ${JSON.stringify(snap.choices)}`);
    assert.deepEqual(leaked, [], `视频复盘 chat 页不得再出现已下线平台：${leaked.join("、")}`);
    // 正对照：支持的两个平台必须真的写着，避免「整段删干净」也算通过。
    for (const platform of ["抖音", "视频号"]) {
      assert.ok(snap.text.includes(platform), `视频复盘 chat 页必须写明支持「${platform}」`);
    }
    console.log(`vidrev platform scope: choices=${JSON.stringify(snap.choices)} textLen=${snap.text.length}`);
    return { choices: snap.choices, textLength: snap.text.length };
  } finally {
    await cdp.send("Target.closeTarget", { targetId: ctx.targetId });
    await cdp.send("Target.disposeBrowserContext", { browserContextId: ctx.browserContextId });
  }
}

async function main() {
  const { token, userId } = await createTenant();
  const { prisma, wallet } = await seedWallet(userId);
  assert.equal(wallet?.paidBalance, START_BALANCE, `seedWallet 写入失败：${JSON.stringify(wallet)}`);
  const balance = await ensureWalletBalance(token, userId, prisma);
  const cdp = await connectChrome();
  const summary = { balance, chat: null, mobile: null, titles: null, platformScope: null };
  summary.titles = await checkChatTitles(cdp, token);
  if (runPlatformScope) summary.platformScope = await checkPlatformScope(cdp, token);
  try {
    await withVidrevTrial(prisma, async () => {
      if (runChat) {
        const chat = await checkVidrevChat(cdp, token);
        summary.chat = chat.report;
        if (!skipMobile) summary.mobile = await checkMobile(cdp, chat.sessionId);
      }
    });

    const blocking = cdp.consoleErrors.filter(
      (text) => !/favicon|Download the React DevTools|Failed to load resource: the server responded with a status of 404/.test(text)
    );
    // 控制台只说「403」看不出是谁拒的，把这一步的 /market/* 非 2xx 响应一并带进断言信息。
    const failedCalls = cdp.networkLog
      .filter((entry) => entry.status >= 400)
      .map((entry) => `${entry.status} ${entry.url.replace(/^https?:\/\/[^/]+/, "")}`);
    assert.equal(
      blocking.length,
      0,
      `页面控制台出现错误：${JSON.stringify(blocking.slice(0, 3))}；失败请求：${JSON.stringify(failedCalls.slice(0, 5))}`
    );
    console.log(JSON.stringify({
      status: "PASS",
      webBase,
      apiBase,
      chatRun: runChat,
      ...summary,
      consoleErrors: cdp.consoleErrors.length
    }));
  } finally {
    await prisma.wallet.deleteMany({ where: { userId } }).catch(() => {});
    await prisma.membership.deleteMany({ where: { userId } }).catch(() => {});
    cdp.child.kill();
    await rm(cdp.userDataDir, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});

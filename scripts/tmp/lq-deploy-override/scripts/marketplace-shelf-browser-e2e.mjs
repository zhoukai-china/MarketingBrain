// 思潼 AI 货架 + IP 定位智能体真实浏览器验收（本地 API + Web，真实模型只跑 1 次）。
// 覆盖：7 个内核显示「开发中」、IP 定位 200 积分详情页、聊天页结构化报告渲染、桌面/移动端无横向溢出、控制台无新增错误。
// 前置：apps/api dev（127.0.0.1:3011）与 apps/web dev（127.0.0.1:5174）已启动。
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const webBase = process.env.MP_E2E_WEB_URL ?? "http://127.0.0.1:5174";
const apiBase = process.env.MP_E2E_API_URL ?? "http://127.0.0.1:3011";
const chromePath = process.env.MP_E2E_CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const runChat = process.env.MP_E2E_RUN_CHAT !== "false";
const skipShelf = process.env.MP_E2E_SKIP_SHELF === "true";
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const IP_POS_SKU = "ipzone__ip-pos";
const COPY_SKU = "ipzone__copy";
const SOON_SKU = "ipzone__liverev";
const IPZONE_NAME = "创始人IP专区";
/** 兰琪专区是品牌专属专区：只上架 1 个品牌内核，且当前为「开发中」。 */
const LANQI_ZONE_NAME = "兰琪专区";
const LANQI_SKU = "lanqi__lanqi-brain";
/** 创始人 IP 专区 9 个内核里，7 个未完成内核必须是「开发中」。 */
const IPZONE_TOTAL = 9;
const COMING_SOON_COUNT = 7;
const START_BALANCE = 1000;

/** IP 定位对话流有 4 轮信息收集，逐轮回答后才会出现「确认，开始生成」。 */
const SLOT_ANSWERS = [
  "兰琪美业，在广州做美容院连锁加盟 + 门店经营陪跑，主要赚加盟费和门店服务费，现在处在 1-10 阶段。",
  "30-45 岁、二三线城市、做过美容或想开美容院的女性创业者，年收入 20-50 万；最痛的是没客源、员工留不住、不会做线上获客。",
  "创始人兰琪，从 1 家店做到 12 家直营店，最擅长门店 SOP 和员工带教，性格关键词是务实、直接、较真；做 IP 的核心目标是招商加盟。",
  "抖音 1.2 万粉、视频号 3000 粉，团队 3 人，一周能投入 2 天；拍过最满意的一条是「美容院老板最容易踩的 3 个坑」。"
];

async function createTenant() {
  // 用美业产品身份建验收租户：本机 web dev 开了 VITE_DIRECT_TEST_LOGIN，
  // 通用租户访问 /beauty-industry/stores 会 403，页面免登录会改写 localStorage 里的 token，
  // 导致页面租户和验收 seed 的租户不是同一个。美业租户可让注入的 token 保持不变。
  const response = await fetch(`${apiBase}/auth/dev-login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      productCode: "beauty-industry",
      tenantRole: "local_business",
      tenantName: "货架浏览器验收租户",
      industry: "美业"
    })
  });
  const body = await response.json();
  assert.equal(response.status, 200, `dev-login failed: ${JSON.stringify(body)}`);
  assert.ok(body.token, "dev-login did not return a token");
  return { token: body.token, userId: body.userId, tenantId: body.tenantId };
}

/** 给验收租户一笔真实钱包余额，让「开始生成」在真实扣费链路上跑通。 */
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

/**
 * 通过真实接口确认验收租户余额已到账。
 * 直接读库会掩盖「脚本进程与 API 进程连到不同库/不同用户」这类问题，所以这里以 API 返回为准。
 */
async function ensureWalletBalance(token, userId, prisma) {
  const deadline = Date.now() + 10_000;
  let last = null;
  while (Date.now() < deadline) {
    const response = await fetch(`${apiBase}/market/me`, { headers: { authorization: `Bearer ${token}` } });
    const body = await response.text();
    last = { status: response.status, body };
    if (response.status === 200) {
      const balance = JSON.parse(body).creditBalance;
      if (balance >= START_BALANCE) return balance;
    }
    await delay(400);
  }
  const readback = await prisma.wallet.findUnique({ where: { userId } }).catch(() => null);
  throw new Error(
    `验收租户余额未到账：userId=${userId} api=${JSON.stringify(last)} dbReadback=${JSON.stringify(readback)}`
  );
}

async function connectChrome() {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "mp-shelf-e2e-"));
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
    if (message.method === "Network.requestWillBeSent" && /\/market\/.*\/run|\/skus|\/market\/me/.test(message.params.request.url)) {
      networkLog.push({
        kind: "request",
        url: message.params.request.url,
        method: message.params.request.method,
        hasAuth: /^authorization$/im.test(Object.keys(message.params.request.headers ?? {}).join("\n"))
      });
    }
    if (message.method === "Network.responseReceived" && /\/market\//.test(message.params.response.url)) {
      networkLog.push({
        kind: "response",
        url: message.params.response.url,
        status: message.params.response.status
      });
    }
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
      consoleErrors.push(message.params.args.map((arg) => arg.value ?? arg.description ?? "").join(" "));
    }
    if (message.method === "Log.entryAdded" && message.params.entry.level === "error") {
      consoleErrors.push(message.params.entry.text);
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

async function checkShelf(cdp, token) {
  const { sessionId } = await openPage(cdp, token, `${webBase}/market`, { width: 1280, height: 900 });
  await waitFor(cdp, sessionId, "document.querySelectorAll('.agent-card').length >= 9");
  const shelf = await evaluate(cdp, sessionId, `() => {
    const shelves = [...document.querySelectorAll('.shelf')];
    const ipzone = shelves.find((node) => node.querySelector('.shelf-head h2')?.textContent?.includes(${JSON.stringify(IPZONE_NAME)}));
    const cards = ipzone ? [...ipzone.querySelectorAll('.agent-card')] : [];
    const soon = cards.filter((card) => card.querySelector('.chip.soon'));
    const lanqi = shelves.find((node) => node.querySelector('.shelf-head h2')?.textContent?.includes(${JSON.stringify(LANQI_ZONE_NAME)}));
    const lanqiCards = lanqi ? [...lanqi.querySelectorAll('.agent-card')] : [];
    return {
      zones: shelves.map((node) => node.querySelector('.shelf-head h2')?.textContent?.trim()),
      totalAll: document.querySelectorAll('.agent-card').length,
      total: cards.length,
      soon: soon.length,
      soonTexts: soon.map((card) => card.querySelector('.chip.soon')?.textContent?.trim()),
      soonPrices: soon.map((card) => card.querySelector('.ac-price')?.textContent?.trim()),
      lanqiTotal: lanqiCards.length,
      lanqiNames: lanqiCards.map((card) => card.querySelector('.ac-name')?.textContent?.trim()),
      lanqiSoon: lanqiCards.filter((card) => card.querySelector('.chip.soon')).length,
      lanqiSoonTexts: lanqiCards
        .map((card) => card.querySelector('.chip.soon')?.textContent?.trim())
        .filter(Boolean),
      lanqiPrices: lanqiCards.map((card) => card.querySelector('.ac-price')?.textContent?.trim()),
      selling: cards
        .filter((card) => !card.querySelector('.chip.soon'))
        .map((card) => ({
          name: card.querySelector('.ac-name')?.textContent?.trim(),
          price: card.querySelector('.ac-price')?.textContent?.trim()
        })),
      zoneSoon: document.querySelectorAll('.zone-soon').length,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
    };
  }`);
  assert.ok(shelf.zones.includes(IPZONE_NAME), `货架缺少「${IPZONE_NAME}」，实际 ${JSON.stringify(shelf.zones)}`);
  assert.equal(shelf.total, IPZONE_TOTAL, `${IPZONE_NAME} 应展示 ${IPZONE_TOTAL} 个内核，实际 ${shelf.total}`);
  assert.equal(shelf.soon, COMING_SOON_COUNT, `${IPZONE_NAME} 应有 ${COMING_SOON_COUNT} 个内核显示开发中，实际 ${shelf.soon}`);
  assert.ok(
    shelf.soonTexts.every((text) => text === "🚧 开发中"),
    `开发中标识文案必须统一，实际 ${JSON.stringify(shelf.soonTexts)}`
  );
  assert.ok(
    shelf.soonPrices.every((text) => text?.includes("开发中")),
    `开发中内核不能显示可购买价格，实际 ${JSON.stringify(shelf.soonPrices)}`
  );
  assert.ok(shelf.selling.length === IPZONE_TOTAL - COMING_SOON_COUNT, `已上架内核应为 ${IPZONE_TOTAL - COMING_SOON_COUNT} 个，实际 ${shelf.selling.length}`);
  const ipPosCard = shelf.selling.find((card) => /IP定位/.test(card.name ?? ""));
  assert.ok(
    ipPosCard && /200 积分/.test(ipPosCard.price ?? ""),
    `IP 定位必须显示 200 积分/次，实际 ${JSON.stringify(shelf.selling)}`
  );
  // 标价必须带人民币折算（1 元 = 20 积分）：200 积分 → ≈ ¥10。
  assert.ok(
    /≈ ¥10/.test(ipPosCard?.price ?? ""),
    `IP 定位标价必须带「≈ ¥10」折算，实际 ${ipPosCard?.price}`
  );
  assert.ok(
    shelf.selling.every((card) => /≈ ¥/.test(card.price ?? "")),
    `所有已上架内核标价都必须带「≈ ¥」折算，实际 ${JSON.stringify(shelf.selling)}`
  );
  assert.ok(shelf.zones.includes(LANQI_ZONE_NAME), `货架缺少「${LANQI_ZONE_NAME}」，实际 ${JSON.stringify(shelf.zones)}`);
  assert.equal(shelf.lanqiTotal, 1, `${LANQI_ZONE_NAME} 只应上架 1 个品牌内核，实际 ${shelf.lanqiTotal}`);
  assert.ok(
    shelf.lanqiNames.every((name) => /兰琪/.test(name ?? "")),
    `${LANQI_ZONE_NAME} 只能出现兰琪品牌内核，实际 ${JSON.stringify(shelf.lanqiNames)}`
  );
  assert.equal(shelf.lanqiSoon, 1, `${LANQI_ZONE_NAME} 的品牌内核应显示开发中，实际 ${shelf.lanqiSoon}`);
  assert.deepEqual(shelf.lanqiSoonTexts, ["🚧 开发中"], `兰琪开发中标识文案错误：${JSON.stringify(shelf.lanqiSoonTexts)}`);
  assert.ok(
    shelf.lanqiPrices.every((text) => text?.includes("开发中")),
    `兰琪品牌内核未开放时不能显示可购买价格，实际 ${JSON.stringify(shelf.lanqiPrices)}`
  );
  assert.ok(shelf.zoneSoon >= 1, "未上线专区应显示上新提示");
  assert.equal(shelf.overflow, 0, "1280px 货架首页出现横向溢出");
  return { sessionId, shelf };
}

async function checkDetail(cdp, token, skuId, expected) {
  const { sessionId } = await openPage(cdp, token, `${webBase}/agent/${skuId}`, { width: 1280, height: 900 });
  await waitFor(cdp, sessionId, "document.querySelector('.btn.primary')");
  const detail = await evaluate(cdp, sessionId, `() => {
    const button = document.querySelector('.btn.primary');
    return {
      title: document.querySelector('h1')?.textContent?.trim(),
      button: button?.textContent?.trim(),
      disabled: button?.disabled ?? null,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
    };
  }`);
  assert.equal(detail.overflow, 0, `${skuId} 详情页出现横向溢出`);
  if (expected.comingSoon) {
    assert.equal(detail.disabled, true, `${skuId} 开发中内核的按钮必须禁用`);
    assert.match(detail.button, /开发中/, `${skuId} 开发中内核按钮文案错误：${detail.button}`);
  } else {
    assert.equal(detail.disabled, false, `${skuId} 已上架内核按钮必须可点`);
    assert.match(detail.button, new RegExp(`扣 ${expected.ppu} 积分`), `${skuId} 按钮未显示正确扣费：${detail.button}`);
    // 按钮同时展示人民币折算：200 积分 → ≈ ¥10、40 积分 → ≈ ¥2。
    assert.match(detail.button, /≈ ¥/, `${skuId} 按钮未显示「≈ ¥」折算：${detail.button}`);
  }
  return { sessionId, detail };
}

async function checkIpPosChat(cdp, token) {
  const { sessionId } = await openPage(cdp, token, `${webBase}/agent/${IP_POS_SKU}/chat`, { width: 1280, height: 1000 });
  await waitFor(cdp, sessionId, "document.querySelector('textarea')");
  const pageTokenMatches = await evaluate(
    cdp,
    sessionId,
    `(expected) => localStorage.getItem("store_os_token") === expected`,
    token
  );
  assert.ok(pageTokenMatches, "页面 token 被改写（内测免登录替换了验收租户），余额断言将失去意义");
  const walletView = await evaluate(cdp, sessionId, `async () => {
    const token = localStorage.getItem("store_os_token");
    const response = await fetch(${JSON.stringify(`${apiBase}/market/me`)}, { headers: { Authorization: "Bearer " + token } });
    return { status: response.status, body: await response.text() };
  }`);
  assert.equal(walletView.status, 200, `聊天页读取 /market/me 失败：${JSON.stringify(walletView)}`);
  const walletBalance = JSON.parse(walletView.body).creditBalance;
  assert.ok(
    walletBalance >= 200,
    `聊天页余额必须 ≥200（证明页面拿到的租户与 seed 租户一致），实际 ${walletBalance}`
  );

  // IP 定位是 4 轮信息收集：逐轮填入 → 点「下一步」，第 4 轮点「确认需求」。
  for (let round = 0; round < SLOT_ANSWERS.length; round += 1) {
    const ready = await evaluate(cdp, sessionId, `() => Boolean(document.querySelector('.chat-page-composer textarea'))`);
    assert.ok(ready, `第 ${round + 1} 轮找不到输入框（未回到对话输入态）`);
    await evaluate(cdp, sessionId, `(text) => {
      const area = document.querySelector('.chat-page-composer textarea');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
      setter.call(area, text);
      area.dispatchEvent(new Event("input", { bubbles: true }));
    }`, SLOT_ANSWERS[round]);
    await waitFor(cdp, sessionId, `!document.querySelector('.chat-page-composer .btn.primary')?.disabled`, 10_000);
    const stepLabel = await evaluate(cdp, sessionId, `() => document.querySelector('.chat-page-composer .btn.primary')?.textContent?.trim()`);
    assert.ok(
      round < SLOT_ANSWERS.length - 1 ? stepLabel === "下一步" : stepLabel === "确认需求",
      `第 ${round + 1} 轮主按钮文案错误：${stepLabel}`
    );
    await evaluate(cdp, sessionId, `() => document.querySelector('.chat-page-composer .btn.primary').click()`);
    if (round < SLOT_ANSWERS.length - 1) {
      await waitFor(
        cdp,
        sessionId,
        `document.querySelectorAll('.chat-page-list .chat-row').length >= ${round * 2 + 3}`,
        10_000
      );
    }
  }

  // 4 轮收齐后先出现「请先确认需求」卡片，点确认才真正扣费生成。
  await waitFor(cdp, sessionId, `[...document.querySelectorAll('button')].some((node) => node.textContent?.includes('确认，开始生成'))`, 30_000);
  await evaluate(cdp, sessionId, `() => {
    [...document.querySelectorAll('button')].find((node) => node.textContent?.includes('确认，开始生成')).click();
  }`);

  try {
    await waitFor(cdp, sessionId, "document.querySelector('.ipr')", 180_000);
  } catch (error) {
    const dump = await evaluate(cdp, sessionId, `() => {
      const rows = [...document.querySelectorAll('.chat-page-list .chat-row')];
      const last = rows[rows.length - 1];
      return {
        rows: rows.length,
        lastRole: last?.className ?? null,
        lastText: last?.textContent?.slice(0, 600) ?? null,
        donebar: Boolean(document.querySelector('.chat-donebar')),
        busy: Boolean(document.querySelector('.chat-page-list .chat-bubble')?.textContent?.includes('正在按方法论')),
        cost: document.querySelector('.chat-page-cost')?.textContent ?? null
      };
    }`);
    console.error("IP 定位报告未渲染，页面快照：", JSON.stringify(dump, null, 1));
    console.error("控制台错误：", JSON.stringify(cdp.consoleErrors.slice(0, 8), null, 1));
    console.error("网络日志：", JSON.stringify(cdp.networkLog, null, 1));
    throw error;
  }
  const report = await evaluate(cdp, sessionId, `() => {
    const tabs = [...document.querySelectorAll('.ipr-tab')];
    const heads = [...document.querySelectorAll('.cr-head')].map((node) => node.textContent.trim());
    return {
      overviewRows: document.querySelectorAll('.ipr-overview-table tbody tr').length,
      overviewLabels: [...document.querySelectorAll('.ipr-overview-table tbody th')].map((node) => node.textContent.trim()),
      homeItems: document.querySelectorAll('.ipr-home-item').length,
      bioLines: document.querySelectorAll('.ipr-bio-lines li, .ipr-bio-lines .ipr-bio-line').length,
      tabs: tabs.map((tab) => tab.textContent.trim()),
      heads,
      reportCards: document.querySelectorAll('.ipr .chat-report').length,
      topicTotalText: document.querySelector('.ipr-topic-meta')?.textContent?.trim(),
      invalid: document.querySelectorAll('.ipr-invalid').length,
      txtButtons: [...document.querySelectorAll('.ipr-txt')].map((node) => node.textContent.trim()),
      wordButton: [...document.querySelectorAll('button')].find((node) => node.textContent?.includes('下载精美 Word'))?.textContent?.trim(),
      redoButton: [...document.querySelectorAll('button')].find((node) => node.textContent?.includes('免费重做'))?.textContent?.trim(),
      redoDisabled: [...document.querySelectorAll('button')].find((node) => node.textContent?.includes('免费重做'))?.disabled ?? null,
      costText: document.querySelector('.chat-page-cost')?.textContent?.trim() ?? null,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
    };
  }`);
  assert.equal(report.overviewRows, 8, `速览表必须 8 行，实际 ${report.overviewRows}`);
  assert.deepEqual(
    report.overviewLabels,
    ["项目定位", "核心用户", "IP人设", "IP原型", "当前IP状态", "内容重心", "首选平台", "第一个月核心动作"],
    `速览表标签错误：${JSON.stringify(report.overviewLabels)}`
  );
  assert.equal(report.tabs.length, 4, `四类选题 Tab 必须 4 个，实际 ${report.tabs.length}`);
  // 契约：CODEX-IP定位智能体-样例输出.md §5 —— 信任/认知/连接 ≥22、转化 ≥14（不是四类都 22）。
  const TAB_MIN = { 信任型: 22, 认知型: 22, 连接型: 22, 转化型: 14 };
  for (const [index, text] of report.tabs.entries()) {
    const matched = /^(信任型|认知型|连接型|转化型)\s*已生成\s*(\d+)\s*\/\s*需\s*≥\s*(\d+)/.exec(text);
    assert.ok(matched, `第 ${index + 1} 个选题 Tab 文案不符：${text}`);
    const [, label, generated, min] = matched;
    assert.equal(Number(min), TAB_MIN[label], `${label} 门槛应为 ${TAB_MIN[label]}，实际 ${min}`);
    assert.ok(
      Number(generated) >= TAB_MIN[label],
      `${label} 已生成 ${generated}，未达门槛 ${TAB_MIN[label]}`
    );
  }
  assert.deepEqual(
    report.tabs.map((text) => text.slice(0, 3)),
    ["信任型", "认知型", "连接型", "转化型"],
    `选题 Tab 顺序应为 信任/认知/连接/转化，实际 ${JSON.stringify(report.tabs)}`
  );
  assert.ok(report.homeItems >= 3, `主页四件套卡片不足：${report.homeItems}`);
  assert.equal(report.bioLines, 4, `签名档必须 4 行，实际 ${report.bioLines}`);
  for (const label of ["一、项目定位", "二、目标用户定位", "三、IP人设定位", "四、内容定位", "五、选题方向"]) {
    assert.ok(
      report.heads.some((head) => head.includes(label)),
      `报告缺少章节「${label}」，实际 ${JSON.stringify(report.heads)}`
    );
  }
  assert.ok(report.reportCards >= 7, `结构化报告卡片过少：${report.reportCards}`);
  assert.match(report.topicTotalText ?? "", /四类合计\s*\d+\s*条/, `缺少四类选题合计，实际 ${report.topicTotalText}`);
  assert.equal(report.invalid, 0, "通过校验的输出不应出现校验失败红卡");
  assert.ok(report.txtButtons.some((text) => text.includes("TXT")), "缺少口播正例 TXT 下载入口");
  assert.match(report.wordButton ?? "", /10 积分/, `Word 导出按钮必须显示 10 积分，实际 ${report.wordButton}`);
  // 按结果付费兜底：交付完成后必须给出「免费重做一次」入口，且未被禁用（凭证已在手）。
  assert.match(report.redoButton ?? "", /免费重做/, `缺少「免费重做」入口，实际 ${report.redoButton}`);
  assert.equal(report.redoDisabled, false, "「免费重做」入口必须可点（已持有本次交付凭证）");
  // 本次消耗必须同时显示积分与人民币折算：200 积分 → ≈ ¥10。
  assert.match(report.costText ?? "", /200 积分/, `本次消耗必须显示 200 积分，实际 ${report.costText}`);
  assert.match(report.costText ?? "", /≈ ¥10/, `本次消耗必须显示「≈ ¥10」折算，实际 ${report.costText}`);
  assert.equal(report.overflow, 0, "1280px 聊天结果页出现横向溢出");
  return { sessionId, report };
}

async function checkMobile(cdp, sessionId) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true
  }, sessionId);
  await delay(400);
  const mobile = await evaluate(cdp, sessionId, `() => ({
    width: innerWidth,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    reportVisible: Boolean(document.querySelector('.ipr'))
  })`);
  assert.equal(mobile.width, 390, "移动端视口宽度未生效");
  assert.equal(mobile.overflow, 0, "390px 聊天结果页出现横向溢出");
  assert.equal(mobile.reportVisible, true, "移动端聊天结果页丢失结构化报告");
  return mobile;
}

async function main() {
  const { token, userId } = await createTenant();
  const { prisma, wallet } = await seedWallet(userId);
  assert.equal(wallet?.paidBalance, START_BALANCE, `seedWallet 写入失败：${JSON.stringify(wallet)}`);
  const balance = await ensureWalletBalance(token, userId, prisma);
  const cdp = await connectChrome();
  const summary = { balance, shelf: null, detail: null, chat: null, mobile: null };
  try {
    if (!skipShelf) {
      const shelf = await checkShelf(cdp, token);
      summary.shelf = { total: shelf.shelf.total, soon: shelf.shelf.soon, selling: shelf.shelf.selling };
    }

    if (!skipShelf) {
      const ipDetail = await checkDetail(cdp, token, IP_POS_SKU, { comingSoon: false, ppu: 200 });
      summary.detail = { ipPos: ipDetail.detail.button };

      const copyDetail = await checkDetail(cdp, token, COPY_SKU, { comingSoon: false, ppu: 40 });
      summary.detail.copy = copyDetail.detail.button;

      const soonDetail = await checkDetail(cdp, token, SOON_SKU, { comingSoon: true });
      assert.equal(soonDetail.detail.disabled, true);
      summary.detail.comingSoon = soonDetail.detail.button;

      const lanqiDetail = await checkDetail(cdp, token, LANQI_SKU, { comingSoon: true });
      assert.equal(lanqiDetail.detail.disabled, true);
      summary.detail.lanqi = lanqiDetail.detail.button;
    }

    if (runChat) {
      const chat = await checkIpPosChat(cdp, token);
      summary.chat = chat.report;
      summary.mobile = await checkMobile(cdp, chat.sessionId);
    }

    const blocking = cdp.consoleErrors.filter(
      (text) => !/favicon|Download the React DevTools|Failed to load resource: the server responded with a status of 404/.test(text)
    );
    assert.equal(blocking.length, 0, `页面控制台出现错误：${JSON.stringify(blocking.slice(0, 3))}`);
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

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webBase = process.env.BEAUTY_E2E_WEB_URL ?? "http://127.0.0.1:5176";
const apiBase = process.env.BEAUTY_E2E_API_URL ?? "http://127.0.0.1:3016";
const chromePath = process.env.BEAUTY_E2E_CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const fixture = process.env.BEAUTY_VIDEO_DATA_FIXTURE
  ? path.resolve(process.env.BEAUTY_VIDEO_DATA_FIXTURE)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "fixtures/beauty-video-data-user-path-p1.csv");
const requireFromDb = createRequire(new URL("../packages/db/package.json", import.meta.url));
const { PrismaClient } = requireFromDb("@prisma/client");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const customerPollution = /mock|Schema|Eval|任务事实回执|待补|待核验|供应商|受控流程|\|\s*选题/iu;

async function createTenant(label) {
  const response = await fetch(`${apiBase}/auth/dev-login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ tenantRole: "local_business", tenantName: label, productCode: "beauty-industry" })
  });
  const body = await response.json();
  assert.equal(response.status, 200, "dev-login must create a scoped synthetic tenant");
  assert.ok(body.token);
  return { token: body.token, tenantId: body.tenantId, userId: body.userId };
}

async function connectChrome(userDataDir) {
  const child = spawn(chromePath, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0", `--user-data-dir=${userDataDir}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
  const endpoint = await new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error("Chrome DevTools endpoint timeout")), 15_000);
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { output += chunk; const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
    child.once("exit", (code) => reject(new Error(`Chrome exited before DevTools was ready (${code})`)));
  });
  const socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  let nextId = 0;
  const pending = new Map();
  const consoleErrors = [];
  const consoleDetails = [];
  const requestFailures = [];
  const externalRequests = [];
  const runRequests = [];
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id) { const handler = pending.get(message.id); if (!handler) return; pending.delete(message.id); if (message.error) handler.reject(new Error(`${handler.method}: ${message.error.message}`)); else handler.resolve(message.result); return; }
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") { const text = message.params.args.map((arg) => arg.value ?? arg.description ?? "").join(" "); consoleErrors.push(text); consoleDetails.push({ source: "runtime", text, url: message.params.stackTrace?.callFrames?.[0]?.url ?? "" }); }
    if (message.method === "Log.entryAdded" && message.params.entry.level === "error") { consoleErrors.push(message.params.entry.text); consoleDetails.push({ source: message.params.entry.source, text: message.params.entry.text, url: message.params.entry.url ?? "" }); }
    if (message.method === "Network.loadingFailed" && !message.params.canceled) requestFailures.push(message.params.errorText);
    if (message.method === "Network.requestWillBeSent") {
      const { url, method } = message.params.request;
      if (method === "POST" && url === `${apiBase}/beauty-industry/acquisition/runs`) runRequests.push(url);
      if (!url.startsWith(webBase) && !url.startsWith(apiBase) && !url.startsWith("data:") && !url.startsWith("blob:") && !url.startsWith("devtools:") && !url.startsWith("https://fonts.googleapis.com/") && !url.startsWith("https://fonts.gstatic.com/")) externalRequests.push(url);
    }
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => { const id = ++nextId; pending.set(id, { resolve, reject, method }); socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); });
  return { child, socket, send, consoleErrors, consoleDetails, requestFailures, externalRequests, runRequests };
}

async function evaluate(cdp, sessionId, functionDeclaration, argument) {
  const expression = argument === undefined ? `(${functionDeclaration})()` : `(${functionDeclaration})(${JSON.stringify(argument)})`;
  const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? "Runtime.evaluate failed");
  return result.result.value;
}

async function waitFor(cdp, sessionId, expression, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { if (await evaluate(cdp, sessionId, `() => Boolean(${expression})`).catch(() => false)) return; await delay(100); }
  throw new Error(`browser condition timed out: ${expression}`);
}

async function openPage(cdp, token, route, heading, viewport) {
  const { browserContextId } = await cdp.send("Target.createBrowserContext");
  const { targetId } = await cdp.send("Target.createTarget", { url: `${webBase}/login/beauty-industry?apiBase=${encodeURIComponent(apiBase)}`, browserContextId });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  for (const domain of ["Page.enable", "Runtime.enable", "Log.enable", "Network.enable", "DOM.enable"]) await cdp.send(domain, {}, sessionId);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: viewport.width, height: viewport.height, deviceScaleFactor: viewport.width === 390 ? 3 : 1, mobile: viewport.width === 390 }, sessionId);
  await waitFor(cdp, sessionId, "document.readyState === 'complete'");
  await evaluate(cdp, sessionId, `(value) => localStorage.setItem("store_os_token", value)`, token);
  await cdp.send("Page.navigate", { url: `${webBase}${route}?apiBase=${encodeURIComponent(apiBase)}` }, sessionId);
  await waitFor(cdp, sessionId, `[...document.querySelectorAll("h1,h2")].some((item) => item.textContent.trim() === ${JSON.stringify(heading)})`);
  return { browserContextId, sessionId };
}

const setField = `({ label, value, select = false }) => {
  const target = [...document.querySelectorAll("label")].find((item) => item.textContent.includes(label));
  if (!target) throw new Error("missing label: " + label);
  const input = target.querySelector(select ? "select" : "input,textarea");
  if (!input) throw new Error("missing input: " + label);
  const proto = select ? HTMLSelectElement.prototype : input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true }));
}`;

async function generateTopics(cdp, token) {
  const page = await openPage(cdp, token, "/agents/beauty-industry/acquisition/video/topics", "美业视频选题系统", { width: 1440, height: 1000 });
  const s = page.sessionId;
  await evaluate(cdp, s, setField, { label: "门店/品牌名称", value: "本店" });
  await evaluate(cdp, s, setField, { label: "本轮目标顾客", value: "关于日常皮肤管理的女性用户" });
  await evaluate(cdp, s, setField, { label: "本轮获客目标", value: "团购下单", select: true });
  await evaluate(cdp, s, setField, { label: "所在行业", value: "皮肤管理" });
  await evaluate(cdp, s, setField, { label: "对标账号", value: "合成公开账号线索" });
  await waitFor(cdp, s, `[...document.querySelectorAll(".topicGenerateBar button")].some((item) => !item.disabled)`);
  const before = cdp.runRequests.length;
  await evaluate(cdp, s, `() => { const button = document.querySelector(".topicGenerateBar button"); button.click(); button.click(); }`);
  await waitFor(cdp, s, `document.querySelectorAll(".beautyTopicCards > article").length === 10`);
  const result = await evaluate(cdp, s, `() => ({ text: document.querySelector(".beautyTopicCards").innerText, auditOpen: document.querySelector(".beautyTopicAudit")?.open, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth })`);
  assert.match(result.text, /关于日常皮肤管理的女性用户/);
  assert.doesNotMatch(result.text, customerPollution);
  assert.equal(result.auditOpen, false); assert.equal(result.overflow, 0); assert.equal(cdp.runRequests.length - before, 1);
  await cdp.send("Page.reload", { ignoreCache: true }, s); await waitFor(cdp, s, `document.querySelectorAll(".beautyTopicCards > article").length === 10`);
  await cdp.send("Target.disposeBrowserContext", { browserContextId: page.browserContextId });
}

async function generateContent(cdp, token) {
  const page = await openPage(cdp, token, "/agents/beauty-industry/acquisition/video/content", "内容系统", { width: 1440, height: 1000 });
  const s = page.sessionId;
  for (const [label, value] of [["选题 / 内容任务", "皮肤管理产品内容流程"], ["本轮获客目标", "让附近女性顾客了解服务边界并咨询"], ["目标顾客", "附近关注日常皮肤管理的成年女性"], ["发布平台", "抖音"], ["内容形式", "店长口播短视频"], ["建议时长", "60秒内"], ["出镜/表达主体", "店长"], ["本次可使用的项目与服务事实", "本店提供皮肤管理服务；未提供价格、疗效或案例"], ["拍摄与素材约束", "不出现顾客正脸；仅使用授权门店区域"]]) await evaluate(cdp, s, setField, { label, value });
  await waitFor(cdp, s, `[...document.querySelectorAll("button")].some((item) => item.textContent.includes("生成内容系统") && !item.disabled)`);
  const before = cdp.runRequests.length;
  await evaluate(cdp, s, `() => { const button = [...document.querySelectorAll("button")].find((item) => item.textContent.includes("生成内容系统")); button.click(); button.click(); }`);
  await delay(1_000);
  const contentState = await evaluate(cdp, s, `() => ({ cards: document.querySelectorAll(".contentDeliveryCard").length, error: document.querySelector(".beautyIndustryError")?.innerText ?? "", result: document.querySelector(".beautyContentTenResult")?.innerText?.slice(0, 1200) ?? "", body: document.body.innerText.slice(-1200) })`);
  if (contentState.cards !== 10 && !contentState.error) throw new Error(`content system did not render cards: ${JSON.stringify(contentState)}`);
  const contentError = await evaluate(cdp, s, `() => document.querySelector(".beautyIndustryError")?.innerText ?? ""`);
  assert.equal(contentError, "", `content system returned an error: ${contentError}`);
  const result = await evaluate(cdp, s, `() => ({ text: document.querySelector(".contentDeliveryCards").innerText, auditOpen: document.querySelector(".beautyContentAudit")?.open, preview: document.querySelector(".beautyContentTenResult")?.innerText, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth })`);
  assert.doesNotMatch(result.text, customerPollution); assert.equal(result.auditOpen, false); assert.match(result.preview, /非正式生成/); assert.equal(result.overflow, 0); assert.equal(cdp.runRequests.length - before, 1);
  await cdp.send("Page.reload", { ignoreCache: true }, s); await waitFor(cdp, s, `document.querySelectorAll(".contentDeliveryCard").length === 10`);
  await cdp.send("Target.disposeBrowserContext", { browserContextId: page.browserContextId });
}

async function generateVideoDataReview(cdp, token) {
  const page = await openPage(cdp, token, "/agents/beauty-industry/acquisition/video/data-review", "视频数据复盘", { width: 1440, height: 1000 });
  const s = page.sessionId;
  await evaluate(cdp, s, setField, { label: "选择数据平台", value: "抖音", select: true });
  await evaluate(cdp, s, setField, { label: "复盘周期", value: "合成数据验收周期" });
  const { root } = await cdp.send("DOM.getDocument", {}, s);
  const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector: '.beautyVideoReviewUpload input[type="file"]' }, s);
  assert.ok(nodeId); await cdp.send("DOM.setFileInputFiles", { nodeId, files: [fixture] }, s);
  await waitFor(cdp, s, `document.querySelector(".beautyVideoReviewFileState.parsed")`);
  const before = cdp.runRequests.length;
  await waitFor(cdp, s, `[...document.querySelectorAll("button")].some((item) => item.textContent.includes("开始专业复盘") && !item.disabled)`);
  await evaluate(cdp, s, `() => { const button = [...document.querySelectorAll("button")].find((item) => item.textContent.includes("开始专业复盘")); button.click(); button.click(); }`);
  await waitFor(cdp, s, `document.querySelector(".beautyVideoReviewReport")?.textContent?.includes("综合诊断结论")`);
  const result = await evaluate(cdp, s, `() => ({ text: document.querySelector(".beautyVideoReviewReport").innerText, sections: document.querySelectorAll(".beautyVideoReviewOutline .present").length, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth })`);
  for (const heading of ["数据质量审计", "数据总览", "视频分层", "内容结构健康度", "单条深拆", "完播率深层归因", "互动深度分析", "趋势分析", "规律总结", "方法论沉淀", "下周期选题建议", "综合诊断结论"]) assert.match(result.text, new RegExp(heading));
  assert.equal(result.sections, 12); assert.equal(result.overflow, 0); assert.equal(cdp.runRequests.length - before, 1);
  await cdp.send("Page.reload", { ignoreCache: true }, s); await waitFor(cdp, s, `document.querySelector(".beautyVideoReviewReport")?.textContent?.includes("综合诊断结论")`);
  await cdp.send("Target.disposeBrowserContext", { browserContextId: page.browserContextId });
}

async function verifyVideoDataMobile(cdp, token) {
  const page = await openPage(cdp, token, "/agents/beauty-industry/acquisition/video/data-review", "视频数据复盘", { width: 390, height: 844 });
  await waitFor(cdp, page.sessionId, `document.querySelector(".beautyVideoReviewReport")?.textContent?.includes("综合诊断结论")`);
  const state = await evaluate(cdp, page.sessionId, `() => ({ width: innerWidth, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, sections: document.querySelectorAll(".beautyVideoReviewOutline .present").length })`);
  assert.equal(state.width, 390); assert.equal(state.overflow, 0); assert.equal(state.sections, 12);
  await cdp.send("Target.disposeBrowserContext", { browserContextId: page.browserContextId });
}

async function generateSales(cdp, token) {
  const page = await openPage(cdp, token, "/agents/beauty-industry/sales", "美业销售", { width: 1440, height: 1000 });
  const s = page.sessionId;
  await evaluate(cdp, s, setField, { label: "这次要完成什么", value: "客户犹豫不下单 怎么办" });
  await waitFor(cdp, s, `[...document.querySelectorAll(".beautyIndustryComposerActions button")].some((item) => !item.disabled)`);
  const before = cdp.runRequests.length;
  await evaluate(cdp, s, `() => { const button = document.querySelector(".beautyIndustryComposerActions button"); button.click(); button.click(); }`);
  await waitFor(cdp, s, `document.querySelector(".beautySalesPrimaryReply")?.textContent?.includes("建议先这样回复")`);
  const result = await evaluate(cdp, s, `() => ({ text: document.querySelector(".beautyIndustryResult").innerText, error: document.querySelector(".beautyIndustryError")?.innerText ?? "", overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth })`);
  assert.equal(result.error, "");
  for (const term of ["通用初步回复", "建议先这样回复", "为什么这样回", "顾客可能的下一句", "你接下来问什么"]) assert.match(result.text, new RegExp(term));
  assert.doesNotMatch(result.text, /皮肤管理产品|Schema|Eval|任务事实回执|合同回执/);
  assert.equal(result.overflow, 0);
  assert.equal(cdp.runRequests.length - before, 1);
  await cdp.send("Page.reload", { ignoreCache: true }, s);
  await waitFor(cdp, s, `document.querySelector(".beautySalesPrimaryReply")?.textContent?.includes("建议先这样回复")`);
  await cdp.send("Target.disposeBrowserContext", { browserContextId: page.browserContextId });
}

async function generateProfessionalSales(cdp, token) {
  const page = await openPage(cdp, token, "/agents/beauty-industry/sales", "美业销售", { width: 1440, height: 1000 });
  const s = page.sessionId;
  await evaluate(cdp, s, `() => [...document.querySelectorAll(".beautyIndustryModeSwitch button")].find((item) => item.textContent.includes("专业模式")).click()`);
  await evaluate(cdp, s, setField, { label: "这次要完成什么", value: "顾客说想再考虑，请给完整异议策略" });
  const before = cdp.runRequests.length;
  const initiallyDisabled = await evaluate(cdp, s, `() => document.querySelector(".beautyIndustryComposerActions button").disabled`);
  assert.equal(initiallyDisabled, true, "professional sales must block before required facts and before reservation");
  for (const [label, value] of [
    ["本次项目", "皮肤管理项目"],
    ["已确认价格或优惠边界", "只可发送已确认价目表，不承诺额外优惠"],
    ["顾客原话或主要顾虑", "顾客说想再考虑是否适合"],
    ["沟通阶段", "首次咨询后"],
    ["允许的下一步动作", "询问是否需要已确认项目说明"],
    ["沟通语气", "自然、简短、不施压"]
  ]) await evaluate(cdp, s, setField, { label, value });
  await waitFor(cdp, s, `[...document.querySelectorAll(".beautyIndustryComposerActions button")].some((item) => !item.disabled)`);
  await evaluate(cdp, s, `() => { const button = document.querySelector(".beautyIndustryComposerActions button"); button.click(); button.click(); }`);
  await waitFor(cdp, s, `document.querySelector(".beautySalesPrimaryReply")?.textContent?.includes("专业模式回复")`);
  const result = await evaluate(cdp, s, `() => ({ text: document.querySelector(".beautyIndustryResult").innerText, error: document.querySelector(".beautyIndustryError")?.innerText ?? "", overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, strategyOpen: document.querySelector(".beautySalesStrategyDetails")?.open, auditOpen: document.querySelector(".beautySalesAuditReceipt")?.open })`);
  assert.equal(result.error, ""); assert.equal(result.overflow, 0); assert.equal(result.strategyOpen, false); assert.equal(result.auditOpen, false);
  for (const term of ["专业模式回复", "皮肤管理项目", "首次咨询后", "建议先这样回复"]) assert.match(result.text, new RegExp(term));
  assert.equal(cdp.runRequests.length - before, 1);
  await cdp.send("Page.reload", { ignoreCache: true }, s);
  await waitFor(cdp, s, `document.querySelector(".beautySalesPrimaryReply")?.textContent?.includes("专业模式回复")`);
  await cdp.send("Target.disposeBrowserContext", { browserContextId: page.browserContextId });
}

async function verifySalesMobile(cdp, token) {
  const page = await openPage(cdp, token, "/agents/beauty-industry/sales", "美业销售", { width: 390, height: 844 });
  await waitFor(cdp, page.sessionId, `document.querySelector(".beautySalesPrimaryReply")?.textContent?.includes("专业模式回复")`);
  const state = await evaluate(cdp, page.sessionId, `() => ({ width: innerWidth, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, cards: document.querySelectorAll(".beautySalesGuidanceGrid article").length, strategyOpen: document.querySelector(".beautySalesStrategyDetails")?.open, auditOpen: document.querySelector(".beautySalesAuditReceipt")?.open })`);
  assert.equal(state.width, 390); assert.equal(state.overflow, 0); assert.equal(state.cards, 3); assert.equal(state.strategyOpen, false); assert.equal(state.auditOpen, false);
  await cdp.send("Target.disposeBrowserContext", { browserContextId: page.browserContextId });
}

async function verifySalesServerPreflight(token, tenantId, prisma) {
  const before = await prisma.creditReservation.count({ where: { tenantId } });
  const response = await fetch(`${apiBase}/beauty-industry/acquisition/runs`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      toolName: "beauty.sales_advice",
      question: "顾客说想再考虑，请给完整异议策略",
      mode: "professional",
      professionalOptions: { project: "皮肤管理项目" },
      requestId: `sales-preflight-${Date.now()}`,
      deviceScope: "desktop"
    })
  });
  const body = await response.json();
  assert.equal(response.status, 422); assert.equal(body.error, "beauty_sales_professional_information_required"); assert.equal(body.category, "preflight");
  const after = await prisma.creditReservation.count({ where: { tenantId } });
  assert.equal(after, before, "professional preflight must happen before credit reservation");
}

async function generateLiveScript(cdp, token) {
  const page = await openPage(cdp, token, "/agents/beauty-industry/acquisition/live/script", "直播话术", { width: 1440, height: 1000 });
  const s = page.sessionId;
  await evaluate(cdp, s, setField, { label: "这次要完成什么", value: "为生活美容门店做本地生活团购直播话术。产品：日常护理服务；直播目标：引导观众咨询到店预约；价格、福利、产品资料、购买路径均暂无，不得编造。" });
  await waitFor(cdp, s, `[...document.querySelectorAll(".beautyIndustryComposerActions button")].some((item) => !item.disabled)`);
  const before = cdp.runRequests.length;
  await evaluate(cdp, s, `() => { const button = document.querySelector(".beautyIndustryComposerActions button"); button.click(); button.click(); }`);
  await waitFor(cdp, s, `document.querySelector(".beautyIndustryResult")?.textContent?.includes("主播口播稿")`);
  const result = await evaluate(cdp, s, `() => ({ text: document.querySelector(".beautyIndustryResult").innerText, error: document.querySelector(".beautyIndustryError")?.innerText ?? "", overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth })`);
  assert.equal(result.error, "");
  for (const term of ["主播口播稿", "开场", "留人", "互动", "产品承接", "转化", "下播后跟进", "合规提醒", "复盘指标"]) assert.match(result.text, new RegExp(term));
  assert.equal(result.overflow, 0);
  assert.equal(cdp.runRequests.length - before, 1);
  await cdp.send("Page.reload", { ignoreCache: true }, s);
  await waitFor(cdp, s, `document.querySelector(".beautyIndustryResult")?.textContent?.includes("主播口播稿")`);
  await cdp.send("Target.disposeBrowserContext", { browserContextId: page.browserContextId });
}

async function verifyMobileAndIa(cdp, token) {
  for (const [route, heading] of [["/agents/beauty-industry/acquisition/video", "视频获客"], ["/agents/beauty-industry/acquisition/video/review", "复盘系统"], ["/agents/beauty-industry/acquisition/video/viral-replication", "爆款复刻"], ["/agents/beauty-industry/acquisition/video/topics", "美业视频选题系统"], ["/agents/beauty-industry/acquisition/video/content", "内容系统"], ["/agents/beauty-industry/acquisition/video/data-review", "视频数据复盘"], ["/agents/beauty-industry/acquisition/live/script", "直播话术"], ["/agents/beauty-industry/sales", "美业销售"]]) {
    const page = await openPage(cdp, token, route, heading, { width: 390, height: 844 });
    const state = await evaluate(cdp, page.sessionId, `() => ({ width: innerWidth, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, body: document.body.innerText })`);
    assert.equal(state.width, 390); assert.equal(state.overflow, 0);
    if (route.endsWith("/topics")) { assert.match(state.body, /用户可用TOP10预览/); assert.equal(await evaluate(cdp, page.sessionId, `() => document.querySelectorAll(".beautyTopicCards > article").length`), 10); }
    if (route.endsWith("/content")) assert.equal(await evaluate(cdp, page.sessionId, `() => document.querySelectorAll(".contentDeliveryCard").length`), 10);
    if (route.endsWith("/data-review")) assert.match(state.body, /正式视频数据复盘报告/);
    if (route.endsWith("/sales")) assert.match(state.body, /建议先这样回复/);
    if (route.endsWith("/live/script")) assert.match(state.body, /主播口播稿/);
    if (route.endsWith("viral-replication")) assert.match(state.body, /规划中/);
    await cdp.send("Target.disposeBrowserContext", { browserContextId: page.browserContextId });
  }
  const alias = await openPage(cdp, token, "/agents/beauty-industry/acquisition/video/content-ten", "内容系统", { width: 1440, height: 1000 });
  const aliasState = await evaluate(cdp, alias.sessionId, `() => ({ apiBase: new URLSearchParams(location.search).get("apiBase"), cards: document.querySelectorAll(".contentDeliveryCard").length })`);
  assert.equal(aliasState.apiBase, apiBase); assert.equal(aliasState.cards, 10);
  await cdp.send("Target.disposeBrowserContext", { browserContextId: alias.browserContextId });
}

async function main() {
  if (process.env.BEAUTY_VIDEO_DATA_FIXTURE_SHA256) {
    const actualFixtureSha = createHash("sha256").update(await readFile(fixture)).digest("hex");
    assert.equal(actualFixtureSha, process.env.BEAUTY_VIDEO_DATA_FIXTURE_SHA256, "external video-data fixture SHA-256 must match the authorized file");
  }
  const primary = await createTenant(`美业统一矩阵合成租户-${Date.now()}`);
  const secondary = await createTenant(`美业统一矩阵隔离租户-${Date.now()}`);
  const token = primary.token;
  const userDataDir = await mkdtemp(path.join(tmpdir(), "beauty-matrix-chrome-"));
  const cdp = await connectChrome(userDataDir);
  const prisma = new PrismaClient();
  try {
    const matrixOnly = process.env.BEAUTY_MATRIX_ONLY;
    if (!matrixOnly) await generateTopics(cdp, token);
    if (!matrixOnly || matrixOnly === "content") await generateContent(cdp, token);
    if (!matrixOnly) {
      await generateVideoDataReview(cdp, token);
      await verifySalesServerPreflight(token, primary.tenantId, prisma);
      await generateSales(cdp, token);
      await generateProfessionalSales(cdp, token);
      await verifySalesMobile(cdp, token);
      await generateLiveScript(cdp, token);
      await verifyMobileAndIa(cdp, token);
    } else if (matrixOnly === "video-data") {
      await generateVideoDataReview(cdp, token);
      await verifyVideoDataMobile(cdp, token);
    } else if (matrixOnly === "sales") {
      await verifySalesServerPreflight(token, primary.tenantId, prisma);
      await generateSales(cdp, token);
      await generateProfessionalSales(cdp, token);
      await verifySalesMobile(cdp, token);
    }
    const expectedCapabilities = matrixOnly === "content"
      ? ["content_plan"]
      : matrixOnly === "video-data"
        ? ["video_data_review"]
        : matrixOnly === "sales"
          ? ["beauty_sales", "beauty_sales"]
          : ["topic_inspiration", "content_plan", "video_data_review", "beauty_sales", "beauty_sales", "live_script"];
    const primaryRuns = await prisma.agentRun.findMany({
      where: { tenantId: primary.tenantId, capabilityId: { in: expectedCapabilities } },
      select: { capabilityId: true, status: true, requestId: true, creditCost: true }
    });
    assert.deepEqual(primaryRuns.map((run) => run.capabilityId).sort(), [...expectedCapabilities].sort(), "each browser user path must persist exactly one AgentRun");
    assert.ok(primaryRuns.every((run) => run.status === "succeeded" && run.requestId && run.creditCost > 0));
    const reservations = await prisma.creditReservation.findMany({
      where: { tenantId: primary.tenantId },
      select: { status: true, actualAmount: true, agentRunId: true, requestId: true }
    });
    assert.equal(reservations.length, expectedCapabilities.length, "double click must not create duplicate reservations");
    assert.ok(reservations.every((item) => item.status === "settled" && item.actualAmount && item.actualAmount > 0 && item.agentRunId));
    const secondaryHistoryResponse = await fetch(`${apiBase}/beauty-industry/acquisition/history`, { headers: { authorization: `Bearer ${secondary.token}` } });
    assert.equal(secondaryHistoryResponse.status, 200);
    const secondaryHistory = await secondaryHistoryResponse.json();
    assert.equal(Array.isArray(secondaryHistory.runs) ? secondaryHistory.runs.length : -1, 0, "second tenant must not see first tenant runs");
    const actionableConsoleErrors = cdp.consoleErrors.filter((item) => !/WebSocket connection to 'ws:\/\/127\.0\.0\.1:5176\/' failed: Page entered Back-Forward Cache\./.test(item));
    assert.deepEqual(actionableConsoleErrors, [], `console details: ${JSON.stringify(cdp.consoleDetails)}`); assert.deepEqual(cdp.requestFailures, []); assert.deepEqual(cdp.externalRequests, []); assert.equal(cdp.runRequests.length, matrixOnly === "sales" ? 2 : matrixOnly ? 1 : 6);
    process.stdout.write(matrixOnly === "content"
      ? "beauty_controlled_results_browser_e2e:PASS content_system=PASS history_refresh=PASS double_click=PASS desktop=PASS console_errors=0 external_provider_requests=0 controlled_runs=1\n"
      : matrixOnly === "video-data"
        ? "beauty_controlled_results_browser_e2e:PASS video_data_review=PASS exact_fixture=PASS history_refresh=PASS db_ledger=PASS tenant_isolation=PASS double_click=PASS desktop=PASS mobile390=PASS console_errors=0 external_provider_requests=0 controlled_runs=1\n"
      : matrixOnly === "sales"
        ? "beauty_controlled_results_browser_e2e:PASS beauty_sales_quick=PASS beauty_sales_professional=PASS professional_preflight=PASS history_refresh=PASS db_ledger=PASS tenant_isolation=PASS double_click=PASS desktop=PASS mobile390=PASS console_errors=0 external_provider_requests=0 controlled_runs=2\n"
      : "beauty_controlled_results_browser_e2e:PASS topics=PASS content_system=PASS video_data_review=PASS beauty_sales_quick=PASS beauty_sales_professional=PASS live_script=PASS history_refresh=PASS db_ledger=PASS tenant_isolation=PASS double_click=PASS video_ia=PASS old_alias=PASS desktop=PASS mobile390=PASS console_errors=0 external_provider_requests=0 controlled_runs=6\n");
  } finally {
    await prisma.$disconnect();
    cdp.socket.close(); const exited = new Promise((resolve) => cdp.child.once("exit", resolve)); cdp.child.kill(); await Promise.race([exited, delay(2_000)]); await rm(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
  }
}

main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`); process.exitCode = 1; });

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const webBase = process.env.SITONG_WEB_BASE_URL ?? "http://127.0.0.1:5185";
const apiBase = process.env.SITONG_API_BASE_URL ?? "http://127.0.0.1:3014";
const browserExecutable = process.env.SITONG_BROWSER_EXECUTABLE ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const evidenceDirectory = process.env.FIP_E2E_EVIDENCE_DIR ?? path.join(os.tmpdir(), "sitong-fip-content-e2e");

for (const [name, value] of [["SITONG_WEB_BASE_URL", webBase], ["SITONG_API_BASE_URL", apiBase]]) {
  const url = new URL(value);
  assert.equal(url.protocol, "http:", `${name} must use local HTTP`);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname), `${name} must stay on loopback`);
}

const ready = await fetch(`${apiBase}/ready`).then(response => response.json());
assert.equal(ready.ok, true, "isolated API must be ready");
assert.equal(ready.dataMode, "database", "browser E2E must use the isolated database path");

await mkdir(evidenceDirectory, { recursive: true });
const browser = await chromium.launch({ executablePath: browserExecutable, headless: true, args: ["--no-first-run", "--disable-default-apps"] });
const consoleErrors = [];
const pageErrors = [];
const requestFailures = [];
const network = [];
const briefResponses = [];
let modelRequests = 0;

function attachEvidence(page, label) {
  page.on("console", message => {
    if (message.type() === "error") consoleErrors.push(`${label}:${message.text()}`);
  });
  page.on("pageerror", error => pageErrors.push(`${label}:${error.message}`));
  page.on("requestfailed", request => requestFailures.push(`${label}:${request.method()} ${request.url()} ${request.failure()?.errorText ?? "failed"}`));
  page.on("request", request => {
    if (/\/founder-ip-content-drafts\/[^/]+\/generate(?:\?|$)/.test(request.url())) modelRequests += 1;
    if (request.method() === "POST" && /\/agents\/acquisition\/runs(?:\?|$)/.test(request.url())) modelRequests += 1;
  });
  page.on("response", async response => {
    const url = response.url();
    if (url.startsWith(apiBase)) {
      const parsed = new URL(url);
      network.push({ label, method: response.request().method(), status: response.status(), path: parsed.pathname, search: parsed.search });
      if (parsed.pathname.includes("founder-ip-goal-briefs")) {
        const payload = await response.json().catch(() => ({}));
        briefResponses.push({ label, method: response.request().method(), status: response.status(), search: parsed.search, hasBrief: Boolean(payload?.brief), subjectId: payload?.brief?.subjectId ?? null, target: payload?.brief?.target ?? null, identity: payload?.brief?.identity ?? null });
      }
    }
  });
}

async function scenarioUrl(scenario) {
  return `${webBase}/fip/e2e/local?scenario=${encodeURIComponent(scenario)}&apiBase=${encodeURIComponent(apiBase)}`;
}

async function waitForContentPage(page) {
  await page.waitForURL(url => url.pathname.endsWith("/agents/acquisition") && url.searchParams.get("system") === "content_plan", { timeout: 30_000 });
  await page.getByRole("heading", { name: "内容系统", exact: true }).waitFor({ state: "visible", timeout: 30_000 });
}

async function assertInputValue(locator, expected, label) {
  await locator.waitFor({ state: "visible", timeout: 15_000 });
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await locator.inputValue() === expected) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(await locator.inputValue(), expected, `${label}; brief_network=${JSON.stringify(network.filter(item => item.path.includes("founder-ip-goal-briefs")).slice(-6))}; brief_payloads=${JSON.stringify(briefResponses.slice(-6))}`);
}

async function openWorkMap(page) {
  const existing = page.getByRole("dialog", { name: /创始人IP获客系统工作地图/ });
  if (await existing.count()) return existing;
  await page.getByRole("button", { name: /工作地图/ }).first().click();
  await existing.waitFor({ state: "visible", timeout: 15_000 });
  return existing;
}

async function enterWorkMapModule(page, title, capabilityId) {
  const map = await openWorkMap(page);
  await map.locator("button.agentWorkMapNode").filter({ hasText: title }).click();
  await page.waitForURL(url => url.pathname.endsWith("/agents/acquisition") && url.searchParams.get("system") === capabilityId, { timeout: 15_000 });
}

try {
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const page = await desktop.newPage();
  attachEvidence(page, "desktop");
  await page.goto(await scenarioUrl("success"), { waitUntil: "domcontentloaded", timeout: 30_000 });
  await waitForContentPage(page);
  await page.getByRole("heading", { name: "可编辑内容草稿", exact: true }).waitFor({ state: "visible" });
  await page.getByText("10万预算做问题肌门店，先核对哪三类经营条件", { exact: true }).first().waitFor({ state: "visible" });
  await page.getByText("来源依据：本机合成验收数据；真实条件待确认", { exact: false }).first().waitFor({ state: "visible" });
  const editorStyle = await page.getByTestId("fip-content-editor").evaluate(element => {
    const style = window.getComputedStyle(element);
    return { color: style.color, backgroundColor: style.backgroundColor };
  });
  assert.equal(editorStyle.color, "rgb(23, 61, 51)", "saved content must use readable dark text");
  assert.equal(editorStyle.backgroundColor, "rgb(251, 253, 251)", "saved content must use an opaque light editor background");
  await page.getByText("点击生成或重新生成会调用 AI 模型；只查看、编辑和保存现有草稿不会调用。", { exact: true }).waitFor({ state: "visible" });
  assert.equal(await page.getByTestId("fip-content-traffic-preview").isVisible(), true, "accepted draft must expose traffic preview");
  await page.getByTestId("fip-content-save").click();
  await page.getByText("内容草稿已保存，可刷新后恢复。", { exact: true }).waitFor({ state: "visible" });
  assert.ok(network.some(item => item.method === "PATCH" && item.status === 200 && item.path.includes("founder-ip-content-drafts")), "save must issue a successful tenant-scoped PATCH");
  await page.screenshot({ path: path.join(evidenceDirectory, "fip-content-desktop.png"), fullPage: true });

  await page.reload({ waitUntil: "networkidle", timeout: 30_000 });
  await page.getByText("10万预算做问题肌门店，先核对哪三类经营条件", { exact: true }).first().waitFor({ state: "visible" });
  assert.equal(await page.getByTestId("fip-content-traffic-preview").isVisible(), true, "refresh must restore accepted content");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: "networkidle", timeout: 30_000 });
  await page.getByRole("heading", { name: "可编辑内容草稿", exact: true }).waitFor({ state: "visible" });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, "390px page must not overflow horizontally");
  await page.screenshot({ path: path.join(evidenceDirectory, "fip-content-390.png"), fullPage: true });

  await page.getByTestId("fip-content-back-to-topics").click();
  await page.getByRole("heading", { name: "创始人 IP 选题系统", exact: true }).waitFor({ state: "visible", timeout: 20_000 });
  await page.getByTestId("fip-synthetic-data-banner").getByText("本机合成验收数据", { exact: true }).waitFor({ state: "visible" });
  await page.getByText("10万预算做问题肌门店，先核对哪三类经营条件", { exact: true }).first().waitFor({ state: "visible" });
  assert.equal(await page.getByText(/企业AI改造|买AI工具/).count(), 0, "beauty franchise fixture must not contain generic AI-business topics");
  assert.equal(await page.getByRole("button", { name: "合成验收仅查看（不调用 AI）", exact: true }).isDisabled(), true, "synthetic acceptance must disable topic generation");
  assert.equal(await page.getByRole("button", { name: "发送选题修改要求", exact: true }).isDisabled(), true, "synthetic acceptance must disable AI refinement");
  await page.getByText("合成验收环境未连接真实录音", { exact: true }).waitFor({ state: "visible" });
  await page.getByText("点击生成会调用 AI 模型；只查看和编辑已保存结果不会调用。", { exact: true }).waitFor({ state: "visible" });
  const targetSelect = page.locator(".topicBriefFields select").first();
  const targets = [
    { value: "store_visit", label: "C端团购到店", identityLabel: "创始人身份 / 门店项目", identity: "美业问题肌门店创始人", customerLabel: "目标消费者", customer: "门店周边有问题肌护理需求的消费者", goal: "预约到店" },
    { value: "student", label: "学员招募", identityLabel: "创始人身份 / 课程项目", identity: "皮肤管理培训创始人", customerLabel: "目标学员", customer: "计划转行的初学者", goal: "获取课程咨询" },
    { value: "partner", label: "合作方招募", identityLabel: "创始人身份 / 合作项目", identity: "美业问题肌区域联营负责人", customerLabel: "目标合作方", customer: "有本地美业渠道的合作伙伴", goal: "获取合作咨询" },
    { value: "franchise", label: "招商加盟", identityLabel: "创始人身份 / 项目名称", identity: "美业问题肌品牌创始人", customerLabel: "目标加盟商", customer: "10万投资预算的美业从业者", goal: "获取加盟咨询" }
  ];
  for (const target of targets) {
    await targetSelect.selectOption(target.value);
    await assertInputValue(page.getByLabel(target.identityLabel), target.identity, `${target.value} identity brief must restore`);
    await assertInputValue(page.getByLabel(target.customerLabel), target.customer, `${target.value} audience brief must restore`);
    await assertInputValue(page.getByLabel("本轮线索目标"), target.goal, `${target.value} goal brief must restore`);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "← 返回工作地图", exact: true }).click();
  const workMap = page.getByRole("dialog", { name: /创始人IP获客系统工作地图/ });
  await workMap.getByRole("heading", { name: "创始人IP获客工作地图", exact: true }).waitFor({ state: "visible" });
  await workMap.getByLabel("创始人IP获客系统，业务总入口", { exact: true }).waitFor({ state: "visible" });
  for (const branchName of ["选题系统", "直播系统", "问问保禄"]) {
    assert.equal(await workMap.locator("button.agentWorkMapNode").filter({ hasText: branchName }).isVisible(), true, `${branchName} must be a visible direct branch`);
  }
  assert.equal(await workMap.locator(".agentWorkMapEdge.edge-branch").count(), 3, "work map must render three direct branches");
  assert.equal(await workMap.locator(".agentWorkMapEdge.edge-feedback").count(), 2, "work map must render both review feedback loops");
  assert.deepEqual(await workMap.locator(".agentWorkMapEdge.edge-branch text").allTextContents(), ["视频分支", "直播分支", "独立答疑"], "root branch labels must match the three product branches");
  assert.equal(await workMap.locator(".agentWorkMapEdge.edge-branch text").filter({ hasText: "选题分支" }).count(), 0, "the full video chain must not be called 选题分支");
  for (const moduleName of ["选题系统", "内容系统", "投流系统", "视频复盘系统"]) {
    assert.equal(await workMap.locator(".agentWorkMapNode").filter({ hasText: moduleName }).count(), 1, `${moduleName} must remain in the video chain`);
  }
  await page.screenshot({ path: path.join(evidenceDirectory, "fip-work-map-desktop.png"), fullPage: true });
  for (const entry of [
    { title: "选题系统", capability: "topic_inspiration" },
    { title: "内容系统", capability: "content_plan" },
    { title: "投流系统", capability: "paid_traffic" },
    { title: "视频复盘系统", capability: "video_review" },
    { title: "直播系统", capability: "live_script" },
    { title: "直播复盘系统", capability: "live_review" },
    { title: "问问保禄", capability: "baolu_ip_advisor" }
  ]) {
    await enterWorkMapModule(page, entry.title, entry.capability);
  }
  await desktop.close();

  const failureContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const failurePage = await failureContext.newPage();
  attachEvidence(failurePage, "failure");
  await failurePage.goto(await scenarioUrl("failure"), { waitUntil: "domcontentloaded", timeout: 30_000 });
  await waitForContentPage(failurePage);
  await failurePage.getByText("内容草稿尚未生成，可继续生成或返回选题系统重新选择。", { exact: true }).waitFor({ state: "visible" });
  await failurePage.getByTestId("fip-content-retry").click();
  await failurePage.getByText("内容生成未完成：受控失败：请稍后重试。", { exact: true }).waitFor({ state: "visible" });
  assert.equal(await failurePage.getByTestId("fip-content-traffic-preview").count(), 0, "failed draft must not expose traffic preview");
  await failurePage.screenshot({ path: path.join(evidenceDirectory, "fip-content-failure.png"), fullPage: true });
  await failureContext.close();

  const cancelContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const cancelPage = await cancelContext.newPage();
  attachEvidence(cancelPage, "cancel");
  await cancelPage.goto(await scenarioUrl("cancel"), { waitUntil: "domcontentloaded", timeout: 30_000 });
  await waitForContentPage(cancelPage);
  await cancelPage.getByTestId("fip-content-retry").click();
  await cancelPage.getByTestId("fip-content-stop").waitFor({ state: "visible" });
  assert.equal(await cancelPage.getByTestId("fip-content-retry").isDisabled(), true, "duplicate generation control must be disabled while pending");
  await cancelPage.getByTestId("fip-content-stop").click();
  await cancelPage.getByText("内容生成未完成：已停止本次内容生成。", { exact: true }).waitFor({ state: "visible" });
  assert.equal(await cancelPage.getByTestId("fip-content-traffic-preview").count(), 0, "cancelled draft must not expose traffic preview");
  await cancelContext.close();

  const isolationContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const isolationPage = await isolationContext.newPage();
  attachEvidence(isolationPage, "tenant_isolation");
  await isolationPage.goto(await scenarioUrl("foreign"), { waitUntil: "domcontentloaded", timeout: 30_000 });
  await waitForContentPage(isolationPage);
  await isolationPage.getByRole("heading", { name: "内容草稿恢复失败", exact: true }).waitFor({ state: "visible" });
  assert.equal(await isolationPage.getByText("本机合成验收数据：美业加盟条件需沟通确认", { exact: false }).count(), 0, "foreign tenant must not see source evidence");
  assert.ok(network.some(item => item.label === "tenant_isolation" && item.method === "GET" && item.status === 404 && item.path.includes("founder-ip-content-drafts")), "foreign tenant draft read must return 404");
  await isolationPage.screenshot({ path: path.join(evidenceDirectory, "fip-content-tenant-isolation.png"), fullPage: true });
  await isolationContext.close();

  assert.equal(modelRequests, 0, "browser E2E must not send any model generation request");
  const expectedIsolation404Console = consoleErrors.filter(error => error === "tenant_isolation:Failed to load resource: the server responded with a status of 404 (Not Found)");
  const unexpectedConsoleErrors = consoleErrors.filter(error => !expectedIsolation404Console.includes(error));
  assert.ok(network.some(item => item.label === "tenant_isolation" && item.status === 404), "an allowed isolation console 404 must have matching network evidence");
  assert.deepEqual(unexpectedConsoleErrors, [], `browser console errors: ${unexpectedConsoleErrors.join(" | ")}`);
  assert.deepEqual(pageErrors, [], `browser page errors: ${pageErrors.join(" | ")}`);
  assert.deepEqual(requestFailures, [], `browser request failures: ${requestFailures.join(" | ")}`);
  assert.equal(network.some(item => item.status >= 500), false, "browser E2E must not observe an unexpected 5xx response");
  console.log(`founder_ip_content_browser_playwright_e2e:PASS desktop=PASS mobile390=PASS beauty_fixture=PASS synthetic_label=PASS no_external_sources=PASS four_targets=PASS work_map_video_branch=PASS work_map_routes=PASS save=PASS refresh=PASS back=PASS failure=PASS cancel=PASS duplicate=PASS tenant_isolation=PASS console_unexpected=0 isolation_404_console=${expectedIsolation404Console.length} network=PASS model_requests=${modelRequests}`);
  console.log(`evidence_directory=${evidenceDirectory}`);
} finally {
  await browser.close();
}

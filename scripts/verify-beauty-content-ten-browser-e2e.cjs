const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");

const baseUrl = process.env.BEAUTY_E2E_WEB_URL ?? "http://127.0.0.1:5176";
const apiBase = process.env.BEAUTY_E2E_API_URL ?? "http://127.0.0.1:3016";
const token = process.env.BEAUTY_E2E_SESSION_TOKEN ?? "";
const artifactDir = process.env.BEAUTY_E2E_ARTIFACT_DIR
  ?? "F:\\思潼AI增长os\\test-environments\\beauty-industry-acceptance-20260821\\artifacts\\content-ten-p1";
const required = ["选题", "口播逐字稿", "访谈话术", "拍摄脚本", "拍摄注意事项", "剪辑EDL", "发布标题与话题", "最佳发布时间", "评论区引导话术", "投流建议"];
const forbidden = /枕水江南|餐饮|招商|山东|培训3天|月流水15万|毛利60%|团购|外卖|夫妻店|兰琪|验收[AB]店|tenant/i;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function openContentWorkspace(page) {
  await page.addInitScript((sessionToken) => localStorage.setItem("store_os_token", sessionToken), token);
  await page.goto(`${baseUrl}/agents/beauty-industry/acquisition/video/content?apiBase=${encodeURIComponent(apiBase)}`, { waitUntil: "networkidle" });
  await page.getByRole("region", { name: "内容系统专属工作区" }).waitFor();
  await page.getByRole("heading", { name: "内容系统", exact: true }).first().waitFor();
}

async function fillBrief(page) {
  await page.getByLabel("选题 / 内容任务").fill("第一次做基础补水护理前先确认三件事");
  await page.getByLabel("本轮获客目标").fill("让附近成年顾客了解服务边界并发起合规咨询");
  await page.getByLabel("目标顾客").fill("附近关注日常皮肤管理的成年女性");
  await page.getByLabel("发布平台").fill("抖音");
  await page.getByLabel("内容形式").fill("店长真人口播短视频");
  await page.getByLabel("建议时长").fill("60秒内");
  await page.getByLabel("出镜/表达主体").fill("店长本人");
  await page.getByLabel(/本次可使用的项目与服务事实/).fill("本店提供基础补水护理；未确认价格、疗效、案例或活动");
  await page.getByLabel(/拍摄与素材约束/).fill("不出现顾客正脸；只拍已授权门店区域；竖屏拍摄");
}

async function assertTenPack(page, name) {
  await page.locator(".contentDeliveryCards").waitFor({ timeout: 20_000 });
  assert(await page.locator(".contentDeliveryCard").count() === 10, `${name}:ten_cards_required`);
  const result = await page.locator(".beautyContentTenResult").innerText();
  for (const section of required) assert(result.includes(section), `${name}:missing_${section}`);
  assert(!forbidden.test(result), `${name}:cross_product_contamination`);
  assert((await page.locator(".beautyIndustryMeta").innerText()).includes("本次使用"), `${name}:ability_receipt_missing`);
}

async function main() {
  assert(token.length > 20, "missing_ephemeral_session_token");
  fs.mkdirSync(artifactDir, { recursive: true });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const results = [];
  const downloads = [];
  try {
    const desktopContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    await desktopContext.grantPermissions(["clipboard-read", "clipboard-write"], { origin: baseUrl });
    const page = await desktopContext.newPage();
    const consoleErrors = [];
    const unexpectedFailures = [];
    let expectedHistoryNetworkFailure = false;
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      const text = message.text();
      if (expectedHistoryNetworkFailure && /ERR_INTERNET_DISCONNECTED|Failed to load resource/i.test(text)) return;
      consoleErrors.push(text);
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));
    page.on("requestfailed", (request) => {
      if (expectedHistoryNetworkFailure && /beauty-industry\/acquisition\/history/.test(request.url())) return;
      if (!/beauty-industry\/acquisition\/runs/.test(request.url())) unexpectedFailures.push(`${request.method()} ${request.url()} ${request.failure()?.errorText ?? "failed"}`);
    });

    await openContentWorkspace(page);
    const generate = page.getByRole("button", { name: /生成内容系统/ });
    assert(await generate.isDisabled(), "missing brief must keep generation disabled");
    await page.getByText("本次选题或内容任务", { exact: true }).waitFor();
    await fillBrief(page);
    assert(!(await generate.isDisabled()), "complete brief must enable generation");

    let runRequestCount = 0;
    page.on("request", (request) => {
      if (request.method() === "POST" && /\/beauty-industry\/acquisition\/runs(?:\?|$)/.test(request.url())) runRequestCount += 1;
    });
    const responsePromise = page.waitForResponse(
      (response) => response.request().method() === "POST" && /\/beauty-industry\/acquisition\/runs(?:\?|$)/.test(response.url()),
      { timeout: 210_000 }
    );
    await generate.evaluate((button) => { button.click(); button.click(); });
    const response = await responsePromise;
    assert(response.status() === 200, `web generation failed:${response.status()}`);
    const payload = await response.json();
    assert(payload.capabilityId === "content_plan", `wrong capability:${payload.capabilityId}`);
    assert(payload.skillId === "baolu_content_creator", `wrong skill:${payload.skillId}`);
    assert(runRequestCount === 1, `same-tick duplicate click created ${runRequestCount} requests`);
    assertTenPackText(payload.answerText, "desktop-provider");
    await assertTenPack(page, "desktop");
    const customerCards = await page.locator(".contentDeliveryCards").innerText();
    assert(!/mock|Schema|Eval|任务事实回执|待补|待核验|供应商/.test(customerCards), "customer deliverable contains internal terms");
    assert(!(await page.locator(".beautyContentAudit").evaluate((item) => item.open)), "quality audit must be collapsed by default");

    await page.getByRole("button", { name: "复制预览内容" }).click();
    await page.getByText(/流程预览已复制/).waitFor();
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 30_000 }),
      page.getByRole("button", { name: "下载 Word" }).click()
    ]);
    const docxPath = path.join(artifactDir, "美业内容十件套-验收.docx");
    await download.saveAs(docxPath);
    downloads.push(docxPath);
    assert((await fs.promises.stat(docxPath)).size > 10_000, "downloaded docx is unexpectedly small");

    await page.locator(".beautyContentHistory summary").click();
    assert((await page.locator(".beautyIndustryHistoryList button").count()) >= 1, "history drawer must contain saved run");
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("region", { name: "内容系统专属工作区" }).waitFor();
    await assertTenPack(page, "desktop-refresh");
    expectedHistoryNetworkFailure = true;
    await page.route("**/beauty-industry/acquisition/history", (route) => route.abort("internetdisconnected"));
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("alert").waitFor({ timeout: 10_000 });
    const networkError = await page.getByRole("alert").innerText();
    assert(networkError.includes("网络连接失败") && networkError.includes("不会自动重复调用或扣费"), "network failure must show an actionable no-duplicate/no-charge error");
    await page.unroute("**/beauty-industry/acquisition/history");
    expectedHistoryNetworkFailure = false;
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("region", { name: "内容系统专属工作区" }).waitFor();
    await assertTenPack(page, "desktop-network-recovery");
    const desktopDimensions = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
    assert(desktopDimensions.document <= desktopDimensions.viewport, `desktop:horizontal_overflow:${desktopDimensions.document}/${desktopDimensions.viewport}`);
    await page.screenshot({ path: path.join(artifactDir, "desktop-content-ten.png"), fullPage: true });
    assert(consoleErrors.length === 0, `desktop:console_errors:${consoleErrors.join(" | ")}`);
    assert(unexpectedFailures.length === 0, `desktop:unexpected_network_failures:${unexpectedFailures.join(" | ")}`);
    results.push({ viewport: "desktop", status: "PASS", generated: true, refreshRecovery: true, copy: true, word: true });
    await desktopContext.close();

    const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const mobile = await mobileContext.newPage();
    const mobileErrors = [];
    mobile.on("console", (message) => { if (message.type() === "error") mobileErrors.push(message.text()); });
    mobile.on("pageerror", (error) => mobileErrors.push(error.message));
    await openContentWorkspace(mobile);
    await assertTenPack(mobile, "mobile-390");
    const mobileDimensions = await mobile.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
    assert(mobileDimensions.document <= mobileDimensions.viewport, `mobile:horizontal_overflow:${mobileDimensions.document}/${mobileDimensions.viewport}`);
    await mobile.screenshot({ path: path.join(artifactDir, "mobile-390-content-ten.png"), fullPage: true });
    assert(mobileErrors.length === 0, `mobile:console_errors:${mobileErrors.join(" | ")}`);
    results.push({ viewport: "mobile-390", status: "PASS", restored: true, horizontalOverflow: false });
    await mobileContext.close();
  } finally {
    await browser.close();
  }
  process.stdout.write(`${JSON.stringify({ status: "PASS", controlledRunRequests: 1, externalProviderRequests: 0, results, downloads, artifactDir }, null, 2)}\n`);
}

function assertTenPackText(text, name) {
  assert(typeof text === "string" && text.length >= 760, `${name}:too_short`);
  for (const section of required) assert(text.includes(section), `${name}:missing_${section}`);
  assert(!forbidden.test(text), `${name}:cross_product_contamination`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});

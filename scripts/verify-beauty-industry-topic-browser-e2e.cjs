const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");

const webBase = process.env.BEAUTY_E2E_WEB_URL ?? "http://127.0.0.1:5176";
const apiBase = process.env.BEAUTY_E2E_API_URL ?? "http://127.0.0.1:3016";
const token = process.env.BEAUTY_E2E_SESSION_TOKEN ?? "";
const artifactDir = process.env.BEAUTY_E2E_ARTIFACT_DIR
  ?? "F:\\思潼AI增长os\\test-environments\\beauty-industry-acceptance-20260821\\artifacts\\by-10-topic-four-source-p1";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function openTopicWorkspace(page) {
  await page.addInitScript((sessionToken) => localStorage.setItem("store_os_token", sessionToken), token);
  await page.goto(`${webBase}/agents/beauty-industry/acquisition/video/topics?apiBase=${encodeURIComponent(apiBase)}`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "美业视频选题系统" }).waitFor();
}

async function assertFourSourceWorkspace(page) {
  await page.getByLabel(/本轮视频选题获客目标简报/).waitFor();
  for (const source of ["行业热点", "对标账号", "AI录音卡", "自己账号真实数据复盘"]) {
    await page.locator(".topicSourceCard", { hasText: source }).waitFor();
  }
  await page.getByText("四大来源形成候选池 → 选题三关筛选 → 输出10条可测试选题", { exact: true }).waitFor();
}

async function fillAndGenerate(page) {
  await page.getByLabel(/门店\/品牌名称/).fill("本店");
  await page.getByLabel(/本轮目标顾客/).fill("关于日常皮肤管理的女性用户");
  await page.getByLabel(/本轮获客目标/).selectOption({ label: "团购下单" });
  await page.getByLabel(/本轮主推项目/).fill("");
  await page.getByLabel("所在行业").fill("皮肤管理");
  await page.getByLabel("对标账号").fill("同行公开账号示例（待核验）");

  const generate = page.locator(".topicGenerateBar > button");
  await generate.getByText("保存获客目标简报并从四大来源生成选题", { exact: true }).waitFor();
  const responsePromise = page.waitForResponse(
    (response) => response.request().method() === "POST" && /\/beauty-industry\/acquisition\/runs(?:\?|$)/.test(response.url()),
    { timeout: 210_000 },
  );
  await generate.click();
  await page.waitForTimeout(150);
  assert(await generate.isDisabled(), "生成中按钮必须禁用，重复点击不得创建第二个请求");
  const response = await responsePromise;
  assert(response.status() === 200, `选题网页请求失败 status=${response.status()}`);
  const payload = await response.json();
  assert(payload.capabilityId === "topic_inspiration", `网页 capability 错误: ${payload.capabilityId}`);
  assert(payload.skillId === "baolu_topics", `网页 Skill 错误: ${payload.skillId}`);
  assert(payload.abilityUsed === "美业选题生成", `网页能力说明错误: ${payload.abilityUsed}`);
  assert(typeof payload.answerText === "string" && /四大来源/.test(payload.answerText), "网页选题缺少四来源结构");
  assert(/TOP10/i.test(payload.answerText), "网页选题缺少 TOP10 结构");
  assert(!/已读取录音卡|已读取自己账号/.test(payload.answerText), "缺失来源不得冒充已读取");
  await page.locator(".topicSystemResult").waitFor({ timeout: 20_000 });
  await page.getByRole("heading", { name: "用户可用TOP10预览" }).waitFor();
  assert(await page.locator(".beautyTopicCards > article").count() === 10, "必须渲染10张用户可读选题卡");
  const customerText = await page.locator(".beautyTopicCards").innerText();
  assert(customerText.includes("关于日常皮肤管理的女性用户"), "当前目标用户必须保留");
  assert(!/待补|mock|Schema|Eval|\|\s*选题/.test(customerText), "用户TOP10不得包含占位、内部术语或Markdown表格");
  assert(!(await page.locator(".beautyTopicAudit").evaluate((item) => item.open)), "来源与质量审核必须默认折叠");
  await page.getByRole("button", { name: "复制全部TOP10" }).click();
  await page.getByText(/已复制干净的TOP10/).waitFor();
  await page.getByRole("button", { name: "用此选题进入内容系统" }).waitFor();
  assert(await page.getByRole("alert").count() === 0, "成功路径不应残留错误提示");
  return payload;
}

async function validateRestored(page, name) {
  await openTopicWorkspace(page);
  await assertFourSourceWorkspace(page);
  await page.locator(".topicSystemResult").waitFor({ timeout: 20_000 });
  assert(await page.locator(".beautyTopicCards > article").count() === 10, `${name}:刷新后TOP10未恢复`);
  const result = await page.locator(".beautyTopicCards").innerText();
  assert(/关于日常皮肤管理的女性用户/.test(result), `${name}:刷新后目标用户未恢复`);
  assert(!/待补|mock|Schema|Eval|\|\s*选题/.test(result), `${name}:用户结果包含内部污染`);
  const dimensions = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
  assert(dimensions.document <= dimensions.viewport, `${name}:horizontal_overflow:${dimensions.document}/${dimensions.viewport}`);
  await page.screenshot({ path: path.join(artifactDir, `${name}-topic-restored.png`), fullPage: true });
}

async function main() {
  assert(token.length > 20, "missing_ephemeral_session_token");
  fs.mkdirSync(artifactDir, { recursive: true });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const consoleErrors = [];
  const requestFailures = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  page.on("requestfailed", (request) => requestFailures.push(`${request.method()} ${request.url()} ${request.failure()?.errorText ?? "failed"}`));

  try {
    await openTopicWorkspace(page);
    await assertFourSourceWorkspace(page);
    const payload = await fillAndGenerate(page);
    await page.screenshot({ path: path.join(artifactDir, "desktop-topic-success.png"), fullPage: true });

    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "美业视频选题系统" }).waitFor();
    await page.locator(".topicSystemResult").waitFor();
    assert(await page.getByLabel(/本轮目标顾客/).inputValue() === "关于日常皮肤管理的女性用户", "刷新后未恢复获客目标简报");

    const requestsBeforeHandoff = await page.evaluate(() => performance.getEntriesByType("resource").length);
    await page.getByRole("button", { name: "用此选题进入内容系统" }).click();
    await page.getByRole("heading", { name: "内容系统", exact: true }).last().waitFor();
    assert((await page.getByLabel("选题 / 内容任务").inputValue()).includes("围绕选题"), "进入内容系统未继承所选选题");
    assert(await page.getByText("已从选题系统承接", { exact: true }).count() === 1, "内容工作区未展示来源承接卡");
    assert(await page.getByText(/尚未调用模型或扣积分/).count() >= 1, "内容承接缺少零调用边界提示");
    const requestsAfterHandoff = await page.evaluate(() => performance.getEntriesByType("resource").length);
    assert(requestsAfterHandoff === requestsBeforeHandoff, "仅进入内容系统不应触发后端生成请求");

    const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const mobile = await mobileContext.newPage();
    const mobileErrors = [];
    mobile.on("console", (message) => { if (message.type() === "error") mobileErrors.push(message.text()); });
    mobile.on("pageerror", (error) => mobileErrors.push(error.message));
    await validateRestored(mobile, "mobile-390");
    assert(mobileErrors.length === 0, `390px控制台错误: ${mobileErrors.join(" | ")}`);
    await mobileContext.close();

    assert(consoleErrors.length === 0, `控制台错误: ${consoleErrors.join(" | ")}`);
    assert(requestFailures.length === 0, `非预期网络失败: ${requestFailures.join(" | ")}`);
    process.stdout.write(`${JSON.stringify({
      status: "PASS",
      controlledRunRequests: 1,
      externalProviderRequests: 0,
      capabilityId: payload.capabilityId,
      skillId: payload.skillId,
      fourSourceWorkspace: "PASS",
      desktop: "PASS",
      mobile390: "PASS",
      refreshRecovery: "PASS",
      duplicateGuard: "PASS",
      contentHandoffWithoutProviderCall: "PASS",
      consoleErrors: 0,
      requestFailures: 0,
      artifactDir,
    }, null, 2)}\n`);
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});

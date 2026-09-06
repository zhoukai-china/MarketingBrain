const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");

const baseUrl = process.env.BEAUTY_E2E_WEB_URL ?? "http://127.0.0.1:5176";
const apiBase = process.env.BEAUTY_E2E_API_URL ?? "http://127.0.0.1:3016";
const artifactDir = process.env.BEAUTY_E2E_ARTIFACT_DIR
  ?? "F:\\思潼AI增长os\\test-environments\\beauty-industry-acceptance-20260821\\artifacts\\by-06";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function enterProduct(page) {
  const loginUrl = `${baseUrl}/login/beauty-industry?apiBase=${encodeURIComponent(apiBase)}`;
  await page.goto(loginUrl, { waitUntil: "networkidle" });
  const entry = page.getByRole("button", { name: /本机直接开通并进入/ });
  if (await entry.isVisible().catch(() => false)) {
    await entry.click();
  }
  await page.waitForURL(/\/agents\/beauty-industry(?:\?|$)/, { timeout: 30_000 });
  await page.getByRole("heading", { name: "美业经营工作台" }).waitFor({ timeout: 20_000 });
}

async function validateWorkspace(page, viewportName) {
  await enterProduct(page);
  assert((await page.locator("body").innerText()).includes("邀请制内测"), `${viewportName}: 页面未标识邀请制内测`);

  const layoutWidth = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  assert(
    layoutWidth.document <= layoutWidth.viewport,
    `${viewportName}: 页面出现横向溢出 document=${layoutWidth.document} viewport=${layoutWidth.viewport}`,
  );

  const branchButtons = page.locator(".beautyIndustryBranches > button");
  assert(await branchButtons.count() === 3, `${viewportName}: 首页必须只有三个获客分支`);
  const branchText = await branchButtons.allTextContents();
  assert(branchText.some((text) => text.includes("图文获客")), `${viewportName}: 缺少图文获客`);
  assert(branchText.some((text) => text.includes("视频获客")), `${viewportName}: 缺少视频获客`);
  assert(branchText.some((text) => text.includes("直播获客")), `${viewportName}: 缺少直播获客`);
  assert(!branchText.some((text) => text.includes("获客问答")), `${viewportName}: 不得出现获客问答`);

  await page.getByRole("button", { name: /图文获客/ }).click();
  await page.getByRole("button", { name: /专业模式/ }).click();
  assert(await page.getByLabel("配图数量").isVisible(), `${viewportName}: 图文任务应显示配图数量`);
  assert(await page.getByText("视频表现数据").count() === 0, `${viewportName}: 图文任务不得出现视频复盘字段`);

  const requirement = page.getByLabel("这次要完成什么？");
  const savedValue = `BY-06-${viewportName}-刷新恢复验证`;
  await requirement.fill(savedValue);
  await page.waitForTimeout(450);
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "美业经营工作台" }).waitFor();
  assert(await page.getByLabel("这次要完成什么？").inputValue() === savedValue, `${viewportName}: 刷新后没有恢复任务输入`);

  if (viewportName === "desktop") {
    const runEndpoint = /\/beauty-industry\/acquisition\/runs(?:\?|$)/;
    await page.route(runEndpoint, (route) => route.abort("failed"));
    await page.getByLabel("这次要完成什么？").fill("验证网络失败后按钮恢复，不创建正式任务");
    await page.getByRole("button", { name: /生成小红书图文生成/ }).click();
    await page.getByRole("alert").waitFor();
    assert((await page.getByRole("alert").innerText()).includes("网络连接失败"), "desktop: 网络失败必须显示明确错误");
    await page.unroute(runEndpoint);
    await page.getByRole("alert").getByRole("button", { name: "关闭" }).click();
    assert(await page.getByRole("button", { name: /生成小红书图文生成/ }).isEnabled(), "desktop: 网络失败后生成按钮必须恢复");

    await page.route(runEndpoint, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ run: { id: "late-response" } }) }).catch(() => undefined);
    });
    await page.getByLabel("这次要完成什么？").fill("验证取消后不接受晚到结果，不产生正式任务");
    await page.getByRole("button", { name: /生成小红书图文生成/ }).click();
    await page.getByRole("button", { name: "取消" }).waitFor();
    await page.getByRole("button", { name: "取消" }).click();
    await page.getByRole("status").filter({ hasText: "本次请求已取消" }).waitFor();
    await page.waitForTimeout(1_700);
    assert(await page.getByRole("heading", { name: "等待生成" }).count() === 1, "desktop: 晚到响应不得覆盖取消后的空结果");
    await page.unroute(runEndpoint);
  }

  await page.getByRole("button", { name: /视频获客/ }).click();
  assert(await page.locator(".beautyIndustryFlow button", { hasText: "内容十件套" }).count() === 1, `${viewportName}: 视频流程必须只展示一个内容十件套入口`);
  assert(await page.getByText(/文生视频（数字人方向 · 规划中）/).count() === 1, `${viewportName}: 文生视频规划入口缺失`);
  assert(await page.getByText(/图生视频（数字人方向 · 规划中）/).count() === 1, `${viewportName}: 图生视频规划入口缺失`);
  assert(await page.locator(".beautyIndustryFlow button", { hasText: "视频内容复盘" }).count() === 0, `${viewportName}: 视频内容复盘不应出现在内测入口`);

  await page.locator(".beautyIndustryFlow button", { hasText: "视频数据复盘" }).click();
  await page.getByRole("button", { name: /专业模式/ }).click();
  assert(await page.getByLabel("指标口径与缺失字段").isVisible(), `${viewportName}: 视频数据复盘应显示结构化数据字段`);
  assert(await page.getByText("配图数量").count() === 0, `${viewportName}: 视频数据复盘不得出现图文字段`);

  await page.getByRole("button", { name: /直播获客/ }).click();
  assert(await page.locator(".beautyIndustryFlow button", { hasText: "直播话术" }).count() === 1, `${viewportName}: 缺少直播话术`);
  assert(await page.locator(".beautyIndustryFlow button", { hasText: "直播复盘" }).count() === 1, `${viewportName}: 缺少直播复盘`);
  assert(await page.locator(".beautyIndustryFlow button", { hasText: "直播策划" }).count() === 0, `${viewportName}: 不得出现独立直播策划入口`);
  await page.screenshot({ path: path.join(artifactDir, `${viewportName}-acquisition.png`), fullPage: true });

  await page.getByRole("button", { name: "WorkBuddy 连接" }).click();
  await page.waitForURL(/\/agents\/beauty-industry\/workbuddy/);
  await page.getByRole("heading", { name: /WorkBuddy/ }).waitFor();
  const workbuddyBody = await page.locator("body").innerText();
  assert(workbuddyBody.includes("美业产品专属连接"), `${viewportName}: WorkBuddy 页面必须是美业产品专属入口`);
  assert(workbuddyBody.includes("邀请制内测"), `${viewportName}: WorkBuddy 页面未标识邀请制内测`);
  assert(!workbuddyBody.includes("beauty.video_content_review"), `${viewportName}: WorkBuddy 页面暴露了已下架视频内容复盘`);
  assert(!workbuddyBody.includes("选择你的 AI"), `${viewportName}: 不得跳到通用 AI 分流页`);
  await page.screenshot({ path: path.join(artifactDir, `${viewportName}-workbuddy.png`), fullPage: true });
}

async function main() {
  fs.mkdirSync(artifactDir, { recursive: true });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const results = [];
  try {
    for (const target of [
      { name: "desktop", viewport: { width: 1440, height: 1000 } },
      { name: "mobile-390", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    ]) {
      const context = await browser.newContext({ viewport: target.viewport, isMobile: target.isMobile, hasTouch: target.hasTouch });
      const page = await context.newPage();
      const consoleErrors = [];
      const failedRequests = [];
      page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
      page.on("requestfailed", (request) => failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText ?? "failed"}`));
      await validateWorkspace(page, target.name);
      const unexpectedConsoleErrors = consoleErrors.filter((item) => !item.includes("net::ERR_FAILED"));
      assert(unexpectedConsoleErrors.length === 0, `${target.name}: 控制台错误 ${unexpectedConsoleErrors.join(" | ")}`);
      const unexpectedFailures = failedRequests.filter((item) => !item.includes("/beauty-industry/acquisition/runs"));
      assert(unexpectedFailures.length === 0, `${target.name}: 非预期网络失败 ${unexpectedFailures.join(" | ")}`);
      results.push({ viewport: target.name, status: "PASS", consoleErrors: unexpectedConsoleErrors.length, failedRequests: unexpectedFailures.length });
      await context.close();
    }
  } finally {
    await browser.close();
  }
  process.stdout.write(`${JSON.stringify({ status: "PASS", results, artifactDir }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});

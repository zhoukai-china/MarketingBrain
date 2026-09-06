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

function assert(condition, message) { if (!condition) throw new Error(message); }

async function open(page) {
  await page.addInitScript((sessionToken) => localStorage.setItem("store_os_token", sessionToken), token);
  await page.goto(`${baseUrl}/agents/beauty-industry?apiBase=${encodeURIComponent(apiBase)}`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "美业经营工作台" }).waitFor({ timeout: 20_000 });
  await page.getByRole("button", { name: /视频获客/ }).click();
  await page.locator(".beautyIndustryFlow button", { hasText: "内容十件套" }).click();
  await page.getByRole("region", { name: "内容十件套专属工作区" }).waitFor();
}

async function assertRestored(page, name) {
  await page.locator(".contentDeliveryCards").waitFor({ timeout: 20_000 });
  assert(await page.locator(".contentDeliveryCard").count() === 10, `${name}:ten_cards_required`);
  const text = await page.locator(".beautyContentTenResult").innerText();
  for (const section of required) assert(text.includes(section), `${name}:missing_${section}`);
  assert(!forbidden.test(text), `${name}:cross_product_contamination`);
  const dimensions = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
  assert(dimensions.document <= dimensions.viewport, `${name}:horizontal_overflow:${dimensions.document}/${dimensions.viewport}`);
}

async function main() {
  assert(token.length > 20, "missing_ephemeral_session_token");
  fs.mkdirSync(artifactDir, { recursive: true });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const results = [];
  try {
    for (const target of [
      { name: "desktop", viewport: { width: 1440, height: 1000 } },
      { name: "mobile-390", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }
    ]) {
      const context = await browser.newContext({ viewport: target.viewport, isMobile: target.isMobile, hasTouch: target.hasTouch });
      const page = await context.newPage();
      const errors = [];
      page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
      page.on("pageerror", (error) => errors.push(error.message));
      await open(page);
      await assertRestored(page, target.name);
      await page.waitForTimeout(400);
      await page.reload({ waitUntil: "networkidle" });
      await page.getByRole("region", { name: "内容十件套专属工作区" }).waitFor();
      await assertRestored(page, `${target.name}-refresh`);
      await page.screenshot({ path: path.join(artifactDir, `${target.name}-content-ten.png`), fullPage: true });
      assert(errors.length === 0, `${target.name}:console_errors:${errors.join(" | ")}`);
      results.push({ viewport: target.name, status: "PASS", refreshRecovery: true, consoleErrors: 0 });
      await context.close();
    }
  } finally {
    await browser.close();
  }
  process.stdout.write(`${JSON.stringify({ status: "PASS", providerCalls: 0, results, artifactDir }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});

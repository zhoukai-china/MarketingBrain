/* 本地冒烟：IP 定位工作台页面能否正常加载（不跑完整生成），确认新增 JSX 不崩。
 * 跑法：node qa-ip-pos/ippos-local-smoke.cjs
 */
const puppeteer = require("puppeteer-core");
const fs = require("fs");
const os = require("os");
const path = require("path");
const CHROME = "/Users/zhoukai/.cache/puppeteer/chrome-headless-shell/mac_arm-150.0.7871.24/chrome-headless-shell-mac-arm64/chrome-headless-shell";
const BASE = "http://127.0.0.1:5174";
const WORKBENCH = BASE + "/agent/ipzone__ip-pos/workbench";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const token = await fetch(BASE.replace("5174", "3011") + "/auth/dev-login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ productCode: "lanqi" })
  }).then((r) => r.json()).then((d) => d.token || "").catch(() => "");
  if (!token) { console.log("✗ dev-login 失败"); process.exit(1); }

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ippos-smoke-"));
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true, userDataDir,
    args: ["--no-proxy-server", "--no-sandbox", "--disable-gpu"]
  });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 160)));
  page.on("console", (m) => { if (m.type() === "error") pageErrors.push("console.error: " + m.text().slice(0, 160)); });

  await page.goto(BASE + "/agents", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.evaluate((t) => { localStorage.setItem("store_os_token", t); }, token);
  await page.goto(WORKBENCH, { waitUntil: "domcontentloaded", timeout: 45000 });
  await wait(2500);

  const root = await page.evaluate(() => Boolean(document.querySelector(".cpw-page")));
  const hero = await page.evaluate(() => (document.querySelector(".cpw-hero h1")?.textContent || "").trim());
  const hasDemoOrQ = await page.evaluate(() =>
    Boolean(document.querySelector(".cpw-demo-bar")) || document.body.innerText.includes("先确认一下"));
  console.log(`✓ 页面根 .cpw-page 渲染: ${root ? "是" : "否"}`);
  console.log(`✓ 标题: "${hero}"`);
  console.log(`✓ 进入后可见演示条或首题: ${hasDemoOrQ ? "是" : "否"}`);
  console.log(`页面 JS 错误数: ${pageErrors.length}`);
  pageErrors.slice(0, 5).forEach((e) => console.log("   ⚠ " + e));

  await browser.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
  const ok = root && hero.includes("IP定位工作台") && pageErrors.length === 0;
  console.log(ok ? "\nALL PASS ✅（页面加载正常，新 JSX 未崩溃）" : "\nHAS FAIL ❌");
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error("脚本异常：", e); process.exit(1); });

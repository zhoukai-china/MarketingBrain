/**
 * 验证本地「登出后如何再登录」：在 /login 填品牌名 → 点「进入思潼AI 智能体平台」→ 是否真的登进去。
 * 2026-09-30
 */
const puppeteer = require("puppeteer-core");
const CHROME = "/Users/zhoukai/.cache/puppeteer/chrome-headless-shell/mac_arm-150.0.7871.24/chrome-headless-shell-mac-arm64/chrome-headless-shell";
const WEB = "http://127.0.0.1:5174";

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "shell",
    args: ["--no-sandbox", "--no-proxy-server", "--disable-dev-shm-usage"]
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  await page.goto(`${WEB}/login`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${WEB}/login`, { waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 2500));

  await page.type('input[placeholder*="XX品牌"]', "本机思潼商城工作区");
  const clickSubmit = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find(
      (b) => (b.textContent || "").includes("进入思潼AI")
    );
    if (btn) { btn.click(); return true; }
    return false;
  });
  console.log("点击「进入思潼AI 智能体平台」: " + clickSubmit);
  await new Promise((r) => setTimeout(r, 6000));

  const out = await page.evaluate(() => ({
    url: location.href,
    token: (localStorage.getItem("store_os_token") || "").slice(0, 16) || "(无)",
    text: (document.body.innerText || "").replace(/\n{2,}/g, "\n").slice(0, 300)
  }));
  await page.screenshot({ path: "qa-ip-pos/login-probe-relogin-ok.png", fullPage: true });
  console.log("落点 URL : " + out.url);
  console.log("token    : " + out.token);
  console.log("正文     :\n" + out.text);
  console.log("截图     : qa-ip-pos/login-probe-relogin-ok.png");
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });

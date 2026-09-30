const puppeteer = require("puppeteer-core");
const CHROME = "/Users/zhoukai/.cache/puppeteer/chrome-headless-shell/mac_arm-150.0.7871.24/chrome-headless-shell-mac-arm64/chrome-headless-shell";
const BASE = "http://127.0.0.1:5174";

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-proxy-server", "--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  // 伪造「线上微信已配置」，看带微信变体的真实渲染
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    if (req.url().includes("/auth/wechat-config")) {
      req.respond({
        status: 200,
        contentType: "application/json",
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ configured: true, inviteRequired: false }),
      });
    } else req.continue();
  });
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle2", timeout: 60000 });
  await new Promise((r) => setTimeout(r, 1500));

  const data = await page.evaluate(() => {
    const form = document.querySelector(".loginForm");
    const wechatBtn = document.querySelector(".wechatLoginBtn");
    return {
      hasWechatBtn: !!wechatBtn,
      wechatText: wechatBtn ? wechatBtn.textContent.trim() : "",
      hasEnterpriseInput: !!document.querySelector(".loginForm input[autocomplete='organization']"),
      formText: form ? form.textContent.trim().replace(/\s+/g, " ").slice(0, 120) : "",
    };
  });
  console.log("=== 「线上带微信」变体实测 ===");
  console.log("有微信按钮        :", data.hasWechatBtn, "->", data.wechatText);
  console.log("有企业/品牌名称输入:", data.hasEnterpriseInput, "(期望 false)");
  console.log("右卡文本          :", data.formText);

  await page.screenshot({ path: "qa-ip-pos/login-redesign-wechat.png", fullPage: true });
  await browser.close();
  console.log("\n截图: qa-ip-pos/login-redesign-wechat.png");
  console.log(data.hasWechatBtn && !data.hasEnterpriseInput ? "\n✅ PASS：带微信变体只有微信按钮，无企业/品牌名称字段" : "\n❌ FAIL");
})().catch((e) => { console.error(e); process.exit(1); });

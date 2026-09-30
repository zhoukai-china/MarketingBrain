const puppeteer = require("puppeteer-core");

const CHROME = "/Users/zhoukai/.cache/puppeteer/chrome-headless-shell/mac_arm-150.0.7871.24/chrome-headless-shell-mac-arm64/chrome-headless-shell";
const BASE = "http://127.0.0.1:5174";
const API = "http://127.0.0.1:3011";

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--no-proxy-server", "--disable-gpu"]
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  // 1) dev-login 拿 token
  const loginResp = await page.evaluate(async (api) => {
    const r = await fetch(api + "/auth/dev-login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ productCode: "lanqi" })
    });
    return { status: r.status, text: await r.text() };
  }, API);
  let token = null;
  try { token = JSON.parse(loginResp.text)?.token || JSON.parse(loginResp.text)?.data?.token; } catch {}
  console.log("dev-login:", loginResp.status, token ? "token OK" : "NO TOKEN");

  // 2) 设置本地 token 后访问商城首页 /agents
  await page.goto(BASE + "/agents", { waitUntil: "networkidle2", timeout: 30000 });
  if (token) {
    await page.evaluate((t) => localStorage.setItem("store_os_token", t), token);
    await page.reload({ waitUntil: "networkidle2" });
  }
  await new Promise((r) => setTimeout(r, 1500));

  const urlBefore = page.url();
  console.log("进入首页 URL:", urlBefore);

  // 3) 找到「我的」标签并点击
  const clicked = await page.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll(".eh-tab"));
    const mine = tabs.find((b) => b.textContent && b.textContent.includes("我的"));
    if (!mine) return false;
    mine.click();
    return true;
  });
  console.log("点击「我的」标签:", clicked ? "OK" : "未找到");
  await new Promise((r) => setTimeout(r, 1200));

  const urlAfter = page.url();
  const checks = await page.evaluate(() => {
    const q = (s) => !!document.querySelector(s);
    const txt = document.body.innerText;
    return {
      urlIsAgents: location.pathname === "/agents",
      hasMeHead: q(".me-head"),
      hasBalCard: q(".me-bal-card"),
      hasOrderSec: q(".me-sec-head"),
      hasMeList: q(".me-list"),
      hasLogout: q(".me-item"),
      hasExperienceVisitor: txt.includes("体验访客"),
      hasBalance: txt.includes("算力余额"),
      hasAllOrders: txt.includes("全部订单"),
      hasInvite: txt.includes("邀请有礼"),
      hasDict: txt.includes("术语词典"),
      hasLogoutText: txt.includes("退出登录"),
      // 确认不是旧版独立 MinePage 的遗留结构
      noOldMineTop: !q(".mine-top"),
      noLoginGate: !txt.includes("你还未登录")
    };
  });

  console.log("点击后 URL:", urlAfter);
  console.log("URL 仍为本页 /agents (内联切换, 非跳路由):", checks.urlIsAgents);
  console.log("内容断言:", JSON.stringify(checks, null, 2));

  const ok =
    clicked &&
    checks.urlIsAgents &&
    checks.hasMeHead && checks.hasBalCard && checks.hasOrderSec &&
    checks.hasMeList && checks.hasExperienceVisitor && checks.hasBalance &&
    checks.hasAllOrders && checks.hasInvite && checks.hasDict &&
    checks.hasLogoutText && checks.noOldMineTop && checks.noLoginGate;
  console.log(ok ? "\n✅ PASS：我的 是首页内联标签页，交互与 AI案例 一致" : "\n❌ FAIL");
  await page.screenshot({ path: "qa-ip-pos/mine-inline-view.png", fullPage: true });
  console.log("截图已保存: qa-ip-pos/mine-inline-view.png");
  await browser.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });

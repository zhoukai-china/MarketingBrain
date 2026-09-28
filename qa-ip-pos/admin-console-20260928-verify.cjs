// 管理后台入口验收（/agents/admin）：页面渲染、登录面板、「算力管理」导航项。
const puppeteer = require("puppeteer-core");
const HS = process.env.HOME + "/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell";

const URL = "http://localhost:5174/agents/admin";
let pass = 0, fail = 0;
const log = (ok, name) => { ok ? pass++ : fail++; console.log((ok ? "✅" : "❌") + " " + name); };

(async () => {
  const browser = await puppeteer.launch({ executablePath: HS, headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(URL, { waitUntil: "networkidle2", timeout: 30000 });
  await new Promise((r) => setTimeout(r, 1500));

  const text = await page.evaluate(() => document.body.innerText);
  log(text.includes("平台管理后台"), "页面标题「平台管理后台」渲染");
  log(text.includes("登录管理后台"), "管理员账号密码登录面板");
  log(text.includes("算力管理"), "侧边导航含「算力管理」");
  log(text.includes("概览") && text.includes("客户") && text.includes("充值明细"), "其余后台视图导航齐全");

  // 点进「算力管理」确认新视图渲染
  const clicked = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const target = btns.find((b) => b.textContent && b.textContent.includes("算力管理"));
    if (target) { target.click(); return true; }
    return false;
  });
  await new Promise((r) => setTimeout(r, 1200));
  const text2 = await page.evaluate(() => document.body.innerText);
  log(clicked && text2.includes("用户算力总览"), "「算力管理」视图渲染（用户算力总览/充值赠送分账）");
  log(text2.includes("使用记录") && text2.includes("手动加算力") || text2.includes("加算力"), "使用记录/加算力入口存在");
  log(text2.includes("体验额度发放（旧通道"), "旧体验额度通道保留");

  await page.screenshot({ path: "/tmp/admin-console-check.png" });
  console.log("PASS " + pass + " / FAIL " + fail);
  await browser.close();
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => { console.error("ERR:", e.message); process.exit(1); });

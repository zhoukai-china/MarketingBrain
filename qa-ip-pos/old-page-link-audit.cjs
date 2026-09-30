const puppeteer = require("puppeteer-core");

const CHROME = "/Users/zhoukai/.cache/puppeteer/chrome-headless-shell/mac_arm-150.0.7871.24/chrome-headless-shell-mac-arm64/chrome-headless-shell";
const BASE = "http://127.0.0.1:5174";
const API = "http://127.0.0.1:3011";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--no-proxy-server", "--disable-gpu"]
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  const results = [];
  const rec = (name, ok, detail = "") => {
    results.push({ name, ok });
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  |  " + detail : ""}`);
  };

  // 0) dev-login 拿 token
  const lr = await page.evaluate(async (api) => {
    const r = await fetch(api + "/auth/dev-login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ productCode: "lanqi" })
    });
    return { status: r.status, text: await r.text() };
  }, API);
  let token = null;
  try { const j = JSON.parse(lr.text); token = j.token || j.data?.token; } catch { /* ignore */ }
  console.log("dev-login:", lr.status, token ? "token OK" : "NO TOKEN");

  // A) 直接进入 /agents?tab=mine —— 应落在新版内联「我的」，而不是旧版独立页
  await page.goto(BASE + "/agents", { waitUntil: "networkidle2", timeout: 30000 });
  if (token) { await page.evaluate((t) => localStorage.setItem("store_os_token", t), token); }
  await page.goto(BASE + "/agents?tab=mine", { waitUntil: "networkidle2" });
  await wait(1500);
  const a = await page.evaluate(() => {
    const act = document.querySelector(".eh-tab.act");
    const txt = document.body.innerText;
    return {
      actText: act ? act.textContent.trim() : "(none)",
      mineActive: !!act && act.textContent.includes("我的"),
      hasMeInline: !!document.querySelector(".me-head, .me-bal-card, .me-list"),
      noOldMine: !document.querySelector(".mine-top"),
      url: location.pathname + location.search
    };
  });
  rec("A 直入 /agents?tab=mine 落在新版内联「我的」", a.mineActive && a.hasMeInline && a.noOldMine, `act="${a.actText}" url=${a.url}`);

  // A2) 在 /agents 点「我的」标签 —— URL 应同步为 ?tab=mine
  await page.goto(BASE + "/agents", { waitUntil: "networkidle2" });
  await wait(900);
  await page.evaluate(() => {
    const t = Array.from(document.querySelectorAll(".eh-tab")).find((b) => b.textContent.includes("我的"));
    if (t) t.click();
  });
  await wait(900);
  const a2 = await page.evaluate(() => ({ url: location.pathname + location.search, hasMe: !!document.querySelector(".me-head, .me-bal-card, .me-list") }));
  rec("A2 点「我的」标签后 URL 同步为 ?tab=mine", a2.url.includes("tab=mine") && a2.hasMe, `url=${a2.url}`);

  // B) 「常用」页(/my-agents) 共用顶栏的「我的」—— 应回新版内联视图
  await page.goto(BASE + "/my-agents", { waitUntil: "networkidle2" });
  await wait(1200);
  const bClicked = await page.evaluate(() => {
    const link = Array.from(document.querySelectorAll(".topnav .nav-link")).find((x) => x.textContent.trim() === "我的");
    if (!link) return false;
    link.click();
    return true;
  });
  await wait(2600);
  const b = await page.evaluate(() => ({
    url: location.pathname + location.search,
    hasMeInline: !!document.querySelector(".me-head, .me-bal-card, .me-list"),
    noOldMine: !document.querySelector(".mine-top")
  }));
  rec("B 常用页顶栏「我的」→ 新版内联视图(非旧版 /mine)", bClicked && b.url.includes("/agents") && b.url.includes("tab=mine") && b.hasMeInline && b.noOldMine, `url=${b.url}`);

  // C) 选题工作台「关联应用」—— 应本页右侧弹出抽屉，不跳旧版「我的」页
  await page.goto(BASE + "/agent/ipzone__topic/workbench", { waitUntil: "networkidle2" });
  await wait(2800);
  const cBefore = page.url();
  const cClick = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent.includes("关联应用"));
    if (!btn) return "no-button";
    btn.click();
    return "clicked";
  });
  await wait(1300);
  const c = await page.evaluate(() => ({
    url: location.pathname + location.search,
    drawer: !!document.querySelector('[aria-label="关联应用"]'),
    panel: !!document.querySelector(".eh-rd-panel")
  }));
  const beforePath = (() => { try { const u = new URL(cBefore); return u.pathname + u.search; } catch { return cBefore; } })();
  if (cClick === "no-button") {
    rec("C 工作台「关联应用」右侧抽屉弹出", false, "未找到触发按钮(可能该账号已配置得到大脑, 该分支不显示)");
  } else {
    rec("C 工作台「关联应用」右侧抽屉弹出(不跳页)", c.drawer && c.panel && c.url === beforePath, `click=${cClick} drawer=${c.drawer} panel=${c.panel} url=${c.url}`);
  }

  const allOk = results.every((r) => r.ok);
  console.log("\n" + (allOk ? "ALL PASS" : "SOME FAILED") + "  (" + results.filter((r) => r.ok).length + "/" + results.length + ")");
  await page.screenshot({ path: "qa-ip-pos/old-page-link-audit.png", fullPage: false });
  await browser.close();
  process.exit(allOk ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });

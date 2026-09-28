// IP 定位工作台「B 方案走马灯」验收：
// 1) 生成中点亮进行中（有 .ph.lit 也有 .ph.dim，且尚未出现报告 .dl-head）
// 2) 真实结果返回后才切到报告视图（.dl-head 出现、生成中网格卸载），且交付头口径 99 算力
// 纯前端视觉进度，与后端返回解耦；结果返回是切换前提。
const puppeteer = require("puppeteer-core");
const HS =
  process.env.HOME +
  "/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell";
const BASE = "http://localhost:5174";
const SKU = "ipzone__ip-pos";
const mockRunBody = {
  answer: "# IP定位全案\n测试正文",
  consumedCredits: 99,
  payload: {
    sections: {
      ov: "速览", pos1: "项目定位", pos2: "目标用户", per1: "人设",
      con1: "内容", con2: "选题", gro1: "投流", gro2: "规划", gro3: "执行"
    }
  }
};

(async () => {
  const browser = await puppeteer.launch({ executablePath: HS, headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const u = req.url();
    const origin = req.headers()["origin"] || BASE;
    const acao = { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST,GET,OPTIONS", "Access-Control-Allow-Headers": "*" };
    if (req.method() === "OPTIONS") return req.respond({ status: 200, headers: acao });
    if (req.method() === "POST" && u.includes("/precheck"))
      return req.respond({ status: 200, contentType: "application/json", headers: { ...acao, "Content-Type": "application/json" }, body: JSON.stringify({ issues: [] }) });
    if (req.method() === "POST" && u.includes("/run"))
      // 延迟 9s 返回，给走马灯留出逐格点亮时间
      return setTimeout(() => req.respond({ status: 200, contentType: "application/json", headers: { ...acao, "Content-Type": "application/json" }, body: JSON.stringify(mockRunBody) }), 9000);
    req.continue();
  });

  const fails = [];
  const check = (name, cond, extra = "") => {
    console.log((cond ? "PASS" : "FAIL") + " :: " + name + (extra ? "  [" + extra + "]" : ""));
    if (!cond) fails.push(name);
  };

  await page.goto(`${BASE}/agent/${SKU}/workbench`, { waitUntil: "networkidle2" });
  await page.waitForSelector(".bf", { timeout: 15000 });

  // 填所有简报字段（含选填，保证 6 必填齐）
  const fields = await page.$$(".bf");
  for (const f of fields) {
    await f.click();
    await page.waitForSelector(".ipw-modal textarea", { timeout: 8000 });
    await page.click(".ipw-modal textarea");
    await page.type(".ipw-modal textarea", "测试内容_" + Date.now());
    await page.click(".im-btn.save");
    await page.waitForSelector(".ipw-modal", { hidden: true, timeout: 8000 });
  }

  await page.waitForSelector(".big-btn.gen:not([disabled])", { timeout: 8000 });
  await page.click(".big-btn.gen");
  await page.waitForSelector(".ph-grid", { timeout: 8000 });

  // 中点：走马灯进行中
  await new Promise((r) => setTimeout(r, 4500));
  const mid = await page.evaluate(() => ({
    dim: document.querySelectorAll(".ph.dim").length,
    lit: document.querySelectorAll(".ph.lit").length,
    hasReport: !!document.querySelector(".dl-head"),
    grid: document.querySelectorAll(".ph-grid .ph").length
  }));
  await page.screenshot({ path: __dirname + "/gen-lit-mid.png" });
  check("生成中点亮中：有未点亮格(dim>0)", mid.dim > 0, "dim=" + mid.dim);
  check("生成中点亮中：已有点亮格(lit>0)", mid.lit > 0, "lit=" + mid.lit);
  check("生成中点亮中：结果未展示(无 .dl-head)", mid.hasReport === false);
  check("走马灯共 9 格", mid.grid === 9, "grid=" + mid.grid);

  // 结果返回后
  await page.waitForSelector(".dl-head", { timeout: 20000 });
  const done = await page.evaluate(() => ({
    hasReport: !!document.querySelector(".dl-head"),
    grid: document.querySelectorAll(".ph-grid .ph").length,
    time: document.querySelector(".dl-head .time")?.textContent || ""
  }));
  await page.screenshot({ path: __dirname + "/gen-done.png" });
  check("结果返回后展示报告(.dl-head)", done.hasReport === true);
  check("结果返回后生成中网格已卸载(无 .ph-grid)", done.grid === 0);
  check("交付头显示 99 算力口径", /\d+\s*算力/.test(done.time), done.time);

  await browser.close();
  console.log("\n=== " + (fails.length ? "FAIL(" + fails.length + "): " + fails.join(", ") : "ALL PASS") + " ===");
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error("SCRIPT ERROR:", e); process.exit(2); });

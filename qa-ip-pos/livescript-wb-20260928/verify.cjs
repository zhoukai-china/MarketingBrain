// 直播话术工作台验收（/agent/ipzone__livescript/workbench）
// 断言：罗盘问候、分流引导（招商分支）、6 字段简报、确认卡（固定价）、诚实进度（结果未返回前 <100%），
// Markdown 交付 + 复制/导出、计费口径（固定价一口价·积分·失败不扣费，非「按实际用量结算」）、/run 入参。
const puppeteer = require("puppeteer-core");
const HS = process.env.HOME + "/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell";

const URL = "http://localhost:5174/agent/ipzone__livescript/workbench";
let pass = 0, fail = 0;
const log = (ok, name, extra = "") => { ok ? pass++ : fail++; console.log(`${ok ? "✅" : "❌"} ${name}${extra ? " · " + extra : ""}`); };

const ANSWER = `# 整场直播脚本 · 思潼AI商城 招商专场（120 分钟）\n\n## ① 直播总览\n场景：招商加盟 · 目标：留资\n\n## ② 开场暖场（0:00-0:05）\n【直视镜头】各位老板晚上好…\n\n## ③ 痛点浪潮（0:05-0:25）\n生意做到头了怎么办…\n\n## ⑨ 全场节奏表\n| 时间 | 浪潮 |\n| 0-20 | 暖场+痛点 |\n\n## ⑩ 场控清单\n开播前：检查小风车…`;

(async () => {
  const browser = await puppeteer.launch({ executablePath: HS, headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 1100 });
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const u = req.url();
    if (u.includes("/market/skus") && !u.includes("/run") && !u.includes("/access") && req.method() === "GET") {
      return req.respond({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ skus: [{ skuCode: "ipzone__livescript", name: "直播话术智能体", ppu: 200, status: "selling" }] }) });
    }
    if (u.includes("/market/skus/ipzone__livescript/run") && req.method() === "POST") {
      const body = JSON.parse(req.postData() || "{}");
      global.__runBody = body;
      return setTimeout(() => req.respond({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ answer: ANSWER, consumedCredits: 200 }) }), 4500);
    }
    req.continue();
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

  await page.goto(URL, { waitUntil: "networkidle2" });
  await page.waitForSelector(".cpw-stage", { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 900));

  // 1) 问候与骨架
  const root = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " "));
  log(/你好，我是罗盘，你的直播操盘总监/.test(root), "问候话术与原型一致");
  log(/开播话术工作台|直播话术工作台/.test(root), "标题=直播话术工作台");
  log(/开播简报/.test(root), "简报标题=「开播简报」");
  const bfLabels = await page.evaluate(() => [...document.querySelectorAll(".cpw-bf-k")].map((e) => e.textContent.trim()));
  const expectLabels = ["🎬 场次类型 · 待填", "🏷️ 品牌 / 主推 · 待填", "👥 目标人群 · 待填", "🎯 转化动作 · 待填", "⏱️ 场次时长 · 待填", "📋 交付深度 · 待填"];
  log(expectLabels.every((l) => bfLabels.includes(l)), "简报 6 字段与原型逐字一致", bfLabels.join("|").slice(0, 80));

  // 2) Q1 三选项（含知识付费）
  await page.waitForSelector(".cpw-opt", { timeout: 8000 });
  const q1opts = await page.evaluate(() => [...document.querySelectorAll(".cpw-opt")].map((b) => b.textContent.trim()));
  log(q1opts.length === 3 && q1opts[0].includes("招商加盟") && q1opts[2].includes("知识付费"), "第 1 问 3 张选项卡与原型一致");

  // 3) 招商分支 6 问逐题点 rec（depth 选第 2 项=「完整 · 整场脚本十件套」）
  for (let i = 0; i < 6; i++) {
    await page.waitForSelector(".cpw-opt", { timeout: 8000 });
    const idx = i === 5 ? 2 : 1;
    await page.click(`.cpw-opts .cpw-opt:nth-child(${idx})`);
    await new Promise((r) => setTimeout(r, 750));
  }
  const after = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " "));
  log(/齐了 ✅ 简报 6\/6/.test(after), "确认话术与原型一致");
  log(/整场脚本十件套（招商加盟 · 120 分钟）/.test(after), "确认话术带场次与时长");
  log(/一口价\s*200\s*积分/.test(after), "费用=固定价一口价 200 积分（目录真源）");
  log(!/按本次实际用量结算/.test(after), "固定价 SKU 不写「按实际用量结算」");
  log(/失败不扣费/.test(after), "「🛡️ 失败不扣费」保留");
  log(/✓ 确认，开始生成/.test(after) && /✎ 改一下再生成/.test(after), "确认卡双按钮");
  const phCount = await page.evaluate(() => document.querySelectorAll(".cpw-ph").length);
  log(phCount === 10, "画布 10 件结构预览", "ph=" + phCount);

  // 4) 生成：诚实进度
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll(".cpw-opt")].find((b) => b.textContent.includes("确认，开始生成"));
    btn && btn.click();
  });
  await new Promise((r) => setTimeout(r, 3300));
  const mid = await page.evaluate(() => ({
    logLines: [...document.querySelectorAll(".cpw-genlog .cpw-ln")].map((e) => e.textContent),
    gening: document.querySelectorAll(".cpw-ph.gening").length,
    hasDl: !!document.querySelector(".cpw-dl-head"),
    pct: parseInt(document.querySelector(".cpw-gp-row b")?.textContent || "0", 10),
  }));
  log(mid.logLines.some((t) => t.includes("场景识别：招商加盟 · 整场 120 分钟")), "生成日志含场景识别行");
  log(mid.logLines.some((t) => t.includes("合规预审")), "生成日志含合规预审行");
  log(mid.logLines.every((t) => !t.startsWith("✓ 交付完成")), "后端未返回前日志不出「交付完成」行");
  log(mid.pct > 0 && mid.pct < 100, "后端未返回前进度条 < 100%", "pct=" + mid.pct);
  log(!mid.hasDl, "结果未返回前不出报告");

  // 5) 交付
  await page.waitForSelector(".cpw-dl-head", { timeout: 30000 });
  const done = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " "));
  log(/已交付/.test(done), "交付头「✓ 已交付」");
  log(/整场直播脚本/.test(done) && /全场节奏表/.test(done), "Markdown 正文渲染");
  log(/本次实际消耗\s*200\s*积分/.test(done), "交付费用=固定价 200 积分");
  log(/⧉ 复制全部/.test(done) && /↓ 导出 Word/.test(done), "复制全部/导出 Word 就位");
  const rb = global.__runBody || {};
  log(typeof rb.input === "string" && rb.input.includes("场次类型：招商加盟") && rb.input.includes("交付深度：完整 · 整场脚本十件套") && rb.input.includes("场次时长：120 分钟"), "/run 需求单带全 6 字段（分流不丢信息）", (rb.input || "").slice(0, 60));

  // 6) 无 JS 异常
  log(errors.length === 0, "无 JS 运行时异常", errors.slice(0, 2).join(" | "));

  await page.screenshot({ path: require("path").resolve(__dirname, "livescript-done.png"), fullPage: true });
  await browser.close();
  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });

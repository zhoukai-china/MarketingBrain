// 首页 v3.28 整体对齐验收
const puppeteer = require("/Users/zhoukai/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core");
const HS = process.env.HOME + "/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell";
let pass = 0, fail = 0;
const log = (ok, name, extra="") => { ok ? pass++ : fail++; console.log((ok ? "✅" : "❌") + " " + name + (extra ? " · " + extra : "")); };
(async () => {
  const browser = await puppeteer.launch({ executablePath: HS, headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 1100 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("http://localhost:5174/agents", { waitUntil: "networkidle2", timeout: 30000 });
  await new Promise((r) => setTimeout(r, 1800));
  const text = await page.evaluate(() => document.body.innerText);
  const kk = await page.evaluate(() => Array.from(document.querySelectorAll(".eco-kk-item .eco-kk-label")).map((e) => e.textContent.trim()).join("|"));
  log(kk === "内容获客|私域营销|数字咨询师|AI硬件|AI课程|OPC专区|行业工作台", "金刚区七格（原型楼层序）", kk);
  log(text.includes("F1") && text.includes("内容获客专区") && text.includes("位在线"), "F1 内容获客专区");
  log(text.includes("F2") && text.includes("私域营销专区"), "F2 私域营销专区");
  log(text.includes("保禄数字分身") && text.includes("真人授权训练中"), "F3 保禄分身卡（原型逐字）");
  log(text.includes("¥199") && text.includes("/台 · 人民币直购") && text.includes("¥1,999"), "F4 硬件人民币直购价");
  log(text.includes("¥99") && text.includes("/门 · 人民币直购"), "F5 课程人民币直购价");
  log(text.includes("大模型折扣仓") && text.includes("算力/份 起 ≈ ¥5"), "F6 OPC 大模型折扣仓");
  log(text.includes("F7") && text.includes("行业工作台"), "F7 行业工作台");
  log(text.includes("今日任务 · 按场景直达") && text.includes("AI 派单中"), "今日任务头部（AI 派单中）");
  // 加购 → TabBar 徽标
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll(".eco-p-cart")).find((b) => b.textContent.includes("加购"));
    if (btn) btn.click();
  });
  await new Promise((r) => setTimeout(r, 400));
  const badge = await page.evaluate(() => {
    const el = document.querySelector(".eco-tb-badge");
    return el ? el.textContent : "";
  });
  log(badge === "1", "加购后 TabBar 购物车徽标 +1", badge);
  // dev 卡直达预约详情页
  await page.evaluate(() => {
    const devCard = Array.from(document.querySelectorAll(".eco-product.is-dev"));
    const target = devCard.find((c) => c.textContent.includes("许复"));
    const link = target ? target : null;
    if (link) link.click();
  });
  await new Promise((r) => setTimeout(r, 1500));
  const url = page.url();
  log(url.includes("/agent/ipzone__liverev/detail"), "未上线卡直达预约详情页", url);
  log(errors.length === 0, "无 JS 异常");
  await page.goto("http://localhost:5174/agents", { waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 1000));
  await page.screenshot({ path: __dirname + "/home-v328-full.png", fullPage: false });
  await browser.close();
  console.log("PASS " + pass + " / FAIL " + fail);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => { console.error("ERR:", e.message); process.exit(1); });

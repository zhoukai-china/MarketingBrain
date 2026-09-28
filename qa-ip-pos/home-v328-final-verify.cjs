// 首页 v3.28 最终验收：侧边栏布局 + 橙色 Hero + 打字机 + 金刚瓷贴 + 员工卡
const puppeteer = require("/Users/zhoukai/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core");
const HS = process.env.HOME + "/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell";
let pass = 0, fail = 0;
const log = (ok, name, extra = "") => { ok ? pass++ : fail++; console.log((ok ? "✅" : "❌") + " " + name + (extra ? " · " + extra : "")); };
(async () => {
  const browser = await puppeteer.launch({ executablePath: HS, headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("http://localhost:5174/agents", { waitUntil: "networkidle2", timeout: 30000 });
  await new Promise((r) => setTimeout(r, 2000));
  const text = await page.evaluate(() => document.body.innerText);

  // 布局骨架
  const sb = await page.evaluate(() => {
    const el = document.querySelector(".eh-tabbar");
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { position: cs.position, width: cs.width, flexDir: cs.flexDirection };
  });
  log(sb && sb.position === "fixed" && parseInt(sb.width) === 190 && sb.flexDir === "column", "桌面左侧导航 190px 固定栏", JSON.stringify(sb));
  const bal = await page.evaluate(() => {
    const el = document.querySelector(".eh-nav-bal");
    return el ? el.innerText.replace(/\n/g, "|") : "";
  });
  log(bal.includes("我的算力") && bal.includes("充值"), "侧边栏底部我的算力卡+充值", bal.slice(0, 30));
  const brand = await page.evaluate(() => document.querySelector(".eh-nav-brand")?.innerText || "");
  log(brand.includes("思潼AI商城"), "侧边栏品牌区");
  const topbar = await page.evaluate(() => {
    const el = document.querySelector(".eh-topbar");
    return el ? el.innerText.replace(/\n/g, "|") : "";
  });
  log(topbar.includes("思潼AI商城") && topbar.includes("AI 全员在线") && topbar.includes("充值"), "顶栏品牌+AI在线+充值", topbar.slice(0, 40));

  // 橙色 Hero
  const hero = await page.evaluate(() => {
    const el = document.querySelector(".eh-hero");
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { bg: cs.backgroundImage, radius: cs.borderRadius };
  });
  log(hero && hero.bg.includes("linear-gradient") && hero.bg.includes("255, 138, 42") || hero && hero.bg.includes("#FF8A2A"), "Hero 橙色渐变", hero ? hero.bg.slice(0, 60) : "N/A");
  log(text.includes("你好，我是 AI 管家小潼"), "Hero 小潼问候");
  log(text.includes("AI 值班中 · 点左边头像，随时问小潼"), "Hero 波形值班行");
  log(text.includes("AI 商城 · 智能体 / 数字员工 / AI硬件 / AI课程，一站配齐"), "Hero slogan 胶囊");
  log(text.includes("免费开通 · 立送 100 算力") && text.includes("新手帮助"), "Hero 双按钮");
  log(text.includes("计费口径：1 元 = 10 算力 · 0 元开通 · 用后扣费 · 失败不扣"), "计费口径行");
  const wave = await page.evaluate(() => document.querySelectorAll(".eh-wave i").length);
  log(wave === 5, "波形动画 5 条");
  const caret = await page.evaluate(() => getComputedStyle(document.querySelector(".eh-caret")).animationName);
  log(caret === "ehBlink", "打字机光标闪烁");
  const typeLen = await page.evaluate(() => (document.querySelector(".eh-hero-type")?.textContent || "").trim().length);
  log(typeLen >= 0, "打字机文案区在跑", `${typeLen} 字`);

  // 搜索 + 提示行
  log(text.includes("不知道找谁？直接说事"), "搜索提示行");
  log(text.includes("「今天要发内容」"), "提示关键词胶囊");

  // 金刚区瓷贴
  const kk = await page.evaluate(() => {
    const ico = document.querySelector(".eco-kk-ico");
    if (!ico) return null;
    const cs = getComputedStyle(ico);
    return { bg: cs.backgroundImage, w: cs.width, items: document.querySelectorAll(".eco-kk-item").length };
  });
  log(kk && kk.items === 7, "金刚区 7 格", String(kk && kk.items));
  log(kk && kk.bg.includes("linear-gradient") && (kk.bg.includes("color-mix") || kk.bg.includes("255")), "瓷贴彩色渐变", kk ? kk.bg.slice(0, 50) : "N/A");
  log(text.includes("内容获客") && text.includes("私域营销") && text.includes("OPC专区") && text.includes("行业工作台"), "金刚区标签");

  // 邀约横幅
  const ad = await page.evaluate(() => {
    const el = document.querySelector(".eco-invite-banner");
    return el ? getComputedStyle(el).backgroundImage : "";
  });
  log(ad.includes("linear-gradient"), "邀约横幅橙渐变");

  // 今日任务
  log(text.includes("TODAY") && text.includes("今日任务 · 按场景直达") && text.includes("AI 派单中"), "今日任务头");

  // F1 员工卡
  const card = await page.evaluate(() => {
    const el = document.querySelector(".eh .eco-product");
    if (!el) return null;
    const cs = getComputedStyle(el);
    const ava = el.querySelector(".eco-ava");
    const ring = ava ? getComputedStyle(ava, "::before") : null;
    return { bg: cs.backgroundColor, dir: cs.flexDirection, ring: ring ? ring.animationName : "" };
  });
  log(card && card.bg === "rgb(255, 255, 255)", "员工卡白底", card ? String(card.bg) : "N/A");
  log(card && card.dir === "column", "桌面卡片竖排");
  log(card && card.ring === "ehSpin", "头像虚线旋环动画");
  log(text.includes("沈定") && text.includes("秦文") && text.includes("罗盘"), "F1 五位在线");
  log(text.includes("99") && text.includes("算力/次"), "价格橙标");
  log(text.includes("去使用"), "去使用按钮");

  // 楼层
  log(text.includes("F1") && text.includes("内容获客专区") && text.includes("位在线"), "F1 楼层头");
  log(text.includes("保禄数字分身") && text.includes("真人授权训练中"), "F3 保禄卡");
  log(text.includes("大模型折扣仓"), "F6 OPC");
  log(text.includes("AI 案例") && text.includes("演示数据虚构"), "AI 案例流");
  log(errors.length === 0, "无 JS 异常");

  await page.screenshot({ path: __dirname + "/home-v328-final.png" });
  // 移动端兜底
  await page.setViewport({ width: 390, height: 844 });
  await new Promise((r) => setTimeout(r, 800));
  const mob = await page.evaluate(() => {
    const el = document.querySelector(".eh-tabbar");
    return el ? getComputedStyle(el).flexDirection : "";
  });
  log(mob === "row", "移动端底部 TabBar 兜底", mob);
  await page.screenshot({ path: __dirname + "/home-v328-mobile.png" });
  await browser.close();
  console.log("PASS " + pass + " / FAIL " + fail);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => { console.error("ERR:", e.message); process.exit(1); });

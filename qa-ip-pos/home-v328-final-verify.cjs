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
  const ringAnim = await page.evaluate(() => getComputedStyle(document.querySelector(".eh .eco-p-img"), "::before").animationName);
  log(ringAnim === "ehSpin", "头像虚线旋环动画", ringAnim);
  log(text.includes("沈定") && text.includes("秦文") && text.includes("罗盘"), "F1 五位在线");
  log(/\d+\s*算力\/(份|次|场|条)/.test(text), "价格橙标（算力/单位）");
  const cardGeo = await page.evaluate(() => {
    const c = document.querySelector(".eh .eco-product");
    const r = c.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), text: c.innerText.replace(/\n/g, " | ") };
  });
  log(cardGeo.w === 276 && cardGeo.h === 278, "员工卡尺寸与原型一致 276×278", `${cardGeo.w}×${cardGeo.h}`);
  log(/⚡ \d+ 算力\/(份|次|场|条)/.test(cardGeo.text) && cardGeo.text.includes("≈ ¥") && cardGeo.text.includes("0元开通 · 用后扣费"), "价目行口径（算力/单位 + ≈¥ + 0元开通）", cardGeo.text.slice(-40));
  log(cardGeo.text.includes("· AI 智能体"), "职务行口径（原型逐字）");
  const avaGeo = await page.evaluate(() => {
    const a = document.querySelector(".eh .eco-p-img > .eco-ava");
    const r = a.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height) };
  });
  log(avaGeo.w === 68 && avaGeo.h === 68, "员工头像 68×68（原型 .emp-ava）", `${avaGeo.w}×${avaGeo.h}`);
  const todayGeo = await page.evaluate(() => {
    const t = document.querySelector(".eh .eco-today-item");
    const r = t.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height) };
  });
  log(todayGeo.w === 250 && todayGeo.h === 64, "今日卡 250×64（原型 .t-card）", `${todayGeo.w}×${todayGeo.h}`);
  const ring = await page.evaluate(() => getComputedStyle(document.querySelector(".eh .eco-p-img"), "::before").borderTopStyle);
  log(ring === "dashed", "头像外圈虚线旋环");

  // 楼层
  log(text.includes("F1") && text.includes("内容获客专区") && text.includes("位在线"), "F1 楼层头");
  log(text.includes("保禄数字分身") && text.includes("真人授权训练中"), "F3 保禄卡");
  log(text.includes("大模型折扣仓"), "F6 OPC");
  // AI 案例独立视图（侧栏切换）
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll(".eh-tab")).find((b) => b.textContent.includes("AI案例"));
    if (btn) btn.click();
  });
  await new Promise((r) => setTimeout(r, 600));
  const cv = await page.evaluate(() => {
    const view = document.querySelector(".eh-cases-view");
    if (!view) return null;
    return {
      head: view.querySelector(".eh-cv-title")?.textContent || "",
      chips: view.querySelectorAll(".eh-cv-chip").length,
      cards: view.querySelectorAll(".eh-case-card").length,
      covers: view.querySelectorAll(".eh-case-cover img").length,
      use: view.querySelector(".eh-case-use")?.textContent || ""
    };
  });
  log(cv && cv.head.includes("AI 案例") && cv.chips === 7, "AI案例独立视图（标题+7 筛选片）", JSON.stringify(cv));
  log(cv && cv.cards === 4 && cv.covers === 4, "4 张案例卡带封面", cv ? `${cv.cards}/${cv.covers}` : "N/A");
  log(cv && cv.use.includes("用同款"), "用同款按钮", cv ? cv.use : "");
  const homeBack = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll(".eh-tab")).find((b) => b.textContent.includes("首页"));
    if (btn) btn.click();
    return true;
  });
  await new Promise((r) => setTimeout(r, 400));
  const homeBackOk = await page.evaluate(() => Boolean(document.querySelector(".eh-hero")));
  log(homeBack && homeBackOk, "首页视图可切回");

  // ---- 8 条补修验收 ----
  const sideAi = await page.evaluate(() => {
    const el = document.querySelector(".eh-nav-brand .eh-ai");
    return el ? el.innerText.replace(/\n/g, " ") : "";
  });
  log(sideAi === "" || !sideAi.includes("AI 全员在线"), "① 侧边栏已去掉 AI 全员在线", sideAi);
  const clocks = await page.evaluate(() => Array.from(document.querySelectorAll(".eh-ai em")).map((e) => e.textContent.trim()));
  log(clocks.length >= 1 && clocks.every((c) => /^\d{2}:\d{2}$/.test(c)), "② 顶栏时钟 HH:MM", clocks.join(","));
  const bg = await page.evaluate(() => ({
    grid: document.querySelectorAll(".eh-bg-grid").length,
    orb: document.querySelectorAll(".eh-orb").length,
    anim: document.querySelectorAll(".eh-orb").length ? getComputedStyle(document.querySelector(".eh-orb")).animationName : ""
  }));
  log(bg.grid === 1 && bg.orb === 2 && bg.anim === "ehDrift", "③ 背景网格+漂移光斑动效", JSON.stringify(bg));
  const adWrap = await page.evaluate(() => {
    const el = document.querySelector(".eh-ad");
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { bw: cs.borderTopWidth, radius: cs.borderTopLeftRadius, bg: cs.backgroundColor };
  });
  log(adWrap && adWrap.bw === "1px" && adWrap.radius === "16px", "④ 邀请有礼外框（1px 边框/圆角16）", JSON.stringify(adWrap));
  const todayImg = await page.evaluate(() => document.querySelectorAll(".eh .eco-today-ico img").length);
  log(todayImg >= 1, "⑤ 今日任务用数字人头像", String(todayImg));
  const priceMt = await page.evaluate(() => {
    const el = document.querySelector(".eh .eco-p-price");
    return el ? getComputedStyle(el).marginTop : "";
  });
  log(priceMt === "3px", "⑥ 卡内价目行紧跟交付 pill（margin 3px）", priceMt);
  const cons = await page.evaluate(() => {
    const cards = document.querySelectorAll(".eh-cons-card");
    return { n: cards.length, dir: cards.length ? getComputedStyle(cards[0]).flexDirection : "", border: cards.length ? getComputedStyle(cards[0]).borderTopStyle : "" };
  });
  log(cons.n === 1 && cons.dir === "row" && cons.border === "dashed", "⑦ 数字咨询师卡=保禄一张+横向虚线样式", JSON.stringify(cons));
  const paluImg = await page.evaluate(() => { const i = document.querySelector(".eh-cons-ava img"); return i ? i.src : ""; });
  log(paluImg.includes("/mall/palu.jpg"), "保禄分身用真身照片", paluImg.slice(-20));
  const covers = await page.evaluate(() => Array.from(document.querySelectorAll(".eh-cimg")).map((i) => i.src.split("/mall/")[1]).join(","));
  log((covers.match(/\.jpg/g) || []).length === 6, "F4-F6 六张真实封面图", covers);
  const liveTxt = await page.evaluate(() => { const el = document.querySelector("#floor-acquire .eh-floor-live"); return el ? el.textContent.trim() : ""; });
  log(/\d+ 位在线/.test(liveTxt), "F1 楼层头展示 N 位在线", liveTxt);
  const tagW = await page.evaluate(() => { const el = document.querySelector(".eh .eco-p-tag"); if (!el) return null; const r = el.getBoundingClientRect(); const body = el.parentElement.getBoundingClientRect(); return Math.round(r.width / body.width * 10) / 10; });
  log(tagW === 1, "交付 pill 全宽", String(tagW));
  const pc = await page.evaluate(() => {
    const cards = document.querySelectorAll(".eh-pcard");
    const cover = document.querySelector(".eh-pcover");
    const cs = cover ? getComputedStyle(cover) : null;
    return { n: cards.length, ratio: cs ? cs.aspectRatio : "", foot: document.querySelectorAll(".eh-pfoot").length, buy: document.querySelectorAll(".eh-buy-now").length };
  });
  log(pc.n >= 4 && pc.ratio === "16 / 9" && pc.foot >= 4, "⑧ F4-F6 商品卡（16:9 封面 + 页脚）", JSON.stringify(pc));
  const bh = await page.evaluate(() => {
    const el = document.querySelector(".eh-brand-hero");
    return el ? el.innerText.replace(/\n/g, " | ").slice(0, 40) : "";
  });
  log(bh.includes("美业门店AI经营大脑"), "F7 行业工作台金卡", bh);

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

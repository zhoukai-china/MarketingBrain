/**
 * 端到端验证「首席定位官商品详情页」（/agent/ipzone__ip-pos/detail，2026-09-27 第二版）。
 *
 * 本版针对用户二次反馈：返回按钮照原型改小药丸；带图区域照原型统一——
 * 头图 = 暖橙渐变画布 + 三视图切换（工作台实况 / 职业形象照(系统虚拟人头像) / 用户口碑），
 * 人物头像圈统一「橙渐变圆 + 姓氏字」。
 *
 * 纯展示页验证：真实 5174 页面渲染，不打桩任何接口。断言：
 *  1. 返回按钮为小号药丸（高 < 36px、宽 < 200px）
 *  2. 头图三视图切换：🧰 工作台实况 / 👤 职业形象照（系统 avatars 资源加载成功）/ ⭐ 用户口碑卡
 *  3. 头像圈统一：对话窗与评价区都是橙渐变+姓氏字，页面不再有 <img> 形式的头像圆
 *  4. 价格口径：99 算力；无「400 积分」残留
 *  5. 两处跳转：充值算力 → /recharge；立即使用 → workbench
 *  6. 四个 tab 可切换
 */
const puppeteer = require("puppeteer-core");
const HS =
  process.env.HOME +
  "/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell";
const APP = "http://localhost:5174/agent/ipzone__ip-pos/detail";
const SHOT_DIR = "/Users/zhoukai/code/MarketingBrain/qa-ip-pos/detail-page-20260927";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failed = 0;
function check(name, ok, extra) {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${extra ? " | " + extra : ""}`);
  if (!ok) failed++;
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: HS,
    headless: true,
    args: ["--no-sandbox", "--disable-gpu"]
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  const consoleErrors = [];
  page.on("pageerror", (e) => consoleErrors.push(String(e)));

  await page.goto(APP, { waitUntil: "networkidle2", timeout: 30000 });
  await page.waitForSelector(".ipd-page", { timeout: 15000 });
  await sleep(600);

  const read = await page.evaluate(() => {
    const t = (sel) => document.querySelector(sel)?.textContent.replace(/\s+/g, " ").trim() ?? null;
    const back = document.querySelector(".ipd-back");
    const backRect = back ? back.getBoundingClientRect() : null;
    const backStyle = back ? getComputedStyle(back) : null;
    const bodyText = document.body.innerText;
    const ctaButtons = [...document.querySelectorAll(".ipd-cta-row .ipd-btn")].map((b) => ({
      text: b.textContent.trim(),
      cls: b.className
    }));
    return {
      backRect: backRect ? { w: Math.round(backRect.width), h: Math.round(backRect.height) } : null,
      backDisplay: backStyle ? backStyle.display : null,
      wbUrl: t(".ipd-wb-url"),
      live: t(".ipd-live"),
      title: t(".ipd-title"),
      priceNum: t(".ipd-num"),
      priceUnit: t(".ipd-unit"),
      genBtn: t(".ipd-gen"),
      deliverCount: document.querySelectorAll(".ipd-deliver li").length,
      ctaButtons,
      afterCta: t(".ipd-after-cta"),
      chatAvatars: [...document.querySelectorAll(".ipd-wb-av")].map((e) => e.textContent.trim()),
      has400: /400\s*积分/.test(bodyText),
      tabs: [...document.querySelectorAll(".ipd-tab")].map((b) => b.textContent.trim()),
      cap: t(".ipd-gcap"),
      imgAvatarCircles: document.querySelectorAll("img.ipd-wb-av, img.ipd-rev-ava").length
    };
  });

  // ---- 返回按钮：小号药丸 ----
  check("返回按钮尺寸（高<36 宽<200）", !!read.backRect && read.backRect.h < 36 && read.backRect.w < 200,
    read.backRect ? `${read.backRect.w}x${read.backRect.h}` : "null");
  // .app-wrap 是纵向 flex 容器，子项 inline-flex 会被规范块级化为 flex（视觉等价）；
  // 防拉伸靠 align-self:flex-start，上面的尺寸断言（93x31 量级）才是关键。
  check("返回按钮防拉伸（display 为 flex/inline-flex 且尺寸已验）",
    read.backDisplay === "flex" || read.backDisplay === "inline-flex", read.backDisplay ?? "null");

  // ---- 头图默认视图：工作台实况 ----
  check("工作台地址渲染", (read.wbUrl ?? "").includes("ipzone__ip-pos/workbench"), read.wbUrl ?? "null");
  check("窗口栏状态徽标（6 步访谈）", (read.live ?? "").includes("6 步访谈"), read.live ?? "null");
  check("标题渲染", (read.title ?? "").includes("沈定 · 首席定位官"), read.title ?? "null");
  check("头图说明（默认=工作台实况）", (read.cap ?? "").includes("工作台实况"), read.cap ?? "null");

  // ---- 头像圈统一：对话窗/评价区都是渐变+姓氏字，没有 img 头像圆 ----
  check("对话窗头像圈=「沈」字渐变圆", read.chatAvatars.length >= 1 && read.chatAvatars.every((a) => a === "沈"),
    JSON.stringify(read.chatAvatars));
  check("无 img 形式头像圆（统一由职业形象照视图承担照片）", read.imgAvatarCircles === 0, String(read.imgAvatarCircles));

  // ---- 价格口径 ----
  check("价格数字 99", read.priceNum === "99", read.priceNum ?? "null");
  check("价格单位 算力/份", (read.priceUnit ?? "").includes("算力"), read.priceUnit ?? "null");
  check("生成按钮 99 算力", (read.genBtn ?? "").includes("99 算力"), read.genBtn ?? "null");
  check("无「400 积分」残留", !read.has400);
  check("本单交付 3 条", read.deliverCount === 3, String(read.deliverCount));

  // ---- CTA ----
  const ghost = read.ctaButtons.find((b) => b.cls.includes("ghost"));
  const main = read.ctaButtons.find((b) => b.cls.includes("main"));
  check("充值算力按钮存在", !!ghost && ghost.text.includes("充值算力"), ghost ? ghost.text : "null");
  check("立即使用按钮带 99 算力", !!main && main.text.includes("立即使用") && main.text.includes("99"), main ? main.text : "null");
  check("脚注含失败不扣费", (read.afterCta ?? "").includes("失败不扣费"), read.afterCta ?? "null");
  check("四个 tab", read.tabs.length === 4 && read.tabs.join(",") === "能力清单,交付标准,工作台实拍,用户评价", read.tabs.join(","));

  // ---- 头图视图切换：职业形象照（系统虚拟人头像）----
  await page.evaluate(() => document.querySelector('.ipd-gthumbs button[title*="职业形象照"]').click());
  await sleep(400);
  const photo = await page.evaluate(() => {
    const img = document.querySelector(".ipd-photo");
    return {
      loaded: !!img && img.complete && img.naturalWidth > 0,
      src: img ? img.getAttribute("src") : null,
      cap: document.querySelector(".ipd-gcap")?.textContent.trim() ?? null
    };
  });
  check("职业形象照=系统虚拟人头像且加载成功", photo.loaded && /avatars\/ip-position/.test(photo.src ?? ""),
    photo.src ?? "no-img");
  check("职业形象照说明文案", (photo.cap ?? "").includes("职业形象照"), photo.cap ?? "null");
  await page.screenshot({ path: SHOT_DIR + "/detail-view-photo.png" });

  // ---- 头图视图切换：用户口碑 ----
  await page.evaluate(() => document.querySelector('.ipd-gthumbs button[title="用户口碑"]').click());
  await sleep(300);
  const rate = await page.evaluate(() => {
    const g = document.querySelector(".ipd-grate");
    const st = g ? getComputedStyle(g) : null;
    return {
      text: g?.textContent.replace(/\s+/g, " ").trim() ?? null,
      bg: st ? st.backgroundImage || st.backgroundColor : null,
      cap: document.querySelector(".ipd-gcap")?.textContent.trim() ?? null
    };
  });
  check("用户口碑卡渲染（4.9 + 好评率）", !!rate.text && rate.text.includes("4.9") && rate.text.includes("好评率 98%"), rate.text ?? "null");
  check("用户口碑卡在渐变画布上", !!rate.bg && rate.bg !== "rgba(0, 0, 0, 0)", (rate.bg ?? "").slice(0, 60));
  check("口碑视图说明文案", (rate.cap ?? "").includes("用户口碑"), rate.cap ?? "null");

  // ---- tab 切换 + 实拍面板头像圈统一 ----
  await page.evaluate(() => [...document.querySelectorAll(".ipd-tab")].find((b) => b.textContent.includes("工作台实拍")).click());
  await sleep(250);
  const shots = await page.evaluate(() => ({
    n: document.querySelectorAll(".ipd-shot").length,
    avatars: [...document.querySelectorAll(".ipd-shot .ipd-wb-av")].map((e) => e.textContent.trim()),
    bars: [...document.querySelectorAll(".ipd-shot .ipd-live")].map((e) => e.textContent.trim())
  }));
  check("工作台实拍 3 块", shots.n === 3, String(shots.n));
  check("实拍面板头像圈同为「沈」", shots.avatars.length === 2 && shots.avatars.every((a) => a === "沈"),
    JSON.stringify(shots.avatars));
  check("实拍窗口栏状态随场景变", shots.bars.join("|").includes("简报确认") && shots.bars.join("|").includes("全案交付"),
    shots.bars.join(" | "));

  await page.evaluate(() => [...document.querySelectorAll(".ipd-tab")].find((b) => b.textContent.includes("用户评价")).click());
  await sleep(250);
  const revs = await page.evaluate(() => ({
    n: document.querySelectorAll(".ipd-rev").length,
    avas: [...document.querySelectorAll(".ipd-rev-ava")].map((e) => e.textContent.trim()),
    bg: document.querySelector(".ipd-rev-ava") ? getComputedStyle(document.querySelector(".ipd-rev-ava")).backgroundImage : null
  }));
  check("用户评价 2 条", revs.n === 2, String(revs.n));
  check("评价头像圈同为渐变+姓氏字", revs.avas.join(",") === "王,李" && /gradient/.test(revs.bg ?? ""), revs.avas.join(","));

  await page.evaluate(() => [...document.querySelectorAll(".ipd-tab")].find((b) => b.textContent.includes("能力清单")).click());
  await sleep(200);
  await page.evaluate(() => document.querySelector('.ipd-gthumbs button[title="工作台实况"]').click());
  await sleep(300);
  await page.screenshot({ path: SHOT_DIR + "/detail-default.png", fullPage: true });

  // ---- 跳转①：充值算力 → /recharge ----
  await page.click(".ipd-cta-row .ipd-btn.ghost");
  await sleep(1200);
  check("充值算力 → /recharge", page.url().includes("/recharge"), page.url());

  // ---- 跳转②：立即使用 → workbench ----
  await page.goto(APP, { waitUntil: "networkidle2", timeout: 30000 });
  await page.waitForSelector(".ipd-cta-row .ipd-btn.main", { timeout: 15000 });
  await sleep(400);
  await page.click(".ipd-cta-row .ipd-btn.main");
  await sleep(1500);
  check("立即使用 → workbench", /\/agent\/ipzone__ip-pos\/workbench\/?$/.test(new URL(page.url()).pathname), page.url());

  check("无页面 JS 异常", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" || "));

  await browser.close();
  console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => {
  console.error("E2E crashed:", e);
  process.exit(1);
});

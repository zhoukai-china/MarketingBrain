// 三件套验收：B 首页（浅色/Hero/邀约/案例流/TabBar/弹层）+ C 详情页×3（预约收口）+ D 预警
const puppeteer = require("/Users/zhoukai/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core");
const HS = process.env.HOME + "/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell";
let pass = 0, fail = 0;
const log = (ok, name) => { ok ? pass++ : fail++; console.log((ok ? "✅" : "❌") + " " + name); };
(async () => {
  const browser = await puppeteer.launch({ executablePath: HS, headless: true, args: ["--no-sandbox"] });

  // ---- B 首页 ----
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 1100 });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto("http://localhost:5174/agents", { waitUntil: "networkidle2", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 1500));
    const text = await page.evaluate(() => document.body.innerText);
    const light = await page.evaluate(() => getComputedStyle(document.querySelector(".eco-light")).backgroundColor);
    log(light === "rgb(246, 247, 249)", "首页浅色化生效（#f6f7f9）", light);
    log(text.includes("你好，我是 AI 管家小潼"), "Hero 小潼问候");
    log(text.includes("免费开通 · 立送 100 算力"), "Hero 主 CTA（免费开通送 100）");
    log(text.includes("1 元 = 10 算力 · 0 元开通 · 用后扣费 · 失败不扣"), "Hero 计费口径行");
    log(text.includes("邀约有礼 · 各得 100 算力"), "广告位换邀约有礼");
    log(text.includes("AI 案例") && text.includes("到店转化 21% → 34%"), "AI 案例信息流楼层");
    log(text.includes("演示数据虚构"), "案例虚构口径标注");
    const tabbar = await page.evaluate(() => {
      const el = document.querySelector(".eco-tabbar");
      return el ? Array.from(el.querySelectorAll(".eco-tb-item span:last-child")).map((s) => s.textContent.trim()).join("|") : "";
    });
    log(tabbar.includes("首页") && tabbar.includes("AI案例") && tabbar.includes("购物车") && tabbar.includes("我的") && tabbar.includes("我的算力"), "底部 TabBar 五格", tabbar);
    // 签到弹层
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent.includes("新手帮助"));
      // 先验证词典弹层
      if (btn) btn.click();
    });
    await new Promise((r) => setTimeout(r, 400));
    let t2 = await page.evaluate(() => document.body.innerText);
    log(t2.includes("术语词典") && t2.includes("以前叫「积分」"), "新手词典弹层（积分=旧称口径）");
    await page.evaluate(() => {
      const x = Array.from(document.querySelectorAll(".eco-modal-x")).find((b) => b.offsetParent);
      if (x) x.click();
    });
    // 邀请弹层（Hero CTA 打开）
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent.includes("免费开通"));
      if (btn) btn.click();
    });
    await new Promise((r) => setTimeout(r, 400));
    t2 = await page.evaluate(() => document.body.innerText);
    log(t2.includes("好友注册立得") && t2.includes("好友消耗满 50 你得"), "邀请弹层（各得 100 规则）");
    log(errors.length === 0, "首页无 JS 异常");
    await page.screenshot({ path: __dirname + "/home-v328.png" });
    await page.close();
  }

  // ---- C 许复详情页 + 预约 ----
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 1100 });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto("http://localhost:5174/agent/ipzone__liverev/detail", { waitUntil: "networkidle2", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 1500));
    let text = await page.evaluate(() => document.body.innerText);
    log(text.includes("许复 · 直播复盘官"), "许复详情页标题");
    log(text.includes("打磨中 · 支持预约"), "未上线徽标（打磨中·支持预约）");
    log(text.includes("复盘只对数据说话"), "许复简介（只对数据说话）");
    log(text.includes("50") && text.includes("算力 /场") || text.includes("50 算力/场"), "许复目录价 50/场");
    log(text.includes("📲 预约体验"), "CTA 预约体验");
    // 预约弹窗
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent.includes("预约体验"));
      if (btn) btn.click();
    });
    await new Promise((r) => setTimeout(r, 400));
    text = await page.evaluate(() => document.body.innerText);
    log(text.includes("预约「许复 · 直播复盘官」"), "预约弹窗表单态");
    await page.type(".ipd-book input", "13800001234");
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll(".ipd-book button")).find((b) => b.textContent.includes("确认预约"));
      if (btn) btn.click();
    });
    await new Promise((r) => setTimeout(r, 400));
    text = await page.evaluate(() => document.body.innerText);
    log(text.includes("预约成功"), "预约成功态");
    log(errors.length === 0, "许复页无 JS 异常");
    await page.screenshot({ path: __dirname + "/liverev-detail.png" });
    await page.close();
  }

  // ---- C 易成/周域路由 ----
  for (const [url, name] of [["http://localhost:5174/agent/ipzone__sales/detail", "易成 · 销售专家"], ["http://localhost:5174/agent/ipzone__moments/detail", "周域 · 私域营销官"]]) {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 1200));
    const text = await page.evaluate(() => document.body.innerText);
    log(text.includes(name), name + " 详情页路由");
    await page.close();
  }

  // ---- D 余额预警（低余额用户才显示；无登录时验证横幅存在） ----
  {
    const page = await browser.newPage();
    await page.goto("http://localhost:5174/agent/ipzone__copy/detail", { waitUntil: "networkidle2", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 1200));
    const banner = await page.evaluate(() => {
      const el = document.querySelector(".shared-banner");
      return el ? el.className + "|" + el.textContent.slice(0, 30) : "N/A";
    });
    log(banner !== "N/A", "shared-banner 横幅存在", banner);
    await page.close();
  }

  await browser.close();
  console.log("PASS " + pass + " / FAIL " + fail);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => { console.error("ERR:", e.message); process.exit(1); });

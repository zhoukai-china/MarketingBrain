// 直播话术师详情页验收（/agent/ipzone__livescript/detail）
// 断言：内容照原型（罗盘）、头像走系统 live-host、计费口径（固定价一口价·积分·失败不扣费，
// 无演示价 50 算力残留）、两处跳转实测（/recharge 与 livescript 工作台）、四 tab 切换、无 JS 异常。
const puppeteer = require("puppeteer-core");
const HS = process.env.HOME + "/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell";

const URL = "http://localhost:5174/agent/ipzone__livescript/detail";
let pass = 0, fail = 0;
const log = (ok, name, extra = "") => { ok ? pass++ : fail++; console.log(`${ok ? "✅" : "❌"} ${name}${extra ? " · " + extra : ""}`); };

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
    req.continue();
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

  await page.goto(URL, { waitUntil: "networkidle2" });
  await page.waitForSelector(".ipd-page", { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 700));

  // 1) 内容
  const root = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " "));
  log(/罗盘 · 直播话术师/.test(root), "标题=「罗盘 · 直播话术师」");
  log(/已上线 · 可直接对话/.test(root), "状态徽标");
  log(/时间轴逐字稿可照读/.test(root) && /一场只主推一个转化动作/.test(root), "简介含逐字稿+单动作口径");
  log(/4\.9/.test(root) && /好评率 97%/.test(root), "评分 4.9 / 好评率 97%（原型口径）");
  log(/按场次类型分流：招商加盟 \/ 带货 \/ 知识付费，两套打法不串场/.test(root), "能力清单照原型");
  log(/失败不扣费/.test(root), "「失败不扣费」保留");
  log(/整场脚本包：开场 \/ 留人 \/ 塑品 \/ 逼单 \/ 下播分区/.test(root), "本单交付含整场脚本包");

  // 2) 计费口径：固定价一口价、积分；无演示价 50 算力
  log(/200 积分 \/ 场|200\s*积分/.test(root), "价格来自真实目录 ppu=200 积分", (root.match(/\d+ 积分 \/ 场/) || [""])[0]);
  log(/一口价/.test(root), "标注「一口价」（FIXED_PRICE_SKUS）");
  log(!/50 算力/.test(root), "无原型演示价（50 算力）残留");
  log(!/按本次实际用量结算/.test(root), "固定价 SKU 不写「按实际用量结算」");
  log(/1 元 = 10 算力/.test(root), "平台兑换率说明保留");

  // 3) 头图三视图
  const wb = await page.evaluate(() => ({
    brief: document.querySelector(".ipd-brief-h")?.textContent?.replace(/\s+/g, " ") || "",
    fields: [...document.querySelectorAll(".ipd-brief-grid .ipd-bf")].map((e) => e.textContent.trim()),
    gen: document.querySelector(".ipd-gen")?.textContent || "",
    url: document.querySelector(".ipd-wb-url")?.textContent || "",
  }));
  log(/4\/6/.test(wb.brief) && wb.fields.length === 6 && wb.fields[0].includes("场次类型") && wb.fields[4].includes("场次时长"), "头图简报 6 字段与真实工作台同口径 4/6", wb.brief);
  log(/生成脚本包/.test(wb.gen), "生成按钮与真实工作台一致", wb.gen);
  log(/ipzone__livescript\/workbench/.test(wb.url), "窗口栏指向直播话术工作台地址（真实 sku）");
  await page.click(".ipd-gthumbs button:nth-child(2)");
  await new Promise((r) => setTimeout(r, 300));
  const photo = await page.evaluate(() => ({
    src: document.querySelector(".ipd-photo")?.getAttribute("src") || "",
    ok: (() => { const img = document.querySelector(".ipd-photo"); return img ? img.naturalWidth > 0 : false; })(),
  }));
  log(/live-host/.test(photo.src), "职业形象照走系统 live-host 形象", photo.src);
  log(photo.ok, "头像图片实际加载成功");
  await page.click(".ipd-gthumbs button:nth-child(3)");
  await new Promise((r) => setTimeout(r, 300));
  const rate = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " "));
  log(/100\+ 场直播使用/.test(rate), "口碑视图（100+ 场直播使用）");

  // 4) 四 tab 切换
  await page.click(".ipd-gthumbs button:nth-child(1)");
  for (const label of ["交付标准", "工作台实拍", "用户评价", "能力清单"]) {
    await page.evaluate((l) => {
      const t = [...document.querySelectorAll(".ipd-tab")].find((b) => b.textContent.trim() === l);
      t && t.click();
    }, label);
    await new Promise((r) => setTimeout(r, 250));
    const txt = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " "));
    if (label === "工作台实拍") {
      const shots = await page.evaluate(() => document.querySelectorAll(".ipd-shot").length);
      log(shots === 3, "实拍 3 段（开播引导/简报确认/逐字稿交付）", "shots=" + shots);
      const zones = await page.evaluate(() => [...document.querySelectorAll(".ipd-zone-h")].map((e) => e.textContent.trim()));
      log(zones.length === 4 && zones.some((z) => z.includes("开场留人")) && zones.some((z) => z.includes("收尾下播")), "时间轴 4 段（开场→收尾）", zones.join("|"));
    } else if (label === "用户评价") {
      const revs = await page.evaluate(() => document.querySelectorAll(".ipd-rev").length);
      log(revs === 2 && /郑总/.test(txt) && /楠楠/.test(txt), "用户评价 2 条（郑总/楠楠，原型口径）");
    } else if (label === "交付标准") {
      log(/整场脚本包/.test(txt) && /每 20 分钟一浪/.test(txt), "交付标准（整场脚本包 + 节奏表口径）");
    } else {
      log(/能力清单/.test(txt), `${label} tab 渲染`);
    }
  }

  // 5) 跳转实测：充值算力 → /recharge
  await page.click(".ipd-cta-row .ipd-btn.ghost");
  await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }).catch(() => {});
  log(page.url().includes("/recharge"), "「⚡ 充值算力」实测落地 /recharge", page.url());

  // 6) 跳转实测：立即使用 → livescript 工作台
  await page.goto(URL, { waitUntil: "networkidle2" });
  await page.waitForSelector(".ipd-cta-row .ipd-btn.main", { timeout: 10000 });
  await page.click(".ipd-cta-row .ipd-btn.main");
  await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }).catch(() => {});
  log(page.url().includes("/agent/ipzone__livescript/workbench"), "「⚡ 立即使用」实测落地直播话术工作台", page.url());

  // 7) 无 JS 异常
  log(errors.length === 0, "无 JS 运行时异常", errors.slice(0, 2).join(" | "));

  await browser.close();
  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });

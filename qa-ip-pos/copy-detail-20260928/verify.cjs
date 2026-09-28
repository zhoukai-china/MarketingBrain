// 金牌文案主笔详情页验收（/agent/ipzone__copy/detail）
// 断言：内容照原型（秦文）、头像走系统 copywriter、计费口径（积分/按实际用量结算/失败不扣费，
// 无演示价 10/15/99 算力残留）、两处跳转实测（/recharge 与文案工作台）、四 tab 切换、无 JS 异常。
const puppeteer = require("puppeteer-core");
const HS = process.env.HOME + "/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell";

const URL = "http://localhost:5174/agent/ipzone__copy/detail";
let pass = 0, fail = 0;
const log = (ok, name, extra = "") => { ok ? pass++ : fail++; console.log(`${ok ? "✅" : "❌"} ${name}${extra ? " · " + extra : ""}`); };

(async () => {
  const browser = await puppeteer.launch({ executablePath: HS, headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 1100 });
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const u = req.url();
    // 目录价打桩（ipzone__copy ppu=40），其余放行
    if (u.includes("/market/skus") && !u.includes("/run") && !u.includes("/access") && req.method() === "GET") {
      return req.respond({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ skus: [{ skuCode: "ipzone__copy", name: "文案智能体", ppu: 40, status: "selling" }] }) });
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
  log(/秦文 · 金牌文案主笔/.test(root), "标题=「秦文 · 金牌文案主笔」");
  log(/已上线 · 可直接对话/.test(root), "状态徽标");
  log(/把这条文案的信息一次配齐/.test(root) && /内容十件套/.test(root), "简介含十件套交付口径");
  log(/4\.9/.test(root) && /好评率 96%/.test(root), "评分 4.9 / 好评率 96%（原型口径）");
  log(/6 问引导简报/.test(root) && /一次只问一个问题/.test(root), "能力清单照原型");
  log(/失败不扣费/.test(root), "「失败不扣费」保留（原型同款）");
  log(/多平台适配（抖音 \/ 视频号 \/ 小红书）/.test(root), "本单交付含多平台适配");

  // 2) 计费口径：真实 ppu、积分、按实际用量结算；无演示价残留
  log(/40 积分 \/ 次 起|40\s*积分/.test(root), "价格来自真实目录 ppu=40 积分", (root.match(/[^ ]*积分 \/ 次 起/) || [""])[0]);
  log(/按实际用量结算/.test(root), "标注「按实际用量结算」");
  log(!/15 算力|99 算力|10 算力\/条|10 算力起|轻量 10 算力|打包 10 算力/.test(root), "无原型演示价（10/15/99 算力）残留（平台兑换率除外）");
  log(/1 元 = 10 算力/.test(root), "平台兑换率说明保留");

  // 3) 头图三视图：工作台实况（简报 6 字段 5/6）→ 职业形象照（系统头像）→ 用户口碑
  const wb = await page.evaluate(() => ({
    brief: document.querySelector(".ipd-brief-h b")?.textContent || "",
    fields: [...document.querySelectorAll(".ipd-brief-grid .ipd-bf")].map((e) => e.textContent.trim()),
    gen: document.querySelector(".ipd-gen")?.textContent || "",
    url: document.querySelector(".ipd-wb-url")?.textContent || "",
  }));
  log(wb.brief === "5/6" && wb.fields.length === 6 && wb.fields[0].includes("产品") && wb.fields[5].includes("出镜"), "头图简报 6 字段（产品…出镜）5/6", wb.brief);
  log(/生成内容十件套/.test(wb.gen), "生成按钮与真实工作台一致", wb.gen);
  log(/ipzone__copy\/workbench/.test(wb.url), "窗口栏指向文案工作台地址");
  await page.click(".ipd-gthumbs button:nth-child(2)");
  await new Promise((r) => setTimeout(r, 300));
  const photo = await page.evaluate(() => ({
    src: document.querySelector(".ipd-photo")?.getAttribute("src") || "",
    ok: (() => { const img = document.querySelector(".ipd-photo"); return img ? img.naturalWidth > 0 : false; })(),
  }));
  log(/copywriter/.test(photo.src), "职业形象照走系统 copywriter 形象", photo.src);
  log(photo.ok, "头像图片实际加载成功");
  await page.click(".ipd-gthumbs button:nth-child(3)");
  await new Promise((r) => setTimeout(r, 300));
  const rate = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " "));
  log(/300\+ 位老板使用/.test(rate), "口碑视图（300+ 位老板使用）");

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
      log(shots === 3, "实拍 3 段（引导问答/简报确认/已交付）", "shots=" + shots);
      const zones = await page.evaluate(() => [...document.querySelectorAll(".ipd-zone-h")].map((e) => e.textContent.trim()));
      log(zones.length === 5 && zones.some((z) => z.includes("策划区")) && zones.some((z) => z.includes("投流区")), "交付分区 5 区（与工作台 10 件同口径）", zones.join("|"));
    } else if (label === "用户评价") {
      const revs = await page.evaluate(() => document.querySelectorAll(".ipd-rev").length);
      log(revs === 2 && /陈姐/.test(txt) && /周老板/.test(txt), "用户评价 2 条（陈姐/周老板，原型口径）");
    } else if (label === "交付标准") {
      log(/交付口径/.test(txt) && /先看简报再创作/.test(txt), "交付标准 tab 照原型（过程口径：先看简报再创作）");
    } else {
      log(/能力清单/.test(txt), `${label} tab 渲染`);
    }
  }

  // 5) 跳转实测：充值算力 → /recharge
  await page.click(".ipd-cta-row .ipd-btn.ghost");
  await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }).catch(() => {});
  log(page.url().includes("/recharge"), "「⚡ 充值算力」实测落地 /recharge", page.url());

  // 6) 跳转实测：立即使用 → 文案工作台
  await page.goto(URL, { waitUntil: "networkidle2" });
  await page.waitForSelector(".ipd-cta-row .ipd-btn.main", { timeout: 10000 });
  await page.click(".ipd-cta-row .ipd-btn.main");
  await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }).catch(() => {});
  log(page.url().includes("/agent/ipzone__copy/workbench"), "「⚡ 立即使用」实测落地文案工作台", page.url());

  // 7) 无 JS 异常（回详情页采样）
  log(errors.length === 0, "无 JS 运行时异常", errors.slice(0, 2).join(" | "));

  await browser.close();
  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });

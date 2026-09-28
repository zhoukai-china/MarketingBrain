// 视频复盘官详情页验收（/agent/ipzone__vidrev/detail）
// 断言：内容照原型（江流）、头像走系统 video-diag、计费口径（积分/按实际用量结算/体检免费/失败不扣费，
// 无演示价 50 算力残留）、两处跳转实测（/recharge 与 vidrev 工作台）、四 tab 切换、无 JS 异常。
const puppeteer = require("puppeteer-core");
const HS = process.env.HOME + "/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell";

const URL = "http://localhost:5174/agent/ipzone__vidrev/detail";
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
      return req.respond({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ skus: [{ skuCode: "ipzone__vidrev", name: "视频复盘智能体", ppu: 100, status: "selling" }] }) });
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
  log(/江流 · 视频复盘官/.test(root), "标题=「江流 · 视频复盘官」");
  log(/已上线 · 可直接对话/.test(root), "状态徽标");
  log(/先体检、再复盘/.test(root) && /加投 \/ 止损 \/ 迭代 \/ 复制/.test(root), "简介含体检+四象限口径");
  log(/4\.9/.test(root) && /好评率 96%/.test(root), "评分 4.9 / 好评率 96%（原型口径）");
  log(/拖表上传：抖音「作品明细」\/ 视频号导出表直接拖进来就能跑/.test(root), "能力清单照原型");
  log(/失败不扣费/.test(root) && /上传体检不扣算力/.test(root), "「体检免费 / 失败不扣费」保留");
  log(/四象限分层：又爆而赚 · 爆而不赚 · 赚而不爆 · 不爆不赚/.test(root), "本单交付含四象限分层");

  // 2) 计费口径：真实 ppu、积分、按实际用量结算；无演示价 50 算力
  log(/100 积分 \/ 次 起|100\s*积分/.test(root), "价格来自真实目录 ppu=100 积分", (root.match(/\d+ 积分 \/ 次 起/) || [""])[0]);
  log(/按实际用量结算/.test(root), "标注「按实际用量结算」");
  log(!/50 算力/.test(root), "无原型演示价（50 算力）残留");
  log(/1 元 = 10 算力/.test(root), "平台兑换率说明保留");

  // 3) 头图三视图
  const wb = await page.evaluate(() => ({
    health: document.querySelector(".ipd-brief-h")?.textContent?.replace(/\s+/g, " ") || "",
    chips: [...document.querySelectorAll(".ipd-brief-grid .ipd-bf")].map((e) => e.textContent.trim()),
    gen: document.querySelector(".ipd-gen")?.textContent || "",
    url: document.querySelector(".ipd-wb-url")?.textContent || "",
  }));
  log(/7 项 · 2 警告/.test(wb.health), "头图体检面板=7 项 · 2 警告（演示态）", wb.health);
  log(wb.chips.length === 7 && wb.chips.some((c) => c.includes("成交") && c.includes("⚠️")), "体检 7 项 chips（成交 ⚠️）", wb.chips.length + "");
  log(/生成复盘报告/.test(wb.gen), "生成按钮与真实工作台一致", wb.gen);
  log(/ipzone__vidrev\/workbench/.test(wb.url), "窗口栏指向视频复盘工作台地址");
  await page.click(".ipd-gthumbs button:nth-child(2)");
  await new Promise((r) => setTimeout(r, 300));
  const photo = await page.evaluate(() => ({
    src: document.querySelector(".ipd-photo")?.getAttribute("src") || "",
    ok: (() => { const img = document.querySelector(".ipd-photo"); return img ? img.naturalWidth > 0 : false; })(),
  }));
  log(/video-diag/.test(photo.src), "职业形象照走系统 video-diag 形象", photo.src);
  log(photo.ok, "头像图片实际加载成功");
  await page.click(".ipd-gthumbs button:nth-child(3)");
  await new Promise((r) => setTimeout(r, 300));
  const rate = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " "));
  log(/复盘视频 500\+ 条/.test(rate), "口碑视图（复盘视频 500+ 条）");

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
      log(shots === 3, "实拍 3 段（上传体检/口径确认/四象限交付）", "shots=" + shots);
      const zones = await page.evaluate(() => [...document.querySelectorAll(".ipd-zone-h")].map((e) => e.textContent.trim()));
      log(zones.length === 4 && zones.some((z) => z.includes("加投")) && zones.some((z) => z.includes("迭代")), "四象限 4 卡（加投/止损/复制/迭代）", zones.join("|"));
    } else if (label === "用户评价") {
      const revs = await page.evaluate(() => document.querySelectorAll(".ipd-rev").length);
      log(revs === 2 && /谭总/.test(txt) && /池经理/.test(txt), "用户评价 2 条（谭总/池经理，原型原文）");
    } else if (label === "交付标准") {
      log(/11 章/.test(txt) && /按天汇总表拒收/.test(txt), "交付标准（11 章口径 + 按天汇总拒收）");
    } else {
      log(/能力清单/.test(txt), `${label} tab 渲染`);
    }
  }

  // 5) 跳转实测：充值算力 → /recharge
  await page.click(".ipd-cta-row .ipd-btn.ghost");
  await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }).catch(() => {});
  log(page.url().includes("/recharge"), "「⚡ 充值算力」实测落地 /recharge", page.url());

  // 6) 跳转实测：立即使用 → vidrev 工作台
  await page.goto(URL, { waitUntil: "networkidle2" });
  await page.waitForSelector(".ipd-cta-row .ipd-btn.main", { timeout: 10000 });
  await page.click(".ipd-cta-row .ipd-btn.main");
  await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }).catch(() => {});
  log(page.url().includes("/agent/ipzone__vidrev/workbench"), "「⚡ 立即使用」实测落地视频复盘工作台", page.url());

  // 7) 无 JS 异常
  log(errors.length === 0, "无 JS 运行时异常", errors.slice(0, 2).join(" | "));

  await browser.close();
  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });

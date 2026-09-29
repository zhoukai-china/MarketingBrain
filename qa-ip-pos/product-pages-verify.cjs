// F4-F6 详情页验收（对齐原型三视图 gallery + 未上线·预约中态）
const puppeteer = require("/Users/zhoukai/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core");
const HS = process.env.HOME + "/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell";
let pass = 0, fail = 0;
const log = (ok, name, extra = "") => { ok ? pass++ : fail++; console.log((ok ? "✅" : "❌") + " " + name + (extra ? " · " + extra : "")); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const b = await puppeteer.launch({ executablePath: HS, headless: true, args: ["--no-sandbox"] });
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 900 });
  const errors = [];
  p.on("pageerror", (e) => errors.push(String(e)));

  // ① hwRec 详情
  await p.goto("http://localhost:5174/product/hwRec/detail", { waitUntil: "networkidle2", timeout: 30000 });
  await sleep(1600);
  let d = await p.evaluate(() => {
    const t = document.body.innerText;
    const tb = document.querySelector(".eh-topbar").getBoundingClientRect();
    const cover = document.querySelector(".ipd-pcover");
    return {
      title: t.includes("AI 录音卡 · 录音即分析"),
      price: t.includes("¥199") && t.includes("/台") && t.includes("预计上线价 · 不耗算力"),
      feats: document.querySelectorAll(".pd-gfeat .pf-row").length,
      cta: t.includes("预约体验 · 上线短信通知") || t.includes("预约上线提醒"),
      tabs: document.querySelectorAll(".ipd-tab").length,
      coverOk: cover && cover.getBoundingClientRect().width > 400,
      topbarX: Math.round(tb.x), topbarW: Math.round(tb.width),
      badge: document.querySelector(".eh-page-badge")?.textContent || "",
      back: document.querySelector(".eh-backpill")?.textContent || "",
      status: t.includes("未上线") && t.includes("预约中"),
      gallery: Boolean(document.querySelector(".ipd-gallery")) && document.querySelectorAll(".ipd-gthumbs button").length === 3
    };
  });
  log(d.title && d.price && d.cta, "① 录音卡内页（标题/价格/预约CTA）", JSON.stringify({ title: d.title, price: d.price }));
  log(d.coverOk, "封面真实图片渲染（.ipd-pcover）");
  log(d.tabs === 3, "三标签页（商品说明/规格参数/售后保障）", "tabs=" + d.tabs);
  log(d.gallery, "三视图 gallery（封面/特性/售后缩略图切换）");
  log(d.status, "未上线·预约中态");
  // 切到「特性」视图后再数特性行（默认是封面视图）
  await p.evaluate(() => { const btns = document.querySelectorAll(".ipd-gthumbs button"); if (btns[1]) btns[1].click(); });
  await sleep(400);
  const featCount = await p.evaluate(() => document.querySelectorAll(".pd-gfeat .pf-row").length);
  log(featCount === 4, "四个核心卖点（特性视图）", "feats=" + featCount);
  log(d.topbarX === 0 && d.topbarW === 1440, "顶栏顶格（同工作台规格）", `${d.topbarX}/${d.topbarW}`);
  log(d.badge === "AI 录音卡 · 商品详情" && d.back === "← 返回", "统一顶栏（徽标+返回）", d.badge + " " + d.back);
  await p.screenshot({ path: __dirname + "/product-detail-hwrec.png" });

  // ② 其余 5 个内页路由冒烟
  for (const [key, name] of [["hwRobot", "门店 AI 机器人"], ["courseAgent", "智能体开发课"], ["courseWb", "WorkBuddy 办公提效课"], ["opcLlm", "大模型折扣仓"], ["opcComic", "AIGC 漫剧创作工作台"]]) {
    await p.goto(`http://localhost:5174/product/${key}/detail`, { waitUntil: "networkidle2", timeout: 30000 });
    await sleep(900);
    const t = await p.evaluate(() => document.body.innerText);
    log(t.includes(name) && t.includes("未上线 · 预约中"), "② " + name + " 内页（未上线预约态）", key);
  }

  // ③ OPC 计价口径（算力计价 + 预约态）
  // 2026-09-29（用户）：OPC 与硬件价格块样式要统一成「大数字 + 小单位」，且价格字号不能过大。
  await p.goto("http://localhost:5174/product/opcLlm/detail", { waitUntil: "networkidle2" });
  await sleep(800);
  const opc = await p.evaluate(() => document.body.innerText);
  log(opc.includes("🧪 演示商品 · 购买不入算力余额"), "③ OPC 演示注记保留");
  const opcPrice = await p.evaluate(() => {
    const num = document.querySelector(".ipd-num");
    const unit = document.querySelector(".ipd-unit");
    const numCs = num ? getComputedStyle(num).fontSize : "";
    const unitCs = unit ? getComputedStyle(unit).fontSize : "";
    return {
      num: num?.textContent?.trim() ?? "",
      unit: unit?.textContent?.trim() ?? "",
      numFont: parseFloat(numCs) || 0,
      unitFont: parseFloat(unitCs) || 0
    };
  });
  log(opcPrice.num === "50" && opcPrice.unit.includes("算力/份"), "③ 价格块拆成「大数字 + 小单位」", JSON.stringify(opcPrice));
  log(opcPrice.numFont <= 26 && opcPrice.numFont > opcPrice.unitFont, "③ 价格字号已收小（num 24 / 单位更小）", `${opcPrice.numFont}px vs ${opcPrice.unitFont}px`);
  await p.screenshot({ path: __dirname + "/product-detail-opc.png" });

  // ④ 首页卡片点击 → 内页（详情页直达，无中间弹窗）
  await p.goto("http://localhost:5174/agents", { waitUntil: "networkidle2", timeout: 30000 });
  await sleep(1800);
  await p.evaluate(() => {
    const card = Array.from(document.querySelectorAll(".eh-pcard")).find((c) => c.textContent.includes("AI 录音卡"));
    if (card) card.click();
  });
  await sleep(1600);
  log(p.url().includes("/product/hwRec/detail"), "④ 首页商品卡点击直达内页", p.url());

  log(errors.length === 0, "无 JS 异常");
  await b.close();
  console.log("PASS " + pass + " / FAIL " + fail);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => { console.error("ERR:", e.message); process.exit(1); });

const puppeteer = require("/Users/zhoukai/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core");
const HS = process.env.HOME + "/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell";
let pass = 0, fail = 0;
const log = (ok, name, extra = "") => { ok ? pass++ : fail++; console.log((ok ? "✅" : "❌") + " " + name + (extra ? " · " + extra : "")); };
(async () => {
  const b = await puppeteer.launch({ executablePath: HS, headless: true, args: ["--no-sandbox"] });
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 900 });
  const errors = [];
  p.on("pageerror", (e) => errors.push(String(e)));

  // ① hwRec 详情
  await p.goto("http://localhost:5174/product/hwRec/detail", { waitUntil: "networkidle2", timeout: 30000 });
  await new Promise((r) => setTimeout(r, 1600));
  let d = await p.evaluate(() => {
    const t = document.body.innerText;
    const tb = document.querySelector(".eh-topbar").getBoundingClientRect();
    const cover = document.querySelector(".pd-cover img");
    return {
      title: t.includes("AI 录音卡 · 录音即分析"),
      price: t.includes("¥199") && t.includes("/台") && t.includes("人民币直购 · 不耗算力"),
      feats: document.querySelectorAll(".pd-feat").length === 4,
      cta: t.includes("加入购物车") && t.includes("立即购买"),
      tabs: document.querySelectorAll(".pd-tabs details").length,
      coverOk: cover && cover.getBoundingClientRect().width > 500,
      topbarX: Math.round(tb.x), topbarW: Math.round(tb.width),
      badge: document.querySelector(".eh-page-badge")?.textContent || "",
      back: document.querySelector(".eh-backpill")?.textContent || ""
    };
  });
  log(d.title && d.price && d.feats && d.cta, "① 录音卡内页（标题/价格/四特性/双按钮）", JSON.stringify(d).slice(0, 80));
  log(d.coverOk, "封面真实图片渲染");
  log(d.tabs >= 2, "说明/保障折叠卡");
  log(d.topbarX === 0 && d.topbarW === 1440, "顶栏顶格（同工作台规格）", `${d.topbarX}/${d.topbarW}`);
  log(d.badge === "AI 录音卡 · 商品详情" && d.back === "← 返回", "统一顶栏（徽标+返回）", d.badge + " " + d.back);
  await p.screenshot({ path: __dirname + "/product-detail-hwrec.png" });

  // ② 其余 5 个内页路由冒烟
  for (const [key, name] of [["hwRobot", "门店 AI 机器人"], ["courseAgent", "智能体开发课"], ["courseWb", "WorkBuddy 办公提效课"], ["opcLlm", "大模型折扣仓"], ["opcComic", "AIGC 漫剧创作工作台"]]) {
    await p.goto(`http://localhost:5174/product/${key}/detail`, { waitUntil: "networkidle2", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 1000));
    const t = await p.evaluate(() => document.body.innerText);
    log(t.includes(name), "② " + name + " 内页", key);
  }

  // ③ OPC 演示注记
  await p.goto("http://localhost:5174/product/opcLlm/detail", { waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 800));
  const opc = await p.evaluate(() => document.body.innerText);
  log(opc.includes("50 算力/份") && opc.includes("🧪 演示商品 · 购买不入算力余额"), "③ OPC 算力计价 + 演示注记");
  await p.screenshot({ path: __dirname + "/product-detail-opc.png" });

  // ④ 首页卡片点击 → 内页
  await p.goto("http://localhost:5174/agents", { waitUntil: "networkidle2", timeout: 30000 });
  await new Promise((r) => setTimeout(r, 1800));
  await p.evaluate(() => {
    const card = Array.from(document.querySelectorAll(".eh-pcard")).find((c) => c.textContent.includes("AI 录音卡"));
    if (card) card.click();
  });
  await new Promise((r) => setTimeout(r, 1600));
  log(p.url().includes("/product/hwRec/detail"), "④ 首页商品卡点击直达内页", p.url());

  log(errors.length === 0, "无 JS 异常");
  await b.close();
  console.log("PASS " + pass + " / FAIL " + fail);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => { console.error("ERR:", e.message); process.exit(1); });

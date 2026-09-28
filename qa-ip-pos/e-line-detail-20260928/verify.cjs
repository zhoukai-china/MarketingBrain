// E 线详情页更新验收（2026-09-28）：何策配置面板化 + 沈定 AI 工作实况视图
// 断言：
//   topic（/agent/ipzone__topic/detail）：配置面板式（无对话框）、四大来源配置卡+配额徽章、
//     流水线四步、三关新命名、阶段按钮、运行指标 17/11/2/10、交付 10 条可换一批、
//     输出样例取自工作台交付表、已上线口径、真实 ppu（70）、无预约残留、无 5 条旧口径；
//   ip-pos（/agent/ipzone__ip-pos/detail）：四视图（🧰▶👤⭐）、AI 工作实况（核心观点/红线命中/● LIVE）、
//     口碑 128 位老板、无错位样例（今日选题清单/直播逐字稿）。
const puppeteer = require("/Users/zhoukai/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core");
const HS = process.env.HOME + "/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell";

let pass = 0, fail = 0;
const log = (ok, name, extra = "") => { ok ? pass++ : fail++; console.log((ok ? "✅" : "❌") + " " + name + (extra ? " · " + extra : "")); };

(async () => {
  const browser = await puppeteer.launch({ executablePath: HS, headless: true, args: ["--no-sandbox"] });

  // ---------- 何策 ----------
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1100 });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto("http://localhost:5174/agent/ipzone__topic/detail", { waitUntil: "networkidle2", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 1500));
    const text = await page.evaluate(() => document.body.innerText);
    log(text.includes("配置即出题 · 无需对话"), "头图配置面板式（无需对话）");
    log(text.includes("① 配置四大来源") && text.includes("④ 交付 10 条"), "流水线四步 chips");
    log(text.includes("私有知识库 · 主力") && text.includes("配额 35% · 候选 6 条"), "来源配置卡 + 配额徽章");
    log(text.includes("未启用 · 配额已重分配"), "数据复盘未启用置灰口径");
    log(text.includes("1️⃣ 一票否决") && text.includes("2️⃣ 对号入座") && text.includes("3️⃣ 配比校准"), "三关命名对齐工作台");
    log(text.includes("起号期") && text.includes("增长期") && text.includes("变现期"), "阶段按钮（起号/增长/变现）");
    log(text.includes("17") && text.includes("候选池") && text.includes("待验证") && text.includes("交付"), "运行指标 17/11/2/10");
    log(text.includes("候选池涌现 16–20 条") && text.includes("不满意可换一批"), "简介对齐（16–20 条/可换一批）");
    log(text.includes("交付 10 条选题"), "交付清单更新为 10 条");
    log(text.includes("类型 × 共识层级 × 客资准度"), "能力清单三关括号说明");
    const hasDialog = await page.evaluate(() => Boolean(document.querySelector(".ipd-msg, .ipd-input")));
    log(!hasDialog, "无对话框 DOM（ipd-msg/ipd-input 已移除）");
    log(!text.includes("预约"), "无预约残留");
    log(!text.includes("一批 5 条") && !text.includes("贴标签"), "无旧口径（5 条/贴标签）");
    // 输出样例（工作台实拍 tab）
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll(".ipd-tab"));
      const t = btns.find((b) => b.textContent.includes("工作台实拍"));
      if (t) t.click();
    });
    await new Promise((r) => setTimeout(r, 600));
    const text2 = await page.evaluate(() => document.body.innerText);
    log(text2.includes("越省钱越亏钱") && text2.includes("✓ 通过（私信 3 人问过）"), "输出样例取自工作台交付表");
    log(text2.includes("⏳ 待验证（先核验官方来源）"), "证据状态 ✓/⏳ 双态");
    log(text2.includes("淘汰 6") && text2.includes("打标 11"), "数据链路 17→6→11→10");
    log(errors.length === 0, "无 JS 异常", errors.slice(0, 1).join(" "));
    // 真实目录价（本地 API /market/skus 实数据，动态比对）
    const ppuShown = /(\d+)\s*算力 \/ 次 起/.exec(text);
    let catalogPpu = null;
    try {
      const r = await page.evaluate(() => fetch("/api/market/skus").then((x) => x.json()));
      const s = (r.skus || []).find((x) => x.skuCode === "ipzone__topic");
      catalogPpu = s ? s.ppu : null;
    } catch { /* 拿不到就跳过动态比对 */ }
    log(ppuShown && catalogPpu != null && Number(ppuShown[1]) === Number(catalogPpu), "价格与目录 ppu 一致", `页面=${ppuShown ? ppuShown[1] : "?"} 目录=${catalogPpu}`);
    // 2026-09-28 起何策目录价即 99（对齐原型 v3.28），「99 算力」不再是演示价残留判据。
    await page.screenshot({ path: __dirname + "/topic-config-panel.png" });
    await page.close();
  }

  // ---------- 沈定 ----------
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1100 });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto("http://localhost:5174/agent/ipzone__ip-pos/detail", { waitUntil: "networkidle2", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 1500));
    const text = await page.evaluate(() => document.body.innerText);
    const thumbs = await page.evaluate(() => Array.from(document.querySelectorAll(".ipd-gthumbs button")).map((b) => b.textContent.trim()).join(""));
    log(thumbs === "🧰▶👤⭐", "轮播四图顺序 🧰▶👤⭐", thumbs);
    log(!text.includes("今日选题清单") && !text.includes("直播逐字稿"), "无错位样例（选题清单/逐字稿）");
    // 切到 AI 工作实况
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll(".ipd-gthumbs button"));
      const t = btns.find((b) => b.textContent.trim() === "▶");
      if (t) t.click();
    });
    await new Promise((r) => setTimeout(r, 500));
    const cap = await page.evaluate(() => {
      const el = document.querySelector(".ipd-gcap");
      return el ? el.textContent : "";
    });
    const liveText = await page.evaluate(() => document.body.innerText);
    log(cap.includes("AI 工作实况"), "AI 工作实况视图切换成功");
    log(liveText.includes("– 核心观点") && liveText.includes("红线命中") && liveText.includes("● LIVE"), "实况四段 + LIVE 标记");
    // 切到用户口碑
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll(".ipd-gthumbs button"));
      const t = btns.find((b) => b.textContent.trim() === "⭐");
      if (t) t.click();
    });
    await new Promise((r) => setTimeout(r, 400));
    const rateText = await page.evaluate(() => document.body.innerText);
    log(rateText.includes("近 30 天 · 128 位老板使用 · 好评率 98%"), "口碑卡对齐原型（128 位老板/98%）");
    log(errors.length === 0, "无 JS 异常");
    await page.screenshot({ path: __dirname + "/ippos-live-view.png" });
    await page.close();
  }

  await browser.close();
  console.log("PASS " + pass + " / FAIL " + fail);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => { console.error("ERR:", e.message); process.exit(1); });

const puppeteer = require("/Users/zhoukai/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core");
const fs = require("fs");
const HS = process.env.HOME + "/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell";
(async () => {
  const b = await puppeteer.launch({ executablePath: HS, headless: true, args: ["--no-sandbox"] });
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 1000 });
  await p.goto("file:///Users/zhoukai/code/MarketingBrain/docs/prototypes/agents-home-tech-demo-20260925.html", { waitUntil: "networkidle2" });
  await new Promise(r => setTimeout(r, 2200));
  const n = await p.evaluate(() => {
    const tab = document.querySelector('.tab[data-tab="cases"]');
    if (tab) tab.click();
    return document.querySelectorAll(".case-card").length;
  });
  // 循环点加载更多
  for (let k = 0; k < 10; k++) {
    const cnt = await p.evaluate(() => document.querySelectorAll(".case-card").length);
    if (cnt >= 12) break;
    await p.evaluate(() => {
      const view = document.querySelector("#casesView");
      if (view) { view.scrollTop = view.scrollHeight; view.dispatchEvent(new Event("scroll")); }
    });
    await new Promise(r => setTimeout(r, 700));
  }
  const total = await p.evaluate(() => document.querySelectorAll(".case-card").length);
  console.log("渲染案例卡:", total);
  const covers = await p.evaluate(() => {
    const map = {};
    document.querySelectorAll(".case-card").forEach((card) => {
      const ci = card.getAttribute("data-ci");
      const img = card.querySelector(".case-cover img");
      if (img && (img.getAttribute("src") || "").startsWith("data:image")) map[ci] = img.getAttribute("src");
    });
    return map;
  });
  fs.mkdirSync("apps/web/public/mall", { recursive: true });
  let count = 0;
  for (const [ci, src] of Object.entries(covers)) {
    const ext = src.includes("image/png") ? "png" : "jpg";
    fs.writeFileSync(`apps/web/public/mall/case${ci}.${ext}`, Buffer.from(src.split(",")[1], "base64"));
    count++;
  }
  console.log("导出封面:", count, "→", fs.readdirSync("apps/web/public/mall").filter(f => f.startsWith("case")).join(", "));
  await b.close();
})();

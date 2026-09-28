const puppeteer = require("/Users/zhoukai/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core");
const fs = require("fs");
const HS = process.env.HOME + "/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell";
(async () => {
  const b = await puppeteer.launch({ executablePath: HS, headless: true, args: ["--no-sandbox"] });
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 1000 });
  await p.goto("file:///Users/zhoukai/code/MarketingBrain/docs/prototypes/agents-home-tech-demo-20260925.html", { waitUntil: "networkidle2" });
  await new Promise(r => setTimeout(r, 2500));
  await p.evaluate(() => { const t = document.querySelector('.tab[data-tab="cases"]'); if (t) t.click(); });
  await new Promise(r => setTimeout(r, 1500));
  const data = await p.evaluate(() => {
    const cards = Array.from(document.querySelectorAll(".case-card"));
    return cards.map((card, i) => {
      const g = (sel) => { const el = card.querySelector(sel); return el ? el.textContent.trim() : ""; };
      const metrics = Array.from(card.querySelectorAll(".case-metric")).map(m => ({ k: m.querySelector(".k")?.textContent.trim() || "", v: m.querySelector(".v")?.textContent.trim() || "" }));
      const cover = card.querySelector(".case-cover img");
      return {
        i, tag: g(".case-tag"), gain: g(".case-gain b"), gainLabel: g(".case-gain span"),
        title: g(".case-title"), sub: g(".case-sub"), metrics,
        inspire: g(".case-inspire"), use: g(".case-use"),
        coverSrc: cover ? cover.getAttribute("src") || "" : ""
      };
    });
  });
  console.log("案例数:", data.length);
  fs.mkdirSync("apps/web/public/mall", { recursive: true });
  let n = 0;
  data.forEach((c) => {
    if (c.coverSrc.startsWith("data:image")) {
      const ext = c.coverSrc.includes("image/png") ? "png" : "jpg";
      fs.writeFileSync(`apps/web/public/mall/case${c.i}.${ext}`, Buffer.from(c.coverSrc.split(",")[1], "base64"));
      c.cover = `/mall/case${c.i}.${ext}`; n++;
    }
    delete c.coverSrc; delete c.i;
  });
  fs.writeFileSync("apps/web/src/marketplace/eco-cases-data.json", JSON.stringify(data, null, 2));
  console.log("封面导出:", n, "· 案例数据写入 eco-cases-data.json");
  console.log(data.map(c => `${c.tag} | ${c.title} | ${c.use}`).join("\n"));
  await b.close();
})();

const puppeteer = require("/Users/zhoukai/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core");
const fs = require("fs");
const HS = process.env.HOME + "/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell";
(async () => {
  const b = await puppeteer.launch({ executablePath: HS, headless: true, args: ["--no-sandbox"] });
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 1000 });
  await p.goto("file:///Users/zhoukai/code/MarketingBrain/docs/prototypes/agents-home-tech-demo-20260925.html", { waitUntil: "networkidle2" });
  await new Promise(r => setTimeout(r, 2000));
  const info = await p.evaluate(() => {
    const cons = document.getElementById("floor-consultants");
    const imgs = Array.from(document.querySelectorAll("img[data-cimg], img[data-kimg]")).map(i => ({ k: i.getAttribute("data-cimg") || i.getAttribute("data-kimg"), len: (i.getAttribute("src") || "").length }));
    return { consText: cons ? cons.innerText.replace(/\n/g, " | ") : "N/A", consCards: document.querySelectorAll("#floor-consultants .cons-card").length, imgs };
  });
  console.log("咨询师区文本:", info.consText);
  console.log("咨询师卡数量:", info.consCards);
  console.log("内嵌图片:", JSON.stringify(info.imgs));
  // 导出图片
  const data = await p.evaluate(() => {
    const out = {};
    document.querySelectorAll("img[data-cimg], img[data-kimg]").forEach(i => {
      const k = i.getAttribute("data-cimg") || i.getAttribute("data-kimg");
      const src = i.getAttribute("src") || "";
      if (src.startsWith("data:image")) out[k] = src;
    });
    return out;
  });
  fs.mkdirSync("apps/web/public/mall", { recursive: true });
  let n = 0;
  for (const [k, src] of Object.entries(data)) {
    const ext = src.includes("image/png") ? "png" : "jpg";
    fs.writeFileSync(`apps/web/public/mall/${k}.${ext}`, Buffer.from(src.split(",")[1], "base64"));
    n++;
  }
  console.log("导出图片数:", n, fs.readdirSync("apps/web/public/mall").join(", "));
  await b.close();
})();

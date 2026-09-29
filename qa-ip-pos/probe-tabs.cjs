const puppeteer = require("/Users/zhoukai/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core");
const HS = process.env.HOME + "/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell";
(async () => {
  const b = await puppeteer.launch({ executablePath: HS, headless: true, args: ["--no-sandbox"] });
  const p = await b.newPage();
  await p.goto("http://localhost:5174/product/hwRec/detail", { waitUntil: "networkidle2" });
  await new Promise(r => setTimeout(r, 1500));
  const n = await p.evaluate(() => ({
    details: document.querySelectorAll(".pd-tabs details").length,
    tabs: document.querySelectorAll(".pd-tabs").length,
    cards: document.querySelectorAll(".pd-card").length,
    html: document.querySelector(".pd-tabs") ? document.querySelector(".pd-tabs").outerHTML.slice(0, 300) : "NO .pd-tabs"
  }));
  console.log(JSON.stringify(n, null, 2));
  await b.close();
})();

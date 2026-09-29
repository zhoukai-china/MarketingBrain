const puppeteer = require("/Users/zhoukai/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core");
const HS = process.env.HOME + "/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell";
const path = require("path");
(async () => {
  const b = await puppeteer.launch({ executablePath: HS, headless: true, args: ["--no-sandbox", "--allow-file-access-from-files"] });
  // 1) 原型 hwRec 段
  const p1 = await b.newPage();
  await p1.setViewport({ width: 460, height: 1000, deviceScaleFactor: 1 });
  const fileUrl = "file://" + path.resolve("docs/prototypes/agent-product-detail-demo-20260923.html");
  await p1.goto(fileUrl, { waitUntil: "networkidle2", timeout: 30000 });
  await p1.evaluate(() => { const btn = document.querySelector('button[data-ag="hwRec"]'); if (btn) btn.click(); });
  await new Promise(r => setTimeout(r, 600));
  const sec = await p1.$('.agent-sec[data-agent="hwRec"]');
  if (sec) await sec.screenshot({ path: "qa-ip-pos/proto-hwRec.png" });
  console.log("proto shot:", Boolean(sec));
  // 2) 应用 F4 页整页
  const p2 = await b.newPage();
  await p2.setViewport({ width: 460, height: 1000, deviceScaleFactor: 1 });
  await p2.goto("http://localhost:5174/product/hwRec/detail", { waitUntil: "networkidle2", timeout: 30000 });
  await new Promise(r => setTimeout(r, 1500));
  await p2.screenshot({ path: "qa-ip-pos/app-hwRec-full.png", fullPage: true });
  const h = await p2.evaluate(() => document.body.scrollHeight);
  console.log("app full page height:", h);
  await b.close();
})();

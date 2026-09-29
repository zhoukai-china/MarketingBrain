const puppeteer = require("/Users/zhoukai/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core");
const HS = process.env.HOME + "/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell";
(async () => {
  const b = await puppeteer.launch({ executablePath: HS, headless: true, args: ["--no-sandbox"] });
  const p = await b.newPage();
  await p.goto("http://localhost:5174/product/hwRec/detail", { waitUntil: "networkidle2" });
  await new Promise(r => setTimeout(r, 1500));
  const info = await p.evaluate(() => ({ path: location.pathname, body: document.body.innerText.slice(0, 200), hasTopbar: !!document.querySelector(".eh-topbar"), hasMain: !!document.querySelector("main") }));
  console.log(JSON.stringify(info, null, 2));
  await b.close();
})();

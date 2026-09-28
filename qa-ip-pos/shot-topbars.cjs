const puppeteer = require("/Users/zhoukai/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core");
const HS = process.env.HOME + "/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell";
(async () => {
  const b = await puppeteer.launch({ executablePath: HS, headless: true, args: ["--no-sandbox"] });
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 700 });
  await p.goto("http://localhost:5174/agent/ipzone__ip-pos/workbench", { waitUntil: "networkidle2", timeout: 30000 });
  await new Promise(r => setTimeout(r, 1800));
  await p.screenshot({ path: "qa-ip-pos/topbar-unified.png" });
  await b.close();
  console.log("saved");
})();

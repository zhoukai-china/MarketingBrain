const puppeteer = require("/Users/zhoukai/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core");
const HS = process.env.HOME + "/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell";
(async () => {
  const b = await puppeteer.launch({ executablePath: HS, headless: true, args: ["--no-sandbox"] });
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 1000 });
  await p.goto("http://localhost:5174/agents", { waitUntil: "networkidle2" });
  await new Promise(r => setTimeout(r, 1500));
  const d = await p.evaluate(() => {
    const m = document.querySelector("main.eh");
    const cs = getComputedStyle(m);
    const mall = document.querySelector(".eco-mall");
    const mcs = getComputedStyle(mall);
    return { mainDisplay: cs.display, mainJustify: cs.justifyContent, mallWidth: mcs.width, mallMaxW: mcs.maxWidth, mallFlex: mcs.flex };
  });
  console.log(JSON.stringify(d));
  await b.close();
})();

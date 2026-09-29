const puppeteer = require("/Users/zhoukai/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core");
const HS = process.env.HOME + "/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell";
(async () => {
  const b = await puppeteer.launch({ executablePath: HS, headless: true, args: ["--no-sandbox"] });
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 1000 });
  await p.goto("http://localhost:5174/agents", { waitUntil: "networkidle2" });
  await new Promise(r => setTimeout(r, 1500));
  const d = await p.evaluate(() => {
    const prod = document.querySelector(".eh .eco-product");
    const cs = getComputedStyle(prod, "::before");
    return { display: cs.display, content: cs.content, anim: cs.animationName, h: cs.height };
  });
  console.log(JSON.stringify(d));
  await b.close();
})();

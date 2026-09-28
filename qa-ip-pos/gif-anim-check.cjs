const puppeteer = require("/Users/zhoukai/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core");
const HS = process.env.HOME + "/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell";
(async () => {
  const browser = await puppeteer.launch({ executablePath: HS, headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1100 });
  for (const url of ["http://localhost:5174/agent/ipzone__topic/detail", "http://localhost:5174/agent/ipzone__ip-pos/detail"]) {
    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 1200));
    const res = await page.evaluate(() => {
      const chip = document.querySelector(".ipd-gview .ipd-opts > span");
      const zone = document.querySelector(".ipd-gview .ipd-canvas > .ipd-zone");
      const gen = document.querySelector(".ipd-gview .ipd-gen");
      const live = document.querySelector(".ipd-gview .ipd-live");
      const cs = (el) => el ? getComputedStyle(el).animationName : "N/A";
      return { chip: cs(chip), zone: cs(zone), gen: cs(gen), live: cs(live) };
    });
    console.log(url.split("/agent/")[1], JSON.stringify(res));
  }
  await browser.close();
})();

const puppeteer = require("/Users/zhoukai/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core");
const HS = process.env.HOME + "/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell";
(async () => {
  const b = await puppeteer.launch({ executablePath: HS, headless: true, args: ["--no-sandbox"] });
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 900 });
  await p.goto("http://localhost:5174/agent/ipzone__ip-pos/detail", { waitUntil: "networkidle2" });
  await new Promise(r => setTimeout(r, 2000));
  const info = await p.evaluate(() => {
    const topbar = document.querySelector(".eh-topbar");
    const tb = topbar.getBoundingClientRect();
    const main = document.querySelector("main");
    const imgs = Array.from(document.querySelectorAll("img")).map(i => { const r = i.getBoundingClientRect(); return { src: i.getAttribute("src").slice(-40), y: Math.round(r.y + window.scrollY), w: Math.round(r.width), h: Math.round(r.height) }; });
    return {
      topbar: { y: Math.round(tb.y), h: Math.round(tb.height) },
      mainPadTop: getComputedStyle(main).paddingTop,
      docH: document.documentElement.scrollHeight,
      imgs: imgs.slice(-8)
    };
  });
  console.log(JSON.stringify(info, null, 2));
  await p.screenshot({ path: "qa-ip-pos/detail-top-gap.png" });
  await b.close();
})();

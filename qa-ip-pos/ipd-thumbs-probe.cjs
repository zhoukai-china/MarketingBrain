const puppeteer = require("puppeteer-core");
const CHROME = "/Users/zhoukai/.cache/puppeteer/chrome-headless-shell/mac_arm-150.0.7871.24/chrome-headless-shell-mac-arm64/chrome-headless-shell";
const BASE = "http://127.0.0.1:5174";

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true,
    args: ["--no-proxy-server", "--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage();
  await page.goto(`${BASE}/agent/ipzone__ip-pos/detail`, { waitUntil: "networkidle2", timeout: 60000 });
  await new Promise((r) => setTimeout(r, 1200));

  for (const w of [1440, 1280, 1024, 900]) {
    await page.setViewport({ width: w, height: 900 });
    await new Promise((r) => setTimeout(r, 300));
    const info = await page.evaluate(() => {
      const wrap = document.querySelector(".ipd-gthumbs");
      if (!wrap) return null;
      const btns = Array.from(wrap.querySelectorAll("button"));
      const tops = btns.map((b) => Math.round(b.getBoundingClientRect().top));
      return {
        wrapW: Math.round(wrap.getBoundingClientRect().width),
        wrapScrollW: wrap.scrollWidth,
        gridCols: getComputedStyle(wrap).gridTemplateColumns,
        btnCount: btns.length,
        btnW: btns[0] ? Math.round(btns[0].getBoundingClientRect().width) : 0,
        rows: new Set(tops).size,
        overflow: wrap.scrollWidth > wrap.clientWidth + 1,
      };
    });
    console.log(`视口 ${w}:`, JSON.stringify(info));
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });

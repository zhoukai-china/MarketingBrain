const puppeteer = require("/Users/zhoukai/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core");
const HS = process.env.HOME + "/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell";
(async () => {
  const b = await puppeteer.launch({ executablePath: HS, headless: true, args: ["--no-sandbox"] });
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 1000 });
  await p.goto("http://localhost:5174/agents", { waitUntil: "networkidle2" });
  await new Promise(r => setTimeout(r, 2200));
  const out = await p.evaluate(() => {
    const ava = document.querySelector(".eh .eco-p-img > .eco-ava");
    const wrap = ava.parentElement;
    const cs = getComputedStyle(ava);
    const wcs = getComputedStyle(wrap);
    return {
      ava: { pos: cs.position, inset: cs.top + "/" + cs.right + "/" + cs.bottom + "/" + cs.left, w: cs.width, h: cs.height, ml: cs.marginLeft, tf: cs.transform, parent: wrap.className, offsetParent: ava.offsetParent ? ava.offsetParent.className : "null" },
      wrap: { pos: wcs.position, w: wcs.width, h: wcs.height, display: wcs.display, placeItems: wcs.placeItems, cols: wcs.gridTemplateColumns, children: Array.from(wrap.children).map(c => c.tagName + "." + c.className.slice(0, 18)) }
    };
  });
  console.log(JSON.stringify(out, null, 2));
  await b.close();
})();

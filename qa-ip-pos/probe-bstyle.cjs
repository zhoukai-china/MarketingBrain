const puppeteer = require("/Users/zhoukai/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core");
const HS = process.env.HOME + "/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell";
(async () => {
  const b = await puppeteer.launch({ executablePath: HS, headless: true, args: ["--no-sandbox"] });
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 1100 });
  await p.goto("http://localhost:5174/agents", { waitUntil: "networkidle2" });
  await new Promise(r => setTimeout(r, 2000));
  const kk = await p.evaluate(() => {
    const ico = document.querySelector(".eh .eco-kk-ico");
    const cs = getComputedStyle(ico);
    return { bg: cs.backgroundColor, color: cs.color, anim: cs.animationName, svg: Boolean(ico.querySelector("svg")) };
  });
  console.log("金刚区:", JSON.stringify(kk));
  const pc = await p.evaluate(() => {
    const cover = document.querySelector(".eh-pcover");
    const img = cover.querySelector(".eh-cimg");
    const glyph = cover.querySelector(".eh-cover-glyph");
    return { bg: getComputedStyle(cover).backgroundColor, imgHidden: getComputedStyle(img).display === "none", glyphShown: getComputedStyle(glyph).display !== "none", glyphColor: getComputedStyle(glyph).color };
  });
  console.log("商品封面:", JSON.stringify(pc));
  // 案例视图
  await p.evaluate(() => { const t = Array.from(document.querySelectorAll(".eh-tab")).find(b => b.textContent.includes("AI案例")); if (t) t.click(); });
  await new Promise(r => setTimeout(r, 700));
  const cc = await p.evaluate(() => {
    const cover = document.querySelector(".eh-case-cover");
    const img = cover.querySelector(".eh-cimg");
    const glyph = cover.querySelector(".eh-cover-glyph");
    return { bg: getComputedStyle(cover).backgroundColor, imgHidden: getComputedStyle(img).display === "none", glyphShown: getComputedStyle(glyph).display !== "none" };
  });
  console.log("案例封面:", JSON.stringify(cc));
  await p.goto("http://localhost:5174/agents", { waitUntil: "networkidle2" });
  await new Promise(r => setTimeout(r, 1500));
  await p.screenshot({ path: "qa-ip-pos/home-style-b.png" });
  console.log("shot saved");
  await b.close();
})();

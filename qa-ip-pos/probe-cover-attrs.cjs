const puppeteer = require("/Users/zhoukai/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core");
const HS = process.env.HOME + "/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell";
(async () => {
  const b = await puppeteer.launch({ executablePath: HS, headless: true, args: ["--no-sandbox"] });
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 1000 });
  await p.goto("file:///Users/zhoukai/code/MarketingBrain/docs/prototypes/agents-home-tech-demo-20260925.html", { waitUntil: "networkidle2" });
  await new Promise(r => setTimeout(r, 2000));
  const info = await p.evaluate(() => {
    // 进入案例视图并展开全部，让所有封面渲染
    const tab = document.querySelector('.tab[data-tab="cases"]');
    if (tab) tab.click();
    const endBtn = document.querySelector(".cv-end button");
    if (endBtn) endBtn.click();
    const imgs = Array.from(document.querySelectorAll("img")).filter(i => (i.getAttribute("src") || "").startsWith("data:image"));
    const keys = imgs.map(i => i.getAttribute("data-cimg") || i.getAttribute("data-kimg") || i.className || i.parentElement.className);
    const cvImg = typeof window.cvImg === "function" ? null : "no fn";
    return { count: imgs.length, keys, srcLenSample: imgs.slice(0, 3).map(i => i.getAttribute("src").length) };
  });
  console.log(JSON.stringify(info, null, 2));
  await b.close();
})();

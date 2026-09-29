const puppeteer = require("/Users/zhoukai/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core");
const HS = process.env.HOME + "/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell";
(async () => {
  const b = await puppeteer.launch({ executablePath: HS, headless: true, args: ["--no-sandbox"] });
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 1000 });
  await p.goto("http://localhost:5174/agents", { waitUntil: "networkidle2" });
  await new Promise(r => setTimeout(r, 1800));
  const before = await p.evaluate(() => {
    const g = (sel) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), w: Math.round(r.width) }; };
    return { mall: g(".eco-mall"), hero: g(".eco-hero"), search: g(".eco-search"), main: g("main.eh") };
  });
  await p.type(".eco-search input", "111");
  await new Promise(r => setTimeout(r, 600));
  const after = await p.evaluate(() => {
    const g = (sel) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), w: Math.round(r.width) }; };
    return { mall: g(".eco-mall"), hero: g(".eco-hero"), search: g(".eco-search"), results: g(".eco-results"), empty: g(".eco-empty"), main: g("main.eh") };
  });
  console.log("输入前:", JSON.stringify(before));
  console.log("搜索空结果:", JSON.stringify(after));
  await b.close();
})();

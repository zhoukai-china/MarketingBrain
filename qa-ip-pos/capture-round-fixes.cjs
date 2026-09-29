// 本轮改动取证截图：价格块（OPC vs 硬件）+ 顶栏算力 ⚡ 胶囊
const puppeteer = require("/Users/zhoukai/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core");
const HS = process.env.HOME + "/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const b = await puppeteer.launch({ executablePath: HS, headless: true, args: ["--no-sandbox"] });
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 2 });

  // 顶栏算力胶囊
  await p.goto("http://localhost:5174/agents", { waitUntil: "networkidle2", timeout: 30000 });
  await sleep(1600);
  const bar = await p.evaluate(() => {
    const el = document.querySelector(".eh-wallet");
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x) - 12, y: Math.round(r.y) - 8, width: Math.round(r.width) + 24, height: Math.round(r.height) + 16 };
  });
  if (bar) await p.screenshot({ path: __dirname + "/fix-wallet-bolt.png", clip: bar });

  // 价格块对比
  for (const [key, out] of [["opcLlm", "fix-price-opc.png"], ["hwRec", "fix-price-hwrec.png"]]) {
    await p.goto(`http://localhost:5174/product/${key}/detail`, { waitUntil: "networkidle2", timeout: 30000 });
    await sleep(1400);
    const box = await p.evaluate(() => {
      const el = document.querySelector(".ipd-price");
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x) - 6, y: Math.round(r.y) - 6, width: Math.round(r.width) + 12, height: Math.round(r.height) + 12 };
    });
    if (box) await p.screenshot({ path: `${__dirname}/${out}`, clip: box });
    const num = await p.evaluate(() => {
      const n = document.querySelector(".ipd-num");
      const u = document.querySelector(".ipd-unit");
      return { num: n?.textContent, unit: u?.textContent, size: n ? getComputedStyle(n).fontSize : "" };
    });
    console.log(key, JSON.stringify(num));
  }
  await b.close();
})().catch((e) => { console.error("ERR:", e.message); process.exit(1); });

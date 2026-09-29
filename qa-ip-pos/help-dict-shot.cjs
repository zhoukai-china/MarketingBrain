// 新手帮助 · 术语词典 改版截图（1440 居中卡 / 430 底部抽屉）
const puppeteer = require("/Users/zhoukai/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core");
const HS = process.env.HOME + "/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const b = await puppeteer.launch({ executablePath: HS, headless: true, args: ["--no-sandbox", "--no-proxy-server"] });
  for (const [w, h, name] of [[1440, 900, "help-dict-1440"], [430, 860, "help-dict-430"]]) {
    const p = await b.newPage();
    await p.setViewport({ width: w, height: h, deviceScaleFactor: 2 });
    await p.goto("http://localhost:5174/agents", { waitUntil: "networkidle2", timeout: 30000 });
    await sleep(1200);
    await p.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find((x) => x.textContent?.includes("新手帮助"));
      btn?.click();
    });
    await sleep(800);
    await p.screenshot({ path: `/Users/zhoukai/code/MarketingBrain/qa-ip-pos/${name}.png` });
    console.log("saved", name);
    await p.close();
  }
  await b.close();
})();

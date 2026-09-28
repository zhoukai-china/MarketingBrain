const puppeteer = require("/Users/zhoukai/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core");
const HS = process.env.HOME + "/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell";
(async () => {
  const b = await puppeteer.launch({ executablePath: HS, headless: true, args: ["--no-sandbox"] });
  for (const [url, sel, label] of [
    ["file:///Users/zhoukai/code/MarketingBrain/docs/prototypes/agents-home-tech-demo-20260925.html", ".brand-hero", "原型"],
    ["http://localhost:5174/agents", ".eh-brand-hero", "本地"]
  ]) {
    const p = await b.newPage();
    await p.setViewport({ width: 1440, height: 1000 });
    await p.goto(url, { waitUntil: "networkidle2" });
    await new Promise(r => setTimeout(r, 2000));
    const out = await p.evaluate((s) => {
      const card = document.querySelector(s);
      const cs = getComputedStyle(card);
      return { h: Math.round(card.getBoundingClientRect().height), pad: cs.padding, lh: cs.lineHeight, children: Array.from(card.children).map(c => { const r = c.getBoundingClientRect(); const c2 = getComputedStyle(c); return c.className + " h" + Math.round(r.height) + " fs" + c2.fontSize + " lh" + c2.lineHeight + " mt" + c2.marginTop; }) };
    }, sel);
    console.log(label, JSON.stringify(out));
    await p.close();
  }
  await b.close();
})();

const puppeteer = require("/Users/zhoukai/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core");
const HS = process.env.HOME + "/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell";
(async () => {
  const b = await puppeteer.launch({ executablePath: HS, headless: true, args: ["--no-sandbox"] });
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 900 });
  const targets = [
    ["详情", "http://localhost:5174/agent/ipzone__ip-pos/detail"],
    ["工作台", "http://localhost:5174/agent/ipzone__ip-pos/workbench"]
  ];
  for (const t of targets) {
    await p.goto(t[1], { waitUntil: "networkidle2" });
    await new Promise(r => setTimeout(r, 1800));
    const info = await p.evaluate(() => {
      const main = document.querySelector("main");
      const kids = Array.from(main.children).map(function (c) {
        const r = c.getBoundingClientRect();
        const cs = getComputedStyle(c);
        return (c.className || c.tagName) + " y" + Math.round(r.y + window.scrollY) + " h" + Math.round(r.height) + " bgc:" + cs.backgroundColor + " bgi:" + cs.backgroundImage.slice(0, 40);
      });
      return {
        doc: document.documentElement.scrollHeight,
        mainBg: getComputedStyle(main).backgroundImage.slice(0, 70),
        last: kids.slice(-4)
      };
    });
    console.log("===== " + t[0] + " =====");
    console.log(JSON.stringify(info, null, 2));
  }
  await b.close();
})();

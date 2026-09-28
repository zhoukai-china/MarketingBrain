const puppeteer = require("/Users/zhoukai/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core");
const HS = process.env.HOME + "/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell";
(async () => {
  const b = await puppeteer.launch({ executablePath: HS, headless: true, args: ["--no-sandbox"] });
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 900 });
  for (const t of [["ip-pos详情", "http://localhost:5174/agent/ipzone__ip-pos/detail"], ["工作台", "http://localhost:5174/agent/ipzone__ip-pos/workbench"]]) {
    await p.goto(t[1], { waitUntil: "networkidle2" });
    await new Promise(r => setTimeout(r, 1600));
    const info = await p.evaluate(() => {
      const out = [];
      Array.from(document.querySelectorAll("*")).forEach(function (c) {
        const cs = getComputedStyle(c);
        const bgi = cs.backgroundImage || "";
        if (bgi.indexOf("url(") >= 0) {
          const r = c.getBoundingClientRect();
          out.push({ cls: String(c.className).slice(0, 34) || c.tagName, y: Math.round(r.y + window.scrollY), h: Math.round(r.height), url: bgi.slice(0, 90) });
        }
        const before = getComputedStyle(c, "::before").backgroundImage || "";
        if (before.indexOf("url(") >= 0) {
          out.push({ cls: (String(c.className).slice(0, 30) || c.tagName) + "::before", y: Math.round(c.getBoundingClientRect().y + window.scrollY), h: Math.round(c.getBoundingClientRect().height), url: before.slice(0, 90) });
        }
      });
      const footer = document.querySelector("footer");
      return { bgImages: out, footerText: footer ? footer.innerText.replace(/\n/g, " | ").slice(0, 60) : "无 footer", footerCls: footer ? String(footer.className) : "" };
    });
    console.log("===== " + t[0] + " =====");
    console.log(JSON.stringify(info, null, 2).slice(0, 1400));
  }
  await b.close();
})();

const puppeteer = require("/Users/zhoukai/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core");
const HS = process.env.HOME + "/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell";
(async () => {
  const b = await puppeteer.launch({ executablePath: HS, headless: true, args: ["--no-sandbox"] });
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 900 });
  await p.goto("http://localhost:5174/agent/ipzone__ip-pos/detail", { waitUntil: "networkidle2" });
  await new Promise(r => setTimeout(r, 1800));
  const info = await p.evaluate(() => {
    const root = document.querySelector(".ipd-detail") || document.querySelector("main");
    const out = [];
    const walk = function (el, depth) {
      if (depth > 4) return;
      Array.from(el.children).forEach(function (c) {
        const cs = getComputedStyle(c);
        const r = c.getBoundingClientRect();
        const bg = cs.backgroundColor;
        const bgi = cs.backgroundImage;
        const pinkish = /rgba?\(2[0-5][0-9]|rgb\(255, 2[0-9][0-9]|#ff[0-9a-f]/i.test(bg + bgi);
        if (pinkish || bgi !== "none") {
          out.push({
            cls: String(c.className).slice(0, 40),
            y: Math.round(r.y + window.scrollY),
            h: Math.round(r.height),
            bg: bg,
            bgi: bgi.slice(0, 60),
            text: (c.innerText || "").slice(0, 30).replace(/\n/g, " ")
          });
        }
        walk(c, depth + 1);
      });
    };
    walk(root, 0);
    return { rootCls: String(root.className), items: out.slice(-12) };
  });
  console.log(JSON.stringify(info, null, 2));
  await b.close();
})();

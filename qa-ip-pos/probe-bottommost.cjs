const puppeteer = require("/Users/zhoukai/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core");
const HS = process.env.HOME + "/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell";

function isPink(rgb) {
  const m = /rgba?\((\d+), (\d+), (\d+)/.exec(rgb || "");
  if (!m) return false;
  const r = +m[1], g = +m[2], bl = +m[3];
  return r > 220 && bl > 120 && g < r - 40 && bl > g + 20;
}

(async () => {
  const b = await puppeteer.launch({ executablePath: HS, headless: true, args: ["--no-sandbox"] });
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 900 });
  const urls = [
    ["ip-pos 详情", "http://localhost:5174/agent/ipzone__ip-pos/detail"],
    ["liverev 详情", "http://localhost:5174/agent/ipzone__liverev/detail"],
    ["ip-pos 工作台", "http://localhost:5174/agent/ipzone__ip-pos/workbench"],
    ["商城首页", "http://localhost:5174/agents"]
  ];
  for (const t of urls) {
    await p.goto(t[1], { waitUntil: "networkidle2" });
    await new Promise(r => setTimeout(r, 1600));
    const info = await p.evaluate(() => {
      const all = Array.from(document.querySelectorAll("*"));
      const rows = all.map(function (c) {
        const r = c.getBoundingClientRect();
        const cs = getComputedStyle(c);
        return { cls: String(c.className).slice(0, 34), top: Math.round(r.y + window.scrollY), bottom: Math.round(r.y + window.scrollY + r.height), bg: cs.backgroundColor, bgi: cs.backgroundImage.slice(0, 50), txt: (c.innerText || "").slice(0, 20).replace(/\n/g, " ") };
      }).filter(function (x) { return x.bottom > 0; });
      rows.sort(function (a, c) { return c.bottom - a.bottom; });
      return { doc: document.documentElement.scrollHeight, bottomMost: rows.slice(0, 3) };
    });
    console.log("===== " + t[0] + " (doc " + info.doc + ") =====");
    info.bottomMost.forEach(function (x) { console.log(JSON.stringify(x)); });
  }
  await b.close();
})();

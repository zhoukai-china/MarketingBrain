const puppeteer = require("/Users/zhoukai/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core");
const HS = process.env.HOME + "/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell";
(async () => {
  const b = await puppeteer.launch({ executablePath: HS, headless: true, args: ["--no-sandbox"] });
  const dump = async (url, cardSel, label) => {
    const p = await b.newPage();
    await p.setViewport({ width: 1440, height: 1000 });
    await p.goto(url, { waitUntil: "networkidle2", timeout: 40000 });
    await new Promise(r => setTimeout(r, 2200));
    const rows = await p.evaluate((sel) => {
      const card = document.querySelector(sel);
      if (!card) return ["CARD NOT FOUND: " + sel];
      const out = [];
      const walk = (el, depth) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        out.push("  ".repeat(depth) + el.className.toString().slice(0, 30) + " | x" + Math.round(r.x) + " y" + Math.round(r.y + window.scrollY) + " " + Math.round(r.width) + "x" + Math.round(r.height) +
          " | fs" + cs.fontSize + " lh" + cs.lineHeight + " pad" + cs.padding + " mg" + cs.margin + " gap" + cs.gap + " minH" + cs.minHeight);
        Array.from(el.children).forEach(c => walk(c, depth + 1));
      };
      walk(card, 0);
      return out;
    }, cardSel);
    console.log("===== " + label + " =====");
    console.log(rows.join("\n"));
    await p.close();
  };
  await dump("file:///Users/zhoukai/code/MarketingBrain/docs/prototypes/agents-home-tech-demo-20260925.html", "#empOk .emp", "原型员工卡");
  await dump("http://localhost:5174/agents", ".eh .eco-product", "本地员工卡");
  await b.close();
})();

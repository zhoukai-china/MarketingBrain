const puppeteer = require("/Users/zhoukai/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core");
const HS = process.env.HOME + "/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell";
(async () => {
  const b = await puppeteer.launch({ executablePath: HS, headless: true, args: ["--no-sandbox"] });
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 1000 });
  await p.goto("file:///Users/zhoukai/code/MarketingBrain/docs/prototypes/agents-home-tech-demo-20260925.html", { waitUntil: "networkidle2" });
  await new Promise(r => setTimeout(r, 2500));
  const out = await p.evaluate(() => {
    const pick = (id) => {
      const sec = document.getElementById(id);
      if (!sec) return id + ": 缺失";
      const clone = sec.cloneNode(true);
      clone.querySelectorAll("img").forEach(i => i.removeAttribute("src"));
      clone.querySelectorAll("svg").forEach(i => i.remove());
      return sec.innerText.replace(/\n/g, " | ") + "\n结构: " + clone.innerHTML.replace(/\s+/g, " ").slice(0, 1200);
    };
    return ["floor-hardware", "floor-courses", "floor-opc", "floor-industry", "floor-consultants"].map(pick).join("\n\n=====\n\n");
  });
  console.log(out);
  await b.close();
})();

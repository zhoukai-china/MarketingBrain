const puppeteer = require("/Users/zhoukai/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core");
const HS = process.env.HOME + "/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell";
(async () => {
  const b = await puppeteer.launch({ executablePath: HS, headless: true, args: ["--no-sandbox"] });
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 1000 });
  await p.goto("file:///Users/zhoukai/code/MarketingBrain/docs/prototypes/agents-home-tech-demo-20260925.html", { waitUntil: "networkidle2" });
  await new Promise(r => setTimeout(r, 2500));
  const out = await p.evaluate(() => {
    const cards = Array.from(document.querySelectorAll("#empOk .emp, #empDev .emp"));
    const clean = (card) => {
      const clone = card.cloneNode(true);
      clone.querySelectorAll("img").forEach(i => i.removeAttribute("src"));
      return clone.outerHTML;
    };
    return cards.map(c => ({ text: c.innerText.replace(/\n/g, " | "), html: clean(c).replace(/\s+/g, " ").slice(0, 700) }));
  });
  out.forEach((c) => {
    console.log("--- 文本 ---");
    console.log(c.text);
    console.log("--- 结构 ---");
    console.log(c.html);
    console.log("");
  });
  await b.close();
})();
